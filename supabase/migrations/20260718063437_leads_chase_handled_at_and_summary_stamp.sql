ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS handled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS ai_summary_updated_at timestamptz NULL;

COMMENT ON COLUMN public.opportunities.handled_at IS
  'Operator declared the last inbound handled (chase flip). A newer last_inbound_at re-flips the lead to YOUR MOVE. iOS+web write; both triage engines read.';

COMMENT ON COLUMN public.opportunities.ai_summary_updated_at IS
  'When ai_summary was last written by the agent. Web summary writer sets it; clients show a freshness stamp only when present.';
