# 1stOne F1 — Open task ledger

> What's open. One line per item. Detailed write-ups live in `docs/HISTORY.md` (after ship) or per-feature audit docs (e.g., `docs/MF-03_multi_branch_audit.md`). For working rules see `docs/RULES.md`. For current state see `docs/STATUS.md`.

> **Lifecycle:** items open here. When shipped, the entry graduates to `docs/HISTORY.md` as a one-paragraph dated entry with file paths and commit sha.

## Pre-launch blockers (D-08)

- **V-06 persona regression** — only code-level launch blocker remaining. Operational test.
- **Flag flip** — last D-08 gate. `UPDATE feature_flags SET flag_value = TRUE WHERE flag_key = 'branch_management_active';` once V-06 passes.

**MF-03 (Classes A / B / C + punch list 12-14) closed 2026-05-11 via Tier 1 Flow 6 audit verification.** Code-level work shipped via 2026-05-05 Commits 1-5; today's audit confirmed live state matches. See `docs/AUDIT_admin_actions.md`. Two intentional gaps remain (F6.1 notification_templates not branch-scoped — defer to multi-branch launch; F6.2 referrals_self admin clause is is_admin() only — documented intentional).

## Tier 1 audit ladder (in progress)

Method: read-only per-flow audit → cross-check prod DB → match/gap matrix vs spec → immediate fixes for findings → per-flow audit doc in `docs/AUDIT_<flow>.md`. One flow per session, priority-ordered.

- ✅ **Flow 0 — Order generation + listing** — closed 2026-05-11 via BF-31.
- ✅ **Flow 1 — Payments + wallet** — closed 2026-05-11 via BF-32. 3 deferred (F1.3 client idempotency header, F1.4 cleanup cron schedule, F1.5 cancel-refund admin signal).
- ✅ **Flow 2 — Subscription lifecycle** — closed 2026-05-11 via BF-33. Spec D-01 (pause/skip extends duration) now matched in code.
- ✅ **Flow 3 — One-off order lifecycle** — closed 2026-05-11 via BF-34. 2 deferred (F3.X cross-midnight cycle semantics, F3.Y kitchen_push_time +10min config).
- ✅ **Flow 4 — Staff operations** — closed 2026-05-11 via BF-35. Push fan-out single-sourced via app code; admin templates honored. 3 deferred (F4.3 useRealtimeOrders midnight, F4.4 offline-queue order-of-failure, F4.5 offline replays skip push).
- ✅ **Flow 5 — Driver + Hub delivery** — no code shipped; all paths validated in earlier flows. 2 deferred (F5.1 driver assignment lacks atomic RPC, F5.2 JWT refresh window for driver revocation).
- ✅ **Flow 6 — Admin / Super-admin actions + MF-03 closure** — no code shipped; MF-03 Classes A/B/C + punch list 12-14 confirmed already closed by 2026-05-05 commits. 2 deferred (F6.1 templates per-branch, F6.2 referrals branch-scope intentional).
- 🔜 **Flow 7 — Notifications + cron** — `kitchen_push`, dormant / wallet / expiry pushes, template fallbacks, push fan-out (largely already touched in Flow 4).
- ⏳ **Flow 8 — Auth + branch routing** — OTP → JWT claims → role split → branch picker → push token registration (F4.2 token registration belongs here).

## Verification queue

- **V-01** — admin cancellation prorated refund spot-check on partially-consumed test sub.
- **V-06** — end-to-end persona regression. Will fold into Tier 1 audit findings flow-by-flow.
- **MF-05 + BF-18 cross-device verification** — real Android device.

## Post-Tier-1 foundation work (D-07 mode 2)

- **MF-06** — Staging Supabase project. Mirror schema + RLS + seeds; deploy SQL + Edge Functions to staging first, prod second.
- **MF-07** — Tier 2 of testing plan: Jest backfill across Edge Functions, RPCs, hook business logic. **MF-07a (pre-push gate via husky) shipped 2026-05-05 commit `601a31b`.** MF-07 broader coverage opens after Tier 1 audit ladder closes.
- **MF-08** — Source-of-truth audit. **Partially closed 2026-05-05** (`handle_new_user` captured commit `f609e0b`, Supabase types regenerated commit `1781b80`). Still open: production-only tables (`supply_catalog`, `staff_order_requests`, `supply_order_items`, `supply_batches`) and the two referral triggers (`handle_first_order_referral_bonus`, `trg_first_order_referral_bonus`).

## Fine-tune backlog (D-07 mode 3)

> Systematic per-flow population begins after Tier 1 audit ladder closes. One-off captures may land before then.

- **FT-04** — Branches Manage admin screen. Currently no UI to add a branch row (super-admin uses raw SQL). Post-launch self-service.
- **FT-05** — Super-admin marker migration. Today the marker is `role='admin' AND branch_id IS NULL`; future migration: dedicated `profiles.is_super_admin BOOLEAN`.
- **FT-06 (deferred)** — Super-admin TOTP 2FA via Supabase native MFA. Parked — first-class on Supabase but not urgent for launch.
- **FT-08** — Pre-launch UX punch list. Placeholder — Shrikanth to send list (reorder menu items + a couple of UX tweaks). Logged here so we don't lose them; opens for execution after Tier 1 + Tier 2 close.

## Post-launch verification

- **Scheduled push functions multi-branch spot-check** — confirm `subscription-expiry-push`, `low-wallet-check`, `dormant-user-check` fire correctly per-customer once branch 2 exists. ~30 min check.

## Documentation

- **Master Document v1.1 update** — refresh against post-2026-05-02 reality (RLS branch scoping, D-01 subscription billing, generate_daily_manifest BF-19/BF-31 history, BF-29/BF-30 RLS closures, CL-* cleanups, current Edge Function list of 12, MF-03 multi-branch foundation).
