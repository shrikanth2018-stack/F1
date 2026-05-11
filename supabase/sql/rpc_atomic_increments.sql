-- ─────────────────────────────────────────────────────────────
-- Atomic wallet / loyalty / order RPCs for 1stOne F1
-- Run in Supabase SQL editor: Dashboard → SQL Editor → New query
--
-- All functions are SECURITY DEFINER so they bypass RLS.
-- Client code must NEVER use anon key to touch profiles.wallet_balance
-- directly once RLS is on.
-- ─────────────────────────────────────────────────────────────


-- 1. Credit wallet ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_wallet_balance(
  p_user_id     UUID,
  p_amount      NUMERIC,
  p_description TEXT DEFAULT ''
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles
  SET wallet_balance = wallet_balance + p_amount
  WHERE id = p_user_id;

  INSERT INTO wallet_transactions (user_id, transaction_type, amount, description)
  VALUES (p_user_id, 'credit', p_amount, p_description);
END;
$$;


-- 2. Debit wallet atomically, only if sufficient ──────────────
-- Returns TRUE if debit succeeded, FALSE if balance was too low.
-- Uses row-level lock (FOR UPDATE) so two concurrent callers
-- can never both pass the check-and-decrement race.
CREATE OR REPLACE FUNCTION decrement_wallet_balance_if_sufficient(
  p_user_id     UUID,
  p_amount      NUMERIC,
  p_description TEXT DEFAULT 'Order payment'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  SELECT wallet_balance
  INTO v_balance
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF v_balance IS NULL OR v_balance < p_amount THEN
    RETURN FALSE;
  END IF;

  UPDATE profiles
  SET wallet_balance = wallet_balance - p_amount
  WHERE id = p_user_id;

  INSERT INTO wallet_transactions (user_id, transaction_type, amount, description)
  VALUES (p_user_id, 'debit', p_amount, p_description);

  RETURN TRUE;
END;
$$;


-- 3. Loyalty points ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_loyalty_points(
  p_user_id UUID,
  p_points  INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles
  SET loyalty_points = loyalty_points + p_points
  WHERE id = p_user_id;
END;
$$;


-- 4. Atomic order insert (order + order_items in one tx) ─────
-- Returns the new order id. If order_items insert fails, the
-- order row is rolled back by the implicit function transaction.
CREATE OR REPLACE FUNCTION place_order_atomic(
  p_user_id             UUID,
  p_total_amount        NUMERIC,
  p_tax_amount          NUMERIC,
  p_delivery_fee        NUMERIC,
  p_status              TEXT,
  p_order_type          TEXT,
  p_dispatch_date       DATE,
  p_cycle_id            BIGINT,
  p_delivery_method     TEXT,
  p_hub_id              BIGINT,
  p_payment_method      TEXT,
  p_razorpay_order_id   TEXT,
  p_wallet_amount_used  NUMERIC,
  p_delivery_address_id BIGINT,
  p_notes               TEXT,
  p_branch_id           BIGINT,
  p_items               JSONB  -- array of { item_id, item_type, item_name, quantity, price_at_time }
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id BIGINT;
BEGIN
  INSERT INTO orders (
    user_id, total_amount, tax_amount, delivery_fee, status, order_type,
    dispatch_date, cycle_id, delivery_method, hub_id, payment_method,
    razorpay_order_id, wallet_amount_used, delivery_address_id, notes, branch_id
  ) VALUES (
    p_user_id, p_total_amount, p_tax_amount, p_delivery_fee, p_status, p_order_type,
    p_dispatch_date, p_cycle_id, p_delivery_method, p_hub_id, p_payment_method,
    p_razorpay_order_id, p_wallet_amount_used, p_delivery_address_id, p_notes, p_branch_id
  )
  RETURNING id INTO v_order_id;

  INSERT INTO order_items (order_id, item_id, item_type, item_name, quantity, price_at_time)
  SELECT
    v_order_id,
    (item->>'item_id')::BIGINT,
    item->>'item_type',
    item->>'item_name',
    (item->>'quantity')::INTEGER,
    (item->>'price_at_time')::NUMERIC
  FROM jsonb_array_elements(p_items) AS item;

  RETURN v_order_id;
END;
$$;


-- 5. Mark razorpay order as Paid (called from verify-payment webhook) ──
CREATE OR REPLACE FUNCTION mark_order_paid(
  p_razorpay_order_id   TEXT,
  p_razorpay_payment_id TEXT
)
RETURNS TABLE (order_id BIGINT, user_id UUID, total_amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- BF-32a: Webhook + confirm-order paths now write the same status
  -- literal so downstream surfaces (statusColor, statusVariant, Packing
  -- advance) don't have to handle two values for the same state.
  RETURN QUERY
  UPDATE orders
  SET status = 'Confirmed',
      razorpay_payment_id = p_razorpay_payment_id,
      paid_at = NOW()
  WHERE razorpay_order_id = p_razorpay_order_id
    AND status = 'Pending'
  RETURNING orders.id, orders.user_id, orders.total_amount;
END;
$$;


-- 6. Mark razorpay order as Failed (called from verify-payment webhook) ──
CREATE OR REPLACE FUNCTION mark_order_failed(
  p_razorpay_order_id TEXT,
  p_reason            TEXT DEFAULT 'payment_failed'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE orders
  SET status = 'Failed',
      notes  = COALESCE(notes || ' | ', '') || p_reason
  WHERE razorpay_order_id = p_razorpay_order_id
    AND status = 'Pending';
END;
$$;


-- 7. Wallet topup — create a pending topup row (called from wallet-topup fn) ──
-- pending_wallet_topups is a lightweight table tracking razorpay topup orders;
-- verify-payment flips them to completed and credits the wallet.
CREATE TABLE IF NOT EXISTS pending_wallet_topups (
  razorpay_order_id TEXT PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES profiles(id),
  amount            NUMERIC NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending', -- pending | completed | failed
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION complete_wallet_topup(
  p_razorpay_order_id   TEXT,
  p_razorpay_payment_id TEXT
)
RETURNS TABLE (user_id UUID, amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_amount  NUMERIC;
BEGIN
  UPDATE pending_wallet_topups
  SET status       = 'completed',
      completed_at = NOW()
  WHERE razorpay_order_id = p_razorpay_order_id
    AND status = 'pending'
  RETURNING pending_wallet_topups.user_id, pending_wallet_topups.amount
  INTO v_user_id, v_amount;

  IF v_user_id IS NOT NULL THEN
    PERFORM increment_wallet_balance(
      v_user_id,
      v_amount,
      'Wallet topup via Razorpay ' || p_razorpay_payment_id
    );
  END IF;

  RETURN QUERY SELECT v_user_id, v_amount;
END;
$$;
