-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — an admin refund says which order it was for (2026-08-04)
--
-- Found during the 360 walkthrough. Both admin cancel RPCs credited the wallet
-- with the three-argument form of increment_wallet_balance, so the refund
-- landed with reference_type and reference_id NULL:
--
--   credit ₹100.00  ref=—  id=—  Refund — order #11484 cancelled by admin
--
-- The money is right and the description names the order, but nothing
-- MACHINE-readable ties the two together. The customer-facing path has always
-- passed 'order_refund' + the order id (cancel-order/index.ts), so the same
-- refund was traceable or not depending purely on who pressed cancel.
--
-- Both are fixed, not just the one the walk hit. Fixing the order path alone
-- would leave the subscription path as the only untagged credit in the ledger,
-- which is a worse place to end up than where this started.
--
-- TAKEN FROM THE LIVE DEFINITIONS, not from the repo files: two files in
-- supabase/sql/ define admin_cancel_order_atomic (admin_cancel_order_atomic_rpc
-- and admin_cancel_order_allow_unsuccessful) and the live one is what matters.
-- Only the credit call changed; every guard, status check and return shape is
-- byte-identical to what was deployed.
--
-- Deploy: supabase db query --linked --file supabase/sql/admin_refund_reference.sql
-- Idempotent. Rollback: drop the two extra arguments from each call.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_cancel_order_atomic(p_order_id bigint, p_refund_amount numeric, p_reason text DEFAULT 'Cancelled by admin'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'Refund — order #' || p_order_id || ' cancelled by admin',
      'order_refund',
      p_order_id::text
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
$function$;


CREATE OR REPLACE FUNCTION public.admin_cancel_subscription_atomic(p_subscription_id bigint, p_refund_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id     UUID;
  v_sub_active  BOOLEAN;
  v_admin_id    UUID;
BEGIN
  -- Gate: only admin can cancel + refund a subscription
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized: only admin may cancel subscriptions';
  END IF;

  v_admin_id := auth.uid();

  -- Validate inputs
  IF p_refund_amount IS NULL OR p_refund_amount < 0 THEN
    RAISE EXCEPTION 'refund amount must be >= 0 (got %)', p_refund_amount;
  END IF;

  -- Lock the subscription row + read state. FOR UPDATE prevents two
  -- concurrent admin cancellations from both processing the same row.
  SELECT user_id, is_active
  INTO v_user_id, v_sub_active
  FROM user_subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'subscription % not found', p_subscription_id;
  END IF;

  IF NOT v_sub_active THEN
    RAISE EXCEPTION 'subscription % is already inactive — cannot cancel again', p_subscription_id;
  END IF;

  -- 1. Deactivate subscription
  UPDATE user_subscriptions
  SET is_active   = FALSE,
      is_paused   = FALSE,
      updated_at  = NOW()
  WHERE id = p_subscription_id;

  -- 2. Credit wallet (only if refund > 0).
  -- Uses existing increment_wallet_balance RPC — wallet logic
  -- (UPDATE profiles + INSERT wallet_transactions) stays centralized
  -- there. Both calls run in this function's transaction; if either
  -- raises, the whole atomic flow rolls back.
  IF p_refund_amount > 0 THEN
    PERFORM public.increment_wallet_balance(
      v_user_id,
      p_refund_amount,
      'Prorated refund — subscription #' || p_subscription_id || ' cancelled by admin',
      'subscription_refund',
      p_subscription_id::text
    );
  END IF;

  -- Return summary for client confirmation UI
  RETURN jsonb_build_object(
    'subscription_id', p_subscription_id,
    'user_id',         v_user_id,
    'refund_amount',   p_refund_amount,
    'cancelled_at',    NOW(),
    'cancelled_by',    v_admin_id
  );
END;
$function$;


NOTIFY pgrst, 'reload schema';
