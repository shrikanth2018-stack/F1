# 1stOne — Screen-by-Screen Specification

> **Provenance.** Written **2026-05-22** from the source at commit `f618c60`. Every screen below was read from `src/screens/` and `src/navigation/`; its purpose, sections, actions, and the server calls behind them are taken from the code. Each entry names the file so it can be verified. Counts: **2 auth**, **17 customer** (incl. driver/hub), **4 staff** + 3 staff sub-components, **28 admin** + 7 admin sub-components, **5 admin reports**.

**How to read an entry.** *Purpose* = what the screen is for · *Shows* = the main UI · *Actions* = what the user can do and what it triggers · *Data* = the key hooks/endpoints behind it.

---

## 0. Routing at a glance (`RootNavigator.tsx`)

On launch the app checks your session and reads your role from the login token, then mounts one of three navigators:

- **Not signed in →** `LoginScreen` (phone+OTP). New customers continue to `OnboardingScreen`.
- **customer (or driver-staff) →** `CustomerNavigator` (a stack, no bottom tabs).
- **staff (non-driver) →** `StaffNavigator`.
- **admin →** `AdminNavigator`.

There are **no bottom tab bars** anywhere — navigation is a header profile button, in-screen tabs, and stack pushes.

---

## 1. Authentication (`src/screens/auth/`)

### LoginScreen
- **Purpose.** The single sign-in surface — phone entry and OTP in one screen with an internal phase machine (BF-18).
- **Shows.** Admin-configurable login background image (`app_settings.login_bg_url`), a phone field, then an OTP field.
- **Actions.** Auto-sends the OTP once 10 valid digits are entered; auto-verifies once 6 OTP digits are entered. On verify, `profiles.full_name` decides the next step: existing user → role navigator; new user → `OnboardingScreen`.
- **Data.** `useAuth` (`signInWithPhone`, `verifyOTP`). Accepts an optional referral code carried in from a deep link.

### OnboardingScreen
- **Purpose.** One-screen setup for a brand-new customer after OTP.
- **Shows.** Full-name field; first delivery address (label + map pin/GPS + address fields).
- **Actions.** **Save** writes the profile and first address **atomically** in one transaction (`complete_onboarding_atomic`) — name lands in both `profiles.full_name` and the address’s `full_name`. Back = sign out (session is already live).
- **Data.** `useCompleteOnboarding`; serviceability flag gating depends on `branch_management_active`.

---

## 2. Customer (`src/screens/customer/`)

### HomeScreen
- **Purpose.** The storefront and hub of the customer app.
- **Shows.** A hero with the live promo banner (image or styled animated text, from `banners`); **Food | Essentials** segmented tabs (Essentials tab only when the module is enabled); each tab lists items **grouped by delivery cycle** with add/stepper rows and a Today/Tomorrow/+2 dispatch badge; a floating **Subscription Plans** button; a profile button (opens `ProfilePopup`); a cart floating button.
- **Conditional banners.** Storm-mode “deliveries paused”; **pending-payment** recovery banner (view/cancel a stuck Razorpay order); **wallet nudge** (“your wallet is ₹X short for <plan> renewal”); **out-of-zone** nudge (“add a valid address — checkout disabled”).
- **Actions.** Add/▲/▼ items into the food or essentials cart; open a cycle popup (cutoff/dispatch times); navigate to Cart, Plans, Wallet, Orders, AddAddress.
- **Data.** `useDeliveryCycles`, `useMenuItems`, `useEssentialsCatalog`, `useSmartCart`, `useLiveBanner`, `useWalletNudge`, `usePendingRazorpayOrder`, `useStoreConfig`.

### CartScreen
- **Purpose.** Review the cart before checkout.
- **Shows.** Food and Essentials in separate sections, each **grouped by delivery cycle** with the cycle’s dispatch day (mirrors Home). Live subtotal.
- **Actions.** Adjust quantities; proceed to **Checkout** (passes `cartType`).
- **Data.** `useCartStore`, `useEssentialsCartStore`, `useSmartCart`, `useSmartEssentialsCart`, `useOrderQuote`.

### CheckoutScreen
- **Purpose.** Place and pay for an order (or a subscription-only purchase). **Fully server-authoritative** (see Doc 2 §2).
- **Shows.** Address picker; order summary with dispatch badges; **server-derived price breakdown** (Subtotal / Delivery / Total / “Incl. GST …”); payment choice **Pay Online (Razorpay)** or **Wallet** (with shortfall + Top-Up link).
- **Actions.** **Pay** → calls `place-order` echoing the quote tuple + an idempotency key. Handles: drift 409 (re-quote + “review and pay again”), Scenario-C consent dialog, branch-switch cart clear (MF-09 — switching to an address in another branch clears the cart), Razorpay sheet + `confirm-order`, web wallet-only guard, app-backgrounded recovery. On success: clears the relevant cart, invalidates orders/wallet/profile/subscriptions, navigates home.
- **Data.** `useOrderQuote`, `useAddresses`, `useWalletBalance`, Razorpay, `place-order`/`confirm-order`.

### OrdersScreen
- **Purpose.** Order history.
- **Shows.** **Food | Essentials** tabs; infinite scroll (20/page). Each customer order is one `order_group_id` (may span cycles), shown with a rolled-up status.
- **Actions.** Tap → `OrderDetail`; empty state links to Plans.
- **Data.** `useMyOrders`.

### OrderDetailScreen
- **Purpose.** Full detail of one order group.
- **Shows.** **One schedule section per dispatch cycle**, each with its own status timeline; items; totals; address.
- **Actions.** **Cancel** (whole group, via `cancel-order` — window + cutoff guarded; see Doc 2 §6); after Delivered, **rate** → `Feedback`.
- **Data.** `useOrderGroup`, `useCancelOrder`, `useStoreConfig`, `useDeliveryCycles`.

### SubscriptionsScreen (“My Subscriptions”)
- **Purpose.** Manage purchased plans.
- **Shows.** **Food | Essentials** tabs; flat rows (plan name + pause toggle); a shared calendar dotted with scheduled deliveries.
- **Actions.** **Pause/Resume** (`is_paused`); tap a future date to **Skip** that day; **Undo** a skip; navigate to Plans.
- **Data.** `useMySubscriptions`, `usePauseSubscription`, `useSkipDay`, `useUndoSkip`, `useAllCancelledDays`.

### PlansScreen
- **Purpose.** Browse subscription plans (opened from Home’s Subscription Plans button).
- **Shows.** **Food | Essentials** tabs; plans grouped by cycle as text rows.
- **Actions.** Tap a plan → `PlanDetail`.
- **Data.** `useSubscriptionPlans`.

### PlanDetailScreen
- **Purpose.** A single plan’s detail and start-date selection.
- **Shows.** Header (name / “plan for” / duration / daily dispatch time / total cost); a calendar (earliest selectable = today if within cutoff, else tomorrow); included items labelled by cycle.
- **Actions.** Pick a start date and add the plan to the cart → `Cart` (which leads to subscription-only checkout).
- **Data.** `usePlanItems`, `useCycleDispatch`, `useSubscriptionPlans`, `useMySubscriptions`.

### WalletScreen (modal)
- **Purpose.** Wallet balance, top-up, and history.
- **Shows.** Balance → top-up input → quick-amount chips → **ADD** → transaction list.
- **Actions.** **ADD** → `wallet-topup` creates a Razorpay order; webhook/`confirm-topup` credits the balance. Validates against `min/max_wallet_topup`.
- **Data.** `useWalletBalance`, `useWalletTransactions`, `useWalletTopup`, `useStoreConfig`.

### LoyaltyPointsScreen (modal)
- **Purpose.** View and redeem loyalty points.
- **Shows.** Points balance + history.
- **Actions.** **Redeem** → `redeem_loyalty_points` RPC converts points to wallet credit at **1 point = ₹1**; wallet balance refreshes.
- **Data.** `useLoyaltyHistory`, `useWallet`, `useRefreshWallet`.

### ReferralScreen
- **Purpose.** The customer’s referral hub.
- **Shows.** Your referral code (generate/share), the reward tiers (from `referral_settings`), your referrals list, and a field to apply someone else’s code.
- **Actions.** Generate code; share; apply a code (`apply-referral`).
- **Data.** `useMyReferralCode`, `useGenerateReferralCode`, `useMyReferrals`, `useApplyReferralCode`, `useReferralSettings`.

### FeedbackScreen
- **Purpose.** Post-delivery rating.
- **Shows.** Per-item star rating **and** overall experience rating + comment.
- **Actions.** Submit → overall to `app_feedback`, per-item to `order_item_ratings`.
- **Data.** `useAuth`, direct Supabase mutation.

### AddAddressScreen
- **Purpose.** Add/edit/delete delivery addresses with a map pin.
- **Shows.** Interactive map (drag/tap to place the pin; “Use my location” GPS button); address fields; existing address list.
- **Actions.** Save (serviceability resolved server-side); set default (`set_default_address`); delete. Out-of-zone pins can still be saved (“Enter Anyway”) but block checkout.
- **Data.** `useAddAddress`, `useUpdateAddress`, `useDeleteAddress`, `useSetDefaultAddress`, `useAddresses`.

### EditProfileScreen
- **Purpose.** Everything a customer can change about themselves.
- **Shows.** Full name (inline edit); login phone (OTP-verified change); addresses link; wallet summary.
- **Actions.** Save name; change phone (`startPhoneChange` → `verifyPhoneChange`, mirrored to `profiles.phone_number`); go to AddAddress.
- **Data.** `useAuth`, `useAddresses`, `useWalletBalance`.

### ProfilePopup (component, opened from Home)
- **Purpose.** The customer “menu”.
- **Shows / Actions.** Links to Orders, Wallet, Loyalty, Referral, Edit Profile, Feedback, plus role-aware extras: **“My Deliveries”** for driver-staff (→ DriverDashboard) and **hub dashboard** for customers with `assigned_hub_id`. Sign out.

### Driver & hub screens (customer-role flavours)

#### DriverDashboardScreen
- **Purpose.** Today’s deliveries for a driver (identified by `driver_user_id` on a hub/zone).
- **Shows.** The active batch’s deliverable orders for this driver, with call/map/address actions and the admin’s note for the Delivery group.
- **Actions.** Advance status per the driver persona rules (Doc 2 §7.3).
- **Data.** `useStaffOrders`, `useUpdateOrderStatus`, `useActiveStaffBatch`, `useStaffNoteForTab`.

#### HubDashboardScreen
- **Purpose.** A hub operator’s console (customer-role user with `assigned_hub_id`).
- **Shows.** **Active** tab (orders received at this hub, last-mile) + **History** tab; the admin’s note for the Hub group.
- **Actions.** Advance `Received at Hub → On the Way → Delivered`; open a past order in `HubOrderHistoryDetail`.
- **Data.** `useStaffOrders` (hub-filtered), `useHubOrderHistory`, `useUpdateOrderStatus`.

#### HubOrderHistoryDetailScreen
- **Purpose.** Read-only look at one past hub order (no actions).

---

## 3. Staff (`src/screens/staff/`)

### StaffDashboard
- **Purpose.** The staff operations console.
- **Shows.** Header (logo + profile circle); **Kitchen | Packing | Delivery** in-screen tabs; an admin message bar (note for the active tab).
  - **Kitchen tab:** the ingredient prep aggregation for the active batch (`get_kitchen_aggregate`) — components × quantities by status.
  - **Packing tab:** orders to pack.
  - **Delivery tab:** orders to dispatch/deliver (driver persona).
- **Actions.** Advance individual orders (`useUpdateOrderStatus`); **Mark all Ready/Packed** in bulk (`advance_orders_status` — only Ready notifies customers); open the profile popup; raise a supply order.
- **Data.** `useStaffOrders`, `useKitchenAggregate`, `useBulkAdvanceStatus`, `useRealtimeOrders`, `useAdminNotes`, `useOfflineSync`.

### StaffAttendanceScreen
- **Purpose.** Clock-in/out, leave, and attendance history.
- **Shows.** Today’s status, history, a leave date-range picker.
- **Actions.** **Clock in / out** (with GPS); **request leave**; submit an **attendance-correction** request for past days (`CorrectionRequestModal` — admin derives clock times from the staff’s shift, see Doc 4).
- **Data.** `useClockIn/useClockOut`, `useRequestLeave`, `useAttendanceHistory`, `useAttendanceCorrections`.

### StaffExpensesScreen
- **Purpose.** Submit and track reimbursement claims.
- **Actions.** Submit a claim (category, amount, description) → `expense_claims`; view status (pending/approved/paid).
- **Data.** `useSubmitExpense`, `useMyExpenses`.

### StaffProfileScreen
- **Purpose.** The staff member’s own identity + pay summary.
- **Shows.** Employee id, designation, shift, joining date; current-month salary (if a record exists); links to Attendance and Expenses; sign out.

### Staff sub-components
- **OrderFormModal** — type-to-search supply order (Vegetables/Grocery/Stationery) raised to admin; mirrors into the procurement list.
- **CorrectionRequestModal** — multi-day calendar batch for attendance correction (no per-day time editor).
- **ProfilePopup** — header dropdown: name + Attendance / Expense Claim / My Profile / Sign Out.

---

## 4. Admin (`src/screens/admin/`)

### AdminHome
- **Purpose.** The admin landing — a unified **Reports | Manage** two-tab page.
- **Shows.** Logo + Sign Out; a branch filter (super-admin); live order stats (`useAdminStats`, `useRealtimeOrders`); rows that deep-link into every admin screen.
- **Manage rows route to:** Orders, Subscriptions, Menu, Plans, Essentials Catalog, Delivery, Resource (Staff), Notifications, Push, Referral Settings, Customer Feedback, Expense Manager, Stock Manager, Store/Operations Config, and (super-admin) Branches & Customer Export.

### Operations & orders

#### AdminOrdersScreen (“Manage Running Orders”)
- Lists orders for a chosen date — order # · zone/hub label · status pill. Tap → `AdminOrderDetail`. *(Data: `useOrdersForDate`.)*

#### AdminOrderDetailScreen
- The canonical admin surface for one order: full context + **cancel** (`admin_cancel_order_atomic`) and **advance status** (admin = full flow). *(Data: `useAdminOrderDetail`, `useAdminCancelOrder`, `useUpdateOrderStatus`.)*

#### AdminSubscriptionsScreen
- Lists active subscriptions (paused included). **Cancel with prorated wallet refund** (`admin_cancel_subscription_atomic`). *(Data: `useAdminSubscriptions`, `useAdminCancelSubscription`, `useWalletRefund`.)*

### Catalog management

#### MenuManageScreen
- Menus per cycle (toggle cycles through Breakfast→Lunch→…); each row: name · tap-to-edit price · enable/disable. Footer → CreateMenu / ImportItems. *(`useToggleMenuItem`, `useUpdateMenuItem`.)*

#### CreateMenuScreen
- Define a named menu for a cycle with sub-items (each a kitchen prep task with a quantity). *(`useAddMenuItem`.)*

#### EssentialsCatalogManageScreen
- Essentials per cycle (shown as Morning/Noon/Evening). Toggle + inline price edit. → CreateEssential / ImportItems. *(`useToggleEssential`, `useUpdateEssentialPrice`.)*

#### CreateEssentialScreen
- Add an essential item linked to a cycle, with a friendly time label. *(`useAddEssential`.)*

#### PlansManageScreen
- **Food | Essentials** tabs; per cycle, plans with price edit + enable/disable. → CreatePlan / ImportItems. *(`useTogglePlan`, `useUpdatePlanPrice`.)*

#### CreatePlanScreen
- Build a plan: name + cycle + item picker (menu items for Food, essentials for Essentials) + per-item quantity + number of days. `plan_type` from route. *(`useAddPlan`.)*

#### ImportItemsScreen
- Shared CSV importer for Menu / Essentials / Plans: download a template, fill it, upload, preview, commit. (CSV is RFC-4180; works on web — see Doc 4.)

### Delivery network

#### DeliveryManagerScreen
- **3 tabs: Cycles | Zones & Fees | Hubs.**
  - *Cycles* — each cycle card: name, active toggle, three editable times (cutoff / kitchen push / dispatch), essentials toggle + label. (`CycleCard`, `AddCycleModal`.)
  - *Zones & Fees* — draw zone polygons on a map, assign a driver, set a fee override and optional hub. (`ZoneEditorModal`.)
  - *Hubs* — list hubs; toggle; open `HubDetail`.
- *(Data: `useAllDeliveryCycles`, `useDeliveryZones`, `useDeliveryHubs`, add/update/delete zone/cycle/hub.)*

#### HubDetailScreen
- Create/edit a hub: identity, coverage polygon, **assign a hub operator** (`assign_hub_operator`), **assign addresses to the hub** (`assign_hub_to_address_ids`), fee override, commission %. *(`useAddHub`, `useUpdateHub`, `useAssignHubOperator`, `useAssignHubAddresses`.)*

### Staff / HR (“Resource Manager”)

#### ResourceManagerScreen
- Roster of all staff with today’s attendance; filter All/Present/Absent/On Leave; stat bar. Surfaces **pending leave approvals** and **pending attendance-correction** requests (approve/reject). → EmployeeDetail / OnboardEmployee. *(`useStaffRoster`, `usePendingLeaves`, `useAdminAttendanceCorrections`, approve/reject hooks.)*

#### EmployeeDetailScreen — 4 tabs
- **Profile** (`ProfileTab`) — view/inline-edit info; **offboard** at the bottom (`useDemoteEmployee`, `useUpdateEmployee`).
- **Attendance** (`AttendanceTab`) — month calendar (P/A/L) + clock log.
- **Leave** (`LeaveTab`) — approve/reject pending + history.
- **Salary** (`SalaryTab`) — monthly cards, mark-paid, add a record.

#### OnboardEmployeeScreen
- Create a staff profile (designation, branch, shift, salary, benefits); the person logs in by phone OTP and is matched by `phone_number`. *(`useOnboardEmployee`; behind it the `elevate-employee` edge function / `elevate_to_staff` RPC.)*

### Finance

#### ExpenseManagerScreen — 2 tabs
- **Claims** — staff-submitted claims: review (approve/reject) + mark paid. **Business Expenses** — admin-recorded expenses (vendor, category, amount, paid status). *(`useAllExpenseClaimsAdmin`, `useReviewExpenseClaim`, `useMarkClaimPaid`, `useBusinessExpenses`.)*

#### StockManagerScreen — 2 tabs (supply chain)
- **Current Order** — the unified procurement list; staff supply submissions auto-mirror in; admin adds/edits/removes items. **Batches/History** — freeze + **print** a batch (`usePrintBatch`, `supply_batches`). *(`useStockManager`, `useActiveOrderList`, `useSupplyCatalog`, `useSupplyBatches`.)*

### Marketing & messaging

#### NotificationManagerScreen
- Edit push **copy and on/off** per `event_key` (title/body with variables). Save per row. *(`useNotificationTemplates`, `useUpdateNotificationTemplate`.)*

#### NoteToStaffScreen (route “PushNotifications”)
- Compose a note per staff group (All / Kitchen / Packing / Delivery / Hub), each with an enable toggle. Active notes appear as the in-app message bar on staff screens. *(`useAdminNotes`, `useUpsertNote`.)*

#### SpecialOfferBannerScreen (route “CustomerPush”) — 2 tabs
- **Upload Image** — pick a banner image (replaces the storage asset + upserts a live image banner). **Text banner** — compose a styled/animated text banner. Drives HomeScreen’s hero. *(`useUpsertBanner`, `useLiveBanner`.)*

#### LoginBgScreen
- Two uploaders: **Login Background** (9:16 portrait, mobile login) and **Landing Page Banner** (16:9, the 1stone.in hero — writes `app_settings.landing_hero_url`).

#### ReferralSettingsScreen
- Configure every referral tier + master on/off; view the live referrals table; issue a month bonus. *(`useReferralSettings`, `useUpdateReferralSettings`, `useAllReferrals`, `useIssueMonthBonus`.)*

#### CustomerFeedbackScreen — 2 tabs
- **Feedback** (overall, from Profile) | **Reviews** (per-item, from My Orders). Each entry shows name, phone, stars, comment, date. **Respond ›** opens WhatsApp to that customer. *(`useAllFeedback`, `useOrderItemRatings`.)*

### Configuration & system

#### StoreConfigScreen (“Operations Manager”)
- Flat editor for `store_config`: tax %, delivery fee, wallet min/max, low-wallet threshold, loyalty rate, cancellation window, winback days, WhatsApp support number, and **Storm Mode** (red, ⚠). Header links to FeatureFlags, JobHealth, Branches, CustomerExport. *(`useStoreConfig`, `useUpdateStoreConfig`, `useDispatchBackfill`.)*

#### FeatureFlagsScreen
- Toggle each feature flag with its description (`branch_management_active`, `essentials_module_active`, `hub_delivery_active`, `storm_mode_active`). *(`useFeatureFlags`, `useUpdateFeatureFlag`.)*

#### JobHealthScreen (“System Health”)
- Read-only observability: every cron job’s last run/status/24h failures, recent dispatch manifest runs, and 24h push outcomes (`get_job_health`).

### Super-admin only

#### BranchesManageScreen
- CRUD over `branches` (gated on `is_super_admin` both server-side and at the entrance). *(`useCreateBranch`, `useUpdateBranch`, `useToggleBranchActive`.)*

#### CustomerExportScreen
- Filter customers by branch/hub/zone/status, choose columns, **download CSV** (RFC-4180, opens in Excel/Sheets). *(`useCustomerExport`.)*

### Admin Reports (`src/screens/admin/reports/`)

All five aggregate **server-side** (`reports` edge function / `useReports`), with a period picker, and a footer **Print | Download PDF**.

| Screen | Period | Content |
|---|---|---|
| **OrderReportScreen** | Weekly/Monthly/Quarterly | Day-level rows; **Cycle-wise** or **Menu-wise** view. |
| **RevenueReportScreen** | Weekly/Monthly/Quarterly | Date · Orders · Revenue · Incl. GST. |
| **SubscriptionReportScreen** | — | Active/paused/cancelled counts + plan-wise breakdown. |
| **StaffReportScreen** | Weekly/Monthly/Quarterly | Name · Days Present · Total Hours. |
| **HubReportScreen** | Today/Weekly/Monthly/Quarterly | Per-hub order counts by stage + revenue contribution + completion rate. |

---

*End of Doc 3. See Doc 4 for the operations & maintenance runbook.*
