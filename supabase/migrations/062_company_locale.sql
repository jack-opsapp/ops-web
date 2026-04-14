-- Phase C final fix pass: per-company locale for server-rendered text.
--
-- The AI/agent services generate client-facing text (email subjects,
-- fallback draft bodies, notification titles/bodies, lifecycle task
-- titles) entirely server-side. Until now those strings were hardcoded
-- English, which broke Spanish-locale customers the moment an automated
-- message went out.
--
-- Adding companies.locale lets the server-side renderer look up the
-- company's preferred language at generation time and load the right
-- dictionary.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en';

-- Constrain to supported locales — matches src/i18n/config.ts.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_locale_check'
  ) THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_locale_check
      CHECK (locale IN ('en', 'es'));
  END IF;
END $$;

COMMENT ON COLUMN companies.locale IS
  'IETF language tag for server-rendered client-facing text. '
  'Supported values mirror src/i18n/config.ts supportedLocales.';
