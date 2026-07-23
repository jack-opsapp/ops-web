-- Allow deterministic email acceptance to cite one exact projected message
-- when a forwarded/form conversation has no durable public.email_threads row.
-- The legacy CRM-thread shape remains valid and equally guarded.

create or replace function private.valid_actorless_opportunity_conversion_evidence(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_source_path text,
  p_evidence jsonb
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_connection_id uuid;
  v_email_thread_id uuid;
  v_source_activity_id uuid;
  v_decisive_event_id uuid;
  v_evaluated_through_event_id uuid;
  v_evaluated_through_at timestamptz;
  v_conversion_completed boolean := false;
  v_has_newer_event boolean := false;
  v_message_scoped boolean := false;
begin
  if jsonb_typeof(p_evidence) is distinct from 'object' then
    return false;
  end if;

  v_connection_id := private.try_parse_uuid(p_evidence ->> 'connection_id');
  if v_connection_id is null then
    return false;
  end if;

  if p_source_path = 'email_accept' then
    v_message_scoped :=
      p_evidence ? 'conversation_scope'
      or p_evidence ? 'source_activity_id';

    if v_message_scoped then
      if not (
        p_evidence ?& array[
          'connection_id',
          'conversation_scope',
          'source_activity_id',
          'provider_thread_id',
          'provider_message_id',
          'decisive_event_id',
          'decisive_direction',
          'evaluated_through_event_id',
          'signals',
          'decision'
        ]
        and p_evidence - array[
          'connection_id',
          'conversation_scope',
          'source_activity_id',
          'provider_thread_id',
          'provider_message_id',
          'decisive_event_id',
          'decisive_direction',
          'evaluated_through_event_id',
          'signals',
          'decision'
        ]::text[] = '{}'::jsonb
        and p_evidence ->> 'conversation_scope' = 'message'
      ) then
        return false;
      end if;

      v_source_activity_id := private.try_parse_uuid(
        p_evidence ->> 'source_activity_id'
      );
      if v_source_activity_id is null then
        return false;
      end if;
    else
      if not (
        p_evidence ?& array[
          'connection_id',
          'email_thread_id',
          'provider_thread_id',
          'provider_message_id',
          'decisive_event_id',
          'decisive_direction',
          'evaluated_through_event_id',
          'signals',
          'decision'
        ]
        and p_evidence - array[
          'connection_id',
          'email_thread_id',
          'provider_thread_id',
          'provider_message_id',
          'decisive_event_id',
          'decisive_direction',
          'evaluated_through_event_id',
          'signals',
          'decision'
        ]::text[] = '{}'::jsonb
      ) then
        return false;
      end if;

      v_email_thread_id := private.try_parse_uuid(
        p_evidence ->> 'email_thread_id'
      );
      if v_email_thread_id is null then
        return false;
      end if;
    end if;

    if not (
      p_evidence ->> 'decision' = 'auto_advance_won'
      and p_evidence ->> 'decisive_direction' in ('inbound', 'outbound')
      and nullif(p_evidence ->> 'provider_thread_id', '') is not null
      and nullif(p_evidence ->> 'provider_message_id', '') is not null
      and jsonb_typeof(p_evidence -> 'signals') = 'array'
      and jsonb_array_length(p_evidence -> 'signals') > 0
      and not exists (
        select 1
        from jsonb_array_elements_text(p_evidence -> 'signals') signal(value)
        where signal.value is null
          or signal.value not in (
            'explicit_acceptance',
            'schedule_confirmed',
            'deposit_requested',
            'payment_confirmed',
            'signed_estimate'
          )
      )
    ) then
      return false;
    end if;

    -- Provider ids are opaque. These UUIDs are the mailbox-scoped durable
    -- authorization keys and must both belong to this opportunity.
    v_decisive_event_id := private.try_parse_uuid(
      p_evidence ->> 'decisive_event_id'
    );
    v_evaluated_through_event_id := private.try_parse_uuid(
      p_evidence ->> 'evaluated_through_event_id'
    );
    if v_decisive_event_id is null
      or v_evaluated_through_event_id is null
    then
      return false;
    end if;

    select head.occurred_at
      into v_evaluated_through_at
      from public.opportunity_correspondence_events head
     where head.id = v_evaluated_through_event_id
       and head.company_id = p_company_id
       and head.opportunity_id = p_opportunity_id
       and head.is_meaningful is true
       and head.opportunity_projection_applied is true;
    if not found then
      return false;
    end if;

    select exists (
      select 1
      from public.opportunity_correspondence_events newer
      where newer.company_id = p_company_id
        and newer.opportunity_id = p_opportunity_id
        and newer.is_meaningful is true
        and newer.opportunity_projection_applied is true
        and (
          newer.occurred_at > v_evaluated_through_at
          or (
            newer.occurred_at = v_evaluated_through_at
            and newer.id > v_evaluated_through_event_id
          )
        )
    ) into v_has_newer_event;
    if v_has_newer_event then
      select exists (
        select 1
        from public.opportunity_conversion_events conversion_event
        where conversion_event.company_id = p_company_id
          and conversion_event.opportunity_id = p_opportunity_id
          and conversion_event.event_type = 'converted_to_project'
      ) into v_conversion_completed;
    end if;
    if v_has_newer_event and not v_conversion_completed then
      return false;
    end if;

    if v_message_scoped then
      return exists (
        select 1
        from public.email_connections connection
        join public.opportunity_correspondence_events event
          on event.id = v_decisive_event_id
         and event.activity_id = v_source_activity_id
         and event.connection_id = connection.id
         and event.company_id = p_company_id
         and event.opportunity_id = p_opportunity_id
         and event.provider_thread_id = p_evidence ->> 'provider_thread_id'
         and event.provider_message_id = p_evidence ->> 'provider_message_id'
         and event.direction = p_evidence ->> 'decisive_direction'
         and event.is_meaningful is true
         and event.opportunity_projection_applied is true
        join public.activities activity
          on activity.id = event.activity_id
         and activity.company_id = p_company_id
         and activity.opportunity_id = p_opportunity_id
         and activity.email_connection_id = connection.id
         and activity.email_message_id = event.provider_message_id
         and activity.email_thread_id = event.provider_thread_id
         and activity.direction = event.direction
         and activity.type = 'email'
         and (
           (
             event.direction = 'inbound'
             and event.party_role = 'customer'
             and private.opportunity_sender_is_persisted_customer(
               p_company_id,
               p_opportunity_id,
               event.from_email
             )
           )
           or (
             event.direction = 'outbound'
             and event.party_role = 'ops'
             and not (
               p_evidence -> 'signals' ?| array[
                 'explicit_acceptance',
                 'deposit_requested',
                 'signed_estimate'
               ]
             )
           )
         )
         and (
           not (p_evidence -> 'signals' ? 'signed_estimate')
           or exists (
             select 1
             from public.email_attachments attachment
             join public.attachment_inspections inspection
               on inspection.email_attachment_id = attachment.id
              and inspection.company_id = attachment.company_id
              and inspection.connection_id = attachment.connection_id
              and inspection.message_id = attachment.message_id
              and inspection.attachment_id = attachment.attachment_id
              and inspection.provider_thread_id = attachment.provider_thread_id
              and inspection.is_signed_estimate is true
             where attachment.company_id = p_company_id
               and attachment.connection_id = connection.id
               and attachment.activity_id = event.activity_id
               and attachment.message_id = event.provider_message_id
               and attachment.provider_thread_id = event.provider_thread_id
               and attachment.opportunity_id = p_opportunity_id
               and attachment.attribution_status = 'attributed'
           )
         )
        where connection.id = v_connection_id
          and connection.company_id = p_company_id::text
          and connection.status = 'active'
          and connection.sync_enabled is true
      );
    end if;

    return exists (
      select 1
      from public.email_connections connection
      join public.email_threads thread
        on thread.connection_id = connection.id
       and thread.company_id = p_company_id
       and thread.id = v_email_thread_id
       and thread.provider_thread_id = p_evidence ->> 'provider_thread_id'
       and thread.opportunity_id = p_opportunity_id
      join public.opportunity_correspondence_events event
        on event.id = v_decisive_event_id
       and event.connection_id = connection.id
       and event.company_id = p_company_id
       and event.opportunity_id = p_opportunity_id
       and event.provider_thread_id = thread.provider_thread_id
       and event.provider_message_id = p_evidence ->> 'provider_message_id'
       and event.direction = p_evidence ->> 'decisive_direction'
       and event.is_meaningful is true
       and event.opportunity_projection_applied is true
       and (
         (
           event.direction = 'inbound'
           and event.party_role = 'customer'
           and private.opportunity_sender_is_persisted_customer(
             p_company_id,
             p_opportunity_id,
             event.from_email
           )
         )
         or (
           event.direction = 'outbound'
           and event.party_role = 'ops'
           and not (
             p_evidence -> 'signals' ?| array[
               'explicit_acceptance',
               'deposit_requested',
               'signed_estimate'
             ]
           )
         )
       )
       and (
         not (p_evidence -> 'signals' ? 'signed_estimate')
         or exists (
           select 1
           from public.email_attachments attachment
           join public.attachment_inspections inspection
             on inspection.email_attachment_id = attachment.id
            and inspection.company_id = attachment.company_id
            and inspection.connection_id = attachment.connection_id
            and inspection.message_id = attachment.message_id
            and inspection.attachment_id = attachment.attachment_id
            and inspection.provider_thread_id = attachment.provider_thread_id
            and inspection.is_signed_estimate is true
           where attachment.company_id = p_company_id
             and attachment.connection_id = connection.id
             and attachment.activity_id = event.activity_id
             and attachment.message_id = event.provider_message_id
             and attachment.provider_thread_id = thread.provider_thread_id
             and attachment.opportunity_id = p_opportunity_id
             and attachment.attribution_status = 'attributed'
         )
       )
      where connection.id = v_connection_id
        and connection.company_id = p_company_id::text
        and connection.status = 'active'
        and connection.sync_enabled is true
    );
  end if;

  return false;
end;
$function$;

revoke all on function private.valid_actorless_opportunity_conversion_evidence(
  uuid, uuid, text, jsonb
) from public, anon, authenticated, service_role;
