-- ─────────────────────────────────────────────────────────────────────────────
-- 070_phase_c_row_lock.sql
-- Phase C Row-Level Execution Lock
--
-- Prevents concurrent runners of the chunked Phase C pipeline from racing on
-- the same gmail_scan_jobs row. Without this, a webhook retry or duplicate
-- /analyze-memory-continue dispatch puts two runners through the same thread
-- range — downstream DB writes are upsert-safe but phaseCStats (in-memory
-- accumulators) and profilesBuilt counts would be clobbered or double-counted
-- by whichever runner finalizes last.
--
-- Chosen deliberately over pg_try_advisory_xact_lock because xact-level
-- advisory locks release at transaction end, which for chunked Phase C means
-- per-chunk (too short — doesn't protect the multi-chunk run). Session-level
-- advisory locks are keyed to the Postgres connection, which for a pooled
-- service-role client is ambient and can't be released by a different
-- invocation after a crash. Row-level with an expiry avoids both problems.
--
-- Semantics:
--   - phase_c_lock_holder_id: opaque string identifying the holder. Composed
--     as "<stage>:<uuid>" ("entry:…" or "continuation:…") by the caller so
--     logs can distinguish which invocation last held the lock.
--   - phase_c_lock_expires_at: wall-clock expiry. Covers crash cases where a
--     runner dies mid-chunk without calling release; the next attempt treats
--     expired locks as free.
--
-- Lease duration is 900s (chosen by the caller), slightly longer than the
-- route's 800s maxDuration so a hard crash between the final runPhaseCChunks
-- yield and the outer finally can't block a retry for more than ~one
-- invocation lifetime.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE gmail_scan_jobs
  ADD COLUMN phase_c_lock_holder_id TEXT,
  ADD COLUMN phase_c_lock_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN gmail_scan_jobs.phase_c_lock_holder_id IS
  'Opaque string identifying the Phase C runner holding this row. NULL = no lock. See migration 070_phase_c_row_lock.sql.';
COMMENT ON COLUMN gmail_scan_jobs.phase_c_lock_expires_at IS
  'Wall-clock expiry for phase_c_lock_holder_id. Expired locks are treated as free on next acquisition.';

-- Atomic acquisition. Claims the lock iff currently unheld or expired.
-- Returns TRUE on success, FALSE on contention. The WHERE clause is the
-- atomicity guarantee: PostgreSQL evaluates it under row-level locking, so
-- two concurrent callers see serialized access to the same row.
CREATE OR REPLACE FUNCTION acquire_phase_c_lock(
  p_job_id UUID,
  p_holder TEXT,
  p_lease_seconds INT DEFAULT 900
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows INT;
BEGIN
  UPDATE gmail_scan_jobs
  SET phase_c_lock_holder_id = p_holder,
      phase_c_lock_expires_at = NOW() + (p_lease_seconds || ' seconds')::INTERVAL
  WHERE id = p_job_id
    AND (phase_c_lock_holder_id IS NULL
         OR phase_c_lock_expires_at < NOW());

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

-- Fenced release. Only clears the lock if the supplied holder still owns it.
-- Calling twice with the same holder, or after another runner has stolen an
-- expired lock, is a no-op — important for the outer finally() in the route
-- handlers, which runs even after the inner function has already released
-- ahead of a continuation dispatch.
CREATE OR REPLACE FUNCTION release_phase_c_lock(
  p_job_id UUID,
  p_holder TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE gmail_scan_jobs
  SET phase_c_lock_holder_id = NULL,
      phase_c_lock_expires_at = NULL
  WHERE id = p_job_id
    AND phase_c_lock_holder_id = p_holder;
END;
$$;
