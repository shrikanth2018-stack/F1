# 1stOne — Business Logic & Flows

> **Provenance.** Written **2026-05-22** from the source at commit `f618c60`. Every rule below is quoted from the code that enforces it — the edge functions in `supabase/functions/`, the SQL in `supabase/sql/`, and the hooks/screens in `src/`. File references are given so any claim can be checked. Plain-language summaries open each section; **“Under the hood”** blocks hold the exact mechanics.

---

## 1. The one principle behind everything: the server decides money

The phone is treated as untrusted. It may say *“I want these items delivered to this address, paid this way”* — but it never says what something costs, when it ships, or how much tax/fee applies. The server works all of that out, twice (once to show you, once to charge you), using the **same code path** both times so the two answers can’t disagree.

That shared code is `supabase/functions/_shared/orderBuild.ts` (`buildAuthoritativeOrder`), used by **both** `quote-order` (preview) and `place-order` (commit).

---

## 2. Pricing & the order builder

### 2.1 Prices include GST (the “T1” model)

The price you see on a menu item **is** the price you pay. Tax is not added on top — it is the slice already *inside* that price, carved out only for the invoice.

**Under the hood** (`orderBuild.ts`): `tax = gross × rate / (100 + rate)`, where `rate = store_config.tax_rate_percentage`. A cycle group’s total is therefore `items-gross + delivery_fee`; the tax figure is informational and never increases the total.

### 2.2 How a cart becomes priced groups

Given a flat cart (item ids + quantities + optional address), `buildAuthoritativeOrder`:

1. **Re-prices every item from the database** (ignores any price the phone sent). A missing/inactive item, or an item with no cycle, fails the build with a clear message.
2. **Groups items by delivery cycle.** Each cycle becomes its own group with its own dispatch date.
3. **Derives each group’s dispatch date** from server time + that cycle’s cutoff (see §3).
4. **Adds the delivery fee once**, on the **earliest-dispatching group**. Fee priority: **hub override → zone override → store default** (`store_config.delivery_fee`). With no address, the fee is left “pending — calculated at checkout”.
5. **Handles subscription plans** in the same cart: validates them, runs an overlap-conflict check (§5.3), and adds **one** “subscription purchase” group dispatched today (the revenue record).
6. **Runs storm-mode and serviceability checks** and returns flags for the checkout UI.
7. Returns a **drift tuple** — the grand total in integer paise plus a sorted list of `(cycle_id, dispatch_date, group_total_paise)` — which is the tamper-proof fingerprint of the quote.

### 2.3 The drift tripwire (why prices can’t be gamed or go stale)

When the app finally taps **Pay**, it echoes the exact quote tuple it last showed the customer. `place-order` re-derives a *fresh* quote and compares **integer-paise tuples**:

- **No drift →** proceed to payment.
- **Any drift** (a price changed, a cutoff passed and shifted a date, the fee changed) **→** the server returns **HTTP 409 `quote_changed`** with the fresh quote, touches **no money, no Razorpay order, no wallet**, and the app re-quotes and asks the customer to confirm the new total (`CheckoutScreen.tsx` handles this transparently).

**Under the hood:** `driftedFields()` in `_shared/dispatch.ts` does the exact comparison. Every 409 is logged with before/after. A missing `client_quote` returns **409 `quote_required`**.

---

## 3. Dispatch dates & delivery cycles (the “when”)

### 3.1 Cycles

A **delivery cycle** (`delivery_cycles`) is a meal window — typically Breakfast, Lunch, Snacks, Dinner. Each has:
- `cutoff_time` — order before this and you make today’s/this run’s batch.
- `delivery_start` — when delivery begins.
- `kitchen_push_time` — when the kitchen gets its prep summary (usually cutoff + ~5 min).
- `is_essentials` + `essentials_label` — whether the cycle also carries essentials, and the customer-facing label for them.

### 3.2 The A / B / C scenario rule (server-derived, IST)

**Plain-language:** order before the cutoff and it goes out on the cycle’s next run; miss the cutoff and it slides to the following run. For late-night cutoffs that deliver next morning, missing the cutoff pushes you a further day.

**Under the hood** (`_shared/dispatch.ts`, `getDispatchScenario`): everything is resolved through the explicit `Asia/Kolkata` zone (India has no DST).

| Cycle type | Condition | Scenario | Dispatch date |
|---|---|---|---|
| Same-day (`cutoff ≤ delivery_start`) | now **before** cutoff | **A** | **today** |
| Same-day | now **after** cutoff | **B** | **tomorrow** |
| Cross-midnight (`cutoff > delivery_start`, e.g. 22:30 cutoff for 07:30 delivery) | now **before** today’s cutoff | **B** | **tomorrow** |
| Cross-midnight | now **after** cutoff | **C** | **day after tomorrow** |

**Scenario C requires explicit consent.** If any cart item lands on “day after tomorrow”, checkout shows a *“Delivery in 2 days”* confirmation before placing the order (`CheckoutScreen.tsx`, `quote.has_scenario_c`).

The `cycle-dispatch` edge function exposes this same calculation read-only so the cart can badge each item **Today / Tomorrow / +2** using the identical rule.

---

## 4. Payments & the wallet

Two payment methods: **Wallet** (instant, in-app balance) and **Razorpay** (UPI / card / net-banking). On web, Razorpay is unavailable so checkout is **wallet-only**.

### 4.1 Placing & paying — the exact sequence (`place-order/index.ts`)

1. **Authenticate** the caller from the JWT.
2. **Rate-limit:** max **5 place-order calls per user per 60 seconds** → otherwise HTTP 429.
3. **Idempotency:** if the `Idempotency-Key` header matches a stored successful response, return that response (no second order). The key is consumed **only on success** — a 409/4xx never burns it, so the app can safely retry a drift.
4. **Build the authoritative order** (§2). Reject if storm mode is on (403) or the address is out of zone (400).
5. **Drift check** (§2.3) — *before any money moves*.
6. **Razorpay path:** create the Razorpay order first; status starts as **`Pending`**.
   **Wallet path:** debit atomically via `decrement_wallet_balance_if_sufficient` (fails fast with “Insufficient wallet balance” if short); status starts as **`Confirmed`**.
7. **Write all order rows + items** in one transaction (`place_order_atomic`) — one row per cycle, all sharing an `order_group_id`.
8. **If the write fails after a wallet debit**, the debit is **refunded automatically**; if that refund itself fails, the server logs a structured alert and returns a support reference to the customer.
9. **Tag** the wallet debit with the new order id; **create `user_subscriptions`** for any plans (active immediately if paid by wallet, pending if Razorpay).
10. If any subscription row fails to create on a paid order, **branch admins get a “Subscription not created” push** for manual reconciliation (the order still succeeds).
11. **Push** “Order Confirmed” for wallet orders (Razorpay confirmation pushes happen at payment time).

### 4.2 Confirming a Razorpay payment — two independent paths

- **Foreground path (`confirm-order`):** after the Razorpay sheet returns, the app calls `confirm-order`, which verifies the payment signature with the secret and marks the order paid. Retried twice by the app.
- **Webhook path (`verify-payment`):** Razorpay also calls the webhook directly. It **HMAC-verifies** the signature against `RAZORPAY_WEBHOOK_SECRET` (and refuses to run without the secret — otherwise anyone could flip orders to paid). One `razorpay_order_id` can map to an order **and** a top-up **and** subscriptions, so the webhook runs **all three branches** idempotently.

Because both paths are idempotent, a payment confirms exactly once whether the app calls back or not. `payment.failed` marks the order/top-up failed and notifies the customer; the subscription simply stays inactive.

> **Recovery:** if the app is killed mid-payment, the order stays `Pending`. The home screen shows a **Pending Payment banner** (`usePendingRazorpayOrder`) letting the customer view or cancel it.

### 4.3 The wallet ledger

**Plain-language:** the wallet is a running balance with a full transaction history. The app can show the balance and history but **can never write to the ledger** — every change goes through a database procedure so the math is always correct and auditable.

**Under the hood:** `wallet_transactions` is read-only to the app (RLS `wallet_tx_no_writes`). Credits/debits flow through `increment_wallet_balance` / `decrement_wallet_balance_if_sufficient`, which update `profiles.wallet_balance` and append a ledger row atomically. Each row carries a `reference_type` (`order`, `order_refund`, `order_failed`, `referral_signup`, `topup`, `loyalty_redemption`, …) and `reference_id`.

- **Top-up** (`wallet-topup`): validates against `store_config.min_wallet_topup` / `max_wallet_topup`, creates a Razorpay order; credited by `complete_wallet_topup` on confirmation.
- **Loyalty redemption** (`redeem_loyalty_points` RPC): **1 point = ₹1**, redeemed atomically into wallet credit (`LoyaltyPointsScreen`).

---

## 5. Subscriptions

### 5.1 What a subscription is

A prepaid plan (`subscription_plans`) bought once, delivering its `plan_items` every day for `duration_days`. **Paid in full upfront** at purchase — daily deliveries are *not* charged again.

### 5.2 Daily dispatch generation (`generate_daily_manifest`)

**Plain-language:** every day, for every active subscription, the system automatically creates that day’s delivery order — mirroring the plan’s items — and ticks the subscription one day forward. Skipped days and travel pauses don’t burn paid days; the plan simply runs longer until every paid meal is delivered.

**Under the hood** (`supabase/sql/generate_daily_manifest.sql`):
- For each active, non-paused subscription whose target day is within its run, it inserts **one order** (status `Confirmed`) with `order_items` mirrored from the plan’s `plan_items` JSON.
- **Dispatch orders carry zero money** (`total_amount`, `tax_amount`, `delivery_fee`, `wallet_amount_used` all `0`) — revenue was already booked at purchase, so revenue reports stay accurate without filtering (rule BF-19/BF-01).
- **Idempotent:** it skips any `(subscription, date)` that already has an order; safe to re-run.
- **End-of-life is driven by `days_consumed`, not the calendar** — pause/skip/cron-outage extend the effective end so every paid meal is delivered. The subscription auto-deactivates when `days_consumed + 1 ≥ duration_days`.
- **Per-subscription isolation:** one bad subscription is logged and skipped; it can’t abort the whole run for everyone (rule O3). Each run is recorded in `manifest_run_log`.
- A best-effort “Order Confirmed” push fires per generated order (failures never roll back the meal).

It’s triggered per-cycle by the kitchen-cutoff tick (§7), so a cycle’s subscription orders exist *before* its kitchen summary is built.

### 5.3 Conflict check at purchase

You can’t buy a plan that overlaps an active plan delivering the **same item** during the **same dates** — but a **queued** plan (starting after the current one ends) is allowed. Computed in `orderBuild.ts` against the customer’s active subscriptions; a clash returns HTTP 409 with a readable message.

### 5.4 Pause, skip, resume (customer self-service)

- **Pause / Resume** (`usePauseSubscription`): flips `user_subscriptions.is_paused`. Paused subscriptions are skipped by the daily generator.
- **Skip a day** (`useSkipDay`): inserts a row in `cancelled_subscription_days` for that date; the generator skips it. **Undo** (`useUndoSkip`) deletes the row.
- Both happen on `SubscriptionsScreen` with a calendar.

### 5.5 Cancellation (admin only, with proration)

Customers **cannot** self-cancel a subscription purchase through `cancel-order` (it refuses subscription-purchase orders — guard G7). An admin cancels via `admin_cancel_subscription_atomic`, which **deactivates the subscription and credits a prorated wallet refund in one transaction** (`AdminSubscriptionsScreen`, `useAdminCancelSubscription`). The proration uses the plan `price` and remaining days.

---

## 6. Order cancellation (one-off orders)

**Plain-language:** you can cancel a whole order (all its cycles at once) **within the cancellation window and before the first cycle’s kitchen cutoff**. Wallet money comes back instantly; online-paid money is refunded by the team.

**Under the hood** (`cancel-order/index.ts`):
- A customer “order” is the whole `order_group_id`; cancelling cancels every still-cancellable row.
- **Cancellable statuses:** `Pending`, `Confirmed`, `Paid`, `Preparing`.
- **Guard 1 — window:** the group’s earliest creation time must be within `store_config.cancellation_window_hours`.
- **Guard 2 — cutoff:** the **earliest** dispatch cycle’s cutoff must not have passed (once the kitchen has the first cycle, the order locks). Cross-midnight cutoffs are handled correctly.
- **Refund:** the **sum** of the cancelled rows’ `wallet_amount_used` is credited back via `increment_wallet_balance`; any Razorpay portion is reported as `razorpay_refund_due` (manual admin refund).
- **Idempotent:** an already-fully-cancelled group returns success with no second refund.
- **If the wallet refund fails** after the order is cancelled, branch admins get a `admin.wallet_refund_failed` push with a reconciliation reference (the cancel still succeeds).

---

## 7. Delivery, dispatch & the staff “active batch”

### 7.1 Two delivery methods

| Method | Set when | Who delivers | Status path |
|---|---|---|---|
| **direct** (door) | address falls in a **zone** (no hub) | the zone’s driver, full last-mile | Dispatched → On the Way → Delivered |
| **hub** | address falls under a **hub** | a driver hands off **at the hub**, then the **hub operator** does last-mile | Dispatched → Received at Hub → On the Way → Delivered |

Serviceability and method are decided server-side from the map pin (point-in-polygon against zones/hubs; `resolve_address_serviceability`).

### 7.2 The order status vocabulary (`src/utils/orderStatus.ts`)

Active progression (earliest → latest):
**`Pending` → `Confirmed` → `Preparing` → `Ready` → `Packed` → `Dispatched` → `Received at Hub` → `On the Way` → `Delivered`.**
Terminal/off-flow: **`Cancelled`, `Failed`.** (Stored as plain text — there is no database enum.)

### 7.3 Persona-gated advancement (`src/utils/deliveryStatus.ts`)

`nextDeliveryStatus(current, method, persona)` enforces who may move what:
- **driver, hub method:** only `Dispatched → Received at Hub` (then stops — the rest is the hub operator’s job).
- **hub_operator, hub method:** `Received at Hub → On the Way → Delivered`.
- **driver, direct method:** the full `Dispatched → On the Way → Delivered`.
- **admin:** full flow always (override).

### 7.4 The “active batch” — what staff actually see (`useStaffOrders`)

**Plain-language:** the kitchen/packing screens always show **exactly one cycle’s batch at a time** — the cycle that was most recently “released” by its kitchen-cutoff push. When the next cycle’s cutoff fires, the board flips to that cycle. The one exception: any **past-dated order that still wasn’t delivered** stays visible so a missed perishable can’t be hidden by the flip.

**Under the hood:** `useActiveStaffBatch` reads `get_active_staff_batch` (the latest `kitchen_push_log` cycle+date). `useStaffOrders` queries that cycle’s non-cancelled orders **plus** any `dispatch_date < today AND status NOT IN (Delivered, Cancelled, Failed)`. Hub operators are further filtered to their `assigned_hub_id`. Subscription-purchase rows (revenue records) are filtered out of operational screens by `isOperationalOrder`.

### 7.5 Kitchen prep aggregation (`get_kitchen_aggregate`)

The kitchen tab doesn’t list orders — it lists **ingredients to prepare**. The database breaks each ordered meal into its `menu_items.ingredients` components (`"Rice:200g;Sambar:100ml"`), multiplies by quantity, and aggregates by component + unit + status. A meal with no ingredient string falls back to the meal itself × quantity.

### 7.6 Bulk advance (`advance_orders_status`)

“Mark all Ready / Packed” advances every selected order in **one transaction** (instead of N calls). It skips terminal rows and no-ops. Only the **`Ready`** milestone fans a customer push out server-side; **`Packed` is intentionally silent** (anti-spam).

---

## 8. Serviceability & the delivery map

When a customer drops a map pin (`AddAddress` / onboarding), the server resolves it:
- `point_in_polygon` tests the pin against each zone/hub `polygon_geojson`.
- A match sets the address’s `zone_id` **or** `hub_id`, `branch_id`, and `is_serviceable`.
- **Out of zone:** the customer may still save the address (“Enter Anyway”), but **checkout is blocked** until they have a serviceable address — the home screen shows an out-of-zone nudge.
- Hubs can **extend coverage** (`extends_coverage`) so a hub serves a pocket outside the base zones.
- Admin tools (`assign_hub_to_address_ids`, `get_hub_impact_addresses`) let admins re-assign addresses when hubs change, and notify affected customers (`hub_impact_notified_at`).

---

## 9. Referrals & loyalty

### 9.1 Referrals (`apply-referral`, `referral_settings`)

A code is applied via deep link (`1stone://referral?code=XXX`, auto-applied after login in `RootNavigator`) or manual entry. On a valid, first-time, non-self code the server (idempotently):
- creates a `referrals` row (`status: pending`), links `profiles.referred_by`,
- credits the **referee** a signup wallet credit (`referee_signup_credit`, default ₹50) and optional points,
- leaves the **referrer**’s tiered rewards (`referrer_first_order_*`, `referrer_month_credit`) to be granted on the referee’s qualifying activity.

All tiers are admin-configurable on `ReferralSettingsScreen`; the program has an `is_active` master switch (default off until configured).

### 9.2 Loyalty points

Earned per rupee spent (`store_config.loyalty_points_per_rupee`), redeemable at **1 point = ₹1** into wallet credit via the atomic `redeem_loyalty_points` RPC (`LoyaltyPointsScreen`).

---

## 10. Notifications

### 10.1 Editable templates

Every push has a stable `event_key` and a row in `notification_templates` with an admin-editable title/body (`{{variable}}` placeholders) and an **on/off** switch. `resolveAndSendPush` (`_shared/notifications.ts`):
1. looks up the template; if **disabled**, sends nothing; if **missing**, uses the caller’s fallback copy,
2. substitutes variables,
3. dispatches **directly to Expo** using the caller’s service-role client (a deliberate choice — function-to-function calls proved fragile, 2026-05-16),
4. writes every attempt to `push_logs` and **deactivates dead tokens** Expo reports.

It runs as a background task (`EdgeRuntime.waitUntil`) so the response returns immediately.

### 10.2 When pushes fire (the event catalog, from code)

- **Order:** `order.confirmed` (wallet order / subscription dispatch), `order.razorpay_confirmed` (payment captured), `order.ready` (bulk Ready), `order.payment_failed`. **`Packed` is silent.**
- **Wallet/subscription:** `wallet.topped_up`, `subscription.activated`.
- **Staff:** kitchen cutoff summary (per cycle, to branch staff).
- **Admin alerts:** `admin.subscription_create_failed`, `admin.wallet_refund_failed`.
- **Lifecycle crons:** subscription-expiry, low-wallet, dormant win-back (§ Doc 4).

---

## 11. Scheduled jobs (cron) — the daily clockwork

Run inside Postgres via `pg_cron`, calling edge functions via `pg_net`. Config (URL + service key) is read from the `app_config` table.

| Job | Schedule | What it does |
|---|---|---|
| `kitchen-cutoff-push-tick` | **every minute** | For each cycle past its `kitchen_push_time` today (and not already pushed): generate that cycle’s subscription orders, then push the kitchen summary. Dedupes via `kitchen_push_log` (keyed to the **delivery** date, so cross-midnight cycles don’t re-fire). |
| `subscription-expiry-push` | 09:00 IST daily | Notify subscribers ending in 1–2 days. |
| `low-wallet-check` | 09:30 IST daily | Warn customers with a renewal in ≤2 days and wallet below `low_wallet_threshold`. |
| `dormant-user-check` | weekly (Mon) | Win-back push to customers inactive beyond `winback_inactive_days`. |
| idempotency-key cleanup | hourly | Purge old idempotency rows. |
| `cron-failure-alert` | hourly (:15) | Push branch admins if any cron job failed. |

> The old nightly “generate-daily-manifest safety net” was **unscheduled** (rule CL-02) — the per-minute cutoff tick handles dispatch reliably, making the nightly backup redundant. `get_job_health()` surfaces the live status of all jobs to admins (Doc 4 §4).

---

## 12. Storm mode (the kill switch)

`store_config.storm_mode_active` (and/or the `storm_mode_active` flag) pauses ordering business-wide. When on: the home screen shows a paused banner and hides the cart button; `quote-order`/`place-order` refuse new orders (403). Existing orders and subscriptions are unaffected.

---

*End of Doc 2. See Doc 3 for the screen-by-screen walkthrough and Doc 4 for the operations runbook.*
