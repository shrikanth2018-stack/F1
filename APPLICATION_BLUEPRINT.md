# 1stOne F1 — Application Blueprint

> **Generated:** 2026-05-20
> **Method:** Code-first audit of repo + live Supabase project `wcvqxzqqwcxlcgrjyunf` (ap-southeast-1).
> **Sources of truth:** `src/`, `supabase/functions/`, `supabase/sql/`, `app.config.js`, `package.json`, `eas.json`, and live `information_schema` / `pg_catalog` / `cron.job` / `pg_policies` / `pg_publication_tables`.
> **Out of scope:** `node_modules/`, `dist/`, `.expo/`, any `*.md`, prior conversation context, memory store.
> **Citations:** `path/file.ts:LINE`, `table:column`, `(supabase/functions/<name>)`. Unverified items tagged `[NEEDS VERIFICATION]`.
> **Tone:** facts only — no opinions, no severity, no improvement suggestions.

---

## Table of contents

1. [System overview & tech stack](#1-system-overview--tech-stack)
2. [Database schema & data layer](#2-database-schema--data-layer)
3. [Core logic, functions & flows](#3-core-logic-functions--flows)
4. [Integrations, subscriptions & external dependencies](#4-integrations-subscriptions--external-dependencies)
5. [Specifications & env configurations](#5-specifications--env-configurations)
6. [Maintenance & error handling](#6-maintenance--error-handling)
7. [Self-audit](#7-self-audit)

---

## 1. System overview & tech stack

### 1.1 What the app is

1stOne F1 is a single React Native + Expo client (`name: '1stOne'`, `slug: '1stOne-F1'`, `package.json:2`) backed by a single Supabase project. The same binary serves three roles, switched purely on a JWT custom claim:

- **Customer** — order food / essentials, manage subscriptions, wallet, referrals (`src/navigation/CustomerNavigator.tsx`).
- **Staff** — kitchen / packing / delivery dashboard, attendance, expense claims (`src/navigation/StaffNavigator.tsx`).
- **Admin** — reports, catalogs, branches, hubs, push, finance, store config (`src/navigation/AdminNavigator.tsx`).

`RootNavigator` switches between the three based on `session.role` and a derived `isDriverStaff` (`src/navigation/RootNavigator.tsx:141-152`). Driver-staff are routed through `CustomerNavigator` while keeping `role='staff'` for RLS (`src/navigation/RootNavigator.tsx:142`).

### 1.2 Runtime stack (from `package.json:43-83`)

| Layer | Library | Version |
|---|---|---|
| App version | `1stOne-F1` | `1.3.2-stable.1` (`package.json:3`) |
| JS engine | Hermes (explicit in `app.config.js:43`) | — |
| Framework | `expo` | `~54.0.0` |
| Runtime | `react-native` | `0.81.5` |
| React | `react` / `react-dom` | `19.1.0` / `^19.1.0` |
| Navigation | `@react-navigation/native`, `@react-navigation/native-stack` | `^7.0.0` |
| Server state | `@tanstack/react-query` | `^5.60.0` |
| Client state | `zustand` | `^5.0.0` |
| Supabase | `@supabase/supabase-js` | `^2.45.0` |
| Maps (native) | `react-native-maps` | `1.20.1` |
| Maps (web) | `@react-google-maps/api` | `^2.20.8` |
| Payments | `react-native-razorpay` | `^2.3.0` |
| Reanimated | `react-native-reanimated` | `~4.1.1` |
| Gesture handler | `react-native-gesture-handler` | `~2.28.0` |
| Storage | `@react-native-async-storage/async-storage` | `2.2.0` |
| Net status | `@react-native-community/netinfo` | `11.4.1` |
| Crash reporter | `@sentry/react-native` | `^8.7.0` |
| Analytics | `posthog-react-native` | `^4.41.2` |
| Push | `expo-notifications` | `~0.32.16` |
| OTA | `expo-updates` | `~29.0.17` |
| Location | `expo-location` | `~19.0.8` |
| File I/O | `expo-file-system`, `expo-print`, `expo-sharing`, `expo-document-picker`, `expo-image-picker` | various |
| Web build | `react-native-web` | `^0.21.2` |

### 1.3 Build tooling

- **Type-check + tests gate:** `npm run check` → `tsc --noEmit && jest` (`package.json:16`).
- **Tests:** Jest with `jest-expo` preset, 23 test files in `src/__tests__/` (`package.json:19-42`).
- **Linter:** ESLint flat config with `@typescript-eslint`, `eslint-plugin-react-hooks` (`package.json:86-95`).
- **Husky:** prepare hook (`package.json:15`).
- **patch-package:** `postinstall` runs `patch-package` (`package.json:14`).
- **knip:** dev dependency for dead-code detection (`package.json:100`).
- **Type generation:** `supabase:gen-types` runs `supabase gen types typescript --project-id wcvqxzqqwcxlcgrjyunf --schema public` → `src/types/database.types.ts` (`package.json:17`).

### 1.4 Provider stack (`App.tsx:92-104`)

Outer → inner:
1. `ErrorBoundary` (`src/components/ErrorBoundary.tsx`).
2. `QueryClientProvider` with `staleTime: 2 minutes`, `retry: 2`, `refetchOnWindowFocus: false`, mutation `retry: 1` (`App.tsx:47-58`, `src/utils/constants.ts:41`).
3. `AuthProvider` (`src/hooks/useAuth.ts:83-226`).
4. `SafeAreaProvider`.
5. `StatusBar barStyle="light-content" backgroundColor="#151515"` (`App.tsx:83`).
6. `OfflineBanner` (`src/components/OfflineBanner.tsx`).
7. `LoadingOverlay` driven by `useUIStore.isGlobalLoading` (`App.tsx:86`, `src/store/uiStore.ts:13-15`).
8. `RootNavigator` (`src/navigation/RootNavigator.tsx`).
9. `DialogHost` (global confirm-dialog) (`src/components/DialogHost.tsx`).

`SplashScreen.preventAutoHideAsync()` is called at module load; the splash is held until `useAuth().isLoading` flips false, with a 5s watchdog timer (`App.tsx:45,70-79`). `initSentry()` and `initAnalytics()` run synchronously at import time (`App.tsx:35-36`).

### 1.5 OTA wiring

- `app.config.js:122-126` — `updates.url: 'https://u.expo.dev/81ff7f3c-8f25-4acc-9a4f-605bff80bdd2'`, `updates.checkAutomatically: 'ON_LOAD'`, `fallbackToCacheTimeout: 0`.
- `app.config.js:128-130` — `runtimeVersion: { policy: 'sdkVersion' }`.
- `eas.json:30-35` — production channel `production`, `autoIncrement: true`, `appVersionSource: "remote"`.
- `App.tsx:65-66` — `useOTAUpdates()` runs an additional foreground check, prompts the user once per session, applies on tap via `Updates.reloadAsync()` (`src/hooks/useOTAUpdates.ts:23-64`).

### 1.6 Realtime client wiring

`useAuth` keeps `supabase.realtime.setAuth(...)` in lockstep with the JWT — on initial `getSession()` and inside `onAuthStateChange` (`src/hooks/useAuth.ts:92-116`). Subscribers (`useRealtimeOrders`) therefore never call `setAuth` themselves. Comment explains the reason: subscribing as anon before the auth callback resolves triggered a tight CLOSED/subscribe loop on RN (`src/hooks/useAuth.ts:104-110`).

---

## 2. Database schema & data layer

> Source: live PostgreSQL queries against `information_schema.tables / columns`, `pg_constraint`, `pg_indexes`, `pg_policies`, `pg_publication_tables`, `pg_proc`, `information_schema.triggers`, `cron.job` — run 2026-05-20 16:41 UTC via direct connection to project `wcvqxzqqwcxlcgrjyunf` (pooler `aws-1-ap-southeast-1.pooler.supabase.com:5432`).
>
> Where this diverges from `supabase/sql/schema.sql`, **trust this section** — `schema.sql` lags behind production migrations (extra-table delta documented below).

### 2.1 Public tables (43)

```
admin_notes                       app_config                       app_feedback
app_settings                      attendance_correction_days       attendance_correction_requests
banners                           branches                         business_expenses
cancelled_subscription_days       customer_addresses               delivery_cycles
delivery_hubs                     delivery_zones                   essentials_catalog
expense_claims                    feature_flags                    idempotency_keys
kitchen_push_log                  loyalty_redemptions              manifest_run_log
menu_items                        notification_templates           order_item_ratings
order_items                       orders                           pending_wallet_topups
profiles                          push_logs                        push_notification_tokens
referral_settings                 referrals                        staff_attendance
staff_leaves                      staff_order_requests             staff_salary
staff_shifts                      store_config                     subscription_plan_items
subscription_plans                supply_batches                   supply_catalog
supply_order_items                user_subscriptions               wallet_transactions
```

### 2.2 Column inventory (selected, by domain)

#### 2.2.1 Identity & profile

`profiles` — one row per `auth.users.id`. PK is the auth UUID (FK `profiles_id_fkey → auth.users(id)`).

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | — (FK to `auth.users`) |
| `phone_number` | `text` | NOT NULL | — (UNIQUE: `profiles_phone_number_key`) |
| `full_name` | `text` | NULL | — |
| `role` | `text` | NULL | `'customer'` (CHECK: `'customer','staff','admin'`) |
| `assigned_hub_id` | `integer` | NULL | — |
| `branch_id` | `integer` | NULL | (FK → `branches`) |
| `wallet_balance` | `numeric` | NULL | `0.00` |
| `loyalty_points` | `integer` | NULL | `0` |
| `referral_code` | `text` | NULL | — (UNIQUE: `profiles_referral_code_key`) |
| `referred_by` | `uuid` | NULL | (FK → `profiles`) |
| `employee_id` | `text` | NULL | — |
| `designation` | `text` | NULL | — |
| `joining_date` | `date` | NULL | — |
| `shift_timing` | `text` | NULL | — |
| `monthly_salary` | `numeric` | NULL | `0` |
| `benefits` | `text` | NULL | — |
| `exit_date` | `date` | NULL | — |
| `is_super_admin` | `boolean` | NOT NULL | `false` |
| `created_at`, `updated_at` | `timestamptz` | NULL | `now()` |

#### 2.2.2 Branches, hubs, zones, cycles

`branches` (8 cols) — `id`, `branch_name NOT NULL`, `address`, `phone`, `is_active default true`, `essentials_enabled NOT NULL default true`, timestamps.

`delivery_cycles` (12 cols) — `id`, `cycle_name NOT NULL`, `cutoff_time NOT NULL` (`time without time zone`), `kitchen_push_time NOT NULL`, `delivery_start NOT NULL`, `is_active default true`, `is_essentials default false`, `branch_id`, `sort_order default 0`, `essentials_label`, timestamps.

`delivery_hubs` (20 cols) — `hub_name NOT NULL`, `address_details NOT NULL`, `contact_phone`, `branch_id`, `is_active default true`, `hub_code`, `polygon_geojson jsonb`, `center_lat double precision`, `center_lng double precision`, `staff_user_id uuid` (FK → `auth.users`), `staff_name`, `staff_phone`, `extends_coverage NOT NULL default false`, `driver_code`, `delivery_fee_override numeric`, `commission_percent numeric`, `driver_user_id uuid` (FK → `auth.users`), timestamps.

`delivery_zones` (12 cols) — `zone_name NOT NULL`, `description`, `delivery_fee_override`, `is_active default true`, `branch_id`, `hub_id` (FK → `delivery_hubs`), `polygon_geojson jsonb`, `driver_code`, `driver_user_id` (FK → `auth.users`), timestamps.

#### 2.2.3 Catalog

`menu_items` (10 cols) — `cycle_id` (FK → `delivery_cycles`), `name NOT NULL`, `price NOT NULL numeric`, `ingredients text`, `is_active default true`, `branch_id` (FK), `sort_order default 0`, timestamps.

`essentials_catalog` (10 cols) — `cycle_id` (FK), `name NOT NULL`, `price NOT NULL`, `unit default 'piece'`, `is_active default true`, `branch_id`, `sort_order default 0`, timestamps.

`subscription_plans` (12 cols) — `cycle_id` (FK), `plan_name NOT NULL`, `duration_days NOT NULL int`, `price NOT NULL`, `savings_amount default 0.00`, `is_active default true`, `plan_type` (CHECK: `'food','essentials'`), `branch_id` (FK), `plan_items text` (JSON-as-text — see `orderBuild.ts:298-305` for parser), timestamps.

`subscription_plan_items` (5 cols, legacy) — `plan_id` (FK CASCADE), `item_id`, `item_type` (CHECK: `'food','essential'`), `quantity default 1`. Per `supabase/sql/generate_daily_manifest.sql` comment block (BF-02): the live order builder reads from `subscription_plans.plan_items` JSON; the standalone `subscription_plan_items` table is legacy / not driven by current admin UI.

`supply_catalog` (5 cols) — `id uuid default gen_random_uuid()`, `name NOT NULL`, `category NOT NULL`, `is_active default true`. Composite UNIQUE `(name, category)`.

#### 2.2.4 Orders

`orders` (23 cols):

| Column | Type | Notes |
|---|---|---|
| `id` | `int` | PK |
| `user_id` | `uuid` | FK → `profiles` |
| `subscription_id` | `int` | FK → `user_subscriptions` (when row is dispatch-derived) |
| `total_amount` | `numeric` | NOT NULL |
| `tax_amount` | `numeric` | default `0.00` |
| `delivery_fee` | `numeric` | default `0.00` |
| `status` | `text` | default `'Confirmed'` — CHECK below |
| `order_type` | `text` | CHECK `'food','essential'` |
| `dispatch_date` | `date` | NOT NULL |
| `cycle_id` | `int` | FK → `delivery_cycles` |
| `delivery_method` | `text` | default `'direct'`, CHECK `'direct','hub'` |
| `hub_id` | `int` | FK → `delivery_hubs` |
| `payment_method` | `text` | CHECK `'wallet','razorpay','split'` |
| `razorpay_order_id` | `text` | shared across the order group's rows |
| `wallet_amount_used` | `numeric` | default `0.00`, per-row |
| `delivery_address_id` | `int` | FK → `customer_addresses` |
| `branch_id` | `int` | FK → `branches` |
| `notes` | `text` | — |
| `razorpay_payment_id` | `text` | — |
| `paid_at` | `timestamptz` | — |
| `order_group_id` | `uuid` | NOT NULL default `gen_random_uuid()` — links a multi-cycle checkout's rows |
| `created_at`, `updated_at` | `timestamptz` | default `now()` |

`orders.status` CHECK (`orders_status_allowed`): `'Pending','Confirmed','Preparing','Ready','Packed','Dispatched','Received at Hub','On the Way','Delivered','Cancelled','Failed'`.

`order_items` (7 cols) — `order_id` (FK CASCADE), `item_id int`, `item_type default 'food'` (CHECK `'food','essential','subscription'`), `item_name NOT NULL`, `quantity NOT NULL int`, `price_at_time NOT NULL numeric`.

`order_item_ratings` (7 cols) — `order_id NOT NULL bigint` (FK CASCADE), `order_item_id NOT NULL` (FK CASCADE), `user_id NOT NULL` (FK → `auth.users` CASCADE), `rating smallint NOT NULL` (CHECK 1–5), `comments`, `created_at`. UNIQUE `(order_id, order_item_id, user_id)`.

#### 2.2.5 Subscriptions & cancellations

`user_subscriptions` (14 cols) — `user_id` (FK → `profiles`), `plan_id` (FK → `subscription_plans`), `start_date NOT NULL date`, `days_consumed default 0`, `is_paused default false`, `is_active default true`, `payment_method`, `razorpay_order_id`, `branch_id` (FK SET NULL), `wallet_amount_used default 0`, `razorpay_payment_id`, timestamps. `payment_method` CHECK matches `orders.payment_method`.

`cancelled_subscription_days` (7 cols) — `subscription_id` (FK CASCADE), `cancelled_date NOT NULL`, `cycle_id` (FK → `delivery_cycles`), `reason text`, `branch_id`, timestamps. UNIQUE `(subscription_id, cancelled_date, cycle_id)`.

#### 2.2.6 Wallet & loyalty

`wallet_transactions` (8 cols) — `user_id` (FK), `amount NOT NULL`, `transaction_type` (CHECK `'credit','debit'`), `description NOT NULL`, `reference_type`, `reference_id`, `created_at`.

`pending_wallet_topups` (6 cols) — PK `razorpay_order_id text`, `user_id NOT NULL`, `amount NOT NULL`, `status NOT NULL default 'pending'` (CHECK `'pending','completed','failed'`), `created_at`, `completed_at`.

`loyalty_redemptions` (7 cols) — `user_id`, `points NOT NULL int`, `type` (CHECK `'earned','redeemed'`), `description`, `reference_order_id` (FK → `orders`), `created_at`.

#### 2.2.7 Referrals

`referrals` (8 cols) — `referrer_id` (FK → `profiles`), `referee_id` (FK), `status default 'pending'` (CHECK `'pending','completed','expired'`), `reward_given default false`, `first_order_reward_given default false`, `month_reward_given default false`, `created_at`.

`referral_settings` (13 cols) — singleton. `referrer_reward_points default 50`, `referee_reward_points default 50`, `referrer_wallet_credit default 0.00`, `referee_wallet_credit default 0.00`, `is_active default false`, `referee_signup_credit default 0`, `referrer_first_order_points default 0`, `referrer_first_order_credit default 0`, `referrer_month_credit default 0`, `milestone_star_count default 5`, `milestone_ambassador_count default 25`, `updated_at`.

#### 2.2.8 Staff workflows

`staff_attendance` (10 cols) — `staff_id` (FK → `profiles`), `clock_in_time`, `clock_out_time`, `clock_in_lat/lng`, `clock_out_lat/lng`, `date NOT NULL`, `branch_id`. UNIQUE `(staff_id, date)` via `staff_attendance_staff_date_unique`.

`staff_leaves` (10 cols) — `staff_id`, `start_date NOT NULL`, `end_date NOT NULL`, `reason`, `status default 'Pending'` (CHECK `'Pending','Approved','Rejected'`), `approved_by` (FK), `branch_id`, timestamps.

`attendance_correction_requests` (10 cols) — `staff_id NOT NULL`, `reason NOT NULL` (CHECK `length(trim(reason)) > 0`), `status default 'pending'` (CHECK `'pending','approved','rejected'`), `reviewed_by` (FK), `reviewed_at`, `reviewer_note`, `branch_id`, timestamps. Used by `useAttendanceCorrections` (`src/hooks/useAttendanceCorrections.ts`) and approval RPC `approve_attendance_correction`.

`attendance_correction_days` (3 cols) — `request_id NOT NULL bigint` (FK CASCADE), `the_date NOT NULL date`. UNIQUE `(request_id, the_date)`.

`staff_shifts` (10 cols) — `staff_id`, `shift_name NOT NULL`, `start_time NOT NULL`, `end_time NOT NULL`, `days_of_week text[] default {Mon,Tue,Wed,Thu,Fri,Sat}`, `is_active default true`, `branch_id`, timestamps.

`staff_salary` (13 cols) — `staff_id`, `month int NOT NULL` (CHECK 1–12), `year NOT NULL`, `base_salary NOT NULL`, `deductions default 0.00`, `bonus default 0.00`, `net_salary NOT NULL`, `is_paid default false`, `paid_at`, `branch_id`. UNIQUE `(staff_id, month, year)`.

`expense_claims` (11 cols) — `staff_id`, `category` (CHECK `'Grocery','Vegetable','Stationery','Fuel','Expense'`), `description NOT NULL`, `amount default 0.00`, `status default 'Pending'` (CHECK `'Pending','Approved','Rejected','Paid'`), `approved_by`, `branch_id`, `paid_at`, timestamps.

`business_expenses` (11 cols) — admin-recorded business spend. `category NOT NULL`, `description NOT NULL`, `amount NOT NULL`, `expense_date NOT NULL`, `vendor`, `is_paid default false`, `paid_at`, `recorded_by` (FK → `profiles`), `branch_id`, `created_at`.

`staff_order_requests` (9 cols) — `request_type NOT NULL` (CHECK `'Vegetables','Grocery','Stationery'`), `items jsonb NOT NULL default '[]'`, `status default 'Pending'` (CHECK `'Pending','Approved','Rejected'`), `submitted_by`, `approved_by`, `branch_id`, timestamps.

#### 2.2.9 Supply (post-onboarding inventory ops)

`supply_batches` (7 cols) — `printed_at default now()`, `printed_by`, `items_snapshot jsonb NOT NULL default '[]'`, `note`, `branch_id`, `created_at`.

`supply_order_items` (9 cols) — `name NOT NULL`, `qty NOT NULL int default 1`, `category NOT NULL` (CHECK `'Vegetables','Grocery','Stationery'`), `request_id` (FK → `staff_order_requests` SET NULL), `batch_id` (FK → `supply_batches` SET NULL), `added_by`, `branch_id`, `created_at`.

#### 2.2.10 Configuration & operations

`store_config` (15 cols) — global singleton (`store_config_pkey` on `id`; only one row in production per `supabase/functions/_shared/storeConfig.ts:51-57` `.single()`):

| Column | Type | Default | NOT NULL |
|---|---|---|---|
| `tax_rate_percentage` | `numeric` | `5.00` | YES |
| `delivery_fee` | `numeric` | `0.00` | YES |
| `cancellation_window_hours` | `int` | `2` | YES |
| `storm_mode_active` | `bool` | `false` | NO |
| `essentials_module_active` | `bool` | `false` | NO |
| `hub_delivery_active` | `bool` | `false` | NO |
| `loyalty_points_per_rupee` | `numeric` | `0.10` | NO |
| `min_wallet_topup` | `numeric` | `100.00` | YES |
| `max_wallet_topup` | `numeric` | `50000` | YES |
| `whatsapp_support_number` | `text` | `'9448364017'` | NO |
| `low_wallet_threshold` | `numeric` | `200` | YES |
| `winback_inactive_days` | `int` | `14` | NO |

`feature_flags` (5 cols) — `flag_key text UNIQUE NOT NULL`, `flag_value bool default false`, `description`, `updated_at`. Read by `src/hooks/useFeatureFlag.ts:17-23`.

`app_config` (2 cols) — `key text PK`, `value text NOT NULL`. Used by SQL cron jobs to read `'supabase_url'` and `'service_role_key'` so `pg_net.http_post` can reach edge functions (`supabase/sql/cron_failure_alert.sql:39-50`, `supabase/sql/kitchen_cutoff_push.sql:38-58`).

`app_settings` (6 cols) — `id default 1` with CHECK `(id = 1)`, `login_bg_url NOT NULL default <unsplash URL>`, `landing_hero_url`, `staff_designations jsonb`, `staff_benefits jsonb`, `updated_at`.

`banners` (8 cols) — `banner_type` (CHECK `'image','text'`), `image_url`, `text_content`, `is_live default false`, `branch_id`, timestamps.

`notification_templates` (8 cols) — `event_key text PK`, `title_template NOT NULL`, `body_template NOT NULL`, `is_enabled NOT NULL default true`, `trigger_source`, `description`, `variables text[] NOT NULL default '{}'`, `updated_at`. Resolved by `supabase/functions/_shared/notifications.ts:80-114` and `supabase/functions/send-push/index.ts:115-143`.

`idempotency_keys` (5 cols) — `key text PK`, `user_id NOT NULL` (FK → `profiles`), `endpoint NOT NULL`, `response jsonb`, `created_at NOT NULL default now()`. Cleared hourly by cron `expire-idempotency-keys` (see § 6.1).

`kitchen_push_log` (7 cols) — `cycle_id NOT NULL` (FK CASCADE), `push_date NOT NULL`, `pushed_at default now()`, `orders_count default 0`, `items_summary text`, `http_request_id bigint`. UNIQUE `(cycle_id, push_date)` — the dedupe key.

`manifest_run_log` (7 cols) — `run_date NOT NULL`, `ran_at default now()`, `orders_created default 0`, `orders_skipped default 0`, `subs_skipped default 0`, `error_detail text`. Written by `generate_daily_manifest()` (see § 3.6.2).

`push_logs` (12 cols) — `user_id` (FK → `auth.users` SET NULL), `token`, `title NOT NULL`, `body NOT NULL`, `data jsonb NOT NULL default '{}'`, `trigger_source NOT NULL default 'unknown'`, `reference_id text`, `expo_ticket_id text`, `status NOT NULL default 'pending'` (CHECK `'sent','failed','invalid_token','pending'`), `error_message`, `sent_at NOT NULL default now()`.

`push_notification_tokens` (7 cols) — `user_id` (FK CASCADE), `token NOT NULL`, `platform` (CHECK `'ios','android','web'`), `is_active default true`, timestamps. UNIQUE `(user_id, token)`.

`app_feedback` (6 cols) — `user_id` (FK → `profiles`), `order_id` (FK → `orders`), `rating int` (CHECK 1–5), `comments text`, `created_at`.

`customer_addresses` (20 cols) — `user_id` (FK CASCADE), `label default 'Home'`, `full_name NOT NULL`, `address_line NOT NULL`, `landmark`, `city`, `pincode`, `latitude/longitude numeric`, `is_default default false`, `is_active default true`, `zone_id` (FK SET NULL), `is_serviceable NOT NULL default false`, `hub_id` (FK SET NULL), `hub_impact_notified_at`, `branch_id` (FK SET NULL), `phone_number`, timestamps. PARTIAL UNIQUE: `customer_addresses_one_default_per_user` on `user_id WHERE is_default=true`.

`admin_notes` (8 cols) — `target_tab text` (CHECK `'kitchen','packing','delivery','all','hub'`), `note_text NOT NULL`, `is_active default true`, `created_by uuid` (FK), `branch_id` (FK), timestamps. UNIQUE `(target_tab, branch_id)` NULLS NOT DISTINCT — one active banner per (tab, branch).

### 2.3 CHECK constraints (full list)

| Constraint | Table | Definition |
|---|---|---|
| `admin_notes_target_tab_check` | `admin_notes` | `target_tab IN ('kitchen','packing','delivery','all','hub')` |
| `app_feedback_rating_check` | `app_feedback` | `rating BETWEEN 1 AND 5` |
| `single_row` | `app_settings` | `id = 1` |
| `attendance_correction_requests_reason_check` | `attendance_correction_requests` | `length(trim(reason)) > 0` |
| `attendance_correction_requests_status_check` | … | `status IN ('pending','approved','rejected')` |
| `banners_banner_type_check` | `banners` | `'image','text'` |
| `expense_claims_category_check` | `expense_claims` | `'Grocery','Vegetable','Stationery','Fuel','Expense'` |
| `expense_claims_status_check` | … | `'Pending','Approved','Rejected','Paid'` |
| `loyalty_redemptions_type_check` | … | `'earned','redeemed'` |
| `order_item_ratings_rating_check` | … | `1–5` |
| `order_items_item_type_check` | … | `'food','essential','subscription'` |
| `orders_delivery_method_check` | … | `'direct','hub'` |
| `orders_order_type_check` | … | `'food','essential'` |
| `orders_payment_method_check` | … | `'wallet','razorpay','split'` |
| `orders_status_allowed` | … | 11 statuses listed in § 2.2.4 |
| `pending_wallet_topups_status_check` | … | `'pending','completed','failed'` |
| `profiles_role_check` | … | `'customer','staff','admin'` |
| `push_logs_status_check` | … | `'sent','failed','invalid_token','pending'` |
| `push_notification_tokens_platform_check` | … | `'ios','android','web'` |
| `referrals_status_check` | … | `'pending','completed','expired'` |
| `staff_leaves_status_check` | … | `'Pending','Approved','Rejected'` |
| `staff_order_requests_request_type_check` | … | `'Vegetables','Grocery','Stationery'` |
| `staff_order_requests_status_check` | … | `'Pending','Approved','Rejected'` |
| `staff_salary_month_check` | … | `1–12` |
| `subscription_plan_items_item_type_check` | … | `'food','essential'` |
| `subscription_plans_plan_type_check` | … | `'food','essentials'` |
| `supply_order_items_category_check` | … | `'Vegetables','Grocery','Stationery'` |
| `user_subscriptions_payment_method_check` | … | `'wallet','razorpay','split'` |
| `wallet_transactions_transaction_type_check` | … | `'credit','debit'` |

### 2.4 Foreign keys

77 FK constraints in `public.*`. Notable cascade behaviors:

- **ON DELETE CASCADE:** `order_items.order_id`, `order_item_ratings.order_id / order_item_id / user_id`, `subscription_plan_items.plan_id`, `cancelled_subscription_days.subscription_id`, `attendance_correction_days.request_id`, `attendance_correction_requests.staff_id`, `customer_addresses.user_id`, `push_notification_tokens.user_id`, `kitchen_push_log.cycle_id`.
- **ON DELETE SET NULL:** `customer_addresses.{zone_id,hub_id,branch_id}`, `delivery_hubs.{staff_user_id,driver_user_id}`, `delivery_zones.{hub_id,driver_user_id}`, `staff_order_requests.{submitted_by,approved_by,branch_id}`, `supply_order_items.*`, `supply_batches.{printed_by,branch_id}`, `push_logs.user_id`, `user_subscriptions.branch_id`.

### 2.5 Indexes

65 indexes across 43 tables. Highlights (live):

- `orders` — 11 indexes including `idx_orders_branch/created/cycle/dispatch/group/hub/status/sub/type/user`.
- `profiles` — partial `idx_profiles_is_super_admin WHERE is_super_admin=true`, UNIQUE `phone_number`, UNIQUE `referral_code`.
- `customer_addresses` — partial UNIQUE `customer_addresses_one_default_per_user (user_id) WHERE is_default=true`.
- `attendance_correction_days` — UNIQUE `(request_id, the_date)`.
- `attendance_correction_requests` — composite `idx_attendance_correction_requests_status_branch (status, branch_id)`.
- `staff_attendance` — UNIQUE `(staff_id, date)`.
- `staff_salary` — UNIQUE `(staff_id, month, year)`.
- `kitchen_push_log` — UNIQUE `(cycle_id, push_date)`.
- `push_notification_tokens` — UNIQUE `(user_id, token)`.
- `cancelled_subscription_days` — UNIQUE `(subscription_id, cancelled_date, cycle_id)`.
- `admin_notes` — UNIQUE `(target_tab, branch_id)` NULLS NOT DISTINCT.
- `supply_catalog` — UNIQUE `(name, category)`.
- `order_item_ratings` — UNIQUE `(order_id, order_item_id, user_id)`.

### 2.6 RLS policies

Every table listed has RLS enabled (presence of any `pg_policies` row implies enabled). Selected representative policies (full list dumped from `pg_policies`):

#### Auth helpers (all `LANGUAGE sql` per `pg_proc` lookups [NEEDS VERIFICATION] — only signatures verified)

- `is_admin()` — non-SECURITY-DEFINER helper used by RLS.
- `is_staff_or_admin()` — same.
- `is_super_admin()` — non-SECDEF helper.
- `has_branch_access(row_branch_id integer)` — non-SECDEF, central branch gate.
- `jwt_branch_id()`, `jwt_user_role()` — non-SECDEF JWT claim accessors.

#### `orders`

- `orders_self` (SELECT) — `user_id = auth.uid() OR (is_staff_or_admin() AND has_branch_access(branch_id))`.
- `orders_self_insert` (INSERT) — `(user_id = auth.uid() AND status = 'Pending') OR (is_staff_or_admin() AND has_branch_access(branch_id))`.
- `orders_staff_update` (UPDATE) — `is_staff_or_admin() AND has_branch_access(branch_id)` (both USING + WITH CHECK).
- `orders_hub_op_select` (SELECT) — `(auth.jwt() ->> 'user_role') = 'customer' AND hub_id IS NOT NULL AND hub_id = (auth.jwt() ->> 'assigned_hub_id')::int` (hub-operator carve-out).
- `orders_hub_operator_update` (UPDATE) — same hub gate USING, plus WITH CHECK that `status IN (every status except final terminal ones)` [NEEDS VERIFICATION] — full status list truncated in dump, but confirmed includes all forward-flow statuses.

#### `profiles`

- `profiles_self_read` (SELECT) — `id = auth.uid() OR (is_staff_or_admin() AND has_branch_access(branch_id))`.
- `profiles_self_insert` (INSERT) — `id = auth.uid() OR (is_admin() AND has_branch_access(branch_id))`.
- `profiles_self_update` (UPDATE) — same as insert.
- `profiles_admin_all` (ALL) — `is_admin() AND has_branch_access(branch_id)`.
- `profiles_auth_hook_bypass` (SELECT, role=`supabase_auth_admin`) — `true`. Used so `custom_access_token_hook` can read `profiles` when minting tokens (`supabase/sql/custom_access_token_hook.sql:80-83`).

#### `customer_addresses`

- `addresses_self` (ALL) — `user_id = auth.uid() OR (is_staff_or_admin() AND has_branch_access(branch_id))`.
- `customer_addresses_hub_op_select` (SELECT) — `hub_id IS NOT NULL AND hub_id = (auth.jwt() ->> 'assigned_hub_id')::int`.

#### `wallet_transactions`

- `wallet_tx_self` (SELECT) — `user_id = auth.uid() OR (is_staff_or_admin() AND has_branch_access(profile.branch_id))`.
- `wallet_tx_no_writes` (INSERT) — WITH CHECK `is_admin() AND has_branch_access(profile.branch_id)` — clients cannot insert; writes flow via SECURITY DEFINER RPCs.

#### `attendance_correction_*`

- Self-insert restricted to `status = 'pending'` (`attendance_correction_requests_self_insert`).
- `attendance_correction_days_self` — staff can ALL only while parent row is `status='pending'` (WITH CHECK includes that filter).

#### Hub operator + driver carve-outs

- `kitchen_push_log_driver` (SELECT, role=`authenticated`) — caller must appear in `delivery_hubs.driver_user_id` OR `delivery_zones.driver_user_id`.
- `admin_notes_hub_op_read` (SELECT) — `target_tab='hub' AND has_branch_access(branch_id) AND exists(profile with role='customer' AND assigned_hub_id NOT NULL)`.

#### Read-everywhere tables (`USING true`)

`branches`, `delivery_cycles`, `delivery_hubs`, `delivery_zones`, `essentials_catalog`, `menu_items`, `subscription_plans`, `subscription_plan_items`, `banners`, `feature_flags`, `referral_settings`, `store_config`, `app_settings`. Writes on most of these are gated on `is_admin() AND has_branch_access(branch_id)`; `branches`, `feature_flags`, `store_config`, `referral_settings`, `app_settings` writes require `is_super_admin()`.

### 2.7 Public functions (54 total)

Selected — full list available in `/tmp/dbcheck/funcs.json` snapshot.

#### Atomic write RPCs (all `SECURITY DEFINER`)

- `place_order_atomic(p_user_id uuid, p_status, p_order_type, p_delivery_method, p_hub_id, p_payment_method, p_razorpay_order_id, p_delivery_address_id, p_notes, p_branch_id, p_groups jsonb) RETURNS TABLE(new_order_id bigint, new_group_id uuid, new_cycle_id bigint, new_dispatch_date date)` — see `supabase/sql/mf10_place_order_atomic.sql:37-115`.
- `mark_order_paid(p_razorpay_order_id, p_razorpay_payment_id) RETURNS TABLE(order_id, user_id, total_amount)` — flips every order sharing the Razorpay order id from `Pending` to `Confirmed`/`Paid` [NEEDS VERIFICATION on exact transitions, body not read].
- `mark_order_failed(p_razorpay_order_id, p_reason)` — sets `status='Failed'`.
- `complete_wallet_topup(p_razorpay_order_id, p_razorpay_payment_id) RETURNS TABLE(user_id uuid, amount numeric)` — credits the wallet idempotently.
- `decrement_wallet_balance_if_sufficient(p_user_id, p_amount, p_description, p_reference_type, p_reference_id) RETURNS boolean` — atomic gated debit, called by `place-order` (`supabase/functions/place-order/index.ts:202-206`).
- `increment_wallet_balance(p_user_id, p_amount, p_description, p_reference_type, p_reference_id) RETURNS void` — credit. Used by `cancel-order` refund (`supabase/functions/cancel-order/index.ts:242-248`) and `apply-referral` signup credit (`supabase/functions/apply-referral/index.ts:99-105`).
- `tag_wallet_debit_to_order(p_user_id, p_order_id)` — back-fills the wallet_transactions row's `reference_id` with the freshly created order id (`supabase/functions/place-order/index.ts:279-287`).
- `increment_loyalty_points(p_user_id, p_points)` — used by `apply-referral` (line 110-113) and referral first-order trigger.
- `redeem_loyalty_points(p_points) RETURNS jsonb` — caller-context (uses `auth.uid()`).
- `admin_cancel_order_atomic(p_order_id, p_refund_amount, p_reason DEFAULT 'Cancelled by admin') RETURNS jsonb`.
- `admin_cancel_subscription_atomic(p_subscription_id, p_refund_amount) RETURNS jsonb`.
- `approve_attendance_correction(p_request_id) RETURNS jsonb` — atomic. Inserts `staff_attendance` rows for every `attendance_correction_days.the_date`, sets request `status='approved'`; refuses if any of the requested days already has a `staff_attendance` row (verified by header comment of `useAttendanceCorrections.ts:148-153`).
- `reject_attendance_correction(p_request_id, p_note DEFAULT NULL) RETURNS jsonb`.
- `advance_orders_status(p_order_ids bigint[], p_status text) RETURNS integer` — bulk staff status transition.
- `elevate_to_staff(...)` and `demote_employee(target_id uuid)` — staff onboarding/offboarding.
- `complete_onboarding_atomic(p_user_id, p_phone_number, p_full_name, p_label, p_address_line, ...) RETURNS bigint` — combined profile + first address insert at signup.
- `set_default_address(p_address_id bigint)`.
- `update_employee_profile(target_id uuid, updates jsonb)`, `set_employee_designation(target_id uuid, new_designation text)`.

#### Read RPCs

- `get_active_staff_batch(p_branch_id integer DEFAULT NULL) RETURNS TABLE(cycle_id, push_date)` — used by `useActiveStaffBatch` to scope the staff dashboard to a single cycle/push.
- `get_kitchen_aggregate(p_cycle_id bigint, p_dispatch_date date) RETURNS TABLE(item_name, unit, total_quantity, status, order_ids[])` — non-SECDEF (per pg_proc).
- `get_job_health() RETURNS jsonb` — admin-gated observability bundle (see § 6.3).
- `get_hub_impact_addresses(p_hub_id)`, `get_addresses_for_hub_assignment(p_hub_id)`, `assign_hub_to_address_ids(p_hub_id, p_address_ids)`, `assign_addresses_to_hub(p_hub_id) RETURNS integer`, `assign_hub_operator(p_hub_id, p_new_user_id, p_old_user_id)`.
- `auth_user_id_by_phone(p_phone) RETURNS uuid` — bridges `auth.users` for the elevate-employee flow (`supabase/functions/elevate-employee/index.ts:94-100`).
- `resolve_address_serviceability(p_lat, p_lng) RETURNS TABLE(result, is_serviceable, zone_id, zone_name, hub_id, hub_name)`.
- `point_in_polygon(p_lat, p_lng, p_poly jsonb) RETURNS boolean` — non-SECDEF.

#### Maintenance functions

- `trigger_kitchen_cutoff_pushes() RETURNS void` — per-minute cron entry point that calls `push_kitchen_summary` for each cycle whose cutoff has just passed.
- `push_kitchen_summary(p_cycle_id, p_target_date DEFAULT CURRENT_DATE) RETURNS jsonb` — aggregates orders/items and `pg_net.http_post`s `send-push`. Detailed in `supabase/sql/kitchen_cutoff_push.sql:61-130`.
- `generate_daily_manifest(p_target_date DEFAULT tomorrow, p_cycle_id DEFAULT NULL) RETURNS jsonb` — subscription dispatch generator. Called by `trigger_kitchen_cutoff_pushes` (per BF-01/02/19 header in `supabase/sql/generate_daily_manifest.sql:1-32`).
- `backfill_dispatch_manifest(p_start_date, p_end_date) RETURNS jsonb` — admin-triggered re-run for a window.
- `alert_cron_failures() RETURNS void` — § 6.1.

#### Triggers (SECURITY DEFINER unless noted)

- `update_updated_at_column()` (no SECDEF) — BEFORE UPDATE on 22 tables.
- `derive_address_branch_id()` (no SECDEF) — BEFORE INSERT/UPDATE on `customer_addresses`.
- `set_attendance_correction_branch_id()`, `set_cancelled_day_branch_id()`, `set_expense_claim_branch_id()`, `set_staff_order_request_branch_id()` — BEFORE INSERT on each table — auto-tag `branch_id`.
- `handle_new_user()` — fires on `auth.users` insert (Supabase auth schema; not visible in `information_schema.triggers` of `public.*`, confirmed only by `supabase/sql/handle_new_user.sql`'s existence).
- `handle_first_order_referral_bonus()` — AFTER INSERT/UPDATE on `orders`.
- `mirror_staff_request_to_supply_items()` — AFTER INSERT on `staff_order_requests`.
- `sync_profile_phone_on_auth_update()` — phone change reconciliation (mirrors `auth.users.phone` into `profiles.phone_number`; trigger lives on `auth.users` per `supabase/sql/sync_phone_on_auth_update.sql`).
- `custom_access_token_hook(event jsonb)` — Supabase auth hook (`supabase/sql/custom_access_token_hook.sql`); injects `user_role`, `branch_id`, `assigned_hub_id`, `is_super_admin`, `is_driver` claims.

### 2.8 Trigger inventory (public schema, from `information_schema.triggers`)

| Table | Trigger | Timing/Event | Function |
|---|---|---|---|
| `admin_notes` | `trg_admin_notes_updated` | BEFORE UPDATE | `update_updated_at_column` |
| `attendance_correction_requests` | `trg_attendance_correction_branch_id` | BEFORE INSERT | `set_attendance_correction_branch_id` |
| `attendance_correction_requests` | `trg_attendance_correction_requests_updated` | BEFORE UPDATE | `update_updated_at_column` |
| `banners` | `trg_banners_updated` | BEFORE UPDATE | `update_updated_at_column` |
| `branches` | `trg_branches_updated` | BEFORE UPDATE | `update_updated_at_column` |
| `cancelled_subscription_days` | `trg_cancelled_day_branch_id` | BEFORE INSERT | `set_cancelled_day_branch_id` |
| `customer_addresses` | `trg_address_branch_id` | BEFORE INSERT/UPDATE | `derive_address_branch_id` |
| `customer_addresses` | `trg_addresses_updated` | BEFORE UPDATE | `update_updated_at_column` |
| `delivery_cycles` | `trg_delivery_cycles_updated` | BEFORE UPDATE | `update_updated_at_column` |
| `delivery_hubs` | `trg_delivery_hubs_updated` | BEFORE UPDATE | `update_updated_at_column` |
| `delivery_zones` | `trg_delivery_zones_updated` | BEFORE UPDATE | `update_updated_at_column` |
| `essentials_catalog` | `trg_essentials_updated` | BEFORE UPDATE | `update_updated_at_column` |
| `expense_claims` | `trg_expense_claim_branch_id` | BEFORE INSERT | `set_expense_claim_branch_id` |
| `expense_claims` | `trg_expense_updated` | BEFORE UPDATE | `update_updated_at_column` |
| `feature_flags` | `trg_feature_flags_updated` | BEFORE UPDATE | `update_updated_at_column` |
| `menu_items` | `trg_menu_items_updated` | BEFORE UPDATE | `update_updated_at_column` |
| `orders` | `trg_first_order_referral_bonus` | AFTER INSERT/UPDATE | `handle_first_order_referral_bonus` |
| `orders` | `trg_orders_updated` | BEFORE UPDATE | `update_updated_at_column` |
| `profiles` | `trg_profiles_updated` | BEFORE UPDATE | `update_updated_at_column` |
| `push_notification_tokens` | `trg_push_tokens_updated` | BEFORE UPDATE | `update_updated_at_column` |
| `referral_settings` | `trg_referral_settings_updated` | BEFORE UPDATE | `update_updated_at_column` |
| `staff_leaves` | `trg_leaves_updated` | BEFORE UPDATE | `update_updated_at_column` |
| `staff_order_requests` | `staff_order_requests_mirror` | AFTER INSERT | `mirror_staff_request_to_supply_items` |
| `staff_order_requests` | `trg_staff_order_request_branch_id` | BEFORE INSERT | `set_staff_order_request_branch_id` |
| `staff_salary` | `trg_salary_updated` | BEFORE UPDATE | `update_updated_at_column` |
| `staff_shifts` | `trg_shifts_updated` | BEFORE UPDATE | `update_updated_at_column` |
| `store_config` | `trg_store_config_updated` | BEFORE UPDATE | `update_updated_at_column` |
| `subscription_plans` | `trg_sub_plans_updated` | BEFORE UPDATE | `update_updated_at_column` |
| `user_subscriptions` | `trg_user_subs_updated` | BEFORE UPDATE | `update_updated_at_column` |

### 2.9 Realtime publication

`supabase_realtime` publication membership in `public` (verified via `pg_publication_tables`):

- `admin_notes`
- `kitchen_push_log`
- `orders`

These are the three tables `useRealtimeOrders` subscribes to (`src/hooks/useRealtimeOrders.ts:68-104`). The history is noted in `supabase/sql/realtime_publication.sql:1-12` (BF-44: prior to that migration the publication was empty in prod). `realtime.messages_*` tables are auto-managed Supabase partitions.

### 2.10 Schema drift from `supabase/sql/schema.sql`

The repo's `schema.sql` documents 29 tables; production has 43. Tables present in DB but absent from `schema.sql` (verified by file listing) include: `app_config`, `app_settings`, `attendance_correction_days`, `attendance_correction_requests`, `business_expenses`, `idempotency_keys`, `kitchen_push_log`, `manifest_run_log`, `notification_templates`, `order_item_ratings`, `pending_wallet_topups`, `push_logs`, `staff_order_requests`, `supply_batches`, `supply_catalog`, `supply_order_items`. These are documented via individual `supabase/sql/*.sql` migration files that post-date `schema.sql`.

### 2.11 Client data-access layer

A single Supabase JS client (`src/api/supabaseClient.ts:22-29`):
- `react-native-url-polyfill/auto` is required only on native (`src/api/supabaseClient.ts:15-17`).
- Auth storage: `AsyncStorage` on native, `undefined` (→ default `localStorage`) on web.
- `auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }`.

All Supabase reads/writes from app code route through wrappers (`src/api/useSupabaseQuery.ts:1-237`):

- `useSupabaseQuery<T>(key, fnOrTable, options?)` — two-overload signature (callback or table-shorthand), optional `transform`. Throws on `response.error`. Defaults: `staleTime: 2 min`, `retry: 2`.
- `useSupabaseSingle<T>(...)` — returns first row or `null`.
- `useSupabaseInfiniteQuery<T>(key, fn(offset), { pageSize, enabled })` — offset-paginated.
- `useSupabaseMutation<TPayload, TResult>(fn, invalidateKeys?, { onSuccess?, onError? })` — calls `queryClient.invalidateQueries` per key on success.

Edge-function invocations go through one of:
- `invokeFunction<T>(name, body?, { headers?, fallbackMessage? })` (`src/api/invokeFunction.ts:24-66`) — adds `Authorization: Bearer <access_token>`, normalises errors, returns `T` directly.
- Direct `supabase.functions.invoke(...)` for calls with bespoke needs (idempotency keys, 409 drift handling, fire-and-forget pushes). Documented exceptions: `place-order` and `confirm-order` in `CheckoutScreen.tsx:233/327`.
- `sendPush(body)` (`src/api/sendPush.ts:40-51`) — fire-and-forget wrapper for `send-push`, never throws.

### 2.12 Generated types

`src/types/database.types.ts` is generated by `supabase gen types typescript --schema public` (see `package.json:17`). The custom types in `src/types/*.ts` (`auth.ts`, `cart.ts`, `catalog.ts`, `config.ts`, `customer.ts`, `delivery.ts`, `marketing.ts`, `notifications.ts`, `orders.ts`, `staff.ts`, `subscriptions.ts`, `supply.ts`, `index.ts`) are hand-written domain shapes that compose with the generated row types [NEEDS VERIFICATION on individual contents — only filenames inspected].

---

## 3. Core logic, functions & flows

### 3.1 Auth & session

#### 3.1.1 Sign-in flow

- `LoginScreen` handles phone entry + OTP entry in one screen with internal phases (`src/screens/auth/LoginScreen.tsx` [NEEDS VERIFICATION on internals — file referenced from `src/navigation/RootNavigator.tsx:32`]).
- `useAuth.signInWithPhone(phone)` calls `supabase.auth.signInWithOtp({ phone })` (`src/hooks/useAuth.ts:151-154`).
- `useAuth.verifyOTP(phone, token)` calls `supabase.auth.verifyOtp({ phone, token, type: 'sms' })` (`src/hooks/useAuth.ts:156-164`). On success, `trackLogin()` fires a PostHog event.
- New users (no profile row yet) are routed to `OnboardingScreen` (`RootNavigator.tsx:116-135`) which calls the `complete_onboarding_atomic` RPC (`profile + first address` in one transaction).

#### 3.1.2 JWT claims & extraction

`custom_access_token_hook(event jsonb)` injects 5 claims (`supabase/sql/custom_access_token_hook.sql:40-78`):

| Claim | Source | Type |
|---|---|---|
| `user_role` | `profiles.role` | `'customer','staff','admin'` |
| `branch_id` | `profiles.branch_id` | bigint or null |
| `assigned_hub_id` | `profiles.assigned_hub_id` | bigint or null |
| `is_super_admin` | `profiles.is_super_admin` | boolean |
| `is_driver` | `EXISTS (delivery_hubs WHERE driver_user_id=uid) OR EXISTS (delivery_zones WHERE driver_user_id=uid)` | boolean |

Client extraction: `extractRole(session)` decodes `session.access_token` as base64 JSON, reads the five claims, and returns `AuthSession` (`src/hooks/useAuth.ts:36-81`). Fallback role on parse error: `'customer'`.

#### 3.1.3 Session lifecycle

- Initial: `supabase.auth.getSession()` once, plus `supabase.realtime.setAuth(token)` (`src/hooks/useAuth.ts:92-95`).
- Live: `supabase.auth.onAuthStateChange` updates `session` + realtime token on every event (`src/hooks/useAuth.ts:111-116`).
- Foreground refresh: `AppState` `'active'` triggers `supabase.auth.refreshSession()` so server-side claim changes (e.g. customer promoted to driver) propagate without manual relogin (`src/hooks/useAuth.ts:124-131`).
- Sign-out: best-effort delete this device's push token row before `supabase.auth.signOut()`; clears `cartStore`, `essentialsCartStore`, `staffQueueStore` (`src/hooks/useAuth.ts:186-221`). Push-cleanup races a 3-second timeout (`src/hooks/useAuth.ts:193-209`).
- Phone change: `verifyPhoneChange` calls `supabase.auth.verifyOtp({ type: 'phone_change' })`, then `refreshSession` to pick up the new phone on the live JWT (`src/hooks/useAuth.ts:171-184`). SQL trigger `sync_profile_phone_on_auth_update` mirrors the new phone into `profiles.phone_number`.

### 3.2 Routing

Three nested stacks under `NavigationContainer ref={navigationRef}` (`src/navigation/RootNavigator.tsx:144-150`):

#### 3.2.1 CustomerNavigator (`src/navigation/CustomerNavigator.tsx`)

Native stack, no tabs. Screens (`headerShown: false`, `animation: 'slide_from_right'`): `Home`, `Orders`, `Subscriptions`, `Cart`, `Checkout`, `OrderDetail`, `EditProfile`, `AddAddress`, `PlanDetail`, `Wallet` (modal), `Referral`, `Feedback`, `Plans` (modal), `LoyaltyPoints` (modal), `HubDashboard`, `HubOrderHistoryDetail`, `DriverDashboard`.

#### 3.2.2 StaffNavigator (`src/navigation/StaffNavigator.tsx`)

`StaffDashboard` (root), `Attendance`, `StaffExpenses`, `StaffProfile`. No bottom tabs — Kitchen/Packing/Delivery are inline top tabs in `StaffDashboard.tsx`.

#### 3.2.3 AdminNavigator (`src/navigation/AdminNavigator.tsx`)

`AdminHome` (root, 2-tab Reports | Manage) plus 30+ drill-down screens including:
- Reports: `OrderReport`, `RevenueReport`, `SubscriptionReport`, `StaffReport`, `HubReport`.
- Catalog: `MenuManage`, `CreateMenu`, `CreatePlan`, `PlansManage`, `EssentialsCatalogManage`, `CreateEssential`, `ImportItems`.
- Delivery: `DeliveryManage`, `HubDetail`.
- Resource: `ResourceManager`, `EmployeeDetail`, `OnboardEmployee`.
- Notifications: `PushNotifications` (`NoteToStaffScreen`), `CustomerPush` (`SpecialOfferBannerScreen`), `NotificationManager`.
- Marketing: `LoginBg`, `ReferralSettings`, `CustomerFeedback`.
- Finance: `ExpenseManager`, `StockManager`.
- Operations: `AdminOrders`, `AdminOrderDetail`, `AdminSubscriptions`, `StoreConfig`, `FeatureFlags`, `JobHealth`.
- Super-admin only (gated in-screen): `BranchesManage`, `CustomerExport`.

### 3.3 Branch resolution

`useBranchFilter` (`src/hooks/useBranchFilter.ts:60-104`) resolves the active branch for reads + writes with this precedence:

1. JWT `branch_id` (admin/staff with a fixed branch).
2. If super-admin and JWT has no branch → `useBranchStore.selectedBranchId` (Zustand, persisted to AsyncStorage at key `1stone-branch-filter`, `src/store/branchStore.ts:21-34`).
3. Customer/driver → default address `branch_id`, fall back to first address (`useAddresses`).
4. Sole-branch fallback: when `branches.length === 1`, use that one (`src/hooks/useBranchFilter.ts:89-90`).
5. `branch_management_active` feature flag controls `isActive` (turning it off bypasses filtering).

`requireWriteBranch(bf)` throws if `branchIdForWrite == null` — used at every `INSERT/UPDATE` site (`src/hooks/useBranchFilter.ts:113-118`).

Per-branch essentials gate: `useEssentialsEnabled()` reads `branches[bf.branchId].essentials_enabled` and returns `true` when branches haven't loaded or no branch is resolved (`src/hooks/useEssentialsEnabled.ts:28-37`). The legacy `feature_flags.essentials_module_active` row is intentionally not read (header comment lines 21-23).

### 3.4 Cart, quote, place order

#### 3.4.1 Client carts

Two persisted Zustand stores with AsyncStorage:
- `useCartStore` (`src/store/cartStore.ts:34-128`) — main food cart. Key: `1stone-cart`, version 2. Holds `items: CartItem[]` (`menu_item_id`, `cycle_id`, `display_price`, `quantity`) and `plans: CartPlan[]`.
- `useEssentialsCartStore` (`src/store/essentialsCartStore.ts:39-126`) — Essentials cart. Key: `1stone-essentials-cart`, version 2.

Both expose `addItem`, `removeItem`, `updateQuantity`, `addPlan`, `removePlan`, `setSinglePlan` (one-plan invariant per order — `cartStore.ts:88`), `clearPlans`, `clearCart`, `clearCycle`, `getItemCount`, `getDisplayTotal`. Pricing is display-only; server recalculates at checkout.

#### 3.4.2 Quote (preview)

`useOrderQuote` calls the `quote-order` edge function with the flat cart + optional address; the function delegates to `buildAuthoritativeOrder` (`supabase/functions/quote-order/index.ts:66-77` → `supabase/functions/_shared/orderBuild.ts:109-420`).

Key pricing rule (`orderBuild.ts:14-21`, T1): **catalog prices are GST-inclusive**. The customer sees the catalog price; `tax_amount` is the slice carved OUT of that price, never added on top (`orderBuild.ts:127`: `(gross * taxRate) / (100 + taxRate)`).

Server-derived per-group fields:
- `cycle_id`, `dispatch_date` (IST, server clock — never client) — derived in `_shared/dispatch.ts:43-72` by `resolveClock(now)` against `Asia/Kolkata`.
- `scenario`: A/B/C — `dispatch.ts:83-92`. Same-day cycle: A before cutoff (today), B after (tomorrow). Cross-midnight cycle: B before today's cutoff (tomorrow), C after (day after tomorrow).
- `subtotal`, `tax_amount`, `delivery_fee`, `total_amount`, `group_total_paise`.
- Delivery fee goes on the **earliest-dispatch group only** (`orderBuild.ts:362-378`).
- Fee priority: hub override → zone override → `store_config.delivery_fee` default (`orderBuild.ts:153-162`).
- Subscription plans (when in cart): conflict check (overlapping item + date range) at `orderBuild.ts:291-332`; an own group with `cycle_id=null` and `dispatch_date = today` is appended (`orderBuild.ts:335-356`).

Return shape (`curateQuote(o)`, `orderBuild.ts:427-453`): `{ groups, order_type, subtotal_total, tax_total, delivery_fee, grand_total, total_paise, dispatches:[{cycle_id, dispatch_date, group_total_paise}], has_scenario_c, storm_mode, serviceable, fee_pending }`.

#### 3.4.3 Place order (commit)

`place-order` (`supabase/functions/place-order/index.ts`) flow:

1. **CORS** — origin allow-list `SUPABASE_URL, http://localhost:8081, http://localhost:19006` (lines 47-51).
2. **JWT** — `getUserFromJwt(token)` verifies ES256 against project JWKS (`_shared/auth.ts:43-56`). Null → `401`.
3. **Rate limit** — max 5 calls per user per 60 s, counted via `idempotency_keys.endpoint='place-order'` rows in the last minute (lines 82-91). Returns `429` if exceeded.
4. **Idempotency short-circuit** — if `Idempotency-Key` header matches a stored row, return the cached response (lines 94-102).
5. **Outdated-app guard** — refuses requests carrying the legacy `groups` field (lines 117-119).
6. **Server-authoritative quote** — calls `buildAuthoritativeOrder(...)` with a single `new Date()` read (lines 135-145).
7. **Storm + serviceability** — order refused if `storm_mode || !serviceable` (lines 148-154).
8. **Drift check** — `driftedFields(server, client_quote)` compares integer-paise tuples (`_shared/dispatch.ts:128-152`). Any drift returns `409 quote_changed` with the fresh quote curated; no order created (lines 156-170).
9. **Razorpay order create** — only when `payment_method='razorpay'`; `POST https://api.razorpay.com/v1/orders` with HTTP Basic auth (`KEY_ID:KEY_SECRET`) (lines 175-197).
10. **Wallet debit** — `decrement_wallet_balance_if_sufficient` RPC; refuses if insufficient (lines 199-209).
11. **`place_order_atomic` RPC** — inserts one `orders` row + `order_items` per dispatch group, all sharing one fresh `order_group_id`, in a single transaction (`supabase/sql/mf10_place_order_atomic.sql:37-115`). Returns the new ids.
12. **Wallet rollback on RPC failure** — `increment_wallet_balance` reverses the debit (lines 237-267). If rollback also fails, logs `[REFUND-FAILURE]` and returns a structured 500 with a reference timestamp.
13. **Tag wallet debit** — `tag_wallet_debit_to_order(p_user_id, p_order_id)` back-fills the now-known order id onto the existing wallet_transactions row (lines 279-287; idempotent — filters on `reference_id IS NULL`).
14. **Subscription rows** — for every `loaded_plan`, insert one `user_subscriptions` row. `is_active = (payment_method === 'wallet')` — wallet payments activate immediately; Razorpay activation happens when `verify-payment` / `confirm-order` flips `is_active=true` (lines 290-311).
15. **G2 subscription-create-failure alert** — if any sub insert failed, log `[SUBSCRIPTION-CREATE-FAILURE]` + push to all admins via `resolveAndSendPush('admin.subscription_create_failed')` (lines 317-345).
16. **Cache response under Idempotency-Key** — written ONLY on success (lines 360-368).
17. **Customer push for wallet orders** — `resolveAndSendPush('order.confirmed')` (lines 370-386).

#### 3.4.4 Client side (`src/screens/customer/CheckoutScreen.tsx:230-394`)

1. Scenario-C consent dialog when `quote.has_scenario_c` (lines 210-225).
2. `supabase.functions.invoke('place-order', { Idempotency-Key: <UUID>, body: { items, subscription_plans, delivery_address_id, payment_method, client_quote } })`.
3. On `409 quote_changed/quote_required` → `refetchQuote()` and prompt user to re-confirm (lines 259-269).
4. On Razorpay: `RazorpayCheckout.open({ description, currency:'INR', key, amount, order_id, name, prefill:{contact}, theme })` (lines 280-298). Wrapped in `setTimeout(...,500)` to let nav settle.
5. After Razorpay resolve: `supabase.functions.invoke('confirm-order', { order_id, razorpay_payment_id, razorpay_order_id, razorpay_signature })` — retried once after 1 s (lines 317-336).
6. Cache invalidation: `MY_ORDERS`, `WALLET`, `PROFILE`, `SUBSCRIPTIONS` (lines 339-344).
7. Analytics: `trackOrderPlaced(...)` + optional `trackSubscribed(...)` (lines 346-349).
8. Idempotency key is rotated via `newIdempotencyKey()` on success (line 355).

#### 3.4.5 Razorpay payment platform shim

- Native: `src/utils/razorpay.native.ts:1-21` — wraps `RNRazorpay.open` in `InteractionManager.runAfterInteractions(...)` + `setTimeout(150ms)` so the SDK fires after react-native-screens commits the UIViewController.
- Web: `src/utils/razorpay.ts:1-12` — rejects with a clear error (no Razorpay RN SDK on web).

### 3.5 Order status flow

#### 3.5.1 Statuses (`orders_status_allowed` CHECK)

`Pending → Confirmed → Preparing → Ready → Packed → Dispatched → Received at Hub → On the Way → Delivered`. Terminal: `Cancelled`, `Failed`.

#### 3.5.2 Status writers

- `place-order` writes `Pending` (Razorpay) or `Confirmed` (wallet) (`place-order/index.ts:212`).
- `confirm-order` flips every `orders` row sharing the `razorpay_order_id` from `Pending → Confirmed` after HMAC verify (`confirm-order/index.ts:130-140`).
- `verify-payment` webhook does the same via `mark_order_paid` RPC + flips subscriptions to `is_active=true` (`verify-payment/index.ts:98-205`).
- `mark_order_failed` flips to `Failed` on `payment.failed` (`verify-payment/index.ts:219`).
- Staff advances via `advance_orders_status(bigint[], text)` RPC — bulk transition.
- Hub-operator RLS allows them to UPDATE `orders` rows where `hub_id = jwt.assigned_hub_id` (`orders_hub_operator_update` policy).
- `cancel-order` writes `Cancelled` (see § 3.5.3).

#### 3.5.3 Cancellation

`cancel-order` (`supabase/functions/cancel-order/index.ts`):

1. **Group resolution** — load every row sharing `order_group_id` (lines 102-120).
2. **Subscription guard (G7)** — if any line is `item_type='subscription'`, refuse with 409 and direct the user to support (lines 123-141).
3. **Idempotency** — if the whole group is already `Cancelled`, return success without refund (lines 146-156).
4. **Cancellation window** — `(now - min(created_at)) > store_config.cancellation_window_hours` → 409 (lines 167-181).
5. **Earliest-cutoff guard** — the earliest cycle's `cutoff_time` (tie-breaking on lex sort) governs the whole group. If passed (same-day or cross-midnight), refuse (lines 183-227).
6. **Bulk update** — set `status='Cancelled', updated_at=now()` for every still-cancellable row (lines 230-237).
7. **Wallet refund** — sum `wallet_amount_used` over cancelled rows, credit via `increment_wallet_balance` (lines 239-278). On refund failure: log `[REFUND-FAILURE-ALERT]`, push admins via `resolveAndSendPush('admin.wallet_refund_failed')`; the order remains cancelled.
8. **Razorpay refund** — only the diff `total - wallet` is returned as `razorpay_refund_due`; admin reconciles manually (lines 280-287).

Cancellable statuses (line 34): `Pending, Confirmed, Paid, Preparing` — once `Ready` or later, the kitchen has the order and the user must contact support.

### 3.6 Subscription & dispatch

#### 3.6.1 Subscription life-cycle

- Created in `place-order` (or via the legacy `Plans` flow [NEEDS VERIFICATION on legacy path]).
- `user_subscriptions.is_active=true` is the gate for dispatch generation.
- `is_paused` is a user-facing pause toggle.
- `days_consumed` is incremented by `generate_daily_manifest` each time a dispatch order is created for that subscription.
- `cancelled_subscription_days` is the "skip a day" record — UNIQUE `(subscription_id, cancelled_date, cycle_id)` enforces idempotency.

#### 3.6.2 Dispatch generation

`generate_daily_manifest(p_target_date DEFAULT tomorrow, p_cycle_id DEFAULT NULL)` (`supabase/sql/generate_daily_manifest.sql:43+`):

- For each `user_subscriptions` row that is `is_active AND NOT is_paused`, with target day inside `[start_date, start_date + duration_days)`:
- Reads `subscription_plans.plan_items` JSON (BF-02 note in header: prior reads from `subscription_plan_items` table produced empty orders).
- Inserts a new `orders` row with `total_amount=0, tax_amount=0, delivery_fee=0` (BF-19: revenue captured at purchase, dispatch rows are operational).
- Inserts mirrored `order_items`.
- Increments `days_consumed`.
- Writes `manifest_run_log(run_date, orders_created, orders_skipped, subs_skipped, error_detail)`.
- Per BF-35b (header lines 50-60): fires customer-facing `'Order Confirmed'` push via `pg_net → send-push` for each generated dispatch row.

Idempotency: re-runs skip orders already created for `(subscription_id, dispatch_date)`.

Called by `trigger_kitchen_cutoff_pushes()` per-minute cron (canonical) and ad-hoc reruns (header note).

#### 3.6.3 Kitchen cutoff push

`push_kitchen_summary(p_cycle_id, p_target_date=CURRENT_DATE)` (`supabase/sql/kitchen_cutoff_push.sql:61-130+`):

1. Look up the cycle; abort if inactive.
2. Count `orders` for `(cycle_id, dispatch_date)` in statuses `Confirmed|Paid|Preparing`.
3. Aggregate `order_items` for that scope into `Item x Qty, Item x Qty` summary string, ordered by total quantity desc.
4. Insert `kitchen_push_log(cycle_id, push_date, orders_count, items_summary)` — UNIQUE `(cycle_id, push_date)` enforces idempotency.
5. POST to `/functions/v1/send-push` via `pg_net.http_post` using `app_config.supabase_url + app_config.service_role_key` for auth (per § 6.1 patterns).

### 3.7 Realtime dashboards

`useRealtimeOrders(enabled=true)` (`src/hooks/useRealtimeOrders.ts:52-124`):

- Mounted by `StaffDashboard`, `AdminHome`, `HubDashboardScreen`, `DriverDashboardScreen` (header comment).
- Subscribes to one channel `orders-realtime-${todayIST}-${instanceId}` (instanceId is `Math.random().toString(36).slice(2,10)` per mount to avoid topic collisions).
- Three `postgres_changes` listeners:
  - `orders`, event `*` → `invalidateOrderQueries(queryClient)`.
  - `kitchen_push_log`, `INSERT` → invalidate `['active_staff_batch']` + `invalidateOrderQueries`.
  - `admin_notes`, `*` → invalidate `['staff_notes']` and `['admin_notes']`.
- IST-midnight rollover: `setTimeout(() => { removeChannel(); invalidate('active_staff_batch'); resubscribe(); }, msUntilNextIstMidnight(now))` (lines 109-114).
- Midnight calc uses UTC arithmetic — explicit note that `toLocaleString({timeZone})` returns `Invalid Date` on Hermes (lines 32-41).

`invalidateOrderQueries(qc)` (`src/api/invalidateOrderQueries.ts:1-41`) — single chokepoint that invalidates every order-reading key [NEEDS VERIFICATION on the full key list — file head only inferred from import sites].

### 3.8 Push notifications

#### 3.8.1 Client-side registration

`usePushNotifications()` (`src/hooks/usePushNotifications.ts:73-148`):

- Configures foreground display (`shouldShowAlert/Sound/Banner/List: true`, `shouldSetBadge: false`) at module load (lines 27-35).
- On session: `Notifications.getPermissionsAsync() → requestPermissionsAsync() if needed` → `Notifications.getExpoPushTokenAsync({ projectId })` (lines 43-70).
- Android channel `default` with `AndroidImportance.HIGH`, vibration `[0,250,250,250]`, light `#38bdf8` (lines 56-63).
- Upsert into `push_notification_tokens` with `is_active:true`, `onConflict: 'user_id,token'` (lines 85-93).
- One-active-token-per-user invariant: retire every other row for this user_id (`is_active=false`) after the upsert (lines 105-112).
- Listeners: foreground `addNotificationReceivedListener` (no-op handler), tap `addNotificationResponseReceivedListener` → `navigationRef.navigate(data.screen, data.params)` (lines 124-141).
- Deep-link convention: `data: { screen: 'OrderDetail', params: { orderId } }`, `{ screen: 'Subscriptions' }`, `{ screen: 'Wallet' }`, etc. (header lines 8-13).

#### 3.8.2 Server-side push dispatch (two paths)

**Path A — `_shared/notifications.ts` (intra-edge calls):**
- `resolveAndSendPush({ supabase, eventKey, userIds, vars, fallback, data, referenceId })` (`supabase/functions/_shared/notifications.ts:213-220`).
- Template lookup in `notification_templates(event_key)`; `is_enabled=false` → skip; missing row → fallback title/body (lines 89-111).
- `{{var}}` substitution (lines 67-73).
- Direct query of `push_notification_tokens` (active only) → `POST https://exp.host/--/api/v2/push/send` in chunks of 100 (lines 116-184).
- Writes one `push_logs` row per token attempt; `status` from Expo ticket (`'sent','failed','invalid_token'`) (lines 165-198).
- Deactivates tokens reported as `DeviceNotRegistered` (lines 186-192).
- Runs as `EdgeRuntime.waitUntil(...)` background task so it survives the response (lines 54-64) — comment notes Supabase Edge kills un-awaited promises (lines 23-27).
- Header lines 14-22 explain why the helper bypasses calling `send-push` over HTTP: the function-to-function hop's service-role-key compare broke during the API-key migration on 2026-05-16.

**Path B — `send-push` edge function (client/staff-JWT callers):**
- `supabase/functions/send-push/index.ts:46-261`.
- Auth (lines 73-99):
  1. Direct compare against `SUPABASE_SERVICE_ROLE_KEY` env.
  2. `app_config.service_role_key` value (D5: tolerates env/app_config drift).
  3. Staff/admin JWT.
  4. Hub-operator JWT (`role='customer' AND assigned_hub_id IS NOT NULL`).
- Optional template resolution via `event_key` (lines 115-143).
- `user_ids` explicit, or `role` + `branch_id` filter (lines 149-158).
- Same Expo POST → push_logs cycle as Path A.

Client → `send-push` callers route through `sendPush(body)` (`src/api/sendPush.ts:40-51`) — fire-and-forget, never throws.

### 3.9 Staff dashboard

Header comments and shared types only verified (file body not read for `StaffDashboard.tsx`):
- Top tabs Kitchen / Packing / Delivery built inline.
- Scope: one cycle's batch (active staff batch from `get_active_staff_batch`) [NEEDS VERIFICATION on rendering specifics].
- Realtime via `useRealtimeOrders`.
- Banners via `useAdminNotes` (subscribes to `admin_notes` realtime).
- Staff offline queue store handles mark-delivered etc. during connectivity gaps (`src/store/staffQueueStore.ts:1-89`) — local UUID per mutation, replayable, `retryCount` tracked, persisted to AsyncStorage at key `1stone-staff-queue`.

### 3.10 Admin reports

`reports` edge function (`supabase/functions/reports/index.ts:74-208`) — admin-gated via `profiles.role='admin'` check (lines 64-66). Body: `{ report, start_date?, end_date?, branch_id? }`. Reports:

| Report | Source | Aggregation function |
|---|---|---|
| `revenue` | `orders` rows where `status != 'Cancelled'`, scope by `dispatch_date` | `aggregateRevenue` |
| `orders` | `orders` (counts by status/cycle/order_type) | `aggregateOrders` |
| `subscription` | `user_subscriptions` (total + active + cancelled-days count) | `aggregateSubscriptions` |
| `staffAttendance` | `staff_attendance` joined to `profiles` | `aggregateStaffAttendance` |
| `ordersDetail` | `orders + delivery_cycles + order_items` | `aggregateOrdersDetail` |
| `revenueDetail` | `orders` columns subset | `aggregateRevenueDetail` |
| `subscriptionPlan` | `user_subscriptions + subscription_plans` | `aggregateSubscriptionPlans` |
| `expense` | `expense_claims` | `aggregateExpenses` |
| `hub` | `orders` where `delivery_method='hub'` joined to `delivery_hubs` (incl. `commission_percent`) | `aggregateHubReport` |

All aggregation lives in `supabase/functions/_shared/reportAggregations.ts` (344 lines) — also unit-tested at `src/__tests__/reportAggregations.test.ts`. Branch filter applied at the SQL layer when `branchId != null` (header lines 16-19).

### 3.11 Referrals

#### 3.11.1 Apply

`apply-referral` (`supabase/functions/apply-referral/index.ts:36-121`):

1. Find referrer by `profiles.referral_code = code.toUpperCase().trim()` (lines 51-56).
2. Refuse if `referrer.id === user.id` (line 57).
3. Refuse if any row already exists for `referee_id = user.id` (lines 60-67) — single-use.
4. Refuse if `referral_settings.is_active=false` (line 76).
5. Insert `referrals(referrer_id, referee_id, status='pending', reward_given=false, …)`.
6. Update referee `profiles.referred_by`.
7. Credit `referee_signup_credit` via `increment_wallet_balance` (lines 98-106).
8. Credit `referee_reward_points` via `increment_loyalty_points` (lines 109-114).

Defaults if `referral_settings` row is null: `is_active=false`, `referee_signup_credit=50`, `referrer_first_order_points=100`, `referrer_first_order_credit=30`, `referrer_month_credit=100` (lines 123-130).

#### 3.11.2 First-order trigger

`handle_first_order_referral_bonus()` fires AFTER INSERT/UPDATE on `orders` (`trg_first_order_referral_bonus`). Logic detailed in `supabase/sql/referral_first_order_trigger.sql` [NEEDS VERIFICATION — file referenced but not read].

#### 3.11.3 Deep link

`1stone://referral?code=XXX` is parsed in `RootNavigator.tsx:68-87` — code is stashed in `pendingReferralCode` and auto-applied via `applyReferral.mutate(code)` once a session is live (lines 101-110).

### 3.12 Wallet top-up

#### 3.12.1 Initiate

`wallet-topup` (`supabase/functions/wallet-topup/index.ts:34-149`):

1. JWT verify.
2. Rate limit (5 per 60 s) using `idempotency_keys.endpoint='wallet-topup'`.
3. Idempotency short-circuit.
4. Validate amount against `store_config.{min_wallet_topup, max_wallet_topup}` (lines 93-102).
5. POST to `https://api.razorpay.com/v1/orders` with `amount=Math.round(amt*100)`, `currency='INR'`.
6. Insert `pending_wallet_topups(razorpay_order_id, user_id, amount, status='pending')`.
7. Cache response under Idempotency-Key.

Client: `useWalletTopup()` calls `invokeFunction('wallet-topup', { amount }, { headers:{'Idempotency-Key': newIdempotencyKey()} })` (`src/hooks/useWallet.ts:111-128`).

#### 3.12.2 Confirm

Two parallel paths (both idempotent):
- Client-side `confirm-topup` (`supabase/functions/confirm-topup/index.ts:38-119`) — HMAC verify against `razorpay_order_id|razorpay_payment_id`, then `complete_wallet_topup` RPC.
- Webhook `verify-payment` (`supabase/functions/verify-payment/index.ts:136-165`) — same RPC. "Whichever fires first wins" per `confirm-topup/index.ts:9`.

Either path: `complete_wallet_topup` flips `pending_wallet_topups.status` to `'completed'`, credits `profiles.wallet_balance`, writes a `wallet_transactions(credit)` row, fires `wallet.topped_up` push.

### 3.13 Hooks inventory (50 hooks)

`src/hooks/` listing (verified by `ls`):

```
useActiveStaffBatch        useAddresses              useAdminNotes
useAdminOrders             useAdminStats             useAttendance
useAttendanceCorrections   useAuth                   useBanner
useBranches                useBranchFilter           useBranchMutations
useCompleteOnboarding      useCustomerExport         useCustomerFeedback
useCycleDispatch           useDeliveryCycles         useDeliveryHubs
useDeliveryZones           useDispatchBackfill       useEssentials
useEssentialsCatalog       useEssentialsEnabled      useExpenseManager
useExpenses                useFeatureFlag            useHubOrderHistory
useHubReport               useJobHealth              useMenuItems
useMenuManagement          useNotificationTemplates  useOfflineSync
useOrderQuote              useOrders                 useOTAUpdates
usePushNotifications       useRealtimeOrders         useReferrals
useReports                 useResourceManager        useSmartCart
useSmartEssentialsCart     useStaffManagement        useStaffOrders
useStockManager            useStoreConfig            useSubscriptionPlans
useSubscriptions           useWallet                 useWalletNudge
```

### 3.14 Utility modules (`src/utils/`)

`analytics.ts`, `assets.ts`, `confirmDialog.ts`, `constants.ts`, `csvBuilder.ts`, `csvParsers.ts`, `cycleLabels.ts`, `deliveryStatus.ts`, `env.ts`, `exportCsv.ts`, `formatters.ts`, `idempotency.ts`, `istDate.ts`, `links.ts`, `orderFilters.ts`, `orderStatus.ts`, `orderStatusPush.ts`, `packingFlow.ts`, `razorpay.native.ts`, `razorpay.ts`, `sentry.ts`, `serviceability.ts`, `subscriptionConflict.ts`, `subscriptionMath.ts`, `timeEngine.ts`, `validators.ts`.

Key facts:
- `timeEngine.ts` is presentation-only — `formatTime12h`, `getDispatchLabel`. The dispatch DECISION lives in `supabase/functions/_shared/dispatch.ts`, called via `cycle-dispatch` / `quote-order` / `place-order` (`src/utils/timeEngine.ts:1-9` header).
- `istDate.ts` provides `istDateStr`, `todayIST`, `istDateWithOffset`, `addDaysToISODate`, `istMinutesNow` — never use `Date.toISOString().split('T')[0]` (header comment lines 8-12).
- `idempotency.ts` — cross-platform UUID v4 via `crypto.randomUUID` with `Math.random` fallback for Expo Go / older Android (`src/utils/idempotency.ts:5-13`).

---

## 4. Integrations, subscriptions & external dependencies

### 4.1 Supabase (project `wcvqxzqqwcxlcgrjyunf`)

- **Region:** ap-southeast-1 (Singapore) — confirmed by pooler host.
- **Project URL:** `https://wcvqxzqqwcxlcgrjyunf.supabase.co` (`eas.json:17,26,36`).
- **Pooler:** `aws-1-ap-southeast-1.pooler.supabase.com:5432`, user `postgres.wcvqxzqqwcxlcgrjyunf`.
- **Anon key:** present in `eas.json` for preview + production profiles (`eas.json:27,37`).
- **Service role key:** not in repo; used only in edge function env vars + `app_config.service_role_key` row.
- **Auth signing:** ES256 — `getUserFromJwt` enforces it via `algorithms: ['ES256']` (`_shared/auth.ts:46`). JWKS endpoint: `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` (`_shared/auth.ts:25-27`).
- **Custom claims hook:** `public.custom_access_token_hook` granted to `supabase_auth_admin`.
- **Realtime publication:** `supabase_realtime` includes `public.{admin_notes, kitchen_push_log, orders}`.
- **Extensions enabled (verified by usage):** `pg_cron`, `pg_net`, `pg_crypto` (gen_random_uuid in defaults), `vault` (referenced by `_kitchen_get_secret` but the live cron path uses `app_config` instead).

### 4.2 Razorpay

- **Mode:** test keys in repo. `EXPO_PUBLIC_RAZORPAY_KEY_ID=rzp_test_SaAGRu9UhPaeqz` (`eas.json:18,28,38`).
- **Secret:** held in edge-function env only (`RAZORPAY_KEY_SECRET`).
- **Webhook secret:** `RAZORPAY_WEBHOOK_SECRET` — used only in `verify-payment` (`supabase/functions/verify-payment/index.ts:49`).
- **Order create:** `POST https://api.razorpay.com/v1/orders` from `place-order` (`place-order/index.ts:181-197`) and `wallet-topup` (`wallet-topup/index.ts:109-123`). HTTP Basic auth `KEY_ID:KEY_SECRET`.
- **HMAC verification:** SHA-256 hex via Web Crypto (`crypto.subtle.importKey + sign`) in both `confirm-order` and `confirm-topup` and `verify-payment` (`confirm-order/index.ts:28-39`, `confirm-topup/index.ts:27-36`, `verify-payment/index.ts:29-39`).
- **Webhook URL:** `https://wcvqxzqqwcxlcgrjyunf.supabase.co/functions/v1/verify-payment` (per `verify-payment/index.ts:16` header).
- **Subscribed events:** `payment.captured`, `payment.failed`, `order.paid` (`verify-payment/index.ts:17` header). A single `razorpay_order_id` may map to a customer order, multiple subscriptions, and a wallet top-up — all three branches run per webhook (lines 92-100).
- **Native SDK:** `react-native-razorpay@^2.3.0`, wrapped through `InteractionManager.runAfterInteractions` + 150 ms setTimeout (`src/utils/razorpay.native.ts:8-19`).
- **Web shim:** rejects all payment attempts (`src/utils/razorpay.ts:7-11`).

### 4.3 Expo platform

- **EAS project:** `81ff7f3c-8f25-4acc-9a4f-605bff80bdd2` (`app.config.js:115`, `eas.json` cli version `>= 12.0.0`).
- **Updates host:** `https://u.expo.dev/81ff7f3c-8f25-4acc-9a4f-605bff80bdd2`.
- **Updates policy:** `checkAutomatically: 'ON_LOAD'`, `fallbackToCacheTimeout: 0`, `runtimeVersion.policy: 'sdkVersion'` — applied updates require app relaunch unless `useOTAUpdates` is mounted (which prompts for immediate `Updates.reloadAsync()`).
- **App version source:** `remote` — version numbers issued by EAS; `eas.json:30` sets `autoIncrement: true` on production.
- **Production channel:** `production` (`eas.json:31`).
- **Expo Notifications:** push tokens minted via `getExpoPushTokenAsync({ projectId })` (`src/hooks/usePushNotifications.ts:66-70`). Server fans out via Expo's push API `https://exp.host/--/api/v2/push/send` in chunks of 100 (`_shared/notifications.ts:147-184`).
- **Android Firebase:** `googleServicesFile` resolves from `process.env.GOOGLE_SERVICES_JSON ?? './google-services.json'` (`app.config.js:64`).
- **Native plugins:** `expo-updates`, `expo-splash-screen`, `expo-location`, `expo-notifications` (icon `./assets/notification-icon.png`, color `#38bdf8`), `expo-asset`, `expo-image-picker`, plus an inline `withGoogleMapsAndroid` config plugin that injects `com.google.android.geo.API_KEY` into AndroidManifest.xml (`app.config.js:11-32`).

### 4.4 Sentry

- **DSN:** `https://0bc1bf1484ba8c07a9278101bf2c74f2@o4511278945533952.ingest.us.sentry.io/4511278950514688` (production env only, `eas.json:40`).
- **Init:** `Sentry.init({ dsn, tracesSampleRate: __DEV__ ? 1.0 : 0.2, enabled: !__DEV__, environment: __DEV__ ? 'development' : 'production' })` (`src/utils/sentry.ts:18-32`).
- **User context:** `setSentryUser(userId, phone)` called from `useAuth` on session change; `clearSentryUser()` on sign-out (`src/utils/sentry.ts:34-44`, `src/hooks/useAuth.ts:141-149`).
- **Capture API:** `captureError(error, context)` used by `ErrorBoundary.componentDidCatch` (`src/components/ErrorBoundary.tsx:38`).
- DSN env var name: `EXPO_PUBLIC_SENTRY_DSN`. No DSN → all calls no-op (lines 19-22).

### 4.5 PostHog

- **Key:** `EXPO_PUBLIC_POSTHOG_KEY` — NOT set in `eas.json`. No-ops when absent (`src/utils/analytics.ts:26-28`).
- **Host:** `EXPO_PUBLIC_POSTHOG_HOST` (default `https://eu.i.posthog.com`).
- **Identify on session:** `identifyUser(userId, { phone })` (`src/hooks/useAuth.ts:144`).
- **Funnel events:** `signed_up`, `logged_in`, `plan_viewed`, `subscribed`, `order_placed`, `order_failed`, `wallet_top_up`, `referral_applied`, `referral_shared`, `subscription_day_skipped`, `subscription_paused`, `feedback_submitted` (`src/utils/analytics.ts:41-87`).

### 4.6 Google Maps

- **Key:** `EXPO_PUBLIC_GOOGLE_MAPS_KEY=AIzaSyBbLvg0qxSVbhrJCl2I4qjk_F-hs9epvvk` (`eas.json:19,29,39`).
- **Android:** injected into `AndroidManifest.xml` via the inline `withGoogleMapsAndroid` plugin (`app.config.js:13-32`).
- **iOS:** no explicit key wiring in `app.config.js` [NEEDS VERIFICATION — Apple Maps default may apply].
- **Web:** `@react-google-maps/api` (`package.json:44`).
- **Native:** `react-native-maps@1.20.1`.
- **Permissions:** `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` (Android, `app.config.js:67-68`); `NSLocationWhenInUseUsageDescription` (iOS, `app.config.js:51-52`).

### 4.7 Other native dependencies

- `react-native-svg@15.12.1` — icon rendering.
- `react-native-screens@~4.16.0`, `react-native-safe-area-context@~5.6.0`, `react-native-gesture-handler@~2.28.0`, `react-native-reanimated@~4.1.1`, `react-native-worklets@0.5.1` — navigation/animation stack.
- `base64-arraybuffer@^1.0.2` — used somewhere in the data layer [NEEDS VERIFICATION on call sites].
- `@react-native-community/datetimepicker@8.4.4` — native date pickers.
- `expo-print@~15.0.8`, `expo-sharing@~14.0.8` — invoice/receipt PDF flows [NEEDS VERIFICATION on screen usage].

### 4.8 Subscriptions to external data

- **Razorpay webhook → `verify-payment`** — order paid/failed events.
- **Expo Push tokens** — stored in `push_notification_tokens`.
- **Supabase Realtime → `useRealtimeOrders`** — three tables (§ 2.9).
- **pg_cron → 6 jobs** — including 4 calls into edge functions via `pg_net` (§ 6.1).
- **Deep link `1stone://referral?code=XXX`** — `Linking.getInitialURL` + `Linking.addEventListener` (`src/navigation/RootNavigator.tsx:68-87`).
- **OTA channel `production`** — Expo updates polled on launch + foreground (`src/hooks/useOTAUpdates.ts`).

### 4.9 Edge functions (15)

| Function | Lines | Verify-JWT | Purpose |
|---|---|---|---|
| `place-order` | 392 | client-supplied JWT (manual) | Server-authoritative order placement (§ 3.4.3) |
| `quote-order` | 85 | JWT manual | Cart preview (§ 3.4.2) |
| `cycle-dispatch` | 80 | JWT manual | Per-cycle dispatch date + scenario read |
| `confirm-order` | 214 | JWT manual | Client-side Razorpay confirmation (§ 3.4.4) |
| `verify-payment` | 273 | HMAC only (Razorpay webhook) | Webhook for `payment.captured/failed`, `order.paid` (§ 3.5.2) |
| `cancel-order` | 293 | JWT manual | Group cancellation + refund (§ 3.5.3) |
| `wallet-topup` | 149 | JWT manual | Create Razorpay order + pending row (§ 3.12.1) |
| `confirm-topup` | 119 | JWT manual | Client-side wallet top-up confirmation (§ 3.12.2) |
| `apply-referral` | 134 | JWT manual | Single-use referral signup credit (§ 3.11.1) |
| `low-wallet-check` | 128 | service-role only | Daily cron, low-balance push (§ 6.1) |
| `dormant-user-check` | 132 | service-role only | Weekly cron, win-back push (§ 6.1) |
| `subscription-expiry-push` | 169 | service-role only | Daily cron, expiry/start push (§ 6.1) |
| `elevate-employee` | 148 | JWT (admin gate) | Onboard staff (`auth.users` create + RPC) |
| `reports` | 212 | JWT (admin gate) | Server-side report aggregation (§ 3.10) |
| `send-push` | 261 | service-role OR JWT (multi-role) | Generic push fanout (§ 3.8.2) |

All deploy with `--no-verify-jwt` per header comments — gateway JWT validation is OFF; auth is enforced inside each function via `_shared/auth.ts.getUserFromJwt`.

---

## 5. Specifications & env configurations

### 5.1 `app.config.js`

`app.config.js:34-130` (function form, reads env at build time):

| Key | Value |
|---|---|
| `name` | `'1stOne'` |
| `slug` | `'1stOne-F1'` |
| `version` | `'1.3.2-stable.1'` |
| `orientation` | `'portrait'` |
| `icon` | `'./assets/icon.png'` |
| `userInterfaceStyle` | `'dark'` |
| `jsEngine` | `'hermes'` |
| `splash` | `{ image:'./assets/splash.png', resizeMode:'contain', backgroundColor:'#151515' }` |
| `assetBundlePatterns` | `['**/*']` |
| `ios.supportsTablet` | `false` |
| `ios.bundleIdentifier` | `'com.1stone.f1'` |
| `ios.infoPlist.NSLocationWhenInUseUsageDescription` | "1stOne needs your location to verify your delivery address and record attendance." |
| `ios.infoPlist.NSCameraUsageDescription` | "1stOne needs camera access for profile photos." |
| `ios.infoPlist.NSPhotoLibraryUsageDescription` | "1stOne needs photo library access to upload offer banners." |
| `ios.infoPlist.ITSAppUsesNonExemptEncryption` | `false` |
| `android.package` | `'com.stone1st.f1'` |
| `android.googleServicesFile` | `process.env.GOOGLE_SERVICES_JSON ?? './google-services.json'` |
| `android.permissions` | `[ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION, CAMERA, RECEIVE_BOOT_COMPLETED, VIBRATE]` |
| `android.adaptiveIcon` | `{ foregroundImage:'./assets/adaptive-icon.png', backgroundColor:'#151515' }` |
| `web.favicon` | `'./assets/favicon.png'` |
| `plugins` | `[expo-updates, expo-splash-screen, [expo-location, {…}], [expo-notifications, {icon, color:'#38bdf8'}], expo-asset, [expo-image-picker, {…}], withGoogleMapsAndroid]` |
| `extra.supabaseUrl` | `process.env.EXPO_PUBLIC_SUPABASE_URL` |
| `extra.supabaseAnonKey` | `process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY` |
| `extra.razorpayKeyId` | `process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID` |
| `extra.eas.projectId` | `'81ff7f3c-8f25-4acc-9a4f-605bff80bdd2'` |
| `updates.url` | `'https://u.expo.dev/81ff7f3c-8f25-4acc-9a4f-605bff80bdd2'` |
| `updates.checkAutomatically` | `'ON_LOAD'` |
| `updates.fallbackToCacheTimeout` | `0` |
| `runtimeVersion.policy` | `'sdkVersion'` |

### 5.2 `eas.json`

| Field | Value |
|---|---|
| `cli.version` | `'>= 12.0.0'` |
| `cli.appVersionSource` | `'remote'` |
| `build.development.developmentClient` | `true` |
| `build.development.distribution` | `'internal'` |
| `build.development.ios.simulator` | `true` |
| `build.development.env` | `{ EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_RAZORPAY_KEY_ID }` |
| `build.preview.distribution` | `'internal'` |
| `build.preview.ios.simulator` | `false` |
| `build.preview.env` | adds `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_GOOGLE_MAPS_KEY` |
| `build.production.autoIncrement` | `true` |
| `build.production.channel` | `'production'` |
| `build.production.env` | adds `EXPO_PUBLIC_SENTRY_DSN` |
| `submit.production.ios.{appleId, ascAppId, appleTeamId}` | placeholders `REPLACE_WITH_*` |
| `submit.production.android.serviceAccountKeyPath` | `'./play-store-service-account.json'` |
| `submit.production.android.track` | `'internal'` |

### 5.3 Public env vars used by the client

All must be prefixed `EXPO_PUBLIC_` to be visible to the app (`src/utils/env.ts:1-8` header):

| Var | Used by | Set in |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `src/api/supabaseClient.ts:19` | `eas.json` (all 3 profiles) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `src/api/supabaseClient.ts:20` | `eas.json` (preview, production) |
| `EXPO_PUBLIC_RAZORPAY_KEY_ID` | `src/utils/env.ts:13`, `CheckoutScreen.tsx:283` | `eas.json` (all 3) |
| `EXPO_PUBLIC_GOOGLE_MAPS_KEY` | `app.config.js:26` AndroidManifest injection | `eas.json` (preview, production) |
| `EXPO_PUBLIC_SENTRY_DSN` | `src/utils/sentry.ts:16` | `eas.json` (production) |
| `EXPO_PUBLIC_POSTHOG_KEY` | `src/utils/analytics.ts:21` | (not in `eas.json`) |
| `EXPO_PUBLIC_POSTHOG_HOST` | `src/utils/analytics.ts:22` | (not in `eas.json`) |
| `GOOGLE_SERVICES_JSON` | `app.config.js:64` | build-time non-public env |

### 5.4 Server-side env (edge functions)

Referenced via `Deno.env.get(...)` in function code (not in repo). The full set used:

- `SUPABASE_URL` — every edge function.
- `SUPABASE_SERVICE_ROLE_KEY` — every function except none.
- `SUPABASE_ANON_KEY` — `elevate-employee/index.ts:23`.
- `RAZORPAY_KEY_ID` — `place-order`, `wallet-topup`.
- `RAZORPAY_KEY_SECRET` — `place-order`, `wallet-topup`, `confirm-order`, `confirm-topup`, `verify-payment`.
- `RAZORPAY_WEBHOOK_SECRET` — `verify-payment` only.

Plus DB-side `app_config(key,value)` rows:
- `'supabase_url'` — pg_net target base.
- `'service_role_key'` — Authorization Bearer used by SQL → edge POSTs.

### 5.5 Theme & UI

`src/theme/` not read [NEEDS VERIFICATION on structure]. Header references:
- `Theme.colors.background.primary = '#151515'` (matches `splash.backgroundColor` and `StatusBar.backgroundColor`).
- `Theme.colors.action.primary` (Razorpay checkout theme color, `CheckoutScreen.tsx:288`).
- `Theme.typography.fontFamily`, `Theme.spacing.*`, `Theme.components.inputRadius` (used by `CalendarPicker.tsx:114-153`, `ErrorBoundary.tsx:79-107`).

### 5.6 Test setup

- `jest.preset: 'jest-expo'`.
- `testEnvironment: 'node'`.
- `setupFiles: ['./jest.setup.js']`.
- `setupFilesAfterEach: ['@testing-library/jest-native/extend-expect']` (`package.json:25-27`).
- `transformIgnorePatterns`: standard expo + supabase + posthog allow-list.
- `testMatch`: `**/__tests__/**/*.test.[jt]s?(x)`.
- `moduleNameMapper`: `^@/(.*)$ → <rootDir>/src/$1`.
- `collectCoverageFrom`: `src/utils/**/*.ts`, `src/hooks/**/*.ts`, excluding `*.d.ts`.

23 test files in `src/__tests__/` — utilities (`csvParsers`, `cycleLabels`, `deliveryStatus`, `dispatch`, `formatters`, `istDate`, `orderFilters`, `packingFlow`, `reportAggregations`, `subscriptionConflict`, `subscriptionMath`, `timeEngine`, `validators`, `walletNudge`), hooks (`useAdminOrders`, `useBranchFilter`, `useOrders`, `useStaffOrders`, `useSubscriptions`, `useSupabaseQuery`, `useWallet`), stores (`cartStore`), api (`sendPush`). Plus `_helpers/` and `_mocks/`.

---

## 6. Maintenance & error handling

### 6.1 Background jobs (`cron.job`)

6 active jobs (live `cron.job` rows):

| jobid | jobname | schedule | command | Active |
|---|---|---|---|---|
| 3 | `kitchen-cutoff-push-tick` | `* * * * *` | `SELECT trigger_kitchen_cutoff_pushes()` | YES |
| 5 | `subscription-expiry-push` | `30 3 * * *` (09:00 IST) | `net.http_post` → `/functions/v1/subscription-expiry-push` | YES |
| 6 | `low-wallet-check` | `0 4 * * *` (09:30 IST) | `net.http_post` → `/functions/v1/low-wallet-check` | YES |
| 7 | `dormant-user-check` | `30 4 * * 1` (Monday 10:00 IST) | `net.http_post` → `/functions/v1/dormant-user-check` | YES |
| 8 | `expire-idempotency-keys` | `0 * * * *` (hourly) | `DELETE FROM idempotency_keys WHERE created_at < NOW() - INTERVAL '24 hours'` | YES |
| 9 | `cron-failure-alert` | `15 * * * *` (hourly @ :15) | `SELECT public.alert_cron_failures()` | YES |

`alert_cron_failures()` (`supabase/sql/cron_failure_alert.sql:18-72`):
- Scans `cron.job_run_details` for `status='failed'` in last 70 minutes.
- If `count > 0`, reads `app_config.supabase_url` + `app_config.service_role_key` and POSTs to `send-push` with `{role:'admin', title:'Background job failing', body:'<n> cron failure(s) in the last hour: <jobname,…>', data:{screen:'JobHealth'}, trigger_source:'cron_health'}`.
- Best-effort `EXCEPTION WHEN OTHERS` so the health check itself never fails (lines 59-67).

`trigger_kitchen_cutoff_pushes()` is responsible for both:
- Per-cycle kitchen summary push when `cutoff_time` has just been crossed.
- Subscription dispatch generation via `generate_daily_manifest` (`supabase/sql/generate_daily_manifest.sql:8-12` header).

### 6.2 Error boundaries & crash recovery

- **JS errors:** `ErrorBoundary` catches in `componentDidCatch`; logs to console + `captureError(error, { componentStack })` (`src/components/ErrorBoundary.tsx:35-39`). Renders a "Something went wrong" screen with a "Try Again" button that resets `hasError` (lines 41-71). In dev, the error message is rendered in a debug box (lines 59-65).
- **Provider placement:** outermost in `App.tsx:94`, plus an inner `ErrorBoundary` inside `NavigationContainer` (`src/navigation/RootNavigator.tsx:145`).
- **OS-level crashes:** Sentry captures via `@sentry/react-native` (production env only). `tracesSampleRate: 0.2`. No DSN → all calls no-op.

### 6.3 Background-job observability

`useJobHealth()` (`src/hooks/useJobHealth.ts:46-55`) reads the `get_job_health() RETURNS jsonb` RPC (admin-gated SECDEF). The RPC returns (`supabase/sql/job_health.sql:23-105`):
- `jobs[]` — per `cron.job`: `jobname`, `schedule`, `active`, `last_run` (start_time), `last_status` (succeeded/failed/running), `last_message` (first 200 chars), `failures_24h` count.
- `manifest[]` — last 7 rows of `manifest_run_log` ordered by `ran_at DESC` with `run_date, orders_created, orders_skipped, subs_skipped, error_detail`.
- `push_24h` — `push_logs.status → count` over last 24h.
- `checked_at` — server now().

The rationale (header lines 1-22): `cron.*` is not exposed via PostgREST, `manifest_run_log` + `push_logs` sit behind different RLS roles, so one SECDEF RPC is the only path to combine them. Surfaced in `JobHealthScreen` (admin nav).

### 6.4 Wallet refund failure alerting

Two structured alert paths:

1. **`cancel-order` refund failure** (`supabase/functions/cancel-order/index.ts:249-277`):
   - `console.error('[cancel-order] [REFUND-FAILURE-ALERT] Wallet refund failed', { order_group_id, order_id, user_id, amount, reason, reference })`.
   - `resolveAndSendPush('admin.wallet_refund_failed', userIds=adminIds, vars:{order_id, amount, reference}, data:{screen:'AdminOrderDetail', params:{orderId}})`.

2. **`place-order` rollback failure** (`supabase/functions/place-order/index.ts:254-263`):
   - `console.error('[place-order] WALLET REFUND FAILED — manual reconciliation needed', { user_id, amount, original_error, refund_error, reference })`.
   - Returns 500 to the customer with the reference timestamp in the message.

3. **`place-order` subscription-create failure (G2)** (`place-order/index.ts:317-345`):
   - `console.error('[place-order] [SUBSCRIPTION-CREATE-FAILURE]', { user_id, order_id, failures, reference })`.
   - `resolveAndSendPush('admin.subscription_create_failed', adminIds, vars:{order_id, count, reference}, data:{screen:'AdminOrderDetail'})`.

### 6.5 Offline behavior

- **Banner:** `OfflineBanner` mounts at app root, listens to `NetInfo.addEventListener`. Considered offline when `!(state.isConnected && state.isInternetReachable !== false)` (`src/components/OfflineBanner.tsx:18-19`). Slides down `translateY: -50 → 0` over 300 ms with `useNativeDriver: true`.
- **Staff queue:** `useStaffQueueStore` persists mutations to AsyncStorage (`1stone-staff-queue`) with `retryCount` tracking. `MAX_QUEUE_RETRIES = 5` (`src/utils/constants.ts:38`). Drain logic implemented in `useOfflineSync` hook [NEEDS VERIFICATION on internals — file not read].
- **Cart persistence:** both carts persist with Zustand `persist` middleware so a cart survives an offline relaunch.
- **Queries:** TanStack Query retries failed queries up to 2 times (mutations 1 time). `refetchOnWindowFocus: false`.

### 6.6 Edge-function error handling pattern

All 15 functions follow a near-identical shape:
1. CORS preflight handling with explicit `ALLOWED_ORIGINS = new Set([SUPABASE_URL, 'http://localhost:8081', 'http://localhost:19006'])`.
2. `try { … } catch (err) { return json({ error: err.message ?? 'Internal server error' }, 500); }` at the outer scope.
3. `getUserFromJwt(token)` returns `null` for ANY invalid token; routes return `401` (`_shared/auth.ts:43-56`).
4. Server-authoritative refusals return `400/403/409/429/503` with `{ error: <reason> }`.
5. Internal calls use `console.error` with structured key/value details; aggregations end up in the Supabase function logs.

### 6.7 Idempotency

- **Header-driven:** `place-order`, `wallet-topup` both honor `Idempotency-Key` headers; rows in `idempotency_keys` cache the success response.
- **Status-guarded RPCs:** `mark_order_paid`, `complete_wallet_topup`, `confirm-order`'s UPDATE all filter on the prior status so re-processing is safe.
- **Group cancellation:** `cancel-order` returns success without refund if every row in the group is already `Cancelled` (`cancel-order/index.ts:148-156`).
- **Subscription activation:** `verify-payment` UPDATE filters `.eq('is_active', false)` (`verify-payment/index.ts:174-176`). `confirm-order` mirrors this filter (`confirm-order/index.ts:147-151`).
- **Kitchen push:** UNIQUE `(cycle_id, push_date)` on `kitchen_push_log` is the de-dupe key.
- **Subscription dispatch:** `generate_daily_manifest` skips orders already created for `(subscription_id, dispatch_date)` (header lines 28-30).
- **Hourly TTL:** `cron.job` id 8 deletes `idempotency_keys` rows older than 24 h.

### 6.8 Rate limiting (per user)

Implemented inline in two edge functions:
- `place-order` — max 5 calls per 60 s, key `endpoint='place-order'`, returns 429 (`place-order/index.ts:82-91`).
- `wallet-topup` — same shape with `endpoint='wallet-topup'` (`wallet-topup/index.ts:61-70`).

Counter uses `idempotency_keys` rows in last minute — incidentally also serving as a request log.

### 6.9 Notable header-documented decisions

- **JWT verify off + manual verify** (`_shared/auth.ts:1-15`) — gateway off, every function calls `getUserFromJwt`. ES256 pinning prevents alg-confusion downgrade.
- **Inclusive GST** (`orderBuild.ts:14-21`) — catalog prices include GST; `tax_amount` is the carved-out slice.
- **Server-authoritative dispatch** (`_shared/dispatch.ts:1-13`) — client never decides cycle/date; one clock read per request.
- **Drift tripwire** (`place-order/index.ts:11-23`) — every place-order checks the client echo; mismatch returns 409, no money side-effects.
- **Direct push hop** (`_shared/notifications.ts:14-22`) — intra-edge calls bypass HTTP back to `send-push` because the function-to-function service-role compare broke during the 2026-05-16 API-key migration.
- **Realtime auth attach** (`useAuth.ts:104-110`, `useRealtimeOrders.ts:24-25`) — `setAuth` is owned by `useAuth` only; subscribers never call it. Prevents anon-subscribe + CLOSED/subscribe tight-loop on RN.
- **IST midnight without locale strings** (`useRealtimeOrders.ts:32-41`) — Hermes returns `Invalid Date` for `toLocaleString({timeZone})`; UTC arithmetic only.
- **OTA dual-path** (`useOTAUpdates.ts:1-17`) — native `ON_LOAD` downloads on launch; the hook also offers an in-session restart prompt at most once per session.

### 6.10 Code patterns & layering

- **One Supabase chokepoint:** every read/write in app code goes through `useSupabaseQuery / useSupabaseSingle / useSupabaseInfiniteQuery / useSupabaseMutation` (`src/api/useSupabaseQuery.ts:1-22` mandate comment).
- **One Branch chokepoint:** every branch-scoped query uses `useBranchFilter`; every branch-scoped write uses `requireWriteBranch(bf)` (`src/hooks/useBranchFilter.ts:113-118`).
- **One Date chokepoint for IST business calendar:** `src/utils/istDate.ts` helpers — never `Date.toISOString().split('T')[0]`.
- **One Dispatch decision:** `supabase/functions/_shared/dispatch.ts` — used by `quote-order`, `place-order`, `cycle-dispatch`. `src/utils/timeEngine.ts` is presentation-only.
- **One Push chokepoint per side:** server `resolveAndSendPush` (intra-edge) and the `send-push` edge function (client/JWT). Client wrapper is `src/api/sendPush.ts`.
- **One PaymentMethod CHECK shape:** `'wallet','razorpay','split'` on both `orders` and `user_subscriptions`.
- **One Status vocabulary:** the 11-value `orders_status_allowed` CHECK is the source of truth.

---

## 7. Self-audit

The following statements were tagged `[NEEDS VERIFICATION]` inside the body and remain open:

1. **§ 2.6** — `orders_hub_operator_update` policy's full WITH CHECK status list — only forward-flow statuses were visible in the `pg_policies` truncated dump; complete list not enumerated.
2. **§ 2.6 / 2.7** — `is_admin()`, `is_staff_or_admin()`, `is_super_admin()`, `has_branch_access()`, `jwt_branch_id()`, `jwt_user_role()` were enumerated by signature only; their function bodies were not read in this pass. Their behavior is inferred from policy USING/WITH CHECK expressions that reference them.
3. **§ 2.7** — `mark_order_paid` and `mark_order_failed` body internals not read; behavior summarised from caller comments only.
4. **§ 2.7** — `subscription_plan_items` is described as "legacy" based on `generate_daily_manifest.sql` BF-02 header note; current admin UI write paths to this table not verified.
5. **§ 2.12** — Hand-written types in `src/types/*.ts` other than `database.types.ts` were enumerated only by filename; field shapes not verified.
6. **§ 3.1.1** — `LoginScreen` and `OnboardingScreen` internals not read; flow inferred from `RootNavigator` usage.
7. **§ 3.7** — `invalidateOrderQueries(qc)` full key list not enumerated; only its import sites confirmed.
8. **§ 3.9** — `StaffDashboard.tsx` body (783 lines) not read; descriptions are from header/usage only.
9. **§ 3.11.2** — `referral_first_order_trigger.sql` not read; trigger body not verified.
10. **§ 3.13** — Hook bodies for `useAddresses`, `useAdminNotes`, `useAdminOrders`, `useAdminStats`, `useAttendance`, `useBanner`, `useBranches`, `useBranchMutations`, `useCompleteOnboarding`, `useCustomerExport`, `useCustomerFeedback`, `useCycleDispatch`, `useDeliveryCycles`, `useDeliveryHubs`, `useDeliveryZones`, `useDispatchBackfill`, `useEssentials`, `useEssentialsCatalog`, `useExpenseManager`, `useExpenses`, `useHubOrderHistory`, `useHubReport`, `useMenuItems`, `useMenuManagement`, `useNotificationTemplates`, `useOfflineSync`, `useOrderQuote`, `useReferrals`, `useReports`, `useResourceManager`, `useSmartCart`, `useSmartEssentialsCart`, `useStaffManagement`, `useStaffOrders`, `useStockManager`, `useStoreConfig`, `useSubscriptionPlans`, `useSubscriptions`, `useWalletNudge` not read.
11. **§ 3.14** — Utility-module bodies for `assets.ts`, `confirmDialog.ts`, `csvBuilder.ts`, `csvParsers.ts`, `cycleLabels.ts`, `deliveryStatus.ts`, `env.ts` (partial), `exportCsv.ts`, `formatters.ts`, `links.ts`, `orderFilters.ts`, `orderStatus.ts`, `orderStatusPush.ts`, `packingFlow.ts`, `serviceability.ts`, `subscriptionConflict.ts`, `subscriptionMath.ts`, `validators.ts` not read.
12. **§ 4.6** — iOS Google Maps key wiring (Info.plist) not present in `app.config.js`; whether the app uses Apple Maps on iOS or relies on a different key path was not confirmed.
13. **§ 4.7** — `base64-arraybuffer` call sites not located; `expo-print`/`expo-sharing` screen usage not verified.
14. **§ 5.5** — `src/theme/` directory contents not enumerated; references inferred from import sites.
15. **§ 6.5** — `useOfflineSync` body not read; drain logic described from store-side facts only.
16. **§ 2.10 schema-drift list** — comparison against `supabase/sql/schema.sql` was based on column counts + table inventory; no diff was generated. The 14 extra tables listed are tables present in DB whose individual `.sql` migration files exist in `supabase/sql/` post-dating `schema.sql`.
17. **Edge-function `verify-payment` subscription update path** — `verify-payment/index.ts:167-205` writes `is_active=true` directly on `user_subscriptions`, while `confirm-order/index.ts:143-159` does the same. Both filter `.eq('is_active', false)` for idempotency; whether a `mark_order_paid` triggered side-effect duplicates this was not verified.

**Schema source date:** every § 2 fact was queried live on 2026-05-20 16:41 UTC against project `wcvqxzqqwcxlcgrjyunf`. If any DDL changes after that, this document will lag.

**Code-citation date:** files were read on 2026-05-20; commit at HEAD as listed in the system git-status snapshot (`35e94a9 chore: resync package-lock.json with package.json`).

— End of blueprint —
