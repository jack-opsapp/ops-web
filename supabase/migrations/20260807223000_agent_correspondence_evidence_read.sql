-- Service-only, same-statement correspondence evidence read for the OPS agent
-- control plane. Browser roles never receive direct execution authority.

begin;

do $prerequisites$
declare
  v_signature text;
  v_table text;
begin
  foreach v_signature in array array[
    'private.resolve_agent_actor_authority(uuid,uuid,text[])',
    'private.agent_user_can_access_entity(uuid,uuid,text,uuid,text)',
    'private.user_can_view_inbox_connection(uuid,uuid,uuid,uuid)',
    'extensions.digest(bytea,text)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception
        'agent_correspondence_evidence_prerequisite_missing: %',
        v_signature;
    end if;
  end loop;

  foreach v_table in array array[
    'public.job_conversation_turns',
    'public.job_conversation_anchors',
    'public.job_conversation_redaction_events'
  ] loop
    if to_regclass(v_table) is null then
      raise exception
        'agent_correspondence_evidence_prerequisite_missing: %',
        v_table;
    end if;
  end loop;
end;
$prerequisites$;

create or replace function private.agent_prompt_text_is_safe(
  p_value text,
  p_allow_text_whitespace boolean
) returns boolean
language plpgsql
immutable
strict
parallel safe
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_character text;
  v_code integer;
begin
  for v_character in
    select regexp_split_to_table(p_value, '')
  loop
    v_code := ascii(v_character);
    if (
      (v_code between 0 and 31 and not (
        p_allow_text_whitespace and v_code in (9, 10)
      ))
      or v_code between 127 and 159
      or v_code in (173, 847, 1564, 6158, 8203, 8206, 8207, 8288, 65279)
      or v_code between 8234 and 8238
      or v_code between 8289 and 8303
      or v_code between 65529 and 65531
      or v_code between 917504 and 917631
    ) then
      return false;
    end if;
  end loop;
  return true;
end;
$function$;

create or replace function private.agent_prompt_identity_array_is_canonical(
  p_values text[],
  p_maximum_items integer
) returns boolean
language plpgsql
immutable
strict
parallel safe
set search_path = pg_catalog, private, pg_temp
as $function$
declare
  v_value text;
  v_previous text;
begin
  if p_maximum_items < 0
     or cardinality(p_values) > p_maximum_items
     or coalesce(array_ndims(p_values), 1) <> 1
     or coalesce(array_lower(p_values, 1), 1) <> 1 then
    return false;
  end if;

  foreach v_value in array p_values loop
    if v_value is null
       or nullif(btrim(v_value), '') is null
       or v_value is distinct from btrim(v_value)
       or char_length(v_value) > 512
       or not private.agent_prompt_text_is_safe(v_value, false)
       or (
         v_previous is not null
         and v_value collate "C" <= v_previous collate "C"
       ) then
      return false;
    end if;
    v_previous := v_value;
  end loop;
  return true;
end;
$function$;

revoke all on function private.agent_prompt_text_is_safe(text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_prompt_identity_array_is_canonical(
  text[], integer
) from public, anon, authenticated, service_role;

-- Persisted turns must remain readable under the public evidence contract.
-- These checks reject oversized sources at ingestion instead of silently
-- filtering a valid immutable turn out of every later evidence read.
alter table public.job_conversation_turns
  add constraint job_conversation_turns_source_version_id_length_check
    check (
      char_length(
        source_connection_id::text || ':' || provider_message_id
      ) <= 512
    ),
  add constraint job_conversation_turns_participant_id_length_check
    check (
      char_length(participant_id) <= 512
      and private.agent_prompt_text_is_safe(participant_id, false)
    ),
  add constraint job_conversation_turns_provider_message_safe_check
    check (private.agent_prompt_text_is_safe(provider_message_id, false)),
  add constraint job_conversation_turns_subject_safe_check
    check (
      subject is null
      or (
        subject = btrim(subject)
        and char_length(subject) <= 2048
        and private.agent_prompt_text_is_safe(subject, false)
      )
    ),
  add constraint job_conversation_turns_evidence_body_length_check
    check (
      octet_length(normalized_plain_text) <= 8388608
      and private.agent_prompt_text_is_safe(normalized_plain_text, true)
    ),
  add constraint job_conversation_turns_recipient_identities_check
    check (
      private.agent_prompt_identity_array_is_canonical(
        recipient_identities,
        100
      )
    ),
  add constraint job_conversation_turns_cc_recipient_identities_check
    check (
      private.agent_prompt_identity_array_is_canonical(
        cc_recipient_identities,
        100
      )
    ),
  add constraint job_conversation_turns_attachment_count_check
    check (cardinality(attachment_evidence_ids) <= 100),
  add constraint job_conversation_turns_attachment_identities_check
    check (
      private.agent_prompt_identity_array_is_canonical(
        attachment_evidence_ids,
        100
      )
    );

create index job_conversation_redactions_turn_order_idx
  on public.job_conversation_redaction_events (
    target_turn_id,
    created_at desc,
    id desc
  );

create or replace function public.read_agent_correspondence_evidence_as_system(
  p_request_id text,
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
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

  if p_actor_user_id is null
     or p_company_id is null
     or p_request_id is null
     or p_request_id is distinct from btrim(p_request_id)
     or length(p_request_id) = 0
     or length(p_request_id) > 256
     or p_permission_snapshot_revision is null
     or p_permission_snapshot_revision
       !~ '^sha256:[0-9a-f]{64}$'
     or p_capability_id
       is distinct from 'get_correspondence_evidence'
     or p_capability_revision
       is distinct from
         'get_correspondence_evidence:2026-08-07.v1'
     or p_capability_manifest_revision
       is distinct from '2026-08-10.capability-manifest.v2'
     or p_required_oauth_scope
       is distinct from 'ops.correspondence.read'
     or p_inbox_scope is null
     or p_inbox_scope not in ('all', 'assigned', 'own')
     or p_evidence_ids is null
     or cardinality(p_evidence_ids) < 1
     or cardinality(p_evidence_ids) > 20 then
    raise exception 'invalid_agent_correspondence_evidence_request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_evidence_ids) requested(evidence_id)
    where requested.evidence_id is null
       or requested.evidence_id
         is distinct from btrim(requested.evidence_id)
       or length(requested.evidence_id) = 0
       or length(requested.evidence_id) > 512
  ) or (
    select count(distinct requested.evidence_id)
    from unnest(p_evidence_ids) requested(evidence_id)
  ) <> cardinality(p_evidence_ids) then
    raise exception 'invalid_agent_correspondence_evidence_request'
      using errcode = '22023';
  end if;

  return query
  with current_authority as materialized (
    select authority.permission_snapshot_revision,
           permission.value ->> 'scope' as inbox_scope
    from private.resolve_agent_actor_authority(
      p_actor_user_id,
      p_company_id,
      array['inbox.view']::text[]
    ) authority
    cross join lateral jsonb_array_elements(
      authority.effective_permissions
    ) permission(value)
    where permission.value ->> 'permission' = 'inbox.view'
  ), authorized_turn as materialized (
    select turn.id,
           turn.company_id,
           turn.conversation_id,
           turn.source_connection_id,
           turn.provider_message_id,
           turn.delivered_at,
           turn.side,
           turn.participant_id,
           turn.participant_resolution_status,
           turn.direction,
           turn.source_activity_id,
           turn.source_correspondence_event_id,
           turn.subject,
           turn.recipient_identities,
           turn.cc_recipient_identities,
           turn.normalized_plain_text,
           turn.original_content_hash,
           turn.attachment_evidence_ids
    from current_authority authority
    join public.job_conversation_turns turn
      on turn.company_id = p_company_id
    where authority.permission_snapshot_revision
            = p_permission_snapshot_revision
      and authority.inbox_scope = p_inbox_scope
      and turn.id::text = any(p_evidence_ids)
      and char_length(
        turn.source_connection_id::text
          || ':' || turn.provider_message_id
      ) <= 512
      and octet_length(turn.normalized_plain_text) <= 8388608
      and cardinality(turn.attachment_evidence_ids) <= 100
      and not exists (
        select 1
        from unnest(turn.attachment_evidence_ids) attachment(evidence_id)
        where attachment.evidence_id is null
           or attachment.evidence_id
             is distinct from btrim(attachment.evidence_id)
           or length(attachment.evidence_id) = 0
           or length(attachment.evidence_id) > 512
      )
      and (
        select count(distinct attachment.evidence_id)
        from unnest(
          turn.attachment_evidence_ids
        ) attachment(evidence_id)
      ) = cardinality(turn.attachment_evidence_ids)
      and private.user_can_view_inbox_connection(
        p_actor_user_id,
        p_company_id,
        turn.source_connection_id,
        (
          select inbox_anchor.opportunity_id
          from public.job_conversation_anchors inbox_anchor
          where inbox_anchor.company_id = turn.company_id
            and inbox_anchor.conversation_id = turn.conversation_id
            and inbox_anchor.anchor_kind = 'opportunity'
        )
      )
      and exists (
        select 1
        from public.job_conversation_anchors anchor
        where anchor.company_id = turn.company_id
          and anchor.conversation_id = turn.conversation_id
          and (
            (
              anchor.anchor_kind = 'opportunity'
              and private.agent_user_can_access_entity(
                p_actor_user_id,
                p_company_id,
                'opportunity',
                anchor.opportunity_id,
                'view'
              )
            )
            or
            (
              anchor.anchor_kind = 'project'
              and private.agent_user_can_access_entity(
                p_actor_user_id,
                p_company_id,
                'project',
                anchor.project_id,
                'view'
              )
            )
          )
      )
  ), effective_turn as materialized (
    select turn.id,
           turn.company_id,
           turn.source_connection_id,
           turn.provider_message_id,
           turn.delivered_at,
           turn.side,
           case
             when participant_redaction.id is not null
               then '[PARTICIPANT REDACTED]'::text
             else turn.participant_id
           end as participant_id,
           turn.participant_resolution_status,
           turn.direction,
           turn.source_activity_id,
           turn.source_correspondence_event_id,
           case
             when content_redaction.id is not null
               then '[SUBJECT REDACTED]'::text
             else turn.subject
           end as subject,
           turn.recipient_identities,
           turn.cc_recipient_identities,
           case
             when content_redaction.id is not null
               then '[CONTENT REDACTED]'::text
             else turn.normalized_plain_text
           end as normalized_plain_text,
           case
             when content_redaction.id is not null
               or attachment_redaction.id is not null
               or participant_redaction.id is not null then
               'sha256:' || encode(
                 extensions.digest(
                   convert_to(
                     'ops.redacted-source-version.v1:'
                       || turn.id::text || ':'
                       || turn.original_content_hash || ':'
                       || coalesce(content_redaction.id::text, '') || ':'
                       || coalesce(attachment_redaction.id::text, '') || ':'
                       || coalesce(participant_redaction.id::text, ''),
                     'UTF8'
                   ),
                   'sha256'
                 ),
                 'hex'
               )
             else turn.original_content_hash
           end as original_content_hash,
           case
             when attachment_redaction.id is not null then '{}'::text[]
             else turn.attachment_evidence_ids
           end as attachment_evidence_ids,
           array_remove(
             array[
               case when content_redaction.id is not null
                 then 'content_redacted' end,
               case when attachment_redaction.id is not null
                 then 'attachment_redacted' end,
               case when participant_redaction.id is not null
                 then 'participant_pseudonymized' end
             ]::text[],
             null
           ) as redaction_kinds
    from authorized_turn turn
    left join lateral (
      select redaction.id
      from public.job_conversation_redaction_events redaction
      where redaction.company_id = turn.company_id
        and redaction.conversation_id = turn.conversation_id
        and redaction.target_turn_id = turn.id
        and redaction.redaction_kind = 'content_redacted'
      order by redaction.created_at desc, redaction.id desc
      limit 1
    ) content_redaction on true
    left join lateral (
      select redaction.id
      from public.job_conversation_redaction_events redaction
      where redaction.company_id = turn.company_id
        and redaction.conversation_id = turn.conversation_id
        and redaction.target_turn_id = turn.id
        and redaction.redaction_kind = 'attachment_redacted'
      order by redaction.created_at desc, redaction.id desc
      limit 1
    ) attachment_redaction on true
    left join lateral (
      select redaction.id
      from public.job_conversation_redaction_events redaction
      where redaction.company_id = turn.company_id
        and redaction.conversation_id = turn.conversation_id
        and redaction.target_turn_id = turn.id
        and redaction.redaction_kind = 'participant_pseudonymized'
      order by redaction.created_at desc, redaction.id desc
      limit 1
    ) participant_redaction on true
  )
  select turn.id::text,
         turn.company_id,
         turn.source_connection_id::text
           || ':' || turn.provider_message_id,
         to_char(
           turn.delivered_at at time zone 'UTC',
           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
         ),
         turn.subject,
         turn.side,
         turn.participant_id,
         turn.participant_resolution_status,
         turn.direction,
         turn.source_activity_id,
         turn.source_correspondence_event_id,
         turn.recipient_identities,
         turn.cc_recipient_identities,
         turn.redaction_kinds,
         turn.normalized_plain_text,
         turn.original_content_hash,
         coalesce(
           (
             select jsonb_agg(
               jsonb_build_object(
                 'attachment_id', attachment.evidence_id,
                 'filename', null,
                 'mime_type', null,
                 'size_bytes', null,
                 'inline', false,
                 'content_hash', null
               )
               order by attachment.evidence_id collate "C"
             )
             from unnest(
               turn.attachment_evidence_ids
             ) attachment(evidence_id)
           ),
           '[]'::jsonb
         )
  from effective_turn turn
  order by turn.delivered_at, turn.id;
end;
$function$;

revoke all on function public.read_agent_correspondence_evidence_as_system(
  text, uuid, uuid, text, text, text, text, text, text, text[]
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_correspondence_evidence_as_system(
  text, uuid, uuid, text, text, text, text, text, text, text[]
) to service_role;

comment on function public.read_agent_correspondence_evidence_as_system(
  text, uuid, uuid, text, text, text, text, text, text, text[]
) is
  'Returns immutable delivered job-turn evidence only after current actor authority and opportunity/project visibility are rechecked in the same statement.';

commit;
