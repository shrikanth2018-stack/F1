-- ─────────────────────────────────────────────────────────────
-- MF-10 — Multi-cycle order grouping: orders.order_group_id
--
-- A single checkout can now contain items dispatching on different
-- delivery cycles / days. Each (cycle, dispatch_date) becomes its own
-- `orders` row — still a single-cycle fulfillment unit with one
-- status, one delivery, exactly as before. All rows produced by one
-- checkout share an order_group_id so the commercial concerns — one
-- payment, one Razorpay order, one customer-facing "order", one
-- whole-group cancellation — span them.
--
-- Money is recorded PER ROW (per-row model, MF-10): each row carries
-- its own subtotal + tax; the delivery fee sits on the earliest-
-- dispatch row only (charged once per order). SUM(orders.total_amount)
-- therefore stays correct and every row is self-describing for admin
-- refund decisions.
--
-- DEFAULT gen_random_uuid() means any insert that does not set the
-- column — notably generate_daily_manifest's subscription dispatch
-- rows — automatically gets its own standalone group of one. The
-- manifest is therefore untouched by MF-10.
--
-- Backfill: every existing order becomes its own group of one.
-- Additive only — no destructive DDL. Safe to re-run.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_group_id UUID;

-- Each existing order becomes a standalone group.
UPDATE orders SET order_group_id = gen_random_uuid() WHERE order_group_id IS NULL;

-- New rows auto-belong to a fresh group unless the caller overrides it
-- (place_order_atomic sets one shared id across a multi-cycle checkout).
ALTER TABLE orders ALTER COLUMN order_group_id SET DEFAULT gen_random_uuid();
ALTER TABLE orders ALTER COLUMN order_group_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_group ON orders(order_group_id);

-- Force PostgREST schema-cache reload so the new column is visible.
NOTIFY pgrst, 'reload schema';
