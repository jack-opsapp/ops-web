-- 099_email_jobs_template_version.sql
-- Captures the template version each campaign job was rendered with.

ALTER TABLE public.email_jobs
  ADD COLUMN IF NOT EXISTS template_version text;

CREATE INDEX IF NOT EXISTS idx_email_jobs_campaign_version
  ON public.email_jobs (campaign_id, template_version)
  WHERE template_version IS NOT NULL;

COMMENT ON COLUMN public.email_jobs.template_version IS
  'Semver template version at job dispatch time. Used by version-compare analytics.';
