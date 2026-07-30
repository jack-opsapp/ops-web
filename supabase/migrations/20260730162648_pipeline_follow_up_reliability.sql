-- Keep one safety-held commercial conversion from pinning an unrelated
-- mailbox, make meaningful manual outbounds consume the current chase cycle,
-- and recheck that cycle at the irreversible stock-send boundary.

begin;

alter table public.email_ingestion_recovery_queue
  add column opportunity_id uuid;

alter table public.email_ingestion_recovery_queue
  add constraint email_ingestion_recovery_opportunity_company_fkey
  foreign key (company_id, opportunity_id)
  references public.opportunities (company_id, id)
  on delete cascade;

alter table public.email_ingestion_recovery_queue
  drop constraint email_ingestion_recovery_kind_check,
  drop constraint email_ingestion_recovery_identity_check;

alter table public.email_ingestion_recovery_queue
  add constraint email_ingestion_recovery_kind_check
  check (
    recovery_kind in (
      'lead_classification',
      'provider_label_apply',
      'commercial_outcome'
    )
  ),
  add constraint email_ingestion_recovery_identity_check
  check (
    nullif(btrim(operation_key), '') is not null
    and nullif(btrim(provider_thread_id), '') is not null
    and nullif(btrim(provider_message_id), '') is not null
    and (
      (
        recovery_kind = 'lead_classification'
        and provider_label_id is null
        and opportunity_id is null
      )
      or (
        recovery_kind = 'provider_label_apply'
        and nullif(btrim(provider_label_id), '') is not null
        and opportunity_id is null
      )
      or (
        recovery_kind = 'commercial_outcome'
        and provider_label_id is null
        and opportunity_id is not null
      )
    )
  );

comment on column public.email_ingestion_recovery_queue.opportunity_id is
  'Exact lead fence for a safety-held commercial-outcome evaluation. Null for message classification and provider-label recovery.';

drop function public.enqueue_email_ingestion_recovery_as_system(
  uuid, uuid, text, text, text, text
);

create or replace function public.enqueue_email_ingestion_recovery_as_system(
  p_company_id uuid,
  p_connection_id uuid,
  p_recovery_kind text,
  p_provider_thread_id text,
  p_provider_message_id text,
  p_provider_label_id text default null,
  p_opportunity_id uuid default null
) returns public.email_ingestion_recovery_queue
language plpgsql
security definer
set search_path = ''
as $function$
declare
  connection public.email_connections%rowtype;
  v_operation_key text;
  work public.email_ingestion_recovery_queue%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_recovery_kind not in (
    'lead_classification',
    'provider_label_apply',
    'commercial_outcome'
  )
  or nullif(btrim(coalesce(p_provider_thread_id, '')), '') is null
  or nullif(btrim(coalesce(p_provider_message_id, '')), '') is null then
    raise exception 'invalid_email_ingestion_recovery_request'
      using errcode = '22023';
  end if;

  select source.* into connection
  from public.email_connections source
  where source.id = p_connection_id
    and source.company_id = p_company_id::text
  for share;
  if not found
     or connection.status <> 'active'
     or connection.sync_enabled <> true then
    raise exception 'email_ingestion_recovery_connection_invalid'
      using errcode = '42501';
  end if;

  if p_recovery_kind = 'lead_classification' then
    if nullif(btrim(coalesce(p_provider_label_id, '')), '') is not null
       or p_opportunity_id is not null then
      raise exception 'lead_classification_identity_invalid'
        using errcode = '22023';
    end if;
    v_operation_key :=
      'lead_classification:' || btrim(p_provider_message_id);
  elsif p_recovery_kind = 'provider_label_apply' then
    if nullif(btrim(coalesce(p_provider_label_id, '')), '') is null
       or p_opportunity_id is not null
       or connection.ops_label_id is null
       or connection.ops_label_id <> btrim(p_provider_label_id) then
      raise exception 'provider_label_configuration_invalid'
        using errcode = '42501';
    end if;
    v_operation_key :=
      'provider_label_apply:'
      || btrim(p_provider_message_id)
      || ':'
      || btrim(p_provider_label_id);
  else
    if p_opportunity_id is null
       or nullif(btrim(coalesce(p_provider_label_id, '')), '') is not null
       or not exists (
         select 1
         from public.opportunity_correspondence_events event
         join public.opportunity_email_threads thread
           on thread.opportunity_id = event.opportunity_id
          and thread.connection_id = event.connection_id
          and thread.thread_id = event.provider_thread_id
         where event.company_id = p_company_id
           and event.opportunity_id = p_opportunity_id
           and event.connection_id = p_connection_id
           and event.provider_thread_id = btrim(p_provider_thread_id)
           and event.provider_message_id = btrim(p_provider_message_id)
           and event.is_meaningful is true
           and event.noise_reason is null
           and event.opportunity_projection_applied is true
       ) then
      raise exception 'commercial_outcome_recovery_authorization_changed'
        using errcode = '42501';
    end if;
    v_operation_key :=
      'commercial_outcome:'
      || p_opportunity_id::text
      || ':'
      || btrim(p_provider_message_id);
  end if;

  insert into public.email_ingestion_recovery_queue (
    company_id,
    connection_id,
    recovery_kind,
    operation_key,
    provider_thread_id,
    provider_message_id,
    provider_label_id,
    opportunity_id
  ) values (
    p_company_id,
    p_connection_id,
    p_recovery_kind,
    v_operation_key,
    btrim(p_provider_thread_id),
    btrim(p_provider_message_id),
    case
      when p_recovery_kind = 'provider_label_apply'
        then btrim(p_provider_label_id)
      else null
    end,
    case
      when p_recovery_kind = 'commercial_outcome'
        then p_opportunity_id
      else null
    end
  )
  on conflict (connection_id, recovery_kind, operation_key) do update
    set updated_at = now()
  returning * into work;

  return work;
end;
$function$;

revoke all on function public.enqueue_email_ingestion_recovery_as_system(
  uuid, uuid, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.enqueue_email_ingestion_recovery_as_system(
  uuid, uuid, text, text, text, text, uuid
) to service_role;

create or replace function public.reauthorize_email_ingestion_recovery_as_system(
  p_queue_id uuid,
  p_holder text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  return exists (
    select 1
    from public.email_ingestion_recovery_queue work
    join public.email_connections connection
      on connection.id = work.connection_id
     and connection.company_id = work.company_id::text
     and connection.status = 'active'
     and connection.sync_enabled = true
    where work.id = p_queue_id
      and work.status = 'processing'
      and work.lease_holder = btrim(p_holder)
      and work.lease_expires_at > clock_timestamp()
      and (
        work.recovery_kind <> 'commercial_outcome'
        or exists (
          select 1
          from public.opportunities opportunity
          join public.opportunity_correspondence_events event
            on event.company_id = opportunity.company_id
           and event.opportunity_id = opportunity.id
          join public.opportunity_email_threads thread
            on thread.opportunity_id = opportunity.id
           and thread.connection_id = work.connection_id
           and thread.thread_id = work.provider_thread_id
          where opportunity.id = work.opportunity_id
            and opportunity.company_id = work.company_id
            and opportunity.deleted_at is null
            and event.connection_id = work.connection_id
            and event.provider_thread_id = work.provider_thread_id
            and event.provider_message_id = work.provider_message_id
            and event.is_meaningful is true
            and event.noise_reason is null
            and event.opportunity_projection_applied is true
        )
      )
  );
end;
$function$;

revoke all on function public.reauthorize_email_ingestion_recovery_as_system(
  uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.reauthorize_email_ingestion_recovery_as_system(
  uuid, text
) to service_role;

create or replace function public.complete_email_ingestion_recovery_as_system(
  p_queue_id uuid,
  p_holder text,
  p_outcome text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  work public.email_ingestion_recovery_queue%rowtype;
  v_status text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_outcome not in (
    'classification_recovered',
    'commercial_outcome_recovered',
    'label_applied',
    'stale_configuration'
  ) then
    raise exception 'invalid_email_ingestion_recovery_outcome'
      using errcode = '22023';
  end if;

  select queue.* into work
  from public.email_ingestion_recovery_queue queue
  where queue.id = p_queue_id
  for update;
  if not found then
    return false;
  end if;
  if work.status = 'completed' then
    return work.outcome = p_outcome;
  elsif work.status = 'stale' then
    return p_outcome = 'stale_configuration'
      and work.outcome = p_outcome;
  end if;
  if work.status <> 'processing'
     or work.lease_holder <> btrim(p_holder)
     or work.lease_expires_at <= clock_timestamp() then
    return false;
  end if;
  if (
       work.recovery_kind = 'lead_classification'
       and p_outcome <> 'classification_recovered'
     )
     or (
       work.recovery_kind = 'commercial_outcome'
       and p_outcome <> 'commercial_outcome_recovered'
     )
     or (
       work.recovery_kind = 'provider_label_apply'
       and p_outcome not in ('label_applied', 'stale_configuration')
     ) then
    raise exception 'email_ingestion_recovery_outcome_kind_mismatch'
      using errcode = '22023';
  end if;

  v_status := case
    when p_outcome = 'stale_configuration' then 'stale'
    else 'completed'
  end;
  update public.email_ingestion_recovery_queue queue
     set status = v_status,
         outcome = p_outcome,
         lease_holder = null,
         lease_expires_at = null,
         completed_at = now(),
         last_error = null,
         updated_at = now()
   where queue.id = p_queue_id;
  return true;
end;
$function$;

revoke all on function public.complete_email_ingestion_recovery_as_system(
  uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.complete_email_ingestion_recovery_as_system(
  uuid, text, text
) to service_role;

create table public.opportunity_manual_outbound_cycle_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  opportunity_id uuid not null,
  correspondence_event_id uuid not null unique,
  activity_id uuid not null,
  applied boolean not null,
  cycle_satisfied boolean not null,
  prior_due_at timestamptz,
  next_follow_up_at timestamptz,
  applied_at timestamptz not null default now(),
  foreign key (company_id, opportunity_id)
    references public.opportunities (company_id, id)
    on delete cascade,
  foreign key (company_id, correspondence_event_id)
    references public.opportunity_correspondence_events (company_id, id)
    on delete cascade,
  foreign key (company_id, activity_id)
    references public.activities (company_id, id)
    on delete cascade
);

create index opportunity_manual_outbound_cycle_receipts_opportunity_idx
  on public.opportunity_manual_outbound_cycle_receipts (
    company_id,
    opportunity_id,
    applied_at desc
  );

alter table public.opportunity_manual_outbound_cycle_receipts
  enable row level security;
revoke all on table public.opportunity_manual_outbound_cycle_receipts
  from public, anon, authenticated, service_role;
grant select, insert on table
  public.opportunity_manual_outbound_cycle_receipts
  to service_role;

comment on table public.opportunity_manual_outbound_cycle_receipts is
  'Service-only idempotency receipts proving whether an exact meaningful manual provider outbound consumed and advanced the current lead chase cycle.';

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
  on conflict (correspondence_event_id) do nothing
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

create or replace function private.guard_template_follow_up_cycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  opportunity public.opportunities%rowtype;
  draft public.opportunity_follow_up_drafts%rowtype;
  source_event public.opportunity_correspondence_events%rowtype;
begin
  if not (
    old.status = 'prepared'
    and new.status = 'sending'
    and new.follow_up_draft_id is not null
  ) then
    return new;
  end if;

  select candidate.* into draft
  from public.opportunity_follow_up_drafts candidate
  where candidate.id = new.follow_up_draft_id
    and candidate.company_id = new.company_id
    and candidate.opportunity_id = new.opportunity_id
  for share;
  if not found or draft.origin <> 'template_follow_up' then
    return new;
  end if;

  select candidate.* into opportunity
  from public.opportunities candidate
  where candidate.id = new.opportunity_id
    and candidate.company_id = new.company_id
  for share;
  if not found then
    raise exception 'LEAD_FOLLOW_UP_CYCLE_ALREADY_SATISFIED';
  end if;

  select event.* into source_event
  from public.opportunity_correspondence_events event
  where event.id = draft.source_event_id
    and event.company_id = new.company_id
    and event.opportunity_id = new.opportunity_id
  for share;
  if not found
     or opportunity.next_follow_up_at is null
     or opportunity.stage_entered_at is null
     or opportunity.next_follow_up_at < opportunity.stage_entered_at
     or opportunity.last_outbound_at is null
     or opportunity.last_outbound_at >= opportunity.next_follow_up_at
     or source_event.occurred_at >= opportunity.next_follow_up_at then
    raise exception 'LEAD_FOLLOW_UP_CYCLE_ALREADY_SATISFIED';
  end if;
  return new;
end;
$function$;

drop trigger if exists guard_template_follow_up_cycle
  on public.email_send_intents;
create trigger guard_template_follow_up_cycle
before update on public.email_send_intents
for each row
execute function private.guard_template_follow_up_cycle();

alter table public.email_ingestion_recovery_queue enable row level security;

commit;
