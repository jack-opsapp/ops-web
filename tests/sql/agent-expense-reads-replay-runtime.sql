\set ON_ERROR_STOP on

create temporary table agent_expense_replay_before(
  signature text primary key,
  definition text not null
);
insert into agent_expense_replay_before(signature, definition)
select signature.value,
       pg_catalog.pg_get_functiondef(
         pg_catalog.to_regprocedure(signature.value)::oid
       )
from pg_catalog.unnest(array[
  'private.bump_agent_expense_source_revision()',
  'private.agent_p2_expense_hash_ref(text,jsonb)',
  'private.agent_p2_expense_money_v1(numeric,text)',
  'private.agent_p2_expense_expected_candidate_v1(text,jsonb)',
  'private.agent_p2_expense_proof_candidate_v1(jsonb)',
  'private.agent_p2_expense_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text)',
  'private.agent_p2_expense_project_assigned_v1(uuid,uuid,uuid)',
  'private.agent_p2_expense_assigned_approver_v1(uuid,uuid,uuid)',
  'private.agent_p2_expense_batch_assigned_approver_v1(uuid,uuid,uuid)',
  'private.agent_p2_expense_item_v1(uuid,uuid,uuid,integer)',
  'private.agent_p2_expense_batch_item_v1(uuid,uuid,boolean)',
  'private.agent_p2_expense_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,text,integer,integer,integer,timestamp with time zone,jsonb,date,uuid)',
  'private.agent_p2_expense_context_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,integer,integer,integer,integer)',
  'private.agent_p2_expense_attention_v1(uuid,uuid,text,text[],jsonb,timestamp with time zone,integer,integer)',
  'public.read_agent_expenses_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,text,integer,integer,integer,timestamp with time zone,jsonb,date,uuid)',
  'public.read_agent_expense_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,integer,integer,integer,integer)'
]::text[]) signature(value);

do $hostile_acl$
declare
  v_signature text;
begin
  for v_signature in
    select signature from agent_expense_replay_before order by signature
  loop
    execute pg_catalog.format(
      'grant execute on function %s to pg_monitor with grant option',
      v_signature
    );
  end loop;
end;
$hostile_acl$;

\ir ../../supabase/migrations/20260829040045_agent_expense_reimbursement_sources.sql
\ir ../../supabase/migrations/20260829040046_agent_expense_reads.sql

begin;
do $replay_contract$
declare
  v_signature text;
  v_acl_entries text[];
  v_expected text[];
begin
  if exists (
    select 1
    from agent_expense_replay_before before_state
    where before_state.definition is distinct from pg_catalog.pg_get_functiondef(
      pg_catalog.to_regprocedure(before_state.signature)::oid
    )
  ) then
    raise exception 'expense_runtime_replay_definition_changed';
  end if;

  for v_signature in
    select signature from agent_expense_replay_before order by signature
  loop
    select coalesce(
             pg_catalog.array_agg(entry.value order by entry.value),
             array[]::text[]
           )
      into v_acl_entries
    from (
      select distinct
        case when acl.grantee = 0 then 'PUBLIC'
          else coalesce(
            role_row.rolname, 'OID:' || acl.grantee::text
          ) end || ':' || acl.privilege_type || ':' ||
          acl.is_grantable::text as value
      from pg_catalog.pg_proc function_row
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          function_row.proacl,
          pg_catalog.acldefault('f', function_row.proowner)
        )
      ) acl
      left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
      where function_row.oid = pg_catalog.to_regprocedure(v_signature)::oid
        and acl.grantee <> function_row.proowner
    ) entry;
    v_expected := case when v_signature like 'public.%'
      then array['service_role:EXECUTE:false']::text[]
      else array[]::text[]
    end;
    if v_acl_entries is distinct from v_expected then
      raise exception 'expense_runtime_replay_acl_invalid:%:%',
        v_signature, v_acl_entries;
    end if;
  end loop;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger trigger_row
    where not trigger_row.tgisinternal
      and trigger_row.tgname in (
        'expenses_bump_agent_expense_revision',
        'expense_project_allocations_bump_agent_expense_revision',
        'expense_categories_bump_agent_expense_revision',
        'expense_batches_bump_agent_expense_revision',
        'users_bump_agent_expense_revision',
        'projects_bump_agent_expense_revision',
        'project_tasks_bump_agent_expense_revision'
      )
  ) <> 7 then
    raise exception 'expense_runtime_replay_trigger_count_invalid';
  end if;
  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_class index_row
    join pg_catalog.pg_index index_state
      on index_state.indexrelid = index_row.oid
    where index_row.relnamespace = 'public'::regnamespace
      and index_row.relname in (
        'idx_expenses_agent_company_status_date_v1',
        'idx_expenses_agent_own_date_v1',
        'idx_expense_batches_agent_period_v1',
        'idx_expense_allocations_agent_project_v1'
      )
      and index_state.indisvalid
      and index_state.indisready
  ) <> 4 then
    raise exception 'expense_runtime_replay_index_count_invalid';
  end if;
  raise notice 'expense_runtime_replay_ok';
end;
$replay_contract$;
rollback;
