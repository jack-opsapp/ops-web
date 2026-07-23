-- Make OPS-local system handoff drafts operable without weakening the durable
-- email-send boundary. A handoff send is bound to one exact source event and
-- customer address, and message-scoped forwards always start a new provider
-- conversation. This migration performs no provider operation and sends no
-- email.

begin;

alter table public.email_send_intents
  add column if not exists follow_up_source_event_id uuid,
  add column if not exists follow_up_recipient_email text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.email_send_intents'::regclass
       and conname = 'email_send_intents_follow_up_source_event_fkey'
  ) then
    alter table public.email_send_intents
      add constraint email_send_intents_follow_up_source_event_fkey
      foreign key (company_id, follow_up_source_event_id)
      references public.opportunity_correspondence_events (company_id, id)
      on delete restrict;
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.email_send_intents'::regclass
       and conname = 'email_send_intents_follow_up_binding_pair_check'
  ) then
    alter table public.email_send_intents
      add constraint email_send_intents_follow_up_binding_pair_check
      check (
        (follow_up_source_event_id is null and follow_up_recipient_email is null)
        or
        (follow_up_source_event_id is not null and follow_up_recipient_email is not null)
      );
  end if;
end;
$$;

comment on column public.email_send_intents.follow_up_source_event_id is
  'Exact customer correspondence event authorizing a system-handoff send.';
comment on column public.email_send_intents.follow_up_recipient_email is
  'Normalized customer recipient snapshotted from the system-handoff draft source event.';

create or replace function public.prepare_email_send_intent_guarded(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_company_id uuid,
  p_actor_user_id uuid,
  p_initiated_by text,
  p_connection_id uuid,
  p_opportunity_id uuid,
  p_source_email_thread_id uuid default null,
  p_reply_provider_thread_id text default null,
  p_in_reply_to text default null,
  p_sender_switched boolean default false,
  p_to_emails text[] default '{}'::text[],
  p_cc_emails text[] default '{}'::text[],
  p_subject text default '',
  p_authored_body text default '',
  p_rendered_body text default '',
  p_content_type text default 'text',
  p_draft_history_id uuid default null,
  p_follow_up_draft_id uuid default null,
  p_learning_authority text default 'operator_authored',
  p_signature_id uuid default null,
  p_signature_content_hash text default null,
  p_rendered_body_hash text default '',
  p_pending_auto_send_id uuid default null,
  p_pending_auto_send_lease_token uuid default null
)
returns public.email_send_intents
language plpgsql
security definer
set search_path = ''
as $$
declare
  opportunity public.opportunities%rowtype;
  v_intent public.email_send_intents%rowtype;
  v_follow_up_draft public.opportunity_follow_up_drafts%rowtype;
  v_follow_up_source_event public.opportunity_correspondence_events%rowtype;
  v_source_thread public.email_threads%rowtype;
  v_is_message_scoped boolean;
  v_is_system_handoff boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EMAIL_SEND_ACCESS_DENIED' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'EMAIL_SEND_INTENT_INVALID';
  end if;

  -- Every lead mutation joins the same company fence, then locks the parent
  -- opportunity before any intent, draft, thread, or event row. FOR UPDATE is
  -- deliberate: it also serializes this new sender against rolling legacy
  -- prepare calls, whose canonical implementation already takes FOR SHARE on
  -- the opportunity before inserting an intent.
  perform private.lock_lead_assignment_company(p_company_id);
  select candidate.*
    into opportunity
    from public.opportunities candidate
   where candidate.id = p_opportunity_id
     and candidate.company_id = p_company_id
   for update;
  if not found then
    raise exception 'EMAIL_SEND_OPPORTUNITY_INVALID';
  end if;

  -- Lock the durable idempotency record only after its parent. An exact retry
  -- still resumes the one existing intent even when reconciliation has marked
  -- the local draft sent after provider acceptance.
  select i.*
    into v_intent
    from public.email_send_intents i
   where i.company_id = p_company_id
     and i.idempotency_key = btrim(p_idempotency_key)
   for update;

  if found and v_intent.request_fingerprint = p_request_fingerprint then
    if v_intent.actor_user_id is distinct from p_actor_user_id
       or v_intent.initiated_by is distinct from p_initiated_by
       or v_intent.connection_id is distinct from p_connection_id
       or v_intent.opportunity_id is distinct from p_opportunity_id
       or v_intent.source_email_thread_id is distinct from p_source_email_thread_id
       or v_intent.reply_provider_thread_id is distinct from p_reply_provider_thread_id
       or v_intent.in_reply_to is distinct from p_in_reply_to
       or v_intent.sender_switched is distinct from coalesce(p_sender_switched, false)
       or v_intent.to_emails is distinct from p_to_emails
       or v_intent.cc_emails is distinct from coalesce(p_cc_emails, '{}'::text[])
       or v_intent.subject is distinct from p_subject
       or v_intent.authored_body is distinct from p_authored_body
       or v_intent.rendered_body is distinct from p_rendered_body
       or v_intent.content_type is distinct from p_content_type
       or v_intent.draft_history_id is distinct from p_draft_history_id
       or v_intent.follow_up_draft_id is distinct from p_follow_up_draft_id
       or v_intent.learning_authority is distinct from p_learning_authority
       or v_intent.signature_id is distinct from p_signature_id
       or v_intent.signature_content_hash is distinct from p_signature_content_hash
       or v_intent.rendered_body_hash is distinct from p_rendered_body_hash
       or v_intent.pending_auto_send_id is distinct from p_pending_auto_send_id
       or v_intent.pending_auto_send_lease_token is distinct from p_pending_auto_send_lease_token
    then
      raise exception 'EMAIL_SEND_IDEMPOTENCY_CONFLICT';
    end if;

    if v_intent.follow_up_source_event_id is not null
       and (
         v_intent.follow_up_recipient_email is distinct from
           lower(btrim(p_to_emails[1]))
         or cardinality(p_to_emails) <> 1
       )
    then
      raise exception 'EMAIL_SEND_IDEMPOTENCY_CONFLICT';
    end if;

    -- A legacy app can have prepared a system-handoff intent before the new
    -- immutable source/recipient columns existed. Never allow that unbound row
    -- to advance. Completed/accepted retries still resume reconciliation and
    -- do not re-open mutable authorization.
    if v_intent.status = 'prepared'
       and p_follow_up_draft_id is not null then
      select d.*
        into v_follow_up_draft
        from public.opportunity_follow_up_drafts d
       where d.id = p_follow_up_draft_id
         and d.company_id = p_company_id
         and d.opportunity_id = p_opportunity_id
       for share;
      v_is_system_handoff :=
        found and v_follow_up_draft.origin = 'system_handoff';
      if v_is_system_handoff then
        if v_intent.follow_up_source_event_id is null
           or v_intent.follow_up_recipient_email is null then
          raise exception 'EMAIL_SEND_SYSTEM_HANDOFF_BINDING_REQUIRED';
        end if;
        if opportunity.deleted_at is not null
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
        then
          raise exception 'EMAIL_SEND_SYSTEM_HANDOFF_OPPORTUNITY_STALE';
        end if;
      end if;
    end if;

    return v_intent;
  end if;

  -- Preserve the canonical implementation for every ordinary send. The
  -- legacy function retains the guarded queue-lease rebind exception for a
  -- changed Phase C fingerprint and rejects every other changed retry.
  if p_follow_up_draft_id is null then
    select prepared.*
      into v_intent
      from public.prepare_email_send_intent(
        p_idempotency_key,
        p_request_fingerprint,
        p_company_id,
        p_actor_user_id,
        p_initiated_by,
        p_connection_id,
        p_opportunity_id,
        p_source_email_thread_id,
        p_reply_provider_thread_id,
        p_in_reply_to,
        p_sender_switched,
        p_to_emails,
        p_cc_emails,
        p_subject,
        p_authored_body,
        p_rendered_body,
        p_content_type,
        p_draft_history_id,
        p_follow_up_draft_id,
        p_learning_authority,
        p_signature_id,
        p_signature_content_hash,
        p_rendered_body_hash,
        p_pending_auto_send_id,
        p_pending_auto_send_lease_token
      ) prepared;
    return v_intent;
  end if;

  select d.*
    into v_follow_up_draft
    from public.opportunity_follow_up_drafts d
   where d.id = p_follow_up_draft_id
     and d.company_id = p_company_id
     and d.opportunity_id = p_opportunity_id
   for share;

  v_is_system_handoff :=
    found and v_follow_up_draft.origin = 'system_handoff';
  if not v_is_system_handoff then
    select prepared.*
      into v_intent
      from public.prepare_email_send_intent(
        p_idempotency_key,
        p_request_fingerprint,
        p_company_id,
        p_actor_user_id,
        p_initiated_by,
        p_connection_id,
        p_opportunity_id,
        p_source_email_thread_id,
        p_reply_provider_thread_id,
        p_in_reply_to,
        p_sender_switched,
        p_to_emails,
        p_cc_emails,
        p_subject,
        p_authored_body,
        p_rendered_body,
        p_content_type,
        p_draft_history_id,
        p_follow_up_draft_id,
        p_learning_authority,
        p_signature_id,
        p_signature_content_hash,
        p_rendered_body_hash,
        p_pending_auto_send_id,
        p_pending_auto_send_lease_token
      ) prepared;
    return v_intent;
  end if;

  if opportunity.deleted_at is not null
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
  then
    raise exception 'EMAIL_SEND_SYSTEM_HANDOFF_OPPORTUNITY_STALE';
  end if;

  if v_follow_up_draft.status <> 'drafted'
     or v_follow_up_draft.connection_id is distinct from p_connection_id
     or nullif(btrim(v_follow_up_draft.recipient_email), '') is null
     or v_follow_up_draft.source_event_id is null
     or p_initiated_by is distinct from 'operator'
     or p_draft_history_id is not null
     or p_pending_auto_send_id is not null
     or p_pending_auto_send_lease_token is not null
     or coalesce(p_sender_switched, false)
     or cardinality(p_to_emails) <> 1
     or lower(btrim(p_to_emails[1])) is distinct from lower(btrim(v_follow_up_draft.recipient_email))
     or coalesce(cardinality(p_cc_emails), 0) <> 0
  then
    raise exception 'EMAIL_SEND_SYSTEM_HANDOFF_INVALID';
  end if;

  select e.*
    into v_follow_up_source_event
    from public.opportunity_correspondence_events e
   where e.id = v_follow_up_draft.source_event_id
     and e.company_id = p_company_id
     and e.connection_id = p_connection_id
     and e.opportunity_id = p_opportunity_id
     and e.direction = 'inbound'
     and e.party_role = 'customer'
     and e.is_meaningful is true
     and e.noise_reason is null
     and e.provider_message_id is not null
     and e.activity_id is not null
     and e.opportunity_projection_applied is true
     and lower(btrim(e.from_email)) = lower(btrim(v_follow_up_draft.recipient_email))
   for share;
  if not found
     or not private.opportunity_sender_is_persisted_customer(
       p_company_id,
       p_opportunity_id,
       v_follow_up_source_event.from_email
     )
  then
    raise exception 'EMAIL_SEND_SYSTEM_HANDOFF_SOURCE_INVALID';
  end if;

  v_is_message_scoped := v_follow_up_draft.provider_thread_id is null;
  if v_is_message_scoped then
    if p_source_email_thread_id is not null
       or p_reply_provider_thread_id is not null
       or p_in_reply_to is not null
       or not exists (
         select 1
           from public.unanswered_lead_message_projections projection
          where projection.company_id = p_company_id
            and projection.opportunity_id = p_opportunity_id
            and projection.source_event_id = v_follow_up_source_event.id
            and projection.source_activity_id = v_follow_up_source_event.activity_id
            and projection.connection_id = p_connection_id
            and projection.provider_thread_id = v_follow_up_source_event.provider_thread_id
            and projection.provider_message_id = v_follow_up_source_event.provider_message_id
            and projection.workstream = 'sales'
            and projection.response_disposition = 'reply_required'
            and projection.conversation_scope = 'message'
       )
    then
      raise exception 'EMAIL_SEND_SYSTEM_HANDOFF_MESSAGE_SCOPE_INVALID';
    end if;
  else
    select t.*
      into v_source_thread
      from public.email_threads t
     where t.id = p_source_email_thread_id
       and t.company_id = p_company_id
       and t.connection_id = p_connection_id
       and t.provider_thread_id = v_follow_up_draft.provider_thread_id
     for share;
    if not found
       or v_follow_up_source_event.provider_thread_id is distinct from v_follow_up_draft.provider_thread_id
       or p_reply_provider_thread_id is distinct from v_follow_up_draft.provider_thread_id
       or p_in_reply_to is distinct from v_follow_up_source_event.provider_message_id
    then
      raise exception 'EMAIL_SEND_SYSTEM_HANDOFF_THREAD_SCOPE_INVALID';
    end if;
  end if;

  -- The canonical function owns all actor, mailbox, assignment, signature,
  -- lead-access, queue, and ordinary thread authorization. Its historical
  -- threadless follow-up rule cannot represent a source-bound message-scoped
  -- handoff, so only that call omits the draft id and this wrapper attaches it
  -- atomically before commit.
  select prepared.*
    into v_intent
    from public.prepare_email_send_intent(
      p_idempotency_key,
      p_request_fingerprint,
      p_company_id,
      p_actor_user_id,
      p_initiated_by,
      p_connection_id,
      p_opportunity_id,
      p_source_email_thread_id,
      p_reply_provider_thread_id,
      p_in_reply_to,
      p_sender_switched,
      p_to_emails,
      p_cc_emails,
      p_subject,
      p_authored_body,
      p_rendered_body,
      p_content_type,
      p_draft_history_id,
      case when v_is_message_scoped then null else p_follow_up_draft_id end,
      p_learning_authority,
      p_signature_id,
      p_signature_content_hash,
      p_rendered_body_hash,
      p_pending_auto_send_id,
      p_pending_auto_send_lease_token
    ) prepared;

  if v_intent.follow_up_source_event_id is not null then
    if v_intent.follow_up_draft_id is distinct from p_follow_up_draft_id
       or v_intent.follow_up_source_event_id is distinct from v_follow_up_source_event.id
       or v_intent.follow_up_recipient_email is distinct from lower(btrim(v_follow_up_draft.recipient_email))
    then
      raise exception 'EMAIL_SEND_IDEMPOTENCY_CONFLICT';
    end if;
    return v_intent;
  end if;

  if v_intent.status <> 'prepared'
     or (
       not v_is_message_scoped
       and v_intent.follow_up_draft_id is distinct from p_follow_up_draft_id
     )
     or (
       v_is_message_scoped
       and v_intent.follow_up_draft_id is not null
     )
  then
    raise exception 'EMAIL_SEND_IDEMPOTENCY_CONFLICT';
  end if;

  update public.email_send_intents i
     set follow_up_draft_id = p_follow_up_draft_id,
         (follow_up_source_event_id, follow_up_recipient_email) =
           (v_follow_up_source_event.id, lower(btrim(v_follow_up_draft.recipient_email))),
         updated_at = now()
   where i.id = v_intent.id
     and i.status = 'prepared'
     and i.follow_up_source_event_id is null
     and i.follow_up_recipient_email is null
  returning i.* into v_intent;

  if not found then
    raise exception 'EMAIL_SEND_IDEMPOTENCY_CONFLICT';
  end if;
  return v_intent;
end;
$$;

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

  -- The public claim wrapper already owns this parent FOR UPDATE. Re-reading it
  -- FOR SHARE here proves the final commercial state immediately before the
  -- prepared-to-sending transition while preserving parent-before-child order.
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
     or new.follow_up_recipient_email is distinct from lower(btrim(draft.recipient_email))
     or cardinality(new.to_emails) <> 1
     or lower(btrim(new.to_emails[1])) is distinct from new.follow_up_recipient_email
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
            and projection.provider_thread_id = source_event.provider_thread_id
            and projection.provider_message_id = source_event.provider_message_id
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
       or source_event.provider_thread_id is distinct from draft.provider_thread_id
       or new.reply_provider_thread_id is distinct from draft.provider_thread_id
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
           and later_outbound.provider_thread_id = draft.provider_thread_id
         )
         or exists (
           select 1
             from unnest(
               coalesce(later_outbound.to_emails, '{}'::text[])
               || coalesce(later_outbound.cc_emails, '{}'::text[])
             ) recipient(email)
            where lower(btrim(recipient.email)) = new.follow_up_recipient_email
         )
       )
  ) or exists (
    -- An outbound event is written only after provider acceptance. Cover the
    -- pre-event window with the durable send ledger itself. The public claim
    -- wrapper serializes opportunity-scoped claims before any intent row lock,
    -- so this nonlocking proof is linearizable and cannot cross-lock two
    -- competing intent rows.
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
           and later_intent.reply_provider_thread_id = source_event.provider_thread_id
         )
         or exists (
           select 1
             from public.email_threads later_source_thread
            where later_source_thread.id = later_intent.source_email_thread_id
              and later_source_thread.company_id = new.company_id
              and later_source_thread.connection_id = later_intent.connection_id
              and later_source_thread.provider_thread_id = source_event.provider_thread_id
         )
         or exists (
           select 1
             from unnest(
               coalesce(later_intent.to_emails, '{}'::text[])
               || coalesce(later_intent.cc_emails, '{}'::text[])
             ) recipient(email)
            where lower(btrim(recipient.email)) = new.follow_up_recipient_email
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

-- The previous public claim locks its intent first. Put a parent-first wrapper
-- around it so two different intents for the same lead cannot both pass their
-- final stale proofs under READ COMMITTED, and so claim/merge/reparent all use
-- the same company -> opportunity -> child order.
alter function public.claim_email_send_provider_delivery(uuid)
  rename to claim_email_send_provider_delivery_pre_system_handoff_guard;

revoke all on function public.claim_email_send_provider_delivery_pre_system_handoff_guard(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.claim_email_send_provider_delivery(
  p_intent_id uuid
)
returns public.email_send_intents
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent_identity record;
  intent public.email_send_intents%rowtype;
  claimed public.email_send_intents%rowtype;
  v_is_system_handoff boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EMAIL_SEND_ACCESS_DENIED' using errcode = '42501';
  end if;

  -- Identity columns are immutable after insertion. Read them without a row
  -- lock only to discover the parent lock key; the delegated canonical claim
  -- remains the sole owner of the intent FOR UPDATE transition.
  select candidate.company_id, candidate.opportunity_id, candidate.status
    into intent_identity
    from public.email_send_intents candidate
   where candidate.id = p_intent_id;
  if not found then
    return null;
  end if;
  if intent_identity.status <> 'prepared' then
    return null;
  end if;

  perform private.lock_lead_assignment_company(intent_identity.company_id);
  perform 1
    from public.opportunities opportunity
   where opportunity.id = intent_identity.opportunity_id
     and opportunity.company_id = intent_identity.company_id
     and opportunity.deleted_at is null
   for update;
  if not found then
    raise exception 'EMAIL_SEND_AUTHORIZATION_STALE' using errcode = '42501';
  end if;

  select candidate.*
    into intent
    from public.email_send_intents candidate
   where candidate.id = p_intent_id;
  if not found or intent.status <> 'prepared' then
    return null;
  end if;

  if intent.follow_up_draft_id is not null then
    select exists (
      select 1
        from public.opportunity_follow_up_drafts draft
       where draft.id = intent.follow_up_draft_id
         and draft.company_id = intent.company_id
         and draft.opportunity_id = intent.opportunity_id
         and draft.origin = 'system_handoff'
    ) into v_is_system_handoff;
  end if;

  -- If a handoff already crossed the provider boundary, a subsequently
  -- prepared ordinary reply to the same lead/thread/recipient must not send as
  -- well. Prepared handoffs do not block an operator-authored ordinary reply;
  -- the handoff trigger sees that prepared reply and yields to it instead.
  if not v_is_system_handoff and exists (
    select 1
      from public.email_send_intents handoff
      join public.opportunity_correspondence_events handoff_source
        on handoff_source.company_id = handoff.company_id
       and handoff_source.id = handoff.follow_up_source_event_id
     where handoff.id <> intent.id
       and handoff.company_id = intent.company_id
       and handoff.opportunity_id = intent.opportunity_id
       and handoff.status in (
         'sending',
         'delivery_unknown',
         'provider_accepted',
         'reconciling',
         'reconciliation_failed'
       )
       and (
         handoff_source.provider_thread_id = intent.reply_provider_thread_id
         or exists (
           select 1
             from public.email_threads candidate_source_thread
            where candidate_source_thread.id = intent.source_email_thread_id
              and candidate_source_thread.company_id = intent.company_id
              and candidate_source_thread.provider_thread_id = handoff_source.provider_thread_id
         )
         or exists (
           select 1
             from unnest(
               coalesce(intent.to_emails, '{}'::text[])
               || coalesce(intent.cc_emails, '{}'::text[])
             ) recipient(email)
            where lower(btrim(recipient.email)) = handoff.follow_up_recipient_email
         )
       )
  ) then
    raise exception 'EMAIL_SEND_SYSTEM_HANDOFF_CONFLICT' using errcode = '42501';
  end if;

  select previous_claim.*
    into claimed
    from public.claim_email_send_provider_delivery_pre_system_handoff_guard(
      p_intent_id
    ) previous_claim;
  return claimed;
end;
$$;

revoke all on function public.claim_email_send_provider_delivery(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_email_send_provider_delivery(uuid)
  to service_role;

revoke all on function public.prepare_email_send_intent_guarded(
  text, text, uuid, uuid, text, uuid, uuid, uuid, text, text, boolean,
  text[], text[], text, text, text, text, uuid, uuid, text, uuid, text,
  text, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.prepare_email_send_intent_guarded(
  text, text, uuid, uuid, text, uuid, uuid, uuid, text, text, boolean,
  text[], text[], text, text, text, text, uuid, uuid, text, uuid, text,
  text, uuid, uuid
) to service_role;

-- Keep the existing service-role grant on prepare_email_send_intent during
-- rollout. The migration can land first without interrupting the currently
-- deployed sender; the new application release then moves every in-repo send
-- through the guarded wrapper. The legacy RPC remains inaccessible to public,
-- anon, and authenticated roles under its original migration grants.

comment on function public.prepare_email_send_intent_guarded(
  text, text, uuid, uuid, text, uuid, uuid, uuid, text, text, boolean,
  text[], text[], text, text, text, text, uuid, uuid, text, uuid, text,
  text, uuid, uuid
) is
  'Service-only send-intent boundary. System handoffs are bound to one exact source event and recipient; exact retries resume without revalidating mutable draft status.';

comment on function public.claim_email_send_provider_delivery(uuid) is
  'Service-only provider claim. Serializes company and opportunity before the durable intent, rechecks system-handoff authorization, and prevents a second source/thread/recipient-scoped send from crossing the provider boundary.';

commit;
