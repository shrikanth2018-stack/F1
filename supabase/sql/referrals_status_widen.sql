-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — The referral reward pipeline pays, then fails to record it
-- (2026-08-06)
--
-- `referrals_status_check` allows only ('pending','completed','expired') and
-- has never been widened, but the lifecycle grew two more states and BOTH
-- writers use them:
--
--   handle_first_order_referral_bonus  →  'first_order_done'   INVALID
--   useReferrals.useIssueMonthBonus    →  'month_complete'     INVALID
--
-- and BOTH are what the customer's own screen reads —
-- `ReferralScreen.tsx:51,130` colours and filters on exactly those two, so
-- a referral can never visibly progress past "pending".
--
-- WHY THIS IS A MONEY BUG, not a cosmetic one. Look at the ORDER of the
-- trigger's steps: it credits the referrer's wallet, credits their loyalty
-- points, and only THEN marks the referral. The mark is the statement that
-- violates the CHECK, so the credit lands and `first_order_reward_given`
-- stays FALSE — and `first_order_reward_given` is the idempotency guard.
-- The trigger's own EXCEPTION handler turns the failure into a RAISE
-- WARNING, so nothing surfaces anywhere.
--
-- Proven against production, rolled back:
--
--   wallet 1740.00 → 1770.00     the ₹30 bonus was paid
--   first_order_reward_given     still false
--   status                       still 'pending'
--
-- The only thing then standing between a referrer and a repeat payment is
-- the trigger's `v_order_count <> 1` test — so a referee whose first order
-- is cancelled and replaced brings the count back to 1 and pays the referrer
-- again. Repeatably, and silently.
--
-- This is the `expense_claims` mistake in a different table. CLAUDE.md §9
-- already records the rule it breaks: "add the value in the same file that
-- introduces a new claim category." Two features have now shipped a new
-- referral state without touching the constraint.
--
-- FIXING THE CONSTRAINT, NOT THE WRITERS, is the right direction here: the
-- two new states are the intended design (the customer screen is built
-- around them), and the constraint is the thing that was never updated.
-- 'completed' and 'expired' are kept so any legacy row stays valid, exactly
-- as expense_claims_categories_widen.sql kept 'Expense'.
--
-- Deploy: supabase db query --linked --file supabase/sql/referrals_status_widen.sql
-- Idempotent. Safe to re-run. Rollback at the bottom.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.referrals DROP CONSTRAINT IF EXISTS referrals_status_check;

ALTER TABLE public.referrals
  ADD CONSTRAINT referrals_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,           -- created by apply-referral
    'first_order_done'::text,  -- set by handle_first_order_referral_bonus
    'month_complete'::text,    -- set by admin_issue_referral_month_bonus
    'completed'::text,         -- legacy
    'expired'::text            -- legacy
  ]));

COMMENT ON CONSTRAINT referrals_status_check ON public.referrals IS
  'Every state the referral lifecycle actually writes. first_order_done and month_complete were in use by the trigger and the admin screen long before they were permitted here — which let the wallet be credited while the row went unmarked, defeating first_order_reward_given as an idempotency guard. Add the value HERE in the same change that introduces a new state.';

NOTIFY pgrst, 'reload schema';

-- ── Verification ───────────────────────────────────────────────
-- The trigger's own marking statement must now succeed, which is what makes
-- first_order_reward_given usable as the guard it was meant to be:
--
--   BEGIN;
--     INSERT INTO referrals (id, referrer_id, referee_id, status,
--                            reward_given, first_order_reward_given)
--     VALUES (999999, '<referrer>', '<referee>', 'pending', false, false);
--     UPDATE referrals SET status='first_order_done',
--            first_order_reward_given=TRUE, reward_given=TRUE WHERE id=999999;
--     SELECT status, first_order_reward_given FROM referrals WHERE id=999999;
--     -- expect: first_order_done | true
--   ROLLBACK;

-- ── Rollback ───────────────────────────────────────────────────
-- Restores the bug. Only safe while no row carries one of the new states.
-- ALTER TABLE public.referrals DROP CONSTRAINT referrals_status_check;
-- ALTER TABLE public.referrals ADD CONSTRAINT referrals_status_check
--   CHECK (status = ANY (ARRAY['pending'::text,'completed'::text,'expired'::text]));
