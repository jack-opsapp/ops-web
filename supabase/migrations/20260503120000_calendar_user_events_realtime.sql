-- ─────────────────────────────────────────────────────────────────────────────
-- Add `calendar_user_events` to the supabase_realtime publication so the web
-- calendar can sync personal events + time-off requests in realtime (bug
-- 71308894). `project_tasks` is already a member of the publication; this
-- migration brings parity for the second table the calendar reads from.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'calendar_user_events'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.calendar_user_events';
  END IF;
END$$;
