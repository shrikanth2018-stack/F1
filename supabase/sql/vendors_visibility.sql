-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Vendor network, part 4: who can see a vendor's items
--
-- A vendor sells only into the zones/hubs an admin has granted them. This
-- enforces that in RLS rather than in a query, so it holds for every read
-- path — the customer catalogue, the cart, a report, and anything written
-- later that nobody thought to filter.
--
-- RESTRICTIVE, not permissive, and that distinction is the whole point:
-- restrictive policies AND with the existing ones. essentials_catalog
-- already carries `essentials_catalog_read_all USING (true)` created by a
-- DO loop in rls_policies.sql; replacing it would be undone the next time
-- that file is re-run. Adding a restrictive policy alongside survives it.
--
-- Everyone keeps seeing 1stOne's own items (vendor_id IS NULL), which is
-- every row that exists today — so this file changes nothing until the
-- first vendor item is created.
--
-- Deploy: paste into the Supabase SQL editor. Idempotent.
-- Requires: vendors_schema.sql applied first.
-- Rollback: DROP POLICY essentials_vendor_scope ON public.essentials_catalog;
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Vendor identity, safely readable ────────────────────────
-- "Sold by X" needs the trading name, but `vendors` also holds GST, FSSAI
-- and the commission you negotiated — none of which belongs to a customer.
-- RLS is row-level, so a read policy on the table would expose the whole
-- row. A view exposing two columns is the honest way to publish a name.
CREATE OR REPLACE VIEW public.vendor_public AS
  SELECT v.id, v.business_name
  FROM public.vendors v
  WHERE v.status = 'approved';

GRANT SELECT ON public.vendor_public TO authenticated, anon;

COMMENT ON VIEW public.vendor_public IS
  'Trading name only, approved vendors only. Exists so the storefront can show "Sold by X" without exposing GST, FSSAI or commission from the vendors table.';

-- ── 2. The visibility rule ─────────────────────────────────────
-- A vendor item is visible when ANY of:
--   * it is not a vendor item at all (1stOne's own — every current row)
--   * the reader is staff/admin (catalogue management, reports)
--   * the reader is the vendor who owns it (their own store screen)
--   * the reader has an active address inside a zone/hub that vendor has
--     been granted, AND that vendor is approved
--
-- Browsing uses ALL of the customer's active addresses; a specific ORDER is
-- then checked against the one address it is actually going to, server-side
-- in buildAuthoritativeOrder. Browse is deliberately the looser of the two.
DROP POLICY IF EXISTS essentials_vendor_scope ON public.essentials_catalog;
CREATE POLICY essentials_vendor_scope ON public.essentials_catalog
  AS RESTRICTIVE
  FOR SELECT
  USING (
    vendor_id IS NULL
    OR public.is_staff_or_admin()
    OR EXISTS (
      SELECT 1 FROM public.vendors v
      WHERE v.id = essentials_catalog.vendor_id
        AND v.owner_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.vendors v
      JOIN public.vendor_zones vz ON vz.vendor_id = v.id
      JOIN public.customer_addresses ca
        ON ca.user_id = auth.uid()
       AND ca.is_active
      WHERE v.id = essentials_catalog.vendor_id
        AND v.status = 'approved'
        AND (
          (vz.zone_id IS NOT NULL AND vz.zone_id = ca.zone_id)
          OR (vz.hub_id IS NOT NULL AND vz.hub_id = ca.hub_id)
        )
    )
  );

-- Supports the EXISTS above; vendor_zones is small but this keeps the
-- policy cheap as vendors multiply.
CREATE INDEX IF NOT EXISTS idx_vendor_zones_zone_lookup
  ON public.vendor_zones (zone_id) WHERE zone_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_zones_hub_lookup
  ON public.vendor_zones (hub_id) WHERE hub_id IS NOT NULL;

-- ── 3. Eligibility, callable from the order path ───────────────
-- buildAuthoritativeOrder runs with the service-role key, which bypasses
-- RLS entirely — so the policy above protects BROWSING but not ORDERING.
-- The order path calls this for the one address the order is going to.
--
-- Set-returning rather than per-item on purpose: the builder already makes
-- eight to ten sequential round-trips (health report #22) and a per-item
-- check would add one more per line. This is a single call whose result the
-- builder filters against, and it keeps the rule in ONE place.
DROP FUNCTION IF EXISTS public.vendor_item_allowed_for_address(BIGINT, BIGINT);

CREATE OR REPLACE FUNCTION public.vendor_ids_for_address(p_address_id BIGINT)
RETURNS TABLE (vendor_id BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT v.id
  FROM vendors v
  JOIN vendor_zones vz ON vz.vendor_id = v.id
  JOIN customer_addresses ca ON ca.id = p_address_id
  WHERE v.status = 'approved'
    AND (
      (vz.zone_id IS NOT NULL AND vz.zone_id = ca.zone_id)
      OR (vz.hub_id IS NOT NULL AND vz.hub_id = ca.hub_id)
    );
$$;

REVOKE ALL ON FUNCTION public.vendor_ids_for_address(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendor_ids_for_address(BIGINT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
