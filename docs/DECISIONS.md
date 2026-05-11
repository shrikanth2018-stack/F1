# 1stOne F1 — Open task ledger

> What's still open and what's worth attempting EOD today. Lifecycle: items open here; when shipped they graduate to `docs/HISTORY.md` with sha + file paths. For working rules see `docs/RULES.md`. For current state see `docs/STATUS.md`. For per-flow audit detail see `docs/AUDIT_*.md`.

## Pre-launch must-do (D-08 gate)

- **V-06 persona regression** — operational test on real device. Customer → staff (kitchen + packing) → driver → hub-op → branch-admin walkthrough. Covers everything Jest mocks can't (push tokens, Razorpay sandbox, cron-fired sub dispatches landing in staff UI).
- **Flag flip SQL** — once V-06 green, run `UPDATE feature_flags SET flag_value = TRUE WHERE flag_key = 'branch_management_active';`. I can run it on say-so.
- **FT-08 UX punch list** — reorder menu items + small UX tweaks. Awaiting your list. Will land before next AAB.

## Could close today — EOD candidates

All four closed this session (see Done log below).

## Post-launch / no-action

- **F4.4** — offline queue order-of-failure can cause status skips. Bounded by retry cap.
- **F4.5** — offline-replayed status mutations don't fire customer push. **Closed as "no" (option b)** — operationally staff is offline briefly, replays happen within minutes; firing stale "Order Ready!" pushes hours later is worse UX. Customer sees current state on next app open. Documented in `docs/AUDIT_staff_operations.md`.
- **F5.1** — atomic RPC for driver assignment. **Closed as not-a-bug** — the audit doc misframed the problem. Driver assignment writes a single column (`delivery_zones.driver_user_id` OR `delivery_hubs.driver_user_id`), so the UPDATE is already atomic. `assign_hub_operator` exists because hub-operator assignment touches two tables (profiles + delivery_hubs); driver doesn't have that coupling. The audit doc's secondary suggestion (row-scoped RLS on orders UPDATE keyed on driver_user_id) is a real tightening but rippled across `orders_staff_update` + new policy + careful split — not single-session safe. **Re-classified to post-launch FT.**
- **F6.1** — `notification_templates` not branch-scoped. Multi-branch concern only.
- **F6.2** — `referrals_self` admin clause is `is_admin()` only. **Documented intentional.**
- **MF-06** — Staging Supabase project. Needs you to create the project in the dashboard.
- **FT-04** — Branches Manage admin screen. Self-service post-launch.
- **FT-05** — Super-admin marker migration (`profiles.is_super_admin BOOLEAN`).
- **FT-06** — Super-admin TOTP 2FA. Parked.
- **Master Document v1.1 refresh** — text-only against post-2026-05-02 reality.
- **Scheduled push multi-branch spot-check** — once branch 2 exists, ~30 min.

## Done — closed today (2026-05-11)

- ✅ **BF-40 (F7.2)** — `dormant-user-check` now reads `push_logs WHERE trigger_source='winback' AND sent_at > NOW() - inactiveDays` and excludes already-pushed users from the batch. Honors the header comment's "won't double-send" promise.
- ✅ **BF-41 (F3.X)** — cross-midnight cycle scenarios fixed. Today's delivery is locked at yesterday's cutoff, so `getDispatchScenario` returns `'B'` (tomorrow) before today's cutoff or new `'C'` (day after tomorrow) after. CheckoutScreen fires a confirmDialog for `'C'` so customer explicitly accepts the 2-day shift. Smart-cart badge labels "Day after tomorrow" with warning variant. Tests updated.
- ✅ **F4.5** — closed as option (b) "no push on offline replay" (rationale above).
- ✅ **F5.1** — re-analyzed and closed as not-a-real-atomicity-bug; RLS row-scoping for drivers re-classified to post-launch FT.


- ✅ **Tier 1 audit ladder (8 / 8 flows)** — BF-31 → BF-37 shipped + verified live. Per-flow detail in `docs/AUDIT_*.md`.
- ✅ **Tier 2 Jest backfill** — 191 → 300 tests across 18 suites. `@testing-library/react-native` added. Three small utility extractions (`orderFilters`, `packingFlow`, `subscriptionMath`) for testability.
- ✅ **BF-38 (F1.3 + F4.3)** — wallet topup Idempotency-Key header + `useRealtimeOrders` IST-midnight rollover.
- ✅ **F3.Y** — `delivery_cycles.kitchen_push_time` bumped to `cutoff_time + 10 min` on all 4 active cycles.
- ✅ **BF-39 (F1.5)** — `cancel-order` Edge fn pushes `admin.wallet_refund_failed` to branch admins on wallet refund failure.
- ✅ **MF-08 fully closed** — production-only supply tables + referral trigger captured to tracked SQL (`supply_chain_tables.sql`, `referral_first_order_trigger.sql`); round-trip deploy verified.
- ✅ **MF-03 Classes A/B/C + punch list 12-14** — verified live via Flow 6 audit.
- ✅ **MF-07a pre-push gate** — shipped 2026-05-05.
- ✅ **F4.2** — push token registration confirmed not-a-bug (test-env artifact; wiring is correct).

## Verification queue (folds into V-06)

- **V-01** — admin cancellation prorated refund spot-check. Cancel sub 39 mid-walk to verify.
- **MF-05 + BF-18** — real Android customer cancel cross-screen invalidation + login OTP unified screen flow.
