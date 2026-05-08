-- Phase 3.2 — Inbox v2 NeedsInput band signal
--
-- When Claude (Phase C) cannot draft a reply without operator input —
-- because it lacks information that only the operator has (pricing,
-- availability, a judgment call) — it records the blocking question on
-- the thread itself. The inbox renders this as the lavender NeedsInput
-- band; answering clears the column.
--
-- Shape:
--   {
--     "question":  "What's the price range for this scope?",
--     "options":   [{"id": "low", "label": "$200-300"},
--                   {"id": "high", "label": "$400-500"}],
--     "asked_at":  "2026-05-07T12:00:00Z"
--   }
--
-- `options` is optional — when omitted, the band falls back to a single
-- "Provide answer" free-form CTA. NULL on the column means "no
-- escalation pending", which is the steady state for almost every thread.
--
-- The partial index keeps the "show all blocked threads" lookup cheap
-- without adding bloat to the much larger NULL-bucket.

ALTER TABLE public.email_threads
  ADD COLUMN IF NOT EXISTS agent_blocking_question jsonb;

COMMENT ON COLUMN public.email_threads.agent_blocking_question IS
  'Phase C escalation when Claude cannot draft without operator input. Shape: {question, options?, asked_at}. NULL when no escalation is pending; cleared when the operator answers.';

CREATE INDEX IF NOT EXISTS idx_email_threads_blocking_question
  ON public.email_threads (company_id)
  WHERE agent_blocking_question IS NOT NULL;

COMMENT ON INDEX public.idx_email_threads_blocking_question IS
  'Partial index for "blocked threads in this company" — drives the NEEDS_INPUT column group and any future operator dashboard.';
