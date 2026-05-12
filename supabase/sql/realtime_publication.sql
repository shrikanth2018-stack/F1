-- ─────────────────────────────────────────────────────────────
-- Realtime publication membership (BF-44, 2026-05-12)
--
-- supabase_realtime publication was empty in prod — no postgres_changes
-- events fired on any table. useRealtimeOrders subscribers (StaffDashboard,
-- AdminHome, and now HubDashboardScreen / DriverDashboardScreen) couldn't
-- receive change events, so order-status changes never invalidated the
-- React Query cache; users had to pull-to-refresh.
--
-- Adds the orders table to the publication. Idempotent via the DO block
-- (ADD TABLE errors when the table is already in the publication).
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'orders'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.orders';
  END IF;
END $$;
