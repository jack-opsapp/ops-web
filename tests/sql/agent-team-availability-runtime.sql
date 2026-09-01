\set ON_ERROR_STOP on

\if :{?agent_mcp_availability_bootstrap}
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

create type public.site_visit_status as enum (
  'scheduled', 'in_progress', 'completed', 'cancelled'
);

create table public.companies (
  id uuid primary key,
  name text not null default 'OPS Test Company',
  deleted_at timestamptz,
  timezone text not null default 'America/Vancouver',
  default_work_start time not null default time '08:00:00',
  default_work_end time not null default time '17:00:00',
  skip_weekends_in_auto_schedule boolean default true
);
create table public.users (
  id uuid primary key,
  company_id uuid,
  first_name text not null,
  last_name text not null,
  profile_image_url text,
  user_color text,
  role text,
  is_active boolean default true,
  deleted_at timestamptz
);
create table public.calendar_user_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  company_id text not null,
  type text not null check (type in ('personal', 'time_off')),
  title text not null default '',
  start_date timestamptz not null,
  end_date timestamptz not null,
  all_day boolean not null default true,
  notes text,
  status text not null default 'none'
    check (status in ('none', 'pending', 'approved', 'denied')),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz,
  deleted_at timestamptz,
  address text,
  team_member_ids text[] default array[]::text[],
  series_id uuid
);
create table public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled')),
  team_member_ids text[] default array[]::text[],
  deleted_at timestamptz,
  start_date timestamptz,
  end_date timestamptz,
  duration integer,
  start_time time default time '08:00:00',
  end_time time default time '17:00:00',
  all_day boolean not null default true
);
create table public.site_visits (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 60,
  assignee_ids text[] default array[]::text[],
  status public.site_visit_status not null default 'scheduled',
  deleted_at timestamptz,
  booked_at timestamptz
);
create table public.user_permission_overrides (
  id uuid primary key,
  user_id uuid not null,
  company_id uuid not null,
  permission text not null,
  scope text,
  granted boolean not null default true
);

create table private.agent_read_domains (
  domain text primary key
);
insert into private.agent_read_domains(domain) values
  ('availability'), ('site_visits'), ('tasks'), ('team');

create table private.agent_read_domain_revisions (
  company_id uuid not null,
  domain text not null references private.agent_read_domains(domain),
  source_revision bigint not null default 0
    check (source_revision between 0 and 9007199254740991),
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
language sql immutable strict set search_path = ''
as $$
  select case when p_value ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then pg_catalog.lower(p_value)::uuid end;
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
  from pg_catalog.unnest(coalesce(p_company_ids, array[]::uuid[])) company_id
  where company_id is not null
  on conflict(company_id, domain) do update
    set source_revision =
      private.agent_read_domain_revisions.source_revision + 1;
end;
$$;

create function private.bump_agent_read_domain_revision()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old_company_id uuid;
  v_new_company_id uuid;
begin
  if tg_nargs is distinct from 2 then
    raise exception 'agent_read_domain_revision_trigger_misconfigured';
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_company_id := private.agent_read_domain_uuid_from_text(
      pg_catalog.to_jsonb(old) ->> tg_argv[1]
    );
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_company_id := private.agent_read_domain_uuid_from_text(
      pg_catalog.to_jsonb(new) ->> tg_argv[1]
    );
  end if;
  perform private.advance_agent_read_domain_revisions(
    array[v_old_company_id, v_new_company_id],
    tg_argv[0]
  );
  return null;
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
    and actor.is_active is true;
$$;

create function private.mcp_oauth_labels_for_scopes(text[], text)
returns text[]
language sql immutable set search_path = ''
as $$ select coalesce($1, array[]::text[]) $$;

create function private.agent_p2_optional_canonical_text(
  p_value text,
  p_maximum_scalars integer,
  p_maximum_utf8_bytes integer,
  p_allow_text_whitespace boolean
) returns text
language sql immutable security invoker set search_path = ''
as $$
  select case
    when p_value is null then null
    when pg_catalog.btrim(p_value) = '' then null
    when pg_catalog.char_length(pg_catalog.btrim(p_value)) >
      p_maximum_scalars then null
    when pg_catalog.octet_length(pg_catalog.btrim(p_value)) >
      p_maximum_utf8_bytes then null
    when not p_allow_text_whitespace and pg_catalog.btrim(p_value) ~
      E'[\n\r\t]' then null
    else pg_catalog.btrim(p_value)
  end;
$$;

create function private.agent_rfc3339_utc(p_value timestamptz)
returns text
language sql immutable strict security invoker set search_path = ''
as $$
  select pg_catalog.to_char(
    p_value at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
$$;

create function private.canonical_agent_projection_json(p_value jsonb)
returns text
language sql immutable strict security invoker set search_path = ''
as $$ select p_value::text $$;

create function private.agent_unambiguous_local_instant(
  p_local timestamp without time zone,
  p_timezone text
) returns timestamptz
language sql stable strict set search_path = ''
as $$
  with guessed as materialized (
    select p_local at time zone p_timezone as instant
  ), probes as materialized (
    select guessed.instant from guessed
    union all
    select guessed.instant - interval '36 hours' from guessed
    union all
    select guessed.instant + interval '36 hours' from guessed
  ), possible_offset as materialized (
    select distinct
           (probe.instant at time zone p_timezone) -
             (probe.instant at time zone 'UTC') as utc_offset
    from probes probe
  ), matching as (
    select distinct
           (p_local - tz.utc_offset) at time zone 'UTC' as instant
    from possible_offset tz
    where (
      (p_local - tz.utc_offset) at time zone 'UTC'
    ) at time zone p_timezone = p_local
  )
  select case when pg_catalog.count(*) = 1
    then pg_catalog.min(instant) end
  from matching;
$$;

create function private.agent_civil_date_start(
  p_date date,
  p_timezone text
) returns timestamptz
language sql stable strict set search_path = ''
as $$
  with local_value as materialized (
    select p_date::timestamp without time zone as value
  ), guessed as materialized (
    select local.value at time zone p_timezone as instant
    from local_value local
  ), probes as materialized (
    select guessed.instant from guessed
    union all
    select guessed.instant - interval '36 hours' from guessed
    union all
    select guessed.instant + interval '36 hours' from guessed
  ), possible_offset as materialized (
    select distinct
           (probe.instant at time zone p_timezone) -
             (probe.instant at time zone 'UTC') as utc_offset
    from probes probe
  ), exact_match as materialized (
    select distinct
           (local.value - tz.utc_offset) at time zone 'UTC' as instant
    from local_value local
    cross join possible_offset tz
    where (
      (local.value - tz.utc_offset) at time zone 'UTC'
    ) at time zone p_timezone = local.value
  ), boundary as materialized (
    select pg_catalog.min(match.instant) as instant from exact_match match
  )
  select coalesce(
    boundary.instant,
    case when (guessed.instant at time zone p_timezone)::date = p_date
      then guessed.instant end
  )
  from boundary
  cross join guessed;
$$;

create trigger project_tasks_bump_agent_task_revision
after insert or update or delete on public.project_tasks
for each row execute function private.bump_agent_read_domain_revision(
  'tasks', 'company_id'
);
create trigger project_tasks_bump_agent_site_visit_revision
after insert or update or delete on public.project_tasks
for each row execute function private.bump_agent_read_domain_revision(
  'site_visits', 'company_id'
);
create trigger site_visits_bump_agent_site_visit_revision
after insert or update or delete on public.site_visits
for each row execute function private.bump_agent_read_domain_revision(
  'site_visits', 'company_id'
);
create trigger users_bump_agent_task_revision
after insert or update or delete on public.users
for each row execute function private.bump_agent_read_domain_revision(
  'tasks', 'company_id'
);

\ir ../../supabase/migrations/20260829063450_agent_team_sources.sql
\ir ../../supabase/migrations/20260829074110_agent_availability_sources.sql
\ir ../../supabase/migrations/20260829074111_agent_team_availability_read.sql
\endif

begin;

create function private.test_team_availability_call(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_view text,
  p_team_scope text,
  p_calendar_scope text,
  p_starts_on date,
  p_ends_on date,
  p_item_limit integer,
  p_cursor_read_at timestamptz default null,
  p_cursor_source_revisions jsonb default '[]'::jsonb,
  p_after_display_name text default null,
  p_after_member_id uuid default null
) returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_client_id uuid;
  v_grant_revision text;
  v_scopes text[];
  v_permission_revision text;
begin
  select grant_row.client_id,
         grant_row.revision,
         grant_row.scopes
    into strict v_client_id, v_grant_revision, v_scopes
  from private.mcp_oauth_grants grant_row
  where grant_row.id = p_oauth_grant_id;

  select authority.permission_snapshot_revision
    into strict v_permission_revision
  from private.resolve_agent_actor_authority(
    p_actor_user_id,
    p_company_id,
    array['calendar.view', 'team.view']::text[]
  ) authority;

  return public.read_agent_team_availability_as_system(
    'availability-runtime-request',
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    v_client_id,
    v_grant_revision,
    v_scopes,
    v_permission_revision,
    array['calendar.view', 'team.view']::text[],
    'list_team_availability',
    'list_team_availability:2026-08-22.v1',
    '2026-08-22.capability-manifest.v8',
    array['ops.team.read']::text[],
    p_view,
    p_team_scope,
    p_calendar_scope,
    p_starts_on,
    p_ends_on,
    p_item_limit,
    p_item_limit + 1,
    501,
    501,
    p_cursor_read_at,
    p_cursor_source_revisions,
    p_after_display_name,
    p_after_member_id
  );
end;
$$;

set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local request.jwt.claim.role = 'service_role';
set local timezone = 'UTC';

do $catalog_contract$
declare
  v_private_signature constant text :=
    'private.agent_p2_availability_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,date,date,integer,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)';
  v_public_signature constant text :=
    'public.read_agent_team_availability_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,date,date,integer,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)';
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000
     or pg_catalog.current_setting('server_version_num')::integer >= 180000 then
    raise exception 'agent_availability_runtime_failed: requires_pg17';
  end if;
  if pg_catalog.to_regprocedure(v_private_signature) is null
     or pg_catalog.to_regprocedure(v_public_signature) is null then
    raise exception 'agent_availability_runtime_failed: function_missing';
  end if;
  if pg_catalog.has_function_privilege(
       'anon', v_public_signature, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated', v_public_signature, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role', v_private_signature, 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role', v_public_signature, 'EXECUTE'
     ) then
    raise exception 'agent_availability_runtime_failed: acl';
  end if;
  if pg_catalog.to_regclass(
       'public.idx_calendar_user_events_agent_availability_v1'
     ) is null
     or pg_catalog.to_regclass(
       'public.idx_project_tasks_agent_availability_v1'
     ) is null
     or pg_catalog.to_regclass(
       'public.idx_site_visits_agent_availability_v1'
     ) is null then
    raise exception 'agent_availability_runtime_failed: index_missing';
  end if;
end;
$catalog_contract$;

insert into public.companies(
  id, name, timezone, default_work_start, default_work_end,
  skip_weekends_in_auto_schedule
) values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Availability Runtime',
    'America/Vancouver',
    time '08:00:00',
    time '17:00:00',
    true
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'DST Runtime',
    'America/New_York',
    time '00:00:00',
    time '04:00:00',
    false
  );

insert into private.agent_read_domain_revisions(
  company_id, domain, source_revision
)
select company.id, domain.domain, 0
from public.companies company
cross join private.agent_read_domains domain
on conflict(company_id, domain) do nothing;

insert into public.users(
  id, company_id, first_name, last_name, is_active
) values
  (
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Avery', 'Chen', true
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Carly', 'Hunter', true
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Zoë', 'Adams', true
  ),
  (
    '44444444-4444-4444-8444-444444444444',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Self', 'Only', true
  ),
  (
    '55555555-5555-4555-8555-555555555555',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'DST', 'Operator', true
  );

insert into public.user_permission_overrides(
  id, user_id, company_id, permission, scope, granted
) values
  (
    '60000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'calendar.view', 'all', true
  ),
  (
    '60000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'team.view', 'all', true
  ),
  (
    '60000000-0000-4000-8000-000000000003',
    '44444444-4444-4444-8444-444444444444',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'calendar.view', 'own', true
  ),
  (
    '60000000-0000-4000-8000-000000000004',
    '55555555-5555-4555-8555-555555555555',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'calendar.view', 'own', true
  );

insert into private.mcp_oauth_clients(
  client_id, client_name, redirect_uris, token_endpoint_auth_method,
  grant_types, response_types, scope, registration_source,
  scope_ceiling, consent_catalog_revision, exposure_revision
) values
  (
    '70000000-0000-4000-8000-000000000001',
    'Team availability runtime',
    array['https://team-availability-runtime.ops.invalid/callback']::text[],
    'none',
    array['authorization_code', 'refresh_token']::text[],
    array['code']::text[],
    'ops.team.read',
    'manual',
    array['ops.team.read'],
    '2026-08-22.mcp-consent-catalog.v1',
    '2026-08-22.mcp-exposure.v1'
  );

insert into private.mcp_oauth_grants(
  id, user_id, company_id, client_id, scopes, revision, accepted_labels,
  consent_catalog_revision, exposure_revision
) values
  (
    '80000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '70000000-0000-4000-8000-000000000001',
    array['ops.team.read'],
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    private.mcp_oauth_labels_for_scopes(
      array['ops.team.read']::text[],
      '2026-08-22.mcp-consent-catalog.v1'
    ),
    '2026-08-22.mcp-consent-catalog.v1',
    '2026-08-22.mcp-exposure.v1'
  ),
  (
    '80000000-0000-4000-8000-000000000002',
    '44444444-4444-4444-8444-444444444444',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '70000000-0000-4000-8000-000000000001',
    array['ops.team.read'],
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    private.mcp_oauth_labels_for_scopes(
      array['ops.team.read']::text[],
      '2026-08-22.mcp-consent-catalog.v1'
    ),
    '2026-08-22.mcp-consent-catalog.v1',
    '2026-08-22.mcp-exposure.v1'
  ),
  (
    '80000000-0000-4000-8000-000000000003',
    '55555555-5555-4555-8555-555555555555',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '70000000-0000-4000-8000-000000000001',
    array['ops.team.read'],
    'cccccccccccccccccccccccccccccccc',
    private.mcp_oauth_labels_for_scopes(
      array['ops.team.read']::text[],
      '2026-08-22.mcp-consent-catalog.v1'
    ),
    '2026-08-22.mcp-consent-catalog.v1',
    '2026-08-22.mcp-exposure.v1'
  );

-- UTC-encoded civil dates intentionally prove the operational schedule rule.
insert into public.projects(id, company_id, title) values (
  '94000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Availability fixture project'
);

insert into public.project_tasks(
  id, company_id, project_id, status, team_member_ids, start_date, end_date,
  duration, start_time, end_time, all_day
) values
  (
    '90000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '94000000-0000-4000-8000-000000000001',
    'active',
    array['11111111-1111-4111-8111-111111111111'],
    timestamptz '2026-11-02 00:00:00+00',
    timestamptz '2026-11-02 00:00:00+00',
    1, time '08:00', time '17:00', true
  ),
  (
    '90000000-0000-4000-8000-000000000002',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '94000000-0000-4000-8000-000000000001',
    'active',
    array['11111111-1111-4111-8111-111111111111'],
    timestamptz '2026-11-03 00:00:00+00',
    timestamptz '2026-11-03 00:00:00+00',
    1, time '08:00', time '10:00', false
  ),
  (
    '90000000-0000-4000-8000-000000000003',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '94000000-0000-4000-8000-000000000001',
    'active',
    array['11111111-1111-4111-8111-111111111111'],
    timestamptz '2026-11-03 00:00:00+00',
    timestamptz '2026-11-03 00:00:00+00',
    1, time '09:00', time '11:00', false
  ),
  (
    '90000000-0000-4000-8000-000000000004',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '94000000-0000-4000-8000-000000000001',
    'completed',
    array['11111111-1111-4111-8111-111111111111'],
    timestamptz '2026-11-03 00:00:00+00',
    timestamptz '2026-11-03 00:00:00+00',
    1, time '15:00', time '16:00', false
  ),
  (
    '90000000-0000-4000-8000-000000000005',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '94000000-0000-4000-8000-000000000001',
    'cancelled',
    array['11111111-1111-4111-8111-111111111111'],
    timestamptz '2026-11-03 00:00:00+00',
    timestamptz '2026-11-03 00:00:00+00',
    1, time '08:00', time '17:00', true
  );

insert into public.site_visits(
  id, company_id, scheduled_at, duration_minutes, assignee_ids,
  status, booked_at, created_by
) values (
  '91000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  timestamptz '2026-11-03 18:30:00+00',
  90,
  array['11111111-1111-4111-8111-111111111111'],
  'scheduled',
  timestamptz '2026-10-20 12:00:00+00',
  '11111111-1111-4111-8111-111111111111'
);

insert into public.calendar_user_events(
  id, user_id, company_id, type, title, start_date, end_date, all_day,
  status, team_member_ids
) values
  (
    '92000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'personal', 'private personal title',
    timestamptz '2026-11-03 19:30:00+00',
    timestamptz '2026-11-03 21:00:00+00',
    false, 'none', array[]::text[]
  ),
  (
    '92000000-0000-4000-8000-000000000002',
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'time_off', 'private leave reason',
    timestamptz '2026-11-02 08:00:00+00',
    timestamptz '2026-11-02 08:00:00+00',
    true, 'approved', array[]::text[]
  ),
  (
    '92000000-0000-4000-8000-000000000003',
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'personal', 'private all day title',
    timestamptz '2026-11-03 08:00:00+00',
    timestamptz '2026-11-03 08:00:00+00',
    true, 'none', array[]::text[]
  ),
  (
    '92000000-0000-4000-8000-000000000004',
    '33333333-3333-4333-8333-333333333333',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'time_off', 'pending must not reduce',
    timestamptz '2026-11-02 08:00:00+00',
    timestamptz '2026-11-02 08:00:00+00',
    true, 'pending', array[]::text[]
  ),
  (
    '92000000-0000-4000-8000-000000000005',
    '33333333-3333-4333-8333-333333333333',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'time_off', 'denied must not reduce',
    timestamptz '2026-11-03 08:00:00+00',
    timestamptz '2026-11-03 08:00:00+00',
    true, 'denied', array[]::text[]
  );

do $company_and_self_contract$
declare
  v_first jsonb;
  v_second jsonb;
  v_full jsonb;
  v_self jsonb;
  v_context jsonb;
  v_children jsonb;
  v_expected text;
  v_row jsonb;
  v_last jsonb;
  v_utc_items jsonb;
  v_other_items jsonb;
  v_revision_before bigint;
  v_revision_after bigint;
begin
  v_first := private.test_team_availability_call(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '80000000-0000-4000-8000-000000000001',
    'company', 'all', 'all',
    date '2026-11-01', date '2026-11-03', 2,
    null, '[]'::jsonb, null, null
  );

  if v_first ->> 'view' <> 'company'
     or v_first ->> 'starts_on' <> '2026-11-01'
     or v_first ->> 'ends_on' <> '2026-11-03'
     or v_first ->> 'company_timezone' <> 'America/Vancouver'
     or v_first ->> 'ranking_revision' <>
       'availability-member-order:2026-08-22.v1'
     or v_first -> 'source_revisions' <> jsonb_build_array(
       jsonb_build_object('domain','availability','source_revision',
         (v_first #>> '{source_revisions,0,source_revision}')::bigint),
       jsonb_build_object('domain','site_visits','source_revision',
         (v_first #>> '{source_revisions,1,source_revision}')::bigint),
       jsonb_build_object('domain','tasks','source_revision',
         (v_first #>> '{source_revisions,2,source_revision}')::bigint),
       jsonb_build_object('domain','team','source_revision',
         (v_first #>> '{source_revisions,3,source_revision}')::bigint)
     )
     or jsonb_array_length(v_first -> 'rows') <> 2
     or (v_first ->> 'source_has_more')::boolean is not true
     or v_first #>> '{rows,0,item,display_name}' <> 'Avery Chen'
     or v_first #>> '{rows,1,item,display_name}' <> 'Carly Hunter'
     or v_first #>> '{rows,0,item,days,0,state}' <> 'unavailable'
     or v_first #>> '{rows,0,item,days,0,working_minutes}' <> '0'
     or v_first #>> '{rows,0,item,days,1,state}' <> 'committed'
     or v_first #>> '{rows,0,item,days,1,committed_minutes}' <> '540'
     or v_first #>> '{rows,0,item,days,2,state}' <> 'limited'
     or v_first #>> '{rows,0,item,days,2,committed_minutes}' <> '390'
     or v_first #>> '{rows,0,item,days,2,available_minutes}' <> '150'
     or v_first #>> '{rows,1,item,days,1,state}' <> 'unavailable'
     or v_first #>> '{rows,1,item,days,1,committed_minutes}' <> '540'
     or v_first #>> '{rows,1,item,days,2,state}' <> 'committed' then
    raise exception 'agent_availability_runtime_failed: company_capacity %',
      v_first;
  end if;

  if v_first::text ~
    '"(title|notes|event_type|source_type|provider_id|location|leave_reason|project_ref|customer_ref|event_count|appointment_title|appointment_location|google_calendar_event_id)"[[:space:]]*:'
  then
    raise exception 'agent_availability_runtime_failed: privacy_leak';
  end if;

  v_context := v_first - array['rows', 'collection_proof_ref'];
  for v_row in
    select value from jsonb_array_elements(v_first -> 'rows')
  loop
    v_expected := 'ops_proof:v1:' || encode(
      extensions.digest(
        convert_to(
          private.canonical_agent_projection_json(
            v_context || jsonb_build_object(
              'proof_kind', 'team_availability_entity',
              'item', v_row -> 'item'
            )
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
    if v_row ->> 'proof_ref' <> v_expected then
      raise exception 'agent_availability_runtime_failed: entity_proof';
    end if;
    v_expected := 'ops_evidence:v1:' || encode(
      extensions.digest(
        convert_to(
          private.canonical_agent_projection_json(
            v_context || jsonb_build_object(
              'proof_kind', 'team_availability_evidence',
              'member_ref', v_row #> '{item,member_ref}'
            )
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
    if v_row ->> 'evidence_ref' <> v_expected then
      raise exception 'agent_availability_runtime_failed: evidence_proof';
    end if;
  end loop;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'member_ref', row.value #> '{item,member_ref}',
               'proof_ref', row.value ->> 'proof_ref',
               'evidence_ref', row.value ->> 'evidence_ref'
             )
             order by row.ordinality
           ),
           '[]'::jsonb
         )
    into v_children
  from jsonb_array_elements(v_first -> 'rows')
    with ordinality row(value, ordinality);
  v_expected := 'ops_proof:v1:' || encode(
    extensions.digest(
      convert_to(
        private.canonical_agent_projection_json(
          v_context || jsonb_build_object(
            'proof_kind', 'team_availability_collection',
            'returned_count', jsonb_array_length(v_first -> 'rows'),
            'has_more', (v_first ->> 'source_has_more')::boolean,
            'children', v_children
          )
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  if v_first ->> 'collection_proof_ref' <> v_expected then
    raise exception 'agent_availability_runtime_failed: collection_proof';
  end if;

  v_last := v_first #> '{rows,1,predecessor}';
  v_second := private.test_team_availability_call(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '80000000-0000-4000-8000-000000000001',
    'company', 'all', 'all',
    date '2026-11-01', date '2026-11-03', 2,
    (v_first ->> 'read_at')::timestamptz,
    v_first -> 'source_revisions',
    v_last #>> '{order,0}',
    (v_last ->> 'tie_breaker')::uuid
  );
  if jsonb_array_length(v_second -> 'rows') <> 2
     or v_second #>> '{rows,0,item,display_name}' <> 'Self Only'
     or v_second #>> '{rows,1,item,display_name}' <> 'Zoë Adams'
     or (v_second ->> 'source_has_more')::boolean
     or v_second #>> '{rows,1,item,days,1,state}' <> 'available'
     or v_second #>> '{rows,1,item,days,2,state}' <> 'available' then
    raise exception 'agent_availability_runtime_failed: cursor_or_pending';
  end if;

  v_self := private.test_team_availability_call(
    '44444444-4444-4444-8444-444444444444',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '80000000-0000-4000-8000-000000000002',
    'self', null, 'own',
    date '2026-11-02', date '2026-11-02', 1,
    null, '[]'::jsonb, null, null
  );
  if v_self ->> 'view' <> 'self'
     or v_self -> 'team_scope' <> 'null'::jsonb
     or jsonb_array_length(v_self -> 'rows') <> 1
     or v_self #>> '{rows,0,item,member_ref,id}' <>
       '44444444-4444-4444-8444-444444444444'
     or (v_self ->> 'source_has_more')::boolean then
    raise exception 'agent_availability_runtime_failed: self';
  end if;

  perform set_config('TimeZone', 'UTC', true);
  v_full := private.test_team_availability_call(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '80000000-0000-4000-8000-000000000001',
    'company', 'all', 'all',
    date '2026-11-01', date '2026-11-03', 10,
    null, '[]'::jsonb, null, null
  );
  select jsonb_agg(row.value -> 'item' order by row.ordinality)
    into v_utc_items
  from jsonb_array_elements(v_full -> 'rows')
    with ordinality row(value, ordinality);

  perform set_config('TimeZone', 'Asia/Kathmandu', true);
  v_full := private.test_team_availability_call(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '80000000-0000-4000-8000-000000000001',
    'company', 'all', 'all',
    date '2026-11-01', date '2026-11-03', 10,
    null, '[]'::jsonb, null, null
  );
  select jsonb_agg(row.value -> 'item' order by row.ordinality)
    into v_other_items
  from jsonb_array_elements(v_full -> 'rows')
    with ordinality row(value, ordinality);
  if v_other_items is distinct from v_utc_items then
    raise exception 'agent_availability_runtime_failed: server_timezone';
  end if;
  perform set_config('TimeZone', 'UTC', true);

  select source_revision into v_revision_before
  from private.agent_read_domain_revisions
  where company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and domain = 'availability';
  update public.calendar_user_events
  set title = title || ' changed privately'
  where id = '92000000-0000-4000-8000-000000000001';
  select source_revision into v_revision_after
  from private.agent_read_domain_revisions
  where company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and domain = 'availability';
  if v_revision_after <> v_revision_before then
    raise exception 'agent_availability_runtime_failed: irrelevant_revision';
  end if;

  update public.calendar_user_events
  set start_date = start_date + interval '1 minute'
  where id = '92000000-0000-4000-8000-000000000001';
  begin
    perform private.test_team_availability_call(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '80000000-0000-4000-8000-000000000001',
      'company', 'all', 'all',
      date '2026-11-01', date '2026-11-03', 2,
      (v_first ->> 'read_at')::timestamptz,
      v_first -> 'source_revisions',
      v_last #>> '{order,0}',
      (v_last ->> 'tie_breaker')::uuid
    );
    raise exception 'agent_availability_runtime_failed: stale_accepted';
  exception when serialization_failure then
    if sqlerrm <> 'agent_availability_snapshot_stale' then raise; end if;
  end;
end;
$company_and_self_contract$;

do $dst_contract$
declare
  v_spring jsonb;
  v_fall jsonb;
begin
  v_spring := private.test_team_availability_call(
    '55555555-5555-4555-8555-555555555555',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '80000000-0000-4000-8000-000000000003',
    'self', null, 'own',
    date '2026-03-08', date '2026-03-08', 1,
    null, '[]'::jsonb, null, null
  );
  v_fall := private.test_team_availability_call(
    '55555555-5555-4555-8555-555555555555',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '80000000-0000-4000-8000-000000000003',
    'self', null, 'own',
    date '2026-11-01', date '2026-11-01', 1,
    null, '[]'::jsonb, null, null
  );
  if v_spring #>> '{rows,0,item,days,0,working_minutes}' <> '180'
     or v_spring #>> '{rows,0,item,days,0,state}' <> 'available'
     or v_fall #>> '{rows,0,item,days,0,working_minutes}' <> '300'
     or v_fall #>> '{rows,0,item,days,0,state}' <> 'available' then
    raise exception 'agent_availability_runtime_failed: dst %, %',
      v_spring, v_fall;
  end if;
end;
$dst_contract$;

do $authorization_contract$
begin
  begin
    perform private.test_team_availability_call(
      '44444444-4444-4444-8444-444444444444',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '80000000-0000-4000-8000-000000000002',
      'company', 'all', 'all',
      date '2026-11-02', date '2026-11-02', 1,
      null, '[]'::jsonb, null, null
    );
    raise exception 'agent_availability_runtime_failed: team_inference';
  exception when insufficient_privilege then
    if sqlerrm <> 'agent_availability_not_authorized' then raise; end if;
  end;

  update public.users
  set is_active = false
  where id = '44444444-4444-4444-8444-444444444444';
  begin
    perform private.test_team_availability_call(
      '44444444-4444-4444-8444-444444444444',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '80000000-0000-4000-8000-000000000002',
      'self', null, 'own',
      date '2026-11-02', date '2026-11-02', 1,
      null, '[]'::jsonb, null, null
    );
    raise exception 'agent_availability_runtime_failed: inactive_actor';
  exception when no_data_found then
    null;
  end;
  update public.users
  set is_active = true
  where id = '44444444-4444-4444-8444-444444444444';

  perform set_config('request.jwt.claim.role', 'anon', true);
  begin
    perform public.read_agent_team_availability_as_system(
      'availability-runtime-request',
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '80000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000001',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      array['ops.team.read'],
      (
        select permission_snapshot_revision
        from private.resolve_agent_actor_authority(
          '11111111-1111-4111-8111-111111111111',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          array['calendar.view','team.view']
        )
      ),
      array['calendar.view','team.view'],
      'list_team_availability',
      'list_team_availability:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.team.read'],
      'company', 'all', 'all',
      date '2026-11-02', date '2026-11-02',
      1, 2, 501, 501, null, '[]'::jsonb, null, null
    );
    raise exception 'agent_availability_runtime_failed: anon_execute';
  exception when insufficient_privilege then
    if sqlerrm <> 'access_denied' then raise; end if;
  end;
  perform set_config('request.jwt.claim.role', 'service_role', true);
end;
$authorization_contract$;

do $source_revision_contract$
declare
  v_before jsonb;
  v_after jsonb;
begin
  select jsonb_object_agg(domain, source_revision)
    into v_before
  from private.agent_read_domain_revisions
  where company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  insert into public.project_tasks(
    id, company_id, project_id, status, team_member_ids, start_date, end_date,
    duration, all_day
  ) values (
    '93000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '94000000-0000-4000-8000-000000000001',
    'active',
    array['11111111-1111-4111-8111-111111111111'],
    timestamptz '2026-11-02 00:00:00+00',
    timestamptz '2026-11-02 00:00:00+00',
    1, true
  );

  select jsonb_object_agg(domain, source_revision)
    into v_after
  from private.agent_read_domain_revisions
  where company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  if (v_after ->> 'availability')::bigint <>
       (v_before ->> 'availability')::bigint + 1
     or (v_after ->> 'tasks')::bigint <>
       (v_before ->> 'tasks')::bigint + 1
     or (v_after ->> 'site_visits')::bigint <>
       (v_before ->> 'site_visits')::bigint + 1
     or (v_after ->> 'team')::bigint <>
       (v_before ->> 'team')::bigint then
    raise exception 'agent_availability_runtime_failed: task_fanout';
  end if;
  delete from public.project_tasks
  where id = '93000000-0000-4000-8000-000000000001';
end;
$source_revision_contract$;

do $invalid_source_contract$
begin
  insert into public.calendar_user_events(
    id, user_id, company_id, type, title, start_date, end_date,
    all_day, status, team_member_ids
  ) values (
    '94000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'personal', 'invalid source',
    timestamptz '2026-11-02 19:00:00+00',
    timestamptz '2026-11-02 18:00:00+00',
    false, 'none',
    array[
      '11111111-1111-4111-8111-111111111111',
      'not-a-uuid'
    ]
  );
  begin
    perform private.test_team_availability_call(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '80000000-0000-4000-8000-000000000001',
      'company', 'all', 'all',
      date '2026-11-02', date '2026-11-02', 10,
      null, '[]'::jsonb, null, null
    );
    raise exception 'agent_availability_runtime_failed: invalid_source_accepted';
  exception when data_exception then
    if sqlerrm <> 'agent_availability_source_data_invalid' then raise; end if;
  end;
  delete from public.calendar_user_events
  where id = '94000000-0000-4000-8000-000000000001';

  update public.companies
  set timezone = 'Invalid/Zone'
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  begin
    perform private.test_team_availability_call(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '80000000-0000-4000-8000-000000000001',
      'company', 'all', 'all',
      date '2026-11-02', date '2026-11-02', 10,
      null, '[]'::jsonb, null, null
    );
    raise exception
      'agent_availability_runtime_failed: invalid_timezone_accepted';
  exception when data_exception then
    if sqlerrm <> 'agent_availability_source_data_invalid' then raise; end if;
  end;
  update public.companies
  set timezone = 'America/Vancouver'
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
end;
$invalid_source_contract$;

do $member_bound_contract$
begin
  insert into public.users(id, company_id, first_name, last_name, is_active)
  select (
           'a1' || pg_catalog.lpad(pg_catalog.to_hex(value), 6, '0') ||
           '-0000-4000-8000-' ||
           pg_catalog.lpad(pg_catalog.to_hex(value), 12, '0')
         )::uuid,
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         'Bound',
         pg_catalog.lpad(value::text, 4, '0'),
         true
  from pg_catalog.generate_series(1, 497) value;

  begin
    perform private.test_team_availability_call(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '80000000-0000-4000-8000-000000000001',
      'company', 'all', 'all',
      date '2026-11-02', date '2026-11-02', 10,
      null, '[]'::jsonb, null, null
    );
    raise exception 'agent_availability_runtime_failed: member_bound_accepted';
  exception when program_limit_exceeded then
    if sqlerrm <> 'agent_availability_member_source_query_bound' then raise; end if;
  end;

  delete from public.users
  where first_name = 'Bound'
    and company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
end;
$member_bound_contract$;

do $schedule_bound_contract$
begin
  insert into public.calendar_user_events(
    id, user_id, company_id, type, title, start_date, end_date,
    all_day, status, team_member_ids
  )
  select (
           'b2' || pg_catalog.lpad(pg_catalog.to_hex(value), 6, '0') ||
           '-0000-4000-8000-' ||
           pg_catalog.lpad(pg_catalog.to_hex(value), 12, '0')
         )::uuid,
         '11111111-1111-4111-8111-111111111111',
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         'personal',
         'bounded source',
         timestamptz '2026-11-02 17:00:00+00' +
           pg_catalog.make_interval(secs => value),
         timestamptz '2026-11-02 17:00:30+00' +
           pg_catalog.make_interval(secs => value),
         false,
         'none',
         array[]::text[]
  from pg_catalog.generate_series(1, 501) value;

  begin
    perform private.test_team_availability_call(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '80000000-0000-4000-8000-000000000001',
      'self', null, 'all',
      date '2026-11-02', date '2026-11-02', 1,
      null, '[]'::jsonb, null, null
    );
    raise exception 'agent_availability_runtime_failed: schedule_bound_accepted';
  exception when program_limit_exceeded then
    if sqlerrm <> 'agent_availability_schedule_source_query_bound' then raise; end if;
  end;

  delete from public.calendar_user_events
  where title = 'bounded source'
    and company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
end;
$schedule_bound_contract$;

rollback;
