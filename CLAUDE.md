# CLAUDE.md — 1stOne F1

Expo/React Native app + Supabase backend for a home-kitchen food and essentials
delivery business. Single region, IST. One binary serves customer, staff,
driver, hub-operator, vendor and admin, routed by JWT claims plus table lookups.

Full detail lives in `docs/1`–`docs/5`. This file is the orientation.

## Stack

Expo SDK 54 · RN 0.81.5 · React 19.1 · TypeScript 5.9 · Hermes ·
React Navigation 7 · TanStack Query 5 · Zustand 5 · Supabase (PostgreSQL 17.6,
RLS, 17 edge functions, pg_cron) · Razorpay · Expo Push · Sentry · PostHog ·
Node 22.

## Commands

- `npm run check` — `tsc --noEmit && jest`. Runs in `.husky/pre-push` AND in
  `.github/workflows/check.yml`. Same command in both on purpose.
- `npm test` · `npm run lint` · `npm start` · `npm run android|ios|web`
- `npm run supabase:gen-types` — after any schema change
- `npm run schema:rehearse <file.sql>` — **before** applying SQL: builds a
  throwaway DB from the snapshot, applies the file twice, proves it is valid
  and idempotent, shows what it changes. Empty database, so it does not test
  data — still dry-run against production inside `BEGIN … ROLLBACK`.
- `npm run schema:snapshot` — **after applying any SQL to production**, then
  commit `supabase/schema/`. `npm run schema:check` fails if live and repo
  disagree. All three need Docker running.
- `supabase functions deploy <name> --no-verify-jwt`
- `eas update --channel production` — JS-only changes

## Layout

- `src/screens/{auth,customer,staff,admin}` — 89 screens by persona
- `src/navigation/` — `RootNavigator` switches on the JWT role
- `src/hooks/` — **all** data access (60 hooks); `src/api/` — supabase client,
  `invokeFunction`, query primitives
- `src/store/` — `cartStore` (ONE cart: food, essentials and plans together,
  keyed on `(item_id, item_type)`), `staffQueueStore` (offline queue),
  `uiStore`, `branchStore`
- `src/utils/` — pure logic; this is what the Jest suites cover
- `supabase/functions/` — `_shared/orderBuild.ts` + `_shared/dispatch.ts` are
  the money and date brain
- `supabase/sql/` — 141 idempotent files, applied by hand per
  `DEPLOY_SQL_ORDER.md`. **No migration runner.** These are the CHANGELOG, not
  the schema — twenty-five functions are defined in two to four files each and
  the last one applied silently wins.
- `supabase/schema/` — **what is actually deployed.** `live_schema.sql` is a
  `pg_dump` of production; `live_jobs.txt` holds the cron jobs and extensions
  the dump excludes. Generated, never hand-edited. This is the file to read to
  answer "what does the database look like?"
- `landing/` — static marketing site (Cloudflare Pages)

## Architecture

The phone sends **intent** (item ids + quantities + address + payment method).
The server derives delivery cycles, dispatch dates, prices, tax and fees.
`_shared/orderBuild.ts → buildAuthoritativeOrder` is the single derivation used
by `quote-order`, `place-order` **and** `admin-place-order`, so a quoted price
and a charged price cannot diverge.

`RootNavigator`: `admin` → AdminNavigator; `staff` && !isDriver →
StaffNavigator; everything else — including driver-staff — → CustomerNavigator.
Driver-staff keeps `role='staff'` so RLS still grants order read/write.

`useAuth.extractRole` base64-decodes the JWT client-side. Claims:
`user_role`, `branch_id`, `assigned_hub_id`, `is_super_admin`, `is_driver`.
**Vendor is NOT a claim** — `useMyVendor` reads the `vendors` table. Same for
the hub operator's `assigned_hub_id` on the profile.

TanStack Query for server state (2-min stale, retry 2). Zustand for device
state only. All async work is server-side: a per-minute `pg_cron` tick releases
the kitchen batch and creates subscription orders; pushes fan out via
`EdgeRuntime.waitUntil`.

## Hard invariants

- **Server decides money, prices and dates.** Never weaken the quote-drift 409,
  the idempotency key, or the rate limit in `place-order`.
- **The wallet ledger is never app-written** — only
  `increment_wallet_balance` / `decrement_wallet_balance_if_sufficient`.
- **RLS stays on.** Role and money columns move only through SECURITY DEFINER
  RPCs. The real gate is GRANT first, then policy — a client cannot write
  `order_items` at all, can only set `orders.status`, only
  `user_subscriptions.is_paused`, and only name + phone on `profiles`.
- **Never disable the webhook HMAC check** in `verify-payment`.
- Prices are **GST-inclusive** — tax is carved out, never added.
- All time logic is explicit `Asia/Kolkata`. **Never format a business date with
  `toISOString()`** — between 00:00 and 05:30 IST it gives yesterday. Use
  `src/utils/istDate.ts`.
- `Packed` is push-silent. Customer pushes fire only at Ready, Dispatched,
  Received at Hub, Delivered, Cancelled.
- Vendor credit is a **trigger** on `orders.status = 'Delivered'`, not a code
  path. Leave it there — four different routes reach Delivered.
- No hardcoded business values or colours: rules in `store_config` /
  `feature_flags`, styling in `src/theme/`.

## Gotchas

- **`place-order`'s payload is not backward-compatible** — deploy the function
  and the app build together.
- **`eas update` never ships `supabase/functions/`.** Diff before releasing:
  `git diff --name-only <last-sha>..HEAD -- supabase/functions/`
- **`supabase/sql/schema.sql` is stale and always will be** — it holds 43 tables
  and 51 functions; production has 54 and 105. Read `supabase/schema/` instead,
  which is generated from the live database. Newer RPCs are called with
  `(supabase as any).rpc(...)` until types are regenerated.
- **Re-running an old SQL file can silently revert a fix.** Twenty-five
  functions are defined in more than one file — `assign_hub_operator` in four —
  and whichever runs last wins with no warning. Check
  `supabase/schema/live_schema.sql` for the deployed body before re-applying
  anything.
- **Web has no Razorpay** — `src/utils/razorpay.ts` throws. Web is wallet-only.
- **Staff board shows one batch** (latest `kitchen_push_log`) plus anything
  overdue. Empty before the first push of the day is correct.
- **Which config table wins**: `hub_delivery_active`,
  `branch_management_active`, `referral_system` → `feature_flags`.
  `storm_mode_active` → **both**, OR-combined. Essentials on/off →
  `branches.essentials_enabled`.
  `store_config.essentials_module_active` and `.hub_delivery_active` are **dead
  columns**.
- **Never verify an RLS policy as a superuser** — it bypasses RLS and will
  confirm a policy that denies everyone. Impersonate the user: set
  `request.jwt.claims` **and** `SET LOCAL ROLE authenticated`.
- `essentials_catalog` rows with `vendor_id IS NULL` are 1stOne's own. The
  daily-cap and vendor-zone guards only run when a cart holds a vendor item.
- Vendor reach is defined twice on purpose — `vendor_ids_visible_to_me()` for
  browsing (any active address), `vendor_ids_for_address()` for ordering (the
  one address being delivered to). Change one, check the other.

## Current state (13 Aug 2026)

- **47 test suites, 641 tests, all passing.** Coverage from `src/utils/**` +
  `src/hooks/**`; 5 screens have tests, ~120 do not.
- Version **1.5.0**. **A NEW ANDROID BINARY IS DUE** — `expo-haptics` is a
  native module and cannot reach the 1.4.0 build over the air.
- **Production ships the Razorpay TEST key** (`rzp_test_…`) in all three EAS
  profiles. Server-side secrets are set. No real money has moved.
- **One Supabase project** is dev, preview and production.
- **PostHog has no key** in any build — analytics is inert.
- No order has ever reached `Delivered`, so `vendor_earnings` is empty and the
  credit trigger has never fired.
- No hub has a `commission_percent`, so no hub commission claim can be raised.

### Shipped 12–13 Aug, NOT yet walked on a device

The plan builder is a six-step wizard; Create Order and Onboard Vendor are too.
Every OS alert is gone (206 calls, 53 files). `ScreenHeader` is on all 62
reachable screens — **which moved the back control to the right on 44 admin and
staff screens**. Haptics on the four operational personas.

**Admin is the most-changed and least-walked part of the app. Start there.**

Two defects were found by opening the app and would not have been found any
other way: a completed wizard that could not close (`navigation.replace` fired
the back guard), and a cancelled order that stayed on the Undelivered tab (six
query keys missing from `invalidateOrderQueries`). Both had a fully green gate.

## Health checks

```
supabase db query --linked --file supabase/tests/platform_health_check.sql
supabase db query --linked --file supabase/tests/subscription_flow_check.sql
```

Both end in an error **by design** — that is what rolls them back.
**Read the report, not the exit code.**

## Working agreements

- After making edits, **pause for owner review** before running tsc/jest or
  committing.
- Bank changes locally during a polish session — one commit + OTA per slice.
- Owner-facing flows must be tested by actually opening every screen. Prefer
  AskUserQuestion options over free text during device tests.
- **Commit and push only when asked.**
- Web ships with every release: `eas update` or a Play release is followed by
  `git push` in the same sitting.
