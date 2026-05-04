-- ─────────────────────────────────────────────────────────────
-- 1stOne F1 — Schema migrations (idempotent)
-- Run in Supabase SQL editor AFTER the initial blueprint schema
-- and BEFORE rpc_atomic_increments.sql, idempotency_keys.sql,
-- generate_daily_manifest.sql, kitchen_cutoff_push.sql.
-- ─────────────────────────────────────────────────────────────

-- 1. Orders: razorpay payment fields + Pending/Failed support ──
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS paid_at             TIMESTAMPTZ;

-- 2. Orders: enforce positive amount + non-negative tax / fee ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_total_amount_positive'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_total_amount_positive
      CHECK (total_amount >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_tax_nonneg'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_tax_nonneg
      CHECK (tax_amount >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_fee_nonneg'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_fee_nonneg
      CHECK (delivery_fee >= 0);
  END IF;
END$$;

-- 3. Profiles: wallet + loyalty never negative ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_wallet_nonneg'
  ) THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_wallet_nonneg
      CHECK (wallet_balance >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_loyalty_nonneg'
  ) THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_loyalty_nonneg
      CHECK (loyalty_points >= 0);
  END IF;
END$$;

-- 4. Fast lookup for the verify-payment webhook ──
CREATE INDEX IF NOT EXISTS idx_orders_razorpay_order_id
  ON orders(razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;

-- 5. Extend orders.status allowed values (Pending / Paid / Failed) ──
-- status is stored as TEXT in the blueprint, so nothing enforces values
-- at the DB level today. We add an idempotent CHECK so future typos fail
-- loudly. The set covers the full fulfillment + payment lifecycle.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_status_allowed') THEN
    ALTER TABLE orders DROP CONSTRAINT orders_status_allowed;
  END IF;
  ALTER TABLE orders ADD CONSTRAINT orders_status_allowed CHECK (
    status IN (
      'Pending', 'Confirmed', 'Paid', 'Preparing', 'Ready', 'Packed',
      'Dispatched', 'Received at Hub', 'On the Way', 'Delivered',
      'Cancelled', 'Failed'
    )
  );
END$$;
