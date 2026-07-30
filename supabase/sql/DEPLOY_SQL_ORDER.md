# 1stOne F1 — Supabase Deploy Runbook

SQL files in `supabase/` are idempotent. Run them in this order **once per
environment** (dev, staging, prod). Everything after this runbook is
maintained through migrations — do not hand-edit old files.

## 0. Prerequisites

```bash
supabase login
supabase link --project-ref <project-ref>
```

Extensions (one-time, run in SQL editor):
```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
```

Vault secrets (for the kitchen cutoff push):
```sql
SELECT vault.create_secret('https://<ref>.supabase.co', 'supabase_url');
SELECT vault.create_secret('<service-role-key>',         'service_role_key');
```
`kitchen_cutoff_push.sql` now falls back to `app_config` for both values if the
Vault secrets are absent, so provisioning either one is sufficient. An
unprovisioned Vault no longer silently disables the kitchen push.

## 1. Schema & core RPCs — run in SQL editor in this order

| #  | File                                              | What it installs                                                                                           |
|----|---------------------------------------------------|------------------------------------------------------------------------------------------------------------|
| 1  | `schema_migrations.sql`                           | Column adds (`razorpay_payment_id`, `paid_at`), CHECK constraints, indexes                                 |
| 2  | `rpc_atomic_increments.sql`                       | `increment_wallet_balance`, `decrement_wallet_balance_if_sufficient`, `increment_loyalty_points`, `place_order_atomic`, `mark_order_paid`, `mark_order_failed`, `complete_wallet_topup`, `pending_wallet_topups` table |
| 3  | `idempotency_keys.sql`                            | `idempotency_keys` table used by all write-side Edge Functions                                              |
| 4  | `custom_access_token_hook.sql`                    | Injects `user_role`, `assigned_hub_id`, `branch_id` into JWTs                                              |
| 5  | `seed_feature_flags.sql`                          | Seven canonical feature flags (ON CONFLICT DO NOTHING)                                                      |
| 6  | `generate_daily_manifest.sql`                     | Nightly 23:00 IST subscription-order generator + audit log                                                  |
| 7  | `kitchen_cutoff_push.sql`                         | Kitchen summary push per cycle cutoff (pg_cron every minute). At-least-once: `kitchen_push_log` rows are claims, final only once `notified_at` is set, and the tick retries unconfirmed claims until the cycle's `delivery_start` — so a push missed at a 22:30 cutoff is still recovered after IST midnight for the 07:00 delivery. Adds `delivery_cycles_push_after_cutoff` CHECK and the `kitchen-push-missing-alert` cron (every 10 min). **Re-run is safe; regenerate types afterwards** (`kitchen_push_log` gains `notified_at`, `status`, `attempts`). |
| 8  | `app_settings.sql`                                | Single-row `app_settings` config table (`login_bg_url`, etc.)                                              |
| 9  | `add_branch_id_columns_mf03.sql`                  | MF-03: adds `branch_id` (FK + index) to 6 tables (`customer_addresses`, `user_subscriptions`, `cancelled_subscription_days`, `staff_leaves`, `staff_salary`, `staff_shifts`) |
| 10 | `complete_onboarding.sql`                         | First-customer onboarding RPC. MF-03: derives `branch_id` from zone/hub. FT-03: nullable defaults on optional address fields |
| 11 | `handle_new_user.sql`                             | MF-08 capture: production trigger that creates the stub profile after OTP signup (writes NULL `branch_id`, RPC fills it) |
| 12 | `elevate_employee.sql`                            | `employee_id` sequence + `elevate_to_staff` RPC. FT-03: designation IS the role discriminator (`ADMIN HEAD` → `role='admin'`) |
| 13 | `staff_lookups_and_offboarding.sql`               | FT-02b: appends `staff_designations` + `staff_benefits` JSONB columns to `app_settings`; `demote_employee` RPC for offboarding (driver-tag pre-check) |
| 14 | `seed_admin_head_designation.sql`                 | FT-03: appends `ADMIN HEAD` to `app_settings.staff_designations`; `set_employee_designation` RPC (atomic designation + role flip; super-admin gate) |
| 15 | `mf03_cleanup_store_config_and_personas.sql`      | MF-03: drops dead `store_config.branch_management_active` column; promotes `888` to branch-1 admin (no-op until 888 OTP sign-in)                |

After step 4, toggle the hook in the dashboard:
**Auth → Hooks → Custom Access Token → Enable → `public.custom_access_token_hook`**

## 2. Edge Functions — deploy from repo root

```bash
supabase functions deploy place-order              --no-verify-jwt
supabase functions deploy quote-order              --no-verify-jwt
supabase functions deploy verify-payment           --no-verify-jwt
supabase functions deploy wallet-topup             --no-verify-jwt
supabase functions deploy apply-referral           --no-verify-jwt
supabase functions deploy send-push                --no-verify-jwt
supabase functions deploy cancel-order             --no-verify-jwt
supabase functions deploy confirm-order            --no-verify-jwt
supabase functions deploy confirm-topup            --no-verify-jwt
supabase functions deploy dormant-user-check       --no-verify-jwt
supabase functions deploy elevate-employee         --no-verify-jwt
supabase functions deploy low-wallet-check         --no-verify-jwt
supabase functions deploy subscription-expiry-push --no-verify-jwt
```

Environment variables (Supabase Dashboard → Edge Functions → Secrets):

| Key                      | Required by                    |
|--------------------------|--------------------------------|
| `RAZORPAY_KEY_ID`        | place-order, wallet-topup |
| `RAZORPAY_KEY_SECRET`    | place-order, wallet-topup |
| `RAZORPAY_WEBHOOK_SECRET`| verify-payment (HMAC signature) |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

## 3. Razorpay webhook

Razorpay dashboard → Webhooks → Add:

- URL:  `https://<ref>.supabase.co/functions/v1/verify-payment`
- Events: `payment.captured`, `payment.failed`, `order.paid`
- Secret: same value as `RAZORPAY_WEBHOOK_SECRET`

## 4. RLS — currently active

```
supabase/sql/rls_policies.sql
```

RLS is **enabled** on every user-facing table as of BF-04 (2026-05-03). The policy set in `rls_policies.sql` is live in dev (and will be the same in prod). Earlier versions of this runbook described RLS as deferred-to-launch; that's outdated.

Architecture in active use:

1. Every Edge Function uses the service-role key, which bypasses RLS by design.
2. Every client read uses the authenticated anon key — RLS policies gate access by `auth.uid()` and JWT claims (`user_role`, `assigned_hub_id`, `branch_id`).
3. `rls_policies.sql` is idempotent (`DROP POLICY IF EXISTS ... CREATE POLICY ...`) — safe to re-run when policies need to be updated or audited.
4. Branch scoping (MF-03 Commit 4, 2026-05-05): every admin/staff path goes through `public.has_branch_access(row_branch_id)`, which returns true for super-admin (JWT `branch_id IS NULL`) OR when the row's `branch_id` matches the caller's JWT. `public.is_super_admin()` returns admin role + null branch claim. Tables without their own `branch_id` column join through a parent table that does (`orders`, `subscription_plans`, `profiles`).
5. Smoke-test (any time): `customer` can see their own orders only; `staff` sees their branch's operational data; `admin` (branch-scoped) sees their branch only; `super-admin` (branch_id=NULL) sees all branches; `hub_operator` (a customer with `assigned_hub_id`) can read and update orders for their assigned hub.

Rollback (only if a policy is actively breaking something): `ALTER TABLE <x> DISABLE ROW LEVEL SECURITY;` per table, or drop offending policies individually. No data loss either way.

## 5. Verification queries

```sql
-- Feature flags present
SELECT flag_key, flag_value FROM feature_flags ORDER BY flag_key;

-- Recent manifest runs
SELECT * FROM manifest_run_log ORDER BY ran_at DESC LIMIT 5;

-- Recent kitchen pushes
SELECT * FROM kitchen_push_log ORDER BY pushed_at DESC LIMIT 10;

-- pg_cron jobs
SELECT jobname, schedule, active FROM cron.job;

-- Idempotency hits
SELECT endpoint, COUNT(*) FROM idempotency_keys GROUP BY endpoint;
```

## 6. Things to re-run after schema changes

- Column or type changes → append to `schema_migrations.sql` and re-run.
- RPC changes → edit `rpc_atomic_increments.sql` and re-run (CREATE OR REPLACE).
- Push payload changes → edit `kitchen_cutoff_push.sql` and re-run; the cron
  job redefinition is idempotent (the DO block unschedules first).

## 7. Folder contents not listed above

The `supabase/sql/` folder also contains files that are **not** part of the
initial deploy order in §1. Categories:

- **Post-launch migrations** — applied chronologically as schema needs evolved
  (column adds, RLS additions, RPC adds, triggers, fixes). Each is idempotent
  and the file name describes its purpose (`add_*`, `fix_*`, `customer_addresses_*`,
  etc.). Chronological order is the file mtime; `ls -ltr supabase/sql/*.sql`
  reproduces the application sequence on prod.
- **`schema.sql`** — base CREATE TABLE reference. Not a migration; do not run
  on an environment that has already received the §1 initial deploy. Kept as
  the source of truth for from-scratch table shapes.
- **`prefill-data.sql`** — initial production seed. Run **once** after
  `schema.sql` on a brand-new environment. Not re-runnable.
- **`seed_reset_test_data.sql`** — dev utility. Wipes order/sub/transaction
  history and re-seeds test data. **Never run on prod.**

## 8. MF-10 — multi-cycle order (pending deploy)

Lets one checkout span multiple delivery cycles as a single order group
(one payment, one cancellation, one `orders` row per cycle sharing an
`order_group_id`). Apply as **one bundle** — the `place-order` payload shape
changes, so an old app build hitting the new function (or a new build hitting
the old function) breaks checkout.

**SQL — run in SQL editor, in this order:**

| #  | File                          | What it installs                                                                                          |
|----|-------------------------------|------------------------------------------------------------------------------------------------------------|
| 1  | `add_order_group_id.sql`      | `orders.order_group_id` (UUID, `DEFAULT gen_random_uuid()`, NOT NULL) + backfill of existing rows + index   |
| 2  | `mf10_place_order_atomic.sql` | Multi-group `place_order_atomic` — drops the prior 17-arg overload, creates the `p_groups` signature. Run **after** `rpc_atomic_increments.sql`. |

**Edge Functions — redeploy:**

```bash
supabase functions deploy place-order    --no-verify-jwt
supabase functions deploy confirm-order  --no-verify-jwt
supabase functions deploy verify-payment --no-verify-jwt
supabase functions deploy cancel-order   --no-verify-jwt
```

**App build:** ship the matching app build in the same window as the
`place-order` deploy — the two are not backward-compatible.

No change to RLS, cron jobs, `generate_daily_manifest`, or staff-facing
functions — each `orders` row remains a single-cycle fulfillment unit.

## 9. Server-authoritative order (place-order rewrite)

Moves all order scheduling + pricing to the server. The client sends only its
cart (item ids + quantities, address, payment method); the server derives
cycles, dispatch dates (IST), tax and delivery fee. `dispatch_date` is no
longer trusted from the device.

**No SQL / schema / RLS changes.** App + edge functions only.

New shared modules: `_shared/dispatch.ts` (IST clock + A/B/C derivation),
`_shared/orderBuild.ts` (the single derivation both endpoints call).

**Edge Functions:**

```bash
supabase functions deploy quote-order  --no-verify-jwt   # NEW — read-only cart preview
supabase functions deploy place-order  --no-verify-jwt   # rewritten — flat `items` contract
```

- **`quote-order`** is new — the server-authoritative cart/checkout preview.
- **`place-order`** has a **breaking contract change**: it now expects a flat
  `items` array + a `client_quote` echo, not `groups`. An app build sending
  the old `groups` payload gets a clean "please update the app" error.

**App build:** ship the matching app build in the same window as the
`place-order` deploy — the two are not backward-compatible. Deploy
`quote-order` first (additive, harmless if the app isn't using it yet), then
`place-order` together with the app build.

Rollback: redeploy the previous `place-order` and ship the previous app build;
`quote-order` can be left deployed (nothing else calls it).

## 10. Hub commission claims (2026-07-21)

Hub operators claim their monthly commission from the Hub Dashboard; the
claim lands in `expense_claims` (category `Hub Commission`) and rides the
existing admin approve → paid flow in Expense Manager.

**SQL (run in SQL editor, idempotent):**

```
supabase/sql/hub_commission_claims.sql
```

Adds two nullable columns to `expense_claims` (`hub_id`, `claim_period`), a
partial unique index (one claim per hub per month), and three functions:
`_hub_commission_for_period` (internal), `get_hub_commission_summary`,
`create_hub_commission_claim` (both SECURITY DEFINER, granted to
`authenticated` — the claim amount is computed server-side from delivered
item value × `delivery_hubs.commission_percent`; the client never sends an
amount).

**No edge-function changes.** The custom-push composer added in the same app
release reuses the already-deployed `send-push` function as-is.

**App build:** run this SQL **before** shipping the OTA that adds the
Commission tab. Old app builds are unaffected (additive columns + new RPCs
only). Rollback: the app tab errors gracefully if the RPCs are missing;
dropping the functions and columns reverts fully.

## 11. Log retention & growth indexes (2026-07-21, health report Slice B)

**SQL (run in SQL editor, idempotent):**

```
supabase/sql/log_retention_and_indexes.sql
```

- New nightly cron `prune-operational-logs` (02:30 IST): prunes
  `push_logs` (90d), `manifest_run_log` (180d), `kitchen_push_log` (90d),
  `cron.job_run_details` (7d). Appears in `get_job_health()` automatically.
- `ux_orders_subscription_dispatch` — partial unique index making the
  subscription-dispatch dedupe a DB constraint (the file aborts with a
  diagnostic query if pre-existing duplicates are found — resolve those
  first, then re-run).
- Growth indexes: `idx_orders_cycle_dispatch`, `idx_orders_undelivered_past`
  (partial), `idx_wallet_tx_user_created`.

**No app coupling, no edge-function changes, no OTA needed.**
Rollback: `cron.unschedule('prune-operational-logs')` + `DROP INDEX` the
three indexes; nothing depends on them.

## 12. Atomic supply-batch print (2026-07-21, health report #19)

**SQL (run in SQL editor, idempotent):**

```
supabase/sql/print_supply_batch_atomic.sql
```

`print_supply_batch_atomic(p_item_ids, p_branch_id)` — snapshot + batch-stamp
in one transaction, snapshot built server-side. Admin-only (checks
`is_admin()`).

**App coupling:** run BEFORE the OTA that switches `usePrintBatch` to this
RPC. Old app builds keep using the two-step path harmlessly.

**Edge functions to redeploy with the same release** (timeout + pagination
changes — no contract changes, safe to deploy independently of the app):

```bash
supabase functions deploy dormant-user-check --no-verify-jwt   # #8 pagination
supabase functions deploy place-order        --no-verify-jwt   # #10 Razorpay timeout
supabase functions deploy wallet-topup       --no-verify-jwt   # #10 Razorpay timeout
supabase functions deploy send-push          --no-verify-jwt   # #10 Expo timeout
```

(Other functions pick up the shared `_shared/notifications.ts` timeout
whenever they are next deployed — no urgency.)

## 13. External heartbeat (2026-07-21, health report Slice C, #5)

**SQL (run in SQL editor, idempotent):**

```
supabase/sql/cron_heartbeat.sql
```

Prereq: create the healthchecks.io check (Period 5 min, Grace 10 min) and
store its ping URL first — see the file header for the exact
`INSERT INTO app_config` statement. New cron `external-heartbeat` (*/5 min):
pings healthchecks.io; `/fail` on recent cron failures; silence when the
chain itself is dead → healthchecks.io emails the owner. Incident playbooks:
`docs/07-incident-playbooks.md`.

## 14. Two-stage menu builder (2026-07-27, Slice 1)

Splits the two roles that already shared `menu_items`: priced building-block
**items** (Idli ₹12) and the customer-facing **menu items** composed from
them (Idli Vada ₹55, recipe `Idli:2;Vada:1`). Items are admin-only — they
exist so a single part can be priced and sold on its own from the back
office, and they must never reach the customer menu.

**SQL (run in SQL editor, idempotent):**

```
supabase/sql/menu_items_visibility.sql
```

Adds `menu_items.is_customer_visible BOOLEAN NOT NULL DEFAULT TRUE`. The
default is the whole safety story: every pre-existing row keeps its current
behaviour, so this is safe to run **before** the matching app release, and
old app builds ignore the column entirely.

**No edge-function changes.** The kitchen aggregation is untouched —
`get_kitchen_aggregate` explodes a menu item's `ingredients` by component
NAME, and an item ordered on its own falls through the "no ingredients" path
under its own name, so the two merge onto one prep line. That name match is
why item names are treated as stable: there is no rename path in the app and
none should be added.

**App coupling:** run the SQL, then `npm run supabase:gen-types`, then ship
the OTA. The customer-facing change is one filter
(`useMenuItems` → `.eq('is_customer_visible', true)`) and it is a no-op until
the first hidden item is created.

**Rollback:** `ALTER TABLE public.menu_items DROP COLUMN is_customer_visible;`
— nothing else depends on it.

> Note: the builder now writes `ingredients` in the `Name:qty;Name:qty` text
> grammar the kitchen parser reads, where `CreateMenuScreen` previously wrote
> JSON. Rows written before this keep working exactly as they did; only newly
> built menus use the new format.

## 15. Admin / bulk order entry (2026-07-27, Slice 2)

Back-office order creation: an admin places an order on behalf of a customer
— bulk, individual or B2B — for one delivery cycle, from items and menu
items defined by the two-stage builder. Depends on §14.

**SQL (run in SQL editor, idempotent):**

```
supabase/sql/admin_bulk_orders.sql
```

- `orders.placed_by` (FK `auth.users`) — provenance, and the discriminator
  behind the "Bulk only" filter on the admin orders list.
- `orders.discount_percent` + CHECK 0–100 — recorded for the invoice; the
  discounted price is already reflected in `order_items.price_at_time` and
  `orders.total_amount`.
- `orders.razorpay_payment_link_id` — deliberately NOT `razorpay_order_id`,
  which four existing code paths match on.
- **Widens `orders_payment_method_check`** to allow `'account'` (confirmed
  now, collected later). Pure widening — no existing row is affected.
- `store_config.max_admin_discount_percent` (default 15) — the discount
  ceiling is a business rule, so it lives in config, not code.
- `idx_orders_placed_by` — partial index for the filter.
- **Revokes `place_order_atomic` from PUBLIC / anon / authenticated.** It is
  SECURITY DEFINER with no authorization check of its own, so any logged-in
  user could have called it directly and minted a Confirmed, unpaid order,
  bypassing place-order's pricing, drift check, rate limit and payment.
  `service_role` keeps its explicit grant, so `place-order` and
  `admin-place-order` are unaffected. Reversed with a `GRANT` if ever needed.

**Edge Functions:**

```bash
supabase functions deploy admin-create-customer --no-verify-jwt   # NEW — registration
supabase functions deploy admin-place-order     --no-verify-jwt   # NEW — ordering
supabase functions deploy verify-payment        --no-verify-jwt   # + payment_link.paid branch
supabase functions deploy reports               --no-verify-jwt   # + source filter (All/Bulk/Retail)
```

The back office is split in two on purpose, mirroring the customer side where
Checkout picks an address and AddAddress creates one:

- **`admin-create-customer`** — find-or-create the auth user, fill the profile
  name only when empty, and write the address. Routing is resolved server-side
  (explicit zone/hub → else the map pin via `resolve_address_serviceability`)
  and an address resolving to NEITHER a zone nor a hub is rejected.
- **`admin-place-order`** — requires an existing `customer.user_id` and an
  address that already routes. No create-on-the-fly path, so there is no
  second copy of registration logic to keep in step, and the money path stays
  a single job: known customer + items → priced, routed, paid order.

`reports` gains an optional `source: 'all' | 'bulk' | 'retail'` body field,
applied to the four order-based reports (`revenue`, `orders`, `ordersDetail`,
`revenueDetail`) as a QUERY filter on `orders.placed_by` — not as a change to
`_shared/reportAggregations.ts`, which is untouched. Anything unrecognised or
absent falls back to `'all'`, so app builds that predate the filter get
byte-identical numbers and this function can be deployed independently.

`admin-place-order` calls the same `_shared/orderBuild.ts` the customer path
uses, so pricing, GST carve-out, dispatch dates, fee priority, storm mode and
serviceability behave identically. It deliberately drops the quote-echo drift
check and the 5-per-60s rate limit, and it creates the order **before** taking
payment — confirmation does not depend on payment here, so there is no
compensating transaction: a failed wallet debit simply leaves the order unpaid.

**Razorpay dashboard:** tick **`payment_link.paid`** on the existing webhook,
or admin orders paid by link are never stamped. No new webhook or secret is
needed — the existing one already covers the active mode.

**App coupling:** run the SQL → `npm run supabase:gen-types` → deploy both
functions → OTA. `admin-place-order` is new so no old build can call it; the
`verify-payment` branch is additive and returns before any existing path.

**Rollback:** redeploy the previous `verify-payment` from git; drop the added
columns and the index; restore the CHECK to its three-value form (only if no
`'account'` order exists yet).


## 16. Vendor network — phase 1 (2026-07-28)

Third-party vendors list their own items in the **Essentials** section,
scoped to the zones/hubs an admin grants them. Food is never involved — the
kitchen aggregation is untouched by this whole feature.

**SQL — run in SQL editor in this order (all idempotent):**

| # | File | What it installs |
|---|------|------------------|
| 1 | `vendors_schema.sql` | `vendors`, `vendor_zones`, `vendor_earnings`; `essentials_catalog.vendor_id` + `.daily_cap`; `profiles.vendor_id`; RLS. Also a SECOND FK `vendors_owner_profile_fkey → profiles(id)` — PostgREST can only embed `profiles` through a constraint that targets it, and `owner_user_id` references `auth.users`. |
| 2 | `vendors_earnings_trigger.sql` | `essentials_catalog.vendor_cost` (house-brand rate) + credit-on-delivery. A TRIGGER, because an order reaches `Delivered` by four routes — staff update, offline replay, bulk advance, admin override — and only a trigger catches all four. |
| 3 | `vendors_admin_rpcs.sql` | `admin_onboard_vendor`, `admin_set_vendor_status`, `admin_set_vendor_terms`. `vendors` has UPDATE revoked from `authenticated` except the seven business-detail columns, so status and commission can only move through these — same pattern as `profiles.role` behind `elevate_to_staff`. |
| 4 | `vendors_visibility.sql` | `vendor_public` view (trading name only) + a **RESTRICTIVE** policy on `essentials_catalog` + `vendor_ids_for_address`. |
| 5 | `vendors_portal.sql` | `vendor_supply_list`, `create_vendor_payout_claim`, and the wallet debit when a payout is marked Paid. |
| 6 | `vendors_caps_and_fulfilment.sql` | `vendor_used_quantities`, `vendor_order_fulfilment`, `vendor_orders`, `vendor_mark_order_ready`. |
| 7 | `vendors_fixes_01.sql` | Device-test fixes. BIGINT→INTEGER casts in three functions (only `vendors.id` is bigint; `orders.id`, `order_items.*` and `essentials_catalog.id` are all integer), and `vendor_submit_registration` — the missing `invited → submitted` transition, which could only live in a SECURITY DEFINER function because `status` is deliberately not grantable. |
| 8 | `vendors_fixes_02.sql` | `vendor_orders` gains `cancellable_until` — the instant the order stops being cancellable, computed over the whole `order_group_id` and with the cross-midnight cutoff rule, so it matches what `cancel-order` will actually permit rather than approximating it. Tells the vendor when it is safe to buy stock. Also returns the cycle's **essentials label** ("Morning") rather than the kitchen name ("Breakfast") — a vendor sells essentials, so they should read the cycle the way their customer does. |

**Edge Functions — redeploy (they bundle `_shared/orderBuild.ts`):**

```bash
supabase functions deploy quote-order       --no-verify-jwt
supabase functions deploy place-order       --no-verify-jwt
supabase functions deploy admin-place-order --no-verify-jwt
```

`orderBuild` gained two guards, both of which only run when a cart actually
contains a vendor item — so every existing cart takes exactly the path it
took before:

- **zone scope** — RLS covers browsing, but the builder runs with the
  service-role key and bypasses RLS, so ordering needs its own check
- **daily caps** — enforced after the dispatch date is derived, since a cap
  is per day. Counts `Pending` too: an order mid-payment has reserved that
  stock.

**Two enforcement points, deliberately different.** Browsing is filtered by
RLS against ALL of a customer's addresses; ordering is checked against the
one address the order is going to. Browse is the looser of the two on
purpose.

**No app coupling for the SQL** — every column is nullable or defaulted and
nothing is visible until the first vendor exists. Run the SQL, regenerate
types, deploy the functions, then OTA.

**Rollback:** drop the four tables (`vendor_order_fulfilment`,
`vendor_earnings`, `vendor_zones`, `vendors`) with CASCADE, drop the added
columns, drop both triggers, redeploy the three functions from git.

---

## 17. expense_claims category fix (2026-07-30)

**Applied to production 2026-07-30 and verified.**

`expense_claims_category_check` had never been widened past its original five
staff-expense values, so three separate write paths were failing at INSERT —
silently, because each surfaced only as a generic "could not save":

| Category | Written by | Live since |
|---|---|---|
| `Others` | `StaffExpensesScreen` (CATEGORIES list) | always |
| `Hub Commission` | `hub_commission_claims.sql` | that file's deploy |
| `Vendor Payout` | `vendors_portal.sql` | vendor network phase 1 |

Neither `hub_commission_claims.sql` nor `vendors_portal.sql` altered the
constraint, so hub commission and vendor payout claims were **dead on arrival**.
The `Others` case is older still: the app has always offered it, but the
constraint's fifth value is `Expense`.

| # | File | What it does |
|---|------|--------------|
| 1 | `expense_claims_categories_widen.sql` | Widens the CHECK to all eight values. `Expense` is kept so any legacy row stays valid. Idempotent. |

**Rule going forward:** add the value to this constraint in the SAME file that
introduces a new claim category. Three features have now shipped without it.

**Rollback:** re-add the constraint with the original five values
(`Grocery, Vegetable, Stationery, Fuel, Expense`) — only safe if no row is
carrying one of the new categories.
