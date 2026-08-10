-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — vendor_orders(): batch-scoped, with Upcoming and History
--
-- WHY. Every operational board in the app shows exactly ONE batch — the
-- cycle released by the most recent kitchen push — and a row leaves that
-- board when it is Delivered or when the next push replaces it. Kitchen,
-- Packing, Driver and Hub all follow that rule. The vendor never did:
-- this function returned everything from today forward, so
--
--   • today's work sat mixed in with Thursday's, with nothing marking which
--     the vendor is supposed to be acting on right now;
--   • a Delivered row never left the list, because 'Delivered' was not in
--     the excluded set — the live list only ever grew;
--   • an order that passed its date unfinished vanished at midnight into
--     nothing at all. `dispatch_date >= today` was the only date filter and
--     there was no history, so the vendor had no way to see an order they
--     had sourced stock for and never got paid on.
--
-- WHAT CHANGES. One new OUT column, `bucket`, and a widened date range. The
-- client renders three sections from the one call:
--
--   'now'      in the active batch and not finished → the live list, the
--              only rows carrying a Mark-ready action
--   'upcoming' released to nobody yet — no kitchen push exists for that
--              cycle+date. This is the vendor's lead time, and the reason
--              they are not put on a strict batch-only board like the
--              driver: they have to buy stock before the cutoff.
--   'history'  finished (Delivered / Cancelled / Failed), OR its batch has
--              already been superseded by a later push. An unfinished row
--              landing here is the same row admin is chasing in
--              Orders → Undelivered.
--
-- THE BUCKET IS DERIVED FROM kitchen_push_log, NOT FROM THE CLOCK. "Has this
-- cycle+date been released?" is a fact already recorded, and reusing it means
-- the vendor's idea of 'now' cannot drift from what the kitchen, the packers
-- and the driver are looking at. A time-of-day calculation here would be a
-- second implementation of the same rule, free to disagree.
--
-- 'Pending' stays excluded in every bucket: the customer has not paid, so it
-- is not a sale, and a vendor must never be asked to source against it.
-- Cancelled and Failed now appear — but only in history, because a vendor who
-- bought stock for an order deserves to see what became of it.
--
-- Deploy: paste into the Supabase SQL editor. Idempotent.
-- After deploying: npm run supabase:gen-types
-- ═══════════════════════════════════════════════════════════════

-- Adding an OUT column changes the row type, which CREATE OR REPLACE cannot
-- do — drop first. That discards the grants, hence the REVOKE/GRANT at the
-- foot of this file.
DROP FUNCTION IF EXISTS public.vendor_orders();

CREATE OR REPLACE FUNCTION public.vendor_orders()
RETURNS TABLE (
  order_id          BIGINT,
  dispatch_date     DATE,
  cycle_name        TEXT,
  status            TEXT,
  items             JSONB,
  ready_at          TIMESTAMPTZ,
  customer_name     TEXT,
  customer_phone    TEXT,
  cancellable_until TIMESTAMPTZ,
  bucket            TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vendor_id     BIGINT;
  v_supply_mode   TEXT;
  v_show_customer BOOLEAN;
  v_window        INTERVAL;
  -- How far back history reaches. Bounded so a long-running vendor does not
  -- pull years of rows onto a phone; vendor_earnings is the money record.
  v_history_days  CONSTANT INTEGER := 60;
BEGIN
  SELECT id, supply_mode INTO v_vendor_id, v_supply_mode
  FROM vendors WHERE owner_user_id = auth.uid();
  IF v_vendor_id IS NULL THEN
    RAISE EXCEPTION 'Not a vendor';
  END IF;

  -- Only a vendor whose goods already sit at the hub plausibly hands them
  -- over, so only they get customer detail.
  v_show_customer := (v_supply_mode = 'at_hub');

  SELECT make_interval(mins => (COALESCE(cancellation_window_hours, 0) * 60)::int)
    INTO v_window
  FROM store_config LIMIT 1;

  RETURN QUERY
  WITH
  -- The active batch per branch — the same row get_active_staff_batch hands
  -- the staff screens, computed for every branch at once. NULL branch_id is
  -- its own group, which is what DISTINCT ON does with nulls and what a
  -- single-branch install actually has.
  --
  -- The id tiebreak matches get_active_staff_batch exactly, and has to: if
  -- the two ordered differently the vendor's "now" could be a different batch
  -- from the one the kitchen is looking at. pushed_at alone is a partial
  -- order because now() is frozen for a transaction, so two pushes made in
  -- one carry the same instant.
  latest_push AS (
    SELECT DISTINCT ON (dc.branch_id)
           dc.branch_id,
           kpl.cycle_id,
           kpl.push_date
    FROM kitchen_push_log kpl
    JOIN delivery_cycles dc ON dc.id = kpl.cycle_id
    ORDER BY dc.branch_id, kpl.pushed_at DESC, kpl.id DESC
  )
  SELECT o.id::BIGINT,
         o.dispatch_date,
         -- The ESSENTIALS label, not the food one: a vendor sells essentials,
         -- and the customer buying from them sees "Morning", not "Breakfast".
         COALESCE(NULLIF(btrim(dc.essentials_label), ''), dc.cycle_name)::TEXT,
         o.status::TEXT,
         jsonb_agg(jsonb_build_object(
           'item_name', oi.item_name,
           'quantity',  oi.quantity
         ) ORDER BY oi.item_name),
         f.ready_at,
         (CASE WHEN v_show_customer THEN ca.full_name ELSE NULL END)::TEXT,
         (CASE WHEN v_show_customer THEN ca.phone_number ELSE NULL END)::TEXT,
         -- Past 'Preparing' the order is out of cancel-order's reach entirely,
         -- so there is no deadline left to report. The previous version also
         -- listed 'Pending' and 'Paid' here: Pending never reaches this
         -- function (filtered below) and 'Paid' was dropped from the orders
         -- status constraint in May 2026, so both were unreachable.
         (CASE
            WHEN o.status NOT IN ('Confirmed', 'Preparing') THEN NULL
            ELSE LEAST(grp.first_created + v_window, grp.first_cutoff)
          END),
         (CASE
            -- Finished is finished, whatever batch it belonged to.
            WHEN o.status IN ('Delivered', 'Cancelled', 'Failed') THEN 'history'
            -- In the batch currently on every other board.
            WHEN lp.cycle_id = o.cycle_id AND lp.push_date = o.dispatch_date THEN 'now'
            -- Its cycle+date was pushed at some point, and the batch has since
            -- moved on — so it left the live boards unfinished.
            WHEN EXISTS (
              SELECT 1 FROM kitchen_push_log k
              WHERE k.cycle_id = o.cycle_id AND k.push_date = o.dispatch_date
            ) THEN 'history'
            -- Never released yet: the vendor's lead time.
            ELSE 'upcoming'
          END)::TEXT
  FROM orders o
  JOIN order_items oi        ON oi.order_id = o.id
  JOIN essentials_catalog ec ON ec.id = oi.item_id
  LEFT JOIN delivery_cycles dc    ON dc.id = o.cycle_id
  LEFT JOIN customer_addresses ca ON ca.id = o.delivery_address_id
  LEFT JOIN vendor_order_fulfilment f
         ON f.order_id = o.id AND f.vendor_id = v_vendor_id
  -- The order's branch decides which batch is "active" for it.
  LEFT JOIN latest_push lp ON lp.branch_id IS NOT DISTINCT FROM dc.branch_id
  -- The deadline belongs to the whole order group, not this one row.
  LEFT JOIN LATERAL (
    SELECT MIN(g.created_at) AS first_created,
           MIN(((g.dispatch_date
                  - (CASE WHEN gc.cutoff_time > gc.delivery_start THEN 1 ELSE 0 END))::timestamp
                + gc.cutoff_time) AT TIME ZONE 'Asia/Kolkata') AS first_cutoff
    FROM orders g
    LEFT JOIN delivery_cycles gc ON gc.id = g.cycle_id
    WHERE g.order_group_id = o.order_group_id
  ) grp ON TRUE
  WHERE ec.vendor_id = v_vendor_id
    AND oi.item_type = 'essential'
    -- Widened from `>= today`: history needs the days behind us. Bounded so
    -- the list cannot grow without limit.
    AND o.dispatch_date >= ((now() AT TIME ZONE 'Asia/Kolkata')::date - v_history_days)
    -- Unpaid is not a sale. Excluded from every bucket, as before.
    AND o.status <> 'Pending'
  GROUP BY o.id, o.dispatch_date, dc.essentials_label, dc.cycle_name, dc.branch_id,
           o.status, o.cycle_id, f.ready_at, ca.full_name, ca.phone_number,
           grp.first_created, grp.first_cutoff, lp.cycle_id, lp.push_date
  ORDER BY o.dispatch_date, o.id;
END;
$$;

REVOKE ALL   ON FUNCTION public.vendor_orders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendor_orders() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Verify (impersonate a vendor; NEVER check this as superuser) ──
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('request.jwt.claims',
--     json_build_object('sub', '<vendor-owner-user-id>')::text, true);
--   SELECT bucket, count(*), min(dispatch_date), max(dispatch_date)
--     FROM vendor_orders() GROUP BY bucket;
