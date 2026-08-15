-- ═══════════════════════════════════════════════════════════════════════
-- 1stOne F1 — a profile is never left without a branch  (2026-08-15)
--
-- THE BUG THIS CLOSES
--
-- Onboard Vendor, Onboard Employee and Create Order (Bulk / B2B) all look a
-- person up with a client-side read of `profiles` on phone_number. That read
-- goes through RLS, and `profiles_self_read` requires
-- `has_branch_access(branch_id)`, which is:
--
--     is_super_admin() OR NOT branch_management_active OR row.branch_id = jwt_branch_id()
--
-- With branch management ON, a row whose branch_id is NULL compares
-- `NULL = 1` → NULL → false. So a profile with no branch is invisible to
-- every admin except a super-admin, and all three screens report the person
-- as "not a registered user" — which is false. They are registered; they are
-- merely unreachable.
--
-- Verified 2026-08-15 by impersonating each admin (SET LOCAL ROLE authenticated
-- + request.jwt.claims), never as a superuser — a superuser bypasses RLS and
-- would have confirmed the policy works:
--
--     super-admin 7777 (super=true)   → sees 23 profiles, finds 8111111111
--     branch admin 8888 (branch=1)    → sees  8 profiles, finds nobody new
--     new admin    9111 (branch=NULL) → sees  1 profile — only themself
--
-- WHY THE BRANCH WAS MISSING
--
-- `profiles.branch_id` is nullable with no default, and only ONE path ever
-- filled it: `complete_onboarding_atomic`, the first-time customer sign-up
-- that derives the branch from the first address's zone. Every other way a
-- profile comes into existence left it NULL:
--
--   • `handle_new_user` — the trigger that creates the stub profile the
--     instant an OTP sign-up completes. Writes id + phone only.
--   • `admin-create-customer` — the admin "Add Customer" screen. Writes the
--     address (which a trigger stamps) but never the profile's own branch.
--   • bulk/manual creation, which is how the 14 test logins of 13 Aug 2026
--     were made.
--
-- So anyone who signed in and did not finish onboarding became invisible to
-- the back office — including the people the office most needs to find.
--
-- `profiles` is the ONLY table with this hole: every other branch-scoped
-- table reads 0 NULLs, because the ones that could drift already have a
-- trigger. `customer_addresses_branch_id_trigger.sql` is that trigger, and
-- this file is deliberately its twin.
--
-- WHY A TRIGGER AND NOT NOT NULL
--
-- NOT NULL is unavailable: the super-admin's branch_id is NULL ON PURPOSE and
-- must stay that way. `useBranchFilter` resolves `jwtBranchId ?? (isSuperAdmin
-- ? selectedBranchId : ...)`, so a JWT branch WINS over the branch picker —
-- give the super-admin a branch and their "Viewing Branch: All Branches"
-- selector silently stops working. RLS would still be fine (has_branch_access
-- checks is_super_admin first); the app would not.
--
-- A trigger also beats patching the four write paths one by one, which is
-- what the addresses table proved: it has zero NULLs because one trigger
-- covers every writer, including the ones nobody has written yet.
--
-- DRY-RUN THIS INSIDE BEGIN … ROLLBACK FIRST. There is one database; it is
-- development, preview and production at once.
--
-- Deploy: supabase db query --linked --file supabase/sql/profiles_branch_never_null.sql
-- Idempotent — re-running changes nothing.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Which branch does a row belong to when nothing says? ───────────
--
-- Active branches first, then lowest id. Returns NULL only when the branches
-- table is empty, which is a broken installation rather than a normal state —
-- so no hardcoded `1` fallback here, unlike complete_onboarding_atomic. A
-- literal branch id in code is a business value, and those live in the
-- database.
CREATE OR REPLACE FUNCTION public.default_branch_id()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.branches ORDER BY is_active DESC, id LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.default_branch_id() FROM PUBLIC, anon, authenticated;


-- ── 2. Stamp the branch on every profile write ────────────────────────
--
-- Prefers the branch the person's own address resolves to — that is the
-- honest answer once a second branch exists, and it matches how
-- complete_onboarding_atomic and useBranchFilter both decide a customer's
-- branch. Falls back to the default branch for someone who has no address
-- yet, which is exactly the state that caused this bug.
--
-- ONLY WHEN THE CALLER LEFT IT NULL. An explicit branch always wins, so
-- elevate_to_staff, complete_onboarding_atomic and the admin screens keep
-- deciding for themselves; this only fills a hole.
--
-- THE SUPER-ADMIN IS SKIPPED, DELIBERATELY. See the header: their NULL branch
-- is what keeps the branch selector working.
CREATE OR REPLACE FUNCTION public.derive_profile_branch_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS NULL AND COALESCE(NEW.is_super_admin, FALSE) = FALSE THEN
    NEW.branch_id := COALESCE(
      (SELECT a.branch_id
         FROM public.customer_addresses a
        WHERE a.user_id = NEW.id
          AND a.is_active
          AND a.branch_id IS NOT NULL
        ORDER BY a.is_default DESC, a.id
        LIMIT 1),
      public.default_branch_id()
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Named to sort AFTER `trg_profiles_updated`; multiple BEFORE triggers fire in
-- name order and neither touches what the other reads, so the order is
-- cosmetic — but a stated order is easier to reason about than an accident.
DROP TRIGGER IF EXISTS trg_profiles_branch_id ON public.profiles;
CREATE TRIGGER trg_profiles_branch_id
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.derive_profile_branch_id();


-- ── 3. Backfill the rows already stranded ─────────────────────────────
--
-- 15 rows carry no branch today: the 14 test logins created 13 Aug 2026, and
-- the super-admin — who is excluded and stays NULL.
--
-- Expected: 14 rows updated, all to branch 1. Read the report in §4; do not
-- trust the exit code.
UPDATE public.profiles p
SET branch_id = COALESCE(
      (SELECT a.branch_id
         FROM public.customer_addresses a
        WHERE a.user_id = p.id
          AND a.is_active
          AND a.branch_id IS NOT NULL
        ORDER BY a.is_default DESC, a.id
        LIMIT 1),
      public.default_branch_id()
    )
WHERE p.branch_id IS NULL
  AND COALESCE(p.is_super_admin, FALSE) = FALSE;


-- ── 4. Report — read this, do not trust the exit code ─────────────────

-- Every profile, by branch. After this runs there must be exactly ONE row
-- with branch_id NULL, and it must be the super-admin.
SELECT
  COALESCE(branch_id::TEXT, 'NO BRANCH') AS branch,
  role,
  COALESCE(is_super_admin, FALSE)        AS super_admin,
  count(*)                               AS profiles
FROM public.profiles
GROUP BY 1, 2, 3
ORDER BY 1, 2;

-- MUST return only the super-admin. Any other row here is still invisible to
-- the back office and the bug is not closed.
SELECT id, phone_number, full_name, role, is_super_admin
FROM public.profiles
WHERE branch_id IS NULL;

-- Assertions. These raise rather than print, so a failure cannot be read as a
-- pass by someone skimming the output.
--
-- NO SYNTHETIC ROW IS INSERTED as a probe. `profiles.id` is FK'd to
-- `auth.users`, so a made-up uuid cannot be written — the first draft of this
-- file tried and the dry run rejected it. Inserting a REAL auth user to prove
-- a trigger would be worse: this file is meant to be run standalone against
-- production, where a probe that writes is a probe that can be left behind.
-- The invariant below is the thing that actually matters, and it is checked
-- against every row that exists.
DO $$
DECLARE v_default BIGINT; v_stranded INT; v_trigger INT;
BEGIN
  SELECT public.default_branch_id() INTO v_default;
  IF v_default IS NULL THEN
    RAISE EXCEPTION 'FAILED — no branch exists for default_branch_id() to return';
  END IF;

  SELECT count(*) INTO v_trigger
  FROM pg_trigger
  WHERE tgrelid = 'public.profiles'::regclass
    AND tgname  = 'trg_profiles_branch_id'
    AND NOT tgisinternal;
  IF v_trigger <> 1 THEN
    RAISE EXCEPTION 'FAILED — trg_profiles_branch_id is not attached to profiles';
  END IF;

  SELECT count(*) INTO v_stranded
  FROM public.profiles
  WHERE branch_id IS NULL AND COALESCE(is_super_admin, FALSE) = FALSE;
  IF v_stranded > 0 THEN
    RAISE EXCEPTION 'FAILED — % profile(s) still have no branch', v_stranded;
  END IF;

  RAISE NOTICE 'OK — trigger attached, default branch %, every non-super-admin profile has a branch', v_default;
END $$;


-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK
--
--   DROP TRIGGER IF EXISTS trg_profiles_branch_id ON public.profiles;
--   DROP FUNCTION IF EXISTS public.derive_profile_branch_id();
--   DROP FUNCTION IF EXISTS public.default_branch_id();
--
-- The backfill is not reversible — every affected row was NULL and would go
-- back to NULL, but only if that is genuinely wanted:
--
--   UPDATE public.profiles SET branch_id = NULL
--   WHERE id IN (<the 14 ids listed by the report above>);
--
-- Take the id list from the report BEFORE applying, not after.
-- ═══════════════════════════════════════════════════════════════════════
