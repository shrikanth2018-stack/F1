-- ═══════════════════════════════════════════════════════════════════════
-- 1stOne F1 — the printed slip and the driver's own screen name the same
--             person                                          (2026-08-17)
--
-- THE BUG
--
-- Driver identity is stored TWICE on `delivery_zones` and `delivery_hubs`:
--
--   driver_user_id  the real assignment. What the driver's own
--                   "My Deliveries" board reads (via the is_driver JWT claim).
--   driver_code     a denormalised COPY of that person's employee_id, kept for
--                   display. What the packing slip groups by
--                   (StaffDashboard `getDriverInfoFor` → "By Driver") and what
--                   the admin order detail prints.
--
-- Nothing kept the copy in step, and on 2026-08-17 all four routes had drifted:
--
--   Zone 1     driver_code 1ST-2026-001   driver_user_id → Driver One
--   Kolsirsi   driver_code 1ST-2026-001   driver_user_id → Driver Two
--   Shiralagi  driver_code 1ST-2026-001   driver_user_id → Driver Two
--   Bilagi     driver_code 1ST-2026-001   driver_user_id → Driver Two
--
-- `1ST-2026-001` is **Driver 33's** employee number — a staff member no longer
-- assigned as the driver anywhere. So every bag printed under a driver who was
-- not delivering it, while the driver's own screen was correct. Two surfaces,
-- one fact, opposite answers — the failure mode this codebase keeps producing.
--
-- THE DECISION (owner, 2026-08-17): **driver_user_id is the truth.**
--
-- So `driver_code` stops being an independently-writable value and becomes a
-- projection the database maintains. That is the house pattern for a
-- denormalised column — the same shape as `derive_address_branch_id` and
-- `derive_profile_branch_id` — and it is why those columns do not drift.
--
-- Fixed in the database rather than in the app on purpose: the app already
-- sends the right thing when it knows it, the slip and the admin screen need
-- no change, and there is no release to ship. The two screens keep reading
-- `driver_code`; it is simply no longer allowed to be wrong.
--
-- WHY THE EMPLOYEE NUMBERS COME FIRST
--
-- The projection is `driver_user_id → that profile's employee_id`, so a driver
-- with no employee number has nothing to project. Six staff/admin profiles
-- created in bulk on 13 Aug had none — including BOTH drivers — because a bulk
-- insert skips `elevate_to_staff`, which is the only thing that mints one.
-- §1 mints the missing ones from the same sequence, in the same format.
--
-- ONLY employee_id IS BACKFILLED. `designation` is deliberately left alone:
-- `elevate_to_staff` treats it as the ROLE discriminator ('ADMIN HEAD' → admin),
-- so writing designations from a script is a way to change someone's role by
-- accident. `shift_timing` is left alone too — it decides the clock-in time an
-- approved attendance correction records. Both belong to the Onboard Employee
-- screen, where a human is choosing them.
--
-- DRY-RUN THIS INSIDE BEGIN … ROLLBACK FIRST — BUT NOTE THIS FIRST:
--
-- ⚠ `nextval()` IS NOT TRANSACTIONAL. A ROLLBACK undoes the UPDATEs in §1 but
-- NOT the sequence advance, so every dry run permanently burns one employee
-- number per profile it would have minted. Two dry runs of this file moved
-- `employee_id_seq` from 6 to 22 and would have produced 1ST-2026-015 upward —
-- exactly the gappy series `elevate_employee_reonboard.sql` was written to stop.
--
-- Before the real run, put the sequence back where the dry run found it:
--
--   SELECT last_value, is_called FROM employee_id_seq;      -- note these first
--   SELECT setval('employee_id_seq', <last_value>, <is_called>);
--
-- On this database that was `setval('employee_id_seq', 6, true)`, and the real
-- run then minted 1ST-2026-007 upward with no gap.
--
-- Deploy: supabase db query --linked --file supabase/sql/driver_code_follows_driver.sql
-- Idempotent — re-running mints nothing new and changes no code.
-- ═══════════════════════════════════════════════════════════════════════


-- ── §1  Mint the missing employee numbers ─────────────────────────────
--
-- Same sequence and same format as `elevate_to_staff`:
--   '1ST-' || year || '-' || 3-digit sequence
-- so a number minted here is indistinguishable from one minted by onboarding,
-- and the series has no gap. Ordered by phone number purely so a re-run of the
-- dry run assigns the same numbers and the report is comparable.
--
-- Staff and admins only. A customer has no employee number by definition.
DO $$
DECLARE r RECORD; v_id TEXT; v_count INT := 0;
BEGIN
  FOR r IN
    SELECT id, phone_number, full_name, role
    FROM public.profiles
    WHERE role IN ('staff', 'admin')
      AND employee_id IS NULL
    ORDER BY phone_number
  LOOP
    v_id := '1ST-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT
                   || '-' || LPAD(nextval('employee_id_seq')::TEXT, 3, '0');
    UPDATE public.profiles SET employee_id = v_id WHERE id = r.id;
    RAISE NOTICE 'minted % for % (%, %)', v_id, r.full_name, r.phone_number, r.role;
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE '§1 minted % employee number(s)', v_count;
END $$;


-- ── §2  driver_code becomes a projection of driver_user_id ────────────
--
-- Three rules, and the third is the important one:
--
--   no driver          → no code. A route with nobody assigned must not keep
--                        the last person's number.
--   driver has a number → that number, always. This is the correction.
--   driver has none     → leave whatever the caller sent.
--
-- That last rule is deliberate restraint. `HubDetailScreen` and
-- `ZoneEditorModal` already carry a fallback for a driver with no employee
-- number ('D-' + last four digits of their phone). Re-implementing that format
-- here would put one rule in two places, which is the exact fault this file
-- exists to remove. So the database corrects what it can prove and never
-- invents a format the app owns.
CREATE OR REPLACE FUNCTION public.derive_driver_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_employee_id TEXT;
BEGIN
  IF NEW.driver_user_id IS NULL THEN
    NEW.driver_code := NULL;
    RETURN NEW;
  END IF;

  SELECT employee_id INTO v_employee_id
  FROM public.profiles WHERE id = NEW.driver_user_id;

  IF v_employee_id IS NOT NULL THEN
    NEW.driver_code := v_employee_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Fires on EVERY insert and update, not only when the driver columns change.
-- `derive_address_branch_id` narrows itself to `UPDATE OF hub_id, zone_id`,
-- which is right there because the source columns are on the same row. Here
-- the source is another table's `employee_id`, so a column list would leave a
-- window where editing a polygon silently preserved a stale code. Four rows
-- exist in total; the extra lookup is not worth a correctness gap.
DROP TRIGGER IF EXISTS trg_zone_driver_code ON public.delivery_zones;
CREATE TRIGGER trg_zone_driver_code
  BEFORE INSERT OR UPDATE ON public.delivery_zones
  FOR EACH ROW
  EXECUTE FUNCTION public.derive_driver_code();

DROP TRIGGER IF EXISTS trg_hub_driver_code ON public.delivery_hubs;
CREATE TRIGGER trg_hub_driver_code
  BEFORE INSERT OR UPDATE ON public.delivery_hubs
  FOR EACH ROW
  EXECUTE FUNCTION public.derive_driver_code();


-- ── §3  Correct the four routes that are wrong right now ─────────────
-- A no-op UPDATE is enough: the trigger recomputes the code. Written as
-- `driver_user_id = driver_user_id` so it is obvious that no value here is
-- being chosen by hand.
UPDATE public.delivery_zones SET driver_user_id = driver_user_id;
UPDATE public.delivery_hubs  SET driver_user_id = driver_user_id;


-- ── §4  Assertions ───────────────────────────────────────────────────
DO $$
DECLARE v_bad INT; v_missing INT;
BEGIN
  -- Every route's code must equal its assigned driver's employee number.
  SELECT count(*) INTO v_bad FROM (
    SELECT z.driver_code AS code,
           (SELECT p.employee_id FROM profiles p WHERE p.id = z.driver_user_id) AS truth
    FROM delivery_zones z WHERE z.driver_user_id IS NOT NULL
    UNION ALL
    SELECT h.driver_code,
           (SELECT p.employee_id FROM profiles p WHERE p.id = h.driver_user_id)
    FROM delivery_hubs h WHERE h.driver_user_id IS NOT NULL
  ) x WHERE x.truth IS NOT NULL AND x.code IS DISTINCT FROM x.truth;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'FAILED — % route(s) still name the wrong driver', v_bad;
  END IF;

  -- And no route names a driver who is no longer assigned.
  SELECT count(*) INTO v_missing FROM (
    SELECT 1 FROM delivery_zones WHERE driver_user_id IS NULL AND driver_code IS NOT NULL
    UNION ALL
    SELECT 1 FROM delivery_hubs  WHERE driver_user_id IS NULL AND driver_code IS NOT NULL
  ) y;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'FAILED — % route(s) carry a code with nobody assigned', v_missing;
  END IF;

  SELECT count(*) INTO v_missing
  FROM profiles WHERE role IN ('staff','admin') AND employee_id IS NULL;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'FAILED — % staff/admin still have no employee number', v_missing;
  END IF;

  RAISE NOTICE 'OK — every route names its actual driver, every employee has a number';
END $$;

-- Report — read this, not the exit code.
SELECT 'zone: ' || z.zone_name AS route,
       COALESCE(z.driver_code, '(none)') AS driver_code,
       COALESCE((SELECT p.full_name FROM profiles p WHERE p.id = z.driver_user_id), '(unassigned)') AS driver
FROM delivery_zones z
UNION ALL
SELECT 'hub: ' || h.hub_name,
       COALESCE(h.driver_code, '(none)'),
       COALESCE((SELECT p.full_name FROM profiles p WHERE p.id = h.driver_user_id), '(unassigned)')
FROM delivery_hubs h
ORDER BY 1;


-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK
--
--   DROP TRIGGER IF EXISTS trg_zone_driver_code ON public.delivery_zones;
--   DROP TRIGGER IF EXISTS trg_hub_driver_code  ON public.delivery_hubs;
--   DROP FUNCTION IF EXISTS public.derive_driver_code();
--
-- The minted employee numbers and the corrected codes are data. Capture the
-- report above BEFORE applying if they are ever to be put back; the sequence
-- cannot un-advance, so re-minting would produce different numbers.
-- ═══════════════════════════════════════════════════════════════════════
