-- 080_email_suppressions.sql
-- The suppression list. Every email send first checks this table; suppressed
-- recipients are silently skipped and logged with status='suppression_skipped'.

CREATE TABLE IF NOT EXISTS public.email_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  list text NOT NULL DEFAULT 'global',
  reason text NOT NULL,
  source text NOT NULL,
  source_event_id uuid REFERENCES public.email_events (id) ON DELETE SET NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,

  CONSTRAINT email_suppressions_reason_check
    CHECK (reason IN ('hard_bounce', 'soft_bounce', 'spam_report', 'unsubscribe', 'group_unsubscribe', 'manual', 'invalid_address')),

  CONSTRAINT email_suppressions_source_check
    CHECK (source IN ('webhook', 'manual', 'backfill', 'import'))
);

-- One suppression per (email, list) — re-suppressing updates the existing row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_suppressions_email_list
  ON public.email_suppressions (lower(email), list);

-- Lookup index for the send-time check (lowercase email, list filter).
CREATE INDEX IF NOT EXISTS idx_email_suppressions_email
  ON public.email_suppressions (lower(email));

CREATE INDEX IF NOT EXISTS idx_email_suppressions_reason
  ON public.email_suppressions (reason);

CREATE INDEX IF NOT EXISTS idx_email_suppressions_created_at
  ON public.email_suppressions (created_at DESC);

-- Comments for the next operator who walks in cold.
COMMENT ON TABLE public.email_suppressions IS
  'Email suppression list. Every send checks this table (via lib/email/suppressions.ts). Auto-populated by trigger trg_email_events_auto_suppress. Manual entries via /api/admin/email/suppressions.';

COMMENT ON COLUMN public.email_suppressions.list IS
  'Suppression scope. ''global'' suppresses all email; per-list values (e.g. ''field_notes'', ''product_updates'') let users unsubscribe from a specific channel without blocking transactional. Default global = full opt-out.';

COMMENT ON COLUMN public.email_suppressions.reason IS
  'Why the address is suppressed. hard_bounce/soft_bounce/spam_report/unsubscribe/group_unsubscribe come from webhook; manual/import from operator action; invalid_address from validation pre-send.';

COMMENT ON COLUMN public.email_suppressions.source IS
  'How the suppression was added: webhook (SendGrid event), manual (admin), backfill (one-time historical import), import (CSV upload).';

COMMENT ON COLUMN public.email_suppressions.expires_at IS
  'Optional auto-removal time. Used for soft bounces (re-try after 30d) and operator-imposed cooling-off periods. NULL = permanent.';
