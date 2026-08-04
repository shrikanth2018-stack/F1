-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — 360 walkthrough: TEARDOWN
--
-- RUN:  supabase db query --linked --file supabase/tests/teardown_360.sql
--
-- Undoes seed_360.sql AND everything the walkthrough produced on top of it,
-- leaving the database as it stood before the run.
--
-- WHY THIS IS SURGICAL RATHER THAN A WIPE. clear_test_history_2026_08.sql
-- already exists and empties order history outright — correct for a pre-launch
-- clean slate, wrong as a habit. This is bounded three ways at once:
--
--   * registered rows      what the seed itself created, by primary key
--   * after started_at     nothing that predates the run can be caught
--   * the test cast only   rows belonging to profiles that existed at seed
--                          time, so a real customer arriving mid-walk is
--                          never touched
--
-- All three must agree before a row is deleted. That is deliberately paranoid:
-- the day this is run with real data in the database, "I only meant to delete
-- the test rows" needs to be a guarantee, not an intention.
--
-- ORDER MATTERS. Three foreign keys are ON DELETE NO ACTION and will block a
-- delete in the obvious order (documented in clear_test_history_2026_08.sql):
--   loyalty_redemptions.reference_order_id -> orders
--   orders.subscription_id                 -> user_subscriptions
--   user_subscriptions.plan_id             -> subscription_plans
-- so children go first. The CASCADE ones — order_items, order_item_ratings,
-- vendor_order_fulfilment, cancelled_subscription_days, subscription_plan_items,
-- attendance_correction_days — come along on their own.
--
-- Prints what it removed, then leaves the run closed. Safe to re-run: a second
-- pass finds nothing and reports zeroes.
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_run     BIGINT;
  v_from    TIMESTAMPTZ;
  v_cast    UUID[];
  v_plans   BIGINT[];
  v_orders  BIGINT[];
  v_report  TEXT := '';
  v_n       INTEGER;
  v_corrected_days DATE[];
BEGIN
  SELECT id, started_at INTO v_run, v_from
    FROM public.seed_360_run ORDER BY id DESC LIMIT 1;

  IF v_run IS NULL THEN
    RAISE NOTICE '[teardown_360] no run recorded — nothing to undo';
    RETURN;
  END IF;

  -- The cast: everyone who had a wallet snapshot taken, i.e. every profile
  -- that existed when the run started. Anyone created since is NOT ours.
  SELECT array_agg(user_id) INTO v_cast
    FROM public.seed_360_wallet_snapshot WHERE run_id = v_run;

  SELECT array_agg(pk::bigint) INTO v_plans
    FROM public.seed_360_registry
   WHERE run_id = v_run AND table_name = 'subscription_plans';

  -- Orders in scope: created during the run, by the cast. Covers both what the
  -- walk placed by hand and what the nightly manifest dispatched from a
  -- seeded plan.
  SELECT array_agg(id) INTO v_orders
    FROM public.orders
   WHERE created_at >= v_from AND user_id = ANY(v_cast);

  -- ── 1. Order history, children first ─────────────────────────
  DELETE FROM public.loyalty_redemptions
   WHERE (reference_order_id = ANY(COALESCE(v_orders, '{}'::bigint[])))
      OR (user_id = ANY(v_cast) AND created_at >= v_from);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_report := v_report || format(E'loyalty_redemptions  %s\n', v_n);

  DELETE FROM public.app_feedback
   WHERE order_id = ANY(COALESCE(v_orders, '{}'::bigint[]));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_report := v_report || format(E'app_feedback         %s\n', v_n);

  DELETE FROM public.vendor_earnings
   WHERE order_id = ANY(COALESCE(v_orders, '{}'::bigint[]));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_report := v_report || format(E'vendor_earnings      %s\n', v_n);

  DELETE FROM public.orders WHERE id = ANY(COALESCE(v_orders, '{}'::bigint[]));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_report := v_report || format(E'orders               %s\n', v_n);

  -- ── 2. Subscriptions, then the seeded plans ──────────────────
  DELETE FROM public.user_subscriptions
   WHERE user_id = ANY(v_cast)
     AND (created_at >= v_from OR plan_id = ANY(COALESCE(v_plans, '{}'::bigint[])));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_report := v_report || format(E'user_subscriptions   %s\n', v_n);

  DELETE FROM public.subscription_plans WHERE id = ANY(COALESCE(v_plans, '{}'::bigint[]));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_report := v_report || format(E'subscription_plans   %s\n', v_n);

  -- ── 3. Staff records the walk produced ───────────────────────
  -- The days an approved correction BACKFILLED, captured before the requests
  -- are deleted and the link is gone. A correction exists precisely to write
  -- attendance for a date in the past, so "date >= run start" can never catch
  -- those rows — the first run of this teardown left one behind for exactly
  -- that reason.
  SELECT array_agg(DISTINCT d.the_date) INTO v_corrected_days
    FROM public.attendance_correction_days d
    JOIN public.attendance_correction_requests r ON r.id = d.request_id
   WHERE r.staff_id = ANY(v_cast) AND r.created_at >= v_from;

  DELETE FROM public.attendance_correction_requests
   WHERE staff_id = ANY(v_cast) AND created_at >= v_from;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_report := v_report || format(E'attendance_corr      %s\n', v_n);

  -- staff_attendance has no created_at — its `date` IS the row's identity, and
  -- scoping on the attendance date is the more honest bound anyway: it removes
  -- the days the walk clocked, not rows that merely happen to be new. Plus any
  -- past day a correction wrote, from above.
  DELETE FROM public.staff_attendance
   WHERE staff_id = ANY(v_cast)
     AND (date >= v_from::date
       OR date = ANY(COALESCE(v_corrected_days, ARRAY[]::date[])));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_report := v_report || format(E'staff_attendance     %s\n', v_n);

  DELETE FROM public.staff_leaves
   WHERE staff_id = ANY(v_cast) AND created_at >= v_from;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_report := v_report || format(E'staff_leaves         %s\n', v_n);

  DELETE FROM public.expense_claims
   WHERE staff_id = ANY(v_cast) AND created_at >= v_from;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_report := v_report || format(E'expense_claims       %s\n', v_n);

  DELETE FROM public.staff_salary
   WHERE staff_id = ANY(v_cast) AND created_at >= v_from;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_report := v_report || format(E'staff_salary         %s\n', v_n);

  -- ── 4. Vendor listings drafted during the walk ───────────────
  DELETE FROM public.vendor_listing_changes WHERE submitted_at >= v_from;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_report := v_report || format(E'listing_changes      %s\n', v_n);

  DELETE FROM public.essentials_catalog
   WHERE created_at >= v_from AND vendor_id IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_report := v_report || format(E'vendor listings      %s\n', v_n);

  -- ── 5. Payment + notification debris ─────────────────────────
  DELETE FROM public.pending_wallet_topups
   WHERE user_id = ANY(v_cast) AND created_at >= v_from;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_report := v_report || format(E'pending_topups       %s\n', v_n);

  DELETE FROM public.idempotency_keys
   WHERE user_id = ANY(v_cast) AND created_at >= v_from;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_report := v_report || format(E'idempotency_keys     %s\n', v_n);

  DELETE FROM public.push_logs
   WHERE user_id = ANY(v_cast) AND sent_at >= v_from;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_report := v_report || format(E'push_logs            %s\n', v_n);

  -- ── 6. Registered rows (the seed's own catalogue writes) ─────
  DELETE FROM public.customer_addresses ca
   USING public.seed_360_registry r
   WHERE r.run_id = v_run AND r.table_name = 'customer_addresses' AND ca.id = r.pk::bigint;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_report := v_report || format(E'seeded addresses     %s\n', v_n);

  -- ── 7. Wallets + loyalty back to the snapshot ────────────────
  -- Ledger first, then the balance, so the two agree at the end. Restoring the
  -- balance without clearing the ledger is how you manufacture the exact
  -- discrepancy this project keeps auditing for.
  DELETE FROM public.wallet_transactions
   WHERE user_id = ANY(v_cast) AND created_at >= v_from;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_report := v_report || format(E'wallet_transactions  %s\n', v_n);

  UPDATE public.profiles p
     SET wallet_balance = s.balance,
         loyalty_points = s.points
    FROM public.seed_360_wallet_snapshot s
   WHERE s.run_id = v_run AND p.id = s.user_id
     AND (p.wallet_balance IS DISTINCT FROM s.balance
       OR p.loyalty_points IS DISTINCT FROM s.points);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_report := v_report || format(E'wallets restored     %s\n', v_n);

  UPDATE public.seed_360_run SET closed_at = now() WHERE id = v_run;

  RAISE NOTICE E'\n════ teardown of run % ════\n%════════════════════════\n', v_run, v_report;
END $$;

-- ── What is left ───────────────────────────────────────────────
-- Every line should read 0 for the cast. Anything else is either real data
-- that arrived during the walk, or something the teardown does not know about.
SELECT 'orders'             AS tbl, count(*)::text AS remaining FROM public.orders
UNION ALL SELECT 'user_subscriptions', count(*)::text FROM public.user_subscriptions
UNION ALL SELECT '[360] plans',        count(*)::text FROM public.subscription_plans WHERE plan_name LIKE '[360]%'
UNION ALL SELECT '[360] addresses',    count(*)::text FROM public.customer_addresses WHERE label LIKE '[360]%'
UNION ALL SELECT 'staff_attendance',   count(*)::text FROM public.staff_attendance
UNION ALL SELECT 'expense_claims',     count(*)::text FROM public.expense_claims
UNION ALL SELECT 'vendor_earnings',    count(*)::text FROM public.vendor_earnings
UNION ALL SELECT 'wallet balance = ledger?',
  CASE WHEN EXISTS (
    SELECT 1 FROM public.profiles p
    LEFT JOIN (
      SELECT user_id,
             SUM(CASE WHEN transaction_type = 'credit' THEN amount ELSE -amount END) AS net
        FROM public.wallet_transactions GROUP BY user_id) l ON l.user_id = p.id
    WHERE COALESCE(p.wallet_balance,0) <> COALESCE(l.net,0)
  ) THEN 'NO — mismatch' ELSE 'yes' END;
