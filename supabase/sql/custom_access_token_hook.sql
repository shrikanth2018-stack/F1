-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Custom Access Token Hook
--
-- Injects custom claims into every issued JWT, so the client
-- (useAuth.ts:33) and RLS policies can rely on them:
--   - user_role          — from profiles.role (default 'customer')
--   - branch_id          — from profiles.branch_id
--   - assigned_hub_id    — from profiles.assigned_hub_id
--   - is_driver          — derived: true if this user appears in
--                          delivery_hubs.driver_user_id OR
--                          delivery_zones.driver_user_id
--
-- BF-37 (2026-05-11): tracked file rewritten to match the deployed
-- function. Earlier drift omitted is_driver + SECURITY DEFINER + the
-- search_path setting. MF-08-class drift; a DB rebuild from this file
-- would have lost is_driver and drivers would lose "My Deliveries".
--
-- Install (Supabase Dashboard → Authentication → Hooks → Add hook):
--   Type:    Custom Access Token (postgres function)
--   Schema:  public
--   Function: custom_access_token_hook
--
-- Or via SQL once deployed: no further action beyond this file — the
-- dashboard toggle is one-click after the function exists.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claims            JSONB;
  v_role            TEXT;
  v_branch_id       BIGINT;
  v_assigned_hub_id BIGINT;
  v_is_driver       BOOLEAN;
BEGIN
  -- Read the profile row
  SELECT role, branch_id, assigned_hub_id
    INTO v_role, v_branch_id, v_assigned_hub_id
  FROM public.profiles
  WHERE id = (event->>'user_id')::UUID;

  -- Derive is_driver from the delivery assignment tables. Membership
  -- in either delivery_hubs.driver_user_id or delivery_zones.driver_user_id
  -- gates the customer's "My Deliveries" entry (ProfilePopup) and the
  -- driver advance flow in nextDeliveryStatus.
  v_is_driver := EXISTS (
    SELECT 1 FROM public.delivery_hubs
    WHERE driver_user_id = (event->>'user_id')::UUID
  ) OR EXISTS (
    SELECT 1 FROM public.delivery_zones
    WHERE driver_user_id = (event->>'user_id')::UUID
  );

  claims := event->'claims';
  claims := claims || jsonb_build_object(
    'user_role',       COALESCE(v_role, 'customer'),
    'branch_id',       v_branch_id,
    'assigned_hub_id', v_assigned_hub_id,
    'is_driver',       v_is_driver
  );

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- Supabase Auth executes hooks as the `supabase_auth_admin` role.
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB)
  TO supabase_auth_admin;

GRANT SELECT ON public.profiles        TO supabase_auth_admin;
GRANT SELECT ON public.delivery_hubs   TO supabase_auth_admin;
GRANT SELECT ON public.delivery_zones  TO supabase_auth_admin;
