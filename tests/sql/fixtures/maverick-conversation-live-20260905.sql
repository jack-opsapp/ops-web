-- Frozen live function definitions read from ops-app on 2026-09-05.
-- Includes the broken pre-repair implementation: tests must fail before the corrective migration.
-- Authority/tenancy helpers are installed from the existing production-typed P2 baseline.
CREATE OR REPLACE FUNCTION private.read_agent_job_conversation_context_v3_impl(p_request_id text, p_actor_user_id uuid, p_company_id uuid, p_permission_snapshot_revision text, p_registered_permission_keys text[], p_capability_id text, p_capability_revision text, p_capability_manifest_revision text, p_required_oauth_scopes text[], p_inbox_scope text, p_clients_scope text, p_job_permission text, p_job_scope text, p_job_kind text, p_job_id uuid, p_exact_turn_limit integer DEFAULT 20, p_sections text[] DEFAULT ARRAY['memory'::text, 'recent_turns'::text, 'participants'::text, 'gaps'::text, 'cross_job_seed'::text], p_required_through_turn_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
AS $function$
declare
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_request_id is null
     or p_request_id is distinct from btrim(p_request_id)
     or length(p_request_id) = 0
     or length(p_request_id) > 256
     or p_actor_user_id is null
     or p_company_id is null
     or p_permission_snapshot_revision is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_registered_permission_keys is null
     or cardinality(p_registered_permission_keys) = 0
     or cardinality(p_registered_permission_keys) > 256
     or not ('clients.view' = any(p_registered_permission_keys))
     or not ('inbox.view' = any(p_registered_permission_keys))
     or p_capability_id
       is distinct from 'get_job_conversation_context'
     or p_capability_revision
       is distinct from
         'get_job_conversation_context:2026-08-07.v1'
     or p_capability_manifest_revision
       is distinct from '2026-08-11.capability-manifest.v3'
     or p_required_oauth_scopes is distinct from array[
       'ops.correspondence.read',
       'ops.customer_contacts.read',
       'ops.customers.read',
       'ops.jobs.read'
     ]::text[]
     or p_inbox_scope is distinct from 'all'
     or p_clients_scope is distinct from 'all'
     or p_job_kind is null
     or p_job_kind not in ('opportunity', 'project')
     or p_job_id is null
     or p_job_permission is null
     or p_job_permission is distinct from (case p_job_kind
       when 'opportunity' then 'pipeline.view'
       when 'project' then 'projects.view'
     end)
     or p_job_scope is null
     or p_job_scope not in ('all', 'assigned')
     or p_exact_turn_limit is null
     or p_exact_turn_limit < 1
     or p_exact_turn_limit > 50
     or p_sections is null
     or cardinality(p_sections) < 1
     or cardinality(p_sections) > 5 then
    raise exception 'invalid_agent_job_conversation_context_request'
      using errcode = '22023';
  end if;

  if not (p_job_permission = any(p_registered_permission_keys))
     or exists (
       select 1
       from unnest(p_registered_permission_keys) registry(permission_key)
       where registry.permission_key is null
          or registry.permission_key
            is distinct from btrim(registry.permission_key)
          or length(registry.permission_key) = 0
          or length(registry.permission_key) > 128
     )
     or (
       select count(distinct registry.permission_key)
       from unnest(p_registered_permission_keys) registry(permission_key)
     ) <> cardinality(p_registered_permission_keys)
     or exists (
       select 1
       from unnest(p_sections) requested(section)
       where requested.section is null
          or requested.section not in (
            'memory',
            'recent_turns',
            'participants',
            'gaps',
            'cross_job_seed'
          )
     )
     or (
       select count(distinct requested.section)
       from unnest(p_sections) requested(section)
     ) <> cardinality(p_sections) then
    raise exception 'invalid_agent_job_conversation_context_request'
      using errcode = '22023';
  end if;

  -- This is deliberately one source statement. The service-role caller may
  -- not authorize in one statement and fetch in another: every source row is
  -- reached only through the current authority and requested-anchor CTEs.
  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'inbox.view'
           ) as inbox_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = 'clients.view'
           ) as clients_scope,
           max(permission.value ->> 'scope') filter (
             where permission.value ->> 'permission' = p_job_permission
           ) as job_scope
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      p_registered_permission_keys
    ) authority
    cross join lateral jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    group by authority.permission_snapshot_revision
  ), requested_anchor as materialized (
    select anchor.conversation_id,
           conversation.current_memory_version_id,
           conversation.last_turn_sequence,
           conversation.source_state_revision,
           conversation.created_at as conversation_created_at,
           coalesce(opportunity.client_id, project.client_id) as client_id,
           opportunity.id as opportunity_id
    from current_authority authority
    join public.job_conversation_anchors anchor
      on anchor.company_id = p_company_id
     and anchor.anchor_kind = p_job_kind
     and anchor.source_id = p_job_id
    join public.job_conversations conversation
      on conversation.company_id = anchor.company_id
     and conversation.id = anchor.conversation_id
    left join public.opportunities opportunity
      on anchor.anchor_kind = 'opportunity'
     and opportunity.company_id = anchor.company_id
     and opportunity.id = anchor.opportunity_id
     and opportunity.deleted_at is null
     and opportunity.merged_into_opportunity_id is null
    left join public.projects project
      on anchor.anchor_kind = 'project'
     and project.company_id = anchor.company_id
     and project.id = anchor.project_id
     and project.deleted_at is null
    where authority.permission_snapshot_revision
            = p_permission_snapshot_revision
      and authority.inbox_scope = 'all'
      and authority.inbox_scope = p_inbox_scope
      and authority.clients_scope = p_clients_scope
      and authority.job_scope = p_job_scope
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        p_job_kind,
        p_job_id,
        'view'
      )
      and (
        coalesce(opportunity.client_id, project.client_id) is null
        or exists (
          select 1
          from public.clients client
          where client.company_id = p_company_id
            and client.id = coalesce(
              opportunity.client_id,
              project.client_id
            )
            and client.deleted_at is null
            and client.merged_into_client_id is null
            and private.agent_user_can_access_entity(
              p_actor_user_id,
              p_company_id,
              'client',
              client.id,
              'view'
            )
        )
      )
  ), memory_state as materialized (
    select requested.*,
           version.id as memory_version_id,
           version.version_number,
           version.turn_high_watermark_id,
           version.turn_high_watermark_sequence,
           version.source_state_revision as memory_source_state_revision,
           version.memory_document,
           version.memory_document_hash,
           version.generator_revision,
           version.created_at as memory_created_at
    from requested_anchor requested
    left join public.job_memory_versions version
      on version.company_id = p_company_id
     and version.conversation_id = requested.conversation_id
     and version.id = requested.current_memory_version_id
  ), memory_evidence_link as materialized (
    select evidence.evidence_id,
           evidence.relationship,
           evidence.source_entity_id::uuid as turn_id
    from memory_state memory
    join public.job_memory_version_evidence evidence
      on evidence.company_id = p_company_id
     and evidence.conversation_id = memory.conversation_id
     and evidence.memory_version_id = memory.memory_version_id
    where evidence.evidence_id =
      'job_conversation_turn:' || evidence.source_entity_id
      and evidence.source_entity_id ~ (
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-' ||
        '[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
  ), invalidated_memory_evidence as materialized (
    select distinct link.evidence_id
    from memory_state memory
    join memory_evidence_link link on true
    join public.job_conversation_redaction_events redaction
      on redaction.company_id = p_company_id
     and redaction.conversation_id = memory.conversation_id
     and redaction.target_turn_id = link.turn_id
      and redaction.source_state_revision
        > memory.memory_source_state_revision
  ), invalidated_evidence_ranked as materialized (
    select invalidated.evidence_id,
           row_number() over (
             order by invalidated.evidence_id
           ) as invalidated_rank
    from invalidated_memory_evidence invalidated
  ), valid_memory_evidence as materialized (
    select link.*
    from memory_evidence_link link
    where not exists (
      select 1
      from invalidated_memory_evidence invalidated
      where invalidated.evidence_id = link.evidence_id
    )
  ), recent_candidate as materialized (
    select recent.id,
           recent.turn_sequence,
           sum(recent.payload_octets) over (
             order by recent.turn_sequence desc
             rows between unbounded preceding and current row
           ) as recent_payload_octets
    from requested_anchor requested
    cross join lateral (
      select turn.id,
             turn.turn_sequence,
             octet_length(turn.normalized_plain_text)
               + octet_length(coalesce(turn.subject, ''))
               + octet_length(to_jsonb(turn.recipient_identities)::text)
               + octet_length(to_jsonb(turn.cc_recipient_identities)::text)
               + octet_length(to_jsonb(turn.attachment_evidence_ids)::text)
               + 2048 as payload_octets
      from public.job_conversation_turns turn
      where turn.company_id = p_company_id
        and turn.conversation_id = requested.conversation_id
        and 'recent_turns' = any(p_sections)
      order by turn.turn_sequence desc
      limit p_exact_turn_limit
    ) recent
  ), recent_id as materialized (
    select recent.id, recent.turn_sequence
    from recent_candidate recent
    where recent.recent_payload_octets <= 50000
  ), required_turn as materialized (
    select turn.id, turn.turn_sequence, turn.delivered_at
    from requested_anchor requested
    join public.job_conversation_turns turn
      on p_required_through_turn_id is not null
     and turn.company_id = p_company_id
     and turn.conversation_id = requested.conversation_id
     and turn.id = p_required_through_turn_id
  ), evidence_id_candidate as materialized (
    select required.id, required.delivered_at
    from required_turn required
    union
    select distinct turn.id, turn.delivered_at
    from valid_memory_evidence link
    join requested_anchor requested on true
    join public.job_conversation_turns turn
      on turn.company_id = p_company_id
     and turn.conversation_id = requested.conversation_id
     and turn.id = link.turn_id
    where 'memory' = any(p_sections)
  ), evidence_id_ranked as materialized (
    select candidate.id,
           row_number() over (
             order by
               (candidate.id = p_required_through_turn_id) desc,
               candidate.delivered_at desc,
               candidate.id
           ) as evidence_rank
    from evidence_id_candidate candidate
  ), bounded_evidence_id as materialized (
    select evidence.id, evidence.evidence_rank
    from evidence_id_ranked evidence
    where evidence.evidence_rank <= 20
  ), authorized_recent_turn as materialized (
    select turn.id,
           turn.turn_sequence,
           turn.source_state_revision,
           turn.side,
           turn.participant_id,
           turn.participant_resolution_status,
           turn.participant_resolution_revision,
           turn.direction,
           turn.channel,
           context_provider_source.delivered_at,
           turn.ingested_at,
           context_provider_source.connection_id,
           context_provider_source.provider_message_id,
           turn.provider_delivery_source_id,
           context_provider_source.source_sha256,
           turn.source_activity_id,
           turn.source_correspondence_event_id,
           context_provider_source.normalized_subject,
           context_provider_source.recipient_identities,
           context_provider_source.cc_recipient_identities,
           context_provider_source.normalized_plain_text,
           context_provider_source.source_sha256,
           context_provider_source.attachment_evidence_ids
    from requested_anchor requested
    join recent_id recent on true
    join public.job_conversation_turns turn
      on turn.company_id = p_company_id
     and turn.conversation_id = requested.conversation_id
     and turn.id = recent.id
    join private.agent_provider_delivery_sources context_provider_source
      on context_provider_source.company_id = turn.company_id
     and context_provider_source.id = turn.provider_delivery_source_id
     and context_provider_source.source_sha256
       = turn.provider_delivery_source_sha256
     and context_provider_source.connection_id = turn.source_connection_id
     and context_provider_source.provider_message_id = turn.provider_message_id
    where private.user_can_view_inbox_connection(
      p_actor_user_id,
      p_company_id,
      turn.source_connection_id,
      requested.opportunity_id
    )
      and private.assert_agent_job_context_provider_source(
        context_provider_source.normalization_status,
        context_provider_source.normalized_plain_text,
        context_provider_source.attachment_enumeration_complete
      )
  ), effective_recent_turn as materialized (
    select turn.id,
           turn.turn_sequence,
           turn.source_state_revision,
           case
             when coalesce(redaction.participant_redacted, false) then null
             else turn.side
           end as side,
           case
             when coalesce(redaction.participant_redacted, false)
               then '[PARTICIPANT REDACTED]'
             else turn.participant_id
           end as participant_id,
           case
             when coalesce(redaction.participant_redacted, false)
               then 'unresolved'
             else turn.participant_resolution_status
           end as participant_resolution_status,
           case
             when coalesce(redaction.participant_redacted, false) then
               'job-participant-redaction:v1:' ||
               redaction.max_source_state_revision::text
             else turn.participant_resolution_revision
           end as participant_resolution_revision,
           turn.direction,
           turn.channel,
           turn.delivered_at,
           turn.ingested_at,
           turn.source_connection_id,
           turn.provider_message_id,
           turn.provider_delivery_source_id,
           case
             when coalesce(redaction.has_redaction, false) then null
             else turn.provider_delivery_source_sha256
           end as provider_delivery_source_sha256,
           turn.source_activity_id,
           turn.source_correspondence_event_id,
           case
             when coalesce(redaction.content_redacted, false)
               then '[SUBJECT REDACTED]'
             else turn.subject
           end as subject,
           case
             when coalesce(redaction.participant_redacted, false)
               then '{}'::text[]
             else turn.recipient_identities
           end as recipient_identities,
           case
             when coalesce(redaction.participant_redacted, false)
               then '{}'::text[]
             else turn.cc_recipient_identities
           end as cc_recipient_identities,
           case
             when coalesce(redaction.content_redacted, false)
               then '[CONTENT REDACTED]'
             else turn.normalized_plain_text
           end as normalized_plain_text,
           case
             when coalesce(redaction.has_redaction, false) then
               'sha256:' || encode(
                 extensions.digest(
                   convert_to(
                     'ops.redacted-source-version.v2:' ||
                       turn.id::text || ':' ||
                       turn.provider_delivery_source_sha256 || ':' ||
                       turn.original_content_hash || ':' ||
                       redaction.max_source_state_revision::text || ':' ||
                       array_to_string(redaction.kinds, ','),
                     'UTF8'
                   ),
                   'sha256'
                 ),
                 'hex'
               )
             else turn.original_content_hash
           end as original_content_hash,
           case
             when coalesce(redaction.attachment_redacted, false)
               then '{}'::text[]
             else turn.attachment_evidence_ids
           end as attachment_evidence_ids,
           'job-conversation-turn-projection:v1:' ||
             greatest(
               turn.source_state_revision,
               coalesce(redaction.max_source_state_revision, 0)
             )::text as evidence_source_revision,
           'sha256:' || encode(
             extensions.digest(
               convert_to(
                 jsonb_build_object(
                   'schema', 'ops.job-conversation-turn-projection.v1',
                   'turn_id', turn.id,
                   'provider_source_sha256',
                     turn.provider_delivery_source_sha256,
                   'subject', case
                     when coalesce(redaction.content_redacted, false)
                       then '[SUBJECT REDACTED]'
                     else turn.subject
                   end,
                   'participant_id', case
                     when coalesce(redaction.participant_redacted, false)
                       then '[PARTICIPANT REDACTED]'
                     else turn.participant_id
                   end,
                   'normalized_plain_text', case
                     when coalesce(redaction.content_redacted, false)
                       then '[CONTENT REDACTED]'
                     else turn.normalized_plain_text
                   end,
                   'attachment_evidence_ids', case
                     when coalesce(redaction.attachment_redacted, false)
                       then '[]'::jsonb
                     else to_jsonb(turn.attachment_evidence_ids)
                   end,
                   'redaction_state_revision',
                     coalesce(redaction.max_source_state_revision, 0),
                   'redaction_kinds',
                     to_jsonb(coalesce(redaction.kinds, '{}'::text[]))
                 )::text,
                 'UTF8'
               ),
               'sha256'
             ),
             'hex'
           ) as evidence_content_hash,
           coalesce(redaction.kinds, '{}'::text[]) as redaction_kinds
    from authorized_recent_turn turn
    left join lateral (
      select bool_or(event.redaction_kind = 'content_redacted')
               as content_redacted,
             bool_or(event.redaction_kind = 'attachment_redacted')
               as attachment_redacted,
             bool_or(event.redaction_kind = 'participant_pseudonymized')
               as participant_redacted,
             count(event.id) > 0 as has_redaction,
             max(event.source_state_revision) as max_source_state_revision,
             array_remove(array[
               case when bool_or(
                 event.redaction_kind = 'attachment_redacted'
               ) then 'attachment_redacted' end,
               case when bool_or(
                 event.redaction_kind = 'content_redacted'
               ) then 'content_redacted' end,
               case when bool_or(
                 event.redaction_kind = 'participant_pseudonymized'
               ) then 'participant_pseudonymized' end
             ]::text[], null) as kinds
      from requested_anchor requested_redaction
      join public.job_conversation_redaction_events event
        on event.company_id = p_company_id
       and event.conversation_id = requested_redaction.conversation_id
       and event.target_turn_id = turn.id
       and event.source_state_revision
         <= requested_redaction.source_state_revision
    ) redaction on true
  ), authorized_evidence_turn as materialized (
    select bounded.evidence_rank,
           turn.id,
           turn.source_state_revision,
           turn.side,
           turn.participant_id,
           turn.participant_resolution_status,
           turn.participant_resolution_revision,
           context_provider_source.delivered_at,
           context_provider_source.source_sha256,
           context_provider_source.source_sha256,
           context_provider_source.attachment_evidence_ids,
           left(context_provider_source.normalized_plain_text, 4001) as bounded_plain_text
    from requested_anchor requested
    join bounded_evidence_id bounded on true
    join public.job_conversation_turns turn
      on turn.company_id = p_company_id
     and turn.conversation_id = requested.conversation_id
     and turn.id = bounded.id
    join private.agent_provider_delivery_sources context_provider_source
      on context_provider_source.company_id = turn.company_id
     and context_provider_source.id = turn.provider_delivery_source_id
     and context_provider_source.source_sha256
       = turn.provider_delivery_source_sha256
     and context_provider_source.connection_id = turn.source_connection_id
     and context_provider_source.provider_message_id = turn.provider_message_id
    where private.user_can_view_inbox_connection(
      p_actor_user_id,
      p_company_id,
      turn.source_connection_id,
      requested.opportunity_id
    )
      and private.assert_agent_job_context_provider_source(
        context_provider_source.normalization_status,
        context_provider_source.normalized_plain_text,
        context_provider_source.attachment_enumeration_complete
      )
  ), effective_evidence_turn as materialized (
    select turn.id,
           turn.evidence_rank,
           turn.delivered_at,
           case
             when coalesce(redaction.participant_redacted, false)
               then '[PARTICIPANT REDACTED]'
             else turn.participant_id
           end as participant_id,
           case
             when coalesce(redaction.participant_redacted, false)
               then 'unresolved'
             else turn.participant_resolution_status
           end as participant_resolution_status,
           case
             when coalesce(redaction.participant_redacted, false) then
               'job-participant-redaction:v1:' ||
               redaction.max_source_state_revision::text
             else turn.participant_resolution_revision
           end as participant_resolution_revision,
           case
             when coalesce(redaction.content_redacted, false)
               then '[CONTENT REDACTED]'
             else left(turn.bounded_plain_text, 4000)
           end as normalized_plain_text,
           case
             when coalesce(redaction.content_redacted, false) then false
             else char_length(turn.bounded_plain_text) > 4000
           end as excerpt_truncated,
           'job-conversation-evidence-projection:v2:' ||
             greatest(
               turn.source_state_revision,
               coalesce(redaction.max_source_state_revision, 0)
             )::text as evidence_source_revision,
           'sha256:' || encode(
             extensions.digest(
               convert_to(
                 jsonb_build_object(
                   'schema', 'ops.job-conversation-evidence-projection.v2',
                   'turn_id', turn.id,
                   'provider_source_sha256',
                     turn.provider_delivery_source_sha256,
                   'original_content_hash', turn.original_content_hash,
                   'participant_id', case
                     when coalesce(redaction.participant_redacted, false)
                       then '[PARTICIPANT REDACTED]'
                     else turn.participant_id
                   end,
                   'participant_resolution_revision', case
                     when coalesce(redaction.participant_redacted, false) then
                       'job-participant-redaction:v1:' ||
                       redaction.max_source_state_revision::text
                     else turn.participant_resolution_revision
                   end,
                   'excerpt', case
                     when coalesce(redaction.content_redacted, false)
                       then '[CONTENT REDACTED]'
                     else left(turn.bounded_plain_text, 4000)
                   end,
                   'excerpt_truncated', case
                     when coalesce(redaction.content_redacted, false) then false
                     else char_length(turn.bounded_plain_text) > 4000
                   end,
                   'attachment_evidence_ids', case
                     when coalesce(redaction.attachment_redacted, false)
                       then '[]'::jsonb
                     else to_jsonb(turn.attachment_evidence_ids)
                   end,
                   'redaction_state_revision',
                     coalesce(redaction.max_source_state_revision, 0),
                   'redaction_kinds',
                     to_jsonb(coalesce(redaction.kinds, '{}'::text[]))
                 )::text,
                 'UTF8'
               ),
               'sha256'
             ),
             'hex'
           ) as evidence_content_hash,
           coalesce(redaction.kinds, '{}'::text[]) as redaction_kinds
    from authorized_evidence_turn turn
    left join lateral (
      select bool_or(event.redaction_kind = 'content_redacted')
               as content_redacted,
             bool_or(event.redaction_kind = 'attachment_redacted')
               as attachment_redacted,
             bool_or(event.redaction_kind = 'participant_pseudonymized')
               as participant_redacted,
             count(event.id) > 0 as has_redaction,
             max(event.source_state_revision) as max_source_state_revision,
             array_remove(array[
               case when bool_or(
                 event.redaction_kind = 'attachment_redacted'
               ) then 'attachment_redacted' end,
               case when bool_or(
                 event.redaction_kind = 'content_redacted'
               ) then 'content_redacted' end,
               case when bool_or(
                 event.redaction_kind = 'participant_pseudonymized'
               ) then 'participant_pseudonymized' end
             ]::text[], null) as kinds
      from requested_anchor requested_redaction
      join public.job_conversation_redaction_events event
        on event.company_id = p_company_id
       and event.conversation_id = requested_redaction.conversation_id
       and event.target_turn_id = turn.id
       and event.source_state_revision
         <= requested_redaction.source_state_revision
    ) redaction on true
  ), recent_payload as materialized (
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'id', turn.id,
                 'turn_sequence', turn.turn_sequence,
                 'source_state_revision', turn.source_state_revision,
                 'side', turn.side,
                 'participant_id', turn.participant_id,
                 'participant_resolution_status',
                   turn.participant_resolution_status,
                 'participant_resolution_revision',
                   turn.participant_resolution_revision,
                 'direction', turn.direction,
                 'channel', turn.channel,
                 'delivered_at', turn.delivered_at,
                 'ingested_at', turn.ingested_at,
                 'source_connection_id', turn.source_connection_id,
                 'provider_message_id', turn.provider_message_id,
                 'provider_delivery_source_id',
                   turn.provider_delivery_source_id,
                 'provider_delivery_source_sha256',
                   turn.provider_delivery_source_sha256,
                 'source_activity_id', turn.source_activity_id,
                 'source_correspondence_event_id',
                   turn.source_correspondence_event_id,
                 'subject', turn.subject,
                 'recipient_identities',
                   to_jsonb(turn.recipient_identities),
                 'cc_recipient_identities',
                   to_jsonb(turn.cc_recipient_identities),
                 'normalized_plain_text', turn.normalized_plain_text,
                 'original_content_hash', turn.original_content_hash,
                 'attachment_evidence_ids',
                   to_jsonb(turn.attachment_evidence_ids),
                 'evidence_source_revision',
                   turn.evidence_source_revision,
                 'evidence_content_hash', turn.evidence_content_hash,
                 'redaction_kinds', to_jsonb(turn.redaction_kinds)
               ) order by recent.turn_sequence
             ),
             '[]'::jsonb
           ) as payload,
           greatest(
             0,
             (select count(*) from recent_candidate) -
               (select count(*) from recent_id)
           )::integer as omitted_count
    from recent_id recent
    join effective_recent_turn turn on turn.id = recent.id
  ), evidence_candidate as materialized (
    select turn.id,
           turn.delivered_at,
           turn.participant_id,
           turn.participant_resolution_status,
           turn.participant_resolution_revision,
           turn.normalized_plain_text,
           turn.excerpt_truncated,
           turn.evidence_source_revision,
           turn.evidence_content_hash,
           turn.redaction_kinds,
           array_remove(array[
             case when turn.id = p_required_through_turn_id
               then 'triggering_turn' end,
             case when count(link.evidence_id) > 0
               then 'active_memory_claim' end
           ]::text[], null) as purposes,
           array_remove(array[
             case when bool_or(link.relationship = 'contradicts')
               then 'contradicts' end,
             case when bool_or(link.relationship = 'supports')
               then 'supports' end,
             case when bool_or(link.relationship = 'supersedes')
               then 'supersedes' end
           ]::text[], null) as relationships,
           turn.evidence_rank
    from effective_evidence_turn turn
    left join valid_memory_evidence link on link.turn_id = turn.id
    where turn.id = p_required_through_turn_id
       or link.turn_id is not null
    group by turn.id,
             turn.evidence_rank,
             turn.delivered_at,
             turn.participant_id,
             turn.participant_resolution_status,
             turn.participant_resolution_revision,
             turn.normalized_plain_text,
             turn.excerpt_truncated,
             turn.evidence_source_revision,
             turn.evidence_content_hash,
             turn.redaction_kinds
  ), evidence_sized as materialized (
    select evidence.*,
           sum(
             octet_length(evidence.normalized_plain_text) + 2048
           ) over (
             order by evidence.evidence_rank
             rows between unbounded preceding and current row
           ) as evidence_payload_octets
    from evidence_candidate evidence
  ), evidence_payload as materialized (
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'evidence_id',
                   'job_conversation_turn:' || evidence.id::text,
                 'purposes', to_jsonb(evidence.purposes),
                 'relationships', to_jsonb(evidence.relationships),
                 'source_domain', 'job_conversation',
                 'source_type', 'delivered_email_turn',
                 'source_id', evidence.id,
                 'source_revision', evidence.evidence_source_revision,
                 'source_content_hash', evidence.evidence_content_hash,
                 'occurred_at', evidence.delivered_at,
                 'trust', 'delivered_correspondence',
                 'locator', 'ops://job-conversations/' ||
                   memory.conversation_id::text || '/turns/' ||
                   evidence.id::text,
                 'excerpt', evidence.normalized_plain_text,
                 'excerpt_truncated', evidence.excerpt_truncated,
                 'participant_id', evidence.participant_id,
                 'participant_resolution_status',
                   evidence.participant_resolution_status,
                 'participant_resolution_revision',
                   evidence.participant_resolution_revision,
                 'redaction_kinds', to_jsonb(evidence.redaction_kinds)
               ) order by evidence.evidence_rank
             ) filter (
               where evidence.evidence_rank <= 20
                 and evidence.evidence_payload_octets <= 50000
             ),
             '[]'::jsonb
           ) as payload,
           (
             select count(*)::integer
             from evidence_id_ranked all_evidence
           ) as total
    from memory_state memory
    left join evidence_sized evidence on true
  ), participant_turn as materialized (
    select turn.id,
           turn.source_state_revision,
           turn.delivered_at,
           case
             when coalesce(redaction.participant_redacted, false) then null
             else turn.side
           end as side,
           case
             when coalesce(redaction.participant_redacted, false)
               then '[PARTICIPANT REDACTED]'
             else turn.participant_id
           end as participant_id,
           case
             when coalesce(redaction.participant_redacted, false)
               then 'unresolved'
             else turn.participant_resolution_status
           end as participant_resolution_status,
           case
             when coalesce(redaction.participant_redacted, false) then
               'job-participant-redaction:v1:' ||
               redaction.max_source_state_revision::text
             else turn.participant_resolution_revision
           end as participant_resolution_revision,
           'job-conversation-participant-projection:v1:' ||
             greatest(
               turn.source_state_revision,
               coalesce(redaction.max_source_state_revision, 0)
             )::text as evidence_source_revision,
           'sha256:' || encode(
             extensions.digest(
               convert_to(
                 jsonb_build_object(
                   'schema',
                     'ops.job-conversation-participant-projection.v1',
                   'turn_id', turn.id,
                   'provider_source_sha256',
                     turn.provider_delivery_source_sha256,
                   'original_content_hash', turn.original_content_hash,
                   'side', case
                     when coalesce(redaction.participant_redacted, false)
                       then null
                     else turn.side
                   end,
                   'participant_id', case
                     when coalesce(redaction.participant_redacted, false)
                       then '[PARTICIPANT REDACTED]'
                     else turn.participant_id
                   end,
                   'participant_resolution_status', case
                     when coalesce(redaction.participant_redacted, false)
                       then 'unresolved'
                     else turn.participant_resolution_status
                   end,
                   'participant_resolution_revision', case
                     when coalesce(redaction.participant_redacted, false) then
                       'job-participant-redaction:v1:' ||
                       redaction.max_source_state_revision::text
                     else turn.participant_resolution_revision
                   end,
                   'redaction_state_revision',
                     coalesce(redaction.max_source_state_revision, 0),
                   'redaction_kinds',
                     to_jsonb(coalesce(redaction.kinds, '{}'::text[]))
                 )::text,
                 'UTF8'
               ),
               'sha256'
             ),
             'hex'
           ) as evidence_content_hash,
           coalesce(redaction.kinds, '{}'::text[]) as redaction_kinds
    from requested_anchor requested
    join public.job_conversation_turns turn
      on turn.company_id = p_company_id
     and turn.conversation_id = requested.conversation_id
    join private.agent_provider_delivery_sources provider_source
      on provider_source.company_id = turn.company_id
     and provider_source.id = turn.provider_delivery_source_id
     and provider_source.source_sha256
       = turn.provider_delivery_source_sha256
    left join lateral (
      select bool_or(
               event.redaction_kind = 'participant_pseudonymized'
             ) as participant_redacted,
             count(event.id) > 0 as has_redaction,
             max(event.source_state_revision) as max_source_state_revision,
             array_remove(array[
               case when bool_or(
                 event.redaction_kind = 'attachment_redacted'
               ) then 'attachment_redacted' end,
               case when bool_or(
                 event.redaction_kind = 'content_redacted'
               ) then 'content_redacted' end,
               case when bool_or(
                 event.redaction_kind = 'participant_pseudonymized'
               ) then 'participant_pseudonymized' end
             ]::text[], null) as kinds
      from public.job_conversation_redaction_events event
      where event.company_id = p_company_id
        and event.conversation_id = requested.conversation_id
        and event.target_turn_id = turn.id
        and event.source_state_revision <= requested.source_state_revision
    ) redaction on true
    where 'participants' = any(p_sections)
      and private.user_can_view_inbox_connection(
        p_actor_user_id,
        p_company_id,
        turn.source_connection_id,
        requested.opportunity_id
      )
  ), participant_group_summary as materialized (
    select turn.participant_id,
           turn.side,
           turn.participant_resolution_status,
           turn.participant_resolution_revision,
           count(*)::integer as evidence_id_total,
           row_number() over (
             order by turn.participant_id,
               turn.participant_resolution_revision
           ) as participant_rank
    from participant_turn turn
    group by turn.participant_id,
             turn.side,
             turn.participant_resolution_status,
             turn.participant_resolution_revision
  ), bounded_participant_group as materialized (
    select participant.*
    from participant_group_summary participant
    where participant.participant_rank <= 50
  ), bounded_participant_turn_ranked as materialized (
    select turn.id,
           turn.source_state_revision,
           turn.delivered_at,
           turn.side,
           turn.participant_id,
           turn.participant_resolution_status,
           turn.participant_resolution_revision,
           turn.evidence_source_revision,
           turn.evidence_content_hash,
           turn.redaction_kinds,
           participant.evidence_id_total,
           participant.participant_rank,
           row_number() over (
             partition by turn.participant_id,
               turn.side,
               turn.participant_resolution_status,
               turn.participant_resolution_revision
             order by turn.id
           ) as evidence_rank
    from participant_turn turn
    join bounded_participant_group participant
      on participant.participant_id = turn.participant_id
     and participant.side is not distinct from turn.side
     and participant.participant_resolution_status
       = turn.participant_resolution_status
     and participant.participant_resolution_revision
       = turn.participant_resolution_revision
  ), participant_candidate as materialized (
    select turn.participant_id,
           turn.side,
           turn.participant_resolution_status,
           turn.participant_resolution_revision,
           array_agg(
             'job_conversation_turn:' || turn.id::text
             order by 'job_conversation_turn:' || turn.id::text
           ) filter (where turn.evidence_rank <= 50) as evidence_ids,
           max(turn.evidence_id_total) as evidence_id_total,
           array_remove(array[
             case when bool_or(
               'attachment_redacted' = any(turn.redaction_kinds)
             ) then 'attachment_redacted' end,
             case when bool_or(
               'content_redacted' = any(turn.redaction_kinds)
             ) then 'content_redacted' end,
             case when bool_or(
               'participant_pseudonymized' = any(turn.redaction_kinds)
             ) then 'participant_pseudonymized' end
           ]::text[], null) as redaction_kinds,
           max(turn.participant_rank) as participant_rank
    from bounded_participant_turn_ranked turn
    group by turn.participant_id,
             turn.side,
             turn.participant_resolution_status,
             turn.participant_resolution_revision
  ), participant_with_provenance as materialized (
    select participant.*,
           turn.id as evidence_source_id,
           turn.delivered_at as evidence_occurred_at,
           turn.evidence_source_revision,
           turn.evidence_content_hash
    from participant_candidate participant
    join participant_turn turn
      on 'job_conversation_turn:' || turn.id::text
       = (participant.evidence_ids)[1]
  ), participant_payload as materialized (
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'participant_id', participant.participant_id,
                 'side', participant.side,
                 'participant_resolution_status',
                   participant.participant_resolution_status,
                 'participant_resolution_revision',
                   participant.participant_resolution_revision,
                 'evidence_ids', to_jsonb(participant.evidence_ids),
                 'evidence_id_total', participant.evidence_id_total,
                 'redaction_kinds', to_jsonb(coalesce(
                   participant.redaction_kinds,
                   '{}'::text[]
                 )),
                 'primary_evidence', jsonb_build_object(
                   'evidence_id', (participant.evidence_ids)[1],
                   'source_domain', 'job_conversation',
                   'source_type',
                     'delivered_email_participant_resolution',
                   'source_id', participant.evidence_source_id,
                   'source_revision',
                     participant.evidence_source_revision,
                   'source_content_hash',
                     participant.evidence_content_hash,
                   'occurred_at', participant.evidence_occurred_at,
                   'relationship', 'supports',
                   'locator', 'ops://job-conversations/' ||
                     memory.conversation_id::text || '/turns/' ||
                     participant.evidence_source_id::text || '#participant',
                   'trust', 'delivered_correspondence'
                 )
               ) order by participant.participant_rank
             ) filter (where participant.participant_id is not null),
             '[]'::jsonb
           ) as payload,
           (
             select count(*)::integer
             from participant_group_summary all_participants
           ) as total
    from memory_state memory
    left join participant_with_provenance participant on true
  ), prior_job_candidate as materialized (
    select prior_anchor.conversation_id,
           prior_anchor.anchor_kind,
           prior_anchor.source_id,
           coalesce(
             prior_project.client_id,
             prior_opportunity.client_id
           ) as client_id,
           coalesce(
             prior_project.completed_at::date,
             prior_project.start_date::date,
             prior_opportunity.actual_close_date::date,
             prior_opportunity.expected_close_date::date,
             prior_project.created_at::date,
             prior_opportunity.created_at::date,
             prior_conversation.created_at::date
           ) as visible_date,
           case
             when prior_anchor.anchor_kind = 'project' then case
               when lower(btrim(prior_project.status)) in (
                 'completed',
                 'complete'
               )
                 then 'completed'
               when lower(btrim(prior_project.status)) in (
                 'in progress',
                 'in_progress'
               )
                 then 'in_progress'
               when prior_project.start_date is not null
                 then 'scheduled'
               else 'active'
             end
             when lower(btrim(prior_opportunity.stage)) in (
               'converted',
               'won'
             )
               then 'converted'
             else 'active'
           end as status,
           case
             when prior_anchor.anchor_kind = 'project' then
               prior_project.id is not null
               and prior_project.deleted_at is null
               and lower(btrim(coalesce(prior_project.status, ''))) not in (
                 'cancelled',
                 'canceled',
                 'closed',
                 'archived'
               )
             else
               prior_opportunity.id is not null
               and prior_opportunity.deleted_at is null
               and prior_opportunity.merged_into_opportunity_id is null
               and prior_opportunity.archived_at is null
               and lower(btrim(coalesce(prior_opportunity.stage, ''))) not in (
                 'lost',
                 'closed',
                 'cancelled',
                 'canceled',
                 'discarded'
               )
           end as lifecycle_eligible,
           row_number() over (
             partition by prior_anchor.conversation_id
             order by
               (prior_anchor.anchor_kind = 'project') desc,
               prior_anchor.source_id
           ) as representative_rank
    from requested_anchor requested
    join public.job_conversation_anchors prior_anchor
      on prior_anchor.company_id = p_company_id
     and prior_anchor.conversation_id <> requested.conversation_id
    join public.job_conversations prior_conversation
      on prior_conversation.company_id = prior_anchor.company_id
     and prior_conversation.id = prior_anchor.conversation_id
    left join public.opportunities prior_opportunity
      on prior_anchor.anchor_kind = 'opportunity'
     and prior_opportunity.company_id = p_company_id
     and prior_opportunity.id = prior_anchor.opportunity_id
    left join public.projects prior_project
      on prior_anchor.anchor_kind = 'project'
     and prior_project.company_id = p_company_id
     and prior_project.id = prior_anchor.project_id
    where (
        prior_conversation.created_at < requested.conversation_created_at
        or (
          prior_conversation.created_at = requested.conversation_created_at
          and prior_conversation.id < requested.conversation_id
        )
      )
      and 'cross_job_seed' = any(p_sections)
  ), canonical_prior_job as materialized (
    select candidate.*
    from requested_anchor requested
    join prior_job_candidate candidate on true
    where candidate.representative_rank = 1
      and candidate.client_id = requested.client_id
      and candidate.lifecycle_eligible
      and private.agent_user_can_access_entity(
        p_actor_user_id,
        p_company_id,
        candidate.anchor_kind,
        candidate.source_id,
        'view'
      )
  ), visible_prior_job as materialized (
    select candidate.*
    from canonical_prior_job candidate
  ), latest_visible_prior_job as materialized (
    select visible.conversation_id,
           visible.visible_date,
           visible.status
    from visible_prior_job visible
    where visible.visible_date is not null
    order by visible.visible_date desc,
      visible.conversation_id
    limit 1
  ), cross_job_projection_document as materialized (
    select requested.client_id,
           count(visible.conversation_id)::integer as visible_count,
           jsonb_build_object(
             'schema', 'ops.customer-visible-prior-jobs.v1',
             'customer_id', requested.client_id,
             'actor_user_id', p_actor_user_id,
             'permission_snapshot_revision',
               p_permission_snapshot_revision,
             'visible_prior_job_count',
               count(visible.conversation_id)::integer,
             'latest_visible_prior_job', case
               when latest.conversation_id is null then null
               else jsonb_build_object(
                 'date', to_char(latest.visible_date, 'YYYY-MM-DD'),
                 'status', latest.status
               )
             end
           ) as document
    from requested_anchor requested
    left join visible_prior_job visible on true
    left join latest_visible_prior_job latest on true
    group by requested.client_id,
      latest.conversation_id,
      latest.visible_date,
      latest.status
  ), cross_job_projection as materialized (
    select projection.*,
           'sha256:' || encode(
             extensions.digest(
               convert_to(projection.document::text, 'UTF8'),
               'sha256'
             ),
             'hex'
           ) as content_hash
    from cross_job_projection_document projection
  ), cross_job_payload as materialized (
    select jsonb_build_object(
             'state', case
               when projection.client_id is null
                 then 'customer_unresolved'
               else 'available'
             end,
             'customer_has_prior_ops_jobs', case
               when projection.client_id is null then null
               else projection.visible_count > 0
             end,
             'visible_prior_job_count', case
               when projection.client_id is null then null
               else projection.visible_count
             end,
             'latest_visible_prior_job',
               case when projection.client_id is null then null
                 else projection.document -> 'latest_visible_prior_job'
               end,
             'relationship_continuity',
               case when projection.client_id is null
                 or projection.visible_count = 0 then null else
                 jsonb_build_object(
                   'marker', 'returning_customer',
                   'evidence_id', 'customer_job_history:' ||
                     projection.client_id::text
                 )
               end,
             'evidence',
               case when projection.client_id is null then null else
                 jsonb_build_object(
                   'evidence_id', 'customer_job_history:' ||
                     projection.client_id::text,
                   'source_domain', 'customer_jobs',
                   'source_type', 'visible_prior_job_snapshot',
                   'source_id', projection.client_id,
                   'source_revision',
                     'customer-job-history-projection:v1:' ||
                     projection.content_hash,
                   'source_content_hash', projection.content_hash,
                   'occurred_at', to_char(
                     statement_timestamp() at time zone 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                   ),
                   'relationship', 'supports',
                   'locator', 'ops://customers/' ||
                     projection.client_id::text || '/jobs',
                   'trust', 'authoritative_ops'
                 )
               end
           ) as payload
    from cross_job_projection projection
  ), invalidated_payload as materialized (
    select coalesce(
             jsonb_agg(
               invalidated.evidence_id order by invalidated.invalidated_rank
             ) filter (where invalidated.invalidated_rank <= 100),
             '[]'::jsonb
           ) as payload,
           (
             select count(*)::integer
             from invalidated_memory_evidence all_invalidated
           ) as total
    from invalidated_evidence_ranked invalidated
  ), required_state as materialized (
    select case
      when p_required_through_turn_id is null then 'not_requested'
      when required.id is null then 'missing'
      when memory.memory_version_id is not null
       and memory.turn_high_watermark_sequence >= required.turn_sequence
       and memory.turn_high_watermark_sequence = memory.last_turn_sequence
       and memory.memory_source_state_revision
         = memory.source_state_revision then 'summarized'
      else 'pending'
    end as state
    from memory_state memory
    left join required_turn required on true
  )
  select jsonb_build_object(
           'company_id', p_company_id,
           'conversation_id', memory.conversation_id,
           'requested_job', jsonb_build_object(
             'kind', p_job_kind,
             'id', p_job_id
           ),
           'read_at', to_char(
             statement_timestamp() at time zone 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
           ),
           'permission_snapshot_revision',
             p_permission_snapshot_revision,
           'source_state_revision', memory.source_state_revision,
           'last_turn_sequence', memory.last_turn_sequence,
           'current_version', case
             when memory.memory_version_id is null then null
             else jsonb_build_object(
               'id', memory.memory_version_id,
               'version_number', memory.version_number,
               'turn_high_watermark_id',
                 memory.turn_high_watermark_id,
               'turn_high_watermark_sequence',
                 memory.turn_high_watermark_sequence,
               'source_state_revision',
                 memory.memory_source_state_revision,
               'memory_document', memory.memory_document,
               'memory_document_hash', memory.memory_document_hash,
               'generator_revision', memory.generator_revision,
               'created_at', memory.memory_created_at
             )
           end,
           'recent_turns', recent.payload,
           'recent_turns_omitted_count', recent.omitted_count,
           'active_evidence', evidence.payload,
           'active_evidence_total', evidence.total,
           'participants', participant.payload,
           'participant_total', participant.total,
           'cross_job_seed', cross_job.payload,
           'invalidated_evidence_ids', invalidated.payload,
           'invalidated_evidence_total', invalidated.total,
           'required_through', jsonb_build_object(
             'turn_id', p_required_through_turn_id,
             'state', required.state
           )
         )
  into v_result
  from memory_state memory
  cross join recent_payload recent
  cross join evidence_payload evidence
  cross join participant_payload participant
  cross join cross_job_payload cross_job
  cross join invalidated_payload invalidated
  cross join required_state required;

  if v_result is null then
    raise exception 'agent_job_conversation_context_not_found'
      using errcode = 'P0002';
  end if;
  return v_result;
end;
$function$
;
revoke all on function private.read_agent_job_conversation_context_v3_impl(text, uuid, uuid, text, text[], text, text, text, text[], text, text, text, text, text, uuid, integer, text[], uuid) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.read_agent_job_conversation_context_as_system_v6_core(p_request_id text, p_actor_user_id uuid, p_company_id uuid, p_permission_snapshot_revision text, p_registered_permission_keys text[], p_capability_id text, p_capability_revision text, p_capability_manifest_revision text, p_required_oauth_scopes text[], p_inbox_scope text, p_clients_scope text, p_job_permission text, p_job_scope text, p_job_kind text, p_job_id uuid, p_exact_turn_limit integer DEFAULT 20, p_sections text[] DEFAULT ARRAY['memory'::text, 'recent_turns'::text, 'participants'::text, 'gaps'::text, 'cross_job_seed'::text], p_required_through_turn_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is distinct from
       '2026-08-14.capability-manifest.v6' then
    raise exception 'invalid_agent_job_conversation_context_request'
      using errcode = '22023';
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    private.read_agent_job_conversation_context_v6_bridge(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_capability_id,
      p_capability_revision,
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
    ),
    p_capability_manifest_revision
  );
end;
$function$
;
revoke all on function private.read_agent_job_conversation_context_as_system_v6_core(text, uuid, uuid, text, text[], text, text, text, text[], text, text, text, text, text, uuid, integer, text[], uuid) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.read_agent_job_conversation_context_as_system_v7_core(p_request_id text, p_actor_user_id uuid, p_company_id uuid, p_permission_snapshot_revision text, p_registered_permission_keys text[], p_capability_id text, p_capability_revision text, p_capability_manifest_revision text, p_required_oauth_scopes text[], p_inbox_scope text, p_clients_scope text, p_job_permission text, p_job_scope text, p_job_kind text, p_job_id uuid, p_exact_turn_limit integer DEFAULT 20, p_sections text[] DEFAULT ARRAY['memory'::text, 'recent_turns'::text, 'participants'::text, 'gaps'::text, 'cross_job_seed'::text], p_required_through_turn_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_v6_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-14.capability-manifest.v6',
       '2026-08-20.capability-manifest.v7'
     ) then
    raise exception 'invalid_agent_job_conversation_context_request'
      using errcode = '22023';
  end if;
  v_v6_result :=
    private.read_agent_job_conversation_context_as_system_v6_core(
      p_request_id,
      p_actor_user_id,
      p_company_id,
      p_permission_snapshot_revision,
      p_registered_permission_keys,
      p_capability_id,
      p_capability_revision,
      '2026-08-14.capability-manifest.v6',
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
  if p_capability_manifest_revision =
       '2026-08-14.capability-manifest.v6' then
    return v_v6_result;
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    v_v6_result,
    '2026-08-20.capability-manifest.v7'
  );
end;
$function$
;
revoke all on function private.read_agent_job_conversation_context_as_system_v7_core(text, uuid, uuid, text, text[], text, text, text, text[], text, text, text, text, text, uuid, integer, text[], uuid) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.read_agent_job_conversation_context_v4_impl(p_request_id text, p_actor_user_id uuid, p_company_id uuid, p_permission_snapshot_revision text, p_registered_permission_keys text[], p_capability_id text, p_capability_revision text, p_capability_manifest_revision text, p_required_oauth_scopes text[], p_inbox_scope text, p_clients_scope text, p_job_permission text, p_job_scope text, p_job_kind text, p_job_id uuid, p_exact_turn_limit integer DEFAULT 20, p_sections text[] DEFAULT ARRAY['memory'::text, 'recent_turns'::text, 'participants'::text, 'gaps'::text, 'cross_job_seed'::text], p_required_through_turn_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
AS $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_id is distinct from 'get_job_conversation_context'
     or p_capability_revision is distinct from
       'get_job_conversation_context:2026-08-07.v1'
     or p_capability_manifest_revision is distinct from
       '2026-08-12.capability-manifest.v4' then
    raise exception 'invalid_agent_job_conversation_context_request'
      using errcode = '22023';
  end if;
  return private.read_agent_job_conversation_context_v3_impl(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_id,
    p_capability_revision,
    private.agent_legacy_manifest_v3_revision(),
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
$function$
;
revoke all on function private.read_agent_job_conversation_context_v4_impl(text, uuid, uuid, text, text[], text, text, text, text[], text, text, text, text, text, uuid, integer, text[], uuid) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.read_agent_job_conversation_context_v5_impl(p_request_id text, p_actor_user_id uuid, p_company_id uuid, p_permission_snapshot_revision text, p_registered_permission_keys text[], p_capability_id text, p_capability_revision text, p_capability_manifest_revision text, p_required_oauth_scopes text[], p_inbox_scope text, p_clients_scope text, p_job_permission text, p_job_scope text, p_job_kind text, p_job_id uuid, p_exact_turn_limit integer DEFAULT 20, p_sections text[] DEFAULT ARRAY['memory'::text, 'recent_turns'::text, 'participants'::text, 'gaps'::text, 'cross_job_seed'::text], p_required_through_turn_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
AS $function$
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
$function$
;
revoke all on function private.read_agent_job_conversation_context_v5_impl(text, uuid, uuid, text, text[], text, text, text, text[], text, text, text, text, text, uuid, integer, text[], uuid) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.read_agent_job_conversation_context_v6_bridge(p_request_id text, p_actor_user_id uuid, p_company_id uuid, p_permission_snapshot_revision text, p_registered_permission_keys text[], p_capability_id text, p_capability_revision text, p_required_oauth_scopes text[], p_inbox_scope text, p_clients_scope text, p_job_permission text, p_job_scope text, p_job_kind text, p_job_id uuid, p_exact_turn_limit integer, p_sections text[], p_required_through_turn_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
  select private.read_agent_job_conversation_context_v5_impl(
    p_request_id,
    p_actor_user_id,
    p_company_id,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_id,
    p_capability_revision,
    '2026-08-13.capability-manifest.v5',
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
$function$
;
revoke all on function private.read_agent_job_conversation_context_v6_bridge(text, uuid, uuid, text, text[], text, text, text[], text, text, text, text, text, uuid, integer, text[], uuid) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.read_agent_job_conversation_context_as_system(p_request_id text, p_actor_user_id uuid, p_company_id uuid, p_permission_snapshot_revision text, p_registered_permission_keys text[], p_capability_id text, p_capability_revision text, p_capability_manifest_revision text, p_required_oauth_scopes text[], p_inbox_scope text, p_clients_scope text, p_job_permission text, p_job_scope text, p_job_kind text, p_job_id uuid, p_exact_turn_limit integer DEFAULT 20, p_sections text[] DEFAULT ARRAY['memory'::text, 'recent_turns'::text, 'participants'::text, 'gaps'::text, 'cross_job_seed'::text], p_required_through_turn_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-14.capability-manifest.v6',
       '2026-08-20.capability-manifest.v7',
       '2026-08-22.capability-manifest.v8'
     ) then
    raise exception 'invalid_agent_job_conversation_context_request'
      using errcode = '22023';
  end if;
  v_result := private.read_agent_job_conversation_context_as_system_v7_core(
    p_request_id, p_actor_user_id, p_company_id,
    p_permission_snapshot_revision, p_registered_permission_keys,
    p_capability_id, p_capability_revision,
    case when p_capability_manifest_revision =
      '2026-08-22.capability-manifest.v8'
      then '2026-08-20.capability-manifest.v7'
      else p_capability_manifest_revision end,
    p_required_oauth_scopes, p_inbox_scope, p_clients_scope,
    p_job_permission, p_job_scope, p_job_kind, p_job_id,
    p_exact_turn_limit, p_sections, p_required_through_turn_id
  );
  if p_capability_manifest_revision in (
    '2026-08-14.capability-manifest.v6',
    '2026-08-20.capability-manifest.v7'
  ) then
    return v_result;
  end if;
  return private.reprove_agent_read_jsonb_for_manifest(
    v_result, '2026-08-22.capability-manifest.v8'
  );
end;
$function$
;
revoke all on function public.read_agent_job_conversation_context_as_system(text, uuid, uuid, text, text[], text, text, text, text[], text, text, text, text, text, uuid, integer, text[], uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_agent_job_conversation_context_as_system(text, uuid, uuid, text, text[], text, text, text, text[], text, text, text, text, text, uuid, integer, text[], uuid) to service_role;
CREATE OR REPLACE FUNCTION private.agent_civil_date_start(p_date date, p_timezone text)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE STRICT
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  with local_value as materialized (
    select p_date::timestamp without time zone as value
  ), guessed as materialized (
    select local.value at time zone p_timezone as instant
    from local_value local
  ), probes as materialized (
    select guessed.instant from guessed
    union all
    select guessed.instant - interval '36 hours' from guessed
    union all
    select guessed.instant + interval '36 hours' from guessed
  ), possible_offset as materialized (
    select distinct
           (probe.instant at time zone p_timezone) -
             (probe.instant at time zone 'UTC') as utc_offset
    from probes probe
  ), exact_match as materialized (
    select distinct
           (local.value - tz.utc_offset) at time zone 'UTC' as instant
    from local_value local
    cross join possible_offset tz
    where (
      (local.value - tz.utc_offset) at time zone 'UTC'
    ) at time zone p_timezone = local.value
  ), boundary as materialized (
    select min(match.instant) as instant from exact_match match
  )
  select coalesce(
    boundary.instant,
    case when (guessed.instant at time zone p_timezone)::date = p_date
      then guessed.instant
      else null
    end
  )
  from boundary
  cross join guessed;
$function$
;
revoke all on function private.agent_civil_date_start(p_date date, text) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.agent_legacy_manifest_v3_revision()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select '2026-08-11.capability-manifest.v3'::text;
$function$
;
revoke all on function private.agent_legacy_manifest_v3_revision() from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.agent_unambiguous_local_instant(p_local timestamp without time zone, p_timezone text)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE STRICT
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  with guessed as materialized (
    select p_local at time zone p_timezone as instant
  ), probes as materialized (
    select guessed.instant from guessed
    union all
    select guessed.instant - interval '36 hours' from guessed
    union all
    select guessed.instant + interval '36 hours' from guessed
  ), possible_offset as materialized (
    select distinct
           (probe.instant at time zone p_timezone) -
             (probe.instant at time zone 'UTC') as utc_offset
    from probes probe
  ), matching as (
    select distinct
           (p_local - tz.utc_offset) at time zone 'UTC' as instant
    from possible_offset tz
    where (
      (p_local - tz.utc_offset) at time zone 'UTC'
    ) at time zone p_timezone = p_local
  )
  select case when count(*) = 1 then min(instant) else null end
  from matching;
$function$
;
revoke all on function private.agent_unambiguous_local_instant(p_local timestamp without time zone, text) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.assert_agent_job_context_provider_source(p_normalization_status text, p_normalized_plain_text text, p_attachment_enumeration_complete boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
begin
  if p_normalization_status is distinct from 'normalized'
     or nullif(btrim(p_normalized_plain_text), '') is null
     or octet_length(p_normalized_plain_text) > 8388608
     or p_attachment_enumeration_complete is distinct from true then
    raise exception 'agent_job_context_provider_source_data_invalid'
      using errcode = '22000';
  end if;
  return true;
end;
$function$
;
revoke all on function private.assert_agent_job_context_provider_source(text, text, p_attachment_enumeration_complete boolean) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.reprove_agent_read_jsonb_for_manifest(p_result jsonb, p_capability_manifest_revision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private', 'extensions', 'pg_temp'
AS $function$
declare
  v_result jsonb;
  v_object jsonb;
  v_projection jsonb;
  v_old_hash text;
  v_new_hash text;
  v_immediate_source_manifest_revision text;
  v_allowed_source_manifest_revisions text[];
  v_pass integer;
  v_changed boolean;
  v_manifest_count integer;
begin
  if p_result is null
     or p_capability_manifest_revision is null
     or p_capability_manifest_revision not in (
       '2026-08-14.capability-manifest.v6',
       '2026-08-20.capability-manifest.v7',
       '2026-08-22.capability-manifest.v8'
     ) then
    raise exception 'invalid_agent_manifest_reproof_request'
      using errcode = '22023';
  end if;

  v_immediate_source_manifest_revision :=
    case p_capability_manifest_revision
      when '2026-08-14.capability-manifest.v6'
        then '2026-08-13.capability-manifest.v5'
      when '2026-08-20.capability-manifest.v7'
        then '2026-08-14.capability-manifest.v6'
      when '2026-08-22.capability-manifest.v8'
        then '2026-08-20.capability-manifest.v7'
    end;
  v_allowed_source_manifest_revisions :=
    case p_capability_manifest_revision
      when '2026-08-14.capability-manifest.v6' then array[
        '2026-08-11.capability-manifest.v3',
        '2026-08-12.capability-manifest.v4',
        '2026-08-13.capability-manifest.v5'
      ]::text[]
      when '2026-08-20.capability-manifest.v7' then array[
        '2026-08-11.capability-manifest.v3',
        '2026-08-12.capability-manifest.v4',
        '2026-08-13.capability-manifest.v5',
        '2026-08-14.capability-manifest.v6'
      ]::text[]
      when '2026-08-22.capability-manifest.v8' then array[
        '2026-08-11.capability-manifest.v3',
        '2026-08-12.capability-manifest.v4',
        '2026-08-13.capability-manifest.v5',
        '2026-08-14.capability-manifest.v6',
        '2026-08-20.capability-manifest.v7'
      ]::text[]
    end;

  select count(*)
    into v_manifest_count
  from private.agent_jsonb_objects(p_result) object_value
  where object_value ? 'capability_manifest_revision';

  if v_manifest_count = 0
     or not exists (
       select 1
       from private.agent_jsonb_objects(p_result) object_value
       where object_value ->> 'capability_manifest_revision' =
         v_immediate_source_manifest_revision
     )
     or exists (
       select 1
       from private.agent_jsonb_objects(p_result) object_value
       where object_value ? 'capability_manifest_revision'
         and not (
           object_value ->> 'capability_manifest_revision' = any (
             v_allowed_source_manifest_revisions
           )
         )
     ) then
    raise exception 'invalid_agent_manifest_reproof_source'
      using errcode = '22023';
  end if;

  v_result := private.agent_set_jsonb_key_recursive(
    p_result,
    'capability_manifest_revision',
    to_jsonb(p_capability_manifest_revision)
  );

  for v_pass in 1..16 loop
    v_changed := false;
    for v_object in
      select object_value
      from private.agent_jsonb_objects(v_result) object_value
      where jsonb_typeof(object_value -> 'projection') = 'object'
        and object_value ->> 'source_content_hash'
          ~ '^sha256:[0-9a-f]{64}$'
    loop
      v_projection := v_object -> 'projection';
      v_old_hash := v_object ->> 'source_content_hash';
      v_new_hash := 'sha256:' || encode(
        extensions.digest(
          convert_to(
            private.canonical_agent_projection_json(v_projection),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      );
      if v_new_hash is distinct from v_old_hash then
        v_result := private.agent_replace_agent_proof_hash(
          v_result,
          v_old_hash,
          v_new_hash
        );
        v_changed := true;
      end if;
    end loop;
    exit when not v_changed;
  end loop;
  if v_changed then
    raise exception 'agent_manifest_reproof_depth_exceeded'
      using errcode = '54000';
  end if;
  return v_result;
end;
$function$
;
revoke all on function private.reprove_agent_read_jsonb_for_manifest(p_result jsonb, text) from public,anon,authenticated,service_role;
