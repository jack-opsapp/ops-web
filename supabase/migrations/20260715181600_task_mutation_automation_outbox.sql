begin;

-- Schedule automation identity must survive ABA edits and multiple writes in a
-- single transaction. updated_at is diagnostic only; the trigger owns this
-- monotonic counter and callers cannot forge or rewind it.
alter table public.project_tasks
  add column if not exists schedule_version bigint not null default 0;

alter table public.project_tasks
  drop constraint if exists project_tasks_schedule_version_nonnegative;
alter table public.project_tasks
  add constraint project_tasks_schedule_version_nonnegative
  check (schedule_version >= 0);

create or replace function private.project_task_schedule_changed(
  p_old public.project_tasks,
  p_new public.project_tasks
) returns boolean
language sql
immutable
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
  select
    p_old.start_date is distinct from p_new.start_date
    or p_old.end_date is distinct from p_new.end_date
    or p_old.start_time is distinct from p_new.start_time
    or p_old.end_time is distinct from p_new.end_time
    or p_old.all_day is distinct from p_new.all_day
    or p_old.duration is distinct from p_new.duration
    or array(
      select distinct member_id
      from unnest(coalesce(p_old.team_member_ids, array[]::text[])) member_id
      order by member_id
    ) is distinct from array(
      select distinct member_id
      from unnest(coalesce(p_new.team_member_ids, array[]::text[])) member_id
      order by member_id
    );
$function$;

create or replace function private.bump_project_task_schedule_version()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_schedule_changed boolean := false;
begin
  if tg_op = 'INSERT' then
    new.schedule_version := case
      when new.start_date is not null
        or new.end_date is not null
        or new.start_time is not null
        or new.end_time is not null
        or new.all_day is distinct from true
        or coalesce(new.duration, 1) is distinct from 1
        or cardinality(coalesce(new.team_member_ids, array[]::text[])) > 0
      then 1
      else 0
    end;
    return new;
  end if;

  v_schedule_changed := private.project_task_schedule_changed(old, new);

  new.schedule_version := case
    when v_schedule_changed then old.schedule_version + 1
    else old.schedule_version
  end;
  return new;
end;
$function$;

revoke all on function private.bump_project_task_schedule_version()
  from public, anon, authenticated, service_role;
revoke all on function private.project_task_schedule_changed(
  public.project_tasks,
  public.project_tasks
) from public, anon, authenticated, service_role;

drop trigger if exists project_tasks_bump_schedule_version
  on public.project_tasks;
create trigger project_tasks_bump_schedule_version
before insert or update on public.project_tasks
for each row
execute function private.bump_project_task_schedule_version();

-- Legacy clients still write project_tasks directly. Lock the canonical parent
-- before any write that can create, move, undelete, reopen, or otherwise make
-- a task active. This serializes those writes with the project close/archive
-- action, which holds the same project row FOR UPDATE before checking tasks.
create or replace function private.guard_project_task_parent_lifecycle()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_project_company_id uuid;
  v_project_status text;
  v_project_deleted_at timestamptz;
begin
  select project.company_id, project.status, project.deleted_at
    into v_project_company_id, v_project_status, v_project_deleted_at
    from public.projects project
   where project.id = new.project_id
   for share;

  if not found
     or v_project_company_id is distinct from new.company_id
     or v_project_deleted_at is not null then
    raise exception 'invalid_task_parent_project' using errcode = '23503';
  end if;

  if lower(coalesce(v_project_status, '')) in ('closed', 'archived')
     and new.deleted_at is null
     and lower(coalesce(new.status, 'active')) not in (
       'completed',
       'complete',
       'cancelled'
     ) then
    raise exception 'closed_project_task_mutation_denied'
      using errcode = '55000';
  end if;

  return new;
end;
$function$;

revoke all on function private.guard_project_task_parent_lifecycle()
  from public, anon, authenticated, service_role;

drop trigger if exists project_tasks_guard_parent_lifecycle
  on public.project_tasks;
create trigger project_tasks_guard_parent_lifecycle
before insert or update of project_id, company_id, status, deleted_at
on public.project_tasks
for each row
execute function private.guard_project_task_parent_lifecycle();

-- Canonical actor-aware task access. The legacy project membership helper is
-- derived from active task assignment; projects.team_member_ids is a cache and
-- must never confer authority.
create or replace function private.user_is_project_member_for_task(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_project_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
  select exists (
    select 1
    from public.project_tasks assigned_task
    join public.projects project on project.id = assigned_task.project_id
    where assigned_task.project_id = p_project_id
      and assigned_task.company_id = p_company_id
      and assigned_task.deleted_at is null
      and assigned_task.status = 'active'
      and project.company_id = p_company_id
      and project.deleted_at is null
      and p_actor_user_id::text = any(
        coalesce(assigned_task.team_member_ids, array[]::text[])
      )
  );
$function$;

create or replace function private.user_can_edit_task(
  p_actor_user_id uuid,
  p_task_id uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_task public.project_tasks;
begin
  select task.* into v_task
  from public.project_tasks task
  join public.projects project
    on project.id = task.project_id
   and project.company_id = task.company_id
   and project.deleted_at is null
  where task.id = p_task_id
    and task.deleted_at is null;
  if not found or not exists (
    select 1
    from public.users actor
    where actor.id = p_actor_user_id
      and actor.company_id = v_task.company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
  ) then
    return false;
  end if;

  if public.has_permission(p_actor_user_id, 'tasks.edit', 'all') then
    return true;
  end if;
  return public.has_permission(
      p_actor_user_id,
      'tasks.edit',
      'assigned'
    ) and (
      p_actor_user_id::text = any(
        coalesce(v_task.team_member_ids, array[]::text[])
      )
      or private.user_is_project_member_for_task(
        p_actor_user_id,
        v_task.company_id,
        v_task.project_id
      )
    );
end;
$function$;

create or replace function private.user_can_view_task(
  p_actor_user_id uuid,
  p_task_id uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_task public.project_tasks;
begin
  select task.* into v_task
  from public.project_tasks task
  join public.projects project
    on project.id = task.project_id
   and project.company_id = task.company_id
   and project.deleted_at is null
  where task.id = p_task_id
    and task.deleted_at is null;
  if not found or not exists (
    select 1
    from public.users actor
    where actor.id = p_actor_user_id
      and actor.company_id = v_task.company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
  ) then
    return false;
  end if;

  if public.has_permission(p_actor_user_id, 'tasks.view', 'all') then
    return true;
  end if;
  return public.has_permission(
      p_actor_user_id,
      'tasks.view',
      'assigned'
    ) and (
      p_actor_user_id::text = any(
        coalesce(v_task.team_member_ids, array[]::text[])
      )
      or private.user_can_view_project(
        p_actor_user_id,
        v_task.project_id
      )
    );
end;
$function$;

create or replace function private.user_can_change_task_status(
  p_actor_user_id uuid,
  p_task_id uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_task public.project_tasks;
begin
  select task.* into v_task
  from public.project_tasks task
  where task.id = p_task_id
    and task.deleted_at is null;
  if not found or not private.user_can_edit_task(p_actor_user_id, p_task_id) then
    return false;
  end if;
  if public.has_permission(
    p_actor_user_id,
    'tasks.change_status',
    'all'
  ) then
    return true;
  end if;
  return public.has_permission(
      p_actor_user_id,
      'tasks.change_status',
      'assigned'
    ) and (
      p_actor_user_id::text = any(
        coalesce(v_task.team_member_ids, array[]::text[])
      )
      or private.user_is_project_member_for_task(
        p_actor_user_id,
        v_task.company_id,
        v_task.project_id
      )
    );
end;
$function$;

create or replace function public.authorize_task_action_as_system(
  p_actor_user_id uuid,
  p_task_id uuid,
  p_action text
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_action is distinct from 'edit' then
    raise exception 'invalid_task_action' using errcode = '22023';
  end if;
  return private.user_can_edit_task(p_actor_user_id, p_task_id);
end;
$function$;

create or replace function public.authorize_task_status_change_as_system(
  p_actor_user_id uuid,
  p_task_id uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  return private.user_can_change_task_status(p_actor_user_id, p_task_id);
end;
$function$;

revoke all on function private.user_is_project_member_for_task(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.user_can_view_task(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.user_can_edit_task(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.user_can_change_task_status(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.authorize_task_action_as_system(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.authorize_task_status_change_as_system(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.authorize_task_action_as_system(uuid, uuid, text)
  to service_role;
grant execute on function public.authorize_task_status_change_as_system(uuid, uuid)
  to service_role;

-- Browser and service callers share one actor-aware implementation. The public
-- wrappers differ only in how the canonical OPS actor is obtained.
create or replace function private.create_task_with_event_for_actor(
  p_actor_user_id uuid,
  p_task_id uuid,
  p_project_id uuid,
  p_task_type_id uuid,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_status text;
  v_task_color text;
  v_task_notes text;
  v_custom_title text;
  v_team_member_ids uuid[] := array[]::uuid[];
  v_team_member_text text[] := array[]::text[];
  v_dependency_overrides jsonb;
  v_start_date timestamptz;
  v_end_date timestamptz;
  v_duration integer;
  v_start_time time without time zone;
  v_end_time time without time zone;
  v_start_time_text text;
  v_end_time_text text;
  v_all_day boolean;
  v_recurrence_id uuid;
  v_recurrence_origin_date date;
  v_display_order integer;
  v_existing public.project_tasks;
  v_previous_actor text := current_setting('ops.task_mutation_actor_id', true);
  v_inserted_count integer := 0;
begin
  if jsonb_typeof(v_payload) is distinct from 'object'
     or exists (
       select 1
       from jsonb_object_keys(v_payload) as payload_keys(key_name)
       where not (
         key_name = any(array[
           'status', 'task_color', 'task_notes', 'custom_title',
           'team_member_ids', 'dependency_overrides', 'start_date',
           'end_date', 'duration', 'start_time', 'end_time', 'all_day',
           'recurrence_id', 'recurrence_origin_date', 'display_order'
         ]::text[])
       )
     ) then
    raise exception 'invalid_task_payload' using errcode = '22023';
  end if;

  begin
    if v_payload ? 'team_member_ids' then
      if jsonb_typeof(v_payload -> 'team_member_ids') is distinct from 'array' then
        raise exception 'invalid_task_payload' using errcode = '22023';
      end if;
      select coalesce(array_agg(member_id::uuid order by member_id::uuid), array[]::uuid[])
      into v_team_member_ids
      from jsonb_array_elements_text(v_payload -> 'team_member_ids') member(member_id);
    end if;
    v_team_member_text := array(
      select member_id::text
      from unnest(v_team_member_ids) member_id
      order by member_id
    );
    v_status := coalesce(v_payload ->> 'status', 'active');
    v_task_color := coalesce(
      nullif(btrim(v_payload ->> 'task_color'), ''),
      '#417394'
    );
    v_task_notes := v_payload ->> 'task_notes';
    v_custom_title := nullif(btrim(v_payload ->> 'custom_title'), '');
    v_dependency_overrides := case
      when v_payload ? 'dependency_overrides'
        and jsonb_typeof(v_payload -> 'dependency_overrides') <> 'null'
      then v_payload -> 'dependency_overrides'
      else null
    end;
    v_start_date := case
      when nullif(v_payload ->> 'start_date', '') is null then null
      else (v_payload ->> 'start_date')::timestamptz
    end;
    v_end_date := case
      when nullif(v_payload ->> 'end_date', '') is null then null
      else (v_payload ->> 'end_date')::timestamptz
    end;
    v_duration := coalesce((v_payload ->> 'duration')::integer, 1);
    v_start_time_text := nullif(btrim(v_payload ->> 'start_time'), '');
    v_end_time_text := nullif(btrim(v_payload ->> 'end_time'), '');
    if (v_start_time_text is not null
        and v_start_time_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$')
       or (v_end_time_text is not null
        and v_end_time_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$') then
      raise exception 'invalid_task_payload' using errcode = '22023';
    end if;
    v_start_time := v_start_time_text::time;
    v_end_time := v_end_time_text::time;
    v_all_day := coalesce((v_payload ->> 'all_day')::boolean, true);
    v_recurrence_id := nullif(v_payload ->> 'recurrence_id', '')::uuid;
    v_recurrence_origin_date := nullif(
      v_payload ->> 'recurrence_origin_date',
      ''
    )::date;
    v_display_order := coalesce((v_payload ->> 'display_order')::integer, 0);
  exception when invalid_text_representation or numeric_value_out_of_range
    or invalid_datetime_format or datetime_field_overflow then
    raise exception 'invalid_task_payload' using errcode = '22023';
  end;

  if p_actor_user_id is null
     or p_task_id is null
     or p_project_id is null
     or p_task_type_id is null
     or v_status not in ('active', 'completed', 'cancelled')
     or v_duration < 1
     or v_display_order < 0
     or (v_end_date is not null and v_start_date is null)
     or (v_end_date is not null and v_end_date < v_start_date)
     or (v_recurrence_origin_date is not null and v_recurrence_id is null)
     or (v_dependency_overrides is not null
       and jsonb_typeof(v_dependency_overrides) <> 'array')
     or cardinality(v_team_member_ids) <> (
       select count(distinct member_id)
       from unnest(v_team_member_ids) member(member_id)
     ) then
    raise exception 'invalid_task_payload' using errcode = '22023';
  end if;

  select actor.company_id into v_company_id
  from public.users actor
  where actor.id = p_actor_user_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false);
  if not found then
    raise exception 'task_create_forbidden' using errcode = '42501';
  end if;

  perform private.lock_lead_assignment_company(v_company_id);
  if not exists (
    select 1
    from public.users actor
    where actor.id = p_actor_user_id
      and actor.company_id = v_company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
  ) or not public.has_permission(p_actor_user_id, 'tasks.create', 'all') then
    raise exception 'task_create_forbidden' using errcode = '42501';
  end if;
  if cardinality(v_team_member_ids) > 0
     and not public.has_permission(p_actor_user_id, 'tasks.assign', 'all') then
    raise exception 'task_assignment_forbidden' using errcode = '42501';
  end if;
  if v_status <> 'active'
     and not public.has_permission(
       p_actor_user_id,
       'tasks.change_status',
       'all'
     ) then
    raise exception 'task_status_forbidden' using errcode = '42501';
  end if;

  perform 1
  from public.projects project
  where project.id = p_project_id
    and project.company_id = v_company_id
    and project.deleted_at is null
  for share;
  if not found then
    raise exception 'invalid_task_project' using errcode = '22023';
  end if;
  perform 1
  from public.task_types task_type
  where task_type.id = p_task_type_id
    and task_type.company_id = v_company_id
    and task_type.deleted_at is null
  for share;
  if not found then
    raise exception 'invalid_task_type' using errcode = '22023';
  end if;
  if v_recurrence_id is not null and not exists (
    select 1
    from public.task_recurrences recurrence
    where recurrence.id = v_recurrence_id
      and recurrence.company_id = v_company_id
      and recurrence.project_id = p_project_id
      and recurrence.deleted_at is null
  ) then
    raise exception 'invalid_task_recurrence' using errcode = '22023';
  end if;
  if (
    select count(*)
    from public.users member
    where member.id = any(v_team_member_ids)
      and member.company_id = v_company_id
      and member.deleted_at is null
      and coalesce(member.is_active, false)
  ) <> cardinality(v_team_member_ids) then
    raise exception 'invalid_task_team' using errcode = '22023';
  end if;

  perform set_config('ops.task_mutation_actor_id', p_actor_user_id::text, true);
  begin
    insert into public.project_tasks (
      id, company_id, project_id, task_type_id, custom_title, task_notes,
      task_color, team_member_ids, dependency_overrides, status, start_date,
      end_date, duration, start_time, end_time, all_day, recurrence_id,
      recurrence_origin_date, display_order
    ) values (
      p_task_id, v_company_id, p_project_id, p_task_type_id, v_custom_title,
      v_task_notes, v_task_color, v_team_member_text, v_dependency_overrides,
      v_status, v_start_date, v_end_date, v_duration, v_start_time, v_end_time,
      v_all_day, v_recurrence_id, v_recurrence_origin_date, v_display_order
    )
    on conflict (id) do nothing;
    get diagnostics v_inserted_count = row_count;

    select task.* into v_existing
    from public.project_tasks task
    where task.id = p_task_id
    for share;
    if not found
       or v_existing.deleted_at is not null
       or v_existing.company_id is distinct from v_company_id
       or v_existing.project_id is distinct from p_project_id
       or v_existing.task_type_id is distinct from p_task_type_id
       or v_existing.custom_title is distinct from v_custom_title
       or v_existing.task_notes is distinct from v_task_notes
       or v_existing.task_color is distinct from v_task_color
       or array(
         select distinct member_id
         from unnest(coalesce(v_existing.team_member_ids, array[]::text[])) member_id
         order by member_id
       ) is distinct from v_team_member_text
       or v_existing.dependency_overrides is distinct from v_dependency_overrides
       or v_existing.status is distinct from v_status
       or v_existing.start_date is distinct from v_start_date
       or v_existing.end_date is distinct from v_end_date
       or v_existing.duration is distinct from v_duration
       or v_existing.start_time is distinct from v_start_time
       or v_existing.end_time is distinct from v_end_time
       or v_existing.all_day is distinct from v_all_day
       or v_existing.recurrence_id is distinct from v_recurrence_id
       or v_existing.recurrence_origin_date is distinct from v_recurrence_origin_date
       or v_existing.display_order is distinct from v_display_order then
      raise exception 'task_id_conflict' using errcode = '23505';
    end if;
  exception when others then
    perform set_config(
      'ops.task_mutation_actor_id',
      coalesce(v_previous_actor, ''),
      true
    );
    raise;
  end;
  perform set_config(
    'ops.task_mutation_actor_id',
    coalesce(v_previous_actor, ''),
    true
  );
  return jsonb_build_object(
    'task_id', p_task_id,
    'created', v_inserted_count = 1,
    'schedule_version', v_existing.schedule_version,
    'updated_at', v_existing.updated_at
  );
end;
$function$;

create or replace function public.create_task_with_event(
  p_task_id uuid,
  p_project_id uuid,
  p_task_type_id uuid,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid;
begin
  if auth.role() not in ('anon', 'authenticated') then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  v_actor_user_id := private.get_current_user_id();
  if v_actor_user_id is null then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  return private.create_task_with_event_for_actor(
    v_actor_user_id,
    p_task_id,
    p_project_id,
    p_task_type_id,
    p_payload
  );
end;
$function$;

-- Approval actions run under service_role, but the task and outbox event belong
-- to the human reviewer. Company is derived from that canonical OPS actor.
create or replace function public.create_task_with_event_as_system(
  p_actor_user_id uuid,
  p_task_id uuid,
  p_project_id uuid,
  p_task_type_id uuid,
  p_custom_title text,
  p_task_notes text default null,
  p_task_color text default null,
  p_team_member_ids uuid[] default array[]::uuid[],
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_duration integer default 1
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  return private.create_task_with_event_for_actor(
    p_actor_user_id,
    p_task_id,
    p_project_id,
    p_task_type_id,
    jsonb_build_object(
      'custom_title', p_custom_title,
      'task_notes', p_task_notes,
      'task_color', p_task_color,
      'team_member_ids', to_jsonb(coalesce(p_team_member_ids, array[]::uuid[])),
      'start_date', p_start_date,
      'end_date', p_end_date,
      'duration', p_duration,
      'status', 'active',
      'all_day', true,
      'display_order', 0
    )
  );
end;
$function$;

-- One guarded patch implementation owns row locking, relationship checks,
-- permission checks, compare-and-set, actor attribution and durable outbox enqueue.
create or replace function private.update_task_with_event_for_actor(
  p_actor_user_id uuid,
  p_task_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_task public.project_tasks;
  v_next public.project_tasks;
  v_project_id uuid;
  v_previous_actor text := current_setting('ops.task_mutation_actor_id', true);
  v_changed boolean;
  v_schedule_changed boolean;
  v_team_member_ids uuid[] := array[]::uuid[];
  v_team_member_text text[] := array[]::text[];
begin
  if p_actor_user_id is null
     or p_task_id is null
     or jsonb_typeof(v_patch) is distinct from 'object'
     or v_patch = '{}'::jsonb
     or exists (
       select 1
       from jsonb_object_keys(v_patch) as patch_keys(key_name)
       where not (
         key_name = any(array[
           'status', 'task_color', 'task_notes', 'task_type_id',
           'custom_title', 'team_member_ids', 'dependency_overrides',
           'start_date', 'end_date', 'duration', 'start_time', 'end_time',
           'all_day', 'recurrence_id', 'recurrence_origin_date',
           'display_order'
         ]::text[])
       )
     ) then
    raise exception 'invalid_task_patch' using errcode = '22023';
  end if;

  select actor.company_id into v_company_id
  from public.users actor
  where actor.id = p_actor_user_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false);
  if not found then
    raise exception 'task_edit_forbidden' using errcode = '42501';
  end if;
  perform private.lock_lead_assignment_company(v_company_id);

  select task.project_id into v_project_id
  from public.project_tasks task
  where task.id = p_task_id
    and task.company_id = v_company_id
    and task.deleted_at is null;
  if not found then
    raise exception 'task_edit_forbidden' using errcode = '42501';
  end if;
  perform 1
  from public.projects project
  where project.id = v_project_id
    and project.company_id = v_company_id
    and project.deleted_at is null
  for share;
  if not found then
    raise exception 'task_edit_forbidden' using errcode = '42501';
  end if;

  select task.* into v_task
  from public.project_tasks task
  where task.id = p_task_id
    and task.company_id = v_company_id
    and task.project_id = v_project_id
    and task.deleted_at is null
  for update;
  if not found or not private.user_can_edit_task(p_actor_user_id, p_task_id) then
    raise exception 'task_edit_forbidden' using errcode = '42501';
  end if;
  if v_task.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'ok', false,
      'conflict', true,
      'task_id', p_task_id,
      'updated_at', v_task.updated_at,
      'schedule_version', v_task.schedule_version
    );
  end if;

  begin
    v_next := jsonb_populate_record(v_task, v_patch);
  exception when invalid_text_representation or numeric_value_out_of_range
    or invalid_datetime_format or datetime_field_overflow then
    raise exception 'invalid_task_patch' using errcode = '22023';
  end;

  if v_patch ? 'team_member_ids' then
    if jsonb_typeof(v_patch -> 'team_member_ids') is distinct from 'array' then
      raise exception 'invalid_task_patch' using errcode = '22023';
    end if;
    begin
      select coalesce(array_agg(member_id::uuid order by member_id::uuid), array[]::uuid[])
      into v_team_member_ids
      from jsonb_array_elements_text(v_patch -> 'team_member_ids') member(member_id);
    exception when invalid_text_representation then
      raise exception 'invalid_task_patch' using errcode = '22023';
    end;
    if cardinality(v_team_member_ids) <> (
      select count(distinct member_id)
      from unnest(v_team_member_ids) member(member_id)
    ) then
      raise exception 'invalid_task_patch' using errcode = '22023';
    end if;
    v_team_member_text := array(
      select member_id::text
      from unnest(v_team_member_ids) member_id
      order by member_id
    );
    v_next.team_member_ids := v_team_member_text;
  else
    v_team_member_text := array(
      select distinct member_id
      from unnest(coalesce(v_task.team_member_ids, array[]::text[])) member_id
      order by member_id
    );
  end if;

  if v_next.status not in ('active', 'completed', 'cancelled')
     or v_next.duration is null
     or v_next.duration < 1
     or v_next.display_order is null
     or v_next.display_order < 0
     or (v_next.end_date is not null and v_next.start_date is null)
     or (v_next.end_date is not null and v_next.end_date < v_next.start_date)
     or (v_next.recurrence_origin_date is not null and v_next.recurrence_id is null)
     or (v_next.start_time is not null and v_next.start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$')
     or (v_next.end_time is not null and v_next.end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$')
     or (v_next.dependency_overrides is not null
       and jsonb_typeof(v_next.dependency_overrides) <> 'array') then
    raise exception 'invalid_task_patch' using errcode = '22023';
  end if;

  if v_next.status is distinct from v_task.status
     and not private.user_can_change_task_status(p_actor_user_id, p_task_id) then
    raise exception 'task_status_forbidden' using errcode = '42501';
  end if;
  if v_team_member_text is distinct from array(
    select distinct member_id
    from unnest(coalesce(v_task.team_member_ids, array[]::text[])) member_id
    order by member_id
  ) and not public.has_permission(p_actor_user_id, 'tasks.assign', 'all') then
    raise exception 'task_assignment_forbidden' using errcode = '42501';
  end if;

  if v_next.task_type_id is null or not exists (
    select 1
    from public.task_types task_type
    where task_type.id = v_next.task_type_id
      and task_type.company_id = v_company_id
      and task_type.deleted_at is null
  ) then
    raise exception 'invalid_task_type' using errcode = '22023';
  end if;
  if v_next.recurrence_id is not null and not exists (
    select 1
    from public.task_recurrences recurrence
    where recurrence.id = v_next.recurrence_id
      and recurrence.company_id = v_company_id
      and recurrence.project_id = v_task.project_id
      and recurrence.deleted_at is null
  ) then
    raise exception 'invalid_task_recurrence' using errcode = '22023';
  end if;
  if (
    select count(*)
    from public.users member
    where member.id = any(v_team_member_ids)
      and member.company_id = v_company_id
      and member.deleted_at is null
      and coalesce(member.is_active, false)
  ) <> cardinality(v_team_member_ids) then
    raise exception 'invalid_task_team' using errcode = '22023';
  end if;

  v_schedule_changed :=
    v_task.start_date is distinct from v_next.start_date
    or v_task.end_date is distinct from v_next.end_date
    or v_task.start_time is distinct from v_next.start_time
    or v_task.end_time is distinct from v_next.end_time
    or v_task.all_day is distinct from v_next.all_day
    or v_task.duration is distinct from v_next.duration
    or array(
      select distinct member_id
      from unnest(coalesce(v_task.team_member_ids, array[]::text[])) member_id
      order by member_id
    ) is distinct from v_team_member_text;
  v_changed := v_schedule_changed
    or v_task.status is distinct from v_next.status
    or v_task.task_color is distinct from v_next.task_color
    or v_task.task_notes is distinct from v_next.task_notes
    or v_task.task_type_id is distinct from v_next.task_type_id
    or v_task.custom_title is distinct from v_next.custom_title
    or v_task.dependency_overrides is distinct from v_next.dependency_overrides
    or v_task.recurrence_id is distinct from v_next.recurrence_id
    or v_task.recurrence_origin_date is distinct from v_next.recurrence_origin_date
    or v_task.display_order is distinct from v_next.display_order;
  if not v_changed then
    return jsonb_build_object(
      'ok', true,
      'conflict', false,
      'changed', false,
      'schedule_changed', false,
      'task_id', p_task_id,
      'updated_at', v_task.updated_at,
      'schedule_version', v_task.schedule_version
    );
  end if;

  perform set_config('ops.task_mutation_actor_id', p_actor_user_id::text, true);
  begin
    update public.project_tasks task
    set status = v_next.status,
        task_color = v_next.task_color,
        task_notes = v_next.task_notes,
        task_type_id = v_next.task_type_id,
        custom_title = v_next.custom_title,
        team_member_ids = v_team_member_text,
        dependency_overrides = v_next.dependency_overrides,
        start_date = v_next.start_date,
        end_date = v_next.end_date,
        duration = v_next.duration,
        start_time = v_next.start_time,
        end_time = v_next.end_time,
        all_day = v_next.all_day,
        recurrence_id = v_next.recurrence_id,
        recurrence_origin_date = v_next.recurrence_origin_date,
        display_order = v_next.display_order,
        updated_at = clock_timestamp()
    where task.id = p_task_id
    returning task.* into v_task;

  exception when others then
    perform set_config(
      'ops.task_mutation_actor_id',
      coalesce(v_previous_actor, ''),
      true
    );
    raise;
  end;
  perform set_config(
    'ops.task_mutation_actor_id',
    coalesce(v_previous_actor, ''),
    true
  );
  return jsonb_build_object(
    'ok', true,
    'conflict', false,
    'changed', true,
    'schedule_changed', v_schedule_changed,
    'task_id', p_task_id,
    'updated_at', v_task.updated_at,
    'schedule_version', v_task.schedule_version
  );
end;
$function$;

create or replace function public.update_task_with_event(
  p_task_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid;
begin
  if auth.role() not in ('anon', 'authenticated') then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  v_actor_user_id := private.get_current_user_id();
  if v_actor_user_id is null then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  return private.update_task_with_event_for_actor(
    v_actor_user_id,
    p_task_id,
    p_expected_updated_at,
    p_patch
  );
end;
$function$;

create or replace function public.update_task_with_event_as_system(
  p_actor_user_id uuid,
  p_task_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  return private.update_task_with_event_for_actor(
    p_actor_user_id,
    p_task_id,
    p_expected_updated_at,
    p_patch
  );
end;
$function$;

revoke all on function private.create_task_with_event_for_actor(
  uuid, uuid, uuid, uuid, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.update_task_with_event_for_actor(
  uuid, uuid, timestamptz, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_task_with_event(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.create_task_with_event_as_system(
  uuid, uuid, uuid, uuid, text, text, text, uuid[], timestamptz,
  timestamptz, integer
) from public, anon, authenticated, service_role;
revoke all on function public.update_task_with_event(uuid, timestamptz, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.update_task_with_event_as_system(
  uuid, uuid, timestamptz, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_task_with_event(uuid, uuid, uuid, jsonb)
  to anon, authenticated;
grant execute on function public.create_task_with_event_as_system(
  uuid, uuid, uuid, uuid, text, text, text, uuid[], timestamptz,
  timestamptz, integer
) to service_role;
grant execute on function public.update_task_with_event(uuid, timestamptz, jsonb)
  to anon, authenticated;
grant execute on function public.update_task_with_event_as_system(
  uuid, uuid, timestamptz, jsonb
) to service_role;

-- Ordinary task notifications require an immutable database proof. The event
-- row is append-only; its companion outbox row owns mutable delivery state.
-- Neither a browser nor service-role caller may mint, rewrite, or delete proof.
create table if not exists public.task_mutation_events (
  id uuid primary key default gen_random_uuid(),
  event_sequence bigint generated always as identity unique,
  company_id uuid not null references public.companies(id) on delete restrict,
  task_id uuid not null references public.project_tasks(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  actor_user_id uuid references public.users(id) on delete restrict,
  event_type text not null check (
    event_type in ('task_assigned', 'task_completed', 'schedule_change')
  ),
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null,
  task_schedule_version bigint not null check (task_schedule_version >= 0),
  task_updated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists task_mutation_events_task_idx
  on public.task_mutation_events (task_id, event_sequence);

alter table public.task_mutation_events enable row level security;
revoke all on table public.task_mutation_events
  from public, anon, authenticated, service_role;

create or replace function private.reject_task_mutation_event_change()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
begin
  raise exception 'task_mutation_events_are_immutable' using errcode = '55000';
end;
$function$;

revoke all on function private.reject_task_mutation_event_change()
  from public, anon, authenticated, service_role;

drop trigger if exists task_mutation_events_immutable
  on public.task_mutation_events;
create trigger task_mutation_events_immutable
before update or delete on public.task_mutation_events
for each row execute function private.reject_task_mutation_event_change();

-- Task writes and every server follow-up must commit together. The trigger
-- below owns durability; route-level after() calls may only drain these
-- already-committed rows as a latency optimization.

create table if not exists public.task_schedule_automation_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (
    kind in (
      'full_auto_confirmation',
      'schedule_cascade',
      'confirmed_reschedule',
      'task_assigned',
      'task_completed',
      'schedule_change'
    )
  ),
  company_id uuid not null references public.companies(id) on delete cascade,
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  task_mutation_event_id uuid unique
    references public.task_mutation_events(id) on delete restrict,
  actor_user_id uuid references public.users(id) on delete set null,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null,
  task_schedule_version bigint not null check (
    task_schedule_version >= 0
    and (
      kind in ('task_assigned', 'task_completed', 'schedule_change')
      or task_schedule_version >= 1
    )
  ),
  task_updated_at timestamptz,
  requested_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  worker_id uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  disposition text,
  result jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  last_error text
);

create unique index if not exists task_schedule_automation_identity_idx
  on public.task_schedule_automation_outbox (
    task_id,
    task_schedule_version,
    kind
  )
  where kind in (
    'full_auto_confirmation',
    'schedule_cascade',
    'confirmed_reschedule'
  );

create index if not exists task_schedule_automation_outbox_pending_idx
  on public.task_schedule_automation_outbox (available_at, requested_at, id)
  where status in ('pending', 'processing');

create index if not exists task_schedule_automation_outbox_task_idx
  on public.task_schedule_automation_outbox (task_id, kind, requested_at)
  where status in ('pending', 'processing');

alter table public.task_schedule_automation_outbox enable row level security;
revoke all on table public.task_schedule_automation_outbox
  from public, anon, authenticated, service_role;

-- Outbox retries can happen after the approval action has moved beyond
-- pending. Keep task-automation sources unique across every status so a worker
-- crash after action insertion cannot produce a second client communication.
create unique index if not exists task_automation_agent_actions_unique
  on public.agent_actions (company_id, action_type, source_id)
  where source_id like 'task-automation:%';

-- Event delivery dedupe must survive a recipient reading/resolving the rail
-- row before a crashed worker retries the still-live lease.
create unique index if not exists notifications_task_mutation_dedupe_idx
  on public.notifications (user_id, company_id, dedupe_key)
  where dedupe_key like 'task-mutation:%';

create or replace function private.task_schedule_automation_snapshot(
  p_task public.project_tasks
) returns jsonb
language sql
stable
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'start_date', p_task.start_date,
    'end_date', p_task.end_date,
    'start_time', p_task.start_time,
    'end_time', p_task.end_time,
    'all_day', p_task.all_day,
    'duration', p_task.duration,
    'team_member_ids', (
      select coalesce(jsonb_agg(member_id order by member_id), '[]'::jsonb)
      from (
        select distinct member_id
        from unnest(coalesce(p_task.team_member_ids, array[]::text[])) member_id
      ) members
    ),
    'project_id', p_task.project_id,
    'task_type_id', p_task.task_type_id,
    'custom_title', p_task.custom_title,
    'status', p_task.status,
    'deleted_at', p_task.deleted_at,
    'schedule_confirmed_at', p_task.schedule_confirmed_at,
    'schedule_version', p_task.schedule_version
  );
$function$;

revoke all on function private.task_schedule_automation_snapshot(public.project_tasks)
  from public, anon, authenticated, service_role;

create or replace function private.task_schedule_automation_snapshot_matches(
  p_task public.project_tasks,
  p_snapshot jsonb,
  p_schedule_version bigint
) returns boolean
language sql
immutable
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
  select p_task.schedule_version = p_schedule_version
    and p_snapshot -> 'schedule_version' = to_jsonb(p_schedule_version)
    and p_snapshot -> 'start_date' = coalesce(
      to_jsonb(p_task.start_date),
      'null'::jsonb
    )
    and p_snapshot -> 'end_date' = coalesce(
      to_jsonb(p_task.end_date),
      'null'::jsonb
    )
    and p_snapshot -> 'start_time' = coalesce(
      to_jsonb(p_task.start_time),
      'null'::jsonb
    )
    and p_snapshot -> 'end_time' = coalesce(
      to_jsonb(p_task.end_time),
      'null'::jsonb
    )
    and p_snapshot -> 'all_day' = coalesce(
      to_jsonb(p_task.all_day),
      'null'::jsonb
    )
    and p_snapshot -> 'duration' = coalesce(
      to_jsonb(p_task.duration),
      'null'::jsonb
    )
    and p_snapshot -> 'team_member_ids' = (
      select coalesce(jsonb_agg(member_id order by member_id), '[]'::jsonb)
      from (
        select distinct member_id
        from unnest(coalesce(p_task.team_member_ids, array[]::text[])) member_id
      ) members
    )
    and p_snapshot ->> 'project_id' = p_task.project_id::text
    and p_snapshot ->> 'status' = p_task.status;
$function$;

revoke all on function private.task_schedule_automation_snapshot_matches(
  public.project_tasks,
  jsonb,
  bigint
) from public, anon, authenticated, service_role;

create or replace function private.project_task_notification_schedule_changed(
  p_old public.project_tasks,
  p_new public.project_tasks
) returns boolean
language sql
immutable
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
  select
    p_old.start_date is distinct from p_new.start_date
    or p_old.end_date is distinct from p_new.end_date
    or p_old.start_time is distinct from p_new.start_time
    or p_old.end_time is distinct from p_new.end_time
    or p_old.all_day is distinct from p_new.all_day
    or p_old.duration is distinct from p_new.duration;
$function$;

revoke all on function private.project_task_notification_schedule_changed(
  public.project_tasks,
  public.project_tasks
) from public, anon, authenticated, service_role;

create or replace function private.enqueue_task_mutation_event(
  p_event_type text,
  p_old public.project_tasks,
  p_new public.project_tasks,
  p_actor_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_event_id uuid;
  v_before_snapshot jsonb := case
    when p_old is null then '{}'::jsonb
    else private.task_schedule_automation_snapshot(p_old)
  end;
  v_after_snapshot jsonb := private.task_schedule_automation_snapshot(p_new);
begin
  if p_event_type not in (
    'task_assigned',
    'task_completed',
    'schedule_change'
  ) then
    raise exception 'invalid_task_mutation_event' using errcode = '22023';
  end if;

  insert into public.task_mutation_events (
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
    p_new.company_id,
    p_new.id,
    p_new.project_id,
    p_actor_user_id,
    p_event_type,
    v_before_snapshot,
    v_after_snapshot,
    p_new.schedule_version,
    p_new.updated_at
  )
  returning id into v_event_id;

  insert into public.task_schedule_automation_outbox (
    id,
    kind,
    company_id,
    task_id,
    task_mutation_event_id,
    actor_user_id,
    before_snapshot,
    after_snapshot,
    task_schedule_version,
    task_updated_at
  ) values (
    v_event_id,
    p_event_type,
    p_new.company_id,
    p_new.id,
    v_event_id,
    p_actor_user_id,
    v_before_snapshot,
    v_after_snapshot,
    p_new.schedule_version,
    p_new.updated_at
  );

  return v_event_id;
end;
$function$;

revoke all on function private.enqueue_task_mutation_event(
  text,
  public.project_tasks,
  public.project_tasks,
  uuid
) from public, anon, authenticated, service_role;

create or replace function private.require_current_task_automation_event(
  p_event_id uuid,
  p_lease_token uuid,
  p_task_id uuid,
  p_task_schedule_version bigint
) returns public.task_schedule_automation_outbox
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_task public.project_tasks;
  v_event public.task_schedule_automation_outbox;
  v_company_id uuid;
  v_project_id uuid;
begin
  -- Match guarded project transitions: company advisory lock, parent project,
  -- task row, then the task outbox lease.
  select task.company_id, task.project_id
  into v_company_id, v_project_id
  from public.project_tasks task
  where task.id = p_task_id
    and task.deleted_at is null
    and task.status = 'active';
  if not found then
    raise exception 'task_automation_superseded' using errcode = '40001';
  end if;
  perform private.lock_lead_assignment_company(v_company_id);
  perform 1
  from public.projects project
  where project.id = v_project_id
    and project.company_id = v_company_id
    and project.deleted_at is null
  for share;
  if not found then
    raise exception 'task_automation_superseded' using errcode = '40001';
  end if;
  select task.* into v_task
  from public.project_tasks task
  where task.id = p_task_id
    and task.company_id = v_company_id
    and task.project_id = v_project_id
    and task.deleted_at is null
    and task.status = 'active'
  for update;
  if not found then
    raise exception 'task_automation_superseded' using errcode = '40001';
  end if;

  select event.* into v_event
  from public.task_schedule_automation_outbox event
  where event.id = p_event_id
    and event.task_id = p_task_id
    and event.task_schedule_version = p_task_schedule_version
    and event.status = 'processing'
    and event.lease_token = p_lease_token
    and event.lease_expires_at > now()
  for update;
  if not found
     or v_event.actor_user_id is null
     or v_task.company_id is distinct from v_event.company_id
     or not private.task_schedule_automation_snapshot_matches(
       v_task,
       v_event.after_snapshot,
       p_task_schedule_version
     )
     or not private.user_can_edit_task(v_event.actor_user_id, p_task_id) then
    raise exception 'task_automation_superseded' using errcode = '40001';
  end if;
  return v_event;
end;
$function$;

revoke all on function private.require_current_task_automation_event(
  uuid,
  uuid,
  uuid,
  bigint
) from public, anon, authenticated, service_role;

create or replace function public.persist_task_automation_agent_action(
  p_event_id uuid,
  p_lease_token uuid,
  p_task_id uuid,
  p_task_schedule_version bigint,
  p_action_type text,
  p_action_data jsonb,
  p_context_summary text,
  p_context_source text,
  p_source_id text,
  p_confidence numeric default 0.5,
  p_priority text default 'normal',
  p_expires_at timestamptz default null,
  p_auto_execute_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_event public.task_schedule_automation_outbox;
  v_action_data jsonb;
  v_action_id uuid;
  v_inserted_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_event_id is null
     or p_lease_token is null
     or p_task_id is null
     or p_task_schedule_version < 1
     or p_action_type not in (
       'send_appointment_confirmation',
       'send_schedule_changed',
       'reschedule_tasks'
     )
     or jsonb_typeof(coalesce(p_action_data, '{}'::jsonb)) <> 'object'
     or nullif(btrim(p_context_summary), '') is null
     or p_context_source not in ('task_scheduled', 'schedule_optimization')
     or nullif(btrim(p_source_id), '') is null
     or p_source_id not like 'task-automation:' || p_event_id::text || ':%'
     or p_confidence < 0
     or p_confidence > 1
     or p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'invalid_task_automation_action' using errcode = '22023';
  end if;

  v_event := private.require_current_task_automation_event(
    p_event_id,
    p_lease_token,
    p_task_id,
    p_task_schedule_version
  );
  v_action_data := coalesce(p_action_data, '{}'::jsonb) || jsonb_build_object(
    'source_task_id', p_task_id,
    'source_task_schedule_version', p_task_schedule_version,
    'source_task_automation_event_id', p_event_id,
    'task_automation_guard',
    jsonb_build_object(
      'event_id', p_event_id,
      'task_id', p_task_id,
      'schedule_version', p_task_schedule_version
    )
  );

  insert into public.agent_actions (
    company_id,
    user_id,
    action_type,
    action_data,
    context_summary,
    context_source,
    source_id,
    confidence,
    priority,
    status,
    expires_at,
    auto_execute_at
  ) values (
    v_event.company_id,
    v_event.actor_user_id,
    p_action_type,
    v_action_data,
    btrim(p_context_summary),
    p_context_source,
    btrim(p_source_id),
    p_confidence,
    p_priority,
    'pending',
    coalesce(p_expires_at, now() + interval '3 days'),
    p_auto_execute_at
  )
  on conflict do nothing
  returning id into v_action_id;
  get diagnostics v_inserted_count = row_count;

  if v_action_id is null then
    select action.id into v_action_id
    from public.agent_actions action
    where action.company_id = v_event.company_id
      and action.user_id = v_event.actor_user_id
      and action.action_type = p_action_type
      and action.source_id = btrim(p_source_id)
    order by action.created_at, action.id
    limit 1;
    if not found then
      raise exception 'task_automation_action_conflict' using errcode = '23505';
    end if;
  end if;

  if v_event.kind = 'full_auto_confirmation'
     and p_action_type = 'send_appointment_confirmation' then
    update public.project_tasks task
    set schedule_confirmed_at = coalesce(task.schedule_confirmed_at, now()),
        schedule_confirmed_by = null
    where task.id = p_task_id
      and task.schedule_version = p_task_schedule_version;
  end if;

  return jsonb_build_object(
    'action_id', v_action_id,
    'created', v_inserted_count = 1
  );
end;
$function$;

create or replace function public.persist_task_automation_notification(
  p_event_id uuid,
  p_lease_token uuid,
  p_task_id uuid,
  p_task_schedule_version bigint,
  p_title text,
  p_body text,
  p_action_url text default '/schedule',
  p_action_label text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_event public.task_schedule_automation_outbox;
  v_created boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if nullif(btrim(p_title), '') is null
     or nullif(btrim(p_body), '') is null then
    raise exception 'invalid_task_automation_notification' using errcode = '22023';
  end if;
  v_event := private.require_current_task_automation_event(
    p_event_id,
    p_lease_token,
    p_task_id,
    p_task_schedule_version
  );
  v_created := public.create_notification_if_new_with_status(
    v_event.actor_user_id::text,
    v_event.company_id::text,
    'mention',
    btrim(p_title),
    btrim(p_body),
    false,
    p_action_url,
    p_action_label,
    null,
    null,
    'task-automation-notification:' || p_event_id::text
  );
  return jsonb_build_object('created', v_created);
end;
$function$;

-- Persist ordinary task notifications from immutable mutation proof. The
-- caller supplies only the proof/lease identity; recipient set, access,
-- preferences, copy, navigation and dedupe are derived under database locks.
create or replace function public.persist_task_mutation_notification_as_system(
  p_event_id uuid,
  p_lease_token uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_probe public.task_schedule_automation_outbox;
  v_outbox public.task_schedule_automation_outbox;
  v_event public.task_mutation_events;
  v_task public.project_tasks;
  v_project_title text;
  v_task_type_title text;
  v_task_title text;
  v_actor_name text := 'A team member';
  v_preference_key text;
  v_title text;
  v_body text;
  v_push_title text;
  v_push_body text;
  v_action_url text;
  v_action_label text;
  v_candidate_ids uuid[] := array[]::uuid[];
  v_in_app_ids uuid[] := array[]::uuid[];
  v_push_ids uuid[] := array[]::uuid[];
  v_created_ids uuid[] := array[]::uuid[];
  v_schedule_is_current boolean := true;
  v_schedule_fields_changed boolean := false;
  v_preference record;
  v_created boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_event_id is null or p_lease_token is null then
    raise exception 'invalid_task_notification_proof' using errcode = '22023';
  end if;

  select event.* into v_probe
  from public.task_schedule_automation_outbox event
  where event.id = p_event_id
    and event.task_mutation_event_id = p_event_id
    and event.kind in ('task_assigned', 'task_completed', 'schedule_change')
    and event.status = 'processing'
    and event.lease_token = p_lease_token
    and event.lease_expires_at > now();
  if not found then
    raise exception 'task_notification_lease_lost' using errcode = '40001';
  end if;

  perform private.lock_lead_assignment_company(v_probe.company_id);

  select task.* into v_task
  from public.project_tasks task
  where task.id = v_probe.task_id
    and task.company_id = v_probe.company_id
    and task.deleted_at is null;
  if found then
    perform 1
    from public.projects project
    where project.id = v_task.project_id
      and project.company_id = v_probe.company_id
      and project.deleted_at is null
    for share;
    if found then
      select task.* into v_task
      from public.project_tasks task
      where task.id = v_probe.task_id
        and task.company_id = v_probe.company_id
        and task.deleted_at is null
      for share;
    else
      v_task := null;
    end if;
  end if;

  select event.* into v_outbox
  from public.task_schedule_automation_outbox event
  where event.id = p_event_id
    and event.task_mutation_event_id = p_event_id
    and event.kind in ('task_assigned', 'task_completed', 'schedule_change')
    and event.status = 'processing'
    and event.lease_token = p_lease_token
    and event.lease_expires_at > now()
  for update;
  if not found then
    raise exception 'task_notification_lease_lost' using errcode = '40001';
  end if;

  select mutation.* into v_event
  from public.task_mutation_events mutation
  where mutation.id = p_event_id
    and mutation.company_id = v_outbox.company_id
    and mutation.task_id = v_outbox.task_id
    and mutation.event_type = v_outbox.kind;
  if not found
     or v_task.id is null
     or v_task.project_id is distinct from v_event.project_id
     or v_event.before_snapshot is distinct from v_outbox.before_snapshot
     or v_event.after_snapshot is distinct from v_outbox.after_snapshot
     or v_event.task_schedule_version is distinct from v_outbox.task_schedule_version
     or v_event.actor_user_id is distinct from v_outbox.actor_user_id then
    return jsonb_build_object(
      'disposition', 'superseded',
      'push_recipient_ids', '[]'::jsonb
    );
  end if;

  if v_event.event_type = 'schedule_change' then
    v_schedule_fields_changed :=
      v_event.before_snapshot -> 'start_date'
        is distinct from v_event.after_snapshot -> 'start_date'
      or v_event.before_snapshot -> 'end_date'
        is distinct from v_event.after_snapshot -> 'end_date'
      or v_event.before_snapshot -> 'start_time'
        is distinct from v_event.after_snapshot -> 'start_time'
      or v_event.before_snapshot -> 'end_time'
        is distinct from v_event.after_snapshot -> 'end_time'
      or v_event.before_snapshot -> 'all_day'
        is distinct from v_event.after_snapshot -> 'all_day'
      or v_event.before_snapshot -> 'duration'
        is distinct from v_event.after_snapshot -> 'duration';
    v_schedule_is_current := v_task.status = 'active'
      and private.task_schedule_automation_snapshot_matches(
        v_task,
        v_event.after_snapshot,
        v_event.task_schedule_version
      );
  end if;
  if v_event.event_type = 'task_completed' and (
    v_task.status is distinct from 'completed'
    or exists (
      select 1
      from public.task_mutation_events later
      where later.task_id = v_event.task_id
        and later.event_type = 'task_completed'
        and later.event_sequence > v_event.event_sequence
    )
  ) then
    return jsonb_build_object(
      'disposition', 'superseded',
      'push_recipient_ids', '[]'::jsonb
    );
  end if;

  if v_event.event_type = 'task_assigned' then
    select coalesce(array_agg(member_id order by member_id), array[]::uuid[])
    into v_candidate_ids
    from (
      select distinct private.try_parse_uuid(member.value) member_id
      from jsonb_array_elements_text(
        coalesce(v_event.after_snapshot -> 'team_member_ids', '[]'::jsonb)
      ) member(value)
      where private.try_parse_uuid(member.value) is not null
        and not exists (
          select 1
          from jsonb_array_elements_text(
            coalesce(v_event.before_snapshot -> 'team_member_ids', '[]'::jsonb)
          ) before_member(value)
          where before_member.value = member.value
        )
        and not exists (
          select 1
          from public.task_mutation_events later
          where later.task_id = v_event.task_id
            and later.event_type = 'task_assigned'
            and later.event_sequence > v_event.event_sequence
            and exists (
              select 1
              from jsonb_array_elements_text(
                coalesce(
                  later.after_snapshot -> 'team_member_ids',
                  '[]'::jsonb
                )
              ) later_after(value)
              where later_after.value = member.value
            )
            and not exists (
              select 1
              from jsonb_array_elements_text(
                coalesce(
                  later.before_snapshot -> 'team_member_ids',
                  '[]'::jsonb
                )
              ) later_before(value)
              where later_before.value = member.value
            )
        )
    ) candidates;
    v_preference_key := 'task_assigned';
    v_title := 'New Task Assignment';
    v_action_label := 'View Task';
  elsif v_event.event_type = 'task_completed' then
    select coalesce(array_agg(member_id order by member_id), array[]::uuid[])
    into v_candidate_ids
    from (
      select distinct private.try_parse_uuid(member.value) member_id
      from jsonb_array_elements_text(
        coalesce(v_event.after_snapshot -> 'team_member_ids', '[]'::jsonb)
      ) member(value)
      where private.try_parse_uuid(member.value) is not null
    ) candidates;
    v_preference_key := 'task_completed';
    v_title := 'Task Completed';
    v_action_label := 'View Project';
  else
    select coalesce(array_agg(member_id order by member_id), array[]::uuid[])
    into v_candidate_ids
    from (
      select distinct private.try_parse_uuid(member.value) member_id
      from (
        select member.value
        from jsonb_array_elements_text(
          coalesce(v_event.before_snapshot -> 'team_member_ids', '[]'::jsonb)
        ) member(value)
        union
        select member.value
        from jsonb_array_elements_text(
          coalesce(v_event.after_snapshot -> 'team_member_ids', '[]'::jsonb)
        ) member(value)
      ) member
      where private.try_parse_uuid(member.value) is not null
        and (
          (v_schedule_is_current and v_schedule_fields_changed)
          or (
            exists (
              select 1
              from jsonb_array_elements_text(
                coalesce(
                  v_event.before_snapshot -> 'team_member_ids',
                  '[]'::jsonb
                )
              ) before_member(value)
              where before_member.value = member.value
            )
            and not exists (
              select 1
              from jsonb_array_elements_text(
                coalesce(
                  v_event.after_snapshot -> 'team_member_ids',
                  '[]'::jsonb
                )
              ) after_member(value)
              where after_member.value = member.value
            )
            and not (
              member.value = any(
                coalesce(v_task.team_member_ids, array[]::text[])
              )
            )
            and not exists (
              select 1
              from public.task_mutation_events later
              where later.task_id = v_event.task_id
                and later.event_type = 'schedule_change'
                and later.event_sequence > v_event.event_sequence
                and exists (
                  select 1
                  from jsonb_array_elements_text(
                    coalesce(
                      later.before_snapshot -> 'team_member_ids',
                      '[]'::jsonb
                    )
                  ) later_before(value)
                  where later_before.value = member.value
                )
                and not exists (
                  select 1
                  from jsonb_array_elements_text(
                    coalesce(
                      later.after_snapshot -> 'team_member_ids',
                      '[]'::jsonb
                    )
                  ) later_after(value)
                  where later_after.value = member.value
                )
            )
          )
        )
    ) candidates;
    v_preference_key := 'schedule_changes';
    v_title := 'Schedule Update';
    v_action_label := 'View Task';
  end if;

  select project.title into v_project_title
  from public.projects project
  where project.id = v_event.project_id
    and project.company_id = v_event.company_id
    and project.deleted_at is null;
  if not found then
    return jsonb_build_object(
      'disposition', 'superseded',
      'push_recipient_ids', '[]'::jsonb
    );
  end if;

  select task_type.display into v_task_type_title
  from public.task_types task_type
  where task_type.id = private.try_parse_uuid(
      v_event.after_snapshot ->> 'task_type_id'
    )
    and task_type.company_id = v_event.company_id
    and task_type.deleted_at is null;
  v_task_title := coalesce(
    nullif(btrim(v_event.after_snapshot ->> 'custom_title'), ''),
    nullif(btrim(v_task_type_title), ''),
    'Task'
  );
  if v_event.actor_user_id is not null then
    select nullif(
      btrim(concat_ws(' ', actor.first_name, actor.last_name)),
      ''
    ) into v_actor_name
    from public.users actor
    where actor.id = v_event.actor_user_id
      and actor.company_id = v_event.company_id;
    v_actor_name := coalesce(v_actor_name, 'A team member');
  end if;

  v_body := case v_event.event_type
    when 'task_assigned' then format(
      '%s assigned you %s on %s.',
      v_actor_name,
      v_task_title,
      v_project_title
    )
    when 'task_completed' then format(
      '%s completed %s on %s.',
      v_actor_name,
      v_task_title,
      v_project_title
    )
    else format(
      '%s rescheduled %s on %s.',
      v_actor_name,
      v_task_title,
      v_project_title
    )
  end;
  v_push_title := case
    when v_event.event_type = 'schedule_change' then 'Schedule Updated'
    else v_title
  end;
  v_push_body := case
    when v_event.event_type = 'schedule_change'
      then 'A task was changed or removed from your schedule.'
    else v_body
  end;
  v_action_url := '/dashboard?openProject=' || v_event.project_id::text || '&mode=view';

  for v_preference in
    select
      candidate.user_id,
      case
        when lower(coalesce(
          preference.channel_preferences
            -> v_preference_key
            ->> 'push',
          ''
        )) = 'false' then false
        else true
      end wants_push,
      coalesce(preference.push_enabled, true) push_enabled,
      case
        when v_event.event_type = 'schedule_change'
          and (
            not v_schedule_is_current
            or not v_schedule_fields_changed
          ) then false
        else private.user_can_view_task(
          candidate.user_id,
          v_event.task_id
        )
      end has_task_view
    from unnest(v_candidate_ids) candidate(user_id)
    join public.users recipient
      on recipient.id = candidate.user_id
     and recipient.company_id = v_event.company_id
     and recipient.deleted_at is null
     and coalesce(recipient.is_active, false)
    left join public.notification_preferences preference
      on preference.user_id = candidate.user_id
     and preference.company_id = v_event.company_id
    where candidate.user_id is distinct from v_event.actor_user_id
      and (
        v_event.event_type = 'schedule_change'
        or private.user_can_view_task(candidate.user_id, v_event.task_id)
      )
      and (
        v_event.event_type <> 'task_assigned'
        or candidate.user_id::text = any(
          coalesce(v_task.team_member_ids, array[]::text[])
        )
      )
    order by candidate.user_id
  loop
    v_in_app_ids := array_append(v_in_app_ids, v_preference.user_id);
    v_created := public.create_notification_if_new_with_status(
      v_preference.user_id::text,
      v_event.company_id::text,
      v_event.event_type,
      case
        when v_preference.has_task_view then v_title
        else 'Schedule Updated'
      end,
      case
        when v_preference.has_task_view then v_body
        else 'A task was changed or removed from your schedule.'
      end,
      false,
      case when v_preference.has_task_view then v_action_url else null end,
      case when v_preference.has_task_view then v_action_label else null end,
      case
        when v_preference.has_task_view then v_event.project_id::text
        else null
      end,
      case when v_preference.has_task_view then 'task' else null end,
      'task-mutation:' || v_event.id::text
    );
    if v_created then
      v_created_ids := array_append(v_created_ids, v_preference.user_id);
    end if;
    if v_preference.wants_push and v_preference.push_enabled then
      v_push_ids := array_append(v_push_ids, v_preference.user_id);
    end if;
  end loop;

  return jsonb_build_object(
    'disposition', case
      when cardinality(v_in_app_ids) = 0 and cardinality(v_push_ids) = 0
        then 'no_action'
      else 'processed'
    end,
    'type', v_event.event_type,
    'title', v_title,
    'body', v_body,
    'push_title', v_push_title,
    'push_body', v_push_body,
    'project_id', v_event.project_id,
    'action_url', v_action_url,
    'action_label', v_action_label,
    'recipient_user_ids', to_jsonb(v_in_app_ids),
    'created_recipient_ids', to_jsonb(v_created_ids),
    'push_recipient_ids', to_jsonb(v_push_ids)
  );
end;
$function$;

revoke all on function public.persist_task_automation_agent_action(
  uuid, uuid, uuid, bigint, text, jsonb, text, text, text, numeric,
  text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.persist_task_automation_notification(
  uuid, uuid, uuid, bigint, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.persist_task_mutation_notification_as_system(
  uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.persist_task_automation_agent_action(
  uuid, uuid, uuid, bigint, text, jsonb, text, text, text, numeric,
  text, timestamptz, timestamptz
) to service_role;
grant execute on function public.persist_task_automation_notification(
  uuid, uuid, uuid, bigint, text, text, text, text
) to service_role;
grant execute on function public.persist_task_mutation_notification_as_system(
  uuid, uuid
) to service_role;

create or replace function private.enqueue_task_schedule_automation_kind(
  p_kind text,
  p_old public.project_tasks,
  p_new public.project_tasks,
  p_actor_user_id uuid
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_pending_id uuid;
  v_earliest_before_snapshot jsonb;
  v_before_snapshot jsonb := case
    when p_old is null then '{}'::jsonb
    else private.task_schedule_automation_snapshot(p_old)
  end;
  v_after_snapshot jsonb := private.task_schedule_automation_snapshot(p_new);
begin
  if p_kind not in (
    'full_auto_confirmation',
    'schedule_cascade',
    'confirmed_reschedule'
  ) then
    raise exception 'invalid task automation kind' using errcode = '22023';
  end if;

  -- Preserve A as the before snapshot when rapid A->B->C edits arrive before
  -- B is communicated. A processing B event also donates its original A
  -- snapshot to the newly queued C event; the worker will consume B as stale.
  select event.before_snapshot
  into v_earliest_before_snapshot
  from public.task_schedule_automation_outbox event
  where event.task_id = p_new.id
    and event.kind = p_kind
    and event.status in ('pending', 'processing')
  order by event.task_schedule_version, event.id
  limit 1;

  if v_earliest_before_snapshot is not null
     and v_earliest_before_snapshot <> '{}'::jsonb then
    v_before_snapshot := v_earliest_before_snapshot;
  end if;

  select event.id
  into v_pending_id
  from public.task_schedule_automation_outbox event
  where event.task_id = p_new.id
    and event.kind = p_kind
    and event.status = 'pending'
  order by event.requested_at, event.id
  limit 1
  for update;

  if v_pending_id is not null then
    update public.task_schedule_automation_outbox event
    set actor_user_id = p_actor_user_id,
        before_snapshot = v_before_snapshot,
        after_snapshot = v_after_snapshot,
        task_schedule_version = p_new.schedule_version,
        task_updated_at = p_new.updated_at,
        requested_at = now(),
        available_at = now(),
        attempts = 0,
        worker_id = null,
        lease_token = null,
        lease_expires_at = null,
        disposition = null,
        result = '{}'::jsonb,
        completed_at = null,
        last_error = null
    where event.id = v_pending_id
      and event.status = 'pending';
    return;
  end if;

  insert into public.task_schedule_automation_outbox (
    kind,
    company_id,
    task_id,
    actor_user_id,
    before_snapshot,
    after_snapshot,
    task_schedule_version,
    task_updated_at
  ) values (
    p_kind,
    p_new.company_id,
    p_new.id,
    p_actor_user_id,
    v_before_snapshot,
    v_after_snapshot,
    p_new.schedule_version,
    p_new.updated_at
  );
end;
$function$;

revoke all on function private.enqueue_task_schedule_automation_kind(
  text,
  public.project_tasks,
  public.project_tasks,
  uuid
) from public, anon, authenticated, service_role;

create or replace function private.enqueue_task_schedule_automation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_service_actor text;
  v_schedule_changed boolean := false;
  v_notification_schedule_changed boolean := false;
  v_assignment_added boolean := false;
  v_assignment_removed boolean := false;
begin
  if auth.role() = 'service_role' then
    v_service_actor := nullif(
      btrim(current_setting('ops.task_mutation_actor_id', true)),
      ''
    );
    if v_service_actor is not null
       and v_service_actor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_actor_user_id := v_service_actor::uuid;
    else
      v_actor_user_id := null;
    end if;
  end if;

  if v_actor_user_id is not null and not exists (
    select 1
    from public.users actor
    where actor.id = v_actor_user_id
      and actor.company_id = new.company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
  ) then
    v_actor_user_id := null;
  end if;

  if tg_op = 'INSERT' then
    if new.deleted_at is null
       and cardinality(coalesce(new.team_member_ids, array[]::text[])) > 0 then
      perform private.enqueue_task_mutation_event(
        'task_assigned', null, new, v_actor_user_id
      );
    end if;
    if new.start_date is not null and new.deleted_at is null then
      perform private.enqueue_task_schedule_automation_kind(
        'schedule_cascade', null, new, v_actor_user_id
      );
      perform private.enqueue_task_schedule_automation_kind(
        'full_auto_confirmation', null, new, v_actor_user_id
      );
    end if;
    return new;
  end if;

  v_schedule_changed := private.project_task_schedule_changed(old, new);
  v_notification_schedule_changed :=
    private.project_task_notification_schedule_changed(old, new);
  v_assignment_added := exists (
    select 1
    from unnest(coalesce(new.team_member_ids, array[]::text[])) member_id
    where not (
      member_id = any(coalesce(old.team_member_ids, array[]::text[]))
    )
  );
  v_assignment_removed := exists (
    select 1
    from unnest(coalesce(old.team_member_ids, array[]::text[])) member_id
    where not (
      member_id = any(coalesce(new.team_member_ids, array[]::text[]))
    )
  );

  if new.deleted_at is null then
    if v_assignment_added then
      perform private.enqueue_task_mutation_event(
        'task_assigned', old, new, v_actor_user_id
      );
    end if;
    if old.status is distinct from 'completed'
       and new.status = 'completed' then
      perform private.enqueue_task_mutation_event(
        'task_completed', old, new, v_actor_user_id
      );
    end if;
    if new.status = 'active'
       and (v_notification_schedule_changed or v_assignment_removed) then
      perform private.enqueue_task_mutation_event(
        'schedule_change', old, new, v_actor_user_id
      );
    end if;
  end if;

  if not v_schedule_changed then
    return new;
  end if;

  perform private.enqueue_task_schedule_automation_kind(
    'schedule_cascade', old, new, v_actor_user_id
  );
  if old.schedule_confirmed_at is not null then
    perform private.enqueue_task_schedule_automation_kind(
      'confirmed_reschedule', old, new, v_actor_user_id
    );
  end if;
  if new.start_date is not null and new.schedule_confirmed_at is null then
    perform private.enqueue_task_schedule_automation_kind(
      'full_auto_confirmation', old, new, v_actor_user_id
    );
  end if;
  return new;
end;
$function$;

revoke all on function private.enqueue_task_schedule_automation()
  from public, anon, authenticated, service_role;

drop trigger if exists project_tasks_enqueue_schedule_automation
  on public.project_tasks;
create trigger project_tasks_enqueue_schedule_automation
after insert or update on public.project_tasks
for each row
execute function private.enqueue_task_schedule_automation();

-- Terminalization is deliberately separate from claiming. The worker must
-- observe this count so health checks cannot report success while exhausted
-- events are silently moved to failed.
create or replace function public.finalize_exhausted_task_schedule_automation_events()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_terminalized integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  update public.task_schedule_automation_outbox event
  set status = 'failed',
      completed_at = now(),
      disposition = 'attempts_exhausted',
      worker_id = null,
      lease_token = null,
      lease_expires_at = null,
      last_error = coalesce(
        event.last_error,
        'Task automation lease expired after maximum attempts'
      )
  where event.status = 'processing'
    and event.attempts >= 10
    and event.lease_expires_at <= now();
  get diagnostics v_terminalized = row_count;
  return v_terminalized;
end;
$function$;

create or replace function public.claim_task_schedule_automation_events(
  p_worker_id uuid,
  p_limit integer default 1,
  p_lease_seconds integer default 180
) returns table (
  event_id uuid,
  lease_token uuid,
  kind text,
  company_id uuid,
  task_id uuid,
  actor_user_id uuid,
  before_snapshot jsonb,
  after_snapshot jsonb,
  task_schedule_version bigint,
  task_updated_at timestamptz,
  attempt integer
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_worker_id is null or p_limit is distinct from 1
     or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'invalid claim arguments' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select event.id
    from public.task_schedule_automation_outbox event
    where event.status in ('pending', 'processing')
      and event.available_at <= now()
      and (
        event.status = 'pending'
        or event.lease_expires_at is null
        or event.lease_expires_at <= now()
      )
      and event.attempts < 10
    order by event.requested_at, event.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.task_schedule_automation_outbox event
    set status = 'processing',
        attempts = event.attempts + 1,
        worker_id = p_worker_id,
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        last_error = null
    from candidates
    where event.id = candidates.id
    returning event.*
  )
  select
    claimed.id,
    claimed.lease_token,
    claimed.kind,
    claimed.company_id,
    claimed.task_id,
    claimed.actor_user_id,
    claimed.before_snapshot,
    claimed.after_snapshot,
    claimed.task_schedule_version,
    claimed.task_updated_at,
    claimed.attempts
  from claimed;
end;
$function$;

create or replace function public.complete_task_schedule_automation_event(
  p_event_id uuid,
  p_lease_token uuid,
  p_disposition text default 'processed',
  p_result jsonb default '{}'::jsonb
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_completed_count bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_disposition not in (
    'processed',
    'superseded',
    'actor_missing',
    'access_lost',
    'task_deleted',
    'phase_disabled',
    'no_action'
  ) then
    raise exception 'invalid completion disposition' using errcode = '22023';
  end if;

  update public.task_schedule_automation_outbox event
  set status = 'completed',
      completed_at = now(),
      disposition = p_disposition,
      result = coalesce(p_result, '{}'::jsonb),
      worker_id = null,
      lease_token = null,
      lease_expires_at = null,
      last_error = null
  where event.id = p_event_id
    and event.status = 'processing'
    and event.lease_token = p_lease_token
    and event.lease_expires_at > now();
  get diagnostics v_completed_count = row_count;
  return v_completed_count = 1;
end;
$function$;

create or replace function public.fail_task_schedule_automation_event(
  p_event_id uuid,
  p_lease_token uuid,
  p_error text,
  p_retryable boolean default true
) returns text
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_attempts integer;
  v_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select event.attempts into v_attempts
  from public.task_schedule_automation_outbox event
  where event.id = p_event_id
    and event.status = 'processing'
    and event.lease_token = p_lease_token
    and event.lease_expires_at > now()
  for update;
  if not found then
    return 'stale';
  end if;

  v_status := case
    when p_retryable and v_attempts < 10 then 'pending'
    else 'failed'
  end;
  update public.task_schedule_automation_outbox event
  set status = v_status,
      available_at = case
        when v_status = 'pending'
          then now() + make_interval(
            secs => least(900, 15 * power(2, least(v_attempts, 6)))
          )
        else event.available_at
      end,
      completed_at = case when v_status = 'failed' then now() else null end,
      disposition = case when v_status = 'failed' then 'failed' else null end,
      worker_id = null,
      lease_token = null,
      lease_expires_at = null,
      last_error = left(coalesce(p_error, 'Unknown task automation failure'), 2000)
  where event.id = p_event_id;
  return v_status;
end;
$function$;

revoke all on function public.claim_task_schedule_automation_events(uuid, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_exhausted_task_schedule_automation_events()
  from public, anon, authenticated, service_role;
revoke all on function public.complete_task_schedule_automation_event(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.fail_task_schedule_automation_event(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_task_schedule_automation_events(uuid, integer, integer)
  to service_role;
grant execute on function public.finalize_exhausted_task_schedule_automation_events()
  to service_role;
grant execute on function public.complete_task_schedule_automation_event(uuid, uuid, text, jsonb)
  to service_role;
grant execute on function public.fail_task_schedule_automation_event(uuid, uuid, text, boolean)
  to service_role;

-- Delayed/manual schedule emails must still describe the current task at the
-- last database boundary before the provider is touched.
create or replace function private.task_automation_email_intent_is_current(
  p_intent_id uuid
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_intent public.approved_action_email_intents;
  v_guard jsonb;
  v_event_id uuid;
  v_task_id uuid;
  v_schedule_version bigint;
  v_task public.project_tasks;
  v_event public.task_schedule_automation_outbox;
begin
  select intent.* into v_intent
  from public.approved_action_email_intents intent
  where intent.id = p_intent_id;
  if not found then
    return false;
  end if;
  v_guard := v_intent.action_data_snapshot -> 'task_automation_guard';
  if v_guard is null then
    return true;
  end if;
  if jsonb_typeof(v_guard) <> 'object' then
    return false;
  end if;
  begin
    v_event_id := (v_guard ->> 'event_id')::uuid;
    v_task_id := (v_guard ->> 'task_id')::uuid;
    v_schedule_version := (v_guard ->> 'schedule_version')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return false;
  end;

  select task.* into v_task
  from public.project_tasks task
  join public.projects project
    on project.id = task.project_id
   and project.company_id = task.company_id
   and project.deleted_at is null
  where task.id = v_task_id
    and task.company_id = v_intent.company_id
    and task.deleted_at is null
    and task.status = 'active'
  for share of task;
  if not found or not private.user_can_edit_task(
    v_intent.actor_user_id,
    v_task_id
  ) then
    return false;
  end if;

  select event.* into v_event
  from public.task_schedule_automation_outbox event
  where event.id = v_event_id
    and event.company_id = v_intent.company_id
    and event.task_id = v_task_id
    and event.actor_user_id = v_intent.actor_user_id
    and event.task_schedule_version = v_schedule_version
    and event.status <> 'failed';
  if not found then
    return false;
  end if;
  return private.task_schedule_automation_snapshot_matches(
    v_task,
    v_event.after_snapshot,
    v_schedule_version
  );
end;
$function$;

revoke all on function private.task_automation_email_intent_is_current(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.claim_approved_action_email_delivery(
  p_intent_id uuid
) returns public.approved_action_email_intents
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_intent public.approved_action_email_intents;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  select intent.* into v_intent
  from public.approved_action_email_intents intent
  where intent.id = p_intent_id
  for update;
  if not found or v_intent.status <> 'prepared' then
    return null;
  end if;
  if v_intent.opportunity_id is not null then
    perform 1
    from public.opportunities opportunity
    where opportunity.id = v_intent.opportunity_id
      and opportunity.company_id = v_intent.company_id
      and opportunity.deleted_at is null
    for share;
    if not found then
      raise exception 'APPROVED_ACTION_EMAIL_AUTHORIZATION_REVOKED';
    end if;
  end if;
  if not private.approved_action_email_intent_is_authorized(p_intent_id, true)
     or not private.task_automation_email_intent_is_current(p_intent_id) then
    raise exception 'APPROVED_ACTION_EMAIL_AUTHORIZATION_REVOKED';
  end if;
  update public.approved_action_email_intents intent
  set status = 'sending',
      last_error = null
  where intent.id = p_intent_id
  returning intent.* into v_intent;
  return v_intent;
end;
$function$;

revoke all on function public.claim_approved_action_email_delivery(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_approved_action_email_delivery(uuid)
  to service_role;

commit;
