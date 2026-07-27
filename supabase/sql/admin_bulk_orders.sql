-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Admin / bulk order entry (Slice 2)
--
-- Back-office order creation: an admin places an order on behalf of a
-- customer (bulk, individual or B2B), for one delivery cycle, from the
-- menu items and priced building-block items defined by the two-stage
-- builder (see menu_items_visibility.sql).
--
-- All of the money still comes from the server. The admin sends item ids +
-- quantities and, optionally, a discount percentage and a delivery-fee
-- override; the `admin-place-order` edge function re-derives everything
-- through the SAME _shared/orderBuild.ts the customer path uses, then
-- applies the discount and writes through place_order_atomic.
--
-- Columns added here are all nullable/defaulted — every pre-existing row
-- and every existing code path is unaffected.
--
-- Deploy: paste into the Supabase SQL editor. Idempotent.
-- App coupling: run BEFORE deploying admin-place-order and BEFORE the OTA.
--               Then `npm run supabase:gen-types`.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Order provenance + admin-entered money ──────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS placed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS razorpay_payment_link_id TEXT;

COMMENT ON COLUMN public.orders.placed_by IS
  'The admin who created this order from the back office. NULL = placed by the customer themselves. Also the "is this a bulk/B2B order" discriminator for reporting.';
COMMENT ON COLUMN public.orders.discount_percent IS
  'Admin-entered discount applied to the ITEM subtotal (never the delivery fee). NULL on customer orders. Recorded for the invoice; the discounted price is already reflected in order_items.price_at_time and orders.total_amount.';
COMMENT ON COLUMN public.orders.razorpay_payment_link_id IS
  'Razorpay Payment Link id (plink_…) when the admin chose the payment-link mode. Deliberately NOT razorpay_order_id — four existing code paths match on that column.';

-- Discount sanity is enforced in the edge function against store_config, but
-- a hard bound here stops any future writer storing something absurd.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_discount_percent_range'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_discount_percent_range
      CHECK (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100));
  END IF;
END $$;

-- Powers the "Bulk only" filter on the admin orders list. Plain (not
-- CONCURRENTLY) on purpose: CONCURRENTLY cannot run inside a transaction
-- block, and at this table's size the build is milliseconds. If `orders`
-- ever grows into the millions, drop and rebuild it CONCURRENTLY off-peak.
CREATE INDEX IF NOT EXISTS idx_orders_placed_by
  ON public.orders (placed_by) WHERE placed_by IS NOT NULL;

-- ── 2. Allow the 'account' payment method ─────────────────────
-- A back-office order may be placed on account: confirmed and sent to the
-- kitchen now, collected later. The live CHECK constraint allows only
-- wallet / razorpay / split, so an on-account insert would fail. Widen it
-- rather than misuse 'split' (which means something else and is unused).
-- No existing row violates the new set, so this is a pure widening.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;

ALTER TABLE public.orders ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method = ANY (ARRAY[
    'wallet'::text, 'razorpay'::text, 'split'::text, 'account'::text
  ]));

-- ── 3. Admin discount ceiling — a business rule, so it lives in config ──
ALTER TABLE public.store_config
  ADD COLUMN IF NOT EXISTS max_admin_discount_percent NUMERIC NOT NULL DEFAULT 15;

COMMENT ON COLUMN public.store_config.max_admin_discount_percent IS
  'Upper bound on the discount an admin may apply when creating a back-office order. Enforced server-side in admin-place-order.';

-- ── 4. Close the place_order_atomic grant ──────────────────────
-- Found during the 2026-07-27 deep dive and confirmed against the live
-- catalog: place_order_atomic held EXECUTE for PUBLIC, anon AND
-- authenticated.
--
-- It is SECURITY DEFINER, so it runs as the owner and bypasses RLS, and —
-- unlike every comparable RPC here — it performs NO authorization check of
-- its own. advance_orders_status and admin_cancel_order_atomic are also
-- granted to `authenticated`, but both open with an explicit role gate
-- (`SELECT role FROM profiles WHERE id = auth.uid()` … RAISE EXCEPTION).
-- place_order_atomic simply inserts whatever it is handed, so any logged-in
-- user could call it directly and mint a Confirmed, unpaid order —
-- bypassing place-order's pricing, drift check, rate limit and payment
-- entirely.
--
-- Its only legitimate callers are the place-order and admin-place-order
-- edge functions, both of which use the service-role key. service_role
-- keeps its own explicit grant, so neither is affected. No app change, no
-- function redeploy, no OTA. Reversed by a GRANT if ever needed.
REVOKE ALL ON FUNCTION public.place_order_atomic(
  UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, BIGINT, TEXT, BIGINT, JSONB
) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
