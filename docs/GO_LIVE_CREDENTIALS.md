# 1stOne F1 — Going Live: MSG91 OTP + Razorpay Live Credentials

> Plain-English walkthrough for switching from test/sandbox credentials to production credentials. Two independent jobs:
>
> 1. **MSG91 (SMS OTP)** — replaces whatever SMS provider Supabase is using today (or its default test sender) with MSG91 for Indian numbers.
> 2. **Razorpay live mode** — replaces the test key (`rzp_test_SaAGRu9UhPaeqz`) with a live key so real money moves.
>
> Both are configured in dashboards. The mobile app's source code is **not** touched. Razorpay needs one final AAB rebuild (because the publishable key is baked into the AAB at build time); MSG91 needs zero rebuild.

---

## Vocabulary primer

A few terms I'll use a lot — meaning in one line each so you don't have to guess.

- **Publishable key / `key_id`** — the half of a payment-provider key pair that's safe to put in the app. Like a username — identifying, not authorizing.
- **Secret key / `key_secret`** — the other half. Authorizes server actions. **Never** goes into the app; always in a secrets store.
- **Webhook secret** — a separate shared password between Razorpay and our `verify-payment` Edge Function so we can prove a webhook actually came from Razorpay (not from someone faking it).
- **Edge Function secret** — a key/value pair stored in Supabase's Edge Functions secret store. Read at runtime by the function, never visible to the app or to admins.
- **Auth Hook (Send SMS Hook)** — a Supabase feature where, instead of using a built-in SMS provider, Supabase calls a webhook URL of your choice every time it needs to send an OTP. You write a tiny server function at that URL that calls MSG91.

---

## Order of operations

Recommended sequence:

1. **MSG91 first.** It's independent and lower-risk (worst case: OTPs don't arrive, no money is lost).
2. **Then Razorpay server secrets** (live key_secret + live webhook_secret in Supabase). Still no money-risk — server now *can* talk to live Razorpay but the app is still using the test key_id, so nothing actually charges.
3. **Then Razorpay live `key_id`** (one rebuild, one Play Store push). The moment this AAB hits tester phones and you tap pay, real cards get charged in test mode (or your live test cards).
4. **Verify** before opening the app to real customers.

You can pause between any two steps — they're independent.

---

## Part 1 — MSG91 OTP

### Prerequisites

Before you touch Supabase, MSG91 must be ready on their side:

- **MSG91 account active**, with a phone number / email logged in.
- **Sender ID approved** (the 6-letter ID shown on the SMS, e.g. `1STONE`). MSG91 has to approve this via DLT registration in India; you may already have one.
- **DLT template approved** (the exact text of the OTP SMS, with `##OTP##` as the placeholder MSG91 will fill in). Get the **Template ID** — a long number — once approved.
- **Auth Key** — found in MSG91 dashboard under **Settings → API → Auth Key**. Copy it.

Keep these three handy: Auth Key, Template ID, Sender ID.

### Path check — does Supabase support MSG91 natively?

Open **Supabase Dashboard → Authentication → Providers → Phone → SMS provider**. The dropdown shows the supported providers.

- **If MSG91 is in the list** → use **Path A** below.
- **If MSG91 is not in the list** → use **Path B** below (you'll add a Send SMS Hook, which calls a tiny Edge Function we'll create that talks to MSG91).

As of my last check, Supabase's native list is Twilio / MessageBird / Vonage / Textlocal — MSG91 was not in it, so plan for **Path B** unless the dashboard says otherwise. Tell me what the dropdown shows when you get there.

### Path A — MSG91 as a native provider (if the dropdown lists it)

1. **Supabase Dashboard → Authentication → Providers → Phone.**
2. Toggle **"Enable phone provider"** if not already on.
3. **SMS provider** dropdown → select **MSG91**.
4. Paste in the three values:
   - **Auth Key** → MSG91 Auth Key field.
   - **Template ID** → Template ID field.
   - **Sender ID** → Sender ID field.
5. **OTP message template** — usually filled in by MSG91 template, but if the form asks: `Your 1stOne verification code is {{ .Code }}. Don't share it with anyone.` (or whatever your approved template says — must match DLT-approved wording exactly).
6. **OTP expiry** — keep at 600 seconds (10 min) or shorter.
7. Scroll down → **Save**.

That's it on the Supabase side.

**Verify by sending yourself an OTP:** force-stop the app, open it, sign in with your own phone number. SMS should arrive from sender `1STONE` (or whatever you approved). If it doesn't arrive within 30 seconds, check **MSG91 Dashboard → Logs** for failures (template mismatch, sender not approved for that number range, etc.).

### Path B — MSG91 via Auth Hook (most likely path)

If MSG91 isn't in the native dropdown, the approach is:

- Write a tiny Edge Function `send-msg91-otp` that receives Supabase's "please send this OTP" webhook and forwards the request to MSG91's HTTP API.
- Tell Supabase to call this Edge Function instead of its built-in SMS service.

This is the part that does need a small server-side code addition (not app code). It's about 40 lines of Edge Function. **I can write it when you're ready — tell me when MSG91 is provisioned and we'll do it as one focused block.**

Dashboard side of the same path:

1. **Supabase Dashboard → Authentication → Hooks** (left sidebar, under Authentication).
2. Find **Send SMS Hook** → click **Enable**.
3. **Hook URL** → paste the Edge Function URL once we've deployed it (will look like `https://wcvqxzqqwcxlcgrjyunf.supabase.co/functions/v1/send-msg91-otp`).
4. **HTTP Method** → POST.
5. **Bearer token** → use the project's service-role JWT (Supabase fills this for hooks automatically), OR a custom secret you'll also set on the Edge Function for verification — Supabase's UI will show what to paste.
6. **Save**.

The Edge Function itself stores the three MSG91 values as secrets:

- **Supabase Dashboard → Edge Functions → Manage secrets** → add:
  - `MSG91_AUTH_KEY` = your MSG91 auth key
  - `MSG91_TEMPLATE_ID` = your DLT template ID
  - `MSG91_SENDER_ID` = `1STONE` (or whatever)

After both are in place, sign in test: same as Path A. SMS should arrive from MSG91.

### Quick check: did it work?

| Symptom | Likely cause | Where to look |
|---|---|---|
| No SMS received | Sender ID not approved for the recipient number | MSG91 → Logs |
| SMS arrives but OTP doesn't verify | Template placeholder mismatch | Compare DLT template to what Supabase sends |
| "SMS provider error" toast in app | Auth Key wrong, or hook URL not reachable | Supabase → Logs → Auth |
| Two OTPs arrive | Old provider still wired in parallel | Supabase → Authentication → Providers (turn off old one) |

---

## Part 2 — Razorpay live mode

### Step B1 — Get live credentials from Razorpay

1. **Razorpay Dashboard → top-right corner**. There's a switch that says **Test Mode** today. Toggle to **Live Mode**. (Most accounts need you to complete KYC + activation before this toggle works.)
2. **Settings (left sidebar) → API Keys**.
3. Click **Generate Live Key** (button name varies). You'll see one and only one chance to view both halves:
   - **Key ID** — looks like `rzp_live_XXXXXXXXXXXXXX`. Starts with `rzp_live_` (vs. `rzp_test_` today). **This is safe to put in the app.**
   - **Key Secret** — long random string. **Treat like a password.** Save to a password manager immediately; Razorpay shows it only once.
4. **Settings → Webhooks → Add new webhook** (or edit the existing one if one's already configured for test):
   - **URL:** `https://wcvqxzqqwcxlcgrjyunf.supabase.co/functions/v1/verify-payment`
   - **Active events** — tick these three:
     - `payment.captured`
     - `payment.failed`
     - `order.paid`
   - **Secret** — Razorpay shows a "Webhook Secret" field. Either generate a new random one here (paste into a password manager) or paste in one you've chosen. **Save this — you'll need it in Step B2.**
   - **Save**.

Now you have three live values: `key_id`, `key_secret`, `webhook_secret`.

### Step B2 — Update Supabase Edge Function secrets (no rebuild)

This is the safe-to-do-immediately part. Doing this means the **server is now ready** to talk to live Razorpay — but since the app is still using the test `key_id`, nothing changes in user-facing behavior until Step B4.

1. **Supabase Dashboard → Edge Functions → Manage secrets** (sometimes labeled "Project Settings → Edge Functions" → "Secrets" tab).
2. You'll see existing secrets. Look for these three (they'll currently hold test values):
   - `RAZORPAY_KEY_ID` — update to `rzp_live_XXXXXXXXXXXXXX` (the new live one). This is used by the *server* — separate from the app's copy.
   - `RAZORPAY_KEY_SECRET` — update to the live secret.
   - `RAZORPAY_WEBHOOK_SECRET` — update to the live webhook secret you set in Razorpay.
3. **Save**.

Edge Functions pick up the new values on their next invocation (no deploy, no restart). Verify by hitting any payment flow on the AAB still using the test key — the call will FAIL with a key-mismatch error (because the app is sending a test order to a server now configured for live mode). This is **expected** and tells you Step B2 took effect. Don't panic — proceed to B4.

### Step B3 — Update Razorpay's webhook secret reference

Already done in Step B1 if you set the webhook on the Live tab of Razorpay. Just verify: Razorpay → Webhooks → the entry pointing at our `verify-payment` URL → confirm it shows **Live** (not Test), and the signing secret matches what's in Supabase from B2.

### Step B4 — Update the app's publishable key + rebuild

This is the only step that touches a file in the repo and requires a rebuild.

**Edit `eas.json`** — find the production env block (around line 30-ish) and change one line:

```diff
  "EXPO_PUBLIC_SUPABASE_URL": "...",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY": "...",
- "EXPO_PUBLIC_RAZORPAY_KEY_ID": "rzp_test_SaAGRu9UhPaeqz",
+ "EXPO_PUBLIC_RAZORPAY_KEY_ID": "rzp_live_XXXXXXXXXXXXXX",
  "EXPO_PUBLIC_GOOGLE_MAPS_KEY": "..."
```

Then in terminal:

```
eas build --platform android --profile production
```

Wait ~20 min for the build. When green:

```
eas submit --platform android --latest
```

Open Play Console → Internal Testing → wait for the new version to roll out to tester phones (usually 10-30 min). On the tester phones, reinstall / update, sign in, and you're live.

### Step B5 — Verification (do all of these on a tester phone before going public)

| Check | Expected |
|---|---|
| **Open the app, place a small one-off order, pick Razorpay** | Razorpay checkout opens. Phone shows the real Razorpay sheet (not the sandbox watermarked one). |
| **Pay with a real card / UPI** | Charge goes through; order shows Confirmed in app within ~5 sec. |
| **Check Razorpay Dashboard → Payments → Live tab** | Your test payment appears, marked `captured`. |
| **Check Razorpay Dashboard → Webhooks → the verify-payment entry → Deliveries tab** | Most recent delivery is **200 OK**. If it's failed, webhook secret in Supabase doesn't match Razorpay's. |
| **In the app, "My Orders" → tap the order → shows Confirmed status with correct total** | Yes. |
| **Try a wallet top-up of ₹100** | Razorpay sheet → pay → wallet balance increases by 100. |
| **Subscription buy** (if you have a sub plan ready) | `user_subscriptions.is_active` flips to true after payment. (Regression for AC-02 — verify on real money.) |

If any of these fail, **don't open the app to public customers**. The most likely cause is a webhook secret mismatch between Razorpay Dashboard and the `RAZORPAY_WEBHOOK_SECRET` Supabase secret.

---

## Rollback plan

If something goes badly wrong on launch day:

### MSG91 rollback

- **Supabase Dashboard → Authentication → Providers → Phone** → switch SMS provider back to the previous setting (or disable phone provider temporarily).
- If using Path B (hook), disable the Send SMS Hook in **Authentication → Hooks**.

OTP delivery falls back to whatever was working before.

### Razorpay rollback

- **Quickest (server-side, no rebuild):** In **Supabase Dashboard → Edge Functions → Manage secrets**, change the three values back to test:
  - `RAZORPAY_KEY_ID` → `rzp_test_SaAGRu9UhPaeqz`
  - `RAZORPAY_KEY_SECRET` → test secret (from your password manager)
  - `RAZORPAY_WEBHOOK_SECRET` → test webhook secret
- The app is now sending live `key_id` to a server configured for test — payments will fail with a key-mismatch. **This means rollback is partial** — you also need a test-key AAB on phones, which is yesterday's build (versionCode 13) on the Play Internal Testing track. You can re-promote that build from the Internal Testing → Releases tab → "Promote release" → pick the older build.
- **Slowest but cleanest:** revert `eas.json`, rebuild, redistribute. ~40 min.

The point of doing B1 → B2 → B4 in order (and not B4 first) is that until you do B4, the rollback is just "change Supabase secrets back" — no rebuild needed.

---

## After launch checklist (do once you've gone live and verified)

- [ ] Save Razorpay live `key_id`, `key_secret`, and `webhook_secret` to your password manager (1Password / Bitwarden / whatever you use). Do **not** keep them in a text file or email.
- [ ] Save MSG91 Auth Key + Template ID + Sender ID to the same password manager.
- [ ] Update `docs/STATUS.md` → note the live values are in place and what date the cutover happened.
- [ ] Remove the test Razorpay webhook from Razorpay's dashboard once you've confirmed live is working for ~24 hours (clean separation).
- [ ] In MSG91 dashboard, check the **Logs** section daily for the first week — failed SMS deliveries (wrong template, blocked numbers, DLT compliance issues) show up here.

---

## What this doc deliberately does NOT cover

- **App-side admin form for managing these credentials at runtime.** Considered, decided against — Supabase Dashboard already does this, and adding an in-app form would mean hot-path DB reads + bigger secret-leak surface. Documented decision in session conversation on 2026-05-13.
- **iOS submission.** This doc covers Android only. iOS would add another rebuild for the same `key_id` change + Apple App Store internal testing distribution.
- **Test customer migration.** Before going live, the test data on prod (the 5 sample orders, persona phones, etc.) should be cleared. Use `supabase/sql/seed_reset_test_data.sql` for this — but **only after** you've verified live mode works end-to-end on a tester phone.
