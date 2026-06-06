begin;

alter table public.accounting_connections
  add column if not exists provider_environment text not null default 'production';

alter table public.accounting_connections
  drop constraint if exists accounting_connections_provider_environment_check;

alter table public.accounting_connections
  add constraint accounting_connections_provider_environment_check
  check (provider_environment = any (array['production'::text, 'sandbox'::text]));

alter table public.accounting_connections
  drop constraint if exists accounting_connections_company_id_provider_key;

alter table public.accounting_connections
  add constraint accounting_connections_company_provider_environment_key
  unique (company_id, provider, provider_environment);

alter table public.qbo_import_runs
  add column if not exists provider_environment text not null default 'production';

alter table public.qbo_import_runs
  drop constraint if exists qbo_import_runs_provider_environment_check;

alter table public.qbo_import_runs
  add constraint qbo_import_runs_provider_environment_check
  check (provider_environment = any (array['production'::text, 'sandbox'::text]));

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'accounting_connections'
      and column_name = 'provider_environment'
      and data_type = 'text'
      and is_nullable = 'NO'
  ) then
    raise exception 'qbo_provider_environment_sentinel: accounting_connections.provider_environment missing';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'accounting_connections'
      and c.conname = 'accounting_connections_company_provider_environment_key'
  ) then
    raise exception 'qbo_provider_environment_sentinel: provider environment unique constraint missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'qbo_import_runs'
      and column_name = 'provider_environment'
      and data_type = 'text'
      and is_nullable = 'NO'
  ) then
    raise exception 'qbo_provider_environment_sentinel: qbo_import_runs.provider_environment missing';
  end if;
end $$;

commit;
