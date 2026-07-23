begin;

-- Repair retry semantics for the one correspondence identity that canonical
-- ingest resolves after manifest registration. Every manifest-controlled
-- input remains exact, and the persisted output is revalidated before reuse.

create or replace function public.register_exact_message_recovery_work_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_provider_message_id text,
  p_action text,
  p_manifest_sha256 text,
  p_entry_sha256 text,
  p_manifest_generated_at timestamptz,
  p_manifest_cutoff_at timestamptz,
  p_activity_id uuid,
  p_opportunity_id uuid,
  p_source_opportunity_id uuid,
  p_target_opportunity_id uuid,
  p_correspondence_event_id uuid,
  p_attachment_required boolean,
  p_repair_required boolean,
  p_draft_projection_required boolean,
  p_message_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_work private.email_exact_message_recovery_work%rowtype;
  v_activity public.activities%rowtype;
  v_event public.opportunity_correspondence_events%rowtype;
  v_application private.email_exact_message_recovery_applications%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  perform private.lock_lead_assignment_company(p_company_id);
  perform 1 from public.users actor
  where actor.id = p_actor_user_id
    and actor.company_id = p_company_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false)
  for share;
  if not found then
    raise exception 'recovery_actor_inactive' using errcode = '42501';
  end if;
  perform 1 from public.email_connections connection
  where connection.id = p_connection_id
    and connection.company_id = p_company_id::text
    and connection.status = 'active'
  for share;
  if not found then
    raise exception 'recovery_connection_inactive' using errcode = '42501';
  end if;
  if not public.authorize_email_inbox_action_as_system(
    p_actor_user_id, p_connection_id, null, 'view'
  ) then
    raise exception 'recovery_actor_cannot_view_mailbox' using errcode = '42501';
  end if;
  if p_action not in ('ingest', 'reparent', 'create_target_and_reparent')
    or p_message_payload ->> 'id' is distinct from p_provider_message_id
    or p_message_payload ->> 'threadId' is distinct from p_provider_thread_id
    or nullif(p_message_payload ->> 'date', '') is null
    or p_manifest_sha256 !~ '^[0-9a-f]{64}$'
    or p_entry_sha256 !~ '^[0-9a-f]{64}$'
    or p_manifest_generated_at is null
    or p_manifest_generated_at > clock_timestamp()
    or p_manifest_generated_at < clock_timestamp() - interval '24 hours'
    or p_manifest_cutoff_at is null
    or p_manifest_cutoff_at > p_manifest_generated_at
  then
    raise exception 'invalid_exact_recovery_work' using errcode = '22023';
  end if;

  if p_action = 'ingest' then
    if p_attachment_required
      or p_repair_required
      or p_source_opportunity_id is not null
      or p_target_opportunity_id is not null
      or p_correspondence_event_id is not null
      or (p_activity_id is null and p_opportunity_id is not null)
      or not public.authorize_email_exact_message_ingest_as_system(
        p_actor_user_id, p_company_id, p_connection_id
      )
    then
      raise exception 'recovery_ingest_registration_denied'
        using errcode = '42501';
    end if;

    select activity.* into v_activity
    from public.activities activity
    where activity.company_id = p_company_id
      and (
        activity.email_connection_id = p_connection_id
        or activity.email_connection_id is null
      )
      and activity.email_thread_id = p_provider_thread_id
      and activity.email_message_id = p_provider_message_id
      and activity.type = 'email'
      and activity.direction = 'inbound'
    limit 1
    for share;
    if found and (
      p_activity_id is null
      or v_activity.id is distinct from p_activity_id
      or v_activity.opportunity_id is distinct from p_opportunity_id
    ) then
      raise exception 'recovery_ingest_activity_identity_changed'
        using errcode = '40001';
    elsif not found and p_activity_id is not null then
      raise exception 'recovery_ingest_activity_not_found'
        using errcode = '40001';
    end if;
    if v_activity.id is not null
      and v_activity.email_connection_id is null
      and not exists (
        select 1
        from public.opportunity_correspondence_events event
        where event.company_id = p_company_id
          and event.connection_id = p_connection_id
          and event.provider_thread_id = p_provider_thread_id
          and event.provider_message_id = p_provider_message_id
          and event.activity_id = v_activity.id
          and event.opportunity_id is not distinct from v_activity.opportunity_id
          and event.opportunity_projection_applied is true
          and event.direction = 'inbound'
          and event.party_role = 'customer'
          and event.is_meaningful is true
      )
    then
      raise exception 'recovery_ingest_legacy_mailbox_unproven'
        using errcode = '40001';
    end if;
  else
    if not p_attachment_required
      or not p_repair_required
      or p_opportunity_id is not null
      or p_activity_id is null
      or p_source_opportunity_id is null
      or p_correspondence_event_id is null
      or not private.user_can_edit_opportunity(
        p_actor_user_id, p_source_opportunity_id
      )
    then
      raise exception 'recovery_reparent_registration_denied'
        using errcode = '42501';
    end if;
    if p_action = 'reparent' then
      if p_target_opportunity_id is null
        or p_target_opportunity_id = p_source_opportunity_id
        or not private.user_can_edit_opportunity(
          p_actor_user_id, p_target_opportunity_id
        )
      then
        raise exception 'recovery_reparent_target_denied'
          using errcode = '42501';
      end if;
    elsif not public.authorize_email_exact_message_ingest_as_system(
      p_actor_user_id, p_company_id, p_connection_id
    ) or (
      p_target_opportunity_id is not null
      and not private.user_can_edit_opportunity(
        p_actor_user_id, p_target_opportunity_id
      )
    ) then
      raise exception 'recovery_target_creation_registration_denied'
        using errcode = '42501';
    end if;

    select activity.* into v_activity
    from public.activities activity
    where activity.id = p_activity_id
      and activity.company_id = p_company_id
      and (
        activity.email_connection_id = p_connection_id
        or activity.email_connection_id is null
      )
      and activity.email_thread_id = p_provider_thread_id
      and activity.email_message_id = p_provider_message_id
      and activity.type = 'email'
      and activity.direction = 'inbound'
    for share;
    if not found then
      raise exception 'recovery_registration_activity_not_found'
        using errcode = '40001';
    end if;

    select event.* into v_event
    from public.opportunity_correspondence_events event
    where event.id = p_correspondence_event_id
      and event.company_id = p_company_id
      and event.connection_id = p_connection_id
      and event.provider_thread_id = p_provider_thread_id
      and event.provider_message_id = p_provider_message_id
      and event.activity_id = p_activity_id
      and event.opportunity_projection_applied is true
      and event.direction = 'inbound'
      and event.party_role = 'customer'
      and event.is_meaningful is true
    for share;
    if not found
      or v_event.opportunity_id is distinct from v_activity.opportunity_id
    then
      raise exception 'recovery_registration_event_not_found'
        using errcode = '40001';
    end if;

    if v_activity.opportunity_id is distinct from p_source_opportunity_id then
      if p_target_opportunity_id is null
        or v_activity.opportunity_id is distinct from p_target_opportunity_id
      then
        raise exception 'recovery_registration_owner_changed'
          using errcode = '40001';
      end if;
      select application.* into v_application
      from private.email_exact_message_recovery_applications application
      where application.company_id = p_company_id
        and application.connection_id = p_connection_id
        and application.provider_thread_id = p_provider_thread_id
        and application.provider_message_id = p_provider_message_id
        and application.activity_id = p_activity_id
        and application.correspondence_event_id = p_correspondence_event_id
        and application.source_opportunity_id = p_source_opportunity_id
        and application.target_opportunity_id = p_target_opportunity_id
        and application.actor_user_id = p_actor_user_id
        and application.manifest_sha256 = p_manifest_sha256
        and application.entry_sha256 = p_entry_sha256
      for share;
      if not found then
        raise exception 'recovery_registration_applied_proof_missing'
          using errcode = '40001';
      end if;
    end if;
  end if;

  select prior.* into v_work
  from private.email_exact_message_recovery_work prior
  where prior.company_id = p_company_id
    and prior.connection_id = p_connection_id
    and prior.provider_message_id = p_provider_message_id
    and prior.state = 'abandoned'
  order by prior.abandoned_at desc
  limit 1;
  if found and (
    v_work.superseded_by_manifest_sha256 is distinct from p_manifest_sha256
    or v_work.superseded_by_entry_sha256 is distinct from p_entry_sha256
  ) then
    raise exception 'recovery_superseding_manifest_conflict'
      using errcode = '23505';
  end if;

  insert into private.email_exact_message_recovery_work (
    company_id, connection_id, provider_message_id, provider_thread_id,
    action, actor_user_id, manifest_sha256, entry_sha256,
    manifest_generated_at, manifest_cutoff_at, message_payload,
    activity_id, opportunity_id, source_opportunity_id,
    target_opportunity_id, correspondence_event_id,
    attachment_required, repair_required, draft_projection_required, state
  ) values (
    p_company_id, p_connection_id, p_provider_message_id,
    p_provider_thread_id, p_action, p_actor_user_id, p_manifest_sha256,
    p_entry_sha256, p_manifest_generated_at, p_manifest_cutoff_at,
    p_message_payload, p_activity_id, p_opportunity_id,
    p_source_opportunity_id, p_target_opportunity_id,
    p_correspondence_event_id, p_attachment_required, p_repair_required,
    p_draft_projection_required,
    case when p_action = 'ingest' then 'ingest_pending'
      else 'mutation_pending' end
  ) on conflict (company_id, connection_id, provider_message_id)
    where abandoned_at is null
    do nothing;

  select work.* into v_work
  from private.email_exact_message_recovery_work work
  where work.company_id = p_company_id
    and work.connection_id = p_connection_id
    and work.provider_message_id = p_provider_message_id
    and work.abandoned_at is null
  for update;

  if v_work.action = 'ingest'
    and v_work.correspondence_event_id is not null
  then
    select event.* into v_event
    from public.opportunity_correspondence_events event
    where event.id = v_work.correspondence_event_id
      and event.company_id = p_company_id
      and event.connection_id = p_connection_id
      and event.provider_thread_id = p_provider_thread_id
      and event.provider_message_id = p_provider_message_id
      and event.activity_id is not distinct from v_work.activity_id
      and event.opportunity_id is not distinct from v_work.opportunity_id
      and event.opportunity_projection_applied is true
      and event.direction = 'inbound'
      and event.party_role = 'customer'
      and event.is_meaningful is true
    for share;
    if not found then
      raise exception 'recovery_ingest_persisted_event_identity_changed'
        using errcode = '40001';
    end if;
  end if;
  if v_work.provider_thread_id is distinct from p_provider_thread_id
    or v_work.action is distinct from p_action
    or v_work.actor_user_id is distinct from p_actor_user_id
    or v_work.manifest_sha256 is distinct from p_manifest_sha256
    or v_work.entry_sha256 is distinct from p_entry_sha256
    or v_work.manifest_generated_at is distinct from p_manifest_generated_at
    or v_work.manifest_cutoff_at is distinct from p_manifest_cutoff_at
    or v_work.message_payload is distinct from p_message_payload
    or v_work.attachment_required is distinct from p_attachment_required
    or v_work.repair_required is distinct from p_repair_required
    or v_work.draft_projection_required is distinct from
      p_draft_projection_required
    or (v_work.activity_id is not null and
      v_work.activity_id is distinct from p_activity_id)
    or (v_work.opportunity_id is not null and
      v_work.opportunity_id is distinct from p_opportunity_id)
    or v_work.source_opportunity_id is distinct from p_source_opportunity_id
    or (p_target_opportunity_id is not null and
      v_work.target_opportunity_id is distinct from p_target_opportunity_id)
    or (
      p_action <> 'ingest'
      and v_work.correspondence_event_id is distinct from
        p_correspondence_event_id
    )
  then
    raise exception 'recovery_manifest_conflict' using errcode = '23505';
  end if;
  return private.exact_message_recovery_work_json(v_work);
end;
$function$;

revoke all on function public.register_exact_message_recovery_work_as_system(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, timestamptz,
  uuid, uuid, uuid, uuid, uuid, boolean, boolean, boolean, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.register_exact_message_recovery_work_as_system(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, timestamptz,
  uuid, uuid, uuid, uuid, uuid, boolean, boolean, boolean, jsonb
) to service_role;

commit;
