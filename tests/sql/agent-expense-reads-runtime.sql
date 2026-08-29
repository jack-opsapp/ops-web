\set ON_ERROR_STOP on

\if :{?agent_mcp_expense_bootstrap}
-- Disposable PostgreSQL 17 bootstrap for Task 16. Only the production-shaped
-- prerequisites used by the expense source/read migrations are defined here.
-- All behavioral rows below are enclosed by a rollback-only transaction.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema auth;
create schema private;
create schema extensions;
create extension pgcrypto with schema extensions;

create function auth.role() returns text
language sql stable set search_path = ''
as $$
  select nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
$$;

create table public.companies (
  id uuid primary key,
  name text not null,
  deleted_at timestamptz
);
create table public.users (
  id uuid primary key,
  company_id uuid,
  first_name text not null,
  last_name text not null,
  is_active boolean default true,
  is_company_admin boolean default false,
  deleted_at timestamptz
);
create table public.user_permission_overrides (
  id uuid primary key,
  user_id uuid not null,
  company_id uuid not null,
  permission text not null,
  scope text,
  granted boolean not null default true
);
create table public.projects (
  id uuid primary key,
  company_id uuid not null,
  title text not null,
  deleted_at timestamptz
);
create table public.project_tasks (
  id uuid primary key,
  company_id uuid not null,
  project_id uuid not null,
  team_member_ids text[] default array[]::text[],
  deleted_at timestamptz
);
create table public.expense_categories (
  id uuid primary key,
  company_id uuid not null,
  name text not null,
  is_active boolean default true
);
create table public.expense_batches (
  id uuid primary key,
  company_id uuid not null,
  batch_number text not null,
  period_start date,
  period_end date,
  status text not null default 'pending_review',
  submitted_by uuid,
  total_amount numeric default 0,
  approved_amount numeric default 0,
  paid_at timestamptz
);
create table public.expenses (
  id uuid primary key,
  company_id uuid not null,
  submitted_by uuid not null,
  status text not null default 'draft',
  category_id uuid,
  merchant_name text,
  description text,
  amount numeric not null default 0,
  tax_amount numeric,
  currency text default 'USD',
  expense_date date,
  payment_method text,
  receipt_image_url text,
  receipt_thumbnail_url text,
  ocr_raw_data jsonb,
  accounting_sync_status text,
  accounting_sync_id text,
  batch_id uuid,
  approved_by uuid,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  rejection_reason text,
  flag_comment text,
  flagged_by uuid,
  flagged_at timestamptz,
  updated_at timestamptz not null default pg_catalog.statement_timestamp(),
  deleted_at timestamptz
);
create table public.expense_project_allocations (
  id uuid primary key,
  expense_id uuid not null,
  project_id text not null,
  percentage numeric not null,
  amount numeric
);

create table private.agent_read_domains (
  domain text primary key
);
insert into private.agent_read_domains(domain) values ('expenses');
create table private.agent_read_domain_revisions (
  company_id uuid not null,
  domain text not null,
  source_revision bigint not null default 0,
  primary key(company_id, domain)
);
create table private.mcp_oauth_clients (
  client_id uuid primary key,
  scope_ceiling text[] not null,
  consent_catalog_revision text not null,
  exposure_revision text not null,
  disabled_at timestamptz
);
create table private.mcp_oauth_grants (
  id uuid primary key,
  user_id uuid not null,
  company_id uuid not null,
  client_id uuid not null,
  scopes text[] not null,
  revision text not null,
  revoked_at timestamptz,
  accepted_labels text[] not null,
  consent_catalog_revision text not null,
  exposure_revision text not null
);

create function private.agent_read_domain_uuid_from_text(p_value text)
returns uuid
language plpgsql immutable security invoker set search_path = ''
as $$
begin
  if p_value is null
     or p_value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return null;
  end if;
  return p_value::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create function private.advance_agent_read_domain_revisions(
  p_company_ids uuid[],
  p_domain text
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into private.agent_read_domain_revisions(
    company_id, domain, source_revision
  )
  select distinct company_id, p_domain, 1
  from pg_catalog.unnest(
    coalesce(p_company_ids, array[]::uuid[])
  ) company_id
  where company_id is not null
  on conflict(company_id, domain) do update
    set source_revision =
      private.agent_read_domain_revisions.source_revision + 1;
end;
$$;

create function private.resolve_agent_actor_authority(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_registered_permission_keys text[]
) returns table(
  permission_snapshot_revision text,
  effective_permissions jsonb
)
language sql stable security invoker set search_path = ''
as $$
  with permissions as materialized (
    select coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'permission', permission.permission,
                 'scope', permission.scope
               ) order by permission.permission
             ),
             '[]'::jsonb
           ) as value
    from public.user_permission_overrides permission
    where permission.user_id = p_actor_user_id
      and permission.company_id = p_company_id
      and permission.granted
      and permission.permission = any(p_registered_permission_keys)
  )
  select 'sha256:' || pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to(
               p_actor_user_id::text || ':' || p_company_id::text || ':' ||
                 permissions.value::text,
               'UTF8'
             ),
             'sha256'
           ),
           'hex'
         ),
         permissions.value
  from public.users actor
  cross join permissions
  where actor.id = p_actor_user_id
    and actor.company_id = p_company_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false);
$$;

create function private.mcp_oauth_labels_for_scopes(text[], text)
returns text[]
language sql immutable set search_path = ''
as $$ select coalesce($1, array[]::text[]) $$;

create function private.agent_p2_optional_canonical_text(
  p_value text,
  p_max_scalars integer,
  p_max_bytes integer,
  p_allow_whitespace boolean
) returns text
language sql immutable security invoker set search_path = ''
as $$
  select case
    when p_value is null or p_value = '' then null
    when pg_catalog.char_length(p_value) > p_max_scalars then null
    when pg_catalog.octet_length(p_value) > p_max_bytes then null
    when not p_allow_whitespace
      and p_value is distinct from pg_catalog.btrim(p_value) then null
    else p_value
  end;
$$;

create function private.agent_rfc3339_utc(p_value timestamptz)
returns text
language sql immutable strict security invoker set search_path = ''
as $$
  select pg_catalog.to_char(
    p_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
$$;

create function private.canonical_agent_projection_json(p_value jsonb)
returns text
language sql immutable strict security invoker set search_path = ''
as $$ select p_value::text $$;

create function private.agent_currency_minor_exponent_or_null(
  p_currency_code text
) returns smallint
language sql immutable strict security invoker set search_path = ''
as $$
  select case pg_catalog.upper(p_currency_code)
    when 'JPY' then 0::smallint
    when 'BHD' then 3::smallint
    when 'CAD' then 2::smallint
    when 'USD' then 2::smallint
    when 'EUR' then 2::smallint
    else null::smallint
  end;
$$;

create function private.agent_money_to_minor_units(
  p_amount numeric,
  p_currency_code text
) returns bigint
language plpgsql immutable strict security invoker set search_path = ''
as $$
declare
  v_exponent smallint;
  v_scaled numeric;
begin
  v_exponent := private.agent_currency_minor_exponent_or_null(
    p_currency_code
  );
  if v_exponent is null then
    raise exception 'agent_currency_minor_exponent_unknown'
      using errcode = '22023';
  end if;
  v_scaled := p_amount * pg_catalog.power(10::numeric, v_exponent);
  if pg_catalog.trunc(v_scaled) is distinct from v_scaled then
    raise exception 'agent_money_minor_units_not_exact'
      using errcode = '22023';
  end if;
  if pg_catalog.abs(v_scaled) > 9007199254740991::numeric then
    raise exception 'agent_money_minor_units_out_of_range'
      using errcode = '22003';
  end if;
  return v_scaled::bigint;
end;
$$;

\ir ../../supabase/migrations/20260829040045_agent_expense_reimbursement_sources.sql
\ir ../../supabase/migrations/20260829040046_agent_expense_reads.sql
\endif

begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local request.jwt.claim.role = 'service_role';

do $expense_catalog_contract$
declare
  v_signature text;
  v_index text;
  v_plan json;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000
     or pg_catalog.current_setting('server_version_num')::integer >= 180000 then
    raise exception 'expense_runtime_requires_postgresql_17';
  end if;

  foreach v_signature in array array[
    'private.bump_agent_expense_source_revision()',
    'private.agent_p2_expense_hash_ref(text,jsonb)',
    'private.agent_p2_expense_money_v1(numeric,text)',
    'private.agent_p2_expense_expected_candidate_v1(text,jsonb)',
    'private.agent_p2_expense_proof_candidate_v1(jsonb)',
    'private.agent_p2_expense_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text)',
    'private.agent_p2_expense_project_assigned_v1(uuid,uuid,uuid)',
    'private.agent_p2_expense_assigned_approver_v1(uuid,uuid,uuid)',
    'private.agent_p2_expense_batch_assigned_approver_v1(uuid,uuid,uuid)',
    'private.agent_p2_expense_item_v1(uuid,uuid,uuid,integer)',
    'private.agent_p2_expense_batch_item_v1(uuid,uuid,boolean)',
    'private.agent_p2_expense_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,text,integer,integer,integer,timestamp with time zone,jsonb,date,uuid)',
    'private.agent_p2_expense_context_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,integer,integer,integer,integer)',
    'private.agent_p2_expense_attention_v1(uuid,uuid,text,text[],jsonb,timestamp with time zone,integer,integer)',
    'public.read_agent_expenses_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,text,integer,integer,integer,timestamp with time zone,jsonb,date,uuid)',
    'public.read_agent_expense_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,integer,integer,integer,integer)'
  ]::text[] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'expense_runtime_function_missing:%', v_signature;
    end if;
  end loop;

  foreach v_index in array array[
    'idx_expenses_agent_company_status_date_v1',
    'idx_expenses_agent_own_date_v1',
    'idx_expense_batches_agent_period_v1',
    'idx_expense_allocations_agent_project_v1'
  ]::text[] loop
    if not exists (
      select 1
      from pg_catalog.pg_class index_row
      join pg_catalog.pg_index index_state
        on index_state.indexrelid = index_row.oid
      where index_row.relnamespace = 'public'::regnamespace
        and index_row.relname = v_index
        and index_state.indisvalid
        and index_state.indisready
        and index_state.indislive
    ) then
      raise exception 'expense_runtime_index_invalid:%', v_index;
    end if;
  end loop;

  if pg_catalog.has_function_privilege(
       'anon',
       'public.read_agent_expenses_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,text,integer,integer,integer,timestamp with time zone,jsonb,date,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.read_agent_expenses_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,text,integer,integer,integer,timestamp with time zone,jsonb,date,uuid)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.read_agent_expenses_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,text,integer,integer,integer,timestamp with time zone,jsonb,date,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'private.agent_p2_expense_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,text,integer,integer,integer,timestamp with time zone,jsonb,date,uuid)',
       'EXECUTE'
     ) then
    raise exception 'expense_runtime_acl_invalid';
  end if;
  raise notice 'expense_runtime_acl_ok';
end;
$expense_catalog_contract$;

insert into public.companies(id, name) values
  ('16000000-0000-4000-8000-000000000001', 'Alpha Rail'),
  ('16000000-0000-4000-8000-000000000002', 'Other Company');
insert into public.users(
  id, company_id, first_name, last_name, is_active, is_company_admin
) values
  ('16100000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000001','Ada','Owner',true,false),
  ('16100000-0000-4000-8000-000000000002','16000000-0000-4000-8000-000000000001','Bea','Employee',true,false),
  ('16100000-0000-4000-8000-000000000003','16000000-0000-4000-8000-000000000001','Cal','Crew',true,false),
  ('16100000-0000-4000-8000-000000000004','16000000-0000-4000-8000-000000000002','Other','Person',true,false);
insert into public.user_permission_overrides(
  id, user_id, company_id, permission, scope, granted
) values
  ('16110000-0000-4000-8000-000000000001','16100000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000001','expenses.view','own',true),
  ('16110000-0000-4000-8000-000000000002','16100000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000001','projects.view','assigned',true);
insert into public.projects(id, company_id, title) values
  ('16200000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000001','Assigned Job'),
  ('16200000-0000-4000-8000-000000000002','16000000-0000-4000-8000-000000000001','Unassigned Job');
insert into public.project_tasks(
  id, company_id, project_id, team_member_ids
) values
  ('16210000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000001','16200000-0000-4000-8000-000000000001',array['16100000-0000-4000-8000-000000000001']),
  ('16210000-0000-4000-8000-000000000002','16000000-0000-4000-8000-000000000001','16200000-0000-4000-8000-000000000002',array['16100000-0000-4000-8000-000000000003']);
insert into public.expense_categories(id, company_id, name) values (
  '16300000-0000-4000-8000-000000000001',
  '16000000-0000-4000-8000-000000000001',
  'Materials'
);
insert into public.expense_batches(
  id, company_id, batch_number, period_start, period_end, status,
  submitted_by, total_amount, approved_amount, paid_at
) values
  ('16400000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000001','RB-OWN','2026-08-01','2026-08-15','approved','16100000-0000-4000-8000-000000000001',80.00,80.00,null),
  ('16400000-0000-4000-8000-000000000002','16000000-0000-4000-8000-000000000001','RB-OTHER','2026-08-16','2026-08-27','approved','16100000-0000-4000-8000-000000000002',90.00,90.00,'2026-08-28 12:00:00+00');
insert into public.expenses(
  id, company_id, submitted_by, status, category_id, merchant_name,
  description, amount, tax_amount, currency, expense_date, payment_method,
  receipt_image_url, receipt_thumbnail_url, ocr_raw_data,
  accounting_sync_status, accounting_sync_id, batch_id,
  rejection_reason, flag_comment, flagged_by, flagged_at, updated_at
) values
  ('16500000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000001','16100000-0000-4000-8000-000000000001','draft','16300000-0000-4000-8000-000000000001','Secret Supply','private description',12.34,1.23,'CAD','2026-08-28','personal','https://secret.invalid/receipt','https://secret.invalid/thumb','{"total":"secret"}','synced','acct-secret',null,null,'Check the total.','16100000-0000-4000-8000-000000000003','2026-08-28 11:00:00+00','2026-08-28 11:00:00+00'),
  ('16500000-0000-4000-8000-000000000002','16000000-0000-4000-8000-000000000001','16100000-0000-4000-8000-000000000002','submitted','16300000-0000-4000-8000-000000000001','Assigned Merchant',null,100.00,5.00,'CAD','2026-08-27',null,null,null,null,null,null,null,null,null,null,null,'2026-08-28 10:00:00+00'),
  ('16500000-0000-4000-8000-000000000003','16000000-0000-4000-8000-000000000001','16100000-0000-4000-8000-000000000002','submitted','16300000-0000-4000-8000-000000000001','Split Merchant',null,200.00,10.00,'CAD','2026-08-26',null,null,null,null,null,null,null,null,'Split allocations need review.','16100000-0000-4000-8000-000000000003','2026-08-28 09:00:00+00','2026-08-28 09:00:00+00'),
  ('16500000-0000-4000-8000-000000000004','16000000-0000-4000-8000-000000000001','16100000-0000-4000-8000-000000000002','submitted',null,'Unallocated Merchant',null,50.00,null,'CAD','2026-08-25',null,null,null,null,null,null,null,null,null,null,null,'2026-08-28 08:00:00+00'),
  ('16500000-0000-4000-8000-000000000005','16000000-0000-4000-8000-000000000001','16100000-0000-4000-8000-000000000001','approved',null,'Own Batch Merchant',null,80.00,null,'CAD','2026-08-15',null,null,null,null,null,null,'16400000-0000-4000-8000-000000000001',null,null,null,null,'2026-08-28 07:00:00+00'),
  ('16500000-0000-4000-8000-000000000006','16000000-0000-4000-8000-000000000001','16100000-0000-4000-8000-000000000002','approved',null,'Other Batch Merchant',null,90.00,null,'CAD','2026-08-24',null,null,null,null,null,null,'16400000-0000-4000-8000-000000000002',null,null,null,null,'2026-08-28 06:00:00+00'),
  ('16500000-0000-4000-8000-000000000007','16000000-0000-4000-8000-000000000002','16100000-0000-4000-8000-000000000004','submitted',null,'Cross Company',null,999.00,null,'USD','2026-08-28',null,null,null,null,null,null,null,null,null,null,null,'2026-08-28 05:00:00+00');
insert into public.expense_project_allocations(
  id, expense_id, project_id, percentage, amount
) values
  ('16600000-0000-4000-8000-000000000001','16500000-0000-4000-8000-000000000002','16200000-0000-4000-8000-000000000001',100,100.00),
  ('16600000-0000-4000-8000-000000000002','16500000-0000-4000-8000-000000000003','16200000-0000-4000-8000-000000000001',50,100.00),
  ('16600000-0000-4000-8000-000000000003','16500000-0000-4000-8000-000000000003','16200000-0000-4000-8000-000000000002',50,100.00);

do $source_revision_contract$
declare
  v_before bigint;
  v_after_irrelevant bigint;
  v_after_relevant bigint;
begin
  select revision.source_revision
    into strict v_before
  from private.agent_read_domain_revisions revision
  where revision.company_id = '16000000-0000-4000-8000-000000000001'
    and revision.domain = 'expenses';

  update public.expenses
  set description = 'changed private description',
      payment_method = 'changed-private-method',
      receipt_image_url = 'https://secret.invalid/changed-receipt',
      receipt_thumbnail_url = 'https://secret.invalid/changed-thumb',
      ocr_raw_data = '{"changed":"private"}'::jsonb,
      accounting_sync_status = 'changed-private-status',
      accounting_sync_id = 'changed-private-id'
  where id = '16500000-0000-4000-8000-000000000001';
  update public.expense_categories
  set is_active = not is_active
  where id = '16300000-0000-4000-8000-000000000001';
  update public.users
  set is_active = not is_active
  where id = '16100000-0000-4000-8000-000000000002';

  select revision.source_revision
    into strict v_after_irrelevant
  from private.agent_read_domain_revisions revision
  where revision.company_id = '16000000-0000-4000-8000-000000000001'
    and revision.domain = 'expenses';
  if v_after_irrelevant is distinct from v_before then
    raise exception 'expense_runtime_irrelevant_revision_advanced:%:%',
      v_before, v_after_irrelevant;
  end if;

  update public.expenses
  set merchant_name = merchant_name || ' Revised'
  where id = '16500000-0000-4000-8000-000000000001';
  update public.expense_project_allocations
  set amount = amount + 0.01
  where id = '16600000-0000-4000-8000-000000000001';
  update public.expense_categories
  set name = name || ' Revised'
  where id = '16300000-0000-4000-8000-000000000001';
  update public.expense_batches
  set batch_number = batch_number || '-R'
  where id = '16400000-0000-4000-8000-000000000001';
  update public.users
  set first_name = first_name || ' Revised'
  where id = '16100000-0000-4000-8000-000000000001';
  update public.projects
  set deleted_at = '2026-08-28 00:00:00+00'
  where id = '16200000-0000-4000-8000-000000000002';
  update public.projects
  set deleted_at = null
  where id = '16200000-0000-4000-8000-000000000002';
  update public.project_tasks
  set team_member_ids = pg_catalog.array_append(
    team_member_ids,
    '16100000-0000-4000-8000-000000000001'
  )
  where id = '16210000-0000-4000-8000-000000000002';
  update public.project_tasks
  set team_member_ids = pg_catalog.array_remove(
    team_member_ids,
    '16100000-0000-4000-8000-000000000001'
  )
  where id = '16210000-0000-4000-8000-000000000002';

  select revision.source_revision
    into strict v_after_relevant
  from private.agent_read_domain_revisions revision
  where revision.company_id = '16000000-0000-4000-8000-000000000001'
    and revision.domain = 'expenses';
  if v_after_relevant is distinct from v_before + 9 then
    raise exception 'expense_runtime_relevant_revision_invalid:%:%',
      v_before, v_after_relevant;
  end if;
  raise notice 'expense_runtime_source_revision_ok';
end;
$source_revision_contract$;

insert into private.mcp_oauth_clients(
  client_id, scope_ceiling, consent_catalog_revision, exposure_revision
) values (
  '16700000-0000-4000-8000-000000000001',
  array['ops.expenses.read','ops.jobs.read']::text[],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);
insert into private.mcp_oauth_grants(
  id, user_id, company_id, client_id, scopes, revision, accepted_labels,
  consent_catalog_revision, exposure_revision
) values (
  '16710000-0000-4000-8000-000000000001',
  '16100000-0000-4000-8000-000000000001',
  '16000000-0000-4000-8000-000000000001',
  '16700000-0000-4000-8000-000000000001',
  array['ops.expenses.read','ops.jobs.read']::text[],
  pg_catalog.repeat('a', 32),
  private.mcp_oauth_labels_for_scopes(
    array['ops.expenses.read','ops.jobs.read']::text[],
    '2026-08-22.mcp-consent-catalog.v1'
  ),
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);

create function pg_temp.expense_snapshot()
returns text
language sql stable set search_path = ''
as $$
  select permission_snapshot_revision
  from private.resolve_agent_actor_authority(
    '16100000-0000-4000-8000-000000000001',
    '16000000-0000-4000-8000-000000000001',
    array['expenses.approve','expenses.view','projects.view']::text[]
  );
$$;

create function pg_temp.expense_permissions()
returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(
           pg_catalog.jsonb_object_agg(
             permission.value ->> 'permission',
             permission.value ->> 'scope'
             order by permission.value ->> 'permission'
           ),
           '{}'::jsonb
         )
  from private.resolve_agent_actor_authority(
    '16100000-0000-4000-8000-000000000001',
    '16000000-0000-4000-8000-000000000001',
    array['expenses.approve','expenses.view','projects.view']::text[]
  ) authority
  left join lateral pg_catalog.jsonb_array_elements(
    authority.effective_permissions
  ) permission(value) on true;
$$;

create function pg_temp.expense_candidate(p_variant text)
returns jsonb
language sql stable set search_path = ''
as $$
  select private.agent_p2_expense_expected_candidate_v1(
    p_variant,
    pg_temp.expense_permissions()
  );
$$;

create function pg_temp.expense_list(
  p_view_kind text,
  p_project_id uuid default null,
  p_batch_disposition text default null,
  p_item_limit integer default 25,
  p_page_fetch_limit integer default null,
  p_source_limit integer default 501
) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select public.read_agent_expenses_as_system(
    'task16-runtime',
    '16000000-0000-4000-8000-000000000001',
    '16100000-0000-4000-8000-000000000001',
    '16710000-0000-4000-8000-000000000001',
    '16700000-0000-4000-8000-000000000001',
    pg_catalog.repeat('a', 32),
    array['ops.expenses.read','ops.jobs.read']::text[],
    pg_temp.expense_snapshot(),
    array['expenses.approve','expenses.view','projects.view']::text[],
    '2026-08-22.capability-manifest.v8',
    'list_expenses',
    'list_expenses:2026-08-22.v1',
    pg_temp.expense_candidate(p_view_kind),
    p_view_kind,
    p_project_id,
    p_batch_disposition,
    p_item_limit,
    coalesce(p_page_fetch_limit, p_item_limit + 1),
    p_source_limit,
    null,
    '[]'::jsonb,
    null,
    null
  );
$$;

create function pg_temp.expense_detail(p_expense_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select public.read_agent_expense_context_as_system(
    'task16-runtime',
    '16000000-0000-4000-8000-000000000001',
    '16100000-0000-4000-8000-000000000001',
    '16710000-0000-4000-8000-000000000001',
    '16700000-0000-4000-8000-000000000001',
    pg_catalog.repeat('a', 32),
    array['ops.expenses.read','ops.jobs.read']::text[],
    pg_temp.expense_snapshot(),
    array['expenses.approve','expenses.view','projects.view']::text[],
    '2026-08-22.capability-manifest.v8',
    'get_expense_context',
    'get_expense_context:2026-08-22.v1',
    pg_temp.expense_candidate('expense'),
    p_expense_id,
    501,
    25,
    26,
    1000
  );
$$;

do $own_authority_contract$
declare
  v_mine jsonb;
  v_detail jsonb;
  v_batches jsonb;
begin
  v_mine := pg_temp.expense_list('mine');
  v_detail := pg_temp.expense_detail(
    '16500000-0000-4000-8000-000000000001'
  );
  v_batches := pg_temp.expense_list(
    'reimbursement_batches', null, 'all'
  );
  if pg_catalog.jsonb_array_length(v_mine -> 'rows') <> 2
     or exists (
       select 1 from pg_catalog.jsonb_array_elements(v_mine -> 'rows') row(value)
       where row.value #>> '{item,submitted_by,team_member_ref,id}' <>
             '16100000-0000-4000-8000-000000000001'
     )
     or v_detail #>> '{result,review_reason,kind}' <> 'flag'
     or v_detail::text ~
       '(receipt_state|receipt_image_url|receipt_thumbnail_url|ocr_raw_data|payment_method|accounting_sync|flagged_by|approved_by|rejected_by|email|phone)'
     or pg_catalog.jsonb_array_length(v_batches -> 'rows') <> 1
     or v_batches #>> '{rows,0,item,batch_ref,id}' <>
          '16400000-0000-4000-8000-000000000001'
     or v_batches #>> '{rows,0,item,disposition}' <> 'owed' then
    raise exception 'expense_runtime_own_all_failed:%:%:%',
      v_mine, v_detail, v_batches;
  end if;
end;
$own_authority_contract$;

insert into public.user_permission_overrides(
  id, user_id, company_id, permission, scope, granted
) values (
  '16110000-0000-4000-8000-000000000003',
  '16100000-0000-4000-8000-000000000001',
  '16000000-0000-4000-8000-000000000001',
  'expenses.approve',
  'assigned',
  true
);
update public.user_permission_overrides
set scope = 'all'
where user_id = '16100000-0000-4000-8000-000000000001'
  and permission = 'expenses.view';

do $assigned_authority_contract$
declare
  v_pending jsonb;
  v_job jsonb;
  v_hidden_detail jsonb;
  v_attention jsonb;
begin
  v_pending := pg_temp.expense_list('pending_approval');
  v_job := pg_temp.expense_list(
    'job', '16200000-0000-4000-8000-000000000001'
  );
  v_hidden_detail := pg_temp.expense_detail(
    '16500000-0000-4000-8000-000000000003'
  );
  v_attention := private.agent_p2_expense_attention_v1(
    '16100000-0000-4000-8000-000000000001',
    '16000000-0000-4000-8000-000000000001',
    pg_temp.expense_snapshot(),
    array['expenses.approve','expenses.view','projects.view']::text[],
    pg_temp.expense_candidate('pending_approval'),
    pg_catalog.date_bin(
      interval '1 millisecond',
      pg_catalog.statement_timestamp(),
      timestamptz '2000-01-01 00:00:00+00'
    ),
    25,
    501
  );
  if pg_catalog.jsonb_array_length(v_pending -> 'rows') <> 1
     or v_pending #>> '{rows,0,item,expense_ref,id}' <>
          '16500000-0000-4000-8000-000000000002'
     or pg_catalog.jsonb_array_length(v_job -> 'rows') <> 2
     or v_hidden_detail #> '{result,review_reason}' is distinct from 'null'::jsonb
     or pg_catalog.jsonb_array_length(v_attention -> 'cards') <> 1
     or v_attention #>> '{cards,0,expense_ref,id}' <>
          '16500000-0000-4000-8000-000000000002'
     or v_attention -> 'source_revisions' is null
     or v_attention -> 'authorization_candidate' is distinct from
          pg_temp.expense_candidate('pending_approval') then
    raise exception 'expense_runtime_assigned_allocation_failed:%:%:%:%',
      v_pending, v_job, v_hidden_detail, v_attention;
  end if;
  raise notice 'expense_runtime_assigned_allocation_ok';
end;
$assigned_authority_contract$;

update public.user_permission_overrides
set scope = 'all'
where user_id = '16100000-0000-4000-8000-000000000001'
  and permission = 'expenses.approve';

do $all_authority_and_no_writes_contract$
declare
  v_company jsonb;
  v_pending jsonb;
  v_batches jsonb;
  v_detail jsonb;
  v_before jsonb;
  v_after jsonb;
begin
  select pg_catalog.jsonb_build_object(
           'expenses', (select pg_catalog.count(*) from public.expenses),
           'allocations', (select pg_catalog.count(*) from public.expense_project_allocations),
           'batches', (select pg_catalog.count(*) from public.expense_batches),
           'categories', (select pg_catalog.count(*) from public.expense_categories),
           'projects', (select pg_catalog.count(*) from public.projects),
           'tasks', (select pg_catalog.count(*) from public.project_tasks),
           'users', (select pg_catalog.count(*) from public.users)
         )
    into v_before;
  v_company := pg_temp.expense_list('company');
  v_pending := pg_temp.expense_list('pending_approval');
  v_batches := pg_temp.expense_list(
    'reimbursement_batches', null, 'all'
  );
  v_detail := pg_temp.expense_detail(
    '16500000-0000-4000-8000-000000000003'
  );
  select pg_catalog.jsonb_build_object(
           'expenses', (select pg_catalog.count(*) from public.expenses),
           'allocations', (select pg_catalog.count(*) from public.expense_project_allocations),
           'batches', (select pg_catalog.count(*) from public.expense_batches),
           'categories', (select pg_catalog.count(*) from public.expense_categories),
           'projects', (select pg_catalog.count(*) from public.projects),
           'tasks', (select pg_catalog.count(*) from public.project_tasks),
           'users', (select pg_catalog.count(*) from public.users)
         )
    into v_after;
  if pg_catalog.jsonb_array_length(v_company -> 'rows') <> 6
     or pg_catalog.jsonb_array_length(v_pending -> 'rows') <> 3
     or pg_catalog.jsonb_array_length(v_batches -> 'rows') <> 2
     or v_detail #>> '{result,review_reason,kind}' <> 'flag'
     or v_company::text ~ '(expense_count|employee_count)'
     or v_before is distinct from v_after then
    raise exception 'expense_runtime_all_or_no_writes_failed:%:%:%:%:%:%',
      v_company, v_pending, v_batches, v_detail, v_before, v_after;
  end if;
  raise notice 'expense_runtime_own_all_ok';
  raise notice 'expense_runtime_no_writes_ok';
end;
$all_authority_and_no_writes_contract$;

do $exact_bound_arguments_contract$
begin
  begin
    perform pg_temp.expense_list('company', null, null, 25, 27, 501);
    raise exception 'expense_runtime_expected_page_bound';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'agent_expense_read_invalid' then raise; end if;
  end;
  begin
    perform pg_temp.expense_list('company', null, null, 25, 26, 500);
    raise exception 'expense_runtime_expected_source_argument_bound';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'agent_expense_read_invalid' then raise; end if;
  end;
end;
$exact_bound_arguments_contract$;

insert into public.expenses(
  id, company_id, submitted_by, status, amount, currency, expense_date,
  updated_at
) values (
  '16500000-0000-4000-8000-000000000008',
  '16000000-0000-4000-8000-000000000001',
  '16100000-0000-4000-8000-000000000001',
  'draft',
  26.00,
  'CAD',
  '2026-08-01',
  '2026-08-01 00:00:00+00'
);
insert into public.expense_project_allocations(
  id, expense_id, project_id, percentage, amount
)
select (
         '16900000-0000-4000-8000-' ||
         pg_catalog.lpad(series.value::text, 12, '0')
       )::uuid,
       '16500000-0000-4000-8000-000000000008',
       '16200000-0000-4000-8000-000000000001',
       1,
       1.00
from pg_catalog.generate_series(1, 26) series(value);

do $physical_allocation_bound_contract$
begin
  if private.agent_p2_expense_assigned_approver_v1(
       '16100000-0000-4000-8000-000000000001',
       '16000000-0000-4000-8000-000000000001',
       '16500000-0000-4000-8000-000000000008'
     ) then
    raise exception 'expense_runtime_assignment_bound_not_enforced';
  end if;
  begin
    perform private.agent_p2_expense_item_v1(
      '16000000-0000-4000-8000-000000000001',
      '16500000-0000-4000-8000-000000000008',
      null,
      25
    );
    raise exception 'expense_runtime_expected_allocation_bound';
  exception
    when sqlstate '54000' then
      if sqlerrm <> 'agent_expense_result_bound' then raise; end if;
  end;
  raise notice 'expense_runtime_allocation_bounds_ok';
end;
$physical_allocation_bound_contract$;

insert into public.expense_batches(
  id, company_id, batch_number, period_start, period_end, status,
  submitted_by, total_amount, approved_amount
) values (
  '16400000-0000-4000-8000-000000000003',
  '16000000-0000-4000-8000-000000000001',
  'RB-BOUND',
  '2026-01-01',
  '2026-01-01',
  'approved',
  '16100000-0000-4000-8000-000000000001',
  501.00,
  501.00
);
insert into public.expenses(
  id, company_id, submitted_by, status, amount, currency, expense_date,
  batch_id, updated_at
)
select (
         '16800000-0000-4000-8000-' ||
         pg_catalog.lpad(series.value::text, 12, '0')
       )::uuid,
       '16000000-0000-4000-8000-000000000001',
       '16100000-0000-4000-8000-000000000001',
       'draft',
       1.00,
       'CAD',
       '2026-01-01',
       '16400000-0000-4000-8000-000000000003',
       '2026-08-01 00:00:00+00'
from pg_catalog.generate_series(1, 501) series(value);

do $physical_source_bound_contract$
begin
  if private.agent_p2_expense_batch_assigned_approver_v1(
       '16100000-0000-4000-8000-000000000001',
       '16000000-0000-4000-8000-000000000001',
       '16400000-0000-4000-8000-000000000003'
     ) then
    raise exception 'expense_runtime_batch_assignment_bound_not_enforced';
  end if;
  begin
    perform private.agent_p2_expense_batch_item_v1(
      '16000000-0000-4000-8000-000000000001',
      '16400000-0000-4000-8000-000000000003',
      true
    );
    raise exception 'expense_runtime_expected_batch_source_bound';
  exception
    when sqlstate '54000' then
      if sqlerrm <> 'agent_expense_source_query_bound' then raise; end if;
  end;
  begin
    perform pg_temp.expense_list('mine');
  exception
    when sqlstate '54000' then
      if sqlerrm = 'agent_expense_source_query_bound' then
        raise notice 'expense_runtime_bounds_ok';
        return;
      end if;
      raise;
  end;
  raise exception 'expense_runtime_source_bound_not_enforced';
end;
$physical_source_bound_contract$;

rollback;
