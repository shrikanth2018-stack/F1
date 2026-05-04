-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Kitchen Cutoff Push
--
-- For each active delivery_cycle, immediately after its cutoff_time,
-- aggregate the day's orders (ad-hoc + subscription-driven) for that
-- cycle and push a summary to kitchen staff.
--
-- Moving pieces:
--   1. kitchen_push_log(cycle_id, push_date) — dedupe table
--   2. push_kitchen_summary(cycle_id, target_date) — aggregates & fires HTTP
--      call to the send-push Edge Function via pg_net
--   3. trigger_kitchen_cutoff_pushes() — pg_cron callback, runs every minute
--
-- Requires:
--   - pg_net extension (Supabase has it preinstalled; enable if missing)
--   - pg_cron extension
--   - Vault secrets: 'supabase_url', 'service_role_key' (or use session vars)
--
-- Deploy: paste this entire file into Supabase SQL editor. Idempotent.
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;


-- ── 1. Dedupe log ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kitchen_push_log (
  id            BIGSERIAL PRIMARY KEY,
  cycle_id      INTEGER NOT NULL REFERENCES delivery_cycles(id) ON DELETE CASCADE,
  push_date     DATE NOT NULL,
  pushed_at     TIMESTAMPTZ DEFAULT NOW(),
  orders_count  INTEGER DEFAULT 0,
  items_summary TEXT,
  http_request_id BIGINT,               -- pg_net request id for traceability
  UNIQUE (cycle_id, push_date)
);


-- ── 2. Helper: read config from Vault (or fallback env) ───────
-- Supabase stores service-role key + url in the Vault. If your project
-- does not have these secrets yet, create them:
--   SELECT vault.create_secret('https://<ref>.supabase.co', 'supabase_url');
--   SELECT vault.create_secret('<service-role-key>',        'service_role_key');
CREATE OR REPLACE FUNCTION _kitchen_get_secret(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  SELECT decrypted_secret
  INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = p_name
  LIMIT 1;
  RETURN v_secret;
END;
$$;


-- ── 3. Aggregate + dispatch push for one cycle ────────────────
CREATE OR REPLACE FUNCTION push_kitchen_summary(
  p_cycle_id    INTEGER,
  p_target_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cycle        RECORD;
  v_orders_count INTEGER := 0;
  v_summary      TEXT    := '';
  v_payload      JSONB;
  v_url          TEXT;
  v_key          TEXT;
  v_req_id       BIGINT;
  v_branch_id    INTEGER;
BEGIN
  SELECT id, cycle_name, branch_id
  INTO v_cycle
  FROM delivery_cycles
  WHERE id = p_cycle_id AND is_active = TRUE;

  IF v_cycle IS NULL THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'cycle not found or inactive');
  END IF;

  v_branch_id := v_cycle.branch_id;

  -- Count orders for this cycle + date (includes both ad-hoc and subscription-driven)
  -- We consider orders that should actually reach the kitchen: Confirmed / Paid /
  -- Preparing. Pending (awaiting razorpay webhook) is intentionally excluded.
  SELECT COUNT(*)::INTEGER
  INTO v_orders_count
  FROM orders o
  WHERE o.cycle_id       = p_cycle_id
    AND o.dispatch_date  = p_target_date
    AND o.status         IN ('Confirmed', 'Paid', 'Preparing');

  -- Build a textual summary: "Item A x 12, Item B x 5" — ordered by qty desc
  SELECT string_agg(line, ', ' ORDER BY total_qty DESC)
  INTO v_summary
  FROM (
    SELECT
      oi.item_name,
      SUM(oi.quantity)::INTEGER AS total_qty,
      (oi.item_name || ' x ' || SUM(oi.quantity)::TEXT) AS line
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.cycle_id      = p_cycle_id
      AND o.dispatch_date = p_target_date
      AND o.status        IN ('Confirmed', 'Paid', 'Preparing')
    GROUP BY oi.item_name
  ) agg;

  -- Insert dedupe log first (UNIQUE (cycle_id, push_date) enforces idempotency)
  INSERT INTO kitchen_push_log (cycle_id, push_date, orders_count, items_summary)
  VALUES (p_cycle_id, p_target_date, v_orders_count, COALESCE(v_summary, ''))
  ON CONFLICT (cycle_id, push_date) DO NOTHING;

  -- If the log didn't actually insert, another call already handled this cycle+date
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'duplicate', 'cycle_id', p_cycle_id, 'target_date', p_target_date);
  END IF;

  -- Short-circuit: no orders — log the zero-count row and return without notifying
  IF v_orders_count = 0 THEN
    RETURN jsonb_build_object('status', 'no_orders', 'cycle_id', p_cycle_id, 'target_date', p_target_date);
  END IF;

  -- Build the payload for the send-push Edge Function
  v_payload := jsonb_build_object(
    'role',       'staff',
    'branch_id',  v_branch_id,
    'title',      'Kitchen order summary — ' || v_cycle.cycle_name,
    'body',       v_orders_count || ' orders ready to start. ' || COALESCE(v_summary, ''),
    'data',       jsonb_build_object('screen', 'StaffDashboard', 'cycle_id', p_cycle_id)
  );

  -- Read Vault secrets (url + service key)
  v_url := _kitchen_get_secret('supabase_url');
  v_key := _kitchen_get_secret('service_role_key');

  IF v_url IS NULL OR v_key IS NULL THEN
    -- Log but don't throw — operator needs to provision Vault secrets first
    RAISE WARNING '[push_kitchen_summary] Missing vault secret supabase_url or service_role_key';
    RETURN jsonb_build_object('status', 'no_vault_secret', 'cycle_id', p_cycle_id);
  END IF;

  -- Fire-and-forget HTTP POST to send-push
  SELECT net.http_post(
    url     := v_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := v_payload
  ) INTO v_req_id;

  -- Save request id on the log for tracing
  UPDATE kitchen_push_log
  SET http_request_id = v_req_id
  WHERE cycle_id = p_cycle_id AND push_date = p_target_date;

  RETURN jsonb_build_object(
    'status',         'dispatched',
    'cycle_id',       p_cycle_id,
    'target_date',    p_target_date,
    'orders_count',   v_orders_count,
    'request_id',     v_req_id
  );
END;
$$;


-- ── 4. pg_cron tick: fires every minute ───────────────────────
-- Iterates every active delivery_cycle and, if its kitchen_push_time
-- has passed for TODAY (in IST) and we haven't already pushed for today:
--   a) Generates subscription orders for this cycle + today (so they're
--      included in the count before the summary is built).
--   b) Pushes the kitchen summary.
--
-- kitchen_push_time is typically cutoff_time + 5 min (admin-configurable).
-- Timezone: times stored as plain TIME (IST local clock).
--
-- Cross-midnight detection:
--   cutoff_time > delivery_start means the cutoff is at night and the delivery
--   is the next morning (e.g. cutoff 22:30, delivery 07:00).
--   In that case the target delivery date is v_ist_date + 1, not v_ist_date.
--   Dedup (kitchen_push_log) uses the TARGET delivery date so that:
--     - tonight's push logs tomorrow's date
--     - tomorrow morning the log already exists → no accidental re-push
CREATE OR REPLACE FUNCTION trigger_kitchen_cutoff_pushes()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cycle       RECORD;
  v_ist_now     TIMESTAMPTZ;
  v_ist_date    DATE;
  v_ist_time    TIME;
  v_target_date DATE;
BEGIN
  v_ist_now  := NOW() AT TIME ZONE 'Asia/Kolkata';
  v_ist_date := v_ist_now::DATE;
  v_ist_time := v_ist_now::TIME;

  FOR v_cycle IN
    SELECT dc.id, dc.kitchen_push_time, dc.cutoff_time, dc.delivery_start
    FROM delivery_cycles dc
    WHERE dc.is_active = TRUE
      AND v_ist_time >= dc.kitchen_push_time
  LOOP
    -- Cross-midnight: cutoff at night, delivery next morning.
    -- Detected by: cutoff_time (HH:MM:SS) > delivery_start (HH:MM:SS) lexicographically.
    IF v_cycle.cutoff_time > v_cycle.delivery_start THEN
      v_target_date := v_ist_date + 1;   -- delivery is tomorrow
    ELSE
      v_target_date := v_ist_date;        -- same-day delivery
    END IF;

    -- Dedup against the delivery date (not the push date) so cross-midnight
    -- cycles don't re-fire the next morning when the log is keyed to tomorrow.
    CONTINUE WHEN EXISTS (
      SELECT 1
      FROM kitchen_push_log kpl
      WHERE kpl.cycle_id  = v_cycle.id
        AND kpl.push_date = v_target_date
    );

    -- Step 1: generate subscription orders for this cycle's delivery date so
    -- they are counted in the kitchen summary below.
    PERFORM generate_daily_manifest(
      p_target_date => v_target_date,
      p_cycle_id    => v_cycle.id
    );

    -- Step 2: aggregate all orders (ad-hoc + subscription) and push to kitchen.
    PERFORM push_kitchen_summary(v_cycle.id, v_target_date);
  END LOOP;
END;
$$;


-- ── 5. Schedule the tick every minute ─────────────────────────
-- Idempotent: unschedule first if the job already exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'kitchen-cutoff-push-tick') THEN
    PERFORM cron.unschedule('kitchen-cutoff-push-tick');
  END IF;
END $$;

SELECT cron.schedule(
  'kitchen-cutoff-push-tick',
  '* * * * *',                               -- every minute
  $$SELECT trigger_kitchen_cutoff_pushes()$$
);


-- ── 6. Manual helpers ─────────────────────────────────────────
--   Force a push (e.g. after a schema fix):
--     SELECT push_kitchen_summary(<cycle_id>, CURRENT_DATE);
--   Retry a specific date:
--     DELETE FROM kitchen_push_log WHERE cycle_id=<id> AND push_date='2026-04-17';
--     SELECT push_kitchen_summary(<id>, '2026-04-17');
--   See recent pushes:
--     SELECT * FROM kitchen_push_log ORDER BY pushed_at DESC LIMIT 20;
--   Inspect a pg_net response:
--     SELECT * FROM net._http_response WHERE id = <http_request_id>;
