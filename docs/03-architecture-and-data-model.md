# 1stOne — Architecture & Data Model

> **Provenance.** Written **2026-05-22** directly from the source tree at commit `f618c60`. Every statement here was read out of the code, the generated database types, or the SQL/edge-function files — not from memory, prior documents, or support notes. Where the code contains a fact (a table column, a default, a rule), this document quotes it. Owner-facing prose is in plain language; deeper technical material sits under **“Under the hood”** headings.

---

## 1. What 1stOne is, in one paragraph

1stOne is a mobile app for a home-kitchen food business that delivers **fresh meals and household essentials on a daily cycle**, either as **one-off orders** or as **prepaid subscriptions**. One app serves three kinds of people — **customers**, **staff** (kitchen / packing / delivery / hub), and **admins** (owner + managers). It runs in a single region, **India (Asia/Kolkata)**, currently around **Siddapur, Uttara Kannada, Karnataka**. The phone app is the storefront and the operations console; everything behind it lives in **Supabase** (a hosted Postgres database with built-in auth, security rules, serverless functions, and scheduled jobs).

---

## 2. The technology stack (what the app is built from)

| Layer | Technology | Version (from `package.json` / `app.config.js`) |
|---|---|---|
| App framework | Expo + React Native | Expo SDK `~54.0.0`, React Native `0.81.5`, React `19.1.0` |
| Language | TypeScript | `~5.9.2` |
| JS engine on device | Hermes | declared in `app.config.js` |
| Navigation | React Navigation (native stack) | `^7.0.0` |
| Server state / caching | TanStack React Query | `^5.60.0` |
| Local UI state | Zustand | `^5.0.0` |
| Backend | Supabase (`@supabase/supabase-js`) | `^2.45.0` |
| Payments | Razorpay (`react-native-razorpay`) | `^2.3.0` |
| Push notifications | Expo Notifications | `~0.32.16` |
| Maps | react-native-maps + `@react-google-maps/api` | `1.20.1` / `^2.20.8` |
| Crash reporting | Sentry (`@sentry/react-native`) | `^8.7.0` |
| Product analytics | PostHog | `^4.41.2` |
| Over-the-air updates | `expo-updates` | `~29.0.17` |

**App identity.** Name `1stOne`, version **`1.3.2-stable.1`**. iOS bundle id `com.1stone.f1`; Android package `com.stone1st.f1` *(note: the two platform identifiers differ — this is intentional and lives in `app.config.js`)*. EAS project id `81ff7f3c-8f25-4acc-9a4f-605bff80bdd2`. OTA updates point at `https://u.expo.dev/<project>` with `checkAutomatically: ON_LOAD` and `runtimeVersion.policy: sdkVersion`.

**One client, one config.** Every database call in the app goes through a single Supabase client (`src/api/supabaseClient.ts`). Secrets are read from environment variables at build time (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_RAZORPAY_KEY_ID`, `EXPO_PUBLIC_GOOGLE_MAPS_KEY`) so they never get hard-coded into the JavaScript bundle.

---

## 3. How the pieces fit together

```
┌─────────────────────────── Mobile app (one binary, web build too) ───────────────────────────┐
│  Customer screens   │   Staff screens   │   Admin screens                                       │
│         │                    │                   │                                              │
│         └──────── React Query hooks (src/hooks) ──┴──────── Zustand stores (cart, ui, queue) ───│
│                              │                                                                   │
│                    single Supabase client                                                        │
└──────────────────────────────┼───────────────────────────────────────────────────────────────┘
                                │  (JWT carries role + branch + hub + super-admin + driver claims)
                ┌───────────────┴───────────────────────────────────────────────┐
                ▼                                                                 ▼
        Direct table reads/writes                                        Edge Functions (15)
        guarded by Row-Level Security                                    server-authoritative logic:
        (RLS) on every table                                            quote/place/cancel order, payments,
                │                                                        dispatch, push, reports, referrals
                ▼                                                                 │
        ┌───────────────── Postgres (Supabase) ──────────────────────────────────┘
        │  45 tables · ~32 stored procedures (RPCs) · triggers · RLS policies
        │  pg_cron (scheduled jobs)  +  pg_net (outbound HTTP from the DB)
        └──────────────┬────────────────────────────┬──────────────────────────────┐
                       ▼                             ▼                              ▼
                Razorpay (payments)          Expo Push (notifications)      Supabase Storage (images/PDFs)
```

**The golden rule of this codebase: money, dates, and prices are decided by the server, never the phone.** The app sends *intent* (which items, which address, which payment method); the server derives the price, the delivery dates, the tax split, and the delivery fee. This shows up everywhere — see Doc 2 (Business Logic & Flows) §2.

### Provider stack (app boot order — `App.tsx`)

`ErrorBoundary` → `QueryClientProvider` (React Query) → `AuthProvider` (session + role) → `SafeAreaProvider` → status bar + `OfflineBanner` + `RootNavigator` + global `LoadingOverlay` + `DialogHost`. The splash screen is held until the auth session check finishes (with a 5-second watchdog so a stalled network can never freeze on the splash).

---

## 4. Who can use the app, and how roles work

There are three roles plus two “flavours” layered on top:

| Role | Where it routes (`RootNavigator.tsx`) | What they do |
|---|---|---|
| **customer** | `CustomerNavigator` | Browse menu/essentials, order, subscribe, wallet, referrals, loyalty, feedback |
| **staff** | `StaffNavigator` | Kitchen / Packing tabs; attendance, expenses, supply orders |
| **admin** | `AdminNavigator` | Reports + the whole Manage console |
| **super-admin** *(flavour of admin)* | `AdminNavigator` + extra rows unlocked | Branch management, customer export, all-branch visibility |
| **driver / hub operator** *(flavour of customer/staff)* | special dashboards | Last-mile delivery / hub handoff |

### Under the hood — how a role is known without a database lookup

When Supabase issues a login token (a **JWT**), a database hook called `custom_access_token_hook` (`supabase/sql/custom_access_token_hook.sql`) stamps five custom claims into it:

- `user_role` — from `profiles.role` (defaults to `customer`)
- `branch_id` — which branch this person belongs to
- `assigned_hub_id` — the hub a hub-operator manages
- `is_super_admin` — from `profiles.is_super_admin` (an explicit column, not a convention)
- `is_driver` — computed live: **true** if this user’s id appears in `delivery_hubs.driver_user_id` *or* `delivery_zones.driver_user_id`

The app reads these straight from the token (`src/hooks/useAuth.ts`, `extractRole`) — so it knows your role the instant you open the app, with **zero extra queries**. The same claims are read by the database’s security rules (next section). Because claims are baked into the token, a person who is *promoted* (e.g. customer → driver) picks up the change the next time the token refreshes; the app proactively refreshes the token whenever it returns to the foreground, so the change usually appears without a manual logout.

**Login is phone-OTP only.** There is no password. `useAuth` exposes `signInWithPhone`, `verifyOTP`, `startPhoneChange`, `verifyPhoneChange`, and `signOut`. On sign-out the app also best-effort deletes this device’s push token (so a shared phone stops receiving the previous user’s notifications), racing that cleanup against a 3-second timeout so a dead network can’t trap you on the sign-out.

---

## 5. Security model — Row-Level Security (RLS)

> **Plain-language version:** every table in the database has a bouncer on it. The bouncer reads your login token, sees your role and branch, and decides — row by row — what you may read or change. Customers can only touch their own rows. Staff and admins are scoped to their branch. Super-admins see everything. None of this depends on the app behaving; the rules live in the database, so even a hand-crafted request can’t get past them.

### Under the hood — the helper functions (`supabase/sql/rls_policies.sql`)

| Function | Returns true when… |
|---|---|
| `jwt_user_role()` | reads the `user_role` claim (safely, defaults to `customer`) |
| `jwt_branch_id()` | the caller’s `branch_id` claim |
| `is_admin()` | role is `admin` |
| `is_staff_or_admin()` | role is `staff` or `admin` |
| `is_super_admin()` | the `is_super_admin` claim is true (falls back to reading `profiles.is_super_admin` directly for older tokens) |
| `has_branch_access(row_branch_id)` | caller is super-admin **OR** the `branch_management_active` flag is OFF (pre-launch single-branch mode) **OR** the row’s branch matches the caller’s branch claim |

**Representative policies** (the pattern repeats across all tables):

- **`profiles`** — you may read your own row; admins may read/write within their branch. Customers may only change their own `full_name` and `phone_number` (column-level grants). Sensitive columns (`role`, `branch_id`, `wallet_balance`, `loyalty_points`, `monthly_salary`, `referral_code`, …) can be changed **only** through trusted stored procedures or service-role edge functions — never by the app directly.
- **`orders`** — a customer reads/inserts their own; staff/admin update within branch.
- **`wallet_transactions`** — customers can **read** their own but the app can **never insert** them (`wallet_tx_no_writes`); all wallet movement flows through atomic procedures (see Doc 2 §4).
- **Catalog tables** (`menu_items`, `essentials_catalog`, `subscription_plans`, …) — readable by everyone, writable only by admins within branch.
- **`branches`** — readable by all, writable only by **super-admin** (`branches_admin_write`).
- **Staff HR tables** (`staff_attendance`, `staff_leaves`, `staff_salary`, `expense_claims`) — a staff member sees their own; admins manage within branch.

### Multi-branch is built but launch-gated

The whole schema carries `branch_id` and the policies enforce branch scoping — **but** the feature flag `branch_management_active` decides whether scoping is *strict*. While it is **OFF**, the business runs as a single branch and `has_branch_access()` is permissive (so a stranded `NULL` branch or an old token can’t lock staff out). When the business is ready to run multiple branches, flipping that flag turns on strict per-branch isolation. (See Doc 4 §3 for the flag inventory.)

---

## 6. The data model — all 45 tables

> Read this as a map, not a contract. Column names below are taken verbatim from `src/types/database.types.ts` (the types Supabase generates from the live schema). The database has **no enum types** — statuses like order status are stored as plain text strings (see Doc 2 §3 for the status vocabulary).

### 6.1 Identity, money & loyalty

| Table | Columns | What it holds |
|---|---|---|
| **profiles** | assigned_hub_id, benefits, branch_id, created_at, designation, employee_id, exit_date, full_name, id, is_super_admin, joining_date, loyalty_points, monthly_salary, phone_number, referral_code, referred_by, role, shift_timing, updated_at, wallet_balance | One row per person (customer or employee). Holds role, branch, wallet balance, loyalty points, referral code, and (for staff) HR fields. |
| **wallet_transactions** | amount, created_at, description, id, reference_id, reference_type, transaction_type, user_id | Immutable ledger of every wallet credit/debit. App-readable, never app-writable. |
| **pending_wallet_topups** | amount, completed_at, created_at, razorpay_order_id, status, user_id | A top-up awaiting Razorpay confirmation. |
| **loyalty_redemptions** | created_at, description, id, points, reference_order_id, type, user_id | Loyalty points earned/redeemed. |

### 6.2 Catalog (what can be bought)

| Table | Columns | What it holds |
|---|---|---|
| **menu_items** | branch_id, created_at, cycle_id, id, ingredients, is_active, name, price, sort_order, updated_at | Food items. `ingredients` is a `"Name:200g;Name:2"` string the kitchen aggregation parses. `price` is **GST-inclusive**. |
| **essentials_catalog** | branch_id, created_at, cycle_id, id, is_active, name, price, sort_order, unit, updated_at | Household essentials. Each item is tied to a delivery cycle. |
| **subscription_plans** | branch_id, created_at, cycle_id, duration_days, id, is_active, plan_items, plan_name, plan_type, price, savings_amount, updated_at | A prepaid plan. `plan_items` is a JSON list of `{item_id, item_name, quantity}`. `plan_type` is `food` or `essentials`. |
| **subscription_plan_items** | id, item_id, item_type, plan_id, quantity | Legacy normalized plan items table (the live dispatch path reads `plan_items` JSON, not this — see Doc 2 §3). |

### 6.3 Orders & subscriptions (the core)

| Table | Columns | What it holds |
|---|---|---|
| **orders** | branch_id, created_at, cycle_id, delivery_address_id, delivery_fee, delivery_method, dispatch_date, hub_id, id, notes, **order_group_id**, order_type, paid_at, payment_method, razorpay_order_id, razorpay_payment_id, status, subscription_id, tax_amount, total_amount, updated_at, user_id, wallet_amount_used | One row **per delivery cycle**. A customer-facing “order” is the set of rows sharing `order_group_id`. |
| **order_items** | id, item_id, item_name, item_type, order_id, price_at_time, quantity | Line items. `item_type` is `food`, `essential`, or `subscription`. |
| **user_subscriptions** | branch_id, created_at, days_consumed, id, is_active, is_paused, payment_method, plan_id, razorpay_order_id, razorpay_payment_id, start_date, updated_at, user_id, wallet_amount_used | A customer’s purchased plan. Drives the daily dispatch generator. |
| **cancelled_subscription_days** | branch_id, cancelled_date, created_at, cycle_id, id, reason, subscription_id | A specific day a customer skipped on a subscription. |
| **order_item_ratings** | comments, created_at, id, order_id, order_item_id, rating, user_id | Per-item star ratings (post-delivery). |
| **app_feedback** | comments, created_at, id, order_id, rating, user_id | Overall experience feedback. |

### 6.4 Delivery network

| Table | Columns | What it holds |
|---|---|---|
| **delivery_cycles** | branch_id, created_at, cutoff_time, cycle_name, delivery_start, essentials_label, id, is_active, is_essentials, kitchen_push_time, sort_order, updated_at | The meal windows (Breakfast/Lunch/Snacks/Dinner). `cutoff_time` decides the dispatch date; `kitchen_push_time` fires the kitchen summary; `is_essentials` + `essentials_label` control whether the cycle also serves essentials. |
| **delivery_zones** | branch_id, created_at, delivery_fee_override, description, driver_code, driver_user_id, hub_id, id, is_active, polygon_geojson, updated_at, zone_name | A map polygon for **direct** (door) delivery, with its own driver and optional fee override. |
| **delivery_hubs** | address_details, branch_id, center_lat, center_lng, commission_percent, contact_phone, created_at, delivery_fee_override, driver_code, driver_user_id, extends_coverage, hub_code, hub_name, id, is_active, polygon_geojson, staff_name, staff_phone, staff_user_id, updated_at | A pickup/handoff hub for **hub** delivery, with a driver, a hub operator, a commission %, and a coverage polygon. |
| **customer_addresses** | address_line, branch_id, city, created_at, full_name, hub_id, hub_impact_notified_at, id, is_active, is_default, is_serviceable, label, landmark, latitude, longitude, phone_number, pincode, updated_at, user_id, zone_id | A saved address. `is_serviceable` + `zone_id`/`hub_id` are resolved server-side from the map pin. |

### 6.5 Staff / HR

| Table | Columns | What it holds |
|---|---|---|
| **staff_attendance** | branch_id, clock_in_lat, clock_in_lng, clock_in_time, clock_out_lat, clock_out_lng, clock_out_time, date, id, staff_id | One clock-in/out per staff per day, with GPS. |
| **staff_leaves** | approved_by, branch_id, created_at, end_date, id, reason, staff_id, start_date, status, updated_at | Leave requests + approvals. |
| **staff_salary** | base_salary, bonus, branch_id, created_at, deductions, id, is_paid, month, net_salary, paid_at, staff_id, updated_at, year | Monthly salary records. |
| **staff_shifts** | branch_id, created_at, days_of_week, end_time, id, is_active, shift_name, staff_id, start_time, updated_at | Shift definitions. |
| **expense_claims** | amount, approved_by, branch_id, category, created_at, description, id, paid_at, staff_id, status, updated_at | Staff-submitted reimbursement claims. |
| **business_expenses** | amount, branch_id, category, created_at, description, expense_date, id, is_paid, paid_at, recorded_by, vendor | Admin-recorded business expenses. |
| **attendance_correction_requests** + **attendance_correction_days** | (request: branch_id, created_at, id, reason, reviewed_at, reviewed_by, reviewer_note, staff_id, status, updated_at) · (days: id, request_id, the_date) | Staff request to backfill past attendance days; admin approves/rejects. |

### 6.6 Supply chain (kitchen procurement)

| Table | Columns | What it holds |
|---|---|---|
| **supply_catalog** | category, created_at, id, is_active, name | Master list of things the kitchen can order (Vegetables / Grocery / Stationery). |
| **supply_order_items** | added_by, batch_id, branch_id, category, created_at, id, name, qty, request_id | Individual items on the current procurement order. |
| **supply_batches** | branch_id, created_at, id, items_snapshot, note, printed_at, printed_by | A frozen, printed procurement batch. |
| **staff_order_requests** | approved_by, branch_id, created_at, id, items, request_type, status, submitted_by, updated_at | A staff-raised supply request that mirrors into `supply_order_items`. |

### 6.7 Configuration, marketing & messaging

| Table | Columns | What it holds |
|---|---|---|
| **store_config** | cancellation_window_hours, delivery_fee, essentials_module_active, hub_delivery_active, id, low_wallet_threshold, loyalty_points_per_rupee, max_wallet_topup, min_wallet_topup, storm_mode_active, tax_rate_percentage, whatsapp_support_number, winback_inactive_days, created_at, updated_at | The single business-rules row. Tax %, delivery fee, wallet limits, cancellation window, loyalty rate, storm mode, support number. |
| **feature_flags** | description, flag_key, flag_value, id, updated_at | On/off switches: `branch_management_active`, `essentials_module_active`, `hub_delivery_active`, `storm_mode_active`. |
| **app_config** | key, value | Internal key/value used by database jobs (e.g. `supabase_url`, `service_role_key` for outbound calls). |
| **app_settings** | id, landing_hero_url, login_bg_url, staff_benefits, staff_designations, updated_at | Single-row app settings: login background, landing-page hero image, staff dropdown lists. |
| **banners** | banner_type, branch_id, created_at, id, image_url, is_live, text_content, updated_at | The home-screen promo banner (image or styled text). |
| **referral_settings** | id, is_active, milestone_ambassador_count, milestone_star_count, referee_reward_points, referee_signup_credit, referee_wallet_credit, referrer_first_order_credit, referrer_first_order_points, referrer_month_credit, referrer_reward_points, referrer_wallet_credit, updated_at | All referral reward tiers. |
| **referrals** | created_at, first_order_reward_given, id, month_reward_given, referee_id, referrer_id, reward_given, status | One row per referral relationship. |
| **notification_templates** | body_template, description, event_key, is_enabled, title_template, trigger_source, updated_at, variables | Admin-editable push copy keyed by `event_key`, with `{{variable}}` placeholders. |
| **push_notification_tokens** | created_at, id, is_active, platform, token, updated_at, user_id | A device’s Expo push token. |
| **push_logs** | body, data, error_message, expo_ticket_id, id, reference_id, sent_at, status, title, token, trigger_source, user_id | Audit log of every push attempt. |

### 6.8 System / operations

| Table | Columns | What it holds |
|---|---|---|
| **idempotency_keys** | created_at, endpoint, key, response, user_id | Prevents double-charging on retries (place-order). |
| **kitchen_push_log** | cycle_id, http_request_id, id, items_summary, orders_count, push_date, pushed_at | One row per cycle per day — the “active batch” marker for staff, and the kitchen-push dedupe key. |
| **manifest_run_log** | error_detail, id, orders_created, orders_skipped, ran_at, run_date, subs_skipped | Audit of each subscription dispatch run. |
| **admin_notes** | branch_id, created_at, created_by, id, is_active, note_text, target_tab, updated_at | The admin’s message to staff, scoped to a staff group (All/Kitchen/Packing/Delivery/Hub). |

---

## 7. Stored procedures (RPCs) — the database’s “verbs”

These are functions that run **inside** the database, usually with elevated rights (`SECURITY DEFINER`) so they can do a privileged thing atomically while still checking the caller’s role. Grouped by area:

- **Ordering / payment:** `place_order_atomic`, `mark_order_paid`, `mark_order_failed`, `tag_wallet_debit_to_order`, `admin_cancel_order_atomic`, `advance_orders_status`
- **Wallet / loyalty:** `decrement_wallet_balance_if_sufficient`, `increment_wallet_balance`, `increment_loyalty_points`, `redeem_loyalty_points`, `complete_wallet_topup`
- **Subscriptions / dispatch:** `generate_daily_manifest`, `admin_cancel_subscription_atomic`, `backfill_dispatch_manifest`
- **Kitchen / staff board:** `get_kitchen_aggregate`, `get_active_staff_batch`, `push_kitchen_summary`
- **Delivery / serviceability:** `resolve_address_serviceability`, `point_in_polygon`, `assign_hub_operator`, `assign_hub_to_address_ids`, `get_addresses_for_hub_assignment`, `get_hub_impact_addresses`, `set_default_address`
- **Staff lifecycle:** `elevate_to_staff`, `set_employee_designation`, `update_employee_profile`, `complete_onboarding_atomic`
- **Attendance corrections:** `approve_attendance_correction`, `reject_attendance_correction`
- **Supply chain:** `add_or_merge_supply_order_item`
- **Observability:** `get_job_health`

> *Why so many “atomic” procedures?* Anything that touches money or creates linked rows is done in one database transaction, so a network failure halfway through can never leave a half-state (charged but no order, cancelled but not refunded). See Doc 2 for the exact rules each enforces.

---

## 8. Edge Functions — the 15 server endpoints

These are serverless TypeScript functions (Deno) that run with the service-role key, off-device. They are where all trusted, money-touching, or fan-out logic lives. They share helpers in `supabase/functions/_shared/` (`auth`, `dispatch`, `orderBuild`, `notifications`, `storeConfig`, `reportAggregations`).

| Function | Purpose (from its header) |
|---|---|
| `quote-order` | Read-only price/dispatch preview for a cart (the binding quote). |
| `place-order` | Commit an order: re-derive the quote, check drift, take payment, write rows — all server-authoritative. |
| `cancel-order` | Cancel a whole order group within the window; refund wallet portion. |
| `confirm-order` | Verify a Razorpay payment signature from the app and mark the order paid (webhook is the backup). |
| `confirm-topup` | Same, for a wallet top-up. |
| `verify-payment` | The Razorpay **webhook** — HMAC-verified; marks orders/top-ups/subscriptions paid or failed. |
| `wallet-topup` | Validate amount against config and create a Razorpay order for a top-up. |
| `cycle-dispatch` | Read-only: today’s dispatch date + scenario for each active cycle (drives cart “Today/Tomorrow” badges). |
| `apply-referral` | Apply a referral code; credit referee bonus + points (idempotent). |
| `reports` | Admin-only server-side report aggregation. |
| `send-push` | Generic push sender (by user list or role); logs to `push_logs`. |
| `elevate-employee` | Admin-only: promote a phone number into a staff profile. |
| `subscription-expiry-push` | Cron: notify subscribers 1–2 days before expiry. |
| `low-wallet-check` | Cron: warn customers whose wallet is short for an imminent renewal. |
| `dormant-user-check` | Cron: gentle win-back push to long-inactive customers. |

---

## 9. Client-side state (what lives on the phone)

- **React Query** caches all server data; query keys are centralized in `src/utils/constants.ts` (`QUERY_KEYS`), stale time 2 minutes, 2 retries.
- **Zustand stores** (`src/store/`): `cartStore` (food cart + plans), `essentialsCartStore` (essentials cart + plans — kept separate), `staffQueueStore` (offline mutation queue), `uiStore` (global loading, active home tab, profile popup), `branchStore` (admin’s selected branch filter).
- **Offline support:** staff status updates queue locally when offline (`useOfflineSync`, `staffQueueStore`) and replay when connectivity returns, with a max retry count (`MAX_QUEUE_RETRIES = 5`). An `OfflineBanner` shows connectivity state app-wide.

---

## 10. Testing, builds & releases (facts from the repo)

- **Tests:** 24 Jest suites under `src/__tests__/` (focused on the pure logic — dispatch dates, subscription math/conflict, order filters, wallet, IST date handling, report aggregation, validators) plus 2 Deno tests for `place-order` and `cancel-order`. `npm run check` = `tsc --noEmit && jest`.
- **Lint/format gates:** ESLint flat config; Husky `pre-push` hook; `knip` for dead-code detection.
- **Builds:** EAS (`eas.json`); Android `.aab`/`.apk` artifacts present in the repo root; a web build in `dist/` (React Native Web — Razorpay is unavailable on web, so web checkout is wallet-only).
- **OTA:** JS-only changes ship over-the-air via `expo-updates` without an app-store submission (`useOTAUpdates`).

---

*End of Doc 1. See Doc 2 (Business Logic & Flows) for how orders, payments, dispatch, subscriptions, and notifications actually behave; Doc 3 (Screen-by-Screen) for every screen; Doc 4 (Ops & Maintenance Runbook) for jobs, config, and recovery.*
