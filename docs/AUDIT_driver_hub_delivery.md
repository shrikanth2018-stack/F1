# Tier 1 Audit — Flow 5: Driver + Hub Delivery

> Date: 2026-05-11. Method: read-only code + prod DB cross-check. Status: complete. No code changes shipped — all critical paths validated in Flows 0 / 1 / 3 / 4. Two deferred defense-in-depth findings (F5.1, F5.2).

## Scope read

Most of the surface area was already audited in earlier flows. This pass confirmed remaining gaps:

- `src/hooks/useAuth.ts` — JWT claim extraction (role, assigned_hub_id, branch_id, is_driver) + foreground refresh.
- `src/hooks/useDeliveryHubs.ts` + `useDeliveryZones.ts` — admin CRUD for hubs/zones + driver fields.
- `src/screens/admin/DeliveryManagerScreen.tsx` (structural skim) — Cycles / Zones / Hubs tabs.
- `assign_hub_operator` RPC pattern (referenced from hub-operator assignment).

Already validated:
- `nextDeliveryStatus` persona gating (Flow 3).
- DriverDashboardScreen zone+hub scoping + status filter (Flow 3).
- HubDashboardScreen via `useStaffOrders` hub-id session filter (Flow 3).
- `orders_staff_update` + `orders_hub_operator_update` RLS policies (Flow 3, BF-12).
- DeliveryOrderRow component (Flow 3).
- Push fan-out for status transitions (Flow 4, post BF-35).

## Verdict matrix

| Spec | Implementation | Match |
|---|---|---|
| JWT carries role / assigned_hub_id / branch_id / is_driver | `extractRole` in `useAuth.ts:33-70` decodes payload, defaults safe | ✓ |
| App picks up server-side claim changes on foreground | `useAuth.ts:102-108` proactive `refreshSession()` on AppState=active | ✓ |
| Driver visibility: only own zones + hubs | `DriverDashboardScreen.tsx:51-82` queries `delivery_hubs/zones WHERE driver_user_id=me`, filters orders client-side | ✓ (Flow 3) |
| Hub operator visibility: only own hub | `useStaffOrders` filters `customer_addresses.hub_id == session.assignedHubId` | ✓ (Flow 3) |
| Hub-operator UPDATE via row-scoped RLS | `orders_hub_operator_update` policy keyed on `hub_id == jwt.assigned_hub_id` | ✓ (Flow 3) |
| Hub-operator assignment is atomic | `assign_hub_operator` RPC clears old operator + sets new + writes delivery_hubs.staff_user_id in one transaction | ✓ |
| Driver assignment is atomic | **No atomic RPC** — `useUpdateHub` / `useUpdateZone` write `driver_user_id` via plain UPDATE | ⚠ F5.1 |
| Driver privilege revocation propagates immediately | Requires JWT refresh — proactive refresh on foreground catches it within seconds | partial — F5.2 |
| Signout cleans push token | `useAuth.signOut` deletes the device's token row with 3s race timeout | ✓ |
| Push notifications honor admin templates | After BF-35: all status pushes via `resolveAndSendPush` with event_keys | ✓ |

## Findings

### F5.1 — Driver assignment lacks an atomic RPC (defense-in-depth)

**Where:** `src/hooks/useDeliveryHubs.ts:82-88` (useUpdateHub), `src/hooks/useDeliveryZones.ts` (analogous useUpdateZone). Both write `driver_user_id` via a plain `.update()` call.

**Hub operator assignment** uses `assign_hub_operator` RPC which atomically clears the previous operator's `profiles.assigned_hub_id`, sets the new operator's, AND writes `delivery_hubs.staff_user_id` — all in one transaction. Driver assignment has no such pattern.

**Impact:** today, `is_driver` is a JWT claim derived from a `custom_access_token_hook` lookup at signin/refresh time, so the divergence isn't directly observable. But:
- If admin updates `driver_user_id` and a separate process needs to maintain a derived field on `profiles` (none exists today, but might in future), there's no atomicity.
- Status flips queued by the **old** driver during an offline session would replay after revocation (until their JWT refreshes). RLS check is `is_staff_or_admin AND has_branch_access(branch_id)` — driver-scoping isn't enforced at RLS. So a revoked driver's queued mutation would still succeed for any in-branch order.

**Fix scope:** create `assign_driver_to_zone` / `assign_driver_to_hub` RPCs mirroring `assign_hub_operator`. Add row-scoped RLS check using `driver_user_id` for delivery-status transitions (Dispatched → On the Way / Received at Hub).

**Status:** **deferred** — not a launch blocker; bounded by JWT refresh window. Open as post-launch FT. Worth pulling in if admin operationally re-assigns drivers frequently.

### F5.2 — JWT refresh window for revoked driver privileges

**Where:** consequence of how `is_driver` claim is computed.

When admin clears `driver_user_id` from a hub/zone:
- The driver's `is_driver` claim in their existing JWT remains `true` until the next refresh.
- Foreground refresh triggers within seconds (`useAuth.ts:102-108`) — good.
- But offline-queued mutations stored before revocation will still replay with the old session.

**Impact:** narrow window (seconds to minutes) during which a revoked driver's offline mutations get accepted. Bounded by `MAX_QUEUE_RETRIES` + `useOfflineSync` cross-session-user guard (which checks `userId !== currentUser.id` — but the driver hasn't switched users, so this doesn't catch them).

**Fix scope:** would need RLS-level driver-scoping on orders UPDATE (tied to F5.1's atomic RPC + new policy).

**Status:** **deferred** — bounded blast radius, post-launch hardening.

## Closed clean (no action)

- Auth context, JWT parsing, foreground refresh, signout cleanup.
- Driver / Hub Dashboard filters + scoping.
- DeliveryOrderRow status pill + advance logic.
- DeliveryManager admin screen — uses standard hooks (cycle / zone / hub CRUD).
- Push fan-out for delivery-status transitions (post BF-35 — single source via app code).

## Tier 2 (post-audit Jest backfill) targets

1. `extractRole` correctly defaults to safe values when JWT claims are missing.
2. Foreground refresh picks up newly-added `is_driver` claim (customer → driver promotion).
3. Cross-session guard in `useOfflineSync` discards mutations from a different signed-in user.
4. Hub operator UPDATE denied by RLS when `hub_id != jwt.assigned_hub_id`.
5. Driver-revocation propagation (post F5.1 fix).
