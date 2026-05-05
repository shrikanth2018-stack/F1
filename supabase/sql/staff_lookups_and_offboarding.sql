-- ─────────────────────────────────────────────────────────────
-- 1stOne F1 — Staff lookups + offboarding (FT-02b)
--
-- Adds two JSONB lookup arrays to app_settings (designations,
-- benefits) so the OnboardEmployeeScreen can pull options from
-- the DB instead of hardcoded constants. Adds an exit_date
-- column to profiles for offboarding audit. Creates the
-- demote_employee RPC that flips role back to 'customer' and
-- stamps exit_date — refusing the demote when the user is
-- still tagged as a driver on a zone or hub (admin must clear
-- those tags first via the Zone/Hub edit page).
--
-- Idempotent. Run via Supabase Dashboard → SQL Editor.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Lookup arrays on app_settings ──────────────────────────
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS staff_designations JSONB,
  ADD COLUMN IF NOT EXISTS staff_benefits     JSONB;

-- Seed from the previously-hardcoded lists (only when NULL — safe to re-run).
UPDATE app_settings
   SET staff_designations = COALESCE(
         staff_designations,
         '["Kitchen Staff","Packing Staff","Delivery Staff","Hub Staff","Manager","Admin"]'::jsonb
       ),
       staff_benefits     = COALESCE(
         staff_benefits,
         '["PF","ESI","Medical","Travel Allowance","Food Allowance","House Allowance"]'::jsonb
       )
 WHERE id = 1;

-- ── 2. Exit date on profiles (offboarding audit) ──────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS exit_date DATE NULL;

-- ── 3. Offboarding RPC ────────────────────────────────────────
CREATE OR REPLACE FUNCTION demote_employee(target_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_caller_role TEXT;
  v_target_role TEXT;
  v_zone_names  TEXT;
  v_hub_names   TEXT;
  v_blockers    TEXT := '';
BEGIN
  -- Admin gate (caller's profiles.role must be 'admin')
  SELECT role INTO v_caller_role FROM profiles WHERE id = auth.uid();
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  -- Target must currently be staff
  SELECT role INTO v_target_role FROM profiles WHERE id = target_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;
  IF v_target_role <> 'staff' THEN
    RAISE EXCEPTION 'Profile is not a staff member';
  END IF;

  -- Driver-tag pre-check: list any zones/hubs that still tag this user.
  SELECT string_agg(zone_name, ', ') INTO v_zone_names
    FROM delivery_zones WHERE driver_user_id = target_id;
  SELECT string_agg(hub_name, ', ') INTO v_hub_names
    FROM delivery_hubs  WHERE driver_user_id = target_id;

  IF v_zone_names IS NOT NULL THEN
    v_blockers := 'Zone(s): ' || v_zone_names;
  END IF;
  IF v_hub_names IS NOT NULL THEN
    IF v_blockers <> '' THEN v_blockers := v_blockers || '; '; END IF;
    v_blockers := v_blockers || 'Hub(s): ' || v_hub_names;
  END IF;

  IF v_blockers <> '' THEN
    RAISE EXCEPTION 'Cannot offboard: assigned as driver to %. Remove via Zone/Hub edit first.', v_blockers;
  END IF;

  -- Demote: role flip + exit_date stamp.
  UPDATE profiles
     SET role = 'customer',
         exit_date = CURRENT_DATE,
         updated_at = NOW()
   WHERE id = target_id;
END;
$$;

GRANT EXECUTE ON FUNCTION demote_employee(UUID) TO authenticated;
