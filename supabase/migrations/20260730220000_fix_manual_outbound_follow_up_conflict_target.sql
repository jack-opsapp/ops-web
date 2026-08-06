-- Fix the deployed manual-outbound receipt insert. The RPC returns a column
-- named correspondence_event_id, so PL/pgSQL treats a bare
-- ON CONFLICT (correspondence_event_id) target as ambiguous at runtime.
-- Target the verified unique constraint explicitly without changing any
-- lifecycle, authorization, or idempotency behavior.

create or replace function public.reconcile_manual_outbound_follow_up_cycle_as_system(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_correspondence_event_id uuid
)
returns table (
  correspondence_event_id uuid,
  opportunity_id uuid,
  applied boolean,
  cycle_satisfied boolean,
  prior_due_at timestamptz,
  next_follow_up_at timestamptz,
  applied_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  opportunity public.opportunities%rowtype;
  event public.opportunity_correspondence_events%rowtype;
  activity public.activities%rowtype;
  receipt public.opportunity_manual_outbound_cycle_receipts%rowtype;
  v_company_timezone text;
  v_follow_up_days integer;
  v_requested_next timestamptz;
  v_next timestamptz;
  v_applies boolean := false;
  v_cycle_satisfied boolean := false;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_company_id is null
     or p_opportunity_id is null
     or p_correspondence_event_id is null then
    raise exception 'manual_outbound_follow_up_identity_invalid'
      using errcode = '22023';
  end if;

  select existing.* into receipt
  from public.opportunity_manual_outbound_cycle_receipts existing
  where existing.correspondence_event_id = p_correspondence_event_id;
  if found then
    if receipt.company_id <> p_company_id
       or receipt.opportunity_id <> p_opportunity_id then
      raise exception 'manual_outbound_follow_up_receipt_conflict'
        using errcode = '23505';
    end if;
    correspondence_event_id := receipt.correspondence_event_id;
    opportunity_id := receipt.opportunity_id;
    applied := receipt.applied;
    cycle_satisfied := receipt.cycle_satisfied;
    prior_due_at := receipt.prior_due_at;
    next_follow_up_at := receipt.next_follow_up_at;
    applied_at := receipt.applied_at;
    return next;
    return;
  end if;

  perform private.lock_lead_assignment_company(p_company_id);

  -- The company fence serializes duplicate delivery of this same event.
  -- Re-read the receipt after acquiring it so two concurrent callers cannot
  -- both apply lifecycle counters before the unique insert settles.
  select existing.* into receipt
  from public.opportunity_manual_outbound_cycle_receipts existing
  where existing.correspondence_event_id = p_correspondence_event_id;
  if found then
    if receipt.company_id <> p_company_id
       or receipt.opportunity_id <> p_opportunity_id then
      raise exception 'manual_outbound_follow_up_receipt_conflict'
        using errcode = '23505';
    end if;
    correspondence_event_id := receipt.correspondence_event_id;
    opportunity_id := receipt.opportunity_id;
    applied := receipt.applied;
    cycle_satisfied := receipt.cycle_satisfied;
    prior_due_at := receipt.prior_due_at;
    next_follow_up_at := receipt.next_follow_up_at;
    applied_at := receipt.applied_at;
    return next;
    return;
  end if;

  select candidate.* into opportunity
  from public.opportunities candidate
  where candidate.id = p_opportunity_id
    and candidate.company_id = p_company_id
  for update;
  if not found then
    raise exception 'manual_outbound_follow_up_opportunity_invalid'
      using errcode = '55000';
  end if;

  select candidate.* into event
  from public.opportunity_correspondence_events candidate
  where candidate.id = p_correspondence_event_id
    and candidate.company_id = p_company_id
    and candidate.opportunity_id = p_opportunity_id
    and candidate.source = 'sync_activity'
    and candidate.direction = 'outbound'
    and candidate.party_role = 'ops'
    and candidate.is_meaningful = true
    and candidate.noise_reason is null
    and candidate.opportunity_projection_applied = true
    and candidate.activity_id is not null
    and candidate.connection_id is not null
    and candidate.provider_thread_id is not null
    and candidate.provider_message_id is not null
  for share;
  if not found then
    raise exception 'manual_outbound_follow_up_event_invalid'
      using errcode = '55000';
  end if;

  select candidate.* into activity
  from public.activities candidate
  where candidate.id = event.activity_id
    and candidate.company_id = p_company_id
    and candidate.opportunity_id = p_opportunity_id
    and candidate.email_connection_id = event.connection_id
    and candidate.email_thread_id = event.provider_thread_id
    and candidate.email_message_id = event.provider_message_id
    and candidate.type = 'email'
    and candidate.direction = 'outbound'
  for share;
  if not found
     or not exists (
       select 1
       from public.opportunity_email_threads thread
       where thread.opportunity_id = opportunity.id
         and thread.connection_id = event.connection_id
         and thread.thread_id = event.provider_thread_id
     ) then
    raise exception 'manual_outbound_follow_up_binding_invalid'
      using errcode = '55000';
  end if;

  select timezone.name
    into v_company_timezone
  from public.companies company
  join pg_catalog.pg_timezone_names timezone
    on timezone.name = company.timezone
  where company.id = p_company_id;
  if not found then
    raise exception 'manual_outbound_follow_up_timezone_invalid'
      using errcode = '55000';
  end if;

  select coalesce(settings.follow_up_after_days, 7)
    into v_follow_up_days
  from public.lead_lifecycle_settings settings
  where settings.company_id = p_company_id;
  v_follow_up_days := coalesce(v_follow_up_days, 7);
  v_requested_next :=
    event.occurred_at + make_interval(days => v_follow_up_days);

  -- Only the unique newest meaningful truth can own chase state. Ties are
  -- ambiguous and therefore leave the lead unchanged.
  v_applies :=
    opportunity.deleted_at is null
    and opportunity.archived_at is null
    and opportunity.merged_into_opportunity_id is null
    and opportunity.project_id is null
    and opportunity.project_ref is null
    and opportunity.stage in ('quoted', 'follow_up', 'negotiation')
    and opportunity.last_outbound_at = event.occurred_at
    and not exists (
      select 1
      from public.opportunity_correspondence_events later
      where later.company_id = p_company_id
        and later.opportunity_id = p_opportunity_id
        and later.id <> event.id
        and later.is_meaningful is true
        and later.noise_reason is null
        and later.occurred_at >= event.occurred_at
    );

  v_cycle_satisfied :=
    v_applies
    and opportunity.next_follow_up_at is not null
    and opportunity.stage_entered_at is not null
    and opportunity.next_follow_up_at >= opportunity.stage_entered_at
    and event.occurred_at >= opportunity.next_follow_up_at;

  if v_applies then
    v_next := case
      when opportunity.next_follow_up_at is not null
       and (
         opportunity.next_follow_up_at at time zone v_company_timezone
       )::date > (
         event.occurred_at at time zone v_company_timezone
       )::date
        then least(opportunity.next_follow_up_at, v_requested_next)
      else v_requested_next
    end;

    update public.opportunities target
       set handled_at = event.occurred_at,
           next_follow_up_at = v_next,
           updated_at = now()
     where target.id = p_opportunity_id
       and target.company_id = p_company_id;

    insert into public.opportunity_lifecycle_state (
      opportunity_id,
      company_id,
      unanswered_follow_up_count,
      last_meaningful_event_id,
      last_meaningful_at,
      last_meaningful_direction,
      updated_at
    ) values (
      p_opportunity_id,
      p_company_id,
      case when v_cycle_satisfied then 1 else 0 end,
      event.id,
      event.occurred_at,
      'outbound',
      now()
    )
    on conflict (opportunity_id) do update
      set unanswered_follow_up_count =
            public.opportunity_lifecycle_state.unanswered_follow_up_count
            + case when v_cycle_satisfied then 1 else 0 end,
          last_meaningful_event_id = event.id,
          last_meaningful_at = event.occurred_at,
          last_meaningful_direction = 'outbound',
          operator_follow_up_miss_at = null,
          stale_status = case
            when public.opportunity_lifecycle_state.stale_status in (
              'operator_follow_up_miss',
              'follow_up_draft_due'
            ) then null
            else public.opportunity_lifecycle_state.stale_status
          end,
          stale_status_at = case
            when public.opportunity_lifecycle_state.stale_status in (
              'operator_follow_up_miss',
              'follow_up_draft_due'
            ) then null
            else public.opportunity_lifecycle_state.stale_status_at
          end,
          updated_at = now();

    update public.opportunity_follow_up_drafts draft
       set status = 'superseded',
           superseded_at = event.occurred_at,
           updated_at = now()
     where draft.company_id = p_company_id
       and draft.opportunity_id = p_opportunity_id
       and draft.origin = 'template_follow_up'
       and draft.status = 'drafted';

    update public.notifications notification
       set is_read = true,
           resolved_at = coalesce(notification.resolved_at, event.occurred_at),
           resolved_by = coalesce(
             notification.resolved_by,
             activity.created_by
           ),
           resolution_reason = coalesce(
             notification.resolution_reason,
             'manual_follow_up_sent'
           )
     where notification.company_id = p_company_id::text
       and notification.type = 'leads_waiting'
       and notification.dedupe_key =
         'lead_lifecycle:operator_follow_up_miss:'
         || p_opportunity_id::text
       and notification.resolved_at is null;
  else
    v_next := opportunity.next_follow_up_at;
  end if;

  insert into public.opportunity_manual_outbound_cycle_receipts (
    company_id,
    opportunity_id,
    correspondence_event_id,
    activity_id,
    applied,
    cycle_satisfied,
    prior_due_at,
    next_follow_up_at
  ) values (
    p_company_id,
    p_opportunity_id,
    event.id,
    activity.id,
    v_applies,
    v_cycle_satisfied,
    opportunity.next_follow_up_at,
    v_next
  )
  on conflict on constraint opportunity_manual_outbound_cycle_r_correspondence_event_id_key do nothing
  returning * into receipt;
  if not found then
    select existing.* into receipt
    from public.opportunity_manual_outbound_cycle_receipts existing
    where existing.correspondence_event_id = event.id;
  end if;
  if not found
     or receipt.company_id <> p_company_id
     or receipt.opportunity_id <> p_opportunity_id then
    raise exception 'manual_outbound_follow_up_receipt_conflict'
      using errcode = '40001';
  end if;

  correspondence_event_id := receipt.correspondence_event_id;
  opportunity_id := receipt.opportunity_id;
  applied := receipt.applied;
  cycle_satisfied := receipt.cycle_satisfied;
  prior_due_at := receipt.prior_due_at;
  next_follow_up_at := receipt.next_follow_up_at;
  applied_at := receipt.applied_at;
  return next;
end;
$function$;

revoke all on function
  public.reconcile_manual_outbound_follow_up_cycle_as_system(
    uuid, uuid, uuid
  )
  from public, anon, authenticated, service_role;
grant execute on function
  public.reconcile_manual_outbound_follow_up_cycle_as_system(
    uuid, uuid, uuid
  )
  to service_role;
