-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Vendor network, part 6: daily caps + vendor fulfilment
--
--   1. Daily caps become REAL. A vendor sets "20 litres a day"; until now
--      that was stored and displayed but nothing stopped the 21st being
--      sold. Enforced server-side in buildAuthoritativeOrder, because a cap
--      checked only in the app is not a cap.
--
--   2. A vendor can mark an order READY. Order.status is order-level and a
--      single order can mix 1stOne's items with a vendor's, so a vendor
--      must not be advancing it — that would tell the packing team the
--      whole order was done. This is separate per-vendor state instead,
--      leaving order.status entirely alone.
--
-- Deploy: paste into the Supabase SQL editor. Idempotent.
-- Requires: vendors_schema.sql applied.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. How much of a capped item is already committed ──────────
-- Counts live orders on that dispatch date. Pending is included on purpose:
-- an order mid-payment has reserved that stock, and releasing it to someone
-- else would oversell the vendor. Cancelled and Failed release it again.
CREATE OR REPLACE FUNCTION public.vendor_used_quantities(
  p_item_ids      BIGINT[],
  p_dispatch_date DATE
)
RETURNS TABLE (item_id BIGINT, used_qty BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT oi.item_id, COALESCE(SUM(oi.quantity), 0)::BIGINT
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE oi.item_id = ANY(p_item_ids)
    AND oi.item_type = 'essential'
    AND o.dispatch_date = p_dispatch_date
    AND o.status NOT IN ('Cancelled', 'Failed')
  GROUP BY oi.item_id;
$$;

REVOKE ALL ON FUNCTION public.vendor_used_quantities(BIGINT[], DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendor_used_quantities(BIGINT[], DATE) TO authenticated, service_role;

-- ── 2. Vendor-side fulfilment state ────────────────────────────
-- Deliberately NOT a change to orders.status. One order can carry both your
-- items and a vendor's; if the vendor advanced the order, packing would be
-- told the whole thing was ready when only half of it was.
CREATE TABLE IF NOT EXISTS public.vendor_order_fulfilment (
  id         BIGSERIAL PRIMARY KEY,
  vendor_id  BIGINT NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  order_id   BIGINT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  ready_at   TIMESTAMPTZ,
  ready_by   UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_vendor_order_fulfilment
  ON public.vendor_order_fulfilment (vendor_id, order_id);

ALTER TABLE public.vendor_order_fulfilment ENABLE ROW LEVEL SECURITY;

-- The vendor sees and sets their own; staff and admin can see all of it so
-- packing knows whether a vendor's part has actually turned up.
DROP POLICY IF EXISTS vof_vendor_rw ON public.vendor_order_fulfilment;
CREATE POLICY vof_vendor_rw ON public.vendor_order_fulfilment
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.vendors v
            WHERE v.id = vendor_id AND v.owner_user_id = auth.uid())
    OR public.is_staff_or_admin()
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.vendors v
            WHERE v.id = vendor_id AND v.owner_user_id = auth.uid())
  );

-- ── 3. The vendor's orders, shaped ─────────────────────────────
-- A vendor is not staff, so `orders_self` gives them no read on orders at
-- all. Rather than widen that, this returns exactly what they need to
-- fulfil: order id, date, cycle, their own lines, and whether they have
-- marked it ready. What they see of the CUSTOMER depends on how they
-- supply — a vendor who drops goods to us has no business knowing who
-- ordered; one who is also the delivering hub operator already does.
CREATE OR REPLACE FUNCTION public.vendor_orders()
RETURNS TABLE (
  order_id      BIGINT,
  dispatch_date DATE,
  cycle_name    TEXT,
  status        TEXT,
  items         JSONB,
  ready_at      TIMESTAMPTZ,
  customer_name TEXT,
  customer_phone TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vendor_id   BIGINT;
  v_supply_mode TEXT;
  v_show_customer BOOLEAN;
BEGIN
  SELECT id, supply_mode INTO v_vendor_id, v_supply_mode
  FROM vendors WHERE owner_user_id = auth.uid();
  IF v_vendor_id IS NULL THEN
    RAISE EXCEPTION 'Not a vendor';
  END IF;

  -- Only a vendor whose goods are already at the hub is plausibly the one
  -- handing them over, so only they get customer detail.
  v_show_customer := (v_supply_mode = 'at_hub');

  RETURN QUERY
  SELECT o.id,
         o.dispatch_date,
         dc.cycle_name,
         o.status,
         jsonb_agg(jsonb_build_object(
           'item_name', oi.item_name,
           'quantity',  oi.quantity
         ) ORDER BY oi.item_name) AS items,
         f.ready_at,
         CASE WHEN v_show_customer THEN ca.full_name ELSE NULL END,
         CASE WHEN v_show_customer THEN ca.phone_number ELSE NULL END
  FROM orders o
  JOIN order_items oi        ON oi.order_id = o.id
  JOIN essentials_catalog ec ON ec.id = oi.item_id
  LEFT JOIN delivery_cycles dc ON dc.id = o.cycle_id
  LEFT JOIN customer_addresses ca ON ca.id = o.delivery_address_id
  LEFT JOIN vendor_order_fulfilment f
         ON f.order_id = o.id AND f.vendor_id = v_vendor_id
  WHERE ec.vendor_id = v_vendor_id
    AND oi.item_type = 'essential'
    AND o.dispatch_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
    -- Paid and live only: a vendor is never asked to source for a sale that
    -- has not happened.
    AND o.status NOT IN ('Pending', 'Cancelled', 'Failed')
  GROUP BY o.id, o.dispatch_date, dc.cycle_name, o.status, f.ready_at,
           ca.full_name, ca.phone_number
  ORDER BY o.dispatch_date, o.id;
END;
$$;

-- ── 4. Mark one order ready ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vendor_mark_order_ready(
  p_order_id BIGINT,
  p_ready    BOOLEAN DEFAULT TRUE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vendor_id BIGINT;
BEGIN
  SELECT id INTO v_vendor_id FROM vendors WHERE owner_user_id = auth.uid();
  IF v_vendor_id IS NULL THEN
    RAISE EXCEPTION 'Not a vendor';
  END IF;

  -- Only for an order that actually contains this vendor's goods.
  IF NOT EXISTS (
    SELECT 1 FROM order_items oi
    JOIN essentials_catalog ec ON ec.id = oi.item_id
    WHERE oi.order_id = p_order_id AND ec.vendor_id = v_vendor_id
  ) THEN
    RAISE EXCEPTION 'That order does not contain your items';
  END IF;

  INSERT INTO vendor_order_fulfilment (vendor_id, order_id, ready_at, ready_by)
  VALUES (v_vendor_id, p_order_id,
          CASE WHEN p_ready THEN now() ELSE NULL END,
          CASE WHEN p_ready THEN auth.uid() ELSE NULL END)
  ON CONFLICT (vendor_id, order_id) DO UPDATE
    SET ready_at = CASE WHEN p_ready THEN now() ELSE NULL END,
        ready_by = CASE WHEN p_ready THEN auth.uid() ELSE NULL END;
END;
$$;

REVOKE ALL ON FUNCTION public.vendor_orders() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vendor_mark_order_ready(BIGINT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendor_orders() TO authenticated;
GRANT EXECUTE ON FUNCTION public.vendor_mark_order_ready(BIGINT, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';
