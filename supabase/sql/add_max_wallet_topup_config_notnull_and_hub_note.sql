-- ============================================================
-- 1stOne F1 — Task 2: config hardening
-- Applied to live DB 2026-05-18.
--
-- 1. max_wallet_topup column — replaces the hardcoded 50000 ceiling
--    that lived in the wallet-topup edge function.
-- 2. NOT NULL on the critical store_config columns — the order/money
--    edge functions now hard-fail on a missing or incomplete config
--    row instead of falling back to in-code numbers.
-- 3. admin_notes 'hub' target — the "Note to Staff" screen offers a
--    "Hub Staff" target, but the CHECK constraint rejected 'hub', so
--    saving a hub-targeted note failed. Constraint widened to allow it.
--
-- All changes are additive and safe to run on a populated DB.
-- ============================================================

ALTER TABLE store_config
  ADD COLUMN IF NOT EXISTS max_wallet_topup numeric NOT NULL DEFAULT 50000;

ALTER TABLE store_config ALTER COLUMN tax_rate_percentage       SET NOT NULL;
ALTER TABLE store_config ALTER COLUMN delivery_fee              SET NOT NULL;
ALTER TABLE store_config ALTER COLUMN cancellation_window_hours SET NOT NULL;
ALTER TABLE store_config ALTER COLUMN min_wallet_topup          SET NOT NULL;

ALTER TABLE admin_notes DROP CONSTRAINT IF EXISTS admin_notes_target_tab_check;
ALTER TABLE admin_notes ADD CONSTRAINT admin_notes_target_tab_check
  CHECK (target_tab IN ('kitchen', 'packing', 'delivery', 'all', 'hub'));
