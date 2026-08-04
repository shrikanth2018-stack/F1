-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Three tables a customer could write directly (2026-08-04)
--
-- Found by reading the policies, then PROVEN by impersonating a real
-- customer (request.jwt.claims + SET LOCAL ROLE authenticated) inside a
-- transaction that rolled back. Both inserts below came back ALLOWED.
--
-- The cause is the same in each case: a policy written as
--
--     FOR ALL USING (<owner test>)
--
-- with no WITH CHECK. Postgres reuses the USING expression as the insert
-- check, so "rows I may READ" silently became "rows I may WRITE" — and
-- `schema.sql` grants ALL on these tables to `authenticated`, so the policy
-- is the only gate there is.
--
-- WHAT THIS IS NOT. None of this is reachable from any screen; it needs a
-- REST call made by hand with the caller's own token. It is being fixed now
-- because there is zero customer data, which is the cheapest this will ever
-- be to change and to verify.
--
-- Deliberately NOT changed: `cancelled_subscription_days`. Its USING clause
-- already tests that the subscription belongs to the caller, so doubling as
-- the insert check is exactly right there.
--
-- Deploy: supabase db query --linked --file supabase/sql/client_write_gaps.sql
-- Idempotent. Safe to re-run. Rollback at the bottom.
-- ═══════════════════════════════════════════════════════════════


-- ── 1. user_subscriptions — a self-granted subscription ────────
--
-- A customer could INSERT a row for themselves against any plan with
-- is_active = true. generate_daily_manifest asks only for active, unpaused
-- subscriptions, so it would then dispatch a Confirmed order every day for
-- the plan's full duration, at zero money, and the kitchen would cook them.
--
-- The fix is column grants, the pattern already used for `profiles.role`
-- (behind elevate_to_staff) and `vendors.status` (behind admin_set_vendor_*),
-- rather than a cleverer policy — grants are checked before RLS and cannot be
-- reasoned around.
--
--   INSERT  nobody. place-order writes these with the service-role key, which
--           bypasses grants and RLS entirely.
--   DELETE  nobody. Subscriptions are deactivated, never deleted, so history
--           and revenue reports stay readable.
--   UPDATE  is_paused only — the single write any screen makes
--           (usePauseSubscription, the customer's own Pause/Resume).
--
-- Admin cancellation is unaffected: admin_cancel_subscription_atomic is
-- SECURITY DEFINER and runs as the owner. Activation on payment
-- (confirm-order, verify-payment) and consumption (generate_daily_manifest)
-- are service-role and DEFINER respectively.
REVOKE INSERT, UPDATE, DELETE ON public.user_subscriptions FROM authenticated;
GRANT  UPDATE (is_paused)     ON public.user_subscriptions TO authenticated;


-- ── 2. expense_claims — a self-approved claim ──────────────────
--
-- Staff submit their own claims from StaffExpensesScreen, so the insert path
-- has to stay open. What must not stay open is the claimant choosing the
-- status: `Approved` or `Paid` written directly skips the admin entirely, and
-- `Paid` additionally fires trg_vendor_payout_paid.
--
-- So the USING clause is unchanged — reads still work for staff, for hub
-- operators reading their commission claims, and for vendors reading their
-- payout claims (all three are the same `staff_id = auth.uid()` test). Only
-- the WRITE side gains a check:
--
--   admin        anything, within their branch (this is the settle path —
--                Pending → Approved → Paid in Expense Manager)
--   anyone else  their own row, at status 'Pending', and only if they are
--                actually staff
--
-- Hub commission and vendor payout claims do NOT go through here — they are
-- created by create_hub_commission_claim / create_vendor_payout_claim, both
-- SECURITY DEFINER, which is why a customer-role vendor never needs an
-- insert of their own.
DROP POLICY IF EXISTS expense_claims_self ON public.expense_claims;
CREATE POLICY expense_claims_self ON public.expense_claims
  FOR ALL
  USING (
    staff_id = auth.uid()
    OR (public.is_admin() AND public.has_branch_access(branch_id))
  )
  WITH CHECK (
    (public.is_admin() AND public.has_branch_access(branch_id))
    OR (
      staff_id = auth.uid()
      AND status = 'Pending'
      AND public.is_staff_or_admin()
    )
  );


-- ── 3. customer_addresses — an address that grades its own homework ──
--
-- The point-in-polygon test is server-side, but its ANSWER was not: the phone
-- calls resolve_address_serviceability and then writes zone_id, hub_id and
-- is_serviceable itself. Those three columns decide whether an order is
-- accepted at all, which branch's catalogue is shown, whether it routes
-- through a hub, and which delivery fee applies (hub override → zone override
-- → store default, orderBuild.ts). A hand-written insert could set them to
-- anything.
--
-- This recomputes all three from the pin, discarding whatever was sent. It is
-- behaviour-neutral by construction: the app already stores the server's own
-- answer, so the trigger writes exactly what is written today.
--
-- WHO IS SKIPPED, AND WHY
--   auth.uid() IS NULL   not a user request — service-role and cron. Covers
--                        admin-create-customer, which already resolves
--                        serviceability itself before inserting.
--   staff/admin          assign_addresses_to_hub bulk-reassigns hub_id when a
--                        hub polygon is redrawn, and an admin fixing a
--                        misrouted address is a legitimate override. Neither
--                        should be undone by a recompute.
--
-- hub_id honours `hub_delivery_active` exactly as AddAddressScreen does. With
-- the flag off, an address must not carry a hub — orderBuild reads a non-null
-- hub_id as "deliver via hub" and would route through a hub that is not
-- operating.
--
-- branch_id is derived here too, rather than left to trg_address_branch_id.
-- That trigger is BEFORE INSERT OR UPDATE **OF hub_id, zone_id**, which fires
-- on the statement's SET list, not on what another trigger changed — so an
-- update that touched only the label could move the zone here and leave the
-- branch behind. Same COALESCE(hub's branch, zone's branch) rule, so nothing
-- about the outcome differs.
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
  -- Trusted callers keep what they wrote (see the note above).
  IF auth.uid() IS NULL OR public.is_staff_or_admin() THEN
    RETURN NEW;
  END IF;

  -- No pin, nothing to resolve from — leave the row exactly as sent.
  IF NEW.latitude IS NULL OR NEW.longitude IS NULL THEN
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

DROP TRIGGER IF EXISTS trg_address_resolve ON public.customer_addresses;
CREATE TRIGGER trg_address_resolve
  BEFORE INSERT OR UPDATE ON public.customer_addresses
  FOR EACH ROW
  EXECUTE FUNCTION public.resolve_address_on_write();

NOTIFY pgrst, 'reload schema';


-- ── Verification ───────────────────────────────────────────────
-- Impersonate a real customer inside a transaction and confirm each write is
-- refused. Never check this as a superuser: RLS is bypassed for the table
-- owner and the run will confirm a policy that denies everyone.
--
--   BEGIN;
--     SELECT set_config('request.jwt.claims',
--       json_build_object('sub', '<a customer uuid>', 'role', 'authenticated',
--                         'user_role', 'customer')::text, true);
--     SELECT set_config('role', 'authenticated', true);
--     -- each of these must ERROR:
--     INSERT INTO user_subscriptions (user_id, plan_id, start_date, is_active)
--       VALUES ('<same uuid>', <plan>, CURRENT_DATE, TRUE);
--     INSERT INTO expense_claims (staff_id, amount, category, status)
--       VALUES ('<same uuid>', 999, 'Others', 'Paid');
--   ROLLBACK;


-- ── Rollback ───────────────────────────────────────────────────
-- GRANT INSERT, UPDATE, DELETE ON public.user_subscriptions TO authenticated;
-- DROP TRIGGER IF EXISTS trg_address_resolve ON public.customer_addresses;
-- DROP FUNCTION IF EXISTS public.resolve_address_on_write();
-- DROP POLICY IF EXISTS expense_claims_self ON public.expense_claims;
-- CREATE POLICY expense_claims_self ON public.expense_claims
--   FOR ALL USING (staff_id = auth.uid()
--                  OR (public.is_admin() AND public.has_branch_access(branch_id)));
