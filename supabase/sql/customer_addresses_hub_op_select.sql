-- ─────────────────────────────────────────────────────────────
-- Hub operator SELECT policy on customer_addresses (BF-43, 2026-05-12)
--
-- Sibling of orders_hub_operator_update (BF-12) and the prod-only
-- staff_hub_orders SELECT on orders. Without this, the nested join
-- in HubDashboardScreen / useStaffOrders ('orders(*, customer_addresses(*, ...))')
-- returns customer_addresses=NULL for every order not belonging to the
-- hub operator themselves — and the client filter
-- 'o.customer_addresses?.hub_id === assignedHubId' then drops all
-- rows, leaving the Hub Dashboard empty.
--
-- Grants SELECT only — the hub op never edits the customer's address.
-- Keyed on the JWT assigned_hub_id claim (same pattern as
-- orders_hub_operator_update). Restricted to rows whose hub_id matches
-- the hub op's assigned hub; nothing wider.
--
-- Idempotent (DROP IF EXISTS + CREATE). Safe to re-run.
-- Run in Supabase SQL Editor or via 'supabase db query --file --linked'.
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS customer_addresses_hub_op_select ON public.customer_addresses;

CREATE POLICY customer_addresses_hub_op_select ON public.customer_addresses
  FOR SELECT
  USING (
    hub_id IS NOT NULL
    AND hub_id = ((auth.jwt() ->> 'assigned_hub_id')::integer)
  );
