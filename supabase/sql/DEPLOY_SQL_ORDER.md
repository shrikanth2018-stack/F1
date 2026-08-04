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

---

## 18. Vendor visibility fix (2026-07-30)

**Applied to production 2026-07-30 and verified per-user under real RLS.**

`essentials_vendor_scope` decided customer visibility with an inline `EXISTS`
over `vendors` and `vendor_zones`. A policy expression runs as the CALLING
user, so both tables applied their own RLS — and both deny SELECT to ordinary
customers by design (`vendors_owner_read`, `vendor_zones_read`). The subquery
therefore read zero rows for every real customer and the RESTRICTIVE policy
denied the item.

**No customer could see any vendor item.** The only account that could was the
vendor's own owner, via the separate owner branch — which is precisely why it
read as a zone-mapping problem during device testing.

| # | File | What it does |
|---|------|--------------|
| 1 | `vendors_fixes_03_visibility.sql` | Adds `vendor_ids_visible_to_me()` (SECURITY DEFINER, returns vendor IDs only) and repoints the policy at it. |

Mirror of `vendor_ids_for_address`, which already existed for the ORDER path
because the service-role builder bypasses RLS. The browse path had the
opposite problem and nobody had checked it.

**Verifying this class of bug:** query as the user, not as superuser. A
superuser query bypasses RLS entirely and will happily confirm a policy that
denies every real customer.

```sql
SELECT set_config('request.jwt.claims',
  json_build_object('sub','<user-uuid>','role','authenticated','user_role','customer')::text, true);
SET LOCAL ROLE authenticated;
SELECT count(*) FROM essentials_catalog WHERE vendor_id IS NOT NULL;
RESET ROLE;
```

**Rollback:** restore the policy body from `vendors_visibility.sql` §2 — but
that restores the bug.

---

## 19. Menu item photos (2026-08-01)

**Applied to production 2026-08-01 and verified.**

One photo per customer-facing menu item, uploaded from the menu builder
(`CreateMenuScreen` on add, `MenuManageScreen` row on edit) and rendered on
the customer Home row as a 76pt tile.

| # | File | What it does |
|---|------|--------------|
| 1 | `menu_item_photos.sql` | Adds `image_path`, `image_updated_at`, `description` to `menu_items`; creates the `menu-photos` bucket (public read, 8 MB cap, image MIME allowlist); four storage policies gating writes on `public.is_admin()`. |

**One photo per item is enforced by the object key,** not by remembering to
delete: the path is `menu-photos/{id}.jpg` with a FIXED extension, written
with upsert. A varying extension would leave `{id}.jpg` and `{id}.webp` behind
on a format change. Replacement is therefore the same object being overwritten
and cannot leak an orphan.

**The cost of a fixed key is CDN staleness** — same URL, new bytes. Handled by
stamping `image_updated_at` on every upload and appending it as `?v=` at
render (`src/utils/menuImage.ts`). Both halves are required; changing one
without the other serves customers a stale picture for up to the cache
lifetime.

**Cache-Control must be set on upload.** Supabase defaults an object to
`no-cache`, which propagates to the render endpoint — the first batch of
photos was re-fetched on every launch. The uploader now sends
`cacheControl: 2592000` (30 days). 30 rather than 365 so that a row which
somehow ends up with a photo but no stamp self-heals in a month.

**Delivery goes through the render endpoint,** not the raw object:
`?width=240&height=240&resize=cover&quality=70`. Measured on production: a
48 KB source is served as 6.4 KB WebP. Image transformation is a paid-plan
feature — if the plan ever lapses, dropping the transform params falls back to
the original object.

`description` and `image_path` replace a `MenuItem.image_url` that
`src/types/catalog.ts` had declared since the two-stage builder shipped.
Neither column ever existed, so the description branch in `ItemRows.tsx` had
never once rendered.

**Verification:**

```sql
SELECT id, name, image_path, image_updated_at IS NOT NULL AS stamped
FROM menu_items WHERE is_customer_visible AND is_active ORDER BY id;
```

```bash
# must be 200 + content-type: image/webp + cache-control: public, max-age=...
curl -sD- -o /dev/null -H 'Accept: image/webp,*/*' \
  "$URL/storage/v1/render/image/public/menu-photos/2.jpg?width=240&height=240&resize=cover&quality=70"
```

**Rollback:** see the commented block at the bottom of the SQL file.

---

## 20. `assets` bucket lockdown (2026-08-01)

**Applied to production 2026-08-01 and verified with the anon key.**

Pre-existing hole, unrelated to §19 but found while building it. The `assets`
bucket carried four dashboard-generated policies (`general 1bqp9qb_0..3`)
granting SELECT/INSERT/UPDATE/DELETE to the Postgres role `public` — which
includes `anon`, whose key ships inside the APK.

| # | File | What it does |
|---|------|--------------|
| 1 | `assets_bucket_lockdown.sql` | Drops the four open policies; keeps SELECT public; gates INSERT/UPDATE/DELETE on `public.is_admin()`. |

Anonymous **read must stay** — the login screen renders its background before
anyone signs in, and 1stone.in fetches the landing hero unauthenticated.

**Verified before:** anon PUT → 200, anon DELETE → 200.
**Verified after:** anon PUT → 400, anon DELETE of `logo.png` → 400, public
read → 200.

```bash
# must be 400 (and the object must survive)
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  "$URL/storage/v1/object/assets/logo.png"
```

**After applying, re-test in the app:** Manage → Marketing → Banners &
Backgrounds must still upload as an admin. A failure there means the JWT lacks
the `user_role` claim — re-login refreshes it.

**Rollback:** commented block at the bottom of the SQL file. It restores the
hole; only for an emergency where a banner must go out and admin upload is
broken.

---

## 21. Essentials photos (2026-08-01)

**Applied to production 2026-08-01 and verified.**

The essentials half of the catalogue photo work. Mirrors §19 — same three
columns, same fixed-path replace rule, same render-endpoint delivery.

| # | File | What it does |
|---|------|--------------|
| 1 | `essentials_photos.sql` | Adds `image_path`, `image_updated_at`, `description` to `essentials_catalog`; creates the `essentials-photos` bucket; four storage policies gating writes on `public.is_admin()`. |

**Admin-only writes, deliberately.** A row here may be vendor-owned, and
vendors are customer-role profiles. The agreed design is a review gate: vendor
uploads land in a SEPARATE PRIVATE bucket and only move to this public one on
admin approval. That work is not in this file. **Do not add a vendor branch to
these policies** — the ownership test must live in a SECURITY DEFINER function
mirroring `vendor_ids_visible_to_me`, because an inline EXISTS over `vendors`
in a policy is evaluated as the calling user and is exactly what silently
denied every customer in the July 2026 vendor-visibility outage.

`description` fixes a second phantom field: `EssentialItem.description` had
been declared in `src/types/catalog.ts` and rendered by `ItemRows.tsx` since
the essentials module shipped, but the column never existed.

**Client code was generalised in the same change,** not copied:
`menuImage.ts` → `catalogPhoto.ts`, `menuPhotoUpload.ts` →
`catalogPhotoUpload.ts`, `MenuItemThumb` → `CatalogPhotoThumb`. All take a
bucket. The vendor gate must reuse these rather than forking a third copy.

**Verification:**

```sql
SELECT id, name, image_path, vendor_id FROM essentials_catalog
WHERE is_active ORDER BY id;
```

```bash
# 200 + image/webp + cache-control: public, max-age=2592000
curl -sD- -o /dev/null -H 'Accept: image/webp,*/*' \
  "$URL/storage/v1/render/image/public/essentials-photos/1.jpg?width=240&height=240&resize=cover&quality=70"
```

**Rollback:** commented block at the bottom of the SQL file.

---

## 22. Menu replacement and the two-step Menu Manager (2026-08-03)

Applied in this order, all against the live database:

1. `menu_replace_2026_08.sql` — the whole food menu replaced from the owner's
   CSV: 37 customer-facing dishes built from blocks.
2. `clear_test_history_2026_08.sql` — orders, subscriptions, attendance and
   push/transaction logs cleared while the data was still trial. Wallets set to
   ₹2000 **with matching ledger rows**, never by writing the balance column —
   `wallet_transactions` is the source of truth and a bare balance write leaves
   it unexplainable. Supply data deliberately retained.
3. `menu_manager_rebuild.sql` — blocks deduplicated 49 → 34, renames cascaded
   into every recipe naming them.
4. `menu_item_units.sql` — `unit` moves onto `menu_items`. It had been a
   property of each recipe LINE, so Sagu was `ml` in Poori and `g` in Lunch Box.
   Nothing was wrong with the data; the model simply allowed it. Backfilled by
   majority use, then every recipe rewritten to agree.
5. `menu_unit_wording.sql` — `g` → `gms`, `no` → `nos`.

**Why the tokens are words.** `StaffDashboard` renders the kitchen prep board
straight from the recipe text the server aggregates — `${qty} ${unit}` — so
there is no screen in between that could translate `g` into `gms`. Storing the
readable token is what removes the mapping layer nobody can forget. The client
still *reads* `g`/`no` (a phone may hold a recipe cached from before the
release) but never writes them.

**The unit and the recipe text must move together.** `get_kitchen_aggregate`
groups prep by **(name, unit)**, so a block whose column says `ml` while a
recipe still says `g` becomes two prep lines for one ingredient — and one of
them gets under-cooked. `admin_set_menu_block_unit` therefore rewrites the
recipes in the same call, exactly as `admin_rename_menu_block` does.

**A rename cannot be a string replace.** Eight block names contain another
block's name — "Rice" is inside Curd Rice, Fried Rice and Rice Pullav among
others — so the RPC compares each recipe's name part exactly. §1 of
`menu_manager_rebuild.sql` first shipped without a canonicalisation pass and
orphaned a component by renaming a name that was both a dish and a block; §3b
exists because of that.

Units are **internal** — kitchen, admin and bulk ordering. No customer screen
renders `ingredients`; a customer sees the quantity of the menu they bought,
never of an ingredient inside it.

**Verification:**

```sql
-- Every recipe agrees with its item's unit. Must return zero rows.
SELECT mi.name, ch.chunk
FROM menu_items mi
CROSS JOIN LATERAL regexp_split_to_table(mi.ingredients, ';') ch(chunk)
LEFT JOIN menu_items b ON NOT b.is_customer_visible
  AND lower(b.name) = lower(btrim(split_part(ch.chunk, ':', 1)))
WHERE mi.is_customer_visible AND btrim(ch.chunk) <> ''
  AND btrim(regexp_replace(btrim(split_part(ch.chunk, ':', 2)), '^[0-9.]+\s*', '')) <> b.unit;
```

**Rollback:** commented block at the bottom of each SQL file. Reversing the
wording means undoing the two UPDATEs and re-running `menu_item_units.sql`.

---

## 23. A Menu Item's price is for a stated quantity (2026-08-03)

`menu_item_base_quantity.sql`

"Sambar ₹20" answers nothing on its own — ₹20 for how much? The unit said how
an item is measured but never how much the price buys, and that price has one
real use: a bulk order buying the item on its own. It was quoting a figure with
no quantity attached to it.

A block now reads **₹20 for 150 ml**, and a bulk line of ×2 is 300 ml at ₹40.

**The order path needs no change.** `buildAuthoritativeOrder` already
multiplies price by the line quantity, and that quantity is now unambiguously
"how many of these". Nothing about money moved.

**This one is NOT a cascade**, unlike the name and the unit. A recipe line
carries its own quantity — `Sambar:150 ml` is what *that dish* contains, a
different question from what ₹20 buys. Nothing inside `ingredients` changes, so
`get_kitchen_aggregate` is untouched and no prep line can split. It is a plain
column, edited straight through `useUpdateMenuItem`.

**Backfilled by majority use**, the same rule `menu_item_units.sql` used for the
unit, so Sambar arrives at the 150 ml nine recipes already ask for rather than
at a meaningless 1. Every block is priced ₹0 today, so the figure is cosmetic
until someone prices one — which is exactly when a wrong quantity would start
costing money.

**`admin_create_menu_block` is DROPped before being recreated.** `CREATE OR
REPLACE` with a longer argument list makes an *overload*, not a replacement,
and PostgREST would then have two candidates for the same named-argument call.
The shipped app sends four named arguments and still resolves to the new
five-argument function, because `p_base_qty` has a default.

**Also fixed in the same slice (app-side, no SQL):** the CSV importer created
blocks with no unit, so every one landed as `nos` while the recipe text still
said `150 ml` — and the next save of that menu, which resolves the unit from
the item, quietly rewrote `150 ml` into `150 nos`. It now reads each block's
unit and portion back out of the recipes that name it, canonicalises every
component to the existing block's spelling, and writes recipes through
`buildRecipe` so no `Buns;2` or `150ml` can reach the database. Blocks are
created **before** the menu rows now: the failure that order chooses is a few
unused ₹0 blocks, not a live menu naming a block that does not exist.

**Verification:**

```sql
-- No block priced without a portion to price. Must return zero rows.
SELECT name, price, base_quantity, unit FROM menu_items
WHERE NOT is_customer_visible AND price > 0 AND base_quantity IS NULL;

-- What each part costs at the portion a recipe actually uses.
SELECT b.name, b.price, b.base_quantity, b.unit
FROM menu_items b WHERE NOT b.is_customer_visible ORDER BY lower(b.name);
```

**Rollback:** commented block at the bottom of the SQL file. Dropping the
five-argument RPC means re-running `menu_unit_wording.sql` to restore the
four-argument one.

---

## 24. Three tables a customer could write directly (2026-08-04)

`client_write_gaps.sql`

A policy written as `FOR ALL USING (<owner test>)` with **no WITH CHECK**.
Postgres reuses the USING expression as the insert check, so "rows I may READ"
silently became "rows I may WRITE" — and `schema.sql` grants ALL on these
tables to `authenticated`, so the policy was the only gate there was.

- **`user_subscriptions`** — the serious one. A customer could insert their own
  row against any plan with `is_active` true, and `generate_daily_manifest`
  would dispatch a Confirmed order every day for the plan's full duration, at
  zero money. Fixed with **column grants**, not a cleverer policy: INSERT and
  DELETE revoked from `authenticated`, UPDATE narrowed to `is_paused` (the only
  write any screen makes). Grants are checked before RLS and cannot be reasoned
  around — the same pattern as `profiles.role` and `vendors.status`.
- **`expense_claims`** — a WITH CHECK so a claimant can only file their own row
  at `Pending`, and only if they are staff. Admin settling is untouched. Hub
  commission and vendor payout go through SECURITY DEFINER RPCs, so a
  customer-role vendor never needs a direct insert.
- **`customer_addresses`** — `trg_address_resolve` recomputes `zone_id`,
  `hub_id`, `is_serviceable` and `branch_id` from the pin, discarding whatever
  the client sent. The point-in-polygon test was always server-side; its ANSWER
  was not. Skips service-role and staff/admin callers, so
  `admin-create-customer` and `assign_addresses_to_hub` still work, and honours
  `hub_delivery_active` exactly as `AddAddressScreen` does.

**Not changed:** `cancelled_subscription_days`. Its USING clause already tests
that the subscription belongs to the caller, so doubling as the insert check is
correct there.

**Grep for the class:** `pg_policies` where `cmd = 'ALL'` and
`with_check IS NULL`.

**Verification:** impersonate a real customer — `request.jwt.claims` **plus**
`SET LOCAL ROLE authenticated` — inside `BEGIN … ROLLBACK`. Never as superuser:
that bypasses RLS and will confirm a policy that denies everyone. Four of the
seven assertions are regressions, not the fix: the customer can still pause a
subscription and skip a day, staff can still file a Pending claim, and
**`place-order` can still create a subscription as the service role** — the one
that would have broken buying a plan outright.

**Rollback:** commented block at the bottom of the file.

---

## 25. Re-onboarding an employee stops being an error (2026-08-04)

`elevate_employee_reonboard.sql`

`elevate_to_staff` inserted a `staff_salary` row whenever `p_monthly_salary > 0`
against a `UNIQUE (staff_id, month, year)`, so a second call in the same month
raised a duplicate-key error and rolled the whole elevate back — losing the
correction the admin was making. Now `ON CONFLICT DO NOTHING`, deliberately not
DO UPDATE: that month may already be settled, and re-running onboarding is not
the place to silently rewrite payroll.

Separately, `nextval('employee_id_seq')` ran before anything checked for an
existing `employee_id`, so every correction burned a number and the series grew
gaps. The sequence is now only touched when an ID is actually needed.

Signature unchanged, so the deployed `elevate-employee` Edge Function needs no
redeploy. **Rollback:** re-run `elevate_employee.sql`.

---

## 26. An admin refund says which order it was for (2026-08-04)

`admin_refund_reference.sql`

Both admin cancel RPCs credited the wallet with the three-argument
`increment_wallet_balance`, so the refund landed with `reference_type` and
`reference_id` NULL — the description named the order but nothing
machine-readable tied them together. The customer path
(`cancel-order/index.ts`) has always passed `'order_refund'` + the order id, so
a refund was traceable or not purely by who pressed cancel.

Both are fixed — `admin_cancel_order_atomic` tags `order_refund`,
`admin_cancel_subscription_atomic` tags `subscription_refund`. Fixing only the
first would have left the subscription path as the sole untagged credit in the
ledger, which is worse than where this started.

**Rebuilt from the LIVE function definitions, not the repo files** — two files
here define `admin_cancel_order_atomic` (`admin_cancel_order_atomic_rpc.sql` and
`admin_cancel_order_allow_unsuccessful.sql`) and only the deployed one is
authoritative. Diffed before applying: the credit call is the only change.

**Note for anyone matching on `orders.notes`:** `admin_cancel_order_atomic`
APPENDS to that column (`… | [Admin cancel: reason]`). An exact-match query
will find nothing after a cancellation.
