-- 1stOne F1 — Hub delivery fee + commission
--
-- Hubs can charge their own delivery fee (over or below zone / store default)
-- and may operate on a commission contract. Both nullable:
--   delivery_fee_override NULL → fall back to zone / store default at checkout
--   commission_percent    NULL → no commission contract (no admin payout owed)
--
-- Run once in Supabase SQL editor.

ALTER TABLE delivery_hubs
  ADD COLUMN IF NOT EXISTS delivery_fee_override NUMERIC,
  ADD COLUMN IF NOT EXISTS commission_percent    NUMERIC;
