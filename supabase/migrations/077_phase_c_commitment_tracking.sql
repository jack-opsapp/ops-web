-- =================================================================
-- Migration 077: Phase C — Commitment date tracking
--
-- Context
-- -------
-- Phase C extracts facts from email threads and stores them in
-- `agent_memories`. Until now those facts have been free-form text
-- with no structured date field, so commitments like "I'll have the
-- quote by Friday" existed as strings but couldn't be queried or
-- surfaced as overdue in the inbox.
--
-- This migration:
--   1. Adds `due_date` and `resolved_at` to `agent_memories`. Phase C
--      extraction (updated in memory-service.ts) writes `due_date`
--      when a message states an explicit deadline; `resolved_at` is
--      set by the Resolve affordance in the inbox OR automatically
--      when the parent thread is archived.
--   2. Adds `next_commitment_due_at` and `has_unresolved_commitments`
--      to `email_threads` — denormalized from `agent_memories` so the
--      COMMITMENTS inbox rail can filter/sort without joins.
--   3. A trigger on `agent_memories` keeps the denormalization fresh.
--   4. A second trigger on `email_threads.archived_at` auto-resolves
--      open commitments when the user archives the thread (cleanup).
--
-- Related code changes
-- --------------------
--   - src/lib/api/services/memory-service.ts — extract due_date from
--     the commitment prompt, validate, persist.
--   - Future: commitments rail, Resolve action, decay cron.

-- ─── Memory columns ─────────────────────────────────────────────────────────

ALTER TABLE agent_memories
  ADD COLUMN IF NOT EXISTS due_date timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

COMMENT ON COLUMN agent_memories.due_date IS
  'Commitment due timestamp. Populated by Phase C extraction for category=commitment memories, grounded against the source email date. NULL on non-commitment rows.';
COMMENT ON COLUMN agent_memories.resolved_at IS
  'When a commitment was marked resolved. NULL means unresolved — overdue if due_date < now(). Set via the inbox Resolve action or when the parent thread is archived.';

-- ─── Thread-level denormalization ───────────────────────────────────────────

ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS next_commitment_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS has_unresolved_commitments boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN email_threads.next_commitment_due_at IS
  'Earliest due_date across this thread''s unresolved commitments. Maintained by the recompute_thread_commitments trigger. NULL when no unresolved commitments.';
COMMENT ON COLUMN email_threads.has_unresolved_commitments IS
  'Denormalized flag — true when at least one agent_memories row with category=commitment, resolved_at IS NULL, due_date IS NOT NULL references this thread.';

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_email_threads_commitments
  ON email_threads (company_id, next_commitment_due_at ASC)
  WHERE has_unresolved_commitments = true;

CREATE INDEX IF NOT EXISTS idx_agent_memories_commitment_thread
  ON agent_memories (company_id, source_id, due_date ASC)
  WHERE category = 'commitment' AND due_date IS NOT NULL;

-- ─── Trigger: recompute thread commitment denorm ────────────────────────────

CREATE OR REPLACE FUNCTION recompute_thread_commitments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_ids text[] := ARRAY[]::text[];
  target_id_text text;
  target_id_uuid uuid;
  next_due timestamptz;
BEGIN
  -- Category gate: skip rows that are neither currently nor previously
  -- commitments. Keeps the trigger cheap for the general agent_memories
  -- insert path (which writes facts, pricing, etc. much more often).
  IF TG_OP = 'DELETE' AND OLD.category IS DISTINCT FROM 'commitment' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.category IS DISTINCT FROM 'commitment' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.category IS DISTINCT FROM 'commitment'
     AND NEW.category IS DISTINCT FROM 'commitment'
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.source_id IS NOT NULL THEN target_ids := target_ids || OLD.source_id; END IF;
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.source_id IS NOT NULL THEN target_ids := target_ids || NEW.source_id; END IF;
  ELSE
    IF NEW.source_id IS NOT NULL THEN target_ids := target_ids || NEW.source_id; END IF;
    IF OLD.source_id IS NOT NULL AND OLD.source_id IS DISTINCT FROM NEW.source_id THEN
      target_ids := target_ids || OLD.source_id;
    END IF;
  END IF;

  FOREACH target_id_text IN ARRAY target_ids
  LOOP
    BEGIN
      target_id_uuid := target_id_text::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      -- Legacy live-path memory (source_id is a date string, not a thread id) — skip.
      CONTINUE;
    END;

    SELECT MIN(due_date) INTO next_due
    FROM agent_memories
    WHERE source_id = target_id_text
      AND category = 'commitment'
      AND due_date IS NOT NULL
      AND resolved_at IS NULL;

    UPDATE email_threads
    SET next_commitment_due_at = next_due,
        has_unresolved_commitments = (next_due IS NOT NULL)
    WHERE id = target_id_uuid;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_thread_commitments ON agent_memories;
CREATE TRIGGER trg_recompute_thread_commitments
AFTER INSERT OR UPDATE OR DELETE ON agent_memories
FOR EACH ROW
EXECUTE FUNCTION recompute_thread_commitments();

-- ─── Auto-resolve on thread archive ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION auto_resolve_commitments_on_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- React to the null → not-null transition (the archive event).
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    UPDATE agent_memories
    SET resolved_at = NEW.archived_at
    WHERE source_id = NEW.id::text
      AND category = 'commitment'
      AND resolved_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_resolve_commitments_on_archive ON email_threads;
CREATE TRIGGER trg_auto_resolve_commitments_on_archive
AFTER UPDATE OF archived_at ON email_threads
FOR EACH ROW
EXECUTE FUNCTION auto_resolve_commitments_on_archive();
