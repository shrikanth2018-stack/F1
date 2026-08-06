-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Four things the wrong person could rewrite (2026-08-06)
--
-- Every one of these was REPRODUCED against production, impersonating the
-- real persona, inside BEGIN … ROLLBACK. None was theoretical.
--
-- The shared cause is that RLS decides WHICH ROWS, never WHICH COLUMNS. Four
-- policies correctly identified whose row it was and then let the caller
-- rewrite anything on it. The schema already knows the answer to this —
-- `vendors`, `essentials_catalog` and `user_subscriptions` are all guarded by
-- column GRANTS, which are checked before RLS and cannot be reasoned around.
-- These four never got the same treatment.
--
-- Deploy: supabase db query --linked --file supabase/sql/column_write_gaps.sql
-- Idempotent. Safe to re-run. Rollback at the bottom.
-- ═══════════════════════════════════════════════════════════════


-- ── 1. orders — a hub operator could rewrite the money ─────────
--
-- REPRODUCED: as a hub operator (a customer-role account with
-- assigned_hub_id), on an order routed to their own hub:
--     total_amount        65.00 → 1.00
--     wallet_amount_used   0.00 → 500.00
--     payment_method             → 'wallet'
--
-- `orders_hub_operator_update` tests the hub and the status VALUE, never the
-- columns, and `authenticated` held UPDATE on all 26 columns.
--
-- THE ONLY CLIENT WRITE TO `orders` IN THE ENTIRE APP is
-- `useStaffOrders.ts:130` — `.update({ status, updated_at })`. Everything
-- else (bulk advance, admin cancel, refunds, dispatch) goes through
-- SECURITY DEFINER RPCs, which execute as the function owner and are
-- untouched by a column grant. Verified by grepping every write in src/
-- before narrowing anything.
--
-- So the grant becomes exactly those two columns. This closes the hole for
-- hub operators, staff and admins alike — none of them has ever needed more
-- than this from a client.
REVOKE UPDATE ON public.orders FROM authenticated;
GRANT  UPDATE (status, updated_at) ON public.orders TO authenticated;

-- Nothing in the app writes order_items from a client either — the rows are
-- created by place_order_atomic and generate_daily_manifest, both server-side.
-- Left readable, no longer writable: a rewritten price_at_time would change
-- what a hub operator is paid commission on and what a vendor is credited.
REVOKE INSERT, UPDATE ON public.order_items FROM authenticated;

-- ── 1b. …and a customer could MINT a refundable order ──────────
--
-- Found by pulling on the same thread, and in none of the audit reports.
--
-- `orders_self_insert` permits a customer to insert their OWN order as long
-- as `status = 'Pending'`. That reads safe: a Pending order never reaches the
-- kitchen (push_kitchen_summary counts only Confirmed/Paid/Preparing) and no
-- customer has any UPDATE policy that could advance it.
--
-- But `cancel-order` treats Pending as cancellable, and refunds
-- SUM(wallet_amount_used) over the rows it cancels — a column the inserting
-- customer chose. So:
--
--   INSERT … (status 'Pending', wallet_amount_used 99999)   ← REPRODUCED, id 11522
--   POST /functions/v1/cancel-order { order_id }
--   → increment_wallet_balance(me, 99999)
--
-- A self-service money printer, repeatable, off an ordinary logged-in
-- session. The edge function is not at fault: it is right to trust a column
-- that only the server was ever supposed to write.
--
-- Client INSERT on `orders` is dead code — grepping every write in src/
-- turns up exactly one statement against this table, the status update at
-- useStaffOrders.ts:130. Orders are created by place_order_atomic and
-- generate_daily_manifest, both SECURITY DEFINER, and place_order_atomic was
-- already revoked from `authenticated` by admin_bulk_orders.sql for this
-- very reason. The grant is simply the last door left open.
REVOKE INSERT ON public.orders FROM authenticated;


-- ── 2. essentials_catalog — a vendor could edit a LIVE listing ─
--
-- REPRODUCED: the real approved vendor changed item 23's price 28.00 → 999.00
-- and renamed it, while `listing_status = 'approved'`, with no admin involved.
--
-- vendor_listing_approval.sql built an entire review workflow for exactly
-- this (`vendor_propose_listing_change` → `admin_review_listing_change`) and
-- its own comments say a change to a live listing must wait for approval.
-- But `essentials_vendor_write` is FOR ALL and only tests ownership and
-- vendor status — it never looks at `listing_status`, so the direct write
-- was still open and the workflow was merely the polite route.
--
-- A COLUMN GRANT CANNOT EXPRESS THIS, because the same vendor may write the
-- same columns while the listing is a draft. The rule is conditional on the
-- ROW's state, so it goes in a trigger — the same shape as
-- resolve_address_on_write.
--
-- is_active and daily_cap stay instant at every status, deliberately: that is
-- how a vendor says "I have run out", and making availability wait for
-- approval means customers buy goods the vendor already knows they cannot
-- supply. That carve-out is the design, not an oversight.
CREATE OR REPLACE FUNCTION public.vendor_listing_edit_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only vendor-owned rows that are already live are gated.
  IF NEW.vendor_id IS NULL OR COALESCE(OLD.listing_status, 'approved') <> 'approved' THEN
    RETURN NEW;
  END IF;

  -- The team edits freely — that IS the approval path
  -- (admin_review_listing_change writes through here), as does anything
  -- running server-side with no user attached.
  IF auth.uid() IS NULL OR public.is_staff_or_admin() THEN
    RETURN NEW;
  END IF;

  -- A vendor touching their own live listing: keep availability, revert the
  -- rest. Silently, and on purpose — the vendor's route is "propose a
  -- change", and My Store never offers a direct edit of a live row, so
  -- anything arriving here is a hand-made REST call rather than a person
  -- being surprised by a rejection.
  NEW.name        := OLD.name;
  NEW.price       := OLD.price;
  NEW.unit        := OLD.unit;
  NEW.cycle_id    := OLD.cycle_id;
  NEW.description := OLD.description;
  NEW.image_path  := OLD.image_path;
  NEW.image_updated_at := OLD.image_updated_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vendor_listing_edit_guard ON public.essentials_catalog;
CREATE TRIGGER trg_vendor_listing_edit_guard
  BEFORE UPDATE ON public.essentials_catalog
  FOR EACH ROW EXECUTE FUNCTION public.vendor_listing_edit_guard();


-- ── 3. staff_attendance — staff could rewrite their own history ─
--
-- REPRODUCED: a staff member rewrote BOTH of their attendance rows —
-- including 2026-08-04, two days old — to 01:00–23:00, turning a
-- 25-second clock-in/out into a 22-hour day. `attendance_self` is
-- FOR ALL USING (staff_id = auth.uid() OR admin) with no WITH CHECK, and
-- `authenticated` held UPDATE on all 10 columns.
--
-- This is the table `StaffReport` reads for payroll, and the whole
-- attendance-correction workflow — admin-approved, deliberately — exists
-- because staff should NOT be able to write history directly. This morning's
-- month-end reminder push drives people into that workflow; it would be
-- pointless if the table were writable anyway.
--
-- TWO LAYERS, because a date window alone was not enough. The first attempt
-- here was a 7-day WITH CHECK on its own; the reproduction still passed,
-- because both rows it rewrote were 0 and 2 days old. A window protects last
-- month's settled payroll and does nothing about this week's.
--
--   COLUMN GRANT   staff may UPDATE only the clock-OUT columns. clock_in_time
--                  becomes write-once: set by the INSERT that opens the day,
--                  never rewritable afterwards. That is the fraud that
--                  matters — a shift start moved back to 00:00.
--   DATE WINDOW    stops an old row being touched at all.
--
-- Both are needed. The grant stops the value being changed; the window stops
-- a row from a settled month being reopened.
--
-- WHY THE WINDOW IS SEVEN DAYS AND NOT ONE. Clock-in and clock-out target
-- TODAY (useAttendance.ts matches `date = today`), so one day would be
-- enough for the online path — but the offline queue can replay days later,
-- and a queued clock-out the check rejects retries five times and is then
-- dropped to Sentry. That trades a lost real day's hours for a marginal
-- fraud gain. Seven days loses no plausible offline sync.
--
-- The repeat-clock-in case: useAttendance upserts on (staff_id, date), so a
-- second clock-in for a day that already has a row would now be refused
-- rather than overwriting the original time. That is the correct outcome —
-- and it is unreachable from the UI, which shows Clock Out once a row exists.
REVOKE UPDATE ON public.staff_attendance FROM authenticated;
GRANT  UPDATE (clock_out_time, clock_out_lat, clock_out_lng)
  ON public.staff_attendance TO authenticated;

DROP POLICY IF EXISTS attendance_self ON public.staff_attendance;
CREATE POLICY attendance_self ON public.staff_attendance
  FOR ALL
  USING (
    staff_id = auth.uid()
    OR (public.is_admin() AND public.has_branch_access(branch_id))
  )
  WITH CHECK (
    (public.is_admin() AND public.has_branch_access(branch_id))
    OR (
      staff_id = auth.uid()
      AND date >= ((NOW() AT TIME ZONE 'Asia/Kolkata')::date - 7)
      AND date <= ((NOW() AT TIME ZONE 'Asia/Kolkata')::date + 1)
    )
  );


-- ── 4. customer_addresses — the lat/lng-less bypass ────────────
--
-- REPRODUCED: a customer inserted an address with NO latitude or longitude
-- and set `hub_id = 19, is_serviceable = true, branch_id = 1` themselves.
-- All three stuck.
--
-- client_write_gaps.sql (2026-08-04) added trg_address_resolve to recompute
-- those columns from the pin — but it returns early when the pin is absent,
-- which leaves whatever the client sent. The fix was real and the hole it
-- left is the mirror image of it.
--
-- Those columns decide whether an order is accepted at all, which branch's
-- catalogue is shown, whether it routes through a hub, WHICH delivery fee
-- applies (hub override → zone override → store default, orderBuild.ts), and
-- — through vendor_ids_for_address — which vendor's zone-restricted goods
-- become buyable. Self-declared, all of it.
--
-- The early return cannot simply be deleted: an UPDATE that touches only the
-- label has no pin in NEW and must not wipe the routing. So instead of
-- trusting NEW, it now carries OLD forward on an update, and forces the safe
-- answer on an insert.
CREATE OR REPLACE FUNCTION public.resolve_address_on_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res  RECORD;
  v_hubs BOOLEAN;
BEGIN
  -- Trusted callers keep what they wrote: service-role and cron (no uid),
  -- and staff/admin, who legitimately override routing
  -- (assign_addresses_to_hub, fixing a misrouted address).
  IF auth.uid() IS NULL OR public.is_staff_or_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.latitude IS NULL OR NEW.longitude IS NULL THEN
    -- No pin to resolve from. Previously this returned NEW untouched, which
    -- is what let a customer declare their own routing. Now: an update keeps
    -- whatever was already resolved, and an insert gets nothing.
    IF TG_OP = 'UPDATE' THEN
      NEW.zone_id        := OLD.zone_id;
      NEW.hub_id         := OLD.hub_id;
      NEW.is_serviceable := OLD.is_serviceable;
      NEW.branch_id      := OLD.branch_id;
    ELSE
      NEW.zone_id        := NULL;
      NEW.hub_id         := NULL;
      NEW.is_serviceable := FALSE;
      NEW.branch_id      := NULL;
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO v_res
  FROM public.resolve_address_serviceability(
    NEW.latitude::double precision,
    NEW.longitude::double precision
  );

  v_hubs := COALESCE(
    (SELECT flag_value FROM public.feature_flags WHERE flag_key = 'hub_delivery_active'),
    FALSE
  );

  NEW.zone_id        := v_res.zone_id;
  NEW.hub_id         := CASE WHEN v_hubs THEN v_res.hub_id ELSE NULL END;
  NEW.is_serviceable := v_res.is_serviceable;
  NEW.branch_id      := COALESCE(
    (SELECT branch_id FROM public.delivery_hubs  WHERE id = NEW.hub_id),
    (SELECT branch_id FROM public.delivery_zones WHERE id = NEW.zone_id)
  );

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';


-- ── Verification ───────────────────────────────────────────────
-- Each of the four reproductions above must now be refused or neutered.
-- Impersonate; never check an RLS or grant rule as a superuser.
--
--   1. hub operator UPDATE of total_amount  → ERROR 42501 permission denied
--   2. vendor UPDATE of a live price        → succeeds but price is UNCHANGED
--   3. staff UPDATE of a 30-day-old row     → ERROR 42501 RLS violation
--      staff UPDATE of today's row          → succeeds (clock-out must work)
--   4. customer INSERT with no lat/lng      → hub_id NULL, is_serviceable false


-- ── Rollback ───────────────────────────────────────────────────
-- GRANT UPDATE ON public.orders TO authenticated;
-- GRANT INSERT, UPDATE ON public.order_items TO authenticated;
-- DROP TRIGGER IF EXISTS trg_vendor_listing_edit_guard ON public.essentials_catalog;
-- DROP FUNCTION IF EXISTS public.vendor_listing_edit_guard();
-- DROP POLICY IF EXISTS attendance_self ON public.staff_attendance;
-- CREATE POLICY attendance_self ON public.staff_attendance FOR ALL
--   USING (staff_id = auth.uid() OR (public.is_admin() AND public.has_branch_access(branch_id)));
-- then re-run client_write_gaps.sql to restore the early-returning trigger.
