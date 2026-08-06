-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Remind staff to fix their attendance before the month closes
-- (2026-08-06)
--
-- A staff member who forgot to clock in leaves a gap in their calendar, and
-- that calendar is what an admin reads when settling the month. Corrections
-- exist for exactly this (attendance_corrections.sql) but nothing ever told
-- anyone to file one, so the prompt only arrived as an argument about pay.
--
-- WHAT THIS IS NOT. Nothing in this system deducts pay automatically —
-- `staff_salary.deductions` is a plain column an admin types into. So the
-- copy says "before the month closes", not "or you will be docked". A
-- notification that threatens a consequence the software does not enforce is
-- a lie that someone eventually calls.
--
-- WHY GENERIC WORDING, not "you have N days unmarked". `staff_shifts` — which
-- carries days_of_week — is EMPTY, so nobody has working days configured and
-- every elapsed day without a clock-in reads as absent, weekly offs included.
-- A personalised count would say "26 days unmarked" to someone who worked
-- their full roster. When shifts are filled in, the count becomes worth
-- adding; until then it would only teach people to ignore this push.
--
-- WHEN. The day BEFORE the last day of the month, so there is a full day left
-- for the staff member to file and for an admin to approve. Derived rather
-- than hardcoded, so February and the 30-day months are right without a
-- calendar table:
--
--     first of month + 1 month - 2 days
--     Aug → 2026-08-01 +1mo = 09-01, -2d = 08-30   (last day 31st)  ✓
--     Feb → 2026-02-01 +1mo = 03-01, -2d = 02-27   (last day 28th)  ✓
--
-- The cron runs daily and the function decides; a date test in SQL is far
-- easier to read and to change than a cron expression that tries to express
-- "second-to-last day of a month of unknown length".
--
-- Deploy: supabase db query --linked --file supabase/sql/attendance_regularization_reminder.sql
-- Idempotent. Safe to re-run. Rollback at the bottom.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Editable copy ───────────────────────────────────────────
-- Goes through notification_templates so the wording can be changed from
-- Manage → Notifications without a deploy — unlike the kitchen batch push,
-- whose title is stranded in SQL for want of an event_key. `variables` is NOT
-- NULL and drives the {{...}} chips in Notification Manager; this message
-- deliberately takes none, so the array is empty rather than absent.
INSERT INTO public.notification_templates
  (event_key, title_template, body_template, is_enabled, trigger_source,
   description, variables)
VALUES (
  'staff.attendance_regularization',
  'Check your attendance',
  'The month closes tomorrow. Open Attendance and send a correction for any day you forgot to clock in or out.',
  TRUE,
  'attendance_reminder',
  'Sent to all staff the day before the last day of each month, prompting them to file attendance corrections while there is still time to approve them.',
  ARRAY[]::TEXT[]
)
ON CONFLICT (event_key) DO NOTHING;

-- ── 2. The reminder ────────────────────────────────────────────
-- Fire-and-forget, and a no-op on every day but one. Reads the service-role
-- key through the same Vault-then-app_config helper the kitchen tick uses
-- (D5: the two have drifted before), so there is one place to rotate.
CREATE OR REPLACE FUNCTION public.notify_attendance_regularization()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net'
AS $$
DECLARE
  v_today       DATE;
  v_target      DATE;
  v_url         TEXT;
  v_key         TEXT;
  v_staff_count INTEGER;
BEGIN
  -- IST, not the server's date. Between 00:00 and 05:30 IST a UTC date is
  -- still yesterday, which on the 1st of a month would fire this a day late
  -- — the one day it must not.
  v_today  := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;
  v_target := (date_trunc('month', v_today) + INTERVAL '1 month' - INTERVAL '2 days')::DATE;

  IF v_today <> v_target THEN
    RETURN;
  END IF;

  -- Nothing to say to nobody. Also keeps the log quiet on a branch that has
  -- not hired yet.
  SELECT COUNT(*) INTO v_staff_count FROM public.profiles WHERE role = 'staff';
  IF v_staff_count = 0 THEN
    RAISE NOTICE '[notify_attendance_regularization] no staff — skipped';
    RETURN;
  END IF;

  v_url := public._kitchen_get_secret('supabase_url');
  v_key := public._kitchen_get_secret('service_role_key');
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING '[notify_attendance_regularization] no url/key — push skipped';
    RETURN;
  END IF;

  -- role='staff' with no branch_id: the message is the same in every branch,
  -- and scoping it would mean one call per branch for no difference in copy.
  -- event_key makes send-push prefer the editable template; the title/body
  -- here are the fallback for a deleted template row, not the source.
  BEGIN
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object(
        'role',           'staff',
        'event_key',      'staff.attendance_regularization',
        'title',          'Check your attendance',
        'body',           'The month closes tomorrow. Open Attendance and send a correction for any day you forgot to clock in or out.',
        'data',           jsonb_build_object('screen', 'Attendance'),
        'trigger_source', 'attendance_reminder'
      )
    );
    RAISE NOTICE '[notify_attendance_regularization] sent to % staff', v_staff_count;
  EXCEPTION WHEN OTHERS THEN
    -- A failed push must not fail the job: a red cron run pulls the owner in
    -- via alert_cron_failures for something that is only a missed reminder.
    RAISE WARNING '[notify_attendance_regularization] push enqueue failed: %', SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_attendance_regularization() FROM PUBLIC, anon, authenticated;

-- ── 3. Daily tick ──────────────────────────────────────────────
-- 05:00 UTC = 10:30 IST — mid-morning, after the shift has started, so it is
-- read rather than buried overnight. The function itself decides whether
-- today is the day. Picked up automatically by get_job_health() and by
-- alert_cron_failures(), so no observability wiring is needed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'attendance-regularization-reminder') THEN
    PERFORM cron.unschedule('attendance-regularization-reminder');
  END IF;
END $$;

SELECT cron.schedule(
  'attendance-regularization-reminder',
  '0 5 * * *',
  $$SELECT public.notify_attendance_regularization()$$
);

NOTIFY pgrst, 'reload schema';

-- ── Verification ───────────────────────────────────────────────
-- Which day will it fire on, for the next few months? Must always be one day
-- before the last:
--
--   SELECT m::date AS month,
--          (date_trunc('month', m) + INTERVAL '1 month' - INTERVAL '2 days')::date AS fires_on,
--          (date_trunc('month', m) + INTERVAL '1 month' - INTERVAL '1 day')::date  AS last_day
--     FROM generate_series('2026-01-01'::date, '2027-02-01'::date, '1 month') m;
--
-- Force a send today, WITHOUT waiting for the date (rolled back, so the
-- queued pg_net request is discarded and no real phone is notified — drop the
-- ROLLBACK only if you actually want the staff to receive it):
--
--   BEGIN;
--     SELECT public.notify_attendance_regularization();   -- no-op unless today is the day
--   ROLLBACK;
--
-- The job is listed on Admin → Operations → Job Health once it has run.

-- ── Rollback ───────────────────────────────────────────────────
-- SELECT cron.unschedule('attendance-regularization-reminder');
-- DROP FUNCTION IF EXISTS public.notify_attendance_regularization();
-- DELETE FROM public.notification_templates WHERE event_key = 'staff.attendance_regularization';
