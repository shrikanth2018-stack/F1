# Phase 2 Kickoff — Context Primer

> Paste this as your first message to a fresh Claude Code session before doing any work. It loads the correct context, names the canonical references, and lists the corrections to Phase 1 that have been settled through joint investigation.

---

## What this session is for

You are continuing work on the **1stOne F1** app — a meal and essentials delivery service for Siddapur (Karnataka), with mobile (Expo), web (`app.1stone.in`), and a static landing page (`1stone.in`), all on a single Supabase backend. You are picking up after Phase 1 (read-only audit) and a context-setting planning session.

**Your job in this session is defined by what I ask after this primer.** Do not start work until I give a specific request.

## Required reading — in this order

Read these four files completely before responding to anything:

1. **`~/Documents/F1/1stOne-F1/MASTER_DOCUMENT.md`** (also available as `1stOne_F1_Master_Document.docx`)
   The canonical product, business, architectural, and operational reference. Includes Annexure A (operational runbook). Treat this as the source of truth for *intent and design*.

2. **`PHASE1_OUTPUT.md` and `PHASE1_MEMORY.md`** (in `~/Desktop/SC-Claude/MAX/` or wherever Shrikanth stored them)
   Phase 1 audit findings. Useful starting context, but **several findings have been corrected since publication** — see the "Phase 1 corrections" section below.

3. **`decisions.md`** (will be provided alongside this primer)
   The running record of every decision and clarification reached jointly between Shrikanth and Claude. **This file overrides Phase 1 wherever they disagree.** It also captures cleanup queue, bug fix backlog, real-app verification queue, and architecture clarifications.

4. **`phase2-working-rules.md`** (will be provided alongside this primer)
   The rules of engagement for change requests: output format, approval gates, plain-English communication, etc.

## Source-of-truth hierarchy

When sources conflict:
1. Live system (run a query against Supabase, check function logs, etc.) — empirical evidence wins everything
2. `decisions.md` — joint decisions, supersedes both Phase 1 and the master doc on contested points
3. Master Document — canonical product/business reference
4. Live code in the repo
5. Phase 1 audit output — useful but partially superseded
6. SYSTEM_FLOWS.md and older docs — historical context only; subscription section materially out of date

## Phase 1 corrections (binding — do not re-discover these)

These items were investigated jointly with Shrikanth on 2026-05-02. Treat as resolved:

1. **Two parallel auto-order generators are NOT both running:** The per-cycle SQL job (`kitchen-cutoff-push-tick`, every minute) is canonical. The 23:00 IST nightly batch (`generate-daily-manifest`) is a deliberate safety-net for late-day subscription purchases. Both call the same underlying SQL function. The third candidate Phase 1 worried about (`subscription-cron` Edge Function) is **not deployed** — it exists only in the code repo as dead code.

2. **`subscribe` Edge Function is NOT deployed.** Exists in code repo only. No production risk. Slated for repo deletion in Sprint 2.

3. **`confirm-order-payment` is a stale duplicate of `confirm-order`.** Verified by live test — `confirm-order` fires for one-off orders, `confirm-order-payment` has zero invocations. Slated for deletion in Sprint 2.

4. **`razorpay-webhook` is legacy/never-called.** Deployed but never receives traffic. The active webhook is `verify-payment`. Slated for deletion in Sprint 2.

5. **`verify-payment` IS configured and IS firing.** Confirmed by live subscription-payment test on 2026-05-02. Webhook safety net is in place; no D-02 decision needed.

6. **Subscription billing model is (a):** customer pays full plan price upfront (wallet or Razorpay), no daily debits afterward. Pause/skip extends duration; admin cancellation refunds prorated remaining amount **always to wallet** (regardless of original payment method).

7. **CONFIRMED BUG to fix in Sprint 1 (BF-01):** `generate_daily_manifest` SQL currently debits the wallet daily for wallet-paid subscriptions on top of the upfront charge. Per billing model decision, this must be removed. Daily order should still be created but with `wallet_amount_used = 0` and no wallet UPDATE.

8. **`staff_leaves` (plural) is the correct table name** — `rls_policies.sql`'s reference to `staff_leave` (singular) is a typo to fix before any RLS deploy.

9. **Service-role key in `deploy.sh` is the OLD revoked key** — security risk is low, cleanup is hygiene only.

10. **The customer home screen has TWO tabs (Meal and Essentials)**, plus a separate Plans flow with one-plan-in-cart invariant for subscriptions. (Implementation: separate `cartStore` + `essentialsCartStore` + subscription plan-buy flow via `place-order`.)

## Items still needing live-app verification (V-queue)

These were assumed-working based on prior audits but never personally tested by Shrikanth:

- **V-01:** Admin subscription cancellation — does the UI actually show prorated amount, allow editing, and credit wallet automatically?
- **V-02:** Plan items source-of-truth — when admin creates a plan, are items written to `subscription_plans.plan_items` JSON, the `subscription_plan_items` table, or both? Does a newly-purchased plan generate orders with correct items?
- **V-03:** Live wallet-debit behavior — confirm `generate_daily_manifest` actually does double-debit (the bug BF-01 will fix).
- **V-04:** Late-day subscription purchase — does the 23:00 batch sweep up subscriptions purchased after the cycle's cutoff?

Some of these can be verified by reading code (V-01, V-02). Others require live testing on a real device (V-03, V-04).

## Working rules — short version

(Full version in `phase2-working-rules.md`.)

- Plain English — Shrikanth is a business owner, not a developer.
- Translate technical terms the first time they appear in a response.
- For change requests: produce the structured response (Understanding → Root cause → Impact check → Approach → Rollback → Approval gate) before writing code.
- For questions, status checks, clarifications: just answer.
- Smallest safe change wins. Preserve existing behavior unless explicitly approved otherwise.
- Push back if my requested change is unsafe or misguided — don't just comply.

## What to do right now

1. Confirm you've read all four files above.
2. Confirm you've internalized the Phase 1 corrections (don't re-discover them).
3. Tell me you're ready, then wait for my actual request.

Do not start any code work until I give a specific request. Do not propose improvements unsolicited. Do not refactor.
