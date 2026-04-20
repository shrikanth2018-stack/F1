-- app_settings: single-row table for app-wide config values.
-- Run once in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.app_settings (
  id              INTEGER PRIMARY KEY DEFAULT 1,
  login_bg_url    TEXT    NOT NULL DEFAULT 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1080&q=80',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Seed the one row (idempotent)
INSERT INTO public.app_settings (id, login_bg_url)
VALUES (1, 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1080&q=80')
ON CONFLICT (id) DO NOTHING;

-- RLS
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Anyone (including unauthenticated) can read — needed at login time before session exists
CREATE POLICY app_settings_public_read ON public.app_settings
  FOR SELECT USING (true);

-- Only admins can update
CREATE POLICY app_settings_admin_update ON public.app_settings
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
