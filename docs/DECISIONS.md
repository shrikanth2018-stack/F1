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

### MF-01: Admin staff demotion / termination — feature not built (decision needed)
- **Verified by Shrikanth, 2026-05-03:** the admin app has no UI to demote a staff member back to customer (a.k.a. terminate / revoke staff role). The `elevate-employee` flow is one-way (customer → staff). There is no inverse path.
- **Surface where this hits:** `profiles.role` is a text column, set to `'staff'` for elevated employees. There is no admin button to flip it back to `'customer'`, no Edge Function for it, no resource-manager screen path.
- **Concrete blocker today:** persona "One Hub Staff" (phone `914444444444`, profile id `1cd6c6d9-481a-4cf1-817b-204e08299708`) has `role = 'staff'` with leftover designation "Hub Manager" from an earlier design iteration. Per the corrected hub-operator persona model (see BF-04's corrected "Hub operator persona" subsection), hub operators must be *customers* — so this profile needs to be demoted before being assigned as a hub operator (`profiles.assigned_hub_id`). Cannot be done in-app today.
- **Decision needed:**
  - **(a) Build the demote feature now** — small admin UI button + Edge Function (likely `demote-staff` matching the `elevate-employee` shape) + audit log entry. Properly closes the staff lifecycle.
  - **(b) Defer and pick a different test customer** for the hub operator persona (e.g., phone 555… or a fresh number). Don't block the hub-operator test on this.
  - **(c) Make a one-off backend correction** for the 444 profile outside the admin UI (manual SQL update) and queue the proper feature for later.
- **Claude's recommendation (for Shrikanth's call):** option **(b)** for the immediate test — unblocks the hub operator verification without dragging in feature work. Then queue **(a)** as proper feature work post-test, since other staff lifecycle events (resignation, termination, role change) will need the same flow eventually. Option (c) makes the live DB diverge from the admin UI's reach, which is exactly the kind of drift this project has been actively cleaning up — better to avoid.
- **Status:** Awaiting Shrikanth's call.

### MF-02: Branch picker on OnboardEmployeeScreen — required before multi-branch launch
- **Why captured:** the BF-06 fix lands a `bf.branchId ?? 1` fallback for staff elevation. That's correct only as long as either (a) every admin's JWT has the same `branch_id = 1` (single-branch reality today), or (b) we remain single-branch. When branch 2 ships, super-admins onboarding staff into a specific branch must pick it explicitly — the JWT no longer disambiguates.
- **Surface:** `src/screens/admin/OnboardEmployeeScreen.tsx` has zero `branch_id` references today (verified via grep during BF-06 trace). A picker would slot into the existing form pattern (chip picker like Designation/Shift, or a dropdown if the branch list grows). The form already has a Hub picker — same pattern is reusable.
- **Trigger:** activate this work before flipping `feature_flags.branch_management_active = true`. See MF-03 for the broader audit that feeds into multi-branch launch.
- **Status:** Queued.

### MF-03: Multi-branch readiness audit (blocks branch 2 launch)
- **Why captured:** the codebase has been written in single-branch mode with `feature_flags.branch_management_active = false`. Several places either don't tag rows with `branch_id`, hardcode it, or read from drifted sources (e.g., the `feature_flags.branch_management_active` vs `store_config.branch_management_active` drift flagged in BF-04 Sprint 3 cleanup notes). Before branch 2 ships, a sweep is needed to confirm every branch-aware path actually works under multi-branch. Cost-of-failure is high (cross-branch data leak), so the audit happens before any branch 2 rollout, not during.
- **Read-only audit checklist (no code yet):**
  - Every place orders / customers / addresses / hubs / zones / staff get tagged with `branch_id` on creation. Confirm each has a non-null branch source (form field, JWT claim, or default).
  - The `feature_flags.branch_management_active` flip itself — safe to set true with current data, or does it break queries? Specifically resolves the `feature_flags` vs `store_config` drift BF-04 already flagged.
  - `useStaffOrders` branch filter behavior — currently bypassed because `bf.isActive=false`; verify it activates correctly when toggled.
  - Admin reports' branch-aggregation — Reports → Revenue / Subscriptions / Hubs / Staff: confirm branch filtering is applied where appropriate, and aggregated correctly (or scoped) when viewed by a branch admin vs super-admin.
  - RLS policies' branch scoping — are policies in place that prevent staff/admin from reading another branch's data when `branch_id` doesn't match the JWT claim? Cross-check against the policies surfaced in BF-04 diagnosis.
- **Outcome:** a checklist of fixes needed before branch 2 is added. Could be a few one-liners (BF-06 shape) or could surface bigger gaps. Either way, the audit ships first, the fixes ship second, branch 2 ships third.
- **Sprint slot:** Sprint 2 milestone, blocking branch 2 launch.
- **Status:** Queued.

### MF-05: Customer-cancel cross-screen invalidation — apply BF-09 helper to useCancelOrder
- **Why captured:** BF-09 fixed admin- and driver-side mutations to invalidate every order-related query cache via the new `src/api/invalidateOrderQueries.ts` helper. The customer-initiated cancel path (`useCancelOrder` in `src/hooks/useOrders.ts`) has the same partial-invalidation pattern in the opposite direction: when a customer cancels their own order, an admin viewing the same order in `AdminOrderDetailScreen` or `AdminOrdersScreen` (or a driver who had it on their list) won't see the cancellation until they navigate away and back. Same root cause as BF-09; same one-line fix (replace whatever partial invalidations the hook has with a single `invalidateOrderQueries(queryClient)` call).
- **Why not folded into BF-09:** the original BF-09 user report was specifically about admin/driver flows. Keeping that commit narrow per smallest-safe-change rule.
- **Surface:** `useCancelOrder` hook. One-line change in its `onSuccess` (plus an import) once the BF-09 helper is in place.
- **Status:** Queued. Trivial follow-up; safe to ship at any time.

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

### V-06: End-to-end order-flow regression test
- **Why captured:** today's BF-04 walkthrough surfaced 6 sequential layers of breakage in the hub-routed order lifecycle (RLS SELECT, RLS UPDATE WITH CHECK, RLS UPDATE USING, status state machine, persona-aware action gating, and hub-operator UPDATE permission). All fixed today as BF-04 → BF-12. To prevent regressions when the surrounding scaffolding shifts again, before launch (or whenever feels right), backfill a small set of orders covering every combination — zone-direct food, hub-routed food, zone-direct essentials, hub-routed essentials, subscription-generated, customer-cancelled, admin-cancelled — and walk through each path with each persona (Customer, Staff, Driver, Hub Operator, Admin). Confirm visibility, gating, action affordances at every step.
- **Status:** Queued for a future deliberate session, ideally just before launch or after any major architectural change to the order/persona model.

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

### Day-end checkpoint — 2026-05-03 evening

**Where we are at end of day:**

Twelve-bug streak. BF-04 through BF-12 all shipped and pushed. Working tree clean. The hub-routed order lifecycle now flows end-to-end: customer order → kitchen → packing → driver → hub → hub operator → delivered, gated correctly per persona at every step. Tomorrow is verification day, not bug-fix day.

**What shipped today (commits in chronological order):**

- **BF-04** `65ea46b` + `4589bd3` — Staff dashboard Kitchen + Packing tabs unbroken (missing `orders.delivery_address_id` FK + visibility drift fix). Includes hub-operator persona-model correction.
- **BF-05a** `dae7772` — Admin staff elevation lookup matches DB 12-digit phone format (`OnboardEmployeeScreen`).
- **BF-05b** `482ae13` — `elevate-employee` Edge Function uses SECURITY DEFINER RPC for `auth.users` lookup (PostgREST `.schema('auth')` returns PGRST106).
- **BF-05c** `8f39191` — `PhonePicker` phone-format drift fix (last remaining surface).
- **BF-06** `e99a3b3` — Default `branch_id = 1` on staff elevation when branch-management feature flag is off.
- **BF-07** `a403438` — **SUPERSEDED mid-session by BF-08.** Widened admin Live tab to full-day pipeline; abandoned when BF-08 merged the tab away entirely.
- **BF-08** `9deb7a1` (1/3) + `680847d` (2/3) + `402fdce` (3/3) + follow-ups `74de60f`, `13fb758`, `a50891f` — Removed redundant Live tab; collapsed Manage Running Orders rows to one line + tappable detail; new `AdminOrderDetailScreen` as full admin action surface.
- **DC-01** `b2702ef` — One-off backfill of `delivery_method='hub'` + `hub_id=19` on orders 335/336/337 (snapshot-stale, orphaned from later address routing).
- **BF-09** `7bb864c` — Centralized order query invalidation across mutating hooks (`invalidateOrderQueries` helper).
- **BF-11** `b9b2a97` — Persona-aware `nextDeliveryStatus(persona)` extracted to `src/utils/deliveryStatus.ts`; driver / hub_operator / admin each get the right transitions.
- **BF-12** `18333c9` + `ab84151` — RLS UPDATE policy `orders_hub_operator_update` allows hub operators (customers with `assigned_hub_id`) to advance their hub's orders. Wrap-up wording + V-06 in `ab84151`.

**Live data state (one-off SQL applied today via Supabase SQL Editor):**

- `444` demoted staff → customer. Kept as hub operator via `profiles.assigned_hub_id = 19`.
- `333` elevated customer → staff. Also assigned as `delivery_zones.driver_user_id` for Zone 1 AND `delivery_hubs.driver_user_id` for Hub 1.
- **Zone 1** (id=2) created with `driver_user_id = 333`.
- **Hub 1 Kolsirsi** (id=19) created with `driver_user_id = 333` (driver feeding into hub) and `staff_user_id = 444` (operator at hub).
- Orders **335 / 336 / 337** backfilled `delivery_method = 'hub'` and `hub_id = 19` (DC-01).
- RLS policy `orders_staff_update` updated to include `'Received at Hub'` in its allowed status set.
- RLS policy `orders_hub_operator_update` added (BF-12; captured in `supabase/sql/add_orders_hub_operator_update_policy.sql`).

**Persona / test phone roster (all OTP `123456`):**

| Phone | Role | Notes |
|---|---|---|
| `777` | admin | Admin user |
| `666` | staff | Kitchen / packing staff |
| `555` | customer | Plain customer |
| `444` | hub operator | role=`customer` + `assigned_hub_id = 19`. Was staff, demoted today. |
| `333` | staff + driver | role=`staff` + driver of Zone 1 AND Hub 1. Was customer, elevated today. |

**Tomorrow's prioritized plan:**

**Morning (small + safe):**

1. **MF-05** — Apply BF-09's `invalidateOrderQueries` helper to `useCancelOrder` (customer-side cancel). Same partial-invalidation gap that BF-09 fixed staff/admin-side.
2. **V-04 + V-01 live tests:**
   - V-04: Buy a subscription late in the day (after the cycle cutoff), confirm next-morning delivery is generated by the 23:00 IST nightly batch.
   - V-01: Spot-check admin-cancellation prorated refund math against the expected formula.
3. **Phone format unification** — Doc says `+91XXX`, live data is `91XXX` (no `+`). Decide canonical form, update docs, optionally extract `normalizePhone` helper if a 3rd callsite emerges.
4. **Doc / SQL clean-ups** — `CL-09` (`DEPLOY_SQL_ORDER.md` staleness), `schema.sql` missing inline `orders.delivery_address_id` FK declaration, `handle_new_user` trigger comment-vs-reality drift.

**Afternoon (the big one):**

5. **V-06 — End-to-end order-flow regression test.** Backfill a small set of orders covering every routing × persona combination (zone-direct food, hub-routed food, zone-direct essentials, hub-routed essentials, subscription-generated, customer-cancelled, admin-cancelled). Walk each path with each persona (Customer, Staff, Driver, Hub Operator, Admin). Confirm visibility, gating, action affordances at every step.

**V-06 is the launch go/no-go.** If it passes clean, the order subsystem is launch-ready. If it surfaces another layer of breakage the way BF-04 did today, that's another sprint before launch.

**To resume in the morning, paste this to a fresh Claude Code session:**

> I'm resuming work on the 1stOne F1 app. Yesterday (2026-05-03) was a long bug-fix day — twelve fixes shipped (BF-04 through BF-12, with BF-07 superseded by BF-08 mid-session). Working tree is clean, latest commit `ab84151` (or whatever the day-end-checkpoint commit is — check `git log -1`). Read `docs/DECISIONS.md` to see the full state — specifically the "Day-end checkpoint — 2026-05-03 evening" entry which lists exactly what shipped, the live data state on Supabase, the persona roster, and today's prioritized plan. Start with item 1 (MF-05 customer-cancel invalidation), then V-04 + V-01 live tests, then phone format unification, then doc/SQL clean-ups. Afternoon is V-06 — the end-to-end order-flow regression test that's the launch go/no-go. Same working rules as before: structured proposal first, smallest safe change wins, plain English, push back when unsafe.

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

### BF-04: Staff dashboard Kitchen + Packing tabs broken — RESOLVED 2026-05-03

**Symptom:** Staff "One Staff" (phone 6666) signed in, navigated to Kitchen tab — saw "Failed to load orders / Retry" instead of today's 3 known orders (335, 336, 337). Packing tab and DriverDashboardScreen also blank.

**Diagnosis trail (read-only investigation, all 2026-05-03):**

1. **Timezone (UTC vs IST):** ruled out — `server_today_utc = today_in_ist = '2026-05-03'`.
2. **Branch_id mismatch:** ruled out — JWT carries `branch_id = 1`, matches the orders.
3. **Hub filter silent drop:** ruled out — JWT has `assigned_hub_id: null`, so the `hubDeliveryActive && assignedHubId != null` clause is false and the filter never fires.
4. **No orders for the date:** ruled out — Q2 confirmed 3 orders exist with correct `dispatch_date = '2026-05-03'` and `branch_id = 1`.
5. **RLS blocking the staff JWT:** ruled out via `SET LOCAL request.jwt.claims` simulation in SQL Editor — the staff JWT can read both `orders` and `order_items` because `is_staff_or_admin()` returns TRUE (it reads from `auth.jwt() ->> user_role`, not from profiles). Note: Phase 1's "RLS off in dev" claim is no longer accurate — RLS is now enabled on all relevant tables.
6. **Actual cause:** moving the TEMP DEBUG `console.log` BEFORE the `if (error) throw error` line surfaced the real failure: `PGRST200 — Could not find a relationship between 'orders' and 'customer_addresses' in the schema cache`. The FK constraint `orders.delivery_address_id → customer_addresses(id)` was never defined on the live DB. PostgREST's nested SELECT through this relationship (used by `useStaffOrders`) requires the FK to exist; without it, the entire query throws and the staff dashboard shows the error retry banner.

**Fix part 1 — schema (deployed live 2026-05-03):**

- Pre-check: orphan rows = 0; safe to add FK without data cleanup.
- `ALTER TABLE orders ADD CONSTRAINT orders_delivery_address_id_fkey FOREIGN KEY (delivery_address_id) REFERENCES customer_addresses(id)` + `NOTIFY pgrst, 'reload schema'`.
- Captured as `supabase/sql/add_orders_delivery_address_fkey.sql` — idempotent (DO-block constraint guard), matches yesterday's `add_address_zone_hub_serviceability.sql` pattern. So a fresh DB rebuild stays consistent with production.

**Fix part 2 — visibility drift (4 edits in `src/screens/staff/StaffDashboard.tsx`):**

Spec (clarified by Shrikanth, 2026-05-03): Kitchen and Packing show **all today's orders, every status**, with action toggles gated to the relevant transition window. Cancelled orders are excluded entirely from operator views (history-only). Driver and Admin Live tabs intentionally keep their existing active-status whitelists.

- **Edit A** — Kitchen visibility filter: dropped `['Confirmed', 'Preparing', 'Ready'].includes(o.status)` whitelist; kept `o.order_type === 'food'`; added `o.status !== 'Cancelled'`.
- **Edit B** — Aggregator: replaced status whitelist with `o.status !== 'Cancelled'`. Extended `statusOrder` sort array to cover all live statuses (Confirmed, Preparing, Ready, Packed, Dispatched, Received at Hub, On the Way, Delivered) so newly-visible statuses sort sensibly instead of clustering at -1.
- **Edit C** — Kitchen toggle gating + label: `disabled` is now driven by `!canAct` where `canAct = item.status === 'Confirmed' || item.status === 'Preparing'`. Toggle label shows actual `item.status` (was misleading "Confirmed"/"Ready" two-state). Border color uses the existing `statusColor()` helper for all statuses.
- **Edit D** — Packing visibility filter: dropped `['Ready', 'Packed', 'Dispatched'].includes(o.status)` whitelist; added `o.status !== 'Cancelled'` exclusion in both food and essentials branches. Packing's action gating (`canAdvance = Ready || Packed`) was already correct — unchanged.
- TEMP DEBUG instrumentation from the BF-04 diagnosis removed from `useStaffOrders.ts`.

**Verified live (2026-05-03):** After Fix part 1, simulator showed 2 aggregated kitchen rows (Idli Vada Combo × 2 across orders 335+337, Goli Bajji × 1 from order 336). Fix part 2 follows in the same commit; full pipeline visibility verifiable by force-quitting + re-launching the app.

**Items NOT changed by explicit decision (2026-05-03):**

- `DriverDashboardScreen` visibility — keep current `['Dispatched', 'Received at Hub', 'On the Way']` whitelist. Drivers operationally don't need to see Confirmed/Preparing orders; they have no action to take on those.
- ~~Admin `DeliveryManagerScreen` Live tab — same whitelist kept. "Live" semantically means "in flight right now"; full-day admin view is a different tab if/when needed.~~ **— SUPERSEDED 2026-05-03 by BF-07. Live tab now shows all today's orders, every status (Cancelled included). See BF-07 entry below.**

**Hub operator persona — corrected 2026-05-03 (was previously misreported as missing):**

- **Earlier audit was wrong.** The hub operator screen DOES exist at `src/screens/customer/HubDashboardScreen.tsx`. The original BF-04 entry stated it was missing — that was based on an incomplete file inspection (only checked under `src/screens/staff/`, didn't look in `src/screens/customer/`). Corrected here.
- **Intended persona model (verified by Shrikanth, 2026-05-03):**
  - **Hub operator** = a *customer* (not staff) with `profiles.assigned_hub_id` set. Reaches `HubDashboardScreen` via their profile menu. Role stays `customer`.
  - **Driver** = a *staff* member who is also assigned in `delivery_zones.driver_user_id` or `delivery_hubs.driver_user_id`. Despite being staff, they land on customer home (not `StaffDashboard`) and access `DriverDashboardScreen` via the profile menu's "My Deliveries" entry.
  - **`StaffDashboard` (Kitchen / Packing)** = home only for on-site kitchen and packing staff.
- **No queued gap remains for the hub operator persona** — screen and design are both in place. The earlier "Phase 1 / Phase 2 missing feature" framing was based on incomplete inspection and is retracted.
- A separate, real gap surfaced while testing this — see **MF-01** in the Open decisions section: there's no admin UI to demote a staff member back to customer, which blocks reusing an existing staff profile as a hub operator.

**Sprint 3 cleanup queued (separate from BF-04 scope):**

- `feature_flags.branch_management_active = FALSE` while `store_config.branch_management_active = TRUE` — drift between the two sources of the same toggle. Today the dashboard reads `feature_flags`, so the branch filter is currently bypassed in the staff query (`bf.isActive = false`).
- Phase 1's "RLS is off in dev" claim is now incorrect — RLS is enabled on all relevant tables. Doc to update.
- The missing `orders.delivery_address_id` FK is now fixed live and in the repo migration file, but the source `schema.sql` still doesn't declare it inline on the orders table. One-line audit + patch when convenient.

---

### BF-05: Admin staff elevation broken — RESOLVED 2026-05-03

Two unrelated bugs in the admin elevation flow, surfaced sequentially while elevating "Customer 3 Driver" (phone `913333333333`) to staff. Fixed in two commits.

**BF-05a — Client-side phone-format mismatch (shipped: commit `dae7772`):**

- **Symptom:** Admin enters phone, screen says "No account found, must register via OTP first" even though the customer profile exists with `last_sign_in_at` within hours.
- **Root cause:** `OnboardEmployeeScreen.tsx` input handler stripped to digits then `slice(0, 10)` (first 10), and the lookup compared against `profiles.phone_number` without prefixing `91`. The DB stores `91XXXXXXXXXX` (12 chars, Supabase Auth E.164 minus `+`); client compared 10 chars. Exact match → never hit OTP-registered profiles.
- **Fix:** Two one-liners in `OnboardEmployeeScreen.tsx` — `slice(0, 10)` → `slice(-10)`, and lookup `phone` → `` `91${phone}` ``. Edge Function and `useResourceManager` unchanged (Edge Function was already format-tolerant via its own `slice(-10) + '91'` normalization).
- **Deploy:** Code-only; pushed at `dae7772`.

**BF-05b — Edge Function `auth.users` lookup blocked by PostgREST (this commit):**

- **Symptom:** After BF-05a landed, admin taps Onboard ›, Edge Function returns `Auth lookup failed: Invalid schema: auth` (PGRST106). Elevation never reached the role-flip step.
- **Root cause:** `elevate-employee/index.ts:83-87` used `adminClient.schema('auth').from('users').select('id').eq('phone', phoneStored)`. PostgREST refuses to route requests to the `auth` schema regardless of which key authenticates — only `public` and `graphql_public` are exposed by default, and exposing `auth` is a Supabase anti-pattern. Service role doesn't override this; the gateway rejects before reaching Postgres.
- **Fix:** New SECURITY DEFINER RPC `public.auth_user_id_by_phone(p_phone TEXT) RETURNS UUID`, locked down to `service_role` only via REVOKE/GRANT. Edge Function calls `adminClient.rpc('auth_user_id_by_phone', { p_phone })` instead of `.schema('auth').from('users')`. Same control flow afterwards: existing user → use their UUID; missing → fall through to `auth.admin.createUser`. RPC captured in repo as `supabase/sql/add_auth_user_id_by_phone_rpc.sql` (idempotent `CREATE OR REPLACE` + REVOKE/GRANT pattern).
- **Deploy:** SQL Editor paste of the new SQL file (must run *before* Edge Function deploy), then `supabase functions deploy elevate-employee`. Verify with `SELECT proname, prosecdef FROM pg_proc WHERE proname = 'auth_user_id_by_phone';` — expects 1 row with `prosecdef = true`.
- **Grep audit (this commit):** repo-wide grep for `.schema('auth')` and `.from('users')` with auth context returned exactly one hit each, both at `elevate-employee/index.ts:83-84` — the lines this fix replaces. No other code paths affected. The two `auth.users` mentions on lines 9-10 of the same file are docstrings, not code.

**BF-05c — `PhonePicker` (Create Zone, Hub Detail) — same phone-format drift, different surface (this commit):**

- **Symptom:** Admin opens Resource Manager → Create Zone, types `3333333333` (or `913333333333`) into the Driver field. Picker shows "Not a staff member. Elevate them via Manage → Staff first." even though `913333333333` is `role='staff'` in profiles (employee_id `1ST-2026-001` from BF-05a/b elevation). Same surface used by Hub Detail driver / hub-operator assignment.
- **Root cause:** `src/components/PhonePicker.tsx` is shared between `DeliveryManagerScreen` (Create Zone) and `HubDetailScreen` (driver / hub-operator). Line 69 did `.eq('phone_number', phone)` against the 12-digit DB value — same 10-vs-12-digit drift as BF-05a. Line 117 had `onChangeText={setPhone}` with no digit filter at all, relying solely on `maxLength={10}` for length capping; pasting `+91-9876543210` would have stored non-digit characters in state. The "wrong end chopped" failure mode is the same as BF-05a.
- **Fix:** Two one-liners in `src/components/PhonePicker.tsx`:
  - Line 117: `onChangeText={setPhone}` → `onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(-10))}` (adds digit filter + last-10 slice).
  - Line 69: `.eq('phone_number', phone)` → `` .eq('phone_number', `91${phone}`) ``.
- **Audit conclusion (repo-wide grep, this commit):** `.eq('phone_number', ...)` callsites: exactly 2 — `OnboardEmployeeScreen.tsx:330` (fixed in BF-05a) and `PhonePicker.tsx:69` (this fix). `slice(0, 10)` in admin/staff/hooks input handlers: zero hits. **PhonePicker was the last remaining drift surface.** Sprint 3 `normalizePhone` helper refactor is now nice-to-have rather than urgent — no new callsites need it today.
- **Deploy:** Code-only; pushed.

**What `913333333333` elevation now exercises end-to-end (post-fix):**

1. Admin types phone (any of `913333333333` / `3333333333` / `+91-...` — `slice(-10)` handles all).
2. Client lookup `profiles.phone_number = '913333333333'` finds Customer 3 Driver, name auto-fills.
3. Admin taps Onboard ›, payload posts to `elevate-employee` Edge Function.
4. Edge Function calls `auth_user_id_by_phone('913333333333')` RPC, gets the UUID directly from `auth.users`.
5. Edge Function calls `elevate_to_staff(uuid, ...)` RPC — atomic profile upsert (`role = 'staff'`) + first-month salary row + employee_id allocation from sequence.
6. `custom_access_token_hook` injects `user_role: 'staff'` on the user's next sign-in. From then on, `RootNavigator` routes them per the corrected persona model: pure staff → `StaffDashboard`; staff also assigned in `delivery_zones/hubs.driver_user_id` → customer home + `DriverDashboardScreen` via profile menu (driver persona, BF-04 corrected entry above).

**Sprint 3 cleanup queued (separate from BF-05 scope):**

- Phone-format drift exists at other admin lookup sites (per BF-03 cleanup note). BF-05a fixed only the elevation screen. Broader grep + `normalizePhone` helper deferred.
- `phone_confirm: true` policy in `auth.admin.createUser` not reviewed in this PR (kept narrow). Queue separately if it ever matters.

---

### BF-06: profiles.branch_id NULL after staff elevation — RESOLVED 2026-05-03

**Symptom:** After elevating "Customer 3 Driver" (phone `913333333333`) via Onboard Employee, `profiles.branch_id` came back NULL. Existing staff `666` ("One Staff") has `branch_id = 1`. Discrepancy means any branch-filtered query against new staff silently excludes them — including `useStaffOrders` branch filter when `feature_flags.branch_management_active` eventually flips on.

**Trace — which layer dropped the value:**

| Layer | What it does with `branch_id` | Verdict |
|---|---|---|
| Form `OnboardEmployeeScreen.tsx` | Zero `branch_id` mentions; no branch picker. Form contributes nothing. | No layer-1 contribution |
| Hook `useResourceManager.ts:131` | `body: { ...payload, branch_id: bf.isActive ? bf.branchId : null }`. Today `feature_flags.branch_management_active = false` → `bf.isActive = false` → ternary always evaluates `null`. | **Drop point.** |
| Edge Function `elevate-employee/index.ts:65, 121` | Destructures `branch_id = null` from body, forwards to RPC as `p_branch_id`. Faithful pass-through. | No drop here |
| RPC `elevate_employee.sql:33, 53, 57, 69` | Accepts `p_branch_id BIGINT`, writes via INSERT and ON CONFLICT UPDATE `branch_id = EXCLUDED.branch_id`. Receives null, writes null. | No drop here |

**Root cause:** Hook line 131 was written under the assumption "if multi-branch is off, we don't care about branch." That works for *reads* (filtering doesn't matter when there's only one branch) but is wrong for *writes* during elevation — every staff still needs a branch tag, the value just defaults to `1` in single-branch mode.

**Why 666 has `branch_id = 1`:** per earlier session notes, 666 was *backfilled* manually after the fact, not written correctly during elevation. The elevation flow has been silently writing NULL since this hook was authored.

**Fix:** One-line change in `src/hooks/useResourceManager.ts:131`:
```diff
-        body: { ...payload, branch_id: bf.isActive ? bf.branchId : null },
+        body: { ...payload, branch_id: bf.branchId ?? 1 },
```

`bf.branchId ?? 1` is forward-compatible:
- Today's branch admins get `bf.branchId = 1` from JWT — correct.
- Super-admins (no JWT branch_id) get the `?? 1` fallback — correct for single-branch today.
- When multi-branch launches, branch admins automatically scope new staff to their own branch with no further code change. Super-admins still need a picker (queued as MF-02).

**Open backfill (manual SQL, not part of this commit):**

```sql
UPDATE profiles
SET branch_id = 1
WHERE phone_number = '913333333333' AND branch_id IS NULL;
```

Same shape as the earlier 666 backfill. Run in SQL Editor when convenient.

**Multi-branch readiness items queued — see MF-02 and MF-03 in Open decisions section.** Both block branch 2 launch.

---

### BF-07: Admin Delivery Manager Live tab — widen visibility to full-day pipeline — SUPERSEDED 2026-05-03 by BF-08

> **Superseded.** The Live tab was fully removed from `DeliveryManagerScreen` in BF-08 (commit `feat(BF-08, 3/3)`). Pipeline visibility now lives in `AdminOrdersScreen` ("Manage Running Orders"). The BF-07 visibility-filter widening doesn't need a separate code revert because the entire `LiveDeliveriesTab` component and its imports were deleted in BF-08 commit 3 — the widened filter went away with the function. The driver-chip symmetric formatting (zone name explicit) was re-homed inline in `AdminOrdersScreen` rows in BF-08 commit 2. Historical reasoning below preserved for the audit trail.

#### BF-07 historical entry (kept for trail)

**Spec change supersedes the BF-04 "Items NOT changed" decision for the Live tab specifically.** The DriverDashboardScreen narrow whitelist remains correct (per BF-04) — drivers still don't need pre-dispatch visibility.

**Why:** earlier "Live = in flight right now" framing was too narrow. Admin needs full-day pipeline visibility for operational oversight — what's been generated, where each order sits in the kitchen → packing → dispatch → delivery flow, which hub or zone it's routed to, and which orders got cancelled. Active-only view forced admin to context-switch between Live and Reports for a cohesive picture.

**New spec:** Live tab shows all today's orders, every status, immediately after generation. Same per-order row format (`DeliveryOrderRow`) already in use. Cancelled **included** (admin oversight legitimately needs cancellation visibility for refund triage; status pill is auto-disabled for Cancelled, so the row is read-only).

**Action gating unchanged:** `DeliveryOrderRow`'s status pill calls `nextDeliveryStatus(current, deliveryMethod)` which returns null for non-delivery statuses (Confirmed, Preparing, Ready, Packed, Delivered, Cancelled). Pill auto-disables for those. Admin can see the full pipeline but cannot bypass kitchen/packing workflows from Live — appropriate division of concerns.

**Driver chip — zone name now explicit:** Driver chip now shows zone name for zone-direct orders, mirroring how hub name was already shown for hub orders. Symmetric routing label per row.

- Hub orders (unchanged): `${driver_code} → ${hub_name}` (e.g., `"C-1234 → Main Hub"`).
- Zone-direct orders (changed from `Driver ${code}`): `${driver_code} → ${zone_name}` (e.g., `"C-5678 → Siddapur Central"`).
- Unassigned (both branches): `Unassigned → ${hub_name}` or `Unassigned → ${zone_name}`.

Data already selected by `useStaffOrders` (`customer_addresses(*, delivery_zones(driver_code, zone_name), delivery_hubs(driver_code, hub_name))`) — no extra fetch.

**Fix:** two edits in `src/screens/admin/DeliveryManagerScreen.tsx`, both in `LiveDeliveriesTab`.

1. Visibility filter (line ~1000-1005): drop the status whitelist.
   ```diff
   -  const activeOrders = React.useMemo(
   -    () => (orders ?? []).filter((o: any) =>
   -      ['Dispatched', 'Received at Hub', 'On the Way'].includes(o.status),
   -    ),
   -    [orders],
   -  );
   +  const activeOrders = orders ?? [];
   ```

2. `getDriverInfo` zone branch: surface `zone.zone_name` to the chip.
   ```diff
       const zone = addr?.delivery_zones;
       const code = zone?.driver_code ?? null;
   -    return { code, label: code ? `Driver ${code}` : 'Unassigned' };
   +    const zoneName = zone?.zone_name ?? 'Zone';
   +    return { code, label: code ? `${code} → ${zoneName}` : `Unassigned → ${zoneName}` };
   ```

**No other changes:**
- `DeliveryOrderRow` component itself is untouched — still receives the same `getDriverInfo` callback signature, status pill logic unchanged.
- `useStaffOrders` query unchanged.
- `DriverDashboardScreen` and other consumers of `DeliveryOrderRow` are not affected — `getDriverInfo` is local to `LiveDeliveriesTab`.
- No DB / RPC / Edge Function changes.

**Variable naming note:** the `activeOrders` variable name is slightly misleading post-widening but is kept to minimize diff. Rename can ride a future refactor.

---

### BF-08: Merge Delivery Manager → Live into Manage Running Orders — RESOLVED 2026-05-03

**Why:** read-only audit (during the BF-07 design pause) found two admin order-management surfaces — `AdminOrdersScreen` ("Manage Running Orders") and `DeliveryManagerScreen → Live` — overlapping on full-day visibility but diverging on action affordances (cancel vs. status-advance) and data dimension (customer-centric vs. driver/hub-centric). After BF-07 widened Live's visibility to match AdminOrdersScreen's, the two screens became near-duplicates on the visibility axis. Maintaining both raised the future-bug surface and the operator-confusion cost ("which screen do I use for X?"). Merging consolidates the canonical entry point.

**Design (verified by Shrikanth, 2026-05-03):**

- `AdminOrdersScreen` becomes the single canonical admin view of orders for any date.
- Row layout collapsed to a single line per order: `#ID  ·  zone-or-hub label  ·  status pill`. No items, no price, no customer name, no row-level Cancel button. Maximizes vertical density (~4× more orders visible per screen).
- Filtering: status filter chip row at top (All / Confirmed / Preparing / Ready / Packed / Dispatched / Received at Hub / On the Way / Delivered / Cancelled) + order # search input. Both compose; persistence is component-lifetime (`useState` only).
- Tappable row → new `AdminOrderDetailScreen` for full context + actions.
- `DeliveryManager → Live` tab removed entirely. Other tabs (Hubs, Zones & Fees, Cycles) unchanged.

**`AdminOrderDetailScreen` action surface:**

- Customer name + phone (Call action via `tel:`)
- Address (Open in Maps action)
- Items list with quantities
- Payment summary (total, wallet portion, Razorpay portion, method)
- Status pill + routing label (Hub or Zone) + driver code (read-only)
- **Advance Status** button — gated to delivery transitions `{Dispatched → Received at Hub → On the Way → Delivered}`, mirroring `DeliveryOrderRow.tsx:37-47` `nextDeliveryStatus` logic (inlined).
- **Cancel + auto-refund** button — gated to cancellable statuses `{Pending, Confirmed, Preparing, Ready, Packed}` via existing `useAdminCancelOrder` hook.
- Read-only meta: dispatch_date, cycle_id, created_at.

**Three commits, one push:**

1. `feat(BF-08, 1/3)` — Add status filter + order# search to AdminOrdersScreen. No row layout changes, no Live changes.
2. `feat(BF-08, 2/3)` — Collapse rows to single line, expand list query to fetch hub/zone names via nested PostgREST select, tappable rows, new `AdminOrderDetailScreen` with the action set above. Existing row-level Cancel button removed (intentional — see Behavior change below). New navigation route `AdminOrderDetail { orderId: number }` registered in `AdminStackParamList` and `AdminNavigator`.
3. `feat(BF-08, 3/3)` — Remove Live tab from `DeliveryManagerScreen.tsx` (drop `LiveDeliveriesTab` function, drop unused imports `FlatList` / `RefreshControl` / `DeliveryOrderRow` / `DriverInfo` / `useStaffOrders` / `useUpdateOrderStatus` / `OrderStatus`, change default tab from `'Live'` to `'Hubs'`, simplify the tab render switch). Plus this DECISIONS.md update (BF-07 supersede annotation + BF-08 entry).

**Hooks reused unchanged:** `useAdminCancelOrder` (cancel + auto-refund), `useUpdateOrderStatus` (status advance). Both already supported the use-case shape; only their callers changed.

**Behavior change:** the row-level Cancel button on AdminOrdersScreen is removed. Admin can no longer cancel an order from the list view without opening detail first. Intentional — forces a context glance before the destructive action.

**No-change list:**

- `OrderDetailScreen.tsx` (customer) — untouched. Customer cancel flow still goes through customer-side `useCancelOrder` (window-gated), not the admin hook.
- `DeliveryOrderRow` component — untouched. Still used by `DriverDashboardScreen` and `HubDashboardScreen`.
- `StaffDashboard` (Kitchen / Packing) — untouched.
- `DriverDashboardScreen`, `HubDashboardScreen` — untouched.
- `AdminHome` menu — "Manage Running Orders" link unchanged. "Delivery Manager" link unchanged (that screen still has Hubs / Zones & Fees / Cycles).
- `useStaffOrders`, `useUpdateOrderStatus`, `useAdminCancelOrder` hooks — no changes; only their callers shifted.
- DB / RPC / Edge Functions / RLS — none.

**Sprint 3 cleanup deferred:**

- ~~`nextDeliveryStatus` is now inlined in two places (`DeliveryOrderRow.tsx` and `AdminOrderDetailScreen.tsx`). Could be extracted to a util once a third caller emerges; not urgent today.~~ **— RESOLVED 2026-05-03 by BF-11.** Extracted to `src/utils/deliveryStatus.ts` when persona-aware gating was introduced; both call sites now import from the util.
- The driver-chip / routing-label format is similarly inlined (BF-07's `getDriverInfo` in DeliveryManagerScreen has been deleted; AdminOrdersScreen and AdminOrderDetailScreen each have their own inline copy of "use hub_name for hub-routed, zone_name for zone-direct"). Same pattern — extract when a third caller appears.

---

### BF-09: Order-status mutations don't refresh Driver / Admin screens — RESOLVED 2026-05-03

**Symptom:** On `DriverDashboardScreen` and `AdminOrdersScreen` (Manage Running Orders), tapping the status pill (or "Cancel + Refund" in `AdminOrderDetailScreen`) triggered the mutation correctly — server state advanced — but the screen didn't re-render with the new status. User had to navigate away and back, or sign out/in, to see the update. Mutations worked; query invalidation didn't reach the right screen.

**Audit findings (read-only, 2026-05-03):**

| Surface | Hook | Query key | Invalidated by mutation today? |
|---|---|---|---|
| StaffDashboard (Kitchen + Packing) | `useStaffOrders()` | `['orders', 'staff', today, …]` | ✓ via partial match on `QUERY_KEYS.STAFF_ORDERS` |
| HubDashboardScreen | `useStaffOrders()` (same hook) | Same shape | ✓ same partial match — **wasn't actually broken;** user's hypothesis was wrong about Hub |
| DriverDashboardScreen | Local `useQuery` | `['driver_orders', userId, today]` | ✗ never invalidated |
| AdminOrdersScreen (BF-08 list) | Local `useQuery` (`useOrdersForDate`) | `['admin_orders_manage', date]` | ✗ never invalidated |
| AdminOrderDetailScreen (BF-08 detail) | Local `useQuery` (`useAdminOrderDetail`) | `['admin_order_detail', orderId]` | ✗ at cache level — masked by manual `refetch()` calls in handler closures |

**Root cause:** `useUpdateOrderStatus.onSuccess` invalidated only `QUERY_KEYS.STAFF_ORDERS`. `useAdminCancelOrder.onSuccess` invalidated `QUERY_KEYS.ORDERS`, `['admin_orders']`, `['admin_stats']`, `QUERY_KEYS.WALLET` — also a partial set. Neither covered the BF-08 admin screen keys (`['admin_orders_manage']`, `['admin_order_detail']`) or the driver key. Each screen had its own query key; the mutations had ad-hoc lists of keys to invalidate; the lists drifted.

**Fix — centralized helper:**

New file `src/api/invalidateOrderQueries.ts` exports `invalidateOrderQueries(queryClient)` — one function that invalidates the canonical list of order-related query keys (StaffOrders, customer Orders, driver_orders, admin_orders, admin_orders_manage, admin_order_detail, admin_stats). Each order-mutating hook's `onSuccess` calls this single function. When a new order-touching screen lands with a new query key, the key is appended once to the helper's list and every existing mutation automatically picks it up — no foot-gun.

Hooks updated:
- `useUpdateOrderStatus` (`src/hooks/useStaffOrders.ts`) — `onSuccess` now calls `invalidateOrderQueries(queryClient)`. Previous explicit `STAFF_ORDERS` invalidate now redundant (helper covers it) and removed.
- `useAdminCancelOrder` (`src/hooks/useAdminOrders.ts`) — `onSuccess` now calls `invalidateOrderQueries(queryClient)`. Wallet invalidate stays as a separate line since wallet isn't an order query — the cancel-refund consequence is independent.

**Not changed by explicit decision:**

- `AdminOrderDetailScreen`'s manual `refetch()` calls in handler closures are now redundant (cache invalidation now handles it) but were left in place. Cleanup queued separately — not folded into BF-09.
- `useCancelOrder` (customer-initiated cancel in `src/hooks/useOrders.ts`) has the same partial-invalidation pattern for the admin/driver side. Not changed in this commit. Queued as **MF-05** in Open decisions.
- `useAdminUpdateOrder` (`src/hooks/useAdminOrders.ts:86`) has the same gap pattern but is exported and never called anywhere in the `src/` tree — dead export. Leaving alone; either revive (call the helper) or delete in a Sprint 3 cleanup pass.

**Verification path:** with this commit deployed and Metro reloaded, retry the BF-04 walkthrough — as a driver, tap the status pill on a Dispatched order; the row should immediately reflect the new status without navigation. As an admin, tap "Advance Status" or "Cancel + Refund" in `AdminOrderDetailScreen`; the detail screen reflects immediately (manual `refetch()` covers this case), AND on back navigation the AdminOrdersScreen list shows the new status pill without staleness.

---

### BF-11: nextDeliveryStatus persona gating — driver vs hub-operator vs admin — RESOLVED 2026-05-03

**Symptom:** A driver assigned to a hub-routed order could advance it all the way through `Dispatched → Received at Hub → On the Way → Delivered` from `DriverDashboardScreen`, bypassing the hub operator's role entirely. The status-pill gating in `DeliveryOrderRow` only branched on `deliveryMethod`, not on the calling persona.

**Correct gating (verified by Shrikanth, 2026-05-03):**

| Order's `delivery_method` | Driver advances | Hub Operator advances | Admin advances |
|---|---|---|---|
| `'hub'` | `Dispatched → Received at Hub` (one step, then stops) | `Received at Hub → On the Way → Delivered` | full flow (omnipotent override) |
| `'direct'` | `Dispatched → On the Way → Delivered` (full flow) | N/A — defensive null | full flow |

**Fix:** Extracted `nextDeliveryStatus()` to `src/utils/deliveryStatus.ts` as the single source of truth. New signature accepts `persona: AdvancePersona = 'admin'`; default keeps backward-compat for any caller that hasn't been updated. Three call sites pass persona explicitly:

- `DriverDashboardScreen` → `<DeliveryOrderRow persona="driver" />`
- `HubDashboardScreen` → `<DeliveryOrderRow persona="hub_operator" />`
- `AdminOrderDetailScreen` → `nextDeliveryStatus(o.status, o.delivery_method, 'admin')` (explicit at callsite even though it matches the default — documents intent)

**Closes BF-08's queued cleanup item:** the duplicate `nextDeliveryStatus` copies in `DeliveryOrderRow.tsx` and `AdminOrderDetailScreen.tsx` (flagged as Sprint 3 cleanup in BF-08) are now consolidated into the new util. Annotation added on that BF-08 line above.

**Defensive `hub_operator` + `'direct'` returns null** — should never happen in practice (visibility filter in `useStaffOrders` excludes direct orders from hub op via `hub_id` match), but defensive in case visibility ever drifts.

**Files:** new `src/utils/deliveryStatus.ts`; `src/components/DeliveryOrderRow.tsx` (drop local copy, import, add `persona?: AdvancePersona` prop with default `'admin'`); `src/screens/customer/DriverDashboardScreen.tsx` (pass `persona="driver"`); `src/screens/customer/HubDashboardScreen.tsx` (pass `persona="hub_operator"`); `src/screens/admin/AdminOrderDetailScreen.tsx` (drop inline copy, import, pass `'admin'` explicitly).

---

### BF-12: Hub operator UPDATE on orders blocked by RLS — RESOLVED 2026-05-03

**Symptom:** Hub operator (`914444444444`, `role='customer'`, `assigned_hub_id=19`) couldn't UPDATE order status from Received at Hub onwards. Mutation fired client-side; BF-11's persona-aware gating correctly computed the next status; but the server rejected with RLS error: `new row violates row-level security policy for table "orders"`. Surfaced as the 6th sequential layer of breakage in the BF-04 hub-flow walkthrough (after the FK, screen merge, query invalidation, chip layout, persona gating fixes).

**Root cause:** the existing UPDATE policy `orders_staff_update` requires `is_staff_or_admin()`. Hub operators are customers (per BF-04's corrected persona model), so they fail the staff check. No hub-operator-specific UPDATE policy existed.

**Fix:** new RLS policy `orders_hub_operator_update` allowing UPDATE when `auth.jwt() ->> 'assigned_hub_id'` (cast to integer) matches `orders.hub_id`. WITH CHECK enforces the same predicate as USING — prevents the hub op from detaching the order from their hub mid-update. Persona-specific transition gating (Received at Hub → On the Way → Delivered only) is enforced client-side via BF-11's `nextDeliveryStatus(persona='hub_operator')` — layered defense: server says "yes, this hub op may write to this row"; client says "yes, this status transition is valid for this persona."

Reads `assigned_hub_id` from the JWT (injected by `custom_access_token_hook`) — no profiles table lookup, fast policy evaluation. Same pattern as the existing `staff_hub_orders` SELECT policy.

**Applied live to DB; persisted in repo** as new file `supabase/sql/add_orders_hub_operator_update_policy.sql` (idempotent `DROP IF EXISTS` / `CREATE` pattern). A fresh DB rebuild from `supabase/sql/` now includes the policy.

**Closes the BF-04 walkthrough's hub-flow test path.** End-to-end with all twelve fixes layered in: customer order → kitchen → packing → driver → hub → hub operator → delivered, all gated correctly per persona.

---

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

## One-off data corrections

> Manual SQL applied to fix point-in-time data drift. Not bug fixes (no code change required); not feature work. Logged here so the audit trail records what was changed, why, and what the corresponding code already does correctly.

### DC-01: Hub-routing backfill for orders 335/336/337 (2026-05-03)

These three test orders were generated by `generate_daily_manifest` before `Hub 1 Kolsirsi` was created. They snapshot-locked `delivery_method='direct'` and `hub_id=NULL` even though the customer's address now points to hub 19. Code is correct (snapshot semantics is the right design — in-flight orders shouldn't reroute when addresses change). One-off SQL UPDATE applied to fix the test data so we could exercise the hub flow during the BF-04 walkthrough. Going forward: orders generated after a hub exists pick up routing correctly. If a similar drift occurs in production after a feature flag flip, the broader backfill in BF-09's audit ("Option B") is the template.

---

### D-01: Subscription billing model — RESOLVED
- **Decision (2026-05-02, Shrikanth):** Model **(a)** — customer pays the full plan price upfront from wallet, no daily debits afterward. Plan price is all-inclusive (food + tax + delivery, all covered by the upfront charge). Same model applies for Razorpay-paid plans (already paid upfront, no daily charge).
- **Extension:** When admin cancels a subscription mid-plan, the prorated remaining amount is refunded to the customer's wallet.
- **Implication — confirmed bug to fix in `generate_daily_manifest`:** Currently the SQL debits the wallet daily for wallet-paid subscriptions on top of the upfront charge. This must be removed. The function should still *create* the daily order (so kitchen and dispatch see it) but with `wallet_amount_used = 0` and no wallet UPDATE.
- **Implication — Razorpay-paid subs:** Already correct (no daily debit happens). No change needed.
- **Sprint slot:** Sprint 1, item BF-01 (see Bug Fix Backlog below).

---

*Log started 2026-05-02 by Claude in planning session.*
