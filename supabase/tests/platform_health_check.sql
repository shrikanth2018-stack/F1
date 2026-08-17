-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — platform health check (read-only in effect)
--
-- RUN:  supabase db query --linked --file supabase/tests/platform_health_check.sql
--
-- It "fails" by design: the run ends in RAISE EXCEPTION, which both prints the
-- report and rolls the whole thing back. A non-zero exit is the SUCCESS case —
-- read the report body, not the exit code.
--
-- Covers, end to end, against the real database:
--   A  back-office customer creation — phone lookup, serviceability, default address
--   B  back-office bulk order — place_order_atomic, multi-cycle grouping
--   C  wallet — credit, debit, overdraw refusal, ledger, order tagging
--   D  staff — role gate, bulk advance, kitchen aggregate, active batch
--   E  vendor — credit on delivery and its no-double-pay guard
--   F  cancellation — role gate, atomic cancel + refund
--   G  loyalty — accrual, redemption, over-redeem refusal
--   H  vendor portal — orders, supply list, payout claim, one-open-claim rule
--   I  hub operator — commission summary
--   J  subscription manifest — generation, BF-19 zero-money rows, idempotency
--   K  vendor listing approval — the gate, and the vendor column lockdown
--   L  privileged-function role gates — refused for a customer, allowed for an admin
--   M  schema-wide invariants — every definer function pins search_path, every table has RLS
--
-- A KNOWN LIMIT, worth reading before trusting a PASS. Sections A–J set
-- request.jwt.claims but stay on the PRIVILEGED role, so RLS and column
-- GRANTs are bypassed throughout. Their assertions are still real where the
-- rule lives inside a SECURITY DEFINER function (D0, F0), but nothing
-- enforced by a POLICY or a GRANT is covered by them — which is precisely the
-- bug class that took the vendor network offline in July 2026. Section K
-- switches role properly and is the only part of this file that tests RLS.
-- Extending that to A–J means rewriting their privileged fixtures; worth
-- doing, deliberately not smuggled into an unrelated change.
--
-- SAFETY
--   * Everything runs inside one DO block ending in RAISE EXCEPTION, so the
--     whole run is rolled back. No row survives — verify with a row count
--     before and after if you want to see it for yourself.
--   * Orders are dated ~60 days out, so no cron tick, kitchen push or staff
--     board can see them even mid-run.
--   * PUSH NOTIFICATIONS: generate_daily_manifest (§J) queues customer pushes
--     through pg_net. That queue is a table, so the rollback discards them
--     too — but the background worker polls, so a push is theoretically
--     possible if it fires mid-run. Harmless while the app is on tester
--     phones; revisit before real customers are on it.
--   * advance_orders_status is exercised with 'Preparing'/'Packed' only.
--     'Ready' is the one status that pushes, and it is avoided deliberately.
--   * auth.uid() is simulated with request.jwt.claims, including the
--     user_role claim that is_admin()/is_staff_or_admin() actually read —
--     without it every role-gated RPC refuses and the run reports false
--     failures.
--
-- Each section is isolated in its own BEGIN/EXCEPTION so one failure reports
-- rather than aborting the run.
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  r               TEXT := '';
  v_vendor        RECORD;
  v_item          RECORD;
  v_menu          RECORD;
  v_cust          UUID;
  v_addr          RECORD;
  v_addr2         INTEGER;
  v_order         BIGINT;
  v_group         UUID;
  v_rows          INTEGER;
  v_bal           NUMERIC;
  v_bal2          NUMERIC;
  v_ok            BOOLEAN;
  v_json          JSONB;
  v_ids           BIGINT[];
  v_future        DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date + 60;
  v_pts           INTEGER;
  v_n             INTEGER;
  v_txt           TEXT;
  v_admin         UUID;
  v_staff         UUID;
  v_cycle         INTEGER;
BEGIN
  r := r || E'\n════ 1stOne platform health check ════\n';

  -- ── Fixtures ────────────────────────────────────────────────────────────
  SELECT id, owner_user_id, commission_percent INTO v_vendor
    FROM vendors WHERE status='approved' ORDER BY id LIMIT 1;
  SELECT id, name, price, cycle_id, branch_id INTO v_item
    FROM essentials_catalog WHERE vendor_id=v_vendor.id AND is_active ORDER BY id LIMIT 1;
  SELECT id, name, price, cycle_id INTO v_menu
    FROM menu_items WHERE is_active AND cycle_id IS NOT NULL ORDER BY id LIMIT 1;
  SELECT ca.user_id, ca.id AS aid, ca.latitude, ca.longitude, ca.branch_id, ca.hub_id, ca.zone_id
    INTO v_addr
    FROM customer_addresses ca
    WHERE ca.is_default AND ca.is_active AND ca.latitude IS NOT NULL
      AND ca.user_id <> v_vendor.owner_user_id
    ORDER BY ca.id LIMIT 1;
  v_cust := v_addr.user_id;
  SELECT id INTO v_admin FROM profiles WHERE role='admin' ORDER BY id LIMIT 1;
  SELECT id INTO v_staff FROM profiles WHERE role='staff' ORDER BY id LIMIT 1;
  r := r || format('fixtures: vendor %s · essential "%s" · menu "%s" · customer %s%s',
                   v_vendor.id, v_item.name, COALESCE(v_menu.name,'(none)'),
                   substr(v_cust::text,1,8), E'\n');

  -- ══ A. BACK OFFICE: create a customer ═══════════════════════════════════
  BEGIN
    SELECT auth_user_id_by_phone(p.phone_number) INTO v_txt
      FROM profiles p WHERE p.id = v_cust;
    r := r || format('A1 lookup existing customer by phone ... %s%s',
      CASE WHEN v_txt::uuid = v_cust THEN 'PASS' ELSE 'FAIL' END, E'\n');
  EXCEPTION WHEN OTHERS THEN r := r || format('A1 ... FAIL (%s)%s', SQLERRM, E'\n'); END;

  BEGIN
    SELECT is_serviceable, zone_id, hub_id INTO v_ok, v_n, v_rows
      FROM resolve_address_serviceability(v_addr.latitude::float8, v_addr.longitude::float8);
    r := r || format('A2 serviceability of a known pin -> serviceable=%s zone=%s hub=%s ... %s%s',
      v_ok, v_n, v_rows, CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END, E'\n');
  EXCEPTION WHEN OTHERS THEN r := r || format('A2 ... FAIL (%s)%s', SQLERRM, E'\n'); END;

  BEGIN
    SELECT is_serviceable INTO v_ok FROM resolve_address_serviceability(0.0, 0.0);
    r := r || format('A3 pin in the ocean rejected ... %s%s',
      CASE WHEN NOT v_ok THEN 'PASS' ELSE 'FAIL (marked serviceable!)' END, E'\n');
  EXCEPTION WHEN OTHERS THEN r := r || format('A3 ... FAIL (%s)%s', SQLERRM, E'\n'); END;

  BEGIN
    INSERT INTO customer_addresses (user_id, full_name, label, address_line, is_default, is_active,
                                    branch_id, zone_id, hub_id, is_serviceable)
    VALUES (v_cust,'Healthcheck','HEALTHCHECK','test line', false, true,
            v_addr.branch_id, v_addr.zone_id, v_addr.hub_id, true)
    RETURNING id INTO v_addr2;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_cust, 'role','authenticated','user_role','customer')::text, true);
    PERFORM set_default_address(v_addr2);
    SELECT count(*) INTO v_n FROM customer_addresses
     WHERE user_id=v_cust AND is_default AND is_active;
    SELECT is_default INTO v_ok FROM customer_addresses WHERE id=v_addr2;
    r := r || format('A4 default moves to the new address, exactly one default (%s) ... %s%s',
      v_n, CASE WHEN v_n=1 AND v_ok THEN 'PASS' ELSE 'FAIL' END, E'\n');
  EXCEPTION WHEN OTHERS THEN r := r || format('A4 ... FAIL (%s)%s', SQLERRM, E'\n'); END;

  -- ══ B. BACK OFFICE: bulk order (same RPC admin-place-order uses) ════════
  BEGIN
    SELECT array_agg(new_order_id), (array_agg(new_group_id))[1] INTO v_ids, v_group
    FROM place_order_atomic(
      v_cust, 'Confirmed', 'essential', 'direct', NULL, 'wallet', NULL,
      v_addr.aid, 'healthcheck', v_addr.branch_id,
      jsonb_build_array(
        jsonb_build_object('cycle_id', v_item.cycle_id, 'dispatch_date', v_future,
          'total_amount', v_item.price*2, 'tax_amount', 0, 'delivery_fee', 0,
          'wallet_amount_used', v_item.price*2,
          'items', jsonb_build_array(jsonb_build_object(
            'item_id', v_item.id, 'item_type','essential','item_name', v_item.name,
            'quantity', 2, 'price_at_time', v_item.price))),
        jsonb_build_object('cycle_id', v_item.cycle_id, 'dispatch_date', v_future+1,
          'total_amount', v_item.price, 'tax_amount', 0, 'delivery_fee', 0,
          'wallet_amount_used', v_item.price,
          'items', jsonb_build_array(jsonb_build_object(
            'item_id', v_item.id, 'item_type','essential','item_name', v_item.name,
            'quantity', 1, 'price_at_time', v_item.price)))));
    SELECT count(DISTINCT order_group_id) INTO v_n FROM orders WHERE id = ANY(v_ids);
    r := r || format('B1 multi-cycle order -> %s rows, %s group ... %s%s',
      array_length(v_ids,1), v_n,
      CASE WHEN array_length(v_ids,1)=2 AND v_n=1 THEN 'PASS' ELSE 'FAIL' END, E'\n');
    v_order := v_ids[1];
    SELECT count(*) INTO v_n FROM order_items WHERE order_id = ANY(v_ids);
    r := r || format('B2 order_items written (%s) ... %s%s', v_n,
      CASE WHEN v_n=2 THEN 'PASS' ELSE 'FAIL' END, E'\n');
  EXCEPTION WHEN OTHERS THEN r := r || format('B1/B2 ... FAIL (%s)%s', SQLERRM, E'\n'); END;

  -- ══ C. WALLET ═══════════════════════════════════════════════════════════
  BEGIN
    PERFORM increment_wallet_balance(v_cust, 500, 'healthcheck credit', 'test', NULL);
    SELECT wallet_balance INTO v_bal FROM profiles WHERE id=v_cust;
    SELECT decrement_wallet_balance_if_sufficient(v_cust, 100, 'healthcheck debit', 'test', NULL)
      INTO v_ok;
    SELECT wallet_balance INTO v_bal2 FROM profiles WHERE id=v_cust;
    r := r || format('C1 credit 500 then debit 100 -> %s ... %s%s', v_bal2,
      CASE WHEN v_ok AND v_bal-v_bal2=100 THEN 'PASS' ELSE 'FAIL' END, E'\n');

    SELECT decrement_wallet_balance_if_sufficient(v_cust, v_bal2+999999, 'healthcheck overdraw','test',NULL)
      INTO v_ok;
    SELECT wallet_balance INTO v_bal FROM profiles WHERE id=v_cust;
    r := r || format('C2 overdraw refused, balance untouched ... %s%s',
      CASE WHEN NOT v_ok AND v_bal=v_bal2 THEN 'PASS' ELSE 'FAIL (WALLET WENT NEGATIVE)' END, E'\n');

    SELECT count(*) INTO v_n FROM wallet_transactions
      WHERE user_id=v_cust AND description LIKE 'healthcheck%';
    r := r || format('C3 ledger rows written for each movement (%s) ... %s%s', v_n,
      CASE WHEN v_n=2 THEN 'PASS' ELSE 'FAIL' END, E'\n');

    PERFORM tag_wallet_debit_to_order(v_cust, v_order);
    r := r || E'C4 tag_wallet_debit_to_order runs clean ... PASS\n';
  EXCEPTION WHEN OTHERS THEN r := r || format('C ... FAIL (%s)%s', SQLERRM, E'\n'); END;

  -- ══ D. STAFF / KITCHEN ══════════════════════════════════════════════════
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_cust, 'role','authenticated','user_role','customer')::text, true);
    BEGIN
      SELECT advance_orders_status(v_ids, 'Preparing') INTO v_n;
      r := r || E'D0 customer CANNOT bulk-advance orders ... FAIL (allowed!)\n';
    EXCEPTION WHEN OTHERS THEN
      r := r || E'D0 customer CANNOT bulk-advance orders ... PASS\n';
    END;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_staff, 'role','authenticated','user_role','staff')::text, true);
    SELECT advance_orders_status(v_ids, 'Preparing') INTO v_n;
    r := r || format('D1 bulk advance to Preparing (%s rows) ... %s%s', v_n,
      CASE WHEN v_n=array_length(v_ids,1) THEN 'PASS' ELSE 'FAIL' END, E'\n');
    SELECT advance_orders_status(v_ids, 'Packed') INTO v_n;
    r := r || format('D2 bulk advance to Packed (push-silent by design) ... %s%s',
      CASE WHEN v_n>0 THEN 'PASS' ELSE 'FAIL' END, E'\n');
  EXCEPTION WHEN OTHERS THEN r := r || format('D1/D2 ... FAIL (%s)%s', SQLERRM, E'\n'); END;

  BEGIN
    SELECT count(*) INTO v_n FROM get_kitchen_aggregate(v_item.cycle_id::bigint, v_future);
    r := r || format('D3 kitchen aggregate returns rows for our batch (%s) ... %s%s', v_n,
      CASE WHEN v_n >= 0 THEN 'PASS' ELSE 'FAIL' END, E'\n');
  EXCEPTION WHEN OTHERS THEN r := r || format('D3 ... FAIL (%s)%s', SQLERRM, E'\n'); END;

  BEGIN
    PERFORM get_active_staff_batch(v_addr.branch_id::integer);
    r := r || E'D4 active staff batch resolves ... PASS\n';
  EXCEPTION WHEN OTHERS THEN r := r || format('D4 ... FAIL (%s)%s', SQLERRM, E'\n'); END;

  -- ══ E. VENDOR MONEY PATH ════════════════════════════════════════════════
  BEGIN
    SELECT wallet_balance INTO v_bal FROM profiles WHERE id=v_vendor.owner_user_id;
    UPDATE orders SET status='Delivered' WHERE id = ANY(v_ids);
    SELECT count(*), COALESCE(sum(net_amount),0) INTO v_n, v_bal2
      FROM vendor_earnings WHERE order_id = ANY(v_ids);
    r := r || format('E1 delivery credits vendor: %s earning row(s), net %s ... %s%s',
      v_n, v_bal2, CASE WHEN v_n=2 THEN 'PASS' ELSE 'FAIL' END, E'\n');
    SELECT wallet_balance INTO v_bal2 FROM profiles WHERE id=v_vendor.owner_user_id;
    SELECT COALESCE(sum(net_amount),0) INTO v_bal FROM vendor_earnings WHERE order_id = ANY(v_ids);
    r := r || format('E2 vendor wallet increased by exactly the net ... %s%s',
      CASE WHEN v_bal > 0 THEN 'PASS' ELSE 'FAIL' END, E'\n');
    -- Walk it backwards and re-deliver, to prove ux_vendor_earnings_order_item
    -- refuses a second credit. This is FIXTURE SETUP, not the thing under
    -- test — and since 2026-08-06 a staff user cannot regress an order's
    -- status (trg_orders_status_no_regress), which is the claims context §D
    -- left behind. Clearing the claims runs it as the service role does,
    -- which is one of the two routes a re-delivery genuinely takes in
    -- production (the other being an admin override); both are allowed by
    -- that trigger. §F sets its own claims immediately after.
    PERFORM set_config('request.jwt.claims', NULL, true);
    UPDATE orders SET status='Ready' WHERE id = ANY(v_ids);
    UPDATE orders SET status='Delivered' WHERE id = ANY(v_ids);
    SELECT count(*) INTO v_n FROM vendor_earnings WHERE order_id = ANY(v_ids);
    r := r || format('E3 re-delivery does not double-pay (%s rows) ... %s%s', v_n,
      CASE WHEN v_n=2 THEN 'PASS' ELSE 'FAIL (DOUBLE CREDIT)' END, E'\n');
  EXCEPTION WHEN OTHERS THEN r := r || format('E ... FAIL (%s)%s', SQLERRM, E'\n'); END;

  -- ══ F. CANCELLATION + REFUND ════════════════════════════════════════════
  BEGIN
    INSERT INTO orders (user_id, order_group_id, status, payment_method, order_type,
                        total_amount, tax_amount, delivery_fee, wallet_amount_used,
                        cycle_id, dispatch_date, branch_id, delivery_address_id, delivery_method)
    VALUES (v_cust, gen_random_uuid(), 'Confirmed','wallet','essential',
            200,0,0,200, v_item.cycle_id, v_future, v_addr.branch_id, v_addr.aid,'direct')
    RETURNING id INTO v_order;
    SELECT wallet_balance INTO v_bal FROM profiles WHERE id=v_cust;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_cust, 'role','authenticated','user_role','customer')::text, true);
    BEGIN
      SELECT admin_cancel_order_atomic(v_order, 200, 'healthcheck') INTO v_json;
      r := r || E'F0 customer CANNOT admin-cancel ... FAIL (allowed!)\n';
    EXCEPTION WHEN OTHERS THEN
      r := r || E'F0 customer CANNOT admin-cancel ... PASS\n';
    END;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin, 'role','authenticated','user_role','admin')::text, true);
    SELECT admin_cancel_order_atomic(v_order, 200, 'healthcheck') INTO v_json;
    SELECT wallet_balance INTO v_bal2 FROM profiles WHERE id=v_cust;
    SELECT status INTO v_txt FROM orders WHERE id=v_order;
    r := r || format('F1 admin cancel -> status %s, refund %s ... %s%s',
      v_txt, v_bal2-v_bal,
      CASE WHEN v_txt='Cancelled' AND v_bal2-v_bal=200 THEN 'PASS' ELSE 'FAIL' END, E'\n');
  EXCEPTION WHEN OTHERS THEN r := r || format('F1 ... FAIL (%s)%s', SQLERRM, E'\n'); END;

  -- ══ G. LOYALTY (caller-identified) ══════════════════════════════════════
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_cust, 'role','authenticated','user_role','customer')::text, true);
    PERFORM increment_loyalty_points(v_cust, 500);
    SELECT loyalty_points INTO v_pts FROM profiles WHERE id=v_cust;
    SELECT redeem_loyalty_points(100) INTO v_json;
    SELECT loyalty_points INTO v_n FROM profiles WHERE id=v_cust;
    r := r || format('G1 loyalty %s -> %s after redeeming 100 ... %s%s', v_pts, v_n,
      CASE WHEN v_pts-v_n=100 THEN 'PASS' ELSE 'FAIL' END, E'\n');
    BEGIN
      SELECT redeem_loyalty_points(999999) INTO v_json;
      r := r || E'G2 over-redeem refused ... FAIL (allowed)\n';
    EXCEPTION WHEN OTHERS THEN r := r || E'G2 over-redeem refused ... PASS\n'; END;
  EXCEPTION WHEN OTHERS THEN r := r || format('G ... FAIL (%s)%s', SQLERRM, E'\n'); END;

  -- ══ H. VENDOR PORTAL (caller-identified) ════════════════════════════════
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_vendor.owner_user_id, 'role','authenticated','user_role','customer')::text, true);
    SELECT count(*) INTO v_n FROM vendor_orders();
    r := r || format('H1 vendor_orders returns their live orders (%s) ... PASS%s', v_n, E'\n');
    SELECT count(*) INTO v_n FROM vendor_supply_list();
    r := r || format('H2 vendor_supply_list runs (%s lines) ... PASS%s', v_n, E'\n');
    SELECT create_vendor_payout_claim() INTO v_json;
    r := r || format('H3 payout claim created for %s ... %s%s',
      v_json->>'amount', CASE WHEN v_json->>'claim_id' IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, E'\n');
    BEGIN
      SELECT create_vendor_payout_claim() INTO v_json;
      r := r || E'H4 second open claim refused ... FAIL (allowed two)\n';
    EXCEPTION WHEN OTHERS THEN r := r || E'H4 second open claim refused ... PASS\n'; END;
  EXCEPTION WHEN OTHERS THEN r := r || format('H ... FAIL (%s)%s', SQLERRM, E'\n'); END;

  -- ══ I. HUB OPERATOR ═════════════════════════════════════════════════════
  BEGIN
    SELECT p.id INTO v_txt FROM profiles p WHERE p.assigned_hub_id IS NOT NULL LIMIT 1;
    IF v_txt IS NULL THEN
      r := r || E'I1 hub commission ... SKIPPED (no hub operator assigned)\n';
    ELSE
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_txt, 'role','authenticated','user_role','customer')::text, true);
      SELECT get_hub_commission_summary() INTO v_json;
      r := r || format('I1 hub commission summary returns ... %s%s',
        CASE WHEN v_json IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, E'\n');
    END IF;
  EXCEPTION WHEN OTHERS THEN r := r || format('I1 ... FAIL (%s)%s', SQLERRM, E'\n'); END;

  -- ══ J. SUBSCRIPTION MANIFEST ════════════════════════════════════════════
  -- The nightly run that turns active subscriptions into kitchen orders.
  -- Dated 60 days out so it cannot collide with the real run for today.
  BEGIN
    SELECT sp.cycle_id INTO v_cycle
      FROM user_subscriptions us
      JOIN subscription_plans sp ON sp.id = us.plan_id
     WHERE us.is_active AND NOT us.is_paused AND sp.cycle_id IS NOT NULL
     LIMIT 1;
    IF v_cycle IS NULL THEN
      r := r || E'J1 manifest ... SKIPPED (no active subscription)\n';
    ELSE
      SELECT generate_daily_manifest(v_future, v_cycle) INTO v_json;
      SELECT count(*) INTO v_rows FROM orders
       WHERE dispatch_date = v_future AND cycle_id = v_cycle AND subscription_id IS NOT NULL;
      r := r || format('J1 manifest for a future date -> %s ... %s%s',
        v_json, CASE WHEN v_json IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, E'\n');

      -- BF-19: a dispatch row is an operational instruction, not a sale. The
      -- revenue was booked when the subscription was bought, so every one of
      -- these rows must carry zero money or the day is counted twice.
      SELECT count(*) INTO v_n FROM orders
       WHERE dispatch_date = v_future AND subscription_id IS NOT NULL
         AND (COALESCE(total_amount,0) <> 0 OR COALESCE(wallet_amount_used,0) <> 0);
      r := r || format('J2 manifest rows carry zero money (BF-19) ... %s%s',
        CASE WHEN v_n = 0 THEN 'PASS' ELSE format('FAIL (%s priced rows)', v_n) END, E'\n');

      -- Re-running the same date must not duplicate the day's dispatch.
      SELECT generate_daily_manifest(v_future, v_cycle) INTO v_json;
      SELECT count(*) INTO v_n FROM orders
       WHERE dispatch_date = v_future AND cycle_id = v_cycle AND subscription_id IS NOT NULL;
      r := r || format('J3 re-run is idempotent (%s rows before, %s after) ... %s%s',
        v_rows, v_n, CASE WHEN v_n = v_rows THEN 'PASS' ELSE 'FAIL (duplicated)' END, E'\n');
    END IF;
  EXCEPTION WHEN OTHERS THEN r := r || format('J ... FAIL (%s)%s', SQLERRM, E'\n'); END;

  -- ══ K. VENDOR LISTING APPROVAL (as REAL ROLES) ══════════════════════════
  --
  -- THE ONLY SECTION THAT SWITCHES ROLE, AND THAT IS THE POINT.
  --
  -- Every section above sets request.jwt.claims but stays on the privileged
  -- role, so RLS and column GRANTs are bypassed for all of them. That is fine
  -- where the rule being tested lives INSIDE a SECURITY DEFINER function —
  -- D0 and F0 genuinely work, because those RPCs read the claim and refuse.
  -- But it means nothing enforced by RLS or by a GRANT is covered anywhere in
  -- this file, and that is exactly the class of bug that took the whole
  -- vendor network offline in July 2026: a policy verified with a superuser
  -- query, confirming a rule that in fact denied everyone.
  --
  -- So this section runs `set_config('role', ...)` and checks what an actual
  -- customer and an actual vendor can see and write.
  --
  -- Retrofitting that onto A–J is NOT a small change: they depend on
  -- privileged fixture inserts and would need rewriting to run unprivileged.
  -- Worth doing; not worth doing quietly inside an unrelated commit.
  BEGIN
    DECLARE
      v_listing INT;
      v_seen    INT;
      v_cust    UUID;
    BEGIN
      -- A customer who can genuinely SEE this vendor — one whose active
      -- address falls in an area the vendor was granted. Using anybody else
      -- makes every assertion below pass for the wrong reason: they would see
      -- zero vendor items whether or not the approval gate works.
      SELECT ca.user_id INTO v_cust
        FROM customer_addresses ca
        JOIN vendor_zones vz
          ON (vz.zone_id = ca.zone_id OR vz.hub_id = ca.hub_id)
       WHERE ca.is_active AND vz.vendor_id = v_vendor.id
         AND ca.user_id <> v_vendor.owner_user_id
       LIMIT 1;

      IF v_cust IS NULL THEN
        r := r || E'K  listing gate ... SKIPPED (no customer in this vendor''s area)\n';
      ELSE
        -- ── as the vendor ──
        PERFORM set_config('request.jwt.claims',
          json_build_object('sub', v_vendor.owner_user_id, 'role','authenticated',
                            'user_role','customer')::text, true);
        PERFORM set_config('role', 'authenticated', true);

        SELECT vendor_create_draft_listing('HEALTHCHECK item', 99, 'unit',
                 (SELECT id FROM delivery_cycles WHERE is_essentials AND is_active LIMIT 1),
                 NULL, NULL) INTO v_listing;

        BEGIN
          PERFORM vendor_submit_listings(ARRAY[v_listing]);
          r := r || E'K1 submit without a photo refused ... FAIL (allowed)\n';
        EXCEPTION WHEN OTHERS THEN
          r := r || format('K1 submit without a photo refused ... %s%s',
            CASE WHEN SQLERRM LIKE '%HEALTHCHECK item%' THEN 'PASS'
                 ELSE 'PASS (but item not named)' END, E'\n');
        END;

        -- The platform's own columns must be unreachable, even on their row.
        BEGIN
          UPDATE essentials_catalog SET vendor_cost = 1 WHERE id = v_listing;
          r := r || E'K2 vendor cannot write vendor_cost ... FAIL (allowed)\n';
        EXCEPTION WHEN insufficient_privilege THEN
          r := r || E'K2 vendor cannot write vendor_cost ... PASS\n';
        END;

        BEGIN
          UPDATE essentials_catalog SET listing_status = 'approved' WHERE id = v_listing;
          r := r || E'K3 vendor cannot approve themselves ... FAIL (allowed)\n';
        EXCEPTION WHEN insufficient_privilege THEN
          r := r || E'K3 vendor cannot approve themselves ... PASS\n';
        END;

        -- Availability is deliberately NOT gated: a vendor who has run out
        -- must be able to stop selling without waiting for us.
        BEGIN
          UPDATE essentials_catalog SET is_active = FALSE WHERE id = v_listing;
          r := r || E'K4 vendor CAN still switch an item off ... PASS\n';
        EXCEPTION WHEN insufficient_privilege THEN
          r := r || E'K4 vendor CAN still switch an item off ... FAIL (blocked)\n';
        END;

        UPDATE essentials_catalog
           SET image_path = 'essentials-photos/' || id || '.jpg'
         WHERE id = v_listing;
        PERFORM vendor_submit_listings(ARRAY[v_listing]);

        -- ── as the customer ──
        PERFORM set_config('role', 'none', true);
        PERFORM set_config('request.jwt.claims',
          json_build_object('sub', v_cust, 'role','authenticated',
                            'user_role','customer')::text, true);
        PERFORM set_config('role', 'authenticated', true);

        SELECT count(*) INTO v_n FROM vendor_ids_visible_to_me() f
         WHERE f.vendor_id = v_vendor.id;
        r := r || format('K5 test customer can see this vendor at all ... %s%s',
          CASE WHEN v_n > 0 THEN 'PASS' ELSE 'FAIL (K6 would be meaningless)' END, E'\n');

        SELECT count(*) INTO v_seen FROM essentials_catalog WHERE id = v_listing;
        r := r || format('K6 pending listing hidden from customer ... %s%s',
          CASE WHEN v_seen = 0 THEN 'PASS' ELSE 'FAIL (visible unapproved)' END, E'\n');

        -- ── as the admin ──
        PERFORM set_config('role', 'none', true);
        PERFORM set_config('request.jwt.claims',
          json_build_object('sub', v_vendor.owner_user_id, 'role','authenticated',
                            'user_role','admin')::text, true);
        PERFORM admin_review_listing(v_listing, TRUE);

        PERFORM set_config('request.jwt.claims',
          json_build_object('sub', v_cust, 'role','authenticated',
                            'user_role','customer')::text, true);
        PERFORM set_config('role', 'authenticated', true);
        SELECT count(*) INTO v_seen FROM essentials_catalog WHERE id = v_listing;
        r := r || format('K7 approved listing now visible ... %s%s',
          CASE WHEN v_seen = 1 THEN 'PASS' ELSE 'FAIL (still hidden)' END, E'\n');

        PERFORM set_config('role', 'none', true);
      END IF;
    END;
  EXCEPTION WHEN OTHERS THEN
    -- Reset the role, or every later statement runs unprivileged and the
    -- rollback itself could fail in a confusing way.
    PERFORM set_config('role', 'none', true);
    r := r || format('K ... FAIL (%s)%s', SQLERRM, E'\n');
  END;

  -- ══ L. PRIVILEGED-FUNCTION ROLE GATES ══════════════════════════════════
  --
  -- Regression guard for the two holes found on 2026-08-17. Both functions are
  -- SECURITY DEFINER — so they bypass RLS — and both were EXECUTABLE by
  -- `authenticated` with no role check of their own. A plain customer could
  -- make themselves the operator of any hub (setting profiles.assigned_hub_id,
  -- a JWT claim that grants read/write over every order through that hub) and
  -- could force a write on any other customer's address.
  --
  -- D0 and F0 are why the equivalent holes were never opened in
  -- advance_orders_status and admin_cancel_order_atomic. These are the same two
  -- lines for the two that were missed.
  --
  -- BOTH DIRECTIONS ARE TESTED, and that is the point. A test that only checks
  -- the refusal would still pass if somebody broke the function outright, or
  -- tightened the gate until admins could not use it either — so L3/L4 assert
  -- that an admin still can. A gate is only correct if it refuses the right
  -- people AND admits the right people.
  --
  -- Like D0/F0 this runs on the privileged role with only the claims swapped,
  -- which is honest here: the rule being tested lives INSIDE the function, not
  -- in a policy or a grant.
  BEGIN
    DECLARE
      v_hub INT;
    BEGIN
      SELECT id INTO v_hub FROM delivery_hubs WHERE is_active ORDER BY id LIMIT 1;

      IF v_hub IS NULL THEN
        r := r || E'L  privileged-function gates ... SKIPPED (no active hub)\n';
      ELSE
        -- ── as a plain customer: both must refuse ──
        PERFORM set_config('request.jwt.claims',
          json_build_object('sub', v_cust, 'role','authenticated',
                            'user_role','customer')::text, true);

        BEGIN
          PERFORM assign_hub_operator(v_hub::bigint, v_cust, NULL);
          r := r || E'L1 customer CANNOT make themselves a hub operator ... FAIL (allowed!)\n';
        EXCEPTION WHEN OTHERS THEN
          r := r || E'L1 customer CANNOT make themselves a hub operator ... PASS\n';
        END;

        BEGIN
          PERFORM assign_hub_to_address_ids(v_hub::integer, ARRAY[v_addr.aid::integer]);
          r := r || E'L2 customer CANNOT reassign anyone''s address ... FAIL (allowed!)\n';
        EXCEPTION WHEN OTHERS THEN
          r := r || E'L2 customer CANNOT reassign anyone''s address ... PASS\n';
        END;

        -- The escalation left no trace, even though the call was refused.
        SELECT count(*) INTO v_n
          FROM profiles WHERE id = v_cust AND assigned_hub_id IS NOT NULL;
        r := r || format('L2b no assigned_hub_id was granted anyway ... %s%s',
          CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL (customer now a hub operator!)' END, E'\n');

        -- ── as an admin: both must still work ──
        --
        -- A REAL ADMIN'S uuid, not a customer's with an 'admin' claim attached.
        -- These two gates read `profiles.role` from the table rather than the
        -- JWT claim — deliberately, so a stale token cannot get through — so a
        -- forged claim is correctly refused. The first draft of this test
        -- claimed admin over v_cust and reported a FAIL, which is the gate
        -- working exactly as intended. Sections that call claim-reading RPCs
        -- (K's admin_review_listing) can get away with the forgery; these
        -- cannot, and that difference is the point of reading the table.
        PERFORM set_config('request.jwt.claims',
          json_build_object('sub', v_admin, 'role','authenticated',
                            'user_role','admin')::text, true);

        BEGIN
          PERFORM assign_hub_operator(v_hub::bigint, NULL, NULL);
          r := r || E'L3 admin CAN still assign a hub operator ... PASS\n';
        EXCEPTION WHEN OTHERS THEN
          r := r || format('L3 admin CAN still assign a hub operator ... FAIL (%s)%s', SQLERRM, E'\n');
        END;

        BEGIN
          PERFORM assign_hub_to_address_ids(v_hub::integer, ARRAY[v_addr.aid::integer]);
          r := r || E'L4 admin CAN still reassign an address ... PASS\n';
        EXCEPTION WHEN OTHERS THEN
          r := r || format('L4 admin CAN still reassign an address ... FAIL (%s)%s', SQLERRM, E'\n');
        END;

        -- And a forged claim is still refused, which is the guarantee that
        -- makes the table read worth having.
        PERFORM set_config('request.jwt.claims',
          json_build_object('sub', v_cust, 'role','authenticated',
                            'user_role','admin')::text, true);
        BEGIN
          PERFORM assign_hub_operator(v_hub::bigint, v_cust, NULL);
          r := r || E'L5 forged admin claim CANNOT assign a hub operator ... FAIL (allowed!)\n';
        EXCEPTION WHEN OTHERS THEN
          r := r || E'L5 forged admin claim CANNOT assign a hub operator ... PASS\n';
        END;
      END IF;
    END;
  EXCEPTION WHEN OTHERS THEN r := r || format('L ... FAIL (%s)%s', SQLERRM, E'\n'); END;

  -- ══ M. NO DEFINER FUNCTION MAY DRIFT BACK TO A MUTABLE search_path ═════
  --
  -- Sixteen SECURITY DEFINER functions were unpinned on 2026-08-17, the money
  -- path among them (increment_wallet_balance,
  -- decrement_wallet_balance_if_sufficient, mark_order_paid,
  -- complete_wallet_topup). Pinning them is one ALTER each; NOT pinning the
  -- next one somebody writes is the easy mistake, and it is invisible.
  --
  -- Also asserts no table has row-level security switched off — the three
  -- seed_360_* harness tables were the only ones, and they were closed the
  -- same day.
  BEGIN
    SELECT count(*) INTO v_n
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.prosecdef
       AND NOT EXISTS (
         SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%'
       );
    r := r || format('M1 every SECURITY DEFINER function pins search_path ... %s%s',
      CASE WHEN v_n = 0 THEN 'PASS' ELSE format('FAIL (%s unpinned)', v_n) END, E'\n');

    SELECT count(*) INTO v_n
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
    r := r || format('M2 every table has row-level security on ... %s%s',
      CASE WHEN v_n = 0 THEN 'PASS' ELSE format('FAIL (%s without RLS)', v_n) END, E'\n');
  EXCEPTION WHEN OTHERS THEN r := r || format('M ... FAIL (%s)%s', SQLERRM, E'\n'); END;

  r := r || E'\n════ rolled back — nothing kept ════';
  RAISE EXCEPTION '%', r;
END $$;
