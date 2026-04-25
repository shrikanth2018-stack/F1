-- ═══════════════════════════════════════════════════════════════════
-- 1stOne F1 — Landing page hero banner column (2026-04-25)
--
-- The static landing page at 1stone.in fetches this URL on load and
-- swaps the hero background. Admin uploads via LoginBgScreen
-- (extended with a second uploader) — same Supabase Storage bucket
-- pattern as login_bg_url.
--
-- NULL = use the CSS gradient default baked into landing/index.html.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS landing_hero_url TEXT;
