-- Atomically adopt one exact outbound activity that was durably inserted with
-- a NULL opportunity before the inbound side of its provider thread became a
-- canonical lead. The narrow adapter preserves the global child-reparent
-- guard: ordinary sync must prove the current mailbox lease, immutable thread
-- owner, target, activity payload, and correspondence identity before it may
-- mint one exact transaction-scoped child token.

begin;

do $orphan_outbound_adoption_prerequisites$
begin
  if to_regprocedure('private.lock_lead_assignment_company(uuid)') is null
    or to_regprocedure(
      'public.record_opportunity_correspondence_event(uuid,uuid,uuid,uuid,text,text,text,text,boolean,text,timestamptz,text,uuid,text,text,text,text[],text[],boolean)'
    ) is null
    or to_regclass('private.opportunity_child_reparent_tokens') is null
    or to_regclass('private.email_provider_mailbox_sync_leases') is null
    or to_regclass('public.opportunity_email_threads') is null
  then
    raise exception
      'guarded_orphan_outbound_email_activity_adoption_prerequisites_missing'
      using errcode = '55000';
  end if;
end;
$orphan_outbound_adoption_prerequisites$;

create or replace function public.adopt_orphan_outbound_email_activity_with_payload_guard_as_system(
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
  v_existing_event public.opportunity_correspondence_events%rowtype;
  v_event_id uuid;
  v_moved_rows integer := 0;
  v_applied boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is not null
    or p_company_id is null
    or p_connection_id is null
    or p_sync_lock_owner is null
    or p_activity_id is null
    or p_target_opportunity_id is null
    or p_occurred_at is null
    or p_is_meaningful is null
    or nullif(pg_catalog.btrim(p_provider_thread_id), '') is null
    or nullif(pg_catalog.btrim(p_provider_message_id), '') is null
    or p_provider_thread_id is distinct from
      pg_catalog.btrim(p_provider_thread_id)
    or p_provider_message_id is distinct from
      pg_catalog.btrim(p_provider_message_id)
    or p_ingestion_source is distinct from 'email_sync'
    or nullif(pg_catalog.btrim(p_match_confidence), '') is null
    or p_match_confidence is distinct from
      pg_catalog.btrim(p_match_confidence)
    or p_party_role is null
    or p_party_role not in (
      'customer',
      'ops',
      'internal',
      'provider',
      'system',
      'marketing',
      'unknown'
    )
    or (
      p_noise_reason is not null
      and p_noise_reason not in (
        'provider_noise',
        'bounce',
        'internal_system',
        'duplicate_provider_message_id',
        'marketing_noise',
        'missing_provider_id'
      )
    )
  then
    raise exception 'invalid_orphan_outbound_email_activity_adoption'
      using errcode = '22023';
  end if;

  perform private.lock_lead_assignment_company(p_company_id);

  -- Match canonical correspondence/merge lock order: parent first, then the
  -- immutable thread owner and exact child. Deleted or merged targets cannot
  -- receive replayed correspondence.
  perform 1
  from public.opportunities opportunity
  where opportunity.id = p_target_opportunity_id
    and opportunity.company_id = p_company_id
    and opportunity.deleted_at is null
    and opportunity.merged_into_opportunity_id is null
  for update;
  if not found then
    raise exception 'orphan_outbound_email_activity_target_not_found'
      using errcode = 'P0002';
  end if;

  perform 1
  from public.opportunity_email_threads thread_link
  where thread_link.opportunity_id = p_target_opportunity_id
    and thread_link.thread_id = p_provider_thread_id
    and thread_link.connection_id = p_connection_id
  for update;
  if not found then
    raise exception 'orphan_outbound_email_activity_thread_owner_changed'
      using errcode = '40001';
  end if;

  -- A stale or overlapping worker can never adopt after its physical mailbox
  -- lease or public mirror has been replaced.
  perform 1
  from private.email_provider_mailbox_sync_leases lease
  where lease.connection_id = p_connection_id
    and lease.owner_id = p_sync_lock_owner
    and lease.expires_at > pg_catalog.clock_timestamp()
  for update;
  if not found then
    raise exception 'orphan_outbound_email_activity_mailbox_lease_changed'
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
    raise exception 'orphan_outbound_email_activity_connection_changed'
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
    and activity.direction = 'outbound'
  for update;
  if not found then
    raise exception 'orphan_outbound_email_activity_not_found'
      using errcode = 'P0002';
  end if;
  if v_activity.opportunity_id is not null
    and v_activity.opportunity_id is distinct from p_target_opportunity_id
  then
    raise exception 'orphan_outbound_email_activity_owner_conflict'
      using errcode = '23505';
  end if;

  if v_activity.created_at is distinct from p_occurred_at
    or v_activity.subject is distinct from p_subject
    or pg_catalog.lower(pg_catalog.btrim(v_activity.from_email))
      is distinct from
      pg_catalog.lower(pg_catalog.btrim(p_from_email))
    or coalesce(v_activity.to_emails, '{}'::text[])
      is distinct from coalesce(p_to_emails, '{}'::text[])
    or coalesce(v_activity.cc_emails, '{}'::text[])
      is distinct from coalesce(p_cc_emails, '{}'::text[])
    or v_activity.content is distinct from p_content
    or v_activity.body_text is distinct from p_body_text
    or v_activity.body_text_clean is distinct from p_body_text_clean
  then
    raise exception 'orphan_outbound_email_activity_payload_changed'
      using errcode = '40001';
  end if;

  select event.*
  into v_existing_event
  from public.opportunity_correspondence_events event
  where event.company_id = p_company_id
    and event.connection_id = p_connection_id
    and event.provider_message_id = p_provider_message_id
  order by event.created_at asc, event.id
  limit 1
  for update;

  if found and (
    v_activity.opportunity_id is null
    or v_existing_event.opportunity_id is distinct from
      p_target_opportunity_id
    or v_existing_event.activity_id is distinct from p_activity_id
    or v_existing_event.provider_thread_id is distinct from
      p_provider_thread_id
    or v_existing_event.direction is distinct from 'outbound'
    or v_existing_event.party_role is distinct from p_party_role
    or v_existing_event.is_meaningful is distinct from p_is_meaningful
  ) then
    raise exception
      'orphan_outbound_email_activity_correspondence_conflict'
      using errcode = '23505';
  end if;

  if v_activity.opportunity_id is null then
    insert into private.opportunity_child_reparent_tokens (
      transaction_id,
      backend_pid,
      table_name,
      row_id,
      old_opportunity_id,
      new_opportunity_id
    ) values (
      pg_catalog.txid_current(),
      pg_catalog.pg_backend_pid(),
      'activities',
      p_activity_id,
      null,
      p_target_opportunity_id
    )
    on conflict (transaction_id, backend_pid, table_name, row_id)
    do update set
      old_opportunity_id = excluded.old_opportunity_id,
      new_opportunity_id = excluded.new_opportunity_id;

    update public.activities activity
    set
      opportunity_id = p_target_opportunity_id,
      match_needs_review = false,
      suggested_client_id = null,
      match_confidence = p_match_confidence,
      is_read = true
    where activity.id = p_activity_id
      and activity.company_id = p_company_id
      and activity.email_connection_id = p_connection_id
      and activity.email_thread_id = p_provider_thread_id
      and activity.email_message_id = p_provider_message_id
      and activity.type = 'email'
      and activity.direction = 'outbound'
      and activity.opportunity_id is null;
    get diagnostics v_moved_rows = row_count;
    if v_moved_rows <> 1 then
      raise exception 'orphan_outbound_email_activity_adoption_race'
        using errcode = '40001';
    end if;
    v_applied := true;
  else
    update public.activities activity
    set
      match_needs_review = false,
      suggested_client_id = null,
      match_confidence = p_match_confidence,
      is_read = true
    where activity.id = p_activity_id
      and activity.company_id = p_company_id
      and activity.opportunity_id = p_target_opportunity_id
      and activity.email_connection_id = p_connection_id
      and activity.email_thread_id = p_provider_thread_id
      and activity.email_message_id = p_provider_message_id
      and activity.type = 'email'
      and activity.direction = 'outbound';
    get diagnostics v_moved_rows = row_count;
    if v_moved_rows <> 1 then
      raise exception 'orphan_outbound_email_activity_replay_race'
        using errcode = '40001';
    end if;
  end if;

  -- The child CAS and first outbound correspondence/counter projection share
  -- one transaction. Any failure rolls the adoption back to the durable orphan.
  select correspondence.event_id
  into v_event_id
  from public.record_opportunity_correspondence_event(
    p_company_id,
    p_target_opportunity_id,
    p_activity_id,
    p_connection_id,
    p_provider_thread_id,
    p_provider_message_id,
    'outbound',
    p_party_role,
    p_is_meaningful,
    p_noise_reason,
    p_occurred_at,
    null,
    null,
    'sync_activity',
    p_subject,
    p_from_email,
    coalesce(p_to_emails, '{}'::text[]),
    coalesce(p_cc_emails, '{}'::text[]),
    true
  ) correspondence;
  if v_event_id is null then
    raise exception
      'orphan_outbound_email_activity_correspondence_not_projected'
      using errcode = '55000';
  end if;

  delete from private.opportunity_child_reparent_tokens token
  where token.transaction_id = pg_catalog.txid_current()
    and token.backend_pid = pg_catalog.pg_backend_pid()
    and token.table_name = 'activities'
    and token.row_id = p_activity_id;

  return pg_catalog.jsonb_build_object(
    'applied', v_applied,
    'already_applied', not v_applied,
    'activity_id', p_activity_id,
    'opportunity_id', p_target_opportunity_id,
    'correspondence_event_id', v_event_id
  );
exception when others then
  delete from private.opportunity_child_reparent_tokens token
  where token.transaction_id = pg_catalog.txid_current()
    and token.backend_pid = pg_catalog.pg_backend_pid()
    and token.table_name = 'activities'
    and token.row_id = p_activity_id;
  raise;
end;
$function$;

revoke all on function public.adopt_orphan_outbound_email_activity_with_payload_guard_as_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, boolean,
  text, timestamptz, text, text, text[], text[], text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.adopt_orphan_outbound_email_activity_with_payload_guard_as_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, boolean,
  text, timestamptz, text, text, text[], text[], text, text, text
) to service_role;

comment on function public.adopt_orphan_outbound_email_activity_with_payload_guard_as_system(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, boolean,
  text, timestamptz, text, text, text[], text[], text, text, text
) is
  'Lease-, thread-owner-, and payload-bound adoption of one exact outbound '
  'NULL-owner email activity. Token-gates the child CAS and atomically records '
  'canonical outbound correspondence without changing stage or assignment.';

commit;
