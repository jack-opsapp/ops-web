-- Catalog re-import identity: lets a re-run of the wizard / a repeated QB/CSV
-- import re-sync the SAME row instead of duplicating it. Additive + iOS-safe:
-- nullable columns + partial indexes only. iOS reads these as absent until its
-- next App Store release and is unaffected.
--
-- FILES ONLY — DO NOT APPLY without Jackson's explicit per-action go-ahead.
--
-- VERIFY-BEFORE (read-only, run against prod; expected: EMPTY set before apply —
-- the idempotent `if not exists` makes re-apply safe regardless):
--   select table_name, column_name from information_schema.columns
--   where table_schema='public' and column_name in ('external_source','external_id')
--     and table_name in ('products','catalog_variants','catalog_items') order by 1,2;
-- VERIFY-AFTER: same query → six rows (three tables × two columns).
--
-- ROLLBACK (additive, rarely needed — repo convention is forward-only with
-- sentinels, so no separate down-migration ships):
--   drop index if exists public.uniq_products_external_id_per_company;
--   drop index if exists public.uniq_catalog_variants_external_id_per_company;
--   drop index if exists public.uniq_catalog_items_external_id_per_company;
--   alter table public.products
--     drop column if exists external_source, drop column if exists external_id;
--   alter table public.catalog_variants
--     drop column if exists external_source, drop column if exists external_id;
--   alter table public.catalog_items
--     drop column if exists external_source, drop column if exists external_id;
begin;

alter table public.products
  add column if not exists external_source text,
  add column if not exists external_id     text;

alter table public.catalog_variants
  add column if not exists external_source text,
  add column if not exists external_id     text;

alter table public.catalog_items
  add column if not exists external_source text,
  add column if not exists external_id     text;

-- One identity per (company, source) — partial so legacy rows (NULL external_id)
-- never collide. Mirrors the existing per-company SKU uniqueness pattern.
create unique index if not exists uniq_products_external_id_per_company
  on public.products (company_id, external_source, external_id)
  where external_id is not null and deleted_at is null;

create unique index if not exists uniq_catalog_variants_external_id_per_company
  on public.catalog_variants (company_id, external_source, external_id)
  where external_id is not null and deleted_at is null;

create unique index if not exists uniq_catalog_items_external_id_per_company
  on public.catalog_items (company_id, external_source, external_id)
  where external_id is not null and deleted_at is null;

-- Sentinel: all six columns + three indexes must exist, else roll back.
do $$
begin
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public'
      and (table_name, column_name) in (
        ('products','external_source'), ('products','external_id'),
        ('catalog_variants','external_source'), ('catalog_variants','external_id'),
        ('catalog_items','external_source'), ('catalog_items','external_id')
      )
  ) <> 6 then
    raise exception 'catalog_external_identity_sentinel: missing external_source/external_id column(s)';
  end if;
  if (
    select count(*) from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'uniq_products_external_id_per_company',
        'uniq_catalog_variants_external_id_per_company',
        'uniq_catalog_items_external_id_per_company'
      )
  ) <> 3 then
    raise exception 'catalog_external_identity_sentinel: missing dedupe index(es)';
  end if;
end $$;

commit;
