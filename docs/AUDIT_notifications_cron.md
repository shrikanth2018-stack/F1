# Tier 1 Audit — Flow 7: Notifications + Cron

> Date: 2026-05-11. Method: read-only code + prod DB cross-check. Status: complete. Two actionable findings (F7.1 low-wallet-check calendar drift, F7.2 deferred — pulling F1.4 forward into this commit too). One deferred. Bulk of fan-out was already validated in Flow 4.

## Scope read

**Edge functions:** `dormant-user-check`, `low-wallet-check`. Other notification/cron paths already audited: `subscription-expiry-push` (Flow 2), `send-push` + `_shared/notifications.ts` (Flow 4), kitchen push (Flow 0 + 4), pg_cron registry (Flow 4).

**Live prod probes:**
- pg_cron jobs: 4 active (`dormant-user-check`, `kitchen-cutoff-push-tick`, `low-wallet-check`, `subscription-expiry-push`). `expire-idempotency-keys` from idempotency_keys.sql still NOT scheduled (F1.4 carry-forward).
- `notification_templates`: 15 rows, all `is_enabled=true`. Coverage: order.* (8 events), subscription.* (4 events), wallet.* (2), winback.dormant.

## Verdict matrix

| Spec | Implementation | Match |
|---|---|---|
| Notification templates admin-editable per event_key | `resolveAndSendPush` looks up by `event_key`; helper substitutes `{{vars}}` | ✓ |
| Templates have hardcoded fallbacks | Every caller passes `fallback: { title, body }`; helper uses if template missing | ✓ |
| `is_enabled=false` skips push silently | `resolveAndSendPush` early-returns with `{status:'skipped'}` | ✓ |
| Order-status pushes single-sourced (post BF-35) | Trigger dropped; app-code + edge functions are sole source | ✓ |
| Kitchen-cycle push | `push_kitchen_summary` + `trigger_kitchen_cutoff_pushes` cron | ✓ |
| Subscription expiry: 2-day, 1-day, starts-tomorrow | `subscription-expiry-push` covers all three | ✓ (post BF-33 days_consumed-based) |
| Low-wallet warning before sub renewal | `low-wallet-check` fires when daysLeft ∈ {1,2} AND balance < threshold | **uses calendar daysLeft (F7.1)** |
| Dormant user win-back weekly | `dormant-user-check` filters customers with no orders in last N days | partial — F7.2 |
| Idempotency keys cleanup (F1.4 carry-forward) | SQL file schedules an hourly cron; NOT actually scheduled in prod | F7.3 (was F1.4) |
| All scheduled functions accept service-role only | `auth.replace('Bearer ', '') === SUPABASE_SERVICE_ROLE_KEY` check at entry | ✓ |
| Push token registration writes `push_notification_tokens` row | Not exercised — 0 rows in prod (token registration belongs to Flow 8) | F4.2 → Flow 8 |

## Findings

### F7.1 — `low-wallet-check` uses calendar-based daysLeft (same drift as pre-BF-33 expiry push)

**Where:** `supabase/functions/low-wallet-check/index.ts:63-74`.

```ts
const endMs = new Date(sub.start_date + 'T00:00:00Z').getTime() + plan.duration_days * 86_400_000;
const daysLeft = Math.round((endMs - todayMs) / 86_400_000);
if (daysLeft === 1 || daysLeft === 2) {
  candidates.push(...);
}
```

Same shape as the `subscription-expiry-push` code that BF-33 fixed. After F2.1 option (a), subscription end is `days_consumed`-driven, NOT calendar-driven. `low-wallet-check` still uses calendar-end → warns at the wrong time for any sub that has lost calendar days to pause/skip/cron-outage.

**Today's impact:** sub 39 (Newspaper 30 Days) currently sits at `days_consumed=2` after the 5-day DB pause. Its effective end is when days_consumed reaches 30 (~2026-06-08 at one delivery per day). Calendar end is 2026-06-05 (start + 30). low-wallet-check would warn on 2026-06-03 — three days before actual end. Customer might top up needlessly OR miss the actual end window.

**Fix:** mirror BF-33 — add `days_consumed` to the select, compute `daysLeft = duration_days - days_consumed`.

**Status:** action proposed (BF-36a).

### F7.2 — `dormant-user-check` doesn't honor the "won't double-send" promise

**Where:** `supabase/functions/dormant-user-check/index.ts:9-11`.

Function header comment says:
> Does not double-send: skips anyone who already received a dormant push in the last `{winback_inactive_days}` days (tracked via push_logs or analogous, else just fires weekly which is acceptable cadence).

But the body doesn't check `push_logs` at all. Customers who stay dormant for 30+ days receive a "We've missed you" push every Monday — 4+ pushes per month with the same copy. Marginal irritation, not damage.

**Status:** defer. Fix scope: add a SELECT against `push_logs WHERE trigger_source = 'winback' AND sent_at > NOW() - INTERVAL 'X days'` before fanning out. ~10 lines of code. Post-launch FT.

### F7.3 (was F1.4) — `expire-idempotency-keys` cron still not scheduled

`idempotency_keys.sql:17-21` schedules hourly cleanup; `SELECT * FROM cron.job WHERE jobname='expire-idempotency-keys'` returns nothing. Currently 27 rows, oldest 19 days. Will grow linearly.

**Fix:** one-line SQL (run the `cron.schedule(...)` block once via SQL editor or `supabase db query`). Pulling this forward into the Flow 7 commit since it's literally one line and matches the long-term-stability bias (do durable cleanup now, not later).

**Status:** action proposed (BF-36b).

## Closed clean (no action)

- `send-push` template resolution + fallback (Flow 4).
- `resolveAndSendPush` helper (Flow 4).
- `subscription-expiry-push` (Flow 2 + BF-33).
- Kitchen cutoff push (Flow 0).
- pg_cron job registration for all 4 scheduled functions.
- Service-role-only entry guards on scheduled functions.
- 15 notification_templates seeded and enabled.
- Branch-agnostic scheduled functions (intentional per MF-03 audit — pushes target individual user_ids, branch is implicit).

## Tier 2 (post-audit Jest backfill) targets

1. `resolveAndSendPush` skips when template `is_enabled=false`.
2. `resolveAndSendPush` substitutes `{{vars}}` with `_` for missing keys.
3. `low-wallet-check` post-fix: candidates filtered by `days_consumed`-based daysLeft, not calendar.
4. `dormant-user-check`: doesn't re-push to same user within `winback_inactive_days` window (post F7.2 fix).
5. `expire-idempotency-keys` cron actually runs and removes >24h-old keys.
