-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — External Heartbeat (health report #5)
--
-- Problem: every alert (refund failed, cron failed, …) rides ONE chain —
-- pg_cron → app_config service key → send-push → Expo → admin phone —
-- and the cron-failure alerter itself sits on that same chain. If the
-- chain breaks (bad key rotation, Expo outage, pg_cron down), the jobs
-- AND the alarm go silent together.
--
-- Fix: an OUTSIDE watcher. Every 5 minutes the DB pings healthchecks.io:
--   - jobs healthy            → ping <url>          (check stays "up")
--   - a job failed recently   → ping <url>/fail     (immediate alert)
--   - chain itself is dead    → NO ping arrives     (healthchecks.io
--                                alerts you by email after the grace period)
-- The alert path is now healthchecks.io's email/SMS — fully independent
-- of Supabase, Expo, and the service-role key.
--
-- ── One-time setup (owner) ─────────────────────────────────────
-- 1. healthchecks.io → Add Check. Name: "1stOne job clockwork".
--    Schedule: Period = 5 minutes, Grace = 10 minutes.
-- 2. Copy the check's ping URL (https://hc-ping.com/<uuid>) and store it:
--
--      INSERT INTO app_config (key, value)
--      VALUES ('healthchecks_ping_url', 'https://hc-ping.com/YOUR-UUID-HERE')
--      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--
-- 3. Run this file. Within ~5 minutes the check should turn green.
--
-- Deploy: paste into Supabase SQL editor. Idempotent.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.external_heartbeat()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_failures BIGINT;
BEGIN
  SELECT value INTO v_url FROM app_config WHERE key = 'healthchecks_ping_url';
  IF v_url IS NULL OR v_url = '' THEN
    -- Not configured yet — do nothing loudly. (No ping = healthchecks
    -- alerts anyway once the check is created, which is the safe default.)
    RAISE WARNING '[external_heartbeat] app_config.healthchecks_ping_url is not set';
    RETURN 'not_configured';
  END IF;

  -- Any cron failure in the last 10 minutes → signal /fail explicitly
  -- (immediate alert) instead of a healthy ping.
  SELECT COUNT(*) INTO v_failures
  FROM cron.job_run_details
  WHERE status = 'failed' AND end_time > NOW() - INTERVAL '10 minutes';

  IF v_failures > 0 THEN
    v_url := v_url || '/fail';
  END IF;

  PERFORM net.http_get(url := v_url, timeout_milliseconds := 8000);
  RETURN CASE WHEN v_failures > 0 THEN 'pinged_fail' ELSE 'pinged_ok' END;
END;
$$;

-- Internal only — never callable from the app.
REVOKE ALL ON FUNCTION public.external_heartbeat() FROM anon, authenticated;

-- Every 5 minutes. cron.schedule() upserts by job name; the job shows up
-- in get_job_health() automatically like every other cron.
SELECT cron.schedule(
  'external-heartbeat',
  '*/5 * * * *',
  $$SELECT public.external_heartbeat()$$
);
