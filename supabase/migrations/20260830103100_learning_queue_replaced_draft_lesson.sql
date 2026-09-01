-- Capture replacement lessons from operator rewrites (cc90c3ed).
--
-- When the operator ignores an OPS draft and writes their own reply, the
-- lesson lives in the delta: the qualification we missed, the arithmetic we
-- got wrong, the tone we over-wrote. Reconciliation deliberately never
-- attaches the discarded draft as the SENT draft — that would book a bogus
-- 100% rewrite against edit statistics and poison the writing profile — so
-- until now the correction was simply thrown away.
--
-- This migration gives the rewrite its own provenance pointer and admits it
-- through the proof chain that guards learning:
--
--   1. `email_outbound_learning_queue.replaced_draft_history_id` records the
--      draft that was replaced.
--   2. `email_outbound_learning_actor_proof_check` gains the
--      `company_mailbox_assignee` arm, which (like the native-draft arm) can
--      only exist alongside an assignment snapshot.
--   3. `private.bind_email_outbound_learning_actor_proof` mints that proof for
--      a company-type connection when the replaced draft belongs to the exact
--      current assignee, on this connection and thread, and the send followed
--      it. Every check the native-draft arm makes is made here too.
--   4. `private.email_outbound_learning_guard` re-validates the same proof.
--   5. `public.enqueue_email_outbound_learning` accepts the new pointer.
--
-- Companion to 20260830103000, which taught
-- `resolve_email_outbound_learning_mailbox_actor_as_system` to resolve the
-- actor in the first place. Neither half learns anything alone: the actor RPC
-- names the operator, this file lets the proof survive the binder and the
-- guard. Personal mailboxes, OPS send intents and approved-action intents are
-- untouched, and rows without a replaced draft take exactly the paths they
-- take today (`replaced_draft_history_id` is null for every existing row, so
-- every new predicate is inert for them).
--
-- Autonomy graduation is deliberately NOT widened: the new proof type is not
-- added to `list_phase_c_graduation_actor_scopes_as_system` or the accuracy
-- readers, so the blast radius stays training data — never sending.

begin;

alter table public.email_outbound_learning_queue
  add column if not exists replaced_draft_history_id uuid
    references public.ai_draft_history(id);

comment on column public.email_outbound_learning_queue.replaced_draft_history_id
is 'The OPS draft this send replaced. Provenance for the memory-only replacement lesson; never the sent draft, and never counted in edit statistics.';

-- Widen the actor-proof shape check with the rewrite arm. Every existing arm
-- is preserved verbatim, so every stored row still satisfies the constraint.
do $migration$
begin
  alter table public.email_outbound_learning_queue
    drop constraint if exists email_outbound_learning_actor_proof_check;

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
        -- A rewrite on a shared mailbox is only ever attributable through the
        -- lead's current assignment, so the snapshot is mandatory.
        actor_proof_type = 'company_mailbox_assignee'
        and email_send_intent_id is null
        and approved_action_email_intent_id is null
        and replaced_draft_history_id is not null
        and opportunity_id is not null
        and assignment_version_snapshot is not null
      )
      or (
        actor_proof_type = 'bookkeeping_only'
        and email_send_intent_id is null
        and approved_action_email_intent_id is null
        and assignment_version_snapshot is null
        and assignment_event_id_snapshot is null
      )
    );
end;
$migration$;

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
  rd public.ai_draft_history%rowtype;
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

  -- The draft the operator threw away. It is provenance for a rewrite, never
  -- the sent draft, so it is loaded separately and held to the same identity
  -- as an attached draft: same company, connection, owner and thread.
  if q.replaced_draft_history_id is not null then
    select draft.*
    into rd
    from public.ai_draft_history draft
    where draft.id = q.replaced_draft_history_id
      and draft.company_id::text = q.company_id
      and draft.connection_id = q.connection_id
      and draft.user_id = p_requested_user_id
      and draft.origin = 'phase_c'
      and nullif(btrim(draft.mailbox_draft_id), '') is not null
      and draft.thread_id = q.provider_thread_id
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
    where outbound.company_id = private.try_parse_uuid(q.company_id)
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
      and not (
        rd.opportunity_id is not null
        and activity.opportunity_id is not null
        and rd.opportunity_id is distinct from activity.opportunity_id
      )
      and (
        q.opportunity_id is null
        or q.opportunity_id is not distinct from coalesce(
          d.opportunity_id,
          rd.opportunity_id,
          activity.opportunity_id
        )
      )
    then
      v_native_provenance_valid := true;
      v_effective_opportunity_id := coalesce(
        q.opportunity_id,
        d.opportunity_id,
        rd.opportunity_id,
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
      and rd.id is not null
      and v_native_provenance_valid
      and activity.created_at > rd.created_at
      and c.type = 'company'
      and u.id is not null
      and c.status = 'active'
      and coalesce(c.sync_enabled, false)
      and o.id is not null
      and o.assigned_to = p_requested_user_id
      and o.assignment_version > 0
      and private.user_can_send_opportunity_inbox(
        p_requested_user_id,
        o.id,
        c.id
      )
    then
      -- A shared mailbox cannot name the author of a send. The current exact
      -- assignee who owned the OPS draft this reply replaced is the same
      -- inference `native_mailbox_draft` already trusts, held to the same
      -- assignment proof; without it a company mailbox can never learn from
      -- the operator's own rewrites.
      v_proof_type := 'company_mailbox_assignee';
      v_assignment_version := o.assignment_version;
      select event.id
      into v_assignment_event_id
      from public.opportunity_assignment_events event
      where event.opportunity_id = o.id
        and event.assignment_version = o.assignment_version
      order by event.created_at desc, event.id desc
      limit 1;
      v_authority := case
        when p_requested_authority = 'operator_authored'
          then 'operator_authored'
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
  rd public.ai_draft_history%rowtype;
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
  elsif q.actor_proof_type = 'company_mailbox_assignee' then
    -- A rewrite never attaches the sent draft; it carries the draft it
    -- replaced, and the assignment checks below still have to prove the actor.
    if c.type <> 'company'
      or q.draft_history_id is not null
      or q.replaced_draft_history_id is null
      or q.opportunity_id is null
    then
      return 'reject';
    end if;
    select draft.*
    into rd
    from public.ai_draft_history draft
    where draft.id = q.replaced_draft_history_id
      and draft.company_id::text = q.company_id
      and draft.connection_id = q.connection_id
      and draft.user_id = v_actor_id
      and draft.thread_id = q.provider_thread_id
    for share;
    if rd.id is null then
      return 'reject';
    end if;
  else
    return 'reject';
  end if;

  select outbound.*
  into activity
  from public.activities outbound
  where outbound.company_id = private.try_parse_uuid(q.company_id)
    and outbound.email_connection_id = q.connection_id
    and outbound.email_message_id = q.provider_message_id
    and outbound.email_thread_id = q.provider_thread_id
    and outbound.direction = 'outbound'
  for share;

  if activity.id is null
    or (d.id is not null and activity.created_at <= d.created_at)
    or (rd.id is not null and activity.created_at <= rd.created_at)
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
    or (
      rd.opportunity_id is not null
      and activity.opportunity_id is not null
      and rd.opportunity_id is distinct from activity.opportunity_id
    )
    or q.opportunity_id is distinct from coalesce(
      d.opportunity_id,
      rd.opportunity_id,
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


-- Replace the public enqueue signature rather than overloading it: two
-- candidates differing only by a defaulted argument make the PostgREST call
-- ambiguous. This follows the retirement pattern of 20260713210000 and
-- 20260715179000 — the old body is kept, un-callable, under an internal name.
do $migration$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'enqueue_email_outbound_learning'
      and p.pronargs = 17
  ) then
    alter function public.enqueue_email_outbound_learning(
      text, uuid, text, text, text, text, text[], text, text, text,
      timestamptz, uuid, uuid, uuid, text, text, text
    ) rename to enqueue_email_outbound_learning_pre_replacement_internal;

    revoke all on function public.enqueue_email_outbound_learning_pre_replacement_internal(
      text, uuid, text, text, text, text, text[], text, text, text,
      timestamptz, uuid, uuid, uuid, text, text, text
    ) from public, anon, authenticated, service_role;
  end if;
end;
$migration$;

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
  p_learning_authority text default 'autonomous',
  p_replaced_draft_history_id uuid default null
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
  v_replaced_draft_history_id uuid := p_replaced_draft_history_id;
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
  if v_replaced_draft_history_id is not null then
    -- Provenance for a rewrite: the draft the operator discarded. It may never
    -- double as the sent draft, and it must belong to this exact tenant and
    -- connection. Actor authority over it is proved by the binder below.
    if v_replaced_draft_history_id = p_draft_history_id then
      raise exception 'outbound learning replaced draft cannot be the sent draft'
        using errcode = '22023';
    end if;
    if not exists (
      select 1
      from public.ai_draft_history draft
      where draft.id = v_replaced_draft_history_id
        and draft.company_id::text = p_company_id
        and draft.connection_id = p_connection_id
    ) then
      raise exception 'outbound learning replaced draft does not belong to company'
        using errcode = '22023';
    end if;
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
      replaced_draft_history_id = case
        when queue_row.prepared_at is null
          and queue_row.replaced_draft_history_id is null
          then v_replaced_draft_history_id
        else queue_row.replaced_draft_history_id
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
  timestamptz, uuid, uuid, uuid, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.enqueue_email_outbound_learning(
  text, uuid, text, text, text, text, text[], text, text, text,
  timestamptz, uuid, uuid, uuid, text, text, text, uuid
) to service_role;

comment on function private.bind_email_outbound_learning_actor_proof(uuid, uuid, text)
is 'Binds immutable OPS actor proof to an outbound-learning receipt; safely reconciles legacy text tenant identity with UUID activities, and attributes shared-mailbox rewrites to the replaced draft''s current assignee.';

comment on function private.email_outbound_learning_guard(uuid)
is 'Revalidates outbound-learning actor proof and assignment authority; safely reconciles legacy text tenant identity with UUID activities.';

commit;
