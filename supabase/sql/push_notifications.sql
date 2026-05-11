-- =============================================================================
-- 1stOne F1 — Push Notification Infrastructure
--
-- Run these blocks in order in the Supabase SQL Editor.
-- Sections:
--   0. app_config table  (stores URL + service-role key for pg_net calls)
--   1. push_logs table
--   2. Order status DB trigger
--   3. pg_cron job for subscription expiry notices
--
-- NOTE: ALTER DATABASE SET is blocked on Supabase (requires superuser).
--       We store the URL and key in app_config instead — a service-role
--       only table that the trigger reads at runtime.
-- =============================================================================


-- =============================================================================
-- 0. app_config — config store for trigger/cron use
--    Service-role writes; no authenticated reads (RLS blocks them).
--    Replace the values in the INSERT before running.
-- =============================================================================

create table if not exists app_config (
  key   text primary key,
  value text not null
);

-- Disable RLS: only the service-role (used by trigger security definer) reads this.
-- Authenticated users cannot read it because the table has no select policies.
alter table app_config enable row level security;

-- Upsert the two values — run this block after confirming the values are correct.
insert into app_config (key, value) values
  ('supabase_url',       'https://wcvqxzqqwcxlcgrjyunf.supabase.co'),
  ('service_role_key',   '<REDACTED-ROTATED-2026-04-25>')
on conflict (key) do update set value = excluded.value;


-- =============================================================================
-- 1. push_logs TABLE
-- =============================================================================

create table if not exists push_logs (
  id              bigserial    primary key,
  user_id         uuid         references auth.users(id) on delete set null,
  token           text,
  title           text         not null,
  body            text         not null,
  data            jsonb        not null default '{}',
  trigger_source  text         not null default 'unknown',
  reference_id    text,
  expo_ticket_id  text,
  status          text         not null default 'pending'
                    check (status in ('sent', 'failed', 'invalid_token', 'pending')),
  error_message   text,
  sent_at         timestamptz  not null default now()
);

create index if not exists push_logs_user_id_idx  on push_logs (user_id);
create index if not exists push_logs_sent_at_idx  on push_logs (sent_at desc);
create index if not exists push_logs_status_idx   on push_logs (status);
create index if not exists push_logs_trigger_idx  on push_logs (trigger_source, sent_at desc);

alter table push_logs enable row level security;

-- Admins can read logs; nobody can write directly (service-role only)
create policy "Admins can view push logs"
  on push_logs for select
  to authenticated
  using (
    (select role from profiles where id = auth.uid()) = 'admin'
  );


-- =============================================================================
-- 2. ORDER STATUS TRIGGER — REMOVED via BF-35b (2026-05-11)
--
-- Was: AFTER INSERT OR UPDATE OF status on orders → fires push via pg_net.
-- Dropped because every app-code path that mutates orders.status ALSO calls
-- send-push directly via resolveAndSendPush (which honors admin's
-- notification_templates overrides). The trigger was firing duplicate
-- pushes with hardcoded copy that bypassed admin's template edits.
--
-- Paths that previously relied on the trigger and now fire their own push:
--   - confirm-order Edge fn: explicit resolveAndSendPush for order.confirmed
--     and subscription.activated (when subs are activated in the same call).
--   - generate_daily_manifest SQL: explicit pg_net call for each cron-
--     generated daily dispatch row.
--
-- Paths that intentionally do NOT push:
--   - cancel-order Edge fn (customer-initiated): customer is on-screen and
--     gets an Alert.alert; no notification needed.
--
-- One-off DROP run via supabase db query to remove from prod:
--   DROP TRIGGER IF EXISTS trg_order_status_push ON orders;
--   DROP FUNCTION IF EXISTS _notify_order_status_push();
-- =============================================================================


-- =============================================================================
-- 3. SUBSCRIPTION EXPIRY CRON JOB
--    Runs daily at 09:00 IST (03:30 UTC).
--    Calls the subscription-expiry-push Edge Function, which finds
--    subscriptions ending in 1 or 2 days and pushes notices.
-- =============================================================================

-- Unschedule first if it already exists (safe to re-run)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'subscription-expiry-push') then
    perform cron.unschedule('subscription-expiry-push');
  end if;
end;
$$;

select cron.schedule(
  'subscription-expiry-push',
  '30 3 * * *',   -- 03:30 UTC = 09:00 IST
  $$
  select net.http_post(
    url     := (select value from app_config where key = 'supabase_url') || '/functions/v1/subscription-expiry-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select value from app_config where key = 'service_role_key')
    ),
    body    := '{}'::text
  );
  $$
);

-- Verify the cron was registered:
-- select jobname, schedule, command from cron.job where jobname = 'subscription-expiry-push';

-- Verify push from an existing order manually (replace 123 with a real order id):
-- update orders set status = 'Confirmed' where id = 123;
-- select * from net.http_request_queue order by id desc limit 5;
