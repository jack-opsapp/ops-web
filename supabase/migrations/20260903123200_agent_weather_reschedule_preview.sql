-- Inactive OPS MCP weather-reschedule preview.
--
-- This additive migration exposes one service-role-only, read-only source
-- snapshot and its exact replay assertion. It cannot move work, edit a
-- calendar, create a provider draft, write a message, or send anything.

begin;

set local timezone = 'UTC';

do $prerequisites$
declare
  v_relation text;
  v_signature text;
begin
  foreach v_relation in array array[
    'public.clients', 'public.companies', 'public.email_suppressions',
    'public.project_tasks', 'public.projects', 'public.sub_clients',
    'public.task_types', 'public.users', 'public.weather_forecasts',
    'private.mcp_oauth_clients', 'private.mcp_oauth_grants'
  ] loop
    if pg_catalog.to_regclass(v_relation) is null then
      raise exception 'agent_weather_reschedule_prerequisite_missing: %',
        v_relation using errcode = '55000';
    end if;
  end loop;

  foreach v_signature in array array[
    'private.resolve_agent_actor_authority(uuid,uuid,text[])',
    'private.mcp_oauth_labels_for_scopes(text[],text)',
    'private.agent_prompt_text_is_safe(text,boolean)',
    'private.agent_user_can_access_entity(uuid,uuid,text,uuid,text)',
    'extensions.digest(bytea,text)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'agent_weather_reschedule_prerequisite_missing: %',
        v_signature using errcode = '55000';
    end if;
  end loop;
end;
$prerequisites$;

create or replace function private.mcp_oauth_labels_for_scopes(
  p_scopes text[],
  p_consent_catalog_revision text
) returns text[]
language sql
immutable
strict
set search_path = ''
as $function$
  with labelled as materialized (
    select requested.ordinal,
           case requested.scope
             when 'ops.jobs.read' then 'See your jobs and their status'
             when 'ops.schedule.read' then
               'See your schedule and who''s assigned'
             when 'ops.customers.read' then 'See your clients and their jobs'
             when 'ops.customer_contacts.read' then
               'See who to contact on a job and how to reach them'
             when 'ops.photos.read' then 'See which jobs are missing photos'
             when 'ops.correspondence.read' then
               'See client email history on your jobs'
             when 'ops.financials.read' then
               'See estimate and invoice summaries on your jobs'
             when 'ops.tasks.read' then
               'See tasks and work that needs attention'
             when 'ops.site_visits.read' then
               'See site visits and their evidence status'
             when 'ops.files.read' then
               'See authorized job photos, files, and documents'
             when 'ops.financial_documents.read' then
               'See estimates and invoices in detail'
             when 'ops.payments.read' then
               'See payment records on authorized invoices'
             when 'ops.expenses.read' then
               'See authorized expenses and reimbursements'
             when 'ops.catalog.read' then
               'See products, stock levels, and selling prices'
             when 'ops.purchasing.read' then 'See purchase orders'
             when 'ops.catalog_costs.read' then
               'See authorized supplier cost facts'
             when 'ops.company.read' then
               'See the company operating profile'
             when 'ops.team.read' then
               'See the team directory and company availability'
             when 'ops.integrations.read' then
               'See integration health without credentials'
             when 'ops.operations.read' then
               'See authorized work queues and operational summaries'
             when 'ops.financials.prepare' then case
               when p_consent_catalog_revision in (
                 '2026-09-02.mcp-consent-catalog.v5',
                 '2026-09-03.mcp-consent-catalog.v6'
               ) then 'Prepare exact draft estimates from authorized past jobs'
             end
             when 'ops.communications.prepare' then case
               when p_consent_catalog_revision =
                 '2026-09-03.mcp-consent-catalog.v6'
                 then 'Prepare exact client schedule-update drafts for approval'
             end
             when 'ops.schedule.prepare' then case
               when p_consent_catalog_revision =
                 '2026-09-03.mcp-consent-catalog.v6'
                 then 'Prepare exact weather reschedule proposals for approval'
             end
             when 'ops.operations.prepare' then case
               when p_consent_catalog_revision =
                 '2026-08-30.mcp-consent-catalog.v2'
                 then 'Prepare end-of-day closeouts and exact OPS filing previews'
               when p_consent_catalog_revision =
                 '2026-08-31.mcp-consent-catalog.v3'
                 then 'Prepare collections aging and customer drafts for approval'
               when p_consent_catalog_revision in (
                 '2026-09-01.mcp-consent-catalog.v4',
                 '2026-09-02.mcp-consent-catalog.v5',
                 '2026-09-03.mcp-consent-catalog.v6'
               ) then 'Prepare recurring-service price-change previews and customer notice drafts'
             end
           end as label
    from pg_catalog.unnest(p_scopes) with ordinality
      as requested(scope, ordinal)
  )
  select case
    when p_consent_catalog_revision not in (
           '2026-08-22.mcp-consent-catalog.v1',
           '2026-08-30.mcp-consent-catalog.v2',
           '2026-08-31.mcp-consent-catalog.v3',
           '2026-09-01.mcp-consent-catalog.v4',
           '2026-09-02.mcp-consent-catalog.v5',
           '2026-09-03.mcp-consent-catalog.v6'
         )
      or pg_catalog.cardinality(p_scopes) not between 1 and 32
      or exists (
        select 1 from pg_catalog.unnest(p_scopes) scope(value)
        where scope.value is distinct from pg_catalog.btrim(scope.value)
           or nullif(scope.value, '') is null
           or pg_catalog.length(scope.value) > 128
      )
      or pg_catalog.cardinality(array(
           select distinct scope.value
           from pg_catalog.unnest(p_scopes) scope(value)
         )) <> pg_catalog.cardinality(p_scopes)
      or exists (select 1 from labelled where label is null)
      then null::text[]
    else array(
      select labelled.label from labelled order by labelled.ordinal
    )
  end
$function$;

revoke all on function private.mcp_oauth_labels_for_scopes(text[], text)
  from public, anon, authenticated, service_role;

create or replace function private.assert_agent_weather_reschedule_authority(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_capability_manifest_revision text,
  p_exposure_revision text,
  p_capability_id text,
  p_capability_revision text
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_required_scopes constant text[] := array[
    'ops.communications.prepare', 'ops.company.read',
    'ops.customer_contacts.read', 'ops.customers.read', 'ops.jobs.read',
    'ops.schedule.prepare', 'ops.schedule.read'
  ];
  v_required_permissions constant text[] := array[
    'calendar.edit', 'calendar.view', 'clients.view', 'inbox.send',
    'inbox.view', 'projects.edit', 'projects.view', 'tasks.edit', 'tasks.view'
  ];
  v_exposure_scopes constant text[] := array[
    'ops.catalog.read', 'ops.communications.prepare', 'ops.company.read',
    'ops.correspondence.read', 'ops.customer_contacts.read',
    'ops.customers.read', 'ops.expenses.read',
    'ops.financial_documents.read', 'ops.financials.prepare',
    'ops.financials.read', 'ops.jobs.read', 'ops.operations.prepare',
    'ops.operations.read', 'ops.payments.read', 'ops.schedule.prepare',
    'ops.schedule.read', 'ops.site_visits.read', 'ops.tasks.read',
    'ops.team.read'
  ];
  v_permission_snapshot_revision text;
  v_required_permission_json jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null or p_company_id is null
     or p_oauth_grant_id is null or p_oauth_client_id is null
     or nullif(pg_catalog.btrim(p_grant_revision), '') is null
     or p_granted_scope_ceiling is null
     or nullif(pg_catalog.btrim(p_permission_snapshot_revision), '') is null
     or p_capability_manifest_revision is distinct from
       '2026-09-03.capability-manifest.v17'
     or p_exposure_revision is distinct from
       '2026-09-03.mcp-exposure.v11'
     or p_capability_id is distinct from 'prepare_weather_reschedule'
     or p_capability_revision is distinct from
       'prepare_weather_reschedule:2026-09-03.v1'
     or not v_required_scopes <@ p_granted_scope_ceiling then
    raise exception 'AGENT_WEATHER_RESCHEDULE_BINDING_INVALID'
      using errcode = '42501';
  end if;

  select coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'permission', required.permission, 'scope', 'all'
             ) order by required.permission
           ),
           '[]'::jsonb
         )
    into v_required_permission_json
  from pg_catalog.unnest(v_required_permissions) required(permission);

  select authority.permission_snapshot_revision
    into v_permission_snapshot_revision
  from private.resolve_agent_actor_authority(
    p_actor_user_id, p_company_id, v_required_permissions
  ) authority
  where authority.effective_permissions @> v_required_permission_json;

  if v_permission_snapshot_revision is null
     or v_permission_snapshot_revision is distinct from
       p_permission_snapshot_revision then
    raise exception 'AGENT_WEATHER_RESCHEDULE_AUTHORITY_STALE_OR_DENIED'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from private.mcp_oauth_grants grant_record
    join private.mcp_oauth_clients client_record
      on client_record.client_id = grant_record.client_id
     and client_record.disabled_at is null
     and client_record.scope_ceiling = v_exposure_scopes
     and client_record.scope =
       pg_catalog.array_to_string(v_exposure_scopes, ' ')
     and client_record.consent_catalog_revision =
       '2026-09-03.mcp-consent-catalog.v6'
     and client_record.exposure_revision =
       '2026-09-03.mcp-exposure.v11'
     and grant_record.scopes <@ client_record.scope_ceiling
    where grant_record.id = p_oauth_grant_id
      and grant_record.user_id = p_actor_user_id
      and grant_record.company_id = p_company_id
      and grant_record.client_id = p_oauth_client_id
      and grant_record.revision = p_grant_revision
      and grant_record.scopes = p_granted_scope_ceiling
      and grant_record.revoked_at is null
      and grant_record.consent_catalog_revision =
        '2026-09-03.mcp-consent-catalog.v6'
      and grant_record.exposure_revision =
        '2026-09-03.mcp-exposure.v11'
      and grant_record.accepted_labels =
        private.mcp_oauth_labels_for_scopes(
          grant_record.scopes, grant_record.consent_catalog_revision
        )
      and v_required_scopes <@ grant_record.scopes
  ) then
    raise exception 'AGENT_WEATHER_RESCHEDULE_GRANT_STALE_OR_DENIED'
      using errcode = '42501';
  end if;

  return v_permission_snapshot_revision;
end;
$function$;

revoke all on function private.assert_agent_weather_reschedule_authority(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text
) from public, anon, authenticated, service_role;

create or replace function private.build_agent_weather_reschedule_snapshot(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_observed_at timestamptz,
  p_target_date date,
  p_task_limit integer,
  p_project_limit integer,
  p_conflict_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_company public.companies%rowtype;
  v_local_date date;
  v_window integer;
  v_outdoor_ids text[];
  v_settings jsonb;
  v_tasks jsonb := '[]'::jsonb;
  v_forecasts jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_project_ids uuid[];
  v_target_task_ids uuid[];
  v_target_assignee_ids text[];
  v_task_count integer;
  v_project_count integer;
  v_forecast_count integer;
  v_expected_forecast_count integer;
  v_conflict_count integer;
  v_dependency_count integer;
  v_override_count integer;
  v_recipient_kind text;
  v_recipient_id uuid;
  v_recipient_name text;
  v_recipient_email text;
  v_recipient_updated_at timestamptz;
  v_recipient_owner_count integer;
  v_recipient_revision text;
  v_recipient_hash text;
  v_assignees text[];
  v_row_json jsonb;
  v_identity jsonb;
  v_result jsonb;
  v_source_revision text;
  task record;
  forecast record;
  conflict record;
begin
  if p_actor_user_id is null or p_company_id is null
     or p_observed_at is null or not pg_catalog.isfinite(p_observed_at)
     or p_target_date is null
     or p_task_limit is distinct from 101
     or p_project_limit is distinct from 26
     or p_conflict_limit is distinct from 501
     or p_observed_at < pg_catalog.statement_timestamp() - interval '5 minutes'
     or p_observed_at > pg_catalog.statement_timestamp() + interval '5 minutes' then
    raise exception 'AGENT_WEATHER_RESCHEDULE_INPUT_INVALID'
      using errcode = '22023';
  end if;

  select * into v_company
  from public.companies company
  where company.id = p_company_id and company.deleted_at is null;
  if not found
     or v_company.name is distinct from pg_catalog.btrim(v_company.name)
     or pg_catalog.length(v_company.name) not between 1 and 240
     or not private.agent_prompt_text_is_safe(v_company.name, false)
     or v_company.timezone is null
     or not exists (
       select 1 from pg_catalog.pg_timezone_names timezone_row
       where timezone_row.name = v_company.timezone
     )
     or pg_catalog.jsonb_typeof(v_company.schedule_settings) <> 'object'
     or v_company.schedule_settings ->> 'weather_awareness' <> 'true'
     or (v_company.schedule_settings ->> 'optimization_window_days')
       !~ '^(?:[1-9]|1[0-4])$'
     or pg_catalog.jsonb_typeof(
       v_company.schedule_settings -> 'outdoor_task_type_ids'
     ) <> 'array' then
    raise exception 'AGENT_WEATHER_RESCHEDULE_SOURCE_STALE'
      using errcode = '55000';
  end if;

  v_local_date := (p_observed_at at time zone v_company.timezone)::date;
  v_window := (
    v_company.schedule_settings ->> 'optimization_window_days'
  )::integer;
  if p_target_date < v_local_date or p_target_date > v_local_date + 5 then
    raise exception 'AGENT_WEATHER_RESCHEDULE_INPUT_INVALID'
      using errcode = '22023';
  end if;

  if pg_catalog.jsonb_array_length(
       v_company.schedule_settings -> 'outdoor_task_type_ids'
     ) > 100
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements_text(
         v_company.schedule_settings -> 'outdoor_task_type_ids'
       ) value(id)
       where value.id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     ) then
    raise exception 'AGENT_WEATHER_RESCHEDULE_SOURCE_STALE'
      using errcode = '55000';
  end if;
  select array_agg(value.id order by value.id), count(*)::integer
    into v_outdoor_ids, v_task_count
  from pg_catalog.jsonb_array_elements_text(
    v_company.schedule_settings -> 'outdoor_task_type_ids'
  ) value(id);
  if coalesce(v_task_count, 0) <> coalesce(
       pg_catalog.cardinality(array(
         select distinct outdoor_id from pg_catalog.unnest(v_outdoor_ids)
           outdoor_id
       )), 0
     )
     or exists (
       select 1 from pg_catalog.unnest(v_outdoor_ids) outdoor_id
       where not exists (
         select 1 from public.task_types task_type
         where task_type.id = outdoor_id::uuid
           and task_type.company_id = p_company_id
           and task_type.deleted_at is null
       )
     ) then
    raise exception 'AGENT_WEATHER_RESCHEDULE_SOURCE_STALE'
      using errcode = '55000';
  end if;
  v_outdoor_ids := coalesce(v_outdoor_ids, array[]::text[]);
  v_settings := pg_catalog.jsonb_build_object(
    'weather_awareness', true,
    'optimization_window_days', v_window,
    'outdoor_task_type_ids', pg_catalog.to_jsonb(v_outdoor_ids)
  );
  v_settings := v_settings || pg_catalog.jsonb_build_object(
    'source_sha256', pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(v_settings::text, 'UTF8'), 'sha256'
    ), 'hex')
  );

  select pg_catalog.count(*)::integer,
         pg_catalog.count(distinct source_task.project_id)::integer,
         array_agg(source_task.id order by source_task.id),
         array_agg(distinct source_task.project_id order by source_task.project_id)
    into v_task_count, v_project_count, v_target_task_ids, v_project_ids
  from public.project_tasks source_task
  join public.projects project
    on project.id = source_task.project_id
   and project.company_id = p_company_id
   and project.deleted_at is null
   and project.status in ('rfq', 'estimated', 'accepted', 'in_progress')
  where source_task.company_id = p_company_id
    and source_task.deleted_at is null
    and source_task.status not in ('completed', 'cancelled')
    and (source_task.start_date at time zone 'UTC')::date = p_target_date;
  if v_task_count = 0 then
    raise exception 'AGENT_WEATHER_RESCHEDULE_SOURCE_STALE'
      using errcode = '55000';
  end if;
  if v_task_count >= p_task_limit or v_project_count >= p_project_limit then
    raise exception 'AGENT_WEATHER_RESCHEDULE_SOURCE_BOUND'
      using errcode = '54000';
  end if;

  for task in
    select source_task.*, project.title as project_title,
           project.status as project_status,
           project.status_version as project_status_version,
           project.client_id, project.primary_sub_client_id,
           task_type.display as task_type_display,
           task_type.dependencies as task_type_dependencies
    from public.project_tasks source_task
    join public.projects project
      on project.id = source_task.project_id
     and project.company_id = p_company_id
     and project.deleted_at is null
     and project.status in ('rfq', 'estimated', 'accepted', 'in_progress')
    join public.task_types task_type
      on task_type.id = source_task.task_type_id
     and task_type.company_id = p_company_id
     and task_type.deleted_at is null
    where source_task.id = any(v_target_task_ids)
    order by source_task.id
  loop
    if task.project_title is distinct from pg_catalog.btrim(task.project_title)
       or pg_catalog.length(task.project_title) not between 1 and 240
       or not private.agent_prompt_text_is_safe(task.project_title, false)
       or task.project_status_version not between 0 and 9007199254740991
       or task.schedule_version not between 0 and 9007199254740991
       or task.start_date is null or task.end_date is null
       or (task.start_date at time zone 'UTC')::date <> p_target_date
       or (task.end_date at time zone 'UTC')::date <> p_target_date
       or task.all_day is null
       or (not task.all_day and (
         task.start_time is null or task.end_time is null
         or task.end_time <= task.start_time
       ))
       or task.schedule_locked is true
       or task.recurrence_id is not null
       or task.paired_from_task_id is not null
       or task.task_type_id is null then
      raise exception 'AGENT_WEATHER_RESCHEDULE_SOURCE_STALE'
        using errcode = '55000';
    end if;

    v_dependency_count := case
      when task.task_type_dependencies is null then 0
      when pg_catalog.jsonb_typeof(task.task_type_dependencies) = 'array'
        then pg_catalog.jsonb_array_length(task.task_type_dependencies)
      when task.task_type_dependencies = '{}'::jsonb then 0
      else -1
    end;
    v_override_count := case
      when task.dependency_overrides is null then 0
      when pg_catalog.jsonb_typeof(task.dependency_overrides) = 'array'
        then pg_catalog.jsonb_array_length(task.dependency_overrides)
      else -1
    end;
    if v_dependency_count <> 0 or v_override_count <> 0
       or v_dependency_count > 100 or v_override_count > 100 then
      raise exception 'AGENT_WEATHER_RESCHEDULE_SOURCE_STALE'
        using errcode = '55000';
    end if;

    if task.team_member_ids is null then
      v_assignees := array[]::text[];
    else
      if pg_catalog.cardinality(task.team_member_ids) > 50
         or exists (
           select 1 from pg_catalog.unnest(task.team_member_ids) member(id)
           where member.id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         ) then
        raise exception 'AGENT_WEATHER_RESCHEDULE_SOURCE_STALE'
          using errcode = '55000';
      end if;
      select array_agg(member.id order by member.id)
        into v_assignees
      from pg_catalog.unnest(task.team_member_ids) member(id);
      if pg_catalog.cardinality(v_assignees) <> pg_catalog.cardinality(array(
           select distinct member.id
           from pg_catalog.unnest(v_assignees) member(id)
         ))
         or exists (
           select 1 from pg_catalog.unnest(v_assignees) member(id)
           where not exists (
             select 1 from public.users team_member
             where team_member.id = member.id::uuid
               and team_member.company_id = p_company_id
               and team_member.is_active is true
               and team_member.deleted_at is null
           )
         ) then
        raise exception 'AGENT_WEATHER_RESCHEDULE_SOURCE_STALE'
          using errcode = '55000';
      end if;
    end if;

    if task.primary_sub_client_id is not null then
      select 'sub_client', sub_client.id, sub_client.name,
             pg_catalog.lower(pg_catalog.btrim(sub_client.email)),
             sub_client.updated_at
        into v_recipient_kind, v_recipient_id, v_recipient_name,
             v_recipient_email, v_recipient_updated_at
      from public.sub_clients sub_client
      where sub_client.id = task.primary_sub_client_id
        and sub_client.company_id = p_company_id
        and sub_client.client_id = task.client_id
        and sub_client.deleted_at is null;
    else
      select 'client', client.id, client.name,
             pg_catalog.lower(pg_catalog.btrim(client.email)),
             client.updated_at
        into v_recipient_kind, v_recipient_id, v_recipient_name,
             v_recipient_email, v_recipient_updated_at
      from public.clients client
      where client.id = task.client_id
        and client.company_id = p_company_id
        and client.deleted_at is null
        and client.merged_into_client_id is null;
    end if;
    if not found or v_recipient_email is null
       or pg_catalog.length(v_recipient_email) > 320
       or v_recipient_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       or v_recipient_name is distinct from pg_catalog.btrim(v_recipient_name)
       or pg_catalog.length(v_recipient_name) not between 1 and 240
       or not private.agent_prompt_text_is_safe(v_recipient_name, false)
       or exists (
         select 1 from public.email_suppressions suppression
         where pg_catalog.lower(pg_catalog.btrim(suppression.email)) =
                 v_recipient_email
           and suppression.list = 'global'
           and (suppression.expires_at is null
                or suppression.expires_at > p_observed_at)
       ) then
      raise exception 'AGENT_WEATHER_RESCHEDULE_SOURCE_STALE'
        using errcode = '55000';
    end if;

    select pg_catalog.count(*)::integer into v_recipient_owner_count
    from (
      select client.id
      from public.clients client
      where client.company_id = p_company_id
        and client.deleted_at is null
        and client.merged_into_client_id is null
        and pg_catalog.lower(pg_catalog.btrim(client.email)) = v_recipient_email
      union all
      select sub_client.id
      from public.sub_clients sub_client
      where sub_client.company_id = p_company_id
        and sub_client.deleted_at is null
        and pg_catalog.lower(pg_catalog.btrim(sub_client.email)) =
          v_recipient_email
    ) recipient_owners;
    if v_recipient_owner_count <> 1 then
      raise exception 'AGENT_WEATHER_RESCHEDULE_SOURCE_STALE'
        using errcode = '55000';
    end if;

    if not private.agent_user_can_access_entity(
         p_actor_user_id, p_company_id, 'project', task.project_id, 'view'
       ) or not private.agent_user_can_access_entity(
         p_actor_user_id, p_company_id, 'project', task.project_id, 'edit'
       ) or not private.agent_user_can_access_entity(
         p_actor_user_id, p_company_id, 'task', task.id, 'view'
       ) or not private.agent_user_can_access_entity(
         p_actor_user_id, p_company_id, 'task', task.id, 'edit'
       ) or not private.agent_user_can_access_entity(
         p_actor_user_id, p_company_id, v_recipient_kind,
         v_recipient_id, 'view'
       ) then
      raise exception 'AGENT_WEATHER_RESCHEDULE_AUTHORITY_STALE_OR_DENIED'
        using errcode = '42501';
    end if;

    v_recipient_revision := pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(pg_catalog.jsonb_build_object(
        'kind', v_recipient_kind, 'id', v_recipient_id,
        'name', v_recipient_name, 'email', v_recipient_email,
        'updated_at', v_recipient_updated_at
      )::text, 'UTF8'), 'sha256'
    ), 'hex');
    v_recipient_hash := pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(pg_catalog.jsonb_build_object(
        'kind', v_recipient_kind, 'id', v_recipient_id,
        'name', v_recipient_name, 'email', v_recipient_email,
        'revision', v_recipient_revision
      )::text, 'UTF8'), 'sha256'
    ), 'hex');

    v_row_json := pg_catalog.jsonb_build_object(
      'task_id', task.id,
      'project_id', task.project_id,
      'project_title', task.project_title,
      'project_status', task.project_status,
      'project_status_version', task.project_status_version::text,
      'task_type_id', task.task_type_id,
      'task_title', coalesce(nullif(pg_catalog.btrim(task.custom_title), ''),
                             task.task_type_display),
      'task_type_dependency_count', v_dependency_count,
      'start_date', p_target_date::text,
      'end_date', p_target_date::text,
      'start_time', case when task.all_day then null else
        pg_catalog.to_char(task.start_time, 'HH24:MI:SS') end,
      'end_time', case when task.all_day then null else
        pg_catalog.to_char(task.end_time, 'HH24:MI:SS') end,
      'all_day', task.all_day,
      'schedule_version', task.schedule_version::text,
      'schedule_locked', task.schedule_locked,
      'recurrence_id', task.recurrence_id,
      'paired_from_task_id', task.paired_from_task_id,
      'dependency_override_count', v_override_count,
      'assignee_ids', pg_catalog.to_jsonb(v_assignees),
      'recipient', pg_catalog.jsonb_build_object(
        'kind', v_recipient_kind, 'id', v_recipient_id,
        'display_name', v_recipient_name, 'email', v_recipient_email,
        'revision', v_recipient_revision, 'source_sha256', v_recipient_hash
      )
    );
    if v_row_json->>'task_title' is distinct from
         pg_catalog.btrim(v_row_json->>'task_title')
       or pg_catalog.length(v_row_json->>'task_title') not between 1 and 240
       or not private.agent_prompt_text_is_safe(
         v_row_json->>'task_title', false
       ) then
      raise exception 'AGENT_WEATHER_RESCHEDULE_SOURCE_STALE'
        using errcode = '55000';
    end if;
    v_row_json := v_row_json || pg_catalog.jsonb_build_object(
      'source_sha256', pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to(v_row_json::text, 'UTF8'), 'sha256'
      ), 'hex')
    );
    v_tasks := v_tasks || pg_catalog.jsonb_build_array(v_row_json);
  end loop;

  select array_agg(distinct assignee order by assignee)
    into v_target_assignee_ids
  from pg_catalog.jsonb_array_elements(v_tasks) task_json
  cross join lateral pg_catalog.jsonb_array_elements_text(
    task_json -> 'assignee_ids'
  ) assignee;
  v_target_assignee_ids := coalesce(v_target_assignee_ids, array[]::text[]);

  v_expected_forecast_count := v_project_count * (v_window + 1);
  select pg_catalog.count(*)::integer into v_forecast_count
  from pg_catalog.unnest(v_project_ids) expected_project(project_id)
  cross join pg_catalog.generate_series(0, v_window) offset_day
  join public.weather_forecasts source_forecast
    on source_forecast.project_id = expected_project.project_id
   and source_forecast.company_id = p_company_id
   and source_forecast.forecast_date = p_target_date + offset_day
   and source_forecast.source = 'open-meteo'
   and source_forecast.retrieved_at <= p_observed_at
   and source_forecast.retrieved_at >= p_observed_at - interval '12 hours'
   and source_forecast.precipitation_probability between 0 and 100
   and source_forecast.precipitation_mm between 0 and 999.99
   and source_forecast.wind_speed_kmh between 0 and 999.9;
  if v_forecast_count <> v_expected_forecast_count then
    raise exception 'AGENT_WEATHER_RESCHEDULE_SOURCE_STALE'
      using errcode = '55000';
  end if;

  for forecast in
    select source_forecast.*
    from public.weather_forecasts source_forecast
    where source_forecast.company_id = p_company_id
      and source_forecast.project_id = any(v_project_ids)
      and source_forecast.forecast_date between p_target_date
        and p_target_date + v_window
    order by source_forecast.project_id, source_forecast.forecast_date
  loop
    if forecast.source <> 'open-meteo'
       or forecast.retrieved_at > p_observed_at
       or forecast.retrieved_at < p_observed_at - interval '12 hours'
       or forecast.precipitation_probability is null
       or forecast.precipitation_probability not between 0 and 100
       or forecast.precipitation_mm is null
       or forecast.precipitation_mm not between 0 and 999.99
       or forecast.wind_speed_kmh is null
       or forecast.wind_speed_kmh not between 0 and 999.9
       or (forecast.conditions is not null and (
         forecast.conditions is distinct from pg_catalog.btrim(forecast.conditions)
         or pg_catalog.length(forecast.conditions) not between 1 and 120
         or not private.agent_prompt_text_is_safe(forecast.conditions, false)
       )) then
      raise exception 'AGENT_WEATHER_RESCHEDULE_SOURCE_STALE'
        using errcode = '55000';
    end if;
    v_row_json := pg_catalog.jsonb_build_object(
      'project_id', forecast.project_id,
      'forecast_date', forecast.forecast_date::text,
      'source', forecast.source,
      'retrieved_at', pg_catalog.to_char(
        forecast.retrieved_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      'precipitation_probability', forecast.precipitation_probability,
      'precipitation_mm', forecast.precipitation_mm::text,
      'wind_speed_kmh', forecast.wind_speed_kmh::text,
      'conditions', forecast.conditions
    );
    v_row_json := v_row_json || pg_catalog.jsonb_build_object(
      'source_sha256', pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to(v_row_json::text, 'UTF8'), 'sha256'
      ), 'hex')
    );
    v_forecasts := v_forecasts || pg_catalog.jsonb_build_array(v_row_json);
  end loop;

  select pg_catalog.count(*)::integer into v_conflict_count
  from public.project_tasks candidate
  join public.projects candidate_project
    on candidate_project.id = candidate.project_id
   and candidate_project.company_id = p_company_id
   and candidate_project.deleted_at is null
  where candidate.company_id = p_company_id
    and candidate.deleted_at is null
    and candidate.status not in ('completed', 'cancelled')
    and candidate.id <> all(v_target_task_ids)
    and (candidate.start_date at time zone 'UTC')::date between
      p_target_date + 1 and p_target_date + v_window
    and (
      candidate.project_id = any(v_project_ids)
      or coalesce(candidate.team_member_ids, array[]::text[])
         && v_target_assignee_ids
    );
  if v_conflict_count >= p_conflict_limit then
    raise exception 'AGENT_WEATHER_RESCHEDULE_SOURCE_BOUND'
      using errcode = '54000';
  end if;

  for conflict in
    select candidate.*
    from public.project_tasks candidate
    join public.projects candidate_project
      on candidate_project.id = candidate.project_id
     and candidate_project.company_id = p_company_id
     and candidate_project.deleted_at is null
    where candidate.company_id = p_company_id
      and candidate.deleted_at is null
      and candidate.status not in ('completed', 'cancelled')
      and candidate.id <> all(v_target_task_ids)
      and (candidate.start_date at time zone 'UTC')::date between
        p_target_date + 1 and p_target_date + v_window
      and (
        candidate.project_id = any(v_project_ids)
        or coalesce(candidate.team_member_ids, array[]::text[])
           && v_target_assignee_ids
      )
    order by candidate.id
    limit p_conflict_limit
  loop
    if conflict.start_date is null or conflict.end_date is null
       or (conflict.start_date at time zone 'UTC')::date < p_target_date + 1
       or (conflict.start_date at time zone 'UTC')::date > p_target_date + v_window
       or (conflict.end_date at time zone 'UTC')::date <
          (conflict.start_date at time zone 'UTC')::date
       or conflict.all_day is null
       or (not conflict.all_day and (
         conflict.start_time is null or conflict.end_time is null
         or conflict.end_time <= conflict.start_time
       ))
       or not private.agent_user_can_access_entity(
         p_actor_user_id, p_company_id, 'project', conflict.project_id, 'view'
       )
       or not private.agent_user_can_access_entity(
         p_actor_user_id, p_company_id, 'task', conflict.id, 'view'
       ) then
      raise exception 'AGENT_WEATHER_RESCHEDULE_SOURCE_STALE'
        using errcode = '55000';
    end if;
    if conflict.team_member_ids is null then
      v_assignees := array[]::text[];
    else
      if pg_catalog.cardinality(conflict.team_member_ids) > 50
         or exists (
           select 1 from pg_catalog.unnest(conflict.team_member_ids) member(id)
           where member.id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         ) then
        raise exception 'AGENT_WEATHER_RESCHEDULE_SOURCE_STALE'
          using errcode = '55000';
      end if;
      select array_agg(member.id order by member.id)
        into v_assignees
      from pg_catalog.unnest(conflict.team_member_ids) member(id);
      if pg_catalog.cardinality(v_assignees) <> pg_catalog.cardinality(array(
           select distinct member.id
           from pg_catalog.unnest(v_assignees) member(id)
         )) then
        raise exception 'AGENT_WEATHER_RESCHEDULE_SOURCE_STALE'
          using errcode = '55000';
      end if;
    end if;
    v_row_json := pg_catalog.jsonb_build_object(
      'task_id', conflict.id,
      'project_id', conflict.project_id,
      'start_date', (conflict.start_date at time zone 'UTC')::date::text,
      'end_date', (conflict.end_date at time zone 'UTC')::date::text,
      'start_time', case when conflict.all_day then null else
        pg_catalog.to_char(conflict.start_time, 'HH24:MI:SS') end,
      'end_time', case when conflict.all_day then null else
        pg_catalog.to_char(conflict.end_time, 'HH24:MI:SS') end,
      'all_day', conflict.all_day,
      'assignee_ids', pg_catalog.to_jsonb(v_assignees)
    );
    v_row_json := v_row_json || pg_catalog.jsonb_build_object(
      'source_sha256', pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to(v_row_json::text, 'UTF8'), 'sha256'
      ), 'hex')
    );
    v_conflicts := v_conflicts || pg_catalog.jsonb_build_array(v_row_json);
  end loop;

  v_identity := pg_catalog.jsonb_build_object(
    'context', pg_catalog.jsonb_build_object(
      'company_id', p_company_id,
      'company_name', v_company.name,
      'timezone', v_company.timezone,
      'local_date', v_local_date::text,
      'settings', v_settings
    ),
    'target_date', p_target_date::text,
    'tasks', v_tasks,
    'forecasts', v_forecasts,
    'conflicts', v_conflicts
  );
  v_source_revision := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_identity::text, 'UTF8'), 'sha256'
  ), 'hex');
  v_result := v_identity || pg_catalog.jsonb_build_object(
    'observed_at', pg_catalog.to_char(
      p_observed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'source_revision', v_source_revision
  );
  if pg_catalog.octet_length(pg_catalog.convert_to(v_result::text, 'UTF8'))
       > 1000000 then
    raise exception 'AGENT_WEATHER_RESCHEDULE_SOURCE_BOUND'
      using errcode = '54000';
  end if;
  return v_result;
end;
$function$;

revoke all on function private.build_agent_weather_reschedule_snapshot(
  uuid, uuid, timestamptz, date, integer, integer, integer
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_weather_reschedule_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_capability_manifest_revision text,
  p_exposure_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_observed_at timestamptz,
  p_target_date date,
  p_task_limit integer,
  p_project_limit integer,
  p_conflict_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform private.assert_agent_weather_reschedule_authority(
    p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
    p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_capability_manifest_revision,
    p_exposure_revision, p_capability_id, p_capability_revision
  );
  return private.build_agent_weather_reschedule_snapshot(
    p_actor_user_id, p_company_id, p_observed_at, p_target_date,
    p_task_limit, p_project_limit, p_conflict_limit
  );
exception
  when invalid_text_representation or datetime_field_overflow
    or numeric_value_out_of_range then
    raise exception 'AGENT_WEATHER_RESCHEDULE_INPUT_INVALID'
      using errcode = '22023';
end;
$function$;

revoke all on function public.read_agent_weather_reschedule_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text,
  timestamptz, date, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.read_agent_weather_reschedule_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text,
  timestamptz, date, integer, integer, integer
) to service_role;

create or replace function public.assert_agent_weather_reschedule_authority_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_capability_manifest_revision text,
  p_exposure_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_observed_at timestamptz,
  p_target_date date,
  p_expected_source_revision text,
  p_task_limit integer,
  p_project_limit integer,
  p_conflict_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_permission_snapshot_revision text;
  v_snapshot jsonb;
begin
  if p_expected_source_revision is null
     or p_expected_source_revision !~ '^[0-9a-f]{64}$' then
    raise exception 'AGENT_WEATHER_RESCHEDULE_INPUT_INVALID'
      using errcode = '22023';
  end if;
  v_permission_snapshot_revision :=
    private.assert_agent_weather_reschedule_authority(
      p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
      p_grant_revision, p_granted_scope_ceiling,
      p_permission_snapshot_revision, p_capability_manifest_revision,
      p_exposure_revision, p_capability_id, p_capability_revision
    );
  v_snapshot := private.build_agent_weather_reschedule_snapshot(
    p_actor_user_id, p_company_id, p_observed_at, p_target_date,
    p_task_limit, p_project_limit, p_conflict_limit
  );
  if v_snapshot->>'source_revision' is distinct from
       p_expected_source_revision then
    raise exception 'AGENT_WEATHER_RESCHEDULE_SOURCE_STALE'
      using errcode = '55000';
  end if;
  return pg_catalog.jsonb_build_object(
    'permission_snapshot_revision', v_permission_snapshot_revision,
    'source_revision', v_snapshot->>'source_revision'
  );
end;
$function$;

revoke all on function public.assert_agent_weather_reschedule_authority_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text,
  timestamptz, date, text, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.assert_agent_weather_reschedule_authority_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text,
  timestamptz, date, text, integer, integer, integer
) to service_role;

create or replace function private.assert_agent_weather_reschedule_catalog()
returns void
language plpgsql
stable
set search_path = ''
as $function$
begin
  if exists (
    select 1 from pg_catalog.pg_proc procedure
    where procedure.oid in (
      'private.assert_agent_weather_reschedule_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text)'::regprocedure,
      'private.build_agent_weather_reschedule_snapshot(uuid,uuid,timestamp with time zone,date,integer,integer,integer)'::regprocedure,
      'public.read_agent_weather_reschedule_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,timestamp with time zone,date,integer,integer,integer)'::regprocedure,
      'public.assert_agent_weather_reschedule_authority_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,timestamp with time zone,date,text,integer,integer,integer)'::regprocedure
    ) and (
      procedure.provolatile <> 's'
      or not procedure.prosecdef
      or procedure.proconfig is distinct from array['search_path=""']::text[]
    )
  ) then
    raise exception 'AGENT_WEATHER_RESCHEDULE_FUNCTION_SHAPE_INVALID'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(coalesce(
      procedure.proacl, pg_catalog.acldefault('f', procedure.proowner)
    )) access
    where procedure.oid in (
      'private.assert_agent_weather_reschedule_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text)'::regprocedure,
      'private.build_agent_weather_reschedule_snapshot(uuid,uuid,timestamp with time zone,date,integer,integer,integer)'::regprocedure,
      'private.mcp_oauth_labels_for_scopes(text[],text)'::regprocedure,
      'private.assert_agent_weather_reschedule_catalog()'::regprocedure
    ) and access.privilege_type = 'EXECUTE'
      and access.grantee <> procedure.proowner
  ) or exists (
    select 1
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(coalesce(
      procedure.proacl, pg_catalog.acldefault('f', procedure.proowner)
    )) access
    where procedure.oid in (
      'public.read_agent_weather_reschedule_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,timestamp with time zone,date,integer,integer,integer)'::regprocedure,
      'public.assert_agent_weather_reschedule_authority_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,timestamp with time zone,date,text,integer,integer,integer)'::regprocedure
    ) and access.privilege_type = 'EXECUTE'
      and access.grantee <> procedure.proowner
      and access.grantee is distinct from 'service_role'::regrole::oid
  ) then
    raise exception 'AGENT_WEATHER_RESCHEDULE_FUNCTION_ACL_INVALID'
      using errcode = '55000';
  end if;
end;
$function$;

revoke all on function private.assert_agent_weather_reschedule_catalog()
  from public, anon, authenticated, service_role;

select private.assert_agent_weather_reschedule_catalog();

commit;
