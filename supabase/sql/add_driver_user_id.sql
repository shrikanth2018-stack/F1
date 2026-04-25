-- 1stOne F1 — driver_user_id on zones + hubs
--
-- Drivers are staff. Admin phone-picks them; we store the FK for the link,
-- and keep the driver_code text column as the display token (auto-filled from
-- the staff's employee_id on save). Staff Dashboard keeps reading driver_code
-- as before — display path unchanged.
--
-- Run once in Supabase SQL editor.

ALTER TABLE delivery_zones
  ADD COLUMN IF NOT EXISTS driver_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE delivery_hubs
  ADD COLUMN IF NOT EXISTS driver_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
