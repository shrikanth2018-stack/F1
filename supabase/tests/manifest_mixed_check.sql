-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — the manifest emits pure rows
--
-- RUN:  supabase db query --linked --file supabase/tests/manifest_mixed_check.sql
--
-- It "fails" by design: the run ends in RAISE EXCEPTION, which both prints
-- the report and rolls the whole thing back. A non-zero exit is the SUCCESS
-- case — read the report body, not the exit code.
--
-- RUN AFTER APPLYING manifest_mixed_plan_rows.sql.
--
-- WHAT IT PROVES, in two halves.
--
--   NEW  a mixed plan (food + essentials) yields one PURE food row and one
--        PURE essentials row, sharing an order_group_id, each line priced
--        from its own catalogue.
--
--   OLD  a single-type plan comes out exactly as it did before — same row
--        count, same order_type, same item types, same names, same prices.
--        This is the half that matters: the change is in the cron that feeds
--        people daily, and "the new case works" is worthless without "the
--        existing case is untouched".
--
-- Every fixture is created inside the transaction and rolled back. No push is
-- sent: pg_net enqueues into a table, so the rollback discards the request
-- with everything else.
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  r            TEXT := E'\n════ manifest: pure rows per type ════\n';
  v_cust       UUID;
  v_addr       BIGINT;
  v_branch     BIGINT;
  v_cycle      INTEGER;
  v_food_id    INTEGER;
  v_food_price NUMERIC;
  v_ess_id     INTEGER;
  v_ess_price  NUMERIC;
  v_mixed_plan INTEGER;
  v_food_plan  INTEGER;
  v_mixed_sub  BIGINT;
  v_food_sub   BIGINT;
  v_target     DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date + 30;  -- clear of real data
  n            INTEGER;
  t            TEXT;
  v_groups     INTEGER;
BEGIN
  -- ── Fixtures ─────────────────────────────────────────────────
  SELECT ca.user_id, ca.id, ca.branch_id INTO v_cust, v_addr, v_branch
    FROM customer_addresses ca WHERE ca.is_active LIMIT 1;

  SELECT mi.id, mi.price, mi.cycle_id INTO v_food_id, v_food_price, v_cycle
    FROM menu_items mi
   WHERE mi.is_active AND mi.is_customer_visible AND mi.cycle_id IS NOT NULL
   LIMIT 1;

  SELECT ec.id, ec.price INTO v_ess_id, v_ess_price
    FROM essentials_catalog ec WHERE ec.is_active AND ec.cycle_id IS NOT NULL LIMIT 1;

  IF v_food_id IS NULL OR v_ess_id IS NULL THEN
    RAISE EXCEPTION 'need one food and one essential item to test with';
  END IF;

  r := r || format('fixtures: food %s (%s), essential %s (%s), cycle %s, date %s%s',
    v_food_id, v_food_price, v_ess_id, v_ess_price, v_cycle, v_target, E'\n\n');

  -- ── A MIXED plan: one food line + one essentials line ────────
  INSERT INTO subscription_plans
    (plan_name, duration_days, price, plan_type, cycle_id, is_active, branch_id, plan_items)
  VALUES ('TEST mixed', 30, 1000, 'food', v_cycle, TRUE, v_branch,
    format('[{"item_id":%s,"item_type":"food","quantity":2},
             {"item_id":%s,"item_type":"essential","quantity":1}]', v_food_id, v_ess_id))
  RETURNING id INTO v_mixed_plan;

  -- ── A LEGACY single-type plan: no item_type on the line ──────
  INSERT INTO subscription_plans
    (plan_name, duration_days, price, plan_type, cycle_id, is_active, branch_id, plan_items)
  VALUES ('TEST legacy food', 30, 1000, 'food', v_cycle, TRUE, v_branch,
    format('[{"item_id":%s,"quantity":1}]', v_food_id))
  RETURNING id INTO v_food_plan;

  INSERT INTO user_subscriptions (user_id, plan_id, start_date, days_consumed, is_active, is_paused, payment_method)
  VALUES (v_cust, v_mixed_plan, v_target, 0, TRUE, FALSE, 'wallet') RETURNING id INTO v_mixed_sub;
  INSERT INTO user_subscriptions (user_id, plan_id, start_date, days_consumed, is_active, is_paused, payment_method)
  VALUES (v_cust, v_food_plan, v_target, 0, TRUE, FALSE, 'wallet') RETURNING id INTO v_food_sub;

  PERFORM generate_daily_manifest(v_target, v_cycle);

  -- ── NEW: the mixed plan split ────────────────────────────────
  SELECT count(*) INTO n FROM orders WHERE subscription_id = v_mixed_sub;
  r := r || format('N1 mixed plan -> 2 rows            ... %s%s',
    CASE WHEN n = 2 THEN 'PASS' ELSE 'FAIL ('||n||')' END, E'\n');

  SELECT count(DISTINCT order_group_id) INTO v_groups FROM orders WHERE subscription_id = v_mixed_sub;
  r := r || format('N2 both share ONE order_group_id  ... %s%s',
    CASE WHEN v_groups = 1 THEN 'PASS' ELSE 'FAIL ('||v_groups||' groups — packers would make two bags)' END, E'\n');

  -- Purity: no row may hold two item types.
  SELECT count(*) INTO n FROM (
    SELECT o.id FROM orders o JOIN order_items oi ON oi.order_id = o.id
     WHERE o.subscription_id = v_mixed_sub
     GROUP BY o.id HAVING count(DISTINCT oi.item_type) > 1
  ) x;
  r := r || format('N3 every row is PURE              ... %s%s',
    CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ('||n||' mixed row(s))' END, E'\n');

  -- The row's own order_type must equal the type of the lines inside it.
  SELECT count(*) INTO n FROM orders o JOIN order_items oi ON oi.order_id = o.id
   WHERE o.subscription_id = v_mixed_sub AND o.order_type <> oi.item_type;
  r := r || format('N4 order_type matches its lines   ... %s%s',
    CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ('||n||' line(s) disagree)' END, E'\n');

  -- Priced from the right catalogue — the ids overlap between the two tables.
  SELECT oi.price_at_time INTO t FROM orders o JOIN order_items oi ON oi.order_id = o.id
   WHERE o.subscription_id = v_mixed_sub AND oi.item_type = 'essential';
  r := r || format('N5 essential priced from essentials (%s vs %s) ... %s%s',
    t, v_ess_price, CASE WHEN t::numeric = v_ess_price THEN 'PASS' ELSE 'FAIL' END, E'\n');

  SELECT oi.quantity INTO n FROM orders o JOIN order_items oi ON oi.order_id = o.id
   WHERE o.subscription_id = v_mixed_sub AND oi.item_type = 'food';
  r := r || format('N6 quantity carried through (2)   ... %s%s',
    CASE WHEN n = 2 THEN 'PASS' ELSE 'FAIL ('||n||')' END, E'\n');

  -- ── OLD: the legacy plan is untouched ────────────────────────
  SELECT count(*) INTO n FROM orders WHERE subscription_id = v_food_sub;
  r := r || format('%sO1 legacy plan -> exactly 1 row   ... %s%s', E'\n',
    CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL ('||n||')' END, E'\n');

  SELECT order_type INTO t FROM orders WHERE subscription_id = v_food_sub;
  r := r || format('O2 legacy row typed food          ... %s%s',
    CASE WHEN t = 'food' THEN 'PASS' ELSE 'FAIL ('||t||')' END, E'\n');

  -- A line with no item_type must inherit the plan's type, not go null.
  SELECT oi.item_type INTO t FROM orders o JOIN order_items oi ON oi.order_id = o.id
   WHERE o.subscription_id = v_food_sub;
  r := r || format('O3 line with no item_type -> food ... %s%s',
    CASE WHEN t = 'food' THEN 'PASS' ELSE 'FAIL ('||COALESCE(t,'null')||')' END, E'\n');

  SELECT oi.price_at_time INTO t FROM orders o JOIN order_items oi ON oi.order_id = o.id
   WHERE o.subscription_id = v_food_sub;
  r := r || format('O4 legacy line priced from menu   ... %s%s',
    CASE WHEN t::numeric = v_food_price THEN 'PASS' ELSE 'FAIL ('||t||')' END, E'\n');

  -- BF-19: a dispatch row carries no money, whatever its type.
  SELECT count(*) INTO n FROM orders
   WHERE subscription_id IN (v_mixed_sub, v_food_sub)
     AND (total_amount <> 0 OR tax_amount <> 0 OR delivery_fee <> 0 OR wallet_amount_used <> 0);
  r := r || format('O5 every dispatch row is ₹0       ... %s%s',
    CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL ('||n||' priced row(s))' END, E'\n');

  -- ── Idempotency, which the split could have broken ───────────
  PERFORM generate_daily_manifest(v_target, v_cycle);
  SELECT count(*) INTO n FROM orders WHERE subscription_id = v_mixed_sub;
  r := r || format('%sI1 re-run creates nothing more    ... %s%s', E'\n',
    CASE WHEN n = 2 THEN 'PASS' ELSE 'FAIL (now '||n||' rows — days_consumed would burn down)' END, E'\n');

  SELECT days_consumed INTO n FROM user_subscriptions WHERE id = v_mixed_sub;
  r := r || format('I2 days_consumed still 1          ... %s%s',
    CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL ('||n||')' END, E'\n');

  r := r || E'\n════ rolled back — nothing kept, no push sent ════';
  RAISE EXCEPTION '%', r;
END $$;
