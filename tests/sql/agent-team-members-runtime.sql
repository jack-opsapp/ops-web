\set ON_ERROR_STOP on

\if :{?agent_mcp_team_bootstrap}
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
  profile_image_url text,
  user_color text,
  role text default 'unassigned',
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

create table private.agent_read_domains (
  domain text primary key
);
insert into private.agent_read_domains(domain) values ('company'), ('team');
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
    v_old_company_id := (
      pg_catalog.to_jsonb(old) ->> tg_argv[1]
    )::uuid;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_company_id := (
      pg_catalog.to_jsonb(new) ->> tg_argv[1]
    )::uuid;
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
      E'[\\n\\r\\t]' then null
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

\ir ../../supabase/migrations/20260829063450_agent_team_sources.sql
\ir ../../supabase/migrations/20260829063451_agent_team_members_read.sql
\endif

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local request.jwt.claim.role = 'service_role';

do $catalog_contract$
declare
  v_private_signature constant text :=
    'private.agent_p2_team_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)';
  v_public_signature constant text :=
    'public.read_agent_team_members_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)';
  v_plan json;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000
     or pg_catalog.current_setting('server_version_num')::integer >= 180000 then
    raise exception 'agent_team_runtime_failed: requires_pg17';
  end if;
  if pg_catalog.to_regprocedure(v_private_signature) is null
     or pg_catalog.to_regprocedure(v_public_signature) is null then
    raise exception 'agent_team_runtime_failed: function_missing';
  end if;
  if pg_catalog.has_function_privilege(
       'anon', v_public_signature, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated', v_public_signature, 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role', v_public_signature, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role', v_private_signature, 'EXECUTE'
     ) then
    raise exception 'agent_team_runtime_failed: acl';
  end if;

  perform pg_catalog.set_config('enable_seqscan', 'off', true);
  execute $plan$
    explain (format json, costs off)
    select member.id
    from public.users member
    where member.company_id =
      '91000000-0000-4000-8000-000000000001'::uuid
      and member.deleted_at is null
      and member.is_active is true
    order by private.agent_p2_optional_canonical_text(
               pg_catalog.btrim(member.first_name) || ' ' ||
                 pg_catalog.btrim(member.last_name),
               256,
               1024,
               false
             ) collate "C",
             member.id
    limit 501
  $plan$ into v_plan;
  if v_plan::text not like '%idx_users_agent_team_directory_v1%' then
    raise exception 'agent_team_runtime_failed: index_plan %', v_plan;
  end if;
end;
$catalog_contract$;

insert into public.companies(id, name) values
  ('91000000-0000-4000-8000-000000000001', 'Alpha Decks'),
  ('92000000-0000-4000-8000-000000000001', 'Other Company');

insert into private.agent_read_domain_revisions(
  company_id, domain, source_revision
) values
  ('91000000-0000-4000-8000-000000000001', 'company', 7),
  ('91000000-0000-4000-8000-000000000001', 'team', 0),
  ('92000000-0000-4000-8000-000000000001', 'company', 9),
  ('92000000-0000-4000-8000-000000000001', 'team', 0);

insert into public.users(
  id, company_id, first_name, last_name, profile_image_url, user_color,
  role, is_active, is_company_admin, deleted_at
) values
  (
    '91100000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'Alex', 'Morgan',
    'https://assets.opsapp.co/team/alex.png',
    '#5d7185', 'crew', true, false, null
  ),
  (
    '91100000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000001',
    'Carly', 'Hunter',
    's3://private-bucket/team/carly.png',
    'not-a-color', null, true, true, null
  ),
  (
    '91100000-0000-4000-8000-000000000003',
    '91000000-0000-4000-8000-000000000001',
    'Zoe', 'Field',
    null, '#ABCDEF', 'owner', true, true, null
  ),
  (
    '91100000-0000-4000-8000-000000000004',
    '91000000-0000-4000-8000-000000000001',
    'Inactive', 'Member',
    null, null, 'office', false, false, null
  ),
  (
    '91100000-0000-4000-8000-000000000005',
    '91000000-0000-4000-8000-000000000001',
    'Deleted', 'Member',
    null, null, 'operator', true, false,
    pg_catalog.statement_timestamp()
  ),
  (
    '92100000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'Other', 'Tenant',
    null, null, 'owner', true, false, null
  );

insert into public.user_permission_overrides(
  id, user_id, company_id, permission, scope, granted
) values (
  '91200000-0000-4000-8000-000000000001',
  '91100000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'team.view',
  'all',
  true
);

insert into private.mcp_oauth_clients(
  client_id, scope_ceiling, consent_catalog_revision, exposure_revision
) values (
  '91300000-0000-4000-8000-000000000001',
  array['ops.team.read']::text[],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);
insert into private.mcp_oauth_grants(
  id, user_id, company_id, client_id, scopes, revision, accepted_labels,
  consent_catalog_revision, exposure_revision
) values (
  '91400000-0000-4000-8000-000000000001',
  '91100000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '91300000-0000-4000-8000-000000000001',
  array['ops.team.read']::text[],
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  private.mcp_oauth_labels_for_scopes(
    array['ops.team.read']::text[],
    '2026-08-22.mcp-consent-catalog.v1'
  ),
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);

create temporary table agent_team_authority on commit drop as
select authority.permission_snapshot_revision
from private.resolve_agent_actor_authority(
  '91100000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  array['team.view']::text[]
) authority;

create temporary table agent_team_first_page on commit drop as
select public.read_agent_team_members_as_system(
  'team-runtime-first',
  '91100000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '91400000-0000-4000-8000-000000000001',
  '91300000-0000-4000-8000-000000000001',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  array['ops.team.read']::text[],
  (select permission_snapshot_revision from agent_team_authority),
  array['team.view']::text[],
  'list_team_members',
  'list_team_members:2026-08-22.v1',
  '2026-08-22.capability-manifest.v8',
  array['ops.team.read']::text[],
  'all',
  2,
  3,
  501,
  null,
  '[]'::jsonb,
  null,
  null
) as payload;

do $first_page_contract$
declare
  v_payload jsonb;
  v_context jsonb;
  v_row jsonb;
  v_expected text;
  v_children jsonb;
begin
  select payload into strict v_payload from agent_team_first_page;

  if v_payload ->> 'ranking_revision' is distinct from
       'team-member-order:2026-08-22.v1'
     or (v_payload ->> 'source_inspected')::integer <> 3
     or (v_payload ->> 'source_has_more')::boolean is not true
     or pg_catalog.jsonb_array_length(v_payload -> 'rows') <> 2
     or v_payload -> 'rows' -> 0 -> 'item' ->> 'display_name'
       is distinct from 'Alex Morgan'
     or v_payload -> 'rows' -> 0 -> 'item' ->> 'display_color'
       is distinct from '#5D7185'
     or v_payload -> 'rows' -> 1 -> 'item' ->> 'display_name'
       is distinct from 'Carly Hunter'
     or v_payload -> 'rows' -> 1 -> 'item' -> 'display_image' ->> 'state'
       is distinct from 'unavailable'
     or v_payload -> 'rows' -> 1 -> 'item' ->> 'team_label'
       is distinct from 'unassigned'
     or v_payload::text ~
       '"email"|"phone"|"auth_id"|"device_token"|"role_id"|"is_company_admin"'
       then
    raise exception 'agent_team_runtime_failed: first_page %', v_payload;
  end if;

  v_context := v_payload - array['rows', 'collection_proof_ref'];
  for v_row in
    select value from pg_catalog.jsonb_array_elements(v_payload -> 'rows')
  loop
    v_expected := 'ops_proof:v1:' || pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          private.canonical_agent_projection_json(
            v_context || pg_catalog.jsonb_build_object(
              'proof_kind', 'team_member_entity',
              'item', v_row -> 'item'
            )
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
    if v_row ->> 'proof_ref' is distinct from v_expected then
      raise exception 'agent_team_runtime_failed: item_proof %', v_row;
    end if;
  end loop;

  select coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'member_ref', row.value -> 'item' -> 'member_ref',
               'proof_ref', row.value ->> 'proof_ref',
               'evidence_ref', row.value ->> 'evidence_ref'
             ) order by row.ordinality
           ),
           '[]'::jsonb
         )
    into v_children
  from pg_catalog.jsonb_array_elements(v_payload -> 'rows')
    with ordinality row(value, ordinality);

  v_expected := 'ops_proof:v1:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        private.canonical_agent_projection_json(
          v_context || pg_catalog.jsonb_build_object(
            'proof_kind', 'team_member_collection',
            'returned_count', 2,
            'has_more', true,
            'children', v_children
          )
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  if v_payload ->> 'collection_proof_ref' is distinct from v_expected then
    raise exception 'agent_team_runtime_failed: collection_proof %', v_payload;
  end if;
end;
$first_page_contract$;

create temporary table agent_team_second_page on commit drop as
select public.read_agent_team_members_as_system(
  'team-runtime-second',
  '91100000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '91400000-0000-4000-8000-000000000001',
  '91300000-0000-4000-8000-000000000001',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  array['ops.team.read']::text[],
  (select permission_snapshot_revision from agent_team_authority),
  array['team.view']::text[],
  'list_team_members',
  'list_team_members:2026-08-22.v1',
  '2026-08-22.capability-manifest.v8',
  array['ops.team.read']::text[],
  'all',
  2,
  3,
  501,
  (select (payload ->> 'read_at')::timestamptz from agent_team_first_page),
  (select payload -> 'source_revisions' from agent_team_first_page),
  (select payload -> 'rows' -> 1 -> 'item' ->> 'display_name'
   from agent_team_first_page),
  (select (payload -> 'rows' -> 1 -> 'item' -> 'member_ref' ->> 'id')::uuid
   from agent_team_first_page)
) as payload;

do $second_page_contract$
declare
  v_payload jsonb;
begin
  select payload into strict v_payload from agent_team_second_page;
  if pg_catalog.jsonb_array_length(v_payload -> 'rows') <> 1
     or v_payload -> 'rows' -> 0 -> 'item' ->> 'display_name'
       is distinct from 'Zoe Field'
     or (v_payload ->> 'source_has_more')::boolean
     or v_payload ->> 'read_at' is distinct from (
       select payload ->> 'read_at' from agent_team_first_page
     ) then
    raise exception 'agent_team_runtime_failed: second_page %', v_payload;
  end if;
end;
$second_page_contract$;

do $source_fence_and_stale_contract$
declare
  v_before bigint;
  v_after bigint;
begin
  select source_revision into strict v_before
  from private.agent_read_domain_revisions
  where company_id = '91000000-0000-4000-8000-000000000001'
    and domain = 'team';

  update public.users
  set user_color = '#123456'
  where id = '91100000-0000-4000-8000-000000000003';

  select source_revision into strict v_after
  from private.agent_read_domain_revisions
  where company_id = '91000000-0000-4000-8000-000000000001'
    and domain = 'team';
  if v_after is distinct from v_before + 1 then
    raise exception 'agent_team_runtime_failed: source_fence';
  end if;

  begin
    perform public.read_agent_team_members_as_system(
      'team-runtime-stale',
      '91100000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      '91400000-0000-4000-8000-000000000001',
      '91300000-0000-4000-8000-000000000001',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      array['ops.team.read']::text[],
      (select permission_snapshot_revision from agent_team_authority),
      array['team.view']::text[],
      'list_team_members',
      'list_team_members:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.team.read']::text[],
      'all', 2, 3, 501,
      (select (payload ->> 'read_at')::timestamptz
       from agent_team_first_page),
      (select payload -> 'source_revisions' from agent_team_first_page),
      (select payload -> 'rows' -> 1 -> 'item' ->> 'display_name'
       from agent_team_first_page),
      (select (
         payload -> 'rows' -> 1 -> 'item' -> 'member_ref' ->> 'id'
       )::uuid from agent_team_first_page)
    );
    raise exception 'agent_team_runtime_failed: stale_visible';
  exception when sqlstate '40001' then null;
  end;
end;
$source_fence_and_stale_contract$;

do $invalid_source_contract$
begin
  update public.users
  set role = 'super_admin'
  where id = '91100000-0000-4000-8000-000000000003';
  begin
    perform public.read_agent_team_members_as_system(
      'team-runtime-invalid',
      '91100000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      '91400000-0000-4000-8000-000000000001',
      '91300000-0000-4000-8000-000000000001',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      array['ops.team.read']::text[],
      (select permission_snapshot_revision from agent_team_authority),
      array['team.view']::text[],
      'list_team_members',
      'list_team_members:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.team.read']::text[],
      'all', 25, 26, 501, null, '[]'::jsonb, null, null
    );
    raise exception 'agent_team_runtime_failed: invalid_source_visible';
  exception when sqlstate '22000' then null;
  end;
  update public.users
  set role = 'owner'
  where id = '91100000-0000-4000-8000-000000000003';
end;
$invalid_source_contract$;

do $revoked_grant_contract$
begin
  update private.mcp_oauth_grants
  set revoked_at = pg_catalog.statement_timestamp()
  where id = '91400000-0000-4000-8000-000000000001';
  begin
    perform public.read_agent_team_members_as_system(
      'team-runtime-revoked',
      '91100000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      '91400000-0000-4000-8000-000000000001',
      '91300000-0000-4000-8000-000000000001',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      array['ops.team.read']::text[],
      (select permission_snapshot_revision from agent_team_authority),
      array['team.view']::text[],
      'list_team_members',
      'list_team_members:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.team.read']::text[],
      'all', 25, 26, 501, null, '[]'::jsonb, null, null
    );
    raise exception 'agent_team_runtime_failed: revoked_visible';
  exception when sqlstate '42501' then null;
  end;
  update private.mcp_oauth_grants
  set revoked_at = null
  where id = '91400000-0000-4000-8000-000000000001';
end;
$revoked_grant_contract$;

do $source_bound_contract$
begin
  insert into public.users(
    id, company_id, first_name, last_name, role, is_active
  )
  select (
           'a9900000-0000-4000-8000-' ||
           pg_catalog.lpad(source.value::text, 12, '0')
         )::uuid,
         '91000000-0000-4000-8000-000000000001',
         'Bound',
         pg_catalog.lpad(source.value::text, 4, '0'),
         'crew',
         true
  from pg_catalog.generate_series(1, 501) source(value);

  begin
    perform public.read_agent_team_members_as_system(
      'team-runtime-bound',
      '91100000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      '91400000-0000-4000-8000-000000000001',
      '91300000-0000-4000-8000-000000000001',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      array['ops.team.read']::text[],
      (select permission_snapshot_revision from agent_team_authority),
      array['team.view']::text[],
      'list_team_members',
      'list_team_members:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.team.read']::text[],
      'all', 25, 26, 501, null, '[]'::jsonb, null, null
    );
    raise exception 'agent_team_runtime_failed: bound_visible';
  exception when sqlstate '54000' then null;
  end;
end;
$source_bound_contract$;

rollback;
