-- 093_email_pause_audit_log.sql
-- PR 4: Email killswitches.
--
-- Append-only audit log. Every pause / resume / auto-resume writes a row.
-- This is the legal record — never modify rows, never delete.

CREATE TABLE IF NOT EXISTS public.email_pause_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  action text NOT NULL,
  reason text,
  paused_until timestamptz,
  actor_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  actor_email text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT email_pause_audit_log_action_check
    CHECK (action IN ('pause', 'resume', 'auto_resume'))
);

CREATE INDEX IF NOT EXISTS idx_email_pause_audit_log_created_at
  ON public.email_pause_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_pause_audit_log_scope
  ON public.email_pause_audit_log (scope, created_at DESC);

-- Defense in depth: revoke UPDATE and DELETE from authenticated/anon roles.
-- Service role bypasses these.
REVOKE UPDATE, DELETE ON public.email_pause_audit_log FROM anon, authenticated;

COMMENT ON TABLE public.email_pause_audit_log IS
  'Immutable append-only audit log of every pause/resume action. Inserts only — UPDATE and DELETE revoked from non-service roles.';
COMMENT ON COLUMN public.email_pause_audit_log.action IS
  'pause | resume | auto_resume. auto_resume is written by the cron when now() > paused_until.';
COMMENT ON COLUMN public.email_pause_audit_log.actor_email IS
  'Email of the actor at the time of action — denormalized so the audit row remains readable even if the user is deleted.';
