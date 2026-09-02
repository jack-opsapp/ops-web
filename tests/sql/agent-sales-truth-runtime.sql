\set ON_ERROR_STOP on

begin;

create function pg_temp.sales_truth_snapshot()
returns jsonb
language sql
volatile
as $function$
  select public.read_agent_sales_truth_as_system(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    repeat('b', 32),
    array['ops.correspondence.read', 'ops.operations.read'],
    'sha256:' || repeat('a', 64),
    '2026-09-01.capability-manifest.v13',
    '2026-09-01.mcp-exposure.v7',
    'analyze_sales_truth',
    'analyze_sales_truth:2026-09-01.v1',
    '2026-09-01 12:00:00+00',
    180,
    5000,
    20000,
    5000,
    20000
  );
$function$;

do $assert_function_security$
declare
  v_function regprocedure :=
    'public.read_agent_sales_truth_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,timestamp with time zone,integer,integer,integer,integer,integer)'::regprocedure;
  v_private_function regprocedure :=
    'private.assert_agent_sales_truth_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text)'::regprocedure;
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
     or v_configuration is distinct from array['search_path=""']::text[] then
    raise exception 'sales truth function security attributes drifted';
  end if;
  if not pg_catalog.has_function_privilege('service_role', v_function, 'execute')
     or pg_catalog.has_function_privilege('anon', v_function, 'execute')
     or pg_catalog.has_function_privilege('authenticated', v_function, 'execute') then
    raise exception 'sales truth function ACL drifted';
  end if;
  select procedure.provolatile, procedure.prosecdef, procedure.proconfig
    into v_volatile, v_security_definer, v_configuration
  from pg_catalog.pg_proc procedure
  where procedure.oid = v_private_function;
  if v_volatile <> 's'
     or not v_security_definer
     or v_configuration is distinct from array['search_path=""']::text[]
     or pg_catalog.has_function_privilege(
          'service_role', v_private_function, 'execute'
        )
     or pg_catalog.has_function_privilege(
          'anon', v_private_function, 'execute'
        )
     or pg_catalog.has_function_privilege(
          'authenticated', v_private_function, 'execute'
        ) then
    raise exception 'sales truth private authority attributes drifted';
  end if;
end;
$assert_function_security$;

do $assert_authority$
begin
  begin
    perform public.read_agent_sales_truth_as_system(
      '11111111-1111-4111-8111-111111111111',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      repeat('b', 32),
      array['ops.correspondence.read', 'ops.operations.read'],
      'sha256:' || repeat('a', 64),
      '2026-09-01.capability-manifest.v13',
      '2026-09-01.mcp-exposure.v7',
      'analyze_sales_truth',
      'analyze_sales_truth:2026-09-01.v1',
      '2026-09-01 12:00:00+00', 180, 5000, 20000, 5000, 20000
    );
    raise exception 'tenant mismatch did not fail closed';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.read_agent_sales_truth_as_system(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      repeat('b', 32),
      array['ops.correspondence.read', 'ops.operations.read'],
      'sha256:' || repeat('a', 64),
      '2026-09-01.capability-manifest.v13',
      '2026-09-01.mcp-exposure.v7',
      'analyze_sales_truth',
      'analyze_sales_truth:2026-09-01.v1',
      '2026-09-01 12:00:00+00', 180, 5000, 20000, 5000, 20000
    );
    raise exception 'wrong client did not fail closed';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.read_agent_sales_truth_as_system(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      repeat('c', 32),
      array['ops.correspondence.read', 'ops.operations.read'],
      'sha256:' || repeat('a', 64),
      '2026-09-01.capability-manifest.v13',
      '2026-09-01.mcp-exposure.v7',
      'analyze_sales_truth',
      'analyze_sales_truth:2026-09-01.v1',
      '2026-09-01 12:00:00+00', 180, 5000, 20000, 5000, 20000
    );
    raise exception 'wrong grant revision did not fail closed';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.read_agent_sales_truth_as_system(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      repeat('b', 32),
      array['ops.correspondence.read', 'ops.operations.read'],
      'sha256:' || repeat('c', 64),
      '2026-09-01.capability-manifest.v13',
      '2026-09-01.mcp-exposure.v7',
      'analyze_sales_truth',
      'analyze_sales_truth:2026-09-01.v1',
      '2026-09-01 12:00:00+00', 180, 5000, 20000, 5000, 20000
    );
    raise exception 'wrong permission snapshot did not fail closed';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.read_agent_sales_truth_as_system(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      repeat('b', 32),
      array['ops.correspondence.read'],
      'sha256:' || repeat('a', 64),
      '2026-09-01.capability-manifest.v13',
      '2026-09-01.mcp-exposure.v7',
      'analyze_sales_truth',
      'analyze_sales_truth:2026-09-01.v1',
      '2026-09-01 12:00:00+00', 180, 5000, 20000, 5000, 20000
    );
    raise exception 'reduced scope ceiling did not fail closed';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.read_agent_sales_truth_as_system(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      repeat('b', 32),
      array['ops.correspondence.read', 'ops.operations.read'],
      'sha256:' || repeat('a', 64),
      '2026-09-01.capability-manifest.v12',
      '2026-09-01.mcp-exposure.v6',
      'analyze_sales_truth',
      'analyze_sales_truth:2026-09-01.v1',
      '2026-09-01 12:00:00+00', 180, 5000, 20000, 5000, 20000
    );
    raise exception 'wrong manifest and exposure did not fail closed';
  exception when insufficient_privilege then null;
  end;

  update private.mcp_oauth_grants
  set revoked_at = '2026-09-01 11:59:00+00'
  where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  begin
    perform pg_temp.sales_truth_snapshot();
    raise exception 'revoked grant did not fail closed';
  exception when insufficient_privilege then null;
  end;
  update private.mcp_oauth_grants set revoked_at = null
  where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  delete from private.test_authority_permissions
  where permission = 'pipeline.view';
  begin
    perform pg_temp.sales_truth_snapshot();
    raise exception 'missing pipeline permission did not fail closed';
  exception when insufficient_privilege then null;
  end;
  insert into private.test_authority_permissions values ('pipeline.view');

  delete from private.test_authority_permissions
  where permission = 'email.view';
  begin
    perform pg_temp.sales_truth_snapshot();
    raise exception 'missing email permission did not fail closed';
  exception when insufficient_privilege then null;
  end;
  insert into private.test_authority_permissions values ('email.view');

  begin
    perform public.read_agent_sales_truth_as_system(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      repeat('b', 32),
      array['ops.correspondence.read', 'ops.operations.read'],
      'sha256:' || repeat('a', 64),
      '2026-09-01.capability-manifest.v13',
      '2026-09-01.mcp-exposure.v7',
      'analyze_sales_truth',
      'analyze_sales_truth:2026-09-01.v1',
      '2026-09-01 12:00:00+00', 30, 5000, 20000, 5000, 20000
    );
    raise exception 'caller-selected metric window did not fail closed';
  exception when invalid_parameter_value then null;
  end;
end;
$assert_authority$;

do $assert_golden_snapshot$
declare
  v_snapshot jsonb := pg_temp.sales_truth_snapshot();
begin
  if v_snapshot ->> 'observed_at' <> '2026-09-01T12:00:00.000Z'
     or v_snapshot ->> 'business_date' <> '2026-09-01'
     or v_snapshot #>> '{context,timezone}' <> 'America/Vancouver'
     or v_snapshot #>> '{context,currency_code}' <> 'CAD'
     or v_snapshot #>> '{window,starts_on}' <> '2026-03-06'
     or v_snapshot #>> '{window,ends_on}' <> '2026-09-01'
     or (v_snapshot #>> '{window,days}')::integer <> 180
     or (v_snapshot #>> '{source_revisions,company}')::bigint <> 7
     or (v_snapshot #>> '{source_revisions,sales_truth}')::bigint <> 0
     or (v_snapshot #>> '{source_counts,opportunities}')::integer <> 3
     or (v_snapshot #>> '{source_counts,transitions}')::integer <> 3
     or (v_snapshot #>> '{source_counts,dispositions}')::integer <> 1
     or (v_snapshot #>> '{source_counts,activities}')::integer <> 2
     or pg_catalog.jsonb_array_length(v_snapshot -> 'opportunities') <> 3
     or pg_catalog.jsonb_array_length(v_snapshot -> 'activities') <> 2
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_snapshot -> 'opportunities') row(value)
       where row.value ->> 'id' =
         '10000000-0000-4000-8000-000000000004'
     )
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_snapshot -> 'transitions') row(value)
       where row.value ->> 'id' =
         '20000000-0000-4000-8000-000000000002'
         and (row.value ->> 'duration_minutes')::integer = 2880
     )
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_snapshot -> 'dispositions') row(value)
       where row.value ->> 'reason_code' = 'Price'
     ) then
    raise exception 'sales truth golden snapshot drifted: %', v_snapshot;
  end if;
end;
$assert_golden_snapshot$;

do $assert_malformed_duration$
begin
  insert into public.stage_transitions values (
    '20000000-0000-4000-8000-000000000099',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10000000-0000-4000-8000-000000000003',
    'negotiation',
    'quoted',
    '2026-08-07 12:00:00+00',
    interval '-1 minute'
  );
  begin
    perform pg_temp.sales_truth_snapshot();
    raise exception 'negative transition duration did not fail closed';
  exception when invalid_parameter_value then null;
  end;
  delete from public.stage_transitions
  where id = '20000000-0000-4000-8000-000000000099';
end;
$assert_malformed_duration$;

do $assert_revision_triggers$
declare
  v_before bigint;
  v_after bigint;
begin
  select source_revision into v_before
  from private.agent_read_domain_revisions
  where company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and domain = 'sales_truth';

  update public.opportunities set source = 'phone'
  where id = '10000000-0000-4000-8000-000000000003';
  insert into public.activities values (
    '40000000-0000-4000-8000-000000000005',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '10000000-0000-4000-8000-000000000003',
    'text_message',
    'inbound',
    '2026-08-03 15:00:00+00'
  );

  select source_revision into v_after
  from private.agent_read_domain_revisions
  where company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and domain = 'sales_truth';
  if v_after is distinct from v_before + 2 then
    raise exception 'sales truth source revision did not advance exactly';
  end if;
end;
$assert_revision_triggers$;

set local enable_seqscan = off;

do $assert_indexes$
declare
  v_plan text := '';
  v_line record;
  v_shape_valid boolean;
begin
  select count(*) = 1
     and bool_and(
       access_method.amname = 'btree'
       and not index_row.indisunique
       and not index_row.indisprimary
       and index_row.indisvalid
       and index_row.indisready
       and index_row.indislive
       and index_row.indnkeyatts = 3
       and index_row.indnatts = 3
       and index_row.indexprs is null
       and index_relation.reloptions is null
       and pg_catalog.pg_get_indexdef(index_row.indexrelid, 1, true) =
         'company_id'
       and pg_catalog.pg_get_indexdef(index_row.indexrelid, 2, true) =
         'created_at'
       and pg_catalog.pg_get_indexdef(index_row.indexrelid, 3, true) = 'id'
       and pg_catalog.pg_get_expr(
         index_row.indpred, index_row.indrelid, true
       ) = 'deleted_at IS NULL AND merged_into_opportunity_id IS NULL'
     )
    into v_shape_valid
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_relation
    on index_relation.oid = index_row.indexrelid
  join pg_catalog.pg_class relation
    on relation.oid = index_row.indrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  join pg_catalog.pg_am access_method
    on access_method.oid = index_relation.relam
  where namespace.nspname = 'public'
    and relation.relname = 'opportunities'
    and index_relation.relname =
      'opportunities_agent_sales_truth_cohort_v1_idx';
  if not coalesce(v_shape_valid, false) then
    raise exception 'sales truth cohort index catalog shape drifted';
  end if;

  select count(*) = 1
     and bool_and(
       access_method.amname = 'btree'
       and not index_row.indisunique
       and not index_row.indisprimary
       and index_row.indisvalid
       and index_row.indisready
       and index_row.indislive
       and index_row.indnkeyatts = 4
       and index_row.indnatts = 4
       and index_row.indexprs is null
       and index_relation.reloptions is null
       and pg_catalog.pg_get_indexdef(index_row.indexrelid, 1, true) =
         'company_id'
       and pg_catalog.pg_get_indexdef(index_row.indexrelid, 2, true) =
         'opportunity_id'
       and pg_catalog.pg_get_indexdef(index_row.indexrelid, 3, true) =
         'created_at'
       and pg_catalog.pg_get_indexdef(index_row.indexrelid, 4, true) = 'id'
       and pg_catalog.pg_get_expr(
         index_row.indpred, index_row.indrelid, true
       ) = 'opportunity_id IS NOT NULL AND (type = ANY (ARRAY[''email''::text, ''text_message''::text])) AND (direction = ANY (ARRAY[''inbound''::text, ''outbound''::text]))'
     )
    into v_shape_valid
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_relation
    on index_relation.oid = index_row.indexrelid
  join pg_catalog.pg_class relation
    on relation.oid = index_row.indrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  join pg_catalog.pg_am access_method
    on access_method.oid = index_relation.relam
  where namespace.nspname = 'public'
    and relation.relname = 'activities'
    and index_relation.relname =
      'activities_agent_sales_truth_history_v1_idx';
  if not coalesce(v_shape_valid, false) then
    raise exception 'sales truth activity index catalog shape drifted';
  end if;

  for v_line in execute $plan$
    explain
    select opportunity.id
    from public.opportunities opportunity
    where opportunity.company_id =
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and opportunity.deleted_at is null
      and opportunity.merged_into_opportunity_id is null
      and opportunity.created_at >= '2026-03-06 08:00:00+00'
      and opportunity.created_at < '2026-09-02 07:00:00+00'
    order by opportunity.created_at, opportunity.id
  $plan$ loop
    v_plan := v_plan || ' ' || v_line."QUERY PLAN";
  end loop;
  if v_plan not like '%opportunities_agent_sales_truth_cohort_v1_idx%'
     or v_plan !~ 'Index Cond:.*created_at >=.*created_at <' then
    raise exception 'sales truth cohort query missed its bounded index: %',
      v_plan;
  end if;

  v_plan := '';
  for v_line in execute $plan$
    explain
    select activity.id
    from public.activities activity
    where activity.company_id =
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and activity.opportunity_id =
        '10000000-0000-4000-8000-000000000002'
      and activity.opportunity_id is not null
      and activity.type in ('email', 'text_message')
      and activity.direction in ('inbound', 'outbound')
      and activity.created_at <= '2026-09-01 12:00:00+00'
    order by activity.created_at, activity.id
  $plan$ loop
    v_plan := v_plan || ' ' || v_line."QUERY PLAN";
  end loop;
  if v_plan not like '%activities_agent_sales_truth_history_v1_idx%'
     or v_plan !~ 'Index Cond:.*opportunity_id.*created_at <=' then
    raise exception 'sales truth activity query missed its bounded index: %',
      v_plan;
  end if;
end;
$assert_indexes$;

insert into public.opportunities (
  id, company_id, created_at, deleted_at, merged_into_opportunity_id,
  stage, source, lost_reason
)
select (
         '50000000-0000-4000-8000-' || lpad(series::text, 12, '0')
       )::uuid,
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       '2026-08-10 12:00:00+00'::timestamptz +
         (series || ' seconds')::interval,
       null,
       null,
       'new_lead',
       'other',
       null
from pg_catalog.generate_series(1, 5001) series;

do $assert_bound$
declare
  v_snapshot jsonb := pg_temp.sales_truth_snapshot();
begin
  if (v_snapshot #>> '{source_counts,opportunities}')::integer <> 5001
     or (v_snapshot #>> '{source_bounds,opportunities}')::boolean is not true
     or pg_catalog.jsonb_array_length(v_snapshot -> 'opportunities') <> 5000 then
    raise exception 'sales truth opportunity bound drifted: %',
      v_snapshot -> 'source_counts';
  end if;
end;
$assert_bound$;

rollback;
