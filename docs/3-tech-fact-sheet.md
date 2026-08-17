# 1stOne — Technical Fact Sheet

Everything that is true about the build, as of 8 August 2026.

---

## Identity

| | |
|---|---|
| App name | 1stOne |
| Version in code | **1.5.0** |
| Expo slug | `1stOne-F1` |
| iOS bundle id | `com.1stone.f1` |
| Android package | `com.stone1st.f1` (**note: different from iOS**) |
| Repository | `github.com/shrikanth2018-stack/F1`, branch `main` |
| EAS project id | `81ff7f3c-8f25-4acc-9a4f-605bff80bdd2` |
| Supabase project | `1st0ne`, ref `wcvqxzqqwcxlcgrjyunf`, region ap-southeast-1 |
| Web address | `app.1stone.in` (Cloudflare Pages) |

## Stack

Expo SDK 54 · React Native 0.81.5 · React 19.1 · TypeScript 5.9 · Hermes engine
· React Navigation 7 · TanStack Query 5 · Zustand 5 · Supabase (PostgreSQL 17.6)
· Razorpay · Expo Push · Sentry · PostHog · Node 22.

Maps: `react-native-maps` on phones, `@react-google-maps/api` on web.

## Shape of the code

| Area | Size |
|---|---|
| Screens | 89 files (38 admin + 5 admin reports, 20 customer, 4 staff, 2 auth) |
| Components | 41 files |
| Hooks (all data access) | 60 files |
| Utilities (pure logic) | 43 files |
| Stores (Zustand) | 4 |
| Navigation | 4 files |
| Edge functions | 17, plus 7 shared modules — ~5,500 lines |
| SQL files | 137 |
| Tests | **47 suites, 641 tests — all passing** |

## Commands

| Command | What it does |
|---|---|
| `npm run check` | `tsc --noEmit && jest` — the gate |
| `npm test` / `npm run lint` | tests / lint on their own |
| `npm start` · `npm run android` · `ios` · `web` | run the app |
| `npm run supabase:gen-types` | regenerate database types after a schema change |
| `supabase functions deploy <name> --no-verify-jwt` | deploy one edge function |
| `eas update --channel production` | ship a JavaScript-only change over the air |
| `eas build --profile production --platform android` | new Android binary |

`npm run check` runs in two places on purpose: the `.husky/pre-push` hook, and
GitHub Actions (`.github/workflows/check.yml`) on every push and pull request.
CI uses `npm ci`, then `npm run check`, then `npm run lint` as a real gate.

## Layout

```
src/screens/{auth,customer,staff,admin}   screens, by persona
src/navigation/                            role-based navigators
src/hooks/                                 ALL data access lives here
src/api/                                   supabase client, edge-fn caller, query helpers
src/store/                                 cart (ONE), offline queue, ui, branch
src/utils/                                 pure logic (dates, dispatch labels, validators)
src/theme/                                 all styling values
supabase/functions/                        17 edge functions + _shared
supabase/sql/                              137 SQL files, applied by hand
supabase/tests/                            4 SQL test harnesses
landing/                                   static marketing site
```

## Architecture in one paragraph

The app sends intent (item IDs, quantities, address, payment choice). The server
derives delivery times, dates, prices, tax and fees. One shared module
(`_shared/orderBuild.ts`) does that derivation for the price preview, the real
order and back-office orders alike, so they cannot diverge. The role comes from
the sign-in token, decoded on the phone with no extra query. Server state is
cached by TanStack Query (2-minute staleness, 2 retries); Zustand holds only
device state. Background work is all server-side, driven by database cron jobs.

## What every screen shares

Five components carry rules the whole app follows. Changing one changes every
screen that uses it, which is the point.

| | Owns |
|---|---|
| `ScreenHeader` | Title left, exactly ONE control top right. On all 62 screens a customer, staff member or admin can reach. |
| `FooterAction` | The primary action at the foot of a page, on a gradient the content fades out under. Its label names the blocker when the action is unavailable — never a greyed button with no reason. |
| `PressCard` | A card you can choose. Selection is drawn by the surface going one shade LIGHTER, because at `#151515` a drop shadow has nothing to darken and a glow renders on iOS only. |
| `Wizard` | Position and movement for a step-by-step form: the step machine, the progress bar, and back stepping through the form instead of discarding it. Used by the customer's plan builder and the admin's Create Order and Onboard Vendor. |
| `DialogHost` | Every dialog in the app. **There are no operating-system alerts left** — `Alert.alert` appears nowhere in the source. Three shapes: confirm, info, and a pick-one. |

**Motion has two languages, and the division is the rule.** Content arriving
(a list appearing on Home) uses a spring and a stagger. A control answering
the customer (a card pressed, a bar filling) uses `withTiming` on an ease-out
and never overshoots — a control that wobbles feels loose. Both live in
`Theme.motion`.

**Haptics** are the only effect that moves nothing: a light tick when a choice
registers, a heavier one when an operational action commits — a status
advanced, a shift clocked. Never on a refusal, an error or a completed
purchase. `expo-haptics` is a native module, so it needs a build, not an OTA.

## Database

**53 tables**, 527 columns, 1 view (`vendor_public`), **96 functions**,
34 triggers, **99 row-level-security policies**, 10 scheduled jobs.
Extensions: `pg_cron`, `pg_net`, `pg_stat_statements`, `pgcrypto`,
`supabase_vault`, `uuid-ossp`.

Row-level security is **on for every table** except three test-harness
bookkeeping tables. The real gate is two-layered: a database GRANT first, then
a policy. Consequences worth knowing:

- A logged-in user cannot insert or update `order_items` at all.
- On `orders` a client can only change `status`.
- On `user_subscriptions` a client can only change `is_paused`.
- On `profiles` a client can only write their own name and phone — never role,
  wallet, points, branch, hub or vendor link.
- `app_config` (which holds the service-role key) has security on and **no
  policies at all**, so it is unreachable through the API.

**No database enums** — statuses are plain text, and `src/utils/orderStatus.ts`
is the single vocabulary.

**Key tables**: `profiles`, `orders` (one row per delivery time; the customer's
order is the set sharing an `order_group_id`), `order_items`,
`user_subscriptions`, `cancelled_subscription_days`, `menu_items`,
`essentials_catalog`, `subscription_plans`, `delivery_cycles` / `zones` / `hubs`,
`customer_addresses`, `wallet_transactions`, `pending_wallet_topups`, `vendors`,
`vendor_zones`, `vendor_earnings`, `vendor_order_fulfilment`,
`vendor_listing_changes`, `expense_claims`, `store_config`, `feature_flags`,
`notification_templates`, `idempotency_keys`, `kitchen_push_log`,
`manifest_run_log`, `push_logs`.

**Storage**: three buckets — `assets`, `menu-photos`, `essentials-photos` —
**all publicly readable**. Writes are gated: menu photos to branch admins,
essentials photos to branch admins or the owning approved vendor.

## Settings that control behaviour

`store_config` (one row):

| Setting | Value |
|---|---|
| GST rate | 5% (inclusive) |
| Delivery fee | ₹0 |
| Cancellation window | 2 hours |
| Minimum / maximum top-up | ₹100 / ₹50,000 |
| Low-wallet warning below | ₹200 |
| Win-back after inactive | 14 days |
| Max admin discount | 15% |
| Loyalty points per rupee | 0.10 |
| Support WhatsApp | 9448364017 |

`feature_flags`: `branch_management_active` **on**, `hub_delivery_active`
**on**, `referral_system` **on**, `storm_mode_active` off.

**Which table wins:** hub delivery, branch management and referrals are read
from `feature_flags`. Storm mode is read from **both** and either one pauses
ordering. Essentials on/off has moved to `branches.essentials_enabled` and is
read from neither.
**`store_config.essentials_module_active` and `store_config.hub_delivery_active`
are dead columns — nothing reads them.**

## Edge functions — 17, all deployed and active

All deploy with `--no-verify-jwt`, so `_shared/auth.ts` is the real auth
boundary: it verifies the token signature locally against the project's public
keys, with the algorithm pinned to ES256.

**Money**: `quote-order`, `place-order`, `confirm-order`, `verify-payment`
(webhook), `cancel-order`, `wallet-topup`, `confirm-topup`.
**Back office**: `admin-place-order`, `admin-create-customer`,
`elevate-employee`, `reports`.
**Scheduled**: `subscription-expiry-push`, `low-wallet-check`,
`dormant-user-check`.
**Support**: `send-push`, `cycle-dispatch`, `apply-referral`.

The three scheduled ones authorise by comparing the bearer token to the
service-role key — they are not for public use.

## Payments

- The gateway order is created **before** any database write.
- Two independent, idempotent confirmation paths: in-app and webhook.
- Both verify an HMAC signature; the webhook **refuses to run** without its
  secret.
- The webhook always answers 200 even on an internal failure, because a 500
  makes Razorpay retry forever.
- **The web build has no card payment** — `src/utils/razorpay.ts` is a shim that
  throws. Web checkout and top-up are wallet-only.

## Release state

| | |
|---|---|
| Latest Android production build | **v1.5.0, build 33, 13 Aug 2026** (from `3f684b8`; includes `expo-haptics`) |
| Latest over-the-air update | **17 Aug 2026**, group `8eb09f71`, runtime `exposdk:54.0.0` |
| iOS builds ever | **one** — a `development` build, v1.0.0, 7 Apr 2026 |
| iOS submit config | still `REPLACE_WITH_APPLE_ID` etc. |

So **1.5.0 runs as over-the-air updates on top of the 1.5.0 build-33 binary.**
Builds 32 (8 Aug) and 33 (13 Aug) followed build 31; an earlier version of
this sheet stopped at build 31 and claimed a new binary was owed for
`expo-haptics`. It is not — build 33 contains it.
The update policy is `sdkVersion`, so any SDK-54 binary accepts any SDK-54
update.

## Three things that will surprise you

1. **Production ships the Razorpay *test* key.** It is `rzp_test_…` in all three
   EAS build profiles. The server-side secret and webhook secret *are* set. No
   real money has ever moved.
2. **One Supabase project serves development, preview and production.** There is
   no staging. Every schema change goes straight to production, applied by hand
   from `supabase/sql/` — there is no migration runner.
3. **PostHog has no key in any build profile**, so all analytics is inert. The
   wiring is correct and safe; only the key is missing.

## Non-negotiables

- The server decides money, prices and dates. Never weaken the price-drift
  check, the idempotency key, or the rate limit in `place-order`.
- The wallet moves only through the atomic increment/decrement functions.
- Row-level security stays on. Role and money columns change only through
  privileged database functions.
- Never disable the webhook signature check.
- Prices are GST-inclusive — tax is carved out, never added.
- All date logic is explicit `Asia/Kolkata`. **Never format a business date with
  `toISOString()`** — between midnight and 5:30 am IST it silently gives
  yesterday. Use `src/utils/istDate.ts`.
- Vendor payment happens in a database trigger, not in code. Leave it there.
- No hardcoded business values or colours: rules live in `store_config` and
  `feature_flags`, styling in `src/theme/`.
- The `place-order` request format is not backward-compatible — deploy the
  function and the app build together.
