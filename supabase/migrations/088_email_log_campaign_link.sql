-- 088_email_log_campaign_link.sql
ALTER TABLE public.email_log
  ADD COLUMN IF NOT EXISTS campaign_id uuid NULL
  REFERENCES public.email_campaigns (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_email_log_campaign_id
  ON public.email_log (campaign_id) WHERE campaign_id IS NOT NULL;

COMMENT ON COLUMN public.email_log.campaign_id IS
  'Set by worker when dispatching campaign emails. NULL for transactional sends. ON DELETE SET NULL preserves log when campaign is hard-deleted.';
