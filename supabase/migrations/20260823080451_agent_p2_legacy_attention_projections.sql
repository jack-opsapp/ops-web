begin;

-- These adapters are deliberately private and owner-executable only. A fixed
-- service-role outer RPC authorizes OAuth/capability policy, freezes read_at,
-- and calls one or more adapters inside its single statement. Application
-- roles cannot invoke an adapter directly or turn it into an authority oracle.
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
      ('function', 'private.user_can_view_inbox_connection(uuid,uuid,uuid,uuid)'),
      ('function', 'private.agent_rfc3339_utc(timestamp with time zone)'),
      ('function', 'private.agent_trim_discovery_display_text(text)'),
      ('function', 'private.agent_discovery_unicode15_text_is_supported(text)'),
      ('function', 'private.agent_prompt_text_is_safe(text,boolean)'),
      ('table', 'private.agent_operational_read_revisions'),
      ('table', 'private.agent_job_history_revisions'),
      ('table', 'public.opportunities'),
      ('table', 'public.email_threads'),
      ('table', 'public.project_tasks'),
      ('table', 'public.projects'),
      ('table', 'public.task_types')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_p2_legacy_attention_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;
end;
$prerequisites$;

-- Each adapter freezes at most 501 canonical source matches before invoking
-- any row-level authority helper. These exact partial order indexes make the
-- LIMIT a physical bound rather than a post-filter promise.
drop index if exists public.opportunities_agent_p2_legacy_attention_idx;
create index opportunities_agent_p2_legacy_attention_idx
  on public.opportunities (
    company_id,
    (least(
      coalesce(operator_action_required_at, 'infinity'::timestamptz),
      coalesce(next_follow_up_at, 'infinity'::timestamptz)
    )),
    id
  )
  where deleted_at is null
    and archived_at is null
    and merged_into_opportunity_id is null
    and stage not in ('won', 'lost', 'discarded');

drop index if exists public.email_threads_agent_p2_legacy_attention_idx;
create index email_threads_agent_p2_legacy_attention_idx
  on public.email_threads (
    company_id,
    (coalesce(next_commitment_due_at, last_message_at)),
    id
  )
  where opportunity_id is not null
    and archived_at is null
    and unread_count between 0 and 9007199254740991
    and (
      coalesce(has_unresolved_commitments, false)
      or next_commitment_due_at is not null
    );

drop index if exists public.project_tasks_agent_p2_legacy_attention_idx;
create index project_tasks_agent_p2_legacy_attention_idx
  on public.project_tasks (company_id, start_date, id)
  where deleted_at is null
    and status = 'active'
    and start_date is not null;

-- Wire-parallel with createP2CanonicalTextSchema. Optional legacy display
-- text is projected as canonical NFC or NULL; it can never invalidate an
-- otherwise authorized envelope after the database read has completed.
create or replace function private.agent_p2_optional_canonical_text(
  p_value text,
  p_maximum_scalars integer,
  p_maximum_utf8_bytes integer,
  p_allow_text_whitespace boolean
) returns text
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $function$
declare
  v_value text;
begin
  if p_maximum_scalars < 1 or p_maximum_utf8_bytes < 1 then
    return null;
  end if;

  v_value := normalize(
    private.agent_trim_discovery_display_text(p_value),
    NFC
  );
  if v_value = ''
     or pg_catalog.char_length(v_value) > p_maximum_scalars
     or pg_catalog.octet_length(v_value) > p_maximum_utf8_bytes
     or not private.agent_discovery_unicode15_text_is_supported(v_value)
     or not private.agent_prompt_text_is_safe(
       v_value,
       p_allow_text_whitespace
     ) then
    return null;
  end if;
  return v_value;
end;
$function$;

revoke all on function private.agent_p2_optional_canonical_text(text,integer,integer,boolean)
  from public, anon, authenticated, service_role;

create or replace function private.agent_p2_legacy_lead_attention_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_pipeline_scope text,
  p_read_at timestamptz,
  p_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_source_revision bigint;
  v_source_match_ids uuid[] := array[]::uuid[];
  v_source_match_count integer := 0;
  source_inspected_count integer := 0;
  v_cards jsonb := '[]'::jsonb;
  v_has_more boolean := false;
begin
  if auth.role() is distinct from 'service_role'
     or p_actor_user_id is null
     or p_company_id is null
     or p_permission_snapshot_revision is null
     or p_registered_permission_keys is null
     or p_pipeline_scope not in ('all', 'assigned')
     or p_read_at is null
     or not pg_catalog.isfinite(p_read_at)
     or p_read_at is distinct from pg_catalog.date_trunc(
       'milliseconds', p_read_at
     )
     or extract(year from p_read_at at time zone 'UTC')
          not between 1 and 9999
     or p_read_at > pg_catalog.statement_timestamp()
     or p_read_at <= pg_catalog.statement_timestamp() - interval '15 minutes'
     or p_limit is null
     or p_limit not between 1 and 25 then
    raise exception 'invalid_agent_p2_legacy_lead_attention_request'
      using errcode = '22023';
  end if;

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'pipeline.view'
           ) as pipeline_scope
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral pg_catalog.jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    group by authority.permission_snapshot_revision
  )
  select revision.source_revision
  into v_source_revision
  from current_authority authority
  join public.companies company
    on company.id = p_company_id
   and company.deleted_at is null
  join private.agent_operational_read_revisions revision
    on revision.company_id = p_company_id
   and revision.source_revision between 0 and 9007199254740991
  where authority.permission_snapshot_revision =
          p_permission_snapshot_revision
    and authority.pipeline_scope = p_pipeline_scope;

  if not found then
    raise exception 'agent_p2_legacy_lead_attention_unauthorized'
      using errcode = '42501';
  end if;

  with source_match_inspection as materialized (
    select opportunity.id,
           least(
             coalesce(
               opportunity.operator_action_required_at,
               'infinity'::timestamptz
             ),
             coalesce(
               opportunity.next_follow_up_at,
               'infinity'::timestamptz
             )
           ) as attention_at
    from public.opportunities opportunity
    where opportunity.company_id = p_company_id
      and opportunity.deleted_at is null
      and opportunity.archived_at is null
      and opportunity.merged_into_opportunity_id is null
      and opportunity.stage not in ('won', 'lost', 'discarded')
      and least(
        coalesce(
          opportunity.operator_action_required_at,
          'infinity'::timestamptz
        ),
        coalesce(
          opportunity.next_follow_up_at,
          'infinity'::timestamptz
        )
      ) <= p_read_at
    order by attention_at, opportunity.id
    limit 501
  )
  select coalesce(
    pg_catalog.array_agg(
      source.id order by source.attention_at, source.id
    ),
    array[]::uuid[]
  )
  into v_source_match_ids
  from source_match_inspection source;

  v_source_match_count := pg_catalog.cardinality(v_source_match_ids);
  if v_source_match_count >= 501 then
    raise exception 'agent_p2_legacy_lead_attention_source_bound'
      using errcode = '54000';
  end if;

  with source_inspection as materialized (
    select opportunity.id,
           private.agent_p2_optional_canonical_text(
             opportunity.title,
             256,
             1024,
             false
           ) as title,
           case
             when opportunity.operator_action_required_at is not null
              and opportunity.operator_action_required_at <= p_read_at
              and (
                opportunity.next_follow_up_at is null
                or opportunity.next_follow_up_at > p_read_at
                or opportunity.operator_action_required_at <=
                     opportunity.next_follow_up_at
              ) then 'operator_action_required'
             else 'follow_up_due'
           end as reason_code,
           least(
             coalesce(
               opportunity.operator_action_required_at,
               'infinity'::timestamptz
             ),
             coalesce(
               opportunity.next_follow_up_at,
               'infinity'::timestamptz
             )
           ) as attention_at
    from pg_catalog.unnest(v_source_match_ids) with ordinality
      candidate(id, source_ordinality)
    join public.opportunities opportunity
      on opportunity.id = candidate.id
    where private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'opportunity',
        opportunity.id,
        'view'
      )
    order by attention_at, opportunity.id
    limit 501
  ), bounded_source as materialized (
    select source.*
    from source_inspection source
    order by source.attention_at, source.id
    limit least(p_limit + 1, 26)
  )
  select (select pg_catalog.count(*)::integer from source_inspection),
         coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'card_kind', 'lead',
               'job_ref', pg_catalog.jsonb_build_object(
                 'kind', 'opportunity',
                 'id', source.id
               ),
               'title', source.title,
               'reason_code', source.reason_code,
               'attention_at', private.agent_rfc3339_utc(
                 pg_catalog.date_trunc('milliseconds', source.attention_at)
               )
             ) order by source.attention_at, source.id
           ) filter (where source.ordinality <= p_limit),
           '[]'::jsonb
         ),
         pg_catalog.count(*) > p_limit
  into source_inspected_count, v_cards, v_has_more
  from (
    select bounded.*,
           pg_catalog.row_number() over (
             order by bounded.attention_at, bounded.id
           ) as ordinality
    from bounded_source bounded
  ) source;

  return pg_catalog.jsonb_build_object(
    'projection_revision', 'agent-p2-legacy-lead-attention:v1',
    'read_at', private.agent_rfc3339_utc(p_read_at),
    'source_versions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'source_domain', 'operations',
        'source_type', 'operational_read_revision',
        'source_id', 'private.agent_operational_read_revisions',
        'version', 'revision:' || v_source_revision::text
      )
    ),
    'source_inspected_count', source_inspected_count,
    'returned_count', pg_catalog.jsonb_array_length(v_cards),
    'has_more', v_has_more,
    'cards', v_cards
  );
end;
$function$;

revoke all on function private.agent_p2_legacy_lead_attention_v1(uuid,uuid,text,text[],text,timestamp with time zone,integer)
  from public, anon, authenticated, service_role;

create or replace function private.agent_p2_legacy_correspondence_attention_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_inbox_scope text,
  p_email_scope text,
  p_pipeline_scope text,
  p_read_at timestamptz,
  p_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_source_revision bigint;
  v_history_revision bigint;
  v_source_match_ids uuid[] := array[]::uuid[];
  v_source_match_count integer := 0;
  source_inspected_count integer := 0;
  v_cards jsonb := '[]'::jsonb;
  v_has_more boolean := false;
begin
  if auth.role() is distinct from 'service_role'
     or p_actor_user_id is null
     or p_company_id is null
     or p_permission_snapshot_revision is null
     or p_registered_permission_keys is null
     or p_inbox_scope not in ('all', 'assigned', 'own')
     or p_email_scope not in ('all', 'own')
     or p_pipeline_scope not in ('all', 'assigned')
     or p_read_at is null
     or not pg_catalog.isfinite(p_read_at)
     or p_read_at is distinct from pg_catalog.date_trunc(
       'milliseconds', p_read_at
     )
     or extract(year from p_read_at at time zone 'UTC')
          not between 1 and 9999
     or p_read_at > pg_catalog.statement_timestamp()
     or p_read_at <= pg_catalog.statement_timestamp() - interval '15 minutes'
     or p_limit is null
     or p_limit not between 1 and 25 then
    raise exception 'invalid_agent_p2_legacy_correspondence_attention_request'
      using errcode = '22023';
  end if;

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'inbox.view'
           ) as inbox_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'email.view'
           ) as email_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'pipeline.view'
           ) as pipeline_scope
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral pg_catalog.jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    group by authority.permission_snapshot_revision
  )
  select source_revision.source_revision,
         history_revision.history_revision
  into v_source_revision, v_history_revision
  from current_authority authority
  join public.companies company
    on company.id = p_company_id
   and company.deleted_at is null
  join private.agent_operational_read_revisions source_revision
    on source_revision.company_id = p_company_id
   and source_revision.source_revision between 0 and 9007199254740991
  join private.agent_job_history_revisions history_revision
    on history_revision.company_id = p_company_id
   and history_revision.history_revision between 0 and 9007199254740991
  where authority.permission_snapshot_revision =
          p_permission_snapshot_revision
    and authority.inbox_scope = p_inbox_scope
    and authority.email_scope = p_email_scope
    and authority.pipeline_scope = p_pipeline_scope;

  if not found then
    raise exception 'agent_p2_legacy_correspondence_attention_unauthorized'
      using errcode = '42501';
  end if;

  with source_match_inspection as materialized (
    select thread.id,
           coalesce(
             thread.next_commitment_due_at,
             thread.last_message_at
           ) as attention_at
    from public.email_threads thread
    where thread.company_id = p_company_id
      and thread.opportunity_id is not null
      and thread.archived_at is null
      and (
        coalesce(thread.has_unresolved_commitments, false)
        or thread.next_commitment_due_at is not null
      )
      and thread.unread_count between 0 and 9007199254740991
    order by attention_at, thread.id
    limit 501
  )
  select coalesce(
    pg_catalog.array_agg(
      source.id order by source.attention_at, source.id
    ),
    array[]::uuid[]
  )
  into v_source_match_ids
  from source_match_inspection source;

  v_source_match_count := pg_catalog.cardinality(v_source_match_ids);
  if v_source_match_count >= 501 then
    raise exception 'agent_p2_legacy_correspondence_attention_source_bound'
      using errcode = '54000';
  end if;

  with source_inspection as materialized (
    select thread.id,
           thread.opportunity_id,
           private.agent_p2_optional_canonical_text(
             thread.subject,
             512,
             2048,
             false
           ) as subject,
           private.agent_p2_optional_canonical_text(
             thread.latest_snippet,
             1000,
             4000,
             true
           ) as latest_snippet,
           'unresolved_commitment'::text as reason_code,
           coalesce(
             thread.next_commitment_due_at,
             thread.last_message_at
           ) as attention_at,
           thread.unread_count
    from pg_catalog.unnest(v_source_match_ids) with ordinality
      candidate(id, source_ordinality)
    join public.email_threads thread
      on thread.id = candidate.id
    where (
        thread.snoozed_until is null
        or thread.snoozed_until <= p_read_at
      )
      and (
        coalesce(thread.has_unresolved_commitments, false)
        or thread.next_commitment_due_at <= p_read_at
      )
      and private.user_can_view_inbox_connection(
        p_actor_user_id,
        p_company_id,
        thread.connection_id,
        thread.opportunity_id
      )
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'opportunity',
        thread.opportunity_id,
        'view'
      )
    order by attention_at, thread.id
    limit 501
  ), bounded_source as materialized (
    select source.*
    from source_inspection source
    order by source.attention_at, source.id
    limit least(p_limit + 1, 26)
  )
  select (select pg_catalog.count(*)::integer from source_inspection),
         coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'card_kind', 'correspondence',
               'thread_ref', source.id,
               'job_ref', pg_catalog.jsonb_build_object(
                 'kind', 'opportunity',
                 'id', source.opportunity_id
               ),
               'subject', source.subject,
               'latest_snippet', source.latest_snippet,
               'reason_code', source.reason_code,
               'attention_at', private.agent_rfc3339_utc(
                 pg_catalog.date_trunc('milliseconds', source.attention_at)
               ),
               'unread_count', source.unread_count
             ) order by source.attention_at, source.id
           ) filter (where source.ordinality <= p_limit),
           '[]'::jsonb
         ),
         pg_catalog.count(*) > p_limit
  into source_inspected_count, v_cards, v_has_more
  from (
    select bounded.*,
           pg_catalog.row_number() over (
             order by bounded.attention_at, bounded.id
           ) as ordinality
    from bounded_source bounded
  ) source;

  return pg_catalog.jsonb_build_object(
    'projection_revision',
      'agent-p2-legacy-correspondence-attention:v1',
    'read_at', private.agent_rfc3339_utc(p_read_at),
    'source_versions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'source_domain', 'operations',
        'source_type', 'job_history_read_revision',
        'source_id', 'private.agent_job_history_revisions',
        'version', 'revision:' || v_history_revision::text
      ),
      pg_catalog.jsonb_build_object(
        'source_domain', 'operations',
        'source_type', 'operational_read_revision',
        'source_id', 'private.agent_operational_read_revisions',
        'version', 'revision:' || v_source_revision::text
      )
    ),
    'source_inspected_count', source_inspected_count,
    'returned_count', pg_catalog.jsonb_array_length(v_cards),
    'has_more', v_has_more,
    'cards', v_cards
  );
end;
$function$;

revoke all on function private.agent_p2_legacy_correspondence_attention_v1(uuid,uuid,text,text[],text,text,text,timestamp with time zone,integer)
  from public, anon, authenticated, service_role;

create or replace function private.agent_p2_legacy_schedule_attention_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_calendar_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_read_at timestamptz,
  p_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_source_revision bigint;
  v_source_match_ids uuid[] := array[]::uuid[];
  v_source_match_count integer := 0;
  source_inspected_count integer := 0;
  v_cards jsonb := '[]'::jsonb;
  v_has_more boolean := false;
begin
  if auth.role() is distinct from 'service_role'
     or p_actor_user_id is null
     or p_company_id is null
     or p_permission_snapshot_revision is null
     or p_registered_permission_keys is null
     or p_calendar_scope not in ('all', 'own')
     or p_projects_scope not in ('all', 'assigned')
     or p_tasks_scope not in ('all', 'assigned')
     or p_read_at is null
     or not pg_catalog.isfinite(p_read_at)
     or p_read_at is distinct from pg_catalog.date_trunc(
       'milliseconds', p_read_at
     )
     or extract(year from p_read_at at time zone 'UTC')
          not between 1 and 9999
     or p_read_at > pg_catalog.statement_timestamp()
     or p_read_at <= pg_catalog.statement_timestamp() - interval '15 minutes'
     or p_limit is null
     or p_limit not between 1 and 25 then
    raise exception 'invalid_agent_p2_legacy_schedule_attention_request'
      using errcode = '22023';
  end if;

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'calendar.view'
           ) as calendar_scope,
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
    cross join lateral pg_catalog.jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    group by authority.permission_snapshot_revision
  )
  select revision.source_revision
  into v_source_revision
  from current_authority authority
  join public.companies company
    on company.id = p_company_id
   and company.deleted_at is null
  join private.agent_operational_read_revisions revision
    on revision.company_id = p_company_id
   and revision.source_revision between 0 and 9007199254740991
  where authority.permission_snapshot_revision =
          p_permission_snapshot_revision
    and authority.calendar_scope = p_calendar_scope
    and authority.projects_scope = p_projects_scope
    and authority.tasks_scope = p_tasks_scope;

  if not found then
    raise exception 'agent_p2_legacy_schedule_attention_unauthorized'
      using errcode = '42501';
  end if;

  with source_match_inspection as materialized (
    select task.id,
           task.start_date as attention_at
    from public.project_tasks task
    where task.company_id = p_company_id
      and task.deleted_at is null
      and task.status = 'active'
      and task.start_date is not null
      and task.start_date >= p_read_at
      and task.start_date < p_read_at + interval '7 days'
    order by task.start_date, task.id
    limit 501
  )
  select coalesce(
    pg_catalog.array_agg(
      source.id order by source.attention_at, source.id
    ),
    array[]::uuid[]
  )
  into v_source_match_ids
  from source_match_inspection source;

  v_source_match_count := pg_catalog.cardinality(v_source_match_ids);
  if v_source_match_count >= 501 then
    raise exception 'agent_p2_legacy_schedule_attention_source_bound'
      using errcode = '54000';
  end if;

  with source_inspection as materialized (
    select task.id,
           task.project_id,
           private.agent_p2_optional_canonical_text(
             coalesce(
               nullif(task.custom_title, ''),
               nullif(task_type.display, ''),
               project.title
             ),
             256,
             1024,
             false
           ) as title,
           case when task.schedule_confirmed_at is null
             then 'confirmation_required'
             else 'starts_soon'
           end as reason_code,
           task.start_date as attention_at,
           task.end_date as ends_at,
           case when task.schedule_confirmed_at is null
             then 'unconfirmed'
             else 'confirmed'
           end as confirmation_state
    from pg_catalog.unnest(v_source_match_ids) with ordinality
      candidate(id, source_ordinality)
    join public.project_tasks task
      on task.id = candidate.id
    join public.projects project
      on project.id = task.project_id
     and project.company_id = p_company_id
     and project.deleted_at is null
    left join public.task_types task_type
      on task_type.id = task.task_type_id
     and task_type.company_id = p_company_id
     and task_type.deleted_at is null
    where project.status in ('rfq', 'estimated', 'accepted', 'in_progress')
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'project',
        task.project_id,
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
        p_calendar_scope = 'all'
        or p_actor_user_id::text = any(
          coalesce(task.team_member_ids, array[]::text[])
        )
      )
      and (
        p_tasks_scope = 'all'
        or p_actor_user_id::text = any(
          coalesce(task.team_member_ids, array[]::text[])
        )
      )
      and (
        p_projects_scope = 'all'
        or p_actor_user_id::text = any(
          coalesce(project.team_member_ids, array[]::text[])
        )
      )
    order by task.start_date, task.id
    limit 501
  ), bounded_source as materialized (
    select source.*
    from source_inspection source
    order by source.attention_at, source.id
    limit least(p_limit + 1, 26)
  )
  select (select pg_catalog.count(*)::integer from source_inspection),
         coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'card_kind', 'schedule',
               'task_ref', source.id,
               'job_ref', pg_catalog.jsonb_build_object(
                 'kind', 'project',
                 'id', source.project_id
               ),
               'title', source.title,
               'reason_code', source.reason_code,
               'attention_at', private.agent_rfc3339_utc(
                 pg_catalog.date_trunc('milliseconds', source.attention_at)
               ),
               'ends_at', case when source.ends_at is null then null
                 else private.agent_rfc3339_utc(
                   pg_catalog.date_trunc('milliseconds', source.ends_at)
                 )
               end,
               'confirmation_state', source.confirmation_state
             ) order by source.attention_at, source.id
           ) filter (where source.ordinality <= p_limit),
           '[]'::jsonb
         ),
         pg_catalog.count(*) > p_limit
  into source_inspected_count, v_cards, v_has_more
  from (
    select bounded.*,
           pg_catalog.row_number() over (
             order by bounded.attention_at, bounded.id
           ) as ordinality
    from bounded_source bounded
  ) source;

  return pg_catalog.jsonb_build_object(
    'projection_revision', 'agent-p2-legacy-schedule-attention:v1',
    'read_at', private.agent_rfc3339_utc(p_read_at),
    'source_versions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'source_domain', 'operations',
        'source_type', 'operational_read_revision',
        'source_id', 'private.agent_operational_read_revisions',
        'version', 'revision:' || v_source_revision::text
      )
    ),
    'source_inspected_count', source_inspected_count,
    'returned_count', pg_catalog.jsonb_array_length(v_cards),
    'has_more', v_has_more,
    'cards', v_cards
  );
end;
$function$;

revoke all on function private.agent_p2_legacy_schedule_attention_v1(uuid,uuid,text,text[],text,text,text,timestamp with time zone,integer)
  from public, anon, authenticated, service_role;

commit;
