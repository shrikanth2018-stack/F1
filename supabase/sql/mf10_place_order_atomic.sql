-- ─────────────────────────────────────────────────────────────
-- MF-10 — place_order_atomic, multi-cycle aware
--
-- A single checkout can span multiple delivery cycles / days. This
-- function inserts ONE `orders` row per dispatch group (each a
-- single-cycle fulfillment unit) plus that group's order_items, all
-- sharing one freshly-generated order_group_id, in a single
-- transaction. If any insert fails the whole checkout rolls back.
--
-- Money is per-row: each group element carries its own total_amount,
-- tax_amount, delivery_fee and wallet_amount_used. The caller
-- (place-order) computes them — it puts the delivery fee on the
-- earliest-dispatch group only, so SUM(orders.total_amount) stays
-- correct and each row is self-describing.
--
-- Shared (order-level) fields are scalar params; per-group fields
-- travel in p_groups JSONB. A single-cycle checkout is simply N=1.
--
-- place-order is the only caller. generate_daily_manifest inserts
-- orders directly and is NOT affected (its rows get a standalone
-- order_group_id from the column DEFAULT).
--
-- Replaces the prior single-order signature — that overload is
-- dropped explicitly so it cannot be called by stale clients.
--
-- p_groups element shape:
--   {
--     cycle_id, dispatch_date,
--     total_amount, tax_amount, delivery_fee, wallet_amount_used,
--     items: [{ item_id, item_type, item_name, quantity, price_at_time }]
--   }
--
-- Idempotent at deploy level: DROP IF EXISTS + CREATE OR REPLACE.
-- ─────────────────────────────────────────────────────────────

-- Drop the prior single-order overload (17-arg signature).
DROP FUNCTION IF EXISTS place_order_atomic(
  UUID, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, DATE, BIGINT,
  TEXT, BIGINT, TEXT, TEXT, NUMERIC, BIGINT, TEXT, BIGINT, JSONB
);

CREATE OR REPLACE FUNCTION place_order_atomic(
  p_user_id             UUID,
  p_status              TEXT,
  p_order_type          TEXT,
  p_delivery_method     TEXT,
  p_hub_id              BIGINT,
  p_payment_method      TEXT,
  p_razorpay_order_id   TEXT,
  p_delivery_address_id BIGINT,
  p_notes               TEXT,
  p_branch_id           BIGINT,
  p_groups              JSONB
)
RETURNS TABLE (
  new_order_id      BIGINT,
  new_group_id      UUID,
  new_cycle_id      BIGINT,
  new_dispatch_date DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_group    JSONB;
  v_order_id BIGINT;
  v_group_id UUID := gen_random_uuid();  -- one shared id for the whole checkout
BEGIN
  IF p_groups IS NULL OR jsonb_array_length(p_groups) = 0 THEN
    RAISE EXCEPTION 'place_order_atomic: p_groups must contain at least one dispatch group';
  END IF;

  FOR v_group IN SELECT * FROM jsonb_array_elements(p_groups)
  LOOP
    INSERT INTO orders (
      user_id, total_amount, tax_amount, delivery_fee, status, order_type,
      dispatch_date, cycle_id, delivery_method, hub_id, payment_method,
      razorpay_order_id, wallet_amount_used, delivery_address_id, notes,
      branch_id, order_group_id
    ) VALUES (
      p_user_id,
      (v_group->>'total_amount')::NUMERIC,
      (v_group->>'tax_amount')::NUMERIC,
      (v_group->>'delivery_fee')::NUMERIC,
      p_status,
      p_order_type,
      (v_group->>'dispatch_date')::DATE,
      (v_group->>'cycle_id')::BIGINT,
      p_delivery_method,
      p_hub_id,
      p_payment_method,
      p_razorpay_order_id,
      (v_group->>'wallet_amount_used')::NUMERIC,
      p_delivery_address_id,
      p_notes,
      p_branch_id,
      v_group_id
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
    FROM jsonb_array_elements(v_group->'items') AS item;

    new_order_id      := v_order_id;
    new_group_id      := v_group_id;
    new_cycle_id      := (v_group->>'cycle_id')::BIGINT;
    new_dispatch_date := (v_group->>'dispatch_date')::DATE;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Force PostgREST schema-cache reload so the new signature is callable.
NOTIFY pgrst, 'reload schema';
