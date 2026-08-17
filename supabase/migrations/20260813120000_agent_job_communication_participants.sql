-- Current, authority-bound source snapshots for Task 12 job communication and
-- participant resolution. Browser roles never receive direct execution
-- authority; the public entry points are fixed service-role capabilities and
-- the shared private implementation performs authority and source reads in one
-- PostgreSQL statement.

begin;

do $prerequisites$
declare
  v_signature text;
  v_table text;
begin
  if to_regprocedure('public.read_agent_job_conversation_context_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid)') is null
     or to_regprocedure('public.read_agent_correspondence_evidence_as_system(text,uuid,uuid,text,text[],text,text,text,text,text,text[])') is null
     or to_regprocedure('public.read_agent_scheduled_jobs_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,timestamp with time zone,timestamp with time zone,text[],text[],text,timestamp with time zone,bigint,timestamp with time zone,uuid,integer)') is null
     or to_regprocedure('public.read_agent_job_readiness_issues_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,bigint,timestamp with time zone,uuid,integer)') is null then
    raise exception 'agent_job_communication_participants_prerequisite_missing: v4 public RPCs';
  end if;

  foreach v_signature in array array[
    'private.resolve_agent_actor_authority(uuid,uuid,text[])',
    'private.agent_user_can_access_entity(uuid,uuid,text,uuid,text)',
    'private.resolve_opportunity_client_id(uuid,uuid)',
    'private.user_can_view_inbox_connection(uuid,uuid,uuid,uuid)',
    'private.canonical_agent_projection_json(jsonb)',
    'private.advance_agent_operational_read_revision(uuid)',
    'private.bump_agent_operational_read_revision()',
    'private.agent_unambiguous_local_instant(timestamp without time zone,text)',
    'private.agent_civil_date_start(date,text)',
    'private.agent_rfc3339_utc(timestamp with time zone)',
    'private.agent_assert_operational_timezone_rules()',
    'extensions.digest(bytea,text)',
    'public.read_agent_job_conversation_context_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid)',
    'public.read_agent_correspondence_evidence_as_system(text,uuid,uuid,text,text[],text,text,text,text,text,text[])',
    'public.read_agent_scheduled_jobs_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,timestamp with time zone,timestamp with time zone,text[],text[],text,timestamp with time zone,bigint,timestamp with time zone,uuid,integer)',
    'public.read_agent_job_readiness_issues_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,bigint,timestamp with time zone,uuid,integer)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception
        'agent_job_communication_participants_prerequisite_missing: %',
        v_signature;
    end if;
  end loop;

  foreach v_table in array array[
    'public.companies',
    'public.users',
    'public.clients',
    'public.sub_clients',
    'public.opportunities',
    'public.projects',
    'public.project_tasks',
    'public.task_types',
    'public.project_photos',
    'public.email_suppressions',
    'public.job_conversations',
    'public.job_conversation_anchors',
    'public.job_conversation_turns',
    'public.job_conversation_redaction_events',
    'private.agent_provider_delivery_sources',
    'private.agent_provider_outbound_authority_attestations',
    'public.email_send_intents',
    'private.agent_operational_read_revisions'
  ] loop
    if to_regclass(v_table) is null then
      raise exception
        'agent_job_communication_participants_prerequisite_missing: %',
        v_table;
    end if;
  end loop;
end;
$prerequisites$;

-- One customer can have many related contacts. The current-row predicate and
-- stable id tiebreaker support a bounded, deterministic projection without
-- copying deleted contacts into the materialized job candidate.
create index if not exists sub_clients_agent_current_client_id_idx
  on public.sub_clients (company_id, client_id, id)
  where deleted_at is null;

-- Email suppression is global rather than tenant-scoped. A tenant revision
-- would either leak unrelated traffic or invalidate every tenant on one
-- address change, so Task 12 keeps only an opaque per-normalized-address fence.
-- The table stores a digest, never the address itself or suppression metadata.
create table if not exists private.agent_contactability_address_revisions (
  address_sha256 text primary key,
  source_revision bigint not null default 0,
  updated_at timestamptz not null default statement_timestamp(),
  constraint agent_contactability_address_revisions_hash
    check (address_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  constraint agent_contactability_address_revisions_safe_integer
    check (source_revision between 0 and 9007199254740991)
);

revoke all on table private.agent_contactability_address_revisions
  from public, anon, authenticated, service_role;

-- Existing suppressions start at revision zero. The active scalar is still
-- read in the same statement, so zero is a complete initial snapshot rather
-- than an assertion that the address has never appeared.
insert into private.agent_contactability_address_revisions (
  address_sha256,
  source_revision,
  updated_at
)
select distinct
       'sha256:' || encode(
         extensions.digest(
           convert_to(lower(suppression.email), 'UTF8'),
           'sha256'
         ),
         'hex'
       ),
       0,
       statement_timestamp()
from public.email_suppressions suppression
where suppression.email is not null
  and octet_length(suppression.email) between 3 and 320
on conflict (address_sha256) do nothing;

create or replace function private.advance_agent_contactability_revision(
  p_address_sha256 text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, private, pg_temp
as $function$
begin
  if p_address_sha256 is null
     or p_address_sha256 !~ '^sha256:[0-9a-f]{64}$' then
    return;
  end if;

  insert into private.agent_contactability_address_revisions as revision (
    address_sha256,
    source_revision,
    updated_at
  ) values (
    p_address_sha256,
    1,
    statement_timestamp()
  )
  on conflict (address_sha256) do update
  set source_revision = revision.source_revision + 1,
      updated_at = excluded.updated_at
  where revision.source_revision < 9007199254740991;

  if not found then
    raise exception 'agent_contactability_revision_exhausted'
      using errcode = '22003';
  end if;
end;
$function$;

revoke all on function private.advance_agent_contactability_revision(text)
  from public, anon, authenticated, service_role;

create or replace function private.bump_agent_contactability_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private, extensions, pg_temp
as $function$
declare
  v_old_hash text;
  v_new_hash text;
begin
  if tg_op in ('UPDATE', 'DELETE')
     and old.email is not null
     and octet_length(old.email) between 3 and 320 then
    v_old_hash := 'sha256:' || encode(
      extensions.digest(
        convert_to(lower(old.email), 'UTF8'),
        'sha256'
      ),
      'hex'
    );
  end if;

  if tg_op in ('INSERT', 'UPDATE')
     and new.email is not null
     and octet_length(new.email) between 3 and 320 then
    v_new_hash := 'sha256:' || encode(
      extensions.digest(
        convert_to(lower(new.email), 'UTF8'),
        'sha256'
      ),
      'hex'
    );
  end if;

  perform private.advance_agent_contactability_revision(v_old_hash);
  if v_new_hash is distinct from v_old_hash then
    perform private.advance_agent_contactability_revision(v_new_hash);
  end if;
  return null;
end;
$function$;

revoke all on function private.bump_agent_contactability_revision()
  from public, anon, authenticated, service_role;

drop trigger if exists email_suppressions_bump_agent_contactability_revision
  on public.email_suppressions;
create trigger email_suppressions_bump_agent_contactability_revision
after insert or update or delete on public.email_suppressions
for each row execute function private.bump_agent_contactability_revision();

-- Extend the existing tenant-local operational fence only for source tables
-- Task 12 newly reads. Existing Task 11 triggers already cover companies,
-- clients, projects, project_tasks, task_types, users, and project_photos.
drop trigger if exists sub_clients_bump_agent_operational_read_revision
  on public.sub_clients;
create trigger sub_clients_bump_agent_operational_read_revision
after insert or update or delete on public.sub_clients
for each row execute function private.bump_agent_operational_read_revision();

drop trigger if exists opportunities_bump_agent_operational_read_revision
  on public.opportunities;
create trigger opportunities_bump_agent_operational_read_revision
after insert or update or delete on public.opportunities
for each row execute function private.bump_agent_operational_read_revision();

drop trigger if exists job_conversations_bump_agent_operational_read_revision
  on public.job_conversations;
create trigger job_conversations_bump_agent_operational_read_revision
after insert or update or delete on public.job_conversations
for each row execute function private.bump_agent_operational_read_revision();

drop trigger if exists job_conversation_anchors_bump_agent_operational_read_revision
  on public.job_conversation_anchors;
create trigger job_conversation_anchors_bump_agent_operational_read_revision
after insert or update or delete on public.job_conversation_anchors
for each row execute function private.bump_agent_operational_read_revision();

drop trigger if exists job_conversation_turns_bump_agent_operational_read_revision
  on public.job_conversation_turns;
create trigger job_conversation_turns_bump_agent_operational_read_revision
after insert or update or delete on public.job_conversation_turns
for each row execute function private.bump_agent_operational_read_revision();

drop trigger if exists job_conversation_redaction_events_bump_agent_operational_read_revision
  on public.job_conversation_redaction_events;
create trigger job_conversation_redaction_events_bump_agent_operational_read_revision
after insert or update or delete on public.job_conversation_redaction_events
for each row execute function private.bump_agent_operational_read_revision();

drop trigger if exists email_send_intents_bump_agent_operational_read_revision
  on public.email_send_intents;
create trigger email_send_intents_bump_agent_operational_read_revision
after insert or update or delete on public.email_send_intents
for each row execute function private.bump_agent_operational_read_revision();

drop trigger if exists agent_provider_outbound_authority_bump_operational_read_revision
  on private.agent_provider_outbound_authority_attestations;
create trigger agent_provider_outbound_authority_bump_operational_read_revision
after insert or update or delete
  on private.agent_provider_outbound_authority_attestations
for each row execute function private.bump_agent_operational_read_revision();

create or replace function private.read_agent_job_participant_snapshot(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_job_permission text,
  p_job_scope text,
  p_projects_scope text,
  p_calendar_scope text,
  p_tasks_scope text,
  p_photos_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_purpose text,
  p_projection_kind text
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  v_result jsonb;
begin
  if p_request_id is null
     or p_request_id is distinct from btrim(p_request_id)
     or octet_length(p_request_id) not between 1 and 256
     or p_actor_user_id is null
     or p_company_id is null
     or p_permission_snapshot_revision is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_registered_permission_keys is null
     or cardinality(p_registered_permission_keys) not between 1 and 256
     or p_capability_manifest_revision
       is distinct from '2026-08-13.capability-manifest.v5'
     or p_inbox_scope not in ('all', 'assigned', 'own')
     or p_clients_scope not in ('all', 'assigned')
     or p_job_kind not in ('opportunity', 'project')
     or p_job_id is null
     or p_job_permission is distinct from (case p_job_kind
       when 'opportunity' then 'pipeline.view'
       when 'project' then 'projects.view'
     end)
     or p_job_scope not in ('all', 'assigned')
     or p_projects_scope is not null
        and p_projects_scope not in ('all', 'assigned')
     or p_calendar_scope is not null
        and p_calendar_scope not in ('all', 'own')
     or p_tasks_scope is not null
        and p_tasks_scope not in ('all', 'assigned')
     or p_photos_scope is not null
        and p_photos_scope not in ('all', 'assigned')
     or p_projection_kind not in ('communication', 'participants') then
    raise exception 'invalid_agent_job_participant_snapshot_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_registered_permission_keys) registry(permission_key)
    where registry.permission_key is null
       or registry.permission_key is distinct from btrim(registry.permission_key)
       or octet_length(registry.permission_key) not between 1 and 128
       or registry.permission_key
         !~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'
  ) or (
    select count(distinct registry.permission_key)
    from unnest(p_registered_permission_keys) registry(permission_key)
  ) <> cardinality(p_registered_permission_keys)
  or not ('calendar.view' = any(p_registered_permission_keys))
  or not ('clients.view' = any(p_registered_permission_keys))
  or not ('inbox.view' = any(p_registered_permission_keys))
  or not ('photos.view' = any(p_registered_permission_keys))
  or not ('pipeline.view' = any(p_registered_permission_keys))
  or not ('projects.view' = any(p_registered_permission_keys))
  or not ('tasks.view' = any(p_registered_permission_keys)) then
    raise exception 'invalid_agent_job_participant_snapshot_request'
      using errcode = '22023';
  end if;

  if p_projection_kind = 'communication' then
    if p_capability_id is distinct from 'get_job_communication_context'
       or p_capability_revision is distinct from
         'get_job_communication_context:2026-08-13.v1'
       or p_purpose not in ('schedule_notice', 'photo_request', 'general')
       or p_job_kind = 'project' and p_projects_scope is null
       or p_job_kind = 'opportunity'
          and p_purpose = 'general'
          and p_projects_scope is not null
       or p_purpose in ('schedule_notice', 'photo_request')
          and (
            p_projects_scope is null
            or p_calendar_scope is null
            or p_tasks_scope is null
          )
       or p_purpose = 'general'
          and (
            p_calendar_scope is not null
            or p_tasks_scope is not null
            or p_photos_scope is not null
          )
       or p_purpose = 'schedule_notice' and p_photos_scope is not null
       or p_purpose = 'photo_request' and p_photos_scope is null then
      raise exception 'invalid_agent_job_participant_snapshot_request'
        using errcode = '22023';
    end if;
  else
    if p_capability_id is distinct from 'resolve_job_participants'
       or p_capability_revision is distinct from
         'resolve_job_participants:2026-08-13.v1'
       or p_purpose not in ('communication', 'schedule', 'assignment', 'general')
       or p_job_kind = 'project' and p_projects_scope is null
       or p_job_kind = 'opportunity'
          and p_purpose in ('communication', 'general')
          and p_projects_scope is not null
       or p_purpose in ('schedule', 'assignment')
          and (p_projects_scope is null or p_tasks_scope is null)
       or p_purpose in ('communication', 'general')
          and p_tasks_scope is not null then
      raise exception 'invalid_agent_job_participant_snapshot_request'
        using errcode = '22023';
    end if;
  end if;

  if (
    p_projection_kind = 'communication'
    and p_purpose in ('schedule_notice', 'photo_request')
  ) or (
    p_projection_kind = 'participants'
    and p_purpose in ('schedule', 'assignment')
  ) then
    perform private.agent_assert_operational_timezone_rules();
  end if;

  -- Every source row below is reached through this one authority-bound
  -- statement. No service-role pre-read becomes fetch authority.
  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           authority.is_admin,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'calendar.view'
           ) as calendar_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'clients.view'
           ) as clients_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'inbox.view'
           ) as inbox_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'photos.view'
           ) as photos_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'pipeline.view'
           ) as pipeline_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'projects.view'
           ) as projects_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'tasks.view'
           ) as tasks_scope
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    group by authority.permission_snapshot_revision, authority.is_admin
  ), authority_context as materialized (
    select authority.permission_snapshot_revision,
           authority.is_admin,
           company.timezone as company_timezone
    from current_authority authority
    join public.companies company
      on company.id = p_company_id
     and company.deleted_at is null
    where authority.permission_snapshot_revision =
            p_permission_snapshot_revision
      and authority.clients_scope = p_clients_scope
      and authority.inbox_scope = p_inbox_scope
      and case p_job_permission
        when 'pipeline.view' then authority.pipeline_scope
        when 'projects.view' then authority.projects_scope
      end = p_job_scope
      and (p_projects_scope is null
        or authority.projects_scope = p_projects_scope)
      and (p_calendar_scope is null
        or authority.calendar_scope = p_calendar_scope)
      and (p_tasks_scope is null
        or authority.tasks_scope = p_tasks_scope)
      and (p_photos_scope is null
        or authority.photos_scope = p_photos_scope)
      and company.timezone is not null
      and exists (
        select 1
        from pg_timezone_names timezone
        where timezone.name = company.timezone
      )
  ), requested_job as materialized (
    select opportunity.id as job_id,
           'opportunity'::text as job_kind,
           case when opportunity.title is not null
                  and octet_length(opportunity.title) <= 1000
             then nullif(btrim(opportunity.title), '') end as job_title,
           case when opportunity.description is not null
                  and octet_length(opportunity.description) <= 4000
             then nullif(btrim(opportunity.description), '')
           end as job_description,
           case when opportunity.address is not null
                  and octet_length(opportunity.address) <= 2000
             then nullif(btrim(opportunity.address), '') end as job_address,
           private.resolve_opportunity_client_id(
             opportunity.client_ref,
             opportunity.client_id
           ) as client_id,
           coalesce(opportunity.project_ref, opportunity.project_id) as linked_project_id,
           opportunity.id as opportunity_id,
           context.company_timezone,
           coalesce(octet_length(opportunity.title) > 1000, false)
             or coalesce(octet_length(opportunity.description) > 4000, false)
             or coalesce(octet_length(opportunity.address) > 2000, false)
             as source_data_invalid
    from authority_context context
    join public.opportunities opportunity
      on p_job_kind = 'opportunity'
     and opportunity.id = p_job_id
     and opportunity.company_id = p_company_id
     and opportunity.deleted_at is null
     and opportunity.merged_into_opportunity_id is null
    where private.agent_user_can_access_entity(
      p_actor_user_id,
      p_company_id,
      p_job_kind,
      p_job_id,
      'view'
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
           'project'::text,
           case when project.title is not null
                  and octet_length(project.title) <= 1000
             then nullif(btrim(project.title), '') end,
           case when project.description is not null
                  and octet_length(project.description) <= 4000
             then nullif(btrim(project.description), '') end,
           case when project.address is not null
                  and octet_length(project.address) <= 2000
             then nullif(btrim(project.address), '') end,
           project.client_id,
           project.id,
           project.opportunity_ref,
           context.company_timezone,
           coalesce(octet_length(project.title) > 1000, false)
             or coalesce(octet_length(project.description) > 4000, false)
             or coalesce(octet_length(project.address) > 2000, false)
             as source_data_invalid
    from authority_context context
    join public.projects project
      on p_job_kind = 'project'
     and project.id = p_job_id
     and project.company_id = p_company_id
     and project.deleted_at is null
    where private.agent_user_can_access_entity(
      p_actor_user_id,
      p_company_id,
      p_job_kind,
      p_job_id,
      'view'
    )
  ), authorized_project as materialized (
    select project.id,
           project.client_id,
           case when project.title is not null
                  and octet_length(project.title) <= 1000
             then nullif(btrim(project.title), '') end as title,
           case when project.description is not null
                  and octet_length(project.description) <= 4000
             then nullif(btrim(project.description), '') end as description,
           case when project.address is not null
                  and octet_length(project.address) <= 2000
             then nullif(btrim(project.address), '') end as address,
           project.status,
           project.status_version,
           project.updated_at,
           coalesce(octet_length(project.title) > 1000, false)
             or coalesce(octet_length(project.description) > 4000, false)
             or coalesce(octet_length(project.address) > 2000, false)
             as source_data_invalid
    from requested_job job
    join public.projects project
      on (p_job_kind = 'project' or p_projects_scope is not null)
     and project.id = job.linked_project_id
     and project.company_id = p_company_id
     and project.deleted_at is null
     and (
       p_job_kind <> 'opportunity'
       or project.client_id = job.client_id
     )
    where private.agent_user_can_access_entity(
      p_actor_user_id,
      p_company_id,
      'project',
      project.id,
      'view'
    )
  ), authorized_customer as materialized (
    select client.id,
           case
             when client.name is null then 'Customer'
             when octet_length(client.name) <= 256
              and nullif(btrim(client.name), '') is not null
               then btrim(client.name)
             when octet_length(client.name) <= 256 then 'Customer'
           end as name,
           case when client.email is null
                  or octet_length(client.email) <= 320
             then client.email end as email,
           coalesce(octet_length(client.name) > 256, false)
             or coalesce(octet_length(client.email) > 320, false)
             as source_data_invalid
    from requested_job job
    join public.clients client
      on client.id = job.client_id
     and client.company_id = p_company_id
     and client.deleted_at is null
     and client.merged_into_client_id is null
    where private.agent_user_can_access_entity(
      p_actor_user_id,
      p_company_id,
      'client',
      client.id,
      'view'
    )
  ), authorized_current_fence as materialized (
    select job.job_id,
           job.job_kind,
           job.job_title,
           job.job_description,
           job.job_address,
           job.client_id as requested_client_id,
           job.linked_project_id,
           job.opportunity_id,
           job.company_timezone,
           job.source_data_invalid as job_source_data_invalid,
           authority.permission_snapshot_revision,
           revision.source_revision,
           date_trunc('milliseconds', statement_timestamp()) as read_at,
           coalesce(nullif(btrim(p_purpose), ''), 'general') as purpose
    from requested_job job
    join authority_context authority on true
    join private.agent_operational_read_revisions revision
      on revision.company_id = p_company_id
     and revision.source_revision between 0 and 9007199254740991
    where authority.permission_snapshot_revision =
            p_permission_snapshot_revision
      and (
        (p_job_kind = 'opportunity'
          and p_projects_scope is null)
        or exists (select 1 from authorized_project)
      )
  ), conversation_context as materialized (
    select fence.job_id,
           fence.opportunity_id,
           conversation.id as conversation_id,
           conversation.source_state_revision
    from authorized_current_fence fence
    left join public.job_conversation_anchors anchor
      on anchor.company_id = p_company_id
     and anchor.anchor_kind = p_job_kind
     and anchor.source_id = p_job_id
    left join public.job_conversations conversation
      on conversation.company_id = p_company_id
     and conversation.id = anchor.conversation_id
  ), bounded_turn as materialized (
    select source.id,
           source.conversation_id,
           source.source_state_revision,
           context.source_state_revision as conversation_source_state_revision,
           source.provider_delivery_source_id,
           source.provider_delivery_source_sha256,
           source.side,
           source.direction,
           source.participant_id,
           source.participant_resolution_status,
           source.participant_resolution_revision,
           source.delivered_at
    from conversation_context context
    join lateral (
      select turn.id,
             turn.conversation_id,
             turn.source_state_revision,
             turn.provider_delivery_source_id,
             turn.provider_delivery_source_sha256,
             turn.side,
             turn.direction,
             turn.participant_id,
             turn.participant_resolution_status,
             turn.participant_resolution_revision,
             turn.delivered_at
      from public.job_conversation_turns turn
      join private.agent_provider_delivery_sources provider_source
        on provider_source.company_id = turn.company_id
       and provider_source.id = turn.provider_delivery_source_id
       and provider_source.source_sha256 =
         turn.provider_delivery_source_sha256
      where context.conversation_id is not null
        and turn.company_id = p_company_id
        and turn.conversation_id = context.conversation_id
        and turn.source_state_revision <= context.source_state_revision
        and private.user_can_view_inbox_connection(
          p_actor_user_id,
          p_company_id,
          turn.source_connection_id,
          context.opportunity_id
        )
      order by turn.delivered_at desc, turn.id desc
      limit 251
    ) source on true
  ), turn_source_state as materialized (
    select count(*) > 250 as source_query_bound,
           coalesce(bool_or(
             turn.participant_id is null
             or octet_length(turn.participant_id) not between 1 and 512
             or turn.participant_resolution_revision is null
             or octet_length(turn.participant_resolution_revision)
                  not between 1 and 256
           ), false) as source_data_invalid
    from bounded_turn turn
  ), effective_turn as materialized (
    select turn.id,
           turn.delivered_at,
           turn.provider_delivery_source_id,
           turn.provider_delivery_source_sha256,
           turn.side,
           turn.direction,
           case when coalesce(redaction.participant_redacted, false)
             then 'redacted:sha256:' || encode(
               extensions.digest(
                 convert_to(turn.id::text, 'UTF8'),
                 'sha256'
               ),
               'hex'
             )
             else turn.participant_id
           end as participant_id,
           case when coalesce(redaction.participant_redacted, false)
             then 'unresolved'
             else turn.participant_resolution_status
           end as participant_resolution_status,
           case when coalesce(redaction.participant_redacted, false)
             then 'job-participant-redaction:v1:' ||
               redaction.max_source_state_revision::text
             else turn.participant_resolution_revision
           end as participant_resolution_revision,
           coalesce(redaction.participant_redacted, false)
             as participant_redacted
    from bounded_turn turn
    left join lateral (
      select true as participant_redacted,
             event.source_state_revision as max_source_state_revision
      from public.job_conversation_redaction_events event
      where event.company_id = p_company_id
        and event.conversation_id = turn.conversation_id
        and event.target_turn_id = turn.id
        and event.redaction_kind = 'participant_pseudonymized'
        and event.source_state_revision <=
          turn.conversation_source_state_revision
      order by event.source_state_revision desc, event.id desc
      limit 1
    ) redaction on true
    where (select not source_data_invalid from turn_source_state)
  ), participant_evidence_ranked as materialized (
    select turn.id,
           turn.delivered_at,
           turn.provider_delivery_source_id,
           turn.provider_delivery_source_sha256,
           turn.side,
           turn.direction,
           turn.participant_id,
           turn.participant_resolution_status,
           turn.participant_resolution_revision,
           turn.participant_redacted,
           row_number() over (
             partition by turn.participant_id,
               turn.participant_resolution_status,
               turn.participant_resolution_revision
             order by turn.delivered_at desc, turn.id desc
           ) as evidence_rank,
           row_number() over (
             order by turn.delivered_at desc, turn.id desc
           ) as evidence_total_rank,
           count(*) over (
             partition by turn.participant_id,
               turn.participant_resolution_status,
               turn.participant_resolution_revision
           )::integer as evidence_id_total
    from effective_turn turn
    where turn.participant_redacted or not (
      turn.direction = 'outbound'
      and exists (
        select 1
        from private.agent_provider_outbound_authority_attestations
          attestation
        where attestation.company_id = p_company_id
          and attestation.provider_source_id =
            turn.provider_delivery_source_id
          and attestation.source_sha256 =
            turn.provider_delivery_source_sha256
      )
    )
  ), participant_evidence as materialized (
    select evidence.participant_id,
           evidence.participant_resolution_status,
           evidence.participant_resolution_revision,
           evidence.participant_redacted,
           max(evidence.evidence_id_total)::integer as evidence_id_total,
           array_agg(
             'job_conversation_turn:' || evidence.id::text
             order by evidence.delivered_at desc, evidence.id desc
           ) filter (
             where evidence.evidence_rank <= 5
               and evidence.evidence_total_rank <= 50
           ) as evidence_ids
    from participant_evidence_ranked evidence
    group by evidence.participant_id,
             evidence.participant_resolution_status,
             evidence.participant_resolution_revision,
             evidence.participant_redacted
  ), attested_delivery_turn as materialized (
    select turn.id,
           turn.delivered_at,
           attestation.actor_user_id,
           case
             when attestation.accepted_intent_kind = 'email_send_intent'
              and send_intent.initiated_by = 'phase_c_auto_send'
               then true
             else false
           end as is_phase_c
    from effective_turn turn
    join private.agent_provider_outbound_authority_attestations attestation
      on attestation.company_id = p_company_id
     and attestation.provider_source_id =
       turn.provider_delivery_source_id
     and attestation.source_sha256 =
       turn.provider_delivery_source_sha256
    left join public.email_send_intents send_intent
      on attestation.accepted_intent_kind = 'email_send_intent'
     and send_intent.company_id = p_company_id
     and send_intent.id = attestation.email_send_intent_id
     and send_intent.actor_user_id = attestation.actor_user_id
     and send_intent.status in (
       'provider_accepted', 'reconciling', 'reconciliation_failed',
       'reconciled'
     )
    where turn.direction = 'outbound'
      and not turn.participant_redacted
  ), attested_ops_participant as materialized (
    select 5::integer as kind_rank,
           'ops_delivery_user'::text as source_kind,
           actor.id as record_id,
           null::text as opaque_id,
           actor_name.display_name,
           null::text as role_label,
           'assistant'::text as conversation_side,
           'confirmed'::text as resolution_status,
           'ops_delivery_actor'::text as resolution_basis,
           'job-participant-resolution:v1'::text as resolution_revision,
           null::integer as candidate_count_lower_bound,
           null::text as email,
           (array_agg(
             'job_conversation_turn:' || delivery.id::text
             order by delivery.delivered_at desc, delivery.id desc
           ))[1:5] as evidence_ids,
           count(*)::integer as evidence_id_total,
           lower(actor_name.display_name) as normalized_name
    from attested_delivery_turn delivery
    join public.users actor
      on actor.id = delivery.actor_user_id
     and actor.company_id = p_company_id
     and actor.deleted_at is null
     and coalesce(actor.is_active, false)
    cross join lateral (
      select case
        when coalesce(octet_length(actor.first_name), 0) <= 256
         and coalesce(octet_length(actor.last_name), 0) <= 256
          then coalesce(nullif(btrim(concat_ws(
            ' ', actor.first_name, actor.last_name
          )), ''), 'OPS')
      end as display_name
    ) actor_name
    where actor_name.display_name is not null
      and octet_length(actor_name.display_name) between 1 and 256
    group by actor.id, actor_name.display_name
  ), attested_phase_c_participant as materialized (
    select 7::integer as kind_rank,
           'phase_c'::text as source_kind,
           null::uuid as record_id,
           'phase_c'::text as opaque_id,
           null::text as display_name,
           null::text as role_label,
           'assistant'::text as conversation_side,
           'confirmed'::text as resolution_status,
           'phase_c_delivery_origin'::text as resolution_basis,
           'job-participant-resolution:v1'::text as resolution_revision,
           null::integer as candidate_count_lower_bound,
           null::text as email,
           (array_agg(
             'job_conversation_turn:' || delivery.id::text
             order by delivery.delivered_at desc, delivery.id desc
           ))[1:5] as evidence_ids,
           count(*)::integer as evidence_id_total,
           'phase c'::text as normalized_name
    from attested_delivery_turn delivery
    where delivery.is_phase_c
    having count(*) > 0
  ), bounded_sub_client as materialized (
    select source.id,
           source.name,
           source.title,
           source.email,
           source.source_data_invalid,
           source.contact_rank
    from authorized_customer client
    join lateral (
      select sub_client.id,
             case when sub_client.name is not null
                    and octet_length(sub_client.name) <= 256
               then nullif(btrim(sub_client.name), '') end as name,
             case when sub_client.title is not null
                    and octet_length(sub_client.title) <= 256
               then nullif(btrim(sub_client.title), '') end as title,
             case when sub_client.email is null
                    or octet_length(sub_client.email) <= 320
               then sub_client.email end as email,
             coalesce(octet_length(sub_client.name) > 256, false)
               or coalesce(octet_length(sub_client.title) > 256, false)
               or coalesce(octet_length(sub_client.email) > 320, false)
               as source_data_invalid,
             row_number() over (order by sub_client.id) as contact_rank
      from public.sub_clients sub_client
      where sub_client.company_id = p_company_id
        and sub_client.client_id = client.id
        and sub_client.deleted_at is null
        and private.agent_user_can_access_entity(
          p_actor_user_id,
          p_company_id,
          'sub_client',
          sub_client.id,
          'view'
        )
      order by sub_client.id
      limit 51
    ) source on true
  ), sub_client_source_state as materialized (
    select count(*) > 50 as source_query_bound,
           coalesce(bool_or(
             contact.name is null
             or contact.source_data_invalid
           ), false) as source_data_invalid
    from bounded_sub_client contact
  ), authorized_task_candidate as materialized (
    select task.id,
           task.project_id,
           coalesce(
             case when task.custom_title is not null
                    and octet_length(task.custom_title) <= 1000
               then nullif(btrim(task.custom_title), '') end,
             case when task_type.display is not null
                    and octet_length(task_type.display) <= 1000
               then nullif(btrim(task_type.display), '') end,
             project.title
           ) as title,
           task.status,
           task.start_date,
           task.end_date,
           task.start_time,
           task.end_time,
           task.all_day,
           greatest(coalesce(task.duration, 1), 1) as duration,
           case when cardinality(coalesce(
             task.team_member_ids, array[]::text[]
           )) <= 100 then coalesce(
             task.team_member_ids, array[]::text[]
           )[1:100] else array[]::text[] end as team_member_ids,
           cardinality(coalesce(
             task.team_member_ids, array[]::text[]
           )) > 100 as assignment_source_over_bound,
           coalesce(octet_length(task.custom_title) > 1000, false)
             or coalesce(octet_length(task_type.display) > 1000, false)
             as text_source_data_invalid,
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
           fence.company_timezone,
           fence.read_at
    from authorized_current_fence fence
    join authorized_project project on true
    join public.project_tasks task
      on (
        p_projection_kind = 'communication'
          and p_purpose in ('schedule_notice', 'photo_request')
        or p_projection_kind = 'participants'
          and p_purpose in ('schedule', 'assignment')
      )
     and task.project_id = project.id
     and task.company_id = p_company_id
     and task.deleted_at is null
     and task.status = 'active'
    left join public.task_types task_type
      on task_type.id = task.task_type_id
     and task_type.company_id = p_company_id
     and task_type.deleted_at is null
    where (p_purpose = 'assignment' or task.start_date is not null)
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'project',
        project.id,
        'view'
      )
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'task',
        task.id,
        'view'
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
              project_assignment.team_member_ids,
              array[]::text[]
            ))
        )
      )
      and (
        p_tasks_scope = 'all'
        or p_actor_user_id::text = any(coalesce(
          task.team_member_ids,
          array[]::text[]
        ))
      )
      and (
        p_calendar_scope is null
        or p_calendar_scope = 'all'
        or p_actor_user_id::text = any(coalesce(
          task.team_member_ids,
          array[]::text[]
        ))
      )
    order by task.start_date nulls last, task.id
    limit 51
  ), task_source_state as materialized (
    select count(*) > 50 as source_query_bound,
           coalesce(bool_or(
             task.title is null
             or octet_length(task.title) > 1000
             or task.text_source_data_invalid
             or task.project_title is null
             or octet_length(task.project_title) > 1000
             or task.project_address is not null
                and octet_length(btrim(task.project_address)) > 2000
             or task.duration > 365
             or task.schedule_version not between 0 and 9007199254740991
             or task.project_status_version not between 0 and 9007199254740991
             or task.task_updated_at is null
             or task.project_updated_at is null
             or task.assignment_source_over_bound
           ), false) as source_data_invalid,
           coalesce(bool_or(
             task.assignment_source_over_bound
           ), false) as assignment_source_query_bound
    from authorized_task_candidate task
  ), local_schedule as materialized (
    select task.*,
           (
             (task.start_date at time zone 'UTC')::date
               + case when task.all_day
                   then time '00:00:00'
                   else task.start_time
                 end
           )::timestamp without time zone as local_start_value,
           (
             case when task.all_day then
               coalesce(
                 (task.end_date at time zone 'UTC')::date,
                 (task.start_date at time zone 'UTC')::date
                   + task.duration - 1
               ) + time '00:00:00'
             else
               coalesce(
                 (task.end_date at time zone 'UTC')::date,
                 (task.start_date at time zone 'UTC')::date +
                   case when task.end_time <= task.start_time then 1 else 0 end
               ) + task.end_time
             end
           )::timestamp without time zone as local_end_value
    from authorized_task_candidate task
    where (select not source_query_bound from task_source_state)
      and (select not source_data_invalid from task_source_state)
      and task.start_date is not null
      and (
        task.all_day
        or task.start_time is not null and task.end_time is not null
      )
      and (
        task.end_date is null
        or (task.end_date at time zone 'UTC')::date >=
          (task.start_date at time zone 'UTC')::date
      )
  ), resolved_schedule as materialized (
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
    from local_schedule schedule
  ), resolved_source_state as materialized (
    select coalesce(bool_or(
             schedule.scheduled_start_utc is null
             or schedule.scheduled_end_utc is null
             or schedule.scheduled_end_utc <= schedule.scheduled_start_utc
           ), false) as source_data_invalid
    from resolved_schedule schedule
  ), occurrence_ranked as materialized (
    select schedule.*,
           row_number() over (
             order by schedule.scheduled_start_utc, schedule.id
           ) as occurrence_rank
    from resolved_schedule schedule
    where schedule.scheduled_start_utc is not null
      and schedule.scheduled_end_utc is not null
      and schedule.scheduled_end_utc > schedule.scheduled_start_utc
  ), occurrence_budgeted as materialized (
    select occurrence.*,
           sum(least(cardinality(coalesce(
             occurrence.team_member_ids,
             array[]::text[]
           )), 50)) over (
             order by occurrence.scheduled_start_utc, occurrence.id
             rows between unbounded preceding and current row
           ) as running_raw_assignment_count
    from occurrence_ranked occurrence
    where occurrence.occurrence_rank <= 50
  ), bounded_occurrence as materialized (
    select occurrence.id,
           occurrence.project_id,
           occurrence.title,
           occurrence.status,
           occurrence.team_member_ids,
           occurrence.schedule_confirmed_at,
           occurrence.confirmed_schedule_version,
           occurrence.schedule_locked,
           occurrence.schedule_version,
           occurrence.task_updated_at,
           occurrence.project_title,
           occurrence.project_address,
           occurrence.project_status,
           occurrence.project_status_version,
           occurrence.project_updated_at,
           occurrence.company_timezone,
           occurrence.read_at,
           occurrence.all_day,
           occurrence.local_start_value,
           occurrence.local_end_value,
           occurrence.scheduled_start_utc,
           occurrence.scheduled_end_utc,
           occurrence.occurrence_rank
    from occurrence_budgeted occurrence
    where occurrence.running_raw_assignment_count <= 100
  ), raw_crew as materialized (
    select occurrence.id as task_id,
           member.user_id,
           member.ordinality,
           min(member.ordinality) over (
             partition by occurrence.id, member.user_id
           ) as first_ordinality
    from bounded_occurrence occurrence
    cross join lateral unnest(
      case when cardinality(
        coalesce(occurrence.team_member_ids, array[]::text[])
      ) <= 100 then
        coalesce(occurrence.team_member_ids, array[]::text[])[1:100]
      else array[]::text[] end
    ) with ordinality member(user_id, ordinality)
  ), valid_crew as materialized (
    select crew.task_id,
           crew_user.id as user_id,
           crew_name.display_name,
           crew.first_ordinality,
           row_number() over (
             partition by crew.task_id
             order by crew.first_ordinality, crew_user.id
           ) as crew_rank
    from raw_crew crew
    join public.users crew_user
      on crew.ordinality = crew.first_ordinality
     and pg_input_is_valid(crew.user_id, 'uuid')
     and crew_user.id::text = crew.user_id
     and crew_user.company_id = p_company_id
     and crew_user.deleted_at is null
     and coalesce(crew_user.is_active, false)
    cross join lateral (
      select case
        when coalesce(octet_length(crew_user.first_name), 0) <= 256
         and coalesce(octet_length(crew_user.last_name), 0) <= 256
          then nullif(btrim(concat_ws(
            ' ', crew_user.first_name, crew_user.last_name
          )), '')
      end as display_name
    ) crew_name
    where crew_name.display_name is not null
      and octet_length(crew_name.display_name) between 1 and 256
  ), crew_source_state as materialized (
    select coalesce(bool_or(
             cardinality(coalesce(
               occurrence.team_member_ids, array[]::text[]
             )) > 100
           ), false)
             or exists (
               select 1
               from (
                 select crew.task_id, count(*)::integer as valid_count
                 from valid_crew crew
                 group by crew.task_id
               ) count_by_task
               where count_by_task.valid_count > 50
             ) as source_query_bound,
           exists (
             select 1
             from raw_crew crew
             left join valid_crew valid
               on valid.task_id = crew.task_id
              and valid.first_ordinality = crew.ordinality
             where crew.ordinality = crew.first_ordinality
               and valid.user_id is null
           ) as source_data_invalid
    from bounded_occurrence occurrence
  ), crew_projection as materialized (
    select crew.task_id,
           jsonb_agg(
             jsonb_build_object(
               'user_id', crew.user_id,
               'display_name', crew.display_name
             ) order by crew.first_ordinality, crew.user_id
           ) filter (where crew.crew_rank <= 50) as assignments,
           count(*)::integer as assignment_total
    from valid_crew crew
    group by crew.task_id
  ), participant_assignment_task as materialized (
    select task.id,
           task.team_member_ids
    from authorized_task_candidate task
    where p_projection_kind = 'participants'
      and p_purpose in ('schedule', 'assignment')
      and (select not source_data_invalid from task_source_state)
      and (
        p_purpose = 'assignment'
        or exists (
          select 1
          from bounded_occurrence occurrence
          where occurrence.id = task.id
        )
      )
    order by task.start_date nulls last, task.id
    limit 50
  ), participant_assignment_member as materialized (
    select task.id as task_id,
           member.user_id,
           min(member.ordinality) as first_ordinality
    from participant_assignment_task task
    cross join lateral unnest(
      case when cardinality(coalesce(
        task.team_member_ids, array[]::text[]
      )) <= 100 then coalesce(
        task.team_member_ids, array[]::text[]
      )[1:100] else array[]::text[] end
    ) with ordinality member(user_id, ordinality)
    group by task.id, member.user_id
  ), participant_assignment_valid as materialized (
    select member.task_id,
           actor.id as user_id,
           actor_name.display_name,
           member.first_ordinality
    from participant_assignment_member member
    join public.users actor
      on pg_input_is_valid(member.user_id, 'uuid')
     and actor.id::text = member.user_id
     and actor.company_id = p_company_id
     and actor.deleted_at is null
     and coalesce(actor.is_active, false)
    cross join lateral (
      select case
        when coalesce(octet_length(actor.first_name), 0) <= 256
         and coalesce(octet_length(actor.last_name), 0) <= 256
          then nullif(btrim(concat_ws(
            ' ', actor.first_name, actor.last_name
          )), '')
      end as display_name
    ) actor_name
    where actor_name.display_name is not null
      and octet_length(actor_name.display_name) between 1 and 256
  ), participant_assignment_state as materialized (
    select exists (
             select 1
             from participant_assignment_member member
             left join participant_assignment_valid valid
               on valid.task_id = member.task_id
              and valid.user_id::text = member.user_id
             where valid.user_id is null
           ) as source_data_invalid,
           (select count(distinct valid.user_id)
            from participant_assignment_valid valid) > 50
             as source_query_bound
  ), assigned_ops_ranked as materialized (
    select actor.user_id,
           actor.display_name,
           (array_agg(
             'project_task_assignment:' || actor.task_id::text
             order by actor.task_id
           ))[1:5] as evidence_ids,
           count(*)::integer as evidence_id_total,
           row_number() over (
             order by lower(actor.display_name), actor.user_id
           ) as assigned_rank
    from participant_assignment_valid actor
    where not (select source_data_invalid
               from participant_assignment_state)
      and not exists (
        select 1
        from attested_ops_participant delivery_actor
        where delivery_actor.record_id = actor.user_id
      )
    group by actor.user_id, actor.display_name
  ), assigned_ops_participant as materialized (
    select 6::integer as kind_rank,
           'task_assignment_user'::text as source_kind,
           actor.user_id as record_id,
           null::text as opaque_id,
           actor.display_name,
           null::text as role_label,
           'assistant'::text as conversation_side,
           'confirmed'::text as resolution_status,
           'task_assignment'::text as resolution_basis,
           'job-participant-resolution:v1'::text as resolution_revision,
           null::integer as candidate_count_lower_bound,
           null::text as email,
           actor.evidence_ids,
           actor.evidence_id_total,
           lower(actor.display_name) as normalized_name
    from assigned_ops_ranked actor
    where actor.assigned_rank <= 50
  ), occurrence_projection as materialized (
    select occurrence.id,
           occurrence.project_id,
           occurrence.scheduled_start_utc,
           occurrence.occurrence_rank,
           jsonb_build_object(
             'job_ref', jsonb_build_object(
               'kind', 'project', 'id', occurrence.project_id
             ),
             'occurrence_ref', jsonb_build_object(
               'kind', 'project_task', 'id', occurrence.id
             ),
             'title', occurrence.title,
             'address', nullif(btrim(occurrence.project_address), ''),
             'task_status', occurrence.status,
             'timing_state', case
               when occurrence.scheduled_start_utc > occurrence.read_at
                 then 'upcoming'
               when occurrence.scheduled_end_utc > occurrence.read_at
                 then 'in_progress'
               else 'past_due'
             end,
             'confirmation_state', case
               when occurrence.schedule_confirmed_at is not null
                and occurrence.confirmed_schedule_version =
                  occurrence.schedule_version
                 then 'confirmed'
               else 'unconfirmed'
             end,
             'schedule_confirmed_at', case
               when occurrence.schedule_confirmed_at is null then null
               else private.agent_rfc3339_utc(
                 occurrence.schedule_confirmed_at
               )
             end,
             'confirmed_schedule_version',
               occurrence.confirmed_schedule_version,
             'schedule_locked', coalesce(occurrence.schedule_locked, false),
             'schedule_version', occurrence.schedule_version,
             'task_updated_at', private.agent_rfc3339_utc(
               occurrence.task_updated_at
             ),
             'project_status', occurrence.project_status,
             'project_status_version', occurrence.project_status_version,
             'project_updated_at', private.agent_rfc3339_utc(
               occurrence.project_updated_at
             ),
             'schedule', jsonb_build_object(
               'all_day', occurrence.all_day,
               'company_timezone', occurrence.company_timezone,
               'local_start', to_char(
                 occurrence.local_start_value,
                 'YYYY-MM-DD"T"HH24:MI:SS'
               ),
               'local_end_inclusive', case when occurrence.all_day
                 then to_char(
                   occurrence.local_end_value::date +
                     time '23:59:59.999999',
                   'YYYY-MM-DD"T"HH24:MI:SS.US'
                 )
                 else to_char(
                   occurrence.local_end_value,
                   'YYYY-MM-DD"T"HH24:MI:SS'
                 )
               end,
               'start_utc', private.agent_rfc3339_utc(
                 occurrence.scheduled_start_utc
               ),
               'start_utc_offset_minutes', (
                 extract(epoch from (
                   occurrence.scheduled_start_utc at time zone
                     occurrence.company_timezone
                   - occurrence.scheduled_start_utc at time zone 'UTC'
                 )) / 60
               )::integer,
               'start_pre_boundary_utc_offset_minutes', case
                 when occurrence.all_day then (
                   extract(epoch from (
                     (occurrence.scheduled_start_utc - interval '1 millisecond')
                       at time zone occurrence.company_timezone
                     - (occurrence.scheduled_start_utc - interval '1 millisecond')
                       at time zone 'UTC'
                   )) / 60
                 )::integer
                 else null
               end,
               'end_utc_exclusive', private.agent_rfc3339_utc(
                 occurrence.scheduled_end_utc
               ),
               'end_utc_offset_minutes', (
                 extract(epoch from (
                   occurrence.scheduled_end_utc at time zone
                     occurrence.company_timezone
                   - occurrence.scheduled_end_utc at time zone 'UTC'
                 )) / 60
               )::integer,
               'end_pre_boundary_utc_offset_minutes', case
                 when occurrence.all_day then (
                   extract(epoch from (
                     (occurrence.scheduled_end_utc - interval '1 millisecond')
                       at time zone occurrence.company_timezone
                     - (occurrence.scheduled_end_utc - interval '1 millisecond')
                       at time zone 'UTC'
                   )) / 60
                 )::integer
                 else null
               end,
               'display', jsonb_build_object(
                 'timezone', occurrence.company_timezone,
                 'local_start', to_char(
                   occurrence.local_start_value,
                   'YYYY-MM-DD"T"HH24:MI:SS'
                 ),
                 'local_end_exclusive', to_char(
                   occurrence.scheduled_end_utc at time zone
                     occurrence.company_timezone,
                   'YYYY-MM-DD"T"HH24:MI:SS'
                 ),
                 'start_utc_offset_minutes', (
                   extract(epoch from (
                     occurrence.scheduled_start_utc at time zone
                       occurrence.company_timezone
                     - occurrence.scheduled_start_utc at time zone 'UTC'
                   )) / 60
                 )::integer,
                 'end_utc_offset_minutes', (
                   extract(epoch from (
                     occurrence.scheduled_end_utc at time zone
                       occurrence.company_timezone
                     - occurrence.scheduled_end_utc at time zone 'UTC'
                   )) / 60
                 )::integer
               )
             ),
             'assignments', coalesce(crew.assignments, '[]'::jsonb),
             'assignment_total', coalesce(crew.assignment_total, 0),
             'assignments_omitted_count', 0
           ) as occurrence
    from bounded_occurrence occurrence
    left join crew_projection crew on crew.task_id = occurrence.id
  ), bounded_structured_photo as materialized (
    select source.id,
           source.deleted_at,
           source.bounded_url,
           source.url_overlength,
           source.source
    from authorized_project project
    join lateral (
      select photo.id,
             photo.deleted_at,
             case
               when photo.url is not null
                and octet_length(photo.url) between 1 and 2048
               then left(photo.url, 2048)
               else null
             end as bounded_url,
             coalesce(octet_length(photo.url) > 2048, false)
               as url_overlength,
             photo.source
      from public.project_photos photo
      where p_projection_kind = 'communication'
        and p_purpose = 'photo_request'
        and photo.project_id = project.id::text
        and photo.company_id = p_company_id::text
        and (
          p_photos_scope = 'all'
          or exists (
            select 1
            from public.project_tasks assigned_task
            where assigned_task.project_id = project.id
              and assigned_task.company_id = p_company_id
              and assigned_task.deleted_at is null
              and assigned_task.status = 'active'
              and p_actor_user_id::text = any(coalesce(
                assigned_task.team_member_ids,
                array[]::text[]
              ))
          )
        )
      order by photo.id
      limit 1001
    ) source on true
  ), structured_photo_state as materialized (
    select count(*) > 1000 as source_query_bound,
           coalesce(bool_or(photo.url_overlength), false)
             as source_data_invalid,
           count(*)::integer as structured_row_count,
           count(*) filter (
             where photo.deleted_at is not null
           )::integer as tombstone_count,
           count(*) filter (
             where photo.deleted_at is null
               and photo.bounded_url ~* '^https?://[^[:space:]]+$'
               and photo.source = 'site_visit'
           )::integer as site_visit_count,
           count(*) filter (
             where photo.deleted_at is null
               and photo.bounded_url ~* '^https?://[^[:space:]]+$'
               and photo.source = 'in_progress'
           )::integer as in_progress_count,
           count(*) filter (
             where photo.deleted_at is null
               and photo.bounded_url ~* '^https?://[^[:space:]]+$'
               and photo.source = 'completion'
           )::integer as completion_count,
           count(*) filter (
             where photo.deleted_at is null
               and photo.bounded_url ~* '^https?://[^[:space:]]+$'
               and photo.source = 'other'
           )::integer as other_count,
           count(*) filter (
             where photo.deleted_at is null
               and photo.bounded_url ~* '^https?://[^[:space:]]+$'
               and photo.source = 'measurement'
           )::integer as measurement_count,
           count(*) filter (
             where photo.deleted_at is null
               and photo.bounded_url ~* '^https?://[^[:space:]]+$'
               and photo.source = 'deck_design'
           )::integer as deck_design_count,
           count(*) filter (
             where photo.deleted_at is null
               and not coalesce((
                 photo.bounded_url ~* '^https?://[^[:space:]]+$'
                 and photo.source in (
                   'site_visit', 'in_progress', 'completion', 'other',
                   'measurement', 'deck_design'
                 )
               ), false)
           )::integer as malformed_or_local_count
    from bounded_structured_photo photo
  ), late_legacy_photo as materialized (
    select coalesce(source.legacy_count > 100, false)
             as source_query_bound,
           coalesce(source.legacy_count <= 100 and exists (
             select 1
             from unnest(coalesce(source.project_images, array[]::text[])[1:100])
               legacy(url)
             where legacy.url is null
                or octet_length(legacy.url) not between 1 and 2048
           ), false) as source_data_invalid,
           case when source.legacy_count <= 100 then (
             select count(*)::integer
             from unnest(coalesce(source.project_images, array[]::text[])[1:100])
               legacy(url)
             where case
               when octet_length(legacy.url) between 1 and 2048
                 then left(legacy.url, 2048)
                   ~* '^https?://[^[:space:]]+$'
               else false
             end
           ) else 0 end as legacy_remote_count
    from authorized_project project
    join structured_photo_state photo
      on photo.structured_row_count = 0
    left join lateral (
      select legacy.project_images,
             cardinality(coalesce(
               legacy.project_images,
               array[]::text[]
             )) as legacy_count
      from public.projects legacy
      where p_projection_kind = 'communication'
        and p_purpose = 'photo_request'
        and legacy.id = project.id
        and legacy.company_id = p_company_id
        and legacy.deleted_at is null
    ) source on true
  ), concrete_participant_candidate as materialized (
    select 1::integer as kind_rank,
           'primary_client'::text as source_kind,
           client.id as record_id,
           null::text as opaque_id,
           client.name as display_name,
           null::text as role_label,
           'user'::text as conversation_side,
           'confirmed'::text as resolution_status,
           'job_client'::text as resolution_basis,
           'job-participant-resolution:v1'::text as resolution_revision,
           null::integer as candidate_count_lower_bound,
           client.email,
           array[
             'evidence:participant:primary-client:' || client.id::text
           ]::text[] as evidence_ids,
           1::integer as evidence_id_total,
           client.name as normalized_name
    from authorized_customer client
    where not client.source_data_invalid

    union all

    select 2,
           'sub_client',
           contact.id,
           null,
           contact.name,
           contact.title,
           'user',
           'confirmed',
           'client_parent',
           'job-participant-resolution:v1',
           null,
           contact.email,
           array[
             'evidence:participant:sub-client:' || contact.id::text
           ]::text[],
           1,
           contact.name
    from bounded_sub_client contact
    where contact.contact_rank <= 50
      and not contact.source_data_invalid
      and contact.name is not null
  ), conversation_participant_candidate as materialized (
    select 4::integer as kind_rank,
           case when evidence.participant_redacted
             then 'conversation_redacted'
             when evidence.participant_resolution_status = 'ambiguous'
             then 'conversation_ambiguous'
             else 'conversation_unresolved'
           end as source_kind,
           null::uuid as record_id,
           case when evidence.participant_redacted
             then 'redacted:sha256:'
             else 'unknown:sha256:'
           end || encode(
             extensions.digest(
               convert_to(evidence.participant_id, 'UTF8'),
               'sha256'
             ),
             'hex'
           ) as opaque_id,
           null::text as display_name,
           null::text as role_label,
           null::text as conversation_side,
           case
             when evidence.participant_redacted then 'redacted'
             when evidence.participant_resolution_status = 'ambiguous'
               then 'ambiguous'
             else 'unresolved'
           end as resolution_status,
           null::text as resolution_basis,
           'job-participant-resolution:v1'::text as resolution_revision,
           case when evidence.participant_resolution_status = 'ambiguous'
             then 2 else null end as candidate_count_lower_bound,
           null::text as email,
           coalesce(evidence.evidence_ids, array[]::text[]) as evidence_ids,
           evidence.evidence_id_total,
           evidence.participant_id as normalized_name
    from participant_evidence evidence
    where evidence.participant_resolution_status in (
      'resolved', 'unresolved', 'ambiguous'
    )
      and not exists (
        select 1
        from concrete_participant_candidate concrete
        where evidence.participant_id in (
          'client:' || concrete.record_id::text,
          'sub_client:' || concrete.record_id::text
        )
      )
  ), participant_candidate as materialized (
    select participant.kind_rank,
           participant.source_kind,
           participant.record_id,
           participant.opaque_id,
           participant.display_name,
           participant.role_label,
           participant.conversation_side,
           participant.resolution_status,
           participant.resolution_basis,
           participant.resolution_revision,
           participant.candidate_count_lower_bound,
           participant.email,
           participant.evidence_ids,
           participant.evidence_id_total,
           participant.normalized_name
    from concrete_participant_candidate participant
    union all
    select participant.kind_rank,
           participant.source_kind,
           participant.record_id,
           participant.opaque_id,
           participant.display_name,
           participant.role_label,
           participant.conversation_side,
           participant.resolution_status,
           participant.resolution_basis,
           participant.resolution_revision,
           participant.candidate_count_lower_bound,
           participant.email,
           participant.evidence_ids,
           participant.evidence_id_total,
           participant.normalized_name
    from conversation_participant_candidate participant

    union all

    select participant.kind_rank,
           participant.source_kind,
           participant.record_id,
           participant.opaque_id,
           participant.display_name,
           participant.role_label,
           participant.conversation_side,
           participant.resolution_status,
           participant.resolution_basis,
           participant.resolution_revision,
           participant.candidate_count_lower_bound,
           participant.email,
           participant.evidence_ids,
           participant.evidence_id_total,
           participant.normalized_name
    from attested_ops_participant participant

    union all

    select participant.kind_rank,
           participant.source_kind,
           participant.record_id,
           participant.opaque_id,
           participant.display_name,
           participant.role_label,
           participant.conversation_side,
           participant.resolution_status,
           participant.resolution_basis,
           participant.resolution_revision,
           participant.candidate_count_lower_bound,
           participant.email,
           participant.evidence_ids,
           participant.evidence_id_total,
           participant.normalized_name
    from assigned_ops_participant participant

    union all

    select participant.kind_rank,
           participant.source_kind,
           participant.record_id,
           participant.opaque_id,
           participant.display_name,
           participant.role_label,
           participant.conversation_side,
           participant.resolution_status,
           participant.resolution_basis,
           participant.resolution_revision,
           participant.candidate_count_lower_bound,
           participant.email,
           participant.evidence_ids,
           participant.evidence_id_total,
           participant.normalized_name
    from attested_phase_c_participant participant
  ), participant_candidate_deduplicated as materialized (
    select participant.*,
           row_number() over (
             partition by case participant.source_kind
               when 'primary_client' then 'client'
               when 'sub_client' then 'sub_client'
               when 'ops_delivery_user' then 'ops_user'
               when 'task_assignment_user' then 'ops_user'
               when 'phase_c' then 'phase_c'
               when 'conversation_redacted' then 'redacted'
               else 'unknown'
             end, coalesce(
               participant.record_id::text,
               participant.opaque_id
             )
             order by participant.kind_rank,
               case participant.resolution_status
                 when 'redacted' then 1
                 when 'ambiguous' then 2
                 when 'unresolved' then 3
                 else 4
               end,
               participant.normalized_name
           ) as source_rank
    from participant_candidate participant
  ), participant_sentinel as materialized (
    select participant.kind_rank,
           participant.source_kind,
           participant.record_id,
           participant.opaque_id,
           participant.display_name,
           participant.role_label,
           participant.conversation_side,
           participant.resolution_status,
           participant.resolution_basis,
           participant.resolution_revision,
           participant.candidate_count_lower_bound,
           participant.email,
           participant.evidence_ids,
           participant.evidence_id_total,
           participant.normalized_name
    from participant_candidate_deduplicated participant
    where participant.source_rank = 1
    order by participant.kind_rank,
      participant.normalized_name,
      coalesce(participant.record_id::text, participant.opaque_id)
    limit 51
  ), participant_ranked as materialized (
    select participant.*,
           row_number() over (
             order by participant.kind_rank,
               participant.normalized_name,
               coalesce(participant.record_id::text, participant.opaque_id)
           ) as participant_rank,
           count(*) over ()::integer as participant_total
    from participant_sentinel participant
  ), bounded_participant as materialized (
    select participant.*
    from participant_ranked participant
    where participant.participant_rank <= 50
  ), visible_contact_address as materialized (
    select participant.participant_rank,
           lower(btrim(participant.email)) as email,
           'sha256:' || encode(
             extensions.digest(
               convert_to(lower(btrim(participant.email)), 'UTF8'),
               'sha256'
             ),
             'hex'
           ) as address_sha256,
           count(*) over (
             partition by lower(btrim(participant.email))
           )::integer as visible_owner_count
    from bounded_participant participant
    where participant.source_kind in ('primary_client', 'sub_client')
      and participant.resolution_status = 'confirmed'
      and participant.email is not null
      and octet_length(lower(btrim(participant.email))) between 3 and 320
      and lower(btrim(participant.email)) ~
        '^[a-z0-9][a-z0-9._+%-]{0,63}@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  ), contactability_state as materialized (
    select participant.participant_rank,
           case
             when participant.resolution_status = 'ambiguous'
               then 'ambiguous'
             when (select source_query_bound from sub_client_source_state)
               then 'query_bound'
             when participant.source_kind not in (
               'primary_client', 'sub_client'
             ) then 'not_evaluated'
             when address.visible_owner_count > 1
               then 'ambiguous'
             when participant.resolution_status <> 'confirmed'
               then 'not_evaluated'
             when participant.email is null
               or btrim(participant.email) = '' then 'absent'
             when participant.email is distinct from btrim(participant.email)
               or octet_length(participant.email) not between 3 and 320
               or lower(participant.email) !~
                 '^[a-z0-9][a-z0-9._+%-]{0,63}@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
               then 'data_invalid'
             when address.participant_rank is null then 'not_evaluated'
             when suppression.active then 'blocked'
             else 'available'
           end as state,
           case
             when participant.resolution_status = 'ambiguous'
               then 'IDENTITY_AMBIGUOUS'
             when (select source_query_bound from sub_client_source_state)
               then 'SOURCE_QUERY_BOUND'
             when participant.source_kind not in (
               'primary_client', 'sub_client'
             ) then 'SOURCE_UNAVAILABLE'
             when address.visible_owner_count > 1
               then 'IDENTITY_AMBIGUOUS'
             when participant.resolution_status <> 'confirmed'
               then 'SOURCE_UNAVAILABLE'
             when participant.email is null
               or btrim(participant.email) = '' then 'NO_ADDRESS_ON_RECORD'
             when address.participant_rank is null then 'SOURCE_DATA_INVALID'
             when suppression.active then 'ADDRESS_SUPPRESSED'
             else 'AVAILABLE'
           end as code,
          case when coalesce(suppression.active, false)
               or coalesce(address.visible_owner_count > 1, false)
               or participant.resolution_status <> 'confirmed'
             then null else address.email end as normalized_address,
           coalesce(suppression.active, false) as global_suppression_active,
           address.address_sha256,
           coalesce(revision.source_revision, 0) as source_revision
    from bounded_participant participant
    left join visible_contact_address address
      on address.participant_rank = participant.participant_rank
    left join lateral (
      select true as active
      from public.email_suppressions suppression
      where lower(suppression.email) = address.email
        and suppression.list = 'global'
        and (
          suppression.expires_at is null
          or suppression.expires_at > statement_timestamp()
        )
      limit 1
    ) suppression on address.participant_rank is not null
      and address.visible_owner_count = 1
    left join private.agent_contactability_address_revisions revision
      on revision.address_sha256 = address.address_sha256
  ), contactability_digest_state as materialized (
    select 'sha256:' || encode(
             extensions.digest(
               convert_to(
                 private.canonical_agent_projection_json(
                   coalesce(jsonb_agg(jsonb_build_object(
                     'address_sha256', contactability.address_sha256,
                     'global_suppression_active',
                       contactability.global_suppression_active,
                     'source_revision', contactability.source_revision
                   ) order by contactability.address_sha256) filter (
                     where contactability.address_sha256 is not null
                   ), '[]'::jsonb)
                 ),
                 'UTF8'
               ),
               'sha256'
             ),
             'hex'
           ) as contactability_digest,
           coalesce(max(contactability.source_revision), 0)::bigint
             as contactability_revision
    from contactability_state contactability
  ), raw_participant as materialized (
    select participant.kind_rank,
           participant.normalized_name,
           coalesce(
             participant.record_id::text,
             participant.opaque_id
           ) as id,
           participant.participant_rank,
           participant.participant_total,
           jsonb_build_object(
             'source_kind', participant.source_kind,
             'participant_ref', jsonb_build_object(
               'kind', case participant.source_kind
                 when 'primary_client' then 'client'
                 when 'sub_client' then 'sub_client'
                 when 'ops_delivery_user' then 'ops_user'
                 when 'task_assignment_user' then 'ops_user'
                 when 'phase_c' then 'phase_c'
                 when 'conversation_redacted' then 'redacted'
                 else 'unknown'
               end,
               'id', coalesce(
                 participant.record_id::text,
                 participant.opaque_id
               )
             ),
             'display_name', participant.display_name,
             'role_label', participant.role_label,
             'conversation_side', participant.conversation_side,
             'resolution_status', participant.resolution_status,
             'resolution_basis', participant.resolution_basis,
             'resolution_revision', participant.resolution_revision,
             'candidate_count', case
               when participant.resolution_status = 'ambiguous' then null
               else participant.candidate_count_lower_bound
             end,
             'candidate_count_lower_bound', case
               when participant.resolution_status = 'ambiguous'
                 then participant.candidate_count_lower_bound
               else null
             end,
             'email_source', case
               when participant.source_kind in (
                 'ops_delivery_user', 'task_assignment_user', 'phase_c'
               )
                 then null
               when contactability.state = 'available' then
                 jsonb_build_object(
                   'state', 'available',
                   'normalized_address',
                     contactability.normalized_address
                 )
               when contactability.state = 'blocked' then
                 jsonb_build_object(
                   'state', 'blocked',
                   'code', 'ADDRESS_SUPPRESSED'
                 )
               when contactability.state = 'ambiguous' then
                 jsonb_build_object(
                   'state', 'ambiguous',
                   'code', 'IDENTITY_AMBIGUOUS'
                 )
               when contactability.state = 'data_invalid' then
                 jsonb_build_object(
                   'state', 'data_invalid',
                   'code', 'SOURCE_DATA_INVALID'
                 )
               when contactability.state = 'absent' then
                 jsonb_build_object(
                   'state', 'absent',
                   'code', 'NO_ADDRESS_ON_RECORD'
                 )
               else jsonb_build_object(
                 'state', case when contactability.code = 'SOURCE_QUERY_BOUND'
                   then 'query_bound' else 'not_evaluated' end,
                 'code', contactability.code
               )
             end,
             'evidence_ids', to_jsonb(
               coalesce((participant.evidence_ids)[1:1], array[]::text[])
             ),
             'evidence_id_total', participant.evidence_id_total
           ) - case
               when participant.source_kind in (
                 'ops_delivery_user', 'task_assignment_user', 'phase_c'
               ) then array['email_source', 'candidate_count_lower_bound']
               when participant.resolution_status = 'ambiguous'
                 then array['candidate_count']
               else array['candidate_count_lower_bound']
             end as row
    from bounded_participant participant
    join contactability_state contactability
      on contactability.participant_rank = participant.participant_rank
  ), gap_state as materialized (
    select array_remove(array[
             case when coalesce((
                    select max(participant.participant_total) > 50
                    from participant_ranked participant
                  ), false)
               or (select source_query_bound from sub_client_source_state)
               or (select source_query_bound from turn_source_state)
               or p_projection_kind = 'participants'
                  and p_purpose in ('schedule', 'assignment')
                  and (
                    (select source_query_bound from task_source_state)
                    or (select source_query_bound from crew_source_state)
                    or (select source_query_bound
                        from participant_assignment_state)
                  )
               then 'PARTICIPANT_QUERY_BOUND' end,
             case when (select source_query_bound from turn_source_state)
               then 'PARTICIPANT_EVIDENCE_QUERY_BOUND' end,
             case when (select source_data_invalid from sub_client_source_state)
               or coalesce((
                 select client.source_data_invalid
                 from authorized_customer client
               ), false)
               then 'CONTACTABILITY_SOURCE_DATA_INVALID' end,
             case when (select source_data_invalid from turn_source_state)
               or (select fence.job_source_data_invalid
                   from authorized_current_fence fence)
               or coalesce((select project.source_data_invalid
                            from authorized_project project), false)
               then 'REDACTED_SOURCE_DATA' end,
             case when exists (
               select 1
               from participant_evidence evidence
               where not evidence.participant_redacted
                 and evidence.participant_resolution_status = 'resolved'
                 and not exists (
                   select 1
                   from concrete_participant_candidate concrete
                   where evidence.participant_id in (
                     'client:' || concrete.record_id::text,
                     'sub_client:' || concrete.record_id::text
                   )
                 )
             ) then 'RELATED_CONTACT_UNCONFIRMED' end,
             case when (select source_query_bound from task_source_state)
               or (select source_query_bound from crew_source_state)
               or (select source_data_invalid from resolved_source_state)
               or (select source_data_invalid from task_source_state)
               or (select source_data_invalid from crew_source_state)
               or (select source_data_invalid
                   from participant_assignment_state)
               then 'SCHEDULE_SOURCE_UNAVAILABLE' end,
             case when (select source_query_bound from structured_photo_state)
               or coalesce((select source_query_bound
                 from late_legacy_photo), false)
               or (select source_data_invalid from structured_photo_state)
               or coalesce((select source_data_invalid
                 from late_legacy_photo), false)
               then 'PHOTO_SOURCE_UNAVAILABLE' end
           ]::text[], null) as gaps
  ), raw_payload as materialized (
    select fence.*,
           contactability.contactability_digest,
           contactability.contactability_revision,
           case when p_projection_kind = 'participants' then null::jsonb
           else jsonb_build_object(
             'purpose', p_purpose,
             'job_address', coalesce(
               (select project.address from authorized_project project),
               fence.job_address
             ),
             'safe_job_description', coalesce(
               (select project.description from authorized_project project),
               fence.job_description
             ),
             'participant_total', coalesce((
               select max(participant.participant_total)
               from raw_participant participant
             ), 0),
             'participants_omitted_count', greatest(coalesce((
               select max(participant.participant_total)
               from raw_participant participant
             ), 0) - (select count(*) from raw_participant), 0),
             'participant_count_completeness', case
               when 'PARTICIPANT_QUERY_BOUND' = any(gaps.gaps)
                 then 'lower_bound'
               else 'exact'
             end,
             'gaps', to_jsonb(gaps.gaps),
             'schedule', case when p_purpose = 'general' then null
               when (select source_query_bound from task_source_state)
                 or (select source_query_bound from crew_source_state)
                 then jsonb_build_object(
                   'status', 'not_evaluated',
                   'gap_code', 'SOURCE_QUERY_BOUND',
                   'source_kind', 'task_schedule'
                 )
               when (select source_data_invalid from task_source_state)
                 or (select source_data_invalid from crew_source_state)
                 or (select source_data_invalid from resolved_source_state)
                 then jsonb_build_object(
                   'status', 'not_evaluated',
                   'gap_code', 'SOURCE_DATA_INVALID',
                   'source_kind', 'task_schedule'
                 )
               else jsonb_build_object(
                 'status', 'evaluated',
                 'occurrences', coalesce((
                   select jsonb_agg(
                     occurrence.occurrence
                     order by occurrence.scheduled_start_utc,
                       occurrence.id
                   ) from occurrence_projection occurrence
                 ), '[]'::jsonb),
                 'occurrence_total', (
                   select count(*)::integer from occurrence_ranked
                 ),
                 'occurrences_omitted_count', greatest(
                   (select count(*)::integer from occurrence_ranked) -
                   (select count(*)::integer from occurrence_projection),
                   0
                 )
               ) end,
             'site_photos', case when p_purpose <> 'photo_request' then null
               else case
                   when (select source_query_bound from structured_photo_state)
                     or coalesce((
                       select source_query_bound from late_legacy_photo
                     ), false) then jsonb_build_object(
                       'status', 'not_evaluated',
                       'gap_code', 'SOURCE_QUERY_BOUND',
                       'source_kind', 'project_photos'
                     )
                   when (select source_data_invalid from structured_photo_state)
                     or coalesce((
                       select source_data_invalid from late_legacy_photo
                     ), false) then jsonb_build_object(
                       'status', 'not_evaluated',
                       'gap_code', 'SOURCE_DATA_INVALID',
                       'source_kind', 'project_photos'
                     )
                   else jsonb_build_object(
                     'available', true,
                     'active_remote_by_source', jsonb_build_object(
                       'site_visit', coalesce((select site_visit_count
                         from structured_photo_state), 0),
                       'in_progress', coalesce((select in_progress_count
                         from structured_photo_state), 0),
                       'completion', coalesce((select completion_count
                         from structured_photo_state), 0),
                       'other', coalesce((select other_count
                         from structured_photo_state), 0),
                       'measurement', coalesce((select measurement_count
                         from structured_photo_state), 0),
                       'deck_design', coalesce((select deck_design_count
                         from structured_photo_state), 0)
                     ),
                     'structured_row_count', (
                       select structured_row_count
                       from structured_photo_state
                     ),
                     'tombstone_count', coalesce((
                       select tombstone_count from structured_photo_state
                     ), 0),
                     'malformed_or_local_count', coalesce((
                       select malformed_or_local_count
                       from structured_photo_state
                     ), 0),
                     'legacy_remote_count', coalesce((
                       select legacy_remote_count from late_legacy_photo
                     ), 0)
                   )
                 end
             end
           ) - case when p_purpose = 'general'
               then array['schedule', 'site_photos']
               when p_purpose = 'schedule_notice'
                 then array['site_photos']
               else array[]::text[]
             end as context_raw,
           coalesce((
             select max(participant.participant_total)
             from raw_participant participant
           ), 0) as participant_total,
           greatest(coalesce((
             select max(participant.participant_total)
             from raw_participant participant
           ), 0) - (select count(*) from raw_participant), 0)
             as participants_omitted_count,
           case when 'PARTICIPANT_QUERY_BOUND' = any(gaps.gaps)
             then 'lower_bound'
             else 'exact'
           end as participant_count_completeness,
           gaps.gaps
    from authorized_current_fence fence
    cross join contactability_digest_state contactability
    cross join gap_state gaps
  ), participant_projection as materialized (
    select participant.kind_rank,
           participant.normalized_name,
           participant.id,
           participant.row,
           jsonb_build_object(
             'actor_user_id', p_actor_user_id,
             'capability_id', p_capability_id,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'capability_revision', p_capability_revision,
             'company_id', p_company_id,
             'contactability_digest', payload.contactability_digest,
             'contactability_revision', payload.contactability_revision,
             'job_ref', jsonb_build_object(
               'kind', p_job_kind, 'id', p_job_id
             ),
             'source_revision', payload.source_revision,
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'purpose', p_purpose,
             'participant', participant.row,
             'read_at', private.agent_rfc3339_utc(payload.read_at)
           ) as projection
    from raw_participant participant
    cross join raw_payload payload
  ), participant_hashed as materialized (
    select projection.*,
           'sha256:' || encode(
             extensions.digest(
               convert_to(
                 private.canonical_agent_projection_json(
                   projection.projection
                 ),
                 'UTF8'
               ),
               'sha256'
             ),
             'hex'
           ) as source_content_hash
    from participant_projection projection
  ), participant_packaged as materialized (
    select participant.*,
           'job-participant-projection:v1:' ||
             participant.source_content_hash as version,
           'evidence:job_participant_projection:' ||
             p_job_kind || ':' || p_job_id::text || ':' ||
             participant.id as evidence_id
    from participant_hashed participant
  ), envelope_projection as materialized (
    select payload.*,
           jsonb_build_object(
             'actor_user_id', p_actor_user_id,
             'capability_id', p_capability_id,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'capability_revision', p_capability_revision,
             'company_id', p_company_id,
             'contactability_digest', payload.contactability_digest,
             'contactability_revision', payload.contactability_revision,
             'job_ref', jsonb_build_object(
               'kind', p_job_kind, 'id', p_job_id
             ),
             'source_revision', payload.source_revision,
             'participant_proof_sources', coalesce((
               select jsonb_agg(
                 jsonb_build_object(
                   'source_domain', 'operations',
                   'source_type', 'job_participant_projection',
                   'source_id', participant.id,
                   'version', participant.version
                 )
                 order by participant.kind_rank,
                   participant.normalized_name,
                   participant.id
               ) from participant_packaged participant
             ), '[]'::jsonb),
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'purpose', p_purpose,
             'collection', case when p_projection_kind = 'participants'
               then jsonb_build_object(
                 'participant_total', payload.participant_total,
                 'participants_omitted_count',
                   payload.participants_omitted_count,
                 'participant_count_completeness',
                   payload.participant_count_completeness,
                 'gaps', to_jsonb(payload.gaps)
               ) else null end,
             'context', case when p_projection_kind = 'communication'
               then payload.context_raw else null end,
             'read_at', private.agent_rfc3339_utc(payload.read_at)
           ) - case when p_projection_kind = 'participants'
               then array['context'] else array['collection'] end
             as projection
    from raw_payload payload
  ), envelope_hashed as materialized (
    select envelope.*,
           'sha256:' || encode(
             extensions.digest(
               convert_to(
                 private.canonical_agent_projection_json(
                   envelope.projection
                 ),
                 'UTF8'
               ),
               'sha256'
             ),
             'hex'
           ) as envelope_content_hash
    from envelope_projection envelope
  ), final_snapshot as materialized (
    select envelope.*,
           case when p_projection_kind = 'participants'
             then 'job_participants_collection_projection'
             else 'job_communication_context_projection'
           end as envelope_source_type,
           case when p_projection_kind = 'participants'
             then 'job-participants-collection-projection:v1:'
             else 'job-communication-context-projection:v1:'
           end || envelope.envelope_content_hash as envelope_version,
           case when p_projection_kind = 'participants'
             then 'evidence:job_participants_collection_projection:'
             else 'evidence:job_communication_context_projection:'
           end || p_job_kind || ':' || p_job_id::text || ':' || p_purpose
             as envelope_evidence_id
    from envelope_hashed envelope
  )
  select jsonb_build_object(
    'company_id', p_company_id,
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'read_at', private.agent_rfc3339_utc(snapshot.read_at),
    'requested_job', jsonb_build_object(
      'kind', p_job_kind, 'id', p_job_id
    ),
    'purpose', p_purpose,
    'source_fence', jsonb_build_object(
      'source_domain', 'operations',
      'source_type', 'operational_read_revision',
      'source_id', 'private.agent_operational_read_revisions',
      'version', 'revision:' || snapshot.source_revision::text
    ),
    'contactability_fence', jsonb_build_object(
      'source_domain', 'operations',
      'source_type', 'contactability_revision',
      'source_id', snapshot.contactability_digest,
      'version', 'revision:' || snapshot.contactability_revision::text
    ),
    'participant_claims', coalesce((
      select jsonb_agg(jsonb_build_object(
        'raw', participant.row,
        'proof', jsonb_build_object(
          'source_version', jsonb_build_object(
            'source_domain', 'operations',
            'source_type', 'job_participant_projection',
            'source_id', participant.id,
            'version', participant.version
          ),
          'source_content_hash', participant.source_content_hash,
          'evidence_id', participant.evidence_id,
          'projection', participant.projection
        ),
        'source_version', jsonb_build_object(
          'source_domain', 'operations',
          'source_type', 'job_participant_projection',
          'source_id', participant.id,
          'version', participant.version
        ),
        'evidence', jsonb_build_array(jsonb_build_object(
          'evidence_id', participant.evidence_id,
          'source_domain', 'operations',
          'source_type', 'job_participant_projection',
          'source_id', participant.id,
          'version', participant.version,
          'occurred_at', private.agent_rfc3339_utc(snapshot.read_at),
          'relationship', 'supports',
          'trust', 'authoritative_ops',
          'locator', 'ops://jobs/' || p_job_kind || '/' || p_job_id::text
        ))
      ) order by participant.kind_rank,
        participant.normalized_name, participant.id)
      from participant_packaged participant
    ), '[]'::jsonb),
    'participant_total', snapshot.participant_total,
    'participants_omitted_count', snapshot.participants_omitted_count,
    'participant_count_completeness',
      snapshot.participant_count_completeness,
    'gaps', to_jsonb(snapshot.gaps),
    'collection_claim', case when p_projection_kind = 'participants' then
      jsonb_build_object(
        'raw', snapshot.projection -> 'collection',
        'proof', jsonb_build_object(
          'source_version', jsonb_build_object(
            'source_domain', 'operations',
            'source_type', snapshot.envelope_source_type,
            'source_id', p_job_kind || ':' || p_job_id::text,
            'version', snapshot.envelope_version
          ),
          'source_content_hash', snapshot.envelope_content_hash,
          'evidence_id', snapshot.envelope_evidence_id,
          'projection', snapshot.projection
        ),
        'source_version', jsonb_build_object(
          'source_domain', 'operations',
          'source_type', snapshot.envelope_source_type,
          'source_id', p_job_kind || ':' || p_job_id::text,
          'version', snapshot.envelope_version
        ),
        'evidence', jsonb_build_array(jsonb_build_object(
          'evidence_id', snapshot.envelope_evidence_id,
          'source_domain', 'operations',
          'source_type', snapshot.envelope_source_type,
          'source_id', p_job_kind || ':' || p_job_id::text,
          'version', snapshot.envelope_version,
          'occurred_at', private.agent_rfc3339_utc(snapshot.read_at),
          'relationship', 'supports',
          'trust', 'authoritative_ops',
          'locator', 'ops://jobs/' || p_job_kind || '/' || p_job_id::text
        ))
      ) else null end,
    'context_claim', case when p_projection_kind = 'communication' then
      jsonb_build_object(
        'raw', snapshot.context_raw,
        'proof', jsonb_build_object(
          'source_version', jsonb_build_object(
            'source_domain', 'operations',
            'source_type', snapshot.envelope_source_type,
            'source_id', p_job_kind || ':' || p_job_id::text,
            'version', snapshot.envelope_version
          ),
          'source_content_hash', snapshot.envelope_content_hash,
          'evidence_id', snapshot.envelope_evidence_id,
          'projection', snapshot.projection
        ),
        'source_version', jsonb_build_object(
          'source_domain', 'operations',
          'source_type', snapshot.envelope_source_type,
          'source_id', p_job_kind || ':' || p_job_id::text,
          'version', snapshot.envelope_version
        ),
        'evidence', jsonb_build_array(jsonb_build_object(
          'evidence_id', snapshot.envelope_evidence_id,
          'source_domain', 'operations',
          'source_type', snapshot.envelope_source_type,
          'source_id', p_job_kind || ':' || p_job_id::text,
          'version', snapshot.envelope_version,
          'occurred_at', private.agent_rfc3339_utc(snapshot.read_at),
          'relationship', 'supports',
          'trust', 'authoritative_ops',
          'locator', 'ops://jobs/' || p_job_kind || '/' || p_job_id::text
        ))
      ) else null end
  ) - case when p_projection_kind = 'participants'
      then array['context_claim'] else array['collection_claim'] end
  into v_result
  from final_snapshot snapshot;

  if v_result is null then
    if p_projection_kind = 'communication' then
      raise exception 'agent_job_communication_context_not_found'
        using errcode = 'P0002';
    end if;
    raise exception 'agent_job_participants_not_found'
      using errcode = 'P0002';
  end if;

  -- The repository consumes this source-bounded internal wire and the domain
  -- service then atomically retains the maximal ordered claim prefix that fits
  -- the 60 KiB public contract. The sources above are already capped at 50
  -- participant claims, 50 occurrences, 100 schedule assignments in total,
  -- and bounded text/evidence fields. One MiB is therefore an internal bug
  -- fence, not a source-query pagination mechanism, and leaves room for the
  -- exact proof duplication that the repository must validate before pruning.
  if octet_length(v_result::text) > 1048576 then
    raise exception 'agent_job_participant_snapshot_source_query_bound'
      using errcode = '54000';
  end if;
  return v_result;
end;
$function$;

revoke all on function private.read_agent_job_participant_snapshot(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, text, text, uuid, text, text
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_job_communication_context_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_job_permission text,
  p_job_scope text,
  p_projects_scope text,
  p_calendar_scope text,
  p_tasks_scope text,
  p_photos_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_purpose text
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  v_expected_oauth_scopes text[];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_id is distinct from 'get_job_communication_context'
     or p_capability_revision is distinct from
       'get_job_communication_context:2026-08-13.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-13.capability-manifest.v5' then
    raise exception 'invalid_agent_job_communication_context_request'
      using errcode = '22023';
  end if;
  if p_required_oauth_scopes is null
     or cardinality(p_required_oauth_scopes) not between 1 and 16
     or exists (
       select 1
       from unnest(p_required_oauth_scopes) requested(scope)
       where requested.scope is null
          or requested.scope is distinct from btrim(requested.scope)
          or octet_length(requested.scope) not between 1 and 128
     )
     or (select count(distinct requested.scope)
         from unnest(p_required_oauth_scopes) requested(scope)) <>
        cardinality(p_required_oauth_scopes) then
    raise exception 'invalid_agent_job_communication_context_request'
      using errcode = '22023';
  end if;

  select array_agg(requested.scope order by requested.scope)
  into v_expected_oauth_scopes
  from (
    select 'ops.correspondence.read'::text as scope
    union all select 'ops.customer_contacts.read'::text
    union all select 'ops.customers.read'::text
    union all select 'ops.jobs.read'::text
    union all select 'ops.schedule.read'::text
      where p_purpose in ('schedule_notice', 'photo_request')
    union all select 'ops.photos.read'::text
      where p_purpose = 'photo_request'
  ) requested;
  if p_required_oauth_scopes is distinct from v_expected_oauth_scopes then
    raise exception 'invalid_agent_job_communication_context_request'
      using errcode = '22023';
  end if;

  return private.read_agent_job_participant_snapshot(
    p_request_id => p_request_id,
    p_actor_user_id => p_actor_user_id,
    p_company_id => p_company_id,
    p_permission_snapshot_revision => p_permission_snapshot_revision,
    p_registered_permission_keys => p_registered_permission_keys,
    p_capability_id => p_capability_id,
    p_capability_revision => p_capability_revision,
    p_capability_manifest_revision => p_capability_manifest_revision,
    p_required_oauth_scopes => p_required_oauth_scopes,
    p_inbox_scope => p_inbox_scope,
    p_clients_scope => p_clients_scope,
    p_job_permission => p_job_permission,
    p_job_scope => p_job_scope,
    p_projects_scope => p_projects_scope,
    p_calendar_scope => p_calendar_scope,
    p_tasks_scope => p_tasks_scope,
    p_photos_scope => p_photos_scope,
    p_job_kind => p_job_kind,
    p_job_id => p_job_id,
    p_purpose => p_purpose,
    p_projection_kind => 'communication'
  );
end;
$function$;

revoke all on function public.read_agent_job_communication_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, text, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_communication_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, text, text, uuid, text
) to service_role;

create or replace function public.read_agent_job_participants_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_job_permission text,
  p_job_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_purpose text
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_id is distinct from 'resolve_job_participants'
     or p_capability_revision is distinct from
       'resolve_job_participants:2026-08-13.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-13.capability-manifest.v5' then
    raise exception 'invalid_agent_job_participants_request'
      using errcode = '22023';
  end if;
  if p_required_oauth_scopes is null
     or cardinality(p_required_oauth_scopes) not between 1 and 16
     or exists (
       select 1
       from unnest(p_required_oauth_scopes) requested(scope)
       where requested.scope is null
          or requested.scope is distinct from btrim(requested.scope)
          or octet_length(requested.scope) not between 1 and 128
     )
     or (select count(distinct requested.scope)
         from unnest(p_required_oauth_scopes) requested(scope)) <>
        cardinality(p_required_oauth_scopes) then
    raise exception 'invalid_agent_job_participants_request'
      using errcode = '22023';
  end if;
  if p_required_oauth_scopes is distinct from array[
       'ops.correspondence.read',
       'ops.customer_contacts.read',
       'ops.customers.read',
       'ops.jobs.read'
     ]::text[] then
    raise exception 'invalid_agent_job_participants_request'
      using errcode = '22023';
  end if;

  return private.read_agent_job_participant_snapshot(
    p_request_id => p_request_id,
    p_actor_user_id => p_actor_user_id,
    p_company_id => p_company_id,
    p_permission_snapshot_revision => p_permission_snapshot_revision,
    p_registered_permission_keys => p_registered_permission_keys,
    p_capability_id => p_capability_id,
    p_capability_revision => p_capability_revision,
    p_capability_manifest_revision => p_capability_manifest_revision,
    p_required_oauth_scopes => p_required_oauth_scopes,
    p_inbox_scope => p_inbox_scope,
    p_clients_scope => p_clients_scope,
    p_job_permission => p_job_permission,
    p_job_scope => p_job_scope,
    p_projects_scope => p_projects_scope,
    p_calendar_scope => null,
    p_tasks_scope => p_tasks_scope,
    p_photos_scope => null,
    p_job_kind => p_job_kind,
    p_job_id => p_job_id,
    p_purpose => p_purpose,
    p_projection_kind => 'participants'
  );
end;
$function$;

revoke all on function public.read_agent_job_participants_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_participants_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, text, text, uuid, text
) to service_role;

-- Manifest v5 compatibility. Preserve the complete v4 authority and source
-- implementation privately; each public wrapper accepts only v5 and supplies
-- the fixed v4 literal itself. No caller can select an arbitrary legacy
-- manifest revision or execute the implementation directly.
alter function public.read_agent_job_conversation_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid
) rename to read_agent_job_conversation_context_v4_impl;
alter function public.read_agent_job_conversation_context_v4_impl(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid
) set schema private;
revoke all on function private.read_agent_job_conversation_context_v4_impl(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_job_conversation_context_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_inbox_scope text,
  p_clients_scope text,
  p_job_permission text,
  p_job_scope text,
  p_job_kind text,
  p_job_id uuid,
  p_exact_turn_limit integer default 20,
  p_sections text[] default array[
    'memory',
    'recent_turns',
    'participants',
    'gaps',
    'cross_job_seed'
  ]::text[],
  p_required_through_turn_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is distinct from
       '2026-08-13.capability-manifest.v5' then
    raise exception 'invalid_agent_job_conversation_context_request'
      using errcode = '22023';
  end if;
  return private.read_agent_job_conversation_context_v4_impl(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_id,
    p_capability_revision,
    '2026-08-12.capability-manifest.v4',
    p_required_oauth_scopes,
    p_inbox_scope,
    p_clients_scope,
    p_job_permission,
    p_job_scope,
    p_job_kind,
    p_job_id,
    p_exact_turn_limit,
    p_sections,
    p_required_through_turn_id
  );
end;
$function$;

revoke all on function public.read_agent_job_conversation_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_conversation_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, uuid, integer, text[], uuid
) to service_role;

alter function public.read_agent_correspondence_evidence_as_system(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[]
) rename to read_agent_correspondence_evidence_v4_impl;
alter function public.read_agent_correspondence_evidence_v4_impl(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[]
) set schema private;
revoke all on function private.read_agent_correspondence_evidence_v4_impl(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[]
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_correspondence_evidence_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scope text,
  p_inbox_scope text,
  p_evidence_ids text[]
) returns table (
  evidence_id text,
  company_id uuid,
  source_id text,
  occurred_at text,
  subject text,
  side text,
  participant_id text,
  participant_resolution_status text,
  direction text,
  source_activity_id uuid,
  source_correspondence_event_id uuid,
  recipient_identities text[],
  cc_recipient_identities text[],
  redaction_kinds text[],
  normalized_plain_text text,
  original_content_hash text,
  attachments jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is distinct from
       '2026-08-13.capability-manifest.v5' then
    raise exception 'invalid_agent_correspondence_evidence_request'
      using errcode = '22023';
  end if;
  return query
  select legacy.evidence_id,
         legacy.company_id,
         legacy.source_id,
         legacy.occurred_at,
         legacy.subject,
         legacy.side,
         legacy.participant_id,
         legacy.participant_resolution_status,
         legacy.direction,
         legacy.source_activity_id,
         legacy.source_correspondence_event_id,
         legacy.recipient_identities,
         legacy.cc_recipient_identities,
         legacy.redaction_kinds,
         legacy.normalized_plain_text,
         legacy.original_content_hash,
         legacy.attachments
  from private.read_agent_correspondence_evidence_v4_impl(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_id,
    p_capability_revision,
    '2026-08-12.capability-manifest.v4',
    p_required_oauth_scope,
    p_inbox_scope,
    p_evidence_ids
  ) legacy;
end;
$function$;

revoke all on function public.read_agent_correspondence_evidence_as_system(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[]
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_correspondence_evidence_as_system(
  text, uuid, uuid, text, text[], text, text, text, text, text, text[]
) to service_role;

alter function public.read_agent_scheduled_jobs_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, timestamptz, timestamptz, text[], text[], text, timestamptz,
  bigint, timestamptz, uuid, integer
) rename to read_agent_scheduled_jobs_v4_impl;
alter function public.read_agent_scheduled_jobs_v4_impl(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, timestamptz, timestamptz, text[], text[], text, timestamptz,
  bigint, timestamptz, uuid, integer
) set schema private;
revoke all on function private.read_agent_scheduled_jobs_v4_impl(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, timestamptz, timestamptz, text[], text[], text, timestamptz,
  bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_scheduled_jobs_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_task_statuses text[],
  p_confirmation_states text[] default null,
  p_display_timezone text default null,
  p_read_as_of timestamptz default null,
  p_cursor_source_revision bigint default null,
  p_cursor_start_utc timestamptz default null,
  p_cursor_task_id uuid default null,
  p_limit integer default 25
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is distinct from
       '2026-08-13.capability-manifest.v5' then
    raise exception 'invalid_agent_scheduled_jobs_request'
      using errcode = '22023';
  end if;
  return private.read_agent_scheduled_jobs_v4_impl(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_id,
    p_capability_revision,
    '2026-08-12.capability-manifest.v4',
    p_required_oauth_scopes,
    p_calendar_scope,
    p_projects_scope,
    p_tasks_scope,
    p_from,
    p_to,
    p_task_statuses,
    p_confirmation_states,
    p_display_timezone,
    p_read_as_of,
    p_cursor_source_revision,
    p_cursor_start_utc,
    p_cursor_task_id,
    p_limit
  );
end;
$function$;

revoke all on function public.read_agent_scheduled_jobs_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, timestamptz, timestamptz, text[], text[], text, timestamptz,
  bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_scheduled_jobs_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, timestamptz, timestamptz, text[], text[], text, timestamptz,
  bigint, timestamptz, uuid, integer
) to service_role;

alter function public.read_agent_job_readiness_issues_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, timestamptz, timestamptz, text[], timestamptz,
  bigint, timestamptz, uuid, integer
) rename to read_agent_job_readiness_issues_v4_impl;
alter function public.read_agent_job_readiness_issues_v4_impl(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, timestamptz, timestamptz, text[], timestamptz,
  bigint, timestamptz, uuid, integer
) set schema private;
revoke all on function private.read_agent_job_readiness_issues_v4_impl(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, timestamptz, timestamptz, text[], timestamptz,
  bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_job_readiness_issues_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_id text,
  p_capability_revision text,
  p_capability_manifest_revision text,
  p_required_oauth_scopes text[],
  p_calendar_scope text,
  p_clients_scope text,
  p_photos_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_from timestamptz,
  p_to timestamptz,
  p_rule_codes text[],
  p_read_as_of timestamptz default null,
  p_cursor_source_revision bigint default null,
  p_cursor_first_scheduled_start_utc timestamptz default null,
  p_cursor_project_id uuid default null,
  p_scan_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is distinct from
       '2026-08-13.capability-manifest.v5' then
    raise exception 'invalid_agent_job_readiness_request'
      using errcode = '22023';
  end if;
  return private.read_agent_job_readiness_issues_v4_impl(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_id,
    p_capability_revision,
    '2026-08-12.capability-manifest.v4',
    p_required_oauth_scopes,
    p_calendar_scope,
    p_clients_scope,
    p_photos_scope,
    p_projects_scope,
    p_tasks_scope,
    p_from,
    p_to,
    p_rule_codes,
    p_read_as_of,
    p_cursor_source_revision,
    p_cursor_first_scheduled_start_utc,
    p_cursor_project_id,
    p_scan_limit
  );
end;
$function$;

revoke all on function public.read_agent_job_readiness_issues_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, timestamptz, timestamptz, text[], timestamptz,
  bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_job_readiness_issues_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, text, timestamptz, timestamptz, text[], timestamptz,
  bigint, timestamptz, uuid, integer
) to service_role;

commit;
