# 1stOne F1 — Status

> Where we are right now. Updated end-of-day or whenever state shifts. For working rules see `docs/RULES.md`. For history see `docs/HISTORY.md`. For open task ledger see `docs/DECISIONS.md`. For per-flow audit detail see `docs/AUDIT_*.md`.

## As of 2026-05-11 (end-of-day; comprehensive Tier 1 + Tier 2 closure)

**Single biggest day this branch:** 17 commits, 8 BFs (BF-31 → BF-38), 109 new tests (191 → 300), 8 audit docs. Both Tier 1 audit ladder + Tier 2 Jest backfill closed. See `docs/HISTORY.md` entry for the full breakdown.

**Working tree:** clean.

**Latest commits (HEAD-ward):**
- `d5c0b90` test(MF-07 Tier 2 batch 3): useStaffOrders + useOrders hook coverage (289 → 300 tests)
- `35e3300` docs: Tier 2 closure — STATUS + DECISIONS updated for launch-ready state
- `49b7edd` fix(BF-38) + test(MF-07 Tier 2 batch 2): hook tests + idempotency-key wallet topup + midnight realtime rollover
- `84280cf` test(MF-07 Tier 2 batch 1): regression locks for delivery / packing / sub-purchase / sub math (191 → 275 tests)
- `326a017` docs: Tier 1 audit ladder closed — 8/8 flows shipped (BF-31 → BF-37)
- `6cc5c6b` fix(BF-37): Tier 1 Flow 8 — sync custom_access_token_hook with prod (is_driver claim restored to tracked file)
- `dcec18c` fix(BF-36): Tier 1 Flow 7 — low-wallet-check days_consumed + schedule idempotency cleanup cron
- `f752c2c` fix(BF-35): Tier 1 Flow 4 — push fan-out de-duplication + send-push typo + confirm-order activation push
- `032e816` fix(BF-34): Tier 1 Flow 3 — atomic admin order cancel + essentials packing first-hop
- `3711398` fix(BF-33, F2.1): subscription duration extends on pause/skip/cron-outage
- `2fca7d5` fix(BF-32): Tier 1 Flow 1 — confirm-path status + wallet-topup column fixes
- `10aa5fd` fix(BF-31): exclude sub-purchase from staff lists + normalize sub-dispatch order_type

**App version on disk:** 1.2.1 (versionCode 11). Submitted to Play Console Internal Testing 2026-05-06; confirmed working. **No fresh build cut yet for today's BF-31 → BF-38 + Tier 2 work** — code is deployed server-side (SQL + edge functions all live + verified), but the bundled mobile-app changes (hook fixes, UI relabels, test code) will ship in the next AAB after the UX punch list lands.

**Internal Testing build status:** DELIVERED (v1.2.1, code 11). Next cut planned after FT-08 UX punch list + V-06 green.

**Test suite:** 300 tests across 18 suites; tsc clean.

## Live data state on Supabase

**Cron jobs (per `cron.job` query — all active):**
- `kitchen-cutoff-push-tick` — every minute. Per-cycle order generation. Canonical path. Confirmed firing today after the ~5-day Supabase free-tier pause.
- `dormant-user-check` — Mondays 04:30 UTC.
- `low-wallet-check` — daily 04:00 UTC. Post-BF-36a uses days_consumed-based daysLeft.
- `subscription-expiry-push` — daily 03:30 UTC. Post-BF-33 uses days_consumed-based daysLeft.
- **`expire-idempotency-keys`** — hourly. New today via BF-36b (was declared in SQL but never scheduled).

**Edge Functions deployed (12):** apply-referral, cancel-order, confirm-order, confirm-topup, dormant-user-check, elevate-employee, low-wallet-check, place-order, send-push, subscription-expiry-push, verify-payment, wallet-topup. **Today's redeploys:** generate_daily_manifest (BF-31, BF-33, BF-35), subscription-expiry-push (BF-33), wallet-topup (BF-32b), low-wallet-check (BF-36a), send-push (BF-35a typo fix), confirm-order (BF-35b adds explicit push fan-out), custom_access_token_hook (BF-37 sync).

**RLS:** enabled in dev + prod. MF-03 Classes A / B / C confirmed closed via Flow 6 audit. Branch-scoping live on all staff/admin policies. Three exception cases documented in `docs/AUDIT_admin_actions.md` (referrals_self intentional; notification_templates global; super-admin-only tables — kitchen_push_log, manifest_run_log, referral_settings).

**Production DB SQL deploys today:**
- `generate_daily_manifest()` CREATE OR REPLACE (BF-31 normalization, BF-33 calendar-guard removal, BF-35b pg_net push).
- `mark_order_paid` body change inside `rpc_atomic_increments.sql` (BF-32a status='Confirmed').
- `admin_cancel_order_atomic` RPC CREATE OR REPLACE (BF-34a new).
- `DROP TRIGGER trg_order_status_push; DROP FUNCTION _notify_order_status_push();` (BF-35b dedup).
- `cron.schedule('expire-idempotency-keys', ...)` (BF-36b).
- `custom_access_token_hook` body update (BF-37 file ↔ prod sync).
- One-off backfill: `UPDATE orders SET status='Cancelled' WHERE id=350` (BF-34b smoking-gun cleanup).

**Outstanding one-off SQL:** none.

## Persona / test phone roster

All OTPs are `123456`.

| Phone | Role | Notes |
|---|---|---|
| `777` | super-admin | role=`admin` + `branch_id IS NULL` (sees all branches; flips global feature flags). |
| `888` | branch-1 admin | role=`admin` + `branch_id = 1`. Use to test branch isolation against `777`. |
| `666` | staff | Kitchen / packing staff. |
| `555` | customer | Plain customer. Has live sub 39 (Newspaper 30 Days). |
| `444` | hub operator | role=`customer` + `assigned_hub_id = 19`. |
| `333` | staff + driver | role=`staff` + driver of Zone 1 AND Hub 1. |
| `999`, `11111`, `22222`, `33333`, `999999` | unused | Reserved test phones. |

**Active subscriptions of note:**
- Sub 37 (food, Idli Vada 30 Days, customer 555) — days_consumed=5 after today's cron runs.
- Sub 39 (essentials, Newspaper 30 Days, customer 555, start 2026-05-07) — days_consumed=2; per BF-33 semantics the customer's tail shifts forward to receive all 30 paid deliveries.

## Today's queue (2026-05-11)

1. **Tier 1 audit — COMPLETE (8 / 8 flows).** BF-31 → BF-37.
2. **Tier 2 Jest backfill — COMPLETE.** 191 → 300 tests. BF-38a + BF-38b closed two deferred Tier 1 findings.
3. Pre-launch remaining (D-08):
   - **V-06 persona regression** — operational test on real device. Customer / staff / driver / hub-op / branch-admin walk-through. Shrikanth tackling tomorrow evening or sometime later.
   - **Flag flip SQL** — `UPDATE feature_flags SET flag_value = TRUE WHERE flag_key = 'branch_management_active';` once V-06 passes.
4. Pre-Play-Store (user-driven):
   - **FT-08 UX punch list** — Shrikanth's reorder menu items + small UX tweaks. List not yet sent.
   - Cut a fresh AAB once UX changes land + V-06 green.

## Pre-launch blockers (D-08 launch gate)

- **V-06 persona regression** — only remaining blocker. Operational test.
- **Flag flip SQL** — one line, once V-06 passes.

**MF-03 (Classes A / B / C + punch list 12-14) fully closed.** Confirmed live via Tier 1 Flow 6 audit on 2026-05-11.

## Long-term memory saved

Loads automatically in future sessions at `~/.claude/projects/-Users-shrikanthhegde/memory/`:
- `feedback_long_term_stability_bias.md` — for 1stOne F1, lean foundational over minimum-diff; Shrikanth's attention shifts post-launch and silent integrity bugs compound when nobody's watching.
- `project_f21_subscription_semantics.md` — F2.1 → option (a). Generation gated on days_consumed; pause/skip/cron-outage extend the effective end date.
