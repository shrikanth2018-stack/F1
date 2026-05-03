-- ─────────────────────────────────────────────────────────────
-- Hub operator UPDATE policy on orders (BF-12, 2026-05-03)
--
-- Per BF-04's corrected persona model, hub operators are customers
-- (role='customer') with profiles.assigned_hub_id set to a hub they
-- manage. They advance order statuses for orders routed to their hub
-- via HubDashboardScreen.
--
-- The existing orders_staff_update policy only grants UPDATE to
-- staff/admin via is_staff_or_admin(), so a customer-role hub
-- operator was blocked from advancing
--   'Received at Hub' → 'On the Way' → 'Delivered'
-- The mutation fired client-side and BF-11's persona gating computed
-- the right next status, but the server silently dropped the UPDATE.
--
-- This policy fills the gap: row-level UPDATE for orders whose hub_id
-- matches the caller's JWT assigned_hub_id claim, scoped to
-- user_role='customer' so it doesn't loosen anything for staff/admin
-- (who already have orders_staff_update).
--
-- Status transition gating stays at the application layer (BF-11's
-- persona-aware nextDeliveryStatus). RLS just enforces
-- "hub op can update their own hub's orders"; the app constrains
-- which statuses are valid.
--
-- Reads assigned_hub_id from auth.jwt() (injected by
-- custom_access_token_hook) — no profiles table lookup, fast policy
-- evaluation. Same pattern as the existing staff_hub_orders SELECT
-- policy.
--
-- WITH CHECK uses the same predicate as USING so a hub op cannot
-- change hub_id to detach the order from their hub mid-update.
--
-- Idempotent (DROP IF EXISTS + CREATE). Safe to re-run.
-- Run in Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS orders_hub_operator_update ON public.orders;

CREATE POLICY orders_hub_operator_update ON public.orders
  FOR UPDATE
  USING (
    (auth.jwt() ->> 'user_role') = 'customer'
    AND hub_id IS NOT NULL
    AND hub_id = ((auth.jwt() ->> 'assigned_hub_id')::integer)
  )
  WITH CHECK (
    (auth.jwt() ->> 'user_role') = 'customer'
    AND hub_id IS NOT NULL
    AND hub_id = ((auth.jwt() ->> 'assigned_hub_id')::integer)
  );
