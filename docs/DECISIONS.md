# 1stOne F1 — Open task ledger

> What's open. One line per item. Detailed write-ups live in `docs/HISTORY.md` (after ship) or per-feature audit docs (e.g., `docs/MF-03_multi_branch_audit.md`). For working rules see `docs/RULES.md`. For current state see `docs/STATUS.md`.

> **Lifecycle:** items open here. When shipped, the entry graduates to `docs/HISTORY.md` as a one-paragraph dated entry with file paths and commit sha.

## Pre-launch blockers (D-08)

- **MF-03 punch list items 15-25** — verification queue. Today's session verified `777` super-admin + `888` branch-1 admin RLS isolation (feature_flags toggle blocked for non-super-admin); customer / staff persona regressions remain unverified.
- **Flag flip** — last D-08 gate. `UPDATE feature_flags SET flag_value = TRUE WHERE flag_key = 'branch_management_active';` once V-06 passes.

## Today's verification queue

- **V-01** — admin cancellation prorated refund spot-check on partially-consumed test sub.
- **V-04** — late-day subscription generates next-morning delivery via 06:00 IST breakfast cycle tick (post-CL-02).
- **V-06** — end-to-end persona regression. Launch go/no-go.
- **MF-05 + BF-18 cross-device verification** — real Android device, customer cancel cross-screen flip + login-OTP unified screen flow.

## Post-V-06 foundation work (D-07 mode 2)

- **MF-06** — Staging Supabase project. Mirror schema + RLS + seeds; deploy SQL + Edge Functions to staging first, prod second.
- **MF-07** — Automated test coverage + pre-push gate. Backfill Jest coverage on Edge Functions, RPCs, hook business logic; add pre-push hook (or CI).
- **MF-08** — Source-of-truth audit. **Partially closed 2026-05-05**: `handle_new_user` captured (commit `f609e0b`), Supabase types regenerated + `npm run supabase:gen-types` script added (commit `1781b80`). Still open: production-only tables (`supply_catalog`, `staff_order_requests`, `supply_order_items`, `supply_batches`) and the two referral triggers (`handle_first_order_referral_bonus`, `trg_first_order_referral_bonus`).

## Fine-tune backlog (D-07 mode 3)

> Systematic per-flow population begins after V-06 passes. One-off captures may land before then.

- **FT-01** — `eas.json serviceAccountKeyPath` cleanup + Play Console service account. Trigger: before first public production submission.
- **FT-04** — Branches Manage admin screen. Currently no UI to add a branch row (super-admin uses raw SQL via Supabase dashboard). Post-launch self-service.
- **FT-05** — Super-admin marker migration. Today the marker is `role='admin' AND branch_id IS NULL`; doubles as both "super-admin" and "data missing" sentinel (bit us in today's backfill where `777`'s NULL branch_id was clobbered to 1). Future migration: dedicated `profiles.is_super_admin BOOLEAN` column, decouples from branch_id.
- **FT-06 (deferred)** — Super-admin TOTP 2FA via Supabase native MFA. Parked per Shrikanth this session — first-class on Supabase but not urgent for launch.

## Post-launch verification

- **Scheduled push functions multi-branch spot-check** — confirm `subscription-expiry-push`, `low-wallet-check`, `dormant-user-check` fire correctly per-customer once branch 2 exists. ~30 min check. Audit verified the mechanism is right (functions iterate users and send to each); just hasn't been exercised across branches.

## Documentation

- **Master Document v1.1 update** — refresh against post-2026-05-02 reality (RLS now enabled with branch scoping, subscription billing model D-01, generate_daily_manifest rewrites, BF-19 dispatch financials, post-CL cleanups, current Edge Function list of 12, MF-03 multi-branch foundation).
- **CL-09** — `DEPLOY_SQL_ORDER.md` §4 RLS section + `schema.sql` line 5 comment drift. Edits drafted on disk; ride along with next reorg-completion commit.
- **End-of-day pass for 2026-05-05** — `docs/HISTORY.md` entry for today's MF-03 Commits 1-5 + FT-02a/b + FT-03 + iOS picker fixes (BF-22 through BF-26); `docs/STATUS.md` refresh of "Recent SQL deploys" + "Today's queue".
