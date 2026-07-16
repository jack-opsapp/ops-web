begin;

-- Outbound learning has two fundamentally different actor proofs:
--
-- 1. A durable provider-accepted OPS send intent proves who authored or
--    approved the send. That proof remains valid if the lead is reassigned
--    after provider acceptance.
-- 2. A native-mailbox draft has no provider-level human identity. It may train
--    only while the exact draft owner is still the active lead assignee at the
--    snapshotted assignment version. Otherwise it is bookkeeping-only.
--
-- Company connector user_id/email values are deliberately absent from every
-- actor decision below. Only an individual connection may bind its exact OPS
-- owner UUID.
alter table public.email_outbound_learning_queue
  add column if not exists actor_proof_type text,
  add column if not exists email_send_intent_id uuid
    references public.email_send_intents(id) on delete restrict,
  add column if not exists approved_action_email_intent_id uuid
    references public.approved_action_email_intents(id) on delete restrict,
  add column if not exists assignment_version_snapshot bigint,
  add column if not exists assignment_event_id_snapshot uuid
    references public.opportunity_assignment_events(id) on delete restrict;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.email_outbound_learning_queue'::regclass
      and conname = 'email_outbound_learning_actor_proof_check'
  ) then
    alter table public.email_outbound_learning_queue
      add constraint email_outbound_learning_actor_proof_check
      check (
        (
          actor_proof_type is null
          and email_send_intent_id is null
          and approved_action_email_intent_id is null
          and assignment_version_snapshot is null
          and assignment_event_id_snapshot is null
        )
        or (
          actor_proof_type = 'accepted_send_intent'
          and email_send_intent_id is not null
          and approved_action_email_intent_id is null
        )
        or (
          actor_proof_type = 'accepted_approved_action'
          and email_send_intent_id is null
          and approved_action_email_intent_id is not null
        )
        or (
          actor_proof_type = 'native_mailbox_draft'
          and email_send_intent_id is null
          and approved_action_email_intent_id is null
          and (
            opportunity_id is null
            or assignment_version_snapshot is not null
          )
        )
        or (
          actor_proof_type = 'personal_mailbox_owner'
          and email_send_intent_id is null
          and approved_action_email_intent_id is null
        )
        or (
          actor_proof_type = 'bookkeeping_only'
          and email_send_intent_id is null
          and approved_action_email_intent_id is null
          and assignment_version_snapshot is null
          and assignment_event_id_snapshot is null
        )
      );
  end if;
end;
$migration$;

create unique index if not exists email_outbound_learning_send_intent_unique
  on public.email_outbound_learning_queue (email_send_intent_id)
  where email_send_intent_id is not null;

create unique index if not exists email_outbound_learning_approved_intent_unique
  on public.email_outbound_learning_queue (approved_action_email_intent_id)
  where approved_action_email_intent_id is not null;

create index if not exists email_outbound_learning_actor_proof_idx
  on public.email_outbound_learning_queue (
    company_id,
    user_id,
    actor_proof_type,
    completed_at desc
  );

create or replace function private.email_outbound_safe_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $function$
begin
  if nullif(btrim(p_value), '') is null
    or btrim(p_value) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    return null;
  end if;
  return btrim(p_value)::uuid;
exception
  when invalid_text_representation then return null;
end;
$function$;

revoke all on function private.email_outbound_safe_uuid(text)
  from public, anon, authenticated, service_role;

create or replace function private.bind_email_outbound_learning_actor_proof(
  p_job_id uuid,
  p_requested_user_id uuid,
  p_requested_authority text
)
returns public.email_outbound_learning_queue
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  q public.email_outbound_learning_queue%rowtype;
  c public.email_connections%rowtype;
  d public.ai_draft_history%rowtype;
  activity public.activities%rowtype;
  o public.opportunities%rowtype;
  u public.users%rowtype;
  send_intent public.email_send_intents%rowtype;
  approved_intent public.approved_action_email_intents%rowtype;
  v_owner_id uuid;
  v_assignment_event_id uuid;
  v_effective_opportunity_id uuid;
  v_native_provenance_valid boolean := false;
  v_proof_type text;
  v_authority text := 'autonomous';
  v_send_intent_id uuid;
  v_approved_intent_id uuid;
  v_assignment_version bigint;
begin
  if p_requested_user_id is null then
    raise exception 'outbound learning actor is required'
      using errcode = '22023';
  end if;
  if p_requested_authority not in (
    'operator_authored',
    'operator_approved',
    'autonomous'
  ) then
    raise exception 'outbound learning authority is invalid'
      using errcode = '22023';
  end if;

  select queue_row.*
  into q
  from public.email_outbound_learning_queue queue_row
  where queue_row.id = p_job_id
  for update;

  if q.id is null then
    raise exception 'outbound learning job does not exist';
  end if;
  if private.email_outbound_safe_uuid(q.user_id) is distinct from p_requested_user_id then
    raise exception 'outbound learning actor does not match queued actor'
      using errcode = '42501';
  end if;

  -- A completed row that already crossed the new guarded seam is immutable.
  -- Replays may read it, but reassignment after completion cannot rewrite its
  -- historical actor proof or graduation outcome.
  if q.status = 'completed' and q.actor_proof_type is not null then
    return q;
  end if;

  select connection.*
  into c
  from public.email_connections connection
  where connection.id = q.connection_id
    and connection.company_id = q.company_id
  for share;

  if c.id is null then
    raise exception 'outbound learning connection does not belong to company';
  end if;

  if q.draft_history_id is not null then
    select draft.*
    into d
    from public.ai_draft_history draft
    where draft.id = q.draft_history_id
      and draft.company_id::text = q.company_id
      and draft.connection_id = q.connection_id
      and draft.user_id = p_requested_user_id
    for share;
  end if;

  -- Provider-accepted OPS send intents are immutable human-actor proof. They
  -- intentionally do not compare the opportunity's current assignment.
  select intent.*
  into send_intent
  from public.email_send_intents intent
  where intent.company_id::text = q.company_id
    and intent.connection_id = q.connection_id
    and intent.provider_message_id = q.provider_message_id
    and intent.actor_user_id = p_requested_user_id
    and intent.status in (
      'provider_accepted',
      'reconciling',
      'reconciliation_failed',
      'reconciled'
    )
    and intent.provider_accepted_at is not null
    and intent.accepted_provider_thread_id = q.provider_thread_id
    and intent.opportunity_id is not distinct from q.opportunity_id
    and intent.draft_history_id is not distinct from q.draft_history_id
    and intent.follow_up_draft_id is not distinct from q.follow_up_draft_id
  order by intent.provider_accepted_at desc, intent.id desc
  limit 1
  for share;

  if send_intent.id is not null then
    v_proof_type := 'accepted_send_intent';
    v_send_intent_id := send_intent.id;
    v_assignment_version := send_intent.assignment_version;
    v_assignment_event_id := send_intent.assignment_event_id;
    v_authority := send_intent.learning_authority;
  else
    select intent.*
    into approved_intent
    from public.approved_action_email_intents intent
    where intent.company_id::text = q.company_id
      and intent.connection_id = q.connection_id
      and intent.provider_message_id = q.provider_message_id
      and intent.actor_user_id = p_requested_user_id
      and intent.status in (
        'provider_accepted',
        'reconciling',
        'reconciliation_failed',
        'reconciled'
      )
      and intent.provider_accepted_at is not null
      and intent.accepted_provider_thread_id = q.provider_thread_id
      and intent.opportunity_id is not distinct from q.opportunity_id
      and intent.draft_history_id is not distinct from q.draft_history_id
    order by intent.provider_accepted_at desc, intent.id desc
    limit 1
    for share;

    if approved_intent.id is not null then
      v_proof_type := 'accepted_approved_action';
      v_approved_intent_id := approved_intent.id;
      v_assignment_version := approved_intent.assignment_version;
      v_assignment_event_id := approved_intent.assignment_event_id;
      v_authority := approved_intent.learning_authority;
    end if;
  end if;

  if v_proof_type is null then
    select actor.*
    into u
    from public.users actor
    where actor.id = p_requested_user_id
      and actor.company_id::text = q.company_id
      and coalesce(actor.is_active, false)
      and actor.deleted_at is null
    for share;

    -- This is the only connector-owner cast in the pipeline and it is guarded
    -- by type='individual'. A legacy company connector user_id is never read as
    -- actor authority.
    if c.type = 'individual' then
      v_owner_id := case
        when c.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then c.user_id::uuid
        else null
      end;
    end if;

    -- Native-mailbox inference is bound to the exact persisted outbound
    -- activity, not just a draft row or connector. Reconcile every available
    -- lead identity before assignment checks; any conflict disables learning.
    select outbound.*
    into activity
    from public.activities outbound
    where outbound.company_id = q.company_id
      and outbound.email_connection_id = q.connection_id
      and outbound.email_message_id = q.provider_message_id
      and outbound.email_thread_id = q.provider_thread_id
      and outbound.direction = 'outbound'
    for share;

    if activity.id is not null
      and (d.id is null or activity.created_at > d.created_at)
      and not (
        q.opportunity_id is not null
        and d.opportunity_id is not null
        and q.opportunity_id is distinct from d.opportunity_id
      )
      and not (
        q.opportunity_id is not null
        and activity.opportunity_id is not null
        and q.opportunity_id is distinct from activity.opportunity_id
      )
      and not (
        d.opportunity_id is not null
        and activity.opportunity_id is not null
        and d.opportunity_id is distinct from activity.opportunity_id
      )
      and (
        q.opportunity_id is null
        or q.opportunity_id is not distinct from coalesce(
          d.opportunity_id,
          activity.opportunity_id
        )
      )
    then
      v_native_provenance_valid := true;
      v_effective_opportunity_id := coalesce(
        q.opportunity_id,
        d.opportunity_id,
        activity.opportunity_id
      );
      if q.opportunity_id is null and v_effective_opportunity_id is not null then
        update public.email_outbound_learning_queue queue_row
        set opportunity_id = v_effective_opportunity_id,
            updated_at = now()
        where queue_row.id = q.id
        returning * into q;
      end if;
    end if;

    if v_native_provenance_valid and q.opportunity_id is not null then
      select opportunity.*
      into o
      from public.opportunities opportunity
      where opportunity.id = q.opportunity_id
        and opportunity.company_id::text = q.company_id
      for share;
    end if;

    if d.id is not null
      and v_native_provenance_valid
      and q.draft_delivery_channel = 'mailbox'
      and u.id is not null
      and c.status = 'active'
      and coalesce(c.sync_enabled, false)
      and (
        c.type = 'company'
        or (c.type = 'individual' and v_owner_id = p_requested_user_id)
      )
      and (
        (
          q.opportunity_id is null
          and c.type = 'individual'
          and private.user_can_send_inbox_connection(
            p_requested_user_id,
            private.try_parse_uuid(q.company_id),
            c.id,
            null
          )
        )
        or (
          o.id is not null
          and o.assigned_to = p_requested_user_id
          and o.assignment_version > 0
          and private.user_can_send_opportunity_inbox(
            p_requested_user_id,
            o.id,
            c.id
          )
        )
      )
    then
      v_proof_type := 'native_mailbox_draft';
      v_assignment_version := case
        when o.id is not null then o.assignment_version
        else null
      end;
      if o.id is not null then
        select event.id
        into v_assignment_event_id
        from public.opportunity_assignment_events event
        where event.opportunity_id = o.id
          and event.assignment_version = o.assignment_version
        order by event.created_at desc, event.id desc
        limit 1;
      end if;
      v_authority := case
        when p_requested_authority = 'operator_approved'
          then 'operator_approved'
        else 'autonomous'
      end;
    elsif d.id is null
      and v_native_provenance_valid
      and c.type = 'individual'
      and v_owner_id = p_requested_user_id
      and u.id is not null
      and c.status = 'active'
      and coalesce(c.sync_enabled, false)
      and (
        (
          q.opportunity_id is null
          and private.user_can_send_inbox_connection(
            p_requested_user_id,
            private.try_parse_uuid(q.company_id),
            c.id,
            null
          )
        )
        or (
          o.id is not null
          and o.assigned_to = p_requested_user_id
          and o.assignment_version > 0
          and private.user_can_send_opportunity_inbox(
            p_requested_user_id,
            o.id,
            c.id
          )
        )
      )
    then
      v_proof_type := 'personal_mailbox_owner';
      v_assignment_version := case
        when o.id is not null then o.assignment_version
        else null
      end;
      if o.id is not null then
        select event.id
        into v_assignment_event_id
        from public.opportunity_assignment_events event
        where event.opportunity_id = o.id
          and event.assignment_version = o.assignment_version
        order by event.created_at desc, event.id desc
        limit 1;
      end if;
      v_authority := case
        when p_requested_authority = 'operator_authored'
          then 'operator_authored'
        else 'autonomous'
      end;
    elsif d.id is not null then
      -- The immutable provider message still closes the draft's sent state,
      -- but it is not evidence about the prior assignee's voice.
      v_proof_type := 'bookkeeping_only';
      v_authority := 'autonomous';
      v_assignment_version := null;
      v_assignment_event_id := null;
    end if;
  end if;

  update public.email_outbound_learning_queue queue_row
  set actor_proof_type = v_proof_type,
      email_send_intent_id = v_send_intent_id,
      approved_action_email_intent_id = v_approved_intent_id,
      assignment_version_snapshot = v_assignment_version,
      assignment_event_id_snapshot = v_assignment_event_id,
      learning_authority = case
        when queue_row.prepared_at is not null
          and queue_row.learning_authority = 'autonomous'
          then 'autonomous'
        else v_authority
      end,
      apply_learning = case
        when v_authority = 'autonomous' and queue_row.prepared_at is not null
          then false
        else queue_row.apply_learning
      end,
      apply_full_body_learning = case
        when v_authority = 'autonomous' and queue_row.prepared_at is not null
          then false
        else queue_row.apply_full_body_learning
      end,
      writing_sample = case
        when v_authority = 'autonomous' then null
        else queue_row.writing_sample
      end,
      memory_extraction = case
        when v_authority = 'autonomous' then null
        else queue_row.memory_extraction
      end,
      draft_correction_facts = case
        when v_authority = 'autonomous' and queue_row.prepared_at is not null
          then '[]'::jsonb
        else queue_row.draft_correction_facts
      end,
      updated_at = now()
  where queue_row.id = q.id
  returning * into q;

  return q;
end;
$function$;

revoke all on function private.bind_email_outbound_learning_actor_proof(
  uuid, uuid, text
) from public, anon, authenticated, service_role;

-- Returns one of: learn, bookkeeping, reject. The function owns the queue row
-- and every mutable authority row until transaction end, so assignment changes
-- cannot race the final profile mutation.
create or replace function private.email_outbound_learning_guard(p_job_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  q public.email_outbound_learning_queue%rowtype;
  c public.email_connections%rowtype;
  d public.ai_draft_history%rowtype;
  activity public.activities%rowtype;
  o public.opportunities%rowtype;
  u public.users%rowtype;
  send_intent public.email_send_intents%rowtype;
  approved_intent public.approved_action_email_intents%rowtype;
  v_actor_id uuid;
  v_owner_id uuid;
begin
  select queue_row.*
  into q
  from public.email_outbound_learning_queue queue_row
  where queue_row.id = p_job_id
  for update;

  if q.id is null then
    return 'reject';
  end if;

  v_actor_id := private.email_outbound_safe_uuid(q.user_id);
  if v_actor_id is null then
    return 'reject';
  end if;

  select actor.*
  into u
  from public.users actor
  where actor.id = v_actor_id
    and actor.company_id::text = q.company_id
    and coalesce(actor.is_active, false)
    and actor.deleted_at is null
  for share;

  if u.id is null then
    return 'reject';
  end if;

  if q.actor_proof_type = 'accepted_send_intent' then
    select intent.*
    into send_intent
    from public.email_send_intents intent
    where intent.id = q.email_send_intent_id
      and intent.company_id::text = q.company_id
      and intent.connection_id = q.connection_id
      and intent.provider_message_id = q.provider_message_id
      and intent.actor_user_id = v_actor_id
      and intent.status in (
        'provider_accepted',
        'reconciling',
        'reconciliation_failed',
        'reconciled'
      )
      and intent.provider_accepted_at is not null
      and intent.accepted_provider_thread_id = q.provider_thread_id
      and intent.opportunity_id is not distinct from q.opportunity_id
      and intent.draft_history_id is not distinct from q.draft_history_id
      and intent.follow_up_draft_id is not distinct from q.follow_up_draft_id
      and intent.assignment_version is not distinct from q.assignment_version_snapshot
      and intent.assignment_event_id is not distinct from q.assignment_event_id_snapshot
      and intent.learning_authority = q.learning_authority
    for share;
    return case when send_intent.id is null then 'reject' else 'learn' end;
  end if;

  if q.actor_proof_type = 'accepted_approved_action' then
    select intent.*
    into approved_intent
    from public.approved_action_email_intents intent
    where intent.id = q.approved_action_email_intent_id
      and intent.company_id::text = q.company_id
      and intent.connection_id = q.connection_id
      and intent.provider_message_id = q.provider_message_id
      and intent.actor_user_id = v_actor_id
      and intent.status in (
        'provider_accepted',
        'reconciling',
        'reconciliation_failed',
        'reconciled'
      )
      and intent.provider_accepted_at is not null
      and intent.accepted_provider_thread_id = q.provider_thread_id
      and intent.opportunity_id is not distinct from q.opportunity_id
      and intent.draft_history_id is not distinct from q.draft_history_id
      and intent.assignment_version is not distinct from q.assignment_version_snapshot
      and intent.assignment_event_id is not distinct from q.assignment_event_id_snapshot
      and intent.learning_authority = q.learning_authority
    for share;
    return case when approved_intent.id is null then 'reject' else 'learn' end;
  end if;

  select connection.*
  into c
  from public.email_connections connection
  where connection.id = q.connection_id
    and connection.company_id = q.company_id
  for share;

  if c.id is null then
    return 'reject';
  end if;

  if q.actor_proof_type = 'bookkeeping_only' then
    if q.draft_history_id is null then
      return 'reject';
    end if;
    select draft.*
    into d
    from public.ai_draft_history draft
    where draft.id = q.draft_history_id
      and draft.company_id::text = q.company_id
      and draft.connection_id = q.connection_id
      and draft.user_id = v_actor_id
    for share;
    return case when d.id is null then 'reject' else 'bookkeeping' end;
  end if;

  if c.status <> 'active' or not coalesce(c.sync_enabled, false) then
    return 'reject';
  end if;

  if c.type = 'individual' then
    v_owner_id := case
      when c.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then c.user_id::uuid
      else null
    end;
    if v_owner_id is distinct from v_actor_id then
      return 'reject';
    end if;
  end if;

  if q.actor_proof_type = 'personal_mailbox_owner' then
    if c.type <> 'individual' or q.draft_history_id is not null then
      return 'reject';
    end if;
  elsif q.actor_proof_type = 'native_mailbox_draft' then
    if q.draft_history_id is null or q.draft_delivery_channel <> 'mailbox' then
      return 'reject';
    end if;
    select draft.*
    into d
    from public.ai_draft_history draft
    where draft.id = q.draft_history_id
      and draft.company_id::text = q.company_id
      and draft.connection_id = q.connection_id
      and draft.user_id = v_actor_id
    for share;
    if d.id is null then
      return 'reject';
    end if;
  else
    return 'reject';
  end if;

  select outbound.*
  into activity
  from public.activities outbound
  where outbound.company_id = q.company_id
    and outbound.email_connection_id = q.connection_id
    and outbound.email_message_id = q.provider_message_id
    and outbound.email_thread_id = q.provider_thread_id
    and outbound.direction = 'outbound'
  for share;

  if activity.id is null
    or (d.id is not null and activity.created_at <= d.created_at)
    or (
      q.opportunity_id is not null
      and d.opportunity_id is not null
      and q.opportunity_id is distinct from d.opportunity_id
    )
    or (
      q.opportunity_id is not null
      and activity.opportunity_id is not null
      and q.opportunity_id is distinct from activity.opportunity_id
    )
    or (
      d.opportunity_id is not null
      and activity.opportunity_id is not null
      and d.opportunity_id is distinct from activity.opportunity_id
    )
    or q.opportunity_id is distinct from coalesce(
      d.opportunity_id,
      activity.opportunity_id
    )
  then
    return case
      when q.draft_history_id is not null then 'bookkeeping'
      else 'reject'
    end;
  end if;

  if q.opportunity_id is not null then
    select opportunity.*
    into o
    from public.opportunities opportunity
    where opportunity.id = q.opportunity_id
      and opportunity.company_id::text = q.company_id
    for share;

    if o.id is null
      or o.assigned_to <> v_actor_id
      or o.assignment_version <> q.assignment_version_snapshot
      or not private.user_can_send_opportunity_inbox(
        v_actor_id,
        o.id,
        q.connection_id
      )
    then
      return case
        when q.draft_history_id is not null then 'bookkeeping'
        else 'reject'
      end;
    end if;
  elsif c.type = 'company'
    or not private.user_can_send_inbox_connection(
      v_actor_id,
      private.try_parse_uuid(q.company_id),
      q.connection_id,
      null
    )
  then
    -- Shared native-mailbox sends have no provider actor. Without a lead and
    -- current assignee snapshot there is no safe human attribution.
    return case
      when q.draft_history_id is not null then 'bookkeeping'
      else 'reject'
    end;
  end if;

  return 'learn';
end;
$function$;

revoke all on function private.email_outbound_learning_guard(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.sanitize_email_outbound_learning_bookkeeping(
  p_job_id uuid
)
returns public.email_outbound_learning_queue
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  q public.email_outbound_learning_queue%rowtype;
begin
  update public.email_outbound_learning_queue queue_row
  set actor_proof_type = 'bookkeeping_only',
      email_send_intent_id = null,
      approved_action_email_intent_id = null,
      assignment_version_snapshot = null,
      assignment_event_id_snapshot = null,
      learning_authority = 'autonomous',
      apply_learning = case
        when queue_row.prepared_at is null then null
        else false
      end,
      apply_full_body_learning = case
        when queue_row.prepared_at is null then null
        else false
      end,
      writing_sample = null,
      memory_extraction = null,
      draft_correction_facts = case
        when queue_row.prepared_at is null then null
        else '[]'::jsonb
      end,
      updated_at = now()
  where queue_row.id = p_job_id
    and queue_row.draft_history_id is not null
  returning * into q;
  return q;
end;
$function$;

revoke all on function private.sanitize_email_outbound_learning_bookkeeping(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.fail_email_outbound_learning_actor_proof(
  p_job_id uuid,
  p_reason text
)
returns public.email_outbound_learning_queue
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  q public.email_outbound_learning_queue%rowtype;
begin
  update public.email_outbound_learning_queue queue_row
  set learning_authority = 'autonomous',
      apply_learning = case
        when queue_row.prepared_at is null then null
        else false
      end,
      apply_full_body_learning = case
        when queue_row.prepared_at is null then null
        else false
      end,
      writing_sample = null,
      memory_extraction = null,
      draft_correction_facts = case
        when queue_row.prepared_at is null then null
        else '[]'::jsonb
      end,
      status = 'failed',
      lease_token = null,
      lease_expires_at = null,
      last_error = left(coalesce(nullif(btrim(p_reason), ''), 'actor proof rejected'), 4000),
      last_failed_at = now(),
      last_terminal_error = left(
        coalesce(nullif(btrim(p_reason), ''), 'actor proof rejected'),
        4000
      ),
      updated_at = now()
  where queue_row.id = p_job_id
    and queue_row.status <> 'completed'
  returning * into q;
  return q;
end;
$function$;

revoke all on function private.fail_email_outbound_learning_actor_proof(
  uuid, text
) from public, anon, authenticated, service_role;

create or replace function public.resolve_email_outbound_learning_mailbox_actor_as_system(
  p_company_id uuid,
  p_connection_id uuid,
  p_draft_history_id uuid,
  p_provider_message_id text,
  p_provider_thread_id text,
  p_outcome text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  c public.email_connections%rowtype;
  d public.ai_draft_history%rowtype;
  activity public.activities%rowtype;
  o public.opportunities%rowtype;
  u public.users%rowtype;
  v_actor_id uuid;
  v_assignment_event_id uuid;
  v_effective_opportunity_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_outcome not in ('used', 'from_scratch') then
    raise exception 'invalid_mailbox_draft_outcome' using errcode = '22023';
  end if;
  if nullif(btrim(p_provider_message_id), '') is null
    or nullif(btrim(p_provider_thread_id), '') is null
  then
    return null;
  end if;

  select connection.*
  into c
  from public.email_connections connection
  where connection.id = p_connection_id
    and connection.company_id = p_company_id::text
    and connection.status = 'active'
    and coalesce(connection.sync_enabled, false)
  for share;

  if c.id is null then
    return null;
  end if;

  select draft.*
  into d
  from public.ai_draft_history draft
  where draft.id = p_draft_history_id
    and draft.company_id = p_company_id
    and draft.connection_id = p_connection_id
    and draft.origin = 'phase_c'
    and draft.status = 'auto_drafted'
    and nullif(btrim(draft.mailbox_draft_id), '') is not null
    and draft.thread_id = btrim(p_provider_thread_id)
  for share;

  if d.id is null then
    return null;
  end if;

  select outbound.*
  into activity
  from public.activities outbound
  where outbound.company_id = p_company_id::text
    and outbound.email_connection_id = p_connection_id
    and outbound.email_message_id = btrim(p_provider_message_id)
    and outbound.email_thread_id = btrim(p_provider_thread_id)
    and outbound.direction = 'outbound'
    and outbound.created_at > d.created_at
  for share;

  if activity.id is null
    or (
      d.opportunity_id is not null
      and activity.opportunity_id is not null
      and d.opportunity_id is distinct from activity.opportunity_id
    )
  then
    return null;
  end if;
  v_effective_opportunity_id := coalesce(
    d.opportunity_id,
    activity.opportunity_id
  );

  if c.type = 'individual' then
    if c.user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return null;
    end if;
    v_actor_id := c.user_id::uuid;
    if d.user_id is distinct from v_actor_id then
      return null;
    end if;
  else
    -- A shared mailbox never supplies a human actor. Only the exact current
    -- assignee who owns the used AI draft can be inferred. A fresh reply from
    -- the shared mailbox remains unattributed.
    if p_outcome <> 'used' then
      return null;
    end if;
    v_actor_id := d.user_id;
  end if;

  select actor.*
  into u
  from public.users actor
  where actor.id = v_actor_id
    and actor.company_id = p_company_id
    and coalesce(actor.is_active, false)
    and actor.deleted_at is null
  for share;

  if u.id is null then
    return null;
  end if;

  if v_effective_opportunity_id is null then
    if c.type <> 'individual'
      or not private.user_can_send_inbox_connection(
        v_actor_id,
        p_company_id,
        c.id,
        null
      )
    then
      return null;
    end if;
    return jsonb_build_object(
      'actorUserId', v_actor_id,
      'opportunityId', null,
      'assignmentVersion', null,
      'assignmentEventId', null,
      'proofType', 'personal_mailbox_owner'
    );
  end if;

  select opportunity.*
  into o
  from public.opportunities opportunity
  where opportunity.id = v_effective_opportunity_id
    and opportunity.company_id = p_company_id
  for share;

  if o.id is null
    or o.assigned_to is distinct from v_actor_id
    or o.assignment_version <= 0
    or not private.user_can_send_opportunity_inbox(
      v_actor_id,
      o.id,
      c.id
    )
  then
    return null;
  end if;

  select event.id
  into v_assignment_event_id
  from public.opportunity_assignment_events event
  where event.opportunity_id = o.id
    and event.assignment_version = o.assignment_version
  order by event.created_at desc, event.id desc
  limit 1;

  return jsonb_build_object(
    'actorUserId', v_actor_id,
    'opportunityId', o.id,
    'assignmentVersion', o.assignment_version,
    'assignmentEventId', v_assignment_event_id,
    'proofType', case
      when c.type = 'individual' then 'personal_mailbox_owner'
      else 'native_mailbox_draft'
    end
  );
end;
$function$;

revoke all on function public.resolve_email_outbound_learning_mailbox_actor_as_system(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.resolve_email_outbound_learning_mailbox_actor_as_system(
  uuid, uuid, uuid, text, text, text
) to service_role;

create or replace function public.get_human_draft_accuracy_as_system(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_profile_types text[] default null,
  p_limit integer default 50
)
returns table (
  draft_outcome jsonb,
  profile_type text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.users u
    where u.id = p_actor_user_id
      and u.company_id = p_company_id
      and coalesce(u.is_active, false)
      and u.deleted_at is null
  ) then
    return;
  end if;

  return query
  select q.draft_outcome, q.profile_type
  from public.email_outbound_learning_queue q
  where q.company_id = p_company_id::text
    and q.user_id = p_actor_user_id::text
    and q.status = 'completed'
    and q.learning_authority = 'operator_approved'
    and q.apply_learning is true
    and q.draft_history_id is not null
    and q.draft_outcome is not null
    and q.actor_proof_type in (
      'accepted_send_intent',
      'accepted_approved_action',
      'native_mailbox_draft'
    )
    and (
      p_profile_types is null
      or cardinality(p_profile_types) = 0
      or q.profile_type = any (p_profile_types)
    )
  order by q.occurred_at desc nulls last, q.completed_at desc, q.id desc
  limit v_limit;
end;
$function$;

revoke all on function public.get_human_draft_accuracy_as_system(
  uuid, uuid, text[], integer
) from public, anon, authenticated, service_role;
grant execute on function public.get_human_draft_accuracy_as_system(
  uuid, uuid, text[], integer
) to service_role;

create or replace function public.list_phase_c_graduation_actor_scopes_as_system(
  p_limit integer default 200
)
returns table (
  company_id uuid,
  connection_id uuid,
  actor_user_id uuid
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 200), 1000));
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  return query
  select candidate.company_id, candidate.connection_id, candidate.actor_user_id
  from (
    select distinct
      company.id as company_id,
      connection.id as connection_id,
      actor.id as actor_user_id
    from public.email_outbound_learning_queue q
    join public.companies company
      on company.id::text = q.company_id
    join public.email_connections connection
      on connection.id = q.connection_id
     and connection.company_id = q.company_id
     and connection.status = 'active'
     and coalesce(connection.sync_enabled, false)
    join public.users actor
      on actor.id::text = q.user_id
     and actor.company_id = company.id
     and coalesce(actor.is_active, false)
     and actor.deleted_at is null
    where q.status = 'completed'
      and q.learning_authority = 'operator_approved'
      and q.apply_learning is true
      and q.draft_history_id is not null
      and q.actor_proof_type in (
        'accepted_send_intent',
        'accepted_approved_action',
        'native_mailbox_draft'
      )
  ) candidate
  order by candidate.company_id, candidate.connection_id, candidate.actor_user_id
  limit v_limit;
end;
$function$;

revoke all on function public.list_phase_c_graduation_actor_scopes_as_system(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_phase_c_graduation_actor_scopes_as_system(integer)
  to service_role;

-- Remove every externally callable pre-assignment implementation. The new
-- wrappers keep the same public signatures for runtime compatibility, but the
-- old bodies can only execute behind the proof guard.
alter function public.enqueue_email_outbound_learning(
  text, uuid, text, text, text, text, text[], text, text, text,
  timestamptz, uuid, uuid, uuid, text, text, text
) rename to enqueue_email_outbound_learning_pre_assignment_internal;

alter function public.claim_email_outbound_learning(integer, integer)
  rename to claim_email_outbound_learning_pre_assignment_internal;

alter function public.prepare_email_outbound_learning(
  uuid, uuid, boolean, boolean, jsonb, jsonb, jsonb, jsonb, text
) rename to prepare_email_outbound_learning_pre_assignment_internal;

alter function public.promote_email_outbound_edit_learning(uuid)
  rename to promote_email_outbound_edit_learning_pre_assignment_internal;

alter function public.apply_email_outbound_learning(uuid, uuid)
  rename to apply_email_outbound_learning_pre_assignment_internal;

revoke all on function public.enqueue_email_outbound_learning_pre_assignment_internal(
  text, uuid, text, text, text, text, text[], text, text, text,
  timestamptz, uuid, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.claim_email_outbound_learning_pre_assignment_internal(
  integer, integer
) from public, anon, authenticated, service_role;
revoke all on function public.prepare_email_outbound_learning_pre_assignment_internal(
  uuid, uuid, boolean, boolean, jsonb, jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function public.promote_email_outbound_edit_learning_pre_assignment_internal(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_email_outbound_learning_pre_assignment_internal(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.enqueue_email_outbound_learning(
  p_company_id text,
  p_connection_id uuid,
  p_provider_message_id text,
  p_provider_thread_id text default null,
  p_user_id text default null,
  p_from_email text default null,
  p_to_emails text[] default null,
  p_subject text default null,
  p_authored_body text default null,
  p_clean_body text default null,
  p_occurred_at timestamptz default null,
  p_draft_history_id uuid default null,
  p_follow_up_draft_id uuid default null,
  p_opportunity_id uuid default null,
  p_draft_delivery_channel text default null,
  p_profile_type text default 'general',
  p_learning_authority text default 'autonomous'
)
returns public.email_outbound_learning_queue
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  q public.email_outbound_learning_queue%rowtype;
  v_actor_id uuid;
  v_guard text;
  v_profile_type text := nullif(btrim(p_profile_type), '');
begin
  v_actor_id := private.email_outbound_safe_uuid(p_user_id);
  if v_actor_id is null then
    raise exception 'outbound learning actor must be an OPS user UUID'
      using errcode = '22023';
  end if;
  if v_profile_type is null or length(v_profile_type) > 64 then
    raise exception 'outbound learning profile type is invalid'
      using errcode = '22023';
  end if;

  -- Call only the original persistence primitive with an explicit actor. The
  -- retired authority wrapper is never executed, so its old email/connector
  -- heuristics cannot run. The guarded binder below derives final authority
  -- from immutable records.
  q := public.enqueue_email_outbound_learning_legacy_internal(
    p_company_id,
    p_connection_id,
    p_provider_message_id,
    p_provider_thread_id,
    p_user_id,
    p_from_email,
    p_to_emails,
    p_subject,
    p_authored_body,
    p_clean_body,
    p_occurred_at,
    p_draft_history_id,
    p_follow_up_draft_id,
    p_opportunity_id,
    p_draft_delivery_channel
  );

  select queue_row.*
  into q
  from public.email_outbound_learning_queue queue_row
  where queue_row.id = q.id
  for update;

  if q.prepared_at is not null
    and q.profile_type <> v_profile_type
    and v_profile_type <> 'general'
  then
    raise exception 'outbound learning prepared profile type cannot change';
  end if;
  if q.prepared_at is null
    and q.profile_type <> 'general'
    and v_profile_type <> 'general'
    and q.profile_type <> v_profile_type
  then
    raise exception 'outbound learning profile type conflicts with queued provenance';
  end if;

  update public.email_outbound_learning_queue queue_row
  set profile_type = case
        when queue_row.prepared_at is null
          and queue_row.profile_type = 'general'
          and v_profile_type <> 'general'
          then v_profile_type
        else queue_row.profile_type
      end,
      updated_at = now()
  where queue_row.id = q.id
  returning * into q;

  q := private.bind_email_outbound_learning_actor_proof(
    q.id,
    v_actor_id,
    p_learning_authority
  );
  v_guard := private.email_outbound_learning_guard(q.id);

  if v_guard = 'bookkeeping' then
    q := private.sanitize_email_outbound_learning_bookkeeping(q.id);
  elsif v_guard <> 'learn' then
    q := private.fail_email_outbound_learning_actor_proof(
      q.id,
      'outbound learning enqueue actor proof rejected'
    );
    if q.id is null then
      select queue_row.*
      into q
      from public.email_outbound_learning_queue queue_row
      where queue_row.company_id = p_company_id
        and queue_row.connection_id = p_connection_id
        and queue_row.provider_message_id = btrim(p_provider_message_id);
    end if;
  end if;
  return q;
end;
$function$;

revoke all on function public.enqueue_email_outbound_learning(
  text, uuid, text, text, text, text, text[], text, text, text,
  timestamptz, uuid, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.enqueue_email_outbound_learning(
  text, uuid, text, text, text, text, text[], text, text, text,
  timestamptz, uuid, uuid, uuid, text, text, text
) to service_role;

create or replace function public.claim_email_outbound_learning(
  p_limit integer default 25,
  p_lease_seconds integer default 300
)
returns setof public.email_outbound_learning_queue
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  q public.email_outbound_learning_queue%rowtype;
  v_guard text;
begin
  for q in
    select *
    from public.claim_email_outbound_learning_pre_assignment_internal(
      p_limit,
      p_lease_seconds
    )
  loop
    if q.status = 'failed' then
      return next q;
      continue;
    end if;

    v_guard := private.email_outbound_learning_guard(q.id);
    if v_guard = 'bookkeeping' then
      q := private.sanitize_email_outbound_learning_bookkeeping(q.id);
    elsif v_guard <> 'learn' then
      q := private.fail_email_outbound_learning_actor_proof(
        q.id,
        'outbound learning claim actor proof rejected'
      );
    else
      select queue_row.*
      into q
      from public.email_outbound_learning_queue queue_row
      where queue_row.id = q.id;
    end if;
    return next q;
  end loop;
  return;
end;
$function$;

revoke all on function public.claim_email_outbound_learning(integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_email_outbound_learning(integer, integer)
  to service_role;

create or replace function public.prepare_email_outbound_learning(
  p_job_id uuid,
  p_lease_token uuid,
  p_apply_learning boolean,
  p_apply_full_body_learning boolean,
  p_writing_sample jsonb,
  p_memory_extraction jsonb,
  p_draft_outcome jsonb,
  p_draft_correction_facts jsonb,
  p_preparation_version text
)
returns public.email_outbound_learning_queue
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  q public.email_outbound_learning_queue%rowtype;
  v_guard text;
begin
  v_guard := private.email_outbound_learning_guard(p_job_id);
  if v_guard = 'reject' then
    raise exception 'outbound learning preparation actor proof rejected'
      using errcode = '42501';
  end if;
  if v_guard = 'bookkeeping' then
    q := private.sanitize_email_outbound_learning_bookkeeping(p_job_id);
    return public.prepare_email_outbound_learning_pre_assignment_internal(
      p_job_id,
      p_lease_token,
      false,
      false,
      null,
      null,
      p_draft_outcome,
      '[]'::jsonb,
      p_preparation_version
    );
  end if;

  return public.prepare_email_outbound_learning_pre_assignment_internal(
    p_job_id,
    p_lease_token,
    p_apply_learning,
    p_apply_full_body_learning,
    p_writing_sample,
    p_memory_extraction,
    p_draft_outcome,
    p_draft_correction_facts,
    p_preparation_version
  );
end;
$function$;

revoke all on function public.prepare_email_outbound_learning(
  uuid, uuid, boolean, boolean, jsonb, jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.prepare_email_outbound_learning(
  uuid, uuid, boolean, boolean, jsonb, jsonb, jsonb, jsonb, text
) to service_role;

create or replace function public.promote_email_outbound_edit_learning(
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_guard text;
begin
  v_guard := private.email_outbound_learning_guard(p_job_id);
  if v_guard <> 'learn' then
    return jsonb_build_object(
      'queueId', p_job_id,
      'evidenceInserted', 0,
      'promotionsInserted', 0,
      'skipped', true,
      'guard', v_guard
    );
  end if;
  return public.promote_email_outbound_edit_learning_pre_assignment_internal(
    p_job_id
  );
end;
$function$;

revoke all on function public.promote_email_outbound_edit_learning(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.promote_email_outbound_edit_learning(uuid)
  to service_role;

create or replace function public.apply_email_outbound_learning(
  p_job_id uuid,
  p_lease_token uuid
)
returns public.email_outbound_learning_queue
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  q public.email_outbound_learning_queue%rowtype;
  v_guard text;
begin
  v_guard := private.email_outbound_learning_guard(p_job_id);
  if v_guard = 'reject' then
    raise exception 'outbound learning application actor proof rejected'
      using errcode = '42501';
  end if;
  if v_guard = 'bookkeeping' then
    q := private.sanitize_email_outbound_learning_bookkeeping(p_job_id);
  end if;
  return public.apply_email_outbound_learning_pre_assignment_internal(
    p_job_id,
    p_lease_token
  );
end;
$function$;

revoke all on function public.apply_email_outbound_learning(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_email_outbound_learning(uuid, uuid)
  to service_role;

-- Signature settings are human mutations even though the web route uses the
-- service client. Bind every write to the canonical active OPS actor at the
-- SQL boundary. For a company mailbox, a non-integration-admin must still
-- control at least one active opportunity through the canonical
-- pipeline-edit + inbox-send intersection. Lock that opportunity exactly as
-- assignment does so reassignment cannot race between authorization and the
-- signature write. Individual mailbox ownership is the only place connection
-- user_id is considered, and only after type='individual' is established.
create or replace function private.user_can_access_email_signature(
  p_actor_user_id uuid,
  p_connection_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  actor public.users%rowtype;
  connection public.email_connections%rowtype;
begin
  if p_actor_user_id is null or p_connection_id is null then
    return false;
  end if;

  select actor_row.*
  into actor
  from public.users actor_row
  where actor_row.id = p_actor_user_id
    and actor_row.deleted_at is null
    and coalesce(actor_row.is_active, false);

  if actor.id is null or actor.company_id is null then
    return false;
  end if;

  select connection_row.*
  into connection
  from public.email_connections connection_row
  where connection_row.id = p_connection_id
    and connection_row.company_id = actor.company_id::text
    and connection_row.status = 'active'
    and connection_row.type in ('company', 'individual');

  if connection.id is null then
    return false;
  end if;

  if connection.type = 'individual' then
    return private.email_outbound_safe_uuid(connection.user_id)
      is not distinct from p_actor_user_id;
  end if;

  if connection.type <> 'company' then
    return false;
  end if;

  -- Company connection user_id is legacy connector metadata. It is never read
  -- in this branch and cannot confer OPS actor authority.
  if coalesce(
    public.has_permission(
      p_actor_user_id,
      'settings.integrations',
      'all'
    ),
    false
  ) then
    return true;
  end if;

  -- Do not pre-filter assigned_to here. The canonical helper owns both
  -- assigned/all scope semantics and explicit granular revokes.
  return exists (
    select 1
    from public.opportunities opportunity
    where opportunity.company_id = actor.company_id
      and opportunity.deleted_at is null
      and opportunity.archived_at is null
      and private.user_can_send_opportunity_inbox(
        p_actor_user_id,
        opportunity.id,
        connection.id
      )
  );
end;
$function$;

revoke all on function private.user_can_access_email_signature(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.authorize_email_signature_access_as_system(
  p_actor_user_id uuid,
  p_connection_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  return private.user_can_access_email_signature(
    p_actor_user_id,
    p_connection_id
  );
end;
$function$;

revoke all on function public.authorize_email_signature_access_as_system(
  uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.authorize_email_signature_access_as_system(
  uuid, uuid
) to service_role;

create or replace function private.authorize_email_signature_mutation(
  p_actor_user_id uuid,
  p_connection_id uuid
)
returns public.email_connections
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  actor public.users%rowtype;
  connection public.email_connections%rowtype;
  authorizing_opportunity public.opportunities%rowtype;
begin
  if p_actor_user_id is null or p_connection_id is null then
    raise exception 'email_signature_access_denied' using errcode = '42501';
  end if;

  select actor_row.*
  into actor
  from public.users actor_row
  where actor_row.id = p_actor_user_id
    and actor_row.deleted_at is null
    and coalesce(actor_row.is_active, false)
  for share;

  if actor.id is null then
    raise exception 'email_signature_access_denied' using errcode = '42501';
  end if;

  select connection_row.*
  into connection
  from public.email_connections connection_row
  where connection_row.id = p_connection_id
    and connection_row.company_id = actor.company_id::text
    and connection_row.status = 'active'
    and connection_row.type in ('company', 'individual')
  for share;

  if connection.id is null then
    raise exception 'email_signature_access_denied' using errcode = '42501';
  end if;

  if connection.type = 'individual' then
    if private.email_outbound_safe_uuid(connection.user_id)
      is distinct from p_actor_user_id
    then
      raise exception 'email_signature_access_denied' using errcode = '42501';
    end if;
    return connection;
  end if;

  if connection.type <> 'company' then
    raise exception 'email_signature_access_denied' using errcode = '42501';
  end if;

  -- Company connection user_id is legacy connector metadata. It is
  -- deliberately never read in this branch and cannot confer authority.
  if coalesce(
    public.has_permission(
      p_actor_user_id,
      'settings.integrations',
      'all'
    ),
    false
  ) then
    return connection;
  end if;

  select opportunity.*
  into authorizing_opportunity
  from public.opportunities opportunity
  where opportunity.company_id = actor.company_id
    and opportunity.deleted_at is null
    and opportunity.archived_at is null
    and private.user_can_send_opportunity_inbox(
      p_actor_user_id,
      opportunity.id,
      connection.id
    )
  order by opportunity.id
  limit 1
  for update;

  -- Re-check after acquiring the same opportunity row lock used by guarded
  -- assignment. If a concurrent assignment won the lock first, the refreshed
  -- row must still authorize this exact actor + mailbox pair.
  if authorizing_opportunity.id is null
    or not private.user_can_send_opportunity_inbox(
      p_actor_user_id,
      authorizing_opportunity.id,
      connection.id
    )
  then
    raise exception 'email_signature_access_denied' using errcode = '42501';
  end if;

  return connection;
end;
$function$;

revoke all on function private.authorize_email_signature_mutation(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.replace_email_signature_as_system(
  p_actor_user_id uuid,
  p_connection_id uuid,
  p_source text,
  p_content_html text,
  p_content_text text,
  p_content_hash text,
  p_provider_identity text,
  p_fetched_at timestamptz,
  p_confirmed_at timestamptz
)
returns public.email_signatures
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_connection public.email_connections%rowtype;
  v_company_id uuid;
  v_scope_user_id uuid;
  v_provider_identity text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  v_connection := private.authorize_email_signature_mutation(
    p_actor_user_id,
    p_connection_id
  );
  v_company_id := private.email_outbound_safe_uuid(v_connection.company_id);
  if v_company_id is null then
    raise exception 'email_signature_access_denied' using errcode = '42501';
  end if;

  if p_source = 'ops' then
    if p_provider_identity is not null then
      raise exception 'email_signature_provider_identity_invalid'
        using errcode = '22023';
    end if;
    v_scope_user_id := p_actor_user_id;
    v_provider_identity := null;
  elsif p_source in ('gmail_send_as', 'microsoft_confirmed') then
    if nullif(btrim(v_connection.email), '') is null
      or lower(btrim(p_provider_identity))
        is distinct from lower(btrim(v_connection.email))
    then
      raise exception 'email_signature_provider_identity_invalid'
        using errcode = '22023';
    end if;
    v_scope_user_id := null;
    v_provider_identity := lower(btrim(v_connection.email));
  else
    raise exception 'email_signature_source_invalid' using errcode = '22023';
  end if;

  return public.replace_email_signature(
    v_company_id,
    v_connection.id,
    v_scope_user_id,
    p_source,
    p_content_html,
    p_content_text,
    p_content_hash,
    v_provider_identity,
    p_fetched_at,
    p_confirmed_at,
    p_actor_user_id
  );
end;
$function$;

-- The original persistence primitive is now owner-internal. No trusted
-- actorless signature writer exists in the application, so retaining a broad
-- service-role bypass would only recreate the reassignment vulnerability.
revoke all on function public.replace_email_signature(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, uuid
) from public, anon, authenticated, service_role;
revoke insert, update, delete on table public.email_signatures
  from service_role;

revoke all on function public.replace_email_signature_as_system(
  uuid, uuid, text, text, text, text, text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.replace_email_signature_as_system(
  uuid, uuid, text, text, text, text, text, timestamptz, timestamptz
) to service_role;

create or replace function public.deactivate_email_signature_as_system(
  p_actor_user_id uuid,
  p_connection_id uuid,
  p_signature_id uuid default null,
  p_source text default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_connection public.email_connections%rowtype;
  v_company_id uuid;
  v_source text := p_source;
  v_scope_user_id uuid;
  v_lock_key text;
  v_updated_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_signature_id is null and p_source is null then
    raise exception 'email_signature_target_required' using errcode = '22023';
  end if;
  if p_source is not null
    and p_source not in ('ops', 'gmail_send_as', 'microsoft_confirmed')
  then
    raise exception 'email_signature_source_invalid' using errcode = '22023';
  end if;

  v_connection := private.authorize_email_signature_mutation(
    p_actor_user_id,
    p_connection_id
  );
  v_company_id := private.email_outbound_safe_uuid(v_connection.company_id);
  if v_company_id is null then
    raise exception 'email_signature_access_denied' using errcode = '42501';
  end if;

  if p_signature_id is not null then
    select s.source
    into v_source
    from public.email_signatures s
    where s.id = p_signature_id
      and s.company_id = v_company_id
      and s.connection_id = v_connection.id
      and s.active
      and (
        (
          s.source = 'ops'
          and s.scope_user_id = p_actor_user_id
          and s.provider_identity is null
        )
        or (
          s.source in ('gmail_send_as', 'microsoft_confirmed')
          and s.scope_user_id is null
          and lower(btrim(s.provider_identity)) = lower(btrim(v_connection.email))
        )
      )
    limit 1;

    if v_source is null then
      return 0;
    end if;
    if p_source is not null and p_source is distinct from v_source then
      raise exception 'email_signature_target_mismatch' using errcode = '22023';
    end if;
  end if;

  v_scope_user_id := case when v_source = 'ops'
    then p_actor_user_id else null end;
  v_lock_key := 'email-signature:'
    || v_company_id::text || ':'
    || v_connection.id::text || ':'
    || coalesce(v_scope_user_id::text, 'mailbox') || ':'
    || v_source;
  perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

  update public.email_signatures s
  set active = false,
      updated_by = p_actor_user_id
  where s.company_id = v_company_id
    and s.connection_id = v_connection.id
    and s.active
    and s.source = v_source
    and (p_signature_id is null or s.id = p_signature_id)
    and (
      (
        s.source = 'ops'
        and s.scope_user_id = p_actor_user_id
        and s.provider_identity is null
      )
      or (
        s.source in ('gmail_send_as', 'microsoft_confirmed')
        and s.scope_user_id is null
        and lower(btrim(s.provider_identity)) = lower(btrim(v_connection.email))
      )
    );
  get diagnostics v_updated_count = row_count;

  return v_updated_count;
end;
$function$;

revoke all on function public.deactivate_email_signature_as_system(
  uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.deactivate_email_signature_as_system(
  uuid, uuid, uuid, text
) to service_role;

-- Existing unfinished rows must cross the new proof seam before another model
-- or profile write. Malformed legacy text identities fail individually without
-- aborting the batch. Completed pre-proof rows remain historical bookkeeping
-- only and are excluded from calibration/graduation reads.
do $backfill$
declare
  queued record;
  v_actor_id uuid;
  v_guard text;
begin
  for queued in
    select q.id, q.user_id, q.learning_authority
    from public.email_outbound_learning_queue q
    where q.status <> 'completed'
    order by q.created_at, q.id
  loop
    begin
      v_actor_id := private.email_outbound_safe_uuid(queued.user_id);
      if v_actor_id is null then
        perform private.fail_email_outbound_learning_actor_proof(
          queued.id,
          'legacy outbound learning actor is not a valid OPS UUID'
        );
        continue;
      end if;

      perform private.bind_email_outbound_learning_actor_proof(
        queued.id,
        v_actor_id,
        queued.learning_authority
      );
      v_guard := private.email_outbound_learning_guard(queued.id);
      if v_guard = 'bookkeeping' then
        perform private.sanitize_email_outbound_learning_bookkeeping(queued.id);
      elsif v_guard <> 'learn' then
        perform private.fail_email_outbound_learning_actor_proof(
          queued.id,
          'legacy outbound learning actor proof rejected'
        );
      end if;
    exception
      when others then
        perform private.fail_email_outbound_learning_actor_proof(
          queued.id,
          'legacy outbound learning actor proof failed closed'
        );
    end;
  end loop;

  update public.email_outbound_learning_queue q
  set learning_authority = 'autonomous',
      apply_learning = false,
      apply_full_body_learning = false,
      writing_sample = null,
      memory_extraction = null,
      draft_correction_facts = '[]'::jsonb,
      updated_at = now()
  where q.status = 'completed'
    and q.actor_proof_type is null;
end;
$backfill$;

commit;
