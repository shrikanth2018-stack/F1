-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Atomic supply-batch print (health report #19)
--
-- Printing a stock batch was a two-step client sequence: insert the
-- supply_batches snapshot, THEN stamp batch_id onto the active items. A
-- crash between the steps left a frozen snapshot while the items stayed
-- on the active list — the next print would order them twice.
--
-- This RPC does both in one transaction, and builds the snapshot
-- server-side from the live rows (the client sends only item ids).
--
-- Deploy: paste into Supabase SQL editor. Idempotent.
-- App coupling: run BEFORE the OTA that switches usePrintBatch to this
-- RPC (an app calling a missing RPC errors cleanly; old apps unaffected).
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.print_supply_batch_atomic(
  p_item_ids INTEGER[],
  p_branch_id INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot JSONB;
  v_count INTEGER;
  v_batch_id BIGINT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can print a supply batch';
  END IF;
  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Order list is empty.';
  END IF;

  -- Snapshot from the LIVE rows (unbatched only) — server-authoritative.
  SELECT jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'category', category)),
         COUNT(*)
  INTO v_snapshot, v_count
  FROM supply_order_items
  WHERE id = ANY(p_item_ids) AND batch_id IS NULL;

  IF COALESCE(v_count, 0) = 0 THEN
    RAISE EXCEPTION 'Nothing to print — the selected items are already batched.';
  END IF;

  INSERT INTO supply_batches (printed_at, printed_by, items_snapshot, note, branch_id)
  VALUES (NOW(), auth.uid(), v_snapshot, NULL, p_branch_id)
  RETURNING id INTO v_batch_id;

  UPDATE supply_order_items
  SET batch_id = v_batch_id
  WHERE id = ANY(p_item_ids) AND batch_id IS NULL;

  RETURN jsonb_build_object('batch_id', v_batch_id, 'items', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.print_supply_batch_atomic(INTEGER[], INTEGER) TO authenticated;
