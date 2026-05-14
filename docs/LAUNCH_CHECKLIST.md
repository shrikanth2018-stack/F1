# 1stOne F1 — Launch Checklist

> Single page that surfaces every item still standing between us and Play Store / TestFlight production release. Updated as items close. Owner / ETA columns added when assigned.

**Last audit:** 2026-05-14 mid-session
**Target launch:** TBD (gated on items below)
**Reference docs:** `docs/STATUS.md` (current state), `docs/DECISIONS.md` (open task ledger), `docs/RULES.md` (working rules), `CLAUDE.md` (architecture).

## Legend

- `[ ]` — open
- `[~]` — in-progress / partial
- `[x]` — closed
- `[!]` — blocker
- `[?]` — needs decision before action

---

## D-08 hard launch gates (Play Store production cannot ship until these close)

- [ ] **V-06 persona regression** — full real-device walkthrough: customer → staff (Kitchen + Packing) → driver → hub-op → branch-admin. Covers what Jest can't (Supabase realtime, Razorpay sandbox, cron-fired sub dispatches landing in staff UI). Source: `docs/DECISIONS.md` Pre-launch must-do.
- [x] **`branch_management_active = TRUE` on prod** — applied 2026-05-12 during import-flow audit.
- [x] **FT-08 UX punch list** — closed 2026-05-14; absorbed by today's UX session (profile menus, LoginScreen, PlansScreen, PlanDetail, icons). See `docs/DECISIONS.md`.
- [x] **MF-03 Classes A/B/C** — closed via Tier 1 Flow 6 audit 2026-05-11.
- [x] **`profiles.branch_id` FK** — applied 2026-05-14 (`add_profiles_branch_id_fk.sql`).

---

## App-side / code

- [x] **Re-deploy all 12 Edge Functions** — completed 2026-05-14. All 12 (apply-referral, cancel-order, confirm-order, confirm-topup, dormant-user-check, elevate-employee, low-wallet-check, place-order, send-push, subscription-expiry-push, verify-payment, wallet-topup) plus `_shared/auth.ts` + `_shared/notifications.ts` re-pushed cleanly. HEAD === prod.
- [x] **Sentry production wiring** — `EXPO_PUBLIC_SENTRY_DSN` set in `.env` + `eas.json`; `initSentry()` called from `App.tsx:33`; `enabled: !__DEV__` activates in prod builds only.
- [x] **Sentry user-context attach** — already wired in `useAuth.ts` (useEffect on session change calls `setSentryUser`/`clearSentryUser`). Crashes carry user_id + phone.
- [ ] **iOS APNs cert** — only blocking if iOS ships at launch. Apple Developer key uploaded to Expo project credentials. Without this, iOS push silently no-ops.
- [ ] **Razorpay production webhook** — point Razorpay dashboard webhook at production `confirm-topup` / `confirm-order` Edge Functions (not test endpoints).
- [ ] **Storm-mode kill-switch tested** — flip both `store_config.storm_mode_active` + `feature_flags.storm_mode_active`; verify orders rejected on every surface (customer + staff queues).
- [ ] **AAB / TestFlight build pushed to testers** — current AAB is v15; needs new build after today's UI + asset changes.

---

## Push notification verification (current AAB)

- [x] FCM V1 token registration verified
- [x] order.confirmed / order.dispatched / order.received_at_hub delivered to 555
- [x] order.cancelled — intentionally silent on customer-initiated, by design
- [ ] **BF-50** — Kitchen-tab Mark-Ready push (needs new AAB; client fix in StaffDashboard.tsx)
- [ ] **BF-51** — hub_op delivered push, device-side display (server-side confirmed working; Android suppression / grouping suspected)
- [ ] **wallet.topped_up** — 555 Razorpay test topup
- [ ] **order.razorpay_confirmed** — 555 places order, pays via Razorpay test
- [ ] **subscription.activated** — 555 buys subscription via Razorpay test
- [ ] **subscription.starting_tomorrow / ending_1d / ending_2d** — cron-fired; can be manually invoked via `supabase functions invoke subscription-expiry-push`
- [ ] **wallet.low_balance** — cron-fired; can be manually invoked
- [ ] **winback.dormant** — cron-fired; can be manually invoked

---

## Notification content / templates

- [ ] **`notification_templates` copy review** — pass through every `event_key`; confirm no test placeholders ("Hello tester", "Order #999", etc.) and that customer-facing wording is launch-ready.
- [ ] **Default fallback strings in code** — audit `send-push` Edge fn defaults for the same.

---

## Production data seeding

- [ ] **Real menu items** in `menu_items` (test seeds cleared 2026-05-12; verify current state of catalog)
- [ ] **Real essentials catalog** in `essentials_catalog`
- [ ] **Real subscription plans** in `subscription_plans` — pricing finalised, savings calculated, items linked
- [ ] **Hub polygons drawn** for actual coverage areas (replaces placeholder polygons)
- [ ] **Zone polygons drawn** for direct-delivery coverage
- [ ] **Delivery cycles** — already configured (Breakfast / Lunch / Snacks / Dinner with correct cutoff + kitchen_push + delivery_start). ✓
- [ ] **First real super-admin account** — created with real phone (not `777` tester)
- [ ] **First real branch-admin** — for the launch branch
- [ ] **First real staff + hub-op + driver** — onboarded with real phones, employee IDs, driver codes
- [ ] **`store_config.whatsapp_support_number`** — points to real support WhatsApp number

---

## Secrets & keys (test → production flip)

- [ ] **`EXPO_PUBLIC_RAZORPAY_KEY_ID`** — flip to live Razorpay key (currently test). Settings: `.env` + `eas.json`.
- [ ] **Razorpay secret on Supabase Edge env** — rotated to live secret
- [ ] **MSG91 production sender ID** — DLT-registered. TRAI rule: every transactional SMS template must be pre-approved by DLT or sends silently fail.
- [ ] **MSG91 OTP template** — confirmed in DLT approved list
- [ ] **Supabase service-role key** — verify not exposed in any client artifact (it should never be — sanity scan)
- [ ] **JWT secret** — only if it's been exposed; otherwise leave

---

## Play Store listing

- [ ] **App Store icon (512×512)** — Play Console asset
- [ ] **Feature graphic (1024×500)** — Play Console asset
- [ ] **4–8 phone screenshots** — captured from the new AAB once installed
- [ ] **App description + short description** — launch copy with keywords
- [ ] **Content rating questionnaire** — Play Console
- [ ] **Target audience** — Play Console
- [ ] **Data Safety form** — declare data collected (phone, location, payment), why, third-party shares (Razorpay, Supabase, FCM, MSG91, Sentry)
- [ ] **Privacy Policy URL declared in listing** — point at `https://wcvqxzqqwcxlcgrjyunf.supabase.co/storage/v1/object/public/assets/Privacy-Policy.pdf` or a website-hosted equivalent
- [ ] **Categorisation** — Food & Drink

---

## App Store / TestFlight (only if iOS ships at launch)

- [ ] **Apple Developer Program enrollment** — $99/year, must be in business name. **1–3 days end-to-end** on a fresh account; start in parallel with everything else.
- [ ] **Bundle ID `com.1stone.f1`** registered in App Store Connect
- [ ] **Distribution certificate + provisioning profile** — `eas credentials` can manage
- [ ] **APNs Auth Key** uploaded to Expo project (see Notifications section)
- [ ] **TestFlight build pushed** — `eas submit --platform ios`
- [ ] **First TestFlight beta-app-review** — Apple's manual gate, 24h on first build
- [ ] **App Store listing assets** — icon, screenshots (per device), description, keywords, support URL, privacy URL, age rating

---

## Legal / regulatory (slowest gate — start early)

- [ ] **FSSAI license** — mandatory for food delivery in India. Display number prominently in app + on invoices.
- [ ] **GST registration** — for business entity. Required to issue tax invoices.
- [ ] **DPDP Act compliance review** — Privacy Policy PDF reviewed against India's data law. Must name data controller, contact, grievance officer, retention periods.
- [ ] **Refund / cancellation policy** — clearly documented (FAQ + Terms PDF) and reachable in-app.
- [ ] **Business address** — listed in app About section + website.

---

## Operations readiness

- [ ] **Customer support WhatsApp manned** during launch hours; SLAs decided
- [ ] **Hub-operator training** — they know the My Hub dashboard before day 1
- [ ] **Driver training** — they know the DriverDashboard before day 1
- [ ] **Staff training** — Kitchen + Packing flows
- [ ] **Storm-mode flip rehearsal** — admin practices using the kill switch
- [ ] **Manual Razorpay refund procedure** — documented (for the half not covered by `cancel-order` auto-refund)

---

## Customer-facing content

- [ ] **FAQ page on website** (`https://1stone.in/faq`) — launch-ready content; profile menu links to it
- [ ] **Privacy Policy PDF current** on Supabase Storage
- [ ] **Terms of Service PDF current** on Supabase Storage

---

## Print / invoice (open design question)

- [~] **Decide: combined label+invoice on single print, or separate prints?** Deferred 2026-05-14 — revisit after launch. Shrikanth will provide GST number to populate invoice fields. GST regime requires tax invoice with delivery; absence could draw a query during audit.

---

## Web surfaces (separate from mobile launch)

- [ ] **`app.1stone.in` web app build** — React Native Web; deploy after mobile launch settles
- [ ] **`1stone.in` landing page** — Cloudflare Pages; add Play Store + App Store badges once listings go live

---

## Post-launch monitoring (set up before launch, observe after)

- [ ] **Sentry dashboard checked daily** for week 1
- [ ] **Supabase backup schedule** — verified on Pro plan (automatic daily; PITR available)
- [ ] **Cron failure alerting** — pg-cron doesn't notify on failure by default. Consider a hourly health-check tick that pings a webhook so we know if cron stops.
- [ ] **Push delivery rate** — track via `push_logs` (sent / failed / invalid_token ratios)
- [ ] **Order funnel** — track Cart → Confirmed → Delivered conversion via `orders` queries

---

## What's already closed (reference, will not re-check)

- [x] MF-03 Classes A/B/C (Tier 1 audit, 2026-05-11)
- [x] MF-08 production-only SQL captured (2026-05-12)
- [x] MF-09 customer-side multi-branch wiring (2026-05-11)
- [x] BF-30..BF-51 across realtime, push, status, FK, address-phone (per HISTORY.md)
- [x] Tier 2 Jest backfill — 300 tests, 18 suites
- [x] FCM V1 push infrastructure end-to-end (2026-05-13)
- [x] Customer + Staff profile menu restructure (2026-05-14)
- [x] PlansScreen UX standardisation (2026-05-14)
- [x] App icons + notification icon updated to new brand mark (2026-05-14)
- [x] LoginScreen footer simplification (2026-05-14)

---

## Suggested drive-from-top order (my read)

1. **Today (mid-EOD):** trigger new AAB build with today's changes; redeploy all Edge functions.
2. **Tonight / overnight:** AAB lands on testers; install; smoke-test today's UI changes + remaining push paths.
3. **Tomorrow:** V-06 persona regression on real device.
4. **In parallel from today:** start Apple Developer enrollment (slowest gate); FSSAI/GST paperwork (slower gate); DLT-template approval with MSG91 (slowest gate).
5. **Once V-06 passes:** flip Razorpay to live, MSG91 to production sender, run one real ₹1 order end-to-end.
6. **Then:** capture Play Store screenshots from the production build, complete Data Safety form, submit for review.
7. **Apple track:** runs ~3-5 days behind Play Store due to enrollment + beta-app-review gates.

This isn't a deadline — it's just the natural critical path.
