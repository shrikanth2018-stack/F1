# 1stOne F1 — Open task ledger

> What's open. One line per item. Detailed write-ups live in `docs/HISTORY.md` (after ship) or per-feature audit docs (e.g., `docs/MF-03_multi_branch_audit.md`). For working rules see `docs/RULES.md`. For current state see `docs/STATUS.md`.

> **Lifecycle:** items open here. When shipped, the entry graduates to `docs/HISTORY.md` as a one-paragraph dated entry with file paths and commit sha.

## Pre-launch blockers (D-08)

- **MF-03 Class A** — final RLS branch_id scoping pass on remaining staff + admin policies. Single dedicated PR.
- **MF-03 Class C** — customer onboarding branch_id architectural call (trigger NULL vs onboarding-fill-from-address). Pending Shrikanth confirmation.
- **MF-03 punch list items 12-14** — `staff_attendance` INSERT, two report hooks unfiltered, NULL→1 backfill prerequisite for flag flip.
- **MF-03 punch list items 15-25** — verification queue (mostly NEEDS VERIFY).
- **Flag flip** — last D-08 gate. `UPDATE feature_flags SET flag_value = TRUE WHERE flag_key = 'branch_management_active';` once V-06 passes.

## Tier 1 audit ladder (in progress)

Method: read-only per-flow audit → cross-check prod DB → match/gap matrix vs spec → immediate fixes for findings → per-flow audit doc in `docs/AUDIT_<flow>.md`. One flow per session, priority-ordered.

- ✅ **Flow 0 — Order generation + listing** — closed 2026-05-11 via BF-31 (`HISTORY.md`).
- 🔜 **Flow 1 — Payments + wallet** — Razorpay create/confirm/webhook, wallet atomicity, refunds, idempotency. Next up.
- ⏳ **Flow 2 — Subscription lifecycle** — buy, activate, pause/skip, cancel, prorated refund, expiry.
- ⏳ **Flow 3 — One-off order lifecycle** — place, confirm, cancel, status transitions, dispatch.
- ⏳ **Flow 4 — Staff operations** — kitchen aggregate, packing, offline queue, push wiring.
- ⏳ **Flow 5 — Driver + Hub delivery** — assignment, scoping, status advance.
- ⏳ **Flow 6 — Admin / Super-admin actions** — order/sub cancel, refund, feature flags, branch isolation (overlaps MF-03 Class A — closes both in this session).
- ⏳ **Flow 7 — Notifications + cron** — `kitchen_push`, dormant / wallet / expiry pushes, template fallbacks, send-push fan-out.
- ⏳ **Flow 8 — Auth + branch routing** — OTP → JWT claims → role split → branch picker.

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
