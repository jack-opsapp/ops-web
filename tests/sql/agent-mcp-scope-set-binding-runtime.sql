begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local request.jwt.claim.role = 'service_role';

do $catalog_contract$
declare
  v_helper_oid oid := pg_catalog.to_regprocedure(
    'private.agent_mcp_oauth_scope_sets_equal(text[],text[])'
  )::oid;
  v_repaired_count integer;
begin
  if v_helper_oid is null then
    raise exception 'agent_mcp_scope_set_binding_runtime_failed: helper_missing';
  end if;

  if not private.agent_mcp_oauth_scope_sets_equal(
       array['ops.jobs.read', 'ops.company.read']::text[],
       array['ops.company.read', 'ops.jobs.read']::text[]
     )
     or private.agent_mcp_oauth_scope_sets_equal(
       array['ops.jobs.read', 'ops.company.read']::text[],
       array['ops.company.read', 'ops.tasks.read']::text[]
     )
     or private.agent_mcp_oauth_scope_sets_equal(
       array['ops.jobs.read', 'ops.company.read']::text[],
       array['ops.company.read']::text[]
     ) then
    raise exception
      'agent_mcp_scope_set_binding_runtime_failed: helper_semantics';
  end if;

  select pg_catalog.count(*)::integer
    into v_repaired_count
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname in ('private', 'public')
    and procedure.prosrc like
      '%private.agent_mcp_oauth_scope_sets_equal(%';

  if v_repaired_count is distinct from 20
     or exists (
       select 1
       from pg_catalog.pg_proc procedure
       join pg_catalog.pg_roles role
         on role.oid = procedure.proowner
       where procedure.oid = v_helper_oid
         and (
           role.rolname is distinct from current_user
           or procedure.proconfig is distinct from
             array['search_path=pg_catalog, pg_temp']::text[]
         )
     )
     or exists (
       select 1
       from pg_catalog.pg_proc procedure
       join pg_catalog.pg_namespace namespace
         on namespace.oid = procedure.pronamespace
       where namespace.nspname in ('private', 'public')
         and procedure.prosrc like '%scopes = p_granted_scope_ceiling%'
     )
     or pg_catalog.has_function_privilege(
       'anon', v_helper_oid, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated', v_helper_oid, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role', v_helper_oid, 'EXECUTE'
     ) then
    raise exception
      'agent_mcp_scope_set_binding_runtime_failed: catalog_contract %',
      v_repaired_count;
  end if;
end;
$catalog_contract$;

insert into public.companies (
  id,
  name,
  description,
  industries,
  industry,
  locale,
  timezone,
  currency_code,
  default_work_start,
  default_work_end,
  skip_weekends_in_auto_schedule,
  precise_scheduling_enabled,
  logo_url,
  website
) values (
  '96000000-0000-4000-8000-000000000001',
  'Scope Order Runtime',
  'OAuth consent order regression fixture',
  array['decks', 'railings']::text[],
  'trades',
  'en-CA',
  'America/Vancouver',
  'CAD',
  '08:00:00',
  '17:00:00',
  true,
  true,
  null,
  null
);

insert into public.users (
  id,
  company_id,
  first_name,
  last_name,
  is_active,
  is_company_admin
) values (
  '96100000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001',
  'Scope',
  'Operator',
  true,
  true
);

insert into public.company_inventory_settings (
  company_id,
  inventory_mode
) values (
  '96000000-0000-4000-8000-000000000001',
  'off'
);

insert into public.company_settings (
  company_id,
  catalog_setup_completed_at
) values (
  '96000000-0000-4000-8000-000000000001',
  null
);

insert into private.mcp_oauth_clients (
  client_id,
  client_name,
  redirect_uris,
  token_endpoint_auth_method,
  grant_types,
  response_types,
  scope,
  registration_source,
  scope_ceiling,
  consent_catalog_revision,
  exposure_revision
) values (
  '96300000-0000-4000-8000-000000000001',
  'Scope-order runtime',
  array['https://scope-order-runtime.ops.invalid/callback']::text[],
  'none',
  array['authorization_code', 'refresh_token']::text[],
  array['code']::text[],
  'ops.jobs.read ops.company.read',
  'manual',
  array['ops.jobs.read', 'ops.company.read']::text[],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-29.mcp-exposure.v2'
);

insert into private.mcp_oauth_grants (
  id,
  user_id,
  company_id,
  client_id,
  scopes,
  revision,
  accepted_labels,
  consent_catalog_revision,
  exposure_revision
) values (
  '96400000-0000-4000-8000-000000000001',
  '96100000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001',
  '96300000-0000-4000-8000-000000000001',
  array['ops.jobs.read', 'ops.company.read']::text[],
  'ffffffffffffffffffffffffffffffff',
  private.mcp_oauth_labels_for_scopes(
    array['ops.jobs.read', 'ops.company.read']::text[],
    '2026-08-22.mcp-consent-catalog.v1'
  ),
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-29.mcp-exposure.v2'
);

create temporary table agent_mcp_scope_set_authority
on commit drop as
select authority.permission_snapshot_revision
from private.resolve_agent_actor_authority(
  '96100000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001',
  array['settings.company']::text[]
) authority;

do $consent_order_contract$
declare
  v_payload jsonb;
  v_snapshot text;
begin
  select permission_snapshot_revision into strict v_snapshot
  from agent_mcp_scope_set_authority;

  select public.read_agent_company_context_as_system(
    'scope-set-consent-order',
    '96100000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000001',
    '96400000-0000-4000-8000-000000000001',
    '96300000-0000-4000-8000-000000000001',
    'ffffffffffffffffffffffffffffffff',
    array['ops.company.read', 'ops.jobs.read']::text[],
    v_snapshot,
    array['settings.company']::text[],
    'get_company_context',
    'get_company_context:2026-08-22.v1',
    '2026-08-22.capability-manifest.v8',
    array['ops.company.read']::text[],
    'all'
  ) into strict v_payload;

  if v_payload -> 'result' -> 'company_ref' ->> 'id' is distinct from
       '96000000-0000-4000-8000-000000000001'
     or v_payload -> 'granted_scope_ceiling' is distinct from
       '["ops.company.read", "ops.jobs.read"]'::jsonb then
    raise exception
      'agent_mcp_scope_set_binding_runtime_failed: consent_order %',
      v_payload;
  end if;

  begin
    perform public.read_agent_company_context_as_system(
      'scope-set-member-mismatch',
      '96100000-0000-4000-8000-000000000001',
      '96000000-0000-4000-8000-000000000001',
      '96400000-0000-4000-8000-000000000001',
      '96300000-0000-4000-8000-000000000001',
      'ffffffffffffffffffffffffffffffff',
      array['ops.company.read']::text[],
      v_snapshot,
      array['settings.company']::text[],
      'get_company_context',
      'get_company_context:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.company.read']::text[],
      'all'
    );
    raise exception
      'agent_mcp_scope_set_binding_runtime_failed: scope_member_mismatch_visible';
  exception
    when sqlstate 'P0002' then null;
  end;
end;
$consent_order_contract$;

rollback;
