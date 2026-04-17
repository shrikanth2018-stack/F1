-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Custom Access Token Hook
--
-- Injects `user_role`, `assigned_hub_id`, `branch_id` into every issued
-- JWT, so the client (useAuth.ts:31) and RLS policies can rely on them.
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
STABLE
AS $$
DECLARE
  v_claims           JSONB;
  v_user_id          UUID;
  v_role             TEXT;
  v_assigned_hub_id  INTEGER;
  v_branch_id        INTEGER;
BEGIN
  v_claims  := event->'claims';
  v_user_id := (event->>'user_id')::UUID;

  -- Read the profile row
  SELECT role, assigned_hub_id, branch_id
  INTO v_role, v_assigned_hub_id, v_branch_id
  FROM public.profiles
  WHERE id = v_user_id;

  -- Default if no profile yet (e.g. first sign-up before trigger runs)
  v_role := COALESCE(v_role, 'customer');

  v_claims := v_claims
    || jsonb_build_object('user_role',       v_role)
    || jsonb_build_object('assigned_hub_id', v_assigned_hub_id)
    || jsonb_build_object('branch_id',       v_branch_id);

  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;

-- Supabase Auth executes hooks as the `supabase_auth_admin` role.
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB)
  TO supabase_auth_admin;

GRANT SELECT ON public.profiles TO supabase_auth_admin;
