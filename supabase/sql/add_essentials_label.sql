-- 1stOne F1 — Add essentials_label column to delivery_cycles
--
-- Admin-editable customer-facing label shown on essentials UI only.
-- NULL / empty means "fall back to cycle_name".
-- Only meaningful when is_essentials = true.
--
-- Run once in Supabase SQL editor before the reset/seed script.

ALTER TABLE delivery_cycles
ADD COLUMN IF NOT EXISTS essentials_label TEXT;
