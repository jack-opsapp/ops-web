-- Add nullable event_kind + content_metadata to project_notes for unified timeline rendering on web.
-- iOS-additive: existing rows untouched, no CHECK constraint, defaults NULL.
-- Refactor cleanly after next iOS release.
--
-- event_kind: web-side type discriminator. NULL = user-authored note (default, iOS-compatible).
--   Non-null values render as system events on the workspace Activity timeline.
-- content_metadata: JSONB structured payload for system events (status_change from/to, payment id/amount,
--   estimate id/number/total, etc.). NULL for plain notes. iOS ignores until next release.

ALTER TABLE project_notes
  ADD COLUMN IF NOT EXISTS event_kind TEXT,
  ADD COLUMN IF NOT EXISTS content_metadata JSONB;

COMMENT ON COLUMN project_notes.event_kind IS
  'Web-side type discriminator for the unified Activity timeline. NULL = user-authored note (default, iOS-compatible). Non-null values: status_change, estimate_sent, estimate_approved, estimate_declined, invoice_sent, payment_received, expense_logged, photo_uploaded, project_created, project_archived, task_completed. iOS ignores until next release.';

COMMENT ON COLUMN project_notes.content_metadata IS
  'Structured payload for system events on the unified Activity timeline. NULL for user notes. Examples: {from,to} for status_change; {estimateId,estimateNumber,total} for estimate_sent; {paymentId,amount,method} for payment_received. iOS ignores until next release.';

CREATE INDEX IF NOT EXISTS idx_project_notes_event_kind
  ON project_notes(project_id, event_kind, created_at DESC)
  WHERE event_kind IS NOT NULL;
