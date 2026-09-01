\set ON_ERROR_STOP on

create schema auth;
create schema private;

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'authenticated'
  ) then
    create role authenticated nologin;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'service_role'
  ) then
    create role service_role nologin;
  end if;
end;
$roles$;

create function auth.role()
returns text
language sql
stable
as $$ select 'service_role'::text $$;

create table private.agent_read_domain_revisions (
  company_id uuid not null,
  domain text not null,
  source_revision bigint not null,
  primary key (company_id, domain)
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
  revision text not null,
  scopes text[] not null,
  consent_catalog_revision text not null,
  exposure_revision text not null,
  accepted_labels jsonb not null,
  revoked_at timestamptz
);

create function private.mcp_oauth_labels_for_scopes(text[], text)
returns jsonb
language sql
immutable
strict
as $$ select '[]'::jsonb $$;

create function private.resolve_agent_actor_authority(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permissions text[]
) returns table(permission_snapshot_revision text, effective_permissions jsonb)
language sql
stable
as $function$
  select
    'sha256:' || repeat('a', 64),
    coalesce(
      jsonb_agg(
        jsonb_build_object('permission', permission, 'scope', 'all')
        order by permission
      ),
      '[]'::jsonb
    )
  from unnest(p_permissions) permission
  where p_actor_user_id = '11111111-1111-4111-8111-111111111111'::uuid
    and p_company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
$function$;

create function private.agent_currency_minor_exponent(text)
returns smallint
language plpgsql
immutable
strict
as $function$
begin
  case upper($1)
    when 'JPY' then return 0;
    when 'KWD' then return 3;
    when 'CLF' then return 4;
    when 'CAD' then return 2;
    else raise exception 'unknown currency' using errcode = '22023';
  end case;
end;
$function$;

create function private.agent_currency_minor_exponent_or_null(text)
returns smallint
language plpgsql
immutable
strict
as $function$
begin
  return private.agent_currency_minor_exponent($1);
exception
  when sqlstate '22023' then
    return null;
end;
$function$;

create function private.agent_money_to_minor_units(numeric, text)
returns bigint
language sql
immutable
strict
as $function$
  select round(
    $1 * power(10::numeric, private.agent_currency_minor_exponent_or_null($2))
  )::bigint;
$function$;

create function private.agent_read_domain_uuid_from_text(text)
returns uuid
language plpgsql
immutable
strict
as $function$
begin
  return $1::uuid;
exception when invalid_text_representation then
  return null;
end;
$function$;

create function private.agent_unambiguous_local_instant(
  timestamp without time zone,
  text
) returns timestamptz
language sql
stable
strict
as $function$
  select $1 at time zone $2;
$function$;

create table public.companies (
  id uuid primary key,
  deleted_at timestamptz,
  timezone text,
  currency text,
  default_work_start time without time zone,
  default_work_end time without time zone,
  skip_weekends_in_auto_schedule boolean
);

create table public.users (
  id uuid primary key,
  company_id uuid,
  is_active boolean,
  deleted_at timestamptz
);

create table public.roles (
  id uuid primary key,
  company_id uuid,
  name text
);

create table public.user_roles (
  user_id text,
  role_id uuid
);

create table public.projects (
  id uuid primary key,
  company_id uuid,
  deleted_at timestamptz
);

create table public.project_tasks (
  id uuid primary key,
  company_id uuid,
  project_id uuid,
  team_member_ids text[],
  start_date timestamptz,
  end_date timestamptz,
  start_time time without time zone,
  end_time time without time zone,
  all_day boolean,
  duration integer,
  status text,
  deleted_at timestamptz
);

create type public.site_visit_status as enum (
  'scheduled',
  'in_progress',
  'completed',
  'cancelled'
);

create table public.site_visits (
  id uuid primary key,
  company_id text,
  project_ref uuid,
  project_id text,
  scheduled_at timestamptz,
  duration_minutes integer,
  assignee_ids text[],
  booked_at timestamptz,
  status public.site_visit_status,
  deleted_at timestamptz
);

create table public.calendar_user_events (
  id uuid primary key,
  company_id text,
  user_id text,
  team_member_ids text[],
  type text,
  status text,
  start_date timestamptz,
  end_date timestamptz,
  all_day boolean,
  deleted_at timestamptz
);

create table public.invoices (
  id uuid primary key,
  company_id uuid,
  project_ref uuid,
  project_id uuid,
  deleted_at timestamptz
);

create table public.payments (
  id uuid primary key,
  company_id uuid,
  invoice_id uuid,
  amount numeric,
  payment_date date,
  voided_at timestamptz
);

create table public.expenses (
  id uuid primary key,
  company_id uuid,
  amount numeric,
  currency text,
  expense_date date,
  status text,
  deleted_at timestamptz
);

create table public.expense_project_allocations (
  id uuid primary key,
  expense_id uuid,
  project_id text,
  amount numeric,
  percentage numeric
);

insert into public.companies values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  null,
  'America/Vancouver',
  'CAD',
  '08:00',
  '16:00',
  true
);

insert into public.users values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true, null),
  ('12121212-1212-4212-8212-121212121212', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true, null);

insert into public.roles values (
  '22222222-2222-4222-8222-222222222222',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Installer'
);

insert into public.user_roles values
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'),
  ('12121212-1212-4212-8212-121212121212', '22222222-2222-4222-8222-222222222222');

insert into public.projects values
  ('31000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null),
  ('31000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null),
  ('31000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null);

insert into public.project_tasks values
  ('41000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '31000000-0000-4000-8000-000000000001', array['11111111-1111-4111-8111-111111111111'], '2026-06-08 00:00:00+00', '2026-06-08 00:00:00+00', null, null, true, 1, 'completed', null),
  ('41000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '31000000-0000-4000-8000-000000000001', array['11111111-1111-4111-8111-111111111111'], '2026-06-08 00:00:00+00', '2026-06-08 00:00:00+00', null, null, true, 1, 'completed', null),
  ('41000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '31000000-0000-4000-8000-000000000002', array['11111111-1111-4111-8111-111111111111'], '2026-07-06 00:00:00+00', '2026-07-06 00:00:00+00', null, null, true, 1, 'completed', null),
  ('41000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '31000000-0000-4000-8000-000000000003', array['11111111-1111-4111-8111-111111111111'], '2026-08-03 00:00:00+00', '2026-08-03 00:00:00+00', null, null, true, 1, 'completed', null);

insert into public.site_visits values (
  '51000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '31000000-0000-4000-8000-000000000001',
  null,
  '2026-06-15 16:00:00+00',
  60,
  array['11111111-1111-4111-8111-111111111111'],
  '2026-06-01 12:00:00+00',
  'completed',
  null
);

insert into public.calendar_user_events values (
  '61000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  array['12121212-1212-4212-8212-121212121212'],
  'time_off',
  'approved',
  '2026-06-29 07:00:00+00',
  '2026-06-30 06:59:59+00',
  true,
  null
);

insert into public.invoices values
  ('71000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '31000000-0000-4000-8000-000000000001', null, null),
  ('71000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '31000000-0000-4000-8000-000000000002', null, null),
  ('71000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '31000000-0000-4000-8000-000000000003', null, null);

insert into public.payments values
  ('81000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '71000000-0000-4000-8000-000000000001', 1000.00, '2026-06-16', null),
  ('81000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '71000000-0000-4000-8000-000000000002', 1000.00, '2026-07-07', null),
  ('81000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '71000000-0000-4000-8000-000000000003', 1000.00, '2026-08-04', null);

insert into private.agent_read_domain_revisions
select
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  domain,
  ordinality
from unnest(array[
  'availability',
  'company',
  'expenses',
  'payments',
  'sales_documents',
  'site_visits',
  'tasks',
  'team'
]::text[]) with ordinality source(domain, ordinality);

insert into private.mcp_oauth_clients values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  array[
    'ops.company.read',
    'ops.expenses.read',
    'ops.financial_documents.read',
    'ops.financials.read',
    'ops.jobs.read',
    'ops.payments.read',
    'ops.schedule.read',
    'ops.site_visits.read',
    'ops.tasks.read',
    'ops.team.read'
  ],
  '2026-08-31.mcp-consent.v1',
  '2026-08-31.mcp-exposure.v5',
  null
);

insert into private.mcp_oauth_grants values (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  repeat('b', 32),
  array[
    'ops.company.read',
    'ops.expenses.read',
    'ops.financial_documents.read',
    'ops.financials.read',
    'ops.jobs.read',
    'ops.payments.read',
    'ops.schedule.read',
    'ops.site_visits.read',
    'ops.tasks.read',
    'ops.team.read'
  ],
  '2026-08-31.mcp-consent.v1',
  '2026-08-31.mcp-exposure.v5',
  '[]'::jsonb,
  null
);
