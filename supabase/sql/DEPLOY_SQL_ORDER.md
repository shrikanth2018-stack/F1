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

Vault secrets (required for kitchen cutoff push):
```sql
SELECT vault.create_secret('https://<ref>.supabase.co', 'supabase_url');
SELECT vault.create_secret('<service-role-key>',         'service_role_key');
```

## 1. Schema & core RPCs — run in SQL editor in this order

| #  | File                                              | What it installs                                                                                           |
|----|---------------------------------------------------|------------------------------------------------------------------------------------------------------------|
| 1  | `schema_migrations.sql`                           | Column adds (`razorpay_payment_id`, `paid_at`), CHECK constraints, indexes                                 |
| 2  | `rpc_atomic_increments.sql`                       | `increment_wallet_balance`, `decrement_wallet_balance_if_sufficient`, `increment_loyalty_points`, `place_order_atomic`, `mark_order_paid`, `mark_order_failed`, `complete_wallet_topup`, `pending_wallet_topups` table |
| 3  | `idempotency_keys.sql`                            | `idempotency_keys` table used by all write-side Edge Functions                                              |
| 4  | `custom_access_token_hook.sql`                    | Injects `user_role`, `assigned_hub_id`, `branch_id` into JWTs                                              |
| 5  | `seed_feature_flags.sql`                          | Seven canonical feature flags (ON CONFLICT DO NOTHING)                                                      |
| 6  | `generate_daily_manifest.sql`                     | Nightly 23:00 IST subscription-order generator + audit log                                                  |
| 7  | `kitchen_cutoff_push.sql`                         | Kitchen summary push per cycle cutoff (pg_cron every minute)                                                |
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
