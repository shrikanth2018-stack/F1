-- ─────────────────────────────────────────────────────────────
-- BF-34a (F3.1): admin_cancel_order_atomic RPC
--
-- Mirrors BF-20's admin_cancel_subscription_atomic — single Postgres
-- transaction for admin-initiated order cancellation + optional wallet
-- refund. Replaces the previous two-step client-side flow in
-- useAdminCancelOrder which risked "order cancelled but wallet not
-- refunded" if the network failed between the UPDATE and the RPC call.
--
-- Notes handling: previous flow REPLACED orders.notes with the cancel
-- reason, clobbering legitimate delivery instructions ("Please ring
-- doorbell"). This RPC APPENDS the cancel marker so prior notes survive.
--
-- Refund destination is always the customer's wallet (consistent with
-- D-01 / BF-20). Razorpay portion (if any) remains a manual admin
-- action via the Razorpay dashboard — same contract as the customer
-- cancel-order Edge Function.
--
-- Gating: SECURITY DEFINER + is_admin() check at entry. Customers and
-- staff cannot call this RPC. Refund flows through the existing
-- increment_wallet_balance RPC so wallet ledger logic stays centralized.
--
-- Status guards: rejects if order is already Cancelled (idempotent at
-- row level) or already past Dispatched (operational consistency —
-- once the kitchen / hub has the order, cancellation is no longer a
-- pure-software action).
--
-- Idempotent at deploy level: CREATE OR REPLACE + REVOKE/GRANT.
-- Run via supabase db query --file --linked.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_cancel_order_atomic(
  p_order_id      BIGINT,
  p_refund_amount NUMERIC,
  p_reason        TEXT DEFAULT 'Cancelled by admin'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID;
  v_current_status TEXT;
  v_admin_id       UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized: only admin may cancel orders';
  END IF;

  v_admin_id := auth.uid();

  IF p_refund_amount IS NULL OR p_refund_amount < 0 THEN
    RAISE EXCEPTION 'refund amount must be >= 0 (got %)', p_refund_amount;
  END IF;

  -- Lock the order row + read current state. FOR UPDATE prevents two
  -- concurrent admin cancellations from both processing the same row.
  SELECT user_id, status
  INTO v_user_id, v_current_status
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'order % not found', p_order_id;
  END IF;

  IF v_current_status = 'Cancelled' THEN
    RAISE EXCEPTION 'order % is already Cancelled', p_order_id;
  END IF;

  -- Once dispatched, cancellation isn't a pure-software action.
  -- Mirror cancel-order's cycle-cutoff guard at the operational level.
  IF v_current_status IN ('Dispatched', 'On the Way', 'Received at Hub', 'Delivered') THEN
    RAISE EXCEPTION 'order % is % — cannot cancel after dispatch', p_order_id, v_current_status;
  END IF;

  -- 1. Cancel the order, APPENDING the reason so prior notes survive.
  UPDATE orders
  SET status     = 'Cancelled',
      notes      = COALESCE(notes || ' | ', '') || '[Admin cancel: ' || p_reason || ']',
      updated_at = NOW()
  WHERE id = p_order_id;

  -- 2. Credit wallet (only if refund > 0). Uses existing
  -- increment_wallet_balance RPC so wallet logic stays centralized.
  -- Both run in this function's transaction; if either raises, the
  -- whole atomic flow rolls back.
  IF p_refund_amount > 0 THEN
    PERFORM public.increment_wallet_balance(
      v_user_id,
      p_refund_amount,
      'Refund — order #' || p_order_id || ' cancelled by admin'
    );
  END IF;

  RETURN jsonb_build_object(
    'order_id',      p_order_id,
    'user_id',       v_user_id,
    'refund_amount', p_refund_amount,
    'cancelled_at',  NOW(),
    'cancelled_by',  v_admin_id
  );
END;
$$;

-- Lock down: callable only by authenticated users. The is_admin()
-- check inside the body filters non-admin authenticated callers.
REVOKE ALL ON FUNCTION public.admin_cancel_order_atomic(BIGINT, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_cancel_order_atomic(BIGINT, NUMERIC, TEXT) TO authenticated;

-- Force PostgREST schema-cache reload so the RPC becomes callable
NOTIFY pgrst, 'reload schema';
