-- ─────────────────────────────────────────────────────────────
-- BF-14: supply_catalog SELECT policy for staff
--
-- Symptom (2026-05-04): in staff login, the stock-order autocomplete
-- (StaffDashboard.tsx → OrderFormModal) returned no items when typing
-- a first letter for Vegetables / Grocery / Stationery, even though
-- the same autocomplete worked in admin Stock Manager. Code on both
-- sides was functionally identical; both queried supply_catalog with
-- the same shape and category strings.
--
-- Root cause: supply_catalog had only one RLS policy
-- (`supply_catalog_admin`) which gated ALL operations behind
-- `is_admin()`. Staff JWTs were silently filtered out → empty result
-- set → autocomplete had nothing to match against.
--
-- Fix: add a SELECT-only permissive policy for staff (and admin,
-- already covered by the existing ALL policy). Customers don't see
-- this table — `is_staff_or_admin()` is the right scope.
--
-- Idempotent (DROP IF EXISTS + CREATE) + NOTIFY for PostgREST
-- schema-cache reload. Safe to re-run.
--
-- Run in Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────

-- 1. Add the SELECT policy ─────────────────────────────────────

DROP POLICY IF EXISTS supply_catalog_staff_read ON public.supply_catalog;

CREATE POLICY supply_catalog_staff_read ON public.supply_catalog
  FOR SELECT USING (public.is_staff_or_admin());

-- 2. Force PostgREST schema-cache reload ──────────────────────

NOTIFY pgrst, 'reload schema';
