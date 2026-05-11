# Tier 1 Audit — Flow 3: One-off Order Lifecycle

> Date: 2026-05-11. Method: read-only code + prod DB cross-check. Status: complete. Two actionable findings (F3.1, F3.2); one latent deferred (F3.X). Place / confirm / cancel paths already validated in Flow 1 — this flow focused on status transitions, dispatch logic, RLS on UPDATE, and cart UX.

## Scope read

**Files (full reads):**
- `src/utils/deliveryStatus.ts` — persona-aware transition state machine
- `src/components/DeliveryOrderRow.tsx` — shared driver/hub/admin row component
- `src/screens/customer/OrderDetailScreen.tsx` — customer view + cancel
- `src/screens/admin/AdminOrderDetailScreen.tsx` — admin actions surface
- `src/hooks/useAdminOrders.ts` — admin cancel hook
- `src/hooks/useSmartCart.ts` + `src/utils/timeEngine.ts` — dispatch-scenario logic
- `src/store/cartStore.ts` + `essentialsCartStore.ts` — cart state + persistence
- `src/screens/customer/CheckoutScreen.tsx` (cart-clearing branches)
- `supabase/sql/rls_policies.sql` (orders SELECT/INSERT/UPDATE policies, lines 145-169)
- `supabase/sql/add_orders_hub_operator_update_policy.sql`

**Live prod probes:**
- `delivery_cycles`: all four cycles same-day (Breakfast 06:00→07:30, Lunch 11:00→12:30, Snacks 15:00→16:30, Dinner 18:00→19:30). **No cross-midnight cycle in production.**
- All `kitchen_push_time` = `cutoff_time` (zero-minute buffer). XL spec says 10-min buffer; this is config drift but not a code bug.
- Stuck orders summary:

| order_type | status | count | oldest |
|---|---|---|---|
| essential | Confirmed | 3 | 2026-05-06 (order 350) |
| food | Confirmed | 20 | 2026-04-29 |
| food | Packed | 1 | 2026-05-03 |
| food | Ready | 1 | 2026-05-04 |

- Order 350 (essential, ₹294 razorpay, 555 customer, dispatch_date 2026-05-06) has been stuck at Confirmed for 5 days — smoking-gun evidence for F3.2.

## Verdict matrix (spec vs implementation)

| Spec | Implementation | Match |
|---|---|---|
| Food flow: Confirmed → Preparing → Ready → Packed → Dispatched → Delivered | `OrderDetailScreen.tsx:36` `FOOD_FLOW` + StaffDashboard Kitchen advance + Packing advance | ✓ (Preparing never actually set; jumps Confirmed→Ready) |
| Essentials flow: Confirmed → Packed → Dispatched → Delivered (no kitchen) | `OrderDetailScreen.tsx:37` `ESSENTIALS_FLOW` | ✓ on display |
| Essentials skip kitchen, go directly to Packing | Kitchen tab filters `order_type='food'` only | ✓ |
| Packing UI advances orders | `StaffDashboard.tsx` Packing handler: Ready→Packed and Packed→Dispatched | **✗ no Confirmed→Packed path; essentials have no first hop — F3.2** |
| Persona-aware delivery transitions | `nextDeliveryStatus(persona)` correctly gates driver vs hub_operator vs admin | ✓ |
| Hub flow inserts Received at Hub | `OrderDetailScreen.tsx:39-47` `buildStatusFlow` + `deliveryStatus.ts` | ✓ |
| Customer-cancel atomic-ish | `cancel-order` Edge Function single execution; idempotent | ✓ (Flow 1) |
| Admin-cancel atomic | **Two-step client-side: UPDATE orders + RPC increment_wallet_balance** — F3.1 | **✗** |
| Order notes preserved on cancel | Customer `cancel-order` leaves notes alone; **admin `useAdminCancelOrder` REPLACES notes** with cancel reason | partial — F3.1 extension |
| Smart cart cutoff (same-day cycles) | `timeEngine.ts:61` — `nowMinutes < cutoffMinutes → A else B` | ✓ |
| Smart cart cutoff (cross-midnight) | `timeEngine.ts:53-59` — three branches; **after-cutoff returns A** (ambiguous semantics) | latent — F3.X |
| Cart clears on order success | `cartStore.clearCart()` clears items+plans; CheckoutScreen calls it appropriately | ✓ |
| RLS UPDATE — staff, admin | `orders_staff_update` checks `is_staff_or_admin AND has_branch_access` | ✓ |
| RLS UPDATE — hub operator | `orders_hub_operator_update` (BF-12) — customer role + `assigned_hub_id` match | ✓ |
| RLS UPDATE — customer | No customer-self UPDATE policy; customer cancel goes via Edge Function (service role) | ✓ by design |

## Findings

### F3.1 — `useAdminCancelOrder` is non-atomic + clobbers notes (BF-20 class)

**Where:** `src/hooks/useAdminOrders.ts:87-129`.

Same class as the pre-BF-20 subscription cancel bug:
1. `UPDATE orders SET status='Cancelled', notes=reason` — single client call.
2. `RPC increment_wallet_balance` — separate call.

If step 1 succeeds and step 2 fails (network drop / RLS reject), the order is cancelled but the customer's wallet is never refunded. Logged to `console.error` only — no admin signal.

**Notes-clobbering side-effect:** `update({ ..., notes: reason ?? 'Cancelled by admin' })` REPLACES whatever was in `orders.notes`. If the customer had legitimate delivery instructions ("Please ring doorbell"), they're lost. The customer-facing `cancel-order` Edge Function correctly leaves notes alone.

**Why it survived launch readiness:** subscription cancels were atomicized via `admin_cancel_subscription_atomic` (BF-20) — the same hardening was never extended to one-off order cancels.

**Recommended fix (per long-term-stability bias):**
- New SECURITY DEFINER RPC `admin_cancel_order_atomic(p_order_id, p_refund_amount, p_reason)`. Mirrors BF-20: gate via `is_admin()`, row lock + read state, set status='Cancelled', APPEND reason to notes, call `increment_wallet_balance` — all in one transaction.
- Replace `useAdminCancelOrder` to invoke the RPC.
- Notes append pattern: `notes = COALESCE(notes || ' | ', '') || '[Admin cancel: ' || p_reason || ']'`.

**Status:** action proposed (BF-34a).

### F3.2 — Essentials orders stuck at Confirmed (Packing UI has no first-hop)

**Where:** `src/screens/staff/StaffDashboard.tsx:812-816` (`renderOrderRow`) and `:603-617` (`handleMarkAllPacked`).

```ts
let nextStatus: OrderStatus | null = null;
if (item.status === 'Ready') nextStatus = 'Packed';
else if (item.status === 'Packed') nextStatus = 'Dispatched';
const canAdvance = item.status === 'Ready' || item.status === 'Packed';
```

**Problem:** essentials orders never pass through Kitchen (no aggregation prep). They land in Packing/Essentials with `status='Confirmed'`. The Packing handler has no `Confirmed → Packed` transition, so essentials are stuck.

**Smoking gun in prod:** order 350 (₹294 essentials razorpay, dispatch_date 2026-05-06, 555 customer) sat at Confirmed for 5 days because no UI surface could advance it.

`handleMarkAllPacked` has the same gap — filters `o.status === 'Ready'` only.

**Customer impact:** essentials customers see "Confirmed" indefinitely, no progress, no delivery. Indistinguishable from a payment-stuck order from their side.

**Recommended fix:**

```diff
-    if (item.status === 'Ready') nextStatus = 'Packed';
+    if (item.status === 'Confirmed' && item.order_type === 'essential') nextStatus = 'Packed';
+    else if (item.status === 'Ready') nextStatus = 'Packed';
     else if (item.status === 'Packed') nextStatus = 'Dispatched';
-    const canAdvance = item.status === 'Ready' || item.status === 'Packed';
+    const canAdvance = nextStatus !== null;
```

And `handleMarkAllPacked` filter:
```diff
-    const toMark = packingOrders.filter((o) => o.status === 'Ready');
+    const toMark = packingOrders.filter((o) =>
+      o.status === 'Ready' ||
+      (o.status === 'Confirmed' && o.order_type === 'essential'),
+    );
```

**Backfill consideration:** order 350 (and any other stuck essentials) should be moved to a terminal state. Two options:
- (a) Mark 350 Cancelled + refund wallet portion (would need to look at wallet_amount_used; for razorpay-only orders it'd be 0 refund-to-wallet, admin handles razorpay refund manually).
- (b) Mark 350 Delivered (assume it was actually fulfilled physically — but no evidence it was).
- (c) Leave as historical curiosity, tagged via notes.

Recommendation: **(a)** for 350 (it's a test record, no physical delivery). For 9441 / 9443, leave alone — they're recent and the Packing UI will be able to advance them after the fix.

**Status:** action proposed (BF-34b).

### F3.X — Cross-midnight after-cutoff scenario returns 'A' ambiguously

**Where:** `src/utils/timeEngine.ts:53-59`.

```ts
if (isCrossMidnight) {
  if (nowMinutes < deliveryStartMinutes) return 'A';
  if (nowMinutes >= deliveryStartMinutes && nowMinutes < cutoffMinutes) return 'B';
  return 'A';   // ← after cutoff: meaning is undefined
}
```

Hypothetical: cycle with cutoff 22:00, delivery_start 07:30 next morning. Customer at 23:00 places order. Code returns 'A' → CheckoutScreen sets `dispatch_date=today`. Cron's `trigger_kitchen_cutoff_pushes` for cross-midnight uses `v_target_date = v_ist_date + 1`, so kitchen push aggregates orders WHERE `dispatch_date = tomorrow`. The order's dispatch_date doesn't match — **silently orphaned, never reaches kitchen.**

**Why it's latent:** all 4 prod cycles are same-day (cutoff before delivery_start on same calendar day). The cross-midnight branch never executes today. Risk fires only if admin reconfigures a cycle to cross-midnight (e.g., "tomorrow's breakfast" with cutoff at 22:00 tonight).

**Why not fix now:** the "right" semantics aren't clear without product input. Three plausible behaviors when ordering after cross-midnight cutoff:
- Block the order ("missed today's cutoff, next available is day-after-tomorrow").
- Place for day N+2 (skip tomorrow's locked delivery).
- Place for tomorrow anyway with operational risk.

**Status:** deferred. Flag in the cycle-config UI documentation. Revisit when/if cross-midnight cycles become a product requirement.

### F3.Y — `kitchen_push_time` = `cutoff_time` (zero-minute buffer)

**Where:** `delivery_cycles` table (live data). XL spec says "after 10 minutes of each delivery cycle order cut off time".

**Status:** config-level fix. Admin can update `kitchen_push_time` per cycle in `StoreConfigScreen` (or via SQL). One-line SQL:
```sql
UPDATE delivery_cycles SET kitchen_push_time = cutoff_time + INTERVAL '10 minutes' WHERE is_active;
```

Not a code change — flagging for Shrikanth to run when ready. Doesn't affect functional correctness (kitchen push fires at cutoff_time minute, which is when the cycle effectively closes), only the 10-minute grace buffer for late stragglers.

## Closed clean (no action)

- `nextDeliveryStatus` persona gating (Driver / Hub op / Admin) — sound.
- RLS policies on orders UPDATE — three policies cover staff, admin, hub-operator. Customer cancel correctly routes via Edge Function bypassing RLS.
- Smart cart cutoff for non-cross-midnight cycles — exact boundary behavior correct.
- Cart store `clearCart()` clears both items and plans atomically.
- Customer `OrderDetailScreen` cancel flow uses Edge Function (correctly).
- Subscription core-items + date-range conflict check (`place-order:248-299`).

## Tier 2 (post-audit Jest backfill) targets surfaced

1. `admin_cancel_order_atomic` rollback when wallet credit fails (post F3.1 fix).
2. Packing UI advances essentials Confirmed → Packed → Dispatched (post F3.2 fix).
3. `nextDeliveryStatus` matrix: every (status, deliveryMethod, persona) combination produces the expected next status.
4. Smart cart boundary: same-day cycles, exactly at cutoff_minute, returns 'B' (tomorrow).
5. Cart clear on success leaves nothing in items or plans (regular path) or only plans cleared (sub-only path).
6. Order 350-style: essentials at Confirmed has a Packing advance button enabled.
