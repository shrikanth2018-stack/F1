-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — onboarding the same person twice stops being an error (2026-08-04)
--
-- Two rough edges in elevate_to_staff, both only visible on a SECOND call for
-- the same person — which is what happens when an admin re-runs onboarding to
-- fix a detail, or simply types a phone number that is already staff.
--
-- 1. THE SALARY ROW COLLIDED. The function inserts a staff_salary row whenever
--    p_monthly_salary > 0, and staff_salary is UNIQUE (staff_id, month, year).
--    A second call in the same calendar month raised a duplicate-key error, so
--    the WHOLE elevate rolled back and the admin saw
--    "Elevate RPC failed: duplicate key value violates unique constraint".
--
--    ON CONFLICT DO NOTHING, deliberately, rather than DO UPDATE: that row may
--    already be settled — bonus paid, deductions entered, is_paid true — and a
--    re-onboard is not the place to silently rewrite payroll. Editing salary
--    has its own screen.
--
-- 2. EVERY CALL BURNED AN EMPLOYEE NUMBER. nextval() ran before anything
--    checked whether the profile already had an employee_id. The ID itself was
--    safe (the upsert COALESCEs the existing one), but the sequence advanced
--    regardless, so the series grew gaps: onboard three people after two
--    corrections and they are 1ST-2026-001, -004, -007. Now the sequence is
--    only touched when an ID is actually needed.
--
-- 3. A NULL BRANCH COULD BLANK AN EXISTING ONE (added 2026-08-15). The upsert
--    set `branch_id = EXCLUDED.branch_id` unconditionally, so re-onboarding
--    someone with p_branch_id NULL wiped the branch off their profile — and a
--    profile with no branch is invisible to every branch admin, which is the
--    fault profiles_branch_never_null.sql exists to close. OnboardEmployee
--    sends NULL whenever branch management is off, and its "Please select a
--    branch" check is a screen guard, not a rule this function enforced.
--    COALESCE keeps whatever the profile already had.
--
--    EDITED IN PLACE rather than superseded by a new file. This file is the
--    live definition of elevate_to_staff; three other functions in this folder
--    are each defined by two files and every one of them carries a warning
--    about which must be applied last. The runbook's rule for an RPC change is
--    to edit its own file and re-run it, which is what keeps this one having a
--    single definition.
--
-- Behaviour on a FIRST onboarding is identical in every respect.
--
-- Deploy: supabase db query --linked --file supabase/sql/elevate_employee_reonboard.sql
-- Idempotent. Replaces the function body only — signature unchanged, so the
-- deployed elevate-employee Edge Function needs no redeploy.
-- Rollback: re-run supabase/sql/elevate_employee.sql.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION elevate_to_staff(
  p_user_id         UUID,
  p_full_name       TEXT,
  p_phone_number    TEXT,
  p_designation     TEXT,
  p_joining_date    DATE,
  p_shift_timing    TEXT,
  p_assigned_hub_id BIGINT,
  p_monthly_salary  NUMERIC,
  p_benefits        TEXT,
  p_joining_bonus   NUMERIC,
  p_branch_id       BIGINT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_seq         BIGINT;
  v_employee_id TEXT;
  v_existing    TEXT;
  v_existing_id TEXT;
  v_target_role TEXT;
BEGIN
  -- FT-03: designation IS the role discriminator. ADMIN HEAD → admin,
  -- anything else → staff. The guard below only refuses the genuine
  -- demote case (existing admin being overwritten to staff via the
  -- wrong path); admin → admin (e.g. completing onboarding fields on
  -- an already-promoted admin profile) is permitted.
  v_target_role := CASE WHEN p_designation = 'ADMIN HEAD' THEN 'admin' ELSE 'staff' END;

  SELECT role, employee_id INTO v_existing, v_existing_id
    FROM profiles WHERE id = p_user_id;

  IF v_existing = 'admin' AND v_target_role = 'staff' THEN
    RAISE EXCEPTION 'Cannot demote an admin to staff via this path. Change designation away from ADMIN HEAD first.';
  END IF;

  -- Only mint an ID when there isn't one. Calling nextval() unconditionally
  -- burned a number on every correction and left gaps in the series.
  IF v_existing_id IS NULL THEN
    v_seq := nextval('employee_id_seq');
    v_employee_id := '1ST-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT
                            || '-' || LPAD(v_seq::TEXT, 3, '0');
  ELSE
    v_employee_id := v_existing_id;
  END IF;

  INSERT INTO profiles (
    id, role, phone_number, full_name, employee_id, designation,
    joining_date, shift_timing, assigned_hub_id, monthly_salary,
    benefits, branch_id, wallet_balance, loyalty_points
  ) VALUES (
    p_user_id, v_target_role, p_phone_number, p_full_name, v_employee_id, p_designation,
    p_joining_date, p_shift_timing, p_assigned_hub_id, p_monthly_salary,
    NULLIF(p_benefits, ''), p_branch_id, 0, 0
  )
  ON CONFLICT (id) DO UPDATE SET
    role            = v_target_role,
    full_name       = EXCLUDED.full_name,
    employee_id     = COALESCE(profiles.employee_id, EXCLUDED.employee_id),
    designation     = EXCLUDED.designation,
    joining_date    = EXCLUDED.joining_date,
    shift_timing    = EXCLUDED.shift_timing,
    assigned_hub_id = EXCLUDED.assigned_hub_id,
    monthly_salary  = EXCLUDED.monthly_salary,
    benefits        = EXCLUDED.benefits,
    -- COALESCE, not a bare assignment (see item 3 in the header). A NULL
    -- p_branch_id must never blank a branch this profile already has.
    branch_id       = COALESCE(EXCLUDED.branch_id, profiles.branch_id),
    updated_at      = NOW();

  SELECT employee_id INTO v_employee_id FROM profiles WHERE id = p_user_id;

  IF p_monthly_salary > 0 THEN
    INSERT INTO staff_salary (
      staff_id, month, year, base_salary, deductions, bonus, net_salary, is_paid
    ) VALUES (
      p_user_id,
      EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER,
      EXTRACT(YEAR  FROM CURRENT_DATE)::INTEGER,
      p_monthly_salary, 0, p_joining_bonus,
      p_monthly_salary + p_joining_bonus, FALSE
    )
    -- This month may already be settled. Leave it alone; salary is edited on
    -- its own screen, not as a side effect of re-running onboarding.
    ON CONFLICT (staff_id, month, year) DO NOTHING;
  END IF;

  RETURN v_employee_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
