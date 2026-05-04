-- ─────────────────────────────────────────────────────────────
-- BF-17: Stock Manager simplification — mirror trigger + merge RPC
--
-- Solution D replaces the 3-tab Pending → Active → Printed model
-- with a 2-tab unified view (Current Order + History). The explicit
-- Approve/Reject workflow is gone; admin's edits in the unified view
-- ARE the approval. Print = finalize.
--
-- Two pieces in this file:
--
-- 1. add_or_merge_supply_order_item — shared RPC used by both staff
--    submissions (via the trigger below) and admin's Add Item form.
--    Looks for an existing active row with the same category + name
--    + branch_id; if found, increments its qty. Otherwise inserts new.
--    Single source of truth for merge semantics.
--
-- 2. mirror_staff_request_to_supply_items — AFTER INSERT trigger on
--    staff_order_requests. Iterates over NEW.items and calls the merge
--    RPC for each. Then UPDATEs the row's status to 'Approved'.
--    AFTER INSERT (not BEFORE) so the FK constraint
--    supply_order_items.request_id → staff_order_requests(id) validates
--    against the now-committed row.
--
-- Idempotent: CREATE OR REPLACE on functions, DROP TRIGGER IF EXISTS
-- before recreating. Safe to re-run.
--
-- Run in Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────

-- 1. Shared merge RPC ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.add_or_merge_supply_order_item(
  p_name TEXT,
  p_qty INTEGER,
  p_category TEXT,
  p_request_id BIGINT,
  p_added_by UUID,
  p_branch_id INTEGER
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id BIGINT;
  v_trimmed TEXT;
BEGIN
  v_trimmed := trim(COALESCE(p_name, ''));
  IF length(v_trimmed) = 0 THEN
    RAISE EXCEPTION 'name required';
  END IF;
  IF p_qty IS NULL OR p_qty < 1 THEN
    RAISE EXCEPTION 'qty must be >= 1';
  END IF;
  IF p_category NOT IN ('Vegetables', 'Grocery', 'Stationery') THEN
    RAISE EXCEPTION 'invalid category: %', p_category;
  END IF;

  -- Look for an existing active row with same category + name (case-
  -- insensitive, trimmed) + branch (NULL-safe match). batch_id IS NULL
  -- means "still in the current order list" (not yet printed).
  SELECT id INTO v_existing_id
  FROM public.supply_order_items
  WHERE category = p_category
    AND lower(trim(name)) = lower(v_trimmed)
    AND batch_id IS NULL
    AND COALESCE(branch_id, 0) = COALESCE(p_branch_id, 0)
  ORDER BY id ASC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Merge: increment qty on the existing row
    UPDATE public.supply_order_items
    SET qty = qty + p_qty
    WHERE id = v_existing_id;
    RETURN v_existing_id;
  ELSE
    -- Insert new row
    INSERT INTO public.supply_order_items (
      name, qty, category, request_id, batch_id, added_by, branch_id
    ) VALUES (
      v_trimmed, p_qty, p_category, p_request_id, NULL, p_added_by, p_branch_id
    )
    RETURNING id INTO v_existing_id;
    RETURN v_existing_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.add_or_merge_supply_order_item(TEXT, INTEGER, TEXT, BIGINT, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_or_merge_supply_order_item(TEXT, INTEGER, TEXT, BIGINT, UUID, INTEGER) TO authenticated;

-- 2. Mirror trigger function ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.mirror_staff_request_to_supply_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
BEGIN
  IF NEW.status = 'Pending' THEN
    -- Mirror each item via the shared merge RPC. Existing rows with
    -- the same category+name+branch get qty incremented; new names
    -- get a fresh row.
    FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items)
    LOOP
      PERFORM public.add_or_merge_supply_order_item(
        v_item ->> 'name',
        (v_item ->> 'qty')::INTEGER,
        NEW.request_type,
        NEW.id,
        NEW.submitted_by,
        NEW.branch_id
      );
    END LOOP;

    -- Auto-flip status: the unified view IS the approval, so this row
    -- is implicitly Approved the moment it lands. UPDATE form (not
    -- NEW.status :=) because this is an AFTER INSERT trigger; the row
    -- is already committed.
    UPDATE public.staff_order_requests
    SET status = 'Approved',
        approved_by = COALESCE(approved_by, submitted_by)
    WHERE id = NEW.id;
  END IF;

  RETURN NULL;  -- AFTER triggers can return NULL safely
END;
$$;

-- 3. Bind trigger as AFTER INSERT ─────────────────────────────

DROP TRIGGER IF EXISTS staff_order_requests_mirror ON public.staff_order_requests;

CREATE TRIGGER staff_order_requests_mirror
  AFTER INSERT ON public.staff_order_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.mirror_staff_request_to_supply_items();

-- 4. Force PostgREST schema-cache reload ─────────────────────

NOTIFY pgrst, 'reload schema';
