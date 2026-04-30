-- 085_companies_physical_address.sql
-- Required by CAN-SPAM / CASL for whitelabel portal emails sent on behalf of
-- the company. Used in PortalEmailLayout's compliance footer.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS physical_address text;

COMMENT ON COLUMN public.companies.physical_address IS
  'Postal mailing address used in compliance footers of whitelabel portal emails. Format: "Street, City, Province/State Postal, Country". Operator-set in Settings → Company.';
