-- ─────────────────────────────────────────────────────────────
-- order_items_hub_op_select: parallel sibling to BF-43 + BF-46
-- (BF-47, 2026-05-12)
--
-- Discovered while debugging the Hub Dashboard empty-list bug after
-- BF-43 (customer_addresses) + BF-46 (orders) hub-op SELECT policies
-- landed. The order_items_self policy:
--
--   USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id
--          AND (o.user_id = auth.uid()
--               OR (is_staff_or_admin() AND has_branch_access(o.branch_id)))))
--
-- gives a hub operator (role='customer' + assigned_hub_id) zero matching
-- rows: they're not the order's user_id, and they're not staff/admin.
-- The Supabase nested select 'orders(*, order_items(*))' then returns
-- orders with order_items=[], and the client's isOperationalOrder filter
-- (BF-31) requires at least one item_type ∈ {food,essential} — drops
-- every row. Hub Dashboard renders empty.
--
-- Live impersonation under hub op 444 (assigned_hub_id=19):
--   - count(orders WHERE dispatch_date=CURRENT_DATE) = 6  ✓
--   - count(order_items WHERE order_id IN ...)           = 0  ✗ (this fix)
--
-- Policy mirrors orders_hub_op_select + customer_addresses_hub_op_select:
-- match the parent order's hub_id against the caller's assigned_hub_id
-- JWT claim. Hub op gets read access to items for orders routed to
-- their hub — nothing wider.
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS order_items_hub_op_select ON public.order_items;

CREATE POLICY order_items_hub_op_select ON public.order_items
  FOR SELECT
  USING (
    (auth.jwt() ->> 'user_role') = 'customer'
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND o.hub_id IS NOT NULL
        AND o.hub_id = ((auth.jwt() ->> 'assigned_hub_id')::integer)
    )
  );
