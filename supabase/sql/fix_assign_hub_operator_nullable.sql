-- ═══════════════════════════════════════════════════════════════════
-- 1stOne F1 — Make assign_hub_operator params nullable (2026-04-25)
--
-- Issue: function body already accepts NULL for p_new_user_id (used to
-- unassign) and p_old_user_id (used on first-time assign). But the
-- function signature lacks DEFAULT NULL, so Supabase's TS generator
-- types these params as `string` (non-null), forcing `as any` casts.
--
-- Fix: add DEFAULT NULL. Behavior unchanged; types regenerate as nullable.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION assign_hub_operator(
  p_hub_id       BIGINT,
  p_new_user_id  UUID DEFAULT NULL,
  p_old_user_id  UUID DEFAULT NULL
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

GRANT EXECUTE ON FUNCTION assign_hub_operator(BIGINT, UUID, UUID) TO authenticated;
