-- DAY-CLOSEOUT ROUTINE CONFIGURATION — BEHAVIOR CONTRACT
--
-- ISOLATED DATABASE ONLY. The fixture supplies the already-proven Foundation
-- Zero authority primitives, applies the forward configuration migration, and
-- exercises actor/company/grant binding, idempotency, lease invalidation, and
-- both OAuth revocation paths. Every object and mutation is rolled back.

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
returns text
language sql
stable
as $function$
  select nullif(current_setting('request.jwt.claim.role', true), '');
$function$;

create table public.companies (
  id uuid primary key,
  timezone text not null,
  deleted_at timestamptz
);

create table private.fixture_actor_authority (
  actor_user_id uuid not null,
  company_id uuid not null,
  settings_integrations_all boolean not null,
  closeout_all boolean not null,
  primary key (actor_user_id, company_id)
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
  scopes text[] not null,
  consent_catalog_revision text not null,
  exposure_revision text not null,
  revision text not null,
  revoked_at timestamptz
);

create table private.mcp_oauth_tokens (
  token_hash text primary key,
  grant_id uuid not null references private.mcp_oauth_grants(id),
  revoked_at timestamptz
);

create table private.agent_day_closeout_routines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  actor_user_id uuid not null,
  oauth_grant_id uuid not null references private.mcp_oauth_grants(id),
  oauth_client_id uuid not null references private.mcp_oauth_clients(client_id),
  grant_revision text not null,
  granted_scope_ceiling text[] not null,
  permission_snapshot_revision text not null,
  capability_manifest_revision text not null,
  exposure_revision text not null,
  local_time time not null,
  timezone text not null,
  weekdays smallint[] not null,
  enabled boolean not null default false,
  next_run_at timestamptz not null,
  claimed_at timestamptz,
  claim_token uuid,
  claim_expires_at timestamptz,
  attempt_count smallint not null default 0,
  retry_not_before timestamptz,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_failure_code text,
  change_cursor jsonb not null default '{}'::jsonb,
  schedule_revision bigint not null default 0,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (company_id, actor_user_id, oauth_client_id)
);

revoke all on table private.mcp_oauth_clients
  from public, anon, authenticated, service_role;
revoke all on table private.mcp_oauth_grants
  from public, anon, authenticated, service_role;
revoke all on table private.mcp_oauth_tokens
  from public, anon, authenticated, service_role;
revoke all on table private.agent_day_closeout_routines
  from public, anon, authenticated, service_role;

create function public.has_permission(
  p_user_id uuid,
  p_permission text,
  p_required_scope text
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
  select exists (
    select 1
    from private.fixture_actor_authority authority
    where authority.actor_user_id = p_user_id
      and p_permission = 'settings.integrations'
      and p_required_scope = 'all'
      and authority.settings_integrations_all
  );
$function$;

create function private.resolve_agent_actor_authority(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_registered_permission_keys text[]
) returns table (
  actor_user_id uuid,
  company_id uuid,
  is_active boolean,
  is_admin boolean,
  role_ids uuid[],
  configured_permissions text[],
  effective_permissions jsonb,
  permission_snapshot_revision text
)
language sql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
  select
    authority.actor_user_id,
    authority.company_id,
    true,
    true,
    array[]::uuid[],
    p_registered_permission_keys,
    case when authority.closeout_all then jsonb_build_array(
      jsonb_build_object('permission', 'calendar.view', 'scope', 'all'),
      jsonb_build_object('permission', 'email.view', 'scope', 'all'),
      jsonb_build_object('permission', 'invoices.view', 'scope', 'all'),
      jsonb_build_object('permission', 'pipeline.view', 'scope', 'all'),
      jsonb_build_object('permission', 'projects.view', 'scope', 'all'),
      jsonb_build_object('permission', 'reports.view', 'scope', 'all'),
      jsonb_build_object('permission', 'tasks.view', 'scope', 'all')
    ) else '[]'::jsonb end,
    'fixture-permission-revision'
  from private.fixture_actor_authority authority
  where authority.actor_user_id = p_actor_user_id
    and authority.company_id = p_company_id;
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
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if not exists (
    select 1
    from private.fixture_actor_authority authority
    where authority.actor_user_id = p_actor_user_id
      and authority.company_id = p_company_id
      and authority.closeout_all
  ) then
    raise exception 'authority_denied' using errcode = '42501';
  end if;
  return 'fixture-permission-revision';
end;
$function$;

create function private.next_agent_day_closeout_run(
  p_local_time time,
  p_timezone text,
  p_weekdays smallint[],
  p_after timestamptz
) returns timestamptz
language sql
stable
strict
as $function$
  select p_after + interval '1 day';
$function$;

create function public.revoke_mcp_oauth_grant_as_system(uuid, uuid)
returns boolean language sql as 'select false';
create function public.revoke_mcp_oauth_token_as_system(text)
returns boolean language sql as 'select false';

\ir ../../supabase/migrations/20260831120000_agent_day_closeout_routine_configuration.sql

insert into public.companies (id, timezone) values
  ('dc000000-0000-4000-8000-000000000001', 'America/Vancouver'),
  ('dc000000-0000-4000-8000-000000000002', 'America/Toronto');

insert into private.fixture_actor_authority values
  (
    'dc000000-0000-4000-8000-000000000011',
    'dc000000-0000-4000-8000-000000000001',
    true,
    true
  ),
  (
    'dc000000-0000-4000-8000-000000000012',
    'dc000000-0000-4000-8000-000000000002',
    true,
    true
  );

insert into private.mcp_oauth_clients (
  client_id, client_name, scope_ceiling,
  consent_catalog_revision, exposure_revision
) values
  (
    'dc000000-0000-4000-8000-000000000021',
    'Claude closeout A',
    array[
      'ops.correspondence.read', 'ops.financial_documents.read',
      'ops.jobs.read', 'ops.operations.prepare', 'ops.operations.read',
      'ops.schedule.read', 'ops.tasks.read'
    ],
    '2026-08-30.mcp-consent-catalog.v2',
    '2026-08-30.mcp-exposure.v3'
  ),
  (
    'dc000000-0000-4000-8000-000000000022',
    'Claude closeout B',
    array[
      'ops.correspondence.read', 'ops.financial_documents.read',
      'ops.jobs.read', 'ops.operations.prepare', 'ops.operations.read',
      'ops.schedule.read', 'ops.tasks.read'
    ],
    '2026-08-30.mcp-consent-catalog.v2',
    '2026-08-30.mcp-exposure.v3'
  ),
  (
    'dc000000-0000-4000-8000-000000000023',
    'Incomplete closeout grant',
    array['ops.jobs.read'],
    '2026-08-30.mcp-consent-catalog.v2',
    '2026-08-30.mcp-exposure.v3'
  );

insert into private.mcp_oauth_grants (
  id, client_id, user_id, company_id, scopes,
  consent_catalog_revision, exposure_revision, revision
) select
  'dc000000-0000-4000-8000-000000000031'::uuid,
  client.client_id,
  'dc000000-0000-4000-8000-000000000011'::uuid,
  'dc000000-0000-4000-8000-000000000001'::uuid,
  client.scope_ceiling,
  client.consent_catalog_revision,
  client.exposure_revision,
  '11111111111111111111111111111111'
from private.mcp_oauth_clients client
where client.client_id = 'dc000000-0000-4000-8000-000000000021'
union all
select
  'dc000000-0000-4000-8000-000000000032'::uuid,
  client.client_id,
  'dc000000-0000-4000-8000-000000000012'::uuid,
  'dc000000-0000-4000-8000-000000000002'::uuid,
  client.scope_ceiling,
  client.consent_catalog_revision,
  client.exposure_revision,
  '22222222222222222222222222222222'
from private.mcp_oauth_clients client
where client.client_id = 'dc000000-0000-4000-8000-000000000022'
union all
select
  'dc000000-0000-4000-8000-000000000033'::uuid,
  client.client_id,
  'dc000000-0000-4000-8000-000000000011'::uuid,
  'dc000000-0000-4000-8000-000000000001'::uuid,
  client.scope_ceiling,
  client.consent_catalog_revision,
  client.exposure_revision,
  '33333333333333333333333333333333'
from private.mcp_oauth_clients client
where client.client_id = 'dc000000-0000-4000-8000-000000000023';

set local request.jwt.claim.role = 'service_role';

do $list_contract$
begin
  if (
    select count(*)
    from public.list_agent_day_closeout_routine_configs_as_system(
      'dc000000-0000-4000-8000-000000000011',
      'dc000000-0000-4000-8000-000000000001'
    )
  ) <> 1 then
    raise exception 'eligible_grant_list_mismatch';
  end if;
  if exists (
    select 1
    from public.list_agent_day_closeout_routine_configs_as_system(
      'dc000000-0000-4000-8000-000000000011',
      'dc000000-0000-4000-8000-000000000002'
    )
  ) then
    raise exception 'cross_tenant_grant_visible';
  end if;
end;
$list_contract$;

create temporary table first_config on commit drop as
select *
from public.upsert_agent_day_closeout_routine_config_as_system(
  'dc000000-0000-4000-8000-000000000011',
  'dc000000-0000-4000-8000-000000000001',
  'dc000000-0000-4000-8000-000000000031',
  true,
  time '20:30'
);

do $created_contract$
begin
  if not exists (
    select 1
    from first_config config
    where config.enabled
      and config.local_time = '20:30'
      and config.timezone = 'America/Vancouver'
      and config.schedule_revision = 0
  ) or not exists (
    select 1
    from private.agent_day_closeout_routines routine
    where routine.actor_user_id =
        'dc000000-0000-4000-8000-000000000011'
      and routine.company_id =
        'dc000000-0000-4000-8000-000000000001'
      and routine.weekdays = array[1,2,3,4,5,6,7]::smallint[]
      and routine.permission_snapshot_revision =
        'fixture-permission-revision'
  ) then
    raise exception 'routine_create_contract_mismatch';
  end if;
end;
$created_contract$;

create temporary table replay_config on commit drop as
select *
from public.upsert_agent_day_closeout_routine_config_as_system(
  'dc000000-0000-4000-8000-000000000011',
  'dc000000-0000-4000-8000-000000000001',
  'dc000000-0000-4000-8000-000000000031',
  true,
  time '20:30'
);

do $idempotency_contract$
begin
  if (select schedule_revision from replay_config) is distinct from 0
     or (select next_run_at from replay_config) is distinct from
        (select next_run_at from first_config) then
    raise exception 'identical_config_was_not_idempotent';
  end if;
end;
$idempotency_contract$;

update private.agent_day_closeout_routines
set claimed_at = statement_timestamp(),
    claim_token = 'dc000000-0000-4000-8000-000000000099',
    claim_expires_at = statement_timestamp() + interval '5 minutes',
    attempt_count = 2,
    retry_not_before = statement_timestamp() + interval '1 minute';

create temporary table changed_config on commit drop as
select *
from public.upsert_agent_day_closeout_routine_config_as_system(
  'dc000000-0000-4000-8000-000000000011',
  'dc000000-0000-4000-8000-000000000001',
  'dc000000-0000-4000-8000-000000000031',
  true,
  time '21:00'
);

do $change_contract$
begin
  if (select schedule_revision from changed_config) is distinct from 1
     or exists (
       select 1
       from private.agent_day_closeout_routines routine
       where routine.claim_token is not null
          or routine.claimed_at is not null
          or routine.claim_expires_at is not null
          or routine.retry_not_before is not null
          or routine.attempt_count <> 0
     ) then
    raise exception 'schedule_change_did_not_invalidate_lease';
  end if;
end;
$change_contract$;

-- Losing one of the routine read permissions must block any re-enable while
-- preserving the current operator's ability to see and stop an existing
-- schedule immediately.
update private.fixture_actor_authority
set closeout_all = false
where actor_user_id = 'dc000000-0000-4000-8000-000000000011';

do $authority_loss_visibility_contract$
begin
  if (
    select count(*)
    from public.list_agent_day_closeout_routine_configs_as_system(
      'dc000000-0000-4000-8000-000000000011',
      'dc000000-0000-4000-8000-000000000001'
    )
  ) <> 1 then
    raise exception 'existing_routine_hidden_after_authority_loss';
  end if;
end;
$authority_loss_visibility_contract$;

select *
from public.upsert_agent_day_closeout_routine_config_as_system(
  'dc000000-0000-4000-8000-000000000011',
  'dc000000-0000-4000-8000-000000000001',
  'dc000000-0000-4000-8000-000000000031',
  false,
  time '21:00'
);

do $authority_loss_disable_contract$
begin
  if exists (
    select 1
    from private.agent_day_closeout_routines routine
    where routine.actor_user_id =
        'dc000000-0000-4000-8000-000000000011'
      and routine.company_id =
        'dc000000-0000-4000-8000-000000000001'
      and routine.enabled
  ) then
    raise exception 'existing_routine_could_not_be_disabled_after_authority_loss';
  end if;

  begin
    perform public.upsert_agent_day_closeout_routine_config_as_system(
      'dc000000-0000-4000-8000-000000000011',
      'dc000000-0000-4000-8000-000000000001',
      'dc000000-0000-4000-8000-000000000031',
      true,
      time '21:00'
    );
    raise exception 'routine_reenabled_without_closeout_authority';
  exception when insufficient_privilege then null;
  end;
end;
$authority_loss_disable_contract$;

update private.fixture_actor_authority
set closeout_all = true
where actor_user_id = 'dc000000-0000-4000-8000-000000000011';

select *
from public.upsert_agent_day_closeout_routine_config_as_system(
  'dc000000-0000-4000-8000-000000000011',
  'dc000000-0000-4000-8000-000000000001',
  'dc000000-0000-4000-8000-000000000031',
  true,
  time '21:00'
);

do $wrong_actor_and_scope_contract$
begin
  begin
    perform public.upsert_agent_day_closeout_routine_config_as_system(
      'dc000000-0000-4000-8000-000000000012',
      'dc000000-0000-4000-8000-000000000002',
      'dc000000-0000-4000-8000-000000000031',
      true,
      time '20:00'
    );
    raise exception 'wrong_actor_grant_accepted';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.upsert_agent_day_closeout_routine_config_as_system(
      'dc000000-0000-4000-8000-000000000011',
      'dc000000-0000-4000-8000-000000000001',
      'dc000000-0000-4000-8000-000000000033',
      true,
      time '20:00'
    );
    raise exception 'incomplete_scope_grant_accepted';
  exception when insufficient_privilege then null;
  end;
end;
$wrong_actor_and_scope_contract$;

do $grant_revoke_contract$
begin
  if not public.revoke_mcp_oauth_grant_as_system(
    'dc000000-0000-4000-8000-000000000031',
    'dc000000-0000-4000-8000-000000000011'
  ) then
    raise exception 'owned_grant_not_revoked';
  end if;
  if exists (
    select 1
    from private.agent_day_closeout_routines routine
    where routine.oauth_grant_id =
        'dc000000-0000-4000-8000-000000000031'
      and (
        routine.enabled
        or routine.last_failure_code is distinct from 'OAUTH_GRANT_REVOKED'
      )
  ) then
    raise exception 'grant_revoke_did_not_disable_routine';
  end if;
end;
$grant_revoke_contract$;

-- Reconnect the same client with a fresh grant and prove token revocation has
-- the identical immediate stop behavior.
insert into private.mcp_oauth_grants (
  id, client_id, user_id, company_id, scopes,
  consent_catalog_revision, exposure_revision, revision
) select
  'dc000000-0000-4000-8000-000000000034'::uuid,
  client.client_id,
  'dc000000-0000-4000-8000-000000000011'::uuid,
  'dc000000-0000-4000-8000-000000000001'::uuid,
  client.scope_ceiling,
  client.consent_catalog_revision,
  client.exposure_revision,
  '44444444444444444444444444444444'
from private.mcp_oauth_clients client
where client.client_id = 'dc000000-0000-4000-8000-000000000021';

insert into private.mcp_oauth_tokens (token_hash, grant_id)
values (
  repeat('a', 64),
  'dc000000-0000-4000-8000-000000000034'
);

select *
from public.upsert_agent_day_closeout_routine_config_as_system(
  'dc000000-0000-4000-8000-000000000011',
  'dc000000-0000-4000-8000-000000000001',
  'dc000000-0000-4000-8000-000000000034',
  true,
  time '21:00'
);

do $reconnect_contract$
begin
  if not exists (
    select 1
    from private.agent_day_closeout_routines routine
    where routine.oauth_grant_id =
        'dc000000-0000-4000-8000-000000000034'
      and routine.enabled
      and routine.last_failure_code is null
  ) then
    raise exception 'reconnect_did_not_clear_revocation_state';
  end if;
end;
$reconnect_contract$;

do $token_revoke_contract$
begin
  perform public.revoke_mcp_oauth_token_as_system(repeat('a', 64));
  if exists (
    select 1
    from private.agent_day_closeout_routines routine
    where routine.oauth_grant_id =
        'dc000000-0000-4000-8000-000000000034'
      and routine.enabled
  ) then
    raise exception 'token_revoke_did_not_disable_routine';
  end if;
end;
$token_revoke_contract$;

do $permission_and_acl_contract$
declare
  v_signature text;
begin
  update private.fixture_actor_authority
  set settings_integrations_all = false
  where actor_user_id = 'dc000000-0000-4000-8000-000000000011';
  begin
    perform public.list_agent_day_closeout_routine_configs_as_system(
      'dc000000-0000-4000-8000-000000000011',
      'dc000000-0000-4000-8000-000000000001'
    );
    raise exception 'settings_permission_revoke_ignored';
  exception when insufficient_privilege then null;
  end;

  foreach v_signature in array array[
    'public.list_agent_day_closeout_routine_configs_as_system(uuid,uuid)',
    'public.upsert_agent_day_closeout_routine_config_as_system(uuid,uuid,uuid,boolean,time without time zone)'
  ] loop
    if not has_function_privilege('service_role', v_signature, 'execute')
       or has_function_privilege('anon', v_signature, 'execute')
       or has_function_privilege('authenticated', v_signature, 'execute') then
      raise exception 'routine_config_rpc_acl_mismatch:%', v_signature;
    end if;
  end loop;
end;
$permission_and_acl_contract$;

rollback;
