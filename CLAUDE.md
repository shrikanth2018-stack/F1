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

Tests use Jest (jest-expo preset) with 9 test files in `src/__tests__/`.

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
