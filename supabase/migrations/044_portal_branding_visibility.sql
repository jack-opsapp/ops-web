-- 044_portal_branding_visibility.sql
-- Add nullable document visibility overrides to portal branding.
-- NULL = inherit from document template. true/false = force override.

ALTER TABLE portal_branding
  ADD COLUMN show_quantities BOOLEAN DEFAULT NULL,
  ADD COLUMN show_unit_prices BOOLEAN DEFAULT NULL,
  ADD COLUMN show_line_totals BOOLEAN DEFAULT NULL,
  ADD COLUMN show_descriptions BOOLEAN DEFAULT NULL,
  ADD COLUMN show_tax BOOLEAN DEFAULT NULL,
  ADD COLUMN show_discount BOOLEAN DEFAULT NULL;
