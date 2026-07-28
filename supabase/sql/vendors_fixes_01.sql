-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Vendor network fixes, round 1 (2026-07-28)
--
-- Found by device testing, all four invisible to tsc and Jest.
--
--   1. RETURN TYPE MISMATCH. orders.id, orders.cycle_id, order_items.id /
--      .item_id / .order_id and essentials_catalog.id are all INTEGER, not
--      bigint — only vendors.id is bigint. Three functions declared BIGINT
--      columns and threw "structure of query does not match function result
--      type" at runtime. Fixed with explicit casts rather than by narrowing
--      the declarations, so these keep working if a column is ever widened.
--
--   2. THE STATE MACHINE HAD NO TRANSITION. A vendor completing registration
--      updated their details but `status` stayed 'invited' forever, so they
--      never appeared in the admin's "To verify" tab. status is correctly
--      not grantable to `authenticated` — which means the move can only
--      happen in a SECURITY DEFINER function, and there wasn't one. This
--      adds it, and refuses a second submission.
--
-- Deploy: paste into the Supabase SQL editor. Idempotent.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. vendor_orders — cast to the declared widths ─────────────
CREATE OR REPLACE FUNCTION public.vendor_orders()
RETURNS TABLE (
  order_id       BIGINT,
  dispatch_date  DATE,
  cycle_name     TEXT,
  status         TEXT,
  items          JSONB,
  ready_at       TIMESTAMPTZ,
  customer_name  TEXT,
  customer_phone TEXT
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
BEGIN
  SELECT id, supply_mode INTO v_vendor_id, v_supply_mode
  FROM vendors WHERE owner_user_id = auth.uid();
  IF v_vendor_id IS NULL THEN
    RAISE EXCEPTION 'Not a vendor';
  END IF;

  -- Only a vendor whose goods already sit at the hub plausibly hands them
  -- over, so only they get customer detail. Everyone else never receives
  -- these fields at all, rather than receiving and hiding them.
  v_show_customer := (v_supply_mode = 'at_hub');

  RETURN QUERY
  SELECT o.id::BIGINT,
         o.dispatch_date,
         dc.cycle_name::TEXT,
         o.status::TEXT,
         jsonb_agg(jsonb_build_object(
           'item_name', oi.item_name,
           'quantity',  oi.quantity
         ) ORDER BY oi.item_name),
         f.ready_at,
         (CASE WHEN v_show_customer THEN ca.full_name ELSE NULL END)::TEXT,
         (CASE WHEN v_show_customer THEN ca.phone_number ELSE NULL END)::TEXT
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
    AND o.status NOT IN ('Pending', 'Cancelled', 'Failed')
  GROUP BY o.id, o.dispatch_date, dc.cycle_name, o.status, f.ready_at,
           ca.full_name, ca.phone_number
  ORDER BY o.dispatch_date, o.id;
END;
$$;

-- ── 2. vendor_supply_list — same cast fix ──────────────────────
CREATE OR REPLACE FUNCTION public.vendor_supply_list()
RETURNS TABLE (
  dispatch_date DATE,
  cycle_id      BIGINT,
  cycle_name    TEXT,
  item_id       BIGINT,
  item_name     TEXT,
  total_qty     BIGINT,
  order_count   BIGINT
)
LANGUAGE plpgsql
STABLE
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

  RETURN QUERY
  SELECT o.dispatch_date,
         o.cycle_id::BIGINT,
         dc.cycle_name::TEXT,
         oi.item_id::BIGINT,
         oi.item_name::TEXT,
         SUM(oi.quantity)::BIGINT,
         COUNT(DISTINCT o.id)::BIGINT
  FROM orders o
  JOIN order_items oi        ON oi.order_id = o.id
  JOIN essentials_catalog ec ON ec.id = oi.item_id
  LEFT JOIN delivery_cycles dc ON dc.id = o.cycle_id
  WHERE ec.vendor_id = v_vendor_id
    AND oi.item_type = 'essential'
    AND o.dispatch_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
    AND o.status NOT IN ('Pending', 'Cancelled', 'Failed')
  GROUP BY o.dispatch_date, o.cycle_id, dc.cycle_name, oi.item_id, oi.item_name
  ORDER BY o.dispatch_date, dc.cycle_name NULLS LAST, oi.item_name;
END;
$$;

-- ── 3. vendor_used_quantities — same cast fix ──────────────────
-- This one matters most: it is the DAILY CAP check. A runtime failure here
-- would have surfaced as "could not price your cart" at checkout.
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
  SELECT oi.item_id::BIGINT, COALESCE(SUM(oi.quantity), 0)::BIGINT
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE oi.item_id = ANY(p_item_ids)
    AND oi.item_type = 'essential'
    AND o.dispatch_date = p_dispatch_date
    AND o.status NOT IN ('Cancelled', 'Failed')
  GROUP BY oi.item_id;
$$;

-- ── 4. The missing transition: invited → submitted ─────────────
-- A vendor may write their own business details (column grants allow those
-- seven), but NOT status — deliberately, so nobody approves themselves.
-- Which means the move to 'submitted' can only happen here.
--
-- Refuses a second submission: once it is with you for verification the
-- vendor should not be able to keep re-sending it.
CREATE OR REPLACE FUNCTION public.vendor_submit_registration(
  p_business_name TEXT,
  p_contact_phone TEXT DEFAULT NULL,
  p_gst_number    TEXT DEFAULT NULL,
  p_fssai_number  TEXT DEFAULT NULL,
  p_return_policy TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id     BIGINT;
  v_status TEXT;
BEGIN
  SELECT id, status INTO v_id, v_status
  FROM vendors WHERE owner_user_id = auth.uid() FOR UPDATE;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'You are not registered as a vendor.';
  END IF;
  IF v_status <> 'invited' THEN
    RAISE EXCEPTION 'Your details have already been sent for verification.';
  END IF;
  IF COALESCE(btrim(p_business_name), '') = '' THEN
    RAISE EXCEPTION 'Business name is required.';
  END IF;

  UPDATE vendors
  SET business_name     = btrim(p_business_name),
      contact_phone     = NULLIF(btrim(COALESCE(p_contact_phone, '')), ''),
      gst_number        = NULLIF(btrim(COALESCE(p_gst_number, '')), ''),
      fssai_number      = NULLIF(btrim(COALESCE(p_fssai_number, '')), ''),
      return_policy     = NULLIF(btrim(COALESCE(p_return_policy, '')), ''),
      terms_accepted_at = now(),
      submitted_at      = now(),
      status            = 'submitted',
      updated_at        = now()
  WHERE id = v_id;

  RETURN jsonb_build_object('vendor_id', v_id, 'status', 'submitted');
END;
$$;

REVOKE ALL ON FUNCTION public.vendor_submit_registration(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendor_submit_registration(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
