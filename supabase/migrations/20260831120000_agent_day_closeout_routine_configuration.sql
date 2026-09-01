-- Operator-owned configuration for the dormant day-closeout routine.
--
-- This migration does not activate MCP v3, create a routine, enable the
-- worker, or register customer authority. It adds only service-role RPCs over
-- the existing private routine table and makes OAuth revocation stop a bound
-- routine in the same transaction.

do $prerequisites$
begin
  if pg_catalog.to_regclass('private.agent_day_closeout_routines') is null
     or pg_catalog.to_regclass('private.mcp_oauth_grants') is null
     or pg_catalog.to_regclass('private.mcp_oauth_clients') is null
     or pg_catalog.to_regprocedure(
       'private.assert_agent_day_closeout_authority(uuid,uuid,uuid,uuid,text,text[],text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.next_agent_day_closeout_run(time without time zone,text,smallint[],timestamp with time zone)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.has_permission(uuid,text,text)'
     ) is null then
    raise exception 'agent_day_closeout_routine_configuration_prerequisite_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create or replace function public.list_agent_day_closeout_routine_configs_as_system(
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
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  v_required_permissions constant jsonb := jsonb_build_array(
    jsonb_build_object('permission', 'calendar.view', 'scope', 'all'),
    jsonb_build_object('permission', 'email.view', 'scope', 'all'),
    jsonb_build_object('permission', 'invoices.view', 'scope', 'all'),
    jsonb_build_object('permission', 'pipeline.view', 'scope', 'all'),
    jsonb_build_object('permission', 'projects.view', 'scope', 'all'),
    jsonb_build_object('permission', 'reports.view', 'scope', 'all'),
    jsonb_build_object('permission', 'tasks.view', 'scope', 'all')
  );
  v_required_scopes constant text[] := array[
    'ops.correspondence.read',
    'ops.financial_documents.read',
    'ops.jobs.read',
    'ops.operations.prepare',
    'ops.operations.read',
    'ops.schedule.read',
    'ops.tasks.read'
  ];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if not public.has_permission(
    p_actor_user_id,
    'settings.integrations',
    'all'
  ) then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  return query
  with current_authority as materialized (
    select authority.effective_permissions
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      array[
        'calendar.view', 'email.view', 'invoices.view', 'pipeline.view',
        'projects.view', 'reports.view', 'tasks.view'
      ]
    ) authority
    where authority.effective_permissions @> v_required_permissions
  ), eligible_grants as materialized (
    select
      grant_record.id,
      grant_record.client_id,
      client_record.client_name
    from private.mcp_oauth_grants grant_record
    join private.mcp_oauth_clients client_record
      on client_record.client_id = grant_record.client_id
     and client_record.disabled_at is null
     and grant_record.scopes = client_record.scope_ceiling
     and grant_record.consent_catalog_revision =
       client_record.consent_catalog_revision
     and grant_record.exposure_revision = client_record.exposure_revision
    where grant_record.user_id = p_actor_user_id
      and grant_record.company_id = p_company_id
      and grant_record.revoked_at is null
      and grant_record.exposure_revision = '2026-08-30.mcp-exposure.v3'
      and v_required_scopes <@ grant_record.scopes
      and grant_record.scopes <@ v_required_scopes
      and (
        exists (select 1 from current_authority)
        or exists (
          select 1
          from private.agent_day_closeout_routines existing_routine
          where existing_routine.company_id = p_company_id
            and existing_routine.actor_user_id = p_actor_user_id
            and existing_routine.oauth_client_id = grant_record.client_id
        )
      )
  )
  select
    eligible.id,
    eligible.client_id,
    eligible.client_name,
    coalesce(routine.enabled, false),
    to_char(coalesce(routine.local_time, time '20:00'), 'HH24:MI'),
    company.timezone,
    routine.next_run_at,
    routine.last_run_at,
    routine.last_success_at,
    routine.last_failure_code,
    coalesce(routine.schedule_revision, 0)
  from eligible_grants eligible
  join public.companies company
    on company.id = p_company_id
   and company.deleted_at is null
  left join private.agent_day_closeout_routines routine
    on routine.company_id = p_company_id
   and routine.actor_user_id = p_actor_user_id
   and routine.oauth_client_id = eligible.client_id
  where company.timezone is not null
    and exists (
      select 1
      from pg_catalog.pg_timezone_names timezone_row
      where timezone_row.name = company.timezone
    )
  order by eligible.client_name, eligible.id;
end;
$function$;

revoke all on function public.list_agent_day_closeout_routine_configs_as_system(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_agent_day_closeout_routine_configs_as_system(uuid, uuid)
  to service_role;

create or replace function public.upsert_agent_day_closeout_routine_config_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_enabled boolean,
  p_local_time time
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
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  grant_record private.mcp_oauth_grants%rowtype;
  client_record private.mcp_oauth_clients%rowtype;
  existing_routine private.agent_day_closeout_routines%rowtype;
  v_has_existing_routine boolean := false;
  v_permission_snapshot_revision text;
  v_timezone text;
  v_next_run_at timestamptz;
  v_weekdays constant smallint[] := array[1,2,3,4,5,6,7]::smallint[];
  v_required_scopes constant text[] := array[
    'ops.correspondence.read',
    'ops.financial_documents.read',
    'ops.jobs.read',
    'ops.operations.prepare',
    'ops.operations.read',
    'ops.schedule.read',
    'ops.tasks.read'
  ];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_enabled is null or p_local_time is null then
    raise exception 'agent_day_closeout_routine_config_invalid'
      using errcode = '22023';
  end if;
  if not public.has_permission(
    p_actor_user_id,
    'settings.integrations',
    'all'
  ) then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  select grant_source.*
  into grant_record
  from private.mcp_oauth_grants grant_source
  join private.mcp_oauth_clients client_source
    on client_source.client_id = grant_source.client_id
   and client_source.disabled_at is null
   and grant_source.scopes = client_source.scope_ceiling
   and grant_source.consent_catalog_revision =
     client_source.consent_catalog_revision
   and grant_source.exposure_revision = client_source.exposure_revision
  where grant_source.id = p_oauth_grant_id
    and grant_source.user_id = p_actor_user_id
    and grant_source.company_id = p_company_id
    and grant_source.revoked_at is null
    and grant_source.exposure_revision = '2026-08-30.mcp-exposure.v3'
    and v_required_scopes <@ grant_source.scopes
    and grant_source.scopes <@ v_required_scopes;
  if not found then
    raise exception 'agent_day_closeout_routine_grant_denied'
      using errcode = '42501';
  end if;

  select client_source.*
  into strict client_record
  from private.mcp_oauth_clients client_source
  where client_source.client_id = grant_record.client_id
    and client_source.disabled_at is null
    and client_source.scope_ceiling = grant_record.scopes
    and client_source.consent_catalog_revision =
      grant_record.consent_catalog_revision
    and client_source.exposure_revision = grant_record.exposure_revision;

  select routine_source.*
  into existing_routine
  from private.agent_day_closeout_routines routine_source
  where routine_source.company_id = p_company_id
    and routine_source.actor_user_id = p_actor_user_id
    and routine_source.oauth_client_id = client_record.client_id
  for update;
  v_has_existing_routine := found;

  if p_enabled or not v_has_existing_routine then
    v_permission_snapshot_revision :=
      private.assert_agent_day_closeout_authority(
        p_actor_user_id,
        p_company_id,
        grant_record.id,
        client_record.client_id,
        grant_record.revision,
        grant_record.scopes,
        null,
        grant_record.exposure_revision
      );
  else
    -- Disabling an existing operator-owned routine is always lower risk than
    -- leaving it scheduled. Preserve its last authority snapshot while the
    -- exact current actor/company/grant binding is revalidated above.
    v_permission_snapshot_revision :=
      existing_routine.permission_snapshot_revision;
  end if;

  select company.timezone into v_timezone
  from public.companies company
  where company.id = p_company_id
    and company.deleted_at is null;
  if v_timezone is null or not exists (
    select 1
    from pg_catalog.pg_timezone_names timezone_row
    where timezone_row.name = v_timezone
  ) then
    raise exception 'agent_day_closeout_routine_timezone_unavailable'
      using errcode = '55000';
  end if;

  v_next_run_at := private.next_agent_day_closeout_run(
    p_local_time,
    v_timezone,
    v_weekdays,
    statement_timestamp()
  );

  insert into private.agent_day_closeout_routines as routine (
    company_id,
    actor_user_id,
    oauth_grant_id,
    oauth_client_id,
    grant_revision,
    granted_scope_ceiling,
    permission_snapshot_revision,
    capability_manifest_revision,
    exposure_revision,
    local_time,
    timezone,
    weekdays,
    enabled,
    next_run_at
  ) values (
    p_company_id,
    p_actor_user_id,
    grant_record.id,
    client_record.client_id,
    grant_record.revision,
    grant_record.scopes,
    v_permission_snapshot_revision,
    '2026-08-30.capability-manifest.v9',
    '2026-08-30.mcp-exposure.v3',
    p_local_time,
    v_timezone,
    v_weekdays,
    p_enabled,
    v_next_run_at
  )
  on conflict (company_id, actor_user_id, oauth_client_id)
  do update set
    oauth_grant_id = excluded.oauth_grant_id,
    grant_revision = excluded.grant_revision,
    granted_scope_ceiling = excluded.granted_scope_ceiling,
    permission_snapshot_revision = excluded.permission_snapshot_revision,
    capability_manifest_revision = excluded.capability_manifest_revision,
    exposure_revision = excluded.exposure_revision,
    local_time = excluded.local_time,
    timezone = excluded.timezone,
    weekdays = excluded.weekdays,
    enabled = excluded.enabled,
    next_run_at = case
      when routine.enabled is not distinct from p_enabled
       and routine.local_time is not distinct from p_local_time
       and routine.timezone is not distinct from v_timezone
       and routine.weekdays is not distinct from v_weekdays
       and routine.oauth_grant_id is not distinct from grant_record.id
       and routine.grant_revision is not distinct from grant_record.revision
       and routine.granted_scope_ceiling is not distinct from grant_record.scopes
       and routine.permission_snapshot_revision is not distinct from
         v_permission_snapshot_revision
      then routine.next_run_at
      else v_next_run_at
    end,
    schedule_revision = case
      when routine.enabled is not distinct from p_enabled
       and routine.local_time is not distinct from p_local_time
       and routine.timezone is not distinct from v_timezone
       and routine.weekdays is not distinct from v_weekdays
       and routine.oauth_grant_id is not distinct from grant_record.id
       and routine.grant_revision is not distinct from grant_record.revision
       and routine.granted_scope_ceiling is not distinct from grant_record.scopes
       and routine.permission_snapshot_revision is not distinct from
         v_permission_snapshot_revision
      then routine.schedule_revision
      else case
        when routine.schedule_revision = 9007199254740991 then 0
        else routine.schedule_revision + 1
      end
    end,
    claimed_at = case
      when routine.enabled is not distinct from p_enabled
       and routine.local_time is not distinct from p_local_time
       and routine.timezone is not distinct from v_timezone
       and routine.weekdays is not distinct from v_weekdays
       and routine.oauth_grant_id is not distinct from grant_record.id
       and routine.grant_revision is not distinct from grant_record.revision
       and routine.granted_scope_ceiling is not distinct from grant_record.scopes
       and routine.permission_snapshot_revision is not distinct from
         v_permission_snapshot_revision
      then routine.claimed_at
      else null
    end,
    claim_token = case
      when routine.enabled is not distinct from p_enabled
       and routine.local_time is not distinct from p_local_time
       and routine.timezone is not distinct from v_timezone
       and routine.weekdays is not distinct from v_weekdays
       and routine.oauth_grant_id is not distinct from grant_record.id
       and routine.grant_revision is not distinct from grant_record.revision
       and routine.granted_scope_ceiling is not distinct from grant_record.scopes
       and routine.permission_snapshot_revision is not distinct from
         v_permission_snapshot_revision
      then routine.claim_token
      else null
    end,
    claim_expires_at = case
      when routine.enabled is not distinct from p_enabled
       and routine.local_time is not distinct from p_local_time
       and routine.timezone is not distinct from v_timezone
       and routine.weekdays is not distinct from v_weekdays
       and routine.oauth_grant_id is not distinct from grant_record.id
       and routine.grant_revision is not distinct from grant_record.revision
       and routine.granted_scope_ceiling is not distinct from grant_record.scopes
       and routine.permission_snapshot_revision is not distinct from
         v_permission_snapshot_revision
      then routine.claim_expires_at
      else null
    end,
    attempt_count = case
      when routine.enabled is not distinct from p_enabled
       and routine.local_time is not distinct from p_local_time
       and routine.timezone is not distinct from v_timezone
       and routine.weekdays is not distinct from v_weekdays
       and routine.oauth_grant_id is not distinct from grant_record.id
       and routine.grant_revision is not distinct from grant_record.revision
       and routine.granted_scope_ceiling is not distinct from grant_record.scopes
       and routine.permission_snapshot_revision is not distinct from
         v_permission_snapshot_revision
      then routine.attempt_count
      else 0
    end,
    retry_not_before = case
      when routine.enabled is not distinct from p_enabled
       and routine.local_time is not distinct from p_local_time
       and routine.timezone is not distinct from v_timezone
       and routine.weekdays is not distinct from v_weekdays
       and routine.oauth_grant_id is not distinct from grant_record.id
       and routine.grant_revision is not distinct from grant_record.revision
       and routine.granted_scope_ceiling is not distinct from grant_record.scopes
       and routine.permission_snapshot_revision is not distinct from
         v_permission_snapshot_revision
      then routine.retry_not_before
      else null
    end,
    last_failure_code = case
      when routine.enabled is not distinct from p_enabled
       and routine.local_time is not distinct from p_local_time
       and routine.timezone is not distinct from v_timezone
       and routine.weekdays is not distinct from v_weekdays
       and routine.oauth_grant_id is not distinct from grant_record.id
       and routine.grant_revision is not distinct from grant_record.revision
       and routine.granted_scope_ceiling is not distinct from grant_record.scopes
       and routine.permission_snapshot_revision is not distinct from
         v_permission_snapshot_revision
      then routine.last_failure_code
      when routine.last_failure_code = 'OAUTH_GRANT_REVOKED' then null
      else routine.last_failure_code
    end,
    updated_at = case
      when routine.enabled is not distinct from p_enabled
       and routine.local_time is not distinct from p_local_time
       and routine.timezone is not distinct from v_timezone
       and routine.weekdays is not distinct from v_weekdays
       and routine.oauth_grant_id is not distinct from grant_record.id
       and routine.grant_revision is not distinct from grant_record.revision
       and routine.granted_scope_ceiling is not distinct from grant_record.scopes
       and routine.permission_snapshot_revision is not distinct from
         v_permission_snapshot_revision
      then routine.updated_at
      else statement_timestamp()
    end;

  return query
  select
    routine.oauth_grant_id,
    routine.oauth_client_id,
    client_record.client_name,
    routine.enabled,
    to_char(routine.local_time, 'HH24:MI'),
    routine.timezone,
    routine.next_run_at,
    routine.last_run_at,
    routine.last_success_at,
    routine.last_failure_code,
    routine.schedule_revision
  from private.agent_day_closeout_routines routine
  where routine.company_id = p_company_id
    and routine.actor_user_id = p_actor_user_id
    and routine.oauth_client_id = client_record.client_id;
end;
$function$;

revoke all on function public.upsert_agent_day_closeout_routine_config_as_system(uuid, uuid, uuid, boolean, time without time zone)
  from public, anon, authenticated, service_role;
grant execute on function public.upsert_agent_day_closeout_routine_config_as_system(uuid, uuid, uuid, boolean, time without time zone)
  to service_role;

-- Revoking either the grant or one of its tokens must stop future routine
-- claims immediately. Replacements preserve the original non-disclosing
-- boolean/token semantics while adding only the bound-routine update.
create or replace function public.revoke_mcp_oauth_grant_as_system(
  p_grant_id uuid,
  p_user_id uuid
) returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_revoked boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  update private.mcp_oauth_grants grants
  set revoked_at = statement_timestamp()
  where grants.id = p_grant_id
    and grants.user_id = p_user_id
    and grants.revoked_at is null;
  v_revoked := found;

  if v_revoked then
    update private.mcp_oauth_tokens tokens
    set revoked_at = coalesce(tokens.revoked_at, statement_timestamp())
    where tokens.grant_id = p_grant_id;

    update private.agent_day_closeout_routines routine
    set enabled = false,
        claimed_at = null,
        claim_token = null,
        claim_expires_at = null,
        attempt_count = 0,
        retry_not_before = null,
        last_failure_code = 'OAUTH_GRANT_REVOKED',
        schedule_revision = case
          when routine.schedule_revision = 9007199254740991 then 0
          else routine.schedule_revision + 1
        end,
        updated_at = statement_timestamp()
    where routine.oauth_grant_id = p_grant_id
      and routine.enabled;
  end if;

  return v_revoked;
end;
$function$;

revoke all on function public.revoke_mcp_oauth_grant_as_system(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.revoke_mcp_oauth_grant_as_system(uuid, uuid)
  to service_role;

create or replace function public.revoke_mcp_oauth_token_as_system(
  p_token_hash text
) returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_grant_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  select tokens.grant_id
  into v_grant_id
  from private.mcp_oauth_tokens tokens
  where tokens.token_hash = p_token_hash;

  if v_grant_id is not null then
    update private.mcp_oauth_grants grants
    set revoked_at = coalesce(grants.revoked_at, statement_timestamp())
    where grants.id = v_grant_id;
    update private.mcp_oauth_tokens tokens
    set revoked_at = coalesce(tokens.revoked_at, statement_timestamp())
    where tokens.grant_id = v_grant_id;

    update private.agent_day_closeout_routines routine
    set enabled = false,
        claimed_at = null,
        claim_token = null,
        claim_expires_at = null,
        attempt_count = 0,
        retry_not_before = null,
        last_failure_code = 'OAUTH_GRANT_REVOKED',
        schedule_revision = case
          when routine.schedule_revision = 9007199254740991 then 0
          else routine.schedule_revision + 1
        end,
        updated_at = statement_timestamp()
    where routine.oauth_grant_id = v_grant_id
      and routine.enabled;
  end if;

  return true;
end;
$function$;

revoke all on function public.revoke_mcp_oauth_token_as_system(text)
  from public, anon, authenticated, service_role;
grant execute on function public.revoke_mcp_oauth_token_as_system(text)
  to service_role;

comment on function public.list_agent_day_closeout_routine_configs_as_system(uuid, uuid)
  is 'Lists the current operator own eligible v3 day-closeout grants and OPS-owned routine state.';
comment on function public.upsert_agent_day_closeout_routine_config_as_system(uuid, uuid, uuid, boolean, time without time zone)
  is 'Idempotently configures one daily OPS-owned closeout routine for the current operator exact live v3 grant.';
