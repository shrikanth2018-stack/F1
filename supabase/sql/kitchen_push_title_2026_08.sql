-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — The batch-release push stops calling itself "Kitchen"
-- (2026-08-06)
--
-- This push is the batch release. It fires at every cycle's cutoff and is the
-- ONLY thing that puts orders on the staff screens — Kitchen and Packing
-- both. Essentials orders bypass the kitchen entirely (BF-34b: Confirmed →
-- Packed, no Ready step) but they are in the same cycle, so they are in the
-- same push, and their items appear in its summary line.
--
-- Titled "Kitchen order summary" that reads as an error. An evening batch of
-- one jar of ghee announced itself as kitchen work when there is nothing to
-- cook.
--
-- WHAT IS DELIBERATELY NOT CHANGED: the COUNT. Narrowing it to food would
-- make an essentials-only cycle count zero, short-circuit to the 'no_orders'
-- branch below, and send NO push — so nobody would be told there was packing
-- to do. The count is right; only the label was wrong.
--
-- Only the title string differs from the definition in kitchen_cutoff_push.sql
-- §3. Everything else — the claim/confirm logic, the retry semantics, the
-- Vault-then-app_config secret read — is carried over verbatim so this stays a
-- one-line change with the whole function shipped for `CREATE OR REPLACE`.
--
-- Deploy: supabase db query --linked --file supabase/sql/kitchen_push_title_2026_08.sql
-- Idempotent. Safe to re-run. Rollback at the bottom.
-- Supersedes: the push_kitchen_summary body in kitchen_cutoff_push.sql §3.
-- ═══════════════════════════════════════════════════════════════

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
  -- We consider orders that should actually reach staff: Confirmed / Paid /
  -- Preparing. Pending (awaiting razorpay webhook) is intentionally excluded.
  -- Food AND essentials — see the header: this is the batch release for both.
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

  -- Build the payload for the send-push Edge Function.
  --
  -- THE TITLE IS THE ONLY CHANGE IN THIS FILE. It says "Order summary"
  -- because this push releases the batch to Kitchen and Packing alike, and an
  -- essentials-only cycle has nothing to cook. There is no event_key, so this
  -- string is not editable from Notification Manager — it is changed here.
  v_payload := jsonb_build_object(
    'role',       'staff',
    'branch_id',  v_branch_id,
    'title',      'Order summary — ' || v_cycle.cycle_name,
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
  -- non-2xx from send-push is NOT visible here; §6 is what catches that.
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

NOTIFY pgrst, 'reload schema';

-- ── Verification ───────────────────────────────────────────────
-- The function must still count essentials. Against a cycle+date holding one
-- essentials order this returns 1, not 0 — that is what keeps the batch
-- reaching Packing:
--
--   BEGIN;
--     UPDATE kitchen_push_log SET notified_at = NULL
--      WHERE cycle_id = <c> AND push_date = '<YYYY-MM-DD>';
--     SELECT push_kitchen_summary(<c>, '<YYYY-MM-DD>');
--       -- expect status 'dispatched' and orders_count >= 1
--   ROLLBACK;
--
-- The title itself is only visible on a device. Send one and read the banner.

-- ── Rollback ───────────────────────────────────────────────────
-- Re-run supabase/sql/kitchen_cutoff_push.sql, which restores the whole file
-- including the "Kitchen order summary" title.
