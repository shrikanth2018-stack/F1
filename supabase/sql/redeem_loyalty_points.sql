-- ============================================================
-- 1stOne F1 — Loyalty points redemption (audit D1)
-- Applied to live DB 2026-05-19.
--
-- Customer redeems loyalty points for wallet credit at 1 point = ₹1.
-- Wallet credit is then spendable on any future order — satisfying the
-- documented "redeem against future orders" without threading points
-- through the order path.
--
-- Atomic: the whole thing runs in one function = one transaction. The
-- caller's profile row is locked FOR UPDATE so the balance check and the
-- debit cannot race (same guard pattern as
-- decrement_wallet_balance_if_sufficient).
-- ============================================================

CREATE OR REPLACE FUNCTION public.redeem_loyalty_points(p_points integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_have    integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_points IS NULL OR p_points <= 0 THEN
    RAISE EXCEPTION 'Enter a positive number of points to redeem';
  END IF;

  -- Lock the caller's profile so check + debit are atomic (no race).
  SELECT loyalty_points INTO v_have
  FROM profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF v_have IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;
  IF v_have < p_points THEN
    RAISE EXCEPTION 'Not enough points — you have %', v_have;
  END IF;

  -- 1 point = ₹1. Debit points, credit wallet in one statement.
  UPDATE profiles
  SET loyalty_points = loyalty_points - p_points,
      wallet_balance = wallet_balance + p_points
  WHERE id = v_user_id;

  -- Audit trail — loyalty ledger + wallet ledger.
  -- type must satisfy loyalty_redemptions_type_check ('earned' | 'redeemed').
  -- Previously inserted 'redeem' — a constraint violation that rolled back
  -- the whole redemption (audit D4 fix).
  INSERT INTO loyalty_redemptions (user_id, points, type, description)
  VALUES (v_user_id, p_points, 'redeemed',
          'Redeemed ' || p_points || ' points for wallet credit');

  INSERT INTO wallet_transactions (user_id, amount, transaction_type, description, reference_type)
  VALUES (v_user_id, p_points, 'credit',
          'Loyalty points redeemed (' || p_points || ' pts)', 'loyalty_redemption');

  RETURN jsonb_build_object(
    'redeemed_points',          p_points,
    'wallet_credited',          p_points,
    'loyalty_points_remaining', v_have - p_points
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_loyalty_points(integer) TO authenticated;
