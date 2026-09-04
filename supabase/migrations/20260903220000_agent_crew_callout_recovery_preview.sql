-- Inactive OPS MCP crew-callout-recovery preview.
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
    'public.calendar_user_events', 'public.clients', 'public.companies',
    'public.email_suppressions', 'public.project_tasks', 'public.projects',
    'public.roles', 'public.site_visits', 'public.sub_clients',
    'public.task_types', 'public.user_roles', 'public.users',
    'private.mcp_oauth_clients', 'private.mcp_oauth_grants'
  ] loop
    if pg_catalog.to_regclass(v_relation) is null then
      raise exception 'agent_crew_callout_recovery_prerequisite_missing: %',
        v_relation using errcode = '55000';
    end if;
  end loop;

  foreach v_signature in array array[
    'private.resolve_agent_actor_authority(uuid,uuid,text[])',
    'private.mcp_oauth_labels_for_scopes(text[],text)',
    'private.agent_prompt_text_is_safe(text,boolean)',
    'private.agent_read_domain_uuid_from_text(text)',
    'private.agent_unambiguous_local_instant(timestamp without time zone,text)',
    'private.agent_user_can_access_entity(uuid,uuid,text,uuid,text)',
    'extensions.digest(bytea,text)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'agent_crew_callout_recovery_prerequisite_missing: %',
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
                 '2026-09-03.mcp-consent-catalog.v6',
                 '2026-09-03.mcp-consent-catalog.v7'
               ) then 'Prepare exact draft estimates from authorized past jobs'
             end
             when 'ops.communications.prepare' then case
               when p_consent_catalog_revision =
                 '2026-09-03.mcp-consent-catalog.v6'
                 then 'Prepare exact client schedule-update drafts for approval'
               when p_consent_catalog_revision =
                 '2026-09-03.mcp-consent-catalog.v7'
                 then 'Prepare exact client schedule-update and crew recovery messages for approval'
             end
             when 'ops.schedule.prepare' then case
               when p_consent_catalog_revision =
                 '2026-09-03.mcp-consent-catalog.v6'
                 then 'Prepare exact weather reschedule proposals for approval'
               when p_consent_catalog_revision =
                 '2026-09-03.mcp-consent-catalog.v7'
                 then 'Prepare exact weather and crew recovery schedule proposals for approval'
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
                 '2026-09-03.mcp-consent-catalog.v6',
                 '2026-09-03.mcp-consent-catalog.v7'
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
           '2026-09-03.mcp-consent-catalog.v6',
           '2026-09-03.mcp-consent-catalog.v7'
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

create or replace function private.assert_agent_crew_callout_recovery_authority(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
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
    'ops.schedule.prepare', 'ops.schedule.read', 'ops.site_visits.read',
    'ops.tasks.read', 'ops.team.read'
  ];
  v_required_permissions constant text[] := array[
    'calendar.edit', 'calendar.view', 'clients.view', 'inbox.send',
    'inbox.view', 'projects.edit', 'projects.view', 'tasks.assign',
    'tasks.edit', 'tasks.view', 'team.view'
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
     or p_registered_permission_keys is null
     or pg_catalog.cardinality(p_registered_permission_keys) not between 1 and 256
     or not v_required_permissions <@ p_registered_permission_keys
     or p_registered_permission_keys is distinct from (
       select pg_catalog.array_agg(
         registry_key.value order by registry_key.value collate "C"
       )
       from (
         select distinct source.value
         from pg_catalog.unnest(p_registered_permission_keys) source(value)
       ) registry_key
     )
     or exists (
       select 1
       from pg_catalog.unnest(p_registered_permission_keys) registry_key(value)
       where registry_key.value is distinct from
               pg_catalog.btrim(registry_key.value)
          or pg_catalog.length(registry_key.value) > 128
          or registry_key.value !~
               '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'
     )
     or p_capability_manifest_revision is distinct from
       '2026-09-03.capability-manifest.v18'
     or p_exposure_revision is distinct from
       '2026-09-03.mcp-exposure.v12'
     or p_capability_id is distinct from 'prepare_crew_callout_recovery'
     or p_capability_revision is distinct from
       'prepare_crew_callout_recovery:2026-09-03.v1'
     or not v_required_scopes <@ p_granted_scope_ceiling then
    raise exception 'AGENT_CREW_CALLOUT_BINDING_INVALID'
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
    p_actor_user_id, p_company_id, p_registered_permission_keys
  ) authority
  where authority.effective_permissions @> v_required_permission_json;

  if v_permission_snapshot_revision is null
     or v_permission_snapshot_revision is distinct from
       p_permission_snapshot_revision then
    raise exception 'AGENT_CREW_CALLOUT_AUTHORITY_STALE_OR_DENIED'
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
       '2026-09-03.mcp-consent-catalog.v7'
     and client_record.exposure_revision =
       '2026-09-03.mcp-exposure.v12'
     and grant_record.scopes <@ client_record.scope_ceiling
    where grant_record.id = p_oauth_grant_id
      and grant_record.user_id = p_actor_user_id
      and grant_record.company_id = p_company_id
      and grant_record.client_id = p_oauth_client_id
      and grant_record.revision = p_grant_revision
      and grant_record.scopes = p_granted_scope_ceiling
      and grant_record.revoked_at is null
      and grant_record.consent_catalog_revision =
        '2026-09-03.mcp-consent-catalog.v7'
      and grant_record.exposure_revision =
        '2026-09-03.mcp-exposure.v12'
      and grant_record.accepted_labels =
        private.mcp_oauth_labels_for_scopes(
          grant_record.scopes, grant_record.consent_catalog_revision
        )
      and v_required_scopes <@ grant_record.scopes
  ) then
    raise exception 'AGENT_CREW_CALLOUT_GRANT_STALE_OR_DENIED'
      using errcode = '42501';
  end if;

  return v_permission_snapshot_revision;
end;
$function$;

revoke all on function private.assert_agent_crew_callout_recovery_authority(
  uuid, uuid, uuid, uuid, text, text[], text, text[], text, text, text, text
) from public, anon, authenticated, service_role;

create or replace function private.build_agent_crew_callout_recovery_snapshot(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_observed_at timestamptz,
  p_crew_member_name text,
  p_target_date date,
  p_item_limit integer,
  p_candidate_limit integer,
  p_schedule_source_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_company public.companies%rowtype;
  v_local_date date;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_member public.users%rowtype;
  v_member_count integer;
  v_member_roles jsonb := '[]'::jsonb;
  v_member_json jsonb;
  v_affected jsonb := '[]'::jsonb;
  v_candidates jsonb := '[]'::jsonb;
  v_item_count integer;
  v_candidate_count integer;
  v_schedule_count integer;
  v_dependency_count integer;
  v_override_count integer;
  v_assignees text[];
  v_project_ids uuid[];
  v_history jsonb;
  v_roles jsonb;
  v_commitments jsonb;
  v_recipient jsonb;
  v_recipient_kind text;
  v_recipient_id uuid;
  v_recipient_name text;
  v_recipient_email text;
  v_recipient_updated_at timestamptz;
  v_recipient_parent_updated_at timestamptz;
  v_recipient_owner_count integer;
  v_recipient_revision text;
  v_reschedule_options jsonb;
  v_row jsonb;
  v_context jsonb;
  v_result jsonb;
  source record;
  candidate record;
  role_source record;
  day_source record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null or p_company_id is null
     or p_observed_at is null or not pg_catalog.isfinite(p_observed_at)
     or nullif(pg_catalog.btrim(p_crew_member_name), '') is null
     or p_crew_member_name is distinct from pg_catalog.btrim(p_crew_member_name)
     or pg_catalog.length(p_crew_member_name) > 120
     or p_target_date is null
     or p_item_limit is distinct from 26
     or p_candidate_limit is distinct from 251
     or p_schedule_source_limit is distinct from 501 then
    raise exception 'AGENT_CREW_CALLOUT_INPUT_INVALID'
      using errcode = '22023';
  end if;

  select company.* into v_company
  from public.companies company
  where company.id = p_company_id
    and company.deleted_at is null;
  if not found
     or v_company.name is distinct from pg_catalog.btrim(v_company.name)
     or pg_catalog.length(v_company.name) not between 1 and 240
     or not private.agent_prompt_text_is_safe(v_company.name, false)
     or nullif(pg_catalog.btrim(v_company.timezone), '') is null
     or not exists (
       select 1 from pg_catalog.pg_timezone_names timezone
       where timezone.name = v_company.timezone
     )
     or v_company.default_work_start is null
     or v_company.default_work_end is null
     or v_company.default_work_start >= v_company.default_work_end then
    raise exception 'AGENT_CREW_CALLOUT_SOURCE_STALE'
      using errcode = '55000';
  end if;
  v_local_date := (p_observed_at at time zone v_company.timezone)::date;
  if p_target_date < v_local_date or p_target_date > v_local_date + 14 then
    raise exception 'AGENT_CREW_CALLOUT_INPUT_INVALID'
      using errcode = '22023';
  end if;
  v_window_start := private.agent_unambiguous_local_instant(
    p_target_date::timestamp, v_company.timezone
  );
  v_window_end := private.agent_unambiguous_local_instant(
    (p_target_date + 1)::timestamp, v_company.timezone
  );
  if v_window_start is null or v_window_end is null
     or v_window_end <= v_window_start then
    raise exception 'AGENT_CREW_CALLOUT_SOURCE_STALE'
      using errcode = '55000';
  end if;

  select pg_catalog.count(*)::integer,
         (pg_catalog.array_agg(member.id order by member.id))[1]
    into v_member_count, v_member.id
  from public.users member
  where member.company_id = p_company_id
    and member.deleted_at is null
    and member.is_active is true
    and (
      pg_catalog.lower(pg_catalog.btrim(pg_catalog.concat_ws(
        ' ', member.first_name, member.last_name
      ))) = pg_catalog.lower(p_crew_member_name)
      or (
        pg_catalog.strpos(p_crew_member_name, ' ') = 0
        and (
          pg_catalog.lower(pg_catalog.btrim(member.first_name)) =
            pg_catalog.lower(p_crew_member_name)
          or pg_catalog.lower(pg_catalog.btrim(member.last_name)) =
            pg_catalog.lower(p_crew_member_name)
        )
      )
    );
  if v_member_count = 0 then
    raise exception 'AGENT_CREW_CALLOUT_IDENTITY_NOT_FOUND'
      using errcode = 'P0002';
  elsif v_member_count <> 1 then
    raise exception 'AGENT_CREW_CALLOUT_MEMBER_AMBIGUOUS'
      using errcode = 'P0002';
  end if;
  select member.* into strict v_member
  from public.users member where member.id = v_member.id;
  if pg_catalog.btrim(pg_catalog.concat_ws(
       ' ', v_member.first_name, v_member.last_name
     )) = ''
     or pg_catalog.length(pg_catalog.btrim(pg_catalog.concat_ws(
       ' ', v_member.first_name, v_member.last_name
     ))) > 240
     or not private.agent_prompt_text_is_safe(
       pg_catalog.btrim(pg_catalog.concat_ws(
         ' ', v_member.first_name, v_member.last_name
       )), false
     ) then
    raise exception 'AGENT_CREW_CALLOUT_SOURCE_STALE'
      using errcode = '55000';
  end if;

  for role_source in
    select role.id, role.name, role.updated_at
    from public.user_roles membership
    join public.roles role on role.id = membership.role_id
    where membership.user_id = v_member.id::text
      and (role.company_id is null or role.company_id = p_company_id)
    order by role.id
  loop
    if role_source.name is distinct from pg_catalog.btrim(role_source.name)
       or pg_catalog.length(role_source.name) not between 1 and 120
       or not private.agent_prompt_text_is_safe(role_source.name, false) then
      raise exception 'AGENT_CREW_CALLOUT_SOURCE_STALE'
        using errcode = '55000';
    end if;
    v_row := pg_catalog.jsonb_build_object(
      'role_id', role_source.id,
      'name', role_source.name
    );
    v_row := v_row || pg_catalog.jsonb_build_object(
      'source_sha256', pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to(v_row::text, 'UTF8'), 'sha256'
      ), 'hex')
    );
    v_member_roles := v_member_roles || pg_catalog.jsonb_build_array(v_row);
  end loop;
  v_member_json := pg_catalog.jsonb_build_object(
    'member_id', v_member.id,
    'display_name', pg_catalog.btrim(pg_catalog.concat_ws(
      ' ', v_member.first_name, v_member.last_name
    )),
    'roles', v_member_roles
  );
  v_member_json := v_member_json || pg_catalog.jsonb_build_object(
    'source_sha256', pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(v_member_json::text, 'UTF8'), 'sha256'
    ), 'hex')
  );

  select pg_catalog.count(*)::integer into v_item_count
  from (
    select task.id
    from public.project_tasks task
    join public.projects project
      on project.id = task.project_id
     and project.company_id = p_company_id
     and project.deleted_at is null
     and project.status in ('rfq', 'estimated', 'accepted', 'in_progress')
    where task.company_id = p_company_id
      and task.deleted_at is null
      and task.status not in ('completed', 'cancelled')
      and task.start_date is not null
      and coalesce(task.end_date, task.start_date) is not null
      and (task.start_date at time zone 'UTC')::date <= p_target_date
      and (coalesce(task.end_date, task.start_date) at time zone 'UTC')::date >= p_target_date
      and v_member.id::text = any(coalesce(task.team_member_ids, array[]::text[]))
    union all
    select visit.id
    from public.site_visits visit
    join public.projects project
      on project.id = coalesce(
           visit.project_ref,
           private.agent_read_domain_uuid_from_text(visit.project_id)
         )
     and project.company_id = p_company_id
     and project.deleted_at is null
     and project.status in ('rfq', 'estimated', 'accepted', 'in_progress')
    where visit.company_id = p_company_id::text
      and visit.deleted_at is null
      and visit.booked_at is not null
      and visit.status <> 'cancelled'
      and visit.scheduled_at < v_window_end
      and visit.scheduled_at + pg_catalog.make_interval(
            mins => visit.duration_minutes
          ) > v_window_start
      and v_member.id::text = any(coalesce(visit.assignee_ids, array[]::text[]))
  ) affected;
  if v_item_count >= p_item_limit then
    raise exception 'AGENT_CREW_CALLOUT_SOURCE_BOUND'
      using errcode = '54000';
  end if;

  for source in
    select 'task'::text as kind,
           task.id as item_id,
           task.project_id,
           project.title as project_title,
           project.status as project_status,
           project.status_version as project_status_version,
           project.client_id,
           project.primary_sub_client_id,
           coalesce(nullif(pg_catalog.btrim(task.custom_title), ''), task_type.display) as title,
           task.task_type_id,
           task.schedule_version,
           task.start_date,
           coalesce(task.end_date, task.start_date) as end_date,
           task.start_time,
           task.end_time,
           task.all_day,
           task.team_member_ids as assignee_ids,
           task.schedule_locked,
           task.recurrence_id,
           task.paired_from_task_id,
           task_type.dependencies as task_type_dependencies,
           task.dependency_overrides,
           task.updated_at
    from public.project_tasks task
    join public.projects project
      on project.id = task.project_id
     and project.company_id = p_company_id
     and project.deleted_at is null
     and project.status in ('rfq', 'estimated', 'accepted', 'in_progress')
    join public.task_types task_type
      on task_type.id = task.task_type_id
     and task_type.company_id = p_company_id
     and task_type.deleted_at is null
    where task.company_id = p_company_id
      and task.deleted_at is null
      and task.status not in ('completed', 'cancelled')
      and task.start_date is not null
      and (task.start_date at time zone 'UTC')::date <= p_target_date
      and (coalesce(task.end_date, task.start_date) at time zone 'UTC')::date >= p_target_date
      and v_member.id::text = any(coalesce(task.team_member_ids, array[]::text[]))
    union all
    select 'site_visit'::text,
           visit.id,
           project.id,
           project.title,
           project.status,
           project.status_version,
           project.client_id,
           project.primary_sub_client_id,
           coalesce(nullif(pg_catalog.btrim(visit.appointment_title), ''), 'Site visit'),
           null::uuid,
           pg_catalog.floor(extract(epoch from coalesce(
             visit.updated_at, visit.created_at
           )) * 1000000)::bigint,
           visit.scheduled_at,
           visit.scheduled_at + pg_catalog.make_interval(mins => visit.duration_minutes),
           null::time,
           null::time,
           false,
           visit.assignee_ids,
           false,
           null::uuid,
           null::uuid,
           '[]'::jsonb,
           '[]'::jsonb,
           visit.updated_at
    from public.site_visits visit
    join public.projects project
      on project.id = coalesce(
           visit.project_ref,
           private.agent_read_domain_uuid_from_text(visit.project_id)
         )
     and project.company_id = p_company_id
     and project.deleted_at is null
     and project.status in ('rfq', 'estimated', 'accepted', 'in_progress')
    where visit.company_id = p_company_id::text
      and visit.deleted_at is null
      and visit.booked_at is not null
      and visit.status <> 'cancelled'
      and visit.scheduled_at < v_window_end
      and visit.scheduled_at + pg_catalog.make_interval(
            mins => visit.duration_minutes
          ) > v_window_start
      and v_member.id::text = any(coalesce(visit.assignee_ids, array[]::text[]))
    order by kind, item_id
  loop
    if source.project_title is distinct from pg_catalog.btrim(source.project_title)
       or pg_catalog.length(source.project_title) not between 1 and 240
       or not private.agent_prompt_text_is_safe(source.project_title, false)
       or source.title is distinct from pg_catalog.btrim(source.title)
       or pg_catalog.length(source.title) not between 1 and 240
       or not private.agent_prompt_text_is_safe(source.title, false)
       or source.project_status_version not between 0 and 9007199254740991
       or source.schedule_version not between 0 and 9007199254740991
       or source.start_date is null or source.end_date is null
       or not pg_catalog.isfinite(source.start_date)
       or not pg_catalog.isfinite(source.end_date)
       or source.kind = 'site_visit' and source.end_date <= source.start_date
       or source.kind = 'task' and (
         (source.end_date at time zone 'UTC')::date <
           (source.start_date at time zone 'UTC')::date
         or source.start_time is null or source.end_time is null
         or (source.end_date at time zone 'UTC')::date =
              (source.start_date at time zone 'UTC')::date
            and source.end_time <= source.start_time
       )
       or source.all_day is null
       or source.kind = 'task' and source.task_type_id is null then
      raise exception 'AGENT_CREW_CALLOUT_SOURCE_STALE'
        using errcode = '55000';
    end if;
    v_dependency_count := case
      when source.task_type_dependencies is null then 0
      when pg_catalog.jsonb_typeof(source.task_type_dependencies) = 'array'
        then pg_catalog.jsonb_array_length(source.task_type_dependencies)
      when source.task_type_dependencies = '{}'::jsonb then 0
      else -1
    end;
    v_override_count := case
      when source.dependency_overrides is null then 0
      when pg_catalog.jsonb_typeof(source.dependency_overrides) = 'array'
        then pg_catalog.jsonb_array_length(source.dependency_overrides)
      else -1
    end;
    if v_dependency_count not between 0 and 100
       or v_override_count not between 0 and 100 then
      raise exception 'AGENT_CREW_CALLOUT_SOURCE_STALE'
        using errcode = '55000';
    end if;
    if source.assignee_ids is null
       or pg_catalog.cardinality(source.assignee_ids) not between 1 and 50
       or exists (
         select 1 from pg_catalog.unnest(source.assignee_ids) assignment(id)
         where assignment.id is null
            or assignment.id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       ) then
      raise exception 'AGENT_CREW_CALLOUT_SOURCE_STALE'
        using errcode = '55000';
    end if;
    select pg_catalog.array_agg(distinct assignment.id::uuid::text
                                order by assignment.id::uuid::text)
      into v_assignees
    from pg_catalog.unnest(source.assignee_ids) assignment(id);
    if pg_catalog.cardinality(v_assignees) <>
         pg_catalog.cardinality(source.assignee_ids)
       or not v_member.id::text = any(v_assignees)
       or exists (
         select 1 from pg_catalog.unnest(v_assignees) assignment(id)
         where not exists (
           select 1 from public.users assigned_member
           where assigned_member.id = assignment.id::uuid
             and assigned_member.company_id = p_company_id
             and assigned_member.deleted_at is null
             and assigned_member.is_active is true
         )
       ) then
      raise exception 'AGENT_CREW_CALLOUT_SOURCE_STALE'
        using errcode = '55000';
    end if;
    if not private.agent_user_can_access_entity(
         p_actor_user_id, p_company_id, 'project', source.project_id, 'view'
       ) or not private.agent_user_can_access_entity(
         p_actor_user_id, p_company_id, 'project', source.project_id, 'edit'
       ) or source.kind = 'task' and (
         not private.agent_user_can_access_entity(
           p_actor_user_id, p_company_id, 'task', source.item_id, 'view'
         ) or not private.agent_user_can_access_entity(
           p_actor_user_id, p_company_id, 'task', source.item_id, 'edit'
         )
       ) then
      raise exception 'AGENT_CREW_CALLOUT_AUTHORITY_STALE_OR_DENIED'
        using errcode = '42501';
    end if;

    v_recipient := null;
    v_recipient_kind := null;
    v_recipient_id := null;
    v_recipient_name := null;
    v_recipient_email := null;
    v_recipient_updated_at := null;
    v_recipient_parent_updated_at := null;
    if source.primary_sub_client_id is not null then
      select 'sub_client', sub_client.id, sub_client.name,
             pg_catalog.lower(pg_catalog.btrim(sub_client.email)),
             sub_client.updated_at, parent_client.updated_at
        into v_recipient_kind, v_recipient_id, v_recipient_name,
             v_recipient_email, v_recipient_updated_at,
             v_recipient_parent_updated_at
      from public.sub_clients sub_client
      join public.clients parent_client
        on parent_client.id = sub_client.client_id
       and parent_client.company_id = p_company_id
       and parent_client.deleted_at is null
       and parent_client.merged_into_client_id is null
      where sub_client.id = source.primary_sub_client_id
        and sub_client.company_id = p_company_id
        and sub_client.client_id = source.client_id
        and sub_client.deleted_at is null;
    else
      select 'client', client.id, client.name,
             pg_catalog.lower(pg_catalog.btrim(client.email)),
             client.updated_at, client.updated_at
        into v_recipient_kind, v_recipient_id, v_recipient_name,
             v_recipient_email, v_recipient_updated_at,
             v_recipient_parent_updated_at
      from public.clients client
      where client.id = source.client_id
        and client.company_id = p_company_id
        and client.deleted_at is null
        and client.merged_into_client_id is null;
    end if;
    if v_recipient_id is not null and v_recipient_email is not null
       and pg_catalog.length(v_recipient_email) <= 320
       and v_recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       and v_recipient_name is not null
       and v_recipient_name = pg_catalog.btrim(v_recipient_name)
       and pg_catalog.length(v_recipient_name) between 1 and 240
       and private.agent_prompt_text_is_safe(v_recipient_name, false)
       and not exists (
         select 1 from public.email_suppressions suppression
         where pg_catalog.lower(pg_catalog.btrim(suppression.email)) =
                 v_recipient_email
           and suppression.list = 'global'
           and (suppression.expires_at is null
                or suppression.expires_at > p_observed_at)
       )
       and private.agent_user_can_access_entity(
         p_actor_user_id, p_company_id, v_recipient_kind,
         v_recipient_id, 'view'
       ) then
      select pg_catalog.count(*)::integer into v_recipient_owner_count
      from (
        select client.id from public.clients client
        where client.company_id = p_company_id
          and client.deleted_at is null
          and client.merged_into_client_id is null
          and pg_catalog.lower(pg_catalog.btrim(client.email)) = v_recipient_email
        union all
        select sub_client.id from public.sub_clients sub_client
        join public.clients parent_client
          on parent_client.id = sub_client.client_id
         and parent_client.company_id = p_company_id
         and parent_client.deleted_at is null
         and parent_client.merged_into_client_id is null
        where sub_client.company_id = p_company_id
          and sub_client.deleted_at is null
          and pg_catalog.lower(pg_catalog.btrim(sub_client.email)) =
                v_recipient_email
      ) recipient_owner_count;
      if v_recipient_owner_count = 1 then
        v_recipient_revision := pg_catalog.encode(extensions.digest(
          pg_catalog.convert_to(pg_catalog.jsonb_build_object(
            'kind', v_recipient_kind, 'id', v_recipient_id,
            'name', v_recipient_name, 'email', v_recipient_email,
            'updated_at', v_recipient_updated_at,
            'parent_updated_at', v_recipient_parent_updated_at
          )::text, 'UTF8'), 'sha256'
        ), 'hex');
        v_recipient := pg_catalog.jsonb_build_object(
          'kind', v_recipient_kind,
          'id', v_recipient_id,
          'display_name', v_recipient_name,
          'email', v_recipient_email,
          'revision', v_recipient_revision
        );
        v_recipient := v_recipient || pg_catalog.jsonb_build_object(
          'source_sha256', pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(v_recipient::text, 'UTF8'), 'sha256'
          ), 'hex')
        );
      end if;
    end if;

    v_reschedule_options := '[]'::jsonb;
    if not source.schedule_locked
       and source.recurrence_id is null
       and source.paired_from_task_id is null
       and v_dependency_count = 0 and v_override_count = 0 then
      for day_source in
        select proposed_date
        from pg_catalog.generate_series(
          p_target_date + 1, p_target_date + 14, interval '1 day'
        ) generated(proposed_date)
        where not v_company.skip_weekends_in_auto_schedule
           or extract(isodow from proposed_date) < 6
        order by proposed_date
      loop
        v_row := pg_catalog.jsonb_build_object(
          'date', day_source.proposed_date::date::text,
          'start_at', pg_catalog.to_char(
            private.agent_unambiguous_local_instant(
              (day_source.proposed_date::date + case
                when source.kind = 'task' and source.all_day
                  then v_company.default_work_start
                when source.kind = 'task' then source.start_time
                else (source.start_date at time zone v_company.timezone)::time
              end)::timestamp, v_company.timezone
            ) at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          ),
          'end_at', pg_catalog.to_char(
            private.agent_unambiguous_local_instant(
              (day_source.proposed_date::date + case
                when source.kind = 'task' and source.all_day
                  then v_company.default_work_end
                when source.kind = 'task' then source.end_time
                else (source.start_date at time zone v_company.timezone)::time +
                  (source.end_date - source.start_date)
              end)::timestamp, v_company.timezone
            ) at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )
        );
        if (v_row->>'end_at')::timestamptz > (v_row->>'start_at')::timestamptz
           and not exists (
             select 1
             from pg_catalog.unnest(v_assignees) assignment(id)
             where exists (
               select 1 from public.calendar_user_events calendar
               where calendar.company_id = p_company_id::text
                 and calendar.deleted_at is null
                 and calendar.type = 'time_off'
                 and calendar.status in ('approved', 'none')
                 and assignment.id = any(array[
                   calendar.user_id
                 ] || coalesce(calendar.team_member_ids, array[]::text[]))
                 and calendar.start_date < (v_row->>'end_at')::timestamptz
                 and calendar.end_date > (v_row->>'start_at')::timestamptz
             )
             or exists (
               select 1 from public.project_tasks conflict
               where conflict.company_id = p_company_id
                 and conflict.deleted_at is null
                 and conflict.status not in ('completed', 'cancelled')
                 and not (source.kind = 'task' and conflict.id = source.item_id)
                 and assignment.id = any(coalesce(
                   conflict.team_member_ids, array[]::text[]
                 ))
                 and conflict.start_date is not null
                 and (conflict.start_date at time zone 'UTC')::date =
                       day_source.proposed_date::date
                 and private.agent_unambiguous_local_instant(
                       (day_source.proposed_date::date + case
                         when conflict.all_day then v_company.default_work_start
                         else conflict.start_time end)::timestamp,
                       v_company.timezone
                     ) < (v_row->>'end_at')::timestamptz
                 and private.agent_unambiguous_local_instant(
                       (day_source.proposed_date::date + case
                         when conflict.all_day then v_company.default_work_end
                         else conflict.end_time end)::timestamp,
                       v_company.timezone
                     ) > (v_row->>'start_at')::timestamptz
             )
             or exists (
               select 1 from public.site_visits conflict
               where conflict.company_id = p_company_id::text
                 and conflict.deleted_at is null
                 and conflict.booked_at is not null
                 and conflict.status <> 'cancelled'
                 and not (source.kind = 'site_visit' and conflict.id = source.item_id)
                 and assignment.id = any(coalesce(
                   conflict.assignee_ids, array[]::text[]
                 ))
                 and conflict.scheduled_at < (v_row->>'end_at')::timestamptz
                 and conflict.scheduled_at + pg_catalog.make_interval(
                       mins => conflict.duration_minutes
                     ) > (v_row->>'start_at')::timestamptz
             )
             or exists (
               select 1 from public.calendar_user_events calendar
               where calendar.company_id = p_company_id::text
                 and calendar.deleted_at is null
                 and calendar.type = 'personal'
                 and calendar.status in ('approved', 'none')
                 and assignment.id = any(array[
                   calendar.user_id
                 ] || coalesce(calendar.team_member_ids, array[]::text[]))
                 and calendar.start_date < (v_row->>'end_at')::timestamptz
                 and calendar.end_date > (v_row->>'start_at')::timestamptz
             )
           ) then
          v_row := v_row || pg_catalog.jsonb_build_object(
            'source_sha256', pg_catalog.encode(extensions.digest(
              pg_catalog.convert_to(v_row::text, 'UTF8'), 'sha256'
            ), 'hex')
          );
          v_reschedule_options := v_reschedule_options ||
            pg_catalog.jsonb_build_array(v_row);
        end if;
      end loop;
    end if;

    v_row := pg_catalog.jsonb_build_object(
      'kind', source.kind,
      'item_id', source.item_id,
      'project_id', source.project_id,
      'project_title', source.project_title,
      'project_status', source.project_status,
      'project_status_version', source.project_status_version::text,
      'title', source.title,
      'task_type_id', source.task_type_id,
      'schedule_version', source.schedule_version::text,
      'current_start_at', pg_catalog.to_char(
        case when source.kind = 'task' then
          private.agent_unambiguous_local_instant(
            (((source.start_date at time zone 'UTC')::date) + case
              when source.all_day then v_company.default_work_start
              else source.start_time end)::timestamp,
            v_company.timezone
          ) else source.start_date end at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      'current_end_at', pg_catalog.to_char(
        case when source.kind = 'task' then
          private.agent_unambiguous_local_instant(
            (((source.end_date at time zone 'UTC')::date) + case
              when source.all_day then v_company.default_work_end
              else source.end_time end)::timestamp,
            v_company.timezone
          ) else source.end_date end at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      'coverage_start_at', pg_catalog.to_char(
        case when source.kind = 'task' then
          private.agent_unambiguous_local_instant(
            (p_target_date + case when source.all_day
              then v_company.default_work_start else source.start_time end
            )::timestamp, v_company.timezone
          ) else greatest(source.start_date, v_window_start) end at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      'coverage_end_at', pg_catalog.to_char(
        case when source.kind = 'task' then
          private.agent_unambiguous_local_instant(
            (p_target_date + case when source.all_day
              then v_company.default_work_end else source.end_time end
            )::timestamp, v_company.timezone
          ) else least(source.end_date, v_window_end) end at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ),
      'all_day', source.all_day,
      'assignee_ids', pg_catalog.to_jsonb(v_assignees),
      'schedule_locked', source.schedule_locked,
      'recurrence_id', source.recurrence_id,
      'paired_from_task_id', source.paired_from_task_id,
      'dependency_count', v_dependency_count,
      'dependency_override_count', v_override_count,
      'recipient', v_recipient,
      'reschedule_options', v_reschedule_options
    );
    v_row := v_row || pg_catalog.jsonb_build_object(
      'source_sha256', pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to(v_row::text, 'UTF8'), 'sha256'
      ), 'hex')
    );
    v_affected := v_affected || pg_catalog.jsonb_build_array(v_row);
  end loop;
  if pg_catalog.jsonb_array_length(v_affected) <> v_item_count then
    raise exception 'AGENT_CREW_CALLOUT_SOURCE_STALE'
      using errcode = '55000';
  end if;

  select pg_catalog.count(*)::integer into v_candidate_count
  from public.users member
  where member.company_id = p_company_id
    and member.deleted_at is null
    and member.is_active is true
    and member.id <> v_member.id;
  if v_candidate_count >= p_candidate_limit then
    raise exception 'AGENT_CREW_CALLOUT_SOURCE_BOUND'
      using errcode = '54000';
  end if;

  select pg_catalog.count(*)::integer into v_schedule_count
  from (
    select task.id
    from public.project_tasks task
    where task.company_id = p_company_id
      and task.deleted_at is null
      and task.status not in ('completed', 'cancelled')
      and task.start_date is not null
      and (task.start_date at time zone 'UTC')::date <= p_target_date + 14
      and (coalesce(task.end_date, task.start_date) at time zone 'UTC')::date >= p_target_date
    union all
    select visit.id
    from public.site_visits visit
    where visit.company_id = p_company_id::text
      and visit.deleted_at is null
      and visit.booked_at is not null
      and visit.status <> 'cancelled'
      and visit.scheduled_at < private.agent_unambiguous_local_instant(
            (p_target_date + 15)::timestamp, v_company.timezone
          )
      and visit.scheduled_at + pg_catalog.make_interval(
            mins => visit.duration_minutes
          ) > v_window_start
    union all
    select calendar.id
    from public.calendar_user_events calendar
    where calendar.company_id = p_company_id::text
      and calendar.deleted_at is null
      and calendar.type in ('personal', 'time_off')
      and calendar.status in ('approved', 'none')
      and calendar.start_date < private.agent_unambiguous_local_instant(
            (p_target_date + 15)::timestamp, v_company.timezone
          )
      and calendar.end_date > v_window_start
  ) schedule_source;
  if v_schedule_count >= p_schedule_source_limit then
    raise exception 'AGENT_CREW_CALLOUT_SOURCE_BOUND'
      using errcode = '54000';
  end if;

  for candidate in
    select member.*,
           pg_catalog.btrim(pg_catalog.concat_ws(
             ' ', member.first_name, member.last_name
           )) as display_name
    from public.users member
    where member.company_id = p_company_id
      and member.deleted_at is null
      and member.is_active is true
      and member.id <> v_member.id
    order by member.id
  loop
    if candidate.display_name = ''
       or pg_catalog.length(candidate.display_name) > 240
       or not private.agent_prompt_text_is_safe(candidate.display_name, false)
       or nullif(pg_catalog.btrim(candidate.email), '') is not null and (
         pg_catalog.lower(pg_catalog.btrim(candidate.email)) !~
           '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
         or pg_catalog.length(candidate.email) > 320
       ) then
      raise exception 'AGENT_CREW_CALLOUT_SOURCE_STALE'
        using errcode = '55000';
    end if;
    v_roles := '[]'::jsonb;
    for role_source in
      select role.id, role.name
      from public.user_roles membership
      join public.roles role on role.id = membership.role_id
      where membership.user_id = candidate.id::text
        and (role.company_id is null or role.company_id = p_company_id)
      order by role.id
    loop
      if role_source.name is distinct from pg_catalog.btrim(role_source.name)
         or pg_catalog.length(role_source.name) not between 1 and 120
         or not private.agent_prompt_text_is_safe(role_source.name, false) then
        raise exception 'AGENT_CREW_CALLOUT_SOURCE_STALE'
          using errcode = '55000';
      end if;
      v_row := pg_catalog.jsonb_build_object(
        'role_id', role_source.id, 'name', role_source.name
      );
      v_row := v_row || pg_catalog.jsonb_build_object(
        'source_sha256', pg_catalog.encode(extensions.digest(
          pg_catalog.convert_to(v_row::text, 'UTF8'), 'sha256'
        ), 'hex')
      );
      v_roles := v_roles || pg_catalog.jsonb_build_array(v_row);
    end loop;

    select coalesce(pg_catalog.array_agg(distinct assignment.project_id
                                         order by assignment.project_id),
                    array[]::uuid[])
      into v_project_ids
    from (
      select task.project_id
      from public.project_tasks task
      where task.company_id = p_company_id
        and task.deleted_at is null
        and candidate.id::text = any(coalesce(
          task.team_member_ids, array[]::text[]
        ))
      union all
      select coalesce(
               visit.project_ref,
               private.agent_read_domain_uuid_from_text(visit.project_id)
             )
      from public.site_visits visit
      where visit.company_id = p_company_id::text
        and visit.deleted_at is null
        and candidate.id::text = any(coalesce(
          visit.assignee_ids, array[]::text[]
        ))
    ) assignment
    where assignment.project_id is not null
      and private.agent_user_can_access_entity(
        p_actor_user_id, p_company_id, 'project', assignment.project_id, 'view'
      );
    if pg_catalog.cardinality(v_project_ids) > 250 then
      raise exception 'AGENT_CREW_CALLOUT_SOURCE_BOUND'
        using errcode = '54000';
    end if;

    select coalesce(pg_catalog.jsonb_agg(history.row_json
                    order by history.task_type_id), '[]'::jsonb)
      into v_history
    from (
      select task.task_type_id,
             pg_catalog.jsonb_build_object(
               'task_type_id', task.task_type_id,
               'completed_count', pg_catalog.count(*)::integer,
               'source_sha256', pg_catalog.encode(extensions.digest(
                 pg_catalog.convert_to(pg_catalog.jsonb_build_object(
                   'task_type_id', task.task_type_id,
                   'completed_task_ids', pg_catalog.jsonb_agg(
                     task.id order by task.id
                   )
                 )::text, 'UTF8'), 'sha256'
               ), 'hex')
             ) as row_json
      from public.project_tasks task
      where task.company_id = p_company_id
        and task.deleted_at is null
        and task.status = 'completed'
        and task.task_type_id in (
          select (item->>'task_type_id')::uuid
          from pg_catalog.jsonb_array_elements(v_affected) item
          where item->>'kind' = 'task'
        )
        and candidate.id::text = any(coalesce(
          task.team_member_ids, array[]::text[]
        ))
        and private.agent_user_can_access_entity(
          p_actor_user_id, p_company_id, 'project', task.project_id, 'view'
        )
        and private.agent_user_can_access_entity(
          p_actor_user_id, p_company_id, 'task', task.id, 'view'
        )
      group by task.task_type_id
    ) history;

    select coalesce(pg_catalog.jsonb_agg(commitment.row_json
                    order by commitment.kind, commitment.id), '[]'::jsonb)
      into v_commitments
    from (
      select raw.kind, raw.id,
             pg_catalog.jsonb_build_object(
               'kind', raw.kind,
               'id', raw.id,
               'start_at', pg_catalog.to_char(
                 raw.starts_at at time zone 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
               ),
               'end_at', pg_catalog.to_char(
                 raw.ends_at at time zone 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
               ),
               'source_sha256', pg_catalog.encode(extensions.digest(
                 pg_catalog.convert_to(pg_catalog.jsonb_build_object(
                   'kind', raw.kind, 'id', raw.id,
                   'start_at', raw.starts_at, 'end_at', raw.ends_at
                 )::text, 'UTF8'), 'sha256'
               ), 'hex')
             ) as row_json
      from (
        select 'task'::text as kind, task.id,
               private.agent_unambiguous_local_instant(
                 (p_target_date + case when task.all_day
                   then v_company.default_work_start else task.start_time end
                 )::timestamp, v_company.timezone
               ) as starts_at,
               private.agent_unambiguous_local_instant(
                 (p_target_date + case when task.all_day
                   then v_company.default_work_end else task.end_time end
                 )::timestamp, v_company.timezone
               ) as ends_at
        from public.project_tasks task
        where task.company_id = p_company_id
          and task.deleted_at is null
          and task.status not in ('completed', 'cancelled')
          and task.start_date is not null
          and (task.start_date at time zone 'UTC')::date <= p_target_date
          and (coalesce(task.end_date, task.start_date) at time zone 'UTC')::date >= p_target_date
          and candidate.id::text = any(coalesce(
            task.team_member_ids, array[]::text[]
          ))
        union all
        select 'site_visit', visit.id, visit.scheduled_at,
               visit.scheduled_at + pg_catalog.make_interval(
                 mins => visit.duration_minutes
               )
        from public.site_visits visit
        where visit.company_id = p_company_id::text
          and visit.deleted_at is null
          and visit.booked_at is not null
          and visit.status <> 'cancelled'
          and visit.scheduled_at < v_window_end
          and visit.scheduled_at + pg_catalog.make_interval(
                mins => visit.duration_minutes
              ) > v_window_start
          and candidate.id::text = any(coalesce(
            visit.assignee_ids, array[]::text[]
          ))
        union all
        select 'personal_event', calendar.id,
               greatest(calendar.start_date, v_window_start),
               least(calendar.end_date, v_window_end)
        from public.calendar_user_events calendar
        where calendar.company_id = p_company_id::text
          and calendar.deleted_at is null
          and calendar.type = 'personal'
          and calendar.status in ('approved', 'none')
          and candidate.id::text = any(array[
            calendar.user_id
          ] || coalesce(calendar.team_member_ids, array[]::text[]))
          and calendar.start_date < v_window_end
          and calendar.end_date > v_window_start
      ) raw
      where raw.starts_at is not null and raw.ends_at > raw.starts_at
    ) commitment;
    if pg_catalog.jsonb_array_length(v_commitments) > 500 then
      raise exception 'AGENT_CREW_CALLOUT_SOURCE_BOUND'
        using errcode = '54000';
    end if;

    v_row := pg_catalog.jsonb_build_object(
      'member_id', candidate.id,
      'display_name', candidate.display_name,
      'email', case when nullif(pg_catalog.btrim(candidate.email), '') is null then null else
        pg_catalog.lower(pg_catalog.btrim(candidate.email)) end,
      'email_source_sha256', case when nullif(pg_catalog.btrim(candidate.email), '') is null then null else
        pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
          pg_catalog.jsonb_build_object(
            'member_id', candidate.id,
            'email', pg_catalog.lower(pg_catalog.btrim(candidate.email)),
            'updated_at', candidate.updated_at
          )::text, 'UTF8'
        ), 'sha256'), 'hex') end,
      'roles', v_roles,
      'project_ids', pg_catalog.to_jsonb(v_project_ids),
      'same_task_history', v_history,
      'availability_days', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'date', p_target_date::text,
          'working_start_at', case
            when v_company.skip_weekends_in_auto_schedule
             and extract(isodow from p_target_date) >= 6 then null
            else pg_catalog.to_char(
              private.agent_unambiguous_local_instant(
                (p_target_date + v_company.default_work_start)::timestamp,
                v_company.timezone
              ) at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            ) end,
          'working_end_at', case
            when v_company.skip_weekends_in_auto_schedule
             and extract(isodow from p_target_date) >= 6 then null
            else pg_catalog.to_char(
              private.agent_unambiguous_local_instant(
                (p_target_date + v_company.default_work_end)::timestamp,
                v_company.timezone
              ) at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            ) end,
          'has_time_off', exists (
            select 1 from public.calendar_user_events calendar
            where calendar.company_id = p_company_id::text
              and calendar.deleted_at is null
              and calendar.type = 'time_off'
              and calendar.status in ('approved', 'none')
              and candidate.id::text = any(array[
                calendar.user_id
              ] || coalesce(calendar.team_member_ids, array[]::text[]))
              and calendar.start_date < v_window_end
              and calendar.end_date > v_window_start
          ),
          'commitments', v_commitments,
          'source_sha256', pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(pg_catalog.jsonb_build_object(
              'member_id', candidate.id,
              'date', p_target_date,
              'working_start', v_company.default_work_start,
              'working_end', v_company.default_work_end,
              'commitments', v_commitments
            )::text, 'UTF8'), 'sha256'
          ), 'hex')
        )
      )
    );
    v_row := v_row || pg_catalog.jsonb_build_object(
      'source_sha256', pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to(v_row::text, 'UTF8'), 'sha256'
      ), 'hex')
    );
    v_candidates := v_candidates || pg_catalog.jsonb_build_array(v_row);
  end loop;
  if pg_catalog.jsonb_array_length(v_candidates) <> v_candidate_count then
    raise exception 'AGENT_CREW_CALLOUT_SOURCE_STALE'
      using errcode = '55000';
  end if;

  v_context := pg_catalog.jsonb_build_object(
    'company_id', p_company_id,
    'company_name', v_company.name,
    'timezone', v_company.timezone,
    'local_date', v_local_date::text,
    'target_date', p_target_date::text,
    'window_start_at', pg_catalog.to_char(
      v_window_start at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'window_end_at', pg_catalog.to_char(
      v_window_end at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'default_work_start', pg_catalog.to_char(
      v_company.default_work_start, 'HH24:MI:SS'
    ),
    'default_work_end', pg_catalog.to_char(
      v_company.default_work_end, 'HH24:MI:SS'
    ),
    'recovery_horizon_days', 14,
    'skip_weekends', v_company.skip_weekends_in_auto_schedule
  );
  v_context := v_context || pg_catalog.jsonb_build_object(
    'source_sha256', pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(v_context::text, 'UTF8'), 'sha256'
    ), 'hex')
  );
  v_result := pg_catalog.jsonb_build_object(
    'observed_at', pg_catalog.to_char(
      p_observed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'context', v_context,
    'unavailable_member', v_member_json,
    'affected_items', v_affected,
    'candidates', v_candidates
  );
  v_result := pg_catalog.jsonb_build_object(
    'observed_at', v_result->'observed_at',
    'source_revision', pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(v_result::text, 'UTF8'), 'sha256'
    ), 'hex'),
    'context', v_context,
    'unavailable_member', v_member_json,
    'affected_items', v_affected,
    'candidates', v_candidates
  );
  if pg_catalog.octet_length(pg_catalog.convert_to(v_result::text, 'UTF8'))
       > 2000000 then
    raise exception 'AGENT_CREW_CALLOUT_SOURCE_BOUND'
      using errcode = '54000';
  end if;
  return v_result;
end;
$function$;

revoke all on function private.build_agent_crew_callout_recovery_snapshot(
  uuid, uuid, timestamptz, text, date, integer, integer, integer
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_crew_callout_recovery_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_exposure_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_observed_at timestamptz,
  p_crew_member_name text,
  p_target_date date,
  p_item_limit integer,
  p_candidate_limit integer,
  p_schedule_source_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform private.assert_agent_crew_callout_recovery_authority(
    p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
    p_grant_revision, p_granted_scope_ceiling,
    p_permission_snapshot_revision, p_registered_permission_keys,
    p_capability_manifest_revision,
    p_exposure_revision, p_capability_id, p_capability_revision
  );
  return private.build_agent_crew_callout_recovery_snapshot(
    p_actor_user_id, p_company_id, p_observed_at, p_crew_member_name,
    p_target_date,
    p_item_limit, p_candidate_limit, p_schedule_source_limit
  );
exception
  when invalid_text_representation or datetime_field_overflow
    or numeric_value_out_of_range then
    raise exception 'AGENT_CREW_CALLOUT_INPUT_INVALID'
      using errcode = '22023';
end;
$function$;

revoke all on function public.read_agent_crew_callout_recovery_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text[], text, text, text, text,
  timestamptz, text, date, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.read_agent_crew_callout_recovery_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text[], text, text, text, text,
  timestamptz, text, date, integer, integer, integer
) to service_role;

create or replace function public.assert_agent_crew_callout_recovery_authority_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_exposure_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_observed_at timestamptz,
  p_crew_member_name text,
  p_target_date date,
  p_expected_source_revision text,
  p_item_limit integer,
  p_candidate_limit integer,
  p_schedule_source_limit integer
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
    raise exception 'AGENT_CREW_CALLOUT_INPUT_INVALID'
      using errcode = '22023';
  end if;
  v_permission_snapshot_revision :=
    private.assert_agent_crew_callout_recovery_authority(
      p_actor_user_id, p_company_id, p_oauth_grant_id, p_oauth_client_id,
      p_grant_revision, p_granted_scope_ceiling,
      p_permission_snapshot_revision, p_registered_permission_keys,
      p_capability_manifest_revision,
      p_exposure_revision, p_capability_id, p_capability_revision
    );
  v_snapshot := private.build_agent_crew_callout_recovery_snapshot(
    p_actor_user_id, p_company_id, p_observed_at, p_crew_member_name,
    p_target_date,
    p_item_limit, p_candidate_limit, p_schedule_source_limit
  );
  if v_snapshot->>'source_revision' is distinct from
       p_expected_source_revision then
    raise exception 'AGENT_CREW_CALLOUT_SOURCE_STALE'
      using errcode = '55000';
  end if;
  return pg_catalog.jsonb_build_object(
    'permission_snapshot_revision', v_permission_snapshot_revision,
    'source_revision', v_snapshot->>'source_revision'
  );
end;
$function$;

revoke all on function public.assert_agent_crew_callout_recovery_authority_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text[], text, text, text, text,
  timestamptz, text, date, text, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.assert_agent_crew_callout_recovery_authority_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text[], text, text, text, text,
  timestamptz, text, date, text, integer, integer, integer
) to service_role;

create or replace function private.assert_agent_crew_callout_recovery_catalog()
returns void
language plpgsql
stable
set search_path = ''
as $function$
begin
  if exists (
    select 1 from pg_catalog.pg_proc procedure
    where procedure.oid in (
      'private.assert_agent_crew_callout_recovery_authority(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text)'::regprocedure,
      'private.build_agent_crew_callout_recovery_snapshot(uuid,uuid,timestamp with time zone,text,date,integer,integer,integer)'::regprocedure,
      'public.read_agent_crew_callout_recovery_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,timestamp with time zone,text,date,integer,integer,integer)'::regprocedure,
      'public.assert_agent_crew_callout_recovery_authority_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,timestamp with time zone,text,date,text,integer,integer,integer)'::regprocedure
    ) and (
      procedure.provolatile <> 's'
      or not procedure.prosecdef
      or procedure.proconfig is distinct from array['search_path=""']::text[]
    )
  ) then
    raise exception 'AGENT_CREW_CALLOUT_FUNCTION_SHAPE_INVALID'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(coalesce(
      procedure.proacl, pg_catalog.acldefault('f', procedure.proowner)
    )) access
    where procedure.oid in (
      'private.assert_agent_crew_callout_recovery_authority(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text)'::regprocedure,
      'private.build_agent_crew_callout_recovery_snapshot(uuid,uuid,timestamp with time zone,text,date,integer,integer,integer)'::regprocedure,
      'private.mcp_oauth_labels_for_scopes(text[],text)'::regprocedure,
      'private.assert_agent_crew_callout_recovery_catalog()'::regprocedure
    ) and access.privilege_type = 'EXECUTE'
      and access.grantee <> procedure.proowner
  ) or exists (
    select 1
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(coalesce(
      procedure.proacl, pg_catalog.acldefault('f', procedure.proowner)
    )) access
    where procedure.oid in (
      'public.read_agent_crew_callout_recovery_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,timestamp with time zone,text,date,integer,integer,integer)'::regprocedure,
      'public.assert_agent_crew_callout_recovery_authority_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,timestamp with time zone,text,date,text,integer,integer,integer)'::regprocedure
    ) and access.privilege_type = 'EXECUTE'
      and access.grantee <> procedure.proowner
      and access.grantee is distinct from 'service_role'::regrole::oid
  ) then
    raise exception 'AGENT_CREW_CALLOUT_FUNCTION_ACL_INVALID'
      using errcode = '55000';
  end if;
end;
$function$;

revoke all on function private.assert_agent_crew_callout_recovery_catalog()
  from public, anon, authenticated, service_role;

select private.assert_agent_crew_callout_recovery_catalog();

commit;
