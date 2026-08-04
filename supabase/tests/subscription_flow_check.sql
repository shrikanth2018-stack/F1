-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — subscription flow check
--
-- RUN:  supabase db query --linked --file supabase/tests/subscription_flow_check.sql
--
-- Like platform_health_check.sql, it "fails" by design: the run ends in RAISE
-- EXCEPTION, which prints the report and rolls everything back. Read the
-- report, not the exit code.
--
-- Completes section J of the health check, which SKIPS when no active
-- subscription exists — which is every run on an empty database, and was the
-- case on 2026-08-04 when the subscription path was the one thing the health
-- check could not see.
--
-- It builds one, then walks the whole subscription life: bought (as the
-- service role, the way place-order does it), dispatched by the nightly
-- manifest, paused and skipped by the customer as their real role.
--
-- The first assertion is the one that matters most. `client_write_gaps.sql`
-- revoked INSERT on user_subscriptions from `authenticated`; if that had also
-- caught the service role, buying a plan would fail outright and nothing else
-- here would run.
--
-- Rolls back — the final RAISE is what does it.
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_cust   UUID;
  v_plan   INTEGER;
  v_cycle  INTEGER;
  v_menu   INTEGER;
  v_sub    INTEGER;
  v_future DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date + 60;
  v_json   JSONB;
  v_before INTEGER;
  v_n      INTEGER;
  v_money  INTEGER;
  v_days   INTEGER;
  v_out    TEXT := E'\n════ subscription flow ════\n';
BEGIN
  SELECT ca.user_id INTO v_cust
    FROM customer_addresses ca
   WHERE ca.is_active AND ca.latitude IS NOT NULL
   ORDER BY ca.is_default DESC, ca.id LIMIT 1;
  SELECT id, cycle_id INTO v_menu, v_cycle
    FROM menu_items WHERE is_active AND is_customer_visible AND cycle_id IS NOT NULL
   ORDER BY id LIMIT 1;

  INSERT INTO subscription_plans (plan_name, price, duration_days, is_active, cycle_id, plan_type, plan_items)
  VALUES ('__subflow__', 700, 7, TRUE, v_cycle, 'food',
          jsonb_build_array(jsonb_build_object('item_id', v_menu, 'quantity', 1)))
  RETURNING id INTO v_plan;

  -- ── 1. Buying a plan: place-order writes this row as the service role ──
  SET LOCAL ROLE service_role;
  BEGIN
    INSERT INTO user_subscriptions
      (user_id, plan_id, start_date, days_consumed, is_active, is_paused, payment_method)
    VALUES (v_cust, v_plan, v_future, 0, TRUE, FALSE, 'wallet')
    RETURNING id INTO v_sub;
    v_out := v_out || E'ok    place-order can still create a subscription (service role)\n';
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || format(E'FAIL  place-order can NO LONGER create a subscription: %s\n', SQLERRM);
  END;
  RESET ROLE;

  IF v_sub IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK-BY-DESIGN ::%', v_out || E'\n(stopped — nothing else can be tested)\n';
  END IF;

  -- ── 2. The nightly manifest turns it into a kitchen order ──
  BEGIN
    SELECT generate_daily_manifest(v_future, v_cycle) INTO v_json;
    SELECT count(*) INTO v_before FROM orders
     WHERE dispatch_date = v_future AND subscription_id = v_sub;
    v_out := v_out || format(E'%s  manifest dispatches the subscription: %s order(s)  %s\n',
      CASE WHEN v_before = 1 THEN 'ok  ' ELSE 'FAIL' END, v_before, v_json);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || format(E'FAIL  manifest: %s\n', SQLERRM);
  END;

  -- The dish's recipe has to reach the order, or the kitchen board is empty.
  BEGIN
    SELECT count(*) INTO v_n FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
     WHERE o.subscription_id = v_sub AND o.dispatch_date = v_future;
    v_out := v_out || format(E'%s  dispatch order carries its items: %s line(s)\n',
      CASE WHEN v_n >= 1 THEN 'ok  ' ELSE 'FAIL' END, v_n);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || format(E'FAIL  order items: %s\n', SQLERRM);
  END;

  -- BF-19: revenue was booked at purchase; a dispatch row must carry no money.
  BEGIN
    SELECT count(*) INTO v_money FROM orders
     WHERE subscription_id = v_sub AND dispatch_date = v_future
       AND (COALESCE(total_amount,0) <> 0 OR COALESCE(wallet_amount_used,0) <> 0);
    v_out := v_out || format(E'%s  dispatch row carries zero money (BF-19)\n',
      CASE WHEN v_money = 0 THEN 'ok  ' ELSE 'FAIL' END);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || format(E'FAIL  BF-19: %s\n', SQLERRM);
  END;

  -- days_consumed is written by the manifest, which is DEFINER — the revoked
  -- UPDATE grant must not have reached it.
  BEGIN
    SELECT days_consumed INTO v_days FROM user_subscriptions WHERE id = v_sub;
    v_out := v_out || format(E'%s  manifest still counts the day down: days_consumed=%s\n',
      CASE WHEN v_days = 1 THEN 'ok  ' ELSE 'FAIL' END, v_days);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || format(E'FAIL  days_consumed: %s\n', SQLERRM);
  END;

  -- Re-running the same date must not dispatch twice.
  BEGIN
    PERFORM generate_daily_manifest(v_future, v_cycle);
    SELECT count(*) INTO v_n FROM orders
     WHERE dispatch_date = v_future AND subscription_id = v_sub;
    v_out := v_out || format(E'%s  re-run is idempotent (%s before, %s after)\n',
      CASE WHEN v_n = v_before THEN 'ok  ' ELSE 'FAIL' END, v_before, v_n);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || format(E'FAIL  idempotency: %s\n', SQLERRM);
  END;

  -- ── 3. What the CUSTOMER can do with it, as their real role ──
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_cust, 'role','authenticated','user_role','customer')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    SELECT count(*) INTO v_n FROM user_subscriptions WHERE id = v_sub;
    v_out := v_out || format(E'%s  customer can read their own subscription\n',
      CASE WHEN v_n = 1 THEN 'ok  ' ELSE 'FAIL' END);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || format(E'FAIL  read own subscription: %s\n', SQLERRM);
  END;

  BEGIN
    UPDATE user_subscriptions SET is_paused = TRUE WHERE id = v_sub AND user_id = v_cust;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    UPDATE user_subscriptions SET is_paused = FALSE WHERE id = v_sub AND user_id = v_cust;
    v_out := v_out || format(E'%s  customer can pause and resume it (%s row)\n',
      CASE WHEN v_n = 1 THEN 'ok  ' ELSE 'FAIL' END, v_n);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || format(E'FAIL  pause/resume: %s\n', SQLERRM);
  END;

  BEGIN
    INSERT INTO cancelled_subscription_days (subscription_id, cancelled_date, cycle_id, reason)
    VALUES (v_sub, v_future + 2, v_cycle, 'subflow');
    v_out := v_out || E'ok    customer can skip a day\n';
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || format(E'FAIL  skip a day: %s\n', SQLERRM);
  END;

  -- And what they must NOT be able to do: award themselves more days, or
  -- revive a finished plan.
  BEGIN
    UPDATE user_subscriptions SET days_consumed = 0 WHERE id = v_sub AND user_id = v_cust;
    v_out := v_out || E'FAIL  customer reset their own days_consumed: ALLOWED\n';
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || E'ok    customer cannot reset days_consumed\n';
  END;

  BEGIN
    UPDATE user_subscriptions SET is_active = TRUE WHERE id = v_sub AND user_id = v_cust;
    v_out := v_out || E'FAIL  customer flipped is_active: ALLOWED\n';
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || E'ok    customer cannot flip is_active\n';
  END;

  RESET ROLE;
  RAISE EXCEPTION 'ROLLBACK-BY-DESIGN ::%', v_out || E'\n════ rolled back — nothing kept ════\n';
END $$;
