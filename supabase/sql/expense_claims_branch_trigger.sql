-- 1stOne F1 — Auto-derive branch_id on expense_claims rows.
--
-- The staff Expenses screen inserts into expense_claims with only
-- (staff_id, category, description, amount, status), so branch_id lands
-- null on every claim. Reports that branch-slice expense activity
-- can't work cleanly with the gap.
--
-- Same shape as the cancelled_subscription_days trigger: BEFORE INSERT,
-- derive from the staff's profile, leave the client untouched.

CREATE OR REPLACE FUNCTION public.set_expense_claim_branch_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    SELECT branch_id INTO NEW.branch_id
    FROM profiles
    WHERE id = NEW.staff_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expense_claim_branch_id ON public.expense_claims;
CREATE TRIGGER trg_expense_claim_branch_id
  BEFORE INSERT ON public.expense_claims
  FOR EACH ROW EXECUTE FUNCTION public.set_expense_claim_branch_id();

-- Backfill: existing rows with null branch_id get derived from the staff's
-- current profile branch. Safe — branch_id is a denormalized reporting
-- column with no FK action depending on its previous null value.
UPDATE public.expense_claims c
SET branch_id = p.branch_id
FROM public.profiles p
WHERE c.staff_id = p.id
  AND c.branch_id IS NULL
  AND p.branch_id IS NOT NULL;
