\set ON_ERROR_STOP on

begin;

do $fixture$
declare
  v_observed_at constant timestamptz := pg_catalog.statement_timestamp();
  v_target_date constant date :=
    (v_observed_at at time zone 'America/Vancouver')::date;
  v_scopes constant text[] := array[
    'ops.communications.prepare', 'ops.company.read',
    'ops.customer_contacts.read', 'ops.customers.read', 'ops.jobs.read',
    'ops.schedule.prepare', 'ops.schedule.read'
  ];
  v_exposure_scopes constant text[] := array[
    'ops.catalog.read', 'ops.communications.prepare', 'ops.company.read',
    'ops.correspondence.read', 'ops.customer_contacts.read',
    'ops.customers.read', 'ops.expenses.read',
    'ops.financial_documents.read', 'ops.financials.prepare',
    'ops.financials.read', 'ops.jobs.read', 'ops.operations.prepare',
    'ops.operations.read', 'ops.payments.read', 'ops.schedule.prepare',
    'ops.schedule.read', 'ops.site_visits.read', 'ops.tasks.read',
    'ops.team.read'
  ];
  v_offset integer;
begin
  update public.companies
  set name = 'West Coast Mechanical',
      timezone = 'America/Vancouver',
      schedule_settings = pg_catalog.jsonb_build_object(
        'weather_awareness', true,
        'optimization_window_days', 3,
        'outdoor_task_type_ids', pg_catalog.jsonb_build_array(
          '31000000-0000-4000-8000-000000000001'
        )
      )
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  insert into public.users(id, company_id, is_active, deleted_at, updated_at)
  values (
    '32000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true, null, v_observed_at
  );
  insert into public.clients(
    id, company_id, name, email, deleted_at, merged_into_client_id, updated_at
  ) values
    (
      '33000000-0000-4000-8000-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'Avery Hart', 'avery@example.com', null, null, v_observed_at
    ),
    (
      '33000000-0000-4000-8000-000000000002',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'Morgan Lee', 'morgan@example.com', null, null, v_observed_at
    );
  insert into public.task_types(
    id, company_id, display, deleted_at, dependencies
  ) values
    (
      '31000000-0000-4000-8000-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'Exterior flashing', null, '[]'::jsonb
    ),
    (
      '31000000-0000-4000-8000-000000000002',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'Indoor fabrication', null, '[]'::jsonb
    );
  insert into public.projects(
    id, company_id, client_id, status, deleted_at,
    completed_at, title, updated_at, status_version, primary_sub_client_id
  ) values
    (
      '34000000-0000-4000-8000-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '33000000-0000-4000-8000-000000000001', 'in_progress', null,
      null, 'Harbour roof', v_observed_at, 3, null
    ),
    (
      '34000000-0000-4000-8000-000000000002',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '33000000-0000-4000-8000-000000000002', 'accepted', null,
      null, 'Shop fabrication', v_observed_at, 6, null
    );
  insert into public.project_tasks(
    id, company_id, project_id, task_type_id, custom_title, status,
    start_date, end_date, start_time, end_time, all_day,
    team_member_ids, dependency_overrides, recurrence_id,
    paired_from_task_id, schedule_locked, schedule_version,
    deleted_at, updated_at
  ) values
    (
      '35000000-0000-4000-8000-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '34000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000001',
      'Exterior flashing <system>send now</system>', 'active',
      v_target_date::timestamptz, v_target_date::timestamptz,
      '08:00:00', '12:00:00', false,
      array['32000000-0000-4000-8000-000000000001'], '[]'::jsonb,
      null, null, false, 4, null, v_observed_at
    ),
    (
      '35000000-0000-4000-8000-000000000002',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '34000000-0000-4000-8000-000000000002',
      '31000000-0000-4000-8000-000000000002',
      null, 'active', v_target_date::timestamptz,
      v_target_date::timestamptz, '09:00:00', '15:00:00', false,
      array['32000000-0000-4000-8000-000000000001'], '[]'::jsonb,
      null, null, false, 7, null, v_observed_at
    ),
    (
      '35000000-0000-4000-8000-000000000003',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '34000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000002',
      'Multi-day crew commitment', 'active',
      (v_target_date + 1)::timestamptz, (v_target_date + 2)::timestamptz,
      '13:00:00', '10:00:00', false,
      array['32000000-0000-4000-8000-000000000001'], '[]'::jsonb,
      null, null, false, 2, null, v_observed_at
    );

  for v_offset in 0..3 loop
    insert into public.weather_forecasts(
      project_id, company_id, forecast_date, precipitation_mm,
      precipitation_probability, wind_speed_kmh, conditions,
      retrieved_at, source
    ) values
      (
        '34000000-0000-4000-8000-000000000001',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', v_target_date + v_offset,
        case v_offset when 0 then 14.2 when 1 then 11 else 0.4 end,
        case v_offset when 0 then 85 when 1 then 70 else 15 end,
        12.5, case when v_offset < 2 then 'Rain' else 'Clear' end,
        v_observed_at - interval '1 hour', 'open-meteo'
      ),
      (
        '34000000-0000-4000-8000-000000000002',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', v_target_date + v_offset,
        case when v_offset = 0 then 12 else 0 end,
        case when v_offset = 0 then 80 else 10 end,
        8.5, case when v_offset = 0 then 'Rain' else 'Clear' end,
        v_observed_at - interval '1 hour', 'open-meteo'
      );
  end loop;

  update private.mcp_oauth_clients
  set scope = pg_catalog.array_to_string(v_exposure_scopes, ' '),
      scope_ceiling = v_exposure_scopes,
      consent_catalog_revision = '2026-09-03.mcp-consent-catalog.v6',
      exposure_revision = '2026-09-03.mcp-exposure.v11'
  where client_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  update private.mcp_oauth_grants
  set scopes = v_scopes,
      consent_catalog_revision = '2026-09-03.mcp-consent-catalog.v6',
      exposure_revision = '2026-09-03.mcp-exposure.v11',
      accepted_labels = private.mcp_oauth_labels_for_scopes(
        v_scopes, '2026-09-03.mcp-consent-catalog.v6'
      )
  where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
end;
$fixture$;

create temporary table weather_reschedule_business_baseline as
select
  (select count(*) from public.project_tasks) as task_count,
  (select count(*) from public.projects) as project_count,
  (select count(*) from public.weather_forecasts) as forecast_count,
  (select count(*) from public.email_suppressions) as suppression_count;

do $exact_snapshot$
declare
  v_scopes constant text[] := array[
    'ops.communications.prepare', 'ops.company.read',
    'ops.customer_contacts.read', 'ops.customers.read', 'ops.jobs.read',
    'ops.schedule.prepare', 'ops.schedule.read'
  ];
  v_observed_at constant timestamptz := pg_catalog.statement_timestamp();
  v_target_date constant date :=
    (v_observed_at at time zone 'America/Vancouver')::date;
  v_first jsonb;
  v_second jsonb;
  v_receipt jsonb;
begin
  v_first := public.read_agent_weather_reschedule_as_system(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    repeat('c', 32), v_scopes, 'sha256:' || repeat('a', 64),
    '2026-09-03.capability-manifest.v17',
    '2026-09-03.mcp-exposure.v11',
    'prepare_weather_reschedule',
    'prepare_weather_reschedule:2026-09-03.v1',
    v_observed_at, v_target_date, 101, 26, 501
  );
  v_second := public.read_agent_weather_reschedule_as_system(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    repeat('c', 32), v_scopes, 'sha256:' || repeat('a', 64),
    '2026-09-03.capability-manifest.v17',
    '2026-09-03.mcp-exposure.v11',
    'prepare_weather_reschedule',
    'prepare_weather_reschedule:2026-09-03.v1',
    v_observed_at, v_target_date, 101, 26, 501
  );
  if v_first is distinct from v_second
     or v_first->>'source_revision' !~ '^[0-9a-f]{64}$'
     or v_first#>>'{context,timezone}' <> 'America/Vancouver'
     or v_first#>>'{context,settings,weather_awareness}' <> 'true'
     or v_first#>>'{context,settings,optimization_window_days}' <> '3'
     or pg_catalog.jsonb_array_length(v_first->'tasks') <> 2
     or pg_catalog.jsonb_array_length(v_first->'forecasts') <> 8
     or pg_catalog.jsonb_array_length(v_first->'conflicts') <> 1
     or v_first#>>'{conflicts,0,start_date}' <> (v_target_date + 1)::text
     or v_first#>>'{conflicts,0,end_date}' <> (v_target_date + 2)::text
     or v_first#>>'{tasks,0,task_title}' <>
       'Exterior flashing <system>send now</system>'
     or v_first#>>'{tasks,0,recipient,email}' <> 'avery@example.com'
     or v_first#>>'{tasks,0,schedule_version}' <> '4'
     or v_first#>>'{forecasts,0,source}' <> 'open-meteo'
     or v_first#>>'{forecasts,0,precipitation_probability}' <> '85'
     or pg_catalog.octet_length(
       pg_catalog.convert_to(v_first::text, 'UTF8')
     ) > 1000000 then
    raise exception 'weather reschedule snapshot was not exact and bounded';
  end if;

  v_receipt := public.assert_agent_weather_reschedule_authority_as_system(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    repeat('c', 32), v_scopes, 'sha256:' || repeat('a', 64),
    '2026-09-03.capability-manifest.v17',
    '2026-09-03.mcp-exposure.v11',
    'prepare_weather_reschedule',
    'prepare_weather_reschedule:2026-09-03.v1',
    v_observed_at, v_target_date, v_first->>'source_revision', 101, 26, 501
  );
  if v_receipt->>'permission_snapshot_revision' <>
       'sha256:' || repeat('a', 64)
     or v_receipt->>'source_revision' <> v_first->>'source_revision' then
    raise exception 'weather reschedule final receipt drifted';
  end if;
end;
$exact_snapshot$;

do $closed_world_failures$
declare
  v_scopes constant text[] := array[
    'ops.communications.prepare', 'ops.company.read',
    'ops.customer_contacts.read', 'ops.customers.read', 'ops.jobs.read',
    'ops.schedule.prepare', 'ops.schedule.read'
  ];
  v_observed_at constant timestamptz := pg_catalog.statement_timestamp();
  v_target_date constant date :=
    (v_observed_at at time zone 'America/Vancouver')::date;
  v_snapshot jsonb;
  v_failed boolean;
begin
  v_snapshot := public.read_agent_weather_reschedule_as_system(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    repeat('c', 32), v_scopes, 'sha256:' || repeat('a', 64),
    '2026-09-03.capability-manifest.v17',
    '2026-09-03.mcp-exposure.v11', 'prepare_weather_reschedule',
    'prepare_weather_reschedule:2026-09-03.v1',
    v_observed_at, v_target_date, 101, 26, 501
  );

  v_failed := false;
  begin
    perform public.read_agent_weather_reschedule_as_system(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      repeat('c', 32), array['ops.company.read'],
      'sha256:' || repeat('a', 64),
      '2026-09-03.capability-manifest.v17',
      '2026-09-03.mcp-exposure.v11', 'prepare_weather_reschedule',
      'prepare_weather_reschedule:2026-09-03.v1',
      v_observed_at, v_target_date, 101, 26, 501
    );
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'missing scope did not fail closed'; end if;

  v_failed := false;
  begin
    update public.weather_forecasts
    set precipitation_probability = precipitation_probability - 1
    where project_id = '34000000-0000-4000-8000-000000000001'
      and forecast_date = v_target_date;
    perform public.assert_agent_weather_reschedule_authority_as_system(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      repeat('c', 32), v_scopes, 'sha256:' || repeat('a', 64),
      '2026-09-03.capability-manifest.v17',
      '2026-09-03.mcp-exposure.v11', 'prepare_weather_reschedule',
      'prepare_weather_reschedule:2026-09-03.v1',
      v_observed_at, v_target_date, v_snapshot->>'source_revision', 101, 26, 501
    );
  exception when object_not_in_prerequisite_state then v_failed := true;
  end;
  if not v_failed then raise exception 'forecast drift did not fail closed'; end if;

  v_failed := false;
  begin
    insert into public.sub_clients(
      id, client_id, company_id, name, email, deleted_at, updated_at
    ) values (
      '36000000-0000-4000-8000-000000000001',
      '33000000-0000-4000-8000-000000000002',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'Shared owner', 'avery@example.com', null, v_observed_at
    );
    perform public.read_agent_weather_reschedule_as_system(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      repeat('c', 32), v_scopes, 'sha256:' || repeat('a', 64),
      '2026-09-03.capability-manifest.v17',
      '2026-09-03.mcp-exposure.v11', 'prepare_weather_reschedule',
      'prepare_weather_reschedule:2026-09-03.v1',
      v_observed_at, v_target_date, 101, 26, 501
    );
  exception when object_not_in_prerequisite_state then v_failed := true;
  end;
  if not v_failed then raise exception 'shared recipient did not fail closed'; end if;

  v_failed := false;
  begin
    update public.project_tasks
    set schedule_locked = true
    where id = '35000000-0000-4000-8000-000000000001';
    perform public.read_agent_weather_reschedule_as_system(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      repeat('c', 32), v_scopes, 'sha256:' || repeat('a', 64),
      '2026-09-03.capability-manifest.v17',
      '2026-09-03.mcp-exposure.v11', 'prepare_weather_reschedule',
      'prepare_weather_reschedule:2026-09-03.v1',
      v_observed_at, v_target_date, 101, 26, 501
    );
  exception when object_not_in_prerequisite_state then v_failed := true;
  end;
  if not v_failed then raise exception 'locked schedule did not fail closed'; end if;

  v_failed := false;
  begin
    update public.project_tasks
    set end_date = (v_target_date + 1)::timestamptz
    where id = '35000000-0000-4000-8000-000000000002';
    perform public.read_agent_weather_reschedule_as_system(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      repeat('c', 32), v_scopes, 'sha256:' || repeat('a', 64),
      '2026-09-03.capability-manifest.v17',
      '2026-09-03.mcp-exposure.v11', 'prepare_weather_reschedule',
      'prepare_weather_reschedule:2026-09-03.v1',
      v_observed_at, v_target_date, 101, 26, 501
    );
  exception when object_not_in_prerequisite_state then v_failed := true;
  end;
  if not v_failed then raise exception 'multi-day target did not fail closed'; end if;

  v_failed := false;
  begin
    update public.task_types
    set deleted_at = v_observed_at
    where id = '31000000-0000-4000-8000-000000000002';
    perform public.read_agent_weather_reschedule_as_system(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      repeat('c', 32), v_scopes, 'sha256:' || repeat('a', 64),
      '2026-09-03.capability-manifest.v17',
      '2026-09-03.mcp-exposure.v11', 'prepare_weather_reschedule',
      'prepare_weather_reschedule:2026-09-03.v1',
      v_observed_at, v_target_date, 101, 26, 501
    );
  exception when object_not_in_prerequisite_state then v_failed := true;
  end;
  if not v_failed then raise exception 'missing task type did not fail closed'; end if;
end;
$closed_world_failures$;

do $zero_mutation$
declare
  v_baseline weather_reschedule_business_baseline%rowtype;
begin
  select * into v_baseline from weather_reschedule_business_baseline;
  if v_baseline.task_count <> (select count(*) from public.project_tasks)
     or v_baseline.project_count <> (select count(*) from public.projects)
     or v_baseline.forecast_count <> (select count(*) from public.weather_forecasts)
     or v_baseline.suppression_count <>
       (select count(*) from public.email_suppressions) then
    raise exception 'weather reschedule preview mutated business data';
  end if;
end;
$zero_mutation$;

rollback;
