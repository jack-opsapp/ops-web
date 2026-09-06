-- Frozen live job-summary core; used to test its exact identity version projection.
CREATE OR REPLACE FUNCTION private.read_agent_job_summary_as_system_v6_core(p_request_id text, p_actor_user_id uuid, p_company_id uuid, p_permission_snapshot_revision text, p_registered_permission_keys text[], p_capability_id text, p_capability_revision text, p_capability_manifest_revision text, p_required_oauth_scopes text[], p_inbox_scope text, p_clients_scope text, p_pipeline_scope text, p_projects_scope text, p_calendar_scope text, p_tasks_scope text, p_photos_scope text, p_estimates_scope text, p_invoices_scope text, p_projects_financials_scope text, p_job_kind text, p_job_id uuid, p_sections text[], p_readiness_rule_codes text[], p_financial_components text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
AS $function$
declare
  v_expected_oauth_scopes text[];
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_request_id is null
     or p_request_id is distinct from btrim(p_request_id)
     or octet_length(p_request_id) not between 1 and 256
     or p_actor_user_id is null
     or p_company_id is null
     or p_registered_permission_keys is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_capability_id is distinct from 'get_job_summary'
     or p_capability_revision is distinct from
       'get_job_summary:2026-08-14.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-14.capability-manifest.v6'
     or p_job_kind not in ('opportunity', 'project')
     or p_job_id is null
     or p_sections is null
     or cardinality(p_sections) not between 1 and 7
     or p_sections <@ array[
       'identity', 'schedule', 'readiness', 'participants', 'financials',
       'activity', 'conversation'
     ]::text[] is not true
     or (select count(distinct requested.section)
         from unnest(p_sections) requested(section)) <>
        cardinality(p_sections)
     or p_job_kind = 'opportunity' and (
       'schedule' = any(p_sections) or 'readiness' = any(p_sections)
     )
     and 'invalid_agent_job_summary_request' is not null
     or p_readiness_rule_codes is not null and not (
       'readiness' = any(p_sections)
     )
     or 'readiness' = any(p_sections) and (
       p_readiness_rule_codes is null
       or cardinality(p_readiness_rule_codes) not between 1 and 5
       or p_readiness_rule_codes <@ array[
         'SITE_PHOTOS_MISSING',
         'CUSTOMER_RECORD_UNRESOLVED',
         'SCHEDULE_UNCONFIRMED',
         'CREW_UNASSIGNED',
         'ADDRESS_INCOMPLETE'
       ]::text[] is not true
       or (select count(distinct requested.value)
           from unnest(p_readiness_rule_codes) requested(value)) <>
          cardinality(p_readiness_rule_codes)
     )
     or p_financial_components is not null and not (
       'financials' = any(p_sections)
     )
     or 'financials' = any(p_sections) and (
       p_financial_components is null
       or cardinality(p_financial_components) not between 1 and 2
       or p_financial_components <@
          array['estimate_rollup', 'invoice_rollup']::text[] is not true
       or (select count(distinct requested.value)
           from unnest(p_financial_components) requested(value)) <>
          cardinality(p_financial_components)
     )
     or p_job_kind = 'opportunity'
        and 'invoice_rollup' = any(p_financial_components)
        and 'invalid_agent_job_summary_request' is not null
     or p_inbox_scope is not null
        and p_inbox_scope not in ('all', 'assigned', 'own')
     or p_clients_scope is not null
        and p_clients_scope not in ('all', 'assigned')
     or p_pipeline_scope is not null
        and p_pipeline_scope not in ('all', 'assigned')
     or p_projects_scope is not null
        and p_projects_scope not in ('all', 'assigned')
     or p_calendar_scope is not null
        and p_calendar_scope not in ('all', 'own')
     or p_tasks_scope is not null
        and p_tasks_scope not in ('all', 'assigned')
     or p_photos_scope is not null
        and p_photos_scope not in ('all', 'assigned')
     or p_estimates_scope is not null
        and p_estimates_scope not in ('all', 'assigned')
     or p_invoices_scope is not null
        and p_invoices_scope not in ('all', 'assigned')
     or p_projects_financials_scope is not null
        and p_projects_financials_scope <> 'all' then
    raise exception 'invalid_agent_job_summary_request'
      using errcode = '22023';
  end if;

  if (
       'schedule' = any(p_sections)
       or 'activity' = any(p_sections)
       or coalesce(p_readiness_rule_codes && array[
         'SCHEDULE_UNCONFIRMED', 'CREW_UNASSIGNED'
       ]::text[], false)
     ) is distinct from (p_calendar_scope is not null)
     or (
       'schedule' = any(p_sections)
       or 'activity' = any(p_sections)
       or coalesce(p_readiness_rule_codes && array[
         'SCHEDULE_UNCONFIRMED', 'CREW_UNASSIGNED'
       ]::text[], false)
     ) is distinct from (p_tasks_scope is not null)
     or (p_job_kind = 'opportunity') is distinct from
       (p_pipeline_scope is not null)
     or (
       p_job_kind = 'project'
       or p_job_kind = 'opportunity' and 'activity' = any(p_sections)
     ) is distinct from (p_projects_scope is not null)
     or (
       'participants' = any(p_sections)
       or 'conversation' = any(p_sections)
     ) is distinct from (p_inbox_scope is not null)
     or (
       'participants' = any(p_sections)
       or coalesce(
         'CUSTOMER_RECORD_UNRESOLVED' = any(p_readiness_rule_codes), false
       )
     ) is distinct from (p_clients_scope is not null)
     or coalesce('SITE_PHOTOS_MISSING' = any(p_readiness_rule_codes), false)
       is distinct from (p_photos_scope is not null)
     or coalesce('estimate_rollup' = any(p_financial_components), false)
       is distinct from (p_estimates_scope is not null)
     or coalesce('invoice_rollup' = any(p_financial_components), false)
       is distinct from (p_invoices_scope is not null)
     or (
       p_job_kind = 'project' and p_financial_components is not null
     ) is distinct from (p_projects_financials_scope is not null) then
    raise exception 'invalid_agent_job_summary_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_registered_permission_keys) registry(permission_key)
    where registry.permission_key is null
       or registry.permission_key is distinct from btrim(registry.permission_key)
       or octet_length(registry.permission_key) not between 1 and 128
  ) or (
    select count(distinct registry.permission_key)
    from unnest(p_registered_permission_keys) registry(permission_key)
  ) <> cardinality(p_registered_permission_keys)
  or p_job_kind = 'opportunity'
     and not ('pipeline.view' = any(p_registered_permission_keys))
  or p_job_kind = 'project'
     and not ('projects.view' = any(p_registered_permission_keys))
  or ('schedule' = any(p_sections)
      and (not ('calendar.view' = any(p_registered_permission_keys))
        or not ('tasks.view' = any(p_registered_permission_keys))))
  or (p_readiness_rule_codes && array[
        'SCHEDULE_UNCONFIRMED', 'CREW_UNASSIGNED'
      ]::text[]
      and (not ('calendar.view' = any(p_registered_permission_keys))
        or not ('tasks.view' = any(p_registered_permission_keys))))
  or ('participants' = any(p_sections)
      and (not ('clients.view' = any(p_registered_permission_keys))
        or not ('inbox.view' = any(p_registered_permission_keys))))
  or ('activity' = any(p_sections) and (
      not ('calendar.view' = any(p_registered_permission_keys))
      or not ('tasks.view' = any(p_registered_permission_keys))
      or not ('projects.view' = any(p_registered_permission_keys))))
  or ('conversation' = any(p_sections)
      and not ('inbox.view' = any(p_registered_permission_keys)))
  or ('estimate_rollup' = any(p_financial_components)
      and not ('estimates.view' = any(p_registered_permission_keys)))
  or ('invoice_rollup' = any(p_financial_components)
      and not ('invoices.view' = any(p_registered_permission_keys)))
  or (p_job_kind = 'project'
      and p_financial_components is not null
      and not ('projects.view_financials' = any(p_registered_permission_keys)))
  then
    raise exception 'invalid_agent_job_summary_request'
      using errcode = '22023';
  end if;

  select array_agg(requested.scope order by requested.scope)
  into v_expected_oauth_scopes
  from (
    select 'ops.jobs.read'::text as scope
    union select 'ops.schedule.read'::text
      where 'schedule' = any(p_sections)
         or p_readiness_rule_codes && array[
           'SCHEDULE_UNCONFIRMED', 'CREW_UNASSIGNED'
         ]::text[]
         or 'activity' = any(p_sections)
    union select 'ops.photos.read'::text
      where 'SITE_PHOTOS_MISSING' = any(p_readiness_rule_codes)
    union select 'ops.customers.read'::text
      where 'participants' = any(p_sections)
         or 'CUSTOMER_RECORD_UNRESOLVED' = any(p_readiness_rule_codes)
    union select 'ops.customer_contacts.read'::text
      where 'participants' = any(p_sections)
    union select 'ops.financials.read'::text
      where 'financials' = any(p_sections)
    union select 'ops.correspondence.read'::text
      where 'conversation' = any(p_sections)
         or 'participants' = any(p_sections)
  ) requested;
  if p_required_oauth_scopes is distinct from v_expected_oauth_scopes then
    raise exception 'invalid_agent_job_summary_request'
      using errcode = '22023';
  end if;

  perform private.agent_assert_operational_timezone_rules();

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'inbox.view'
           ) as inbox_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'clients.view'
           ) as clients_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'pipeline.view'
           ) as pipeline_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'projects.view'
           ) as projects_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'calendar.view'
           ) as calendar_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'tasks.view'
           ) as tasks_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'photos.view'
           ) as photos_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'estimates.view'
           ) as estimates_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'invoices.view'
           ) as invoices_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' =
               'projects.view_financials'
           ) as projects_financials_scope
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    group by authority.permission_snapshot_revision
  ), authority_context as materialized (
    select authority.permission_snapshot_revision,
           company.currency_code,
           company.timezone,
           source_revision.source_revision,
           history_revision.history_revision,
           date_trunc('milliseconds', statement_timestamp()) as read_at
    from current_authority authority
    join public.companies company
      on company.id = p_company_id
     and company.deleted_at is null
    join private.agent_operational_read_revisions source_revision
      on source_revision.company_id = p_company_id
    join private.agent_job_history_revisions history_revision
      on history_revision.company_id = p_company_id
    where authority.permission_snapshot_revision =
            p_permission_snapshot_revision
      and (p_inbox_scope is null or authority.inbox_scope = p_inbox_scope)
      and (p_clients_scope is null or authority.clients_scope = p_clients_scope)
      and (p_pipeline_scope is null
        or authority.pipeline_scope = p_pipeline_scope)
      and (p_projects_scope is null
        or authority.projects_scope = p_projects_scope)
      and (p_calendar_scope is null
        or authority.calendar_scope = p_calendar_scope)
      and (p_tasks_scope is null or authority.tasks_scope = p_tasks_scope)
      and (p_photos_scope is null or authority.photos_scope = p_photos_scope)
      and (p_estimates_scope is null
        or authority.estimates_scope = p_estimates_scope)
      and (p_invoices_scope is null
        or authority.invoices_scope = p_invoices_scope)
      and (p_projects_financials_scope is null
        or authority.projects_financials_scope =
          p_projects_financials_scope)
      and source_revision.source_revision between 0 and 9007199254740991
      and history_revision.history_revision between 0 and 9007199254740991
      and exists (
        select 1
        from pg_catalog.pg_timezone_names timezone
        where timezone.name = company.timezone
      )
  ), requested_job as materialized (
    select opportunity.id as job_id,
           'opportunity'::text as job_kind,
           opportunity.title,
           opportunity.address,
           opportunity.stage as status,
           case
             when opportunity.archived_at is not null
               or opportunity.stage = 'discarded' then 'archived'
             when opportunity.stage in ('won', 'lost') then 'terminal'
             else 'active'
           end as lifecycle_state,
           opportunity.created_at,
           opportunity.updated_at,
           null::date as start_date,
           null::date as end_date,
           private.resolve_opportunity_client_id(
             opportunity.client_ref,
             opportunity.client_id
           ) as client_id,
           coalesce(opportunity.project_ref, opportunity.project_id)
             as project_id,
           opportunity.id as opportunity_id
    from authority_context authority
    join public.opportunities opportunity
      on p_job_kind = 'opportunity'
     and opportunity.id = p_job_id
     and opportunity.company_id = p_company_id
     and opportunity.deleted_at is null
     and opportunity.merged_into_opportunity_id is null
    where private.agent_user_can_access_entity(
      p_actor_user_id, p_company_id, p_job_kind, p_job_id, 'view'
    )
      and not (
        opportunity.client_ref is not null
        and opportunity.client_id is not null
        and opportunity.client_ref is distinct from opportunity.client_id
      )
      and not (
        opportunity.project_ref is not null
        and opportunity.project_id is not null
        and opportunity.project_ref is distinct from opportunity.project_id
      )

    union all

    select project.id,
           'project',
           project.title,
           project.address,
           project.status,
           case
             when project.status = 'archived' then 'archived'
             when project.status in ('completed', 'closed') then 'terminal'
             else 'active'
           end,
           project.created_at,
           project.updated_at,
           project.start_date,
           project.end_date,
           project.client_id,
           project.id,
           coalesce(project.opportunity_ref,
             private.agent_uuid_from_legacy_text(project.opportunity_id))
    from authority_context authority
    join public.projects project
      on p_job_kind = 'project'
     and project.id = p_job_id
     and project.company_id = p_company_id
     and project.deleted_at is null
    where private.agent_user_can_access_entity(
      p_actor_user_id, p_company_id, p_job_kind, p_job_id, 'view'
    )
      and not (
        project.opportunity_ref is not null
        and project.opportunity_id is not null
        and project.opportunity_ref is distinct from
          private.agent_uuid_from_legacy_text(project.opportunity_id)
      )
  ), canonical_request as materialized (
    select jsonb_strip_nulls(jsonb_build_object(
      'job_ref', jsonb_build_object(
        'kind', p_job_kind,
        'id', p_job_id
      ),
      'sections', to_jsonb(p_sections),
      'readiness_rule_codes', to_jsonb(p_readiness_rule_codes),
      'financial_components', to_jsonb(p_financial_components)
    )) as canonical_input
  ), authorized_project_source as materialized (
    select project.id,
           project.title,
           project.address,
           project.status,
           project.status_version,
           project.updated_at,
           project.client_id,
           project.start_date,
           project.end_date,
           coalesce(project.opportunity_ref,
             private.agent_uuid_from_legacy_text(project.opportunity_id))
             as opportunity_id,
           project.project_images
    from requested_job job
    join public.projects project
      on project.company_id = p_company_id
     and project.deleted_at is null
     and (
       job.job_kind = 'project' and project.id = job.job_id
       or job.job_kind = 'opportunity' and project.id = job.project_id
     )
    where not (
        project.opportunity_ref is not null
        and project.opportunity_id is not null
        and project.opportunity_ref is distinct from
          private.agent_uuid_from_legacy_text(project.opportunity_id)
      )
      and (
        job.job_kind = 'project'
        or coalesce(project.opportunity_ref,
             private.agent_uuid_from_legacy_text(project.opportunity_id)) =
             job.opportunity_id
          and project.client_id = job.client_id
      )
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'project',
        project.id,
        'view'
      )
  ), readiness_customer_source as materialized (
    select job.client_id,
           client.id is not null as resolved,
           job.client_id is null
             or client.id is null
             or private.agent_user_can_access_entity(
               p_actor_user_id,
               p_company_id,
               'client',
               client.id,
               'view'
             ) as source_authorized
    from requested_job job
    left join public.clients client
      on 'CUSTOMER_RECORD_UNRESOLVED' = any(p_readiness_rule_codes)
     and client.id = job.client_id
     and client.company_id = p_company_id
     and client.deleted_at is null
     and client.merged_into_client_id is null
  ), summary_schedule_task_candidate as materialized (
    select task.id as task_id,
           task.project_id,
           coalesce(
             nullif(btrim(task.custom_title), ''),
             nullif(btrim(task_type.display), ''),
             nullif(btrim(project.title), '')
           ) as task_title,
           task.status as task_status,
           task.start_date,
           task.end_date,
           task.start_time,
           task.end_time,
           task.all_day,
           greatest(coalesce(task.duration, 1), 1) as duration,
           task.team_member_ids,
           task.schedule_confirmed_at,
           task.confirmed_schedule_version,
           task.schedule_locked,
           task.schedule_version,
           task.updated_at as task_updated_at,
           project.title as project_title,
           project.address as project_address,
           project.status as project_status,
           project.status_version as project_status_version,
           project.updated_at as project_updated_at,
           context.timezone as company_timezone,
           context.read_at
    from authority_context context
    join authorized_project_source project on true
    join public.project_tasks task
      on 'schedule' = any(p_sections)
     and p_job_kind = 'project'
     and task.project_id = project.id
     and task.company_id = p_company_id
     and task.deleted_at is null
     and task.start_date is not null
     and task.status in ('active', 'completed', 'cancelled')
    left join public.task_types task_type
      on task_type.id = task.task_type_id
     and task_type.company_id = p_company_id
     and task_type.deleted_at is null
    where private.agent_user_can_access_entity(
        p_actor_user_id, p_company_id, 'task', task.id, 'view'
      )
      and (
        p_calendar_scope = 'all'
        or p_actor_user_id::text = any(coalesce(
          task.team_member_ids, array[]::text[]
        ))
      )
      and (
        p_tasks_scope = 'all'
        or p_actor_user_id::text = any(coalesce(
          task.team_member_ids, array[]::text[]
        ))
      )
      and (
        p_projects_scope = 'all'
        or exists (
          select 1
          from public.project_tasks project_assignment
          where project_assignment.project_id = project.id
            and project_assignment.company_id = p_company_id
            and project_assignment.deleted_at is null
            and project_assignment.status = 'active'
            and p_actor_user_id::text = any(coalesce(
              project_assignment.team_member_ids, array[]::text[]
            ))
        )
      )
    order by task.start_date, task.start_time nulls first, task.id
    limit 11
  ), summary_schedule_source_state as materialized (
    select count(*) = 11 as occurrence_sentinel,
           coalesce(sum(cardinality(coalesce(
             task.team_member_ids, array[]::text[]
           ))) > 100, false) as assignment_source_query_bound,
           coalesce(bool_or(
             task.task_title is null
             or char_length(task.task_title) not between 1 and 1000
             or task.project_address is not null
                and nullif(btrim(task.project_address), '') is not null
                and char_length(btrim(task.project_address)) > 2000
             or task.task_status not in ('active', 'completed', 'cancelled')
             or task.all_day is null
             or not task.all_day and (
               task.start_time is null or task.end_time is null
             )
             or task.end_date is not null
                and (task.end_date at time zone 'UTC')::date <
                  (task.start_date at time zone 'UTC')::date
             or task.task_updated_at is null
             or task.project_updated_at is null
             or task.task_updated_at > task.read_at
             or task.project_updated_at > task.read_at
             or task.schedule_confirmed_at > task.read_at
             or task.schedule_version not between 0 and 9007199254740991
             or task.project_status_version not between 0 and 9007199254740991
             or cardinality(coalesce(
               task.team_member_ids, array[]::text[]
             )) > 100
           ), false) as source_data_invalid
    from summary_schedule_task_candidate task
  ), summary_schedule_local as materialized (
    select task.*,
           (
             (task.start_date at time zone 'UTC')::date
               + case when task.all_day then time '00:00:00'
                   else task.start_time end
           )::timestamp without time zone as local_start_value,
           (
             case when task.all_day then
               coalesce(
                 (task.end_date at time zone 'UTC')::date,
                 (task.start_date at time zone 'UTC')::date +
                   task.duration - 1
               ) + time '00:00:00'
             else
               coalesce(
                 (task.end_date at time zone 'UTC')::date,
                 (task.start_date at time zone 'UTC')::date +
                   case when task.end_time <= task.start_time then 1 else 0 end
               ) + task.end_time
             end
           )::timestamp without time zone as local_end_value
    from summary_schedule_task_candidate task
    cross join summary_schedule_source_state state
    where not state.source_data_invalid
      and not state.assignment_source_query_bound
  ), summary_schedule_resolved as materialized (
    select schedule.*,
           case when schedule.all_day
             then private.agent_civil_date_start(
               schedule.local_start_value::date,
               schedule.company_timezone
             )
             else private.agent_unambiguous_local_instant(
               schedule.local_start_value,
               schedule.company_timezone
             )
           end as scheduled_start_utc,
           case when schedule.all_day
             then private.agent_civil_date_start(
               schedule.local_end_value::date + 1,
               schedule.company_timezone
             )
             else private.agent_unambiguous_local_instant(
               schedule.local_end_value,
               schedule.company_timezone
             )
           end as scheduled_end_utc
    from summary_schedule_local schedule
  ), summary_schedule_resolved_state as materialized (
    select coalesce(bool_or(
      schedule.scheduled_start_utc is null
      or schedule.scheduled_end_utc is null
      or schedule.scheduled_end_utc <= schedule.scheduled_start_utc
    ), false) as source_data_invalid
    from summary_schedule_resolved schedule
  ), summary_schedule_raw_assignment as materialized (
    select schedule.task_id,
           member.user_id
    from summary_schedule_resolved schedule
    cross join lateral unnest(
      case when cardinality(coalesce(
        schedule.team_member_ids, array[]::text[]
      )) <= 100 then (coalesce(
        schedule.team_member_ids, array[]::text[]
      ))[1:100] else array[]::text[] end
    ) member(user_id)
  ), summary_schedule_assignment_state as materialized (
    select schedule.task_id,
           coalesce(bool_or(
             member.user_id is not null and (
               not pg_input_is_valid(member.user_id, 'uuid')
               or crew_user.id is null
               or char_length(btrim(concat_ws(
                 ' ', crew_user.first_name, crew_user.last_name
               ))) not between 1 and 256
             )
           ), false) as source_data_invalid,
           count(distinct crew_user.id)::integer as assignment_total
    from summary_schedule_resolved schedule
    left join summary_schedule_raw_assignment member
      on member.task_id = schedule.task_id
    left join public.users crew_user
      on pg_input_is_valid(member.user_id, 'uuid')
     and crew_user.id::text = member.user_id
     and crew_user.company_id = p_company_id
     and crew_user.deleted_at is null
     and coalesce(crew_user.is_active, false)
    group by schedule.task_id
  ), summary_schedule_valid_assignment as materialized (
    select distinct member.task_id,
           crew_user.id as user_id,
           btrim(concat_ws(
             ' ', crew_user.first_name, crew_user.last_name
           )) as display_name
    from summary_schedule_raw_assignment member
    join public.users crew_user
      on pg_input_is_valid(member.user_id, 'uuid')
     and crew_user.id::text = member.user_id
     and crew_user.company_id = p_company_id
     and crew_user.deleted_at is null
     and coalesce(crew_user.is_active, false)
    where char_length(btrim(concat_ws(
      ' ', crew_user.first_name, crew_user.last_name
    ))) between 1 and 256
  ), summary_schedule_assignment_projection as materialized (
    select ranked.task_id,
           jsonb_agg(jsonb_build_object(
             'user_id', ranked.user_id,
             'display_name', ranked.display_name
           ) order by ranked.user_id) filter (
             where ranked.assignment_rank <= 50
           ) as assignments
    from (
      select assignment.*,
             row_number() over (
               partition by assignment.task_id order by assignment.user_id
             ) as assignment_rank
      from summary_schedule_valid_assignment assignment
    ) ranked
    group by ranked.task_id
  ), summary_schedule_occurrence as materialized (
    select schedule.task_id,
           schedule.scheduled_start_utc,
           row_number() over (
             order by schedule.scheduled_start_utc, schedule.task_id
           ) as occurrence_rank,
           jsonb_build_object(
             'job_ref', jsonb_build_object(
               'kind', 'project', 'id', schedule.project_id
             ),
             'occurrence_ref', jsonb_build_object(
               'kind', 'project_task', 'id', schedule.task_id
             ),
             'title', schedule.task_title,
             'address', nullif(btrim(schedule.project_address), ''),
             'task_status', schedule.task_status,
             'timing_state', case
               when schedule.task_status <> 'active' then 'past'
               when schedule.scheduled_start_utc > schedule.read_at
                 then 'upcoming'
               when schedule.scheduled_end_utc > schedule.read_at
                 then 'in_progress'
               else 'past_due'
             end,
             'confirmation_state', case
               when schedule.schedule_confirmed_at is not null
                and schedule.confirmed_schedule_version =
                  schedule.schedule_version then 'confirmed'
               else 'unconfirmed'
             end,
             'schedule_confirmed_at', case
               when schedule.schedule_confirmed_at is not null
                and schedule.confirmed_schedule_version =
                  schedule.schedule_version
                 then private.agent_rfc3339_utc(
                   schedule.schedule_confirmed_at
                 )
               else null
             end,
             'confirmed_schedule_version', case
               when schedule.schedule_confirmed_at is not null
                and schedule.confirmed_schedule_version =
                  schedule.schedule_version
                 then schedule.confirmed_schedule_version
               else null
             end,
             'schedule_locked', schedule.schedule_locked,
             'schedule_version', schedule.schedule_version,
             'task_updated_at', private.agent_rfc3339_utc(
               schedule.task_updated_at
             ),
             'project_status', schedule.project_status,
             'project_status_version', schedule.project_status_version,
             'project_updated_at', private.agent_rfc3339_utc(
               schedule.project_updated_at
             ),
             'schedule', jsonb_build_object(
               'all_day', schedule.all_day,
               'company_timezone', schedule.company_timezone,
               'local_start', to_char(
                 schedule.local_start_value, 'YYYY-MM-DD"T"HH24:MI:SS'
               ),
               'local_end_inclusive', case when schedule.all_day then
                 to_char(
                   schedule.local_end_value::date + time '23:59:59.999999',
                   'YYYY-MM-DD"T"HH24:MI:SS.US'
                 ) else to_char(
                   schedule.local_end_value, 'YYYY-MM-DD"T"HH24:MI:SS'
                 ) end,
               'start_utc', private.agent_rfc3339_utc(
                 schedule.scheduled_start_utc
               ),
               'start_utc_offset_minutes', (
                 extract(epoch from (
                   schedule.scheduled_start_utc at time zone
                     schedule.company_timezone
                   - schedule.scheduled_start_utc at time zone 'UTC'
                 )) / 60
               )::integer,
               'start_pre_boundary_utc_offset_minutes', case
                 when schedule.all_day then (
                   extract(epoch from (
                     (schedule.scheduled_start_utc - interval '1 millisecond')
                       at time zone schedule.company_timezone
                     - (schedule.scheduled_start_utc - interval '1 millisecond')
                       at time zone 'UTC'
                   )) / 60
                 )::integer else null
               end,
               'end_utc_exclusive', private.agent_rfc3339_utc(
                 schedule.scheduled_end_utc
               ),
               'end_utc_offset_minutes', (
                 extract(epoch from (
                   schedule.scheduled_end_utc at time zone
                     schedule.company_timezone
                   - schedule.scheduled_end_utc at time zone 'UTC'
                 )) / 60
               )::integer,
               'end_pre_boundary_utc_offset_minutes', case
                 when schedule.all_day then (
                   extract(epoch from (
                     (schedule.scheduled_end_utc - interval '1 millisecond')
                       at time zone schedule.company_timezone
                     - (schedule.scheduled_end_utc - interval '1 millisecond')
                       at time zone 'UTC'
                   )) / 60
                 )::integer else null
               end,
               'display', jsonb_build_object(
                 'timezone', schedule.company_timezone,
                 'local_start', to_char(
                   schedule.scheduled_start_utc at time zone
                     schedule.company_timezone,
                   'YYYY-MM-DD"T"HH24:MI:SS.MS'
                 ),
                 'local_end_exclusive', to_char(
                   schedule.scheduled_end_utc at time zone
                     schedule.company_timezone,
                   'YYYY-MM-DD"T"HH24:MI:SS.MS'
                 ),
                 'start_utc_offset_minutes', (
                   extract(epoch from (
                     schedule.scheduled_start_utc at time zone
                       schedule.company_timezone
                     - schedule.scheduled_start_utc at time zone 'UTC'
                   )) / 60
                 )::integer,
                 'end_utc_offset_minutes', (
                   extract(epoch from (
                     schedule.scheduled_end_utc at time zone
                       schedule.company_timezone
                     - schedule.scheduled_end_utc at time zone 'UTC'
                   )) / 60
                 )::integer
               )
             ),
             'assignments', coalesce(
               assignment.assignments, '[]'::jsonb
             ),
             'assignment_total', assignment_state.assignment_total,
             'assignments_omitted_count', greatest(
               assignment_state.assignment_total - jsonb_array_length(
                 coalesce(assignment.assignments, '[]'::jsonb)
               ), 0
             )
           ) as occurrence
    from summary_schedule_resolved schedule
    join summary_schedule_assignment_state assignment_state
      on assignment_state.task_id = schedule.task_id
    left join summary_schedule_assignment_projection assignment
      on assignment.task_id = schedule.task_id
    cross join summary_schedule_resolved_state resolved_state
    where not resolved_state.source_data_invalid
      and not assignment_state.source_data_invalid
  ), summary_schedule_failure_state as materialized (
    select source_state.assignment_source_query_bound as source_query_bound,
           source_state.source_data_invalid
             or resolved_state.source_data_invalid
             or exists (
               select 1 from summary_schedule_assignment_state assignment
               where assignment.source_data_invalid
             ) as source_data_invalid,
           source_state.occurrence_sentinel
    from summary_schedule_source_state source_state
    cross join summary_schedule_resolved_state resolved_state
  ), readiness_task_candidate as materialized (
    select task.id as task_id,
           task.project_id,
           task.start_date,
           task.end_date,
           task.start_time,
           task.end_time,
           task.all_day,
           greatest(coalesce(task.duration, 1), 1) as duration,
           task.team_member_ids,
           task.schedule_confirmed_at,
           task.confirmed_schedule_version,
           task.schedule_version,
           project.status as project_status,
           context.timezone as company_timezone
    from authority_context context
    join authorized_project_source project on true
    join public.project_tasks task
      on 'readiness' = any(p_sections)
     and p_readiness_rule_codes && array[
       'SCHEDULE_UNCONFIRMED', 'CREW_UNASSIGNED'
     ]::text[]
     and task.project_id = project.id
     and task.company_id = p_company_id
     and task.deleted_at is null
     and task.start_date is not null
     and task.status = 'active'
     and project.status in ('rfq', 'estimated', 'accepted', 'in_progress')
    where private.agent_user_can_access_entity(
        p_actor_user_id, p_company_id, 'task', task.id, 'view'
      )
      and (
        p_calendar_scope = 'all'
        or p_actor_user_id::text = any(coalesce(
          task.team_member_ids, array[]::text[]
        ))
      )
      and (
        p_tasks_scope = 'all'
        or p_actor_user_id::text = any(coalesce(
          task.team_member_ids, array[]::text[]
        ))
      )
    order by task.start_date, task.start_time nulls first, task.id
    limit 51
  ), readiness_task_source_state as materialized (
    select count(*) = 51 as source_query_bound,
           coalesce(bool_or(cardinality(coalesce(
             task.team_member_ids, array[]::text[]
           )) > 100), false) as assignment_source_query_bound,
           coalesce(bool_or(
             task.all_day is null
             or not task.all_day and (
               task.start_time is null or task.end_time is null
             )
             or task.end_date is not null
                and (task.end_date at time zone 'UTC')::date <
                  (task.start_date at time zone 'UTC')::date
             or task.schedule_version not between 0 and 9007199254740991
           ), false) as source_data_invalid
    from readiness_task_candidate task
  ), readiness_local_task as materialized (
    select task.*,
           (
             (task.start_date at time zone 'UTC')::date
               + case when task.all_day then time '00:00:00'
                   else task.start_time end
           )::timestamp without time zone as local_start_value,
           (
             case when task.all_day then
               coalesce(
                 (task.end_date at time zone 'UTC')::date,
                 (task.start_date at time zone 'UTC')::date +
                   task.duration - 1
               ) + time '00:00:00'
             else
               coalesce(
                 (task.end_date at time zone 'UTC')::date,
                 (task.start_date at time zone 'UTC')::date +
                   case when task.end_time <= task.start_time then 1 else 0 end
               ) + task.end_time
             end
           )::timestamp without time zone as local_end_value
    from readiness_task_candidate task
    cross join readiness_task_source_state state
    where not state.source_data_invalid
  ), readiness_resolved_task as materialized (
    select task.*,
           case when task.all_day then private.agent_civil_date_start(
             task.local_start_value::date, task.company_timezone
           ) else private.agent_unambiguous_local_instant(
             task.local_start_value, task.company_timezone
           ) end as scheduled_start_utc,
           case when task.all_day then private.agent_civil_date_start(
             task.local_end_value::date + 1, task.company_timezone
           ) else private.agent_unambiguous_local_instant(
             task.local_end_value, task.company_timezone
           ) end as scheduled_end_utc
    from readiness_local_task task
  ), readiness_assignment_state as materialized (
    select task.*,
           case when cardinality(coalesce(
             task.team_member_ids, array[]::text[]
           )) > 100 then false else exists (
             select 1
             from unnest((coalesce(
               task.team_member_ids, array[]::text[]
             ))[1:100]) member(user_id)
             join public.users crew_user
               on pg_input_is_valid(member.user_id, 'uuid')
              and crew_user.id::text = member.user_id
              and crew_user.company_id = p_company_id
              and crew_user.deleted_at is null
              and coalesce(crew_user.is_active, false)
           ) end as has_valid_assignment,
           case when cardinality(coalesce(
             task.team_member_ids, array[]::text[]
           )) > 100 then false else exists (
             select 1
             from unnest((coalesce(
               task.team_member_ids, array[]::text[]
             ))[1:100]) member(user_id)
             left join public.users crew_user
               on pg_input_is_valid(member.user_id, 'uuid')
              and crew_user.id::text = member.user_id
              and crew_user.company_id = p_company_id
              and crew_user.deleted_at is null
              and coalesce(crew_user.is_active, false)
             where member.user_id is null
                or not pg_input_is_valid(member.user_id, 'uuid')
                or crew_user.id is null
           ) end as assignment_source_invalid
    from readiness_resolved_task task
    where task.scheduled_start_utc is not null
      and task.scheduled_end_utc is not null
      and task.scheduled_end_utc > task.scheduled_start_utc
  ), readiness_task_rollup as materialized (
    select count(*)::integer as eligible_occurrence_count,
           count(*) filter (
             where task.schedule_confirmed_at is null
                or task.confirmed_schedule_version is distinct from
                  task.schedule_version
           )::integer as unconfirmed_occurrence_count,
           coalesce(jsonb_agg(
             'project_task:' || task.task_id::text
             order by task.scheduled_start_utc, task.task_id
           ) filter (
             where task.schedule_confirmed_at is null
                or task.confirmed_schedule_version is distinct from
                  task.schedule_version
           ), '[]'::jsonb) as unconfirmed_occurrence_refs,
           count(*) filter (
             where task.has_valid_assignment is false
           )::integer as unassigned_occurrence_count,
           coalesce(jsonb_agg(
             'project_task:' || task.task_id::text
             order by task.scheduled_start_utc, task.task_id
           ) filter (
             where task.has_valid_assignment is false
           ), '[]'::jsonb) as unassigned_occurrence_refs,
           coalesce(bool_or(task.assignment_source_invalid), false)
             as assignment_source_invalid
    from readiness_assignment_state task
  ), readiness_resolved_state as materialized (
    select coalesce(bool_or(
      task.scheduled_start_utc is null
      or task.scheduled_end_utc is null
      or task.scheduled_end_utc <= task.scheduled_start_utc
    ), false) as source_data_invalid
    from readiness_resolved_task task
  ), readiness_photo_candidate as materialized (
    select photo.id,
           photo.deleted_at,
           case when photo.url is not null
                  and octet_length(photo.url) between 1 and 2048
             then left(photo.url, 2048) else null end as bounded_url,
           coalesce(octet_length(photo.url) > 2048, false)
             as url_overlength,
           photo.source
    from authorized_project_source project
    join public.project_photos photo
      on 'SITE_PHOTOS_MISSING' = any(p_readiness_rule_codes)
     and photo.project_id = project.id::text
     and photo.company_id = p_company_id::text
    where p_photos_scope = 'all'
       or exists (
         select 1 from public.project_tasks assigned_task
         where assigned_task.project_id = project.id
           and assigned_task.company_id = p_company_id
           and assigned_task.deleted_at is null
           and assigned_task.status = 'active'
           and p_actor_user_id::text = any(coalesce(
             assigned_task.team_member_ids, array[]::text[]
           ))
       )
    order by photo.id
    limit 1001
  ), readiness_photo_state as materialized (
    select count(*)::integer as structured_row_count,
           count(*) > 1000 as source_query_bound,
           count(*) filter (where photo.deleted_at is not null)::integer
             as tombstone_count,
           count(*) filter (where photo.deleted_at is null
             and photo.bounded_url ~* '^https?://[^[:space:]]+$'
             and photo.source = 'site_visit')::integer as site_visit_count,
           count(*) filter (where photo.deleted_at is null
             and photo.bounded_url ~* '^https?://[^[:space:]]+$'
             and photo.source = 'in_progress')::integer as in_progress_count,
           count(*) filter (where photo.deleted_at is null
             and photo.bounded_url ~* '^https?://[^[:space:]]+$'
             and photo.source = 'completion')::integer as completion_count,
           count(*) filter (where photo.deleted_at is null
             and photo.bounded_url ~* '^https?://[^[:space:]]+$'
             and photo.source = 'other')::integer as other_count,
           count(*) filter (where photo.deleted_at is null
             and photo.bounded_url ~* '^https?://[^[:space:]]+$'
             and photo.source = 'measurement')::integer as measurement_count,
           count(*) filter (where photo.deleted_at is null
             and photo.bounded_url ~* '^https?://[^[:space:]]+$'
             and photo.source = 'deck_design')::integer as deck_design_count,
           count(*) filter (where photo.deleted_at is null and not coalesce(
             photo.bounded_url ~* '^https?://[^[:space:]]+$'
             and photo.source in (
               'site_visit', 'in_progress', 'completion', 'other',
               'measurement', 'deck_design'
             ), false))::integer as malformed_or_local_count
    from readiness_photo_candidate photo
  ), readiness_legacy_photo_state as materialized (
    select coalesce(source.legacy_count > 100, false)
             as source_query_bound,
           coalesce(bool_or(
             source.legacy_count <= 100
             and legacy.url is not null
             and octet_length(legacy.url) > 2048
           ), false) as source_data_invalid,
           count(*) filter (where case
             when source.legacy_count <= 100
              and legacy.url is not null
              and octet_length(legacy.url) between 1 and 2048
               then left(legacy.url, 2048) ~* '^https?://[^[:space:]]+$'
             else false end)::integer as legacy_remote_count
    from authorized_project_source project
    cross join readiness_photo_state photo
    left join lateral (
      select cardinality(coalesce(
               project.project_images, array[]::text[]
             )) as legacy_count,
             project.project_images
      where 'SITE_PHOTOS_MISSING' = any(p_readiness_rule_codes)
        and photo.structured_row_count = 0
    ) source on true
    left join lateral unnest(
      case when source.legacy_count <= 100 then
        (coalesce(source.project_images, array[]::text[]))[1:100]
      else array[]::text[] end
    ) legacy(url) on true
    group by source.legacy_count
  ), readiness_raw_source as materialized (
    select jsonb_build_object(
      'site_photos', case
        when not ('SITE_PHOTOS_MISSING' = any(p_readiness_rule_codes)) then
          jsonb_build_object(
            'status', 'not_evaluated',
            'gap_code', 'SOURCE_UNAVAILABLE',
            'source_kind', 'project_photos'
          )
        when photo.source_query_bound
          or coalesce(legacy.source_query_bound, false) then
          jsonb_build_object(
            'status', 'not_evaluated',
            'gap_code', 'SOURCE_QUERY_BOUND',
            'source_kind', 'project_photos'
          )
        when coalesce(legacy.source_data_invalid, false) then
          jsonb_build_object(
            'status', 'not_evaluated',
            'gap_code', 'SOURCE_DATA_INVALID',
            'source_kind', 'project_photos'
          )
        else jsonb_build_object(
          'available', true,
          'active_remote_by_source', jsonb_build_object(
            'site_visit', photo.site_visit_count,
            'in_progress', photo.in_progress_count,
            'completion', photo.completion_count,
            'other', photo.other_count,
            'measurement', photo.measurement_count,
            'deck_design', photo.deck_design_count
          ),
          'structured_row_count', photo.structured_row_count,
          'tombstone_count', photo.tombstone_count,
          'malformed_or_local_count', photo.malformed_or_local_count,
          'legacy_remote_count', coalesce(legacy.legacy_remote_count, 0)
        ) end,
      'customer_record', case
        when not ('CUSTOMER_RECORD_UNRESOLVED' =
          any(p_readiness_rule_codes)) then jsonb_build_object(
          'status', 'not_evaluated',
          'gap_code', 'SOURCE_UNAVAILABLE',
          'source_kind', 'customer_record'
        )
        when not customer.source_authorized then jsonb_build_object(
          'status', 'not_evaluated',
          'gap_code', 'SOURCE_UNAVAILABLE',
          'source_kind', 'customer_record'
        )
        else jsonb_build_object('resolved', customer.resolved) end,
      'schedule', case
        when not ('SCHEDULE_UNCONFIRMED' = any(p_readiness_rule_codes)) then
          jsonb_build_object(
            'status', 'not_evaluated',
            'gap_code', 'SOURCE_UNAVAILABLE',
            'source_kind', 'task_schedule'
          )
        when task_state.source_query_bound then jsonb_build_object(
          'status', 'not_evaluated',
          'gap_code', 'SOURCE_QUERY_BOUND',
          'source_kind', 'task_schedule'
        )
        when task_state.source_data_invalid
          or resolved_state.source_data_invalid then jsonb_build_object(
          'status', 'not_evaluated',
          'gap_code', 'SOURCE_DATA_INVALID',
          'source_kind', 'task_schedule'
        )
        when rollup.eligible_occurrence_count = 0 then jsonb_build_object(
          'status', 'not_evaluated',
          'gap_code', 'SOURCE_UNAVAILABLE',
          'source_kind', 'task_schedule'
        )
        else jsonb_build_object(
          'eligible_occurrence_count', rollup.eligible_occurrence_count,
          'unconfirmed_occurrence_count',
            rollup.unconfirmed_occurrence_count,
          'unconfirmed_occurrence_refs',
            rollup.unconfirmed_occurrence_refs
        ) end,
      'crew', case
        when not ('CREW_UNASSIGNED' = any(p_readiness_rule_codes)) then
          jsonb_build_object(
            'status', 'not_evaluated',
            'gap_code', 'SOURCE_UNAVAILABLE',
            'source_kind', 'task_assignments'
          )
        when task_state.source_query_bound
          or task_state.assignment_source_query_bound then
          jsonb_build_object(
            'status', 'not_evaluated',
            'gap_code', 'SOURCE_QUERY_BOUND',
            'source_kind', 'task_assignments'
          )
        when task_state.source_data_invalid
          or resolved_state.source_data_invalid
          or rollup.assignment_source_invalid then jsonb_build_object(
            'status', 'not_evaluated',
            'gap_code', 'SOURCE_DATA_INVALID',
            'source_kind', 'task_assignments'
          )
        when rollup.eligible_occurrence_count = 0 then jsonb_build_object(
          'status', 'not_evaluated',
          'gap_code', 'SOURCE_UNAVAILABLE',
          'source_kind', 'task_assignments'
        )
        else jsonb_build_object(
          'eligible_occurrence_count', rollup.eligible_occurrence_count,
          'unassigned_occurrence_count', rollup.unassigned_occurrence_count,
          'unassigned_occurrence_refs', rollup.unassigned_occurrence_refs
        ) end,
      'address', case
        when not ('ADDRESS_INCOMPLETE' = any(p_readiness_rule_codes)) then
          jsonb_build_object(
            'status', 'not_evaluated',
            'gap_code', 'SOURCE_UNAVAILABLE',
            'source_kind', 'project_address'
          )
        when job.address is not null
          and char_length(btrim(job.address)) > 2000 then jsonb_build_object(
          'status', 'not_evaluated',
          'gap_code', 'SOURCE_DATA_INVALID',
          'source_kind', 'project_address'
        )
        else jsonb_build_object(
          'available', true,
          'project_address', nullif(btrim(job.address), '')
        ) end
    ) as raw_sources
    from requested_job job
    cross join readiness_customer_source customer
    cross join readiness_task_source_state task_state
    cross join readiness_resolved_state resolved_state
    cross join readiness_task_rollup rollup
    cross join readiness_photo_state photo
    left join readiness_legacy_photo_state legacy on true
    where 'readiness' = any(p_sections)
  ), participant_snapshot as materialized (
    select private.read_agent_job_participant_snapshot(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      'resolve_job_participants',
      'resolve_job_participants:2026-08-13.v1',
      '2026-08-14.capability-manifest.v6',
      array[
        'ops.correspondence.read',
        'ops.customer_contacts.read',
        'ops.customers.read',
        'ops.jobs.read'
      ]::text[],
      p_inbox_scope,
      p_clients_scope,
      case p_job_kind when 'opportunity' then 'pipeline.view'
        else 'projects.view' end,
      case p_job_kind when 'opportunity' then p_pipeline_scope
        else p_projects_scope end,
      case when p_job_kind = 'project' then p_projects_scope else null end,
      null,
      null,
      null,
      p_job_kind,
      p_job_id,
      'general',
      'participants'
    ) as snapshot
    where 'participants' = any(p_sections)
  ), participant_source_candidate as materialized (
    select claim.value -> 'raw' as raw,
           case claim.value -> 'raw' ->> 'source_kind'
             when 'primary_client' then 1
             when 'sub_client' then 2
             when 'conversation_ambiguous' then 4
             when 'conversation_unresolved' then 4
             when 'conversation_redacted' then 4
             when 'ops_delivery_user' then 5
             when 'phase_c' then 7
             else 99
           end as source_rank,
           claim.value -> 'raw' -> 'participant_ref' ->> 'id'
             as participant_id
    from participant_snapshot snapshot
    cross join lateral jsonb_array_elements(
      snapshot.snapshot -> 'participant_claims'
    ) claim(value)
  ), participant_source_state as materialized (
    select coalesce(bool_or(
      source.source_rank = 99
      or source.participant_id is null
      or octet_length(source.participant_id) not between 1 and 256
    ), false) as source_data_invalid,
    coalesce((select (snapshot.snapshot ->> 'participant_total')::integer
      from participant_snapshot snapshot), 0) as participant_total,
    coalesce((select
      (snapshot.snapshot ->> 'participants_omitted_count')::integer
      from participant_snapshot snapshot), 0) as participants_omitted_count,
    coalesce((select
      snapshot.snapshot ->> 'participant_count_completeness'
      from participant_snapshot snapshot), 'exact')
      as participant_count_completeness
    from participant_source_candidate source
  ), participant_source as materialized (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'source_kind', source.raw ->> 'source_kind',
        'participant_ref', source.raw -> 'participant_ref',
        'display_name', source.raw -> 'display_name',
        'conversation_side', source.raw -> 'conversation_side',
        'resolution_status', source.raw -> 'resolution_status',
        'resolution_basis', source.raw -> 'resolution_basis',
        'resolution_revision', source.raw -> 'resolution_revision',
        case when source.raw ->> 'source_kind' =
          'conversation_ambiguous' then 'candidate_count_lower_bound'
          else 'candidate_count' end,
        case when source.raw ->> 'source_kind' =
          'conversation_ambiguous'
          then source.raw -> 'candidate_count_lower_bound'
          else 'null'::jsonb end,
        'content_kind', 'untrusted_business_data'
      ) order by source.source_rank, source.participant_id collate "C"
    ) filter (where source.raw is not null), '[]'::jsonb) as participants,
    state.participant_total,
    state.participants_omitted_count,
    state.participant_count_completeness,
    state.source_data_invalid
    from participant_source_state state
    left join participant_source_candidate source on source.source_rank < 99
    group by state.participant_total,
      state.participants_omitted_count,
      state.participant_count_completeness,
      state.source_data_invalid
  -- Financial documents are retained behind one 501st-row sentinel before
  -- status aggregation or exact numeric conversion.
  ), financial_currency_state as materialized (
    select context.currency_code,
           case upper(context.currency_code)
             when 'JPY' then 0
             when 'CAD' then 2
             when 'BHD' then 3
             when 'CLF' then 4
             when 'BIF' then 0 when 'CLP' then 0 when 'DJF' then 0
             when 'GNF' then 0 when 'ISK' then 0 when 'KMF' then 0
             when 'KRW' then 0 when 'PYG' then 0 when 'RWF' then 0
             when 'UGX' then 0 when 'UYI' then 0 when 'VND' then 0
             when 'VUV' then 0 when 'XAF' then 0 when 'XOF' then 0
             when 'XPF' then 0
             when 'IQD' then 3 when 'JOD' then 3 when 'KWD' then 3
             when 'LYD' then 3 when 'OMR' then 3 when 'TND' then 3
             when 'UYW' then 4
             when 'AED' then 2 when 'AFN' then 2 when 'ALL' then 2
             when 'AMD' then 2 when 'AOA' then 2 when 'ARS' then 2
             when 'AUD' then 2 when 'AWG' then 2 when 'AZN' then 2
             when 'BAM' then 2 when 'BBD' then 2 when 'BDT' then 2
             when 'BGN' then 2 when 'BMD' then 2 when 'BND' then 2
             when 'BOB' then 2 when 'BOV' then 2 when 'BRL' then 2
             when 'BSD' then 2 when 'BTN' then 2 when 'BWP' then 2
             when 'BYN' then 2 when 'BZD' then 2 when 'CDF' then 2
             when 'CHE' then 2 when 'CHW' then 2 when 'CNY' then 2
             when 'COP' then 2 when 'COU' then 2 when 'CRC' then 2
             when 'CUP' then 2 when 'CVE' then 2 when 'CZK' then 2
             when 'DKK' then 2 when 'DOP' then 2 when 'DZD' then 2
             when 'EGP' then 2 when 'ERN' then 2 when 'ETB' then 2
             when 'EUR' then 2 when 'FJD' then 2 when 'FKP' then 2
             when 'GBP' then 2 when 'GEL' then 2 when 'GHS' then 2
             when 'GIP' then 2 when 'GMD' then 2 when 'GTQ' then 2
             when 'GYD' then 2 when 'HKD' then 2 when 'HNL' then 2
             when 'HTG' then 2 when 'HUF' then 2 when 'IDR' then 2
             when 'ILS' then 2 when 'INR' then 2 when 'IRR' then 2
             when 'JMD' then 2 when 'KES' then 2 when 'KGS' then 2
             when 'KHR' then 2 when 'KPW' then 2 when 'KYD' then 2
             when 'KZT' then 2 when 'LAK' then 2 when 'LBP' then 2
             when 'LKR' then 2 when 'LRD' then 2 when 'LSL' then 2
             when 'MAD' then 2 when 'MDL' then 2 when 'MGA' then 2
             when 'MKD' then 2 when 'MMK' then 2 when 'MNT' then 2
             when 'MOP' then 2 when 'MRU' then 2 when 'MUR' then 2
             when 'MVR' then 2 when 'MWK' then 2 when 'MXN' then 2
             when 'MXV' then 2 when 'MYR' then 2 when 'MZN' then 2
             when 'NAD' then 2 when 'NGN' then 2 when 'NIO' then 2
             when 'NOK' then 2 when 'NPR' then 2 when 'NZD' then 2
             when 'PAB' then 2 when 'PEN' then 2 when 'PGK' then 2
             when 'PHP' then 2 when 'PKR' then 2 when 'PLN' then 2
             when 'QAR' then 2 when 'RON' then 2 when 'RSD' then 2
             when 'RUB' then 2 when 'SAR' then 2 when 'SBD' then 2
             when 'SCR' then 2 when 'SDG' then 2 when 'SEK' then 2
             when 'SGD' then 2 when 'SHP' then 2 when 'SLE' then 2
             when 'SOS' then 2 when 'SRD' then 2 when 'SSP' then 2
             when 'STN' then 2 when 'SVC' then 2 when 'SYP' then 2
             when 'SZL' then 2 when 'THB' then 2 when 'TJS' then 2
             when 'TMT' then 2 when 'TOP' then 2 when 'TRY' then 2
             when 'TTD' then 2 when 'TWD' then 2 when 'TZS' then 2
             when 'UAH' then 2 when 'USD' then 2 when 'USN' then 2
             when 'UYU' then 2 when 'UZS' then 2 when 'VED' then 2
             when 'VES' then 2 when 'WST' then 2 when 'XCD' then 2
             when 'YER' then 2 when 'ZAR' then 2 when 'ZMW' then 2
             when 'ZWL' then 2
             else null
           end::smallint as minor_exponent
    from authority_context context
  ), financial_document_source as materialized (
    select 'estimate_rollup'::text as component_kind,
           estimate.id as document_id,
           estimate.status,
           estimate.total::numeric as total,
           null::numeric as amount_paid,
           null::numeric as balance_due
    from requested_job job
    join public.estimates estimate
      on 'estimate_rollup' = any(p_financial_components)
     and estimate.company_id = p_company_id
     and estimate.deleted_at is null
     and (
       job.job_kind = 'opportunity'
         and estimate.opportunity_id = job.job_id
       or job.job_kind = 'project'
         and estimate.project_id = job.job_id::text
     )

    union all

    select 'invoice_rollup',
           invoice.id,
           invoice.status,
           invoice.total::numeric,
           invoice.amount_paid::numeric,
           invoice.balance_due::numeric
    from requested_job job
    join public.invoices invoice
      on 'invoice_rollup' = any(p_financial_components)
     and job.job_kind = 'project'
     and invoice.company_id = p_company_id
     and invoice.project_id = job.job_id
     and invoice.deleted_at is null
  ), financial_document_candidate as materialized (
    select source.*,
           row_number() over (
             order by source.component_kind, source.document_id
           ) as document_rank
    from financial_document_source source
    order by source.component_kind, source.document_id
    limit 501
  ), financial_input_state as materialized (
    select count(*) = 501 as source_query_bound,
           currency.minor_exponent is null
             or coalesce(bool_or(
               document.status is null
               or document.component_kind = 'estimate_rollup'
                  and document.status not in (
                    'draft', 'sent', 'viewed', 'approved',
                    'changes_requested', 'declined', 'converted',
                    'expired', 'superseded'
                  )
               or document.component_kind = 'invoice_rollup'
                  and document.status not in (
                    'draft', 'sent', 'awaiting_payment', 'partially_paid',
                    'past_due', 'paid', 'void', 'written_off'
                  )
               or document.total is null
               or document.total::text in ('NaN', 'Infinity', '-Infinity')
               or trunc(document.total * power(
                    10::numeric, currency.minor_exponent
                  )) is distinct from document.total * power(
                    10::numeric, currency.minor_exponent
                  )
               or abs(document.total * power(
                    10::numeric, currency.minor_exponent
                  )) > 9007199254740991::numeric
               or document.component_kind = 'invoice_rollup' and (
                 document.amount_paid is null
                 or document.balance_due is null
                 or document.amount_paid::text in (
                   'NaN', 'Infinity', '-Infinity'
                 )
                 or document.balance_due::text in (
                   'NaN', 'Infinity', '-Infinity'
                 )
                 or trunc(document.amount_paid * power(
                      10::numeric, currency.minor_exponent
                    )) is distinct from document.amount_paid * power(
                      10::numeric, currency.minor_exponent
                    )
                 or trunc(document.balance_due * power(
                      10::numeric, currency.minor_exponent
                    )) is distinct from document.balance_due * power(
                      10::numeric, currency.minor_exponent
                    )
                 or abs(document.amount_paid * power(
                      10::numeric, currency.minor_exponent
                    )) > 9007199254740991::numeric
                 or abs(document.balance_due * power(
                      10::numeric, currency.minor_exponent
                    )) > 9007199254740991::numeric
               )
             ), false) as source_data_invalid
    from financial_document_candidate document
    cross join financial_currency_state currency
    group by currency.minor_exponent
  ), financial_converted as materialized (
    select document.*,
           private.agent_money_to_minor_units(
             document.total, currency.currency_code
           ) as total_minor,
           case when document.component_kind = 'invoice_rollup' then
             private.agent_money_to_minor_units(
               document.amount_paid, currency.currency_code
             ) end as amount_paid_minor,
           case when document.component_kind = 'invoice_rollup' then
             private.agent_money_to_minor_units(
               document.balance_due, currency.currency_code
             ) end as balance_due_minor
    from financial_document_candidate document
    cross join financial_currency_state currency
    cross join financial_input_state state
    where document.document_rank <= 500
      and not state.source_query_bound
      and not state.source_data_invalid
  ), financial_source_state as materialized (
    select input.source_query_bound,
           input.source_data_invalid
             or coalesce(abs(aggregate.total_minor) >
                  9007199254740991::numeric, false)
             or coalesce(abs(aggregate.amount_paid_minor) >
                  9007199254740991::numeric, false)
             or coalesce(abs(aggregate.balance_due_minor) >
                  9007199254740991::numeric, false)
             as source_data_invalid
    from financial_input_state input
    cross join lateral (
      select max(abs(component.total_minor)) as total_minor,
             max(abs(component.amount_paid_minor)) as amount_paid_minor,
             max(abs(component.balance_due_minor)) as balance_due_minor
      from (
        select document.component_kind,
               sum(document.total_minor)::numeric as total_minor,
               sum(document.amount_paid_minor)::numeric as amount_paid_minor,
               sum(document.balance_due_minor)::numeric as balance_due_minor
        from financial_converted document
        group by document.component_kind
      ) component
    ) aggregate
  ), financial_status_rollup as materialized (
    select document.component_kind,
           document.status,
           count(*)::integer as status_count
    from financial_converted document
    group by document.component_kind, document.status
  ), estimate_rollup as materialized (
    select count(document.document_id)::integer as document_count,
           sum(document.total_minor) as amount_minor,
           currency.currency_code,
           coalesce((select jsonb_agg(jsonb_build_object(
             'status', status.status,
             'count', status.status_count
           ) order by status.status)
           from financial_status_rollup status
           where status.component_kind = 'estimate_rollup'), '[]'::jsonb)
             as status_counts
    from financial_currency_state currency
    left join financial_converted document
      on document.component_kind = 'estimate_rollup'
    group by currency.currency_code
  ), invoice_rollup as materialized (
    select count(document.document_id)::integer as document_count,
           sum(document.total_minor) as total_amount_minor,
           sum(document.amount_paid_minor) as paid_amount_minor,
           sum(document.balance_due_minor) as due_amount_minor,
           currency.currency_code,
           coalesce((select jsonb_agg(jsonb_build_object(
             'status', status.status,
             'count', status.status_count
           ) order by status.status)
           from financial_status_rollup status
           where status.component_kind = 'invoice_rollup'), '[]'::jsonb)
             as status_counts
    from financial_currency_state currency
    left join financial_converted document
      on document.component_kind = 'invoice_rollup'
    group by currency.currency_code
  ), opportunity_status_activity as materialized (
    select transition.transitioned_at as occurred_at,
           'job_status_event'::text as event_kind,
           'stage_transition:' || transition.id::text as event_ref,
           jsonb_build_object(
             'event_ref', 'stage_transition:' || transition.id::text,
             'event_kind', 'job_status_event',
             'occurred_at', private.agent_rfc3339_utc(
               transition.transitioned_at
             ),
             'from_status', case when transition.from_stage is null then null
               else jsonb_build_object(
                 'kind', 'opportunity', 'value', transition.from_stage
               ) end,
             'to_status', jsonb_build_object(
               'kind', 'opportunity', 'value', transition.to_stage
             ),
             'status_version', null
           ) as event,
           transition.transitioned_at is null
             or transition.to_stage not in (
               'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
               'negotiation', 'won', 'lost', 'discarded'
             )
             or transition.from_stage is not null
                and transition.from_stage not in (
                  'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
                  'negotiation', 'won', 'lost', 'discarded'
                ) as source_data_invalid
    from requested_job job
    join public.stage_transitions transition
      on 'activity' = any(p_sections)
     and job.job_kind = 'opportunity'
     and transition.company_id = p_company_id
     and transition.opportunity_id = job.job_id
    cross join authority_context context
    where transition.transitioned_at <= context.read_at
    order by transition.transitioned_at desc, transition.id desc
    limit 51
  ), project_status_activity as materialized (
    select status_event.requested_at as occurred_at,
           'job_status_event'::text as event_kind,
           'project_status_event:' || status_event.id::text as event_ref,
           jsonb_build_object(
             'event_ref', 'project_status_event:' || status_event.id::text,
             'event_kind', 'job_status_event',
             'occurred_at', private.agent_rfc3339_utc(
               status_event.requested_at
             ),
             'from_status', case when status_event.old_status is null then null
               else jsonb_build_object(
                 'kind', 'project', 'value', status_event.old_status
               ) end,
             'to_status', jsonb_build_object(
               'kind', 'project', 'value', status_event.new_status
             ),
             'status_version', status_event.project_status_version
           ) as event,
           status_event.requested_at is null
             or status_event.new_status not in (
               'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
               'closed', 'archived'
             )
             or status_event.old_status is not null
                and status_event.old_status not in (
                  'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
                  'closed', 'archived'
                )
             or status_event.project_status_version not between
                  0 and 9007199254740991 as source_data_invalid
    from requested_job job
    join public.project_status_lifecycle_outbox status_event
      on 'activity' = any(p_sections)
     and job.job_kind = 'project'
     and status_event.company_id = p_company_id
     and status_event.project_id = job.job_id
    cross join authority_context context
    where status_event.requested_at <= context.read_at
    order by status_event.requested_at desc, status_event.id desc
    limit 51
  ), task_activity as materialized (
    select task_event.created_at as occurred_at,
           'task_event'::text as event_kind,
           'task_mutation_event:' || task_event.id::text as event_ref,
           jsonb_build_object(
             'event_ref', 'task_mutation_event:' || task_event.id::text,
             'event_kind', 'task_event',
             'occurred_at', private.agent_rfc3339_utc(
               task_event.created_at
             ),
             'task_ref', jsonb_build_object(
               'kind', 'project_task', 'id', task_event.task_id
             ),
             'event_type', task_event.event_type,
             'schedule_version', task_event.task_schedule_version
           ) as event,
           task_event.created_at is null
             or task_event.event_type not in (
               'task_assigned', 'task_completed', 'schedule_change'
             )
             or task_event.task_schedule_version not between
                  0 and 9007199254740991 as source_data_invalid
    from authorized_project_source project
    join public.task_mutation_events task_event
      on 'activity' = any(p_sections)
     and task_event.company_id = p_company_id
     and task_event.project_id = project.id
    cross join authority_context context
    where private.agent_user_can_access_entity(
      p_actor_user_id,
      p_company_id,
      'task',
      task_event.task_id,
      'view'
    )
      and task_event.created_at <= context.read_at
    order by task_event.created_at desc, task_event.id desc
    limit 51
  ), activity_source as materialized (
    select event.*,
           row_number() over (
             order by event.occurred_at desc, event.event_kind,
               event.event_ref desc
           ) as event_rank,
           count(*) over ()::integer as event_total
    from (
      select opportunity.* from opportunity_status_activity opportunity
      union all
      select project.* from project_status_activity project
      union all
      select task.* from task_activity task
    ) event
    order by event.occurred_at desc, event.event_kind, event.event_ref desc
    limit 51
  ), activity_source_state as materialized (
    select count(*) = 51 as event_sentinel,
           coalesce(bool_or(activity.source_data_invalid), false)
             as source_data_invalid
    from activity_source activity
  ), conversation_anchor_candidate as materialized (
    select anchor.conversation_id,
           row_number() over (
             order by anchor.conversation_id
           ) as anchor_rank
    from requested_job job
    join public.job_conversation_anchors anchor
      on 'conversation' = any(p_sections)
     and anchor.company_id = p_company_id
     and anchor.anchor_kind = job.job_kind
     and anchor.source_id = job.job_id
    order by anchor.conversation_id
    limit 2
  ), conversation_anchor_state as materialized (
    select count(*) > 1 as source_data_invalid
    from conversation_anchor_candidate
  ), current_conversation_source as materialized (
    select conversation.id,
           conversation.current_memory_version_id
    from conversation_anchor_candidate anchor
    join public.job_conversations conversation
      on anchor.anchor_rank = 1
     and conversation.id = anchor.conversation_id
     and conversation.company_id = p_company_id
  ), conversation_visible_turn as materialized (
    select turn.id,
           turn.delivered_at
    from requested_job job
    join current_conversation_source conversation on true
    join public.job_conversation_turns turn
      on turn.company_id = p_company_id
     and turn.conversation_id = conversation.id
     and private.user_can_view_inbox_connection(
       p_actor_user_id,
       p_company_id,
       turn.source_connection_id,
       job.opportunity_id
     )
    cross join authority_context context
    where turn.delivered_at <= context.read_at
    order by turn.delivered_at desc, turn.id desc
    limit 251
  ), conversation_turn_state as materialized (
    select count(*)::integer as actor_visible_delivered_turn_count,
           max(turn.delivered_at) as last_actor_visible_delivered_at
    from conversation_visible_turn turn
  ), conversation_memory_source as materialized (
    select memory.version_number,
           memory.turn_high_watermark_id,
           memory.version_number not between 0 and 9007199254740991
             as source_data_invalid,
           exists (
             select 1
             from requested_job job
             join public.job_conversation_turns high_watermark
              on high_watermark.id = memory.turn_high_watermark_id
             and high_watermark.company_id = p_company_id
             and high_watermark.conversation_id = conversation.id
              and high_watermark.delivered_at <= (
                select context.read_at from authority_context context
              )
              and private.user_can_view_inbox_connection(
                p_actor_user_id,
                p_company_id,
                high_watermark.source_connection_id,
                job.opportunity_id
              )
           ) as high_watermark_actor_visible
    from current_conversation_source conversation
    join public.job_memory_versions memory
      on p_inbox_scope = 'all'
     and memory.id = conversation.current_memory_version_id
     and memory.company_id = p_company_id
     and memory.conversation_id = conversation.id
  ), conversation_source as materialized (
    select conversation.id,
           turn_state.actor_visible_delivered_turn_count,
           case when turn_state.actor_visible_delivered_turn_count = 251
             then 'lower_bound' else 'exact' end
             as actor_visible_delivered_turn_count_completeness,
           turn_state.last_actor_visible_delivered_at,
           case when p_inbox_scope = 'all'
                  and not coalesce(memory.source_data_invalid, false)
             then memory.version_number else null end as memory_version,
           case when p_inbox_scope = 'all'
                  and not coalesce(memory.source_data_invalid, false)
                  and memory.high_watermark_actor_visible
             then memory.turn_high_watermark_id else null end
             as turn_high_watermark_id,
           anchor_state.source_data_invalid
             or coalesce(memory.source_data_invalid, false)
             as source_data_invalid
    from conversation_turn_state turn_state
    cross join conversation_anchor_state anchor_state
    left join current_conversation_source conversation on true
    left join conversation_memory_source memory on true
  ), requested_section as materialized (
    select requested.section,
           requested.ordinality as section_rank,
           'evidence:job_summary_section_projection:' || p_job_kind || ':' ||
             p_job_id::text || ':' || requested.section as evidence_id
    from unnest(p_sections) with ordinality requested(section, ordinality)
  ), raw_section as materialized (
    select requested.section,
           requested.section_rank,
           case requested.section
             when 'identity' then case when
               job.title is null
               or char_length(btrim(job.title)) not between 1 and 1000
               or job.address is not null
                  and nullif(btrim(job.address), '') is not null
                  and char_length(btrim(job.address)) > 2000
               or job.created_at is null
               or job.updated_at is null
               or job.created_at > (
                 select context.read_at from authority_context context
               )
               or job.updated_at > (
                 select context.read_at from authority_context context
               )
               or job.created_at > job.updated_at
               or job.lifecycle_state not in ('active', 'terminal', 'archived')
               or job.job_kind = 'opportunity' and job.status not in (
                 'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up',
                 'negotiation', 'won', 'lost', 'discarded'
               )
               or job.job_kind = 'project' and job.status not in (
                 'rfq', 'estimated', 'accepted', 'in_progress', 'completed',
                 'closed', 'archived'
               ) then jsonb_build_object(
                 'section', 'identity',
                 'state', 'gap',
                 'value', null,
                 'gaps', jsonb_build_array(jsonb_build_object(
                   'code', 'SOURCE_DATA_INVALID',
                   'source_kind', 'job_identity'
                 )),
                 'evidence_ids', jsonb_build_array(requested.evidence_id)
               ) else jsonb_build_object(
                 'section', 'identity',
                 'state', 'evaluated',
                 'value', jsonb_build_object(
                   'job_ref', jsonb_build_object(
                     'kind', job.job_kind, 'id', job.job_id
                   ),
                   'display_title', btrim(job.title),
                   'address', nullif(btrim(job.address), ''),
                   'content_kind', 'untrusted_business_data',
                   'lifecycle_state', job.lifecycle_state,
                   'status', jsonb_build_object(
                     'kind', job.job_kind, 'value', job.status
                   ),
                   'dates', jsonb_build_object(
                     'kind', job.job_kind,
                     'created_at', private.agent_rfc3339_utc(job.created_at),
                     'updated_at', private.agent_rfc3339_utc(job.updated_at)
                   ) || case when job.job_kind = 'project' then
                     jsonb_build_object(
                       'start_date', case when job.start_date is null then null
                         else job.start_date::text end,
                       'end_date', case when job.end_date is null then null
                         else job.end_date::text end
                     ) else '{}'::jsonb end
                 ),
                 'gaps', '[]'::jsonb,
                 'evidence_ids', jsonb_build_array(requested.evidence_id)
               ) end
             when 'schedule' then case
               when schedule_failure.source_query_bound then
                 jsonb_build_object(
                   'section', 'schedule',
                   'state', 'gap',
                   'value', null,
                   'gaps', jsonb_build_array(jsonb_build_object(
                     'code', 'SOURCE_QUERY_BOUND',
                     'source_kind', 'task_schedule'
                   )),
                   'evidence_ids', jsonb_build_array(requested.evidence_id)
                 )
               when schedule_failure.source_data_invalid then
                 jsonb_build_object(
                   'section', 'schedule',
                   'state', 'gap',
                   'value', null,
                   'gaps', jsonb_build_array(jsonb_build_object(
                     'code', 'SOURCE_DATA_INVALID',
                     'source_kind', 'task_schedule'
                   )),
                   'evidence_ids', jsonb_build_array(requested.evidence_id)
                 )
               else jsonb_build_object(
                 'section', 'schedule',
                 'state', 'evaluated',
                 'value', jsonb_build_object(
                   'occurrences', coalesce((select jsonb_agg(
                     occurrence.occurrence order by
                       occurrence.scheduled_start_utc,
                       occurrence.task_id
                   ) from summary_schedule_occurrence occurrence
                   where occurrence.occurrence_rank <= 10), '[]'::jsonb),
                   'occurrence_total', case
                     when schedule_failure.occurrence_sentinel then 11
                     else (select count(*)::integer
                       from summary_schedule_occurrence) end,
                   'occurrences_omitted_count', case
                     when schedule_failure.occurrence_sentinel then 1 else 0 end,
                   'count_completeness', case
                     when schedule_failure.occurrence_sentinel
                       then 'lower_bound' else 'exact' end
                 ),
                 'gaps', '[]'::jsonb,
                 'evidence_ids', jsonb_build_array(requested.evidence_id)
               ) end
             when 'readiness' then jsonb_build_object(
               'section', 'readiness',
               'state', 'readiness_sources',
               'value', readiness.raw_sources,
               'gaps', '[]'::jsonb,
               'evidence_ids', jsonb_build_array(requested.evidence_id)
             )
             when 'participants' then case when
               participant.source_data_invalid
               or participant.participant_count_completeness not in (
                 'exact', 'lower_bound'
               )
               or participant.participant_count_completeness = 'exact' and (
                 participant.participant_total <>
                   jsonb_array_length(participant.participants)
                 or participant.participants_omitted_count <> 0
               )
               or participant.participant_count_completeness = 'lower_bound'
                  and (
                    participant.participant_total <> 51
                    or participant.participants_omitted_count <> 1
                    or jsonb_array_length(participant.participants) <> 50
                  ) then jsonb_build_object(
                 'section', 'participants',
                 'state', 'gap',
                 'value', null,
                 'gaps', jsonb_build_array(jsonb_build_object(
                   'code', 'SOURCE_DATA_INVALID',
                   'source_kind', 'job_participants'
                 )),
                 'evidence_ids', jsonb_build_array(requested.evidence_id)
               ) else jsonb_build_object(
                 'section', 'participants',
                 'state', 'participant_sources',
                 'value', jsonb_build_object(
                   'participants', participant.participants,
                   'participant_total', participant.participant_total,
                   'participants_omitted_count',
                     participant.participants_omitted_count,
                   'participant_count_completeness',
                     participant.participant_count_completeness
                 ),
                 'gaps', '[]'::jsonb,
                 'evidence_ids', jsonb_build_array(requested.evidence_id)
               ) end
             when 'financials' then case
               when financial_state.source_query_bound then
                 jsonb_build_object(
                   'section', 'financials',
                   'state', 'gap',
                   'value', null,
                   'gaps', jsonb_build_array(jsonb_build_object(
                     'code', 'SOURCE_QUERY_BOUND',
                     'source_kind', 'job_financials'
                   )),
                   'evidence_ids', jsonb_build_array(requested.evidence_id)
                 )
               when financial_state.source_data_invalid then
                 jsonb_build_object(
                   'section', 'financials',
                   'state', 'gap',
                   'value', null,
                   'gaps', jsonb_build_array(jsonb_build_object(
                     'code', 'SOURCE_DATA_INVALID',
                     'source_kind', 'job_financials'
                   )),
                   'evidence_ids', jsonb_build_array(requested.evidence_id)
                 )
               else jsonb_build_object(
                 'section', 'financials',
                 'state', 'evaluated',
                 'value', jsonb_build_object(
                   'components', (select jsonb_agg(
                     case component.value
                       when 'estimate_rollup' then jsonb_build_object(
                         'kind', 'estimate_rollup',
                         'document_count', estimate.document_count,
                         'total', case when estimate.document_count = 0
                           then null else jsonb_build_object(
                             'amount_minor', estimate.amount_minor,
                             'currency', estimate.currency_code
                           ) end,
                         'status_counts', estimate.status_counts
                       )
                       else jsonb_build_object(
                         'kind', 'invoice_rollup',
                         'document_count', invoice.document_count,
                         'total', case when invoice.document_count = 0
                           then null else jsonb_build_object(
                             'amount_minor', invoice.total_amount_minor,
                             'currency', invoice.currency_code
                           ) end,
                         'amount_paid', case when invoice.document_count = 0
                           then null else jsonb_build_object(
                             'amount_minor', invoice.paid_amount_minor,
                             'currency', invoice.currency_code
                           ) end,
                         'balance_due', case when invoice.document_count = 0
                           then null else jsonb_build_object(
                             'amount_minor', invoice.due_amount_minor,
                             'currency', invoice.currency_code
                           ) end,
                         'status_counts', invoice.status_counts
                       ) end order by component.ordinality
                   ) from unnest(p_financial_components) with ordinality
                     component(value, ordinality)
                   cross join estimate_rollup estimate
                   cross join invoice_rollup invoice)
                 ),
                 'gaps', '[]'::jsonb,
                 'evidence_ids', jsonb_build_array(requested.evidence_id)
               ) end
             when 'activity' then case
               when activity_state.source_data_invalid then
                 jsonb_build_object(
                   'section', 'activity',
                   'state', 'gap',
                   'value', null,
                   'gaps', jsonb_build_array(jsonb_build_object(
                     'code', 'SOURCE_DATA_INVALID',
                     'source_kind', 'job_activity'
                   )),
                   'evidence_ids', jsonb_build_array(requested.evidence_id)
                 )
               else jsonb_build_object(
                 'section', 'activity',
                 'state', 'evaluated',
                 'value', jsonb_build_object(
                   'events', coalesce((select jsonb_agg(
                     activity.event order by activity.occurred_at desc,
                       activity.event_kind, activity.event_ref desc
                   ) from activity_source activity
                   where activity.event_rank <= 50), '[]'::jsonb),
                   'event_total', case when activity_state.event_sentinel
                     then 51 else (select count(*)::integer
                       from activity_source) end,
                   'events_omitted_count', case
                     when activity_state.event_sentinel then 1 else 0 end,
                   'count_completeness', case
                     when activity_state.event_sentinel
                       then 'lower_bound' else 'exact' end
                 ),
                 'gaps', '[]'::jsonb,
                 'evidence_ids', jsonb_build_array(requested.evidence_id)
               ) end
             when 'conversation' then case
               when conversation.source_data_invalid then
                 jsonb_build_object(
                   'section', 'conversation',
                   'state', 'gap',
                   'value', null,
                   'gaps', jsonb_build_array(jsonb_build_object(
                     'code', 'SOURCE_DATA_INVALID',
                     'source_kind', 'job_conversation'
                   )),
                   'evidence_ids', jsonb_build_array(requested.evidence_id)
                 )
               else jsonb_build_object(
                 'section', 'conversation',
                 'state', 'evaluated',
                 'value', jsonb_build_object(
                   'conversation_id', conversation.id,
                   'actor_visible_delivered_turn_count',
                     conversation.actor_visible_delivered_turn_count,
                   'actor_visible_delivered_turn_count_completeness',
                     conversation.actor_visible_delivered_turn_count_completeness,
                   'last_actor_visible_delivered_at', case
                     when conversation.last_actor_visible_delivered_at is null
                       then null
                     else private.agent_rfc3339_utc(
                       conversation.last_actor_visible_delivered_at
                     ) end,
                   'memory_version', conversation.memory_version,
                   'turn_high_watermark_id',
                     conversation.turn_high_watermark_id
                 ),
                 'gaps', '[]'::jsonb,
                 'evidence_ids', jsonb_build_array(requested.evidence_id)
               ) end
           end as raw
    from requested_section requested
    cross join requested_job job
    left join summary_schedule_failure_state schedule_failure
      on requested.section = 'schedule'
    left join readiness_raw_source readiness
      on requested.section = 'readiness'
    left join participant_source participant on true
    left join financial_source_state financial_state
      on requested.section = 'financials'
    left join activity_source_state activity_state
      on requested.section = 'activity'
    left join conversation_source conversation
      on requested.section = 'conversation'
  ), section_projection as materialized (
    select section.*,
           jsonb_build_object(
             'actor_user_id', p_actor_user_id,
             'company_id', p_company_id,
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'canonical_input', request.canonical_input,
             'read_at', private.agent_rfc3339_utc(context.read_at),
             'source_revision', context.source_revision,
             'history_revision', context.history_revision,
             'retained_proof_sources', '[]'::jsonb,
             'section', section.raw
           ) as projection,
           context.read_at,
           context.source_revision,
           context.history_revision
    from raw_section section
    cross join authority_context context
    cross join canonical_request request
  ), section_hashed as materialized (
    select projection.*,
           'sha256:' || encode(extensions.digest(convert_to(
             private.canonical_agent_projection_json(projection.projection),
             'UTF8'
           ), 'sha256'), 'hex') as source_content_hash
    from section_projection projection
  ), section_claims as materialized (
    select section.*,
           jsonb_build_object(
             'source_domain', 'operations',
             'source_type', 'job_summary_section_projection',
             'source_id', p_job_kind || ':' || p_job_id::text || ':' ||
               section.section,
             'version', 'job-summary-section-projection:v1:' ||
               section.source_content_hash
           ) as source_version,
           'evidence:job_summary_section_projection:' || p_job_kind || ':' ||
             p_job_id::text || ':' || section.section as evidence_id
    from section_hashed section
  ), summary_projection as materialized (
    select context.*,
           jsonb_build_object(
             'actor_user_id', p_actor_user_id,
             'company_id', p_company_id,
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'canonical_input', request.canonical_input,
             'read_at', private.agent_rfc3339_utc(context.read_at),
             'source_revision', context.source_revision,
             'history_revision', context.history_revision,
             'retained_proof_sources', coalesce((
               select jsonb_agg(section.source_version
                 order by section.section_rank)
               from section_claims section
             ), '[]'::jsonb),
             'summary', jsonb_build_object(
               'requested_job', jsonb_build_object(
                 'kind', p_job_kind, 'id', p_job_id
               ),
               'requested_sections', to_jsonb(p_sections),
               'section_count', cardinality(p_sections),
               'gaps', '[]'::jsonb
             )
           ) as projection
    from authority_context context
    cross join canonical_request request
  ), summary_hashed as materialized (
    select summary.*,
           'sha256:' || encode(extensions.digest(convert_to(
             private.canonical_agent_projection_json(summary.projection),
             'UTF8'
           ), 'sha256'), 'hex') as source_content_hash
    from summary_projection summary
  )
  select jsonb_build_object(
    'company_id', p_company_id,
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'read_at', private.agent_rfc3339_utc(summary.read_at),
    'source_fence', jsonb_build_object(
      'source_domain', 'operations',
      'source_type', 'operational_read_revision',
      'source_id', 'private.agent_operational_read_revisions',
      'version', 'revision:' || summary.source_revision::text
    ),
    'history_fence', jsonb_build_object(
      'source_domain', 'operations',
      'source_type', 'job_history_read_revision',
      'source_id', 'private.agent_job_history_revisions',
      'version', 'revision:' || summary.history_revision::text
    ),
    'requested_job', jsonb_build_object(
      'kind', p_job_kind, 'id', p_job_id
    ),
    'section_claims', coalesce((
      select jsonb_agg(jsonb_build_object(
        'raw', section.raw,
        'proof', jsonb_build_object(
          'source_version', section.source_version,
          'source_content_hash', section.source_content_hash,
          'evidence_id', section.evidence_id,
          'projection', section.projection
        ),
        'source_version', section.source_version,
        'evidence', jsonb_build_array(jsonb_build_object(
          'evidence_id', section.evidence_id,
          'source_domain', 'operations',
          'source_type', 'job_summary_section_projection',
          'source_id', p_job_kind || ':' || p_job_id::text || ':' ||
            section.section,
          'version', section.source_version ->> 'version',
          'occurred_at', private.agent_rfc3339_utc(summary.read_at),
          'relationship', 'supports',
          'trust', 'authoritative_ops',
          'locator', 'ops://evidence/' ||
            replace(section.evidence_id, ':', '%3A')
        ))
      ) order by requested.section_rank)
      from section_claims section
      join requested_section requested using (section)
    ), '[]'::jsonb),
    'gaps', '[]'::jsonb,
    'summary_claim', jsonb_build_object(
      'raw', summary.projection -> 'summary',
      'proof', jsonb_build_object(
        'source_version', jsonb_build_object(
          'source_domain', 'operations',
          'source_type', 'job_summary_projection',
          'source_id', p_job_kind || ':' || p_job_id::text,
          'version', 'job-summary-projection:v1:' ||
            summary.source_content_hash
        ),
        'source_content_hash', summary.source_content_hash,
        'evidence_id', 'evidence:job_summary_projection:' || p_job_kind || ':' ||
          p_job_id::text,
        'projection', summary.projection
      ),
      'source_version', jsonb_build_object(
        'source_domain', 'operations',
        'source_type', 'job_summary_projection',
        'source_id', p_job_kind || ':' || p_job_id::text,
        'version', 'job-summary-projection:v1:' || summary.source_content_hash
      ),
      'evidence', jsonb_build_array(jsonb_build_object(
        'evidence_id', 'evidence:job_summary_projection:' || p_job_kind || ':' ||
          p_job_id::text,
        'source_domain', 'operations',
        'source_type', 'job_summary_projection',
        'source_id', p_job_kind || ':' || p_job_id::text,
        'version', 'job-summary-projection:v1:' || summary.source_content_hash,
        'occurred_at', private.agent_rfc3339_utc(summary.read_at),
        'relationship', 'supports',
        'trust', 'authoritative_ops',
        'locator', 'ops://evidence/' || replace(
          'evidence:job_summary_projection:' || p_job_kind || ':' ||
            p_job_id::text,
          ':',
          '%3A'
        )
      ))
    ),
    'prompt_reduction', jsonb_build_object(
      'max_output_characters', 60000,
      'atomic_claim_kind', 'job_summary_section',
      'retention', 'all_or_error',
      'claim_path', 'section_claims',
      'envelope_claim_path', 'summary_claim'
    )
  )
  into v_result
  from summary_hashed summary
  -- count(*) from section_claims = cardinality(p_sections) is the wire
  -- invariant; every requested section has one independent atomic claim.
  where (select count(*) from section_claims) = cardinality(p_sections);

  if v_result is null then
    raise exception 'agent_job_summary_not_found_or_not_visible'
      using errcode = 'P0002';
  end if;
  if octet_length(v_result::text) > 1048576 then
    raise exception 'agent_job_summary_source_query_bound'
      using errcode = '54000';
  end if;
  return v_result;
end;
$function$
