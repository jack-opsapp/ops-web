begin;

-- PostgreSQL 17 rollback-only runtime proof for the Task 13 deck-design
-- source fence and fixed geometry read RPC. The caller must apply both Task 13
-- migrations to a production-typed disposable schema before running this file.
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local request.jwt.claim.role = 'service_role';

insert into public.companies(id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Alpha'),
  ('22222222-2222-2222-2222-222222222222', 'Bravo');
insert into public.users(id, company_id, first_name, last_name) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  'Deck',
  'Operator'
);
insert into public.user_permission_overrides (
  user_id, company_id, permission, scope, granted
) values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'calendar.view', 'all', true
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'clients.view', 'all', true
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'deck_builder.view', 'all', true
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'pipeline.view', 'all', true
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'projects.view', 'all', true
  );
insert into public.clients(id, company_id, name) values
  (
    'dddddddd-dddd-dddd-dddd-dddddddddd01',
    '11111111-1111-1111-1111-111111111111',
    'Alpha client'
  ),
  (
    'dddddddd-dddd-dddd-dddd-dddddddddd02',
    '22222222-2222-2222-2222-222222222222',
    'Bravo client'
  );
insert into public.opportunities(
  id, company_id, client_id, assigned_to, title
) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddd01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Assigned opportunity'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddd01', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Hidden opportunity'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03', '22222222-2222-2222-2222-222222222222', 'dddddddd-dddd-dddd-dddd-dddddddddd02', null, 'Foreign opportunity');
insert into public.projects(id, company_id, title) values
  ('ffffffff-ffff-ffff-ffff-fffffffffff1', '11111111-1111-1111-1111-111111111111', 'Assigned project'),
  ('ffffffff-ffff-ffff-ffff-fffffffffff2', '11111111-1111-1111-1111-111111111111', 'Hidden project'),
  ('ffffffff-ffff-ffff-ffff-fffffffffff3', '22222222-2222-2222-2222-222222222222', 'Foreign project');
insert into public.project_tasks(
  id, company_id, project_id, team_member_ids
) values
  ('f1000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-fffffffffff1', array['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']),
  ('f1000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-fffffffffff2', array['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']),
  ('f1000000-0000-4000-8000-000000000003', '22222222-2222-2222-2222-222222222222', 'ffffffff-ffff-ffff-ffff-fffffffffff3', array[]::text[]);

insert into public.site_visits(
  id, company_id, opportunity_id, client_ref, assignee_ids, created_by,
  scheduled_at
) values
  ('20000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'dddddddd-dddd-dddd-dddd-dddddddddd01', array['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'], 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', timestamptz '2026-08-29 12:00:00+00'),
  ('20000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'dddddddd-dddd-dddd-dddd-dddddddddd01', array['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'], 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', timestamptz '2026-08-29 13:00:00+00'),
  ('20000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', null, null, '{}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', timestamptz '2026-08-29 14:00:00+00'),
  ('20000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03', 'dddddddd-dddd-dddd-dddd-dddddddddd02', '{}', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', timestamptz '2026-08-29 15:00:00+00'),
  ('20000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', null, null, '{}', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', timestamptz '2026-08-29 16:00:00+00');

insert into public.deck_designs(
  id, company_id, project_id, opportunity_id, title, drawing_data
) values
  ('10000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-fffffffffff1', null, 'Carly deck', '{"surfaces":[{"area":125.5,"id":"main"}],"edges":[{"length":42.25,"type":"railing"}]}'::jsonb),
  ('10000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', null, null, 'Parentless', '{"surfaces":[]}'::jsonb),
  ('10000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-fffffffffff1', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', 'Conflicting parent', '{"surfaces":[]}'::jsonb),
  ('10000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'ffffffff-ffff-ffff-ffff-fffffffffff3', null, 'Bravo deck', '{"surfaces":[]}'::jsonb),
  ('10000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', null, null, 'Matrix deck', '{"surfaces":[]}'::jsonb),
  ('10000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', null, null, 'Alternate deck', '{"surfaces":[]}'::jsonb),
  ('10000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', null, null, 'Tenant matrix deck', '{"surfaces":[]}'::jsonb),
  ('10000000-0000-0000-0000-000000000018', '11111111-1111-1111-1111-111111111111', null, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'Opportunity-only', '{"surfaces":[]}'::jsonb);

insert into public.site_visit_artifacts(
  id, company_id, site_visit_id, deck_design_id, opportunity_id,
  kind, source, created_by, title, captured_at
) values
  ('30000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'deck_design', 'deck_builder', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Carly bridge', statement_timestamp()),
  ('30000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', null, 'deck_design', 'deck_builder', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Parentless bridge', statement_timestamp()),
  ('30000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', 'deck_design', 'deck_builder', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Conflict bridge', statement_timestamp()),
  ('30000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', '20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03', 'deck_design', 'deck_builder', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Bravo bridge', statement_timestamp()),
  ('30000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006', null, 'deck_design', 'deck_builder', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Matrix bridge', statement_timestamp());

insert into private.agent_operational_read_revisions(company_id, source_revision)
values
  ('11111111-1111-1111-1111-111111111111', 7),
  ('22222222-2222-2222-2222-222222222222', 11);
create temporary table task13_legacy_baseline(source_revision bigint not null);
insert into task13_legacy_baseline
select source_revision
from private.agent_operational_read_revisions
where company_id = '11111111-1111-1111-1111-111111111111';
insert into private.agent_read_domain_revisions(company_id, domain)
select company_id, domain
from (values
  ('11111111-1111-1111-1111-111111111111'::uuid),
  ('22222222-2222-2222-2222-222222222222'::uuid)
) company(company_id)
cross join (values ('artifacts'), ('deck_designs'), ('site_visits')) domain(domain)
on conflict(company_id, domain) do nothing;

insert into private.mcp_oauth_clients(
  client_id, client_name, redirect_uris, token_endpoint_auth_method,
  grant_types, response_types, scope, registration_source,
  scope_ceiling, consent_catalog_revision, exposure_revision
) values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'Deck geometry runtime',
  array['https://deck-geometry-runtime.ops.invalid/callback']::text[],
  'none',
  array['authorization_code', 'refresh_token']::text[],
  array['code']::text[],
  'ops.customers.read ops.files.read ops.jobs.read ops.schedule.read ops.site_visits.read',
  'manual',
  array[
    'ops.customers.read', 'ops.files.read', 'ops.jobs.read',
    'ops.schedule.read', 'ops.site_visits.read'
  ]::text[],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);
insert into private.mcp_oauth_grants(
  id, user_id, company_id, client_id, scopes, revision, accepted_labels,
  consent_catalog_revision, exposure_revision
) values (
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  array[
    'ops.customers.read', 'ops.files.read', 'ops.jobs.read',
    'ops.schedule.read', 'ops.site_visits.read'
  ]::text[],
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  private.mcp_oauth_labels_for_scopes(
    array[
      'ops.customers.read', 'ops.files.read', 'ops.jobs.read',
      'ops.schedule.read', 'ops.site_visits.read'
    ]::text[],
    '2026-08-22.mcp-consent-catalog.v1'
  ),
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);
insert into private.mcp_oauth_clients(
  client_id, client_name, redirect_uris, token_endpoint_auth_method,
  grant_types, response_types, scope, registration_source,
  scope_ceiling, consent_catalog_revision, exposure_revision
) values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbc',
  'Deck geometry runtime restricted',
  array['https://deck-geometry-runtime-restricted.ops.invalid/callback']::text[],
  'none',
  array['authorization_code', 'refresh_token']::text[],
  array['code']::text[],
  'ops.files.read ops.jobs.read ops.site_visits.read',
  'manual',
  array[
    'ops.files.read', 'ops.jobs.read', 'ops.site_visits.read'
  ]::text[],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);
insert into private.mcp_oauth_grants(
  id, user_id, company_id, client_id, scopes, revision, accepted_labels,
  consent_catalog_revision, exposure_revision
) values (
  'cccccccc-cccc-cccc-cccc-cccccccccccd',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbc',
  array[
    'ops.files.read', 'ops.jobs.read', 'ops.site_visits.read'
  ]::text[],
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  private.mcp_oauth_labels_for_scopes(
    array[
      'ops.files.read', 'ops.jobs.read', 'ops.site_visits.read'
    ]::text[],
    '2026-08-22.mcp-consent-catalog.v1'
  ),
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);

create temporary table task13_context(snapshot text not null);
insert into task13_context(snapshot)
select permission_snapshot_revision
from private.resolve_agent_actor_authority(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  array['calendar.view','clients.view','deck_builder.view','pipeline.view','projects.view']
);

create function pg_temp.task13_job_call(
  p_company_id uuid,
  p_design_id uuid,
  p_project_id uuid,
  p_snapshot text,
  p_source_limit integer default 501
) returns jsonb
language sql security definer set search_path = ''
as $function$
  select public.read_agent_deck_design_geometry_as_system(
    'task13-runtime',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    p_company_id,
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    array['ops.customers.read','ops.files.read','ops.jobs.read','ops.schedule.read','ops.site_visits.read'],
    p_snapshot,
    array['calendar.view','clients.view','deck_builder.view','pipeline.view','projects.view'],
    '2026-08-22.capability-manifest.v8',
    'get_deck_design_geometry',
    'get_deck_design_geometry:2026-08-22.v1',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'variant_key', 'job_artifact_project',
      'required_oauth_scopes',
        array['ops.files.read','ops.jobs.read']::text[],
      'resolved_permission_scopes', pg_catalog.jsonb_build_object(
        'deck_builder.view', 'all',
        'pipeline.view', 'all',
        'projects.view', 'all'
      ),
      'satisfied_permission_group_indexes', array[0,1]::integer[]
    )),
    'job_artifact',
    'project',
    p_project_id,
    null,
    private.agent_p2_deck_design_ref(p_company_id, p_design_id),
    p_source_limit
  )
$function$;

create function pg_temp.task13_opportunity_call(
  p_design_id uuid,
  p_opportunity_id uuid,
  p_snapshot text
) returns jsonb
language sql security definer set search_path = ''
as $function$
  select public.read_agent_deck_design_geometry_as_system(
    'task13-runtime',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    array['ops.customers.read','ops.files.read','ops.jobs.read','ops.schedule.read','ops.site_visits.read'],
    p_snapshot,
    array['calendar.view','clients.view','deck_builder.view','pipeline.view','projects.view'],
    '2026-08-22.capability-manifest.v8',
    'get_deck_design_geometry',
    'get_deck_design_geometry:2026-08-22.v1',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'variant_key', 'job_artifact_opportunity',
      'required_oauth_scopes',
        array['ops.files.read','ops.jobs.read']::text[],
      'resolved_permission_scopes', pg_catalog.jsonb_build_object(
        'deck_builder.view', 'all',
        'pipeline.view', 'all',
        'projects.view', 'all'
      ),
      'satisfied_permission_group_indexes', array[0,1]::integer[]
    )),
    'job_artifact',
    'opportunity',
    p_opportunity_id,
    null,
    private.agent_p2_deck_design_ref(
      '11111111-1111-1111-1111-111111111111', p_design_id
    ),
    501
  )
$function$;

create function pg_temp.task13_project_without_pipeline_call(
  p_design_id uuid,
  p_project_id uuid,
  p_snapshot text
) returns jsonb
language sql security definer set search_path = ''
as $function$
  select public.read_agent_deck_design_geometry_as_system(
    'task13-runtime',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    array['ops.customers.read','ops.files.read','ops.jobs.read','ops.schedule.read','ops.site_visits.read'],
    p_snapshot,
    array['calendar.view','clients.view','deck_builder.view','pipeline.view','projects.view'],
    '2026-08-22.capability-manifest.v8',
    'get_deck_design_geometry',
    'get_deck_design_geometry:2026-08-22.v1',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'variant_key', 'job_artifact_project',
      'required_oauth_scopes',
        array['ops.files.read','ops.jobs.read']::text[],
      'resolved_permission_scopes', pg_catalog.jsonb_build_object(
        'deck_builder.view', 'all',
        'projects.view', 'all'
      ),
      'satisfied_permission_group_indexes', array[0]::integer[]
    )),
    'job_artifact',
    'project',
    p_project_id,
    null,
    private.agent_p2_deck_design_ref(
      '11111111-1111-1111-1111-111111111111', p_design_id
    ),
    501
  )
$function$;

create function pg_temp.task13_opportunity_without_projects_call(
  p_design_id uuid,
  p_opportunity_id uuid,
  p_snapshot text
) returns jsonb
language sql security definer set search_path = ''
as $function$
  select public.read_agent_deck_design_geometry_as_system(
    'task13-runtime',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    array['ops.customers.read','ops.files.read','ops.jobs.read','ops.schedule.read','ops.site_visits.read'],
    p_snapshot,
    array['calendar.view','clients.view','deck_builder.view','pipeline.view','projects.view'],
    '2026-08-22.capability-manifest.v8',
    'get_deck_design_geometry',
    'get_deck_design_geometry:2026-08-22.v1',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'variant_key', 'job_artifact_opportunity',
      'required_oauth_scopes',
        array['ops.files.read','ops.jobs.read']::text[],
      'resolved_permission_scopes', pg_catalog.jsonb_build_object(
        'deck_builder.view', 'all',
        'pipeline.view', 'all'
      ),
      'satisfied_permission_group_indexes', array[0]::integer[]
    )),
    'job_artifact',
    'opportunity',
    p_opportunity_id,
    null,
    private.agent_p2_deck_design_ref(
      '11111111-1111-1111-1111-111111111111', p_design_id
    ),
    501
  )
$function$;

create function pg_temp.task13_linked_candidate(
  p_deck_scope text,
  p_pipeline_scope text,
  p_groups integer[]
) returns jsonb
language sql immutable set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'variant_key', 'site_visit_artifact_linked',
    'required_oauth_scopes', array[
      'ops.customers.read',
      'ops.files.read',
      'ops.jobs.read',
      'ops.schedule.read',
      'ops.site_visits.read'
    ]::text[],
    'resolved_permission_scopes', pg_catalog.jsonb_build_object(
      'calendar.view', 'all',
      'clients.view', 'all',
      'deck_builder.view', p_deck_scope,
      'pipeline.view', p_pipeline_scope,
      'projects.view', 'all'
    ),
    'satisfied_permission_group_indexes', p_groups
  )
$function$;

create function pg_temp.task13_unlinked_candidate(
  p_deck_scope text,
  p_pipeline_scope text,
  p_groups integer[]
) returns jsonb
language sql immutable set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'variant_key', 'site_visit_artifact_unlinked',
    'required_oauth_scopes', array[
      'ops.files.read',
      'ops.jobs.read',
      'ops.site_visits.read'
    ]::text[],
    'resolved_permission_scopes', pg_catalog.jsonb_build_object(
      'deck_builder.view', p_deck_scope,
      'pipeline.view', p_pipeline_scope,
      'projects.view', 'all'
    ),
    'satisfied_permission_group_indexes', p_groups
  )
$function$;

create function pg_temp.task13_site_candidates_call(
  p_design_id uuid,
  p_visit_id uuid,
  p_snapshot text,
  p_grant_id uuid,
  p_client_id uuid,
  p_scope_ceiling text[],
  p_candidates jsonb
) returns jsonb
language sql security definer set search_path = ''
as $function$
  select public.read_agent_deck_design_geometry_as_system(
    'task13-runtime',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    p_grant_id,
    p_client_id,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    p_scope_ceiling,
    p_snapshot,
    array['calendar.view','clients.view','deck_builder.view','pipeline.view','projects.view'],
    '2026-08-22.capability-manifest.v8',
    'get_deck_design_geometry',
    'get_deck_design_geometry:2026-08-22.v1',
    p_candidates,
    'site_visit_artifact',
    null,
    null,
    p_visit_id,
    private.agent_p2_deck_design_ref(
      '11111111-1111-1111-1111-111111111111', p_design_id
    ),
    501
  )
$function$;

create function pg_temp.task13_site_call(
  p_design_id uuid,
  p_visit_id uuid,
  p_snapshot text,
  p_deck_scope text,
  p_pipeline_scope text,
  p_groups integer[]
) returns jsonb
language sql security definer set search_path = ''
as $function$
  select pg_temp.task13_site_candidates_call(
    p_design_id,
    p_visit_id,
    p_snapshot,
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    array['ops.customers.read','ops.files.read','ops.jobs.read','ops.schedule.read','ops.site_visits.read'],
    case when p_pipeline_scope = 'all' then pg_catalog.jsonb_build_array(
      pg_temp.task13_linked_candidate(
        p_deck_scope, p_pipeline_scope, p_groups
      ),
      pg_temp.task13_unlinked_candidate(
        p_deck_scope, p_pipeline_scope, p_groups
      )
    ) else pg_catalog.jsonb_build_array(
      pg_temp.task13_linked_candidate(
        p_deck_scope, p_pipeline_scope, p_groups
      )
    ) end
  )
$function$;

-- The fixed public surface is executable only by service_role.
do $proof$
begin
  if pg_catalog.has_function_privilege(
    'authenticated',
    'public.read_agent_deck_design_geometry_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,uuid,uuid,text,integer)',
    'EXECUTE'
  ) then
    raise exception 'authenticated execute';
  end if;
end
$proof$;

-- The in-function role check remains fixed even if a privileged SQL caller
-- attempts to invoke the definer surface under a non-service JWT claim.
do $proof$
begin
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_temp.task13_job_call(
    '11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001',
    'ffffffff-ffff-ffff-ffff-fffffffffff1',
    snapshot
  ) from task13_context;
  raise exception 'authenticated execute';
exception when insufficient_privilege then null;
end
$proof$;
set local request.jwt.claim.role = 'service_role';

-- Closed terminal-state validation rejects a request whose physical bound
-- differs from the fixed repository contract.
do $proof$
begin
  perform pg_temp.task13_job_call(
    '11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001',
    'ffffffff-ffff-ffff-ffff-fffffffffff1',
    snapshot,
    500
  ) from task13_context;
  raise exception 'invalid geometry request accepted';
exception when invalid_parameter_value then null;
end
$proof$;

-- Canonical geometry, fractional numbers, exact hash, and exact v6/v7-aware
-- four-domain source vector are proved from a successful job read.
do $proof$
declare
  v_result jsonb;
  v_expected_source text;
  v_expected_revisions jsonb;
begin
  select pg_temp.task13_job_call(
    '11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001',
    'ffffffff-ffff-ffff-ffff-fffffffffff1',
    snapshot
  ) into v_result from task13_context;
  v_expected_source := private.agent_p2_deck_geometry_canonical_json(
    (select drawing_data from public.deck_designs
      where id = '10000000-0000-0000-0000-000000000001')
  );
  if v_result ->> 'drawing_source' is distinct from v_expected_source
     or v_result ->> 'drawing_content_hash' is distinct from
       'sha256:' || pg_catalog.encode(
         extensions.digest(pg_catalog.convert_to(v_expected_source, 'UTF8'), 'sha256'),
         'hex'
       ) then
    raise exception 'content hash mismatch';
  end if;
  if private.agent_p2_deck_geometry_canonical_json(
       '{"value":1.00}'::jsonb
     ) is distinct from '{"value":1}' then
    raise exception 'content hash mismatch: numeric scale was not canonical';
  end if;
  select pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'domain', expected.domain,
             'source_revision', case expected.domain
               when 'legacy_operational' then operational.source_revision
               else revision.source_revision
             end
           ) order by expected.ordinal
         )
    into v_expected_revisions
  from (values
    ('artifacts', 1), ('deck_designs', 2),
    ('legacy_operational', 3), ('site_visits', 4)
  ) expected(domain, ordinal)
  left join private.agent_read_domain_revisions revision
    on revision.company_id = '11111111-1111-1111-1111-111111111111'
   and revision.domain = expected.domain
  left join private.agent_operational_read_revisions operational
    on operational.company_id = '11111111-1111-1111-1111-111111111111';
  if v_result -> 'source_revisions' is distinct from v_expected_revisions then
    raise exception 'source revision vector mismatch';
  end if;
  if v_result ->> 'selected_authorization_variant' is distinct from
       'job_artifact_project'
     or v_result -> 'required_oauth_scopes' is distinct from
       '["ops.files.read","ops.jobs.read"]'::jsonb
     or v_result -> 'resolved_permission_scopes' is distinct from
       '{"deck_builder.view":"all","pipeline.view":"all","projects.view":"all"}'::jsonb
     or v_result -> 'satisfied_permission_group_indexes' is distinct from
       '[0,1]'::jsonb
     or v_result -> 'design_parents' is distinct from
       '{"opportunity_id":null,"project_id":"ffffffff-ffff-ffff-ffff-fffffffffff1"}'::jsonb
     or v_result -> 'source_inspected' is distinct from
       '{"artifact_bridges":0,"deck_designs":1,"jobs":1,"site_visits":0,"visit_opportunities":0}'::jsonb then
    raise exception 'selected authorization snapshot mismatch';
  end if;
end
$proof$;

-- A converted design may still be selected from its retained opportunity
-- artifact anchor when both that anchor and the current project are visible.
do $proof$
declare
  v_result jsonb;
begin
  select pg_temp.task13_opportunity_call(
    '10000000-0000-0000-0000-000000000003',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
    snapshot
  ) into v_result from task13_context;
  if v_result ->> 'authority_path' <> 'job_opportunity'
     or v_result ->> 'selected_authorization_variant' <>
          'job_artifact_opportunity'
     or v_result -> 'design_parents' is distinct from
       '{"opportunity_id":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02","project_id":"ffffffff-ffff-ffff-ffff-fffffffffff1"}'::jsonb
     or v_result -> 'source_inspected' ->> 'jobs' <> '2' then
    raise exception 'converted provenance rejected';
  end if;
end
$proof$;

-- A genuinely unlinked visit needs no customer or schedule OAuth scope. The
-- server selects the unlinked candidate from current linkage and echoes only
-- that candidate's exact proof fields.
do $proof$
declare
  v_result jsonb;
begin
  select pg_temp.task13_site_candidates_call(
    '10000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000003',
    snapshot,
    'cccccccc-cccc-cccc-cccc-cccccccccccd',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbc',
    array['ops.files.read','ops.jobs.read','ops.site_visits.read'],
    pg_catalog.jsonb_build_array(
      pg_temp.task13_unlinked_candidate('all', 'all', array[0,1,2])
    )
  ) into v_result from task13_context;
  if v_result ->> 'authority_path' <> 'site_visit_unlinked'
     or v_result ->> 'selected_authorization_variant' <>
          'site_visit_artifact_unlinked'
     or v_result -> 'required_oauth_scopes' is distinct from
       '["ops.files.read","ops.jobs.read","ops.site_visits.read"]'::jsonb
     or v_result -> 'design_parents' is distinct from
       '{"opportunity_id":null,"project_id":null}'::jsonb
     or v_result -> 'source_inspected' ->> 'jobs' <> '0' then
    raise exception 'unlinked authorization snapshot mismatch';
  end if;
end
$proof$;

-- Candidate selection is server-derived. A valid but wrong-path singleton
-- fails closed instead of letting the caller label the current relationship.
do $proof$
begin
  perform pg_temp.task13_site_candidates_call(
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    snapshot,
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    array['ops.customers.read','ops.files.read','ops.jobs.read','ops.schedule.read','ops.site_visits.read'],
    pg_catalog.jsonb_build_array(
      pg_temp.task13_unlinked_candidate('all', 'all', array[0,1,2])
    )
  ) from task13_context;
  raise exception 'unlinked candidate authorized a linked visit';
exception when no_data_found then null;
end
$proof$;

do $proof$
begin
  perform pg_temp.task13_site_candidates_call(
    '10000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000003',
    snapshot,
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    array['ops.customers.read','ops.files.read','ops.jobs.read','ops.schedule.read','ops.site_visits.read'],
    pg_catalog.jsonb_build_array(
      pg_temp.task13_linked_candidate('all', 'all', array[0,1,2])
    )
  ) from task13_context;
  raise exception 'linked candidate authorized an unlinked visit';
exception when no_data_found then null;
end
$proof$;

-- Duplicate, globally out-of-order, malformed, and literal-policy-invalid
-- candidate vectors are closed invalid requests.
do $proof$
declare
  v_linked jsonb := pg_temp.task13_linked_candidate(
    'all', 'all', array[0,1,2]
  );
begin
  perform pg_temp.task13_site_candidates_call(
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    snapshot,
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    array['ops.customers.read','ops.files.read','ops.jobs.read','ops.schedule.read','ops.site_visits.read'],
    pg_catalog.jsonb_build_array(v_linked, v_linked)
  ) from task13_context;
  raise exception 'duplicate authorization candidate accepted';
exception when invalid_parameter_value then null;
end
$proof$;

do $proof$
begin
  perform pg_temp.task13_site_candidates_call(
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    snapshot,
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    array['ops.customers.read','ops.files.read','ops.jobs.read','ops.schedule.read','ops.site_visits.read'],
    pg_catalog.jsonb_build_array(
      pg_temp.task13_unlinked_candidate('all', 'all', array[0,1,2]),
      pg_temp.task13_linked_candidate('all', 'all', array[0,1,2])
    )
  ) from task13_context;
  raise exception 'noncanonical authorization candidate order accepted';
exception when invalid_parameter_value then null;
end
$proof$;

do $proof$
begin
  perform pg_temp.task13_site_candidates_call(
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    snapshot,
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    array['ops.customers.read','ops.files.read','ops.jobs.read','ops.schedule.read','ops.site_visits.read'],
    pg_catalog.jsonb_build_array(
      pg_temp.task13_linked_candidate('all', 'all', array[0,1,2]) ||
        '{"unexpected":true}'::jsonb
    )
  ) from task13_context;
  raise exception 'malformed authorization candidate accepted';
exception when invalid_parameter_value then null;
end
$proof$;

do $proof$
begin
  perform pg_temp.task13_site_candidates_call(
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    snapshot,
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    array['ops.customers.read','ops.files.read','ops.jobs.read','ops.schedule.read','ops.site_visits.read'],
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_set(
        pg_temp.task13_linked_candidate('all', 'all', array[0,1,2]),
        '{satisfied_permission_group_indexes}',
        '[0]'::jsonb
      )
    )
  ) from task13_context;
  raise exception 'literal-policy-invalid authorization accepted';
exception when invalid_parameter_value then null;
end
$proof$;

-- Current permissions outside a variant's allowed scope set are not part of
-- the nominal authorization bytes. Optional disallowed scopes must neither
-- broaden authority nor hide a legitimate base-group read.
update public.user_permission_overrides
set scope = 'own'
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and permission = 'pipeline.view';
truncate task13_context;
insert into task13_context
select permission_snapshot_revision
from private.resolve_agent_actor_authority(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  array['calendar.view','clients.view','deck_builder.view','pipeline.view','projects.view']
);
do $proof$
declare
  v_result jsonb;
begin
  select pg_temp.task13_project_without_pipeline_call(
    '10000000-0000-0000-0000-000000000001',
    'ffffffff-ffff-ffff-ffff-fffffffffff1',
    snapshot
  ) into v_result from task13_context;
  if v_result -> 'resolved_permission_scopes' is distinct from
       '{"deck_builder.view":"all","projects.view":"all"}'::jsonb
     or v_result -> 'satisfied_permission_group_indexes' is distinct from
       '[0]'::jsonb then
    raise exception 'disallowed optional pipeline scope hid base job read';
  end if;
end
$proof$;

update public.user_permission_overrides
set scope = case permission
  when 'pipeline.view' then 'all'
  when 'projects.view' then 'own'
end
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and permission in ('pipeline.view', 'projects.view');
truncate task13_context;
insert into task13_context
select permission_snapshot_revision
from private.resolve_agent_actor_authority(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  array['calendar.view','clients.view','deck_builder.view','pipeline.view','projects.view']
);
do $proof$
declare
  v_result jsonb;
begin
  select pg_temp.task13_opportunity_without_projects_call(
    '10000000-0000-0000-0000-000000000018',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
    snapshot
  ) into v_result from task13_context;
  if v_result -> 'resolved_permission_scopes' is distinct from
       '{"deck_builder.view":"all","pipeline.view":"all"}'::jsonb
     or v_result -> 'satisfied_permission_group_indexes' is distinct from
       '[0]'::jsonb then
    raise exception 'disallowed optional projects scope hid base job read';
  end if;
end
$proof$;

do $proof$
declare
  v_result jsonb;
  v_candidate jsonb := pg_catalog.jsonb_build_object(
    'variant_key', 'site_visit_artifact_linked',
    'required_oauth_scopes', array[
      'ops.customers.read','ops.files.read','ops.jobs.read',
      'ops.schedule.read','ops.site_visits.read'
    ]::text[],
    'resolved_permission_scopes', pg_catalog.jsonb_build_object(
      'calendar.view','all',
      'clients.view','all',
      'deck_builder.view','all',
      'pipeline.view','all'
    ),
    'satisfied_permission_group_indexes', array[0,2]::integer[]
  );
begin
  select pg_temp.task13_site_candidates_call(
    '10000000-0000-0000-0000-000000000006',
    '20000000-0000-0000-0000-000000000001',
    snapshot,
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    array['ops.customers.read','ops.files.read','ops.jobs.read','ops.schedule.read','ops.site_visits.read'],
    pg_catalog.jsonb_build_array(v_candidate)
  ) into v_result from task13_context;
  if v_result ->> 'selected_authorization_variant' <>
       'site_visit_artifact_linked'
     or v_result -> 'resolved_permission_scopes' is distinct from
       v_candidate -> 'resolved_permission_scopes' then
    raise exception 'disallowed optional projects scope hid linked visit';
  end if;
end
$proof$;

do $proof$
declare
  v_result jsonb;
  v_candidate jsonb := pg_catalog.jsonb_build_object(
    'variant_key', 'site_visit_artifact_unlinked',
    'required_oauth_scopes',
      array['ops.files.read','ops.jobs.read','ops.site_visits.read']::text[],
    'resolved_permission_scopes', pg_catalog.jsonb_build_object(
      'deck_builder.view','all',
      'pipeline.view','all'
    ),
    'satisfied_permission_group_indexes', array[0,2]::integer[]
  );
begin
  select pg_temp.task13_site_candidates_call(
    '10000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000003',
    snapshot,
    'cccccccc-cccc-cccc-cccc-cccccccccccd',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbc',
    array['ops.files.read','ops.jobs.read','ops.site_visits.read'],
    pg_catalog.jsonb_build_array(v_candidate)
  ) into v_result from task13_context;
  if v_result ->> 'selected_authorization_variant' <>
       'site_visit_artifact_unlinked'
     or v_result -> 'resolved_permission_scopes' is distinct from
       v_candidate -> 'resolved_permission_scopes' then
    raise exception 'disallowed optional projects scope hid unlinked visit';
  end if;
end
$proof$;

update public.user_permission_overrides
set scope = 'all'
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and permission = 'projects.view';
truncate task13_context;
insert into task13_context
select permission_snapshot_revision
from private.resolve_agent_actor_authority(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  array['calendar.view','clients.view','deck_builder.view','pipeline.view','projects.view']
);

-- Every relationship is tenant equal. Wrong-tenant authority never degrades
-- into a cross-company lookup.
do $proof$
begin
  perform pg_temp.task13_job_call(
    '22222222-2222-2222-2222-222222222222',
    '10000000-0000-0000-0000-000000000004',
    'ffffffff-ffff-ffff-ffff-fffffffffff3',
    snapshot
  ) from task13_context;
  raise exception 'wrong tenant geometry leaked';
exception when no_data_found then null;
end
$proof$;

-- OAuth grant revocation and actor-policy revision changes are re-proved in
-- the same statement as the geometry source.
update private.mcp_oauth_grants
set revoked_at = statement_timestamp()
where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
do $proof$
begin
  perform pg_temp.task13_job_call(
    '11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001',
    'ffffffff-ffff-ffff-ffff-fffffffffff1',
    snapshot
  ) from task13_context;
  raise exception 'revoked grant accepted';
exception when no_data_found then null;
end
$proof$;
update private.mcp_oauth_grants set revoked_at = null
where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

update public.user_permission_overrides
set scope = 'assigned'
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and permission = 'projects.view';
do $proof$
begin
  perform pg_temp.task13_job_call(
    '11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001',
    'ffffffff-ffff-ffff-ffff-fffffffffff1',
    snapshot
  ) from task13_context;
  raise exception 'stale actor policy accepted';
exception when no_data_found then null;
end
$proof$;
update public.user_permission_overrides
set scope = 'all'
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and permission = 'projects.view';

-- Soft-deleted designs and bridges are never source candidates.
update public.deck_designs set deleted_at = statement_timestamp()
where id = '10000000-0000-0000-0000-000000000001';
do $proof$
begin
  perform pg_temp.task13_job_call(
    '11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001',
    'ffffffff-ffff-ffff-ffff-fffffffffff1',
    snapshot
  ) from task13_context;
  raise exception 'inactive design leaked';
exception when no_data_found then null;
end
$proof$;
update public.deck_designs set deleted_at = null
where id = '10000000-0000-0000-0000-000000000001';

update public.site_visit_artifacts set deleted_at = statement_timestamp()
where id = '30000000-0000-0000-0000-000000000001';
do $proof$
begin
  perform pg_temp.task13_site_call(
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    snapshot,
    'all', 'all', array[0,1,2]
  ) from task13_context;
  raise exception 'inactive bridge leaked';
exception when no_data_found then null;
end
$proof$;
update public.site_visit_artifacts set deleted_at = null
where id = '30000000-0000-0000-0000-000000000001';

-- Parentless designs require deck_builder=all; retained conflicting parents
-- are additional authority dependencies after a design is converted.
update public.user_permission_overrides
set scope = 'assigned'
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and permission = 'deck_builder.view';
truncate task13_context;
insert into task13_context
select permission_snapshot_revision
from private.resolve_agent_actor_authority(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  array['calendar.view','clients.view','deck_builder.view','pipeline.view','projects.view']
);
do $proof$
begin
  perform pg_temp.task13_site_call(
    '10000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000003',
    snapshot,
    'assigned', 'all', array[0,1]
  ) from task13_context;
  raise exception 'parentless assigned design leaked';
exception when no_data_found then null;
end
$proof$;
update public.user_permission_overrides
set scope = case permission
  when 'deck_builder.view' then 'all'
  when 'pipeline.view' then 'assigned'
end
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and permission in ('deck_builder.view', 'pipeline.view');
truncate task13_context;
insert into task13_context
select permission_snapshot_revision
from private.resolve_agent_actor_authority(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  array['calendar.view','clients.view','deck_builder.view','pipeline.view','projects.view']
);
do $proof$
begin
  perform pg_temp.task13_site_call(
    '10000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000001',
    snapshot,
    'all', 'assigned', array[0,1,2]
  ) from task13_context;
  raise exception 'inaccessible conflicting parent accepted';
exception when no_data_found then null;
end
$proof$;
update public.user_permission_overrides
set scope = 'all'
where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and permission = 'pipeline.view';
truncate task13_context;
insert into task13_context
select permission_snapshot_revision
from private.resolve_agent_actor_authority(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  array['calendar.view','clients.view','deck_builder.view','pipeline.view','projects.view']
);

-- Artifact/design company integrity is enforced from either write path while
-- opportunity provenance from a pre-conversion visit remains valid.
do $proof$
begin
  insert into public.site_visit_artifacts(
    id, company_id, site_visit_id, deck_design_id, kind, source, created_by,
    captured_at
  ) values (
    '30000000-0000-0000-0000-000000000010',
    '22222222-2222-2222-2222-222222222222',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'deck_design', 'deck_builder', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    pg_catalog.statement_timestamp()
  );
  raise exception 'cross-company artifact link accepted';
exception when check_violation then null;
end
$proof$;
do $proof$
begin
  update public.deck_designs
  set company_id = '22222222-2222-2222-2222-222222222222'
  where id = '10000000-0000-0000-0000-000000000001';
  raise exception 'cross-company design retenant accepted';
exception when check_violation then null;
end
$proof$;
do $proof$
begin
  insert into public.site_visit_artifacts(
    id, company_id, site_visit_id, deck_design_id, opportunity_id,
    kind, source, created_by, captured_at
  ) values (
    '30000000-0000-0000-0000-000000000011',
    '11111111-1111-1111-1111-111111111111',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
    'deck_design', 'deck_builder', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    pg_catalog.statement_timestamp()
  );
exception when others then
  raise exception 'converted provenance rejected: %', sqlerrm;
end
$proof$;

-- The deck matrix advances deck_designs for every reader-visible field and
-- advances artifacts only for the listing projection fields.
do $proof$
declare
  v_c1_before jsonb;
  v_c2_before jsonb;
  v_c1_after jsonb;
  v_c2_after jsonb;
  v_deck_before bigint;
  v_artifact_before bigint;
begin
  select pg_catalog.jsonb_object_agg(domain, source_revision)
    into v_c1_before
  from private.agent_read_domain_revisions
  where company_id = '11111111-1111-1111-1111-111111111111';
  select pg_catalog.jsonb_object_agg(domain, source_revision)
    into v_c2_before
  from private.agent_read_domain_revisions
  where company_id = '22222222-2222-2222-2222-222222222222';
  update public.deck_designs
  set company_id = '22222222-2222-2222-2222-222222222222'
  where id = '10000000-0000-0000-0000-000000000007';
  select pg_catalog.jsonb_object_agg(domain, source_revision)
    into v_c1_after
  from private.agent_read_domain_revisions
  where company_id = '11111111-1111-1111-1111-111111111111';
  select pg_catalog.jsonb_object_agg(domain, source_revision)
    into v_c2_after
  from private.agent_read_domain_revisions
  where company_id = '22222222-2222-2222-2222-222222222222';
  if (v_c1_after ->> 'deck_designs')::bigint <>
       (v_c1_before ->> 'deck_designs')::bigint + 1
     or (v_c2_after ->> 'deck_designs')::bigint <>
       (v_c2_before ->> 'deck_designs')::bigint + 1
     or (v_c1_after ->> 'artifacts')::bigint <>
       (v_c1_before ->> 'artifacts')::bigint + 1
     or (v_c2_after ->> 'artifacts')::bigint <>
       (v_c2_before ->> 'artifacts')::bigint + 1 then
    raise exception 'deck field matrix incomplete: company_id fan-out';
  end if;
  update public.deck_designs
  set company_id = '11111111-1111-1111-1111-111111111111'
  where id = '10000000-0000-0000-0000-000000000007';

  select source_revision into v_deck_before
  from private.agent_read_domain_revisions
  where company_id = '11111111-1111-1111-1111-111111111111'
    and domain = 'deck_designs';
  select source_revision into v_artifact_before
  from private.agent_read_domain_revisions
  where company_id = '11111111-1111-1111-1111-111111111111'
    and domain = 'artifacts';
  update public.deck_designs
  set id = '10000000-0000-0000-0000-000000000008'
  where id = '10000000-0000-0000-0000-000000000007';
  if (select source_revision from private.agent_read_domain_revisions
      where company_id='11111111-1111-1111-1111-111111111111'
        and domain='deck_designs') is distinct from v_deck_before
     or (select source_revision from private.agent_read_domain_revisions
      where company_id='11111111-1111-1111-1111-111111111111'
        and domain='artifacts') <> v_artifact_before + 1 then
    raise exception 'deck field matrix incomplete: id selectivity';
  end if;

  select source_revision into v_deck_before
  from private.agent_read_domain_revisions
  where company_id = '11111111-1111-1111-1111-111111111111'
    and domain = 'deck_designs';
  select source_revision into v_artifact_before
  from private.agent_read_domain_revisions
  where company_id = '11111111-1111-1111-1111-111111111111'
    and domain = 'artifacts';
  insert into public.deck_designs(id, company_id, drawing_data) values (
    '10000000-0000-0000-0000-000000000009',
    '11111111-1111-1111-1111-111111111111',
    '{}'
  );
  delete from public.deck_designs
  where id = '10000000-0000-0000-0000-000000000009';
  if (select source_revision from private.agent_read_domain_revisions
      where company_id='11111111-1111-1111-1111-111111111111'
        and domain='deck_designs') <> v_deck_before + 2
     or (select source_revision from private.agent_read_domain_revisions
      where company_id='11111111-1111-1111-1111-111111111111'
        and domain='artifacts') <> v_artifact_before + 2 then
    raise exception 'deck field matrix incomplete: insert/delete';
  end if;
end
$proof$;

do $proof$
declare
  v_field text;
  v_before_deck bigint;
  v_before_artifact bigint;
  v_after_deck bigint;
  v_after_artifact bigint;
begin
  foreach v_field in array array[
    'project_id','opportunity_id','title','drawing_data','version',
    'created_at','updated_at','deleted_at'
  ] loop
    select source_revision into v_before_deck
    from private.agent_read_domain_revisions
    where company_id = '11111111-1111-1111-1111-111111111111'
      and domain = 'deck_designs';
    select source_revision into v_before_artifact
    from private.agent_read_domain_revisions
    where company_id = '11111111-1111-1111-1111-111111111111'
      and domain = 'artifacts';
    if v_field = 'updated_at' then
      execute 'alter table public.deck_designs disable trigger deck_designs_set_updated_at';
    end if;
    execute case v_field
      when 'project_id' then $$update public.deck_designs set project_id='ffffffff-ffff-ffff-ffff-fffffffffff1' where id='10000000-0000-0000-0000-000000000005'$$
      when 'opportunity_id' then $$update public.deck_designs set opportunity_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01' where id='10000000-0000-0000-0000-000000000005'$$
      when 'title' then $$update public.deck_designs set title=title||'x' where id='10000000-0000-0000-0000-000000000005'$$
      when 'drawing_data' then $$update public.deck_designs set drawing_data='{"changed":true}' where id='10000000-0000-0000-0000-000000000005'$$
      when 'version' then $$update public.deck_designs set version=version+1 where id='10000000-0000-0000-0000-000000000005'$$
      when 'created_at' then $$update public.deck_designs set created_at=created_at+interval '1 second' where id='10000000-0000-0000-0000-000000000005'$$
      when 'updated_at' then $$update public.deck_designs set updated_at=updated_at+interval '1 second' where id='10000000-0000-0000-0000-000000000005'$$
      when 'deleted_at' then $$update public.deck_designs set deleted_at=statement_timestamp() where id='10000000-0000-0000-0000-000000000005'$$
    end;
    if v_field = 'updated_at' then
      execute 'alter table public.deck_designs enable trigger deck_designs_set_updated_at';
    end if;
    select source_revision into v_after_deck
    from private.agent_read_domain_revisions
    where company_id = '11111111-1111-1111-1111-111111111111'
      and domain = 'deck_designs';
    select source_revision into v_after_artifact
    from private.agent_read_domain_revisions
    where company_id = '11111111-1111-1111-1111-111111111111'
      and domain = 'artifacts';
    if v_after_deck <> v_before_deck + 1
       or v_after_artifact <> v_before_artifact + (
         case when v_field in ('drawing_data','version') then 0 else 1 end
       ) then
      raise exception
        'deck field matrix incomplete: %, deck %->%, artifact %->%',
        v_field,
        v_before_deck,
        v_after_deck,
        v_before_artifact,
        v_after_artifact;
    end if;
  end loop;

  select source_revision into v_before_deck
  from private.agent_read_domain_revisions
  where company_id = '11111111-1111-1111-1111-111111111111'
    and domain = 'deck_designs';
  update public.deck_designs set deleted_at = null
  where id = '10000000-0000-0000-0000-000000000005';
  if (select source_revision from private.agent_read_domain_revisions
      where company_id='11111111-1111-1111-1111-111111111111'
        and domain='deck_designs') <> v_before_deck + 1 then
    raise exception 'deck field matrix incomplete: active transition';
  end if;
end
$proof$;

-- Canonical bridge changes advance all relevant domains; irrelevant bridge
-- metadata is deliberately excluded from the cursor matrix.
do $proof$
declare
  v_field text;
  v_before jsonb;
  v_after jsonb;
  v_c2_before jsonb;
  v_c2_after jsonb;
begin
  foreach v_field in array array[
    'site_visit_id','deck_design_id','opportunity_id','kind','source',
    'captured_at','included_in_project_review','updated_at','deleted_at'
  ] loop
    select pg_catalog.jsonb_object_agg(domain, source_revision)
      into v_before
    from private.agent_read_domain_revisions
    where company_id = '11111111-1111-1111-1111-111111111111';
    execute case v_field
      when 'site_visit_id' then $$update public.site_visit_artifacts set site_visit_id='20000000-0000-0000-0000-000000000002' where id='30000000-0000-0000-0000-000000000005'$$
      when 'deck_design_id' then $$update public.site_visit_artifacts set deck_design_id='10000000-0000-0000-0000-000000000001' where id='30000000-0000-0000-0000-000000000005'$$
      when 'opportunity_id' then $$update public.site_visit_artifacts set opportunity_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01' where id='30000000-0000-0000-0000-000000000005'$$
      when 'kind' then $$update public.site_visit_artifacts set kind='note' where id='30000000-0000-0000-0000-000000000005'$$
      when 'source' then $$update public.site_visit_artifacts set source='legacy_import' where id='30000000-0000-0000-0000-000000000005'$$
      when 'captured_at' then $$update public.site_visit_artifacts set captured_at=coalesce(captured_at,statement_timestamp())+interval '1 second' where id='30000000-0000-0000-0000-000000000005'$$
      when 'included_in_project_review' then $$update public.site_visit_artifacts set included_in_project_review=not included_in_project_review where id='30000000-0000-0000-0000-000000000005'$$
      when 'updated_at' then $$update public.site_visit_artifacts set updated_at=updated_at+interval '1 second' where id='30000000-0000-0000-0000-000000000005'$$
      when 'deleted_at' then $$update public.site_visit_artifacts set deleted_at=statement_timestamp() where id='30000000-0000-0000-0000-000000000005'$$
    end;
    select pg_catalog.jsonb_object_agg(domain, source_revision)
      into v_after
    from private.agent_read_domain_revisions
    where company_id = '11111111-1111-1111-1111-111111111111';
    if (v_after ->> 'artifacts')::bigint <>
         (v_before ->> 'artifacts')::bigint + 1
       or (v_after ->> 'deck_designs')::bigint <>
         (v_before ->> 'deck_designs')::bigint + 1
       or (v_after ->> 'site_visits')::bigint <>
         (v_before ->> 'site_visits')::bigint + 1 then
      raise exception 'bridge field matrix incomplete: %', v_field;
    end if;
    execute case v_field
      when 'site_visit_id' then $$update public.site_visit_artifacts set site_visit_id='20000000-0000-0000-0000-000000000001' where id='30000000-0000-0000-0000-000000000005'$$
      when 'deck_design_id' then $$update public.site_visit_artifacts set deck_design_id='10000000-0000-0000-0000-000000000006' where id='30000000-0000-0000-0000-000000000005'$$
      when 'opportunity_id' then $$update public.site_visit_artifacts set opportunity_id=null where id='30000000-0000-0000-0000-000000000005'$$
      when 'kind' then $$update public.site_visit_artifacts set kind='deck_design' where id='30000000-0000-0000-0000-000000000005'$$
      when 'source' then $$update public.site_visit_artifacts set source='deck_builder' where id='30000000-0000-0000-0000-000000000005'$$
      when 'captured_at' then $$update public.site_visit_artifacts set captured_at=captured_at-interval '1 second' where id='30000000-0000-0000-0000-000000000005'$$
      when 'included_in_project_review' then $$update public.site_visit_artifacts set included_in_project_review=not included_in_project_review where id='30000000-0000-0000-0000-000000000005'$$
      when 'updated_at' then $$update public.site_visit_artifacts set updated_at=updated_at-interval '1 second' where id='30000000-0000-0000-0000-000000000005'$$
      when 'deleted_at' then $$update public.site_visit_artifacts set deleted_at=null where id='30000000-0000-0000-0000-000000000005'$$
    end;
  end loop;

  select pg_catalog.jsonb_object_agg(domain, source_revision)
    into v_before
  from private.agent_read_domain_revisions
  where company_id = '11111111-1111-1111-1111-111111111111';
  select pg_catalog.jsonb_object_agg(domain, source_revision)
    into v_c2_before
  from private.agent_read_domain_revisions
  where company_id = '22222222-2222-2222-2222-222222222222';
  update public.site_visit_artifacts
  set company_id = '22222222-2222-2222-2222-222222222222',
      site_visit_id = '20000000-0000-0000-0000-000000000004',
      deck_design_id = '10000000-0000-0000-0000-000000000004'
  where id = '30000000-0000-0000-0000-000000000005';
  select pg_catalog.jsonb_object_agg(domain, source_revision)
    into v_after
  from private.agent_read_domain_revisions
  where company_id = '11111111-1111-1111-1111-111111111111';
  select pg_catalog.jsonb_object_agg(domain, source_revision)
    into v_c2_after
  from private.agent_read_domain_revisions
  where company_id = '22222222-2222-2222-2222-222222222222';
  if exists (
    select 1
    from pg_catalog.unnest(array['artifacts','deck_designs','site_visits']) domain
    where (v_after ->> domain)::bigint <>
            (v_before ->> domain)::bigint + 1
       or (v_c2_after ->> domain)::bigint <>
            (v_c2_before ->> domain)::bigint + 1
  ) then
    raise exception 'bridge field matrix incomplete: company_id fan-out';
  end if;
  update public.site_visit_artifacts
  set company_id = '11111111-1111-1111-1111-111111111111',
      site_visit_id = '20000000-0000-0000-0000-000000000001',
      deck_design_id = '10000000-0000-0000-0000-000000000006'
  where id = '30000000-0000-0000-0000-000000000005';

  select pg_catalog.jsonb_object_agg(domain, source_revision)
    into v_before
  from private.agent_read_domain_revisions
  where company_id = '11111111-1111-1111-1111-111111111111';
  insert into public.site_visit_artifacts(
    id, company_id, site_visit_id, deck_design_id, kind, source, created_by,
    captured_at
  ) values (
    '30000000-0000-0000-0000-000000000012',
    '11111111-1111-1111-1111-111111111111',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000006',
    'deck_design', 'deck_builder', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    pg_catalog.statement_timestamp()
  );
  delete from public.site_visit_artifacts
  where id = '30000000-0000-0000-0000-000000000012';
  select pg_catalog.jsonb_object_agg(domain, source_revision)
    into v_after
  from private.agent_read_domain_revisions
  where company_id = '11111111-1111-1111-1111-111111111111';
  if exists (
    select 1
    from pg_catalog.unnest(array['artifacts','deck_designs','site_visits']) domain
    where (v_after ->> domain)::bigint <>
      (v_before ->> domain)::bigint + 2
  ) then
    raise exception 'bridge field matrix incomplete: insert/delete';
  end if;
end
$proof$;

do $proof$
declare
  v_field text;
  v_before_artifact bigint;
  v_before_site bigint;
  v_after_artifact bigint;
  v_after_site bigint;
  v_expected_artifact integer;
  v_c1_before jsonb;
  v_c2_before jsonb;
  v_c1_after jsonb;
  v_c2_after jsonb;
begin
  foreach v_field in array array[
    'id','opportunity_id','project_id','project_ref','client_id','client_ref',
    'scheduled_at','duration_minutes','assignee_ids','status','completed_at',
    'notes','measurements','created_by','created_at','updated_at','deleted_at',
    'booked_at'
  ] loop
    select source_revision into v_before_artifact
    from private.agent_read_domain_revisions
    where company_id = '11111111-1111-1111-1111-111111111111'
      and domain = 'artifacts';
    select source_revision into v_before_site
    from private.agent_read_domain_revisions
    where company_id = '11111111-1111-1111-1111-111111111111'
      and domain = 'site_visits';
    execute case v_field
      when 'id' then $$update public.site_visits set id='20000000-0000-0000-0000-000000000006' where id='20000000-0000-0000-0000-000000000005'$$
      when 'opportunity_id' then $$update public.site_visits set opportunity_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01' where id='20000000-0000-0000-0000-000000000005'$$
      when 'project_id' then $$update public.site_visits set project_id='ffffffff-ffff-ffff-ffff-fffffffffff1' where id='20000000-0000-0000-0000-000000000005'$$
      when 'project_ref' then $$update public.site_visits set project_ref='ffffffff-ffff-ffff-ffff-fffffffffff1' where id='20000000-0000-0000-0000-000000000005'$$
      when 'client_id' then $$update public.site_visits set client_id='dddddddd-dddd-dddd-dddd-dddddddddd01' where id='20000000-0000-0000-0000-000000000005'$$
      when 'client_ref' then $$update public.site_visits set client_ref='dddddddd-dddd-dddd-dddd-dddddddddd01' where id='20000000-0000-0000-0000-000000000005'$$
      when 'scheduled_at' then $$update public.site_visits set scheduled_at=statement_timestamp() where id='20000000-0000-0000-0000-000000000005'$$
      when 'duration_minutes' then $$update public.site_visits set duration_minutes=61 where id='20000000-0000-0000-0000-000000000005'$$
      when 'assignee_ids' then $$update public.site_visits set assignee_ids=array['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'] where id='20000000-0000-0000-0000-000000000005'$$
      when 'status' then $$update public.site_visits set status='completed' where id='20000000-0000-0000-0000-000000000005'$$
      when 'completed_at' then $$update public.site_visits set completed_at=statement_timestamp() where id='20000000-0000-0000-0000-000000000005'$$
      when 'notes' then $$update public.site_visits set notes='matrix' where id='20000000-0000-0000-0000-000000000005'$$
      when 'measurements' then $$update public.site_visits set measurements='{"width":12.5}' where id='20000000-0000-0000-0000-000000000005'$$
      when 'created_by' then $$update public.site_visits set created_by='cccccccc-cccc-cccc-cccc-cccccccccccc' where id='20000000-0000-0000-0000-000000000005'$$
      when 'created_at' then $$update public.site_visits set created_at=created_at+interval '1 second' where id='20000000-0000-0000-0000-000000000005'$$
      when 'updated_at' then $$update public.site_visits set updated_at=updated_at+interval '1 second' where id='20000000-0000-0000-0000-000000000005'$$
      when 'deleted_at' then $$update public.site_visits set deleted_at=statement_timestamp() where id='20000000-0000-0000-0000-000000000005'$$
      when 'booked_at' then $$update public.site_visits set booked_at=statement_timestamp() where id='20000000-0000-0000-0000-000000000005'$$
    end;
    select source_revision into v_after_artifact
    from private.agent_read_domain_revisions
    where company_id = '11111111-1111-1111-1111-111111111111'
      and domain = 'artifacts';
    select source_revision into v_after_site
    from private.agent_read_domain_revisions
    where company_id = '11111111-1111-1111-1111-111111111111'
      and domain = 'site_visits';
    v_expected_artifact := case when v_field in (
      'id','opportunity_id','project_id','project_ref','client_id',
      'client_ref','assignee_ids','created_by','deleted_at'
    ) then 1 else 0 end;
    if v_after_site <> v_before_site + 1
       or v_after_artifact <> v_before_artifact + v_expected_artifact then
      raise exception 'site visit field matrix incomplete: %', v_field;
    end if;
    execute case v_field
      when 'id' then $$update public.site_visits set id='20000000-0000-0000-0000-000000000005' where id='20000000-0000-0000-0000-000000000006'$$
      when 'opportunity_id' then $$update public.site_visits set opportunity_id=null where id='20000000-0000-0000-0000-000000000005'$$
      when 'project_id' then $$update public.site_visits set project_id=null where id='20000000-0000-0000-0000-000000000005'$$
      when 'project_ref' then $$update public.site_visits set project_ref=null where id='20000000-0000-0000-0000-000000000005'$$
      when 'client_id' then $$update public.site_visits set client_id=null where id='20000000-0000-0000-0000-000000000005'$$
      when 'client_ref' then $$update public.site_visits set client_ref=null where id='20000000-0000-0000-0000-000000000005'$$
      when 'scheduled_at' then $$update public.site_visits set scheduled_at=scheduled_at-interval '1 second' where id='20000000-0000-0000-0000-000000000005'$$
      when 'duration_minutes' then $$update public.site_visits set duration_minutes=60 where id='20000000-0000-0000-0000-000000000005'$$
      when 'assignee_ids' then $$update public.site_visits set assignee_ids='{}' where id='20000000-0000-0000-0000-000000000005'$$
      when 'status' then $$update public.site_visits set status='scheduled' where id='20000000-0000-0000-0000-000000000005'$$
      when 'completed_at' then $$update public.site_visits set completed_at=null where id='20000000-0000-0000-0000-000000000005'$$
      when 'notes' then $$update public.site_visits set notes=null where id='20000000-0000-0000-0000-000000000005'$$
      when 'measurements' then $$update public.site_visits set measurements=null where id='20000000-0000-0000-0000-000000000005'$$
      when 'created_by' then $$update public.site_visits set created_by='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' where id='20000000-0000-0000-0000-000000000005'$$
      when 'created_at' then $$update public.site_visits set created_at=created_at-interval '1 second' where id='20000000-0000-0000-0000-000000000005'$$
      when 'updated_at' then $$update public.site_visits set updated_at=updated_at-interval '1 second' where id='20000000-0000-0000-0000-000000000005'$$
      when 'deleted_at' then $$update public.site_visits set deleted_at=null where id='20000000-0000-0000-0000-000000000005'$$
      when 'booked_at' then $$update public.site_visits set booked_at=null where id='20000000-0000-0000-0000-000000000005'$$
    end;
  end loop;

  select pg_catalog.jsonb_object_agg(domain, source_revision)
    into v_c1_before
  from private.agent_read_domain_revisions
  where company_id = '11111111-1111-1111-1111-111111111111';
  select pg_catalog.jsonb_object_agg(domain, source_revision)
    into v_c2_before
  from private.agent_read_domain_revisions
  where company_id = '22222222-2222-2222-2222-222222222222';
  update public.site_visits
  set company_id = '22222222-2222-2222-2222-222222222222'
  where id = '20000000-0000-0000-0000-000000000005';
  select pg_catalog.jsonb_object_agg(domain, source_revision)
    into v_c1_after
  from private.agent_read_domain_revisions
  where company_id = '11111111-1111-1111-1111-111111111111';
  select pg_catalog.jsonb_object_agg(domain, source_revision)
    into v_c2_after
  from private.agent_read_domain_revisions
  where company_id = '22222222-2222-2222-2222-222222222222';
  if (v_c1_after ->> 'site_visits')::bigint <>
       (v_c1_before ->> 'site_visits')::bigint + 1
     or (v_c2_after ->> 'site_visits')::bigint <>
       (v_c2_before ->> 'site_visits')::bigint + 1
     or (v_c1_after ->> 'artifacts')::bigint <>
       (v_c1_before ->> 'artifacts')::bigint + 1
     or (v_c2_after ->> 'artifacts')::bigint <>
       (v_c2_before ->> 'artifacts')::bigint + 1 then
    raise exception 'site visit field matrix incomplete: company fan-out';
  end if;
  update public.site_visits
  set company_id = '11111111-1111-1111-1111-111111111111'
  where id = '20000000-0000-0000-0000-000000000005';

  select source_revision into v_before_artifact
  from private.agent_read_domain_revisions
  where company_id='11111111-1111-1111-1111-111111111111'
    and domain='artifacts';
  select source_revision into v_before_site
  from private.agent_read_domain_revisions
  where company_id='11111111-1111-1111-1111-111111111111'
    and domain='site_visits';
  insert into public.site_visits(id, company_id, created_by, scheduled_at) values (
    '20000000-0000-0000-0000-000000000099',
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    timestamptz '2026-08-29 17:00:00+00'
  );
  delete from public.site_visits
  where id = '20000000-0000-0000-0000-000000000099';
  if (select source_revision from private.agent_read_domain_revisions
      where company_id='11111111-1111-1111-1111-111111111111'
        and domain='site_visits') <> v_before_site + 2
     or (select source_revision from private.agent_read_domain_revisions
      where company_id='11111111-1111-1111-1111-111111111111'
        and domain='artifacts') <> v_before_artifact + 2 then
    raise exception 'site visit field matrix incomplete: insert/delete';
  end if;
end
$proof$;

-- Irrelevant columns do not churn v8 source revisions, and the frozen v6/v7
-- cursor remains unchanged across every Task 13 source write.
do $proof$
declare
  v_before jsonb;
  v_after jsonb;
  v_legacy bigint;
begin
  select pg_catalog.jsonb_object_agg(domain, source_revision)
    into v_before
  from private.agent_read_domain_revisions
  where company_id = '11111111-1111-1111-1111-111111111111';
  select source_revision into v_legacy from task13_legacy_baseline;
  update public.deck_designs set thumbnail_url = 'ignored'
  where id = '10000000-0000-0000-0000-000000000006';
  update public.site_visit_artifacts set thumbnail_url = 'ignored'
  where id = '30000000-0000-0000-0000-000000000001';
  update public.site_visits set internal_notes = 'ignored'
  where id = '20000000-0000-0000-0000-000000000001';
  select pg_catalog.jsonb_object_agg(domain, source_revision)
    into v_after
  from private.agent_read_domain_revisions
  where company_id = '11111111-1111-1111-1111-111111111111';
  if v_after is distinct from v_before then
    raise exception 'irrelevant column advanced revision';
  end if;
  if (select source_revision from private.agent_operational_read_revisions
      where company_id = '11111111-1111-1111-1111-111111111111')
       is distinct from v_legacy then
    raise exception 'legacy cursor revision changed';
  end if;
end
$proof$;

-- An ordinary table writer can perform DML; the owner-only trigger helper
-- still advances the private revision fence.
set local role authenticated;
do $proof$
begin
  insert into public.deck_designs(
    id, company_id, title, drawing_data
  ) values (
    '10000000-0000-0000-0000-000000000099',
    '11111111-1111-1111-1111-111111111111',
    'Ordinary writer', '{}'
  );
exception when others then
  raise exception 'ordinary writer dml failed: %', sqlerrm;
end
$proof$;
reset role;
set local request.jwt.claim.role = 'service_role';

-- More than 500 candidate designs/bridges fail closed, and the production-
-- shaped hostile lookup remains on the reviewed partial composite index.
insert into public.deck_designs(id, company_id, drawing_data)
select md5('task13-noise-design-' || value)::uuid,
       '11111111-1111-1111-1111-111111111111',
       '{}'
from pg_catalog.generate_series(1, 501) value;
insert into public.site_visit_artifacts(
  id, company_id, site_visit_id, deck_design_id, kind, source, created_by,
  captured_at
)
select md5('task13-noise-artifact-' || value)::uuid,
       '11111111-1111-1111-1111-111111111111',
       '20000000-0000-0000-0000-000000000002',
       md5('task13-noise-design-' || value)::uuid,
       'deck_design', 'deck_builder', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       pg_catalog.statement_timestamp()
from pg_catalog.generate_series(1, 501) value;
analyze public.site_visit_artifacts;
set local enable_seqscan = off;
do $proof$
declare
  v_plan jsonb;
begin
  execute $explain$
    explain (analyze true, buffers true, format json, costs true)
    select artifact.id
    from public.site_visit_artifacts artifact
    where lower(artifact.company_id) = '11111111-1111-1111-1111-111111111111'
      and artifact.site_visit_id = '20000000-0000-0000-0000-000000000002'
      and artifact.kind = 'deck_design'
      and artifact.source = 'deck_builder'
      and artifact.deck_design_id is not null
      and artifact.deleted_at is null
    order by artifact.deck_design_id, artifact.id
    limit 501
  $explain$ into v_plan;
  if v_plan::text not like '%idx_site_visit_artifacts_agent_deck_bridge_v1%' then
    raise exception 'deck bridge lookup plan did not use index';
  end if;
  if v_plan::text like '%"Node Type": "Seq Scan"%' then
    raise exception 'deck bridge lookup plan executed a sequential scan';
  end if;
  if (v_plan -> 0 -> 'Plan' ->> 'Plan Rows')::integer > 501 then
    raise exception 'deck bridge lookup plan exceeded 501 rows';
  end if;
  if (v_plan -> 0 -> 'Plan' ->> 'Actual Rows')::integer > 501 then
    raise exception 'deck bridge lookup plan exceeded physical work bound';
  end if;
end
$proof$;
reset enable_seqscan;

do $proof$
begin
  perform pg_temp.task13_site_call(
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    snapshot,
    'all', 'all', array[0,1,2]
  ) from task13_context;
  raise exception 'source row bound not enforced';
exception when sqlstate '54000' then null;
end
$proof$;

-- One canonical source over 1 MiB is independently rejected.
insert into public.deck_designs(
  id, company_id, project_id, title, drawing_data
) values (
  '10000000-0000-0000-0000-000000000098',
  '11111111-1111-1111-1111-111111111111',
  'ffffffff-ffff-ffff-ffff-fffffffffff1',
  'Oversize',
  pg_catalog.jsonb_build_object('blob', pg_catalog.repeat('x', 1048577))
);
do $proof$
begin
  perform pg_temp.task13_job_call(
    '11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000098',
    'ffffffff-ffff-ffff-ffff-fffffffffff1',
    snapshot
  ) from task13_context;
  raise exception 'source byte bound not enforced';
exception when sqlstate '54000' then null;
end
$proof$;

-- Replay is executed by the companion command after contaminating the ACL;
-- this assertion names the failure contract checked after replay.
do $proof$
begin
  if not pg_catalog.has_function_privilege(
    'service_role',
    'public.read_agent_deck_design_geometry_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,uuid,uuid,text,integer)',
    'EXECUTE'
  ) then
    raise exception 'migration replay acl mismatch';
  end if;
end
$proof$;

rollback;
