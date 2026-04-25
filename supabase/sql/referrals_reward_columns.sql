-- ═══════════════════════════════════════════════════════════════════
-- 1stOne F1 — Referrals reward tracking columns (2026-04-25)
--
-- Context: code in src/hooks/useReferrals.ts references columns that
-- don't exist in the live DB. Without this migration, the reward
-- crediting flow throws at runtime when triggered.
--
-- All columns NULLABLE so existing rows are unaffected.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. referrals: per-row reward flags ────────────────────────
ALTER TABLE public.referrals
  ADD COLUMN IF NOT EXISTS first_order_reward_given BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS month_reward_given       BOOLEAN DEFAULT FALSE;

-- ── 2. referral_settings: reward-tier configuration ────────────
-- Local TS type ReferralSettings expects these; DB lacked them.
ALTER TABLE public.referral_settings
  ADD COLUMN IF NOT EXISTS referee_signup_credit         NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referrer_first_order_points   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referrer_first_order_credit   NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referrer_month_credit         NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS milestone_star_count          INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS milestone_ambassador_count    INTEGER DEFAULT 25;

COMMIT;

-- Verify (run separately):
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema='public' AND table_name IN ('referrals','referral_settings')
-- ORDER BY table_name, ordinal_position;
