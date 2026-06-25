-- Company-scoped catalog setup completion. company_settings.company_id is TEXT
-- (PK), not uuid — the service layer must pass company_id as text. Additive +
-- iOS-safe: a nullable timestamptz the iOS app ignores. NULL = not completed.
--
-- FILES ONLY — DO NOT APPLY without Jackson's explicit per-action go-ahead.
--
-- VERIFY-BEFORE (read-only; expected: EMPTY set before apply):
--   select column_name from information_schema.columns
--   where table_schema='public' and table_name='company_settings'
--     and column_name='catalog_setup_completed_at';
-- VERIFY-AFTER: same query → one row (type: timestamp with time zone).
--
-- ROLLBACK (additive — forward-only convention, no separate down-migration):
--   alter table public.company_settings
--     drop column if exists catalog_setup_completed_at;
begin;

alter table public.company_settings
  add column if not exists catalog_setup_completed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='company_settings'
      and column_name='catalog_setup_completed_at'
  ) then
    raise exception 'catalog_setup_completed_sentinel: column missing after add';
  end if;
end $$;

commit;
