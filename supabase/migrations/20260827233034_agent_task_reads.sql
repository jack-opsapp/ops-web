begin;

-- Fixed task-domain read RPCs and private projections.
do $prerequisites$
declare
  v_missing text[];
begin
  select pg_catalog.array_agg(required.object_name order by required.object_name)
  into v_missing
  from (
    values
      ('function', 'private.resolve_agent_actor_authority(uuid,uuid,text[])'),
      ('function', 'private.agent_user_can_access_entity(uuid,uuid,text,uuid,text)'),
      ('function', 'private.agent_p2_optional_canonical_text(text,integer,integer,boolean)'),
      ('function', 'private.agent_rfc3339_utc(timestamp with time zone)'),
      ('function', 'private.canonical_agent_projection_json(jsonb)'),
      ('function', 'private.mcp_oauth_labels_for_scopes(text[],text)'),
      ('table', 'private.mcp_oauth_clients'),
      ('table', 'private.mcp_oauth_grants'),
      ('table', 'private.agent_read_domain_revisions'),
      ('table', 'private.agent_operational_read_revisions'),
      ('table', 'public.companies'),
      ('table', 'public.project_tasks'),
      ('table', 'public.task_mutation_events'),
      ('table', 'public.projects'),
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
    raise exception 'agent_task_reads_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create or replace function private.agent_p2_task_uuid_from_text(
  p_value text
) returns uuid
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $function$
begin
  if p_value !~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return null;
  end if;
  return pg_catalog.lower(p_value)::uuid;
end;
$function$;

revoke all on function private.agent_p2_task_uuid_from_text(text)
  from public, anon, authenticated, service_role;

create or replace function private.agent_p2_task_date_from_text(
  p_value text
) returns date
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $function$
declare
  v_date date;
begin
  if p_value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  v_date := pg_catalog.to_date(p_value, 'YYYY-MM-DD');
  if pg_catalog.to_char(v_date, 'YYYY-MM-DD') <> p_value then
    return null;
  end if;
  return v_date;
exception
  when datetime_field_overflow or invalid_datetime_format then
    return null;
end;
$function$;

revoke all on function private.agent_p2_task_date_from_text(text)
  from public, anon, authenticated, service_role;

create or replace function private.agent_p2_task_list_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_required_oauth_scopes text[],
  p_tasks_scope text,
  p_projects_scope text,
  p_calendar_scope text,
  p_view_kind text,
  p_job_id uuid,
  p_assignee_user_id uuid,
  p_task_states text[],
  p_window_starts_at timestamptz,
  p_window_ends_before timestamptz,
  p_overdue_as_of timestamptz,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer,
  p_cursor_read_at timestamptz,
  p_cursor_source_revisions jsonb,
  p_after_order_date text,
  p_after_task_id uuid
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_expected_scopes text[];
  v_read_at timestamptz;
begin
  -- Keep infinity arithmetic out of the validation expression. PostgreSQL
  -- does not promise left-to-right short-circuit evaluation for boolean terms.
  if (p_window_starts_at is not null
        and not pg_catalog.isfinite(p_window_starts_at))
     or (p_window_ends_before is not null
        and not pg_catalog.isfinite(p_window_ends_before))
     or (p_overdue_as_of is not null
        and not pg_catalog.isfinite(p_overdue_as_of))
     or (p_cursor_read_at is not null
        and not pg_catalog.isfinite(p_cursor_read_at)) then
    raise exception 'invalid_agent_task_list_request' using errcode = '22023';
  end if;
  if (p_window_starts_at is not null and extract(
        year from p_window_starts_at at time zone 'UTC'
      ) not between 1 and 9999)
     or (p_window_ends_before is not null and extract(
       year from p_window_ends_before at time zone 'UTC'
     ) not between 1 and 9999)
     or (p_overdue_as_of is not null and extract(
       year from p_overdue_as_of at time zone 'UTC'
     ) not between 1 and 9999)
     or (p_cursor_read_at is not null and extract(
       year from p_cursor_read_at at time zone 'UTC'
     ) not between 1 and 9999) then
    raise exception 'invalid_agent_task_list_request' using errcode = '22023';
  end if;

  v_expected_scopes := case
    when p_view_kind = 'schedule_window'
      then array['ops.schedule.read', 'ops.tasks.read']::text[]
    else array['ops.tasks.read']::text[]
  end;

  if auth.role() is distinct from 'service_role'
     or p_actor_user_id is null
     or p_company_id is null
     or p_oauth_grant_id is null
     or p_oauth_client_id is null
     or p_grant_revision is null
     or p_grant_revision !~ '^[0-9a-f]{32}$'
     or p_permission_snapshot_revision is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_registered_permission_keys is null
     or p_required_oauth_scopes is distinct from v_expected_scopes
     or p_granted_scope_ceiling is null
     or not p_required_oauth_scopes <@ p_granted_scope_ceiling
     or p_tasks_scope is null
     or p_tasks_scope not in ('all', 'assigned')
     or p_projects_scope is null
     or p_projects_scope not in ('all', 'assigned')
     or (p_view_kind = 'schedule_window') is distinct from
       (p_calendar_scope is not null)
     or p_calendar_scope is not null
        and p_calendar_scope not in ('all', 'own')
     or p_view_kind is null
     or p_view_kind not in (
       'all',
       'job',
       'assignee',
       'status',
       'schedule_window',
       'overdue',
       'unassigned',
       'actionable'
     )
     or (p_view_kind = 'job') is distinct from (p_job_id is not null)
     or (p_view_kind = 'assignee') is distinct from
       (p_assignee_user_id is not null)
     or (p_view_kind = 'status') is distinct from
       (pg_catalog.cardinality(coalesce(p_task_states, array[]::text[])) > 0)
     or p_view_kind <> 'status' and pg_catalog.cardinality(
       coalesce(p_task_states, array[]::text[])
     ) <> 0
     or coalesce(p_task_states, array[]::text[])
        <@ array['active', 'cancelled', 'completed']::text[] is not true
     or (
       select pg_catalog.count(distinct requested.state)
       from pg_catalog.unnest(coalesce(p_task_states, array[]::text[]))
         requested(state)
     ) <> pg_catalog.cardinality(
       coalesce(p_task_states, array[]::text[])
     )
     or coalesce(p_task_states, array[]::text[]) is distinct from
       coalesce((
         select pg_catalog.array_agg(requested.state order by requested.state)
         from pg_catalog.unnest(coalesce(p_task_states, array[]::text[]))
           requested(state)
       ), array[]::text[])
     or (p_view_kind = 'schedule_window') is distinct from
       (p_window_starts_at is not null and p_window_ends_before is not null)
     or p_window_starts_at is not null and (
       not pg_catalog.isfinite(p_window_starts_at)
       or p_window_starts_at is distinct from pg_catalog.date_trunc(
         'milliseconds', p_window_starts_at
       )
     )
     or p_window_ends_before is not null and (
       not pg_catalog.isfinite(p_window_ends_before)
       or p_window_ends_before is distinct from pg_catalog.date_trunc(
         'milliseconds', p_window_ends_before
       )
     )
     or p_view_kind = 'schedule_window' and (
       p_window_starts_at >= p_window_ends_before
       or p_window_ends_before - p_window_starts_at > interval '90 days'
     )
     or (p_view_kind = 'overdue') is distinct from (p_overdue_as_of is not null)
     or p_overdue_as_of is not null and (
       not pg_catalog.isfinite(p_overdue_as_of)
       or p_overdue_as_of is distinct from pg_catalog.date_trunc(
         'milliseconds', p_overdue_as_of
       )
     )
     or p_item_limit is null
     or p_item_limit not between 1 and 25
     or p_page_fetch_limit is distinct from p_item_limit + 1
     or p_page_fetch_limit not between 2 and 26
     or p_source_limit is distinct from 501
     or p_cursor_source_revisions is null
     or pg_catalog.jsonb_typeof(p_cursor_source_revisions) <> 'array'
     or (p_cursor_read_at is null) is distinct from
       (p_after_task_id is null)
     or (p_after_order_date is null) is distinct from
       (p_after_task_id is null)
     or (p_cursor_read_at is null) is distinct from
       (p_cursor_source_revisions = '[]'::jsonb)
     or p_cursor_read_at is not null and (
       not pg_catalog.isfinite(p_cursor_read_at)
       or p_cursor_read_at is distinct from pg_catalog.date_trunc(
         'milliseconds', p_cursor_read_at
       )
       or p_cursor_read_at > pg_catalog.statement_timestamp()
       or p_cursor_read_at <= pg_catalog.statement_timestamp() - interval '15 minutes'
     )
     or p_after_order_date is not null
        and private.agent_p2_task_date_from_text(p_after_order_date) is null then
    raise exception 'invalid_agent_task_list_request' using errcode = '22023';
  end if;

  if not ('tasks.view' = any(p_registered_permission_keys))
     or not ('projects.view' = any(p_registered_permission_keys))
     or p_view_kind = 'schedule_window'
        and not ('calendar.view' = any(p_registered_permission_keys))
     or exists (
       select 1
       from pg_catalog.unnest(p_registered_permission_keys) key(value)
       where key.value is null
          or key.value is distinct from pg_catalog.btrim(key.value)
          or pg_catalog.octet_length(key.value) not between 1 and 128
     )
     or exists (
       select 1
       from pg_catalog.unnest(p_granted_scope_ceiling) scope(value)
       where scope.value is null
          or scope.value is distinct from pg_catalog.btrim(scope.value)
          or pg_catalog.octet_length(scope.value) not between 1 and 128
     )
     or (
       select pg_catalog.count(distinct key.value)
       from pg_catalog.unnest(p_registered_permission_keys) key(value)
     ) <> pg_catalog.cardinality(p_registered_permission_keys)
     or p_registered_permission_keys is distinct from (
       select pg_catalog.array_agg(key.value order by key.value)
       from pg_catalog.unnest(p_registered_permission_keys) key(value)
     )
     or (
       select pg_catalog.count(distinct scope.value)
       from pg_catalog.unnest(p_granted_scope_ceiling) scope(value)
     ) <> pg_catalog.cardinality(p_granted_scope_ceiling)
     or p_granted_scope_ceiling is distinct from (
       select pg_catalog.array_agg(scope.value order by scope.value)
       from pg_catalog.unnest(p_granted_scope_ceiling) scope(value)
     ) then
    raise exception 'invalid_agent_task_list_request' using errcode = '22023';
  end if;

  v_read_at := coalesce(
    p_cursor_read_at,
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp())
  );

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           pg_catalog.max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'tasks.view'
           ) as tasks_scope,
           pg_catalog.max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'projects.view'
           ) as projects_scope,
           pg_catalog.max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'calendar.view'
           ) as calendar_scope
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral pg_catalog.jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    group by authority.permission_snapshot_revision
  ), read_context as materialized (
    select task_revision.source_revision as task_revision,
           operational_revision.source_revision as operational_revision,
           authority.tasks_scope,
           authority.projects_scope,
           case when p_view_kind = 'schedule_window'
             then authority.calendar_scope
           end as calendar_scope,
           v_read_at as read_at
    from current_authority authority
    join private.mcp_oauth_grants grant_row
      on grant_row.id = p_oauth_grant_id
     and grant_row.user_id = p_actor_user_id
     and grant_row.company_id = p_company_id
     and grant_row.client_id = p_oauth_client_id
     and grant_row.revision = p_grant_revision
     and grant_row.revoked_at is null
     and grant_row.scopes = p_granted_scope_ceiling
     and p_required_oauth_scopes <@ grant_row.scopes
     and grant_row.accepted_labels =
       private.mcp_oauth_labels_for_scopes(
         grant_row.scopes,
         grant_row.consent_catalog_revision
       )
    join private.mcp_oauth_clients oauth_client
      on oauth_client.client_id = grant_row.client_id
     and oauth_client.disabled_at is null
     and grant_row.scopes <@ oauth_client.scope_ceiling
     and grant_row.consent_catalog_revision =
       oauth_client.consent_catalog_revision
     and grant_row.exposure_revision = oauth_client.exposure_revision
    join public.companies company
      on company.id = p_company_id
     and company.deleted_at is null
    join private.agent_read_domain_revisions task_revision
      on task_revision.company_id = p_company_id
     and task_revision.domain = 'tasks'
     and task_revision.source_revision between 0 and 9007199254740991
    join private.agent_operational_read_revisions operational_revision
      on operational_revision.company_id = p_company_id
     and operational_revision.source_revision between 0 and 9007199254740991
    where authority.permission_snapshot_revision = p_permission_snapshot_revision
      and authority.tasks_scope = p_tasks_scope
      and authority.projects_scope = p_projects_scope
      and (
        p_view_kind <> 'schedule_window'
        or authority.calendar_scope = p_calendar_scope
      )
  ), cursor_guard as materialized (
    select context.*,
           pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object(
               'domain', 'legacy_operational',
               'source_revision', context.operational_revision
             ),
             pg_catalog.jsonb_build_object(
               'domain', 'tasks',
               'source_revision', context.task_revision
             )
           ) as source_revisions
    from read_context context
    where p_cursor_read_at is null
       or p_cursor_source_revisions = pg_catalog.jsonb_build_array(
         pg_catalog.jsonb_build_object(
           'domain', 'legacy_operational',
           'source_revision', context.operational_revision
         ),
         pg_catalog.jsonb_build_object(
           'domain', 'tasks',
           'source_revision', context.task_revision
         )
       )
  ), task_source_gate as materialized (
    select task.id as task_id,
           task.project_id,
           task.custom_title,
           task.task_type_id,
           task.priority_rank,
           task.status,
           task.start_date,
           task.end_date,
           task.schedule_version,
           task.schedule_confirmed_at,
           task.confirmed_schedule_version,
           task.team_member_ids,
           coalesce(
             case when task.start_date is not null
                        and pg_catalog.isfinite(task.start_date)
                        and extract(
                          year from task.start_date at time zone 'UTC'
                        ) between 1 and 9999
               then (task.start_date at time zone 'UTC')::date
             end,
             date '9999-12-31'
           )
             as order_date,
           context.read_at,
           context.source_revisions,
           context.tasks_scope,
           context.projects_scope,
           context.calendar_scope
    from cursor_guard context
    join public.project_tasks task
      on task.company_id = p_company_id
     and task.deleted_at is null
    where task.status in ('active', 'cancelled', 'completed')
      and (
        p_after_task_id is null
        or (
          coalesce(
            case when task.start_date is not null
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
          private.agent_p2_task_date_from_text(p_after_order_date),
          p_after_task_id
        )
      )
    order by coalesce(
               case when task.start_date is not null
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
      and (
        p_view_kind <> 'job'
        or task.project_id = p_job_id
      )
      and (
        p_view_kind <> 'assignee'
        or p_assignee_user_id::text = any(
          coalesce(task.team_member_ids, array[]::text[])
        )
      )
      and (
        p_view_kind <> 'status'
        or task.status = any(p_task_states)
      )
      and (
        p_view_kind <> 'schedule_window'
        or (
          task.start_date is not null
          and task.start_date < p_window_ends_before
          and coalesce(task.end_date, task.start_date) >=
            p_window_starts_at
        )
      )
      and (
        p_view_kind <> 'overdue'
        or (
          task.status = 'active'
          and coalesce(task.end_date, task.start_date) <
            p_overdue_as_of
        )
      )
      and (
        p_view_kind <> 'unassigned'
        or pg_catalog.cardinality(
          coalesce(task.team_member_ids, array[]::text[])
        ) = 0
      )
      and (
        p_view_kind <> 'actionable'
        or (
          task.status = 'active'
          and (
            pg_catalog.cardinality(
              coalesce(task.team_member_ids, array[]::text[])
            ) = 0
            or coalesce(task.end_date, task.start_date) < task.read_at
            or task.start_date is not null and (
              task.schedule_confirmed_at is null
              or task.confirmed_schedule_version is distinct from
                task.schedule_version
            )
          )
        )
      )
  ), raw_source_gate as materialized (
    select task.*,
           project.title as project_title,
           task_type.display as task_type_display
    from filtered_task_source task
    cross join task_source_state task_state
    join public.projects project
      on project.id = task.project_id
     and project.company_id = p_company_id
     and project.deleted_at is null
    left join public.task_types task_type
      on task_type.id = task.task_type_id
     and task_type.company_id = p_company_id
     and task_type.deleted_at is null
    where task_state.source_count < 501
  ), raw_source_state as materialized (
    select task.source_count
    from task_source_state task
  ), authorized_source as materialized (
    select raw.*
    from raw_source_gate raw
    cross join raw_source_state raw_state
    cross join cursor_guard context
    cross join lateral (
      select raw.task_id as id
    ) task
    cross join lateral (
      select raw.project_id as id
    ) project
    where raw_state.source_count < 501
      and private.agent_user_can_access_entity(
        p_actor_user_id, p_company_id, 'task', task.id, 'view'
      )
      and private.agent_user_can_access_entity(
        p_actor_user_id, p_company_id, 'project', project.id, 'view'
      )
      and (
        context.calendar_scope is null
        or context.calendar_scope = 'all'
        or p_actor_user_id::text = any(
          coalesce(raw.team_member_ids, array[]::text[])
        )
      )
  ), source_bound as materialized (
    select raw.source_count as inspected,
           raw.source_count >= 501 as exceeded
    from raw_source_state raw
  ), authorized_source_state as materialized (
    select exists (
             select 1
             from authorized_source source
             where source.priority_rank is not null
                      and (
                        source.priority_rank::text in (
                          'NaN', 'Infinity', '-Infinity'
                        )
                        or pg_catalog.abs(source.priority_rank) >
                          9007199254740991
                      )
                or source.schedule_version is null
                or source.schedule_version not between 0 and 9007199254740991
                or source.confirmed_schedule_version is not null
                   and source.confirmed_schedule_version not between
                     0 and 9007199254740991
                or source.start_date is not null and (
                  not pg_catalog.isfinite(source.start_date)
                  or extract(
                    year from source.start_date at time zone 'UTC'
                  ) not between 1 and 9999
                )
                or source.end_date is not null and (
                  not pg_catalog.isfinite(source.end_date)
                  or extract(
                    year from source.end_date at time zone 'UTC'
                  ) not between 1 and 9999
                )
                or source.schedule_confirmed_at is not null and (
                  not pg_catalog.isfinite(source.schedule_confirmed_at)
                  or extract(
                    year from source.schedule_confirmed_at at time zone 'UTC'
                  ) not between 1 and 9999
                )
                or source.start_date is not null
                   and source.end_date is not null
                   and source.end_date < source.start_date
           ) as source_invalid
  ), page_plus_one as materialized (
    select source.*
    from authorized_source source
    cross join authorized_source_state state
    where not state.source_invalid
    order by source.order_date, source.task_id
    limit p_page_fetch_limit
  ), retained_page as materialized (
    select source.*
    from page_plus_one source
    order by source.order_date, source.task_id
    limit p_item_limit
  ), row_projection as materialized (
    select retained.*,
           title.task_title,
           title.project_title_safe,
           title.task_type_safe,
           assignment.assignees,
           assignment.declared_count as assignment_declared_count,
           assignment.resolved_count as assignment_resolved_count,
           assignment.source_invalid as assignment_source_invalid,
           assignment.source_bound as assignment_source_bound,
           pg_catalog.jsonb_build_object(
             'task_ref', pg_catalog.jsonb_build_object(
               'kind', 'task', 'id', retained.task_id
             ),
             'job_ref', pg_catalog.jsonb_build_object(
               'kind', 'project', 'id', retained.project_id
             ),
             'job_title', title.project_title_safe,
             'title', title.task_title,
             'task_type', case
               when title.task_type_safe is null then
                 pg_catalog.jsonb_build_object('state', 'not_recorded')
               else pg_catalog.jsonb_build_object(
                 'state', 'recorded',
                 'display_name', title.task_type_safe
               )
             end,
             'priority', case
               when retained.priority_rank is null then
                 pg_catalog.jsonb_build_object('state', 'not_recorded')
               else pg_catalog.jsonb_build_object(
                 'state', 'recorded',
                 'rank', retained.priority_rank
               )
             end,
             'state', retained.status,
             'schedule_summary', case
               when retained.start_date is null and retained.end_date is null then
                 pg_catalog.jsonb_build_object(
                   'state', 'unscheduled',
                   'confirmation', 'not_applicable'
                 )
               when retained.start_date is not null
                and retained.end_date is not null then
                 pg_catalog.jsonb_build_object(
                   'state', 'scheduled',
                   'starts_on', pg_catalog.to_char(
                     retained.start_date at time zone 'UTC', 'YYYY-MM-DD'
                   ),
                   'ends_on', pg_catalog.to_char(
                     retained.end_date at time zone 'UTC', 'YYYY-MM-DD'
                   ),
                   'confirmation', case
                     when retained.schedule_confirmed_at is null
                       or retained.confirmed_schedule_version is null
                       then 'unconfirmed'
                     when retained.confirmed_schedule_version =
                       retained.schedule_version then 'current'
                     else 'stale'
                   end
                 )
               else pg_catalog.jsonb_build_object(
                 'state', 'partial',
                 'starts_on', case when retained.start_date is null then null
                   else pg_catalog.to_char(
                     retained.start_date at time zone 'UTC', 'YYYY-MM-DD'
                   ) end,
                 'ends_on', case when retained.end_date is null then null
                   else pg_catalog.to_char(
                     retained.end_date at time zone 'UTC', 'YYYY-MM-DD'
                   ) end,
                 'confirmation', case
                   when retained.schedule_confirmed_at is null
                     or retained.confirmed_schedule_version is null
                     then 'unconfirmed'
                   when retained.confirmed_schedule_version =
                     retained.schedule_version then 'current'
                   else 'stale'
                 end
               )
             end,
             'assignees', assignment.assignees,
             'content_kind', 'untrusted_business_data'
           ) as item
    from retained_page retained
    cross join lateral (
      select private.agent_p2_optional_canonical_text(
               coalesce(
                 nullif(pg_catalog.btrim(retained.custom_title), ''),
                 nullif(pg_catalog.btrim(retained.task_type_display), ''),
                 'Task'
               ),
               256, 1024, false
             ) as task_title,
             private.agent_p2_optional_canonical_text(
               retained.project_title,
               256, 1024, false
             ) as project_title_safe,
             private.agent_p2_optional_canonical_text(
               retained.task_type_display,
               256, 1024, false
             ) as task_type_safe
    ) title
    cross join lateral (
      select coalesce(
               pg_catalog.jsonb_agg(member_projection.member order by member_projection.member_id)
                 filter (where member_projection.member_id is not null),
               '[]'::jsonb
             ) as assignees,
             pg_catalog.count(distinct declared.member_id_text)::integer
               as declared_count,
             pg_catalog.count(declared.member_id_text)::integer
               as physical_count,
             pg_catalog.count(distinct member_projection.member_id)::integer
               as resolved_count,
             coalesce(pg_catalog.bool_or(
               declared.member_id_text is not null and
               private.agent_p2_task_uuid_from_text(declared.member_id_text)
                 is null
             ), false)
             or pg_catalog.count(declared.member_id_text) <>
                pg_catalog.count(distinct declared.member_id_text)
               as source_invalid,
             pg_catalog.count(declared.member_id_text) >= p_source_limit
             or pg_catalog.count(distinct declared.member_id_text) > 25
               as source_bound
      from (
        select assignment.member_id_text
        from pg_catalog.unnest(
          coalesce(retained.team_member_ids, array[]::text[])
        ) assignment(member_id_text)
        limit p_source_limit
      ) declared
      left join lateral (
        select member.id as member_id,
               pg_catalog.jsonb_build_object(
                 'team_member_ref', pg_catalog.jsonb_build_object(
                   'kind', 'team_member', 'id', member.id
                 ),
                 'display_name', private.agent_p2_optional_canonical_text(
                   pg_catalog.concat_ws(' ', member.first_name, member.last_name),
                   256, 1024, false
                 ),
                 'content_kind', 'untrusted_business_data'
               ) as member
        from public.users member
        where member.id =
                private.agent_p2_task_uuid_from_text(declared.member_id_text)
          and member.company_id = p_company_id
          and member.deleted_at is null
          and member.is_active is true
          and private.agent_p2_optional_canonical_text(
            pg_catalog.concat_ws(' ', member.first_name, member.last_name),
            256, 1024, false
          ) is not null
      ) member_projection on true
    ) assignment
  ), validated_page as materialized (
    select page.*,
           state.source_invalid or exists (
             select 1
             from row_projection row
             where row.task_title is null
                or row.project_title_safe is null
                or row.task_type_id is not null
                   and row.task_type_display is not null
                   and row.task_type_safe is null
                or row.priority_rank is not null and (
                  row.priority_rank::text in ('NaN', 'Infinity', '-Infinity')
                  or pg_catalog.abs(row.priority_rank) > 9007199254740991
                )
                or row.status not in ('active', 'cancelled', 'completed')
                or row.schedule_version not between 0 and 9007199254740991
                or row.confirmed_schedule_version is not null
                   and row.confirmed_schedule_version not between
                     0 and 9007199254740991
                or row.start_date is not null
                   and not pg_catalog.isfinite(row.start_date)
                or row.end_date is not null
                   and not pg_catalog.isfinite(row.end_date)
                or row.schedule_confirmed_at is not null
                   and not pg_catalog.isfinite(row.schedule_confirmed_at)
                or row.start_date is not null
                   and row.end_date is not null
                   and row.end_date < row.start_date
                or coalesce(row.assignment_source_invalid, false)
                or row.assignment_declared_count <> row.assignment_resolved_count
           ) as source_invalid,
           exists (
             select 1 from row_projection row
             where coalesce(row.assignment_source_bound, false)
           ) as nested_source_bound
    from source_bound page
    cross join authorized_source_state state
  ), proof_context as materialized (
    select pg_catalog.jsonb_build_object(
             'company_id', p_company_id,
             'actor_user_id', p_actor_user_id,
             'oauth_grant_id', p_oauth_grant_id,
             'oauth_client_id', p_oauth_client_id,
             'grant_revision', p_grant_revision,
             'granted_scope_ceiling',
               pg_catalog.to_jsonb(p_granted_scope_ceiling),
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'capability_id', 'list_tasks',
             'capability_revision', 'list_tasks:2026-08-22.v1',
             'capability_manifest_revision',
               '2026-08-22.capability-manifest.v8',
             'ranking_revision', 'task-ranking:2026-08-22.v1',
             'required_oauth_scopes',
               pg_catalog.to_jsonb(p_required_oauth_scopes),
             'tasks_scope', p_tasks_scope,
             'projects_scope', p_projects_scope,
             'calendar_scope', p_calendar_scope,
             'estimates_scope', null,
             'project_financials_scope', null,
             'view', case p_view_kind
               when 'job' then pg_catalog.jsonb_build_object(
                 'kind', 'job',
                 'job_ref', pg_catalog.jsonb_build_object(
                   'kind', 'project', 'id', p_job_id
                 )
               )
               when 'assignee' then pg_catalog.jsonb_build_object(
                 'kind', 'assignee',
                 'assignee_ref', pg_catalog.jsonb_build_object(
                   'kind', 'team_member', 'id', p_assignee_user_id
                 )
               )
               when 'status' then pg_catalog.jsonb_build_object(
                 'kind', 'status', 'states', pg_catalog.to_jsonb(p_task_states)
               )
               when 'schedule_window' then pg_catalog.jsonb_build_object(
                 'kind', 'schedule_window',
                 'starts_at', private.agent_rfc3339_utc(p_window_starts_at),
                 'ends_before', private.agent_rfc3339_utc(p_window_ends_before)
               )
               when 'overdue' then pg_catalog.jsonb_build_object(
                 'kind', 'overdue',
                 'as_of', private.agent_rfc3339_utc(p_overdue_as_of)
               )
               else pg_catalog.jsonb_build_object('kind', p_view_kind)
             end,
             'item_limit', p_item_limit,
             'cursor_read_at', case when p_cursor_read_at is null then null
               else private.agent_rfc3339_utc(p_cursor_read_at)
             end,
             'cursor_source_revisions', p_cursor_source_revisions,
             'cursor_predecessor', case when p_after_task_id is null then null
               else pg_catalog.jsonb_build_object(
                 'order', pg_catalog.jsonb_build_array(
                   p_after_order_date, p_after_task_id
                 ),
                 'tie_breaker', p_after_task_id
               )
             end,
             'read_at', private.agent_rfc3339_utc(context.read_at),
             'source_revisions', context.source_revisions,
             'source_inspected', validation.inspected,
             'source_has_more', exists (
               select 1 from page_plus_one page offset p_item_limit limit 1
             )
           ) as value
    from cursor_guard context
    cross join validated_page validation
  ), packaged_rows as materialized (
    select row.item,
           row.order_date,
           row.task_id,
           row.priority_rank::text as priority_rank_proof_text,
           'ops_proof:v1:' || pg_catalog.encode(
             extensions.digest(
               pg_catalog.convert_to(
                 private.canonical_agent_projection_json(
                   context.value || pg_catalog.jsonb_build_object(
                     'proof_kind', 'task_list_entity',
                     'task', row.item || pg_catalog.jsonb_build_object(
                       'priority', case when row.priority_rank is null
                         then pg_catalog.jsonb_build_object(
                           'state', 'not_recorded'
                         )
                         else pg_catalog.jsonb_build_object(
                           'state', 'recorded',
                           'rank', row.priority_rank::text
                         )
                       end
                     )
                   )
                 ),
                 'UTF8'
               ),
               'sha256'
             ),
             'hex'
           ) as proof_ref,
           'ops_evidence:v1:' || pg_catalog.encode(
             extensions.digest(
               pg_catalog.convert_to(
                 private.canonical_agent_projection_json(
                   context.value || pg_catalog.jsonb_build_object(
                     'proof_kind', 'task_list_evidence',
                     'task_ref', pg_catalog.jsonb_build_object(
                       'kind', 'task', 'id', row.task_id
                     )
                   )
                 ),
                 'UTF8'
               ),
               'sha256'
             ),
             'hex'
           ) as evidence_ref
    from row_projection row
    cross join proof_context context
  ), aggregate_rows as materialized (
    select coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'item', row.item,
                 'priority_rank_proof_text', row.priority_rank_proof_text,
                 'proof_ref', row.proof_ref,
                 'evidence_ref', row.evidence_ref,
                 'predecessor', pg_catalog.jsonb_build_object(
                   'order', pg_catalog.jsonb_build_array(
                     pg_catalog.to_char(row.order_date, 'YYYY-MM-DD'),
                     row.task_id
                   ),
                   'tie_breaker', row.task_id
                 )
               ) order by row.order_date, row.task_id
             ),
             '[]'::jsonb
           ) as rows
    from packaged_rows row
  ), collection_proof_input as materialized (
    select context.value || pg_catalog.jsonb_build_object(
             'proof_kind', 'task_list_collection',
             'returned_count', pg_catalog.count(row.task_id)::integer,
             'has_more', (context.value ->> 'source_has_more')::boolean,
             'children', coalesce(
               pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'task_ref', pg_catalog.jsonb_build_object(
                     'kind', 'task', 'id', row.task_id
                   ),
                   'proof_ref', row.proof_ref,
                   'evidence_ref', row.evidence_ref
                 ) order by row.order_date, row.task_id
               ) filter (where row.task_id is not null),
               '[]'::jsonb
             )
           ) as value
    from proof_context context
    left join packaged_rows row on true
    group by context.value
  ), final_projection as materialized (
    select pg_catalog.jsonb_build_object(
             'company_id', p_company_id,
             'actor_user_id', p_actor_user_id,
             'oauth_grant_id', p_oauth_grant_id,
             'oauth_client_id', p_oauth_client_id,
             'grant_revision', p_grant_revision,
             'granted_scope_ceiling',
               pg_catalog.to_jsonb(p_granted_scope_ceiling),
             'permission_snapshot_revision', p_permission_snapshot_revision,
             'capability_id', 'list_tasks',
             'capability_revision', 'list_tasks:2026-08-22.v1',
             'capability_manifest_revision',
               '2026-08-22.capability-manifest.v8',
             'required_oauth_scopes', pg_catalog.to_jsonb(p_required_oauth_scopes),
             'tasks_scope', p_tasks_scope,
             'projects_scope', p_projects_scope,
             'calendar_scope', p_calendar_scope,
             'estimates_scope', null,
             'project_financials_scope', null,
             'view', case p_view_kind
               when 'job' then pg_catalog.jsonb_build_object(
                 'kind', 'job',
                 'job_ref', pg_catalog.jsonb_build_object(
                   'kind', 'project', 'id', p_job_id
                 )
               )
               when 'assignee' then pg_catalog.jsonb_build_object(
                 'kind', 'assignee',
                 'assignee_ref', pg_catalog.jsonb_build_object(
                   'kind', 'team_member', 'id', p_assignee_user_id
                 )
               )
               when 'status' then pg_catalog.jsonb_build_object(
                 'kind', 'status', 'states', pg_catalog.to_jsonb(p_task_states)
               )
               when 'schedule_window' then pg_catalog.jsonb_build_object(
                 'kind', 'schedule_window',
                 'starts_at', private.agent_rfc3339_utc(p_window_starts_at),
                 'ends_before', private.agent_rfc3339_utc(p_window_ends_before)
               )
               when 'overdue' then pg_catalog.jsonb_build_object(
                 'kind', 'overdue',
                 'as_of', private.agent_rfc3339_utc(p_overdue_as_of)
               )
               else pg_catalog.jsonb_build_object('kind', p_view_kind)
             end,
             'item_limit', p_item_limit,
             'cursor_read_at', case when p_cursor_read_at is null then null
               else private.agent_rfc3339_utc(p_cursor_read_at) end,
             'cursor_source_revisions', p_cursor_source_revisions,
             'cursor_predecessor', case when p_after_task_id is null then null
               else pg_catalog.jsonb_build_object(
                 'order', pg_catalog.jsonb_build_array(
                   p_after_order_date, p_after_task_id
                 ),
                 'tie_breaker', p_after_task_id
               ) end,
             'read_at', private.agent_rfc3339_utc(context.read_at),
             'source_revisions', context.source_revisions,
             'source_inspected', validation.inspected,
             'source_has_more', exists (
               select 1 from page_plus_one page offset p_item_limit limit 1
             ),
             'rows', aggregate.rows,
             'collection_proof_ref', 'ops_proof:v1:' || pg_catalog.encode(
               extensions.digest(
                 pg_catalog.convert_to(
                 private.canonical_agent_projection_json(
                   proof.value
                 ),
                   'UTF8'
                 ),
                 'sha256'
               ),
               'hex'
             ),
             '_source_bound', validation.exceeded,
             '_nested_source_bound', validation.nested_source_bound,
             '_source_invalid', validation.source_invalid
           ) as projection
    from cursor_guard context
    cross join validated_page validation
    cross join aggregate_rows aggregate
    cross join collection_proof_input proof
  )
  select projection into v_result from final_projection;

  if v_result is null then
    if p_cursor_read_at is not null then
      raise exception 'agent_task_read_stale' using errcode = '40001';
    end if;
    raise exception 'agent_task_not_authorized' using errcode = '42501';
  end if;
  if (v_result ->> '_source_bound')::boolean
     or (v_result ->> '_nested_source_bound')::boolean then
    raise exception 'agent_task_source_query_bound' using errcode = '54000';
  end if;
  if (v_result ->> '_source_invalid')::boolean then
    raise exception 'agent_task_source_data_invalid' using errcode = '22000';
  end if;
  return v_result - array[
    '_source_bound', '_nested_source_bound', '_source_invalid'
  ];
end;
$function$;

revoke all on function private.agent_p2_task_list_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,
  uuid,uuid,text[],timestamp with time zone,timestamp with time zone,
  timestamp with time zone,integer,integer,integer,timestamp with time zone,
  jsonb,text,uuid
) from public, anon, authenticated, service_role;

create or replace function private.agent_p2_task_context_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_required_oauth_scopes text[],
  p_tasks_scope text,
  p_projects_scope text,
  p_calendar_scope text,
  p_estimates_scope text,
  p_project_financials_scope text,
  p_task_id uuid,
  p_sections text[],
  p_source_limit integer,
  p_dependency_limit integer,
  p_assignee_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_expected_scopes text[] := array['ops.tasks.read']::text[];
  v_read_at timestamptz := pg_catalog.date_trunc(
    'milliseconds', pg_catalog.statement_timestamp()
  );
begin
  if 'financial_origin' = any(p_sections) then
    v_expected_scopes := pg_catalog.array_append(
      v_expected_scopes,
      'ops.financial_documents.read'
    );
  end if;
  if 'schedule' = any(p_sections) then
    v_expected_scopes := pg_catalog.array_append(
      v_expected_scopes,
      'ops.schedule.read'
    );
  end if;
  select pg_catalog.array_agg(scope order by scope)
    into v_expected_scopes
  from pg_catalog.unnest(v_expected_scopes) scope;

  if auth.role() is distinct from 'service_role'
     or p_actor_user_id is null
     or p_company_id is null
     or p_oauth_grant_id is null
     or p_oauth_client_id is null
     or p_grant_revision is null
     or p_grant_revision !~ '^[0-9a-f]{32}$'
     or p_permission_snapshot_revision is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_registered_permission_keys is null
     or p_required_oauth_scopes is distinct from v_expected_scopes
     or p_granted_scope_ceiling is null
     or not p_required_oauth_scopes <@ p_granted_scope_ceiling
     or p_tasks_scope is null
     or p_tasks_scope not in ('all', 'assigned')
     or p_projects_scope is null
     or p_projects_scope not in ('all', 'assigned')
     or p_task_id is null
     or p_sections is null
     or pg_catalog.cardinality(p_sections) not between 1 and 6
     or p_sections <@ array[
       'dependencies',
       'evidence_state',
       'financial_origin',
       'material_readiness',
       'notes',
       'schedule'
     ]::text[] is not true
     or (
       select pg_catalog.count(distinct section.value)
       from pg_catalog.unnest(p_sections) section(value)
     ) <> pg_catalog.cardinality(p_sections)
     or p_sections is distinct from (
       select pg_catalog.array_agg(section.value order by section.value)
       from pg_catalog.unnest(p_sections) section(value)
     )
     or ('schedule' = any(p_sections)) is distinct from
       (p_calendar_scope is not null)
     or p_calendar_scope is not null
        and p_calendar_scope not in ('all', 'own')
     or ('financial_origin' = any(p_sections)) is distinct from
       (p_estimates_scope is not null)
     or ('financial_origin' = any(p_sections)) is distinct from
       (p_project_financials_scope is not null)
     or p_estimates_scope is not null
        and p_estimates_scope not in ('all', 'assigned')
     or p_project_financials_scope is not null
        and p_project_financials_scope <> 'all'
     or p_source_limit is distinct from 501
     or p_dependency_limit is distinct from 25
     or p_assignee_limit is distinct from 25 then
    raise exception 'invalid_agent_task_context_request' using errcode = '22023';
  end if;

  if not ('tasks.view' = any(p_registered_permission_keys))
     or not ('projects.view' = any(p_registered_permission_keys))
     or 'schedule' = any(p_sections)
        and not ('calendar.view' = any(p_registered_permission_keys))
     or 'financial_origin' = any(p_sections) and (
       not ('estimates.view' = any(p_registered_permission_keys))
       or not ('projects.view_financials' = any(p_registered_permission_keys))
     )
     or exists (
       select 1
       from pg_catalog.unnest(p_registered_permission_keys) key(value)
       where key.value is null
          or key.value is distinct from pg_catalog.btrim(key.value)
          or pg_catalog.octet_length(key.value) not between 1 and 128
     )
     or exists (
       select 1
       from pg_catalog.unnest(p_granted_scope_ceiling) scope(value)
       where scope.value is null
          or scope.value is distinct from pg_catalog.btrim(scope.value)
          or pg_catalog.octet_length(scope.value) not between 1 and 128
     )
     or (
       select pg_catalog.count(distinct key.value)
       from pg_catalog.unnest(p_registered_permission_keys) key(value)
     ) <> pg_catalog.cardinality(p_registered_permission_keys)
     or p_registered_permission_keys is distinct from (
       select pg_catalog.array_agg(key.value order by key.value)
       from pg_catalog.unnest(p_registered_permission_keys) key(value)
     )
     or (
       select pg_catalog.count(distinct scope.value)
       from pg_catalog.unnest(p_granted_scope_ceiling) scope(value)
     ) <> pg_catalog.cardinality(p_granted_scope_ceiling)
     or p_granted_scope_ceiling is distinct from (
       select pg_catalog.array_agg(scope.value order by scope.value)
       from pg_catalog.unnest(p_granted_scope_ceiling) scope(value)
     ) then
    raise exception 'invalid_agent_task_context_request' using errcode = '22023';
  end if;

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           pg_catalog.max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'tasks.view'
           ) as tasks_scope,
           pg_catalog.max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'projects.view'
           ) as projects_scope,
           pg_catalog.max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'calendar.view'
           ) as calendar_scope,
           pg_catalog.max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'estimates.view'
           ) as estimates_scope,
           pg_catalog.max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' =
               'projects.view_financials'
           ) as project_financials_scope
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral pg_catalog.jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    group by authority.permission_snapshot_revision
  ), read_context as materialized (
    select task_revision.source_revision as task_revision,
           operational_revision.source_revision as operational_revision,
           authority.tasks_scope,
           authority.projects_scope,
           case when 'schedule' = any(p_sections)
             then authority.calendar_scope
           end as calendar_scope,
           case when 'financial_origin' = any(p_sections)
             then authority.estimates_scope
           end as estimates_scope,
           case when 'financial_origin' = any(p_sections)
             then authority.project_financials_scope
           end as project_financials_scope,
           v_read_at as read_at,
           pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object(
               'domain', 'legacy_operational',
               'source_revision', operational_revision.source_revision
             ),
             pg_catalog.jsonb_build_object(
               'domain', 'tasks',
               'source_revision', task_revision.source_revision
             )
           ) as source_revisions
    from current_authority authority
    join private.mcp_oauth_grants grant_row
      on grant_row.id = p_oauth_grant_id
     and grant_row.user_id = p_actor_user_id
     and grant_row.company_id = p_company_id
     and grant_row.client_id = p_oauth_client_id
     and grant_row.revision = p_grant_revision
     and grant_row.revoked_at is null
     and grant_row.scopes = p_granted_scope_ceiling
     and p_required_oauth_scopes <@ grant_row.scopes
     and grant_row.accepted_labels =
       private.mcp_oauth_labels_for_scopes(
         grant_row.scopes,
         grant_row.consent_catalog_revision
       )
    join private.mcp_oauth_clients oauth_client
      on oauth_client.client_id = grant_row.client_id
     and oauth_client.disabled_at is null
     and grant_row.scopes <@ oauth_client.scope_ceiling
     and grant_row.consent_catalog_revision =
       oauth_client.consent_catalog_revision
     and grant_row.exposure_revision = oauth_client.exposure_revision
    join public.companies company
      on company.id = p_company_id
     and company.deleted_at is null
    join private.agent_read_domain_revisions task_revision
      on task_revision.company_id = p_company_id
     and task_revision.domain = 'tasks'
     and task_revision.source_revision between 0 and 9007199254740991
    join private.agent_operational_read_revisions operational_revision
      on operational_revision.company_id = p_company_id
     and operational_revision.source_revision between 0 and 9007199254740991
    where authority.permission_snapshot_revision = p_permission_snapshot_revision
      and authority.tasks_scope = p_tasks_scope
      and authority.projects_scope = p_projects_scope
      and (
        not ('schedule' = any(p_sections))
        or authority.calendar_scope = p_calendar_scope
      )
      and (
        not ('financial_origin' = any(p_sections))
        or (
          authority.estimates_scope = p_estimates_scope
          and authority.project_financials_scope = p_project_financials_scope
        )
      )
  ), selected_task_source as materialized (
    select task.id,
           task.company_id,
           task.project_id,
           task.task_type_id,
           task.custom_title,
           task.priority_rank,
           task.status,
           task.start_date,
           task.end_date,
           task.all_day,
           task.schedule_version,
           task.schedule_confirmed_at,
           task.confirmed_schedule_version,
           task.team_member_ids,
           case when 'notes' = any(p_sections)
             then task.task_notes
           end as task_notes,
           case when 'financial_origin' = any(p_sections)
             then task.source_estimate_id
           end as source_estimate_id,
           case when 'financial_origin' = any(p_sections)
             then task.source_line_item_id
           end as source_line_item_id,
           project.title as project_title,
           task_type.display as task_type_display,
           task.dependency_overrides,
           task_type.dependencies as task_type_dependencies,
           context.read_at,
           context.source_revisions,
           context.tasks_scope,
           context.projects_scope,
           context.calendar_scope,
           context.estimates_scope,
           context.project_financials_scope
    from read_context context
    join public.project_tasks task
      on task.id = p_task_id
     and task.company_id = p_company_id
     and task.deleted_at is null
    join public.projects project
      on project.id = task.project_id
     and project.company_id = p_company_id
     and project.deleted_at is null
    left join public.task_types task_type
      on task_type.id = task.task_type_id
     and task_type.company_id = p_company_id
     and task_type.deleted_at is null
    where task.status in ('active', 'cancelled', 'completed')
      and private.agent_user_can_access_entity(
        p_actor_user_id, p_company_id, 'task', task.id, 'view'
      )
      and private.agent_user_can_access_entity(
        p_actor_user_id, p_company_id, 'project', project.id, 'view'
      )
      and (
        context.calendar_scope is null
        or context.calendar_scope = 'all'
        or p_actor_user_id::text = any(
          coalesce(task.team_member_ids, array[]::text[])
        )
      )
      and (
        context.project_financials_scope is null
        or context.project_financials_scope = 'all'
      )
  ), financial_origin as materialized (
    select case
      when selected.source_estimate_id is null
       and selected.source_line_item_id is null then
        pg_catalog.jsonb_build_object('state', 'manual')
      when selected.source_estimate_id ~*
             '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       and selected.source_line_item_id ~*
             '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       and estimate.id is not null
       and (
         estimate.project_ref = selected.project_id
         or estimate.project_ref is null
            and canonical.canonical_project_id = selected.project_id
       )
       and not canonical.project_conflict
       and line_item.id is not null then
        pg_catalog.jsonb_build_object(
          'state', 'estimate_line',
          'estimate_ref', pg_catalog.jsonb_build_object(
            'kind', 'estimate', 'id', estimate.id
          ),
          'line_item_ref', pg_catalog.jsonb_build_object(
            'kind', 'estimate_line_item', 'id', line_item.id
          )
        )
      else pg_catalog.jsonb_build_object('state', 'source_invalid')
    end as value,
    case
      when selected.source_estimate_id is null
       and selected.source_line_item_id is null then true
      when selected.estimates_scope = 'all' then true
      when selected.estimates_scope = 'assigned'
       and estimate.id is not null
       and canonical.canonical_project_id is not null
       and exists (
         select 1
         from public.project_tasks estimate_assignment
         join public.projects estimate_project
           on estimate_project.id = canonical.canonical_project_id
          and estimate_project.company_id = p_company_id
          and estimate_project.deleted_at is null
         where estimate_assignment.company_id = p_company_id
           and estimate_assignment.project_id = canonical.canonical_project_id
           and estimate_assignment.deleted_at is null
           and p_actor_user_id::text = any(coalesce(
             estimate_assignment.team_member_ids,
             array[]::text[]
           ))
       ) then true
      else false
    end as authorized
    from selected_task_source selected
    left join public.estimates estimate
      on selected.source_estimate_id ~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     and estimate.id =
       private.agent_p2_task_uuid_from_text(selected.source_estimate_id)
     and estimate.company_id = p_company_id
     and estimate.deleted_at is null
    left join lateral (
      select coalesce(
               estimate.project_ref,
               private.agent_p2_task_uuid_from_text(estimate.project_id)
             ) as canonical_project_id,
             coalesce(
               estimate.project_ref is not null
               and private.agent_p2_task_uuid_from_text(estimate.project_id)
                 is not null
               and private.agent_p2_task_uuid_from_text(estimate.project_id)
                 is distinct from estimate.project_ref,
               false
             ) as project_conflict
    ) canonical on true
    left join public.line_items line_item
      on selected.source_line_item_id ~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     and line_item.id =
       private.agent_p2_task_uuid_from_text(selected.source_line_item_id)
     and line_item.company_id = p_company_id
     and line_item.estimate_id = estimate.id
    where 'financial_origin' = any(p_sections)
  ), selected_task as materialized (
    select selected.*,
           origin.value as financial_origin
    from selected_task_source selected
    left join financial_origin origin on true
    where not ('financial_origin' = any(p_sections))
       or coalesce(origin.authorized, false)
  ), assignment_source as materialized (
    select selected.id as task_id,
           declared.member_id_text,
           private.agent_p2_task_uuid_from_text(declared.member_id_text)
             as member_id
    from selected_task selected
    left join lateral pg_catalog.unnest(
      coalesce(selected.team_member_ids, array[]::text[])
    ) declared(member_id_text) on true
    limit p_source_limit
  ), assignment_projection as materialized (
    select pg_catalog.count(distinct source.member_id_text)::integer
             as source_count,
           pg_catalog.count(source.member_id_text)::integer
             as physical_count,
           pg_catalog.count(distinct member.id)::integer as resolved_count,
           coalesce(pg_catalog.bool_or(
             source.member_id_text is not null and source.member_id is null
           ), false)
           or pg_catalog.count(source.member_id_text) <>
              pg_catalog.count(distinct source.member_id_text)
             as source_invalid,
           coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'team_member_ref', pg_catalog.jsonb_build_object(
                   'kind', 'team_member', 'id', member.id
                 ),
                 'display_name', private.agent_p2_optional_canonical_text(
                   pg_catalog.concat_ws(' ', member.first_name, member.last_name),
                   256, 1024, false
                 ),
                 'content_kind', 'untrusted_business_data'
               ) order by member.id
             ) filter (where member.id is not null),
             '[]'::jsonb
           ) as assignees
    from assignment_source source
    left join public.users member
      on member.id = source.member_id
     and member.company_id = p_company_id
     and member.deleted_at is null
     and member.is_active is true
     and private.agent_p2_optional_canonical_text(
       pg_catalog.concat_ws(' ', member.first_name, member.last_name),
       256, 1024, false
     ) is not null
  ), dependency_definition_source as materialized (
    select dependency.value,
           dependency.ordinality
    from selected_task selected
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(
        case
          when pg_catalog.jsonb_typeof(selected.dependency_overrides) = 'array'
            then selected.dependency_overrides
        end,
        case
          when pg_catalog.jsonb_typeof(selected.task_type_dependencies) = 'array'
            then selected.task_type_dependencies
        end,
        '[]'::jsonb
      )
    ) with ordinality dependency(value, ordinality)
    where 'dependencies' = any(p_sections)
    limit p_source_limit
  ), dependency_definition as materialized (
    select definition.*,
           definition.value ->> 'depends_on_task_type_id' as dependency_type_text,
           private.agent_p2_task_uuid_from_text(
             definition.value ->> 'depends_on_task_type_id'
           ) as dependency_type_id
    from dependency_definition_source definition
  ), dependency_task_source_gate as materialized (
    -- idx_project_tasks_agent_dependency_gate_v1 is the physical gate for
    -- company/project/task-type probes. LIMIT executes before title joins,
    -- authority helpers, deduplication, or presentation ordering.
    select predecessor.id,
           predecessor.status,
           predecessor.task_type_id,
           predecessor.team_member_ids,
           predecessor.custom_title,
           selected.project_id
    from selected_task selected
    join dependency_definition dependency on true
    join lateral (
      select candidate.id,
             candidate.status,
             candidate.task_type_id,
             candidate.team_member_ids,
             candidate.custom_title
      from public.project_tasks candidate
      where candidate.company_id = p_company_id
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
    ) <= p_dependency_limit
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
           raw.status,
           raw.task_type_id,
           private.agent_p2_optional_canonical_text(
             coalesce(
               nullif(pg_catalog.btrim(raw.custom_title), ''),
               nullif(pg_catalog.btrim(predecessor_type.display), ''),
               'Task'
             ),
             256, 1024, false
           ) as title
    from dependency_task_source_guard raw
    left join public.task_types predecessor_type
      on predecessor_type.id = raw.task_type_id
     and predecessor_type.company_id = p_company_id
     and predecessor_type.deleted_at is null
    where private.agent_user_can_access_entity(
        p_actor_user_id, p_company_id, 'task', raw.id, 'view'
      )
      and private.agent_user_can_access_entity(
        p_actor_user_id, p_company_id, 'project', raw.project_id, 'view'
      )
  ), dependency_projection as materialized (
    select pg_catalog.count(*)::integer as source_count,
           (
             select raw.source_count
             from dependency_task_source_state raw
           ) as raw_source_count,
           (
             select pg_catalog.count(*)::integer
             from dependency_definition_source
           ) as definition_source_count,
           pg_catalog.count(*) filter (where source.status <> 'completed')::integer
             as incomplete_count,
           coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'task_ref', pg_catalog.jsonb_build_object(
                   'kind', 'task', 'id', source.id
                 ),
                 'title', source.title,
                 'state', source.status,
                 'content_kind', 'untrusted_business_data'
               ) order by source.id
             ),
             '[]'::jsonb
           ) as dependencies,
           exists (
             select 1 from dependency_definition definition
             where definition.dependency_type_id is null
                or pg_catalog.jsonb_typeof(definition.value) <> 'object'
           ) or (
             select pg_catalog.count(*)
             from dependency_definition
           ) <> (
             select pg_catalog.count(distinct definition.dependency_type_id)
             from dependency_definition definition
           ) or exists (
             select 1 from dependency_task_source source
             where source.title is null
                or source.status not in ('active', 'completed')
           ) or exists (
             select 1 from dependency_definition definition
             where not exists (
               select 1 from dependency_task_source source
               where source.task_type_id = definition.dependency_type_id
             )
           ) as source_invalid
    from dependency_task_source source
  ), task_evidence_source_gate as materialized (
    select event.event_sequence,
           event.company_id,
           event.project_id,
           event.event_type,
           selected.project_id as expected_project_id
    from selected_task selected
    join public.task_mutation_events event
      on event.task_id = selected.id
    where 'evidence_state' = any(p_sections)
    order by event.event_sequence
    limit p_source_limit
  ), task_evidence_source_state as materialized (
    select pg_catalog.count(*)::integer as raw_source_count
    from task_evidence_source_gate
  ), task_evidence_source as materialized (
    select event.event_sequence
    from task_evidence_source_gate event
    cross join task_evidence_source_state raw_state
    where raw_state.raw_source_count < p_source_limit
      and event.company_id = p_company_id
      and event.project_id = event.expected_project_id
      and event.event_type = 'task_completed'
  ), task_evidence_projection as materialized (
    select pg_catalog.count(*)::integer as evidence_count,
           (
             select raw.raw_source_count
             from task_evidence_source_state raw
           ) as raw_source_count,
           exists (
             select 1
             from task_evidence_source_gate event
             where event.company_id is distinct from p_company_id
                or event.project_id is distinct from event.expected_project_id
           ) as source_invalid
    from task_evidence_source
  ), material_source_gate as materialized (
    -- idx_task_materials_agent_task_gate_v1 keeps this physical task lookup
    -- ordered and bounded before catalog or inventory joins.
    select material.id,
           material.quantity,
           material.source,
           material.catalog_variant_id,
           material.inventory_item_id
    from selected_task selected
    join public.task_materials material on material.task_id = selected.id
    where 'material_readiness' = any(p_sections)
    order by material.id
    limit p_source_limit
  ), material_source_state as materialized (
    select pg_catalog.count(*)::integer as raw_source_count
    from material_source_gate
  ), material_source_guard as materialized (
    select material.*
    from material_source_gate material
    cross join material_source_state raw_state
    where raw_state.raw_source_count < p_source_limit
  ), material_source as materialized (
    select material.id,
           material.quantity,
           material.source,
           material.catalog_variant_id,
           material.inventory_item_id,
           coalesce(
             material.catalog_variant_id,
             material.inventory_item_id
           ) as requested_variant_id,
           variant.id as resolved_variant_id,
           variant.quantity as available_quantity,
           inventory.inventory_mode
    from material_source_guard material
    left join public.catalog_variants variant
      on variant.id = coalesce(
       material.catalog_variant_id,
       material.inventory_item_id
     )
     and variant.company_id = p_company_id
     and variant.deleted_at is null
     and variant.is_active is true
    left join public.company_inventory_settings inventory
      on inventory.company_id = p_company_id
  ), material_projection as materialized (
    select (
             select raw.raw_source_count
             from material_source_state raw
           ) as raw_source_count,
           pg_catalog.count(*) filter (
             where source.source = 'stock'
           )::integer as required_count,
           pg_catalog.count(*) filter (
             where source.source = 'stock'
               and source.inventory_mode = 'tracked'
               and source.resolved_variant_id is not null
               and source.quantity > 0
               and source.available_quantity >= 0
               and source.available_quantity < source.quantity
           )::integer as shortage_count,
           pg_catalog.count(*) filter (
             where source.source is null
                or source.source not in ('stock', 'order')
                or source.quantity is null
                or source.quantity <= 0
                or source.quantity::text in ('NaN', 'Infinity', '-Infinity')
                or source.requested_variant_id is null
                or source.catalog_variant_id is not null
                   and source.inventory_item_id is not null
                   and source.catalog_variant_id is distinct from
                     source.inventory_item_id
                or source.resolved_variant_id is null
                or source.available_quantity is null
                or source.available_quantity < 0
                or source.available_quantity::text in (
                  'NaN', 'Infinity', '-Infinity'
                )
           )::integer as invalid_count,
           coalesce(
             pg_catalog.max(source.inventory_mode),
             (
               select inventory.inventory_mode
               from public.company_inventory_settings inventory
               where inventory.company_id = p_company_id
             ),
             'off'
           ) as inventory_mode
    from material_source source
  ), base_projection as materialized (
    select selected.*,
           private.agent_p2_optional_canonical_text(
             coalesce(
               nullif(pg_catalog.btrim(selected.custom_title), ''),
               nullif(pg_catalog.btrim(selected.task_type_display), ''),
               'Task'
             ),
             256, 1024, false
           ) as task_title,
           private.agent_p2_optional_canonical_text(
             selected.project_title,
             256, 1024, false
           ) as project_title_safe,
           private.agent_p2_optional_canonical_text(
             selected.task_type_display,
             256, 1024, false
           ) as task_type_safe,
           assignment.assignees,
           assignment.source_count as assignee_source_count,
           assignment.physical_count as assignee_physical_source_count,
           assignment.resolved_count as assignee_resolved_count,
           coalesce(assignment.source_invalid, false)
             as assignee_source_invalid,
           dependency.source_count as dependency_source_count,
           dependency.raw_source_count as dependency_raw_source_count,
           dependency.definition_source_count
             as dependency_definition_source_count,
           dependency.incomplete_count as dependency_incomplete_count,
           dependency.dependencies,
           coalesce(dependency.source_invalid, false)
             as dependency_source_invalid,
           evidence.evidence_count as task_evidence_count,
           evidence.raw_source_count as task_evidence_raw_source_count,
           coalesce(evidence.source_invalid, false)
             as task_evidence_source_invalid,
           material.raw_source_count as material_raw_source_count,
           material.required_count as material_required_count,
           material.shortage_count as material_shortage_count,
           material.invalid_count as material_invalid_count,
           material.inventory_mode,
           material.raw_source_count >= p_source_limit
             as material_source_bound
    from selected_task selected
    cross join assignment_projection assignment
    cross join dependency_projection dependency
    cross join task_evidence_projection evidence
    cross join material_projection material
  ), public_task as materialized (
    select base.*,
           pg_catalog.jsonb_build_object(
             'task_ref', pg_catalog.jsonb_build_object(
               'kind', 'task', 'id', base.id
             ),
             'job_ref', pg_catalog.jsonb_build_object(
               'kind', 'project', 'id', base.project_id
             ),
             'job_title', base.project_title_safe,
             'title', base.task_title,
             'task_type', case when base.task_type_safe is null
               then pg_catalog.jsonb_build_object('state', 'not_recorded')
               else pg_catalog.jsonb_build_object(
                 'state', 'recorded',
                 'display_name', base.task_type_safe
               ) end,
             'priority', case when base.priority_rank is null
               then pg_catalog.jsonb_build_object('state', 'not_recorded')
               else pg_catalog.jsonb_build_object(
                 'state', 'recorded', 'rank', base.priority_rank
               ) end,
             'state', base.status,
             'schedule_summary', case
               when base.start_date is null and base.end_date is null then
                 pg_catalog.jsonb_build_object(
                   'state', 'unscheduled',
                   'confirmation', 'not_applicable'
                 )
               when base.start_date is not null and base.end_date is not null then
                 pg_catalog.jsonb_build_object(
                   'state', 'scheduled',
                   'starts_on', case
                     when pg_catalog.isfinite(base.start_date)
                      and extract(
                        year from base.start_date at time zone 'UTC'
                      ) between 1 and 9999 then pg_catalog.to_char(
                       base.start_date at time zone 'UTC', 'YYYY-MM-DD'
                     )
                   end,
                   'ends_on', case
                     when pg_catalog.isfinite(base.end_date)
                      and extract(
                        year from base.end_date at time zone 'UTC'
                      ) between 1 and 9999 then pg_catalog.to_char(
                       base.end_date at time zone 'UTC', 'YYYY-MM-DD'
                     )
                   end,
                   'confirmation', case
                     when base.schedule_confirmed_at is null
                       or base.confirmed_schedule_version is null
                       then 'unconfirmed'
                     when base.confirmed_schedule_version = base.schedule_version
                       then 'current'
                     else 'stale'
                   end
                 )
               else pg_catalog.jsonb_build_object(
                 'state', 'partial',
                 'starts_on', case
                   when base.start_date is not null
                    and pg_catalog.isfinite(base.start_date)
                    and extract(
                      year from base.start_date at time zone 'UTC'
                    ) between 1 and 9999 then pg_catalog.to_char(
                     base.start_date at time zone 'UTC', 'YYYY-MM-DD'
                   )
                 end,
                 'ends_on', case
                   when base.end_date is not null
                    and pg_catalog.isfinite(base.end_date)
                    and extract(
                      year from base.end_date at time zone 'UTC'
                    ) between 1 and 9999 then pg_catalog.to_char(
                     base.end_date at time zone 'UTC', 'YYYY-MM-DD'
                   )
                 end,
                 'confirmation', case
                   when base.schedule_confirmed_at is null
                     or base.confirmed_schedule_version is null
                     then 'unconfirmed'
                   when base.confirmed_schedule_version = base.schedule_version
                     then 'current'
                   else 'stale'
                 end
               ) end,
             'assignees', base.assignees,
             'content_kind', 'untrusted_business_data'
           ) as item
    from base_projection base
  ), section_projection as materialized (
    select task.*,
           pg_catalog.jsonb_build_object(
             'dependencies', case when 'dependencies' = any(p_sections) then
               pg_catalog.jsonb_build_object(
                 'state', case
                   when task.dependency_source_invalid then 'source_invalid'
                   when task.dependency_source_count = 0 then 'no_dependencies'
                   when task.dependency_incomplete_count = 0 then 'ready'
                   else 'blocked'
                 end,
                 'source_count', task.dependency_source_count,
                 'dependencies', task.dependencies
               ) end,
             'evidence_state', case when 'evidence_state' = any(p_sections)
               then case when task.task_evidence_count = 0
                 then pg_catalog.jsonb_build_object('state', 'not_recorded')
                 else pg_catalog.jsonb_build_object(
                   'state', 'recorded',
                   'evidence_count', task.task_evidence_count
                 )
               end
             end,
             'material_readiness', case
               when 'material_readiness' = any(p_sections) then
                 pg_catalog.jsonb_build_object(
                   'state', case
                     when task.material_invalid_count > 0 then 'source_invalid'
                     when task.inventory_mode <> 'tracked' then 'not_tracked'
                    when task.material_required_count = 0 then 'not_required'
                     when task.material_shortage_count > 0 then 'shortage'
                     else 'ready'
                   end,
                   'required_line_count', task.material_required_count,
                   'shortage_line_count', task.material_shortage_count,
                   'invalid_line_count', task.material_invalid_count
                 ) end,
             'schedule', case when 'schedule' = any(p_sections) then
               pg_catalog.jsonb_build_object(
                 'state', case
                   when task.start_date is null and task.end_date is null
                     then 'unscheduled'
                   when task.start_date is not null and task.end_date is not null
                     then 'scheduled'
                   else 'partial'
                 end,
                 'starts_at', case
                   when task.start_date is not null
                    and pg_catalog.isfinite(task.start_date)
                    and extract(
                      year from task.start_date at time zone 'UTC'
                    ) between 1 and 9999
                     then private.agent_rfc3339_utc(task.start_date)
                 end,
                 'ends_at', case
                   when task.end_date is not null
                    and pg_catalog.isfinite(task.end_date)
                    and extract(
                      year from task.end_date at time zone 'UTC'
                    ) between 1 and 9999
                     then private.agent_rfc3339_utc(task.end_date)
                 end,
                 'all_day', case
                   when (task.start_date is null) <> (task.end_date is null)
                     then false
                   else coalesce(task.all_day, false)
                 end,
                 'schedule_version', task.schedule_version,
                 'confirmation', case
                   when task.schedule_confirmed_at is null
                     or task.confirmed_schedule_version is null
                     then 'unconfirmed'
                   when task.confirmed_schedule_version = task.schedule_version
                     then 'current'
                   else 'stale'
                 end,
                 'confirmed_schedule_version', task.confirmed_schedule_version,
                 'confirmed_at', case
                   when task.schedule_confirmed_at is not null
                    and pg_catalog.isfinite(task.schedule_confirmed_at)
                    and extract(
                      year from task.schedule_confirmed_at at time zone 'UTC'
                    ) between 1 and 9999
                     then private.agent_rfc3339_utc(
                       task.schedule_confirmed_at
                     )
                 end
               ) end,
             'notes', case when 'notes' = any(p_sections) then
               case when nullif(pg_catalog.btrim(task.task_notes), '')
                    is null then pg_catalog.jsonb_build_object(
                 'state', 'not_recorded'
               ) else pg_catalog.jsonb_build_object(
                 'state', 'recorded',
                 'text', private.agent_p2_optional_canonical_text(
                   substring(
                     pg_catalog.btrim(task.task_notes) from 1 for 2000
                   ),
                   2000, 8000, true
                 ),
                 'truncated', pg_catalog.char_length(
                   pg_catalog.btrim(task.task_notes)
                 ) > 2000,
                 'content_kind', 'untrusted_business_data'
               ) end
             end,
             'financial_origin', case
               when 'financial_origin' = any(p_sections)
                 then task.financial_origin
             end
           ) - array(
             select section_name
             from pg_catalog.unnest(array[
               'dependencies',
               'evidence_state',
               'financial_origin',
               'material_readiness',
               'notes',
               'schedule'
             ]::text[]) section_name
             where not section_name = any(p_sections)
           ) as sections,
           pg_catalog.jsonb_path_query_array(pg_catalog.jsonb_build_array(
             case when task.dependency_incomplete_count > 0
               then 'DEPENDENCY_INCOMPLETE' end,
             case when task.material_shortage_count > 0
               then 'MATERIAL_SHORTAGE' end,
             case when task.material_invalid_count > 0
               then 'MATERIAL_SOURCE_INVALID' end,
             case when task.start_date is not null and (
               task.schedule_confirmed_at is null
               or task.confirmed_schedule_version is distinct from
                 task.schedule_version
             ) then 'SCHEDULE_UNCONFIRMED' end,
             case when task.assignee_source_count = 0
               then 'UNASSIGNED' end
           ), '$[*] ? (@ != null)') as blocker_codes
    from public_task task
  ), validated as materialized (
    select section.*,
           section.assignee_source_count >= p_source_limit
             or section.assignee_physical_source_count >= p_source_limit
             or section.dependency_raw_source_count >= p_source_limit
             or section.dependency_definition_source_count >= p_source_limit
             or section.dependency_definition_source_count > p_dependency_limit
             or section.task_evidence_raw_source_count >= p_source_limit
             or section.material_source_bound
             or section.assignee_source_count > p_assignee_limit
             or section.dependency_source_count > p_dependency_limit
               as source_bound,
           section.task_title is null
             or section.project_title_safe is null
             or section.task_type_id is not null
                and section.task_type_display is not null
                and section.task_type_safe is null
             or section.assignee_source_invalid
             or section.assignee_source_count <> section.assignee_resolved_count
             or section.task_evidence_source_invalid
             or section.priority_rank is not null and (
               section.priority_rank::text in (
                 'NaN', 'Infinity', '-Infinity'
               )
               or pg_catalog.abs(section.priority_rank) > 9007199254740991
             )
             or section.status not in ('active', 'cancelled', 'completed')
             or section.schedule_version is null
             or section.schedule_version not between 0 and 9007199254740991
             or section.confirmed_schedule_version is not null
                and section.confirmed_schedule_version not between
                  0 and 9007199254740991
             or section.start_date is not null and (
               not pg_catalog.isfinite(section.start_date)
               or extract(
                 year from section.start_date at time zone 'UTC'
               ) not between 1 and 9999
             )
             or section.end_date is not null and (
               not pg_catalog.isfinite(section.end_date)
               or extract(
                 year from section.end_date at time zone 'UTC'
               ) not between 1 and 9999
             )
             or section.schedule_confirmed_at is not null and (
               not pg_catalog.isfinite(section.schedule_confirmed_at)
               or extract(
                 year from section.schedule_confirmed_at at time zone 'UTC'
               ) not between 1 and 9999
             )
             or section.start_date is not null
                and section.end_date is not null
                and section.end_date < section.start_date
             or 'notes' = any(p_sections)
                and nullif(pg_catalog.btrim(section.task_notes), '')
                  is not null
                and section.sections #>> '{notes,text}' is null
             or 'dependencies' = any(p_sections)
                and pg_catalog.jsonb_typeof(section.dependency_overrides)
                  is distinct from 'array'
                and section.task_type_dependencies is not null
                and pg_catalog.jsonb_typeof(section.task_type_dependencies)
                  <> 'array'
             or section.inventory_mode not in ('off', 'tracked')
               as source_invalid
    from section_projection section
  ), proof_context as materialized (
    select pg_catalog.jsonb_build_object(
             'company_id', p_company_id,
             'actor_user_id', p_actor_user_id,
             'oauth_grant_id', p_oauth_grant_id,
             'oauth_client_id', p_oauth_client_id,
             'grant_revision', p_grant_revision,
             'granted_scope_ceiling',
               pg_catalog.to_jsonb(p_granted_scope_ceiling),
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'capability_id', 'get_task_context',
             'capability_revision', 'get_task_context:2026-08-22.v1',
             'capability_manifest_revision',
               '2026-08-22.capability-manifest.v8',
             'required_oauth_scopes',
               pg_catalog.to_jsonb(p_required_oauth_scopes),
             'tasks_scope', p_tasks_scope,
             'projects_scope', p_projects_scope,
             'calendar_scope', p_calendar_scope,
             'estimates_scope', p_estimates_scope,
             'project_financials_scope', p_project_financials_scope,
             'task_ref', pg_catalog.jsonb_build_object(
               'kind', 'task', 'id', validated.id
             ),
             'selected_sections', pg_catalog.to_jsonb(p_sections),
             'read_at', private.agent_rfc3339_utc(validated.read_at),
             'source_revisions', validated.source_revisions,
             'source_inspected', pg_catalog.jsonb_build_object(
               'assignees', validated.assignee_physical_source_count,
               'dependencies', greatest(
                 validated.dependency_raw_source_count,
                 validated.dependency_definition_source_count
               ),
               'task_evidence', validated.task_evidence_raw_source_count,
               'materials', validated.material_raw_source_count
             )
           ) as value
    from validated
  ), proof_projection as materialized (
    select validated.*,
           pg_catalog.jsonb_build_object(
             'task', validated.item,
             'blocker_codes', validated.blocker_codes,
             'sections', validated.sections
           ) as public_result,
           validated.priority_rank::text as priority_rank_proof_text,
           'ops_proof:v1:' || pg_catalog.encode(
             extensions.digest(
               pg_catalog.convert_to(
                 private.canonical_agent_projection_json(
                   context.value || pg_catalog.jsonb_build_object(
                     'proof_kind', 'task_context_entity',
                     'result', pg_catalog.jsonb_build_object(
                       'task', validated.item ||
                         pg_catalog.jsonb_build_object(
                           'priority', case
                             when validated.priority_rank is null then
                               pg_catalog.jsonb_build_object(
                                 'state', 'not_recorded'
                               )
                             else pg_catalog.jsonb_build_object(
                               'state', 'recorded',
                               'rank', validated.priority_rank::text
                             )
                           end
                         ),
                       'blocker_codes', validated.blocker_codes,
                       'sections', validated.sections
                     )
                   )
                 ),
                 'UTF8'
               ),
               'sha256'
             ),
             'hex'
           ) as proof_ref,
           'ops_evidence:v1:' || pg_catalog.encode(
             extensions.digest(
               pg_catalog.convert_to(
                 private.canonical_agent_projection_json(
                   context.value || pg_catalog.jsonb_build_object(
                     'proof_kind', 'task_context_evidence'
                   )
                 ),
                 'UTF8'
               ),
               'sha256'
             ),
             'hex'
           ) as evidence_ref
    from validated
    cross join proof_context context
  )
  select pg_catalog.jsonb_build_object(
           'company_id', p_company_id,
           'actor_user_id', p_actor_user_id,
           'oauth_grant_id', p_oauth_grant_id,
           'oauth_client_id', p_oauth_client_id,
           'grant_revision', p_grant_revision,
           'granted_scope_ceiling',
             pg_catalog.to_jsonb(p_granted_scope_ceiling),
           'permission_snapshot_revision', p_permission_snapshot_revision,
           'capability_id', 'get_task_context',
           'capability_revision', 'get_task_context:2026-08-22.v1',
           'capability_manifest_revision',
             '2026-08-22.capability-manifest.v8',
           'required_oauth_scopes', pg_catalog.to_jsonb(p_required_oauth_scopes),
           'tasks_scope', p_tasks_scope,
           'projects_scope', p_projects_scope,
           'calendar_scope', p_calendar_scope,
           'estimates_scope', p_estimates_scope,
           'project_financials_scope', p_project_financials_scope,
           'task_ref', pg_catalog.jsonb_build_object(
             'kind', 'task', 'id', projection.id
           ),
           'selected_sections', pg_catalog.to_jsonb(p_sections),
           'read_at', private.agent_rfc3339_utc(projection.read_at),
           'source_revisions', projection.source_revisions,
           'source_inspected', pg_catalog.jsonb_build_object(
             'assignees', projection.assignee_physical_source_count,
             'dependencies', greatest(
               projection.dependency_raw_source_count,
               projection.dependency_definition_source_count
             ),
             'task_evidence', projection.task_evidence_raw_source_count,
             'materials', projection.material_raw_source_count
           ),
           'result', projection.public_result,
           'priority_rank_proof_text',
             projection.priority_rank_proof_text,
           'proof_ref', projection.proof_ref,
           'evidence_ref', projection.evidence_ref,
           '_source_bound', projection.source_bound,
           '_source_invalid', projection.source_invalid
         )
    into v_result
  from proof_projection projection;

  if v_result is null then
    raise exception 'agent_task_not_found_or_not_visible' using errcode = 'P0002';
  end if;
  if (v_result ->> '_source_bound')::boolean then
    raise exception 'agent_task_source_query_bound' using errcode = '54000';
  end if;
  if (v_result ->> '_source_invalid')::boolean then
    raise exception 'agent_task_source_data_invalid' using errcode = '22000';
  end if;
  return v_result - array['_source_bound', '_source_invalid'];
end;
$function$;

revoke all on function private.agent_p2_task_context_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,text,
  uuid,text[],integer,integer,integer
) from public, anon, authenticated, service_role;

create or replace function private.agent_p2_task_attention_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_tasks_scope text,
  p_projects_scope text,
  p_read_at timestamptz,
  p_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if p_read_at is not null and not pg_catalog.isfinite(p_read_at) then
    raise exception 'invalid_agent_p2_task_attention_request'
      using errcode = '22023';
  end if;
  if p_read_at is not null and extract(
       year from p_read_at at time zone 'UTC'
     ) not between 1 and 9999 then
    raise exception 'invalid_agent_p2_task_attention_request'
      using errcode = '22023';
  end if;

  if auth.role() is distinct from 'service_role'
     or p_actor_user_id is null
     or p_company_id is null
     or p_permission_snapshot_revision is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_registered_permission_keys is null
     or p_tasks_scope is null
     or p_tasks_scope not in ('all', 'assigned')
     or p_projects_scope is null
     or p_projects_scope not in ('all', 'assigned')
     or p_read_at is null
     or not pg_catalog.isfinite(p_read_at)
     or p_read_at is distinct from pg_catalog.date_trunc(
       'milliseconds', pg_catalog.statement_timestamp()
     )
     or p_limit is null
     or p_limit not between 1 and 25
     or not ('tasks.view' = any(p_registered_permission_keys))
     or not ('projects.view' = any(p_registered_permission_keys))
     or exists (
       select 1
       from pg_catalog.unnest(p_registered_permission_keys) key(value)
       where key.value is null
          or key.value is distinct from pg_catalog.btrim(key.value)
          or pg_catalog.octet_length(key.value) not between 1 and 128
     )
     or (
       select pg_catalog.count(distinct key.value)
       from pg_catalog.unnest(p_registered_permission_keys) key(value)
     ) <> pg_catalog.cardinality(p_registered_permission_keys)
     or p_registered_permission_keys is distinct from (
       select pg_catalog.array_agg(key.value order by key.value)
       from pg_catalog.unnest(p_registered_permission_keys) key(value)
     ) then
    raise exception 'invalid_agent_p2_task_attention_request'
      using errcode = '22023';
  end if;

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           pg_catalog.max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'tasks.view'
           ) as tasks_scope,
           pg_catalog.max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'projects.view'
           ) as projects_scope
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral pg_catalog.jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    group by authority.permission_snapshot_revision
  ), read_context as materialized (
    select task_revision.source_revision as task_revision,
           operational_revision.source_revision as operational_revision,
           authority.tasks_scope,
           authority.projects_scope
    from current_authority authority
    join public.companies company
      on company.id = p_company_id
     and company.deleted_at is null
    join private.agent_read_domain_revisions task_revision
      on task_revision.company_id = p_company_id
     and task_revision.domain = 'tasks'
     and task_revision.source_revision between 0 and 9007199254740991
    join private.agent_operational_read_revisions operational_revision
      on operational_revision.company_id = p_company_id
     and operational_revision.source_revision between 0 and 9007199254740991
    where authority.permission_snapshot_revision =
            p_permission_snapshot_revision
      and authority.tasks_scope = p_tasks_scope
      and authority.projects_scope = p_projects_scope
  ), raw_source_gate as materialized (
    -- idx_project_tasks_agent_attention_gate_v1 provides the deterministic
    -- 501-row physical ceiling before project/type joins or attention filters.
    select task.id,
           task.project_id,
           task.task_type_id,
           task.custom_title,
           task.team_member_ids,
           task.start_date,
           task.end_date,
           task.schedule_version,
           task.schedule_confirmed_at,
           task.confirmed_schedule_version,
           context.task_revision,
           context.operational_revision,
           context.tasks_scope,
           context.projects_scope
    from read_context context
    join public.project_tasks task
      on task.company_id = p_company_id
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
           raw.project_id,
           raw.custom_title,
           task_type.display as task_type_display,
           raw.team_member_ids,
           case
             when coalesce(raw.end_date, raw.start_date) < p_read_at
               then 'overdue'
             when pg_catalog.cardinality(
               coalesce(raw.team_member_ids, array[]::text[])
             ) = 0 then 'unassigned'
             else 'confirmation_required'
           end as reason_code,
           case
             when coalesce(raw.end_date, raw.start_date) < p_read_at
               then coalesce(raw.end_date, raw.start_date)
             when pg_catalog.cardinality(
               coalesce(raw.team_member_ids, array[]::text[])
             ) = 0 then p_read_at
             else raw.start_date
           end as attention_at,
           raw.task_revision,
           raw.operational_revision,
           raw.tasks_scope,
           raw.projects_scope
    from raw_source_guard raw
    join public.projects project
      on project.id = raw.project_id
     and project.company_id = p_company_id
     and project.deleted_at is null
    left join public.task_types task_type
      on task_type.id = raw.task_type_id
     and task_type.company_id = p_company_id
     and task_type.deleted_at is null
    where (
        pg_catalog.cardinality(
          coalesce(raw.team_member_ids, array[]::text[])
        ) = 0
        or coalesce(raw.end_date, raw.start_date) < p_read_at
        or raw.start_date is not null and (
          raw.schedule_confirmed_at is null
          or raw.confirmed_schedule_version is distinct from
            raw.schedule_version
        )
      )
  ), authorized_source as materialized (
    select raw.id,
           raw.project_id,
           private.agent_p2_optional_canonical_text(
             coalesce(
               nullif(pg_catalog.btrim(raw.custom_title), ''),
               nullif(pg_catalog.btrim(raw.task_type_display), ''),
               'Task'
             ),
             256, 1024, false
           ) as title,
           raw.reason_code,
           raw.attention_at,
           raw.task_revision,
           raw.operational_revision
    from attention_source raw
    where private.agent_user_can_access_entity(
        p_actor_user_id, p_company_id, 'task', raw.id, 'view'
      )
      and private.agent_user_can_access_entity(
        p_actor_user_id, p_company_id, 'project', raw.project_id, 'view'
      )
  ), bounded_source as materialized (
    select source.*,
           pg_catalog.row_number() over (
             order by source.attention_at, source.id
           ) as ordinality
    from authorized_source source
    where source.attention_at is not null
      and pg_catalog.isfinite(source.attention_at)
      and extract(
        year from source.attention_at at time zone 'UTC'
      ) between 1 and 9999
    order by source.attention_at, source.id
    limit least(p_limit + 1, 26)
  ), aggregated as materialized (
    select pg_catalog.count(*)::integer as fetched_count,
           coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'card_kind', 'task',
                 'task_ref', pg_catalog.jsonb_build_object(
                   'kind', 'task', 'id', source.id
                 ),
                 'job_ref', pg_catalog.jsonb_build_object(
                   'kind', 'project', 'id', source.project_id
                 ),
                 'title', source.title,
                 'reason_code', source.reason_code,
                 'attention_at', private.agent_rfc3339_utc(
                   pg_catalog.date_trunc('milliseconds', source.attention_at)
                 ),
                 'content_kind', 'untrusted_business_data'
               ) order by source.attention_at, source.id
             ) filter (where source.ordinality <= p_limit),
             '[]'::jsonb
           ) as cards,
           pg_catalog.count(*) > p_limit as has_more
    from bounded_source source
  ), final_projection as materialized (
    select pg_catalog.jsonb_build_object(
             'projection_revision', 'agent-p2-task-attention:v1',
             'read_at', private.agent_rfc3339_utc(p_read_at),
             'source_versions', pg_catalog.jsonb_build_array(
               pg_catalog.jsonb_build_object(
                 'source_domain', 'operations',
                 'source_type', 'operational_read_revision',
                 'source_id', 'private.agent_operational_read_revisions',
                 'version', 'revision:' || context.operational_revision::text
               ),
               pg_catalog.jsonb_build_object(
                 'source_domain', 'tasks',
                 'source_type', 'task_read_revision',
                 'source_id', 'private.agent_read_domain_revisions:tasks',
                 'version', 'revision:' || context.task_revision::text
               )
             ),
             'source_inspected_count', raw_state.source_count,
             'returned_count', pg_catalog.jsonb_array_length(attention.cards),
             'has_more', attention.has_more,
             'cards', attention.cards,
             '_source_bound', raw_state.source_count >= 501,
             '_source_invalid', exists (
               select 1 from authorized_source source
               where source.title is null
                  or source.attention_at is null
                  or not pg_catalog.isfinite(source.attention_at)
                  or extract(
                    year from source.attention_at at time zone 'UTC'
                  ) not between 1 and 9999
             )
           ) as projection
    from read_context context
    cross join raw_source_state raw_state
    cross join aggregated attention
  )
  select projection into v_result from final_projection;

  if v_result is null then
    raise exception 'agent_p2_task_attention_unauthorized'
      using errcode = '42501';
  end if;
  if (v_result ->> '_source_bound')::boolean then
    raise exception 'agent_p2_task_attention_source_bound'
      using errcode = '54000';
  end if;
  if (v_result ->> '_source_invalid')::boolean then
    raise exception 'agent_p2_task_attention_source_data_invalid'
      using errcode = '22000';
  end if;
  return v_result - array['_source_bound', '_source_invalid'];
end;
$function$;

revoke all on function private.agent_p2_task_attention_v1(
  uuid,uuid,text,text[],text,text,timestamp with time zone,integer
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_tasks_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_tasks_scope text,
  p_projects_scope text,
  p_calendar_scope text,
  p_estimates_scope text,
  p_project_financials_scope text,
  p_view_kind text,
  p_job_id uuid,
  p_assignee_user_id uuid,
  p_task_states text[],
  p_window_starts_at timestamptz,
  p_window_ends_before timestamptz,
  p_overdue_as_of timestamptz,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer,
  p_cursor_read_at timestamptz,
  p_cursor_source_revisions jsonb,
  p_after_order_date text,
  p_after_task_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_request_id is null
     or p_request_id is distinct from pg_catalog.btrim(p_request_id)
     or pg_catalog.octet_length(p_request_id) not between 1 and 256
     or p_actor_user_id is null
     or p_company_id is null
     or p_oauth_grant_id is null
     or p_oauth_client_id is null
     or p_capability_id is distinct from 'list_tasks'
     or p_capability_revision is distinct from 'list_tasks:2026-08-22.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-22.capability-manifest.v8'
     or p_estimates_scope is not null
     or p_project_financials_scope is not null then
    raise exception 'invalid_agent_task_list_request' using errcode = '22023';
  end if;

  return private.agent_p2_task_list_v1(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_required_oauth_scopes,
    p_tasks_scope,
    p_projects_scope,
    p_calendar_scope,
    p_view_kind,
    p_job_id,
    p_assignee_user_id,
    p_task_states,
    p_window_starts_at,
    p_window_ends_before,
    p_overdue_as_of,
    p_item_limit,
    p_page_fetch_limit,
    p_source_limit,
    p_cursor_read_at,
    p_cursor_source_revisions,
    p_after_order_date,
    p_after_task_id
  );
end;
$function$;

revoke all on function public.read_agent_tasks_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,
  text,text,text,text,text,uuid,uuid,text[],timestamp with time zone,
  timestamp with time zone,timestamp with time zone,integer,integer,integer,
  timestamp with time zone,jsonb,text,uuid
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_tasks_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,
  text,text,text,text,text,uuid,uuid,text[],timestamp with time zone,
  timestamp with time zone,timestamp with time zone,integer,integer,integer,
  timestamp with time zone,jsonb,text,uuid
) to service_role;

create or replace function public.read_agent_task_context_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_tasks_scope text,
  p_projects_scope text,
  p_calendar_scope text,
  p_estimates_scope text,
  p_project_financials_scope text,
  p_task_id uuid,
  p_sections text[],
  p_source_limit integer,
  p_dependency_limit integer,
  p_assignee_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_request_id is null
     or p_request_id is distinct from pg_catalog.btrim(p_request_id)
     or pg_catalog.octet_length(p_request_id) not between 1 and 256
     or p_actor_user_id is null
     or p_company_id is null
     or p_oauth_grant_id is null
     or p_oauth_client_id is null
     or p_capability_id is distinct from 'get_task_context'
     or p_capability_revision is distinct from
       'get_task_context:2026-08-22.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-22.capability-manifest.v8' then
    raise exception 'invalid_agent_task_context_request' using errcode = '22023';
  end if;

  return private.agent_p2_task_context_v1(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_required_oauth_scopes,
    p_tasks_scope,
    p_projects_scope,
    p_calendar_scope,
    p_estimates_scope,
    p_project_financials_scope,
    p_task_id,
    p_sections,
    p_source_limit,
    p_dependency_limit,
    p_assignee_limit
  );
end;
$function$;

revoke all on function public.read_agent_task_context_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,
  text,text,text,text,uuid,text[],integer,integer,integer
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_task_context_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,
  text,text,text,text,uuid,text[],integer,integer,integer
) to service_role;

alter function private.agent_p2_task_uuid_from_text(text)
  owner to current_user;
alter function private.agent_p2_task_date_from_text(text)
  owner to current_user;
alter function private.agent_p2_task_list_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,uuid,
  uuid,text[],timestamp with time zone,timestamp with time zone,
  timestamp with time zone,integer,integer,integer,timestamp with time zone,
  jsonb,text,uuid
) owner to current_user;
alter function private.agent_p2_task_context_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,text,
  uuid,text[],integer,integer,integer
) owner to current_user;
alter function private.agent_p2_task_attention_v1(
  uuid,uuid,text,text[],text,text,timestamp with time zone,integer
) owner to current_user;
alter function public.read_agent_tasks_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,
  text,text,text,text,text,uuid,uuid,text[],timestamp with time zone,
  timestamp with time zone,timestamp with time zone,integer,integer,integer,
  timestamp with time zone,jsonb,text,uuid
) owner to current_user;
alter function public.read_agent_task_context_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,
  text,text,text,text,uuid,text[],integer,integer,integer
) owner to current_user;

do $canonical_acl$
declare
  v_signature text;
  v_function_oid oid;
  v_acl record;
begin
  foreach v_signature in array array[
    'private.agent_p2_task_uuid_from_text(text)',
    'private.agent_p2_task_date_from_text(text)',
    'private.agent_p2_task_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,uuid,uuid,text[],timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)',
    'private.agent_p2_task_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,text,uuid,text[],integer,integer,integer)',
    'private.agent_p2_task_attention_v1(uuid,uuid,text,text[],text,text,timestamp with time zone,integer)',
    'public.read_agent_tasks_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,text,text,uuid,uuid,text[],timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)',
    'public.read_agent_task_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,text,uuid,text[],integer,integer,integer)'
  ]::text[] loop
    v_function_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    if v_function_oid is null then
      raise exception 'agent_task_acl_function_missing:%', v_signature;
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
        raise exception 'agent_task_acl_role_missing:%', v_signature;
      end if;
      execute pg_catalog.format(
        'revoke all privileges on function %s from %s',
        v_signature,
        case when v_acl.grantee = 0 then 'public'
          else pg_catalog.quote_ident(v_acl.role_name) end
      );
    end loop;
  end loop;
end;
$canonical_acl$;

grant execute on function public.read_agent_tasks_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,
  text,text,text,text,text,uuid,uuid,text[],timestamp with time zone,
  timestamp with time zone,timestamp with time zone,integer,integer,integer,
  timestamp with time zone,jsonb,text,uuid
) to service_role;
grant execute on function public.read_agent_task_context_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,
  text,text,text,text,uuid,text[],integer,integer,integer
) to service_role;

do $postflight$
declare
  expected record;
  v_function_oid oid;
  v_actual_result text;
  v_function_acl aclitem[];
  v_function_owner oid;
  v_acl_entries text[];
  v_expected_acl text[];
  v_actual_signatures text[];
begin
  select coalesce(
           pg_catalog.array_agg(
             namespace.nspname || '.' || function_row.proname || '(' ||
             pg_catalog.replace(
               pg_catalog.oidvectortypes(function_row.proargtypes),
               ', ',
               ','
             ) || ')'
             order by namespace.nspname, function_row.proname,
               function_row.oid
           ),
           array[]::text[]
         )
    into v_actual_signatures
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace namespace
    on namespace.oid = function_row.pronamespace
  where (
    namespace.nspname = 'private'
    and function_row.proname in (
      'agent_p2_task_attention_v1',
      'agent_p2_task_context_v1',
      'agent_p2_task_date_from_text',
      'agent_p2_task_list_v1',
      'agent_p2_task_uuid_from_text'
    )
  ) or (
    namespace.nspname = 'public'
    and function_row.proname in (
      'read_agent_task_context_as_system',
      'read_agent_tasks_as_system'
    )
  );

  if v_actual_signatures is distinct from array[
    'private.agent_p2_task_attention_v1(uuid,uuid,text,text[],text,text,timestamp with time zone,integer)',
    'private.agent_p2_task_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,text,uuid,text[],integer,integer,integer)',
    'private.agent_p2_task_date_from_text(text)',
    'private.agent_p2_task_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,uuid,uuid,text[],timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)',
    'private.agent_p2_task_uuid_from_text(text)',
    'public.read_agent_task_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,text,uuid,text[],integer,integer,integer)',
    'public.read_agent_tasks_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,text,text,uuid,uuid,text[],timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)'
  ]::text[] then
    raise exception 'agent_task_function_signature_set_failed';
  end if;

  for expected in
    select *
    from (values
      (
        'private.agent_p2_task_uuid_from_text(text)',
        true,
        's',
        false,
        'i',
        'uuid',
        false
      ),
      (
        'private.agent_p2_task_date_from_text(text)',
        true,
        's',
        false,
        'i',
        'date',
        false
      ),
      (
        'private.agent_p2_task_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,uuid,uuid,text[],timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)',
        false,
        'u',
        false,
        's',
        'jsonb',
        false
      ),
      (
        'private.agent_p2_task_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,text,uuid,text[],integer,integer,integer)',
        false,
        'u',
        false,
        's',
        'jsonb',
        false
      ),
      (
        'private.agent_p2_task_attention_v1(uuid,uuid,text,text[],text,text,timestamp with time zone,integer)',
        false,
        'u',
        false,
        's',
        'jsonb',
        false
      ),
      (
        'public.read_agent_tasks_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,text,text,uuid,uuid,text[],timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)',
        false,
        'u',
        true,
        's',
        'jsonb',
        true
      ),
      (
        'public.read_agent_task_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,text,uuid,text[],integer,integer,integer)',
        false,
        'u',
        true,
        's',
        'jsonb',
        true
      )
    ) shape(
      signature,
      is_strict,
      parallel_safety,
      security_definer,
      volatility,
      result_type,
      service_execute
    )
  loop
    v_function_oid := pg_catalog.to_regprocedure(expected.signature)::oid;
    select pg_catalog.regexp_replace(
             pg_catalog.pg_get_function_result(function_row.oid),
             '[[:space:]]+',
             ' ',
             'g'
           ),
           function_row.proacl,
           function_row.proowner
      into v_actual_result, v_function_acl, v_function_owner
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_language language_row
      on language_row.oid = function_row.prolang
    where function_row.oid = v_function_oid
      and function_row.proowner = current_user::pg_catalog.regrole
      and language_row.lanname = 'plpgsql'
      and function_row.prokind = 'f'::"char"
      and function_row.proisstrict = expected.is_strict
      and function_row.proparallel = expected.parallel_safety::"char"
      and function_row.prosecdef = expected.security_definer
      and function_row.provolatile = expected.volatility::"char"
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
      ) = 'search_path=';

    if not found or v_actual_result is distinct from expected.result_type then
      raise exception 'agent_task_function_shape_failed:%', expected.signature;
    end if;

    select coalesce(
             pg_catalog.array_agg(entry.value order by entry.value),
             array[]::text[]
           )
      into v_acl_entries
    from (
      select distinct
        case when acl.grantee = 0 then 'PUBLIC'
          else coalesce(
            role_row.rolname,
            'OID:' || acl.grantee::text
          ) end || ':' || acl.privilege_type || ':' ||
          acl.is_grantable::text as value
      from pg_catalog.aclexplode(
        coalesce(
          v_function_acl,
          pg_catalog.acldefault('f', v_function_owner)
        )
      ) acl
      left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
      where acl.grantee <> v_function_owner
    ) entry;

    v_expected_acl := case when expected.service_execute then
      array['service_role:EXECUTE:false']::text[]
    else array[]::text[] end;
    if v_acl_entries is distinct from v_expected_acl then
      raise exception 'agent_task_function_acl_failed:%', expected.signature;
    end if;
  end loop;
end;
$postflight$;

commit;
