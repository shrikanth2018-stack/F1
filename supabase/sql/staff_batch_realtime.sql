-- ============================================================
-- 1stOne F1 — Staff batch realtime
-- Applied to live DB 2026-05-18.
--
-- The staff operational screens flip to the next cycle's batch the
-- moment that cycle is pushed (a new kitchen_push_log row). For the
-- client to react instantly, kitchen_push_log must emit Realtime events
-- and every staff/hub/driver user must be able to SELECT it (Realtime
-- enforces RLS per subscriber).
--
-- 1. Add kitchen_push_log to the supabase_realtime publication.
-- 2. Let drivers read kitchen_push_log — the existing policies cover
--    staff/admin only; drivers are customer-role users identified by
--    membership in delivery_hubs/delivery_zones. Additive policy,
--    OR'd with the existing ones, so nothing existing changes.
-- ============================================================

-- 1. Realtime publication ------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'kitchen_push_log'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE kitchen_push_log;
  END IF;
END $$;

-- 2. Driver read access --------------------------------------------------
DROP POLICY IF EXISTS kitchen_push_log_driver ON kitchen_push_log;
CREATE POLICY kitchen_push_log_driver ON kitchen_push_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM delivery_hubs  h WHERE h.driver_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM delivery_zones z WHERE z.driver_user_id = auth.uid())
  );
