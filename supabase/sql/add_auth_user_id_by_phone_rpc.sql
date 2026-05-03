-- ─────────────────────────────────────────────────────────────
-- auth_user_id_by_phone — SECURITY DEFINER lookup helper
--
-- The auth.users table is not exposed via PostgREST (Supabase
-- intentionally hides the `auth` schema; queries through
-- `.schema('auth').from('users')` return PGRST106 "Invalid schema").
-- Edge Functions that need to find a user by phone go through this
-- RPC, which runs as the function owner with full access to
-- auth.users and returns only the UUID.
--
-- Used by: supabase/functions/elevate-employee (admin staff
-- elevation flow, BF-05b 2026-05-03). May be reused by future Edge
-- Functions that need the same lookup.
--
-- Idempotent (CREATE OR REPLACE + REVOKE/GRANT). Safe to re-run.
-- Run in Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.auth_user_id_by_phone(p_phone TEXT)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT id FROM auth.users WHERE phone = p_phone LIMIT 1;
$$;

-- Lock down execute privileges. The Edge Function uses the service
-- role key, so service_role is the only grantee. Anon and authenticated
-- roles must NOT be able to call this — it would leak auth.users IDs
-- by phone enumeration otherwise.
REVOKE ALL ON FUNCTION public.auth_user_id_by_phone(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_id_by_phone(TEXT) TO service_role;
