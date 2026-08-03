begin;

-- Mailbox contention is transport coordination, not a delivery attempt. Track
-- the first continuous wait without adding another claimable queue status.
alter table public.email_assignment_contact_form_draft_queue
  add column if not exists mailbox_busy_since timestamptz;

comment on column public.email_assignment_contact_form_draft_queue.mailbox_busy_since
  is 'First instant the current draft lifecycle began waiting on the physical provider-mailbox lease; terminal status ends the active wait.';

create index if not exists email_assignment_contact_form_draft_mailbox_wait_idx
  on public.email_assignment_contact_form_draft_queue (
    mailbox_busy_since,
    available_at,
    connection_id
  )
  where mailbox_busy_since is not null
    and status in ('retrying', 'processing');

-- Persistent alerts stay unique even if presentation state marks one read.
create unique index if not exists notifications_email_assignment_draft_mailbox_wait_open_uidx
  on public.notifications (user_id, company_id, dedupe_key)
  where type = 'system'
    and dedupe_key like 'email-assignment-draft-mailbox-wait:%'
    and resolved_at is null;

-- Resolve the exact physical mailbox through the same canonical provider and
-- address digest as the acquisition RPC. The public mirror check preserves the
-- rolling-deploy bridge used by an older worker that is still heartbeating.
create or replace function private.email_assignment_contact_form_draft_mailbox_is_busy(
  p_connection_id uuid
) returns boolean
language sql
security definer
set search_path = ''
as $function$
  with target as (
    select
      connection.provider,
      connection.email,
      extensions.digest(
        convert_to(connection.provider, 'UTF8')
          || decode('00', 'hex')
          || convert_to(connection.email, 'UTF8'),
        'sha256'
      ) as mailbox_identity_hash
    from public.email_connections connection
    where connection.id = p_connection_id
      and connection.provider = lower(btrim(connection.provider))
      and connection.provider in ('gmail', 'microsoft365')
      and connection.email = lower(btrim(connection.email))
  )
  select coalesce((
    select
      exists (
        select 1
        from private.email_provider_mailbox_sync_leases lease
        where lease.mailbox_identity_hash = target.mailbox_identity_hash
          and lease.expires_at > clock_timestamp()
      )
      or exists (
        select 1
        from public.email_connections mirror
        where mirror.provider = target.provider
          and mirror.email = target.email
          and mirror.sync_lock_owner is not null
          and mirror.sync_in_progress_at is not null
          and mirror.sync_in_progress_at >
            clock_timestamp() - make_interval(secs => 600)
      )
    from target
  ), false)
$function$;

revoke all on function private.email_assignment_contact_form_draft_mailbox_is_busy(
  uuid
)
  from public, anon, authenticated, service_role;

-- A persistent wait alert is lifecycle state, not a permanent warning. Resolve
-- it as soon as the queue leaves its active mailbox-wait lifecycle.
create or replace function private.resolve_email_assignment_contact_form_draft_mailbox_wait_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.mailbox_busy_since is null then
    return new;
  end if;

  if new.mailbox_busy_since is not null
     and new.status in ('pending', 'processing', 'retrying') then
    return new;
  end if;

  update public.notifications notification
     set is_read = true,
         resolved_at = clock_timestamp(),
         resolution_reason = 'mailbox_draft_wait_cleared',
         resolved_by = null
   where notification.company_id = new.company_id::text
     and notification.type = 'system'
     and notification.dedupe_key =
       'email-assignment-draft-mailbox-wait:' || new.id::text
     and notification.resolved_at is null;

  return new;
end;
$function$;

revoke all on function private.resolve_email_assignment_contact_form_draft_mailbox_wait_notification()
  from public, anon, authenticated, service_role;

drop trigger if exists email_assignment_contact_form_draft_mailbox_wait_notification_resolution
  on public.email_assignment_contact_form_draft_queue;
create trigger email_assignment_contact_form_draft_mailbox_wait_notification_resolution
after update of status, mailbox_busy_since
on public.email_assignment_contact_form_draft_queue
for each row
execute function private.resolve_email_assignment_contact_form_draft_mailbox_wait_notification();

-- Claims now wait on the physical-mailbox condition before consuming a worker
-- slot. A lock-acquisition race can still report busy later; the failure RPC
-- below returns that row to this same condition-aware lifecycle.
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
         mailbox_busy_since = null,
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
         mailbox_busy_since = null,
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
         mailbox_busy_since = null,
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

  -- Mark each due row once when the physical mailbox is occupied. Attempts do
  -- not increment, model generation does not start, and expired queue leases
  -- are released before the row waits.
  update public.email_assignment_contact_form_draft_queue queue
     set status = 'retrying',
         mailbox_busy_since = coalesce(
           queue.mailbox_busy_since,
           clock_timestamp()
         ),
         available_at = clock_timestamp() + make_interval(mins => 5),
         lease_holder = null,
         lease_expires_at = null,
         completed_at = null,
         result_reason = null,
         last_error = 'EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_MAILBOX_BUSY',
         updated_at = now()
   where (
       queue.status in ('pending', 'retrying')
       or (
         queue.status = 'processing'
         and queue.lease_expires_at <= clock_timestamp()
       )
     )
     and queue.available_at <= clock_timestamp()
     and queue.provider_create_started_at is null
     and (
       queue.mailbox_busy_since is null
       or queue.status = 'processing'
     )
     and private.email_assignment_contact_form_draft_mailbox_is_busy(
       queue.connection_id
     )
     and private.email_assignment_contact_form_draft_authorized(
       queue.id,
       false
     )
     and exists (
       select 1
       from private.email_assignment_contact_form_draft_prior_placement(
         queue.id
       ) prior_placement
       where prior_placement.disposition in ('create', 'update')
     );

  -- Escalate only a continuous hour-long wait that is still physically busy.
  -- The assigned operator is the exact queue actor and the notification carries
  -- no customer or lead identity.
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
  )
  select
    actor.id::text,
    queue.company_id::text,
    'system',
    'Draft waiting for mailbox',
    'One lead reply has waited over an hour. OPS will resume when the mailbox is clear.',
    false,
    true,
    '/pipeline',
    'Review lead',
    'email-assignment-draft-mailbox-wait:' || queue.id::text
  from public.email_assignment_contact_form_draft_queue queue
  join public.users actor
    on actor.id = queue.actor_user_id
   and actor.company_id = queue.company_id
   and actor.deleted_at is null
   and coalesce(actor.is_active, false)
  where queue.status = 'retrying'
    and queue.provider_create_started_at is null
    and queue.mailbox_busy_since <=
      clock_timestamp() - make_interval(hours => 1)
    and private.email_assignment_contact_form_draft_mailbox_is_busy(
      queue.connection_id
    )
    and private.email_assignment_contact_form_draft_authorized(
      queue.id,
      false
    )
    and exists (
      select 1
      from private.email_assignment_contact_form_draft_prior_placement(
        queue.id
      ) prior_placement
      where prior_placement.disposition in ('create', 'update')
    )
  on conflict do nothing;

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
      and not private.email_assignment_contact_form_draft_mailbox_is_busy(
        queue.connection_id
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

revoke all on function public.claim_email_assignment_contact_form_drafts(
  text, integer, integer
)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_email_assignment_contact_form_drafts(
  text, integer, integer
)
  to service_role;

comment on function public.claim_email_assignment_contact_form_drafts(text, integer, integer)
  is 'Claims authorized assignment-triggered contact-form draft work only when the physical provider mailbox is currently available.';

-- A mailbox-busy result can still occur when another process acquires the
-- mailbox after claim. No provider create has begun, so preserve the first wait
-- timestamp and return the row to the condition-aware claim lifecycle.
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
  v_mailbox_busy boolean;
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

  v_mailbox_busy := btrim(p_error) = 'EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_MAILBOX_BUSY';
  v_next_status := case
    when queue.provider_create_started_at is not null then
      'reconciliation_required'
    when not v_assignment_current then 'stale'
    when v_mailbox_busy then 'retrying'
    when queue.attempts >= 8 then 'failed'
    else 'retrying'
  end;

  update public.email_assignment_contact_form_draft_queue work
     set status = v_next_status,
         available_at = case
           when v_next_status = 'retrying' then
             case
               when v_mailbox_busy then
                 clock_timestamp() + make_interval(mins => 5)
               else
                 clock_timestamp() + make_interval(
                   secs => least(86400, (power(2, least(queue.attempts, 10)) * 60)::integer)
                 )
             end
           else work.available_at
         end,
         lease_holder = null,
         lease_expires_at = null,
         mailbox_busy_since = case
           when v_mailbox_busy then
             coalesce(queue.mailbox_busy_since, clock_timestamp())
           else null
         end,
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

revoke all on function public.fail_email_assignment_contact_form_draft_as_system(
  uuid, text, text
)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_email_assignment_contact_form_draft_as_system(
  uuid, text, text
)
  to service_role;

comment on function public.fail_email_assignment_contact_form_draft_as_system(uuid, text, text)
  is 'Fails or retries a leased contact-form draft queue row; pre-provider mailbox contention returns to a condition-aware wait.';

-- Repair every row terminalized solely by the former mailbox-busy attempt cap.
-- Existing claim and worker guards still re-prove all authorization and reply
-- state, while both provider-create markers must prove no Gmail write began.
update public.email_assignment_contact_form_draft_queue work
   set status = 'retrying',
       mailbox_busy_since = coalesce(
         work.updated_at,
         work.created_at,
         clock_timestamp()
       ),
       available_at = clock_timestamp(),
       lease_holder = null,
       lease_expires_at = null,
       completed_at = null,
       result_reason = null,
       updated_at = now()
 where work.status = 'failed'
   and work.provider_create_attempt_id is null
   and work.provider_create_started_at is null
   and btrim(work.last_error) = 'EMAIL_ASSIGNMENT_CONTACT_FORM_DRAFT_MAILBOX_BUSY';

commit;
