-- =================================================================
-- Migration 078: Phase C — extraction marker on email_threads
--
-- Lets the backfill route skip threads it has already attempted,
-- even when the LLM produced zero facts for them (short threads,
-- auto-replies, etc.). Without this column, the idempotency filter
-- on agent_memories presence would re-process every dateless or
-- factless thread on every run.
--
-- Backfill policy: existing agent_memories rows carry
-- source_id = thread.id, so any thread with at least one memory
-- has already been through extraction. We seed the column from the
-- MAX(created_at) of those memories so future re-runs have a
-- meaningful comparison point.

ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS phase_c_extracted_at timestamptz;

COMMENT ON COLUMN email_threads.phase_c_extracted_at IS
  'Timestamp of the last successful Phase C extraction pass over this thread. NULL = never processed. Set by /api/inbox/phase-c-backfill after each thread.';

-- Partial index on NULL values — the backfill route queries specifically
-- for unprocessed threads, and this index is the whole point of the
-- denormalization.
CREATE INDEX IF NOT EXISTS idx_email_threads_phase_c_extracted
  ON email_threads (company_id, phase_c_extracted_at)
  WHERE phase_c_extracted_at IS NULL;

UPDATE email_threads t
SET phase_c_extracted_at = m.last_created
FROM (
  SELECT source_id, MAX(created_at) AS last_created
  FROM agent_memories
  WHERE source_id IS NOT NULL
  GROUP BY source_id
) m
WHERE m.source_id = t.id::text
  AND t.phase_c_extracted_at IS NULL;
