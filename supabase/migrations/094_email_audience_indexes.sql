-- 094_email_audience_indexes.sql
-- Indexes for the audience filter hot paths. The full filter scan is bounded
-- by users.is_active=true + email NOT NULL + removed_from_email_list. Below
-- adds composite indexes for the most common predicate columns.

CREATE INDEX IF NOT EXISTS idx_users_active_emailable
  ON public.users (is_active, removed_from_email_list)
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_role
  ON public.users (role)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_users_company_id
  ON public.users (company_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_companies_subscription_status
  ON public.companies (subscription_status);

CREATE INDEX IF NOT EXISTS idx_companies_subscription_plan
  ON public.companies (subscription_plan);

ANALYZE public.users;
ANALYZE public.companies;
