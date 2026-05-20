-- 1stOne F1 — Let hub operators SELECT their hub note.
--
-- admin_notes_read gates SELECT on is_staff_or_admin(); hub operators are
-- role='customer' with assigned_hub_id set, so the policy rejects them.
-- The HubDashboard has always called useStaffNoteForTab('hub') but the
-- query came back empty (silently). With the new realtime subscription
-- the same RLS now also gates the websocket broadcast, so the banner
-- couldn't even arrive via realtime.
--
-- Add a focused carve-out: hub operators may SELECT only target_tab='hub'
-- rows in their own branch. The 'all' broadcast is intentionally excluded
-- — useStaffNoteForTab('hub') already filters to ['hub'] only.

CREATE POLICY admin_notes_hub_op_read ON public.admin_notes
  FOR SELECT
  USING (
    target_tab = 'hub'
    AND public.has_branch_access(branch_id)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'customer'
        AND p.assigned_hub_id IS NOT NULL
    )
  );
