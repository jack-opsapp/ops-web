begin;

-- A delayed autonomous send must retain the exact conversation state that
-- licensed it. Keep this proof outside the legacy queue row so the existing
-- queue ABI stays stable while every new service write becomes source-bound.
create table private.phase_c_auto_send_source_fences (
  pending_auto_send_id uuid primary key
    references public.pending_auto_sends(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null
    references public.email_connections(id) on delete restrict,
  opportunity_id uuid not null
    references public.opportunities(id) on delete restrict,
  source_email_thread_id uuid not null
    references public.email_threads(id) on delete restrict,
  provider_thread_id text not null
    check (nullif(btrim(provider_thread_id), '') is not null),
  generation_kind text not null check (
    generation_kind in (
      'conversation_reply',
      'auto_follow_up',
      'operational_outbound'
    )
  ),
  source_activity_id uuid references public.activities(id) on delete restrict,
  source_message_id text,
  follow_up_sequence integer,
  created_at timestamptz not null default clock_timestamp(),
  check (
    (
      generation_kind = 'conversation_reply'
      and source_activity_id is not null
      and nullif(btrim(source_message_id), '') is not null
      and follow_up_sequence is null
    )
    or (
      generation_kind = 'auto_follow_up'
      and source_activity_id is not null
      and nullif(btrim(source_message_id), '') is not null
      and follow_up_sequence is not null
      and follow_up_sequence between 1 and 100
    )
    or (
      generation_kind = 'operational_outbound'
      and source_activity_id is null
      and source_message_id is null
      and follow_up_sequence is null
    )
  )
);

create unique index phase_c_auto_send_source_identity_unique
  on private.phase_c_auto_send_source_fences (
    company_id,
    connection_id,
    opportunity_id,
    source_email_thread_id,
    provider_thread_id,
    generation_kind,
    source_activity_id,
    coalesce(follow_up_sequence, 0)
  )
  where generation_kind in ('conversation_reply', 'auto_follow_up');

revoke all on table private.phase_c_auto_send_source_fences
  from public, anon, authenticated, service_role;

-- Block old writers for the remainder of this transaction and refuse to
-- migrate while a worker may already be between its durable claim and the
-- external provider call. The migration can be retried after the lease drains.
lock table public.pending_auto_sends in share row exclusive mode;
do $migration_guard$
begin
  if exists (
    select 1
    from public.pending_auto_sends queue
    where queue.status = 'leased'
  ) then
    raise exception 'PHASE_C_AUTO_SEND_SOURCE_FENCE_MIGRATION_BUSY'
      using errcode = '55006';
  end if;
end;
$migration_guard$;

-- Existing delayed rows predate exact source proof. They cannot be made safe by
-- guessing from current thread state, so retire them before the fenced writer
-- becomes the only callable schedule boundary.
update public.pending_auto_sends queue
set status = 'cancelled',
    cancelled_at = clock_timestamp(),
    error = 'PHASE_C_AUTO_SEND_SOURCE_FENCE_REQUIRED',
    lease_token = null,
    lease_expires_at = null,
    updated_at = clock_timestamp()
where queue.status in ('pending', 'leased');

-- The older RPC remains as an implementation detail of the atomic wrapper.
-- Removing service-role execution prevents any future queue row from bypassing
-- source-fence persistence.
revoke all on function public.schedule_phase_c_auto_send(
  text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text,
  text[], text[], text, text, text, text, text, uuid, text, text,
  uuid, text, text, timestamptz
) from public, anon, authenticated, service_role;

create or replace function public.schedule_phase_c_auto_send_fenced(
  p_idempotency_key text,
  p_company_id uuid,
  p_actor_user_id uuid,
  p_assignment_version bigint,
  p_assignment_event_id uuid,
  p_connection_id uuid,
  p_opportunity_id uuid,
  p_source_email_thread_id uuid,
  p_reply_provider_thread_id text,
  p_in_reply_to text,
  p_to_emails text[],
  p_cc_emails text[],
  p_subject text,
  p_draft_text text,
  p_authored_body text,
  p_rendered_body text,
  p_content_type text,
  p_draft_history_id uuid,
  p_profile_type_snapshot text,
  p_learning_authority text,
  p_signature_id uuid,
  p_signature_content_hash text,
  p_rendered_body_hash text,
  p_scheduled_send_at timestamptz,
  p_generation_kind text,
  p_source_activity_id uuid,
  p_source_message_id text,
  p_follow_up_sequence integer
)
returns public.pending_auto_sends
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_queue public.pending_auto_sends%rowtype;
  v_fence private.phase_c_auto_send_source_fences%rowtype;
  v_source_activity public.activities%rowtype;
  v_latest_activity_id uuid;
  v_latest_message_id text;
  v_expected_direction text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_idempotency_key !~ '^[0-9a-f]{64}$'
     or p_generation_kind is null
     or p_generation_kind not in (
       'conversation_reply',
       'auto_follow_up',
       'operational_outbound'
     )
     or (
       p_generation_kind = 'conversation_reply'
       and (
         p_source_activity_id is null
         or nullif(btrim(coalesce(p_source_message_id, '')), '') is null
         or p_follow_up_sequence is not null
       )
     )
     or (
       p_generation_kind = 'auto_follow_up'
       and (
         p_source_activity_id is null
         or nullif(btrim(coalesce(p_source_message_id, '')), '') is null
         or p_follow_up_sequence is null
         or p_follow_up_sequence not between 1 and 100
       )
     )
     or (
       p_generation_kind = 'operational_outbound'
       and (
         p_source_activity_id is not null
         or p_source_message_id is not null
         or p_follow_up_sequence is not null
       )
     )
     or (
       p_generation_kind in ('conversation_reply', 'auto_follow_up')
       and p_in_reply_to is distinct from p_source_message_id
     ) then
    raise exception 'PHASE_C_AUTO_SEND_SOURCE_FENCE_INVALID'
      using errcode = '22023';
  end if;

  -- Serialize the no-row case as well as replays. Without this lock two model
  -- calls can both observe no queue row and race into different draft payloads
  -- for the same source/sequence identity.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'phase-c-auto-send-source:v2:'
      || p_company_id::text || ':' || p_idempotency_key,
      0
    )
  );

  -- Match the queue's global transition order: opportunity before queue.
  perform 1
  from public.opportunities opportunity
  where opportunity.id = p_opportunity_id
    and opportunity.company_id = p_company_id
    and opportunity.deleted_at is null
  for update;
  if not found then
    raise exception 'PHASE_C_AUTO_SEND_OPPORTUNITY_INVALID'
      using errcode = '42501';
  end if;

  select queue.*
  into v_queue
  from public.pending_auto_sends queue
  where queue.company_id = p_company_id
    and queue.idempotency_key = p_idempotency_key
  for update;

  if found then
    select fence.*
    into v_fence
    from private.phase_c_auto_send_source_fences fence
    where fence.pending_auto_send_id = v_queue.id
    for share;

    if not found
       or v_queue.actor_user_id is distinct from p_actor_user_id
       or v_queue.assignment_version is distinct from p_assignment_version
       or v_queue.assignment_event_id is distinct from p_assignment_event_id
       or v_queue.connection_id is distinct from p_connection_id
       or v_queue.opportunity_id is distinct from p_opportunity_id
       or v_queue.source_email_thread_id is distinct from p_source_email_thread_id
       or v_queue.thread_id is distinct from p_reply_provider_thread_id
       or v_queue.in_reply_to is distinct from p_in_reply_to
       or v_fence.company_id is distinct from p_company_id
       or v_fence.connection_id is distinct from p_connection_id
       or v_fence.opportunity_id is distinct from p_opportunity_id
       or v_fence.source_email_thread_id is distinct from p_source_email_thread_id
       or v_fence.provider_thread_id is distinct from p_reply_provider_thread_id
       or v_fence.generation_kind is distinct from p_generation_kind
       or v_fence.source_activity_id is distinct from p_source_activity_id
       or v_fence.source_message_id is distinct from p_source_message_id
       or v_fence.follow_up_sequence is distinct from p_follow_up_sequence then
      raise exception 'PHASE_C_AUTO_SEND_IDEMPOTENCY_CONFLICT'
        using errcode = '23505';
    end if;
    if v_queue.status not in ('pending', 'leased', 'sent') then
      raise exception 'PHASE_C_AUTO_SEND_IDEMPOTENCY_TERMINAL'
        using errcode = '23505';
    end if;
    return v_queue;
  end if;

  if p_generation_kind in ('conversation_reply', 'auto_follow_up') then
    v_expected_direction := case p_generation_kind
      when 'conversation_reply' then 'inbound'
      else 'outbound'
    end;

    select activity.*
    into v_source_activity
    from public.activities activity
    where activity.id = p_source_activity_id
      and activity.company_id = p_company_id
      and activity.opportunity_id = p_opportunity_id
      and activity.email_connection_id = p_connection_id
      and activity.email_thread_id = p_reply_provider_thread_id
      and activity.email_message_id = p_source_message_id
      and activity.type = 'email'
      and activity.direction = v_expected_direction
    for share;
    if not found then
      raise exception 'PHASE_C_AUTO_SEND_SOURCE_ACTIVITY_INVALID'
        using errcode = '42501';
    end if;

    select activity.id, activity.email_message_id
    into v_latest_activity_id, v_latest_message_id
    from public.activities activity
    where activity.company_id = p_company_id
      and activity.opportunity_id = p_opportunity_id
      and activity.email_connection_id = p_connection_id
      and activity.email_thread_id = p_reply_provider_thread_id
      and activity.type = 'email'
    order by activity.created_at desc, activity.id desc
    limit 1
    for share;
    if v_latest_activity_id is distinct from p_source_activity_id
       or v_latest_message_id is distinct from p_source_message_id then
      raise exception 'PHASE_C_AUTO_SEND_SOURCE_STALE'
        using errcode = '40001';
    end if;
  end if;

  select scheduled.*
  into v_queue
  from public.schedule_phase_c_auto_send(
    p_idempotency_key,
    p_company_id,
    p_actor_user_id,
    p_assignment_version,
    p_assignment_event_id,
    p_connection_id,
    p_opportunity_id,
    p_source_email_thread_id,
    p_reply_provider_thread_id,
    p_in_reply_to,
    p_to_emails,
    p_cc_emails,
    p_subject,
    p_draft_text,
    p_authored_body,
    p_rendered_body,
    p_content_type,
    p_draft_history_id,
    p_profile_type_snapshot,
    p_learning_authority,
    p_signature_id,
    p_signature_content_hash,
    p_rendered_body_hash,
    p_scheduled_send_at
  ) scheduled;
  if v_queue.id is null then
    raise exception 'PHASE_C_AUTO_SEND_SCHEDULE_FAILED';
  end if;

  insert into private.phase_c_auto_send_source_fences (
    pending_auto_send_id,
    company_id,
    connection_id,
    opportunity_id,
    source_email_thread_id,
    provider_thread_id,
    generation_kind,
    source_activity_id,
    source_message_id,
    follow_up_sequence
  ) values (
    v_queue.id,
    p_company_id,
    p_connection_id,
    p_opportunity_id,
    p_source_email_thread_id,
    p_reply_provider_thread_id,
    p_generation_kind,
    p_source_activity_id,
    p_source_message_id,
    p_follow_up_sequence
  );

  return v_queue;
end;
$function$;

revoke all on function public.schedule_phase_c_auto_send_fenced(
  text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text,
  text[], text[], text, text, text, text, text, uuid, text, text,
  uuid, text, text, timestamptz, text, uuid, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.schedule_phase_c_auto_send_fenced(
  text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text,
  text[], text[], text, text, text, text, text, uuid, text, text,
  uuid, text, text, timestamptz, text, uuid, text, integer
) to service_role;

-- Cheap preflight used only to avoid paying for a duplicate draft. The fenced
-- schedule RPC remains the race-safe authority.
create or replace function public.find_phase_c_auto_send_by_identity_as_system(
  p_idempotency_key text,
  p_company_id uuid,
  p_actor_user_id uuid,
  p_assignment_version bigint,
  p_assignment_event_id uuid,
  p_connection_id uuid,
  p_opportunity_id uuid,
  p_source_email_thread_id uuid,
  p_reply_provider_thread_id text,
  p_generation_kind text,
  p_source_activity_id uuid,
  p_source_message_id text,
  p_follow_up_sequence integer
)
returns public.pending_auto_sends
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_queue public.pending_auto_sends%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  select queue.*
  into v_queue
  from public.pending_auto_sends queue
  join private.phase_c_auto_send_source_fences fence
    on fence.pending_auto_send_id = queue.id
  where queue.idempotency_key = p_idempotency_key
    and queue.company_id = p_company_id
    and queue.actor_user_id = p_actor_user_id
    and queue.assignment_version = p_assignment_version
    and queue.assignment_event_id = p_assignment_event_id
    and queue.connection_id = p_connection_id
    and queue.opportunity_id = p_opportunity_id
    and queue.source_email_thread_id = p_source_email_thread_id
    and queue.thread_id = p_reply_provider_thread_id
    and queue.status in ('pending', 'leased', 'sent')
    and fence.company_id = p_company_id
    and fence.connection_id = p_connection_id
    and fence.opportunity_id = p_opportunity_id
    and fence.source_email_thread_id = p_source_email_thread_id
    and fence.provider_thread_id = p_reply_provider_thread_id
    and fence.generation_kind = p_generation_kind
    and fence.source_activity_id is not distinct from p_source_activity_id
    and fence.source_message_id is not distinct from p_source_message_id
    and fence.follow_up_sequence is not distinct from p_follow_up_sequence
  limit 1;
  if not found then
    return null;
  end if;
  return v_queue;
end;
$function$;

revoke all on function public.find_phase_c_auto_send_by_identity_as_system(
  text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text, uuid, text,
  integer
) from public, anon, authenticated, service_role;
grant execute on function public.find_phase_c_auto_send_by_identity_as_system(
  text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text, uuid, text,
  integer
) to service_role;

-- This check runs inside the physical mailbox lease. It locks the exact queue
-- source and reports whether the database conversation has advanced; the
-- caller then cancels with the same queue lease before touching the provider.
create or replace function public.validate_phase_c_auto_send_source_for_delivery(
  p_id uuid,
  p_company_id uuid,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  queue public.pending_auto_sends%rowtype;
  fence private.phase_c_auto_send_source_fences%rowtype;
  v_opportunity_id uuid;
  v_latest_activity_id uuid;
  v_latest_message_id text;
  v_latest_direction text;
  v_current boolean := false;
  v_reason text := 'PHASE_C_AUTO_SEND_SOURCE_STALE';
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  select pending.opportunity_id
  into v_opportunity_id
  from public.pending_auto_sends pending
  where pending.id = p_id
    and pending.company_id = p_company_id;
  if v_opportunity_id is null then
    raise exception 'PHASE_C_AUTO_SEND_LEASE_INVALID' using errcode = '42501';
  end if;

  perform 1
  from public.opportunities opportunity
  where opportunity.id = v_opportunity_id
    and opportunity.company_id = p_company_id
    and opportunity.deleted_at is null
  for update;
  if not found then
    raise exception 'PHASE_C_AUTO_SEND_LEASE_INVALID' using errcode = '42501';
  end if;

  select pending.*
  into queue
  from public.pending_auto_sends pending
  where pending.id = p_id
    and pending.company_id = p_company_id
  for update;
  if not found
     or queue.status <> 'leased'
     or queue.lease_token is distinct from p_lease_token
     or queue.lease_expires_at <= clock_timestamp() then
    raise exception 'PHASE_C_AUTO_SEND_LEASE_INVALID' using errcode = '42501';
  end if;

  select source_fence.*
  into fence
  from private.phase_c_auto_send_source_fences source_fence
  where source_fence.pending_auto_send_id = queue.id
    and source_fence.company_id = queue.company_id
    and source_fence.connection_id = queue.connection_id
    and source_fence.opportunity_id = queue.opportunity_id
    and source_fence.source_email_thread_id = queue.source_email_thread_id
    and source_fence.provider_thread_id = queue.thread_id
  for share;
  if not found then
    v_reason := 'PHASE_C_AUTO_SEND_SOURCE_FENCE_MISSING';
  elsif not exists (
    select 1
    from public.email_threads thread
    where thread.id = queue.source_email_thread_id
      and thread.company_id = queue.company_id
      and thread.connection_id = queue.connection_id
      and thread.opportunity_id = queue.opportunity_id
      and thread.provider_thread_id = queue.thread_id
  ) or not exists (
    select 1
    from public.opportunity_email_threads link
    where link.opportunity_id = queue.opportunity_id
      and link.connection_id = queue.connection_id
      and link.thread_id = queue.thread_id
  ) then
    v_reason := 'PHASE_C_AUTO_SEND_THREAD_CHANGED';
  elsif fence.generation_kind = 'operational_outbound' then
    v_current := true;
    v_reason := null;
  else
    select activity.id, activity.email_message_id, activity.direction
    into v_latest_activity_id, v_latest_message_id, v_latest_direction
    from public.activities activity
    where activity.company_id = queue.company_id
      and activity.opportunity_id = queue.opportunity_id
      and activity.email_connection_id = queue.connection_id
      and activity.email_thread_id = queue.thread_id
      and activity.type = 'email'
    order by activity.created_at desc, activity.id desc
    limit 1
    for share;

    v_current :=
      v_latest_activity_id is not distinct from fence.source_activity_id
      and v_latest_message_id is not distinct from fence.source_message_id
      and v_latest_direction = case fence.generation_kind
        when 'conversation_reply' then 'inbound'
        when 'auto_follow_up' then 'outbound'
        else null
      end;
    if v_current then
      v_reason := null;
    end if;
  end if;

  return jsonb_build_object(
    'current', v_current,
    'reason', v_reason,
    'generation_kind', fence.generation_kind,
    'source_activity_id', fence.source_activity_id,
    'source_message_id', fence.source_message_id,
    'provider_thread_id', queue.thread_id,
    'follow_up_sequence', fence.follow_up_sequence
  );
end;
$function$;

revoke all on function public.validate_phase_c_auto_send_source_for_delivery(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.validate_phase_c_auto_send_source_for_delivery(
  uuid, uuid, uuid
) to service_role;

-- Defense in depth for callers that bypass the TypeScript mailbox wrapper: the
-- prepared -> sending transition itself rechecks the exact latest activity in
-- the same transaction. A stale transition rolls back before provider code can
-- receive a sending claim.
create or replace function private.enforce_phase_c_auto_send_source_delivery_fence()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  queue public.pending_auto_sends%rowtype;
  fence private.phase_c_auto_send_source_fences%rowtype;
  v_latest_activity_id uuid;
  v_latest_message_id text;
  v_latest_direction text;
begin
  if new.pending_auto_send_id is null then
    return new;
  end if;
  if not (old.status = 'prepared' and new.status = 'sending') then
    return new;
  end if;

  select pending.*
  into queue
  from public.pending_auto_sends pending
  where pending.id = new.pending_auto_send_id
  for share;

  select source_fence.*
  into fence
  from private.phase_c_auto_send_source_fences source_fence
  where source_fence.pending_auto_send_id = new.pending_auto_send_id
  for share;

  if queue.id is null
     or fence.pending_auto_send_id is null
     or fence.company_id is distinct from queue.company_id
     or fence.connection_id is distinct from queue.connection_id
     or fence.opportunity_id is distinct from queue.opportunity_id
     or fence.source_email_thread_id is distinct from queue.source_email_thread_id
     or fence.provider_thread_id is distinct from queue.thread_id then
    raise exception 'EMAIL_SEND_PHASE_C_SOURCE_FENCE_MISSING'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.email_threads thread
    where thread.id = queue.source_email_thread_id
      and thread.company_id = queue.company_id
      and thread.connection_id = queue.connection_id
      and thread.opportunity_id = queue.opportunity_id
      and thread.provider_thread_id = queue.thread_id
  ) or not exists (
    select 1
    from public.opportunity_email_threads link
    where link.opportunity_id = queue.opportunity_id
      and link.connection_id = queue.connection_id
      and link.thread_id = queue.thread_id
  ) then
    raise exception 'EMAIL_SEND_PHASE_C_SOURCE_STALE'
      using errcode = '40001';
  end if;

  if fence.generation_kind in ('conversation_reply', 'auto_follow_up') then
    select activity.id, activity.email_message_id, activity.direction
    into v_latest_activity_id, v_latest_message_id, v_latest_direction
    from public.activities activity
    where activity.company_id = queue.company_id
      and activity.opportunity_id = queue.opportunity_id
      and activity.email_connection_id = queue.connection_id
      and activity.email_thread_id = queue.thread_id
      and activity.type = 'email'
    order by activity.created_at desc, activity.id desc
    limit 1
    for share;

    if v_latest_activity_id is distinct from fence.source_activity_id
       or v_latest_message_id is distinct from fence.source_message_id
       or v_latest_direction is distinct from case fence.generation_kind
         when 'conversation_reply' then 'inbound'
         else 'outbound'
       end then
      raise exception 'EMAIL_SEND_PHASE_C_SOURCE_STALE'
        using errcode = '40001';
    end if;
  elsif fence.generation_kind <> 'operational_outbound' then
    raise exception 'EMAIL_SEND_PHASE_C_SOURCE_FENCE_INVALID'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_phase_c_auto_send_source_delivery_fence()
  from public, anon, authenticated, service_role;

drop trigger if exists email_send_intents_phase_c_source_delivery_fence
  on public.email_send_intents;
create trigger email_send_intents_phase_c_source_delivery_fence
before update of status on public.email_send_intents
for each row
execute function private.enforce_phase_c_auto_send_source_delivery_fence();

commit;
