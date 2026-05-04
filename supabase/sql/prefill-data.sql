-- ============================================================
-- 1stOne F1 — Production Pre-Fill Data
-- Source: PreFill.xlsx from Shrikanth
-- Run in Supabase SQL Editor AFTER schema.sql
-- ============================================================

-- ============================================================
-- 0. STORE CONFIG (singleton row)
-- ============================================================
INSERT INTO store_config (id, tax_rate_percentage, delivery_fee, whatsapp_support_number)
VALUES (1, 5.00, 0.00, '9448364017')
ON CONFLICT (id) DO UPDATE SET
  whatsapp_support_number = '9448364017',
  updated_at = NOW();

-- ============================================================
-- 1. DELIVERY CYCLES — Food (is_essentials = false)
-- ============================================================
DELETE FROM menu_items;
DELETE FROM essentials_catalog;
DELETE FROM subscription_plan_items;
DELETE FROM subscription_plans;
DELETE FROM delivery_cycles;

INSERT INTO delivery_cycles (id, cycle_name, cutoff_time, kitchen_push_time, delivery_start, delivery_end, is_active, is_essentials, sort_order) VALUES
(1, 'Breakfast', '06:00', '06:15', '07:00', '07:30', true, false, 1),
(2, 'Lunch',     '10:30', '10:45', '12:00', '12:30', true, false, 2),
(3, 'Snacks',    '14:30', '14:45', '16:00', '16:30', true, false, 3),
(4, 'Dinner',    '18:00', '18:15', '19:30', '20:00', true, false, 4);

-- Essentials cycles (is_essentials = true)
INSERT INTO delivery_cycles (id, cycle_name, cutoff_time, kitchen_push_time, delivery_start, delivery_end, is_active, is_essentials, sort_order) VALUES
(5, 'Morning',  '05:30', '05:45', '06:00', '07:00', true, true, 5),
(6, 'Mid day',  '10:00', '10:15', '11:00', '12:00', true, true, 6),
(7, 'Evening',  '15:00', '15:15', '16:00', '17:00', true, true, 7);

-- Reset sequence
SELECT setval('delivery_cycles_id_seq', 7);

-- ============================================================
-- 2. MENU ITEMS (Food) — from "Food Menu for Customer Page"
--    ingredients = sub-items from "Menu Items for Menu builder"
-- ============================================================
INSERT INTO menu_items (cycle_id, name, price, ingredients, is_active, sort_order) VALUES
-- Breakfast
(1, 'Idli Pack',   50.00, 'Idlis 3 Pc, Chetney 1 Cup, Sambar 1 Cup', true, 1),
(1, 'ChowChow',   60.00, 'Rava Kesari 1 Cup, Upma 1 Cup, Chetney 1 Cup', true, 2),
(1, 'Dosa Pack',   60.00, 'Set Dosa 3 Pc, Chetney 1 Cup, Sambar 1 Cup', true, 3),
-- Lunch
(2, 'Meals Box',  100.00, 'Rice, Sambar, Sabji, Chapati 2 Pc, Sagu, Pickle, Sprouts, Sweet', true, 1),
(2, 'Daal Rice',   50.00, 'Rice 1 Bowl, Daal 1 Bowl, Papad, Pickle', true, 2),
(2, 'Rice Bath',   50.00, 'Colour Rice 1 Bowl, Saagu/Kurma 1 Cup, Tomato Ketchup 1 Pc', true, 3),
-- Snacks
(3, 'Tawa Roll',   60.00, 'Chapati Roll 2 Pc, Sabji 1 Cup, Ketchup 1 Pc', true, 1),
(3, 'Bajji Box',   50.00, 'Bajji of the day 1 Set, Chetney 1 Cup, Soup 1 Cup', true, 2),
-- Dinner
(4, 'Dinner Pack', 90.00, 'Colour Rice 1 Bowl, Chapati 2 Pc, Sabji 1 Cup', true, 1),
(4, 'Rice Special', 90.00, 'Fried Rice 1 Cup, Veg Biriyani 1 Cup, Sabji 1 Cup', true, 2);

-- ============================================================
-- 3. ESSENTIALS CATALOG — from "Essentials Menu for customer page"
-- ============================================================
INSERT INTO essentials_catalog (cycle_id, name, price, unit, is_active, sort_order) VALUES
-- Morning
(5, 'Milk 500 ML',          28.00, '500 ml',  true, 1),
(5, 'Milk 1L',              54.00, '1 litre', true, 2),
(5, 'Curd 500 ML',          38.00, '500 ml',  true, 3),
(5, 'Curd 250 ML',          20.00, '250 ml',  true, 4),
(5, 'Dosa Batter 1L',       80.00, '1 litre', true, 5),
(5, 'Atta 1 KG',            80.00, '1 kg',    true, 6),
(5, 'Tomato 500 Grams',     20.00, '500 g',   true, 7),
-- Mid day
(6, 'Onion 500 Grams',      20.00, '500 g',   true, 1),
(6, 'Coriender Leaves 1 Pk', 10.00, '1 pack', true, 2),
-- Evening
(7, 'Green Chilly 250 Grams', 25.00, '250 g', true, 1),
(7, 'Potato 500 Grams',       20.00, '500 g', true, 2);

-- ============================================================
-- 4. SUBSCRIPTION PLANS — Food
--    from "Subscriptions Food for settings (Admin Page/Manage)"
--    savings_amount = (per-day-price × days) - plan_price
-- ============================================================
INSERT INTO subscription_plans (cycle_id, plan_name, duration_days, price, savings_amount, is_active, plan_type) VALUES
-- Breakfast (cheapest item = Idli Pack ₹50)
(1, 'Tindi 10',   10,  449.00,  51.00, true, 'food'),
(1, 'Tindi 30',   30, 1199.00, 301.00, true, 'food'),
-- Lunch (cheapest item = Daal Rice ₹50)
(2, 'Lunch 10',   10,  899.00, 101.00, true, 'food'),
(2, 'Lunch 30',   30, 2499.00, 501.00, true, 'food'),
-- Snacks (cheapest item = Bajji Box ₹50)
(3, 'Snacks 10',  10,  499.00,  1.00, true, 'food'),
(3, 'Snacks 30',  30, 1399.00, 101.00, true, 'food'),
-- Dinner (cheapest item = Dinner Pack ₹90)
(4, 'Dinner 10',  10,  799.00, 101.00, true, 'food'),
(4, 'Dinner 30',  30, 2199.00, 501.00, true, 'food');

-- ============================================================
-- 5. SUBSCRIPTION PLANS — Essentials
--    from "Subscriptions Essentials for settings (Admin Page/Manage)"
-- ============================================================
INSERT INTO subscription_plans (cycle_id, plan_name, duration_days, price, savings_amount, is_active, plan_type) VALUES
-- Morning essentials
(5, 'Milk 500-10', 10,  280.00,   0.00, true, 'essential'),
(5, 'Milk 500-30', 30,  820.00,  20.00, true, 'essential'),
(5, 'Milk 1L-10',  10,  550.00,  -10.00, true, 'essential'),
(5, 'Milk 1L-30',  30, 1650.00,  -30.00, true, 'essential'),
(5, 'PV 30',       30,  150.00,   0.00, true, 'essential'),
(5, 'VK 30',       30,  150.00,   0.00, true, 'essential');

-- ============================================================
-- 6. FEATURE FLAGS
-- ============================================================
INSERT INTO feature_flags (flag_key, flag_value, description) VALUES
('essentials_module', true, 'Enable essentials tab and catalog'),
('hub_delivery', false, 'Enable hub-based delivery'),
('branch_management', false, 'Enable multi-branch'),
('referral_program', true, 'Enable referral system'),
('storm_mode', false, 'Pause all orders during emergencies')
ON CONFLICT (flag_key) DO UPDATE SET flag_value = EXCLUDED.flag_value;

-- ============================================================
-- 7. REFERRAL SETTINGS
-- ============================================================
INSERT INTO referral_settings (id, referrer_reward_points, referee_reward_points, referrer_wallet_credit, referee_wallet_credit, is_active)
VALUES (1, 50, 50, 25.00, 25.00, true)
ON CONFLICT (id) DO UPDATE SET
  referrer_reward_points = 50,
  referee_reward_points = 50,
  referrer_wallet_credit = 25.00,
  referee_wallet_credit = 25.00,
  is_active = true;

-- ============================================================
-- DONE! All pre-fill data inserted.
-- Tables populated: delivery_cycles, menu_items, essentials_catalog,
--   subscription_plans, store_config, feature_flags, referral_settings
-- ============================================================
