# 1stOne F1 — Decisions & Cleanup Log

> Running record of decisions made about the codebase during planning sessions. Each entry: what, why, when decided, status. Source of truth for "why does the app work this way" going forward.

---

## Source documents in priority order

1. **Live code** in `~/Documents/F1/1stOne-F1/`
2. **Live deployed state** of Supabase (cron.job query, function logs, function list)
3. **Master Document v1.0 (26 April 2026)** — `1stOne_F1_Master_Document.docx` — comprehensive operational + architectural reference, written by Shrikanth. Includes Annexure A operational runbook. **This is the canonical product/business reference. Code wins over doc only when explicitly confirmed via live evidence.**
4. **Phase 1 audit output** — `PHASE1_OUTPUT.md` — code-level findings as of 2026-05-02
5. **SYSTEM_FLOWS.md** — code trace as of 2026-04-23, subscription section materially outdated
6. Older audits & blueprints — historical context only

## Master document highlights (added 2026-05-02)

- **Three-surface architecture confirmed:** mobile app (primary), `1stone.in` static landing page on Cloudflare Pages, `app.1stone.in` web app via React Native Web. Web build deliberately blocks Razorpay flows ("Mobile App Required" message) — by design.
- **Customer home screen has two tabs: Meal and Essentials.** Each tab contains the active cycles' menus. Subscriptions are a separate flow accessed via the Plans screen, with a one-plan-in-cart invariant.
- **Pause/skip on subscriptions extends duration** — they do not consume subscription days. Every paid meal eventually gets delivered.
- **Server-side authority for money** is the design rule: prices, delivery method, delivery fee all derived server-side; client cannot tamper.
- **Wallet atomicity** via single SQL call ("if balance ≥ X, deduct X" atomically).
- **Idempotency keys** required on all payment endpoints; same table doubles as a 5/60s rate limiter.
- **Storm mode** is a dual-control kill switch (store_config column + feature_flags row, either true → orders rejected).
- **Notification templates** are admin-editable per event_key with `{{variable}}` substitution; missing template falls back to hardcoded default.
- **Branch filtering** via JWT `branch_id` claim + RLS policies (RLS currently disabled in dev per Phase 1; doc assumes it's active).
- **`staff_leaves` (plural) is the correct table name** — confirms the `staff_leave` in `rls_policies.sql` is a typo.
- **Service-role key was rotated;** the key sitting in `deploy.sh` is the old, already-revoked one (per doc §9.4). Security risk is therefore low; cleanup is hygiene only.
- **Sentry is on a 14-day Business trial** — must switch to free Developer plan before trial ends to avoid charge.
- **MSG91 SMS migration is pending** — currently using Supabase's default OTP provider.
- **22 known transitive npm vulnerabilities** are intentionally deferred to next Expo SDK major upgrade.

## Doc-vs-reality conflicts to track

| Doc claim | Reality (per Phase 1 + live evidence) | Action |
|---|---|---|
| "subscribe and confirm-subscription deleted from repo and Supabase" (§9.10) | `subscribe/` still on disk in repo; confirmed NOT deployed in Supabase | Sprint 2 — delete from repo to align with doc (CL-01) |
| "verify-payment webhook activates subscriptions" (§4) | **Confirmed working 2026-05-02 by Shrikanth's live subscription-payment test.** Verify-payment fired and activated the subscription as expected. Earlier observation that Order 328 didn't show webhook invocations is best explained by client-side `confirm-order` winning the race for one-off orders (idempotent design — whichever fires first wins). For subscriptions, webhook appears to be the typical activator. **No conflict with doc — webhook is configured and active.** | None. D-02 is moot — webhook safety net already in place. `razorpay-webhook` (different function, never called) remains the only deletion candidate. |
| "11 edge functions" (§4 text) — note: doc's own table lists 12 | 14 deployed; only 2 are extras vs the doc's table: `confirm-order-payment` and `razorpay-webhook`. The doc's text count of "11" is a self-inconsistency to fix in next doc update. | Sprint 2 — delete those 2 functions (CL-03, CL-04). Doc text update: change "11" to "12". |
| "RLS policies enforcing scope on every writeable table" (§5) | RLS disabled in dev (`rls_policies.sql:5`) | Sprint 2 — fix `staff_leave` typo, then carefully enable RLS (doc describes production-ready state). |

## Cancellation refund policies (clarified by Shrikanth, 2026-05-02)

### One-off order cancellation
- Customer-initiated within configured time window via app (handled by `cancel-order` Edge Function).
- **Wallet portion:** refunded automatically by the function (`increment_wallet_balance` RPC).
- **Razorpay portion:** requires **manual admin action** through Razorpay dashboard (per doc §A.3.4). Customer is informed via the response payload.
- Admin can also cancel an order on customer's behalf if the window has expired — same refund mechanics apply.

### Subscription cancellation (admin-initiated)
- **Refund always goes to wallet, regardless of original payment method.** Even if the customer originally paid via Razorpay, the prorated remaining amount is credited to their wallet (store credit), not refunded back to the card.
- Rationale: keeps customer engaged, simpler ops, no Razorpay refund flow needed.
- UI flow per Shrikanth: admin clicks cancel → system calculates prorated refund (`(remaining_days / total_days) × plan_price`) → displays to admin → admin can edit for any reason (goodwill, dispute, etc.) → on confirm, amount credited to wallet, subscription deactivated.
- Implementation status: needs V-01 verification — Phase 1's grep-level reading suggested only deactivation happens with no refund logic, but that reading was shallow and the feature very likely exists.

## Production state — confirmed 2026-05-02

**Scheduled jobs in `cron.job` (verified by SQL query against live Supabase):**
- `kitchen-cutoff-push-tick` — every minute. Per-cycle order generation. **This is the canonical path.**
- `generate-daily-manifest` — daily at 17:30 UTC = 23:00 IST. Nightly safety-net batch for tomorrow's orders.
- `dormant-user-check` — Mondays 04:30 UTC. Notification only. Unrelated to orders.
- `low-wallet-check` — daily 04:00 UTC. Notification only.
- `subscription-expiry-push` — daily 03:30 UTC. Notification only.

**Edge Functions deployed (verified in Supabase dashboard):**
- apply-referral, cancel-order, confirm-order, confirm-order-payment, confirm-topup, dormant-user-check, elevate-employee, low-wallet-check, place-order, razorpay-webhook, send-push, subscription-expiry-push, verify-payment, wallet-topup

**Confirmed NOT deployed** (existed in code repo only):
- `subscription-cron` — Phase 1's "third path" concern is moot.
- `subscribe` — Phase 1's "dangerous legacy subscription function" is moot.

---

## Architecture context — clarifications from Shrikanth

### AC-01: Three separate carts, not one bundled cart
- **Per Shrikanth (2026-05-02):** Customers have **three separate carts** in the UI — food, essentials, and subscriptions — each with its own checkout. All three accept the same two payment methods (wallet, Razorpay).
- **Why captured:** Phase 1 described `place-order` as handling food + essentials + subscription bundles in one atomic call. Shrikanth's description suggests three separate checkout flows. Either Phase 1's bundling description is correct and the UI just *looks* like three carts (each calling `place-order` independently), or subscriptions actually go through a different endpoint.
- **To verify:** During Sprint 1 — read `CheckoutScreen.tsx`, `PlanDetailScreen.tsx`, and any essentials checkout screen to confirm exact endpoint used by each.

### AC-02: Past production bug — subscription activation gap (now resolved)
- **Per Shrikanth (2026-05-02):** There was a previous production bug where Razorpay-paid subscriptions: payment succeeded, order history showed Confirmed, but the My Subscriptions page showed "payment awaited" because the subscription row was never activated.
- **Resolution:** The current `confirm-order` function (and its stale-duplicate twin `confirm-order-payment`) explicitly activates `user_subscriptions` rows tied to the same `razorpay_order_id` immediately after marking the order Confirmed. Bug is closed.
- **Why captured:** Important history for understanding why the function exists in its current shape, and useful regression context for any future changes to the payment-confirmation flow.

---

## Cleanup queue

### CL-01: COMPLETED 2026-05-02 — `subscription-cron` and `subscribe` folders removed
- Both folders were locally present but **never tracked in git** (never on GitHub). Deletion is silent in git — folders simply removed from local working tree.
- **Side discovery:** Master Doc §9.10 was correct in the GitHub sense — these were never on GitHub. Phase 1 read them from the local-only files on Shrikanth's dev machine.
- **Followup:** `deploy.sh` still references both functions at lines 37-38, 41-42, 70 — would now fail if anyone runs it. Queued as next cleanup item.

### CL-06: COMPLETED 2026-05-02 — `staff_leaves` typo fixed in `rls_policies.sql`
- 3 occurrences of `public.staff_leave` (singular) at lines 207, 219, 220 changed to `public.staff_leaves` (plural) to match the actual schema table name.
- Phase 1's reference to "lines 207, 219-221" included line 221 which was the policy body, not a table reference — clarified during execution.
- File was previously untracked in git; will be tracked for the first time with this fix already applied.

### Cleanup batch commit — `fa6e56c` on `main`
- Pushed to GitHub `2026-05-02`. Title: *chore: cleanup pass — fix staff_leaves typo in rls_policies.sql, update CLAUDE.md counts (41 hooks, 18+5 screens, jest configured)*. Stats: 2 files changed, 325 insertions, 4 deletions. The 325 insertions reflect `rls_policies.sql` being newly tracked (it was untracked before this commit).

### CL-08: COMPLETED 2026-05-02 — `supabase/deploy.sh` deleted
- Was untracked in git (never on GitHub). Local working-tree-only deletion. No commit/push needed.
- File was already broken (referenced deleted `subscribe` and `subscription-cron` folders). Replacing it isn't necessary — `DEPLOY_SQL_ORDER.md` is the canonical deploy reference per Master Doc §10.
- Removed the last copy of revoked Razorpay test keys (rzp_test_SaAGRu9UhPaeqz et al.) from disk. Hygiene improvement.
- File content preserved in this session's transcript + `PHASE1_OUTPUT.md` if ever needed for reconstruction.

### CL-09: QUEUED — `DEPLOY_SQL_ORDER.md` minor staleness
- Surfaced 2026-05-02 by Claude Code while reading the file during CL-08.
- Still lists `subscribe` deploy at line 47 (function deleted).
- Says "6 edge functions" when current reality is 12 deployed.
- Fix in next Claude Code action.

### CL-07: COMPLETED 2026-05-02 — `CLAUDE.md` count corrections
- Hook count: 27 → 41 (Phase 1 said 39; recent commits added more).
- Customer screens: 13 → 18.
- Staff screens: 4 → 5 (bonus catch by Claude Code, not in original prompt).
- Test runner: "no test runner" → accurate description (Jest configured + 9 test files).

### CL-01 (original entry): Delete dead code for `subscription-cron` and `subscribe`

### CL-02: Decide fate of the 23:00 IST nightly backup
- **What:** After fixing the underlying `generate_daily_manifest` SQL function, decide whether to keep the 23:00 batch as a safety net or remove it.
- **Why:** Both the per-minute tick and the nightly batch share the same underlying function, so any bug in the function fires twice. A safety net is valuable, but only if the underlying logic is correct. Per Shrikanth: keep for now, revisit after function is fixed.
- **Risk:** Removing too early loses safety-net coverage for late-day subscription purchases. Keeping forever amplifies any silent failures.
- **When:** Sprint 1 (after function is fixed) — revisit decision.
- **Status:** Queued. Decision pending function fix.

### CL-03 + CL-04: COMPLETED 2026-05-02 — `confirm-order-payment` and `razorpay-webhook` Edge Functions deleted from Supabase
- Both deleted via Supabase dashboard.
- Edge Functions count went from 14 → 12, matching the master doc's table count.
- No errors observed. App still functioning.

### CL-03 (original entry): Delete stale `confirm-order-payment` Edge Function
- **What:** Remove `confirm-order-payment` from the deployed Supabase Edge Functions.
- **Why:** Investigation 2026-05-02 confirmed this function is a stale duplicate of `confirm-order`. File header literally says `Deploy: supabase functions deploy confirm-order --no-verify-jwt`. Logic matches Phase 1's documentation of `confirm-order` exactly.
- **Origin story (per Shrikanth, 2026-05-02):** This function was likely the fix for an earlier production bug — Razorpay subscription payments succeeded and orders were marked Confirmed, but `user_subscriptions.is_active` stayed `false`, so the customer's "My Subscriptions" page showed "payment awaited." The function's `update user_subscriptions set is_active=true where razorpay_order_id=... and is_active=false` block is exactly that fix. Most plausible deploy history: deployed 13 days ago under the wrong/temporary name `confirm-order-payment`, then 5 days later (8 days ago) re-deployed under the correct name `confirm-order` — with the original never cleaned up.
- **Pre-deletion check:** ~~Grep client code~~ **Resolved 2026-05-02 by live log evidence.** A real test Razorpay payment (Order 328) produced a `confirm-order` log entry; `confirm-order-payment` showed zero invocations. The app definitively calls `confirm-order`. No client-side change required before deletion.
- **Risk:** Zero.
- **When:** Sprint 2 cleanup phase.
- **Status:** Resolved. Ready for deletion.

### CL-04: Webhook configuration — neither webhook is currently called
- **Investigation 2026-05-02:** Test Razorpay payment confirmed `verify-payment` and `razorpay-webhook` both have **zero invocations**. Cross-checked by inspecting Supabase function logs for both — both empty.
- **Conclusion:** Razorpay is not configured to send webhook events to any URL in this project. The system runs entirely on the client-side confirmation path: app SDK → `confirm-order` → marks order Confirmed. `PendingPaymentBanner` polls every 15s for orders stuck in Pending (recovery net for crashed/disconnected clients).
- **Implication:** No active production bug from `razorpay-webhook` being buggy — it's never called. But there is also no server-to-server safety net; a customer whose phone crashes between Razorpay's "success" callback and the app's `confirm-order` call relies on `PendingPaymentBanner` for recovery.
- **Decision needed:** Either (a) delete both unused webhook functions for cleanliness, or (b) keep `verify-payment`, configure Razorpay to call it, and gain a second-layer safety net. `razorpay-webhook` is a delete candidate either way (legacy, buggy, never called).
- **Risk of deferring:** Low. Current system works. Decision can wait until Sprint 2.
- **Status:** Investigation complete. Decision pending (see D-02 below).

---

## Open decisions

### D-02: Webhook safety-net strategy — RESOLVED
- **Resolution 2026-05-02:** Webhook is already configured and active. Shrikanth verified by live subscription-payment test: `verify-payment` fired and activated correctly. No setup work needed.
- **Remaining cleanup:** `razorpay-webhook` (different function, legacy, never called) is still a deletion candidate — handled in CL-04.
- **Status:** Resolved.

### D-03: Admin-cancellation prorated refund — RESOLVED, feature works
- **V-01 verification 2026-05-02:** Feature exists and works as Shrikanth described.
- `AdminSubscriptionsScreen.tsx:74-79` calculates prorated refund as `Math.round((planPrice / daysTotal) * daysRemaining)`.
- `AdminSubscriptionsScreen.tsx:188-195` displays in editable modal.
- `AdminSubscriptionsScreen.tsx:93-114` calls `useAdminCancelSubscription` (deactivates) then `useWalletRefund` (credits wallet via `increment_wallet_balance` RPC).
- Phase 1 missed this because it only grepped the hook file, not the screen — the screen wraps the bare-bones hook with the proration + refund logic.
- **Two nuances captured for later discussion (not urgent, not Sprint 1):**
  - **D-03a:** Proration uses `subscription_plans.price` only — does not include tax or delivery fee slice. Per Master Doc §3.12 the plan price is "all-inclusive" — so arguably the prorated refund should also be on the all-inclusive figure (food + tax + delivery slice). Product decision needed.
  - **D-03b:** Cancellation and wallet credit are two sequential steps (not atomic). If wallet credit fails after deactivation succeeds, customer is cancelled with no refund. Probability low; worth wrapping in a single transaction or RPC eventually. Sprint 3 cleanup.

### D-03 (original entry, kept for history)
- **Intended behavior (per Shrikanth, 2026-05-02):** Admin cancels a subscription → system calculates prorated refund (remaining unconsumed days × per-day plan price) and displays it to admin → admin can **edit** the amount for any reason (judgment call: dispute, goodwill, full refund, etc.) → on confirm, the amount is credited to customer's wallet and the subscription is deactivated.
- **Phase 1's contradicting finding:** `useAdminCancelSubscription` reportedly only does `update user_subscriptions set is_active=false, is_paused=false` — no proration, no edit UI, no wallet credit.
- **Important caveat:** Phase 1 explicitly did NOT read admin screens or admin hooks file-by-file (per its coverage map). Its description of `useAdminCancelSubscription` came from grep + SYSTEM_FLOWS, not from opening the actual file. So the gap may simply be that Phase 1 missed real, working code.
- **Verification needed (Sprint 0 task):** Have Claude Code open `AdminSubscriptionsScreen.tsx` and the relevant cancellation hook(s) and confirm the actual current behavior. Three possible outcomes:
  - (A) Feature works exactly as Shrikanth described → no work needed, just update Phase 1's notes.
  - (B) UI shows the prorated amount + edit field but the wallet credit is not actually wired up → bug fix.
  - (C) Feature is not built → feature build.
- **Status:** Verification queued for Sprint 0.

### D-05: Manifest orders' `total_amount` — likely double-counts subscription revenue
- **Surfaced 2026-05-02 by Claude Code's BF-01+BF-02 proposal (Q-OPEN-2).**
- **Today's behavior:** Each daily manifest-generated order sets `total_amount = (plan.price / duration_days) + tax + delivery`. The original subscription purchase via `place-order` also writes an order with `total_amount = full_plan_price`. Result: revenue reports that aggregate `SUM(orders.total_amount)` (per Master Doc §A.4.6) count subscription revenue twice — once at purchase, then again across N daily slices.
- **Why deferred:** Out of scope for the BF-01+BF-02 fix. Changing this affects admin revenue reports immediately (numbers will drop overnight to reflect actual revenue).
- **Possible options for later decision:**
  - (a) Set `total_amount = 0` on manifest orders — treat them as dispatch records only.
  - (b) Keep `total_amount` as the daily slice but add a `is_subscription_dispatch` flag and exclude such rows from revenue reports.
  - (c) Keep current behavior and adjust admin reports to deduplicate (more complex).
- **Status:** Awaiting deliberate decision in a future session, ideally in a Sprint that also touches admin revenue reports so changes can be reviewed end-to-end.

### D-04: One-off order cancellation logic — confirmed matching Phase 1
- **Per Shrikanth (2026-05-02):** Customer-initiated; allowed within a configured time frame.
- **Phase 1 finding:** Matches. `cancel-order` Edge Function enforces both `cancellation_window_hours` (age from order creation) and the cycle's cutoff time (cannot cancel after the kitchen has the order). Wallet portion refunded automatically via `increment_wallet_balance` RPC. Razorpay portion noted in response, manual admin action required.
- **Status:** No discrepancy. No action needed.

---

## Real-app verification queue (Sprint 0)

> Things Shrikanth has described as working — sometimes from previous Claude audits — but has not personally tested end-to-end on the live app. To be tested before we make any code changes, so fixes target real gaps and not imagined ones.
>
> Each item: what to test, how to test it, expected outcome per current understanding.

### V-01: Admin cancellation prorated refund (links to D-03)
- **Test:** As admin, cancel a subscription that has been partially consumed (e.g., 5 of 20 days used). Observe whether the system shows a calculated prorated refund amount, allows you to edit it, and credits the customer's wallet on confirm.
- **Expected (per design intent):** Yes to all three.
- **Possible failure modes:** No prorated number shown; number shown but not editable; refund button doesn't actually credit wallet; subscription deactivates but no refund happens at all.
- **Required setup:** One test customer with an active wallet-paid subscription that's been running a few days.

### V-02: Plan items source-of-truth — RESOLVED (bug confirmed live)
- **Code-level verification 2026-05-02 (V-02 round):** Admin writes to `subscription_plans.plan_items` JSON column; `place-order` reads from JSON column; `generate_daily_manifest.sql:217-228` reads from `subscription_plan_items` table; no application code writes to that table.
- **Empirical verification 2026-05-02:** Manual `SELECT generate_daily_manifest((CURRENT_DATE+1)::date, NULL)` created 2 orders for 2026-05-03 (orders 331 & 332). Inspection showed both have `items_in_json_column = 1`, `items_in_plan_items_table = 0`, `items_in_this_order = 0`. Bug is real, in production, exactly as code analysis predicted.
- **Implication:** BF-02 fix is required. Sprint 1 priority alongside BF-01.
- **Cleanup note:** Orders 331 and 332 are dead test rows (₹70 and ₹1.05 totals, zero items). Should be cancelled/deleted before the next staff dashboard view to avoid confusion. Not urgent.

### V-03: Daily wallet debit on wallet-paid subscriptions (links to BF-01)
- **Test:** Note a test customer's wallet balance. Buy a wallet-paid subscription. Note balance immediately after (should drop by full plan price). Wait 24+ hours and check balance again — the balance should NOT have dropped further.
- **Expected (per design intent / D-01 decision):** Wallet drops once at purchase, never again.
- **Current code behavior (per Phase 1):** Wallet would drop again every day. This test will confirm whether Phase 1's reading is correct.
- **If confirmed:** BF-01 becomes top-priority Sprint 1 work and we may need a one-time remediation credit for any test customer affected.

### V-05: Direct evidence that daily wallet debit fires (links to BF-01) — RESOLVED
- **Test executed 2026-05-02:** Live SQL query against `wallet_transactions` for the last 30 days, filtered by `description LIKE 'Subscription delivery —%'`.
- **Result:** Zero rows. Zero customers affected. Zero rupees over-debited.
- **Interpretation:** No wallet-paid subscription has been active during a daily-manifest run yet. The bug has not had a chance to fire in practice. Code analysis confirms it WILL fire the moment a wallet-paid sub is active during a cron run.
- **Implication for BF-01 fix:** Purely preventive. No remediation step needed. We're fixing before the first real customer encounters the bug.

---

## Hard principle: verify before fix

Established 2026-05-02 by Shrikanth.

**No code change to "fix" a Phase 1-flagged bug ships without empirical evidence the bug actually fires in production.** Phase 1 found patterns that look risky in code; a risky-looking pattern is not the same as an actively-firing bug. Code that has been used for months without complaint is, statistically, working — Phase 1's deep-read may have missed a guard, condition, or admin override that prevents the apparent bug from firing.

For each Phase 1-flagged bug we plan to fix:
1. **Re-read the actual file** (not Phase 1's summary) to confirm the code path described.
2. **Find empirical evidence** the bug fires today — database query, function logs, live test, or all three.
3. **Only then** design the fix.

This costs minutes per bug; saves hours of fixing things that aren't broken or breaking things that work.

### V-04: New subscription generates orders at all (independent of items)
- **Test:** As a test customer, buy a subscription late in the day (after the cycle's cutoff has already passed). The next morning, check whether a delivery is generated.
- **Expected:** Yes — the 23:00 IST nightly batch should sweep up the late purchase.
- **Possible failure modes:** No order is created; order is created but customer is not notified; order is created but not visible to staff.

---

## Bug fix backlog

### Day-end checkpoint — 2026-05-02 evening

**Where we are at end of day:**

BF-03 work is **code-complete and SQL-deployed**, paused at the live testing step. Everything saved to disk, nothing in flight.

**Files in working tree (NOT yet committed):**
- NEW: `supabase/sql/complete_onboarding.sql` (RPC, deployed live)
- NEW: `supabase/sql/add_address_zone_hub_serviceability.sql` (migration, deployed live)
- NEW: `src/hooks/useCompleteOnboarding.ts`
- NEW: `src/screens/auth/OnboardingScreen.tsx`
- MODIFIED: `src/navigation/RootNavigator.tsx` (4 code edits + JSDoc cleanup)
- MODIFIED: `src/screens/auth/OTPScreen.tsx` (comment fix only)
- DELETED: `src/screens/auth/RegistrationScreen.tsx`

**SQL state on live Supabase:**
- `complete_onboarding_atomic` RPC exists (verified: 13 args, returns bigint).
- `customer_addresses.zone_id`, `hub_id`, `is_serviceable` columns + FKs + indexes present (verified).

**Next steps tomorrow morning, in order:**
1. Open the app on a phone with phone `11111` reserved test number (OTP `123456`).
2. Sign in fresh, enter OTP, run through the new combined onboarding screen end-to-end.
3. Run the two SQL inspection queries (in `phase2-kickoff-context-primer.md` and earlier in this conversation) to confirm `profiles` and `customer_addresses` rows wrote correctly.
4. Run negative tests (empty fields, no GPS, non-serviceable area, network drop) and regression tests (existing customer login, AddAddressScreen for additional addresses).
5. If all pass: commit + push using the staging command in this log.
6. If any fail: paste error/symptom into a new chat session and diagnose.

**Suggested commit command (when test passes):**

```bash
cd ~/Documents/F1/1stOne-F1
git add \
  supabase/sql/complete_onboarding.sql \
  supabase/sql/add_address_zone_hub_serviceability.sql \
  src/hooks/useCompleteOnboarding.ts \
  src/screens/auth/OnboardingScreen.tsx \
  src/navigation/RootNavigator.tsx \
  src/screens/auth/OTPScreen.tsx \
  src/screens/auth/RegistrationScreen.tsx
git status
git commit -m "fix(BF-03): combined onboarding screen with atomic profile+address save

Replaces the two-screen Registration → AddAddress onboarding flow with
a single combined screen that captures name + address + location
(GPS or map pin) and saves both via complete_onboarding_atomic RPC
(single PostgreSQL transaction, all-or-nothing).

Also adds the schema-gap migration for zone_id, hub_id, is_serviceable
columns on customer_addresses (production-already-has-them, repo-now-tracks-them).

Eliminates the BF-03 stuck-on-RegistrationScreen state as a structural byproduct."
git push
```

**To resume in the morning, paste this to a fresh Claude Code session:**

> I'm resuming work on the 1stOne F1 app. Yesterday we completed the code for BF-03 (combined onboarding screen) — all files are saved, SQL is deployed live to Supabase, but I haven't run the live device test yet. Read `decisions.md` to see the full state — specifically the "Day-end checkpoint — 2026-05-02 evening" entry which lists exactly what's pending. Then help me run the test plan with phone `11111` and review the results. If everything passes, help me commit and push using the staging command in the checkpoint.

### BF-03: SHIPPED 2026-05-03 — combined onboarding screen with atomic profile+address save

**Commit:** `1c2e04e` on `main`. Pushed to GitHub `2026-05-03`. Stats: +630 / −176 lines across 7 files.

**Live test result (phone 9999, executed 2026-05-02 evening):**
- New onboarding screen rendered correctly
- Full name + address + GPS pin captured
- Atomic save succeeded: `customer_addresses` row created with `user_id` reference (which means the `profiles` row exists too — FK constraint we added would have rejected the row otherwise)
- Address row: `Customer 9` | "Nayak Circle Chandragutti Circle cross" | lat `14.3476919`, lng `74.8922173` | `zone_id = 2` | `hub_id = null` (location not in any hub polygon, zone-only delivery) | `is_default = true`
- User landed directly on customer home post-submit, no re-login required

**Atomic save verified by FK-implied profile presence.** No partial-write scenarios observed.

**What shipped in the commit:**
- NEW: `supabase/sql/complete_onboarding.sql` — RPC with `auth.uid()` defense-in-depth
- NEW: `supabase/sql/add_address_zone_hub_serviceability.sql` — schema-gap migration
- NEW: `src/hooks/useCompleteOnboarding.ts`
- NEW: `src/screens/auth/OnboardingScreen.tsx`
- MODIFIED: `src/navigation/RootNavigator.tsx` (4 code edits + JSDoc cleanup)
- MODIFIED: `src/screens/auth/OTPScreen.tsx` (comment fix)
- DELETED: `src/screens/auth/RegistrationScreen.tsx`

**Sprint 3 cleanup queued (from BF-03 work but out of scope):**
- Dead state in `RootNavigator.tsx`: `pendingName` / `setPendingName`, `isNewUser` / `setIsNewUser`, `needsOnboarding` / `setNeedsOnboarding` are now write-only or fully unused. Mechanical removal.
- Negative tests not yet run on device (empty-name alert, no-GPS alert, non-serviceable Enter Anyway, network-drop atomicity). Strong empirical proof of happy path; edge case validation deferred.
- `handle_new_user` Postgres trigger referenced in code comments but not in any SQL file — either create the trigger or remove the misleading comments.
- Phone format inconsistency: doc says `+91XXX`, live data is `91XXX` (no `+`). Resolve before broader launch.

### BF-03 (original entry): New-customer onboarding gets stuck on RegistrationScreen — fix in progress 2026-05-02

**Symptom:** First-time user enters phone → OTP → reaches RegistrationScreen → enters name → taps Continue → screen stays put. No error, no toast, no spinner stuck. Reproduced by Shrikanth with phone `88888...` on 2026-04-30; profile WAS created in DB (`Customer 8` in `profiles` table) but UI never advanced to AddAddressScreen.

**Root cause (confirmed by Claude Code investigation 2026-05-02):**
- `RootNavigator.tsx:119` short-circuits to render `RegistrationScreen` whenever `step === 'name'`.
- `RootNavigator.tsx:123-126` `onComplete` handler sets `pendingName` and `needsOnboarding=true` but **does NOT reset `step`**.
- Result: `step` remains `'name'` forever after registration, so the `step === 'name'` guard keeps matching first, never letting the render fall through to the `session && needsOnboarding` branch on line 134.

**Fix surface:** One additional line in `onComplete` handler in `RootNavigator.tsx` to clear `step`.

**Verification plan:** Use one of the clean test phones (Shrikanth has `11111/22222/33333/999999` reserved with OTP `123456`, none with profile rows yet) to test the full new-user flow post-fix: OTP → name → address → onboarded as customer.

**Status:** Diagnosis complete. Drafting fix proposal next.

### Onboarding-related follow-up items (not in BF-03 scope, captured for later)

- **Phantom `handle_new_user` trigger:** Code comments in `RegistrationScreen.tsx` reference a `handle_new_user` Postgres trigger that doesn't exist in any SQL file in the repo. Today this is masked by the UPDATE-fallback-to-INSERT logic in the screen. Decision needed: either create the trigger (so profile rows pre-exist when the screen opens) or remove the misleading comments.
- **Dead state in `RootNavigator.tsx`:** `pendingName` and `isNewUser` are set but never read in render logic. Cleanup opportunity.
- **Phone format inconsistency:** Master Doc §9.1 says phones are stored as `+91XXXXXXXXXX` (E.164). Live data shows `918888888888` (no `+`). Consistent between `auth.users` and `profiles`, so not breaking, but doc/code are out of sync — worth resolving before launch.



### BF-01 + BF-02 (combined): Fix `generate_daily_manifest` — DEPLOYED 2026-05-02

**Status: SHIPPED to production.** Verified end-to-end on live Supabase.

**Deploy verification results:**
- Function source confirmed contains `BF-01: NO wallet debit here` comment marker (deploy gate passed).
- Test generation produced 2 orders for `dispatch_date = CURRENT_DATE + 1`:
  - Order 335 (sub 37, "Idli Vada 30 Days"): 1 × Idli Vada Combo @ ₹80, `wallet_amount_used = 0`.
  - Order 336 (sub 36, "Bajji 30"): 1 × Goli Bajji @ ₹35, `wallet_amount_used = 0`.
- Wallet balance for test customer unchanged at ₹3,895 before/after.
- No new entries in `wallet_transactions` matching `'Subscription delivery —%'` pattern.
- Idempotency guard verified: re-running `generate_daily_manifest((CURRENT_DATE+1)::DATE)` returned `orders_created: 0, orders_skipped: 2`. Total orders for tomorrow remains at 2.

**Rollback file location:** Saved to Shrikanth's laptop as `restore_generate_daily_manifest.sql` (output of `pg_get_functiondef` captured pre-deploy).

**Original work item description (kept for history):**

### BF-01 + BF-02 (combined): Fix `generate_daily_manifest` — remove daily wallet debit AND read items from JSON column
- **Per D-01 resolution + V-02 verification + V-05 code analysis (all 2026-05-02).**
- **Two bugs in the same SQL file, fixed together as one tight change:**
  1. **BF-01 (daily wallet debit):** Lines 158-177 of `generate_daily_manifest.sql`. The `IF v_sub.payment_method = 'wallet' THEN ... END IF;` block must become a no-op (or be removed). Also: line 210's `wallet_amount_used` field must be hardcoded to `0` instead of `CASE WHEN ... THEN v_total_amount ELSE 0 END`.
  2. **BF-02 (plan items source mismatch):** Lines 217-228. The `INSERT INTO order_items ... SELECT ... FROM subscription_plan_items` must instead read from `subscription_plans.plan_items` JSON column (the same column `place-order` reads from). This is the smallest safe change — leaves the live data path (admin → JSON → place-order) untouched and only changes the consumer.
- **Why combined:** Same file, same function, same Sprint, related semantics. Splitting into two PRs costs more in context and review than it saves in surface-area isolation.
- **Pre-fix verification needed (Sprint 0):**
  - V-05 query #2 to determine empirical blast radius of BF-01 (number of test customers affected, total rupees over-debited). If non-zero, plan remediation credits to issue alongside the fix.
  - V-04 (live test): create a new plan via admin UI, buy as test customer, verify pre-fix that the auto-generated order has empty items (confirms BF-02 in production), then re-test post-fix to confirm items appear.
- **Risk after fix:** Low. BF-01's removal is subtraction (less work, fewer side effects). BF-02's source change leaves admin UI and customer purchase flow untouched. The order-generation path's only consumers (kitchen aggregation, packing display, customer order tracking) read from `order_items` table — they don't care which source produced those rows.
- **Sprint:** Sprint 1, top priority. Single combined work item.

---

### D-01: Subscription billing model — RESOLVED
- **Decision (2026-05-02, Shrikanth):** Model **(a)** — customer pays the full plan price upfront from wallet, no daily debits afterward. Plan price is all-inclusive (food + tax + delivery, all covered by the upfront charge). Same model applies for Razorpay-paid plans (already paid upfront, no daily charge).
- **Extension:** When admin cancels a subscription mid-plan, the prorated remaining amount is refunded to the customer's wallet.
- **Implication — confirmed bug to fix in `generate_daily_manifest`:** Currently the SQL debits the wallet daily for wallet-paid subscriptions on top of the upfront charge. This must be removed. The function should still *create* the daily order (so kitchen and dispatch see it) but with `wallet_amount_used = 0` and no wallet UPDATE.
- **Implication — Razorpay-paid subs:** Already correct (no daily debit happens). No change needed.
- **Sprint slot:** Sprint 1, item BF-01 (see Bug Fix Backlog below).

---

*Log started 2026-05-02 by Claude in planning session.*
