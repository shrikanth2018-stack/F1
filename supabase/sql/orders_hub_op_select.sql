-- ─────────────────────────────────────────────────────────────
-- orders_hub_op_select: replace the leaky staff_hub_orders policy
-- (BF-46, 2026-05-12)
--
-- The prod-only staff_hub_orders policy (never tracked in supabase/sql/,
-- discovered via pg_policies during BF-43 investigation) used:
--
--   USING (((auth.jwt() ->> 'user_role') <> 'staff')
--          OR (hub_id = ((auth.jwt() ->> 'assigned_hub_id'))::integer))
--
-- The first clause grants SELECT to every non-staff user — including
-- every plain customer — for every order in the orders table. Customers
-- without an assigned_hub_id could read orders for any branch / any
-- other customer / any hub.
--
-- Tightened to: (customer role AND hub assignment matches order's hub).
-- Hub operators (customer role + assigned_hub_id) keep visibility on
-- their hub's orders, mirroring the BF-43 customer_addresses_hub_op_select
-- + the existing BF-12 orders_hub_operator_update policy.
--
-- Plain customers fall back to the orders_self policy (user_id = auth.uid()).
-- Staff/admin fall back to the is_staff_or_admin clause in orders_self.
--
-- Renamed for clarity — old name implied staff scope, but the policy
-- only ever applied to customer-role hub operators.
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────

BEGIN;

DROP POLICY IF EXISTS staff_hub_orders ON public.orders;
DROP POLICY IF EXISTS orders_hub_op_select ON public.orders;

CREATE POLICY orders_hub_op_select ON public.orders
  FOR SELECT
  USING (
    (auth.jwt() ->> 'user_role') = 'customer'
    AND hub_id IS NOT NULL
    AND hub_id = ((auth.jwt() ->> 'assigned_hub_id')::integer)
  );

COMMIT;
