-- ─────────────────────────────────────────────────────────────
-- 1stOne F1 — Referral first-order bonus trigger
--
-- MF-08 (2026-05-11): captured from prod into tracked SQL. The function +
-- trigger lived only in production; a DB rebuild from supabase/sql/ would
-- have lost referral payouts silently. Same drift class as BF-37.
--
-- Behavior:
--   When an order first reaches a "real" status (Paid or Confirmed) for a
--   user who was referred AND it's their first such order (count==1 across
--   non-Cancelled / non-Failed / non-Pending statuses), credit the
--   referrer's wallet + loyalty points per referral_settings and mark the
--   referrals row first_order_reward_given=true so it never double-pays.
--
-- Safe in concurrent INSERT/UPDATE because of the unique (referee_id,
-- referrer_id) bond + the first_order_reward_given guard + the
-- order_count check.
--
-- Companion: `referrals` table, `referral_settings` table, and the
-- increment_wallet_balance / increment_loyalty_points RPCs from
-- rpc_atomic_increments.sql.
--
-- Run via supabase db query --file --linked. Idempotent.
-- ─────────────────────────────────────────────────────────────

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
  -- Only fire on the Pending → (Paid|Confirmed) transition (or direct
  -- INSERT into Paid/Confirmed). Skip everything else.
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
    -- Was this user referred?
    SELECT referred_by INTO v_referrer_id
    FROM public.profiles WHERE id = NEW.user_id;
    IF v_referrer_id IS NULL THEN RETURN NEW; END IF;

    -- Lookup the referrals row + idempotency guard.
    SELECT id, first_order_reward_given INTO v_referral_id, v_already_done
    FROM public.referrals
    WHERE referee_id = NEW.user_id AND referrer_id = v_referrer_id;
    IF v_referral_id IS NULL OR v_already_done THEN RETURN NEW; END IF;

    -- Admin-configurable rewards.
    SELECT
      COALESCE(is_active, FALSE),
      COALESCE(referrer_first_order_credit, 30),
      COALESCE(referrer_first_order_points, 100)
    INTO v_is_active, v_credit, v_points
    FROM public.referral_settings
    LIMIT 1;
    IF NOT v_is_active THEN RETURN NEW; END IF;

    -- "First order" = exactly one non-Cancelled / non-Failed / non-Pending
    -- order exists for this user (the one currently being committed).
    SELECT COUNT(*)::INTEGER INTO v_order_count
    FROM public.orders
    WHERE user_id = NEW.user_id
      AND status NOT IN ('Cancelled', 'Failed', 'Pending');
    IF v_order_count <> 1 THEN RETURN NEW; END IF;

    -- Credit the referrer (wallet + loyalty) via the existing RPCs.
    IF v_credit > 0 THEN
      PERFORM public.increment_wallet_balance(
        v_referrer_id, v_credit,
        'Referral bonus — your friend placed their first order'
      );
    END IF;
    IF v_points > 0 THEN
      PERFORM public.increment_loyalty_points(v_referrer_id, v_points);
    END IF;

    -- Mark the referrals row done so this never double-pays.
    UPDATE public.referrals
    SET status = 'first_order_done',
        first_order_reward_given = TRUE,
        reward_given = TRUE
    WHERE id = v_referral_id;

  EXCEPTION WHEN OTHERS THEN
    -- Defensive: do NOT propagate referral payout errors back to the
    -- caller of the orders UPDATE. Log + continue so a bad referrals row
    -- doesn't block an order from confirming.
    RAISE WARNING '[handle_first_order_referral_bonus] order_id=% user_id=% error: %',
      NEW.id, NEW.user_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- Trigger
DROP TRIGGER IF EXISTS trg_first_order_referral_bonus ON public.orders;
CREATE TRIGGER trg_first_order_referral_bonus
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_first_order_referral_bonus();
