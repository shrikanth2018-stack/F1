# 1stOne F1 — Status

> Where we are right now. Updated end-of-day or whenever state shifts. For working rules see `docs/RULES.md`. For history see `docs/HISTORY.md`. For open task ledger see `docs/DECISIONS.md`. For launch tracking see `docs/LAUNCH_CHECKLIST.md`.

## As of 2026-05-14 (end-of-day; brand-icon refresh + UX session + master document)

Single bundled session-end commit. Day's work flowed: notification icon + brand-mark refresh → customer profile menu restructure → LoginScreen footer cleanup → PlansScreen UX overhaul → PlanDetail polish → infra cleanup (12 Edge fns redeploy + `profiles.branch_id` FK applied to prod) → `docs/master/` skeleton + content fill for all 19 files → EAS production build (v1.3.0 versionCode 16).

**Working tree:** clean after commit.

**Latest commits (HEAD-ward):**
- `<new>` feat(session 2026-05-14 EOD): brand icons + profile menus + PlansScreen UX + PlanDetail + LoginScreen footer + profiles.branch_id FK + master doc + LAUNCH_CHECKLIST + FT-08 closed
- `0be27ab` fix: 2 push-notification regressions found during 2026-05-13 testing
- `6fedd73` docs: strip pointer references to files moved into _marked_for_deletion/
- `8c457f4` chore(session 2026-05-13): doc trim + FCM V1 setup + cleanup batch
- `55080b6` docs: 2026-05-12 EOD checkpoint — STATUS refresh + HISTORY entry
- `6b4da96` feat(session 2026-05-12 EOD): address phone column + Customer Export + Hub History + Manage restructure + import correctness + icon refresh

**App version on disk:** `1.3.0` (`app.config.js:37`). `package.json` declares stale `1.2.1` (Expo build uses `app.config.js`, not `package.json` — unaffected; sync if/when convenient).

**Internal Testing build status:** EAS production build green at session end. Build ID `bd7acb8e-5187-4e14-b153-86852dcfe1ac`, v1.3.0 versionCode 16. AAB ready at `https://expo.dev/artifacts/eas/pp54du2MTM2CeMEXAaJjBo.aab`. Manual Play Console upload pending (Shrikanth doing manually; service-account JSON still off disk).

**Test suite:** 309 / 309 across 19 suites; tsc clean.

## Live data state on Supabase

**Edge Functions:** all 12 redeployed 2026-05-14 — `apply-referral`, `cancel-order`, `confirm-order`, `confirm-topup`, `dormant-user-check`, `elevate-employee`, `low-wallet-check`, `place-order`, `send-push`, `subscription-expiry-push`, `verify-payment`, `wallet-topup`. HEAD === prod.

**Cron jobs (per `cron.job` query — all active):**
- `kitchen-cutoff-push-tick` — every minute. Verified firing within ±50ms of configured times (Breakfast 23:40, Lunch 11:10, Snacks 15:10, Dinner 18:10 UTC offset).
- `dormant-user-check` — Mondays 04:30 UTC.
- `low-wallet-check` — daily 04:00 UTC.
- `subscription-expiry-push` — daily 03:30 UTC.
- `expire-idempotency-keys` — hourly.

**RLS:** enabled in prod. **`feature_flags.branch_management_active = TRUE`**. **`feature_flags.essentials_module_active`, `hub_delivery_active`, `referral_system` = TRUE**. **`storm_mode_active` = FALSE**.

**Production DB SQL deploys today (2026-05-14):**
- `ALTER TABLE profiles ADD CONSTRAINT profiles_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id)` — new tracked migration `supabase/sql/add_profiles_branch_id_fk.sql`. Orphan check pre-flight returned zero rows.

**Outstanding one-off SQL:** none.

## Persona / test phone roster

All OTPs are `123456`.

| Phone | Role | Notes |
|---|---|---|
| `777` | super-admin | role=`admin` + `branch_id IS NULL`. Sees all branches; flips global feature flags. |
| `888` | branch-1 admin | role=`admin` + `branch_id = 1`. Use to test branch isolation against `777`. |
| `666` | staff | Kitchen / packing staff. |
| `555` | customer | Plain customer. Wallet ₹2000. |
| `444` | hub operator | role=`customer` + `assigned_hub_id = 19`. |
| `333` | staff + driver | role=`staff` + driver of Zone 1 AND Hub 1. |
| `999`, `11111`, `22222`, `33333`, `999999` | unused | Reserved test phones. |

**Active subscriptions:** none. **Live counts:** 1 branch, 1 hub, 1 zone, 4 cycles, 12 menu items, 6 essentials, 11 plans, 15 notification templates, 5 customer profiles. **43 public tables, 38 RPCs, ~80 RLS policies, 26 triggers.**

## Today's queue (2026-05-14)

All shipped this session:

1. ✅ App icon + Android adaptive icon + notification small-icon refresh from new brand mark.
2. ✅ Android push channel config: `lightColor: #38bdf8` + `sound: default`.
3. ✅ Staff profile popup: Close removed, Sign Out center-aligned.
4. ✅ Customer profile menu restructure: My Referrals rename + Loyalty/Referrals group split + FAQ row + Help & Support relabel + reorder + Privacy | Terms centered legal row.
5. ✅ LoginScreen footer simplified (two-line "&" wording).
6. ✅ PlansScreen UX overhaul (sliding pill toggle, dispatch labels, leading Ionicons, GradientSep, BUY → mint `›`-circle, floating Back pill with `navigation.goBack()`, subtext removed).
7. ✅ PlanDetail: "You Save" InfoRow (large variant) + section reorder (Included → Starting Date).
8. ✅ `profiles.branch_id` FK applied to prod + tracked migration committed.
9. ✅ All 12 Edge functions redeployed (HEAD === prod parity).
10. ✅ Sentry user-context attach confirmed already live in `useAuth.ts:138-144`.
11. ✅ FT-08 marked closed (absorbed by today's UX work).
12. ✅ `docs/LAUNCH_CHECKLIST.md` created — single-page launch tracker.
13. ✅ `docs/master/` (gitignored) skeleton + content fill for all 19 files. Compiled `.docx` via `scripts/build-master-docx.sh`.
14. ✅ EOD pipeline (309/309 tests, tsc clean), single bundled commit.
15. ✅ EAS Android production build green — v1.3.0 versionCode 16.
16. ⏳ Manual Play Console upload pending (Shrikanth).

## Pending tomorrow

1. **Manual Play Console upload + Internal Testing rollout** of the v1.3.0(16) AAB.
2. **Real-device smoke-test** once installed on tester phones — UI changes listed in LAUNCH_CHECKLIST.md.
3. **Push verification on the new AAB:**
   - BF-50 (Kitchen-tab Mark-Ready push, requires the new AAB)
   - BF-51 (hub-op delivered push device-side display)
   - wallet.topped_up, order.razorpay_confirmed, subscription.activated (Razorpay test flows)
   - subscription.starting_tomorrow / ending_1d / ending_2d / wallet.low_balance / winback.dormant (cron-fired or manually invoked)
4. **V-06 persona regression** — full real-device walkthrough across customer / staff (Kitchen + Packing) / driver / hub-op / branch admin. Last D-08 hard launch gate.
5. **Launch-side paperwork track** (parallel, non-blocking on code): Apple Developer enrollment, FSSAI/GST/DLT-template steps from LAUNCH_CHECKLIST.md.

## Pre-launch blockers (D-08 launch gate)

- **V-06 persona regression** — last hard gate; needs the new AAB on real phones.
- **MF-03 (Classes A / B / C + punch list 12-14) fully closed.**
- **`branch_management_active = TRUE`** — already live on prod (since 2026-05-12).
- **`profiles.branch_id` FK** — applied today.
- **FT-08** — closed today (absorbed by UX session).

## Long-term memory saved

Loads automatically in future sessions at `~/.claude/projects/-Users-shrikanthhegde-Documents-F1-1stOne-F1/memory/`:
- `feedback_long_term_stability_bias.md` — lean foundational over minimum-diff.
- `project_f21_subscription_semantics.md` — F2.1 → option (a). Generation gated on `days_consumed`.
- `feedback_flag_adjacent_patterns.md` — flag standard durable patterns in one line on bug fixes.

## Master document (off-repo)

A board / investor master document was built today in `docs/master/` (whole directory is `.gitignore`d for sensitivity reasons). 19 source markdown files + a compiled single `.docx` (~87 KB). Audience: board / investor. Sourced exclusively from code + Supabase + installed app (no working docs consulted). Rebuild any time with `bash scripts/build-master-docx.sh` (scripts/ also gitignored). Distribute the `.docx` selectively.
