-- ─────────────────────────────────────────────────────────────
-- generate_daily_manifest — daily subscription dispatch generator
--
-- Called by:
--   - kitchen-cutoff-push-tick (per-minute cron at each cycle's cutoff,
--     canonical path)
--   - manual ad-hoc reruns from SQL Editor
--   - (formerly) generate-daily-manifest 23:00 IST nightly safety-net,
--     unscheduled 2026-05-04 per CL-02 — the per-cycle tick handles
--     everything reliably; backup was redundant.
--
-- Behavior:
--   For each active, non-paused user_subscription whose target dispatch
--   day falls inside [start_date, start_date + duration_days), generate
--   one order with order_items mirroring the plan's items, link back via
--   subscription_id, and increment days_consumed. Idempotent — re-runs
--   skip orders already created for the same (subscription_id, dispatch_date).
--
-- Important fix history (live state on prod = the latest of these):
--   BF-01 (2026-05-02) — NO wallet debit on dispatch. Plan was paid in
--     full upfront via place-order. Dispatch is an operational event,
--     not a payment event. wallet_balance is NOT touched here.
--   BF-02 (2026-05-02) — order_items mirrored from
--     subscription_plans.plan_items JSON column (the same column
--     place-order reads from at purchase). Earlier the function read
--     from a stale subscription_plan_items table that admin UI didn't
--     populate, producing empty dispatch orders.
--   BF-19 (2026-05-04, this revision) — total_amount, tax_amount,
--     delivery_fee are zeroed on dispatch rows. Revenue is captured at
--     original subscription purchase order. Dispatch rows are
--     operational records (which subscriptions to dispatch on this
--     date), not financial events. This makes
--     SUM(orders.total_amount) accurate in revenue reports without
--     needing filters or joins. The store_config tax_rate +
--     delivery_fee lookup is no longer needed and is removed.
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.generate_daily_manifest(
  p_target_date DATE DEFAULT (CURRENT_DATE + INTERVAL '1 day')::DATE,
  p_cycle_id INTEGER DEFAULT NULL
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
  v_new_order_id    BIGINT;
  v_day_number      INTEGER;
BEGIN
  -- BF-19: store_config tax_rate + delivery_fee lookup removed —
  -- dispatch rows have all financial fields zeroed; no calculation needed.

  FOR v_sub IN
    SELECT us.id AS sub_id, us.user_id, us.plan_id, us.start_date,
           us.days_consumed, us.payment_method, us.wallet_amount_used
    FROM user_subscriptions us
    JOIN subscription_plans sp ON sp.id = us.plan_id
    WHERE us.is_active = TRUE
      AND us.is_paused = FALSE
      AND (p_cycle_id IS NULL OR sp.cycle_id = p_cycle_id)
  LOOP
    SELECT sp.id, sp.cycle_id, sp.duration_days, sp.price, sp.plan_type, sp.branch_id
    INTO v_plan
    FROM subscription_plans sp
    WHERE sp.id = v_sub.plan_id;

    IF v_plan IS NULL THEN
      v_subs_skipped := v_subs_skipped + 1;
      CONTINUE;
    END IF;

    v_day_number := (p_target_date - v_sub.start_date) + 1;
    IF v_day_number < 1 OR v_day_number > v_plan.duration_days THEN
      v_subs_skipped := v_subs_skipped + 1;
      CONTINUE;
    END IF;

    -- Skip if customer cancelled this specific day
    IF EXISTS (
      SELECT 1 FROM cancelled_subscription_days csd
      WHERE csd.subscription_id = v_sub.sub_id
        AND csd.cancelled_date  = p_target_date
    ) THEN
      v_subs_skipped := v_subs_skipped + 1;
      CONTINUE;
    END IF;

    -- Idempotency: already created an order for this (sub, date)?
    IF EXISTS (
      SELECT 1 FROM orders o
      WHERE o.subscription_id = v_sub.sub_id
        AND o.dispatch_date   = p_target_date
    ) THEN
      v_orders_skipped := v_orders_skipped + 1;
      CONTINUE;
    END IF;

    -- Resolve delivery address: default first, fallback to any active
    SELECT ca.id, ca.hub_id, ca.zone_id
    INTO v_address
    FROM customer_addresses ca
    WHERE ca.user_id = v_sub.user_id
      AND ca.is_default = TRUE
      AND ca.is_active = TRUE
    LIMIT 1;

    IF v_address IS NULL THEN
      SELECT ca.id, ca.hub_id, ca.zone_id
      INTO v_address
      FROM customer_addresses ca
      WHERE ca.user_id = v_sub.user_id
        AND ca.is_active = TRUE
      ORDER BY ca.id
      LIMIT 1;
    END IF;

    IF v_address IS NULL THEN
      v_subs_skipped := v_subs_skipped + 1;
      CONTINUE;
    END IF;

    -- ── Create the dispatch order ──
    -- BF-19: total_amount = tax_amount = delivery_fee = 0 on dispatch
    -- rows. Revenue is captured at original subscription purchase via
    -- place-order. This row is an operational dispatch record only.
    -- BF-01: wallet_amount_used = 0. Plan was paid in full at purchase;
    -- this is a dispatch event, not a payment event.
    INSERT INTO orders (
      user_id, subscription_id, total_amount, tax_amount, delivery_fee,
      status, order_type, dispatch_date, cycle_id,
      delivery_method, hub_id, payment_method, wallet_amount_used,
      delivery_address_id, branch_id
    )
    VALUES (
      v_sub.user_id, v_sub.sub_id,
      0,  -- BF-19: dispatch rows are not revenue events
      0,  -- BF-19: tax was paid at original purchase
      0,  -- BF-19: delivery fee was paid at original purchase
      'Confirmed', v_plan.plan_type, p_target_date, v_plan.cycle_id,
      CASE WHEN v_address.hub_id IS NOT NULL THEN 'hub' ELSE 'direct' END,
      v_address.hub_id, v_sub.payment_method,
      0,  -- BF-01: no wallet debit on dispatch
      v_address.id, v_plan.branch_id
    )
    RETURNING id INTO v_new_order_id;

    -- BF-02: order_items from subscription_plans.plan_items JSON column
    -- (the same column place-order reads from). Earlier read from
    -- subscription_plan_items table which admin UI didn't populate.
    INSERT INTO order_items (order_id, item_id, item_type, item_name, quantity, price_at_time)
    SELECT
      v_new_order_id,
      (item->>'item_id')::INTEGER,
      CASE WHEN COALESCE(v_plan.plan_type, 'food') = 'food' THEN 'food' ELSE 'essential' END,
      COALESCE(item->>'item_name', mi.name, ec.name, 'Item #' || (item->>'item_id')),
      COALESCE((item->>'quantity')::INTEGER, 1),
      COALESCE(mi.price, ec.price, 0)
    FROM subscription_plans sp
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE jsonb_typeof(sp.plan_items::jsonb)
        WHEN 'array' THEN sp.plan_items::jsonb
        ELSE '[]'::jsonb
      END
    ) AS item
    LEFT JOIN menu_items mi
      ON COALESCE(v_plan.plan_type, 'food') = 'food'
      AND mi.id = (item->>'item_id')::INTEGER
    LEFT JOIN essentials_catalog ec
      ON v_plan.plan_type = 'essentials'
      AND ec.id = (item->>'item_id')::INTEGER
    WHERE sp.id = v_sub.plan_id;

    -- Increment consumption + auto-deactivate when complete
    UPDATE user_subscriptions
    SET days_consumed = days_consumed + 1,
        is_active = CASE
          WHEN days_consumed + 1 >= v_plan.duration_days THEN FALSE
          ELSE TRUE
        END
    WHERE id = v_sub.sub_id;

    v_orders_created := v_orders_created + 1;
  END LOOP;

  -- Audit log
  INSERT INTO manifest_run_log (run_date, orders_created, orders_skipped, subs_skipped)
  VALUES (p_target_date, v_orders_created, v_orders_skipped, v_subs_skipped);

  RETURN jsonb_build_object(
    'target_date',     p_target_date,
    'orders_created',  v_orders_created,
    'orders_skipped',  v_orders_skipped,
    'subs_skipped',    v_subs_skipped
  );

EXCEPTION WHEN OTHERS THEN
  INSERT INTO manifest_run_log (run_date, orders_created, orders_skipped, subs_skipped, error_detail)
  VALUES (p_target_date, v_orders_created, v_orders_skipped, v_subs_skipped, SQLERRM);
  RAISE;
END;
$$;
