begin;

-- Phase C queue rows are durable source records, not deferred browser payloads.
-- Historical rows cannot be assigned safely after the fact, so any still-open
-- legacy row is retired before the actionable-row constraint is installed.
alter table public.pending_auto_sends
  add column if not exists actor_user_id uuid references public.users(id) on delete restrict,
  add column if not exists assignment_version bigint,
  add column if not exists assignment_event_id uuid references public.opportunity_assignment_events(id) on delete restrict,
  add column if not exists source_email_thread_id uuid references public.email_threads(id) on delete restrict,
  add column if not exists actor_name_snapshot text,
  add column if not exists actor_email_snapshot text,
  add column if not exists client_from_address_snapshot text,
  add column if not exists signature_id uuid references public.email_signatures(id) on delete restrict,
  add column if not exists signature_content_hash text,
  add column if not exists authored_body text,
  add column if not exists rendered_body text,
  add column if not exists rendered_body_hash text,
  add column if not exists content_type text,
  add column if not exists profile_type_snapshot text,
  add column if not exists learning_authority text not null default 'autonomous',
  add column if not exists idempotency_key text,
  add column if not exists send_intent_id uuid references public.email_send_intents(id) on delete restrict,
  add column if not exists lease_token uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.pending_auto_sends
  drop constraint if exists pending_auto_sends_status_check;

update public.pending_auto_sends
   set status = 'cancelled',
       cancelled_at = coalesce(cancelled_at, now()),
       error = coalesce(error, 'PHASE_C_AUTO_SEND_LEGACY_SOURCE_RETIRED'),
       updated_at = now()
 where status = 'pending'
   and actor_user_id is null;

alter table public.pending_auto_sends
  add constraint pending_auto_sends_status_check
    check (status in ('pending', 'leased', 'sent', 'cancelled', 'failed')),
  add constraint pending_auto_sends_assignment_version_check
    check (assignment_version is null or assignment_version >= 0),
  add constraint pending_auto_sends_content_type_check
    check (content_type is null or content_type in ('text', 'html')),
  add constraint pending_auto_sends_learning_authority_check
    check (learning_authority = 'autonomous'),
  add constraint pending_auto_sends_idempotency_key_check
    check (
      idempotency_key is null
      or idempotency_key ~ '^[0-9a-f]{64}$'
    ),
  add constraint pending_auto_sends_signature_hash_check
    check (
      (signature_id is null and signature_content_hash is null)
      or (
        signature_id is not null
        and signature_content_hash is not null
        and signature_content_hash ~ '^[0-9a-f]{64}$'
      )
    ),
  add constraint pending_auto_sends_rendered_body_hash_check
    check (
      rendered_body_hash is null
      or rendered_body_hash ~ '^[0-9a-f]{64}$'
    ),
  add constraint pending_auto_sends_lease_state_check
    check (
      (
        status = 'leased'
        and lease_token is not null
        and claimed_at is not null
        and lease_expires_at is not null
      )
      or (
        status <> 'leased'
        and lease_token is null
        and lease_expires_at is null
      )
    ),
  add constraint pending_auto_sends_actionable_fence_check
    check (
      status not in ('pending', 'leased')
      or (
        actor_user_id is not null
        and assignment_version is not null
        and assignment_event_id is not null
        and opportunity_id is not null
        and source_email_thread_id is not null
        and nullif(btrim(thread_id), '') is not null
        and actor_name_snapshot is not null
        and actor_email_snapshot is not null
        and nullif(btrim(client_from_address_snapshot), '') is not null
        and signature_id is not null
        and signature_content_hash is not null
        and nullif(btrim(authored_body), '') is not null
        and nullif(btrim(rendered_body), '') is not null
        and rendered_body_hash is not null
        and content_type is not null
        and profile_type_snapshot is not null
        and length(btrim(profile_type_snapshot)) between 1 and 64
        and idempotency_key is not null
        and coalesce(cardinality(to_emails), 0) > 0
      )
    );

create unique index pending_auto_sends_company_idempotency_unique
  on public.pending_auto_sends (company_id, idempotency_key);

create unique index pending_auto_sends_send_intent_unique
  on public.pending_auto_sends (send_intent_id)
  where send_intent_id is not null;

create index pending_auto_sends_actor_idx
  on public.pending_auto_sends (actor_user_id, company_id, created_at desc)
  where actor_user_id is not null;

create index pending_auto_sends_assignment_event_idx
  on public.pending_auto_sends (assignment_event_id)
  where assignment_event_id is not null;

create index pending_auto_sends_opportunity_idx
  on public.pending_auto_sends (opportunity_id, created_at desc)
  where opportunity_id is not null;

create index pending_auto_sends_source_thread_idx
  on public.pending_auto_sends (source_email_thread_id, created_at desc)
  where source_email_thread_id is not null;

create index pending_auto_sends_signature_idx
  on public.pending_auto_sends (signature_id)
  where signature_id is not null;

create index email_send_intents_pending_auto_send_idx
  on public.email_send_intents (pending_auto_send_id)
  where pending_auto_send_id is not null;

create index pending_auto_sends_due_claim_idx
  on public.pending_auto_sends (scheduled_send_at, opportunity_id, id)
  where status = 'pending';

create index pending_auto_sends_stale_lease_idx
  on public.pending_auto_sends (lease_expires_at, opportunity_id, id)
  where status = 'leased';

create or replace function public.schedule_phase_c_auto_send(
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
  p_scheduled_send_at timestamptz
)
returns public.pending_auto_sends
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opportunity public.opportunities%rowtype;
  v_company public.companies%rowtype;
  v_actor public.users%rowtype;
  v_connection public.email_connections%rowtype;
  v_source_thread public.email_threads%rowtype;
  v_draft public.ai_draft_history%rowtype;
  v_current_assignment_event_id uuid;
  v_queue public.pending_auto_sends%rowtype;
begin
  if p_idempotency_key !~ '^[0-9a-f]{64}$'
     or p_assignment_version < 0
     or p_assignment_event_id is null
     or nullif(btrim(coalesce(p_reply_provider_thread_id, '')), '') is null
     or nullif(btrim(coalesce(p_subject, '')), '') is null
     or nullif(btrim(coalesce(p_draft_text, '')), '') is null
     or nullif(btrim(coalesce(p_authored_body, '')), '') is null
     or nullif(btrim(coalesce(p_rendered_body, '')), '') is null
     or p_content_type not in ('text', 'html')
     or p_rendered_body_hash !~ '^[0-9a-f]{64}$'
     or p_learning_authority is distinct from 'autonomous'
     or length(btrim(coalesce(p_profile_type_snapshot, ''))) not between 1 and 64
     or coalesce(cardinality(p_to_emails), 0) = 0
     or exists (
       select 1
         from unnest(p_to_emails) recipient
        where nullif(btrim(recipient), '') is null
     )
     or exists (
       select 1
         from unnest(coalesce(p_cc_emails, '{}'::text[])) recipient
        where nullif(btrim(recipient), '') is null
     )
     or p_scheduled_send_at is null then
    raise exception 'PHASE_C_AUTO_SEND_INVALID';
  end if;

  -- Every queue transition that can contend with assignment changes takes the
  -- opportunity lock first. This is the linearization point for actor/version.
  select o.*
    into v_opportunity
    from public.opportunities o
   where o.id = p_opportunity_id
     and o.company_id = p_company_id
     and o.deleted_at is null
   for update;
  if not found then
    raise exception 'PHASE_C_AUTO_SEND_OPPORTUNITY_INVALID';
  end if;

  select company.*
    into v_company
    from public.companies company
   where company.id = p_company_id
     and company.deleted_at is null
   for share;
  if not found
     or not private.email_company_subscription_active(
       v_company.subscription_status,
       v_company.subscription_plan,
       v_company.trial_end_date,
       clock_timestamp()
     ) then
    raise exception 'PHASE_C_AUTO_SEND_SUBSCRIPTION_INACTIVE';
  end if;

  if v_opportunity.assigned_to is distinct from p_actor_user_id
     or v_opportunity.assignment_version is distinct from p_assignment_version then
    raise exception 'PHASE_C_AUTO_SEND_ASSIGNMENT_STALE';
  end if;

  select e.id
    into v_current_assignment_event_id
    from public.opportunity_assignment_events e
   where e.company_id = p_company_id
     and e.opportunity_id = p_opportunity_id
   order by e.created_at desc, e.id desc
   limit 1;
  if v_current_assignment_event_id is null
     or p_assignment_event_id is distinct from v_current_assignment_event_id then
    raise exception 'PHASE_C_AUTO_SEND_ASSIGNMENT_EVENT_STALE';
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
    raise exception 'PHASE_C_AUTO_SEND_ACTOR_INACTIVE';
  end if;

  select c.*
    into v_connection
    from public.email_connections c
   where c.id = p_connection_id
     and c.company_id = p_company_id::text
     and c.status = 'active'
     and coalesce(c.sync_enabled, false)
     and coalesce(c.agent_can_send_from, false)
     and coalesce(c.auto_send_settings ->> 'enabled', 'false') = 'true'
   for share;
  if not found then
    raise exception 'PHASE_C_AUTO_SEND_CONNECTION_DISABLED';
  end if;
  if v_connection.type::text = 'individual'
     and v_connection.user_id is distinct from p_actor_user_id::text then
    raise exception 'PHASE_C_AUTO_SEND_PERSONAL_MAILBOX_FORBIDDEN';
  end if;
  if not exists (
    select 1
      from public.admin_feature_overrides afo
     where afo.company_id = p_company_id::text
       and afo.feature_key = 'ai_auto_send'
       and afo.enabled
  ) then
    raise exception 'PHASE_C_AUTO_SEND_FEATURE_DISABLED';
  end if;

  if not private.user_can_send_opportunity_inbox(
    p_actor_user_id,
    p_opportunity_id,
    p_connection_id
  ) then
    raise exception 'PHASE_C_AUTO_SEND_AUTHORIZATION_REVOKED';
  end if;

  select t.*
    into v_source_thread
    from public.email_threads t
   where t.id = p_source_email_thread_id
     and t.company_id = p_company_id
     and t.connection_id = p_connection_id
     and t.provider_thread_id = p_reply_provider_thread_id
     and t.opportunity_id = p_opportunity_id
   for share;
  if not found or not exists (
    select 1
      from public.opportunity_email_threads link
     where link.opportunity_id = p_opportunity_id
       and link.connection_id = p_connection_id
       and link.thread_id = p_reply_provider_thread_id
  ) then
    raise exception 'PHASE_C_AUTO_SEND_THREAD_CONFLICT';
  end if;

  select d.*
    into v_draft
    from public.ai_draft_history d
   where d.id = p_draft_history_id
     and d.company_id = p_company_id
     and d.user_id = p_actor_user_id
     and d.connection_id = p_connection_id
     and d.opportunity_id = p_opportunity_id
     and d.thread_id = p_reply_provider_thread_id
     and d.original_draft = p_draft_text
     and d.status in ('drafted', 'auto_drafted')
     and coalesce(nullif(btrim(d.profile_type), ''), 'general') = p_profile_type_snapshot
   for share;
  if not found then
    raise exception 'PHASE_C_AUTO_SEND_DRAFT_INVALID';
  end if;

  if p_signature_id is null or p_signature_content_hash is null then
    raise exception 'PHASE_C_AUTO_SEND_SIGNATURE_INVALID';
  end if;
  if not exists (
    select 1
      from public.email_signatures s
     where s.id = p_signature_id
       and s.company_id = p_company_id
       and s.connection_id = p_connection_id
       and s.active
       and s.content_hash = p_signature_content_hash
       and (s.scope_user_id is null or s.scope_user_id = p_actor_user_id)
  ) then
    raise exception 'PHASE_C_AUTO_SEND_SIGNATURE_INVALID';
  end if;

  insert into public.pending_auto_sends (
    company_id,
    actor_user_id,
    assignment_version,
    assignment_event_id,
    connection_id,
    opportunity_id,
    source_email_thread_id,
    thread_id,
    in_reply_to,
    to_emails,
    cc_emails,
    subject,
    draft_text,
    authored_body,
    rendered_body,
    rendered_body_hash,
    content_type,
    draft_history_id,
    profile_type_snapshot,
    learning_authority,
    actor_name_snapshot,
    actor_email_snapshot,
    client_from_address_snapshot,
    signature_id,
    signature_content_hash,
    idempotency_key,
    scheduled_send_at,
    status,
    updated_at
  ) values (
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
    coalesce(p_cc_emails, '{}'::text[]),
    p_subject,
    p_draft_text,
    p_authored_body,
    p_rendered_body,
    p_rendered_body_hash,
    p_content_type,
    p_draft_history_id,
    p_profile_type_snapshot,
    'autonomous',
    btrim(concat_ws(' ', v_actor.first_name, v_actor.last_name)),
    coalesce(v_actor.email, ''),
    lower(btrim(v_connection.email)),
    p_signature_id,
    p_signature_content_hash,
    p_idempotency_key,
    p_scheduled_send_at,
    'pending',
    now()
  )
  on conflict (company_id, idempotency_key) do nothing;

  select pas.*
    into v_queue
    from public.pending_auto_sends pas
   where pas.company_id = p_company_id
     and pas.idempotency_key = p_idempotency_key
   for update;
  if not found then
    raise exception 'PHASE_C_AUTO_SEND_SCHEDULE_FAILED';
  end if;
  if v_queue.actor_user_id is distinct from p_actor_user_id
     or v_queue.assignment_version is distinct from p_assignment_version
     or v_queue.assignment_event_id is distinct from p_assignment_event_id
     or v_queue.connection_id is distinct from p_connection_id
     or v_queue.opportunity_id is distinct from p_opportunity_id
     or v_queue.source_email_thread_id is distinct from p_source_email_thread_id
     or v_queue.thread_id is distinct from p_reply_provider_thread_id
     or v_queue.in_reply_to is distinct from p_in_reply_to
     or v_queue.to_emails is distinct from p_to_emails
     or v_queue.cc_emails is distinct from coalesce(p_cc_emails, '{}'::text[])
     or v_queue.subject is distinct from p_subject
     or v_queue.draft_history_id is distinct from p_draft_history_id
     or v_queue.rendered_body_hash is distinct from p_rendered_body_hash then
    raise exception 'PHASE_C_AUTO_SEND_IDEMPOTENCY_CONFLICT';
  end if;

  return v_queue;
end;
$$;

create or replace function public.claim_phase_c_auto_sends(
  p_limit integer,
  p_lease_seconds integer
)
returns setof public.pending_auto_sends
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_target_count integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 300), 30), 900);
  v_claimed_count integer := 0;
  v_candidate record;
  v_opportunity public.opportunities%rowtype;
  v_company public.companies%rowtype;
  v_queue public.pending_auto_sends%rowtype;
  v_actor public.users%rowtype;
  v_connection public.email_connections%rowtype;
  v_source_thread public.email_threads%rowtype;
  v_draft public.ai_draft_history%rowtype;
  v_current_assignment_event_id uuid;
  v_cancel_reason text;
begin
  for v_candidate in
    select pas.id, pas.opportunity_id
      from public.pending_auto_sends pas
     where (
       pas.status = 'pending'
       and pas.scheduled_send_at <= v_now
     ) or (
       pas.status = 'leased'
       and pas.lease_expires_at <= v_now
     )
     order by
       case when pas.status = 'leased' then pas.lease_expires_at else pas.scheduled_send_at end,
       pas.id
     limit least(v_target_count * 4, 800)
  loop
    exit when v_claimed_count >= v_target_count;
    if v_candidate.opportunity_id is null then
      continue;
    end if;

    -- Read candidate IDs without locking, then lock the opportunity before the
    -- queue row. SKIP LOCKED lets other workers claim unrelated opportunities.
    select o.*
      into v_opportunity
      from public.opportunities o
     where o.id = v_candidate.opportunity_id
       and o.deleted_at is null
     for update skip locked;
    if not found then
      continue;
    end if;

    select pas.*
      into v_queue
      from public.pending_auto_sends pas
     where pas.id = v_candidate.id
       and (
         (pas.status = 'pending' and pas.scheduled_send_at <= v_now)
         or (pas.status = 'leased' and pas.lease_expires_at <= v_now)
       )
     for update skip locked;
    if not found then
      continue;
    end if;

    v_cancel_reason := null;
    if v_opportunity.company_id is distinct from v_queue.company_id
       or v_opportunity.assigned_to is null
       or v_opportunity.assigned_to is distinct from v_queue.actor_user_id
       or v_opportunity.assignment_version is distinct from v_queue.assignment_version then
      v_cancel_reason := 'PHASE_C_AUTO_SEND_ASSIGNMENT_STALE';
    end if;

    if v_cancel_reason is null then
      select company.*
        into v_company
        from public.companies company
       where company.id = v_queue.company_id
         and company.deleted_at is null
       for share;
      if not found
         or not private.email_company_subscription_active(
           v_company.subscription_status,
           v_company.subscription_plan,
           v_company.trial_end_date,
           v_now
         ) then
        v_cancel_reason := 'PHASE_C_AUTO_SEND_SUBSCRIPTION_INACTIVE';
      end if;
    end if;

    if v_cancel_reason is null then
      select e.id
        into v_current_assignment_event_id
        from public.opportunity_assignment_events e
       where e.company_id = v_queue.company_id
         and e.opportunity_id = v_queue.opportunity_id
       order by e.created_at desc, e.id desc
       limit 1;
      if v_queue.assignment_event_id is null
         or v_current_assignment_event_id is null
         or v_current_assignment_event_id is distinct from v_queue.assignment_event_id then
        v_cancel_reason := 'PHASE_C_AUTO_SEND_ASSIGNMENT_STALE';
      end if;
    end if;

    if v_cancel_reason is null then
      select u.*
        into v_actor
        from public.users u
       where u.id = v_queue.actor_user_id
         and u.company_id = v_queue.company_id
         and u.deleted_at is null
         and coalesce(u.is_active, false)
       for share;
      if not found then
        v_cancel_reason := 'PHASE_C_AUTO_SEND_ACTOR_INACTIVE';
      elsif btrim(concat_ws(' ', v_actor.first_name, v_actor.last_name))
              is distinct from v_queue.actor_name_snapshot
         or coalesce(v_actor.email, '')
              is distinct from v_queue.actor_email_snapshot then
        v_cancel_reason := 'PHASE_C_AUTO_SEND_ACTOR_SNAPSHOT_STALE';
      end if;
    end if;

    if v_cancel_reason is null then
      select c.*
        into v_connection
        from public.email_connections c
       where c.id = v_queue.connection_id
         and c.company_id = v_queue.company_id::text
         and c.status = 'active'
         and coalesce(c.sync_enabled, false)
         and coalesce(c.agent_can_send_from, false)
         and coalesce(c.auto_send_settings ->> 'enabled', 'false') = 'true'
       for share;
      if not found
         or (
           v_connection.type::text = 'individual'
           and v_connection.user_id is distinct from v_queue.actor_user_id::text
         )
         or lower(btrim(v_connection.email)) is distinct from v_queue.client_from_address_snapshot then
        v_cancel_reason := 'PHASE_C_AUTO_SEND_CONNECTION_DISABLED';
      end if;
    end if;

    if v_cancel_reason is null and not exists (
      select 1
        from public.admin_feature_overrides afo
       where afo.company_id = v_queue.company_id::text
         and afo.feature_key = 'ai_auto_send'
         and afo.enabled
    ) then
      v_cancel_reason := 'PHASE_C_AUTO_SEND_CONNECTION_DISABLED';
    end if;

    if v_cancel_reason is null then
      if not private.user_can_send_opportunity_inbox(
        v_queue.actor_user_id,
        v_queue.opportunity_id,
        v_queue.connection_id
      ) then
        v_cancel_reason := 'PHASE_C_AUTO_SEND_AUTHORIZATION_REVOKED';
      end if;
    end if;

    if v_cancel_reason is null then
      select t.*
        into v_source_thread
        from public.email_threads t
       where t.id = v_queue.source_email_thread_id
         and t.company_id = v_queue.company_id
         and t.connection_id = v_queue.connection_id
         and t.provider_thread_id = v_queue.thread_id
         and t.opportunity_id = v_queue.opportunity_id
       for share;
      if not found or not exists (
        select 1
          from public.opportunity_email_threads link
         where link.opportunity_id = v_queue.opportunity_id
           and link.connection_id = v_queue.connection_id
           and link.thread_id = v_queue.thread_id
      ) then
        v_cancel_reason := 'PHASE_C_AUTO_SEND_THREAD_CONFLICT';
      end if;
    end if;

    if v_cancel_reason is null then
      select d.*
        into v_draft
        from public.ai_draft_history d
       where d.id = v_queue.draft_history_id
         and d.company_id = v_queue.company_id
         and d.user_id = v_queue.actor_user_id
         and d.connection_id = v_queue.connection_id
         and d.opportunity_id = v_queue.opportunity_id
         and d.thread_id = v_queue.thread_id
         and d.original_draft = v_queue.draft_text
         and d.status in ('drafted', 'auto_drafted')
         and coalesce(nullif(btrim(d.profile_type), ''), 'general') = v_queue.profile_type_snapshot
       for share;
      if not found then
        v_cancel_reason := 'PHASE_C_AUTO_SEND_DRAFT_INVALID';
      end if;
    end if;

    if v_cancel_reason is null
       and v_queue.signature_id is not null
       and not exists (
         select 1
           from public.email_signatures s
          where s.id = v_queue.signature_id
            and s.company_id = v_queue.company_id
            and s.connection_id = v_queue.connection_id
            and s.active
            and s.content_hash = v_queue.signature_content_hash
            and (s.scope_user_id is null or s.scope_user_id = v_queue.actor_user_id)
       ) then
      v_cancel_reason := 'PHASE_C_AUTO_SEND_SIGNATURE_STALE';
    end if;

    if v_cancel_reason is not null then
      update public.pending_auto_sends
         set status = 'cancelled',
             cancelled_at = v_now,
             error = v_cancel_reason,
             lease_token = null,
             lease_expires_at = null,
             updated_at = v_now
       where id = v_queue.id;
      if v_queue.draft_history_id is not null
         and v_cancel_reason <> 'PHASE_C_AUTO_SEND_SUBSCRIPTION_INACTIVE' then
        update public.ai_draft_history
           set status = 'discarded',
               discarded_at = coalesce(discarded_at, v_now)
         where id = v_queue.draft_history_id
           and company_id = v_queue.company_id
           and status in ('drafted', 'auto_drafted');
      end if;
      continue;
    end if;

    update public.pending_auto_sends
       set status = 'leased',
           lease_token = gen_random_uuid(),
           claimed_at = v_now,
           lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
           error = null,
           updated_at = v_now
     where id = v_queue.id
     returning * into v_queue;

    v_claimed_count := v_claimed_count + 1;
    return next v_queue;
  end loop;
  return;
end;
$$;

create or replace function public.complete_phase_c_auto_send(
  p_id uuid,
  p_company_id uuid,
  p_lease_token uuid,
  p_send_intent_id uuid
)
returns public.pending_auto_sends
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opportunity_id uuid;
  v_opportunity public.opportunities%rowtype;
  v_queue public.pending_auto_sends%rowtype;
begin
  select pas.opportunity_id
    into v_opportunity_id
    from public.pending_auto_sends pas
   where pas.id = p_id
     and pas.company_id = p_company_id;
  if v_opportunity_id is null then
    return null;
  end if;

  select o.*
   into v_opportunity
    from public.opportunities o
   where o.id = v_opportunity_id
     and o.company_id = p_company_id
   for update;
  if not found then
    return null;
  end if;

  select pas.*
    into v_queue
    from public.pending_auto_sends pas
   where pas.id = p_id
     and pas.company_id = p_company_id
   for update;
  if not found
     or v_queue.status <> 'leased'
     or v_queue.lease_token is distinct from p_lease_token
     or v_queue.lease_expires_at <= clock_timestamp() then
    return null;
  end if;

  if not exists (
    select 1
      from public.email_send_intents i
     where i.id = p_send_intent_id
       and i.pending_auto_send_id = v_queue.id
       and i.company_id = v_queue.company_id
       and i.actor_user_id = v_queue.actor_user_id
       and i.assignment_version = v_queue.assignment_version
       and i.connection_id = v_queue.connection_id
       and i.opportunity_id = v_queue.opportunity_id
       and i.status = 'reconciled'
       and i.provider_message_id is not null
       and i.provider_accepted_at is not null
  ) then
    raise exception 'PHASE_C_AUTO_SEND_INTENT_NOT_ACCEPTED';
  end if;

  update public.pending_auto_sends
     set status = 'sent',
         sent_at = clock_timestamp(),
         send_intent_id = p_send_intent_id,
         lease_token = null,
         lease_expires_at = null,
         error = null,
         updated_at = clock_timestamp()
   where id = v_queue.id
   returning * into v_queue;
  return v_queue;
end;
$$;

create or replace function public.retry_phase_c_auto_send(
  p_id uuid,
  p_company_id uuid,
  p_lease_token uuid,
  p_error text,
  p_retry_at timestamptz
)
returns public.pending_auto_sends
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opportunity_id uuid;
  v_opportunity public.opportunities%rowtype;
  v_queue public.pending_auto_sends%rowtype;
  v_next_retry_count integer;
begin
  select pas.opportunity_id
    into v_opportunity_id
    from public.pending_auto_sends pas
   where pas.id = p_id
     and pas.company_id = p_company_id;
  if v_opportunity_id is null then
    return null;
  end if;

  select o.*
    into v_opportunity
    from public.opportunities o
   where o.id = v_opportunity_id
   for update;
  if not found then
    return null;
  end if;

  select pas.*
    into v_queue
    from public.pending_auto_sends pas
   where pas.id = p_id
     and pas.company_id = p_company_id
   for update;
  if not found
     or v_queue.status <> 'leased'
     or v_queue.lease_token is distinct from p_lease_token
     or v_queue.lease_expires_at <= clock_timestamp() then
    return null;
  end if;

  v_next_retry_count := v_queue.retry_count + 1;
  if v_next_retry_count >= 3 then
    update public.pending_auto_sends
       set status = 'failed',
           retry_count = v_next_retry_count,
           error = left(coalesce(p_error, 'PHASE_C_AUTO_SEND_FAILED'), 2000),
           lease_token = null,
           lease_expires_at = null,
           updated_at = clock_timestamp()
     where id = v_queue.id
     returning * into v_queue;
  else
    update public.pending_auto_sends
       set status = 'pending',
           retry_count = v_next_retry_count,
           scheduled_send_at = greatest(
             coalesce(p_retry_at, clock_timestamp() + interval '5 minutes'),
             clock_timestamp()
           ),
           error = left(coalesce(p_error, 'PHASE_C_AUTO_SEND_RETRY'), 2000),
           lease_token = null,
           lease_expires_at = null,
           updated_at = clock_timestamp()
     where id = v_queue.id
     returning * into v_queue;
  end if;
  return v_queue;
end;
$$;

create or replace function public.cancel_phase_c_auto_send(
  p_id uuid,
  p_company_id uuid,
  p_lease_token uuid,
  p_reason text,
  p_actor_user_id uuid
)
returns public.pending_auto_sends
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opportunity_id uuid;
  v_opportunity public.opportunities%rowtype;
  v_queue public.pending_auto_sends%rowtype;
  v_actor public.users%rowtype;
begin
  -- Exactly one authority mode is permitted. Browser cancellation carries the
  -- canonical OPS actor; workers carry the exact live queue lease.
  if (p_actor_user_id is not null) = (p_lease_token is not null) then
    return null;
  end if;

  select pas.opportunity_id
    into v_opportunity_id
    from public.pending_auto_sends pas
   where pas.id = p_id
     and pas.company_id = p_company_id;
  if v_opportunity_id is null then
    return null;
  end if;

  select o.*
    into v_opportunity
    from public.opportunities o
   where o.id = v_opportunity_id
   for update;
  if not found then
    return null;
  end if;

  select pas.*
    into v_queue
    from public.pending_auto_sends pas
   where pas.id = p_id
     and pas.company_id = p_company_id
   for update;
  if not found
     or v_queue.opportunity_id is distinct from v_opportunity.id
     or v_queue.status not in ('pending', 'leased') then
    return null;
  end if;

  if p_actor_user_id is not null then
    select u.*
      into v_actor
      from public.users u
     where u.id = p_actor_user_id
       and u.company_id = p_company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
     for share;
    if not found
       or v_queue.status <> 'pending'
       or not private.user_can_send_opportunity_inbox(
         p_actor_user_id,
         v_opportunity.id,
         v_queue.connection_id
       ) then
      return null;
    end if;
  else
    if v_queue.status <> 'leased'
       or p_lease_token is null
       or v_queue.lease_token is distinct from p_lease_token
       or v_queue.lease_expires_at <= clock_timestamp() then
      return null;
    end if;
  end if;

  update public.pending_auto_sends
     set status = 'cancelled',
         cancelled_at = clock_timestamp(),
         error = left(coalesce(nullif(btrim(p_reason), ''), 'PHASE_C_AUTO_SEND_CANCELLED'), 2000),
         lease_token = null,
         lease_expires_at = null,
         updated_at = clock_timestamp()
   where id = v_queue.id
   returning * into v_queue;

  if v_queue.draft_history_id is not null then
    update public.ai_draft_history
       set status = 'discarded',
           discarded_at = coalesce(discarded_at, clock_timestamp())
     where id = v_queue.draft_history_id
       and company_id = v_queue.company_id
       and status in ('drafted', 'auto_drafted');
  end if;
  return v_queue;
end;
$$;

-- The queue claim and send intent are separate short transactions. This trigger
-- makes the durable intent re-check the exact queue snapshot, closing the race
-- between a claim and provider delivery without changing the root-owned intent RPC.
create or replace function private.enforce_phase_c_auto_send_intent_fence()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_queue public.pending_auto_sends%rowtype;
  v_require_live_lease boolean := false;
begin
  if new.pending_auto_send_id is null then
    if tg_op = 'UPDATE' and old.pending_auto_send_id is not null then
      raise exception 'EMAIL_SEND_PHASE_C_QUEUE_FENCE';
    end if;
    return new;
  end if;

  select pas.*
    into v_queue
    from public.pending_auto_sends pas
   where pas.id = new.pending_auto_send_id
   for share;
  if not found
     or new.idempotency_key is distinct from v_queue.idempotency_key
     or new.actor_user_id is distinct from v_queue.actor_user_id
     or new.assignment_version is distinct from v_queue.assignment_version
     or new.assignment_event_id is distinct from v_queue.assignment_event_id
     or new.connection_id is distinct from v_queue.connection_id
     or new.opportunity_id is distinct from v_queue.opportunity_id
     or new.source_email_thread_id is distinct from v_queue.source_email_thread_id
     or new.reply_provider_thread_id is distinct from v_queue.thread_id
     or new.in_reply_to is distinct from v_queue.in_reply_to
     or new.sender_switched
     or new.to_emails is distinct from v_queue.to_emails
     or new.cc_emails is distinct from v_queue.cc_emails
     or new.subject is distinct from v_queue.subject
     or new.authored_body is distinct from v_queue.authored_body
     or new.rendered_body is distinct from v_queue.rendered_body
     or new.content_type is distinct from v_queue.content_type
     or new.draft_history_id is distinct from v_queue.draft_history_id
     or new.follow_up_draft_id is not null
     or new.learning_authority <> 'autonomous'
     or new.learning_authority is distinct from v_queue.learning_authority
     or new.actor_name_snapshot is distinct from v_queue.actor_name_snapshot
     or new.actor_email_snapshot is distinct from v_queue.actor_email_snapshot
     or new.client_from_address_snapshot is distinct from v_queue.client_from_address_snapshot
     or new.signature_id is distinct from v_queue.signature_id
     or new.signature_content_hash is distinct from v_queue.signature_content_hash
     or new.rendered_body_hash is distinct from v_queue.rendered_body_hash
     or new.profile_type_snapshot is distinct from v_queue.profile_type_snapshot
     or new.initiated_by <> 'phase_c_auto_send' then
    raise exception 'EMAIL_SEND_PHASE_C_QUEUE_FENCE';
  end if;

  if tg_op = 'INSERT' then
    v_require_live_lease := true;
  elsif tg_op = 'UPDATE' then
    v_require_live_lease :=
      (old.status = 'prepared' and new.status = 'sending')
      or (
        old.status = 'prepared'
        and new.status = 'prepared'
        and (
          new.pending_auto_send_lease_token is distinct from old.pending_auto_send_lease_token
          or new.request_fingerprint is distinct from old.request_fingerprint
        )
      );
  end if;

  if v_require_live_lease
     and (
       v_queue.status <> 'leased'
       or v_queue.lease_expires_at <= clock_timestamp()
       or new.pending_auto_send_lease_token is distinct from v_queue.lease_token
     ) then
    raise exception 'EMAIL_SEND_PHASE_C_QUEUE_LEASE_FENCE';
  end if;
  return new;
end;
$$;

drop trigger if exists email_send_intents_phase_c_queue_fence
  on public.email_send_intents;
create trigger email_send_intents_phase_c_queue_fence
  before insert or update of
    pending_auto_send_id,
    pending_auto_send_lease_token,
    idempotency_key,
    status,
    request_fingerprint,
    actor_user_id,
    assignment_version,
    assignment_event_id,
    initiated_by,
    connection_id,
    opportunity_id,
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
    learning_authority,
    actor_name_snapshot,
    actor_email_snapshot,
    client_from_address_snapshot,
    signature_id,
    signature_content_hash,
    rendered_body_hash,
    profile_type_snapshot
  on public.email_send_intents
  for each row
  execute function private.enforce_phase_c_auto_send_intent_fence();

revoke all on function private.enforce_phase_c_auto_send_intent_fence() from public, anon, authenticated, service_role;

revoke all on function public.schedule_phase_c_auto_send(text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text, text[], text[], text, text, text, text, text, uuid, text, text, uuid, text, text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.schedule_phase_c_auto_send(text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text, text[], text[], text, text, text, text, text, uuid, text, text, uuid, text, text, timestamptz) to service_role;

revoke all on function public.claim_phase_c_auto_sends(integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_phase_c_auto_sends(integer, integer) to service_role;

revoke all on function public.complete_phase_c_auto_send(uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.complete_phase_c_auto_send(uuid, uuid, uuid, uuid) to service_role;

revoke all on function public.retry_phase_c_auto_send(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.retry_phase_c_auto_send(uuid, uuid, uuid, text, timestamptz) to service_role;

revoke all on function public.cancel_phase_c_auto_send(uuid, uuid, uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.cancel_phase_c_auto_send(uuid, uuid, uuid, text, uuid) to service_role;

commit;
