begin;

set local timezone = 'UTC';

-- Task 12 canonical site-visit source body. This fence advances the closed
-- site_visits domain for visit data and every row-level authority dependency.
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
      ('table', 'public.site_visits'),
      ('table', 'public.site_visit_checklist_answers'),
      ('table', 'public.site_visit_artifacts'),
      ('table', 'public.opportunities'),
      ('table', 'public.clients'),
      ('table', 'public.projects'),
      ('table', 'public.project_tasks')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_site_visit_sources_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from private.agent_read_domains domain
    where domain.domain = 'site_visits'
  ) then
    raise exception 'agent_site_visit_domain_missing' using errcode = '55000';
  end if;
end;
$prerequisites$;

-- The two list modes have deliberately different clocks and directions.
-- scheduled_at is not a booked discriminator and is absent from both keys.
create index if not exists idx_site_visits_agent_booked_order_v1
  on public.site_visits (
    company_id,
    pg_catalog.date_bin(
      interval '1 millisecond',
      booked_at,
      timestamptz '2000-01-01 00:00:00+00'
    ),
    id
  )
  where deleted_at is null and booked_at is not null;

create index if not exists idx_site_visits_agent_history_order_v1
  on public.site_visits (
    company_id,
    pg_catalog.date_bin(
      interval '1 millisecond',
      created_at,
      timestamptz '2000-01-01 00:00:00+00'
    ) desc,
    id desc
  )
  where deleted_at is null and created_at is not null;

create index if not exists idx_site_visit_checklist_answers_agent_context_v1
  on public.site_visit_checklist_answers (
    company_id,
    site_visit_id,
    sort_order,
    id
  )
  where deleted_at is null;

create index if not exists idx_site_visit_artifacts_agent_context_v1
  on public.site_visit_artifacts (
    pg_catalog.lower(company_id),
    site_visit_id,
    captured_at,
    id
  )
  where deleted_at is null;

drop trigger if exists site_visits_bump_agent_site_visit_revision
  on public.site_visits;
create trigger site_visits_bump_agent_site_visit_revision
after insert or update or delete on public.site_visits
for each row execute function private.bump_agent_read_domain_revision(
  'site_visits', 'company_id'
);

drop trigger if exists site_visit_checklist_answers_bump_agent_site_visit_revision
  on public.site_visit_checklist_answers;
create trigger site_visit_checklist_answers_bump_agent_site_visit_revision
after insert or update or delete on public.site_visit_checklist_answers
for each row execute function private.bump_agent_read_domain_revision(
  'site_visits', 'company_id'
);

drop trigger if exists site_visit_artifacts_bump_agent_site_visit_revision
  on public.site_visit_artifacts;
create trigger site_visit_artifacts_bump_agent_site_visit_revision
after insert or update or delete on public.site_visit_artifacts
for each row execute function private.bump_agent_read_domain_revision(
  'site_visits', 'company_id'
);

drop trigger if exists opportunities_bump_agent_site_visit_revision
  on public.opportunities;
create trigger opportunities_bump_agent_site_visit_revision
after insert or update or delete on public.opportunities
for each row execute function private.bump_agent_read_domain_revision(
  'site_visits', 'company_id'
);

drop trigger if exists clients_bump_agent_site_visit_revision
  on public.clients;
create trigger clients_bump_agent_site_visit_revision
after insert or update or delete on public.clients
for each row execute function private.bump_agent_read_domain_revision(
  'site_visits', 'company_id'
);

drop trigger if exists projects_bump_agent_site_visit_revision
  on public.projects;
create trigger projects_bump_agent_site_visit_revision
after insert or update or delete on public.projects
for each row execute function private.bump_agent_read_domain_revision(
  'site_visits', 'company_id'
);

drop trigger if exists project_tasks_bump_agent_site_visit_revision
  on public.project_tasks;
create trigger project_tasks_bump_agent_site_visit_revision
after insert or update or delete on public.project_tasks
for each row execute function private.bump_agent_read_domain_revision(
  'site_visits', 'company_id'
);

do $postflight$
declare
  v_expected record;
  v_index_oid oid;
  v_actual_keys text[];
  v_actual_predicate text;
  v_valid boolean;
  v_table_name text;
begin
  for v_expected in
    select *
    from (
      values
        (
          'idx_site_visits_agent_booked_order_v1',
          'site_visits',
          array[
            'company_id',
            'date_bin(''00:00:00.001''::interval, booked_at, ''2000-01-01 00:00:00+00''::timestamp with time zone)',
            'id'
          ]::text[],
          '0 0 0',
          '((deleted_at is null) and (booked_at is not null))'
        ),
        (
          'idx_site_visits_agent_history_order_v1',
          'site_visits',
          array[
            'company_id',
            'date_bin(''00:00:00.001''::interval, created_at, ''2000-01-01 00:00:00+00''::timestamp with time zone)',
            'id'
          ]::text[],
          '0 3 3',
          '((deleted_at is null) and (created_at is not null))'
        ),
        (
          'idx_site_visit_checklist_answers_agent_context_v1',
          'site_visit_checklist_answers',
          array['company_id', 'site_visit_id', 'sort_order', 'id']::text[],
          '0 0 0 0',
          '(deleted_at is null)'
        ),
        (
          'idx_site_visit_artifacts_agent_context_v1',
          'site_visit_artifacts',
          array[
            'lower(company_id)', 'site_visit_id', 'captured_at', 'id'
          ]::text[],
          '0 0 0 0',
          '(deleted_at is null)'
        )
    ) expected(
      index_name,
      table_name,
      index_keys,
      index_options,
      index_predicate
    )
  loop
    select index_row.indexrelid,
           index_row.indisvalid
             and index_row.indisready
             and index_row.indislive
             and not index_row.indisunique
             and not index_row.indisprimary
             and index_row.indnkeyatts = pg_catalog.cardinality(
               v_expected.index_keys
             )
             and index_row.indnatts = pg_catalog.cardinality(
               v_expected.index_keys
             )
             and index_row.indoption::text = v_expected.index_options
             and relation.relpersistence = 'p'
             and index_relation.relpersistence = 'p'
      into v_index_oid, v_valid
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class relation on relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    where namespace.nspname = 'public'
      and relation.relname = v_expected.table_name
      and index_relation.relname = v_expected.index_name;

    if v_index_oid is null or not coalesce(v_valid, false) then
      raise exception 'agent_site_visit_index_shape_failed: %',
        v_expected.index_name using errcode = '55000';
    end if;

    select pg_catalog.array_agg(
             pg_catalog.lower(pg_catalog.regexp_replace(
               pg_catalog.pg_get_indexdef(v_index_oid, key_position, true),
               '[[:space:]]+',
               ' ',
               'g'
             ))
             order by key_position
           )
      into v_actual_keys
    from pg_catalog.generate_series(
      1,
      pg_catalog.cardinality(v_expected.index_keys)
    ) key_position;

    select pg_catalog.lower(pg_catalog.regexp_replace(
             pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid),
             '[[:space:]]+',
             ' ',
             'g'
           ))
      into v_actual_predicate
    from pg_catalog.pg_index index_row
    where index_row.indexrelid = v_index_oid;

    if v_actual_keys is distinct from v_expected.index_keys
       or v_actual_predicate is distinct from v_expected.index_predicate then
      raise exception 'agent_site_visit_index_shape_failed: %',
        v_expected.index_name using errcode = '55000';
    end if;
  end loop;

  foreach v_table_name in array array[
    'site_visits',
    'site_visit_checklist_answers',
    'site_visit_artifacts',
    'opportunities',
    'clients',
    'projects',
    'project_tasks'
  ] loop
    select pg_catalog.count(*) = 1
       and pg_catalog.bool_and(
         trigger_row.tgenabled = 'O'
         and not trigger_row.tgisinternal
         and procedure.proname = 'bump_agent_read_domain_revision'
         and procedure_namespace.nspname = 'private'
         and pg_catalog.encode(trigger_row.tgargs, 'escape') =
           E'site_visits\\000company_id\\000'
       )
      into v_valid
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc procedure on procedure.oid = trigger_row.tgfoid
    join pg_catalog.pg_namespace procedure_namespace
      on procedure_namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and relation.relname = v_table_name
      and trigger_row.tgname =
        v_table_name || '_bump_agent_site_visit_revision';

    if not coalesce(v_valid, false) then
      raise exception 'agent_site_visit_source_trigger_invalid: %',
        v_table_name using errcode = '55000';
    end if;
  end loop;
end;
$postflight$;

commit;
