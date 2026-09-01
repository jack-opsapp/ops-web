begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local request.jwt.claim.role = 'service_role';

do $catalog_contract$
declare
  v_repaired_count integer;
begin
  select pg_catalog.count(*)::integer
    into v_repaired_count
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where (
    (
        namespace.nspname = 'private'
        and procedure.proname in (
        'agent_p2_availability_summary_v1',
        'agent_p2_catalog_read_context_v1',
        'agent_p2_company_summary_v1',
        'agent_p2_customer_summary_v1',
        'agent_p2_deck_design_geometry_v1',
        'agent_p2_expense_read_context_v1',
        'agent_p2_integration_health_summary_v1',
        'agent_p2_payment_read_context_v1',
        'agent_p2_sales_read_context_v1',
        'agent_p2_site_visit_context_v1',
        'agent_p2_site_visit_list_v1',
        'agent_p2_task_context_v1',
        'agent_p2_task_list_v1',
        'agent_p2_team_summary_v1'
        )
      ) or (
        namespace.nspname = 'public'
        and procedure.proname in (
        'read_agent_company_context_as_system',
        'read_agent_customer_context_as_system'
        )
      )
    )
    and procedure.prosrc like '%order by%collate "C"%';

  if v_repaired_count is distinct from 16 then
    raise exception
      'agent_mcp_scope_canonical_order_runtime_failed: catalog %',
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
  '97000000-0000-4000-8000-000000000001',
  'Canonical Scope Runtime',
  'Cross-runtime scope ordering regression fixture',
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
  '97100000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000001',
  'Canonical',
  'Operator',
  true,
  true
);

insert into public.company_inventory_settings (
  company_id,
  inventory_mode
) values (
  '97000000-0000-4000-8000-000000000001',
  'off'
);

insert into public.company_settings (
  company_id,
  catalog_setup_completed_at
) values (
  '97000000-0000-4000-8000-000000000001',
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
  '97300000-0000-4000-8000-000000000001',
  'Canonical scope runtime',
  array['https://canonical-scope-runtime.ops.invalid/callback']::text[],
  'none',
  array['authorization_code', 'refresh_token']::text[],
  array['code']::text[],
  'ops.catalog_costs.read ops.catalog.read ops.company.read',
  'manual',
  array[
    'ops.catalog_costs.read',
    'ops.catalog.read',
    'ops.company.read'
  ]::text[],
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
  '97400000-0000-4000-8000-000000000001',
  '97100000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000001',
  '97300000-0000-4000-8000-000000000001',
  array[
    'ops.catalog_costs.read',
    'ops.catalog.read',
    'ops.company.read'
  ]::text[],
  'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  private.mcp_oauth_labels_for_scopes(
    array[
      'ops.catalog_costs.read',
      'ops.catalog.read',
      'ops.company.read'
    ]::text[],
    '2026-08-22.mcp-consent-catalog.v1'
  ),
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-29.mcp-exposure.v2'
);

create temporary table agent_mcp_scope_canonical_order_authority
on commit drop as
select authority.permission_snapshot_revision
from private.resolve_agent_actor_authority(
  '97100000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000001',
  array['settings.company']::text[]
) authority;

do $scope_vector_contract$
declare
  v_payload jsonb;
  v_snapshot text;
begin
  select permission_snapshot_revision into strict v_snapshot
  from agent_mcp_scope_canonical_order_authority;

  select public.read_agent_company_context_as_system(
    'scope-canonical-order',
    '97100000-0000-4000-8000-000000000001',
    '97000000-0000-4000-8000-000000000001',
    '97400000-0000-4000-8000-000000000001',
    '97300000-0000-4000-8000-000000000001',
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    array[
      'ops.catalog.read',
      'ops.catalog_costs.read',
      'ops.company.read'
    ]::text[],
    v_snapshot,
    array['settings.company']::text[],
    'get_company_context',
    'get_company_context:2026-08-22.v1',
    '2026-08-22.capability-manifest.v8',
    array['ops.company.read']::text[],
    'all'
  ) into strict v_payload;

  if v_payload -> 'result' -> 'company_ref' ->> 'id' is distinct from
       '97000000-0000-4000-8000-000000000001'
     or v_payload -> 'granted_scope_ceiling' is distinct from
       '["ops.catalog.read","ops.catalog_costs.read","ops.company.read"]'::jsonb
     then
    raise exception
      'agent_mcp_scope_canonical_order_runtime_failed: canonical %',
      v_payload;
  end if;

  begin
    perform public.read_agent_company_context_as_system(
      'scope-locale-order-rejected',
      '97100000-0000-4000-8000-000000000001',
      '97000000-0000-4000-8000-000000000001',
      '97400000-0000-4000-8000-000000000001',
      '97300000-0000-4000-8000-000000000001',
      'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      array[
        'ops.catalog_costs.read',
        'ops.catalog.read',
        'ops.company.read'
      ]::text[],
      v_snapshot,
      array['settings.company']::text[],
      'get_company_context',
      'get_company_context:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.company.read']::text[],
      'all'
    );
    raise exception
      'agent_mcp_scope_canonical_order_runtime_failed: locale_order_visible';
  exception
    when sqlstate '22023' then null;
  end;
end;
$scope_vector_contract$;

rollback;
