begin;

-- Task-domain source revision fencing and the exact broad-list keyset proven
-- by the checked-in PostgreSQL 17 EXPLAIN fixture.
do $prerequisites$
declare
  v_missing text[];
begin
  select pg_catalog.array_agg(required.object_name order by required.object_name)
  into v_missing
  from (
    values
      ('table', 'private.agent_read_domain_revisions'),
      ('table', 'private.agent_read_domains'),
      ('function', 'private.bump_agent_read_domain_revision()'),
      ('function', 'private.advance_agent_read_domain_revisions(uuid[],text)'),
      ('table', 'public.project_tasks'),
      ('table', 'public.task_mutation_events'),
      ('table', 'public.projects'),
      ('table', 'public.project_notes'),
      ('table', 'public.task_types'),
      ('table', 'public.users'),
      ('table', 'public.task_materials'),
      ('table', 'public.catalog_variants'),
      ('table', 'public.company_inventory_settings'),
      ('table', 'public.estimates'),
      ('table', 'public.line_items')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_task_sources_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from private.agent_read_domains domain
    where domain.domain = 'tasks'
  ) then
    raise exception 'agent_task_domain_missing' using errcode = '55000';
  end if;
end;
$prerequisites$;

create index if not exists idx_project_tasks_agent_list_order_v1
  on public.project_tasks (
    company_id,
    (
      coalesce(
        case
          when start_date is not null
           and pg_catalog.isfinite(start_date)
           and extract(
             year from start_date at time zone 'UTC'
           ) between 1 and 9999
            then (start_date at time zone 'UTC')::date
        end,
        date '9999-12-31'
      )
    ),
    id
  )
  where deleted_at is null
    and status in ('active', 'cancelled', 'completed');

create index if not exists idx_project_tasks_agent_attention_gate_v1
  on public.project_tasks (
    company_id,
    id
  )
  where deleted_at is null
    and status = 'active';

create index if not exists idx_project_tasks_agent_dependency_gate_v1
  on public.project_tasks (
    company_id,
    project_id,
    task_type_id,
    id
  )
  where deleted_at is null
    and status <> 'cancelled';

create index if not exists idx_task_materials_agent_task_gate_v1
  on public.task_materials (
    task_id,
    id
  );

create or replace function private.bump_agent_task_material_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old_task_id uuid;
  v_new_task_id uuid;
  v_company_ids uuid[];
begin
  if tg_when is distinct from 'AFTER'
     or tg_level is distinct from 'ROW'
     or tg_op not in ('INSERT', 'UPDATE', 'DELETE')
     or tg_nargs is distinct from 0 then
    raise exception 'agent_task_material_revision_trigger_misconfigured'
      using errcode = '55000';
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old_task_id := old.task_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_task_id := new.task_id;
  end if;

  select pg_catalog.array_agg(source.company_id order by source.company_id)
    into v_company_ids
  from (
    select distinct task.company_id
    from public.project_tasks task
    where task.id = any(array[v_old_task_id, v_new_task_id])
      and task.company_id is not null
  ) source;

  perform private.advance_agent_read_domain_revisions(
    v_company_ids,
    'tasks'
  );
  return null;
end;
$function$;

revoke all on function private.bump_agent_task_material_revision()
  from public, anon, authenticated, service_role;

alter function private.bump_agent_task_material_revision()
  owner to current_user;

do $canonical_acl$
declare
  v_function_oid oid;
  v_acl record;
begin
  v_function_oid := pg_catalog.to_regprocedure(
    'private.bump_agent_task_material_revision()'
  )::oid;
  if v_function_oid is null then
    raise exception 'agent_task_material_acl_function_missing';
  end if;

  for v_acl in
    select distinct acl.grantee,
           case when acl.grantee = 0 then 'public'
             else role_row.rolname end as role_name
    from pg_catalog.pg_proc function_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function_row.proacl,
        pg_catalog.acldefault('f', function_row.proowner)
      )
    ) acl
    left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
    where function_row.oid = v_function_oid
      and acl.grantee <> function_row.proowner
  loop
    if v_acl.role_name is null then
      raise exception 'agent_task_material_acl_role_missing';
    end if;
    execute pg_catalog.format(
      'revoke all privileges on function %s from %s',
      'private.bump_agent_task_material_revision()',
      case when v_acl.grantee = 0 then 'public'
        else pg_catalog.quote_ident(v_acl.role_name) end
    );
  end loop;
end;
$canonical_acl$;

drop trigger if exists project_tasks_bump_agent_task_revision
  on public.project_tasks;
create trigger project_tasks_bump_agent_task_revision
after insert or update or delete on public.project_tasks
for each row execute function private.bump_agent_read_domain_revision('tasks', 'company_id');

drop trigger if exists task_mutation_events_bump_agent_task_revision
  on public.task_mutation_events;
create trigger task_mutation_events_bump_agent_task_revision
after insert or update or delete on public.task_mutation_events
for each row execute function private.bump_agent_read_domain_revision('tasks', 'company_id');

drop trigger if exists projects_bump_agent_task_revision
  on public.projects;
create trigger projects_bump_agent_task_revision
after insert or update or delete on public.projects
for each row execute function private.bump_agent_read_domain_revision('tasks', 'company_id');

drop trigger if exists project_notes_bump_agent_task_revision
  on public.project_notes;
create trigger project_notes_bump_agent_task_revision
after insert or update or delete on public.project_notes
for each row execute function private.bump_agent_read_domain_revision('tasks', 'company_id');

drop trigger if exists task_types_bump_agent_task_revision
  on public.task_types;
create trigger task_types_bump_agent_task_revision
after insert or update or delete on public.task_types
for each row execute function private.bump_agent_read_domain_revision('tasks', 'company_id');

drop trigger if exists users_bump_agent_task_revision
  on public.users;
create trigger users_bump_agent_task_revision
after insert or update or delete on public.users
for each row execute function private.bump_agent_read_domain_revision('tasks', 'company_id');

drop trigger if exists task_materials_bump_agent_task_revision
  on public.task_materials;
create trigger task_materials_bump_agent_task_revision
after insert or update or delete on public.task_materials
for each row execute function private.bump_agent_task_material_revision();

drop trigger if exists catalog_variants_bump_agent_task_revision
  on public.catalog_variants;
create trigger catalog_variants_bump_agent_task_revision
after insert or update or delete on public.catalog_variants
for each row execute function private.bump_agent_read_domain_revision('tasks', 'company_id');

drop trigger if exists company_inventory_settings_bump_agent_task_revision
  on public.company_inventory_settings;
create trigger company_inventory_settings_bump_agent_task_revision
after insert or update or delete on public.company_inventory_settings
for each row execute function private.bump_agent_read_domain_revision('tasks', 'company_id');

drop trigger if exists estimates_bump_agent_task_revision
  on public.estimates;
create trigger estimates_bump_agent_task_revision
after insert or update or delete on public.estimates
for each row execute function private.bump_agent_read_domain_revision('tasks', 'company_id');

drop trigger if exists line_items_bump_agent_task_revision
  on public.line_items;
create trigger line_items_bump_agent_task_revision
after insert or update or delete on public.line_items
for each row execute function private.bump_agent_read_domain_revision('tasks', 'company_id');

do $source_index_postflight$
declare
  v_expected record;
  v_actual_keys text[];
  v_actual_predicate text;
  v_valid boolean;
begin
  for v_expected in
    select expected.index_name,
           expected.table_name,
           expected.keys,
           expected.predicate
    from (values
      (
        'idx_project_tasks_agent_attention_gate_v1'::text,
        'project_tasks'::text,
        array['company_id', 'id']::text[],
        '((deleted_at is null) and (status = ''active''::text))'::text
      ),
      (
        'idx_project_tasks_agent_dependency_gate_v1'::text,
        'project_tasks'::text,
        array['company_id', 'project_id', 'task_type_id', 'id']::text[],
        '((deleted_at is null) and (status <> ''cancelled''::text))'::text
      ),
      (
        'idx_task_materials_agent_task_gate_v1'::text,
        'task_materials'::text,
        array['task_id', 'id']::text[],
        null::text
      )
    ) expected(index_name, table_name, keys, predicate)
  loop
    select (
             select pg_catalog.array_agg(
               pg_catalog.pg_get_indexdef(
                 index_row.indexrelid,
                 key_position.value,
                 true
               ) order by key_position.value
             )
             from pg_catalog.generate_series(
               1,
               index_row.indnkeyatts
             ) key_position(value)
           ),
           pg_catalog.lower(pg_catalog.regexp_replace(
             pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid),
             '[[:space:]]+',
             ' ',
             'g'
           )),
           index_row.indisvalid
             and index_row.indisready
             and index_row.indislive
             and not index_row.indisunique
             and not index_row.indisprimary
             and index_row.indnkeyatts = pg_catalog.cardinality(v_expected.keys)
             and index_row.indnatts = pg_catalog.cardinality(v_expected.keys)
             and relation.relpersistence = 'p'
             and index_relation.relpersistence = 'p'
             and relation.relowner = current_user::regrole
             and index_relation.relowner = current_user::regrole
      into v_actual_keys, v_actual_predicate, v_valid
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class relation
      on relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    where namespace.nspname = 'public'
      and relation.relname = v_expected.table_name
      and index_relation.relname = v_expected.index_name;

    if not coalesce(v_valid, false)
       or v_actual_keys is distinct from v_expected.keys
       or v_actual_predicate is distinct from v_expected.predicate then
      raise exception 'agent_task_source_index_shape_failed: %',
        v_expected.index_name
        using errcode = '55000';
    end if;
  end loop;
end;
$source_index_postflight$;

do $postflight$
declare
  v_table text;
  v_trigger text;
  v_valid boolean;
  v_actual_signatures text[];
  v_function_acl aclitem[];
  v_function_owner oid;
  v_acl_entries text[];
  v_index_key_1 text;
  v_index_key_2 text;
  v_index_key_3 text;
  v_index_predicate text;
  v_index_valid boolean;
begin
  select coalesce(
           pg_catalog.array_agg(
             namespace.nspname || '.' || function_row.proname || '(' ||
             pg_catalog.replace(
               pg_catalog.oidvectortypes(function_row.proargtypes),
               ', ',
               ','
             ) || ')'
             order by function_row.oid
           ),
           array[]::text[]
         )
    into v_actual_signatures
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace namespace
    on namespace.oid = function_row.pronamespace
  where namespace.nspname = 'private'
    and function_row.proname = 'bump_agent_task_material_revision';

  if v_actual_signatures is distinct from array[
    'private.bump_agent_task_material_revision()'
  ]::text[] then
    raise exception 'agent_task_material_function_signature_set_failed';
  end if;

  select function_row.proacl,
         function_row.proowner,
         function_row.proowner = current_user::regrole
         and language_row.lanname = 'plpgsql'
         and function_row.prokind = 'f'::"char"
         and not function_row.proisstrict
         and function_row.proparallel = 'u'::"char"
         and function_row.prosecdef
         and function_row.provolatile = 'v'::"char"
         and pg_catalog.pg_get_function_result(function_row.oid) = 'trigger'
         and pg_catalog.cardinality(function_row.proconfig) = 1
         and pg_catalog.replace(
           pg_catalog.regexp_replace(
             function_row.proconfig[1],
             '[[:space:]]+',
             '',
             'g'
           ),
           '""',
           ''
         ) = 'search_path='
    into v_function_acl, v_function_owner, v_valid
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_language language_row
    on language_row.oid = function_row.prolang
  where function_row.oid = pg_catalog.to_regprocedure(
    'private.bump_agent_task_material_revision()'
  );

  if not coalesce(v_valid, false) then
    raise exception 'agent_task_material_function_shape_failed';
  end if;

  select coalesce(
           pg_catalog.array_agg(entry.value order by entry.value),
           array[]::text[]
         )
    into v_acl_entries
  from (
    select distinct
      case when acl.grantee = 0 then 'PUBLIC'
        else coalesce(role_row.rolname, 'OID:' || acl.grantee::text) end ||
      ':' || acl.privilege_type || ':' || acl.is_grantable::text as value
    from pg_catalog.aclexplode(
      coalesce(
        v_function_acl,
        pg_catalog.acldefault('f', v_function_owner)
      )
    ) acl
    left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
    where acl.grantee <> v_function_owner
  ) entry;

  if v_acl_entries is distinct from array[]::text[] then
    raise exception 'agent_task_material_function_acl_failed';
  end if;

  select pg_catalog.pg_get_indexdef(index_row.indexrelid, 1, true),
         pg_catalog.lower(pg_catalog.regexp_replace(
           pg_catalog.pg_get_indexdef(index_row.indexrelid, 2, true),
           '[[:space:]]+',
           ' ',
           'g'
         )),
         pg_catalog.pg_get_indexdef(index_row.indexrelid, 3, true),
         pg_catalog.lower(pg_catalog.regexp_replace(
           pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid),
           '[[:space:]]+',
           ' ',
           'g'
         )),
         index_row.indisvalid
           and index_row.indisready
           and index_row.indislive
           and not index_row.indisunique
           and not index_row.indisprimary
           and index_row.indnkeyatts = 3
           and index_row.indnatts = 3
           and relation.relpersistence = 'p'
           and index_relation.relpersistence = 'p'
           and relation.relowner = current_user::regrole
           and index_relation.relowner = current_user::regrole
    into v_index_key_1,
         v_index_key_2,
         v_index_key_3,
         v_index_predicate,
         v_index_valid
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class relation
    on relation.oid = index_row.indrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  join pg_catalog.pg_class index_relation
    on index_relation.oid = index_row.indexrelid
  where namespace.nspname = 'public'
    and relation.relname = 'project_tasks'
    and index_relation.relname = 'idx_project_tasks_agent_list_order_v1';

  if not coalesce(v_index_valid, false)
     or v_index_key_1 is distinct from 'company_id'
     or v_index_key_2 is distinct from
       'coalesce( case when start_date is not null and isfinite(start_date) and extract(year from (start_date at time zone ''utc''::text)) >= 1::numeric and extract(year from (start_date at time zone ''utc''::text)) <= 9999::numeric then (start_date at time zone ''utc''::text)::date else null::date end, ''9999-12-31''::date)'
     or v_index_key_3 is distinct from 'id'
     or v_index_predicate is distinct from
       '((deleted_at is null) and (status = any (array[''active''::text, ''cancelled''::text, ''completed''::text])))' then
    raise exception 'agent_task_list_order_index_shape_failed'
      using errcode = '55000';
  end if;

  foreach v_table in array array[
    'project_tasks',
    'task_mutation_events',
    'projects',
    'project_notes',
    'task_types',
    'users',
    'catalog_variants',
    'company_inventory_settings',
    'estimates',
    'line_items'
  ] loop
    v_trigger := v_table || '_bump_agent_task_revision';
    select pg_catalog.count(*) = 1
       and pg_catalog.bool_and(
         trigger_row.tgenabled = 'O'
         and not trigger_row.tgisinternal
         and trigger_row.tgtype = 29
         and procedure.proname = 'bump_agent_read_domain_revision'
         and namespace.nspname = 'public'
         and procedure_namespace.nspname = 'private'
         and pg_catalog.encode(trigger_row.tgargs, 'escape') =
           E'tasks\\000company_id\\000'
       )
      into v_valid
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation
      on relation.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc procedure
      on procedure.oid = trigger_row.tgfoid
    join pg_catalog.pg_namespace procedure_namespace
      on procedure_namespace.oid = procedure.pronamespace
    where relation.relname = v_table
      and trigger_row.tgname = v_trigger;

    if not coalesce(v_valid, false) then
      raise exception 'agent_task_source_trigger_invalid: %', v_trigger
        using errcode = '55000';
    end if;
  end loop;

  select pg_catalog.count(*) = 1
     and pg_catalog.bool_and(
       trigger_row.tgenabled = 'O'
       and not trigger_row.tgisinternal
       and trigger_row.tgtype = 29
       and procedure.proname = 'bump_agent_task_material_revision'
       and procedure.pronamespace = 'private'::pg_catalog.regnamespace
     )
    into v_valid
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  join pg_catalog.pg_proc procedure on procedure.oid = trigger_row.tgfoid
  where namespace.nspname = 'public'
    and relation.relname = 'task_materials'
    and trigger_row.tgname = 'task_materials_bump_agent_task_revision';

  if not coalesce(v_valid, false) then
    raise exception 'agent_task_material_trigger_invalid' using errcode = '55000';
  end if;
end;
$postflight$;

commit;
