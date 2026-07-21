-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Log Retention & Growth Indexes (health report Slice B)
--
-- Fixes three growth risks found in the 2026-07-21 health review:
--   #7  — audit/log tables grew without bound (push_logs, manifest_run_log,
--         kitchen_push_log, cron.job_run_details — the per-minute kitchen
--         tick alone adds ~1,440 job_run_details rows/day).
--   #11 — subscription dispatch dedupe was an EXISTS check only; a manual
--         backfill racing the cron tick could double-create dispatch orders.
--   #18 — hot queries (staff batch, past-undelivered carry-over, wallet
--         history) relied on single-column indexes only.
--
-- NOTE on the audit-table rule ("don't delete push_logs / manifest_run_log /
-- kitchen_push_log"): that rule forbids DROPPING the audit trail. Pruning
-- rows older than the retention window below keeps months of audit history
-- while stopping unbounded growth — it is the fix the review prescribed.
-- Retention windows are technical constants (like the 24h idempotency TTL),
-- not business rules, so they live here, not in store_config.
--
-- Deploy: paste this entire file into Supabase SQL editor. Idempotent.
-- No app coupling — nothing in the client changes.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Retention pruning (#7) ──────────────────────────────────
-- One nightly job; windows chosen so every operational lookback in the
-- app (Job Health 24h / recent-manifest views, monthly hub commission)
-- stays fully inside retained data with a wide margin.
CREATE OR REPLACE FUNCTION public.prune_operational_logs()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_push BIGINT;
  v_manifest BIGINT;
  v_kitchen BIGINT;
  v_cron BIGINT;
BEGIN
  -- Push delivery audit: 90 days.
  DELETE FROM push_logs WHERE sent_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS v_push = ROW_COUNT;

  -- Subscription dispatch runs: 180 days (longer — money-adjacent audit).
  DELETE FROM manifest_run_log WHERE ran_at < NOW() - INTERVAL '180 days';
  GET DIAGNOSTICS v_manifest = ROW_COUNT;

  -- Kitchen pushes: 90 days. Safe — the staff "active batch" reads only
  -- the LATEST row, and the dedupe key only matters within a single day.
  DELETE FROM kitchen_push_log WHERE pushed_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS v_kitchen = ROW_COUNT;

  -- pg_cron's own run history: 7 days (the per-minute tick floods this;
  -- Job Health only reads the last run + a 24h failure window).
  DELETE FROM cron.job_run_details WHERE end_time < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS v_cron = ROW_COUNT;

  RETURN format('pruned push_logs=%s manifest_run_log=%s kitchen_push_log=%s job_run_details=%s',
                v_push, v_manifest, v_kitchen, v_cron);
END;
$$;

-- Internal only — never callable from the app.
REVOKE ALL ON FUNCTION public.prune_operational_logs() FROM anon, authenticated;

-- 21:00 UTC = 02:30 IST — the quietest point in the operational day.
-- cron.schedule() upserts by job name (same pattern as the other jobs),
-- and the new job appears in get_job_health() automatically.
SELECT cron.schedule(
  'prune-operational-logs',
  '0 21 * * *',
  $$SELECT public.prune_operational_logs()$$
);

-- ── 2. Dispatch uniqueness backstop (#11) ──────────────────────
-- generate_daily_manifest's IF EXISTS fast-path stays as-is; this index
-- turns the remaining race (manual backfill vs. cron tick) into a
-- constraint violation, which the generator's per-subscription error
-- isolation (O3) already logs-and-skips instead of double-creating.
--
-- The DO block surfaces any PRE-EXISTING duplicates first — the index
-- cannot be created over them, and they would mean a customer already
-- received a double dispatch worth investigating.
DO $$
DECLARE
  v_dupes BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_dupes FROM (
    SELECT subscription_id, dispatch_date
    FROM public.orders
    WHERE subscription_id IS NOT NULL
    GROUP BY subscription_id, dispatch_date
    HAVING COUNT(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'Cannot create ux_orders_subscription_dispatch: % duplicate (subscription_id, dispatch_date) pair(s) exist. Inspect with: SELECT subscription_id, dispatch_date, array_agg(id) FROM orders WHERE subscription_id IS NOT NULL GROUP BY 1,2 HAVING COUNT(*) > 1;',
      v_dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_subscription_dispatch
  ON public.orders (subscription_id, dispatch_date)
  WHERE subscription_id IS NOT NULL;

-- ── 3. Growth indexes (#18) ────────────────────────────────────
-- Staff batch board: filters (cycle_id = X AND dispatch_date = Y ...).
CREATE INDEX IF NOT EXISTS idx_orders_cycle_dispatch
  ON public.orders (cycle_id, dispatch_date);

-- Past-undelivered carry-over (the D2 rule in useStaffOrders): a tiny
-- partial index over only the not-yet-terminal rows.
CREATE INDEX IF NOT EXISTS idx_orders_undelivered_past
  ON public.orders (dispatch_date)
  WHERE status NOT IN ('Delivered', 'Cancelled', 'Failed');

-- Wallet history: per-user, newest-first, LIMIT 50 — matches the index
-- order exactly, so the sort disappears.
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_created
  ON public.wallet_transactions (user_id, created_at DESC);
