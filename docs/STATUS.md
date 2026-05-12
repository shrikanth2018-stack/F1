# 1stOne F1 — Status

> Where we are right now. Updated end-of-day or whenever state shifts. For working rules see `docs/RULES.md`. For history see `docs/HISTORY.md`. For open task ledger see `docs/DECISIONS.md`. For per-flow audit detail see `docs/AUDIT_*.md`.

## As of 2026-05-12 (end-of-day; address phone + hub history + customer export + Manage restructure)

End-of-day push consolidated into a single session-end commit. Morning closed BF-43..49 (realtime auth attach + Hermes Date trap fixes) as discrete commits earlier in the day. Per-fix breakdown in `docs/HISTORY.md`.

**Working tree:** clean (modulo `docs/RULES.md` plus a few untracked docs files that pre-existed at session start — left unstaged on purpose).

**Latest commits (HEAD-ward):**
- `6b4da96` feat(session 2026-05-12 EOD): address phone column + Customer Export + Hub History + Manage restructure + import correctness + icon refresh
- `5d5376a` fix(BF-49): centralize realtime auth attach + Hermes-safe rollover
- `95bdc1e` fix(BF-48): non-blocking push-token cleanup on signOut
- `59341ae` fix(BF-45): normalize feature_flags keys to canonical _active naming
- `7589da3` fix(BF-43..47): hub-op order visibility + realtime publication + driver dash realtime + RLS leak closure
- `6d9bdfb` fix(FT-08): LoginScreen — single non-scrolling flex, dots always visible
- `f58a4ab` fix(BF-40 + BF-41) + docs: close F7.2, F3.X, F4.5, F5.1 — 8 deferred → 4
- `5de0de5` fix(BF-39) + chore(MF-08): close F1.5 + capture production-only objects into tracked SQL

**App version on disk:** `1.3.0`. versionCode managed remotely by EAS (`eas.json` → `appVersionSource: remote` + `production.autoIncrement: true`).

**Internal Testing build status:** EAS Android production build kicked off at session end. Build ID `7a948ef0-488d-49cc-bb2c-3f441718fe31`, versionCode 13, status "in queue" at end-of-day. When green: `eas submit --platform android --latest` pushes the AAB to Play Console Internal Testing (track configured in `eas.json` → `submit.production.android.track: internal`).

**Test suite:** 309 tests across 19 suites; tsc clean.

## Live data state on Supabase

**Cron jobs (per `cron.job` query — all active):**
- `kitchen-cutoff-push-tick` — every minute. Per-cycle order generation.
- `dormant-user-check` — Mondays 04:30 UTC.
- `low-wallet-check` — daily 04:00 UTC.
- `subscription-expiry-push` — daily 03:30 UTC.
- `expire-idempotency-keys` — hourly.

**Edge Functions deployed (12):** apply-referral, cancel-order, confirm-order, confirm-topup, dormant-user-check, elevate-employee, low-wallet-check, place-order, send-push, subscription-expiry-push, verify-payment, wallet-topup. **No edge function changes today.**

**RLS:** enabled in dev + prod. **`feature_flags.branch_management_active` is TRUE on prod** — multi-branch RLS is active. Discovered during today's import-flow audit. Made the import branch_id fix launch-gate-critical, not future-proofing. MF-03 Classes A / B / C confirmed closed (Tier 1 Flow 6 audit, 2026-05-11).

**Production DB SQL deploys today (2026-05-12):**
- `ALTER TABLE customer_addresses ADD COLUMN phone_number TEXT` — new tracked migration `supabase/sql/add_customer_addresses_phone_number.sql`. Backfilled all 6 existing rows from owner profile.
- `complete_onboarding_atomic` RPC — INSERT into customer_addresses now includes phone_number (mirrors `p_phone_number` argument). Updated in `supabase/sql/complete_onboarding.sql`.
- One-off data cleanup: orders, order_items, order_item_ratings, cancelled_subscription_days, user_subscriptions, wallet_transactions, pending_wallet_topups, loyalty_redemptions, idempotency_keys, supply_order_items + supply_batches + staff_order_requests, staff_attendance + staff_leaves + staff_salary, expense_claims, app_feedback, push_logs + kitchen_push_log + manifest_run_log. All cleared.
- One-off update: all profiles → `wallet_balance = 2000`, `loyalty_points = 0`.
- One-off seed: 5 sample orders (IDs 10379–10383) for customer 555 / dispatch_date 2026-05-12. Mix of statuses, 4 hub-routed (hub 19), 1 zone-direct.

**Outstanding one-off SQL:** none.

## Persona / test phone roster

All OTPs are `123456`.

| Phone | Role | Notes |
|---|---|---|
| `777` | super-admin | role=`admin` + `branch_id IS NULL`. Sees all branches; flips global feature flags. |
| `888` | branch-1 admin | role=`admin` + `branch_id = 1`. Use to test branch isolation against `777`. |
| `666` | staff | Kitchen / packing staff. |
| `555` | customer | Plain customer. Owns the 5 sample orders 10379–10383 for today's dispatch. Default address has `phone_number=915555555555` (backfilled). |
| `444` | hub operator | role=`customer` + `assigned_hub_id = 19`. |
| `333` | staff + driver | role=`staff` + driver of Zone 1 AND Hub 1. |
| `999`, `11111`, `22222`, `33333`, `999999` | unused | Reserved test phones. |

**Active subscriptions:** none today (all cleared during session-start cleanup; will repopulate as customers re-subscribe during smoke testing).

**customer_addresses state:** 6 rows total, all with `phone_number` populated post-backfill. Customer 555 has address #2 (Sirsi Road, hub=19, zone=2, default) + address #6 (Avaraguppa, zone=2, hub_id=NULL = zone-direct).

**Sample orders for smoke-test (IDs 10379–10383):**

| ID | Type | Status | Route | Items |
|---|---|---|---|---|
| 10379 | food | Preparing | hub 19 | Idli Vada Combo + Masala Dosa |
| 10380 | food | Ready | hub 19 | Bisi Bele Bath |
| 10381 | food | Dispatched | hub 19 | Curd Rice Meal |
| 10382 | essential | Dispatched | hub 19 | Full Cream Milk 1L ×2 |
| 10383 | food | On the Way | zone-direct | Chapati Sagu |

Note: 10379/10380 may have advanced past Preparing/Ready during the session if Shrikanth tapped through them on the test phone — DB live state always wins over this snapshot.

## Today's queue (2026-05-12)

All shipped this session:

1. ✅ DB history cleanup (orders, subs, transactions, staff records, logs, app_feedback). Wallets reset to ₹2000.
2. ✅ Order-row icons swapped to flat PNG circles on staff Packing + driver + hub + admin-live.
3. ✅ Sample-order backfill (5 orders) for visual smoke-testing.
4. ✅ BF: orders queries join `profiles(phone_number)` — call icon resolves customer phone.
5. ✅ FT: `customer_addresses.phone_number` column + AddAddress prefill + Edit-address dual-mode screen.
6. ✅ BF + FT: import flow correctness pass — plural/singular plan_type, surfaced skip reasons, branch_id on insert.
7. ✅ FT: admin Customer Export screen (super-admin only).
8. ✅ FT: hub-op order history tab + minimal HubOrderHistoryDetail screen.
9. ✅ MF: Manage tab restructure — Storm Mode → Feature Flags; Manage Branches + Export Customers → Operations Manager super-admin section.
10. ✅ EOD pipeline (309/309 tests, tsc clean), commit `6b4da96`, EAS production build kicked off.
11. ⏳ `eas submit --platform android --latest` to Play Console Internal Testing — pending green build.

## Pending tomorrow

1. **Smoke-test the new AAB on test phones** once it's installed via Internal Testing. Surface to check:
   - Icons render clean (no halo / no checkerboard background) on Packing / Driver / Hub / Admin-Live rows.
   - Call icon dials per-address phone (verify with 444 → My Hub → tap Call on a hub-19 order).
   - AddAddressScreen shows prefilled "Phone for delivery (10 digits)" field, editable, required.
   - Edit on AddressesScreen prefills all fields, saves back without losing `is_default`.
   - Customer Export (super-admin 777 → Manage → Operations Manager → Super-Admin section → Export Customers) downloads CSV with selected columns; row count matches filter.
   - Hub History tab (444 → My Hub → History) shows the 4 hub-19 orders, tap → minimal detail screen with no action buttons.
   - Storm Mode now under Feature Flags' EMERGENCY section (not Operations Manager).
   - Operations Manager → Super-Admin section visible only to 777.
2. **Push notification testing** — postponed from 2026-05-12 morning. Today's AAB is the proper test surface (last night's was older).
3. **`profiles.branch_id` FK** — adjacent gap flagged today. `customer_addresses.branch_id` has the FK; `profiles.branch_id` does not. One-line ALTER once verified no orphan rows. Future MF-08-style cleanup; not blocking.

## Pre-launch blockers (D-08 launch gate)

- **V-06 persona regression** — combine with smoke-test of today's AAB.
- **Flag flip SQL** — **already done.** `branch_management_active = TRUE` on prod. Discovered live during today's import-flow audit. No action remaining here.

**MF-03 (Classes A / B / C + punch list 12-14) fully closed.**

## Long-term memory saved

Loads automatically in future sessions at `~/.claude/projects/-Users-shrikanthhegde-Documents-F1-1stOne-F1/memory/`:
- `feedback_long_term_stability_bias.md` — for 1stOne F1, lean foundational over minimum-diff; Shrikanth's attention shifts post-launch and silent integrity bugs compound when nobody's watching.
- `project_f21_subscription_semantics.md` — F2.1 → option (a). Generation gated on `days_consumed`; pause/skip/cron-outage extend the effective end date.
- `feedback_flag_adjacent_patterns.md` — on bug fixes that touch a thin / awkward data model, flag the standard durable pattern in one line. Shrikanth scope-expands if right. Validated 2026-05-12 (the address-owns-phone foundation sprang from a passing comment during the BF call-icon fix).
