-- email_connections: archive_lead_preference
--
-- When a user archives an email thread that's linked to a pipeline opportunity,
-- should the opportunity also be archived? Asked once on the first archive of
-- an opp-linked thread (no siblings); cached from then on. When the thread
-- shares the opportunity with siblings, the user is always prompted instead
-- (because the sibling list is dynamic).
--
-- Values:
--   'ask'     — first encounter; show the prompt
--   'archive' — silently archive the linked opportunity alongside the thread
--   'leave'   — never archive the opportunity from inbox (thread only)

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'email_connections'
      AND column_name = 'archive_lead_preference'
  ) THEN
    ALTER TABLE email_connections
      ADD COLUMN archive_lead_preference TEXT NOT NULL DEFAULT 'ask'
        CHECK (archive_lead_preference IN ('ask','archive','leave'));
  END IF;
END $$;

COMMENT ON COLUMN email_connections.archive_lead_preference IS
  'Determines whether archiving an inbox thread also archives its linked pipeline opportunity. Default ''ask'' triggers a one-time confirmation modal on the first opp-linked archive (siblings always trigger the multi-select modal regardless).';
