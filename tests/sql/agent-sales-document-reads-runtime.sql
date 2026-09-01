\set ON_ERROR_STOP on

\if :{?agent_mcp_sales_bootstrap}
-- Disposable PostgreSQL 17 bootstrap for the Task 14 sales-document source
-- and read migrations. It intentionally defines only production-shaped
-- prerequisites; every behavioral row below remains rollback-only.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema auth;
create schema private;
create schema extensions;
create extension pgcrypto with schema extensions;

create function auth.role() returns text
language sql stable
set search_path = ''
as $$
  select nullif(pg_catalog.current_setting('request.jwt.claim.role', true), '');
$$;

create table public.companies (
  id uuid primary key,
  name text not null default 'Company',
  currency_code text not null default 'CAD',
  deleted_at timestamptz
);
create table public.clients (
  id uuid primary key,
  company_id uuid not null,
  deleted_at timestamptz,
  merged_into_client_id uuid
);
create table public.opportunities (
  id uuid primary key,
  company_id uuid not null,
  deleted_at timestamptz,
  merged_into_opportunity_id uuid
);
create table public.projects (
  id uuid primary key,
  company_id uuid not null,
  deleted_at timestamptz
);
create table public.users (
  id uuid primary key,
  company_id uuid not null,
  is_active boolean not null default true
);
create table public.user_permission_overrides (
  id uuid primary key,
  user_id uuid not null,
  company_id uuid not null,
  permission text not null,
  scope text not null,
  granted boolean not null
);
create table public.estimates (
  id uuid primary key,
  company_id uuid not null,
  opportunity_id uuid,
  project_id text,
  project_ref uuid,
  client_id uuid not null,
  client_ref uuid,
  estimate_number text not null,
  title text,
  client_message text,
  terms text,
  status text not null,
  issue_date date not null,
  expiration_date date,
  total numeric(12,2) not null,
  updated_at timestamptz not null default pg_catalog.statement_timestamp(),
  deleted_at timestamptz
);
create table public.invoices (
  id uuid primary key,
  company_id uuid not null,
  opportunity_id uuid,
  project_id uuid,
  project_ref uuid,
  client_id uuid not null,
  client_ref uuid,
  invoice_number text not null,
  subject text,
  client_message text,
  terms text,
  footer text,
  status text not null,
  issue_date date not null,
  due_date date not null,
  paid_at timestamptz,
  total numeric(12,2) not null,
  amount_paid numeric(12,2) not null,
  balance_due numeric(12,2) not null,
  updated_at timestamptz not null default pg_catalog.statement_timestamp(),
  deleted_at timestamptz
);
create table public.line_items (
  id uuid primary key,
  company_id uuid not null,
  estimate_id uuid,
  invoice_id uuid,
  name text not null,
  description text,
  quantity numeric(10,3) not null,
  unit text,
  unit_price numeric(12,2) not null,
  line_total numeric(12,2),
  discount_percent numeric(5,2),
  is_taxable boolean,
  is_optional boolean,
  is_selected boolean,
  sort_order integer not null,
  category text
);
create table public.payment_milestones (
  id uuid primary key,
  estimate_id uuid not null,
  name text not null,
  type text not null,
  value numeric(12,2) not null,
  amount numeric(12,2) not null,
  sort_order integer not null,
  invoice_id uuid,
  paid_at timestamptz
);

create table private.agent_read_domains (
  domain text primary key
);
insert into private.agent_read_domains(domain) values ('sales_documents');
create table private.agent_read_domain_revisions (
  company_id uuid not null,
  domain text not null,
  source_revision bigint not null default 0,
  primary key(company_id, domain)
);
create table private.agent_operational_read_revisions (
  company_id uuid primary key,
  source_revision bigint not null default 0
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
create table private.test_entity_access (
  actor_user_id uuid not null,
  company_id uuid not null,
  entity_kind text not null,
  entity_id uuid not null,
  can_view boolean not null,
  primary key(actor_user_id, company_id, entity_kind, entity_id)
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
    and actor.is_active;
$$;

create function private.mcp_oauth_labels_for_scopes(text[], text)
returns text[]
language sql immutable set search_path = ''
as $$ select coalesce($1, array[]::text[]) $$;

create function private.agent_user_can_access_entity(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_entity_kind text,
  p_entity_id uuid,
  p_action text
) returns boolean
language sql stable security invoker set search_path = ''
as $$
  select p_action = 'view' and exists (
    select 1
    from public.user_permission_overrides permission
    where permission.user_id = p_actor_user_id
      and permission.company_id = p_company_id
      and permission.granted
      and permission.permission = case p_entity_kind
        when 'opportunity' then 'pipeline.view'
        when 'project' then 'projects.view'
      end
      and (
        permission.scope = 'all'
        or permission.scope = 'assigned' and exists (
          select 1
          from private.test_entity_access access
          where access.actor_user_id = p_actor_user_id
            and access.company_id = p_company_id
            and access.entity_kind = p_entity_kind
            and access.entity_id = p_entity_id
            and access.can_view
        )
      )
  );
$$;

create function private.agent_p2_optional_canonical_text(
  p_value text,
  p_max_scalars integer,
  p_max_bytes integer,
  p_allow_whitespace boolean
) returns text
language sql immutable security invoker set search_path = ''
as $$
  select case
    when p_value is null then null
    when p_value = '' then null
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

\ir ../../supabase/migrations/20260829024746_agent_sales_document_sources.sql
\ir ../../supabase/migrations/20260829024749_agent_sales_document_reads.sql
\endif

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local request.jwt.claim.role = 'service_role';

do $catalog_contract$
declare
  v_signature text;
  v_index text;
  v_plan json;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000
     or pg_catalog.current_setting('server_version_num')::integer >= 180000 then
    raise exception 'agent_sales_document_runtime_requires_postgresql_17';
  end if;

  foreach v_signature in array array[
    'private.bump_agent_sales_document_source_revision()',
    'private.agent_p2_sales_hash_ref(text,jsonb)',
    'private.agent_p2_sales_money_minor_or_null_v1(numeric,text)',
    'private.agent_p2_sales_rfc3339_or_null_v1(timestamp with time zone)',
    'private.agent_p2_sales_expected_candidate_v1(text,jsonb)',
    'private.agent_p2_sales_proof_candidates_v1(jsonb,jsonb)',
    'private.agent_p2_sales_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[])',
    'private.agent_p2_sales_document_header_source_v1(uuid,text[],uuid,text,uuid,uuid,text,integer)',
    'private.agent_p2_sales_authorized_path_v1(uuid,uuid,jsonb,text,uuid,uuid)',
    'private.agent_p2_sales_document_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],uuid,text,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,uuid)',
    'private.agent_p2_sales_document_lines_v1(uuid,text,uuid,text,integer)',
    'private.agent_p2_sales_document_milestones_v1(uuid,uuid,text,integer)',
    'private.agent_p2_sales_document_detail_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,integer,integer,integer,integer,integer)',
    'private.agent_p2_sales_document_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[],timestamp with time zone,integer,integer)',
    'public.read_agent_sales_documents_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],uuid,text,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,uuid)',
    'public.read_agent_sales_document_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,integer,integer,integer,integer,integer)'
  ]::text[] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'agent_sales_document_runtime_function_missing:%',
        v_signature;
    end if;
  end loop;

  foreach v_index in array array[
    'idx_estimates_agent_sales_history_v1',
    'idx_invoices_agent_sales_history_v1',
    'idx_line_items_agent_estimate_order_v1',
    'idx_line_items_agent_invoice_order_v1',
    'idx_payment_milestones_agent_estimate_order_v1'
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
    ) then
      raise exception 'agent_sales_document_runtime_index_invalid:%', v_index;
    end if;
  end loop;

  perform pg_catalog.set_config('enable_seqscan', 'off', true);
  execute $plan$
    explain (format json, costs off)
    select estimate.id
    from public.estimates estimate
    where estimate.company_id =
      '11111111-1111-4111-8111-111111111111'::uuid
      and estimate.deleted_at is null
    order by pg_catalog.date_bin(
      interval '1 millisecond', estimate.updated_at,
      timestamptz '2000-01-01 00:00:00+00'
    ) desc, estimate.id
    limit 501
  $plan$ into v_plan;
  if v_plan::text not like '%idx_estimates_agent_sales_history_v1%' then
    raise exception 'agent_sales_document_estimate_plan_invalid';
  end if;
  execute $plan$
    explain (format json, costs off)
    select invoice.id
    from public.invoices invoice
    where invoice.company_id =
      '11111111-1111-4111-8111-111111111111'::uuid
      and invoice.deleted_at is null
    order by pg_catalog.date_bin(
      interval '1 millisecond', invoice.updated_at,
      timestamptz '2000-01-01 00:00:00+00'
    ) desc, invoice.id
    limit 501
  $plan$ into v_plan;
  if v_plan::text not like '%idx_invoices_agent_sales_history_v1%' then
    raise exception 'agent_sales_document_invoice_plan_invalid';
  end if;
  raise notice 'index_plans';
end;
$catalog_contract$;

insert into public.companies(id, name, currency_code) values
  ('11111111-1111-4111-8111-111111111111', 'Alpha', 'CAD'),
  ('22222222-2222-4222-8222-222222222222', 'Bravo', 'USD');
insert into public.users(id, company_id, first_name, last_name) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'Sales', 'Reader'
);
insert into public.user_permission_overrides(
  id, user_id, company_id, permission, scope, granted
) values
  ('a0000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','estimates.view','assigned',true),
  ('a0000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','invoices.view','assigned',true),
  ('a0000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','pipeline.view','assigned',true),
  ('a0000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','projects.view','assigned',true),
  ('a0000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','projects.view_financials','all',true);

insert into public.clients(id, company_id, name) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd01','11111111-1111-4111-8111-111111111111','Alpha client'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd02','22222222-2222-4222-8222-222222222222','Bravo client');
insert into public.opportunities(id, company_id, title, assigned_to) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01','11111111-1111-4111-8111-111111111111','Assigned opportunity','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02','11111111-1111-4111-8111-111111111111','Hidden opportunity',null);
insert into public.projects(id, company_id, title) values
  ('f1111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','Assigned project'),
  ('f2222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Hidden project');
insert into public.project_tasks(
  id, company_id, project_id, team_member_ids
) values (
  'f1111111-1111-4111-8111-111111111112',
  '11111111-1111-4111-8111-111111111111',
  'f1111111-1111-4111-8111-111111111111',
  array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']::text[]
);

insert into public.estimates(
  id, company_id, opportunity_id, project_id, project_ref, client_id,
  client_ref, estimate_number, title, client_message, terms, status,
  issue_date, expiration_date, total, updated_at
) values
  ('10000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',null,null,'dddddddd-dddd-4ddd-8ddd-dddddddddd01','dddddddd-dddd-4ddd-8ddd-dddddddddd01','EST-001','Opportunity estimate','Call before arrival','Net 15','sent','2026-08-01','2026-09-10',1200.00,'2026-08-20 12:00:00+00'),
  ('10000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',null,'f1111111-1111-4111-8111-111111111111','f1111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddd01','dddddddd-dddd-4ddd-8ddd-dddddddddd01','EST-002','Project estimate','Approved work','Due on completion','expired','2026-08-01','2026-08-27',2500.00,'2026-08-19 12:00:00+00'),
  ('10000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',null,'f2222222-2222-4222-8222-222222222222','f2222222-2222-4222-8222-222222222222','dddddddd-dddd-4ddd-8ddd-dddddddddd01','dddddddd-dddd-4ddd-8ddd-dddddddddd01','EST-003','Hidden project estimate',null,null,'draft','2026-08-01',null,800.00,'2026-08-18 12:00:00+00'),
  ('10000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111',null,null,null,'dddddddd-dddd-4ddd-8ddd-dddddddddd01','dddddddd-dddd-4ddd-8ddd-dddddddddd01','EST-004','Unlinked estimate',null,null,'draft','2026-08-01',null,400.00,'2026-08-17 12:00:00+00');

insert into public.invoices(
  id, company_id, opportunity_id, project_id, project_ref, client_id,
  client_ref, invoice_number, subject, client_message, terms, footer,
  status, issue_date, due_date, paid_at, total, amount_paid, balance_due,
  updated_at
) values (
  '20000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',null,'f1111111-1111-4111-8111-111111111111','f1111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddd01','dddddddd-dddd-4ddd-8ddd-dddddddddd01','INV-001','Project invoice','Thanks','Net 15','OPS','awaiting_payment','2026-08-01','2026-08-10',null,3000.00,500.00,2500.00,'2026-08-21 12:00:00+00'
);

insert into public.line_items(
  id, company_id, estimate_id, invoice_id, name, description, quantity,
  unit, unit_price, discount_percent, is_taxable, is_optional,
  is_selected, sort_order
) values
  ('30000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000002',null,'Rail','Guard rail',12.500,'ft',100.00,0,true,false,true,2),
  ('30000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','10000000-0000-4000-8000-000000000002',null,'Decking','Deck surface',10.000,'sq ft',125.00,0,true,false,true,1),
  ('30000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',null,'20000000-0000-4000-8000-000000000001','Invoice work',null,1.000,'each',3000.00,0,true,false,true,0);
insert into public.payment_milestones(
  id, estimate_id, name, type, value, amount, sort_order, invoice_id,
  paid_at, expected_date
) values
  ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Completion','fixed',1250.00,1250.00,2,null,'2026-08-20 12:00:00+00','2026-08-20'),
  ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','Deposit','percentage',50.00,1250.00,1,null,null,'2026-08-05');

insert into private.agent_operational_read_revisions(
  company_id, source_revision
) values
  ('11111111-1111-4111-8111-111111111111', 17),
  ('22222222-2222-4222-8222-222222222222', 23);
insert into private.mcp_oauth_clients(
  client_id, client_name, redirect_uris, token_endpoint_auth_method,
  grant_types, response_types, scope, registration_source,
  scope_ceiling, consent_catalog_revision, exposure_revision
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'Sales document runtime',
  array['https://sales-document-runtime.ops.invalid/callback']::text[],
  'none',
  array['authorization_code', 'refresh_token']::text[],
  array['code']::text[],
  'ops.financial_documents.read',
  'manual',
  array['ops.financial_documents.read']::text[],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);
insert into private.mcp_oauth_grants(
  id, user_id, company_id, client_id, scopes, revision, accepted_labels,
  consent_catalog_revision, exposure_revision
) values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  array['ops.financial_documents.read']::text[],
  pg_catalog.repeat('a', 32),
  private.mcp_oauth_labels_for_scopes(
    array['ops.financial_documents.read']::text[],
    '2026-08-22.mcp-consent-catalog.v1'
  ),
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);

create function pg_temp.task14_snapshot()
returns text
language sql stable set search_path = ''
as $$
  select permission_snapshot_revision
  from private.resolve_agent_actor_authority(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    array[
      'estimates.view','invoices.view','pipeline.view','projects.view',
      'projects.view_financials'
    ]::text[]
  );
$$;

create function pg_temp.task14_candidates(
  p_document_scope text default 'assigned',
  p_financial_scope text default 'all'
) returns jsonb
language sql stable set search_path = ''
as $$
  select pg_catalog.jsonb_agg(candidate.value order by kind.kind)
  from (values ('estimate'), ('invoice')) kind(kind)
  cross join lateral (
    select pg_catalog.jsonb_build_object(
      'variant_key', kind.kind,
      'required_oauth_scopes',
        pg_catalog.jsonb_build_array('ops.financial_documents.read'),
      'resolved_permission_scopes',
        pg_catalog.jsonb_build_object(
          case kind.kind when 'estimate' then 'estimates.view'
            else 'invoices.view' end,
          p_document_scope,
          'pipeline.view', 'assigned',
          'projects.view', 'assigned'
        ) || case when p_financial_scope = 'all'
          then pg_catalog.jsonb_build_object(
            'projects.view_financials', 'all'
          )
          else '{}'::jsonb
        end,
      'satisfied_permission_group_indexes',
        case when p_document_scope = 'all' and p_financial_scope = 'all'
          then '[0,1,2]'::jsonb
          when p_document_scope = 'all'
          then '[0,2]'::jsonb
          when p_financial_scope = 'all'
          then '[0,1]'::jsonb
          else '[0]'::jsonb
        end
    ) as value
  ) candidate;
$$;

create function pg_temp.task14_list(
  p_item_limit integer default 25,
  p_cursor_read_at timestamptz default null,
  p_cursor_source_revisions jsonb default '[]'::jsonb,
  p_after_updated_at timestamptz default null,
  p_after_document_kind text default null,
  p_after_document_id uuid default null,
  p_candidates jsonb default null,
  p_customer_id uuid default null,
  p_job_kind text default null,
  p_job_id uuid default null
) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select public.read_agent_sales_documents_as_system(
    'task14-runtime',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    pg_catalog.repeat('a', 32),
    array['ops.financial_documents.read']::text[],
    pg_temp.task14_snapshot(),
    array[
      'estimates.view','invoices.view','pipeline.view','projects.view',
      'projects.view_financials'
    ]::text[],
    '2026-08-22.capability-manifest.v8',
    'list_sales_documents',
    'list_sales_documents:2026-08-22.v1',
    coalesce(p_candidates, pg_temp.task14_candidates()),
    array['estimate','invoice']::text[],
    p_customer_id, p_job_kind, p_job_id,
    p_item_limit, p_item_limit + 1, 501,
    p_cursor_read_at, p_cursor_source_revisions,
    p_after_updated_at, p_after_document_kind, p_after_document_id
  );
$$;

create function pg_temp.task14_detail(
  p_document_kind text,
  p_document_id uuid
) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select public.read_agent_sales_document_as_system(
    'task14-runtime',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    pg_catalog.repeat('a', 32),
    array['ops.financial_documents.read']::text[],
    pg_temp.task14_snapshot(),
    array[
      'estimates.view','invoices.view','pipeline.view','projects.view',
      'projects.view_financials'
    ]::text[],
    '2026-08-22.capability-manifest.v8',
    'get_sales_document',
    'get_sales_document:2026-08-22.v1',
    (select pg_catalog.jsonb_build_array(candidate.value)
     from pg_catalog.jsonb_array_elements(
       pg_temp.task14_candidates()
     ) candidate(value)
     where candidate.value ->> 'variant_key' = p_document_kind),
    p_document_kind, p_document_id, 501, 50, 51, 32, 33
  );
$$;

do $list_estimate_and_invoice$
declare
  v_result jsonb;
begin
  v_result := pg_temp.task14_list();
  if pg_catalog.jsonb_array_length(v_result -> 'rows') <> 3
     or v_result #>> '{rows,0,item,document_ref,kind}' <> 'invoice'
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_result -> 'rows') row(value)
       where row.value #>> '{item,document_ref,kind}' = 'estimate'
     )
     or v_result #>> '{rows,0,item,total,currency}' <> 'CAD'
     or (v_result #>> '{rows,0,item,total,amount_minor}')::bigint < 0
     or v_result ->> 'collection_proof_ref'
          !~ '^ops_proof:v1:[0-9a-f]{64}$' then
    raise exception 'list_estimate_and_invoice_failed:%', v_result;
  end if;
  raise notice 'list_estimate_and_invoice';
end;
$list_estimate_and_invoice$;

do $customer_and_job_filters$
declare
  v_project jsonb;
  v_nonmatch jsonb;
begin
  v_project := pg_temp.task14_list(
    p_customer_id => 'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
    p_job_kind => 'project',
    p_job_id => 'f1111111-1111-4111-8111-111111111111'
  );
  if pg_catalog.jsonb_array_length(v_project -> 'rows') <> 2
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_project -> 'rows') row(value)
       where row.value #>> '{item,customer_ref,id}' <>
               'dddddddd-dddd-4ddd-8ddd-dddddddddd01'
          or row.value #>> '{item,job_ref,kind}' <> 'project'
          or row.value #>> '{item,job_ref,id}' <>
               'f1111111-1111-4111-8111-111111111111'
     ) then
    raise exception 'customer_and_job_filters_project_failed:%', v_project;
  end if;

  v_nonmatch := pg_temp.task14_list(
    p_customer_id => 'dddddddd-dddd-4ddd-8ddd-dddddddddd02'
  );
  if pg_catalog.jsonb_array_length(v_nonmatch -> 'rows') <> 0 then
    raise exception 'customer_and_job_filters_nonmatch_failed:%', v_nonmatch;
  end if;
  raise notice 'customer_and_job_filters';
end;
$customer_and_job_filters$;

do $project_financials_all_required$
declare
  v_result jsonb;
begin
  update public.user_permission_overrides
  set scope = 'assigned'
  where permission = 'projects.view_financials';
  v_result := pg_temp.task14_list(
    p_candidates => pg_temp.task14_candidates('assigned', null)
  );
  if pg_catalog.jsonb_array_length(v_result -> 'rows') <> 1
     or v_result #>> '{rows,0,authority_path}' <> 'opportunity' then
    raise exception 'project_financials_all_required_failed:%', v_result;
  end if;
  update public.user_permission_overrides
  set scope = 'all'
  where permission = 'projects.view_financials';
  raise notice 'project_financials_all_required';
end;
$project_financials_all_required$;

do $assigned_membership_required$
declare
  v_before jsonb;
  v_after jsonb;
begin
  v_before := pg_temp.task14_list();
  insert into public.project_tasks(
    id, company_id, project_id, team_member_ids
  ) values (
    'f2222222-2222-4222-8222-222222222223',
    '11111111-1111-4111-8111-111111111111',
    'f2222222-2222-4222-8222-222222222222',
    array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']::text[]
  );
  v_after := pg_temp.task14_list();
  if pg_catalog.jsonb_array_length(v_after -> 'rows') <>
       pg_catalog.jsonb_array_length(v_before -> 'rows') + 1 then
    raise exception 'assigned_membership_required_failed';
  end if;
  delete from public.project_tasks
  where id = 'f2222222-2222-4222-8222-222222222223';
  raise notice 'assigned_membership_required';
end;
$assigned_membership_required$;

do $keyset_has_no_duplicates$
declare
  v_first jsonb;
  v_second jsonb;
  v_predecessor jsonb;
begin
  v_first := pg_temp.task14_list(2);
  v_predecessor := v_first #> '{rows,1,predecessor}';
  v_second := pg_temp.task14_list(
    2,
    (v_first ->> 'read_at')::timestamptz,
    v_first -> 'source_revisions',
    (v_predecessor #>> '{order,0}')::timestamptz,
    v_predecessor #>> '{order,1}',
    (v_predecessor #>> '{order,2}')::uuid
  );
  if pg_catalog.jsonb_array_length(v_first -> 'rows') <> 2
     or pg_catalog.jsonb_array_length(v_second -> 'rows') <> 1
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_first -> 'rows') first_row(value)
       join pg_catalog.jsonb_array_elements(v_second -> 'rows') second_row(value)
         on first_row.value #>> '{item,document_ref,id}' =
              second_row.value #>> '{item,document_ref,id}'
     ) then
    raise exception 'keyset_has_no_duplicates_failed';
  end if;
  raise notice 'keyset_has_no_duplicates';
end;
$keyset_has_no_duplicates$;

do $ordered_lines_and_milestones$
declare
  v_result jsonb;
  v_invoice jsonb;
begin
  v_result := pg_temp.task14_detail(
    'estimate', '10000000-0000-4000-8000-000000000002'
  );
  if v_result #>> '{result,lines,0,line_ref,id}' <>
       '30000000-0000-4000-8000-000000000001'
     or v_result #>> '{result,lines,1,line_ref,id}' <>
       '30000000-0000-4000-8000-000000000002'
     or v_result #>> '{result,milestones,0,milestone_ref,id}' <>
       '40000000-0000-4000-8000-000000000001'
     or v_result #>> '{result,milestones,1,milestone_ref,id}' <>
       '40000000-0000-4000-8000-000000000002'
     or v_result #>> '{result,lines,0,quantity_milliunits}' <> '10000'
     or v_result #>> '{result,milestones,0,schedule_value,basis_points}' <>
       '5000'
     or v_result ->> 'proof_ref' !~ '^ops_proof:v1:[0-9a-f]{64}$'
     or v_result ->> 'evidence_ref' !~ '^ops_evidence:v1:[0-9a-f]{64}$' then
    raise exception 'ordered_lines_and_milestones_failed:%', v_result;
  end if;
  v_invoice := pg_temp.task14_detail(
    'invoice', '20000000-0000-4000-8000-000000000001'
  );
  if v_invoice #> '{result,milestones}' is not null
     or v_invoice #>> '{result,document,balance_due,amount_minor}' <>
       '250000' then
    raise exception 'invoice_detail_failed:%', v_invoice;
  end if;
  update public.estimates
  set client_message = null,
      terms = null
  where id = '10000000-0000-4000-8000-000000000002';
  v_result := pg_temp.task14_detail(
    'estimate', '10000000-0000-4000-8000-000000000002'
  );
  if v_result #> '{result,client_text}' <> '[]'::jsonb then
    raise exception 'empty_client_text_failed:%', v_result;
  end if;
  update public.estimates
  set client_message = 'Approved work',
      terms = 'Due on completion'
  where id = '10000000-0000-4000-8000-000000000002';
  raise notice 'ordered_lines_and_milestones';
end;
$ordered_lines_and_milestones$;

do $attention_is_bounded$
declare
  v_result jsonb;
begin
  v_result := private.agent_p2_sales_document_attention_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    pg_catalog.repeat('a', 32),
    array['ops.financial_documents.read']::text[],
    pg_temp.task14_snapshot(),
    array[
      'estimates.view','invoices.view','pipeline.view','projects.view',
      'projects.view_financials'
    ]::text[],
    pg_temp.task14_candidates(),
    array['estimate','invoice']::text[],
    timestamptz '2026-08-28 12:00:00+00',
    501,
    1
  );
  if pg_catalog.jsonb_array_length(v_result -> 'cards') > 1
     or v_result #>> '{cards,0,attention_kind}' <> 'invoice_overdue' then
    raise exception 'attention_is_bounded_failed:%', v_result;
  end if;
  raise notice 'attention_is_bounded';
end;
$attention_is_bounded$;

do $stale_revision_fails_closed$
declare
  v_first jsonb;
  v_predecessor jsonb;
begin
  v_first := pg_temp.task14_list(2);
  v_predecessor := v_first #> '{rows,1,predecessor}';
  update public.estimates
  set title = 'Revision changed',
      updated_at = updated_at + interval '1 millisecond'
  where id = '10000000-0000-4000-8000-000000000001';
  begin
    perform pg_temp.task14_list(
      2,
      (v_first ->> 'read_at')::timestamptz,
      v_first -> 'source_revisions',
      (v_predecessor #>> '{order,0}')::timestamptz,
      v_predecessor #>> '{order,1}',
      (v_predecessor #>> '{order,2}')::uuid
    );
    raise exception 'stale_revision_fails_closed_accepted';
  exception when sqlstate '40001' then
    if sqlerrm <> 'agent_sales_document_read_stale' then raise; end if;
  end;
  raise notice 'stale_revision_fails_closed';
end;
$stale_revision_fails_closed$;

do $source_501_fails_closed$
begin
  insert into public.estimates(
    id, company_id, opportunity_id, client_id, client_ref, estimate_number,
    status, issue_date, total, updated_at
  )
  select (
           '90000000-0000-4000-8000-' ||
           pg_catalog.lpad(series.value::text, 12, '0')
         )::uuid,
         '11111111-1111-4111-8111-111111111111',
         'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',
         'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
         'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
         'BOUND-' || series.value::text,
         'draft', '2026-08-01', 1.00,
         timestamptz '2026-08-01 00:00:00+00' +
           series.value * interval '1 millisecond'
  from pg_catalog.generate_series(1, 496) series(value);
  begin
    perform pg_temp.task14_list();
    raise exception 'source_501_fails_closed_accepted';
  exception when sqlstate '54000' then
    if sqlerrm <> 'agent_sales_document_source_bound' then raise; end if;
  end;
  delete from public.estimates
  where id::text like '90000000-0000-4000-8000-%';
  raise notice 'source_501_fails_closed';
end;
$source_501_fails_closed$;

do $unlike_currency_fails_closed$
declare
  v_result jsonb;
begin
  update public.estimates
  set total = 800.50
  where id = '10000000-0000-4000-8000-000000000003';
  update public.companies
  set currency_code = 'JPY'
  where id = '11111111-1111-4111-8111-111111111111';
  v_result := pg_temp.task14_list();
  if pg_catalog.jsonb_array_length(v_result -> 'rows') <> 3 then
    raise exception 'hidden_unlike_currency_leaked:%', v_result;
  end if;
  begin
    perform pg_temp.task14_detail(
      'estimate', '10000000-0000-4000-8000-000000000003'
    );
    raise exception 'hidden_unlike_currency_detail_accepted';
  exception when sqlstate 'P0002' then
    if sqlerrm <> 'agent_sales_document_not_found_or_not_visible' then
      raise;
    end if;
  end;
  update public.estimates
  set total = 2500.50
  where id = '10000000-0000-4000-8000-000000000002';
  begin
    perform pg_temp.task14_detail(
      'estimate', '10000000-0000-4000-8000-000000000002'
    );
    raise exception 'authorized_unlike_currency_detail_accepted';
  exception when sqlstate '22023' then
    if sqlerrm <> 'agent_sales_document_source_data_invalid' then raise; end if;
  end;
  update public.estimates
  set total = case id
    when '10000000-0000-4000-8000-000000000002'::uuid then 2500.00
    else 800.00
  end
  where id in (
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003'
  );
  update public.companies
  set currency_code = 'ZZZ'
  where id = '11111111-1111-4111-8111-111111111111';
  begin
    perform pg_temp.task14_list();
    raise exception 'unlike_currency_fails_closed_accepted';
  exception when sqlstate '22023' then
    if sqlerrm <> 'agent_sales_document_source_data_invalid' then raise; end if;
  end;
  update public.companies
  set currency_code = 'CAD'
  where id = '11111111-1111-4111-8111-111111111111';
  raise notice 'unlike_currency_fails_closed';
end;
$unlike_currency_fails_closed$;

do $noncanonical_dates_fail_closed$
declare
  v_result jsonb;
begin
  update public.estimates
  set updated_at = timestamptz '0001-01-01 00:00:00+00 BC'
  where id = '10000000-0000-4000-8000-000000000003';
  v_result := pg_temp.task14_list();
  if pg_catalog.jsonb_array_length(v_result -> 'rows') <> 3 then
    raise exception 'hidden_noncanonical_timestamp_leaked:%', v_result;
  end if;
  begin
    perform pg_temp.task14_detail(
      'estimate', '10000000-0000-4000-8000-000000000003'
    );
    raise exception 'hidden_noncanonical_timestamp_detail_accepted';
  exception when sqlstate 'P0002' then
    if sqlerrm <> 'agent_sales_document_not_found_or_not_visible' then
      raise;
    end if;
  end;
  update public.estimates
  set updated_at = timestamptz '2026-08-18 12:00:00+00'
  where id = '10000000-0000-4000-8000-000000000003';

  update public.invoices
  set paid_at = timestamptz '0001-01-01 00:00:00+00 BC'
  where id = '20000000-0000-4000-8000-000000000001';
  begin
    perform pg_temp.task14_detail(
      'invoice', '20000000-0000-4000-8000-000000000001'
    );
    raise exception 'authorized_noncanonical_timestamp_accepted';
  exception when sqlstate '22023' then
    if sqlerrm <> 'agent_sales_document_source_data_invalid' then raise; end if;
  end;
  update public.invoices
  set paid_at = null
  where id = '20000000-0000-4000-8000-000000000001';

  update public.estimates
  set issue_date = date '0001-01-01 BC'
  where id = '10000000-0000-4000-8000-000000000002';
  begin
    perform pg_temp.task14_detail(
      'estimate', '10000000-0000-4000-8000-000000000002'
    );
    raise exception 'authorized_noncanonical_date_accepted';
  exception when sqlstate '22023' then
    if sqlerrm <> 'agent_sales_document_source_data_invalid' then raise; end if;
  end;
  update public.estimates
  set issue_date = date '2026-08-01'
  where id = '10000000-0000-4000-8000-000000000002';
  raise notice 'noncanonical_dates_fail_closed';
end;
$noncanonical_dates_fail_closed$;

do $private_acl$
declare
  v_signature text;
  v_entries text[];
begin
  foreach v_signature in array array[
    'private.bump_agent_sales_document_source_revision()',
    'private.agent_p2_sales_hash_ref(text,jsonb)',
    'private.agent_p2_sales_money_minor_or_null_v1(numeric,text)',
    'private.agent_p2_sales_rfc3339_or_null_v1(timestamp with time zone)',
    'private.agent_p2_sales_expected_candidate_v1(text,jsonb)',
    'private.agent_p2_sales_proof_candidates_v1(jsonb,jsonb)',
    'private.agent_p2_sales_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[])',
    'private.agent_p2_sales_document_header_source_v1(uuid,text[],uuid,text,uuid,uuid,text,integer)',
    'private.agent_p2_sales_authorized_path_v1(uuid,uuid,jsonb,text,uuid,uuid)',
    'private.agent_p2_sales_document_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],uuid,text,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,uuid)',
    'private.agent_p2_sales_document_lines_v1(uuid,text,uuid,text,integer)',
    'private.agent_p2_sales_document_milestones_v1(uuid,uuid,text,integer)',
    'private.agent_p2_sales_document_detail_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,integer,integer,integer,integer,integer)',
    'private.agent_p2_sales_document_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[],timestamp with time zone,integer,integer)'
  ]::text[] loop
    select coalesce(
             pg_catalog.array_agg(role_row.rolname order by role_row.rolname),
             array[]::text[]
           )
      into v_entries
    from pg_catalog.pg_proc function_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function_row.proacl,
        pg_catalog.acldefault('f', function_row.proowner)
      )
    ) acl
    left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
    where function_row.oid = pg_catalog.to_regprocedure(v_signature)::oid
      and acl.grantee <> function_row.proowner;
    if v_entries <> array[]::text[] then
      raise exception 'private_acl_failed:%:%', v_signature, v_entries;
    end if;
  end loop;
  if not pg_catalog.has_function_privilege(
       'service_role',
       'public.read_agent_sales_documents_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],uuid,text,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,uuid)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.read_agent_sales_document_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,integer,integer,integer,integer,integer)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.read_agent_sales_documents_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text[],uuid,text,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.read_agent_sales_document_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,integer,integer,integer,integer,integer)',
       'EXECUTE'
     ) then
    raise exception 'private_acl_failed:public';
  end if;
  raise notice 'private_acl';
end;
$private_acl$;

rollback;
