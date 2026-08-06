-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — A failed dispatch run left no trace anywhere (2026-08-06)
--
-- `generate_daily_manifest` ends with its own safety net: on any error that
-- escapes the per-subscription block it writes a `manifest_run_log` row
-- recording the failure, then re-RAISEs. `trigger_kitchen_cutoff_pushes`
-- wraps the call in its own BEGIN/EXCEPTION for per-cycle isolation.
--
-- PL/pgSQL exception blocks are savepoints. When the caller's handler fires
-- it rolls back to before the entire call — undoing everything the callee
-- did, INCLUDING the audit row its own handler just wrote. The only survivor
-- is a RAISE WARNING, which is a Postgres server-log line nothing here reads.
--
-- Proven on scratch objects (the real function untouched): callee catches,
-- logs, re-raises; caller catches to isolate; audit rows surviving = 0.
--
-- So on the one day a whole cycle's subscription dispatch genuinely fails:
--   manifest_run_log        looks like a normal day
--   cron.job_run_details    says 'succeeded' — the per-cycle catch never lets
--                           the error reach cron
--   Job Health              shows both of the above, and therefore nothing
--
-- Indistinguishable from a day with nothing to dispatch. This is the same
-- silent-failure shape as the kitchen push writing its log row before the
-- push was actually sent.
--
-- THE FIX is to log from the CALLER's handler. That code runs after the
-- savepoint rollback, so its insert is not undone. The callee keeps its own
-- handler — that one still works when the function is called directly (a
-- manual re-run, or backfill_dispatch_manifest), and the two cannot
-- double-log because whichever path runs, only one of them survives.
--
-- Deploy: supabase db query --linked --file supabase/sql/manifest_failure_visible.sql
-- Idempotent. Safe to re-run. Requires kitchen_cutoff_push.sql applied first.
-- Rollback at the bottom.
-- ═══════════════════════════════════════════════════════════════

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

    FOR v_i IN -1..1 LOOP
      v_target   := v_today + v_i;
      v_push_at  := ((v_target - v_offset)::TIMESTAMP + v_cycle.kitchen_push_time)
                      AT TIME ZONE 'Asia/Kolkata';
      v_deadline := (v_target::TIMESTAMP + v_cycle.delivery_start)
                      AT TIME ZONE 'Asia/Kolkata';

      CONTINUE WHEN NOW() < v_push_at OR NOW() >= v_deadline;

      CONTINUE WHEN EXISTS (
        SELECT 1
        FROM kitchen_push_log kpl
        WHERE kpl.cycle_id    = v_cycle.id
          AND kpl.push_date   = v_target
          AND kpl.notified_at IS NOT NULL
      );

      BEGIN
        PERFORM generate_daily_manifest(
          p_target_date => v_target,
          p_cycle_id    => v_cycle.id
        );
        PERFORM push_kitchen_summary(v_cycle.id, v_target);
      EXCEPTION WHEN OTHERS THEN
        -- This handler runs AFTER the savepoint rollback, so anything it
        -- writes survives — which is exactly why the audit row has to be
        -- written HERE and not inside generate_daily_manifest, whose own
        -- row is discarded along with the rest of the failed call.
        --
        -- Best-effort: a logging failure must not abort the remaining
        -- cycles, which is the whole point of this isolation block.
        BEGIN
          INSERT INTO manifest_run_log
            (run_date, orders_created, orders_skipped, subs_skipped, error_detail)
          VALUES
            (v_target, 0, 0, 0,
             format('cycle %s failed: %s', v_cycle.id, SQLERRM));
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING '[trigger_kitchen_cutoff_pushes] could not record failure: %', SQLERRM;
        END;

        RAISE WARNING '[trigger_kitchen_cutoff_pushes] cycle % target % failed: %',
          v_cycle.id, v_target, SQLERRM;
      END;
    END LOOP;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ── Verification ───────────────────────────────────────────────
-- Break the callee inside a transaction and confirm the row now survives the
-- caller's isolation block. Rolled back, so the real function is restored:
--
--   BEGIN;
--     -- temporarily make generate_daily_manifest raise, call
--     -- trigger_kitchen_cutoff_pushes(), then:
--     SELECT count(*) FROM manifest_run_log WHERE error_detail LIKE 'cycle % failed:%';
--     -- expect: >= 1   (was: 0)
--   ROLLBACK;
--
-- Then read it where the owner would: Admin → Operations → Job Health, which
-- surfaces manifest_run_log directly.

-- ── Rollback ───────────────────────────────────────────────────
-- Re-run supabase/sql/kitchen_cutoff_push.sql, which restores the previous
-- definition of trigger_kitchen_cutoff_pushes (and everything else in it).
