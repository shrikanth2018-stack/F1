-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — An order cannot walk backwards, or come back from Cancelled
-- (2026-08-06)
--
-- REPRODUCED against production, rolled back: a staff member moved order
-- 11494 — status `Cancelled`, ₹65 already refunded to the customer's wallet —
-- straight back to `Preparing`. Nothing objected: not RLS, not the
-- `orders_status_allowed` CHECK (which constrains the SET of legal values,
-- never the transition), not the app.
--
-- The kitchen would then cook and deliver an order the customer has already
-- been refunded for, and `order.ready` would push them to say so.
--
-- WHY THE APP CANNOT BE THE ONLY GUARD. `useOfflineSync` already has a
-- no-regress guard — it replays a queued status update only while the row is
-- still at an earlier status, so a stale mutation lands as a 0-row no-op.
-- That guard was written for the offline path and never mirrored on the
-- ONLINE one (`useStaffOrders.ts:130` is a bare update). And there are four
-- routes to a status change — staff update, offline replay,
-- advance_orders_status, admin override — so the rule belongs where all four
-- pass: a trigger.
--
-- WHAT IS ALLOWED, and why it is not stricter:
--
--   service role (auth.uid() IS NULL)   unrestricted. cancel-order,
--                                       place-order, mark_order_failed and
--                                       the manifest all move status
--                                       server-side and are the authority.
--   admin                               unrestricted. Correcting a mis-tapped
--                                       status is a real job, and an admin
--                                       who cancels-then-reinstates is making
--                                       a decision, not an accident. Blocking
--                                       them would push the work into SQL.
--   everyone else                       forward only, and never out of a
--                                       terminal status.
--
-- Terminal means Cancelled or Failed: money has already moved back, so
-- re-entering the flow is the expensive mistake. Delivered is deliberately
-- NOT terminal here — it is the last step of the flow and the forward-only
-- rule already covers it.
--
-- Deploy: supabase db query --linked --file supabase/sql/order_status_no_regress.sql
-- Idempotent. Safe to re-run. Rollback at the bottom.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.orders_status_no_regress()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Mirrors ORDER_STATUS_FLOW in src/utils/orderStatus.ts. The two must stay
  -- in step: that array is what the offline replay guard slices, and this is
  -- what the database enforces. Cancelled and Failed are off-flow by design.
  v_flow  TEXT[] := ARRAY['Pending','Confirmed','Preparing','Ready','Packed',
                          'Dispatched','Received at Hub','On the Way','Delivered'];
  v_old   INTEGER;
  v_new   INTEGER;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Server-side callers and admins are the authority; see the header.
  IF auth.uid() IS NULL OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('Cancelled', 'Failed') THEN
    RAISE EXCEPTION
      'Order % is % and cannot be reopened. Ask an admin if this is wrong.',
      OLD.id, OLD.status;
  END IF;

  -- Moving TO a terminal status is always allowed (a driver marking a failed
  -- delivery); only coming back out of one is not.
  IF NEW.status IN ('Cancelled', 'Failed') THEN
    RETURN NEW;
  END IF;

  v_old := array_position(v_flow, OLD.status);
  v_new := array_position(v_flow, NEW.status);

  -- A status outside the known flow (legacy 'Paid') is left alone rather than
  -- guessed at — refusing on an unknown value would be a worse failure than
  -- allowing it.
  IF v_old IS NULL OR v_new IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_new < v_old THEN
    RAISE EXCEPTION
      'Order % cannot go from % back to %.', OLD.id, OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_status_no_regress ON public.orders;
CREATE TRIGGER trg_orders_status_no_regress
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_status_no_regress();

NOTIFY pgrst, 'reload schema';

-- ── Verification ───────────────────────────────────────────────
--   staff: Cancelled → Preparing   → ERROR "cannot be reopened"
--   staff: Ready     → Confirmed   → ERROR "cannot go from … back to …"
--   staff: Confirmed → Ready       → succeeds (the normal flow)
--   staff: Confirmed → Cancelled   → succeeds (moving TO terminal)

-- ── Rollback ───────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS trg_orders_status_no_regress ON public.orders;
-- DROP FUNCTION IF EXISTS public.orders_status_no_regress();
