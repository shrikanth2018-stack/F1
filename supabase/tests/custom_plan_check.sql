-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — the customer's plan builder
--
-- RUN:  supabase db query --linked --file supabase/tests/custom_plan_check.sql
--
-- Ends in RAISE EXCEPTION, which prints the report and rolls everything back.
-- A non-zero exit is the SUCCESS case — read the report, not the exit code.
--
-- RUN AFTER APPLYING custom_plan_foundations.sql and create_custom_plan.sql.
--
-- Every refusal below is a rule someone asked for, and each is tested from
-- the OUTSIDE — by calling the function as a customer would, not by checking
-- that a branch exists. The pricing cases matter most: the client shows a
-- preview, and if the two ever disagree the customer sees one number and
-- pays another.
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  r          TEXT := E'\n════ custom plan builder ════\n';
  v_cust     UUID;
  v_cycle    INTEGER;
  v_food     INTEGER; v_food_p NUMERIC;
  v_food2    INTEGER;
  v_ess      INTEGER; v_ess_p  NUMERIC;
  v_block    INTEGER;
  v_res      JSONB;
  v_err      TEXT;
  v_plan     INTEGER;
  n          INTEGER;

BEGIN
  SELECT ca.user_id INTO v_cust FROM customer_addresses ca WHERE ca.is_active LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);

  -- Fixtures: two eligible foods, one eligible essential, one BLOCK, all on
  -- one cycle. Eligibility is granted here and rolled back with everything.
  SELECT mi.cycle_id INTO v_cycle FROM menu_items mi
   WHERE mi.is_active AND mi.is_customer_visible AND mi.cycle_id IS NOT NULL LIMIT 1;

  SELECT id, price INTO v_food, v_food_p FROM menu_items
   WHERE is_active AND is_customer_visible AND cycle_id = v_cycle AND price > 0
   ORDER BY id LIMIT 1;
  SELECT id INTO v_food2 FROM menu_items
   WHERE is_active AND is_customer_visible AND cycle_id = v_cycle AND id <> v_food
   ORDER BY id LIMIT 1;
  SELECT id, price INTO v_ess, v_ess_p FROM essentials_catalog
   WHERE is_active AND cycle_id = v_cycle AND price > 0 ORDER BY id LIMIT 1;
  SELECT id INTO v_block FROM menu_items
   WHERE is_active AND NOT is_customer_visible ORDER BY id LIMIT 1;

  IF v_food IS NULL OR v_ess IS NULL THEN
    RAISE EXCEPTION 'need an eligible food and essential on one cycle to test';
  END IF;

  UPDATE menu_items SET plan_eligible = TRUE WHERE id IN (v_food, v_food2);
  UPDATE essentials_catalog SET plan_eligible = TRUE WHERE id = v_ess;
  IF v_block IS NOT NULL THEN
    -- Flagged eligible ON PURPOSE: the builder must refuse it anyway. Its
    -- cycle is left alone — menu_items_shape forbids a block from having one
    -- at all (is_customer_visible AND cycle_id IS NOT NULL, or neither), so
    -- the schema is the first guard and the builder's is_customer_visible
    -- test is the second.
    UPDATE menu_items SET plan_eligible = TRUE WHERE id = v_block;
  END IF;

  r := r || format('fixtures: cycle %s, food %s (%s), essential %s (%s), block %s%s',
    v_cycle, v_food, v_food_p, v_ess, v_ess_p, COALESCE(v_block::text,'none'), E'\n\n');

  -- ── P. Pricing ───────────────────────────────────────────────
  v_res := create_custom_plan(v_cycle,
    jsonb_build_array(jsonb_build_object('item_id', v_food, 'item_type', 'food', 'quantity', 1)),
    30);
  v_plan := (v_res->>'plan_id')::INTEGER;

  r := r || format('P1 daily = item price (%s)        ... %s%s', v_res->>'daily_total',
    CASE WHEN (v_res->>'daily_total')::numeric = v_food_p THEN 'PASS' ELSE 'FAIL' END, E'\n');
  r := r || format('P2 30 days -> 8%% slab             ... %s%s',
    CASE WHEN (v_res->>'discount_percent')::numeric = 8 THEN 'PASS'
         ELSE 'FAIL ('||(v_res->>'discount_percent')||')' END, E'\n');
  r := r || format('P3 price = full less discount     ... %s%s',
    CASE WHEN (v_res->>'price')::numeric
              = ROUND(v_food_p * 30 * 0.92, 2) THEN 'PASS'
         ELSE 'FAIL ('||(v_res->>'price')||' vs '||ROUND(v_food_p*30*0.92,2)||')' END, E'\n');
  r := r || format('P4 stored price matches returned  ... %s%s',
    CASE WHEN (SELECT price FROM subscription_plans WHERE id = v_plan)
              = (v_res->>'price')::numeric THEN 'PASS' ELSE 'FAIL' END, E'\n');

  SELECT count(*) INTO n FROM subscription_plans
   WHERE id = v_plan AND is_custom AND created_by = v_cust;
  r := r || format('P5 flagged custom, owned by caller ... %s%s',
    CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END, E'\n');

  -- The manifest depends on this: every line must carry its own type.
  SELECT count(*) INTO n FROM subscription_plans sp,
    LATERAL jsonb_array_elements(sp.plan_items::jsonb) AS l
   WHERE sp.id = v_plan AND l->>'item_type' IS NULL;
  r := r || format('P6 every line carries item_type   ... %s%s',
    CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ('||n||' without)' END, E'\n');

  -- ── R. Refusals ──────────────────────────────────────────────
  -- Each one is a rule that was asked for; a silent acceptance is the bug.
  DELETE FROM subscription_plans WHERE id = v_plan;   -- clear the per-cycle slot

  BEGIN
    PERFORM create_custom_plan(v_cycle,
      jsonb_build_array(jsonb_build_object('item_id', v_ess, 'item_type', 'essential', 'quantity', 1)), 30);
    v_err := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_err := 'refused'; END;
  r := r || format('%sR1 essentials-only        -> refused ... %s%s', E'\n',
    CASE WHEN v_err = 'refused' THEN 'PASS' ELSE 'FAIL' END, E'\n');

  BEGIN
    PERFORM create_custom_plan(v_cycle,
      jsonb_build_array(jsonb_build_object('item_id', v_food, 'item_type', 'food', 'quantity', 1)), 9);
    v_err := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_err := 'refused'; END;
  r := r || format('R2 9 days (under 10)      -> refused ... %s%s',
    CASE WHEN v_err = 'refused' THEN 'PASS' ELSE 'FAIL' END, E'\n');

  BEGIN
    PERFORM create_custom_plan(v_cycle,
      jsonb_build_array(jsonb_build_object('item_id', v_food, 'item_type', 'food', 'quantity', 1)), 46);
    v_err := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_err := 'refused'; END;
  r := r || format('R3 46 days (over 45)      -> refused ... %s%s',
    CASE WHEN v_err = 'refused' THEN 'PASS' ELSE 'FAIL' END, E'\n');

  IF v_block IS NOT NULL THEN
    BEGIN
      PERFORM create_custom_plan(v_cycle,
        jsonb_build_array(jsonb_build_object('item_id', v_block, 'item_type', 'food', 'quantity', 1)), 30);
      v_err := 'accepted';
    EXCEPTION WHEN OTHERS THEN v_err := 'refused'; END;
    r := r || format('R4 building block (eligible!) -> refused ... %s%s',
      CASE WHEN v_err = 'refused' THEN 'PASS' ELSE 'FAIL (a block reached a customer plan)' END, E'\n');
  END IF;

  -- Not eligible: switch the flag off and try the same item again.
  UPDATE menu_items SET plan_eligible = FALSE WHERE id = v_food2;
  BEGIN
    PERFORM create_custom_plan(v_cycle, jsonb_build_array(
      jsonb_build_object('item_id', v_food,  'item_type', 'food', 'quantity', 1),
      jsonb_build_object('item_id', v_food2, 'item_type', 'food', 'quantity', 1)), 30);
    v_err := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_err := 'refused'; END;
  r := r || format('R5 item not plan_eligible -> refused ... %s%s',
    CASE WHEN v_err = 'refused' THEN 'PASS' ELSE 'FAIL' END, E'\n');
  UPDATE menu_items SET plan_eligible = TRUE WHERE id = v_food2;

  -- Four items.
  BEGIN
    PERFORM create_custom_plan(v_cycle, jsonb_build_array(
      jsonb_build_object('item_id', v_food,  'item_type', 'food',      'quantity', 1),
      jsonb_build_object('item_id', v_food2, 'item_type', 'food',      'quantity', 1),
      jsonb_build_object('item_id', v_ess,   'item_type', 'essential', 'quantity', 1),
      jsonb_build_object('item_id', v_food,  'item_type', 'food',      'quantity', 1)), 30);
    v_err := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_err := 'refused'; END;
  r := r || format('R6 four items             -> refused ... %s%s',
    CASE WHEN v_err = 'refused' THEN 'PASS' ELSE 'FAIL' END, E'\n');

  -- ── N. The customer's own name for it ────────────────────────
  DELETE FROM subscription_plans WHERE is_custom AND created_by = v_cust;
  v_res := create_custom_plan(v_cycle,
    jsonb_build_array(jsonb_build_object('item_id', v_food, 'item_type','food','quantity',1)),
    30, '  My breakfast plan  ');
  r := r || format('%sN1 name kept, trimmed             ... %s%s', E'\n',
    CASE WHEN v_res->>'plan_name' = 'My breakfast plan' THEN 'PASS'
         ELSE 'FAIL ("'||(v_res->>'plan_name')||'")' END, E'\n');

  DELETE FROM subscription_plans WHERE is_custom AND created_by = v_cust;
  v_res := create_custom_plan(v_cycle,
    jsonb_build_array(jsonb_build_object('item_id', v_food, 'item_type','food','quantity',1)),
    30, '   ');
  r := r || format('N2 blank name -> described        ... %s%s',
    CASE WHEN v_res->>'plan_name' LIKE 'My %% days' THEN 'PASS'
         ELSE 'FAIL ("'||(v_res->>'plan_name')||'")' END, E'\n');

  DELETE FROM subscription_plans WHERE is_custom AND created_by = v_cust;
  v_res := create_custom_plan(v_cycle,
    jsonb_build_array(jsonb_build_object('item_id', v_food, 'item_type','food','quantity',1)),
    30, repeat('x', 200));
  r := r || format('N3 overlong name capped at 40     ... %s%s',
    CASE WHEN length(v_res->>'plan_name') = 40 THEN 'PASS'
         ELSE 'FAIL ('||length(v_res->>'plan_name')||')' END, E'\n');

  DELETE FROM subscription_plans WHERE is_custom AND created_by = v_cust;

  -- ── M. The mixed plan the whole feature exists for ───────────
  v_res := create_custom_plan(v_cycle, jsonb_build_array(
    jsonb_build_object('item_id', v_food, 'item_type', 'food',      'quantity', 2),
    jsonb_build_object('item_id', v_ess,  'item_type', 'essential', 'quantity', 1)), 15);
  v_plan := (v_res->>'plan_id')::INTEGER;

  r := r || format('%sM1 food + essentials accepted     ... PASS%s', E'\n', E'\n');
  r := r || format('M2 daily = 2xfood + 1xessential   ... %s%s',
    CASE WHEN (v_res->>'daily_total')::numeric = (v_food_p * 2 + v_ess_p)
         THEN 'PASS' ELSE 'FAIL ('||(v_res->>'daily_total')||')' END, E'\n');
  r := r || format('M3 15 days -> 5%% slab             ... %s%s',
    CASE WHEN (v_res->>'discount_percent')::numeric = 5 THEN 'PASS' ELSE 'FAIL' END, E'\n');

  -- ── C. One active custom plan per cycle ──────────────────────
  INSERT INTO user_subscriptions (user_id, plan_id, start_date, days_consumed, is_active, is_paused, payment_method)
  VALUES (v_cust, v_plan, CURRENT_DATE, 0, TRUE, FALSE, 'wallet');
  BEGIN
    PERFORM create_custom_plan(v_cycle,
      jsonb_build_array(jsonb_build_object('item_id', v_food, 'item_type', 'food', 'quantity', 1)), 30);
    v_err := 'accepted';
  EXCEPTION WHEN OTHERS THEN v_err := 'refused'; END;
  r := r || format('%sC1 second plan, same cycle -> refused ... %s%s', E'\n',
    CASE WHEN v_err = 'refused' THEN 'PASS' ELSE 'FAIL' END, E'\n');

  PERFORM set_config('request.jwt.claims', NULL, true);
  r := r || E'\n════ rolled back — nothing kept ════';
  RAISE EXCEPTION '%', r;
END $$;
