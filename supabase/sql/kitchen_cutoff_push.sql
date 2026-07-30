-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Kitchen Cutoff Push
--
-- For each active delivery_cycle, immediately after its cutoff_time,
-- aggregate the day's orders (ad-hoc + subscription-driven) for that
-- cycle and push a summary to kitchen staff.
--
-- Moving pieces:
--   1. kitchen_push_log(cycle_id, push_date) — claim + dedupe table
--   2. push_kitchen_summary(cycle_id, target_date) — aggregates & fires HTTP
--      call to the send-push Edge Function via pg_net
--   3. trigger_kitchen_cutoff_pushes() — pg_cron callback, runs every minute
--   4. delivery_cycles_push_after_cutoff — CHECK guarding the config (§5)
--   5. alert_missing_kitchen_pushes() — outcome alarm, every 10 min (§6)
--
-- Delivery guarantee: AT LEAST ONCE, bounded by the delivery time.
--   A log row is a *claim*; it only becomes final when notified_at is set.
--   Any unconfirmed claim is retried by the minute tick until the cycle's
--   delivery_start passes, after which a kitchen list is useless and §6
--   alerts instead. Previously the row was written before the push was sent,
--   so a single transient failure lost that delivery's summary permanently.
--
-- What is still not guaranteed: net.http_post is fire-and-forget, so a
-- non-2xx from send-push is not visible to the caller. §6 covers that gap by
-- checking the outcome rather than the return value.
--
-- Requires:
--   - pg_net extension (Supabase has it preinstalled; enable if missing)
--   - pg_cron extension
--   - 'supabase_url' + 'service_role_key' in Vault OR in app_config
--     (§2 reads Vault first, then falls back to app_config)
--
-- Deploy: paste this entire file into Supabase SQL editor. Idempotent.
-- After deploying, regenerate types — kitchen_push_log gained three columns:
--   npm run supabase:gen-types
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;


-- ── 1. Dedupe log ──────────────────────────────────────────────
-- The row doubles as a claim (see §3): UNIQUE (cycle_id, push_date) still
-- guarantees one push per cycle+delivery-date, but a row is only *final*
-- once notified_at is set. An unconfirmed row is retried by the tick.
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

-- Claim/confirm columns. Added in one guarded block so the backfill below
-- runs exactly once — on a re-paste the columns already exist and we skip,
-- which matters because the backfill confirms every row it sees.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'kitchen_push_log'
      AND column_name  = 'notified_at'
  ) THEN
    ALTER TABLE kitchen_push_log ADD COLUMN notified_at TIMESTAMPTZ;
    ALTER TABLE kitchen_push_log ADD COLUMN status      TEXT;
    ALTER TABLE kitchen_push_log ADD COLUMN attempts    INTEGER NOT NULL DEFAULT 0;

    -- Every pre-existing row was written under the old at-most-once model,
    -- i.e. its push was already attempted. Confirm them all, or the new
    -- self-healing tick would re-push historical delivery dates on deploy.
    UPDATE kitchen_push_log
    SET notified_at = COALESCE(pushed_at, NOW()),
        status      = 'dispatched',
        attempts    = 1;
  END IF;
END $$;

-- Retry lookup: "is there still an unconfirmed claim for this cycle+date?"
CREATE INDEX IF NOT EXISTS kitchen_push_log_unconfirmed_idx
  ON kitchen_push_log (cycle_id, push_date)
  WHERE notified_at IS NULL;


-- ── 2. Helper: read config from Vault (or fallback env) ───────
-- Supabase stores service-role key + url in the Vault. If your project
-- does not have these secrets yet, create them:
--   SELECT vault.create_secret('https://<ref>.supabase.co', 'supabase_url');
--   SELECT vault.create_secret('<service-role-key>',        'service_role_key');
-- Falls back to app_config, which is where the rest of the system reads its
-- url/service key from (see cron_failure_alert.sql). Without the fallback an
-- unprovisioned Vault silently disables the kitchen push on a project whose
-- other jobs work fine — a dependency worth not having.
CREATE OR REPLACE FUNCTION _kitchen_get_secret(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  BEGIN
    SELECT decrypted_secret
    INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = p_name
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;   -- vault extension absent / not readable
  END;

  IF v_secret IS NULL THEN
    SELECT value INTO v_secret FROM app_config WHERE key = p_name LIMIT 1;
  END IF;

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
  v_log_id       BIGINT;
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

  -- CLAIM the cycle+date. UNIQUE (cycle_id, push_date) still enforces one
  -- push per delivery date, but we re-claim a row whose notified_at is NULL:
  -- that row represents an attempt that never actually reached anyone, and
  -- the old code's DO NOTHING made it permanently unretryable.
  INSERT INTO kitchen_push_log (cycle_id, push_date, orders_count, items_summary, status, attempts)
  VALUES (p_cycle_id, p_target_date, v_orders_count, COALESCE(v_summary, ''), 'pending', 1)
  ON CONFLICT (cycle_id, push_date) DO UPDATE
    SET orders_count  = EXCLUDED.orders_count,
        items_summary = EXCLUDED.items_summary,
        status        = 'pending',
        attempts      = kitchen_push_log.attempts + 1
    WHERE kitchen_push_log.notified_at IS NULL
  RETURNING id INTO v_log_id;

  -- No row returned → a CONFIRMED push already exists for this cycle+date.
  IF v_log_id IS NULL THEN
    RETURN jsonb_build_object('status', 'duplicate', 'cycle_id', p_cycle_id, 'target_date', p_target_date);
  END IF;

  -- Short-circuit: no orders. Confirmed rather than left pending — the cutoff
  -- has passed, so no further orders can land on this date and there is
  -- genuinely nothing to send. §5 treats 'no_orders' as a healthy outcome.
  IF v_orders_count = 0 THEN
    UPDATE kitchen_push_log
    SET status = 'no_orders', notified_at = NOW()
    WHERE id = v_log_id;
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
    -- Log but don't throw — operator needs to provision the secrets first.
    -- notified_at stays NULL, so the tick keeps retrying until they do (and
    -- §5 alerts if the delivery window is about to close).
    RAISE WARNING '[push_kitchen_summary] Missing supabase_url or service_role_key (vault + app_config)';
    UPDATE kitchen_push_log SET status = 'no_secret' WHERE id = v_log_id;
    RETURN jsonb_build_object('status', 'no_secret', 'cycle_id', p_cycle_id);
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

  -- CONFIRM: the request is enqueued with pg_net, so this cycle+date is done
  -- and will not be retried. Note net.http_post is fire-and-forget — a later
  -- non-2xx from send-push is NOT visible here; §5 is what catches that.
  UPDATE kitchen_push_log
  SET http_request_id = v_req_id,
      status          = 'dispatched',
      notified_at     = NOW()
  WHERE id = v_log_id;

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
-- Driven by the TARGET DELIVERY DATE, not by time-of-day.
--
-- The previous version selected cycles with `ist_time >= kitchen_push_time`.
-- For a night cycle (push 22:30) that predicate is true only until 23:59:59
-- IST — so a push that failed at 22:30 had ~90 minutes of retries and was
-- then skipped forever, and the 07:00 kitchen list never went out. Worse, the
-- log row had already been written, so nothing would have retried anyway.
--
-- Instead: for each active cycle we walk candidate delivery dates and act on
-- any whose push instant has passed and whose delivery has not yet started.
--
--   push instant  = (target - cross_midnight_offset) @ kitchen_push_time  (IST)
--   deadline      =  target                          @ delivery_start     (IST)
--
--   cross_midnight_offset = 1 when cutoff_time > delivery_start, else 0
--   (cutoff 22:30 with delivery 07:00 → tonight's push is for tomorrow)
--
-- Two properties follow, and they are the point of the rewrite:
--   • midnight-safe — at 00:30 IST the target is *today*, whose push instant
--     was 22:30 yesterday. Still before the 07:00 deadline, so a push missed
--     last night is picked up and sent now.
--   • self-limiting — once delivery_start passes, a kitchen list for that
--     date is useless, so the window closes on its own. §5 alerts before
--     that happens rather than after.
--
-- Times are plain TIME columns holding IST wall-clock; every comparison is
-- materialised through an explicit Asia/Kolkata instant (IST has no DST).
CREATE OR REPLACE FUNCTION trigger_kitchen_cutoff_pushes()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cycle    RECORD;
  v_today    DATE;
  v_offset   INTEGER;
  v_target   DATE;
  v_push_at  TIMESTAMPTZ;
  v_deadline TIMESTAMPTZ;
  v_i        INTEGER;
BEGIN
  v_today := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;

  FOR v_cycle IN
    SELECT dc.id, dc.kitchen_push_time, dc.cutoff_time, dc.delivery_start
    FROM delivery_cycles dc
    WHERE dc.is_active = TRUE
  LOOP
    v_offset := CASE WHEN v_cycle.cutoff_time > v_cycle.delivery_start THEN 1 ELSE 0 END;

    -- Yesterday..tomorrow covers every date that can be in-window for any
    -- cutoff/delivery pairing, including the post-midnight recovery case.
    FOR v_i IN -1..1 LOOP
      v_target   := v_today + v_i;
      v_push_at  := ((v_target - v_offset)::TIMESTAMP + v_cycle.kitchen_push_time)
                      AT TIME ZONE 'Asia/Kolkata';
      v_deadline := (v_target::TIMESTAMP + v_cycle.delivery_start)
                      AT TIME ZONE 'Asia/Kolkata';

      CONTINUE WHEN NOW() < v_push_at OR NOW() >= v_deadline;

      -- Only a CONFIRMED push blocks. An unconfirmed claim is a failed
      -- attempt and must be retried (that is the P1 half of this change).
      CONTINUE WHEN EXISTS (
        SELECT 1
        FROM kitchen_push_log kpl
        WHERE kpl.cycle_id    = v_cycle.id
          AND kpl.push_date   = v_target
          AND kpl.notified_at IS NOT NULL
      );

      -- Per-cycle isolation: one cycle raising must not abort the others or
      -- roll back their pushes. The subtransaction discards this cycle's
      -- claim, so it is retried on the next tick.
      BEGIN
        -- Step 1: generate subscription orders for this delivery date so they
        -- are counted in the summary below.
        PERFORM generate_daily_manifest(
          p_target_date => v_target,
          p_cycle_id    => v_cycle.id
        );

        -- Step 2: aggregate all orders (ad-hoc + subscription) and push.
        PERFORM push_kitchen_summary(v_cycle.id, v_target);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[trigger_kitchen_cutoff_pushes] cycle % target % failed: %',
          v_cycle.id, v_target, SQLERRM;
      END;
    END LOOP;
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


-- ── 5. Guard: kitchen_push_time must not precede cutoff_time ──
-- Nothing stopped an admin (CycleCard's Kitchen Push TimeField) from setting
-- the push earlier than the cutoff. Orders placed in the gap are accepted by
-- the app — they are before the cutoff, so they dispatch on this date — but
-- they land AFTER the summary was aggregated, so the kitchen never sees them.
-- Silent under-production, which is the worst failure mode here: no error,
-- just missing food.
--
-- Limitation: plain TIME comparison, so this assumes cutoff and push sit on
-- the same side of midnight (true for every cycle today, incl. 22:30/07:00).
-- A cutoff of 23:50 with a 00:05 push would need an explicit offset column.
DO $$
DECLARE
  v_bad INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'delivery_cycles_push_after_cutoff'
  ) THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_bad
  FROM delivery_cycles
  WHERE kitchen_push_time < cutoff_time;

  IF v_bad > 0 THEN
    RAISE WARNING '[kitchen_cutoff_push] % cycle(s) have kitchen_push_time < cutoff_time — constraint NOT added. Fix those rows, then re-run this file.', v_bad;
    RETURN;
  END IF;

  ALTER TABLE delivery_cycles
    ADD CONSTRAINT delivery_cycles_push_after_cutoff
    CHECK (kitchen_push_time >= cutoff_time);
END $$;


-- ── 6. Outcome alarm: did the push actually land? ─────────────
-- alert_cron_failures() (cron_failure_alert.sql) watches whether the JOB ran.
-- It cannot see the failure that matters here: the tick runs fine, claims the
-- row, and the push never reaches anyone — a missing secret, or a non-2xx
-- from send-push that pg_net only records asynchronously. That looks like a
-- healthy cron run and a populated log table.
--
-- So this checks the OUTCOME instead: any active cycle whose next delivery is
-- within the warning window and has no confirmed push. Fires while there is
-- still time to intervene, not after the delivery was missed.
CREATE OR REPLACE FUNCTION public.alert_missing_kitchen_pushes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net'
AS $$
DECLARE
  v_warn_before CONSTANT INTERVAL := INTERVAL '45 minutes';
  v_cycle    RECORD;
  v_today    DATE;
  v_offset   INTEGER;
  v_target   DATE;
  v_push_at  TIMESTAMPTZ;
  v_deadline TIMESTAMPTZ;
  v_i        INTEGER;
  v_problems TEXT := '';
  v_count    INTEGER := 0;
  v_url      TEXT;
  v_key      TEXT;
BEGIN
  v_today := (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE;

  FOR v_cycle IN
    SELECT dc.id, dc.cycle_name, dc.kitchen_push_time, dc.cutoff_time, dc.delivery_start
    FROM delivery_cycles dc
    WHERE dc.is_active = TRUE
  LOOP
    v_offset := CASE WHEN v_cycle.cutoff_time > v_cycle.delivery_start THEN 1 ELSE 0 END;

    FOR v_i IN 0..1 LOOP
      v_target   := v_today + v_i;
      v_push_at  := ((v_target - v_offset)::TIMESTAMP + v_cycle.kitchen_push_time)
                      AT TIME ZONE 'Asia/Kolkata';
      v_deadline := (v_target::TIMESTAMP + v_cycle.delivery_start)
                      AT TIME ZONE 'Asia/Kolkata';

      -- Only complain once the push was due AND the delivery is close.
      CONTINUE WHEN NOW() < v_push_at;
      CONTINUE WHEN NOW() < v_deadline - v_warn_before;
      CONTINUE WHEN NOW() >= v_deadline;

      CONTINUE WHEN EXISTS (
        SELECT 1
        FROM kitchen_push_log kpl
        WHERE kpl.cycle_id    = v_cycle.id
          AND kpl.push_date   = v_target
          AND kpl.notified_at IS NOT NULL
      );

      v_count    := v_count + 1;
      v_problems := v_problems
        || CASE WHEN v_problems = '' THEN '' ELSE '; ' END
        || v_cycle.cycle_name || ' → ' || v_target;
    END LOOP;
  END LOOP;

  IF v_count = 0 THEN
    RETURN;
  END IF;

  v_url := _kitchen_get_secret('supabase_url');
  v_key := _kitchen_get_secret('service_role_key');
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING '[alert_missing_kitchen_pushes] secrets missing — unpushed: %', v_problems;
    RETURN;
  END IF;

  -- Best-effort: an alerting problem must never fail the health check itself.
  BEGIN
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object(
        'role',           'admin',
        'title',          'Kitchen push missing',
        'body',           v_count || ' cycle(s) with no kitchen summary before delivery: ' || v_problems,
        'data',           jsonb_build_object('screen', 'JobHealth'),
        'trigger_source', 'kitchen_push_health'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[alert_missing_kitchen_pushes] push enqueue failed: %', SQLERRM;
  END;
END;
$$;

-- Every 10 minutes: inside a 45-minute warning window that is 4 chances to
-- notice before delivery. Re-nagging is deliberate, per cron_failure_alert.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'kitchen-push-missing-alert') THEN
    PERFORM cron.unschedule('kitchen-push-missing-alert');
  END IF;
END $$;

SELECT cron.schedule(
  'kitchen-push-missing-alert',
  '*/10 * * * *',
  $$SELECT public.alert_missing_kitchen_pushes()$$
);


-- ── 7. Manual helpers ─────────────────────────────────────────
--   Force a push (e.g. after a schema fix):
--     SELECT push_kitchen_summary(<cycle_id>, CURRENT_DATE);
--   Retry a specific date — clearing notified_at is enough now; the tick
--   re-pushes on its own within a minute (no need to DELETE the row):
--     UPDATE kitchen_push_log SET notified_at = NULL
--      WHERE cycle_id=<id> AND push_date='2026-04-17';
--   See recent pushes, newest first, with confirmation state:
--     SELECT cycle_id, push_date, status, attempts, notified_at, orders_count
--       FROM kitchen_push_log ORDER BY pushed_at DESC LIMIT 20;
--   Anything claimed but never confirmed (i.e. still being retried):
--     SELECT * FROM kitchen_push_log WHERE notified_at IS NULL;
--   Inspect a pg_net response:
--     SELECT * FROM net._http_response WHERE id = <http_request_id>;
--   Dry-run the outcome alarm:
--     SELECT public.alert_missing_kitchen_pushes();
