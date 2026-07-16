begin;

-- The only public service bridge for actor-aware inbox authorization. It
-- derives the actor's company from the canonical OPS user UUID and delegates
-- to the reviewed 160700 opportunity/inbox intersection helpers. Callers
-- cannot supply a company or substitute mailbox/login email identity.
create or replace function public.authorize_email_inbox_action_as_system(
  p_actor_user_id uuid,
  p_connection_id uuid,
  p_opportunity_id uuid,
  p_action text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_company_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'email inbox authorization requires service role'
      using errcode = '42501';
  end if;
  if p_actor_user_id is null
     or p_connection_id is null
     or p_action not in ('view', 'send') then
    raise exception 'invalid email inbox authorization action'
      using errcode = '22023';
  end if;

  select actor.company_id
    into v_actor_company_id
  from public.users as actor
  where actor.id = p_actor_user_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false);
  if not found then
    return false;
  end if;

  if p_action = 'view' then
    if p_opportunity_id is null then
      return private.user_can_view_inbox_connection(
        p_actor_user_id,
        v_actor_company_id,
        p_connection_id,
        null
      );
    end if;
    return private.user_can_view_opportunity_inbox(
      p_actor_user_id,
      p_opportunity_id,
      p_connection_id
    );
  end if;

  if p_opportunity_id is null then
    return private.user_can_send_inbox_connection(
      p_actor_user_id,
      v_actor_company_id,
      p_connection_id,
      null
    );
  end if;
  return private.user_can_send_opportunity_inbox(
    p_actor_user_id,
    p_opportunity_id,
    p_connection_id
  );
end;
$$;

revoke all on function public.authorize_email_inbox_action_as_system(
  uuid,
  uuid,
  uuid,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.authorize_email_inbox_action_as_system(
  uuid,
  uuid,
  uuid,
  text
) to service_role;

create or replace function private.email_company_subscription_active(
  p_subscription_status text,
  p_subscription_plan text,
  p_trial_end_date timestamptz,
  p_at timestamptz
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    coalesce(p_subscription_status in ('active', 'grace'), false)
    or (
      coalesce(p_subscription_plan, 'trial') = 'trial'
      and p_trial_end_date is not null
      and p_trial_end_date > p_at
    );
$$;

revoke all on function private.email_company_subscription_active(
  text, text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;

create table public.email_send_intents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  idempotency_key text not null,
  request_fingerprint text not null,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  initiated_by text not null,
  connection_id uuid not null references public.email_connections(id) on delete restrict,
  opportunity_id uuid not null references public.opportunities(id) on delete restrict,
  assignment_version bigint not null,
  assignment_event_id uuid references public.opportunity_assignment_events(id) on delete restrict,
  actor_name_snapshot text not null,
  actor_email_snapshot text not null,
  client_from_address_snapshot text not null,
  source_email_thread_id uuid references public.email_threads(id) on delete restrict,
  reply_provider_thread_id text,
  in_reply_to text,
  sender_switched boolean not null default false,
  to_emails text[] not null,
  cc_emails text[] not null default '{}'::text[],
  subject text not null,
  authored_body text not null,
  rendered_body text not null,
  content_type text not null,
  draft_history_id uuid references public.ai_draft_history(id) on delete restrict,
  follow_up_draft_id uuid references public.opportunity_follow_up_drafts(id) on delete restrict,
  learning_authority text not null,
  signature_id uuid references public.email_signatures(id) on delete restrict,
  signature_content_hash text,
  rendered_body_hash text not null,
  pending_auto_send_id uuid references public.pending_auto_sends(id) on delete restrict,
  pending_auto_send_lease_token uuid,
  profile_type_snapshot text not null default 'general',
  status text not null default 'prepared',
  provider_message_id text,
  accepted_provider_thread_id text,
  provider_accepted_at timestamptz,
  reconciliation_attempts integer not null default 0,
  max_reconciliation_attempts integer not null default 8,
  reconciliation_lease_token uuid,
  reconciliation_lease_expires_at timestamptz,
  reconciled_activity_id uuid references public.activities(id) on delete set null,
  reconciled_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, idempotency_key),
  constraint email_send_intents_idempotency_key_check
    check (length(btrim(idempotency_key)) between 1 and 200),
  constraint email_send_intents_request_fingerprint_check
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint email_send_intents_rendered_body_hash_check
    check (rendered_body_hash ~ '^[0-9a-f]{64}$'),
  constraint email_send_intents_signature_hash_check
    check (
      (signature_id is null and signature_content_hash is null)
      or (
        signature_id is not null
        and signature_content_hash ~ '^[0-9a-f]{64}$'
      )
    ),
  constraint email_send_intents_initiated_by_check
    check (initiated_by in ('operator', 'phase_c_auto_send', 'lifecycle_auto_send')),
  constraint email_send_intents_content_type_check
    check (content_type in ('text', 'html')),
  constraint email_send_intents_learning_authority_check
    check (learning_authority in ('operator_authored', 'operator_approved', 'autonomous')),
  constraint email_send_intents_status_check
    check (status in ('prepared', 'sending', 'provider_accepted', 'reconciling', 'reconciliation_failed', 'reconciled', 'provider_rejected', 'delivery_unknown')),
  constraint email_send_intents_recipient_check
    check (cardinality(to_emails) > 0),
  constraint email_send_intents_sender_switch_source_check
    check (not sender_switched or source_email_thread_id is not null),
  constraint email_send_intents_sender_switch_reply_check
    check (
      not sender_switched
      or (reply_provider_thread_id is null and in_reply_to is null)
    ),
  constraint email_send_intents_pending_auto_send_lease_check
    check (
      (pending_auto_send_id is null and pending_auto_send_lease_token is null)
      or (
        pending_auto_send_id is not null
        and pending_auto_send_lease_token is not null
      )
    ),
  constraint email_send_intents_reconciliation_attempts_check
    check (
      reconciliation_attempts >= 0
      and max_reconciliation_attempts between 1 and 100
      and reconciliation_attempts <= max_reconciliation_attempts
    ),
  constraint email_send_intents_accepted_identity_check
    check (
      status not in ('provider_accepted', 'reconciling', 'reconciliation_failed', 'reconciled')
      or (
        provider_message_id is not null
        and accepted_provider_thread_id is not null
        and provider_accepted_at is not null
      )
    )
);

comment on table public.email_send_intents is
  'Durable pre-provider send ledger. A deterministic company-scoped idempotency key binds one authorized OPS actor, mailbox, lead, thread mode, and authored request. Accepted provider results reconcile without resending.';

create index email_send_intents_connection_idx
  on public.email_send_intents (company_id, connection_id, created_at desc);

create index email_send_intents_opportunity_idx
  on public.email_send_intents (company_id, opportunity_id, created_at desc);

create index email_send_intents_actor_idx
  on public.email_send_intents (company_id, actor_user_id, created_at desc);

create index email_send_intents_reconciliation_due_idx
  on public.email_send_intents (updated_at, id)
  where status in ('provider_accepted', 'reconciliation_failed');

create index email_send_intents_reconciliation_stale_idx
  on public.email_send_intents (reconciliation_lease_expires_at, id)
  where status = 'reconciling';

alter table public.email_send_intents enable row level security;

revoke all on table public.email_send_intents from public, anon, authenticated, service_role;
grant select, insert, update on table public.email_send_intents to service_role;

create or replace function public.prepare_email_send_intent(
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
  v_actor public.users%rowtype;
  v_connection public.email_connections%rowtype;
  v_opportunity public.opportunities%rowtype;
  v_source_thread public.email_threads%rowtype;
  v_draft_history public.ai_draft_history%rowtype;
  v_follow_up_draft public.opportunity_follow_up_drafts%rowtype;
  v_follow_up_source_event public.opportunity_correspondence_events%rowtype;
  v_intent public.email_send_intents%rowtype;
  v_assignment_event_id uuid;
  v_profile_type text := 'general';
begin
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$'
     or nullif(btrim(coalesce(p_subject, '')), '') is null
     or nullif(btrim(coalesce(p_authored_body, '')), '') is null
     or nullif(btrim(coalesce(p_rendered_body, '')), '') is null
     or p_rendered_body_hash !~ '^[0-9a-f]{64}$'
     or coalesce(cardinality(p_to_emails), 0) = 0 then
    raise exception 'EMAIL_SEND_INTENT_INVALID';
  end if;
  if (p_pending_auto_send_id is null)
     <> (p_pending_auto_send_lease_token is null) then
    raise exception 'EMAIL_SEND_PENDING_AUTO_SEND_LEASE_INVALID';
  end if;
  if p_draft_history_id is not null and p_follow_up_draft_id is not null then
    raise exception 'EMAIL_SEND_DRAFT_PROVENANCE_AMBIGUOUS';
  end if;

  select u.*
    into v_actor
    from public.users u
   where u.id = p_actor_user_id
     and u.company_id = p_company_id
     and u.deleted_at is null
     and coalesce(u.is_active, false)
   for share;
  if not found then
    raise exception 'EMAIL_SEND_ACTOR_INVALID';
  end if;

  select c.*
    into v_connection
    from public.email_connections c
   where c.id = p_connection_id
     and c.company_id = p_company_id::text
     and c.status = 'active'
   for share;
  if not found then
    raise exception 'EMAIL_SEND_CONNECTION_INVALID';
  end if;

  if v_connection.type::text = 'individual'
     and coalesce(v_connection.user_id, '') <> p_actor_user_id::text then
    raise exception 'EMAIL_SEND_PERSONAL_MAILBOX_FORBIDDEN';
  end if;
  if p_initiated_by <> 'operator'
     and not coalesce(v_connection.agent_can_send_from, false) then
    raise exception 'EMAIL_SEND_AGENT_MAILBOX_DISABLED';
  end if;

  select o.*
    into v_opportunity
    from public.opportunities o
   where o.id = p_opportunity_id
     and o.company_id = p_company_id
     and o.deleted_at is null
   for share;
  if not found then
    raise exception 'EMAIL_SEND_OPPORTUNITY_INVALID';
  end if;

  select e.id
    into v_assignment_event_id
    from public.opportunity_assignment_events e
   where e.company_id = p_company_id
     and e.opportunity_id = p_opportunity_id
   order by e.created_at desc, e.id desc
   limit 1;

  if not private.user_can_send_opportunity_inbox(
    p_actor_user_id,
    p_opportunity_id,
    p_connection_id
  ) then
    raise exception 'EMAIL_SEND_FORBIDDEN';
  end if;

  if p_source_email_thread_id is null then
    if p_sender_switched
       or p_reply_provider_thread_id is not null
       or p_in_reply_to is not null then
      raise exception 'EMAIL_SEND_THREAD_MODE_INVALID';
    end if;
  else
    select t.*
      into v_source_thread
      from public.email_threads t
     where t.id = p_source_email_thread_id
       and t.company_id = p_company_id
     for share;
    if not found then
      raise exception 'EMAIL_SEND_SOURCE_THREAD_INVALID';
    end if;

    if not exists (
      select 1
        from public.opportunity_email_threads link
       where link.opportunity_id = p_opportunity_id
         and link.connection_id = v_source_thread.connection_id
         and link.thread_id = v_source_thread.provider_thread_id
    ) then
      raise exception 'EMAIL_SEND_SOURCE_THREAD_LEAD_CONFLICT';
    end if;

    if p_sender_switched then
      if v_source_thread.connection_id = p_connection_id
         or p_reply_provider_thread_id is not null
         or p_in_reply_to is not null then
        raise exception 'EMAIL_SEND_SENDER_SWITCH_INVALID';
      end if;
    elsif v_source_thread.connection_id <> p_connection_id
       or p_reply_provider_thread_id is distinct from v_source_thread.provider_thread_id then
      raise exception 'EMAIL_SEND_REPLY_MAILBOX_CONFLICT';
    end if;

    if p_in_reply_to is not null and not exists (
      select 1
        from public.activities a
       where a.company_id = p_company_id
         and a.email_connection_id = p_connection_id
         and a.opportunity_id = p_opportunity_id
         and a.email_thread_id = v_source_thread.provider_thread_id
         and a.email_message_id = p_in_reply_to
    ) then
      raise exception 'EMAIL_SEND_REPLY_MESSAGE_INVALID';
    end if;
  end if;

  if p_draft_history_id is not null then
    select d.*
      into v_draft_history
      from public.ai_draft_history d
     where d.id = p_draft_history_id
       and d.company_id = p_company_id
       and d.user_id = p_actor_user_id
       and d.status in ('drafted', 'auto_drafted')
     for share;
    if not found
       or v_draft_history.opportunity_id is distinct from p_opportunity_id then
      raise exception 'EMAIL_SEND_DRAFT_INVALID';
    end if;

    if p_source_email_thread_id is null then
      if v_draft_history.connection_id is distinct from p_connection_id
         or v_draft_history.thread_id is not null
         or v_draft_history.source_message_id is not null then
        raise exception 'EMAIL_SEND_DRAFT_SOURCE_INVALID';
      end if;
    else
      if v_draft_history.connection_id is distinct from v_source_thread.connection_id
         or v_draft_history.thread_id is distinct from v_source_thread.provider_thread_id
         or v_draft_history.source_message_id is null then
        raise exception 'EMAIL_SEND_DRAFT_SOURCE_INVALID';
      end if;
      if not exists (
        select 1
          from public.activities a
         where a.company_id = p_company_id
           and a.email_connection_id = v_source_thread.connection_id
           and a.opportunity_id = p_opportunity_id
           and a.email_thread_id = v_source_thread.provider_thread_id
           and a.email_message_id = v_draft_history.source_message_id
      ) then
        raise exception 'EMAIL_SEND_DRAFT_SOURCE_MESSAGE_INVALID';
      end if;
      if not p_sender_switched
         and p_in_reply_to is distinct from v_draft_history.source_message_id then
        raise exception 'EMAIL_SEND_DRAFT_REPLY_MESSAGE_CONFLICT';
      end if;
    end if;

    v_profile_type := coalesce(
      nullif(btrim(v_draft_history.profile_type), ''),
      'general'
    );
  end if;

  if p_follow_up_draft_id is not null then
    select d.*
      into v_follow_up_draft
      from public.opportunity_follow_up_drafts d
     where d.id = p_follow_up_draft_id
       and d.company_id = p_company_id
       and d.opportunity_id = p_opportunity_id
       and d.status = 'drafted'
     for share;
    if not found then
      raise exception 'EMAIL_SEND_FOLLOW_UP_DRAFT_INVALID';
    end if;

    if p_source_email_thread_id is null then
      if v_follow_up_draft.connection_id is distinct from p_connection_id
         or v_follow_up_draft.provider_thread_id is not null
         or v_follow_up_draft.source_event_id is not null then
        raise exception 'EMAIL_SEND_FOLLOW_UP_DRAFT_SOURCE_INVALID';
      end if;
    else
      if v_follow_up_draft.connection_id is distinct from v_source_thread.connection_id
         or v_follow_up_draft.provider_thread_id is distinct from v_source_thread.provider_thread_id
         or v_follow_up_draft.source_event_id is null then
        raise exception 'EMAIL_SEND_FOLLOW_UP_DRAFT_SOURCE_INVALID';
      end if;

      select e.*
        into v_follow_up_source_event
        from public.opportunity_correspondence_events e
       where e.id = v_follow_up_draft.source_event_id
         and e.company_id = p_company_id
         and e.opportunity_id = p_opportunity_id
         and e.connection_id = v_source_thread.connection_id
         and e.provider_thread_id = v_source_thread.provider_thread_id
       for share;
      if not found or v_follow_up_source_event.provider_message_id is null then
        raise exception 'EMAIL_SEND_FOLLOW_UP_DRAFT_SOURCE_EVENT_INVALID';
      end if;
      if not p_sender_switched
         and p_in_reply_to is distinct from v_follow_up_source_event.provider_message_id then
        raise exception 'EMAIL_SEND_FOLLOW_UP_DRAFT_REPLY_MESSAGE_CONFLICT';
      end if;
    end if;
  end if;

  if p_signature_id is not null and not exists (
    select 1
      from public.email_signatures s
     where s.id = p_signature_id
       and s.company_id = p_company_id
       and s.connection_id = p_connection_id
       and s.active
       and s.content_hash = p_signature_content_hash
       and (s.scope_user_id is null or s.scope_user_id = p_actor_user_id)
  ) then
    raise exception 'EMAIL_SEND_SIGNATURE_INVALID';
  end if;
  if (p_signature_id is null) <> (p_signature_content_hash is null) then
    raise exception 'EMAIL_SEND_SIGNATURE_INVALID';
  end if;

  if p_pending_auto_send_id is not null and not exists (
    select 1
      from public.pending_auto_sends pas
     where pas.id = p_pending_auto_send_id
       and pas.company_id = p_company_id
       and pas.connection_id = p_connection_id
       and pas.opportunity_id = p_opportunity_id
       and (pas.draft_history_id is null or pas.draft_history_id = p_draft_history_id)
  ) then
    raise exception 'EMAIL_SEND_PENDING_AUTO_SEND_INVALID';
  end if;

  insert into public.email_send_intents (
    company_id,
    idempotency_key,
    request_fingerprint,
    actor_user_id,
    initiated_by,
    connection_id,
    opportunity_id,
    assignment_version,
    assignment_event_id,
    actor_name_snapshot,
    actor_email_snapshot,
    client_from_address_snapshot,
    source_email_thread_id,
    reply_provider_thread_id,
    in_reply_to,
    sender_switched,
    to_emails,
    cc_emails,
    subject,
    authored_body,
    rendered_body,
    content_type,
    draft_history_id,
    follow_up_draft_id,
    learning_authority,
    signature_id,
    signature_content_hash,
    rendered_body_hash,
    pending_auto_send_id,
    pending_auto_send_lease_token
    , profile_type_snapshot
  ) values (
    p_company_id,
    btrim(p_idempotency_key),
    p_request_fingerprint,
    p_actor_user_id,
    p_initiated_by,
    p_connection_id,
    p_opportunity_id,
    v_opportunity.assignment_version,
    v_assignment_event_id,
    btrim(concat_ws(' ', v_actor.first_name, v_actor.last_name)),
    coalesce(v_actor.email, ''),
    lower(v_connection.email),
    p_source_email_thread_id,
    p_reply_provider_thread_id,
    p_in_reply_to,
    coalesce(p_sender_switched, false),
    p_to_emails,
    coalesce(p_cc_emails, '{}'::text[]),
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
    , v_profile_type
  )
  on conflict (company_id, idempotency_key) do nothing;

  select i.*
    into v_intent
    from public.email_send_intents i
   where i.company_id = p_company_id
     and i.idempotency_key = btrim(p_idempotency_key)
   for update;

  if v_intent.actor_user_id <> p_actor_user_id
     or v_intent.connection_id <> p_connection_id
     or v_intent.opportunity_id <> p_opportunity_id then
    raise exception 'EMAIL_SEND_IDEMPOTENCY_CONFLICT';
  end if;

  if v_intent.request_fingerprint <> p_request_fingerprint then
    if p_pending_auto_send_id is null
       or v_intent.pending_auto_send_id is distinct from p_pending_auto_send_id
       or v_intent.initiated_by is distinct from p_initiated_by
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
       or v_intent.rendered_body_hash is distinct from p_rendered_body_hash then
      raise exception 'EMAIL_SEND_IDEMPOTENCY_CONFLICT';
    end if;

    -- A queue row can be safely reclaimed after its lease expires. Only an
    -- undelivered prepared intent may rebind to that new exact lease; every
    -- later state remains immutable and resumes without another provider call.
    if v_intent.status = 'prepared' then
      update public.email_send_intents i
         set request_fingerprint = p_request_fingerprint,
             pending_auto_send_lease_token = p_pending_auto_send_lease_token,
             updated_at = now()
       where i.id = v_intent.id
      returning i.* into v_intent;
    end if;
  end if;

  return v_intent;
end;
$$;

create or replace function public.claim_email_send_provider_delivery(
  p_intent_id uuid
)
returns public.email_send_intents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.email_send_intents%rowtype;
  v_actor public.users%rowtype;
  v_connection public.email_connections%rowtype;
  v_opportunity public.opportunities%rowtype;
  v_company public.companies%rowtype;
begin
  select i.* into v_intent
    from public.email_send_intents i
   where i.id = p_intent_id
   for update;
  if not found or v_intent.status <> 'prepared' then
    return null;
  end if;

  select u.* into v_actor
    from public.users u
   where u.id = v_intent.actor_user_id
     and u.company_id = v_intent.company_id
     and u.deleted_at is null
     and coalesce(u.is_active, false)
   for share;
  if not found then
    raise exception 'EMAIL_SEND_ACTOR_INVALID';
  end if;

  select c.* into v_connection
    from public.email_connections c
   where c.id = v_intent.connection_id
     and c.company_id = v_intent.company_id::text
     and c.status = 'active'
   for share;
  if not found
     or (
       v_connection.type::text = 'individual'
       and coalesce(v_connection.user_id, '') <> v_intent.actor_user_id::text
     )
     or (
       v_intent.initiated_by <> 'operator'
       and not coalesce(v_connection.agent_can_send_from, false)
     ) then
    raise exception 'EMAIL_SEND_CONNECTION_INVALID';
  end if;
  if v_intent.pending_auto_send_id is not null
     and (
       not coalesce(v_connection.sync_enabled, false)
       or coalesce(v_connection.auto_send_settings ->> 'enabled', 'false') <> 'true'
       or not exists (
         select 1
           from public.admin_feature_overrides afo
          where afo.company_id = v_intent.company_id::text
            and afo.feature_key = 'ai_auto_send'
            and afo.enabled
       )
     ) then
    raise exception 'EMAIL_SEND_AUTHORIZATION_STALE';
  end if;

  select o.* into v_opportunity
    from public.opportunities o
   where o.id = v_intent.opportunity_id
     and o.company_id = v_intent.company_id
     and o.deleted_at is null
     and o.assignment_version = v_intent.assignment_version
   for share;
  if not found then
    raise exception 'EMAIL_SEND_AUTHORIZATION_STALE';
  end if;

  if v_intent.pending_auto_send_id is not null then
    select company.* into v_company
      from public.companies company
     where company.id = v_intent.company_id
       and company.deleted_at is null
     for share;
    if not found
       or not private.email_company_subscription_active(
         v_company.subscription_status,
         v_company.subscription_plan,
         v_company.trial_end_date,
         clock_timestamp()
       ) then
      raise exception 'EMAIL_SEND_SUBSCRIPTION_INACTIVE';
    end if;
  end if;

  if not private.user_can_send_opportunity_inbox(
    v_intent.actor_user_id,
    v_intent.opportunity_id,
    v_intent.connection_id
  ) then
    raise exception 'EMAIL_SEND_AUTHORIZATION_STALE';
  end if;

  update public.email_send_intents i
     set status = 'sending',
         updated_at = now(),
         last_error = null
   where i.id = p_intent_id
     and i.status = 'prepared'
  returning i.* into v_intent;
  return v_intent;
end;
$$;

create or replace function public.mark_email_send_provider_accepted(
  p_intent_id uuid,
  p_provider_message_id text,
  p_provider_thread_id text,
  p_provider_accepted_at timestamptz
)
returns public.email_send_intents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.email_send_intents%rowtype;
begin
  if nullif(btrim(coalesce(p_provider_message_id, '')), '') is null
     or nullif(btrim(coalesce(p_provider_thread_id, '')), '') is null then
    raise exception 'EMAIL_SEND_PROVIDER_ID_INVALID';
  end if;

  select i.* into v_intent
    from public.email_send_intents i
   where i.id = p_intent_id
   for update;
  if not found then
    raise exception 'EMAIL_SEND_INTENT_NOT_FOUND';
  end if;

  if v_intent.status in ('provider_accepted', 'reconciling', 'reconciliation_failed', 'reconciled') then
    if v_intent.provider_message_id <> p_provider_message_id
       or v_intent.accepted_provider_thread_id <> p_provider_thread_id then
      raise exception 'EMAIL_SEND_PROVIDER_RESULT_CONFLICT';
    end if;
    return v_intent;
  end if;
  if v_intent.status not in ('sending', 'delivery_unknown') then
    raise exception 'EMAIL_SEND_PROVIDER_ACCEPTANCE_STATE_INVALID';
  end if;

  update public.email_send_intents i
     set status = 'provider_accepted',
         provider_message_id = p_provider_message_id,
         accepted_provider_thread_id = p_provider_thread_id,
         provider_accepted_at = p_provider_accepted_at,
         last_error = null,
         updated_at = now()
   where i.id = p_intent_id
  returning i.* into v_intent;
  return v_intent;
end;
$$;

create or replace function public.mark_email_send_provider_rejected(
  p_intent_id uuid,
  p_error text
)
returns public.email_send_intents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.email_send_intents%rowtype;
begin
  select i.* into v_intent
    from public.email_send_intents i
   where i.id = p_intent_id
   for update;
  if not found then
    raise exception 'EMAIL_SEND_INTENT_NOT_FOUND';
  end if;
  if v_intent.status = 'provider_rejected' then
    return v_intent;
  end if;
  if v_intent.status <> 'sending' then
    raise exception 'EMAIL_SEND_PROVIDER_REJECTION_STATE_INVALID';
  end if;

  update public.email_send_intents i
     set status = 'provider_rejected',
         last_error = left(coalesce(p_error, 'provider rejected send'), 4000),
         updated_at = now()
   where i.id = p_intent_id
  returning i.* into v_intent;
  return v_intent;
end;
$$;

create or replace function public.mark_email_send_delivery_unknown(
  p_intent_id uuid,
  p_error text
)
returns public.email_send_intents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.email_send_intents%rowtype;
begin
  select i.* into v_intent
    from public.email_send_intents i
   where i.id = p_intent_id
   for update;
  if not found then
    raise exception 'EMAIL_SEND_INTENT_NOT_FOUND';
  end if;
  if v_intent.status = 'delivery_unknown' then
    return v_intent;
  end if;
  if v_intent.status <> 'sending' then
    raise exception 'EMAIL_SEND_DELIVERY_UNKNOWN_STATE_INVALID';
  end if;

  update public.email_send_intents i
     set status = 'delivery_unknown',
         last_error = left(coalesce(p_error, 'provider result unknown'), 4000),
         updated_at = now()
   where i.id = p_intent_id
  returning i.* into v_intent;
  return v_intent;
end;
$$;

create or replace function public.claim_email_send_reconciliation(
  p_intent_id uuid
)
returns public.email_send_intents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.email_send_intents%rowtype;
begin
  with candidate as (
    select i.id
      from public.email_send_intents i
     where i.id = p_intent_id
       and i.reconciliation_attempts < i.max_reconciliation_attempts
       and (
         i.status in ('provider_accepted', 'reconciliation_failed')
         or (
           i.status = 'reconciling'
           and i.reconciliation_lease_expires_at <= now()
         )
       )
     for update skip locked
  )
  update public.email_send_intents i
     set status = 'reconciling',
         reconciliation_attempts = i.reconciliation_attempts + 1,
         reconciliation_lease_token = gen_random_uuid(),
         reconciliation_lease_expires_at = now() + interval '5 minutes',
         last_error = null,
         updated_at = now()
    from candidate
   where i.id = candidate.id
  returning i.* into v_intent;

  return v_intent;
end;
$$;

create or replace function public.claim_next_email_send_reconciliation(
  p_failed_before timestamptz,
  p_lease_seconds integer
)
returns public.email_send_intents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.email_send_intents%rowtype;
  v_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 300), 30), 900);
begin
  with candidate as (
    select i.id
      from public.email_send_intents i
     where i.reconciliation_attempts < i.max_reconciliation_attempts
       and (
         (
           i.status in ('provider_accepted', 'reconciliation_failed')
           and i.updated_at <= p_failed_before
         )
         or (
           i.status = 'reconciling'
           and i.reconciliation_lease_expires_at <= now()
         )
       )
     order by
       case
         when i.status = 'reconciling' then i.reconciliation_lease_expires_at
         else i.updated_at
       end,
       i.id
     limit 1
     for update skip locked
  )
  update public.email_send_intents i
     set status = 'reconciling',
         reconciliation_attempts = i.reconciliation_attempts + 1,
         reconciliation_lease_token = gen_random_uuid(),
         reconciliation_lease_expires_at = now() + make_interval(secs => v_lease_seconds),
         last_error = null,
         updated_at = now()
    from candidate
   where i.id = candidate.id
  returning i.* into v_intent;

  return v_intent;
end;
$$;

create or replace function public.complete_email_send_reconciliation(
  p_intent_id uuid,
  p_lease_token uuid,
  p_activity_id uuid
)
returns public.email_send_intents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.email_send_intents%rowtype;
begin
  update public.email_send_intents i
     set status = 'reconciled',
         reconciled_activity_id = p_activity_id,
         reconciled_at = now(),
         reconciliation_lease_token = null,
         reconciliation_lease_expires_at = null,
         last_error = null,
         updated_at = now()
   where i.id = p_intent_id
     and i.status = 'reconciling'
     and i.reconciliation_lease_token = p_lease_token
  returning i.* into v_intent;
  if not found then
    raise exception 'EMAIL_SEND_RECONCILIATION_LEASE_INVALID';
  end if;
  return v_intent;
end;
$$;

create or replace function public.fail_email_send_reconciliation(
  p_intent_id uuid,
  p_lease_token uuid,
  p_error text
)
returns public.email_send_intents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.email_send_intents%rowtype;
begin
  update public.email_send_intents i
     set status = 'reconciliation_failed',
         reconciliation_lease_token = null,
         reconciliation_lease_expires_at = null,
         last_error = left(coalesce(p_error, 'reconciliation failed'), 4000),
         updated_at = now()
   where i.id = p_intent_id
     and i.status = 'reconciling'
     and i.reconciliation_lease_token = p_lease_token
  returning i.* into v_intent;
  if not found then
    raise exception 'EMAIL_SEND_RECONCILIATION_LEASE_INVALID';
  end if;
  return v_intent;
end;
$$;

revoke all on function public.prepare_email_send_intent(text, text, uuid, uuid, text, uuid, uuid, uuid, text, text, boolean, text[], text[], text, text, text, text, uuid, uuid, text, uuid, text, text, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.prepare_email_send_intent(text, text, uuid, uuid, text, uuid, uuid, uuid, text, text, boolean, text[], text[], text, text, text, text, uuid, uuid, text, uuid, text, text, uuid, uuid) to service_role;

revoke all on function public.claim_email_send_provider_delivery(uuid) from public, anon, authenticated, service_role;
grant execute on function public.claim_email_send_provider_delivery(uuid) to service_role;

revoke all on function public.mark_email_send_provider_accepted(uuid, text, text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.mark_email_send_provider_accepted(uuid, text, text, timestamptz) to service_role;

revoke all on function public.mark_email_send_provider_rejected(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.mark_email_send_provider_rejected(uuid, text) to service_role;

revoke all on function public.mark_email_send_delivery_unknown(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.mark_email_send_delivery_unknown(uuid, text) to service_role;

revoke all on function public.claim_email_send_reconciliation(uuid) from public, anon, authenticated, service_role;
grant execute on function public.claim_email_send_reconciliation(uuid) to service_role;

revoke all on function public.claim_next_email_send_reconciliation(timestamptz, integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_next_email_send_reconciliation(timestamptz, integer) to service_role;

revoke all on function public.complete_email_send_reconciliation(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.complete_email_send_reconciliation(uuid, uuid, uuid) to service_role;

revoke all on function public.fail_email_send_reconciliation(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.fail_email_send_reconciliation(uuid, uuid, text) to service_role;

commit;
