-- ─────────────────────────────────────────────────────────────
-- Schema gap migration: orders.delivery_address_id foreign key
--
-- The orders table has had a delivery_address_id column referencing
-- customer_addresses(id) since the schema was authored, but no
-- FOREIGN KEY constraint was ever defined on the live DB. Without
-- the FK, PostgREST cannot resolve the orders → customer_addresses
-- relationship for nested SELECTs (used by useStaffOrders) and
-- returns PGRST200 — broke the staff dashboard kitchen + packing
-- tabs entirely (BF-04, fixed live 2026-05-03).
--
-- Idempotent (DO-block constraint guard + NOTIFY for schema-cache
-- reload). Safe to re-run.
--
-- Run in Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────

-- 1. Add the missing FK ──────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_delivery_address_id_fkey'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_delivery_address_id_fkey
      FOREIGN KEY (delivery_address_id) REFERENCES customer_addresses(id);
  END IF;
END;
$$;

-- 2. Force PostgREST schema-cache reload ─────────────────────

NOTIFY pgrst, 'reload schema';
