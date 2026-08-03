-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Clear test history, reset wallets, standardise units (2026-08-03)
--
-- Pre-launch cleanup. Every account is a test account (confirmed by the
-- owner); the 30 orders span 24 Jul – 3 Aug and are all test traffic.
--
-- BACKUP TAKEN FIRST: ~/1stone-backups/pre-wipe-20260803-1954 — a JSON
-- snapshot of all 23 affected tables. `supabase db dump` needs Docker, which
-- is not installed here, so this is the restorable record. Do not run this
-- file without checking that directory exists.
--
-- ORDER MATTERS. Three foreign keys are ON DELETE NO ACTION and will block:
--   loyalty_redemptions.reference_order_id -> orders
--   orders.subscription_id                 -> user_subscriptions
--   user_subscriptions.plan_id             -> subscription_plans
-- so the deletes run children-first. The CASCADE ones (order_items,
-- order_item_ratings, vendor_order_fulfilment, cancelled_subscription_days,
-- subscription_plan_items, attendance_correction_days) come along on their own.
--
-- WALLETS ARE RE-SEEDED THROUGH THE LEDGER, not by setting the balance alone.
-- Writing 2000 into profiles while wallet_transactions is empty would leave
-- the balance and the ledger disagreeing from the first row — exactly the
-- state you would otherwise be investigating. One opening credit per account
-- keeps balance = sum(ledger) true from the start.
--
-- KEPT: the new menu, essentials, profiles, addresses, vendors and zones,
-- cycles, hubs, branches, store config, feature flags, templates, banners,
-- push tokens, and the whole supply chain (supply_catalog / _order_items /
-- _batches) — the owner asked to retain those.
--
-- Deploy: supabase db query --linked --file supabase/sql/clear_test_history_2026_08.sql
-- Rollback: restore from the JSON snapshot above. There is no undo here.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Order history (children first) ──────────────────────────
DELETE FROM public.loyalty_redemptions;
DELETE FROM public.app_feedback WHERE order_id IS NOT NULL;
DELETE FROM public.vendor_earnings;
DELETE FROM public.orders;

-- ── 2. Subscriptions ───────────────────────────────────────────
DELETE FROM public.user_subscriptions;
DELETE FROM public.subscription_plans;

-- ── 3. Staff attendance (owner confirmed: clear) ───────────────
DELETE FROM public.attendance_correction_requests;
DELETE FROM public.staff_attendance;

-- ── 4. Claims, referrals, requests ─────────────────────────────
DELETE FROM public.expense_claims;
DELETE FROM public.referrals;
DELETE FROM public.staff_order_requests;

-- ── 5. Money: clear the ledger, then re-open at 2000 ───────────
DELETE FROM public.pending_wallet_topups;
DELETE FROM public.wallet_transactions;

UPDATE public.profiles SET wallet_balance = 2000, loyalty_points = 0;

INSERT INTO public.wallet_transactions
  (user_id, amount, transaction_type, description, reference_type)
SELECT id, 2000, 'credit', 'Opening test balance', 'admin'
FROM public.profiles;

-- ── 6. Logs ────────────────────────────────────────────────────
DELETE FROM public.push_logs;
DELETE FROM public.kitchen_push_log;
DELETE FROM public.manifest_run_log;
DELETE FROM public.idempotency_keys;

-- ── 7. The 14 retired menu items ───────────────────────────────
-- Safe only because every order referencing them is gone (§1). Their photos
-- are left in the bucket; the next upload for a reused id overwrites them.
DELETE FROM public.menu_items WHERE NOT is_active;

-- ── 8. Standardise recipe units ────────────────────────────────
-- Canonical form is "<number> <unit>" with unit from: ml, g, no, cup, plate,
-- bowl. Bare counts ("Idli:4") become "4 no" and the old "1n" becomes "1 no",
-- so every quantity now carries a unit the picker can round-trip.
--
-- get_kitchen_aggregate groups prep lines by (name, unit), so a mixture of
-- "150ml" and "150 ml" would be harmless — its regex tolerates the space —
-- but a mixture of "4" and "4 no" would NOT: those are different units and
-- would split one ingredient into two prep lines. Hence doing it in one pass.
UPDATE public.menu_items SET ingredients = 'Plain Dosa:1 no;Sambar:150 ml;Chutney:100 g' WHERE id = 162;
UPDATE public.menu_items SET ingredients = 'Rawa Kesari:200 g' WHERE id = 163;
UPDATE public.menu_items SET ingredients = 'Poori:2 no;Sagu:150 ml;Chutney:100 g' WHERE id = 166;
UPDATE public.menu_items SET ingredients = 'Buns:2 no;Sagu:150 ml;Chutney:100 g' WHERE id = 167;
UPDATE public.menu_items SET ingredients = 'Rice Pullav:400 g' WHERE id = 168;
UPDATE public.menu_items SET ingredients = 'Chitrannha:400 g;Dal:200 ml' WHERE id = 172;
UPDATE public.menu_items SET ingredients = 'Fried Rice:400 g' WHERE id = 173;
UPDATE public.menu_items SET ingredients = 'Chapati:2 no;Curry:250 ml' WHERE id = 176;
UPDATE public.menu_items SET ingredients = 'Pulka:2 no;Curry:250 ml' WHERE id = 177;
UPDATE public.menu_items SET ingredients = 'Sweet:1 no' WHERE id = 179;
UPDATE public.menu_items SET ingredients = 'Curd Rice:400 g' WHERE id = 181;
UPDATE public.menu_items SET ingredients = 'Rolls:2 no;Tomato Ketchup:1 no' WHERE id = 182;
UPDATE public.menu_items SET ingredients = 'Potato Fry:300 g' WHERE id = 185;
UPDATE public.menu_items SET ingredients = 'Sweet Corn:250 g' WHERE id = 186;
UPDATE public.menu_items SET ingredients = 'Fried Rice:400 g' WHERE id = 187;
UPDATE public.menu_items SET ingredients = 'Masala Dosa:1 no;Sambar:100 ml;Chutney:100 g' WHERE id = 161;
UPDATE public.menu_items SET ingredients = 'Upma:250 g' WHERE id = 164;
UPDATE public.menu_items SET ingredients = 'Pulka:2 no;Rice:200 g;Dal:250 ml;Sambar:200 ml;Palya:150 g;Sagu:200 g;Pickle:40 g;Papad:1 no;Sweet:1 no' WHERE id = 169;
UPDATE public.menu_items SET ingredients = 'Idli:2 no;Vada:1 no;Sambar:150 ml;Chutney:100 g' WHERE id = 160;
UPDATE public.menu_items SET ingredients = 'Rawa Kesari:200 g;Upma:200 g' WHERE id = 165;
UPDATE public.menu_items SET ingredients = 'schezwan fried rice:400 g' WHERE id = 175;
UPDATE public.menu_items SET ingredients = 'Fresh Juice:250 ml' WHERE id = 178;
UPDATE public.menu_items SET ingredients = 'Gobi Manchurian:450 g' WHERE id = 184;
UPDATE public.menu_items SET ingredients = 'schezwan fried rice:400 g' WHERE id = 189;
UPDATE public.menu_items SET ingredients = 'Gobi Manchurian:450 g' WHERE id = 192;
UPDATE public.menu_items SET ingredients = 'Idli:4 no;Sambar:150 ml;Chutney:100 g' WHERE id = 158;
UPDATE public.menu_items SET ingredients = 'Rice:200 g;Dal:250 ml;Pickle:40 g;Papad:1 no' WHERE id = 170;
UPDATE public.menu_items SET ingredients = 'Rice:200 g;Dal:250 ml;Pickle:40 g;Papad:1 no' WHERE id = 171;
UPDATE public.menu_items SET ingredients = 'Paneer Fried Rice:400 g' WHERE id = 174;
UPDATE public.menu_items SET ingredients = 'Gobi Manchurian:450 g' WHERE id = 180;
UPDATE public.menu_items SET ingredients = 'Goli Bajji:4 no;Chethey:250 ml' WHERE id = 183;
UPDATE public.menu_items SET ingredients = 'Paneer Fried Rice:400 g' WHERE id = 188;
UPDATE public.menu_items SET ingredients = 'Vada:4 no;Sambar:150 ml;Chutney:100 g' WHERE id = 159;
UPDATE public.menu_items SET ingredients = 'Chapati:2 no;Curry:250 ml' WHERE id = 190;
UPDATE public.menu_items SET ingredients = 'Pulka:2 no;Curry:250 ml' WHERE id = 191;
UPDATE public.menu_items SET ingredients = 'Curd Rice:400 g' WHERE id = 193;
UPDATE public.menu_items SET ingredients = 'Rice:200 g;Dal:250 ml;Pickle:40 g;Papad:1 no' WHERE id = 194;

NOTIFY pgrst, 'reload schema';
