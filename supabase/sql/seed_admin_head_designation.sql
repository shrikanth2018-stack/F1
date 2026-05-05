-- ─────────────────────────────────────────────────────────────
-- 1stOne F1 — FT-03: ADMIN HEAD designation + role-flip RPC
--
-- Designation IS the role discriminator for branch admins:
--   designation = 'ADMIN HEAD'  →  role = 'admin'
--   any other designation       →  role = 'staff'
-- (Super-admin remains a separate marker — role='admin' AND
-- branch_id IS NULL — and is not assigned via this flow.)
--
-- Two pieces:
-- 1. Append 'ADMIN HEAD' to app_settings.staff_designations (idempotent).
-- 2. Create set_employee_designation(UUID, TEXT) — atomic designation
--    + role flip; super-admin gate when crossing the ADMIN HEAD boundary.
--
-- Idempotent. Run via Supabase Dashboard → SQL Editor.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Append ADMIN HEAD to the lookup ────────────────────────
-- `?` returns true when the JSONB array contains the string element.
-- Skip the UPDATE if it's already present.
UPDATE public.app_settings
   SET staff_designations =
         COALESCE(staff_designations, '[]'::jsonb) || '["ADMIN HEAD"]'::jsonb
 WHERE id = 1
   AND NOT (COALESCE(staff_designations, '[]'::jsonb) ? 'ADMIN HEAD');

-- ── 2. Designation-change RPC ─────────────────────────────────
-- SECURITY DEFINER so it bypasses the column-level GRANTs that block
-- direct UPDATE on profiles.role / .designation. Caller must be admin.
-- Crossing into or out of 'ADMIN HEAD' requires super-admin
-- (role='admin' AND branch_id IS NULL).
CREATE OR REPLACE FUNCTION public.set_employee_designation(
  target_id        UUID,
  new_designation  TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_caller_role        TEXT;
  v_caller_branch      INTEGER;
  v_is_super_admin     BOOLEAN;
  v_target_designation TEXT;
  v_target_role        TEXT;
  v_crossing_admin     BOOLEAN;
  v_new_role           TEXT;
BEGIN
  -- Caller gate: must be admin.
  SELECT role, branch_id INTO v_caller_role, v_caller_branch
    FROM public.profiles WHERE id = auth.uid();
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;
  v_is_super_admin := (v_caller_branch IS NULL);

  -- Target must exist and be a staff or admin profile (not a customer).
  SELECT designation, role INTO v_target_designation, v_target_role
    FROM public.profiles WHERE id = target_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target profile not found';
  END IF;
  IF v_target_role NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'Target must be staff or admin (current role: %)', v_target_role;
  END IF;

  -- Super-admin gate when changing TO or FROM 'ADMIN HEAD'.
  v_crossing_admin :=
    (new_designation = 'ADMIN HEAD' AND v_target_designation IS DISTINCT FROM 'ADMIN HEAD')
    OR
    (v_target_designation = 'ADMIN HEAD' AND new_designation IS DISTINCT FROM 'ADMIN HEAD');
  IF v_crossing_admin AND NOT v_is_super_admin THEN
    RAISE EXCEPTION 'Only super-admin can change designation to or from ADMIN HEAD';
  END IF;

  -- Atomic designation + role flip.
  IF new_designation = 'ADMIN HEAD' THEN
    v_new_role := 'admin';
  ELSE
    v_new_role := 'staff';
  END IF;

  UPDATE public.profiles
     SET designation = new_designation,
         role        = v_new_role,
         updated_at  = NOW()
   WHERE id = target_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_employee_designation(UUID, TEXT) TO authenticated;
