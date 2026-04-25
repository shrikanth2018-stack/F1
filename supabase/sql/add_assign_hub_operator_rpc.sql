-- 1stOne F1 — assign_hub_operator RPC
--
-- Admin writes to profiles.assigned_hub_id of another user — which RLS normally
-- blocks. This SECURITY DEFINER function makes it atomic and policy-safe:
--   1. Clear the previous operator's assigned_hub_id (if different)
--   2. Set the new operator's assigned_hub_id to this hub
--   3. Link staff_user_id on the hub row
--
-- Pass p_new_user_id = NULL to unassign (clears both sides).
-- Pass p_old_user_id = NULL on first assignment or when no prior operator.
--
-- Run once in Supabase SQL editor.

CREATE OR REPLACE FUNCTION assign_hub_operator(
  p_hub_id       BIGINT,
  p_new_user_id  UUID,
  p_old_user_id  UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Clear old operator's assignment if they're being replaced
  IF p_old_user_id IS NOT NULL
     AND (p_new_user_id IS NULL OR p_old_user_id <> p_new_user_id)
  THEN
    UPDATE profiles
      SET assigned_hub_id = NULL
      WHERE id = p_old_user_id
        AND assigned_hub_id = p_hub_id;
  END IF;

  -- 2. Set new operator's assignment
  IF p_new_user_id IS NOT NULL THEN
    UPDATE profiles
      SET assigned_hub_id = p_hub_id
      WHERE id = p_new_user_id;
  END IF;

  -- 3. Link on the hub side too
  UPDATE delivery_hubs
    SET staff_user_id = p_new_user_id
    WHERE id = p_hub_id;
END;
$$;

-- Admins call this via PostgREST — grant execute.
GRANT EXECUTE ON FUNCTION assign_hub_operator(BIGINT, UUID, UUID) TO authenticated;
