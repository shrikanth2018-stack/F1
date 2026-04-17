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

| # | File                             | What it installs                                                   |
|---|----------------------------------|--------------------------------------------------------------------|
| 1 | `schema_migrations.sql`          | Column adds (`razorpay_payment_id`, `paid_at`), CHECK constraints, indexes |
| 2 | `rpc_atomic_increments.sql`      | `increment_wallet_balance`, `decrement_wallet_balance_if_sufficient`, `increment_loyalty_points`, `place_order_atomic`, `mark_order_paid`, `mark_order_failed`, `complete_wallet_topup`, `pending_wallet_topups` table |
| 3 | `idempotency_keys.sql`           | `idempotency_keys` table used by all write-side Edge Functions      |
| 4 | `custom_access_token_hook.sql`   | Injects `user_role`, `assigned_hub_id`, `branch_id` into JWTs      |
| 5 | `seed_feature_flags.sql`         | Seven canonical feature flags (ON CONFLICT DO NOTHING)             |
| 6 | `generate_daily_manifest.sql`    | Nightly 23:00 IST subscription-order generator + audit log         |
| 7 | `kitchen_cutoff_push.sql`        | Kitchen summary push per cycle cutoff (pg_cron every minute)       |

After step 4, toggle the hook in the dashboard:
**Auth → Hooks → Custom Access Token → Enable → `public.custom_access_token_hook`**

## 2. Edge Functions — deploy from repo root

```bash
supabase functions deploy place-order    --no-verify-jwt
supabase functions deploy verify-payment --no-verify-jwt
supabase functions deploy wallet-topup   --no-verify-jwt
supabase functions deploy subscribe      --no-verify-jwt
supabase functions deploy apply-referral --no-verify-jwt
supabase functions deploy send-push      --no-verify-jwt
```

Environment variables (Supabase Dashboard → Edge Functions → Secrets):

| Key                      | Required by                    |
|--------------------------|--------------------------------|
| `RAZORPAY_KEY_ID`        | place-order, wallet-topup, subscribe |
| `RAZORPAY_KEY_SECRET`    | place-order, wallet-topup, subscribe |
| `RAZORPAY_WEBHOOK_SECRET`| verify-payment (HMAC signature) |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

## 3. Razorpay webhook

Razorpay dashboard → Webhooks → Add:

- URL:  `https://<ref>.supabase.co/functions/v1/verify-payment`
- Events: `payment.captured`, `payment.failed`, `order.paid`
- Secret: same value as `RAZORPAY_WEBHOOK_SECRET`

## 4. RLS — **run at launch, NOT before**

```
supabase/rls_policies.sql
```

RLS is intentionally OFF during development. When closing for launch:

1. Verify every Edge Function uses the service-role key (already done).
2. Verify every client read uses the authenticated anon key (already done).
3. Run `rls_policies.sql` in SQL editor. This enables RLS on every user-facing
   table and installs the policy set.
4. Smoke-test: `customer` can see their own orders, `staff` sees the kitchen queue,
   `admin` sees everything.

Rollback: `ALTER TABLE <x> DISABLE ROW LEVEL SECURITY;` per table, or drop the
policies individually. No data loss either way.

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
