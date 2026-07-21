# CLAUDE.md — 1stOne F1

Expo/React Native app + Supabase backend for a home-kitchen food & essentials delivery business (single region, IST). One binary serves customer, staff, driver/hub, and admin personas, routed by JWT claims. Full map: `docs/CODEBASE_MAP.md`; deep detail: `docs/03`–`06`.

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
- `src/hooks/` — all data access (React Query); `src/api/` — supabase client, `invokeFunction`, query helpers
- `src/store/` — Zustand: `cartStore` (food), `essentialsCartStore` (separate!), `staffQueueStore` (offline queue), `uiStore`, `branchStore`
- `src/utils/` — pure logic (dispatch, order status, IST dates, validators) — this is what the Jest suites cover
- `supabase/functions/` — edge functions; `_shared/orderBuild.ts` + `_shared/dispatch.ts` are the money/date brain
- `supabase/sql/` — idempotent SQL files, applied manually per `DEPLOY_SQL_ORDER.md` (no migration runner)
- `landing/` — static marketing site (1stone.in, Cloudflare Pages)

## Non-negotiable invariants
- **Server decides money/dates/prices.** The app sends item ids + quantities only. Never weaken the quote-drift (409 `quote_changed`), idempotency-key, or rate-limit logic in `place-order`.
- **Wallet ledger is never app-written** — all wallet movement via atomic RPCs (`increment_wallet_balance`, `decrement_wallet_balance_if_sufficient`).
- **RLS stays on**; role/money columns change only through SECURITY DEFINER RPCs or service-role functions.
- **Never disable the webhook HMAC check** in `verify-payment`.
- Prices are **GST-inclusive** (tax carved out, never added). All time logic is explicit `Asia/Kolkata`.
- `Packed` status is intentionally push-silent; only `Ready` notifies customers.

## Gotchas
- **`place-order` payload is not backward-compatible** — deploy the function and the app build together.
- **Live DB > repo `schema.sql`** — the snapshot lags; trust the live Supabase schema. Newer RPCs are called with `(supabase as any).rpc(...)` casts ("MF-08 pattern") until types are regenerated.
- `patches/react-native-razorpay+2.3.1.patch` must persist (`patch-package` postinstall).
- Web build has no Razorpay — web checkout/top-up is wallet-only; guard new payment UI accordingly.
- No CI service exists — the Husky pre-push hook is the only automated gate.
- `eas.json` production still carries the Razorpay **test** key; iOS submit fields are placeholders.
- No hardcoded business values or colors: business rules live in `store_config`/`feature_flags`, styling in `src/theme/`.
- Staff board shows one cycle's batch (latest `kitchen_push_log` row) + past undelivered orders — an "empty board" before the first push of the day is by design.
- Code comments carry audit tags (D#, G#, BF-#, MF-#, O#, FT-#) referencing past audit rounds — keep them when editing nearby code; match the existing header-comment style in every file.

## Working agreements (owner preferences)
- After making edits, **pause for owner review before** running tsc/jest or committing.
- During polish sessions, bank changes locally — one commit + OTA per slice, not per fix.
- Owner-facing flows must be tested by actually opening every screen (no symbolic testing); prefer AskUserQuestion options over free-text during device tests.
- Commit/push only when asked.
