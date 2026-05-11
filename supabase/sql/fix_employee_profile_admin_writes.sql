-- ─────────────────────────────────────────────────────────────
-- 1stOne F1 — Fix admin writes on profiles + staff_salary
--
-- Two pre-existing latent gaps surfaced by FT-07 testing:
--
-- (a) profiles UPDATE permission denied for non-(full_name, phone_number)
--     columns. The authenticated role only has UPDATE GRANT on those
--     two columns (intentionally — keeps customers from self-editing
--     privileged fields). Admin's profile-detail edits (shift_timing,
--     monthly_salary, benefits, joining_date, assigned_hub_id) hit
--     column GRANT denial before RLS is even consulted. Designation
--     was already routed through set_employee_designation RPC (FT-03);
--     this RPC does the same for the other editable fields.
--
-- (b) staff_salary INSERT silently rejected by RLS. The original
--     salary_self policy is FOR SELECT only; no FOR INSERT/UPDATE
--     policy for admin → default deny → admin's "Add salary record"
--     fails. Mirrors the staff_attendance / staff_leaves shape (which
--     have FOR ALL admin policies) by adding salary_admin_all.
--
-- Idempotent. Run via Supabase Dashboard → SQL Editor.
-- ─────────────────────────────────────────────────────────────

-- ── 1. update_employee_profile RPC ────────────────────────────
-- SECURITY DEFINER bypasses the column GRANT. Caller-gated to admin;
-- branch admin can only edit profiles in their own branch; super-admin
-- can edit any branch. Whitelist of editable fields — anything else in
-- the JSONB payload is silently ignored. JSON null values clear the
-- column; missing keys leave the column unchanged.
CREATE OR REPLACE FUNCTION public.update_employee_profile(
  target_id UUID,
  updates   JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_caller_role    TEXT;
  v_caller_branch  INTEGER;
  v_target_branch  INTEGER;
  v_is_super_admin BOOLEAN;
BEGIN
  -- Caller gate. FT-05: super-admin marker is the explicit
  -- profiles.is_super_admin column; the legacy "v_caller_branch IS NULL"
  -- convention is no longer authoritative.
  SELECT role, branch_id, is_super_admin INTO v_caller_role, v_caller_branch, v_is_super_admin
    FROM public.profiles WHERE id = auth.uid();
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;
  v_is_super_admin := COALESCE(v_is_super_admin, FALSE);

  -- Branch scope: branch admin can only touch profiles in their branch.
  SELECT branch_id INTO v_target_branch
    FROM public.profiles WHERE id = target_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target profile not found';
  END IF;
  IF NOT v_is_super_admin AND v_target_branch IS DISTINCT FROM v_caller_branch THEN
    RAISE EXCEPTION 'Target outside your branch';
  END IF;

  UPDATE public.profiles SET
    full_name       = CASE WHEN updates ? 'full_name'       THEN updates->>'full_name'                              ELSE full_name END,
    joining_date    = CASE WHEN updates ? 'joining_date'    THEN NULLIF(updates->>'joining_date',    '')::DATE      ELSE joining_date END,
    shift_timing    = CASE WHEN updates ? 'shift_timing'    THEN updates->>'shift_timing'                           ELSE shift_timing END,
    monthly_salary  = CASE WHEN updates ? 'monthly_salary'  THEN NULLIF(updates->>'monthly_salary',  '')::NUMERIC   ELSE monthly_salary END,
    benefits        = CASE WHEN updates ? 'benefits'        THEN updates->>'benefits'                               ELSE benefits END,
    assigned_hub_id = CASE WHEN updates ? 'assigned_hub_id' THEN NULLIF(updates->>'assigned_hub_id', '')::INTEGER   ELSE assigned_hub_id END,
    updated_at      = NOW()
   WHERE id = target_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_employee_profile(UUID, JSONB) TO authenticated;

-- ── 2. salary_admin_all policy ────────────────────────────────
-- Closes the missing-policy gap on staff_salary. The existing
-- salary_self FOR SELECT policy keeps staff's own-row read access;
-- this adds admin write + full access within branch.
DROP POLICY IF EXISTS salary_admin_all ON public.staff_salary;
CREATE POLICY salary_admin_all ON public.staff_salary
  FOR ALL USING (public.is_admin() AND public.has_branch_access(branch_id))
          WITH CHECK (public.is_admin() AND public.has_branch_access(branch_id));
