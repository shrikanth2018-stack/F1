# 1stOne — Annexure: Dependencies, Subscriptions and Logins

Every outside service the business relies on, what breaks without it, and where
its credential is kept.
Current as of 8 August 2026.

> **No passwords or secret keys are written in this file.** It is stored in the
> git repository, and anything committed there stays in the history permanently
> even if deleted later. Each entry says exactly *where* the credential lives so
> it can be retrieved in one step. If you want the actual values written down,
> keep them in a password manager, or ask for a separate file that is excluded
> from git.

**There are TWO owner accounts, not one.** Verified in each dashboard on
8 August 2026:

| Account | Owns |
|---|---|
| **`1st0nedotin@gmail.com`** | Google Play Console · Cloudflare · Supabase |
| **`shrikanth.2018@gmail.com`** | Expo / EAS · GitHub |

Both are single points of failure. Print and store the two-factor recovery
codes for **both**.

Play, Cloudflare and Supabase were confirmed by opening each dashboard;
EAS by `eas whoami`. **Razorpay, Firebase, Google Maps, Sentry and
healthchecks.io were not opened** — their rows say so rather than guessing.

---

## 1. Supabase — database, sign-in, server code, storage

| | |
|---|---|
| What it does | The whole backend: PostgreSQL database, phone OTP sign-in, security rules, 17 server functions, file storage, scheduled jobs |
| Without it | The app does nothing at all |
| Dashboard | https://supabase.com/dashboard/project/wcvqxzqqwcxlcgrjyunf |
| Project | `1st0ne`, ref `wcvqxzqqwcxlcgrjyunf`, region ap-southeast-1 (Singapore) |
| Database host | `db.wcvqxzqqwcxlcgrjyunf.supabase.co` (PostgreSQL 17.6) |
| Login | `1st0nedotin@gmail.com` |
| Public key | `EXPO_PUBLIC_SUPABASE_ANON_KEY` — in `.env` and in `eas.json` (safe to publish; it is meant to ship in the app) |
| Secret key | `SUPABASE_SERVICE_ROLE_KEY` — in **three** places: Supabase → Edge Functions → Secrets; the `app_config` table (key `service_role_key`); and Supabase Vault. **All three must change together.** |
| Cost | Paid plan (the project is always-on and uses `pg_cron` and `pg_net`) |
| Notes | Only **one** project exists — it is development, preview and production at once |

---

## 2. Razorpay — payments

| | |
|---|---|
| What it does | Card and UPI payments, wallet top-ups, payment links for back-office orders |
| Without it | No payment except from wallet balance |
| Dashboard | https://dashboard.razorpay.com |
| Login | **not verified — check which of the two accounts** |
| Public key id | `EXPO_PUBLIC_RAZORPAY_KEY_ID` — in `.env` and in all three `eas.json` build profiles. **Currently a TEST key (`rzp_test_…`)** |
| Secret | `RAZORPAY_KEY_SECRET` — Supabase → Edge Functions → Secrets (set 20 Apr 2026) |
| Webhook secret | `RAZORPAY_WEBHOOK_SECRET` — same place (set 18 Apr 2026) |
| Webhook to configure | `https://wcvqxzqqwcxlcgrjyunf.supabase.co/functions/v1/verify-payment` |
| Events that must be ticked | `payment.captured`, `payment.failed`, `order.paid`, **`payment_link.paid`** |
| Cost | Per-transaction commission; no subscription |

⚠️ **The live key has never been switched on.** Going live means changing the
public key in `eas.json`, the two secrets in Supabase, and the webhook in the
Razorpay dashboard — **and rebuilding the Android app**, because the public key
is baked in at build time.

---

## 3. Expo / EAS — builds, updates, push notifications

| | |
|---|---|
| What it does | Builds the Android and iOS apps, ships over-the-air updates, issues push tokens |
| Without it | No new releases, no over-the-air updates, no push notifications |
| Dashboard | https://expo.dev/accounts/shrikanthhegde/projects/1stOne-F1 |
| Login | account `shrikanthhegde` / the account owner email |
| Project id | `81ff7f3c-8f25-4acc-9a4f-605bff80bdd2` |
| Update channel | `production` (URL `https://u.expo.dev/81ff7f3c-8f25-4acc-9a4f-605bff80bdd2`) |
| Stored secret | `SENTRY_AUTH_TOKEN` is an **EAS secret** (see Sentry below) |
| Cost | Free tier may suffice; builds beyond the free allowance are paid |

Push delivery itself goes through **exp.host** (`https://exp.host/--/api/v2/push/send`).
No credential — it works from the device token. Nothing to renew.

---

## 4. Firebase — Android push transport

| | |
|---|---|
| What it does | Carries push notifications to Android devices |
| Without it | Android push stops; iOS unaffected |
| Console | https://console.firebase.google.com/project/stone-8a468 |
| Project | `stone-8a468`, project number `265332383368` |
| Android app | `com.stone1st.f1`, app id `1:265332383368:android:1beb152ee30c7e4bd3893d` |
| Credential | `google-services.json`, committed in the repository root |
| Login | **not verified — check which of the two accounts** |
| Cost | Free |

---

## 5. Google Maps — address pin and delivery areas

| | |
|---|---|
| What it does | The map for dropping an address pin, and for drawing zone and hub boundaries |
| Without it | Address entry and the delivery-area screens stop working |
| Console | https://console.cloud.google.com/google/maps-apis |
| Credential | `EXPO_PUBLIC_GOOGLE_MAPS_KEY` — in `.env` and all three `eas.json` profiles |
| How it reaches Android | Injected into `AndroidManifest.xml` at build time by a small plugin in `app.config.js` |
| Login | **not verified — check which of the two accounts** |
| Cost | **Pay-as-you-go with a monthly free allowance. Needs a billing account.** Worth watching once traffic grows |

⚠️ This key is a spending key. Restrict it in the Google Cloud console to the
app's package name and the APIs actually used.

---

## 6. Sentry — crash reporting

| | |
|---|---|
| What it does | Records crashes and errors with a stack trace |
| Without it | Failures happen silently; nothing else stops |
| Dashboard | https://sentry.io/organizations/1stonein |
| Organisation | `1stonein` · Project `javascript-react` |
| Public DSN | `EXPO_PUBLIC_SENTRY_DSN` — in `.env` and in the preview + production `eas.json` profiles (safe to publish) |
| Write token | `SENTRY_AUTH_TOKEN` — an **EAS secret**, needs the `project:releases` scope. Not in the repository, because it can write to the Sentry organisation |
| Login | **not verified — check which of the two accounts** |
| Verified 8 Aug 2026 | Release **1.5.0 (32)** present with **2 source-map artifacts**, sessions arriving, crash-free 100%, zero issues |
| Cost | Free tier for low volume; paid above it |

To check it is alive: **Admin → Operations → Job Health → Send a test event**,
then look at **Releases** in Sentry (not Issues).

---

## 7. PostHog — product analytics

| | |
|---|---|
| What it does | Would track the customer funnel |
| Status | **Not configured.** No key is set in any build, so nothing is recorded |
| Website | https://posthog.com |
| To enable | Set `EXPO_PUBLIC_POSTHOG_KEY` in `.env` **and** in the `eas.json` preview + production profiles, **and** in Cloudflare Pages for the website |
| Region | Set `EXPO_PUBLIC_POSTHOG_HOST` to match the project's region. The default is EU; a US project needs `https://us.i.posthog.com`. Point it at the wrong region and events vanish with no error |
| Cost | Generous free tier |

The project key is safe to commit — it is write-only by design.

---

## 8. healthchecks.io — dead-man's switch

| | |
|---|---|
| What it does | The database pings it every 5 minutes. If pings stop, the scheduled jobs are not running |
| Without it | Silent background failures |
| Ping URL | `https://hc-ping.com/b9f7803a-453f-452f-bdf9-806c1a6bed06` |
| Where it is stored | The `app_config` table, key `healthchecks_ping_url` |
| Dashboard | https://healthchecks.io |
| Login | **not verified — check which of the two accounts** |
| Cost | Free tier |

Set up an email or WhatsApp alert on this check — it is the loudest alarm
available and costs nothing.

---

## 9. Cloudflare Pages — website hosting

| | |
|---|---|
| What it does | Hosts the web app at `app.1stone.in` and the marketing site |
| Without it | The website goes down; phones unaffected |
| Dashboard | https://dash.cloudflare.com |
| Production address | https://app.1stone.in |
| Preview addresses | `https://<id>.1stone-app.pages.dev` |
| Deploys when | You push to `main` on GitHub — **automatic deployments confirmed enabled, every deployment to date succeeded** |
| Pages projects | **TWO**, both wired to `shrikanth2018-stack/F1`: `1stone-app` → app.1stone.in, and `f1` → the marketing site |
| Account ID | `d1b44fb6bd0fd362241453b43c68d200` |
| Login | `1st0nedotin@gmail.com` |
| Cost | Free tier |

The list of web addresses allowed to talk to the backend lives in
`supabase/functions/_shared/cors.ts`. **Adding a new address means editing that
file and redeploying every edge function.**

---

## 10. GitHub — source code and the automated gate

| | |
|---|---|
| What it does | Holds the code; runs type-check, tests and lint on every push |
| Without it | No automated gate; the local pre-push hook still runs |
| Repository | https://github.com/shrikanth2018-stack/F1 |
| Login | the account owner |
| Cost | Free |

---

## 11. Google Play — Android distribution

| | |
|---|---|
| What it does | Distributes the Android app |
| Without it | No Android releases |
| Console | https://play.google.com/console |
| Package | `com.stone1st.f1` · developer account ID `7560855775784977775` |
| Status | **Draft app.** Production track inactive; 1.5.0 (32) live on the internal-testing track |
| Store setup | **9 of 11 complete.** Done: privacy policy, data safety, content rating, target audience, ads, sign-in details. Outstanding: app category + contact details, and the store listing |
| Android developer verification | **already registered** (the Sep 2026 deadline is met) |
| Credential | A service-account key file referenced by `eas.json` as `./play-store-service-account.json`. **This file is not in the repository** — it must be kept safe outside it |
| Login | `1st0nedotin@gmail.com` |
| Cost | One-off developer registration fee, already paid |

---

## 12. Apple / App Store — iOS distribution

| | |
|---|---|
| Status | **Not started.** One development build exists, from 7 April 2026 |
| What is missing | An Apple Developer account, the first production build, TestFlight, and App Store review |
| Placeholders to fill | `eas.json` → `submit.production.ios` still reads `REPLACE_WITH_APPLE_ID`, `REPLACE_WITH_ASC_APP_ID`, `REPLACE_WITH_TEAM_ID` |
| Bundle id reserved in code | `com.1stone.f1` |
| Cost when started | Apple Developer Program, US$99 per year |

---

## 13. Domain — 1stone.in

| | |
|---|---|
| Used for | `app.1stone.in` (the web app), `1stone.in/faq` (linked from the app's profile menu) |
| Without it | The web app and the in-app FAQ link break |
| Where to check | Your domain registrar; DNS is pointed at Cloudflare |
| Cost | Annual renewal |

⚠️ **This renews annually. Put a reminder in the calendar.** A lapsed domain
takes the website down and breaks a link inside the app.

---

## Where each credential lives — quick table

| Credential | Where it is kept |
|---|---|
| Supabase public key | `.env`, `eas.json` (all profiles) |
| Supabase secret key | Supabase function secrets **+** `app_config` table **+** Vault |
| Razorpay public key id | `.env`, `eas.json` (all profiles) |
| Razorpay secret | Supabase function secrets |
| Razorpay webhook secret | Supabase function secrets |
| Google Maps key | `.env`, `eas.json` (all profiles) |
| Sentry DSN | `.env`, `eas.json` (preview + production) |
| Sentry write token | EAS secrets |
| PostHog key | not set anywhere |
| healthchecks.io ping URL | `app_config` table |
| Firebase config | `google-services.json` in the repository |
| Play Store service account | a file outside the repository |

---

## Things that expire or renew

| Item | When | Consequence if missed |
|---|---|---|
| `1stone.in` domain | Annually | Website down, in-app FAQ link broken |
| Supabase paid plan | Monthly | Everything stops |
| Google Maps billing | Monthly usage | Maps stop working once the free allowance is exceeded |
| Apple Developer (if started) | Annually, US$99 | iOS app removed from sale |
| Sentry / PostHog / healthchecks / Cloudflare / GitHub | Free tiers today | Nothing, until volume grows |

## If you lose access to an owner account

The services split across **two** Google accounts (see the top of this
document). Losing `1st0nedotin@gmail.com` costs you Play, Cloudflare and
Supabase — the app store, the website and the entire backend. Losing
`shrikanth.2018@gmail.com` costs you builds and source control. Print the
two-factor recovery codes for both and keep them somewhere physical.