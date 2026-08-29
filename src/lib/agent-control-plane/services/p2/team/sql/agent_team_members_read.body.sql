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
      ('function', 'extensions.digest(bytea,text)'),
      ('table', 'private.agent_read_domain_revisions'),
      ('table', 'private.mcp_oauth_clients'),
      ('table', 'private.mcp_oauth_grants'),
      ('table', 'public.companies'),
      ('table', 'public.users')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_team_members_read_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;
end;
$prerequisites$;

drop function if exists public.read_agent_team_members_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],
  text,integer,integer,integer,timestamp with time zone,jsonb,text,uuid
);
drop function if exists private.agent_p2_team_summary_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,integer,integer,
  integer,timestamp with time zone,jsonb,text,uuid
);

create or replace function private.agent_p2_team_summary_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_required_oauth_scopes text[],
  p_team_scope text,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer,
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
    raise exception 'invalid_agent_team_members_request'
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
     or p_team_scope is distinct from 'all'
     or p_item_limit is null
     or p_item_limit not between 1 and 25
     or p_page_fetch_limit is distinct from p_item_limit + 1
     or p_page_fetch_limit not between 2 and 26
     or p_source_limit is distinct from 501
     or p_cursor_source_revisions is null
     or pg_catalog.jsonb_typeof(p_cursor_source_revisions) <> 'array'
     or (p_cursor_read_at is null) is distinct from
       (p_cursor_source_revisions = '[]'::jsonb)
     or (p_cursor_read_at is null) is distinct from
       (p_after_display_name is null)
     or (p_cursor_read_at is null) is distinct from
       (p_after_member_id is null)
     or p_cursor_read_at is not null and (
       p_cursor_read_at is distinct from pg_catalog.date_trunc(
         'milliseconds',
         p_cursor_read_at
       )
       or p_cursor_read_at > pg_catalog.statement_timestamp()
       or p_cursor_read_at <=
         pg_catalog.statement_timestamp() - interval '15 minutes'
     )
     or p_after_display_name is not null and (
       private.agent_p2_optional_canonical_text(
         p_after_display_name,
         256,
         1024,
         false
       ) is distinct from p_after_display_name
     ) then
    raise exception 'invalid_agent_team_members_request'
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
  or not ('team.view' = any(p_registered_permission_keys)) then
    raise exception 'invalid_agent_team_members_request'
      using errcode = '22023';
  end if;

  v_read_at := coalesce(
    p_cursor_read_at,
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp())
  );

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           pg_catalog.max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'team.view'
           ) as team_scope
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
    select company_revision.source_revision as company_revision,
           team_revision.source_revision as team_revision,
           authority.team_scope,
           v_read_at as read_at
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
    join private.agent_read_domain_revisions company_revision
      on company_revision.company_id = p_company_id
     and company_revision.domain = 'company'
     and company_revision.source_revision between 0 and 9007199254740991
    join private.agent_read_domain_revisions team_revision
      on team_revision.company_id = p_company_id
     and team_revision.domain = 'team'
     and team_revision.source_revision between 0 and 9007199254740991
    where authority.permission_snapshot_revision =
            p_permission_snapshot_revision
      and authority.team_scope = p_team_scope
  ), cursor_guard as materialized (
    select context.*,
           pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object(
               'domain', 'company',
               'source_revision', context.company_revision
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
           'domain', 'company',
           'source_revision', context.company_revision
         ),
         pg_catalog.jsonb_build_object(
           'domain', 'team',
           'source_revision', context.team_revision
         )
       )
  ), source_gate as materialized (
    select member.id as member_id,
           private.agent_p2_optional_canonical_text(
             pg_catalog.btrim(member.first_name) || ' ' ||
               pg_catalog.btrim(member.last_name),
             256,
             1024,
             false
           ) as display_name,
           case
             when member.profile_image_url is null then null
             else private.agent_p2_optional_canonical_text(
               member.profile_image_url,
               2048,
               8192,
               false
             )
           end as display_image_url,
           case
             when pg_catalog.btrim(coalesce(member.user_color, '')) ~
                    '^#[0-9A-Fa-f]{6}$'
               then pg_catalog.upper(pg_catalog.btrim(member.user_color))
             else null
           end as display_color,
           case
             when pg_catalog.btrim(coalesce(member.role, '')) = ''
               then 'unassigned'
             when pg_catalog.lower(pg_catalog.btrim(member.role)) = 'admin'
               then 'office'
             else pg_catalog.lower(pg_catalog.btrim(member.role))
           end as team_label
    from cursor_guard context
    join public.users member
      on member.company_id = p_company_id
     and member.deleted_at is null
     and member.is_active is true
    order by private.agent_p2_optional_canonical_text(
               pg_catalog.btrim(member.first_name) || ' ' ||
                 pg_catalog.btrim(member.last_name),
               256,
               1024,
               false
             ) collate "C",
             member.id
    limit 501
  ), source_state as materialized (
    select pg_catalog.count(*)::integer as inspected,
           pg_catalog.count(*) >= 501 as exceeded,
           coalesce(pg_catalog.bool_or(
             source.display_name is null
             or source.team_label not in (
               'crew', 'office', 'operator', 'owner', 'unassigned'
             )
           ), false) as source_invalid
    from source_gate source
  ), cursor_filtered as materialized (
    select source.*
    from source_gate source
    cross join source_state state
    where not state.exceeded
      and not state.source_invalid
      and (
        p_after_member_id is null
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
    from cursor_filtered source
    order by source.display_name collate "C", source.member_id
    limit p_page_fetch_limit
  ), retained_page as materialized (
    select source.*
    from page_plus_one source
    order by source.display_name collate "C", source.member_id
    limit p_item_limit
  ), row_projection as materialized (
    select retained.member_id,
           retained.display_name,
           pg_catalog.jsonb_build_object(
             'member_ref', pg_catalog.jsonb_build_object(
               'kind', 'team_member',
               'id', retained.member_id
             ),
             'display_name', retained.display_name,
             'state', 'active',
             'display_image', case
               when retained.display_image_url ~
                 '^https://[^/@[:space:]]+(/[^#[:space:]]*)?$'
                 then pg_catalog.jsonb_build_object(
                   'state', 'available',
                   'url', retained.display_image_url
                 )
               else pg_catalog.jsonb_build_object(
                 'state', 'unavailable'
               )
             end,
             'display_color', retained.display_color,
             'team_label', retained.team_label,
             'content_kind', 'untrusted_business_data'
           ) as item
    from retained_page retained
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
             'capability_id', 'list_team_members',
             'capability_revision', 'list_team_members:2026-08-22.v1',
             'capability_manifest_revision',
               '2026-08-22.capability-manifest.v8',
             'ranking_revision', 'team-member-order:2026-08-22.v1',
             'required_oauth_scopes',
               pg_catalog.to_jsonb(p_required_oauth_scopes),
             'team_scope', p_team_scope,
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
             'source_inspected', state.inspected,
             'source_has_more', exists (
               select 1
               from page_plus_one page
               offset p_item_limit
               limit 1
             )
           ) as value
    from cursor_guard context
    cross join source_state state
  ), packaged_rows as materialized (
    select row.item,
           row.display_name,
           row.member_id,
           'ops_proof:v1:' || pg_catalog.encode(
             extensions.digest(
               pg_catalog.convert_to(
                 private.canonical_agent_projection_json(
                   context.value || pg_catalog.jsonb_build_object(
                     'proof_kind', 'team_member_entity',
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
                     'proof_kind', 'team_member_evidence',
                     'member_ref', pg_catalog.jsonb_build_object(
                       'kind', 'team_member',
                       'id', row.member_id
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
                 'proof_ref', row.proof_ref,
                 'evidence_ref', row.evidence_ref,
                 'predecessor', pg_catalog.jsonb_build_object(
                   'order', pg_catalog.jsonb_build_array(
                     row.display_name,
                     row.member_id
                   ),
                   'tie_breaker', row.member_id
                 )
               ) order by row.display_name collate "C", row.member_id
             ),
             '[]'::jsonb
           ) as rows
    from packaged_rows row
  ), collection_proof_input as materialized (
    select context.value || pg_catalog.jsonb_build_object(
             'proof_kind', 'team_member_collection',
             'returned_count', pg_catalog.count(row.member_id)::integer,
             'has_more', (context.value ->> 'source_has_more')::boolean,
             'children', coalesce(
               pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'member_ref', pg_catalog.jsonb_build_object(
                     'kind', 'team_member',
                     'id', row.member_id
                   ),
                   'proof_ref', row.proof_ref,
                   'evidence_ref', row.evidence_ref
                 ) order by row.display_name collate "C", row.member_id
               ) filter (where row.member_id is not null),
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
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'capability_id', 'list_team_members',
             'capability_revision', 'list_team_members:2026-08-22.v1',
             'capability_manifest_revision',
               '2026-08-22.capability-manifest.v8',
             'ranking_revision', 'team-member-order:2026-08-22.v1',
             'required_oauth_scopes',
               pg_catalog.to_jsonb(p_required_oauth_scopes),
             'team_scope', p_team_scope,
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
             'source_inspected', state.inspected,
             'source_has_more', exists (
               select 1
               from page_plus_one page
               offset p_item_limit
               limit 1
             ),
             'rows', aggregate.rows,
             'collection_proof_ref', 'ops_proof:v1:' ||
               pg_catalog.encode(
                 extensions.digest(
                   pg_catalog.convert_to(
                     private.canonical_agent_projection_json(proof.value),
                     'UTF8'
                   ),
                   'sha256'
                 ),
                 'hex'
               ),
             '_source_bound', state.exceeded,
             '_source_invalid', state.source_invalid
           ) as projection
    from cursor_guard context
    cross join source_state state
    cross join aggregate_rows aggregate
    cross join collection_proof_input proof
  )
  select projection into v_result
  from final_projection;

  if v_result is null then
    if p_cursor_read_at is not null then
      raise exception 'agent_team_snapshot_stale' using errcode = '40001';
    end if;
    raise exception 'agent_team_not_authorized' using errcode = '42501';
  end if;
  if (v_result ->> '_source_bound')::boolean then
    raise exception 'agent_team_source_query_bound' using errcode = '54000';
  end if;
  if (v_result ->> '_source_invalid')::boolean then
    raise exception 'agent_team_source_data_invalid' using errcode = '22000';
  end if;

  return v_result - array['_source_bound', '_source_invalid'];
end;
$function$;

revoke all on function private.agent_p2_team_summary_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,integer,integer,
  integer,timestamp with time zone,jsonb,text,uuid
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_team_members_as_system(
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
  p_team_scope text,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer,
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
     or p_capability_id is distinct from 'list_team_members'
     or p_capability_revision is distinct from
       'list_team_members:2026-08-22.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-22.capability-manifest.v8' then
    raise exception 'invalid_agent_team_members_request'
      using errcode = '22023';
  end if;

  return private.agent_p2_team_summary_v1(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_required_oauth_scopes,
    p_team_scope,
    p_item_limit,
    p_page_fetch_limit,
    p_source_limit,
    p_cursor_read_at,
    p_cursor_source_revisions,
    p_after_display_name,
    p_after_member_id
  );
end;
$function$;

revoke all on function public.read_agent_team_members_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],
  text,integer,integer,integer,timestamp with time zone,jsonb,text,uuid
) from public, anon, authenticated, service_role;

alter function private.agent_p2_team_summary_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,integer,integer,
  integer,timestamp with time zone,jsonb,text,uuid
) owner to current_user;
alter function public.read_agent_team_members_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],
  text,integer,integer,integer,timestamp with time zone,jsonb,text,uuid
) owner to current_user;

do $canonical_acl$
declare
  v_signature text;
  v_function_oid oid;
  v_acl record;
begin
  foreach v_signature in array array[
    'private.agent_p2_team_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)',
    'public.read_agent_team_members_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)'
  ]::text[] loop
    v_function_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    if v_function_oid is null then
      raise exception 'agent_team_acl_function_missing:%', v_signature;
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
        raise exception 'agent_team_acl_role_missing:%', v_signature;
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

grant execute on function public.read_agent_team_members_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],
  text,integer,integer,integer,timestamp with time zone,jsonb,text,uuid
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
    and function_row.proname = 'agent_p2_team_summary_v1'
  ) or (
    namespace.nspname = 'public'
    and function_row.proname = 'read_agent_team_members_as_system'
  );

  if v_actual_signatures is distinct from array[
    'private.agent_p2_team_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)',
    'public.read_agent_team_members_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)'
  ]::text[] then
    raise exception 'agent_team_function_signature_set_failed';
  end if;

  for v_expected in
    select *
    from (values
      (
        'private.agent_p2_team_summary_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)',
        false,
        false
      ),
      (
        'public.read_agent_team_members_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)',
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
      raise exception 'agent_team_function_shape_failed:%',
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
      raise exception 'agent_team_function_acl_failed:%',
        v_expected.signature;
    end if;
  end loop;
end;
$postflight$;

commit;
