-- ═══════════════════════════════════════════════════════════════
-- 1stOne F1 — Replace the food menu (2026-08-03)
--
-- Generated from menu_import_template.csv, not hand-typed: 86 rows is well
-- past the count where a transcription slip stops being noticeable.
--
-- THE OLD MENU IS DEACTIVATED, NOT DELETED. Five of the current 14 items are
-- referenced by historical order_items; deleting them would leave gaps in past
-- order details and in the revenue report. is_active = FALSE takes them off
-- the customer menu and keeps the history whole. They also keep their photos,
-- so re-activating one is a single switch.
--
-- TWO CSV CORRECTIONS, agreed before running:
--   Mangalore Buns  'Buns;2'  -> 'Buns:2'   (a semicolon made the kitchen
--                                            read a component named "2")
--   Plain Dosa      'Plain Dos' -> 'Plain Dosa'
--
-- BUILDING BLOCKS ARE PER-CYCLE. CreateMenuScreen only offers blocks from the
-- cycle being composed, so an ingredient used at Breakfast and Lunch needs a
-- row in each. Hence 49 block rows for 33 distinct names.
--
-- 21 blocks share a name with a dish in the same cycle — 'Idli' the plate of
-- four and 'Idli' the piece that Idli Vada is built from. They are different
-- things that share a name; Menu Manager separates them (a dish lists its
-- components and carries a photo tile, a block does neither).
--
-- Blocks are priced at 0 deliberately: they are recipe parts, hidden from
-- customers. Price one from Menu Manager when it is actually to be sold.
--
-- Deploy: supabase db query --linked --file supabase/sql/menu_replace_2026_08.sql
-- Rollback: see the bottom of this file.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Retire the current menu ─────────────────────────────────
UPDATE public.menu_items SET is_active = FALSE WHERE is_active;

-- ── 2. Building blocks (is_customer_visible = FALSE, price 0) ──
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Idli', 1, 0, NULL, TRUE, FALSE, 1, 0);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Sambar', 1, 0, NULL, TRUE, FALSE, 1, 1);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Chutney', 1, 0, NULL, TRUE, FALSE, 1, 2);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Vada', 1, 0, NULL, TRUE, FALSE, 1, 3);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Masala Dosa', 1, 0, NULL, TRUE, FALSE, 1, 4);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Plain Dosa', 1, 0, NULL, TRUE, FALSE, 1, 5);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Rawa Kesari', 1, 0, NULL, TRUE, FALSE, 1, 6);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Upma', 1, 0, NULL, TRUE, FALSE, 1, 7);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Poori', 1, 0, NULL, TRUE, FALSE, 1, 8);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Sagu', 1, 0, NULL, TRUE, FALSE, 1, 9);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Buns', 1, 0, NULL, TRUE, FALSE, 1, 10);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Rice Pullav', 1, 0, NULL, TRUE, FALSE, 1, 11);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Pulka', 2, 0, NULL, TRUE, FALSE, 1, 12);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Rice', 2, 0, NULL, TRUE, FALSE, 1, 13);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Dal', 2, 0, NULL, TRUE, FALSE, 1, 14);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Sambar', 2, 0, NULL, TRUE, FALSE, 1, 15);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Palya', 2, 0, NULL, TRUE, FALSE, 1, 16);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Sagu', 2, 0, NULL, TRUE, FALSE, 1, 17);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Pickle', 2, 0, NULL, TRUE, FALSE, 1, 18);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Papad', 2, 0, NULL, TRUE, FALSE, 1, 19);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Sweet', 2, 0, NULL, TRUE, FALSE, 1, 20);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Chitrannha', 2, 0, NULL, TRUE, FALSE, 1, 21);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Fried Rice', 2, 0, NULL, TRUE, FALSE, 1, 22);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Paneer Fried Rice', 2, 0, NULL, TRUE, FALSE, 1, 23);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('schezwan fried rice', 2, 0, NULL, TRUE, FALSE, 1, 24);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Chapati', 2, 0, NULL, TRUE, FALSE, 1, 25);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Curry', 2, 0, NULL, TRUE, FALSE, 1, 26);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Fresh Juice', 2, 0, NULL, TRUE, FALSE, 1, 27);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Gobi Manchurian', 2, 0, NULL, TRUE, FALSE, 1, 28);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Curd Rice', 2, 0, NULL, TRUE, FALSE, 1, 29);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Rolls', 3, 0, NULL, TRUE, FALSE, 1, 30);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Tomato Ketchup', 3, 0, NULL, TRUE, FALSE, 1, 31);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Goli Bajji', 3, 0, NULL, TRUE, FALSE, 1, 32);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Chethey', 3, 0, NULL, TRUE, FALSE, 1, 33);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Gobi Manchurian', 3, 0, NULL, TRUE, FALSE, 1, 34);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Potato Fry', 3, 0, NULL, TRUE, FALSE, 1, 35);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Sweet Corn', 3, 0, NULL, TRUE, FALSE, 1, 36);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Fried Rice', 4, 0, NULL, TRUE, FALSE, 1, 37);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Paneer Fried Rice', 4, 0, NULL, TRUE, FALSE, 1, 38);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('schezwan fried rice', 4, 0, NULL, TRUE, FALSE, 1, 39);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Chapati', 4, 0, NULL, TRUE, FALSE, 1, 40);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Curry', 4, 0, NULL, TRUE, FALSE, 1, 41);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Pulka', 4, 0, NULL, TRUE, FALSE, 1, 42);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Gobi Manchurian', 4, 0, NULL, TRUE, FALSE, 1, 43);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Curd Rice', 4, 0, NULL, TRUE, FALSE, 1, 44);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Rice', 4, 0, NULL, TRUE, FALSE, 1, 45);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Dal', 4, 0, NULL, TRUE, FALSE, 1, 46);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Pickle', 4, 0, NULL, TRUE, FALSE, 1, 47);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Papad', 4, 0, NULL, TRUE, FALSE, 1, 48);

-- ── 3. Customer-facing dishes, in CSV order ────────────────────
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Idli', 1, 50, 'Idli:4;Sambar:150ml;Chutney:100g', TRUE, TRUE, 1, 0);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Vada', 1, 65, 'Vada:4;Sambar:150ml;Chutney:100g', TRUE, TRUE, 1, 1);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Idli Vada', 1, 65, 'Idli:2;Vada:1;Sambar:150ml;Chutney:100g', TRUE, TRUE, 1, 2);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Masala Dosa', 1, 50, 'Masala Dosa:1;Sambar:100ml;Chutney:100g', TRUE, TRUE, 1, 3);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Plain Dosa', 1, 40, 'Plain Dosa:1;Sambar:150ml;Chutney:100g', TRUE, TRUE, 1, 4);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Rawa Kesari', 1, 50, 'Rawa Kesari:200g', TRUE, TRUE, 1, 5);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Upma', 1, 30, 'Upma:250g', TRUE, TRUE, 1, 6);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Chow Chow Bath', 1, 60, 'Rawa Kesari:200g;Upma:200g', TRUE, TRUE, 1, 7);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Poori', 1, 60, 'Poori:2;Sagu:150ml;Chutney:100g', TRUE, TRUE, 1, 8);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Mangalore Buns', 1, 60, 'Buns:2;Sagu:150ml;Chutney:100g', TRUE, TRUE, 1, 9);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Rice Pullav', 1, 50, 'Rice Pullav:400g', TRUE, TRUE, 1, 10);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Lunch Box', 2, 100, 'Pulka:2;Rice:200g;Dal:250ml;Sambar:200ml;Palya:150g;Sagu:200g;Pickle:40g;Papad:1;Sweet:1n', TRUE, TRUE, 1, 11);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Mini Lunch', 2, 75, 'Rice:200g;Dal:250ml;Pickle:40g;Papad:1', TRUE, TRUE, 1, 12);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Daal+ Rice', 2, 50, 'Rice:200g;Dal:250ml;Pickle:40g;Papad:1', TRUE, TRUE, 1, 13);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Chitrannha', 2, 50, 'Chitrannha:400g;Dal:200ml', TRUE, TRUE, 1, 14);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Veg Fried Rice', 2, 100, 'Fried Rice:400g', TRUE, TRUE, 1, 15);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Paneer Fried Rice', 2, 120, 'Paneer Fried Rice:400g', TRUE, TRUE, 1, 16);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('schezwan fried rice', 2, 120, 'schezwan fried rice:400g', TRUE, TRUE, 1, 17);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Chapati Curry', 2, 50, 'Chapati:2;Curry:250ml', TRUE, TRUE, 1, 18);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Pulka Curry', 2, 50, 'Pulka:2;Curry:250ml', TRUE, TRUE, 1, 19);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Juice of the day', 2, 40, 'Fresh Juice:250ml', TRUE, TRUE, 1, 20);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Extra Sweet', 2, 40, 'Sweet:1n', TRUE, TRUE, 1, 21);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Gobi Manchurian', 2, 75, 'Gobi Manchurian:450g', TRUE, TRUE, 1, 22);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Curd Rice', 2, 50, 'Curd Rice:400g', TRUE, TRUE, 1, 23);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Chapati Roll', 3, 50, 'Rolls:2;Tomato Ketchup:1n', TRUE, TRUE, 1, 24);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Goli Bajji', 3, 50, 'Goli Bajji:4n;Chethey:250ml', TRUE, TRUE, 1, 25);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Gobi Manchurian', 3, 75, 'Gobi Manchurian:450g', TRUE, TRUE, 1, 26);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Potato fry', 3, 75, 'Potato Fry:300g', TRUE, TRUE, 1, 27);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Sweet Corn', 3, 50, 'Sweet Corn:250g', TRUE, TRUE, 1, 28);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Veg Fried Rice', 4, 100, 'Fried Rice:400g', TRUE, TRUE, 1, 29);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Paneer Fried Rice', 4, 120, 'Paneer Fried Rice:400g', TRUE, TRUE, 1, 30);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('schezwan fried rice', 4, 120, 'schezwan fried rice:400g', TRUE, TRUE, 1, 31);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Chapati Curry', 4, 50, 'Chapati:2;Curry:250ml', TRUE, TRUE, 1, 32);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Pulka Curry', 4, 50, 'Pulka:2;Curry:250ml', TRUE, TRUE, 1, 33);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Gobi Manchurian', 4, 75, 'Gobi Manchurian:450g', TRUE, TRUE, 1, 34);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Curd Rice', 4, 50, 'Curd Rice:400g', TRUE, TRUE, 1, 35);
INSERT INTO public.menu_items (name, cycle_id, price, ingredients, is_active, is_customer_visible, branch_id, sort_order) VALUES ('Daal+ Rice', 4, 50, 'Rice:200g;Dal:250ml;Pickle:40g;Papad:1', TRUE, TRUE, 1, 36);

NOTIFY pgrst, 'reload schema';

-- ── Rollback ───────────────────────────────────────────────────
-- Removes everything this file created and restores the previous menu.
-- Safe: the new rows cannot be referenced by an order yet if run before any
-- order is placed against them. Check first:
--   SELECT count(*) FROM order_items oi JOIN menu_items mi ON mi.id = oi.item_id
--    WHERE mi.created_at > '2026-08-03';
--
-- DELETE FROM public.menu_items WHERE created_at > '2026-08-03'::date;
-- UPDATE public.menu_items SET is_active = TRUE WHERE created_at < '2026-08-03'::date;
