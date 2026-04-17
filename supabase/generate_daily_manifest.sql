-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Automated Daily Delivery Manifest
-- Run once in Supabase SQL Editor to deploy the function + schedule
--
-- What it does (runs nightly at 11:00 PM IST = 17:30 UTC):
--   1. Finds every active, non-paused subscription whose plan covers tomorrow
--   2. Skips subscriptions where tomorrow is a customer-cancelled day
--   3. Skips subscriptions that already have an order for tomorrow (idempotent)
--   4. Inserts an order + order_items for each eligible subscription
--   5. Debits wallet balance for wallet-payment subscriptions
--   6. Increments days_consumed on the subscription
--   7. Logs every run to manifest_run_log for audit + debugging
-- ═══════════════════════════════════════════════════════════════


-- ── 1. Audit log table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manifest_run_log (
  id             BIGSERIAL PRIMARY KEY,
  run_date       DATE NOT NULL,           -- date the manifest was generated FOR
  ran_at         TIMESTAMPTZ DEFAULT NOW(),
  orders_created INTEGER DEFAULT 0,
  orders_skipped INTEGER DEFAULT 0,       -- already existed
  subs_skipped   INTEGER DEFAULT 0,       -- cancelled / out-of-range / insufficient wallet
  error_detail   TEXT                     -- non-null if partial failure
);


-- ── 2. Core manifest function ─────────────────────────────────
CREATE OR REPLACE FUNCTION generate_daily_manifest(
  p_target_date DATE DEFAULT (CURRENT_DATE + INTERVAL '1 day')::DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_orders_created  INTEGER := 0;
  v_orders_skipped  INTEGER := 0;
  v_subs_skipped    INTEGER := 0;

  v_sub             RECORD;
  v_plan            RECORD;
  v_address         RECORD;
  v_config          RECORD;
  v_new_order_id    BIGINT;
  v_plan_price      NUMERIC;
  v_tax_amount      NUMERIC;
  v_delivery_fee    NUMERIC;
  v_total_amount    NUMERIC;
  v_day_number      INTEGER;  -- which day of the subscription this is
BEGIN

  -- Load store config (tax rate, delivery fee)
  SELECT tax_rate_percentage, delivery_fee
  INTO v_config
  FROM store_config
  LIMIT 1;

  -- Default if store_config empty
  v_config.tax_rate_percentage := COALESCE(v_config.tax_rate_percentage, 5);
  v_config.delivery_fee        := COALESCE(v_config.delivery_fee, 0);

  -- Iterate every active, non-paused subscription
  FOR v_sub IN
    SELECT
      us.id            AS sub_id,
      us.user_id,
      us.plan_id,
      us.start_date,
      us.days_consumed,
      us.payment_method,
      us.wallet_amount_used
    FROM user_subscriptions us
    WHERE us.is_active  = TRUE
      AND us.is_paused  = FALSE
  LOOP

    -- Load plan details
    SELECT sp.id, sp.cycle_id, sp.duration_days, sp.price, sp.plan_type, sp.branch_id
    INTO v_plan
    FROM subscription_plans sp
    WHERE sp.id = v_sub.plan_id;

    -- Skip if plan not found
    IF v_plan IS NULL THEN
      v_subs_skipped := v_subs_skipped + 1;
      CONTINUE;
    END IF;

    -- ── Check: target date is within subscription window ──
    -- Day 1 = start_date, Day N = start_date + (duration_days - 1)
    v_day_number := (p_target_date - v_sub.start_date) + 1;

    IF v_day_number < 1 OR v_day_number > v_plan.duration_days THEN
      -- Target date is before start or after subscription ends
      v_subs_skipped := v_subs_skipped + 1;
      CONTINUE;
    END IF;

    -- ── Check: not a customer-cancelled day ──
    IF EXISTS (
      SELECT 1
      FROM cancelled_subscription_days csd
      WHERE csd.subscription_id = v_sub.sub_id
        AND csd.cancelled_date  = p_target_date
    ) THEN
      v_subs_skipped := v_subs_skipped + 1;
      CONTINUE;
    END IF;

    -- ── Check: order doesn't already exist (idempotency) ──
    IF EXISTS (
      SELECT 1
      FROM orders o
      WHERE o.subscription_id = v_sub.sub_id
        AND o.dispatch_date   = p_target_date
    ) THEN
      v_orders_skipped := v_orders_skipped + 1;
      CONTINUE;
    END IF;

    -- ── Load customer's default delivery address ──
    SELECT ca.id, ca.hub_id, ca.zone_id
    INTO v_address
    FROM customer_addresses ca
    WHERE ca.user_id    = v_sub.user_id
      AND ca.is_default = TRUE
      AND ca.is_active  = TRUE
    LIMIT 1;

    -- Fallback: any active address
    IF v_address IS NULL THEN
      SELECT ca.id, ca.hub_id, ca.zone_id
      INTO v_address
      FROM customer_addresses ca
      WHERE ca.user_id  = v_sub.user_id
        AND ca.is_active = TRUE
      ORDER BY ca.id
      LIMIT 1;
    END IF;

    -- Skip if no address on file
    IF v_address IS NULL THEN
      v_subs_skipped := v_subs_skipped + 1;
      CONTINUE;
    END IF;

    -- ── Calculate amounts ──
    v_plan_price   := v_plan.price / v_plan.duration_days;  -- daily price slice
    v_tax_amount   := ROUND(v_plan_price * (v_config.tax_rate_percentage / 100.0), 2);
    v_delivery_fee := v_config.delivery_fee;
    v_total_amount := v_plan_price + v_tax_amount + v_delivery_fee;

    -- ── Wallet payment: check sufficient balance ──
    IF v_sub.payment_method = 'wallet' THEN
      IF (SELECT wallet_balance FROM profiles WHERE id = v_sub.user_id) < v_total_amount THEN
        -- Insufficient wallet — skip but log separately (nudge already sent by app)
        v_subs_skipped := v_subs_skipped + 1;
        CONTINUE;
      END IF;

      -- Debit wallet atomically
      UPDATE profiles
      SET wallet_balance = wallet_balance - v_total_amount
      WHERE id = v_sub.user_id;

      INSERT INTO wallet_transactions (user_id, transaction_type, amount, description)
      VALUES (
        v_sub.user_id,
        'debit',
        v_total_amount,
        'Subscription delivery — ' || TO_CHAR(p_target_date, 'DD Mon YYYY')
      );
    END IF;

    -- ── Create the order ──
    INSERT INTO orders (
      user_id,
      subscription_id,
      total_amount,
      tax_amount,
      delivery_fee,
      status,
      order_type,
      dispatch_date,
      cycle_id,
      delivery_method,
      hub_id,
      payment_method,
      wallet_amount_used,
      delivery_address_id,
      branch_id
    )
    VALUES (
      v_sub.user_id,
      v_sub.sub_id,
      v_total_amount,
      v_tax_amount,
      v_delivery_fee,
      'Confirmed',
      v_plan.plan_type,      -- 'food' or 'essentials'
      p_target_date,
      v_plan.cycle_id,
      CASE WHEN v_address.hub_id IS NOT NULL THEN 'hub' ELSE 'direct' END,
      v_address.hub_id,
      v_sub.payment_method,
      CASE WHEN v_sub.payment_method = 'wallet' THEN v_total_amount ELSE 0 END,
      v_address.id,
      v_plan.branch_id
    )
    RETURNING id INTO v_new_order_id;

    -- ── Create order_items from subscription_plan_items ──
    INSERT INTO order_items (order_id, item_id, item_type, item_name, quantity, price_at_time)
    SELECT
      v_new_order_id,
      spi.item_id,
      spi.item_type,
      COALESCE(mi.name, ec.name, 'Item #' || spi.item_id),
      spi.quantity,
      COALESCE(mi.price, ec.price, 0)
    FROM subscription_plan_items spi
    LEFT JOIN menu_items       mi ON mi.id = spi.item_id AND spi.item_type = 'menu'
    LEFT JOIN essentials_catalog ec ON ec.id = spi.item_id AND spi.item_type = 'essential'
    WHERE spi.plan_id = v_sub.plan_id;

    -- ── Increment days_consumed on the subscription ──
    UPDATE user_subscriptions
    SET
      days_consumed = days_consumed + 1,
      -- Auto-deactivate when all days are consumed
      is_active = CASE
        WHEN days_consumed + 1 >= v_plan.duration_days THEN FALSE
        ELSE TRUE
      END
    WHERE id = v_sub.sub_id;

    v_orders_created := v_orders_created + 1;

  END LOOP;

  -- ── Write audit log ──
  INSERT INTO manifest_run_log (run_date, orders_created, orders_skipped, subs_skipped)
  VALUES (p_target_date, v_orders_created, v_orders_skipped, v_subs_skipped);

  RETURN jsonb_build_object(
    'target_date',     p_target_date,
    'orders_created',  v_orders_created,
    'orders_skipped',  v_orders_skipped,
    'subs_skipped',    v_subs_skipped
  );

EXCEPTION WHEN OTHERS THEN
  -- Log the error and re-raise so pg_cron marks the job as failed
  INSERT INTO manifest_run_log (run_date, orders_created, orders_skipped, subs_skipped, error_detail)
  VALUES (p_target_date, v_orders_created, v_orders_skipped, v_subs_skipped, SQLERRM);
  RAISE;
END;
$$;


-- ── 3. Schedule via pg_cron ───────────────────────────────────
-- Runs at 11:00 PM IST = 17:30 UTC every day
-- Generates orders for the NEXT calendar day
-- pg_cron uses UTC; IST = UTC+5:30

SELECT cron.schedule(
  'generate-daily-manifest',        -- job name (unique, used to update/delete)
  '30 17 * * *',                    -- 17:30 UTC = 23:00 IST
  $$SELECT generate_daily_manifest()$$
);


-- ── 4. Manual trigger helper ──────────────────────────────────
-- To manually generate for a specific date (e.g. if cron missed):
--   SELECT generate_daily_manifest('2026-04-17'::DATE);
--
-- To check recent runs:
--   SELECT * FROM manifest_run_log ORDER BY ran_at DESC LIMIT 10;
--
-- To update the schedule time:
--   SELECT cron.unschedule('generate-daily-manifest');
--   SELECT cron.schedule('generate-daily-manifest', '0 18 * * *', $$SELECT generate_daily_manifest()$$);
--
-- To view all scheduled jobs:
--   SELECT * FROM cron.job;
