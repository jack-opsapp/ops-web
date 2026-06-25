-- Multi-tenant scoping for catalog-setup wizard analytics (plan Task 6.1).
--
-- `wizard_analytics` is shared with the iOS app. This column is additive +
-- nullable with no default, so it is App-Store-safe (the iOS client reads the
-- table and ignores unknown columns) and the ALTER is non-locking on Postgres
-- 11+ (no table rewrite for a nullable column without a default).
alter table public.wizard_analytics
  add column if not exists company_id uuid references public.companies(id) on delete set null;

create index if not exists wizard_analytics_company_id_idx
  on public.wizard_analytics (company_id);

comment on column public.wizard_analytics.company_id is
  'Company the wizard session belongs to. Nullable for legacy iOS rows.';
