-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — 360 walkthrough: SEED
--
-- RUN:  supabase db query --linked --file supabase/tests/seed_360.sql
-- UNDO: supabase db query --linked --file supabase/tests/teardown_360.sql
--
-- This one COMMITS. Every other harness in this folder rolls back, because it
-- only has to prove a rule holds. A walkthrough is different: the rows have to
-- survive so they can be seen on a screen, so the undo is a separate file
-- rather than a RAISE at the bottom.
--
-- WHAT IT DOES NOT DO: create logins. Every persona already exists as a test
-- account with a patterned phone number, so seeding auth.users would mean
-- inventing people you cannot receive an OTP for. The seed fills the GAPS
-- around that cast instead.
--
-- THE GAP THAT MATTERS: there are zero subscription plans. Without one, the
-- entire subscription lifecycle — buy, nightly manifest, skip a day, pause,
-- run down to expiry — cannot be walked at all.
--
-- HOW THE UNDO STAYS EXACT. A run row is written first, and everything the
-- seed creates is recorded against it in seed_360_registry. Teardown removes
-- what is registered, plus the transactional rows the WALK produces
-- afterwards — bounded by the run's started_at and by the cast, so nothing
-- that predates the run can be caught by it. Wallet balances are snapshotted
-- so they can be restored exactly rather than guessed at.
--
-- Idempotent: re-running closes any open run first, so there is only ever one
-- live seed. It does NOT tear down the previous run's data — run teardown for
-- that.
-- ═══════════════════════════════════════════════════════════════

-- ── Bookkeeping tables ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seed_360_run (
  id         BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at  TIMESTAMPTZ,
  note       TEXT
);

CREATE TABLE IF NOT EXISTS public.seed_360_registry (
  id         BIGSERIAL PRIMARY KEY,
  run_id     BIGINT NOT NULL REFERENCES public.seed_360_run(id) ON DELETE CASCADE,
  table_name TEXT   NOT NULL,
  pk         TEXT   NOT NULL,
  note       TEXT
);

-- Wallet balance as it stood BEFORE the run, so teardown restores rather than
-- assumes. Balance and ledger must still agree afterwards.
CREATE TABLE IF NOT EXISTS public.seed_360_wallet_snapshot (
  run_id  BIGINT NOT NULL REFERENCES public.seed_360_run(id) ON DELETE CASCADE,
  user_id UUID   NOT NULL,
  balance NUMERIC NOT NULL,
  points  INTEGER NOT NULL,
  PRIMARY KEY (run_id, user_id)
);

DO $$
DECLARE
  v_run     BIGINT;
  v_cycle_f INTEGER;   -- a food cycle
  v_cycle_e INTEGER;   -- an essentials-capable cycle
  v_dish    RECORD;
  v_ess     RECORD;
  v_plan_f  INTEGER;
  v_plan_e  INTEGER;
  v_cust    UUID;
  v_addr    BIGINT;
  v_n       INTEGER;
BEGIN
  -- Close any run left open, so "the current run" is never ambiguous.
  UPDATE public.seed_360_run SET closed_at = now()
   WHERE closed_at IS NULL;

  INSERT INTO public.seed_360_run (note) VALUES ('360 walkthrough') RETURNING id INTO v_run;

  -- ── Snapshot every wallet we might move ──────────────────────
  INSERT INTO public.seed_360_wallet_snapshot (run_id, user_id, balance, points)
  SELECT v_run, id, COALESCE(wallet_balance,0), COALESCE(loyalty_points,0)
    FROM public.profiles;

  -- ── 1. Subscription plans ────────────────────────────────────
  -- Two, because food and essentials take different paths: food goes through
  -- the kitchen aggregate, essentials skip it and start at Packing.
  SELECT id INTO v_cycle_f FROM public.delivery_cycles
   WHERE is_active ORDER BY cutoff_time LIMIT 1;
  SELECT id INTO v_cycle_e FROM public.delivery_cycles
   WHERE is_active AND is_essentials ORDER BY cutoff_time LIMIT 1;

  SELECT id, name, price INTO v_dish FROM public.menu_items
   WHERE is_active AND is_customer_visible AND cycle_id = v_cycle_f
   ORDER BY id LIMIT 1;

  SELECT id, name, price INTO v_ess FROM public.essentials_catalog
   WHERE is_active AND cycle_id = v_cycle_e AND COALESCE(listing_status,'approved') = 'approved'
   ORDER BY id LIMIT 1;

  IF v_dish.id IS NULL THEN
    RAISE EXCEPTION 'No customer-visible dish on cycle % — cannot build a food plan', v_cycle_f;
  END IF;

  -- 7 days so the whole life fits inside a walkthrough: buy it, let the
  -- manifest dispatch a day, skip one, pause, and still see it run down.
  INSERT INTO public.subscription_plans
    (plan_name, price, duration_days, cycle_id, plan_type, is_active, plan_items, branch_id)
  VALUES (
    '[360] Week of ' || v_dish.name,
    ROUND(v_dish.price * 7 * 0.9, 2),   -- a small plan discount, so the maths is not trivially 7x
    7, v_cycle_f, 'food', TRUE,
    jsonb_build_array(jsonb_build_object(
      'item_id', v_dish.id, 'item_name', v_dish.name, 'quantity', 1)),
    (SELECT branch_id FROM public.menu_items WHERE id = v_dish.id)
  )
  RETURNING id INTO v_plan_f;
  INSERT INTO public.seed_360_registry (run_id, table_name, pk, note)
    VALUES (v_run, 'subscription_plans', v_plan_f::text, 'food plan');

  IF v_ess.id IS NOT NULL THEN
    INSERT INTO public.subscription_plans
      (plan_name, price, duration_days, cycle_id, plan_type, is_active, plan_items, branch_id)
    VALUES (
      '[360] Week of ' || v_ess.name,
      ROUND(v_ess.price * 7 * 0.9, 2),
      7, v_cycle_e, 'essentials', TRUE,
      jsonb_build_array(jsonb_build_object(
        'item_id', v_ess.id, 'item_name', v_ess.name, 'quantity', 1)),
      (SELECT branch_id FROM public.essentials_catalog WHERE id = v_ess.id)
    )
    RETURNING id INTO v_plan_e;
    INSERT INTO public.seed_360_registry (run_id, table_name, pk, note)
      VALUES (v_run, 'subscription_plans', v_plan_e::text, 'essentials plan');
  END IF;

  -- ── 2. An address that is genuinely OUT of the delivery area ──
  -- Checkout must refuse it, HomeScreen must show the out-of-zone nudge, and
  -- orderBuild must reject it server-side. Without one on the account there is
  -- nothing to test that against.
  --
  -- Written with explicit values rather than leaving it to trg_address_resolve:
  -- this runs as the table owner, so auth.uid() is NULL and that trigger skips
  -- by design (service-role callers resolve serviceability themselves). 0,0 is
  -- in the Atlantic, so these ARE what the resolver would return.
  SELECT p.id INTO v_cust
    FROM public.profiles p
    JOIN public.customer_addresses a ON a.user_id = p.id AND a.is_active AND a.is_default
   WHERE p.role = 'customer'
     AND NOT EXISTS (SELECT 1 FROM public.vendors v WHERE v.owner_user_id = p.id)
     AND p.assigned_hub_id IS NULL
   ORDER BY p.created_at LIMIT 1;

  IF v_cust IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.customer_addresses
                      WHERE user_id = v_cust AND label = '[360] Out of area') THEN
    INSERT INTO public.customer_addresses
      (user_id, label, full_name, phone_number, address_line, city,
       latitude, longitude, zone_id, hub_id, branch_id, is_serviceable, is_default, is_active)
    VALUES (
      v_cust, '[360] Out of area', 'Three Sixty', '9100000360',
      'Somewhere we do not deliver', 'Nowhere',
      0.0, 0.0, NULL, NULL, NULL, FALSE, FALSE, TRUE)
    RETURNING id INTO v_addr;
    INSERT INTO public.seed_360_registry (run_id, table_name, pk, note)
      VALUES (v_run, 'customer_addresses', v_addr::text, 'out-of-area address');
  END IF;

  -- ── 3. Wallet float ──────────────────────────────────────────
  -- Through the RPC, never by writing the column: balance must stay equal to
  -- the sum of the ledger, or the first thing the walk finds is a discrepancy
  -- the walk itself created.
  PERFORM public.increment_wallet_balance(
            p.id, 3000, '[360] walkthrough float', 'seed_360', v_run::text)
     FROM public.profiles p
    WHERE COALESCE(p.wallet_balance,0) < 1000;

  RAISE NOTICE '[seed_360] run % ready', v_run;
END $$;

-- ── The walk sheet ─────────────────────────────────────────────
-- Who to sign in as, and what each persona is there to prove.
SELECT step, persona, phone, what_to_check FROM (
  VALUES
    (1, 'Customer',     'the 5-5-5 account',  'Address in zone AND the [360] Out of area one — checkout must refuse the second. Browse food + essentials, order on wallet, then subscribe to a [360] plan.'),
    (2, 'Customer',     'same',               'Skip a day, pause, resume, cancel an order. Wallet top-up is card-only on native; on web it is wallet-only by design.'),
    (3, 'Staff',        'the 6-6-6 account',  'Kitchen board after a push, bulk advance, Packing (food + essentials), print a slip. Clock in/out — and once with the phone in aeroplane mode, which is the fix made today.'),
    (4, 'Driver',       'the 3-3-3 account',  'Dispatched -> Received at Hub, then it must STOP there for a hub order.'),
    (5, 'Hub operator', 'the 4-4-4 account',  'Received at Hub -> On the Way -> Delivered, then the monthly commission claim.'),
    (6, 'Vendor',       'the 2-2-2 account',  'Draft a listing, submit it, see it hidden from customers until approved, then sell one and check the earning lands.'),
    (7, 'Admin',        'the 8-8-8 account',  'Menu Items editor, new menu, CSV import, Disable on an in-use item, bulk order entry, employee onboarding AND re-onboarding the same person, leave approval, reports.'),
    (8, 'Super admin',  'your own account',   'Branches, customer export, feature flags, store config.'),
    (9, 'Web',          'app.1stone.in',      'The three places web genuinely differs: checkout is wallet-only with no Razorpay, maps use a different component, photo crop takes a different path.')
) AS t(step, persona, phone, what_to_check)
ORDER BY step;
