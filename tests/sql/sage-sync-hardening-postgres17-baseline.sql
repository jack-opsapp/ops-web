do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;

create table public.accounting_connections (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  provider text not null,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  realm_id text,
  realm_id_lookup text,
  is_connected boolean not null default false,
  sync_enabled boolean not null default false,
  sync_direction text not null default 'pull_only'
    check (sync_direction in ('pull_only', 'push_only', 'bidirectional')),
  propagate_deletes boolean not null default false,
  provider_environment text not null default 'production'
    check (provider_environment in ('production', 'sandbox')),
  last_sync_at timestamptz,
  webhook_verifier_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, provider, provider_environment)
);

create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  sage_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.accounting_connections enable row level security;

grant select on table public.accounting_connections to anon, authenticated;
create policy accounting_connections_test_read
on public.accounting_connections for select
to anon, authenticated
using (true);
