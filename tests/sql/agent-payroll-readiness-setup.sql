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

create table private.agent_read_domains (
  domain text primary key
);

create table private.agent_read_domain_revisions (
  company_id uuid not null,
  domain text not null references private.agent_read_domains(domain),
  source_revision bigint not null default 0,
  updated_at timestamptz not null default statement_timestamp(),
  primary key (company_id, domain)
);

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

create function private.advance_agent_read_domain_revisions(uuid[], text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $function$
begin
  if not exists (
    select 1 from private.agent_read_domains domain where domain.domain = $2
  ) then
    raise exception 'invalid domain';
  end if;
  insert into private.agent_read_domain_revisions as revision (
    company_id, domain, source_revision, updated_at
  )
  select distinct company_id, $2, 1, statement_timestamp()
  from unnest(coalesce($1, array[]::uuid[])) company_id
  where company_id is not null
  on conflict (company_id, domain) do update
  set source_revision = revision.source_revision + 1,
      updated_at = excluded.updated_at;
end;
$function$;

create function private.bump_agent_read_domain_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $function$
declare
  v_old_company_id uuid;
  v_new_company_id uuid;
begin
  if tg_nargs is distinct from 2
     or tg_when is distinct from 'AFTER'
     or tg_level is distinct from 'ROW'
     or tg_op not in ('INSERT', 'UPDATE', 'DELETE') then
    raise exception 'misconfigured revision trigger';
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_company_id := private.agent_read_domain_uuid_from_text(
      to_jsonb(old) ->> tg_argv[1]
    );
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_company_id := private.agent_read_domain_uuid_from_text(
      to_jsonb(new) ->> tg_argv[1]
    );
  end if;
  perform private.advance_agent_read_domain_revisions(
    array[v_old_company_id, v_new_company_id], tg_argv[0]
  );
  return null;
end;
$function$;

create table private.test_authority_permissions (
  permission text primary key
);
insert into private.test_authority_permissions values
  ('expenses.view'),
  ('invoices.view'),
  ('reports.view'),
  ('settings.company');

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
  join private.test_authority_permissions allowed using (permission)
  where p_actor_user_id = '11111111-1111-4111-8111-111111111111'::uuid
    and p_company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
$function$;

create function private.mcp_oauth_labels_for_scopes(text[], text)
returns text[]
language sql
stable
strict
as $function$
  select coalesce(
    array_agg('label:' || scope order by scope),
    array[]::text[]
  )
  from unnest($1) scope;
$function$;

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
  accepted_labels text[] not null,
  revoked_at timestamptz
);

create table public.companies (
  id uuid primary key,
  deleted_at timestamptz,
  timezone text not null,
  currency_code text not null
);

create table public.expense_settings (
  id uuid primary key,
  company_id uuid not null unique,
  forecast_current_balance numeric,
  forecast_balance_updated_at timestamptz
);

create table public.recurring_expenses (
  id uuid primary key,
  company_id uuid not null,
  amount numeric not null,
  currency text not null,
  cadence text not null,
  next_due_date date not null,
  end_date date,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

create table public.expense_batches (
  id uuid primary key,
  company_id uuid not null,
  status text not null,
  total_amount numeric,
  approved_amount numeric,
  created_at timestamptz,
  reviewed_at timestamptz,
  paid_at timestamptz
);

create table public.expenses (
  id uuid primary key,
  company_id uuid not null,
  batch_id uuid,
  currency text,
  deleted_at timestamptz
);

create table public.invoices (
  id uuid primary key,
  company_id uuid not null,
  client_id uuid not null,
  total numeric not null,
  amount_paid numeric not null,
  balance_due numeric not null,
  status text not null,
  due_date date not null,
  sent_at timestamptz,
  deleted_at timestamptz,
  qb_id text,
  sage_id text
);

create table public.payments (
  id uuid primary key,
  company_id uuid not null,
  invoice_id uuid not null,
  amount numeric not null,
  payment_date date not null,
  voided_at timestamptz,
  qb_id text,
  sage_id text,
  stripe_payment_intent text
);

insert into private.agent_read_domains values ('company');

insert into public.companies values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'America/Vancouver', 'CAD'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', null, 'America/Toronto', 'CAD');

insert into private.agent_read_domain_revisions values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'company', 7, statement_timestamp()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'company', 2, statement_timestamp());

insert into private.mcp_oauth_clients values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  array[
    'ops.company.read',
    'ops.expenses.read',
    'ops.financial_documents.read',
    'ops.financials.read',
    'ops.payments.read'
  ],
  '2026-08-29.mcp-scope-consent.v2',
  '2026-09-01.mcp-exposure.v8',
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
    'ops.payments.read'
  ],
  '2026-08-29.mcp-scope-consent.v2',
  '2026-09-01.mcp-exposure.v8',
  private.mcp_oauth_labels_for_scopes(
    array[
      'ops.company.read',
      'ops.expenses.read',
      'ops.financial_documents.read',
      'ops.financials.read',
      'ops.payments.read'
    ],
    '2026-08-29.mcp-scope-consent.v2'
  ),
  null
);

insert into public.expense_settings values (
  '20000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  10000,
  '2026-09-01 15:30:00+00'
);

insert into public.recurring_expenses values
  ('30000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 6000, 'CAD', 'monthly', '2026-09-15', null, '2026-08-30 12:00:00+00', null),
  ('30000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 2000, 'CAD', 'monthly', '2026-09-10', null, '2026-08-30 12:00:00+00', null),
  ('30000000-0000-4000-8000-000000000003', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 9000, 'CAD', 'monthly', '2026-09-15', null, '2026-08-30 12:00:00+00', null);

insert into public.expense_batches values
  ('40000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'approved', 500, null, '2026-08-29 12:00:00+00', '2026-08-30 12:00:00+00', null),
  ('40000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'approved', 900, null, '2026-08-29 12:00:00+00', '2026-08-30 12:00:00+00', null);

insert into public.expenses values
  ('41000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '40000000-0000-4000-8000-000000000001', 'CAD', null),
  ('41000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '40000000-0000-4000-8000-000000000001', 'CAD', null),
  ('41000000-0000-4000-8000-000000000003', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '40000000-0000-4000-8000-000000000002', 'CAD', null);

insert into public.invoices values
  ('50000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '60000000-0000-4000-8000-000000000001', 3000, 0, 3000, 'sent', '2026-09-05', '2026-08-20 18:00:00+00', null, 'open-qb', null),
  ('50000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '60000000-0000-4000-8000-000000000001', 1000, 1000, 0, 'paid', '2026-07-01', '2026-06-01 18:00:00+00', null, 'history-qb-1', null),
  ('50000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '60000000-0000-4000-8000-000000000001', 1000, 1000, 0, 'paid', '2026-07-01', '2026-06-01 18:00:00+00', null, 'history-qb-2', null),
  ('50000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '60000000-0000-4000-8000-000000000001', 1000, 1000, 0, 'paid', '2026-07-01', '2026-06-01 18:00:00+00', null, 'history-qb-3', null),
  ('50000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '60000000-0000-4000-8000-000000000001', 1000, 1000, 0, 'paid', '2026-07-01', '2026-06-01 18:00:00+00', null, 'history-qb-4', null),
  ('50000000-0000-4000-8000-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '60000000-0000-4000-8000-000000000001', 1000, 1000, 0, 'paid', '2026-07-01', '2026-06-01 18:00:00+00', null, 'history-qb-5', null),
  ('50000000-0000-4000-8000-000000000007', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '60000000-0000-4000-8000-000000000002', 9000, 0, 9000, 'sent', '2026-09-05', '2026-08-20 18:00:00+00', null, 'other-qb', null);

insert into public.payments values
  ('70000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '50000000-0000-4000-8000-000000000002', 1000, '2026-06-29', null, 'pay-qb-1', null, null),
  ('70000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '50000000-0000-4000-8000-000000000003', 1000, '2026-07-01', null, 'pay-qb-2', null, null),
  ('70000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '50000000-0000-4000-8000-000000000004', 400, '2026-07-02', null, 'pay-qb-3a', null, null),
  ('70000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '50000000-0000-4000-8000-000000000004', 600, '2026-07-03', null, 'pay-qb-3b', null, null),
  ('70000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '50000000-0000-4000-8000-000000000004', 9000, '2026-06-30', '2026-07-01 00:00:00+00', 'pay-qb-void', null, null),
  ('70000000-0000-4000-8000-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '50000000-0000-4000-8000-000000000005', 1000, '2026-07-05', null, 'pay-qb-4', null, null),
  ('70000000-0000-4000-8000-000000000007', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '50000000-0000-4000-8000-000000000006', 1000, '2026-07-07', null, 'pay-qb-5', null, null);
