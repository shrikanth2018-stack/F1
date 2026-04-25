-- 1stOne F1 — Add driver_code to delivery_zones + delivery_hubs
--
-- Each zone and each hub carries a free-text driver code.
-- Zone's driver_code → driver for direct deliveries in that zone.
-- Hub's  driver_code → branch driver who takes the bundle to that hub.
--
-- NULL is allowed for backward compatibility but the admin UI will treat
-- it as required. Staff Delivery tab will show "Unassigned" for any order
-- whose matched zone/hub is missing a code.
--
-- Run once in Supabase SQL editor.

ALTER TABLE delivery_zones
ADD COLUMN IF NOT EXISTS driver_code TEXT;

ALTER TABLE delivery_hubs
ADD COLUMN IF NOT EXISTS driver_code TEXT;
