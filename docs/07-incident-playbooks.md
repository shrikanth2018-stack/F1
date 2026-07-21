# 1stOne — Incident Playbooks & Recovery

> **Provenance.** Written 2026-07-21 (health report Slice C — findings #4, #5, #15, #26). Companion to Doc 06 (Ops & Maintenance Runbook), which covers *normal* operations; this document covers **when things break**. Each playbook is Symptoms → Check → Do → Afterwards. Keep this printable and reachable from a phone — incidents don't wait for a laptop.

---

## 1. Rolling back a bad OTA update (the most important page here)

An OTA (`eas update`) reaches every phone within minutes of foregrounding (`checkAutomatically: ON_LOAD`, no cache stalling). If a bad bundle ships — especially one that crashes on startup — **do not debug forward under pressure. Roll back first.**

**Symptoms.** After an `eas update`, users report crashes on launch, a blank screen, or a broken core flow. Sentry shows a spike of new errors tagged with the latest update.

**Do — the rollback (5 minutes):**

```bash
# 1. List recent updates — identify the LAST GOOD update group
npx eas update:list --branch production --limit 5

# 2. Republish the last good group (this creates a NEW update whose
#    content is the old, good bundle — phones pick it up on next launch)
npx eas update:republish --group <LAST_GOOD_GROUP_ID>
```

No flags beyond the group id are needed; republish targets the same branch. The EAS dashboard (expo.dev → 1stOne-F1 → Updates) shows the same list with dates and messages if you prefer clicking.

**Verify.** Kill and relaunch the app twice on a test phone (first launch downloads, next launch runs it). Confirm the bad behavior is gone.

**Afterwards.** The bad commit is still in git — fix it calmly, run `npm run check`, device-test, then ship a fresh `eas update`. Note: phones that already downloaded the bad bundle but haven't relaunched will still run it once — the fix arrives on their next launch cycle.

**Limits.** OTA rollback only rolls back JS. If the bad release was a *native* build (store release), rollback means submitting the previous build to the stores — hours to days. This is why native releases get extra device-testing.

---

## 2. The external heartbeat (healthchecks.io)

**What it is.** Every 5 minutes the database pings healthchecks.io (`cron_heartbeat.sql`, job `external-heartbeat`). Healthy → normal ping. A cron failed in the last 10 min → `/fail` ping (immediate alert). The whole chain dead (pg_cron down, key rotation broke `app_config`, DB down) → **no ping**, and healthchecks.io emails you after the grace period. This is the only alert that does not depend on Supabase, Expo, or the service-role key.

**When the "check is down" email arrives:**
1. Open Supabase SQL editor → `SELECT * FROM cron.job_run_details ORDER BY runid DESC LIMIT 20;` — are jobs running? Failing?
2. If runs show `failed` with a NULL-url/auth error → the `app_config` keys are broken (see §6, key rotation). Reference fix: `fix_failing_crons.sql`.
3. If no runs at all → pg_cron or the DB itself is down → Supabase status page (§3).
4. In-app: Admin → Operations → System Health for the per-job view (if the app can reach the DB).

**When a `/fail` alert arrives:** same as step 1 — one specific job failed; `get_job_health()` names it.

**Config:** ping URL lives in `app_config.healthchecks_ping_url`. Check settings: Period 5 min, Grace 10 min. If you ever rotate/recreate the check, update the row (see the header of `cron_heartbeat.sql`).

---

## 3. Supabase outage (everything fails at once)

**Symptoms.** App-wide errors for everyone: login fails, home screen empty, staff board won't load. Heartbeat email arrives (~15 min in).

**Check.** status.supabase.com. Distinguish a real outage from a local network problem (try mobile data vs Wi-Fi).

**Do.**
- Nothing to fix on your side — wait it out. Do **not** rotate keys or redeploy functions during an outage; you'll be debugging ghosts.
- Communicate: WhatsApp the day's customers/staff if an order window is affected.

**Afterwards (the important part):**
- **Kitchen pushes self-heal**: the per-minute tick will fire any cycle whose `kitchen_push_time` passed during the outage (the dedupe is by date, and it only skips if already pushed).
- **Subscription orders self-heal**: `generate_daily_manifest` is idempotent; re-run manually for any missed date/cycle if Job Health shows a gap: `SELECT generate_daily_manifest('YYYY-MM-DD', <cycle_id>);`
- Check `manifest_run_log` + `kitchen_push_log` for the outage window; check Razorpay for payments made during the outage (§4).
- Staff offline queue drains automatically on reconnect.

---

## 4. Razorpay problems (payment stuck "Pending" / webhook backlog)

**Symptoms.** Customer paid but order shows Pending for more than a few minutes; or Razorpay dashboard shows webhook delivery failures.

**Check.**
1. Razorpay dashboard → the payment: was it actually captured?
2. Razorpay dashboard → Webhooks → delivery log for `verify-payment` — failures/backlog?
3. `push_logs` / the order row: did `confirm-order` or the webhook already resolve it?

**Do.**
- Captured but order still Pending → Razorpay dashboard → **resend the webhook event**. `verify-payment` is idempotent — resending is always safe.
- The customer's own home screen shows a pending-payment banner with view/cancel — often it resolves itself before you act.
- Payment NOT captured → nothing owed; the order stays Pending and the customer can cancel via the banner.

**Afterwards.** If webhooks were down for a stretch, resend the affected window's events from the dashboard (idempotent). Remember the standing rule: `razorpay_refund_due` amounts from cancellations are always manual dashboard refunds.

---

## 5. Expo push outage (notifications not arriving)

**Symptoms.** `push_logs` rows with error status piling up; customers not getting "Order Confirmed"; kitchen staff not getting the cutoff summary push. (Expo status: status.expo.dev.)

**Impact map — what still works:**
- **The staff batch board still flips** — it's driven by the `kitchen_push_log` insert via Realtime, not by the push itself. The kitchen loses the *notification*, not the *board*.
- Orders, payments, dispatch: all unaffected.
- The heartbeat is unaffected (healthchecks.io, not Expo).

**Do.** Tell staff to open the dashboard at cycle times (the board is authoritative). Wait out the outage — sends are logged in `push_logs`, but missed pushes are not auto-replayed; anything critical (e.g. a reconciliation alert) shows in Job Health / admin screens too.

---

## 6. Service-role key rotation (the 3-store checklist)

The key lives in **three places**; missing one breaks crons or functions (it has happened — `fix_failing_crons.sql`). Rotate in this order:

1. Supabase dashboard → rotate the key.
2. **Function env**: dashboard → Edge Functions → secrets → update `SUPABASE_SERVICE_ROLE_KEY`.
3. **Vault**: `SELECT vault.update_secret(...)` for `service_role_key` (or recreate).
4. **app_config table**: `UPDATE app_config SET value = '<new-key>' WHERE key = 'service_role_key';`
5. Redeploy all edge functions (`supabase functions deploy <name> --no-verify-jwt` for each).
6. **Verify**: watch the next `kitchen-cutoff-push-tick` runs in `cron.job_run_details`, and confirm the heartbeat check stays green — a green heartbeat 10 minutes after rotation means the in-DB chain survived.

---

## 7. OTP / login failure (customers can't sign in)

**Symptoms.** New logins fail at the OTP step; existing sessions keep working (tokens refresh independently of SMS).

**Check.** Supabase dashboard → Authentication → Logs; then the SMS provider configured under Authentication → Providers → Phone.

**Do.** Usually a provider-side issue (balance, rate limit, route). Fix in the provider's dashboard. Existing users are unaffected — only new logins/onboarding stall, so severity is lower than it feels.

> ⚠ Open item: the SMS provider account and its owner are not documented anywhere in the repo. Fill in here: Provider ______ · Account owner ______ · Dashboard URL ______

---

## 8. Disaster-recovery gaps & drills (#26)

- **Android keystore** — losing it means losing the Play Store listing's update ability. Verify EAS holds it: `npx eas credentials` (Android → production → keystore should show "managed by EAS"). Optionally download a copy to a password manager. **Do this once and tick here: ☐ verified on ____-__-__**
- **Storage `assets` bucket** (logos, banners, batch PDFs) — no automated backup. Quarterly: dashboard → Storage → `assets` → download the bucket contents to local/cloud storage. Low volume, minutes of work.
- **Database** — Supabase automated backups; the restore drill is described in Doc 02 §6. Rehearse it once before real scale.
- **Secrets** — `.env` + the Razorpay/webhook secrets belong in a password manager, not only on this laptop.

---

## 9. Deploy-coupling quick reference (#16)

| Change | Rule |
|---|---|
| `place-order` contract change | Deploy function + app build **together** (old apps get "please update") |
| New SQL | Run in SQL editor **before** the OTA that uses it; append to `DEPLOY_SQL_ORDER.md` |
| Shared `_shared/*` edit | Redeploy every function that must pick it up now; others get it on next deploy |
| Native change (permission, SDK, new native dep) | Full EAS build + store submission — **never** OTA |
| Business rule | In-app (Admin) — no deploy at all |

*End of Doc 07. Normal operations: Doc 06. Owner's checklist & renewals: Doc 02.*
