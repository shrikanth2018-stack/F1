-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — is_super_admin() recurses into itself and crashes
-- (2026-08-06)
--
-- `is_super_admin()` is SECURITY INVOKER, and its fallback reads
-- `profiles`. That read is gated by `profiles_self_read`, whose USING clause
-- calls `has_branch_access()`, which calls `is_super_admin()` — which reads
-- `profiles` again. Round and round until Postgres kills the query.
--
--   SQL function "is_super_admin"   statement 1
--   SQL function "has_branch_access" statement 1
--   SQL function "is_super_admin"   statement 1
--   … ERROR 54001: stack depth limit exceeded
--
-- The fallback exists precisely FOR the case that triggers it. FT-05's own
-- comment says the SQL function "reads the column directly as a fallback so
-- server-side gating doesn't break" for tokens issued before the claim
-- existed. In that exact scenario it does not fall back — it crashes.
--
-- HOW REACHABLE IS IT, honestly. Not very, today. `custom_access_token_hook`
-- always emits `is_super_admin` (COALESCE'd to FALSE), so a live token
-- carries it, and access tokens from before FT-05 expired months ago. It also
-- needs `user_role` PRESENT and `is_super_admin` ABSENT together, because
-- `profiles_self_read` short-circuits at `is_staff_or_admin()` for a
-- customer — so the documented customer-impersonation recipe never hits it.
--
-- It is fixed anyway, for three reasons. The failure mode is a hard crash
-- across ~95 has_branch_access call sites rather than a wrong answer. It
-- fires exactly when the safety net is supposed to catch you. And the
-- project's own staff/admin impersonation recipe reproduces it, which means
-- the next person verifying an RLS rule as a staff user meets a stack-depth
-- error and reasonably concludes something is deeply broken.
--
-- THE FIX is one word: SECURITY DEFINER, so the profiles read runs as the
-- function owner and is not re-gated by the policy that calls back into it.
-- It leaks nothing — the query is `WHERE id = auth.uid()` and returns a
-- boolean about the caller themselves.
--
-- `has_branch_access()` stays INVOKER: it also reads a table
-- (`feature_flags`), but that table's read policy is USING (true), so there
-- is no second cycle. Checked, not assumed.
--
-- Deploy: supabase db query --linked --file supabase/sql/is_super_admin_recursion.sql
-- Idempotent. Safe to re-run. Rollback at the bottom.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT COALESCE(
    NULLIF(auth.jwt() ->> 'is_super_admin', '')::BOOLEAN,
    (SELECT is_super_admin FROM public.profiles WHERE id = auth.uid()),
    FALSE
  );
$function$;

-- Callable by the roles whose policies invoke it. Not anon: every policy that
-- reaches it is on a table an anonymous caller has no business reading, and
-- the definer-sweep in lock_down_definer_functions.sql exists to keep that
-- true for new functions too.
REVOKE ALL   ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ── Verification ───────────────────────────────────────────────
-- The claim-less staff token must now RESOLVE instead of crashing:
--
--   BEGIN;
--     SELECT set_config('request.jwt.claims', json_build_object(
--       'sub','<a staff uuid>','role','authenticated',
--       'user_role','staff','branch_id','1')::text, true);   -- no is_super_admin
--     SET LOCAL ROLE authenticated;
--     SELECT public.has_branch_access(1);   -- expect: t   (was: 54001 crash)
--   ROLLBACK;

-- ── Rollback ───────────────────────────────────────────────────
-- Restores the crash. There is no reason to.
-- CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
-- LANGUAGE sql STABLE AS $$ SELECT COALESCE(
--   NULLIF(auth.jwt() ->> 'is_super_admin','')::BOOLEAN,
--   (SELECT is_super_admin FROM public.profiles WHERE id = auth.uid()), FALSE) $$;
