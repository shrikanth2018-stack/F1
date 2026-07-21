# 1stOne — Operations & Maintenance Runbook

> **Provenance.** Written **2026-05-22** from the source at commit `f618c60` — the edge functions, the SQL in `supabase/sql/` (including `DEPLOY_SQL_ORDER.md`), `eas.json`, `app.config.js`, and the cron definitions. This is the “keep it running / fix it when it breaks” reference for the owner and whoever maintains the backend. Secret **values** are never printed here — only the names you set them under.

---

## 1. The moving parts you operate

| Thing | Where it lives | How you change it |
|---|---|---|
| Mobile app (Android/iOS) | EAS build → app stores; JS updates via OTA | EAS build / `eas update` |
| Web app | `dist/` (React Native Web) → hosting | rebuild + redeploy |
| Database + security rules | Supabase Postgres | SQL editor (idempotent files in `supabase/sql/`) |
| Server logic | 15 Supabase Edge Functions | `supabase functions deploy <name>` |
| Scheduled jobs | `pg_cron` inside Postgres | SQL editor |
| Business rules | `store_config` + `feature_flags` tables | **in-app Admin → Operations / Feature Flags** (no deploy) |
| Push copy | `notification_templates` table | **in-app Admin → Notification Manager** (no deploy) |
| Payments | Razorpay dashboard + webhook | Razorpay dashboard |
| Images / PDFs | Supabase Storage (`assets` bucket) | in-app uploaders / dashboard |

**Project ref:** `wcvqxzqqwcxlcgrjyunf` (Supabase). Region: India / `Asia/Kolkata`.

---

## 2. First-time / rebuild deploy order

The canonical, file-by-file order is in **`supabase/sql/DEPLOY_SQL_ORDER.md`** — follow it; the SQL files are idempotent (safe to re-run). The shape of it:

1. **Prerequisites** — `supabase login`, `supabase link --project-ref wcvqxzqqwcxlcgrjyunf`. Enable extensions once:
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_cron;
   CREATE EXTENSION IF NOT EXISTS pg_net;
   ```
2. **Vault / app_config secrets** the database needs to call edge functions:
   ```sql
   SELECT vault.create_secret('https://wcvqxzqqwcxlcgrjyunf.supabase.co', 'supabase_url');
   SELECT vault.create_secret('<service-role-key>', 'service_role_key');
   ```
   *(The cron jobs read URL + key from the `app_config` table; the kitchen-push path also reads the Vault. Both are referenced in the SQL.)*
3. **Schema & RPCs** — run the SQL files in the documented order (schema → RLS → RPCs → triggers → cron installers).
4. **The Auth hook** — in Supabase Dashboard → Authentication → Hooks, enable the **Custom Access Token** hook pointing at `public.custom_access_token_hook`. *Without this, no JWT carries a role and the whole app falls back to “customer”.*
5. **Edge Functions** — deploy each (most with `--no-verify-jwt`; they authenticate the caller themselves):
   ```bash
   supabase functions deploy quote-order   --no-verify-jwt
   supabase functions deploy place-order    --no-verify-jwt
   supabase functions deploy cancel-order   --no-verify-jwt
   supabase functions deploy verify-payment --no-verify-jwt
   # …and the rest (confirm-order, confirm-topup, wallet-topup, cycle-dispatch,
   #   apply-referral, reports, send-push, elevate-employee,
   #   subscription-expiry-push, low-wallet-check, dormant-user-check)
   ```
6. **Razorpay webhook** — point `https://wcvqxzqqwcxlcgrjyunf.supabase.co/functions/v1/verify-payment` at events `payment.captured`, `payment.failed`, `order.paid`, secret = `RAZORPAY_WEBHOOK_SECRET`.

> **Important deploy coupling:** the `place-order` payload is **not** backward-compatible with old app builds — deploy it **together** with the matching app release. (Old builds that send the legacy `groups` payload are rejected with a “please update the app” message.)

---

## 3. Configuration surface — what you can change without a deploy

### 3.1 `store_config` (Admin → Operations Manager) — the single business-rules row

| Field | Meaning |
|---|---|
| `tax_rate_percentage` | GST rate; tax is carved **out** of the inclusive price. |
| `delivery_fee` | Default delivery fee (zones/hubs can override). |
| `min_wallet_topup` / `max_wallet_topup` | Wallet top-up bounds. |
| `low_wallet_threshold` | Below this + a renewal due → low-wallet push. |
| `loyalty_points_per_rupee` | Earn rate (redeem is fixed 1 pt = ₹1). |
| `cancellation_window_hours` | How long an order stays cancellable from creation. |
| `winback_inactive_days` | Inactivity before the dormant win-back push. |
| `whatsapp_support_number` | Customer support WhatsApp. |
| `storm_mode_active` | **Pauses all ordering** (see §7). |
| `essentials_module_active` / `hub_delivery_active` | Mirror the matching feature flags. |

### 3.2 `feature_flags` (Admin → Feature Flags)

| Flag | Effect when ON |
|---|---|
| `storm_mode_active` | Ordering paused business-wide. |
| `essentials_module_active` | The Essentials tab/module is available to customers. |
| `hub_delivery_active` | Hub-based delivery routing is active; hub operators see their hub’s orders. |
| `branch_management_active` | **Strict multi-branch isolation.** OFF = single-branch permissive mode (the safe default pre-launch). Flip ON only after branch data + tokens are ready (see Doc 1 §5). |

### 3.3 Delivery cycles (Admin → Delivery → Cycles)

Each cycle’s `cutoff_time`, `kitchen_push_time`, `delivery_start`, `is_essentials`, and `essentials_label` are editable in-app. **These directly drive dispatch dates and the kitchen-push timing** — change them carefully (a wrong cutoff shifts everyone’s delivery day).

### 3.4 Notification copy (Admin → Notification Manager)

Edit any push’s title/body (`{{variables}}`) or switch it off, per `event_key`. A disabled template sends nothing; a missing one falls back to the code’s built-in copy.

---

## 4. Scheduled jobs (cron) & how to watch them

| Job (cron name) | Schedule | Does | Dedupe / log |
|---|---|---|---|
| `kitchen-cutoff-push-tick` | `* * * * *` (every min) | Per cycle past `kitchen_push_time`: generate subscription orders, then push the kitchen summary. | `kitchen_push_log` (keyed to delivery date) |
| `subscription-expiry-push` | 09:00 IST | Notify subs ending in 1–2 days. | — |
| `low-wallet-check` | 09:30 IST | Warn low-wallet customers with imminent renewal. | reads `app_config` |
| `dormant-user-check` | weekly (Mon) | Win-back push to long-inactive customers. | reads `app_config` |
| idempotency-key cleanup | hourly | Purge old `idempotency_keys`. | — |
| `cron-failure-alert` | hourly (`15 * * * *`) | Push branch admins if any job failed in the window. | — |

**Watch them two ways:**
- **In-app:** Admin → Operations → **System Health** (`JobHealthScreen` → `get_job_health()`): every job’s last run + status + 24h failure count, the last 7 manifest runs, and 24h push outcomes.
- **SQL:** `SELECT * FROM cron.job;` and `SELECT * FROM cron.job_run_details ORDER BY runid DESC LIMIT 20;`

**Manual kitchen-push helpers** (from `kitchen_cutoff_push.sql`):
```sql
-- force a cycle's summary now:
SELECT push_kitchen_summary(<cycle_id>, CURRENT_DATE);
-- retry a specific date (clear the dedupe row first):
DELETE FROM kitchen_push_log WHERE cycle_id=<id> AND push_date='YYYY-MM-DD';
SELECT push_kitchen_summary(<id>, 'YYYY-MM-DD');
```
**Manual manifest run:** `SELECT generate_daily_manifest('YYYY-MM-DD', <cycle_id>);` (idempotent — re-running won’t double-create).

> If `low-wallet-check` / `dormant-user-check` ever fail with a NULL-url error, it means the `app_config` rows (`supabase_url`, `service_role_key`) are missing — `fix_failing_crons.sql` is the reference fix.

---

## 5. Secrets & environment variables

### 5.1 Edge Function secrets (set in Supabase, **never** in the repo)

| Name | Used by |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | every function |
| `SUPABASE_ANON_KEY` | functions that act on behalf of the caller |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | `place-order`, `wallet-topup`, `confirm-order`, `confirm-topup` |
| `RAZORPAY_WEBHOOK_SECRET` | `verify-payment` (it **refuses to run** without it — a missing secret would otherwise let anyone mark orders paid) |

### 5.2 App build env (in `eas.json`, public by design)

`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_RAZORPAY_KEY_ID`, `EXPO_PUBLIC_GOOGLE_MAPS_KEY`, `EXPO_PUBLIC_SENTRY_DSN`. These are *public* keys (anon/publishable) — safe in the client. The repo currently carries **Razorpay test** keys (`rzp_test_…`); switch to live keys for production. EAS uses `appVersionSource: remote` and `autoIncrement` on production.

---

## 6. Releasing changes

| Change type | How to ship |
|---|---|
| **JS-only** (UI, copy, logic in `src/`) | **OTA** — `eas update --channel production`. Users get it on next launch (`checkAutomatically: ON_LOAD`). No store review. |
| **Native** (new permission, SDK bump, new native dep) | Full EAS build + store submission; bump `version` in `app.config.js`. |
| **Business rule / config** | In-app (Admin) — no deploy. |
| **Server logic** | `supabase functions deploy <name>`. Re-deploy `place-order` and the app **together** if the order contract changes. |
| **DB schema** | New idempotent SQL file in `supabase/sql/`, run in SQL editor; keep `DEPLOY_SQL_ORDER.md` updated. |

`npm run check` (`tsc --noEmit && jest`) and the Husky pre-push hook gate code changes locally.

---

## 7. Storm mode — the emergency stop

To pause all new orders (weather, kitchen down): Admin → Operations → **Storm Mode ON** (or set `feature_flags.storm_mode_active` / `store_config.storm_mode_active`). Effect: customers see a paused banner and lose the cart button; `quote-order`/`place-order` reject new orders (403). **Existing orders, subscriptions, and dispatch are unaffected.** Turn it off to resume.

---

## 8. Money reconciliation — the alerts that need a human

The system self-heals where it can and **pushes branch admins** when it can’t. If you receive one of these, act on it:

| Alert (push `event_key`) | What happened | What to do |
|---|---|---|
| `admin.wallet_refund_failed` | An order was cancelled but the wallet refund didn’t credit. | Open the order (the push deep-links to `AdminOrderDetail`); manually credit the wallet for the noted amount; quote the reference timestamp. |
| `admin.subscription_create_failed` | A paid order’s subscription row(s) failed to create. | Customer paid but has no subscription — create it manually or refund; reference in the push. |
| `place-order` “could not auto-refund” (returned to the customer) | A wallet order failed to persist **and** the auto-refund failed. | Reconcile from the structured server log (search the reference timestamp). |
| Razorpay portion on a cancellation | `cancel-order` reports `razorpay_refund_due` > 0. | Online-paid money isn’t auto-refunded — issue it from the **Razorpay dashboard**. |

These are deliberate: the customer-facing action (cancel/charge) always completes atomically; only the secondary money move can lag, and when it does, it’s made loud rather than silent.

---

## 9. Common operational questions

- **“A customer’s payment went through but the order shows Pending.”** The webhook (`verify-payment`) and the app’s `confirm-order` are both idempotent; it usually resolves within seconds. Check `push_logs` / Razorpay dashboard for the `payment.captured` event. The customer’s own home screen offers a pending-payment recovery banner.
- **“Kitchen didn’t get its summary.”** Check `kitchen_push_log` for the cycle+date; if absent, the tick hasn’t fired (check `cron.job_run_details`); if present with `orders_count = 0`, there were genuinely no orders. Re-fire with `push_kitchen_summary` (§4).
- **“Subscriptions didn’t dispatch.”** Check `manifest_run_log` and System Health. Re-run `generate_daily_manifest` for the date/cycle (idempotent).
- **“A staff member can’t see today’s orders.”** Staff screens show only the **active batch** (latest kitchen push) plus past undelivered orders — if no cycle has pushed yet today, the board is empty by design (Doc 2 §7.4). Hub operators only see their assigned hub.
- **“Out-of-zone customer can’t check out.”** Expected — they entered via “Enter Anyway”. They must add a serviceable address (the home screen nudges them).
- **“Promoted someone to staff/driver but the app still shows customer.”** The role is in the login token; it refreshes on app foreground. A sign-out/in forces it immediately.

---

## 10. Backups, logging & observability

- **Errors / crashes:** Sentry (DSN in `eas.json`), tagged with the active user.
- **Product analytics:** PostHog (login, order placed/failed, subscribed events).
- **Push delivery:** every attempt logged to `push_logs` (status, Expo ticket, error); dead tokens auto-deactivated.
- **Job runs:** `manifest_run_log`, `kitchen_push_log`, `cron.job_run_details`, all surfaced in System Health.
- **Database backups:** Supabase platform-managed (configure retention in the Supabase dashboard).

---

*End of Doc 4. Companion docs: Doc 1 (Architecture & Data Model), Doc 2 (Business Logic & Flows), Doc 3 (Screen-by-Screen), **Doc 07 (Incident Playbooks & Recovery — outages, OTA rollback, key rotation, DR)**.*
