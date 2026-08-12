-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — the customer gets the same batch rule everyone else has
--
-- THE GAP. Every operational board already scopes itself to the batch
-- released by the latest kitchen push — Kitchen and Packing through
-- useStaffOrders, the driver through an explicit (cycle, date) filter, the hub
-- through the same staff hook, the vendor through vendor_orders(). When a push
-- replaces a batch, whatever it left open is reported to admin by
-- alert_undelivered_batch and listed by admin_undelivered_order_ids().
--
-- The CUSTOMER'S two surfaces were never wired to any of it. The Home rail
-- asked `status NOT IN (Delivered, Cancelled, Failed)` and nothing else, so an
-- order nobody ever marked Delivered sat there for ever, still worded
-- "Dispatched by : 7:30 AM" — while the same order sat on the admin
-- Undelivered tab as lost. One order, two screens, opposite meanings.
--
-- WHAT THIS FILE DOES. It does NOT write a second copy of the rule. The
-- predicate moves once into an internal function, and both audiences call it:
--
--   _undelivered_order_ids(user)   internal. The predicate, verbatim.
--   admin_undelivered_order_ids()  unchanged name, signature, role gate and
--                                  result — its body now delegates.
--   my_order_states()              NEW. The caller's own unfinished orders,
--                                  each tagged 'live' | 'undelivered'.
--
-- Same shape as _hub_commission_for_period + its two public wrappers. One
-- rule, one place; the admin list and the customer rail cannot drift apart,
-- because there is only one thing to change.
--
-- "UNDELIVERED" IS A LABEL, NOT A STATUS. Nothing here writes to
-- orders.status, and no new status value is introduced. Making it real would
-- have meant touching the status CHECK, orders_status_no_regress's flow array,
-- advance_orders_status, alert_undelivered_batch, push_kitchen_summary,
-- isOperationalOrder, nextPackingStatus, rolledUpStatus, both colour maps and
-- the vendor-credit trigger's guard — and something new would have to WRITE it
-- on the kitchen's critical path. Deriving it costs none of that, and the row
-- keeps the status it actually stalled at, which is what staff and admin need
-- in order to fix it. The customer simply reads the word.
--
-- BEHAVIOUR OF THE EXISTING ADMIN RPC IS UNCHANGED. The predicate below is a
-- verbatim move, including its one known edge: when a branch has no
-- kitchen_push_log row at all, `NOT (lp.cycle_id = ... AND lp.push_date = ...)`
-- evaluates to NULL and the order is excluded. That is today's behaviour and
-- this file deliberately does not alter it — extraction and correction should
-- never ride in together.
--
-- Deploy: paste into the Supabase SQL editor. Idempotent.
-- Dry-run inside BEGIN … ROLLBACK first; there is one database.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. The predicate, once ─────────────────────────────────────
--
-- p_user_id NULL  → every undelivered order (what the admin tab asks for)
-- p_user_id set   → that customer's only (what the rail and My Orders ask for)
--
-- The filter is applied INSIDE rather than by the caller so a customer's call
-- never materialises the whole set. `latest_push` stays global — it is the
-- live batch per branch, which is not a per-customer fact.
--
-- SECURITY DEFINER because it reads kitchen_push_log, which is super-admin
-- only under RLS. It is REVOKEd from every client role below; the two wrappers
-- reach it because a SECURITY DEFINER function executes as its owner.
CREATE OR REPLACE FUNCTION public._undelivered_order_ids(p_user_id UUID DEFAULT NULL)
RETURNS TABLE (order_id BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_push AS (
    -- The active batch per branch. Same ordering — including the id tiebreak —
    -- as get_active_staff_batch and vendor_orders(), so all three agree on
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
  WHERE (p_user_id IS NULL OR o.user_id = p_user_id)
    AND o.status NOT IN ('Delivered', 'Cancelled', 'Failed')
    -- A subscription PURCHASE delivers nothing — it is a revenue row with no
    -- cycle. Without this it would age past its date and be reported for ever
    -- as an undelivered order that never existed.
    AND o.cycle_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM order_items oi
      WHERE oi.order_id = o.id AND oi.item_type IN ('food', 'essential')
    )
    -- Never the batch currently on the boards: that work is in progress, not
    -- lost.
    AND NOT (lp.cycle_id = o.cycle_id AND lp.push_date = o.dispatch_date)
    AND (
      -- Released at some point and since replaced …
      EXISTS (
        SELECT 1 FROM kitchen_push_log k
        WHERE k.cycle_id = o.cycle_id AND k.push_date = o.dispatch_date
      )
      -- … or its date passed without ever being released, which is what a
      -- missed cron looks like.
      OR o.dispatch_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
    )
  ORDER BY o.dispatch_date, o.id;
$$;

REVOKE ALL ON FUNCTION public._undelivered_order_ids(UUID)
  FROM PUBLIC, anon, authenticated;


-- ── 2. The admin tab — same contract, delegated body ───────────
--
-- Name, argument list, result shape, role gate and returned rows are all
-- exactly as before. AdminOrdersScreen calls this and needs no change.
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

  RETURN QUERY SELECT * FROM public._undelivered_order_ids(NULL);
END;
$$;

REVOKE ALL   ON FUNCTION public.admin_undelivered_order_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_undelivered_order_ids() TO authenticated;


-- ── 3. What the customer's own screens ask ─────────────────────
--
-- One call answers both surfaces, so they cannot disagree with each other
-- either: the Home rail keeps 'live', My Orders labels 'undelivered'.
--
--   live              on its way — the batch is still current, or has not been
--                     released yet
--   undelivered       released and the batch has since been replaced, or its
--                     date has passed; nobody delivered it
--   awaiting_payment  status 'Pending' — a card checkout that was started and
--                     never completed. Named rather than omitted so the app
--                     can tell "not tracked" from "not known".
--
-- Terminal orders are absent: their own status already says everything
-- (Delivered / Cancelled / Failed), and My Orders renders that directly.
-- Subscription PURCHASE rows are absent too, having no cycle — they deliver
-- nothing, so neither state means anything for them.
--
-- SECURITY DEFINER for the kitchen_push_log read, and scoped twice: the WHERE
-- below filters on auth.uid(), and auth.uid() is also what is passed into the
-- internal function. auth.uid() reads the request's JWT claims, which
-- SECURITY DEFINER does not change — it swaps the ROLE, not the claims.
CREATE OR REPLACE FUNCTION public.my_order_states()
RETURNS TABLE (order_id BIGINT, state TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id::BIGINT,
         CASE
           WHEN u.order_id IS NOT NULL THEN 'undelivered'
           WHEN o.status = ANY (ARRAY['Confirmed', 'Preparing', 'Ready', 'Packed',
                                      'Dispatched', 'Received at Hub', 'On the Way'])
             THEN 'live'
           ELSE 'awaiting_payment'
         END
  FROM orders o
  LEFT JOIN public._undelivered_order_ids(auth.uid()) u ON u.order_id = o.id
  WHERE o.user_id = auth.uid()
    AND o.status NOT IN ('Delivered', 'Cancelled', 'Failed')
    AND o.cycle_id IS NOT NULL;
$$;

REVOKE ALL   ON FUNCTION public.my_order_states() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_order_states() TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ── Verify ─────────────────────────────────────────────────────
-- The admin tab must return exactly what it did before this file:
--   SELECT * FROM public._undelivered_order_ids(NULL);
--
-- As a real customer — NEVER as superuser, which bypasses RLS and will happily
-- confirm a function that returns nothing for everyone:
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('request.jwt.claims',
--     json_build_object('sub', '<customer-uuid>', 'role', 'authenticated',
--                       'user_role', 'customer')::text, true);
--   SELECT * FROM public.my_order_states();
--   RESET ROLE;
--
-- ── Rollback ───────────────────────────────────────────────────
-- Restores the pre-split admin function and drops the two new ones. Safe only
-- once the app no longer calls my_order_states().
--
--   DROP FUNCTION IF EXISTS public.my_order_states();
--   -- then re-apply supabase/sql/admin_undelivered_orders.sql, which carries
--   -- the original self-contained body
--   DROP FUNCTION IF EXISTS public._undelivered_order_ids(UUID);
