-- Canpro-ready supplier bill intake, reconciliation, approval, and payment.
--
-- FILES ONLY — DO NOT APPLY without Jackson's explicit release approval.
-- Captured documents remain durable even when duplicated, held, or routed to
-- payroll. Canonical AP rows and provider queue work begin only at approval.

begin;

-- Separate authority for the four operational lanes: accounting.view already
-- owns the read lane; these three keys own capture, approval, and payment.
insert into public.role_permissions (role_id, permission, scope)
values
  ('00000000-0000-0000-0000-000000000001', 'accounting.bills.capture', 'all'),
  ('00000000-0000-0000-0000-000000000001', 'accounting.bills.approve', 'all'),
  ('00000000-0000-0000-0000-000000000001', 'accounting.bills.pay', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'accounting.bills.capture', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'accounting.bills.approve', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'accounting.bills.pay', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'accounting.bills.capture', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'accounting.bills.pay', 'all')
on conflict (role_id, permission) do nothing;

insert into private.lead_permission_editor_registry (permission, scopes)
values
  ('accounting.bills.capture', array['all']),
  ('accounting.bills.approve', array['all']),
  ('accounting.bills.pay', array['all'])
on conflict (permission) do update set scopes = excluded.scopes;

create table if not exists public.supplier_bill_intakes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  captured_by uuid not null references public.users(id),
  document_kind text not null check (document_kind in ('material', 'subcontractor', 'employee')),
  review_stage text not null default 'review'
    check (review_stage in ('review', 'to_pay', 'paid', 'held', 'payroll')),
  supplier_name text not null check (btrim(supplier_name) <> '' and length(supplier_name) <= 200),
  normalized_supplier_name text not null
    check (btrim(normalized_supplier_name) <> '' and length(normalized_supplier_name) <= 200),
  invoice_number text not null check (btrim(invoice_number) <> '' and length(invoice_number) <= 100),
  normalized_invoice_number text not null
    check (btrim(normalized_invoice_number) <> '' and length(normalized_invoice_number) <= 100),
  invoice_date date not null,
  due_date date,
  purchase_order text check (purchase_order is null or length(purchase_order) <= 100),
  shipping_reference text check (shipping_reference is null or length(shipping_reference) <= 300),
  category_id uuid references public.expense_categories(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  tax_total numeric(14,2) not null check (tax_total >= 0),
  total numeric(14,2) not null check (total > 0 and total = subtotal + tax_total),
  payment_owner_id uuid references public.users(id),
  planned_payment_date date,
  hold_reason text check (hold_reason is null or (btrim(hold_reason) <> '' and length(hold_reason) <= 1000)),
  next_action text check (next_action is null or (btrim(next_action) <> '' and length(next_action) <= 1000)),
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  paid_at timestamptz,
  routed_to_payroll_by uuid references public.users(id),
  routed_to_payroll_at timestamptz,
  promoted_bill_id uuid references public.supplier_bills(id),
  promoted_expense_id uuid references public.expenses(id),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  check (due_date is null or due_date >= invoice_date),
  check ((hold_reason is null) = (next_action is null)),
  check ((approved_by is null) = (approved_at is null)),
  check ((routed_to_payroll_by is null) = (routed_to_payroll_at is null)),
  check (num_nonnulls(promoted_bill_id, promoted_expense_id) <= 1),
  check (review_stage <> 'payroll' or document_kind = 'employee'),
  unique (id, company_id)
);

create index if not exists supplier_bill_intakes_company_stage_idx
  on public.supplier_bill_intakes (company_id, review_stage, updated_at desc)
  where deleted_at is null;
create index if not exists supplier_bill_intakes_duplicate_candidate_idx
  on public.supplier_bill_intakes (
    company_id, normalized_supplier_name, normalized_invoice_number
  ) where deleted_at is null;
create index if not exists supplier_bill_intakes_captured_by_idx
  on public.supplier_bill_intakes (captured_by);
create index if not exists supplier_bill_intakes_payment_owner_idx
  on public.supplier_bill_intakes (payment_owner_id)
  where review_stage = 'to_pay';
create index if not exists supplier_bill_intakes_category_idx
  on public.supplier_bill_intakes (category_id);
create index if not exists supplier_bill_intakes_promoted_bill_idx
  on public.supplier_bill_intakes (promoted_bill_id)
  where promoted_bill_id is not null;

create table if not exists public.supplier_bill_intake_line_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  intake_id uuid not null,
  position integer not null check (position > 0),
  sku text check (sku is null or length(sku) <= 100),
  description text not null check (btrim(description) <> '' and length(description) <= 1000),
  ordered_quantity numeric(14,4) check (ordered_quantity is null or ordered_quantity >= 0),
  invoiced_quantity numeric(14,4) not null check (invoiced_quantity > 0),
  unit_of_measure text check (unit_of_measure is null or length(unit_of_measure) <= 40),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  tax_amount numeric(14,2) not null check (tax_amount >= 0),
  total numeric(14,2) not null check (total > 0 and total = subtotal + tax_amount),
  category_id uuid references public.expense_categories(id),
  job_hint text check (job_hint is null or length(job_hint) <= 500),
  match_basis text check (match_basis is null or match_basis in ('address', 'purchase_order', 'manual')),
  match_status text not null default 'unmatched'
    check (match_status in ('unmatched', 'suggested', 'confirmed')),
  matched_project_id uuid references public.projects(id),
  match_confirmed_by uuid references public.users(id),
  match_confirmed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (intake_id, position),
  unique (id, intake_id, company_id),
  foreign key (intake_id, company_id)
    references public.supplier_bill_intakes(id, company_id) on delete cascade,
  check ((match_confirmed_by is null) = (match_confirmed_at is null)),
  check (match_status <> 'confirmed' or (matched_project_id is not null and match_confirmed_by is not null))
);

create index if not exists supplier_bill_intake_lines_company_idx
  on public.supplier_bill_intake_line_items (company_id);
create index if not exists supplier_bill_intake_lines_project_idx
  on public.supplier_bill_intake_line_items (matched_project_id)
  where matched_project_id is not null;
create index if not exists supplier_bill_intake_lines_category_idx
  on public.supplier_bill_intake_line_items (category_id);

create table if not exists public.supplier_bill_intake_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  intake_id uuid not null,
  line_item_id uuid not null,
  project_id uuid not null references public.projects(id),
  amount numeric(14,2) not null check (amount > 0),
  allocation_basis text not null
    check (allocation_basis in ('suggested_proportional', 'confirmed_suggestion', 'manual')),
  confirmed_by uuid references public.users(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (line_item_id, project_id),
  foreign key (line_item_id, intake_id, company_id)
    references public.supplier_bill_intake_line_items(id, intake_id, company_id) on delete cascade,
  check ((confirmed_by is null) = (confirmed_at is null)),
  check (allocation_basis = 'suggested_proportional' or confirmed_by is not null)
);

create index if not exists supplier_bill_intake_allocations_intake_idx
  on public.supplier_bill_intake_allocations (intake_id, line_item_id);
create index if not exists supplier_bill_intake_allocations_project_idx
  on public.supplier_bill_intake_allocations (project_id);

create table if not exists public.supplier_bill_intake_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  intake_id uuid not null,
  check_key text not null check (check_key in (
    'rate_compliance', 'duplicate_billing', 'quantity_scope',
    'order_specification', 'receipt'
  )),
  outcome text not null default 'pending'
    check (outcome in ('pending', 'clear', 'exception')),
  disposition text not null default 'unresolved'
    check (disposition in ('unresolved', 'accepted', 'held')),
  observed_value text,
  policy_limit text,
  evidence jsonb not null default '{}'::jsonb,
  note text check (note is null or length(note) <= 2000),
  dispositioned_by uuid references public.users(id),
  dispositioned_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (intake_id, check_key),
  unique (id, intake_id, company_id),
  foreign key (intake_id, company_id)
    references public.supplier_bill_intakes(id, company_id) on delete cascade,
  check ((dispositioned_by is null) = (dispositioned_at is null)),
  check (disposition = 'unresolved' or dispositioned_by is not null),
  check (outcome <> 'exception' or disposition <> 'accepted' or btrim(coalesce(note, '')) <> '')
);

create index if not exists supplier_bill_intake_checks_company_idx
  on public.supplier_bill_intake_checks (company_id);

create table if not exists public.supplier_bill_intake_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  intake_id uuid not null,
  storage_bucket text not null check (btrim(storage_bucket) <> ''),
  storage_key text not null check (btrim(storage_key) <> ''),
  public_url text not null check (public_url ~ '^https://'),
  original_filename text not null check (btrim(original_filename) <> '' and length(original_filename) <= 255),
  mime_type text not null check (mime_type = 'application/pdf'),
  size_bytes bigint not null check (size_bytes between 5 and 20971520),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  extraction jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default clock_timestamp(),
  unique (intake_id),
  foreign key (intake_id, company_id)
    references public.supplier_bill_intakes(id, company_id) on delete cascade
);

create unique index if not exists supplier_bill_intake_documents_company_sha256_uniq
  on public.supplier_bill_intake_documents (company_id, sha256);
create index if not exists supplier_bill_intake_documents_created_by_idx
  on public.supplier_bill_intake_documents (created_by);

create table if not exists public.supplier_bill_intake_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  intake_id uuid not null,
  action text not null check (action in (
    'captured', 'review_saved', 'held', 'hold_released', 'approved',
    'routed_to_payroll', 'payment_scheduled', 'payment_recorded'
  )),
  actor_user_id uuid not null references public.users(id),
  intent_id uuid not null,
  command_hash text not null check (command_hash ~ '^[0-9a-f]{64}$'),
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (intent_id),
  foreign key (intake_id, company_id)
    references public.supplier_bill_intakes(id, company_id) on delete cascade
);

create index if not exists supplier_bill_intake_events_intake_idx
  on public.supplier_bill_intake_events (intake_id, created_at);
create index if not exists supplier_bill_intake_events_actor_idx
  on public.supplier_bill_intake_events (actor_user_id);

create table if not exists private.supplier_bill_intake_write_intents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  actor_user_id uuid not null,
  action text not null check (action in (
    'capture', 'save_review', 'hold', 'release_hold', 'approve',
    'route_payroll', 'schedule_payment', 'record_payment'
  )),
  intake_id uuid,
  expected_revision integer,
  idempotency_key text not null check (btrim(idempotency_key) <> '' and length(idempotency_key) <= 200),
  command_hash text not null check (command_hash ~ '^[0-9a-f]{64}$'),
  command jsonb not null,
  confirmation_text text not null,
  status text not null default 'prepared'
    check (status in ('prepared', 'executing', 'committed', 'expired')),
  prepared_at timestamptz not null default clock_timestamp(),
  confirmed_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null default (clock_timestamp() + interval '15 minutes'),
  receipt jsonb,
  unique (company_id, idempotency_key)
);

revoke all on table private.supplier_bill_intake_write_intents
  from public, anon, authenticated;

create or replace function private.supplier_bill_intake_actor_company(
  p_actor_user_id uuid,
  p_required_permission text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_company_id uuid;
begin
  if p_required_permission not in (
    'accounting.bills.capture', 'accounting.bills.approve', 'accounting.bills.pay'
  ) then
    raise exception 'Unsupported supplier bill permission' using errcode = '22023';
  end if;

  select u.company_id
    into v_company_id
    from public.users u
   where u.id = p_actor_user_id
     and u.is_active = true
     and u.deleted_at is null;

  if v_company_id is null
     or not public.has_permission(p_actor_user_id, 'accounting.view', 'all')
     or not public.has_permission(p_actor_user_id, p_required_permission, 'all') then
    raise exception 'Supplier bill authority is required' using errcode = '42501';
  end if;
  return v_company_id;
end;
$function$;

revoke all on function private.supplier_bill_intake_actor_company(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function private.supplier_bill_intake_live_receipt(
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
  v_intent private.supplier_bill_intake_write_intents%rowtype;
begin
  select * into v_intent
    from private.supplier_bill_intake_write_intents
   where id = p_intent_id;
  if not found or v_intent.intake_id is null then return null; end if;

  return (
    select jsonb_build_object(
      'intentId', v_intent.id,
      'replayed', p_replayed,
      'intake', to_jsonb(i),
      'lines', coalesce((
        select jsonb_agg(
          to_jsonb(line) || jsonb_build_object(
            'allocations', coalesce((
              select jsonb_agg(to_jsonb(a) order by a.project_id)
                from public.supplier_bill_intake_allocations a
               where a.line_item_id = line.id
            ), '[]'::jsonb)
          ) order by line.position
        ) from public.supplier_bill_intake_line_items line
          where line.intake_id = i.id
      ), '[]'::jsonb),
      'checks', coalesce((
        select jsonb_agg(to_jsonb(c) order by c.check_key)
          from public.supplier_bill_intake_checks c
         where c.intake_id = i.id
      ), '[]'::jsonb),
      'document', (
        select to_jsonb(d) from public.supplier_bill_intake_documents d
         where d.intake_id = i.id
      ),
      'events', coalesce((
        select jsonb_agg(to_jsonb(e) order by e.created_at)
          from public.supplier_bill_intake_events e
         where e.intake_id = i.id
      ), '[]'::jsonb)
    )
      from public.supplier_bill_intakes i
     where i.id = v_intent.intake_id
       and i.company_id = v_intent.company_id
       and i.deleted_at is null
  );
end;
$function$;

revoke all on function private.supplier_bill_intake_live_receipt(uuid, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.prepare_supplier_bill_intake_write(
  p_actor_user_id uuid,
  p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_action text;
  v_permission text;
  v_company_id uuid;
  v_command_company_id uuid;
  v_command_actor_id uuid;
  v_intake_id uuid;
  v_expected_revision integer;
  v_idempotency_key text;
  v_command_hash text;
  v_confirmation_text text;
  v_existing private.supplier_bill_intake_write_intents%rowtype;
  v_intent private.supplier_bill_intake_write_intents%rowtype;
begin
  if p_command is null or jsonb_typeof(p_command) <> 'object' then
    raise exception 'Supplier bill intake command must be an object' using errcode = '22023';
  end if;

  v_action := coalesce(nullif(p_command ->> 'kind', ''), 'capture');
  if v_action not in (
    'capture', 'save_review', 'hold', 'release_hold', 'approve',
    'route_payroll', 'schedule_payment', 'record_payment'
  ) then
    raise exception 'Supplier bill intake action is invalid' using errcode = '22023';
  end if;

  v_permission := case
    when v_action = 'approve' then 'accounting.bills.approve'
    when v_action in ('schedule_payment', 'record_payment') then 'accounting.bills.pay'
    else 'accounting.bills.capture'
  end;
  v_company_id := private.supplier_bill_intake_actor_company(
    p_actor_user_id, v_permission
  );

  begin
    v_command_company_id := nullif(p_command ->> 'companyId', '')::uuid;
    v_command_actor_id := nullif(p_command ->> 'actorUserId', '')::uuid;
    v_intake_id := case
      when v_action = 'capture' then nullif(p_command ->> 'requestId', '')::uuid
      else nullif(p_command ->> 'intakeId', '')::uuid
    end;
    v_expected_revision := case
      when v_action = 'capture' then null
      else nullif(p_command ->> 'expectedRevision', '')::integer
    end;
  exception when invalid_text_representation then
    raise exception 'Supplier bill intake identifier is invalid' using errcode = '22023';
  end;

  if v_command_company_id is distinct from v_company_id
     or v_command_actor_id is distinct from p_actor_user_id
     or v_intake_id is null
     or (v_action <> 'capture' and v_expected_revision is null) then
    raise exception 'Supplier bill intake authority or revision is invalid'
      using errcode = '42501';
  end if;

  v_idempotency_key := nullif(btrim(p_command ->> 'idempotencyKey'), '');
  if v_idempotency_key is null or length(v_idempotency_key) > 200 then
    raise exception 'Supplier bill intake idempotency key is invalid' using errcode = '22023';
  end if;
  v_command_hash := encode(extensions.digest(p_command::text, 'sha256'), 'hex');

  v_confirmation_text := case v_action
    when 'capture' then 'CAPTURE BILL ' || upper(coalesce(p_command ->> 'invoiceNumber', '')) || ' FOR REVIEW'
    when 'save_review' then 'SAVE BILL REVIEW ' || v_intake_id::text
    when 'hold' then 'HOLD BILL ' || v_intake_id::text
    when 'release_hold' then 'RELEASE BILL ' || v_intake_id::text
    when 'approve' then 'APPROVE BILL ' || v_intake_id::text || ' TO PAY'
    when 'route_payroll' then 'ROUTE BILL ' || v_intake_id::text || ' TO PAYROLL'
    when 'schedule_payment' then 'SCHEDULE BILL ' || v_intake_id::text || ' FOR PAYMENT'
    when 'record_payment' then 'RECORD BILL ' || v_intake_id::text || ' PAYMENT'
  end;

  perform pg_advisory_xact_lock(
    hashtextextended('supplier_bill_intake:' || v_company_id::text, 0)
  );
  update private.supplier_bill_intake_write_intents
     set status = 'expired'
   where company_id = v_company_id
     and status = 'prepared'
     and expires_at <= clock_timestamp();

  select * into v_existing
    from private.supplier_bill_intake_write_intents
   where company_id = v_company_id
     and idempotency_key = v_idempotency_key
   for update;
  if found then
    if v_existing.actor_user_id <> p_actor_user_id
       or v_existing.command_hash <> v_command_hash then
      raise exception 'Supplier bill intake idempotency key was reused with different content'
        using errcode = '22023';
    end if;
    if v_existing.status = 'committed' then
      return private.supplier_bill_intake_live_receipt(v_existing.id, true);
    end if;
    if v_existing.status = 'expired' then
      update private.supplier_bill_intake_write_intents
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

  insert into private.supplier_bill_intake_write_intents (
    company_id, actor_user_id, action, intake_id, expected_revision,
    idempotency_key, command_hash, command, confirmation_text
  ) values (
    v_company_id, p_actor_user_id, v_action, v_intake_id, v_expected_revision,
    v_idempotency_key, v_command_hash, p_command, v_confirmation_text
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

revoke all on function public.prepare_supplier_bill_intake_write(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.prepare_supplier_bill_intake_write(uuid, jsonb)
  to service_role;

create or replace function public.commit_supplier_bill_intake_write(
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
  v_intent private.supplier_bill_intake_write_intents%rowtype;
  v_command jsonb;
  v_company_id uuid;
  v_permission text;
  v_intake public.supplier_bill_intakes%rowtype;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb;
  v_now timestamptz := clock_timestamp();
  v_line jsonb;
  v_check jsonb;
  v_allocation jsonb;
  v_line_id uuid;
  v_supplier public.suppliers%rowtype;
  v_bill public.supplier_bills%rowtype;
  v_payment_id uuid;
  v_payment_amount numeric;
  v_new_balance numeric;
  v_required_checks text[];
  v_event_action text;
begin
  select * into v_intent
    from private.supplier_bill_intake_write_intents
   where id = p_intent_id
   for update;
  if not found then
    raise exception 'Supplier bill intake intent not found' using errcode = 'P0002';
  end if;

  v_permission := case
    when v_intent.action = 'approve' then 'accounting.bills.approve'
    when v_intent.action in ('schedule_payment', 'record_payment') then 'accounting.bills.pay'
    else 'accounting.bills.capture'
  end;
  v_company_id := private.supplier_bill_intake_actor_company(
    p_actor_user_id, v_permission
  );
  if v_company_id <> v_intent.company_id
     or p_actor_user_id <> v_intent.actor_user_id then
    raise exception 'Supplier bill intake actor changed' using errcode = '42501';
  end if;
  if v_intent.status = 'committed' then
    return private.supplier_bill_intake_live_receipt(v_intent.id, true);
  end if;
  if v_intent.status <> 'prepared' or v_intent.expires_at <= v_now then
    raise exception 'Supplier bill intake intent expired' using errcode = '57014';
  end if;
  if p_confirmation_text is distinct from v_intent.confirmation_text then
    raise exception 'Supplier bill intake confirmation did not match' using errcode = '22023';
  end if;

  update private.supplier_bill_intake_write_intents
     set status = 'executing', confirmed_at = v_now
   where id = v_intent.id;
  v_command := v_intent.command;

  if v_intent.action = 'capture' then
    if jsonb_typeof(v_command -> 'lines') <> 'array'
       or jsonb_array_length(v_command -> 'lines') = 0
       or jsonb_typeof(v_command -> 'sourceDocument') <> 'object' then
      raise exception 'Supplier bill intake requires lines and a source document'
        using errcode = '22023';
    end if;

    insert into public.supplier_bill_intakes (
      id, company_id, captured_by, document_kind, review_stage,
      supplier_name, normalized_supplier_name, invoice_number,
      normalized_invoice_number, invoice_date, due_date, purchase_order,
      shipping_reference, category_id, currency, subtotal, tax_total, total,
      payment_owner_id, planned_payment_date,
      routed_to_payroll_by, routed_to_payroll_at
    ) values (
      v_intent.intake_id, v_company_id, p_actor_user_id,
      v_command ->> 'documentKind',
      case when v_command ->> 'documentKind' = 'employee' then 'payroll' else 'review' end,
      v_command ->> 'supplierName', v_command ->> 'normalizedSupplierName',
      v_command ->> 'invoiceNumber', v_command ->> 'normalizedInvoiceNumber',
      (v_command ->> 'invoiceDate')::date,
      nullif(v_command ->> 'dueDate', '')::date,
      nullif(v_command ->> 'purchaseOrder', ''),
      nullif(v_command ->> 'shippingReference', ''),
      nullif(v_command ->> 'categoryId', '')::uuid,
      v_command ->> 'currency', (v_command ->> 'subtotal')::numeric,
      (v_command ->> 'taxTotal')::numeric, (v_command ->> 'total')::numeric,
      nullif(v_command ->> 'paymentOwnerId', '')::uuid,
      nullif(v_command ->> 'plannedPaymentDate', '')::date,
      case when v_command ->> 'documentKind' = 'employee' then p_actor_user_id end,
      case when v_command ->> 'documentKind' = 'employee' then v_now end
    ) returning * into v_intake;

    for v_line in select value from jsonb_array_elements(v_command -> 'lines')
    loop
      insert into public.supplier_bill_intake_line_items (
        company_id, intake_id, position, sku, description, ordered_quantity,
        invoiced_quantity, unit_of_measure, unit_price, subtotal, tax_amount,
        total, category_id, job_hint, match_basis, match_status,
        matched_project_id, match_confirmed_by, match_confirmed_at
      ) values (
        v_company_id, v_intake.id, (v_line ->> 'position')::integer,
        nullif(v_line ->> 'sku', ''), v_line ->> 'description',
        nullif(v_line ->> 'orderedQuantity', '')::numeric,
        (v_line ->> 'invoicedQuantity')::numeric,
        nullif(v_line ->> 'unitOfMeasure', ''),
        (v_line ->> 'unitPrice')::numeric, (v_line ->> 'subtotal')::numeric,
        (v_line ->> 'taxAmount')::numeric, (v_line ->> 'total')::numeric,
        coalesce(nullif(v_line ->> 'categoryId', '')::uuid, v_intake.category_id),
        nullif(v_line ->> 'jobHint', ''), nullif(v_line ->> 'matchBasis', ''),
        coalesce(nullif(v_line ->> 'matchStatus', ''), 'unmatched'),
        nullif(v_line ->> 'matchedProjectId', '')::uuid,
        case when v_line ->> 'matchStatus' = 'confirmed' then p_actor_user_id end,
        case when v_line ->> 'matchStatus' = 'confirmed' then v_now end
      ) returning id into v_line_id;

      for v_allocation in
        select value from jsonb_array_elements(coalesce(v_line -> 'allocations', '[]'::jsonb))
      loop
        insert into public.supplier_bill_intake_allocations (
          company_id, intake_id, line_item_id, project_id, amount,
          allocation_basis, confirmed_by, confirmed_at
        ) values (
          v_company_id, v_intake.id, v_line_id,
          (v_allocation ->> 'projectId')::uuid,
          (v_allocation ->> 'amount')::numeric,
          coalesce(v_allocation ->> 'basis', 'suggested_proportional'),
          case when coalesce(v_allocation ->> 'basis', 'suggested_proportional')
            <> 'suggested_proportional' then p_actor_user_id end,
          case when coalesce(v_allocation ->> 'basis', 'suggested_proportional')
            <> 'suggested_proportional' then v_now end
        );
      end loop;
    end loop;

    v_required_checks := case v_intake.document_kind
      when 'material' then array[
        'rate_compliance', 'duplicate_billing', 'quantity_scope',
        'order_specification', 'receipt'
      ]::text[]
      when 'subcontractor' then array[
        'rate_compliance', 'duplicate_billing', 'quantity_scope'
      ]::text[]
      else array['duplicate_billing']::text[]
    end;
    insert into public.supplier_bill_intake_checks (
      company_id, intake_id, check_key
    )
    select v_company_id, v_intake.id, key
      from unnest(v_required_checks) key;

    for v_check in
      select value from jsonb_array_elements(coalesce(v_command -> 'checks', '[]'::jsonb))
    loop
      insert into public.supplier_bill_intake_checks (
        company_id, intake_id, check_key, outcome, disposition,
        observed_value, policy_limit, evidence, note,
        dispositioned_by, dispositioned_at
      ) values (
        v_company_id, v_intake.id, v_check ->> 'key',
        coalesce(v_check ->> 'outcome', 'pending'),
        coalesce(v_check ->> 'disposition', 'unresolved'),
        nullif(v_check ->> 'observedValue', ''),
        nullif(v_check ->> 'policyLimit', ''),
        coalesce(v_check -> 'evidence', '{}'::jsonb),
        nullif(v_check ->> 'note', ''),
        case when coalesce(v_check ->> 'disposition', 'unresolved')
          <> 'unresolved' then p_actor_user_id end,
        case when coalesce(v_check ->> 'disposition', 'unresolved')
          <> 'unresolved' then v_now end
      ) on conflict (intake_id, check_key) do update set
        outcome = excluded.outcome,
        disposition = excluded.disposition,
        observed_value = excluded.observed_value,
        policy_limit = excluded.policy_limit,
        evidence = excluded.evidence,
        note = excluded.note,
        dispositioned_by = excluded.dispositioned_by,
        dispositioned_at = excluded.dispositioned_at,
        updated_at = v_now;
    end loop;

    insert into public.supplier_bill_intake_documents (
      company_id, intake_id, storage_bucket, storage_key, public_url,
      original_filename, mime_type, size_bytes, sha256, extraction, created_by
    ) values (
      v_company_id, v_intake.id,
      v_command #>> '{sourceDocument,bucket}',
      v_command #>> '{sourceDocument,objectKey}',
      v_command #>> '{sourceDocument,publicUrl}',
      v_command #>> '{sourceDocument,originalFilename}',
      v_command #>> '{sourceDocument,mimeType}',
      (v_command #>> '{sourceDocument,sizeBytes}')::bigint,
      v_command #>> '{sourceDocument,sha256}',
      coalesce(v_command -> 'extraction', '{}'::jsonb), p_actor_user_id
    );
    v_event_action := 'captured';

  else
    select * into v_intake
      from public.supplier_bill_intakes i
     where i.id = v_intent.intake_id
       and i.company_id = v_company_id
       and i.deleted_at is null
     for update;
    if not found then
      raise exception 'Supplier bill intake not found' using errcode = 'P0002';
    end if;
    if v_intake.revision <> v_intent.expected_revision then
      raise exception 'Supplier bill intake changed; refresh before continuing'
        using errcode = '40001';
    end if;
    v_before := to_jsonb(v_intake);

    if v_intent.action = 'save_review' then
      if v_intake.promoted_bill_id is not null or v_intake.review_stage = 'paid' then
        raise exception 'Promoted supplier bill review is immutable' using errcode = '55000';
      end if;

      update public.supplier_bill_intakes set
        document_kind = coalesce(nullif(v_command ->> 'documentKind', ''), document_kind),
        category_id = case when v_command ? 'categoryId'
          then nullif(v_command ->> 'categoryId', '')::uuid else category_id end,
        payment_owner_id = case when v_command ? 'paymentOwnerId'
          then nullif(v_command ->> 'paymentOwnerId', '')::uuid else payment_owner_id end,
        planned_payment_date = case when v_command ? 'plannedPaymentDate'
          then nullif(v_command ->> 'plannedPaymentDate', '')::date else planned_payment_date end,
        revision = revision + 1,
        updated_at = v_now
      where id = v_intake.id
      returning * into v_intake;

      for v_check in
        select value from jsonb_array_elements(coalesce(v_command -> 'checks', '[]'::jsonb))
      loop
        update public.supplier_bill_intake_checks set
          outcome = v_check ->> 'outcome',
          disposition = v_check ->> 'disposition',
          observed_value = nullif(v_check ->> 'observedValue', ''),
          policy_limit = nullif(v_check ->> 'policyLimit', ''),
          evidence = coalesce(v_check -> 'evidence', evidence),
          note = nullif(v_check ->> 'note', ''),
          dispositioned_by = case when v_check ->> 'disposition' <> 'unresolved'
            then p_actor_user_id end,
          dispositioned_at = case when v_check ->> 'disposition' <> 'unresolved'
            then v_now end,
          updated_at = v_now
        where intake_id = v_intake.id and check_key = v_check ->> 'key';
      end loop;

      if v_command ? 'allocations' then
        delete from public.supplier_bill_intake_allocations
         where intake_id = v_intake.id;
        for v_allocation in
          select value from jsonb_array_elements(v_command -> 'allocations')
        loop
          select id into v_line_id
            from public.supplier_bill_intake_line_items
           where intake_id = v_intake.id
             and position = (v_allocation ->> 'linePosition')::integer;
          if v_line_id is null then
            raise exception 'Supplier bill allocation line not found' using errcode = '22023';
          end if;
          insert into public.supplier_bill_intake_allocations (
            company_id, intake_id, line_item_id, project_id, amount,
            allocation_basis, confirmed_by, confirmed_at
          ) values (
            v_company_id, v_intake.id, v_line_id,
            (v_allocation ->> 'projectId')::uuid,
            (v_allocation ->> 'amount')::numeric,
            coalesce(v_allocation ->> 'basis', 'manual'),
            p_actor_user_id, v_now
          );
        end loop;
      end if;
      v_event_action := 'review_saved';

    elsif v_intent.action = 'hold' then
      if btrim(coalesce(v_command ->> 'holdReason', '')) = ''
         or btrim(coalesce(v_command ->> 'nextAction', '')) = '' then
        raise exception 'Hold reason and next action are required' using errcode = '22023';
      end if;
      if v_intake.promoted_bill_id is not null then
        raise exception 'An approved supplier bill cannot return to intake hold'
          using errcode = '55000';
      end if;
      update public.supplier_bill_intakes set
        review_stage = 'held', hold_reason = v_command ->> 'holdReason',
        next_action = v_command ->> 'nextAction', revision = revision + 1,
        updated_at = v_now
      where id = v_intake.id returning * into v_intake;
      v_event_action := 'held';

    elsif v_intent.action = 'release_hold' then
      update public.supplier_bill_intakes set
        review_stage = case when document_kind = 'employee' then 'payroll' else 'review' end,
        hold_reason = null, next_action = null, revision = revision + 1,
        updated_at = v_now
      where id = v_intake.id and review_stage = 'held'
      returning * into v_intake;
      if not found then
        raise exception 'Only a held supplier bill can be released' using errcode = '55000';
      end if;
      v_event_action := 'hold_released';

    elsif v_intent.action = 'route_payroll' then
      if v_intake.document_kind <> 'employee' then
        raise exception 'Only an employee document can route to payroll'
          using errcode = '22023';
      end if;
      if v_intake.promoted_bill_id is not null then
        raise exception 'Supplier bill intake was already promoted' using errcode = '55000';
      end if;
      update public.supplier_bill_intakes set
        review_stage = 'payroll', routed_to_payroll_by = p_actor_user_id,
        routed_to_payroll_at = v_now, hold_reason = null, next_action = null,
        revision = revision + 1, updated_at = v_now
      where id = v_intake.id returning * into v_intake;
      v_event_action := 'routed_to_payroll';

    elsif v_intent.action = 'approve' then
      if v_intake.document_kind = 'employee' then
        raise exception 'Employee documents route to payroll, not accounts payable'
          using errcode = '22023';
      end if;
      if v_intake.promoted_bill_id is not null then
        raise exception 'Supplier bill intake was already promoted' using errcode = '55000';
      end if;
      if v_intake.review_stage <> 'review' then
        raise exception 'Supplier bill intake is not approval-ready' using errcode = '55000';
      end if;
      if v_intake.category_id is null
         or v_intake.payment_owner_id is null
         or v_intake.planned_payment_date is null then
        raise exception 'Payment owner and target date are required before approval'
          using errcode = '22023';
      end if;

      v_required_checks := case v_intake.document_kind
        when 'material' then array[
          'rate_compliance', 'duplicate_billing', 'quantity_scope',
          'order_specification', 'receipt'
        ]::text[]
        else array['rate_compliance', 'duplicate_billing', 'quantity_scope']::text[]
      end;
      if exists (
        select 1 from unnest(v_required_checks) required(check_key)
         where not exists (
           select 1 from public.supplier_bill_intake_checks c
            where c.intake_id = v_intake.id
              and c.check_key = required.check_key
              and c.outcome in ('clear', 'exception')
              and c.disposition = 'accepted'
              and (c.outcome <> 'exception' or btrim(coalesce(c.note, '')) <> '')
         )
      ) then
        raise exception 'Supplier bill has unresolved clearance checks'
          using errcode = '22023';
      end if;

      if exists (
        select 1
          from public.supplier_bill_intake_line_items line
         where line.intake_id = v_intake.id
           and coalesce((
             select sum(a.amount)
               from public.supplier_bill_intake_allocations a
              where a.line_item_id = line.id
                and a.confirmed_by is not null
           ), 0) <> line.total
      ) then
        raise exception 'Supplier bill allocation total does not equal line total'
          using errcode = '22023';
      end if;

      insert into public.suppliers (
        company_id, display_name, normalized_name, created_by
      ) values (
        v_company_id, v_intake.supplier_name,
        v_intake.normalized_supplier_name, p_actor_user_id
      ) on conflict (company_id, normalized_name) do update set
        display_name = excluded.display_name,
        updated_at = v_now
      returning * into v_supplier;

      insert into public.supplier_bills (
        company_id, supplier_id, invoice_number, normalized_invoice_number,
        invoice_date, due_date, category_id, currency, subtotal, tax_total,
        total, balance, status, notes, created_by, confirmed_by, confirmed_at
      ) values (
        v_company_id, v_supplier.id, v_intake.invoice_number,
        v_intake.normalized_invoice_number, v_intake.invoice_date,
        v_intake.due_date, v_intake.category_id, v_intake.currency,
        v_intake.subtotal, v_intake.tax_total, v_intake.total,
        v_intake.total, 'open', null, p_actor_user_id, p_actor_user_id, v_now
      ) returning * into v_bill;

      insert into public.supplier_bill_line_items (
        company_id, bill_id, position, sku, description, quantity,
        unit_price, subtotal, tax_amount, total, category_id
      )
      select line.company_id, v_bill.id, line.position, line.sku,
             line.description, line.invoiced_quantity, line.unit_price,
             line.subtotal, line.tax_amount, line.total,
             coalesce(line.category_id, v_intake.category_id)
        from public.supplier_bill_intake_line_items line
       where line.intake_id = v_intake.id
       order by line.position;

      insert into public.supplier_bill_project_allocations (
        company_id, bill_id, line_item_id, project_id, amount
      )
      select a.company_id, v_bill.id, promoted_line.id, a.project_id, a.amount
        from public.supplier_bill_intake_allocations a
        join public.supplier_bill_intake_line_items intake_line
          on intake_line.id = a.line_item_id
        join public.supplier_bill_line_items promoted_line
          on promoted_line.bill_id = v_bill.id
         and promoted_line.position = intake_line.position
       where a.intake_id = v_intake.id
         and a.confirmed_by is not null;

      insert into public.supplier_bill_documents (
        company_id, bill_id, storage_bucket, storage_key, public_url,
        original_filename, mime_type, size_bytes, sha256, created_by
      )
      select d.company_id, v_bill.id, d.storage_bucket, d.storage_key,
             d.public_url, d.original_filename, d.mime_type, d.size_bytes,
             d.sha256, d.created_by
        from public.supplier_bill_intake_documents d
       where d.intake_id = v_intake.id;

      insert into public.supplier_bill_events (
        company_id, subject_type, subject_id, action, actor_user_id, intent_id,
        command_hash, before_snapshot, after_snapshot
      ) values (
        v_company_id, 'supplier_bill', v_bill.id, 'captured', p_actor_user_id,
        v_intent.id, v_intent.command_hash, '{}'::jsonb, to_jsonb(v_bill)
      );
      perform private.enqueue_supplier_bill_accounting(
        v_company_id, 'supplier', v_supplier.id, 'create',
        'suppliers', 'insert', v_now
      );
      perform private.enqueue_supplier_bill_accounting(
        v_company_id, 'supplier_bill', v_bill.id, 'create',
        'supplier_bills', 'insert', v_now
      );

      update public.supplier_bill_intakes set
        review_stage = 'to_pay', approved_by = p_actor_user_id,
        approved_at = v_now, promoted_bill_id = v_bill.id,
        hold_reason = null, next_action = null, revision = revision + 1,
        updated_at = v_now
      where id = v_intake.id returning * into v_intake;
      insert into public.notifications (
        user_id, company_id, type, title, body, is_read, persistent,
        action_url, action_label, dedupe_key
      ) values (
        v_intake.payment_owner_id::text, v_company_id::text, 'standard',
        'Bill ready to pay',
        v_intake.normalized_invoice_number || ' · ' || v_intake.currency || ' ' ||
          to_char(v_intake.total, 'FM999,999,999,990.00'),
        false, false, '/books?segment=bills&stage=to_pay', 'OPEN BILLS',
        'supplier-bill-intake-approved:' || v_intake.id::text
      ) on conflict do nothing;
      v_event_action := 'approved';

    elsif v_intent.action = 'schedule_payment' then
      if v_intake.promoted_bill_id is null or v_intake.review_stage <> 'to_pay' then
        raise exception 'Only an approved supplier bill can be scheduled'
          using errcode = '55000';
      end if;
      if nullif(v_command ->> 'paymentOwnerId', '') is null
         or nullif(v_command ->> 'plannedPaymentDate', '') is null then
        raise exception 'Payment owner and target date are required'
          using errcode = '22023';
      end if;
      update public.supplier_bill_intakes set
        payment_owner_id = (v_command ->> 'paymentOwnerId')::uuid,
        planned_payment_date = (v_command ->> 'plannedPaymentDate')::date,
        revision = revision + 1, updated_at = v_now
      where id = v_intake.id returning * into v_intake;
      v_event_action := 'payment_scheduled';

    elsif v_intent.action = 'record_payment' then
      if v_intake.promoted_bill_id is null or v_intake.review_stage <> 'to_pay' then
        raise exception 'Only an approved supplier bill can be paid'
          using errcode = '55000';
      end if;
      select * into v_bill from public.supplier_bills
       where id = v_intake.promoted_bill_id and company_id = v_company_id
       for update;
      v_payment_amount := (v_command #>> '{payment,amount}')::numeric;
      if v_payment_amount <= 0 or v_payment_amount > v_bill.balance then
        raise exception 'Supplier bill payment cannot exceed the open balance'
          using errcode = '22023';
      end if;
      insert into public.supplier_bill_payments (
        company_id, bill_id, payment_date, amount, payment_method,
        reference, recorded_by, confirmed_at
      ) values (
        v_company_id, v_bill.id, (v_command #>> '{payment,paymentDate}')::date,
        v_payment_amount, v_command #>> '{payment,paymentMethod}',
        nullif(v_command #>> '{payment,reference}', ''), p_actor_user_id, v_now
      ) returning id into v_payment_id;
      v_new_balance := v_bill.balance - v_payment_amount;
      update public.supplier_bills set
        balance = v_new_balance,
        status = case when v_new_balance = 0 then 'paid' else 'partial' end,
        updated_at = v_now
      where id = v_bill.id returning * into v_bill;
      insert into public.supplier_bill_events (
        company_id, subject_type, subject_id, action, actor_user_id, intent_id,
        command_hash, before_snapshot, after_snapshot
      ) values (
        v_company_id, 'supplier_bill', v_bill.id, 'payment_recorded',
        p_actor_user_id, v_intent.id, v_intent.command_hash,
        jsonb_build_object('balance', v_bill.balance + v_payment_amount),
        to_jsonb(v_bill)
      );
      perform private.enqueue_supplier_bill_accounting(
        v_company_id, 'supplier_bill_payment', v_payment_id, 'create',
        'supplier_bill_payments', 'insert', v_now
      );
      update public.supplier_bill_intakes set
        review_stage = case when v_new_balance = 0 then 'paid' else 'to_pay' end,
        paid_at = case when v_new_balance = 0 then v_now else null end,
        revision = revision + 1, updated_at = v_now
      where id = v_intake.id returning * into v_intake;
      v_event_action := 'payment_recorded';
    end if;
  end if;

  v_after := to_jsonb(v_intake);
  insert into public.supplier_bill_intake_events (
    company_id, intake_id, action, actor_user_id, intent_id, command_hash,
    before_snapshot, after_snapshot
  ) values (
    v_company_id, v_intake.id, v_event_action, p_actor_user_id, v_intent.id,
    v_intent.command_hash, v_before, v_after
  );
  update private.supplier_bill_intake_write_intents set
    status = 'committed', completed_at = v_now,
    receipt = jsonb_build_object('intakeId', v_intake.id, 'revision', v_intake.revision)
  where id = v_intent.id;
  return private.supplier_bill_intake_live_receipt(v_intent.id, false);
end;
$function$;

revoke all on function public.commit_supplier_bill_intake_write(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_supplier_bill_intake_write(uuid, uuid, text)
  to service_role;

alter table public.supplier_bill_intakes enable row level security;
alter table public.supplier_bill_intake_line_items enable row level security;
alter table public.supplier_bill_intake_allocations enable row level security;
alter table public.supplier_bill_intake_checks enable row level security;
alter table public.supplier_bill_intake_documents enable row level security;
alter table public.supplier_bill_intake_events enable row level security;

drop policy if exists supplier_bill_intakes_company_read
  on public.supplier_bill_intakes;
create policy supplier_bill_intakes_company_read
  on public.supplier_bill_intakes for select
  to anon, authenticated
  using (private.can_read_supplier_bill_company(company_id));

drop policy if exists supplier_bill_intake_line_items_company_read
  on public.supplier_bill_intake_line_items;
create policy supplier_bill_intake_line_items_company_read
  on public.supplier_bill_intake_line_items for select
  to anon, authenticated
  using (private.can_read_supplier_bill_company(company_id));

drop policy if exists supplier_bill_intake_allocations_company_read
  on public.supplier_bill_intake_allocations;
create policy supplier_bill_intake_allocations_company_read
  on public.supplier_bill_intake_allocations for select
  to anon, authenticated
  using (private.can_read_supplier_bill_company(company_id));

drop policy if exists supplier_bill_intake_checks_company_read
  on public.supplier_bill_intake_checks;
create policy supplier_bill_intake_checks_company_read
  on public.supplier_bill_intake_checks for select
  to anon, authenticated
  using (private.can_read_supplier_bill_company(company_id));

drop policy if exists supplier_bill_intake_documents_company_read
  on public.supplier_bill_intake_documents;
create policy supplier_bill_intake_documents_company_read
  on public.supplier_bill_intake_documents for select
  to anon, authenticated
  using (private.can_read_supplier_bill_company(company_id));

drop policy if exists supplier_bill_intake_events_company_read
  on public.supplier_bill_intake_events;
create policy supplier_bill_intake_events_company_read
  on public.supplier_bill_intake_events for select
  to anon, authenticated
  using (private.can_read_supplier_bill_company(company_id));

revoke all on table public.supplier_bill_intakes
  from public, anon, authenticated, service_role;
revoke all on table public.supplier_bill_intake_line_items
  from public, anon, authenticated, service_role;
revoke all on table public.supplier_bill_intake_allocations
  from public, anon, authenticated, service_role;
revoke all on table public.supplier_bill_intake_checks
  from public, anon, authenticated, service_role;
revoke all on table public.supplier_bill_intake_documents
  from public, anon, authenticated, service_role;
revoke all on table public.supplier_bill_intake_events
  from public, anon, authenticated, service_role;
revoke all on table public.supplier_bill_intake_documents from service_role;
revoke all on table public.supplier_bill_intake_events from service_role;

grant select on public.supplier_bill_intakes to anon, authenticated;
grant select on public.supplier_bill_intake_line_items to anon, authenticated;
grant select on public.supplier_bill_intake_allocations to anon, authenticated;
grant select on public.supplier_bill_intake_checks to anon, authenticated;
grant select on public.supplier_bill_intake_documents to anon, authenticated;
grant select on public.supplier_bill_intake_events to anon, authenticated;

grant select, insert, update, delete on public.supplier_bill_intakes
  to service_role;
grant select, insert, update, delete on public.supplier_bill_intake_line_items
  to service_role;
grant select, insert, update, delete on public.supplier_bill_intake_allocations
  to service_role;
grant select, insert, update, delete on public.supplier_bill_intake_checks
  to service_role;
grant select, insert on table public.supplier_bill_intake_documents
  to service_role;
grant select, insert on table public.supplier_bill_intake_events
  to service_role;

comment on table public.supplier_bill_intakes is
  'Durable pre-AP supplier document workflow. Canonical AP and provider work begin only after clearance approval.';
comment on column public.supplier_bill_intakes.due_date is
  'Supplier-stated due date; remains null when the source document omits it.';
comment on column public.supplier_bill_intakes.planned_payment_date is
  'OPS payment target, separate from the supplier-stated due date.';

commit;
