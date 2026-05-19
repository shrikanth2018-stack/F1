-- ============================================================
-- 1stOne F1 — notification_templates.variables (audit D21)
-- Applied to live DB 2026-05-19.
--
-- The {{variable}} names each event provides used to be a hardcoded map
-- in NotificationManagerScreen, decoupled from the template rows. This
-- moves that metadata onto the row so the admin screen reads it from the
-- DB — a server-added event no longer needs a client code change.
--
-- Backfilled from the screen's former EVENT_VARS map.
-- ============================================================

ALTER TABLE public.notification_templates
  ADD COLUMN IF NOT EXISTS variables text[] NOT NULL DEFAULT '{}'::text[];

UPDATE public.notification_templates AS nt
SET variables = v.vars
FROM (VALUES
  ('order.confirmed',                ARRAY['order_id']),
  ('order.razorpay_confirmed',       ARRAY['order_id']),
  ('order.ready',                    ARRAY['order_id']),
  ('order.dispatched',               ARRAY['order_id']),
  ('order.received_at_hub',          ARRAY['order_id']),
  ('order.delivered',                ARRAY['order_id']),
  ('order.cancelled',                ARRAY['order_id']),
  ('order.payment_failed',           ARRAY['order_id']),
  ('wallet.topped_up',               ARRAY['amount']),
  ('wallet.low_balance',             ARRAY['shortfall', 'plan_name']),
  ('subscription.activated',         ARRAY['plan_name', 'start_date']),
  ('subscription.starting_tomorrow', ARRAY['plan_name']),
  ('subscription.ending_1d',         ARRAY['plan_name']),
  ('subscription.ending_2d',         ARRAY['plan_name']),
  ('winback.dormant',                ARRAY[]::text[])
) AS v(event_key, vars)
WHERE nt.event_key = v.event_key;

NOTIFY pgrst, 'reload schema';
