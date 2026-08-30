\set ON_ERROR_STOP on

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';

select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

create temporary table agent_site_visit_nullable_client_clock
on commit drop as
select pg_catalog.date_trunc(
         'milliseconds',
         pg_catalog.statement_timestamp()
       ) as read_at;

insert into public.companies (id, name, bubble_id) values
  (
    '8e000000-0000-4000-8000-000000000001',
    'Nullable client site visit runtime company',
    'agent-site-visit-nullable-client-company'
  ),
  (
    '8e000000-0000-4000-8000-000000000002',
    'Foreign nullable client runtime company',
    'agent-site-visit-nullable-client-foreign-company'
  );

insert into private.agent_operational_read_revisions (
  company_id,
  source_revision
) values (
  '8e000000-0000-4000-8000-000000000001',
  0
) on conflict (company_id) do nothing;

insert into public.users (
  id,
  company_id,
  first_name,
  last_name,
  email,
  auth_id,
  is_active,
  is_company_admin
) values (
  '8e100000-0000-4000-8000-000000000001',
  '8e000000-0000-4000-8000-000000000001',
  'Nullable',
  'Client Reader',
  'nullable-client-site-visit@ops.invalid',
  '8e100000-0000-4000-8000-000000000001',
  true,
  false
);

insert into public.user_permission_overrides (
  id,
  user_id,
  company_id,
  permission,
  scope,
  granted
) values
  (
    '8e110000-0000-4000-8000-000000000001',
    '8e100000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    'calendar.view',
    'all',
    true
  ),
  (
    '8e110000-0000-4000-8000-000000000002',
    '8e100000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    'clients.view',
    'all',
    true
  ),
  (
    '8e110000-0000-4000-8000-000000000003',
    '8e100000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    'photos.view',
    'all',
    true
  ),
  (
    '8e110000-0000-4000-8000-000000000004',
    '8e100000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    'pipeline.view',
    'all',
    true
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
  '8e120000-0000-4000-8000-000000000001',
  'Nullable client site visit runtime',
  array['https://runtime.invalid/callback']::text[],
  'none',
  array['authorization_code', 'refresh_token']::text[],
  array['code']::text[],
  'ops.customers.read ops.files.read ops.jobs.read ops.schedule.read ops.site_visits.read',
  'manual',
  array[
    'ops.customers.read',
    'ops.files.read',
    'ops.jobs.read',
    'ops.schedule.read',
    'ops.site_visits.read'
  ]::text[],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);

insert into private.mcp_oauth_grants (
  id,
  user_id,
  company_id,
  client_id,
  scopes,
  accepted_labels,
  consent_catalog_revision,
  exposure_revision,
  revision
) values (
  '8e130000-0000-4000-8000-000000000001',
  '8e100000-0000-4000-8000-000000000001',
  '8e000000-0000-4000-8000-000000000001',
  '8e120000-0000-4000-8000-000000000001',
  array[
    'ops.customers.read',
    'ops.files.read',
    'ops.jobs.read',
    'ops.schedule.read',
    'ops.site_visits.read'
  ]::text[],
  private.mcp_oauth_labels_for_scopes(
    array[
      'ops.customers.read',
      'ops.files.read',
      'ops.jobs.read',
      'ops.schedule.read',
      'ops.site_visits.read'
    ]::text[],
    '2026-08-22.mcp-consent-catalog.v1'
  ),
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1',
  pg_catalog.md5('agent-site-visit-nullable-client-grant')
);

insert into public.clients (id, company_id, name) values (
  '8e200000-0000-4000-8000-000000000002',
  '8e000000-0000-4000-8000-000000000002',
  'Foreign customer'
);

insert into public.opportunities (id, company_id, client_ref, title) values (
  '8e300000-0000-4000-8000-000000000010',
  '8e000000-0000-4000-8000-000000000001',
  null,
  'Production-shaped opportunity without resolved client'
);

insert into public.projects (
  id,
  company_id,
  client_id,
  opportunity_id,
  opportunity_ref,
  title,
  status
) values (
  '8e400000-0000-4000-8000-000000000010',
  '8e000000-0000-4000-8000-000000000001',
  null,
  '8e300000-0000-4000-8000-000000000010',
  '8e300000-0000-4000-8000-000000000010',
  'Converted project without resolved client',
  'in_progress'
);

insert into public.site_visits (
  id,
  company_id,
  opportunity_id,
  client_id,
  client_ref,
  project_id,
  project_ref,
  scheduled_at,
  booked_at,
  duration_minutes,
  assignee_ids,
  status,
  created_by,
  created_at
) values
  (
    '8e500000-0000-4000-8000-000000000010',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000010',
    null,
    null,
    null,
    null,
    (select read_at + interval '2 hours'
     from agent_site_visit_nullable_client_clock),
    (select read_at - interval '12 minutes'
     from agent_site_visit_nullable_client_clock),
    60,
    array['8e100000-0000-4000-8000-000000000001']::text[],
    'scheduled',
    '8e100000-0000-4000-8000-000000000001',
    (select read_at - interval '1 hour'
     from agent_site_visit_nullable_client_clock)
  ),
  (
    '8e500000-0000-4000-8000-000000000011',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000010',
    '8e200000-0000-4000-8000-000000000002',
    '8e200000-0000-4000-8000-000000000002',
    null,
    null,
    (select read_at + interval '2 hours'
     from agent_site_visit_nullable_client_clock),
    (select read_at - interval '11 minutes'
     from agent_site_visit_nullable_client_clock),
    60,
    array['8e100000-0000-4000-8000-000000000001']::text[],
    'scheduled',
    '8e100000-0000-4000-8000-000000000001',
    (select read_at - interval '1 hour'
     from agent_site_visit_nullable_client_clock)
  ),
  (
    '8e500000-0000-4000-8000-000000000012',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000010',
    null,
    null,
    '8e400000-0000-4000-8000-000000000010',
    '8e400000-0000-4000-8000-000000000010',
    (select read_at + interval '2 hours'
     from agent_site_visit_nullable_client_clock),
    (select read_at - interval '10 minutes'
     from agent_site_visit_nullable_client_clock),
    60,
    array['8e100000-0000-4000-8000-000000000001']::text[],
    'scheduled',
    '8e100000-0000-4000-8000-000000000001',
    (select read_at - interval '1 hour'
     from agent_site_visit_nullable_client_clock)
  );

create temporary table agent_site_visit_nullable_client_authority
on commit drop as
select authority.permission_snapshot_revision
from private.resolve_agent_actor_authority(
  '8e100000-0000-4000-8000-000000000001',
  '8e000000-0000-4000-8000-000000000001',
  array[
    'calendar.view',
    'clients.view',
    'photos.view',
    'pipeline.view'
  ]::text[]
) authority;

do $nullable_client_visibility_contract$
declare
  v_list jsonb;
  v_context jsonb;
  v_project_context jsonb;
  v_attention jsonb;
begin
  if (
    select pg_catalog.count(*)
    from agent_site_visit_nullable_client_authority
    where permission_snapshot_revision ~ '^sha256:[0-9a-f]{64}$'
  ) <> 1 then
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: authority invalid';
  end if;

  select public.read_agent_site_visits_as_system(
    p_request_id => 'agent-site-visit-runtime-nullable-client-list',
    p_actor_user_id => '8e100000-0000-4000-8000-000000000001',
    p_company_id => '8e000000-0000-4000-8000-000000000001',
    p_oauth_grant_id => '8e130000-0000-4000-8000-000000000001',
    p_oauth_client_id => '8e120000-0000-4000-8000-000000000001',
    p_grant_revision =>
      pg_catalog.md5('agent-site-visit-nullable-client-grant'),
    p_granted_scope_ceiling => array[
      'ops.customers.read', 'ops.files.read', 'ops.jobs.read',
      'ops.schedule.read', 'ops.site_visits.read'
    ]::text[],
    p_permission_snapshot_revision => (
      select permission_snapshot_revision
      from agent_site_visit_nullable_client_authority
    ),
    p_registered_permission_keys => array[
      'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
    ]::text[],
    p_capability_id => 'list_site_visits',
    p_capability_revision => 'list_site_visits:2026-08-22.v1',
    p_capability_manifest_revision =>
      '2026-08-22.capability-manifest.v8',
    p_required_oauth_scopes => array[
      'ops.customers.read', 'ops.jobs.read', 'ops.schedule.read',
      'ops.site_visits.read'
    ]::text[],
    p_resolved_permission_scopes =>
      '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
    p_view_kind => 'booked_appointments',
    p_window_from => (
      select read_at - interval '20 minutes'
      from agent_site_visit_nullable_client_clock
    ),
    p_window_to => (
      select read_at from agent_site_visit_nullable_client_clock
    ),
    p_statuses => array['scheduled']::text[],
    p_include_unlinked => false,
    p_assignee_user_id => null,
    p_opportunity_id => '8e300000-0000-4000-8000-000000000010',
    p_item_limit => 25,
    p_page_fetch_limit => 26,
    p_source_limit => 501,
    p_cursor_read_at => null,
    p_cursor_source_revisions => '[]'::jsonb,
    p_after_order_at => null,
    p_after_site_visit_id => null
  ) into strict v_list;

  if pg_catalog.jsonb_array_length(v_list -> 'rows') <> 2
     or v_list #>> '{rows,0,item,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000010'
     or v_list #>> '{rows,1,item,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000012'
     or v_list::text like '%8e500000-0000-4000-8000-000000000011%' then
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: list invalid';
  end if;

  select public.read_agent_site_visit_context_as_system(
    p_request_id => 'agent-site-visit-runtime-nullable-client-context',
    p_actor_user_id => '8e100000-0000-4000-8000-000000000001',
    p_company_id => '8e000000-0000-4000-8000-000000000001',
    p_oauth_grant_id => '8e130000-0000-4000-8000-000000000001',
    p_oauth_client_id => '8e120000-0000-4000-8000-000000000001',
    p_grant_revision =>
      pg_catalog.md5('agent-site-visit-nullable-client-grant'),
    p_granted_scope_ceiling => array[
      'ops.customers.read', 'ops.files.read', 'ops.jobs.read',
      'ops.schedule.read', 'ops.site_visits.read'
    ]::text[],
    p_permission_snapshot_revision => (
      select permission_snapshot_revision
      from agent_site_visit_nullable_client_authority
    ),
    p_registered_permission_keys => array[
      'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
    ]::text[],
    p_capability_id => 'get_site_visit_context',
    p_capability_revision => 'get_site_visit_context:2026-08-22.v1',
    p_capability_manifest_revision =>
      '2026-08-22.capability-manifest.v8',
    p_required_oauth_scopes => array[
      'ops.customers.read', 'ops.jobs.read', 'ops.schedule.read',
      'ops.site_visits.read'
    ]::text[],
    p_resolved_permission_scopes =>
      '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
    p_site_visit_id => '8e500000-0000-4000-8000-000000000010',
    p_expected_anchor => 'opportunity',
    p_expected_opportunity_id =>
      '8e300000-0000-4000-8000-000000000010',
    p_sections => array['booking', 'lead']::text[],
    p_source_limit => 501,
    p_artifact_source_limit => 501,
    p_checklist_answer_limit => 0,
    p_checklist_answer_fetch_limit => 0,
    p_timeline_limit => 0
  ) into strict v_context;

  if v_context #>> '{result,visit,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000010'
     or v_context #>> '{result,sections,lead,state}' <> 'linked'
     or not (v_context #> '{result,sections,lead}') ? 'client_ref'
     or v_context #> '{result,sections,lead,client_ref}' is distinct from
       'null'::jsonb then
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: context invalid';
  end if;

  select public.read_agent_site_visit_context_as_system(
    p_request_id => 'agent-site-visit-runtime-project-linked-nullable-client',
    p_actor_user_id => '8e100000-0000-4000-8000-000000000001',
    p_company_id => '8e000000-0000-4000-8000-000000000001',
    p_oauth_grant_id => '8e130000-0000-4000-8000-000000000001',
    p_oauth_client_id => '8e120000-0000-4000-8000-000000000001',
    p_grant_revision =>
      pg_catalog.md5('agent-site-visit-nullable-client-grant'),
    p_granted_scope_ceiling => array[
      'ops.customers.read', 'ops.files.read', 'ops.jobs.read',
      'ops.schedule.read', 'ops.site_visits.read'
    ]::text[],
    p_permission_snapshot_revision => (
      select permission_snapshot_revision
      from agent_site_visit_nullable_client_authority
    ),
    p_registered_permission_keys => array[
      'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
    ]::text[],
    p_capability_id => 'get_site_visit_context',
    p_capability_revision => 'get_site_visit_context:2026-08-22.v1',
    p_capability_manifest_revision =>
      '2026-08-22.capability-manifest.v8',
    p_required_oauth_scopes => array[
      'ops.customers.read', 'ops.jobs.read', 'ops.schedule.read',
      'ops.site_visits.read'
    ]::text[],
    p_resolved_permission_scopes =>
      '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
    p_site_visit_id => '8e500000-0000-4000-8000-000000000012',
    p_expected_anchor => 'opportunity',
    p_expected_opportunity_id =>
      '8e300000-0000-4000-8000-000000000010',
    p_sections => array['booking', 'lead']::text[],
    p_source_limit => 501,
    p_artifact_source_limit => 501,
    p_checklist_answer_limit => 0,
    p_checklist_answer_fetch_limit => 0,
    p_timeline_limit => 0
  ) into strict v_project_context;

  if v_project_context #>> '{result,visit,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000012'
     or v_project_context #>> '{result,sections,lead,state}' <> 'linked'
     or not (v_project_context #> '{result,sections,lead}') ? 'client_ref'
     or v_project_context #> '{result,sections,lead,client_ref}' is distinct
       from 'null'::jsonb then
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: project context invalid';
  end if;

  select private.agent_p2_site_visit_attention_v1(
    '8e100000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    (select permission_snapshot_revision
     from agent_site_visit_nullable_client_authority),
    array[
      'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
    ]::text[],
    '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
    'booked_appointments',
    (select read_at - interval '20 minutes'
     from agent_site_visit_nullable_client_clock),
    (select read_at from agent_site_visit_nullable_client_clock),
    array['scheduled']::text[],
    false,
    pg_catalog.date_trunc(
      'milliseconds', pg_catalog.statement_timestamp()
    ),
    501,
    25
  ) into strict v_attention;

  if pg_catalog.jsonb_array_length(v_attention -> 'cards') <> 2
     or v_attention #>> '{cards,0,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000010'
     or v_attention #>> '{cards,1,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000012'
     or v_attention::text like
       '%8e500000-0000-4000-8000-000000000011%' then
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: attention invalid';
  end if;

  begin
    perform public.read_agent_site_visit_context_as_system(
      p_request_id => 'agent-site-visit-runtime-foreign-client-context',
      p_actor_user_id => '8e100000-0000-4000-8000-000000000001',
      p_company_id => '8e000000-0000-4000-8000-000000000001',
      p_oauth_grant_id => '8e130000-0000-4000-8000-000000000001',
      p_oauth_client_id => '8e120000-0000-4000-8000-000000000001',
      p_grant_revision =>
        pg_catalog.md5('agent-site-visit-nullable-client-grant'),
      p_granted_scope_ceiling => array[
        'ops.customers.read', 'ops.files.read', 'ops.jobs.read',
        'ops.schedule.read', 'ops.site_visits.read'
      ]::text[],
      p_permission_snapshot_revision => (
        select permission_snapshot_revision
        from agent_site_visit_nullable_client_authority
      ),
      p_registered_permission_keys => array[
        'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
      ]::text[],
      p_capability_id => 'get_site_visit_context',
      p_capability_revision => 'get_site_visit_context:2026-08-22.v1',
      p_capability_manifest_revision =>
        '2026-08-22.capability-manifest.v8',
      p_required_oauth_scopes => array[
        'ops.customers.read', 'ops.jobs.read', 'ops.schedule.read',
        'ops.site_visits.read'
      ]::text[],
      p_resolved_permission_scopes =>
        '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
      p_site_visit_id => '8e500000-0000-4000-8000-000000000011',
      p_expected_anchor => 'opportunity',
      p_expected_opportunity_id =>
        '8e300000-0000-4000-8000-000000000010',
      p_sections => array['booking', 'lead']::text[],
      p_source_limit => 501,
      p_artifact_source_limit => 501,
      p_checklist_answer_limit => 0,
      p_checklist_answer_fetch_limit => 0,
      p_timeline_limit => 0
    );
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: foreign client accepted';
  exception
    when sqlstate 'P0002' then
      if sqlerrm <> 'agent_site_visit_not_found_or_not_visible' then
        raise;
      end if;
  end;
end;
$nullable_client_visibility_contract$;

rollback;
