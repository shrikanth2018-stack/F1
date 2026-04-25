# 1stOne F1 — System Flows (Read-Only Architecture Audit)

> Generated: 2026-04-23. Documents current code reality only.

---

## 1. Authentication & Onboarding Flow

### a. Phone Entry (`LoginScreen.tsx`)
   - i. Background image fetched from `app_settings.login_bg_url` (Supabase Storage) on mount.
   - ii. User enters 10-digit Indian mobile number via passcode-dot UI (hidden TextInput).
   - iii. `isValidIndianPhone()` validates before proceeding. `normalizePhone()` prepends `+91`.
   - iv. `signInWithPhone()` → `supabase.auth.signInWithOtp({ phone })` — Supabase triggers SMS OTP.
   - v. On success: `onOTPSent(phone)` → `RootNavigator` sets `step='otp'` and stores `pendingPhone`.

### b. OTP Verification (`OTPScreen.tsx`)
   - i. 6-digit OTP entered via passcode-dot UI. Auto-submits when `otp.length === 6`.
   - ii. `verifyOTP()` → `supabase.auth.verifyOtp({ phone, token, type: 'sms' })`.
   - iii. On OTP success: Supabase session is created; `onAuthStateChange` in `AuthProvider` fires, setting session state.
   - iv. Profile existence check: fetches `profiles` table via `.or(phone_number.eq.${canonicalPhone},phone_number.eq.${phone})`.
      - Canonical phone from `supabase.auth.getUser()` is used to avoid format-mismatch bugs.
      - If `profile` row exists OR the query itself errors → `onExistingUser()` (auth state change already re-renders to role navigator).
      - If no profile row → `onNewUser()` → `RootNavigator` sets `isNewUser=true`, `step='name'`.

### c. Registration (`RegistrationScreen.tsx` — new users only)
   - i. Rendered when `step === 'name'` (checked **before** the session guard to prevent race with `onAuthStateChange`).
   - ii. User enters full name.
   - iii. `supabase.from('profiles').upsert({ phone_number, full_name }, { onConflict: 'phone_number' })` — creates the profile row directly (user is already authenticated at this point).
   - iv. `onComplete(name)` → `RootNavigator` sets `needsOnboarding=true`.

### d. Address Onboarding (`AddAddressScreen` — new users only)
   - i. Shown when `session && needsOnboarding` — between registration and the main app.
   - ii. User adds their first delivery address.
   - iii. `onComplete()` → `needsOnboarding=false` → role navigator renders.

### e. JWT Role Extraction & Session Management (`useAuth.ts`)
   - i. On mount: `supabase.auth.getSession()` reads JWT from AsyncStorage → `extractRole()` decodes JWT payload.
   - ii. JWT custom claims decoded client-side: `user_role`, `assigned_hub_id`, `branch_id` extracted from `payload`.
   - iii. `onAuthStateChange` listener keeps session live on token refresh and sign-out.
   - iv. `AppState` listener: calls `supabase.auth.getSession()` whenever app returns to foreground — prevents 401s after OS suspends the auto-refresh timer.
   - v. `signOut()`: calls `supabase.auth.signOut()` + clears `cartStore`, `essentialsCartStore`, `staffQueueStore`.

### f. Database: JWT Hook (`custom_access_token_hook.sql`)
   - i. Postgres function `public.custom_access_token_hook(event JSONB)` registered as Supabase Auth hook type "Custom Access Token".
   - ii. On every JWT mint, reads `profiles.role`, `profiles.assigned_hub_id`, `profiles.branch_id` for the signing user.
   - iii. Injects `user_role`, `assigned_hub_id`, `branch_id` into JWT claims via `jsonb_set`.
   - iv. Defaults `user_role` to `'customer'` if no profile row exists yet.
   - v. `supabase_auth_admin` role is GRANTed EXECUTE on the hook and SELECT on `profiles`.

### g. Role Routing (`RootNavigator.tsx`)
   - i. `isLoading=true` → render `null` (splash held).
   - ii. `step === 'name'` → `RegistrationScreen`.
   - iii. `session && needsOnboarding` → `AddAddressScreen`.
   - iv. `session && role === 'admin'` → `AdminNavigator`.
   - v. `session && role === 'staff'` → `StaffNavigator`.
   - vi. `session && (role === 'customer' || unknown role)` → `CustomerNavigator`.
   - vii. `step === 'otp'` → `OTPScreen`.
   - viii. Default → `LoginScreen`.

### h. Deep Link: Referral (`RootNavigator.tsx`)
   - i. `Linking.getInitialURL()` (cold start) + `Linking.addEventListener('url', ...)` (foreground) parse `1stone://referral?code=XXX`.
   - ii. Extracted code stored in `pendingReferralCode` state; passed to `LoginScreen` as prop.
   - iii. LoginScreen shows referral hint banner. Referral is applied post-signup via `apply-referral` Edge Function.

---

## 2. Standard Order Flow

### a. Menu Browsing (`HomeScreen.tsx` / `useMenuItems.ts`)
   - i. `menu_items` table queried via `useMenuItems()` hook (TanStack Query).
   - ii. Each item includes `cycle_id` linking it to a `delivery_cycles` row.
   - iii. Item added to `cartStore` (Zustand, persisted to AsyncStorage) with `menu_item_id`, `cycle_id`, `display_price`, `quantity`.

### b. Dispatch Scenario Evaluation (`useSmartCart.ts` / `timeEngine.ts`)
   - i. `useServerTime()` fetches server timestamp via `get_server_time()` Supabase RPC. Device clock is **never** used for business logic.
   - ii. `getDispatchScenario(cycle, serverTimestamp)` in `timeEngine.ts`:
      - Converts current server time and `cutoff_time` to minutes-since-midnight.
      - Cross-midnight detection: if `cutoff_time > delivery_start` the cycle is cross-midnight.
      - **Scenario A** (before cutoff): dispatched **today**.
      - **Scenario B** (after cutoff): dispatched **tomorrow**.
   - iii. `useSmartCart` returns `evaluations[]` — one per cart item, each with `scenario`, `dispatch_label`, `cycleId`.

### c. Cart Screen (`CartScreen.tsx`)
   - i. Items separated into two groups: "Dispatch Today" (Scenario A) and "Dispatch Tomorrow" (Scenario B) for both food and essentials.
   - ii. If both groups are non-empty: confirmation alert ("Mixed Dispatch") before proceeding to checkout.
   - iii. Essentials cart managed by separate `essentialsCartStore`; evaluated by `useSmartEssentialsCart`.
   - iv. Separate floating checkout buttons for food and essentials (both can be in cart simultaneously).

### d. Checkout Screen (`CheckoutScreen.tsx`)
   - i. Pre-flight guards (checked client-side before invoking Edge Function):
      - `config.storm_mode_active === true` → blocks with "Orders Paused" alert.
      - No address selected → blocks.
      - `selectedAddr.is_serviceable === false` → blocks.
      - Empty cart → blocks.
      - Mixed dispatch scenarios (food only) → blocks if `scenarios.length > 1`.
   - ii. Dispatch date: Scenario A → today's ISO date; Scenario B → tomorrow's ISO date. Essentials always use today.
   - iii. Address selection: default or first address pre-selected. `zone_id` extracted to look up `delivery_fee_override`.
   - iv. Price breakdown: subtotal + tax (`config.tax_rate_percentage`) + delivery fee (zone override or global).
   - v. Payment options: `razorpay` (UPI/Card/Net Banking) or `wallet` (shows current balance; shows top-up prompt if insufficient).
   - vi. Idempotency key: `crypto.randomUUID()` (fallback to `Math.random`), generated once per checkout session; refreshed after a successful order.

### e. `place-order` Edge Function
   - i. **Rate limit**: checks `idempotency_keys` table — max 5 calls per user per 60 seconds.
   - ii. **Idempotency**: if `Idempotency-Key` header matches an existing key for this user, returns cached response immediately.
   - iii. **Storm mode**: checks `feature_flags.flag_key='storm_mode_active'` first, then `store_config.storm_mode_active`. Either `true` → 403.
   - iv. **Address validation**: fetches `customer_addresses` by `id + user_id`. Extracts `zone_id`, `hub_id`, `branch_id` server-side (client values not trusted).
   - v. **Delivery fee**: global `config.delivery_fee` overridden by `delivery_zones.delivery_fee_override` if zone_id is set.
   - vi. **Delivery method**: `'hub'` if `hub_id` is non-null; `'direct'` otherwise.
   - vii. **Price recalculation**: fetches `menu_items` (food) and `essentials_catalog` (essentials) from DB by ID. Verifies `is_active`. Calculates `subtotal`, `tax_amount`, `total_amount`. Client's displayed price is ignored.
   - viii. **Razorpay order creation** (before DB write): POST to `https://api.razorpay.com/v1/orders`. Returns `razorpay_order_id`.
   - ix. **Wallet debit** (atomic): `decrement_wallet_balance_if_sufficient` Supabase RPC — debits only if balance ≥ total. Returns `true` on success, `false` on insufficient funds. Never read-modify-write directly.
   - x. **Atomic order insert**: `place_order_atomic` RPC inserts `orders` + all `order_items` in a single DB transaction. Status: `razorpay → 'Pending'`; `wallet → 'Confirmed'`.
   - xi. **Rollback**: if `place_order_atomic` fails and wallet was debited, `increment_wallet_balance` RPC is called to reverse.
   - xii. **Idempotency cache**: response payload stored in `idempotency_keys` table.
   - xiii. **Push notification**: for wallet orders (immediately Confirmed), calls `send-push` Edge Function fire-and-forget.

### f. Razorpay Payment (`CheckoutScreen.tsx`)
   - i. `RazorpayCheckout.open(options)` called with 500ms delay (allows UIKit to settle).
   - ii. AppState listener: if app returns to foreground while Razorpay sheet was open (killed webview), unsticks the Pay button. Order stays `Pending`; `PendingPaymentBanner` handles recovery.
   - iii. On user cancellation (`code === 'PAYMENT_CANCELLED'`): alert shown, order stays Pending.
   - iv. On success: calls `confirm-order` Edge Function.

### g. `confirm-order` Edge Function
   - i. Verifies order belongs to authenticated user and status is `Pending`.
   - ii. Idempotency: if already `Confirmed` or `Paid`, returns `{ status: 'already_confirmed' }`.
   - iii. HMAC-SHA256 signature verification: `HMAC(RAZORPAY_KEY_SECRET, razorpay_order_id|razorpay_payment_id)` must match `razorpay_signature`.
   - iv. On match: updates `orders.status = 'Confirmed'` where status is still `Pending` (idempotent guard).
   - v. Fallback path: `verify-payment` webhook runs in parallel; whichever completes first wins.

### h. `verify-payment` Webhook (`verify-payment/index.ts`)
   - i. Receives `payment.captured`, `order.paid`, or `payment.failed` from Razorpay.
   - ii. HMAC-SHA256 signature validated against `RAZORPAY_WEBHOOK_SECRET` on the raw body.
   - iii. `payment.captured` / `order.paid`:
      - Calls `mark_order_paid` RPC → marks customer order paid.
      - Calls `complete_wallet_topup` RPC → credits wallet topup.
      - Updates `user_subscriptions.is_active = true` for matching `razorpay_order_id`.
      - Fires push notification for each successful match.
   - iv. `payment.failed`: calls `mark_order_failed` RPC; updates `pending_wallet_topups.status = 'failed'`; logs inactive subscriptions.
   - v. Always returns HTTP 200 (prevents Razorpay retries on transient errors).

### i. Post-Order
   - i. Cart cleared (`clearFood()` or `clearEss()`).
   - ii. Idempotency key refreshed for next checkout session.
   - iii. `QUERY_KEYS.MY_ORDERS` invalidated → Orders tab refreshes.
   - iv. `PendingPaymentBanner` on HomeScreen polls `usePendingRazorpayOrder` every 15 seconds for any `Pending + razorpay` order in the last 2 hours.

---

## 3. Subscription Flow

### a. Plan Discovery (`PlansScreen.tsx` / `useSubscriptionPlans.ts`)
   - i. `useSubscriptionPlans(cycleId?)` fetches `subscription_plans` where `is_active = true`, ordered by `price`.
   - ii. Optional `cycle_id` filter for cycle-specific plan lists.

### b. Plan Detail & Conflict Check (`PlanDetailScreen.tsx`)
   - i. `usePlanItems(planId)` fetches `plan_items` JSON column from `subscription_plans`.
   - ii. `useMySubscriptions()` fetches all `user_subscriptions` joined with `subscription_plans(plan_name, duration_days, cycle_id, price, plan_type)`.
   - iii. **Client-side conflict check** (`conflictingSubs`):
      - Filters active subs where `subscription_plans.cycle_id === plan.cycle_id` AND `plan_type` matches.
      - `null` `plan_type` (legacy rows created before column existed) treated as `'food'`.
      - If conflict found: alert with option to "Start After" (day after existing sub ends).
   - iv. Start date picker: 14 calendar days from tomorrow displayed as horizontal scrollable pill strip.
   - v. Payment selection: `razorpay` or `wallet`.

### c. `subscribe` Edge Function
   - i. **Rate limit**: 5/user/60s via `idempotency_keys`.
   - ii. **Idempotency**: cached response returned on duplicate `Idempotency-Key`.
   - iii. **Plan load**: fetches plan, verifies `is_active`.
   - iv. **Server-side overlap check**: fetches all active subs for user; for each sub sharing `cycle_id` and `plan_type` (null→'food'), computes date range overlap using millisecond arithmetic. Returns 409 if new `[start, start+duration-1]` overlaps any existing `[existingStart, existingStart+duration-1]`.
   - v. **Wallet path**: `decrement_wallet_balance_if_sufficient` RPC → insert `user_subscriptions` row (`is_active=true`, `days_consumed=0`, `payment_method='wallet'`). On insert failure: rollback debit via `increment_wallet_balance`. Push notification sent.
   - vi. **Razorpay path**: create Razorpay order → insert `user_subscriptions` row (`is_active=false`, `razorpay_order_id` set). Returns `razorpay_order_id` to client.

### d. Razorpay Payment for Subscription (`PlanDetailScreen.tsx`)
   - i. `RazorpayCheckout.open()` wrapped in `Promise.race` with 30-second timeout.
   - ii. On success: calls `confirm-subscription` Edge Function.

### e. `confirm-subscription` Edge Function
   - i. **Idempotency precheck**: if sub is already `is_active=true` with same `razorpay_payment_id` → returns `{ status: 'already_active' }`.
   - ii. If already active with different payment_id → 409.
   - iii. HMAC-SHA256 signature verification.
   - iv. Updates `user_subscriptions` where `is_active=false` (DB-level race guard — only one concurrent writer wins).
   - v. If update returns 0 rows (webhook already activated it): still returns `{ status: 'already_active' }`.
   - vi. Fallback: `verify-payment` webhook updates `is_active=true` via direct `user_subscriptions` update.

### f. Subscription Management (customer)
   - i. `useSkipDay()`: inserts row into `cancelled_subscription_days` with `subscription_id`, `cancelled_date`, `cycle_id`.
   - ii. `useUndoSkip()`: deletes row from `cancelled_subscription_days` by id.
   - iii. `usePauseSubscription()`: updates `user_subscriptions.is_paused` — does not alter `is_active`.

### g. Subscription Management (admin)
   - i. `useAdminSubscriptions()`: fetches all active subs joined with plans and profiles.
   - ii. `useAdminCancelSubscription()`: sets `is_active=false, is_paused=false`.

---

## 4. Staff Operations Flow

### a. Dashboard Entry (`StaffDashboard.tsx`)
   - i. `useStaffOrders()` fetches all orders with `dispatch_date = today`, joined with `order_items(*)` and `customer_addresses(*)`.
   - ii. **Branch filter**: if `branch_management_active` flag is on and `session.branchId` is non-null, adds `.eq('branch_id', branchId)` to query.
   - iii. **Hub filter**: if `hub_delivery_active` flag is on and `session.assignedHubId` is non-null, client-side filters to orders where `customer_addresses.hub_id === assignedHubId`.
   - iv. `useRealtimeOrders(true)`: subscribes to Supabase Realtime `postgres_changes` on `orders` table filtered by `dispatch_date = today`. Any INSERT/UPDATE invalidates `QUERY_KEYS.STAFF_ORDERS` cache.
   - v. `useOfflineSync()`: watches `NetInfo`. On reconnect, drains `staffQueueStore` FIFO; discards mutations exceeding `MAX_QUEUE_RETRIES` or belonging to a different user (cross-session guard on shared devices).
   - vi. Staff message banner: fetches `store_config.staff_message`; displays below header.

### b. Kitchen Tab
   - i. `kitchenOrders`: filters to `status ∈ {Confirmed, Preparing, Ready}` AND `order_type === 'food'`.
   - ii. `aggregateKitchenItems(orders)`: iterates `order_items` of qualifying orders; groups by `item_name + status`; sums `total_quantity`; collects `order_ids[]`. Sorted by status order: Confirmed → Preparing → Ready.
   - iii. **Display**: shows aggregated item name and total quantity (NOT individual orders). Kitchen sees "Paneer Rice × 12", not 12 separate order rows.
   - iv. **Status toggle** (per aggregated row): button disabled if already `Ready`. On press: calls `useUpdateOrderStatus` for every `order_id` in the group with `status='Ready'`.
   - v. **"Mark all as Ready"** floating button: selects all orders where `status ∈ {Confirmed, Preparing}` → batch `updateStatus` calls with `status='Ready'`.
   - vi. **Footer**: "Vegetables ›" and "Grocery ›" → opens `OrderFormModal` for the respective category.

### c. Packing Tab
   - i. `packingOrders`: filters to `status ∈ {Ready, Packed, Dispatched}`; sub-tab toggles between `order_type='food'` and `order_type='essential'`.
   - ii. **Display**: individual order-level rows showing order ID, item names, customer name/address.
   - iii. **Status progression**: Ready → Packed → Dispatched (per order).
   - iv. **"Mark all as Packed"** floating button: marks all `status='Ready'` packing orders → `'Packed'`.
   - v. **Print labels** (expo-print): generates per-order HTML labels (one per page) with order ID, customer name, address, landmark, item list. Sent to system print dialog.
   - vi. **Print summary**: generates HTML table of all packing orders (ID, name, address, phone, items).
   - vii. **"Stationery order ›"** floating button: opens `OrderFormModal` for Stationery category.

### d. Delivery Tab
   - i. `deliveryOrders`: filters to `status ∈ {Dispatched, Received at Hub, On the Way}`.
   - ii. **Status progression**:
      - Direct orders (`delivery_method !== 'hub'`): Dispatched → On the Way → Delivered.
      - Hub orders (`delivery_method === 'hub'`): Dispatched → Received at Hub → On the Way → Delivered.
   - iii. **Actions per order**: phone call (opens `tel:` link), map (opens Apple Maps), address detail alert.
   - iv. **"Route Map ›"** footer: opens `routemap.pdf` from Supabase Storage public URL.

### e. `useUpdateOrderStatus` Mutation
   - i. **Online path**: `supabase.from('orders').update({ status, updated_at })`. Fire-and-forget push to customer via `send-push` Edge Function (using `STATUS_PUSH` map for title/body).
   - ii. **Offline path**: enqueues `{ table: 'orders', operation: 'update', payload: { status, updated_at }, matchColumn: 'id', matchValue: orderId }` to `staffQueueStore`.
   - iii. On success: invalidates `QUERY_KEYS.STAFF_ORDERS`.

### f. Supply Request Modal (`OrderFormModal`)
   - i. Fetches `supply_catalog` by `category` (Vegetables/Grocery/Stationery) and `is_active=true`.
   - ii. Search: prefix-match against catalog names. Custom items (no catalog match) allowed.
   - iii. Submit: inserts to `staff_order_requests` with `{ request_type, items: [{name, qty}], status: 'Pending', submitted_by }`.

---

## 5. Order Tracking & Status Flow

### a. Status Lifecycle
   - i. Full status set (enforced by `orders_status_allowed` DB CHECK constraint):
      `Pending → Confirmed/Paid → Preparing → Ready → Packed → Dispatched → [Received at Hub →] On the Way → Delivered | Cancelled | Failed`
   - ii. **Pending**: Razorpay order created, payment not yet confirmed.
   - iii. **Confirmed**: wallet payment (immediate) OR Razorpay confirmed via `confirm-order` Edge Function.
   - iv. **Paid**: set by `mark_order_paid` RPC via webhook (before kitchen picks up). Treated as cancellable.
   - v. **Preparing → Ready → Packed**: set by kitchen/packing staff.
   - vi. **Dispatched → [Received at Hub →] On the Way → Delivered**: set by delivery staff.
   - vii. **Cancelled**: set by `cancel-order` Edge Function.
   - viii. **Failed**: set by `mark_order_failed` RPC via webhook on `payment.failed` event.

### b. Customer Order Tracking (`OrderDetailScreen.tsx`)
   - i. `useOrderDetail(orderId)`: fetches single order from `orders` table.
   - ii. `useSupabaseQuery(['order_items', orderId])`: fetches associated items.
   - iii. Status timeline: `STATUS_FLOW` array `['Confirmed', 'Preparing', 'Ready', 'Packed', 'Dispatched', 'On the Way', 'Delivered']` rendered as visual progress.
   - iv. Cancellation button shown when `status ∈ {Pending, Confirmed, Paid, Preparing}`.
   - v. Cancel flow: calls `cancel-order` Edge Function. Response shows wallet refund amount and Razorpay refund note.

### c. `cancel-order` Edge Function
   - i. Fetches order — must belong to authenticated user.
   - ii. **Idempotency**: if already `'Cancelled'`, returns success with refund amounts without re-processing.
   - iii. **Status check**: only `{Pending, Confirmed, Paid, Preparing}` are cancellable. Others → 409.
   - iv. **Cancellation window guard**: `ageHours = (now - created_at) / 3600`. If `ageHours > store_config.cancellation_window_hours` → 409.
   - v. **Cycle cutoff guard**: using IST time via `Intl.DateTimeFormat`:
      - Same-day cycle: blocks if `dispatch_date === todayStr` and current time ≥ cutoff.
      - Cross-midnight cycle (`cutoff_time > delivery_start`): blocks if `dispatch_date === tomorrowStr` and current time ≥ cutoff.
   - vi. Sets `orders.status = 'Cancelled'`.
   - vii. **Wallet refund**: if `wallet_amount_used > 0`, calls `increment_wallet_balance` RPC. Razorpay portion noted in response (manual admin action).

### d. Realtime Updates (Staff View)
   - i. Supabase Realtime channel `'staff-orders-realtime'` subscribes to `postgres_changes` (all events) on `orders` table filtered by `dispatch_date=eq.${today}`.
   - ii. Any change → `queryClient.invalidateQueries({ queryKey: QUERY_KEYS.STAFF_ORDERS })` → FlatList auto-refreshes.

### e. Push Notifications per Status Change (`useStaffOrders.ts` / `send-push` Edge Function)
   - i. `STATUS_PUSH` map defines `title` and `body` templates for: `Preparing`, `Ready`, `Dispatched`, `On the Way`, `Received at Hub`, `Delivered`, `Cancelled`.
   - ii. After each online status update, `supabase.functions.invoke('send-push', ...)` called fire-and-forget with `user_ids: [customer_user_id]`.
   - iii. Push token registration: `usePushNotifications()` hook (called in `RootNavigator`) registers Expo push token to `push_notification_tokens` table on session start.

---

## 6. Admin & Profile Flow

### a. Wallet Recharge (`WalletScreen.tsx` / `wallet-topup` + `confirm-topup` Edge Functions)
   - i. Customer enters top-up amount.
   - ii. `useWalletTopup()` → calls `wallet-topup` Edge Function.
   - iii. **`wallet-topup` Edge Function**:
      - Rate limit: 5/user/60s.
      - Validates amount against `store_config.wallet_min_topup` (default 100) and `wallet_max_topup` (default 50000).
      - Creates Razorpay order.
      - Inserts `pending_wallet_topups { razorpay_order_id, user_id, amount, status: 'pending' }`.
      - Never credits wallet — only creates the pending record.
   - iv. Client opens Razorpay checkout.
   - v. On success: calls `confirm-topup` Edge Function.
   - vi. **`confirm-topup` Edge Function**:
      - Verifies ownership via `pending_wallet_topups.user_id === auth user id`.
      - Idempotency: if `status === 'completed'` → returns `{ status: 'already_credited' }`.
      - HMAC-SHA256 signature verification.
      - Calls `complete_wallet_topup` RPC (SECURITY DEFINER, idempotent via `status` guard) — credits `profiles.wallet_balance` atomically.
   - vii. Fallback: `verify-payment` webhook calls `complete_wallet_topup` RPC.
   - viii. Client calls `useRefreshWallet()` after checkout closes to invalidate balance cache.

### b. Address Management (`useAddresses.ts` / `AddAddressScreen.tsx`)
   - i. `useAddresses()`: fetches `customer_addresses` where `user_id = auth.uid()` and `is_active = true`, ordered by `is_default DESC`.
   - ii. `useAddAddress()`: inserts new row with `user_id`.
   - iii. `useSetDefaultAddress(id)`: clears `is_default=false` on all user addresses, then sets `is_default=true` on target.
   - iv. `useDeleteAddress(id)`: sets `is_active=false` (soft delete — row not removed).
   - v. In checkout: `selectedZoneId` derived from selected address's `zone_id` → fetches `delivery_zones.delivery_fee_override`.

### c. Admin Dashboard — System Config (`StoreConfigScreen.tsx` / `FeatureFlagsScreen.tsx`)
   - i. `useUpdateStoreConfig()`: `supabase.from('store_config').update(updates).eq('id', 1)` — single row config.
   - ii. `useUpdateFeatureFlag()`: `supabase.from('feature_flags').update({ flag_value }).eq('id', id)`.
   - iii. **Storm mode toggle**: writes `storm_mode_active` to either `store_config` or `feature_flags`. `place-order` Edge Function checks `feature_flags` first, then `store_config`; either `true` blocks orders.
   - iv. **Staff message**: `store_config.staff_message` field; read by StaffDashboard on mount.
   - v. **Feature flags** consumed by app (examples): `essentials_module_active`, `storm_mode_active`, `branch_management_active`, `hub_delivery_active`.

### d. Admin Dashboard — Reports
   - i. `useAdminStats()`, `useReports()`, `useHubReport()` hooks fetch aggregated data for revenue, orders, subscriptions, and per-hub summaries.
   - ii. `AdminOrdersScreen`: admin view of all orders (not filtered by user).
   - iii. `AdminSubscriptionsScreen`: all active subscriptions with cancel action.

### e. Referral System (`apply-referral` Edge Function)
   - i. `apply-referral` Edge Function called post-login (from `ReferralScreen` or deep link flow).
   - ii. Finds `profiles` row by `referral_code` (case-insensitive, trimmed).
   - iii. Guards: self-referral blocked; `referrals` table checked for existing referee entry (idempotency).
   - iv. Fetches `referral_settings` for credit amounts; checks `is_active`.
   - v. Inserts `referrals { referrer_id, referee_id, status: 'pending', reward_given: false }`.
   - vi. Updates `profiles.referred_by = referrer.id`.
   - vii. Credits referee signup wallet via `increment_wallet_balance` RPC.
   - viii. Credits referee loyalty points via `increment_loyalty_points` RPC.

---

## 7. Internal Expense & Supply Flow

### a. Staff Expense Claims (`StaffExpensesScreen.tsx` / `useExpenses.ts`)
   - i. Staff enters `category` (Grocery/Vegetable/Stationery/Fuel/Others), `description`, `amount`.
   - ii. `useSubmitExpense()` mutation:
      - **Online**: inserts `expense_claims { staff_id, category, description, amount, status: 'Pending' }`.
      - **Offline**: enqueues insert operation to `staffQueueStore`.
   - iii. `useMyExpenses()`: fetches own claims ordered by `created_at DESC`.

### b. Admin Expense Review (`ExpenseManagerScreen.tsx` / `useExpenseManager.ts`)
   - i. `useAllExpenseClaimsAdmin()`: fetches all `expense_claims` joined with `profiles(full_name, phone_number, employee_id)`. Branch-filtered when `branch_management_active` is on.
   - ii. `useReviewExpenseClaim({ claimId, status })`: updates `status = 'Approved' | 'Rejected'`; sets `approved_by = admin user id`.
   - iii. `useMarkClaimPaid(claimId)`: updates `status = 'Paid'`, sets `paid_at = now`. No automatic wallet credit — purely a status marker.

### c. Business Expenses (Admin-Logged) (`ExpenseManagerScreen.tsx`)
   - i. `useBusinessExpenses().add()`: inserts to `business_expenses { category, description, amount, expense_date, vendor, recorded_by, is_paid, paid_at, branch_id }`.
   - ii. `useBusinessExpenses().markPaid()`: sets `is_paid=true, paid_at=now`.
   - iii. Branch-filtered when `branch_management_active` is on.

### d. Supply Order Requests (Staff → Admin)
   - i. Staff opens `OrderFormModal` from StaffDashboard footer (Vegetables/Grocery/Stationery type).
   - ii. `supply_catalog` table queried by `category` and `is_active=true`.
   - iii. Staff builds line item list; custom items (not in catalog) allowed.
   - iv. Submit: inserts `staff_order_requests { request_type, items: JSON[{name, qty}], status: 'Pending', submitted_by }`.
   - v. Admin reviews via `AdminOrdersScreen` or `ResourceManagerScreen` (no dedicated approval hook found in current code).

---

## 8. Staff Onboarding Flow

### a. Admin: Onboard Employee (`OnboardEmployeeScreen.tsx` / `elevate-employee` Edge Function)
   - i. Admin fills form: `full_name`, `phone_number`, `designation`, `joining_date` (YYYY-MM-DD), `shift_timing`, `assigned_hub_id`, `monthly_salary`, `benefits`, `joining_bonus`, `branch_id`.
   - ii. Calls `elevate-employee` Edge Function with admin JWT.

### b. `elevate-employee` Edge Function
   - i. **Admin gate**: extracts user from JWT; fetches `profiles.role` via service-role client; rejects non-admins.
   - ii. **Phone normalization**: strips non-digits, takes last 10, formats as `+91XXXXXXXXXX` (e164) and `91XXXXXXXXXX` (stored).
   - iii. **Find or create auth user**:
      - Queries `auth.users` by phone (stored format without `+`).
      - If found: reuses existing `auth_user_id`.
      - If not found: `adminClient.auth.admin.createUser({ phone: e164, phone_confirm: true })`.
   - iv. **`elevate_to_staff` PostgreSQL RPC** (SECURITY DEFINER):
      - Guards against elevating an `admin` account.
      - Generates `employee_id`: `'1ST-' + YEAR + '-' + LPAD(nextval('employee_id_seq'), 3, '0')`.
      - Upserts `profiles` row: `role='staff'`, all staff fields. On conflict (existing profile): updates fields but preserves existing `employee_id`.
      - If `monthly_salary > 0`: inserts first `staff_salary` row for current month/year.
      - Returns `employee_id`.
   - v. Returns `{ success: true, employee_id, user_id }` to admin client.

### c. Post-Onboarding JWT
   - i. On staff member's next login, `custom_access_token_hook` reads `profiles.role = 'staff'` → injects `user_role='staff'` into JWT.
   - ii. `extractRole()` in `useAuth.ts` reads this claim → `RootNavigator` routes to `StaffNavigator`.
   - iii. `assigned_hub_id` and `branch_id` from `profiles` also injected into JWT → available in `session.assignedHubId` and `session.branchId`.

### d. Staff Profile & Attendance (post-onboard)
   - i. `useTodayAttendance()`: fetches `staff_attendance` for today's date and current staff_id.
   - ii. `useClockIn()`: requests GPS (`expo-location`), upserts `staff_attendance { staff_id, date, clock_in_time, clock_in_lat, clock_in_lng }`. Offline-aware.
   - iii. `useClockOut()`: updates `staff_attendance` with `clock_out_time` and coords. Offline-aware.
   - iv. `useRequestLeave()`: inserts `staff_leaves { staff_id, start_date, end_date, reason, status: 'Pending' }`.
   - v. Admin: `useReviewLeave()` → updates `status = 'Approved' | 'Rejected'`, sets `approved_by`.

---

## 9. Multi-Branch & Hub Management Flow

### a. Feature Flag Gate
   - i. `branch_management_active` flag in `feature_flags` table controls all branch filtering.
   - ii. `hub_delivery_active` flag controls hub-based delivery routing and staff hub filtering.
   - iii. Both flags are read via `useFeatureFlag(key)` hook which queries `feature_flags` table.

### b. Branch Filter Resolution (`useBranchFilter.ts`)
   - i. **JWT has `branch_id`** (branch-specific admin or staff): always filters by that branch. `isSuperAdmin = false`.
   - ii. **JWT has no `branch_id` AND role is `admin`** (super-admin): uses `branchStore.selectedBranchId` from Zustand store. `null` = show all branches. `isSuperAdmin = true`.
   - iii. **Flag off**: `isActive = false`, no filtering applied regardless of branch_id.
   - iv. Query key suffix: `bf.isActive ? bf.branchId ?? 'all' : 'off'` — ensures separate cache entries per branch context.

### c. JWT Branch Isolation
   - i. `custom_access_token_hook` reads `profiles.branch_id` and injects into JWT.
   - ii. `rls_policies.sql` defines `jwt_branch_id()` function: `SELECT NULLIF((auth.jwt() ->> 'branch_id'), '')::INTEGER`.
   - iii. RLS policies are defined but currently **DISABLED** in development (file comment: "DISABLED during development"). The `ENABLE ROW LEVEL SECURITY` lines are the production kill switch.
   - iv. When RLS is enabled: `is_staff_or_admin()` check uses `jwt_user_role()` which reads from JWT claims. `is_admin()` checks for both quoted and unquoted `'admin'` string.

### d. Hub Management (Admin)
   - i. `useDeliveryHubs()`: fetches all hubs, branch-filtered. Hub data includes `polygon_geojson`, `center_lat/lng`, `staff_user_id`.
   - ii. `useAddHub()`: inserts hub; inherits `branch_id` from branch filter if not explicitly provided.
   - iii. `useToggleHub({ id, is_active })`: enables/disables a hub.
   - iv. **Geographic assignment** (`useAssignHubAddresses(hub)`):
      - `get_addresses_for_hub_assignment` RPC returns candidate addresses (those not yet assigned or unzoned).
      - Client-side ray-casting: `pointInPolygon(lat, lng, hub.polygon_geojson)` tests each address.
      - `assign_hub_to_address_ids` RPC batch-updates matching addresses with `hub_id`.
   - v. **Hub impact check** (`useHubImpactAddresses(hubId)`): `get_hub_impact_addresses` RPC returns addresses that would lose coverage if the hub is disabled (those with `hub_id = hubId` and `zone_id IS NULL`).

### e. Hub-Based Order Routing
   - i. In `place-order` Edge Function: `delivery_method` and `hub_id` derived server-side from `customer_addresses.hub_id`. Client cannot override.
   - ii. `delivery_method = 'hub'` if `addressData.hub_id != null`; `'direct'` otherwise.
   - iii. Hub ID stored on `orders.hub_id` for downstream staff filtering.

### f. Hub Delivery Status Flow (Delivery Tab)
   - i. Hub orders follow an extended status chain: Dispatched → **Received at Hub** → On the Way → Delivered.
   - ii. `renderOrderRow`: detects `item.delivery_method === 'hub'` to show the extra "Received at Hub" step.
   - iii. Staff assigned to a hub (`session.assignedHubId != null` with `hub_delivery_active=true`) only see orders destined for their hub.

### g. Zone Management
   - i. `delivery_zones` table stores zone polygons and `delivery_fee_override`.
   - ii. Zones assigned to `customer_addresses.zone_id` at address-add time (or via admin).
   - iii. In checkout and `place-order`: zone-specific delivery fee overrides global `store_config.delivery_fee`.

### h. Branch Data (`useBranches.ts` / `branchStore.ts`)
   - i. `useBranches()` fetches `branches` table (all, public-readable per RLS).
   - ii. Super-admin selects active branch via `branchStore.selectedBranchId` (Zustand, persisted).
   - iii. Branch selector UI shown only when `isSuperAdmin = true`.
