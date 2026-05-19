-- ============================================================
-- 1stOne F1 — Active staff batch
-- Applied to live DB 2026-05-18.
--
-- The staff operational screens (Kitchen / Packing / Hub / Driver) show
-- exactly ONE cycle's batch at a time — the batch released by the most
-- recent kitchen push. kitchen_push_log already records every push as
-- (cycle_id, push_date, pushed_at); this RPC returns the latest row so
-- the client can scope the staff order list to that single cycle.
--
-- When the next cycle pushes, a newer kitchen_push_log row appears, this
-- RPC returns the new cycle, and the previous cycle's orders fall out of
-- the staff query — the board flips, never clubbing two cycles.
--
-- SECURITY DEFINER: staff/hub/driver users have no direct read on
-- kitchen_push_log; this RPC is their only window into it, read-only.
-- branch-scoped so a second branch sees its own latest push.
-- ============================================================

CREATE OR REPLACE FUNCTION get_active_staff_batch(p_branch_id int DEFAULT NULL)
RETURNS TABLE (cycle_id int, push_date date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT kpl.cycle_id, kpl.push_date
  FROM kitchen_push_log kpl
  JOIN delivery_cycles dc ON dc.id = kpl.cycle_id
  WHERE p_branch_id IS NULL OR dc.branch_id = p_branch_id
  ORDER BY kpl.pushed_at DESC
  LIMIT 1;
$$;
