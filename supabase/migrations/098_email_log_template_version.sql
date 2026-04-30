-- 098_email_log_template_version.sql
-- Captures which template version was rendered for each send.
-- Format: semver "1.0.0" — must match the @template-version comment header
-- in src/lib/email/react/templates/*.tsx.

ALTER TABLE public.email_log
  ADD COLUMN IF NOT EXISTS template_version text;

CREATE INDEX IF NOT EXISTS idx_email_log_template_version
  ON public.email_log (email_type, template_version)
  WHERE template_version IS NOT NULL;

COMMENT ON COLUMN public.email_log.template_version IS
  'Semver template version at send time. Set by gatedSend from the resolved template registry. NULL for sends predating PR 6.';
