-- ============================================================
-- 1stOne F1 — Fix failing cron jobs (audit, 2026-05-19)
-- Applied to live DB 2026-05-19.
--
-- low-wallet-check (jobid 6) and dormant-user-check (jobid 7) were
-- failing every run:
--   ERROR: null value in column "url" of relation "http_request_queue"
--
-- Cause: both read their target URL + service key from a GUC via
--   current_setting('app.supabase_url', true)
-- — but that GUC is not set on this database, so it returns NULL and
-- the pg_net request has a NULL url.
--
-- subscription-expiry-push (jobid 5) does NOT fail because it reads
-- from the app_config table instead. This migration rewrites jobs 6
-- and 7 to use the same app_config source — one config source, no GUC
-- dependency.
-- ============================================================

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'low-wallet-check'),
  command := $cmd$
    select net.http_post(
      url := (select value from app_config where key = 'supabase_url') || '/functions/v1/low-wallet-check',
      body := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select value from app_config where key = 'service_role_key')
      )
    );
  $cmd$
);

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'dormant-user-check'),
  command := $cmd$
    select net.http_post(
      url := (select value from app_config where key = 'supabase_url') || '/functions/v1/dormant-user-check',
      body := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select value from app_config where key = 'service_role_key')
      )
    );
  $cmd$
);
