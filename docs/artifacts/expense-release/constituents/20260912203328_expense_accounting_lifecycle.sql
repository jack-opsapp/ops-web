-- Local only. Requires 20260912012607_expense_decision_company_authority.
-- Expense decisions create immutable work; no provider is called by PostgreSQL.
begin;

alter table public.expense_batches add column if not exists reimbursement_amount numeric;

create table if not exists public.expense_accounting_settings (
  connection_id uuid primary key references public.accounting_connections(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  configuration jsonb not null check (jsonb_typeof(configuration) = 'object'),
  updated_at timestamptz not null default clock_timestamp()
);
create table if not exists public.expense_accounting_payee_mappings (
  connection_id uuid not null references public.accounting_connections(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  user_id uuid not null references public.users(id),
  external_employee_id text not null check (btrim(external_employee_id) <> ''),
  primary key (connection_id, user_id)
);
create table if not exists public.expense_accounting_category_mappings (
  connection_id uuid not null references public.accounting_connections(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  category_id uuid not null references public.expense_categories(id),
  external_account_id text not null check (btrim(external_account_id) <> ''),
  primary key (connection_id,category_id)
);

create table if not exists public.expense_accounting_project_mappings (
  connection_id uuid not null references public.accounting_connections(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  external_project_id text not null check (btrim(external_project_id) <> ''),
  primary key (connection_id,project_id)
);
alter table public.expense_accounting_project_mappings enable row level security;
revoke all on public.expense_accounting_project_mappings from public,anon,authenticated;
grant select,insert,update,delete on public.expense_accounting_project_mappings to service_role;
drop policy if exists expense_accounting_projects_service on public.expense_accounting_project_mappings;
create policy expense_accounting_projects_service on public.expense_accounting_project_mappings
  for all to service_role using(true) with check(true);

create table if not exists public.expense_accounting_tax_mappings (
  company_id uuid not null references public.companies(id),
  connection_id uuid not null references public.accounting_connections(id) on delete cascade,
  provider text not null check (provider in ('quickbooks','sage')),
  tax_rate numeric(9,4) not null check (tax_rate>=0 and tax_rate<=100),
  external_tax_code_id text not null check (btrim(external_tax_code_id)<>''),
  primary key(connection_id,tax_rate)
);
alter table public.expense_accounting_tax_mappings enable row level security;
revoke all on public.expense_accounting_tax_mappings from public,anon,authenticated;
grant select,insert,update,delete on public.expense_accounting_tax_mappings to service_role;
drop policy if exists expense_accounting_tax_service on public.expense_accounting_tax_mappings;
create policy expense_accounting_tax_service on public.expense_accounting_tax_mappings
  for all to service_role using(true) with check(true);

create table if not exists public.expense_accounting_events (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  company_id uuid not null references public.companies(id),
  expense_id uuid not null,
  kind text not null check (kind in ('accrual','purchase','settlement','reversal','review')),
  original_event_id uuid references public.expense_accounting_events(id),
  source_snapshot jsonb not null check (jsonb_typeof(source_snapshot) = 'object'),
  connection_bindings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  unique (id, company_id, expense_id),
  check ((kind in ('reversal','settlement')) = (original_event_id is not null))
);
-- Sequence grants are independent of table grants. Live public-schema defaults
-- grant clients USAGE/SELECT/UPDATE, including setval, so keep event ordering
-- owner-only even when these tables are first created under those defaults.
do $$
declare v_sequence regclass:=pg_get_serial_sequence('public.expense_accounting_events','sequence')::regclass;
begin
  if v_sequence is null then
    raise exception 'Expense accounting event sequence unavailable' using errcode='55000';
  end if;
  execute format('revoke all on sequence %s from public,anon,authenticated,service_role',v_sequence);
end; $$;
create index if not exists expense_accounting_events_expense_sequence_idx
  on public.expense_accounting_events(company_id,expense_id,sequence);
create table if not exists private.expense_accounting_state (
  expense_id uuid primary key,
  company_id uuid not null,
  financial_snapshot jsonb not null,
  active_accrual_id uuid references public.expense_accounting_events(id),
  active_payment_id uuid references public.expense_accounting_events(id),
  legacy_review_required boolean not null default false
);
create table if not exists public.expense_accounting_postings (
  event_id uuid not null,
  connection_id uuid not null references public.accounting_connections(id),
  company_id uuid not null,
  expense_id uuid not null,
  queue_id uuid not null unique references public.accounting_sync_queue(id),
  provider text not null check (provider in ('quickbooks','sage')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  posting jsonb not null check (jsonb_typeof(posting) = 'object'),
  external_id text,
  sync_token text,
  provider_updated_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  primary key (event_id, connection_id),
  foreign key (event_id, company_id, expense_id)
    references public.expense_accounting_events(id, company_id, expense_id)
);

alter table public.expense_accounting_settings enable row level security;
alter table public.expense_accounting_payee_mappings enable row level security;
alter table public.expense_accounting_category_mappings enable row level security;
alter table public.expense_accounting_events enable row level security;
alter table public.expense_accounting_postings enable row level security;
revoke all on public.expense_accounting_settings, public.expense_accounting_payee_mappings,
  public.expense_accounting_events, public.expense_accounting_postings, public.expense_accounting_category_mappings
  from public, anon, authenticated, service_role;
grant select,insert,update,delete on public.expense_accounting_settings,
  public.expense_accounting_payee_mappings,public.expense_accounting_category_mappings to service_role;
grant select on public.expense_accounting_events, public.expense_accounting_postings to service_role;
revoke all on private.expense_accounting_state from public,anon,authenticated,service_role;
drop policy if exists expense_accounting_settings_service on public.expense_accounting_settings;
create policy expense_accounting_settings_service on public.expense_accounting_settings
  for all to service_role using (true) with check (true);
drop policy if exists expense_accounting_payees_service on public.expense_accounting_payee_mappings;
create policy expense_accounting_payees_service on public.expense_accounting_payee_mappings
  for all to service_role using (true) with check (true);
drop policy if exists expense_accounting_categories_service on public.expense_accounting_category_mappings;
create policy expense_accounting_categories_service on public.expense_accounting_category_mappings
  for all to service_role using (true) with check (true);
drop policy if exists expense_accounting_events_service on public.expense_accounting_events;
create policy expense_accounting_events_service on public.expense_accounting_events
  for select to service_role using (true);
drop policy if exists expense_accounting_postings_service on public.expense_accounting_postings;
create policy expense_accounting_postings_service on public.expense_accounting_postings
  for select to service_role using (true);

-- Reconnecting the same OPS connection row to different books must never
-- reuse native IDs from the former company. Frozen event bindings stay intact.
create or replace function private.invalidate_expense_accounting_connection_binding()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if row(new.company_id,new.provider,new.provider_environment,new.realm_id_lookup,new.sage_business_id_lookup)
    is distinct from row(old.company_id,old.provider,old.provider_environment,old.realm_id_lookup,old.sage_business_id_lookup) then
    delete from public.expense_accounting_settings where connection_id=new.id;
    delete from public.expense_accounting_category_mappings where connection_id=new.id;
    delete from public.expense_accounting_payee_mappings where connection_id=new.id;
    delete from public.expense_accounting_tax_mappings where connection_id=new.id;
    delete from public.expense_accounting_project_mappings where connection_id=new.id;
  end if;
  return new;
end; $$;
drop trigger if exists invalidate_expense_accounting_connection_binding on public.accounting_connections;
create trigger invalidate_expense_accounting_connection_binding
  after update of company_id,provider,provider_environment,realm_id_lookup,sage_business_id_lookup
  on public.accounting_connections for each row
  execute function private.invalidate_expense_accounting_connection_binding();
revoke all on function private.invalidate_expense_accounting_connection_binding()
  from public,anon,authenticated,service_role;

alter table public.accounting_sync_queue drop constraint if exists accounting_sync_queue_entity_type_check;
alter table public.accounting_sync_queue add constraint accounting_sync_queue_entity_type_check
  check (entity_type in ('customer','invoice','estimate','payment','supplier','supplier_bill','supplier_bill_payment','expense'));
alter table public.accounting_sync_queue drop constraint if exists accounting_sync_queue_source_table_check;
alter table public.accounting_sync_queue add constraint accounting_sync_queue_source_table_check
  check (source_table in ('clients','sub_clients','invoices','estimates','payments','line_items','suppliers','supplier_bills','supplier_bill_payments','expense_accounting_events'));
alter table public.accounting_sync_events drop constraint if exists accounting_sync_events_entity_type_check;
alter table public.accounting_sync_events add constraint accounting_sync_events_entity_type_check
  check (entity_type in ('customer','invoice','estimate','payment','supplier','supplier_bill','supplier_bill_payment','expense'));
create unique index if not exists accounting_expense_event_connection_once
  on public.accounting_sync_queue(connection_id,(payload_snapshot->>'eventId'))
  where entity_type = 'expense';

-- A permissive table policy must never turn a crew edit into approval or a
-- provider payment. Automatic under-threshold approval remains database-owned.
create or replace function private.enforce_expense_accounting_authority()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_uid uuid; v_company uuid; v_role text; v_approver boolean; v_auto boolean;
begin
  v_role:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role');
  if v_role='service_role' or (v_role is null and session_user='postgres') then return new; end if;
  v_uid:=private.get_current_user_id();
  select u.company_id into v_company from public.users u join public.companies c on c.id=u.company_id
    where u.id=v_uid and u.is_active and u.deleted_at is null and c.deleted_at is null;
  if v_company is null or new.company_id is distinct from v_company then
    raise exception 'Expense access denied' using errcode='42501';
  end if;
  if tg_op='UPDATE' and (new.company_id is distinct from old.company_id or
    new.submitted_by is distinct from old.submitted_by) then
    raise exception 'Expense company and submitter cannot change' using errcode='42501';
  end if;
  v_approver:=public.has_permission(v_uid,'expenses.approve','all');
  if new.status in ('approved','reimbursed') and
    (tg_op='INSERT' or new.status is distinct from old.status) then
    v_auto:=new.status='approved' and coalesce(new.amount,0)>0 and exists(
      select 1 from public.expense_settings s where s.company_id=v_company
        and s.auto_approve_threshold>new.amount)
      and new.submitted_by=v_uid;
    if not v_approver and not v_auto then
      raise exception 'Expense approval is required' using errcode='42501';
    end if;
    if new.status='reimbursed' and new.payment_method='company_card' then
      raise exception 'Company-card expenses do not require reimbursement' using errcode='22023';
    end if;
  end if;
  if tg_op='UPDATE' and old.status='reimbursed' and not v_approver and
    row(new.status,new.deleted_at,new.amount,new.tax_amount,new.currency,new.payment_method,new.category_id,new.expense_date,new.merchant_name,new.description)
      is distinct from row(old.status,old.deleted_at,old.amount,old.tax_amount,old.currency,old.payment_method,old.category_id,old.expense_date,old.merchant_name,old.description) then
    raise exception 'An approver must correct a recorded reimbursement' using errcode='42501';
  end if;
  if tg_op='UPDATE' and old.status='approved' and new.status='approved' and not v_approver and
    row(new.amount,new.tax_amount,new.currency,new.expense_date,new.payment_method,new.category_id,new.merchant_name,new.description,new.deleted_at)
      is distinct from row(old.amount,old.tax_amount,old.currency,old.expense_date,old.payment_method,old.category_id,old.merchant_name,old.description,old.deleted_at) then
    raise exception 'Resubmit this expense before changing its approved amount or accounting details' using errcode='42501';
  end if;
  if tg_op='UPDATE' and old.status='approved' and not v_approver and
    (new.status not in ('approved','submitted') or new.deleted_at is distinct from old.deleted_at) then
    raise exception 'An approver must reject or remove approved expense accounting' using errcode='42501';
  end if;
  return new;
end; $$;
drop trigger if exists enforce_expense_accounting_authority on public.expenses;
create trigger enforce_expense_accounting_authority before insert or update on public.expenses
  for each row execute function private.enforce_expense_accounting_authority();
revoke all on function private.enforce_expense_accounting_authority() from public,anon,authenticated,service_role;

-- Direct table writes must not bypass the decision/expense approval boundary.
create or replace function private.enforce_expense_accounting_related_authority()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_role text; v_uid uuid; v_company uuid; v_exp public.expenses; v_id uuid;
begin
  v_role:=coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role');
  if v_role='service_role' or (v_role is null and session_user='postgres') then
    if tg_op='DELETE' then return old; end if; return new;
  end if;
  v_uid:=private.get_current_user_id();
  select u.company_id into v_company from public.users u join public.companies c on c.id=u.company_id
    where u.id=v_uid and u.is_active and u.deleted_at is null and c.deleted_at is null;
  if v_company is null then raise exception 'Expense access denied' using errcode='42501'; end if;
  if tg_table_name='expense_batches' then
    if new.company_id is distinct from v_company or (tg_op='UPDATE' and
      row(new.company_id,new.submitted_by) is distinct from row(old.company_id,old.submitted_by)) then
      raise exception 'Expense batch identity cannot change' using errcode='42501';
    end if;
    if ((tg_op='INSERT' and (new.paid_at is not null or new.paid_by is not null)) or
        (tg_op='UPDATE' and row(new.paid_at,new.paid_by) is distinct from row(old.paid_at,old.paid_by)))
      and not public.has_permission(v_uid,'expenses.approve','all') then
      raise exception 'An approver must record or undo reimbursement' using errcode='42501';
    end if;
  else
    if tg_table_name='expenses' then
      v_exp:=old;
    else
      if tg_op='UPDATE' and new.expense_id is distinct from old.expense_id then
        raise exception 'Expense allocation cannot move between receipts' using errcode='42501';
      end if;
      v_id:=case when tg_op='DELETE' then old.expense_id else new.expense_id end;
      select * into v_exp from public.expenses where id=v_id for update;
      if not found then
        if tg_op='DELETE' then return old; end if;
        raise exception 'Expense unavailable' using errcode='42501';
      end if;
    end if;
    if v_exp.company_id is distinct from v_company or
      (v_exp.status in ('approved','reimbursed') and not public.has_permission(v_uid,'expenses.approve','all')
       and not (tg_table_name='expense_project_allocations' and v_exp.status='approved'
         and v_exp.submitted_by=v_uid and v_exp.amount>0 and exists(select 1 from public.expense_settings s
           where s.company_id=v_company and s.auto_approve_threshold>v_exp.amount))) then
      raise exception 'An approver must correct approved expense accounting' using errcode='42501';
    end if;
    if tg_table_name='expense_project_allocations' and not (
      public.has_permission(v_uid,'expenses.edit','all') or
      (v_exp.submitted_by=v_uid and public.has_permission(v_uid,'expenses.edit','own')) or
      public.has_permission(v_uid,'expenses.approve','all')) then
      raise exception 'Expense allocation access denied' using errcode='42501';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;
drop trigger if exists enforce_expense_batch_payment_authority on public.expense_batches;
create trigger enforce_expense_batch_payment_authority before insert or update on public.expense_batches
  for each row execute function private.enforce_expense_accounting_related_authority();
drop trigger if exists enforce_expense_allocation_accounting_authority on public.expense_project_allocations;
create trigger enforce_expense_allocation_accounting_authority before insert or update or delete on public.expense_project_allocations
  for each row execute function private.enforce_expense_accounting_related_authority();
drop trigger if exists enforce_expense_accounting_delete_authority on public.expenses;
create trigger enforce_expense_accounting_delete_authority before delete on public.expenses
  for each row execute function private.enforce_expense_accounting_related_authority();
revoke all on function private.enforce_expense_accounting_related_authority() from public,anon,authenticated,service_role;

-- A cancelled predecessor is complete only when it and its exact reversal
-- retain matching proof that neither request was ever prepared or accepted.
create or replace function private.expense_queue_cancelled_before_write(p_queue_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.accounting_sync_queue q
    join public.accounting_sync_queue original
      on original.id::text=q.payload_snapshot->'cancelledBeforeWrite'->>'originalQueueId'
    join public.accounting_sync_queue reversal
      on reversal.id::text=q.payload_snapshot->'cancelledBeforeWrite'->>'reversalQueueId'
    join public.expense_accounting_events original_event
      on original_event.id::text=original.payload_snapshot->>'eventId'
    join public.expense_accounting_events reversal_event
      on reversal_event.id::text=reversal.payload_snapshot->>'eventId'
    where q.id=p_queue_id and q.id in (original.id,reversal.id)
      and original.entity_type='expense' and reversal.entity_type='expense'
      and original.source_table='expense_accounting_events' and reversal.source_table='expense_accounting_events'
      and original.operation='create' and reversal.operation='create'
      and original.status='cancelled' and reversal.status='cancelled'
      and original.connection_id=reversal.connection_id and original.provider=reversal.provider
      and original.company_id=reversal.company_id and original.entity_id=reversal.entity_id
      and original_event.company_id=original.company_id and original_event.expense_id=original.entity_id
      and reversal_event.company_id=original.company_id and reversal_event.expense_id=original.entity_id
      and original_event.kind in ('accrual','purchase','settlement') and reversal_event.kind='reversal'
      and reversal_event.original_event_id=original_event.id and reversal_event.sequence>original_event.sequence
      and q.payload_snapshot->'cancelledBeforeWrite'->>'reason'='superseded_before_write'
      and q.payload_snapshot->'cancelledBeforeWrite'->>'originalEventId'=original_event.id::text
      and q.payload_snapshot->'cancelledBeforeWrite'->>'reversalEventId'=reversal_event.id::text
      and original.payload_snapshot->'cancelledBeforeWrite'=reversal.payload_snapshot->'cancelledBeforeWrite'
      and original.external_id is null and original.provider_accepted_at is null
      and original.provider_request_id is null and original.idempotency_expires_at is null
      and reversal.external_id is null and reversal.provider_accepted_at is null
      and reversal.provider_request_id is null and reversal.idempotency_expires_at is null
      and not exists(select 1 from public.expense_accounting_postings p
        where p.queue_id in (original.id,reversal.id) or
          (p.connection_id=original.connection_id and p.event_id in (original_event.id,reversal_event.id)))
  );
$$;

create or replace function private.cancel_unwritten_expense_reversals(p_event_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare v_event public.expense_accounting_events; v_pair record; v_marker jsonb; v_count integer:=0;
begin
  select * into v_event from public.expense_accounting_events where id=p_event_id;
  if not found then return 0; end if;
  -- Direct expense edits already hold the expense row. Never wait behind a
  -- finalizer that holds a queue row and is about to update that expense.
  -- Retry/enqueue calls try compaction again if this attempt is contended.
  perform q.id from public.accounting_sync_queue q
    where q.entity_type='expense' and q.company_id=v_event.company_id and q.entity_id=v_event.expense_id
    order by q.id for update nowait;
  for v_pair in
    select original.id as original_queue_id,reversal.id as reversal_queue_id,
      original_event.id as original_event_id,reversal_event.id as reversal_event_id,
      original.connection_id
    from public.expense_accounting_events reversal_event
    join public.expense_accounting_events original_event on original_event.id=reversal_event.original_event_id
    join public.accounting_sync_queue original on original.payload_snapshot->>'eventId'=original_event.id::text
    join public.accounting_sync_queue reversal on reversal.payload_snapshot->>'eventId'=reversal_event.id::text
      and reversal.connection_id=original.connection_id
    where reversal_event.company_id=v_event.company_id and reversal_event.expense_id=v_event.expense_id
      and original_event.company_id=v_event.company_id and original_event.expense_id=v_event.expense_id
      and reversal_event.kind='reversal' and original_event.kind in ('accrual','purchase','settlement')
      and reversal_event.sequence>original_event.sequence
      and original.entity_type='expense' and reversal.entity_type='expense'
      and original.source_table='expense_accounting_events' and reversal.source_table='expense_accounting_events'
      and original.operation='create' and reversal.operation='create'
      and original.company_id=v_event.company_id and reversal.company_id=v_event.company_id
      and original.entity_id=v_event.expense_id and reversal.entity_id=v_event.expense_id
      and original.provider=reversal.provider
      and original.status in ('pending','claimed','blocked','needs_review','failed')
      and reversal.status in ('pending','claimed','blocked','needs_review','failed')
      and original.external_id is null and original.provider_accepted_at is null
      and original.provider_request_id is null and original.idempotency_expires_at is null
      and reversal.external_id is null and reversal.provider_accepted_at is null
      and reversal.provider_request_id is null and reversal.idempotency_expires_at is null
      and not exists(select 1 from public.expense_accounting_postings p
        where p.queue_id in (original.id,reversal.id) or
          (p.connection_id=original.connection_id and p.event_id in (original_event.id,reversal_event.id)))
    order by reversal_event.sequence,original.connection_id
  loop
    v_marker:=jsonb_build_object('reason','superseded_before_write',
      'originalQueueId',v_pair.original_queue_id,'reversalQueueId',v_pair.reversal_queue_id,
      'originalEventId',v_pair.original_event_id,'reversalEventId',v_pair.reversal_event_id,
      'cancelledAt',clock_timestamp());
    update public.accounting_sync_queue set status='cancelled',locked_at=null,locked_by=null,
      last_error=null,updated_at=clock_timestamp(),
      payload_snapshot=payload_snapshot||jsonb_build_object('cancelledBeforeWrite',v_marker)
      where id in (v_pair.original_queue_id,v_pair.reversal_queue_id);
    v_count:=v_count+2;
  end loop;
  return v_count;
exception when lock_not_available then
  -- This subtransaction releases every acquired queue lock and changes no pair.
  return 0;
end; $$;
revoke all on function private.expense_queue_cancelled_before_write(uuid),
  private.cancel_unwritten_expense_reversals(uuid) from public,anon,authenticated,service_role;

create or replace function private.queue_expense_accounting_event(p_event_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_event public.expense_accounting_events; v_count integer;
begin
  select * into strict v_event from public.expense_accounting_events where id=p_event_id;
  insert into public.accounting_sync_queue(
    company_id,connection_id,provider,entity_type,entity_id,operation,
    source_table,source_action,source_updated_at,idempotency_key,payload_snapshot,created_at)
  select v_event.company_id,c.id,c.provider,'expense',v_event.expense_id,'create',
    'expense_accounting_events','insert',v_event.created_at,
    'expense-event:'||v_event.id::text||':'||c.id::text,
    jsonb_build_object('eventId',v_event.id,'providerEnvironment',v_event.connection_bindings->c.id::text->>'providerEnvironment',
      'configurationSnapshot',v_event.connection_bindings->c.id::text->'configuration',
      'categoryAccountSnapshot',v_event.connection_bindings->c.id::text->'categoryAccountId',
      'employeeIdSnapshot',v_event.connection_bindings->c.id::text->'employeeId',
      'projectMappingsSnapshot',v_event.connection_bindings->c.id::text->'projectMappings',
      'providerIdentitySnapshot',v_event.connection_bindings->c.id::text->'providerIdentity'),v_event.created_at
  from public.accounting_connections c
  join public.companies company on company.id=v_event.company_id and company.deleted_at is null
  where c.company_id=v_event.company_id::text and c.is_connected and c.sync_enabled
    and c.sync_direction in ('push_only','bidirectional') and c.provider in ('quickbooks','sage')
  on conflict do nothing;
  get diagnostics v_count = row_count;
  perform private.cancel_unwritten_expense_reversals(p_event_id);
  return v_count;
end; $$;

create or replace function private.append_expense_accounting_event(
  p_expense public.expenses,p_kind text,p_snapshot jsonb,p_original_event_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_bindings jsonb;
begin
  if p_original_event_id is not null and not exists (
    select 1 from public.expense_accounting_events e where e.id=p_original_event_id
      and e.company_id=p_expense.company_id and e.expense_id=p_expense.id and e.kind<>'reversal'
  ) then raise exception 'Expense reversal source mismatch' using errcode='23514'; end if;
  select coalesce(jsonb_object_agg(c.id::text,jsonb_build_object('configuration',s.configuration,'providerEnvironment',c.provider_environment,
    'categoryAccountId',m.external_account_id,'employeeId',p.external_employee_id,
    'projectMappings',(select coalesce(jsonb_object_agg(pm.project_id::text,pm.external_project_id),'{}'::jsonb)
      from public.expense_accounting_project_mappings pm
      join public.projects project on project.id=pm.project_id and project.company_id=p_expense.company_id
      where pm.connection_id=c.id and pm.company_id=p_expense.company_id
        and exists(select 1 from jsonb_array_elements(coalesce(p_snapshot->'allocations','[]'::jsonb)) a
          where a->>'project_id'=pm.project_id::text)),
    'providerIdentity',case c.provider when 'quickbooks' then c.realm_id_lookup else c.sage_business_id_lookup end)),'{}'::jsonb)
    into v_bindings from public.accounting_connections c
    left join public.expense_accounting_settings s on s.connection_id=c.id and s.company_id=p_expense.company_id
    left join public.expense_accounting_category_mappings m on m.connection_id=c.id and m.company_id=p_expense.company_id
      and m.category_id=p_expense.category_id
    left join public.expense_accounting_payee_mappings p on p.connection_id=c.id and p.company_id=p_expense.company_id
      and p.user_id=p_expense.submitted_by
    where c.company_id=p_expense.company_id::text and c.provider in ('quickbooks','sage');
  insert into public.expense_accounting_events(company_id,expense_id,kind,original_event_id,source_snapshot,connection_bindings)
  values(p_expense.company_id,p_expense.id,p_kind,p_original_event_id,
    p_snapshot||jsonb_build_object('recorded_at',clock_timestamp()),v_bindings) returning id into v_id;
  perform private.queue_expense_accounting_event(v_id);
  return v_id;
end; $$;

create or replace function private.capture_expense_accounting_state(p_expense public.expenses,p_prior_eligible boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_state private.expense_accounting_state;
  v_snapshot jsonb; v_allocations jsonb; v_eligible boolean;
  v_same boolean; v_event public.expense_accounting_events;
begin
  -- The expenses row is already locked by the source mutation. This state row
  -- is never locked before the expense by request/retry entry points.
  select coalesce(jsonb_agg(jsonb_build_object('project_id',a.project_id,
    'amount',a.amount::text,'percentage',a.percentage::text) order by a.id),'[]'::jsonb)
    into v_allocations from public.expense_project_allocations a where a.expense_id=p_expense.id;
  v_snapshot := jsonb_build_object('id',p_expense.id,'company_id',p_expense.company_id,
    'submitted_by',p_expense.submitted_by,'amount',p_expense.amount::text,'tax_amount',p_expense.tax_amount::text,
    'currency',p_expense.currency,'expense_date',p_expense.expense_date,'payment_method',p_expense.payment_method,
    'category_id',p_expense.category_id,'description',p_expense.description,'merchant_name',p_expense.merchant_name,
    'allocations',v_allocations);
  v_eligible := p_expense.deleted_at is null and p_expense.status in ('approved','reimbursed');
  select * into v_state from private.expense_accounting_state where expense_id=p_expense.id for update;
  if not found then
    insert into private.expense_accounting_state(expense_id,company_id,financial_snapshot,legacy_review_required)
      values(p_expense.id,p_expense.company_id,v_snapshot,p_prior_eligible or p_expense.accounting_sync_id is not null)
      returning * into v_state;
    if v_state.legacy_review_required then
      -- No implicit replay/backfill of pre-migration approvals. Existing
      -- external expense IDs cannot establish a safe journal/payment history.
      perform private.append_expense_accounting_event(p_expense,'review',
        v_snapshot||jsonb_build_object('review_reason','legacy_expense_history'));
    end if;
  end if;
  if v_state.company_id<>p_expense.company_id then
    raise exception 'Expense accounting company is immutable' using errcode='23514';
  end if;
  if v_state.legacy_review_required then return; end if;
  v_same := v_state.financial_snapshot=v_snapshot;
  if v_state.active_payment_id is not null and (
    not v_same or not v_eligible or
    (p_expense.payment_method is distinct from 'company_card' and p_expense.status<>'reimbursed')) then
    select * into strict v_event from public.expense_accounting_events where id=v_state.active_payment_id;
    perform private.append_expense_accounting_event(p_expense,'reversal',v_event.source_snapshot,v_event.id);
    v_state.active_payment_id:=null;
  end if;
  if v_state.active_accrual_id is not null and (not v_same or not v_eligible) then
    select * into strict v_event from public.expense_accounting_events where id=v_state.active_accrual_id;
    perform private.append_expense_accounting_event(p_expense,'reversal',v_event.source_snapshot,v_event.id);
    v_state.active_accrual_id:=null;
  end if;
  if v_eligible then
    if p_expense.payment_method='company_card' then
      if v_state.active_payment_id is null then
        v_state.active_payment_id:=private.append_expense_accounting_event(p_expense,'purchase',v_snapshot);
      end if;
    else
      if v_state.active_accrual_id is null then
        v_state.active_accrual_id:=private.append_expense_accounting_event(p_expense,'accrual',v_snapshot);
      end if;
      if p_expense.status='reimbursed' and v_state.active_payment_id is null then
        v_state.active_payment_id:=private.append_expense_accounting_event(p_expense,'settlement',v_snapshot,v_state.active_accrual_id);
      end if;
    end if;
  end if;
  update private.expense_accounting_state set financial_snapshot=v_snapshot,
    active_accrual_id=v_state.active_accrual_id,active_payment_id=v_state.active_payment_id
    where expense_id=p_expense.id;
end; $$;

create or replace function private.capture_expense_accounting_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_current public.expenses;
begin
  if tg_op='DELETE' then
    old.deleted_at:=coalesce(old.deleted_at,clock_timestamp());
    perform private.capture_expense_accounting_state(old,old.status in ('approved','reimbursed'));
    return old;
  end if;
  -- Pure sync-status/updated_at writes are not financial edits.
  if tg_op='INSERT' or row(new.company_id,new.submitted_by,new.status,new.amount,new.tax_amount,new.currency,
    new.expense_date,new.payment_method,new.category_id,new.description,new.merchant_name,new.deleted_at)
    is distinct from row(old.company_id,old.submitted_by,old.status,old.amount,old.tax_amount,old.currency,
    old.expense_date,old.payment_method,old.category_id,old.description,old.merchant_name,old.deleted_at) then
    -- Nested placement/auto-clear triggers can update the inserted row before
    -- this AFTER trigger runs. NEW is then stale: use the actual locked row.
    select * into strict v_current from public.expenses where id=new.id for update;
    perform private.capture_expense_accounting_state(v_current,
      case when tg_op='INSERT' then false else old.status in ('approved','reimbursed') and old.deleted_at is null end);
  end if;
  return new;
end; $$;
drop trigger if exists zz_capture_expense_accounting on public.expenses;
create trigger zz_capture_expense_accounting after insert or update or delete on public.expenses
  for each row execute function private.capture_expense_accounting_change();

create or replace function private.derive_expense_reimbursement_amount()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  select coalesce(sum(e.amount),0) into new.reimbursement_amount
    from public.expenses e where e.company_id=new.company_id and e.batch_id=new.id
      and e.deleted_at is null and e.status in ('approved','reimbursed')
      and e.payment_method is distinct from 'company_card';
  return new;
end; $$;
drop trigger if exists derive_expense_reimbursement_amount on public.expense_batches;
create trigger derive_expense_reimbursement_amount before insert or update on public.expense_batches
  for each row execute function private.derive_expense_reimbursement_amount();

create or replace function private.refresh_expense_reimbursement_amount()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_amount numeric;
begin
  for v_id in select distinct id from unnest(array[
    case when tg_op<>'DELETE' then new.batch_id end,
    case when tg_op<>'INSERT' then old.batch_id end]) id where id is not null order by id
  loop
    select coalesce(sum(e.amount),0) into v_amount from public.expenses e
      join public.expense_batches b on b.id=e.batch_id and b.company_id=e.company_id
      where e.batch_id=v_id and e.deleted_at is null and e.status in ('approved','reimbursed')
        and e.payment_method is distinct from 'company_card';
    update public.expense_batches set reimbursement_amount=v_amount
      where id=v_id and reimbursement_amount is distinct from v_amount;
  end loop;
  return null;
end; $$;
drop trigger if exists zz_refresh_expense_reimbursement_amount on public.expenses;
create trigger zz_refresh_expense_reimbursement_amount after insert or update or delete on public.expenses
  for each row execute function private.refresh_expense_reimbursement_amount();
revoke all on function private.derive_expense_reimbursement_amount(),private.refresh_expense_reimbursement_amount()
  from public,anon,authenticated,service_role;
-- Derived display values only. This does not create expense accounting events.
update public.expense_batches set reimbursement_amount=0 where reimbursement_amount is null;

-- Allocation writes already touch their expense under the canonical save lock.
-- Re-read the parent once all allocation rows from the transaction are visible.
create or replace function private.capture_expense_accounting_allocation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_exp public.expenses; v_id uuid;
begin
  for v_id in select distinct id from unnest(array[
    case when tg_op<>'DELETE' then new.expense_id end,
    case when tg_op<>'INSERT' then old.expense_id end]) id where id is not null order by id
  loop
    select * into v_exp from public.expenses where id=v_id for update;
    if found then perform private.capture_expense_accounting_state(v_exp,v_exp.status in ('approved','reimbursed')); end if;
  end loop;
  return null;
end; $$;
drop trigger if exists zz_capture_expense_accounting_allocation on public.expense_project_allocations;
create constraint trigger zz_capture_expense_accounting_allocation after insert or update or delete
  on public.expense_project_allocations deferrable initially deferred
  for each row execute function private.capture_expense_accounting_allocation();

create or replace function public.request_expense_accounting_sync(p_expense_id uuid,p_company_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='25ms' as $$
declare v_uid uuid; v_company uuid; v_locked_company uuid; v_batch_id uuid;
  v_exp public.expenses; v_event uuid; v_queued integer:=0;
begin
  v_uid:=private.get_current_user_id();
  select u.company_id into v_company from public.users u join public.companies c on c.id=u.company_id
    where u.id=v_uid and u.is_active and u.deleted_at is null and c.deleted_at is null;
  if v_company is null or not public.has_permission(v_uid,'expenses.approve','all') or
    (p_company_id is not null and p_company_id<>v_company) then
    raise exception 'Expense accounting access denied' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('save_expense_atomic:'||v_company::text,0));
  select context.actor_id,context.company_id into v_uid,v_locked_company
    from private.lock_expense_approver_context() context;
  if v_company is distinct from v_locked_company then
    raise exception 'Expense company changed during authorization' using errcode='40001';
  end if;
  select batch_id into v_batch_id from public.expenses where id=p_expense_id and company_id=v_company;
  if v_batch_id is not null then perform private.lock_expense_batch_for_approval(v_batch_id,v_company); end if;
  select * into v_exp from public.expenses where id=p_expense_id and company_id=v_company
    and deleted_at is null for update nowait;
  if not found then raise exception 'Expense unavailable' using errcode='42501'; end if;
  if v_exp.batch_id is distinct from v_batch_id then
    raise exception 'Expense changed during authorization' using errcode='40001';
  end if;
  perform private.capture_expense_accounting_state(v_exp,v_exp.status in ('approved','reimbursed'));
  for v_event in select id from public.expense_accounting_events
    where expense_id=v_exp.id and company_id=v_company order by sequence
  loop v_queued:=v_queued+private.queue_expense_accounting_event(v_event); end loop;
  return jsonb_build_object('status',case
    when exists(select 1 from private.expense_accounting_state where expense_id=v_exp.id and legacy_review_required) then 'needs_review'
    when exists(select 1 from public.accounting_sync_queue where entity_type='expense' and entity_id=v_exp.id and status in ('blocked','needs_review','failed')) then 'needs_review'
    when exists(select 1 from public.accounting_sync_queue where entity_type='expense' and entity_id=v_exp.id and status in ('pending','claimed')) then 'queued'
    when exists(select 1 from public.accounting_sync_queue where entity_type='expense' and entity_id=v_exp.id and status='succeeded') then 'synced'
    when v_exp.status not in ('approved','reimbursed') then 'not_required' else 'pending' end,'queued',v_queued);
end; $$;
revoke all on function public.request_expense_accounting_sync(uuid,uuid) from public;
grant execute on function public.request_expense_accounting_sync(uuid,uuid) to anon,authenticated;

create or replace function public.prepare_expense_accounting_write(
  p_queue_id uuid,p_worker_id text,p_payload jsonb,p_posting jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_queue public.accounting_sync_queue; v_event public.expense_accounting_events;
  v_posting public.expense_accounting_postings;
begin
  select * into v_queue from public.accounting_sync_queue where id=p_queue_id
    and entity_type='expense' and status='claimed' and locked_by=p_worker_id for update;
  if not found then raise exception 'Expense queue ownership lost' using errcode='40001'; end if;
  select * into v_event from public.expense_accounting_events where id=(v_queue.payload_snapshot->>'eventId')::uuid
    and company_id=v_queue.company_id and expense_id=v_queue.entity_id;
  if not found or v_event.kind='review' then raise exception 'Expense accounting review required' using errcode='23514'; end if;
  if exists(select 1 from public.accounting_sync_queue q
    join public.expense_accounting_events e on e.id::text=q.payload_snapshot->>'eventId'
    where q.entity_type='expense' and q.connection_id=v_queue.connection_id
      and e.expense_id=v_event.expense_id and e.sequence<v_event.sequence and q.status<>'succeeded'
      and not private.expense_queue_cancelled_before_write(q.id)) then
    raise exception 'Earlier expense accounting work must finish first' using errcode='40001';
  end if;
  perform c.id from public.accounting_connections c
    join public.companies company on company.id=v_queue.company_id and company.deleted_at is null
    where c.id=v_queue.connection_id
    and c.company_id=v_queue.company_id::text and c.provider=v_queue.provider
    and c.provider_environment=v_queue.payload_snapshot->>'providerEnvironment'
    and nullif(v_queue.payload_snapshot->>'providerIdentitySnapshot','') is not null
    and (case c.provider when 'quickbooks' then c.realm_id_lookup else c.sage_business_id_lookup end)
      =v_queue.payload_snapshot->>'providerIdentitySnapshot'
    and c.is_connected and c.sync_enabled and c.sync_direction in ('push_only','bidirectional')
    for share of c,company nowait;
  if not found then
    raise exception 'Expense accounting connection unavailable' using errcode='23514';
  end if;
  insert into public.expense_accounting_postings(event_id,connection_id,company_id,expense_id,queue_id,provider,payload,posting)
  values(v_event.id,v_queue.connection_id,v_queue.company_id,v_queue.entity_id,v_queue.id,v_queue.provider,p_payload,p_posting)
  on conflict(event_id,connection_id) do nothing;
  select * into strict v_posting from public.expense_accounting_postings
    where event_id=v_event.id and connection_id=v_queue.connection_id;
  if v_posting.queue_id<>v_queue.id then raise exception 'Expense posting queue mismatch' using errcode='23514'; end if;
  return to_jsonb(v_posting);
end; $$;

create or replace function public.finalize_expense_accounting_sync(
  p_queue_id uuid,p_worker_id text,p_external_id text,p_sync_token text default null,p_provider_updated_at timestamptz default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_queue public.accounting_sync_queue; v_company uuid; v_status text;
begin
  if nullif(btrim(p_external_id),'') is null then raise exception 'Provider evidence required' using errcode='23514'; end if;
  select company_id into v_company from public.accounting_sync_queue where id=p_queue_id and entity_type='expense';
  if v_company is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('save_expense_atomic:'||v_company::text,0));
  select * into v_queue from public.accounting_sync_queue where id=p_queue_id and entity_type='expense'
    and status='claimed' and locked_by=p_worker_id for update;
  if not found then return false; end if;
  update public.expense_accounting_postings set external_id=p_external_id,sync_token=p_sync_token,
    provider_updated_at=p_provider_updated_at where queue_id=v_queue.id and
    (external_id is null or external_id=p_external_id);
  if not found then raise exception 'Prepared expense posting unavailable' using errcode='23514'; end if;
  update public.accounting_sync_queue set status='succeeded',external_id=p_external_id,
    locked_by=null,locked_at=null,last_error=null,updated_at=clock_timestamp() where id=v_queue.id;
  select case when bool_or(status in ('blocked','needs_review','failed')) then 'error'
    when bool_or(status in ('pending','claimed')) then 'pending' else 'synced' end
    into v_status from public.accounting_sync_queue where entity_type='expense'
      and entity_id=v_queue.entity_id and company_id=v_company;
  update public.expenses set accounting_sync_status=v_status,
    accounting_sync_id=coalesce(accounting_sync_id,jsonb_build_object('protocol','expense-ledger-v1',
      'eventId',v_queue.payload_snapshot->>'eventId','externalId',p_external_id)::text),
    accounting_synced_at=case when v_status='synced' then clock_timestamp() else accounting_synced_at end
    where id=v_queue.entity_id and company_id=v_company;
  return true;
end; $$;
revoke all on function public.prepare_expense_accounting_write(uuid,text,jsonb,jsonb),
  public.finalize_expense_accounting_sync(uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.prepare_expense_accounting_write(uuid,text,jsonb,jsonb),
  public.finalize_expense_accounting_sync(uuid,text,text,text,timestamptz) to service_role;

drop function if exists public.save_expense_accounting_settings(uuid,uuid,jsonb,jsonb,jsonb,jsonb);
drop function if exists public.save_expense_accounting_settings(uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,text,text);
create or replace function public.save_expense_accounting_settings(
  p_actor_user_id uuid,p_connection_id uuid,p_configuration jsonb,
  p_category_mappings jsonb,p_payee_mappings jsonb,p_tax_mappings jsonb default null,
  p_expected_provider text default null,p_expected_environment text default null,p_expected_identity text default null,p_project_mappings jsonb default null)
returns void language plpgsql security definer set search_path='' set lock_timeout='1s' as $$
declare v_company uuid; v_provider text; v_mapping jsonb; v_id uuid; v_connection public.accounting_connections;
begin
  select u.company_id into v_company from public.users u join public.companies c on c.id=u.company_id
    where u.id=p_actor_user_id and u.is_active and u.deleted_at is null and c.deleted_at is null
    for share of u,c;
  if v_company is null or not public.has_permission(p_actor_user_id,'accounting.manage_connections','all')
    or not public.has_permission(p_actor_user_id,'expenses.approve','all') then
    raise exception 'Expense accounting settings access denied' using errcode='42501';
  end if;
  select * into v_connection from public.accounting_connections
    where id=p_connection_id and company_id=v_company::text and is_connected for update;
  if not found then raise exception 'Accounting connection unavailable' using errcode='42501'; end if;
  v_provider:=v_connection.provider;
  if p_expected_provider is distinct from v_provider
    or p_expected_environment is distinct from v_connection.provider_environment
    or nullif(btrim(p_expected_identity),'') is null
    or p_expected_identity is distinct from (case v_provider when 'quickbooks' then v_connection.realm_id_lookup else v_connection.sage_business_id_lookup end) then
    raise exception 'Accounting connection changed during settings validation' using errcode='40001';
  end if;
  if jsonb_typeof(p_configuration) is distinct from 'object'
    or jsonb_typeof(p_category_mappings) is distinct from 'array'
    or jsonb_typeof(p_payee_mappings) is distinct from 'array'
    or jsonb_array_length(p_category_mappings)>500 or jsonb_array_length(p_payee_mappings)>1000 then
    raise exception 'Invalid expense accounting settings' using errcode='22023';
  end if;
  -- The service validates provider account types against the exact provider
  -- catalogue before this transaction. SQL independently binds all OPS IDs.
  for v_mapping in select value from jsonb_array_elements(p_category_mappings) loop
    v_id:=(v_mapping->>'categoryId')::uuid;
    if not exists(select 1 from public.expense_categories where id=v_id and company_id=v_company) then
      raise exception 'Expense category unavailable' using errcode='42501';
    end if;
    if nullif(btrim(v_mapping->>'externalAccountId'),'') is null then
      raise exception 'Expense category account required' using errcode='22023';
    end if;
  end loop;
  for v_mapping in select value from jsonb_array_elements(p_payee_mappings) loop
    v_id:=(v_mapping->>'userId')::uuid;
    if not exists(select 1 from public.users u where u.id=v_id and u.company_id=v_company
      and ((u.is_active and u.deleted_at is null) or exists(select 1 from public.expense_accounting_payee_mappings m
        where m.connection_id=p_connection_id and m.company_id=v_company and m.user_id=u.id
          and m.external_employee_id=v_mapping->>'externalEmployeeId'))) then
      raise exception 'Expense submitter unavailable' using errcode='42501';
    end if;
    if v_provider<>'quickbooks' or nullif(btrim(v_mapping->>'externalEmployeeId'),'') is null then
      raise exception 'Expense employee mapping invalid' using errcode='22023';
    end if;
  end loop;
  if p_project_mappings is not null then
    if jsonb_typeof(p_project_mappings) is distinct from 'array' or jsonb_array_length(p_project_mappings)>1000 then
      raise exception 'Invalid expense project mappings' using errcode='22023';
    end if;
    for v_mapping in select value from jsonb_array_elements(p_project_mappings) loop
      v_id:=(v_mapping->>'projectId')::uuid;
      if not exists(select 1 from public.projects project where project.id=v_id and project.company_id=v_company
        and (project.deleted_at is null or exists(select 1 from public.expense_accounting_project_mappings m
          where m.connection_id=p_connection_id and m.company_id=v_company and m.project_id=project.id
            and m.external_project_id=v_mapping->>'externalProjectId'))) then
        raise exception 'Expense project unavailable' using errcode='42501';
      end if;
      if nullif(btrim(v_mapping->>'externalProjectId'),'') is null then
        raise exception 'Expense project mapping required' using errcode='22023';
      end if;
    end loop;
    delete from public.expense_accounting_project_mappings where connection_id=p_connection_id and company_id=v_company;
    insert into public.expense_accounting_project_mappings(connection_id,company_id,project_id,external_project_id)
      select p_connection_id,v_company,(value->>'projectId')::uuid,value->>'externalProjectId'
        from jsonb_array_elements(p_project_mappings);
  end if;
  insert into public.expense_accounting_settings(connection_id,company_id,configuration)
    values(p_connection_id,v_company,p_configuration)
    on conflict(connection_id) do update set configuration=excluded.configuration,updated_at=clock_timestamp()
      where expense_accounting_settings.company_id=excluded.company_id;
  if not found then raise exception 'Expense settings company mismatch' using errcode='42501'; end if;
  delete from public.expense_accounting_category_mappings where connection_id=p_connection_id and company_id=v_company;
  insert into public.expense_accounting_category_mappings(connection_id,company_id,category_id,external_account_id)
    select p_connection_id,v_company,(value->>'categoryId')::uuid,value->>'externalAccountId'
      from jsonb_array_elements(p_category_mappings);
  delete from public.expense_accounting_payee_mappings where connection_id=p_connection_id and company_id=v_company;
  insert into public.expense_accounting_payee_mappings(connection_id,company_id,user_id,external_employee_id)
    select p_connection_id,v_company,(value->>'userId')::uuid,value->>'externalEmployeeId'
      from jsonb_array_elements(p_payee_mappings);
  if p_tax_mappings is not null then
    if jsonb_typeof(p_tax_mappings)<>'array' or jsonb_array_length(p_tax_mappings)>100 then
      raise exception 'Invalid expense tax mappings' using errcode='22023';
    end if;
    delete from public.expense_accounting_tax_mappings where connection_id=p_connection_id and company_id=v_company;
    insert into public.expense_accounting_tax_mappings(company_id,connection_id,provider,tax_rate,external_tax_code_id)
      select v_company,p_connection_id,v_provider,(value->>'taxRate')::numeric,value->>'externalTaxCodeId'
      from jsonb_array_elements(p_tax_mappings);
  end if;

end; $$;
revoke all on function public.save_expense_accounting_settings(uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_expense_accounting_settings(uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,text,text,jsonb) to service_role;

revoke all on function private.queue_expense_accounting_event(uuid),
  private.append_expense_accounting_event(public.expenses,text,jsonb,uuid),
  private.capture_expense_accounting_state(public.expenses,boolean),
  private.capture_expense_accounting_change(),private.capture_expense_accounting_allocation()
  from public,anon,authenticated,service_role;

-- Explicit operator recovery can adopt corrected settings only before a payload
-- has been frozen or any provider acceptance evidence exists.
create or replace function public.retry_expense_accounting_before_write(p_actor_user_id uuid,p_queue_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='1s' as $$
declare v_company uuid; v_queue public.accounting_sync_queue;
  v_connection public.accounting_connections; v_event public.expense_accounting_events;
  v_configuration jsonb; v_category text; v_employee text; v_projects jsonb;
begin
  select u.company_id into v_company from public.users u join public.companies c on c.id=u.company_id
    where u.id=p_actor_user_id and u.is_active and u.deleted_at is null and c.deleted_at is null
    for share of u,c;
  if v_company is null or not public.has_permission(p_actor_user_id,'accounting.manage_connections','all')
    or not public.has_permission(p_actor_user_id,'expenses.approve','all') then
    raise exception 'Expense accounting retry access denied' using errcode='42501';
  end if;
  select * into v_queue from public.accounting_sync_queue where id=p_queue_id
    and company_id=v_company and entity_type='expense' and source_table='expense_accounting_events';
  if not found then raise exception 'Expense accounting work unavailable' using errcode='42501'; end if;
  perform private.cancel_unwritten_expense_reversals((v_queue.payload_snapshot->>'eventId')::uuid);
  select * into v_queue from public.accounting_sync_queue where id=p_queue_id
    and company_id=v_company and entity_type='expense' and source_table='expense_accounting_events'
    for update;
  if not found then raise exception 'Expense accounting work unavailable' using errcode='42501'; end if;
  if private.expense_queue_cancelled_before_write(v_queue.id) then
    return jsonb_build_object('queueId',p_queue_id,'status','cancelled');
  end if;
  if v_queue.status not in ('blocked','needs_review','failed') or v_queue.operation<>'create'
    or v_queue.provider_accepted_at is not null or v_queue.external_id is not null
    or v_queue.provider_request_id is not null or v_queue.idempotency_expires_at is not null
    or exists(select 1 from public.expense_accounting_postings where queue_id=p_queue_id) then
    raise exception 'Expense accounting reconciliation required before retry' using errcode='23514';
  end if;
  select * into v_event from public.expense_accounting_events
    where id::text=v_queue.payload_snapshot->>'eventId' and company_id=v_company and expense_id=v_queue.entity_id;
  if not found or v_event.kind='review' then
    raise exception 'Expense history requires reconciliation' using errcode='23514';
  end if;
  select * into v_connection from public.accounting_connections where id=v_queue.connection_id
    and company_id=v_company::text and provider=v_queue.provider and is_connected and sync_enabled
    and sync_direction in ('push_only','bidirectional') for share;
  if not found or v_connection.provider_environment is distinct from v_queue.payload_snapshot->>'providerEnvironment'
    or nullif(v_queue.payload_snapshot->>'providerIdentitySnapshot','') is null
    or (case v_connection.provider when 'quickbooks' then v_connection.realm_id_lookup else v_connection.sage_business_id_lookup end)
      is distinct from v_queue.payload_snapshot->>'providerIdentitySnapshot' then
    raise exception 'Original accounting connection must be restored' using errcode='23514';
  end if;
  select configuration into v_configuration from public.expense_accounting_settings
    where connection_id=v_connection.id and company_id=v_company;
  if v_configuration is null then raise exception 'Expense account setup required' using errcode='23514'; end if;
  select external_account_id into v_category from public.expense_accounting_category_mappings
    where connection_id=v_connection.id and company_id=v_company and category_id::text=v_event.source_snapshot->>'category_id';
  select external_employee_id into v_employee from public.expense_accounting_payee_mappings
    where connection_id=v_connection.id and company_id=v_company and user_id::text=v_event.source_snapshot->>'submitted_by';
  select coalesce(jsonb_object_agg(pm.project_id::text,pm.external_project_id),'{}'::jsonb) into v_projects
    from public.expense_accounting_project_mappings pm
    join public.projects project on project.id=pm.project_id and project.company_id=v_company
    where pm.connection_id=v_connection.id and pm.company_id=v_company
      and exists(select 1 from jsonb_array_elements(coalesce(v_event.source_snapshot->'allocations','[]'::jsonb)) a
        where a->>'project_id'=pm.project_id::text);
  update public.accounting_sync_queue set status='pending',attempts=0,run_after=clock_timestamp(),
    locked_at=null,locked_by=null,last_error=null,updated_at=clock_timestamp(),
    payload_snapshot=payload_snapshot||jsonb_build_object('configurationSnapshot',v_configuration,
      'categoryAccountSnapshot',v_category,'employeeIdSnapshot',v_employee,'projectMappingsSnapshot',v_projects,
      'retryAuthorizedBy',p_actor_user_id,'retryAuthorizedAt',clock_timestamp())
    where id=p_queue_id;
  return jsonb_build_object('queueId',p_queue_id,'status','pending');
end; $$;
revoke all on function public.retry_expense_accounting_before_write(uuid,uuid) from public,anon,authenticated;
grant execute on function public.retry_expense_accounting_before_write(uuid,uuid) to service_role;

-- The queue state and its review notification commit together. A worker crash
-- after marking review cannot silently lose the operator's recovery entry point.
create unique index if not exists notifications_expense_accounting_event_unique
  on public.notifications(user_id,company_id,dedupe_key)
  where dedupe_key like 'expense-accounting:%';
create or replace function private.notify_expense_accounting_review()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_key text;
begin
  if new.entity_type<>'expense' or (tg_op='UPDATE' and new.status is not distinct from old.status) then return new; end if;
  v_key:='expense-accounting:'||new.id::text;
  if new.status in ('succeeded','cancelled') then
    update public.notifications set resolved_at=clock_timestamp(),resolution_reason='accounting_'||new.status,
      persistent=false,is_read=true
      where company_id=new.company_id::text and dedupe_key=v_key and resolved_at is null;
  elsif new.status in ('blocked','needs_review','failed') then
    insert into public.notifications(user_id,company_id,type,title,body,expense_id,deep_link_type,
      is_read,persistent,action_url,action_label,dedupe_key,incident_version)
    select u.id::text,new.company_id::text,'accounting_sync','Expense sync needs review',
      'Review the expense in accounting settings.',new.entity_id::text,'accounting',false,true,
      '/settings?section=accounting&expenseConnection='||new.connection_id::text,'Review expenses',v_key,1
    from public.users u join public.companies c on c.id=u.company_id
    where u.company_id=new.company_id and u.is_active and u.deleted_at is null and c.deleted_at is null
      and public.has_permission(u.id,'accounting.manage_connections','all')
      and public.has_permission(u.id,'expenses.approve','all')
    on conflict(user_id,company_id,dedupe_key) where dedupe_key like 'expense-accounting:%'
    do update set title=excluded.title,body=excluded.body,is_read=false,persistent=true,
      resolved_at=null,resolved_by=null,resolution_reason=null,
      action_url=excluded.action_url,action_label=excluded.action_label,
      incident_version=coalesce(notifications.incident_version,0)+1;
  end if;
  return new;
end; $$;
drop trigger if exists notify_expense_accounting_review on public.accounting_sync_queue;
create trigger notify_expense_accounting_review after insert or update of status on public.accounting_sync_queue
  for each row execute function private.notify_expense_accounting_review();
revoke all on function private.notify_expense_accounting_review() from public,anon,authenticated,service_role;

-- Preserve the complete P4 authority/retry boundary; only company-card eligibility changes.
create or replace function private.execute_expense_decision(p_action text, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
set lock_timeout = '25ms'
as $function$
declare
  v_uid uuid;
  v_company_id uuid;
  v_lock_company_id uuid;
  v_batch_id uuid;
  v_batch public.expense_batches;
  v_exp public.expenses;
  v_attempt integer;
begin
  if p_action is null or p_action not in ('approve', 'early_clear', 'pay', 'unpay') then
    raise exception 'Unsupported expense decision' using errcode = '22023';
  end if;
  for v_attempt in 1..10 loop
    begin
      v_uid := private.get_current_user_id();
      v_lock_company_id := private.get_user_company_id();
      if v_uid is null or v_lock_company_id is null
         or not public.has_permission(v_uid, 'expenses.approve', 'all') then
        raise exception 'You do not have permission to approve expenses.' using errcode = '42501';
      end if;
      -- Same namespace and ordering as the deployed save_expense_atomic path.
      -- No actor, expense, batch, or revision row lock is held before this lock.
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('save_expense_atomic:' || v_lock_company_id::text, 0)
      );
      select context.actor_id, context.company_id into v_uid, v_company_id
      from private.lock_expense_approver_context() context;
      if v_company_id is distinct from v_lock_company_id then
        raise exception 'Expense company changed during authorization' using errcode = '40001';
      end if;

      if p_action = 'early_clear' then
        -- Discover the parent before taking an expense lock, then reread the
        -- locked row. A concurrent move restarts with its new company/parent.
        select expense.batch_id into v_batch_id from public.expenses expense
        where expense.id = p_target_id and expense.company_id = v_company_id;
        if not found then
          raise exception 'This expense is not available.' using errcode = '42501';
        end if;
        if v_batch_id is not null then
          perform private.lock_expense_batch_for_approval(v_batch_id, v_company_id);
        end if;
        select expense.* into v_exp from public.expenses expense
        where expense.id = p_target_id and expense.company_id = v_company_id
        for update nowait;
        if not found then
          raise exception 'This expense is not available.' using errcode = '42501';
        end if;
        if v_exp.batch_id is distinct from v_batch_id then
          raise exception 'This expense changed. Try again.' using errcode = '40001';
        end if;
        update public.expenses set status = 'approved', updated_at = now()
        where id = p_target_id and company_id = v_company_id;
        if v_exp.batch_id is not null then
          perform public.recalculate_expense_batch_total(v_exp.batch_id);
        end if;
        insert into public.notifications(user_id, company_id, type, title, body, expense_id, deep_link_type, action_url, action_label, dedupe_key)
        values (v_exp.submitted_by::text, v_exp.company_id::text, 'expense_approved', 'Expense approved',
          coalesce(v_exp.merchant_name, 'Expense') || ' (' || to_char(v_exp.amount, 'FM999G999G990D00') || ') was cleared',
          v_exp.id::text, 'expense', '/accounting?tab=expenses', 'VIEW', 'expense_cleared:' || v_exp.id)
        on conflict do nothing;
      else
        v_batch := private.lock_expense_batch_for_approval(p_target_id, v_company_id);
        if p_action = 'approve' then
          update public.expenses set status = 'approved', updated_at = now()
          where batch_id = p_target_id and company_id = v_company_id
            and deleted_at is null and status not in ('rejected', 'approved', 'reimbursed');
          update public.expense_batches set status = 'approved', reviewed_by = v_uid, reviewed_at = now()
          where id = p_target_id and company_id = v_company_id;
          perform public.recalculate_expense_batch_total(p_target_id);
        elsif p_action = 'pay' then
          if v_batch.status not in ('approved', 'partially_approved', 'auto_approved') then
            raise exception 'mark_expense_batch_paid: batch % is %, only approved envelopes can be paid out', p_target_id, v_batch.status;
          end if;
          if v_batch.paid_at is not null then
            raise exception 'mark_expense_batch_paid: batch % is already paid out', p_target_id;
          end if;
          if not exists(select 1 from public.expenses e where e.batch_id=p_target_id
            and e.company_id=v_company_id and e.deleted_at is null and e.status='approved'
            and e.payment_method is distinct from 'company_card' and e.amount>0) then
            raise exception 'This envelope has no crew reimbursement due' using errcode='22023';
          end if;
          update public.expenses set status = 'reimbursed', updated_at = now()
          where batch_id = p_target_id and company_id = v_company_id
            and deleted_at is null and status = 'approved' and payment_method is distinct from 'company_card';
          update public.expense_batches set paid_at = now(), paid_by = v_uid
          where id = p_target_id and company_id = v_company_id;
        else
          if v_batch.paid_at is null then
            raise exception 'unmark_expense_batch_paid: batch % is not paid out', p_target_id;
          end if;
          update public.expenses set status = 'approved', updated_at = now()
          where batch_id = p_target_id and company_id = v_company_id
            and deleted_at is null and status = 'reimbursed';
          update public.expense_batches set paid_at = null, paid_by = null
          where id = p_target_id and company_id = v_company_id;
        end if;
      end if;
      return;
    exception when lock_not_available or serialization_failure then
      -- Roll back the COMPLETE decision, including revision/placement triggers,
      -- notifications and advisory locks. Direct table writers do not take the
      -- save advisory lock and may hold a revision before seeking our parent.
      -- The function-local lock_timeout bounds those downstream waits too.
      null;
    end;
    -- Every attempt's locks and mutations are gone before this wait.
    if v_attempt < 10 then
      perform pg_catalog.pg_sleep(0.01 * v_attempt);
    end if;
  end loop;
  raise exception 'Expenses are being updated. Try again.' using errcode = '40001';
end;
$function$;

commit;
