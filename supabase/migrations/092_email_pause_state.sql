-- 092_email_pause_state.sql
-- PR 4: Email killswitches.
--
-- Live pause state. One row per scope. The chokepoint reads from this table
-- on every send. Three scope shapes:
--
--   'global'                                       — hard stop, all email
--   'bucket:dispatch' / 'bucket:gate' / 'bucket:field_notes' / 'bucket:portal'
--   'campaign:<uuid>'                              — paused individual campaign
--
-- Resolution order in gatedSend: global → bucket → campaign.

CREATE TABLE IF NOT EXISTS public.email_pause_state (
  scope text PRIMARY KEY,
  is_paused boolean NOT NULL DEFAULT false,
  pause_reason text,
  paused_until timestamptz,
  paused_at timestamptz,
  paused_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  resumed_at timestamptz,
  resumed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT email_pause_state_scope_check CHECK (
    scope = 'global'
    OR scope IN ('bucket:dispatch', 'bucket:gate', 'bucket:field_notes', 'bucket:portal')
    OR scope ~ '^campaign:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
);

-- Partial index — most rows are not paused; we want a fast path for
-- "list all active pauses" used by the banner.
CREATE INDEX IF NOT EXISTS idx_email_pause_state_active
  ON public.email_pause_state (scope)
  WHERE is_paused = true;

-- Seed the global row so the chokepoint always has something to read.
INSERT INTO public.email_pause_state (scope, is_paused)
VALUES ('global', false)
ON CONFLICT (scope) DO NOTHING;

COMMENT ON TABLE public.email_pause_state IS
  'Per-scope pause state. Read by gatedSend before every send. Single row per scope.';
COMMENT ON COLUMN public.email_pause_state.scope IS
  'global | bucket:<name> | campaign:<uuid>. The chokepoint resolves the active scope for a given send by checking global -> bucket -> campaign in order.';
COMMENT ON COLUMN public.email_pause_state.paused_until IS
  'Auto-resume time. Set to NULL for indefinite pause. Crons / send paths auto-resume when now() > paused_until.';
