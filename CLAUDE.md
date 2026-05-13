# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start development server
npx expo start

# Run on specific platform
npx expo run:ios
npx expo run:android
npx expo start --web

# Lint
npm run lint
```

Tests use Jest (jest-expo preset) with 18 test files in `src/__tests__/`. 300 tests across the suite; hook tests use `@testing-library/react-native`'s `renderHook` (added 2026-05-11 with `--legacy-peer-deps` for a strict react-test-renderer peer pin). Run via `npm test`; full pre-push gate is `npm run check` (tsc + jest).

## Environment Variables

Required in `.env`:
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_RAZORPAY_KEY_ID`

## Architecture Overview

This is an Expo React Native app with three distinct user roles — **customer**, **staff**, and **admin** — each with a dedicated navigator and screen set.

### Auth & Role Routing

Auth is phone-based OTP via Supabase. The user's role is extracted from a JWT custom claim (no extra DB query). `useAuth` in `src/hooks/useAuth.ts` holds the session in React Context; `RootNavigator` branches into `CustomerNavigator`, `StaffNavigator`, or `AdminNavigator` based on the role. The splash screen is held until the auth check completes to prevent a flash.

### State Architecture (Three Layers)

1. **Server state — TanStack React Query** via `src/api/useSupabaseQuery.ts`: All Supabase reads/writes go through `useSupabaseQuery` / `useSupabaseMutation`. No screen should write its own try-catch for Supabase calls.
2. **Client state — Zustand** in `src/store/`: Cart (`cartStore`, `essentialsCartStore`), ephemeral UI (`uiStore`), and an offline mutation queue for staff ops (`staffQueueStore`). All stores are persisted to AsyncStorage.
3. **Session — React Context** from `useAuth`.

### Hook Pattern

Business logic lives in 41 domain-specific hooks in `src/hooks/`, not in components. Each domain (orders, subscriptions, attendance, wallet, etc.) has its own hook file that composes `useSupabaseQuery`/`useSupabaseMutation` with Zustand stores and local business logic.

### Offline-First for Staff

Staff operations (attendance, deliveries) are queued locally in `staffQueueStore` and flushed when connectivity returns via `useOfflineSync`. This is critical — staff frequently operate in poor-connectivity environments.

### Navigation Structure

- `CustomerNavigator` — Stack only, 18 screens
- `StaffNavigator` — Stack only, 5 screens; `StaffDashboard` has top tabs (Kitchen/Packing/Delivery)
- `AdminNavigator` — Bottom tabs (Reports + Settings Hub), each tab has its own drill-down stack

### Theme / Styling

All styling references `Theme` from `src/theme/index.ts`. No hardcoded hex codes, font sizes, or spacing values anywhere in the codebase. The theme covers colors (with dedicated meal-type calendar colors), typography (Tahoma), spacing, and component tokens.

### Path Aliases

`@/*` maps to `src/*` (configured in `tsconfig.json`). Use `@/hooks/useAuth` not `../../hooks/useAuth`.

### Key Integrations

- **Supabase** (`src/api/supabaseClient.ts`) — auth, database, real-time subscriptions
- **Razorpay** — payment processing for orders/wallet top-ups
- **Expo Location + Notifications** — used for attendance (geofencing) and push alerts
- **Feature flags** — checked via `useFeatureFlag()` against `store_config` table; e.g. `essentials_module_active`

---

## Operational architecture notes

> Durable architectural truths captured during planning. Treat as binding context. Working rules — D-06 / D-07 / D-08, change-request format, etc. — live in `docs/RULES.md`. For current state see `docs/STATUS.md`. For history see `docs/HISTORY.md`.

### Three carts, not one bundled cart (AC-01)
Customers have three separate carts in the UI — food, essentials, and subscriptions — each with its own checkout. All three accept the same two payment methods (wallet, Razorpay). Implementation: separate `cartStore` and `essentialsCartStore`; subscription plan-buy flow goes through `place-order` independently with a one-plan-in-cart invariant.

### Subscription activation gap — resolved (AC-02)
A previous production bug had Razorpay-paid subscriptions where payment succeeded, order showed Confirmed, but `user_subscriptions.is_active` stayed `false` — customer's "My Subscriptions" page showed "payment awaited." The current `confirm-order` function explicitly activates `user_subscriptions` rows tied to the same `razorpay_order_id` immediately after marking the order Confirmed. Useful regression context for any future change to the payment-confirmation flow.

### Three-surface architecture
Mobile app (primary, Expo), `1stone.in` static landing page (Cloudflare Pages), `app.1stone.in` web app via React Native Web. Web build deliberately blocks Razorpay flows ("Mobile App Required" message) — by design.

### Server-side authority for money
Prices, delivery method, delivery fee derived server-side; client cannot tamper. Wallet atomicity via single SQL call ("if balance ≥ X, deduct X" atomically). Idempotency keys required on all payment endpoints; same table doubles as a 5/60s rate limiter.

### Branch filtering
Via JWT `branch_id` claim + RLS policies. Today the app runs single-branch (`feature_flags.branch_management_active = false`); multi-branch readiness is the D-08 launch gate.

### Subscription billing model (D-01)
Customer pays the full plan price upfront from wallet (or Razorpay), no daily debits afterward. Plan price is all-inclusive (food + tax + delivery). Pause/skip on subscriptions extends duration — paid meals eventually all get delivered.

End-of-life is driven by `days_consumed`, not the calendar window from `start_date` (BF-33 / F2.1, 2026-05-11). `generate_daily_manifest` only stops when `days_consumed >= duration_days`. The earlier calendar-window guard was removed; subscription-expiry-push and low-wallet-check were updated in lockstep. Customer-facing UI labels subscription end as "N meals left", not a fixed date.

### Cancellation refund policies

**One-off order cancellation:**
- Customer-initiated within configured time window via app (`cancel-order` Edge Function), or admin override.
- Wallet portion refunded automatically (`increment_wallet_balance` RPC).
- Razorpay portion: customer informed via response payload; manual admin action through Razorpay dashboard.

**Subscription cancellation (admin-initiated):**
- Refund always goes to wallet, regardless of original payment method.
- Prorated refund: `(remaining_days / total_days) × plan_price`, including tax + delivery slice (per BF-21).
- Admin can edit the amount before confirm (goodwill, dispute, etc.).
- Atomic via `admin_cancel_subscription_atomic` RPC (per BF-20).

### Notifications
Templates are admin-editable per `event_key` with `{{variable}}` substitution. Missing template falls back to hardcoded default. All order-status pushes single-sourced via `resolveAndSendPush` helper (BF-35, 2026-05-11) — the old `trg_order_status_push` DB trigger was dropped because it duplicated app-code pushes with hardcoded copy that bypassed admin's template overrides. Sub-generated daily dispatch pushes now fire from `generate_daily_manifest` via `pg_net`. Cancel pushes intentionally skipped — customer is on-screen with an alert.

### Storm mode
Dual-control kill switch (`store_config` column + `feature_flags` row, either true → orders rejected).

### Realtime auth attach (centralized)
`supabase.realtime.setAuth(token)` is called from exactly one place — `useAuth`'s `onAuthStateChange` listener, plus the initial `getSession()` path on app boot. Never replicate this per-subscriber. Without a current JWT attached to the Realtime client, any channel subscribed shortly after sign-in joins as anon, RLS rejects it, and supabase-js auto-reconnects into a tight CLOSED/subscribe loop (visible as a sign-out stall of several seconds as the loop drains, plus zero events delivered). New code that calls `supabase.channel(...).subscribe()` should just subscribe — the auth attach is already handled upstream.

### Hermes Date-parsing trap
Do not write `new Date(d.toLocaleString('en-US', { timeZone: ... }))` anywhere in the RN bundle. Hermes returns Invalid Date for the locale string format, so any downstream `.getTime()` is NaN, which silently propagates into `setTimeout(fn, NaN)` → coerced to 0 → immediate fire → infinite loop if the callback re-schedules itself. For timezone-aware date math use UTC arithmetic and `Date.UTC(...)`, or `Intl.DateTimeFormat('en-CA', { timeZone })` purely as a `YYYY-MM-DD` formatter (never a parse source).

### Known production-only objects (MF-08)
The following live only on production, not in tracked `supabase/sql/`:

- Tables: `supply_catalog`, `staff_order_requests`, `supply_order_items`, `supply_batches`.
- Trigger functions: `handle_new_user`, `on_auth_user_created`, `handle_first_order_referral_bonus`, `trg_first_order_referral_bonus`.

A fresh DB rebuild from `supabase/sql/` would NOT produce these. Captured as MF-08 in `docs/DECISIONS.md`. When designing a fix that touches these objects, read the production `pg_get_functiondef` output before writing migrations.
