-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Nine policies that check the role but never the branch
-- (2026-08-06)
--
-- `has_branch_access()` is the schema's standard second half of every
-- admin/staff policy, and these nine forgot it. They are inert today because
-- there is exactly one branch — and they stop being inert the moment someone
-- creates a second, which is an ordinary admin action on a screen that
-- already exists, not a schema change.
--
-- `branch_management_active` has been TRUE in production since 2026-05-12, so
-- the gate is already switched on. It simply has nothing to bite on yet.
--
-- CONFIRMED, rolled back: with a second branch inserted, a branch-1 admin
-- wrote a branch-999 supply_batches row. The control — the same session
-- attempting the same insert on business_expenses, which DOES call
-- has_branch_access — was refused with 42501. So the pattern works
-- everywhere it was applied, and these are simply where it was not.
--
-- TWO THINGS FOUND WHILE READING, neither in the audit:
--
--   staff_salary carries BOTH `salary_admin` (is_admin() alone) and
--   `salary_admin_all` (is_admin() AND has_branch_access). Permissive
--   policies are OR-ed, so the unscoped one DEFEATS the scoped one entirely —
--   someone added the branch-aware version and never dropped the old one.
--   Payroll is the last table where that should be true. `salary_admin` is
--   dropped rather than rewritten; `salary_admin_all` already says it right.
--
--   Most of these are `FOR ALL` with a NULL WITH CHECK, which Postgres fills
--   in from USING — the same shape as the 2026-08-04 client_write_gaps bug.
--   Each one below now states its WITH CHECK explicitly, so "rows I may read"
--   can never again silently mean "rows I may write".
--
-- NOT TOUCHED, deliberately:
--   supply_catalog          has no branch_id column at all. It is a shared
--                           lookup list (78 rows), and inventing a branch for
--                           it is a data-model decision, not a policy fix.
--   essentials_vendor_scope reads as unscoped and must stay that way. It is
--                           RESTRICTIVE, and its job is vendor-zone
--                           visibility, not branch scoping. Editing this
--                           policy is what took the whole vendor network
--                           offline in July 2026.
--
-- A NOTE ON NULL branch_id. has_branch_access(NULL) returns NULL, which a
-- policy reads as deny — so a row with no branch would become invisible to
-- everyone but a super-admin. Checked before writing: all five tables have
-- ZERO null-branch rows, and each is populated either by a branch_id trigger
-- or by requireWriteBranch() on the client. Left as a plain
-- has_branch_access() call to match every other policy in the schema rather
-- than COALESCE-ing it here and making this one the odd one out.
--
-- Deploy: supabase db query --linked --file supabase/sql/branch_scope_policies.sql
-- Idempotent. Safe to re-run. Rollback at the bottom.
-- ═══════════════════════════════════════════════════════════════


-- ── staff_salary — drop the policy that defeats the good one ───
DROP POLICY IF EXISTS salary_admin ON public.staff_salary;
-- salary_admin_all (is_admin AND has_branch_access, both sides) and
-- salary_self (staff_id = auth.uid() OR scoped admin) remain and are correct.


-- ── staff_order_requests ───────────────────────────────────────
DROP POLICY IF EXISTS staff_order_requests_admin ON public.staff_order_requests;
CREATE POLICY staff_order_requests_admin ON public.staff_order_requests
  FOR ALL
  USING      (public.is_admin() AND public.has_branch_access(branch_id))
  WITH CHECK (public.is_admin() AND public.has_branch_access(branch_id));

DROP POLICY IF EXISTS staff_order_requests_staff ON public.staff_order_requests;
CREATE POLICY staff_order_requests_staff ON public.staff_order_requests
  FOR SELECT
  USING (public.is_staff_or_admin() AND public.has_branch_access(branch_id));

-- Own request stays readable whatever the branch — it is theirs. Only the
-- admin half of the OR gains the branch test.
DROP POLICY IF EXISTS staff_order_requests_self_read ON public.staff_order_requests;
CREATE POLICY staff_order_requests_self_read ON public.staff_order_requests
  FOR SELECT
  USING (
    submitted_by = auth.uid()
    OR (public.is_admin() AND public.has_branch_access(branch_id))
  );


-- ── staff_shifts ───────────────────────────────────────────────
DROP POLICY IF EXISTS staff_shifts_admin ON public.staff_shifts;
CREATE POLICY staff_shifts_admin ON public.staff_shifts
  FOR ALL
  USING      (public.is_admin() AND public.has_branch_access(branch_id))
  WITH CHECK (public.is_admin() AND public.has_branch_access(branch_id));

DROP POLICY IF EXISTS staff_shifts_read ON public.staff_shifts;
CREATE POLICY staff_shifts_read ON public.staff_shifts
  FOR SELECT
  USING (public.is_staff_or_admin() AND public.has_branch_access(branch_id));


-- ── supply_batches ─────────────────────────────────────────────
DROP POLICY IF EXISTS supply_batches_admin ON public.supply_batches;
CREATE POLICY supply_batches_admin ON public.supply_batches
  FOR ALL
  USING      (public.is_admin() AND public.has_branch_access(branch_id))
  WITH CHECK (public.is_admin() AND public.has_branch_access(branch_id));

DROP POLICY IF EXISTS supply_batches_staff ON public.supply_batches;
CREATE POLICY supply_batches_staff ON public.supply_batches
  FOR ALL
  USING      (public.is_staff_or_admin() AND public.has_branch_access(branch_id))
  WITH CHECK (public.is_staff_or_admin() AND public.has_branch_access(branch_id));


-- ── supply_order_items ─────────────────────────────────────────
DROP POLICY IF EXISTS supply_order_items_admin ON public.supply_order_items;
CREATE POLICY supply_order_items_admin ON public.supply_order_items
  FOR ALL
  USING      (public.is_admin() AND public.has_branch_access(branch_id))
  WITH CHECK (public.is_admin() AND public.has_branch_access(branch_id));

DROP POLICY IF EXISTS supply_order_items_staff ON public.supply_order_items;
CREATE POLICY supply_order_items_staff ON public.supply_order_items
  FOR ALL
  USING      (public.is_staff_or_admin() AND public.has_branch_access(branch_id))
  WITH CHECK (public.is_staff_or_admin() AND public.has_branch_access(branch_id));

NOTIFY pgrst, 'reload schema';


-- ── Verification ───────────────────────────────────────────────
-- Nothing role-gated should remain branch-blind on a table that HAS a branch:
--
--   SELECT tablename, policyname FROM pg_policies p
--    WHERE schemaname='public'
--      AND qual ~ 'is_admin\(\)|is_staff_or_admin\(\)'
--      AND COALESCE(qual,'') !~ 'has_branch_access'
--      AND EXISTS (SELECT 1 FROM information_schema.columns c
--                  WHERE c.table_schema='public' AND c.table_name=p.tablename
--                    AND c.column_name='branch_id');
--   -- expect: only essentials_vendor_scope (see the header)
--
-- And the cross-branch write must now be refused where it succeeded before:
--
--   BEGIN;
--     INSERT INTO branches (id, branch_name) VALUES (999,'Audit Branch 2');
--     SELECT set_config('request.jwt.claims', json_build_object(
--       'sub','<branch-1 admin>','role','authenticated','user_role','admin',
--       'branch_id','1','is_super_admin',false)::text, true);
--     SET LOCAL ROLE authenticated;
--     INSERT INTO supply_batches (branch_id, items_snapshot, note)
--       VALUES (999,'[]'::jsonb,'x');      -- expect 42501
--   ROLLBACK;


-- ── Rollback ───────────────────────────────────────────────────
-- Restores the unscoped forms. Only if branch scoping turns out to break a
-- screen — and then fix the screen's branch resolution, not this.
-- CREATE POLICY salary_admin ON public.staff_salary FOR ALL USING (is_admin()) WITH CHECK (is_admin());
-- ...and re-run schema.sql's definitions for the other nine.
