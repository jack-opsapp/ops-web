-- ─────────────────────────────────────────────────────────────────────────────
-- 071_email_threads_and_corrections.sql
-- Email Threads + Category Corrections (Inbox v2 foundation)
--
-- Establishes the per-thread state layer the rebuilt inbox needs. Until now,
-- the inbox was built on `activities` (per-message) and filtered to rows with
-- a linked opportunity_id — meaning every vendor, legal, platform-bid, and
-- receipt email was invisible to the OPS inbox. This migration creates the
-- primary thread table (`email_threads`) that Phase C classifies into one of
-- 13 categories and adorns with per-thread state: archive, snooze, labels,
-- priority, and AI summary.
--
-- `email_thread_category_corrections` persists user overrides so Phase C can
-- learn which senders/domains consistently go to which category without
-- re-running classification from cold each time.
--
-- Two column additions extend existing tables:
--   - email_connections.archive_writeback_preference: user's preference for
--     whether OPS archive actions propagate to Gmail/M365.
--   - activities.classified_at / classifier_version: provenance so we know
--     which sync pass most recently classified the thread containing this
--     message.
--
-- Design notes:
--   - `email_threads` is UNIQUE on (connection_id, provider_thread_id) — the
--     provider's thread ID (Gmail threadId or M365 conversationId) is already
--     unique per mailbox, so this is the natural key. We use a surrogate UUID
--     for internal FKs (cheaper joins, opaque to providers).
--   - Denormalized summary columns (subject, participants, last_message_at,
--     message_count, etc.) live on the thread row because the inbox list
--     query runs on every page load and must not JOIN activities.
--   - Partial indexes exclude archived/snoozed rows from the hot inbox path.
--   - RLS follows the `auth.jwt()->>'company_id'` pattern used by agent_actions
--     (see migration 056). Service role bypasses RLS for all writes from
--     server routes.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════════
-- email_threads
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.email_threads (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  connection_id               UUID NOT NULL REFERENCES email_connections(id) ON DELETE CASCADE,
  provider_thread_id          TEXT NOT NULL,

  -- Primary classification — exactly one of the 13 Phase C categories.
  primary_category            TEXT NOT NULL DEFAULT 'OTHER'
    CHECK (primary_category IN (
      'LEAD','CLIENT','VENDOR','SUBTRADE','PLATFORM_BID',
      'LEGAL','JOB_SEEKER','COLLECTIONS','MARKETING',
      'RECEIPT','PERSONAL','INTERNAL','OTHER'
    )),
  category_confidence         NUMERIC(3,2) NOT NULL DEFAULT 0.00
    CHECK (category_confidence >= 0.00 AND category_confidence <= 1.00),
  category_classified_at      TIMESTAMPTZ,
  category_classifier_version TEXT NOT NULL DEFAULT 'v1',
  category_manually_set       BOOLEAN NOT NULL DEFAULT FALSE,

  -- Secondary labels (multi-valued). Values checked in application, not DB,
  -- so we can evolve the label set without a migration.
  labels                      TEXT[] NOT NULL DEFAULT '{}',

  -- Triage state.
  archived_at                 TIMESTAMPTZ,
  snoozed_until               TIMESTAMPTZ,
  priority_score              NUMERIC(4,2) NOT NULL DEFAULT 0.00,
  ai_summary                  TEXT,

  -- Denormalized summary (refreshed on every upsert from latest message).
  subject                     TEXT NOT NULL DEFAULT '',
  participants                TEXT[] NOT NULL DEFAULT '{}',
  first_message_at            TIMESTAMPTZ NOT NULL,
  last_message_at             TIMESTAMPTZ NOT NULL,
  message_count               INT NOT NULL DEFAULT 0,
  unread_count                INT NOT NULL DEFAULT 0,
  latest_direction            TEXT
    CHECK (latest_direction IS NULL OR latest_direction IN ('inbound','outbound')),
  latest_sender_email         TEXT,
  latest_sender_name          TEXT,
  latest_snippet              TEXT,

  -- Pipeline linkage. LEAD/CLIENT threads carry these; VENDOR/etc. typically
  -- do not. FKs are nullable.
  opportunity_id              UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  client_id                   UUID REFERENCES clients(id) ON DELETE SET NULL,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT email_threads_unique_provider UNIQUE (connection_id, provider_thread_id)
);

COMMENT ON TABLE public.email_threads IS
  'Per-thread inbox state — one row per provider thread. Phase C classifies into primary_category; user can override via email_thread_category_corrections.';

-- Hot path: inbox list (everything rail, not archived, not snoozed).
CREATE INDEX IF NOT EXISTS idx_email_threads_company_lastmsg
  ON email_threads(company_id, last_message_at DESC)
  WHERE archived_at IS NULL AND snoozed_until IS NULL;

-- Category filter paths.
CREATE INDEX IF NOT EXISTS idx_email_threads_company_category
  ON email_threads(company_id, primary_category, last_message_at DESC)
  WHERE archived_at IS NULL;

-- Snooze cron path (find threads due for unsnooze).
CREATE INDEX IF NOT EXISTS idx_email_threads_snoozed
  ON email_threads(snoozed_until)
  WHERE snoozed_until IS NOT NULL;

-- Opportunity join path for pipeline integration.
CREATE INDEX IF NOT EXISTS idx_email_threads_opportunity
  ON email_threads(opportunity_id)
  WHERE opportunity_id IS NOT NULL;

-- Client join path for Intel galaxy thread density.
CREATE INDEX IF NOT EXISTS idx_email_threads_client
  ON email_threads(client_id)
  WHERE client_id IS NOT NULL;

-- Connection scope — used by per-user "own mailbox" queries.
CREATE INDEX IF NOT EXISTS idx_email_threads_connection
  ON email_threads(connection_id, last_message_at DESC);

-- RLS.
ALTER TABLE email_threads ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'email_threads_company_scope' AND tablename = 'email_threads'
  ) THEN
    CREATE POLICY email_threads_company_scope ON email_threads
      FOR ALL USING (company_id = (auth.jwt()->>'company_id')::uuid);
  END IF;
END $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- email_thread_category_corrections
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.email_thread_category_corrections (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  thread_id            UUID NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_category        TEXT NOT NULL,
  to_category          TEXT NOT NULL,

  -- Signals used to apply this correction to similar future threads.
  sender_email         TEXT,
  sender_domain        TEXT,
  participants_hash    TEXT,
  subject_keywords     TEXT[] NOT NULL DEFAULT '{}',

  note                 TEXT,
  applied_to_similar   BOOLEAN NOT NULL DEFAULT FALSE,
  similar_count        INT NOT NULL DEFAULT 0,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.email_thread_category_corrections IS
  'User overrides of Phase C thread categorization. Phase C learns from these — domain+category pairs with count >= 2 become classification priors.';

-- Hot path: "has the user corrected threads from this domain before?"
CREATE INDEX IF NOT EXISTS idx_corrections_company_domain
  ON email_thread_category_corrections(company_id, sender_domain)
  WHERE sender_domain IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_corrections_company_sender
  ON email_thread_category_corrections(company_id, sender_email)
  WHERE sender_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_corrections_thread
  ON email_thread_category_corrections(thread_id);

-- RLS.
ALTER TABLE email_thread_category_corrections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'corrections_company_scope' AND tablename = 'email_thread_category_corrections'
  ) THEN
    CREATE POLICY corrections_company_scope ON email_thread_category_corrections
      FOR ALL USING (company_id = (auth.jwt()->>'company_id')::uuid);
  END IF;
END $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- email_connections: archive_writeback_preference
-- ═════════════════════════════════════════════════════════════════════════════

-- Whether OPS archive/unarchive actions propagate to the provider. User picks
-- on the first archive action per connection; cached from then on.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'email_connections'
      AND column_name = 'archive_writeback_preference'
  ) THEN
    ALTER TABLE email_connections
      ADD COLUMN archive_writeback_preference TEXT NOT NULL DEFAULT 'ask'
        CHECK (archive_writeback_preference IN ('ask','archive_in_gmail','mark_read_only','ops_only'));
  END IF;
END $$;

COMMENT ON COLUMN email_connections.archive_writeback_preference IS
  'Determines Gmail/M365 write-back behavior when a user archives in OPS. Default ''ask'' triggers the first-archive modal. See Inbox v2 spec.';


-- ═════════════════════════════════════════════════════════════════════════════
-- activities: classification provenance
-- ═════════════════════════════════════════════════════════════════════════════

-- Records which sync pass most recently caused classification of the thread
-- this message belongs to. Useful for debugging classification drift and for
-- the backfill script to know which activities still need their threads
-- classified.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'activities'
      AND column_name = 'classified_at'
  ) THEN
    ALTER TABLE activities ADD COLUMN classified_at TIMESTAMPTZ;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'activities'
      AND column_name = 'classifier_version'
  ) THEN
    ALTER TABLE activities ADD COLUMN classifier_version TEXT;
  END IF;
END $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- Updated-at trigger for email_threads
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION set_email_threads_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS email_threads_updated_at ON email_threads;
CREATE TRIGGER email_threads_updated_at
  BEFORE UPDATE ON email_threads
  FOR EACH ROW
  EXECUTE FUNCTION set_email_threads_updated_at();
