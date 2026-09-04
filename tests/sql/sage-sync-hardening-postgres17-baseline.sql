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
  sage_document_kind text,
  estimate_number text,
  issue_date date,
  expiration_date date,
  subtotal numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  status text not null default 'draft',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  name text not null default 'Test client',
  email text,
  phone_number text,
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
  invoice_number text,
  issue_date date,
  due_date date,
  subtotal numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  balance_due numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0,
  paid_at timestamptz,
  status text not null default 'draft',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  invoice_id uuid,
  client_id uuid,
  amount numeric(14,2) not null default 1,
  payment_date date not null default current_date,
  payment_method text,
  reference_number text,
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
  name text not null default 'Test line',
  description text not null default 'Test line',
  quantity numeric(14,4) not null default 1,
  unit_price numeric(14,2) not null default 1,
  line_total numeric(14,2) not null default 1,
  sort_order integer not null default 0,
  type text not null default 'custom',
  is_taxable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(invoice_id, estimate_id) = 1)
);

-- Existing production invariant from the earlier QBO hardening migration:
-- every payment mutation recalculates both old/new invoice parents while the
-- derivative invoice update remains provider-origin suppressed.
create or replace function public.update_invoice_balance()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_invoice_id uuid;
  v_total_paid numeric(14,2);
  v_invoice_total numeric(14,2);
  v_invoice_status text;
  v_due_date date;
  v_paid_at timestamptz;
  v_previous_sync_source text;
begin
  for v_invoice_id in
    select distinct candidate.invoice_id
    from unnest(array[
      case when tg_op in ('UPDATE', 'DELETE') then old.invoice_id else null end,
      case when tg_op in ('INSERT', 'UPDATE') then new.invoice_id else null end
    ]) as candidate(invoice_id)
    where candidate.invoice_id is not null
    order by candidate.invoice_id
  loop
    select total, status, due_date, paid_at
    into v_invoice_total, v_invoice_status, v_due_date, v_paid_at
    from public.invoices where id = v_invoice_id for update;
    if not found then
      continue;
    end if;
    select coalesce(sum(amount), 0) into v_total_paid
    from public.payments
    where invoice_id = v_invoice_id and voided_at is null;
    v_previous_sync_source := current_setting('ops.sync_source', true);
    perform set_config('ops.sync_source', 'quickbooks', true);
    update public.invoices
    set amount_paid = v_total_paid,
        balance_due = greatest(v_invoice_total - v_total_paid, 0),
        status = case
          when v_invoice_status in ('void', 'written_off') then v_invoice_status
          when v_invoice_total > 0 and v_total_paid >= v_invoice_total then 'paid'
          when v_total_paid > 0 then 'partially_paid'
          when v_invoice_status in ('draft', 'sent') then v_invoice_status
          when v_due_date is not null and v_due_date < current_date then 'past_due'
          else 'awaiting_payment'
        end,
        paid_at = case
          when v_invoice_status in ('void', 'written_off') then v_paid_at
          when v_invoice_total > 0 and v_total_paid >= v_invoice_total
            then coalesce(v_paid_at, now())
          else null
        end,
        updated_at = now()
    where id = v_invoice_id;
    perform set_config(
      'ops.sync_source', coalesce(v_previous_sync_source, ''), true
    );
  end loop;
  return coalesce(new, old);
end;
$$;

create trigger trg_payment_balance
after insert or delete or update of invoice_id, amount, voided_at
on public.payments
for each row execute function public.update_invoice_balance();

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

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  name text not null default 'Materials'
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  display_name text not null default 'Test supplier',
  normalized_name text not null default 'test supplier',
  email text,
  phone text,
  tax_number text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.supplier_bills (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  supplier_id uuid not null,
  invoice_number text not null default 'BILL-1',
  normalized_invoice_number text not null default 'BILL-1',
  invoice_date date not null default current_date,
  due_date date,
  category_id uuid,
  currency text not null default 'CAD',
  subtotal numeric(14,2) not null default 1,
  tax_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 1,
  balance numeric(14,2) not null default 1,
  status text not null default 'open',
  voided_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.supplier_bill_line_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  bill_id uuid not null,
  category_id uuid not null,
  position integer not null,
  description text not null,
  quantity numeric(14,4) not null,
  unit_price numeric(14,2) not null,
  subtotal numeric(14,2) not null,
  tax_amount numeric(14,2) not null,
  tax_rate numeric(9,4) not null,
  total numeric(14,2) not null,
  created_at timestamptz not null default now(),
  unique (bill_id, position)
);

create table public.supplier_bill_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  bill_id uuid not null,
  payment_date date not null default current_date,
  amount numeric(14,2) not null default 1,
  payment_method text not null default 'eft',
  reference text,
  voided_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.supplier_bill_provider_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  connection_id uuid not null references public.accounting_connections(id) on delete cascade,
  provider text not null check (provider in ('quickbooks', 'sage')),
  entity_type text not null,
  entity_id uuid not null,
  external_id text not null,
  sync_token text,
  provider_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, entity_type, entity_id),
  unique (connection_id, entity_type, external_id)
);

create table public.supplier_bill_tax_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  connection_id uuid not null references public.accounting_connections(id),
  provider text not null,
  tax_rate numeric(9,4) not null,
  external_tax_code_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, tax_rate)
);

create table public.supplier_bill_payment_account_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  connection_id uuid not null references public.accounting_connections(id),
  provider text not null,
  payment_method text not null,
  external_account_id text not null,
  external_payment_method_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, payment_method)
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
