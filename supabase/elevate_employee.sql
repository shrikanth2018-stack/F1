-- ─────────────────────────────────────────────────────────────
-- 1stOne F1 — Employee ID sequence + atomic elevate function
-- Run in Supabase Dashboard → SQL Editor. Idempotent.
-- ─────────────────────────────────────────────────────────────

-- Sequence: global, monotonic. Year prefix in the ID is display only.
CREATE SEQUENCE IF NOT EXISTS employee_id_seq START WITH 1 INCREMENT BY 1 NO CYCLE;

-- Bring sequence past the highest existing employee_id so new IDs don't collide.
DO $$
DECLARE max_seq INTEGER;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(employee_id, '^.*-', ''), '')::INTEGER), 0)
    INTO max_seq
    FROM profiles
    WHERE role = 'staff' AND employee_id ~ '^1ST-\d{4}-\d+$';
  IF max_seq > 0 THEN PERFORM setval('employee_id_seq', max_seq); END IF;
END $$;

-- Atomic upsert: profile + first salary row in one transaction.
-- Service role only (called from elevate-employee Edge Function).
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
BEGIN
  SELECT role INTO v_existing FROM profiles WHERE id = p_user_id;
  IF v_existing = 'admin' THEN
    RAISE EXCEPTION 'Cannot elevate an admin account to staff';
  END IF;

  v_seq := nextval('employee_id_seq');
  v_employee_id := '1ST-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT
                          || '-' || LPAD(v_seq::TEXT, 3, '0');

  INSERT INTO profiles (
    id, role, phone_number, full_name, employee_id, designation,
    joining_date, shift_timing, assigned_hub_id, monthly_salary,
    benefits, branch_id, wallet_balance, loyalty_points
  ) VALUES (
    p_user_id, 'staff', p_phone_number, p_full_name, v_employee_id, p_designation,
    p_joining_date, p_shift_timing, p_assigned_hub_id, p_monthly_salary,
    NULLIF(p_benefits, ''), p_branch_id, 0, 0
  )
  ON CONFLICT (id) DO UPDATE SET
    role            = 'staff',
    full_name       = EXCLUDED.full_name,
    employee_id     = COALESCE(profiles.employee_id, EXCLUDED.employee_id),
    designation     = EXCLUDED.designation,
    joining_date    = EXCLUDED.joining_date,
    shift_timing    = EXCLUDED.shift_timing,
    assigned_hub_id = EXCLUDED.assigned_hub_id,
    monthly_salary  = EXCLUDED.monthly_salary,
    benefits        = EXCLUDED.benefits,
    branch_id       = EXCLUDED.branch_id,
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
    );
  END IF;

  RETURN v_employee_id;
END;
$$;
