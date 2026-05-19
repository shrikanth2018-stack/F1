-- ============================================================
-- 1stOne F1 — Job-health surface RPC (audit O1)
-- Applied to live DB 2026-05-19.
--
-- D3 added cron-failure ALERTING (an admin push when a job fails).
-- O1 adds the matching SURFACE: an admin can open a screen and see, at
-- a glance, whether every background job is running and succeeding —
-- instead of only finding out via a push (or, as with the C1 outage,
-- not finding out at all).
--
-- get_job_health() returns, in one admin-gated call:
--   jobs       — every pg_cron job: schedule, last run, last status,
--                failure count over the last 24h, truncated last message.
--   manifest   — the most recent subscription-dispatch manifest runs.
--   push_24h   — push_logs delivery outcomes over the last 24h.
--
-- cron.* lives in the `cron` schema (not exposed via PostgREST), and
-- manifest_run_log / push_logs each sit behind different RLS roles — so
-- a single SECURITY DEFINER RPC, is_admin()-gated, is the one clean way
-- for the admin client to read all three together.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_job_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $$
DECLARE
  v_jobs     jsonb;
  v_manifest jsonb;
  v_push     jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Per cron job: latest run (ordered by runid — monotonic, PK-indexed)
  -- and the failure count inside the last 24h.
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'jobname'), '[]'::jsonb)
  INTO v_jobs
  FROM (
    SELECT jsonb_build_object(
      'jobname',      j.jobname,
      'schedule',     j.schedule,
      'active',       j.active,
      'last_run',     lr.start_time,
      'last_status',  lr.status,
      'last_message', left(lr.return_message, 200),
      'failures_24h', coalesce(f.cnt, 0)
    ) AS x
    FROM cron.job j
    LEFT JOIN LATERAL (
      SELECT status, start_time, return_message
      FROM cron.job_run_details d
      WHERE d.jobid = j.jobid
      ORDER BY d.runid DESC
      LIMIT 1
    ) lr ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS cnt
      FROM cron.job_run_details d
      WHERE d.jobid = j.jobid
        AND d.status = 'failed'
        AND d.start_time > now() - interval '24 hours'
    ) f ON true
  ) sub;

  -- Most recent dispatch manifest runs.
  SELECT coalesce(jsonb_agg(m ORDER BY m->>'ran_at' DESC), '[]'::jsonb)
  INTO v_manifest
  FROM (
    SELECT jsonb_build_object(
      'run_date',       run_date,
      'ran_at',         ran_at,
      'orders_created', orders_created,
      'orders_skipped', orders_skipped,
      'subs_skipped',   subs_skipped,
      'error_detail',   error_detail
    ) AS m
    FROM manifest_run_log
    ORDER BY ran_at DESC
    LIMIT 7
  ) sub;

  -- Push delivery outcomes over the last 24h, keyed by status.
  SELECT coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
  INTO v_push
  FROM (
    SELECT status, count(*) AS cnt
    FROM push_logs
    WHERE sent_at > now() - interval '24 hours'
    GROUP BY status
  ) sub;

  RETURN jsonb_build_object(
    'jobs',       v_jobs,
    'manifest',   v_manifest,
    'push_24h',   v_push,
    'checked_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_job_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_job_health() TO authenticated;
