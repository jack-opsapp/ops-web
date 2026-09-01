begin;

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
      ('function', 'private.agent_p2_optional_canonical_text(text,integer,integer,boolean)'),
      ('table', 'public.companies'),
      ('table', 'public.users'),
      ('table', 'public.calendar_user_events'),
      ('table', 'public.project_tasks'),
      ('table', 'public.site_visits')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_availability_sources_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from private.agent_read_domains domain
    where domain.domain = 'availability'
  ) then
    raise exception 'agent_availability_domain_missing' using errcode = '55000';
  end if;
end;
$prerequisites$;

do $source_shape$
declare
  v_invalid text[];
begin
  with expected(table_name, column_name, data_type) as (
    values
      ('companies', 'id', 'uuid'),
      ('companies', 'deleted_at', 'timestamp with time zone'),
      ('companies', 'timezone', 'text'),
      ('companies', 'default_work_start', 'time without time zone'),
      ('companies', 'default_work_end', 'time without time zone'),
      ('companies', 'skip_weekends_in_auto_schedule', 'boolean'),
      ('users', 'id', 'uuid'),
      ('users', 'company_id', 'uuid'),
      ('users', 'first_name', 'text'),
      ('users', 'last_name', 'text'),
      ('users', 'is_active', 'boolean'),
      ('users', 'deleted_at', 'timestamp with time zone'),
      ('calendar_user_events', 'id', 'uuid'),
      ('calendar_user_events', 'company_id', 'text'),
      ('calendar_user_events', 'user_id', 'text'),
      ('calendar_user_events', 'type', 'text'),
      ('calendar_user_events', 'start_date', 'timestamp with time zone'),
      ('calendar_user_events', 'end_date', 'timestamp with time zone'),
      ('calendar_user_events', 'all_day', 'boolean'),
      ('calendar_user_events', 'status', 'text'),
      ('calendar_user_events', 'team_member_ids', 'ARRAY'),
      ('calendar_user_events', 'deleted_at', 'timestamp with time zone'),
      ('project_tasks', 'id', 'uuid'),
      ('project_tasks', 'company_id', 'uuid'),
      ('project_tasks', 'status', 'text'),
      ('project_tasks', 'team_member_ids', 'ARRAY'),
      ('project_tasks', 'deleted_at', 'timestamp with time zone'),
      ('project_tasks', 'start_date', 'timestamp with time zone'),
      ('project_tasks', 'end_date', 'timestamp with time zone'),
      ('project_tasks', 'duration', 'integer'),
      ('project_tasks', 'start_time', 'time without time zone'),
      ('project_tasks', 'end_time', 'time without time zone'),
      ('project_tasks', 'all_day', 'boolean'),
      ('site_visits', 'id', 'uuid'),
      ('site_visits', 'company_id', 'text'),
      ('site_visits', 'scheduled_at', 'timestamp with time zone'),
      ('site_visits', 'duration_minutes', 'integer'),
      ('site_visits', 'assignee_ids', 'ARRAY'),
      ('site_visits', 'status', 'USER-DEFINED'),
      ('site_visits', 'deleted_at', 'timestamp with time zone'),
      ('site_visits', 'booked_at', 'timestamp with time zone')
  )
  select pg_catalog.array_agg(
           expected.table_name || '.' || expected.column_name
           order by expected.table_name, expected.column_name
         )
    into v_invalid
  from expected
  left join information_schema.columns column_row
    on column_row.table_schema = 'public'
   and column_row.table_name = expected.table_name
   and column_row.column_name = expected.column_name
  where column_row.column_name is null
     or column_row.data_type is distinct from expected.data_type;

  if v_invalid is not null then
    raise exception 'agent_availability_source_shape_invalid: %',
      pg_catalog.array_to_string(v_invalid, ',')
      using errcode = '55000';
  end if;
end;
$source_shape$;

create index if not exists idx_calendar_user_events_agent_availability_v1
  on public.calendar_user_events (
    company_id,
    start_date,
    id
  ) include (
    end_date,
    user_id,
    type,
    all_day,
    status,
    team_member_ids
  )
  where deleted_at is null
    and (
      type = 'personal' and status = 'none'
      or type = 'time_off' and status in ('approved', 'none')
    );

create index if not exists idx_project_tasks_agent_availability_v1
  on public.project_tasks (
    company_id,
    ((start_date at time zone 'UTC')::date),
    id
  ) include (
    end_date,
    duration,
    start_time,
    end_time,
    all_day,
    status,
    team_member_ids
  )
  where deleted_at is null
    and start_date is not null
    and status <> 'cancelled';

create index if not exists idx_site_visits_agent_availability_v1
  on public.site_visits (
    company_id,
    scheduled_at,
    id
  ) include (
    duration_minutes,
    assignee_ids,
    status
  )
  where deleted_at is null
    and booked_at is not null
    and status in ('scheduled', 'in_progress');

drop trigger if exists companies_bump_agent_availability_revision
  on public.companies;
create trigger companies_bump_agent_availability_revision
after insert or delete or update of
  deleted_at,
  timezone,
  default_work_start,
  default_work_end,
  skip_weekends_in_auto_schedule
on public.companies
for each row execute function private.bump_agent_read_domain_revision(
  'availability', 'id'
);

drop trigger if exists calendar_user_events_bump_agent_availability_revision
  on public.calendar_user_events;
create trigger calendar_user_events_bump_agent_availability_revision
after insert or delete or update of
  company_id,
  user_id,
  type,
  start_date,
  end_date,
  all_day,
  status,
  team_member_ids,
  deleted_at
on public.calendar_user_events
for each row execute function private.bump_agent_read_domain_revision(
  'availability', 'company_id'
);

drop trigger if exists project_tasks_bump_agent_availability_revision
  on public.project_tasks;
create trigger project_tasks_bump_agent_availability_revision
after insert or delete or update of
  company_id,
  status,
  team_member_ids,
  deleted_at,
  start_date,
  end_date,
  duration,
  start_time,
  end_time,
  all_day
on public.project_tasks
for each row execute function private.bump_agent_read_domain_revision(
  'availability', 'company_id'
);

drop trigger if exists site_visits_bump_agent_availability_revision
  on public.site_visits;
create trigger site_visits_bump_agent_availability_revision
after insert or delete or update of
  company_id,
  scheduled_at,
  duration_minutes,
  assignee_ids,
  status,
  deleted_at,
  booked_at
on public.site_visits
for each row execute function private.bump_agent_read_domain_revision(
  'availability', 'company_id'
);

do $postflight$
declare
  v_expected record;
  v_index_oid oid;
  v_valid boolean;
begin
  for v_expected in
    select * from (values
      ('idx_calendar_user_events_agent_availability_v1', 'calendar_user_events'),
      ('idx_project_tasks_agent_availability_v1', 'project_tasks'),
      ('idx_site_visits_agent_availability_v1', 'site_visits')
    ) expected(index_name, table_name)
  loop
    select index_row.indexrelid,
           index_row.indisvalid
             and index_row.indisready
             and index_row.indislive
             and not index_row.indisunique
             and not index_row.indisprimary
             and relation.relpersistence = 'p'
             and index_relation.relpersistence = 'p'
             and relation.relowner = current_user::regrole
             and index_relation.relowner = current_user::regrole
      into v_index_oid, v_valid
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

    if v_index_oid is null or not coalesce(v_valid, false) then
      raise exception 'agent_availability_source_index_shape_failed: %',
        v_expected.index_name using errcode = '55000';
    end if;
  end loop;

  for v_expected in
    select * from (values
      ('companies', 'companies_bump_agent_availability_revision', 'id'),
      ('calendar_user_events', 'calendar_user_events_bump_agent_availability_revision', 'company_id'),
      ('project_tasks', 'project_tasks_bump_agent_availability_revision', 'company_id'),
      ('site_visits', 'site_visits_bump_agent_availability_revision', 'company_id')
    ) expected(table_name, trigger_name, company_column)
  loop
    select pg_catalog.count(*) = 1
       and pg_catalog.bool_and(
         trigger_row.tgenabled = 'O'
         and not trigger_row.tgisinternal
         and trigger_row.tgtype = 29
         and procedure_namespace.nspname = 'private'
         and procedure.proname = 'bump_agent_read_domain_revision'
         and pg_catalog.encode(trigger_row.tgargs, 'escape') =
           'availability' || E'\\000' || v_expected.company_column || E'\\000'
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
    where namespace.nspname = 'public'
      and relation.relname = v_expected.table_name
      and trigger_row.tgname = v_expected.trigger_name;

    if not coalesce(v_valid, false) then
      raise exception 'agent_availability_source_trigger_invalid: %',
        v_expected.trigger_name using errcode = '55000';
    end if;
  end loop;
end;
$postflight$;

commit;
