\set ON_ERROR_STOP on

\if :{?agent_mcp_integration_health_bootstrap}
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

create type public.gmail_connection_type as enum ('company', 'individual');

create table public.companies (
  id uuid primary key,
  deleted_at timestamptz
);
create table public.users (
  id uuid primary key,
  company_id uuid,
  is_active boolean default true,
  deleted_at timestamptz
);
create table public.email_connections (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  type public.gmail_connection_type not null default 'company',
  user_id text,
  provider text not null default 'gmail',
  status text not null default 'active',
  sync_enabled boolean not null default true,
  webhook_subscription_id text,
  webhook_expires_at timestamptz,
  last_synced_at timestamptz,
  provider_snapshot_at timestamptz,
  granted_scopes text[],
  created_at timestamptz
);
create table public.accounting_connections (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  provider text not null,
  provider_environment text not null default 'production',
  is_connected boolean not null default false,
  sync_enabled boolean not null default false,
  last_sync_at timestamptz,
  unique(company_id, provider, provider_environment)
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
  ('company'), ('integrations');

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

\ir ../../supabase/migrations/20260829102510_agent_integration_health_sources.sql
\ir ../../supabase/migrations/20260829102520_agent_integration_health_read.sql
\endif

begin;

create function private.test_integration_health_call(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_accounting_scope text,
  p_email_scope text,
  p_selections jsonb,
  p_source_limit integer default 501
) returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_client_id uuid;
  v_grant_revision text;
  v_scopes text[];
  v_permission_revision text;
begin
  select grant_row.client_id, grant_row.revision, grant_row.scopes
    into strict v_client_id, v_grant_revision, v_scopes
  from private.mcp_oauth_grants grant_row
  where grant_row.id = p_oauth_grant_id;

  select authority.permission_snapshot_revision
    into strict v_permission_revision
  from private.resolve_agent_actor_authority(
    p_actor_user_id,
    p_company_id,
    array[
      'accounting.view',
      'email.view',
      'settings.integrations'
    ]::text[]
  ) authority;

  return public.read_agent_integration_health_as_system(
    'integration-health-runtime-request',
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    v_client_id,
    v_grant_revision,
    v_scopes,
    v_permission_revision,
    array[
      'accounting.view',
      'email.view',
      'settings.integrations'
    ]::text[],
    'get_integration_health',
    'get_integration_health:2026-08-22.v1',
    '2026-08-22.capability-manifest.v8',
    array['ops.integrations.read']::text[],
    'all',
    p_accounting_scope,
    p_email_scope,
    p_selections,
    p_source_limit
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
    'private.agent_p2_integration_health_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,jsonb,integer)';
  v_public_signature constant text :=
    'public.read_agent_integration_health_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,jsonb,integer)';
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000
     or pg_catalog.current_setting('server_version_num')::integer >= 180000 then
    raise exception 'agent_integration_health_runtime_failed: requires_pg17';
  end if;
  if pg_catalog.to_regprocedure(v_private_signature) is null
     or pg_catalog.to_regprocedure(v_public_signature) is null then
    raise exception 'agent_integration_health_runtime_failed: function_missing';
  end if;
  if pg_catalog.pg_get_functiondef(
       pg_catalog.to_regprocedure(v_private_signature)::oid
     ) ~* '\\m(insert|update|delete|merge|truncate)\\M'
     or pg_catalog.pg_get_functiondef(
       pg_catalog.to_regprocedure(v_public_signature)::oid
     ) ~* '\\m(insert|update|delete|merge|truncate)\\M' then
    raise exception 'agent_integration_health_runtime_failed: dml_capability';
  end if;
  if pg_catalog.has_function_privilege(
       'anon', v_public_signature, 'EXECUTE'
     ) or pg_catalog.has_function_privilege(
       'authenticated', v_public_signature, 'EXECUTE'
     ) or pg_catalog.has_function_privilege(
       'service_role', v_private_signature, 'EXECUTE'
     ) or not pg_catalog.has_function_privilege(
       'service_role', v_public_signature, 'EXECUTE'
     ) then
    raise exception 'agent_integration_health_runtime_failed: acl';
  end if;
  if pg_catalog.to_regclass(
       'public.idx_email_connections_agent_integration_health_v1'
     ) is null or pg_catalog.to_regclass(
       'public.idx_accounting_connections_agent_integration_health_v1'
     ) is null then
    raise exception 'agent_integration_health_runtime_failed: index_missing';
  end if;
end;
$catalog_contract$;

insert into public.companies(id,name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Integration Primary'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Integration Secondary');

insert into public.users(
  id, company_id, first_name, last_name, is_active
) values
  (
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Primary', 'Operator',
    true
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Mailbox', 'Owner',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Other', 'Operator',
    true
  ),
  (
    '44444444-4444-4444-8444-444444444444',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'Bound', 'Operator',
    true
  );

insert into private.agent_read_domain_revisions(
  company_id, domain, source_revision
)
select company.id, domain.domain, 0
from public.companies company
cross join private.agent_read_domains domain
on conflict(company_id, domain) do update
  set source_revision = excluded.source_revision;

insert into public.user_permission_overrides(
  id, user_id, company_id, permission, scope, granted
) values
  (
    '50000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'accounting.view', 'all', true
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'email.view', 'all', true
  ),
  (
    '50000000-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'settings.integrations', 'all', true
  ),
  (
    '50000000-0000-4000-8000-000000000004',
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'email.view', 'own', true
  ),
  (
    '50000000-0000-4000-8000-000000000005',
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'settings.integrations', 'all', true
  ),
  (
    '50000000-0000-4000-8000-000000000006',
    '44444444-4444-4444-8444-444444444444',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'email.view', 'all', true
  ),
  (
    '50000000-0000-4000-8000-000000000007',
    '44444444-4444-4444-8444-444444444444',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'settings.integrations', 'all', true
  );

insert into private.mcp_oauth_clients(
  client_id, client_name, redirect_uris, token_endpoint_auth_method,
  grant_types, response_types, scope, registration_source,
  scope_ceiling, consent_catalog_revision, exposure_revision
) values (
  '60000000-0000-4000-8000-000000000001',
  'Integration health runtime',
  array['https://integration-health-runtime.ops.invalid/callback']::text[],
  'none',
  array['authorization_code', 'refresh_token']::text[],
  array['code']::text[],
  'ops.integrations.read',
  'manual',
  array['ops.integrations.read'],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);

insert into private.mcp_oauth_grants(
  id, user_id, company_id, client_id, scopes, revision, accepted_labels,
  consent_catalog_revision, exposure_revision
) values
  (
    '70000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '60000000-0000-4000-8000-000000000001',
    array['ops.integrations.read'],
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    private.mcp_oauth_labels_for_scopes(
      array['ops.integrations.read']::text[],
      '2026-08-22.mcp-consent-catalog.v1'
    ),
    '2026-08-22.mcp-consent-catalog.v1',
    '2026-08-22.mcp-exposure.v1'
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '60000000-0000-4000-8000-000000000001',
    array['ops.integrations.read'],
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    private.mcp_oauth_labels_for_scopes(
      array['ops.integrations.read']::text[],
      '2026-08-22.mcp-consent-catalog.v1'
    ),
    '2026-08-22.mcp-consent-catalog.v1',
    '2026-08-22.mcp-exposure.v1'
  ),
  (
    '70000000-0000-4000-8000-000000000003',
    '44444444-4444-4444-8444-444444444444',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '60000000-0000-4000-8000-000000000001',
    array['ops.integrations.read'],
    'cccccccccccccccccccccccccccccccc',
    private.mcp_oauth_labels_for_scopes(
      array['ops.integrations.read']::text[],
      '2026-08-22.mcp-consent-catalog.v1'
    ),
    '2026-08-22.mcp-consent-catalog.v1',
    '2026-08-22.mcp-exposure.v1'
  );

insert into public.accounting_connections(
  id, company_id, provider, provider_environment, is_connected,
  sync_enabled, last_sync_at
) values (
  '80000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'quickbooks', 'production', true, true,
  pg_catalog.statement_timestamp() - interval '1 hour'
);

insert into public.email_connections(
  id, company_id, type, user_id, email, provider, status, sync_enabled,
  webhook_subscription_id, webhook_expires_at, provider_snapshot_at,
  granted_scopes, created_at
) values
  (
    '90000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'individual', '22222222-2222-4222-8222-222222222222',
    'operator-mailbox@ops.test',
    'gmail', 'active', true, 'self-webhook',
    pg_catalog.statement_timestamp() + interval '1 day',
    pg_catalog.statement_timestamp() - interval '1 hour',
    array['https://www.googleapis.com/auth/calendar.events'],
    pg_catalog.statement_timestamp() - interval '2 days'
  ),
  (
    '90000000-0000-4000-8000-000000000002',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'company', null, 'company-mailbox@ops.test',
    'gmail', 'paused', true, 'company-webhook',
    pg_catalog.statement_timestamp() + interval '1 day',
    pg_catalog.statement_timestamp() - interval '2 hours',
    array['mail.read'], pg_catalog.statement_timestamp() - interval '2 days'
  ),
  (
    '90000000-0000-4000-8000-000000000003',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'individual', '33333333-3333-4333-8333-333333333333',
    'other-mailbox@ops.test',
    'gmail', 'error', true, 'other-webhook',
    pg_catalog.statement_timestamp() + interval '1 day',
    pg_catalog.statement_timestamp() - interval '3 hours',
    array['mail.read'], pg_catalog.statement_timestamp() - interval '2 days'
  );

do $health_contract$
declare
  v_all jsonb;
  v_before jsonb;
  v_after jsonb;
  v_state jsonb;
  v_context jsonb;
  v_children jsonb;
  v_expected text;
  v_revision_before bigint;
  v_revision_after bigint;
begin
  v_all := private.test_integration_health_call(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '70000000-0000-4000-8000-000000000001',
    'all', 'all',
    '[
      {"integration_type":"accounting","provider":"quickbooks"},
      {"integration_type":"accounting","provider":"sage"},
      {"integration_type":"mailbox","provider":"gmail"},
      {"integration_type":"mailbox","provider":"microsoft365"}
    ]'::jsonb
  );
  if pg_catalog.jsonb_array_length(v_all -> 'rows') <> 4
     or v_all #>> '{rows,0,item,connection_state}' <> 'active'
     or v_all #>> '{rows,0,item,sync_state}' <> 'healthy'
     or v_all #>> '{rows,1,item,connection_state}' <> 'not_configured'
     or v_all #>> '{rows,2,item,reason_code}' <> 'provider_error'
     or v_all #>> '{rows,3,item,reason_code}' <> 'not_configured'
     or (v_all #>> '{source_inspected,accounting}')::integer <> 1
     or (v_all #>> '{source_inspected,mailbox}')::integer <> 3 then
    raise exception 'agent_integration_health_runtime_failed: all_projection:%',
      v_all;
  end if;

  if v_all::text ~
    '"(access_token|refresh_token|expires_at|realm_id|history_id|history_recovery_page_token|history_recovery_target_token|webhook_subscription_id|webhook_expires_at|sync_filters|sync_direction|sync_interval_minutes|agent_can_send_from|ai_memory_enabled|ai_review_enabled|archive_lead_preference|archive_writeback_preference|propagate_deletes|raw_error|provider_id|connection_id|user_id|email)"[[:space:]]*:' then
    raise exception 'agent_integration_health_runtime_failed: privacy';
  end if;

  perform pg_catalog.set_config('TimeZone', 'Pacific/Auckland', true);
  v_state := private.test_integration_health_call(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '70000000-0000-4000-8000-000000000001',
    'all', 'all',
    '[
      {"integration_type":"accounting","provider":"quickbooks"},
      {"integration_type":"accounting","provider":"sage"},
      {"integration_type":"mailbox","provider":"gmail"},
      {"integration_type":"mailbox","provider":"microsoft365"}
    ]'::jsonb
  );
  if v_state is distinct from v_all then
    raise exception 'agent_integration_health_runtime_failed: timezone:%',
      v_state;
  end if;
  perform pg_catalog.set_config('TimeZone', 'UTC', true);

  -- Recompute the first entity, evidence, and collection hashes.
  v_context := v_all - array['rows', 'collection_proof_ref'];
  v_expected := 'ops_proof:v1:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        private.canonical_agent_projection_json(
          v_context || pg_catalog.jsonb_build_object(
            'proof_kind', 'integration_health_entity',
            'item', v_all #> '{rows,0,item}'
          )
        ), 'UTF8'
      ), 'sha256'
    ), 'hex'
  );
  if v_all #>> '{rows,0,proof_ref}' <> v_expected then
    raise exception 'agent_integration_health_runtime_failed: entity_proof';
  end if;
  v_expected := 'ops_evidence:v1:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        private.canonical_agent_projection_json(
          v_context || pg_catalog.jsonb_build_object(
            'proof_kind', 'integration_health_evidence',
            'selection', v_all #> '{selections,0}'
          )
        ), 'UTF8'
      ), 'sha256'
    ), 'hex'
  );
  if v_all #>> '{rows,0,evidence_ref}' <> v_expected then
    raise exception 'agent_integration_health_runtime_failed: evidence_proof';
  end if;
  select pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'selection', v_all #> array['selections', (entry.ordinality - 1)::text],
             'proof_ref', entry.value ->> 'proof_ref',
             'evidence_ref', entry.value ->> 'evidence_ref'
           ) order by entry.ordinality
         )
    into v_children
  from pg_catalog.jsonb_array_elements(v_all -> 'rows')
    with ordinality entry(value, ordinality);
  v_expected := 'ops_proof:v1:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        private.canonical_agent_projection_json(
          v_context || pg_catalog.jsonb_build_object(
            'proof_kind', 'integration_health_collection',
            'returned_count', 4,
            'has_more', false,
            'children', v_children
          )
        ), 'UTF8'
      ), 'sha256'
    ), 'hex'
  );
  if v_all ->> 'collection_proof_ref' <> v_expected then
    raise exception 'agent_integration_health_runtime_failed: collection_proof';
  end if;

  v_before := private.test_integration_health_call(
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '70000000-0000-4000-8000-000000000002',
    null, 'own',
    '[{"integration_type":"mailbox","provider":"gmail"}]'::jsonb
  );
  select source_revision into strict v_revision_before
  from private.agent_read_domain_revisions
  where company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and domain = 'integrations';

  update public.email_connections
  set status = 'needs_reconnect'
  where id = '90000000-0000-4000-8000-000000000003';

  v_after := private.test_integration_health_call(
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '70000000-0000-4000-8000-000000000002',
    null, 'own',
    '[{"integration_type":"mailbox","provider":"gmail"}]'::jsonb
  );
  select source_revision into strict v_revision_after
  from private.agent_read_domain_revisions
  where company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and domain = 'integrations';

  if v_before #> '{rows,0,item}' is distinct from v_after #> '{rows,0,item}'
     or v_before -> 'source_inspected' is distinct from
       v_after -> 'source_inspected'
     or pg_catalog.jsonb_array_length(v_after -> 'rows') <> 1
     or (v_after #>> '{source_inspected,mailbox}')::integer <> 1
     or v_revision_after <= v_revision_before
     or v_before #>> '{source_revisions,1,source_revision}' =
       v_after #>> '{source_revisions,1,source_revision}'
     or v_before #>> '{rows,0,evidence_ref}' =
       v_after #>> '{rows,0,evidence_ref}' then
    raise exception 'agent_integration_health_runtime_failed: own_isolation';
  end if;

  -- Every mailbox-only authoritative reason has a fixed state coupling.
  update public.email_connections
  set status = 'needs_reconnect'
  where id = '90000000-0000-4000-8000-000000000001';
  v_state := private.test_integration_health_call(
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '70000000-0000-4000-8000-000000000002', null, 'own',
    '[{"integration_type":"mailbox","provider":"gmail"}]'::jsonb
  );
  if v_state #>> '{rows,0,item,reason_code}' <> 'needs_reconnect'
     or v_state #>> '{rows,0,item,connection_state}' <>
       'reconnect_required' then
    raise exception 'agent_integration_health_runtime_failed: needs_reconnect';
  end if;

  update public.email_connections
  set status = 'active', sync_enabled = true,
      webhook_subscription_id = 'expired-webhook',
      webhook_expires_at = pg_catalog.statement_timestamp() - interval '1 second',
      provider_snapshot_at = pg_catalog.statement_timestamp() - interval '1 hour'
  where id = '90000000-0000-4000-8000-000000000001';
  v_state := private.test_integration_health_call(
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '70000000-0000-4000-8000-000000000002', null, 'own',
    '[{"integration_type":"mailbox","provider":"gmail"}]'::jsonb
  );
  if v_state #>> '{rows,0,item,reason_code}' <> 'webhook_expired'
     or v_state #>> '{rows,0,item,connection_state}' <>
       'reconnect_required' then
    raise exception 'agent_integration_health_runtime_failed: webhook_expired';
  end if;

  update public.email_connections
  set webhook_subscription_id = null,
      webhook_expires_at = null,
      created_at = pg_catalog.statement_timestamp() - interval '25 hours'
  where id = '90000000-0000-4000-8000-000000000001';
  v_state := private.test_integration_health_call(
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '70000000-0000-4000-8000-000000000002', null, 'own',
    '[{"integration_type":"mailbox","provider":"gmail"}]'::jsonb
  );
  if v_state #>> '{rows,0,item,reason_code}' <> 'webhook_setup_failed'
     or v_state #>> '{rows,0,item,connection_state}' <>
       'attention_required' then
    raise exception 'agent_integration_health_runtime_failed: webhook_setup';
  end if;

  update public.email_connections
  set webhook_subscription_id = 'stale-webhook',
      webhook_expires_at = pg_catalog.statement_timestamp() + interval '1 day',
      provider_snapshot_at = pg_catalog.statement_timestamp() - interval '14 hours'
  where id = '90000000-0000-4000-8000-000000000001';
  v_state := private.test_integration_health_call(
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '70000000-0000-4000-8000-000000000002', null, 'own',
    '[{"integration_type":"mailbox","provider":"gmail"}]'::jsonb
  );
  if v_state #>> '{rows,0,item,reason_code}' <> 'sync_stale'
     or v_state #>> '{rows,0,item,sync_state}' <> 'stale'
     or v_state #>> '{rows,0,item,last_healthy_progress_at}' >
       v_state ->> 'read_at'
     or v_state #>> '{rows,0,item,last_healthy_progress_at}' !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' then
    raise exception 'agent_integration_health_runtime_failed: sync_stale:%',
      v_state;
  end if;

  update public.email_connections
  set status = 'error'
  where id = '90000000-0000-4000-8000-000000000001';
  v_state := private.test_integration_health_call(
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '70000000-0000-4000-8000-000000000002', null, 'own',
    '[{"integration_type":"mailbox","provider":"gmail"}]'::jsonb
  );
  if v_state #>> '{rows,0,item,reason_code}' <> 'provider_error'
     or v_state #>> '{rows,0,item,connection_state}' <>
       'attention_required' then
    raise exception 'agent_integration_health_runtime_failed: provider_error';
  end if;

  -- Accounting deliberately has no inferred stale threshold: last_sync_at is
  -- known to lag successful runs, so even old finite progress remains healthy.
  update public.accounting_connections
  set last_sync_at = pg_catalog.statement_timestamp() - interval '60 days'
  where id = '80000000-0000-4000-8000-000000000001';
  v_state := private.test_integration_health_call(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '70000000-0000-4000-8000-000000000001', 'all', null,
    '[{"integration_type":"accounting","provider":"quickbooks"}]'::jsonb
  );
  if v_state #>> '{rows,0,item,sync_state}' <> 'healthy'
     or v_state #>> '{rows,0,item,reason_code}' <> 'connected' then
    raise exception 'agent_integration_health_runtime_failed: accounting_exempt';
  end if;

  -- Future progress fails closed for both source classes.
  update public.accounting_connections
  set last_sync_at = pg_catalog.statement_timestamp() + interval '1 second'
  where id = '80000000-0000-4000-8000-000000000001';
  begin
    perform private.test_integration_health_call(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '70000000-0000-4000-8000-000000000001', 'all', null,
      '[{"integration_type":"accounting","provider":"quickbooks"}]'::jsonb
    );
    raise exception 'agent_integration_health_runtime_failed: future_allowed';
  exception when sqlstate '22000' then
    if sqlerrm <> 'agent_integration_health_source_data_invalid' then raise; end if;
  end;

  -- Canonical order and exact branch scopes fail closed.
  begin
    perform private.test_integration_health_call(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '70000000-0000-4000-8000-000000000001', 'all', 'all',
      '[
        {"integration_type":"mailbox","provider":"gmail"},
        {"integration_type":"accounting","provider":"quickbooks"}
      ]'::jsonb
    );
    raise exception 'agent_integration_health_runtime_failed: order_allowed';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform private.test_integration_health_call(
      '22222222-2222-4222-8222-222222222222',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '70000000-0000-4000-8000-000000000002', null, 'all',
      '[{"integration_type":"mailbox","provider":"gmail"}]'::jsonb
    );
    raise exception 'agent_integration_health_runtime_failed: own_widened';
  exception when sqlstate '42501' then null;
  end;
end;
$health_contract$;

-- Prove the physical 501 source-row ceiling in a separate company.
insert into public.email_connections(
  id, company_id, type, user_id, email, provider, status, sync_enabled,
  webhook_subscription_id, webhook_expires_at, provider_snapshot_at,
  granted_scopes, created_at
)
select (
         pg_catalog.substr(pg_catalog.md5('bound-' || series.value::text), 1, 8) || '-' ||
         pg_catalog.substr(pg_catalog.md5('bound-' || series.value::text), 9, 4) || '-4' ||
         pg_catalog.substr(pg_catalog.md5('bound-' || series.value::text), 14, 3) || '-8' ||
         pg_catalog.substr(pg_catalog.md5('bound-' || series.value::text), 18, 3) || '-' ||
         pg_catalog.substr(pg_catalog.md5('bound-' || series.value::text), 21, 12)
       )::uuid,
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
       'individual',
       '44444444-4444-4444-8444-444444444444',
       'bound-' || series.value::text || '@ops.test',
       'gmail', 'active', true,
       'bound-webhook-' || series.value::text,
       pg_catalog.statement_timestamp() + interval '1 day',
       pg_catalog.statement_timestamp() - interval '1 hour',
       array['mail.read'],
       pg_catalog.statement_timestamp() - interval '2 days'
from pg_catalog.generate_series(1, 501) series(value);

do $bound_contract$
begin
  begin
    perform private.test_integration_health_call(
      '44444444-4444-4444-8444-444444444444',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '70000000-0000-4000-8000-000000000003', null, 'all',
      '[{"integration_type":"mailbox","provider":"gmail"}]'::jsonb
    );
    raise exception 'agent_integration_health_runtime_failed: bound_allowed';
  exception when sqlstate '54000' then
    if sqlerrm <> 'agent_integration_health_source_query_bound' then raise; end if;
  end;
end;
$bound_contract$;

rollback;
