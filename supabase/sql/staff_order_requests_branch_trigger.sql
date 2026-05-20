-- 1stOne F1 — Auto-derive branch_id on staff_order_requests + backfill.
--
-- OrderFormModal (staff) inserts into staff_order_requests without
-- branch_id, leaving the column NULL. The mirror trigger
-- (staff_order_requests_mirror) then passes that NULL through to
-- supply_order_items via add_or_merge_supply_order_item. Admin's
-- Stock Manager applies a branch filter (.eq('branch_id', N)) and
-- silently excludes every staff-submitted row — staff orders never
-- surface for admin.
--
-- Same shape as expense_claims + cancelled_subscription_days fixes:
-- BEFORE INSERT trigger derives branch_id from the staff's profile
-- when NULL. The mirror trigger runs AFTER INSERT, so by then
-- NEW.branch_id already carries the derived value and supply_order_items
-- inherits it correctly.

CREATE OR REPLACE FUNCTION public.set_staff_order_request_branch_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    SELECT branch_id INTO NEW.branch_id
    FROM profiles
    WHERE id = NEW.submitted_by;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staff_order_request_branch_id ON public.staff_order_requests;
CREATE TRIGGER trg_staff_order_request_branch_id
  BEFORE INSERT ON public.staff_order_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_staff_order_request_branch_id();

-- Backfill staff_order_requests from the submitter's profile.
UPDATE public.staff_order_requests sr
SET branch_id = p.branch_id
FROM public.profiles p
WHERE sr.submitted_by = p.id
  AND sr.branch_id IS NULL
  AND p.branch_id IS NOT NULL;

-- Backfill supply_order_items that the mirror trigger created without
-- a branch_id (request_id links them to the now-backfilled request).
-- Admin-added rows (request_id NULL) stay null — those were inserted
-- via the admin Add Item form which has its own branch handling.
UPDATE public.supply_order_items soi
SET branch_id = sr.branch_id
FROM public.staff_order_requests sr
WHERE soi.request_id = sr.id
  AND soi.branch_id IS NULL
  AND sr.branch_id IS NOT NULL;
