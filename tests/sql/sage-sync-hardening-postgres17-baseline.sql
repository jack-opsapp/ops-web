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
  client_id uuid,
  qb_id text,
  sage_id text,
  status text not null default 'draft',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  name text not null default 'Test client',
  qb_id text,
  sage_id text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sub_clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  client_id uuid not null,
  qb_id text,
  sage_id text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  client_id uuid,
  qb_id text,
  sage_id text,
  status text not null default 'draft',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  invoice_id uuid,
  qb_id text,
  sage_id text,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.line_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  invoice_id uuid,
  estimate_id uuid,
  description text not null default 'Test line',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(invoice_id, estimate_id) = 1)
);

create table public.accounting_sync_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  connection_id uuid not null references public.accounting_connections(id) on delete cascade,
  provider text not null check (provider in ('quickbooks', 'sage')),
  entity_type text not null check (
    entity_type in (
      'customer', 'invoice', 'estimate', 'payment', 'supplier',
      'supplier_bill', 'supplier_bill_payment'
    )
  ),
  entity_id uuid not null,
  external_id text,
  operation text not null check (
    operation in (
      'create', 'update', 'void', 'inactivate', 'delete_soft', 'delete',
      'link', 'reconcile'
    )
  ),
  source_table text not null,
  source_action text not null check (
    source_action in ('insert', 'update', 'delete', 'soft_delete', 'void')
  ),
  source_updated_at timestamptz,
  idempotency_key text not null,
  status text not null default 'pending' check (
    status in (
      'pending', 'claimed', 'succeeded', 'failed', 'blocked',
      'needs_review', 'cancelled'
    )
  ),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  payload_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index accounting_sync_queue_active_uniq
  on public.accounting_sync_queue (
    company_id, connection_id, provider, entity_type, entity_id,
    operation, idempotency_key
  ) where status = 'pending';

create table public.accounting_sync_events (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid references public.accounting_sync_queue(id) on delete set null,
  company_id uuid not null,
  connection_id uuid references public.accounting_connections(id) on delete set null,
  provider text not null check (provider in ('quickbooks', 'sage')),
  direction text not null,
  entity_type text not null,
  entity_id text,
  external_id text,
  operation text not null,
  status text not null,
  source text not null,
  ops_updated_at timestamptz,
  qb_updated_at timestamptz,
  decision text,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now()
);

create table public.accounting_sync_suppressions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  provider text not null check (provider in ('quickbooks', 'sage')),
  entity_type text not null,
  entity_id uuid not null,
  source text not null check (source in ('quickbooks', 'sage')),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now(),
  unique (company_id, provider, entity_type, entity_id, source)
);

create schema private;

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
);

create table public.supplier_bills (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  supplier_id uuid not null
);

create table public.supplier_bill_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  bill_id uuid not null
);

create table public.supplier_bill_provider_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  connection_id uuid not null references public.accounting_connections(id) on delete cascade,
  provider text not null check (provider in ('quickbooks', 'sage')),
  entity_type text not null,
  entity_id uuid not null,
  external_id text not null,
  unique (connection_id, entity_type, entity_id),
  unique (connection_id, entity_type, external_id)
);

create or replace function public.enqueue_accounting_sync()
returns trigger
language plpgsql
as $$
begin
  return coalesce(new, old);
end;
$$;

create trigger accounting_sync_clients
after insert or update or delete on public.clients
for each row execute function public.enqueue_accounting_sync();
create trigger accounting_sync_sub_clients
after insert or update or delete on public.sub_clients
for each row execute function public.enqueue_accounting_sync();
create trigger accounting_sync_invoices
after insert or update or delete on public.invoices
for each row execute function public.enqueue_accounting_sync();
create trigger accounting_sync_estimates
after insert or update or delete on public.estimates
for each row execute function public.enqueue_accounting_sync();
create trigger accounting_sync_payments
after insert or update or delete on public.payments
for each row execute function public.enqueue_accounting_sync();
create trigger accounting_sync_line_items
after insert or update or delete on public.line_items
for each row execute function public.enqueue_accounting_sync();

alter table public.accounting_connections enable row level security;

grant select on table public.accounting_connections to anon, authenticated;
create policy accounting_connections_test_read
on public.accounting_connections for select
to anon, authenticated
using (true);
