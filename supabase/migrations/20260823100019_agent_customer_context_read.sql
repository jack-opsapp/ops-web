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
      ('function', 'private.agent_user_can_access_entity(uuid,uuid,text,uuid,text)'),
      ('function', 'private.agent_normalize_discovery_email(text)'),
      ('function', 'private.agent_normalize_discovery_phone(text)'),
      ('function', 'private.agent_p2_optional_canonical_text(text,integer,integer,boolean)'),
      ('function', 'private.agent_rfc3339_utc(timestamp with time zone)'),
      ('function', 'private.canonical_agent_projection_json(jsonb)'),
      ('function', 'private.mcp_oauth_labels_for_scopes(text[],text)'),
      ('table', 'private.agent_read_domain_revisions'),
      ('table', 'private.agent_operational_read_revisions'),
      ('table', 'private.agent_contactability_address_revisions'),
      ('table', 'private.mcp_oauth_clients'),
      ('table', 'private.mcp_oauth_grants'),
      ('table', 'public.companies'),
      ('table', 'public.clients'),
      ('table', 'public.sub_clients'),
      ('table', 'public.duplicate_reviews'),
      ('table', 'public.opportunities'),
      ('table', 'public.projects'),
      ('table', 'public.project_tasks'),
      ('table', 'public.email_suppressions')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_customer_context_read_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;
end;
$prerequisites$;

drop function if exists public.read_agent_customer_context_as_system(
  text, uuid, uuid, text, text[], text, text, text, text[], text, text,
  text, text, uuid, text[], text, text[], integer, integer
);
drop function if exists private.agent_p2_customer_summary_v1(
  uuid, uuid, text, text[], text, text, text, text, uuid, text[], text,
  text[], timestamptz, integer, integer
);

create or replace function private.agent_p2_customer_summary_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_required_oauth_scopes text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_clients_scope text,
  p_pipeline_scope text,
  p_projects_scope text,
  p_customer_kind text,
  p_customer_id uuid,
  p_sections text[],
  p_contact_purpose text,
  p_job_kinds text[],
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
  v_expected_oauth_scopes text[];
  v_projection jsonb;
  v_contact_raw_source_count integer := 0;
  v_duplicate_raw_source_count integer := 0;
  v_opportunity_raw_source_count integer := 0;
  v_project_raw_source_count integer := 0;
  v_contact_returned_count integer := 0;
  v_duplicate_returned_count integer := 0;
  v_source_data_invalid boolean := false;
  v_canonical_conflict boolean := false;
begin
  if auth.role() is distinct from 'service_role'
     or p_actor_user_id is null
     or p_company_id is null
     or p_oauth_grant_id is null
     or p_oauth_client_id is null
     or p_grant_revision is null
     or p_grant_revision !~ '^[0-9a-f]{32}$'
     or p_granted_scope_ceiling is null
     or pg_catalog.cardinality(p_granted_scope_ceiling) not between 1 and 32
     or p_required_oauth_scopes is null
     or pg_catalog.cardinality(p_required_oauth_scopes) not between 1 and 3
     or p_permission_snapshot_revision is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_registered_permission_keys is null
     or p_clients_scope not in ('all', 'assigned')
     or p_pipeline_scope is not null
        and p_pipeline_scope not in ('all', 'assigned')
     or p_projects_scope is not null
        and p_projects_scope not in ('all', 'assigned')
     or p_customer_kind not in ('client', 'sub_client')
     or p_customer_id is null
     or p_sections is null
     or pg_catalog.cardinality(p_sections) not between 1 and 7
     or p_sections <@ array[
       'business_address',
       'business_notes',
       'contacts',
       'duplicate_state',
       'job_rollup',
       'preferences',
       'profile'
     ]::text[] is not true
     or (
       select pg_catalog.count(distinct requested.section)
       from pg_catalog.unnest(p_sections) requested(section)
     ) <> pg_catalog.cardinality(p_sections)
     or p_sections is distinct from (
       select pg_catalog.array_agg(requested.section order by requested.section)
       from pg_catalog.unnest(p_sections) requested(section)
     )
     or p_job_kinds is null
     or pg_catalog.cardinality(p_job_kinds) not between 0 and 2
     or p_job_kinds <@ array['opportunity', 'project']::text[] is not true
     or (
       select pg_catalog.count(distinct requested.kind)
       from pg_catalog.unnest(p_job_kinds) requested(kind)
     ) <> pg_catalog.cardinality(p_job_kinds)
     or p_job_kinds is distinct from coalesce((
       select pg_catalog.array_agg(requested.kind order by requested.kind)
       from pg_catalog.unnest(p_job_kinds) requested(kind)
     ), array[]::text[])
     or ('contacts' = any(p_sections)) is distinct from
       (p_contact_purpose is not null)
     or p_contact_purpose is not null
        and p_contact_purpose not in ('communication', 'scheduling')
     or ('job_rollup' = any(p_sections)) is distinct from
       (pg_catalog.cardinality(p_job_kinds) > 0)
     or ('opportunity' = any(p_job_kinds)) is distinct from
       (p_pipeline_scope is not null)
     or ('project' = any(p_job_kinds)) is distinct from
       (p_projects_scope is not null)
     or p_read_at is null
     or not pg_catalog.isfinite(p_read_at)
     or p_read_at is distinct from pg_catalog.date_trunc(
       'milliseconds',
       p_read_at
     )
     or p_read_at is distinct from pg_catalog.date_trunc(
       'milliseconds',
       pg_catalog.statement_timestamp()
     )
     or p_source_limit is distinct from 501
     or p_item_limit is distinct from 25 then
    raise exception 'invalid_agent_customer_context_summary_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(p_granted_scope_ceiling) granted(scope)
    where granted.scope is null
       or granted.scope is distinct from pg_catalog.btrim(granted.scope)
       or pg_catalog.octet_length(granted.scope) not between 1 and 128
  ) or p_granted_scope_ceiling is distinct from (
    select pg_catalog.array_agg(granted.scope order by granted.scope)
    from (
      select distinct source.scope
      from pg_catalog.unnest(p_granted_scope_ceiling) source(scope)
    ) granted
  ) or exists (
    select 1
    from pg_catalog.unnest(p_required_oauth_scopes) required(scope)
    where required.scope is null
       or required.scope is distinct from pg_catalog.btrim(required.scope)
       or pg_catalog.octet_length(required.scope) not between 1 and 128
  ) or p_required_oauth_scopes is distinct from (
    select pg_catalog.array_agg(required.scope order by required.scope)
    from (
      select distinct source.scope
      from pg_catalog.unnest(p_required_oauth_scopes) source(scope)
    ) required
  ) or p_required_oauth_scopes <@ p_granted_scope_ceiling is not true then
    raise exception 'invalid_agent_customer_context_summary_request'
      using errcode = '22023';
  end if;

  select pg_catalog.array_agg(requested.scope order by requested.scope)
  into v_expected_oauth_scopes
  from (
    select 'ops.customers.read'::text as scope
    union all
    select 'ops.customer_contacts.read'
    where 'contacts' = any(p_sections)
    union all
    select 'ops.jobs.read'
    where 'job_rollup' = any(p_sections)
  ) requested;
  if p_required_oauth_scopes is distinct from v_expected_oauth_scopes then
    raise exception 'invalid_agent_customer_context_summary_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(p_registered_permission_keys)
      registry(permission_key)
    where registry.permission_key is null
       or registry.permission_key is distinct from
         pg_catalog.btrim(registry.permission_key)
       or pg_catalog.octet_length(registry.permission_key)
         not between 1 and 128
  ) or (
    select pg_catalog.count(distinct registry.permission_key)
    from pg_catalog.unnest(p_registered_permission_keys)
      registry(permission_key)
  ) <> pg_catalog.cardinality(p_registered_permission_keys)
  or p_registered_permission_keys is distinct from coalesce((
    select pg_catalog.array_agg(
      registry.permission_key order by registry.permission_key
    )
    from pg_catalog.unnest(p_registered_permission_keys)
      registry(permission_key)
  ), array[]::text[])
  or not ('clients.view' = any(p_registered_permission_keys))
  or 'opportunity' = any(p_job_kinds)
     and not ('pipeline.view' = any(p_registered_permission_keys))
  or 'project' = any(p_job_kinds)
     and not ('projects.view' = any(p_registered_permission_keys)) then
    raise exception 'invalid_agent_customer_context_summary_request'
      using errcode = '22023';
  end if;

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           pg_catalog.max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'clients.view'
           ) as clients_scope,
           pg_catalog.max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'pipeline.view'
           ) as pipeline_scope,
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
  ), authority_context as materialized (
    select customer_revision.source_revision as customer_revision,
           operational_revision.source_revision as operational_revision
    from current_authority authority
    join public.companies company
      on company.id = p_company_id
     and company.deleted_at is null
    join private.mcp_oauth_grants oauth_grant
      on oauth_grant.id = p_oauth_grant_id
     and oauth_grant.user_id = p_actor_user_id
     and oauth_grant.company_id = p_company_id
     and oauth_grant.client_id = p_oauth_client_id
     and oauth_grant.revision = p_grant_revision
     and oauth_grant.scopes = p_granted_scope_ceiling
     and oauth_grant.revoked_at is null
     and p_required_oauth_scopes <@ oauth_grant.scopes
     and oauth_grant.accepted_labels =
       private.mcp_oauth_labels_for_scopes(
         oauth_grant.scopes,
         oauth_grant.consent_catalog_revision
       )
    join private.mcp_oauth_clients oauth_client
      on oauth_client.client_id = oauth_grant.client_id
     and oauth_client.disabled_at is null
     and oauth_grant.scopes <@ oauth_client.scope_ceiling
     and oauth_grant.consent_catalog_revision =
       oauth_client.consent_catalog_revision
     and oauth_grant.exposure_revision = oauth_client.exposure_revision
    join private.agent_read_domain_revisions customer_revision
      on customer_revision.company_id = p_company_id
     and customer_revision.domain = 'customer'
     and customer_revision.source_revision between 0 and 9007199254740991
    left join private.agent_operational_read_revisions operational_revision
      on operational_revision.company_id = p_company_id
     and operational_revision.source_revision between 0 and 9007199254740991
    where authority.permission_snapshot_revision =
            p_permission_snapshot_revision
      and authority.clients_scope = p_clients_scope
      and (
        p_pipeline_scope is null
        or authority.pipeline_scope = p_pipeline_scope
      )
      and (
        p_projects_scope is null
        or authority.projects_scope = p_projects_scope
      )
      and (
        not ('job_rollup' = any(p_sections))
        or operational_revision.source_revision is not null
      )
  ), selected_customer as materialized (
    select client.id as parent_client_id,
           client.name as parent_name,
           case when 'business_address' = any(p_sections)
             then client.address else null end as parent_address,
           case when 'contacts' = any(p_sections)
             then client.email else null end as parent_email,
           case when 'contacts' = any(p_sections)
             then client.phone_number else null end as parent_phone,
           case when 'business_notes' = any(p_sections)
             then client.notes else null end as parent_notes,
           sub_client.id as selected_sub_client_id,
           sub_client.name as selected_sub_client_name,
           case when 'business_address' = any(p_sections)
             then sub_client.address else null end
             as selected_sub_client_address,
           sub_client.title as selected_sub_client_title
    from authority_context authority
    join public.clients client
      on client.company_id = p_company_id
     and client.deleted_at is null
     and client.merged_into_client_id is null
     and (
       p_customer_kind = 'client' and client.id = p_customer_id
       or p_customer_kind = 'sub_client'
     )
    left join public.sub_clients sub_client
      on p_customer_kind = 'sub_client'
     and sub_client.id = p_customer_id
     and sub_client.company_id = p_company_id
     and sub_client.client_id = client.id
     and sub_client.deleted_at is null
    where (
      p_clients_scope = 'all'
      or p_clients_scope = 'assigned' and exists (
        select 1
        from public.projects assigned_project
        join public.project_tasks assigned_task
          on assigned_task.project_id = assigned_project.id
         and assigned_task.company_id = p_company_id
         and assigned_task.deleted_at is null
         and assigned_task.team_member_ids @>
           array[p_actor_user_id::text]
        where assigned_project.company_id = p_company_id
          and assigned_project.deleted_at is null
          and assigned_project.client_id = client.id
      )
    )
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'client',
        client.id,
        'view'
      )
      and (
        p_customer_kind = 'client'
        or sub_client.id is not null and
          private.agent_user_can_access_entity(
            p_actor_user_id,
            p_company_id,
            'sub_client',
            sub_client.id,
            'view'
          )
      )
  ), contact_raw_source_gate as materialized (
    select source.*
    from (
      select 0 as relationship_rank,
             'client'::text as contact_kind,
             customer.parent_client_id as contact_id,
             customer.parent_name as display_name,
             null::text as title,
             customer.parent_email as email,
             customer.parent_phone as phone
      from selected_customer customer
      where 'contacts' = any(p_sections)

      union all

      select 1,
             'sub_client',
             sub_client.id,
             sub_client.name,
             sub_client.title,
             sub_client.email,
             sub_client.phone_number
      from selected_customer customer
      join public.sub_clients sub_client
        on sub_client.company_id = p_company_id
       and sub_client.client_id = customer.parent_client_id
       and sub_client.deleted_at is null
      where 'contacts' = any(p_sections)
    ) source
    order by source.relationship_rank, source.contact_id
    limit p_source_limit
  ), contact_raw_source_state as materialized (
    select pg_catalog.count(*)::integer as source_count
    from contact_raw_source_gate
  ), contact_authorized as materialized (
    select source.*,
           private.agent_p2_optional_canonical_text(
             source.display_name,
             256,
             1024,
             false
           ) as safe_display_name,
           private.agent_p2_optional_canonical_text(
             source.title,
             256,
             1024,
             false
           ) as safe_title,
           private.agent_normalize_discovery_email(source.email)
             as normalized_email,
           private.agent_normalize_discovery_phone(source.phone)
             as normalized_phone
    from contact_raw_source_gate source
    join contact_raw_source_state raw_state
      on raw_state.source_count < p_source_limit
    where source.contact_kind = 'client'
       or private.agent_user_can_access_entity(
         p_actor_user_id,
         p_company_id,
         'sub_client',
         source.contact_id,
         'view'
       )
  ), contact_duplicates as materialized (
    select contact.*,
           pg_catalog.count(*) filter (
             where contact.normalized_email is not null
           ) over (
             partition by contact.normalized_email
           )::integer as visible_owner_count,
           pg_catalog.count(*) filter (
             where contact.normalized_phone is not null
           ) over (
             partition by contact.normalized_phone
           )::integer as visible_phone_owner_count,
           case when contact.normalized_email is null then null else
             'sha256:' || pg_catalog.encode(
               extensions.digest(
                 pg_catalog.convert_to(contact.normalized_email, 'UTF8'),
                 'sha256'
               ),
               'hex'
             )
           end as address_sha256
    from contact_authorized contact
  ), contact_selector_gate as materialized (
    select contact.*
    from contact_duplicates contact
    order by contact.relationship_rank, contact.contact_id
    limit p_item_limit + 1
  ), contact_detail_gate as materialized (
    select contact.*,
           exists(
             select 1
             from public.email_suppressions suppression
             where pg_catalog.lower(pg_catalog.btrim(suppression.email)) =
                     contact.normalized_email
               and suppression.list = 'global'
               and (
                 suppression.expires_at is null
                 or suppression.expires_at > p_read_at
               )
           ) as suppressed,
           coalesce(revision.source_revision, 0)::bigint
             as contactability_revision
    from contact_selector_gate contact
    left join private.agent_contactability_address_revisions revision
      on revision.address_sha256 = contact.address_sha256
  ), contact_retained as materialized (
    select contact.*
    from contact_detail_gate contact
    order by contact.relationship_rank, contact.contact_id
    limit p_item_limit
  ), contact_package as materialized (
    select (select pg_catalog.count(*)::integer
              from contact_retained) as returned_count,
           (select pg_catalog.count(*) > p_item_limit
              from contact_selector_gate) as source_has_more,
           coalesce((
             select pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'contact_ref', pg_catalog.jsonb_build_object(
                   'kind', contact.contact_kind,
                   'id', contact.contact_id
                 ),
                 'relationship', case contact.contact_kind
                   when 'client' then 'primary_client'
                   else 'sub_client'
                 end,
                 'display_name', contact.safe_display_name,
                 'title', contact.safe_title,
                 'email', case
                   when contact.normalized_email is null then
                     pg_catalog.jsonb_build_object('state', 'unavailable')
                   when contact.visible_owner_count > 1 then
                     pg_catalog.jsonb_build_object('state', 'ambiguous')
                   when contact.suppressed then
                     pg_catalog.jsonb_build_object('state', 'blocked')
                   else pg_catalog.jsonb_build_object(
                     'state', 'contactable',
                     'address', contact.normalized_email
                   )
                 end,
                 'phone', case
                   when contact.normalized_phone is null then
                     pg_catalog.jsonb_build_object('state', 'unavailable')
                   when contact.visible_phone_owner_count > 1 then
                     pg_catalog.jsonb_build_object('state', 'ambiguous')
                   else pg_catalog.jsonb_build_object(
                     'state', 'available',
                     'number', contact.normalized_phone
                   )
                 end,
                 'content_kind', 'untrusted_business_data'
               ) order by contact.relationship_rank, contact.contact_id
             )
             from contact_retained contact
           ),
             '[]'::jsonb
           ) as contacts,
           'sha256:' || pg_catalog.encode(
             extensions.digest(
               pg_catalog.convert_to(
                 private.canonical_agent_projection_json(
                   coalesce((
                     select pg_catalog.jsonb_agg(
                       pg_catalog.jsonb_build_object(
                         'address_sha256', contact.address_sha256,
                         'suppressed', contact.suppressed,
                         'source_revision',
                           contact.contactability_revision
                       ) order by contact.relationship_rank,
                         contact.contact_id
                     )
                     from contact_detail_gate contact
                     where contact.address_sha256 is not null
                   ),
                     '[]'::jsonb
                   )
                 ),
                 'UTF8'
               ),
               'sha256'
             ),
             'hex'
           ) as contactability_digest,
           coalesce(
             (select pg_catalog.max(contact.contactability_revision)
                from contact_detail_gate contact),
             0
           )::bigint as contactability_revision,
           coalesce(
             (select pg_catalog.bool_or(
                contact.safe_display_name is null
                or nullif(
                  pg_catalog.btrim(contact.title),
                  ''
                ) is not null and contact.safe_title is null
              )
              from contact_retained contact),
             false
           ) as source_data_invalid
  ), duplicate_raw_source_gate as materialized (
    select review.id as review_id,
           candidate.id as candidate_id,
           candidate.name as candidate_name,
           review.confidence
    from selected_customer customer
    join public.duplicate_reviews review
      on review.company_id = p_company_id
     and review.entity_type = 'client'
     and review.status = 'pending'
     and customer.parent_client_id in (
       review.entity_a_id,
       review.entity_b_id
     )
    join public.clients candidate
      on candidate.company_id = p_company_id
     and candidate.id = case
       when review.entity_a_id = customer.parent_client_id
         then review.entity_b_id
       else review.entity_a_id
     end
     and candidate.deleted_at is null
     and candidate.merged_into_client_id is null
    where 'duplicate_state' = any(p_sections)
    order by case review.confidence when 'high' then 0 else 1 end,
      candidate.id,
      review.id
    limit p_source_limit
  ), duplicate_raw_source_state as materialized (
    select pg_catalog.count(*)::integer as source_count
    from duplicate_raw_source_gate
  ), duplicate_authorized as materialized (
    select source.*,
           pg_catalog.count(*) over (
             partition by source.candidate_id
           )::integer as visible_candidate_count
    from duplicate_raw_source_gate source
    join duplicate_raw_source_state raw_state
      on raw_state.source_count < p_source_limit
    where (
        p_clients_scope = 'all'
        or exists (
          select 1
          from public.projects candidate_project
          join public.project_tasks candidate_task
            on candidate_task.project_id = candidate_project.id
           and candidate_task.company_id = p_company_id
           and candidate_task.deleted_at is null
           and candidate_task.team_member_ids @>
             array[p_actor_user_id::text]
          where candidate_project.company_id = p_company_id
            and candidate_project.deleted_at is null
            and candidate_project.client_id = source.candidate_id
        )
      )
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'client',
        source.candidate_id,
        'view'
      )
  ), duplicate_selector_gate as materialized (
    select duplicate.*
    from duplicate_authorized duplicate
    order by case duplicate.confidence when 'high' then 0 else 1 end,
      duplicate.candidate_id,
      duplicate.review_id
    limit p_item_limit + 1
  ), duplicate_detail_gate as materialized (
    select duplicate.*,
           private.agent_p2_optional_canonical_text(
             duplicate.candidate_name,
             256,
             1024,
             false
           ) as safe_candidate_name
    from duplicate_selector_gate duplicate
  ), duplicate_retained as materialized (
    select duplicate.*
    from duplicate_detail_gate duplicate
    order by case duplicate.confidence when 'high' then 0 else 1 end,
      duplicate.candidate_id,
      duplicate.review_id
    limit p_item_limit
  ), duplicate_package as materialized (
    select (select pg_catalog.count(*)::integer
              from duplicate_retained) as returned_count,
           (select pg_catalog.count(*) > p_item_limit
              from duplicate_selector_gate) as source_has_more,
           coalesce((
             select pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'customer_ref', pg_catalog.jsonb_build_object(
                   'kind', 'client',
                   'id', duplicate.candidate_id
                 ),
                 'display_name', duplicate.safe_candidate_name,
                 'confidence', duplicate.confidence,
                 'content_kind', 'untrusted_business_data'
               ) order by case duplicate.confidence
                 when 'high' then 0 else 1 end,
               duplicate.candidate_id,
               duplicate.review_id
             )
             from duplicate_retained duplicate
           ),
             '[]'::jsonb
           ) as candidates,
           coalesce(
             (select pg_catalog.bool_or(
                duplicate.safe_candidate_name is null
                or duplicate.confidence is null
                or duplicate.confidence not in ('high', 'medium')
                or duplicate.visible_candidate_count <> 1
              )
              from duplicate_retained duplicate),
             false
           ) as source_data_invalid
  ), opportunity_raw_source_gate as materialized (
    select opportunity.id as raw_job_id,
           opportunity.stage as status,
           coalesce(
             opportunity.project_ref,
             opportunity.project_id
           ) as linked_project_id,
           opportunity.client_ref,
           opportunity.client_id,
           opportunity.project_ref,
           opportunity.project_id
    from selected_customer customer
    join public.opportunities opportunity
      on opportunity.company_id = p_company_id
     and opportunity.deleted_at is null
     and opportunity.merged_into_opportunity_id is null
     and coalesce(
       opportunity.client_ref,
       opportunity.client_id
     ) = customer.parent_client_id
    where 'opportunity' = any(p_job_kinds)
    order by opportunity.updated_at desc, opportunity.id desc
    limit p_source_limit
  ), opportunity_raw_source_state as materialized (
    select pg_catalog.count(*)::integer as source_count
    from opportunity_raw_source_gate
  ), opportunity_authorized as materialized (
    select opportunity.*,
           opportunity.client_ref is not null
             and opportunity.client_id is not null
             and opportunity.client_ref is distinct from opportunity.client_id
             as client_mirror_conflict,
           opportunity.project_ref is not null
             and opportunity.project_id is not null
             and opportunity.project_ref is distinct from
               opportunity.project_id as project_mirror_conflict,
           opportunity.status not in (
             'new_lead',
             'qualifying',
             'quoting',
             'quoted',
             'follow_up',
             'negotiation',
             'won',
             'lost',
             'discarded'
           ) as source_data_invalid
    from opportunity_raw_source_gate opportunity
    join opportunity_raw_source_state raw_state
      on raw_state.source_count < p_source_limit
    where private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'opportunity',
        opportunity.raw_job_id,
        'view'
      )
  ), project_raw_source_gate as materialized (
    select project.id as raw_job_id,
           project.status,
           coalesce(
             project.opportunity_ref,
             project.opportunity_id
           ) as linked_opportunity_id,
           project.opportunity_ref,
           project.opportunity_id,
           project.client_id
    from selected_customer customer
    join public.projects project
      on project.company_id = p_company_id
     and project.client_id = customer.parent_client_id
     and project.deleted_at is null
    where 'project' = any(p_job_kinds)
    order by project.updated_at desc, project.id desc
    limit p_source_limit
  ), project_raw_source_state as materialized (
    select pg_catalog.count(*)::integer as source_count
    from project_raw_source_gate
  ), project_authorized as materialized (
    select project.*,
           project.opportunity_ref is not null
             and project.opportunity_id is not null
             and project.opportunity_ref is distinct from
               project.opportunity_id as opportunity_mirror_conflict,
           project.status not in (
             'rfq',
             'estimated',
             'accepted',
             'in_progress',
             'completed',
             'closed',
             'archived'
           ) as source_data_invalid
    from project_raw_source_gate project
    join project_raw_source_state raw_state
      on raw_state.source_count < p_source_limit
    where private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'project',
        project.raw_job_id,
        'view'
      )
  ), raw_job_candidate as materialized (
    select case when project.raw_job_id is not null
             then 'project' else 'opportunity'
           end as canonical_job_kind,
           coalesce(
             project.raw_job_id,
             opportunity.raw_job_id
           ) as canonical_job_id,
           'opportunity'::text as raw_job_kind,
           opportunity.raw_job_id,
           coalesce(project.status, opportunity.status) as status,
           opportunity.source_data_invalid
             or coalesce(project.source_data_invalid, false)
             as source_data_invalid,
           opportunity.client_mirror_conflict
             or opportunity.project_mirror_conflict
             or coalesce(
               project.opportunity_mirror_conflict,
               false
             ) as canonical_conflict
    from opportunity_authorized opportunity
    left join project_authorized project
      on project.raw_job_id = opportunity.linked_project_id
     and project.linked_opportunity_id = opportunity.raw_job_id
     and project.client_id = coalesce(
       opportunity.client_ref,
       opportunity.client_id
     )

    union all

    select 'project',
           project.raw_job_id,
           'project',
           project.raw_job_id,
           project.status,
           project.source_data_invalid
             or coalesce(opportunity.source_data_invalid, false),
           project.opportunity_mirror_conflict
             or coalesce(
               opportunity.client_mirror_conflict,
               false
             )
             or coalesce(
               opportunity.project_mirror_conflict,
               false
             )
    from project_authorized project
    left join opportunity_authorized opportunity
      on opportunity.raw_job_id = project.linked_opportunity_id
     and opportunity.linked_project_id = project.raw_job_id
     and coalesce(
       opportunity.client_ref,
       opportunity.client_id
     ) = project.client_id
  ), ranked_job_candidate as materialized (
    select candidate.*,
           pg_catalog.row_number() over (
             partition by candidate.canonical_job_kind,
               candidate.canonical_job_id
             order by case candidate.raw_job_kind
               when 'project' then 0 else 1 end,
               candidate.raw_job_id
           ) as canonical_job_rank,
           pg_catalog.count(*) over (
             partition by candidate.canonical_job_kind,
               candidate.canonical_job_id
           )::integer as canonical_job_count
    from raw_job_candidate candidate
  ), canonical_job as materialized (
    select ranked.canonical_job_kind as job_kind,
           ranked.status
    from ranked_job_candidate ranked
    where canonical_job_rank = 1
      and not ranked.source_data_invalid
      and not ranked.canonical_conflict
  ), job_status_count as materialized (
    select job.job_kind,
           job.status,
           pg_catalog.count(*)::integer as status_count
    from canonical_job job
    group by job.job_kind, job.status
  ), job_package as materialized (
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'kind', requested.kind,
          'total_count', coalesce((
            select pg_catalog.sum(status.status_count)::integer
            from job_status_count status
            where status.job_kind = requested.kind
          ), 0),
          'status_counts', coalesce((
            select pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'status', status.status,
                'count', status.status_count
              ) order by status.status
            )
            from job_status_count status
            where status.job_kind = requested.kind
          ), '[]'::jsonb)
        ) order by requested.kind
      ),
      '[]'::jsonb
    ) as kinds
    from pg_catalog.unnest(p_job_kinds) requested(kind)
  ), projection_state as materialized (
    select authority.customer_revision,
           authority.operational_revision,
           customer.*,
           (select raw_state.source_count
              from contact_raw_source_state raw_state)
             as contact_raw_source_count,
           (select pg_catalog.count(*)::integer
              from contact_selector_gate)
             as contact_authorized_inspected_count,
           contact.returned_count as contact_returned_count,
           contact.source_has_more as contact_source_has_more,
           contact.contacts,
           contact.contactability_digest,
           contact.contactability_revision,
           contact.source_data_invalid as contact_data_invalid,
           (select raw_state.source_count
              from duplicate_raw_source_state raw_state)
             as duplicate_raw_source_count,
           (select pg_catalog.count(*)::integer
              from duplicate_selector_gate)
             as duplicate_authorized_inspected_count,
           duplicate.returned_count as duplicate_returned_count,
           duplicate.source_has_more as duplicate_source_has_more,
           duplicate.candidates,
           duplicate.source_data_invalid as duplicate_data_invalid,
           (select raw_state.source_count
              from opportunity_raw_source_state raw_state)
             as opportunity_raw_source_count,
           (select pg_catalog.count(*)::integer
              from opportunity_authorized)
             as opportunity_authorized_inspected_count,
           (select raw_state.source_count
              from project_raw_source_state raw_state)
             as project_raw_source_count,
           (select pg_catalog.count(*)::integer
              from project_authorized)
             as project_authorized_inspected_count,
           jobs.kinds as job_kinds,
           coalesce((
             select pg_catalog.bool_or(
               ranked.source_data_invalid
             )
             from ranked_job_candidate ranked
           ), false) as job_data_invalid,
           coalesce((
             select pg_catalog.bool_or(
               ranked.canonical_conflict
               or ranked.canonical_job_count > 2
             )
             from ranked_job_candidate ranked
           ), false) as canonical_conflict,
           private.agent_p2_optional_canonical_text(
             case when p_customer_kind = 'sub_client'
               then customer.selected_sub_client_name
               else customer.parent_name
             end,
             256,
             1024,
             false
           ) as safe_display_name,
           private.agent_p2_optional_canonical_text(
             customer.parent_name,
             256,
             1024,
             false
           ) as safe_parent_name,
           private.agent_p2_optional_canonical_text(
             case when 'business_address' = any(p_sections) then
               case when nullif(
                 pg_catalog.btrim(customer.selected_sub_client_address),
                 ''
               ) is not null then customer.selected_sub_client_address
               else customer.parent_address end
             else null end,
             1000,
             4000,
             true
           ) as safe_address,
           case when 'business_address' = any(p_sections) then
             case when nullif(
               pg_catalog.btrim(customer.selected_sub_client_address),
               ''
             ) is not null then customer.selected_sub_client_address
             else customer.parent_address end
           else null end as effective_address,
           private.agent_p2_optional_canonical_text(
             pg_catalog.left(customer.parent_notes, 2000),
             2000,
             8000,
             true
           ) as safe_notes
    from authority_context authority
    join selected_customer customer on true
    cross join contact_package contact
    cross join duplicate_package duplicate
    cross join job_package jobs
  ), final_projection as materialized (
    select state.*,
           pg_catalog.jsonb_build_object(
             'customer', pg_catalog.jsonb_build_object(
               'requested_ref', pg_catalog.jsonb_build_object(
                 'kind', p_customer_kind,
                 'id', p_customer_id
               ),
               'canonical_ref', pg_catalog.jsonb_build_object(
                 'kind', 'client',
                 'id', state.parent_client_id
               ),
               'relationship', case p_customer_kind
                 when 'client' then 'primary_client'
                 else 'sub_client_parent'
               end
             ),
             'sections',
               '{}'::jsonb
               || case when 'profile' = any(p_sections) then
                 pg_catalog.jsonb_build_object(
                   'profile', pg_catalog.jsonb_build_object(
                     'display_name', state.safe_display_name,
                     'parent_display_name', case p_customer_kind
                       when 'sub_client' then state.safe_parent_name
                       else null
                     end,
                     'content_kind', 'untrusted_business_data'
                   )
                 ) else '{}'::jsonb end
               || case when 'business_address' = any(p_sections) then
                 pg_catalog.jsonb_build_object(
                   'business_address', pg_catalog.jsonb_build_object(
                     'address', state.safe_address,
                     'content_kind', 'untrusted_business_data'
                   )
                 ) else '{}'::jsonb end
               || case when 'contacts' = any(p_sections) then
                 pg_catalog.jsonb_build_object(
                   'contacts', pg_catalog.jsonb_build_object(
                     'purpose', p_contact_purpose,
                     'source_count', state.contact_returned_count,
                     'source_has_more', state.contact_source_has_more,
                     'returned_count', state.contact_returned_count,
                     'result_budget_omitted_count', 0,
                     'contacts', state.contacts
                   )
                 ) else '{}'::jsonb end
               || case when 'preferences' = any(p_sections) then
                 pg_catalog.jsonb_build_object(
                   'preferences', pg_catalog.jsonb_build_object(
                     'communication', pg_catalog.jsonb_build_object(
                       'state', 'not_recorded'
                     ),
                     'scheduling', pg_catalog.jsonb_build_object(
                       'state', 'not_recorded'
                     )
                   )
                 ) else '{}'::jsonb end
               || case when 'duplicate_state' = any(p_sections) then
                 pg_catalog.jsonb_build_object(
                   'duplicate_state', pg_catalog.jsonb_build_object(
                     'state', case when state.duplicate_returned_count = 0
                       then 'clear' else 'review_required' end,
                     'source_count', state.duplicate_returned_count,
                     'source_has_more', state.duplicate_source_has_more,
                     'returned_count', state.duplicate_returned_count,
                     'result_budget_omitted_count', 0,
                     'candidates', state.candidates
                   )
                 ) else '{}'::jsonb end
               || case when 'business_notes' = any(p_sections) then
                 pg_catalog.jsonb_build_object(
                     'business_notes', pg_catalog.jsonb_build_object(
                       'notes', state.safe_notes,
                     'truncated', state.safe_notes is not null
                       and pg_catalog.char_length(state.parent_notes) > 2000,
                     'content_kind', 'untrusted_business_data'
                   )
                 ) else '{}'::jsonb end
               || case when 'job_rollup' = any(p_sections) then
                 pg_catalog.jsonb_build_object(
                   'job_rollup', pg_catalog.jsonb_build_object(
                     'kinds', state.job_kinds,
                     'content_kind', 'untrusted_business_data'
                   )
                 ) else '{}'::jsonb end
           ) as result,
           pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object(
               'domain', 'customer',
               'source_revision', state.customer_revision
             )
           )
           || case when 'job_rollup' = any(p_sections) then
             pg_catalog.jsonb_build_array(
               pg_catalog.jsonb_build_object(
                 'source_domain', 'operations',
                 'source_type', 'operational_read_revision',
                 'source_id',
                   'private.agent_operational_read_revisions',
                 'version', 'revision:' ||
                   state.operational_revision::text
               )
             ) else '[]'::jsonb end
           || case when 'contacts' = any(p_sections) then
             pg_catalog.jsonb_build_array(
               pg_catalog.jsonb_build_object(
                 'source_domain', 'operations',
                 'source_type', 'contactability_revision',
                 'source_id', state.contactability_digest,
                 'version', 'revision:' ||
                   state.contactability_revision::text
               )
             ) else '[]'::jsonb end as source_revisions
    from projection_state state
  )
  select pg_catalog.jsonb_build_object(
           'read_at', private.agent_rfc3339_utc(p_read_at),
           'source_revisions', final.source_revisions,
           'source_inspected', pg_catalog.jsonb_build_object(
             'contacts', final.contact_authorized_inspected_count,
             'duplicate_candidates',
               final.duplicate_authorized_inspected_count,
             'opportunities', final.opportunity_authorized_inspected_count,
             'projects', final.project_authorized_inspected_count
           ),
           'result', final.result
         ),
         final.contact_raw_source_count,
         final.duplicate_raw_source_count,
         final.opportunity_raw_source_count,
         final.project_raw_source_count,
         final.contact_returned_count,
         final.duplicate_returned_count,
         final.contact_data_invalid
           or final.duplicate_data_invalid
           or final.job_data_invalid
           or (
             'profile' = any(p_sections)
             and (
               final.safe_display_name is null
               or p_customer_kind = 'sub_client'
                  and final.safe_parent_name is null
             )
           )
           or (
             'business_address' = any(p_sections)
             and nullif(
               pg_catalog.btrim(final.effective_address),
               ''
             ) is not null
             and final.safe_address is null
           )
           or (
             'business_notes' = any(p_sections)
             and nullif(
               pg_catalog.btrim(final.parent_notes),
               ''
             ) is not null
             and final.safe_notes is null
           ),
         final.canonical_conflict
  into v_projection,
       v_contact_raw_source_count,
       v_duplicate_raw_source_count,
       v_opportunity_raw_source_count,
       v_project_raw_source_count,
       v_contact_returned_count,
       v_duplicate_returned_count,
       v_source_data_invalid,
       v_canonical_conflict
  from final_projection final;

  if not found then
    raise exception 'agent_customer_context_not_found_or_not_visible'
      using errcode = 'P0002';
  end if;
  if v_contact_raw_source_count >= p_source_limit
     or v_duplicate_raw_source_count >= p_source_limit
     or v_opportunity_raw_source_count >= p_source_limit
     or v_project_raw_source_count >= p_source_limit then
    raise exception 'agent_customer_context_source_query_bound'
      using errcode = '54000';
  end if;
  if v_source_data_invalid or v_canonical_conflict then
    raise exception 'agent_customer_context_source_data_invalid'
      using errcode = '22000';
  end if;

  return v_projection;
end;
$function$;

revoke all on function private.agent_p2_customer_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,text,text,text,uuid,text[],text,text[],timestamp with time zone,integer,integer)
  from public, anon, authenticated, service_role;

create or replace function public.read_agent_customer_context_as_system(
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
  p_clients_scope text,
  p_pipeline_scope text,
  p_projects_scope text,
  p_customer_kind text,
  p_customer_id uuid,
  p_sections text[],
  p_contact_purpose text,
  p_job_kinds text[],
  p_source_limit integer,
  p_item_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_expected_oauth_scopes text[];
  v_read_at timestamptz;
  v_summary jsonb;
  v_envelope jsonb;
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
     or p_grant_revision is null
     or p_grant_revision !~ '^[0-9a-f]{32}$'
     or p_granted_scope_ceiling is null
     or pg_catalog.cardinality(p_granted_scope_ceiling) not between 1 and 32
     or p_permission_snapshot_revision is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_registered_permission_keys is null
     or p_capability_id is distinct from 'get_customer_context'
     or p_capability_revision is distinct from
       'get_customer_context:2026-08-22.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-22.capability-manifest.v8'
     or p_clients_scope not in ('all', 'assigned')
     or p_customer_kind not in ('client', 'sub_client')
     or p_customer_id is null
     or p_sections is null
     or pg_catalog.cardinality(p_sections) not between 1 and 7
     or p_sections <@ array[
       'business_address',
       'business_notes',
       'contacts',
       'duplicate_state',
       'job_rollup',
       'preferences',
       'profile'
     ]::text[] is not true
     or (
       select pg_catalog.count(distinct requested.section)
       from pg_catalog.unnest(p_sections) requested(section)
     ) <> pg_catalog.cardinality(p_sections)
     or p_sections is distinct from (
       select pg_catalog.array_agg(requested.section order by requested.section)
       from pg_catalog.unnest(p_sections) requested(section)
     )
     or p_job_kinds is null
     or pg_catalog.cardinality(p_job_kinds) not between 0 and 2
     or p_job_kinds <@ array['opportunity', 'project']::text[] is not true
     or (
       select pg_catalog.count(distinct requested.kind)
       from pg_catalog.unnest(p_job_kinds) requested(kind)
     ) <> pg_catalog.cardinality(p_job_kinds)
     or p_job_kinds is distinct from coalesce((
       select pg_catalog.array_agg(requested.kind order by requested.kind)
       from pg_catalog.unnest(p_job_kinds) requested(kind)
     ), array[]::text[])
     or ('contacts' = any(p_sections)) is distinct from
       (p_contact_purpose is not null)
     or p_contact_purpose is not null
        and p_contact_purpose not in ('communication', 'scheduling')
     or ('job_rollup' = any(p_sections)) is distinct from
       (pg_catalog.cardinality(p_job_kinds) > 0)
     or ('opportunity' = any(p_job_kinds)) is distinct from
       (p_pipeline_scope is not null)
     or p_pipeline_scope is not null
        and p_pipeline_scope not in ('all', 'assigned')
     or ('project' = any(p_job_kinds)) is distinct from
       (p_projects_scope is not null)
     or p_projects_scope is not null
        and p_projects_scope not in ('all', 'assigned')
     or p_source_limit is distinct from 501
     or p_item_limit is distinct from 25 then
    raise exception 'invalid_agent_customer_context_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(p_granted_scope_ceiling) granted(scope)
    where granted.scope is null
       or granted.scope is distinct from pg_catalog.btrim(granted.scope)
       or pg_catalog.octet_length(granted.scope) not between 1 and 128
  ) or p_granted_scope_ceiling is distinct from (
    select pg_catalog.array_agg(granted.scope order by granted.scope)
    from (
      select distinct source.scope
      from pg_catalog.unnest(p_granted_scope_ceiling) source(scope)
    ) granted
  ) then
    raise exception 'invalid_agent_customer_context_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(p_registered_permission_keys) registry(permission_key)
    where registry.permission_key is null
       or registry.permission_key is distinct from
         pg_catalog.btrim(registry.permission_key)
       or pg_catalog.octet_length(registry.permission_key)
         not between 1 and 128
  ) or (
    select pg_catalog.count(distinct registry.permission_key)
    from pg_catalog.unnest(p_registered_permission_keys) registry(permission_key)
  ) <> pg_catalog.cardinality(p_registered_permission_keys)
  or p_registered_permission_keys is distinct from coalesce((
    select pg_catalog.array_agg(
      registry.permission_key order by registry.permission_key
    )
    from pg_catalog.unnest(p_registered_permission_keys)
      registry(permission_key)
  ), array[]::text[])
  or not ('clients.view' = any(p_registered_permission_keys))
  or 'opportunity' = any(p_job_kinds)
     and not ('pipeline.view' = any(p_registered_permission_keys))
  or 'project' = any(p_job_kinds)
     and not ('projects.view' = any(p_registered_permission_keys)) then
    raise exception 'invalid_agent_customer_context_request'
      using errcode = '22023';
  end if;

  select pg_catalog.array_agg(requested.scope order by requested.scope)
  into v_expected_oauth_scopes
  from (
    select 'ops.customers.read'::text as scope
    union all
    select 'ops.customer_contacts.read'
    where 'contacts' = any(p_sections)
    union all
    select 'ops.jobs.read'
    where 'job_rollup' = any(p_sections)
  ) requested;
  if p_required_oauth_scopes is distinct from v_expected_oauth_scopes then
    raise exception 'invalid_agent_customer_context_request'
      using errcode = '22023';
  end if;

  v_read_at := pg_catalog.date_trunc(
    'milliseconds',
    pg_catalog.statement_timestamp()
  );
  v_summary := private.agent_p2_customer_summary_v1(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_required_oauth_scopes,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_clients_scope,
    p_pipeline_scope,
    p_projects_scope,
    p_customer_kind,
    p_customer_id,
    p_sections,
    p_contact_purpose,
    p_job_kinds,
    v_read_at,
    p_source_limit,
    p_item_limit
  );
  if v_summary is null then
    raise exception 'agent_customer_context_not_found_or_not_visible'
      using errcode = 'P0002';
  end if;

  v_envelope := pg_catalog.jsonb_build_object(
    'company_id', p_company_id,
    'actor_user_id', p_actor_user_id,
    'oauth_grant_id', p_oauth_grant_id,
    'oauth_client_id', p_oauth_client_id,
    'grant_revision', p_grant_revision,
    'granted_scope_ceiling', pg_catalog.to_jsonb(p_granted_scope_ceiling),
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'capability_id', p_capability_id,
    'capability_revision', p_capability_revision,
    'capability_manifest_revision', p_capability_manifest_revision,
    'required_oauth_scopes', pg_catalog.to_jsonb(p_required_oauth_scopes),
    'clients_scope', p_clients_scope,
    'pipeline_scope', p_pipeline_scope,
    'projects_scope', p_projects_scope,
    'customer_ref', pg_catalog.jsonb_build_object(
      'kind', p_customer_kind,
      'id', p_customer_id
    ),
    'selected_sections', pg_catalog.to_jsonb(p_sections),
    'contact_purpose', p_contact_purpose,
    'job_kinds', pg_catalog.to_jsonb(p_job_kinds)
  ) || v_summary;

  return v_envelope || pg_catalog.jsonb_build_object(
    'proof_ref', 'ops_proof:v1:' || pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          private.canonical_agent_projection_json(
            v_envelope
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  );
end;
$function$;

revoke all on function public.read_agent_customer_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text,text[],integer,integer)
  from public, anon, authenticated, service_role;

alter function private.agent_p2_customer_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,text,text,text,uuid,text[],text,text[],timestamp with time zone,integer,integer)
  owner to current_user;
alter function public.read_agent_customer_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text,text[],integer,integer)
  owner to current_user;

do $canonical_acl$
declare
  v_signature text;
  v_function_oid oid;
  v_acl record;
begin
  foreach v_signature in array array[
    'private.agent_p2_customer_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,text,text,text,uuid,text[],text,text[],timestamp with time zone,integer,integer)',
    'public.read_agent_customer_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text,text[],integer,integer)'
  ]::text[] loop
    v_function_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    if v_function_oid is null then
      raise exception 'agent_customer_context_acl_function_missing:%',
        v_signature;
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
      left join pg_catalog.pg_roles role_row
        on role_row.oid = acl.grantee
      where function_row.oid = v_function_oid
        and acl.grantee <> function_row.proowner
    loop
      if v_acl.role_name is null then
        raise exception 'agent_customer_context_acl_role_missing:%',
          v_signature;
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

grant execute on function public.read_agent_customer_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text,text[],integer,integer)
  to service_role;

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
    and function_row.proname = 'agent_p2_customer_summary_v1'
  ) or (
    namespace.nspname = 'public'
    and function_row.proname = 'read_agent_customer_context_as_system'
  );
  if v_actual_signatures is distinct from array[
    'private.agent_p2_customer_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,text,text,text,uuid,text[],text,text[],timestamp with time zone,integer,integer)',
    'public.read_agent_customer_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text,text[],integer,integer)'
  ]::text[] then
    raise exception 'agent_customer_context_function_signature_set_failed';
  end if;

  for expected in
    select *
    from (values
      (
        'private.agent_p2_customer_summary_v1(uuid,uuid,uuid,uuid,text,text[],text[],text,text[],text,text,text,text,uuid,text[],text,text[],timestamp with time zone,integer,integer)',
        'plpgsql',
        false,
        'u',
        false,
        's',
        'jsonb',
        'search_path=',
        false
      ),
      (
        'public.read_agent_customer_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text,text[],integer,integer)',
        'plpgsql',
        false,
        'u',
        true,
        's',
        'jsonb',
        'search_path=',
        true
      )
    ) shape(
      signature,
      language_name,
      is_strict,
      parallel_safety,
      security_definer,
      volatility,
      result_type,
      search_path,
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
      and function_row.proowner = current_user::regrole
      and language_row.lanname = expected.language_name
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
      ) = expected.search_path;
    if not found
       or v_actual_result is distinct from expected.result_type then
      raise exception 'agent_customer_context_function_shape_failed:%',
        expected.signature;
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
      left join pg_catalog.pg_roles role_row
        on role_row.oid = acl.grantee
      where acl.grantee <> v_function_owner
    ) entry;
    v_expected_acl := case when expected.service_execute then
      array['service_role:EXECUTE:false']::text[]
    else array[]::text[] end;
    if v_acl_entries is distinct from v_expected_acl then
      raise exception 'agent_customer_context_function_acl_failed:%',
        expected.signature;
    end if;
  end loop;
end;
$postflight$;

commit;
