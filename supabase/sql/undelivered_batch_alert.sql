-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Alert admin when a batch is replaced with work still in it
--
-- WHY. Every operational board shows exactly one batch, and a row leaves it
-- when the next kitchen push lands. That rule is what keeps the boards
-- readable, but on its own it is also a way to lose an order silently: the
-- Breakfast bag nobody delivered simply stops being on any screen at 11:00
-- when Lunch is released, and the only place it still appears is a tab in
-- the back office that somebody has to think to open.
--
-- So the moment the board flips, whatever was left behind is counted and the
-- admins are told. This is the notification that makes
-- Admin → Orders → Undelivered a thing you are sent to rather than a thing
-- you must remember to check.
--
-- WHERE IT FIRES. Inside push_kitchen_summary, at the point the new batch is
-- CLAIMED — the same instant get_active_staff_batch starts returning the new
-- cycle, which is what actually moves the boards. Not on a timer, so the
-- alert cannot arrive before or after the thing it describes.
--
-- Three properties worth keeping:
--
--   • ONE PUSH PER FLIP, not one per order. Ten stranded orders are one
--     problem with a list in it, and ten notifications is how people learn
--     to swipe this app away.
--   • SILENT WHEN CLEAN. Nothing is sent when the outgoing batch finished,
--     which is the normal day. An alert that fires every cycle is furniture.
--   • BEST EFFORT. The whole thing is wrapped so that a failure to notify
--     can never roll back the claim or block the kitchen summary. A missed
--     alert is bad; a kitchen that never got its list because the alert
--     failed is worse.
--
-- The last cycle of the day has no following push until tomorrow morning, so
-- its leftovers are reported then rather than overnight. That is deliberate
-- — see the note at the foot of this file if that ever needs changing.
--
-- Depends on: kitchen_cutoff_push.sql (push_kitchen_summary, _kitchen_get_secret)
-- Deploy: paste into the Supabase SQL editor, AFTER kitchen_cutoff_push.sql.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Admin-editable copy ─────────────────────────────────────
-- Same mechanism as every other push: admin can reword it or switch it off
-- from Manage → Notifications without a deploy.
INSERT INTO notification_templates (event_key, title_template, body_template, trigger_source, description)
VALUES (
  'admin.orders_undelivered',
  '{{count}} order(s) left undelivered',
  '{{cycle_name}} ({{push_date}}) closed with {{count}} order(s) not delivered: {{order_ids}}.',
  'undelivered_batch',
  'Fires when a kitchen push replaces the live boards and the outgoing batch still had undelivered orders in it.'
)
ON CONFLICT (event_key) DO NOTHING;


-- ── 2. The alert itself ────────────────────────────────────────
-- Separate function rather than inline in push_kitchen_summary: it can be
-- dry-run on any past batch to see exactly what would have been sent.
CREATE OR REPLACE FUNCTION public.alert_undelivered_batch(
  p_cycle_id  INTEGER,
  p_push_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net'
AS $$
DECLARE
  v_count      INTEGER;
  v_ids        TEXT;
  v_cycle_name TEXT;
  v_url        TEXT;
  v_key        TEXT;
BEGIN
  -- What was still open in the batch that just stopped being live.
  --
  -- Cancelled and Failed are not "undelivered" — somebody already decided
  -- those. Delivered is the finish line. Everything else in the batch is an
  -- order that was released to the kitchen and never reached the customer,
  -- whatever stage it stalled at.
  SELECT COUNT(*)::INTEGER,
         string_agg('#' || o.id::TEXT, ', ' ORDER BY o.id)
  INTO v_count, v_ids
  FROM orders o
  WHERE o.cycle_id      = p_cycle_id
    AND o.dispatch_date = p_push_date
    AND o.status NOT IN ('Delivered', 'Cancelled', 'Failed');

  IF COALESCE(v_count, 0) = 0 THEN
    RETURN jsonb_build_object('status', 'clean', 'cycle_id', p_cycle_id, 'push_date', p_push_date);
  END IF;

  SELECT cycle_name INTO v_cycle_name FROM delivery_cycles WHERE id = p_cycle_id;

  v_url := _kitchen_get_secret('supabase_url');
  v_key := _kitchen_get_secret('service_role_key');
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING '[alert_undelivered_batch] secrets missing — % undelivered in cycle % on %',
      v_count, p_cycle_id, p_push_date;
    RETURN jsonb_build_object('status', 'no_secret', 'count', v_count);
  END IF;

  -- event_key so the copy stays admin-editable; title/body are the fallback
  -- send-push uses if the template row is ever deleted.
  PERFORM net.http_post(
    url     := v_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object(
      'role',      'admin',
      'event_key', 'admin.orders_undelivered',
      'vars',      jsonb_build_object(
        'count',      v_count,
        'cycle_name', COALESCE(v_cycle_name, 'A cycle'),
        'push_date',  p_push_date::TEXT,
        'order_ids',  v_ids
      ),
      'title',     v_count || ' order(s) left undelivered',
      'body',      COALESCE(v_cycle_name, 'A cycle') || ' (' || p_push_date::TEXT
                     || ') closed with ' || v_count || ' order(s) not delivered: ' || v_ids || '.',
      -- Lands the admin ON the Undelivered tab, not merely on the orders
      -- screen: being told three orders were stranded and then dropped onto
      -- today's list means hunting for what you were just told.
      'data',           jsonb_build_object(
                          'screen', 'AdminOrders',
                          'params', jsonb_build_object('view', 'undelivered')
                        ),
      'trigger_source', 'undelivered_batch',
      'reference_id',   p_cycle_id::TEXT || ':' || p_push_date::TEXT
    )
  );

  RETURN jsonb_build_object(
    'status', 'sent', 'count', v_count,
    'cycle_id', p_cycle_id, 'push_date', p_push_date, 'order_ids', v_ids
  );
END;
$$;


-- ── 3. Hook it to the moment the board flips ───────────────────
-- push_kitchen_summary is re-created in full here rather than patched,
-- because there is no way to insert a step into a plpgsql body from outside
-- it.
--
-- BASED ON kitchen_push_title_2026_08.sql, NOT on kitchen_cutoff_push.sql §3.
-- That later file supersedes the original body and is what is live: it titles
-- the push "Order summary — <cycle>" rather than "Kitchen order summary",
-- because the batch release reaches Packing as well and an essentials-only
-- cycle has nothing to cook. Rebuilding from the older §3 would have quietly
-- undone that. If either file is edited again, re-apply this one after it.
--
-- Differences from that version: two additions, both marked ADDED below, and
-- one correction — the two status lists read ('Confirmed', 'Preparing')
-- where they used to read ('Confirmed', 'Paid', 'Preparing'). 'Paid' was
-- removed from the orders status CHECK constraint on 2026-05-19
-- (orders_status_drop_paid.sql), so that arm had matched nothing since.
-- Nothing else about the function changes.
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
  v_prev         RECORD;   -- ADDED: the batch this push is about to replace
  v_is_new       BOOLEAN;  -- ADDED: did this call create a new claim, or retry one?
BEGIN
  SELECT id, cycle_name, branch_id
  INTO v_cycle
  FROM delivery_cycles
  WHERE id = p_cycle_id AND is_active = TRUE;

  IF v_cycle IS NULL THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'cycle not found or inactive');
  END IF;

  v_branch_id := v_cycle.branch_id;

  -- ADDED: read the currently-active batch BEFORE claiming, because the
  -- claim below is what makes this push the active one. Same ordering
  -- get_active_staff_batch uses — INCLUDING the id tiebreak, so the two
  -- cannot disagree about which batch is live. Two rows sharing a pushed_at
  -- is not hypothetical: now() is frozen for a transaction, so any two
  -- pushes made in one (a manual backfill, a tick handling two cycles)
  -- record the same instant, and `ORDER BY pushed_at DESC LIMIT 1` alone
  -- then picks one arbitrarily.
  SELECT kpl.cycle_id, kpl.push_date
  INTO v_prev
  FROM kitchen_push_log kpl
  JOIN delivery_cycles dc ON dc.id = kpl.cycle_id
  WHERE dc.branch_id IS NOT DISTINCT FROM v_branch_id
  ORDER BY kpl.pushed_at DESC, kpl.id DESC
  LIMIT 1;

  -- Count orders for this cycle + date (includes both ad-hoc and
  -- subscription-driven). Orders that should actually reach staff: Confirmed
  -- / Preparing. Pending (awaiting the razorpay webhook) is intentionally
  -- excluded. Food AND essentials — this is the batch release for both, and
  -- narrowing it to food would make an essentials-only cycle count zero,
  -- short-circuit to 'no_orders', and tell nobody there was packing to do.
  SELECT COUNT(*)::INTEGER
  INTO v_orders_count
  FROM orders o
  WHERE o.cycle_id       = p_cycle_id
    AND o.dispatch_date  = p_target_date
    AND o.status         IN ('Confirmed', 'Preparing');

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
      AND o.status        IN ('Confirmed', 'Preparing')
    GROUP BY oi.item_name
  ) agg;

  -- CLAIM the cycle+date. UNIQUE (cycle_id, push_date) still enforces one
  -- push per delivery date, but we re-claim a row whose notified_at is NULL:
  -- that row represents an attempt that never actually reached anyone.
  INSERT INTO kitchen_push_log (cycle_id, push_date, orders_count, items_summary, status, attempts)
  VALUES (p_cycle_id, p_target_date, v_orders_count, COALESCE(v_summary, ''), 'pending', 1)
  ON CONFLICT (cycle_id, push_date) DO UPDATE
    SET orders_count  = EXCLUDED.orders_count,
        items_summary = EXCLUDED.items_summary,
        status        = 'pending',
        attempts      = kitchen_push_log.attempts + 1
    WHERE kitchen_push_log.notified_at IS NULL
  -- ADDED: xmax = 0 is true only for a row this statement INSERTED. On the
  -- DO UPDATE path it is the id of the updating transaction, i.e. non-zero.
  -- That distinguishes a genuinely new batch from a retry of an unconfirmed
  -- one exactly, rather than inferring it by comparing v_prev to the
  -- arguments — an inference that also depended on the ordering above being
  -- unambiguous.
  RETURNING id, (xmax = 0) INTO v_log_id, v_is_new;

  -- No row returned → a CONFIRMED push already exists for this cycle+date.
  IF v_log_id IS NULL THEN
    RETURN jsonb_build_object('status', 'duplicate', 'cycle_id', p_cycle_id, 'target_date', p_target_date);
  END IF;

  -- ADDED: the boards have just flipped. Report whatever the outgoing batch
  -- still had open.
  --
  -- Only on a NEW claim. A retry of an unconfirmed claim is not a flip — the
  -- boards are already showing this batch — and alerting there would report
  -- the incoming batch as abandoned every time a push was retried.
  --
  -- Wrapped, and deliberately so. This is a notification hanging off the
  -- kitchen's critical path; if it throws, the kitchen loses its summary.
  IF v_is_new
     AND v_prev.cycle_id IS NOT NULL
     AND NOT (v_prev.cycle_id = p_cycle_id AND v_prev.push_date = p_target_date) THEN
    BEGIN
      PERFORM public.alert_undelivered_batch(v_prev.cycle_id, v_prev.push_date);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[push_kitchen_summary] undelivered alert failed for cycle % on %: %',
        v_prev.cycle_id, v_prev.push_date, SQLERRM;
    END;
  END IF;

  -- Short-circuit: no orders. Confirmed rather than left pending — the cutoff
  -- has passed, so no further orders can land on this date.
  IF v_orders_count = 0 THEN
    UPDATE kitchen_push_log
    SET status = 'no_orders', notified_at = NOW()
    WHERE id = v_log_id;
    RETURN jsonb_build_object('status', 'no_orders', 'cycle_id', p_cycle_id, 'target_date', p_target_date);
  END IF;

  -- "Order summary", not "Kitchen order summary" — carried over verbatim from
  -- kitchen_push_title_2026_08.sql. This push releases the batch to Kitchen
  -- AND Packing, and an essentials-only cycle has nothing to cook. There is
  -- no event_key, so the string is not editable from Notification Manager.
  v_payload := jsonb_build_object(
    'role',       'staff',
    'branch_id',  v_branch_id,
    'title',      'Order summary — ' || v_cycle.cycle_name,
    'body',       v_orders_count || ' orders ready to start. ' || COALESCE(v_summary, ''),
    'data',       jsonb_build_object('screen', 'StaffDashboard', 'cycle_id', p_cycle_id)
  );

  v_url := _kitchen_get_secret('supabase_url');
  v_key := _kitchen_get_secret('service_role_key');

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING '[push_kitchen_summary] Missing supabase_url or service_role_key (vault + app_config)';
    UPDATE kitchen_push_log SET status = 'no_secret' WHERE id = v_log_id;
    RETURN jsonb_build_object('status', 'no_secret', 'cycle_id', p_cycle_id);
  END IF;

  SELECT net.http_post(
    url     := v_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := v_payload
  ) INTO v_req_id;

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

REVOKE ALL ON FUNCTION public.alert_undelivered_batch(INTEGER, DATE) FROM PUBLIC, anon, authenticated;


-- ── 4. Make "which batch is live" deterministic ────────────────
-- get_active_staff_batch decides what every operational board shows, and
-- push_kitchen_summary above must agree with it about which batch is being
-- replaced. Both order by pushed_at DESC — which is a partial order, because
-- now() is frozen for the length of a transaction: any two pushes made in one
-- (a manual backfill over several cycles, a tick that handles two) carry the
-- identical timestamp, and LIMIT 1 then picks between them arbitrarily. Two
-- callers could pick differently, and the boards could pick differently on
-- two consecutive reads.
--
-- No tie exists in the live table today — this is closing it before it can
-- open. The id tiebreak is a no-op whenever pushed_at already differs, which
-- is every row currently in there.
--
-- Otherwise identical to get_active_staff_batch.sql.
CREATE OR REPLACE FUNCTION get_active_staff_batch(p_branch_id int DEFAULT NULL)
RETURNS TABLE (cycle_id int, push_date date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT kpl.cycle_id, kpl.push_date
  FROM kitchen_push_log kpl
  JOIN delivery_cycles dc ON dc.id = kpl.cycle_id
  WHERE p_branch_id IS NULL OR dc.branch_id = p_branch_id
  ORDER BY kpl.pushed_at DESC, kpl.id DESC
  LIMIT 1;
$$;

NOTIFY pgrst, 'reload schema';

-- ── Notes ──────────────────────────────────────────────────────
-- Dry-run against any past batch — counts and reports, and will actually
-- send, so use a batch you do not mind being notified about:
--   SELECT public.alert_undelivered_batch(<cycle_id>, '2026-08-09');
--
-- See what a flip would report without sending anything:
--   SELECT o.cycle_id, o.dispatch_date, count(*), string_agg('#'||o.id, ', ')
--     FROM orders o
--    WHERE o.status NOT IN ('Delivered','Cancelled','Failed')
--    GROUP BY 1, 2 ORDER BY 2 DESC;
--
-- THE LAST CYCLE OF THE DAY reports its leftovers at the next morning's
-- push, because nothing replaces its board before then. If that wait is ever
-- too long, the place to add a second trigger is alert_missing_kitchen_pushes
-- in kitchen_cutoff_push.sql §6 — it already walks every active cycle on a
-- 10-minute timer and knows each one's delivery_start.
