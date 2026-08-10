-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — what "undelivered" actually means
--
-- THE BUG. Admin → Orders → Undelivered asked `dispatch_date < today`. The
-- undelivered-batch alert reports whatever was still open in the batch a push
-- just replaced. Those are not the same question, and with four cycles a day
-- they disagree for most of the day:
--
--   Breakfast is released at 06:00 and one order never goes out. At 10:30
--   Lunch is released, the boards flip, and the alert correctly says "1 order
--   left undelivered". Its dispatch_date is TODAY, so `< today` is false and
--   the Undelivered tab cannot show it. The order is now on no board and in
--   no list — invisible until midnight, which is precisely the disappearance
--   the batch rule was supposed to make impossible.
--
-- Found by tapping the notification and landing on an empty tab. The push and
-- the screen were each right on their own terms and wrong together.
--
-- THE DEFINITION, once, here. An order is undelivered when it is unfinished
-- AND it is not the batch currently on the boards AND either
--
--   * its cycle+date was released at some point and has since been replaced
--     — the same kitchen_push_log test vendor_orders() uses to decide
--     'history', so the vendor's list and the admin's cannot drift apart; or
--   * its date has simply passed without ever being released, which is what
--     a missed cron looks like. Being generous here is deliberate: showing an
--     order that turns out to be fine costs a glance, and hiding one costs
--     somebody their food.
--
-- Returns IDS ONLY. The screen already selects the columns it renders,
-- including the nested address → hub/zone embed that PostgREST gives it for
-- free and an RPC would have to flatten by hand. Narrowing the id set is the
-- whole fix; nothing about the row rendering has to change.
--
-- Deploy: paste into the Supabase SQL editor. Idempotent.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_undelivered_order_ids()
RETURNS TABLE (order_id BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Gated in the database, not merely by which screen calls it. Reads the
  -- table rather than the JWT claim so a stale token cannot grant access.
  IF (SELECT p.role FROM profiles p WHERE p.id = auth.uid()) <> 'admin' THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  RETURN QUERY
  WITH latest_push AS (
    -- The active batch per branch. Same ordering — including the id tiebreak
    -- — as get_active_staff_batch and vendor_orders(), so all three agree on
    -- which batch is live. See undelivered_batch_alert.sql for why pushed_at
    -- alone is a partial order.
    SELECT DISTINCT ON (dc.branch_id)
           dc.branch_id, kpl.cycle_id, kpl.push_date
    FROM kitchen_push_log kpl
    JOIN delivery_cycles dc ON dc.id = kpl.cycle_id
    ORDER BY dc.branch_id, kpl.pushed_at DESC, kpl.id DESC
  )
  SELECT o.id::BIGINT
  FROM orders o
  LEFT JOIN delivery_cycles odc ON odc.id = o.cycle_id
  LEFT JOIN latest_push lp ON lp.branch_id IS NOT DISTINCT FROM odc.branch_id
  WHERE o.status NOT IN ('Delivered', 'Cancelled', 'Failed')
    -- A subscription PURCHASE delivers nothing — it is a revenue row with no
    -- cycle. Without this it would age past its date and be reported forever
    -- as an undelivered order that never existed.
    AND o.cycle_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM order_items oi
      WHERE oi.order_id = o.id AND oi.item_type IN ('food', 'essential')
    )
    -- Never the batch currently on the boards: that work is in progress, not
    -- lost, and listing it here would put the same order in two places with
    -- two different meanings.
    AND NOT (lp.cycle_id = o.cycle_id AND lp.push_date = o.dispatch_date)
    AND (
      EXISTS (
        SELECT 1 FROM kitchen_push_log k
        WHERE k.cycle_id = o.cycle_id AND k.push_date = o.dispatch_date
      )
      OR o.dispatch_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
    )
  ORDER BY o.dispatch_date, o.id;
END;
$$;

REVOKE ALL   ON FUNCTION public.admin_undelivered_order_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_undelivered_order_ids() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Verify (impersonate an admin; NEVER check this as superuser) ──
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('request.jwt.claims',
--     json_build_object('sub', '<admin-user-id>')::text, true);
--   SELECT * FROM admin_undelivered_order_ids();
