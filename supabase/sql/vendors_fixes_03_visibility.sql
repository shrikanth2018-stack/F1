-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Vendor network fix 03: customers could never see vendor items
--
-- THE BUG. `essentials_vendor_scope` (vendors_visibility.sql) decides whether
-- a customer may see a vendor's item with an inline EXISTS over `vendors` and
-- `vendor_zones`:
--
--     OR EXISTS (SELECT 1 FROM vendors v JOIN vendor_zones vz ...
--                JOIN customer_addresses ca ON ca.user_id = auth.uid() ...)
--
-- A policy expression is evaluated as the CALLING user, so every table it
-- touches has its own RLS applied. And both of those tables deny SELECT to
-- ordinary customers by design:
--
--   vendors_owner_read   → owner_user_id = auth.uid() OR staff/admin
--   vendor_zones_read    → owner OR staff/admin
--
-- So for a customer the subquery reads ZERO rows, the branch is always false,
-- and the RESTRICTIVE policy denies the item. Verified against the live
-- database 2026-07-30: of nine profiles, the ONLY one who could see the
-- vendor's item was the vendor's own owner account (via the owner branch) —
-- every genuine customer in the granted zone saw nothing.
--
-- Net effect: no customer could see any vendor item, so the vendor network
-- could not make a single sale. It looked like a zone-mapping problem, which
-- is exactly how it stayed hidden.
--
-- THE FIX. Move the rule into a SECURITY DEFINER function so it evaluates
-- with the definer's rights instead of the customer's, and have the policy
-- call that. This is the same reason `vendor_ids_for_address` already exists
-- for the ORDER path — that one was written because the service-role builder
-- bypasses RLS; nobody noticed the browse path had the mirror-image problem.
--
-- The function returns only vendor IDs. It exposes no GST number, no
-- commission, no FSSAI — the reason `vendors` is locked down in the first
-- place is untouched.
--
-- BROWSE vs ORDER, still deliberately different: browsing matches ANY of the
-- customer's active addresses, ordering is re-checked server-side against the
-- one address the order is going to. Browse stays the looser of the two.
--
-- Deploy: paste into the Supabase SQL editor. Idempotent.
-- Requires: vendors_schema.sql + vendors_visibility.sql applied.
-- Rollback: restore the policy body from vendors_visibility.sql §2 — but note
--           that restores the bug.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. The rule, evaluated as definer ──────────────────────────
CREATE OR REPLACE FUNCTION public.vendor_ids_visible_to_me()
RETURNS TABLE (vendor_id BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT v.id
  FROM vendors v
  JOIN vendor_zones vz ON vz.vendor_id = v.id
  JOIN customer_addresses ca ON ca.user_id = auth.uid() AND ca.is_active
  WHERE v.status = 'approved'
    AND (
      (vz.zone_id IS NOT NULL AND vz.zone_id = ca.zone_id)
      OR (vz.hub_id IS NOT NULL AND vz.hub_id = ca.hub_id)
    );
$$;

COMMENT ON FUNCTION public.vendor_ids_visible_to_me() IS
  'Vendor IDs the current user may buy from, based on their active addresses. SECURITY DEFINER because the RLS policy that calls it runs as the customer, who cannot read vendors or vendor_zones. Returns IDs only — never vendor business details.';

REVOKE ALL   ON FUNCTION public.vendor_ids_visible_to_me() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendor_ids_visible_to_me() TO authenticated;

-- ── 2. Point the policy at it ──────────────────────────────────
-- Still RESTRICTIVE, so it ANDs with the permissive read-all policy that
-- rls_policies.sql recreates on every run.
DROP POLICY IF EXISTS essentials_vendor_scope ON public.essentials_catalog;
CREATE POLICY essentials_vendor_scope ON public.essentials_catalog
  AS RESTRICTIVE
  FOR SELECT
  USING (
    -- 1stOne's own items — every row that existed before the vendor network
    vendor_id IS NULL
    -- Catalogue management and reporting
    OR public.is_staff_or_admin()
    -- The vendor's own store screen. Reads `vendors`, which is allowed here
    -- precisely because the owner CAN read their own row.
    OR EXISTS (
      SELECT 1 FROM public.vendors v
      WHERE v.id = essentials_catalog.vendor_id
        AND v.owner_user_id = auth.uid()
    )
    -- The customer path — the branch that was broken.
    OR essentials_catalog.vendor_id IN (
      SELECT f.vendor_id FROM public.vendor_ids_visible_to_me() f
    )
  );

NOTIFY pgrst, 'reload schema';
