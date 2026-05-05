# 1stOne F1 — Open task ledger

> What's open. One line per item. Detailed write-ups live in `docs/HISTORY.md` (after ship) or per-feature audit docs (e.g., `docs/MF-03_multi_branch_audit.md`). For working rules see `docs/RULES.md`. For current state see `docs/STATUS.md`.

> **Lifecycle:** items open here. When shipped, the entry graduates to `docs/HISTORY.md` as a one-paragraph dated entry with file paths and commit sha.

## Pre-launch blockers (D-08)

- **MF-03 Class A** — RLS branch_id scoping. Roughly 15-20 staff-and-admin policies need a `branch_id = jwt_branch_id()` clause with `is_admin()` override. Single dedicated PR. Largest piece of MF-03 still open.
- **MF-03 Class C** — `complete_onboarding_atomic` and `handle_new_user` write NULL branch_id. Architectural call needed: trigger writes NULL + onboarding fills from address (Cowork recommendation), or trigger defaults to 1 + onboarding overwrites. Awaits Shrikanth's decision.
- **MF-03 punch list items 12-14** — `staff_attendance` INSERT branch_id, `useSubscriptionReport` + `useSubscriptionPlanReport` branch filter, one-time NULL→1 backfill prerequisite for the flag flip.
- **MF-03 punch list items 15-25** — verification queue (mostly NEEDS VERIFY items).

## Today's verification queue

- **V-01** — admin cancellation prorated refund spot-check on partially-consumed test sub.
- **V-04** — late-day subscription generates next-morning delivery via 06:00 IST breakfast cycle tick (post-CL-02).
- **V-06** — end-to-end persona regression. Launch go/no-go.
- **MF-05 + BF-18 cross-device verification** — real Android device, customer cancel cross-screen flip + login-OTP unified screen flow.

## Post-V-06 foundation work (D-07 mode 2)

- **MF-06** — Staging Supabase project. Mirror schema + RLS + seeds; deploy SQL + Edge Functions to staging first, prod second.
- **MF-07** — Automated test coverage + pre-push gate. Backfill Jest coverage on Edge Functions, RPCs, hook business logic; add pre-push hook (or CI).
- **MF-08** — Source-of-truth audit. Capture production-only tables (`supply_catalog`, `staff_order_requests`, `supply_order_items`, `supply_batches`) and trigger functions (`handle_new_user`, `on_auth_user_created`, `handle_first_order_referral_bonus`, `trg_first_order_referral_bonus`) into tracked SQL. Re-run `supabase gen types typescript`.

## Fine-tune backlog (D-07 mode 3)

> Systematic per-flow population begins after V-06 passes. One-off captures may land before then.

- **FT-01** — `eas.json serviceAccountKeyPath` cleanup + Play Console service account. Trigger: before first public production submission.

## Open architectural decisions

- **MF-03 Class C trigger semantics** — see pre-launch blockers above.

## Documentation

- **Master Document v1.1 update** — refresh against post-2026-05-02 reality (RLS now enabled, subscription billing model D-01, generate_daily_manifest rewrites, BF-19 dispatch financials, post-CL cleanups, current Edge Function list of 12). Queued for end-of-day or tomorrow.
- **CL-09** — `DEPLOY_SQL_ORDER.md` §4 RLS section + `schema.sql` line 5 comment drift. Edits drafted on disk; ride along with next reorg-completion commit.
