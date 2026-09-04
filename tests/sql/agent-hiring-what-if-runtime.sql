\set ON_ERROR_STOP on

begin;

create temporary table hiring_runtime_scratch(value integer);

create function pg_temp.hiring_snapshot()
returns jsonb
language sql
volatile
as $function$
  select public.read_agent_hiring_what_if_as_system(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    repeat('b', 32),
    array[
      'ops.company.read',
      'ops.expenses.read',
      'ops.financial_documents.read',
      'ops.financials.read',
      'ops.jobs.read',
      'ops.payments.read',
      'ops.schedule.read',
      'ops.site_visits.read',
      'ops.tasks.read',
      'ops.team.read'
    ],
    'sha256:' || repeat('a', 64),
    '2026-08-31.capability-manifest.v11',
    '2026-08-31.mcp-exposure.v5',
    'Installer',
    '2026-09-01 12:00:00+00',
    13,
    25,
    5001,
    5001,
    251,
    100
  );
$function$;

do $assert_currency_minor_units$
begin
  if private.agent_currency_minor_exponent_or_null('CHF') is distinct from 2
     or private.agent_currency_minor_exponent_or_null('XCG') is distinct from 2
     or private.agent_currency_minor_exponent_or_null('ZWG') is distinct from 2
     or private.agent_money_to_minor_units(1.23, 'CHF') is distinct from 123
     or private.agent_money_to_minor_units(1.23, 'XCG') is distinct from 123
     or private.agent_money_to_minor_units(1.23, 'ZWG') is distinct from 123 then
    raise exception 'hiring currency minor-unit mapping drifted';
  end if;
end;
$assert_currency_minor_units$;

do $assert_function_security$
declare
  v_function regprocedure :=
    'public.read_agent_hiring_what_if_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,timestamp with time zone,integer,integer,integer,integer,integer,integer)'::regprocedure;
  v_volatile "char";
  v_security_definer boolean;
  v_configuration text[];
begin
  select procedure.provolatile, procedure.prosecdef, procedure.proconfig
    into v_volatile, v_security_definer, v_configuration
  from pg_catalog.pg_proc procedure
  where procedure.oid = v_function;

  if v_volatile <> 's'
     or not v_security_definer
     or pg_catalog.array_to_string(v_configuration, ',') not like
          '%search_path=""%' then
    raise exception 'hiring runtime function security attributes drifted';
  end if;
  if not pg_catalog.has_function_privilege('service_role', v_function, 'execute')
     or pg_catalog.has_function_privilege('anon', v_function, 'execute')
     or pg_catalog.has_function_privilege('authenticated', v_function, 'execute') then
    raise exception 'hiring runtime function ACL drifted';
  end if;
end;
$assert_function_security$;

do $assert_authority$
begin
  begin
    perform public.read_agent_hiring_what_if_as_system(
      '11111111-1111-4111-8111-111111111111',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      repeat('b', 32),
      array[
        'ops.company.read', 'ops.expenses.read',
        'ops.financial_documents.read', 'ops.financials.read',
        'ops.jobs.read', 'ops.payments.read', 'ops.schedule.read',
        'ops.site_visits.read', 'ops.tasks.read', 'ops.team.read'
      ],
      'sha256:' || repeat('a', 64),
      '2026-08-31.capability-manifest.v11',
      '2026-08-31.mcp-exposure.v5',
      'Installer', '2026-09-01 12:00:00+00',
      13, 25, 5001, 5001, 251, 100
    );
    raise exception 'tenant mismatch did not fail closed';
  exception when insufficient_privilege then
    null;
  end;

  update private.mcp_oauth_grants
  set revoked_at = '2026-09-01 11:59:00+00'
  where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  begin
    perform pg_temp.hiring_snapshot();
    raise exception 'revoked grant did not fail closed';
  exception when insufficient_privilege then
    null;
  end;
  update private.mcp_oauth_grants
  set revoked_at = null
  where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  begin
    perform public.read_agent_hiring_what_if_as_system(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      repeat('b', 32),
      array[
        'ops.company.read', 'ops.expenses.read',
        'ops.financial_documents.read', 'ops.financials.read',
        'ops.jobs.read', 'ops.payments.read', 'ops.schedule.read',
        'ops.site_visits.read', 'ops.tasks.read', 'ops.team.read'
      ],
      'sha256:' || repeat('a', 64),
      '2026-08-31.capability-manifest.v11',
      '2026-08-31.mcp-exposure.v5',
      'Installer', '2026-09-01 12:00:00+00',
      12, 25, 5001, 5001, 251, 100
    );
    raise exception 'noncanonical source bound did not fail closed';
  exception when invalid_parameter_value then
    null;
  end;
end;
$assert_authority$;

do $assert_golden_source$
declare
  v_snapshot jsonb := pg_temp.hiring_snapshot();
  v_capacity bigint;
  v_productive bigint;
  v_revenue bigint;
  v_direct_cost bigint;
  v_time_off_week integer;
begin
  select
    sum((week.value ->> 'capacity_minutes')::bigint),
    sum((week.value ->> 'productive_minutes')::bigint),
    sum((week.value ->> 'attributed_revenue_minor')::bigint),
    sum((week.value ->> 'attributed_direct_cost_minor')::bigint)
  into v_capacity, v_productive, v_revenue, v_direct_cost
  from pg_catalog.jsonb_array_elements(v_snapshot -> 'weeks') week(value);

  select (week.value ->> 'capacity_minutes')::integer
    into v_time_off_week
  from pg_catalog.jsonb_array_elements(v_snapshot -> 'weeks') week(value)
  where week.value ->> 'starts_on' = '2026-06-29';

  if v_snapshot ->> 'business_date' <> '2026-09-01'
     or v_snapshot #>> '{window,starts_on}' <> '2026-06-01'
     or v_snapshot #>> '{window,ends_on}' <> '2026-08-31'
     or pg_catalog.jsonb_array_length(v_snapshot -> 'weeks') <> 13
     or v_snapshot #>> '{completeness,source_state}' <> 'complete'
     or (v_snapshot #>> '{role,active_member_count}')::integer <> 2
     or (v_snapshot #>> '{completeness,financially_observed_project_count}')::integer <> 3
     or (v_snapshot #>> '{completeness,source_counts,tasks}')::integer <> 4
     or (v_snapshot #>> '{completeness,source_counts,site_visits}')::integer <> 1
     or v_capacity <> 61920
     or v_time_off_week <> 4320
     or v_productive <> 1500
     or v_revenue <> 300000
     or v_direct_cost <> 0
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_snapshot -> 'supporting_records'
       ) source(value)
       where source.value ->> 'kind' = 'site_visit'
         and source.value ->> 'id' =
           '51000000-0000-4000-8000-000000000001'
     ) then
    raise exception 'hiring golden source drifted: %', v_snapshot;
  end if;
end;
$assert_golden_source$;

set local enable_seqscan = off;

do $assert_history_index$
declare
  v_definition text;
  v_plan text := '';
  v_line record;
begin
  select index_row.indexdef
    into v_definition
  from pg_catalog.pg_indexes index_row
  where index_row.schemaname = 'public'
    and index_row.indexname = 'idx_site_visits_agent_hiring_history_v1';
  if v_definition is null
     or v_definition not like '%(company_id, scheduled_at, id)%'
     or v_definition not like '%booked_at IS NOT NULL%'
     or v_definition not like '%status <>%cancelled%' then
    raise exception 'hiring history index definition drifted: %', v_definition;
  end if;

  for v_line in execute $plan$
    explain
    select visit.project_ref, visit.project_id, visit.duration_minutes,
           visit.assignee_ids, visit.status, visit.booked_at
    from public.site_visits visit
    where visit.company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and visit.deleted_at is null
      and visit.booked_at is not null
      and visit.status <> 'cancelled'
      and visit.scheduled_at > '2026-05-31 07:00:00+00'
      and visit.scheduled_at < '2026-08-31 07:00:00+00'
  $plan$ loop
    v_plan := v_plan || ' ' || v_line."QUERY PLAN";
  end loop;
  if v_plan not like '%idx_site_visits_agent_hiring_history_v1%'
     or v_plan !~
       'Index Cond:.*scheduled_at >.*scheduled_at <' then
    raise exception 'hiring history query did not use both index range bounds: %',
      v_plan;
  end if;
end;
$assert_history_index$;

insert into public.expenses values (
  '91000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  100.00,
  null,
  '2026-06-16',
  'approved',
  null
);
insert into public.expense_project_allocations values (
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  100.00,
  null
);

do $assert_null_currency$
declare
  v_snapshot jsonb := pg_temp.hiring_snapshot();
begin
  if v_snapshot #>> '{completeness,source_state}' <> 'insufficient'
     or (v_snapshot #>> '{completeness,omitted_counts,invalid_currency_expenses}')::integer <> 1
     or not (v_snapshot #> '{completeness,reasons}') @>
       '["invalid_currency_expense"]'::jsonb then
    raise exception 'null expense currency did not fail closed: %', v_snapshot;
  end if;
end;
$assert_null_currency$;

insert into public.expenses values (
  '91000000-0000-4000-8000-000000000002',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  100.00,
  'CAD',
  '2026-07-07',
  'approved',
  null
);
insert into public.expense_project_allocations values (
  '92000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000002',
  '31000000-0000-4000-8000-000000000002',
  null,
  null
);

do $assert_null_allocation$
declare
  v_snapshot jsonb := pg_temp.hiring_snapshot();
begin
  if v_snapshot #>> '{completeness,source_state}' <> 'insufficient'
     or (v_snapshot #>> '{completeness,omitted_counts,invalid_currency_expenses}')::integer <> 2 then
    raise exception 'null expense allocation did not fail closed: %', v_snapshot;
  end if;
end;
$assert_null_allocation$;

rollback;
