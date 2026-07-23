begin;

-- Re-prove every durable exact-message recovery transition from canonical rows.
-- The public step RPC is an acknowledgement surface, not an authority to
-- supply activity, opportunity, event, attachment, repair, or projection proof.

do $exact_recovery_transition_prerequisites$
begin
  if to_regclass('private.email_exact_message_recovery_work') is null
    or to_regclass('private.email_exact_message_recovery_applications') is null
    or to_regclass('public.unanswered_lead_message_projections') is null
    or to_regprocedure(
      'private.exact_message_recovery_attachment_state(uuid,uuid,text,text,uuid,uuid,bigint)'
    ) is null
  then
    raise exception 'exact_recovery_transition_prerequisites_missing'
      using errcode = '55000';
  end if;
end;
$exact_recovery_transition_prerequisites$;

create or replace function private.prove_exact_message_recovery_work_transition()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_activity public.activities%rowtype;
  v_event public.opportunity_correspondence_events%rowtype;
  v_application private.email_exact_message_recovery_applications%rowtype;
  v_attachment_ids uuid[];
  v_transition_count integer;
  v_target_opportunity_id uuid;
  v_summary_floor timestamptz;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if tg_op <> 'UPDATE' then
    raise exception 'exact_recovery_transition_invalid' using errcode = '55000';
  end if;

  if new.id is distinct from old.id
    or new.company_id is distinct from old.company_id
    or new.connection_id is distinct from old.connection_id
    or new.provider_message_id is distinct from old.provider_message_id
    or new.provider_thread_id is distinct from old.provider_thread_id
    or new.action is distinct from old.action
    or new.actor_user_id is distinct from old.actor_user_id
    or new.manifest_sha256 is distinct from old.manifest_sha256
    or new.entry_sha256 is distinct from old.entry_sha256
    or new.manifest_generated_at is distinct from old.manifest_generated_at
    or new.manifest_cutoff_at is distinct from old.manifest_cutoff_at
    or new.message_payload is distinct from old.message_payload
    or new.attachment_required is distinct from old.attachment_required
    or new.repair_required is distinct from old.repair_required
    or new.draft_projection_required is distinct from
      old.draft_projection_required
    or new.created_at is distinct from old.created_at
    or new.updated_at < old.updated_at
    or (old.attachment_completed_at is not null and
      new.attachment_ids is distinct from old.attachment_ids)
  then
    raise exception 'exact_recovery_work_immutable_identity_changed'
      using errcode = '40001';
  end if;
  if old.state = 'abandoned' then
    raise exception 'exact_recovery_abandoned_work_is_terminal'
      using errcode = '40001';
  end if;
  if (old.mutation_completed_at is not null and
      new.mutation_completed_at is distinct from old.mutation_completed_at)
    or (old.attachment_completed_at is not null and
      new.attachment_completed_at is distinct from old.attachment_completed_at)
    or (old.repair_completed_at is not null and
      new.repair_completed_at is distinct from old.repair_completed_at)
    or (old.draft_projection_completed_at is not null and
      new.draft_projection_completed_at is distinct from
        old.draft_projection_completed_at)
  then
    raise exception 'exact_recovery_work_step_regressed'
      using errcode = '40001';
  end if;

  -- Reviewed supersession is the only non-step transition. Its RPC already
  -- proves the replacement actor and exact unchanged product state; the
  -- trigger keeps the old audit row immutable and rejects started work.
  if new.state = 'abandoned' then
    if old.mutation_completed_at is not null
      or old.attachment_completed_at is not null
      or old.repair_completed_at is not null
      or old.draft_projection_completed_at is not null
      or new.mutation_completed_at is not null
      or new.attachment_completed_at is not null
      or new.repair_completed_at is not null
      or new.draft_projection_completed_at is not null
      or new.activity_id is distinct from old.activity_id
      or new.opportunity_id is distinct from old.opportunity_id
      or new.source_opportunity_id is distinct from old.source_opportunity_id
      or new.target_opportunity_id is distinct from old.target_opportunity_id
      or new.correspondence_event_id is distinct from
        old.correspondence_event_id
      or new.attachment_scan_generation is distinct from
        old.attachment_scan_generation
      or new.attachment_ids is distinct from old.attachment_ids
      or new.abandoned_at is null
      or new.abandoned_by is null
      or new.superseded_by_manifest_sha256 is null
      or new.superseded_by_entry_sha256 is null
      or new.superseded_by_manifest_sha256 = old.manifest_sha256
      or exists (
        select 1
        from private.email_exact_message_recovery_applications application
        where application.company_id = old.company_id
          and application.connection_id = old.connection_id
          and application.provider_message_id = old.provider_message_id
      )
    then
      raise exception 'exact_recovery_work_cannot_be_abandoned'
        using errcode = '55000';
    end if;
    return new;
  end if;

  if new.abandoned_at is distinct from old.abandoned_at
    or new.abandoned_by is distinct from old.abandoned_by
    or new.superseded_by_manifest_sha256 is distinct from
      old.superseded_by_manifest_sha256
    or new.superseded_by_entry_sha256 is distinct from
      old.superseded_by_entry_sha256
  then
    raise exception 'exact_recovery_abandonment_audit_changed'
      using errcode = '40001';
  end if;

  perform private.lock_lead_assignment_company(old.company_id);
  perform 1
  from public.users actor
  where actor.id = old.actor_user_id
    and actor.company_id = old.company_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false)
  for share;
  if not found then
    raise exception 'recovery_actor_inactive' using errcode = '42501';
  end if;
  perform 1
  from public.email_connections connection
  where connection.id = old.connection_id
    and connection.company_id = old.company_id::text
    and connection.status = 'active'
  for share;
  if not found or not public.authorize_email_inbox_action_as_system(
    old.actor_user_id, old.connection_id, null, 'view'
  ) then
    raise exception 'recovery_step_mailbox_denied' using errcode = '42501';
  end if;

  v_transition_count :=
    case when old.mutation_completed_at is null and
      new.mutation_completed_at is not null then 1 else 0 end
    + case when old.attachment_completed_at is null and
      new.attachment_completed_at is not null then 1 else 0 end
    + case when old.repair_completed_at is null and
      new.repair_completed_at is not null then 1 else 0 end
    + case when old.draft_projection_completed_at is null and
      new.draft_projection_completed_at is not null then 1 else 0 end;
  if v_transition_count <> 1 then
    raise exception 'exact_recovery_transition_must_advance_one_step'
      using errcode = '23514';
  end if;

  if old.action = 'ingest' then
    if not public.authorize_email_exact_message_ingest_as_system(
      old.actor_user_id, old.company_id, old.connection_id
    ) then
      raise exception 'recovery_ingest_step_denied' using errcode = '42501';
    end if;

    select activity.* into strict v_activity
    from public.activities activity
    where activity.company_id = old.company_id
      and activity.email_connection_id = old.connection_id
      and activity.email_thread_id = old.provider_thread_id
      and activity.email_message_id = old.provider_message_id
      and activity.type = 'email'
      and activity.direction = 'inbound'
      and activity.opportunity_id is not null
    for share;

    select event.* into strict v_event
    from public.opportunity_correspondence_events event
    where event.company_id = old.company_id
      and event.connection_id = old.connection_id
      and event.provider_thread_id = old.provider_thread_id
      and event.provider_message_id = old.provider_message_id
      and event.activity_id = v_activity.id
      and event.opportunity_id = v_activity.opportunity_id
      and event.direction = 'inbound'
      and event.party_role = 'customer'
      and event.is_meaningful is true
      and event.opportunity_projection_applied is true
    for share;

    perform 1
    from public.opportunities opportunity
    where opportunity.id = v_activity.opportunity_id
      and opportunity.company_id = old.company_id
      and opportunity.deleted_at is null
      and opportunity.merged_into_opportunity_id is null
    for share;
    if not found or not private.user_can_edit_opportunity(
      old.actor_user_id, v_activity.opportunity_id
    ) then
      raise exception 'recovery_ingest_target_changed' using errcode = '40001';
    end if;

    if new.activity_id is distinct from v_activity.id
      or new.opportunity_id is distinct from v_activity.opportunity_id
      or new.source_opportunity_id is not null
      or new.target_opportunity_id is not null
      or (new.correspondence_event_id is not null and
        new.correspondence_event_id is distinct from v_event.id)
    then
      raise exception 'exact_recovery_ingest_proof_changed'
        using errcode = '40001';
    end if;
    new.activity_id := v_activity.id;
    new.opportunity_id := v_activity.opportunity_id;
    new.correspondence_event_id := v_event.id;
    v_target_opportunity_id := v_activity.opportunity_id;
    v_summary_floor := old.created_at;
  else
    select application.* into strict v_application
    from private.email_exact_message_recovery_applications application
    where application.company_id = old.company_id
      and application.connection_id = old.connection_id
      and application.provider_thread_id = old.provider_thread_id
      and application.provider_message_id = old.provider_message_id
      and application.actor_user_id = old.actor_user_id
      and application.manifest_sha256 = old.manifest_sha256
      and application.entry_sha256 = old.entry_sha256
    for share;

    if v_application.activity_id is distinct from new.activity_id
      or v_application.source_opportunity_id is distinct from
        new.source_opportunity_id
      or v_application.target_opportunity_id is distinct from
        new.target_opportunity_id
      or v_application.correspondence_event_id is distinct from
        new.correspondence_event_id
      or new.opportunity_id is not null
    then
      raise exception 'exact_recovery_application_identity_changed'
        using errcode = '40001';
    end if;

    perform 1
    from public.opportunities opportunity
    where opportunity.company_id = old.company_id
      and opportunity.id = any(array[
        v_application.source_opportunity_id,
        v_application.target_opportunity_id
      ])
      and opportunity.deleted_at is null
      and opportunity.merged_into_opportunity_id is null
    order by opportunity.id
    for share;
    if (select count(*) from public.opportunities opportunity
      where opportunity.company_id = old.company_id
        and opportunity.id = any(array[
          v_application.source_opportunity_id,
          v_application.target_opportunity_id
        ])
        and opportunity.deleted_at is null
        and opportunity.merged_into_opportunity_id is null) <> 2
      or not private.user_can_edit_opportunity(
        old.actor_user_id, v_application.source_opportunity_id
      )
      or not private.user_can_edit_opportunity(
        old.actor_user_id, v_application.target_opportunity_id
      )
      or (old.action = 'create_target_and_reparent' and
        not public.authorize_email_exact_message_ingest_as_system(
          old.actor_user_id, old.company_id, old.connection_id
        ))
    then
      raise exception 'recovery_reparent_step_denied' using errcode = '42501';
    end if;

    select activity.* into strict v_activity
    from public.activities activity
    where activity.id = v_application.activity_id
      and activity.company_id = old.company_id
      and activity.opportunity_id = v_application.target_opportunity_id
      and activity.email_connection_id = old.connection_id
      and activity.email_thread_id = old.provider_thread_id
      and activity.email_message_id = old.provider_message_id
      and activity.type = 'email'
      and activity.direction = 'inbound'
    for share;
    select event.* into strict v_event
    from public.opportunity_correspondence_events event
    where event.id = v_application.correspondence_event_id
      and event.company_id = old.company_id
      and event.opportunity_id = v_application.target_opportunity_id
      and event.connection_id = old.connection_id
      and event.provider_thread_id = old.provider_thread_id
      and event.provider_message_id = old.provider_message_id
      and event.activity_id = v_application.activity_id
      and event.direction = 'inbound'
      and event.party_role = 'customer'
      and event.is_meaningful is true
      and event.opportunity_projection_applied is true
    for share;

    new.attachment_scan_generation :=
      v_application.attachment_scan_generation;
    v_target_opportunity_id := v_application.target_opportunity_id;
    v_summary_floor := v_application.applied_at;

    if v_application.status = 'complete' then
      select coalesce(
        array_agg(attachment.id order by attachment.id),
        '{}'::uuid[]
      )
      into v_attachment_ids
      from public.email_attachments attachment
      where attachment.company_id = old.company_id
        and attachment.connection_id = old.connection_id
        and attachment.provider_thread_id = old.provider_thread_id
        and attachment.message_id = old.provider_message_id
        and attachment.activity_id = v_application.activity_id;
      if v_attachment_ids is distinct from v_application.attachment_ids
        or cardinality(v_attachment_ids) is distinct from
          v_application.attachment_count
      then
        raise exception 'exact_recovery_attachment_set_changed'
          using errcode = '40001';
      end if;
    end if;

    if old.mutation_completed_at is not null then
      if old.activity_id is distinct from v_application.activity_id
        or old.source_opportunity_id is distinct from
          v_application.source_opportunity_id
        or old.target_opportunity_id is distinct from
          v_application.target_opportunity_id
        or old.correspondence_event_id is distinct from
          v_application.correspondence_event_id
        or old.attachment_scan_generation is distinct from
          v_application.attachment_scan_generation
      then
        raise exception 'exact_recovery_prior_application_proof_changed'
          using errcode = '40001';
      end if;
    end if;
  end if;

  if old.mutation_completed_at is null and new.mutation_completed_at is not null
  then
    if old.activity_id is not null and old.activity_id is distinct from new.activity_id
      or old.opportunity_id is not null and
        old.opportunity_id is distinct from new.opportunity_id
      or old.source_opportunity_id is not null and
        old.source_opportunity_id is distinct from new.source_opportunity_id
      or old.target_opportunity_id is not null and
        old.target_opportunity_id is distinct from new.target_opportunity_id
      or old.correspondence_event_id is not null and
        old.correspondence_event_id is distinct from new.correspondence_event_id
    then
      raise exception 'exact_recovery_registered_identity_changed'
        using errcode = '40001';
    end if;
    if new.state is distinct from (
      case
        when old.action = 'ingest' and old.draft_projection_required
          then 'draft_projection_pending'
        when old.action = 'ingest' then 'complete'
        else 'attachment_scan_pending'
      end
    ) then
      raise exception 'exact_recovery_mutation_state_invalid'
        using errcode = '23514';
    end if;
  elsif old.attachment_completed_at is null and
    new.attachment_completed_at is not null
  then
    if old.action = 'ingest'
      or old.mutation_completed_at is null
      or v_application.status <> 'complete'
      or private.exact_message_recovery_attachment_state(
        old.company_id,
        old.connection_id,
        old.provider_thread_id,
        old.provider_message_id,
        v_application.activity_id,
        v_application.target_opportunity_id,
        v_application.attachment_scan_generation
      ) <> 'complete'
      or new.state <> 'repair_pending'
    then
      raise exception 'exact_recovery_attachment_proof_missing'
        using errcode = '55000';
    end if;
    new.attachment_ids := v_attachment_ids;
  elsif old.repair_completed_at is null and new.repair_completed_at is not null
  then
    if old.action = 'ingest'
      or old.mutation_completed_at is null
      or old.attachment_completed_at is null
      or v_application.status <> 'complete'
      or private.exact_message_recovery_attachment_state(
        old.company_id,
        old.connection_id,
        old.provider_thread_id,
        old.provider_message_id,
        v_application.activity_id,
        v_application.target_opportunity_id,
        v_application.attachment_scan_generation
      ) <> 'complete'
      or new.state is distinct from (
        case
          when old.draft_projection_required then 'draft_projection_pending'
          else 'complete'
        end
      )
      or exists (
        select 1
        from public.opportunities opportunity
        where opportunity.company_id = old.company_id
          and opportunity.id = any(array[
            v_application.source_opportunity_id,
            v_application.target_opportunity_id
          ])
          and (
            nullif(btrim(opportunity.ai_summary), '') is null
            or opportunity.ai_summary_updated_at < v_summary_floor
          )
      )
    then
      raise exception 'exact_recovery_repair_proof_missing'
        using errcode = '55000';
    end if;
  elsif old.draft_projection_completed_at is null and
    new.draft_projection_completed_at is not null
  then
    if old.mutation_completed_at is null
      or not old.draft_projection_required
      or (old.repair_required and old.repair_completed_at is null)
      or new.state <> 'complete'
      or not exists (
        select 1
        from public.unanswered_lead_message_projections projection
        where projection.company_id = old.company_id
          and projection.opportunity_id = v_target_opportunity_id
          and projection.source_event_id = v_event.id
          and projection.source_activity_id = v_activity.id
          and projection.connection_id = old.connection_id
          and projection.provider_thread_id = old.provider_thread_id
          and projection.provider_message_id = old.provider_message_id
          and projection.manifest_sha256 = old.manifest_sha256
          and projection.entry_sha256 = old.entry_sha256
          and projection.projected_by = old.actor_user_id
      )
    then
      raise exception 'exact_recovery_draft_projection_proof_missing'
        using errcode = '55000';
    end if;
  else
    raise exception 'exact_recovery_transition_out_of_order'
      using errcode = '23514';
  end if;

  -- Ingest's canonical adapter and reparent repair both refresh the complete
  -- lead summary before their durable step can close.
  if (old.action = 'ingest' and old.mutation_completed_at is null)
    and not exists (
      select 1
      from public.opportunities opportunity
      where opportunity.id = v_target_opportunity_id
        and opportunity.company_id = old.company_id
        and nullif(btrim(opportunity.ai_summary), '') is not null
        and opportunity.ai_summary_updated_at >= v_summary_floor
    )
  then
    raise exception 'exact_recovery_ingest_summary_proof_missing'
      using errcode = '55000';
  end if;

  return new;
exception
  when no_data_found or too_many_rows then
    raise exception 'exact_recovery_canonical_proof_changed'
      using errcode = '40001';
end;
$function$;

revoke all on function private.prove_exact_message_recovery_work_transition()
  from public, anon, authenticated, service_role;

drop trigger if exists email_exact_message_recovery_work_prove_transition
  on private.email_exact_message_recovery_work;
create trigger email_exact_message_recovery_work_prove_transition
before update on private.email_exact_message_recovery_work
for each row execute function private.prove_exact_message_recovery_work_transition();

commit;
