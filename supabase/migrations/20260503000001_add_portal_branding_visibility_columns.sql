-- Adds the per-template visibility toggles the Settings → Portal Branding screen
-- writes to. Without these columns the SettingsService update fails with
-- "Could not find the 'show_descriptions' column of 'portal_branding' in the
-- schema cache" (bug_reports 08571812).

ALTER TABLE public.portal_branding
  ADD COLUMN IF NOT EXISTS show_quantities boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_unit_prices boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_line_totals boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_descriptions boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_tax boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_discount boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.portal_branding.show_quantities  IS 'Whether quantity column is visible on portal-rendered estimates/invoices.';
COMMENT ON COLUMN public.portal_branding.show_unit_prices IS 'Whether per-unit price column is visible on portal-rendered estimates/invoices.';
COMMENT ON COLUMN public.portal_branding.show_line_totals IS 'Whether per-line total column is visible on portal-rendered estimates/invoices.';
COMMENT ON COLUMN public.portal_branding.show_descriptions IS 'Whether the description column is visible on portal-rendered estimates/invoices.';
COMMENT ON COLUMN public.portal_branding.show_tax        IS 'Whether the tax row is visible on portal-rendered totals.';
COMMENT ON COLUMN public.portal_branding.show_discount   IS 'Whether the discount row is visible on portal-rendered totals.';
