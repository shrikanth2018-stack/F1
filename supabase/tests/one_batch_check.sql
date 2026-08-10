-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — "one batch on every board" check
--
-- RUN:  supabase db query --linked --file supabase/tests/one_batch_check.sql
--
-- It "fails" by design: the run ends in RAISE EXCEPTION, which both prints
-- the report and rolls the whole thing back. A non-zero exit is the SUCCESS
-- case — read the report body, not the exit code.
--
-- RUN THIS AFTER APPLYING both vendor_orders_batch_scope.sql and
-- undelivered_batch_alert.sql. It assumes they are live and checks what they
-- actually do, against the real database, with dummy orders it creates and
-- then discards.
--
-- WHAT IT PROVES
--   V  vendor_orders() files each order in the right bucket — the active
--      batch is 'now', an unreleased run is 'upcoming', finished and
--      superseded-unfinished are both 'history', and an unpaid order is
--      invisible to the vendor entirely.
--   U  alert_undelivered_batch counts exactly the orders left open in a
--      batch, and stays silent on a batch that finished.
--   W  push_kitchen_summary calls the alert when the board FLIPS and not
--      when an unconfirmed claim is merely retried.
--
-- NO PUSH IS SENT. pg_net enqueues into a table, so the rollback discards
-- the request along with everything else — verified by checking
-- net.http_request_queue after a run. Section W goes further and swaps the
-- alert for a spy, so that path involves no HTTP at all.
--
-- WHY THE SPY. "Did the flip call the alert?" cannot be answered by looking
-- for a sent notification without actually sending one. Replacing the
-- function for the length of the transaction makes the call observable and
-- keeps the test silent.
-- ═══════════════════════════════════════════════════════════════

-- ── Assertions. Everything above is the real DDL; this seeds a controlled
-- ── set of dummy orders, checks each case, and RAISEs to roll it all back.
DO $$
DECLARE
  r            TEXT := E'\n════ one-batch-everywhere: dummy order test ════\n';
  v_vendor     RECORD;
  v_item       RECORD;
  v_cust       UUID;
  v_addr       BIGINT;
  v_branch     BIGINT;
  v_today      DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  o_now        BIGINT; o_upc BIGINT; o_del BIGINT; o_strand BIGINT; o_pend BIGINT;
  v_bucket     TEXT;
  v_n          INTEGER;
  v_res        JSONB;
  v_spy        INTEGER;
  ok           BOOLEAN;
BEGIN
  -- ── Fixtures ─────────────────────────────────────────────────
  SELECT id, owner_user_id, business_name, status INTO v_vendor FROM vendors LIMIT 1;
  SELECT id, cycle_id, name INTO v_item
    FROM essentials_catalog WHERE vendor_id = v_vendor.id AND cycle_id IS NOT NULL LIMIT 1;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'no vendor item with a cycle — cannot test';
  END IF;

  SELECT ca.user_id, ca.id, ca.branch_id INTO v_cust, v_addr, v_branch
    FROM customer_addresses ca WHERE ca.is_active LIMIT 1;

  r := r || format('fixtures: vendor %s (%s), item %s "%s" on cycle %s, today %s%s',
    v_vendor.id, v_vendor.status, v_item.id, v_item.name, v_item.cycle_id, v_today, E'\n\n');

  -- Make the vendor's cycle the ACTIVE batch for today, so 'now' is well defined.
  INSERT INTO kitchen_push_log (cycle_id, push_date, orders_count, items_summary, status, notified_at, pushed_at)
  VALUES (v_item.cycle_id, v_today, 1, 'test', 'dispatched', now(), now())
  ON CONFLICT (cycle_id, push_date) DO UPDATE
    SET pushed_at = now(), notified_at = now();
  -- And a batch that has already been superseded, for the stranded case.
  INSERT INTO kitchen_push_log (cycle_id, push_date, orders_count, items_summary, status, notified_at, pushed_at)
  VALUES (v_item.cycle_id, v_today - 1, 1, 'test', 'dispatched', now() - interval '1 day', now() - interval '1 day')
  ON CONFLICT (cycle_id, push_date) DO NOTHING;

  -- ── Dummy orders, one per expected bucket ────────────────────
  INSERT INTO orders (user_id, total_amount, tax_amount, delivery_fee, status, order_type,
                      dispatch_date, cycle_id, delivery_method, payment_method,
                      wallet_amount_used, delivery_address_id, branch_id)
  VALUES (v_cust, 100, 0, 0, 'Confirmed', 'essential', v_today,     v_item.cycle_id, 'direct', 'wallet', 0, v_addr, v_branch)
  RETURNING id INTO o_now;
  INSERT INTO orders (user_id, total_amount, tax_amount, delivery_fee, status, order_type,
                      dispatch_date, cycle_id, delivery_method, payment_method,
                      wallet_amount_used, delivery_address_id, branch_id)
  VALUES (v_cust, 100, 0, 0, 'Confirmed', 'essential', v_today + 3, v_item.cycle_id, 'direct', 'wallet', 0, v_addr, v_branch)
  RETURNING id INTO o_upc;
  INSERT INTO orders (user_id, total_amount, tax_amount, delivery_fee, status, order_type,
                      dispatch_date, cycle_id, delivery_method, payment_method,
                      wallet_amount_used, delivery_address_id, branch_id)
  VALUES (v_cust, 100, 0, 0, 'Delivered', 'essential', v_today,     v_item.cycle_id, 'direct', 'wallet', 0, v_addr, v_branch)
  RETURNING id INTO o_del;
  INSERT INTO orders (user_id, total_amount, tax_amount, delivery_fee, status, order_type,
                      dispatch_date, cycle_id, delivery_method, payment_method,
                      wallet_amount_used, delivery_address_id, branch_id)
  VALUES (v_cust, 100, 0, 0, 'Confirmed', 'essential', v_today - 1, v_item.cycle_id, 'direct', 'wallet', 0, v_addr, v_branch)
  RETURNING id INTO o_strand;
  INSERT INTO orders (user_id, total_amount, tax_amount, delivery_fee, status, order_type,
                      dispatch_date, cycle_id, delivery_method, payment_method,
                      wallet_amount_used, delivery_address_id, branch_id)
  VALUES (v_cust, 100, 0, 0, 'Pending',   'essential', v_today,     v_item.cycle_id, 'direct', 'wallet', 0, v_addr, v_branch)
  RETURNING id INTO o_pend;

  INSERT INTO order_items (order_id, item_id, item_type, item_name, quantity, price_at_time)
  SELECT x, v_item.id, 'essential', v_item.name, 2, 50
  FROM unnest(ARRAY[o_now, o_upc, o_del, o_strand, o_pend]) AS x;

  r := r || format('seeded orders: now=%s upcoming=%s delivered=%s stranded=%s pending=%s%s',
    o_now, o_upc, o_del, o_strand, o_pend, E'\n\n');

  -- ── V. vendor_orders() buckets ───────────────────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_vendor.owner_user_id, 'role', 'authenticated')::text, true);

  SELECT bucket INTO v_bucket FROM vendor_orders() WHERE order_id = o_now;
  r := r || format('V1 active-batch order      -> now       ... %s%s',
    CASE WHEN v_bucket = 'now' THEN 'PASS' ELSE 'FAIL (got '||COALESCE(v_bucket,'absent')||')' END, E'\n');

  SELECT bucket INTO v_bucket FROM vendor_orders() WHERE order_id = o_upc;
  r := r || format('V2 never-pushed order      -> upcoming  ... %s%s',
    CASE WHEN v_bucket = 'upcoming' THEN 'PASS' ELSE 'FAIL (got '||COALESCE(v_bucket,'absent')||')' END, E'\n');

  SELECT bucket INTO v_bucket FROM vendor_orders() WHERE order_id = o_del;
  r := r || format('V3 delivered order         -> history   ... %s%s',
    CASE WHEN v_bucket = 'history' THEN 'PASS' ELSE 'FAIL (got '||COALESCE(v_bucket,'absent')||')' END, E'\n');

  SELECT bucket INTO v_bucket FROM vendor_orders() WHERE order_id = o_strand;
  r := r || format('V4 superseded + unfinished -> history   ... %s%s',
    CASE WHEN v_bucket = 'history' THEN 'PASS' ELSE 'FAIL (got '||COALESCE(v_bucket,'absent')||')' END, E'\n');

  SELECT count(*) INTO v_n FROM vendor_orders() WHERE order_id = o_pend;
  r := r || format('V5 pending order           -> absent    ... %s%s',
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL (visible to vendor)' END, E'\n');

  SELECT count(*) INTO v_n FROM vendor_orders() WHERE bucket NOT IN ('now','upcoming','history');
  r := r || format('V6 every row has a bucket             ... %s%s',
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL ('||v_n||' odd)' END, E'\n');

  SELECT bool_or(dispatch_date < v_today) INTO ok FROM vendor_orders();
  r := r || format('V7 history reaches before today       ... %s%s',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL (date floor still today)' END, E'\n');

  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ── U. undelivered alert ─────────────────────────────────────
  -- Count logic, read directly — no HTTP involved either way.
  SELECT count(*) INTO v_n FROM orders
   WHERE cycle_id = v_item.cycle_id AND dispatch_date = v_today - 1
     AND status NOT IN ('Delivered','Cancelled','Failed');
  r := r || format('%sU1 stranded batch has %s open order(s)  ... %s%s', E'\n', v_n,
    CASE WHEN v_n >= 1 THEN 'PASS' ELSE 'FAIL' END, E'\n');

  v_res := alert_undelivered_batch(v_item.cycle_id, v_today - 1);
  r := r || format('U2 alert on stranded batch -> reports  ... %s (%s)%s',
    CASE WHEN v_res->>'status' IN ('sent','no_secret') AND (v_res->>'count')::int = v_n
         THEN 'PASS' ELSE 'FAIL' END, v_res::text, E'\n');

  -- A batch with nothing open must stay silent.
  UPDATE orders SET status = 'Delivered' WHERE id = o_strand;
  v_res := alert_undelivered_batch(v_item.cycle_id, v_today - 1);
  r := r || format('U3 alert on clean batch    -> silent   ... %s (%s)%s',
    CASE WHEN v_res->>'status' = 'clean' THEN 'PASS' ELSE 'FAIL' END, v_res->>'status', E'\n');
  UPDATE orders SET status = 'Confirmed' WHERE id = o_strand;

  -- ── W. wiring: does the flip actually call it? ───────────────
  -- Swap the alert for a spy. Proves push_kitchen_summary calls it with the
  -- OUTGOING batch's identity, with no HTTP anywhere in the test.
  CREATE TEMP TABLE spy (cycle_id INT, push_date DATE) ON COMMIT DROP;
  EXECUTE $spy$
    CREATE OR REPLACE FUNCTION public.alert_undelivered_batch(p_cycle_id INTEGER, p_push_date DATE)
    RETURNS JSONB LANGUAGE plpgsql AS $body$
    BEGIN
      INSERT INTO spy VALUES (p_cycle_id, p_push_date);
      RETURN jsonb_build_object('status','spied');
    END $body$;
  $spy$;

  -- The active batch is (vendor cycle, today). Push a DIFFERENT cycle+date:
  -- the board flips, so the outgoing batch must be reported.
  PERFORM push_kitchen_summary(v_item.cycle_id, v_today + 5);
  SELECT count(*) INTO v_spy FROM spy WHERE cycle_id = v_item.cycle_id AND push_date = v_today;
  r := r || format('%sW1 flip reports the OUTGOING batch     ... %s%s', E'\n',
    CASE WHEN v_spy = 1 THEN 'PASS' ELSE 'FAIL (spy saw '||(SELECT count(*) FROM spy)||' call(s))' END, E'\n');

  -- Re-claiming the same cycle+date is a retry, not a flip. Must not alert.
  DELETE FROM spy;
  UPDATE kitchen_push_log SET notified_at = NULL WHERE cycle_id = v_item.cycle_id AND push_date = v_today + 5;
  PERFORM push_kitchen_summary(v_item.cycle_id, v_today + 5);
  SELECT count(*) INTO v_spy FROM spy;
  r := r || format('W2 retry of same batch    -> no alert  ... %s%s',
    CASE WHEN v_spy = 0 THEN 'PASS' ELSE 'FAIL ('||v_spy||' spurious alert(s))' END, E'\n');

  r := r || E'\n════ rolled back — nothing kept, no push sent ════';
  RAISE EXCEPTION '%', r;
END $$;
