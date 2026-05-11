# 1stOne F1 — Open task ledger

> What's still open and what's worth attempting EOD today. Lifecycle: items open here; when shipped they graduate to `docs/HISTORY.md` with sha + file paths. For working rules see `docs/RULES.md`. For current state see `docs/STATUS.md`. For per-flow audit detail see `docs/AUDIT_*.md`.

## Pre-launch must-do (D-08 gate)

- **V-06 persona regression** — operational test on real device. Customer → staff (kitchen + packing) → driver → hub-op → branch-admin walkthrough. Covers everything Jest mocks can't (push tokens, Razorpay sandbox, cron-fired sub dispatches landing in staff UI).
- **Flag flip SQL** — once V-06 green, run `UPDATE feature_flags SET flag_value = TRUE WHERE flag_key = 'branch_management_active';`. I can run it on say-so.
- **FT-08 UX punch list** — reorder menu items + small UX tweaks. Awaiting your list. Will land before next AAB.

## Could close today — EOD candidates (one-liners, sorted by effort)

- **F7.2** *(20 min, code)* — `dormant-user-check` reads `push_logs` to honor its own "won't double-send" weekly cadence promise. Currently a 30+ day dormant user gets a push every Monday.
- **F3.X** *(10 min, decision)* — cross-midnight cycle after-cutoff scenario semantics. Pick (a) block / (b) place for day N+2 / (c) place for tomorrow anyway. Today's 4 prod cycles are all same-day so this is latent; freezing the decision protects against future cycle reconfig.
- **F4.5** *(15 min, decision)* — should offline-replayed status mutations also fire customer push when they drain? Pick yes / no / time-bounded. Today: no push fires for offline replays.
- **F5.1** *(1 session, code)* — `assign_driver_to_zone` / `assign_driver_to_hub` atomic RPCs mirroring `assign_hub_operator`. Plus row-scoped RLS update policy keyed on `driver_user_id`. Defense in depth.

## Post-launch / no-action

- **F4.4** — offline queue order-of-failure can cause status skips. Bounded by retry cap.
- **F6.1** — `notification_templates` not branch-scoped. Multi-branch concern only.
- **F6.2** — `referrals_self` admin clause is `is_admin()` only. **Documented intentional.**
- **MF-06** — Staging Supabase project. Needs you to create the project in the dashboard.
- **FT-04** — Branches Manage admin screen. Self-service post-launch.
- **FT-05** — Super-admin marker migration (`profiles.is_super_admin BOOLEAN`).
- **FT-06** — Super-admin TOTP 2FA. Parked.
- **Master Document v1.1 refresh** — text-only against post-2026-05-02 reality.
- **Scheduled push multi-branch spot-check** — once branch 2 exists, ~30 min.

## Done — closed today (2026-05-11)

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
