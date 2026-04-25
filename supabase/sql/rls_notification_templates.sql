-- 1stOne F1 — RLS for notification_templates
--
-- Admins (JWT user_role = 'admin') can read + update.
-- Edge functions use service role, which bypasses RLS — no policy needed.
-- Customers / staff have no access.

ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin read templates"  ON notification_templates;
DROP POLICY IF EXISTS "admin write templates" ON notification_templates;

CREATE POLICY "admin read templates"
  ON notification_templates FOR SELECT
  TO authenticated
  USING (auth.jwt() ->> 'user_role' = 'admin');

CREATE POLICY "admin write templates"
  ON notification_templates FOR UPDATE
  TO authenticated
  USING      (auth.jwt() ->> 'user_role' = 'admin')
  WITH CHECK (auth.jwt() ->> 'user_role' = 'admin');
