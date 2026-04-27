-- 083_email_log_status_doc.sql
-- Document the status values email_log can hold and relax user_id NOT NULL
-- so the gated send chokepoint can log system-initiated emails (e.g. password
-- reset, portal magic link) that have no associated user row yet.

ALTER TABLE public.email_log
  ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN public.email_log.user_id IS
  'OPS user who triggered the send. NULL for system-initiated sends (auth flows, portal magic links, anonymous newsletter recipients) where no user row applies.';

COMMENT ON COLUMN public.email_log.status IS
  'Send outcome. Canonical values: sent (dispatched to SendGrid), failed (transport error), suppression_skipped (recipient on email_suppressions, silently skipped).';
