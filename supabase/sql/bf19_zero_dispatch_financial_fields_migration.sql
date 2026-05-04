-- ─────────────────────────────────────────────────────────────
-- BF-19 historical migration: zero out financial fields on existing
-- subscription dispatch orders.
--
-- Why: BF-19 changes generate_daily_manifest to set total_amount =
-- tax_amount = delivery_fee = 0 on all NEW dispatch rows going forward
-- (revenue is captured at original subscription purchase, not on each
-- daily dispatch). This migration retro-cleans existing rows so admin
-- revenue reports (SUM(orders.total_amount)) become consistent
-- immediately, not just for new dispatches.
--
-- Identifying dispatch rows safely:
--   Dispatch rows have subscription_id NOT NULL AND there is an earlier
--   order with the same subscription_id (the original purchase). The
--   original purchase has subscription_id set but no earlier order
--   exists for that subscription, so this filter preserves the
--   purchase and zeros only the dispatches.
--
-- Idempotent: setting already-zero fields to zero is a no-op.
-- Safe to re-run.
--
-- Run AFTER applying the updated generate_daily_manifest.sql.
-- ─────────────────────────────────────────────────────────────

UPDATE orders d
SET total_amount = 0,
    tax_amount   = 0,
    delivery_fee = 0
WHERE d.subscription_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM orders parent
    WHERE parent.subscription_id = d.subscription_id
      AND parent.id < d.id
  );

-- Verification (optional, paste separately to check):
--
-- -- Number of dispatch rows now zeroed
-- SELECT COUNT(*) AS dispatch_rows_zeroed
-- FROM orders d
-- WHERE d.subscription_id IS NOT NULL
--   AND d.total_amount = 0
--   AND EXISTS (
--     SELECT 1 FROM orders parent
--     WHERE parent.subscription_id = d.subscription_id
--       AND parent.id < d.id
--   );
--
-- -- Sample row check: original purchase preserved, dispatches at 0
-- SELECT subscription_id, dispatch_date, total_amount, tax_amount, delivery_fee
-- FROM orders
-- WHERE subscription_id IN (
--   SELECT subscription_id FROM orders
--   WHERE subscription_id IS NOT NULL
--   GROUP BY subscription_id
--   HAVING COUNT(*) > 1
--   LIMIT 1
-- )
-- ORDER BY id;
