-- 20260527150000_onboarding_email_log.sql
-- Dedup + state table for the onboarding drip cron. UNIQUE (user_id, day_slot)
-- enforces one email per user per day-slot regardless of branch. Claim-before-send
-- pattern: INSERT pending ON CONFLICT DO NOTHING RETURNING id — only the winner
-- sends. See specs/2026-05-27-onboarding-drip-design.md §8 for the full schema
-- rationale.

DO $$ BEGIN
  CREATE TYPE onboarding_email_status AS ENUM (
    'pending', 'sent', 'failed', 'skipped'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.onboarding_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  day_slot text NOT NULL CHECK (day_slot IN (
    'day_0', 'day_1', 'day_3', 'day_4', 'day_8', 'day_14', 'lost_you'
  )),
  branch text NULL,
  email_type text NOT NULL,
  status onboarding_email_status NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  last_error text NULL,
  sent_at timestamptz NULL,
  sg_message_id text NULL,
  day_slot_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_email_log_unique UNIQUE (user_id, day_slot)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_email_log_company
  ON public.onboarding_email_log (company_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_email_log_sent_at
  ON public.onboarding_email_log (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_email_log_retry_sweep
  ON public.onboarding_email_log (day_slot_expires_at, status, attempts)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_onboarding_email_log_sg_message_id
  ON public.onboarding_email_log (sg_message_id)
  WHERE sg_message_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_onboarding_email_log_updated_at ON public.onboarding_email_log;
CREATE TRIGGER trg_onboarding_email_log_updated_at
  BEFORE UPDATE ON public.onboarding_email_log
  FOR EACH ROW EXECUTE FUNCTION public.fn_email_campaigns_set_updated_at();

COMMENT ON TABLE public.onboarding_email_log IS
  'Dedup + state table for the onboarding drip cron. UNIQUE (user_id, day_slot) enforces one email per user per day-slot regardless of branch. Claim-before-send pattern: INSERT pending ON CONFLICT DO NOTHING RETURNING id — only the winner sends.';

COMMENT ON COLUMN public.onboarding_email_log.email_type IS
  'The KIND_TO_LIST key passed to gatedSend (e.g. onboarding_day_1_no_project). Stored here so reconciliation queries against email_log can match by (recipient_email, email_type, sent_at window) without requiring a foreign key to email_log.id (gatedSend does not return that id).';

COMMENT ON COLUMN public.onboarding_email_log.branch IS
  'Which branch variant was sent. NULL for unbranched (day_0, day_3, day_8, lost_you). For branched days: no_project / has_project / no_aha / has_aha / quiet / active.';

COMMENT ON COLUMN public.onboarding_email_log.sg_message_id IS
  'SendGrid message id returned by gatedSend on successful send. Used to join against email_events for engagement metrics on this drip. NULL when status is not yet sent.';

COMMENT ON COLUMN public.onboarding_email_log.day_slot_expires_at IS
  'Hard end of the retry window for this row. Computed at insert: operator-local 9am of the target day + 24 hours, in UTC. After this time, the cron skips this row even if pending/failed — the send window for this day-slot is over.';

COMMENT ON COLUMN public.onboarding_email_log.status IS
  'pending: claim succeeded, send not yet attempted, OR paused by gatedSend pause check (re-tried on next cron tick until day_slot_expires_at). sent: gatedSend returned status=sent. failed: send attempted and errored; retried if attempts<3 AND now()<day_slot_expires_at. skipped: gatedSend returned suppression_skipped — terminal (suppressions are permanent opt-outs, not reversible like pauses).';
