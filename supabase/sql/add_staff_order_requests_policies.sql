-- ─────────────────────────────────────────────────────────────
-- BF-15: staff_order_requests INSERT + SELECT policies for staff
--
-- Symptom (2026-05-04): after BF-14 fixed the supply_catalog read
-- gate, staff could see catalog items in the Vegetables / Grocery /
-- Stationery autocomplete and build a line-item list, but the Submit
-- step failed with "new row violates row-level security policy for
-- table 'staff_order_requests'". Same root cause class as BF-14 but
-- different table: staff was blocked from INSERTing their own request
-- rows.
--
-- Fix: add two scoped policies.
--   - INSERT: staff can submit only request rows where they are the
--     submitter (submitted_by = auth.uid()). Customers blocked.
--   - SELECT: staff can read only their own requests. Admin sees all
--     (admin's existing ALL-permissive policy already covers this; the
--     SELECT policy here is OR'd permissively with that one).
--
-- No UPDATE or DELETE for staff — admin handles approval workflow
-- through their existing admin ALL policy.
--
-- Idempotent (DROP IF EXISTS + CREATE) + NOTIFY for PostgREST
-- schema-cache reload. Safe to re-run.
--
-- Run in Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────

-- 1. Allow staff to INSERT their own request rows ─────────────

DROP POLICY IF EXISTS staff_order_requests_self_insert ON public.staff_order_requests;

CREATE POLICY staff_order_requests_self_insert ON public.staff_order_requests
  FOR INSERT WITH CHECK (
    submitted_by = auth.uid() AND public.is_staff_or_admin()
  );

-- 2. Allow staff to SELECT their own request rows ─────────────

DROP POLICY IF EXISTS staff_order_requests_self_read ON public.staff_order_requests;

CREATE POLICY staff_order_requests_self_read ON public.staff_order_requests
  FOR SELECT USING (
    submitted_by = auth.uid() OR public.is_admin()
  );

-- 3. Force PostgREST schema-cache reload ──────────────────────

NOTIFY pgrst, 'reload schema';
