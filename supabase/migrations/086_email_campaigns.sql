-- 086_email_campaigns.sql
-- Marketing and lifecycle email campaigns. One row per send (or scheduled send).

DO $$ BEGIN
  CREATE TYPE email_campaign_status AS ENUM (
    'draft', 'scheduled', 'in_flight',
    'completed', 'failed', 'cancelled', 'paused'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  template_id text NOT NULL,
  audience_filter jsonb NOT NULL DEFAULT '{}'::jsonb,
  audience_template_id uuid NULL,  -- FK added by PR 5 once email_audience_templates exists
  scheduled_for timestamptz NULL,
  send_status email_campaign_status NOT NULL DEFAULT 'draft',
  recipient_count_estimate int NOT NULL DEFAULT 0,
  recipient_count_actual int NULL,
  sent_count int NOT NULL DEFAULT 0,
  delivered_count int NOT NULL DEFAULT 0,
  bounced_count int NOT NULL DEFAULT 0,
  opened_count int NOT NULL DEFAULT 0,
  clicked_count int NOT NULL DEFAULT 0,
  suppressed_skipped_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  paused_at timestamptz NULL,
  pause_reason text NULL,
  created_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_email_campaigns_status ON public.email_campaigns (send_status);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_scheduled_for ON public.email_campaigns (scheduled_for) WHERE send_status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_email_campaigns_created_at ON public.email_campaigns (created_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.fn_email_campaigns_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_email_campaigns_updated_at ON public.email_campaigns;
CREATE TRIGGER trg_email_campaigns_updated_at
  BEFORE UPDATE ON public.email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.fn_email_campaigns_set_updated_at();

COMMENT ON TABLE public.email_campaigns IS
  'Marketing and lifecycle email campaigns. Scheduled by admin, dispatched by /api/cron/email/dispatcher, worked by /api/cron/email/worker. Counters are atomically updated via increment_campaign_counter RPC.';
COMMENT ON COLUMN public.email_campaigns.audience_filter IS
  'JSONB filter resolved by PR 5 audience RPC. PR 3 supports starter shapes: {segment:"all_users"}, {segment:"trial_users"}, {segment:"active_subscribers"}.';
COMMENT ON COLUMN public.email_campaigns.audience_template_id IS
  'Optional FK to email_audience_templates (added by PR 5). When set, dispatcher uses the template filter and increments last_used_count.';
