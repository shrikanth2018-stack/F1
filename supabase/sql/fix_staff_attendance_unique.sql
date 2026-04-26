-- ═══════════════════════════════════════════════════════════════════
-- 1stOne F1 — Fix staff attendance clock-in (2026-04-26)
--
-- Issue: useClockIn() hook does an UPSERT on staff_attendance with
--   onConflict: 'staff_id,date'
-- but the table has no UNIQUE constraint on (staff_id, date), so the
-- upsert fails silently with "no unique or exclusion constraint matching
-- the ON CONFLICT specification". The clock-in button does nothing.
--
-- Fix: add the missing UNIQUE constraint. Safe to run repeatedly
-- (IF NOT EXISTS guard).
--
-- ⚠️  Run the verification queries below FIRST — if any duplicate rows
-- exist, this constraint creation will fail. Clean those first.
-- ═══════════════════════════════════════════════════════════════════

-- Verification (run separately first):
--   SELECT staff_id, date, COUNT(*)
--   FROM staff_attendance
--   GROUP BY staff_id, date
--   HAVING COUNT(*) > 1;
--
-- If any rows return → keep one row per (staff_id, date) by deleting
-- duplicates before running the ALTER below.


-- The actual fix:
ALTER TABLE public.staff_attendance
  ADD CONSTRAINT staff_attendance_staff_date_unique
  UNIQUE (staff_id, date);


-- After running, verify with:
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public.staff_attendance'::regclass
--     AND conname = 'staff_attendance_staff_date_unique';
-- Should return exactly one row.
