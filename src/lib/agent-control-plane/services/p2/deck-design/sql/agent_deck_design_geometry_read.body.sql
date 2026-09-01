begin;

-- Task 13 canonical deck-design geometry read body. The public function is a
-- service-role-only fixed RPC; its private projection re-proves OAuth, actor,
-- tenant, policy, exact source anchor, current relationships, and four source
-- revisions before returning one bounded canonical drawing string.
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
      ('function', 'private.mcp_oauth_labels_for_scopes(text[],text)'),
      ('function', 'private.agent_p2_optional_canonical_text(text,integer,integer,boolean)'),
      ('function', 'private.agent_read_domain_uuid_from_text(text)'),
      ('function', 'private.canonical_agent_projection_json(jsonb)'),
      ('function', 'extensions.digest(bytea,text)'),
      ('table', 'private.mcp_oauth_grants'),
      ('table', 'private.mcp_oauth_clients'),
      ('table', 'private.agent_read_domain_revisions'),
      ('table', 'private.agent_operational_read_revisions'),
      ('table', 'public.companies'),
      ('table', 'public.deck_designs'),
      ('table', 'public.site_visit_artifacts'),
      ('table', 'public.site_visits'),
      ('table', 'public.opportunities'),
      ('table', 'public.projects')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_deck_geometry_read_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;
end;
$prerequisites$;

-- Geometry JSON legitimately contains finite fractional values. The generic
-- operational canonicalizer intentionally rejects non-integer numbers, so
-- this domain owns a separate sorted-key JSON serializer. PostgreSQL jsonb
-- has already rejected NaN/Infinity JSON tokens before a row can reach it.
create or replace function private.agent_p2_deck_geometry_canonical_json(
  p_value jsonb
) returns text
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $function$
declare
  v_kind text := pg_catalog.jsonb_typeof(p_value);
  v_result text;
begin
  if v_kind = 'array' then
    select '[' || coalesce(
      pg_catalog.string_agg(
        private.agent_p2_deck_geometry_canonical_json(element.value),
        ',' order by element.ordinality
      ),
      ''
    ) || ']'
      into v_result
    from pg_catalog.jsonb_array_elements(p_value) with ordinality
      as element(value, ordinality);
    return v_result;
  end if;

  if v_kind = 'object' then
    select '{' || coalesce(
      pg_catalog.string_agg(
        pg_catalog.to_jsonb(member.key)::text || ':' ||
          private.agent_p2_deck_geometry_canonical_json(member.value),
        ',' order by member.key collate "C"
      ),
      ''
    ) || '}'
      into v_result
    from pg_catalog.jsonb_each(p_value) member(key, value);
    return v_result;
  end if;

  -- jsonb numeric equality ignores display scale (1, 1.0, and 1.00 are the
  -- same value). Remove insignificant scale so an equality-preserving update
  -- cannot change drawing_source or its content hash without a revision bump.
  if v_kind = 'number' then
    return pg_catalog.trim_scale(
      (p_value #>> array[]::text[])::numeric
    )::text;
  end if;

  return p_value::text;
end;
$function$;

create or replace function private.agent_p2_deck_design_ref(
  p_company_id uuid,
  p_design_id uuid
) returns text
language sql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $function$
  select 'ops_deck_design:v1:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        private.canonical_agent_projection_json(
          pg_catalog.jsonb_build_object(
            'company_id', p_company_id,
            'deck_design_id', p_design_id
          )
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$function$;

revoke all on function private.agent_p2_deck_geometry_canonical_json(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_deck_design_ref(uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function private.agent_p2_deck_design_geometry_v1(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_authorization_candidates jsonb,
  p_source text,
  p_job_kind text,
  p_job_id uuid,
  p_site_visit_id uuid,
  p_deck_design_ref text,
  p_source_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_candidate jsonb;
  v_candidate_count integer;
  v_candidate_rank integer;
  v_previous_candidate_rank integer := 0;
  v_candidate_variant text;
  v_candidate_required_scopes text[];
  v_candidate_resolved_scopes jsonb;
  v_candidate_satisfied_groups integer[];
  v_expected_oauth_scopes text[];
  v_declared_permission_keys text[];
  v_expected_satisfied_groups integer[];
  v_current_resolved_scopes jsonb;
  v_job_candidate jsonb;
  v_linked_candidate jsonb;
  v_unlinked_candidate jsonb;
  v_selected_candidate jsonb;
  v_selected_authorization_variant text;
  v_required_oauth_scopes text[];
  v_resolved_permission_scopes jsonb;
  v_satisfied_permission_group_indexes integer[];
  v_calendar_scope text;
  v_clients_scope text;
  v_deck_builder_scope text;
  v_pipeline_scope text;
  v_projects_scope text;
  v_context record;
  v_design record;
  v_visit record;
  v_raw_source_count integer := 0;
  v_selected_source_count integer := 0;
  v_authority_path text;
  v_visit_opportunity_id uuid;
  v_design_parents jsonb;
  v_drawing_source text;
  v_drawing_content_hash text;
  v_title_text text;
  v_query jsonb;
  v_source_revisions jsonb;
  v_read_at timestamptz;
begin
  if p_authorization_candidates is null
     or pg_catalog.jsonb_typeof(p_authorization_candidates) <> 'array' then
    raise exception 'invalid_agent_deck_geometry_request'
      using errcode = '22023';
  end if;
  v_candidate_count := pg_catalog.jsonb_array_length(
    p_authorization_candidates
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
     or p_capability_manifest_revision is distinct from
       '2026-08-22.capability-manifest.v8'
     or p_capability_id is distinct from 'get_deck_design_geometry'
     or p_capability_revision is distinct from
       'get_deck_design_geometry:2026-08-22.v1'
     or p_source in ('job_artifact', 'site_visit_artifact') is not true
     or v_candidate_count not between 1 and 2
     or pg_catalog.octet_length(p_authorization_candidates::text) > 16384
     or p_deck_design_ref is null
     or p_deck_design_ref !~ '^ops_deck_design:v1:[0-9a-f]{64}$'
     or p_source_limit is distinct from 501
     or p_source = 'job_artifact' and (
       v_candidate_count <> 1
       or p_job_kind not in ('opportunity', 'project')
       or p_job_id is null
       or p_site_visit_id is not null
     )
     or p_source = 'site_visit_artifact' and (
       p_job_kind is not null
       or p_job_id is not null
       or p_site_visit_id is null
     ) then
    raise exception 'invalid_agent_deck_geometry_request'
      using errcode = '22023';
  end if;

  if p_granted_scope_ceiling is distinct from (
       select pg_catalog.array_agg(
         scope.value order by scope.value collate "C"
       )
       from (
         select distinct value
         from pg_catalog.unnest(p_granted_scope_ceiling) value
       ) scope
     )
     or p_registered_permission_keys is distinct from (
       select pg_catalog.array_agg(key.value order by key.value)
       from (
         select distinct value
         from pg_catalog.unnest(p_registered_permission_keys) value
       ) key
     )
     or exists (
       select 1
       from pg_catalog.unnest(
         p_granted_scope_ceiling || p_registered_permission_keys
       ) value
       where value is null
          or value is distinct from pg_catalog.btrim(value)
          or pg_catalog.octet_length(value) not between 1 and 128
     ) then
    raise exception 'invalid_agent_deck_geometry_request'
      using errcode = '22023';
  end if;

  -- The candidates are a bounded set of nominal authorizations. Validate
  -- their literal policy bytes before consulting tenant data, and require the
  -- fixed global order so the same logical request has one representation.
  for v_candidate in
    select candidate.value
    from pg_catalog.jsonb_array_elements(
      p_authorization_candidates
    ) with ordinality candidate(value, ordinality)
    order by candidate.ordinality
  loop
    if pg_catalog.jsonb_typeof(v_candidate) <> 'object'
       or (
         select pg_catalog.count(*)
         from pg_catalog.jsonb_object_keys(v_candidate)
       ) <> 4
       or not v_candidate ?& array[
         'variant_key',
         'required_oauth_scopes',
         'resolved_permission_scopes',
         'satisfied_permission_group_indexes'
       ]::text[]
       or pg_catalog.jsonb_typeof(v_candidate -> 'variant_key') <> 'string'
       or pg_catalog.jsonb_typeof(
            v_candidate -> 'required_oauth_scopes'
          ) <> 'array'
       or pg_catalog.jsonb_typeof(
            v_candidate -> 'resolved_permission_scopes'
          ) <> 'object'
       or pg_catalog.jsonb_typeof(
            v_candidate -> 'satisfied_permission_group_indexes'
          ) <> 'array'
       or pg_catalog.jsonb_array_length(
            v_candidate -> 'required_oauth_scopes'
          ) not between 1 and 16
       or pg_catalog.jsonb_array_length(
            v_candidate -> 'satisfied_permission_group_indexes'
          ) not between 1 and 32
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(
           v_candidate -> 'required_oauth_scopes'
         ) scope(value)
         where pg_catalog.jsonb_typeof(scope.value) <> 'string'
            or pg_catalog.octet_length(
                 scope.value #>> array[]::text[]
               ) not between 1 and 128
       )
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(
           v_candidate -> 'satisfied_permission_group_indexes'
         ) group_index(value)
         where pg_catalog.jsonb_typeof(group_index.value) <> 'number'
            or group_index.value::text !~ '^(0|[1-9][0-9]?)$'
       ) then
      raise exception 'invalid_agent_deck_geometry_request'
        using errcode = '22023';
    end if;

    v_candidate_variant := v_candidate ->> 'variant_key';
    v_candidate_rank := case v_candidate_variant
      when 'job_artifact_opportunity' then 1
      when 'job_artifact_project' then 2
      when 'site_visit_artifact_linked' then 3
      when 'site_visit_artifact_unlinked' then 4
      else null
    end;
    if v_candidate_rank is null
       or v_candidate_rank <= v_previous_candidate_rank
       or (
         p_source = 'job_artifact'
         and v_candidate_variant is distinct from (
           case p_job_kind
             when 'opportunity' then 'job_artifact_opportunity'
             when 'project' then 'job_artifact_project'
           end
         )
       )
       or (
         p_source = 'site_visit_artifact'
         and v_candidate_variant not in (
           'site_visit_artifact_linked',
           'site_visit_artifact_unlinked'
         )
       ) then
      raise exception 'invalid_agent_deck_geometry_request'
        using errcode = '22023';
    end if;
    v_previous_candidate_rank := v_candidate_rank;

    select pg_catalog.array_agg(
             scope.value #>> array[]::text[]
             order by scope.ordinality
           )
      into v_candidate_required_scopes
    from pg_catalog.jsonb_array_elements(
      v_candidate -> 'required_oauth_scopes'
    ) with ordinality scope(value, ordinality);
    select pg_catalog.array_agg(
             (group_index.value #>> array[]::text[])::integer
             order by group_index.ordinality
           )
      into v_candidate_satisfied_groups
    from pg_catalog.jsonb_array_elements(
      v_candidate -> 'satisfied_permission_group_indexes'
    ) with ordinality group_index(value, ordinality);
    v_candidate_resolved_scopes :=
      v_candidate -> 'resolved_permission_scopes';

    v_expected_oauth_scopes := case v_candidate_variant
      when 'job_artifact_opportunity' then
        array['ops.files.read', 'ops.jobs.read']::text[]
      when 'job_artifact_project' then
        array['ops.files.read', 'ops.jobs.read']::text[]
      when 'site_visit_artifact_linked' then array[
        'ops.customers.read',
        'ops.files.read',
        'ops.jobs.read',
        'ops.schedule.read',
        'ops.site_visits.read'
      ]::text[]
      when 'site_visit_artifact_unlinked' then array[
        'ops.files.read',
        'ops.jobs.read',
        'ops.site_visits.read'
      ]::text[]
    end;
    v_declared_permission_keys := case v_candidate_variant
      when 'site_visit_artifact_linked' then array[
        'calendar.view',
        'clients.view',
        'deck_builder.view',
        'pipeline.view',
        'projects.view'
      ]::text[]
      else array[
        'deck_builder.view',
        'pipeline.view',
        'projects.view'
      ]::text[]
    end;
    v_calendar_scope := v_candidate_resolved_scopes ->> 'calendar.view';
    v_clients_scope := v_candidate_resolved_scopes ->> 'clients.view';
    v_deck_builder_scope :=
      v_candidate_resolved_scopes ->> 'deck_builder.view';
    v_pipeline_scope := v_candidate_resolved_scopes ->> 'pipeline.view';
    v_projects_scope := v_candidate_resolved_scopes ->> 'projects.view';

    v_expected_satisfied_groups := case v_candidate_variant
      when 'job_artifact_opportunity' then pg_catalog.array_remove(array[
        case when v_deck_builder_scope in ('all', 'assigned')
                   and v_pipeline_scope in ('all', 'assigned')
          then 0 end,
        case when v_deck_builder_scope in ('all', 'assigned')
                   and v_pipeline_scope in ('all', 'assigned')
                   and v_projects_scope in ('all', 'assigned')
          then 1 end
      ]::integer[], null)
      when 'job_artifact_project' then pg_catalog.array_remove(array[
        case when v_deck_builder_scope in ('all', 'assigned')
                   and v_projects_scope in ('all', 'assigned')
          then 0 end,
        case when v_deck_builder_scope in ('all', 'assigned')
                   and v_projects_scope in ('all', 'assigned')
                   and v_pipeline_scope in ('all', 'assigned')
          then 1 end
      ]::integer[], null)
      when 'site_visit_artifact_linked' then pg_catalog.array_remove(array[
        case when v_calendar_scope in ('all', 'own')
                   and v_clients_scope in ('all', 'assigned')
                   and v_deck_builder_scope in ('all', 'assigned')
                   and v_pipeline_scope in ('all', 'assigned')
          then 0 end,
        case when v_calendar_scope in ('all', 'own')
                   and v_clients_scope in ('all', 'assigned')
                   and v_deck_builder_scope in ('all', 'assigned')
                   and v_pipeline_scope in ('all', 'assigned')
                   and v_projects_scope in ('all', 'assigned')
          then 1 end,
        case when v_calendar_scope in ('all', 'own')
                   and v_clients_scope in ('all', 'assigned')
                   and v_deck_builder_scope = 'all'
                   and v_pipeline_scope in ('all', 'assigned')
          then 2 end
      ]::integer[], null)
      when 'site_visit_artifact_unlinked' then pg_catalog.array_remove(array[
        case when v_deck_builder_scope in ('all', 'assigned')
                   and v_pipeline_scope = 'all'
          then 0 end,
        case when v_deck_builder_scope in ('all', 'assigned')
                   and v_pipeline_scope = 'all'
                   and v_projects_scope in ('all', 'assigned')
          then 1 end,
        case when v_deck_builder_scope = 'all'
                   and v_pipeline_scope = 'all'
          then 2 end
      ]::integer[], null)
    end;

    if v_candidate_required_scopes is distinct from v_expected_oauth_scopes
       or not v_declared_permission_keys <@ p_registered_permission_keys
       or pg_catalog.cardinality(v_expected_satisfied_groups) < 1
       or v_candidate_satisfied_groups is distinct from
         v_expected_satisfied_groups
       or exists (
         select 1
         from pg_catalog.jsonb_each(
           v_candidate_resolved_scopes
         ) permission(permission_key, permission_scope)
         where not permission.permission_key = any(
                 v_declared_permission_keys
               )
            or pg_catalog.jsonb_typeof(permission.permission_scope) <>
                 'string'
            or permission.permission_key = 'calendar.view'
               and permission.permission_scope #>> array[]::text[]
                     not in ('all', 'own')
            or permission.permission_key <> 'calendar.view'
               and permission.permission_scope #>> array[]::text[]
                     not in ('all', 'assigned')
       ) then
      raise exception 'invalid_agent_deck_geometry_request'
        using errcode = '22023';
    end if;

    case v_candidate_variant
      when 'job_artifact_opportunity' then
        v_job_candidate := v_candidate;
      when 'job_artifact_project' then
        v_job_candidate := v_candidate;
      when 'site_visit_artifact_linked' then
        v_linked_candidate := v_candidate;
      when 'site_visit_artifact_unlinked' then
        v_unlinked_candidate := v_candidate;
    end case;
  end loop;

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           authority.effective_permissions
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
  )
  select artifact_revision.source_revision as artifact_revision,
         deck_revision.source_revision as deck_revision,
         operational_revision.source_revision as operational_revision,
         site_revision.source_revision as site_revision,
         authority.effective_permissions,
         grant_row.scopes as grant_scopes
    into v_context
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
  join private.agent_read_domain_revisions artifact_revision
    on artifact_revision.company_id = p_company_id
   and artifact_revision.domain = 'artifacts'
   and artifact_revision.source_revision between 0 and 9007199254740991
  join private.agent_read_domain_revisions deck_revision
    on deck_revision.company_id = p_company_id
   and deck_revision.domain = 'deck_designs'
   and deck_revision.source_revision between 0 and 9007199254740991
  join private.agent_operational_read_revisions operational_revision
    on operational_revision.company_id = p_company_id
   and operational_revision.source_revision between 0 and 9007199254740991
  join private.agent_read_domain_revisions site_revision
    on site_revision.company_id = p_company_id
   and site_revision.domain = 'site_visits'
   and site_revision.source_revision between 0 and 9007199254740991
  where authority.permission_snapshot_revision =
          p_permission_snapshot_revision;

  if not found then
    raise exception 'agent_deck_geometry_not_found_or_not_visible'
      using errcode = 'P0002';
  end if;

  -- Reconstruct each nominal candidate from the current authority snapshot.
  -- An irrelevant candidate cannot carry stale or broadened authority.
  for v_candidate in
    select candidate.value
    from pg_catalog.jsonb_array_elements(
      p_authorization_candidates
    ) with ordinality candidate(value, ordinality)
    order by candidate.ordinality
  loop
    v_candidate_variant := v_candidate ->> 'variant_key';
    v_declared_permission_keys := case v_candidate_variant
      when 'site_visit_artifact_linked' then array[
        'calendar.view',
        'clients.view',
        'deck_builder.view',
        'pipeline.view',
        'projects.view'
      ]::text[]
      else array[
        'deck_builder.view',
        'pipeline.view',
        'projects.view'
      ]::text[]
    end;
    select coalesce(
             pg_catalog.jsonb_object_agg(
               permission.value ->> 'permission',
               permission.value ->> 'scope'
               order by permission.value ->> 'permission'
             ),
             '{}'::jsonb
           )
      into v_current_resolved_scopes
    from pg_catalog.jsonb_array_elements(
      v_context.effective_permissions
    ) permission(value)
    where permission.value ->> 'permission' = any(
      v_declared_permission_keys
    )
      and case permission.value ->> 'permission'
        when 'calendar.view' then
          permission.value ->> 'scope' in ('all', 'own')
        when 'pipeline.view' then
          case when v_candidate_variant = 'site_visit_artifact_unlinked'
            then permission.value ->> 'scope' = 'all'
            else permission.value ->> 'scope' in ('all', 'assigned')
          end
        else permission.value ->> 'scope' in ('all', 'assigned')
      end;
    select pg_catalog.array_agg(
             scope.value #>> array[]::text[]
             order by scope.ordinality
           )
      into v_candidate_required_scopes
    from pg_catalog.jsonb_array_elements(
      v_candidate -> 'required_oauth_scopes'
    ) with ordinality scope(value, ordinality);
    if v_candidate -> 'resolved_permission_scopes' is distinct from
         v_current_resolved_scopes
       or v_candidate_required_scopes <@ v_context.grant_scopes is not true
       or v_candidate_required_scopes <@ p_granted_scope_ceiling is not true
    then
      raise exception 'agent_deck_geometry_not_found_or_not_visible'
        using errcode = 'P0002';
    end if;
  end loop;

  if p_source = 'job_artifact' then
    v_selected_candidate := v_job_candidate;
    v_selected_authorization_variant :=
      v_selected_candidate ->> 'variant_key';
    v_authority_path := case p_job_kind
      when 'opportunity' then 'job_opportunity'
      when 'project' then 'job_project'
    end;
    v_visit_opportunity_id := null;

    select pg_catalog.array_agg(
             scope.value #>> array[]::text[]
             order by scope.ordinality
           )
      into v_required_oauth_scopes
    from pg_catalog.jsonb_array_elements(
      v_selected_candidate -> 'required_oauth_scopes'
    ) with ordinality scope(value, ordinality);
    v_resolved_permission_scopes :=
      v_selected_candidate -> 'resolved_permission_scopes';
    select pg_catalog.array_agg(
             (group_index.value #>> array[]::text[])::integer
             order by group_index.ordinality
           )
      into v_satisfied_permission_group_indexes
    from pg_catalog.jsonb_array_elements(
      v_selected_candidate -> 'satisfied_permission_group_indexes'
    ) with ordinality group_index(value, ordinality);
    v_deck_builder_scope :=
      v_resolved_permission_scopes ->> 'deck_builder.view';
    v_pipeline_scope :=
      v_resolved_permission_scopes ->> 'pipeline.view';
    v_projects_scope :=
      v_resolved_permission_scopes ->> 'projects.view';

    if p_job_kind = 'opportunity' and (
         v_pipeline_scope in ('all', 'assigned') is not true
         or not exists (
           select 1
           from public.opportunities opportunity
           where opportunity.id = p_job_id
             and opportunity.company_id = p_company_id
             and opportunity.deleted_at is null
             and opportunity.merged_into_opportunity_id is null
         )
         or not private.agent_user_can_access_entity(
           p_actor_user_id,
           p_company_id,
           'opportunity',
           p_job_id,
           'view'
         )
       )
       or p_job_kind = 'project' and (
         v_projects_scope in ('all', 'assigned') is not true
         or not exists (
           select 1
           from public.projects project
           where project.id = p_job_id
             and project.company_id = p_company_id
             and project.deleted_at is null
         )
         or not private.agent_user_can_access_entity(
           p_actor_user_id,
           p_company_id,
           'project',
           p_job_id,
           'view'
         )
       ) then
      raise exception 'agent_deck_geometry_not_found_or_not_visible'
        using errcode = 'P0002';
    end if;

    select pg_catalog.count(*)::integer
      into v_raw_source_count
    from (
      select design.id
      from public.deck_designs design
      where design.company_id = p_company_id
        and design.deleted_at is null
        and (
          p_job_kind = 'opportunity'
            and design.opportunity_id = p_job_id
          or p_job_kind = 'project'
            and design.project_id = p_job_id
        )
      order by design.id
      limit 501
    ) raw_design;
    if v_raw_source_count >= 501 then
      raise exception 'agent_deck_geometry_source_bound'
        using errcode = '54000';
    end if;

    select pg_catalog.count(*)::integer
      into v_selected_source_count
    from public.deck_designs design
    where design.company_id = p_company_id
      and design.deleted_at is null
      and (
        p_job_kind = 'opportunity' and design.opportunity_id = p_job_id
        or p_job_kind = 'project' and design.project_id = p_job_id
      )
      and private.agent_p2_deck_design_ref(
            p_company_id, design.id
          ) = p_deck_design_ref;
    if v_selected_source_count is distinct from 1 then
      raise exception 'agent_deck_geometry_not_found_or_not_visible'
        using errcode = 'P0002';
    end if;

    select design.*
      into strict v_design
    from public.deck_designs design
    where design.company_id = p_company_id
      and design.deleted_at is null
      and (
        p_job_kind = 'opportunity' and design.opportunity_id = p_job_id
        or p_job_kind = 'project' and design.project_id = p_job_id
      )
      and private.agent_p2_deck_design_ref(
            p_company_id, design.id
          ) = p_deck_design_ref;
  else
    select visit.*,
           coalesce(
             visit.client_ref,
             private.agent_read_domain_uuid_from_text(visit.client_id)
           ) as resolved_client_id
      into v_visit
    from public.site_visits visit
    where visit.id = p_site_visit_id
      and private.agent_read_domain_uuid_from_text(visit.company_id) =
        p_company_id
      and visit.deleted_at is null
    limit 1;
    if not found then
      raise exception 'agent_deck_geometry_not_found_or_not_visible'
      using errcode = 'P0002';
    end if;

    if v_visit.opportunity_id is not null then
      v_selected_candidate := v_linked_candidate;
      v_authority_path := 'site_visit_linked';
      v_visit_opportunity_id := v_visit.opportunity_id;
    elsif v_visit.project_ref is null and v_visit.project_id is null then
      v_selected_candidate := v_unlinked_candidate;
      v_authority_path := 'site_visit_unlinked';
      v_visit_opportunity_id := null;
    else
      raise exception 'agent_deck_geometry_not_found_or_not_visible'
        using errcode = 'P0002';
    end if;
    if v_selected_candidate is null then
      raise exception 'agent_deck_geometry_not_found_or_not_visible'
        using errcode = 'P0002';
    end if;
    v_selected_authorization_variant :=
      v_selected_candidate ->> 'variant_key';
    select pg_catalog.array_agg(
             scope.value #>> array[]::text[]
             order by scope.ordinality
           )
      into v_required_oauth_scopes
    from pg_catalog.jsonb_array_elements(
      v_selected_candidate -> 'required_oauth_scopes'
    ) with ordinality scope(value, ordinality);
    v_resolved_permission_scopes :=
      v_selected_candidate -> 'resolved_permission_scopes';
    select pg_catalog.array_agg(
             (group_index.value #>> array[]::text[])::integer
             order by group_index.ordinality
           )
      into v_satisfied_permission_group_indexes
    from pg_catalog.jsonb_array_elements(
      v_selected_candidate -> 'satisfied_permission_group_indexes'
    ) with ordinality group_index(value, ordinality);
    v_calendar_scope :=
      v_resolved_permission_scopes ->> 'calendar.view';
    v_clients_scope :=
      v_resolved_permission_scopes ->> 'clients.view';
    v_deck_builder_scope :=
      v_resolved_permission_scopes ->> 'deck_builder.view';
    v_pipeline_scope :=
      v_resolved_permission_scopes ->> 'pipeline.view';
    v_projects_scope :=
      v_resolved_permission_scopes ->> 'projects.view';

    if v_authority_path = 'site_visit_linked' then
      if v_visit.resolved_client_id is null
         or v_calendar_scope in ('all', 'own') is not true
         or v_clients_scope in ('all', 'assigned') is not true
         or v_pipeline_scope in ('all', 'assigned') is not true
         or not (
           v_calendar_scope = 'all'
           or private.agent_read_domain_uuid_from_text(v_visit.created_by) =
                p_actor_user_id
           or p_actor_user_id::text = any(
             coalesce(v_visit.assignee_ids, array[]::text[])
           )
         )
         or not exists (
           select 1
           from public.opportunities opportunity
           where opportunity.id = v_visit.opportunity_id
             and opportunity.company_id = p_company_id
             and opportunity.deleted_at is null
             and opportunity.merged_into_opportunity_id is null
         )
         or not private.agent_user_can_access_entity(
           p_actor_user_id,
           p_company_id,
           'opportunity',
           v_visit.opportunity_id,
           'view'
         )
         or not private.agent_user_can_access_entity(
           p_actor_user_id,
           p_company_id,
           'client',
           v_visit.resolved_client_id,
           'view'
         ) then
        raise exception 'agent_deck_geometry_not_found_or_not_visible'
          using errcode = 'P0002';
      end if;
    elsif v_pipeline_scope is distinct from 'all' then
      raise exception 'agent_deck_geometry_not_found_or_not_visible'
        using errcode = 'P0002';
    end if;

    select pg_catalog.count(*)::integer
      into v_raw_source_count
    from (
      select artifact.id
      from public.site_visit_artifacts artifact
      where pg_catalog.lower(artifact.company_id) = p_company_id::text
        and private.agent_read_domain_uuid_from_text(artifact.company_id) =
          p_company_id
        and artifact.site_visit_id = p_site_visit_id
        and artifact.kind = 'deck_design'
        and artifact.source = 'deck_builder'
        and artifact.deck_design_id is not null
        and artifact.deleted_at is null
      order by artifact.deck_design_id, artifact.id
      limit 501
    ) raw_bridge;
    if v_raw_source_count >= 501 then
      raise exception 'agent_deck_geometry_source_bound'
        using errcode = '54000';
    end if;

    select pg_catalog.count(*)::integer
      into v_selected_source_count
    from public.site_visit_artifacts artifact
    join public.deck_designs design
      on design.id = artifact.deck_design_id
     and design.company_id = p_company_id
     and design.deleted_at is null
    where pg_catalog.lower(artifact.company_id) = p_company_id::text
      and private.agent_read_domain_uuid_from_text(artifact.company_id) =
        p_company_id
      and artifact.site_visit_id = p_site_visit_id
      and artifact.kind = 'deck_design'
      and artifact.source = 'deck_builder'
      and artifact.deleted_at is null
      and private.agent_p2_deck_design_ref(
            p_company_id, design.id
          ) = p_deck_design_ref;
    if v_selected_source_count is distinct from 1 then
      raise exception 'agent_deck_geometry_not_found_or_not_visible'
        using errcode = 'P0002';
    end if;

    select design.*
      into strict v_design
    from public.site_visit_artifacts artifact
    join public.deck_designs design
      on design.id = artifact.deck_design_id
     and design.company_id = p_company_id
     and design.deleted_at is null
    where private.agent_read_domain_uuid_from_text(artifact.company_id) =
        p_company_id
      and artifact.site_visit_id = p_site_visit_id
      and artifact.kind = 'deck_design'
      and artifact.source = 'deck_builder'
      and artifact.deleted_at is null
      and private.agent_p2_deck_design_ref(
            p_company_id, design.id
          ) = p_deck_design_ref;
  end if;

  -- Every retained parent is an independent authority dependency. This is
  -- especially important for converted opportunities that retain both IDs.
  if v_design.project_id is not null then
    if v_projects_scope in ('all', 'assigned') is not true
       or not exists (
         select 1
         from public.projects project
         where project.id = v_design.project_id
           and project.company_id = p_company_id
           and project.deleted_at is null
       )
       or not private.agent_user_can_access_entity(
         p_actor_user_id,
         p_company_id,
         'project',
         v_design.project_id,
         'view'
       ) then
      raise exception 'agent_deck_geometry_not_found_or_not_visible'
        using errcode = 'P0002';
    end if;
  end if;

  if v_design.opportunity_id is not null then
    if v_pipeline_scope in ('all', 'assigned') is not true
       or not exists (
         select 1
         from public.opportunities opportunity
         where opportunity.id = v_design.opportunity_id
           and opportunity.company_id = p_company_id
           and opportunity.deleted_at is null
           and opportunity.merged_into_opportunity_id is null
       )
       or not private.agent_user_can_access_entity(
         p_actor_user_id,
         p_company_id,
         'opportunity',
         v_design.opportunity_id,
         'view'
       ) then
      raise exception 'agent_deck_geometry_not_found_or_not_visible'
        using errcode = 'P0002';
    end if;
  end if;

  if v_design.project_id is null
     and v_design.opportunity_id is null
     and v_deck_builder_scope <> 'all' then
    raise exception 'agent_deck_geometry_not_found_or_not_visible'
     using errcode = 'P0002';
  end if;

  v_design_parents := pg_catalog.jsonb_build_object(
    'opportunity_id', v_design.opportunity_id,
    'project_id', v_design.project_id
  );
  v_drawing_source := private.agent_p2_deck_geometry_canonical_json(
    v_design.drawing_data
  );
  if pg_catalog.octet_length(v_drawing_source) > 1048576 then
    raise exception 'agent_deck_geometry_source_bound'
      using errcode = '54000';
  end if;
  v_drawing_content_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_drawing_source, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  v_title_text := private.agent_p2_optional_canonical_text(
    v_design.title,
    256,
    1024,
    true
  );
  v_read_at := pg_catalog.date_bin(
    interval '1 millisecond',
    pg_catalog.statement_timestamp(),
    timestamptz '2000-01-01 00:00:00+00'
  );
  v_source_revisions := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'domain', 'artifacts',
      'source_revision', v_context.artifact_revision
    ),
    pg_catalog.jsonb_build_object(
      'domain', 'deck_designs',
      'source_revision', v_context.deck_revision
    ),
    pg_catalog.jsonb_build_object(
      'domain', 'legacy_operational',
      'source_revision', v_context.operational_revision
    ),
    pg_catalog.jsonb_build_object(
      'domain', 'site_visits',
      'source_revision', v_context.site_revision
    )
  );
  v_query := case when p_source = 'job_artifact' then
    pg_catalog.jsonb_build_object(
      'source', p_source,
      'job_ref', pg_catalog.jsonb_build_object(
        'kind', p_job_kind,
        'id', p_job_id
      ),
      'deck_design_ref', p_deck_design_ref
    )
  else
    pg_catalog.jsonb_build_object(
      'source', p_source,
      'site_visit_ref', pg_catalog.jsonb_build_object(
        'kind', 'site_visit',
        'id', p_site_visit_id
      ),
      'deck_design_ref', p_deck_design_ref
    )
  end;

  -- Re-read the four version fences immediately before returning. A future
  -- change to function volatility or execution context must still fail closed
  -- instead of returning a projection bound to mixed revision values.
  perform 1
  from private.agent_read_domain_revisions artifact_revision
  join private.agent_read_domain_revisions deck_revision
    on deck_revision.company_id = p_company_id
   and deck_revision.domain = 'deck_designs'
   and deck_revision.source_revision = v_context.deck_revision
  join private.agent_operational_read_revisions operational_revision
    on operational_revision.company_id = p_company_id
   and operational_revision.source_revision = v_context.operational_revision
  join private.agent_read_domain_revisions site_revision
    on site_revision.company_id = p_company_id
   and site_revision.domain = 'site_visits'
   and site_revision.source_revision = v_context.site_revision
  where artifact_revision.company_id = p_company_id
    and artifact_revision.domain = 'artifacts'
    and artifact_revision.source_revision = v_context.artifact_revision;
  if not found then
    raise exception 'agent_deck_geometry_read_stale'
      using errcode = '40001';
  end if;

  return pg_catalog.jsonb_build_object(
    'company_id', p_company_id,
    'actor_user_id', p_actor_user_id,
    'oauth_grant_id', p_oauth_grant_id,
    'oauth_client_id', p_oauth_client_id,
    'grant_revision', p_grant_revision,
    'granted_scope_ceiling', pg_catalog.to_jsonb(p_granted_scope_ceiling),
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'capability_manifest_revision', p_capability_manifest_revision,
    'capability_id', p_capability_id,
    'capability_revision', p_capability_revision,
    'selected_authorization_variant',
      v_selected_authorization_variant,
    'required_oauth_scopes', pg_catalog.to_jsonb(v_required_oauth_scopes),
    'resolved_permission_scopes', v_resolved_permission_scopes,
    'satisfied_permission_group_indexes',
      pg_catalog.to_jsonb(v_satisfied_permission_group_indexes),
    'query', v_query,
    'read_at', pg_catalog.to_char(
      v_read_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'source_revisions', v_source_revisions,
    'source_inspected', pg_catalog.jsonb_build_object(
      'artifact_bridges', case when p_source = 'site_visit_artifact'
        then 1 else 0 end,
      'deck_designs', 1,
      'jobs', (case when v_design.opportunity_id is null then 0 else 1 end) +
        (case when v_design.project_id is null then 0 else 1 end),
      'site_visits', case when p_source = 'site_visit_artifact'
        then 1 else 0 end,
      'visit_opportunities', case when v_visit_opportunity_id is null
        then 0 else 1 end
    ),
    'authority_path', v_authority_path,
    'visit_opportunity_id', v_visit_opportunity_id,
    'design_parents', v_design_parents,
    'design_id', v_design.id,
    'deck_design_ref', p_deck_design_ref,
    'title_text', v_title_text,
    'drawing_source', v_drawing_source,
    'drawing_content_hash', v_drawing_content_hash
  );
end;
$function$;

revoke all on function private.agent_p2_deck_design_geometry_v1(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,
  uuid,uuid,text,integer
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_deck_design_geometry_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_authorization_candidates jsonb,
  p_source text,
  p_job_kind text,
  p_job_id uuid,
  p_site_visit_id uuid,
  p_deck_design_ref text,
  p_source_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'agent_deck_geometry_read_forbidden'
      using errcode = '42501';
  end if;
  return private.agent_p2_deck_design_geometry_v1(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_manifest_revision,
    p_capability_id,
    p_capability_revision,
    p_authorization_candidates,
    p_source,
    p_job_kind,
    p_job_id,
    p_site_visit_id,
    p_deck_design_ref,
    p_source_limit
  );
end;
$function$;

revoke all on function public.read_agent_deck_design_geometry_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,
  uuid,uuid,text,integer
) from public, anon, authenticated, service_role;

alter function private.agent_p2_deck_geometry_canonical_json(jsonb)
  owner to current_user;
alter function private.agent_p2_deck_design_ref(uuid,uuid)
  owner to current_user;
alter function private.agent_p2_deck_design_geometry_v1(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,
  uuid,uuid,text,integer
) owner to current_user;
alter function public.read_agent_deck_design_geometry_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,
  uuid,uuid,text,integer
) owner to current_user;

do $canonical_acl$
declare
  v_signature text;
  v_function_oid oid;
  v_function_owner oid;
  v_acl record;
begin
  foreach v_signature in array array[
    'private.agent_p2_deck_geometry_canonical_json(jsonb)',
    'private.agent_p2_deck_design_ref(uuid,uuid)',
    'private.agent_p2_deck_design_geometry_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,uuid,uuid,text,integer)',
    'public.read_agent_deck_design_geometry_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,uuid,uuid,text,integer)'
  ] loop
    v_function_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    if v_function_oid is null then
      raise exception 'agent_deck_geometry_acl_function_missing: %',
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
      left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
      where function_row.oid = v_function_oid
        and acl.grantee <> v_function_owner
    loop
      if v_acl.role_name is null then
        raise exception 'agent_deck_geometry_acl_role_missing'
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

grant execute on function public.read_agent_deck_design_geometry_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,
  uuid,uuid,text,integer
) to service_role;

do $postflight$
declare
  v_expected_signatures constant text[] := array[
    'private.agent_p2_deck_design_geometry_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,uuid,uuid,text,integer)',
    'private.agent_p2_deck_design_ref(uuid,uuid)',
    'private.agent_p2_deck_geometry_canonical_json(jsonb)',
    'public.read_agent_deck_design_geometry_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,uuid,uuid,text,integer)'
  ]::text[];
  v_actual_signatures text[];
  v_signature text;
  v_function record;
  v_acl_entries text[];
  v_expected_acl text[];
  v_valid boolean;
begin
  select coalesce(
           pg_catalog.array_agg(
             namespace.nspname || '.' || function_row.proname || '(' ||
             pg_catalog.replace(
               pg_catalog.oidvectortypes(function_row.proargtypes),
               ', ', ','
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
  where function_row.proname in (
    'agent_p2_deck_design_geometry_v1',
    'agent_p2_deck_design_ref',
    'agent_p2_deck_geometry_canonical_json',
    'read_agent_deck_design_geometry_as_system'
  )
    and namespace.nspname in ('private', 'public');

  if v_actual_signatures is distinct from v_expected_signatures then
    raise exception 'agent_deck_geometry_function_signature_set_invalid'
      using errcode = '55000';
  end if;

  foreach v_signature in array v_expected_signatures loop
    select function_row.proowner,
           function_row.proacl,
           namespace.nspname as schema_name,
           language_row.lanname,
           function_row.prosecdef,
           function_row.provolatile,
           function_row.proparallel,
           function_row.proisstrict,
           function_row.proconfig,
           pg_catalog.pg_get_function_result(function_row.oid)
             as result_type
      into v_function
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace namespace
      on namespace.oid = function_row.pronamespace
    join pg_catalog.pg_language language_row
      on language_row.oid = function_row.prolang
    where function_row.oid = pg_catalog.to_regprocedure(v_signature);

    if v_function.proowner is distinct from current_user::regrole
       or pg_catalog.cardinality(v_function.proconfig) <> 1
       or pg_catalog.replace(
            pg_catalog.regexp_replace(
              v_function.proconfig[1], '[[:space:]]+', '', 'g'
            ),
            '""', ''
          ) <> 'search_path=' then
      raise exception 'agent_deck_geometry_function_shape_invalid: %',
        v_signature using errcode = '55000';
    end if;

    v_valid := case v_signature
      when 'private.agent_p2_deck_geometry_canonical_json(jsonb)' then
        v_function.lanname = 'plpgsql'
        and not v_function.prosecdef
        and v_function.provolatile = 'i'::"char"
        and v_function.proparallel = 's'::"char"
        and v_function.proisstrict
        and v_function.result_type = 'text'
      when 'private.agent_p2_deck_design_ref(uuid,uuid)' then
        v_function.lanname = 'sql'
        and not v_function.prosecdef
        and v_function.provolatile = 'i'::"char"
        and v_function.proparallel = 's'::"char"
        and v_function.proisstrict
        and v_function.result_type = 'text'
      when 'private.agent_p2_deck_design_geometry_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,uuid,uuid,text,integer)' then
        v_function.lanname = 'plpgsql'
        and not v_function.prosecdef
        and v_function.provolatile = 's'::"char"
        and v_function.proparallel = 'u'::"char"
        and not v_function.proisstrict
        and v_function.result_type = 'jsonb'
      when 'public.read_agent_deck_design_geometry_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,uuid,uuid,text,integer)' then
        v_function.lanname = 'plpgsql'
        and v_function.prosecdef
        and v_function.provolatile = 's'::"char"
        and v_function.proparallel = 'u'::"char"
        and not v_function.proisstrict
        and v_function.result_type = 'jsonb'
      else false
    end;
    if not coalesce(v_valid, false) then
      raise exception 'agent_deck_geometry_function_shape_invalid: %',
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
          else coalesce(role_row.rolname, 'OID:' || acl.grantee::text)
        end || ':' || acl.privilege_type || ':' ||
          acl.is_grantable::text as value
      from pg_catalog.aclexplode(
        coalesce(
          v_function.proacl,
          pg_catalog.acldefault('f', v_function.proowner)
        )
      ) acl
      left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
      where acl.grantee <> v_function.proowner
    ) entry;
    v_expected_acl := case when v_function.schema_name = 'public'
      then array['service_role:EXECUTE:false']::text[]
      else array[]::text[]
    end;
    if v_acl_entries is distinct from v_expected_acl then
      raise exception 'agent_deck_geometry_acl_invalid: %',
        v_signature using errcode = '55000';
    end if;
  end loop;
end;
$postflight$;

commit;
