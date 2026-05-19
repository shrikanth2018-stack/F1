-- ============================================================
-- 1stOne F1 — Dispatch backfill tool (audit O2)
-- Applied to live DB 2026-05-19.
--
-- When subscription dispatch breaks (e.g. the C1 outage), there is no
-- clean way to catch up the days that were missed. This RPC runs
-- generate_daily_manifest once per date across a range.
--
-- Safe to re-run: generate_daily_manifest is idempotent — it skips any
-- (subscription, dispatch_date) that already has an order — so an
-- already-dispatched date in the range is a no-op.
--
-- Admin-only (is_admin() reads the caller's JWT role claim). Capped at
-- 31 days per call to bound an accidental wide range.
-- ============================================================

CREATE OR REPLACE FUNCTION public.backfill_dispatch_manifest(
  p_start_date DATE,
  p_end_date   DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_d             DATE;
  v_total_created INTEGER := 0;
  v_days          INTEGER := 0;
  v_result        JSONB;
  v_per_day       JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;
  IF p_end_date - p_start_date > 31 THEN
    RAISE EXCEPTION 'Range too wide — backfill at most 31 days per call';
  END IF;

  v_d := p_start_date;
  WHILE v_d <= p_end_date LOOP
    -- generate_daily_manifest is idempotent — re-running a date that
    -- already dispatched is a harmless no-op.
    v_result := public.generate_daily_manifest(v_d, NULL);
    v_total_created := v_total_created + COALESCE((v_result->>'orders_created')::int, 0);
    v_per_day := v_per_day || jsonb_build_object(
      'date',           v_d,
      'orders_created', COALESCE((v_result->>'orders_created')::int, 0)
    );
    v_days := v_days + 1;
    v_d := v_d + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'days_processed',       v_days,
    'total_orders_created', v_total_created,
    'per_day',              v_per_day
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_dispatch_manifest(date, date) TO authenticated;
