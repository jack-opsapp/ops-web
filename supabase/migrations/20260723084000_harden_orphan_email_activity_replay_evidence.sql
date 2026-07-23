-- Bind orphan adoption to the full persisted activity payload that canonical
-- matching actually consumed. The wrapper holds the same parent/lease/activity
-- locks as the canonical adoption RPC, compares caller evidence under that
-- lock, and then delegates the NULL-to-target CAS and correspondence projection
-- to the existing guarded implementation in the same transaction.

begin;

create or replace function public.adopt_orphan_email_activity_with_payload_guard_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_sync_lock_owner uuid,
  p_activity_id uuid,
  p_target_opportunity_id uuid,
  p_provider_thread_id text,
  p_provider_message_id text,
  p_ingestion_source text,
  p_match_confidence text,
  p_party_role text,
  p_is_meaningful boolean,
  p_noise_reason text,
  p_occurred_at timestamptz,
  p_subject text,
  p_from_email text,
  p_to_emails text[],
  p_cc_emails text[],
  p_content text,
  p_body_text text,
  p_body_text_clean text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_activity public.activities%rowtype;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_company_id is null
    or p_connection_id is null
    or p_sync_lock_owner is null
    or p_activity_id is null
    or p_target_opportunity_id is null
    or p_occurred_at is null
    or nullif(pg_catalog.btrim(p_provider_thread_id), '') is null
    or nullif(pg_catalog.btrim(p_provider_message_id), '') is null
    or p_ingestion_source not in ('email_sync', 'email_recovery')
  then
    raise exception 'invalid_orphan_email_activity_payload_guard'
      using errcode = '22023';
  end if;

  perform private.lock_lead_assignment_company(p_company_id);

  perform 1
  from public.opportunities opportunity
  where opportunity.id = p_target_opportunity_id
    and opportunity.company_id = p_company_id
    and opportunity.deleted_at is null
    and opportunity.merged_into_opportunity_id is null
  for update;
  if not found then
    raise exception 'orphan_email_activity_target_not_found'
      using errcode = 'P0002';
  end if;

  perform 1
  from private.email_provider_mailbox_sync_leases lease
  where lease.connection_id = p_connection_id
    and lease.owner_id = p_sync_lock_owner
    and lease.expires_at > pg_catalog.clock_timestamp()
  for update;
  if not found then
    raise exception 'orphan_email_activity_mailbox_lease_changed'
      using errcode = '40001';
  end if;

  perform 1
  from public.email_connections connection
  where connection.id = p_connection_id
    and connection.company_id = p_company_id::text
    and connection.status = 'active'
    and connection.sync_enabled is true
    and connection.sync_lock_owner = p_sync_lock_owner
    and connection.sync_in_progress_at is not null
  for update;
  if not found then
    raise exception 'orphan_email_activity_connection_changed'
      using errcode = '40001';
  end if;

  select activity.*
  into v_activity
  from public.activities activity
  where activity.id = p_activity_id
    and activity.company_id = p_company_id
    and activity.email_connection_id = p_connection_id
    and activity.email_thread_id = p_provider_thread_id
    and activity.email_message_id = p_provider_message_id
    and activity.type = 'email'
    and activity.direction = 'inbound'
  for update;
  if not found then
    raise exception 'orphan_email_activity_not_found'
      using errcode = 'P0002';
  end if;

  if v_activity.created_at is distinct from p_occurred_at
    or v_activity.subject is distinct from p_subject
    or pg_catalog.lower(pg_catalog.btrim(v_activity.from_email))
      is distinct from pg_catalog.lower(pg_catalog.btrim(p_from_email))
    or coalesce(v_activity.to_emails, '{}'::text[])
      is distinct from coalesce(p_to_emails, '{}'::text[])
    or coalesce(v_activity.cc_emails, '{}'::text[])
      is distinct from coalesce(p_cc_emails, '{}'::text[])
    or v_activity.content is distinct from p_content
    or v_activity.body_text is distinct from p_body_text
    or v_activity.body_text_clean is distinct from p_body_text_clean
    or (
      p_ingestion_source = 'email_recovery'
      and (
        coalesce(v_activity.has_attachments, false) is true
        or coalesce(v_activity.attachment_count, 0) <> 0
      )
    )
  then
    raise exception 'orphan_email_activity_payload_changed'
      using errcode = '40001';
  end if;

  v_result := public.adopt_orphan_email_activity_as_system(
    p_actor_user_id,
    p_company_id,
    p_connection_id,
    p_sync_lock_owner,
    p_activity_id,
    p_target_opportunity_id,
    p_provider_thread_id,
    p_provider_message_id,
    p_ingestion_source,
    p_match_confidence,
    p_party_role,
    p_is_meaningful,
    p_noise_reason,
    p_occurred_at,
    p_subject,
    p_from_email,
    p_to_emails,
    p_cc_emails
  );
  return v_result;
end;
$function$;

revoke all on function public.adopt_orphan_email_activity_with_payload_guard_as_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, boolean,
  text, timestamptz, text, text, text[], text[], text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.adopt_orphan_email_activity_with_payload_guard_as_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, boolean,
  text, timestamptz, text, text, text[], text[], text, text, text
) to service_role;

comment on function public.adopt_orphan_email_activity_with_payload_guard_as_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, boolean,
  text, timestamptz, text, text, text[], text[], text, text, text
) is
  'Payload-bound wrapper around guarded orphan email adoption. Locks the '
  'canonical activity and rejects timestamp, participant, body, or recovery '
  'attachment drift before delegating the atomic CAS and event projection.';

commit;
