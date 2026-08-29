begin;

-- TASK 10 CANONICAL ARTIFACT READ BODY.
-- The generated agent_artifact_reads migration is an exact byte copy. Its
-- PostgreSQL 17 compile and rollback-only adversarial runtime fixture are the
-- acceptance gate for these private projections and two public readers.
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
      ('function', 'private.mcp_oauth_labels_for_scopes(text[],text)'),
      ('function', 'private.agent_p2_optional_canonical_text(text,integer,integer,boolean)'),
      ('function', 'private.agent_rfc3339_utc(timestamp with time zone)'),
      ('function', 'private.canonical_agent_projection_json(jsonb)'),
      ('function', 'extensions.digest(bytea,text)'),
      ('table', 'private.mcp_oauth_grants'),
      ('table', 'private.mcp_oauth_clients'),
      ('table', 'private.agent_read_domain_revisions'),
      ('table', 'private.agent_operational_read_revisions'),
      ('table', 'public.companies'),
      ('table', 'public.attachment_inspections'),
      ('table', 'public.deck_designs'),
      ('table', 'public.email_attachment_inspection_jobs'),
      ('table', 'public.email_attachments'),
      ('table', 'public.email_connections'),
      ('table', 'public.estimates'),
      ('table', 'public.expense_project_allocations'),
      ('table', 'public.expenses'),
      ('table', 'public.invoices'),
      ('table', 'public.opportunities'),
      ('table', 'public.project_notes'),
      ('table', 'public.project_photo_annotations'),
      ('table', 'public.project_photos'),
      ('table', 'public.project_tasks'),
      ('table', 'public.projects'),
      ('table', 'public.site_visit_artifacts'),
      ('table', 'public.site_visits')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_artifact_reads_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create or replace function private.agent_p2_artifact_uuid_from_text(
  p_value text
) returns uuid
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $function$
begin
  if p_value !~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return null;
  end if;
  return pg_catalog.lower(p_value)::uuid;
end;
$function$;

create or replace function private.agent_p2_artifact_safe_timestamp(
  p_value timestamptz
) returns timestamptz
language sql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $function$
  select case
    when pg_catalog.isfinite(p_value)
      and extract(year from p_value at time zone 'UTC') between 1 and 9999
    then pg_catalog.date_trunc('milliseconds', p_value)
  end;
$function$;

create or replace function private.agent_p2_artifact_mime_family(
  p_value text
) returns text
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $function$
  select case
    when pg_catalog.lower(pg_catalog.split_part(
      coalesce(p_value, ''), ';', 1
    )) like 'image/%' then 'image'
    when pg_catalog.lower(pg_catalog.split_part(
      coalesce(p_value, ''), ';', 1
    )) = 'application/pdf' then 'pdf'
    when pg_catalog.lower(pg_catalog.split_part(
      coalesce(p_value, ''), ';', 1
    )) like 'text/%' then 'text'
    else 'other'
  end;
$function$;

revoke all on function private.agent_p2_artifact_uuid_from_text(text)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_artifact_safe_timestamp(timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_artifact_mime_family(text)
  from public, anon, authenticated, service_role;

-- Frozen private proof projection. Raw locators and inline source text exist
-- only here. Public metadata and evidence-source RPCs below rebuild a strict
-- safe projection and never serialize raw_locator, provider identity, OCR,
-- drawing geometry, annotations, receipt fields, or source blobs.
create or replace function private.agent_p2_artifact_private_evidence_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_resolved_permission_scopes jsonb,
  p_job_kind text,
  p_job_id uuid,
  p_source_kinds text[],
  p_source_limit integer
) returns table (
  evidence_ref text,
  source_kind text,
  source_id text,
  artifact_kind text,
  occurred_at timestamptz,
  display_name text,
  note_excerpt text,
  review_state text,
  client_visibility text,
  mime_family text,
  byte_size bigint,
  availability text,
  inspection_state text,
  deck_design_ref text,
  inline_text text,
  raw_locator_kind text,
  raw_locator text,
  raw_mime_type text,
  raw_byte_size bigint,
  authority_connection_id uuid,
  authority_site_visit_id uuid,
  authority_submitter_id uuid,
  authority_opportunity_id uuid,
  authority_project_id uuid,
  source_data_invalid boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
#variable_conflict use_column
declare
  v_expected_permission_keys text[];
  v_source record;
begin
  select pg_catalog.array_agg(expected.permission_key order by expected.permission_key collate "C")
    into v_expected_permission_keys
  from (
    select distinct permission_key
    from (
      select 'pipeline.view'::text as permission_key
        where p_job_kind in (
          'opportunity', 'site_visit_linked', 'site_visit_unlinked'
        )
      union all select 'projects.view'
        where p_job_kind = 'project'
      union all select 'photos.view'
        where p_job_kind in (
          'site_visit_linked', 'site_visit_unlinked'
        )
      union all select 'calendar.view'
        where p_job_kind = 'site_visit_linked'
      union all select 'clients.view'
        where p_job_kind = 'site_visit_linked'
      union all select 'deck_builder.view'
        where 'deck_design' = any(p_source_kinds)
          or p_job_kind in ('site_visit_linked', 'site_visit_unlinked')
             and p_resolved_permission_scopes ? 'deck_builder.view'
      union all select 'email.view'
        where 'email_attachment' = any(p_source_kinds)
      union all select 'inbox.view'
        where 'email_attachment' = any(p_source_kinds)
      union all select 'expenses.view'
        where 'expense_receipt' = any(p_source_kinds)
      union all select 'documents.view'
        where p_source_kinds && array[
          'generated_estimate', 'generated_invoice'
        ]::text[]
      union all select 'estimates.view'
        where 'generated_estimate' = any(p_source_kinds)
      union all select 'invoices.view'
        where 'generated_invoice' = any(p_source_kinds)
      union all select 'photos.view'
        where p_source_kinds && array[
          'project_photo', 'site_visit_artifact'
        ]::text[]
      union all select 'calendar.view'
        where 'site_visit_artifact' = any(p_source_kinds)
          and p_job_kind <> 'site_visit_unlinked'
      union all select 'clients.view'
        where 'site_visit_artifact' = any(p_source_kinds)
          and p_job_kind <> 'site_visit_unlinked'
      union all select 'pipeline.view'
        where 'site_visit_artifact' = any(p_source_kinds)
    ) requested
  ) expected;

  if auth.role() is distinct from 'service_role'
     or p_actor_user_id is null
     or p_company_id is null
     or p_permission_snapshot_revision is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_registered_permission_keys is null
     or pg_catalog.cardinality(p_registered_permission_keys) not between 1 and 256
     or p_resolved_permission_scopes is null
     or pg_catalog.jsonb_typeof(p_resolved_permission_scopes) <> 'object'
     or p_job_kind not in (
       'opportunity', 'project',
       'site_visit_linked', 'site_visit_unlinked'
     )
     or p_job_id is null
     or p_source_kinds is null
     or pg_catalog.cardinality(p_source_kinds) not between 1 and 8
     or p_source_kinds <@ array[
       'deck_design',
       'email_attachment',
       'expense_receipt',
       'generated_estimate',
       'generated_invoice',
       'project_note',
       'project_photo',
       'site_visit_artifact'
     ]::text[] is not true
     or (
       select pg_catalog.count(distinct source_kind)
       from pg_catalog.unnest(p_source_kinds) source_kind
     ) <> pg_catalog.cardinality(p_source_kinds)
     or p_source_kinds is distinct from (
       select pg_catalog.array_agg(source_kind order by source_kind)
       from pg_catalog.unnest(p_source_kinds) source_kind
     )
     or p_job_kind in (
       'site_visit_linked', 'site_visit_unlinked'
     ) and p_source_kinds is distinct from
       array['site_visit_artifact']::text[]
     or p_source_limit is distinct from 501 then
    raise exception 'invalid_agent_artifact_private_evidence_request'
      using errcode = '22023';
  end if;

  if v_expected_permission_keys is null
     or not v_expected_permission_keys <@ p_registered_permission_keys
     or exists (
       select 1
       from pg_catalog.unnest(p_registered_permission_keys) key(value)
       where key.value is null
          or key.value is distinct from pg_catalog.btrim(key.value)
          or pg_catalog.octet_length(key.value) not between 1 and 128
     )
     or p_job_kind = 'site_visit_unlinked' and (
       p_resolved_permission_scopes ->> 'photos.view' is distinct from 'all'
       or p_resolved_permission_scopes ->> 'pipeline.view'
            is distinct from 'all'
       or p_resolved_permission_scopes ? 'deck_builder.view'
          and p_resolved_permission_scopes ->> 'deck_builder.view'
                is distinct from 'all'
     )
     or (
       select pg_catalog.count(distinct key.value)
       from pg_catalog.unnest(p_registered_permission_keys) key(value)
     ) <> pg_catalog.cardinality(p_registered_permission_keys)
     or p_registered_permission_keys is distinct from (
       select pg_catalog.array_agg(key.value order by key.value collate "C")
       from pg_catalog.unnest(p_registered_permission_keys) key(value)
     )
     or (
       select pg_catalog.count(*)
       from pg_catalog.jsonb_each_text(p_resolved_permission_scopes)
     ) <> pg_catalog.cardinality(v_expected_permission_keys)
     or exists (
       select 1
       from pg_catalog.jsonb_each_text(p_resolved_permission_scopes)
         permission(permission_key, permission_scope)
       left join (
         values
           ('calendar.view', array['all', 'own']::text[]),
           ('clients.view', array['all', 'assigned']::text[]),
           ('deck_builder.view', array['all', 'assigned']::text[]),
           ('documents.view', array['all']::text[]),
           ('email.view', array['all', 'own']::text[]),
           ('estimates.view', array['all', 'assigned']::text[]),
           ('expenses.view', array['all', 'own']::text[]),
           ('inbox.view', array['all', 'assigned', 'own']::text[]),
           ('invoices.view', array['all', 'assigned']::text[]),
           ('photos.view', array['all', 'assigned']::text[]),
           ('pipeline.view', array['all', 'assigned']::text[]),
           ('projects.view', array['all', 'assigned']::text[])
       ) allowed(permission_key, allowed_scopes)
         on allowed.permission_key = permission.permission_key
       where allowed.permission_key is null
          or permission.permission_scope <> all(allowed.allowed_scopes)
          or not permission.permission_key = any(v_expected_permission_keys)
     ) then
    raise exception 'invalid_agent_artifact_private_evidence_request'
      using errcode = '22023';
  end if;

  for v_source in
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
               where permission.value ->> 'permission' =
                 any(v_expected_permission_keys)
             ) as resolved_scopes
      from pg_catalog.jsonb_array_elements(
        authority.effective_permissions
      ) permission(value)
    ) scopes
    where authority.permission_snapshot_revision =
            p_permission_snapshot_revision
      and coalesce(scopes.resolved_scopes, '{}'::jsonb) =
            p_resolved_permission_scopes
  ), parent_job as materialized (
    select opportunity.id as job_id
    from current_authority authority
    join public.opportunities opportunity
      on p_job_kind = 'opportunity'
     and opportunity.id = p_job_id
     and opportunity.company_id = p_company_id
     and opportunity.deleted_at is null
     and opportunity.merged_into_opportunity_id is null
    where private.agent_user_can_access_entity(
      p_actor_user_id, p_company_id, 'opportunity', p_job_id, 'view'
    )

    union all

    select project.id
    from current_authority authority
    join public.projects project
      on p_job_kind = 'project'
     and project.id = p_job_id
     and project.company_id = p_company_id
     and project.deleted_at is null
    where private.agent_user_can_access_entity(
      p_actor_user_id, p_company_id, 'project', p_job_id, 'view'
    )

    union all

    select visit.id
    from current_authority authority
    join public.site_visits visit
      on p_job_kind = 'site_visit_linked'
     and visit.id = p_job_id
     and private.agent_p2_artifact_uuid_from_text(visit.company_id) =
       p_company_id
     and visit.deleted_at is null
     and visit.opportunity_id is not null
     and coalesce(
       visit.client_ref,
       private.agent_p2_artifact_uuid_from_text(visit.client_id)
     ) is not null
    where (
      p_resolved_permission_scopes ->> 'calendar.view' = 'all'
      or private.agent_p2_artifact_uuid_from_text(visit.created_by) =
           p_actor_user_id
      or p_actor_user_id::text = any(
        coalesce(visit.assignee_ids, array[]::text[])
      )
    )
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'opportunity',
        visit.opportunity_id,
        'view'
      )
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        'client',
        coalesce(
          visit.client_ref,
          private.agent_p2_artifact_uuid_from_text(visit.client_id)
        ),
        'view'
      )

    union all

    select visit.id
    from current_authority authority
    join public.site_visits visit
      on p_job_kind = 'site_visit_unlinked'
     and visit.id = p_job_id
     and private.agent_p2_artifact_uuid_from_text(visit.company_id) =
       p_company_id
     and visit.deleted_at is null
     and visit.opportunity_id is null
     and visit.project_ref is null
     and visit.project_id is null
    where p_resolved_permission_scopes ->> 'photos.view' = 'all'
      and p_resolved_permission_scopes ->> 'pipeline.view' = 'all'
  ), opportunity_note_project_gate as materialized (
    select note_project.id
    from current_authority authority
    cross join parent_job job
    join public.projects note_project
      on 'project_note' = any(p_source_kinds)
     and p_job_kind = 'opportunity'
     and note_project.company_id = p_company_id
     and coalesce(
           note_project.opportunity_ref::text,
           pg_catalog.lower(note_project.opportunity_id)
         ) = p_job_id::text
     and coalesce(
           note_project.opportunity_ref,
           private.agent_p2_artifact_uuid_from_text(
             note_project.opportunity_id
           )
         ) = p_job_id
     and note_project.deleted_at is null
    order by note_project.id
    limit 501
  ), opportunity_note_project_state as materialized (
    select pg_catalog.count(*) >= 501 as source_query_bound
    from opportunity_note_project_gate
  ), project_note_gate as materialized (
    select source.*
    from (
      select direct_note.*
      from (
        select note.*
        from public.project_notes note
        where 'project_note' = any(p_source_kinds)
          and p_job_kind = 'project'
          and pg_catalog.lower(note.company_id) = p_company_id::text
          and private.agent_p2_artifact_uuid_from_text(note.company_id) =
            p_company_id
          and pg_catalog.lower(note.project_id) = p_job_id::text
          and private.agent_p2_artifact_uuid_from_text(note.project_id) =
            p_job_id
          and note.deleted_at is null
          and note.event_kind is null
        order by note.id
        limit 501
      ) direct_note

      union all

      select opportunity_note.*
      from opportunity_note_project_gate note_project
      cross join lateral (
        select note.*
        from public.project_notes note
        where pg_catalog.lower(note.company_id) = p_company_id::text
          and private.agent_p2_artifact_uuid_from_text(note.company_id) =
            p_company_id
          and pg_catalog.lower(note.project_id) = note_project.id::text
          and private.agent_p2_artifact_uuid_from_text(note.project_id) =
            note_project.id
          and note.deleted_at is null
          and note.event_kind is null
        order by note.id
        limit 501
      ) opportunity_note
    ) source
    limit 501
  ), job_site_visit_gate as materialized (
    select source.*
    from (
      select opportunity_visit.*
      from (
        select visit.*
        from public.site_visits visit
        where 'site_visit_artifact' = any(p_source_kinds)
          and p_job_kind = 'opportunity'
          and pg_catalog.lower(visit.company_id) = p_company_id::text
          and private.agent_p2_artifact_uuid_from_text(visit.company_id) =
            p_company_id
          and visit.opportunity_id = p_job_id
          and visit.deleted_at is null
        order by visit.id
        limit 501
      ) opportunity_visit

      union all

      select project_visit.*
      from (
        select visit.*
        from public.site_visits visit
        where 'site_visit_artifact' = any(p_source_kinds)
          and p_job_kind = 'project'
          and pg_catalog.lower(visit.company_id) = p_company_id::text
          and private.agent_p2_artifact_uuid_from_text(visit.company_id) =
            p_company_id
          and coalesce(
                visit.project_ref::text,
                pg_catalog.lower(visit.project_id)
              ) = p_job_id::text
          and coalesce(
                visit.project_ref,
                private.agent_p2_artifact_uuid_from_text(visit.project_id)
              ) = p_job_id
          and visit.deleted_at is null
        order by visit.id
        limit 501
      ) project_visit

      union all

      select exact_visit.*
      from (
        select visit.*
        from public.site_visits visit
        where 'site_visit_artifact' = any(p_source_kinds)
          and p_job_kind in ('site_visit_linked', 'site_visit_unlinked')
          and visit.id = p_job_id
          and pg_catalog.lower(visit.company_id) = p_company_id::text
          and private.agent_p2_artifact_uuid_from_text(visit.company_id) =
            p_company_id
          and visit.deleted_at is null
        limit 1
      ) exact_visit
    ) source
    limit 501
  ), job_site_visit_state as materialized (
    select pg_catalog.count(*) >= 501 as source_query_bound
    from job_site_visit_gate
  ), site_visit_artifact_gate as materialized (
    select artifact.*,
           visit.opportunity_id as visit_opportunity_id,
           visit.project_ref as visit_project_ref,
           visit.project_id as visit_project_id
    from job_site_visit_gate visit
    cross join lateral (
      select artifact_row.*
      from public.site_visit_artifacts artifact_row
      where pg_catalog.lower(artifact_row.company_id) = p_company_id::text
        and private.agent_p2_artifact_uuid_from_text(
              artifact_row.company_id
            ) = p_company_id
        and artifact_row.site_visit_id = visit.id
        and artifact_row.deleted_at is null
      order by artifact_row.captured_at, artifact_row.id
      limit 501
    ) artifact
    limit 501
  ), site_visit_artifact_state as materialized (
    select pg_catalog.count(*) >= 501 as source_query_bound
    from site_visit_artifact_gate
  ), raw_source_gate as materialized (
    select source.*
    from current_authority authority
    cross join parent_job job
    cross join lateral (
      select *
      from (
      select 'project_photo'::text as source_kind,
             photo.id::text || ':' ||
               coalesce(annotation.id::text, '') as source_id,
             case
               when photo.source::text = 'measurement'
                 then 'dimensioned_photo'
               when annotation.id is not null then 'annotated_photo'
               else 'photo'
             end::text as artifact_kind,
             coalesce(
               private.agent_p2_artifact_safe_timestamp(photo.taken_at),
               private.agent_p2_artifact_safe_timestamp(photo.created_at),
               private.agent_p2_artifact_safe_timestamp(photo.updated_at),
               timestamptz '1970-01-01 00:00:00+00'
             ) as occurred_at,
             private.agent_p2_optional_canonical_text(
               photo.caption, 512, 2048, true
             ) as display_name,
             private.agent_p2_optional_canonical_text(
               annotation.note, 1000, 4000, true
             ) as note_excerpt,
             'not_applicable'::text as review_state,
             case when photo.is_client_visible then 'visible'
               else 'hidden' end::text as client_visibility,
             'image'::text as mime_family,
             null::bigint as byte_size,
             'unavailable'::text as availability,
             'not_required'::text as inspection_state,
             null::text as deck_design_ref,
             null::text as inline_text,
             'url'::text as raw_locator_kind,
             nullif(pg_catalog.btrim(coalesce(
               annotation.rendered_photo_url,
               annotation.annotation_url,
               photo.rendered_url,
               photo.url
             )), '') as raw_locator,
             case when photo.source::text = 'measurement'
               then 'image/png' else 'image/jpeg' end::text as raw_mime_type,
             null::bigint as raw_byte_size,
             null::uuid as authority_connection_id,
             photo.site_visit_id as authority_site_visit_id,
             null::uuid as authority_submitter_id,
             null::uuid as authority_opportunity_id,
             p_job_id as authority_project_id,
             private.agent_p2_artifact_safe_timestamp(
               coalesce(photo.taken_at, photo.created_at, photo.updated_at)
             ) is null as source_data_invalid
      from public.project_photos photo
      left join lateral (
        select annotation_row.id,
               annotation_row.annotation_url,
               annotation_row.rendered_photo_url,
               annotation_row.note
        from public.project_photo_annotations annotation_row
        where annotation_row.company_id = photo.company_id
          and annotation_row.project_id = photo.project_id
          and pg_catalog.md5(annotation_row.photo_url) =
            pg_catalog.md5(photo.url)
          and annotation_row.photo_url = photo.url
          and annotation_row.deleted_at is null
        order by coalesce(
          annotation_row.updated_at,
          annotation_row.created_at
        ) desc, annotation_row.id desc
        limit 1
      ) annotation on true
      where 'project_photo' = any(p_source_kinds)
        and p_job_kind = 'project'
        and pg_catalog.lower(photo.company_id) = p_company_id::text
        and private.agent_p2_artifact_uuid_from_text(photo.company_id) =
          p_company_id
        and pg_catalog.lower(photo.project_id) = p_job_id::text
        and private.agent_p2_artifact_uuid_from_text(photo.project_id) =
          p_job_id
        and photo.deleted_at is null
      order by photo.id
      limit 501
      ) project_photo_source

      union all

      select *
      from (
      select 'project_note',
             note.id::text,
             'note',
             coalesce(
               private.agent_p2_artifact_safe_timestamp(note.updated_at),
               private.agent_p2_artifact_safe_timestamp(note.created_at),
               timestamptz '1970-01-01 00:00:00+00'
             ),
             null::text,
             private.agent_p2_optional_canonical_text(
               note.content, 1000, 4000, true
             ),
             'not_applicable',
             'not_applicable',
             'text',
             null::bigint,
             case when private.agent_p2_optional_canonical_text(
               note.content, 12000, 48000, true
             ) is null then 'unavailable' else 'available' end,
             'not_required',
             null::text,
             private.agent_p2_optional_canonical_text(
               note.content, 12000, 48000, true
             ),
             null::text,
             null::text,
             'text/plain',
             null::bigint,
             null::uuid,
             null::uuid,
             null::uuid,
             null::uuid,
             private.agent_p2_artifact_uuid_from_text(note.project_id),
             private.agent_p2_artifact_safe_timestamp(
               coalesce(note.updated_at, note.created_at)
             ) is null
      from project_note_gate note
      order by note.id
      limit 501
      ) project_note_source

      union all

      select *
      from (
      select 'site_visit_artifact',
             artifact.id::text,
             case artifact.kind
               when 'photo' then 'photo'
               when 'annotated_photo' then 'annotated_photo'
               when 'dimensioned_photo' then 'dimensioned_photo'
               when 'note' then 'note'
               when 'transcript' then 'transcript'
               when 'measurement' then 'measurement'
               when 'deck_design' then 'deck_design'
               else 'note'
             end,
             coalesce(
               private.agent_p2_artifact_safe_timestamp(artifact.captured_at),
               private.agent_p2_artifact_safe_timestamp(artifact.created_at),
               timestamptz '1970-01-01 00:00:00+00'
             ),
             private.agent_p2_optional_canonical_text(
               artifact.title, 512, 2048, true
             ),
             case when artifact.kind in ('note', 'transcript', 'measurement')
               then private.agent_p2_optional_canonical_text(
                 artifact.body, 1000, 4000, true
               ) end,
             case when artifact.included_in_project_review
               then 'included' else 'excluded' end,
             'not_applicable',
             case
               when artifact.kind in ('note', 'transcript', 'measurement')
                 then 'text'
               when artifact.kind in (
                 'photo', 'annotated_photo', 'dimensioned_photo'
               ) then 'image'
               else 'other'
             end,
             null::bigint,
             case
               when artifact.kind in ('note', 'transcript', 'measurement')
                 and private.agent_p2_optional_canonical_text(
                   artifact.body, 12000, 48000, true
                 ) is not null then 'available'
               else 'unavailable'
             end,
             'not_required',
             case when artifact.kind = 'deck_design'
                       and visit_design.id is not null
               then 'ops_deck_design:v1:' || pg_catalog.encode(
                 extensions.digest(
                   pg_catalog.convert_to(
                     private.canonical_agent_projection_json(
                       pg_catalog.jsonb_build_object(
                         'company_id', p_company_id,
                         'deck_design_id', visit_design.id
                       )
                     ),
                     'UTF8'
                   ),
                   'sha256'
                 ),
                 'hex'
               )
             end,
             case when artifact.kind in ('note', 'transcript', 'measurement')
               then private.agent_p2_optional_canonical_text(
                 artifact.body, 12000, 48000, true
               ) end,
             case when artifact.asset_url is not null
                    or artifact.rendered_asset_url is not null
               then 'url' end,
             nullif(pg_catalog.btrim(coalesce(
               artifact.rendered_asset_url,
               artifact.asset_url
             )), ''),
             case when artifact.kind in (
               'photo', 'annotated_photo', 'dimensioned_photo'
             ) then 'image/jpeg' end,
             null::bigint,
             null::uuid,
             artifact.site_visit_id,
             null::uuid,
             coalesce(
               artifact.opportunity_id,
               artifact.visit_opportunity_id
             ),
             coalesce(
               artifact.visit_project_ref,
               private.agent_p2_artifact_uuid_from_text(
                 artifact.visit_project_id
               )
             ),
             artifact.kind not in (
               'photo', 'annotated_photo', 'dimensioned_photo',
               'note', 'transcript', 'measurement', 'deck_design'
             ) or private.agent_p2_artifact_safe_timestamp(
               coalesce(artifact.captured_at, artifact.created_at)
             ) is null
      from site_visit_artifact_gate artifact
      left join public.deck_designs visit_design
        on artifact.kind = 'deck_design'
       and visit_design.id = artifact.deck_design_id
       and visit_design.company_id = p_company_id
       and visit_design.deleted_at is null
       and p_resolved_permission_scopes ->> 'deck_builder.view'
             in ('all', 'assigned')
       and (
         p_job_kind = 'opportunity'
           and visit_design.opportunity_id = p_job_id
           and (
             visit_design.project_id is null
             or private.agent_user_can_access_entity(
               p_actor_user_id,
               p_company_id,
               'project',
               visit_design.project_id,
               'view'
             )
           )
         or p_job_kind = 'project'
           and visit_design.project_id = p_job_id
           and (
             visit_design.opportunity_id is null
             or private.agent_user_can_access_entity(
               p_actor_user_id,
               p_company_id,
               'opportunity',
               visit_design.opportunity_id,
               'view'
             )
           )
         or p_job_kind = 'site_visit_unlinked'
           and visit_design.project_id is null
           and visit_design.opportunity_id is null
           and p_resolved_permission_scopes ->> 'deck_builder.view' = 'all'
         or p_job_kind = 'site_visit_linked' and (
           visit_design.project_id is null
           and visit_design.opportunity_id is null
           and p_resolved_permission_scopes ->> 'deck_builder.view' = 'all'
           or (
             visit_design.project_id is not null
             or visit_design.opportunity_id is not null
           )
           and (
             visit_design.project_id is null
             or private.agent_user_can_access_entity(
               p_actor_user_id,
               p_company_id,
               'project',
               visit_design.project_id,
               'view'
             )
           )
           and (
             visit_design.opportunity_id is null
             or private.agent_user_can_access_entity(
               p_actor_user_id,
               p_company_id,
               'opportunity',
               visit_design.opportunity_id,
               'view'
             )
           )
         )
       )
      where artifact.kind <> 'deck_design'
         or visit_design.id is not null
      order by artifact.captured_at, artifact.id
      limit 501
      ) site_visit_artifact_source

      union all

      select *
      from (
      select 'deck_design',
             design.id::text,
             'deck_design',
             coalesce(
               private.agent_p2_artifact_safe_timestamp(design.updated_at),
               private.agent_p2_artifact_safe_timestamp(design.created_at),
               timestamptz '1970-01-01 00:00:00+00'
             ),
             private.agent_p2_optional_canonical_text(
               design.title, 512, 2048, true
             ),
             null::text,
             'not_applicable',
             'not_applicable',
             'other',
             null::bigint,
             'unavailable',
             'not_required',
             'ops_deck_design:v1:' || pg_catalog.encode(
               extensions.digest(
                 pg_catalog.convert_to(
                   private.canonical_agent_projection_json(
                     pg_catalog.jsonb_build_object(
                       'company_id', p_company_id,
                       'deck_design_id', design.id
                     )
                   ),
                   'UTF8'
                 ),
                 'sha256'
               ),
               'hex'
             ),
             null::text,
             null::text,
             null::text,
             null::text,
             null::bigint,
             null::uuid,
             null::uuid,
             null::uuid,
             design.opportunity_id,
             design.project_id,
             private.agent_p2_artifact_safe_timestamp(
               coalesce(design.updated_at, design.created_at)
             ) is null
      from public.deck_designs design
      where 'deck_design' = any(p_source_kinds)
        and design.company_id = p_company_id
        and design.deleted_at is null
        and (
          p_job_kind = 'opportunity'
            and design.opportunity_id = p_job_id
            and (
              design.project_id is null
              or private.agent_user_can_access_entity(
                p_actor_user_id,
                p_company_id,
                'project',
                design.project_id,
                'view'
              )
            )
          or p_job_kind = 'project'
            and design.project_id = p_job_id
            and (
              design.opportunity_id is null
              or private.agent_user_can_access_entity(
                p_actor_user_id,
                p_company_id,
                'opportunity',
                design.opportunity_id,
                'view'
              )
            )
        )
      order by design.id
      limit 501
      ) deck_design_source

      union all

      select *
      from (
      select 'email_attachment',
             attachment.id::text,
             'file',
             coalesce(
               private.agent_p2_artifact_safe_timestamp(attachment.occurred_at),
               private.agent_p2_artifact_safe_timestamp(attachment.stored_at),
               private.agent_p2_artifact_safe_timestamp(attachment.created_at),
               timestamptz '1970-01-01 00:00:00+00'
             ),
             private.agent_p2_optional_canonical_text(
               attachment.filename, 512, 2048, true
             ),
             null::text,
             'not_applicable',
             'not_applicable',
             private.agent_p2_artifact_mime_family(
               attachment.detected_mime_type
             ),
             case when attachment.verified_size_bytes between 0 and 52428800
               then attachment.verified_size_bytes end,
             case
               when attachment.ingest_status in (
                 'discovered', 'processing', 'retrying'
               ) then 'pending'
               when attachment.ingest_status = 'stored'
                 and inspection_job.status = 'complete'
                 and inspection.id is not null
                 and (
                   private.agent_p2_artifact_mime_family(
                     attachment.detected_mime_type
                   ) = 'image'
                   and attachment.verified_size_bytes between 1 and 26214400
                   or private.agent_p2_artifact_mime_family(
                     attachment.detected_mime_type
                   ) = 'pdf'
                   and attachment.verified_size_bytes between 1 and 52428800
                 ) then 'available'
               when attachment.ingest_status in ('failed', 'oversized')
                 or inspection_job.status = 'failed' then 'blocked'
               else 'unavailable'
             end,
             case
               when inspection_job.status = 'complete'
                    and inspection.id is not null then 'passed'
               when inspection_job.status = 'failed' then 'failed'
               else 'pending'
             end,
             null::text,
             null::text,
             case when attachment.storage_path is not null
               then 'storage_path' end,
             nullif(pg_catalog.btrim(attachment.storage_path), ''),
             attachment.detected_mime_type,
             attachment.verified_size_bytes,
             attachment.connection_id,
             null::uuid,
             null::uuid,
             attachment.opportunity_id,
             case when p_job_kind = 'project' then p_job_id end,
             private.agent_p2_artifact_safe_timestamp(
               coalesce(
                 attachment.occurred_at,
                 attachment.stored_at,
                 attachment.created_at
               )
             ) is null
      from public.email_attachments attachment
      left join public.email_attachment_inspection_jobs inspection_job
        on inspection_job.email_attachment_id = attachment.id
       and inspection_job.company_id = p_company_id
      left join public.attachment_inspections inspection
        on inspection.email_attachment_id = attachment.id
       and inspection.company_id = p_company_id
       and inspection.connection_id = attachment.connection_id
      where 'email_attachment' = any(p_source_kinds)
        and attachment.company_id = p_company_id
        and attachment.attribution_status = 'attributed'
        and attachment.opportunity_id is not null
        and (
          p_job_kind = 'opportunity'
            and attachment.opportunity_id = p_job_id
          or p_job_kind = 'project' and exists (
            select 1
            from public.projects project
            where project.id = p_job_id
              and project.company_id = p_company_id
              and project.deleted_at is null
              and coalesce(
                project.opportunity_ref,
                private.agent_p2_artifact_uuid_from_text(project.opportunity_id)
              ) = attachment.opportunity_id
          )
        )
      order by attachment.id
      limit 501
      ) email_attachment_source

      union all

      select *
      from (
      select 'generated_estimate',
             estimate.id::text,
             'document',
             coalesce(
               private.agent_p2_artifact_safe_timestamp(estimate.updated_at),
               private.agent_p2_artifact_safe_timestamp(estimate.created_at),
               timestamptz '1970-01-01 00:00:00+00'
             ),
             private.agent_p2_optional_canonical_text(
               coalesce(estimate.title, estimate.estimate_number),
               512, 2048, true
             ),
             null::text,
             'not_applicable',
             'not_applicable',
             'pdf',
             null::bigint,
             'unavailable',
             'not_required',
             null::text,
             null::text,
             'storage_path',
             nullif(pg_catalog.btrim(estimate.pdf_storage_path), ''),
             'application/pdf',
             null::bigint,
             null::uuid,
             null::uuid,
             null::uuid,
             estimate.opportunity_id,
             coalesce(
               estimate.project_ref,
               private.agent_p2_artifact_uuid_from_text(estimate.project_id)
             ),
             private.agent_p2_artifact_safe_timestamp(
               coalesce(estimate.updated_at, estimate.created_at)
             ) is null
      from public.estimates estimate
      where 'generated_estimate' = any(p_source_kinds)
        and estimate.company_id = p_company_id
        and estimate.deleted_at is null
        and nullif(pg_catalog.btrim(estimate.pdf_storage_path), '')
          is not null
        and (
          p_job_kind = 'opportunity' and estimate.opportunity_id = p_job_id
          or p_job_kind = 'project'
            and coalesce(
              estimate.project_ref::text,
              pg_catalog.lower(estimate.project_id)
            ) = p_job_id::text
            and coalesce(
              estimate.project_ref,
              private.agent_p2_artifact_uuid_from_text(estimate.project_id)
            ) = p_job_id
        )
      order by estimate.id
      limit 501
      ) generated_estimate_source

      union all

      select *
      from (
      select 'generated_invoice',
             invoice.id::text,
             'document',
             coalesce(
               private.agent_p2_artifact_safe_timestamp(invoice.updated_at),
               private.agent_p2_artifact_safe_timestamp(invoice.created_at),
               timestamptz '1970-01-01 00:00:00+00'
             ),
             private.agent_p2_optional_canonical_text(
               coalesce(invoice.subject, invoice.invoice_number),
               512, 2048, true
             ),
             null::text,
             'not_applicable',
             'not_applicable',
             'pdf',
             null::bigint,
             'unavailable',
             'not_required',
             null::text,
             null::text,
             'storage_path',
             nullif(pg_catalog.btrim(invoice.pdf_storage_path), ''),
             'application/pdf',
             null::bigint,
             null::uuid,
             null::uuid,
             null::uuid,
             invoice.opportunity_id,
             coalesce(
               invoice.project_ref,
               invoice.project_id
             ),
             private.agent_p2_artifact_safe_timestamp(
               coalesce(invoice.updated_at, invoice.created_at)
             ) is null
      from public.invoices invoice
      where 'generated_invoice' = any(p_source_kinds)
        and invoice.company_id = p_company_id
        and invoice.deleted_at is null
        and nullif(pg_catalog.btrim(invoice.pdf_storage_path), '')
          is not null
        and (
          p_job_kind = 'opportunity' and invoice.opportunity_id = p_job_id
          or p_job_kind = 'project'
            and coalesce(
              invoice.project_ref,
              invoice.project_id
            ) = p_job_id
        )
      order by invoice.id
      limit 501
      ) generated_invoice_source

      union all

      select *
      from (
      select 'expense_receipt',
             expense.id::text,
             'receipt',
             coalesce(
               private.agent_p2_artifact_safe_timestamp(expense.updated_at),
               private.agent_p2_artifact_safe_timestamp(expense.created_at),
               timestamptz '1970-01-01 00:00:00+00'
             ),
             null::text,
             null::text,
             'not_applicable',
             'not_applicable',
             'image',
             null::bigint,
             'unavailable',
             'pending',
             null::text,
             null::text,
             'url',
             nullif(pg_catalog.btrim(expense.receipt_image_url), ''),
             'image/jpeg',
             null::bigint,
             null::uuid,
             null::uuid,
             expense.submitted_by,
             null::uuid,
             p_job_id,
             private.agent_p2_artifact_safe_timestamp(
               coalesce(expense.updated_at, expense.created_at)
             ) is null
      from public.expenses expense
      join public.expense_project_allocations allocation
        on allocation.expense_id = expense.id
       and pg_catalog.lower(allocation.project_id) = p_job_id::text
       and private.agent_p2_artifact_uuid_from_text(allocation.project_id) =
         p_job_id
      where 'expense_receipt' = any(p_source_kinds)
        and p_job_kind = 'project'
        and expense.company_id = p_company_id
        and expense.deleted_at is null
        and nullif(pg_catalog.btrim(expense.receipt_image_url), '')
          is not null
      order by allocation.expense_id
      limit 501
      ) expense_receipt_source
    ) source
    limit 501
  ), raw_source_state as materialized (
    select (
             select pg_catalog.count(*)::integer
             from raw_source_gate
           ) as raw_source_count,
           note_state.source_query_bound
             or visit_state.source_query_bound
             or artifact_state.source_query_bound as source_query_bound
    from opportunity_note_project_state note_state
    cross join job_site_visit_state visit_state
    cross join site_visit_artifact_state artifact_state
  ), authorized_source as materialized (
    select source.*
    from raw_source_gate source
    where (
      source.source_kind <> 'email_attachment'
      or (
        private.user_can_view_inbox_connection(
          p_actor_user_id,
          p_company_id,
          source.authority_connection_id,
          source.authority_opportunity_id
        )
        and (
          p_resolved_permission_scopes ->> 'email.view' = 'all'
          or exists (
            select 1
            from public.email_connections connection
            where connection.id = source.authority_connection_id
              and private.agent_p2_artifact_uuid_from_text(
                connection.company_id
              ) = p_company_id
              and connection.type::text = 'individual'
              and private.agent_p2_artifact_uuid_from_text(
                connection.user_id
              ) = p_actor_user_id
          )
        )
      )
    )
      and (
        source.source_kind <> 'expense_receipt'
        or p_resolved_permission_scopes ->> 'expenses.view' = 'all'
        or source.authority_submitter_id = p_actor_user_id
      )
      and (
        source.source_kind <> 'site_visit_artifact'
        or p_job_kind = 'site_visit_unlinked' and (
          source.authority_site_visit_id = p_job_id
          and source.authority_opportunity_id is null
          and source.authority_project_id is null
          and p_resolved_permission_scopes ->> 'photos.view' = 'all'
          and p_resolved_permission_scopes ->> 'pipeline.view' = 'all'
        )
        or p_job_kind <> 'site_visit_unlinked' and exists (
          select 1
          from public.site_visits visit
          where visit.id = source.authority_site_visit_id
            and private.agent_p2_artifact_uuid_from_text(visit.company_id) =
              p_company_id
            and visit.deleted_at is null
            and (
              p_resolved_permission_scopes ->> 'calendar.view' = 'all'
              or private.agent_p2_artifact_uuid_from_text(visit.created_by) =
                   p_actor_user_id
              or p_actor_user_id::text = any(
                coalesce(visit.assignee_ids, array[]::text[])
              )
            )
            and source.authority_opportunity_id is not null
            and private.agent_user_can_access_entity(
              p_actor_user_id,
              p_company_id,
              'opportunity',
              source.authority_opportunity_id,
              'view'
            )
            and coalesce(
              visit.client_ref,
              private.agent_p2_artifact_uuid_from_text(visit.client_id)
            ) is not null
            and private.agent_user_can_access_entity(
              p_actor_user_id,
              p_company_id,
              'client',
              coalesce(
                visit.client_ref,
                private.agent_p2_artifact_uuid_from_text(visit.client_id)
              ),
              'view'
          )
        )
      )
  )
  select projected.*
  from (
    select case when state.source_query_bound
             then p_source_limit
             else state.raw_source_count
           end as raw_source_count,
           case when source.source_kind is not null then
             'ops_evidence:v1:' || pg_catalog.encode(
               extensions.digest(
                 pg_catalog.convert_to(
                   private.canonical_agent_projection_json(
                     pg_catalog.jsonb_build_object(
                       'company_id', p_company_id,
                       'job_kind', p_job_kind,
                       'job_id', p_job_id,
                       'source_kind', source.source_kind,
                       'source_id', source.source_id
                     )
                   ),
                   'UTF8'
                 ),
                 'sha256'
               ),
               'hex'
             )
           end as projected_evidence_ref,
           source.*
    from raw_source_state state
    left join authorized_source source on true
  ) projected
  order by projected.occurred_at desc nulls last,
           projected.source_kind collate "C" nulls last,
           projected.projected_evidence_ref collate "C" nulls last
  loop
    if v_source.raw_source_count >= p_source_limit then
      raise exception 'agent_artifact_source_query_bound'
        using errcode = '54000';
    end if;
    if v_source.source_kind is null then
      continue;
    end if;

    evidence_ref := v_source.projected_evidence_ref;
    source_kind := v_source.source_kind;
    source_id := v_source.source_id;
    artifact_kind := v_source.artifact_kind;
    occurred_at := v_source.occurred_at;
    display_name := v_source.display_name;
    note_excerpt := v_source.note_excerpt;
    review_state := v_source.review_state;
    client_visibility := v_source.client_visibility;
    mime_family := v_source.mime_family;
    byte_size := v_source.byte_size;
    availability := v_source.availability;
    inspection_state := v_source.inspection_state;
    deck_design_ref := v_source.deck_design_ref;
    inline_text := v_source.inline_text;
    raw_locator_kind := v_source.raw_locator_kind;
    raw_locator := v_source.raw_locator;
    raw_mime_type := v_source.raw_mime_type;
    raw_byte_size := v_source.raw_byte_size;
    authority_connection_id := v_source.authority_connection_id;
    authority_site_visit_id := v_source.authority_site_visit_id;
    authority_submitter_id := v_source.authority_submitter_id;
    authority_opportunity_id := v_source.authority_opportunity_id;
    authority_project_id := v_source.authority_project_id;
    source_data_invalid := v_source.source_data_invalid;
    return next;
  end loop;
  return;
end;
$function$;

revoke all on function private.agent_p2_artifact_private_evidence_v1(
  uuid, uuid, text, text[], jsonb, text, uuid, text[], integer
) from public, anon, authenticated, service_role;

-- The same metadata constructor is used by discovery and exact evidence.
-- It rejects a malformed source row rather than silently widening the public
-- contract or emitting a partially trusted shape.
create or replace function private.agent_p2_artifact_metadata_v1(
  p_evidence_ref text,
  p_source_kind text,
  p_artifact_kind text,
  p_occurred_at timestamptz,
  p_display_name text,
  p_note_excerpt text,
  p_review_state text,
  p_client_visibility text,
  p_mime_family text,
  p_byte_size bigint,
  p_availability text,
  p_inspection_state text,
  p_deck_design_ref text
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_metadata jsonb;
begin
  if p_evidence_ref is null
     or p_evidence_ref !~ '^ops_evidence:v1:[0-9a-f]{64}$'
     or p_source_kind not in (
       'deck_design',
       'email_attachment',
       'expense_receipt',
       'generated_estimate',
       'generated_invoice',
       'project_note',
       'project_photo',
       'site_visit_artifact'
     )
     or p_artifact_kind not in (
       'annotated_photo',
       'deck_design',
       'dimensioned_photo',
       'document',
       'file',
       'measurement',
       'note',
       'photo',
       'receipt',
       'transcript'
     )
     or (case p_source_kind
       when 'deck_design' then p_artifact_kind <> 'deck_design'
       when 'email_attachment' then p_artifact_kind <> 'file'
       when 'expense_receipt' then p_artifact_kind <> 'receipt'
       when 'generated_estimate' then p_artifact_kind <> 'document'
       when 'generated_invoice' then p_artifact_kind <> 'document'
       when 'project_note' then p_artifact_kind <> 'note'
       when 'project_photo' then p_artifact_kind not in (
         'photo', 'annotated_photo', 'dimensioned_photo'
       )
       when 'site_visit_artifact' then p_artifact_kind not in (
         'photo', 'annotated_photo', 'dimensioned_photo', 'note',
         'transcript', 'measurement', 'deck_design'
       )
       else true
     end)
     or p_occurred_at is null
     or not pg_catalog.isfinite(p_occurred_at)
     or extract(year from p_occurred_at at time zone 'UTC')
          not between 1 and 9999
     or p_occurred_at is distinct from pg_catalog.date_trunc(
       'milliseconds', p_occurred_at
     )
     or p_display_name is not null and
        private.agent_p2_optional_canonical_text(
          p_display_name, 512, 2048, true
        ) is distinct from p_display_name
     or p_note_excerpt is not null and
        private.agent_p2_optional_canonical_text(
          p_note_excerpt, 1000, 4000, true
        ) is distinct from p_note_excerpt
     or p_review_state not in ('included', 'excluded', 'not_applicable')
     or p_client_visibility not in ('visible', 'hidden', 'not_applicable')
     or p_mime_family not in ('image', 'pdf', 'text', 'other')
     or p_byte_size is not null and p_byte_size not between 0 and 52428800
     or p_mime_family = 'image'
        and coalesce(p_byte_size, 0) > 26214400
     or p_mime_family = 'text' and p_byte_size is not null
     or p_availability not in (
       'available', 'pending', 'blocked', 'unavailable'
     )
     or p_inspection_state not in (
       'not_required', 'passed', 'pending', 'failed'
     )
     or (p_artifact_kind = 'deck_design') is distinct from
        (p_deck_design_ref is not null)
     or p_deck_design_ref is not null
        and p_deck_design_ref !~ '^ops_deck_design:v1:[0-9a-f]{64}$' then
    raise exception 'agent_artifact_source_data_invalid'
      using errcode = '22000';
  end if;

  v_metadata := pg_catalog.jsonb_build_object(
    'evidence_ref', p_evidence_ref,
    'source_kind', p_source_kind,
    'artifact_kind', p_artifact_kind,
    'occurred_at', private.agent_rfc3339_utc(p_occurred_at),
    'display_name', case when p_display_name is null then null else
      pg_catalog.jsonb_build_object(
        'text', p_display_name,
        'content_kind', 'untrusted_business_data'
      ) end,
    'note_excerpt', case when p_note_excerpt is null then null else
      pg_catalog.jsonb_build_object(
        'text', p_note_excerpt,
        'content_kind', 'untrusted_business_data'
      ) end,
    'review_state', p_review_state,
    'client_visibility', p_client_visibility,
    'mime_family', p_mime_family,
    'byte_size', p_byte_size,
    'availability', p_availability,
    'inspection_state', p_inspection_state
  );
  if p_deck_design_ref is not null then
    v_metadata := v_metadata || pg_catalog.jsonb_build_object(
      'deck_design_ref', p_deck_design_ref
    );
  end if;
  return v_metadata;
end;
$function$;

revoke all on function private.agent_p2_artifact_metadata_v1(
  text,text,text,timestamp with time zone,text,text,text,text,text,bigint,
  text,text,text
) from public, anon, authenticated, service_role;

create or replace function private.agent_p2_artifact_list_v1(
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
  p_job_kind text,
  p_job_id uuid,
  p_source_kinds text[],
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer,
  p_cursor_read_at timestamptz,
  p_cursor_source_revisions jsonb,
  p_after_occurred_at timestamptz,
  p_after_source_kind text,
  p_after_evidence_ref text
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_expected_oauth_scopes text[];
  v_expected_permission_keys text[];
  v_read_at timestamptz;
  v_result jsonb;
  v_source_count integer;
  v_source_bound boolean;
  v_source_invalid boolean;
  v_cursor_stale boolean;
begin
  select pg_catalog.array_agg(scope_name order by scope_name collate "C")
    into v_expected_oauth_scopes
  from (
    select distinct scope_name
    from (
      select 'ops.files.read'::text as scope_name
      union all select 'ops.jobs.read'
        where 'deck_design' = any(p_source_kinds)
      union all select 'ops.correspondence.read'
        where 'email_attachment' = any(p_source_kinds)
      union all select 'ops.expenses.read'
        where 'expense_receipt' = any(p_source_kinds)
      union all select 'ops.financial_documents.read'
        where p_source_kinds && array[
          'generated_estimate', 'generated_invoice'
        ]::text[]
      union all select 'ops.customers.read'
        where 'site_visit_artifact' = any(p_source_kinds)
      union all select 'ops.schedule.read'
        where 'site_visit_artifact' = any(p_source_kinds)
      union all select 'ops.site_visits.read'
        where 'site_visit_artifact' = any(p_source_kinds)
    ) requested
  ) expected;

  select pg_catalog.array_agg(permission_key order by permission_key collate "C")
    into v_expected_permission_keys
  from (
    select distinct permission_key
    from (
      select case p_job_kind
        when 'opportunity' then 'pipeline.view'
        else 'projects.view'
      end::text as permission_key
      union all select 'deck_builder.view'
        where 'deck_design' = any(p_source_kinds)
      union all select 'email.view'
        where 'email_attachment' = any(p_source_kinds)
      union all select 'inbox.view'
        where 'email_attachment' = any(p_source_kinds)
      union all select 'expenses.view'
        where 'expense_receipt' = any(p_source_kinds)
      union all select 'documents.view'
        where p_source_kinds && array[
          'generated_estimate', 'generated_invoice'
        ]::text[]
      union all select 'estimates.view'
        where 'generated_estimate' = any(p_source_kinds)
      union all select 'invoices.view'
        where 'generated_invoice' = any(p_source_kinds)
      union all select 'photos.view'
        where p_source_kinds && array[
          'project_photo', 'site_visit_artifact'
        ]::text[]
      union all select 'calendar.view'
        where 'site_visit_artifact' = any(p_source_kinds)
      union all select 'clients.view'
        where 'site_visit_artifact' = any(p_source_kinds)
      union all select 'pipeline.view'
        where 'site_visit_artifact' = any(p_source_kinds)
    ) requested
  ) expected;

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
     or p_capability_id is distinct from 'list_job_artifacts'
     or p_capability_revision is distinct from
       'list_job_artifacts:2026-08-22.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-22.capability-manifest.v8'
     or p_required_oauth_scopes is distinct from v_expected_oauth_scopes
     or not p_required_oauth_scopes <@ p_granted_scope_ceiling
     or p_resolved_permission_scopes is null
     or pg_catalog.jsonb_typeof(p_resolved_permission_scopes) <> 'object'
     or p_job_kind not in ('opportunity', 'project')
     or p_job_id is null
     or p_source_kinds is null
     or pg_catalog.cardinality(p_source_kinds) not between 1 and 8
     or p_source_kinds <@ array[
       'deck_design', 'email_attachment', 'expense_receipt',
       'generated_estimate', 'generated_invoice', 'project_note',
       'project_photo', 'site_visit_artifact'
     ]::text[] is not true
     or (
       select pg_catalog.count(distinct source_kind)
       from pg_catalog.unnest(p_source_kinds) source_kind
     ) <> pg_catalog.cardinality(p_source_kinds)
     or p_source_kinds is distinct from (
       select pg_catalog.array_agg(source_kind order by source_kind collate "C")
       from pg_catalog.unnest(p_source_kinds) source_kind
     )
     or p_item_limit is null
     or p_item_limit not between 1 and 25
     or p_page_fetch_limit is distinct from p_item_limit + 1
     or p_page_fetch_limit not between 2 and 26
     or p_source_limit is distinct from 501
     or p_cursor_source_revisions is null
     or pg_catalog.jsonb_typeof(p_cursor_source_revisions) <> 'array'
     or (p_cursor_read_at is null) is distinct from
        (p_after_occurred_at is null)
     or (p_cursor_read_at is null) is distinct from
        (p_after_source_kind is null)
     or (p_cursor_read_at is null) is distinct from
        (p_after_evidence_ref is null)
     or (p_cursor_read_at is null) is distinct from
        (p_cursor_source_revisions = '[]'::jsonb)
     or p_cursor_read_at is not null and (
       not pg_catalog.isfinite(p_cursor_read_at)
       or extract(year from p_cursor_read_at at time zone 'UTC')
            not between 1 and 9999
       or p_cursor_read_at is distinct from pg_catalog.date_trunc(
         'milliseconds', p_cursor_read_at
       )
       or p_cursor_read_at > pg_catalog.statement_timestamp()
       or p_cursor_read_at <= pg_catalog.statement_timestamp() -
          interval '15 minutes'
     )
     or p_after_occurred_at is not null and (
       not pg_catalog.isfinite(p_after_occurred_at)
       or extract(year from p_after_occurred_at at time zone 'UTC')
            not between 1 and 9999
       or p_after_occurred_at is distinct from pg_catalog.date_trunc(
         'milliseconds', p_after_occurred_at
       )
     )
     or p_after_source_kind is not null
        and not p_after_source_kind = any(p_source_kinds)
     or p_after_evidence_ref is not null
        and p_after_evidence_ref !~ '^ops_evidence:v1:[0-9a-f]{64}$' then
    raise exception 'invalid_agent_artifact_list_request'
      using errcode = '22023';
  end if;

  if v_expected_permission_keys is null
     or not v_expected_permission_keys <@ p_registered_permission_keys
     or (
       select pg_catalog.count(*)
       from pg_catalog.jsonb_each_text(p_resolved_permission_scopes)
     ) <> pg_catalog.cardinality(v_expected_permission_keys)
     or exists (
       select 1
       from pg_catalog.jsonb_each_text(p_resolved_permission_scopes)
         permission(permission_key, permission_scope)
       left join (
         values
           ('calendar.view', array['all', 'own']::text[]),
           ('clients.view', array['all', 'assigned']::text[]),
           ('deck_builder.view', array['all', 'assigned']::text[]),
           ('documents.view', array['all']::text[]),
           ('email.view', array['all', 'own']::text[]),
           ('estimates.view', array['all', 'assigned']::text[]),
           ('expenses.view', array['all', 'own']::text[]),
           ('inbox.view', array['all', 'assigned', 'own']::text[]),
           ('invoices.view', array['all', 'assigned']::text[]),
           ('photos.view', array['all', 'assigned']::text[]),
           ('pipeline.view', array['all', 'assigned']::text[]),
           ('projects.view', array['all', 'assigned']::text[])
       ) allowed(permission_key, allowed_scopes)
         on allowed.permission_key = permission.permission_key
       where allowed.permission_key is null
          or permission.permission_scope <> all(allowed.allowed_scopes)
          or not permission.permission_key = any(v_expected_permission_keys)
     )
     or exists (
       select 1
       from pg_catalog.unnest(p_registered_permission_keys) key(value)
       where key.value is null
          or key.value is distinct from pg_catalog.btrim(key.value)
          or pg_catalog.octet_length(key.value) not between 1 and 128
     )
     or p_registered_permission_keys is distinct from (
       select pg_catalog.array_agg(key.value order by key.value collate "C")
       from pg_catalog.unnest(p_registered_permission_keys) key(value)
     )
     or exists (
       select 1
       from pg_catalog.unnest(p_granted_scope_ceiling) scope(value)
       where scope.value is null
          or scope.value is distinct from pg_catalog.btrim(scope.value)
          or pg_catalog.octet_length(scope.value) not between 1 and 128
     )
     or (
       select pg_catalog.count(distinct scope.value)
       from pg_catalog.unnest(p_granted_scope_ceiling) scope(value)
     ) <> pg_catalog.cardinality(p_granted_scope_ceiling)
     or p_granted_scope_ceiling is distinct from (
       select pg_catalog.array_agg(scope.value order by scope.value collate "C")
       from pg_catalog.unnest(p_granted_scope_ceiling) scope(value)
     ) then
    raise exception 'invalid_agent_artifact_list_request'
      using errcode = '22023';
  end if;

  v_read_at := coalesce(
    p_cursor_read_at,
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp())
  );

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           scopes.resolved_permission_scopes,
           scopes.calendar_scope,
           scopes.clients_scope,
           scopes.deck_builder_scope,
           scopes.documents_scope,
           scopes.email_scope,
           scopes.estimates_scope,
           scopes.expenses_scope,
           scopes.inbox_scope,
           scopes.invoices_scope,
           scopes.photos_scope,
           scopes.pipeline_scope,
           scopes.projects_scope
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral (
      select coalesce(pg_catalog.jsonb_object_agg(
               permission.value ->> 'permission',
               permission.value ->> 'scope'
               order by permission.value ->> 'permission'
             ) filter (
               where permission.value ->> 'permission' =
                 any(v_expected_permission_keys)
             ), '{}'::jsonb) as resolved_permission_scopes,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'calendar.view'
             ) as calendar_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'clients.view'
             ) as clients_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'deck_builder.view'
             ) as deck_builder_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'documents.view'
             ) as documents_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'email.view'
             ) as email_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'estimates.view'
             ) as estimates_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'expenses.view'
             ) as expenses_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'inbox.view'
             ) as inbox_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'invoices.view'
             ) as invoices_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'photos.view'
             ) as photos_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'pipeline.view'
             ) as pipeline_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'projects.view'
             ) as projects_scope
      from pg_catalog.jsonb_array_elements(
        authority.effective_permissions
      ) permission(value)
    ) scopes
  ), parent_job as materialized (
    select opportunity.id as job_id,
           opportunity.deleted_at
    from public.opportunities opportunity
    where p_job_kind = 'opportunity'
      and opportunity.id = p_job_id
      and opportunity.company_id = p_company_id
      and opportunity.merged_into_opportunity_id is null
      and private.agent_user_can_access_entity(
        p_actor_user_id, p_company_id, 'opportunity', p_job_id, 'view'
      )

    union all

    select project.id,
           project.deleted_at
    from public.projects project
    where p_job_kind = 'project'
      and project.id = p_job_id
      and project.company_id = p_company_id
      and private.agent_user_can_access_entity(
        p_actor_user_id, p_company_id, 'project', p_job_id, 'view'
      )
  ), read_context as materialized (
    select authority.*,
           artifact_revision.source_revision as artifact_revision,
           operational_revision.source_revision as operational_revision,
           pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object(
               'domain', 'artifacts',
               'source_revision', artifact_revision.source_revision
             ),
             pg_catalog.jsonb_build_object(
               'domain', 'legacy_operational',
               'source_revision', operational_revision.source_revision
             )
           ) as source_revisions,
           v_read_at as read_at,
           p_cursor_read_at is null or p_cursor_source_revisions =
             pg_catalog.jsonb_build_array(
               pg_catalog.jsonb_build_object(
                 'domain', 'artifacts',
                 'source_revision', artifact_revision.source_revision
               ),
               pg_catalog.jsonb_build_object(
                 'domain', 'legacy_operational',
                 'source_revision', operational_revision.source_revision
               )
             ) as cursor_valid
    from current_authority authority
    join private.mcp_oauth_grants grant_row
      on grant_row.id = p_oauth_grant_id
     and grant_row.user_id = p_actor_user_id
     and grant_row.company_id = p_company_id
     and grant_row.client_id = p_oauth_client_id
     and grant_row.revision = p_grant_revision
     and grant_row.revoked_at is null
     and grant_row.scopes = p_granted_scope_ceiling
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
    join private.agent_read_domain_revisions artifact_revision
      on artifact_revision.company_id = p_company_id
     and artifact_revision.domain = 'artifacts'
     and artifact_revision.source_revision between 0 and 9007199254740991
    join private.agent_operational_read_revisions operational_revision
      on operational_revision.company_id = p_company_id
     and operational_revision.source_revision between 0 and 9007199254740991
    cross join parent_job job
    where job.deleted_at is null
      and authority.permission_snapshot_revision =
        p_permission_snapshot_revision
      and authority.resolved_permission_scopes =
        p_resolved_permission_scopes
  ), source_context as materialized (
    select context.*
    from read_context context
    where context.cursor_valid
  ), evidence_source as materialized (
    select source.*,
           context.read_at,
           context.source_revisions,
           context.deck_builder_scope
    from read_context context
    cross join lateral private.agent_p2_artifact_private_evidence_v1(
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_resolved_permission_scopes,
      p_job_kind,
      p_job_id,
      p_source_kinds,
      p_source_limit
    ) source
    where (
      source.artifact_kind <> 'deck_design'
      or context.deck_builder_scope in ('all', 'assigned')
    )
      and (
        source.source_kind <> 'email_attachment'
        or private.user_can_view_inbox_connection(
          p_actor_user_id,
          p_company_id,
          source.authority_connection_id,
          source.authority_opportunity_id
        )
      )
      and (
        source.source_kind <> 'expense_receipt'
        or context.expenses_scope = 'all'
        or source.authority_submitter_id = p_actor_user_id
      )
      and (
        source.source_kind <> 'site_visit_artifact'
        or source.authority_site_visit_id is not null
      )
  ), source_state as materialized (
    select pg_catalog.count(*)::integer as source_count,
           coalesce(
             pg_catalog.bool_or(source.source_data_invalid), false
           ) as source_invalid
    from evidence_source source
  ), filtered_source as materialized (
    select candidate.*
    from evidence_source candidate
    cross join source_state source
    where source.source_count < 501
      and not source.source_invalid
      and (
        p_after_evidence_ref is null
        or candidate.occurred_at < p_after_occurred_at
        or candidate.occurred_at = p_after_occurred_at
           and candidate.source_kind collate "C" >
             p_after_source_kind collate "C"
        or candidate.occurred_at = p_after_occurred_at
           and candidate.source_kind = p_after_source_kind
           and candidate.evidence_ref collate "C" >
             p_after_evidence_ref collate "C"
      )
  ), page_plus_one as materialized (
    select source.*
    from filtered_source source
    order by source.occurred_at desc,
             source.source_kind collate "C",
             source.evidence_ref collate "C"
    limit p_page_fetch_limit
  ), retained_page as materialized (
    select source.*
    from page_plus_one source
    order by source.occurred_at desc,
             source.source_kind collate "C",
             source.evidence_ref collate "C"
    limit p_item_limit
  ), metadata_page as materialized (
    select retained.*,
           private.agent_p2_artifact_metadata_v1(
             retained.evidence_ref,
             retained.source_kind,
             retained.artifact_kind,
             retained.occurred_at,
             retained.display_name,
             retained.note_excerpt,
             retained.review_state,
             retained.client_visibility,
             retained.mime_family,
             retained.byte_size,
             retained.availability,
             retained.inspection_state,
             retained.deck_design_ref
           ) as artifact
    from retained_page retained
  ), page_state as materialized (
    select (select pg_catalog.count(*) > p_item_limit from page_plus_one)
             as has_more
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
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'ranking_revision', 'artifact-ranking:2026-08-22.v1',
             'required_oauth_scopes',
               pg_catalog.to_jsonb(p_required_oauth_scopes),
             'resolved_permission_scopes',
               p_resolved_permission_scopes,
             'job_ref', pg_catalog.jsonb_build_object(
               'kind', p_job_kind, 'id', p_job_id
             ),
             'source_kinds', pg_catalog.to_jsonb(p_source_kinds),
             'item_limit', p_item_limit,
             'cursor_read_at', case when p_cursor_read_at is null then null
               else private.agent_rfc3339_utc(p_cursor_read_at) end,
             'cursor_source_revisions', p_cursor_source_revisions,
             'cursor_predecessor', case
               when p_after_evidence_ref is null then null
               else pg_catalog.jsonb_build_object(
                 'order', pg_catalog.jsonb_build_array(
                   private.agent_rfc3339_utc(p_after_occurred_at),
                   p_after_source_kind,
                   p_after_evidence_ref
                 ),
                 'tie_breaker', p_after_evidence_ref
               ) end,
             'read_at', private.agent_rfc3339_utc(context.read_at),
             'source_revisions', context.source_revisions,
             'source_inspected', state.source_count,
             'source_has_more', page.has_more
           ) as value
    from read_context context
    cross join source_state state
    cross join page_state page
  ), proof_page as materialized (
    select metadata.*,
           'ops_proof:v1:' || pg_catalog.encode(
             extensions.digest(
               pg_catalog.convert_to(
                 private.canonical_agent_projection_json(
                   context.value || pg_catalog.jsonb_build_object(
                     'proof_kind', 'artifact_list_entity',
                     'source_identity', pg_catalog.jsonb_build_object(
                       'source_kind', metadata.source_kind,
                       'source_id', metadata.source_id
                     ),
                     'artifact', metadata.artifact
                   )
                 ),
                 'UTF8'
               ),
               'sha256'
             ),
             'hex'
           ) as proof_ref
    from metadata_page metadata
    cross join proof_context context
  ), aggregate_page as materialized (
    select coalesce(pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'artifact', page.artifact,
               'source_id', page.source_id,
               'proof_ref', page.proof_ref,
               'evidence_ref', page.evidence_ref,
               'predecessor', pg_catalog.jsonb_build_object(
                 'order', pg_catalog.jsonb_build_array(
                   private.agent_rfc3339_utc(page.occurred_at),
                   page.source_kind,
                   page.evidence_ref
                 ),
                 'tie_breaker', page.evidence_ref
               )
             ) order by page.occurred_at desc,
                        page.source_kind collate "C",
                        page.evidence_ref collate "C"
           ), '[]'::jsonb) as rows
    from proof_page page
  ), collection_proof_input as materialized (
    select context.value || pg_catalog.jsonb_build_object(
             'proof_kind', 'artifact_list_collection',
             'returned_count', pg_catalog.count(page.source_id)::integer,
             'has_more', (context.value ->> 'source_has_more')::boolean,
             'children', coalesce(
               pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'artifact_ref', pg_catalog.jsonb_build_object(
                     'source_kind', page.source_kind,
                     'evidence_ref', page.evidence_ref
                   ),
                   'proof_ref', page.proof_ref,
                   'evidence_ref', page.evidence_ref
                 ) order by page.occurred_at desc,
                            page.source_kind collate "C",
                            page.evidence_ref collate "C"
               ) filter (where page.source_id is not null),
               '[]'::jsonb
             )
           ) as value
    from proof_context context
    left join proof_page page on true
    group by context.value
  ), final_projection as materialized (
    select proof.value || pg_catalog.jsonb_build_object(
             'rows', page.rows
           ) as envelope,
           collection.value as collection_proof,
           context.cursor_valid is false as cursor_stale,
           state.source_count,
           state.source_count >= 501 as source_bound,
           state.source_invalid
    from read_context context
    cross join source_state state
    cross join aggregate_page page
    cross join proof_context proof
    cross join collection_proof_input collection
  )
  select projection.envelope || pg_catalog.jsonb_build_object(
           'collection_proof_ref',
           'ops_proof:v1:' || pg_catalog.encode(
             extensions.digest(
               pg_catalog.convert_to(
                 private.canonical_agent_projection_json(
                   projection.collection_proof
                 ),
                 'UTF8'
               ),
               'sha256'
             ),
             'hex'
           )
         ),
         projection.source_count,
         projection.source_bound,
         projection.source_invalid,
         projection.cursor_stale
    into v_result,
         v_source_count,
         v_source_bound,
         v_source_invalid,
         v_cursor_stale
  from final_projection projection;

  if v_result is null then
    raise exception 'agent_artifact_read_unauthorized' using errcode = '42501';
  end if;
  if v_cursor_stale then
    raise exception 'agent_artifact_read_stale' using errcode = '40001';
  end if;
  if v_source_bound or v_source_count >= p_source_limit then
    raise exception 'agent_artifact_source_query_bound' using errcode = '54000';
  end if;
  if v_source_invalid then
    raise exception 'agent_artifact_source_data_invalid' using errcode = '22000';
  end if;
  if pg_catalog.char_length(v_result::text) > 60000 then
    raise exception 'agent_artifact_result_bound' using errcode = '54000';
  end if;
  return v_result;
end;
$function$;

revoke all on function private.agent_p2_artifact_list_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,
  uuid,text[],integer,integer,integer,timestamp with time zone,jsonb,
  timestamp with time zone,text,text
) from public, anon, authenticated, service_role;

create or replace function private.agent_p2_artifact_evidence_v1(
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
  p_job_kind text,
  p_job_id uuid,
  p_source_kinds text[],
  p_source_kind text,
  p_evidence_ref text,
  p_source_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_expected_oauth_scopes text[];
  v_expected_permission_keys text[];
  v_read_at timestamptz;
  v_result jsonb;
  v_source_count integer;
  v_selected_count integer;
begin
  select pg_catalog.array_agg(scope_name order by scope_name collate "C")
    into v_expected_oauth_scopes
  from (
    select distinct scope_name
    from (
      select 'ops.files.read'::text as scope_name
      union all select 'ops.jobs.read'
        where p_source_kind = 'deck_design'
      union all select 'ops.correspondence.read'
        where p_source_kind = 'email_attachment'
      union all select 'ops.expenses.read'
        where p_source_kind = 'expense_receipt'
      union all select 'ops.financial_documents.read'
        where p_source_kind in ('generated_estimate', 'generated_invoice')
      union all select 'ops.customers.read'
        where p_source_kind = 'site_visit_artifact'
      union all select 'ops.schedule.read'
        where p_source_kind = 'site_visit_artifact'
      union all select 'ops.site_visits.read'
        where p_source_kind = 'site_visit_artifact'
    ) requested
  ) expected;

  select pg_catalog.array_agg(permission_key order by permission_key collate "C")
    into v_expected_permission_keys
  from (
    select distinct permission_key
    from (
      select case p_job_kind
        when 'opportunity' then 'pipeline.view'
        else 'projects.view'
      end::text as permission_key
      union all select 'deck_builder.view'
        where p_source_kind = 'deck_design'
      union all select 'email.view'
        where p_source_kind = 'email_attachment'
      union all select 'inbox.view'
        where p_source_kind = 'email_attachment'
      union all select 'expenses.view'
        where p_source_kind = 'expense_receipt'
      union all select 'documents.view'
        where p_source_kind in ('generated_estimate', 'generated_invoice')
      union all select 'estimates.view'
        where p_source_kind = 'generated_estimate'
      union all select 'invoices.view'
        where p_source_kind = 'generated_invoice'
      union all select 'photos.view'
        where p_source_kind in ('project_photo', 'site_visit_artifact')
      union all select 'calendar.view'
        where p_source_kind = 'site_visit_artifact'
      union all select 'clients.view'
        where p_source_kind = 'site_visit_artifact'
      union all select 'pipeline.view'
        where p_source_kind = 'site_visit_artifact'
    ) requested
  ) expected;

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
     or p_capability_id is distinct from 'get_job_artifact_evidence'
     or p_capability_revision is distinct from
       'get_job_artifact_evidence:2026-08-22.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-22.capability-manifest.v8'
     or p_required_oauth_scopes is distinct from v_expected_oauth_scopes
     or not p_required_oauth_scopes <@ p_granted_scope_ceiling
     or p_resolved_permission_scopes is null
     or pg_catalog.jsonb_typeof(p_resolved_permission_scopes) <> 'object'
     or p_job_kind not in ('opportunity', 'project')
     or p_job_id is null
     or p_source_kind not in (
       'deck_design', 'email_attachment', 'expense_receipt',
       'generated_estimate', 'generated_invoice', 'project_note',
       'project_photo', 'site_visit_artifact'
     )
     or p_source_kinds is distinct from array[p_source_kind]::text[]
     or p_evidence_ref is null
     or p_evidence_ref !~ '^ops_evidence:v1:[0-9a-f]{64}$'
     or p_source_limit is distinct from 501 then
    raise exception 'invalid_agent_artifact_evidence_request'
      using errcode = '22023';
  end if;

  if v_expected_permission_keys is null
     or not v_expected_permission_keys <@ p_registered_permission_keys
     or (
       select pg_catalog.count(*)
       from pg_catalog.jsonb_each_text(p_resolved_permission_scopes)
     ) <> pg_catalog.cardinality(v_expected_permission_keys)
     or exists (
       select 1
       from pg_catalog.jsonb_each_text(p_resolved_permission_scopes)
         permission(permission_key, permission_scope)
       left join (
         values
           ('calendar.view', array['all', 'own']::text[]),
           ('clients.view', array['all', 'assigned']::text[]),
           ('deck_builder.view', array['all', 'assigned']::text[]),
           ('documents.view', array['all']::text[]),
           ('email.view', array['all', 'own']::text[]),
           ('estimates.view', array['all', 'assigned']::text[]),
           ('expenses.view', array['all', 'own']::text[]),
           ('inbox.view', array['all', 'assigned', 'own']::text[]),
           ('invoices.view', array['all', 'assigned']::text[]),
           ('photos.view', array['all', 'assigned']::text[]),
           ('pipeline.view', array['all', 'assigned']::text[]),
           ('projects.view', array['all', 'assigned']::text[])
       ) allowed(permission_key, allowed_scopes)
         on allowed.permission_key = permission.permission_key
       where allowed.permission_key is null
          or permission.permission_scope <> all(allowed.allowed_scopes)
          or not permission.permission_key = any(v_expected_permission_keys)
     )
     or exists (
       select 1
       from pg_catalog.unnest(p_registered_permission_keys) key(value)
       where key.value is null
          or key.value is distinct from pg_catalog.btrim(key.value)
          or pg_catalog.octet_length(key.value) not between 1 and 128
     )
     or (
       select pg_catalog.count(distinct key.value)
       from pg_catalog.unnest(p_registered_permission_keys) key(value)
     ) <> pg_catalog.cardinality(p_registered_permission_keys)
     or p_registered_permission_keys is distinct from (
       select pg_catalog.array_agg(key.value order by key.value collate "C")
       from pg_catalog.unnest(p_registered_permission_keys) key(value)
     )
     or exists (
       select 1
       from pg_catalog.unnest(p_granted_scope_ceiling) scope(value)
       where scope.value is null
          or scope.value is distinct from pg_catalog.btrim(scope.value)
          or pg_catalog.octet_length(scope.value) not between 1 and 128
     )
     or (
       select pg_catalog.count(distinct scope.value)
       from pg_catalog.unnest(p_granted_scope_ceiling) scope(value)
     ) <> pg_catalog.cardinality(p_granted_scope_ceiling)
     or p_granted_scope_ceiling is distinct from (
       select pg_catalog.array_agg(scope.value order by scope.value collate "C")
       from pg_catalog.unnest(p_granted_scope_ceiling) scope(value)
     ) then
    raise exception 'invalid_agent_artifact_evidence_request'
      using errcode = '22023';
  end if;

  v_read_at := pg_catalog.date_trunc(
    'milliseconds', pg_catalog.statement_timestamp()
  );

  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           scopes.resolved_permission_scopes,
           scopes.calendar_scope,
           scopes.clients_scope,
           scopes.deck_builder_scope,
           scopes.documents_scope,
           scopes.email_scope,
           scopes.estimates_scope,
           scopes.expenses_scope,
           scopes.inbox_scope,
           scopes.invoices_scope,
           scopes.photos_scope,
           scopes.pipeline_scope,
           scopes.projects_scope
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral (
      select coalesce(pg_catalog.jsonb_object_agg(
               permission.value ->> 'permission',
               permission.value ->> 'scope'
               order by permission.value ->> 'permission'
             ) filter (
               where permission.value ->> 'permission' =
                 any(v_expected_permission_keys)
             ), '{}'::jsonb) as resolved_permission_scopes,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'calendar.view'
             ) as calendar_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'clients.view'
             ) as clients_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'deck_builder.view'
             ) as deck_builder_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'documents.view'
             ) as documents_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'email.view'
             ) as email_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'estimates.view'
             ) as estimates_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'expenses.view'
             ) as expenses_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'inbox.view'
             ) as inbox_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'invoices.view'
             ) as invoices_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'photos.view'
             ) as photos_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'pipeline.view'
             ) as pipeline_scope,
             pg_catalog.max(permission.value ->> 'scope') filter (
               where permission.value ->> 'permission' = 'projects.view'
             ) as projects_scope
      from pg_catalog.jsonb_array_elements(
        authority.effective_permissions
      ) permission(value)
    ) scopes
  ), parent_job as materialized (
    select opportunity.id as job_id,
           opportunity.deleted_at
    from public.opportunities opportunity
    where p_job_kind = 'opportunity'
      and opportunity.id = p_job_id
      and opportunity.company_id = p_company_id
      and opportunity.merged_into_opportunity_id is null
      and private.agent_user_can_access_entity(
        p_actor_user_id, p_company_id, 'opportunity', p_job_id, 'view'
      )

    union all

    select project.id,
           project.deleted_at
    from public.projects project
    where p_job_kind = 'project'
      and project.id = p_job_id
      and project.company_id = p_company_id
      and private.agent_user_can_access_entity(
        p_actor_user_id, p_company_id, 'project', p_job_id, 'view'
      )
  ), read_context as materialized (
    select authority.*,
           artifact_revision.source_revision as artifact_revision,
           operational_revision.source_revision as operational_revision,
           pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object(
               'domain', 'artifacts',
               'source_revision', artifact_revision.source_revision
             ),
             pg_catalog.jsonb_build_object(
               'domain', 'legacy_operational',
               'source_revision', operational_revision.source_revision
             )
           ) as source_revisions,
           v_read_at as read_at
    from current_authority authority
    join private.mcp_oauth_grants grant_row
      on grant_row.id = p_oauth_grant_id
     and grant_row.user_id = p_actor_user_id
     and grant_row.company_id = p_company_id
     and grant_row.client_id = p_oauth_client_id
     and grant_row.revision = p_grant_revision
     and grant_row.revoked_at is null
     and grant_row.scopes = p_granted_scope_ceiling
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
    join private.agent_read_domain_revisions artifact_revision
      on artifact_revision.company_id = p_company_id
     and artifact_revision.domain = 'artifacts'
     and artifact_revision.source_revision between 0 and 9007199254740991
    join private.agent_operational_read_revisions operational_revision
      on operational_revision.company_id = p_company_id
     and operational_revision.source_revision between 0 and 9007199254740991
    cross join parent_job job
    where job.deleted_at is null
      and authority.permission_snapshot_revision =
        p_permission_snapshot_revision
      and authority.resolved_permission_scopes =
        p_resolved_permission_scopes
  ), evidence_source as materialized (
    select source.*,
           context.read_at,
           context.source_revisions,
           context.deck_builder_scope
    from read_context context
    cross join lateral private.agent_p2_artifact_private_evidence_v1(
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_resolved_permission_scopes,
      p_job_kind,
      p_job_id,
      p_source_kinds,
      p_source_limit
    ) source
    where (
      source.artifact_kind <> 'deck_design'
      or context.deck_builder_scope in ('all', 'assigned')
    )
      and (
        source.source_kind <> 'email_attachment'
        or private.user_can_view_inbox_connection(
          p_actor_user_id,
          p_company_id,
          source.authority_connection_id,
          source.authority_opportunity_id
        )
      )
      and (
        source.source_kind <> 'expense_receipt'
        or context.expenses_scope = 'all'
        or source.authority_submitter_id = p_actor_user_id
      )
      and (
        source.source_kind <> 'site_visit_artifact'
        or source.authority_site_visit_id is not null
      )
  ), source_state as materialized (
    select pg_catalog.count(*)::integer as source_count
    from evidence_source source
  ), selected_source as materialized (
    select candidate.*
    from evidence_source candidate
    cross join source_state source
    where source.source_count < 501
      and candidate.evidence_ref = p_evidence_ref
      and candidate.source_kind = p_source_kind
  ), selected_state as materialized (
    select pg_catalog.count(*)::integer as selected_count
    from selected_source
  ), selected_projection as materialized (
    select source.*,
           private.agent_p2_artifact_metadata_v1(
             source.evidence_ref,
             source.source_kind,
             source.artifact_kind,
             source.occurred_at,
             source.display_name,
             source.note_excerpt,
             source.review_state,
             source.client_visibility,
             source.mime_family,
             source.byte_size,
             source.availability,
             source.inspection_state,
             source.deck_design_ref
           ) as artifact,
           case
             when source.source_data_invalid then
               pg_catalog.jsonb_build_object(
                 'kind', 'unavailable', 'code', 'SOURCE_DATA_INVALID'
               )
             when source.inline_text is not null
                  and source.availability = 'available'
                  and source.mime_family = 'text'
                  and source.inspection_state in ('not_required', 'passed')
                  and private.agent_p2_optional_canonical_text(
                    source.inline_text, 12000, 48000, true
                  ) is not distinct from source.inline_text then
               pg_catalog.jsonb_build_object(
                 'kind', 'inline_text',
                 'text', source.inline_text,
                 'content_kind', 'untrusted_business_data'
               )
             when source.availability = 'available'
                  and source.inspection_state in ('not_required', 'passed')
                  and source.mime_family in ('image', 'pdf')
                  and source.raw_locator is not null
                  and source.raw_mime_type is not null
                  and private.agent_p2_artifact_mime_family(
                    source.raw_mime_type
                  ) = source.mime_family
                  and source.raw_byte_size = source.byte_size
                  and (
                    source.mime_family = 'image'
                      and source.raw_byte_size between 1 and 26214400
                    or source.mime_family = 'pdf'
                      and source.raw_byte_size between 1 and 52428800
                  ) then
               pg_catalog.jsonb_build_object(
                 'kind', 'binary_resource',
                 'delivery_state', 'ready_for_single_use_delivery',
                 'mime_family', source.mime_family,
                 'byte_size', source.byte_size
               )
             when source.availability = 'pending'
                  or source.inspection_state = 'pending' then
               pg_catalog.jsonb_build_object(
                 'kind', 'unavailable', 'code', 'SOURCE_PENDING'
               )
             when source.availability = 'blocked'
                  or source.inspection_state = 'failed' then
               pg_catalog.jsonb_build_object(
                 'kind', 'unavailable', 'code', 'SOURCE_BLOCKED'
               )
             when source.availability = 'available' then
               pg_catalog.jsonb_build_object(
                 'kind', 'unavailable', 'code', 'SOURCE_DATA_INVALID'
               )
             else
               pg_catalog.jsonb_build_object(
                 'kind', 'unavailable', 'code', 'SOURCE_UNAVAILABLE'
               )
           end as content
    from selected_source source
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
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'capability_manifest_revision',
               p_capability_manifest_revision,
             'required_oauth_scopes',
               pg_catalog.to_jsonb(p_required_oauth_scopes),
             'resolved_permission_scopes',
               p_resolved_permission_scopes,
             'source_kinds', pg_catalog.to_jsonb(p_source_kinds),
             'read_at', private.agent_rfc3339_utc(context.read_at),
             'source_revisions', context.source_revisions,
             'job_ref', pg_catalog.jsonb_build_object(
               'kind', p_job_kind, 'id', p_job_id
             ),
             'selected_source_kind', p_source_kind,
             'requested_evidence_ref', p_evidence_ref,
             'source_inspected', source_state.source_count
           ) as value
    from read_context context
    cross join source_state
  ), proof_projection as materialized (
    select context.value || pg_catalog.jsonb_build_object(
             'artifact', selected.artifact,
             'content', selected.content,
             'source_id', selected.source_id,
             'proof_ref',
               'ops_proof:v1:' || pg_catalog.encode(
                 extensions.digest(
                   pg_catalog.convert_to(
                     private.canonical_agent_projection_json(
                       context.value || pg_catalog.jsonb_build_object(
                         'proof_kind', 'artifact_exact_entity',
                         'source_identity', pg_catalog.jsonb_build_object(
                           'source_kind', selected.source_kind,
                           'source_id', selected.source_id
                         ),
                         'artifact', selected.artifact,
                         'content', selected.content
                       )
                     ),
                     'UTF8'
                   ),
                   'sha256'
                 ),
                 'hex'
               )
           ) as result
    from proof_context context
    cross join selected_state
    join selected_projection selected
      on selected_state.selected_count = 1
  )
  select projection.result,
         state.source_count,
         selected_state.selected_count
    into v_result,
         v_source_count,
         v_selected_count
  from read_context context
  cross join source_state state
  cross join selected_state
  left join proof_projection projection on true;

  if not found then
    raise exception 'agent_artifact_read_unauthorized' using errcode = '42501';
  end if;
  if v_source_count >= p_source_limit then
    raise exception 'agent_artifact_source_query_bound' using errcode = '54000';
  end if;
  if v_selected_count = 0 then
    raise exception 'agent_artifact_not_found_or_not_visible'
      using errcode = 'P0002';
  end if;
  if v_selected_count <> 1 or v_result is null then
    raise exception 'agent_artifact_source_data_invalid' using errcode = '22000';
  end if;
  if pg_catalog.char_length(v_result::text) > 60000 then
    raise exception 'agent_artifact_result_bound' using errcode = '54000';
  end if;
  return v_result;
end;
$function$;

revoke all on function private.agent_p2_artifact_evidence_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,
  uuid,text[],text,text,integer
) from public, anon, authenticated, service_role;

-- Frozen artifact-attention adapter for later site-visit, queue, and overview
-- reads. Those callers retain their own OAuth/capability boundary; this helper
-- independently re-proves the actor permission snapshot and parent authority.
create or replace function private.agent_p2_artifact_attention_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_resolved_permission_scopes jsonb,
  p_job_kind text,
  p_job_id uuid,
  p_source_kinds text[],
  p_item_limit integer,
  p_source_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_source_count integer;
begin
  if auth.role() is distinct from 'service_role'
     or p_item_limit is null
     or p_item_limit not between 1 and 25
     or p_source_limit is distinct from 501 then
    raise exception 'invalid_agent_artifact_attention_request'
      using errcode = '22023';
  end if;

  with evidence_source as materialized (
    select source.*
    from private.agent_p2_artifact_private_evidence_v1(
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_resolved_permission_scopes,
      p_job_kind,
      p_job_id,
      p_source_kinds,
      p_source_limit
    ) source
  ), source_state as materialized (
    select pg_catalog.count(*)::integer as source_count,
           pg_catalog.count(*) filter (
             where source.availability = 'available'
           )::integer as available_count,
           pg_catalog.count(*) filter (
             where source.availability = 'pending'
           )::integer as pending_count,
           pg_catalog.count(*) filter (
             where source.availability = 'blocked'
           )::integer as blocked_count,
           pg_catalog.count(*) filter (
             where source.availability = 'unavailable'
           )::integer as unavailable_count,
           coalesce(
             pg_catalog.bool_or(source.source_data_invalid), false
           ) as source_invalid
    from evidence_source source
  ), bounded_source as materialized (
    select source.*
    from evidence_source source
    cross join source_state state
    where state.source_count < 501
      and not state.source_invalid
    order by source.occurred_at desc,
             source.source_kind collate "C",
             source.evidence_ref collate "C"
    limit p_item_limit + 1
  ), retained_source as materialized (
    select source.*
    from bounded_source source
    order by source.occurred_at desc,
             source.source_kind collate "C",
             source.evidence_ref collate "C"
    limit p_item_limit
  ), aggregated as materialized (
    select coalesce(pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'evidence_ref', source.evidence_ref,
               'source_kind', source.source_kind,
               'artifact_kind', source.artifact_kind,
               'occurred_at', private.agent_rfc3339_utc(source.occurred_at),
               'availability', source.availability,
               'inspection_state', source.inspection_state
             ) order by source.occurred_at desc,
                        source.source_kind collate "C",
                        source.evidence_ref collate "C"
           ), '[]'::jsonb) as cards,
           (select pg_catalog.count(*) > p_item_limit from bounded_source)
             as has_more
    from retained_source source
  )
  select pg_catalog.jsonb_build_object(
           'job_ref', pg_catalog.jsonb_build_object(
             'kind', p_job_kind, 'id', p_job_id
           ),
           'source_kinds', pg_catalog.to_jsonb(p_source_kinds),
           'source_inspected_count', state.source_count,
           'returned_count', pg_catalog.jsonb_array_length(cards.cards),
           'has_more', cards.has_more,
           'counts', pg_catalog.jsonb_build_object(
             'available', state.available_count,
             'pending', state.pending_count,
             'blocked', state.blocked_count,
             'unavailable', state.unavailable_count
           ),
           'cards', cards.cards
         ),
         state.source_count
    into v_result,
         v_source_count
  from source_state state
  cross join aggregated cards
  where not state.source_invalid;

  if v_source_count >= p_source_limit then
    raise exception 'agent_artifact_attention_source_bound'
      using errcode = '54000';
  end if;
  if v_result is null then
    raise exception 'agent_artifact_attention_source_data_invalid'
      using errcode = '22000';
  end if;
  return v_result;
end;
$function$;

revoke all on function private.agent_p2_artifact_attention_v1(
  uuid,uuid,text,text[],jsonb,text,uuid,text[],integer,integer
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_job_artifacts_as_system(
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
  p_job_kind text,
  p_job_id uuid,
  p_source_kinds text[],
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer,
  p_cursor_read_at timestamptz,
  p_cursor_source_revisions jsonb,
  p_after_occurred_at timestamptz,
  p_after_source_kind text,
  p_after_evidence_ref text
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
     or p_capability_id is distinct from 'list_job_artifacts'
     or p_capability_revision is distinct from
       'list_job_artifacts:2026-08-22.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-22.capability-manifest.v8' then
    raise exception 'invalid_agent_artifact_list_request'
      using errcode = '22023';
  end if;

  return private.agent_p2_artifact_list_v1(
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
    p_job_kind,
    p_job_id,
    p_source_kinds,
    p_item_limit,
    p_page_fetch_limit,
    p_source_limit,
    p_cursor_read_at,
    p_cursor_source_revisions,
    p_after_occurred_at,
    p_after_source_kind,
    p_after_evidence_ref
  );
end;
$function$;

revoke all on function public.read_agent_job_artifacts_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,
  text,uuid,text[],integer,integer,integer,timestamp with time zone,jsonb,
  timestamp with time zone,text,text
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_job_artifact_evidence_as_system(
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
  p_job_kind text,
  p_job_id uuid,
  p_source_kinds text[],
  p_source_kind text,
  p_evidence_ref text,
  p_source_limit integer
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
     or p_capability_id is distinct from 'get_job_artifact_evidence'
     or p_capability_revision is distinct from
       'get_job_artifact_evidence:2026-08-22.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-22.capability-manifest.v8' then
    raise exception 'invalid_agent_artifact_evidence_request'
      using errcode = '22023';
  end if;

  return private.agent_p2_artifact_evidence_v1(
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
    p_job_kind,
    p_job_id,
    p_source_kinds,
    p_source_kind,
    p_evidence_ref,
    p_source_limit
  );
end;
$function$;

revoke all on function public.read_agent_job_artifact_evidence_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,
  text,uuid,text[],text,text,integer
) from public, anon, authenticated, service_role;

alter function private.agent_p2_artifact_uuid_from_text(text)
  owner to current_user;
alter function private.agent_p2_artifact_safe_timestamp(
  timestamp with time zone
) owner to current_user;
alter function private.agent_p2_artifact_mime_family(text)
  owner to current_user;
alter function private.agent_p2_artifact_private_evidence_v1(
  uuid,uuid,text,text[],jsonb,text,uuid,text[],integer
) owner to current_user;
alter function private.agent_p2_artifact_metadata_v1(
  text,text,text,timestamp with time zone,text,text,text,text,text,bigint,
  text,text,text
) owner to current_user;
alter function private.agent_p2_artifact_list_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,
  uuid,text[],integer,integer,integer,timestamp with time zone,jsonb,
  timestamp with time zone,text,text
) owner to current_user;
alter function private.agent_p2_artifact_evidence_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,
  uuid,text[],text,text,integer
) owner to current_user;
alter function private.agent_p2_artifact_attention_v1(
  uuid,uuid,text,text[],jsonb,text,uuid,text[],integer,integer
) owner to current_user;
alter function public.read_agent_job_artifacts_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,
  text,uuid,text[],integer,integer,integer,timestamp with time zone,jsonb,
  timestamp with time zone,text,text
) owner to current_user;
alter function public.read_agent_job_artifact_evidence_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,
  text,uuid,text[],text,text,integer
) owner to current_user;

-- CREATE FUNCTION defaults EXECUTE to PUBLIC. Normalize every Task 10
-- function to owner-only before granting the two fixed public RPCs.
do $canonical_acl$
declare
  v_signature text;
  v_function_oid oid;
  v_acl record;
begin
  foreach v_signature in array array[
    'private.agent_p2_artifact_uuid_from_text(text)',
    'private.agent_p2_artifact_safe_timestamp(timestamp with time zone)',
    'private.agent_p2_artifact_mime_family(text)',
    'private.agent_p2_artifact_private_evidence_v1(uuid,uuid,text,text[],jsonb,text,uuid,text[],integer)',
    'private.agent_p2_artifact_metadata_v1(text,text,text,timestamp with time zone,text,text,text,text,text,bigint,text,text,text)',
    'private.agent_p2_artifact_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,text)',
    'private.agent_p2_artifact_evidence_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],text,text,integer)',
    'private.agent_p2_artifact_attention_v1(uuid,uuid,text,text[],jsonb,text,uuid,text[],integer,integer)',
    'public.read_agent_job_artifacts_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,text)',
    'public.read_agent_job_artifact_evidence_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],text,text,integer)'
  ]::text[] loop
    v_function_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    if v_function_oid is null then
      raise exception 'agent_artifact_acl_function_missing:%', v_signature;
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
        raise exception 'agent_artifact_acl_role_missing:%', v_signature;
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

grant execute on function public.read_agent_job_artifacts_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,
  text,uuid,text[],integer,integer,integer,timestamp with time zone,jsonb,
  timestamp with time zone,text,text
) to service_role;
grant execute on function public.read_agent_job_artifact_evidence_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,
  text,uuid,text[],text,text,integer
) to service_role;

do $postflight$
declare
  expected record;
  v_function_oid oid;
  v_acl_entries text[];
  v_expected_acl text[];
  v_actual_public_signatures text[];
begin
  select coalesce(pg_catalog.array_agg(
           namespace.nspname || '.' || function_row.proname || '(' ||
           pg_catalog.replace(
             pg_catalog.oidvectortypes(function_row.proargtypes), ', ', ','
           ) || ')'
           order by function_row.proname, function_row.oid
         ), array[]::text[])
    into v_actual_public_signatures
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace namespace
    on namespace.oid = function_row.pronamespace
  where namespace.nspname = 'public'
    and function_row.proname in (
      'read_agent_job_artifacts_as_system',
      'read_agent_job_artifact_evidence_as_system'
    );
  if v_actual_public_signatures is distinct from array[
    'public.read_agent_job_artifact_evidence_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],text,text,integer)',
    'public.read_agent_job_artifacts_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,text)'
  ]::text[] then
    raise exception 'agent_artifact_public_signature_set_failed';
  end if;

  for expected in
    select *
    from (values
      ('private.agent_p2_artifact_uuid_from_text(text)', 'plpgsql', false, 'i', false),
      ('private.agent_p2_artifact_safe_timestamp(timestamp with time zone)', 'sql', false, 'i', false),
      ('private.agent_p2_artifact_mime_family(text)', 'sql', false, 'i', false),
      ('private.agent_p2_artifact_private_evidence_v1(uuid,uuid,text,text[],jsonb,text,uuid,text[],integer)', 'plpgsql', false, 's', false),
      ('private.agent_p2_artifact_metadata_v1(text,text,text,timestamp with time zone,text,text,text,text,text,bigint,text,text,text)', 'plpgsql', false, 's', false),
      ('private.agent_p2_artifact_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,text)', 'plpgsql', false, 's', false),
      ('private.agent_p2_artifact_evidence_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],text,text,integer)', 'plpgsql', false, 's', false),
      ('private.agent_p2_artifact_attention_v1(uuid,uuid,text,text[],jsonb,text,uuid,text[],integer,integer)', 'plpgsql', false, 's', false),
      ('public.read_agent_job_artifacts_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,text,text)', 'plpgsql', true, 's', true),
      ('public.read_agent_job_artifact_evidence_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text[],jsonb,text,uuid,text[],text,text,integer)', 'plpgsql', true, 's', true)
    ) shape(signature, language_name, security_definer, volatility, service_execute)
  loop
    v_function_oid := pg_catalog.to_regprocedure(expected.signature)::oid;
    if v_function_oid is null or not exists (
      select 1
      from pg_catalog.pg_proc function_row
      join pg_catalog.pg_language language_row
        on language_row.oid = function_row.prolang
      where function_row.oid = v_function_oid
        and function_row.proowner = current_user::regrole
        and function_row.prokind = 'f'::"char"
        and language_row.lanname = expected.language_name
        and function_row.prosecdef = expected.security_definer
        and function_row.provolatile = expected.volatility::"char"
        and pg_catalog.cardinality(function_row.proconfig) = 1
        and pg_catalog.replace(pg_catalog.regexp_replace(
          function_row.proconfig[1], '[[:space:]]+', '', 'g'
        ), '""', '') = 'search_path='
    ) then
      raise exception 'agent_artifact_function_shape_failed:%',
        expected.signature;
    end if;

    select coalesce(pg_catalog.array_agg(
             entry.value order by entry.value
           ), array[]::text[])
      into v_acl_entries
    from (
      select distinct
        case when acl.grantee = 0 then 'PUBLIC'
          else coalesce(
            role_row.rolname, 'OID:' || acl.grantee::text
          ) end || ':' || acl.privilege_type || ':' ||
          acl.is_grantable::text as value
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
    ) entry;
    v_expected_acl := case when expected.service_execute then
      array['service_role:EXECUTE:false']::text[]
    else array[]::text[] end;
    if v_acl_entries is distinct from v_expected_acl then
      raise exception 'agent_artifact_function_acl_failed:%',
        expected.signature;
    end if;
  end loop;
end;
$postflight$;

notify pgrst, 'reload schema';

commit;
