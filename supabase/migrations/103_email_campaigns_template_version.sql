-- 103_email_campaigns_template_version.sql
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS template_version text;

COMMENT ON COLUMN public.email_campaigns.template_version IS
  'Snapshot of template version at campaign-create time. Used by analytics version-compare.';
