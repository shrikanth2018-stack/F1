# CLAUDE.md — 1stOne F1

Expo/React Native app + Supabase backend for a home-kitchen food & essentials delivery business (single region, IST). One binary serves customer, staff, driver, hub-operator, vendor and admin personas, routed by JWT claims + table lookups.

> **Provenance.** Sections 1–9 were re-derived directly from source on 2026-07-30, verified against the live database, not from `docs/`. Where anything disagrees with the code, the code wins.
>
> The superseded doc set (`01`–`05`, `CODEBASE_MAP`, `DEEP_DIVE_2026-07-27`) was deleted the same day — all of it predated the vendor network and described four personas rather than six. Recover from git history if ever needed. What remains in `docs/` is still current: `06-ops-and-maintenance-runbook.md`, `07-incident-playbooks.md`, `PHASE_2_PLAN.md` (branch 2 + reverse supply chain, not started), `VENDOR_ONBOARDING_QUESTIONS.md` (decisions record), `HEALTH_REPORT.md` (polish backlog — partly overtaken by §9 below).

## Stack
Expo SDK 54 · RN 0.81.5 · React 19.1 · TypeScript 5.9 · React Navigation 7 · TanStack Query 5 · Zustand 5 · Supabase (Postgres + RLS + 15 Deno edge functions + pg_cron) · Razorpay · Expo Push · Sentry · PostHog.

## Commands
- `npm run check` — `tsc --noEmit && jest` (the pre-push gate; run before any push)
- `npm test` / `npm run test:watch` / `npm run lint`
- `npm start` (Expo dev server), `npm run android` / `ios` / `web`
- `npm run supabase:gen-types` — regenerate `src/types/database.types.ts` after any schema change
- Edge functions: `supabase functions deploy <name> --no-verify-jwt`
- OTA release: `eas update --channel production` (JS-only changes)

## Layout
- `src/screens/{auth,customer,staff,admin}` — screens by persona; `src/navigation/` — role navigators (`RootNavigator` switches on JWT role)
- `src/hooks/` — all data access (React Query, 56 hooks); `src/api/` — supabase client, `invokeFunction`, query helpers
- `src/store/` — Zustand: `cartStore` (food), `essentialsCartStore` (separate!), `staffQueueStore` (offline queue), `uiStore`, `branchStore`
- `src/utils/` — pure logic (dispatch, order status, IST dates, validators) — this is what the Jest suites cover
- `supabase/functions/` — edge functions; `_shared/orderBuild.ts` + `_shared/dispatch.ts` are the money/date brain
- `supabase/sql/` — 101 idempotent SQL files, applied manually per `DEPLOY_SQL_ORDER.md` (no migration runner)
- `landing/` — static marketing site (1stone.in, Cloudflare Pages)

---

# 1. Architecture

**Client → server contract.** The phone sends *intent* (item ids + quantities + address + payment method). The server derives cycles, dispatch dates, prices, tax and fees. `_shared/orderBuild.ts:109 buildAuthoritativeOrder` is the single derivation used by **both** `quote-order` (preview) and `place-order` (commit), so quoted price and charged price cannot diverge in logic.

**Routing.** `App.tsx` mounts ErrorBoundary → QueryClientProvider → AuthProvider → SafeAreaProvider. `RootNavigator.tsx:141-152` picks a navigator from the session:
- `role === 'admin'` → `AdminNavigator`
- `role === 'staff'` && !isDriver → `StaffNavigator`
- everything else (customer, driver-staff, unknown roles) → `CustomerNavigator`

Driver-staff (`role='staff'` + `is_driver`) is deliberately routed through `CustomerNavigator` while keeping staff RLS rights (`RootNavigator.tsx:142`).

**Role source.** `useAuth.ts:38 extractRole` base64-decodes the JWT payload client-side — zero extra queries. Claims: `user_role`, `branch_id`, `assigned_hub_id`, `is_super_admin`, `is_driver`, stamped by `custom_access_token_hook`. A decode failure falls back to `role: 'customer'`. Claims refresh on app foreground (`useAuth.ts:126-133`) so promotions appear without logout; `supabase.realtime.setAuth` is kept in lockstep or Realtime channels join as anon and hit a reconnect loop.

**Vendor is NOT a JWT role.** A vendor is a `customer`-role profile with a `vendors` row, read from the table by `useMyVendor` — deliberately kept out of the token hook (`vendors_schema.sql:146-149`) because the hook runs for every login of every user and has drifted before (BF-37). Hub operator works the same way (`assigned_hub_id`).

**State.** TanStack Query for all server state (2-min `QUERY_STALE_TIME`, retry 2, `refetchOnWindowFocus` wired to AppState in `App.tsx:68`). Zustand for client state only. Supabase Realtime streams order changes to staff/admin (`useRealtimeOrders`).

**Async work** is server-side: `pg_cron` per-minute kitchen tick, daily/weekly lifecycle pushes, and push fan-out via `EdgeRuntime.waitUntil` (`_shared/notifications.ts:54 runAfterResponse`).

---

# 2. Navigation map

## Auth
`LoginScreen` (phone + OTP as one screen with an internal phase machine) → existing user: session drives re-render; new user: `OnboardingScreen` (name + address + pin, saved atomically via `complete_onboarding_atomic`). Deep link `1stone://referral?code=X` is captured in `RootNavigator.tsx:69-87` and auto-applied once the session is live.

## CustomerNavigator (stack, no tab bar)
```
Home ─┬─ Orders ── OrderDetail ── Feedback
      ├─ Subscriptions ─→ Plans
      ├─ Cart ── Checkout
      ├─ Plans (modal) ── PlanDetail ─→ Cart
      ├─ Wallet (modal) · LoyaltyPoints (modal) · Referral
      ├─ AddAddress · EditProfile
      └─ ProfilePopup ─┬─ HubDashboard ── HubOrderHistoryDetail   (hub operators)
                       ├─ VendorRegistration | VendorDashboard     (vendors)
                       └─ DriverDashboard                          (drivers)
```
`ProfilePopup.tsx` is the router for the secondary personas — it conditionally renders rows based on `assignedHubId`, `useMyVendor()` status, and `isDriver` (`ProfilePopup.tsx:261-291`).

## StaffNavigator
`StaffDashboard` (top tabs **Kitchen | Packing**, Packing has Food/Essentials sub-tabs) → `Attendance`, `StaffExpenses`, `StaffProfile`.
The Delivery tab **moved out** to `DriverDashboardScreen` + admin Delivery Manager (`StaffDashboard.tsx:146-147`); the file's own header comment still claims three tabs.

## AdminNavigator
Root `AdminHome` with two inline tabs.
- **Reports** → OrderReport · RevenueReport · SubscriptionReport · StaffReport · HubReport
- **Manage** (searchable list, `AdminHome.tsx:173-193`) grouped as:
  - Customers → AdminCreateCustomer · AdminCustomerLookup · **AdminVendorManager → AdminVendorOnboard / AdminVendorDetail**
  - Orders → AdminCreateOrder (bulk/B2B) · AdminOrders → AdminOrderDetail · AdminSubscriptions
  - Menu → MenuManage → CreateItem/CreateMenu · EssentialsCatalogManage → CreateEssential · PlansManage → CreatePlan · ImportItems
  - Delivery → DeliveryManage → HubDetail
  - Notifications → PushNotifications (Note to Staff) · NotificationManager
  - Marketing → LoginBg (banners) · ReferralSettings · CustomerFeedback
  - Resources → ResourceManager → EmployeeDetail / OnboardEmployee
  - Finance → ExpenseManager · StockManager
  - Operations → StoreConfig · FeatureFlags · JobHealth
  - Super-admin only → BranchesManage · CustomerExport (gated by `useBranchFilter().isSuperAdmin`)

---

# 3. Roles and capabilities

| Persona | How identified | Can do |
|---|---|---|
| **Customer** | default | Browse food + essentials (separate carts), order, subscribe, wallet top-up, loyalty, referrals, cancel own order group, feedback, manage addresses |
| **Staff (kitchen/packing)** | `user_role='staff'` | Active-batch board, bulk status advance, kitchen aggregate, attendance (offline-capable) + corrections, supply requests, expense claims |
| **Driver** | `is_driver` claim (set via `delivery_zones/hubs.driver_user_id`) | `DriverDashboard`; on hub orders advances only `Dispatched → Received at Hub` then stops (`deliveryStatus.ts:34-38`) |
| **Hub operator** | `customer` role + `assigned_hub_id` | `HubDashboard`; last mile `Received at Hub → On the Way → Delivered`; monthly commission claim (`expense_claims`, category `Hub Commission`) |
| **Vendor** | `customer` role + `vendors` row | Complete registration (`vendor_submit_registration`), then once **approved**: manage own `essentials_catalog` rows (price/unit/daily cap/on-off), see own paid orders with a `cancellable_until` deadline, mark ready, view earnings, claim payout |
| **Admin** | `user_role='admin'` | Everything in §2; branch-scoped by `has_branch_access` |
| **Super-admin** | `is_super_admin` claim | Adds branch management, customer export, `store_config` / `feature_flags` writes |

**Vendor lifecycle:** `invited` (admin elevates an *existing registered user* — never creates a login) → `submitted` (vendor fills business name/GST/FSSAI) → `approved` (items may go live) → `suspended` (catalogue off, existing orders honoured, balance still claimable) / `rejected` (terminal).

**Vendor selling models:** `own_brand` (vendor is seller of record; paid sale value less commission) and `house_brand` (1stOne is seller of record and buys at an agreed per-item rate `essentials_catalog.vendor_cost`). See §9 — `vendor_cost` has no write path.

**Permission enforcement.** Sensitive columns are never client-writable. `vendors` has `REVOKE UPDATE ... FROM authenticated` with a column-level `GRANT UPDATE (business_name, contact_phone, gst_number, fssai_number, return_policy, terms_accepted_at, submitted_at)` (`vendors_schema.sql:212-215`) — status, commission and selling model can only move through `admin_set_vendor_*`. Same pattern as `profiles.role` behind `elevate_to_staff`, and `wallet_balance` behind the atomic increment RPCs.

---

# 4. Backend integrations

## Supabase
- **Auth:** phone OTP only, no passwords. Phone change is OTP-verified and mirrored to `profiles.phone_number` by a trigger.
- **RLS on every table.** Helpers in `rls_policies.sql`: `jwt_user_role()`, `jwt_branch_id()`, `is_admin()`, `is_staff_or_admin()`, `is_super_admin()` (falls back to the column for stale tokens), `has_branch_access()`. Pattern: customers touch own rows; staff/admin branch-scoped; super-admin sees all.
- **Notable policies:** `wallet_tx_no_writes` (ledger is read-only to the app); `expense_claims_self` (`staff_id = auth.uid() OR admin`) — this is what lets a *customer-role* vendor read their own payout claims; `essentials_vendor_scope` is **RESTRICTIVE FOR SELECT** (`vendors_visibility.sql:51`) so it ANDs with the permissive `essentials_catalog_read_all USING (true)` rather than being clobbered when `rls_policies.sql` is re-run.
- **Edge functions (15)** deploy `--no-verify-jwt`; `_shared/auth.ts` is the real auth boundary — local ES256 JWKS verification with `algorithms: ['ES256']` pinned against alg-confusion.
- **Key tables:** `profiles`, `wallet_transactions`, `pending_wallet_topups`, `orders` (one row **per delivery cycle**; the customer-facing order is the `order_group_id` set), `order_items`, `user_subscriptions`, `cancelled_subscription_days`, `menu_items`, `essentials_catalog`, `subscription_plans`, `delivery_cycles/zones/hubs`, `customer_addresses`, `vendors`, `vendor_zones`, `vendor_earnings`, `vendor_order_fulfilment`, `store_config`, `feature_flags`, `notification_templates`, `idempotency_keys`, `kitchen_push_log`, `manifest_run_log`, `push_logs`.
- **No DB enums** — statuses are plain text; `src/utils/orderStatus.ts` is the single vocabulary.

## Razorpay
- `place-order` creates the Razorpay order **before** any DB write (`place-order/index.ts:181-199`, 15 s `AbortSignal.timeout`); order lands as `Pending`.
- Two independent, idempotent confirmation paths: foreground `confirm-order` (HMAC of `order_id|payment_id`, retried twice by the app) and the `verify-payment` webhook (HMAC-SHA256 of the raw body; **refuses to run without `RAZORPAY_WEBHOOK_SECRET`**, `verify-payment/index.ts:64-67`). Both flip the whole group by `razorpay_order_id` and activate subscriptions.
- Webhook handles `payment.captured`, `order.paid`, `payment.failed`, and `payment_link.paid` (admin/bulk orders — matched on `razorpay_payment_link_id`, must be ticked in the Razorpay dashboard or bulk orders never mark paid). All branches run per call; no early return.
- Webhook always returns 200 on internal failure — a 500 makes Razorpay retry indefinitely.
- **Web has no Razorpay** (`src/utils/razorpay.ts` is a throwing shim); web checkout is wallet-only.

## Maps
`react-native-maps` (native) / `@react-google-maps/api` (web), split via `PinMap.tsx` / `PinMap.native.tsx` and `ZoneMap.*`. No Expo config plugin exists, so the Android key is injected into `AndroidManifest.xml` by the inline `withGoogleMapsAndroid` plugin in `app.config.js:12-30`. Serviceability is a **server-side** point-in-polygon test (`serviceability_server_side.sql`) that stamps `zone_id`/`hub_id`/`branch_id` onto the address.

## Sentry
`src/utils/sentry.ts`, `initSentry()` at `App.tsx:35`. `enabled: !__DEV__`, `tracesSampleRate` 0.2 in prod. User context tagged on session change (`useAuth.ts:143-151`). Money-path failures explicitly `captureError`ed in `CheckoutScreen` (razorpay_open, confirm_order, place_order) and `useOfflineSync` (dropped queue mutation).

## PostHog
`src/utils/analytics.ts`, `initAnalytics()` at `App.tsx:36`. 12 funnel events, all wired to real call sites. **No-op unless `EXPO_PUBLIC_POSTHOG_KEY` is set — see §9.**

---

# 5. Critical business flows

## 5.1 Place order (the money path)
1. `CheckoutScreen` holds one idempotency key per checkout session (`CheckoutScreen.tsx:104`), gets a binding quote from `quote-order`, asks Scenario-C consent (`:210`), then calls `place-order` echoing `client_quote` + `Idempotency-Key` (`:233`).
2. `place-order`: JWT verify → rate limit 5/60 s → idempotency replay → legacy-`groups` payload guard → `client_quote` required else 409.
3. `buildAuthoritativeOrder` re-prices from DB, derives IST dispatch dates from cutoffs, groups by cycle, carves GST out of inclusive prices, applies fee priority **hub → zone → store default** on the earliest-dispatch group only, and runs storm/serviceability/subscription-conflict/vendor-zone/daily-cap checks.
4. **Drift tripwire:** exact integer-paise tuple comparison (`dispatch.ts:128 driftedFields`). Any drift → 409 `quote_changed`, nothing written, no money moved; the app re-quotes and asks the customer to re-confirm.
5. Razorpay order created, or atomic wallet debit (`decrement_wallet_balance_if_sufficient`).
6. All rows written by `place_order_atomic`. On failure the wallet debit auto-refunds; a *failed* refund returns a support reference and logs a reconciliation alert (`:256-266`).
7. `user_subscriptions` created per plan — `is_active` only for wallet payments; Razorpay subs activate on confirm/webhook. Insert failures push `admin.subscription_create_failed`.
8. Idempotency key is consumed **only on success** (`:363-370`), so a 409 does not burn it.

**Dispatch scenarios** (`dispatch.ts:83`): same-day cycle → A (before cutoff, today) / B (after, tomorrow). Cross-midnight cycle (`cutoff > delivery_start`) → B (before cutoff, tomorrow) / C (after, day after tomorrow — requires explicit customer consent).

## 5.2 Vendor onboarding → earnings → payout
1. Admin finds an **already-registered** user by phone (`AdminVendorOnboardScreen`) and calls `admin_onboard_vendor` → status `invited`. Never creates a login.
2. A "Complete vendor registration" row appears in that person's ProfilePopup → `VendorRegistrationScreen` → `vendor_submit_registration` RPC (a plain table update can't move `status`, which is not grantable) → `submitted`.
3. Admin verifies in `AdminVendorDetailScreen`, sets terms (`admin_set_vendor_terms`) and selling areas (`vendor_zones`, admin-write only), then `admin_set_vendor_status('approved')`.
4. Vendor's items live in `essentials_catalog` with a `vendor_id` — **so the order path needs no changes at all**; they inherit cycle tagging, the cart, `buildAuthoritativeOrder`, the GST carve-out and the kitchen exclusion.
5. Visibility is enforced in RLS for browsing and re-checked server-side for ordering via `vendor_ids_for_address` (the builder runs as service-role and bypasses RLS).
6. **Earnings credit on delivery via a TRIGGER** (`vendors_earnings_trigger.sql:180`) — because an order reaches `Delivered` by four routes (staff update, offline replay, `advance_orders_status`, admin override) and only a trigger catches all four. `ux_vendor_earnings_order_item` makes double-payment impossible at DB level. Per-line and whole-routine exception isolation: a credit failure never blocks recording the delivery.
7. Payout: `create_vendor_payout_claim` turns the wallet balance into an `expense_claims` row (category `Vendor Payout`, one open claim at a time), settled in one step in Expense Manager; `trg_vendor_payout_paid` debits the wallet on the `Paid` transition.

## 5.3 Subscription dispatch → staff batch board
1. `pg_cron` runs `trigger_kitchen_cutoff_pushes()` **every minute**. Delivery is **at-least-once**: the `kitchen_push_log` row is a *claim*, final only once `notified_at` is set; unconfirmed claims are retried until `delivery_start` passes, then `alert_missing_kitchen_pushes()` alarms.
2. `generate_daily_manifest` creates one `Confirmed` order per active, non-paused subscription, items mirrored from `plan_items` JSON, **zero-money rows** (BF-19 — revenue was booked at purchase), idempotent per `(subscription, date)`, per-subscription error isolation.
3. `push_kitchen_summary` aggregates and pushes to staff via `pg_net` → `send-push`. **The push is the batch release.**
4. `useActiveStaffBatch` reads the latest `kitchen_push_log` row; `useStaffOrders.ts:52-79` shows exactly that cycle's batch **plus** any past-dated undelivered order (D2), hub-operator-filtered, with subscription-purchase revenue rows removed by `isOperationalOrder`.

## 5.4 Cancellation
`cancel-order` cancels the **whole order group**. Guards: ownership, at least one cancellable row, within `cancellation_window_hours` of creation, and the **earliest** dispatch cycle's cutoff not passed (cross-midnight aware). Refunds the sum of `wallet_amount_used` over rows it actually cancelled; a Razorpay portion is reported as `razorpay_refund_due` for a manual dashboard refund. Fully idempotent — an already-cancelled group returns success without a second refund. Subscription-purchase orders are refused here (G7) because this endpoint never touches `user_subscriptions`; that's `admin_cancel_subscription`.

## 5.5 Staff offline status update
Offline → persisted Zustand queue. On reconnect `useOfflineSync` drains FIFO with four guards: session must exist; **identity guard** (mutations queued by another user on a shared device are discarded); **no-regress guard** (`ORDER_STATUS_FLOW.slice(0, targetIdx)` — a stale update lands as a 0-row no-op); and the customer push fires only if the row actually changed. Max 5 retries, then the dropped mutation is reported to Sentry.

---

# 6. Test setup and coverage

- **26 Jest suites, 368 tests** in `src/__tests__/`. `jest-expo` preset, `testEnvironment: node`, `jest.setup.js` eagerly resolves Expo's lazy globals (otherwise they throw "outside of scope").
- Coverage is collected from `src/utils/**` + `src/hooks/**` only. **Screens, components and edge functions have no direct coverage**; `orderBuild.test.ts`, `dispatch.test.ts`, `reportAggregations.test.ts` and `sendPush.test.ts` reach server code by importing the shared modules.
- Covered: dispatch dates, order build, subscription math + conflict, order filters, packing flow, delivery status transitions, IST dates, CSV parse/build, validators, formatters, cart store, `extractRole`, and hook tests (`useOrders`, `useStaffOrders`, `useSubscriptions`, `useWallet`, `useAdminOrders`, `useBranchFilter`, `useOfflineSync`, `useSupabaseQuery`) via a shared query-client helper.
- **No CI service** — the Husky `pre-push` hook (`tsc --noEmit` then `jest`) is the only automated gate.
- `knip.json` for dead-code analysis; `patch-package` re-applies `patches/react-native-razorpay+2.3.1.patch` on install.

---

# 7. Non-negotiable invariants
- **Server decides money/dates/prices.** The app sends item ids + quantities only. Never weaken the quote-drift (409 `quote_changed`), idempotency-key, or rate-limit logic in `place-order`.
- **Wallet ledger is never app-written** — all wallet movement via atomic RPCs (`increment_wallet_balance`, `decrement_wallet_balance_if_sufficient`).
- **RLS stays on**; role/money columns change only through SECURITY DEFINER RPCs or service-role functions.
- **Never disable the webhook HMAC check** in `verify-payment`.
- Prices are **GST-inclusive** (tax carved out, never added). All time logic is explicit `Asia/Kolkata`.
- `Packed` status is intentionally push-silent; only `Ready` notifies customers.
- Vendor credit is a **trigger**, not a code path — do not move it into one.

# 8. Gotchas
- **`place-order` payload is not backward-compatible** — deploy the function and the app build together.
- **Live DB > repo `schema.sql`** — the snapshot lags; trust the live Supabase schema. Newer RPCs are called with `(supabase as any).rpc(...)` casts ("MF-08 pattern") until types are regenerated.
- **Never format a business date with `toISOString()`** — use `src/utils/istDate.ts`. Between 00:00 and 05:30 IST that silently yields the previous day.
- Web build has no Razorpay — web checkout/top-up is wallet-only; guard new payment UI accordingly.
- Staff board shows one cycle's batch (latest `kitchen_push_log` row) + past undelivered orders — an "empty board" before the first push of the day is by design.
- `essentials_catalog` rows with `vendor_id IS NULL` are 1stOne's own — that is every row until the first vendor item exists. Both the daily-cap and vendor-zone guards in `orderBuild` only run when a cart actually holds a vendor item.
- No hardcoded business values or colors: business rules live in `store_config`/`feature_flags`, styling in `src/theme/`.
- Code comments carry audit tags (D#, G#, BF-#, MF-#, O#, FT-#) referencing past audit rounds — keep them when editing nearby code; match the existing header-comment style in every file.

# 9. Audit state — July 2026 stable

Full audit 2026-07-30, verified against the live database. Everything below is
the state **after** the fixes of that date.

## Closed

- **`expense_claims` categories.** The CHECK had never been widened past its
  original five values, so staff `Others` expenses, `Hub Commission` and
  `Vendor Payout` were all rejected at insert — the latter two dead since the
  day they shipped. Widened, applied to production, recorded in
  `DEPLOY_SQL_ORDER.md` §17. **Rule: add the value in the same file that
  introduces a new claim category.**
- **Vendor items filed under a non-essentials cycle.** `buildSections` drops
  any item whose cycle isn't in the essentials list, so a vendor could file
  one under Snacks and have it fetched then silently discarded. The vendor's
  picker now offers only cycles that can render.
- **House-brand vendors credited ₹0.** `essentials_catalog.vendor_cost` had no
  write path, so `credit_vendor_earnings_for_order` COALESCEd it to 0 on every
  delivered sale, with a Postgres `WARNING` as the only trace. The option is
  now withheld from both vendor screens until house brand has its own
  onboarding, agreed buying price and wallet treatment (see `PHASE_2_PLAN.md`).
  Column and trigger still handle both models.
- **Invisible vendors.** An approved vendor with no granted zone or hub reaches
  nobody and looks identical to one selling normally. My Store now names its
  areas or warns it has none, the admin vendor page warns when none is granted,
  and onboarding can set them — it never asked before.
- **Stale essentials list.** A vendor adding an item is a change on another
  device, so the customer's cache held a stale list for up to two minutes. The
  essentials query now re-reads on mount and on foreground. (Live-while-watching
  would need a Realtime subscription; deliberately not added.)
- **In-app payments left no reference.** `confirm-order` usually beats the
  webhook, and `mark_order_paid` only matches rows still `Pending`, so whichever
  ran second found nothing — the order ended up with no `paid_at` and no
  `razorpay_payment_id`. Nothing to reconcile against Razorpay, no payment id to
  refund with. Both paths now write the same row state. Orders placed before
  2026-07-30 still carry neither.
- **Reports read a failed fetch as zero.** Four report screens destructured only
  `data`/`isLoading` and rendered "no data for this period" when the query
  errored — a real zero, in a screen used to make decisions. All four now
  distinguish an error from an empty period.
- **Timezone-dependent test suite.** `walletNudge.test.ts` built dates as UTC and
  stepped them in local time, so `npm run check` was green in IST and red on any
  machine behind UTC. It now uses the same `istDate` helpers as the hook.
- **Shared wallet for vendor-customers** — reviewed and confirmed intended.
  One person, one wallet: they spend as a customer and claim as a vendor.

## Open

1. **Production still ships the Razorpay test key.** `eas.json` production
   `EXPO_PUBLIC_RAZORPAY_KEY_ID = rzp_test_…`. Live payments cannot work until
   this and the server-side secret are switched together. **Blocks going live.**
2. **PostHog has never been configured.** `EXPO_PUBLIC_POSTHOG_KEY` is empty in
   `.env` and absent from every `eas.json` profile, so `initAnalytics()` returns
   early everywhere — all 12 funnel events have always been no-ops. Needs a key
   from a PostHog project; there is nothing to fix in code.
3. **`eas.json` preview/development profiles are incomplete.** `development` has
   no `EXPO_PUBLIC_SUPABASE_ANON_KEY` and no Maps key; `preview` has no Sentry
   DSN. Dev-client builds survive because Metro serves the local `.env`; a
   standalone build from these profiles would not.
4. **iOS submit config is placeholders** — `REPLACE_WITH_APPLE_ID` /
   `REPLACE_WITH_ASC_APP_ID` / `REPLACE_WITH_TEAM_ID`.
5. **Rate limiting counts only successful orders.** `place-order` counts
   `idempotency_keys` rows, which are written only on success, so repeated
   failures are not throttled. Low impact; left alone because changing it means
   touching the idempotency contract on the money path.
6. **`vendor_supply_list()` is deployed but unreachable from the app.** The RPC
   and its hook `useVendorSupplyList` are complete, but the dashboard's "Supply"
   tab renders `useVendorOrders` instead. Exercised by the health check (§J).
7. **`'Paid'` is a dead order status** still referenced defensively in
   `cancel-order`, `OrderDetailScreen`, `confirm-order`, `kitchen_cutoff_push.sql`
   and the `orders_status_allowed` CHECK. `mark_order_paid` writes `'Confirmed'`
   (BF-32a). Harmless today, but it is absent from `ORDER_STATUS_FLOW`, so
   anything that ever *did* write it would fall outside the offline no-regress guard.
8. **`StaffDashboard.tsx:5,16`** still documents a "Kitchen | Packing | Delivery"
   three-tab layout; Delivery moved to `DriverDashboardScreen` + admin Delivery
   Manager (acknowledged at `:146-147`).
9. **Single environment, no staging.** One Supabase project serves dev, preview
   and production. The service-role key lives in three places (function env,
   Vault, `app_config`) — rotation must touch all three.

## Health check

`supabase/tests/platform_health_check.sql` — 30 assertions across back-office
customer creation, bulk orders, wallet, staff role gates, vendor
credit-on-delivery, cancellation, loyalty, the vendor portal, hub commission and
the subscription manifest. Runs against the live database inside a transaction
that always rolls back.

```
supabase db query --linked --file supabase/tests/platform_health_check.sql
```

It ends in an error by design — that is what rolls it back. Read the report, not
the exit code. Re-run it after any schema or RPC change.

## Working agreements (owner preferences)
- After making edits, **pause for owner review before** running tsc/jest or committing.
- During polish sessions, bank changes locally — one commit + OTA per slice, not per fix.
- Owner-facing flows must be tested by actually opening every screen (no symbolic testing); prefer AskUserQuestion options over free-text during device tests.
- Commit/push only when asked.
