-- 091_email_jobs_unique_constraint.sql
-- supabase-js upsert with `onConflict` only resolves plain column-based UNIQUE
-- constraints, not expression indexes. Switch to a column UNIQUE constraint
-- so enqueueCampaignJobs can use ignoreDuplicates upsert. Email is always
-- pre-lowercased by enqueueCampaignJobs so the lower() expression was redundant.

ALTER TABLE public.email_jobs
  DROP CONSTRAINT IF EXISTS uq_email_jobs_campaign_recipient;

DROP INDEX IF EXISTS public.uq_email_jobs_campaign_recipient;

ALTER TABLE public.email_jobs
  ADD CONSTRAINT uq_email_jobs_campaign_recipient
  UNIQUE (campaign_id, recipient_email);

COMMENT ON CONSTRAINT uq_email_jobs_campaign_recipient ON public.email_jobs IS
  'Idempotent unique key. Caller (enqueueCampaignJobs) lowercases recipient_email before insert so case-folding is enforced upstream.';
