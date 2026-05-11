# Tier 1 Audit — Flow 2: Subscription Lifecycle

> Date: 2026-05-11. Method: read-only code + prod DB cross-check. Status: complete. One **design-call** finding (F2.1); rest deferred pending its outcome. No code changes made.

## Scope read

**SQL:** `admin_cancel_subscription_atomic_rpc.sql`. `generate_daily_manifest.sql` already covered in Flow 0.

**Edge functions:** `subscription-expiry-push`. `place-order` (subscription branch) + `confirm-order` + `verify-payment` (sub-activation branch) already covered in Flow 1.

**Hooks:** `useSubscriptions` (8 hooks).

**Screens:** `SubscriptionDetailScreen`, `AdminSubscriptionsScreen`, `CreatePlanScreen` (plan_type write site only).

**Live prod probes:**
- `user_subscriptions`: 5 total, 4 active, 0 paused, 0 cancelled-yet-active-row, 1 inactive.
- `cancelled_subscription_days`: 0 rows. Never exercised.
- `subscription_plans.plan_type`: 'food' (7 plans), 'essentials' (4 plans).
- One active essentials sub (id=39, "Newspaper 30 Days", start 2026-05-07, duration 30, days_consumed=2 after today's auto + manual runs).

## Verdict matrix (spec vs implementation)

| Spec line | Implementation | Match |
|---|---|---|
| Subscription buy through place-order | `place-order:228-313` validates plan, conflict-checks, inserts `user_subscriptions` row | ✓ (Flow 1) |
| Wallet path activates immediately | `place-order:438` sets `is_active = payment_method === 'wallet'` | ✓ (Flow 1) |
| Razorpay app path activates on confirm | `confirm-order:139-153` activates by `razorpay_order_id` | ✓ (Flow 1) |
| Razorpay webhook path activates | `verify-payment:165-202` activates by `razorpay_order_id` (separate branch from order-status update) | ✓ (Flow 1) |
| Daily dispatch generation | `generate_daily_manifest` per-cycle, keyed on active+unpaused subs | ✓ (Flow 0) |
| Customer skip individual day | `cancelled_subscription_days` insert; cron skips that date | ✓ |
| Customer pause | `is_paused=true`; cron WHERE filter excludes paused subs | ✓ |
| **Pause/skip extends duration — all paid meals eventually delivered** (CLAUDE.md D-01) | **Calendar-window enforcement** — `v_day_number > duration_days → skip` (`generate_daily_manifest.sql:80-84`) | **✗ — see F2.1** |
| Admin cancel atomic | `admin_cancel_subscription_atomic` deactivates + credits wallet in one transaction (BF-20) | ✓ |
| Refund always to wallet regardless of original payment method (D-01) | RPC body unconditionally calls `increment_wallet_balance` | ✓ |
| Refund prorated, includes tax + delivery slice (BF-21) | `AdminSubscriptionsScreen.tsx:72-77` math correct | ✓ |
| Admin can edit refund amount before confirm | Modal text input, RPC accepts arbitrary `p_refund_amount` | ✓ |
| Auto-deactivate when complete | `generate_daily_manifest.sql:182-188` flips `is_active=false` when `days_consumed+1 >= duration_days` | ✓ |
| Expiry notification (D-2, D-1, starts-tomorrow) | `subscription-expiry-push` covers all three | ✓ (with caveat — see F2.3) |

## Findings

### F2.1 — Pause / skip lose paid deliveries (design-call, not a code bug)

**Spec (CLAUDE.md operational notes, D-01):**
> Subscription billing model: customer pays full plan price upfront … no daily debits afterward. Plan price is all-inclusive. **Pause/skip on subscriptions extends duration — paid meals eventually all get delivered.**

**Reality:**

`generate_daily_manifest.sql:80-84`:
```sql
v_day_number := (p_target_date - v_sub.start_date) + 1;
IF v_day_number < 1 OR v_day_number > v_plan.duration_days THEN
  v_subs_skipped := v_subs_skipped + 1;
  CONTINUE;
END IF;
```

Generation is gated by **calendar position from start_date**, not by `days_consumed`. Pause/skip don't extend the effective end date. Consequences:

- **Pause:** while paused, the outer loop skips entirely (`WHERE is_paused = FALSE`). Days advance. Once unpaused, only the calendar days remaining inside `[start_date, start_date + duration_days)` will dispatch. The paused calendar days are lost forever.
- **Skip:** day skipped doesn't increment `days_consumed`, but calendar advances regardless. Customer ends `duration_days` calendar days after start with `days_consumed` slightly below `duration_days`. Skipped meals never get redelivered.
- **Cron outage:** same effect as a pause. Sub 39 today demonstrates this: start 2026-05-07, but cron was silent 5/7-5/10 (DB free-tier pause). Sub will deliver until 2026-06-05 (start+30). Customer paid for 30 deliveries, will receive ~26 (4 lost during the silent days). No automatic catch-up.

**Customer UI silently overstates:**

`SubscriptionDetailScreen.tsx:111`:
```ts
const daysRemaining = plan.duration_days - sub.days_consumed;
```

Displayed as the "remaining" stat (line 146). If pause/skip ate any calendar days, this overcounts. Sub 39 today shows "remaining: 28" — actual future deliveries will be 25.

**Today in prod:**
- 0 paused subs, 0 skip-day entries → the **customer-action** path has never been exercised.
- But the **cron-outage** path has, in the last 5 days. Sub 39 currently sits in the lossy state.

**Two paths forward (design call):**

| Option | Description | Cost |
|---|---|---|
| **(a) Implement spec — extend duration** | Generation gated by `days_consumed < duration_days`, NOT calendar window. Add `effective_end_date` tracking or recompute on each tick. Cron-outage days auto-roll into future days. | Larger — touches `generate_daily_manifest`, `subscription-expiry-push`, `SubscriptionDetailScreen` end-date display, admin proration math. Multi-file change. Probably 1 session. |
| **(b) Adopt current behavior — update spec + UI** | Tighten CLAUDE.md D-01 wording to "fixed 30-day window from start; pause/skip available but reduce delivered meals." Adjust UI labels: "remaining" → "left in window," add explanatory hint on pause confirmation. | Small — doc + 1-2 string changes. No DB / SQL touch. |

**Status:** flagging, waiting for your call. Both downstream findings (F2.3, F2.4) depend on this.

### F2.2 — `useAdminSubscriptions` shows only active subs

- `useSubscriptions.ts:151` filters `is_active=true`. Cancelled / expired / awaiting-payment subs invisible to admin from the screen.
- Mitigation: admin can use SQL for historical lookup, but no in-app audit trail.
- **Status:** defer — post-launch UI evolution. Not a launch blocker.

### F2.3 — `subscription-expiry-push` skips paused subs

- `subscription-expiry-push/index.ts:63` filters `is_paused=false`. A paused customer whose calendar window is closing gets no heads-up.
- Combined with F2.1: a paused customer can silently lose the rest of their sub.
- **Status:** defer pending F2.1. Option (a) makes this auto-resolve (paused subs would have a moving end date). Option (b) needs a "your paused sub still ends on date X" notification.

### F2.4 — Admin proration ignores calendar-window cap

- Formula refunds `(allInclusive / duration_days) * (duration_days - days_consumed)`.
- If pause/skip/cron-outage has eaten calendar days that days_consumed doesn't reflect, refund overshoots the deliveries that *would* have occurred. Customer comes out marginally ahead.
- Admin can manually edit refund in the modal — so practical impact is bounded.
- **Status:** defer pending F2.1. Option (a) eliminates the discrepancy. Option (b) makes the proration formula needs adjustment to use calendar-remaining-days.

## Closed clean (no action)

- `admin_cancel_subscription_atomic` — row lock, admin gating, idempotent against already-inactive, atomic deactivate + wallet credit.
- `usePauseSubscription` — owner check + `is_active=true` guard at the DB layer (would prevent pausing an inactive sub).
- `useSkipDay` / `useUndoSkip` — straightforward inserts/deletes; cancelled_subscription_days has cycle_id for cross-cycle audit.
- Plan creation writes `plan_type='food'`/`'essentials'` consistently (CreatePlanScreen.tsx:108). BF-31's normalization at the generation site is the right fix point.
- One-plan-per-cart invariant + core-items date-range conflict check (`place-order:248-299`) — sound.

## Tier 2 (post-audit Jest backfill) targets surfaced

1. `admin_cancel_subscription_atomic` rollback when wallet credit fails mid-transaction.
2. `admin_cancel_subscription_atomic` rejects non-admin callers (is_admin() gate).
3. Customer pause / unpause / skip / unskip happy paths.
4. `subscription-expiry-push` correctly buckets 1-day, 2-day, starts-tomorrow.
5. `place-order` subscription core-items date-range conflict (queued plans allowed; overlapping rejected).
6. Auto-deactivation when `days_consumed >= duration_days`.

## Action requested

**F2.1 needs your call before we proceed.** No fixes shipped today. Once you pick (a) or (b), F2.3 / F2.4 fold in.

Suggested decision criteria:
- If the company has made any **verbal promise to customers** that "you'll always get all 30 meals, just maybe delayed" → spec is canonical → option (a). Implement it as a separate flow-2 follow-up commit, probably a 1-session change.
- If the **actual operational reality** is that you reset paused customers via support tickets when this comes up → current behavior is canonical → option (b). Doc + label fix, 15 minutes.

I lean toward option (b) for launch (cleaner contract with customers — they see the window upfront), then option (a) as a post-launch FT once you have operational data on how often customers pause.
