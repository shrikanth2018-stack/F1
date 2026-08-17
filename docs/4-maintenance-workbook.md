# 1stOne — Maintenance Workbook

How to keep it running, change it safely, and find out what is wrong.
Current as of 8 August 2026.

---

## Where to look first when something is wrong

**Admin → Operations → Job Health.** This one screen shows every background job,
when it last ran, whether it failed, and how many failures there were in the
last 24 hours. It also shows the last 7 daily-dispatch runs and a 24-hour
breakdown of notifications sent, failed and rejected.

The same screen has two self-test buttons:

- **Crash Reporting → "Send a test event."** Fires one tagged event to Sentry.
  It answers two questions at once: does an event arrive, and does its stack
  trace name a real file rather than `index.android.bundle:1:428931`. **Ask
  again after every new app build** — the source-map upload does not fail a
  build when it breaks. It returns "Nothing was sent" in a development build or
  with no DSN, on purpose.
- **Analytics** — says whether it is live, why not, and which region it points
  at.

### The silent-failure trap

Four things here have been "configured but silent" before: Sentry, PostHog,
source maps, and the kitchen batch push. They share a shape — **when they break,
the symptom is silence, which looks exactly like working perfectly.** That is
why the two self-tests exist. Use them rather than assuming.

To answer "is Sentry connected?", look at **Releases**, not Issues. The Issues
page shows a setup wizard whenever there are no errors, which reads like "never
received anything" and is not.

---

## Health checks after any database change

```bash
supabase db query --linked --file supabase/tests/platform_health_check.sql
supabase db query --linked --file supabase/tests/subscription_flow_check.sql
```

**Both end in an error on purpose** — that error is what rolls the test back so
nothing is left behind. **Read the report, not the exit code.**

There are two more files, `seed_360.sql` and `teardown_360.sql`, which commit
real rows so a walkthrough can be seen on screen. If you use them, check the
teardown by comparing against a before-snapshot — a teardown that reports
success is not proof it worked.

---

## Routine checks

| How often | What | Where |
|---|---|---|
| Daily | Any red background job | Job Health |
| Daily | Notifications failing (`failed` or `invalid_token` climbing) | Job Health |
| Weekly | Dispatch runs creating the expected number of orders | Job Health → manifest |
| After every app build | Sentry test event shows a real filename | Job Health |
| Monthly | Hub commission claims and vendor payouts settled | Expense Manager |
| Monthly | Attendance corrections cleared before month end | Resource Manager |

The system also pings **healthchecks.io** every 5 minutes, and pings a *failure*
URL if any job failed in the last 10 minutes. If that ping stops arriving, the
database itself is not running its jobs — that is the loudest alarm you have.

---

## Making a change

### JavaScript-only change (screens, logic, text)

1. `npm run check` — must pass (47 suites, 641 tests).
2. Commit and push. GitHub Actions runs the same gate.
3. `eas update --channel production`
4. Push to `main` — this also deploys the website via Cloudflare.

Customers get it on next app launch. **Web ships with every release** — an OTA
without a `git push` leaves the website behind.

### Change to an edge function

`eas update` does **not** ship `supabase/functions/`. Before any release, check
whether a function changed since the last release:

```bash
git diff --name-only <last-released-sha>..HEAD -- supabase/functions/
```

Anything listed must be deployed by hand:

```bash
supabase functions deploy <name> --no-verify-jwt
```

### Change needing a new app binary

Check whether one is actually needed:

```bash
git diff --stat <last-released-sha>..HEAD -- package.json app.config.js android/ ios/ patches/ eas.json
```

Empty means an over-the-air update is enough. Otherwise:

```bash
eas build --profile production --platform android
```

### Database change

1. Write the change as a new file in `supabase/sql/`, written so it can be run
   twice safely.
2. **Check what is actually deployed first.** `supabase/schema/live_schema.sql`
   is a dump of production. Twenty-five functions are defined in more than one
   file in `supabase/sql/`, and whichever ran last silently won — so the file
   you are about to edit may not be the version that is live.
3. **Dry-run it inside `BEGIN … ROLLBACK` first.** There is only one database —
   there is no staging, so this is the safety net. Note that a rollback does
   **not** undo a sequence advance: `nextval()` is not transactional, so
   dry-running anything that mints an id burns numbers. Note `last_value`
   first and `setval` it back before the real run.
4. Apply it.
5. Record it in `supabase/sql/DEPLOY_SQL_ORDER.md`.
6. **`npm run schema:snapshot`, and commit `supabase/schema/` with the SQL.**
   Same pairing rule as an OTA and a `git push` — a snapshot that lags is worse
   than none, because it looks authoritative. `npm run schema:check` tells you
   whether they agree.
7. `npm run supabase:gen-types`
8. Run both health checks above.

---

## Before anything a customer can reach

Two halves, and neither proves the other:

**Server.** Run the real database functions as the **real roles** — set both the
token claims *and* the role — inside `BEGIN … ROLLBACK`. Not "delete
afterwards": a half-failed run leaves rows in production, a rollback cannot, and
it also discards queued notifications so a test cannot alert real admins.

**Screen.** Actually open it, on a device or on the web. SQL cannot see a
screen.

**Two traps, both real:**

1. **Never check a security rule as a superuser.** A superuser bypasses
   row-level security entirely and will happily confirm a rule that denies
   everybody. Impersonate the actual user.
2. **Make sure the subject could pass.** A customer with no address sees zero
   vendor items whether or not the rule works.

**Verifying a web deploy: check the code, not the content type.** A stale bundle
is still perfectly valid JavaScript, so waiting for the right content type
passes instantly against the *previous* build. Grep the served bundle for a
string unique to your change, and allow about 10 minutes.

---

## If something breaks

**Payments not confirming.** Check the Razorpay dashboard webhook is pointed at
`https://wcvqxzqqwcxlcgrjyunf.supabase.co/functions/v1/verify-payment` with
events `payment.captured`, `payment.failed`, `order.paid` **and
`payment_link.paid`**. The last one is easy to miss and without it back-office
orders never mark as paid. Check `RAZORPAY_WEBHOOK_SECRET` is still set — the
function refuses to run without it.

**Kitchen never got the batch.** Job Health shows the kitchen-push job. A batch
is only marked done once it is actually sent; an unsent one is retried until the
delivery window opens, and an alert fires 45 minutes before delivery. Check the
delivery time is still marked active and its cutoff has actually passed.

**Staff board is empty.** Normal before the first push of the day. If it is
empty after a cutoff, check Job Health.

**Nobody can see a vendor's items.** Almost always the vendor has no zone or hub
granted. Check the vendor's page in Admin → Vendors. Also check they are
`approved` and their items are `approved` and switched on.

**A customer says an order vanished.** The staff board shows one batch at a time
plus anything overdue. An order for a later delivery time is not lost, just not
due yet.

**A wallet refund failed.** The cancellation still went through. The office gets
a notification with a reference; reconcile by hand from the Wallet screen.

**Web works on the phone but not the browser.** Check the browser console for a
cross-origin error. The allowed list lives in
`supabase/functions/_shared/cors.ts` and adding a new address means editing that
file and **redeploying every function**.

---

## Rotating the service-role key

It lives in **three** places. All three must be updated together:

1. Supabase function secrets (`SUPABASE_SERVICE_ROLE_KEY`)
2. The `app_config` table, key `service_role_key` — this is what the scheduled
   database jobs read
3. Supabase Vault

`send-push` accepts the `app_config` value as valid, so a mismatch causes a
partial failure rather than a clean one.

---

## Known limits, stated plainly

- **One environment.** Development, preview and production all use the same
  Supabase project. Every schema change is a production change.
- **No migration runner.** The 137 SQL files are applied by hand in the order
  recorded in `DEPLOY_SQL_ORDER.md`.
- **Rate limiting counts successes only**, so repeated failures are not
  throttled.
- **No hub has a commission percentage set**, so no hub operator can raise a
  commission claim. Set it on the hub's page to enable it.
- **A vendor payout claims their entire wallet balance**, including money they
  topped up as a customer. Only matters once a vendor also shops on the app.
- **Two hubs have an operator link that grants nothing** — permission comes from
  the person's profile, not the hub record.
- **iOS has never had a production build.** That is not a config tweak; it is
  developer account, first build, TestFlight and review.
- **Automated tests cover logic, not screens.** 641 tests cover the utilities,
  hooks and server modules, plus 5 screens. The other ~120 screen files have no
  automated test — they have been walked by hand instead.

  **Two real defects on 13 Aug got through a fully green gate**: a completed
  admin wizard that would not close, and a cancelled order that stayed on the
  Undelivered tab. Neither was reachable by any test in the suite — one needed
  a navigation event, the other a stale cache. When the gate is green and the
  change touched a screen, that is the beginning of testing, not the end.

---

## Before going live for real

1. Swap the Razorpay test key for the live key in `eas.json` (all profiles),
   swap `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` in the Supabase
   function secrets, and update the webhook in the Razorpay dashboard.
   **Half-live fails every payment outright.**
2. Build and ship a new Android binary — the key is baked in at build time, so
   an over-the-air update cannot change it.
3. Set a commission percentage on each hub if operators are to be paid.
4. Add a PostHog key (and set the region host) if you want analytics.
5. Decide whether iOS is in scope; if so, start that track.
