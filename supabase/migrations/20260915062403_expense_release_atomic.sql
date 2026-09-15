-- PREPARE ONLY. Requires separate migration authorization.
BEGIN;
-- Read-only assertions; also included at the start of the atomic install.
-- Baseline captured 2026-09-15T03:05:51.671Z for project ijeekuhbatykdomumfjx.
-- No catalog assertion is a lock against a parallel privileged DDL release.
DO $expense_release_baseline$
DECLARE
  mismatch text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Expense release requires the reviewed postgres migration owner';
  END IF;
  WITH expected(schema_name,function_name,identity_arguments,expected_md5) AS (VALUES
    ('private', 'get_current_user_id', '', '127ffd06387933500d95f96aba24b605'),
    ('private', 'get_user_company_id', '', '3de642ffe4b81ee8827c1cc6507f85c4'),
    ('private', 'current_user_is_admin', '', '71fedd6dc3d8226af0b506dcfce72dd8'),
    ('private', 'current_user_scope_for', 'p_permission text', '2ac60f997a0ac6de618bef5ff7aa5592'),
    ('private', 'current_user_has_permission', 'p_permission text, p_min_scope text', '43eb70a695fbf7b8efb38fd40f9c57c3'),
    ('public', 'has_permission', 'p_user_id uuid, p_permission text, p_required_scope text', '2a04ca2eb341948215285025249f48f9'),
    ('private', 'enforce_expense_edit_authority', '', 'a489f4f6506516e5934ff08f8fba69ad'),
    ('public', 'save_expense_atomic', 'p_command jsonb', 'aebfc5e480082b8160de4c6cc4b6fbb3'),
    ('public', 'approve_expense_batch', 'p_batch_id uuid', '87bc087970d0c1fb3f36313836869d66'),
    ('public', 'early_clear_expense_line', 'p_expense_id uuid', '9b271925be5fe9e9ab8c6ca67cf1115c'),
    ('public', 'mark_expense_batch_paid', 'p_batch_id uuid', '0ca6d6ae5d05d8283bcc3bb67b8436b5'),
    ('public', 'unmark_expense_batch_paid', 'p_batch_id uuid', '981f644ded66f43707d800d7400ef6ce'),
    ('public', 'recalculate_expense_batch_total', 'p_batch_id uuid', '8781e28a7a0485dc02b1d06eefcc8a22'),
    ('public', 'place_expense', 'p_expense_id uuid', '69ae7eaa26297db59646c704ea454712'),
    ('public', 'tg_place_expense', '', '2a9d3575dd23507040a31cb49dc69825')
  )
  SELECT e.schema_name || '.' || e.function_name INTO mismatch
  FROM expected e
  LEFT JOIN pg_catalog.pg_namespace n ON n.nspname=e.schema_name
  LEFT JOIN pg_catalog.pg_proc p ON p.pronamespace=n.oid AND p.proname=e.function_name
    AND pg_catalog.pg_get_function_identity_arguments(p.oid)=e.identity_arguments
  WHERE p.oid IS NULL
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) IS DISTINCT FROM e.expected_md5
    OR pg_catalog.pg_get_userbyid(p.proowner) IS DISTINCT FROM 'postgres'
  LIMIT 1;
  IF mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'Expense release source baseline changed: %', mismatch;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['public.expense_accounting_settings','public.expense_accounting_payee_mappings','public.expense_accounting_tax_mappings','public.expense_accounting_category_mappings','public.expense_accounting_project_mappings','public.expense_accounting_events','public.expense_accounting_postings','private.expense_accounting_state','private.expense_correction_requests','private.expense_correction_pending','private.expense_correction_scope']) AS target(name)
    WHERE pg_catalog.to_regclass(target.name) IS NOT NULL)
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname || '.' || p.proname = ANY(ARRAY['private.lock_expense_approver_context','private.lock_expense_batch_for_approval','private.execute_expense_decision','public.request_expense_accounting_sync','public.retry_expense_accounting_before_write','public.correct_expense_for_review','public.list_expense_corrections','private.derive_expense_reimbursement_amount','private.refresh_expense_reimbursement_amount','private.invalidate_expense_accounting_connection_binding','private.enforce_expense_accounting_authority','private.enforce_expense_accounting_related_authority','private.expense_queue_cancelled_before_write','private.cancel_unwritten_expense_reversals','private.queue_expense_accounting_event','private.append_expense_accounting_event','private.capture_expense_accounting_state','private.capture_expense_accounting_change','private.capture_expense_accounting_allocation','public.prepare_expense_accounting_write','public.finalize_expense_accounting_sync','public.save_expense_accounting_settings','private.notify_expense_accounting_review','private.expense_correction_content','private.expense_correction_snapshot','private.immutable_expense_correction','private.correct_expense_for_review','private.list_expense_corrections']))
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid='public.expense_batches'::regclass
      AND a.attname='reimbursement_amount' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'Expense release baseline is already installed or partially changed';
  END IF;
END;
$expense_release_baseline$;


-- Constituent: supabase/migrations/20260912012607_expense_decision_company_authority.sql
-- Source SHA256: 07b6791dbeb19e365d20361242d5cb1103cff6b5037ce0a56d3c4e5a3b3d6cef
-- Keep the shipped void(uuid) decision APIs and existing approval/payout effects.
-- has_permission validates the actor's own company, not the target company.
-- Recalculation already rejects ordinary foreign approvals; payout has no such
-- dependency, and an id-only expense batch FK permits mixed-company children.


create or replace function private.lock_expense_approver_context()
returns table(actor_id uuid, company_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.get_current_user_id();
  v_company_id uuid;
begin
  -- Hold membership and company state stable until the decision commits.
  select actor.company_id into v_company_id
  from public.users actor
  join public.companies company on company.id = actor.company_id
  where actor.id = v_actor_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false)
    and company.deleted_at is null
  for share of actor, company;

  -- The row lock may have waited behind a login-identity or membership edit.
  -- Re-resolve this request's JWT after the wait before trusting the captured
  -- actor. The held actor/company locks keep this verified binding stable.
  if not found
     or v_actor_id is distinct from private.get_current_user_id()
     or v_company_id is distinct from private.get_user_company_id()
     or not public.has_permission(v_actor_id, 'expenses.approve', 'all') then
    raise exception 'You do not have permission to approve expenses.' using errcode = '42501';
  end if;
  return query select v_actor_id, v_company_id;
end;
$function$;

create or replace function private.lock_expense_batch_for_approval(p_batch_id uuid, p_company_id uuid)
returns public.expense_batches
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_batch public.expense_batches;
begin
  select batch.* into v_batch
  from public.expense_batches batch
  where batch.id = p_batch_id and batch.company_id = p_company_id
  for update nowait;
  if not found then
    raise exception 'This expense batch is not available.' using errcode = '42501';
  end if;
  -- Exclude new FK references and hold existing child membership stable.
  -- Child-first writers must never wait behind a blocking parent/child cycle.
  perform expense.id from public.expenses expense
  where expense.batch_id = p_batch_id order by expense.id
  for update nowait;
  if exists (
    select 1 from public.expenses expense
    where expense.batch_id = p_batch_id
      and expense.company_id is distinct from p_company_id
  ) then
    raise exception 'This expense batch contains expenses from another company.' using errcode = '42501';
  end if;
  return v_batch;
end;
$function$;

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
          update public.expenses set status = 'reimbursed', updated_at = now()
          where batch_id = p_target_id and company_id = v_company_id
            and deleted_at is null and status = 'approved';
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

revoke all on function private.lock_expense_approver_context() from public, anon, authenticated, service_role;
revoke all on function private.lock_expense_batch_for_approval(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.execute_expense_decision(text, uuid) from public, anon, authenticated, service_role;

create or replace function public.approve_expense_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.execute_expense_decision('approve', p_batch_id);
end;
$function$;

create or replace function public.early_clear_expense_line(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.execute_expense_decision('early_clear', p_expense_id);
end;
$function$;

create or replace function public.mark_expense_batch_paid(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.execute_expense_decision('pay', p_batch_id);
end;
$function$;

create or replace function public.unmark_expense_batch_paid(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.execute_expense_decision('unpay', p_batch_id);
end;
$function$;

-- CREATE OR REPLACE preserves public RPC ACLs, including released anon lanes.
-- The private dispatcher's SET lock_timeout is restored automatically on return
-- or error, so the caller's remaining statements retain their original setting.



-- Constituent: supabase/migrations/20260912203328_expense_accounting_lifecycle.sql
-- Source SHA256: 77b420827c616996a062f35787e6bb257141b1c7da468a4253a61536ee922e23
-- Local only. Requires 20260912012607_expense_decision_company_authority.
-- Expense decisions create immutable work; no provider is called by PostgreSQL.


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




-- Constituent: supabase/migrations/20260914200910_expense_payroll_reimbursement_projection.sql
-- Source SHA256: 78db2cee099061cd5d31be11a8de4c174cbb6022a0c66c590f08feb53902dc0b
-- Local additive compatibility; requires 20260912203328_expense_accounting_lifecycle.sql.
-- Exact production function fetched 2026-09-14; only reimbursement amount and line eligibility change.
-- Preserve authority, grant/revision checks, bounds, response shape, volatility and execution ACL.

do $$ begin
  if to_regprocedure('public.read_agent_payroll_readiness_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,timestamp with time zone,date,integer,integer,integer,integer)') is null then
    raise exception 'Existing payroll readiness function must be installed first';
  end if;
  if md5(pg_get_functiondef('public.read_agent_payroll_readiness_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,timestamp with time zone,date,integer,integer,integer,integer)'::regprocedure)) not in
    ('c3e517bcc781f6866601c5966fa0b58d','f2e32a360886d5fed5040c5eb99b76c6') then
    raise exception 'Payroll readiness function changed; review compatibility migration before applying';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='expense_batches' and column_name='reimbursement_amount' and data_type='numeric') then
    raise exception 'Expense reimbursement projection migration must be installed first';
  end if;
  -- Invalidate read evidence once when the owed-amount semantics change.
  if md5(pg_get_functiondef('public.read_agent_payroll_readiness_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,timestamp with time zone,date,integer,integer,integer,integer)'::regprocedure))='c3e517bcc781f6866601c5966fa0b58d' then
    update private.agent_read_domain_revisions set source_revision=source_revision+1,updated_at=clock_timestamp()
      where domain='payroll_readiness';
  end if;
end; $$;

CREATE OR REPLACE FUNCTION public.read_agent_payroll_readiness_as_system(p_actor_user_id uuid, p_company_id uuid, p_oauth_grant_id uuid, p_oauth_client_id uuid, p_grant_revision text, p_granted_scope_ceiling text[], p_permission_snapshot_revision text, p_capability_manifest_revision text, p_exposure_revision text, p_capability_id text, p_capability_revision text, p_observed_at timestamp with time zone, p_target_date date, p_recurring_obligation_limit integer, p_reimbursement_batch_limit integer, p_receivable_limit integer, p_payer_history_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_timezone text;
  v_currency_code text;
  v_business_date date;
  v_company_revision bigint;
  v_payroll_revision bigint;
  v_settings jsonb := 'null'::jsonb;
  v_recurring jsonb := '[]'::jsonb;
  v_batches jsonb := '[]'::jsonb;
  v_receivables jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
  v_recurring_count integer := 0;
  v_batch_count integer := 0;
  v_receivable_count integer := 0;
  v_history_count integer := 0;
begin
  perform private.assert_agent_payroll_readiness_authority(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_capability_manifest_revision,
    p_exposure_revision,
    p_capability_id,
    p_capability_revision
  );

  if p_observed_at is null
     or not pg_catalog.isfinite(p_observed_at)
     or p_observed_at > pg_catalog.statement_timestamp() + interval '5 minutes'
     or p_target_date is null
     or not pg_catalog.isfinite(p_target_date)
     or p_recurring_obligation_limit is distinct from 40
     or p_reimbursement_batch_limit is distinct from 50
     or p_receivable_limit is distinct from 100
     or p_payer_history_limit is distinct from 500 then
    raise exception 'AGENT_PAYROLL_READINESS_INPUT_INVALID'
      using errcode = '22023';
  end if;

  select company.timezone,
         pg_catalog.upper(pg_catalog.btrim(company.currency_code))
    into v_timezone, v_currency_code
  from public.companies company
  where company.id = p_company_id
    and company.deleted_at is null;

  if v_timezone is null
     or not exists (
       select 1
       from pg_catalog.pg_timezone_names timezone_row
       where timezone_row.name = v_timezone
     )
     or v_currency_code is null
     or v_currency_code !~ '^[A-Z]{3}$' then
    raise exception 'AGENT_PAYROLL_READINESS_COMPANY_CONTEXT_INVALID'
      using errcode = '22000';
  end if;

  v_business_date := (p_observed_at at time zone v_timezone)::date;
  if p_target_date < v_business_date
     or p_target_date > v_business_date + 93 then
    raise exception 'AGENT_PAYROLL_READINESS_TARGET_DATE_INVALID'
      using errcode = '22023';
  end if;

  select revision.source_revision
    into v_company_revision
  from private.agent_read_domain_revisions revision
  where revision.company_id = p_company_id
    and revision.domain = 'company';
  select revision.source_revision
    into v_payroll_revision
  from private.agent_read_domain_revisions revision
  where revision.company_id = p_company_id
    and revision.domain = 'payroll_readiness';
  if v_company_revision is null or v_payroll_revision is null then
    raise exception 'AGENT_PAYROLL_READINESS_SOURCE_REVISION_MISSING'
      using errcode = '55000';
  end if;

  select pg_catalog.jsonb_build_object(
           'id', settings.id,
           'cash_balance', case
             when pg_catalog.lower(settings.forecast_current_balance::text)
               in ('nan', 'infinity', '-infinity')
               or pg_catalog.length(settings.forecast_current_balance::text) > 64
               then '__invalid__'
             else settings.forecast_current_balance::text
           end,
           'cash_balance_updated_at', case
             when settings.forecast_balance_updated_at is null then null
             when not pg_catalog.isfinite(
               settings.forecast_balance_updated_at
             ) or extract(
               year from settings.forecast_balance_updated_at at time zone 'UTC'
             ) not between 1 and 9999 then '__invalid__'
             else pg_catalog.to_char(
               settings.forecast_balance_updated_at at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
             )
           end,
           'obligations_confirmed_through',
             case
               when settings.forecast_obligations_confirmed_through is null
                 then null
               when not pg_catalog.isfinite(
                 settings.forecast_obligations_confirmed_through
               ) or extract(
                 year from settings.forecast_obligations_confirmed_through
               ) not between 1 and 9999 then '__invalid__'
               else settings.forecast_obligations_confirmed_through::text
             end,
           'obligations_confirmed_at', case
             when settings.forecast_obligations_confirmed_at is null then null
             when not pg_catalog.isfinite(
               settings.forecast_obligations_confirmed_at
             ) or extract(
               year from settings.forecast_obligations_confirmed_at at time zone 'UTC'
             ) not between 1 and 9999 then '__invalid__'
             else pg_catalog.to_char(
               settings.forecast_obligations_confirmed_at at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
             )
           end
         )
    into v_settings
  from public.expense_settings settings
  where settings.company_id = p_company_id;
  v_settings := coalesce(v_settings, 'null'::jsonb);

  with candidate as materialized (
    select recurring.id,
           recurring.amount,
           case
             when pg_catalog.upper(pg_catalog.btrim(recurring.currency)) =
               v_currency_code then v_currency_code
             else '__mismatch__'
           end as currency,
           case
             when pg_catalog.lower(pg_catalog.btrim(recurring.cadence)) in (
               'weekly', 'biweekly', 'monthly', 'quarterly', 'annually'
             ) then pg_catalog.lower(pg_catalog.btrim(recurring.cadence))
             else '__invalid__'
           end as cadence,
           recurring.next_due_date,
           recurring.end_date,
           recurring.obligation_kind,
           recurring.due_time_local,
           recurring.updated_at
    from public.recurring_expenses recurring
    where recurring.company_id = p_company_id
      and recurring.deleted_at is null
      and (
        not pg_catalog.isfinite(recurring.next_due_date)
        or extract(year from recurring.next_due_date)
          not between 1 and 9999
        or recurring.next_due_date <= p_target_date
      )
    order by recurring.next_due_date, recurring.id
    limit p_recurring_obligation_limit + 1
  ), retained as materialized (
    select * from candidate
    order by next_due_date, id
    limit p_recurring_obligation_limit
  )
  select least((select count(*) from candidate),
               p_recurring_obligation_limit + 1),
         coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'id', retained.id,
             'amount', case
               when pg_catalog.lower(retained.amount::text)
                 in ('nan', 'infinity', '-infinity')
                 or pg_catalog.length(retained.amount::text) > 64
                 then '__invalid__'
               else retained.amount::text
             end,
             'currency', retained.currency,
             'cadence', retained.cadence,
             'next_due_date', case
               when pg_catalog.isfinite(retained.next_due_date)
                 and extract(year from retained.next_due_date)
                   between 1 and 9999
                 then retained.next_due_date::text
               else '__invalid__'
             end,
             'end_date', case
               when retained.end_date is null then null
               when pg_catalog.isfinite(retained.end_date)
                 and extract(year from retained.end_date)
                   between 1 and 9999
                 then retained.end_date::text
               else '__invalid__'
             end,
             'obligation_kind', retained.obligation_kind,
             'due_time_local', case
               when retained.due_time_local is null then null
               else pg_catalog.to_char(retained.due_time_local, 'HH24:MI:SS.US')
             end,
             'updated_at', case
               when pg_catalog.isfinite(retained.updated_at)
                 and extract(
                   year from retained.updated_at at time zone 'UTC'
                 ) between 1 and 9999
                 then pg_catalog.to_char(
                   retained.updated_at at time zone 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                 )
               else '__invalid__'
             end
           ) order by retained.next_due_date, retained.id
         ), '[]'::jsonb)
    into v_recurring_count, v_recurring
  from retained;

  with candidate as materialized (
    select batch.id,
           batch.reimbursement_amount as owed_amount,
           coalesce(lines.line_count, 0) as line_count,
           coalesce(lines.currency_codes, array[]::text[]) as currency_codes,
           coalesce(batch.reviewed_at, batch.created_at, '-infinity'::timestamptz)
             as ordered_at
    from public.expense_batches batch
    left join lateral (
      select least(count(*), 10000::bigint)::integer as line_count,
             pg_catalog.array_agg(distinct case
               when pg_catalog.upper(pg_catalog.btrim(expense.currency)) =
                 v_currency_code then v_currency_code
               else '__mismatch__'
             end order by case
               when pg_catalog.upper(pg_catalog.btrim(expense.currency)) =
                 v_currency_code then v_currency_code
               else '__mismatch__'
             end) as currency_codes
      from public.expenses expense
      where expense.company_id = p_company_id
        and expense.batch_id = batch.id
        and expense.deleted_at is null
        and expense.status in ('approved','reimbursed')
        and expense.payment_method is distinct from 'company_card'
    ) lines on true
    where batch.company_id = p_company_id
      and batch.status in ('approved', 'partially_approved', 'auto_approved')
      and batch.paid_at is null
      and (batch.reimbursement_amount is null or batch.reimbursement_amount <> 0 or coalesce(lines.line_count,0)>0)
    order by ordered_at, batch.id
    limit p_reimbursement_batch_limit + 1
  ), retained as materialized (
    select * from candidate
    order by ordered_at, id
    limit p_reimbursement_batch_limit
  )
  select least((select count(*) from candidate),
               p_reimbursement_batch_limit + 1),
         coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'id', retained.id,
             'owed_amount', case
               when pg_catalog.lower(retained.owed_amount::text)
                 in ('nan', 'infinity', '-infinity')
                 or pg_catalog.length(retained.owed_amount::text) > 64
                 then '__invalid__'
               else retained.owed_amount::text
             end,
             'line_count', retained.line_count,
             'currency_codes', pg_catalog.to_jsonb(retained.currency_codes)
           ) order by retained.ordered_at, retained.id
         ), '[]'::jsonb)
    into v_batch_count, v_batches
  from retained;

  with payment_totals as materialized (
    select payment.invoice_id,
           coalesce(pg_catalog.sum(payment.amount), 0::numeric) as paid_amount
    from public.payments payment
    where payment.company_id = p_company_id
      and payment.voided_at is null
      and payment.payment_date <= v_business_date
    group by payment.invoice_id
  ), candidate as materialized (
    select invoice.id as invoice_id,
           invoice.client_id as payer_id,
           invoice.total,
           invoice.amount_paid,
           invoice.balance_due,
           greatest(
             invoice.total - coalesce(payment_totals.paid_amount, 0::numeric),
             0::numeric
           ) as calculated_balance,
           invoice.due_date,
           invoice.status,
           invoice.sent_at,
           (
             exists (
               select 1 from public.invoices duplicate
               where duplicate.company_id = p_company_id
                 and duplicate.id <> invoice.id
                 and duplicate.deleted_at is null
                 and (
                   (invoice.qb_id is not null and duplicate.qb_id = invoice.qb_id)
                   or (invoice.sage_id is not null and duplicate.sage_id = invoice.sage_id)
                 )
             )
             or exists (
               select 1
               from public.payments payment
               join public.payments duplicate
                on duplicate.company_id = payment.company_id
                and duplicate.id <> payment.id
                and duplicate.voided_at is null
                and duplicate.payment_date <= v_business_date
                and (
                  (payment.qb_id is not null and duplicate.qb_id = payment.qb_id)
                  or (payment.sage_id is not null and duplicate.sage_id = payment.sage_id)
                  or (
                    payment.stripe_payment_intent is not null
                    and duplicate.stripe_payment_intent = payment.stripe_payment_intent
                  )
                )
               where payment.company_id = p_company_id
                 and payment.invoice_id = invoice.id
                 and payment.voided_at is null
                 and payment.payment_date <= v_business_date
             )
           ) as identity_conflict
    from public.invoices invoice
    left join payment_totals on payment_totals.invoice_id = invoice.id
    where invoice.company_id = p_company_id
      and invoice.deleted_at is null
      and invoice.status in ('sent', 'awaiting_payment', 'partially_paid', 'past_due')
    order by invoice.due_date, invoice.id
    limit p_receivable_limit + 1
  ), retained as materialized (
    select * from candidate
    order by due_date, invoice_id
    limit p_receivable_limit
  )
  select least((select count(*) from candidate), p_receivable_limit + 1),
         coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'invoice_id', retained.invoice_id,
             'payer_id', retained.payer_id,
             'total_amount', case
               when pg_catalog.lower(retained.total::text)
                 in ('nan', 'infinity', '-infinity')
                 or pg_catalog.length(retained.total::text) > 64
                 then '__invalid__'
               else retained.total::text
             end,
             'stored_amount_paid', case
               when pg_catalog.lower(retained.amount_paid::text)
                 in ('nan', 'infinity', '-infinity')
                 or pg_catalog.length(retained.amount_paid::text) > 64
                 then '__invalid__'
               else retained.amount_paid::text
             end,
             'stored_balance_due', case
               when pg_catalog.lower(retained.balance_due::text)
                 in ('nan', 'infinity', '-infinity')
                 or pg_catalog.length(retained.balance_due::text) > 64
                 then '__invalid__'
               else retained.balance_due::text
             end,
             'calculated_balance', case
               when pg_catalog.lower(retained.calculated_balance::text)
                 in ('nan', 'infinity', '-infinity')
                 or pg_catalog.length(retained.calculated_balance::text) > 64
                 then '__invalid__'
               else retained.calculated_balance::text
             end,
             'due_date', case
               when pg_catalog.isfinite(retained.due_date)
                 and extract(year from retained.due_date)
                   between 1 and 9999
                 then retained.due_date::text
               else '__invalid__'
             end,
             'status', retained.status,
             'sent_at', case
               when retained.sent_at is null then null
               when not pg_catalog.isfinite(retained.sent_at)
                 or extract(
                   year from retained.sent_at at time zone 'UTC'
                 ) not between 1 and 9999
                 then '__invalid__'
               else pg_catalog.to_char(
                 retained.sent_at at time zone 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
               )
             end,
             'identity_conflict', retained.identity_conflict
           ) order by retained.due_date, retained.invoice_id
         ), '[]'::jsonb)
    into v_receivable_count, v_receivables
  from retained;

  with invoice_payment_source as materialized (
    select invoice.id as invoice_id,
           invoice.client_id as payer_id,
           invoice.due_date,
           invoice.total as invoice_total,
           payment.payment_date,
           payment.amount,
           (
             pg_catalog.lower(invoice.total::text) not in (
               'nan', 'infinity', '-infinity'
             )
             and pg_catalog.length(invoice.total::text) <= 64
             and pg_catalog.lower(payment.amount::text) not in (
               'nan', 'infinity', '-infinity'
             )
             and pg_catalog.length(payment.amount::text) <= 64
           ) as amount_valid,
           (
             exists (
               select 1 from public.invoices duplicate
               where duplicate.company_id = p_company_id
                 and duplicate.id <> invoice.id
                 and duplicate.deleted_at is null
                 and (
                   (invoice.qb_id is not null and duplicate.qb_id = invoice.qb_id)
                   or (invoice.sage_id is not null and duplicate.sage_id = invoice.sage_id)
                 )
             )
             or exists (
               select 1
               from public.payments same_payment
               join public.payments duplicate
                on duplicate.company_id = same_payment.company_id
                and duplicate.id <> same_payment.id
                and duplicate.voided_at is null
                and duplicate.payment_date <= v_business_date
                and (
                  (same_payment.qb_id is not null and duplicate.qb_id = same_payment.qb_id)
                  or (same_payment.sage_id is not null and duplicate.sage_id = same_payment.sage_id)
                  or (
                    same_payment.stripe_payment_intent is not null
                    and duplicate.stripe_payment_intent = same_payment.stripe_payment_intent
                  )
                )
               where same_payment.company_id = p_company_id
                 and same_payment.invoice_id = invoice.id
                 and same_payment.voided_at is null
                 and same_payment.payment_date <= v_business_date
             )
           ) as identity_conflict
    from public.invoices invoice
    join public.payments payment
     on payment.invoice_id = invoice.id
     and payment.company_id = p_company_id
     and payment.voided_at is null
     and payment.payment_date <= v_business_date
    where invoice.company_id = p_company_id
      and invoice.deleted_at is null
      and (
        invoice.total > 0
        or pg_catalog.lower(invoice.total::text) in (
          'nan', 'infinity', '-infinity'
        )
        or pg_catalog.length(invoice.total::text) > 64
      )
  ), payment_daily as materialized (
    select invoice_payment_source.invoice_id,
           invoice_payment_source.payer_id,
           invoice_payment_source.due_date,
           invoice_payment_source.invoice_total,
           invoice_payment_source.payment_date,
           pg_catalog.sum(invoice_payment_source.amount) as daily_amount,
           pg_catalog.bool_and(invoice_payment_source.amount_valid)
             as amount_valid,
           pg_catalog.bool_or(invoice_payment_source.identity_conflict)
             as identity_conflict
    from invoice_payment_source
    group by invoice_payment_source.invoice_id,
             invoice_payment_source.payer_id,
             invoice_payment_source.due_date,
             invoice_payment_source.invoice_total,
             invoice_payment_source.payment_date
  ), payment_running as materialized (
    select payment_daily.*,
           pg_catalog.sum(payment_daily.daily_amount) over (
             partition by payment_daily.invoice_id
             order by payment_daily.payment_date
             rows between unbounded preceding and current row
           ) as cumulative_amount
    from payment_daily
  ), payment_sustained as materialized (
    select payment_running.*,
           pg_catalog.min(payment_running.cumulative_amount) over (
             partition by payment_running.invoice_id
             order by payment_running.payment_date
             rows between current row and unbounded following
           ) as future_minimum_amount
    from payment_running
  ), settlement as materialized (
    select payment_sustained.invoice_id,
           payment_sustained.payer_id,
           payment_sustained.due_date,
           pg_catalog.min(payment_sustained.payment_date) filter (
             where payment_sustained.future_minimum_amount >=
               payment_sustained.invoice_total
               or not payment_sustained.amount_valid
           ) as settled_on,
           pg_catalog.bool_and(payment_sustained.amount_valid) as amount_valid,
           pg_catalog.bool_or(payment_sustained.identity_conflict)
             as identity_conflict
    from payment_sustained
    group by payment_sustained.invoice_id,
             payment_sustained.payer_id,
             payment_sustained.due_date
  ), candidate as materialized (
    select settlement.invoice_id,
           settlement.payer_id,
           settlement.due_date,
           settlement.settled_on,
           case
             when pg_catalog.isfinite(settlement.settled_on)
               and pg_catalog.isfinite(settlement.due_date)
               then (settlement.settled_on - settlement.due_date)::integer
             else 0
           end as delay_days,
           settlement.identity_conflict,
           settlement.amount_valid
    from settlement
    where settlement.settled_on is not null
    order by settlement.settled_on desc, settlement.invoice_id
    limit p_payer_history_limit + 1
  ), retained as materialized (
    select * from candidate
    order by settled_on desc, invoice_id
    limit p_payer_history_limit
  )
  select least((select count(*) from candidate), p_payer_history_limit + 1),
         coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'invoice_id', retained.invoice_id,
             'payer_id', retained.payer_id,
             'due_date', case
               when pg_catalog.isfinite(retained.due_date)
                 and extract(year from retained.due_date)
                   between 1 and 9999
                 then retained.due_date::text
               else '__invalid__'
             end,
             'settled_on', case
               when pg_catalog.isfinite(retained.settled_on)
                 and extract(year from retained.settled_on)
                   between 1 and 9999
                 then retained.settled_on::text
               else '__invalid__'
             end,
             'delay_days', retained.delay_days,
             'identity_conflict', retained.identity_conflict,
             'amount_valid', retained.amount_valid
           ) order by retained.settled_on desc, retained.invoice_id
         ), '[]'::jsonb)
    into v_history_count, v_history
  from retained;

  return pg_catalog.jsonb_build_object(
    'observed_at', pg_catalog.to_char(
      p_observed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'business_date', v_business_date,
    'target_date', p_target_date,
    'context', pg_catalog.jsonb_build_object(
      'company_id', p_company_id,
      'timezone', v_timezone,
      'currency_code', v_currency_code
    ),
    'source_revisions', pg_catalog.jsonb_build_object(
      'company', v_company_revision,
      'payroll_readiness', v_payroll_revision
    ),
    'settings', v_settings,
    'recurring_obligations', v_recurring,
    'reimbursement_batches', v_batches,
    'receivables', v_receivables,
    'payer_history', v_history,
    'source_counts', pg_catalog.jsonb_build_object(
      'recurring_obligations', v_recurring_count,
      'reimbursement_batches', v_batch_count,
      'receivables', v_receivable_count,
      'payer_history', v_history_count
    ),
    'source_bounds', pg_catalog.jsonb_build_object(
      'recurring_obligations',
        v_recurring_count > p_recurring_obligation_limit,
      'reimbursement_batches',
        v_batch_count > p_reimbursement_batch_limit,
      'receivables', v_receivable_count > p_receivable_limit,
      'payer_history', v_history_count > p_payer_history_limit
    )
  );
end;
$function$
;


-- Constituent: supabase/migrations/20260914214748_expense_admin_correction_review.sql
-- Source SHA256: f5a6d66815c8e9468817fc28d24a5fe1d7caa68dcb671b3b379a1ad227b5f015
-- Pending. Requires the P5 expense decision, accounting lifecycle and payroll migrations.
-- A correction returns a crew expense for review. It never approves or pays it.


-- Fail closed if a parallel release changed the functions this narrow patch
-- extends. The second hash is this exact implementation (safe reapplication).
do $$
begin
  if to_regprocedure('private.lock_expense_approver_context()') is null
    or to_regclass('public.expense_accounting_events') is null
    or to_regclass('private.expense_accounting_state') is null
    or not exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='expense_batches' and column_name='reimbursement_amount') then
    raise exception 'Install the P5 expense decision and accounting migrations first';
  end if;
  if to_regprocedure('public.read_agent_payroll_readiness_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,timestamptz,date,integer,integer,integer,integer)') is null
    or md5(pg_get_functiondef('public.read_agent_payroll_readiness_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,timestamptz,date,integer,integer,integer,integer)'::regprocedure))<>'f2e32a360886d5fed5040c5eb99b76c6' then
    raise exception 'Install and review the P5 expense payroll compatibility migration first';
  end if;
  if md5(pg_get_functiondef('private.enforce_expense_edit_authority()'::regprocedure)) not in
      ('a489f4f6506516e5934ff08f8fba69ad','d342596cd9e55adf458239a7025dfeaa')
    or md5(pg_get_functiondef('public.tg_place_expense()'::regprocedure)) not in
      ('2a9d3575dd23507040a31cb49dc69825','258dc02efee98372f6205e731ac0251f')
    or md5(pg_get_functiondef('public.place_expense(uuid)'::regprocedure)) not in
      ('69ae7eaa26297db59646c704ea454712','5d3a1254421fc4378f9b9a32d4cc3bd5') then
    raise exception 'Expense authority or placement changed; review the correction migration before applying';
  end if;
end; $$;

create table if not exists private.expense_correction_requests (
  request_id uuid primary key,
  company_id uuid not null,
  actor_id uuid not null,
  submitted_by uuid not null,
  expense_id uuid not null,
  command_hash text not null,
  correction jsonb not null check (jsonb_typeof(correction)='object'),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists expense_correction_history_idx
  on private.expense_correction_requests(company_id,expense_id,created_at desc,request_id);
alter table private.expense_correction_requests enable row level security;
revoke all on private.expense_correction_requests from public,anon,authenticated,service_role;

-- Unresolved correction custody also protects the scheduled envelope sweep.
create table if not exists private.expense_correction_pending (
  expense_id uuid primary key, request_id uuid not null, company_id uuid not null,
  actor_id uuid not null, marked_at timestamptz not null, feedback text not null
);
alter table private.expense_correction_pending enable row level security;
revoke all on private.expense_correction_pending from public,anon,authenticated,service_role;

-- Short-lived, unforgeable transaction capability. No client can write this
-- table or widen ordinary uploader-only saves by setting a custom GUC.
create table if not exists private.expense_correction_scope (
  transaction_id xid8 not null,
  expense_id uuid not null,
  company_id uuid not null,
  actor_id uuid not null,
  before_content jsonb not null,
  after_content jsonb not null,
  primary key(transaction_id,expense_id)
);
alter table private.expense_correction_scope enable row level security;
revoke all on private.expense_correction_scope from public,anon,authenticated,service_role;

create or replace function private.expense_correction_content(p_expense public.expenses)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'category_id',p_expense.category_id,'merchant_name',p_expense.merchant_name,
    'description',p_expense.description,'amount',p_expense.amount,'tax_amount',p_expense.tax_amount,
    'currency',p_expense.currency,'expense_date',p_expense.expense_date,
    'payment_method',p_expense.payment_method,'project_missing_reason',p_expense.project_missing_reason,
    'project_missing_note',p_expense.project_missing_note);
$$;
revoke all on function private.expense_correction_content(public.expenses) from public,anon,authenticated,service_role;

create or replace function private.expense_correction_snapshot(p_expense public.expenses)
returns jsonb language sql stable set search_path='' as $$
  select private.expense_correction_content(p_expense) || jsonb_build_object(
    'status',p_expense.status,
    'updated_at',to_char(p_expense.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'category_name',(select name from public.expense_categories where id=p_expense.category_id and company_id=p_expense.company_id),
    'allocations',coalesce((select jsonb_agg(jsonb_build_object(
      'project_id',a.project_id,'project_title',p.title,'percentage',a.percentage,'amount',a.amount)
      order by a.project_id) from public.expense_project_allocations a
      left join public.projects p on p.id::text=a.project_id and p.company_id=p_expense.company_id
      where a.expense_id=p_expense.id),'[]'::jsonb));
$$;
revoke all on function private.expense_correction_snapshot(public.expenses) from public,anon,authenticated,service_role;

create or replace function private.immutable_expense_correction()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Expense correction history is immutable' using errcode='42501'; end; $$;
drop trigger if exists immutable_expense_correction on private.expense_correction_requests;
create trigger immutable_expense_correction before update or delete on private.expense_correction_requests
  for each row execute function private.immutable_expense_correction();
revoke all on function private.immutable_expense_correction() from public,anon,authenticated,service_role;

-- Preserve the released uploader-only boundary; the exception is exactly one
-- authorized business-content update returning this expense to its submitter.
create or replace function private.enforce_expense_edit_authority()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_uid uuid; v_is_admin boolean; v_correction boolean;
  v_pending private.expense_correction_pending;
begin
  if coalesce(current_setting('request.jwt.claims',true),'')='' then return new; end if;
  v_uid:=private.get_current_user_id();
  v_is_admin:=private.current_user_is_admin();
  v_correction:=exists(select 1 from private.expense_correction_scope s
    where s.transaction_id=pg_current_xact_id() and s.expense_id=old.id
      and s.company_id=old.company_id and s.actor_id=v_uid
      and s.before_content=private.expense_correction_content(old)
      and s.after_content=private.expense_correction_content(new)
      and new.company_id=old.company_id and new.submitted_by=old.submitted_by
      and old.status in('submitted','rejected') and new.status='rejected'
      and new.flagged_by=v_uid and new.rejected_by=v_uid
      and new.deleted_at is not distinct from old.deleted_at);
  if private.expense_correction_content(new) is distinct from private.expense_correction_content(old)
    and not v_correction and (v_uid is null or v_uid<>old.submitted_by) then
    raise exception 'Only the expense submitter may edit its details' using errcode='42501';
  end if;
  if row(new.receipt_image_url,new.receipt_thumbnail_url,new.ocr_raw_data,new.ocr_confidence,
      new.receipt_missing_reason,new.receipt_missing_note)
    is distinct from row(old.receipt_image_url,old.receipt_thumbnail_url,old.ocr_raw_data,old.ocr_confidence,
      old.receipt_missing_reason,old.receipt_missing_note)
    and (v_uid is null or v_uid<>old.submitted_by) then
    raise exception 'Only the expense submitter may edit its receipt' using errcode='42501';
  end if;
  if new.deleted_at is distinct from old.deleted_at and new.deleted_at is not null
    and not coalesce(v_is_admin or (v_uid is not null and v_uid=old.submitted_by),false) then
    raise exception 'Only the submitter or a company admin may delete this expense' using errcode='42501';
  end if;
  -- A successful crew resubmission acknowledges only the exact correction
  -- markers it read. A later independent flag is never silently erased.
  if old.status='rejected' and new.status='submitted' and v_uid=old.submitted_by then
    select * into v_pending from private.expense_correction_pending where expense_id=old.id;
    if found and v_pending.company_id=old.company_id
      and row(old.flagged_by,old.flagged_at,old.flag_comment,old.rejected_by,old.rejected_at,old.rejection_reason)
        is not distinct from row(v_pending.actor_id,v_pending.marked_at,v_pending.feedback,
          v_pending.actor_id,v_pending.marked_at,v_pending.feedback)
      and row(new.flagged_by,new.flagged_at,new.flag_comment,new.rejected_by,new.rejected_at,new.rejection_reason)
        is not distinct from row(old.flagged_by,old.flagged_at,old.flag_comment,old.rejected_by,old.rejected_at,old.rejection_reason) then
      new.flagged_by:=null; new.flagged_at:=null; new.flag_comment:=null;
      new.rejected_by:=null; new.rejected_at:=null; new.rejection_reason:=null;
      delete from private.expense_correction_pending where expense_id=old.id;
    end if;
  end if;
  return new;
end; $$;

-- An unbatched return must not be automatically approved by place_expense.
-- Only this private transaction scope suppresses placement; crew resubmission
-- continues through the existing atomic save/refile operation after it closes.
create or replace function public.tg_place_expense()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from private.expense_correction_scope s
    where s.transaction_id=pg_current_xact_id() and s.expense_id=new.id
      and s.company_id=new.company_id and s.actor_id=private.get_current_user_id()) then
    return new;
  end if;
  if new.deleted_at is null and new.status<>'draft' and new.batch_id is null then
    perform public.place_expense(new.id);
  end if;
  return new;
end; $$;

CREATE OR REPLACE FUNCTION public.place_expense(p_expense_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_exp     public.expenses;
  v_freq    text;
  v_ps      date; v_pe date;
  v_scope   uuid;
  v_batch   public.expense_batches;
  v_home_approved boolean;
  v_threshold numeric;
begin
  select * into v_exp from public.expenses where id = p_expense_id;
  if v_exp.id is null or v_exp.deleted_at is not null then return; end if;
  if v_exp.status = 'draft' or v_exp.batch_id is not null then return; end if;
  -- A correction stays with its submitter until an explicit resubmission.
  if v_exp.status='rejected' and exists(select 1 from private.expense_correction_pending p
    where p.expense_id=v_exp.id and p.company_id=v_exp.company_id) then return; end if;

  select coalesce(es.review_frequency,'monthly') into v_freq
  from public.expense_settings es where es.company_id = v_exp.company_id;
  v_freq := coalesce(v_freq,'monthly');

  select period_start, period_end into v_ps, v_pe
  from public.expense_envelope_period(v_exp.expense_date, v_freq);

  if v_freq = 'per_job' then
    select project_id into v_scope
    from public.expense_project_allocations
    where expense_id = v_exp.id order by id limit 1;   -- no created_at column on this table
  else
    v_scope := null;
  end if;

  -- Home-period envelope already approved? Then roll forward to the current period.
  select exists(
    select 1 from public.expense_batches b
    where b.company_id = v_exp.company_id and b.submitted_by = v_exp.submitted_by
      and b.amendment_number = 0 and b.status = 'approved'
      and coalesce(b.period_start,'1970-01-01'::date) = v_ps
      and coalesce(b.period_end,'1970-01-01'::date)   = v_pe
      and coalesce(b.scope_project_id,'00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(v_scope,'00000000-0000-0000-0000-000000000000'::uuid)
  ) into v_home_approved;

  if v_home_approved then
    select period_start, period_end into v_ps, v_pe
    from public.expense_envelope_period(current_date, v_freq);
  end if;

  v_batch := public.get_or_create_open_batch(
    v_exp.company_id, v_exp.submitted_by, v_ps, v_pe, v_scope);

  update public.expenses set batch_id = v_batch.id, updated_at = now()
  where id = v_exp.id;

  perform public.recalculate_expense_batch_total(v_batch.id);

  -- Under-threshold auto-clear: keep it in the envelope (books stay complete) but clear the line.
  select auto_approve_threshold into v_threshold
  from public.expense_settings es where es.company_id = v_exp.company_id;
  if coalesce(v_threshold, 0) > 0 and v_exp.amount is not null and v_exp.amount < v_threshold then
    update public.expenses set status = 'approved', updated_at = now()
    where id = v_exp.id and status <> 'approved';
  end if;
end;
$function$;

create or replace function private.correct_expense_for_review(p_command jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare
  v_request uuid; v_id uuid; v_company uuid; v_actor uuid; v_submitter uuid;
  v_expected timestamptz; v_expected_status text; v_hash text; v_note text; v_context record;
  v_existing private.expense_correction_requests%rowtype;
  v_exp public.expenses; v_next public.expenses; v_batch public.expense_batches;
  v_before jsonb; v_after jsonb; v_record jsonb; v_allocations jsonb;
  v_count integer; v_total numeric; v_category uuid; v_today date; v_frequency text; v_marked_at timestamptz;
  v_keys text[]:=array['request_id','expense_id','company_id','actor_id','submitted_by',
    'expected_status','expected_updated_at','correction_note','category_id','merchant_name',
    'description','amount','tax_amount','currency','expense_date','payment_method',
    'project_missing_reason','project_missing_note','allocations'];
begin
  if p_command is null or jsonb_typeof(p_command)<>'object' then
    raise exception 'Expense correction must be an object' using errcode='22023';
  end if;
  if not p_command ?& v_keys or exists(select 1 from jsonb_object_keys(p_command) k where not k=any(v_keys)) then
    raise exception 'Expense correction contains missing or unsupported fields' using errcode='22023';
  end if;
  if exists(select 1 from unnest(array['request_id','expense_id','company_id','actor_id','submitted_by',
    'expected_status','expected_updated_at','correction_note','merchant_name','currency','expense_date','payment_method']) k
    where jsonb_typeof(p_command->k)<>'string')
    or exists(select 1 from unnest(array['category_id','description','project_missing_reason','project_missing_note']) k
      where jsonb_typeof(p_command->k) not in('string','null'))
    or jsonb_typeof(p_command->'amount')<>'number'
    or jsonb_typeof(p_command->'tax_amount') not in('number','null')
    or jsonb_typeof(p_command->'allocations')<>'array' then
    raise exception 'Expense correction contains an invalid field type' using errcode='22023';
  end if;
  begin
    v_request:=(p_command->>'request_id')::uuid; v_id:=(p_command->>'expense_id')::uuid;
    v_company:=(p_command->>'company_id')::uuid; v_actor:=(p_command->>'actor_id')::uuid;
    v_submitter:=(p_command->>'submitted_by')::uuid;
    v_expected:=(p_command->>'expected_updated_at')::timestamptz;
    v_category:=(p_command->>'category_id')::uuid;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'Expense correction contains an invalid identifier or revision' using errcode='22023';
  end;
  if v_actor is distinct from private.get_current_user_id() or not exists(
    select 1 from public.users u join public.companies c on c.id=u.company_id
      where u.id=v_actor and u.company_id=v_company and u.is_active and u.deleted_at is null and c.deleted_at is null)
    or v_submitter=v_actor or not coalesce(private.current_user_is_admin() or
      (private.current_user_scope_for('expenses.approve')='all' and private.current_user_scope_for('expenses.view')='all'),false) then
    raise exception 'Expense correction access denied' using errcode='42501';
  end if;
  -- Same serialization namespace as normal saves and P5 financial decisions.
  perform pg_advisory_xact_lock(hashtextextended('save_expense_atomic:'||v_company::text,0));
  select * into v_context from private.lock_expense_approver_context();
  if v_context.actor_id is distinct from v_actor or v_context.company_id is distinct from v_company then
    raise exception 'Expense correction identity changed' using errcode='42501';
  end if;
  perform 1 from public.users where id=v_submitter and company_id=v_company
    and is_active and deleted_at is null for share nowait;
  if not found or not coalesce(private.current_user_is_admin() or
    (private.current_user_scope_for('expenses.approve')='all' and private.current_user_scope_for('expenses.view')='all'),false) then
    raise exception 'Expense correction access denied' using errcode='42501';
  end if;
  v_hash:=encode(extensions.digest(p_command::text,'sha256'),'hex');
  select * into v_existing from private.expense_correction_requests where request_id=v_request;
  if found then
    if row(v_existing.company_id,v_existing.actor_id,v_existing.submitted_by,v_existing.expense_id,v_existing.command_hash)
      is distinct from row(v_company,v_actor,v_submitter,v_id,v_hash) then
      raise exception 'Expense correction request was reused with different content' using errcode='22023';
    end if;
    if not exists(select 1 from public.expenses where id=v_id and company_id=v_company
      and submitted_by=v_submitter and deleted_at is null) then
      raise exception 'Expense is no longer available' using errcode='42501';
    end if;
    return jsonb_build_object('request_id',v_request,'expense_id',v_id,'company_id',v_company,
      'actor_id',v_actor,'submitted_by',v_submitter,'replayed',true,'correction',v_existing.correction);
  end if;

  v_note:=btrim(p_command->>'correction_note');
  v_expected_status:=p_command->>'expected_status';
  if length(v_note)>2000 or v_expected_status not in('submitted','rejected')
    or v_expected is null or not isfinite(v_expected) then
    raise exception 'Reload the current expense and shorten the correction note' using errcode='22023';
  end if;
  -- Respect allocation -> parent ordering of older clients. NOWAIT makes
  -- opposite direct-write lock orders fail with a retryable conflict.
  perform 1 from public.expense_project_allocations a join public.expenses e on e.id=a.expense_id
    where e.id=v_id and e.company_id=v_company and e.submitted_by=v_submitter and e.deleted_at is null
    order by a.id for update of a nowait;
  select * into v_exp from public.expenses where id=v_id and company_id=v_company
    and submitted_by=v_submitter and deleted_at is null for update nowait;
  if not found then raise exception 'Expense correction access denied' using errcode='42501'; end if;
  if v_exp.updated_at<>v_expected or v_exp.status<>v_expected_status then
    raise exception 'Expense changed; reload it before returning a correction' using errcode='P0001';
  end if;
  if v_exp.status not in('submitted','rejected') or v_exp.approved_at is not null or v_exp.approved_by is not null
    or v_exp.accounting_sync_id is not null or v_exp.accounting_synced_at is not null
    or coalesce(v_exp.accounting_sync_status,'pending')<>'pending'
    or exists(select 1 from public.expense_accounting_events where company_id=v_company and expense_id=v_id)
    or exists(select 1 from private.expense_accounting_state where expense_id=v_id and
      (active_accrual_id is not null or active_payment_id is not null or legacy_review_required)) then
    raise exception 'Approved or exported expenses cannot use crew corrections' using errcode='55000';
  end if;
  if not exists(select 1 from public.users where id=v_submitter and company_id=v_company
    and is_active and deleted_at is null) then
    raise exception 'Expense submitter is no longer active' using errcode='42501';
  end if;
  if v_exp.batch_id is not null then
    select * into v_batch from public.expense_batches where id=v_exp.batch_id for update nowait;
    if not found or v_batch.company_id is distinct from v_company or v_batch.submitted_by is distinct from v_submitter then
      raise exception 'Expense envelope identity does not match' using errcode='42501';
    end if;
    if v_batch.paid_at is not null or v_batch.paid_by is not null
      or coalesce(v_batch.status,'') not in('open','pending_review','submitted','rejected')
      or v_batch.reviewed_by is not null or v_batch.reviewed_at is not null then
      raise exception 'Reviewed or paid envelopes cannot use crew corrections' using errcode='55000';
    end if;
    if exists(select 1 from public.expenses e where e.batch_id=v_batch.id and e.company_id is distinct from v_company) then
      raise exception 'Expense envelope contains a foreign expense' using errcode='42501';
    end if;
  end if;

  v_next:=v_exp;
  v_next.category_id:=v_category; v_next.merchant_name:=btrim(p_command->>'merchant_name');
  v_next.description:=p_command->>'description'; v_next.amount:=(p_command->>'amount')::numeric;
  v_next.tax_amount:=(p_command->>'tax_amount')::numeric; v_next.currency:=p_command->>'currency';
  begin v_next.expense_date:=(p_command->>'expense_date')::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Expense date is invalid' using errcode='22023'; end;
  v_next.payment_method:=p_command->>'payment_method';
  v_next.project_missing_reason:=nullif(p_command->>'project_missing_reason','');
  v_next.project_missing_note:=nullif(p_command->>'project_missing_note','');
  if length(v_next.merchant_name) not between 1 and 500 or length(v_next.description)>10000
    or length(v_next.project_missing_note)>2000 or v_next.amount<=0 or v_next.amount>10000
    or v_next.amount<>round(v_next.amount,2)
    or (v_next.tax_amount is not null and (v_next.tax_amount<0 or v_next.tax_amount>v_next.amount*0.20
      or v_next.tax_amount<>round(v_next.tax_amount,2)))
    or v_next.currency!~'^[A-Z]{3}$' or v_next.payment_method not in('cash','personal_card','company_card') then
    raise exception 'Expense correction contains invalid expense details' using errcode='22023';
  end if;
  select (clock_timestamp() at time zone coalesce(tz.name,'UTC'))::date into v_today
    from public.companies c left join pg_catalog.pg_timezone_names tz on tz.name=c.timezone where c.id=v_company;
  if not isfinite(v_next.expense_date) or v_next.expense_date>v_today
    or v_next.expense_date<(v_today-interval '5 years')::date then
    raise exception 'Expense date is outside the allowed range' using errcode='22023';
  end if;
  v_allocations:=p_command->'allocations';
  if jsonb_array_length(v_allocations)>100 then
    raise exception 'Too many expense allocations' using errcode='22023';
  end if;
  for v_after in select value from jsonb_array_elements(v_allocations) loop
    if jsonb_typeof(v_after)<>'object' then
      raise exception 'Expense allocation must be an object' using errcode='22023';
    end if;
    if not v_after ?& array['project_id','percentage','amount']
      or exists(select 1 from jsonb_object_keys(v_after) k where k not in('project_id','percentage','amount'))
      or jsonb_typeof(v_after->'project_id')<>'string' or jsonb_typeof(v_after->'percentage')<>'number'
      or jsonb_typeof(v_after->'amount')<>'null' then
      raise exception 'Expense allocation has invalid fields' using errcode='22023';
    end if;
  end loop;
  select count(*),coalesce(sum(a.percentage),0) into v_count,v_total
    from jsonb_to_recordset(v_allocations) a(project_id text,percentage numeric,amount numeric);
  if (v_count>0 and v_total<>100) or exists(select 1 from jsonb_to_recordset(v_allocations)
    a(project_id text,percentage numeric,amount numeric) where a.percentage<=0 or a.percentage>100
      or a.percentage<>round(a.percentage,2)) or exists(select 1 from jsonb_to_recordset(v_allocations)
    a(project_id text,percentage numeric,amount numeric) group by a.project_id having count(*)>1) then
    raise exception 'Expense allocations must be unique and total 100 percent' using errcode='22023';
  end if;
  select coalesce(review_frequency,'monthly') into v_frequency from public.expense_settings where company_id=v_company;
  if v_frequency='per_job' and v_count>1 then
    raise exception 'Per-job expenses allow one project' using errcode='22023';
  end if;
  if v_count>0 then v_next.project_missing_reason:=null; v_next.project_missing_note:=null;
  elsif v_next.project_missing_reason is null then v_next.project_missing_note:=null; end if;
  if v_next.project_missing_reason is not null and v_next.project_missing_reason not in('overhead','general','other') then
    raise exception 'Expense project exception is invalid' using errcode='22023';
  end if;
  -- Freeze the identities/labels used by this correction. A concurrent
  -- category removal or project tenant change cannot invalidate validation.
  perform 1 from public.expense_categories where id in(v_exp.category_id,v_category)
    and company_id=v_company order by id for share nowait;
  perform 1 from public.projects p where p.company_id=v_company and (p.id::text in(
    select a.project_id from jsonb_to_recordset(v_allocations) a(project_id text,percentage numeric,amount numeric))
    or p.id::text in(select project_id from public.expense_project_allocations where expense_id=v_id))
    order by p.id for share nowait;
  if v_category is not null and not exists(select 1 from public.expense_categories where id=v_category
    and company_id=v_company and (is_active or id=v_exp.category_id)) then
    raise exception 'Expense category is unavailable' using errcode='23503';
  end if;
  if exists(select 1 from jsonb_to_recordset(v_allocations) a(project_id text,percentage numeric,amount numeric)
    left join public.projects p on p.id::text=a.project_id and p.company_id=v_company and p.deleted_at is null
    where p.id is null) then
    raise exception 'Expense allocation project is unavailable' using errcode='23503';
  end if;
  v_before:=private.expense_correction_snapshot(v_exp);
  if private.expense_correction_content(v_exp)=private.expense_correction_content(v_next)
    and coalesce((select jsonb_agg(value-'project_title' order by value->>'project_id')
      from jsonb_array_elements(v_before->'allocations')),'[]'::jsonb)
      =coalesce((select jsonb_agg(value order by value->>'project_id') from jsonb_array_elements(v_allocations)),'[]'::jsonb) then
    raise exception 'Change an expense field or use Flag for a note' using errcode='22023';
  end if;
  -- Recheck revocable grants immediately before the first write.
  if not coalesce(private.current_user_is_admin() or
    (private.current_user_scope_for('expenses.approve')='all' and private.current_user_scope_for('expenses.view')='all'),false) then
    raise exception 'Expense correction access denied' using errcode='42501';
  end if;
  insert into private.expense_correction_scope values(pg_current_xact_id(),v_id,v_company,v_actor,
    private.expense_correction_content(v_exp),private.expense_correction_content(v_next));
  v_marked_at:=clock_timestamp();
  insert into private.expense_correction_pending(expense_id,request_id,company_id,actor_id,marked_at,feedback)
    values(v_id,v_request,v_company,v_actor,v_marked_at,coalesce(nullif(v_note,''),'Review corrected expense details.'))
    on conflict(expense_id) do update set request_id=excluded.request_id,company_id=excluded.company_id,
      actor_id=excluded.actor_id,marked_at=excluded.marked_at,feedback=excluded.feedback;
  update public.expenses set category_id=v_next.category_id,merchant_name=v_next.merchant_name,
    description=v_next.description,amount=v_next.amount,tax_amount=v_next.tax_amount,currency=v_next.currency,
    expense_date=v_next.expense_date,payment_method=v_next.payment_method,
    project_missing_reason=v_next.project_missing_reason,project_missing_note=v_next.project_missing_note,
    status='rejected',flag_comment=coalesce(nullif(v_note,''),'Review corrected expense details.'),flagged_by=v_actor,flagged_at=v_marked_at,
    rejection_reason=coalesce(nullif(v_note,''),'Review corrected expense details.'),rejected_by=v_actor,rejected_at=v_marked_at
    where id=v_id;
  delete from public.expense_project_allocations where expense_id=v_id;
  insert into public.expense_project_allocations(expense_id,project_id,percentage,amount)
    select v_id,a.project_id,a.percentage,a.amount from jsonb_to_recordset(v_allocations)
      a(project_id text,percentage numeric,amount numeric);
  if v_exp.batch_id is not null then perform public.recalculate_expense_batch_total(v_exp.batch_id); end if;
  select * into strict v_next from public.expenses where id=v_id;
  v_record:=jsonb_build_object('id',v_request,'request_id',v_request,'expense_id',v_id,'company_id',v_company,
    'actor_id',v_actor,'submitted_by',v_submitter,'corrected_at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'correction_note',v_note,'before',v_before,'after',private.expense_correction_snapshot(v_next));
  insert into private.expense_correction_requests(request_id,company_id,actor_id,submitted_by,expense_id,command_hash,correction)
    values(v_request,v_company,v_actor,v_submitter,v_id,v_hash,v_record);
  insert into public.notifications(user_id,company_id,type,title,body,expense_id,batch_id,deep_link_type,
    is_read,persistent,action_url,action_label,dedupe_key)
    values(v_submitter::text,v_company::text,'expense_rejected','Expense corrected',
      'Review the changes, then resubmit your expense.',v_id::text,v_exp.batch_id::text,'expense',
      false,false,'/books?segment=expenses'||case when v_exp.batch_id is null then '' else '&batch='||v_exp.batch_id::text end,'Review expense','expense_correction:'||v_request::text);
  delete from private.expense_correction_scope where transaction_id=pg_current_xact_id() and expense_id=v_id;
  return jsonb_build_object('request_id',v_request,'expense_id',v_id,'company_id',v_company,
    'actor_id',v_actor,'submitted_by',v_submitter,'replayed',false,'correction',v_record);
exception when lock_not_available or deadlock_detected then
  raise exception 'Expense is busy; retry this correction' using errcode='40001';
end; $$;
revoke all on function private.correct_expense_for_review(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.correct_expense_for_review(jsonb) to authenticated;
create or replace function public.correct_expense_for_review(p_command jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.correct_expense_for_review(p_command);
$$;
revoke all on function public.correct_expense_for_review(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.correct_expense_for_review(jsonb) to authenticated;

create or replace function private.list_expense_corrections(p_expense_id uuid,p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid; v_submitter uuid;
begin
  v_actor:=private.get_current_user_id();
  if not exists(select 1 from public.users u join public.companies c on c.id=u.company_id
    where u.id=v_actor and u.company_id=p_company_id and u.is_active and u.deleted_at is null and c.deleted_at is null) then
    raise exception 'Expense correction history access denied' using errcode='42501';
  end if;
  select submitted_by into v_submitter from public.expenses where id=p_expense_id and company_id=p_company_id and deleted_at is null;
  if not found or not coalesce(private.current_user_is_admin()
    or (v_submitter=v_actor and private.current_user_scope_for('expenses.view') in('own','all'))
    or (private.current_user_scope_for('expenses.view')='all' and private.current_user_scope_for('expenses.approve')='all'),false) then
    raise exception 'Expense correction history access denied' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(correction order by created_at desc,request_id desc)
    from private.expense_correction_requests where company_id=p_company_id and expense_id=p_expense_id),'[]'::jsonb);
end; $$;
revoke all on function private.list_expense_corrections(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.list_expense_corrections(uuid,uuid) to authenticated;
create or replace function public.list_expense_corrections(p_expense_id uuid,p_company_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.list_expense_corrections(p_expense_id,p_company_id);
$$;
revoke all on function public.list_expense_corrections(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_expense_corrections(uuid,uuid) to authenticated;



COMMIT;
