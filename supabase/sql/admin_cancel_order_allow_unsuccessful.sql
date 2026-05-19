-- ============================================================
-- 1stOne F1 — admin_cancel_order_atomic: allow cancelling an
-- "unsuccessful delivery" order (audit D2 / Batch B2)
-- Applied to live DB 2026-05-19.
--
-- The RPC previously hard-blocked cancellation for ANY order at the
-- Dispatched / On the Way / Received at Hub stage. But a D2
-- "unsuccessful delivery" — an order past its dispatch date that never
-- got delivered — IS exactly one of those statuses, and the admin must
-- be able to close it out (mark cancelled).
--
-- New guard:
--   - 'Delivered'                       → never cancellable (completed).
--   - Dispatched / On the Way / At Hub  → cancellable ONLY when the order
--                                         is past its dispatch date (IST);
--                                         an in-window dispatch is still
--                                         blocked (it may yet be delivered).
--   - earlier statuses                  → unchanged (cancellable).
--
-- Everything else (admin gate, FOR UPDATE lock, wallet refund) is
-- byte-identical to the prior definition.
-- ============================================================

CREATE OR REPLACE FUNCTION "public"."admin_cancel_order_atomic"(
  "p_order_id" bigint,
  "p_refund_amount" numeric,
  "p_reason" "text" DEFAULT 'Cancelled by admin'::"text"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id        UUID;
  v_current_status TEXT;
  v_dispatch_date  DATE;
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
  SELECT user_id, status, dispatch_date
  INTO v_user_id, v_current_status, v_dispatch_date
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'order % not found', p_order_id;
  END IF;

  IF v_current_status = 'Cancelled' THEN
    RAISE EXCEPTION 'order % is already Cancelled', p_order_id;
  END IF;

  -- A delivered order is complete — never cancel/refund it.
  IF v_current_status = 'Delivered' THEN
    RAISE EXCEPTION 'order % is Delivered — cannot cancel a completed delivery', p_order_id;
  END IF;

  -- D2: a dispatched-stage order is cancellable ONLY once it is an
  -- "unsuccessful delivery" — past its dispatch date (IST), never delivered.
  -- A dispatch still within its window must not be cancelled (may yet land).
  IF v_current_status IN ('Dispatched', 'On the Way', 'Received at Hub')
     AND (v_dispatch_date IS NULL
          OR v_dispatch_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date) THEN
    RAISE EXCEPTION 'order % is % and still within its delivery window — cannot cancel',
      p_order_id, v_current_status;
  END IF;

  -- 1. Cancel the order, APPENDING the reason so prior notes survive.
  UPDATE orders
  SET status     = 'Cancelled',
      notes      = COALESCE(notes || ' | ', '') || '[Admin cancel: ' || p_reason || ']',
      updated_at = NOW()
  WHERE id = p_order_id;

  -- 2. Credit wallet (only if refund > 0). Uses existing
  -- increment_wallet_balance RPC so wallet logic stays centralized.
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
