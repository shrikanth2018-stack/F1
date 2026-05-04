-- ─────────────────────────────────────────────────────────────
-- BF-20 (D-03b): admin_cancel_subscription_atomic RPC
--
-- Replaces the previous two-step cancel-then-refund flow with a
-- single atomic Postgres function. Previously the client did:
--   1. UPDATE user_subscriptions SET is_active = false  (one call)
--   2. CALL increment_wallet_balance(...)                (separate call)
--      └─ which itself does UPDATE profiles + INSERT wallet_transactions
--
-- If step 1 succeeded but the network failed before step 2 ran, the
-- customer was cancelled with no refund. Probability low, impact real.
--
-- This RPC consolidates both into a single function. Postgres functions
-- run in a single transaction by default — if any statement raises,
-- everything rolls back. Customer is either fully cancelled with refund,
-- or not cancelled at all.
--
-- Refund destination is always the customer's wallet (per D-01 — the
-- subscription billing model decision: prorated remaining amount goes
-- to wallet regardless of original payment method).
--
-- Gating: SECURITY DEFINER + is_admin() check at entry. Customers and
-- staff cannot call this RPC. The wallet credit step uses the existing
-- increment_wallet_balance RPC for centralized wallet logic.
--
-- Idempotent at row level: if the subscription is already inactive,
-- raises an error (caller can decide what to do). Cannot accidentally
-- refund twice for the same cancellation.
--
-- Idempotent at deploy level: CREATE OR REPLACE FUNCTION + REVOKE/GRANT
-- pattern. Safe to re-run.
--
-- Run in Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_cancel_subscription_atomic(
  p_subscription_id BIGINT,
  p_refund_amount   NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      'Prorated refund — subscription #' || p_subscription_id || ' cancelled by admin'
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
$$;

-- Lock down: callable only by authenticated users. The is_admin()
-- check inside the body filters non-admin authenticated users.
REVOKE ALL ON FUNCTION public.admin_cancel_subscription_atomic(BIGINT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_cancel_subscription_atomic(BIGINT, NUMERIC) TO authenticated;

-- Force PostgREST schema-cache reload so the RPC becomes callable
NOTIFY pgrst, 'reload schema';
