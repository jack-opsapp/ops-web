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
    array[v_old_company_id, v_new_company_id],
    tg_argv[0]
  );
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

create table private.test_authority_permissions (
  permission text primary key
);
insert into private.test_authority_permissions values
  ('email.view'),
  ('pipeline.view');

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

create table public.companies (
  id uuid primary key,
  deleted_at timestamptz,
  timezone text,
  currency_code text
);

create table public.opportunities (
  id uuid primary key,
  company_id uuid not null,
  created_at timestamptz not null,
  deleted_at timestamptz,
  merged_into_opportunity_id uuid,
  stage text not null,
  source text,
  lost_reason text
);

create table public.stage_transitions (
  id uuid primary key,
  company_id uuid not null,
  opportunity_id uuid not null,
  from_stage text,
  to_stage text not null,
  transitioned_at timestamptz not null,
  duration_in_stage interval
);

create table public.opportunity_dispositions (
  id uuid primary key,
  company_id uuid not null,
  opportunity_id uuid not null,
  reason_code text,
  superseded_at timestamptz,
  created_at timestamptz not null
);

create table public.activities (
  id uuid primary key,
  company_id uuid not null,
  opportunity_id uuid,
  type text not null,
  direction text,
  created_at timestamptz not null
);

create index stage_transitions_agent_history_keyset_idx
  on public.stage_transitions (
    company_id, opportunity_id, transitioned_at desc, id desc
  );
create unique index opportunity_dispositions_one_active_uidx
  on public.opportunity_dispositions (opportunity_id)
  where superseded_at is null;

insert into private.agent_read_domains values ('company');

insert into public.companies values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'America/Vancouver', 'CAD'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', null, 'America/Toronto', 'CAD');

insert into private.agent_read_domain_revisions values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'company', 7, statement_timestamp()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'company', 2, statement_timestamp());

insert into private.mcp_oauth_clients values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  array['ops.correspondence.read', 'ops.operations.read'],
  '2026-08-29.mcp-scope-consent.v2',
  '2026-09-01.mcp-exposure.v7',
  null
);

insert into private.mcp_oauth_grants values (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  repeat('b', 32),
  array['ops.correspondence.read', 'ops.operations.read'],
  '2026-08-29.mcp-scope-consent.v2',
  '2026-09-01.mcp-exposure.v7',
  '{}'::jsonb,
  null
);

insert into public.opportunities values
  ('10000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-08-01 12:00:00+00', null, null, 'won', 'referral', null),
  ('10000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-08-02 12:00:00+00', null, null, 'lost', 'website', null),
  ('10000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-08-03 12:00:00+00', null, null, 'negotiation', 'email', null),
  ('10000000-0000-4000-8000-000000000004', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2026-08-04 12:00:00+00', null, null, 'lost', 'website', 'Other');

insert into public.stage_transitions values
  ('20000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000001', 'new_lead', 'quoted', '2026-08-02 12:00:00+00', interval '1 day'),
  ('20000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000001', 'quoted', 'won', '2026-08-04 12:00:00+00', interval '2 days'),
  ('20000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000002', 'new_lead', 'lost', '2026-08-05 12:00:00+00', interval '3 days'),
  ('20000000-0000-4000-8000-000000000004', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '10000000-0000-4000-8000-000000000004', 'new_lead', 'lost', '2026-08-06 12:00:00+00', interval '2 days');

insert into public.opportunity_dispositions values
  ('30000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000002', 'Price', null, '2026-08-05 12:01:00+00'),
  ('30000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '10000000-0000-4000-8000-000000000004', 'Other', null, '2026-08-06 12:01:00+00');

insert into public.activities values
  ('40000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000002', 'email', 'inbound', '2026-08-02 13:00:00+00'),
  ('40000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000002', 'email', 'outbound', '2026-08-02 14:00:00+00'),
  ('40000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-4000-8000-000000000003', 'phone_call', 'outbound', '2026-08-03 14:00:00+00'),
  ('40000000-0000-4000-8000-000000000004', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '10000000-0000-4000-8000-000000000004', 'email', 'inbound', '2026-08-04 13:00:00+00');
