-- 084_newsletter_subscribers_consent.sql
-- CASL (S.C. 2010, c. 23) requires proof of consent for commercial email
-- to Canadian recipients. We record the timestamp, IP, and source of the
-- subscribe action.

ALTER TABLE public.newsletter_subscribers
  ADD COLUMN IF NOT EXISTS consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_ip text,
  ADD COLUMN IF NOT EXISTS consent_source text;

-- Backfill existing rows with their subscribed_at for consent_at; we don't
-- know the IP or source for historical rows.
UPDATE public.newsletter_subscribers
   SET consent_at = COALESCE(consent_at, subscribed_at)
 WHERE consent_at IS NULL;

COMMENT ON COLUMN public.newsletter_subscribers.consent_at IS
  'Timestamp the subscriber explicitly opted in. Required for CASL proof of consent.';
COMMENT ON COLUMN public.newsletter_subscribers.consent_ip IS
  'IP address recorded at consent time. NULL for historical pre-2026-04 rows.';
COMMENT ON COLUMN public.newsletter_subscribers.consent_source IS
  'Where the consent originated: blog_signup | landing_page | onboarding | manual_admin | import. NULL for historical rows.';

CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_consent_at
  ON public.newsletter_subscribers (consent_at DESC);
