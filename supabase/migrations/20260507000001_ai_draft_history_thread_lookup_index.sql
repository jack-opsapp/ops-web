-- Phase 3.1 — Inbox v2 phaseC derivation
--
-- The inbox list endpoint joins email_threads against ai_draft_history on
-- (connection_id, thread_id) to derive each thread's phaseC state
-- ('drafted' / 'sent') for column grouping and detail-band selection.
--
-- ai_draft_history.thread_id is the PROVIDER thread id (Gmail thread id /
-- M365 conversationId), keyed as text. Existing indexes are scoped to
-- (company_id, user_id, ...) for write/learning paths; the new join needs
-- a (connection_id, thread_id) lookup that returns the latest row first.
--
-- The DESC ordering on created_at lets the dedupe pass in
-- enrichWithPhaseC() short-circuit on the first row per (connection, thread)
-- pair without a subsequent sort, and supports cheap "latest draft for this
-- thread" probes from any future caller.

CREATE INDEX IF NOT EXISTS idx_ai_draft_history_thread_lookup
  ON public.ai_draft_history (connection_id, thread_id, created_at DESC);

COMMENT ON INDEX public.idx_ai_draft_history_thread_lookup IS
  'Supports inbox v2 phaseC join: latest draft row per (connection_id, thread_id). thread_id is the provider thread id, matching email_threads.provider_thread_id.';
