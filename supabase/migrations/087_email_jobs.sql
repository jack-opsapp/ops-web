-- 087_email_jobs.sql
-- One row per recipient per campaign. Worker cron claims pending → calls gatedSend → updates terminal.

DO $$ BEGIN
  CREATE TYPE email_job_status AS ENUM (
    'pending', 'dispatching', 'sent', 'bounced',
    'failed', 'cancelled', 'skipped_suppressed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.email_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.email_campaigns (id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  recipient_user_id uuid NULL,
  status email_job_status NOT NULL DEFAULT 'pending',
  template_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  sg_message_id text NULL,
  sent_at timestamptz NULL,
  last_error text NULL,
  retry_count int NOT NULL DEFAULT 0,
  event_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_jobs_campaign_recipient
  ON public.email_jobs (campaign_id, lower(recipient_email));

CREATE INDEX IF NOT EXISTS idx_email_jobs_campaign_status ON public.email_jobs (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_email_jobs_status_created
  ON public.email_jobs (status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_email_jobs_sg_message_id ON public.email_jobs (sg_message_id) WHERE sg_message_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_email_jobs_updated_at ON public.email_jobs;
CREATE TRIGGER trg_email_jobs_updated_at
  BEFORE UPDATE ON public.email_jobs
  FOR EACH ROW EXECUTE FUNCTION public.fn_email_campaigns_set_updated_at();

COMMENT ON TABLE public.email_jobs IS
  'One row per (campaign, recipient). Idempotent unique key (campaign_id, lower(email)) prevents duplicate dispatch on dispatcher retry.';
COMMENT ON COLUMN public.email_jobs.template_payload IS
  'Per-recipient template variables (firstName, companyName, unsubscribeToken, etc). Resolved by dispatcher before enqueue, consumed by worker.';
