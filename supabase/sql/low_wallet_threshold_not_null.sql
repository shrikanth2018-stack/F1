-- ============================================================
-- 1stOne F1 — low_wallet_threshold NOT NULL (audit D34)
-- Applied to live DB 2026-05-19.
--
-- The column already carries DEFAULT 200 and the singleton store_config
-- row is non-null — this just enforces NOT NULL so low-wallet-check no
-- longer needs a hardcoded `?? 200` fallback. Same config-hardening the
-- 5 money-critical store_config columns got in Task 2.
-- ============================================================

ALTER TABLE public.store_config
  ALTER COLUMN low_wallet_threshold SET NOT NULL;
