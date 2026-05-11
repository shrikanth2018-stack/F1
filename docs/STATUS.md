# 1stOne F1 — Status

> Where we are right now. Updated end-of-day or whenever state shifts. For working rules see `docs/RULES.md`. For history see `docs/HISTORY.md`. For open task ledger see `docs/DECISIONS.md`.

## As of 2026-05-11 evening

**Last checkpoint:** 2026-05-06 (v1.2.1 hotfix day; AAB submitted). Five-day gap; Shrikanth intended to resume 2026-05-07 but couldn't. Resumed today.

**Working tree:** clean after this commit.

**Latest commits (HEAD-ward):**
- `<this commit>` docs: day-end checkpoint 2026-05-11 + Tier 1 audit kickoff
- `10aa5fd` fix(BF-31): exclude sub-purchase from staff lists + normalize sub-dispatch order_type
- `9ffae33` fix(BF-29 + BF-30): v1.2.1 hotfixes — login keypad, RLS gaps, address default invariant
- `1ab5283` docs: tighten SESSION_START + RULES (single-seat default, plan-level approval)
- `07297c1` chore: bump version 1.1.0 → 1.2.0 for multi-branch foundation release

**App version on disk:** 1.2.1 (build code 11). Submitted to Play Console Internal Testing 2026-05-06; confirmed working by Shrikanth. No fresh build needed yet — BF-31 is server-side (SQL) + a hook tweak; ship with the next scheduled build.

**Internal Testing build status:** DELIVERED (v1.2.1, code 11). Awaiting next functional milestone before cutting code 12.

## Live data state on Supabase

**Cron jobs (per `cron.job` query):**
- `kitchen-cutoff-push-tick` — every minute. Per-cycle order generation. Canonical path. **Confirmed firing again 2026-05-11 after DB pause.**
- `dormant-user-check` — Mondays 04:30 UTC. Notification only.
- `low-wallet-check` — daily 04:00 UTC. Notification only.
- `subscription-expiry-push` — daily 03:30 UTC. Notification only.

**Edge Functions deployed (12):** apply-referral, cancel-order, confirm-order, confirm-topup, dormant-user-check, elevate-employee, low-wallet-check, place-order, send-push, subscription-expiry-push, verify-payment, wallet-topup.

**RLS:** enabled in dev + prod. Three write-gap holes closed 2026-05-06 via BF-29 + BF-30 (admin / staff / hub). Branch-scoping on staff/admin policies tightened via MF-03 Commit 4 (2026-05-05). MF-03 Class A (final RLS pass for ~15-20 remaining branch-scoping clauses) still open.

**Recent SQL deploys:**
- `generate_daily_manifest()` CREATE OR REPLACE — BF-31 (today). Normalizes plural plan_type → singular order_type at insert.

**Outstanding one-off SQL:** none today.

## Persona / test phone roster

All OTPs are `123456`.

| Phone | Role | Notes |
|---|---|---|
| `777` | super-admin | role=`admin` + `branch_id IS NULL` (sees all branches; flips global feature flags). |
| `888` | branch-1 admin | role=`admin` + `branch_id = 1`. Use to test branch isolation against `777`. |
| `666` | staff | Kitchen / packing staff. |
| `555` | customer | Plain customer. |
| `444` | hub operator | role=`customer` + `assigned_hub_id = 19`. |
| `333` | staff + driver | role=`staff` + driver of Zone 1 AND Hub 1. |
| `999`, `11111`, `22222`, `33333`, `999999` | unused | Reserved test phones. |

## Today's queue (2026-05-11)

1. **Tier 1 audit — Flow 1 (Payments + Wallet)** — kicks off after this commit.
2. Future Tier 1 flows queued in `docs/DECISIONS.md` audit ladder.

## Pre-launch blockers (D-08 launch gate)

- **MF-03 Class A** — final RLS branch_id scoping pass (~15-20 policies, single dedicated PR).
- **MF-03 Class C** — customer onboarding branch_id (architectural call pending Shrikanth's confirmation — trigger writes NULL, onboarding fills from address).
- **MF-03 punch list items 12-14** — `staff_attendance` INSERT, two report hooks unfiltered, one-time NULL→1 backfill prerequisite for the flag flip.
- **MF-03 punch list items 15-25** — verification queue (mostly NEEDS VERIFY).
- **V-06 persona regression** — end-to-end go/no-go. Will fold into Tier 1 audit findings.

Post-launch (not blockers): MF-06 staging Supabase project, MF-07 broader Jest test coverage (Tier 2), MF-08 source-of-truth audit remaining items, FT-04, FT-05.
