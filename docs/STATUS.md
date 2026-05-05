# 1stOne F1 — Status

> Where we are right now. Updated end-of-day or whenever state shifts. For working rules see `docs/RULES.md`. For history see `docs/HISTORY.md`. For open task ledger see `docs/DECISIONS.md`.

## As of 2026-05-05 morning

**Last checkpoint:** 2026-05-04 evening — sixteen-commit day. See `docs/HISTORY.md` for the day's commits.

**Working tree:** clean except for ongoing doc reorg (this commit).

**Latest commits (HEAD-ward):**
- `9106227` chore: bump version to 1.1.0 for internal testing release
- `c8837d6` docs: day-end checkpoint 2026-05-04
- `549e98d` docs(MF-03): capture useAdminNotes Class B nuance + stranded-NULL backfill caveat
- `c1ce0ab` fix(MF-03 audit + Class B, D-08): multi-branch readiness audit + write-defaults fix
- `f0065f9` feat(MF-02, D-08): branch picker on OnboardEmployeeScreen for multi-branch readiness

**App version on disk:** 1.1.0 (bumped last night ahead of EAS preview build for Play Console Internal Testing track).

**Internal Testing build status:** PENDING — version bump committed last night, but the EAS build itself was not run. CC's morning sequence runs it first thing. (Priority #1 for today.)

## Live data state on Supabase

**Cron jobs (per `cron.job` query):**
- `kitchen-cutoff-push-tick` — every minute. Per-cycle order generation. Canonical path.
- `dormant-user-check` — Mondays 04:30 UTC. Notification only.
- `low-wallet-check` — daily 04:00 UTC. Notification only.
- `subscription-expiry-push` — daily 03:30 UTC. Notification only.
- `generate-daily-manifest` — REMOVED 2026-05-04 (CL-02). Per-cycle tick is canonical; nightly safety-net is gone.

**Edge Functions deployed (12):** apply-referral, cancel-order, confirm-order, confirm-topup, dormant-user-check, elevate-employee, low-wallet-check, place-order, send-push, subscription-expiry-push, verify-payment, wallet-topup. (`confirm-order-payment` and `razorpay-webhook` deleted in CL-03 / CL-04.)

**RLS:** enabled in dev + prod. Branch-scoping clauses missing on every staff-and-admin policy (MF-03 Class A — pre-launch fix item).

**Recent SQL deploys (today's session arc — 2026-05-04):**
- `cron.unschedule('generate-daily-manifest')` — CL-02.
- `add_supply_catalog_staff_read_policy.sql` — BF-14.
- `add_staff_order_requests_policies.sql` — BF-15.
- `staff_order_requests_mirror_trigger.sql` (incl. `add_or_merge_supply_order_item` RPC) — BF-17.
- `generate_daily_manifest()` rewrite + historical UPDATE migration zeroing dispatch financial fields — BF-19.
- `admin_cancel_subscription_atomic_rpc.sql` — BF-20.

**Outstanding one-off SQL:** manual backfill `UPDATE profiles SET branch_id = 1 WHERE phone_number = '913333333333' AND branch_id IS NULL;` — pending if not already run.

## Persona / test phone roster

All OTPs are `123456`.

| Phone | Role | Notes |
|---|---|---|
| `777` | super-admin | role=`admin` + `branch_id IS NULL` (sees all branches; can flip global feature flags). |
| `888` | branch-1 admin | role=`admin` + `branch_id = 1`. Promoted via MF-03 Commit 5 SQL after first OTP sign-in. Use to test branch isolation against `777`. |
| `666` | staff | Kitchen / packing staff. |
| `555` | customer | Plain customer. |
| `444` | hub operator | role=`customer` + `assigned_hub_id = 19`. Demoted via one-off SQL 2026-05-03 (MF-01). |
| `333` | staff + driver | role=`staff` + driver of Zone 1 AND Hub 1. |
| `999`, `11111`, `22222`, `33333`, `999999` | unused | Reserved test phones. |

## Today's queue (2026-05-05)

1. **Confirm CC executed the build + report status.** Internal Testing track per FT-01 manual workaround.
2. **V-06** — end-to-end persona regression. Launch go/no-go.
3. **V-04** — overnight subscription verification (06:00 IST breakfast cycle picks up late-day sub).
4. **V-01** — admin proration spot-check (5/30 days consumed → ~83% refund).
5. **MF-05 + BF-18 cross-device verification** on real Android device (post Internal Testing build).
6. **Part 3** — DECISIONS.md scope reform + branch implementation Stage 1 architectural calls. *(In progress — this commit closes the doc reorg piece. MF-03 Class C trigger semantics still awaits Shrikanth's call.)*

## Pre-launch blockers (D-08 launch gate)

- **MF-03 Class A** — RLS branch_id scoping (~15-20 policies, single dedicated PR).
- **MF-03 Class C** — customer onboarding branch_id (architectural call needed: trigger writes NULL, onboarding fills from address — Cowork recommendation pending Shrikanth's confirmation).
- **MF-03 punch list items 12-14** — `staff_attendance` INSERT, two report hooks unfiltered, one-time NULL→1 backfill prerequisite for the flag flip.
- **MF-03 punch list items 15-25** — verification queue (mostly NEEDS VERIFY).

Post-V-06 (not launch blockers): MF-06 staging, MF-07 test coverage, MF-08 source-of-truth audit.
