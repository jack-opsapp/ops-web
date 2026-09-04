-- Supplier bills / accounts payable prerequisite.
--
-- This migration is additive to the shipped expenses and accounting sync
-- systems. Every mutation stays behind service-role-only prepare/commit RPCs;
-- authenticated clients receive company-scoped read access only.

begin;

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  display_name text not null check (btrim(display_name) <> '' and length(display_name) <= 200),
  normalized_name text not null check (btrim(normalized_name) <> '' and length(normalized_name) <= 200),
  email text,
  phone text,
  tax_number text,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique (company_id, normalized_name),
  unique (id, company_id)
);

create table if not exists public.supplier_bills (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid not null,
  invoice_number text not null check (btrim(invoice_number) <> '' and length(invoice_number) <= 100),
  normalized_invoice_number text not null check (btrim(normalized_invoice_number) <> '' and length(normalized_invoice_number) <= 100),
  invoice_date date not null,
  due_date date,
  category_id uuid not null references public.expense_categories(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  tax_total numeric(14,2) not null check (tax_total >= 0),
  total numeric(14,2) not null check (total > 0 and total = subtotal + tax_total),
  balance numeric(14,2) not null check (balance >= 0 and balance <= total),
  status text not null check (status in ('open', 'partial', 'paid', 'void')),
  notes text check (notes is null or length(notes) <= 2000),
  created_by uuid not null references public.users(id),
  confirmed_by uuid not null references public.users(id),
  confirmed_at timestamptz not null,
  voided_by uuid references public.users(id),
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  check (due_date is null or due_date >= invoice_date),
  unique (id, company_id),
  foreign key (supplier_id, company_id)
    references public.suppliers(id, company_id),
  check (
    (status = 'open' and balance = total and voided_at is null) or
    (status = 'partial' and balance > 0 and balance < total and voided_at is null) or
    (status = 'paid' and balance = 0 and voided_at is null) or
    (status = 'void' and balance = 0 and voided_at is not null and voided_by is not null)
  )
);

create unique index if not exists supplier_bills_company_supplier_invoice_uniq
  on public.supplier_bills (company_id, supplier_id, normalized_invoice_number)
  where deleted_at is null;

create index if not exists supplier_bills_company_status_due_idx
  on public.supplier_bills (company_id, status, due_date, invoice_date desc)
  where deleted_at is null;

create table if not exists public.supplier_bill_line_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bill_id uuid not null,
  position integer not null check (position > 0),
  sku text check (sku is null or length(sku) <= 100),
  description text not null check (btrim(description) <> '' and length(description) <= 1000),
  quantity numeric(14,4) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  tax_amount numeric(14,2) not null check (tax_amount >= 0),
  total numeric(14,2) not null check (total > 0 and total = subtotal + tax_amount),
  tax_rate numeric(9,4) generated always as (
    case when subtotal = 0 then 0 else round((tax_amount / subtotal) * 100, 4) end
  ) stored,
  category_id uuid not null references public.expense_categories(id),
  created_at timestamptz not null default clock_timestamp(),
  unique (bill_id, position),
  unique (id, bill_id),
  unique (id, company_id),
  unique (id, bill_id, company_id),
  foreign key (bill_id, company_id)
    references public.supplier_bills(id, company_id) on delete cascade
);

create table if not exists public.supplier_bill_project_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bill_id uuid not null,
  line_item_id uuid not null,
  project_id uuid not null references public.projects(id),
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (line_item_id, project_id),
  foreign key (line_item_id, bill_id, company_id)
    references public.supplier_bill_line_items(id, bill_id, company_id) on delete cascade
);

create index if not exists supplier_bill_allocations_project_idx
  on public.supplier_bill_project_allocations (company_id, project_id, bill_id);

create table if not exists public.supplier_bill_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bill_id uuid not null,
  payment_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash', 'check', 'eft', 'credit_card', 'other')),
  reference text check (reference is null or length(reference) <= 255),
  recorded_by uuid not null references public.users(id),
  confirmed_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  voided_at timestamptz,
  voided_by uuid references public.users(id),
  unique (id, company_id),
  foreign key (bill_id, company_id)
    references public.supplier_bills(id, company_id)
);

create index if not exists supplier_bill_payments_bill_idx
  on public.supplier_bill_payments (bill_id, payment_date, created_at)
  where voided_at is null;

create table if not exists public.supplier_bill_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bill_id uuid,
  expense_id uuid references public.expenses(id) on delete cascade,
  storage_bucket text not null check (btrim(storage_bucket) <> ''),
  storage_key text not null check (btrim(storage_key) <> ''),
  public_url text not null check (public_url ~ '^https://'),
  original_filename text not null check (btrim(original_filename) <> '' and length(original_filename) <= 255),
  mime_type text not null check (mime_type = 'application/pdf'),
  size_bytes bigint not null check (size_bytes between 5 and 20971520),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default clock_timestamp(),
  check (num_nonnulls(bill_id, expense_id) = 1),
  foreign key (bill_id, company_id)
    references public.supplier_bills(id, company_id) on delete cascade,
  unique (bill_id),
  unique (expense_id)
);

create unique index if not exists supplier_bill_documents_company_sha256_uniq
  on public.supplier_bill_documents (company_id, sha256);

create table if not exists public.supplier_bill_provider_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null references public.accounting_connections(id) on delete cascade,
  provider text not null check (provider in ('quickbooks', 'sage')),
  entity_type text not null check (entity_type in ('supplier', 'supplier_bill', 'supplier_bill_payment')),
  entity_id uuid not null,
  external_id text not null check (btrim(external_id) <> ''),
  sync_token text,
  provider_updated_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (connection_id, entity_type, entity_id),
  unique (connection_id, entity_type, external_id)
);

create table if not exists public.supplier_bill_tax_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null references public.accounting_connections(id) on delete cascade,
  provider text not null check (provider in ('quickbooks', 'sage')),
  tax_rate numeric(9,4) not null check (tax_rate >= 0 and tax_rate <= 100),
  external_tax_code_id text not null check (btrim(external_tax_code_id) <> ''),
  external_tax_code_name text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (connection_id, tax_rate)
);

create table if not exists public.supplier_bill_payment_account_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null references public.accounting_connections(id) on delete cascade,
  provider text not null check (provider in ('quickbooks', 'sage')),
  payment_method text not null check (payment_method in ('cash', 'check', 'eft', 'credit_card', 'other')),
  external_account_id text not null check (btrim(external_account_id) <> ''),
  external_payment_method_id text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (connection_id, payment_method)
);

create table if not exists public.supplier_bill_project_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null references public.accounting_connections(id) on delete cascade,
  provider text not null check (provider in ('quickbooks', 'sage')),
  project_id uuid not null references public.projects(id) on delete cascade,
  external_project_id text not null check (btrim(external_project_id) <> ''),
  external_project_name text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (connection_id, project_id),
  unique (connection_id, external_project_id)
);

create table if not exists public.supplier_bill_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  subject_type text not null check (subject_type in ('supplier_bill', 'expense')),
  subject_id uuid not null,
  action text not null check (action in ('captured', 'paid_purchase_recorded', 'payment_recorded', 'voided')),
  actor_user_id uuid not null references public.users(id),
  intent_id uuid not null,
  command_hash text not null check (command_hash ~ '^[0-9a-f]{64}$'),
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (intent_id)
);

-- Cover every foreign-key column set used by joins and parent-row changes.
create index if not exists supplier_bill_documents_bill_company_idx on public.supplier_bill_documents (bill_id, company_id);
create index if not exists supplier_bill_documents_created_by_idx on public.supplier_bill_documents (created_by);
create index if not exists supplier_bill_events_actor_idx on public.supplier_bill_events (actor_user_id);
create index if not exists supplier_bill_events_company_idx on public.supplier_bill_events (company_id);
create index if not exists supplier_bill_lines_bill_company_idx on public.supplier_bill_line_items (bill_id, company_id);
create index if not exists supplier_bill_lines_category_idx on public.supplier_bill_line_items (category_id);
create index if not exists supplier_bill_lines_company_idx on public.supplier_bill_line_items (company_id);
create index if not exists supplier_bill_payment_accounts_company_idx on public.supplier_bill_payment_account_mappings (company_id);
create index if not exists supplier_bill_payments_bill_company_idx on public.supplier_bill_payments (bill_id, company_id);
create index if not exists supplier_bill_payments_company_idx on public.supplier_bill_payments (company_id);
create index if not exists supplier_bill_payments_recorded_by_idx on public.supplier_bill_payments (recorded_by);
create index if not exists supplier_bill_payments_voided_by_idx on public.supplier_bill_payments (voided_by);
create index if not exists supplier_bill_allocations_line_bill_company_idx on public.supplier_bill_project_allocations (line_item_id, bill_id, company_id);
create index if not exists supplier_bill_allocations_project_only_idx on public.supplier_bill_project_allocations (project_id);
create index if not exists supplier_bill_project_mappings_company_idx on public.supplier_bill_project_mappings (company_id);
create index if not exists supplier_bill_project_mappings_project_idx on public.supplier_bill_project_mappings (project_id);
create index if not exists supplier_bill_provider_links_company_idx on public.supplier_bill_provider_links (company_id);
create index if not exists supplier_bill_tax_mappings_company_idx on public.supplier_bill_tax_mappings (company_id);
create index if not exists supplier_bills_category_idx on public.supplier_bills (category_id);
create index if not exists supplier_bills_confirmed_by_idx on public.supplier_bills (confirmed_by);
create index if not exists supplier_bills_created_by_idx on public.supplier_bills (created_by);
create index if not exists supplier_bills_supplier_company_idx on public.supplier_bills (supplier_id, company_id);
create index if not exists supplier_bills_voided_by_idx on public.supplier_bills (voided_by);
create index if not exists suppliers_created_by_idx on public.suppliers (created_by);

create table if not exists private.supplier_bill_write_intents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  actor_user_id uuid not null,
  action text not null check (action in ('capture', 'record_payment', 'void')),
  route text check (route is null or route in ('supplier_bill', 'expense')),
  idempotency_key text not null check (btrim(idempotency_key) <> '' and length(idempotency_key) <= 200),
  command_hash text not null check (command_hash ~ '^[0-9a-f]{64}$'),
  document_sha256 text,
  command jsonb not null,
  confirmation_text text not null,
  status text not null default 'prepared' check (status in ('prepared', 'executing', 'committed', 'expired')),
  entity_kind text,
  entity_id uuid,
  prepared_at timestamptz not null default clock_timestamp(),
  confirmed_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null default (clock_timestamp() + interval '15 minutes'),
  receipt jsonb,
  unique (company_id, idempotency_key)
);

create unique index if not exists supplier_bill_write_intents_active_document_uniq
  on private.supplier_bill_write_intents (company_id, document_sha256)
  where document_sha256 is not null and status <> 'expired';

revoke all on table private.supplier_bill_write_intents from public, anon, authenticated;

-- Keep the existing queue values and add only the AP provider/entity values.
alter table public.accounting_sync_queue
  drop constraint if exists accounting_sync_queue_provider_check,
  drop constraint if exists accounting_sync_queue_entity_type_check,
  drop constraint if exists accounting_sync_queue_source_table_check;
alter table public.accounting_sync_queue
  add constraint accounting_sync_queue_provider_check
    check (provider in ('quickbooks', 'sage')),
  add constraint accounting_sync_queue_entity_type_check
    check (entity_type in ('customer', 'invoice', 'estimate', 'payment', 'supplier', 'supplier_bill', 'supplier_bill_payment')),
  add constraint accounting_sync_queue_source_table_check
    check (source_table in ('clients', 'sub_clients', 'invoices', 'estimates', 'payments', 'line_items', 'suppliers', 'supplier_bills', 'supplier_bill_payments'));

alter table public.accounting_sync_events
  drop constraint if exists accounting_sync_events_provider_check,
  drop constraint if exists accounting_sync_events_entity_type_check,
  drop constraint if exists accounting_sync_events_direction_check;
alter table public.accounting_sync_events
  add constraint accounting_sync_events_provider_check
    check (provider in ('quickbooks', 'sage')),
  add constraint accounting_sync_events_entity_type_check
    check (entity_type in ('customer', 'invoice', 'estimate', 'payment', 'supplier', 'supplier_bill', 'supplier_bill_payment')),
  add constraint accounting_sync_events_direction_check
    check (direction in ('ops_to_qb', 'qb_to_ops', 'ops_to_sage', 'sage_to_ops', 'reconcile', 'system'));

create or replace function private.supplier_bill_actor_company(p_actor_user_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_company_id uuid;
begin
  select u.company_id
    into v_company_id
    from public.users u
   where u.id = p_actor_user_id
     and u.is_active = true
     and u.deleted_at is null;

  if v_company_id is null
     or not public.has_permission(p_actor_user_id, 'expenses.approve', 'all')
     or not public.has_permission(p_actor_user_id, 'accounting.view', 'all') then
    raise exception 'Supplier bill accounting authority is required'
      using errcode = '42501';
  end if;
  return v_company_id;
end;
$function$;

revoke all on function private.supplier_bill_actor_company(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.can_read_supplier_bill_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_company_id = (select private.get_user_company_id())
     and public.has_permission(
       (select private.get_current_user_id()),
       'accounting.view',
       'all'
     );
$function$;

revoke all on function private.can_read_supplier_bill_company(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.can_read_supplier_bill_company(uuid)
  to anon, authenticated;

create or replace function private.supplier_bill_live_receipt(
  p_intent_id uuid,
  p_replayed boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_intent private.supplier_bill_write_intents%rowtype;
  v_result jsonb;
begin
  select * into v_intent
    from private.supplier_bill_write_intents
   where id = p_intent_id;
  if not found or v_intent.entity_id is null then return null; end if;

  if v_intent.entity_kind = 'expense' then
    select jsonb_build_object(
      'intentId', v_intent.id,
      'replayed', p_replayed,
      'entityKind', 'expense',
      'expense', to_jsonb(e),
      'document', to_jsonb(d),
      'event', to_jsonb(ev)
    ) into v_result
      from public.expenses e
      left join public.supplier_bill_documents d on d.expense_id = e.id
      left join public.supplier_bill_events ev on ev.intent_id = v_intent.id
     where e.id = v_intent.entity_id
       and e.company_id = v_intent.company_id
       and e.deleted_at is null;
    return v_result;
  end if;

  select jsonb_build_object(
    'intentId', v_intent.id,
    'replayed', p_replayed,
    'entityKind', v_intent.entity_kind,
    'bill', to_jsonb(b),
    'supplier', to_jsonb(s),
    'lines', coalesce((
      select jsonb_agg(
        to_jsonb(line) || jsonb_build_object(
          'allocations', coalesce((
            select jsonb_agg(to_jsonb(a) order by a.project_id)
              from public.supplier_bill_project_allocations a
             where a.line_item_id = line.id
          ), '[]'::jsonb)
        ) order by line.position
      ) from public.supplier_bill_line_items line where line.bill_id = b.id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(to_jsonb(pay) order by pay.payment_date, pay.created_at)
        from public.supplier_bill_payments pay
       where pay.bill_id = b.id and pay.voided_at is null
    ), '[]'::jsonb),
    'document', (select to_jsonb(d) from public.supplier_bill_documents d where d.bill_id = b.id),
    'event', (select to_jsonb(ev) from public.supplier_bill_events ev where ev.intent_id = v_intent.id)
  ) into v_result
    from public.supplier_bills b
    join public.suppliers s on s.id = b.supplier_id
   where b.id = v_intent.entity_id
     and b.company_id = v_intent.company_id
     and b.deleted_at is null;
  return v_result;
end;
$function$;

revoke all on function private.supplier_bill_live_receipt(uuid, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.prepare_supplier_bill_write(
  p_actor_user_id uuid,
  p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_company_id uuid;
  v_request_id uuid;
  v_command_company_id uuid;
  v_command_actor_id uuid;
  v_action text;
  v_route text;
  v_idempotency_key text;
  v_command_hash text;
  v_confirmation_text text;
  v_document_sha256 text;
  v_existing private.supplier_bill_write_intents%rowtype;
  v_intent private.supplier_bill_write_intents%rowtype;
  v_supplier_id uuid;
  v_bill public.supplier_bills%rowtype;
  v_subtotal numeric;
  v_tax_total numeric;
  v_total numeric;
  v_balance numeric;
  v_invoice_date date;
  v_due_date date;
  v_line_count integer;
  v_line_subtotal numeric;
  v_line_tax numeric;
  v_line_total numeric;
  v_line jsonb;
  v_allocation_total numeric;
begin
  if p_command is null or jsonb_typeof(p_command) <> 'object' then
    raise exception 'Supplier bill command must be an object' using errcode = '22023';
  end if;
  v_company_id := private.supplier_bill_actor_company(p_actor_user_id);
  begin
    v_command_company_id := nullif(p_command ->> 'companyId', '')::uuid;
    v_command_actor_id := nullif(p_command ->> 'actorUserId', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'Supplier bill actor or company identifier is invalid' using errcode = '22023';
  end;
  if v_command_company_id is distinct from v_company_id
     or v_command_actor_id is distinct from p_actor_user_id then
    raise exception 'Supplier bill actor or company does not match current authority'
      using errcode = '42501';
  end if;

  v_action := nullif(p_command ->> 'kind', '');
  if v_action is null then v_action := 'capture'; end if;
  if v_action not in ('capture', 'record_payment', 'void') then
    raise exception 'Supplier bill action is invalid' using errcode = '22023';
  end if;
  if v_action = 'capture' and exists (
    select 1 from jsonb_object_keys(p_command) key(name)
     where key.name not in (
       'kind', 'requestId', 'idempotencyKey', 'companyId', 'actorUserId',
       'route', 'status', 'supplier', 'invoiceNumber',
       'normalizedInvoiceNumber', 'invoiceDate', 'dueDate', 'currency',
       'categoryId', 'subtotal', 'taxTotal', 'total', 'balance', 'notes',
       'lineItems', 'sourceDocument', 'paidPurchase', 'projectIds',
       'confirmationText'
     )
  ) then
    raise exception 'Supplier bill capture contains unsupported fields' using errcode = '22023';
  elsif v_action = 'record_payment' and exists (
    select 1 from jsonb_object_keys(p_command) key(name)
     where key.name not in (
       'kind', 'idempotencyKey', 'companyId', 'actorUserId', 'billId', 'payment'
     )
  ) then
    raise exception 'Supplier bill payment contains unsupported fields' using errcode = '22023';
  elsif v_action = 'void' and exists (
    select 1 from jsonb_object_keys(p_command) key(name)
     where key.name not in (
       'kind', 'idempotencyKey', 'companyId', 'actorUserId', 'billId', 'reason'
     )
  ) then
    raise exception 'Supplier bill void contains unsupported fields' using errcode = '22023';
  end if;
  v_idempotency_key := nullif(btrim(p_command ->> 'idempotencyKey'), '');
  if v_idempotency_key is null or length(v_idempotency_key) > 200 then
    raise exception 'Supplier bill idempotency key is invalid' using errcode = '22023';
  end if;
  v_command_hash := encode(extensions.digest(p_command::text, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(
    hashtextextended('supplier_bill_write:' || v_company_id::text, 0)
  );
  update private.supplier_bill_write_intents
     set status = 'expired'
   where company_id = v_company_id
     and status = 'prepared'
     and expires_at <= clock_timestamp();

  select * into v_existing
    from private.supplier_bill_write_intents
   where company_id = v_company_id
     and idempotency_key = v_idempotency_key
   for update;
  if found then
    if v_existing.actor_user_id <> p_actor_user_id
       or v_existing.command_hash <> v_command_hash then
      raise exception 'Supplier bill idempotency key was reused with different content'
        using errcode = '22023';
    end if;
    if v_existing.status = 'committed' then
      return private.supplier_bill_live_receipt(v_existing.id, true);
    end if;
    if v_existing.status = 'expired' then
      update private.supplier_bill_write_intents
         set status = 'prepared',
             prepared_at = clock_timestamp(),
             expires_at = clock_timestamp() + interval '15 minutes'
       where id = v_existing.id
       returning * into v_existing;
    end if;
    return jsonb_build_object(
      'intentId', v_existing.id,
      'confirmationText', v_existing.confirmation_text,
      'expiresAt', v_existing.expires_at,
      'status', v_existing.status,
      'preview', v_existing.command
    );
  end if;

  if v_action = 'capture' then
    v_route := p_command ->> 'route';
    if v_route not in ('supplier_bill', 'expense') then
      raise exception 'Supplier bill capture route is invalid' using errcode = '22023';
    end if;
    begin
      v_request_id := (p_command ->> 'requestId')::uuid;
      v_subtotal := (p_command ->> 'subtotal')::numeric;
      v_tax_total := (p_command ->> 'taxTotal')::numeric;
      v_total := (p_command ->> 'total')::numeric;
      v_balance := (p_command ->> 'balance')::numeric;
      v_invoice_date := (p_command ->> 'invoiceDate')::date;
      v_due_date := nullif(p_command ->> 'dueDate', '')::date;
    exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format then
      raise exception 'Supplier bill amounts or dates are invalid' using errcode = '22023';
    end;
    if v_request_id is null then
      raise exception 'Supplier bill request identifier is invalid' using errcode = '22023';
    end if;
    if v_total <= 0 or v_subtotal < 0 or v_tax_total < 0
       or v_subtotal + v_tax_total <> v_total
       or v_balance not in (0, v_total) then
      raise exception 'Supplier bill totals are invalid' using errcode = '23514';
    end if;
    if v_due_date is not null and v_due_date < v_invoice_date then
      raise exception 'Supplier bill due date is invalid' using errcode = '23514';
    end if;
    if (v_balance = 0 and v_route <> 'expense')
       or (v_balance > 0 and v_route <> 'supplier_bill') then
      raise exception 'Supplier bill route does not match its balance' using errcode = '23514';
    end if;
    if v_route = 'expense' and jsonb_typeof(p_command -> 'paidPurchase') <> 'object' then
      raise exception 'Paid purchase details are required' using errcode = '23514';
    end if;
    if nullif(p_command ->> 'normalizedInvoiceNumber', '') is null
       or nullif(p_command #>> '{supplier,normalizedName}', '') is null
       or nullif(p_command ->> 'currency', '') !~ '^[A-Z]{3}$' then
      raise exception 'Supplier and invoice identity are invalid' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.expense_categories c
       where c.id = (p_command ->> 'categoryId')::uuid
         and c.company_id = v_company_id and c.is_active = true
    ) then
      raise exception 'Supplier bill expense category is unavailable' using errcode = '23503';
    end if;

    if jsonb_typeof(p_command -> 'lineItems') <> 'array'
       or jsonb_array_length(p_command -> 'lineItems') not between 1 and 500 then
      raise exception 'Supplier bill lines are invalid' using errcode = '22023';
    end if;
    select count(*), sum((line ->> 'subtotal')::numeric),
           sum((line ->> 'taxAmount')::numeric), sum((line ->> 'total')::numeric)
      into v_line_count, v_line_subtotal, v_line_tax, v_line_total
      from jsonb_array_elements(p_command -> 'lineItems') line;
    if v_line_count <> jsonb_array_length(p_command -> 'lineItems')
       or v_line_subtotal <> v_subtotal or v_line_tax <> v_tax_total
       or v_line_total <> v_total then
      raise exception 'Supplier bill lines do not equal bill totals' using errcode = '23514';
    end if;

    for v_line in select value from jsonb_array_elements(p_command -> 'lineItems') loop
      if (v_line ->> 'subtotal')::numeric + (v_line ->> 'taxAmount')::numeric
           <> (v_line ->> 'total')::numeric
         or jsonb_typeof(v_line -> 'allocations') <> 'array'
         or jsonb_array_length(v_line -> 'allocations') = 0 then
        raise exception 'Supplier bill line arithmetic or allocations are invalid'
          using errcode = '23514';
      end if;
      select sum((a ->> 'amount')::numeric) into v_allocation_total
        from jsonb_array_elements(v_line -> 'allocations') a;
      if v_allocation_total <> (v_line ->> 'total')::numeric then
        raise exception 'Supplier bill line allocations do not equal line total'
          using errcode = '23514';
      end if;
      if exists (
        select 1
          from jsonb_array_elements(v_line -> 'allocations') a
          left join public.projects p
            on p.id = (a ->> 'projectId')::uuid
           and p.company_id = v_company_id
           and p.deleted_at is null
         where p.id is null
      ) then
        raise exception 'Supplier bill allocation project is unavailable'
          using errcode = '23503';
      end if;
      if not exists (
        select 1 from public.expense_categories c
         where c.id = (v_line ->> 'categoryId')::uuid
           and c.company_id = v_company_id and c.is_active = true
      ) then
        raise exception 'Supplier bill line category is unavailable'
          using errcode = '23503';
      end if;
    end loop;

    v_document_sha256 := lower(p_command #>> '{sourceDocument,sha256}');
    if v_document_sha256 is null
       or v_document_sha256 !~ '^[0-9a-f]{64}$'
       or p_command #>> '{sourceDocument,mimeType}' <> 'application/pdf'
       or (p_command #>> '{sourceDocument,sizeBytes}')::bigint not between 5 and 20971520
       or not (v_company_id::text = any(
         string_to_array(p_command #>> '{sourceDocument,objectKey}', '/')
       ))
       or nullif(p_command #>> '{sourceDocument,bucket}', '') is null
       or nullif(p_command #>> '{sourceDocument,objectKey}', '') is null
       or nullif(p_command #>> '{sourceDocument,originalFilename}', '') is null
       or nullif(p_command #>> '{sourceDocument,publicUrl}', '') is null
       or (p_command #>> '{sourceDocument,publicUrl}') !~ '^https://' then
      raise exception 'Supplier bill document custody is invalid' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.supplier_bill_documents d
       where d.company_id = v_company_id and d.sha256 = v_document_sha256
    ) then
      raise exception 'This source document was already recorded' using errcode = '23505';
    end if;

    select s.id into v_supplier_id from public.suppliers s
     where s.company_id = v_company_id
       and s.normalized_name = p_command #>> '{supplier,normalizedName}';
    if v_supplier_id is not null and v_route = 'supplier_bill' and exists (
      select 1 from public.supplier_bills b
       where b.company_id = v_company_id
         and b.supplier_id = v_supplier_id
         and b.normalized_invoice_number = p_command ->> 'normalizedInvoiceNumber'
         and b.deleted_at is null
    ) then
      raise exception 'This supplier invoice was already recorded' using errcode = '23505';
    end if;
    v_confirmation_text := case when v_route = 'expense'
      then 'RECORD PAID PURCHASE ' else 'RECORD BILL ' end
      || (p_command ->> 'normalizedInvoiceNumber') || ' FOR '
      || (p_command ->> 'currency') || ' '
      || to_char(v_total, 'FM999,999,999,990.00');
  elsif v_action = 'record_payment' then
    begin
      v_invoice_date := (p_command #>> '{payment,paymentDate}')::date;
      v_total := (p_command #>> '{payment,amount}')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format then
      raise exception 'Supplier bill payment amount or date is invalid' using errcode = '22023';
    end;
    select * into v_bill from public.supplier_bills b
     where b.id = (p_command ->> 'billId')::uuid
       and b.company_id = v_company_id and b.deleted_at is null
     for update;
    if not found or v_bill.status in ('paid', 'void') then
      raise exception 'Supplier bill is unavailable for payment' using errcode = '23503';
    end if;
    if v_invoice_date is null or v_total <= 0 or v_total > v_bill.balance then
      raise exception 'Payment cannot exceed the open balance' using errcode = '23514';
    end if;
    if p_command #>> '{payment,paymentMethod}' not in ('cash', 'check', 'eft', 'credit_card', 'other') then
      raise exception 'Supplier bill payment method is invalid' using errcode = '22023';
    end if;
    if length(coalesce(p_command #>> '{payment,reference}', '')) > 255 then
      raise exception 'Supplier bill payment reference is invalid' using errcode = '22023';
    end if;
    v_confirmation_text := 'RECORD PAYMENT ' || v_bill.currency || ' '
      || to_char((p_command #>> '{payment,amount}')::numeric, 'FM999,999,999,990.00')
      || ' AGAINST ' || v_bill.normalized_invoice_number;
  else
    if nullif(btrim(p_command ->> 'reason'), '') is null
       or length(p_command ->> 'reason') > 1000 then
      raise exception 'Supplier bill void reason is required' using errcode = '22023';
    end if;
    select * into v_bill from public.supplier_bills b
     where b.id = (p_command ->> 'billId')::uuid
       and b.company_id = v_company_id and b.deleted_at is null
     for update;
    if not found or v_bill.status = 'void' then
      raise exception 'Supplier bill is unavailable for void' using errcode = '23503';
    end if;
    if exists (
      select 1 from public.supplier_bill_payments p
       where p.bill_id = v_bill.id and p.voided_at is null
    ) then
      raise exception 'A settled supplier bill cannot be voided' using errcode = '23514';
    end if;
    v_confirmation_text := 'VOID BILL ' || v_bill.normalized_invoice_number;
  end if;

  insert into private.supplier_bill_write_intents (
    company_id, actor_user_id, action, route, idempotency_key,
    command_hash, document_sha256, command, confirmation_text
  ) values (
    v_company_id, p_actor_user_id, v_action, v_route, v_idempotency_key,
    v_command_hash, v_document_sha256, p_command, v_confirmation_text
  ) returning * into v_intent;

  return jsonb_build_object(
    'intentId', v_intent.id,
    'confirmationText', v_intent.confirmation_text,
    'expiresAt', v_intent.expires_at,
    'status', v_intent.status,
    'preview', v_intent.command
  );
end;
$function$;

revoke all on function public.prepare_supplier_bill_write(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.prepare_supplier_bill_write(uuid, jsonb)
  to service_role;

create or replace function private.enqueue_supplier_bill_accounting(
  p_company_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_operation text,
  p_source_table text,
  p_source_action text,
  p_updated_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_connection record;
begin
  for v_connection in
    select c.id, c.provider
      from public.accounting_connections c
     where c.company_id = p_company_id::text
       and c.provider in ('quickbooks', 'sage')
       and c.is_connected = true
       and c.sync_enabled = true
       and c.sync_direction in ('push_only', 'bidirectional')
     order by c.created_at, c.id
  loop
    insert into public.accounting_sync_queue (
      company_id, connection_id, provider, entity_type, entity_id,
      operation, source_table, source_action, source_updated_at,
      idempotency_key, payload_snapshot
    ) values (
      p_company_id, v_connection.id, v_connection.provider, p_entity_type,
      p_entity_id, p_operation, p_source_table, p_source_action, p_updated_at,
      'supplier-ap:' || p_entity_type || ':' || p_entity_id::text || ':'
        || extract(epoch from p_updated_at)::bigint::text || ':' || p_operation,
      jsonb_build_object('schemaVersion', 1)
    );
  end loop;
end;
$function$;

revoke all on function private.enqueue_supplier_bill_accounting(uuid, text, uuid, text, text, text, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.commit_supplier_bill_write(
  p_actor_user_id uuid,
  p_intent_id uuid,
  p_confirmation_text text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_company_id uuid;
  v_intent private.supplier_bill_write_intents%rowtype;
  v_command jsonb;
  v_supplier public.suppliers%rowtype;
  v_bill public.supplier_bills%rowtype;
  v_line jsonb;
  v_line_id uuid;
  v_allocation jsonb;
  v_payment_id uuid;
  v_new_balance numeric;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb;
  v_now timestamptz := clock_timestamp();
begin
  v_company_id := private.supplier_bill_actor_company(p_actor_user_id);
  select * into v_intent
    from private.supplier_bill_write_intents
   where id = p_intent_id
     and company_id = v_company_id
     and actor_user_id = p_actor_user_id
   for update;
  if not found then
    raise exception 'Supplier bill write intent is unavailable' using errcode = '23503';
  end if;
  if v_intent.status = 'committed' then
    return private.supplier_bill_live_receipt(v_intent.id, true);
  end if;
  if v_intent.expires_at <= v_now then
    update private.supplier_bill_write_intents set status = 'expired' where id = v_intent.id;
    raise exception 'Supplier bill confirmation expired' using errcode = '57014';
  end if;
  if p_confirmation_text is distinct from v_intent.confirmation_text then
    raise exception 'Supplier bill confirmation must match exactly' using errcode = '22023';
  end if;
  if encode(extensions.digest(v_intent.command::text, 'sha256'), 'hex') <> v_intent.command_hash then
    raise exception 'Supplier bill command integrity check failed' using errcode = '22023';
  end if;
  v_command := v_intent.command;

  if v_intent.action = 'capture' and v_intent.route = 'expense' then
    update private.supplier_bill_write_intents
       set status = 'executing', confirmed_at = coalesce(confirmed_at, v_now)
     where id = v_intent.id;
    return jsonb_build_object(
      'intentId', v_intent.id,
      'status', 'executing',
      'requiresExpenseCommit', true,
      'command', v_command
    );
  end if;

  if v_intent.action = 'capture' then
    insert into public.suppliers (
      company_id, display_name, normalized_name, email, phone, tax_number, created_by
    ) values (
      v_company_id,
      v_command #>> '{supplier,displayName}',
      v_command #>> '{supplier,normalizedName}',
      nullif(v_command #>> '{supplier,email}', ''),
      nullif(v_command #>> '{supplier,phone}', ''),
      nullif(v_command #>> '{supplier,taxNumber}', ''),
      p_actor_user_id
    ) on conflict (company_id, normalized_name) do update
      set display_name = excluded.display_name,
          email = coalesce(excluded.email, public.suppliers.email),
          phone = coalesce(excluded.phone, public.suppliers.phone),
          tax_number = coalesce(excluded.tax_number, public.suppliers.tax_number),
          deleted_at = null,
          updated_at = v_now
    returning * into v_supplier;

    insert into public.supplier_bills (
      company_id, supplier_id, invoice_number, normalized_invoice_number,
      invoice_date, due_date, category_id, currency, subtotal, tax_total,
      total, balance, status, notes, created_by, confirmed_by, confirmed_at
    ) values (
      v_company_id, v_supplier.id, v_command ->> 'invoiceNumber',
      v_command ->> 'normalizedInvoiceNumber', (v_command ->> 'invoiceDate')::date,
      nullif(v_command ->> 'dueDate', '')::date, (v_command ->> 'categoryId')::uuid,
      v_command ->> 'currency', (v_command ->> 'subtotal')::numeric,
      (v_command ->> 'taxTotal')::numeric, (v_command ->> 'total')::numeric,
      (v_command ->> 'total')::numeric, 'open', nullif(v_command ->> 'notes', ''),
      p_actor_user_id, p_actor_user_id, v_now
    ) returning * into v_bill;

    for v_line in
      select value from jsonb_array_elements(v_command -> 'lineItems')
      order by (value ->> 'position')::integer
    loop
      insert into public.supplier_bill_line_items (
        company_id, bill_id, position, sku, description, quantity, unit_price,
        subtotal, tax_amount, total, category_id
      ) values (
        v_company_id, v_bill.id, (v_line ->> 'position')::integer,
        nullif(v_line ->> 'sku', ''), v_line ->> 'description',
        (v_line ->> 'quantity')::numeric, (v_line ->> 'unitPrice')::numeric,
        (v_line ->> 'subtotal')::numeric, (v_line ->> 'taxAmount')::numeric,
        (v_line ->> 'total')::numeric, (v_line ->> 'categoryId')::uuid
      ) returning id into v_line_id;

      for v_allocation in
        select value from jsonb_array_elements(v_line -> 'allocations')
      loop
        insert into public.supplier_bill_project_allocations (
          company_id, bill_id, line_item_id, project_id, amount
        ) values (
          v_company_id, v_bill.id, v_line_id,
          (v_allocation ->> 'projectId')::uuid,
          (v_allocation ->> 'amount')::numeric
        );
      end loop;
    end loop;

    insert into public.supplier_bill_documents (
      company_id, bill_id, storage_bucket, storage_key, public_url,
      original_filename, mime_type, size_bytes, sha256, created_by
    ) values (
      v_company_id, v_bill.id,
      v_command #>> '{sourceDocument,bucket}',
      v_command #>> '{sourceDocument,objectKey}',
      v_command #>> '{sourceDocument,publicUrl}',
      v_command #>> '{sourceDocument,originalFilename}',
      v_command #>> '{sourceDocument,mimeType}',
      (v_command #>> '{sourceDocument,sizeBytes}')::bigint,
      v_command #>> '{sourceDocument,sha256}',
      p_actor_user_id
    );

    v_after := to_jsonb(v_bill);
    insert into public.supplier_bill_events (
      company_id, subject_type, subject_id, action, actor_user_id, intent_id,
      command_hash, before_snapshot, after_snapshot
    ) values (
      v_company_id, 'supplier_bill', v_bill.id, 'captured', p_actor_user_id,
      v_intent.id, v_intent.command_hash, '{}'::jsonb, v_after
    );
    perform private.enqueue_supplier_bill_accounting(
      v_company_id, 'supplier', v_supplier.id, 'create', 'suppliers', 'insert', v_now
    );
    perform private.enqueue_supplier_bill_accounting(
      v_company_id, 'supplier_bill', v_bill.id, 'create', 'supplier_bills', 'insert', v_now
    );
    insert into public.notifications (
      user_id, company_id, type, title, body, is_read, persistent,
      action_url, action_label, dedupe_key
    ) values (
      p_actor_user_id::text, v_company_id::text, 'standard', 'Bill recorded',
      v_bill.normalized_invoice_number || ' · ' || v_bill.currency || ' ' ||
        to_char(v_bill.total, 'FM999,999,999,990.00'),
      false, false, '/books', 'OPEN BOOKS',
      'supplier-bill:' || v_intent.id::text
    ) on conflict do nothing;

    update private.supplier_bill_write_intents
       set status = 'committed', entity_kind = 'supplier_bill', entity_id = v_bill.id,
           confirmed_at = v_now, completed_at = v_now,
           receipt = jsonb_build_object('billId', v_bill.id)
     where id = v_intent.id;
  elsif v_intent.action = 'record_payment' then
    select * into v_bill from public.supplier_bills b
     where b.id = (v_command ->> 'billId')::uuid
       and b.company_id = v_company_id and b.deleted_at is null
     for update;
    if not found or v_bill.status in ('paid', 'void') then
      raise exception 'Supplier bill is unavailable for payment' using errcode = '23503';
    end if;
    v_before := to_jsonb(v_bill);
    v_new_balance := v_bill.balance - (v_command #>> '{payment,amount}')::numeric;
    if v_new_balance < 0 then
      raise exception 'Payment cannot exceed the open balance' using errcode = '23514';
    end if;
    insert into public.supplier_bill_payments (
      company_id, bill_id, payment_date, amount, payment_method, reference,
      recorded_by, confirmed_at
    ) values (
      v_company_id, v_bill.id, (v_command #>> '{payment,paymentDate}')::date,
      (v_command #>> '{payment,amount}')::numeric,
      v_command #>> '{payment,paymentMethod}',
      nullif(v_command #>> '{payment,reference}', ''), p_actor_user_id, v_now
    ) returning id into v_payment_id;
    update public.supplier_bills
       set balance = v_new_balance,
           status = case
             when v_new_balance = 0 then 'paid'
             when v_new_balance < v_bill.total then 'partial'
             else 'open'
           end,
           updated_at = v_now
     where id = v_bill.id
     returning * into v_bill;
    v_after := to_jsonb(v_bill);
    insert into public.supplier_bill_events (
      company_id, subject_type, subject_id, action, actor_user_id, intent_id,
      command_hash, before_snapshot, after_snapshot
    ) values (
      v_company_id, 'supplier_bill', v_bill.id, 'payment_recorded', p_actor_user_id,
      v_intent.id, v_intent.command_hash, v_before,
      v_after || jsonb_build_object('paymentId', v_payment_id)
    );
    perform private.enqueue_supplier_bill_accounting(
      v_company_id, 'supplier_bill_payment', v_payment_id, 'create',
      'supplier_bill_payments', 'insert', v_now
    );
    insert into public.notifications (
      user_id, company_id, type, title, body, is_read, persistent,
      action_url, action_label, dedupe_key
    ) values (
      p_actor_user_id::text, v_company_id::text, 'standard', 'Bill payment recorded',
      v_bill.normalized_invoice_number || ' · ' || v_bill.currency || ' ' ||
        to_char((v_command #>> '{payment,amount}')::numeric, 'FM999,999,999,990.00'),
      false, false, '/books', 'OPEN BOOKS',
      'supplier-bill-payment:' || v_intent.id::text
    ) on conflict do nothing;
    update private.supplier_bill_write_intents
       set status = 'committed', entity_kind = 'supplier_bill', entity_id = v_bill.id,
           confirmed_at = v_now, completed_at = v_now,
           receipt = jsonb_build_object('billId', v_bill.id, 'paymentId', v_payment_id)
     where id = v_intent.id;
  else
    select * into v_bill from public.supplier_bills b
     where b.id = (v_command ->> 'billId')::uuid
       and b.company_id = v_company_id and b.deleted_at is null
     for update;
    if not found or v_bill.status = 'void' then
      raise exception 'Supplier bill is unavailable for void' using errcode = '23503';
    end if;
    if exists (
      select 1 from public.supplier_bill_payments p
       where p.bill_id = v_bill.id and p.voided_at is null
    ) then
      raise exception 'A settled supplier bill cannot be voided' using errcode = '23514';
    end if;
    v_before := to_jsonb(v_bill);
    update public.supplier_bills
       set status = 'void', balance = 0, voided_by = p_actor_user_id,
           voided_at = v_now, void_reason = nullif(v_command ->> 'reason', ''),
           updated_at = v_now
     where id = v_bill.id returning * into v_bill;
    v_after := to_jsonb(v_bill);
    insert into public.supplier_bill_events (
      company_id, subject_type, subject_id, action, actor_user_id, intent_id,
      command_hash, before_snapshot, after_snapshot
    ) values (
      v_company_id, 'supplier_bill', v_bill.id, 'voided', p_actor_user_id,
      v_intent.id, v_intent.command_hash, v_before, v_after
    );
    perform private.enqueue_supplier_bill_accounting(
      v_company_id, 'supplier_bill', v_bill.id, 'void', 'supplier_bills', 'void', v_now
    );
    insert into public.notifications (
      user_id, company_id, type, title, body, is_read, persistent,
      action_url, action_label, dedupe_key
    ) values (
      p_actor_user_id::text, v_company_id::text, 'standard', 'Bill voided',
      v_bill.normalized_invoice_number || ' is no longer payable.',
      false, false, '/books', 'OPEN BOOKS',
      'supplier-bill-void:' || v_intent.id::text
    ) on conflict do nothing;
    update private.supplier_bill_write_intents
       set status = 'committed', entity_kind = 'supplier_bill', entity_id = v_bill.id,
           confirmed_at = v_now, completed_at = v_now,
           receipt = jsonb_build_object('billId', v_bill.id)
     where id = v_intent.id;
  end if;

  return private.supplier_bill_live_receipt(v_intent.id, false);
end;
$function$;

revoke all on function public.commit_supplier_bill_write(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_supplier_bill_write(uuid, uuid, text)
  to service_role;

create or replace function public.finalize_paid_supplier_purchase(
  p_actor_user_id uuid,
  p_intent_id uuid,
  p_expense_receipt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_company_id uuid;
  v_intent private.supplier_bill_write_intents%rowtype;
  v_expense public.expenses%rowtype;
  v_expense_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  v_company_id := private.supplier_bill_actor_company(p_actor_user_id);
  select * into v_intent from private.supplier_bill_write_intents
   where id = p_intent_id and company_id = v_company_id
     and actor_user_id = p_actor_user_id
   for update;
  if not found then
    raise exception 'Paid purchase intent is unavailable' using errcode = '23503';
  end if;
  if v_intent.status = 'committed' then
    return private.supplier_bill_live_receipt(v_intent.id, true);
  end if;
  if v_intent.action <> 'capture' or v_intent.route <> 'expense'
     or v_intent.status <> 'executing' then
    raise exception 'Paid purchase intent is not ready to finalize' using errcode = '55000';
  end if;
  begin
    v_expense_id := (v_intent.command #>> '{paidPurchase,expenseId}')::uuid;
  exception when invalid_text_representation then
    raise exception 'Paid purchase expense identifier is invalid' using errcode = '22023';
  end;
  if nullif(p_expense_receipt ->> 'id', '')::uuid is distinct from v_expense_id then
    raise exception 'Paid purchase receipt does not match the prepared expense'
      using errcode = '22023';
  end if;
  select * into v_expense from public.expenses e
   where e.id = v_expense_id and e.company_id = v_company_id
     and e.submitted_by = p_actor_user_id and e.deleted_at is null
   for update;
  if not found
     or v_expense.amount <> (v_intent.command ->> 'total')::numeric
     or v_expense.tax_amount is distinct from (v_intent.command ->> 'taxTotal')::numeric
     or v_expense.currency <> v_intent.command ->> 'currency'
     or v_expense.expense_date <> (v_intent.command #>> '{paidPurchase,paidDate}')::date then
    raise exception 'Paid purchase live expense does not match the prepared command'
      using errcode = '23514';
  end if;

  insert into public.supplier_bill_documents (
    company_id, expense_id, storage_bucket, storage_key, public_url,
    original_filename, mime_type, size_bytes, sha256, created_by
  ) values (
    v_company_id, v_expense.id,
    v_intent.command #>> '{sourceDocument,bucket}',
    v_intent.command #>> '{sourceDocument,objectKey}',
    v_intent.command #>> '{sourceDocument,publicUrl}',
    v_intent.command #>> '{sourceDocument,originalFilename}',
    v_intent.command #>> '{sourceDocument,mimeType}',
    (v_intent.command #>> '{sourceDocument,sizeBytes}')::bigint,
    v_intent.command #>> '{sourceDocument,sha256}',
    p_actor_user_id
  );
  insert into public.supplier_bill_events (
    company_id, subject_type, subject_id, action, actor_user_id, intent_id,
    command_hash, before_snapshot, after_snapshot
  ) values (
    v_company_id, 'expense', v_expense.id, 'paid_purchase_recorded', p_actor_user_id,
    v_intent.id, v_intent.command_hash, '{}'::jsonb, to_jsonb(v_expense)
  );
  insert into public.notifications (
    user_id, company_id, type, title, body, is_read, persistent,
    action_url, action_label, dedupe_key, expense_id
  ) values (
    p_actor_user_id::text, v_company_id::text, 'standard', 'Paid purchase recorded',
    (v_intent.command ->> 'normalizedInvoiceNumber') || ' · ' ||
      (v_intent.command ->> 'currency') || ' ' ||
      to_char((v_intent.command ->> 'total')::numeric, 'FM999,999,999,990.00'),
    false, false, '/books', 'OPEN BOOKS',
    'supplier-paid-purchase:' || v_intent.id::text, v_expense.id
  ) on conflict do nothing;
  update private.supplier_bill_write_intents
     set status = 'committed', entity_kind = 'expense', entity_id = v_expense.id,
         completed_at = v_now,
         receipt = jsonb_build_object('expenseId', v_expense.id)
   where id = v_intent.id;
  return private.supplier_bill_live_receipt(v_intent.id, false);
end;
$function$;

revoke all on function public.finalize_paid_supplier_purchase(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_paid_supplier_purchase(uuid, uuid, jsonb)
  to service_role;

create or replace function public.finalize_supplier_bill_provider_sync(
  p_queue_id uuid,
  p_worker_id text,
  p_external_id text,
  p_sync_token text,
  p_provider_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_queue public.accounting_sync_queue%rowtype;
begin
  select * into v_queue from public.accounting_sync_queue q
   where q.id = p_queue_id and q.status = 'claimed' and q.locked_by = p_worker_id
   for update;
  if not found
     or v_queue.entity_type not in ('supplier', 'supplier_bill', 'supplier_bill_payment')
     or nullif(btrim(p_external_id), '') is null then
    raise exception 'Supplier bill provider finalization lost queue ownership'
      using errcode = '55000';
  end if;

  insert into public.supplier_bill_provider_links (
    company_id, connection_id, provider, entity_type, entity_id,
    external_id, sync_token, provider_updated_at
  ) values (
    v_queue.company_id, v_queue.connection_id, v_queue.provider,
    v_queue.entity_type, v_queue.entity_id, p_external_id,
    p_sync_token, p_provider_updated_at
  ) on conflict (connection_id, entity_type, entity_id) do update
    set external_id = excluded.external_id,
        sync_token = excluded.sync_token,
        provider_updated_at = excluded.provider_updated_at,
        updated_at = clock_timestamp();

  update public.accounting_sync_queue
     set status = 'succeeded', external_id = p_external_id,
         locked_at = null, locked_by = null, last_error = null,
         updated_at = clock_timestamp()
   where id = v_queue.id;

  return jsonb_build_object(
    'queueId', v_queue.id,
    'entityType', v_queue.entity_type,
    'entityId', v_queue.entity_id,
    'externalId', p_external_id,
    'status', 'succeeded'
  );
end;
$function$;

revoke all on function public.finalize_supplier_bill_provider_sync(uuid, text, text, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_supplier_bill_provider_sync(uuid, text, text, text, timestamptz)
  to service_role;

-- Read-only Data API surface. Writes remain service-role only.
do $policies$
declare
  v_table text;
begin
  foreach v_table in array array[
    'suppliers', 'supplier_bills', 'supplier_bill_line_items',
    'supplier_bill_project_allocations', 'supplier_bill_payments',
    'supplier_bill_documents', 'supplier_bill_provider_links',
    'supplier_bill_tax_mappings', 'supplier_bill_payment_account_mappings',
    'supplier_bill_project_mappings',
    'supplier_bill_events'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format('grant select on table public.%I to anon, authenticated', v_table);
    execute format('revoke all on table public.%I from service_role', v_table);
    if v_table in ('supplier_bill_documents', 'supplier_bill_events') then
      execute format('grant select, insert on table public.%I to service_role', v_table);
    else
      execute format('grant select, insert, update, delete on table public.%I to service_role', v_table);
    end if;
    execute format('drop policy if exists supplier_bill_company_read on public.%I', v_table);
    execute format(
      'create policy supplier_bill_company_read on public.%I for select to public using (private.can_read_supplier_bill_company(company_id))',
      v_table
    );
    execute format('drop policy if exists supplier_bill_service_role_all on public.%I', v_table);
    execute format(
      'create policy supplier_bill_service_role_all on public.%I for all to service_role using (true) with check (true)',
      v_table
    );
  end loop;
end;
$policies$;

-- Literal grants intentionally repeat the core bill table so static contract
-- checks and operator review can verify the privilege boundary directly.
grant select on public.supplier_bills to anon, authenticated;
grant select, insert, update, delete on public.supplier_bills to service_role;

comment on table public.supplier_bills is
  'Canonical OPS accounts-payable obligations. All writes require a current authorized actor and exact confirmation through the supplier bill write RPCs.';
comment on table public.supplier_bill_documents is
  'Immutable custody metadata for the original supplier PDF, linked to either an unpaid AP bill or the existing paid expense path.';
comment on function public.prepare_supplier_bill_write(uuid, jsonb) is
  'Server-only prerequisite contract. Validates current authority, tenant, totals, allocations, custody, duplicates, and returns exact confirmation text.';
comment on function public.commit_supplier_bill_write(uuid, uuid, text) is
  'Server-only consequential write. Rechecks authority and exact confirmation, commits atomically, enqueues provider sync, and returns a fresh live receipt.';

commit;
