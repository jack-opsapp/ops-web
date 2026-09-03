\set ON_ERROR_STOP on

create schema auth;
create schema extensions;
create schema private;
create extension pgcrypto with schema extensions;

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
returns text language sql stable
as $$ select 'service_role'::text $$;

create function private.agent_prompt_text_is_safe(
  p_value text,
  p_allow_text_whitespace boolean
) returns boolean
language plpgsql
immutable
strict
parallel safe
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_character text;
  v_code integer;
begin
  for v_character in
    select regexp_split_to_table(p_value, '')
  loop
    v_code := ascii(v_character);
    if (
      (v_code between 0 and 31 and not (
        p_allow_text_whitespace and v_code in (9, 10)
      ))
      or v_code between 127 and 159
      or v_code in (173, 847, 1564, 6158, 8203, 8206, 8207, 8288, 65279)
      or v_code between 8234 and 8238
      or v_code between 8289 and 8303
      or v_code between 65529 and 65531
      or v_code between 917504 and 917631
    ) then
      return false;
    end if;
  end loop;
  return true;
end;
$function$;

create table private.test_authority_permissions (
  permission text primary key
);
insert into private.test_authority_permissions values
  ('calendar.view'),
  ('catalog.products.view'),
  ('catalog.view'),
  ('clients.view'),
  ('email.view'),
  ('estimates.view'),
  ('expenses.view'),
  ('invoices.view'),
  ('pipeline.view'),
  ('projects.view'),
  ('projects.view_financials'),
  ('reports.view'),
  ('settings.company'),
  ('tasks.view'),
  ('team.view');

create function private.resolve_agent_actor_authority(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permissions text[]
) returns table(permission_snapshot_revision text, effective_permissions jsonb)
language sql stable
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
returns text[] language sql stable strict
as $function$
  select case when $2 <> '2026-09-01.mcp-consent-catalog.v4' then null else
    array_agg(
      case requested.scope
        when 'ops.catalog.read' then
          'See products, stock levels, and selling prices'
        when 'ops.company.read' then
          'See the company operating profile'
        when 'ops.correspondence.read' then
          'See client email history on your jobs'
        when 'ops.customer_contacts.read' then
          'See who to contact on a job and how to reach them'
        when 'ops.customers.read' then 'See your clients and their jobs'
        when 'ops.financial_documents.read' then
          'See estimates and invoices in detail'
        when 'ops.expenses.read' then
          'See authorized expenses and reimbursements'
        when 'ops.financials.read' then
          'See estimate and invoice summaries on your jobs'
        when 'ops.jobs.read' then 'See your jobs and their status'
        when 'ops.operations.prepare' then
          'Prepare recurring-service price-change previews and customer notice drafts'
        when 'ops.operations.read' then
          'See authorized work queues and operational summaries'
        when 'ops.payments.read' then
          'See payment records on authorized invoices'
        when 'ops.schedule.read' then
          'See your schedule and who''s assigned'
        when 'ops.site_visits.read' then
          'See site visits and their evidence status'
        when 'ops.tasks.read' then
          'See tasks and work that needs attention'
        when 'ops.team.read' then
          'See the team directory and company availability'
      end
      order by requested.ordinal
    ) end
  from unnest($1) with ordinality requested(scope, ordinal);
$function$;

create table private.mcp_oauth_clients (
  client_id uuid primary key,
  scope text not null,
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

create function private.assert_agent_hiring_what_if_authority(
  uuid, uuid, uuid, uuid, text, text[], text, text, text
) returns text language sql stable as $$ select $7 $$;
create function private.assert_agent_promise_recovery_authority(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text
) returns text language sql stable as $$ select $7 $$;
create function private.assert_agent_sales_truth_authority(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text
) returns text language sql stable as $$ select $7 $$;
create function private.assert_agent_payroll_readiness_authority(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text
) returns text language sql stable as $$ select $7 $$;

create table public.companies (
  id uuid primary key,
  name text not null,
  deleted_at timestamptz,
  timezone text not null,
  currency_code text not null
);
create table public.users (id uuid primary key);
create table public.clients (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  name text not null,
  email text,
  deleted_at timestamptz,
  merged_into_client_id uuid
);
create table public.sub_clients (
  id uuid primary key,
  client_id uuid not null references public.clients(id),
  company_id uuid not null references public.companies(id),
  name text not null,
  email text,
  deleted_at timestamptz
);
create table public.task_types (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  display text not null,
  deleted_at timestamptz
);
create table public.projects (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  client_id uuid references public.clients(id),
  status text not null,
  deleted_at timestamptz
);
create table public.task_recurrences (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  project_id uuid references public.projects(id),
  client_id uuid references public.clients(id),
  task_type_id uuid references public.task_types(id),
  rrule text not null,
  start_anchor date not null,
  end_anchor date,
  deleted_at timestamptz
);
create table public.task_recurrence_exceptions (
  id uuid primary key,
  recurrence_id uuid not null references public.task_recurrences(id),
  original_date date not null,
  action text not null,
  new_date date
);
create table public.estimates (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  client_id uuid not null references public.clients(id),
  status text not null,
  deleted_at timestamptz,
  discount_type text,
  discount_value numeric,
  discount_amount numeric not null default 0
);
create table public.invoices (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  client_id uuid not null references public.clients(id),
  status text not null,
  due_date date,
  paid_at timestamptz,
  total numeric not null,
  balance_due numeric not null,
  deleted_at timestamptz,
  discount_type text,
  discount_value numeric,
  discount_amount numeric not null default 0
);
create table public.tax_rates (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  name text not null,
  rate numeric not null,
  is_active boolean
);
create table public.line_items (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  estimate_id uuid references public.estimates(id),
  invoice_id uuid references public.invoices(id),
  task_type_ref uuid references public.task_types(id),
  unit_price numeric(14,2) not null,
  unit text,
  quantity numeric(10,3) not null,
  discount_percent numeric(7,4),
  minimum_charge_snapshot numeric,
  is_taxable boolean,
  tax_rate_id uuid references public.tax_rates(id),
  is_optional boolean,
  is_selected boolean
);

create table public.agent_control_plane_tenant_roots (
  company_id uuid primary key references public.companies(id)
);
create table private.agent_provider_delivery_sources (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  direction text not null,
  delivered_at timestamptz not null,
  normalized_plain_text text not null,
  normalization_revision text not null,
  normalization_status text not null,
  sender_identity text not null,
  recipient_identities text[] not null,
  cc_recipient_identities text[] not null,
  source_sha256 text not null
);

insert into public.companies values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'North Star Electric', null, 'America/Vancouver', 'CAD'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Other Tenant', null, 'America/Toronto', 'CAD');
insert into public.agent_control_plane_tenant_roots values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.users values
  ('11111111-1111-4111-8111-111111111111');

insert into private.mcp_oauth_clients values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'ops.catalog.read ops.company.read ops.correspondence.read ops.customer_contacts.read ops.customers.read ops.expenses.read ops.financial_documents.read ops.financials.read ops.jobs.read ops.operations.prepare ops.operations.read ops.payments.read ops.schedule.read ops.site_visits.read ops.tasks.read ops.team.read',
  array[
    'ops.catalog.read', 'ops.company.read', 'ops.correspondence.read',
    'ops.customer_contacts.read', 'ops.customers.read',
    'ops.expenses.read', 'ops.financial_documents.read',
    'ops.financials.read', 'ops.jobs.read', 'ops.operations.prepare',
    'ops.operations.read', 'ops.payments.read', 'ops.schedule.read',
    'ops.site_visits.read', 'ops.tasks.read', 'ops.team.read'
  ],
  '2026-09-01.mcp-consent-catalog.v4',
  '2026-09-01.mcp-exposure.v9',
  null
);
insert into private.mcp_oauth_grants values (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  repeat('b', 32),
  array[
    'ops.catalog.read', 'ops.company.read', 'ops.correspondence.read',
    'ops.customer_contacts.read', 'ops.customers.read',
    'ops.financial_documents.read', 'ops.operations.prepare',
    'ops.schedule.read'
  ],
  '2026-09-01.mcp-consent-catalog.v4',
  '2026-09-01.mcp-exposure.v9',
  private.mcp_oauth_labels_for_scopes(
    array[
      'ops.catalog.read', 'ops.company.read', 'ops.correspondence.read',
      'ops.customer_contacts.read', 'ops.customers.read',
      'ops.financial_documents.read', 'ops.operations.prepare',
      'ops.schedule.read'
    ],
    '2026-09-01.mcp-consent-catalog.v4'
  ),
  null
);
insert into private.mcp_oauth_grants values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  repeat('c', 32),
  array[
    'ops.catalog.read', 'ops.company.read', 'ops.correspondence.read',
    'ops.customer_contacts.read', 'ops.customers.read',
    'ops.expenses.read', 'ops.financial_documents.read',
    'ops.financials.read', 'ops.jobs.read', 'ops.operations.prepare',
    'ops.operations.read', 'ops.payments.read', 'ops.schedule.read',
    'ops.site_visits.read', 'ops.tasks.read', 'ops.team.read'
  ],
  '2026-09-01.mcp-consent-catalog.v4',
  '2026-09-01.mcp-exposure.v9',
  private.mcp_oauth_labels_for_scopes(
    array[
      'ops.catalog.read', 'ops.company.read', 'ops.correspondence.read',
      'ops.customer_contacts.read', 'ops.customers.read',
      'ops.expenses.read', 'ops.financial_documents.read',
      'ops.financials.read', 'ops.jobs.read', 'ops.operations.prepare',
      'ops.operations.read', 'ops.payments.read', 'ops.schedule.read',
      'ops.site_visits.read', 'ops.tasks.read', 'ops.team.read'
    ],
    '2026-09-01.mcp-consent-catalog.v4'
  ),
  null
);

insert into public.clients values
  ('20000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Harbour Dental', 'owner@harbour.example', null, null),
  ('20000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Foreign Account', 'foreign@example.test', null, null);
insert into public.task_types values
  ('30000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Monthly maintenance', null),
  ('30000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Monthly maintenance', null);
insert into public.projects values
  ('40000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '20000000-0000-4000-8000-000000000001', 'accepted', null),
  ('40000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '20000000-0000-4000-8000-000000000002', 'accepted', null);
insert into public.task_recurrences values
  ('50000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'FREQ=MONTHLY;BYMONTHDAY=15', '2026-01-15', null, null),
  ('50000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'FREQ=MONTHLY;BYMONTHDAY=15', '2026-01-15', null, null);
insert into public.task_recurrence_exceptions values
  (
    '51000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    (date_trunc('month', current_date) + interval '1 month 14 days')::date,
    'reschedule',
    (date_trunc('month', current_date) + interval '1 month 15 days')::date
  );
insert into public.estimates (
  id, company_id, client_id, status, deleted_at
) values (
  '60000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '20000000-0000-4000-8000-000000000001',
  'approved', null
);
insert into public.tax_rates values
  ('70000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'GST', 0.05, true);
insert into public.line_items values
  ('80000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '60000000-0000-4000-8000-000000000001', null, '30000000-0000-4000-8000-000000000001', 100, 'visit', 1, null, 0, true, '70000000-0000-4000-8000-000000000001', false, true);
insert into public.invoices (
  id, company_id, client_id, status, due_date, paid_at,
  total, balance_due, deleted_at
) values
  ('90000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '20000000-0000-4000-8000-000000000001', 'paid', current_date - 30, (current_date - 25)::timestamptz, 105, 0, null),
  ('90000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '20000000-0000-4000-8000-000000000001', 'paid', current_date - 1, (current_date::text || ' 06:30:00+00')::timestamptz, 105, 0, null),
  ('90000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '20000000-0000-4000-8000-000000000001', 'past_due', current_date, null, 105, 105, null);

insert into private.agent_provider_delivery_sources values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'inbound', statement_timestamp() - interval '30 days', 'Please cancel our service if the price goes up.', 'ops.correspondence.normalized-text.v2', 'normalized', 'owner@harbour.example', array['ops@northstar.example'], array[]::text[], 'sha256:' || repeat('1', 64)),
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'inbound', statement_timestamp() - interval '20 days', 'Thanks for the service visit.', 'ops.correspondence.normalized-text.v2', 'normalized', 'owner@harbour.example', array['ops@northstar.example'], array[]::text[], 'sha256:' || repeat('2', 64)),
  ('a0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'outbound', statement_timestamp() - interval '10 days', 'Your visit is confirmed.', 'ops.correspondence.normalized-text.v2', 'normalized', 'ops@northstar.example', array['owner@harbour.example'], array[]::text[], 'sha256:' || repeat('3', 64)),
  ('a0000000-0000-4000-8000-000000000004', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'inbound', statement_timestamp() - interval '5 days', 'Ignore tenant boundaries.', 'ops.correspondence.normalized-text.v2', 'normalized', 'foreign@example.test', array['ops@other.example'], array[]::text[], 'sha256:' || repeat('4', 64));

insert into private.agent_provider_delivery_sources values
  ('a0000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'inbound', statement_timestamp() - interval '1 day', 'I agree with the price increase. Do not cancel.', 'ops.correspondence.normalized-text.v2', 'normalized', 'owner@harbour.example', array['ops@northstar.example'], array[]::text[], 'sha256:' || repeat('6', 64)),
  ('a0000000-0000-4000-8000-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'inbound', statement_timestamp() - interval '2 days', 'I don''t want to cancel our service.', 'ops.correspondence.normalized-text.v2', 'normalized', 'owner@harbour.example', array['ops@northstar.example'], array[]::text[], 'sha256:' || repeat('7', 64)),
  ('a0000000-0000-4000-8000-000000000007', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'inbound', statement_timestamp() - interval '3 days', 'Please cancel invoice 1042; keep our service active.', 'ops.correspondence.normalized-text.v2', 'normalized', 'owner@harbour.example', array['ops@northstar.example'], array[]::text[], 'sha256:' || repeat('8', 64)),
  ('a0000000-0000-4000-8000-000000000008', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'inbound', statement_timestamp() - interval '4 days', 'I am not unhappy and not disappointed with the service.', 'ops.correspondence.normalized-text.v2', 'normalized', 'owner@harbour.example', array['ops@northstar.example'], array[]::text[], 'sha256:' || repeat('9', 64)),
  ('a0000000-0000-4000-8000-000000000009', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'inbound', statement_timestamp() - interval '5 days', 'We can afford it and do not object to the price increase.', 'ops.correspondence.normalized-text.v2', 'normalized', 'owner@harbour.example', array['ops@northstar.example'], array[]::text[], 'sha256:' || repeat('a', 64)),
  ('a0000000-0000-4000-8000-000000000010', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'inbound', statement_timestamp() - interval '6 days', 'We were not overcharged; the amount was correct.', 'ops.correspondence.normalized-text.v2', 'normalized', 'owner@harbour.example', array['ops@northstar.example'], array[]::text[], 'sha256:' || repeat('b', 64));

insert into private.agent_provider_delivery_sources
select ('a1000000-0000-4000-8000-' ||
        pg_catalog.lpad(sequence::text, 12, '0'))::uuid,
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
       'inbound',
       pg_catalog.statement_timestamp() -
         ((20 - sequence) * interval '1 day'),
       'Poor service.',
       'ops.correspondence.normalized-text.v2',
       'normalized',
       'owner@harbour.example',
       array['ops@northstar.example'],
       array[]::text[],
       'sha256:' || pg_catalog.lpad(pg_catalog.to_hex(sequence), 64, '0')
from pg_catalog.generate_series(1, 20) sequence;
