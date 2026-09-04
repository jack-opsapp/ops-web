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
  id uuid primary key,
  company_id text not null,
  provider text not null,
  provider_environment text not null,
  is_connected boolean not null default false,
  sync_enabled boolean not null default false,
  sync_direction text not null default 'pull_only',
  last_sync_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key,
  company_id uuid not null,
  qb_id text,
  deleted_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key,
  company_id uuid not null,
  qb_id text,
  total numeric(12,2) not null,
  amount_paid numeric(12,2) not null default 0,
  balance_due numeric(12,2) not null default 0,
  status text not null,
  due_date date,
  paid_at timestamptz,
  deleted_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.estimates (
  id uuid primary key,
  company_id uuid not null,
  qb_id text,
  status text not null default 'draft',
  deleted_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key,
  company_id uuid not null,
  client_id uuid,
  invoice_id uuid references public.invoices(id),
  qb_id text,
  amount numeric(12,2) not null,
  voided_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.accounting_sync_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  connection_id uuid not null,
  provider text not null,
  entity_type text not null,
  entity_id uuid not null,
  external_id text,
  operation text not null,
  source_table text not null,
  source_action text not null,
  source_updated_at timestamptz,
  idempotency_key text not null,
  status text not null default 'pending',
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

create table public.accounting_sync_events (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid,
  company_id uuid not null,
  connection_id uuid not null,
  provider text not null,
  direction text not null,
  entity_type text not null,
  entity_id text,
  external_id text,
  operation text not null,
  status text not null,
  source text not null,
  decision text,
  before_snapshot jsonb,
  after_snapshot jsonb,
  error text,
  ops_updated_at timestamptz,
  qb_updated_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.invoice_update_emissions (
  invoice_id uuid not null,
  emitted_at timestamptz not null default now()
);

create or replace function public.capture_invoice_update_emission()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_setting('ops.sync_source', true) is distinct from 'quickbooks' then
    insert into public.invoice_update_emissions (invoice_id) values (new.id);
  end if;
  return new;
end;
$$;

create trigger trg_accounting_sync_queue_invoices
  after update on public.invoices
  for each row execute function public.capture_invoice_update_emission();

create or replace function public.update_invoice_balance()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_invoice_id uuid;
  v_total_paid numeric(12,2);
  v_invoice_total numeric(12,2);
begin
  v_invoice_id := coalesce(new.invoice_id, old.invoice_id);

  select coalesce(sum(amount), 0) into v_total_paid
  from public.payments where invoice_id = v_invoice_id and voided_at is null;

  select total into v_invoice_total from public.invoices where id = v_invoice_id;

  update public.invoices set
    amount_paid = v_total_paid,
    balance_due = v_invoice_total - v_total_paid,
    status = case
      when v_total_paid >= v_invoice_total then 'paid'
      when v_total_paid > 0 then 'partially_paid'
      else status
    end,
    paid_at = case when v_total_paid >= v_invoice_total then now() else null end,
    updated_at = now()
  where id = v_invoice_id;

  return new;
end;
$$;

create trigger trg_payment_balance
  after insert or update or delete on public.payments
  for each row execute function public.update_invoice_balance();

create or replace function public.claim_accounting_sync_queue(
  p_provider text default 'quickbooks',
  p_limit integer default 25,
  p_worker_id text default 'qbo-worker',
  p_stale_after_seconds integer default 900
)
returns setof public.accounting_sync_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select id
    from public.accounting_sync_queue
    where provider = p_provider
      and status = 'pending'
      and run_after <= now()
    order by run_after asc, created_at asc
    for update skip locked
    limit least(coalesce(p_limit, 25), 100)
  )
  update public.accounting_sync_queue q
  set status = 'claimed',
      attempts = q.attempts + 1,
      locked_at = now(),
      locked_by = coalesce(nullif(p_worker_id, ''), 'qbo-worker'),
      updated_at = now()
  from due
  where q.id = due.id
  returning q.*;
end;
$$;

revoke all on function public.claim_accounting_sync_queue(text, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_accounting_sync_queue(text, integer, text, integer)
  to service_role;
