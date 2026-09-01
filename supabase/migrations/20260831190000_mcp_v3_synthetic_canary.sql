-- Exact-subject canary authority for the inactive MCP v3 day-closeout slice.
-- Public registration and ordinary consent remain pinned to active v2.

do $prerequisites$
declare
  v_signature text;
begin
  if pg_catalog.to_regclass('private.mcp_oauth_clients') is null
     or pg_catalog.to_regclass('private.mcp_oauth_grants') is null
     or pg_catalog.to_regclass('private.mcp_oauth_tokens') is null
     or pg_catalog.to_regclass('private.mcp_oauth_consent_previews') is null
     or pg_catalog.to_regclass('private.mcp_oauth_authorization_codes') is null
     or pg_catalog.to_regclass('private.agent_day_closeout_routines') is null
     or pg_catalog.to_regclass('private.agent_day_closeout_runs') is null
     or pg_catalog.to_regclass('private.agent_day_closeout_change_sets') is null
     or pg_catalog.to_regclass('private.agent_day_closeout_confirmations') is null
     or pg_catalog.to_regclass('private.agent_day_closeout_receipts') is null
     or pg_catalog.to_regclass('public.agent_actions') is null
     or pg_catalog.to_regclass('public.users') is null
     or pg_catalog.to_regclass('public.companies') is null then
    raise exception 'mcp_v3_canary prerequisite table missing';
  end if;

  foreach v_signature in array array[
    'private.user_is_active_company_member(uuid,uuid)',
    'public.rotate_mcp_oauth_refresh_token_as_system(text,uuid,text[],text,text,timestamp with time zone,timestamp with time zone)',
    'public.resolve_mcp_oauth_access_token_as_system(text)',
    'private.assert_agent_day_closeout_authority(uuid,uuid,uuid,uuid,text,text[],text,text)',
    'public.list_agent_day_closeout_routine_configs_as_system(uuid,uuid)',
    'public.upsert_agent_day_closeout_routine_config_as_system(uuid,uuid,uuid,boolean,time without time zone)',
    'private.resolve_agent_actor_authority(uuid,uuid,text[])',
    'public.has_permission(uuid,text,text)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'mcp_v3_canary prerequisite function missing: %',
        v_signature;
    end if;
  end loop;
end;
$prerequisites$;

create table private.mcp_oauth_canary_bindings (
  id uuid primary key default gen_random_uuid(),
  oauth_client_id uuid not null unique
    references private.mcp_oauth_clients (client_id),
  user_id uuid not null references public.users (id),
  company_id uuid not null references public.companies (id),
  exposure_revision text not null
    constraint mcp_oauth_canary_bindings_exposure_exact check (
      exposure_revision = '2026-08-30.mcp-exposure.v3'
    ),
  consent_catalog_revision text not null
    constraint mcp_oauth_canary_bindings_consent_exact check (
      consent_catalog_revision = '2026-08-30.mcp-consent-catalog.v2'
    ),
  expires_at timestamp with time zone not null,
  disabled_at timestamp with time zone,
  created_at timestamp with time zone not null default statement_timestamp(),
  constraint mcp_oauth_canary_bindings_expiry_bounded check (
    expires_at > created_at
    and expires_at <= created_at + interval '24 hours'
  )
);

alter table private.mcp_oauth_canary_bindings enable row level security;

create index mcp_oauth_canary_bindings_user_company_idx
  on private.mcp_oauth_canary_bindings (user_id, company_id, oauth_client_id);
create index mcp_oauth_canary_bindings_company_user_idx
  on private.mcp_oauth_canary_bindings (company_id, user_id, oauth_client_id);
create index mcp_oauth_canary_bindings_expiry_idx
  on private.mcp_oauth_canary_bindings (expires_at, oauth_client_id)
  where disabled_at is null;

revoke all on table private.mcp_oauth_canary_bindings
  from public, anon, authenticated, service_role;

-- Every mutation that can create, renew, schedule, or tear down canary
-- authority takes the same transaction-scoped client lock before touching
-- table rows. This makes shutdown the final authority decision without
-- imposing row-lock order across independently evolved OAuth/routine code.
create or replace function private.lock_mcp_v3_canary_client(
  p_oauth_client_id uuid
) returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if p_oauth_client_id is null then
    raise exception 'mcp_oauth_canary_client_invalid' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ops-mcp-v3-canary:' || p_oauth_client_id::text,
      0
    )
  );
end;
$function$;

revoke all on function private.lock_mcp_v3_canary_client(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.mcp_oauth_canary_is_current(
  p_oauth_client_id uuid,
  p_user_id uuid,
  p_company_id uuid,
  p_exposure_revision text,
  p_consent_catalog_revision text
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
  select exists (
    select 1
    from private.mcp_oauth_canary_bindings binding
    join private.mcp_oauth_clients client
      on client.client_id = binding.oauth_client_id
     and client.disabled_at is null
     and client.exposure_revision = binding.exposure_revision
     and client.consent_catalog_revision = binding.consent_catalog_revision
    where binding.oauth_client_id = p_oauth_client_id
      and binding.user_id = p_user_id
      and binding.company_id = p_company_id
      and binding.exposure_revision = p_exposure_revision
      and binding.consent_catalog_revision = p_consent_catalog_revision
      and binding.disabled_at is null
      and binding.expires_at > statement_timestamp()
      and private.user_is_active_company_member(
        binding.user_id,
        binding.company_id
      )
  );
$function$;

revoke all on function private.mcp_oauth_canary_is_current(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;

create or replace function public.provision_mcp_oauth_canary_as_system(
  p_oauth_client_id uuid,
  p_user_id uuid,
  p_company_id uuid,
  p_exposure_revision text,
  p_consent_catalog_revision text,
  p_expires_at timestamp with time zone
) returns table (
  exposure_revision text,
  consent_catalog_revision text,
  expires_at timestamp with time zone,
  enabled boolean
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_existing private.mcp_oauth_canary_bindings%rowtype;
  v_required_scopes constant text[] := array[
    'ops.correspondence.read',
    'ops.financial_documents.read',
    'ops.jobs.read',
    'ops.operations.prepare',
    'ops.operations.read',
    'ops.schedule.read',
    'ops.tasks.read'
  ];
  v_required_permissions constant jsonb := jsonb_build_array(
    jsonb_build_object('permission', 'calendar.view', 'scope', 'all'),
    jsonb_build_object('permission', 'email.view', 'scope', 'all'),
    jsonb_build_object('permission', 'invoices.view', 'scope', 'all'),
    jsonb_build_object('permission', 'pipeline.view', 'scope', 'all'),
    jsonb_build_object('permission', 'projects.view', 'scope', 'all'),
    jsonb_build_object('permission', 'reports.view', 'scope', 'all'),
    jsonb_build_object('permission', 'tasks.view', 'scope', 'all')
  );
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_exposure_revision is distinct from '2026-08-30.mcp-exposure.v3'
     or p_consent_catalog_revision is distinct from
        '2026-08-30.mcp-consent-catalog.v2'
     or p_expires_at is null
     or not (p_expires_at > statement_timestamp())
     or not (
       p_expires_at <= statement_timestamp() + interval '24 hours'
     ) then
    raise exception 'mcp_oauth_canary_invalid' using errcode = '22023';
  end if;
  perform private.lock_mcp_v3_canary_client(p_oauth_client_id);
  if not private.user_is_active_company_member(p_user_id, p_company_id) then
    raise exception 'mcp_oauth_canary_subject_unavailable'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.companies company
    where company.id = p_company_id
      and company.name = 'OPS MCP SYNTHETIC CANARY'
      and company.deleted_at is null
  ) or not public.has_permission(
    p_user_id,
    'settings.integrations',
    'all'
  ) or not exists (
    select 1
    from private.resolve_agent_actor_authority(
      p_user_id,
      p_company_id,
      array[
        'calendar.view', 'email.view', 'invoices.view', 'pipeline.view',
        'projects.view', 'reports.view', 'tasks.view'
      ]
    ) authority
    where authority.effective_permissions @> v_required_permissions
  ) then
    raise exception 'mcp_oauth_canary_subject_unavailable'
      using errcode = '22023';
  end if;

  perform 1
  from private.mcp_oauth_clients client
  where client.client_id = p_oauth_client_id
    and client.disabled_at is null
    and client.exposure_revision = p_exposure_revision
    and client.consent_catalog_revision = p_consent_catalog_revision
    and client.scope_ceiling = v_required_scopes
  for update;
  if not found then
    raise exception 'mcp_oauth_canary_client_unavailable'
      using errcode = '22023';
  end if;

  insert into private.mcp_oauth_canary_bindings (
    oauth_client_id,
    user_id,
    company_id,
    exposure_revision,
    consent_catalog_revision,
    expires_at
  ) values (
    p_oauth_client_id,
    p_user_id,
    p_company_id,
    p_exposure_revision,
    p_consent_catalog_revision,
    p_expires_at
  )
  on conflict (oauth_client_id) do nothing;

  select binding.*
  into strict v_existing
  from private.mcp_oauth_canary_bindings binding
  where binding.oauth_client_id = p_oauth_client_id
  for update;

  if v_existing.user_id is distinct from p_user_id
     or v_existing.company_id is distinct from p_company_id
     or v_existing.exposure_revision is distinct from p_exposure_revision
     or v_existing.consent_catalog_revision is distinct from
        p_consent_catalog_revision
     or v_existing.expires_at is distinct from p_expires_at
     or v_existing.disabled_at is not null then
    raise exception 'mcp_oauth_canary_conflict' using errcode = '23505';
  end if;

  return query select
    v_existing.exposure_revision,
    v_existing.consent_catalog_revision,
    v_existing.expires_at,
    true;
end;
$function$;

revoke all on function public.provision_mcp_oauth_canary_as_system(
  uuid, uuid, uuid, text, text, timestamp with time zone
) from public, anon, authenticated, service_role;
grant execute on function public.provision_mcp_oauth_canary_as_system(
  uuid, uuid, uuid, text, text, timestamp with time zone
) to service_role;

create or replace function public.resolve_mcp_oauth_canary_as_system(
  p_oauth_client_id uuid,
  p_user_id uuid,
  p_company_id uuid,
  p_exposure_revision text,
  p_consent_catalog_revision text
) returns table (
  exposure_revision text,
  consent_catalog_revision text,
  expires_at timestamp with time zone
)
language sql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
  select
    binding.exposure_revision,
    binding.consent_catalog_revision,
    binding.expires_at
  from private.mcp_oauth_canary_bindings binding
  join private.mcp_oauth_clients client
    on client.client_id = binding.oauth_client_id
   and client.disabled_at is null
   and client.exposure_revision = binding.exposure_revision
   and client.consent_catalog_revision = binding.consent_catalog_revision
  where auth.role() is not distinct from 'service_role'
    and binding.oauth_client_id = p_oauth_client_id
    and binding.user_id = p_user_id
    and binding.company_id = p_company_id
    and binding.exposure_revision = p_exposure_revision
    and binding.consent_catalog_revision = p_consent_catalog_revision
    and binding.disabled_at is null
    and binding.expires_at > statement_timestamp()
    and private.user_is_active_company_member(
      binding.user_id,
      binding.company_id
    );
$function$;

revoke all on function public.resolve_mcp_oauth_canary_as_system(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.resolve_mcp_oauth_canary_as_system(
  uuid, uuid, uuid, text, text
) to service_role;

create or replace function public.disable_mcp_oauth_canary_as_system(
  p_oauth_client_id uuid,
  p_user_id uuid,
  p_company_id uuid
) returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_found boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  perform private.lock_mcp_v3_canary_client(p_oauth_client_id);

  update private.mcp_oauth_canary_bindings binding
  set disabled_at = coalesce(binding.disabled_at, statement_timestamp())
  where binding.oauth_client_id = p_oauth_client_id
    and binding.user_id = p_user_id
    and binding.company_id = p_company_id;
  v_found := found;

  update private.mcp_oauth_clients client
  set disabled_at = coalesce(client.disabled_at, statement_timestamp())
  where client.client_id = p_oauth_client_id
    and client.exposure_revision = '2026-08-30.mcp-exposure.v3';

  update private.mcp_oauth_grants grant_record
  set revoked_at = coalesce(grant_record.revoked_at, statement_timestamp())
  where grant_record.client_id = p_oauth_client_id
    and grant_record.user_id = p_user_id
    and grant_record.company_id = p_company_id
    and grant_record.exposure_revision = '2026-08-30.mcp-exposure.v3';

  update private.mcp_oauth_tokens token_record
  set revoked_at = coalesce(token_record.revoked_at, statement_timestamp())
  from private.mcp_oauth_grants grant_record
  where token_record.grant_id = grant_record.id
    and grant_record.client_id = p_oauth_client_id
    and grant_record.user_id = p_user_id
    and grant_record.company_id = p_company_id
    and grant_record.exposure_revision = '2026-08-30.mcp-exposure.v3';

  update private.agent_day_closeout_routines routine
  set enabled = false,
      claimed_at = null,
      claim_token = null,
      claim_expires_at = null,
      attempt_count = 0,
      retry_not_before = null,
      last_failure_code = 'OAUTH_CANARY_DISABLED',
      schedule_revision = case
        when routine.schedule_revision = 9007199254740991 then 0
        else routine.schedule_revision + 1
      end,
      updated_at = statement_timestamp()
  where routine.oauth_client_id = p_oauth_client_id
    and routine.company_id = p_company_id
    and routine.actor_user_id = p_user_id
    and (
      routine.enabled
      or routine.claimed_at is not null
      or routine.claim_token is not null
      or routine.claim_expires_at is not null
    );

  return v_found;
end;
$function$;

revoke all on function public.disable_mcp_oauth_canary_as_system(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.disable_mcp_oauth_canary_as_system(
  uuid, uuid, uuid
) to service_role;

create or replace function public.inspect_mcp_oauth_canary_acceptance_as_system(
  p_oauth_client_id uuid,
  p_user_id uuid,
  p_company_id uuid,
  p_not_before timestamp with time zone,
  p_run_id uuid,
  p_action_id uuid,
  p_change_set_id uuid,
  p_preview_sha256 text
) returns table (
  prepared_with_approval boolean,
  receipt_verified boolean,
  routine_enabled boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_not_before is null
     or p_not_before < statement_timestamp() - interval '24 hours'
     or p_not_before > statement_timestamp() + interval '1 minute'
     or p_run_id is null
     or p_action_id is null
     or p_change_set_id is null
     or p_preview_sha256 !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'mcp_oauth_canary_acceptance_window_invalid'
      using errcode = '22023';
  end if;
  if not private.mcp_oauth_canary_is_current(
    p_oauth_client_id,
    p_user_id,
    p_company_id,
    '2026-08-30.mcp-exposure.v3',
    '2026-08-30.mcp-consent-catalog.v2'
  ) then
    return query select false, false, false;
    return;
  end if;

  return query
  with eligible_grants as materialized (
    select grant_record.id
    from private.mcp_oauth_grants grant_record
    where grant_record.client_id = p_oauth_client_id
      and grant_record.user_id = p_user_id
      and grant_record.company_id = p_company_id
      and grant_record.exposure_revision =
        '2026-08-30.mcp-exposure.v3'
      and grant_record.revoked_at is null
  ), prepared_runs as materialized (
    select run.id
    from private.agent_day_closeout_runs run
    join eligible_grants eligible on eligible.id = run.oauth_grant_id
    where run.id = p_run_id
      and run.oauth_client_id = p_oauth_client_id
      and run.actor_user_id = p_user_id
      and run.company_id = p_company_id
      and run.exposure_revision = '2026-08-30.mcp-exposure.v3'
      and run.prepared_at >= p_not_before
      and run.result_snapshot #>> '{filing,kind}' = 'approval_required'
      and run.result_snapshot #>> '{filing,action_id}' = p_action_id::text
      and run.result_snapshot #>> '{filing,change_set_id}' =
        p_change_set_id::text
      and run.result_snapshot #>> '{filing,preview,preview_sha256}' =
        p_preview_sha256
  )
  select
    exists (select 1 from prepared_runs),
    exists (
      select 1
      from private.agent_day_closeout_receipts receipt
      join eligible_grants eligible
        on eligible.id = receipt.oauth_grant_id
      join private.agent_day_closeout_confirmations confirmation
        on confirmation.id = receipt.confirmation_id
       and confirmation.action_id = receipt.action_id
       and confirmation.change_set_id = receipt.change_set_id
       and confirmation.company_id = receipt.company_id
       and confirmation.actor_user_id = receipt.actor_user_id
       and confirmation.oauth_grant_id = receipt.oauth_grant_id
       and confirmation.oauth_client_id = receipt.oauth_client_id
       and confirmation.exposure_revision = receipt.exposure_revision
       and confirmation.commit_capability = receipt.commit_capability
       and confirmation.preview_hash = receipt.preview_hash
       and confirmation.consumed_at is not null
      join private.agent_day_closeout_change_sets change_set
        on change_set.id = receipt.change_set_id
       and change_set.run_id = receipt.run_id
       and change_set.company_id = receipt.company_id
       and change_set.actor_user_id = receipt.actor_user_id
       and change_set.oauth_grant_id = receipt.oauth_grant_id
       and change_set.oauth_client_id = receipt.oauth_client_id
       and change_set.exposure_revision = receipt.exposure_revision
       and change_set.commit_capability = receipt.commit_capability
       and change_set.preview_hash = receipt.preview_hash
       and change_set.consumed_at is not null
      join private.agent_day_closeout_runs run
        on run.id = receipt.run_id
       and run.id = p_run_id
       and run.status = 'filed'
       and run.id in (select prepared.id from prepared_runs prepared)
      join public.agent_actions action
        on action.id = receipt.action_id
       and action.company_id = receipt.company_id
       and action.user_id = receipt.actor_user_id
       and action.action_type = 'file_day_closeout'
       and action.status = 'executed'
       and action.reviewed_by = p_user_id
       and action.execution_result = receipt.result
      where receipt.oauth_client_id = p_oauth_client_id
        and receipt.actor_user_id = p_user_id
        and receipt.company_id = p_company_id
        and receipt.run_id = p_run_id
        and receipt.action_id = p_action_id
        and receipt.change_set_id = p_change_set_id
        and receipt.preview_hash = substring(p_preview_sha256 from 8)
        and receipt.exposure_revision = '2026-08-30.mcp-exposure.v3'
        and receipt.commit_capability = 'commit_day_closeout'
        and receipt.committed_at >= p_not_before
        and receipt.result ->> 'effect' = 'filed_inside_ops'
        and receipt.result ->> 'run_id' = p_run_id::text
        and receipt.result ->> 'action_id' = p_action_id::text
        and receipt.result ->> 'change_set_id' = p_change_set_id::text
        and receipt.result ->> 'preview_sha256' = p_preview_sha256
        and receipt.result -> 'messages_sent' = '0'::jsonb
        and receipt.result -> 'money_moved' = 'false'::jsonb
    ),
    exists (
      select 1
      from private.agent_day_closeout_routines routine
      join eligible_grants eligible on eligible.id = routine.oauth_grant_id
      where routine.oauth_client_id = p_oauth_client_id
        and routine.actor_user_id = p_user_id
        and routine.company_id = p_company_id
        and routine.exposure_revision = '2026-08-30.mcp-exposure.v3'
        and routine.enabled
        and routine.claimed_at is null
        and routine.claim_token is null
        and routine.claim_expires_at is null
    );
end;
$function$;

revoke all on function public.inspect_mcp_oauth_canary_acceptance_as_system(
  uuid, uuid, uuid, timestamp with time zone, uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.inspect_mcp_oauth_canary_acceptance_as_system(
  uuid, uuid, uuid, timestamp with time zone, uuid, uuid, uuid, text
) to service_role;

create or replace function public.verify_mcp_oauth_canary_cleanup_as_system(
  p_oauth_client_id uuid,
  p_user_id uuid,
  p_company_id uuid
) returns table (
  binding_inactive boolean,
  client_disabled boolean,
  grants_inactive boolean,
  tokens_inactive boolean,
  routines_safe boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  return query select
    not exists (
      select 1
      from private.mcp_oauth_canary_bindings binding
      where binding.oauth_client_id = p_oauth_client_id
        and binding.user_id = p_user_id
        and binding.company_id = p_company_id
        and binding.disabled_at is null
        and binding.expires_at > statement_timestamp()
    ),
    exists (
      select 1
      from private.mcp_oauth_clients client
      where client.client_id = p_oauth_client_id
        and client.exposure_revision = '2026-08-30.mcp-exposure.v3'
        and client.disabled_at is not null
    ),
    not exists (
      select 1
      from private.mcp_oauth_grants grant_record
      where grant_record.client_id = p_oauth_client_id
        and grant_record.user_id = p_user_id
        and grant_record.company_id = p_company_id
        and grant_record.revoked_at is null
    ),
    not exists (
      select 1
      from private.mcp_oauth_tokens token_record
      join private.mcp_oauth_grants grant_record
        on grant_record.id = token_record.grant_id
      where grant_record.client_id = p_oauth_client_id
        and grant_record.user_id = p_user_id
        and grant_record.company_id = p_company_id
        and token_record.revoked_at is null
    ),
    not exists (
      select 1
      from private.agent_day_closeout_routines routine
      where routine.oauth_client_id = p_oauth_client_id
        and routine.actor_user_id = p_user_id
        and routine.company_id = p_company_id
        and (
          routine.enabled
          or routine.claimed_at is not null
          or routine.claim_token is not null
          or routine.claim_expires_at is not null
        )
    );
end;
$function$;

revoke all on function public.verify_mcp_oauth_canary_cleanup_as_system(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.verify_mcp_oauth_canary_cleanup_as_system(
  uuid, uuid, uuid
) to service_role;

-- Preserve the reviewed historical refresh implementation behind a private
-- executable boundary, then add the v3 current-authority decision before it.
alter function public.rotate_mcp_oauth_refresh_token_as_system(
  text, uuid, text[], text, text, timestamp with time zone,
  timestamp with time zone
) rename to rotate_mcp_oauth_refresh_token_without_v3_canary;

revoke all on function public.rotate_mcp_oauth_refresh_token_without_v3_canary(
  text, uuid, text[], text, text, timestamp with time zone,
  timestamp with time zone
) from public, anon, authenticated, service_role;

create or replace function public.rotate_mcp_oauth_refresh_token_as_system(
  p_presented_hash text,
  p_client_id uuid,
  p_active_grantable_scopes text[],
  p_new_access_hash text,
  p_new_refresh_hash text,
  p_access_expires_at timestamp with time zone,
  p_refresh_expires_at timestamp with time zone
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
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_grant_id uuid;
  v_family_id uuid;
  v_user_id uuid;
  v_company_id uuid;
  v_exposure_revision text;
  v_consent_catalog_revision text;
  v_rotated record;
  v_effective_grantable_scopes text[] := p_active_grantable_scopes;
  v_required_v3_scopes constant text[] := array[
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
  if exists (
    select 1
    from private.mcp_oauth_clients client
    where client.client_id = p_client_id
      and client.exposure_revision = '2026-08-30.mcp-exposure.v3'
  ) then
    perform private.lock_mcp_v3_canary_client(p_client_id);
  end if;

  select
    grant_record.id,
    token_record.family_id,
    grant_record.user_id,
    grant_record.company_id,
    grant_record.exposure_revision,
    grant_record.consent_catalog_revision
  into
    v_grant_id,
    v_family_id,
    v_user_id,
    v_company_id,
    v_exposure_revision,
    v_consent_catalog_revision
  from private.mcp_oauth_tokens token_record
  join private.mcp_oauth_grants grant_record
    on grant_record.id = token_record.grant_id
  where token_record.token_hash = p_presented_hash
    and token_record.kind = 'refresh'
    and grant_record.client_id = p_client_id;

  if v_exposure_revision = '2026-08-30.mcp-exposure.v3' then
    if v_consent_catalog_revision is distinct from
         '2026-08-30.mcp-consent-catalog.v2'
       or not private.mcp_oauth_canary_is_current(
         p_client_id,
         v_user_id,
         v_company_id,
         v_exposure_revision,
         v_consent_catalog_revision
       ) then
      update private.mcp_oauth_tokens token_record
      set revoked_at = coalesce(token_record.revoked_at, statement_timestamp())
      where token_record.family_id = v_family_id;

      update private.mcp_oauth_grants grant_record
      set revoked_at = coalesce(grant_record.revoked_at, statement_timestamp())
      where grant_record.id = v_grant_id;

      update private.agent_day_closeout_routines routine
      set enabled = false,
          claimed_at = null,
          claim_token = null,
          claim_expires_at = null,
          attempt_count = 0,
          retry_not_before = null,
          last_failure_code = 'OAUTH_CANARY_UNAVAILABLE',
          schedule_revision = case
            when routine.schedule_revision = 9007199254740991 then 0
            else routine.schedule_revision + 1
          end,
          updated_at = statement_timestamp()
      where routine.oauth_grant_id = v_grant_id
        and (
          routine.enabled
          or routine.claimed_at is not null
          or routine.claim_token is not null
          or routine.claim_expires_at is not null
        );
      return;
    end if;

    select array_agg(scope_value order by scope_value)
    into v_effective_grantable_scopes
    from (
      select distinct unnest(
        p_active_grantable_scopes || v_required_v3_scopes
      ) as scope_value
    ) combined_scopes;
  end if;

  select *
  into v_rotated
  from public.rotate_mcp_oauth_refresh_token_without_v3_canary(
    p_presented_hash,
    p_client_id,
    v_effective_grantable_scopes,
    p_new_access_hash,
    p_new_refresh_hash,
    p_access_expires_at,
    p_refresh_expires_at
  );
  if not found then
    return;
  end if;

  if v_rotated.reuse_detected then
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
    where routine.oauth_grant_id = v_rotated.grant_id
      and (
        routine.enabled
        or routine.claimed_at is not null
        or routine.claim_token is not null
        or routine.claim_expires_at is not null
      );
  end if;

  return query select
    v_rotated.grant_id::uuid,
    v_rotated.client_id::uuid,
    v_rotated.user_id::uuid,
    v_rotated.company_id::uuid,
    v_rotated.scopes::text[],
    v_rotated.accepted_labels::text[],
    v_rotated.consent_catalog_revision::text,
    v_rotated.exposure_revision::text,
    v_rotated.revision::text,
    v_rotated.issuer::text,
    v_rotated.audience::text,
    v_rotated.reuse_detected::boolean;
end;
$function$;

revoke all on function public.rotate_mcp_oauth_refresh_token_as_system(
  text, uuid, text[], text, text, timestamp with time zone,
  timestamp with time zone
) from public, anon, authenticated, service_role;
grant execute on function public.rotate_mcp_oauth_refresh_token_as_system(
  text, uuid, text[], text, text, timestamp with time zone,
  timestamp with time zone
) to service_role;

-- The two-argument boundary proves the server still considers v2 the active
-- public exposure and independently rechecks every stored v3 bearer. A
-- constrained one-argument compatibility wrapper is restored below.
revoke all on function public.resolve_mcp_oauth_access_token_as_system(text)
  from public, anon, authenticated, service_role;

create or replace function public.resolve_mcp_oauth_access_token_as_system(
  p_token_hash text,
  p_active_exposure_revision text
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
  expires_at timestamp with time zone,
  token_revoked boolean,
  grant_revoked boolean,
  client_disabled boolean
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_active_exposure_revision is distinct from
       '2026-08-29.mcp-exposure.v2' then
    return;
  end if;

  return query
  with resolved as (
    select
      grant_record.id as grant_id,
      grant_record.client_id,
      client_record.client_name,
      grant_record.user_id,
      grant_record.company_id,
      grant_record.scopes,
      grant_record.accepted_labels,
      grant_record.consent_catalog_revision,
      grant_record.exposure_revision,
      grant_record.revision,
      token_record.issuer,
      token_record.audience,
      token_record.expires_at,
      token_record.revoked_at is not null as token_revoked,
      grant_record.revoked_at is not null as grant_revoked,
      client_record.disabled_at is not null as client_disabled,
      (
        token_record.revoked_at is null
        and grant_record.revoked_at is null
        and client_record.disabled_at is null
        and token_record.expires_at > statement_timestamp()
      ) as usable
    from private.mcp_oauth_tokens token_record
    join private.mcp_oauth_grants grant_record
      on grant_record.id = token_record.grant_id
    join private.mcp_oauth_clients client_record
      on client_record.client_id = grant_record.client_id
    where token_record.token_hash = p_token_hash
      and token_record.kind = 'access'
      and grant_record.scopes <@ client_record.scope_ceiling
      and (
        grant_record.exposure_revision <>
          '2026-08-30.mcp-exposure.v3'
        or private.mcp_oauth_canary_is_current(
          grant_record.client_id,
          grant_record.user_id,
          grant_record.company_id,
          grant_record.exposure_revision,
          grant_record.consent_catalog_revision
        )
      )
  ),
  touched as (
    update private.mcp_oauth_grants grant_record
    set last_used_at = statement_timestamp()
    from resolved
    where grant_record.id = resolved.grant_id
      and resolved.usable
    returning grant_record.id
  )
  select
    resolved.grant_id,
    resolved.client_id,
    resolved.client_name,
    resolved.user_id,
    resolved.company_id,
    resolved.scopes,
    resolved.accepted_labels,
    resolved.consent_catalog_revision,
    resolved.exposure_revision,
    resolved.revision,
    resolved.issuer,
    resolved.audience,
    resolved.expires_at,
    resolved.token_revoked,
    resolved.grant_revoked,
    resolved.client_disabled
  from resolved;
end;
$function$;

revoke all on function public.resolve_mcp_oauth_access_token_as_system(
  text, text
) from public, anon, authenticated, service_role;
grant execute on function public.resolve_mcp_oauth_access_token_as_system(
  text, text
) to service_role;

-- Keep rolling database/application releases compatible: an old v2 server may
-- still call the one-argument resolver while the new application starts. The
-- compatibility boundary preserves every non-v3 grant but can never accept a
-- canary bearer, even when the exact binding is current.
create or replace function public.resolve_mcp_oauth_access_token_as_system(
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
  expires_at timestamp with time zone,
  token_revoked boolean,
  grant_revoked boolean,
  client_disabled boolean
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  return query
  select resolved.*
  from public.resolve_mcp_oauth_access_token_as_system(
    p_token_hash,
    '2026-08-29.mcp-exposure.v2'
  ) resolved
  where resolved.exposure_revision <>
    '2026-08-30.mcp-exposure.v3';
end;
$function$;

revoke all on function public.resolve_mcp_oauth_access_token_as_system(text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_mcp_oauth_access_token_as_system(text)
  to service_role;

create or replace function private.assert_agent_day_closeout_authority(
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
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  v_permission_snapshot_revision text;
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
  if p_exposure_revision is distinct from
       '2026-08-30.mcp-exposure.v3' then
    raise exception 'AGENT_DAY_CLOSEOUT_EXPOSURE_INVALID'
      using errcode = '42501';
  end if;
  if not private.mcp_oauth_canary_is_current(
    p_oauth_client_id,
    p_actor_user_id,
    p_company_id,
    p_exposure_revision,
    '2026-08-30.mcp-consent-catalog.v2'
  ) then
    raise exception 'AGENT_DAY_CLOSEOUT_CANARY_STALE_OR_DENIED'
      using errcode = '42501';
  end if;

  select authority.permission_snapshot_revision
  into v_permission_snapshot_revision
  from private.resolve_agent_actor_authority(
    p_actor_user_id,
    p_company_id,
    array[
      'calendar.view', 'email.view', 'invoices.view', 'pipeline.view',
      'projects.view', 'reports.view', 'tasks.view'
    ]
  ) authority
  where authority.effective_permissions @> v_required_permissions;

  if v_permission_snapshot_revision is null
     or (
       p_permission_snapshot_revision is not null
       and v_permission_snapshot_revision is distinct from
         p_permission_snapshot_revision
     ) then
    raise exception 'AGENT_DAY_CLOSEOUT_AUTHORITY_STALE_OR_DENIED'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from private.mcp_oauth_grants grant_record
    join private.mcp_oauth_clients client_record
      on client_record.client_id = grant_record.client_id
     and client_record.disabled_at is null
     and grant_record.scopes <@ client_record.scope_ceiling
     and grant_record.consent_catalog_revision =
       client_record.consent_catalog_revision
     and grant_record.exposure_revision = client_record.exposure_revision
    where grant_record.id = p_oauth_grant_id
      and grant_record.user_id = p_actor_user_id
      and grant_record.company_id = p_company_id
      and grant_record.client_id = p_oauth_client_id
      and grant_record.revision = p_grant_revision
      and grant_record.scopes = p_granted_scope_ceiling
      and grant_record.revoked_at is null
      and grant_record.exposure_revision = p_exposure_revision
      and v_required_scopes <@ grant_record.scopes
  ) then
    raise exception 'AGENT_DAY_CLOSEOUT_GRANT_STALE_OR_DENIED'
      using errcode = '42501';
  end if;

  return v_permission_snapshot_revision;
end;
$function$;

revoke all on function private.assert_agent_day_closeout_authority(
  uuid, uuid, uuid, uuid, text, text[], text, text
) from public, anon, authenticated, service_role;

alter function public.list_agent_day_closeout_routine_configs_as_system(
  uuid, uuid
) rename to list_agent_day_closeout_routine_configs_without_v3_canary;

revoke all on function public.list_agent_day_closeout_routine_configs_without_v3_canary(
  uuid, uuid
) from public, anon, authenticated, service_role;

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
  next_run_at timestamp with time zone,
  last_run_at timestamp with time zone,
  last_success_at timestamp with time zone,
  last_failure_code text,
  schedule_revision bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  return query
  select
    config.grant_id,
    config.client_id,
    config.client_name,
    config.enabled,
    config.local_time,
    config.timezone,
    config.next_run_at,
    config.last_run_at,
    config.last_success_at,
    config.last_failure_code,
    config.schedule_revision
  from public.list_agent_day_closeout_routine_configs_without_v3_canary(
    p_actor_user_id,
    p_company_id
  ) config
  where private.mcp_oauth_canary_is_current(
    config.client_id,
    p_actor_user_id,
    p_company_id,
    '2026-08-30.mcp-exposure.v3',
    '2026-08-30.mcp-consent-catalog.v2'
  );
end;
$function$;

revoke all on function public.list_agent_day_closeout_routine_configs_as_system(
  uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.list_agent_day_closeout_routine_configs_as_system(
  uuid, uuid
) to service_role;

-- Routine configuration used to lock its routine row before authority was
-- revalidated. The wrapper acquires the common client lock first; the renamed
-- implementation then repeats every grant/client/actor check under that lock.
alter function public.upsert_agent_day_closeout_routine_config_as_system(
  uuid, uuid, uuid, boolean, time without time zone
) rename to upsert_agent_day_closeout_routine_config_without_v3_canary;

revoke all on function public.upsert_agent_day_closeout_routine_config_without_v3_canary(
  uuid, uuid, uuid, boolean, time without time zone
) from public, anon, authenticated, service_role;

create or replace function public.upsert_agent_day_closeout_routine_config_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_enabled boolean,
  p_local_time time without time zone
) returns table (
  grant_id uuid,
  client_id uuid,
  client_name text,
  enabled boolean,
  local_time text,
  timezone text,
  next_run_at timestamp with time zone,
  last_run_at timestamp with time zone,
  last_success_at timestamp with time zone,
  last_failure_code text,
  schedule_revision bigint
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  v_client_id uuid;
  v_exposure_revision text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  select grant_record.client_id, grant_record.exposure_revision
  into v_client_id, v_exposure_revision
  from private.mcp_oauth_grants grant_record
  where grant_record.id = p_oauth_grant_id
    and grant_record.user_id = p_actor_user_id
    and grant_record.company_id = p_company_id;

  if v_exposure_revision = '2026-08-30.mcp-exposure.v3' then
    perform private.lock_mcp_v3_canary_client(v_client_id);
  end if;

  return query
  select config.*
  from public.upsert_agent_day_closeout_routine_config_without_v3_canary(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_enabled,
    p_local_time
  ) config;
end;
$function$;

revoke all on function public.upsert_agent_day_closeout_routine_config_as_system(
  uuid, uuid, uuid, boolean, time without time zone
) from public, anon, authenticated, service_role;
grant execute on function public.upsert_agent_day_closeout_routine_config_as_system(
  uuid, uuid, uuid, boolean, time without time zone
) to service_role;

-- Every durable v3 authority write independently rechecks the exact binding.
-- The application resolver provides the ordinary rejection path; these
-- triggers close the race between that read and the write transaction.
create or replace function private.enforce_mcp_v3_canary_write()
returns trigger
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_client_id uuid;
  v_user_id uuid;
  v_company_id uuid;
  v_exposure_revision text;
  v_consent_catalog_revision text;
begin
  if tg_table_name = 'mcp_oauth_tokens' then
    select
      grant_record.client_id,
      grant_record.user_id,
      grant_record.company_id,
      grant_record.exposure_revision,
      grant_record.consent_catalog_revision
    into
      v_client_id,
      v_user_id,
      v_company_id,
      v_exposure_revision,
      v_consent_catalog_revision
    from private.mcp_oauth_grants grant_record
    where grant_record.id = new.grant_id;
    if not found then
      return new;
    end if;
  else
    v_client_id := new.client_id;
    v_user_id := new.user_id;
    v_company_id := new.company_id;
    v_exposure_revision := new.exposure_revision;
    v_consent_catalog_revision := new.consent_catalog_revision;
  end if;

  if v_exposure_revision = '2026-08-30.mcp-exposure.v3' then
    perform private.lock_mcp_v3_canary_client(v_client_id);
    if v_consent_catalog_revision is distinct from
         '2026-08-30.mcp-consent-catalog.v2'
       or not private.mcp_oauth_canary_is_current(
         v_client_id,
         v_user_id,
         v_company_id,
         '2026-08-30.mcp-exposure.v3',
         '2026-08-30.mcp-consent-catalog.v2'
       ) then
      raise exception 'mcp_oauth_canary_unavailable' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_mcp_v3_canary_write()
  from public, anon, authenticated, service_role;

create trigger mcp_oauth_consent_previews_v3_canary
before insert on private.mcp_oauth_consent_previews
for each row execute function private.enforce_mcp_v3_canary_write();

create trigger mcp_oauth_authorization_codes_v3_canary
before insert on private.mcp_oauth_authorization_codes
for each row execute function private.enforce_mcp_v3_canary_write();

create trigger mcp_oauth_grants_v3_canary
before insert on private.mcp_oauth_grants
for each row execute function private.enforce_mcp_v3_canary_write();

create trigger mcp_oauth_tokens_v3_canary
before insert on private.mcp_oauth_tokens
for each row execute function private.enforce_mcp_v3_canary_write();

notify pgrst, 'reload schema';
