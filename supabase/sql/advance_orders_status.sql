-- ============================================================
-- 1stOne F1 — bulk order-status advance (audit D6)
-- Applied to live DB 2026-05-19.
--
-- StaffDashboard's "Mark all Ready / Packed" used to fire a LOOP of N
-- single status mutations — N DB round-trips + N push calls. This RPC
-- advances every order in ONE transaction and fans the customer pushes
-- out server-side.
--
-- Push rule mirrors orderStatusPush.ts: only 'Ready' is a bulk-mark
-- milestone that notifies the customer ('order.ready'); 'Packed' is
-- intentionally silent (anti-spam, Blueprint 5.3). Push fan-out is
-- best-effort — a push hiccup never fails the status update.
--
-- SECURITY DEFINER (it reads app_config for the pg_net push) so it
-- bypasses RLS — guarded by an explicit staff/admin role check.
-- ============================================================

CREATE OR REPLACE FUNCTION public.advance_orders_status(
  p_order_ids bigint[],
  p_status    text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net'
AS $$
DECLARE
  v_role  text;
  v_count integer := 0;
  v_url   text;
  v_key   text;
  r       record;
BEGIN
  -- Gate: staff or admin only (SECURITY DEFINER bypasses RLS).
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'unauthorized: staff access required';
  END IF;

  IF p_order_ids IS NULL OR array_length(p_order_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  -- Push config — read once; if absent, the UPDATE still proceeds silently.
  IF p_status = 'Ready' THEN
    SELECT value INTO v_url FROM app_config WHERE key = 'supabase_url';
    SELECT value INTO v_key FROM app_config WHERE key = 'service_role_key';
  END IF;

  -- Bulk advance — one statement, one transaction. Skips terminal rows
  -- (Cancelled / Failed / Delivered) and no-ops (already at the target).
  FOR r IN
    WITH upd AS (
      UPDATE orders
      SET status = p_status, updated_at = now()
      WHERE id = ANY(p_order_ids)
        AND status NOT IN ('Cancelled', 'Failed', 'Delivered')
        AND status <> p_status
      RETURNING id, user_id
    )
    SELECT id, user_id FROM upd
  LOOP
    v_count := v_count + 1;

    -- Per-order customer push for the 'Ready' milestone — best-effort.
    IF p_status = 'Ready' AND r.user_id IS NOT NULL
       AND v_url IS NOT NULL AND v_key IS NOT NULL THEN
      BEGIN
        PERFORM net.http_post(
          url     := v_url || '/functions/v1/send-push',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || v_key
          ),
          body    := jsonb_build_object(
            'user_ids',       ARRAY[r.user_id],
            'event_key',      'order.ready',
            'vars',           jsonb_build_object('order_id', r.id),
            'title',          'Order Ready!',
            'body',           'Order #' || r.id || ' is packed and ready for dispatch.',
            'data',           jsonb_build_object(
                                 'screen', 'OrderDetail',
                                 'params', jsonb_build_object('orderId', r.id)
                              ),
            'trigger_source', 'order_status',
            'reference_id',   r.id::text
          )
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '[advance_orders_status] push for order % failed: %', r.id, SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_orders_status(bigint[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.advance_orders_status(bigint[], text) TO authenticated;

NOTIFY pgrst, 'reload schema';
