begin;

-- A contact-form notification can create a lead before it has a human owner.
-- Provider drafting therefore cannot run in the ingestion transaction. This
-- queue rendezvouses the immutable assignment event with the exact inbound
-- activity and carries only canonical OPS UUID identity into the worker.
create table public.email_assignment_contact_form_draft_queue (
  id uuid primary key default gen_random_uuid(),
  assignment_event_id uuid not null
    references public.opportunity_assignment_events(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  opportunity_id uuid not null
    references public.opportunities(id) on delete restrict,
  assignment_version bigint not null check (assignment_version > 0),
  actor_user_id uuid not null references public.users(id) on delete restrict,
  connection_id uuid not null
    references public.email_connections(id) on delete restrict,
  source_activity_id uuid not null
    references public.activities(id) on delete restrict,
  provider_message_id text not null check (btrim(provider_message_id) <> ''),
  source_provider_thread_id text not null
    check (btrim(source_provider_thread_id) <> ''),
  customer_email text not null check (btrim(customer_email) <> ''),
  customer_name text,
  source_subject text not null,
  source_body_text text not null check (btrim(source_body_text) <> ''),
  draft_history_id uuid references public.ai_draft_history(id) on delete restrict,
  reused_from_draft_history_id uuid
    references public.ai_draft_history(id) on delete restrict,
  mailbox_draft_id text,
  outreach_provider_thread_id text,
  provider_create_attempt_id uuid,
  provider_create_started_at timestamptz,
  status text not null default 'pending' check (status in (
    'pending', 'processing', 'retrying', 'completed', 'skipped', 'failed', 'stale',
    'reconciliation_required'
  )),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_holder text,
  lease_expires_at timestamptz,
  prepared_at timestamptz,
  completed_at timestamptz,
  result_reason text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_event_id),
  unique (opportunity_id, assignment_version),
  constraint email_assignment_contact_form_draft_lease_shape check (
    (status = 'processing' and lease_holder is not null and lease_expires_at is not null)
    or
    (status <> 'processing' and lease_holder is null and lease_expires_at is null)
  ),
  constraint email_assignment_contact_form_draft_completion_shape check (
    (
      status = 'completed'
      and completed_at is not null
      and draft_history_id is not null
      and nullif(btrim(mailbox_draft_id), '') is not null
      and nullif(btrim(outreach_provider_thread_id), '') is not null
      and provider_create_attempt_id is not null
      and provider_create_started_at is not null
      and result_reason = 'drafted'
    )
    or (
      status = 'skipped'
      and completed_at is not null
      and mailbox_draft_id is null
      and outreach_provider_thread_id is null
      and result_reason in (
        'autonomy_ineligible',
        'draft_unavailable',
        'lead_terminal',
        'already_replied'
      )
    )
    or (
      status = 'reconciliation_required'
      and completed_at is not null
      and provider_create_attempt_id is not null
      and provider_create_started_at is not null
      and result_reason = 'provider_reconciliation_required'
    )
    or (
      status not in ('completed', 'skipped', 'reconciliation_required')
      and completed_at is null
      and result_reason is null
    )
  )
);

create index email_assignment_contact_form_draft_due_idx
  on public.email_assignment_contact_form_draft_queue (
    available_at, created_at, id
  )
  where status in ('pending', 'retrying', 'processing');

create index email_assignment_contact_form_draft_opportunity_idx
  on public.email_assignment_contact_form_draft_queue (
    opportunity_id, assignment_version desc
  );

alter table public.email_assignment_contact_form_draft_queue
  enable row level security;
revoke all on table public.email_assignment_contact_form_draft_queue
  from public, anon, authenticated, service_role;

comment on table public.email_assignment_contact_form_draft_queue is
  'Service-only, assignment-versioned review-draft work for message-scoped contact-form leads. It never sends email.';

-- A generated first-reply draft becomes redundant as soon as OPS has already
-- answered the customer. Correspondence is the canonical proof, while the raw
-- activity check closes the short projection gap between outbound persistence
-- and correspondence-event materialization.
create or replace function private.email_assignment_contact_form_draft_has_reply(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_connection_id uuid,
  p_source_occurred_at timestamptz,
  p_customer_email text
) returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    p_company_id is null
    or p_opportunity_id is null
    or p_connection_id is null
    or p_source_occurred_at is null
    or nullif(lower(btrim(coalesce(p_customer_email, ''))), '') is null
    or exists (
      select 1
      from public.opportunity_correspondence_events reply
      where reply.company_id = p_company_id
        and reply.opportunity_id = p_opportunity_id
        and reply.direction = 'outbound'
        and reply.party_role = 'ops'
        and reply.is_meaningful
        and reply.occurred_at > p_source_occurred_at
        and exists (
          select 1
          from unnest(reply.to_emails || reply.cc_emails) recipient(email)
          where lower(btrim(recipient.email)) =
            lower(btrim(p_customer_email))
        )
    )
    or exists (
      select 1
      from public.activities reply_activity
      where reply_activity.company_id = p_company_id
        and reply_activity.opportunity_id = p_opportunity_id
        and reply_activity.type = 'email'
        and reply_activity.direction = 'outbound'
        and reply_activity.created_at > p_source_occurred_at
        and nullif(btrim(coalesce(reply_activity.email_message_id, '')), '')
          is not null
        and nullif(btrim(coalesce(reply_activity.body_text, '')), '') is not null
        and exists (
          select 1
          from unnest(
            coalesce(reply_activity.to_emails, '{}'::text[]) ||
            coalesce(reply_activity.cc_emails, '{}'::text[])
          ) recipient(email)
          where lower(btrim(recipient.email)) =
            lower(btrim(p_customer_email))
        )
    );
$function$;

revoke all on function private.email_assignment_contact_form_draft_has_reply(
  uuid,
  uuid,
  uuid,
  timestamptz,
  text
) from public, anon, authenticated, service_role;

-- A reassignment may inherit one exact OPS-owned provider draft, but it may
-- never infer a draft from provider content or create beside an unresolved
-- provider attempt. This server-derived state is re-checked at claim, at the
-- durable provider boundary, and after provider acceptance.
create or replace function private.email_assignment_contact_form_draft_prior_placement(
  p_queue_id uuid
) returns table (
  disposition text,
  prior_draft_history_id uuid,
  mailbox_draft_id text,
  provider_thread_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  queue public.email_assignment_contact_form_draft_queue%rowtype;
  prior public.email_assignment_contact_form_draft_queue%rowtype;
  active_draft public.ai_draft_history%rowtype;
  v_has_prior_completed boolean := false;
  v_active_count integer := 0;
begin
  select work.* into queue
  from public.email_assignment_contact_form_draft_queue work
  where work.id = p_queue_id;
  if not found then
    return query select 'blocked_missing_queue'::text, null::uuid, null::text, null::text;
    return;
  end if;

  if exists (
    select 1
    from public.email_assignment_contact_form_draft_queue prior
    where prior.company_id = queue.company_id
      and prior.opportunity_id = queue.opportunity_id
      and prior.id <> queue.id
      and prior.assignment_version <> queue.assignment_version
      and prior.provider_create_started_at is not null
      and prior.status <> 'completed'
  ) then
    return query select 'blocked_unresolved'::text, null::uuid, null::text, null::text;
    return;
  end if;

  select previous.* into prior
  from public.email_assignment_contact_form_draft_queue previous
  where previous.company_id = queue.company_id
    and previous.opportunity_id = queue.opportunity_id
    and previous.id <> queue.id
    and previous.assignment_version <> queue.assignment_version
    and previous.status = 'completed'
  order by previous.assignment_version desc, previous.created_at desc, previous.id desc
  limit 1;
  v_has_prior_completed := found;

  select count(*)::integer into v_active_count
  from public.ai_draft_history draft
  where draft.company_id = queue.company_id
    and draft.connection_id = queue.connection_id
    and draft.opportunity_id = queue.opportunity_id
    and draft.origin = 'phase_c'
    and draft.status = 'auto_drafted'
    and nullif(btrim(coalesce(draft.mailbox_draft_id, '')), '') is not null
    and nullif(btrim(coalesce(draft.thread_id, '')), '') is not null;

  if v_active_count > 1 then
    return query select 'blocked_ambiguous'::text, null::uuid, null::text, null::text;
    return;
  end if;

  if v_active_count = 1 then
    select draft.* into active_draft
    from public.ai_draft_history draft
    where draft.company_id = queue.company_id
      and draft.connection_id = queue.connection_id
      and draft.opportunity_id = queue.opportunity_id
      and draft.origin = 'phase_c'
      and draft.status = 'auto_drafted'
      and nullif(btrim(coalesce(draft.mailbox_draft_id, '')), '') is not null
      and nullif(btrim(coalesce(draft.thread_id, '')), '') is not null;
  end if;

  if v_has_prior_completed and (
    prior.connection_id <> queue.connection_id
    or v_active_count <> 1
    or active_draft.id <> prior.draft_history_id
    or active_draft.mailbox_draft_id <> prior.mailbox_draft_id
    or active_draft.thread_id <> prior.outreach_provider_thread_id
  ) then
    return query select
      'blocked_prior_unconfirmed'::text,
      null::uuid,
      null::text,
      null::text;
    return;
  end if;

  if v_active_count = 1 then
    return query select
      'update'::text,
      active_draft.id,
      btrim(active_draft.mailbox_draft_id),
      btrim(active_draft.thread_id);
    return;
  end if;

  return query select 'create'::text, null::uuid, null::text, null::text;
end;
$function$;

revoke all on function private.email_assignment_contact_form_draft_prior_placement(uuid)
  from public, anon, authenticated, service_role;

-- Base authorization excludes Phase C autonomy so a temporarily-disabled
-- category or permission can remain safely pending. The reauthorization RPC
-- optionally adds the exact primary:CUSTOMER gate at the provider boundary.
create or replace function private.email_assignment_contact_form_draft_authorized(
  p_queue_id uuid,
  p_require_customer_autonomy boolean
) returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.email_assignment_contact_form_draft_queue queue
    join public.opportunity_assignment_events event
      on queue.assignment_event_id = event.id
     and queue.company_id = event.company_id
     and queue.opportunity_id = event.opportunity_id
     and queue.assignment_version = event.assignment_version
     and queue.actor_user_id = event.new_assignee_id
    join public.opportunities opportunity
      on opportunity.id = queue.opportunity_id
     and opportunity.company_id = queue.company_id
     and opportunity.assigned_to = queue.actor_user_id
     and queue.assignment_version = opportunity.assignment_version
     and opportunity.deleted_at is null
     and opportunity.archived_at is null
     and opportunity.stage not in ('won', 'lost', 'discarded')
     and opportunity.source::text = 'email'
    join public.users user_row
      on user_row.id = queue.actor_user_id
     and user_row.company_id = queue.company_id
     and user_row.deleted_at is null
     and coalesce(user_row.is_active, false)
    join public.email_connections connection
      on queue.connection_id = connection.id
     and connection.company_id = queue.company_id::text
     and connection.status = 'active'
     and coalesce(connection.sync_enabled, false)
     and connection.type::text in ('company', 'individual')
    join public.activities activity
      on queue.source_activity_id = activity.id
     and activity.company_id = queue.company_id
     and activity.opportunity_id = opportunity.id
     and activity.email_connection_id = connection.id
     and activity.email_message_id = queue.provider_message_id
     and activity.email_thread_id = queue.source_provider_thread_id
     and activity.type = 'email'
     and activity.direction = 'inbound'
     and not coalesce(activity.match_needs_review, false)
     and lower(btrim(coalesce(activity.from_email, ''))) =
       lower(btrim(queue.customer_email))
     and coalesce(activity.subject, '') = queue.source_subject
     and activity.body_text = queue.source_body_text
     and nullif(btrim(coalesce(activity.body_text, '')), '') is not null
    left join public.clients client
      on client.id = coalesce(opportunity.client_ref, opportunity.client_id)
     and client.company_id = queue.company_id
     and client.deleted_at is null
    where queue.id = p_queue_id
      and event.new_assignee_id is not null
      and event.new_assignee_id = queue.actor_user_id
      and opportunity.source_thread_key =
        'email:' || lower(connection.provider::text) || ':' ||
        connection.id::text || ':message:' || queue.provider_message_id
      and (
        lower(btrim(coalesce(opportunity.contact_email, ''))) =
          lower(btrim(queue.customer_email))
        or lower(btrim(coalesce(client.email, ''))) =
          lower(btrim(queue.customer_email))
      )
      and private.user_can_send_opportunity_inbox(
        queue.actor_user_id,
        opportunity.id,
        connection.id
      )
      and not private.email_assignment_contact_form_draft_has_reply(
        queue.company_id,
        queue.opportunity_id,
        queue.connection_id,
        activity.created_at,
        queue.customer_email
      )
      and (
        not p_require_customer_autonomy
        or coalesce(
          connection.auto_send_settings
            -> 'category_autonomy'
            ->> 'primary:customer',
          'off'
        ) in ('auto_draft', 'auto_send', 'auto_follow_up')
      )
  );
$function$;

revoke all on function private.email_assignment_contact_form_draft_authorized(uuid, boolean)
  from public, anon, authenticated, service_role;

create or replace function private.enqueue_email_assignment_contact_form_draft(
  p_assignment_event_id uuid,
  p_source_activity_id uuid default null
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  event public.opportunity_assignment_events%rowtype;
  opportunity public.opportunities%rowtype;
  activity public.activities%rowtype;
  connection public.email_connections%rowtype;
  client public.clients%rowtype;
  user_row public.users%rowtype;
  v_match text[];
  v_connection_id uuid;
  v_provider_message_id text;
  v_actor_user_id uuid;
  v_customer_email text;
  v_customer_name text;
begin
  select assignment_event.* into event
  from public.opportunity_assignment_events assignment_event
  where assignment_event.id = p_assignment_event_id;
  if not found or event.new_assignee_id is null then
    return;
  end if;

  v_actor_user_id := event.new_assignee_id;

  select opportunity_row.* into opportunity
  from public.opportunities opportunity_row
  where opportunity_row.id = event.opportunity_id
    and opportunity_row.company_id = event.company_id
    and opportunity_row.assigned_to = event.new_assignee_id
    and opportunity_row.assignment_version = event.assignment_version
    and opportunity_row.deleted_at is null
    and opportunity_row.archived_at is null
    and opportunity_row.stage not in ('won', 'lost', 'discarded')
    and opportunity_row.source::text = 'email';
  if not found then
    return;
  end if;

  -- Only a verified current event may invalidate prior work. This ordering is
  -- load-bearing for migration backfill, which necessarily replays historical
  -- immutable assignment events in addition to the current one.
  update public.email_assignment_contact_form_draft_queue queue
     set status = case
           when queue.provider_create_started_at is not null then
             'reconciliation_required'
           else 'stale'
         end,
         lease_holder = null,
         lease_expires_at = null,
         completed_at = case
           when queue.provider_create_started_at is not null then now()
           else null
         end,
         result_reason = case
           when queue.provider_create_started_at is not null then
             'provider_reconciliation_required'
           else null
         end,
         last_error = 'assignment superseded',
         updated_at = now()
   where queue.opportunity_id = event.opportunity_id
     and queue.assignment_version <> event.assignment_version
     and queue.status in ('pending', 'processing', 'retrying');

  if opportunity.source_thread_key is null
     or opportunity.source_thread_key !~
       '^email:[^:]+:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}:message:.+$'
  then
    return;
  end if;
  v_match := regexp_match(
    opportunity.source_thread_key,
    '^email:([^:]+):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89ab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}):message:(.+)$'
  );
  if v_match is null or array_length(v_match, 1) <> 3 then
    return;
  end if;
  v_connection_id := v_match[2]::uuid;
  v_provider_message_id := btrim(v_match[3]);

  select connection_row.* into connection
  from public.email_connections connection_row
  where connection_row.id = v_connection_id
    and connection_row.company_id = opportunity.company_id::text
    and lower(connection_row.provider::text) = lower(v_match[1])
    and connection_row.status = 'active'
    and coalesce(connection_row.sync_enabled, false)
    and connection_row.type::text in ('company', 'individual');
  if not found then
    return;
  end if;

  select user_record.* into user_row
  from public.users user_record
  where user_record.id = v_actor_user_id
    and user_record.company_id = opportunity.company_id
    and user_record.deleted_at is null
    and coalesce(user_record.is_active, false);
  if not found then
    return;
  end if;

  -- Company connector user_id is intentionally ignored. Only an individual
  -- mailbox's canonical owner may transport a draft for that same assignee.
  if connection.type::text = 'individual'
     and connection.user_id <> v_actor_user_id::text then
    return;
  elsif connection.type::text <> 'company'
     and connection.type::text <> 'individual' then
    return;
  end if;

  select activity_row.* into activity
  from public.activities activity_row
  where (p_source_activity_id is null or activity_row.id = p_source_activity_id)
    and activity_row.company_id = opportunity.company_id
    and activity_row.opportunity_id = opportunity.id
    and activity_row.email_connection_id = v_connection_id
    and activity_row.email_message_id = v_provider_message_id
    and activity_row.type = 'email'
    and activity_row.direction = 'inbound'
    and not coalesce(activity_row.match_needs_review, false)
    and nullif(btrim(coalesce(activity_row.email_thread_id, '')), '') is not null
    and nullif(btrim(coalesce(activity_row.from_email, '')), '') is not null
    and nullif(btrim(coalesce(activity_row.body_text, '')), '') is not null
  order by activity_row.created_at asc, activity_row.id asc
  limit 1;
  if not found then
    return;
  end if;

  select client_row.* into client
  from public.clients client_row
  where client_row.id = coalesce(opportunity.client_ref, opportunity.client_id)
    and client_row.company_id = opportunity.company_id
    and client_row.deleted_at is null;

  v_customer_email := lower(btrim(activity.from_email));
  if v_customer_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or not (
       lower(btrim(coalesce(opportunity.contact_email, ''))) = v_customer_email
       or lower(btrim(coalesce(client.email, ''))) = v_customer_email
     ) then
    return;
  end if;
  v_customer_name := coalesce(
    nullif(btrim(opportunity.contact_name), ''),
    nullif(btrim(client.name), '')
  );
  if private.email_assignment_contact_form_draft_has_reply(
    opportunity.company_id,
    opportunity.id,
    connection.id,
    activity.created_at,
    v_customer_email
  ) then
    return;
  end if;

  insert into public.email_assignment_contact_form_draft_queue (
    assignment_event_id,
    company_id,
    opportunity_id,
    assignment_version,
    actor_user_id,
    connection_id,
    source_activity_id,
    provider_message_id,
    source_provider_thread_id,
    customer_email,
    customer_name,
    source_subject,
    source_body_text
  ) values (
    event.id,
    opportunity.company_id,
    opportunity.id,
    event.assignment_version,
    v_actor_user_id,
    connection.id,
    activity.id,
    v_provider_message_id,
    btrim(activity.email_thread_id),
    v_customer_email,
    v_customer_name,
    coalesce(activity.subject, ''),
    activity.body_text
  )
  on conflict (assignment_event_id) do nothing;
end;
$function$;

revoke all on function private.enqueue_email_assignment_contact_form_draft(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.queue_email_assignment_contact_form_draft_from_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.new_assignee_id is not null then
    perform private.enqueue_email_assignment_contact_form_draft(new.id, null);
  end if;
  return new;
end;
$function$;

revoke all on function private.queue_email_assignment_contact_form_draft_from_assignment()
  from public, anon, authenticated, service_role;

drop trigger if exists opportunity_assignment_contact_form_draft_queue
  on public.opportunity_assignment_events;
create trigger opportunity_assignment_contact_form_draft_queue
after insert on public.opportunity_assignment_events
for each row
execute function private.queue_email_assignment_contact_form_draft_from_assignment();

create or replace function private.queue_email_assignment_contact_form_draft_from_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_assignment_event_id uuid;
begin
  if new.type <> 'email'
     or new.direction <> 'inbound'
     or new.opportunity_id is null
     or new.email_connection_id is null
     or nullif(btrim(coalesce(new.email_message_id, '')), '') is null then
    return new;
  end if;

  select assignment_event.id into v_assignment_event_id
  from public.opportunities opportunity
  join public.opportunity_assignment_events assignment_event
    on assignment_event.opportunity_id = opportunity.id
   and assignment_event.company_id = opportunity.company_id
   and assignment_event.assignment_version = opportunity.assignment_version
   and assignment_event.new_assignee_id = opportunity.assigned_to
  where opportunity.id = new.opportunity_id
    and opportunity.assigned_to is not null
    and opportunity.deleted_at is null;

  if v_assignment_event_id is not null then
    perform private.enqueue_email_assignment_contact_form_draft(
      v_assignment_event_id,
      new.id
    );
  end if;
  return new;
end;
$function$;

revoke all on function private.queue_email_assignment_contact_form_draft_from_activity()
  from public, anon, authenticated, service_role;

drop trigger if exists activities_assignment_contact_form_draft_queue
  on public.activities;
create trigger activities_assignment_contact_form_draft_queue
after insert on public.activities
for each row
execute function private.queue_email_assignment_contact_form_draft_from_activity();

create or replace function public.claim_email_assignment_contact_form_drafts(
  p_holder text,
  p_limit integer,
  p_lease_seconds integer
) returns table (
  id uuid,
  assignment_event_id uuid,
  company_id uuid,
  opportunity_id uuid,
  assignment_version bigint,
  actor_user_id uuid,
  connection_id uuid,
  source_activity_id uuid,
  provider_message_id text,
  source_provider_thread_id text,
  customer_email text,
  customer_name text,
  source_subject text,
  source_body_text text,
  created_at timestamptz,
  attempts integer,
  draft_history_id uuid,
  draft_body text,
  draft_subject text
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_holder, '')), '') is null
     or p_limit is null or p_limit < 1 or p_limit > 25
     or p_lease_seconds is null or p_lease_seconds < 60 or p_lease_seconds > 900
  then
    raise exception 'invalid_contact_form_draft_claim' using errcode = '22023';
  end if;

  -- Once a provider-create attempt is durable, an expired lease is never safe
  -- to replay. The provider may have accepted the draft before the worker lost
  -- its response, so only a human reconciliation may resolve the ambiguity.
  update public.email_assignment_contact_form_draft_queue queue
     set status = 'reconciliation_required',
         completed_at = now(),
         result_reason = 'provider_reconciliation_required',
         lease_holder = null,
         lease_expires_at = null,
         last_error = coalesce(
           queue.last_error,
           'provider create attempt expired before reconciliation'
         ),
         updated_at = now()
   where queue.status = 'processing'
     and queue.provider_create_started_at is not null
     and queue.lease_expires_at <= clock_timestamp();

  -- A terminal lead or an already-answered customer must never receive a
  -- retroactive first-reply draft. These are deterministic terminal skips as
  -- long as no provider-create attempt has begun.
  update public.email_assignment_contact_form_draft_queue queue
     set status = 'skipped',
         completed_at = now(),
         result_reason = case
           when opportunity.deleted_at is not null
             or opportunity.archived_at is not null
             or opportunity.stage in ('won', 'lost', 'discarded')
             then 'lead_terminal'
           else 'already_replied'
         end,
         lease_holder = null,
         lease_expires_at = null,
         last_error = null,
         updated_at = now()
    from public.opportunities opportunity,
         public.activities activity
   where queue.status in ('pending', 'processing', 'retrying')
     and queue.provider_create_started_at is null
     and opportunity.id = queue.opportunity_id
     and opportunity.company_id = queue.company_id
     and activity.id = queue.source_activity_id
     and activity.company_id = queue.company_id
     and (
       opportunity.deleted_at is not null
       or opportunity.archived_at is not null
       or opportunity.stage in ('won', 'lost', 'discarded')
       or private.email_assignment_contact_form_draft_has_reply(
         queue.company_id,
         queue.opportunity_id,
         queue.connection_id,
         activity.created_at,
         queue.customer_email
       )
     );

  -- Assignment changes are terminal for the old version. Permission or
  -- mailbox outages are not: they remain safely pending for a future claim.
  update public.email_assignment_contact_form_draft_queue queue
     set status = case
           when queue.provider_create_started_at is not null then
             'reconciliation_required'
           else 'stale'
         end,
         lease_holder = null,
         lease_expires_at = null,
         completed_at = case
           when queue.provider_create_started_at is not null then now()
           else null
         end,
         result_reason = case
           when queue.provider_create_started_at is not null then
             'provider_reconciliation_required'
           else null
         end,
         last_error = 'assignment stale before claim',
         updated_at = now()
   where queue.status in ('pending', 'processing', 'retrying')
     and not exists (
       select 1
       from public.opportunities opportunity
       join public.opportunity_assignment_events event
         on event.id = queue.assignment_event_id
        and event.opportunity_id = opportunity.id
        and event.assignment_version = opportunity.assignment_version
        and event.new_assignee_id = opportunity.assigned_to
       where opportunity.id = queue.opportunity_id
         and opportunity.company_id = queue.company_id
         and opportunity.assigned_to = queue.actor_user_id
         and opportunity.assignment_version = queue.assignment_version
         and opportunity.deleted_at is null
     );

  return query
  with candidate as (
    select queue.id
    from public.email_assignment_contact_form_draft_queue queue
    cross join lateral private.email_assignment_contact_form_draft_prior_placement(
      queue.id
    ) prior_placement
    where (
        queue.status in ('pending', 'retrying')
        or (
          queue.status = 'processing'
          and queue.lease_expires_at <= clock_timestamp()
        )
      )
      and queue.available_at <= clock_timestamp()
      and queue.provider_create_started_at is null
      and prior_placement.disposition in ('create', 'update')
      and private.email_assignment_contact_form_draft_authorized(
        queue.id,
        false
      )
    order by queue.available_at, queue.created_at, queue.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.email_assignment_contact_form_draft_queue queue
       set status = 'processing',
           attempts = queue.attempts + 1,
           lease_holder = btrim(p_holder),
           lease_expires_at =
             clock_timestamp() + make_interval(secs => p_lease_seconds),
           last_error = null,
           updated_at = now()
      from candidate
     where queue.id = candidate.id
    returning queue.*
  )
  select
    claimed.id,
    claimed.assignment_event_id,
    claimed.company_id,
    claimed.opportunity_id,
    claimed.assignment_version,
    claimed.actor_user_id,
    claimed.connection_id,
    claimed.source_activity_id,
    claimed.provider_message_id,
    claimed.source_provider_thread_id,
    claimed.customer_email,
    claimed.customer_name,
    claimed.source_subject,
    claimed.source_body_text,
    claimed.created_at,
    claimed.attempts,
    claimed.draft_history_id,
    draft.original_draft,
    draft.subject
  from claimed
  left join public.ai_draft_history draft
    on draft.id = claimed.draft_history_id;
end;
$function$;

revoke all on function public.claim_email_assignment_contact_form_drafts(text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_email_assignment_contact_form_drafts(text, integer, integer)
  to service_role;

create or replace function public.prepare_email_assignment_contact_form_draft_as_system(
  p_queue_id uuid,
  p_holder text,
  p_draft_history_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  queue public.email_assignment_contact_form_draft_queue%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select work.* into queue
  from public.email_assignment_contact_form_draft_queue work
  where work.id = p_queue_id
    and work.status = 'processing'
    and work.lease_holder = btrim(p_holder)
    and work.lease_expires_at > clock_timestamp()
    and work.provider_create_started_at is null
  for update;
  if not found
     or not private.email_assignment_contact_form_draft_authorized(
       p_queue_id,
       false
     ) then
    return false;
  end if;
  if queue.draft_history_id is not null then
    return queue.draft_history_id = p_draft_history_id;
  end if;
  if not exists (
    select 1
    from public.ai_draft_history draft
    where draft.id = p_draft_history_id
      and draft.company_id = queue.company_id
      and draft.user_id = queue.actor_user_id
      and draft.connection_id = queue.connection_id
      and draft.opportunity_id = queue.opportunity_id
      and draft.thread_id is null
      and draft.source_message_id is null
      and draft.origin = 'phase_c'
      and draft.status = 'drafted'
      and nullif(btrim(draft.original_draft), '') is not null
  ) then
    return false;
  end if;

  update public.email_assignment_contact_form_draft_queue work
     set draft_history_id = p_draft_history_id,
         prepared_at = now(),
         updated_at = now()
   where work.id = p_queue_id;
  return true;
end;
$function$;

revoke all on function public.prepare_email_assignment_contact_form_draft_as_system(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.prepare_email_assignment_contact_form_draft_as_system(uuid, text, uuid)
  to service_role;

create or replace function public.reauthorize_email_assignment_contact_form_draft_as_system(
  p_queue_id uuid,
  p_holder text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_queue_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select queue.id into v_queue_id
  from public.email_assignment_contact_form_draft_queue queue
  where queue.id = p_queue_id
    and queue.status = 'processing'
    and queue.lease_holder = btrim(p_holder)
    and queue.lease_expires_at > clock_timestamp()
    and queue.provider_create_started_at is null
  for update;
  if not found then
    return false;
  end if;
  return private.email_assignment_contact_form_draft_authorized(
    p_queue_id,
    true
  );
end;
$function$;

revoke all on function public.reauthorize_email_assignment_contact_form_draft_as_system(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reauthorize_email_assignment_contact_form_draft_as_system(uuid, text)
  to service_role;

-- Reconciliation notices carry no lead or customer details. For an individual
-- mailbox, the exact active OPS owner is the only person who can inspect its
-- Drafts folder. A company-mailbox notice goes to an active integrations
-- manager who can act on the linked settings route; the legacy connector
-- user_id is deliberately never consulted.
create or replace function private.notify_email_assignment_contact_form_draft_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_connection public.email_connections%rowtype;
  v_recipient_user_id uuid;
  v_dedupe_key text;
  v_action_url text;
  v_action_label text;
begin
  if new.status <> 'reconciliation_required'
     or old.status = 'reconciliation_required' then
    return new;
  end if;

  select connection.* into v_connection
  from public.email_connections connection
  where connection.id = new.connection_id
    and connection.company_id = new.company_id::text;
  if not found then
    return new;
  end if;

  if v_connection.type::text = 'individual' then
    select user_row.id into v_recipient_user_id
    from public.users user_row
    where user_row.id::text = v_connection.user_id
      and user_row.company_id = new.company_id
      and user_row.deleted_at is null
      and coalesce(user_row.is_active, false)
    order by user_row.id
    limit 1;
    -- The personal-mailbox owner is the only safe reconciliation authority,
    -- but the OPS settings surface can be permission-gated. The notice itself
    -- therefore tells the owner to inspect their provider Drafts folder without
    -- linking them to a route they may not be authorized to open.
    v_action_url := null;
    v_action_label := null;
  elsif v_connection.type::text = 'company' then
    v_action_url := '/settings?tab=integrations';
    v_action_label := 'Review mailbox';
    for v_recipient_user_id in
      select user_row.id
      from public.users user_row
      where user_row.company_id = new.company_id
        and user_row.deleted_at is null
        and coalesce(user_row.is_active, false)
        and public.has_permission(
          user_row.id,
          'settings.integrations',
          'all'
        )
      order by user_row.id
    loop
      v_dedupe_key :=
        'email-assignment-draft-reconciliation:' || new.id::text;
      if not exists (
        select 1
        from public.notifications notification
        where notification.user_id = v_recipient_user_id::text
          and notification.company_id = new.company_id::text
          and notification.type = 'system'
          and notification.dedupe_key = v_dedupe_key
      ) then
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
          dedupe_key
        ) values (
          v_recipient_user_id::text,
          new.company_id::text,
          'system',
          'Draft placement needs review',
          'OPS could not confirm one mailbox draft. Check Drafts before creating another.',
          false,
          true,
          v_action_url,
          v_action_label,
          v_dedupe_key
        )
        on conflict do nothing;
      end if;
    end loop;
    return new;
  end if;

  if v_recipient_user_id is null then
    return new;
  end if;

  v_dedupe_key :=
    'email-assignment-draft-reconciliation:' || new.id::text;
  if exists (
    select 1
    from public.notifications notification
    where notification.user_id = v_recipient_user_id::text
      and notification.company_id = new.company_id::text
      and notification.type = 'system'
      and notification.dedupe_key = v_dedupe_key
  ) then
    return new;
  end if;

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
    dedupe_key
  ) values (
    v_recipient_user_id::text,
    new.company_id::text,
    'system',
    'Draft placement needs review',
    'OPS could not confirm one mailbox draft. Check Drafts before creating another.',
    false,
    true,
    v_action_url,
    v_action_label,
    v_dedupe_key
  )
  on conflict do nothing;

  return new;
end;
$function$;

revoke all on function private.notify_email_assignment_contact_form_draft_reconciliation()
  from public, anon, authenticated, service_role;

drop trigger if exists email_assignment_contact_form_draft_reconciliation_notification
  on public.email_assignment_contact_form_draft_queue;
create trigger email_assignment_contact_form_draft_reconciliation_notification
after update of status on public.email_assignment_contact_form_draft_queue
for each row
execute function private.notify_email_assignment_contact_form_draft_reconciliation();

-- Persist the one-shot provider-create attempt before touching the mailbox.
-- Seeing an existing attempt can only mean the prior worker may have crossed
-- the provider boundary, so it transitions to manual reconciliation and never
-- returns an id that could be replayed.
create or replace function public.begin_email_assignment_contact_form_draft_provider_create_as_system(
  p_queue_id uuid,
  p_holder text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  queue public.email_assignment_contact_form_draft_queue%rowtype;
  v_prior_placement record;
  v_opportunity_id uuid;
  v_provider_create_attempt_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_queue_id is null
     or nullif(btrim(coalesce(p_holder, '')), '') is null then
    raise exception 'invalid_contact_form_draft_provider_create'
      using errcode = '22023';
  end if;

  select opportunity.id into v_opportunity_id
  from public.email_assignment_contact_form_draft_queue work
  join public.opportunities opportunity
    on opportunity.id = work.opportunity_id
  where work.id = p_queue_id
  for update of opportunity;
  if not found then
    return null;
  end if;

  select work.* into queue
  from public.email_assignment_contact_form_draft_queue work
  where work.id = p_queue_id
  for update;
  if not found then
    return null;
  end if;
  if queue.status = 'reconciliation_required' then
    return null;
  end if;
  if queue.status <> 'processing'
     or queue.lease_holder <> btrim(p_holder)
     or queue.lease_expires_at <= clock_timestamp()
     or queue.draft_history_id is null
     or queue.prepared_at is null
     or not private.email_assignment_contact_form_draft_authorized(
       p_queue_id,
       true
     ) then
    return null;
  end if;

  if queue.provider_create_attempt_id is not null
     or queue.provider_create_started_at is not null then
    update public.email_assignment_contact_form_draft_queue work
       set status = 'reconciliation_required',
           completed_at = now(),
           result_reason = 'provider_reconciliation_required',
           lease_holder = null,
           lease_expires_at = null,
           last_error = coalesce(
             work.last_error,
             'provider create attempt already existed'
           ),
           updated_at = now()
     where work.id = p_queue_id;
    return null;
  end if;

  select prior_placement.* into v_prior_placement
  from private.email_assignment_contact_form_draft_prior_placement(
    p_queue_id
  ) prior_placement;
  if not found
     or v_prior_placement.disposition not in ('create', 'update') then
    raise exception 'contact_form_draft_prior_placement_blocked:%',
      coalesce(v_prior_placement.disposition, 'missing')
      using errcode = '55000';
  end if;

  v_provider_create_attempt_id := gen_random_uuid();
  update public.email_assignment_contact_form_draft_queue work
     set provider_create_attempt_id = v_provider_create_attempt_id,
         provider_create_started_at = clock_timestamp(),
         reused_from_draft_history_id = case
           when v_prior_placement.disposition = 'update'
             then v_prior_placement.prior_draft_history_id
           else null
         end,
         updated_at = now()
   where work.id = p_queue_id;
  return jsonb_strip_nulls(jsonb_build_object(
    'attempt_id', v_provider_create_attempt_id,
    'mode', v_prior_placement.disposition,
    'prior_draft_history_id', v_prior_placement.prior_draft_history_id,
    'mailbox_draft_id', v_prior_placement.mailbox_draft_id,
    'provider_thread_id', v_prior_placement.provider_thread_id
  ));
end;
$function$;

revoke all on function public.begin_email_assignment_contact_form_draft_provider_create_as_system(
  uuid,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.begin_email_assignment_contact_form_draft_provider_create_as_system(
  uuid,
  text
) to service_role;

create or replace function public.mark_email_assignment_contact_form_draft_reconciliation_required_as_system(
  p_queue_id uuid,
  p_holder text,
  p_provider_create_attempt_id uuid,
  p_mailbox_draft_id text,
  p_provider_thread_id text,
  p_error text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  queue public.email_assignment_contact_form_draft_queue%rowtype;
  v_mailbox_draft_id text := nullif(btrim(coalesce(p_mailbox_draft_id, '')), '');
  v_provider_thread_id text := nullif(btrim(coalesce(p_provider_thread_id, '')), '');
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_queue_id is null
     or nullif(btrim(coalesce(p_holder, '')), '') is null
     or p_provider_create_attempt_id is null then
    raise exception 'invalid_contact_form_draft_reconciliation'
      using errcode = '22023';
  end if;

  select work.* into queue
  from public.email_assignment_contact_form_draft_queue work
  where work.id = p_queue_id
  for update;
  if not found then
    return false;
  end if;

  if queue.status = 'reconciliation_required' then
    if queue.provider_create_attempt_id <> p_provider_create_attempt_id
       or (
         v_mailbox_draft_id is not null
         and queue.mailbox_draft_id is not null
         and queue.mailbox_draft_id <> v_mailbox_draft_id
       )
       or (
         v_provider_thread_id is not null
         and queue.outreach_provider_thread_id is not null
         and queue.outreach_provider_thread_id <> v_provider_thread_id
       ) then
      return false;
    end if;
    update public.email_assignment_contact_form_draft_queue work
       set mailbox_draft_id = coalesce(work.mailbox_draft_id, v_mailbox_draft_id),
           outreach_provider_thread_id = coalesce(
             work.outreach_provider_thread_id,
             v_provider_thread_id
           ),
           last_error = coalesce(
             nullif(left(btrim(coalesce(p_error, '')), 2000), ''),
             work.last_error
           ),
           updated_at = now()
     where work.id = p_queue_id;
    return true;
  end if;

  if queue.status <> 'processing'
     or queue.lease_holder <> btrim(p_holder)
     or queue.provider_create_attempt_id <> p_provider_create_attempt_id
     or queue.provider_create_started_at is null then
    return false;
  end if;

  update public.email_assignment_contact_form_draft_queue work
     set status = 'reconciliation_required',
         mailbox_draft_id = v_mailbox_draft_id,
         outreach_provider_thread_id = v_provider_thread_id,
         completed_at = now(),
         result_reason = 'provider_reconciliation_required',
         lease_holder = null,
         lease_expires_at = null,
         last_error = nullif(
           left(btrim(coalesce(p_error, 'provider acceptance uncertain')), 2000),
           ''
         ),
         updated_at = now()
   where work.id = p_queue_id;
  return true;
end;
$function$;

revoke all on function public.mark_email_assignment_contact_form_draft_reconciliation_required_as_system(
  uuid,
  text,
  uuid,
  text,
  text,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.mark_email_assignment_contact_form_draft_reconciliation_required_as_system(
  uuid,
  text,
  uuid,
  text,
  text,
  text
) to service_role;

create or replace function public.complete_email_assignment_contact_form_draft_as_system(
  p_queue_id uuid,
  p_holder text,
  p_mailbox_draft_id text,
  p_provider_thread_id text,
  p_draft_history_id uuid,
  p_provider_create_attempt_id uuid,
  p_outcome text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  queue public.email_assignment_contact_form_draft_queue%rowtype;
  v_prior_placement record;
  v_opportunity_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_outcome not in ('drafted', 'autonomy_ineligible', 'draft_unavailable') then
    raise exception 'invalid_contact_form_draft_outcome' using errcode = '22023';
  end if;

  -- Guarded assignment takes the opportunity lock before emitting its event.
  -- Match that lock order here (opportunity, then queue) to eliminate both the
  -- stale-attribution race and an assignment/completion deadlock.
  select opportunity.id into v_opportunity_id
  from public.email_assignment_contact_form_draft_queue work
  join public.opportunities opportunity
    on opportunity.id = work.opportunity_id
  where work.id = p_queue_id
  for update of opportunity;
  if not found then
    return false;
  end if;

  select work.* into queue
  from public.email_assignment_contact_form_draft_queue work
  where work.id = p_queue_id
  for update;
  if not found then
    return false;
  end if;
  if queue.status = 'completed' and p_outcome = 'drafted' then
    return queue.mailbox_draft_id = p_mailbox_draft_id
      and queue.outreach_provider_thread_id = p_provider_thread_id
      and queue.draft_history_id = p_draft_history_id
      and queue.provider_create_attempt_id = p_provider_create_attempt_id;
  elsif queue.status = 'skipped'
        and p_provider_create_attempt_id is null
        and p_outcome = queue.result_reason then
    return true;
  end if;
  if queue.status <> 'processing'
     or queue.lease_holder <> btrim(p_holder)
     or queue.lease_expires_at <= clock_timestamp() then
    return false;
  end if;

  if p_outcome = 'drafted' then
    if p_provider_create_attempt_id is null
       or queue.provider_create_attempt_id <> p_provider_create_attempt_id
       or queue.provider_create_started_at is null then
      return false;
    end if;
  elsif p_provider_create_attempt_id is not null
        or queue.provider_create_attempt_id is not null
        or queue.provider_create_started_at is not null then
    return false;
  end if;

  if not private.email_assignment_contact_form_draft_authorized(
    p_queue_id,
    false
  ) then
    if p_outcome = 'drafted' then
      update public.email_assignment_contact_form_draft_queue work
         set status = 'reconciliation_required',
             mailbox_draft_id = nullif(
               btrim(coalesce(p_mailbox_draft_id, '')),
               ''
             ),
             outreach_provider_thread_id = nullif(
               btrim(coalesce(p_provider_thread_id, '')),
               ''
             ),
             completed_at = now(),
             result_reason = 'provider_reconciliation_required',
             lease_holder = null,
             lease_expires_at = null,
             last_error = 'authorization changed after provider create',
             updated_at = now()
       where work.id = p_queue_id;
    end if;
    return false;
  end if;

  if p_outcome = 'drafted' then
    if nullif(btrim(coalesce(p_mailbox_draft_id, '')), '') is null
       or nullif(btrim(coalesce(p_provider_thread_id, '')), '') is null
       or p_draft_history_id is null
       or queue.draft_history_id <> p_draft_history_id
       or not exists (
         select 1
         from public.ai_draft_history draft
         where draft.id = p_draft_history_id
           and draft.company_id = queue.company_id
           and draft.user_id = queue.actor_user_id
           and draft.connection_id = queue.connection_id
           and draft.opportunity_id = queue.opportunity_id
           and draft.origin = 'phase_c'
           and draft.status in ('drafted', 'auto_drafted')
           and (draft.mailbox_draft_id is null
             or draft.mailbox_draft_id = btrim(p_mailbox_draft_id))
           and (draft.thread_id is null
             or draft.thread_id = btrim(p_provider_thread_id))
       ) then
      return false;
    end if;

    if not private.email_assignment_contact_form_draft_authorized(
      p_queue_id,
      true
    ) then
      update public.email_assignment_contact_form_draft_queue work
         set status = 'reconciliation_required',
             mailbox_draft_id = btrim(p_mailbox_draft_id),
             outreach_provider_thread_id = btrim(p_provider_thread_id),
             completed_at = now(),
             result_reason = 'provider_reconciliation_required',
             lease_holder = null,
             lease_expires_at = null,
             last_error = 'autonomy changed after provider create',
             updated_at = now()
       where work.id = p_queue_id;
      return false;
    end if;

    select prior_placement.* into v_prior_placement
    from private.email_assignment_contact_form_draft_prior_placement(
      p_queue_id
    ) prior_placement;
    if not found
       or (
         queue.reused_from_draft_history_id is null
         and v_prior_placement.disposition <> 'create'
       )
       or (
         queue.reused_from_draft_history_id is not null
         and (
           v_prior_placement.disposition <> 'update'
           or v_prior_placement.prior_draft_history_id <>
             queue.reused_from_draft_history_id
           or v_prior_placement.mailbox_draft_id <>
             btrim(p_mailbox_draft_id)
           or v_prior_placement.provider_thread_id <>
             btrim(p_provider_thread_id)
         )
       ) then
      update public.email_assignment_contact_form_draft_queue work
         set status = 'reconciliation_required',
             mailbox_draft_id = btrim(p_mailbox_draft_id),
             outreach_provider_thread_id = btrim(p_provider_thread_id),
             completed_at = now(),
             result_reason = 'provider_reconciliation_required',
             lease_holder = null,
             lease_expires_at = null,
             last_error = 'prior draft state changed after provider placement',
             updated_at = now()
       where work.id = p_queue_id;
      return false;
    end if;

    -- Use the same advisory lock order as reassign_phase_c_mailbox_draft before
    -- claiming the thread. This keeps queue completion and generic/manual
    -- Phase C placement deadlock-free while sharing the unique provider IDs.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'phase-c-mailbox-draft:' || queue.company_id::text || ':' ||
        queue.connection_id::text || ':' || btrim(p_mailbox_draft_id),
      0
    ));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'phase-c-thread-draft:' || queue.company_id::text || ':' ||
        queue.connection_id::text || ':' || btrim(p_provider_thread_id),
      0
    ));

    -- Claim the provider thread in this transaction. A conflict owned by a
    -- different opportunity raises and rolls back every following projection.
    insert into public.opportunity_email_threads (
      opportunity_id,
      thread_id,
      connection_id
    ) values (
      queue.opportunity_id,
      btrim(p_provider_thread_id),
      queue.connection_id
    )
    on conflict (thread_id, connection_id) do nothing;

    if not exists (
      select 1
      from public.opportunity_email_threads link
      where link.opportunity_id = queue.opportunity_id
        and link.connection_id = queue.connection_id
        and link.thread_id = btrim(p_provider_thread_id)
    ) then
      raise exception 'contact_form_draft_thread_conflict'
        using errcode = '23505';
    end if;

    -- This existing service-only helper atomically supersedes any prior
    -- Phase C history for the provider draft/thread before activating the
    -- exact current assignee's prepared history.
    perform public.reassign_phase_c_mailbox_draft(
      p_company_id => queue.company_id,
      p_connection_id => queue.connection_id,
      p_thread_id => btrim(p_provider_thread_id),
      p_new_draft_history_id => p_draft_history_id,
      p_mailbox_draft_id => btrim(p_mailbox_draft_id),
      p_expected_old_draft_history_id => queue.reused_from_draft_history_id,
      p_subject => coalesce(
        (
          select nullif(btrim(draft.subject), '')
          from public.ai_draft_history draft
          where draft.id = p_draft_history_id
        ),
        'Thanks for reaching out'
      )
    );

    update public.email_assignment_contact_form_draft_queue work
       set status = 'completed',
           mailbox_draft_id = btrim(p_mailbox_draft_id),
           outreach_provider_thread_id = btrim(p_provider_thread_id),
           completed_at = now(),
           result_reason = 'drafted',
           lease_holder = null,
           lease_expires_at = null,
           last_error = null,
           updated_at = now()
     where work.id = p_queue_id;
    return true;
  end if;

  if p_mailbox_draft_id is not null or p_provider_thread_id is not null then
    return false;
  end if;
  if p_draft_history_id is not null
     and queue.draft_history_id is distinct from p_draft_history_id then
    return false;
  end if;
  update public.email_assignment_contact_form_draft_queue work
     set status = 'skipped',
         completed_at = now(),
         result_reason = p_outcome,
         lease_holder = null,
         lease_expires_at = null,
         last_error = null,
         updated_at = now()
   where work.id = p_queue_id;
  return true;
end;
$function$;

revoke all on function public.complete_email_assignment_contact_form_draft_as_system(uuid, text, text, text, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_email_assignment_contact_form_draft_as_system(uuid, text, text, text, uuid, uuid, text)
  to service_role;

create or replace function public.fail_email_assignment_contact_form_draft_as_system(
  p_queue_id uuid,
  p_holder text,
  p_error text
) returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  queue public.email_assignment_contact_form_draft_queue%rowtype;
  v_assignment_current boolean;
  v_next_status text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_error, '')), '') is null then
    raise exception 'contact_form_draft_error_required' using errcode = '22023';
  end if;

  select work.* into queue
  from public.email_assignment_contact_form_draft_queue work
  where work.id = p_queue_id
    and work.status = 'processing'
    and work.lease_holder = btrim(p_holder)
  for update;
  if not found then
    return 'stale';
  end if;

  select exists (
    select 1
    from public.opportunities opportunity
    join public.opportunity_assignment_events event
      on event.id = queue.assignment_event_id
     and event.opportunity_id = opportunity.id
     and event.assignment_version = opportunity.assignment_version
     and event.new_assignee_id = opportunity.assigned_to
    where opportunity.id = queue.opportunity_id
      and opportunity.company_id = queue.company_id
      and opportunity.assigned_to = queue.actor_user_id
      and opportunity.assignment_version = queue.assignment_version
      and opportunity.deleted_at is null
  ) into v_assignment_current;

  v_next_status := case
    when queue.provider_create_started_at is not null then
      'reconciliation_required'
    when not v_assignment_current then 'stale'
    when queue.attempts >= 8 then 'failed'
    else 'retrying'
  end;

  update public.email_assignment_contact_form_draft_queue work
     set status = v_next_status,
         available_at = case
           when v_next_status = 'retrying' then
             clock_timestamp() + make_interval(
               secs => least(86400, (power(2, least(queue.attempts, 10)) * 60)::integer)
             )
           else work.available_at
         end,
         lease_holder = null,
         lease_expires_at = null,
         completed_at = case
           when v_next_status = 'reconciliation_required' then now()
           else null
         end,
         result_reason = case
           when v_next_status = 'reconciliation_required' then
             'provider_reconciliation_required'
           else null
         end,
         last_error = left(btrim(p_error), 2000),
         updated_at = now()
   where work.id = p_queue_id;
  return v_next_status;
end;
$function$;

revoke all on function public.fail_email_assignment_contact_form_draft_as_system(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_email_assignment_contact_form_draft_as_system(uuid, text, text)
  to service_role;

-- Backfill only currently assigned, exact message-scoped contact-form leads.
-- The helper is idempotent and skips every unassigned/company-shared lead until
-- an actual guarded assignment event exists.
do $block$
declare
  assignment_row record;
begin
  for assignment_row in
    select event.id
    from public.opportunity_assignment_events event
    join public.opportunities opportunity
      on opportunity.id = event.opportunity_id
     and opportunity.company_id = event.company_id
     and opportunity.assignment_version = event.assignment_version
     and opportunity.assigned_to = event.new_assignee_id
    where event.new_assignee_id is not null
      and opportunity.deleted_at is null
  loop
    perform private.enqueue_email_assignment_contact_form_draft(
      assignment_row.id,
      null
    );
  end loop;
end;
$block$;

commit;
