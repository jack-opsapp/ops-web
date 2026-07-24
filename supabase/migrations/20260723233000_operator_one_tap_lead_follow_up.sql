-- Make an operator's one-tap template follow-up a provider-confirmed,
-- replay-safe lead transition. Provider delivery remains owned by the durable
-- email-send intent; this migration atomically applies the local lifecycle
-- outcome and closes the last prepared-to-sending stale-conversation gap.

begin;

alter table public.email_send_intents
  add column if not exists follow_up_outcome_applied_at timestamptz,
  add column if not exists follow_up_comeback_at timestamptz,
  add column if not exists follow_up_notification_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.email_send_intents'::regclass
       and conname = 'email_send_intents_follow_up_notification_fkey'
  ) then
    alter table public.email_send_intents
      add constraint email_send_intents_follow_up_notification_fkey
      foreign key (follow_up_notification_id)
      references public.notifications (id)
      on delete restrict;
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.email_send_intents'::regclass
       and conname = 'email_send_intents_follow_up_outcome_receipt_check'
  ) then
    alter table public.email_send_intents
      add constraint email_send_intents_follow_up_outcome_receipt_check
      check (
        (
          follow_up_outcome_applied_at is null
          and follow_up_comeback_at is null
          and follow_up_notification_id is null
        )
        or
        (
          follow_up_outcome_applied_at is not null
          and follow_up_notification_id is not null
          and follow_up_draft_id is not null
        )
      );
  end if;
end;
$$;

comment on column public.email_send_intents.follow_up_outcome_applied_at is
  'Immutable receipt timestamp for the provider-confirmed template follow-up lifecycle transition.';
comment on column public.email_send_intents.follow_up_comeback_at is
  'Effective lead comeback when this send remained the newest lifecycle event; null when newer lead truth won.';
comment on column public.email_send_intents.follow_up_notification_id is
  'Permanent rail-notification receipt for the provider-confirmed template follow-up transition.';

alter table public.lead_lifecycle_settings
  alter column follow_up_template_body set default
    'Hi {{first_name}}, just checking in to see if you had any questions about the quote. No pressure — I wanted to make sure you had everything you needed.';

update public.lead_lifecycle_settings
   set follow_up_template_body =
         'Hi {{first_name}}, just checking in to see if you had any questions about the quote. No pressure — I wanted to make sure you had everything you needed.',
       updated_at = now()
 where follow_up_template_body =
         'Hey there {{first_name}}, just following up on this as I didn''t see anything back from you.';

create unique index if not exists notifications_lead_follow_up_sent_dedupe_idx
  on public.notifications (dedupe_key)
  where dedupe_key like 'lead-follow-up-sent:%';

create index if not exists email_send_intents_follow_up_notification_idx
  on public.email_send_intents (follow_up_notification_id)
  where follow_up_notification_id is not null;

create or replace function public.reconcile_operator_template_follow_up_send_as_system(
  p_intent_id uuid
)
returns table (
  intent_id uuid,
  opportunity_id uuid,
  applied_at timestamptz,
  comeback_at timestamptz,
  notification_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity record;
  v_opportunity public.opportunities%rowtype;
  v_intent public.email_send_intents%rowtype;
  v_draft public.opportunity_follow_up_drafts%rowtype;
  v_state public.opportunity_lifecycle_state%rowtype;
  v_applied_at timestamptz;
  v_requested_comeback_at timestamptz;
  v_comeback_at timestamptz;
  v_notification_id uuid;
  v_notification_dedupe_key text;
  v_next_unanswered_count integer;
  v_lifecycle_is_current boolean;
  v_company_timezone text;
  v_updated integer;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'EMAIL_SEND_ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_intent_id is null then
    raise exception 'EMAIL_SEND_TEMPLATE_FOLLOW_UP_INTENT_INVALID'
      using errcode = '22023';
  end if;

  -- Identity is immutable. Read it without a child lock only to discover the
  -- canonical parent fence, then take every write lock in company -> lead ->
  -- intent -> draft -> lifecycle order.
  select candidate.company_id, candidate.opportunity_id
    into v_identity
    from public.email_send_intents candidate
   where candidate.id = p_intent_id;
  if not found then
    raise exception 'EMAIL_SEND_TEMPLATE_FOLLOW_UP_INTENT_INVALID'
      using errcode = '22023';
  end if;

  perform private.lock_lead_assignment_company(v_identity.company_id);

  select timezone.name
    into v_company_timezone
    from public.companies company
    join pg_catalog.pg_timezone_names timezone
      on timezone.name = company.timezone
   where company.id = v_identity.company_id;
  if not found then
    raise exception 'EMAIL_SEND_TEMPLATE_FOLLOW_UP_COMPANY_INVALID'
      using errcode = '55000';
  end if;

  select candidate.*
    into v_opportunity
    from public.opportunities candidate
   where candidate.id = v_identity.opportunity_id
     and candidate.company_id = v_identity.company_id
   for update;
  if not found then
    raise exception 'EMAIL_SEND_TEMPLATE_FOLLOW_UP_OPPORTUNITY_INVALID'
      using errcode = '55000';
  end if;

  select candidate.*
    into v_intent
    from public.email_send_intents candidate
   where candidate.id = p_intent_id
     and candidate.company_id = v_identity.company_id
     and candidate.opportunity_id = v_identity.opportunity_id
   for update;
  if not found
     or v_intent.status not in (
       'provider_accepted',
       'reconciling',
       'reconciled'
     )
     or v_intent.provider_accepted_at is null
     or nullif(btrim(v_intent.provider_message_id), '') is null
     or nullif(btrim(v_intent.accepted_provider_thread_id), '') is null
     or v_intent.follow_up_draft_id is null
  then
    raise exception 'EMAIL_SEND_TEMPLATE_FOLLOW_UP_NOT_ACCEPTED'
      using errcode = '55000';
  end if;

  select candidate.*
    into v_draft
    from public.opportunity_follow_up_drafts candidate
   where candidate.id = v_intent.follow_up_draft_id
     and candidate.company_id = v_intent.company_id
     and candidate.opportunity_id = v_intent.opportunity_id
   for update;
  if not found
     or v_draft.origin is distinct from 'template_follow_up'
     or v_draft.connection_id is distinct from v_intent.connection_id
     or v_draft.provider_thread_id is distinct from
       v_intent.accepted_provider_thread_id
     or v_intent.reply_provider_thread_id is distinct from
       v_intent.accepted_provider_thread_id
     or nullif(btrim(v_draft.recipient_email), '') is null
     or cardinality(v_intent.to_emails) <> 1
     or lower(btrim(v_intent.to_emails[1])) is distinct from
       lower(btrim(v_draft.recipient_email))
  then
    raise exception 'EMAIL_SEND_TEMPLATE_FOLLOW_UP_BINDING_INVALID'
      using errcode = '55000';
  end if;

  -- The receipt is written in this same transaction as every downstream row.
  -- Once present, it is the complete replay result; no counter, notification,
  -- draft, or opportunity field can be applied twice.
  if v_intent.follow_up_outcome_applied_at is not null then
    if v_intent.follow_up_notification_id is null
       or v_draft.status is distinct from 'sent'
    then
      raise exception 'EMAIL_SEND_TEMPLATE_FOLLOW_UP_RECEIPT_INVALID'
        using errcode = '55000';
    end if;

    intent_id := v_intent.id;
    opportunity_id := v_intent.opportunity_id;
    applied_at := v_intent.follow_up_outcome_applied_at;
    comeback_at := v_intent.follow_up_comeback_at;
    notification_id := v_intent.follow_up_notification_id;
    return next;
    return;
  end if;

  if v_intent.follow_up_comeback_at is not null
     or v_intent.follow_up_notification_id is not null
  then
    raise exception 'EMAIL_SEND_TEMPLATE_FOLLOW_UP_RECEIPT_INVALID'
      using errcode = '55000';
  end if;

  v_applied_at := now();
  v_requested_comeback_at :=
    v_intent.provider_accepted_at + interval '3 days';

  update public.opportunity_follow_up_drafts draft
     set status = 'sent',
         final_sent_body = v_intent.authored_body,
         sent_at = v_intent.provider_accepted_at,
         discarded_at = null,
         superseded_at = null,
         updated_at = v_applied_at
   where draft.id = v_draft.id
     and draft.company_id = v_intent.company_id
     and draft.opportunity_id = v_intent.opportunity_id
     and draft.origin = 'template_follow_up'
     and draft.status <> 'sent';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'EMAIL_SEND_TEMPLATE_FOLLOW_UP_DRAFT_CONFLICT'
      using errcode = '40001';
  end if;

  insert into public.opportunity_lifecycle_state (
    opportunity_id,
    company_id,
    unanswered_follow_up_count,
    updated_at
  ) values (
    v_intent.opportunity_id,
    v_intent.company_id,
    0,
    v_applied_at
  )
  on conflict (opportunity_id) do nothing;

  select state.*
    into v_state
    from public.opportunity_lifecycle_state state
   where state.opportunity_id = v_intent.opportunity_id
     and state.company_id = v_intent.company_id
   for update;
  if not found then
    raise exception 'EMAIL_SEND_TEMPLATE_FOLLOW_UP_LIFECYCLE_INVALID'
      using errcode = '55000';
  end if;

  -- Reconciliation normally follows the exact outbound correspondence
  -- projection. If a later meaningful event already won the race, preserve
  -- that newer lifecycle truth instead of resurrecting an unanswered state.
  v_lifecycle_is_current :=
    (
      v_state.last_meaningful_at is null
      or v_state.last_meaningful_at <= v_intent.provider_accepted_at
    )
    and not exists (
      -- The lifecycle projection is repairable and can briefly lag or lose a
      -- check-then-write race. Durable correspondence is the final authority:
      -- any other meaningful event at the same instant is ambiguous, and any
      -- later event owns the lead regardless of mailbox or provider thread.
      select 1
        from public.opportunity_correspondence_events durable_truth
       where durable_truth.company_id = v_intent.company_id
         and durable_truth.opportunity_id = v_intent.opportunity_id
         and durable_truth.is_meaningful is true
         and durable_truth.noise_reason is null
         and durable_truth.occurred_at >= v_intent.provider_accepted_at
         and (
           durable_truth.provider_message_id is distinct from
             v_intent.provider_message_id
           or durable_truth.connection_id is distinct from
             v_intent.connection_id
           or durable_truth.direction is distinct from 'outbound'
         )
    );
  if v_lifecycle_is_current then
    v_next_unanswered_count := v_state.unanswered_follow_up_count + 1;
    update public.opportunity_lifecycle_state state
       set unanswered_follow_up_count = v_next_unanswered_count,
           second_follow_up_sent_at = case
             when v_next_unanswered_count >= 2
               then coalesce(
                 state.second_follow_up_sent_at,
                 v_intent.provider_accepted_at
               )
             else state.second_follow_up_sent_at
           end,
           operator_follow_up_miss_at = null,
           stale_status = case
             when state.stale_status in (
               'operator_follow_up_miss',
               'follow_up_draft_due'
             ) then null
             else state.stale_status
           end,
           stale_status_at = case
             when state.stale_status in (
               'operator_follow_up_miss',
               'follow_up_draft_due'
             ) then null
             else state.stale_status_at
           end,
           updated_at = v_applied_at
     where state.opportunity_id = v_intent.opportunity_id
       and state.company_id = v_intent.company_id;
  end if;

  if v_lifecycle_is_current then
    -- Clear the actionable "operator owes the reply" notification only while
    -- this accepted send is still the newest meaningful lifecycle fact.
    update public.notifications notification
       set is_read = true,
           resolved_at = coalesce(
             notification.resolved_at,
             v_intent.provider_accepted_at
           ),
           resolved_by = coalesce(
             notification.resolved_by,
             v_intent.actor_user_id
           ),
           resolution_reason = coalesce(
             notification.resolution_reason,
             'follow_up_sent'
           )
     where notification.company_id = v_intent.company_id::text
       and notification.type = 'leads_waiting'
       and notification.dedupe_key =
         'lead_lifecycle:operator_follow_up_miss:'
         || v_intent.opportunity_id::text
       and notification.resolved_at is null;
  end if;

  -- Do not let a slow reconciliation overwrite a later operator action or a
  -- terminal/project transition. A still-current lead keeps any explicitly
  -- chosen sooner future check-in; otherwise this send owns +3 days.
  if v_lifecycle_is_current
     and v_opportunity.deleted_at is null
     and v_opportunity.archived_at is null
     and v_opportunity.merged_into_opportunity_id is null
     and v_opportunity.project_id is null
     and v_opportunity.project_ref is null
     and v_opportunity.stage in (
       'quoted',
       'follow_up',
       'negotiation'
     )
     and (
       v_opportunity.handled_at is null
       or v_opportunity.handled_at <= v_intent.provider_accepted_at
     )
  then
    v_comeback_at := case
      when (
        v_opportunity.next_follow_up_at
          at time zone v_company_timezone
      )::date > (
        v_intent.provider_accepted_at
          at time zone v_company_timezone
      )::date
        then least(
          v_opportunity.next_follow_up_at,
          v_requested_comeback_at
        )
      else v_requested_comeback_at
    end;

    update public.opportunities opportunity
       set handled_at = v_intent.provider_accepted_at,
           next_follow_up_at = v_comeback_at,
           updated_at = v_applied_at
     where opportunity.id = v_intent.opportunity_id
       and opportunity.company_id = v_intent.company_id;
  else
    -- Provider delivery is still recorded, but this send did not own the
    -- current chase state. A null comeback receipt prevents clients from
    -- claiming that a newer inbound/terminal state was rescheduled.
    v_comeback_at := null;
  end if;

  v_notification_dedupe_key :=
    'lead-follow-up-sent:' || v_intent.id::text;

  insert into public.notifications (
    user_id,
    company_id,
    type,
    title,
    body,
    is_read,
    persistent,
    action_url,
    action_label,
    deep_link_type,
    dedupe_key,
    created_at
  ) values (
    v_intent.actor_user_id::text,
    v_intent.company_id::text,
    'lead_follow_up_sent',
    'Follow-up sent',
    left(
      case
        when v_comeback_at is not null then
          'Next check-in scheduled for '
          || coalesce(nullif(btrim(v_opportunity.title), ''), 'this lead')
          || '.'
        else
          'Delivered to '
          || coalesce(nullif(btrim(v_opportunity.title), ''), 'this lead')
          || '. Newer lead activity was kept.'
      end,
      140
    ),
    false,
    false,
    '/pipeline?opportunityId=' || v_intent.opportunity_id::text,
    'VIEW LEAD',
    'lead',
    v_notification_dedupe_key,
    v_intent.provider_accepted_at
  )
  on conflict do nothing
  returning id into v_notification_id;

  if v_notification_id is null then
    select notification.id
      into v_notification_id
      from public.notifications notification
     where notification.dedupe_key = v_notification_dedupe_key
       and notification.user_id = v_intent.actor_user_id::text
       and notification.company_id = v_intent.company_id::text
       and notification.type = 'lead_follow_up_sent';
  end if;
  if v_notification_id is null then
    raise exception 'EMAIL_SEND_TEMPLATE_FOLLOW_UP_NOTIFICATION_FAILED'
      using errcode = '55000';
  end if;

  update public.email_send_intents intent
     set follow_up_outcome_applied_at = v_applied_at,
         follow_up_comeback_at = v_comeback_at,
         follow_up_notification_id = v_notification_id,
         updated_at = greatest(intent.updated_at, v_applied_at)
   where intent.id = v_intent.id
     and intent.company_id = v_intent.company_id
     and intent.opportunity_id = v_intent.opportunity_id
     and intent.follow_up_outcome_applied_at is null;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'EMAIL_SEND_TEMPLATE_FOLLOW_UP_RECEIPT_CONFLICT'
      using errcode = '40001';
  end if;

  intent_id := v_intent.id;
  opportunity_id := v_intent.opportunity_id;
  applied_at := v_applied_at;
  comeback_at := v_comeback_at;
  notification_id := v_notification_id;
  return next;
end;
$$;

revoke all on function public.reconcile_operator_template_follow_up_send_as_system(
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.reconcile_operator_template_follow_up_send_as_system(
  uuid
) to service_role;

create or replace function private.guard_system_handoff_email_send_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  opportunity public.opportunities%rowtype;
  draft public.opportunity_follow_up_drafts%rowtype;
  source_event public.opportunity_correspondence_events%rowtype;
  source_thread public.email_threads%rowtype;
  v_company_timezone text;
begin
  if not (
       old.status = 'prepared'
       and new.status = 'sending'
     ) then
    return new;
  end if;

  -- Ordinary sends remain on the canonical path. A row carrying only half of
  -- the handoff provenance is never ordinary and must fail closed.
  if new.follow_up_draft_id is null then
    if new.follow_up_source_event_id is not null
       or new.follow_up_recipient_email is not null then
      raise exception 'EMAIL_SEND_SYSTEM_HANDOFF_AUTHORIZATION_STALE';
    end if;
    return new;
  end if;

  -- The public claim wrapper already owns this parent FOR UPDATE. Re-reading
  -- it FOR SHARE proves the final commercial state while preserving the
  -- canonical parent-before-child lock order.
  select candidate.*
    into opportunity
    from public.opportunities candidate
   where candidate.id = new.opportunity_id
     and candidate.company_id = new.company_id
   for share;
  if not found then
    raise exception 'EMAIL_SEND_SYSTEM_HANDOFF_AUTHORIZATION_STALE';
  end if;

  select candidate.*
    into draft
    from public.opportunity_follow_up_drafts candidate
   where candidate.id = new.follow_up_draft_id
     and candidate.company_id = new.company_id
     and candidate.opportunity_id = new.opportunity_id
     and candidate.connection_id = new.connection_id
   for share;
  if not found then
    if new.follow_up_source_event_id is not null
       or new.follow_up_recipient_email is not null then
      raise exception 'EMAIL_SEND_SYSTEM_HANDOFF_AUTHORIZATION_STALE';
    end if;
    return new;
  end if;

  -- A template follow-up is authorized only at the irreversible provider
  -- claim boundary. The app preflight improves UX, but this trigger is the
  -- final authority over lead due state and conversation freshness.
  if draft.origin = 'template_follow_up' then
    select timezone.name
      into v_company_timezone
      from public.companies company
      join pg_catalog.pg_timezone_names timezone
        on timezone.name = company.timezone
     where company.id = new.company_id;
    if not found then
      raise exception 'EMAIL_SEND_TEMPLATE_FOLLOW_UP_AUTHORIZATION_STALE';
    end if;

    if new.follow_up_source_event_id is not null
       or new.follow_up_recipient_email is not null
       or opportunity.deleted_at is not null
       or opportunity.archived_at is not null
       or opportunity.merged_into_opportunity_id is not null
       or opportunity.project_id is not null
       or opportunity.project_ref is not null
       or opportunity.stage not in (
         'quoted',
         'follow_up',
         'negotiation'
       )
       or opportunity.next_follow_up_at is null
       or (
         opportunity.next_follow_up_at
           at time zone v_company_timezone
       )::date > (
         now() at time zone v_company_timezone
       )::date
       or draft.status <> 'drafted'
       or new.initiated_by <> 'operator'
       or new.sender_switched
       or draft.provider_thread_id is null
       or draft.source_event_id is null
       or nullif(btrim(draft.recipient_email), '') is null
       or new.source_email_thread_id is null
       or new.reply_provider_thread_id is distinct from draft.provider_thread_id
       or cardinality(new.to_emails) <> 1
       or lower(btrim(new.to_emails[1])) is distinct from
         lower(btrim(draft.recipient_email))
       or coalesce(cardinality(new.cc_emails), 0) <> 0
       or new.subject is distinct from draft.subject
       or new.authored_body is distinct from
         coalesce(draft.current_body, draft.original_body)
    then
      raise exception 'EMAIL_SEND_TEMPLATE_FOLLOW_UP_AUTHORIZATION_STALE';
    end if;

    select event.*
      into source_event
      from public.opportunity_correspondence_events event
     where event.id = draft.source_event_id
       and event.company_id = new.company_id
       and event.opportunity_id = new.opportunity_id
       and event.connection_id = new.connection_id
       and event.provider_thread_id = draft.provider_thread_id
       and event.direction = 'outbound'
       and event.party_role = 'ops'
       and event.is_meaningful is true
       and event.noise_reason is null
       and event.provider_message_id is not null
       and event.activity_id is not null
       and event.opportunity_projection_applied is true
     for share;
    if not found
       or new.in_reply_to is distinct from source_event.provider_message_id
    then
      raise exception 'EMAIL_SEND_TEMPLATE_FOLLOW_UP_AUTHORIZATION_STALE';
    end if;

    select thread.*
      into source_thread
      from public.email_threads thread
     where thread.id = new.source_email_thread_id
       and thread.company_id = new.company_id
       and thread.connection_id = new.connection_id
       and thread.provider_thread_id = draft.provider_thread_id
       and thread.opportunity_id = new.opportunity_id
     for share;
    if not found then
      raise exception 'EMAIL_SEND_TEMPLATE_FOLLOW_UP_AUTHORIZATION_STALE';
    end if;

    -- Ties are ambiguous and therefore stale: UUID ordering cannot prove
    -- provider order for two events stamped at the same instant.
    if exists (
      select 1
        from public.opportunity_correspondence_events newer_outbound
       where newer_outbound.company_id = new.company_id
         and newer_outbound.opportunity_id = new.opportunity_id
         and newer_outbound.direction = 'outbound'
         and newer_outbound.party_role = 'ops'
         and newer_outbound.is_meaningful is true
         and newer_outbound.noise_reason is null
         and newer_outbound.id <> source_event.id
         and newer_outbound.occurred_at >= source_event.occurred_at
    ) or exists (
      select 1
        from public.opportunity_correspondence_events later_inbound
       where later_inbound.company_id = new.company_id
         and later_inbound.opportunity_id = new.opportunity_id
         and later_inbound.direction = 'inbound'
         and later_inbound.party_role = 'customer'
         and later_inbound.is_meaningful is true
         and later_inbound.noise_reason is null
         and later_inbound.occurred_at >= source_event.occurred_at
    ) or exists (
      -- A thread change cannot open a second provider boundary while any
      -- template follow-up for this lead still has an unresolved delivery.
      select 1
        from public.email_send_intents unresolved_intent
        join public.opportunity_follow_up_drafts unresolved_draft
          on unresolved_draft.id = unresolved_intent.follow_up_draft_id
         and unresolved_draft.company_id = unresolved_intent.company_id
         and unresolved_draft.opportunity_id =
           unresolved_intent.opportunity_id
         and unresolved_draft.origin = 'template_follow_up'
       where unresolved_intent.id <> new.id
         and unresolved_intent.company_id = new.company_id
         and unresolved_intent.opportunity_id = new.opportunity_id
         and unresolved_intent.status in (
           'sending',
           'delivery_unknown',
           'provider_accepted',
           'reconciling',
           'reconciliation_failed'
         )
    ) or exists (
      -- Cover the provider-accepted/pre-correspondence window. The claim
      -- wrapper serializes opportunity-scoped prepared->sending transitions.
      select 1
        from public.email_send_intents competing_intent
       where competing_intent.id <> new.id
         and competing_intent.company_id = new.company_id
         and competing_intent.opportunity_id = new.opportunity_id
         and competing_intent.connection_id = new.connection_id
         and competing_intent.reply_provider_thread_id =
           draft.provider_thread_id
         and competing_intent.in_reply_to =
           source_event.provider_message_id
         and competing_intent.status in (
           'sending',
           'delivery_unknown',
           'provider_accepted',
           'reconciling',
           'reconciliation_failed',
           'reconciled'
         )
    ) then
      raise exception 'EMAIL_SEND_TEMPLATE_FOLLOW_UP_AUTHORIZATION_STALE';
    end if;

    return new;
  end if;

  if draft.origin is distinct from 'system_handoff' then
    if new.follow_up_source_event_id is not null
       or new.follow_up_recipient_email is not null then
      raise exception 'EMAIL_SEND_SYSTEM_HANDOFF_AUTHORIZATION_STALE';
    end if;
    return new;
  end if;

  if new.follow_up_source_event_id is null
     or new.follow_up_recipient_email is null
     or opportunity.deleted_at is not null
     or opportunity.archived_at is not null
     or opportunity.merged_into_opportunity_id is not null
     or opportunity.project_id is not null
     or opportunity.project_ref is not null
     or opportunity.stage not in (
       'new_lead',
       'qualifying',
       'quoting',
       'quoted',
       'follow_up',
       'negotiation'
     )
     or draft.status <> 'drafted'
     or new.initiated_by <> 'operator'
     or new.sender_switched
     or draft.source_event_id is null
     or nullif(btrim(draft.recipient_email), '') is null
     or new.follow_up_source_event_id is distinct from draft.source_event_id
     or new.follow_up_recipient_email is distinct from
       lower(btrim(draft.recipient_email))
     or cardinality(new.to_emails) <> 1
     or lower(btrim(new.to_emails[1])) is distinct from
       new.follow_up_recipient_email
     or coalesce(cardinality(new.cc_emails), 0) <> 0
  then
    raise exception 'EMAIL_SEND_SYSTEM_HANDOFF_AUTHORIZATION_STALE';
  end if;

  select event.*
    into source_event
    from public.opportunity_correspondence_events event
   where event.id = new.follow_up_source_event_id
     and event.company_id = new.company_id
     and event.opportunity_id = new.opportunity_id
     and event.connection_id = new.connection_id
     and event.direction = 'inbound'
     and event.party_role = 'customer'
     and event.is_meaningful is true
     and event.noise_reason is null
     and event.provider_message_id is not null
     and event.activity_id is not null
     and event.opportunity_projection_applied is true
     and lower(btrim(event.from_email)) = new.follow_up_recipient_email
   for share;
  if not found
     or not private.opportunity_sender_is_persisted_customer(
       new.company_id,
       new.opportunity_id,
       source_event.from_email
     )
  then
    raise exception 'EMAIL_SEND_SYSTEM_HANDOFF_AUTHORIZATION_STALE';
  end if;

  if draft.provider_thread_id is null then
    if new.source_email_thread_id is not null
       or new.reply_provider_thread_id is not null
       or new.in_reply_to is not null
       or not exists (
         select 1
           from public.unanswered_lead_message_projections projection
          where projection.company_id = new.company_id
            and projection.opportunity_id = new.opportunity_id
            and projection.source_event_id = source_event.id
            and projection.source_activity_id = source_event.activity_id
            and projection.connection_id = new.connection_id
            and projection.provider_thread_id =
              source_event.provider_thread_id
            and projection.provider_message_id =
              source_event.provider_message_id
            and projection.workstream = 'sales'
            and projection.response_disposition = 'reply_required'
            and projection.conversation_scope = 'message'
       )
    then
      raise exception 'EMAIL_SEND_SYSTEM_HANDOFF_AUTHORIZATION_STALE';
    end if;
  else
    select thread.*
      into source_thread
      from public.email_threads thread
     where thread.id = new.source_email_thread_id
       and thread.company_id = new.company_id
       and thread.connection_id = new.connection_id
       and thread.provider_thread_id = draft.provider_thread_id
     for share;
    if not found
       or source_event.provider_thread_id is distinct from
         draft.provider_thread_id
       or new.reply_provider_thread_id is distinct from
         draft.provider_thread_id
       or new.in_reply_to is distinct from source_event.provider_message_id
    then
      raise exception 'EMAIL_SEND_SYSTEM_HANDOFF_AUTHORIZATION_STALE';
    end if;
  end if;

  -- A system-generated unanswered-lead draft is stale when a newer customer
  -- message or a later OPS response has already changed the conversation.
  if exists (
    select 1
      from public.opportunity_correspondence_events newer_inbound
     where newer_inbound.company_id = new.company_id
       and newer_inbound.opportunity_id = new.opportunity_id
       and newer_inbound.direction = 'inbound'
       and newer_inbound.party_role = 'customer'
       and newer_inbound.is_meaningful is true
       and newer_inbound.noise_reason is null
       and newer_inbound.id <> source_event.id
       and newer_inbound.occurred_at >= source_event.occurred_at
  ) or exists (
    select 1
      from public.opportunity_correspondence_events later_outbound
     where later_outbound.company_id = new.company_id
       and later_outbound.opportunity_id = new.opportunity_id
       and later_outbound.direction = 'outbound'
       and later_outbound.party_role = 'ops'
       and later_outbound.is_meaningful is true
       and later_outbound.noise_reason is null
       and later_outbound.id <> source_event.id
       and later_outbound.occurred_at >= source_event.occurred_at
       and (
         (
           draft.provider_thread_id is not null
           and later_outbound.connection_id = new.connection_id
           and later_outbound.provider_thread_id =
             draft.provider_thread_id
         )
         or exists (
           select 1
             from unnest(
               coalesce(later_outbound.to_emails, '{}'::text[])
               || coalesce(later_outbound.cc_emails, '{}'::text[])
             ) recipient(email)
            where lower(btrim(recipient.email)) =
              new.follow_up_recipient_email
         )
       )
  ) or exists (
    select 1
      from public.email_send_intents later_intent
     where later_intent.id <> new.id
       and later_intent.company_id = new.company_id
       and later_intent.opportunity_id = new.opportunity_id
       and later_intent.created_at >= source_event.created_at
       and later_intent.status in (
         'prepared',
         'sending',
         'delivery_unknown',
         'provider_accepted',
         'reconciling',
         'reconciliation_failed',
         'reconciled'
       )
       and (
         later_intent.follow_up_source_event_id = source_event.id
         or (
           later_intent.connection_id = new.connection_id
           and later_intent.reply_provider_thread_id =
             source_event.provider_thread_id
         )
         or exists (
           select 1
             from public.email_threads later_source_thread
            where later_source_thread.id =
              later_intent.source_email_thread_id
              and later_source_thread.company_id = new.company_id
              and later_source_thread.connection_id =
                later_intent.connection_id
              and later_source_thread.provider_thread_id =
                source_event.provider_thread_id
         )
         or exists (
           select 1
             from unnest(
               coalesce(later_intent.to_emails, '{}'::text[])
               || coalesce(later_intent.cc_emails, '{}'::text[])
             ) recipient(email)
            where lower(btrim(recipient.email)) =
              new.follow_up_recipient_email
         )
       )
       and (
         later_intent.status <> 'prepared'
         or not exists (
           select 1
             from public.opportunity_follow_up_drafts later_draft
            where later_draft.id = later_intent.follow_up_draft_id
              and later_draft.company_id = new.company_id
              and later_draft.origin = 'system_handoff'
         )
         or (
           later_intent.follow_up_source_event_id is not null
           and (later_intent.created_at, later_intent.id)
             < (new.created_at, new.id)
         )
       )
  ) then
    raise exception 'EMAIL_SEND_SYSTEM_HANDOFF_AUTHORIZATION_STALE';
  end if;

  return new;
end;
$$;

drop trigger if exists email_send_intents_system_handoff_delivery_guard
  on public.email_send_intents;
create trigger email_send_intents_system_handoff_delivery_guard
  before update of status on public.email_send_intents
  for each row
  execute function private.guard_system_handoff_email_send_delivery();

revoke all on function private.guard_system_handoff_email_send_delivery()
  from public, anon, authenticated, service_role;

create or replace function private.guard_template_follow_up_draft_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.origin is distinct from 'template_follow_up' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.status = 'sent'
       and new.subject is not distinct from old.subject
       and new.original_body is not distinct from old.original_body
       and new.current_body is not distinct from old.current_body
       and new.connection_id is not distinct from old.connection_id
       and new.provider_thread_id is not distinct from old.provider_thread_id
       and new.source_event_id is not distinct from old.source_event_id
       and new.recipient_email is not distinct from old.recipient_email
       and exists (
         select 1
           from public.email_send_intents accepted_intent
          where accepted_intent.follow_up_draft_id = old.id
            and accepted_intent.company_id = old.company_id
            and accepted_intent.opportunity_id = old.opportunity_id
            and accepted_intent.status in (
              'provider_accepted',
              'reconciling',
              'reconciliation_failed',
              'reconciled'
            )
            and accepted_intent.provider_accepted_at is not null
            and nullif(btrim(accepted_intent.provider_message_id), '') is not null
            and new.final_sent_body is not distinct from
              accepted_intent.authored_body
            and new.sent_at is not distinct from
              accepted_intent.provider_accepted_at
       )
    then
      return new;
    end if;
  end if;

  if exists (
    select 1
      from public.email_send_intents unresolved_intent
     where unresolved_intent.follow_up_draft_id = old.id
       and unresolved_intent.company_id = old.company_id
       and unresolved_intent.opportunity_id = old.opportunity_id
       and unresolved_intent.status in (
         'sending',
         'delivery_unknown',
         'provider_accepted',
         'reconciling',
         'reconciliation_failed'
       )
  ) then
    raise exception 'EMAIL_SEND_TEMPLATE_FOLLOW_UP_DRAFT_FROZEN'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists opportunity_follow_up_drafts_template_send_guard
  on public.opportunity_follow_up_drafts;
create trigger opportunity_follow_up_drafts_template_send_guard
  before update or delete on public.opportunity_follow_up_drafts
  for each row
  execute function private.guard_template_follow_up_draft_mutation();

revoke all on function private.guard_template_follow_up_draft_mutation()
  from public, anon, authenticated, service_role;

commit;
