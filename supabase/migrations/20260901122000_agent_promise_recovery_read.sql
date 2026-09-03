-- Dormant OPS MCP promise-recovery read.
--
-- This migration adds one authority-bound read over the current safe provider
-- delivery projection. It creates no state table and performs no data write.

begin;

do $prerequisites$
declare
  v_relation text;
  v_signature text;
begin
  foreach v_relation in array array[
    'public.activities',
    'public.clients',
    'public.email_connections',
    'public.email_threads',
    'public.job_conversation_turns',
    'public.sub_clients',
    'private.agent_provider_delivery_sources',
    'private.mcp_oauth_clients',
    'private.mcp_oauth_grants'
  ] loop
    if pg_catalog.to_regclass(v_relation) is null then
      raise exception 'agent_promise_recovery_prerequisite_missing: %',
        v_relation using errcode = '55000';
    end if;
  end loop;

  foreach v_signature in array array[
    'private.agent_jsonb_objects(jsonb)',
    'private.agent_replace_agent_proof_hash(jsonb,text,text)',
      'private.agent_set_jsonb_key_recursive(jsonb,text,jsonb)',
      'private.canonical_agent_projection_json(jsonb)',
      'private.read_agent_job_conversation_context_v3_impl(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid)',
      'private.read_agent_correspondence_evidence_page_as_system_v6_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text)',
      'private.resolve_agent_actor_authority(uuid,uuid,text[])'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'agent_promise_recovery_prerequisite_missing: %',
        v_signature using errcode = '55000';
    end if;
  end loop;
end;
$prerequisites$;

-- Historical read wrappers can retain nested proof projections minted by an
-- older known manifest. Reproof accepts only the complete known predecessor
-- lineage, requires the immediate predecessor at least once, remints every
-- manifest key, and then recomputes every affected proof hash.
create or replace function private.reprove_agent_read_jsonb_for_manifest(
  p_result jsonb,
  p_capability_manifest_revision text
) returns jsonb
language plpgsql
stable
called on null input
security definer
set search_path = pg_catalog, private, extensions, pg_temp
as $function$
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
$function$;

revoke all on function private.reprove_agent_read_jsonb_for_manifest(jsonb,text)
  from public, anon, authenticated, service_role;

-- The current context wrapper eventually reaches this historical private
-- implementation. Make an unreadable or incompletely enumerated provider row
-- an explicit evidence failure instead of silently returning its stale turn
-- projection.
create or replace function private.assert_agent_job_context_provider_source(
  p_normalization_status text,
  p_normalized_plain_text text,
  p_attachment_enumeration_complete boolean
) returns boolean
language plpgsql
stable
set search_path = pg_catalog, pg_temp
as $function$
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
$function$;

revoke all on function private.assert_agent_job_context_provider_source(
  text, text, boolean
) from public, anon, authenticated, service_role;

-- Preserve the public context signature and its proof graph while repairing
-- the one historical implementation at the bottom of the wrapper chain. Both
-- recent turns and active-evidence excerpts are rebuilt from the exact
-- company/source/hash/connection/provider-message row in the provider ledger.
create or replace function pg_temp.repair_agent_job_context_v3()
returns void
language plpgsql
set search_path = pg_catalog, private, public, pg_temp
as $function$
declare
  v_signature constant text :=
    'private.read_agent_job_conversation_context_v3_impl(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid)';
  v_definition text;
  v_recent_candidate text;
  v_evidence_candidate text;
  v_recent_select text;
  v_recent_from text;
  v_evidence_select text;
  v_evidence_from text;
  v_recent_start_marker constant text :=
    '), authorized_recent_turn as materialized (';
  v_recent_end_marker constant text :=
    '), effective_recent_turn as materialized (';
  v_evidence_start_marker constant text :=
    '), authorized_evidence_turn as materialized (';
  v_evidence_end_marker constant text :=
    '), effective_evidence_turn as materialized (';
  v_from_marker constant text := '    from requested_anchor requested';
  v_join_marker constant text := $marker$
    join private.agent_provider_delivery_sources provider_source
      on provider_source.company_id = turn.company_id
     and provider_source.id = turn.provider_delivery_source_id
     and provider_source.source_sha256
       = turn.provider_delivery_source_sha256$marker$;
  v_join_replacement constant text := $replacement$
    join private.agent_provider_delivery_sources context_provider_source
      on context_provider_source.company_id = turn.company_id
     and context_provider_source.id = turn.provider_delivery_source_id
     and context_provider_source.source_sha256
       = turn.provider_delivery_source_sha256
     and context_provider_source.connection_id = turn.source_connection_id
     and context_provider_source.provider_message_id = turn.provider_message_id$replacement$;
  v_readability_marker constant text := $marker$
      turn.source_connection_id,
      requested.opportunity_id
    )$marker$;
  v_readability_replacement constant text := $replacement$
      turn.source_connection_id,
      requested.opportunity_id
    )
      and private.assert_agent_job_context_provider_source(
        context_provider_source.normalization_status,
        context_provider_source.normalized_plain_text,
        context_provider_source.attachment_enumeration_complete
      )$replacement$;
  v_recent_start integer;
  v_recent_end integer;
  v_evidence_start integer;
  v_evidence_end integer;
  v_from integer;
begin
  v_definition := pg_get_functiondef(to_regprocedure(v_signature));
  v_recent_start := strpos(v_definition, v_recent_start_marker);
  v_recent_end := strpos(v_definition, v_recent_end_marker);
  v_evidence_start := strpos(v_definition, v_evidence_start_marker);
  v_evidence_end := strpos(v_definition, v_evidence_end_marker);
  if v_definition is null
     or v_recent_start = 0
     or v_recent_end <= v_recent_start
     or v_evidence_start = 0
     or v_evidence_end <= v_evidence_start then
    raise exception 'agent_job_context_v3_repair_source_invalid'
      using errcode = '55000';
  end if;

  v_recent_candidate := substring(
    v_definition
    from v_recent_start
    for v_recent_end - v_recent_start
  );
  v_from := strpos(v_recent_candidate, v_from_marker);
  if v_from = 0
     or strpos(v_recent_candidate, v_join_marker) = 0
     or strpos(v_recent_candidate, v_readability_marker) = 0 then
    raise exception 'agent_job_context_v3_repair_source_invalid'
      using errcode = '55000';
  end if;
  v_recent_select := substring(v_recent_candidate from 1 for v_from - 1);
  v_recent_from := substring(v_recent_candidate from v_from);
  v_recent_select := replace(
    v_recent_select,
    'turn.delivered_at',
    'context_provider_source.delivered_at'
  );
  v_recent_select := replace(
    v_recent_select,
    'turn.source_connection_id',
    'context_provider_source.connection_id'
  );
  v_recent_select := replace(
    v_recent_select,
    'turn.provider_message_id',
    'context_provider_source.provider_message_id'
  );
  v_recent_select := replace(
    v_recent_select,
    'turn.provider_delivery_source_sha256',
    'context_provider_source.source_sha256'
  );
  v_recent_select := replace(
    v_recent_select,
    'turn.subject',
    'context_provider_source.normalized_subject'
  );
  v_recent_select := replace(
    v_recent_select,
    'turn.recipient_identities',
    'context_provider_source.recipient_identities'
  );
  v_recent_select := replace(
    v_recent_select,
    'turn.cc_recipient_identities',
    'context_provider_source.cc_recipient_identities'
  );
  v_recent_select := replace(
    v_recent_select,
    'turn.normalized_plain_text',
    'context_provider_source.normalized_plain_text'
  );
  v_recent_select := replace(
    v_recent_select,
    'turn.original_content_hash',
    'context_provider_source.source_sha256'
  );
  v_recent_select := replace(
    v_recent_select,
    'turn.attachment_evidence_ids',
    'context_provider_source.attachment_evidence_ids'
  );
  v_recent_from := replace(
    v_recent_from,
    v_join_marker,
    v_join_replacement
  );
  v_recent_from := replace(
    v_recent_from,
    v_readability_marker,
    v_readability_replacement
  );
  v_recent_candidate := v_recent_select || v_recent_from;
  if strpos(v_recent_candidate, 'context_provider_source.normalized_plain_text') = 0
     or strpos(v_recent_candidate, 'context_provider_source.normalized_subject') = 0
     or strpos(v_recent_candidate, 'context_provider_source.attachment_evidence_ids') = 0
     or strpos(v_recent_candidate, 'context_provider_source.source_sha256') = 0
     or strpos(v_recent_select, 'turn.normalized_plain_text') > 0
     or strpos(v_recent_select, 'turn.attachment_evidence_ids') > 0 then
    raise exception 'agent_job_context_v3_repair_output_invalid'
      using errcode = '55000';
  end if;
  v_definition := substring(v_definition from 1 for v_recent_start - 1)
    || v_recent_candidate
    || substring(v_definition from v_recent_end);

  v_evidence_start := strpos(v_definition, v_evidence_start_marker);
  v_evidence_end := strpos(v_definition, v_evidence_end_marker);
  v_evidence_candidate := substring(
    v_definition
    from v_evidence_start
    for v_evidence_end - v_evidence_start
  );
  v_from := strpos(v_evidence_candidate, v_from_marker);
  if v_from = 0
     or strpos(v_evidence_candidate, v_join_marker) = 0
     or strpos(v_evidence_candidate, v_readability_marker) = 0 then
    raise exception 'agent_job_context_v3_repair_source_invalid'
      using errcode = '55000';
  end if;
  v_evidence_select := substring(v_evidence_candidate from 1 for v_from - 1);
  v_evidence_from := substring(v_evidence_candidate from v_from);
  v_evidence_select := replace(
    v_evidence_select,
    'turn.delivered_at',
    'context_provider_source.delivered_at'
  );
  v_evidence_select := replace(
    v_evidence_select,
    'turn.provider_delivery_source_sha256',
    'context_provider_source.source_sha256'
  );
  v_evidence_select := replace(
    v_evidence_select,
    'turn.original_content_hash',
    'context_provider_source.source_sha256'
  );
  v_evidence_select := replace(
    v_evidence_select,
    'turn.attachment_evidence_ids',
    'context_provider_source.attachment_evidence_ids'
  );
  v_evidence_select := replace(
    v_evidence_select,
    'turn.normalized_plain_text',
    'context_provider_source.normalized_plain_text'
  );
  v_evidence_from := replace(
    v_evidence_from,
    v_join_marker,
    v_join_replacement
  );
  v_evidence_from := replace(
    v_evidence_from,
    v_readability_marker,
    v_readability_replacement
  );
  v_evidence_candidate := v_evidence_select || v_evidence_from;
  if strpos(v_evidence_candidate, 'context_provider_source.normalized_plain_text') = 0
     or strpos(v_evidence_candidate, 'context_provider_source.attachment_evidence_ids') = 0
     or strpos(v_evidence_candidate, 'context_provider_source.source_sha256') = 0
     or strpos(v_evidence_select, 'turn.normalized_plain_text') > 0
     or strpos(v_evidence_select, 'turn.attachment_evidence_ids') > 0 then
    raise exception 'agent_job_context_v3_repair_output_invalid'
      using errcode = '55000';
  end if;
  v_definition := substring(v_definition from 1 for v_evidence_start - 1)
    || v_evidence_candidate
    || substring(v_definition from v_evidence_end);

  if strpos(v_definition, 'context_provider_source.normalized_plain_text') = 0
     or strpos(v_definition, 'context_provider_source.normalized_subject') = 0
     or strpos(v_definition, 'context_provider_source.attachment_evidence_ids') = 0
     or strpos(v_definition, 'context_provider_source.source_sha256') = 0
     or strpos(
       v_definition,
       'private.assert_agent_job_context_provider_source'
     ) = 0 then
    raise exception 'agent_job_context_v3_repair_output_invalid'
      using errcode = '55000';
  end if;

  execute v_definition;
end;
$function$;

select pg_temp.repair_agent_job_context_v3();
drop function pg_temp.repair_agent_job_context_v3();

-- Preserve the frozen v6 evidence API while replacing only its stale derived
-- body/attachment inputs. The wrapper now reads the hash-bound current provider
-- projection. Missing attachment content metadata retains its stable evidence
-- reference and declares metadata_state=incomplete instead of suppressing the
-- readable correspondence body.
create or replace function pg_temp.repair_agent_correspondence_evidence_v6()
returns void
language plpgsql
set search_path = pg_catalog, private, public, pg_temp
as $function$
declare
  v_signature constant text :=
    'private.read_agent_correspondence_evidence_page_as_system_v6_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text)';
  v_definition text;
  v_current_candidate text;
  v_candidate_start_marker constant text :=
    '), current_turn_candidate as materialized (';
  v_candidate_end_marker constant text :=
    '), attachment_array_state as materialized (';
  v_candidate_start integer;
  v_candidate_end integer;
  v_join_marker constant text := $marker$
    join public.job_conversation_turns turn
      on turn.company_id = p_company_id
     and turn.conversation_id = conversation.id
     and turn.id = requested.turn_id
    left join lateral ($marker$;
  v_join_replacement constant text := $replacement$
    join public.job_conversation_turns turn
      on turn.company_id = p_company_id
     and turn.conversation_id = conversation.id
     and turn.id = requested.turn_id
    join private.agent_provider_delivery_sources provider_source
      on provider_source.company_id = turn.company_id
     and provider_source.id = turn.provider_delivery_source_id
     and provider_source.source_sha256 =
       turn.provider_delivery_source_sha256
     and provider_source.connection_id = turn.source_connection_id
     and provider_source.provider_message_id = turn.provider_message_id
    left join lateral ($replacement$;
  v_timestamp_marker constant text := $marker$
           turn.delivered_at,
           turn.delivered_at is null$marker$;
  v_timestamp_replacement constant text := $replacement$
           turn.delivered_at,
           (
             content_redaction.id is null and (
               provider_source.normalization_status <> 'normalized'
               or nullif(btrim(provider_source.normalized_plain_text), '')
                 is null
               or octet_length(provider_source.normalized_plain_text) >
                 8388608
             )
             or attachment_redaction.id is null
                and not provider_source.attachment_enumeration_complete
           ) as provider_source_data_invalid,
           turn.delivered_at is null$replacement$;
  v_current_turn_marker constant text := $marker$
    where not turn.timestamp_source_invalid
      and not turn.text_source_query_bound$marker$;
  v_current_turn_replacement constant text := $replacement$
    where not turn.timestamp_source_invalid
      and not turn.text_source_query_bound
      and not turn.provider_source_data_invalid$replacement$;
  v_invalid_marker constant text := $marker$
           select 1 from current_turn_candidate turn
           where turn.timestamp_source_invalid
         )$marker$;
  v_invalid_replacement constant text := $replacement$
           select 1 from current_turn_candidate turn
           where turn.timestamp_source_invalid
              or turn.provider_source_data_invalid
         )$replacement$;
  v_attachment_start_marker constant text :=
    '), safe_attachment as materialized (';
  v_attachment_end_marker constant text :=
    '), attachment_projection as materialized (';
  v_attachment_start integer;
  v_attachment_end integer;
  v_attachment_replacement constant text := $replacement$), safe_attachment as materialized (
    select requested.evidence_id,
           requested.ordinality,
           requested.global_attachment_rank,
           case
             when attachment.id is not null
              and lower(coalesce(
                attachment.detected_mime_type, attachment.mime_type
              )) ~ '^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$'
              and octet_length(lower(coalesce(
                attachment.detected_mime_type, attachment.mime_type
              ))) between 3 and 255
              and attachment.verified_size_bytes between 0 and 9007199254740991
              and attachment.content_sha256 ~ '^[0-9a-f]{64}$'
              and attachment.is_inline is not null then
               jsonb_build_object(
                 'attachment_id', requested.attachment_evidence_id,
                 'mime_type', lower(coalesce(
                   attachment.detected_mime_type, attachment.mime_type
                 )),
                 'size_bytes', attachment.verified_size_bytes,
                 'inline', attachment.is_inline,
                 'content_hash', 'sha256:' || attachment.content_sha256
               )
             else jsonb_build_object(
               'attachment_id', requested.attachment_evidence_id,
               'metadata_state', 'incomplete'
             )
           end as attachment
    from attachment_candidate requested
    left join public.email_attachments attachment
      on attachment.id = requested.attachment_id
     and attachment.company_id = p_company_id
     and attachment.connection_id = requested.source_connection_id
    where requested.global_attachment_rank <= 20
  ), attachment_projection as materialized ($replacement$;
begin
  v_definition := pg_get_functiondef(to_regprocedure(v_signature));
  if v_definition is null
     or strpos(v_definition, v_join_marker) = 0
     or strpos(v_definition, v_timestamp_marker) = 0
     or strpos(v_definition, v_current_turn_marker) = 0
     or strpos(v_definition, v_invalid_marker) = 0
     or strpos(v_definition, v_candidate_start_marker) = 0
     or strpos(v_definition, v_candidate_end_marker) = 0
     or strpos(v_definition, v_attachment_start_marker) = 0
     or strpos(v_definition, v_attachment_end_marker) = 0
     or strpos(v_definition, 'turn.normalized_plain_text') = 0
     or strpos(v_definition, 'turn.subject') = 0
     or strpos(v_definition, 'turn.original_content_hash') = 0
     or strpos(v_definition, 'turn.attachment_evidence_ids') = 0 then
    raise exception 'agent_correspondence_evidence_v6_repair_source_invalid'
      using errcode = '55000';
  end if;

  v_candidate_start := strpos(v_definition, v_candidate_start_marker);
  v_candidate_end := strpos(v_definition, v_candidate_end_marker);
  if v_candidate_start = 0
     or v_candidate_end <= v_candidate_start then
    raise exception 'agent_correspondence_evidence_v6_repair_source_invalid'
      using errcode = '55000';
  end if;
  v_current_candidate := substring(
    v_definition
    from v_candidate_start
    for v_candidate_end - v_candidate_start
  );
  v_current_candidate := replace(
    v_current_candidate,
    v_join_marker,
    v_join_replacement
  );
  v_current_candidate := replace(
    v_current_candidate,
    v_timestamp_marker,
    v_timestamp_replacement
  );
  v_current_candidate := replace(
    v_current_candidate,
    'turn.normalized_plain_text',
    'provider_source.normalized_plain_text'
  );
  v_current_candidate := replace(
    v_current_candidate,
    'turn.subject',
    'provider_source.normalized_subject'
  );
  v_current_candidate := replace(
    v_current_candidate,
    'turn.original_content_hash',
    'provider_source.source_sha256'
  );
  v_current_candidate := replace(
    v_current_candidate,
    'turn.attachment_evidence_ids',
    'provider_source.attachment_evidence_ids'
  );
  if strpos(v_current_candidate, 'provider_source.normalized_plain_text') = 0
     or strpos(v_current_candidate, 'provider_source.normalized_subject') = 0
     or strpos(v_current_candidate, 'provider_source.attachment_evidence_ids') = 0
     or strpos(v_current_candidate, 'provider_source.source_sha256') = 0
     or strpos(v_current_candidate, 'turn.normalized_plain_text') > 0
     or strpos(v_current_candidate, 'turn.attachment_evidence_ids') > 0 then
    raise exception 'agent_correspondence_evidence_v6_repair_output_invalid'
      using errcode = '55000';
  end if;
  v_definition := substring(v_definition from 1 for v_candidate_start - 1)
    || v_current_candidate
    || substring(v_definition from v_candidate_end);
  v_definition := replace(
    v_definition,
    v_current_turn_marker,
    v_current_turn_replacement
  );
  v_definition := replace(
    v_definition,
    v_invalid_marker,
    v_invalid_replacement
  );

  v_attachment_start := strpos(v_definition, v_attachment_start_marker);
  v_attachment_end := strpos(v_definition, v_attachment_end_marker);
  if v_attachment_start = 0
     or v_attachment_end <= v_attachment_start then
    raise exception 'agent_correspondence_evidence_v6_repair_source_invalid'
      using errcode = '55000';
  end if;
  v_definition := substring(v_definition from 1 for v_attachment_start - 1)
    || v_attachment_replacement
    || substring(
      v_definition
      from v_attachment_end + char_length(v_attachment_end_marker)
    );

  if strpos(v_definition, 'provider_source.normalized_plain_text') = 0
     or strpos(v_definition, 'provider_source.normalized_subject') = 0
     or strpos(v_definition, 'provider_source.attachment_evidence_ids') = 0
     or strpos(v_definition, 'provider_source.source_sha256') = 0
     or strpos(v_definition, '''metadata_state'', ''incomplete''') = 0 then
    raise exception 'agent_correspondence_evidence_v6_repair_output_invalid'
      using errcode = '55000';
  end if;

  execute v_definition;
end;
$function$;

select pg_temp.repair_agent_correspondence_evidence_v6();
drop function pg_temp.repair_agent_correspondence_evidence_v6();

create or replace function private.assert_agent_promise_recovery_authority(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_capability_manifest_revision text,
  p_exposure_revision text,
  p_capability_id text,
  p_capability_revision text
) returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  v_permission_snapshot_revision text;
  v_required_permissions constant jsonb := jsonb_build_array(
    jsonb_build_object('permission', 'clients.view', 'scope', 'all'),
    jsonb_build_object('permission', 'email.view', 'scope', 'all')
  );
  v_required_scopes constant text[] := array[
    'ops.correspondence.read',
    'ops.customer_contacts.read',
    'ops.customers.read'
  ];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null
     or p_company_id is null
     or p_oauth_grant_id is null
     or p_oauth_client_id is null
     or nullif(btrim(p_grant_revision), '') is null
     or nullif(btrim(p_permission_snapshot_revision), '') is null
     or p_capability_manifest_revision is distinct from
       '2026-09-01.capability-manifest.v12'
     or p_exposure_revision is distinct from
       '2026-09-01.mcp-exposure.v6'
     or p_capability_id is distinct from 'check_customer_reply'
     or p_capability_revision is distinct from
       'check_customer_reply:2026-08-31.v1' then
    raise exception 'AGENT_PROMISE_RECOVERY_BINDING_INVALID'
      using errcode = '42501';
  end if;

  select authority.permission_snapshot_revision
    into v_permission_snapshot_revision
  from private.resolve_agent_actor_authority(
    p_actor_user_id,
    p_company_id,
    array['clients.view', 'email.view']
  ) authority
  where authority.effective_permissions @> v_required_permissions;

  if v_permission_snapshot_revision is null
     or v_permission_snapshot_revision is distinct from
       p_permission_snapshot_revision then
    raise exception 'AGENT_PROMISE_RECOVERY_AUTHORITY_STALE_OR_DENIED'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from private.mcp_oauth_grants grant_record
    join private.mcp_oauth_clients client_record
      on client_record.client_id = grant_record.client_id
     and client_record.disabled_at is null
     and grant_record.scopes <@ client_record.scope_ceiling
     and grant_record.consent_catalog_revision =
       client_record.consent_catalog_revision
     and grant_record.exposure_revision = client_record.exposure_revision
    where grant_record.id = p_oauth_grant_id
      and grant_record.user_id = p_actor_user_id
      and grant_record.company_id = p_company_id
      and grant_record.client_id = p_oauth_client_id
      and grant_record.revision = p_grant_revision
      and grant_record.scopes = p_granted_scope_ceiling
      and grant_record.revoked_at is null
      and grant_record.exposure_revision =
        '2026-09-01.mcp-exposure.v6'
      and v_required_scopes <@ grant_record.scopes
  ) then
    raise exception 'AGENT_PROMISE_RECOVERY_GRANT_STALE_OR_DENIED'
      using errcode = '42501';
  end if;

  return v_permission_snapshot_revision;
end;
$function$;

revoke all on function private.assert_agent_promise_recovery_authority(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_promise_recovery_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_capability_manifest_revision text,
  p_exposure_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_customer_query text,
  p_as_of timestamptz
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, pg_temp
as $function$
declare
  v_candidate_count integer;
  v_client_id uuid;
  v_display_name text;
  v_first_delivered_at timestamptz;
  v_identity_ambiguous boolean := false;
  v_identity_available boolean := false;
  v_last_delivered_at timestamptz;
  v_population_count integer := 0;
  v_query text;
  v_source_bound_reached boolean := false;
  v_sources jsonb := '[]'::jsonb;
begin
  perform private.assert_agent_promise_recovery_authority(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_capability_manifest_revision,
    p_exposure_revision,
    p_capability_id,
    p_capability_revision
  );

  v_query := lower(btrim(p_customer_query));
  if char_length(v_query) not between 1 and 160
     or p_as_of is null
     or p_as_of > statement_timestamp() + interval '5 minutes' then
    raise exception 'AGENT_PROMISE_RECOVERY_INPUT_INVALID'
      using errcode = '22023';
  end if;

  select count(*)::integer,
         case
           when count(*) = 1
           then (array_agg(client.id order by client.id))[1]
         end,
         case
           when count(*) = 1
           then (array_agg(client.name order by client.id))[1]
         end
    into v_candidate_count, v_client_id, v_display_name
  from public.clients client
  where client.company_id = p_company_id
    and client.deleted_at is null
    and client.merged_into_client_id is null
    and lower(btrim(client.name)) = v_query;

  if v_candidate_count <> 1 then
    return jsonb_build_object(
      'customer_resolution', jsonb_build_object(
        'state', case
          when v_candidate_count = 0 then 'not_found'
          else 'ambiguous'
        end,
        'candidate_count', least(v_candidate_count, 25),
        'client_id', null,
        'display_name', null,
        'identity_available', false,
        'identity_ambiguous', false
      ),
      'population_count', 0,
      'source_bound_reached', false,
      'first_delivered_at', null,
      'last_delivered_at', null,
      'sources', '[]'::jsonb
    );
  end if;

  with target_identity as (
    select lower(btrim(client.email)) as email
    from public.clients client
    where client.id = v_client_id
      and client.company_id = p_company_id
      and client.deleted_at is null
      and client.merged_into_client_id is null
      and nullif(btrim(client.email), '') is not null
    union
    select lower(btrim(sub_client.email))
    from public.sub_clients sub_client
    join public.clients client on client.id = sub_client.client_id
    where sub_client.client_id = v_client_id
      and sub_client.company_id = p_company_id
      and client.company_id = p_company_id
      and sub_client.deleted_at is null
      and client.deleted_at is null
      and client.merged_into_client_id is null
      and nullif(btrim(sub_client.email), '') is not null
  ), active_identity_owner as (
    select lower(btrim(client.email)) as email, client.id as owner_client_id
    from public.clients client
    where client.company_id = p_company_id
      and client.deleted_at is null
      and client.merged_into_client_id is null
      and nullif(btrim(client.email), '') is not null
    union
    select lower(btrim(sub_client.email)), sub_client.client_id
    from public.sub_clients sub_client
    join public.clients client on client.id = sub_client.client_id
    where sub_client.company_id = p_company_id
      and client.company_id = p_company_id
      and sub_client.deleted_at is null
      and client.deleted_at is null
      and client.merged_into_client_id is null
      and nullif(btrim(sub_client.email), '') is not null
  )
  select exists(select 1 from target_identity),
         exists(
           select 1
           from active_identity_owner owner
           join target_identity target on target.email = owner.email
           group by owner.email
           having count(distinct owner.owner_client_id) > 1
         )
    into v_identity_available, v_identity_ambiguous;

  with identity as (
    select coalesce(
      array_agg(target.email order by target.email),
      array[]::text[]
    ) as emails
    from (
      select lower(btrim(client.email)) as email
      from public.clients client
      where client.id = v_client_id
        and client.company_id = p_company_id
        and client.deleted_at is null
        and client.merged_into_client_id is null
        and nullif(btrim(client.email), '') is not null
      union
      select lower(btrim(sub_client.email))
      from public.sub_clients sub_client
      join public.clients client on client.id = sub_client.client_id
      where sub_client.client_id = v_client_id
        and sub_client.company_id = p_company_id
        and client.company_id = p_company_id
        and sub_client.deleted_at is null
        and client.deleted_at is null
        and client.merged_into_client_id is null
        and nullif(btrim(sub_client.email), '') is not null
    ) target
  ), classified_source as (
    select source.*,
           (
             (
               source.direction = 'inbound'
               and lower(btrim(source.sender_identity)) = any (identity.emails)
             )
             or (
               source.direction = 'outbound'
               and exists (
                 select 1
                 from pg_catalog.unnest(
                   coalesce(source.recipient_identities, array[]::text[]) ||
                   coalesce(source.cc_recipient_identities, array[]::text[])
                 ) recipient_identity
                 where lower(btrim(recipient_identity)) = any (identity.emails)
               )
             )
           ) as exact_participant,
           (
             source.direction = 'outbound' and (
               exists (
                 select 1
                 from public.email_connections connection
                 where connection.id = source.connection_id
                   and connection.company_id = source.company_id::text
                   and connection.type::text = 'individual'
                   and connection.user_id = p_actor_user_id::text
               )
               or exists (
                 select 1
                 from public.job_conversation_turns turn
                 join public.activities activity
                   on activity.company_id = turn.company_id
                  and activity.id = turn.source_activity_id
                 where turn.company_id = source.company_id
                   and turn.provider_delivery_source_id = source.id
                   and turn.provider_delivery_source_sha256 =
                     source.source_sha256
                   and activity.created_by = p_actor_user_id
               )
             )
           ) as exact_operator
    from private.agent_provider_delivery_sources source
    cross join identity
    where source.company_id = p_company_id
      and source.delivered_at <= p_as_of
      and source.direction in ('inbound', 'outbound')
  ), candidate_source as (
    select source.*
    from classified_source source
    where source.exact_participant
       or exists (
         select 1
         from public.email_threads thread
         where thread.company_id = p_company_id
           and thread.connection_id = source.connection_id
           and thread.provider_thread_id = source.provider_thread_id
           and thread.client_id = v_client_id
       )
  ), bounded_source as (
    select source.*
    from candidate_source source
    order by source.delivered_at, source.id
    limit 500
  ), sized_source as (
    select source.*,
           sum(
             case
               when source.normalization_status = 'normalized'
                and nullif(btrim(source.normalized_plain_text), '') is not null
                and char_length(source.normalized_plain_text) <= 100000
               then char_length(source.normalized_plain_text)
               else 0
             end
           ) over (
             order by source.delivered_at desc, source.id desc
             rows between unbounded preceding and current row
           ) as body_payload_characters,
           sum(
             coalesce(cardinality(source.attachment_evidence_ids), 0)
           ) over (
             order by source.delivered_at desc, source.id desc
             rows between unbounded preceding and current row
           ) as attachment_payload_count
    from bounded_source source
  ), source_stats as (
    select count(*)::integer as population_count,
           min(source.delivered_at) as first_delivered_at,
           max(source.delivered_at) as last_delivered_at
    from candidate_source source
  ), source_projection as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', source.id,
          'delivered_at', source.delivered_at,
          'direction', source.direction,
          'safe_subject', case
            when source.normalized_subject is not null
             and char_length(source.normalized_subject) <= 1000
            then source.normalized_subject
            else null
          end,
          'safe_body', case
            when source.normalization_status = 'normalized'
             and nullif(btrim(source.normalized_plain_text), '') is not null
             and char_length(source.normalized_plain_text) <= 100000
             and source.body_payload_characters <= 2000000
            then source.normalized_plain_text
            else null
          end,
          'body_state', case
            when source.normalization_status = 'normalized'
             and nullif(btrim(source.normalized_plain_text), '') is not null
             and char_length(source.normalized_plain_text) > 100000
            then 'oversized'
            when source.normalization_status = 'normalized'
             and nullif(btrim(source.normalized_plain_text), '') is not null
             and source.body_payload_characters > 2000000
            then 'payload_bound'
            when source.normalization_status = 'normalized'
             and nullif(btrim(source.normalized_plain_text), '') is not null
            then 'readable'
            else 'unreadable'
          end,
          'normalization_revision', source.normalization_revision,
          'source_sha256', source.source_sha256,
          'participant_attribution', case
            when source.exact_participant then 'exact'
            else 'thread_only'
          end,
          'operator_attribution', case
            when source.direction = 'inbound' then 'not_applicable'
            when source.exact_operator then 'exact'
            else 'unresolved'
          end,
          'attachment_enumeration_complete',
            source.attachment_enumeration_complete
            and source.attachment_evidence_ids is not null
            and cardinality(source.attachment_evidence_ids) <= 100
            and source.attachment_payload_count <= 100,
          'attachment_evidence_ids', case
            when source.attachment_enumeration_complete
             and source.attachment_evidence_ids is not null
             and cardinality(source.attachment_evidence_ids) <= 100
             and source.attachment_payload_count <= 100
            then source.attachment_evidence_ids
            else array[]::text[]
          end,
          'turn_id', (
            select turn.id
            from public.job_conversation_turns turn
            where turn.company_id = p_company_id
              and turn.provider_delivery_source_id = source.id
              and turn.provider_delivery_source_sha256 = source.source_sha256
            order by turn.turn_sequence, turn.id
            limit 1
          )
        )
        order by source.delivered_at, source.id
      ),
      '[]'::jsonb
    ) as sources
    from sized_source source
  )
  select least(stats.population_count, 501),
         stats.population_count > 500,
         stats.first_delivered_at,
         stats.last_delivered_at,
         projection.sources
    into v_population_count,
         v_source_bound_reached,
         v_first_delivered_at,
         v_last_delivered_at,
         v_sources
  from source_stats stats
  cross join source_projection projection;

  return jsonb_build_object(
    'customer_resolution', jsonb_build_object(
      'state', 'exact',
      'candidate_count', 1,
      'client_id', v_client_id,
      'display_name', v_display_name,
      'identity_available', v_identity_available,
      'identity_ambiguous', v_identity_ambiguous
    ),
    'population_count', v_population_count,
    'source_bound_reached', v_source_bound_reached,
    'first_delivered_at', v_first_delivered_at,
    'last_delivered_at', v_last_delivered_at,
    'sources', v_sources
  );
end;
$function$;

revoke all on function public.read_agent_promise_recovery_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text,
  text, timestamptz
) from public, anon, authenticated;

grant execute on function public.read_agent_promise_recovery_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text,
  text, timestamptz
) to service_role;

comment on function public.read_agent_promise_recovery_as_system(
  uuid, uuid, uuid, uuid, text, text[], text, text, text, text, text,
  text, timestamptz
) is
  'Reads one bounded, current-authority provider-delivery snapshot for dormant MCP promise recovery. Creates no draft and changes no business record.';

commit;
