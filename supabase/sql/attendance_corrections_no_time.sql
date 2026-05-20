-- 1stOne F1 — Attendance corrections: drop the per-day time fields.
--
-- The first cut had staff enter clock_in / clock_out per day. Owner
-- spec on review: staff picks days only. Time is no longer captured —
-- the approve RPC computes the clock_in_time from the staff's
-- shift_timing ("HH:MM-HH:MM") and the_date; clock_out_time stays NULL
-- (which counts as Present per [[attendance-open-shift]]). If
-- shift_timing is missing or malformed, falls back to 09:00 IST.

ALTER TABLE public.attendance_correction_days
  DROP COLUMN IF EXISTS clock_in_time,
  DROP COLUMN IF EXISTS clock_out_time;

-- Rebuild approve RPC: inserts staff_attendance with the
-- shift-derived clock_in_time, NULL clock_out_time, NULL/derived
-- coords (since this is a backfill, not a live clock-in).
CREATE OR REPLACE FUNCTION public.approve_attendance_correction(p_request_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin     UUID := auth.uid();
  v_staff     UUID;
  v_branch    INTEGER;
  v_status    TEXT;
  v_count     INTEGER := 0;
  v_day       RECORD;
  v_conflict  RECORD;
  v_shift     TEXT;
  v_start_hm  TEXT;
  v_clock_in  TIMESTAMPTZ;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized: only admin may approve attendance corrections';
  END IF;

  SELECT staff_id, branch_id, status
  INTO v_staff, v_branch, v_status
  FROM public.attendance_correction_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'attendance correction request % not found', p_request_id;
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'request % is already %', p_request_id, v_status;
  END IF;

  SELECT d.the_date INTO v_conflict
  FROM public.attendance_correction_days d
  JOIN public.staff_attendance sa
    ON sa.staff_id = v_staff
   AND sa.date = d.the_date
  WHERE d.request_id = p_request_id
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      'conflict: staff_attendance already exists for %, resolve before approval',
      v_conflict.the_date;
  END IF;

  -- Resolve a default clock-in time from the staff's shift_timing
  -- ("HH:MM-HH:MM"). 09:00 IST fallback when shift_timing is missing
  -- or malformed.
  SELECT shift_timing INTO v_shift FROM public.profiles WHERE id = v_staff;
  v_start_hm := CASE
    WHEN v_shift ~ '^[0-9]{2}:[0-9]{2}-[0-9]{2}:[0-9]{2}$' THEN split_part(v_shift, '-', 1)
    ELSE '09:00'
  END;

  FOR v_day IN
    SELECT * FROM public.attendance_correction_days
    WHERE request_id = p_request_id
    ORDER BY the_date
  LOOP
    v_clock_in := (v_day.the_date::TEXT || ' ' || v_start_hm || ':00 Asia/Kolkata')::TIMESTAMPTZ;

    INSERT INTO public.staff_attendance (
      staff_id, date, clock_in_time, clock_out_time, branch_id
    ) VALUES (
      v_staff, v_day.the_date, v_clock_in, NULL, v_branch
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.attendance_correction_requests
  SET status      = 'approved',
      reviewed_by = v_admin,
      reviewed_at = NOW(),
      updated_at  = NOW()
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'request_id', p_request_id,
    'days_applied', v_count,
    'approved_by', v_admin,
    'approved_at', NOW()
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
