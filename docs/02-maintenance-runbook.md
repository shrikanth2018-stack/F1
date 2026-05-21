---
title: "1stOne — Maintenance & Operations Runbook"
subtitle: "How to keep 1stOne healthy — what to check, when, and what never to break"
---

# 1stOne — Maintenance & Operations Runbook

*Prepared from a direct reading of the application's source code and configuration. Where the code and older comments disagreed, the code was treated as the source of truth. No secret values appear in this document — credentials are named by their variable and storage location only.*

*Document 2 of a series · Reflects app v1.3.2-stable.1 · May 2026*

## How to use this runbook

This runbook is **layered**. **Part 1** is a plain-English checklist for the business owner / operator — no technical skill needed; tick the items on schedule and hand anything marked "(Tech)" to your developer. **Parts 2–8** are the technical reference: monitoring, the dependency and credential register, deployment rules, security, backups, dos & don'ts, and code-derived watch-items. Everything is drawn from the actual code and configuration.

> **Golden daily habit.** Open **Admin → Operations Manager → Job Health** every operating day. If every background job shows "succeeded" with zero 24-hour failures, the engine that cooks, dispatches, charges, and notifies is healthy. This single screen is your most important check.

---

# Part 1 — Owner's Maintenance Checklist

No technical skill needed for this part. Work top-to-bottom on each schedule; delegate items marked "(Tech)".

**Every operating day**
- ☐ Open Admin → Operations Manager → Job Health: every background job shows "succeeded", no 24-hour failures.
- ☐ Glance at the Reports tab — today's Orders and Revenue look sane.
- ☐ Act on any reconciliation alert push: the app notifies admins if a wallet refund failed or a subscription was paid but not created.
- ☐ Confirm the kitchen received its summary push at each cycle's cutoff (ask staff, or check Job Health's recent manifest runs).

**Every week**
- ☐ Job Health → push outcomes: confirm expiry reminders, low-wallet warnings, and the Monday win-back went out.
- ☐ Review Customer Feedback and item ratings; route recurring complaints to the kitchen.
- ☐ (Tech) Skim Sentry for new app errors / crashes.
- ☐ (Tech) Confirm a recent database backup exists in Supabase.

**Every month**
- ☐ Run staff salary; reconcile attendance, leave, and expense claims (Resource Manager / Expense Manager).
- ☐ Review store settings — delivery fee, tax, cancellation window, wallet limits, loyalty rate — still correct?
- ☐ Review feature flags — anything to switch on or off?
- ☐ (Tech) Apply dependency and security updates; re-run the test gate.

**Every quarter**
- ☐ (Tech) Rotate sensitive secrets: Razorpay key-secret & webhook secret, Supabase service-role key.
- ☐ Review who holds admin / super-admin access; offboard anyone who has left.
- ☐ (Tech) Plan any Expo SDK or major library upgrades.

**Every year (set calendar reminders — see Part 3 register)**
- ☐ Renew the Apple Developer Program membership — if it lapses, the iOS app is removed from sale.
- ☐ Renew the domain 1stone.in with the registrar.
- ☐ Re-check Google Play and Apple policy / target-SDK requirements and update if required.
- ☐ Confirm the payment gateway (Razorpay) account / KYC is active and any plan is renewed.

---

# Part 2 — Health Checks & Monitoring

## Where to look

- **In-app Job Health** — Admin → Operations Manager → Job Health (the `get_job_health` RPC, admin-only). Shows every scheduled job's last run, status, and 24-hour failure count; recent subscription-dispatch (manifest) runs; and push-delivery outcomes over 24h.
- **Cron-failure alert** — an hourly job pushes admins automatically if any scheduled job failed — your early-warning even before you open Job Health.
- **Supabase dashboard** — Edge Function logs, Postgres logs, and `cron.job_run_details` for deep dives.
- **Reconciliation alerts** — the order/cancel functions push branch admins on a wallet-refund failure or a paid-but-not-created subscription. These need a human to fix.
- **Sentry** — app crashes and errors. **PostHog** — product analytics. **Razorpay dashboard** — payments, settlements, webhook delivery.

**Tables that record what happened:** `manifest_run_log` (daily subscription dispatch), `kitchen_push_log` (cycle pushes; also drives the staff "active batch"), `push_logs` (every notification attempt + status).

## Scheduled jobs (the operational clock)

| Job | Schedule (UTC) | What it does |
|---|---|---|
| kitchen-cutoff-push-tick | `* * * * *` (every min) | At each cycle's cutoff: generate that day's subscription orders + push the kitchen summary (sets the staff batch). |
| subscription-expiry-push | `30 3 * * *` (09:00 IST) | 1-day / 2-day expiry reminders + "starts tomorrow" notices. |
| low-wallet-check | `0 4 * * *` (09:30 IST) | Warn customers with a low wallet before a subscription auto-renews. |
| dormant-user-check | `30 4 * * 1` (Mon 10:00 IST) | Weekly win-back nudge to customers who've gone quiet. |
| expire-idempotency-keys | `0 * * * *` (hourly) | Clean up old idempotency rows. |
| cron-failure-alert | `15 * * * *` (hourly) | Push admins if any scheduled job failed. |

---

# Part 3 — Dependencies, Accounts, Credentials & Renewals

## Dependency inventory

| Layer | Technology | Version | Notes |
|---|---|---|---|
| App framework | Expo SDK | ~54 | Build tooling + over-the-air (OTA) updates |
| Mobile runtime | React Native | 0.81.5 | Hermes engine |
| UI runtime | React / React DOM | 19.1.0 | Also powers the web app |
| Navigation | @react-navigation | 7 | Native stack per role |
| Server state | TanStack Query | 5 | Caching / fetching |
| Local state | Zustand | 5 | Cart, UI, offline queue (AsyncStorage) |
| Backend client | @supabase/supabase-js | 2.45 | App + edge functions |
| Payments | react-native-razorpay | 2.3 (patched) | `patches/` patch must persist (postinstall) |
| Maps | react-native-maps / @react-google-maps/api | 1.20 / 2.20 | Needs Google Maps key |
| Notifications | expo-notifications | — | Push via Expo |
| Monitoring | @sentry/react-native + posthog | 8.x / 4.x | Errors + analytics |
| Edge runtime | Deno (Supabase Edge) | std 0.168 | 17 functions; supabase-js@2.45 |
| DB extensions | pg_cron, pg_net, Vault | — | Scheduling, HTTP calls, secret storage |
| Build / CI | EAS | cli >= 12 | Profiles: development / preview / production |
| Dev tooling | TypeScript / ESLint / Jest / Husky / Knip | 5.9 / 9 / 30 / 9 | Pre-push gate: tsc + jest |

## External accounts, credentials & renewals

Secrets live in `.env` (local, git-ignored), EAS build env / secrets, and the Supabase Edge Function environment + Vault. This document names them only. **Fill the last column** with the account owner and next renewal/rotation date.

| Service | Credential name & where it lives | Rotation / Renewal | Owner & next date (fill in) |
|---|---|---|---|
| Supabase (project `wcvqxzqqwcxlcgrjyunf`) | `EXPO_PUBLIC_SUPABASE_ANON_KEY` (public); `SUPABASE_SERVICE_ROLE_KEY` (server only — function env + Vault + `app_config`) | Rotate service key on staff change / leak | ____________ |
| Razorpay | `EXPO_PUBLIC_RAZORPAY_KEY_ID`; `RAZORPAY_KEY_SECRET`; `RAZORPAY_WEBHOOK_SECRET` (secrets in function env) | Rotate secret + webhook periodically; keep KYC active | ____________ |
| Google Maps | `EXPO_PUBLIC_GOOGLE_MAPS_KEY` (Android manifest) | Usage-billed; keep key restricted | ____________ |
| Firebase / FCM | `google-services.json` (Android) | Re-download if project changes | ____________ |
| Expo / EAS | Project `81ff7f3c-…`; Expo account; OTA via `u.expo.dev` | Account active; submission creds | ____________ |
| Apple App Store | Bundle `com.1stone.f1`; appleId / ascAppId / teamId (`eas.json` — currently placeholders) | Developer Program ≈ yearly (~$99) | ____________ |
| Google Play | Package `com.stone1st.f1`; `play-store-service-account.json` | One-time reg; policy/target-API yearly | ____________ |
| Domain | `1stone.in` | Registrar — yearly | ____________ |
| Sentry | `EXPO_PUBLIC_SENTRY_DSN` (publishable) | Plan tier | ____________ |
| PostHog | `EXPO_PUBLIC_POSTHOG_KEY` / `_HOST` | Plan tier | ____________ |

---

# Part 4 — Deployment & Release

> **Owner note.** Most bug fixes reach phones automatically as over-the-air (OTA) updates — no app-store wait. Only changes to the phone's native parts (new permissions, SDK upgrades, new native libraries) need a full rebuild and store review, which is slower.

## Two release paths

- **OTA update (JS / content only)** — ship JS logic, copy, and bug fixes with an Expo update; phones pick it up on next launch (`checkAutomatically = ON_LOAD`). No store review. Valid only within the same Expo SDK (`runtimeVersion = sdkVersion`).
- **Native build** — for new native code, an SDK upgrade, new permissions, or a version bump: build with EAS (production profile; `autoIncrement` on) and submit to the stores.

## Backend deploys

- **Edge Functions** — `supabase functions deploy <name>` (most use `--no-verify-jwt`). **Critical:** deploy `place-order` together with the matching app build — its request contract is not backward-compatible.
- **SQL** — files in `supabase/sql` are idempotent; run them in the order in `DEPLOY_SQL_ORDER.md`. Add new migration files; never hand-edit old ones. After the access-token hook is installed, enable it in the dashboard.
- **Prerequisites** — extensions `pg_cron` + `pg_net`; Vault secrets `supabase_url` + `service_role_key`; the `app_config` rows used for in-database push must exist.

> **Quality gate.** A Husky pre-push hook runs `tsc --noEmit` and `jest`; the push is blocked if either fails. Run it yourself first with: `npm run check`.

---

# Part 5 — Security & Secret Rotation

## Which secrets exist

- **Sensitive (never expose)** — Supabase service-role key, Razorpay key-secret, Razorpay webhook secret. These live server-side only (Supabase function env / Vault), never in the app bundle.
- **Publishable (safe in the app)** — Supabase anon key, Google Maps key, Sentry DSN, PostHog key, Razorpay key-id. These are embedded in builds by design.

## Rotation steps

- **Supabase service-role key** — roll it in the dashboard, then update it everywhere it is stored: the Edge Function env, the Vault secret, and the `app_config` row used for in-database push. Redeploy functions.
- **Razorpay secret / webhook** — rotate in the Razorpay dashboard, update the function env and the webhook configuration, then redeploy.

## Standing rules

- **Row-Level Security stays on** — every table is RLS-protected; money and role changes flow only through SECURITY DEFINER atomic RPCs or service-role functions. Never write those columns directly.
- **Never disable the webhook signature check** — `verify-payment` verifies an HMAC signature; without it, anyone could mark orders paid.
- **Access review** — admin / super-admin is set on the profile; remove leavers and offboard staff through the proper RPC.

---

# Part 6 — Backups & Disaster Recovery

## What to protect

- **Database** — rely on Supabase automated backups; confirm your plan's retention / point-in-time recovery, and periodically test a restore.
- **Android signing keystore** — managed by EAS. Losing the signing key means you can no longer ship updates to the same Play listing — ensure EAS holds it (or keep a secure backup).
- **Apple distribution certificate / profiles** — managed via EAS; keep Apple account access safe.
- **Secrets (`.env` and server secrets)** — keep a secure copy (e.g. a password manager); they are not in git.
- **Code & schema** — git is the source of truth; `supabase/sql` + `DEPLOY_SQL_ORDER.md` reconstruct the database; a `schema.sql` snapshot exists.
- **Storage bucket** — the `assets` bucket (logo, banners, PDFs) — back it up.

> **Recovery drill.** You should be able to: (1) restore the database from a Supabase backup, (2) redeploy the edge functions, (3) rebuild the app from git, and (4) re-provision the secrets. Rehearse it before you need it.

---

# Part 7 — Dos & Don'ts

**Do**
- ✔ Run `npm run check` (tsc + jest) before pushing — the pre-push gate enforces it.
- ✔ Keep the `patches/` folder; patch-package re-applies the Razorpay patch on every install.
- ✔ Deploy `place-order` (and any changed edge functions) together with the matching app build.
- ✔ Keep business values in `store_config` / `feature_flags` and styling in the theme — the codebase mandates zero hardcoded values.
- ✔ Follow `DEPLOY_SQL_ORDER.md`; add new SQL files instead of editing old ones.
- ✔ Test owner-facing flows on a real device before a release.
- ✔ Keep RLS on and route money / role changes through the atomic RPCs.

**Don't**
- ✘ Don't weaken the server-authority, quote-drift, or idempotency rules in the order path.
- ✘ Don't hardcode prices, fees, hex colours, or fonts — use config and the theme.
- ✘ Don't commit secrets or paste the service-role / Razorpay secrets anywhere shared.
- ✘ Don't disable the Razorpay webhook signature verification.
- ✘ Don't hand-edit money / role columns or bypass RLS in the database.
- ✘ Don't delete `idempotency_keys` or the audit tables (`push_logs`, `manifest_run_log`, `kitchen_push_log`).
- ✘ Don't ship a native change as an OTA update — it won't take effect; rebuild instead.

---

# Part 8 — Watch-items & Risks (from the code)

These are factual observations from the current code and configuration — worth a decision, not necessarily a problem.

> ⚠ **Razorpay test key in the production build profile.** `eas.json`'s production profile lists `EXPO_PUBLIC_RAZORPAY_KEY_ID` as a test key (`rzp_test_…`). Confirm the LIVE key id is used for production builds (e.g. injected via EAS secrets) before real payments.

> ⚠ **iOS submission not configured.** `eas.json` submit → iOS still has `REPLACE_WITH_*` placeholders for Apple ID / team / app id. Set these before an App Store submission.

**Other items to track:**
- **Multi-branch is built but OFF** — the `branch_management_active` flag is false (single-branch today). Turning it on needs a `branch_id` data backfill and users to refresh their login token.
- **Two essentials gates** — `store_config.essentials_module_active` and an essentials feature flag both exist; consolidate to avoid confusion.
- **Generated DB types lag the live schema** — several RPCs are called with type casts ("types not regenerated"). Run `npm run supabase:gen-types` after any schema change.
- **Service-role key is stored in three places** — function env, Vault, and the `app_config` table (for in-database push). Rotating the key means updating all three.
- **Storm mode is a kill switch** — the `storm_mode_active` flag instantly blocks all new orders and renewals; know it exists for incidents (and remember to turn it back off).
