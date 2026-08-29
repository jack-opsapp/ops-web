begin;

-- Task 12 canonical site-visit read body. Public RPCs are service-only;
-- private projections are owner-only and safe for same-statement composition.
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
      ('function', 'private.agent_trim_discovery_display_text(text)'),
      ('function', 'private.agent_rfc3339_utc(timestamp with time zone)'),
      ('function', 'private.canonical_agent_projection_json(jsonb)'),
      ('function', 'private.mcp_oauth_labels_for_scopes(text[],text)'),
      ('function', 'private.agent_p2_artifact_private_evidence_v1(uuid,uuid,text,text[],jsonb,text,uuid,text[],integer)'),
      ('table', 'private.agent_read_domain_revisions'),
      ('table', 'private.mcp_oauth_clients'),
      ('table', 'private.mcp_oauth_grants'),
      ('table', 'public.companies'),
      ('table', 'public.site_visits'),
      ('table', 'public.site_visit_checklist_answers'),
      ('table', 'public.opportunities'),
      ('table', 'public.clients')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_site_visit_reads_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create or replace function private.agent_p2_site_visit_uuid_from_text(
  p_value text
) returns uuid
language sql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $function$
  select case
    when p_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then p_value::uuid
  end;
$function$;

create or replace function private.agent_p2_site_visit_hash_ref(
  p_prefix text,
  p_material jsonb
) returns text
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $function$
begin
  if p_prefix not in (
    'ops_proof:v1:',
    'ops_evidence:v1:',
    'ops_site_visit_field:v1:'
  ) then
    raise exception 'invalid_agent_site_visit_hash_prefix'
      using errcode = '22023';
  end if;
  return p_prefix || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        private.canonical_agent_projection_json(p_material),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
end;
$function$;

create or replace function private.agent_p2_site_visit_text_v1(
  p_value text,
  p_maximum_scalars integer,
  p_maximum_utf8_bytes integer
) returns table (
  value text,
  truncated boolean,
  source_invalid boolean
)
language plpgsql
immutable
parallel safe
security invoker
set search_path = ''
as $function$
declare
  v_normalized text;
  v_candidate text;
begin
  if p_maximum_scalars < 1 or p_maximum_utf8_bytes < 1 then
    return query select null::text, false, true;
    return;
  end if;
  if p_value is null
     or pg_catalog.btrim(p_value) = '' then
    return query select null::text, false, false;
    return;
  end if;

  v_normalized := normalize(
    private.agent_trim_discovery_display_text(p_value),
    NFC
  );
  v_candidate := substring(v_normalized from 1 for p_maximum_scalars);
  while pg_catalog.octet_length(v_candidate) > p_maximum_utf8_bytes loop
    v_candidate := substring(
      v_candidate from 1 for pg_catalog.char_length(v_candidate) - 1
    );
  end loop;

  return query
  select canonical.value,
         v_candidate is distinct from v_normalized,
         canonical.value is null
  from (
    select private.agent_p2_optional_canonical_text(
      v_candidate,
      p_maximum_scalars,
      p_maximum_utf8_bytes,
      true
    ) as value
  ) canonical;
end;
$function$;

create or replace function private.agent_p2_site_visit_summary_v1(
  p_site_visit_id uuid,
  p_opportunity_id uuid,
  p_status text,
  p_booked_at timestamptz,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_created_at timestamptz,
  p_completed_at timestamptz
) returns jsonb
language plpgsql
immutable
parallel safe
security invoker
set search_path = ''
as $function$
declare
  v_booked_at timestamptz;
  v_scheduled_at timestamptz;
  v_created_at timestamptz;
  v_completed_at timestamptz;
begin
  v_booked_at := case
    when p_booked_at is not null
      and pg_catalog.isfinite(p_booked_at)
      and extract(year from p_booked_at at time zone 'UTC') between 1 and 9999
    then pg_catalog.date_bin(
      interval '1 millisecond',
      p_booked_at,
      timestamptz '2000-01-01 00:00:00+00'
    )
  end;
  v_scheduled_at := case
    when p_scheduled_at is not null
      and pg_catalog.isfinite(p_scheduled_at)
      and extract(year from p_scheduled_at at time zone 'UTC') between 1 and 9999
    then pg_catalog.date_bin(
      interval '1 millisecond',
      p_scheduled_at,
      timestamptz '2000-01-01 00:00:00+00'
    )
  end;
  v_created_at := case
    when p_created_at is not null
      and pg_catalog.isfinite(p_created_at)
      and extract(year from p_created_at at time zone 'UTC') between 1 and 9999
    then pg_catalog.date_bin(
      interval '1 millisecond',
      p_created_at,
      timestamptz '2000-01-01 00:00:00+00'
    )
  end;
  v_completed_at := case
    when p_completed_at is not null
      and pg_catalog.isfinite(p_completed_at)
      and extract(year from p_completed_at at time zone 'UTC') between 1 and 9999
    then pg_catalog.date_bin(
      interval '1 millisecond',
      p_completed_at,
      timestamptz '2000-01-01 00:00:00+00'
    )
  end;

  if p_site_visit_id is null
     or p_status not in ('cancelled', 'completed', 'in_progress', 'scheduled')
     or p_created_at is null
     or v_created_at is null
     or (p_status = 'completed') is distinct from (p_completed_at is not null)
     or p_completed_at is not null and v_completed_at is null
     or p_booked_at is not null and (
       v_booked_at is null
       or p_scheduled_at is null
       or v_scheduled_at is null
       or p_duration_minutes not between 1 and 480
     ) then
    return null;
  end if;

  return pg_catalog.jsonb_build_object(
    'site_visit_ref', pg_catalog.jsonb_build_object(
      'kind', 'site_visit',
      'id', p_site_visit_id
    ),
    'link', case when p_opportunity_id is null
      then pg_catalog.jsonb_build_object('state', 'unlinked')
      else pg_catalog.jsonb_build_object(
        'state', 'linked',
        'opportunity_ref', pg_catalog.jsonb_build_object(
          'kind', 'opportunity',
          'id', p_opportunity_id
        )
      )
    end,
    'status', p_status,
    'booking', case when p_booked_at is null
      then pg_catalog.jsonb_build_object('state', 'walk_up')
      else pg_catalog.jsonb_build_object(
        'state', 'booked',
        'booked_at', private.agent_rfc3339_utc(v_booked_at),
        'scheduled_start', private.agent_rfc3339_utc(v_scheduled_at),
        'duration_minutes', p_duration_minutes
      )
    end,
    'created_at', private.agent_rfc3339_utc(v_created_at),
    'completed_at', case when p_completed_at is null then null
      else private.agent_rfc3339_utc(v_completed_at)
    end
  );
end;
$function$;

revoke all on function private.agent_p2_site_visit_uuid_from_text(text)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_site_visit_hash_ref(text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_site_visit_text_v1(text,integer,integer)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_site_visit_summary_v1(
  uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer,
  timestamp with time zone,timestamp with time zone
) from public, anon, authenticated, service_role;

create or replace function private.agent_p2_site_visit_list_v1(
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
  p_resolved_permission_scopes jsonb,
  p_view_kind text,
  p_window_from timestamptz,
  p_window_to timestamptz,
  p_statuses text[],
  p_include_unlinked boolean,
  p_assignee_user_id uuid,
  p_opportunity_id uuid,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer,
  p_cursor_read_at timestamptz,
  p_cursor_source_revisions jsonb,
  p_after_order_at timestamptz,
  p_after_site_visit_id uuid,
  p_read_at timestamptz
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_expected_oauth_scopes constant text[] := array[
    'ops.customers.read',
    'ops.jobs.read',
    'ops.schedule.read',
    'ops.site_visits.read'
  ]::text[];
  v_expected_permission_scopes jsonb;
  v_result jsonb;
begin
  v_expected_permission_scopes := pg_catalog.jsonb_build_object(
    'calendar.view', p_resolved_permission_scopes ->> 'calendar.view',
    'clients.view', p_resolved_permission_scopes ->> 'clients.view',
    'pipeline.view', p_resolved_permission_scopes ->> 'pipeline.view'
  );

  if auth.role() is distinct from 'service_role'
     or p_request_id is null
     or p_request_id is distinct from pg_catalog.btrim(p_request_id)
     or pg_catalog.octet_length(p_request_id) not between 1 and 256
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
     or pg_catalog.cardinality(p_registered_permission_keys) not between 1 and 256
     or p_capability_id is distinct from 'list_site_visits'
     or p_capability_revision is distinct from
       'list_site_visits:2026-08-22.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-22.capability-manifest.v8'
     or p_required_oauth_scopes is distinct from v_expected_oauth_scopes
     or p_resolved_permission_scopes is null
     or pg_catalog.jsonb_typeof(p_resolved_permission_scopes) <> 'object'
     or p_resolved_permission_scopes is distinct from
       v_expected_permission_scopes
     or p_resolved_permission_scopes ->> 'calendar.view'
          not in ('all', 'own')
     or p_resolved_permission_scopes ->> 'clients.view'
          not in ('all', 'assigned')
     or p_resolved_permission_scopes ->> 'pipeline.view'
          not in ('all', 'assigned')
     or p_view_kind not in ('booked_appointments', 'visit_history')
     or p_window_from is null
     or p_window_to is null
     or not pg_catalog.isfinite(p_window_from)
     or not pg_catalog.isfinite(p_window_to)
     or p_window_from is distinct from pg_catalog.date_trunc(
       'milliseconds', p_window_from
     )
     or p_window_to is distinct from pg_catalog.date_trunc(
       'milliseconds', p_window_to
     )
     or p_window_from >= p_window_to
     or p_view_kind = 'booked_appointments'
        and p_window_to - p_window_from > interval '90 days'
     or p_view_kind = 'visit_history'
        and p_window_to - p_window_from > interval '365 days'
     or p_statuses is null
     or pg_catalog.cardinality(p_statuses) not between 0 and 4
     or p_view_kind = 'booked_appointments'
        and pg_catalog.cardinality(p_statuses) = 0
     or p_statuses <@ array[
       'cancelled', 'completed', 'in_progress', 'scheduled'
     ]::text[] is not true
     or p_include_unlinked is null
     or p_view_kind = 'booked_appointments' and p_include_unlinked
     or p_include_unlinked and p_opportunity_id is not null
     or p_include_unlinked
        and p_resolved_permission_scopes ->> 'pipeline.view' <> 'all'
     or p_item_limit not between 1 and 25
     or p_page_fetch_limit is distinct from p_item_limit + 1
     or p_page_fetch_limit not between 2 and 26
     or p_source_limit is distinct from 501
     or p_read_at is null
     or not pg_catalog.isfinite(p_read_at)
     or p_read_at is distinct from pg_catalog.date_trunc(
       'milliseconds', p_read_at
     )
     or p_cursor_source_revisions is null
     or (
       p_cursor_read_at is null
     ) is distinct from (
       p_after_order_at is null and p_after_site_visit_id is null
       and p_cursor_source_revisions = '[]'::jsonb
     )
     or p_cursor_read_at is not null and (
       not pg_catalog.isfinite(p_cursor_read_at)
       or p_cursor_read_at is distinct from pg_catalog.date_trunc(
         'milliseconds', p_cursor_read_at
       )
       or p_read_at is distinct from p_cursor_read_at
       or p_after_order_at is null
       or not pg_catalog.isfinite(p_after_order_at)
       or p_after_order_at is distinct from pg_catalog.date_trunc(
         'milliseconds', p_after_order_at
       )
       or p_after_site_visit_id is null
       or pg_catalog.jsonb_typeof(p_cursor_source_revisions) <> 'array'
       or pg_catalog.jsonb_array_length(p_cursor_source_revisions) <> 1
       or p_cursor_source_revisions #>> '{0,domain}' <> 'site_visits'
       or (p_cursor_source_revisions #>> '{0,source_revision}')
            !~ '^(0|[1-9][0-9]{0,15})$'
     )
     or p_cursor_read_at is null and p_read_at is distinct from
       pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp())
     then
    raise exception 'invalid_agent_site_visit_list_request'
      using errcode = '22023';
  end if;

  if p_granted_scope_ceiling is distinct from (
       select pg_catalog.array_agg(scope.value order by scope.value)
       from (
         select distinct value
         from pg_catalog.unnest(p_granted_scope_ceiling) value
       ) scope
     )
     or p_required_oauth_scopes <@ p_granted_scope_ceiling is not true
     or p_statuses is distinct from coalesce((
       select pg_catalog.array_agg(status.value order by status.value)
       from (
         select distinct value
         from pg_catalog.unnest(p_statuses) value
       ) status
     ), array[]::text[])
     or p_registered_permission_keys is distinct from (
       select pg_catalog.array_agg(key.value order by key.value)
       from (
         select distinct value
         from pg_catalog.unnest(p_registered_permission_keys) value
       ) key
     )
     or not array[
       'calendar.view', 'clients.view', 'pipeline.view'
     ]::text[] <@ p_registered_permission_keys
     or exists (
       select 1
       from pg_catalog.unnest(
         p_granted_scope_ceiling || p_registered_permission_keys
       ) value
       where value is null
          or value is distinct from pg_catalog.btrim(value)
          or pg_catalog.octet_length(value) not between 1 and 128
     ) then
    raise exception 'invalid_agent_site_visit_list_request'
      using errcode = '22023';
  end if;

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           coalesce(scopes.resolved_scopes, '{}'::jsonb)
             as resolved_scopes
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral (
      select pg_catalog.jsonb_object_agg(
               permission.value ->> 'permission',
               permission.value ->> 'scope'
               order by permission.value ->> 'permission'
             ) filter (
               where permission.value ->> 'permission' = any(array[
                 'calendar.view', 'clients.view', 'pipeline.view'
               ]::text[])
             ) as resolved_scopes
      from pg_catalog.jsonb_array_elements(
        authority.effective_permissions
      ) permission(value)
    ) scopes
  ), authority_context as materialized (
    select revision.source_revision
    from current_authority authority
    join public.companies company
      on company.id = p_company_id
     and company.deleted_at is null
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
    join private.mcp_oauth_clients client_row
      on client_row.client_id = grant_row.client_id
     and client_row.disabled_at is null
     and grant_row.scopes <@ client_row.scope_ceiling
     and grant_row.consent_catalog_revision =
       client_row.consent_catalog_revision
     and grant_row.exposure_revision = client_row.exposure_revision
    join private.agent_read_domain_revisions revision
      on revision.company_id = p_company_id
     and revision.domain = 'site_visits'
     and revision.source_revision between 0 and 9007199254740991
    where authority.permission_snapshot_revision =
            p_permission_snapshot_revision
      and authority.resolved_scopes = p_resolved_permission_scopes
  ), raw_source_gate as materialized (
    select candidate.*
    from authority_context context
    cross join lateral (
      (
        select visit.id,
               visit.opportunity_id,
               coalesce(
                 visit.client_ref,
                 private.agent_p2_site_visit_uuid_from_text(visit.client_id)
               ) as client_id,
               visit.project_ref,
               visit.project_id,
               visit.status::text as status,
               pg_catalog.date_bin(
                 interval '1 millisecond',
                 visit.booked_at,
                 timestamptz '2000-01-01 00:00:00+00'
               ) as booked_at,
               pg_catalog.date_bin(
                 interval '1 millisecond',
                 visit.scheduled_at,
                 timestamptz '2000-01-01 00:00:00+00'
               ) as scheduled_at,
               visit.duration_minutes,
               pg_catalog.date_bin(
                 interval '1 millisecond',
                 visit.created_at,
                 timestamptz '2000-01-01 00:00:00+00'
               ) as created_at,
               pg_catalog.date_bin(
                 interval '1 millisecond',
                 visit.completed_at,
                 timestamptz '2000-01-01 00:00:00+00'
               ) as completed_at,
               visit.created_by,
               visit.assignee_ids,
               pg_catalog.date_bin(
                 interval '1 millisecond',
                 visit.booked_at,
                 timestamptz '2000-01-01 00:00:00+00'
               ) as order_at
        from public.site_visits visit
        where p_view_kind = 'booked_appointments'
          and visit.company_id = p_company_id::text
          and visit.deleted_at is null
          and visit.booked_at is not null
          and pg_catalog.date_bin(
                interval '1 millisecond',
                visit.booked_at,
                timestamptz '2000-01-01 00:00:00+00'
              ) >= p_window_from
          and pg_catalog.date_bin(
                interval '1 millisecond',
                visit.booked_at,
                timestamptz '2000-01-01 00:00:00+00'
              ) < p_window_to
          and (
            p_after_order_at is null
            or (
                 pg_catalog.date_bin(
                   interval '1 millisecond',
                   visit.booked_at,
                   timestamptz '2000-01-01 00:00:00+00'
                 ),
                 visit.id
               ) >
               (p_after_order_at, p_after_site_visit_id)
          )
        order by pg_catalog.date_bin(
                   interval '1 millisecond',
                   visit.booked_at,
                   timestamptz '2000-01-01 00:00:00+00'
                 ),
                 visit.id
        limit 501
      )
      union all
      (
        select visit.id,
               visit.opportunity_id,
               coalesce(
                 visit.client_ref,
                 private.agent_p2_site_visit_uuid_from_text(visit.client_id)
               ),
               visit.project_ref,
               visit.project_id,
               visit.status::text,
               pg_catalog.date_bin(
                 interval '1 millisecond',
                 visit.booked_at,
                 timestamptz '2000-01-01 00:00:00+00'
               ),
               pg_catalog.date_bin(
                 interval '1 millisecond',
                 visit.scheduled_at,
                 timestamptz '2000-01-01 00:00:00+00'
               ),
               visit.duration_minutes,
               pg_catalog.date_bin(
                 interval '1 millisecond',
                 visit.created_at,
                 timestamptz '2000-01-01 00:00:00+00'
               ),
               pg_catalog.date_bin(
                 interval '1 millisecond',
                 visit.completed_at,
                 timestamptz '2000-01-01 00:00:00+00'
               ),
               visit.created_by,
               visit.assignee_ids,
               pg_catalog.date_bin(
                 interval '1 millisecond',
                 visit.created_at,
                 timestamptz '2000-01-01 00:00:00+00'
               )
        from public.site_visits visit
        where p_view_kind = 'visit_history'
          and visit.company_id = p_company_id::text
          and visit.deleted_at is null
          and visit.created_at is not null
          and pg_catalog.date_bin(
                interval '1 millisecond',
                visit.created_at,
                timestamptz '2000-01-01 00:00:00+00'
              ) >= p_window_from
          and pg_catalog.date_bin(
                interval '1 millisecond',
                visit.created_at,
                timestamptz '2000-01-01 00:00:00+00'
              ) < p_window_to
          and (
            p_after_order_at is null
            or (
                 pg_catalog.date_bin(
                   interval '1 millisecond',
                   visit.created_at,
                   timestamptz '2000-01-01 00:00:00+00'
                 ),
                 visit.id
               ) <
               (p_after_order_at, p_after_site_visit_id)
          )
        order by pg_catalog.date_bin(
                   interval '1 millisecond',
                   visit.created_at,
                   timestamptz '2000-01-01 00:00:00+00'
                 ) desc,
                 visit.id desc
        limit 501
      )
    ) candidate
    limit 501
  ), raw_source_state as materialized (
    select pg_catalog.count(*)::integer as source_count
    from raw_source_gate
  ), selected_source as materialized (
    select raw.*
    from raw_source_gate raw
    cross join raw_source_state raw_state
    where raw_state.source_count < 501
      and (
        pg_catalog.cardinality(p_statuses) = 0
        or raw.status = any(p_statuses)
      )
      and (
        raw.opportunity_id is not null
        and raw.client_id is not null
        or p_view_kind = 'visit_history'
           and p_include_unlinked
           and raw.opportunity_id is null
           and raw.project_ref is null
           and raw.project_id is null
      )
      and (
        p_assignee_user_id is null
        or p_assignee_user_id::text = any(
          coalesce(raw.assignee_ids, array[]::text[])
        )
      )
      and (
        p_opportunity_id is null
        or raw.opportunity_id = p_opportunity_id
      )
  ), authorized_source as materialized (
    select raw.*,
           private.agent_p2_site_visit_summary_v1(
             raw.id,
             raw.opportunity_id,
             raw.status,
             raw.booked_at,
             raw.scheduled_at,
             raw.duration_minutes,
             raw.created_at,
             raw.completed_at
           ) as visit_summary
    from selected_source raw
    left join public.opportunities opportunity
      on opportunity.id = raw.opportunity_id
     and opportunity.company_id = p_company_id
     and opportunity.deleted_at is null
     and opportunity.merged_into_opportunity_id is null
    left join public.clients client
      on client.id = raw.client_id
     and client.company_id = p_company_id
     and client.deleted_at is null
     and client.merged_into_client_id is null
    where (
        raw.opportunity_id is not null
        and raw.client_id is not null
        and opportunity.id is not null
        and client.id is not null
        and (
          p_resolved_permission_scopes ->> 'calendar.view' = 'all'
          or private.agent_p2_site_visit_uuid_from_text(raw.created_by) =
               p_actor_user_id
          or p_actor_user_id::text = any(
            coalesce(raw.assignee_ids, array[]::text[])
          )
        )
        and private.agent_user_can_access_entity(
          p_actor_user_id,
          p_company_id,
          'opportunity',
          raw.opportunity_id,
          'view'
        )
        and private.agent_user_can_access_entity(
          p_actor_user_id,
          p_company_id,
          'client',
          raw.client_id,
          'view'
        )
        or raw.opportunity_id is null
           and raw.project_ref is null
           and raw.project_id is null
           and p_resolved_permission_scopes ->> 'pipeline.view' = 'all'
      )
  ), authorized_state as materialized (
    select coalesce(
             pg_catalog.bool_or(source.visit_summary is null),
             false
           ) as source_invalid
    from authorized_source source
  ), bounded_source as materialized (
    select source.*,
           pg_catalog.row_number() over (
             order by
               case when p_view_kind = 'booked_appointments'
                 then source.order_at end,
               case when p_view_kind = 'visit_history'
                 then source.order_at end desc,
               case when p_view_kind = 'booked_appointments'
                 then source.id end,
               case when p_view_kind = 'visit_history'
                 then source.id end desc
           ) as ordinality
    from authorized_source source
    where source.visit_summary is not null
    order by
      case when p_view_kind = 'booked_appointments' then source.order_at end,
      case when p_view_kind = 'visit_history' then source.order_at end desc,
      case when p_view_kind = 'booked_appointments' then source.id end,
      case when p_view_kind = 'visit_history' then source.id end desc
    limit p_page_fetch_limit
  ), page_state as materialized (
    select pg_catalog.count(*)::integer as fetched_count,
           pg_catalog.count(*) > p_item_limit as source_has_more
    from bounded_source
  ), revision_projection as materialized (
    select pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object(
               'domain', 'site_visits',
               'source_revision', context.source_revision
             )
           ) as source_revisions
    from authority_context context
  ), query_projection as materialized (
    select pg_catalog.jsonb_build_object(
             'view', p_view_kind,
             'window_from', private.agent_rfc3339_utc(p_window_from),
             'window_to', private.agent_rfc3339_utc(p_window_to),
             'statuses', pg_catalog.to_jsonb(p_statuses),
             'include_unlinked', p_include_unlinked,
             'assignee_ref', case when p_assignee_user_id is null then null
               else pg_catalog.jsonb_build_object(
                 'kind', 'team_member',
                 'id', p_assignee_user_id
               )
             end,
             'opportunity_ref', case when p_opportunity_id is null then null
               else pg_catalog.jsonb_build_object(
                 'kind', 'opportunity',
                 'id', p_opportunity_id
               )
             end
           ) as query
  ), cursor_projection as materialized (
    select case when p_cursor_read_at is null then null::jsonb
             else pg_catalog.jsonb_build_object(
               'view', p_view_kind,
               'order', pg_catalog.jsonb_build_array(
                 private.agent_rfc3339_utc(p_after_order_at),
                 p_after_site_visit_id
               ),
               'tie_breaker', p_after_site_visit_id
             )
           end as predecessor
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
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'required_oauth_scopes',
               pg_catalog.to_jsonb(p_required_oauth_scopes),
             'calendar_scope',
               p_resolved_permission_scopes ->> 'calendar.view',
             'clients_scope',
               p_resolved_permission_scopes ->> 'clients.view',
             'deck_builder_scope', null,
             'pipeline_scope',
               p_resolved_permission_scopes ->> 'pipeline.view',
             'photos_scope', null,
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'ranking_revision',
               'site-visit-ranking:2026-08-22.v1',
             'query', query.query,
             'item_limit', p_item_limit,
             'cursor_read_at', case when p_cursor_read_at is null then null
               else private.agent_rfc3339_utc(p_cursor_read_at)
             end,
             'cursor_source_revisions', p_cursor_source_revisions,
             'cursor_predecessor', cursor.predecessor,
             'read_at', private.agent_rfc3339_utc(p_read_at),
             'source_revisions', revision.source_revisions,
             'source_inspected', raw_state.source_count,
             'source_has_more', page.source_has_more
           ) as context
    from query_projection query
    cross join cursor_projection cursor
    cross join revision_projection revision
    cross join raw_source_state raw_state
    cross join page_state page
  ), packaged_rows as materialized (
    select source.ordinality,
           source.id,
           source.order_at,
           source.visit_summary,
           private.agent_p2_site_visit_hash_ref(
             'ops_proof:v1:',
             proof.context || pg_catalog.jsonb_build_object(
               'proof_kind', 'site_visit_list_entity',
               'visit', source.visit_summary
             )
           ) as proof_ref,
           private.agent_p2_site_visit_hash_ref(
             'ops_evidence:v1:',
             proof.context || pg_catalog.jsonb_build_object(
               'proof_kind', 'site_visit_list_evidence',
               'site_visit_ref', source.visit_summary -> 'site_visit_ref'
             )
           ) as evidence_ref
    from bounded_source source
    cross join proof_context proof
    where source.ordinality <= p_item_limit
  ), aggregate_rows as materialized (
    select coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'item', row.visit_summary,
                 'proof_ref', row.proof_ref,
                 'evidence_ref', row.evidence_ref,
                 'predecessor', pg_catalog.jsonb_build_object(
                   'view', p_view_kind,
                   'order', pg_catalog.jsonb_build_array(
                     private.agent_rfc3339_utc(row.order_at),
                     row.id
                   ),
                   'tie_breaker', row.id
                 )
               )
               order by row.ordinality
             ),
             '[]'::jsonb
           ) as rows,
           coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'site_visit_ref',
                   row.visit_summary -> 'site_visit_ref',
                 'proof_ref', row.proof_ref,
                 'evidence_ref', row.evidence_ref
               )
               order by row.ordinality
             ),
             '[]'::jsonb
           ) as children
    from packaged_rows row
  ), final_projection as materialized (
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
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'required_oauth_scopes',
               pg_catalog.to_jsonb(p_required_oauth_scopes),
             'calendar_scope',
               p_resolved_permission_scopes ->> 'calendar.view',
             'clients_scope',
               p_resolved_permission_scopes ->> 'clients.view',
             'deck_builder_scope', null,
             'pipeline_scope',
               p_resolved_permission_scopes ->> 'pipeline.view',
             'photos_scope', null,
             'read_at', private.agent_rfc3339_utc(p_read_at),
             'source_revisions', revision.source_revisions,
             'query', query.query,
             'item_limit', p_item_limit,
             'cursor_read_at', case when p_cursor_read_at is null then null
               else private.agent_rfc3339_utc(p_cursor_read_at)
             end,
             'cursor_source_revisions', p_cursor_source_revisions,
             'cursor_predecessor', cursor.predecessor,
             'source_inspected', raw_state.source_count,
             'source_has_more', page.source_has_more,
             'rows', aggregate.rows,
             'collection_proof_ref',
               private.agent_p2_site_visit_hash_ref(
                 'ops_proof:v1:',
                 proof.context || pg_catalog.jsonb_build_object(
                   'proof_kind', 'site_visit_list_collection',
                   'returned_count',
                     pg_catalog.jsonb_array_length(aggregate.rows),
                   'has_more', page.source_has_more,
                   'children', aggregate.children
                 )
               ),
             '_source_bound', raw_state.source_count >= 501,
             '_source_invalid', state.source_invalid,
             '_stale', p_cursor_read_at is not null and
               p_cursor_source_revisions is distinct from
                 revision.source_revisions
           ) as projection
    from revision_projection revision
    cross join query_projection query
    cross join cursor_projection cursor
    cross join proof_context proof
    cross join raw_source_state raw_state
    cross join authorized_state state
    cross join page_state page
    cross join aggregate_rows aggregate
  )
  select projection into v_result from final_projection;

  if v_result is null then
    raise exception 'agent_site_visit_read_unauthorized'
      using errcode = '42501';
  end if;
  if (v_result ->> '_stale')::boolean then
    raise exception 'agent_site_visit_read_stale'
      using errcode = '40001';
  end if;
  if (v_result ->> '_source_bound')::boolean then
    raise exception 'agent_site_visit_source_query_bound'
      using errcode = '54000';
  end if;
  if (v_result ->> '_source_invalid')::boolean then
    raise exception 'agent_site_visit_source_data_invalid'
      using errcode = '22000';
  end if;
  return v_result - array['_source_bound', '_source_invalid', '_stale'];
end;
$function$;

revoke all on function private.agent_p2_site_visit_list_v1(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,
  text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,
  uuid,integer,integer,integer,timestamp with time zone,jsonb,
  timestamp with time zone,uuid,timestamp with time zone
) from public, anon, authenticated, service_role;

create or replace function private.agent_p2_site_visit_checklist_value_v1(
  p_kind text,
  p_value jsonb
) returns table (
  answer jsonb,
  answered boolean
)
language plpgsql
immutable
parallel safe
security invoker
set search_path = ''
as $function$
declare
  v_text record;
  v_choice text;
begin
  if p_kind not in (
    'checkbox', 'yes_no_na', 'short_text', 'long_text',
    'measurement', 'photo', 'photo_markup', 'deck_design'
  ) or p_value is null or pg_catalog.jsonb_typeof(p_value) <> 'object' then
    return query
    select pg_catalog.jsonb_build_object('state', 'source_invalid'), false;
    return;
  end if;

  if p_kind = 'checkbox' then
    if not (p_value ? 'boolValue')
       or p_value -> 'boolValue' = 'null'::jsonb then
      return query
      select pg_catalog.jsonb_build_object('state', 'not_answered'), false;
    elsif pg_catalog.jsonb_typeof(p_value -> 'boolValue') = 'boolean' then
      return query
      select pg_catalog.jsonb_build_object(
               'state', 'recorded',
               'value_kind', 'boolean',
               'value', (p_value ->> 'boolValue')::boolean
             ),
             true;
    else
      return query
      select pg_catalog.jsonb_build_object('state', 'source_invalid'), false;
    end if;
    return;
  end if;

  if p_kind = 'yes_no_na' then
    if not (p_value ? 'choice')
       or p_value -> 'choice' = 'null'::jsonb
       or pg_catalog.btrim(coalesce(p_value ->> 'choice', '')) = '' then
      return query
      select pg_catalog.jsonb_build_object('state', 'not_answered'), false;
      return;
    end if;
    if pg_catalog.jsonb_typeof(p_value -> 'choice') <> 'string' then
      return query
      select pg_catalog.jsonb_build_object('state', 'source_invalid'), false;
      return;
    end if;
    v_choice := pg_catalog.lower(pg_catalog.btrim(p_value ->> 'choice'));
    v_choice := case v_choice
      when 'yes' then 'yes'
      when 'no' then 'no'
      when 'n/a' then 'not_applicable'
      when 'na' then 'not_applicable'
      when 'not_applicable' then 'not_applicable'
      else null
    end;
    if v_choice is null then
      return query
      select pg_catalog.jsonb_build_object('state', 'source_invalid'), false;
    else
      return query
      select pg_catalog.jsonb_build_object(
               'state', 'recorded',
               'value_kind', 'choice',
               'choice', v_choice
             ),
             true;
    end if;
    return;
  end if;

  if p_kind in ('short_text', 'long_text', 'measurement') then
    if not (p_value ? 'text')
       or p_value -> 'text' = 'null'::jsonb
       or pg_catalog.btrim(coalesce(p_value ->> 'text', '')) = '' then
      return query
      select pg_catalog.jsonb_build_object('state', 'not_answered'), false;
      return;
    end if;
    if pg_catalog.jsonb_typeof(p_value -> 'text') <> 'string' then
      return query
      select pg_catalog.jsonb_build_object('state', 'source_invalid'), false;
      return;
    end if;
    select * into v_text
    from private.agent_p2_site_visit_text_v1(
      p_value ->> 'text',
      2000,
      8000
    );
    if v_text.source_invalid or v_text.value is null then
      return query
      select pg_catalog.jsonb_build_object('state', 'source_invalid'), false;
    else
      return query
      select pg_catalog.jsonb_build_object(
               'state', 'recorded',
               'value_kind', 'text',
               'text', v_text.value,
               'truncated', v_text.truncated,
               'content_kind', 'untrusted_business_data'
             ),
             true;
    end if;
    return;
  end if;

  if p_kind in ('photo', 'photo_markup') then
    if not (p_value ? 'artifactIds')
       or p_value -> 'artifactIds' = 'null'::jsonb then
      return query
      select pg_catalog.jsonb_build_object('state', 'not_answered'), false;
      return;
    end if;
    if pg_catalog.jsonb_typeof(p_value -> 'artifactIds') <> 'array'
       or pg_catalog.jsonb_array_length(p_value -> 'artifactIds') > 500
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(
           p_value -> 'artifactIds'
         ) element(value)
         where pg_catalog.jsonb_typeof(element.value) <> 'string'
            or private.agent_p2_site_visit_uuid_from_text(
                 element.value #>> '{}'
               ) is null
       ) then
      return query
      select pg_catalog.jsonb_build_object('state', 'source_invalid'), false;
    elsif pg_catalog.jsonb_array_length(p_value -> 'artifactIds') = 0 then
      return query
      select pg_catalog.jsonb_build_object('state', 'not_answered'), false;
    else
      return query
      select pg_catalog.jsonb_build_object(
               'state', 'recorded',
               'value_kind', 'linked_reference'
             ),
             true;
    end if;
    return;
  end if;

  if not (p_value ? 'deckDesignId')
     or p_value -> 'deckDesignId' = 'null'::jsonb
     or pg_catalog.btrim(coalesce(p_value ->> 'deckDesignId', '')) = '' then
    return query
    select pg_catalog.jsonb_build_object('state', 'not_answered'), false;
  elsif pg_catalog.jsonb_typeof(p_value -> 'deckDesignId') <> 'string'
     or private.agent_p2_site_visit_uuid_from_text(
          p_value ->> 'deckDesignId'
        ) is null then
    return query
    select pg_catalog.jsonb_build_object('state', 'source_invalid'), false;
  else
    return query
    select pg_catalog.jsonb_build_object(
             'state', 'recorded',
             'value_kind', 'linked_reference'
           ),
           true;
  end if;
end;
$function$;

revoke all on function private.agent_p2_site_visit_checklist_value_v1(
  text,jsonb
) from public, anon, authenticated, service_role;

create or replace function private.agent_p2_site_visit_context_v1(
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
  p_resolved_permission_scopes jsonb,
  p_site_visit_id uuid,
  p_expected_anchor text,
  p_expected_opportunity_id uuid,
  p_sections text[],
  p_source_limit integer,
  p_artifact_source_limit integer,
  p_checklist_answer_limit integer,
  p_checklist_answer_fetch_limit integer,
  p_timeline_limit integer,
  p_read_at timestamptz
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_artifact_selected boolean;
  v_checklist_selected boolean;
  v_deck_selected boolean;
  v_expected_oauth_scopes text[];
  v_expected_permission_scopes jsonb;
  v_visit record;
  v_visit_summary jsonb;
  v_source_revisions jsonb;
  v_artifact_count integer := 0;
  v_artifact_invalid boolean := false;
  v_artifact_summary jsonb;
  v_deck_refs jsonb := '[]'::jsonb;
  v_deck_count integer := 0;
  v_checklist_raw_count integer := 0;
  v_checklist_summary jsonb;
  v_checklist_answers jsonb;
  v_sections jsonb := '{}'::jsonb;
  v_timeline jsonb := '[]'::jsonb;
  v_text record;
  v_notes jsonb;
  v_measurements jsonb;
  v_source_inspected jsonb;
  v_proof_context jsonb;
  v_raw_result jsonb;
  v_proof_ref text;
  v_evidence_ref text;
  v_result jsonb;
begin
  v_artifact_selected :=
    'artifact_summary' = any(p_sections)
    or 'deck_design_refs' = any(p_sections);
  v_checklist_selected :=
    'checklist_summary' = any(p_sections)
    or 'checklist_answers' = any(p_sections);
  v_deck_selected := 'deck_design_refs' = any(p_sections);

  v_expected_oauth_scopes := case
    when p_expected_anchor = 'opportunity' and v_artifact_selected then
      array[
        'ops.customers.read', 'ops.files.read', 'ops.jobs.read',
        'ops.schedule.read', 'ops.site_visits.read'
      ]::text[]
    when p_expected_anchor = 'opportunity' then
      array[
        'ops.customers.read', 'ops.jobs.read',
        'ops.schedule.read', 'ops.site_visits.read'
      ]::text[]
    when v_artifact_selected then
      array[
        'ops.files.read', 'ops.jobs.read', 'ops.site_visits.read'
      ]::text[]
    else
      array['ops.jobs.read', 'ops.site_visits.read']::text[]
  end;

  v_expected_permission_scopes := case
    when p_expected_anchor = 'opportunity' then
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'calendar.view',
          p_resolved_permission_scopes ->> 'calendar.view',
        'clients.view',
          p_resolved_permission_scopes ->> 'clients.view',
        'deck_builder.view', case when v_deck_selected
          then p_resolved_permission_scopes ->> 'deck_builder.view'
          else null
        end,
        'photos.view', case when v_artifact_selected
          then p_resolved_permission_scopes ->> 'photos.view'
          else null
        end,
        'pipeline.view',
          p_resolved_permission_scopes ->> 'pipeline.view'
      ))
    else
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'deck_builder.view', case when v_deck_selected
          then p_resolved_permission_scopes ->> 'deck_builder.view'
          else null
        end,
        'photos.view', case when v_artifact_selected
          then p_resolved_permission_scopes ->> 'photos.view'
          else null
        end,
        'pipeline.view',
          p_resolved_permission_scopes ->> 'pipeline.view'
      ))
  end;

  if auth.role() is distinct from 'service_role'
     or p_request_id is null
     or p_request_id is distinct from pg_catalog.btrim(p_request_id)
     or pg_catalog.octet_length(p_request_id) not between 1 and 256
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
     or pg_catalog.cardinality(p_registered_permission_keys) not between 1 and 256
     or p_capability_id is distinct from 'get_site_visit_context'
     or p_capability_revision is distinct from
       'get_site_visit_context:2026-08-22.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-22.capability-manifest.v8'
     or p_required_oauth_scopes is distinct from v_expected_oauth_scopes
     or p_resolved_permission_scopes is null
     or pg_catalog.jsonb_typeof(p_resolved_permission_scopes) <> 'object'
     or p_resolved_permission_scopes is distinct from
       v_expected_permission_scopes
     or p_site_visit_id is null
     or p_expected_anchor not in ('opportunity', 'unlinked')
     or (p_expected_anchor = 'opportunity') is distinct from
       (p_expected_opportunity_id is not null)
     or p_sections is null
     or pg_catalog.cardinality(p_sections) not between 1 and 9
     or p_sections <@ array[
       'artifact_summary', 'booking', 'checklist_answers',
       'checklist_summary', 'deck_design_refs', 'lead',
       'measurements', 'notes', 'timeline'
     ]::text[] is not true
     or p_source_limit is distinct from 501
     or p_artifact_source_limit is distinct from 501
     or ('checklist_answers' = any(p_sections)) is distinct from
       (p_checklist_answer_limit between 1 and 25)
     or ('checklist_answers' = any(p_sections)) is distinct from
       (p_checklist_answer_fetch_limit =
          p_checklist_answer_limit + 1
        and p_checklist_answer_fetch_limit between 2 and 26)
     or 'checklist_answers' <> all(p_sections) and (
       p_checklist_answer_limit <> 0
       or p_checklist_answer_fetch_limit <> 0
     )
     or ('timeline' = any(p_sections)) is distinct from
       (p_timeline_limit between 1 and 25)
     or 'timeline' <> all(p_sections) and p_timeline_limit <> 0
     or p_read_at is null
     or not pg_catalog.isfinite(p_read_at)
     or p_read_at is distinct from pg_catalog.date_trunc(
       'milliseconds', pg_catalog.statement_timestamp()
     )
     or p_expected_anchor = 'opportunity' and (
       p_resolved_permission_scopes ->> 'calendar.view'
         not in ('all', 'own')
       or p_resolved_permission_scopes ->> 'clients.view'
         not in ('all', 'assigned')
       or p_resolved_permission_scopes ->> 'pipeline.view'
         not in ('all', 'assigned')
       or v_artifact_selected and
          p_resolved_permission_scopes ->> 'photos.view'
            not in ('all', 'assigned')
       or v_deck_selected and (
          p_resolved_permission_scopes ->> 'deck_builder.view'
            is distinct from 'all'
          and p_resolved_permission_scopes ->> 'deck_builder.view'
            is distinct from 'assigned'
       )
     )
     or p_expected_anchor = 'unlinked' and (
       p_resolved_permission_scopes ->> 'pipeline.view' <> 'all'
       or v_artifact_selected and
          p_resolved_permission_scopes ->> 'photos.view' <> 'all'
       or v_deck_selected and
          p_resolved_permission_scopes ->> 'deck_builder.view'
            is distinct from 'all'
     ) then
    raise exception 'invalid_agent_site_visit_context_request'
      using errcode = '22023';
  end if;

  if p_granted_scope_ceiling is distinct from (
       select pg_catalog.array_agg(scope.value order by scope.value)
       from (
         select distinct value
         from pg_catalog.unnest(p_granted_scope_ceiling) value
       ) scope
     )
     or p_required_oauth_scopes <@ p_granted_scope_ceiling is not true
     or p_sections is distinct from (
       select pg_catalog.array_agg(section.value order by section.value)
       from (
         select distinct value
         from pg_catalog.unnest(p_sections) value
       ) section
     )
     or p_registered_permission_keys is distinct from (
       select pg_catalog.array_agg(key.value order by key.value)
       from (
         select distinct value
         from pg_catalog.unnest(p_registered_permission_keys) value
       ) key
     )
     or not ('pipeline.view' = any(p_registered_permission_keys))
     or p_expected_anchor = 'opportunity' and not array[
       'calendar.view', 'clients.view'
     ]::text[] <@ p_registered_permission_keys
     or v_artifact_selected
        and not ('photos.view' = any(p_registered_permission_keys))
     or v_deck_selected
        and not ('deck_builder.view' = any(p_registered_permission_keys))
     or exists (
       select 1
       from pg_catalog.unnest(
         p_granted_scope_ceiling
         || p_registered_permission_keys
         || p_sections
       ) value
       where value is null
          or value is distinct from pg_catalog.btrim(value)
          or pg_catalog.octet_length(value) not between 1 and 128
     ) then
    raise exception 'invalid_agent_site_visit_context_request'
      using errcode = '22023';
  end if;

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           coalesce(scopes.resolved_scopes, '{}'::jsonb)
             as resolved_scopes
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral (
      select pg_catalog.jsonb_object_agg(
               permission.value ->> 'permission',
               permission.value ->> 'scope'
               order by permission.value ->> 'permission'
             ) filter (
               where v_expected_permission_scopes ? (
                 permission.value ->> 'permission'
               )
             ) as resolved_scopes
      from pg_catalog.jsonb_array_elements(
        authority.effective_permissions
      ) permission(value)
    ) scopes
  ), authority_context as materialized (
    select site_revision.source_revision as site_visit_revision,
           artifact_revision.source_revision as artifact_revision
    from current_authority authority
    join public.companies company
      on company.id = p_company_id
     and company.deleted_at is null
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
    join private.mcp_oauth_clients client_row
      on client_row.client_id = grant_row.client_id
     and client_row.disabled_at is null
     and grant_row.scopes <@ client_row.scope_ceiling
     and grant_row.consent_catalog_revision =
       client_row.consent_catalog_revision
     and grant_row.exposure_revision = client_row.exposure_revision
    join private.agent_read_domain_revisions site_revision
      on site_revision.company_id = p_company_id
     and site_revision.domain = 'site_visits'
     and site_revision.source_revision between 0 and 9007199254740991
    left join private.agent_read_domain_revisions artifact_revision
      on artifact_revision.company_id = p_company_id
     and artifact_revision.domain = 'artifacts'
     and artifact_revision.source_revision between 0 and 9007199254740991
    where authority.permission_snapshot_revision =
            p_permission_snapshot_revision
      and authority.resolved_scopes = p_resolved_permission_scopes
      and (
        not v_artifact_selected
        or artifact_revision.source_revision is not null
      )
  ), visit_source_gate as materialized (
    select visit.*,
           coalesce(
             visit.client_ref,
             private.agent_p2_site_visit_uuid_from_text(visit.client_id)
           ) as resolved_client_id,
           context.site_visit_revision,
           context.artifact_revision
    from authority_context context
    join public.site_visits visit
      on visit.id = p_site_visit_id
     and visit.company_id = p_company_id::text
     and visit.deleted_at is null
    limit 1
  ), selected_visit as materialized (
    select source.*
    from visit_source_gate source
    left join public.opportunities opportunity
      on opportunity.id = source.opportunity_id
     and opportunity.company_id = p_company_id
     and opportunity.deleted_at is null
     and opportunity.merged_into_opportunity_id is null
    left join public.clients client
      on client.id = source.resolved_client_id
     and client.company_id = p_company_id
     and client.deleted_at is null
     and client.merged_into_client_id is null
    where (
      p_expected_anchor = 'opportunity'
      and source.opportunity_id = p_expected_opportunity_id
      and opportunity.id is not null
      and source.resolved_client_id is not null
      and client.id is not null
      and (
        p_resolved_permission_scopes ->> 'calendar.view' = 'all'
        or private.agent_p2_site_visit_uuid_from_text(source.created_by) =
             p_actor_user_id
        or p_actor_user_id::text = any(
          coalesce(source.assignee_ids, array[]::text[])
        )
      )
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'opportunity',
        source.opportunity_id,
        'view'
      )
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'client',
        source.resolved_client_id,
        'view'
      )
      or p_expected_anchor = 'unlinked'
         and source.opportunity_id is null
         and source.project_ref is null
         and source.project_id is null
         and p_resolved_permission_scopes ->> 'pipeline.view' = 'all'
    )
  ), projected_visit as materialized (
    select selected.id,
           selected.opportunity_id,
           selected.status::text as status,
           pg_catalog.date_bin(
             interval '1 millisecond',
             selected.booked_at,
             timestamptz '2000-01-01 00:00:00+00'
           ) as booked_at,
           pg_catalog.date_bin(
             interval '1 millisecond',
             selected.scheduled_at,
             timestamptz '2000-01-01 00:00:00+00'
           ) as scheduled_at,
           selected.duration_minutes,
           pg_catalog.date_bin(
             interval '1 millisecond',
             selected.created_at,
             timestamptz '2000-01-01 00:00:00+00'
           ) as created_at,
           pg_catalog.date_bin(
             interval '1 millisecond',
             selected.completed_at,
             timestamptz '2000-01-01 00:00:00+00'
           ) as completed_at,
           selected.notes,
           selected.measurements,
           selected.resolved_client_id,
           selected.site_visit_revision,
           selected.artifact_revision
    from selected_visit selected
  )
  select projected.*,
         private.agent_p2_site_visit_summary_v1(
           projected.id,
           projected.opportunity_id,
           projected.status,
           projected.booked_at,
           projected.scheduled_at,
           projected.duration_minutes,
           projected.created_at,
           projected.completed_at
         ) as visit_summary
    into v_visit
  from projected_visit projected;

  if not found then
    raise exception 'agent_site_visit_not_found_or_not_visible'
      using errcode = 'P0002';
  end if;
  if v_visit.visit_summary is null then
    raise exception 'agent_site_visit_source_data_invalid'
      using errcode = '22000';
  end if;
  v_visit_summary := v_visit.visit_summary;

  v_source_revisions := case when v_artifact_selected
    then pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'domain', 'artifacts',
        'source_revision', v_visit.artifact_revision
      ),
      pg_catalog.jsonb_build_object(
        'domain', 'site_visits',
        'source_revision', v_visit.site_visit_revision
      )
    )
    else pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'domain', 'site_visits',
        'source_revision', v_visit.site_visit_revision
      )
    )
  end;

  if v_artifact_selected then
    with artifact_source as materialized (
      select artifact.*
      from private.agent_p2_artifact_private_evidence_v1(
        p_actor_user_id,
        p_company_id,
        p_permission_snapshot_revision,
        p_registered_permission_keys,
        p_resolved_permission_scopes,
        case when v_visit.opportunity_id is null
          then 'site_visit_unlinked'
          else 'site_visit_linked'
        end,
        v_visit.id,
        array['site_visit_artifact']::text[],
        p_artifact_source_limit
      ) artifact
    ), artifact_state as materialized (
      select pg_catalog.count(*)::integer as source_count,
             coalesce(
               pg_catalog.bool_or(artifact.source_data_invalid),
               false
             ) as source_invalid
      from artifact_source artifact
    ), kind_counts as materialized (
      select coalesce(
               pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'kind', source.artifact_kind,
                   'count', source.kind_count
                 )
                 order by source.artifact_kind
               ),
               '[]'::jsonb
             ) as counts
      from (
        select artifact.artifact_kind,
               pg_catalog.count(*)::integer as kind_count
        from artifact_source artifact
        group by artifact.artifact_kind
      ) source
    ), deck_refs as materialized (
      select coalesce(
               pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'deck_design_ref', source.deck_design_ref
                 )
                 order by source.deck_design_ref
               ),
               '[]'::jsonb
             ) as refs
      from (
        select distinct artifact.deck_design_ref
        from artifact_source artifact
        where artifact.deck_design_ref is not null
      ) source
    )
    select state.source_count,
           state.source_invalid,
           pg_catalog.jsonb_build_object(
             'source_count', state.source_count,
             'kind_counts', kinds.counts,
             'review_inclusion', pg_catalog.jsonb_build_object(
               'included_count', (
                 select pg_catalog.count(*)::integer
                 from artifact_source artifact
                 where artifact.review_state = 'included'
               ),
               'not_included_count', (
                 select pg_catalog.count(*)::integer
                 from artifact_source artifact
                 where artifact.review_state = 'excluded'
               )
             )
           ),
           decks.refs,
           pg_catalog.jsonb_array_length(decks.refs)
      into v_artifact_count,
           v_artifact_invalid,
           v_artifact_summary,
           v_deck_refs,
           v_deck_count
    from artifact_state state
    cross join kind_counts kinds
    cross join deck_refs decks;

    if v_artifact_count >= 501 then
      raise exception 'agent_site_visit_source_query_bound'
        using errcode = '54000';
    end if;
    if v_artifact_invalid then
      raise exception 'agent_site_visit_source_data_invalid'
        using errcode = '22000';
    end if;
    if v_deck_selected and v_deck_count > 25 then
      raise exception 'agent_site_visit_result_bound'
        using errcode = '54000';
    end if;
  end if;

  if v_checklist_selected then
    with raw_checklist_gate as materialized (
      select answer.*
      from public.site_visit_checklist_answers answer
      where answer.company_id = p_company_id
        and answer.site_visit_id = v_visit.id
        and answer.deleted_at is null
      order by answer.sort_order, answer.id
      limit 501
    ), raw_state as materialized (
      select pg_catalog.count(*)::integer as source_count
      from raw_checklist_gate
    ), projected as materialized (
      select private.agent_p2_site_visit_hash_ref(
               'ops_site_visit_field:v1:',
               pg_catalog.jsonb_build_object(
                 'company_id', p_company_id,
                 'site_visit_id', v_visit.id,
                 'field_id', answer.field_id
               )
             ) as field_ref,
             coalesce(
               private.agent_p2_optional_canonical_text(
                 answer.label, 500, 2000, false
               ),
               'Checklist item'
             ) as label,
             answer.kind,
             answer.required,
             value.answer,
             value.answered
      from raw_checklist_gate answer
      cross join lateral private.agent_p2_site_visit_checklist_value_v1(
        answer.kind,
        answer.answer_value
      ) value
    ), summary as materialized (
      select pg_catalog.count(*)::integer as total_count,
             pg_catalog.count(*) filter (
               where projected.answered
             )::integer as answered_count,
             pg_catalog.count(*) filter (
               where projected.required
             )::integer as required_count,
             pg_catalog.count(*) filter (
               where projected.required and projected.answered
             )::integer as required_answered_count
      from projected
    ), answer_fetch as materialized (
      select projected.*
      from projected
      where 'checklist_answers' = any(p_sections)
      order by projected.field_ref
      limit p_checklist_answer_fetch_limit
    ), answer_rows as materialized (
      select answer_fetch.*
      from answer_fetch
      order by answer_fetch.field_ref
      limit p_checklist_answer_limit
    ), answer_aggregate as materialized (
      select coalesce(
               pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'field_ref', answer.field_ref,
                   'label', answer.label,
                   'kind', answer.kind,
                   'required', answer.required,
                   'answer', answer.answer,
                   'content_kind', 'untrusted_business_data'
                 )
                 order by answer.field_ref
               ),
               '[]'::jsonb
             ) as answers
      from answer_rows answer
    )
    select raw.source_count,
           pg_catalog.jsonb_build_object(
             'total_count', summary.total_count,
             'answered_count', summary.answered_count,
             'required_count', summary.required_count,
             'required_answered_count', summary.required_answered_count,
             'completion', case
               when summary.total_count = 0 then 'not_configured'
               when summary.answered_count = summary.total_count
                and summary.required_answered_count = summary.required_count
                 then 'complete'
               else 'incomplete'
             end
           ),
           pg_catalog.jsonb_build_object(
             'source_count', least(
               raw.source_count,
               p_checklist_answer_limit
             ),
             'source_has_more',
               raw.source_count > p_checklist_answer_limit,
             'returned_count',
               pg_catalog.jsonb_array_length(aggregate.answers),
             'result_budget_omitted_count',
               least(raw.source_count, p_checklist_answer_limit)
               - pg_catalog.jsonb_array_length(aggregate.answers),
             'answers', aggregate.answers
           )
      into v_checklist_raw_count,
           v_checklist_summary,
           v_checklist_answers
    from raw_state raw
    cross join summary
    cross join answer_aggregate aggregate;

    if v_checklist_raw_count >= 501 then
      raise exception 'agent_site_visit_source_query_bound'
        using errcode = '54000';
    end if;
  end if;

  if 'notes' = any(p_sections) then
    select * into v_text
    from private.agent_p2_site_visit_text_v1(v_visit.notes, 2000, 8000);
    if v_text.source_invalid then
      raise exception 'agent_site_visit_source_data_invalid'
        using errcode = '22000';
    end if;
    v_notes := case when v_text.value is null
      then pg_catalog.jsonb_build_object('state', 'not_recorded')
      else pg_catalog.jsonb_build_object(
        'state', 'recorded',
        'text', v_text.value,
        'truncated', v_text.truncated,
        'content_kind', 'untrusted_business_data'
      )
    end;
  end if;

  if 'measurements' = any(p_sections) then
    select * into v_text
    from private.agent_p2_site_visit_text_v1(
      v_visit.measurements,
      2000,
      8000
    );
    if v_text.source_invalid then
      raise exception 'agent_site_visit_source_data_invalid'
        using errcode = '22000';
    end if;
    v_measurements := case when v_text.value is null
      then pg_catalog.jsonb_build_object('state', 'not_recorded')
      else pg_catalog.jsonb_build_object(
        'state', 'recorded',
        'text', v_text.value,
        'truncated', v_text.truncated,
        'content_kind', 'untrusted_business_data'
      )
    end;
  end if;

  if 'timeline' = any(p_sections) then
    select coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'kind', fact.kind,
                 'occurred_at', private.agent_rfc3339_utc(fact.occurred_at)
               )
               order by fact.occurred_at, fact.kind
             ),
             '[]'::jsonb
           )
      into v_timeline
    from (
      select source.*
      from (
        values
          ('created'::text, v_visit.created_at),
          ('booked'::text, v_visit.booked_at),
          (
            'scheduled_start'::text,
            case when v_visit.booked_at is null
              then null::timestamptz
              else v_visit.scheduled_at
            end
          ),
          ('completed'::text, v_visit.completed_at)
      ) source(kind, occurred_at)
      where source.occurred_at is not null
      order by source.occurred_at, source.kind
      limit p_timeline_limit
    ) fact;
  end if;

  if 'artifact_summary' = any(p_sections) then
    v_sections := v_sections || pg_catalog.jsonb_build_object(
      'artifact_summary', v_artifact_summary
    );
  end if;
  if 'booking' = any(p_sections) then
    v_sections := v_sections || pg_catalog.jsonb_build_object(
      'booking', v_visit_summary -> 'booking'
    );
  end if;
  if 'checklist_answers' = any(p_sections) then
    v_sections := v_sections || pg_catalog.jsonb_build_object(
      'checklist_answers', v_checklist_answers
    );
  end if;
  if 'checklist_summary' = any(p_sections) then
    v_sections := v_sections || pg_catalog.jsonb_build_object(
      'checklist_summary', v_checklist_summary
    );
  end if;
  if 'deck_design_refs' = any(p_sections) then
    v_sections := v_sections || pg_catalog.jsonb_build_object(
      'deck_design_refs', v_deck_refs
    );
  end if;
  if 'lead' = any(p_sections) then
    v_sections := v_sections || pg_catalog.jsonb_build_object(
      'lead', case when v_visit.opportunity_id is null
        then pg_catalog.jsonb_build_object('state', 'unlinked')
        else pg_catalog.jsonb_build_object(
          'state', 'linked',
          'opportunity_ref', pg_catalog.jsonb_build_object(
            'kind', 'opportunity',
            'id', v_visit.opportunity_id
          ),
          'client_ref', case when v_visit.resolved_client_id is null then null
            else pg_catalog.jsonb_build_object(
              'kind', 'client',
              'id', v_visit.resolved_client_id
            )
          end
        )
      end
    );
  end if;
  if 'measurements' = any(p_sections) then
    v_sections := v_sections || pg_catalog.jsonb_build_object(
      'measurements', v_measurements
    );
  end if;
  if 'notes' = any(p_sections) then
    v_sections := v_sections || pg_catalog.jsonb_build_object(
      'notes', v_notes
    );
  end if;
  if 'timeline' = any(p_sections) then
    v_sections := v_sections || pg_catalog.jsonb_build_object(
      'timeline', v_timeline
    );
  end if;

  v_source_inspected := pg_catalog.jsonb_build_object(
    'artifacts', case when v_artifact_selected
      then v_artifact_count else 0 end,
    'checklist_answers', case when v_checklist_selected
      then v_checklist_raw_count else 0 end,
    'deck_designs', case when v_deck_selected
      then v_deck_count else 0 end,
    'visits', 1
  );

  v_proof_context := pg_catalog.jsonb_build_object(
    'company_id', p_company_id,
    'actor_user_id', p_actor_user_id,
    'oauth_grant_id', p_oauth_grant_id,
    'oauth_client_id', p_oauth_client_id,
    'grant_revision', p_grant_revision,
    'granted_scope_ceiling',
      pg_catalog.to_jsonb(p_granted_scope_ceiling),
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'capability_manifest_revision', p_capability_manifest_revision,
    'required_oauth_scopes',
      pg_catalog.to_jsonb(p_required_oauth_scopes),
    'calendar_scope',
      p_resolved_permission_scopes ->> 'calendar.view',
    'clients_scope',
      p_resolved_permission_scopes ->> 'clients.view',
    'deck_builder_scope',
      p_resolved_permission_scopes ->> 'deck_builder.view',
    'pipeline_scope',
      p_resolved_permission_scopes ->> 'pipeline.view',
    'photos_scope',
      p_resolved_permission_scopes ->> 'photos.view',
    'capability_id', p_capability_id,
    'capability_revision', p_capability_revision,
    'anchor', p_expected_anchor,
    'opportunity_ref', case when p_expected_opportunity_id is null then null
      else pg_catalog.jsonb_build_object(
        'kind', 'opportunity',
        'id', p_expected_opportunity_id
      )
    end,
    'site_visit_ref', pg_catalog.jsonb_build_object(
      'kind', 'site_visit',
      'id', p_site_visit_id
    ),
    'selected_sections', pg_catalog.to_jsonb(p_sections),
    'checklist_answer_limit',
      case when 'checklist_answers' = any(p_sections)
        then p_checklist_answer_limit else null
      end,
    'timeline_limit', case when 'timeline' = any(p_sections)
      then p_timeline_limit else null
    end,
    'read_at', private.agent_rfc3339_utc(p_read_at),
    'source_revisions', v_source_revisions,
    'source_inspected', v_source_inspected
  );

  v_raw_result := pg_catalog.jsonb_build_object(
    'visit', v_visit_summary,
    'sections', v_sections
  );
  v_proof_ref := private.agent_p2_site_visit_hash_ref(
    'ops_proof:v1:',
    v_proof_context || pg_catalog.jsonb_build_object(
      'proof_kind', 'site_visit_context_entity',
      'result', v_raw_result
    )
  );
  v_evidence_ref := private.agent_p2_site_visit_hash_ref(
    'ops_evidence:v1:',
    v_proof_context || pg_catalog.jsonb_build_object(
      'proof_kind', 'site_visit_context_evidence'
    )
  );

  v_result := pg_catalog.jsonb_build_object(
    'company_id', p_company_id,
    'actor_user_id', p_actor_user_id,
    'oauth_grant_id', p_oauth_grant_id,
    'oauth_client_id', p_oauth_client_id,
    'grant_revision', p_grant_revision,
    'granted_scope_ceiling',
      pg_catalog.to_jsonb(p_granted_scope_ceiling),
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'capability_id', p_capability_id,
    'capability_revision', p_capability_revision,
    'capability_manifest_revision', p_capability_manifest_revision,
    'required_oauth_scopes', pg_catalog.to_jsonb(p_required_oauth_scopes),
    'calendar_scope',
      p_resolved_permission_scopes ->> 'calendar.view',
    'clients_scope',
      p_resolved_permission_scopes ->> 'clients.view',
    'deck_builder_scope',
      p_resolved_permission_scopes ->> 'deck_builder.view',
    'pipeline_scope',
      p_resolved_permission_scopes ->> 'pipeline.view',
    'photos_scope',
      p_resolved_permission_scopes ->> 'photos.view',
    'read_at', private.agent_rfc3339_utc(p_read_at),
    'source_revisions', v_source_revisions,
    'anchor', p_expected_anchor,
    'opportunity_ref', case when p_expected_opportunity_id is null then null
      else pg_catalog.jsonb_build_object(
        'kind', 'opportunity',
        'id', p_expected_opportunity_id
      )
    end,
    'site_visit_ref', pg_catalog.jsonb_build_object(
      'kind', 'site_visit',
      'id', p_site_visit_id
    ),
    'selected_sections', pg_catalog.to_jsonb(p_sections),
    'checklist_answer_limit',
      case when 'checklist_answers' = any(p_sections)
        then p_checklist_answer_limit else null
      end,
    'timeline_limit', case when 'timeline' = any(p_sections)
      then p_timeline_limit else null
    end,
    'source_inspected', v_source_inspected,
    'result', v_raw_result,
    'proof_ref', v_proof_ref,
    'evidence_ref', v_evidence_ref
  );

  return v_result;
end;
$function$;

revoke all on function private.agent_p2_site_visit_context_v1(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,
  uuid,text,uuid,text[],integer,integer,integer,integer,integer,
  timestamp with time zone
) from public, anon, authenticated, service_role;

create or replace function private.agent_p2_site_visit_attention_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_resolved_permission_scopes jsonb,
  p_view_kind text,
  p_window_from timestamptz,
  p_window_to timestamptz,
  p_statuses text[],
  p_include_unlinked boolean,
  p_read_at timestamptz,
  p_source_limit integer,
  p_item_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role'
     or p_actor_user_id is null
     or p_company_id is null
     or p_permission_snapshot_revision is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_registered_permission_keys is null
     or p_resolved_permission_scopes is null
     or pg_catalog.jsonb_typeof(p_resolved_permission_scopes) <> 'object'
     or p_resolved_permission_scopes is distinct from
       pg_catalog.jsonb_build_object(
         'calendar.view',
           p_resolved_permission_scopes ->> 'calendar.view',
         'clients.view',
           p_resolved_permission_scopes ->> 'clients.view',
         'pipeline.view',
           p_resolved_permission_scopes ->> 'pipeline.view'
       )
     or p_resolved_permission_scopes ->> 'calendar.view'
          not in ('all', 'own')
     or p_resolved_permission_scopes ->> 'clients.view'
          not in ('all', 'assigned')
     or p_resolved_permission_scopes ->> 'pipeline.view'
          not in ('all', 'assigned')
     or p_view_kind not in ('booked_appointments', 'visit_history')
     or p_window_from is null
     or p_window_to is null
     or not pg_catalog.isfinite(p_window_from)
     or not pg_catalog.isfinite(p_window_to)
     or p_window_from is distinct from pg_catalog.date_trunc(
       'milliseconds', p_window_from
     )
     or p_window_to is distinct from pg_catalog.date_trunc(
       'milliseconds', p_window_to
     )
     or p_window_from >= p_window_to
     or p_view_kind = 'booked_appointments'
        and p_window_to - p_window_from > interval '90 days'
     or p_view_kind = 'visit_history'
        and p_window_to - p_window_from > interval '365 days'
     or p_statuses is null
     or pg_catalog.cardinality(p_statuses) not between 0 and 4
     or p_statuses <@ array[
       'cancelled', 'completed', 'in_progress', 'scheduled'
     ]::text[] is not true
     or p_include_unlinked is null
     or p_view_kind = 'booked_appointments' and p_include_unlinked
     or p_include_unlinked
        and p_resolved_permission_scopes ->> 'pipeline.view' <> 'all'
     or p_read_at is null
     or not pg_catalog.isfinite(p_read_at)
     or p_read_at is distinct from pg_catalog.date_trunc(
       'milliseconds', pg_catalog.statement_timestamp()
     )
     or p_source_limit is distinct from 501
     or p_item_limit not between 1 and 25
     or not array[
       'calendar.view', 'clients.view', 'pipeline.view'
     ]::text[] <@ p_registered_permission_keys
     or p_registered_permission_keys is distinct from (
       select pg_catalog.array_agg(key.value order by key.value)
       from (
         select distinct value
         from pg_catalog.unnest(p_registered_permission_keys) value
       ) key
     )
     or p_statuses is distinct from coalesce((
       select pg_catalog.array_agg(status.value order by status.value)
       from (
         select distinct value
         from pg_catalog.unnest(p_statuses) value
       ) status
     ), array[]::text[])
     then
    raise exception 'invalid_agent_p2_site_visit_attention_request'
      using errcode = '22023';
  end if;

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           coalesce(scopes.resolved_scopes, '{}'::jsonb)
             as resolved_scopes
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral (
      select pg_catalog.jsonb_object_agg(
               permission.value ->> 'permission',
               permission.value ->> 'scope'
               order by permission.value ->> 'permission'
             ) filter (
               where permission.value ->> 'permission' = any(array[
                 'calendar.view', 'clients.view', 'pipeline.view'
               ]::text[])
             ) as resolved_scopes
      from pg_catalog.jsonb_array_elements(
        authority.effective_permissions
      ) permission(value)
    ) scopes
  ), read_context as materialized (
    select revision.source_revision
    from current_authority authority
    join public.companies company
      on company.id = p_company_id
     and company.deleted_at is null
    join private.agent_read_domain_revisions revision
      on revision.company_id = p_company_id
     and revision.domain = 'site_visits'
     and revision.source_revision between 0 and 9007199254740991
    where authority.permission_snapshot_revision =
            p_permission_snapshot_revision
      and authority.resolved_scopes = p_resolved_permission_scopes
  ), raw_source_gate as materialized (
    select candidate.*
    from read_context context
    cross join lateral (
      (
        select visit.id,
               visit.opportunity_id,
               coalesce(
                 visit.client_ref,
                 private.agent_p2_site_visit_uuid_from_text(visit.client_id)
               ) as client_id,
               visit.project_ref,
               visit.project_id,
               visit.status::text as status,
               pg_catalog.date_bin(
                 interval '1 millisecond',
                 visit.booked_at,
                 timestamptz '2000-01-01 00:00:00+00'
               ) as booked_at,
               pg_catalog.date_bin(
                 interval '1 millisecond',
                 visit.created_at,
                 timestamptz '2000-01-01 00:00:00+00'
               ) as created_at,
               visit.created_by,
               visit.assignee_ids,
               pg_catalog.date_bin(
                 interval '1 millisecond',
                 visit.booked_at,
                 timestamptz '2000-01-01 00:00:00+00'
               ) as attention_at
        from public.site_visits visit
        where p_view_kind = 'booked_appointments'
          and visit.company_id = p_company_id::text
          and visit.deleted_at is null
          and visit.booked_at is not null
          and pg_catalog.date_bin(
                interval '1 millisecond',
                visit.booked_at,
                timestamptz '2000-01-01 00:00:00+00'
              ) >= p_window_from
          and pg_catalog.date_bin(
                interval '1 millisecond',
                visit.booked_at,
                timestamptz '2000-01-01 00:00:00+00'
              ) < p_window_to
        order by pg_catalog.date_bin(
                   interval '1 millisecond',
                   visit.booked_at,
                   timestamptz '2000-01-01 00:00:00+00'
                 ),
                 visit.id
        limit 501
      )
      union all
      (
        select visit.id,
               visit.opportunity_id,
               coalesce(
                 visit.client_ref,
                 private.agent_p2_site_visit_uuid_from_text(visit.client_id)
               ),
               visit.project_ref,
               visit.project_id,
               visit.status::text,
               pg_catalog.date_bin(
                 interval '1 millisecond',
                 visit.booked_at,
                 timestamptz '2000-01-01 00:00:00+00'
               ),
               pg_catalog.date_bin(
                 interval '1 millisecond',
                 visit.created_at,
                 timestamptz '2000-01-01 00:00:00+00'
               ),
               visit.created_by,
               visit.assignee_ids,
               pg_catalog.date_bin(
                 interval '1 millisecond',
                 visit.created_at,
                 timestamptz '2000-01-01 00:00:00+00'
               )
        from public.site_visits visit
        where p_view_kind = 'visit_history'
          and visit.company_id = p_company_id::text
          and visit.deleted_at is null
          and visit.created_at is not null
          and pg_catalog.date_bin(
                interval '1 millisecond',
                visit.created_at,
                timestamptz '2000-01-01 00:00:00+00'
              ) >= p_window_from
          and pg_catalog.date_bin(
                interval '1 millisecond',
                visit.created_at,
                timestamptz '2000-01-01 00:00:00+00'
              ) < p_window_to
        order by pg_catalog.date_bin(
                   interval '1 millisecond',
                   visit.created_at,
                   timestamptz '2000-01-01 00:00:00+00'
                 ) desc,
                 visit.id desc
        limit 501
      )
    ) candidate
    limit 501
  ), raw_source_state as materialized (
    select pg_catalog.count(*)::integer as source_count
    from raw_source_gate
  ), selected_source as materialized (
    select raw.*
    from raw_source_gate raw
    cross join raw_source_state state
    where state.source_count < 501
      and (
        pg_catalog.cardinality(p_statuses) = 0
        or raw.status = any(p_statuses)
      )
      and (
        raw.opportunity_id is not null
        and raw.client_id is not null
        or p_view_kind = 'visit_history'
           and p_include_unlinked
           and raw.opportunity_id is null
           and raw.project_ref is null
           and raw.project_id is null
      )
  ), authorized_source as materialized (
    select raw.*
    from selected_source raw
    left join public.opportunities opportunity
      on opportunity.id = raw.opportunity_id
     and opportunity.company_id = p_company_id
     and opportunity.deleted_at is null
     and opportunity.merged_into_opportunity_id is null
    left join public.clients client
      on client.id = raw.client_id
     and client.company_id = p_company_id
     and client.deleted_at is null
     and client.merged_into_client_id is null
    where raw.attention_at is not null
      and pg_catalog.isfinite(raw.attention_at)
      and extract(year from raw.attention_at at time zone 'UTC')
            between 1 and 9999
      and raw.attention_at = pg_catalog.date_trunc(
        'milliseconds', raw.attention_at
      )
      and (
        raw.opportunity_id is not null
        and raw.client_id is not null
        and opportunity.id is not null
        and client.id is not null
        and (
          p_resolved_permission_scopes ->> 'calendar.view' = 'all'
          or private.agent_p2_site_visit_uuid_from_text(raw.created_by) =
               p_actor_user_id
          or p_actor_user_id::text = any(
            coalesce(raw.assignee_ids, array[]::text[])
          )
        )
        and private.agent_user_can_access_entity(
          p_actor_user_id,
          p_company_id,
          'opportunity',
          raw.opportunity_id,
          'view'
        )
        and private.agent_user_can_access_entity(
          p_actor_user_id,
          p_company_id,
          'client',
          raw.client_id,
          'view'
        )
        or raw.opportunity_id is null
           and raw.project_ref is null
           and raw.project_id is null
           and p_resolved_permission_scopes ->> 'pipeline.view' = 'all'
      )
  ), bounded_source as materialized (
    select source.*,
           pg_catalog.row_number() over (
             order by
               case when p_view_kind = 'booked_appointments'
                 then source.attention_at end,
               case when p_view_kind = 'visit_history'
                 then source.attention_at end desc,
               case when p_view_kind = 'booked_appointments'
                 then source.id end,
               case when p_view_kind = 'visit_history'
                 then source.id end desc
           ) as ordinality
    from authorized_source source
    order by
      case when p_view_kind = 'booked_appointments'
        then source.attention_at end,
      case when p_view_kind = 'visit_history'
        then source.attention_at end desc,
      case when p_view_kind = 'booked_appointments'
        then source.id end,
      case when p_view_kind = 'visit_history'
        then source.id end desc
    limit least(p_item_limit + 1, 26)
  ), aggregated as materialized (
    select pg_catalog.count(*)::integer as fetched_count,
           pg_catalog.count(*) > p_item_limit as has_more,
           coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'card_kind', 'site_visit',
                 'site_visit_ref', pg_catalog.jsonb_build_object(
                   'kind', 'site_visit',
                   'id', source.id
                 ),
                 'opportunity_ref',
                   case when source.opportunity_id is null then null
                     else pg_catalog.jsonb_build_object(
                       'kind', 'opportunity',
                       'id', source.opportunity_id
                     )
                   end,
                 'status', source.status,
                 'booking_state', case when source.booked_at is null
                   then 'walk_up' else 'booked'
                 end,
                 'attention_at',
                   private.agent_rfc3339_utc(source.attention_at)
               )
               order by source.ordinality
             ) filter (where source.ordinality <= p_item_limit),
             '[]'::jsonb
           ) as cards
    from bounded_source source
  ), final_projection as materialized (
    select pg_catalog.jsonb_build_object(
             'projection_revision',
               'agent-p2-site-visit-attention:v1',
             'selector', p_view_kind,
             'read_at', private.agent_rfc3339_utc(p_read_at),
             'source_versions', pg_catalog.jsonb_build_array(
               pg_catalog.jsonb_build_object(
                 'source_domain', 'site_visits',
                 'source_type', 'site_visit_read_revision',
                 'source_id',
                   'private.agent_read_domain_revisions:site_visits',
                 'version',
                   'revision:' || context.source_revision::text
               )
             ),
             'source_inspected_count', state.source_count,
             'returned_count',
               pg_catalog.jsonb_array_length(result.cards),
             'has_more', result.has_more,
             'cards', result.cards,
             '_source_bound', state.source_count >= 501,
             '_source_invalid', exists (
               select 1
               from selected_source source
               where source.attention_at is null
                  or not pg_catalog.isfinite(source.attention_at)
                  or extract(
                    year from source.attention_at at time zone 'UTC'
                  ) not between 1 and 9999
                  or source.attention_at is distinct from
                    pg_catalog.date_trunc(
                      'milliseconds', source.attention_at
                    )
             )
           ) as projection
    from read_context context
    cross join raw_source_state state
    cross join aggregated result
  )
  select projection into v_result from final_projection;

  if v_result is null then
    raise exception 'agent_p2_site_visit_attention_unauthorized'
      using errcode = '42501';
  end if;
  if (v_result ->> '_source_bound')::boolean then
    raise exception 'agent_p2_site_visit_attention_source_bound'
      using errcode = '54000';
  end if;
  if (v_result ->> '_source_invalid')::boolean then
    raise exception 'agent_p2_site_visit_attention_source_data_invalid'
      using errcode = '22000';
  end if;
  return v_result - array['_source_bound', '_source_invalid'];
end;
$function$;

revoke all on function private.agent_p2_site_visit_attention_v1(
  uuid,uuid,text,text[],jsonb,text,timestamp with time zone,
  timestamp with time zone,text[],boolean,timestamp with time zone,
  integer,integer
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_site_visits_as_system(
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
  p_resolved_permission_scopes jsonb,
  p_view_kind text,
  p_window_from timestamptz,
  p_window_to timestamptz,
  p_statuses text[],
  p_include_unlinked boolean,
  p_assignee_user_id uuid,
  p_opportunity_id uuid,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer,
  p_cursor_read_at timestamptz,
  p_cursor_source_revisions jsonb,
  p_after_order_at timestamptz,
  p_after_site_visit_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'agent_site_visit_read_forbidden'
      using errcode = '42501';
  end if;

  return private.agent_p2_site_visit_list_v1(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_id,
    p_capability_revision,
    p_capability_manifest_revision,
    p_required_oauth_scopes,
    p_resolved_permission_scopes,
    p_view_kind,
    p_window_from,
    p_window_to,
    p_statuses,
    p_include_unlinked,
    p_assignee_user_id,
    p_opportunity_id,
    p_item_limit,
    p_page_fetch_limit,
    p_source_limit,
    p_cursor_read_at,
    p_cursor_source_revisions,
    p_after_order_at,
    p_after_site_visit_id,
    coalesce(
      p_cursor_read_at,
      pg_catalog.date_trunc(
        'milliseconds',
        pg_catalog.statement_timestamp()
      )
    )
  );
end;
$function$;

create or replace function public.read_agent_site_visit_context_as_system(
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
  p_resolved_permission_scopes jsonb,
  p_site_visit_id uuid,
  p_expected_anchor text,
  p_expected_opportunity_id uuid,
  p_sections text[],
  p_source_limit integer,
  p_artifact_source_limit integer,
  p_checklist_answer_limit integer,
  p_checklist_answer_fetch_limit integer,
  p_timeline_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'agent_site_visit_read_forbidden'
      using errcode = '42501';
  end if;

  return private.agent_p2_site_visit_context_v1(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_id,
    p_capability_revision,
    p_capability_manifest_revision,
    p_required_oauth_scopes,
    p_resolved_permission_scopes,
    p_site_visit_id,
    p_expected_anchor,
    p_expected_opportunity_id,
    p_sections,
    p_source_limit,
    p_artifact_source_limit,
    p_checklist_answer_limit,
    p_checklist_answer_fetch_limit,
    p_timeline_limit,
    pg_catalog.date_trunc(
      'milliseconds',
      pg_catalog.statement_timestamp()
    )
  );
end;
$function$;

revoke all on function public.read_agent_site_visits_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,
  text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,
  uuid,integer,integer,integer,timestamp with time zone,jsonb,
  timestamp with time zone,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_site_visit_context_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,
  uuid,text,uuid,text[],integer,integer,integer,integer,integer
) from public, anon, authenticated, service_role;

alter function private.agent_p2_site_visit_uuid_from_text(text)
  owner to current_user;
alter function private.agent_p2_site_visit_hash_ref(text,jsonb)
  owner to current_user;
alter function private.agent_p2_site_visit_text_v1(text,integer,integer)
  owner to current_user;
alter function private.agent_p2_site_visit_summary_v1(
  uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer,
  timestamp with time zone,timestamp with time zone
) owner to current_user;
alter function private.agent_p2_site_visit_list_v1(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,
  text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,
  uuid,integer,integer,integer,timestamp with time zone,jsonb,
  timestamp with time zone,uuid,timestamp with time zone
) owner to current_user;
alter function private.agent_p2_site_visit_checklist_value_v1(text,jsonb)
  owner to current_user;
alter function private.agent_p2_site_visit_context_v1(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,
  uuid,text,uuid,text[],integer,integer,integer,integer,integer,
  timestamp with time zone
) owner to current_user;
alter function private.agent_p2_site_visit_attention_v1(
  uuid,uuid,text,text[],jsonb,text,timestamp with time zone,
  timestamp with time zone,text[],boolean,timestamp with time zone,
  integer,integer
) owner to current_user;
alter function public.read_agent_site_visits_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,
  text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,
  uuid,integer,integer,integer,timestamp with time zone,jsonb,
  timestamp with time zone,uuid
) owner to current_user;
alter function public.read_agent_site_visit_context_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,
  uuid,text,uuid,text[],integer,integer,integer,integer,integer
) owner to current_user;

do $canonical_acl$
declare
  v_signature text;
  v_function_oid oid;
  v_function_owner oid;
  v_acl record;
begin
  foreach v_signature in array array[
    'private.agent_p2_site_visit_uuid_from_text(text)',
    'private.agent_p2_site_visit_hash_ref(text,jsonb)',
    'private.agent_p2_site_visit_text_v1(text,integer,integer)',
    'private.agent_p2_site_visit_summary_v1(uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer,timestamp with time zone,timestamp with time zone)',
    'private.agent_p2_site_visit_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid,timestamp with time zone)',
    'private.agent_p2_site_visit_checklist_value_v1(text,jsonb)',
    'private.agent_p2_site_visit_context_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,uuid,text,uuid,text[],integer,integer,integer,integer,integer,timestamp with time zone)',
    'private.agent_p2_site_visit_attention_v1(uuid,uuid,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,timestamp with time zone,integer,integer)',
    'public.read_agent_site_visits_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid)',
    'public.read_agent_site_visit_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,uuid,text,uuid,text[],integer,integer,integer,integer,integer)'
  ] loop
    v_function_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    if v_function_oid is null then
      raise exception 'agent_site_visit_acl_function_missing: %',
        v_signature using errcode = '55000';
    end if;

    select function_row.proowner
      into v_function_owner
    from pg_catalog.pg_proc function_row
    where function_row.oid = v_function_oid;

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
      left join pg_catalog.pg_roles role_row
        on role_row.oid = acl.grantee
      where function_row.oid = v_function_oid
        and acl.grantee <> v_function_owner
    loop
      if v_acl.role_name is null then
        raise exception 'agent_site_visit_acl_role_missing'
          using errcode = '55000';
      end if;
      execute pg_catalog.format(
        'revoke all privileges on function %s from %s',
        v_signature,
        case when v_acl.grantee = 0 then 'public'
          else pg_catalog.quote_ident(v_acl.role_name)
        end
      );
    end loop;
  end loop;
end;
$canonical_acl$;

grant execute on function public.read_agent_site_visits_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,
  text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,
  uuid,integer,integer,integer,timestamp with time zone,jsonb,
  timestamp with time zone,uuid
) to service_role;
grant execute on function public.read_agent_site_visit_context_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,
  uuid,text,uuid,text[],integer,integer,integer,integer,integer
) to service_role;

do $postflight$
declare
  v_expected_signatures text[] := array[
    'private.agent_p2_site_visit_attention_v1(uuid,uuid,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,timestamp with time zone,integer,integer)',
    'private.agent_p2_site_visit_checklist_value_v1(text,jsonb)',
    'private.agent_p2_site_visit_context_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,uuid,text,uuid,text[],integer,integer,integer,integer,integer,timestamp with time zone)',
    'private.agent_p2_site_visit_hash_ref(text,jsonb)',
    'private.agent_p2_site_visit_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid,timestamp with time zone)',
    'private.agent_p2_site_visit_summary_v1(uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer,timestamp with time zone,timestamp with time zone)',
    'private.agent_p2_site_visit_text_v1(text,integer,integer)',
    'private.agent_p2_site_visit_uuid_from_text(text)',
    'public.read_agent_site_visit_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,uuid,text,uuid,text[],integer,integer,integer,integer,integer)',
    'public.read_agent_site_visits_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,timestamp with time zone,timestamp with time zone,text[],boolean,uuid,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid)'
  ]::text[];
  v_actual_signatures text[];
  v_signature text;
  v_function_oid oid;
  v_function record;
  v_acl_entries text[];
  v_expected_acl text[];
begin
  select coalesce(
           pg_catalog.array_agg(
             namespace.nspname || '.' || function_row.proname || '(' ||
             pg_catalog.replace(
               pg_catalog.oidvectortypes(function_row.proargtypes),
               ', ',
               ','
             ) || ')'
             order by
               namespace.nspname,
               function_row.proname,
               function_row.oid
           ),
           array[]::text[]
         )
    into v_actual_signatures
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace namespace
    on namespace.oid = function_row.pronamespace
  where function_row.proname in (
    'agent_p2_site_visit_attention_v1',
    'agent_p2_site_visit_checklist_value_v1',
    'agent_p2_site_visit_context_v1',
    'agent_p2_site_visit_hash_ref',
    'agent_p2_site_visit_list_v1',
    'agent_p2_site_visit_summary_v1',
    'agent_p2_site_visit_text_v1',
    'agent_p2_site_visit_uuid_from_text',
    'read_agent_site_visit_context_as_system',
    'read_agent_site_visits_as_system'
  )
    and namespace.nspname in ('private', 'public');

  if v_actual_signatures is distinct from v_expected_signatures then
    raise exception 'agent_site_visit_function_signature_set_failed'
      using errcode = '55000';
  end if;

  foreach v_signature in array v_expected_signatures loop
    v_function_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    select function_row.proowner,
           function_row.proacl,
           namespace.nspname as schema_name,
           language_row.lanname,
           function_row.prosecdef,
           function_row.provolatile,
           function_row.proparallel,
           function_row.proconfig
      into v_function
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace namespace
      on namespace.oid = function_row.pronamespace
    join pg_catalog.pg_language language_row
      on language_row.oid = function_row.prolang
    where function_row.oid = v_function_oid;

    if v_function.proowner is distinct from current_user::regrole
       or v_function.schema_name = 'public' and (
         v_function.lanname <> 'plpgsql'
         or not v_function.prosecdef
         or v_function.provolatile <> 's'::"char"
         or v_function.proparallel <> 'u'::"char"
       )
       or v_function.schema_name = 'private'
          and v_function.prosecdef
       or pg_catalog.cardinality(v_function.proconfig) <> 1
       or pg_catalog.replace(
            pg_catalog.regexp_replace(
              v_function.proconfig[1],
              '[[:space:]]+',
              '',
              'g'
            ),
            '""',
            ''
          ) <> 'search_path=' then
      raise exception 'agent_site_visit_function_shape_failed: %',
        v_signature using errcode = '55000';
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
          )
        end || ':' || acl.privilege_type || ':' ||
        acl.is_grantable::text as value
      from pg_catalog.aclexplode(
        coalesce(
          v_function.proacl,
          pg_catalog.acldefault('f', v_function.proowner)
        )
      ) acl
      left join pg_catalog.pg_roles role_row
        on role_row.oid = acl.grantee
      where acl.grantee <> v_function.proowner
    ) entry;

    v_expected_acl := case when v_function.schema_name = 'public'
      then array['service_role:EXECUTE:false']::text[]
      else array[]::text[]
    end;
    if v_acl_entries is distinct from v_expected_acl then
      raise exception 'agent_site_visit_function_acl_failed: %',
        v_signature using errcode = '55000';
    end if;
  end loop;
end;
$postflight$;

commit;
