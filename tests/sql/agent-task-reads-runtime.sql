begin;

-- Task 9 rollback-only PostgreSQL 17 acceptance fixture. It exercises exact
-- production-shaped column types and never commits fixture rows.
do $catalog_contract$
declare
  v_signature text;
  v_role text;
  v_volatility "char";
  v_security_definer boolean;
  v_config text[];
  v_column record;
  v_actual_type text;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000
     or pg_catalog.current_setting('server_version_num')::integer >= 180000 then
    raise exception
      'agent_task_runtime_failed: runtime_requires_postgresql_17';
  end if;

  for v_column in
    select expected.table_name,
           expected.column_name,
           expected.data_type
    from (values
      ('estimates'::text, 'project_id'::text, 'text'::text),
      ('estimates'::text, 'project_ref'::text, 'uuid'::text),
      ('project_notes'::text, 'company_id'::text, 'text'::text),
      ('project_notes'::text, 'project_id'::text, 'text'::text),
      ('project_tasks'::text, 'dependency_overrides'::text, 'jsonb'::text),
      ('project_tasks'::text, 'source_estimate_id'::text, 'text'::text),
      ('project_tasks'::text, 'source_line_item_id'::text, 'text'::text),
      ('task_materials'::text, 'quantity'::text, 'double precision'::text),
      ('catalog_variants'::text, 'quantity'::text, 'double precision'::text),
      ('line_items'::text, 'company_id'::text, 'uuid'::text),
      ('line_items'::text, 'estimate_id'::text, 'uuid'::text)
    ) expected(table_name, column_name, data_type)
  loop
    select pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
      into v_actual_type
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = pg_catalog.to_regclass(
            'public.' || v_column.table_name
          )
      and attribute.attname = v_column.column_name
      and attribute.attnum > 0
      and not attribute.attisdropped;

    if v_actual_type is distinct from v_column.data_type then
      raise exception
        'agent_task_runtime_failed: production column type mismatch %.%: %',
        v_column.table_name,
        v_column.column_name,
        coalesce(v_actual_type, '<missing>');
    end if;
  end loop;

  foreach v_signature in array array[
    'private.agent_p2_task_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,uuid,uuid,text[],timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)',
    'private.agent_p2_task_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,text,uuid,text[],integer,integer,integer)',
    'private.agent_p2_task_attention_v1(uuid,uuid,text,text[],text,text,timestamp with time zone,integer)',
    'public.read_agent_tasks_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,text,text,uuid,uuid,text[],timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)',
    'public.read_agent_task_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,text,uuid,text[],integer,integer,integer)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'agent_task_runtime_failed: missing %', v_signature;
    end if;

    select procedure.provolatile,
           procedure.prosecdef,
           procedure.proconfig
      into strict v_volatility, v_security_definer, v_config
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure(v_signature);

    if v_volatility is distinct from 's'
       or not (
         coalesce(v_config, array[]::text[])
         && array['search_path=', 'search_path=""']::text[]
       )
       or v_signature like 'private.%' and v_security_definer
       or v_signature like 'public.%' and not v_security_definer then
      raise exception 'agent_task_runtime_failed: unsafe attributes %',
        v_signature;
    end if;
  end loop;

  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_signature in array array[
      'private.agent_p2_task_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,uuid,uuid,text[],timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)',
      'private.agent_p2_task_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,text,uuid,text[],integer,integer,integer)',
      'private.agent_p2_task_attention_v1(uuid,uuid,text,text[],text,text,timestamp with time zone,integer)',
      'private.agent_p2_task_uuid_from_text(text)',
      'private.agent_p2_task_date_from_text(text)'
    ] loop
      if pg_catalog.has_function_privilege(v_role, v_signature, 'EXECUTE') then
        raise exception 'agent_task_runtime_failed: private execute % %',
          v_role, v_signature;
      end if;
    end loop;
  end loop;

  foreach v_signature in array array[
    'public.read_agent_tasks_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,text,text,uuid,uuid,text[],timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)',
    'public.read_agent_task_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,text,uuid,text[],integer,integer,integer)'
  ] loop
    if pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
       or pg_catalog.has_function_privilege(
         'authenticated', v_signature, 'EXECUTE'
       )
       or not pg_catalog.has_function_privilege(
         'service_role', v_signature, 'EXECUTE'
       ) then
      raise exception 'agent_task_runtime_failed: public acl mismatch %',
        v_signature;
    end if;
  end loop;
end;
$catalog_contract$;

set local role authenticated;

do $application_acl$
begin
  if pg_catalog.has_function_privilege(
       current_user,
       'public.read_agent_tasks_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,text,text,uuid,uuid,text[],timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       current_user,
       'public.read_agent_task_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,text,uuid,text[],integer,integer,integer)',
       'EXECUTE'
     ) then
    raise exception 'agent_task_runtime_failed: authenticated execute';
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

insert into public.companies (id, name) values
  (
    '8b000000-0000-4000-8000-000000000001',
    'Task read runtime company'
  ),
  (
    '8c000000-0000-4000-8000-000000000001',
    'Task read tenant-move company'
  );

insert into private.agent_operational_read_revisions (
  company_id,
  source_revision
) values
  ('8b000000-0000-4000-8000-000000000001', 0),
  ('8c000000-0000-4000-8000-000000000001', 0)
on conflict (company_id) do nothing;

insert into public.users (
  id,
  company_id,
  first_name,
  last_name,
  is_active,
  is_company_admin
) values (
  '8b100000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000001',
  'Runtime',
  'Task reader',
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
    '8b110000-0000-4000-8000-000000000001',
    '8b100000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    'calendar.view',
    'own',
    true
  ),
  (
    '8b110000-0000-4000-8000-000000000002',
    '8b100000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    'estimates.view',
    'all',
    true
  ),
  (
    '8b110000-0000-4000-8000-000000000003',
    '8b100000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    'projects.view',
    'assigned',
    true
  ),
  (
    '8b110000-0000-4000-8000-000000000004',
    '8b100000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    'projects.view_financials',
    'all',
    true
  ),
  (
    '8b110000-0000-4000-8000-000000000005',
    '8b100000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    'tasks.view',
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
  '8b120000-0000-4000-8000-000000000001',
  'Task read runtime client',
  array['https://claude.ai/api/mcp/auth_callback'],
  'none',
  array['authorization_code', 'refresh_token'],
  array['code'],
  'ops.financial_documents.read ops.schedule.read ops.tasks.read',
  'manual',
  array[
    'ops.financial_documents.read',
    'ops.schedule.read',
    'ops.tasks.read'
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
  '8b130000-0000-4000-8000-000000000001',
  '8b100000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000001',
  '8b120000-0000-4000-8000-000000000001',
  array[
    'ops.financial_documents.read',
    'ops.schedule.read',
    'ops.tasks.read'
  ]::text[],
  private.mcp_oauth_labels_for_scopes(
    array[
      'ops.financial_documents.read',
      'ops.schedule.read',
      'ops.tasks.read'
    ]::text[],
    '2026-08-22.mcp-consent-catalog.v1'
  ),
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1',
  pg_catalog.md5('agent-task-runtime-grant')
);

insert into public.clients (id, company_id, name) values
  (
    '8b200000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    'Carly Hunter'
  ),
  (
    '8c200000-0000-4000-8000-000000000001',
    '8c000000-0000-4000-8000-000000000001',
    'Tenant move client'
  );

insert into public.task_types (
  id,
  company_id,
  display,
  dependencies
) values
  (
    '8b300000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    'Set posts',
    '[]'::jsonb
  ),
  (
    '8b300000-0000-4000-8000-000000000002',
    '8b000000-0000-4000-8000-000000000001',
    'Install railing',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'depends_on_task_type_id',
      '8b300000-0000-4000-8000-000000000001'
    ))
  ),
  (
    '8b300000-0000-4000-8000-000000000003',
    '8b000000-0000-4000-8000-000000000001',
    'Site measure',
    '[]'::jsonb
  ),
  (
    '8c300000-0000-4000-8000-000000000001',
    '8c000000-0000-4000-8000-000000000001',
    'Tenant move task type',
    '[]'::jsonb
  );

insert into public.projects (
  id,
  company_id,
  client_id,
  title,
  status
) values
  (
    '8b400000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    '8b200000-0000-4000-8000-000000000001',
    'Carly Hunter deck',
    'in_progress'
  ),
  (
    '8b400000-0000-4000-8000-000000000002',
    '8b000000-0000-4000-8000-000000000001',
    '8b200000-0000-4000-8000-000000000001',
    'Other crew deck',
    'in_progress'
  ),
  (
    '8b400000-0000-4000-8000-000000000003',
    '8b000000-0000-4000-8000-000000000001',
    '8b200000-0000-4000-8000-000000000001',
    'Completed assignment deck',
    'in_progress'
  ),
  (
    '8b400000-0000-4000-8000-000000000004',
    '8b000000-0000-4000-8000-000000000001',
    '8b200000-0000-4000-8000-000000000001',
    'Mentioned deck',
    'in_progress'
  ),
  (
    '8b400000-0000-4000-8000-000000000005',
    '8b000000-0000-4000-8000-000000000001',
    '8b200000-0000-4000-8000-000000000001',
    'Cancelled assignment deck',
    'in_progress'
  ),
  (
    '8c400000-0000-4000-8000-000000000001',
    '8c000000-0000-4000-8000-000000000001',
    '8c200000-0000-4000-8000-000000000001',
    'Tenant move destination',
    'in_progress'
  );

insert into public.estimates (
  id,
  company_id,
  client_id,
  project_id,
  project_ref,
  estimate_number,
  status,
  issue_date,
  total,
  updated_at
) values
  (
    '8b500000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    '8b200000-0000-4000-8000-000000000001',
    'legacy-not-a-uuid',
    '8b400000-0000-4000-8000-000000000001',
    'RUNTIME-EST-1', 'draft', date '2026-08-29', 0,
    pg_catalog.statement_timestamp()
  ),
  (
    '8b500000-0000-4000-8000-000000000002',
    '8b000000-0000-4000-8000-000000000001',
    '8b200000-0000-4000-8000-000000000001',
    '8b400000-0000-4000-8000-000000000003',
    '8b400000-0000-4000-8000-000000000003',
    'RUNTIME-EST-2', 'draft', date '2026-08-29', 0,
    pg_catalog.statement_timestamp()
  ),
  (
    '8b500000-0000-4000-8000-000000000003',
    '8b000000-0000-4000-8000-000000000001',
    '8b200000-0000-4000-8000-000000000001',
    '8b400000-0000-4000-8000-000000000004',
    '8b400000-0000-4000-8000-000000000004',
    'RUNTIME-EST-3', 'draft', date '2026-08-29', 0,
    pg_catalog.statement_timestamp()
  ),
  (
    '8b500000-0000-4000-8000-000000000004',
    '8b000000-0000-4000-8000-000000000001',
    '8b200000-0000-4000-8000-000000000001',
    '8b400000-0000-4000-8000-000000000005',
    '8b400000-0000-4000-8000-000000000005',
    'RUNTIME-EST-4', 'draft', date '2026-08-29', 0,
    pg_catalog.statement_timestamp()
  ),
  (
    '8b500000-0000-4000-8000-000000000005',
    '8b000000-0000-4000-8000-000000000001',
    '8b200000-0000-4000-8000-000000000001',
    '8b400000-0000-4000-8000-000000000002',
    '8b400000-0000-4000-8000-000000000002',
    'RUNTIME-EST-5', 'draft', date '2026-08-29', 0,
    pg_catalog.statement_timestamp()
  );

insert into public.line_items (
  id,
  company_id,
  estimate_id,
  name,
  quantity,
  unit_price,
  sort_order
) values
  (
    '8b510000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    '8b500000-0000-4000-8000-000000000001',
    'Glass railing installation', 1, 0, 0
  ),
  (
    '8b510000-0000-4000-8000-000000000002',
    '8b000000-0000-4000-8000-000000000001',
    '8b500000-0000-4000-8000-000000000002',
    'Completed-assignment financial origin', 1, 0, 0
  ),
  (
    '8b510000-0000-4000-8000-000000000003',
    '8b000000-0000-4000-8000-000000000001',
    '8b500000-0000-4000-8000-000000000003',
    'Mention financial origin', 1, 0, 0
  ),
  (
    '8b510000-0000-4000-8000-000000000004',
    '8b000000-0000-4000-8000-000000000001',
    '8b500000-0000-4000-8000-000000000004',
    'Cancelled-assignment financial origin', 1, 0, 0
  ),
  (
    '8b510000-0000-4000-8000-000000000005',
    '8b000000-0000-4000-8000-000000000001',
    '8b500000-0000-4000-8000-000000000005',
    'Unrelated financial origin', 1, 0, 0
  );

insert into public.catalog_items (
  id,
  company_id,
  name
) values (
  '8b520000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000001',
  'Glass panel'
);

insert into public.catalog_variants (
  id,
  company_id,
  catalog_item_id,
  quantity
) values (
  '8b530000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000001',
  '8b520000-0000-4000-8000-000000000001',
  1
);

insert into public.company_inventory_settings (
  company_id,
  inventory_mode,
  enabled_at,
  updated_by
) values (
  '8b000000-0000-4000-8000-000000000001',
  'tracked',
  pg_catalog.statement_timestamp(),
  '8b100000-0000-4000-8000-000000000001'
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
  '8b600000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000001',
  '8b400000-0000-4000-8000-000000000001',
  '8b300000-0000-4000-8000-000000000001',
  'Set posts',
  'active',
  array['8b100000-0000-4000-8000-000000000001']::text[]
);

insert into public.project_tasks (
  id,
  company_id,
  project_id,
  task_type_id,
  custom_title,
  task_notes,
  dependency_overrides,
  source_estimate_id,
  source_line_item_id,
  status,
  start_date,
  end_date,
  team_member_ids
) values (
  '8b600000-0000-4000-8000-000000000002',
  '8b000000-0000-4000-8000-000000000001',
  '8b400000-0000-4000-8000-000000000001',
  '8b300000-0000-4000-8000-000000000002',
  'Install back-deck glass',
  'Customer marked the back deck as glass.',
  null::jsonb,
  '8b500000-0000-4000-8000-000000000001',
  '8b510000-0000-4000-8000-000000000001',
  'active',
  pg_catalog.date_trunc(
    'milliseconds', pg_catalog.statement_timestamp() + interval '1 day'
  ),
  pg_catalog.date_trunc(
    'milliseconds', pg_catalog.statement_timestamp() + interval '2 days'
  ),
  array[]::text[]
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
  '8b600000-0000-4000-8000-000000000003',
  '8b000000-0000-4000-8000-000000000001',
  '8b400000-0000-4000-8000-000000000001',
  '8b300000-0000-4000-8000-000000000003',
  'Completed site measure',
  'completed',
  array[]::text[]
);

insert into public.project_tasks (
  id,
  company_id,
  project_id,
  task_type_id,
  custom_title,
  status,
  start_date,
  end_date,
  team_member_ids
) values
  (
    '8b650000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    '8b400000-0000-4000-8000-000000000003',
    '8b300000-0000-4000-8000-000000000001',
    'Completed assigned predecessor',
    'completed',
    pg_catalog.date_trunc(
      'milliseconds', pg_catalog.statement_timestamp() - interval '3 days'
    ),
    pg_catalog.date_trunc(
      'milliseconds', pg_catalog.statement_timestamp() - interval '2 days'
    ),
    array['8b100000-0000-4000-8000-000000000001']::text[]
  ),
  (
    '8b650000-0000-4000-8000-000000000002',
    '8b000000-0000-4000-8000-000000000001',
    '8b400000-0000-4000-8000-000000000003',
    '8b300000-0000-4000-8000-000000000002',
    'Visible through completed project assignment',
    'active',
    pg_catalog.date_trunc(
      'milliseconds', pg_catalog.statement_timestamp() + interval '4 days'
    ),
    pg_catalog.date_trunc(
      'milliseconds', pg_catalog.statement_timestamp() + interval '5 days'
    ),
    array[]::text[]
  ),
  (
    '8b660000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    '8b400000-0000-4000-8000-000000000004',
    '8b300000-0000-4000-8000-000000000001',
    'Visible through project note mention',
    'active',
    pg_catalog.date_trunc(
      'milliseconds', pg_catalog.statement_timestamp() + interval '6 days'
    ),
    pg_catalog.date_trunc(
      'milliseconds', pg_catalog.statement_timestamp() + interval '7 days'
    ),
    array[]::text[]
  ),
  (
    '8b690000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    '8b400000-0000-4000-8000-000000000005',
    '8b300000-0000-4000-8000-000000000001',
    'Cancelled project assignment',
    'cancelled',
    pg_catalog.date_trunc(
      'milliseconds', pg_catalog.statement_timestamp() - interval '4 days'
    ),
    pg_catalog.date_trunc(
      'milliseconds', pg_catalog.statement_timestamp() - interval '3 days'
    ),
    array['8b100000-0000-4000-8000-000000000001']::text[]
  ),
  (
    '8b690000-0000-4000-8000-000000000002',
    '8b000000-0000-4000-8000-000000000001',
    '8b400000-0000-4000-8000-000000000005',
    '8b300000-0000-4000-8000-000000000001',
    'Completed predecessor in cancelled-member project',
    'completed',
    pg_catalog.date_trunc(
      'milliseconds', pg_catalog.statement_timestamp() - interval '2 days'
    ),
    pg_catalog.date_trunc(
      'milliseconds', pg_catalog.statement_timestamp() - interval '1 day'
    ),
    array[]::text[]
  ),
  (
    '8b690000-0000-4000-8000-000000000003',
    '8b000000-0000-4000-8000-000000000001',
    '8b400000-0000-4000-8000-000000000005',
    '8b300000-0000-4000-8000-000000000002',
    'Visible through cancelled project assignment',
    'active',
    pg_catalog.date_trunc(
      'milliseconds', pg_catalog.statement_timestamp() + interval '8 days'
    ),
    pg_catalog.date_trunc(
      'milliseconds', pg_catalog.statement_timestamp() + interval '9 days'
    ),
    array[]::text[]
  );

update public.project_tasks task
set source_estimate_id = origin.estimate_id,
    source_line_item_id = origin.line_item_id
from (values
  (
    '8b650000-0000-4000-8000-000000000002'::uuid,
    '8b500000-0000-4000-8000-000000000002'::text,
    '8b510000-0000-4000-8000-000000000002'::text
  ),
  (
    '8b660000-0000-4000-8000-000000000001'::uuid,
    '8b500000-0000-4000-8000-000000000003'::text,
    '8b510000-0000-4000-8000-000000000003'::text
  ),
  (
    '8b690000-0000-4000-8000-000000000003'::uuid,
    '8b500000-0000-4000-8000-000000000004'::text,
    '8b510000-0000-4000-8000-000000000004'::text
  )
) origin(task_id, estimate_id, line_item_id)
where task.id = origin.task_id;

insert into public.project_notes (
  id,
  project_id,
  company_id,
  author_id,
  content,
  mentioned_user_ids
) values (
  '8b670000-0000-4000-8000-000000000001',
  '8b400000-0000-4000-8000-000000000004',
  '8b000000-0000-4000-8000-000000000001',
  '8b100000-0000-4000-8000-000000000001',
  'Runtime access mention',
  array['8b100000-0000-4000-8000-000000000001']::text[]
);

insert into public.project_tasks (
  id,
  company_id,
  project_id,
  task_type_id,
  custom_title,
  status,
  start_date,
  end_date,
  team_member_ids
)
select (
         '8b610000-0000-4000-8000-' ||
         pg_catalog.lpad(series.value::text, 12, '0')
       )::uuid,
       '8b000000-0000-4000-8000-000000000001'::uuid,
       '8b400000-0000-4000-8000-000000000001'::uuid,
       '8b300000-0000-4000-8000-000000000002'::uuid,
       'Install railing ' || series.value::text,
       'active',
       pg_catalog.date_trunc(
         'milliseconds',
         pg_catalog.statement_timestamp() +
           series.value * interval '1 day' + interval '2 days'
       ),
       pg_catalog.date_trunc(
         'milliseconds',
         pg_catalog.statement_timestamp() +
           series.value * interval '1 day' + interval '3 days'
       ),
       array['8b100000-0000-4000-8000-000000000001']::text[]
from pg_catalog.generate_series(1, 25) series(value);

insert into public.project_tasks (
  id,
  company_id,
  project_id,
  task_type_id,
  custom_title,
  status,
  start_date,
  team_member_ids,
  deleted_at
) values (
  '8b620000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000001',
  '8b400000-0000-4000-8000-000000000001',
  '8b300000-0000-4000-8000-000000000002',
  'Soft deleted task',
  'active',
  pg_catalog.date_trunc(
    'milliseconds', pg_catalog.statement_timestamp() + interval '1 hour'
  ),
  array['8b100000-0000-4000-8000-000000000001']::text[],
  pg_catalog.statement_timestamp()
);

insert into public.project_tasks (
  id,
  company_id,
  project_id,
  task_type_id,
  custom_title,
  status,
  start_date,
  team_member_ids
) values (
  '8b630000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000001',
  '8b400000-0000-4000-8000-000000000002',
  '8b300000-0000-4000-8000-000000000002',
  'Other crew task',
  'active',
  pg_catalog.date_trunc(
    'milliseconds', pg_catalog.statement_timestamp() + interval '1 hour'
  ),
  array[]::text[]
);

update public.project_tasks
set source_estimate_id = '8b500000-0000-4000-8000-000000000005',
    source_line_item_id = '8b510000-0000-4000-8000-000000000005'
where id = '8b630000-0000-4000-8000-000000000001';

-- Prove the broad canonical keyset on a realistically selective tenant. The
-- rows exist only for EXPLAIN ANALYZE and are removed before behavioral reads.
-- Revision triggers are intentionally suppressed for this synthetic planner
-- population; the independently tested functional rows exercise them below.
create function pg_temp.assert_task_hostile_plan(
  p_plan jsonb,
  p_case text,
  p_relation text,
  p_index text,
  p_expected_index_rows integer
)
returns void
language plpgsql
volatile
set search_path = ''
as $function$
declare
  v_index_nodes integer;
  v_index_rows integer;
  v_index_removed integer;
  v_index_loops integer;
  v_heap_fetches integer;
  v_exact_heap_blocks integer;
  v_lossy_heap_blocks integer;
  v_shared_hit_blocks integer;
  v_shared_read_blocks integer;
  v_bad_relation_scan boolean;
  v_bad_relation_work boolean;
  v_bad_relation_buffers boolean;
  v_bad_sort_or_limit boolean;
begin
  select pg_catalog.count(*) filter (
           where node.value ->> 'Index Name' = p_index
             and (node.value ->> 'Actual Loops')::integer > 0
         )::integer,
         pg_catalog.max((node.value ->> 'Actual Rows')::integer) filter (
           where node.value ->> 'Index Name' = p_index
         ),
         pg_catalog.max(coalesce(
           (node.value ->> 'Rows Removed by Filter')::integer,
           0
         )) filter (where node.value ->> 'Index Name' = p_index),
         pg_catalog.max((node.value ->> 'Actual Loops')::integer) filter (
           where node.value ->> 'Index Name' = p_index
         ),
         pg_catalog.max(coalesce(
           (node.value ->> 'Heap Fetches')::integer,
           0
         )) filter (where node.value ->> 'Index Name' = p_index),
         pg_catalog.max(coalesce(
           (node.value ->> 'Exact Heap Blocks')::integer,
           0
         )) filter (where node.value ->> 'Relation Name' = p_relation),
         pg_catalog.max(coalesce(
           (node.value ->> 'Lossy Heap Blocks')::integer,
           0
         )) filter (where node.value ->> 'Relation Name' = p_relation),
         pg_catalog.max(coalesce(
           (node.value ->> 'Shared Hit Blocks')::integer,
           0
         )) filter (where node.value ->> 'Index Name' = p_index),
         pg_catalog.max(coalesce(
           (node.value ->> 'Shared Read Blocks')::integer,
           0
         )) filter (where node.value ->> 'Index Name' = p_index),
         coalesce(pg_catalog.bool_or(
           node.value ->> 'Relation Name' = p_relation
           and node.value ->> 'Node Type' = 'Seq Scan'
           and (node.value ->> 'Actual Loops')::integer > 0
         ), false),
         coalesce(pg_catalog.bool_or(
           node.value ->> 'Relation Name' = p_relation
           and (
             (node.value ->> 'Actual Rows')::integer
             + coalesce(
                 (node.value ->> 'Rows Removed by Filter')::integer,
                 0
               )
             + coalesce(
                 (node.value ->> 'Rows Removed by Join Filter')::integer,
                 0
               )
             + coalesce(
                 (node.value ->> 'Rows Removed by Index Recheck')::integer,
                 0
               )
           ) * (node.value ->> 'Actual Loops')::integer > 501
         ), false),
         coalesce(pg_catalog.bool_or(
           (
             node.value ->> 'Relation Name' = p_relation
             or node.value ->> 'Index Name' = p_index
           )
           and coalesce(
                 (node.value ->> 'Shared Hit Blocks')::integer,
                 0
               )
             + coalesce(
                 (node.value ->> 'Shared Read Blocks')::integer,
                 0
               ) > 501
         ), false),
         coalesce(pg_catalog.bool_or(
           node.value ->> 'Node Type' in ('Sort', 'Incremental Sort', 'Limit')
           and (node.value ->> 'Actual Rows')::integer
             * (node.value ->> 'Actual Loops')::integer > 501
         ), false)
    into v_index_nodes,
         v_index_rows,
         v_index_removed,
         v_index_loops,
         v_heap_fetches,
         v_exact_heap_blocks,
         v_lossy_heap_blocks,
         v_shared_hit_blocks,
         v_shared_read_blocks,
         v_bad_relation_scan,
         v_bad_relation_work,
         v_bad_relation_buffers,
         v_bad_sort_or_limit
  from pg_catalog.jsonb_path_query(
    p_plan,
    'strict $[*].** ? (exists(@."Node Type"))'
  ) node(value);

  if v_index_nodes <> 1
     or v_index_rows is distinct from p_expected_index_rows
     or v_index_loops is null
     or v_index_loops not between 1 and 501
     or v_index_rows * v_index_loops > 501
     or coalesce(v_index_removed, 0) * v_index_loops > 501
     or coalesce(v_heap_fetches, 0) > 501
     or coalesce(v_exact_heap_blocks, 0)
       + coalesce(v_lossy_heap_blocks, 0) > 501
     or coalesce(v_shared_hit_blocks, 0) > 501
     or coalesce(v_shared_read_blocks, 0) > 501
     or v_bad_relation_scan
     or v_bad_relation_work
     or v_bad_relation_buffers
     or v_bad_sort_or_limit then
    raise exception
      'agent_task_runtime_failed: % invalid: index %, actual rows %, rows removed by filter %, actual loops %, heap fetches %, exact heap blocks %, lossy heap blocks %, shared hit blocks %, shared read blocks %',
      p_case,
      p_index,
      v_index_rows,
      coalesce(v_index_removed, 0),
      v_index_loops,
      coalesce(v_heap_fetches, 0),
      coalesce(v_exact_heap_blocks, 0),
      coalesce(v_lossy_heap_blocks, 0),
      coalesce(v_shared_hit_blocks, 0),
      coalesce(v_shared_read_blocks, 0);
  end if;
end;
$function$;

create function pg_temp.assert_task_plan_aliases_not_executed(
  p_plan jsonb,
  p_case text,
  p_aliases text[]
)
returns void
language plpgsql
volatile
set search_path = ''
as $function$
declare
  v_alias text;
  v_node_count integer;
  v_executed boolean;
begin
  foreach v_alias in array p_aliases
  loop
    select pg_catalog.count(*)::integer,
           coalesce(pg_catalog.bool_or(
             (node.value ->> 'Actual Loops')::integer > 0
           ), false)
      into v_node_count, v_executed
    from pg_catalog.jsonb_path_query(
      p_plan,
      'strict $[*].** ? (exists(@."Node Type"))'
    ) node(value)
    where node.value ->> 'Alias' = v_alias;

    if v_node_count <> 1 or v_executed then
      raise exception
        'agent_task_runtime_failed: % raw gate executed downstream alias %',
        p_case,
        v_alias;
    end if;
  end loop;
end;
$function$;

set local session_replication_role = replica;

insert into public.project_tasks (
  id,
  company_id,
  project_id,
  task_type_id,
  custom_title,
  status,
  start_date,
  end_date,
  team_member_ids,
  schedule_version,
  schedule_confirmed_at,
  confirmed_schedule_version
)
select (
         '8bf00000-0000-4000-8000-' ||
         pg_catalog.lpad(series.value::text, 12, '0')
       )::uuid,
       '8b000000-0000-4000-8000-000000000001'::uuid,
       '8b400000-0000-4000-8000-000000000001'::uuid,
       '8b300000-0000-4000-8000-000000000002'::uuid,
       'Planner task ' || series.value::text,
       'active',
       timestamptz '2027-01-01 00:00:00+00' +
         series.value * interval '1 hour',
       timestamptz '2027-01-01 01:00:00+00' +
         series.value * interval '1 hour',
       array['8b100000-0000-4000-8000-000000000001']::text[],
       0,
       timestamptz '2026-12-31 00:00:00+00',
       0
from pg_catalog.generate_series(1, 50000) series(value);

insert into public.project_tasks (
  id,
  company_id,
  project_id,
  task_type_id,
  custom_title,
  status,
  start_date,
  end_date,
  team_member_ids,
  schedule_version,
  schedule_confirmed_at,
  confirmed_schedule_version
)
select (
         '8bc00000-0000-4000-8000-' ||
         pg_catalog.lpad(series.value::text, 12, '0')
       )::uuid,
       '8b000000-0000-4000-8000-000000000001'::uuid,
       '8b400000-0000-4000-8000-000000000001'::uuid,
       '8b300000-0000-4000-8000-000000000001'::uuid,
       'Dependency bound predecessor ' || series.value::text,
       'active',
       timestamptz '2027-01-01 00:00:00+00' +
         series.value * interval '1 hour',
       timestamptz '2027-01-01 01:00:00+00' +
         series.value * interval '1 hour',
       array[]::text[],
       0,
       timestamptz '2026-12-31 00:00:00+00',
       0
from pg_catalog.generate_series(1, 501) series(value);

insert into public.project_tasks (
  id,
  company_id,
  project_id,
  task_type_id,
  custom_title,
  status,
  start_date,
  end_date,
  team_member_ids,
  schedule_version,
  schedule_confirmed_at,
  confirmed_schedule_version
)
select (
         '8be00000-0000-4000-8000-' ||
         pg_catalog.lpad(series.value::text, 12, '0')
       )::uuid,
       '8c000000-0000-4000-8000-000000000001'::uuid,
       '8c400000-0000-4000-8000-000000000001'::uuid,
       '8c300000-0000-4000-8000-000000000001'::uuid,
       'Cross-company planner task ' || series.value::text,
       'active',
       timestamptz '2027-01-01 00:00:00+00' +
         series.value * interval '1 hour',
       timestamptz '2027-01-01 01:00:00+00' +
         series.value * interval '1 hour',
       array[]::text[],
       0,
       timestamptz '2026-12-31 00:00:00+00',
       0
from pg_catalog.generate_series(1, 50000) series(value);

set local session_replication_role = origin;
analyze public.project_tasks;

do $task_list_plan_contract$
declare
  v_case text;
  v_predicate text;
  v_plan jsonb;
  v_index_rows integer;
  v_rows_removed integer;
  v_index_loops integer;
  v_base_node_count integer;
  v_executed_seq_scan boolean;
begin
  for v_case, v_predicate in
    select scenario.case_name, scenario.predicate
    from (values
      (
        'task plan job',
        $$task.project_id = '8b400000-0000-4000-8000-000000000002'::uuid$$
      ),
      (
        'task plan assignee',
        $$'8b100000-0000-4000-8000-000000000002'::text = any(coalesce(task.team_member_ids, array[]::text[]))$$
      ),
      ('task plan status', $$task.status = any(array['cancelled']::text[])$$),
      (
        'task plan schedule_window',
        $$task.start_date < timestamptz '2020-01-02 00:00:00+00' and coalesce(task.end_date, task.start_date) >= timestamptz '2020-01-01 00:00:00+00'$$
      ),
      (
        'task plan overdue',
        $$task.status = 'active' and coalesce(task.end_date, task.start_date) < timestamptz '2020-01-01 00:00:00+00'$$
      ),
      (
        'task plan unassigned',
        $$pg_catalog.cardinality(coalesce(task.team_member_ids, array[]::text[])) = 0$$
      ),
      (
        'task plan actionable',
        $$task.status = 'active' and (pg_catalog.cardinality(coalesce(task.team_member_ids, array[]::text[])) = 0 or coalesce(task.end_date, task.start_date) < timestamptz '2026-12-30 00:00:00+00' or task.start_date is not null and (task.schedule_confirmed_at is null or task.confirmed_schedule_version is distinct from task.schedule_version))$$
      ),
      (
        'task plan assigned_noise',
        $$'8b100000-0000-4000-8000-000000000001'::text = any(coalesce(task.team_member_ids, array[]::text[]))$$
      )
    ) scenario(case_name, predicate)
  loop
    execute pg_catalog.format($explain$
      explain (analyze, buffers, format json)
      with task_source_gate as materialized (
        select task.id as task_id,
               task.project_id,
               task.status,
               task.start_date,
               task.end_date,
               task.team_member_ids,
               task.schedule_version,
               task.schedule_confirmed_at,
               task.confirmed_schedule_version,
               coalesce(
                 case
                   when task.start_date is not null
                    and pg_catalog.isfinite(task.start_date)
                    and extract(
                      year from task.start_date at time zone 'UTC'
                    ) between 1 and 9999
                     then (task.start_date at time zone 'UTC')::date
                 end,
                 date '9999-12-31'
               ) as order_date
        from public.project_tasks task
        where task.company_id =
                '8b000000-0000-4000-8000-000000000001'::uuid
          and task.deleted_at is null
          and task.status in ('active', 'cancelled', 'completed')
          and (
            coalesce(
              case
                when task.start_date is not null
                 and pg_catalog.isfinite(task.start_date)
                 and extract(
                   year from task.start_date at time zone 'UTC'
                 ) between 1 and 9999
                  then (task.start_date at time zone 'UTC')::date
              end,
              date '9999-12-31'
            ),
            task.id
          ) > (
            date '2027-01-01',
            '00000000-0000-4000-8000-000000000000'::uuid
          )
        order by coalesce(
                   case
                     when task.start_date is not null
                      and pg_catalog.isfinite(task.start_date)
                      and extract(
                        year from task.start_date at time zone 'UTC'
                      ) between 1 and 9999
                       then (task.start_date at time zone 'UTC')::date
                   end,
                   date '9999-12-31'
                 ),
                 task.id
        limit 501
      ), task_source_state as materialized (
        select pg_catalog.count(*)::integer as source_count
        from task_source_gate
      ), filtered_task_source as materialized (
        select task.*
        from task_source_gate task
        cross join task_source_state task_state
        where task_state.source_count < 501
          and (%s)
      )
      select pg_catalog.count(*)
      from filtered_task_source
    $explain$, v_predicate) into v_plan;

    select pg_catalog.count(*)::integer,
           pg_catalog.max(
             (node.value ->> 'Actual Rows')::integer
           ) filter (
             where node.value ->> 'Index Name' =
               'idx_project_tasks_agent_list_order_v1'
           ),
           pg_catalog.max(
             coalesce(
               (node.value ->> 'Rows Removed by Filter')::integer,
               0
             )
           ) filter (
             where node.value ->> 'Index Name' =
               'idx_project_tasks_agent_list_order_v1'
           ),
           pg_catalog.max(
             (node.value ->> 'Actual Loops')::integer
           ) filter (
             where node.value ->> 'Index Name' =
               'idx_project_tasks_agent_list_order_v1'
           ),
           coalesce(pg_catalog.bool_or(
             node.value ->> 'Node Type' = 'Seq Scan'
             and (node.value ->> 'Actual Loops')::integer > 0
           ), false)
      into v_base_node_count,
           v_index_rows,
           v_rows_removed,
           v_index_loops,
           v_executed_seq_scan
    from pg_catalog.jsonb_path_query(
      v_plan,
      'strict $[*].** ? (@."Relation Name" == "project_tasks")'
    ) node(value);

    if v_base_node_count < 1
       or v_index_rows is distinct from 501
       or v_index_loops is distinct from 1
       or v_executed_seq_scan
       or v_index_rows + coalesce(v_rows_removed, 0) > 501 then
      if v_index_rows is null then
        raise exception
          'agent_task_runtime_failed: task list keyset plan did not use index: %',
          v_case;
      end if;
      raise exception
        'agent_task_runtime_failed: task list keyset plan exceeded 501 rows: %, %, %',
        v_case, v_index_rows, coalesce(v_rows_removed, 0);
    end if;
  end loop;
end;
$task_list_plan_contract$;

do $task_attention_and_dependency_hostile_plans$
declare
  v_attention_plan jsonb;
  v_dependency_plan jsonb;
begin
  execute $attention_explain$
  explain (analyze, buffers, format json)
  with raw_source_gate as materialized (
    select task.id,
           task.project_id,
           task.task_type_id,
           task.custom_title,
           task.team_member_ids,
           task.start_date,
           task.end_date,
           task.schedule_version,
           task.schedule_confirmed_at,
           task.confirmed_schedule_version
    from public.project_tasks task
    where task.company_id =
            '8b000000-0000-4000-8000-000000000001'::uuid
      and task.deleted_at is null
      and task.status = 'active'
    order by task.id
    limit 501
  ), raw_source_state as materialized (
    select pg_catalog.count(*)::integer as source_count
    from raw_source_gate
  ), raw_source_guard as materialized (
    select raw.*
    from raw_source_gate raw
    cross join raw_source_state raw_state
    where raw_state.source_count < 501
  ), attention_source as materialized (
    select raw.id,
           project.id as resolved_project_id,
           task_type.display as task_type_display
    from raw_source_guard raw
    join public.projects project
      on project.id = raw.project_id
     and project.company_id =
       '8b000000-0000-4000-8000-000000000001'::uuid
     and project.deleted_at is null
    left join public.task_types task_type
      on task_type.id = raw.task_type_id
     and task_type.company_id =
       '8b000000-0000-4000-8000-000000000001'::uuid
     and task_type.deleted_at is null
    where (
        pg_catalog.cardinality(
          coalesce(raw.team_member_ids, array[]::text[])
        ) = 0
        or coalesce(raw.end_date, raw.start_date) <
          timestamptz '2026-12-30 00:00:00+00'
        or raw.start_date is not null and (
          raw.schedule_confirmed_at is null
          or raw.confirmed_schedule_version is distinct from
            raw.schedule_version
        )
      )
  )
  select pg_catalog.count(*)
         + pg_catalog.count(resolved_project_id)
         + pg_catalog.count(task_type_display)
  from attention_source
  $attention_explain$ into v_attention_plan;

  perform pg_temp.assert_task_hostile_plan(
    v_attention_plan,
    'task attention hostile plan',
    'project_tasks',
    'idx_project_tasks_agent_attention_gate_v1',
    501
  );

  perform pg_temp.assert_task_plan_aliases_not_executed(
    v_attention_plan,
    'task attention hostile plan',
    array['project', 'task_type']::text[]
  );

  execute $dependency_explain$
  explain (analyze, buffers, format json)
  with selected_task as materialized (
    select task.id,
           task.project_id,
           task_type.dependencies as task_type_dependencies
    from public.project_tasks task
    join public.task_types task_type
      on task_type.id = task.task_type_id
     and task_type.company_id = task.company_id
     and task_type.deleted_at is null
    where task.id = '8b600000-0000-4000-8000-000000000002'::uuid
      and task.company_id =
        '8b000000-0000-4000-8000-000000000001'::uuid
      and task.deleted_at is null
  ), dependency_definition_source as materialized (
    select dependency.value
    from selected_task selected
    cross join lateral pg_catalog.jsonb_array_elements(
      selected.task_type_dependencies
    ) dependency(value)
    limit 501
  ), dependency_definition as materialized (
    select private.agent_p2_task_uuid_from_text(
             definition.value ->> 'depends_on_task_type_id'
           ) as dependency_type_id
    from dependency_definition_source definition
  ), dependency_task_source_gate as materialized (
    select predecessor.id,
           predecessor.task_type_id,
           predecessor.custom_title
    from selected_task selected
    join dependency_definition dependency on true
    join lateral (
      select candidate.id,
             candidate.task_type_id,
             candidate.custom_title
      from public.project_tasks candidate
      where candidate.company_id =
              '8b000000-0000-4000-8000-000000000001'::uuid
        and candidate.project_id = selected.project_id
        and candidate.task_type_id = dependency.dependency_type_id
        and candidate.id <> selected.id
        and candidate.deleted_at is null
        and candidate.status <> 'cancelled'
      order by candidate.id
      limit 501
    ) predecessor on true
    where (
      select pg_catalog.count(*)
      from dependency_definition_source
    ) <= 25
    limit 501
  ), dependency_task_source_state as materialized (
    select pg_catalog.count(*)::integer as source_count
    from dependency_task_source_gate
  ), dependency_task_source_guard as materialized (
    select raw.*
    from dependency_task_source_gate raw
    cross join dependency_task_source_state raw_state
    where raw_state.source_count < 501
  ), dependency_task_source as materialized (
    select raw.id,
           predecessor_type.display as predecessor_type_display
    from dependency_task_source_guard raw
    left join public.task_types predecessor_type
      on predecessor_type.id = raw.task_type_id
     and predecessor_type.company_id =
       '8b000000-0000-4000-8000-000000000001'::uuid
     and predecessor_type.deleted_at is null
  )
  select pg_catalog.count(*)
         + pg_catalog.count(predecessor_type_display)
  from dependency_task_source
  $dependency_explain$ into v_dependency_plan;

  perform pg_temp.assert_task_hostile_plan(
    v_dependency_plan,
    'task dependency hostile plan',
    'project_tasks',
    'idx_project_tasks_agent_dependency_gate_v1',
    501
  );

  perform pg_temp.assert_task_plan_aliases_not_executed(
    v_dependency_plan,
    'task dependency hostile plan',
    array['predecessor_type']::text[]
  );
end;
$task_attention_and_dependency_hostile_plans$;

set local session_replication_role = replica;
delete from public.project_tasks
where id between '8bc00000-0000-4000-8000-000000000001'::uuid
             and '8bc00000-0000-4000-8000-000000000501'::uuid
   or id between '8be00000-0000-4000-8000-000000000001'::uuid
             and '8be00000-0000-4000-8000-000000050000'::uuid
   or id between '8bf00000-0000-4000-8000-000000000001'::uuid
             and '8bf00000-0000-4000-8000-000000050000'::uuid;
set local session_replication_role = origin;
analyze public.project_tasks;

insert into public.task_materials (
  id,
  task_id,
  catalog_variant_id,
  quantity
) values (
  '8b640000-0000-4000-8000-000000000001',
  '8b600000-0000-4000-8000-000000000002',
  '8b530000-0000-4000-8000-000000000001',
  2
);

set local session_replication_role = replica;
insert into public.task_materials (
  id,
  task_id,
  catalog_variant_id,
  quantity,
  source
)
select (
         '8bd00000-0000-4000-8000-' ||
         pg_catalog.lpad(series.value::text, 12, '0')
       )::uuid,
       '8b630000-0000-4000-8000-000000000001'::uuid,
       '8b530000-0000-4000-8000-000000000001'::uuid,
       1::double precision,
       'stock'
from pg_catalog.generate_series(1, 50000) series(value);

insert into public.task_materials (
  id,
  task_id,
  catalog_variant_id,
  quantity,
  source
)
select (
         '8bc00000-0000-4000-8000-' ||
         pg_catalog.lpad(series.value::text, 12, '0')
       )::uuid,
       '8b600000-0000-4000-8000-000000000002'::uuid,
       '8b530000-0000-4000-8000-000000000001'::uuid,
       1::double precision,
       'stock'
from pg_catalog.generate_series(1, 500) series(value);
set local session_replication_role = origin;
analyze public.task_materials;

do $task_material_hostile_plan$
declare
  v_plan jsonb;
begin
  execute $material_explain$
  explain (analyze, buffers, format json)
  with material_source_gate as materialized (
    select material.id,
           material.quantity,
           material.source,
           material.catalog_variant_id,
           material.inventory_item_id
    from public.task_materials material
    where material.task_id =
      '8b600000-0000-4000-8000-000000000002'::uuid
    order by material.id
    limit 501
  ), material_source_state as materialized (
    select pg_catalog.count(*)::integer as raw_source_count
    from material_source_gate
  ), material_source_guard as materialized (
    select material.*
    from material_source_gate material
    cross join material_source_state raw_state
    where raw_state.raw_source_count < 501
  ), material_source as materialized (
    select material.id,
           variant.id as resolved_variant_id,
           inventory.inventory_mode
    from material_source_guard material
    left join public.catalog_variants variant
      on variant.id = coalesce(
        material.catalog_variant_id,
        material.inventory_item_id
      )
     and variant.company_id =
       '8b000000-0000-4000-8000-000000000001'::uuid
     and variant.deleted_at is null
     and variant.is_active is true
    left join public.company_inventory_settings inventory
      on inventory.company_id =
        '8b000000-0000-4000-8000-000000000001'::uuid
  )
  select pg_catalog.count(*)
         + pg_catalog.count(resolved_variant_id)
         + pg_catalog.count(inventory_mode)
  from material_source
  $material_explain$ into v_plan;

  perform pg_temp.assert_task_hostile_plan(
    v_plan,
    'task material hostile plan',
    'task_materials',
    'idx_task_materials_agent_task_gate_v1',
    501
  );

  perform pg_temp.assert_task_plan_aliases_not_executed(
    v_plan,
    'task material hostile plan',
    array['variant', 'inventory']::text[]
  );
end;
$task_material_hostile_plan$;

set local session_replication_role = replica;
delete from public.task_materials
where id between '8bc00000-0000-4000-8000-000000000001'::uuid
             and '8bc00000-0000-4000-8000-000000000500'::uuid
   or id between '8bd00000-0000-4000-8000-000000000001'::uuid
             and '8bd00000-0000-4000-8000-000000050000'::uuid;
set local session_replication_role = origin;
analyze public.task_materials;

create temporary table agent_task_runtime_authority
on commit drop as
select authority.permission_snapshot_revision
from private.resolve_agent_actor_authority(
  '8b100000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000001',
  array[
    'calendar.view',
    'estimates.view',
    'projects.view',
    'projects.view_financials',
    'tasks.view'
  ]::text[]
) authority;

do $authority_fixture_contract$
begin
  if (
    select pg_catalog.count(*)
    from agent_task_runtime_authority
    where permission_snapshot_revision ~ '^sha256:[0-9a-f]{64}$'
  ) <> 1 then
    raise exception 'agent_task_runtime_failed: authority fixture invalid';
  end if;
end;
$authority_fixture_contract$;

create function pg_temp.assert_task_authority_rejected(p_case text)
returns void
language plpgsql
volatile
set search_path = ''
as $function$
begin
  begin
    perform public.read_agent_tasks_as_system(
      pg_catalog.format('agent-task-runtime-%s-list', p_case),
      '8b100000-0000-4000-8000-000000000001',
      '8b000000-0000-4000-8000-000000000001',
      '8b130000-0000-4000-8000-000000000001',
      '8b120000-0000-4000-8000-000000000001',
      pg_catalog.md5('agent-task-runtime-grant'),
      array[
        'ops.financial_documents.read',
        'ops.schedule.read',
        'ops.tasks.read'
      ]::text[],
      (
        select permission_snapshot_revision
        from pg_temp.agent_task_runtime_authority
      ),
      array[
        'calendar.view',
        'estimates.view',
        'projects.view',
        'projects.view_financials',
        'tasks.view'
      ]::text[],
      'list_tasks',
      'list_tasks:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.tasks.read']::text[],
      'all',
      'assigned',
      null,
      null,
      null,
      'actionable',
      null,
      null,
      array[]::text[],
      null,
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
    raise exception 'agent_task_runtime_failed: % accepted by list', p_case;
  exception when sqlstate '42501' then
    if sqlerrm is distinct from 'agent_task_not_authorized' then
      raise;
    end if;
  end;

  begin
    perform public.read_agent_task_context_as_system(
      pg_catalog.format('agent-task-runtime-%s-detail', p_case),
      '8b100000-0000-4000-8000-000000000001',
      '8b000000-0000-4000-8000-000000000001',
      '8b130000-0000-4000-8000-000000000001',
      '8b120000-0000-4000-8000-000000000001',
      pg_catalog.md5('agent-task-runtime-grant'),
      array[
        'ops.financial_documents.read',
        'ops.schedule.read',
        'ops.tasks.read'
      ]::text[],
      (
        select permission_snapshot_revision
        from pg_temp.agent_task_runtime_authority
      ),
      array[
        'calendar.view',
        'estimates.view',
        'projects.view',
        'projects.view_financials',
        'tasks.view'
      ]::text[],
      'get_task_context',
      'get_task_context:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.tasks.read']::text[],
      'all',
      'assigned',
      null,
      null,
      null,
      '8b600000-0000-4000-8000-000000000002',
      array[
        'dependencies',
        'evidence_state',
        'material_readiness'
      ]::text[],
      501,
      25,
      25
    );
    raise exception 'agent_task_runtime_failed: % accepted by detail', p_case;
  exception when sqlstate 'P0002' then
    if sqlerrm is distinct from 'agent_task_not_found_or_not_visible' then
      raise;
    end if;
  end;
end;
$function$;

update public.user_permission_overrides
set scope = 'assigned'
where id in (
  '8b110000-0000-4000-8000-000000000002',
  '8b110000-0000-4000-8000-000000000005'
);

create temporary table agent_task_runtime_assigned_authority
on commit drop as
select authority.permission_snapshot_revision
from private.resolve_agent_actor_authority(
  '8b100000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000001',
  array[
    'calendar.view',
    'estimates.view',
    'projects.view',
    'projects.view_financials',
    'tasks.view'
  ]::text[]
) authority;

create function pg_temp.read_assigned_task_job(p_job_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select public.read_agent_tasks_as_system(
    'agent-task-runtime-canonical-list-' || p_job_id::text,
    '8b100000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    '8b130000-0000-4000-8000-000000000001',
    '8b120000-0000-4000-8000-000000000001',
    pg_catalog.md5('agent-task-runtime-grant'),
    array[
      'ops.financial_documents.read',
      'ops.schedule.read',
      'ops.tasks.read'
    ]::text[],
    (
      select permission_snapshot_revision
      from pg_temp.agent_task_runtime_assigned_authority
    ),
    array[
      'calendar.view',
      'estimates.view',
      'projects.view',
      'projects.view_financials',
      'tasks.view'
    ]::text[],
    'list_tasks',
    'list_tasks:2026-08-22.v1',
    '2026-08-22.capability-manifest.v8',
    array['ops.tasks.read']::text[],
    'assigned',
    'assigned',
    null,
    null,
    null,
    'job',
    p_job_id,
    null,
    array[]::text[],
    null,
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
$function$;

create function pg_temp.read_assigned_task_detail(p_task_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select public.read_agent_task_context_as_system(
    'agent-task-runtime-canonical-detail-' || p_task_id::text,
    '8b100000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    '8b130000-0000-4000-8000-000000000001',
    '8b120000-0000-4000-8000-000000000001',
    pg_catalog.md5('agent-task-runtime-grant'),
    array[
      'ops.financial_documents.read',
      'ops.schedule.read',
      'ops.tasks.read'
    ]::text[],
    (
      select permission_snapshot_revision
      from pg_temp.agent_task_runtime_assigned_authority
    ),
    array[
      'calendar.view',
      'estimates.view',
      'projects.view',
      'projects.view_financials',
      'tasks.view'
    ]::text[],
    'get_task_context',
    'get_task_context:2026-08-22.v1',
    '2026-08-22.capability-manifest.v8',
    array['ops.tasks.read']::text[],
    'assigned',
    'assigned',
    null,
    null,
    null,
    p_task_id,
    array['dependencies', 'evidence_state']::text[],
    501,
    25,
    25
  );
$function$;

create function pg_temp.read_assigned_financial_task_detail(p_task_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select public.read_agent_task_context_as_system(
    'agent-task-runtime-assigned-financial-detail-' || p_task_id::text,
    '8b100000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    '8b130000-0000-4000-8000-000000000001',
    '8b120000-0000-4000-8000-000000000001',
    pg_catalog.md5('agent-task-runtime-grant'),
    array[
      'ops.financial_documents.read',
      'ops.schedule.read',
      'ops.tasks.read'
    ]::text[],
    (
      select permission_snapshot_revision
      from pg_temp.agent_task_runtime_assigned_authority
    ),
    array[
      'calendar.view',
      'estimates.view',
      'projects.view',
      'projects.view_financials',
      'tasks.view'
    ]::text[],
    'get_task_context',
    'get_task_context:2026-08-22.v1',
    '2026-08-22.capability-manifest.v8',
    array['ops.financial_documents.read', 'ops.tasks.read']::text[],
    'assigned',
    'assigned',
    null,
    'assigned',
    'all',
    p_task_id,
    array['financial_origin']::text[],
    501,
    25,
    25
  );
$function$;

do $canonical_authority_contract$
declare
  v_completed_list jsonb;
  v_cancelled_list jsonb;
  v_mentioned_list jsonb;
  v_hidden_list jsonb;
  v_completed_detail jsonb;
  v_cancelled_detail jsonb;
  v_mentioned_detail jsonb;
  v_completed_financial jsonb;
  v_cancelled_financial jsonb;
  v_attention jsonb;
begin
  v_completed_list := pg_temp.read_assigned_task_job(
    '8b400000-0000-4000-8000-000000000003'
  );
  v_mentioned_list := pg_temp.read_assigned_task_job(
    '8b400000-0000-4000-8000-000000000004'
  );
  v_cancelled_list := pg_temp.read_assigned_task_job(
    '8b400000-0000-4000-8000-000000000005'
  );
  v_hidden_list := pg_temp.read_assigned_task_job(
    '8b400000-0000-4000-8000-000000000002'
  );
  v_completed_detail := pg_temp.read_assigned_task_detail(
    '8b650000-0000-4000-8000-000000000002'
  );
  v_mentioned_detail := pg_temp.read_assigned_task_detail(
    '8b660000-0000-4000-8000-000000000001'
  );
  v_cancelled_detail := pg_temp.read_assigned_task_detail(
    '8b690000-0000-4000-8000-000000000003'
  );
  v_completed_financial := pg_temp.read_assigned_financial_task_detail(
    '8b650000-0000-4000-8000-000000000002'
  );
  v_cancelled_financial := pg_temp.read_assigned_financial_task_detail(
    '8b690000-0000-4000-8000-000000000003'
  );

  if not exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_completed_list -> 'rows'
       ) row(value)
       where row.value #>> '{item,task_ref,id}' =
         '8b650000-0000-4000-8000-000000000002'
     )
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_mentioned_list -> 'rows'
       ) row(value)
       where row.value #>> '{item,task_ref,id}' =
         '8b660000-0000-4000-8000-000000000001'
     )
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_cancelled_list -> 'rows'
       ) row(value)
       where row.value #>> '{item,task_ref,id}' =
         '8b690000-0000-4000-8000-000000000003'
     )
     or v_completed_detail #>> '{result,task,task_ref,id}' <>
       '8b650000-0000-4000-8000-000000000002'
     or v_completed_detail #>> '{result,sections,dependencies,state}' <>
       'ready'
     or (v_completed_detail #>>
       '{result,sections,dependencies,source_count}')::integer <> 1
     or v_mentioned_detail #>> '{result,task,task_ref,id}' <>
       '8b660000-0000-4000-8000-000000000001'
     or v_cancelled_detail #>> '{result,task,task_ref,id}' <>
       '8b690000-0000-4000-8000-000000000003'
     or v_cancelled_detail #>> '{result,sections,dependencies,state}' <>
       'ready'
     or (v_cancelled_detail #>>
       '{result,sections,dependencies,source_count}')::integer <> 1 then
    raise exception
      'agent_task_runtime_failed: canonical project visibility missing';
  end if;

  if v_completed_financial #>>
       '{result,sections,financial_origin,state}' <> 'estimate_line'
     or v_cancelled_financial #>>
       '{result,sections,financial_origin,state}' <> 'estimate_line' then
    raise exception
      'agent_task_runtime_failed: assigned financial project access missing';
  end if;

  begin
    perform pg_temp.read_assigned_financial_task_detail(
      '8b660000-0000-4000-8000-000000000001'
    );
    raise exception
      'agent_task_runtime_failed: project-note-only estimate assignment leaked';
  exception when sqlstate 'P0002' then
    if sqlerrm is distinct from 'agent_task_not_found_or_not_visible' then
      raise;
    end if;
  end;

  if pg_catalog.jsonb_array_length(v_hidden_list -> 'rows') <> 0 then
    raise exception
      'agent_task_runtime_failed: canonical task list visibility widened';
  end if;

  begin
    perform pg_temp.read_assigned_task_detail(
      '8b630000-0000-4000-8000-000000000001'
    );
    raise exception
      'agent_task_runtime_failed: canonical task detail visibility widened';
  exception when sqlstate 'P0002' then
    if sqlerrm is distinct from 'agent_task_not_found_or_not_visible' then
      raise;
    end if;
  end;

  begin
    perform pg_temp.read_assigned_financial_task_detail(
      '8b630000-0000-4000-8000-000000000001'
    );
    raise exception
      'agent_task_runtime_failed: unrelated assigned financial project leaked';
  exception when sqlstate 'P0002' then
    if sqlerrm is distinct from 'agent_task_not_found_or_not_visible' then
      raise;
    end if;
  end;

  v_attention := private.agent_p2_task_attention_v1(
    '8b100000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    (
      select permission_snapshot_revision
      from pg_temp.agent_task_runtime_assigned_authority
    ),
    array[
      'calendar.view',
      'estimates.view',
      'projects.view',
      'projects.view_financials',
      'tasks.view'
    ]::text[],
    'assigned',
    'assigned',
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
    25
  );

  if not exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_attention -> 'cards') card(value)
       where card.value #>> '{task_ref,id}' =
         '8b660000-0000-4000-8000-000000000001'
     )
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_attention -> 'cards') card(value)
       where card.value #>> '{task_ref,id}' =
         '8b690000-0000-4000-8000-000000000003'
     )
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_attention -> 'cards') card(value)
       where card.value #>> '{task_ref,id}' =
         '8b630000-0000-4000-8000-000000000001'
     ) then
    raise exception
      'agent_task_runtime_failed: canonical task attention visibility widened';
  end if;
end;
$canonical_authority_contract$;

insert into public.task_mutation_events (
  id,
  company_id,
  task_id,
  project_id,
  event_type,
  before_snapshot,
  after_snapshot,
  task_schedule_version
) values (
  '8b680000-0000-4000-8000-000000000002',
  '8b000000-0000-4000-8000-000000000001',
  '8b650000-0000-4000-8000-000000000002',
  '8b400000-0000-4000-8000-000000000001',
  'schedule_change',
  '{}'::jsonb,
  '{}'::jsonb,
  0
);

do $task_evidence_binding_contract$
begin
  begin
    perform pg_temp.read_assigned_task_detail(
      '8b650000-0000-4000-8000-000000000002'
    );
    raise exception
      'agent_task_runtime_failed: task evidence binding invalid accepted';
  exception when sqlstate '22000' then
    if sqlerrm is distinct from 'agent_task_source_data_invalid' then
      raise;
    end if;
  end;
end;
$task_evidence_binding_contract$;

update public.user_permission_overrides
set scope = 'all'
where id in (
  '8b110000-0000-4000-8000-000000000002',
  '8b110000-0000-4000-8000-000000000005'
);

update public.user_permission_overrides
set scope = case id
  when '8b110000-0000-4000-8000-000000000002'::uuid then 'assigned'
  when '8b110000-0000-4000-8000-000000000003'::uuid then 'all'
end
where id in (
  '8b110000-0000-4000-8000-000000000002',
  '8b110000-0000-4000-8000-000000000003'
);

create temporary table agent_task_runtime_mixed_finance_authority
on commit drop as
select authority.permission_snapshot_revision
from private.resolve_agent_actor_authority(
  '8b100000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000001',
  array[
    'calendar.view',
    'estimates.view',
    'projects.view',
    'projects.view_financials',
    'tasks.view'
  ]::text[]
) authority;

create function pg_temp.read_mixed_scope_assigned_financial_task_detail(
  p_task_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select public.read_agent_task_context_as_system(
    'agent-task-runtime-mixed-financial-detail-' || p_task_id::text,
    '8b100000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    '8b130000-0000-4000-8000-000000000001',
    '8b120000-0000-4000-8000-000000000001',
    pg_catalog.md5('agent-task-runtime-grant'),
    array[
      'ops.financial_documents.read',
      'ops.schedule.read',
      'ops.tasks.read'
    ]::text[],
    (
      select permission_snapshot_revision
      from pg_temp.agent_task_runtime_mixed_finance_authority
    ),
    array[
      'calendar.view',
      'estimates.view',
      'projects.view',
      'projects.view_financials',
      'tasks.view'
    ]::text[],
    'get_task_context',
    'get_task_context:2026-08-22.v1',
    '2026-08-22.capability-manifest.v8',
    array['ops.financial_documents.read', 'ops.tasks.read']::text[],
    'all',
    'all',
    null,
    'assigned',
    'all',
    p_task_id,
    array['financial_origin']::text[],
    501,
    25,
    25
  );
$function$;

do $mixed_scope_assigned_financial_contract$
declare
  v_result jsonb;
begin
  if not exists (
    select 1
    from public.project_tasks task
    where task.id = '8b630000-0000-4000-8000-000000000001'
      and task.source_estimate_id =
        '8b500000-0000-4000-8000-000000000005'
      and task.source_line_item_id =
        '8b510000-0000-4000-8000-000000000005'
  ) then
    raise exception
      'agent_task_runtime_failed: mixed-scope hostile fixture missing';
  end if;

  v_result := pg_temp.read_mixed_scope_assigned_financial_task_detail(
    '8b600000-0000-4000-8000-000000000002'
  );
  if v_result #>> '{result,sections,financial_origin,state}' <>
       'estimate_line' then
    raise exception
      'agent_task_runtime_failed: assigned financial project access missing';
  end if;

  begin
    perform pg_temp.read_mixed_scope_assigned_financial_task_detail(
      '8b630000-0000-4000-8000-000000000001'
    );
    raise exception
      'agent_task_runtime_failed: mixed-scope assigned estimate leaked';
  exception when sqlstate 'P0002' then
    if sqlerrm is distinct from 'agent_task_not_found_or_not_visible' then
      raise;
    end if;
  end;

  update public.project_tasks
  set source_estimate_id = '8b500000-0000-4000-8000-000000000005',
      source_line_item_id = '8b510000-0000-4000-8000-000000000005'
  where id = '8b600000-0000-4000-8000-000000000002';

  begin
    perform pg_temp.read_mixed_scope_assigned_financial_task_detail(
      '8b600000-0000-4000-8000-000000000002'
    );
    raise exception
      'agent_task_runtime_failed: mixed-scope unrelated estimate or line refs disclosed';
  exception when sqlstate 'P0002' then
    if sqlerrm is distinct from 'agent_task_not_found_or_not_visible' then
      raise;
    end if;
  end;

  update public.project_tasks
  set source_estimate_id = '8b500000-0000-4000-8000-000000000001',
      source_line_item_id = '8b510000-0000-4000-8000-000000000001'
  where id = '8b600000-0000-4000-8000-000000000002';
end;
$mixed_scope_assigned_financial_contract$;

update public.user_permission_overrides
set scope = case id
  when '8b110000-0000-4000-8000-000000000002'::uuid then 'all'
  when '8b110000-0000-4000-8000-000000000003'::uuid then 'assigned'
end
where id in (
  '8b110000-0000-4000-8000-000000000002',
  '8b110000-0000-4000-8000-000000000003'
);

do $task_revision_trigger_contract$
declare
  v_before bigint;
  v_material_after bigint;
  v_after bigint;
begin
  select revision.source_revision
    into strict v_before
  from private.agent_read_domain_revisions revision
  where revision.company_id = '8b000000-0000-4000-8000-000000000001'
    and revision.domain = 'tasks';

  update public.task_materials
  set quantity = 3
  where id = '8b640000-0000-4000-8000-000000000001';

  select revision.source_revision
    into strict v_material_after
  from private.agent_read_domain_revisions revision
  where revision.company_id = '8b000000-0000-4000-8000-000000000001'
    and revision.domain = 'tasks';

  if v_material_after <= v_before then
    raise exception
      'agent_task_runtime_failed: task revision did not advance';
  end if;

  insert into public.task_mutation_events (
    id,
    company_id,
    task_id,
    project_id,
    actor_user_id,
    event_type,
    before_snapshot,
    after_snapshot,
    task_schedule_version,
    task_updated_at
  ) values (
    '8b680000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    '8b600000-0000-4000-8000-000000000002',
    '8b400000-0000-4000-8000-000000000001',
    '8b100000-0000-4000-8000-000000000001',
    'task_completed',
    '{"private_evidence_marker":"before"}'::jsonb,
    '{"private_evidence_marker":"after"}'::jsonb,
    0,
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp())
  );

  select revision.source_revision
    into strict v_after
  from private.agent_read_domain_revisions revision
  where revision.company_id = '8b000000-0000-4000-8000-000000000001'
    and revision.domain = 'tasks';

  if v_after <= v_material_after then
    raise exception
      'agent_task_runtime_failed: task evidence revision did not advance';
  end if;
end;
$task_revision_trigger_contract$;

create temporary table agent_task_runtime_list
on commit drop as
select public.read_agent_tasks_as_system(
  'agent-task-runtime-list',
  '8b100000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000001',
  '8b130000-0000-4000-8000-000000000001',
  '8b120000-0000-4000-8000-000000000001',
  pg_catalog.md5('agent-task-runtime-grant'),
  array[
    'ops.financial_documents.read',
    'ops.schedule.read',
    'ops.tasks.read'
  ]::text[],
  (
    select permission_snapshot_revision
    from agent_task_runtime_authority
  ),
  array[
    'calendar.view',
    'estimates.view',
    'projects.view',
    'projects.view_financials',
    'tasks.view'
  ]::text[],
  'list_tasks',
  'list_tasks:2026-08-22.v1',
  '2026-08-22.capability-manifest.v8',
  array['ops.tasks.read']::text[],
  'all',
  'assigned',
  null,
  null,
  null,
  'actionable',
  null,
  null,
  array[]::text[],
  null,
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

do $list_contract$
declare
  v_result jsonb;
begin
  select result into strict v_result from agent_task_runtime_list;
  if pg_catalog.jsonb_array_length(v_result -> 'rows') <> 25
     or (v_result ->> 'source_has_more')::boolean is not true then
    raise exception 'agent_task_runtime_failed: paging contract invalid';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_result -> 'rows') row(value)
    where row.value #>> '{item,task_ref,id}' in (
      '8b620000-0000-4000-8000-000000000001',
      '8b630000-0000-4000-8000-000000000001'
    )
  ) then
    if v_result::text like '%8b620000-0000-4000-8000-000000000001%' then
      raise exception 'agent_task_runtime_failed: soft-deleted task leaked';
    end if;
    raise exception 'agent_task_runtime_failed: assigned intersection leaked';
  end if;
end;
$list_contract$;

create temporary table agent_task_runtime_detail
on commit drop as
select public.read_agent_task_context_as_system(
  'agent-task-runtime-detail',
  '8b100000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000001',
  '8b130000-0000-4000-8000-000000000001',
  '8b120000-0000-4000-8000-000000000001',
  pg_catalog.md5('agent-task-runtime-grant'),
  array[
    'ops.financial_documents.read',
    'ops.schedule.read',
    'ops.tasks.read'
  ]::text[],
  (
    select permission_snapshot_revision
    from agent_task_runtime_authority
  ),
  array[
    'calendar.view',
    'estimates.view',
    'projects.view',
    'projects.view_financials',
    'tasks.view'
  ]::text[],
  'get_task_context',
  'get_task_context:2026-08-22.v1',
  '2026-08-22.capability-manifest.v8',
  array['ops.tasks.read']::text[],
  'all',
  'assigned',
  null,
  null,
  null,
  '8b600000-0000-4000-8000-000000000002',
  array[
    'dependencies',
    'evidence_state',
    'material_readiness'
  ]::text[],
  501,
  25,
  25
) as result;

do $detail_contract$
declare
  v_result jsonb;
  v_not_recorded jsonb;
begin
  select result into strict v_result from agent_task_runtime_detail;
  if v_result #>> '{result,sections,dependencies,state}' <> 'blocked'
     or v_result #>> '{result,sections,material_readiness,state}' <>
       'shortage'
     or v_result #>> '{result,sections,evidence_state,state}' <> 'recorded'
     or (v_result #>>
       '{result,sections,evidence_state,evidence_count}')::integer <> 1
     or (v_result #>> '{source_inspected,task_evidence}')::integer <> 1
     or not ((v_result #> '{result,blocker_codes}') @>
       '["DEPENDENCY_INCOMPLETE","MATERIAL_SHORTAGE"]'::jsonb)
     or (v_result #> '{result,sections}') ? 'financial_origin'
     or (v_result #> '{result,sections}') ? 'notes' then
    raise exception 'agent_task_runtime_failed: detail readiness invalid';
  end if;

  if v_result::text like '%private_evidence_marker%'
     or v_result::text like '%before_snapshot%'
     or v_result::text like '%after_snapshot%' then
    raise exception 'agent_task_runtime_failed: task evidence payload leaked';
  end if;

  if v_result #>> '{result,sections,evidence_state,state}' <> 'recorded' then
    raise exception 'agent_task_runtime_failed: recorded task evidence missing';
  end if;

  v_not_recorded := private.agent_p2_task_context_v1(
    '8b100000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    '8b130000-0000-4000-8000-000000000001',
    '8b120000-0000-4000-8000-000000000001',
    pg_catalog.md5('agent-task-runtime-grant'),
    array[
      'ops.financial_documents.read',
      'ops.schedule.read',
      'ops.tasks.read'
    ]::text[],
    (
      select permission_snapshot_revision
      from pg_temp.agent_task_runtime_authority
    ),
    array[
      'calendar.view',
      'estimates.view',
      'projects.view',
      'projects.view_financials',
      'tasks.view'
    ]::text[],
    array['ops.tasks.read']::text[],
    'all',
    'assigned',
    null,
    null,
    null,
    '8b600000-0000-4000-8000-000000000001',
    array['evidence_state']::text[],
    501,
    25,
    25
  );

  if v_not_recorded #>> '{result,sections,evidence_state,state}' <>
       'not_recorded'
     or v_not_recorded #>>
       '{result,sections,evidence_state,evidence_count}' is not null
     or (v_not_recorded #>> '{source_inspected,task_evidence}')::integer <> 0 then
    raise exception
      'agent_task_runtime_failed: unrecorded task evidence invalid';
  end if;
end;
$detail_contract$;

create function pg_temp.read_dependency_override_detail()
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select private.agent_p2_task_context_v1(
    '8b100000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    '8b130000-0000-4000-8000-000000000001',
    '8b120000-0000-4000-8000-000000000001',
    pg_catalog.md5('agent-task-runtime-grant'),
    array[
      'ops.financial_documents.read',
      'ops.schedule.read',
      'ops.tasks.read'
    ]::text[],
    (
      select permission_snapshot_revision
      from pg_temp.agent_task_runtime_authority
    ),
    array[
      'calendar.view',
      'estimates.view',
      'projects.view',
      'projects.view_financials',
      'tasks.view'
    ]::text[],
    array['ops.tasks.read']::text[],
    'all',
    'assigned',
    null,
    null,
    null,
    '8b600000-0000-4000-8000-000000000002',
    array['dependencies']::text[],
    501,
    25,
    25
  );
$function$;

do $dependency_override_contract$
declare
  v_result jsonb;
  v_revision_before bigint;
  v_revision_after bigint;
begin
  if (
       select task.dependency_overrides
       from public.project_tasks task
       where task.id = '8b600000-0000-4000-8000-000000000002'
     ) is not null then
    raise exception
      'agent_task_runtime_failed: dependency override fixture not null';
  end if;

  v_result := pg_temp.read_dependency_override_detail();
  if v_result #>> '{result,sections,dependencies,state}' <> 'blocked'
     or (v_result #>>
       '{result,sections,dependencies,source_count}')::integer <> 1 then
    raise exception
      'agent_task_runtime_failed: dependency null override did not fall back';
  end if;

  select revision.source_revision
    into strict v_revision_before
  from private.agent_read_domain_revisions revision
  where revision.company_id = '8b000000-0000-4000-8000-000000000001'
    and revision.domain = 'tasks';

  update public.project_tasks
  set dependency_overrides = '[]'::jsonb
  where id = '8b600000-0000-4000-8000-000000000002';

  select revision.source_revision
    into strict v_revision_after
  from private.agent_read_domain_revisions revision
  where revision.company_id = '8b000000-0000-4000-8000-000000000001'
    and revision.domain = 'tasks';

  if v_revision_after <= v_revision_before then
    raise exception
      'agent_task_runtime_failed: dependency override revision did not advance';
  end if;

  v_result := pg_temp.read_dependency_override_detail();
  if v_result #>> '{result,sections,dependencies,state}' <> 'no_dependencies'
     or (v_result #>>
       '{result,sections,dependencies,source_count}')::integer <> 0
     or (v_result #>> '{source_inspected,dependencies}')::integer <> 0
     or (v_result #> '{result,blocker_codes}') ? 'DEPENDENCY_INCOMPLETE' then
    raise exception
      'agent_task_runtime_failed: empty dependency override did not suppress defaults';
  end if;

  update public.project_tasks
  set dependency_overrides = pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'depends_on_task_type_id',
      '8b300000-0000-4000-8000-000000000003'
    )
  )
  where id = '8b600000-0000-4000-8000-000000000002';

  v_result := pg_temp.read_dependency_override_detail();
  if v_result #>> '{result,sections,dependencies,state}' <> 'ready'
     or (v_result #>>
       '{result,sections,dependencies,source_count}')::integer <> 1
     or v_result #>>
       '{result,sections,dependencies,dependencies,0,task_ref,id}' <>
       '8b600000-0000-4000-8000-000000000003'
     or v_result::text like '%8b600000-0000-4000-8000-000000000001%' then
    raise exception
      'agent_task_runtime_failed: nonempty dependency override did not replace defaults';
  end if;

  update public.project_tasks
  set dependency_overrides = (
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'depends_on_task_type_id',
      '8b300000-0000-4000-8000-000000000003'
    ) order by series.value)
    from pg_catalog.generate_series(1, 501) series(value)
  )
  where id = '8b600000-0000-4000-8000-000000000002';

  begin
    perform pg_temp.read_dependency_override_detail();
    raise exception
      'agent_task_runtime_failed: dependency override source bound not enforced';
  exception when sqlstate '54000' then
    if sqlerrm is distinct from 'agent_task_source_query_bound' then
      raise;
    end if;
  end;

  update public.project_tasks
  set dependency_overrides = null
  where id = '8b600000-0000-4000-8000-000000000002';

  v_result := pg_temp.read_dependency_override_detail();
  if v_result #>> '{result,sections,dependencies,state}' <> 'blocked'
     or (v_result #>>
       '{result,sections,dependencies,source_count}')::integer <> 1 then
    raise exception
      'agent_task_runtime_failed: dependency null override did not fall back';
  end if;
end;
$dependency_override_contract$;

set local session_replication_role = replica;
insert into public.task_mutation_events (
  id,
  company_id,
  task_id,
  project_id,
  event_type,
  before_snapshot,
  after_snapshot,
  task_schedule_version
)
select (
         '8be00000-0000-4000-8000-' ||
         pg_catalog.lpad(series.value::text, 12, '0')
       )::uuid,
       '8b000000-0000-4000-8000-000000000001'::uuid,
       '8b600000-0000-4000-8000-000000000001'::uuid,
       '8b400000-0000-4000-8000-000000000001'::uuid,
       'schedule_change',
       '{}'::jsonb,
       '{}'::jsonb,
       0
from pg_catalog.generate_series(1, 501) series(value);
set local session_replication_role = origin;

do $task_evidence_source_bound_contract$
begin
  begin
    perform private.agent_p2_task_context_v1(
      '8b100000-0000-4000-8000-000000000001',
      '8b000000-0000-4000-8000-000000000001',
      '8b130000-0000-4000-8000-000000000001',
      '8b120000-0000-4000-8000-000000000001',
      pg_catalog.md5('agent-task-runtime-grant'),
      array[
        'ops.financial_documents.read',
        'ops.schedule.read',
        'ops.tasks.read'
      ]::text[],
      (
        select permission_snapshot_revision
        from pg_temp.agent_task_runtime_authority
      ),
      array[
        'calendar.view',
        'estimates.view',
        'projects.view',
        'projects.view_financials',
        'tasks.view'
      ]::text[],
      array['ops.tasks.read']::text[],
      'all',
      'assigned',
      null,
      null,
      null,
      '8b600000-0000-4000-8000-000000000001',
      array['evidence_state']::text[],
      501,
      25,
      25
    );
    raise exception
      'agent_task_runtime_failed: task evidence source bound not enforced';
  exception when sqlstate '54000' then
    if sqlerrm is distinct from 'agent_task_source_query_bound' then
      raise;
    end if;
  end;
end;
$task_evidence_source_bound_contract$;

create function pg_temp.read_main_financial_task_detail()
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select public.read_agent_task_context_as_system(
    'agent-task-runtime-finance-detail',
    '8b100000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    '8b130000-0000-4000-8000-000000000001',
    '8b120000-0000-4000-8000-000000000001',
    pg_catalog.md5('agent-task-runtime-grant'),
    array[
      'ops.financial_documents.read',
      'ops.schedule.read',
      'ops.tasks.read'
    ]::text[],
    (
      select permission_snapshot_revision
      from pg_temp.agent_task_runtime_authority
    ),
    array[
      'calendar.view',
      'estimates.view',
      'projects.view',
      'projects.view_financials',
      'tasks.view'
    ]::text[],
    'get_task_context',
    'get_task_context:2026-08-22.v1',
    '2026-08-22.capability-manifest.v8',
    array['ops.financial_documents.read', 'ops.tasks.read']::text[],
    'all',
    'assigned',
    null,
    'all',
    'all',
    '8b600000-0000-4000-8000-000000000002',
    array[
      'dependencies',
      'evidence_state',
      'financial_origin',
      'material_readiness',
      'notes'
    ]::text[],
    501,
    25,
    25
  );
$function$;

create temporary table agent_task_runtime_finance_detail
on commit drop as
select pg_temp.read_main_financial_task_detail() as result;

do $finance_and_notes_contract$
declare
  v_result jsonb;
begin
  select result into strict v_result from agent_task_runtime_finance_detail;
  if v_result #>> '{result,sections,financial_origin,state}' <>
       'estimate_line'
     or v_result #>>
       '{result,sections,financial_origin,estimate_ref,id}' <>
       '8b500000-0000-4000-8000-000000000001'
     or v_result #>>
       '{result,sections,financial_origin,line_item_ref,id}' <>
       '8b510000-0000-4000-8000-000000000001'
     or v_result #>> '{result,sections,notes,state}' <> 'recorded'
     or v_result #>> '{result,sections,notes,content_kind}' <>
       'untrusted_business_data' then
    raise exception
      'agent_task_runtime_failed: canonical estimate project_ref was not primary';
  end if;

  update public.estimates
  set project_ref = null,
      project_id = '8b400000-0000-4000-8000-000000000001'
  where id = '8b500000-0000-4000-8000-000000000001';

  v_result := pg_temp.read_main_financial_task_detail();
  if v_result #>> '{result,sections,financial_origin,state}' <>
       'estimate_line' then
    raise exception
      'agent_task_runtime_failed: legacy estimate project fallback failed';
  end if;

  update public.estimates
  set project_ref = '8b400000-0000-4000-8000-000000000001',
      project_id = '8b400000-0000-4000-8000-000000000002'
  where id = '8b500000-0000-4000-8000-000000000001';

  v_result := pg_temp.read_main_financial_task_detail();
  if v_result #>> '{result,sections,financial_origin,state}' <>
       'source_invalid' then
    raise exception
      'agent_task_runtime_failed: estimate project conflict accepted';
  end if;

  update public.estimates
  set project_ref = '8b400000-0000-4000-8000-000000000001',
      project_id = 'legacy-not-a-uuid'
  where id = '8b500000-0000-4000-8000-000000000001';
end;
$finance_and_notes_contract$;

create temporary table agent_task_runtime_attention
on commit drop as
select private.agent_p2_task_attention_v1(
  '8b100000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000001',
  (
    select permission_snapshot_revision
    from agent_task_runtime_authority
  ),
  array[
    'calendar.view',
    'estimates.view',
    'projects.view',
    'projects.view_financials',
    'tasks.view'
  ]::text[],
  'all',
  'assigned',
  pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
  25
) as result;

do $attention_contract$
declare
  v_result jsonb;
begin
  select result into strict v_result from agent_task_runtime_attention;
  if v_result ->> 'projection_revision' <>
       'agent-p2-task-attention:v1'
     or pg_catalog.jsonb_array_length(v_result -> 'cards') <> 25
     or (v_result ->> 'has_more')::boolean is not true then
    raise exception 'agent_task_runtime_failed: attention projection invalid';
  end if;
end;
$attention_contract$;

create function pg_temp.assert_task_attention_read_at(
  p_read_at timestamptz,
  p_expect_window_valid boolean,
  p_rejection_marker text
) returns void
language plpgsql
set search_path = ''
as $function$
begin
  begin
    perform private.agent_p2_task_attention_v1(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'sha256:' || pg_catalog.repeat('0', 64),
      array[
        'calendar.view','estimates.view','projects.view',
        'projects.view_financials','tasks.view'
      ]::text[],
      'all', 'assigned', p_read_at, 25
    );
    if not p_expect_window_valid then
      raise exception '%', p_rejection_marker;
    end if;
  exception
    when sqlstate '42501' then
      if not p_expect_window_valid then
        raise exception '%', p_rejection_marker;
      end if;
    when sqlstate '22023' then
      if p_expect_window_valid then
        raise exception
          'agent_task_runtime_failed: task attention cursor-window rejected';
      end if;
  end;
end;
$function$;

do $task_attention_signed_cursor_window_contract$
declare
  v_now constant timestamptz := pg_catalog.date_trunc(
    'milliseconds', pg_catalog.statement_timestamp()
  );
begin
  perform pg_temp.assert_task_attention_read_at(
    v_now - interval '14 minutes',
    true,
    'agent_task_runtime_failed: task attention cursor-window accepted'
  );
  perform pg_temp.assert_task_attention_read_at(
    v_now + interval '1 millisecond',
    false,
    'agent_task_runtime_failed: task attention future read-at accepted'
  );
  perform pg_temp.assert_task_attention_read_at(
    v_now - interval '15 minutes',
    false,
    'agent_task_runtime_failed: task attention expired read-at accepted'
  );
  perform pg_temp.assert_task_attention_read_at(
    v_now - interval '1 microsecond',
    false,
    'agent_task_runtime_failed: task attention non-millisecond read-at accepted'
  );
  perform pg_temp.assert_task_attention_read_at(
    'infinity'::timestamptz,
    false,
    'agent_task_runtime_failed: task attention non-finite read-at accepted'
  );
end;
$task_attention_signed_cursor_window_contract$;

create function pg_temp.read_task_cursor_seed()
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select public.read_agent_tasks_as_system(
    'agent-task-runtime-project-note-cursor-seed',
    '8b100000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    '8b130000-0000-4000-8000-000000000001',
    '8b120000-0000-4000-8000-000000000001',
    pg_catalog.md5('agent-task-runtime-grant'),
    array[
      'ops.financial_documents.read',
      'ops.schedule.read',
      'ops.tasks.read'
    ]::text[],
    (
      select permission_snapshot_revision
      from pg_temp.agent_task_runtime_authority
    ),
    array[
      'calendar.view',
      'estimates.view',
      'projects.view',
      'projects.view_financials',
      'tasks.view'
    ]::text[],
    'list_tasks',
    'list_tasks:2026-08-22.v1',
    '2026-08-22.capability-manifest.v8',
    array['ops.tasks.read']::text[],
    'all',
    'assigned',
    null,
    null,
    null,
    'actionable',
    null,
    null,
    array[]::text[],
    null,
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
$function$;

create function pg_temp.assert_task_cursor_stale(
  p_cursor jsonb,
  p_case text
)
returns void
language plpgsql
volatile
set search_path = ''
as $function$
begin
  begin
    perform public.read_agent_tasks_as_system(
      'agent-task-runtime-' || p_case,
      '8b100000-0000-4000-8000-000000000001',
      '8b000000-0000-4000-8000-000000000001',
      '8b130000-0000-4000-8000-000000000001',
      '8b120000-0000-4000-8000-000000000001',
      pg_catalog.md5('agent-task-runtime-grant'),
      array[
        'ops.financial_documents.read',
        'ops.schedule.read',
        'ops.tasks.read'
      ]::text[],
      (
        select permission_snapshot_revision
        from pg_temp.agent_task_runtime_authority
      ),
      array[
        'calendar.view',
        'estimates.view',
        'projects.view',
        'projects.view_financials',
        'tasks.view'
      ]::text[],
      'list_tasks',
      'list_tasks:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.tasks.read']::text[],
      'all',
      'assigned',
      null,
      null,
      null,
      'actionable',
      null,
      null,
      array[]::text[],
      null,
      null,
      null,
      25,
      26,
      501,
      (p_cursor ->> 'read_at')::timestamptz,
      p_cursor -> 'source_revisions',
      p_cursor #>> '{rows,24,predecessor,order,0}',
      (p_cursor #>> '{rows,24,predecessor,tie_breaker}')::uuid
    );
    raise exception
      'agent_task_runtime_failed: % accepted', p_case;
  exception when sqlstate '40001' then
    if sqlerrm is distinct from 'agent_task_read_stale' then
      raise;
    end if;
  end;
end;
$function$;

do $project_note_cursor_revision_contract$
declare
  v_cursor jsonb;
  v_old_before bigint;
  v_new_before bigint;
  v_old_after bigint;
  v_new_after bigint;
begin
  v_cursor := pg_temp.read_task_cursor_seed();
  insert into public.project_notes (
    id,
    project_id,
    company_id,
    author_id,
    content,
    mentioned_user_ids
  ) values (
    '8b670000-0000-4000-8000-000000000002',
    '8b400000-0000-4000-8000-000000000002',
    '8b000000-0000-4000-8000-000000000001',
    '8b100000-0000-4000-8000-000000000001',
    'Project note cursor mutation',
    array['8b100000-0000-4000-8000-000000000001']::text[]
  );
  perform pg_temp.assert_task_cursor_stale(
    v_cursor,
    'project note add mention cursor'
  );

  v_cursor := pg_temp.read_task_cursor_seed();
  update public.project_notes
  set mentioned_user_ids = array[]::text[]
  where id = '8b670000-0000-4000-8000-000000000002';
  perform pg_temp.assert_task_cursor_stale(
    v_cursor,
    'project note remove mention cursor'
  );

  update public.project_notes
  set mentioned_user_ids =
    array['8b100000-0000-4000-8000-000000000001']::text[]
  where id = '8b670000-0000-4000-8000-000000000002';
  v_cursor := pg_temp.read_task_cursor_seed();
  update public.project_notes
  set deleted_at = pg_catalog.statement_timestamp()
  where id = '8b670000-0000-4000-8000-000000000002';
  perform pg_temp.assert_task_cursor_stale(
    v_cursor,
    'project note soft delete cursor'
  );

  v_cursor := pg_temp.read_task_cursor_seed();
  delete from public.project_notes
  where id = '8b670000-0000-4000-8000-000000000002';
  perform pg_temp.assert_task_cursor_stale(
    v_cursor,
    'project note hard delete cursor'
  );

  insert into public.project_notes (
    id,
    project_id,
    company_id,
    author_id,
    content,
    mentioned_user_ids
  ) values (
    '8b670000-0000-4000-8000-000000000003',
    '8b400000-0000-4000-8000-000000000002',
    '8b000000-0000-4000-8000-000000000001',
    '8b100000-0000-4000-8000-000000000001',
    'Project note reparent mutation',
    array['8b100000-0000-4000-8000-000000000001']::text[]
  );
  v_cursor := pg_temp.read_task_cursor_seed();
  update public.project_notes
  set project_id = '8b400000-0000-4000-8000-000000000001'
  where id = '8b670000-0000-4000-8000-000000000003';
  perform pg_temp.assert_task_cursor_stale(
    v_cursor,
    'project note reparent cursor'
  );

  insert into public.project_notes (
    id,
    project_id,
    company_id,
    author_id,
    content,
    mentioned_user_ids
  ) values (
    '8b670000-0000-4000-8000-000000000004',
    '8b400000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    '8b100000-0000-4000-8000-000000000001',
    'Project note tenant move mutation',
    array['8b100000-0000-4000-8000-000000000001']::text[]
  );
  v_cursor := pg_temp.read_task_cursor_seed();

  select revision.source_revision
    into strict v_old_before
  from private.agent_read_domain_revisions revision
  where revision.company_id = '8b000000-0000-4000-8000-000000000001'
    and revision.domain = 'tasks';
  select revision.source_revision
    into strict v_new_before
  from private.agent_read_domain_revisions revision
  where revision.company_id = '8c000000-0000-4000-8000-000000000001'
    and revision.domain = 'tasks';

  update public.project_notes
  set company_id = '8c000000-0000-4000-8000-000000000001',
      project_id = '8c400000-0000-4000-8000-000000000001'
  where id = '8b670000-0000-4000-8000-000000000004';

  perform pg_temp.assert_task_cursor_stale(
    v_cursor,
    'project note tenant move revisions'
  );

  select revision.source_revision
    into strict v_old_after
  from private.agent_read_domain_revisions revision
  where revision.company_id = '8b000000-0000-4000-8000-000000000001'
    and revision.domain = 'tasks';
  select revision.source_revision
    into strict v_new_after
  from private.agent_read_domain_revisions revision
  where revision.company_id = '8c000000-0000-4000-8000-000000000001'
    and revision.domain = 'tasks';

  if v_old_after <= v_old_before or v_new_after <= v_new_before then
    raise exception
      'agent_task_runtime_failed: project note tenant move revisions missing';
  end if;
end;
$project_note_cursor_revision_contract$;

do $stale_cursor_contract$
declare
  v_result jsonb;
begin
  select result into strict v_result from agent_task_runtime_list;

  update public.project_tasks
  set custom_title = 'Install back-deck glass updated'
  where id = '8b600000-0000-4000-8000-000000000002';

  begin
    perform public.read_agent_tasks_as_system(
      'agent-task-runtime-stale-cursor',
      '8b100000-0000-4000-8000-000000000001',
      '8b000000-0000-4000-8000-000000000001',
      '8b130000-0000-4000-8000-000000000001',
      '8b120000-0000-4000-8000-000000000001',
      pg_catalog.md5('agent-task-runtime-grant'),
      array[
        'ops.financial_documents.read',
        'ops.schedule.read',
        'ops.tasks.read'
      ]::text[],
      (
        select permission_snapshot_revision
        from agent_task_runtime_authority
      ),
      array[
        'calendar.view',
        'estimates.view',
        'projects.view',
        'projects.view_financials',
        'tasks.view'
      ]::text[],
      'list_tasks',
      'list_tasks:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.tasks.read']::text[],
      'all',
      'assigned',
      null,
      null,
      null,
      'actionable',
      null,
      null,
      array[]::text[],
      null,
      null,
      null,
      25,
      26,
      501,
      (v_result ->> 'read_at')::timestamptz,
      v_result -> 'source_revisions',
      v_result #>> '{rows,24,predecessor,order,0}',
      (v_result #>> '{rows,24,predecessor,tie_breaker}')::uuid
    );
    raise exception 'agent_task_runtime_failed: stale cursor accepted';
  exception when sqlstate '40001' then
    if sqlerrm is distinct from 'agent_task_read_stale' then
      raise;
    end if;
  end;
end;
$stale_cursor_contract$;

do $revoked_grant_contract$
begin
  update private.mcp_oauth_grants
  set revoked_at = pg_catalog.statement_timestamp()
  where id = '8b130000-0000-4000-8000-000000000001';

  begin
    perform public.read_agent_tasks_as_system(
      'agent-task-runtime-revoked-grant',
      '8b100000-0000-4000-8000-000000000001',
      '8b000000-0000-4000-8000-000000000001',
      '8b130000-0000-4000-8000-000000000001',
      '8b120000-0000-4000-8000-000000000001',
      pg_catalog.md5('agent-task-runtime-grant'),
      array[
        'ops.financial_documents.read',
        'ops.schedule.read',
        'ops.tasks.read'
      ]::text[],
      (
        select permission_snapshot_revision
        from agent_task_runtime_authority
      ),
      array[
        'calendar.view',
        'estimates.view',
        'projects.view',
        'projects.view_financials',
        'tasks.view'
      ]::text[],
      'list_tasks',
      'list_tasks:2026-08-22.v1',
      '2026-08-22.capability-manifest.v8',
      array['ops.tasks.read']::text[],
      'all',
      'assigned',
      null,
      null,
      null,
      'actionable',
      null,
      null,
      array[]::text[],
      null,
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
    raise exception 'agent_task_runtime_failed: revoked grant accepted';
  exception when sqlstate '42501' then
    if sqlerrm is distinct from 'agent_task_not_authorized' then
      raise;
    end if;
  end;

  update private.mcp_oauth_grants
  set revoked_at = null
  where id = '8b130000-0000-4000-8000-000000000001';
end;
$revoked_grant_contract$;

insert into public.project_tasks (
  id,
  company_id,
  project_id,
  task_type_id,
  custom_title,
  status,
  start_date,
  end_date,
  team_member_ids
)
select (
         '8b700000-0000-4000-8000-' ||
         pg_catalog.lpad(series.value::text, 12, '0')
       )::uuid,
       '8b000000-0000-4000-8000-000000000001'::uuid,
       -- These rows belong to the actor-hidden project and are deliberately
       -- unassigned. The 501 gate must fire before per-row project authority.
       '8b400000-0000-4000-8000-000000000002'::uuid,
       '8b300000-0000-4000-8000-000000000002'::uuid,
       'Bounded task ' || series.value::text,
       'active',
       pg_catalog.date_trunc(
         'milliseconds',
         pg_catalog.statement_timestamp() +
           series.value * interval '1 minute' + interval '40 days'
       ),
       pg_catalog.date_trunc(
         'milliseconds',
         pg_catalog.statement_timestamp() +
           series.value * interval '1 minute' + interval '41 days'
       ),
       array[]::text[]
from pg_catalog.generate_series(1, 501) series(value);

do $source_bound_contract$
declare
  v_view text;
begin
  foreach v_view in array array[
    'all',
    'job',
    'assignee',
    'status',
    'schedule_window',
    'overdue',
    'unassigned',
    'actionable'
  ] loop
    begin
      perform public.read_agent_tasks_as_system(
        'agent-task-runtime-source-bound-' || v_view,
        '8b100000-0000-4000-8000-000000000001',
        '8b000000-0000-4000-8000-000000000001',
        '8b130000-0000-4000-8000-000000000001',
        '8b120000-0000-4000-8000-000000000001',
        pg_catalog.md5('agent-task-runtime-grant'),
        array[
          'ops.financial_documents.read',
          'ops.schedule.read',
          'ops.tasks.read'
        ]::text[],
        (
          select permission_snapshot_revision
          from agent_task_runtime_authority
        ),
        array[
          'calendar.view',
          'estimates.view',
          'projects.view',
          'projects.view_financials',
          'tasks.view'
        ]::text[],
        'list_tasks',
        'list_tasks:2026-08-22.v1',
        '2026-08-22.capability-manifest.v8',
        case when v_view = 'schedule_window'
          then array['ops.schedule.read', 'ops.tasks.read']::text[]
          else array['ops.tasks.read']::text[]
        end,
        'all',
        'assigned',
        case when v_view = 'schedule_window' then 'own' end,
        null,
        null,
        v_view,
        case when v_view = 'job'
          then '8b400000-0000-4000-8000-000000000002'::uuid
        end,
        case when v_view = 'assignee'
          then '8b100000-0000-4000-8000-000000000001'::uuid
        end,
        case when v_view = 'status'
          then array['completed']::text[]
          else array[]::text[]
        end,
        case when v_view = 'schedule_window' then pg_catalog.date_trunc(
          'milliseconds', pg_catalog.statement_timestamp()
        ) end,
        case when v_view = 'schedule_window' then pg_catalog.date_trunc(
          'milliseconds', pg_catalog.statement_timestamp() + interval '1 day'
        ) end,
        case when v_view = 'overdue' then pg_catalog.date_trunc(
          'milliseconds', pg_catalog.statement_timestamp()
        ) end,
        25,
        26,
        501,
        null,
        '[]'::jsonb,
        null,
        null
      );
      raise exception
        'agent_task_runtime_failed: source bound not enforced: %', v_view;
    exception when sqlstate '54000' then
      if sqlerrm is distinct from 'agent_task_source_query_bound' then
        raise;
      end if;
    end;
  end loop;
end;
$source_bound_contract$;

do $disabled_client_contract$
begin
  update private.mcp_oauth_clients
  set disabled_at = pg_catalog.statement_timestamp()
  where client_id = '8b120000-0000-4000-8000-000000000001';

  perform pg_temp.assert_task_authority_rejected('disabled_client');

  update private.mcp_oauth_clients
  set disabled_at = null
  where client_id = '8b120000-0000-4000-8000-000000000001';
end;
$disabled_client_contract$;

set local session_replication_role = replica;
update private.mcp_oauth_clients
set scope = 'ops.tasks.read',
    scope_ceiling = array['ops.tasks.read']::text[]
where client_id = '8b120000-0000-4000-8000-000000000001';
set local session_replication_role = origin;

do $client_ceiling_contract$
begin
  perform pg_temp.assert_task_authority_rejected('stale_client_ceiling');
end;
$client_ceiling_contract$;

set local session_replication_role = replica;
update private.mcp_oauth_clients
set scope =
      'ops.financial_documents.read ops.schedule.read ops.tasks.read',
    scope_ceiling = array[
      'ops.financial_documents.read',
      'ops.schedule.read',
      'ops.tasks.read'
    ]::text[]
where client_id = '8b120000-0000-4000-8000-000000000001';
set local session_replication_role = origin;

set local session_replication_role = replica;
update private.mcp_oauth_grants
set exposure_revision = '2026-08-22.mcp-exposure.v2'
where id = '8b130000-0000-4000-8000-000000000001';
set local session_replication_role = origin;

do $exposure_revision_contract$
begin
  perform pg_temp.assert_task_authority_rejected('stale_exposure_revision');
end;
$exposure_revision_contract$;

set local session_replication_role = replica;
update private.mcp_oauth_grants
set exposure_revision = '2026-08-22.mcp-exposure.v1'
where id = '8b130000-0000-4000-8000-000000000001';
set local session_replication_role = origin;

alter table private.mcp_oauth_clients
  drop constraint mcp_oauth_clients_scope_ceiling_valid;
set local session_replication_role = replica;
update private.mcp_oauth_clients
set consent_catalog_revision = '2026-08-22.mcp-consent-catalog.v2'
where client_id = '8b120000-0000-4000-8000-000000000001';
set local session_replication_role = origin;

do $consent_revision_contract$
begin
  perform pg_temp.assert_task_authority_rejected('stale_consent_revision');
end;
$consent_revision_contract$;

set local session_replication_role = replica;
update private.mcp_oauth_clients
set consent_catalog_revision = '2026-08-22.mcp-consent-catalog.v1'
where client_id = '8b120000-0000-4000-8000-000000000001';
set local session_replication_role = origin;

alter table private.mcp_oauth_grants
  drop constraint mcp_oauth_grants_consent_snapshot_valid;
set local session_replication_role = replica;
update private.mcp_oauth_grants
set accepted_labels = array['tampered consent']::text[]
where id = '8b130000-0000-4000-8000-000000000001';
set local session_replication_role = origin;

do $accepted_labels_contract$
begin
  perform pg_temp.assert_task_authority_rejected('invalid_accepted_labels');
end;
$accepted_labels_contract$;

rollback;
