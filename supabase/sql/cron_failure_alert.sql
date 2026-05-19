-- ============================================================
-- 1stOne F1 — Cron failure alerting (audit D3 / META)
-- Applied to live DB 2026-05-19.
--
-- The C1 outage (subscription dispatch + kitchen push down) ran
-- invisibly for ~2 days because NOTHING alerts on background-job
-- failure. This adds that missing signal.
--
-- alert_cron_failures() scans cron.job_run_details for any failed
-- run in the last 70 minutes and, if found, fires an admin push via
-- send-push. Scheduled hourly. A persistently-failing job nags once
-- an hour until fixed — deliberate; silence is what hid C1.
--
-- The push goes through send-push with the app_config service-role
-- key; send-push was updated (audit D5) to accept that key value.
-- ============================================================

CREATE OR REPLACE FUNCTION public.alert_cron_failures()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron', 'net'
AS $$
DECLARE
  v_count int;
  v_jobs  text;
  v_url   text;
  v_key   text;
BEGIN
  SELECT count(*), string_agg(DISTINCT j.jobname, ', ')
  INTO v_count, v_jobs
  FROM cron.job_run_details r
  JOIN cron.job j ON j.jobid = r.jobid
  WHERE r.status = 'failed'
    AND r.start_time > now() - interval '70 minutes';

  IF COALESCE(v_count, 0) = 0 THEN
    RETURN;
  END IF;

  SELECT value INTO v_url FROM app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING '[alert_cron_failures] app_config url/key missing — % cron failure(s) in: %',
      v_count, v_jobs;
    RETURN;
  END IF;

  -- Best-effort: a push problem must never make the health check itself fail.
  BEGIN
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object(
        'role',           'admin',
        'title',          'Background job failing',
        'body',           v_count || ' cron failure(s) in the last hour: ' || v_jobs,
        -- Deep-links to the System Health surface (audit O1) so the admin
        -- lands on the job-health screen, not the generic home tab.
        'data',           jsonb_build_object('screen', 'JobHealth'),
        'trigger_source', 'cron_health'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[alert_cron_failures] push enqueue failed: %', SQLERRM;
  END;
END;
$$;

-- Schedule hourly at :15 (offset from the on-the-hour jobs).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-failure-alert') THEN
    PERFORM cron.unschedule('cron-failure-alert');
  END IF;
END $$;

SELECT cron.schedule('cron-failure-alert', '15 * * * *', $$SELECT public.alert_cron_failures()$$);
