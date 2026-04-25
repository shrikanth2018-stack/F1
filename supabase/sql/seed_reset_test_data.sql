-- 1stOne F1 — Reset + Seed Test Data
--
-- Clears order history, plans, menu, essentials, cycles, wallet history.
-- Preserves: profiles, customer_addresses, auth, branches, store_config, feature_flags, referrals.
--
-- Run in Supabase SQL editor. Safe to re-run — idempotent resets + inserts with fixed IDs.
--
-- New semantic for delivery_cycles.is_essentials:
--   TRUE  = this cycle is ALSO used by essentials (Breakfast/Lunch/Dinner)
--   FALSE = food-only (Snacks)

BEGIN;

-- ── Reset (delete in FK-safe order) ─────────────────────────────
DELETE FROM cancelled_subscription_days;
DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM user_subscriptions;
DELETE FROM subscription_plans;
DELETE FROM menu_items;
DELETE FROM essentials_catalog;
DELETE FROM pending_wallet_topups;
DELETE FROM wallet_transactions;
DELETE FROM delivery_cycles;

-- Reset wallets + loyalty points on profiles to a known test amount
UPDATE profiles
SET wallet_balance = 2000, loyalty_points = 0;

-- Reset sequences so inserted IDs are deterministic
ALTER SEQUENCE delivery_cycles_id_seq    RESTART WITH 1;
ALTER SEQUENCE menu_items_id_seq         RESTART WITH 1;
ALTER SEQUENCE essentials_catalog_id_seq RESTART WITH 1;
ALTER SEQUENCE subscription_plans_id_seq RESTART WITH 1;

-- ── Delivery cycles (4 real cycles) ─────────────────────────────
-- essentials_label = customer-facing name on essentials UI; NULL = fall back to cycle_name.
-- kitchen_push_time defaults to cutoff_time (kitchen starts preparing at cutoff).
INSERT INTO delivery_cycles
  (id, cycle_name, cutoff_time, kitchen_push_time, delivery_start, is_essentials, essentials_label, is_active, sort_order)
VALUES
  (1, 'Breakfast', '06:00:00', '06:00:00', '07:30:00', TRUE,  'Morning', TRUE, 1),
  (2, 'Lunch',     '11:00:00', '11:00:00', '12:30:00', TRUE,  'Noon',    TRUE, 2),
  (3, 'Snacks',    '15:00:00', '15:00:00', '16:30:00', FALSE, NULL,      TRUE, 3),
  (4, 'Dinner',    '18:00:00', '18:00:00', '19:30:00', TRUE,  'Evening', TRUE, 4);

-- ── Menu items (South Indian vegetarian, 3 per cycle) ───────────
INSERT INTO menu_items (id, cycle_id, name, price, is_active, sort_order) VALUES
  (1,  1, 'Idli Vada Combo',    80, TRUE, 1),
  (2,  1, 'Masala Dosa',        90, TRUE, 2),
  (3,  1, 'Khara Pongal',       70, TRUE, 3),
  (4,  2, 'South Indian Thali',140, TRUE, 1),
  (5,  2, 'Bisi Bele Bath',    110, TRUE, 2),
  (6,  2, 'Curd Rice Meal',     95, TRUE, 3),
  (7,  3, 'Mysore Bonda',       40, TRUE, 1),
  (8,  3, 'Maddur Vada',        45, TRUE, 2),
  (9,  3, 'Goli Bajji',         35, TRUE, 3),
  (10, 4, 'Chapati Sagu',      100, TRUE, 1),
  (11, 4, 'Rice & Rasam',       85, TRUE, 2),
  (12, 4, 'Jolada Rotti Palya', 95, TRUE, 3);

-- ── Essentials catalog (2 per Morning/Noon/Evening; no Snacks) ──
INSERT INTO essentials_catalog (id, cycle_id, name, price, unit, is_active, sort_order) VALUES
  (1, 1, 'Full Cream Milk 1L',   70, '1L',      TRUE, 1),
  (2, 1, 'Kannada Newspaper',    10, '1 copy',  TRUE, 2),
  (3, 2, 'Fresh Curd 500g',      35, '500g',    TRUE, 1),
  (4, 2, 'Coriander Bunch',      15, '1 bunch', TRUE, 2),
  (5, 4, 'Sourdough Loaf',       50, '400g',    TRUE, 1),
  (6, 4, 'Pure Ghee 200g',      180, '200g',    TRUE, 2);

-- ── Subscription plans (proper plan_items, covers conflict scenarios) ──
INSERT INTO subscription_plans
  (id, cycle_id, plan_name, duration_days, price, plan_type, plan_items, is_active, savings_amount)
VALUES
  -- Food plans
  (1, 1, 'Idli Vada 10 Days',    10,  720, 'food',
    '[{"item_id":1,"item_name":"Idli Vada Combo","quantity":1}]', TRUE,  80),
  (2, 1, 'Idli Vada 30 Days',    30, 2000, 'food',
    '[{"item_id":1,"item_name":"Idli Vada Combo","quantity":1}]', TRUE, 400),
  (3, 1, 'Masala Dosa 15 Days',  15, 1200, 'food',
    '[{"item_id":2,"item_name":"Masala Dosa","quantity":1}]',     TRUE, 150),
  (4, 2, 'Thali 10 Days',        10, 1260, 'food',
    '[{"item_id":4,"item_name":"South Indian Thali","quantity":1}]', TRUE, 140),
  (5, 2, 'Thali 30 Days',        30, 3600, 'food',
    '[{"item_id":4,"item_name":"South Indian Thali","quantity":1}]', TRUE, 600),
  (6, 4, 'Chapati Sagu 30 Days', 30, 2700, 'food',
    '[{"item_id":10,"item_name":"Chapati Sagu","quantity":1}]',   TRUE, 300),
  -- Essentials plans
  (7, 1, 'Daily Milk 30 Days',   30, 1950, 'essentials',
    '[{"item_id":1,"item_name":"Full Cream Milk 1L","quantity":1}]',  TRUE, 150),
  (8, 1, 'Newspaper 30 Days',    30,  280, 'essentials',
    '[{"item_id":2,"item_name":"Kannada Newspaper","quantity":1}]',   TRUE,  20),
  (9, 2, 'Fresh Curd 15 Days',   15,  480, 'essentials',
    '[{"item_id":3,"item_name":"Fresh Curd 500g","quantity":1}]',     TRUE,  45),
  (10, 4, 'Bread 30 Days',       30, 1400, 'essentials',
    '[{"item_id":5,"item_name":"Sourdough Loaf","quantity":1}]',      TRUE, 100);

-- Advance sequences past the hard-coded IDs
SELECT setval('delivery_cycles_id_seq',    4);
SELECT setval('menu_items_id_seq',         12);
SELECT setval('essentials_catalog_id_seq', 6);
SELECT setval('subscription_plans_id_seq', 10);

COMMIT;
