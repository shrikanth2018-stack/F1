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
-- 2. ORDER STATUS TRIGGER
--    Uses net.http_post (pg_net — enabled by default on Supabase).
--    Reads supabase_url and service_role_key from app_config at runtime.
-- =============================================================================

create or replace function _notify_order_status_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title       text;
  v_body        text;
  v_supa_url    text;
  v_svc_key     text;
begin
  -- Skip when status hasn't changed
  if tg_op = 'UPDATE' and new.status = old.status then
    return new;
  end if;

  -- Map status → notification copy
  case new.status
    when 'Confirmed' then
      v_title := 'Order Confirmed!';
      v_body  := format('Your order #%s is confirmed. We''re getting it ready!', new.id);
    when 'Preparing' then
      v_title := 'In the Kitchen';
      v_body  := format('Order #%s is being prepared now.', new.id);
    when 'Ready' then
      v_title := 'Order Ready!';
      v_body  := format('Order #%s is packed and ready for dispatch.', new.id);
    when 'Dispatched', 'On the Way' then
      v_title := 'On the Way!';
      v_body  := format('Your order #%s is on the way. Should arrive soon!', new.id);
    when 'Received at Hub' then
      v_title := 'At Your Hub';
      v_body  := format('Order #%s has arrived at your pickup hub.', new.id);
    when 'Delivered' then
      v_title := 'Delivered!';
      v_body  := format('Order #%s delivered. Enjoy your meal!', new.id);
    when 'Cancelled' then
      v_title := 'Order Cancelled';
      v_body  := format('Order #%s has been cancelled.', new.id);
    else
      return new;   -- Pending / Failed / etc — no push
  end case;

  -- Read config inside the function (security definer bypasses RLS)
  select value into v_supa_url from app_config where key = 'supabase_url';
  select value into v_svc_key  from app_config where key = 'service_role_key';

  if v_supa_url is null or v_svc_key is null then
    raise warning '[_notify_order_status_push] app_config missing supabase_url or service_role_key';
    return new;
  end if;

  -- Fire async HTTP POST via pg_net (non-blocking)
  perform net.http_post(
    url     := v_supa_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_svc_key
    ),
    body    := jsonb_build_object(
      'user_ids',       jsonb_build_array(new.user_id::text),
      'title',          v_title,
      'body',           v_body,
      'data',           jsonb_build_object(
                          'screen',         'OrderDetail',
                          'params',         jsonb_build_object('orderId', new.id),
                          'trigger_source', 'order_status',
                          'order_id',       new.id
                        ),
      'trigger_source', 'order_status',
      'reference_id',   new.id::text
    )::text
  );

  return new;
end;
$$;

drop trigger if exists trg_order_status_push on orders;

create trigger trg_order_status_push
  after insert or update of status
  on orders
  for each row
  execute function _notify_order_status_push();


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
