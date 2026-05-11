# Tier 1 Audit — Flow 4: Staff Operations

> Date: 2026-05-11. Method: read-only code + prod DB cross-check. Status: complete. Two actionable findings (F4.0 latent time-bomb in send-push, F4.1 push-duplication via DB trigger). Three deferred (F4.2 token registration, F4.3 useRealtimeOrders midnight bug, F4.4 offline-queue order-of-failure).

## Scope read

**Code:** `src/store/staffQueueStore.ts`, `src/hooks/useOfflineSync.ts`, `src/hooks/useRealtimeOrders.ts`, `src/screens/staff/StaffDashboard.tsx` (ingredient parser + push wiring), `src/hooks/useStaffOrders.ts` STATUS_PUSH map, `src/hooks/useAdminOrders.ts` STATUS_PUSH map, `supabase/functions/send-push/index.ts`, `supabase/functions/_shared/notifications.ts` (resolveAndSendPush helper), `supabase/sql/push_notifications.sql` (DB trigger + cron).

**Prod probes:**
- `push_logs`: **0 rows total**. Either no pushes are being sent OR the log write path is broken.
- `push_notification_tokens`: **0 rows total**, 0 active. No device has ever registered a push token in this DB.
- Edge function `send-push` deployed version 12, last updated 2026-04-24 UTC — predates the commit that introduced the typo (F4.0 below).
- Kitchen push log: 4 rows from 2026-05-05/06 (each cycle once per day; latest 2026-05-06 18:00 IST).

## Findings

### F4.0 — `send-push` edge function has a typo that will break all pushes on next deploy (latent time-bomb)

**Where:** `supabase/functions/send-push/index.ts:91, 104`.

```ts
const {
  ...
  title: titleIn,
  body: resolvedBody,            // ← line 91: destructured const-bound name
  ...
} = body ?? {};

let title: string | undefined = titleIn;
let resolvedBody: string | undefined = msgBody;   // ← line 104: redeclares + msgBody undefined
```

- `body: resolvedBody` on line 91 creates a const-bound local `resolvedBody`.
- Line 104 tries to `let resolvedBody` again in the same scope — SyntaxError at parse.
- Line 104 also references `msgBody` which is undeclared anywhere in the file (grepped) — ReferenceError if it ever ran.

**Why production isn't broken today:** the typo was introduced in commit `4e00d70` (2026-04-25 IST, "Notification templates, hub features…"). The deployed version of send-push is **v12 from 2026-04-24 UTC** — i.e., deployed *before* the typo landed. The bad code has never been deployed. Today's earlier deploys touched `wallet-topup` and `subscription-expiry-push` only; `send-push` is still the older working version.

**Trigger for the time-bomb:** any future `supabase functions deploy send-push` (manual or batched `--all`) ships the broken file. Pushes would fail on every call. Customer order confirmations, staff status updates, kitchen pushes, expiry notices — all silently break.

**Fix:** intended rename — `body: msgBody` in the destructure, so the later `let resolvedBody = msgBody` resolves.

```diff
-      body: resolvedBody,
+      body: msgBody,
       event_key,
```

No deploy needed today (deployed version is correct), but the disk fix removes the time-bomb so future deploys are safe. **Strongly recommend fixing now + deploying** to bring the deployed version in line with all the other commits since 2026-04-24.

**Status:** action proposed (BF-35a).

### F4.1 — Order-status push duplication: DB trigger AND app-code both fire

**Where:**
- DB trigger: `supabase/sql/push_notifications.sql:81-166` (`_notify_order_status_push` + `trg_order_status_push`).
- App-code: `useStaffOrders.useUpdateOrderStatus` (STATUS_PUSH for Ready/Dispatched/Received at Hub/Delivered/Cancelled), `useAdminOrders.firePush` (all statuses), `place-order` (`order.confirmed` wallet path), `verify-payment` (`order.razorpay_confirmed` + `wallet.topped_up` + `subscription.activated` + `order.payment_failed`).

The DB trigger fires `AFTER INSERT OR UPDATE OF status` on `orders` and pushes hardcoded title/body. Multiple app-code paths also call `send-push` for the same events.

Result per code path:

| Path | App-code push | DB trigger push | Total |
|---|---|---|---|
| place-order INSERT (wallet) | ✓ `order.confirmed` | ✓ status='Confirmed' | **2** |
| confirm-order UPDATE → Confirmed | — | ✓ | 1 |
| verify-payment mark_order_paid UPDATE (post BF-32a writes 'Confirmed') | ✓ `order.razorpay_confirmed` | trigger sees `new.status = old.status` IF confirm-order already ran → skips; else fires | 1 or 2 |
| Staff useUpdateOrderStatus → Ready | ✓ `order.ready` | ✓ status='Ready' | **2** |
| Staff useUpdateOrderStatus → Dispatched / Received at Hub / Delivered / Cancelled | ✓ | ✓ | **2 each** |
| Admin useAdminOrders → any status | ✓ firePush | ✓ | **2** |
| Admin cancel via admin_cancel_order_atomic | ✓ firePush('Cancelled') | ✓ status='Cancelled' | **2** |
| cancel-order Edge fn UPDATE | — | ✓ | 1 |
| generate_daily_manifest INSERT (cron sub dispatch) | — | ✓ status='Confirmed' | 1 |

**Worst case (razorpay sub purchase):** 3 pushes per buy — DB trigger from `confirm-order`'s UPDATE + `verify-payment.order.razorpay_confirmed` + `verify-payment.subscription.activated`.

**Why production hasn't surfaced this:** 0 push tokens registered → send-push short-circuits at `tokens.length === 0` → no actual notification fans out. The duplication is dormant. As soon as a real device registers, customers will get 2-3 push notifications per status event.

**Template-feature regression:** admin can edit `notification_templates` per `event_key`. App-code paths honor it (via `resolveAndSendPush`). DB trigger uses hardcoded copy — bypasses admin overrides. Customer would receive (1) admin's edited message via app-code AND (2) the hardcoded message via trigger. Admin's careful copy edits become indistinguishable from a duplicate notification with stale wording.

**Fix:** drop the DB trigger; make app-code the single source of push. The trigger covers four code paths that currently lack their own push call:
1. `confirm-order` UPDATE → Confirmed (Razorpay app-driven). **Add explicit push call.**
2. `cancel-order` Edge fn UPDATE → Cancelled (customer-initiated). Customer is on-screen and gets an Alert.alert. **Skip push** — they know.
3. `generate_daily_manifest` INSERT (cron sub dispatch). **Design call: keep daily push or drop?**
4. Any future SQL-initiated status change. Rare; flag in cycle-config docs.

**Daily sub-dispatch push design call:** today's behavior fires "Order #X is confirmed. We're getting it ready!" at every cycle's kitchen_push_time (e.g., 06:00 for breakfast) for every active subscription. For a customer with one daily subscription, that's 1 push/day. For multi-meal subs (breakfast+lunch+dinner), up to 4/day. Could be welcome ("yes my breakfast is being made") or noise ("I know, I subscribed").

Recommended position: **keep the daily push**. A subscription customer relies on the meal arriving and the morning push is reassuring. Implementation: add `pg_net` call inside `generate_daily_manifest` post-INSERT, similar to `push_kitchen_summary`. Each generated row fires one push to the customer.

**Status:** action proposed (BF-35b). Confirm the design call before I touch SQL.

## Deferred

### F4.2 — Zero push tokens registered in prod

`push_notification_tokens` has 0 rows. Either:
- Test devices never grant push permission / token registration flow is broken in dev/test, or
- Token registration is wired only after a specific event (e.g., first opening Profile screen) that testers never hit.

Tier 1 scope (engineering correctness) — this audit doesn't dig into device-registration. Belongs to Flow 8 (Auth + device init). Flagging here so we don't forget. Push fan-out depends on this — F4.1's fix is invisible until at least one device registers.

### F4.3 — `useRealtimeOrders` captures today's date at mount

`src/hooks/useRealtimeOrders.ts:24`:
```ts
const today = new Date().toISOString().split('T')[0];
```

If the staff dashboard stays mounted past midnight (late-night kitchen), the realtime filter still points to yesterday — new orders for the new "today" don't trigger React Query invalidation. Manual pull-to-refresh works. Probability low. **Status:** defer (Tier 2 test target).

### F4.4 — Offline queue order-of-failure can cause status skips

`useOfflineSync` drains FIFO. If mutation N fails (incrementRetry, no dequeue) and mutation N+1 succeeds, the order's status skips an intermediate state. Customer-visible: they miss "Ready" if app code's push handler isn't reached for N (and after F4.1's fix, status pushes go via app code only). Bounded by `MAX_QUEUE_RETRIES` cap (eventually dequeue), so not infinite. **Status:** defer (Tier 2 test target).

### F4.5 — Offline mutations skip customer push entirely

`useStaffOrders.useUpdateOrderStatus` only fires push when `isOnline`. Queued offline mutations replay via `useOfflineSync.drainQueue`, which calls supabase directly with no push fan-out. So while staff is offline (lunch rush, poor connectivity — the entire reason this queue exists), customer push for status changes never fires, even after reconnection.

After F4.1's fix, this gap persists. Could fix by making `drainQueue` also call `send-push` after each successful UPDATE, but that adds replay-time push complexity (e.g., should a "Ready" push fire 2 hours after the staff tapped if the order is by now Delivered?). **Status:** defer — design call required.

## Closed clean (no action)

- `staffQueueStore` zustand+persist — solid; cross-session user guard prevents replay-as-wrong-user.
- `useOfflineSync` NetInfo listener + drain mechanics — sound.
- `resolveAndSendPush` helper (template resolution + variable substitution) — correctly looks up `notification_templates` by `event_key`, falls back on missing/disabled. No bugs.
- Kitchen aggregator (`StaffDashboard.aggregateKitchenItems`) — ingredient token parser handles integer counts + unit-suffixed values; aggregates by `(name, unit, status)` triple. Defensive against missing `ingredients` field via fallback to meal name.
- `staff_order_requests` mirror trigger (BF-17 work) — not re-audited; was reviewed at landing.
- Customer push notification trigger semantics inside `_notify_order_status_push`: status mapping is correct, security-definer is appropriate, app_config lookup pattern matches kitchen_cutoff_push convention.

## Tier 2 (post-audit Jest backfill) targets

1. `send-push` with no `event_key` falls through to caller-provided title/body (post F4.0 fix).
2. `send-push` with `event_key` and `is_enabled=false` returns skipped.
3. After F4.1 fix: drop trigger, confirm only one push fires per status change (mock).
4. `useOfflineSync` cross-session user guard discards mismatched mutations.
5. `useOfflineSync` order preservation when middle item fails (F4.4).
6. `useRealtimeOrders` midnight rollover (F4.3).
