-- 1stOne F1 — Attendance Corrections (multi-day backfill)
--
-- Staff who forgot to clock in/out for one or more past days submit a
-- single request listing those days + their intended clock-in/clock-out
-- times + a reason. Admin reviews from Resource Manager and approves
-- or rejects. On approval an RPC inserts the staff_attendance rows
-- atomically; conflicts (a clock-in already exists for a requested day)
-- block the approval cleanly so admin must intervene manually.
--
-- Default policy [[attendance-open-shift]] stays intact for self-service
-- clock-ins: an open clock-in (NULL clock_out_time) still reads as
-- "Present for the day". Corrections only backfill missing rows.

-- ── Tables ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.attendance_correction_requests (
  id            BIGSERIAL PRIMARY KEY,
  staff_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  reviewed_by   UUID REFERENCES public.profiles(id),
  reviewed_at   TIMESTAMPTZ,
  reviewer_note TEXT,
  branch_id     INTEGER REFERENCES public.branches(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_correction_requests_staff
  ON public.attendance_correction_requests (staff_id);
CREATE INDEX IF NOT EXISTS idx_attendance_correction_requests_status_branch
  ON public.attendance_correction_requests (status, branch_id);

CREATE TABLE IF NOT EXISTS public.attendance_correction_days (
  id              BIGSERIAL PRIMARY KEY,
  request_id      BIGINT NOT NULL REFERENCES public.attendance_correction_requests(id) ON DELETE CASCADE,
  the_date        DATE   NOT NULL,
  clock_in_time   TIMESTAMPTZ NOT NULL,
  clock_out_time  TIMESTAMPTZ,
  UNIQUE (request_id, the_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_correction_days_request
  ON public.attendance_correction_days (request_id);

-- updated_at trigger reuses the project's standard column-bumper.
DROP TRIGGER IF EXISTS trg_attendance_correction_requests_updated
  ON public.attendance_correction_requests;
CREATE TRIGGER trg_attendance_correction_requests_updated
  BEFORE UPDATE ON public.attendance_correction_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── branch_id derivation trigger (same shape as expense_claims) ─

CREATE OR REPLACE FUNCTION public.set_attendance_correction_branch_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    SELECT branch_id INTO NEW.branch_id
    FROM profiles WHERE id = NEW.staff_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_correction_branch_id
  ON public.attendance_correction_requests;
CREATE TRIGGER trg_attendance_correction_branch_id
  BEFORE INSERT ON public.attendance_correction_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_attendance_correction_branch_id();

-- ── RLS ─────────────────────────────────────────────────────────

ALTER TABLE public.attendance_correction_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_correction_days ENABLE ROW LEVEL SECURITY;

-- Staff can SELECT + INSERT their own requests. UPDATE is reserved
-- for admin (via the approve/reject RPC under SECURITY DEFINER).
DROP POLICY IF EXISTS attendance_correction_requests_self_read
  ON public.attendance_correction_requests;
CREATE POLICY attendance_correction_requests_self_read
  ON public.attendance_correction_requests
  FOR SELECT
  USING (staff_id = auth.uid());

DROP POLICY IF EXISTS attendance_correction_requests_self_insert
  ON public.attendance_correction_requests;
CREATE POLICY attendance_correction_requests_self_insert
  ON public.attendance_correction_requests
  FOR INSERT
  WITH CHECK (
    staff_id = auth.uid()
    AND status = 'pending'
  );

-- Admin SELECT/UPDATE within branch.
DROP POLICY IF EXISTS attendance_correction_requests_admin
  ON public.attendance_correction_requests;
CREATE POLICY attendance_correction_requests_admin
  ON public.attendance_correction_requests
  FOR ALL
  USING (public.is_admin() AND public.has_branch_access(branch_id))
  WITH CHECK (public.is_admin() AND public.has_branch_access(branch_id));

-- Days table — staff can SELECT/INSERT only for their own requests;
-- admin can SELECT all within branch (via the request's branch_id).
DROP POLICY IF EXISTS attendance_correction_days_self
  ON public.attendance_correction_days;
CREATE POLICY attendance_correction_days_self
  ON public.attendance_correction_days
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.attendance_correction_requests r
      WHERE r.id = attendance_correction_days.request_id
        AND r.staff_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.attendance_correction_requests r
      WHERE r.id = attendance_correction_days.request_id
        AND r.staff_id = auth.uid()
        AND r.status = 'pending'
    )
  );

DROP POLICY IF EXISTS attendance_correction_days_admin
  ON public.attendance_correction_days;
CREATE POLICY attendance_correction_days_admin
  ON public.attendance_correction_days
  FOR SELECT
  USING (
    public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.attendance_correction_requests r
      WHERE r.id = attendance_correction_days.request_id
        AND public.has_branch_access(r.branch_id)
    )
  );

-- ── Approve RPC (atomic insert into staff_attendance + mark approved) ─

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
  v_conflict  RECORD;
  v_inserted  BIGINT[]  := ARRAY[]::BIGINT[];
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized: only admin may approve attendance corrections';
  END IF;

  -- Lock the request so two admins can't approve concurrently.
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

  -- Conflict check: refuse if any requested day already has a
  -- staff_attendance row for this staff. Admin must resolve manually
  -- (delete the existing row or reject the request) before re-approve.
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

  -- Insert one staff_attendance row per requested day.
  FOR v_conflict IN
    SELECT * FROM public.attendance_correction_days
    WHERE request_id = p_request_id
    ORDER BY the_date
  LOOP
    INSERT INTO public.staff_attendance (
      staff_id, date, clock_in_time, clock_out_time, branch_id
    ) VALUES (
      v_staff, v_conflict.the_date, v_conflict.clock_in_time,
      v_conflict.clock_out_time, v_branch
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

REVOKE ALL ON FUNCTION public.approve_attendance_correction(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_attendance_correction(BIGINT) TO authenticated;

-- ── Reject RPC (admin notes the reason, sets rejected) ──────────

CREATE OR REPLACE FUNCTION public.reject_attendance_correction(
  p_request_id BIGINT,
  p_note       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin  UUID := auth.uid();
  v_status TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized: only admin may reject attendance corrections';
  END IF;

  SELECT status INTO v_status
  FROM public.attendance_correction_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'attendance correction request % not found', p_request_id;
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'request % is already %', p_request_id, v_status;
  END IF;

  UPDATE public.attendance_correction_requests
  SET status        = 'rejected',
      reviewed_by   = v_admin,
      reviewed_at   = NOW(),
      reviewer_note = p_note,
      updated_at    = NOW()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('request_id', p_request_id, 'rejected_by', v_admin);
END;
$$;

REVOKE ALL ON FUNCTION public.reject_attendance_correction(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_attendance_correction(BIGINT, TEXT) TO authenticated;

-- Force PostgREST schema-cache reload so the new tables + RPCs are callable.
NOTIFY pgrst, 'reload schema';
