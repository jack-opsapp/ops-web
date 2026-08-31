-- MCP V3 SYNTHETIC CANARY — BEHAVIOR CONTRACT
--
-- ISOLATED DATABASE ONLY. This fixture supplies the minimum OAuth and routine
-- prerequisites, applies the forward migration, proves exact subject binding,
-- expiry, idempotency, cross-tenant denial, cleanup, ACLs, and RLS, then rolls
-- every object and mutation back.

\set ON_ERROR_STOP on

begin;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end;
$roles$;

create schema auth;
create schema private;

create function auth.role()
returns text language sql stable
as $function$
  select nullif(current_setting('request.jwt.claim.role', true), '');
$function$;

create table public.companies (
  id uuid primary key,
  name text not null,
  deleted_at timestamptz
);

create table public.users (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  is_active boolean not null
);

create table private.mcp_oauth_clients (
  client_id uuid primary key,
  client_name text not null,
  scope_ceiling text[] not null,
  consent_catalog_revision text not null,
  exposure_revision text not null,
  disabled_at timestamptz
);

create table private.mcp_oauth_grants (
  id uuid primary key,
  client_id uuid not null references private.mcp_oauth_clients(client_id),
  user_id uuid not null,
  company_id uuid not null,
  scopes text[] not null default array[
    'ops.correspondence.read',
    'ops.financial_documents.read',
    'ops.jobs.read',
    'ops.operations.prepare',
    'ops.operations.read',
    'ops.schedule.read',
    'ops.tasks.read'
  ],
  accepted_labels text[] not null default array[
    'correspondence', 'financial documents', 'jobs', 'prepare operations',
    'operations', 'schedule', 'tasks'
  ],
  consent_catalog_revision text not null default
    '2026-08-30.mcp-consent-catalog.v2',
  exposure_revision text not null,
  revision text not null default '0123456789abcdef0123456789abcdef',
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table private.mcp_oauth_tokens (
  token_hash text primary key,
  grant_id uuid not null references private.mcp_oauth_grants(id),
  family_id uuid not null default gen_random_uuid(),
  kind text not null default 'access',
  issuer text not null default 'https://app.opsapp.co',
  audience text not null default 'https://app.opsapp.co/api/mcp',
  expires_at timestamptz not null default statement_timestamp() + interval '1 hour',
  used_at timestamptz,
  rotated_to_hash text,
  revoked_at timestamptz
);

create table private.mcp_oauth_consent_previews (
  preview_hash text primary key,
  client_id uuid not null,
  user_id uuid not null,
  company_id uuid not null,
  consent_catalog_revision text not null,
  exposure_revision text not null
);

create table private.mcp_oauth_authorization_codes (
  code_hash text primary key,
  client_id uuid not null,
  user_id uuid not null,
  company_id uuid not null,
  consent_catalog_revision text not null,
  exposure_revision text not null
);

create table private.agent_day_closeout_routines (
  id uuid primary key,
  oauth_client_id uuid not null references private.mcp_oauth_clients(client_id),
  oauth_grant_id uuid not null references private.mcp_oauth_grants(id),
  actor_user_id uuid not null,
  company_id uuid not null,
  enabled boolean not null,
  claimed_at timestamptz,
  claim_token uuid,
  claim_expires_at timestamptz,
  attempt_count smallint not null default 0,
  retry_not_before timestamptz,
  last_failure_code text,
  schedule_revision bigint not null default 0,
  updated_at timestamptz not null default statement_timestamp()
);

create function private.user_is_active_company_member(
  p_user_id uuid,
  p_company_id uuid
) returns boolean
language sql stable security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
  select exists (
    select 1 from public.users user_record
    where user_record.id = p_user_id
      and user_record.company_id = p_company_id
      and user_record.is_active
  );
$function$;

create function public.has_permission(
  p_user_id uuid,
  p_permission text,
  p_scope text
) returns boolean
language sql stable security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
  select p_permission = 'settings.integrations' and p_scope = 'all';
$function$;

create function private.resolve_agent_actor_authority(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_requested_permissions text[]
) returns table (
  permission_snapshot_revision text,
  effective_permissions jsonb
)
language sql stable security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
  select
    'sha256:fixture',
    jsonb_build_array(
      jsonb_build_object('permission', 'calendar.view', 'scope', 'all'),
      jsonb_build_object('permission', 'email.view', 'scope', 'all'),
      jsonb_build_object('permission', 'invoices.view', 'scope', 'all'),
      jsonb_build_object('permission', 'pipeline.view', 'scope', 'all'),
      jsonb_build_object('permission', 'projects.view', 'scope', 'all'),
      jsonb_build_object('permission', 'reports.view', 'scope', 'all'),
      jsonb_build_object('permission', 'tasks.view', 'scope', 'all')
    );
$function$;

create function public.rotate_mcp_oauth_refresh_token_as_system(
  p_presented_hash text,
  p_client_id uuid,
  p_active_grantable_scopes text[],
  p_new_access_hash text,
  p_new_refresh_hash text,
  p_access_expires_at timestamptz,
  p_refresh_expires_at timestamptz
) returns table (
  grant_id uuid,
  client_id uuid,
  user_id uuid,
  company_id uuid,
  scopes text[],
  accepted_labels text[],
  consent_catalog_revision text,
  exposure_revision text,
  revision text,
  issuer text,
  audience text,
  reuse_detected boolean
)
language plpgsql volatile security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_token record;
begin
  select
    grant_record.id as grant_id,
    grant_record.client_id,
    grant_record.user_id,
    grant_record.company_id,
    grant_record.scopes,
    grant_record.accepted_labels,
    grant_record.consent_catalog_revision,
    grant_record.exposure_revision,
    grant_record.revision,
    token_record.family_id,
    token_record.issuer,
    token_record.audience
  into v_token
  from private.mcp_oauth_tokens token_record
  join private.mcp_oauth_grants grant_record
    on grant_record.id = token_record.grant_id
  where token_record.token_hash = p_presented_hash
    and token_record.kind = 'refresh'
    and grant_record.client_id = p_client_id
    and grant_record.scopes <@ p_active_grantable_scopes
    and token_record.used_at is null
    and token_record.revoked_at is null
    and grant_record.revoked_at is null;
  if not found then
    return;
  end if;

  update private.mcp_oauth_tokens
  set used_at = statement_timestamp(), rotated_to_hash = p_new_refresh_hash
  where token_hash = p_presented_hash;
  insert into private.mcp_oauth_tokens (
    token_hash, grant_id, family_id, kind, issuer, audience, expires_at
  ) values
    (
      p_new_access_hash, v_token.grant_id, v_token.family_id, 'access',
      v_token.issuer, v_token.audience, p_access_expires_at
    ),
    (
      p_new_refresh_hash, v_token.grant_id, v_token.family_id, 'refresh',
      v_token.issuer, v_token.audience, p_refresh_expires_at
    );

  return query select
    v_token.grant_id,
    v_token.client_id,
    v_token.user_id,
    v_token.company_id,
    v_token.scopes,
    v_token.accepted_labels,
    v_token.consent_catalog_revision,
    v_token.exposure_revision,
    v_token.revision,
    v_token.issuer,
    v_token.audience,
    false;
end;
$function$;

create function public.resolve_mcp_oauth_access_token_as_system(
  p_token_hash text
) returns table (
  grant_id uuid,
  client_id uuid,
  client_name text,
  user_id uuid,
  company_id uuid,
  scopes text[],
  accepted_labels text[],
  consent_catalog_revision text,
  exposure_revision text,
  revision text,
  issuer text,
  audience text,
  expires_at timestamptz,
  token_revoked boolean,
  grant_revoked boolean,
  client_disabled boolean
)
language sql volatile security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
  select
    null::uuid, null::uuid, null::text, null::uuid, null::uuid,
    null::text[], null::text[], null::text, null::text, null::text,
    null::text, null::text, null::timestamptz, null::boolean,
    null::boolean, null::boolean
  where false;
$function$;

create function public.list_agent_day_closeout_routine_configs_as_system(
  p_actor_user_id uuid,
  p_company_id uuid
) returns table (
  grant_id uuid,
  client_id uuid,
  client_name text,
  enabled boolean,
  local_time text,
  timezone text,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_failure_code text,
  schedule_revision bigint
)
language sql stable security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
  select
    null::uuid, null::uuid, null::text, null::boolean, null::text,
    null::text, null::timestamptz, null::timestamptz, null::timestamptz,
    null::text, null::bigint
  where false;
$function$;

create function private.assert_agent_day_closeout_authority(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_exposure_revision text
) returns text
language sql stable security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
  select 'sha256:fixture';
$function$;

\ir ../../supabase/migrations/20260831190000_mcp_v3_synthetic_canary.sql

insert into public.companies (id, name) values
  (
    'ca000000-0000-4000-8000-000000000001',
    'OPS MCP SYNTHETIC CANARY'
  ),
  (
    'ca000000-0000-4000-8000-000000000002',
    'OPS MCP SYNTHETIC CANARY'
  );

insert into public.users (id, company_id, is_active) values
  (
    'ca000000-0000-4000-8000-000000000011',
    'ca000000-0000-4000-8000-000000000001',
    true
  ),
  (
    'ca000000-0000-4000-8000-000000000012',
    'ca000000-0000-4000-8000-000000000002',
    true
  ),
  (
    'ca000000-0000-4000-8000-000000000013',
    'ca000000-0000-4000-8000-000000000001',
    false
  );

insert into private.mcp_oauth_clients (
  client_id,
  client_name,
  scope_ceiling,
  consent_catalog_revision,
  exposure_revision
) values
  (
    'ca000000-0000-4000-8000-000000000021',
    'Canary A',
    array[
      'ops.correspondence.read',
      'ops.financial_documents.read',
      'ops.jobs.read',
      'ops.operations.prepare',
      'ops.operations.read',
      'ops.schedule.read',
      'ops.tasks.read'
    ],
    '2026-08-30.mcp-consent-catalog.v2',
    '2026-08-30.mcp-exposure.v3'
  ),
  (
    'ca000000-0000-4000-8000-000000000022',
    'Canary B',
    array[
      'ops.correspondence.read',
      'ops.financial_documents.read',
      'ops.jobs.read',
      'ops.operations.prepare',
      'ops.operations.read',
      'ops.schedule.read',
      'ops.tasks.read'
    ],
    '2026-08-30.mcp-consent-catalog.v2',
    '2026-08-30.mcp-exposure.v3'
  ),
  (
    'ca000000-0000-4000-8000-000000000023',
    'Existing v2 host',
    array['ops.jobs.read'],
    '2026-08-30.mcp-consent-catalog.v2',
    '2026-08-29.mcp-exposure.v2'
  );

insert into private.mcp_oauth_grants (
  id, client_id, user_id, company_id, scopes, exposure_revision
) values (
  'ca000000-0000-4000-8000-000000000033',
  'ca000000-0000-4000-8000-000000000023',
  'ca000000-0000-4000-8000-000000000011',
  'ca000000-0000-4000-8000-000000000001',
  array['ops.jobs.read'],
  '2026-08-29.mcp-exposure.v2'
);

insert into private.mcp_oauth_tokens (token_hash, grant_id) values (
  repeat('f', 64),
  'ca000000-0000-4000-8000-000000000033'
);

create temporary table canary_test_values (
  expires_at timestamp with time zone not null
) on commit drop;

insert into canary_test_values (expires_at)
values (statement_timestamp() + interval '1 hour');

set local request.jwt.claim.role = 'service_role';

do $rolling_release_contract$
begin
  if (
    select count(*)
    from public.resolve_mcp_oauth_access_token_as_system(repeat('f', 64))
  ) <> 1 then
    raise exception 'legacy_v2_bearer_compatibility_failed';
  end if;
  if (
    select count(*)
    from public.resolve_mcp_oauth_access_token_as_system(
      repeat('f', 64),
      '2026-08-29.mcp-exposure.v2'
    )
  ) <> 1 then
    raise exception 'current_v2_bearer_compatibility_failed';
  end if;
end;
$rolling_release_contract$;

select *
from public.provision_mcp_oauth_canary_as_system(
  'ca000000-0000-4000-8000-000000000021',
  'ca000000-0000-4000-8000-000000000011',
  'ca000000-0000-4000-8000-000000000001',
  '2026-08-30.mcp-exposure.v3',
  '2026-08-30.mcp-consent-catalog.v2',
  (select expires_at from canary_test_values)
);

-- Identical provisioning is a one-row replay, never a second binding.
select *
from public.provision_mcp_oauth_canary_as_system(
  'ca000000-0000-4000-8000-000000000021',
  'ca000000-0000-4000-8000-000000000011',
  'ca000000-0000-4000-8000-000000000001',
  '2026-08-30.mcp-exposure.v3',
  '2026-08-30.mcp-consent-catalog.v2',
  (select expires_at from canary_test_values)
);

do $binding_contract$
begin
  if (
    select count(*)
    from private.mcp_oauth_canary_bindings
  ) <> 1 then
    raise exception 'canary_replay_duplicated_binding';
  end if;
  if (
    select count(*)
    from public.resolve_mcp_oauth_canary_as_system(
      'ca000000-0000-4000-8000-000000000021',
      'ca000000-0000-4000-8000-000000000011',
      'ca000000-0000-4000-8000-000000000001',
      '2026-08-30.mcp-exposure.v3',
      '2026-08-30.mcp-consent-catalog.v2'
    )
  ) <> 1 then
    raise exception 'exact_canary_did_not_resolve';
  end if;
  if exists (
    select 1
    from public.resolve_mcp_oauth_canary_as_system(
      'ca000000-0000-4000-8000-000000000021',
      'ca000000-0000-4000-8000-000000000012',
      'ca000000-0000-4000-8000-000000000002',
      '2026-08-30.mcp-exposure.v3',
      '2026-08-30.mcp-consent-catalog.v2'
    )
  ) then
    raise exception 'cross_tenant_canary_resolved';
  end if;
end;
$binding_contract$;

do $conflict_contract$
begin
  begin
    perform public.provision_mcp_oauth_canary_as_system(
      'ca000000-0000-4000-8000-000000000021',
      'ca000000-0000-4000-8000-000000000012',
      'ca000000-0000-4000-8000-000000000002',
      '2026-08-30.mcp-exposure.v3',
      '2026-08-30.mcp-consent-catalog.v2',
      statement_timestamp() + interval '1 hour'
    );
    raise exception 'conflicting_canary_was_accepted';
  exception
    when unique_violation then null;
  end;

  begin
    perform public.provision_mcp_oauth_canary_as_system(
      'ca000000-0000-4000-8000-000000000022',
      'ca000000-0000-4000-8000-000000000013',
      'ca000000-0000-4000-8000-000000000001',
      '2026-08-30.mcp-exposure.v3',
      '2026-08-30.mcp-consent-catalog.v2',
      statement_timestamp() + interval '1 hour'
    );
    raise exception 'inactive_subject_was_accepted';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.provision_mcp_oauth_canary_as_system(
      'ca000000-0000-4000-8000-000000000022',
      'ca000000-0000-4000-8000-000000000012',
      'ca000000-0000-4000-8000-000000000002',
      '2026-08-30.mcp-exposure.v3',
      '2026-08-30.mcp-consent-catalog.v2',
      statement_timestamp() + interval '25 hours'
    );
    raise exception 'unbounded_canary_expiry_was_accepted';
  exception
    when invalid_parameter_value then null;
  end;
end;
$conflict_contract$;

do $durable_write_gate$
begin
  begin
    insert into private.mcp_oauth_grants (
      id, client_id, user_id, company_id, exposure_revision
    ) values (
      'ca000000-0000-4000-8000-000000000032',
      'ca000000-0000-4000-8000-000000000022',
      'ca000000-0000-4000-8000-000000000012',
      'ca000000-0000-4000-8000-000000000002',
      '2026-08-30.mcp-exposure.v3'
    );
    raise exception 'unbound_v3_grant_was_persisted';
  exception
    when insufficient_privilege then null;
  end;
  if exists (
    select 1 from private.mcp_oauth_grants
    where id = 'ca000000-0000-4000-8000-000000000032'
  ) then
    raise exception 'rejected_v3_grant_survived_trigger';
  end if;
end;
$durable_write_gate$;

select *
from public.provision_mcp_oauth_canary_as_system(
  'ca000000-0000-4000-8000-000000000022',
  'ca000000-0000-4000-8000-000000000012',
  'ca000000-0000-4000-8000-000000000002',
  '2026-08-30.mcp-exposure.v3',
  '2026-08-30.mcp-consent-catalog.v2',
  (select expires_at from canary_test_values)
);

insert into private.mcp_oauth_grants (
  id, client_id, user_id, company_id, exposure_revision
) values (
  'ca000000-0000-4000-8000-000000000032',
  'ca000000-0000-4000-8000-000000000022',
  'ca000000-0000-4000-8000-000000000012',
  'ca000000-0000-4000-8000-000000000002',
  '2026-08-30.mcp-exposure.v3'
);

insert into private.mcp_oauth_tokens (
  token_hash, grant_id, family_id, kind
) values (
  repeat('b', 64),
  'ca000000-0000-4000-8000-000000000032',
  'ca000000-0000-4000-8000-000000000052',
  'refresh'
);

insert into private.agent_day_closeout_routines (
  id, oauth_client_id, oauth_grant_id, actor_user_id, company_id, enabled,
  claimed_at, claim_token, claim_expires_at, attempt_count, retry_not_before
) values (
  'ca000000-0000-4000-8000-000000000042',
  'ca000000-0000-4000-8000-000000000022',
  'ca000000-0000-4000-8000-000000000032',
  'ca000000-0000-4000-8000-000000000012',
  'ca000000-0000-4000-8000-000000000002',
  true,
  statement_timestamp(),
  'ca000000-0000-4000-8000-000000000098',
  statement_timestamp() + interval '5 minutes',
  1,
  statement_timestamp() + interval '1 minute'
);

update private.mcp_oauth_canary_bindings
set created_at = statement_timestamp() - interval '2 hours',
    expires_at = statement_timestamp() - interval '1 second'
where oauth_client_id = 'ca000000-0000-4000-8000-000000000022';

do $refresh_loss_contract$
begin
  if exists (
    select 1
    from public.rotate_mcp_oauth_refresh_token_as_system(
      repeat('b', 64),
      'ca000000-0000-4000-8000-000000000022',
      array['ops.jobs.read'],
      repeat('c', 64),
      repeat('d', 64),
      statement_timestamp() + interval '1 hour',
      statement_timestamp() + interval '2 hours'
    )
  ) then
    raise exception 'expired_canary_refresh_rotated';
  end if;
  if not exists (
    select 1 from private.mcp_oauth_grants
    where id = 'ca000000-0000-4000-8000-000000000032'
      and revoked_at is not null
  ) or not exists (
    select 1 from private.mcp_oauth_tokens
    where token_hash = repeat('b', 64)
      and revoked_at is not null
  ) or not exists (
    select 1 from private.agent_day_closeout_routines
    where id = 'ca000000-0000-4000-8000-000000000042'
      and not enabled
      and claim_token is null
      and last_failure_code = 'OAUTH_CANARY_UNAVAILABLE'
  ) then
    raise exception 'expired_canary_refresh_cleanup_incomplete';
  end if;
end;
$refresh_loss_contract$;

insert into private.mcp_oauth_grants (
  id, client_id, user_id, company_id, exposure_revision
) values (
  'ca000000-0000-4000-8000-000000000031',
  'ca000000-0000-4000-8000-000000000021',
  'ca000000-0000-4000-8000-000000000011',
  'ca000000-0000-4000-8000-000000000001',
  '2026-08-30.mcp-exposure.v3'
);

insert into private.mcp_oauth_tokens (token_hash, grant_id) values (
  repeat('a', 64),
  'ca000000-0000-4000-8000-000000000031'
);

insert into private.agent_day_closeout_routines (
  id, oauth_client_id, oauth_grant_id, actor_user_id, company_id, enabled,
  claimed_at, claim_token, claim_expires_at, attempt_count, retry_not_before
) values (
  'ca000000-0000-4000-8000-000000000041',
  'ca000000-0000-4000-8000-000000000021',
  'ca000000-0000-4000-8000-000000000031',
  'ca000000-0000-4000-8000-000000000011',
  'ca000000-0000-4000-8000-000000000001',
  true,
  statement_timestamp(),
  'ca000000-0000-4000-8000-000000000099',
  statement_timestamp() + interval '5 minutes',
  1,
  statement_timestamp() + interval '1 minute'
);

do $disable_contract$
begin
  if (
    select count(*)
    from public.resolve_mcp_oauth_access_token_as_system(
      repeat('a', 64),
      '2026-08-29.mcp-exposure.v2'
    )
  ) <> 1 then
    raise exception 'current_canary_bearer_did_not_resolve';
  end if;
  if exists (
    select 1
    from public.resolve_mcp_oauth_access_token_as_system(
      repeat('a', 64),
      '2026-08-30.mcp-exposure.v3'
    )
  ) then
    raise exception 'request_selected_active_exposure';
  end if;
  if exists (
    select 1
    from public.resolve_mcp_oauth_access_token_as_system(repeat('a', 64))
  ) then
    raise exception 'legacy_resolver_accepted_v3_canary';
  end if;
  if not public.disable_mcp_oauth_canary_as_system(
    'ca000000-0000-4000-8000-000000000021',
    'ca000000-0000-4000-8000-000000000011',
    'ca000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'canary_disable_not_acknowledged';
  end if;
  if exists (
    select 1
    from public.resolve_mcp_oauth_canary_as_system(
      'ca000000-0000-4000-8000-000000000021',
      'ca000000-0000-4000-8000-000000000011',
      'ca000000-0000-4000-8000-000000000001',
      '2026-08-30.mcp-exposure.v3',
      '2026-08-30.mcp-consent-catalog.v2'
    )
  ) then
    raise exception 'disabled_canary_still_resolved';
  end if;
  if exists (
    select 1
    from public.resolve_mcp_oauth_access_token_as_system(
      repeat('a', 64),
      '2026-08-29.mcp-exposure.v2'
    )
  ) then
    raise exception 'disabled_canary_bearer_still_resolved';
  end if;
  if not exists (
    select 1 from private.mcp_oauth_clients client
    where client.client_id = 'ca000000-0000-4000-8000-000000000021'
      and client.disabled_at is not null
  ) then
    raise exception 'canary_client_not_disabled';
  end if;
  if not exists (
    select 1
    from private.mcp_oauth_grants grant_record
    where grant_record.id = 'ca000000-0000-4000-8000-000000000031'
      and grant_record.revoked_at is not null
  ) or not exists (
    select 1
    from private.mcp_oauth_tokens token_record
    where token_record.token_hash = repeat('a', 64)
      and token_record.revoked_at is not null
  ) or not exists (
    select 1
    from private.agent_day_closeout_routines routine
    where routine.id = 'ca000000-0000-4000-8000-000000000041'
      and not routine.enabled
      and routine.claim_token is null
      and routine.attempt_count = 0
      and routine.last_failure_code = 'OAUTH_CANARY_DISABLED'
  ) then
    raise exception 'canary_disable_cleanup_incomplete';
  end if;
end;
$disable_contract$;

do $acl_contract$
declare
  v_signature text;
begin
  if not exists (
    select 1 from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = 'mcp_oauth_canary_bindings'
      and relation.relrowsecurity
  ) then
    raise exception 'canary_rls_not_enabled';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'private'
      and tablename = 'mcp_oauth_canary_bindings'
  ) then
    raise exception 'canary_policy_unexpected';
  end if;
  if has_table_privilege(
    'service_role',
    'private.mcp_oauth_canary_bindings',
    'select,insert,update,delete'
  ) then
    raise exception 'canary_table_grant_leaked';
  end if;
  if not has_function_privilege(
       'service_role',
       'public.resolve_mcp_oauth_access_token_as_system(text)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.resolve_mcp_oauth_access_token_as_system(text)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.resolve_mcp_oauth_access_token_as_system(text)',
       'execute'
     ) then
    raise exception 'legacy_bearer_resolver_acl_mismatch';
  end if;

  foreach v_signature in array array[
    'public.provision_mcp_oauth_canary_as_system(uuid,uuid,uuid,text,text,timestamp with time zone)',
    'public.resolve_mcp_oauth_canary_as_system(uuid,uuid,uuid,text,text)',
    'public.disable_mcp_oauth_canary_as_system(uuid,uuid,uuid)'
  ] loop
    if not has_function_privilege('service_role', v_signature, 'execute')
       or has_function_privilege('authenticated', v_signature, 'execute')
       or has_function_privilege('anon', v_signature, 'execute') then
      raise exception 'canary_function_acl_mismatch: %', v_signature;
    end if;
  end loop;
end;
$acl_contract$;

rollback;
