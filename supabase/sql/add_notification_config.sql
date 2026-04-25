-- 1stOne F1 — Notification config thresholds
--
-- Admin-tunable thresholds for lifecycle push notifications.
-- All nullable; edge functions use sensible fallbacks (200 / 14).
--
-- Run once in Supabase SQL editor.

ALTER TABLE store_config
ADD COLUMN IF NOT EXISTS low_wallet_threshold NUMERIC DEFAULT 200;

ALTER TABLE store_config
ADD COLUMN IF NOT EXISTS winback_inactive_days INTEGER DEFAULT 14;
