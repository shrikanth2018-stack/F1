-- 1stOne F1 — Auto-derive branch_id on cancelled_subscription_days rows.
--
-- The client-side useSkipDay() mutation in src/hooks/useSubscriptions.ts
-- inserts directly into cancelled_subscription_days with only
-- (subscription_id, cancelled_date, cycle_id, reason). It doesn't pass
-- branch_id, so the column lands null on every skip row — which breaks any
-- future report that wants to branch-slice "skipped days this month".
--
-- A BEFORE INSERT trigger keeps the source of truth where it belongs
-- (the parent user_subscriptions row) without trusting clients to pass it.

CREATE OR REPLACE FUNCTION public.set_cancelled_day_branch_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    SELECT branch_id INTO NEW.branch_id
    FROM user_subscriptions
    WHERE id = NEW.subscription_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancelled_day_branch_id ON public.cancelled_subscription_days;
CREATE TRIGGER trg_cancelled_day_branch_id
  BEFORE INSERT ON public.cancelled_subscription_days
  FOR EACH ROW EXECUTE FUNCTION public.set_cancelled_day_branch_id();

-- Backfill: existing rows with null branch_id get derived from their
-- parent subscription (safe — branch_id is just a denormalized reporting
-- column; no FK action depends on its previous null value).
UPDATE public.cancelled_subscription_days c
SET branch_id = us.branch_id
FROM public.user_subscriptions us
WHERE c.subscription_id = us.id
  AND c.branch_id IS NULL
  AND us.branch_id IS NOT NULL;
