-- ─────────────────────────────────────────────────────────────
-- 1stOne F1 — MF-03 Commit 5: cleanup + test persona
--
-- 1. Drop the dead-duplicate `store_config.branch_management_active`
--    column. Client code only reads `feature_flags.branch_management_active`
--    (verified across the codebase). Per audit: "Cleanup post-V-06: drop
--    store_config column or remove from selects."
--
-- 2. Promote phone `888` (`918888888888`) to branch-1 admin so we have
--    both personas live for the cross-branch isolation smoke test:
--      - `777` (`917777777777`) — existing super-admin (branch_id IS NULL).
--      - `888` (`918888888888`) — new branch-1 admin (branch_id = 1).
--    Once branch 2 exists, a third persona (e.g. `999` as branch-2 admin)
--    closes the isolation matrix.
--
-- Prerequisite for the UPDATE in section 2: the auth.users row + stub
-- profile for phone `918888888888` must exist. Sign in as `888` via
-- OTP (`123456`) once before deploying — handle_new_user creates the
-- stub profile (role='customer', branch_id=NULL); this UPDATE flips
-- the role and branch.
--
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Drop store_config.branch_management_active dead duplicate ────
ALTER TABLE public.store_config
  DROP COLUMN IF EXISTS branch_management_active;

-- ── 2. Promote `888` to branch-1 admin ──────────────────────────────
UPDATE public.profiles
   SET role = 'admin',
       branch_id = 1,
       updated_at = NOW()
 WHERE phone_number = '918888888888';

-- ── Verification — should return one row with role='admin', branch_id=1
-- after the prerequisite OTP sign-in + this migration. Returns zero
-- rows if 888 hasn't signed in yet (no-op UPDATE above).
SELECT phone_number, role, branch_id
  FROM public.profiles
 WHERE phone_number IN ('917777777777', '918888888888')
 ORDER BY phone_number;
