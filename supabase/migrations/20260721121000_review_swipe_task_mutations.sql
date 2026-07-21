-- Unassigned Review only advances a card after a server-confirmed mutation.
-- This wrapper owns delayed permission/lifecycle revalidation, optimistic
-- concurrency, crew-snapshot validation, and action-specific payload limits.

create or replace function public.mutate_task_from_unassigned_review(
  p_task_id uuid,
  p_expected_updated_at timestamptz,
  p_action text,
  p_expected_team_member_ids uuid[] default null,
  p_patch jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_company_id uuid := private.get_user_company_id();
  v_project_id uuid;
  v_task public.project_tasks%rowtype;
  v_project_status text;
  v_current_team uuid[];
  v_expected_team uuid[];
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_result jsonb;
begin
  if auth.role() not in ('anon', 'authenticated')
     or v_actor_user_id is null
     or v_company_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_task_id is null
     or p_expected_updated_at is null
     or p_action is null
     or p_action not in ('assign', 'schedule', 'complete', 'cancel')
     or jsonb_typeof(v_patch) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'invalid_review_task_mutation';
  end if;

  perform private.lock_lead_assignment_company(v_company_id);

  select task.project_id
    into v_project_id
    from public.project_tasks task
   where task.id = p_task_id
     and task.company_id = v_company_id
     and task.deleted_at is null;

  if not found then
    raise exception using errcode = 'P0002', message = 'review_task_not_found';
  end if;

  select project.status
    into v_project_status
    from public.projects project
   where project.id = v_project_id
     and project.company_id = v_company_id
     and project.deleted_at is null
   for share;

  if not found then
    raise exception using errcode = 'P0002', message = 'review_project_not_found';
  end if;

  select task.*
    into v_task
    from public.project_tasks task
   where task.id = p_task_id
     and task.company_id = v_company_id
     and task.project_id = v_project_id
     and task.deleted_at is null
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'review_task_not_found';
  end if;

  v_current_team := array(
    select distinct member_id::uuid
      from unnest(coalesce(v_task.team_member_ids, array[]::text[])) member(member_id)
     order by member_id::uuid
  );
  if p_expected_team_member_ids is not null then
    v_expected_team := array(
      select distinct member_id
        from unnest(p_expected_team_member_ids) member(member_id)
       order by member_id
    );
  end if;

  if not private.user_can_edit_task(v_actor_user_id, p_task_id) then
    raise exception using errcode = '42501', message = 'task_edit_forbidden';
  end if;

  -- Authorize the exact direction before any idempotent or conflict response.
  -- A caller must never use an already-terminal row as an authorization oracle.
  case p_action
    when 'assign' then
      if not public.has_permission(v_actor_user_id, 'tasks.assign', 'all') then
        raise exception using errcode = '42501', message = 'task_assignment_forbidden';
      end if;
      if not (v_patch ? 'team_member_ids')
         or exists (
           select 1
             from jsonb_object_keys(v_patch) key_name
            where key_name <> 'team_member_ids'
         )
         or jsonb_typeof(v_patch -> 'team_member_ids') is distinct from 'array' then
        raise exception using errcode = '22023', message = 'invalid_review_assignment';
      end if;
      if jsonb_array_length(v_patch -> 'team_member_ids') = 0 then
        raise exception using errcode = '22023', message = 'review_assignment_requires_crew';
      end if;

    when 'schedule' then
      if not (
        public.has_permission(v_actor_user_id, 'calendar.edit', 'all')
        or (
          public.has_permission(v_actor_user_id, 'calendar.edit', 'own')
          and v_actor_user_id = any(v_current_team)
        )
      ) then
        raise exception using errcode = '42501', message = 'calendar_edit_forbidden';
      end if;
      if exists (
        select 1
          from jsonb_object_keys(v_patch) key_name
         where key_name not in (
           'start_date', 'end_date', 'duration', 'schedule_locked'
         )
      ) or not (v_patch ? 'start_date')
         or not (v_patch ? 'end_date')
         or not (v_patch ? 'schedule_locked')
         or p_expected_team_member_ids is null
         or cardinality(v_current_team) = 0
         or jsonb_typeof(v_patch -> 'start_date') is distinct from 'string'
         or jsonb_typeof(v_patch -> 'end_date') is distinct from 'string'
         or nullif(btrim(v_patch ->> 'start_date'), '') is null
         or nullif(btrim(v_patch ->> 'end_date'), '') is null
         or (
           v_patch ? 'duration'
           and jsonb_typeof(v_patch -> 'duration') is distinct from 'number'
         )
         or (
           v_patch ? 'schedule_locked'
           and jsonb_typeof(v_patch -> 'schedule_locked') is distinct from 'boolean'
         ) then
        raise exception using errcode = '22023', message = 'invalid_review_schedule';
      end if;

    when 'cancel' then
      if not private.user_can_change_task_status(v_actor_user_id, p_task_id) then
        raise exception using errcode = '42501', message = 'task_status_forbidden';
      end if;
      if v_patch <> '{}'::jsonb then
        raise exception using errcode = '22023', message = 'invalid_review_status_patch';
      end if;

    when 'complete' then
      if not private.user_can_change_task_status(v_actor_user_id, p_task_id) then
        raise exception using errcode = '42501', message = 'task_status_forbidden';
      end if;
      if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
        raise exception using errcode = '22023', message = 'idempotency_key_required';
      end if;
      if v_patch <> '{}'::jsonb then
        raise exception using errcode = '22023', message = 'invalid_review_status_patch';
      end if;
  end case;

  if v_task.status <> 'active' then
    if p_action = 'complete' and v_task.status = 'completed' then
      v_result := public.complete_project_task(
        p_task_id,
        p_idempotency_key,
        '{}'::jsonb
      );
      select task.updated_at, task.schedule_version
        into v_task.updated_at, v_task.schedule_version
        from public.project_tasks task
       where task.id = p_task_id;
      return v_result || jsonb_build_object(
        'ok', true,
        'conflict', false,
        'changed', false,
        'task_id', p_task_id,
        'updated_at', v_task.updated_at,
        'schedule_version', v_task.schedule_version
      );
    end if;
    if p_action = 'cancel' and v_task.status = 'cancelled' then
      return jsonb_build_object(
        'ok', true,
        'conflict', false,
        'changed', false,
        'task_id', p_task_id,
        'updated_at', v_task.updated_at,
        'schedule_version', v_task.schedule_version
      );
    end if;
    raise exception using errcode = '40001', message = 'review_task_state_changed';
  end if;

  if v_project_status not in ('accepted', 'in_progress') then
    raise exception using errcode = '40001', message = 'review_project_state_changed';
  end if;

  if v_task.updated_at is distinct from p_expected_updated_at
     or (
       p_expected_team_member_ids is not null
       and v_current_team is distinct from v_expected_team
     ) then
    return jsonb_build_object(
      'ok', false,
      'conflict', true,
      'task_id', p_task_id,
      'updated_at', v_task.updated_at,
      'schedule_version', v_task.schedule_version,
      'team_member_ids', to_jsonb(v_current_team)
    );
  end if;

  case p_action
    when 'assign' then
      v_result := private.update_task_with_event_for_actor(
        v_actor_user_id,
        p_task_id,
        p_expected_updated_at,
        v_patch
      );

    when 'schedule' then
      if v_task.start_date is not null then
        return jsonb_build_object(
          'ok', true,
          'conflict', false,
          'changed', false,
          'task_id', p_task_id,
          'updated_at', v_task.updated_at,
          'schedule_version', v_task.schedule_version,
          'already_scheduled', true
        );
      end if;
      v_result := private.update_task_with_event_for_actor(
        v_actor_user_id,
        p_task_id,
        p_expected_updated_at,
        v_patch - 'schedule_locked'
      );
      update public.project_tasks task
         set schedule_locked = (v_patch ->> 'schedule_locked')::boolean,
             updated_at = clock_timestamp()
       where task.id = p_task_id
      returning task.updated_at, task.schedule_version
        into v_task.updated_at, v_task.schedule_version;
      v_result := v_result || jsonb_build_object(
        'updated_at', v_task.updated_at,
        'schedule_version', v_task.schedule_version
      );

    when 'cancel' then
      v_result := private.update_task_with_event_for_actor(
        v_actor_user_id,
        p_task_id,
        p_expected_updated_at,
        jsonb_build_object('status', 'cancelled')
      );

    when 'complete' then
      v_result := public.complete_project_task(
        p_task_id,
        p_idempotency_key,
        '{}'::jsonb
      );
      select task.updated_at, task.schedule_version
        into v_task.updated_at, v_task.schedule_version
        from public.project_tasks task
       where task.id = p_task_id;
      v_result := v_result || jsonb_build_object(
        'ok', true,
        'conflict', false,
        'changed', true,
        'task_id', p_task_id,
        'updated_at', v_task.updated_at,
        'schedule_version', v_task.schedule_version
      );
  end case;

  return v_result;
end;
$$;

revoke all on function public.mutate_task_from_unassigned_review(
  uuid, timestamptz, text, uuid[], jsonb, text
) from public;
grant execute on function public.mutate_task_from_unassigned_review(
  uuid, timestamptz, text, uuid[], jsonb, text
) to anon, authenticated;
