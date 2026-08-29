begin;

do $prerequisites$
declare
  v_missing text[];
begin
  select pg_catalog.array_agg(required.object_name order by required.object_name)
    into v_missing
  from (
    values
      ('function', 'private.resolve_agent_actor_authority(uuid,uuid,text[])'),
      ('function', 'private.agent_p2_optional_canonical_text(text,integer,integer,boolean)'),
      ('function', 'private.agent_rfc3339_utc(timestamp with time zone)'),
      ('function', 'private.canonical_agent_projection_json(jsonb)'),
      ('function', 'private.mcp_oauth_labels_for_scopes(text[],text)'),
      ('function', 'private.agent_unambiguous_local_instant(timestamp without time zone,text)'),
      ('function', 'private.agent_civil_date_start(date,text)'),
      ('function', 'extensions.digest(bytea,text)'),
      ('table', 'private.agent_read_domain_revisions'),
      ('table', 'private.mcp_oauth_clients'),
      ('table', 'private.mcp_oauth_grants'),
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
    raise exception 'agent_team_availability_read_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;
end;
$prerequisites$;

drop function if exists public.read_agent_team_availability_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],
  text,text,text,date,date,integer,integer,integer,integer,
  timestamp with time zone,jsonb,text,uuid
);
drop function if exists private.agent_p2_availability_summary_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,date,date,
  integer,integer,integer,integer,timestamp with time zone,jsonb,text,uuid
);

create or replace function private.agent_p2_availability_summary_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_required_oauth_scopes text[],
  p_view text,
  p_team_scope text,
  p_calendar_scope text,
  p_starts_on date,
  p_ends_on date,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_member_source_limit integer,
  p_schedule_source_limit integer,
  p_cursor_read_at timestamp with time zone,
  p_cursor_source_revisions jsonb,
  p_after_display_name text,
  p_after_member_id uuid
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_read_at timestamp with time zone;
begin
  if p_cursor_read_at is not null
     and not pg_catalog.isfinite(p_cursor_read_at) then
    raise exception 'invalid_agent_team_availability_request'
      using errcode = '22023';
  end if;

  if auth.role() is distinct from 'service_role'
     or p_actor_user_id is null
     or p_company_id is null
     or p_oauth_grant_id is null
     or p_oauth_client_id is null
     or p_grant_revision is null
     or p_grant_revision !~ '^[0-9a-f]{32}$'
     or p_granted_scope_ceiling is null
     or pg_catalog.cardinality(p_granted_scope_ceiling) not between 1 and 32
     or p_permission_snapshot_revision is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_registered_permission_keys is null
     or p_required_oauth_scopes is distinct from
       array['ops.team.read']::text[]
     or p_required_oauth_scopes <@ p_granted_scope_ceiling is not true
     or p_view not in ('company', 'self')
     or p_view = 'company' and (
       p_team_scope is distinct from 'all'
       or p_calendar_scope is distinct from 'all'
     )
     or p_view = 'self' and (
       p_team_scope is not null
       or p_calendar_scope not in ('own', 'all')
     )
     or p_starts_on is null
     or p_ends_on is null
     or not pg_catalog.isfinite(p_starts_on)
     or not pg_catalog.isfinite(p_ends_on)
     or extract(year from p_starts_on) not between 1 and 9999
     or extract(year from p_ends_on) not between 1 and 9999
     or p_ends_on - p_starts_on not between 0 and 30
     or p_item_limit is null
     or p_item_limit not between 1 and 10
     or p_page_fetch_limit is distinct from p_item_limit + 1
     or p_page_fetch_limit not between 2 and 11
     or p_view = 'self' and p_item_limit is distinct from 1
     or p_view = 'self' and p_page_fetch_limit is distinct from 2
     or p_member_source_limit is distinct from 501
     or p_schedule_source_limit is distinct from 501
     or p_cursor_source_revisions is null
     or pg_catalog.jsonb_typeof(p_cursor_source_revisions) <> 'array'
     or (p_cursor_read_at is null) is distinct from
       (p_cursor_source_revisions = '[]'::jsonb)
     or (p_cursor_read_at is null) is distinct from
       (p_after_display_name is null)
     or (p_cursor_read_at is null) is distinct from
       (p_after_member_id is null)
     or p_view = 'self' and p_cursor_read_at is not null
     or p_cursor_read_at is not null and (
       p_cursor_read_at is distinct from pg_catalog.date_trunc(
         'milliseconds',
         p_cursor_read_at
       )
       or p_cursor_read_at > pg_catalog.statement_timestamp()
       or p_cursor_read_at <=
         pg_catalog.statement_timestamp() - interval '15 minutes'
       or pg_catalog.jsonb_array_length(p_cursor_source_revisions) <> 4
       or p_cursor_source_revisions #>> '{0,domain}' <> 'availability'
       or p_cursor_source_revisions #>> '{1,domain}' <> 'site_visits'
       or p_cursor_source_revisions #>> '{2,domain}' <> 'tasks'
       or p_cursor_source_revisions #>> '{3,domain}' <> 'team'
     )
     or p_after_display_name is not null and (
       private.agent_p2_optional_canonical_text(
         p_after_display_name,
         256,
         1024,
         false
       ) is distinct from p_after_display_name
     ) then
    raise exception 'invalid_agent_team_availability_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(p_granted_scope_ceiling) scope(value)
    where scope.value is null
       or scope.value is distinct from pg_catalog.btrim(scope.value)
       or pg_catalog.octet_length(scope.value) not between 1 and 128
  ) or (
    select pg_catalog.count(distinct scope.value)
    from pg_catalog.unnest(p_granted_scope_ceiling) scope(value)
  ) <> pg_catalog.cardinality(p_granted_scope_ceiling)
  or p_granted_scope_ceiling is distinct from (
    select pg_catalog.array_agg(scope.value order by scope.value)
    from pg_catalog.unnest(p_granted_scope_ceiling) scope(value)
  )
  or exists (
    select 1
    from pg_catalog.unnest(p_registered_permission_keys) key(value)
    where key.value is null
       or key.value is distinct from pg_catalog.btrim(key.value)
       or pg_catalog.octet_length(key.value) not between 1 and 128
  ) or (
    select pg_catalog.count(distinct key.value)
    from pg_catalog.unnest(p_registered_permission_keys) key(value)
  ) <> pg_catalog.cardinality(p_registered_permission_keys)
  or p_registered_permission_keys is distinct from (
    select pg_catalog.array_agg(key.value order by key.value)
    from pg_catalog.unnest(p_registered_permission_keys) key(value)
  )
  or not ('calendar.view' = any(p_registered_permission_keys))
  or p_view = 'company'
     and not ('team.view' = any(p_registered_permission_keys)) then
    raise exception 'invalid_agent_team_availability_request'
      using errcode = '22023';
  end if;

  v_read_at := coalesce(
    p_cursor_read_at,
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp())
  );

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           case when p_view = 'company' then
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'team.view'
             )
           else null::text end as team_scope,
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
    select authority.team_scope,
           authority.calendar_scope,
           company.timezone as company_timezone,
           company.default_work_start,
           company.default_work_end,
           coalesce(company.skip_weekends_in_auto_schedule, true)
             as skip_weekends,
           availability_revision.source_revision as availability_revision,
           site_visit_revision.source_revision as site_visit_revision,
           task_revision.source_revision as task_revision,
           team_revision.source_revision as team_revision,
           v_read_at as read_at,
           (
             company.timezone is null
             or company.timezone is distinct from pg_catalog.btrim(
               company.timezone
             )
             or pg_catalog.octet_length(company.timezone) not between 1 and 64
             or (
               company.timezone <> 'UTC'
               and pg_catalog.strpos(company.timezone, '/') = 0
             )
             or not exists (
               select 1
               from pg_catalog.pg_timezone_names timezone_row
               where timezone_row.name = company.timezone
             )
             or company.default_work_start is null
             or company.default_work_end is null
             or company.default_work_start = time '24:00:00'
             or company.default_work_end = time '24:00:00'
             or company.default_work_start >= company.default_work_end
           ) as company_source_invalid,
           case when (
             company.timezone is not null
             and company.timezone is not distinct from pg_catalog.btrim(
               company.timezone
             )
             and pg_catalog.octet_length(company.timezone) between 1 and 64
             and (
               company.timezone = 'UTC'
               or pg_catalog.strpos(company.timezone, '/') > 0
             )
             and exists (
               select 1
               from pg_catalog.pg_timezone_names timezone_row
               where timezone_row.name = company.timezone
             )
             and company.default_work_start is not null
             and company.default_work_end is not null
             and company.default_work_start <> time '24:00:00'
             and company.default_work_end <> time '24:00:00'
             and company.default_work_start < company.default_work_end
           ) then private.agent_civil_date_start(
             p_starts_on,
             company.timezone
           ) else null end as window_start_utc,
           case when (
             company.timezone is not null
             and company.timezone is not distinct from pg_catalog.btrim(
               company.timezone
             )
             and pg_catalog.octet_length(company.timezone) between 1 and 64
             and (
               company.timezone = 'UTC'
               or pg_catalog.strpos(company.timezone, '/') > 0
             )
             and exists (
               select 1
               from pg_catalog.pg_timezone_names timezone_row
               where timezone_row.name = company.timezone
             )
             and company.default_work_start is not null
             and company.default_work_end is not null
             and company.default_work_start <> time '24:00:00'
             and company.default_work_end <> time '24:00:00'
             and company.default_work_start < company.default_work_end
           ) then private.agent_civil_date_start(
             p_ends_on + 1,
             company.timezone
           ) else null end as window_end_utc
    from current_authority authority
    join private.mcp_oauth_grants grant_row
      on grant_row.id = p_oauth_grant_id
     and grant_row.user_id = p_actor_user_id
     and grant_row.company_id = p_company_id
     and grant_row.client_id = p_oauth_client_id
     and grant_row.revision = p_grant_revision
     and grant_row.scopes = p_granted_scope_ceiling
     and grant_row.revoked_at is null
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
    join public.users actor
      on actor.id = p_actor_user_id
     and actor.company_id = p_company_id
     and actor.deleted_at is null
     and actor.is_active is true
    join private.agent_read_domain_revisions availability_revision
      on availability_revision.company_id = p_company_id
     and availability_revision.domain = 'availability'
     and availability_revision.source_revision between 0 and 9007199254740991
    join private.agent_read_domain_revisions site_visit_revision
      on site_visit_revision.company_id = p_company_id
     and site_visit_revision.domain = 'site_visits'
     and site_visit_revision.source_revision between 0 and 9007199254740991
    join private.agent_read_domain_revisions task_revision
      on task_revision.company_id = p_company_id
     and task_revision.domain = 'tasks'
     and task_revision.source_revision between 0 and 9007199254740991
    join private.agent_read_domain_revisions team_revision
      on team_revision.company_id = p_company_id
     and team_revision.domain = 'team'
     and team_revision.source_revision between 0 and 9007199254740991
    where authority.permission_snapshot_revision =
            p_permission_snapshot_revision
      and authority.team_scope is not distinct from p_team_scope
      and authority.calendar_scope = p_calendar_scope
  ), cursor_guard as materialized (
    select context.*,
           pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object(
               'domain', 'availability',
               'source_revision', context.availability_revision
             ),
             pg_catalog.jsonb_build_object(
               'domain', 'site_visits',
               'source_revision', context.site_visit_revision
             ),
             pg_catalog.jsonb_build_object(
               'domain', 'tasks',
               'source_revision', context.task_revision
             ),
             pg_catalog.jsonb_build_object(
               'domain', 'team',
               'source_revision', context.team_revision
             )
           ) as source_revisions
    from read_context context
    where p_cursor_read_at is null
       or p_cursor_source_revisions = pg_catalog.jsonb_build_array(
         pg_catalog.jsonb_build_object(
           'domain', 'availability',
           'source_revision', context.availability_revision
         ),
         pg_catalog.jsonb_build_object(
           'domain', 'site_visits',
           'source_revision', context.site_visit_revision
         ),
         pg_catalog.jsonb_build_object(
           'domain', 'tasks',
           'source_revision', context.task_revision
         ),
         pg_catalog.jsonb_build_object(
           'domain', 'team',
           'source_revision', context.team_revision
         )
       )
  ), member_source_gate as materialized (
    select member.id as member_id,
           private.agent_p2_optional_canonical_text(
             pg_catalog.btrim(member.first_name) || ' ' ||
               pg_catalog.btrim(member.last_name),
             256,
             1024,
             false
           ) as display_name
    from cursor_guard context
    join public.users member
      on member.company_id = p_company_id
     and member.deleted_at is null
     and member.is_active is true
     and (
       p_view = 'company'
       or member.id = p_actor_user_id
     )
    order by private.agent_p2_optional_canonical_text(
               pg_catalog.btrim(member.first_name) || ' ' ||
                 pg_catalog.btrim(member.last_name),
               256,
               1024,
               false
             ) collate "C",
             member.id
    limit p_member_source_limit
  ), member_source_state as materialized (
    select pg_catalog.count(*)::integer as inspected,
           p_view = 'company'
             and pg_catalog.count(*) >= p_member_source_limit as exceeded,
           coalesce(pg_catalog.bool_or(
             source.display_name is null
           ), false) as source_invalid
    from member_source_gate source
  ), cursor_filtered_member as materialized (
    select source.*
    from member_source_gate source
    cross join member_source_state state
    where not state.exceeded
      and not state.source_invalid
      and (
        p_view = 'self'
        or p_after_member_id is null
        or (
          source.display_name collate "C",
          source.member_id
        ) > (
          p_after_display_name collate "C",
          p_after_member_id
        )
      )
  ), page_plus_one as materialized (
    select source.*
    from cursor_filtered_member source
    order by source.display_name collate "C", source.member_id
    limit p_page_fetch_limit
  ), retained_member as materialized (
    select source.*
    from page_plus_one source
    order by source.display_name collate "C", source.member_id
    limit p_item_limit
  ), member_page_state as materialized (
    select exists (
             select 1
             from page_plus_one page
             offset p_item_limit
             limit 1
           ) and p_view = 'company' as has_more
  ), retained_member_set as materialized (
    select coalesce(
             pg_catalog.array_agg(
               member.member_id::text order by member.member_id
             ),
             array[]::text[]
           ) as member_ids
    from retained_member member
  ), task_candidate as materialized (
    select 'task'::text as source_kind,
           task.id::text as source_id,
           coalesce(task.team_member_ids, array[]::text[]) as member_ids,
           task.all_day,
           false as is_time_off,
           normalized.start_date as source_start_date,
           normalized.end_date as source_end_date,
           null::timestamp with time zone as source_start_utc,
           null::timestamp with time zone as source_end_utc,
           (
             normalized.start_date is null
             or normalized.end_date is null
             or normalized.end_date < normalized.start_date
             or task.all_day is null
             or coalesce(task.duration, 1) not between 1 and 3660
             or pg_catalog.cardinality(
               coalesce(task.team_member_ids, array[]::text[])
             ) > 500
             or exists (
               select 1
               from pg_catalog.unnest(
                 (coalesce(task.team_member_ids, array[]::text[]))[1:501]
               ) member(value)
               where member.value is null
                  or member.value !~
                    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             )
             or not task.all_day and (
               task.start_time is null
               or task.end_time is null
               or task.start_time = time '24:00:00'
               or task.end_time = time '24:00:00'
             )
           ) as source_invalid,
           task.start_time,
           task.end_time
    from cursor_guard context
    cross join retained_member_set retained
    join public.project_tasks task
      on task.company_id = p_company_id
     and task.deleted_at is null
     and task.status <> 'cancelled'
     and task.start_date is not null
     and coalesce(task.team_member_ids, array[]::text[]) &&
       retained.member_ids
    cross join lateral (
      select case
               when pg_catalog.isfinite(task.start_date)
                and extract(
                  year from task.start_date at time zone 'UTC'
                ) between 1 and 9999
                 then (task.start_date at time zone 'UTC')::date
             end as start_date,
             case
               when task.end_date is not null
                and pg_catalog.isfinite(task.end_date)
                and extract(
                  year from task.end_date at time zone 'UTC'
                ) between 1 and 9999
                 then (task.end_date at time zone 'UTC')::date
               when task.end_date is null
                and pg_catalog.isfinite(task.start_date)
                and extract(
                  year from task.start_date at time zone 'UTC'
                ) between 1 and 9999
                 then (task.start_date at time zone 'UTC')::date +
                   case
                     when task.all_day
                       then case when coalesce(task.duration, 1)
                                      between 1 and 3660
                         then coalesce(task.duration, 1) - 1
                         else 0 end
                     when task.start_time is not null
                      and task.end_time is not null
                      and task.end_time <= task.start_time then 1
                     else 0
                   end
             end as end_date
    ) normalized
    where normalized.start_date <= p_ends_on
      and (
        normalized.start_date >= p_starts_on
        or normalized.end_date >= p_starts_on
      )
    order by normalized.start_date, task.id
    limit p_schedule_source_limit
  ), task_instant as materialized (
    select candidate.*,
           case when context.company_source_invalid
                  or candidate.source_invalid or candidate.all_day
             then null
             else private.agent_unambiguous_local_instant(
               (
                 candidate.source_start_date + candidate.start_time
               )::timestamp without time zone,
               context.company_timezone
             )
           end as resolved_start_utc,
           case when context.company_source_invalid
                  or candidate.source_invalid or candidate.all_day
             then null
             else private.agent_unambiguous_local_instant(
               (
                 candidate.source_end_date + candidate.end_time
               )::timestamp without time zone,
               context.company_timezone
             )
           end as resolved_end_utc
    from task_candidate candidate
    cross join cursor_guard context
  ), task_source as materialized (
    select source_kind,
           source_id,
           member_ids,
           all_day,
           is_time_off,
           source_start_date,
           source_end_date,
           resolved_start_utc as source_start_utc,
           resolved_end_utc as source_end_utc,
           source_invalid
             or not all_day and (
               resolved_start_utc is null
               or resolved_end_utc is null
               or resolved_end_utc <= resolved_start_utc
             ) as source_invalid
    from task_instant
  ), calendar_candidate as materialized (
    select 'calendar'::text as source_kind,
           event.id::text as source_id,
           assignments.member_ids,
           event.all_day,
           event.type = 'time_off' as is_time_off,
           normalized.start_date as source_start_date,
           normalized.end_date as source_end_date,
           case when not event.all_day then event.start_date end
             as source_start_utc,
           case when not event.all_day then event.end_date end
             as source_end_utc,
           (
             not pg_catalog.isfinite(event.start_date)
             or not pg_catalog.isfinite(event.end_date)
             or event.end_date < event.start_date
             or event.user_id !~
               '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             or event.type = 'personal' and (
               pg_catalog.cardinality(
                 coalesce(event.team_member_ids, array[]::text[])
               ) > 500
               or exists (
                 select 1
                 from pg_catalog.unnest(
                   (coalesce(event.team_member_ids, array[]::text[]))[1:501]
                 ) member(value)
                 where member.value is null
                    or member.value !~
                      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               )
             )
           ) as source_invalid
    from cursor_guard context
    cross join retained_member_set retained
    join public.calendar_user_events event
      on event.company_id = p_company_id::text
     and event.deleted_at is null
     and (
       event.type = 'personal' and event.status = 'none'
       or event.type = 'time_off'
          and event.status in ('approved', 'none')
     )
     and event.status not in ('pending', 'denied')
    cross join lateral (
      select coalesce(
               pg_catalog.array_agg(
                 distinct source.value order by source.value
               ),
               array[]::text[]
             ) as member_ids
      from (
        select event.user_id as value
        union all
        select team.value
        from pg_catalog.unnest(
          (coalesce(event.team_member_ids, array[]::text[]))[1:501]
        ) team(value)
        where event.type = 'personal'
      ) source
    ) assignments
    cross join lateral (
      select case when not context.company_source_invalid
               and event.all_day
               and pg_catalog.isfinite(event.start_date)
               then (
                 event.start_date at time zone context.company_timezone
               )::date
             end as start_date,
             case when not context.company_source_invalid
               and event.all_day
               and pg_catalog.isfinite(event.end_date)
               then (
                 event.end_date at time zone context.company_timezone
               )::date
             end as end_date
    ) normalized
    where assignments.member_ids && retained.member_ids
      and (
        event.all_day and (
          normalized.start_date <= p_ends_on
          and (
            normalized.start_date >= p_starts_on
            or normalized.end_date >= p_starts_on
          )
        )
        or not event.all_day
           and event.start_date < context.window_end_utc
           and (
             event.start_date >= context.window_start_utc
             or event.end_date > context.window_start_utc
           )
      )
    order by event.start_date, event.id
    limit p_schedule_source_limit
  ), site_visit_candidate as materialized (
    select 'site_visit'::text as source_kind,
           visit.id::text as source_id,
           coalesce(visit.assignee_ids, array[]::text[]) as member_ids,
           false as all_day,
           false as is_time_off,
           null::date as source_start_date,
           null::date as source_end_date,
           visit.scheduled_at as source_start_utc,
           case when visit.duration_minutes between 1 and 1440
             then visit.scheduled_at + pg_catalog.make_interval(
               mins => visit.duration_minutes
             )
           end as source_end_utc,
           (
             not pg_catalog.isfinite(visit.scheduled_at)
             or not pg_catalog.isfinite(visit.booked_at)
             or visit.duration_minutes not between 1 and 1440
             or pg_catalog.cardinality(
               coalesce(visit.assignee_ids, array[]::text[])
             ) > 500
             or exists (
               select 1
               from pg_catalog.unnest(
                 (coalesce(visit.assignee_ids, array[]::text[]))[1:501]
               ) member(value)
               where member.value is null
                  or member.value !~
                    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             )
           ) as source_invalid
    from cursor_guard context
    cross join retained_member_set retained
    join public.site_visits visit
      on visit.company_id = p_company_id::text
     and visit.deleted_at is null
     and visit.booked_at is not null
     and visit.status in ('scheduled', 'in_progress')
     and coalesce(visit.assignee_ids, array[]::text[]) &&
       retained.member_ids
    where (
      not pg_catalog.isfinite(visit.scheduled_at)
      or visit.scheduled_at < context.window_end_utc
         and (
           visit.scheduled_at >= context.window_start_utc
           or case when visit.duration_minutes between 1 and 1440
             then visit.scheduled_at + pg_catalog.make_interval(
               mins => visit.duration_minutes
             )
           end > context.window_start_utc
         )
    )
    order by visit.scheduled_at, visit.id
    limit p_schedule_source_limit
  ), schedule_source_gate as materialized (
    select source.*
    from (
      select * from calendar_candidate
      union all
      select * from site_visit_candidate
      union all
      select source_kind,
             source_id,
             member_ids,
             all_day,
             is_time_off,
             source_start_date,
             source_end_date,
             source_start_utc,
             source_end_utc,
             source_invalid
      from task_source
    ) source
    order by source.source_kind, source.source_id
    limit p_schedule_source_limit
  ), schedule_source_state as materialized (
    select pg_catalog.count(*)::integer as inspected,
           pg_catalog.count(*) >= p_schedule_source_limit as exceeded,
           coalesce(pg_catalog.bool_or(source.source_invalid), false)
             as source_invalid
    from schedule_source_gate source
  ), day_base as materialized (
    select member.member_id,
           member.display_name,
           p_starts_on + day_offset.value as civil_date,
           context.*,
           (
             context.skip_weekends
             and extract(
               isodow from p_starts_on + day_offset.value
             ) in (6, 7)
           ) as skipped_weekend
    from retained_member member
    cross join pg_catalog.generate_series(
      0,
      p_ends_on - p_starts_on
    ) day_offset(value)
    cross join cursor_guard context
  ), day_instant as materialized (
    select day.*,
           case when day.company_source_invalid or day.skipped_weekend
             then null
             else private.agent_unambiguous_local_instant(
               (
                 day.civil_date + day.default_work_start
               )::timestamp without time zone,
               day.company_timezone
             )
           end as working_start_utc,
           case when day.company_source_invalid or day.skipped_weekend
             then null
             else private.agent_unambiguous_local_instant(
               (
                 day.civil_date + day.default_work_end
               )::timestamp without time zone,
               day.company_timezone
             )
           end as working_end_utc
    from day_base day
  ), day_resolved as materialized (
    select day.*,
           case when day.skipped_weekend then 0
             when day.working_start_utc is null
               or day.working_end_utc is null
               or day.working_end_utc <= day.working_start_utc then 0
             else pg_catalog.floor(
               extract(
                 epoch from day.working_end_utc - day.working_start_utc
               ) / 60
             )::integer
           end as working_minutes,
           case when day.skipped_weekend
             or day.working_start_utc is null
             or day.working_end_utc is null
             or day.working_end_utc <= day.working_start_utc then null
             else pg_catalog.tstzrange(
               day.working_start_utc,
               day.working_end_utc,
               '[)'
             )
           end as working_range,
           (
             not day.skipped_weekend
             and (
               day.working_start_utc is null
               or day.working_end_utc is null
               or day.working_end_utc <= day.working_start_utc
               or extract(
                 epoch from day.working_end_utc - day.working_start_utc
               ) / 60 > 1440
             )
           ) as source_invalid
    from day_instant day
  ), source_day as materialized (
    select day.member_id,
           day.civil_date,
           source.is_time_off,
           case when source.all_day then day.working_range
             else pg_catalog.tstzrange(
               greatest(
                 source.source_start_utc,
                 day.working_start_utc
               ),
               least(
                 source.source_end_utc,
                 day.working_end_utc
               ),
               '[)'
             )
           end as clipped_range
    from day_resolved day
    join schedule_source_gate source
      on day.member_id::text = any(source.member_ids)
     and not source.source_invalid
     and not day.skipped_weekend
     and day.working_range is not null
     and (
       source.all_day
       and day.civil_date between
         source.source_start_date and source.source_end_date
       or not source.all_day
          and source.source_end_utc > day.working_start_utc
          and source.source_start_utc < day.working_end_utc
     )
  ), time_off_day as materialized (
    select distinct source.member_id,
           source.civil_date
    from source_day source
    where source.is_time_off
      and not pg_catalog.isempty(source.clipped_range)
  ), merged_busy_range as materialized (
    select source.member_id,
           source.civil_date,
           pg_catalog.range_agg(source.clipped_range) as value
    from source_day source
    where not source.is_time_off
      and not pg_catalog.isempty(source.clipped_range)
    group by source.member_id, source.civil_date
  ), busy_minutes as materialized (
    select merged.member_id,
           merged.civil_date,
           pg_catalog.floor(
             pg_catalog.sum(
               extract(
                 epoch from
                   pg_catalog.upper(part.value) -
                   pg_catalog.lower(part.value)
               )
             ) / 60
           )::integer as value
    from merged_busy_range merged
    cross join lateral pg_catalog.unnest(merged.value) part(value)
    group by merged.member_id, merged.civil_date
  ), daily_number as materialized (
    select day.member_id,
           day.display_name,
           day.civil_date,
           day.working_minutes,
           case
             when day.skipped_weekend then 0
             when time_off.member_id is not null then day.working_minutes
             else least(
               day.working_minutes,
               coalesce(busy.value, 0)
             )
           end as committed_minutes,
           time_off.member_id is not null as has_time_off,
           day.skipped_weekend,
           day.source_invalid
    from day_resolved day
    left join busy_minutes busy
      on busy.member_id = day.member_id
     and busy.civil_date = day.civil_date
    left join time_off_day time_off
      on time_off.member_id = day.member_id
     and time_off.civil_date = day.civil_date
  ), daily_capacity as materialized (
    select day.*,
           day.working_minutes - day.committed_minutes as available_minutes,
           case
             when day.skipped_weekend or day.has_time_off
               then 'unavailable'
             when day.committed_minutes = 0 then 'available'
             when day.committed_minutes = day.working_minutes
               then 'committed'
             else 'limited'
           end as availability_state
    from daily_number day
  ), row_projection as materialized (
    select member.member_id,
           member.display_name,
           pg_catalog.jsonb_build_object(
             'member_ref', pg_catalog.jsonb_build_object(
               'kind', 'team_member',
               'id', member.member_id
             ),
             'display_name', member.display_name,
             'days', pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'date', pg_catalog.to_char(
                   day.civil_date,
                   'YYYY-MM-DD'
                 ),
                 'state', day.availability_state,
                 'working_minutes', day.working_minutes,
                 'committed_minutes', day.committed_minutes,
                 'available_minutes', day.available_minutes
               )
               order by day.civil_date
             ),
             'content_kind', 'untrusted_business_data'
           ) as item
    from retained_member member
    join daily_capacity day
      on day.member_id = member.member_id
    group by member.member_id, member.display_name
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
             'capability_id', 'list_team_availability',
             'capability_revision',
               'list_team_availability:2026-08-22.v1',
             'capability_manifest_revision',
               '2026-08-22.capability-manifest.v8',
             'ranking_revision',
               'availability-member-order:2026-08-22.v1',
             'required_oauth_scopes',
               pg_catalog.to_jsonb(p_required_oauth_scopes),
             'view', p_view,
             'team_scope', p_team_scope,
             'calendar_scope', p_calendar_scope,
             'starts_on', pg_catalog.to_char(p_starts_on, 'YYYY-MM-DD'),
             'ends_on', pg_catalog.to_char(p_ends_on, 'YYYY-MM-DD'),
             'company_timezone', context.company_timezone,
             'item_limit', p_item_limit,
             'cursor_read_at', case when p_cursor_read_at is null then null
               else private.agent_rfc3339_utc(p_cursor_read_at)
             end,
             'cursor_source_revisions', p_cursor_source_revisions,
             'cursor_predecessor', case when p_after_member_id is null then null
               else pg_catalog.jsonb_build_object(
                 'order', pg_catalog.jsonb_build_array(
                   p_after_display_name,
                   p_after_member_id
                 ),
                 'tie_breaker', p_after_member_id
               )
             end,
             'read_at', private.agent_rfc3339_utc(context.read_at),
             'source_revisions', context.source_revisions,
             'member_source_inspected', member_state.inspected,
             'schedule_source_inspected', schedule_state.inspected,
             'source_has_more', page_state.has_more
           ) as value
    from cursor_guard context
    cross join member_source_state member_state
    cross join schedule_source_state schedule_state
    cross join member_page_state page_state
  ), packaged_rows as materialized (
    select row.item,
           row.display_name,
           row.member_id,
           'ops_proof:v1:' || pg_catalog.encode(
             extensions.digest(
               pg_catalog.convert_to(
                 private.canonical_agent_projection_json(
                   context.value || pg_catalog.jsonb_build_object(
                     'proof_kind', 'team_availability_entity',
                     'item', row.item
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
                     'proof_kind', 'team_availability_evidence',
                     'member_ref', row.item -> 'member_ref'
                   )
                 ),
                 'UTF8'
               ),
               'sha256'
             ),
             'hex'
           ) as evidence_ref,
           pg_catalog.jsonb_build_object(
             'order', pg_catalog.jsonb_build_array(
               row.display_name,
               row.member_id
             ),
             'tie_breaker', row.member_id
           ) as predecessor
    from row_projection row
    cross join proof_context context
  ), aggregate_rows as materialized (
    select coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'item', row.item,
                 'proof_ref', row.proof_ref,
                 'evidence_ref', row.evidence_ref,
                 'predecessor', row.predecessor
               )
               order by row.display_name collate "C", row.member_id
             ),
             '[]'::jsonb
           ) as rows,
           coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'member_ref', row.item -> 'member_ref',
                 'proof_ref', row.proof_ref,
                 'evidence_ref', row.evidence_ref
               )
               order by row.display_name collate "C", row.member_id
             ),
             '[]'::jsonb
           ) as children,
           pg_catalog.count(*)::integer as returned_count
    from packaged_rows row
  ), final_projection as materialized (
    select context.value || pg_catalog.jsonb_build_object(
             'rows', aggregate.rows,
             'collection_proof_ref',
               'ops_proof:v1:' || pg_catalog.encode(
                 extensions.digest(
                   pg_catalog.convert_to(
                     private.canonical_agent_projection_json(
                       context.value || pg_catalog.jsonb_build_object(
                         'proof_kind', 'team_availability_collection',
                         'returned_count', aggregate.returned_count,
                         'has_more', page_state.has_more,
                         'children', aggregate.children
                       )
                     ),
                     'UTF8'
                   ),
                   'sha256'
                 ),
                 'hex'
               ),
             '_member_source_bound', member_state.exceeded,
             '_schedule_source_bound', schedule_state.exceeded,
             '_source_invalid',
               context_row.company_source_invalid
               or context_row.window_start_utc is null
               or context_row.window_end_utc is null
               or context_row.window_end_utc <= context_row.window_start_utc
               or member_state.source_invalid
               or schedule_state.source_invalid
               or exists (
                 select 1
                 from day_resolved day
                 where day.source_invalid
               )
           ) as projection
    from proof_context context
    cross join aggregate_rows aggregate
    cross join member_source_state member_state
    cross join schedule_source_state schedule_state
    cross join member_page_state page_state
    cross join cursor_guard context_row
  )
  select projection
    into v_result
  from final_projection;

  if v_result is null then
    if p_cursor_read_at is not null then
      raise exception 'agent_availability_snapshot_stale'
        using errcode = '40001';
    end if;
    raise exception 'agent_availability_not_authorized'
      using errcode = '42501';
  end if;
  if (v_result ->> '_member_source_bound')::boolean then
    raise exception 'agent_availability_member_source_query_bound'
      using errcode = '54000';
  end if;
  if (v_result ->> '_schedule_source_bound')::boolean then
    raise exception 'agent_availability_schedule_source_query_bound'
      using errcode = '54000';
  end if;
  if (v_result ->> '_source_invalid')::boolean then
    raise exception 'agent_availability_source_data_invalid'
      using errcode = '22000';
  end if;

  return v_result - array[
    '_member_source_bound',
    '_schedule_source_bound',
    '_source_invalid'
  ];
end;
$function$;

revoke all on function private.agent_p2_availability_summary_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,date,date,
  integer,integer,integer,integer,timestamp with time zone,jsonb,text,uuid
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_team_availability_as_system(
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
  p_view text,
  p_team_scope text,
  p_calendar_scope text,
  p_starts_on date,
  p_ends_on date,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_member_source_limit integer,
  p_schedule_source_limit integer,
  p_cursor_read_at timestamp with time zone,
  p_cursor_source_revisions jsonb,
  p_after_display_name text,
  p_after_member_id uuid
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
     or p_capability_id is distinct from 'list_team_availability'
     or p_capability_revision is distinct from
       'list_team_availability:2026-08-22.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-22.capability-manifest.v8' then
    raise exception 'invalid_agent_team_availability_request'
      using errcode = '22023';
  end if;

  return private.agent_p2_availability_summary_v1(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_required_oauth_scopes,
    p_view,
    p_team_scope,
    p_calendar_scope,
    p_starts_on,
    p_ends_on,
    p_item_limit,
    p_page_fetch_limit,
    p_member_source_limit,
    p_schedule_source_limit,
    p_cursor_read_at,
    p_cursor_source_revisions,
    p_after_display_name,
    p_after_member_id
  );
end;
$function$;

revoke all on function public.read_agent_team_availability_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],
  text,text,text,date,date,integer,integer,integer,integer,
  timestamp with time zone,jsonb,text,uuid
) from public, anon, authenticated, service_role;

alter function private.agent_p2_availability_summary_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,date,date,
  integer,integer,integer,integer,timestamp with time zone,jsonb,text,uuid
) owner to current_user;
alter function public.read_agent_team_availability_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],
  text,text,text,date,date,integer,integer,integer,integer,
  timestamp with time zone,jsonb,text,uuid
) owner to current_user;

do $canonical_acl$
declare
  v_signature text;
  v_function_oid oid;
  v_acl record;
begin
  foreach v_signature in array array[
    'private.agent_p2_availability_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,date,date,integer,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)',
    'public.read_agent_team_availability_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,date,date,integer,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)'
  ]::text[] loop
    v_function_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    if v_function_oid is null then
      raise exception 'agent_availability_acl_function_missing:%', v_signature;
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
        raise exception 'agent_availability_acl_role_missing:%', v_signature;
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

grant execute on function public.read_agent_team_availability_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],
  text,text,text,date,date,integer,integer,integer,integer,
  timestamp with time zone,jsonb,text,uuid
) to service_role;

do $postflight$
declare
  v_expected record;
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
    and function_row.proname = 'agent_p2_availability_summary_v1'
  ) or (
    namespace.nspname = 'public'
    and function_row.proname = 'read_agent_team_availability_as_system'
  );

  if v_actual_signatures is distinct from array[
    'private.agent_p2_availability_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,date,date,integer,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)',
    'public.read_agent_team_availability_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,date,date,integer,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)'
  ]::text[] then
    raise exception 'agent_availability_function_signature_set_failed';
  end if;

  for v_expected in
    select * from (values
      (
        'private.agent_p2_availability_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,date,date,integer,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)',
        false,
        false
      ),
      (
        'public.read_agent_team_availability_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,date,date,integer,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)',
        true,
        true
      )
    ) shape(signature, security_definer, service_execute)
  loop
    v_function_oid := pg_catalog.to_regprocedure(v_expected.signature)::oid;
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
      and function_row.proowner = current_user::regrole
      and language_row.lanname = 'plpgsql'
      and function_row.prokind = 'f'::"char"
      and not function_row.proisstrict
      and function_row.proparallel = 'u'::"char"
      and function_row.prosecdef = v_expected.security_definer
      and function_row.provolatile = 's'::"char"
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

    if not found or v_actual_result is distinct from 'jsonb' then
      raise exception 'agent_availability_function_shape_failed:%',
        v_expected.signature;
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

    v_expected_acl := case when v_expected.service_execute then
      array['service_role:EXECUTE:false']::text[]
    else array[]::text[] end;
    if v_acl_entries is distinct from v_expected_acl then
      raise exception 'agent_availability_function_acl_failed:%',
        v_expected.signature;
    end if;
  end loop;
end;
$postflight$;

commit;
