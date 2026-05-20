-- 1stOne F1 — Enable realtime on admin_notes so staff banners flip live.
--
-- Before this, useStaffNoteForTab relied on a 5-second staleTime +
-- refetchOnWindowFocus — close to real-time only when the staff member
-- happened to re-focus the app. With the table added to the
-- supabase_realtime publication, any INSERT/UPDATE/DELETE fires a
-- websocket event the client uses to invalidate the staff_notes query
-- key, so the banner flips within a tick of the admin saving the note.
--
-- Same shape as the kitchen_push_log + orders entries already in the
-- publication (see staff_batch_realtime.sql).

ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_notes;
