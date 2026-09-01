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
) values
  (
    '8e100000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    'Nullable',
    'Client Reader',
    'nullable-client-site-visit@ops.invalid',
    '8e100000-0000-4000-8000-000000000001',
    true,
    false
  ),
  (
    '8e100000-0000-4000-8000-000000000002',
    '8e000000-0000-4000-8000-000000000001',
    'Assigned',
    'Client Reader',
    'assigned-client-site-visit@ops.invalid',
    '8e100000-0000-4000-8000-000000000002',
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
  ),
  (
    '8e110000-0000-4000-8000-000000000005',
    '8e100000-0000-4000-8000-000000000002',
    '8e000000-0000-4000-8000-000000000001',
    'calendar.view',
    'all',
    true
  ),
  (
    '8e110000-0000-4000-8000-000000000006',
    '8e100000-0000-4000-8000-000000000002',
    '8e000000-0000-4000-8000-000000000001',
    'clients.view',
    'assigned',
    true
  ),
  (
    '8e110000-0000-4000-8000-000000000007',
    '8e100000-0000-4000-8000-000000000002',
    '8e000000-0000-4000-8000-000000000001',
    'photos.view',
    'all',
    true
  ),
  (
    '8e110000-0000-4000-8000-000000000008',
    '8e100000-0000-4000-8000-000000000002',
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
) values
  (
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
  ),
  (
    '8e130000-0000-4000-8000-000000000002',
    '8e100000-0000-4000-8000-000000000002',
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
    pg_catalog.md5('agent-site-visit-hidden-client-grant')
  );

insert into public.clients (id, company_id, name) values
  (
    '8e200000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    'Visible opportunity customer'
  ),
  (
    '8e200000-0000-4000-8000-000000000002',
    '8e000000-0000-4000-8000-000000000002',
    'Foreign customer'
  ),
  (
    '8e200000-0000-4000-8000-000000000003',
    '8e000000-0000-4000-8000-000000000001',
    'Visible mismatched customer'
  );

insert into public.opportunities (
  id,
  company_id,
  client_id,
  client_ref,
  title
) values
  (
    '8e300000-0000-4000-8000-000000000010',
    '8e000000-0000-4000-8000-000000000001',
    null,
    null,
    'Production-shaped opportunity without resolved client'
  ),
  (
    '8e300000-0000-4000-8000-000000000015',
    '8e000000-0000-4000-8000-000000000001',
    '8e200000-0000-4000-8000-000000000001',
    '8e200000-0000-4000-8000-000000000001',
    'Visible opportunity client fallback'
  ),
  (
    '8e300000-0000-4000-8000-000000000016',
    '8e000000-0000-4000-8000-000000000001',
    '8e200000-0000-4000-8000-000000000002',
    '8e200000-0000-4000-8000-000000000002',
    'Foreign opportunity client'
  ),
  (
    '8e300000-0000-4000-8000-000000000017',
    '8e000000-0000-4000-8000-000000000001',
    '8e200000-0000-4000-8000-000000000001',
    '8e200000-0000-4000-8000-000000000001',
    'Visit and opportunity client mismatch'
  ),
  (
    '8e300000-0000-4000-8000-000000000018',
    '8e000000-0000-4000-8000-000000000001',
    '8e200000-0000-4000-8000-000000000003',
    '8e200000-0000-4000-8000-000000000001',
    'Opportunity client mirror conflict'
  ),
  (
    '8e300000-0000-4000-8000-000000000019',
    '8e000000-0000-4000-8000-000000000001',
    '8e200000-0000-4000-8000-000000000001',
    '8e200000-0000-4000-8000-000000000001',
    'Visit client mirror conflict'
  ),
  (
    '8e300000-0000-4000-8000-000000000020',
    '8e000000-0000-4000-8000-000000000001',
    null,
    '8e200000-0000-4000-8000-000000000001',
    'One-sided canonical opportunity client'
  ),
  (
    '8e300000-0000-4000-8000-000000000021',
    '8e000000-0000-4000-8000-000000000001',
    '8e200000-0000-4000-8000-000000000001',
    null,
    'One-sided legacy opportunity client'
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
  ),
  (
    '8e500000-0000-4000-8000-000000000013',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000010',
    'malformed-non-null-client-id',
    null,
    null,
    null,
    (select read_at + interval '2 hours'
     from agent_site_visit_nullable_client_clock),
    (select read_at - interval '9 minutes'
     from agent_site_visit_nullable_client_clock),
    60,
    array['8e100000-0000-4000-8000-000000000001']::text[],
    'scheduled',
    '8e100000-0000-4000-8000-000000000001',
    (select read_at - interval '1 hour'
     from agent_site_visit_nullable_client_clock)
  ),
  (
    '8e500000-0000-4000-8000-000000000014',
    '8e000000-0000-4000-8000-000000000001',
    null,
    '8e200000-0000-4000-8000-000000000002',
    '8e200000-0000-4000-8000-000000000002',
    null,
    null,
    (select read_at + interval '2 hours'
     from agent_site_visit_nullable_client_clock),
    null,
    60,
    array['8e100000-0000-4000-8000-000000000001']::text[],
    'scheduled',
    '8e100000-0000-4000-8000-000000000001',
    (select read_at - interval '8 minutes'
     from agent_site_visit_nullable_client_clock)
  ),
  (
    '8e500000-0000-4000-8000-000000000015',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000015',
    null,
    null,
    null,
    null,
    (select read_at + interval '2 hours'
     from agent_site_visit_nullable_client_clock),
    (select read_at - interval '8 minutes'
     from agent_site_visit_nullable_client_clock),
    60,
    array['8e100000-0000-4000-8000-000000000001']::text[],
    'scheduled',
    '8e100000-0000-4000-8000-000000000001',
    (select read_at - interval '1 hour'
     from agent_site_visit_nullable_client_clock)
  ),
  (
    '8e500000-0000-4000-8000-000000000016',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000016',
    null,
    null,
    null,
    null,
    (select read_at + interval '2 hours'
     from agent_site_visit_nullable_client_clock),
    (select read_at - interval '7 minutes'
     from agent_site_visit_nullable_client_clock),
    60,
    array['8e100000-0000-4000-8000-000000000001']::text[],
    'scheduled',
    '8e100000-0000-4000-8000-000000000001',
    (select read_at - interval '1 hour'
     from agent_site_visit_nullable_client_clock)
  ),
  (
    '8e500000-0000-4000-8000-000000000017',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000017',
    '8e200000-0000-4000-8000-000000000003',
    '8e200000-0000-4000-8000-000000000003',
    null,
    null,
    (select read_at + interval '2 hours'
     from agent_site_visit_nullable_client_clock),
    (select read_at - interval '6 minutes'
     from agent_site_visit_nullable_client_clock),
    60,
    array['8e100000-0000-4000-8000-000000000001']::text[],
    'scheduled',
    '8e100000-0000-4000-8000-000000000001',
    (select read_at - interval '1 hour'
     from agent_site_visit_nullable_client_clock)
  ),
  (
    '8e500000-0000-4000-8000-000000000018',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000018',
    null,
    null,
    null,
    null,
    (select read_at + interval '2 hours'
     from agent_site_visit_nullable_client_clock),
    (select read_at - interval '5 minutes'
     from agent_site_visit_nullable_client_clock),
    60,
    array['8e100000-0000-4000-8000-000000000001']::text[],
    'scheduled',
    '8e100000-0000-4000-8000-000000000001',
    (select read_at - interval '1 hour'
     from agent_site_visit_nullable_client_clock)
  ),
  (
    '8e500000-0000-4000-8000-000000000019',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000019',
    '8e200000-0000-4000-8000-000000000003',
    '8e200000-0000-4000-8000-000000000001',
    null,
    null,
    (select read_at + interval '2 hours'
     from agent_site_visit_nullable_client_clock),
    (select read_at - interval '4 minutes'
     from agent_site_visit_nullable_client_clock),
    60,
    array['8e100000-0000-4000-8000-000000000001']::text[],
    'scheduled',
    '8e100000-0000-4000-8000-000000000001',
    (select read_at - interval '1 hour'
     from agent_site_visit_nullable_client_clock)
  ),
  (
    '8e500000-0000-4000-8000-000000000020',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000015',
    '8e200000-0000-4000-8000-000000000001',
    '8e200000-0000-4000-8000-000000000001',
    null,
    null,
    (select read_at + interval '2 hours'
     from agent_site_visit_nullable_client_clock),
    (select read_at - interval '3 minutes'
     from agent_site_visit_nullable_client_clock),
    60,
    array['8e100000-0000-4000-8000-000000000001']::text[],
    'scheduled',
    '8e100000-0000-4000-8000-000000000001',
    (select read_at - interval '1 hour'
     from agent_site_visit_nullable_client_clock)
  ),
  (
    '8e500000-0000-4000-8000-000000000021',
    '8e000000-0000-4000-8000-000000000001',
    null,
    null,
    null,
    null,
    null,
    (select read_at + interval '2 hours'
     from agent_site_visit_nullable_client_clock),
    null,
    60,
    array['8e100000-0000-4000-8000-000000000001']::text[],
    'scheduled',
    '8e100000-0000-4000-8000-000000000001',
    (select read_at - interval '7 minutes'
     from agent_site_visit_nullable_client_clock)
  ),
  (
    '8e500000-0000-4000-8000-000000000022',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000010',
    null,
    '8e200000-0000-4000-8000-000000000001',
    null,
    null,
    (select read_at + interval '2 hours'
     from agent_site_visit_nullable_client_clock),
    (select read_at - interval '2 minutes'
     from agent_site_visit_nullable_client_clock),
    60,
    array['8e100000-0000-4000-8000-000000000001']::text[],
    'scheduled',
    '8e100000-0000-4000-8000-000000000001',
    (select read_at - interval '1 hour'
     from agent_site_visit_nullable_client_clock)
  ),
  (
    '8e500000-0000-4000-8000-000000000023',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000020',
    null,
    null,
    null,
    null,
    (select read_at + interval '2 hours'
     from agent_site_visit_nullable_client_clock),
    (select read_at - interval '1 minute'
     from agent_site_visit_nullable_client_clock),
    60,
    array['8e100000-0000-4000-8000-000000000001']::text[],
    'scheduled',
    '8e100000-0000-4000-8000-000000000001',
    (select read_at - interval '1 hour'
     from agent_site_visit_nullable_client_clock)
  ),
  (
    '8e500000-0000-4000-8000-000000000024',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000010',
    '8e200000-0000-4000-8000-000000000001',
    null,
    null,
    null,
    (select read_at + interval '2 hours'
     from agent_site_visit_nullable_client_clock),
    (select read_at - interval '45 seconds'
     from agent_site_visit_nullable_client_clock),
    60,
    array['8e100000-0000-4000-8000-000000000001']::text[],
    'scheduled',
    '8e100000-0000-4000-8000-000000000001',
    (select read_at - interval '1 hour'
     from agent_site_visit_nullable_client_clock)
  ),
  (
    '8e500000-0000-4000-8000-000000000025',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000021',
    null,
    null,
    null,
    null,
    (select read_at + interval '2 hours'
     from agent_site_visit_nullable_client_clock),
    (select read_at - interval '30 seconds'
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

create temporary table agent_site_visit_hidden_client_authority
on commit drop as
select authority.permission_snapshot_revision
from private.resolve_agent_actor_authority(
  '8e100000-0000-4000-8000-000000000002',
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
  v_unlinked_list jsonb;
  v_context jsonb;
  v_project_context jsonb;
  v_opportunity_client_context jsonb;
  v_ordinary_client_context jsonb;
  v_visit_only_client_context jsonb;
  v_opportunity_only_client_context jsonb;
  v_visit_legacy_client_context jsonb;
  v_opportunity_legacy_client_context jsonb;
  v_unlinked_context jsonb;
  v_attention jsonb;
  v_unlinked_attention jsonb;
  v_hidden_client_list jsonb;
  v_hidden_client_attention jsonb;
  v_hidden record;
begin
  if (
    select pg_catalog.count(*)
    from agent_site_visit_nullable_client_authority
    where permission_snapshot_revision ~ '^sha256:[0-9a-f]{64}$'
  ) <> 1 then
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: authority invalid';
  end if;

  if (
    select pg_catalog.count(*)
    from agent_site_visit_hidden_client_authority
    where permission_snapshot_revision ~ '^sha256:[0-9a-f]{64}$'
  ) <> 1 then
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: hidden authority invalid';
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
    p_opportunity_id => null,
    p_item_limit => 25,
    p_page_fetch_limit => 26,
    p_source_limit => 501,
    p_cursor_read_at => null,
    p_cursor_source_revisions => '[]'::jsonb,
    p_after_order_at => null,
    p_after_site_visit_id => null
  ) into strict v_list;

  if pg_catalog.jsonb_array_length(v_list -> 'rows') <> 8
     or v_list #>> '{rows,0,item,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000010'
     or v_list #>> '{rows,1,item,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000012'
     or v_list #>> '{rows,2,item,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000015'
     or v_list #>> '{rows,3,item,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000020'
     or v_list #>> '{rows,4,item,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000022'
     or v_list #>> '{rows,5,item,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000023'
     or v_list #>> '{rows,6,item,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000024'
     or v_list #>> '{rows,7,item,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000025'
     or v_list::text like '%8e500000-0000-4000-8000-000000000011%'
     or v_list::text like '%8e500000-0000-4000-8000-000000000013%'
     or v_list::text like '%8e500000-0000-4000-8000-000000000016%'
     or v_list::text like '%8e500000-0000-4000-8000-000000000017%'
     or v_list::text like '%8e500000-0000-4000-8000-000000000018%'
     or v_list::text like '%8e500000-0000-4000-8000-000000000019%' then
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: list invalid';
  end if;

  select public.read_agent_site_visits_as_system(
    p_request_id => 'agent-site-visit-runtime-unlinked-client-list',
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
    p_view_kind => 'visit_history',
    p_window_from => (
      select read_at - interval '20 minutes'
      from agent_site_visit_nullable_client_clock
    ),
    p_window_to => (
      select read_at from agent_site_visit_nullable_client_clock
    ),
    p_statuses => array['scheduled']::text[],
    p_include_unlinked => true,
    p_assignee_user_id => null,
    p_opportunity_id => null,
    p_item_limit => 25,
    p_page_fetch_limit => 26,
    p_source_limit => 501,
    p_cursor_read_at => null,
    p_cursor_source_revisions => '[]'::jsonb,
    p_after_order_at => null,
    p_after_site_visit_id => null
  ) into strict v_unlinked_list;

  if pg_catalog.jsonb_array_length(v_unlinked_list -> 'rows') <> 1
     or v_unlinked_list #>> '{rows,0,item,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000021'
     or v_unlinked_list::text like
       '%8e500000-0000-4000-8000-000000000014%' then
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: unlinked list invalid';
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

  select public.read_agent_site_visit_context_as_system(
    p_request_id => 'agent-site-visit-runtime-opportunity-client-fallback',
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
    p_site_visit_id => '8e500000-0000-4000-8000-000000000015',
    p_expected_anchor => 'opportunity',
    p_expected_opportunity_id =>
      '8e300000-0000-4000-8000-000000000015',
    p_sections => array['booking', 'lead']::text[],
    p_source_limit => 501,
    p_artifact_source_limit => 501,
    p_checklist_answer_limit => 0,
    p_checklist_answer_fetch_limit => 0,
    p_timeline_limit => 0
  ) into strict v_opportunity_client_context;

  if v_opportunity_client_context #>>
       '{result,visit,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000015'
     or v_opportunity_client_context #>>
       '{result,sections,lead,client_ref,id}' <>
       '8e200000-0000-4000-8000-000000000001' then
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: opportunity client invalid';
  end if;

  select public.read_agent_site_visit_context_as_system(
    p_request_id => 'agent-site-visit-runtime-ordinary-client',
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
    p_site_visit_id => '8e500000-0000-4000-8000-000000000020',
    p_expected_anchor => 'opportunity',
    p_expected_opportunity_id =>
      '8e300000-0000-4000-8000-000000000015',
    p_sections => array['booking', 'lead']::text[],
    p_source_limit => 501,
    p_artifact_source_limit => 501,
    p_checklist_answer_limit => 0,
    p_checklist_answer_fetch_limit => 0,
    p_timeline_limit => 0
  ) into strict v_ordinary_client_context;

  if v_ordinary_client_context #>>
       '{result,visit,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000020'
     or v_ordinary_client_context #>>
       '{result,sections,lead,client_ref,id}' <>
       '8e200000-0000-4000-8000-000000000001' then
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: ordinary client invalid';
  end if;

  select public.read_agent_site_visit_context_as_system(
    p_request_id => 'agent-site-visit-runtime-visit-only-one-sided-client',
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
    p_site_visit_id => '8e500000-0000-4000-8000-000000000022',
    p_expected_anchor => 'opportunity',
    p_expected_opportunity_id =>
      '8e300000-0000-4000-8000-000000000010',
    p_sections => array['booking', 'lead']::text[],
    p_source_limit => 501,
    p_artifact_source_limit => 501,
    p_checklist_answer_limit => 0,
    p_checklist_answer_fetch_limit => 0,
    p_timeline_limit => 0
  ) into strict v_visit_only_client_context;

  if v_visit_only_client_context #>>
       '{result,visit,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000022'
     or v_visit_only_client_context #>>
       '{result,sections,lead,client_ref,id}' <>
       '8e200000-0000-4000-8000-000000000001' then
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: visit-only client invalid';
  end if;

  select public.read_agent_site_visit_context_as_system(
    p_request_id => 'agent-site-visit-runtime-opportunity-only-one-sided-client',
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
    p_site_visit_id => '8e500000-0000-4000-8000-000000000023',
    p_expected_anchor => 'opportunity',
    p_expected_opportunity_id =>
      '8e300000-0000-4000-8000-000000000020',
    p_sections => array['booking', 'lead']::text[],
    p_source_limit => 501,
    p_artifact_source_limit => 501,
    p_checklist_answer_limit => 0,
    p_checklist_answer_fetch_limit => 0,
    p_timeline_limit => 0
  ) into strict v_opportunity_only_client_context;

  if v_opportunity_only_client_context #>>
       '{result,visit,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000023'
     or v_opportunity_only_client_context #>>
       '{result,sections,lead,client_ref,id}' <>
       '8e200000-0000-4000-8000-000000000001' then
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: opportunity-only client invalid';
  end if;

  select public.read_agent_site_visit_context_as_system(
    p_request_id => 'agent-site-visit-runtime-visit-legacy-client-id-only',
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
    p_site_visit_id => '8e500000-0000-4000-8000-000000000024',
    p_expected_anchor => 'opportunity',
    p_expected_opportunity_id =>
      '8e300000-0000-4000-8000-000000000010',
    p_sections => array['booking', 'lead']::text[],
    p_source_limit => 501,
    p_artifact_source_limit => 501,
    p_checklist_answer_limit => 0,
    p_checklist_answer_fetch_limit => 0,
    p_timeline_limit => 0
  ) into strict v_visit_legacy_client_context;

  if v_visit_legacy_client_context #>>
       '{result,visit,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000024'
     or v_visit_legacy_client_context #>>
       '{result,sections,lead,client_ref,id}' <>
       '8e200000-0000-4000-8000-000000000001' then
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: visit legacy client invalid';
  end if;

  select public.read_agent_site_visit_context_as_system(
    p_request_id => 'agent-site-visit-runtime-opportunity-legacy-client-id-only',
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
    p_site_visit_id => '8e500000-0000-4000-8000-000000000025',
    p_expected_anchor => 'opportunity',
    p_expected_opportunity_id =>
      '8e300000-0000-4000-8000-000000000021',
    p_sections => array['booking', 'lead']::text[],
    p_source_limit => 501,
    p_artifact_source_limit => 501,
    p_checklist_answer_limit => 0,
    p_checklist_answer_fetch_limit => 0,
    p_timeline_limit => 0
  ) into strict v_opportunity_legacy_client_context;

  if v_opportunity_legacy_client_context #>>
       '{result,visit,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000025'
     or v_opportunity_legacy_client_context #>>
       '{result,sections,lead,client_ref,id}' <>
       '8e200000-0000-4000-8000-000000000001' then
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: opportunity legacy client invalid';
  end if;

  select public.read_agent_site_visit_context_as_system(
    p_request_id => 'agent-site-visit-runtime-genuine-unlinked',
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
      'ops.jobs.read', 'ops.site_visits.read'
    ]::text[],
    p_resolved_permission_scopes => '{"pipeline.view":"all"}'::jsonb,
    p_site_visit_id => '8e500000-0000-4000-8000-000000000021',
    p_expected_anchor => 'unlinked',
    p_expected_opportunity_id => null,
    p_sections => array['booking']::text[],
    p_source_limit => 501,
    p_artifact_source_limit => 501,
    p_checklist_answer_limit => 0,
    p_checklist_answer_fetch_limit => 0,
    p_timeline_limit => 0
  ) into strict v_unlinked_context;

  if v_unlinked_context #>> '{result,visit,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000021'
     or v_unlinked_context #>> '{anchor}' <> 'unlinked' then
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: genuine unlinked invalid';
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

  if pg_catalog.jsonb_array_length(v_attention -> 'cards') <> 8
     or v_attention #>> '{cards,0,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000010'
     or v_attention #>> '{cards,1,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000012'
     or v_attention #>> '{cards,2,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000015'
     or v_attention #>> '{cards,3,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000020'
     or v_attention #>> '{cards,4,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000022'
     or v_attention #>> '{cards,5,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000023'
     or v_attention #>> '{cards,6,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000024'
     or v_attention #>> '{cards,7,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000025'
     or v_attention::text like
       '%8e500000-0000-4000-8000-000000000011%'
     or v_attention::text like
       '%8e500000-0000-4000-8000-000000000013%'
     or v_attention::text like
       '%8e500000-0000-4000-8000-000000000016%'
     or v_attention::text like
       '%8e500000-0000-4000-8000-000000000017%'
     or v_attention::text like
       '%8e500000-0000-4000-8000-000000000018%'
     or v_attention::text like
       '%8e500000-0000-4000-8000-000000000019%' then
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: attention invalid';
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
    'visit_history',
    (select read_at - interval '20 minutes'
     from agent_site_visit_nullable_client_clock),
    (select read_at from agent_site_visit_nullable_client_clock),
    array['scheduled']::text[],
    true,
    pg_catalog.date_trunc(
      'milliseconds', pg_catalog.statement_timestamp()
    ),
    501,
    25
  ) into strict v_unlinked_attention;

  if pg_catalog.jsonb_array_length(v_unlinked_attention -> 'cards') <> 1
     or v_unlinked_attention #>> '{cards,0,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000021'
     or v_unlinked_attention::text like
       '%8e500000-0000-4000-8000-000000000014%' then
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: unlinked attention invalid';
  end if;

  if not exists (
       select 1
       from public.clients client
       where client.id = '8e200000-0000-4000-8000-000000000001'
         and client.company_id = '8e000000-0000-4000-8000-000000000001'
         and client.deleted_at is null
         and client.merged_into_client_id is null
     )
     or not private.agent_user_can_access_entity(
       '8e100000-0000-4000-8000-000000000002',
       '8e000000-0000-4000-8000-000000000001',
       'opportunity',
       '8e300000-0000-4000-8000-000000000015',
       'view'
     )
     or private.agent_user_can_access_entity(
       '8e100000-0000-4000-8000-000000000002',
       '8e000000-0000-4000-8000-000000000001',
       'client',
       '8e200000-0000-4000-8000-000000000001',
       'view'
     ) then
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: actor-hidden precondition';
  end if;

  select public.read_agent_site_visits_as_system(
    p_request_id => 'agent-site-visit-runtime-actor-hidden-client-list',
    p_actor_user_id => '8e100000-0000-4000-8000-000000000002',
    p_company_id => '8e000000-0000-4000-8000-000000000001',
    p_oauth_grant_id => '8e130000-0000-4000-8000-000000000002',
    p_oauth_client_id => '8e120000-0000-4000-8000-000000000001',
    p_grant_revision =>
      pg_catalog.md5('agent-site-visit-hidden-client-grant'),
    p_granted_scope_ceiling => array[
      'ops.customers.read', 'ops.files.read', 'ops.jobs.read',
      'ops.schedule.read', 'ops.site_visits.read'
    ]::text[],
    p_permission_snapshot_revision => (
      select permission_snapshot_revision
      from agent_site_visit_hidden_client_authority
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
      '{"calendar.view":"all","clients.view":"assigned","pipeline.view":"all"}'::jsonb,
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
    p_opportunity_id => null,
    p_item_limit => 25,
    p_page_fetch_limit => 26,
    p_source_limit => 501,
    p_cursor_read_at => null,
    p_cursor_source_revisions => '[]'::jsonb,
    p_after_order_at => null,
    p_after_site_visit_id => null
  ) into strict v_hidden_client_list;

  if v_hidden_client_list::text like
       '%8e500000-0000-4000-8000-000000000020%' then
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: actor-hidden client listed';
  end if;

  select private.agent_p2_site_visit_attention_v1(
    '8e100000-0000-4000-8000-000000000002',
    '8e000000-0000-4000-8000-000000000001',
    (select permission_snapshot_revision
     from agent_site_visit_hidden_client_authority),
    array[
      'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
    ]::text[],
    '{"calendar.view":"all","clients.view":"assigned","pipeline.view":"all"}'::jsonb,
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
  ) into strict v_hidden_client_attention;

  if v_hidden_client_attention::text like
       '%8e500000-0000-4000-8000-000000000020%' then
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: actor-hidden client attention';
  end if;

  begin
    perform public.read_agent_site_visit_context_as_system(
      p_request_id => 'agent-site-visit-runtime-actor-hidden-client-context',
      p_actor_user_id => '8e100000-0000-4000-8000-000000000002',
      p_company_id => '8e000000-0000-4000-8000-000000000001',
      p_oauth_grant_id => '8e130000-0000-4000-8000-000000000002',
      p_oauth_client_id => '8e120000-0000-4000-8000-000000000001',
      p_grant_revision =>
        pg_catalog.md5('agent-site-visit-hidden-client-grant'),
      p_granted_scope_ceiling => array[
        'ops.customers.read', 'ops.files.read', 'ops.jobs.read',
        'ops.schedule.read', 'ops.site_visits.read'
      ]::text[],
      p_permission_snapshot_revision => (
        select permission_snapshot_revision
        from agent_site_visit_hidden_client_authority
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
        '{"calendar.view":"all","clients.view":"assigned","pipeline.view":"all"}'::jsonb,
      p_site_visit_id => '8e500000-0000-4000-8000-000000000020',
      p_expected_anchor => 'opportunity',
      p_expected_opportunity_id =>
        '8e300000-0000-4000-8000-000000000015',
      p_sections => array['booking', 'lead']::text[],
      p_source_limit => 501,
      p_artifact_source_limit => 501,
      p_checklist_answer_limit => 0,
      p_checklist_answer_fetch_limit => 0,
      p_timeline_limit => 0
    );
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: actor-hidden client accepted';
  exception
    when sqlstate 'P0002' then
      if sqlerrm <> 'agent_site_visit_not_found_or_not_visible' then
        raise;
      end if;
  end;

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

  begin
    perform public.read_agent_site_visit_context_as_system(
      p_request_id => 'agent-site-visit-runtime-malformed-client-context',
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
      p_site_visit_id => '8e500000-0000-4000-8000-000000000013',
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
      'agent_site_visit_nullable_client_runtime_failed: malformed client accepted';
  exception
    when sqlstate 'P0002' then
      if sqlerrm <> 'agent_site_visit_not_found_or_not_visible' then
        raise;
      end if;
  end;

  begin
    perform public.read_agent_site_visit_context_as_system(
      p_request_id => 'agent-site-visit-runtime-unlinked-client-context',
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
        'ops.jobs.read', 'ops.site_visits.read'
      ]::text[],
      p_resolved_permission_scopes =>
        '{"pipeline.view":"all"}'::jsonb,
      p_site_visit_id => '8e500000-0000-4000-8000-000000000014',
      p_expected_anchor => 'unlinked',
      p_expected_opportunity_id => null,
      p_sections => array['booking', 'lead']::text[],
      p_source_limit => 501,
      p_artifact_source_limit => 501,
      p_checklist_answer_limit => 0,
      p_checklist_answer_fetch_limit => 0,
      p_timeline_limit => 0
    );
    raise exception
      'agent_site_visit_nullable_client_runtime_failed: unlinked client accepted';
  exception
    when sqlstate 'P0002' then
      if sqlerrm <> 'agent_site_visit_not_found_or_not_visible' then
        raise;
      end if;
  end;

  for v_hidden in
    select hostile.site_visit_id, hostile.opportunity_id, hostile.reason
    from (values
      (
        '8e500000-0000-4000-8000-000000000016'::uuid,
        '8e300000-0000-4000-8000-000000000016'::uuid,
        'foreign-opportunity-client'
      ),
      (
        '8e500000-0000-4000-8000-000000000017'::uuid,
        '8e300000-0000-4000-8000-000000000017'::uuid,
        'visit-opportunity-client-mismatch'
      ),
      (
        '8e500000-0000-4000-8000-000000000018'::uuid,
        '8e300000-0000-4000-8000-000000000018'::uuid,
        'opportunity-client-mirror-conflict'
      ),
      (
        '8e500000-0000-4000-8000-000000000019'::uuid,
        '8e300000-0000-4000-8000-000000000019'::uuid,
        'visit-client-mirror-conflict'
      )
    ) hostile(site_visit_id, opportunity_id, reason)
  loop
    begin
      perform public.read_agent_site_visit_context_as_system(
        p_request_id => 'agent-site-visit-runtime-' || v_hidden.reason,
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
        p_site_visit_id => v_hidden.site_visit_id,
        p_expected_anchor => 'opportunity',
        p_expected_opportunity_id => v_hidden.opportunity_id,
        p_sections => array['booking', 'lead']::text[],
        p_source_limit => 501,
        p_artifact_source_limit => 501,
        p_checklist_answer_limit => 0,
        p_checklist_answer_fetch_limit => 0,
        p_timeline_limit => 0
      );
      raise exception
        'agent_site_visit_nullable_client_runtime_failed: % accepted',
        v_hidden.reason;
    exception
      when sqlstate 'P0002' then
        if sqlerrm <> 'agent_site_visit_not_found_or_not_visible' then
          raise;
        end if;
    end;
  end loop;
end;
$nullable_client_visibility_contract$;

rollback;
