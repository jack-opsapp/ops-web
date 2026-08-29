begin;

-- Task 12 rollback-only PostgreSQL 17 acceptance fixture. It proves the
-- database contract in a disposable database and never commits fixture rows.
do $catalog_contract$
declare
  v_list_signature constant text :=
    'public.read_agent_site_visits_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid)';
  v_context_signature constant text :=
    'public.read_agent_site_visit_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,uuid,text,uuid,text[],integer,integer,integer,integer,integer)';
  v_attention_signature constant text :=
    'private.agent_p2_site_visit_attention_v1(uuid,uuid,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,timestamp with time zone,integer,integer)';
  v_artifact_signature constant text :=
    'private.agent_p2_artifact_private_evidence_v1(uuid,uuid,text,text[],jsonb,text,uuid,text[],integer)';
  v_signature text;
  v_role text;
  v_volatility "char";
  v_security_definer boolean;
  v_config text[];
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000
     or pg_catalog.current_setting('server_version_num')::integer >= 180000 then
    raise exception
      'agent_site_visit_runtime_failed: runtime_requires_postgresql_17';
  end if;

  foreach v_signature in array array[
    v_list_signature,
    v_context_signature,
    v_attention_signature,
    v_artifact_signature
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception
        'agent_site_visit_runtime_failed: missing function %', v_signature;
    end if;

    select procedure.provolatile,
           procedure.prosecdef,
           procedure.proconfig
      into strict v_volatility, v_security_definer, v_config
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure(v_signature);

    if v_volatility is distinct from 's'
       or pg_catalog.cardinality(v_config) <> 1
       or pg_catalog.replace(
            pg_catalog.regexp_replace(v_config[1], '[[:space:]]+', '', 'g'),
            '""',
            ''
          ) is distinct from 'search_path='
       or v_signature like 'public.%' and not v_security_definer
       or v_signature like 'private.%' and v_security_definer then
      raise exception
        'agent_site_visit_runtime_failed: unsafe function attributes %',
        v_signature;
    end if;
  end loop;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'read_agent_site_visits_as_system',
        'read_agent_site_visit_context_as_system'
      )
  ) <> 2 then
    raise exception
      'agent_site_visit_runtime_failed: public signature set mismatch';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in (
        'agent_p2_site_visit_list_v1',
        'agent_p2_site_visit_context_v1',
        'agent_p2_site_visit_attention_v1'
      )
  ) <> 3 then
    raise exception
      'agent_site_visit_runtime_failed: private signature set mismatch';
  end if;

  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_signature in array array[
      v_attention_signature,
      v_artifact_signature
    ] loop
      if pg_catalog.has_function_privilege(v_role, v_signature, 'EXECUTE') then
        raise exception
          'agent_site_visit_runtime_failed: private execute % %',
          v_role,
          v_signature;
      end if;
    end loop;
  end loop;

  foreach v_signature in array array[v_list_signature, v_context_signature] loop
    if pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
       or pg_catalog.has_function_privilege(
            'authenticated', v_signature, 'EXECUTE'
          )
       or not pg_catalog.has_function_privilege(
            'service_role', v_signature, 'EXECUTE'
          ) then
      raise exception
        'agent_site_visit_runtime_failed: public acl mismatch %', v_signature;
    end if;
  end loop;
end;
$catalog_contract$;

set local role authenticated;

do $application_acl$
begin
  if pg_catalog.has_function_privilege(
       current_user,
       'public.read_agent_site_visits_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       current_user,
       'public.read_agent_site_visit_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,uuid,text,uuid,text[],integer,integer,integer,integer,integer)',
       'EXECUTE'
     ) then
    raise exception
      'agent_site_visit_runtime_failed: authenticated execute';
  end if;
end;
$application_acl$;

reset role;

select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

create temporary table agent_site_visit_runtime_clock
on commit drop as
select pg_catalog.date_trunc(
         'milliseconds',
         pg_catalog.statement_timestamp()
       ) as read_at;

insert into public.companies (id, name, bubble_id) values
  (
    '8e000000-0000-4000-8000-000000000001',
    'Site visit runtime company',
    'agent-site-visit-runtime-company'
  ),
  (
    '8e000000-0000-4000-8000-000000000002',
    'Other site visit runtime company',
    'agent-site-visit-runtime-other-company'
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
  'Runtime',
  'Site visit reader',
  'site-visit-runtime@ops.invalid',
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
  ),
  (
    '8e110000-0000-4000-8000-000000000005',
    '8e100000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    'deck_builder.view',
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
  'Site visit runtime client',
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
  pg_catalog.md5('agent-site-visit-runtime-grant')
);

insert into public.clients (id, company_id, name) values
  (
    '8e200000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    'Carly Hunter'
  ),
  (
    '8e200000-0000-4000-8000-000000000002',
    '8e000000-0000-4000-8000-000000000002',
    'Hidden customer'
  );

insert into public.opportunities (id, company_id, client_ref, title) values
  (
    '8e300000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    '8e200000-0000-4000-8000-000000000001',
    'Carly Hunter deck'
  ),
  (
    '8e300000-0000-4000-8000-000000000009',
    '8e000000-0000-4000-8000-000000000001',
    '8e200000-0000-4000-8000-000000000001',
    'Carly Hunter historical converted deck'
  ),
  (
    '8e300000-0000-4000-8000-000000000002',
    '8e000000-0000-4000-8000-000000000002',
    '8e200000-0000-4000-8000-000000000002',
    'Hidden deck'
  );

insert into public.projects (id, company_id, client_id, title, status) values (
  '8e400000-0000-4000-8000-000000000001',
  '8e000000-0000-4000-8000-000000000001',
  '8e200000-0000-4000-8000-000000000001',
  'Carly Hunter project',
  'in_progress'
);

insert into public.task_types (id, company_id, display, dependencies) values (
  '8e410000-0000-4000-8000-000000000001',
  '8e000000-0000-4000-8000-000000000001',
  'Site visit follow-up',
  '[]'::jsonb
);

insert into public.project_tasks (
  id,
  company_id,
  project_id,
  task_type_id,
  custom_title,
  status,
  team_member_ids
) values (
  '8e420000-0000-4000-8000-000000000001',
  '8e000000-0000-4000-8000-000000000001',
  '8e400000-0000-4000-8000-000000000001',
  '8e410000-0000-4000-8000-000000000001',
  'Confirm railing measurements',
  'active',
  array['8e100000-0000-4000-8000-000000000001']::text[]
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
  notes,
  internal_notes,
  measurements,
  photos,
  created_by,
  created_at
) values
  (
    '8e500000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000001',
    '8e200000-0000-4000-8000-000000000001',
    '8e200000-0000-4000-8000-000000000001',
    null,
    null,
    (select read_at + interval '2 hours' from agent_site_visit_runtime_clock),
    (select read_at - interval '1 hour' from agent_site_visit_runtime_clock),
    60,
    array['8e100000-0000-4000-8000-000000000001']::text[],
    'scheduled',
    'Customer marked the back deck as glass.',
    'PRIVATE INTERNAL SITE VISIT NOTE',
    '42 linear feet of railing; 320 square feet.',
    array['https://storage.invalid/raw-site-visit-photo.jpg']::text[],
    '8e100000-0000-4000-8000-000000000001',
    (select read_at - interval '2 days' from agent_site_visit_runtime_clock)
  ),
  (
    '8e500000-0000-4000-8000-000000000002',
    '8e000000-0000-4000-8000-000000000001',
    null,
    null,
    null,
    null,
    null,
    (select read_at + interval '90 days' from agent_site_visit_runtime_clock),
    null,
    45,
    array[]::text[],
    'scheduled',
    'Walk-up visit',
    null,
    null,
    array[]::text[],
    '8e100000-0000-4000-8000-000000000001',
    (select read_at - interval '1 day' from agent_site_visit_runtime_clock)
  ),
  (
    '8e500000-0000-4000-8000-000000000003',
    '8e000000-0000-4000-8000-000000000002',
    '8e300000-0000-4000-8000-000000000002',
    '8e200000-0000-4000-8000-000000000002',
    '8e200000-0000-4000-8000-000000000002',
    null,
    null,
    (select read_at + interval '3 hours' from agent_site_visit_runtime_clock),
    (select read_at - interval '2 hours' from agent_site_visit_runtime_clock),
    60,
    array[]::text[],
    'scheduled',
    'Cross-company visit',
    null,
    null,
    array[]::text[],
    '8e100000-0000-4000-8000-000000000001',
    (select read_at - interval '3 days' from agent_site_visit_runtime_clock)
  ),
  (
    '8e500000-0000-4000-8000-000000000004',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000002',
    '8e200000-0000-4000-8000-000000000002',
    '8e200000-0000-4000-8000-000000000002',
    null,
    null,
    (select read_at + interval '4 hours' from agent_site_visit_runtime_clock),
    (select read_at - interval '30 minutes' from agent_site_visit_runtime_clock),
    60,
    array['8e100000-0000-4000-8000-000000000001']::text[],
    'scheduled',
    'Same-tenant visit with corrupt cross-tenant job links',
    null,
    null,
    array[]::text[],
    '8e100000-0000-4000-8000-000000000001',
    (select read_at - interval '12 hours' from agent_site_visit_runtime_clock)
  );

insert into public.site_visit_checklist_answers (
  id,
  site_visit_id,
  company_id,
  opportunity_id,
  field_id,
  label,
  kind,
  required,
  sort_order,
  answer_value,
  created_by
) values
  (
    '8e510000-0000-4000-8000-000000000001',
    '8e500000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000001',
    'railing_style',
    'Railing style',
    'short_text',
    true,
    1,
    '{"text":"Glass on the back deck"}'::jsonb,
    '8e100000-0000-4000-8000-000000000001'
  ),
  (
    '8e510000-0000-4000-8000-000000000002',
    '8e500000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000001',
    'house_finish',
    'House finish',
    'short_text',
    true,
    2,
    '{"text":"Stucco"}'::jsonb,
    '8e100000-0000-4000-8000-000000000001'
  );

insert into public.deck_designs (
  id,
  company_id,
  opportunity_id,
  title,
  drawing_data,
  version,
  created_by,
  deleted_at
) values
  (
    '8e520000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000009',
    'Carly Hunter converted-parent site visit deck',
    '{"raw_geometry_secret":"must never leave geometry RPC"}'::jsonb,
    1,
    '8e100000-0000-4000-8000-000000000001',
    null
  ),
  (
    '8e520000-0000-4000-8000-000000000002',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000001',
    'Deleted deck design',
    '{}'::jsonb,
    1,
    '8e100000-0000-4000-8000-000000000001',
    (select read_at - interval '1 minute'
     from agent_site_visit_runtime_clock)
  ),
  (
    '8e520000-0000-4000-8000-000000000003',
    '8e000000-0000-4000-8000-000000000002',
    '8e300000-0000-4000-8000-000000000002',
    'Cross-company deck design',
    '{}'::jsonb,
    1,
    '8e100000-0000-4000-8000-000000000001',
    null
  ),
  (
    '8e520000-0000-4000-8000-000000000004',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000001',
    'Currently parented design on an unlinked visit',
    '{}'::jsonb,
    1,
    '8e100000-0000-4000-8000-000000000001',
    null
  );

insert into public.site_visit_artifacts (
  id,
  site_visit_id,
  company_id,
  opportunity_id,
  kind,
  source,
  title,
  body,
  asset_url,
  deck_design_id,
  included_in_project_review,
  captured_at,
  created_by
) values
  (
    '8e530000-0000-4000-8000-000000000001',
    '8e500000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000001',
    'deck_design',
    'deck_builder',
    'Carly deck design',
    null,
    null,
    '8e520000-0000-4000-8000-000000000001',
    true,
    (select read_at - interval '30 minutes' from agent_site_visit_runtime_clock),
    '8e100000-0000-4000-8000-000000000001'
  ),
  (
    '8e530000-0000-4000-8000-000000000002',
    '8e500000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000001',
    'photo',
    'camera',
    'Raw site photo',
    null,
    'https://storage.invalid/private-original.jpg',
    null,
    false,
    (select read_at - interval '20 minutes' from agent_site_visit_runtime_clock),
    '8e100000-0000-4000-8000-000000000001'
  ),
  (
    '8e530000-0000-4000-8000-000000000003',
    '8e500000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000001',
    'deck_design',
    'deck_builder',
    'Deleted design bridge',
    null,
    null,
    '8e520000-0000-4000-8000-000000000002',
    false,
    (select read_at - interval '19 minutes' from agent_site_visit_runtime_clock),
    '8e100000-0000-4000-8000-000000000001'
  ),
  (
    '8e530000-0000-4000-8000-000000000004',
    '8e500000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    '8e300000-0000-4000-8000-000000000001',
    'deck_design',
    'deck_builder',
    'Cross-company design bridge',
    null,
    null,
    '8e520000-0000-4000-8000-000000000003',
    false,
    (select read_at - interval '18 minutes' from agent_site_visit_runtime_clock),
    '8e100000-0000-4000-8000-000000000001'
  ),
  (
    '8e530000-0000-4000-8000-000000000005',
    '8e500000-0000-4000-8000-000000000002',
    '8e000000-0000-4000-8000-000000000001',
    null,
    'deck_design',
    'deck_builder',
    'Currently parented design bridge on unlinked visit',
    null,
    null,
    '8e520000-0000-4000-8000-000000000004',
    true,
    (select read_at - interval '17 minutes' from agent_site_visit_runtime_clock),
    '8e100000-0000-4000-8000-000000000001'
  );

create temporary table agent_site_visit_runtime_authority
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

create temporary table agent_site_visit_runtime_deck_authority
on commit drop as
select authority.permission_snapshot_revision
from private.resolve_agent_actor_authority(
  '8e100000-0000-4000-8000-000000000001',
  '8e000000-0000-4000-8000-000000000001',
  array[
    'calendar.view',
    'clients.view',
    'deck_builder.view',
    'photos.view',
    'pipeline.view'
  ]::text[]
) authority;

create temporary table agent_site_visit_runtime_unlinked_deck_authority
on commit drop as
select authority.permission_snapshot_revision
from private.resolve_agent_actor_authority(
  '8e100000-0000-4000-8000-000000000001',
  '8e000000-0000-4000-8000-000000000001',
  array['deck_builder.view', 'photos.view', 'pipeline.view']::text[]
) authority;

do $authority_fixture_contract$
begin
  if (
    select pg_catalog.count(*)
    from agent_site_visit_runtime_authority
    where permission_snapshot_revision ~ '^sha256:[0-9a-f]{64}$'
  ) <> 1 then
    raise exception
      'agent_site_visit_runtime_failed: authority fixture invalid';
  end if;
  if (
    select pg_catalog.count(*)
    from agent_site_visit_runtime_deck_authority
    where permission_snapshot_revision ~ '^sha256:[0-9a-f]{64}$'
  ) <> 1 or (
    select pg_catalog.count(*)
    from agent_site_visit_runtime_unlinked_deck_authority
    where permission_snapshot_revision ~ '^sha256:[0-9a-f]{64}$'
  ) <> 1 then
    raise exception
      'agent_site_visit_runtime_failed: deck authority fixture invalid';
  end if;
end;
$authority_fixture_contract$;

do $site_visit_writer_acl_contract$
begin
  if not pg_catalog.has_table_privilege(
       'authenticated', 'public.site_visits', 'INSERT'
     )
     or not pg_catalog.has_table_privilege(
       'authenticated', 'public.site_visits', 'UPDATE'
     ) then
    raise exception
      'agent_site_visit_runtime_failed: authenticated writer acl missing';
  end if;
  if not pg_catalog.has_table_privilege(
       'service_role', 'public.site_visits', 'INSERT'
     )
     or not pg_catalog.has_table_privilege(
       'service_role', 'public.site_visits', 'UPDATE'
     ) then
    raise exception
      'agent_site_visit_runtime_failed: service_role writer acl missing';
  end if;
end;
$site_visit_writer_acl_contract$;

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '8e100000-0000-4000-8000-000000000001',
  true
);
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"8e100000-0000-4000-8000-000000000001","email":"site-visit-runtime@ops.invalid","app_metadata":{"company_id":"agent-site-visit-runtime-company"}}',
  true
);
set local role authenticated;

insert into public.site_visits (
  id,
  company_id,
  scheduled_at,
  created_by
) values (
  '8e5a0000-0000-4000-8000-000000000001',
  '8e000000-0000-4000-8000-000000000001',
  pg_catalog.clock_timestamp(),
  '8e100000-0000-4000-8000-000000000001'
);

update public.site_visits
   set booked_at = pg_catalog.clock_timestamp(),
       scheduled_at = pg_catalog.clock_timestamp() + interval '1 hour'
 where id = '8e5a0000-0000-4000-8000-000000000001';

do $authenticated_writer_contract$
begin
  if (
    select pg_catalog.count(*)
    from public.site_visits
    where id = '8e5a0000-0000-4000-8000-000000000001'
      and booked_at is not null
  ) <> 1 then
    raise exception
      'agent_site_visit_runtime_failed: authenticated writer insert/update failed';
  end if;
end;
$authenticated_writer_contract$;

reset role;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
set local role service_role;

insert into public.site_visits (
  id,
  company_id,
  scheduled_at,
  created_by
) values (
  '8e5a0000-0000-4000-8000-000000000002',
  '8e000000-0000-4000-8000-000000000001',
  pg_catalog.clock_timestamp(),
  '8e100000-0000-4000-8000-000000000001'
);

update public.site_visits
   set booked_at = pg_catalog.clock_timestamp(),
       scheduled_at = pg_catalog.clock_timestamp() + interval '1 hour'
 where id = '8e5a0000-0000-4000-8000-000000000002';

do $service_role_writer_contract$
begin
  if (
    select pg_catalog.count(*)
    from public.site_visits
    where id = '8e5a0000-0000-4000-8000-000000000002'
      and booked_at is not null
  ) <> 1 then
    raise exception
      'agent_site_visit_runtime_failed: service_role writer insert/update failed';
  end if;
end;
$service_role_writer_contract$;

reset role;
delete from public.site_visits
where id in (
  '8e5a0000-0000-4000-8000-000000000001',
  '8e5a0000-0000-4000-8000-000000000002'
);

-- Production-shaped keyset plans: both physical gates stop at 501 and use
-- the exact partial composite index matching their predicate and direction.
set local session_replication_role = replica;
insert into public.site_visits (
  id,
  company_id,
  scheduled_at,
  booked_at,
  created_by,
  created_at,
  status
)
select (
         '8ef00000-0000-4000-8000-' ||
         pg_catalog.lpad(series.value::text, 12, '0')
       )::uuid,
       '8e000000-0000-4000-8000-000000000001',
       timestamptz '2027-01-01 00:00:00+00' +
         series.value * interval '1 second',
       timestamptz '2027-01-01 00:00:00+00' +
         series.value * interval '1 second',
       '8e100000-0000-4000-8000-000000000001',
       timestamptz '2027-02-01 00:00:00+00' +
         series.value * interval '1 second',
       'scheduled'
from pg_catalog.generate_series(1, 20000) series(value);
set local session_replication_role = origin;
analyze public.site_visits;

do $booked_plan_contract$
declare
  v_plan jsonb;
  v_index_rows integer;
begin
  execute $plan$
    explain (analyze, buffers, format json)
    select visit.id,
           pg_catalog.date_bin(
             interval '1 millisecond',
             visit.booked_at,
             timestamptz '2000-01-01 00:00:00+00'
           ) as booked_at
    from public.site_visits visit
    where visit.company_id =
            '8e000000-0000-4000-8000-000000000001'
      and visit.deleted_at is null
      and visit.booked_at is not null
      and pg_catalog.date_bin(
            interval '1 millisecond',
            visit.booked_at,
            timestamptz '2000-01-01 00:00:00+00'
          ) >= timestamptz '2027-01-01 00:00:00+00'
      and pg_catalog.date_bin(
            interval '1 millisecond',
            visit.booked_at,
            timestamptz '2000-01-01 00:00:00+00'
          ) < timestamptz '2027-01-02 00:00:00+00'
      and (
        pg_catalog.date_bin(
          interval '1 millisecond',
          visit.booked_at,
          timestamptz '2000-01-01 00:00:00+00'
        ),
        visit.id
      ) > (
        timestamptz '2027-01-01 00:00:00+00',
        '00000000-0000-4000-8000-000000000000'::uuid
      )
    order by pg_catalog.date_bin(
               interval '1 millisecond',
               visit.booked_at,
               timestamptz '2000-01-01 00:00:00+00'
             ) asc,
             visit.id asc
    limit 501
  $plan$ into v_plan;

  if v_plan::text not like '%idx_site_visits_agent_booked_order_v1%' then
    raise exception
      'agent_site_visit_runtime_failed: booked_at keyset plan did not use index';
  end if;

  select pg_catalog.max((node.value ->> 'Actual Rows')::integer)
    into v_index_rows
  from pg_catalog.jsonb_path_query(
    v_plan,
    'strict $[*].** ? (@."Index Name" == "idx_site_visits_agent_booked_order_v1")'
  ) node(value);

  if v_index_rows is null or v_index_rows > 501 then
    raise exception
      'agent_site_visit_runtime_failed: booked_at keyset plan exceeded 501 rows';
  end if;
end;
$booked_plan_contract$;

do $history_plan_contract$
declare
  v_plan jsonb;
  v_index_rows integer;
begin
  execute $plan$
    explain (analyze, buffers, format json)
    select visit.id,
           pg_catalog.date_bin(
             interval '1 millisecond',
             visit.created_at,
             timestamptz '2000-01-01 00:00:00+00'
           ) as created_at
    from public.site_visits visit
    where visit.company_id =
            '8e000000-0000-4000-8000-000000000001'
      and visit.deleted_at is null
      and visit.created_at is not null
      and pg_catalog.date_bin(
            interval '1 millisecond',
            visit.created_at,
            timestamptz '2000-01-01 00:00:00+00'
          ) >= timestamptz '2027-02-01 00:00:00+00'
      and pg_catalog.date_bin(
            interval '1 millisecond',
            visit.created_at,
            timestamptz '2000-01-01 00:00:00+00'
          ) < timestamptz '2027-02-02 00:00:00+00'
      and (
        pg_catalog.date_bin(
          interval '1 millisecond',
          visit.created_at,
          timestamptz '2000-01-01 00:00:00+00'
        ),
        visit.id
      ) < (
        timestamptz '2027-02-02 00:00:00+00',
        'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid
      )
    order by pg_catalog.date_bin(
               interval '1 millisecond',
               visit.created_at,
               timestamptz '2000-01-01 00:00:00+00'
             ) desc,
             visit.id desc
    limit 501
  $plan$ into v_plan;

  if v_plan::text not like '%idx_site_visits_agent_history_order_v1%' then
    raise exception
      'agent_site_visit_runtime_failed: created_at keyset plan did not use index';
  end if;

  select pg_catalog.max((node.value ->> 'Actual Rows')::integer)
    into v_index_rows
  from pg_catalog.jsonb_path_query(
    v_plan,
    'strict $[*].** ? (@."Index Name" == "idx_site_visits_agent_history_order_v1")'
  ) node(value);

  if v_index_rows is null or v_index_rows > 501 then
    raise exception
      'agent_site_visit_runtime_failed: created_at keyset plan exceeded 501 rows';
  end if;
end;
$history_plan_contract$;

create function pg_temp.assert_site_visit_hostile_plan(
  p_case text,
  p_plan jsonb,
  p_index_name text
) returns void
language plpgsql
set search_path = ''
as $function$
declare
  v_index_tuple_work numeric;
  v_index_loops numeric;
  v_removed_tuple_work numeric;
  v_source_access_nodes integer;
  v_wrong_source_access_nodes integer;
  v_sort_nodes integer;
  v_shared_blocks numeric;
  v_temp_blocks numeric;
begin
  with recursive plan_nodes(node) as (
    select p_plan -> 0 -> 'Plan'
    union all
    select child.value
    from plan_nodes parent
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(parent.node -> 'Plans', '[]'::jsonb)
    ) child(value)
  )
  select coalesce(pg_catalog.sum(
           case when node ->> 'Index Name' = p_index_name then
             (
               coalesce((node ->> 'Actual Rows')::numeric, 0) +
               coalesce((node ->> 'Rows Removed by Filter')::numeric, 0) +
               coalesce(
                 (node ->> 'Rows Removed by Index Recheck')::numeric,
                 0
               )
             ) * coalesce((node ->> 'Actual Loops')::numeric, 0)
           else 0 end
         ), 0),
         coalesce(pg_catalog.sum(
           case when node ->> 'Index Name' = p_index_name
             then coalesce((node ->> 'Actual Loops')::numeric, 0)
             else 0 end
         ), 0),
         coalesce(pg_catalog.sum(
           (
             coalesce((node ->> 'Rows Removed by Filter')::numeric, 0) +
             coalesce((node ->> 'Rows Removed by Join Filter')::numeric, 0) +
             coalesce(
               (node ->> 'Rows Removed by Index Recheck')::numeric,
               0
             )
           ) *
           coalesce((node ->> 'Actual Loops')::numeric, 0)
         ), 0),
         pg_catalog.count(*) filter (
           where node ->> 'Relation Name' = 'site_visits'
         )::integer,
         pg_catalog.count(*) filter (
           where node ->> 'Relation Name' = 'site_visits'
             and node ->> 'Index Name' is distinct from p_index_name
         )::integer,
         pg_catalog.count(*) filter (
           where node ->> 'Node Type' in ('Sort', 'Incremental Sort')
         )::integer
    into v_index_tuple_work,
         v_index_loops,
         v_removed_tuple_work,
         v_source_access_nodes,
         v_wrong_source_access_nodes,
         v_sort_nodes
  from plan_nodes;

  v_shared_blocks :=
    coalesce((p_plan #>> '{0,Plan,Shared Hit Blocks}')::numeric, 0) +
    coalesce((p_plan #>> '{0,Plan,Shared Read Blocks}')::numeric, 0) +
    coalesce((p_plan #>> '{0,Plan,Shared Dirtied Blocks}')::numeric, 0) +
    coalesce((p_plan #>> '{0,Plan,Shared Written Blocks}')::numeric, 0);
  v_temp_blocks :=
    coalesce((p_plan #>> '{0,Plan,Temp Read Blocks}')::numeric, 0) +
    coalesce((p_plan #>> '{0,Plan,Temp Written Blocks}')::numeric, 0);

  if v_index_tuple_work is distinct from 501
     or v_index_loops is distinct from 1
     or v_removed_tuple_work > 501
     or v_source_access_nodes <> 1
     or v_wrong_source_access_nodes <> 0
     or v_sort_nodes <> 0
     or v_shared_blocks > 2048
     or v_temp_blocks <> 0 then
    raise exception
      'agent_site_visit_runtime_failed: hostile physical plan unbounded for % (index_work=%, index_loops=%, removed_work=%, source_nodes=%, wrong_source_nodes=%, sorts=%, shared_blocks=%, temp_blocks=%)',
      p_case,
      v_index_tuple_work,
      v_index_loops,
      v_removed_tuple_work,
      v_source_access_nodes,
      v_wrong_source_access_nodes,
      v_sort_nodes,
      v_shared_blocks,
      v_temp_blocks;
  end if;

  raise notice
    'agent_site_visit_physical_plan: case=%, index_work=%, index_loops=%, removed_work=%, source_nodes=%, sorts=%, shared_blocks=%, temp_blocks=%',
    p_case,
    v_index_tuple_work,
    v_index_loops,
    v_removed_tuple_work,
    v_source_access_nodes,
    v_sort_nodes,
    v_shared_blocks,
    v_temp_blocks;
end;
$function$;

do $booked_list_hostile_plan_contract$
declare
  v_plan jsonb;
begin
  execute $plan$
    explain (analyze, buffers, format json)
    with raw_source_gate as materialized (
      select visit.id,
             visit.opportunity_id,
             visit.status::text as status,
             visit.assignee_ids
      from public.site_visits visit
      where visit.company_id =
              '8e000000-0000-4000-8000-000000000001'
        and visit.deleted_at is null
        and visit.booked_at is not null
        and pg_catalog.date_bin(
              interval '1 millisecond',
              visit.booked_at,
              timestamptz '2000-01-01 00:00:00+00'
            ) >= timestamptz '2027-01-01 00:00:00+00'
        and pg_catalog.date_bin(
              interval '1 millisecond',
              visit.booked_at,
              timestamptz '2000-01-01 00:00:00+00'
            ) < timestamptz '2027-01-02 00:00:00+00'
      order by pg_catalog.date_bin(
                 interval '1 millisecond',
                 visit.booked_at,
                 timestamptz '2000-01-01 00:00:00+00'
               ),
               visit.id
      limit 501
    ), selected_source as materialized (
      select raw.*
      from raw_source_gate raw
      where raw.status = 'cancelled'
        and raw.opportunity_id is not null
    )
    select pg_catalog.count(*)
    from selected_source
  $plan$ into v_plan;

  perform pg_temp.assert_site_visit_hostile_plan(
    'booked list hostile status/linkage',
    v_plan,
    'idx_site_visits_agent_booked_order_v1'
  );
end;
$booked_list_hostile_plan_contract$;

do $history_list_hostile_plan_contract$
declare
  v_plan jsonb;
begin
  execute $plan$
    explain (analyze, buffers, format json)
    with raw_source_gate as materialized (
      select visit.id,
             visit.opportunity_id,
             visit.status::text as status,
             visit.assignee_ids
      from public.site_visits visit
      where visit.company_id =
              '8e000000-0000-4000-8000-000000000001'
        and visit.deleted_at is null
        and visit.created_at is not null
        and pg_catalog.date_bin(
              interval '1 millisecond',
              visit.created_at,
              timestamptz '2000-01-01 00:00:00+00'
            ) >= timestamptz '2027-02-01 00:00:00+00'
        and pg_catalog.date_bin(
              interval '1 millisecond',
              visit.created_at,
              timestamptz '2000-01-01 00:00:00+00'
            ) < timestamptz '2027-02-02 00:00:00+00'
      order by pg_catalog.date_bin(
                 interval '1 millisecond',
                 visit.created_at,
                 timestamptz '2000-01-01 00:00:00+00'
               ) desc,
               visit.id desc
      limit 501
    ), selected_source as materialized (
      select raw.*
      from raw_source_gate raw
      where raw.status = 'completed'
        and '8e100000-0000-4000-8000-000000000099' = any(
          coalesce(raw.assignee_ids, array[]::text[])
        )
        and raw.opportunity_id =
          '8e300000-0000-4000-8000-000000000099'::uuid
    )
    select pg_catalog.count(*)
    from selected_source
  $plan$ into v_plan;

  perform pg_temp.assert_site_visit_hostile_plan(
    'history list hostile status/assignee/opportunity',
    v_plan,
    'idx_site_visits_agent_history_order_v1'
  );
end;
$history_list_hostile_plan_contract$;

do $booked_attention_hostile_plan_contract$
declare
  v_plan jsonb;
begin
  execute $plan$
    explain (analyze, buffers, format json)
    with raw_source_gate as materialized (
      select visit.id,
             visit.opportunity_id,
             visit.status::text as status
      from public.site_visits visit
      where visit.company_id =
              '8e000000-0000-4000-8000-000000000001'
        and visit.deleted_at is null
        and visit.booked_at is not null
        and pg_catalog.date_bin(
              interval '1 millisecond',
              visit.booked_at,
              timestamptz '2000-01-01 00:00:00+00'
            ) >= timestamptz '2027-01-01 00:00:00+00'
        and pg_catalog.date_bin(
              interval '1 millisecond',
              visit.booked_at,
              timestamptz '2000-01-01 00:00:00+00'
            ) < timestamptz '2027-01-02 00:00:00+00'
      order by pg_catalog.date_bin(
                 interval '1 millisecond',
                 visit.booked_at,
                 timestamptz '2000-01-01 00:00:00+00'
               ),
               visit.id
      limit 501
    ), selected_source as materialized (
      select raw.*
      from raw_source_gate raw
      where raw.status = 'completed'
        and raw.opportunity_id is not null
    )
    select pg_catalog.count(*)
    from selected_source
  $plan$ into v_plan;

  perform pg_temp.assert_site_visit_hostile_plan(
    'booked attention hostile status/linkage',
    v_plan,
    'idx_site_visits_agent_booked_order_v1'
  );
end;
$booked_attention_hostile_plan_contract$;

do $history_attention_hostile_plan_contract$
declare
  v_plan jsonb;
begin
  execute $plan$
    explain (analyze, buffers, format json)
    with raw_source_gate as materialized (
      select visit.id,
             visit.opportunity_id,
             visit.project_ref,
             visit.project_id,
             visit.status::text as status
      from public.site_visits visit
      where visit.company_id =
              '8e000000-0000-4000-8000-000000000001'
        and visit.deleted_at is null
        and visit.created_at is not null
        and pg_catalog.date_bin(
              interval '1 millisecond',
              visit.created_at,
              timestamptz '2000-01-01 00:00:00+00'
            ) >= timestamptz '2027-02-01 00:00:00+00'
        and pg_catalog.date_bin(
              interval '1 millisecond',
              visit.created_at,
              timestamptz '2000-01-01 00:00:00+00'
            ) < timestamptz '2027-02-02 00:00:00+00'
      order by pg_catalog.date_bin(
                 interval '1 millisecond',
                 visit.created_at,
                 timestamptz '2000-01-01 00:00:00+00'
               ) desc,
               visit.id desc
      limit 501
    ), selected_source as materialized (
      select raw.*
      from raw_source_gate raw
      where raw.status = 'completed'
        and (
          raw.opportunity_id is not null
          or raw.opportunity_id is null
             and raw.project_ref is null
             and raw.project_id is null
        )
    )
    select pg_catalog.count(*)
    from selected_source
  $plan$ into v_plan;

  perform pg_temp.assert_site_visit_hostile_plan(
    'history attention hostile status/project linkage',
    v_plan,
    'idx_site_visits_agent_history_order_v1'
  );
end;
$history_attention_hostile_plan_contract$;

set local session_replication_role = replica;
delete from public.site_visits
where id >= '8ef00000-0000-4000-8000-000000000001'::uuid
  and id <= '8ef00000-0000-4000-8000-000000020000'::uuid;
set local session_replication_role = origin;
analyze public.site_visits;

-- Hostile selector matrix: each isolated window contains exactly the physical
-- 501-row sentinel, while a later status, linkage, assignee, opportunity, or
-- authority selector rejects every row. The physical gate must fail closed
-- before any of those non-indexed predicates can make the source look small.
update public.user_permission_overrides
   set scope = 'own'
 where user_id = '8e100000-0000-4000-8000-000000000001'
   and company_id = '8e000000-0000-4000-8000-000000000001'
   and permission = 'calendar.view';

delete from agent_site_visit_runtime_authority;
insert into agent_site_visit_runtime_authority
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

create temporary table agent_site_visit_hostile_cases (
  case_name text primary key,
  reader_kind text not null,
  view_kind text not null,
  window_from timestamptz not null,
  statuses text[] not null,
  include_unlinked boolean not null,
  selector_assignee uuid,
  selector_opportunity uuid,
  row_status text not null,
  link_kind text not null,
  row_assignee uuid not null
) on commit drop;

insert into agent_site_visit_hostile_cases values
  (
    'list booked hostile status', 'list', 'booked_appointments',
    timestamptz '2031-01-01 00:00:00+00', array['scheduled']::text[], false,
    null, null, 'completed', 'linked',
    '8e100000-0000-4000-8000-000000000001'
  ),
  (
    'list booked hostile assignee', 'list', 'booked_appointments',
    timestamptz '2031-01-03 00:00:00+00', array['scheduled']::text[], false,
    '8e100000-0000-4000-8000-000000000099', null,
    'scheduled', 'linked', '8e100000-0000-4000-8000-000000000001'
  ),
  (
    'list booked hostile opportunity', 'list', 'booked_appointments',
    timestamptz '2031-01-05 00:00:00+00', array['scheduled']::text[], false,
    null, '8e300000-0000-4000-8000-000000000099',
    'scheduled', 'linked', '8e100000-0000-4000-8000-000000000001'
  ),
  (
    'list booked unlinked excluded', 'list', 'booked_appointments',
    timestamptz '2031-01-07 00:00:00+00', array['scheduled']::text[], false,
    null, null, 'scheduled', 'unlinked',
    '8e100000-0000-4000-8000-000000000001'
  ),
  (
    'list booked project-linked excluded', 'list', 'booked_appointments',
    timestamptz '2031-01-08 00:00:00+00', array['scheduled']::text[], false,
    null, null, 'scheduled', 'project_linked',
    '8e100000-0000-4000-8000-000000000001'
  ),
  (
    'list history hostile status', 'list', 'visit_history',
    timestamptz '2031-01-09 00:00:00+00', array['completed']::text[], false,
    null, null, 'scheduled', 'linked',
    '8e100000-0000-4000-8000-000000000001'
  ),
  (
    'list history hostile assignee', 'list', 'visit_history',
    timestamptz '2031-01-11 00:00:00+00', array['completed']::text[], false,
    '8e100000-0000-4000-8000-000000000099', null,
    'completed', 'linked', '8e100000-0000-4000-8000-000000000001'
  ),
  (
    'list history hostile opportunity', 'list', 'visit_history',
    timestamptz '2031-01-13 00:00:00+00', array['completed']::text[], false,
    null, '8e300000-0000-4000-8000-000000000099',
    'completed', 'linked', '8e100000-0000-4000-8000-000000000001'
  ),
  (
    'list history unlinked excluded', 'list', 'visit_history',
    timestamptz '2031-01-15 00:00:00+00', array['completed']::text[], false,
    null, null, 'completed', 'unlinked',
    '8e100000-0000-4000-8000-000000000001'
  ),
  (
    'list history project-linked excluded', 'list', 'visit_history',
    timestamptz '2031-01-17 00:00:00+00', array['completed']::text[], true,
    null, null, 'completed', 'project_linked',
    '8e100000-0000-4000-8000-000000000001'
  ),
  (
    'attention booked hostile status', 'attention', 'booked_appointments',
    timestamptz '2031-01-19 00:00:00+00', array['scheduled']::text[], false,
    null, null, 'completed', 'linked',
    '8e100000-0000-4000-8000-000000000001'
  ),
  (
    'attention booked hostile assignee authority',
    'attention', 'booked_appointments',
    timestamptz '2031-01-21 00:00:00+00', array['scheduled']::text[], false,
    null, null, 'scheduled', 'linked',
    '8e100000-0000-4000-8000-000000000099'
  ),
  (
    'attention booked missing opportunity authority',
    'attention', 'booked_appointments',
    timestamptz '2031-01-22 00:00:00+00', array['scheduled']::text[], false,
    null, null, 'scheduled', 'missing_linked',
    '8e100000-0000-4000-8000-000000000001'
  ),
  (
    'attention booked unlinked excluded', 'attention', 'booked_appointments',
    timestamptz '2031-01-23 00:00:00+00', array['scheduled']::text[], false,
    null, null, 'scheduled', 'unlinked',
    '8e100000-0000-4000-8000-000000000099'
  ),
  (
    'attention booked project-linked excluded',
    'attention', 'booked_appointments',
    timestamptz '2031-01-24 00:00:00+00', array['scheduled']::text[], false,
    null, null, 'scheduled', 'project_linked',
    '8e100000-0000-4000-8000-000000000001'
  ),
  (
    'attention history hostile status', 'attention', 'visit_history',
    timestamptz '2031-01-25 00:00:00+00', array['completed']::text[], false,
    null, null, 'scheduled', 'linked',
    '8e100000-0000-4000-8000-000000000001'
  ),
  (
    'attention history hostile assignee authority',
    'attention', 'visit_history',
    timestamptz '2031-01-26 00:00:00+00', array['completed']::text[], false,
    null, null, 'completed', 'linked',
    '8e100000-0000-4000-8000-000000000099'
  ),
  (
    'attention history unlinked excluded', 'attention', 'visit_history',
    timestamptz '2031-01-27 00:00:00+00', array['completed']::text[], false,
    null, null, 'completed', 'unlinked',
    '8e100000-0000-4000-8000-000000000099'
  ),
  (
    'attention history missing opportunity authority',
    'attention', 'visit_history',
    timestamptz '2031-01-28 00:00:00+00', array['completed']::text[], false,
    null, null, 'completed', 'missing_linked',
    '8e100000-0000-4000-8000-000000000001'
  ),
  (
    'attention history project-linked excluded',
    'attention', 'visit_history',
    timestamptz '2031-01-29 00:00:00+00', array['completed']::text[], true,
    null, null, 'completed', 'project_linked',
    '8e100000-0000-4000-8000-000000000099'
  );

set local session_replication_role = replica;
insert into public.site_visits (
  id,
  company_id,
  opportunity_id,
  client_ref,
  project_ref,
  project_id,
  scheduled_at,
  booked_at,
  created_by,
  assignee_ids,
  created_at,
  status
)
select pg_catalog.md5(
         case_fixture.case_name || ':' || series.value::text
       )::uuid,
       '8e000000-0000-4000-8000-000000000001',
       case case_fixture.link_kind
         when 'linked' then
           '8e300000-0000-4000-8000-000000000001'::uuid
         when 'missing_linked' then
           '8e300000-0000-4000-8000-000000000098'::uuid
         else null::uuid
       end,
       case case_fixture.link_kind
         when 'linked' then
           '8e200000-0000-4000-8000-000000000001'::uuid
         when 'missing_linked' then
           '8e200000-0000-4000-8000-000000000098'::uuid
         else null::uuid
       end,
       case when case_fixture.link_kind = 'project_linked'
         then '8e400000-0000-4000-8000-000000000001'::uuid
         else null::uuid
       end,
       case when case_fixture.link_kind = 'project_linked'
         then '8e400000-0000-4000-8000-000000000001'
         else null::text
       end,
       case_fixture.window_from + series.value * interval '1 millisecond',
       case_fixture.window_from + series.value * interval '1 millisecond',
       case_fixture.row_assignee::text,
       array[case_fixture.row_assignee::text]::text[],
       case_fixture.window_from + series.value * interval '1 millisecond',
       case_fixture.row_status::public.site_visit_status
from agent_site_visit_hostile_cases case_fixture
cross join pg_catalog.generate_series(1, 501) series(value);
set local session_replication_role = origin;
analyze public.site_visits;

create function pg_temp.assert_site_visit_list_hostile_bound(
  p_case agent_site_visit_hostile_cases
) returns void
language plpgsql
set search_path = ''
as $function$
begin
  begin
    perform public.read_agent_site_visits_as_system(
      p_request_id => 'agent-site-visit-hostile:' || p_case.case_name,
      p_actor_user_id => '8e100000-0000-4000-8000-000000000001',
      p_company_id => '8e000000-0000-4000-8000-000000000001',
      p_oauth_grant_id => '8e130000-0000-4000-8000-000000000001',
      p_oauth_client_id => '8e120000-0000-4000-8000-000000000001',
      p_grant_revision => pg_catalog.md5('agent-site-visit-runtime-grant'),
      p_granted_scope_ceiling => array[
        'ops.customers.read',
        'ops.files.read',
        'ops.jobs.read',
        'ops.schedule.read',
        'ops.site_visits.read'
      ]::text[],
      p_permission_snapshot_revision => (
        select permission_snapshot_revision
        from pg_temp.agent_site_visit_runtime_authority
      ),
      p_registered_permission_keys => array[
        'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
      ]::text[],
      p_capability_id => 'list_site_visits',
      p_capability_revision => 'list_site_visits:2026-08-22.v1',
      p_capability_manifest_revision =>
        '2026-08-22.capability-manifest.v8',
      p_required_oauth_scopes => array[
        'ops.customers.read',
        'ops.jobs.read',
        'ops.schedule.read',
        'ops.site_visits.read'
      ]::text[],
      p_resolved_permission_scopes =>
        '{"calendar.view":"own","clients.view":"all","pipeline.view":"all"}'::jsonb,
      p_view_kind => p_case.view_kind,
      p_window_from => p_case.window_from,
      p_window_to => p_case.window_from + interval '1 day',
      p_statuses => p_case.statuses,
      p_include_unlinked => p_case.include_unlinked,
      p_assignee_user_id => p_case.selector_assignee,
      p_opportunity_id => p_case.selector_opportunity,
      p_item_limit => 25,
      p_page_fetch_limit => 26,
      p_source_limit => 501,
      p_cursor_read_at => null::timestamptz,
      p_cursor_source_revisions => '[]'::jsonb,
      p_after_order_at => null::timestamptz,
      p_after_site_visit_id => null::uuid
    );
  exception
    when sqlstate '54000' then
      if sqlerrm = 'agent_site_visit_source_query_bound' then
        return;
      end if;
      raise;
  end;

  raise exception
    'agent_site_visit_runtime_failed: hostile physical source bound not enforced for %',
    p_case.case_name;
end;
$function$;

create function pg_temp.assert_site_visit_attention_hostile_bound(
  p_case agent_site_visit_hostile_cases
) returns void
language plpgsql
set search_path = ''
as $function$
begin
  begin
    perform private.agent_p2_site_visit_attention_v1(
      '8e100000-0000-4000-8000-000000000001',
      '8e000000-0000-4000-8000-000000000001',
      (select permission_snapshot_revision
       from pg_temp.agent_site_visit_runtime_authority),
      array[
        'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
      ]::text[],
      '{"calendar.view":"own","clients.view":"all","pipeline.view":"all"}'::jsonb,
      p_case.view_kind,
      p_case.window_from,
      p_case.window_from + interval '1 day',
      p_case.statuses,
      p_case.include_unlinked,
      pg_catalog.date_trunc(
        'milliseconds', pg_catalog.statement_timestamp()
      ),
      501,
      25
    );
  exception
    when sqlstate '54000' then
      if sqlerrm = 'agent_p2_site_visit_attention_source_bound' then
        return;
      end if;
      raise;
  end;

  raise exception
    'agent_site_visit_runtime_failed: hostile physical source bound not enforced for %',
    p_case.case_name;
end;
$function$;

do $hostile_source_bound_contract$
declare
  v_case agent_site_visit_hostile_cases%rowtype;
begin
  for v_case in
    select *
    from agent_site_visit_hostile_cases
    order by case_name
  loop
    if v_case.reader_kind = 'list' then
      perform pg_temp.assert_site_visit_list_hostile_bound(v_case);
    elsif v_case.reader_kind = 'attention' then
      perform pg_temp.assert_site_visit_attention_hostile_bound(v_case);
    else
      raise exception
        'agent_site_visit_runtime_failed: unknown hostile reader %',
        v_case.reader_kind;
    end if;
  end loop;
end;
$hostile_source_bound_contract$;

update public.user_permission_overrides
   set scope = 'all'
 where user_id = '8e100000-0000-4000-8000-000000000001'
   and company_id = '8e000000-0000-4000-8000-000000000001'
   and permission = 'calendar.view';

delete from agent_site_visit_runtime_authority;
insert into agent_site_visit_runtime_authority
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

create temporary table agent_site_visit_runtime_booked
on commit drop as
select public.read_agent_site_visits_as_system(
  p_request_id => 'agent-site-visit-runtime-booked',
  p_actor_user_id => '8e100000-0000-4000-8000-000000000001',
  p_company_id => '8e000000-0000-4000-8000-000000000001',
  p_oauth_grant_id => '8e130000-0000-4000-8000-000000000001',
  p_oauth_client_id => '8e120000-0000-4000-8000-000000000001',
  p_grant_revision => pg_catalog.md5('agent-site-visit-runtime-grant'),
  p_granted_scope_ceiling => array[
    'ops.customers.read',
    'ops.files.read',
    'ops.jobs.read',
    'ops.schedule.read',
    'ops.site_visits.read'
  ]::text[],
  p_permission_snapshot_revision => (
    select permission_snapshot_revision
    from agent_site_visit_runtime_authority
  ),
  p_registered_permission_keys => array[
    'calendar.view',
    'clients.view',
    'photos.view',
    'pipeline.view'
  ]::text[],
  p_capability_id => 'list_site_visits',
  p_capability_revision => 'list_site_visits:2026-08-22.v1',
  p_capability_manifest_revision =>
    '2026-08-22.capability-manifest.v8',
  p_required_oauth_scopes => array[
    'ops.customers.read',
    'ops.jobs.read',
    'ops.schedule.read',
    'ops.site_visits.read'
  ]::text[],
  p_resolved_permission_scopes =>
    '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
  p_view_kind => 'booked_appointments',
  p_window_from => (
    select read_at - interval '1 day' from agent_site_visit_runtime_clock
  ),
  p_window_to => (
    select read_at + interval '1 day' from agent_site_visit_runtime_clock
  ),
  p_statuses => array['in_progress', 'scheduled']::text[],
  p_include_unlinked => false,
  p_assignee_user_id => null::uuid,
  p_opportunity_id => null::uuid,
  p_item_limit => 25,
  p_page_fetch_limit => 26,
  p_source_limit => 501,
  p_cursor_read_at => null::timestamptz,
  p_cursor_source_revisions => '[]'::jsonb,
  p_after_order_at => null::timestamptz,
  p_after_site_visit_id => null::uuid
) as result;

do $booked_result_contract$
declare
  v_result jsonb;
begin
  select result into strict v_result from agent_site_visit_runtime_booked;
  if v_result ->> 'capability_id' <> 'list_site_visits'
     or v_result #>> '{query,view}' <> 'booked_appointments'
     or pg_catalog.jsonb_array_length(v_result -> 'rows') <> 1
     or v_result #>> '{rows,0,item,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000001'
     or v_result #>> '{rows,0,item,booking,state}' <> 'booked'
     or v_result::text like '%8e500000-0000-4000-8000-000000000002%'
     or v_result::text like '%8e500000-0000-4000-8000-000000000003%'
     or v_result::text like '%8e500000-0000-4000-8000-000000000004%' then
    raise exception
      'agent_site_visit_runtime_failed: cross-company site visit leaked or booked_at contract invalid';
  end if;
end;
$booked_result_contract$;

create temporary table agent_site_visit_runtime_history
on commit drop as
select public.read_agent_site_visits_as_system(
  'agent-site-visit-runtime-history',
  '8e100000-0000-4000-8000-000000000001',
  '8e000000-0000-4000-8000-000000000001',
  '8e130000-0000-4000-8000-000000000001',
  '8e120000-0000-4000-8000-000000000001',
  pg_catalog.md5('agent-site-visit-runtime-grant'),
  array[
    'ops.customers.read',
    'ops.files.read',
    'ops.jobs.read',
    'ops.schedule.read',
    'ops.site_visits.read'
  ]::text[],
  (select permission_snapshot_revision
   from agent_site_visit_runtime_authority),
  array[
    'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
  ]::text[],
  'list_site_visits',
  'list_site_visits:2026-08-22.v1',
  '2026-08-22.capability-manifest.v8',
  array[
    'ops.customers.read',
    'ops.jobs.read',
    'ops.schedule.read',
    'ops.site_visits.read'
  ]::text[],
  '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
  'visit_history',
  (select read_at - interval '7 days' from agent_site_visit_runtime_clock),
  (select read_at + interval '1 day' from agent_site_visit_runtime_clock),
  array[]::text[],
  true,
  null,
  null,
  25,
  26,
  501,
  null,
  '[]'::jsonb,
  null,
  null
) as result;

do $history_result_contract$
declare
  v_result jsonb;
begin
  select result into strict v_result from agent_site_visit_runtime_history;
  if pg_catalog.jsonb_array_length(v_result -> 'rows') <> 2
     or v_result #>> '{rows,0,item,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000002'
     or v_result #>> '{rows,0,item,booking,state}' <> 'walk_up'
     or v_result #>> '{rows,1,item,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000001'
     or v_result::text like '%8e500000-0000-4000-8000-000000000003%'
     or v_result::text like '%8e500000-0000-4000-8000-000000000004%' then
    raise exception
      'agent_site_visit_runtime_failed: created_at history contract invalid';
  end if;
end;
$history_result_contract$;

do $deck_authority_selection_contract$
begin
  begin
    perform public.read_agent_site_visit_context_as_system(
      p_request_id => 'agent-site-visit-runtime-deck-without-authority',
      p_actor_user_id => '8e100000-0000-4000-8000-000000000001',
      p_company_id => '8e000000-0000-4000-8000-000000000001',
      p_oauth_grant_id => '8e130000-0000-4000-8000-000000000001',
      p_oauth_client_id => '8e120000-0000-4000-8000-000000000001',
      p_grant_revision => pg_catalog.md5(
        'agent-site-visit-runtime-grant'
      ),
      p_granted_scope_ceiling => array[
        'ops.customers.read', 'ops.files.read', 'ops.jobs.read',
        'ops.schedule.read', 'ops.site_visits.read'
      ]::text[],
      p_permission_snapshot_revision => (
        select permission_snapshot_revision
        from agent_site_visit_runtime_authority
      ),
      p_registered_permission_keys => array[
        'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
      ]::text[],
      p_capability_id => 'get_site_visit_context',
      p_capability_revision => 'get_site_visit_context:2026-08-22.v1',
      p_capability_manifest_revision =>
        '2026-08-22.capability-manifest.v8',
      p_required_oauth_scopes => array[
        'ops.customers.read', 'ops.files.read', 'ops.jobs.read',
        'ops.schedule.read', 'ops.site_visits.read'
      ]::text[],
      p_resolved_permission_scopes =>
        '{"calendar.view":"all","clients.view":"all","photos.view":"all","pipeline.view":"all"}'::jsonb,
      p_site_visit_id => '8e500000-0000-4000-8000-000000000001',
      p_expected_anchor => 'opportunity',
      p_expected_opportunity_id =>
        '8e300000-0000-4000-8000-000000000001',
      p_sections => array['deck_design_refs']::text[],
      p_source_limit => 501,
      p_artifact_source_limit => 501,
      p_checklist_answer_limit => 0,
      p_checklist_answer_fetch_limit => 0,
      p_timeline_limit => 0
    );
    raise exception
      'agent_site_visit_runtime_failed: deck section without deck authority accepted';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'invalid_agent_site_visit_context_request' then
        raise;
      end if;
  end;
end;
$deck_authority_selection_contract$;

create temporary table agent_site_visit_runtime_artifact_summary_context
on commit drop as
select public.read_agent_site_visit_context_as_system(
  p_request_id => 'agent-site-visit-runtime-artifact-summary-only',
  p_actor_user_id => '8e100000-0000-4000-8000-000000000001',
  p_company_id => '8e000000-0000-4000-8000-000000000001',
  p_oauth_grant_id => '8e130000-0000-4000-8000-000000000001',
  p_oauth_client_id => '8e120000-0000-4000-8000-000000000001',
  p_grant_revision => pg_catalog.md5('agent-site-visit-runtime-grant'),
  p_granted_scope_ceiling => array[
    'ops.customers.read', 'ops.files.read', 'ops.jobs.read',
    'ops.schedule.read', 'ops.site_visits.read'
  ]::text[],
  p_permission_snapshot_revision => (
    select permission_snapshot_revision
    from agent_site_visit_runtime_authority
  ),
  p_registered_permission_keys => array[
    'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
  ]::text[],
  p_capability_id => 'get_site_visit_context',
  p_capability_revision => 'get_site_visit_context:2026-08-22.v1',
  p_capability_manifest_revision => '2026-08-22.capability-manifest.v8',
  p_required_oauth_scopes => array[
    'ops.customers.read', 'ops.files.read', 'ops.jobs.read',
    'ops.schedule.read', 'ops.site_visits.read'
  ]::text[],
  p_resolved_permission_scopes =>
    '{"calendar.view":"all","clients.view":"all","photos.view":"all","pipeline.view":"all"}'::jsonb,
  p_site_visit_id => '8e500000-0000-4000-8000-000000000001',
  p_expected_anchor => 'opportunity',
  p_expected_opportunity_id => '8e300000-0000-4000-8000-000000000001',
  p_sections => array['artifact_summary']::text[],
  p_source_limit => 501,
  p_artifact_source_limit => 501,
  p_checklist_answer_limit => 0,
  p_checklist_answer_fetch_limit => 0,
  p_timeline_limit => 0
) as result;

do $artifact_summary_authority_contract$
declare
  v_result jsonb;
begin
  select result into strict v_result
  from agent_site_visit_runtime_artifact_summary_context;

  if v_result ->> 'deck_builder_scope' is not null
     or v_result #>> '{source_inspected,artifacts}' <> '1'
     or v_result #>> '{source_inspected,deck_designs}' <> '0'
     or v_result #>>
          '{result,sections,artifact_summary,source_count}' <> '1'
     or v_result #>>
          '{result,sections,artifact_summary,kind_counts,0,kind}' <> 'photo'
     or (v_result #> '{result,sections}') ? 'deck_design_refs'
     or v_result::text like '%ops_deck_design:%' then
    raise exception
      'agent_site_visit_runtime_failed: artifact summary minted deck reference';
  end if;
end;
$artifact_summary_authority_contract$;

create temporary table agent_site_visit_runtime_context
on commit drop as
select public.read_agent_site_visit_context_as_system(
  'agent-site-visit-runtime-context',
  '8e100000-0000-4000-8000-000000000001',
  '8e000000-0000-4000-8000-000000000001',
  '8e130000-0000-4000-8000-000000000001',
  '8e120000-0000-4000-8000-000000000001',
  pg_catalog.md5('agent-site-visit-runtime-grant'),
  array[
    'ops.customers.read',
    'ops.files.read',
    'ops.jobs.read',
    'ops.schedule.read',
    'ops.site_visits.read'
  ]::text[],
  (select permission_snapshot_revision
   from agent_site_visit_runtime_deck_authority),
  array[
    'calendar.view', 'clients.view', 'deck_builder.view', 'photos.view',
    'pipeline.view'
  ]::text[],
  'get_site_visit_context',
  'get_site_visit_context:2026-08-22.v1',
  '2026-08-22.capability-manifest.v8',
  array[
    'ops.customers.read',
    'ops.files.read',
    'ops.jobs.read',
    'ops.schedule.read',
    'ops.site_visits.read'
  ]::text[],
  '{"calendar.view":"all","clients.view":"all","deck_builder.view":"all","photos.view":"all","pipeline.view":"all"}'::jsonb,
  '8e500000-0000-4000-8000-000000000001',
  'opportunity',
  '8e300000-0000-4000-8000-000000000001',
  array[
    'artifact_summary',
    'booking',
    'checklist_answers',
    'checklist_summary',
    'deck_design_refs',
    'lead',
    'measurements',
    'notes',
    'timeline'
  ]::text[],
  501,
  501,
  25,
  26,
  10
) as result;

do $context_result_contract$
declare
  v_result jsonb;
  v_public_result jsonb;
begin
  select result into strict v_result from agent_site_visit_runtime_context;
  v_public_result := v_result -> 'result';

  if v_result #>> '{anchor}' <> 'opportunity'
     or v_result ->> 'deck_builder_scope' <> 'all'
     or v_result #>> '{site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000001'
     or v_result #>> '{result,sections,notes,content_kind}' <>
       'untrusted_business_data'
     or v_result #>> '{result,sections,measurements,content_kind}' <>
       'untrusted_business_data'
     or v_result #>>
       '{result,sections,checklist_answers,content_kind}' <>
       'untrusted_business_data'
     or pg_catalog.jsonb_array_length(
       v_result #> '{result,sections,deck_design_refs}'
     ) <> 1
     or v_result #>>
       '{result,sections,deck_design_refs,0,deck_design_ref}' !~
       '^ops_deck_design:v1:[0-9a-f]{64}$'
     or v_result #>> '{source_inspected,artifacts}' <> '2'
     or v_result #>> '{source_inspected,deck_designs}' <> '1'
     or v_public_result::text like '%PRIVATE INTERNAL SITE VISIT NOTE%'
     or v_public_result::text like '%raw-site-visit-photo%'
     or v_public_result::text like '%private-original.jpg%'
     or v_public_result::text like '%raw_geometry_secret%' then
    raise exception
      'agent_site_visit_runtime_failed: unsafe or incomplete context projection: %',
      v_result;
  end if;
end;
$context_result_contract$;

create temporary table agent_site_visit_runtime_unlinked_design_context
on commit drop as
select public.read_agent_site_visit_context_as_system(
  'agent-site-visit-runtime-unlinked-design-context',
  '8e100000-0000-4000-8000-000000000001',
  '8e000000-0000-4000-8000-000000000001',
  '8e130000-0000-4000-8000-000000000001',
  '8e120000-0000-4000-8000-000000000001',
  pg_catalog.md5('agent-site-visit-runtime-grant'),
  array[
    'ops.customers.read',
    'ops.files.read',
    'ops.jobs.read',
    'ops.schedule.read',
    'ops.site_visits.read'
  ]::text[],
  (select permission_snapshot_revision
   from agent_site_visit_runtime_unlinked_deck_authority),
  array['deck_builder.view', 'photos.view', 'pipeline.view']::text[],
  'get_site_visit_context',
  'get_site_visit_context:2026-08-22.v1',
  '2026-08-22.capability-manifest.v8',
  array[
    'ops.files.read',
    'ops.jobs.read',
    'ops.site_visits.read'
  ]::text[],
  '{"deck_builder.view":"all","photos.view":"all","pipeline.view":"all"}'::jsonb,
  '8e500000-0000-4000-8000-000000000002',
  'unlinked',
  null,
  array['deck_design_refs']::text[],
  501,
  501,
  0,
  0,
  0
) as result;

do $unlinked_design_context_contract$
declare
  v_result jsonb;
begin
  select result into strict v_result
  from agent_site_visit_runtime_unlinked_design_context;
  if v_result #>> '{anchor}' <> 'unlinked'
     or v_result ->> 'deck_builder_scope' <> 'all'
     or v_result #>> '{site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000002'
     or pg_catalog.jsonb_array_length(
       v_result #> '{result,sections,deck_design_refs}'
     ) <> 0
     or v_result #>> '{source_inspected,artifacts}' <> '0'
     or v_result #>> '{source_inspected,deck_designs}' <> '0' then
    raise exception
      'agent_site_visit_runtime_failed: unlinked current-parent design excluded';
  end if;
end;
$unlinked_design_context_contract$;

create temporary table agent_site_visit_runtime_default_context
on commit drop as
select public.read_agent_site_visit_context_as_system(
  'agent-site-visit-runtime-default-context',
  '8e100000-0000-4000-8000-000000000001',
  '8e000000-0000-4000-8000-000000000001',
  '8e130000-0000-4000-8000-000000000001',
  '8e120000-0000-4000-8000-000000000001',
  pg_catalog.md5('agent-site-visit-runtime-grant'),
  array[
    'ops.customers.read',
    'ops.files.read',
    'ops.jobs.read',
    'ops.schedule.read',
    'ops.site_visits.read'
  ]::text[],
  (select permission_snapshot_revision
   from agent_site_visit_runtime_authority),
  array[
    'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
  ]::text[],
  'get_site_visit_context',
  'get_site_visit_context:2026-08-22.v1',
  '2026-08-22.capability-manifest.v8',
  array[
    'ops.customers.read',
    'ops.jobs.read',
    'ops.schedule.read',
    'ops.site_visits.read'
  ]::text[],
  '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
  '8e500000-0000-4000-8000-000000000001',
  'opportunity',
  '8e300000-0000-4000-8000-000000000001',
  array['booking', 'checklist_summary', 'lead', 'timeline']::text[],
  501,
  501,
  0,
  0,
  10
) as result;

do $opt_in_contract$
declare
  v_result jsonb;
begin
  select result into strict v_result
  from agent_site_visit_runtime_default_context;
  if (v_result #> '{result,sections}') ? 'notes'
     or (v_result #> '{result,sections}') ? 'measurements'
     or (v_result #> '{result,sections}') ? 'checklist_answers'
     or (v_result #> '{result,sections}') ? 'artifact_summary'
     or (v_result #> '{result,sections}') ? 'deck_design_refs' then
    raise exception
      'agent_site_visit_runtime_failed: opt-in section leaked';
  end if;
end;
$opt_in_contract$;

-- Both public statements must independently reject stale OAuth state. This
-- fixture helper calls each boundary for every mutation below; list rejects
-- with unauthorized, while context preserves its not-found-or-not-visible
-- privacy contract when the authority CTE produces no row.
create or replace function pg_temp.assert_site_visit_oauth_reads_rejected(
  p_case text
) returns void
language plpgsql
as $oauth_assertion$
begin
  begin
    perform public.read_agent_site_visits_as_system(
      'agent-site-visit-runtime-' || p_case || '-list',
      '8e100000-0000-4000-8000-000000000001',
      '8e000000-0000-4000-8000-000000000001',
      '8e130000-0000-4000-8000-000000000001',
      '8e120000-0000-4000-8000-000000000001',
      pg_catalog.md5('agent-site-visit-runtime-grant'),
      array[
        'ops.customers.read',
        'ops.files.read',
        'ops.jobs.read',
        'ops.schedule.read',
        'ops.site_visits.read'
      ]::text[],
      (select permission_snapshot_revision
       from agent_site_visit_runtime_authority),
      array[
        'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
      ]::text[],
      'list_site_visits',
      'list_site_visits:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array[
        'ops.customers.read',
        'ops.jobs.read',
        'ops.schedule.read',
        'ops.site_visits.read'
      ]::text[],
      '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
      'booked_appointments',
      (select read_at - interval '1 day'
       from agent_site_visit_runtime_clock),
      (select read_at + interval '1 day'
       from agent_site_visit_runtime_clock),
      array['in_progress', 'scheduled']::text[],
      false,
      null,
      null,
      25,
      26,
      501,
      null,
      '[]'::jsonb,
      null,
      null
    );
    raise exception
      'agent_site_visit_runtime_failed: % list accepted', p_case;
  exception
    when sqlstate '42501' then
      if sqlerrm <> 'agent_site_visit_read_unauthorized' then
        raise;
      end if;
  end;

  begin
    perform public.read_agent_site_visit_context_as_system(
      'agent-site-visit-runtime-' || p_case || '-context',
      '8e100000-0000-4000-8000-000000000001',
      '8e000000-0000-4000-8000-000000000001',
      '8e130000-0000-4000-8000-000000000001',
      '8e120000-0000-4000-8000-000000000001',
      pg_catalog.md5('agent-site-visit-runtime-grant'),
      array[
        'ops.customers.read',
        'ops.files.read',
        'ops.jobs.read',
        'ops.schedule.read',
        'ops.site_visits.read'
      ]::text[],
      (select permission_snapshot_revision
       from agent_site_visit_runtime_authority),
      array[
        'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
      ]::text[],
      'get_site_visit_context',
      'get_site_visit_context:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array[
        'ops.customers.read',
        'ops.jobs.read',
        'ops.schedule.read',
        'ops.site_visits.read'
      ]::text[],
      '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
      '8e500000-0000-4000-8000-000000000001',
      'opportunity',
      '8e300000-0000-4000-8000-000000000001',
      array['booking', 'checklist_summary', 'lead', 'timeline']::text[],
      501,
      501,
      0,
      0,
      10
    );
    raise exception
      'agent_site_visit_runtime_failed: % context accepted', p_case;
  exception
    when sqlstate 'P0002' then
      if sqlerrm <> 'agent_site_visit_not_found_or_not_visible' then
        raise;
      end if;
  end;
end;
$oauth_assertion$;

-- The following rollback-only authority probes deliberately create states
-- rejected by the production immutable-snapshot triggers and checks. Match the
-- task/artifact fixtures by bypassing those guards only for this hostile setup.
alter table private.mcp_oauth_clients
  drop constraint mcp_oauth_clients_scope_ceiling_valid;
alter table private.mcp_oauth_grants
  drop constraint mcp_oauth_grants_consent_snapshot_valid;
set local session_replication_role = replica;

do $current_oauth_state_contract$
begin
  update private.mcp_oauth_clients
     set disabled_at = pg_catalog.statement_timestamp()
   where client_id = '8e120000-0000-4000-8000-000000000001';
  perform pg_temp.assert_site_visit_oauth_reads_rejected('disabled-client');
  update private.mcp_oauth_clients
     set disabled_at = null
   where client_id = '8e120000-0000-4000-8000-000000000001';

  update private.mcp_oauth_clients
     set scope_ceiling = array[
       'ops.customers.read',
       'ops.files.read',
       'ops.jobs.read',
       'ops.schedule.read'
     ]::text[]
   where client_id = '8e120000-0000-4000-8000-000000000001';
  perform pg_temp.assert_site_visit_oauth_reads_rejected(
    'narrowed-client-ceiling'
  );
  update private.mcp_oauth_clients
     set scope_ceiling = array[
       'ops.customers.read',
       'ops.files.read',
       'ops.jobs.read',
       'ops.schedule.read',
       'ops.site_visits.read'
     ]::text[]
   where client_id = '8e120000-0000-4000-8000-000000000001';

  update private.mcp_oauth_clients
     set consent_catalog_revision = 'stale-consent-revision'
   where client_id = '8e120000-0000-4000-8000-000000000001';
  perform pg_temp.assert_site_visit_oauth_reads_rejected(
    'consent-revision-mismatch'
  );
  update private.mcp_oauth_clients
     set consent_catalog_revision = '2026-08-22.mcp-consent-catalog.v1'
   where client_id = '8e120000-0000-4000-8000-000000000001';

  update private.mcp_oauth_clients
     set exposure_revision = 'stale-exposure-revision'
   where client_id = '8e120000-0000-4000-8000-000000000001';
  perform pg_temp.assert_site_visit_oauth_reads_rejected(
    'exposure-revision-mismatch'
  );
  update private.mcp_oauth_clients
     set exposure_revision = '2026-08-22.mcp-exposure.v1'
   where client_id = '8e120000-0000-4000-8000-000000000001';

  update private.mcp_oauth_grants
     set accepted_labels = array['corrupted-consent-label']::text[]
   where id = '8e130000-0000-4000-8000-000000000001';
  perform pg_temp.assert_site_visit_oauth_reads_rejected(
    'corrupted-accepted-labels'
  );
  update private.mcp_oauth_grants
     set accepted_labels = private.mcp_oauth_labels_for_scopes(
       scopes,
       consent_catalog_revision
     )
   where id = '8e130000-0000-4000-8000-000000000001';
end;
$current_oauth_state_contract$;

set local session_replication_role = origin;

-- Task 10's private helper owns the raw artifact sentinel. Task 12 neither
-- catches nor remaps it in SQL: a context statement must propagate the exact
-- SQLSTATE/message even when a future helper hides all candidate rows later.
insert into public.site_visit_artifacts (
  id,
  site_visit_id,
  company_id,
  opportunity_id,
  kind,
  source,
  title,
  included_in_project_review,
  captured_at,
  created_by
)
select (
         '8e540000-0000-4000-8000-' ||
         pg_catalog.lpad(series.value::text, 12, '0')
       )::uuid,
       '8e500000-0000-4000-8000-000000000001',
       '8e000000-0000-4000-8000-000000000001',
       '8e300000-0000-4000-8000-000000000001',
       'note',
       'runtime-bound-fixture',
       'Bounded artifact fixture',
       false,
       clock.read_at - series.value * interval '1 millisecond',
       '8e100000-0000-4000-8000-000000000001'
from pg_catalog.generate_series(1, 500) series(value)
cross join agent_site_visit_runtime_clock clock;

do $artifact_source_bound_contract$
begin
  begin
    perform public.read_agent_site_visit_context_as_system(
      'agent-site-visit-runtime-artifact-source-bound',
      '8e100000-0000-4000-8000-000000000001',
      '8e000000-0000-4000-8000-000000000001',
      '8e130000-0000-4000-8000-000000000001',
      '8e120000-0000-4000-8000-000000000001',
      pg_catalog.md5('agent-site-visit-runtime-grant'),
      array[
        'ops.customers.read',
        'ops.files.read',
        'ops.jobs.read',
        'ops.schedule.read',
        'ops.site_visits.read'
      ]::text[],
      (select permission_snapshot_revision
       from agent_site_visit_runtime_authority),
      array[
        'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
      ]::text[],
      'get_site_visit_context',
      'get_site_visit_context:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array[
        'ops.customers.read',
        'ops.files.read',
        'ops.jobs.read',
        'ops.schedule.read',
        'ops.site_visits.read'
      ]::text[],
      '{"calendar.view":"all","clients.view":"all","photos.view":"all","pipeline.view":"all"}'::jsonb,
      '8e500000-0000-4000-8000-000000000001',
      'opportunity',
      '8e300000-0000-4000-8000-000000000001',
      array['artifact_summary']::text[],
      501,
      501,
      0,
      0,
      0
    );
    raise exception
      'agent_site_visit_runtime_failed: artifact source bound not propagated';
  exception
    when sqlstate '54000' then
      if sqlerrm <> 'agent_artifact_source_query_bound' then
        raise;
      end if;
  end;
end;
$artifact_source_bound_contract$;

create temporary table agent_site_visit_runtime_attention
on commit drop as
select private.agent_p2_site_visit_attention_v1(
  '8e100000-0000-4000-8000-000000000001',
  '8e000000-0000-4000-8000-000000000001',
  (select permission_snapshot_revision
   from agent_site_visit_runtime_authority),
  array[
    'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
  ]::text[],
  '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
  'booked_appointments',
  (select read_at - interval '1 day' from agent_site_visit_runtime_clock),
  (select read_at + interval '1 day' from agent_site_visit_runtime_clock),
  array['in_progress', 'scheduled']::text[],
  false,
  pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
  501,
  25
) as result;

do $attention_contract$
declare
  v_result jsonb;
  v_root_keys text[];
  v_card_keys text[];
begin
  select result into strict v_result
  from agent_site_visit_runtime_attention;

  select pg_catalog.array_agg(entry.key order by entry.key)
    into strict v_root_keys
  from pg_catalog.jsonb_object_keys(v_result) entry(key);

  select pg_catalog.array_agg(entry.key order by entry.key)
    into strict v_card_keys
  from pg_catalog.jsonb_object_keys(v_result #> '{cards,0}') entry(key);

  if v_result ->> 'projection_revision' <>
       'agent-p2-site-visit-attention:v1'
     or v_result ->> 'selector' <> 'booked_appointments'
     or v_root_keys is distinct from array[
       'cards',
       'has_more',
       'projection_revision',
       'read_at',
       'returned_count',
       'selector',
       'source_inspected_count',
       'source_versions'
     ]::text[]
     or pg_catalog.jsonb_array_length(v_result -> 'cards') <> 1
     or v_result ->> 'source_inspected_count' <> '2'
     or v_result ->> 'returned_count' <> '1'
     or (v_result ->> 'has_more')::boolean
     or pg_catalog.jsonb_array_length(v_result -> 'source_versions') <> 1
     or v_result #>> '{source_versions,0,source_domain}' <> 'site_visits'
     or v_result #>> '{source_versions,0,source_type}' <>
       'site_visit_read_revision'
     or v_result #>> '{source_versions,0,source_id}' <>
       'private.agent_read_domain_revisions:site_visits'
     or v_result #>> '{source_versions,0,version}' !~
       '^revision:(0|[1-9][0-9]{0,15})$'
     or v_card_keys is distinct from array[
       'attention_at',
       'booking_state',
       'card_kind',
       'opportunity_ref',
       'site_visit_ref',
       'status'
     ]::text[]
     or v_result #>> '{cards,0,card_kind}' <> 'site_visit'
     or v_result #>> '{cards,0,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000001'
     or v_result #>> '{cards,0,opportunity_ref,id}' <>
       '8e300000-0000-4000-8000-000000000001'
     or v_result #>> '{cards,0,status}' <> 'scheduled'
     or v_result #>> '{cards,0,booking_state}' <> 'booked'
     or v_result::text like '%8e500000-0000-4000-8000-000000000003%'
     or v_result::text like '%8e500000-0000-4000-8000-000000000004%' then
    raise exception
      'agent_site_visit_runtime_failed: attention projection invalid';
  end if;
end;
$attention_contract$;

create temporary table agent_site_visit_runtime_history_attention
on commit drop as
select private.agent_p2_site_visit_attention_v1(
  '8e100000-0000-4000-8000-000000000001',
  '8e000000-0000-4000-8000-000000000001',
  (select permission_snapshot_revision
   from agent_site_visit_runtime_authority),
  array[
    'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
  ]::text[],
  '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
  'visit_history',
  (select read_at - interval '7 days' from agent_site_visit_runtime_clock),
  (select read_at + interval '1 day' from agent_site_visit_runtime_clock),
  array[]::text[],
  true,
  pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
  501,
  25
) as result;

do $history_attention_contract$
declare
  v_result jsonb;
begin
  select result into strict v_result
  from agent_site_visit_runtime_history_attention;

  if v_result ->> 'selector' <> 'visit_history'
     or pg_catalog.jsonb_array_length(v_result -> 'cards') <> 2
     or v_result #>> '{cards,0,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000002'
     or v_result #> '{cards,0,opportunity_ref}' is distinct from 'null'::jsonb
     or v_result #>> '{cards,0,booking_state}' <> 'walk_up'
     or v_result #>> '{cards,1,site_visit_ref,id}' <>
       '8e500000-0000-4000-8000-000000000001'
     or v_result #>> '{cards,1,booking_state}' <> 'booked'
     or v_result::text like '%8e500000-0000-4000-8000-000000000003%'
     or v_result::text like '%8e500000-0000-4000-8000-000000000004%' then
    raise exception
      'agent_site_visit_runtime_failed: history attention projection invalid';
  end if;
end;
$history_attention_contract$;

-- Production writes use DEFAULT now() and clock_timestamp(), both of which
-- retain PostgreSQL microseconds. The public contract floors those instants to
-- milliseconds. Two different raw instants inside one millisecond must remain
-- a total order through the UUID tie-breaker on both list selectors.
create temporary table agent_site_visit_microsecond_clock
on commit drop as
select read_at + interval '10 days' as collision_at
from agent_site_visit_runtime_clock;

insert into public.site_visits (
  id,
  company_id,
  opportunity_id,
  client_id,
  client_ref,
  scheduled_at,
  booked_at,
  duration_minutes,
  assignee_ids,
  status,
  completed_at,
  created_by
) values (
  '8e590000-0000-4000-8000-000000000000',
  '8e000000-0000-4000-8000-000000000001',
  '8e300000-0000-4000-8000-000000000001',
  '8e200000-0000-4000-8000-000000000001',
  '8e200000-0000-4000-8000-000000000001',
  pg_catalog.clock_timestamp() + interval '1 hour',
  pg_catalog.clock_timestamp(),
  60,
  array['8e100000-0000-4000-8000-000000000001']::text[],
  'completed',
  pg_catalog.clock_timestamp(),
  '8e100000-0000-4000-8000-000000000001'
);

-- Preserve the production timestamp sources while making the sub-millisecond
-- witness deterministic even on a clock that happens to land on .000000.
update public.site_visits
set created_at = pg_catalog.date_trunc('milliseconds', created_at) +
      interval '111 microseconds',
    booked_at = pg_catalog.date_trunc('milliseconds', booked_at) +
      interval '333 microseconds',
    scheduled_at = pg_catalog.date_trunc('milliseconds', scheduled_at) +
      interval '555 microseconds',
    completed_at = pg_catalog.date_trunc('milliseconds', completed_at) +
      interval '777 microseconds'
where id = '8e590000-0000-4000-8000-000000000000';

do $production_microsecond_source_contract$
begin
  if not exists (
    select 1
    from public.site_visits visit
    where visit.id = '8e590000-0000-4000-8000-000000000000'
      and visit.created_at is distinct from
        pg_catalog.date_trunc('milliseconds', visit.created_at)
      and visit.booked_at is distinct from
        pg_catalog.date_trunc('milliseconds', visit.booked_at)
      and visit.scheduled_at is distinct from
        pg_catalog.date_trunc('milliseconds', visit.scheduled_at)
      and visit.completed_at is distinct from
        pg_catalog.date_trunc('milliseconds', visit.completed_at)
  ) then
    raise exception
      'agent_site_visit_runtime_failed: production microsecond source missing';
  end if;
end;
$production_microsecond_source_contract$;

create temporary table agent_site_visit_production_clock
on commit drop as
select pg_catalog.date_bin(
         interval '1 millisecond',
         visit.booked_at,
         timestamptz '2000-01-01 00:00:00+00'
       ) as booked_at,
       pg_catalog.date_bin(
         interval '1 millisecond',
         visit.scheduled_at,
         timestamptz '2000-01-01 00:00:00+00'
       ) as scheduled_at,
       pg_catalog.date_bin(
         interval '1 millisecond',
         visit.created_at,
         timestamptz '2000-01-01 00:00:00+00'
       ) as created_at,
       pg_catalog.date_bin(
         interval '1 millisecond',
         visit.completed_at,
         timestamptz '2000-01-01 00:00:00+00'
       ) as completed_at
from public.site_visits visit
where visit.id = '8e590000-0000-4000-8000-000000000000';

insert into public.site_visits (
  id,
  company_id,
  opportunity_id,
  client_id,
  client_ref,
  scheduled_at,
  booked_at,
  duration_minutes,
  assignee_ids,
  status,
  created_by,
  created_at
)
select source.id,
       '8e000000-0000-4000-8000-000000000001',
       '8e300000-0000-4000-8000-000000000001',
       '8e200000-0000-4000-8000-000000000001',
       '8e200000-0000-4000-8000-000000000001',
       clock.collision_at + interval '1 hour' + source.offset_value,
       clock.collision_at + source.offset_value,
       60,
       array['8e100000-0000-4000-8000-000000000001']::text[],
       'scheduled',
       '8e100000-0000-4000-8000-000000000001',
       clock.collision_at + source.offset_value
from agent_site_visit_microsecond_clock clock
cross join (
  values
    (
      '8e590000-0000-4000-8000-000000000001'::uuid,
      interval '100 microseconds'
    ),
    (
      '8e590000-0000-4000-8000-000000000002'::uuid,
      interval '900 microseconds'
    )
) source(id, offset_value);

do $production_microsecond_context_contract$
declare
  v_result jsonb;
  v_expected_booked_at text;
  v_expected_scheduled_at text;
  v_expected_created_at text;
  v_expected_completed_at text;
begin
  select private.agent_rfc3339_utc(clock.booked_at),
         private.agent_rfc3339_utc(clock.scheduled_at),
         private.agent_rfc3339_utc(clock.created_at),
         private.agent_rfc3339_utc(clock.completed_at)
    into strict
      v_expected_booked_at,
      v_expected_scheduled_at,
      v_expected_created_at,
      v_expected_completed_at
  from agent_site_visit_production_clock clock;

  begin
    select public.read_agent_site_visit_context_as_system(
      'agent-site-visit-runtime-production-microseconds',
      '8e100000-0000-4000-8000-000000000001',
      '8e000000-0000-4000-8000-000000000001',
      '8e130000-0000-4000-8000-000000000001',
      '8e120000-0000-4000-8000-000000000001',
      pg_catalog.md5('agent-site-visit-runtime-grant'),
      array[
        'ops.customers.read',
        'ops.files.read',
        'ops.jobs.read',
        'ops.schedule.read',
        'ops.site_visits.read'
      ]::text[],
      (select permission_snapshot_revision
       from agent_site_visit_runtime_authority),
      array[
        'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
      ]::text[],
      'get_site_visit_context',
      'get_site_visit_context:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array[
        'ops.customers.read',
        'ops.jobs.read',
        'ops.schedule.read',
        'ops.site_visits.read'
      ]::text[],
      '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
      '8e590000-0000-4000-8000-000000000000',
      'opportunity',
      '8e300000-0000-4000-8000-000000000001',
      array['booking', 'timeline']::text[],
      501,
      501,
      0,
      0,
      10
    ) into strict v_result;
  exception
    when others then
      raise exception
        'agent_site_visit_runtime_failed: production microsecond timestamp rejected: %',
        sqlerrm;
  end;

  if v_result #>> '{result,visit,booking,booked_at}' <>
       v_expected_booked_at
     or v_result #>> '{result,visit,booking,scheduled_start}' <>
       v_expected_scheduled_at
     or v_result #>> '{result,visit,created_at}' <>
       v_expected_created_at
     or v_result #>> '{result,visit,completed_at}' <>
       v_expected_completed_at then
    raise exception
      'agent_site_visit_runtime_failed: production microsecond timestamp rejected';
  end if;
end;
$production_microsecond_context_contract$;

create or replace function pg_temp.agent_site_visit_production_page(
  p_view_kind text
) returns jsonb
language sql
stable
set search_path = ''
as $function$
  select public.read_agent_site_visits_as_system(
    'agent-site-visit-runtime-production-' || p_view_kind,
    '8e100000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    '8e130000-0000-4000-8000-000000000001',
    '8e120000-0000-4000-8000-000000000001',
    pg_catalog.md5('agent-site-visit-runtime-grant'),
    array[
      'ops.customers.read',
      'ops.files.read',
      'ops.jobs.read',
      'ops.schedule.read',
      'ops.site_visits.read'
    ]::text[],
    (select permission_snapshot_revision
     from pg_temp.agent_site_visit_runtime_authority),
    array[
      'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
    ]::text[],
    'list_site_visits',
    'list_site_visits:2026-08-22.v1',
    '2026-08-22.capability-manifest.v8',
    array[
      'ops.customers.read',
      'ops.jobs.read',
      'ops.schedule.read',
      'ops.site_visits.read'
    ]::text[],
    '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
    p_view_kind,
    case when p_view_kind = 'booked_appointments'
      then clock.booked_at else clock.created_at end - interval '1 second',
    case when p_view_kind = 'booked_appointments'
      then clock.booked_at else clock.created_at end + interval '1 second',
    array['completed']::text[],
    false,
    null,
    null,
    25,
    26,
    501,
    null,
    '[]'::jsonb,
    null,
    null
  )
  from pg_temp.agent_site_visit_production_clock clock;
$function$;

do $production_microsecond_list_attention_contract$
declare
  v_booked jsonb;
  v_history jsonb;
  v_booked_attention jsonb;
  v_history_attention jsonb;
  v_expected_booked_at text;
  v_expected_created_at text;
begin
  select private.agent_rfc3339_utc(clock.booked_at),
         private.agent_rfc3339_utc(clock.created_at)
    into strict v_expected_booked_at, v_expected_created_at
  from agent_site_visit_production_clock clock;

  v_booked := pg_temp.agent_site_visit_production_page(
    'booked_appointments'
  );
  v_history := pg_temp.agent_site_visit_production_page('visit_history');

  if pg_catalog.jsonb_array_length(v_booked -> 'rows') <> 1
     or v_booked #>> '{rows,0,item,site_visit_ref,id}' <>
       '8e590000-0000-4000-8000-000000000000'
     or v_booked #>> '{rows,0,item,booking,booked_at}' <>
       v_expected_booked_at
     or v_booked #>> '{rows,0,predecessor,order,0}' <>
       v_expected_booked_at
     or pg_catalog.jsonb_array_length(v_history -> 'rows') <> 1
     or v_history #>> '{rows,0,item,site_visit_ref,id}' <>
       '8e590000-0000-4000-8000-000000000000'
     or v_history #>> '{rows,0,item,created_at}' <>
       v_expected_created_at
     or v_history #>> '{rows,0,predecessor,order,0}' <>
       v_expected_created_at then
    raise exception
      'agent_site_visit_runtime_failed: production microsecond list invalid';
  end if;

  v_booked_attention := private.agent_p2_site_visit_attention_v1(
    '8e100000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    (select permission_snapshot_revision
     from agent_site_visit_runtime_authority),
    array[
      'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
    ]::text[],
    '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
    'booked_appointments',
    (select booked_at - interval '1 second'
     from agent_site_visit_production_clock),
    (select booked_at + interval '1 second'
     from agent_site_visit_production_clock),
    array['completed']::text[],
    false,
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
    501,
    25
  );
  v_history_attention := private.agent_p2_site_visit_attention_v1(
    '8e100000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    (select permission_snapshot_revision
     from agent_site_visit_runtime_authority),
    array[
      'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
    ]::text[],
    '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
    'visit_history',
    (select created_at - interval '1 second'
     from agent_site_visit_production_clock),
    (select created_at + interval '1 second'
     from agent_site_visit_production_clock),
    array['completed']::text[],
    false,
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
    501,
    25
  );

  if pg_catalog.jsonb_array_length(v_booked_attention -> 'cards') <> 1
     or v_booked_attention #>> '{cards,0,site_visit_ref,id}' <>
       '8e590000-0000-4000-8000-000000000000'
     or v_booked_attention #>> '{cards,0,attention_at}' <>
       v_expected_booked_at
     or pg_catalog.jsonb_array_length(v_history_attention -> 'cards') <> 1
     or v_history_attention #>> '{cards,0,site_visit_ref,id}' <>
       '8e590000-0000-4000-8000-000000000000'
     or v_history_attention #>> '{cards,0,attention_at}' <>
       v_expected_created_at then
    raise exception
      'agent_site_visit_runtime_failed: production microsecond attention invalid';
  end if;
end;
$production_microsecond_list_attention_contract$;

create or replace function pg_temp.agent_site_visit_microsecond_page(
  p_view_kind text,
  p_cursor_read_at timestamptz,
  p_cursor_source_revisions jsonb,
  p_after_order_at timestamptz,
  p_after_site_visit_id uuid
) returns jsonb
language sql
stable
set search_path = ''
as $function$
  select public.read_agent_site_visits_as_system(
    'agent-site-visit-runtime-same-millisecond-' || p_view_kind,
    '8e100000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    '8e130000-0000-4000-8000-000000000001',
    '8e120000-0000-4000-8000-000000000001',
    pg_catalog.md5('agent-site-visit-runtime-grant'),
    array[
      'ops.customers.read',
      'ops.files.read',
      'ops.jobs.read',
      'ops.schedule.read',
      'ops.site_visits.read'
    ]::text[],
    (select permission_snapshot_revision
     from pg_temp.agent_site_visit_runtime_authority),
    array[
      'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
    ]::text[],
    'list_site_visits',
    'list_site_visits:2026-08-22.v1',
    '2026-08-22.capability-manifest.v8',
    array[
      'ops.customers.read',
      'ops.jobs.read',
      'ops.schedule.read',
      'ops.site_visits.read'
    ]::text[],
    '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
    p_view_kind,
    (select collision_at - interval '1 second'
     from pg_temp.agent_site_visit_microsecond_clock),
    (select collision_at + interval '1 second'
     from pg_temp.agent_site_visit_microsecond_clock),
    array['scheduled']::text[],
    false,
    null,
    null,
    1,
    2,
    501,
    p_cursor_read_at,
    p_cursor_source_revisions,
    p_after_order_at,
    p_after_site_visit_id
  );
$function$;

do $same_millisecond_list_contract$
declare
  v_booked_first jsonb;
  v_booked_second jsonb;
  v_history_first jsonb;
  v_history_second jsonb;
  v_expected_order_at text;
begin
  select private.agent_rfc3339_utc(collision_at)
    into strict v_expected_order_at
  from agent_site_visit_microsecond_clock;

  v_booked_first := pg_temp.agent_site_visit_microsecond_page(
    'booked_appointments', null, '[]'::jsonb, null, null
  );
  v_booked_second := pg_temp.agent_site_visit_microsecond_page(
    'booked_appointments',
    (v_booked_first ->> 'read_at')::timestamptz,
    v_booked_first -> 'source_revisions',
    (v_booked_first #>> '{rows,0,predecessor,order,0}')::timestamptz,
    (v_booked_first #>> '{rows,0,predecessor,tie_breaker}')::uuid
  );

  if pg_catalog.jsonb_array_length(v_booked_first -> 'rows') <> 1
     or pg_catalog.jsonb_array_length(v_booked_second -> 'rows') <> 1
     or v_booked_first #>> '{rows,0,item,site_visit_ref,id}' <>
       '8e590000-0000-4000-8000-000000000001'
     or v_booked_second #>> '{rows,0,item,site_visit_ref,id}' <>
       '8e590000-0000-4000-8000-000000000002'
     or v_booked_first #>> '{rows,0,predecessor,order,0}' <>
       v_expected_order_at
     or v_booked_second #>> '{rows,0,predecessor,order,0}' <>
       v_expected_order_at
     or not (v_booked_first ->> 'source_has_more')::boolean
     or (v_booked_second ->> 'source_has_more')::boolean then
    raise exception
      'agent_site_visit_runtime_failed: same-millisecond booked pagination invalid';
  end if;

  v_history_first := pg_temp.agent_site_visit_microsecond_page(
    'visit_history', null, '[]'::jsonb, null, null
  );
  v_history_second := pg_temp.agent_site_visit_microsecond_page(
    'visit_history',
    (v_history_first ->> 'read_at')::timestamptz,
    v_history_first -> 'source_revisions',
    (v_history_first #>> '{rows,0,predecessor,order,0}')::timestamptz,
    (v_history_first #>> '{rows,0,predecessor,tie_breaker}')::uuid
  );

  if pg_catalog.jsonb_array_length(v_history_first -> 'rows') <> 1
     or pg_catalog.jsonb_array_length(v_history_second -> 'rows') <> 1
     or v_history_first #>> '{rows,0,item,site_visit_ref,id}' <>
       '8e590000-0000-4000-8000-000000000002'
     or v_history_second #>> '{rows,0,item,site_visit_ref,id}' <>
       '8e590000-0000-4000-8000-000000000001'
     or v_history_first #>> '{rows,0,predecessor,order,0}' <>
       v_expected_order_at
     or v_history_second #>> '{rows,0,predecessor,order,0}' <>
       v_expected_order_at
     or not (v_history_first ->> 'source_has_more')::boolean
     or (v_history_second ->> 'source_has_more')::boolean then
    raise exception
      'agent_site_visit_runtime_failed: same-millisecond history pagination invalid';
  end if;
end;
$same_millisecond_list_contract$;

do $same_millisecond_attention_contract$
declare
  v_booked jsonb;
  v_history jsonb;
  v_expected_order_at text;
begin
  select private.agent_rfc3339_utc(collision_at)
    into strict v_expected_order_at
  from agent_site_visit_microsecond_clock;

  v_booked := private.agent_p2_site_visit_attention_v1(
    '8e100000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    (select permission_snapshot_revision
     from agent_site_visit_runtime_authority),
    array[
      'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
    ]::text[],
    '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
    'booked_appointments',
    (select collision_at - interval '1 second'
     from agent_site_visit_microsecond_clock),
    (select collision_at + interval '1 second'
     from agent_site_visit_microsecond_clock),
    array['scheduled']::text[],
    false,
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
    501,
    25
  );
  v_history := private.agent_p2_site_visit_attention_v1(
    '8e100000-0000-4000-8000-000000000001',
    '8e000000-0000-4000-8000-000000000001',
    (select permission_snapshot_revision
     from agent_site_visit_runtime_authority),
    array[
      'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
    ]::text[],
    '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
    'visit_history',
    (select collision_at - interval '1 second'
     from agent_site_visit_microsecond_clock),
    (select collision_at + interval '1 second'
     from agent_site_visit_microsecond_clock),
    array['scheduled']::text[],
    false,
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
    501,
    25
  );

  if pg_catalog.jsonb_array_length(v_booked -> 'cards') <> 2
     or v_booked #>> '{cards,0,site_visit_ref,id}' <>
       '8e590000-0000-4000-8000-000000000001'
     or v_booked #>> '{cards,1,site_visit_ref,id}' <>
       '8e590000-0000-4000-8000-000000000002'
     or v_booked #>> '{cards,0,attention_at}' <> v_expected_order_at
     or v_booked #>> '{cards,1,attention_at}' <> v_expected_order_at
     or pg_catalog.jsonb_array_length(v_history -> 'cards') <> 2
     or v_history #>> '{cards,0,site_visit_ref,id}' <>
       '8e590000-0000-4000-8000-000000000002'
     or v_history #>> '{cards,1,site_visit_ref,id}' <>
       '8e590000-0000-4000-8000-000000000001'
     or v_history #>> '{cards,0,attention_at}' <> v_expected_order_at
     or v_history #>> '{cards,1,attention_at}' <> v_expected_order_at then
    raise exception
      'agent_site_visit_runtime_failed: same-millisecond attention ordering invalid';
  end if;
end;
$same_millisecond_attention_contract$;

do $trigger_churn_contract$
declare
  v_before bigint;
  v_after_checklist bigint;
  v_after_all bigint;
  v_legacy_before bigint;
  v_legacy_after bigint;
begin
  select source_revision
    into strict v_before
  from private.agent_read_domain_revisions
  where company_id = '8e000000-0000-4000-8000-000000000001'
    and domain = 'site_visits';

  select source_revision
    into strict v_legacy_before
  from private.agent_operational_read_revisions
  where company_id = '8e000000-0000-4000-8000-000000000001';

  update public.site_visit_checklist_answers
     set label = 'Railing style confirmed'
   where id = '8e510000-0000-4000-8000-000000000001';

  select source_revision
    into strict v_after_checklist
  from private.agent_read_domain_revisions
  where company_id = '8e000000-0000-4000-8000-000000000001'
    and domain = 'site_visits';

  select source_revision
    into strict v_legacy_after
  from private.agent_operational_read_revisions
  where company_id = '8e000000-0000-4000-8000-000000000001';

  if v_after_checklist <= v_before then
    raise exception
      'agent_site_visit_runtime_failed: site visit revision did not advance';
  end if;
  if v_legacy_after is distinct from v_legacy_before then
    raise exception
      'agent_site_visit_runtime_failed: unrelated legacy revision changed';
  end if;

  update public.site_visits
     set notes = 'Customer confirmed glass on the back deck.'
   where id = '8e500000-0000-4000-8000-000000000001';
  update public.site_visit_artifacts
     set title = 'Carly deck design confirmed'
   where id = '8e530000-0000-4000-8000-000000000001';
  update public.opportunities
     set title = 'Carly Hunter deck confirmed'
   where id = '8e300000-0000-4000-8000-000000000001';
  update public.clients
     set name = 'Carly Hunter confirmed'
   where id = '8e200000-0000-4000-8000-000000000001';
  update public.projects
     set title = 'Carly Hunter project confirmed'
   where id = '8e400000-0000-4000-8000-000000000001';
  update public.project_tasks
     set custom_title = 'Confirm final railing measurements'
   where id = '8e420000-0000-4000-8000-000000000001';

  select source_revision
    into strict v_after_all
  from private.agent_read_domain_revisions
  where company_id = '8e000000-0000-4000-8000-000000000001'
    and domain = 'site_visits';

  if v_after_all < v_after_checklist + 6 then
    raise exception
      'agent_site_visit_runtime_failed: site visit dependency churn incomplete';
  end if;
end;
$trigger_churn_contract$;

do $revoked_grant_contract$
begin
  update private.mcp_oauth_grants
     set revoked_at = pg_catalog.statement_timestamp()
   where id = '8e130000-0000-4000-8000-000000000001';

  begin
    perform public.read_agent_site_visits_as_system(
      'agent-site-visit-runtime-revoked',
      '8e100000-0000-4000-8000-000000000001',
      '8e000000-0000-4000-8000-000000000001',
      '8e130000-0000-4000-8000-000000000001',
      '8e120000-0000-4000-8000-000000000001',
      pg_catalog.md5('agent-site-visit-runtime-grant'),
      array[
        'ops.customers.read',
        'ops.files.read',
        'ops.jobs.read',
        'ops.schedule.read',
        'ops.site_visits.read'
      ]::text[],
      (select permission_snapshot_revision
       from agent_site_visit_runtime_authority),
      array[
        'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
      ]::text[],
      'list_site_visits',
      'list_site_visits:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array[
        'ops.customers.read',
        'ops.jobs.read',
        'ops.schedule.read',
        'ops.site_visits.read'
      ]::text[],
      '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
      'booked_appointments',
      (select read_at - interval '1 day'
       from agent_site_visit_runtime_clock),
      (select read_at + interval '1 day'
       from agent_site_visit_runtime_clock),
      array['in_progress', 'scheduled']::text[],
      false,
      null,
      null,
      25,
      26,
      501,
      null,
      '[]'::jsonb,
      null,
      null
    );
    raise exception
      'agent_site_visit_runtime_failed: revoked grant accepted';
  exception
    when sqlstate '42501' then
      if sqlerrm <> 'agent_site_visit_read_unauthorized' then
        raise;
      end if;
  end;

  update private.mcp_oauth_grants
     set revoked_at = null
   where id = '8e130000-0000-4000-8000-000000000001';
end;
$revoked_grant_contract$;

insert into public.site_visits (
  id,
  company_id,
  scheduled_at,
  booked_at,
  created_by,
  created_at,
  status
)
select (
         '8e700000-0000-4000-8000-' ||
         pg_catalog.lpad(series.value::text, 12, '0')
       )::uuid,
       '8e000000-0000-4000-8000-000000000001',
       clock.read_at + series.value * interval '1 second',
       null,
       '8e100000-0000-4000-8000-000000000001',
       clock.read_at - interval '6 hours' +
         series.value * interval '1 second',
       'scheduled'
from pg_catalog.generate_series(1, 501) series(value)
cross join agent_site_visit_runtime_clock clock;

do $source_bound_contract$
begin
  begin
    perform public.read_agent_site_visits_as_system(
      'agent-site-visit-runtime-source-bound',
      '8e100000-0000-4000-8000-000000000001',
      '8e000000-0000-4000-8000-000000000001',
      '8e130000-0000-4000-8000-000000000001',
      '8e120000-0000-4000-8000-000000000001',
      pg_catalog.md5('agent-site-visit-runtime-grant'),
      array[
        'ops.customers.read',
        'ops.files.read',
        'ops.jobs.read',
        'ops.schedule.read',
        'ops.site_visits.read'
      ]::text[],
      (select permission_snapshot_revision
       from agent_site_visit_runtime_authority),
      array[
        'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
      ]::text[],
      'list_site_visits',
      'list_site_visits:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array[
        'ops.customers.read',
        'ops.jobs.read',
        'ops.schedule.read',
        'ops.site_visits.read'
      ]::text[],
      '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
      'visit_history',
      (select read_at - interval '7 days'
       from agent_site_visit_runtime_clock),
      (select read_at + interval '1 day'
       from agent_site_visit_runtime_clock),
      array[]::text[],
      true,
      null,
      null,
      25,
      26,
      501,
      null,
      '[]'::jsonb,
      null,
      null
    );
    raise exception
      'agent_site_visit_runtime_failed: source bound not enforced';
  exception
    when sqlstate '54000' then
      if sqlerrm <> 'agent_site_visit_source_query_bound' then
        raise;
      end if;
  end;

  begin
    perform private.agent_p2_site_visit_attention_v1(
      '8e100000-0000-4000-8000-000000000001',
      '8e000000-0000-4000-8000-000000000001',
      (select permission_snapshot_revision
       from agent_site_visit_runtime_authority),
      array[
        'calendar.view', 'clients.view', 'photos.view', 'pipeline.view'
      ]::text[],
      '{"calendar.view":"all","clients.view":"all","pipeline.view":"all"}'::jsonb,
      'visit_history',
      (select read_at - interval '7 days'
       from agent_site_visit_runtime_clock),
      (select read_at + interval '1 day'
       from agent_site_visit_runtime_clock),
      array[]::text[],
      true,
      pg_catalog.date_trunc(
        'milliseconds',
        pg_catalog.statement_timestamp()
      ),
      501,
      25
    );
    raise exception
      'agent_site_visit_runtime_failed: attention source bound not enforced';
  exception
    when sqlstate '54000' then
      if sqlerrm <> 'agent_p2_site_visit_attention_source_bound' then
        raise;
      end if;
  end;
end;
$source_bound_contract$;

rollback;
