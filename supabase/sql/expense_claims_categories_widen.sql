-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — expense_claims: widen the allowed categories
--
-- THE BUG. `expense_claims_category_check` still lists only the five
-- original staff-expense categories:
--
--     Grocery, Vegetable, Stationery, Fuel, Expense
--
-- Three write paths have since been added that insert a category the
-- constraint rejects, so every one of them fails at INSERT:
--
--   'Others'          StaffExpensesScreen offers it (CATEGORIES, :30-37) and
--                     useExpenses types it, but the DB never allowed it —
--                     the original fifth value is 'Expense', not 'Others'.
--   'Hub Commission'  hub_commission_claims.sql:171 — the hub operator's
--                     monthly commission claim.
--   'Vendor Payout'   vendors_portal.sql:114 — a vendor releasing their
--                     wallet balance.
--
-- Neither hub_commission_claims.sql nor vendors_portal.sql ever altered the
-- constraint, so both features have been dead on arrival since they shipped.
-- Verified against the live database 2026-07-30: the constraint is still the
-- original five, and the only rows present are 'Grocery'.
--
-- 'Expense' is KEPT even though nothing writes it any more — dropping a value
-- that legacy rows might carry would turn this from additive into breaking.
--
-- Deploy: paste into the Supabase SQL editor. Idempotent.
-- Rollback: re-add the constraint with the original five values.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.expense_claims
  DROP CONSTRAINT IF EXISTS expense_claims_category_check;

ALTER TABLE public.expense_claims
  ADD CONSTRAINT expense_claims_category_check
  CHECK (category IN (
    -- Staff expense claims
    'Grocery', 'Vegetable', 'Stationery', 'Fuel', 'Others',
    -- Legacy value: kept so any pre-existing row stays valid
    'Expense',
    -- Hub operator's monthly commission (hub_commission_claims.sql)
    'Hub Commission',
    -- Vendor releasing their wallet balance (vendors_portal.sql)
    'Vendor Payout'
  ));

COMMENT ON CONSTRAINT expense_claims_category_check ON public.expense_claims IS
  'Staff expense categories plus the two claim types that ride the same Pending → Approved → Paid flow. Add a value here BEFORE shipping any new claim category — three features previously shipped without it and failed silently at insert.';

NOTIFY pgrst, 'reload schema';
