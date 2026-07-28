-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Vendor network fixes, round 2 (2026-07-28)
--
-- WHEN IS A VENDOR ORDER SAFE TO SOURCE AGAINST?
--
-- A vendor sees orders LIVE, the moment they are paid, rather than waiting
-- for the kitchen push. That is deliberate and different from the staff
-- board: the kitchen already has everything in the building and commits at
-- push time, whereas a vendor has to PROCURE. Lunch pushes at 11:10 for a
-- 12:30 run — nobody sources goods in eighty minutes.
--
-- But a live list is provisional. Until the cancellation window closes the
-- customer can still cancel, and a vendor who already bought stock against
-- that order is out of pocket. So each row now carries the moment it stops
-- being cancellable.
--
-- The rule is NOT new — cancel-order already enforces exactly this, and this
-- only exposes the moment it computes:
--
--     cancellable_until = LEAST(
--       group's earliest created_at + store_config.cancellation_window_hours,
--       group's earliest cycle cutoff for its dispatch date
--     )
--
-- Two details that must match cancel-order or the vendor is told a lie:
--
--   • GROUP, not row. Cancellation is group-scoped (`order_group_id`), so a
--     sibling line in an earlier cycle drags the whole group's deadline
--     forward. Computed over the group, exactly as cancel-order does.
--
--   • CROSS-MIDNIGHT. When cutoff_time > delivery_start (Breakfast closes
--     22:30 for a 07:30 run) the cutoff belongs to the day BEFORE the
--     dispatch date — the same test used in cancel-order and the cutoff cron.
--
-- NULL means already firm: either the status has moved past cancellable, or
-- the deadline is behind us.
--
-- Also switches `cycle_name` to the ESSENTIALS label — a vendor sells
-- essentials, so they must read "Morning", matching what their customer sees
-- on the Essentials menu, not the kitchen's "Breakfast".
--
-- Deploy: paste into the Supabase SQL editor. Idempotent.
-- ═══════════════════════════════════════════════════════════════

-- Adding an OUT column changes the row type, which CREATE OR REPLACE cannot
-- do — so drop first. That discards the grants with it, hence the REVOKE and
-- GRANT at the foot of this file rather than relying on the original.
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
  cancellable_until TIMESTAMPTZ
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
  SELECT o.id::BIGINT,
         o.dispatch_date,
         -- The ESSENTIALS label, not the food one: a vendor sells essentials,
         -- and the customer buying from them sees "Morning", not "Breakfast".
         -- Same COALESCE as src/utils/cycleLabels.ts, since a cycle may have
         -- no essentials_label set (Snacks currently does not).
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
         -- so there is no deadline left to report. The client compares the
         -- timestamp with now(); we do not, so the answer does not depend on
         -- when the query happened to run.
         (CASE
            WHEN o.status NOT IN ('Pending', 'Confirmed', 'Paid', 'Preparing') THEN NULL
            ELSE LEAST(grp.first_created + v_window, grp.first_cutoff)
          END)
  FROM orders o
  JOIN order_items oi        ON oi.order_id = o.id
  JOIN essentials_catalog ec ON ec.id = oi.item_id
  LEFT JOIN delivery_cycles dc    ON dc.id = o.cycle_id
  LEFT JOIN customer_addresses ca ON ca.id = o.delivery_address_id
  LEFT JOIN vendor_order_fulfilment f
         ON f.order_id = o.id AND f.vendor_id = v_vendor_id
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
    AND o.dispatch_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
    AND o.status NOT IN ('Pending', 'Cancelled', 'Failed')
  GROUP BY o.id, o.dispatch_date, dc.essentials_label, dc.cycle_name, o.status, f.ready_at,
           ca.full_name, ca.phone_number, grp.first_created, grp.first_cutoff
  ORDER BY o.dispatch_date, o.id;
END;
$$;

REVOKE ALL   ON FUNCTION public.vendor_orders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendor_orders() TO authenticated;

NOTIFY pgrst, 'reload schema';
