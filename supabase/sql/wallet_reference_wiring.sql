-- 1stOne F1 — Wire reference_type / reference_id on every wallet_transactions
-- insertion path, plus name the order # on order-payment debits.
--
-- Today, wallet_transactions.reference_type / reference_id are null on most
-- rows. Finding "all wallet activity for order N" requires grepping the
-- description string across 5+ formats. After this migration, every new
-- transaction row carries a structured (reference_type, reference_id) so
-- a future reconciliation / audit query can join cleanly.

-- Drop the older 3-arg signatures so CREATE OR REPLACE below installs the
-- new versions in place instead of co-existing as overloads (which would
-- leave the old code paths live for any caller still passing 3 args).
DROP FUNCTION IF EXISTS public.increment_wallet_balance(UUID, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.decrement_wallet_balance_if_sufficient(UUID, NUMERIC, TEXT);

-- ── 1. Credit RPC — accept reference fields ────────────────────────

CREATE OR REPLACE FUNCTION public.increment_wallet_balance(
  p_user_id        UUID,
  p_amount         NUMERIC,
  p_description    TEXT DEFAULT '',
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id   TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles
  SET wallet_balance = wallet_balance + p_amount
  WHERE id = p_user_id;

  INSERT INTO wallet_transactions
    (user_id, transaction_type, amount, description, reference_type, reference_id)
  VALUES
    (p_user_id, 'credit', p_amount, p_description, p_reference_type, p_reference_id);
END;
$$;

-- ── 2. Debit RPC — accept reference fields ─────────────────────────

CREATE OR REPLACE FUNCTION public.decrement_wallet_balance_if_sufficient(
  p_user_id        UUID,
  p_amount         NUMERIC,
  p_description    TEXT DEFAULT 'Order payment',
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id   TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  SELECT wallet_balance INTO v_balance
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF v_balance IS NULL OR v_balance < p_amount THEN
    RETURN FALSE;
  END IF;

  UPDATE profiles
  SET wallet_balance = wallet_balance - p_amount
  WHERE id = p_user_id;

  INSERT INTO wallet_transactions
    (user_id, transaction_type, amount, description, reference_type, reference_id)
  VALUES
    (p_user_id, 'debit', p_amount, p_description, p_reference_type, p_reference_id);

  RETURN TRUE;
END;
$$;

-- ── 3. Topup completion — pass reference ───────────────────────────

CREATE OR REPLACE FUNCTION public.complete_wallet_topup(
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
      'Wallet topup via Razorpay ' || p_razorpay_payment_id,
      'topup',
      p_razorpay_order_id
    );
  END IF;

  RETURN QUERY SELECT v_user_id, v_amount;
END;
$$;

-- ── 4. Loyalty redeem — link wallet_transactions to loyalty_redemptions.id ─

CREATE OR REPLACE FUNCTION public.redeem_loyalty_points(p_points integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id        uuid := auth.uid();
  v_have           integer;
  v_redemption_id  bigint;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_points IS NULL OR p_points <= 0 THEN
    RAISE EXCEPTION 'Enter a positive number of points to redeem';
  END IF;

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

  UPDATE profiles
  SET loyalty_points = loyalty_points - p_points,
      wallet_balance = wallet_balance + p_points
  WHERE id = v_user_id;

  INSERT INTO loyalty_redemptions (user_id, points, type, description)
  VALUES (v_user_id, p_points, 'redeemed',
          'Redeemed ' || p_points || ' points for wallet credit')
  RETURNING id INTO v_redemption_id;

  INSERT INTO wallet_transactions
    (user_id, amount, transaction_type, description, reference_type, reference_id)
  VALUES
    (v_user_id, p_points, 'credit',
     'Loyalty points redeemed (' || p_points || ' pts)',
     'loyalty_redemption', v_redemption_id::text);

  RETURN jsonb_build_object(
    'redeemed_points',          p_points,
    'wallet_credited',          p_points,
    'loyalty_points_remaining', v_have - p_points
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_loyalty_points(integer) TO authenticated;

-- ── 5. Referral first-order bonus — pass reference ─────────────────

CREATE OR REPLACE FUNCTION public.handle_first_order_referral_bonus()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_referrer_id   UUID;
  v_referral_id   BIGINT;
  v_already_done  BOOLEAN;
  v_is_active     BOOLEAN;
  v_credit        NUMERIC;
  v_points        INTEGER;
  v_order_count   INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT (NEW.status IN ('Paid', 'Confirmed') AND OLD.status NOT IN ('Paid', 'Confirmed')) THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('Paid', 'Confirmed') THEN
      RETURN NEW;
    END IF;
  END IF;

  BEGIN
    SELECT referred_by INTO v_referrer_id
    FROM public.profiles WHERE id = NEW.user_id;
    IF v_referrer_id IS NULL THEN RETURN NEW; END IF;

    SELECT id, first_order_reward_given INTO v_referral_id, v_already_done
    FROM public.referrals
    WHERE referee_id = NEW.user_id AND referrer_id = v_referrer_id;
    IF v_referral_id IS NULL OR v_already_done THEN RETURN NEW; END IF;

    SELECT
      COALESCE(is_active, FALSE),
      COALESCE(referrer_first_order_credit, 30),
      COALESCE(referrer_first_order_points, 100)
    INTO v_is_active, v_credit, v_points
    FROM public.referral_settings
    LIMIT 1;
    IF NOT v_is_active THEN RETURN NEW; END IF;

    SELECT COUNT(*)::INTEGER INTO v_order_count
    FROM public.orders
    WHERE user_id = NEW.user_id
      AND status NOT IN ('Cancelled', 'Failed', 'Pending');
    IF v_order_count <> 1 THEN RETURN NEW; END IF;

    IF v_credit > 0 THEN
      PERFORM public.increment_wallet_balance(
        v_referrer_id, v_credit,
        'Referral bonus — your friend placed their first order',
        'referral', v_referral_id::text
      );
    END IF;
    IF v_points > 0 THEN
      PERFORM public.increment_loyalty_points(v_referrer_id, v_points);
    END IF;

    UPDATE public.referrals
    SET status = 'first_order_done',
        first_order_reward_given = TRUE,
        reward_given = TRUE
    WHERE id = v_referral_id;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[handle_first_order_referral_bonus] order_id=% user_id=% error: %',
      NEW.id, NEW.user_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- ── 6. Post-debit tag for place-order — also names the order # in the
--      description so wallet history reads "Order payment for #11272". ─

CREATE OR REPLACE FUNCTION public.tag_wallet_debit_to_order(
  p_user_id  UUID,
  p_order_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Tag the most recent untagged 'Order payment' debit for this user that
  -- landed within the last 5 minutes. The filter on reference_id IS NULL +
  -- description='Order payment' makes the update idempotent: a re-tag
  -- attempt is a no-op once the reference has been set.
  UPDATE wallet_transactions
  SET reference_type = 'order',
      reference_id   = p_order_id::text,
      description    = 'Order payment for #' || p_order_id::text
  WHERE id = (
    SELECT id FROM wallet_transactions
    WHERE user_id = p_user_id
      AND transaction_type = 'debit'
      AND description = 'Order payment'
      AND reference_id IS NULL
      AND created_at > NOW() - INTERVAL '5 minutes'
    ORDER BY id DESC
    LIMIT 1
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.tag_wallet_debit_to_order(UUID, BIGINT) TO service_role;
