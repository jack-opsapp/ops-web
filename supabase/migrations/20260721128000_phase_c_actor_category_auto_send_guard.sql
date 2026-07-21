begin;

-- A queued autonomous reply carries the thread category that was approved at
-- schedule time. Historical terminal rows may remain null; every actionable
-- row created after this migration must be attributable to an exact category.
alter table public.pending_auto_sends
  add column if not exists category_snapshot text;

alter table public.pending_auto_sends
  add column if not exists autonomy_level_snapshot text;

alter table public.pending_auto_sends
  drop constraint if exists pending_auto_sends_category_actionable_check;

alter table public.pending_auto_sends
  add constraint pending_auto_sends_category_actionable_check
  check (
    status not in ('pending', 'leased')
    or (
      category_snapshot in ('CUSTOMER', 'VENDOR', 'SUBTRADE', 'PLATFORM_BID')
      and autonomy_level_snapshot in ('auto_send', 'auto_follow_up')
    )
  ) not valid;

-- Forward-only human outcome category proof. Existing rows intentionally stay
-- null and cannot contribute to category graduation. New queue writes derive
-- the snapshot only from the canonical thread identity in this mailbox.
alter table public.email_outbound_learning_queue
  add column if not exists category_snapshot text;

alter table public.email_outbound_learning_queue
  drop constraint if exists email_outbound_learning_queue_category_snapshot_check;

alter table public.email_outbound_learning_queue
  add constraint email_outbound_learning_queue_category_snapshot_check
  check (
    category_snapshot is null
    or category_snapshot in (
      'CUSTOMER', 'VENDOR', 'SUBTRADE', 'PLATFORM_BID', 'LEGAL',
      'JOB_SEEKER', 'COLLECTIONS', 'MARKETING', 'RECEIPT', 'PERSONAL',
      'INTERNAL', 'OTHER'
    )
  );

-- Auto-send consent is actor-scoped even when several OPS users share one
-- company mailbox. The mailbox JSON remains the shared category policy, while
-- this ledger proves that this exact actor accepted this exact send-capable
-- level. No historical mailbox setting is converted into consent.
create table if not exists public.phase_c_category_auto_send_acceptances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null references public.email_connections(id) on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete cascade,
  primary_category text not null check (
    primary_category in ('CUSTOMER', 'VENDOR', 'SUBTRADE', 'PLATFORM_BID')
  ),
  accepted_level text not null check (
    accepted_level in ('auto_send', 'auto_follow_up')
  ),
  accepted_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  unique (company_id, connection_id, actor_user_id, primary_category)
);

create index if not exists phase_c_category_auto_send_acceptances_active_idx
  on public.phase_c_category_auto_send_acceptances (
    company_id,
    connection_id,
    actor_user_id,
    primary_category,
    accepted_level
  )
  where revoked_at is null;

alter table public.phase_c_category_auto_send_acceptances enable row level security;
revoke all on table public.phase_c_category_auto_send_acceptances
  from public, anon, authenticated, service_role;

-- The admin override is the hard transport kill switch. A forward disable (or
-- row deletion) atomically clears every mailbox master flag and fences all
-- unsent queue work for that company.
create or replace function private.enforce_phase_c_ai_auto_send_kill_switch()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_company_id text;
  v_should_disable boolean := false;
begin
  if tg_op = 'DELETE' then
    v_company_id := old.company_id;
    v_should_disable := old.feature_key = 'ai_auto_send';
  else
    v_company_id := new.company_id;
    v_should_disable :=
      new.feature_key = 'ai_auto_send'
      and not coalesce(new.enabled, false);
  end if;

  if not v_should_disable then
    return null;
  end if;

  update public.phase_c_category_auto_send_acceptances acceptance
  set revoked_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where acceptance.company_id::text = v_company_id
    and acceptance.revoked_at is null;

  update public.email_connections connection
  set auto_send_settings = jsonb_set(
        coalesce(connection.auto_send_settings, '{}'::jsonb),
        '{enabled}',
        'false'::jsonb,
        true
      ),
      agent_can_send_from = false,
      updated_at = clock_timestamp()
  where connection.company_id = v_company_id;

  update public.pending_auto_sends queue
  set status = 'cancelled',
      cancelled_at = clock_timestamp(),
      error = 'PHASE_C_AUTO_SEND_FEATURE_DISABLED',
      lease_token = null,
      lease_expires_at = null,
      updated_at = clock_timestamp()
  where queue.company_id::text = v_company_id
    and queue.status in ('pending', 'leased');

  return null;
end;
$function$;

revoke all on function private.enforce_phase_c_ai_auto_send_kill_switch()
  from public, anon, authenticated, service_role;

drop trigger if exists admin_feature_overrides_phase_c_auto_send_kill_switch
  on public.admin_feature_overrides;
create trigger admin_feature_overrides_phase_c_auto_send_kill_switch
after insert or update of enabled or delete
on public.admin_feature_overrides
for each row execute function private.enforce_phase_c_ai_auto_send_kill_switch();

-- Forward safety fence: legacy mailbox-wide flags are not actor consent. This
-- migration deliberately does not backfill acceptances, so every autonomous
-- category must be explicitly reaccepted after the new guard exists.
update public.email_connections connection
set auto_send_settings = jsonb_set(
      coalesce(connection.auto_send_settings, '{}'::jsonb),
      '{enabled}',
      'false'::jsonb,
      true
    ),
    agent_can_send_from = false,
    updated_at = clock_timestamp()
where coalesce(connection.agent_can_send_from, false)
   or coalesce(connection.auto_send_settings ->> 'enabled', 'false') = 'true';

update public.pending_auto_sends queue
set status = 'cancelled',
    cancelled_at = clock_timestamp(),
    error = 'PHASE_C_AUTO_SEND_REACCEPTANCE_REQUIRED',
    lease_token = null,
    lease_expires_at = null,
    updated_at = clock_timestamp()
where queue.status in ('pending', 'leased');

create index if not exists email_outbound_learning_category_accuracy_idx
  on public.email_outbound_learning_queue (
    company_id,
    connection_id,
    user_id,
    category_snapshot,
    occurred_at desc nulls last,
    completed_at desc,
    id desc
  )
  where status = 'completed'
    and learning_authority = 'operator_approved'
    and apply_learning is true
    and draft_history_id is not null
    and draft_outcome is not null
    and category_snapshot is not null;

create or replace function private.phase_c_category_profile_types(
  p_category text
)
returns text[]
language sql
immutable
strict
set search_path = pg_catalog, pg_temp
as $function$
  select case upper(btrim(p_category))
    when 'CUSTOMER' then array[
      'client_new_inquiry',
      'client_quoting',
      'client_active_project',
      'client_followup'
    ]::text[]
    when 'VENDOR' then array[
      'vendor_ordering',
      'vendor_inquiry'
    ]::text[]
    when 'SUBTRADE' then array['subtrade_coordination']::text[]
    when 'PLATFORM_BID' then array['client_new_inquiry']::text[]
    else '{}'::text[]
  end;
$function$;

revoke all on function private.phase_c_category_profile_types(text)
  from public, anon, authenticated, service_role;

create or replace function private.phase_c_category_level_allowed(
  p_category text,
  p_level text
)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog, pg_temp
as $function$
  select case upper(btrim(p_category))
    when 'CUSTOMER' then p_level in (
      'off', 'draft_on_request', 'auto_draft', 'auto_send', 'auto_follow_up'
    )
    when 'VENDOR' then p_level in (
      'off', 'draft_on_request', 'auto_draft', 'auto_send'
    )
    when 'SUBTRADE' then p_level in (
      'off', 'draft_on_request', 'auto_draft', 'auto_send'
    )
    when 'PLATFORM_BID' then p_level in (
      'off', 'draft_on_request', 'auto_draft', 'auto_send', 'auto_archive'
    )
    when 'LEGAL' then p_level in ('off', 'draft_on_request')
    when 'COLLECTIONS' then p_level in ('off', 'draft_on_request')
    when 'JOB_SEEKER' then p_level in ('off', 'draft_on_request')
    when 'MARKETING' then p_level in ('off', 'auto_archive')
    when 'RECEIPT' then p_level in ('off', 'auto_archive')
    when 'PERSONAL' then p_level in ('off', 'auto_archive')
    when 'INTERNAL' then p_level in ('off', 'auto_archive')
    when 'OTHER' then p_level in ('off', 'auto_archive')
    else false
  end;
$function$;

revoke all on function private.phase_c_category_level_allowed(text, text)
  from public, anon, authenticated, service_role;

create or replace function private.phase_c_actor_category_acceptance_active(
  p_company_id uuid,
  p_connection_id uuid,
  p_actor_user_id uuid,
  p_category text,
  p_level text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
  select exists (
    select 1
    from public.phase_c_category_auto_send_acceptances acceptance
    join public.users actor
      on actor.id = acceptance.actor_user_id
     and actor.company_id = acceptance.company_id
     and actor.deleted_at is null
     and coalesce(actor.is_active, false)
    join public.email_connections connection
      on connection.id = acceptance.connection_id
     and connection.company_id = acceptance.company_id::text
     and connection.status = 'active'
     and coalesce(connection.sync_enabled, false)
     and (
       connection.type::text <> 'individual'
       or btrim(coalesce(connection.user_id, '')) = acceptance.actor_user_id::text
     )
    where acceptance.company_id = p_company_id
      and acceptance.connection_id = p_connection_id
      and acceptance.actor_user_id = p_actor_user_id
      and acceptance.primary_category = upper(btrim(p_category))
      and acceptance.accepted_level = p_level
      and acceptance.revoked_at is null
  );
$function$;

revoke all on function private.phase_c_actor_category_acceptance_active(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;

create or replace function private.phase_c_actor_can_configure_connection(
  p_actor_user_id uuid,
  p_connection_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
  select exists (
    select 1
    from public.users actor
    join public.email_connections connection
      on connection.id = p_connection_id
     and connection.company_id = actor.company_id::text
     and connection.status = 'active'
     and coalesce(connection.sync_enabled, false)
    where actor.id = p_actor_user_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
      and (
        (
          connection.type::text = 'individual'
          and btrim(coalesce(connection.user_id, '')) = actor.id::text
        )
        or (
          connection.type::text = 'company'
          and (
            public.has_permission(actor.id, 'settings.integrations', 'all')
            or exists (
              select 1
              from public.email_threads thread
              where thread.company_id = actor.company_id
                and thread.connection_id = connection.id
                and thread.opportunity_id is not null
                and private.user_can_send_opportunity_inbox(
                  actor.id,
                  thread.opportunity_id,
                  connection.id
                )
            )
          )
        )
      )
  );
$function$;

revoke all on function private.phase_c_actor_can_configure_connection(
  uuid, uuid
) from public, anon, authenticated, service_role;

create or replace function public.authorize_phase_c_category_settings_as_system(
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
  return private.phase_c_actor_can_configure_connection(
    p_actor_user_id,
    p_connection_id
  );
end;
$function$;

revoke all on function public.authorize_phase_c_category_settings_as_system(
  uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.authorize_phase_c_category_settings_as_system(
  uuid, uuid
) to service_role;

create or replace function public.get_phase_c_actor_category_acceptances_as_system(
  p_connection_id uuid,
  p_actor_user_id uuid
)
returns table (
  primary_category text,
  accepted_level text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  return query
  select acceptance.primary_category, acceptance.accepted_level
  from public.phase_c_category_auto_send_acceptances acceptance
  join public.users actor
    on actor.id = acceptance.actor_user_id
   and actor.company_id = acceptance.company_id
   and actor.deleted_at is null
   and coalesce(actor.is_active, false)
  join public.email_connections connection
    on connection.id = acceptance.connection_id
   and connection.company_id = acceptance.company_id::text
   and connection.status = 'active'
   and coalesce(connection.sync_enabled, false)
   and (
     connection.type::text <> 'individual'
     or btrim(coalesce(connection.user_id, '')) = acceptance.actor_user_id::text
   )
  where acceptance.connection_id = p_connection_id
    and acceptance.actor_user_id = p_actor_user_id
    and acceptance.revoked_at is null;
end;
$function$;

revoke all on function public.get_phase_c_actor_category_acceptances_as_system(
  uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.get_phase_c_actor_category_acceptances_as_system(
  uuid, uuid
) to service_role;

create or replace function private.capture_phase_c_learning_category_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_derived_category text;
  v_opportunity_enrichment boolean := false;
begin
  if tg_op = 'UPDATE' then
    -- The canonical enqueue and actor-proof binder may discover the lead only
    -- after the provider-only queue row exists. Permit that one-way enrichment
    -- only when the exact mailbox thread now proves the same lead and category.
    -- Every other source mutation, including cross-opportunity movement, stays
    -- immutable.
    v_opportunity_enrichment :=
      new.company_id is not distinct from old.company_id
      and new.connection_id is not distinct from old.connection_id
      and new.provider_thread_id is not distinct from old.provider_thread_id
      and old.opportunity_id is null
      and new.opportunity_id is not null;

    if new.company_id is distinct from old.company_id
       or new.connection_id is distinct from old.connection_id
       or new.provider_thread_id is distinct from old.provider_thread_id
       or (
         new.opportunity_id is distinct from old.opportunity_id
         and not v_opportunity_enrichment
       ) then
      raise exception 'PHASE_C_LEARNING_CATEGORY_SOURCE_IMMUTABLE'
        using errcode = '42501';
    end if;

    if v_opportunity_enrichment and not exists (
      select 1
      from public.email_threads thread
      where thread.connection_id = new.connection_id
        and thread.provider_thread_id = new.provider_thread_id
        and thread.company_id::text = new.company_id
        and thread.opportunity_id = new.opportunity_id
        and (
          old.category_snapshot is null
          or upper(thread.primary_category::text) is not distinct from old.category_snapshot
        )
      for share
    ) then
      raise exception 'PHASE_C_LEARNING_CATEGORY_SOURCE_MISSING'
        using errcode = '42501';
    end if;
  end if;

  -- Historical rows remain unattributed forever. Reprocessing them must not
  -- become an implicit backfill, and a caller may not attach a category after
  -- the fact. Every row inserted after this migration is stamped below.
  if tg_op = 'UPDATE' and old.category_snapshot is null then
    if new.category_snapshot is not null then
      raise exception 'PHASE_C_LEARNING_CATEGORY_IMMUTABLE'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- A forward-created outcome keeps the category captured when its immutable
  -- source was accepted. Later thread recategorization must not strand queue
  -- completion or silently move this proof into another category.
  if tg_op = 'UPDATE' and old.category_snapshot is not null then
    if new.category_snapshot is distinct from old.category_snapshot then
      raise exception 'PHASE_C_LEARNING_CATEGORY_IMMUTABLE'
        using errcode = '42501';
    end if;
    new.category_snapshot := old.category_snapshot;
    return new;
  end if;

  select upper(thread.primary_category::text)
  into v_derived_category
  from public.email_threads thread
  where thread.connection_id = new.connection_id
    and thread.provider_thread_id = new.provider_thread_id
    and thread.company_id::text = new.company_id
    and (
      new.opportunity_id is null
      or thread.opportunity_id = new.opportunity_id
    );

  if v_derived_category is null then
    raise exception 'PHASE_C_LEARNING_CATEGORY_SOURCE_MISSING'
      using errcode = '42501';
  end if;

  if new.category_snapshot is not null
     and new.category_snapshot is distinct from v_derived_category then
    raise exception 'PHASE_C_LEARNING_CATEGORY_SPOOFED' using errcode = '42501';
  end if;

  new.category_snapshot := v_derived_category;
  return new;
end;
$function$;

revoke all on function private.capture_phase_c_learning_category_snapshot()
  from public, anon, authenticated, service_role;

drop trigger if exists email_outbound_learning_category_snapshot
  on public.email_outbound_learning_queue;
create trigger email_outbound_learning_category_snapshot
before insert or update of company_id, connection_id, provider_thread_id,
  opportunity_id, status, category_snapshot
on public.email_outbound_learning_queue
for each row execute function private.capture_phase_c_learning_category_snapshot();

-- The 179000 definition compared activities.company_id (uuid) with text and
-- failed at runtime before mailbox-draft outcomes could resolve their actor.
-- email_connections.company_id remains text; only the activity comparison is
-- UUID-to-UUID.
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
  where outbound.company_id = p_company_id
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
    -- Shared mailbox connector metadata is never actor authority. Only the
    -- exact current assignee who owns a used OPS draft may be inferred.
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

create or replace function public.get_human_draft_accuracy_for_category_as_system(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_connection_id uuid,
  p_primary_category text,
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
  v_category text := upper(nullif(btrim(p_primary_category), ''));
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if v_category is null
     or coalesce(cardinality(private.phase_c_category_profile_types(v_category)), 0) = 0 then
    return;
  end if;

  if not exists (
    select 1
    from public.users actor
    join public.email_connections connection
      on connection.id = p_connection_id
     and connection.company_id = p_company_id::text
     and connection.status = 'active'
     and coalesce(connection.sync_enabled, false)
     and (
       connection.type::text <> 'individual'
       or btrim(coalesce(connection.user_id, '')) = p_actor_user_id::text
     )
    where actor.id = p_actor_user_id
      and actor.company_id = p_company_id
      and coalesce(actor.is_active, false)
      and actor.deleted_at is null
  ) then
    return;
  end if;

  return query
  select queue.draft_outcome, queue.profile_type
  from public.email_outbound_learning_queue queue
  where queue.company_id = p_company_id::text
    and queue.connection_id = p_connection_id
    and queue.user_id = p_actor_user_id::text
    and queue.status = 'completed'
    and queue.learning_authority = 'operator_approved'
    and queue.apply_learning is true
    and queue.draft_history_id is not null
    and queue.draft_outcome is not null
    and queue.actor_proof_type in (
      'accepted_send_intent',
      'accepted_approved_action',
      'native_mailbox_draft'
    )
    and queue.category_snapshot = upper(btrim(p_primary_category))
    and queue.profile_type = any (private.phase_c_category_profile_types(v_category))
  order by
    queue.occurred_at desc nulls last,
    queue.completed_at desc,
    queue.id desc
  limit v_limit;
end;
$function$;

revoke all on function public.get_human_draft_accuracy_for_category_as_system(
  uuid, uuid, uuid, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.get_human_draft_accuracy_for_category_as_system(
  uuid, uuid, uuid, text, integer
) to service_role;

-- Graduation is human proof for one canonical OPS actor, one mailbox, and one
-- immutable primary-category snapshot. Profile compatibility is an additional
-- drafting guard, never a substitute for category proof.
create or replace function private.phase_c_actor_mailbox_category_graduated(
  p_company_id uuid,
  p_connection_id uuid,
  p_actor_user_id uuid,
  p_category text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_profile_types text[] := private.phase_c_category_profile_types(p_category);
  v_sample_size integer := 0;
  v_unchanged integer := 0;
begin
  if coalesce(cardinality(v_profile_types), 0) = 0 then
    return false;
  end if;

  if not exists (
    select 1
    from public.users actor
    join public.email_connections connection
      on connection.id = p_connection_id
     and connection.company_id = p_company_id::text
     and connection.status = 'active'
     and coalesce(connection.sync_enabled, false)
     and (
       connection.type::text <> 'individual'
       or btrim(coalesce(connection.user_id, '')) = p_actor_user_id::text
     )
    where actor.id = p_actor_user_id
      and actor.company_id = p_company_id
      and coalesce(actor.is_active, false)
      and actor.deleted_at is null
  ) then
    return false;
  end if;

  with recent as (
    select queue.draft_outcome
    from public.email_outbound_learning_queue queue
    where queue.company_id = p_company_id::text
      and queue.connection_id = p_connection_id
      and queue.user_id = p_actor_user_id::text
      and queue.status = 'completed'
      and queue.learning_authority = 'operator_approved'
      and queue.apply_learning is true
      and queue.draft_history_id is not null
      and queue.draft_outcome is not null
      and queue.actor_proof_type in (
        'accepted_send_intent',
        'accepted_approved_action',
        'native_mailbox_draft'
      )
      and queue.profile_type = any (v_profile_types)
      and queue.category_snapshot = upper(btrim(p_category))
    order by
      queue.occurred_at desc nulls last,
      queue.completed_at desc,
      queue.id desc
    limit 50
  )
  select
    count(*)::integer,
    count(*) filter (
      where lower(coalesce(recent.draft_outcome ->> 'sentWithoutChanges', 'false')) = 'true'
    )::integer
  into v_sample_size, v_unchanged
  from recent;

  return v_sample_size >= 20
    and v_unchanged * 100 >= v_sample_size * 95;
end;
$function$;

revoke all on function private.phase_c_actor_mailbox_category_graduated(
  uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;

-- Approved-action customer communications predate per-category graduation and
-- still carry a legacy milestone prerequisite. Keep that prerequisite as a
-- compatibility floor, then require live exact CUSTOMER proof as the final
-- authorization layer for autonomous execution.
alter function private.approved_action_email_intent_is_authorized(uuid, boolean)
  rename to approved_action_email_intent_is_authorized_pre_phase_c_guard;

revoke all on function private.approved_action_email_intent_is_authorized_pre_phase_c_guard(
  uuid, boolean
) from public, anon, authenticated, service_role;

create or replace function private.approved_action_email_intent_is_authorized(
  p_intent_id uuid,
  p_require_signature boolean default true
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_intent public.approved_action_email_intents%rowtype;
  v_level text;
begin
  if not private.approved_action_email_intent_is_authorized_pre_phase_c_guard(
    p_intent_id,
    p_require_signature
  ) then
    return false;
  end if;

  select intent.*
  into v_intent
  from public.approved_action_email_intents intent
  where intent.id = p_intent_id;
  if not found then
    return false;
  end if;
  if v_intent.execution_mode <> 'autonomous' then
    return true;
  end if;

  select connection.auto_send_settings
    -> 'category_autonomy'
    ->> 'primary:CUSTOMER'
  into v_level
  from public.email_connections connection
  where connection.id = v_intent.connection_id
    and connection.company_id = v_intent.company_id::text
    and connection.status = 'active'
    and coalesce(connection.sync_enabled, false)
    and coalesce(connection.agent_can_send_from, false);
  if not found
     or coalesce(v_level, '') not in ('auto_send', 'auto_follow_up')
     or not private.phase_c_category_level_allowed('CUSTOMER', v_level)
     or not private.phase_c_actor_category_acceptance_active(
       v_intent.company_id,
       v_intent.connection_id,
       v_intent.actor_user_id,
       'CUSTOMER',
       v_level
     )
     or not private.phase_c_actor_mailbox_category_graduated(
       v_intent.company_id,
       v_intent.connection_id,
       v_intent.actor_user_id,
       'CUSTOMER'
     ) then
    return false;
  end if;

  return true;
end;
$function$;

revoke all on function private.approved_action_email_intent_is_authorized(
  uuid, boolean
) from public, anon, authenticated, service_role;

-- Prompt creation and settings acceptance serialize on the same mailbox row.
-- The recorder re-checks the exact actor, category, setting, and graduation
-- after taking that lock, so it cannot create a stale persistent prompt after
-- the category has already been accepted for autonomous sending.
create or replace function public.record_phase_c_graduation_prompt_as_system(
  p_company_id uuid,
  p_connection_id uuid,
  p_actor_user_id uuid,
  p_category text,
  p_title text,
  p_body text,
  p_action_url text,
  p_action_label text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_category text := upper(nullif(btrim(p_category), ''));
  v_connection public.email_connections%rowtype;
  v_level text;
  v_dedupe_key text;
  v_expected_action_url text;
  v_inserted integer := 0;
  v_reopened integer := 0;
  v_feature_enabled boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if v_category is null
     or v_category not in ('CUSTOMER', 'VENDOR', 'SUBTRADE', 'PLATFORM_BID')
     or nullif(btrim(p_title), '') is null
     or nullif(btrim(p_body), '') is null then
    raise exception 'graduation_prompt_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.users actor
    where actor.id = p_actor_user_id
      and actor.company_id = p_company_id
      and coalesce(actor.is_active, false)
      and actor.deleted_at is null
  ) then
    raise exception 'graduation_prompt_scope_unavailable' using errcode = '42501';
  end if;
  if not private.phase_c_actor_can_configure_connection(
    p_actor_user_id,
    p_connection_id
  ) then
    return false;
  end if;

  select afo.enabled
  into v_feature_enabled
  from public.admin_feature_overrides afo
  where afo.company_id = p_company_id::text
    and afo.feature_key = 'ai_auto_send'
    and afo.enabled
  for share;
  if not coalesce(v_feature_enabled, false) then
    return false;
  end if;

  select connection.*
  into v_connection
  from public.email_connections connection
  where connection.id = p_connection_id
    and connection.company_id = p_company_id::text
    and connection.status = 'active'
    and coalesce(connection.sync_enabled, false)
    and (
      connection.type::text <> 'individual'
      or btrim(coalesce(connection.user_id, '')) = p_actor_user_id::text
    )
  for update;
  if not found then
    raise exception 'graduation_prompt_scope_unavailable' using errcode = '42501';
  end if;

  v_level := v_connection.auto_send_settings
    -> 'category_autonomy'
    ->> ('primary:' || v_category);
  if coalesce(v_level, '') not in (
    'auto_draft',
    'auto_send',
    'auto_follow_up'
  ) then
    return false;
  end if;
  if v_level in ('auto_send', 'auto_follow_up')
     and not private.phase_c_actor_category_acceptance_active(
       p_company_id,
       p_connection_id,
       p_actor_user_id,
       v_category,
       v_level
     ) then
    -- Another actor may already have enabled this shared mailbox category.
    -- This actor still receives and must accept their own prompt.
    null;
  elsif v_level in ('auto_send', 'auto_follow_up') then
    return false;
  end if;
  if not private.phase_c_actor_mailbox_category_graduated(
    p_company_id,
    p_connection_id,
    p_actor_user_id,
    v_category
  ) then
    return false;
  end if;

  v_dedupe_key :=
    'phase-c-graduation:v1:'
    || p_company_id::text || ':'
    || p_connection_id::text || ':'
    || p_actor_user_id::text || ':'
    || lower(v_category);
  v_expected_action_url :=
    '/agent/auto-send?connectionId='
    || p_connection_id::text
    || '&category='
    || v_category;

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
    p_actor_user_id::text,
    p_company_id::text,
    'ai_milestone',
    btrim(p_title),
    btrim(p_body),
    false,
    true,
    v_expected_action_url,
    nullif(btrim(p_action_label), ''),
    v_dedupe_key
  )
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    return true;
  end if;

  -- Consent can be revoked after a prior acceptance (feature kill switch or a
  -- shared policy change). Re-open only this exact actor/mailbox/category row;
  -- the permanent dedupe identity must not suppress the required re-acceptance.
  update public.notifications notification
  set title = btrim(p_title),
      body = btrim(p_body),
      is_read = false,
      persistent = true,
      action_url = v_expected_action_url,
      action_label = nullif(btrim(p_action_label), ''),
      resolved_at = null
  where notification.user_id = p_actor_user_id::text
    and notification.company_id = p_company_id::text
    and notification.type = 'ai_milestone'
    and notification.dedupe_key = v_dedupe_key
    and notification.resolved_at is not null;

  get diagnostics v_reopened = row_count;
  if v_reopened = 1 then
    return true;
  end if;

  if not exists (
    select 1
    from public.notifications notification
    where notification.user_id = p_actor_user_id::text
      and notification.company_id = p_company_id::text
      and notification.type = 'ai_milestone'
      and notification.dedupe_key = v_dedupe_key
  ) then
    raise exception 'graduation_prompt_not_reconciled' using errcode = '55000';
  end if;

  return false;
end;
$function$;

revoke all on function public.record_phase_c_graduation_prompt_as_system(
  uuid, uuid, uuid, text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.record_phase_c_graduation_prompt_as_system(
  uuid, uuid, uuid, text, text, text, text, text
) to service_role;

-- Enforce the calibration snapshot at both durable boundaries. INSERT is the
-- scheduling boundary. Any UPDATE that results in leased status is the final
-- claim boundary immediately before a worker may create a provider send intent.
create or replace function private.enforce_phase_c_auto_send_category_calibration()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_category text;
  v_level text;
  v_failure text;
begin
  if tg_op = 'UPDATE'
     and new.category_snapshot is distinct from old.category_snapshot then
    raise exception 'PHASE_C_AUTO_SEND_CATEGORY_CHANGED';
  end if;
  if tg_op = 'UPDATE'
     and new.autonomy_level_snapshot is distinct from old.autonomy_level_snapshot then
    raise exception 'PHASE_C_AUTO_SEND_LEVEL_CHANGED';
  end if;
  if tg_op = 'UPDATE'
     and new.profile_type_snapshot is distinct from old.profile_type_snapshot then
    raise exception 'PHASE_C_AUTO_SEND_PROFILE_CATEGORY_MISMATCH';
  end if;

  if tg_op <> 'INSERT' and new.status <> 'leased' then
    return new;
  end if;

  select upper(thread.primary_category::text)
  into v_category
  from public.email_threads thread
  where thread.id = new.source_email_thread_id
    and thread.company_id = new.company_id
    and thread.connection_id = new.connection_id
    and thread.opportunity_id = new.opportunity_id
    and thread.provider_thread_id = new.thread_id;

  if tg_op = 'INSERT' then
    new.category_snapshot := v_category;
  elsif v_category is distinct from old.category_snapshot then
    v_failure := 'PHASE_C_AUTO_SEND_CATEGORY_CHANGED';
  end if;

  if v_failure is null then
    perform 1
    from public.admin_feature_overrides afo
    where afo.company_id = new.company_id::text
      and afo.feature_key = 'ai_auto_send'
      and afo.enabled;
    if not found then
      v_failure := 'PHASE_C_AUTO_SEND_FEATURE_DISABLED';
    end if;
  end if;

  if v_failure is null then
    select connection.auto_send_settings
      -> 'category_autonomy'
      ->> ('primary:' || v_category)
    into v_level
    from public.email_connections connection
    where connection.id = new.connection_id
      and connection.company_id = new.company_id::text
      and connection.status = 'active'
      and coalesce(connection.sync_enabled, false);

    if tg_op = 'UPDATE'
       and v_level is distinct from old.autonomy_level_snapshot then
      v_failure := 'PHASE_C_AUTO_SEND_LEVEL_CHANGED';
    end if;

    if v_failure is null
       and (v_category is null
       or coalesce(cardinality(private.phase_c_category_profile_types(v_category)), 0) = 0
       or coalesce(v_level, '') not in ('auto_send', 'auto_follow_up')
       or not private.phase_c_category_level_allowed(v_category, v_level)) then
      v_failure := 'PHASE_C_AUTO_SEND_CATEGORY_DISABLED';
    elsif v_failure is null and not (
      coalesce(nullif(btrim(new.profile_type_snapshot), ''), '') = any (private.phase_c_category_profile_types(v_category))
    ) then
      v_failure := 'PHASE_C_AUTO_SEND_PROFILE_CATEGORY_MISMATCH';
    elsif v_failure is null and not private.phase_c_actor_category_acceptance_active(
      new.company_id,
      new.connection_id,
      new.actor_user_id,
      v_category,
      v_level
    ) then
      v_failure := 'PHASE_C_AUTO_SEND_ACCEPTANCE_REQUIRED';
    elsif v_failure is null and not private.phase_c_actor_mailbox_category_graduated(
      new.company_id,
      new.connection_id,
      new.actor_user_id,
      v_category
    ) then
      v_failure := 'PHASE_C_AUTO_SEND_NOT_GRADUATED';
    end if;
  end if;

  if v_failure is null then
    if tg_op = 'INSERT' then
      new.autonomy_level_snapshot := v_level;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception '%', v_failure using errcode = '42501';
  end if;

  new.status := 'cancelled';
  new.cancelled_at := clock_timestamp();
  new.error := v_failure;
  new.lease_token := null;
  new.lease_expires_at := null;
  new.updated_at := clock_timestamp();
  return new;
end;
$function$;

revoke all on function private.enforce_phase_c_auto_send_category_calibration()
  from public, anon, authenticated, service_role;

drop trigger if exists pending_auto_sends_category_calibration
  on public.pending_auto_sends;
create trigger pending_auto_sends_category_calibration
before insert or update of status, category_snapshot, autonomy_level_snapshot, profile_type_snapshot
on public.pending_auto_sends
for each row
execute function private.enforce_phase_c_auto_send_category_calibration();

-- Keep the deployed RPC shape unchanged while placing the older implementation
-- behind the category trigger and a service-only wrapper.
alter function public.schedule_phase_c_auto_send(
  text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text,
  text[], text[], text, text, text, text, text, uuid, text, text,
  uuid, text, text, timestamptz
) rename to schedule_phase_c_auto_send_pre_category_guard;

revoke all on function public.schedule_phase_c_auto_send_pre_category_guard(
  text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text,
  text[], text[], text, text, text, text, text, uuid, text, text,
  uuid, text, text, timestamptz
) from public, anon, authenticated, service_role;

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
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_queue public.pending_auto_sends%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  select scheduled.*
  into v_queue
  from public.schedule_phase_c_auto_send_pre_category_guard(
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

  if v_queue.id is null
     or v_queue.category_snapshot is null
     or v_queue.autonomy_level_snapshot is null then
    raise exception 'PHASE_C_AUTO_SEND_CATEGORY_UNAVAILABLE' using errcode = '42501';
  end if;
  return v_queue;
end;
$function$;

revoke all on function public.schedule_phase_c_auto_send(text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text, text[], text[], text, text, text, text, text, uuid, text, text, uuid, text, text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.schedule_phase_c_auto_send(text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text, text[], text[], text, text, text, text, text, uuid, text, text, uuid, text, text, timestamptz) to service_role;

alter function public.claim_phase_c_auto_sends(integer, integer)
  rename to claim_phase_c_auto_sends_pre_category_guard;

revoke all on function public.claim_phase_c_auto_sends_pre_category_guard(integer, integer)
  from public, anon, authenticated, service_role;

create or replace function public.claim_phase_c_auto_sends(
  p_limit integer,
  p_lease_seconds integer
)
returns setof public.pending_auto_sends
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

  for v_queue in
    select guarded.*
    from public.claim_phase_c_auto_sends_pre_category_guard(
      p_limit,
      p_lease_seconds
    ) guarded
  loop
    if v_queue.status = 'leased' then
      return next v_queue;
    end if;
  end loop;
  return;
end;
$function$;

revoke all on function public.claim_phase_c_auto_sends(integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_phase_c_auto_sends(integer, integer) to service_role;

-- The queue lease and durable send intent are created in separate transactions.
-- Revalidate their exact shared source at the final prepared-to-sending boundary,
-- while holding the mailbox, queue, and source-thread locks. Nothing below this
-- point may widen a category, actor, mailbox, or lease snapshot.
alter function public.claim_email_send_provider_delivery(uuid)
  rename to claim_email_send_provider_delivery_pre_phase_c_guard;

revoke all on function public.claim_email_send_provider_delivery_pre_phase_c_guard(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.claim_email_send_provider_delivery(
  p_intent_id uuid
)
returns public.email_send_intents
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  intent public.email_send_intents%rowtype;
  queue public.pending_auto_sends%rowtype;
  thread public.email_threads%rowtype;
  connection public.email_connections%rowtype;
  claimed public.email_send_intents%rowtype;
  v_level text;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  select send_intent.*
  into intent
  from public.email_send_intents send_intent
  where send_intent.id = p_intent_id
  for update;
  if not found or intent.status <> 'prepared' then
    return null;
  end if;

  if intent.pending_auto_send_id is null then
    select previous_claim.*
    into claimed
    from public.claim_email_send_provider_delivery_pre_phase_c_guard(p_intent_id)
      previous_claim;
    return claimed;
  end if;

  perform 1
  from public.admin_feature_overrides afo
  where afo.company_id = intent.company_id::text
    and afo.feature_key = 'ai_auto_send'
    and afo.enabled
  for share;
  if not found then
    raise exception 'EMAIL_SEND_AUTHORIZATION_STALE' using errcode = '42501';
  end if;

  select mailbox.*
  into connection
  from public.email_connections mailbox
  where mailbox.id = intent.connection_id
    and mailbox.company_id = intent.company_id::text
    and mailbox.status = 'active'
    and coalesce(mailbox.sync_enabled, false)
    and coalesce(mailbox.agent_can_send_from, false)
    and coalesce(mailbox.auto_send_settings ->> 'enabled', 'false') = 'true'
  for share;
  if not found then
    raise exception 'EMAIL_SEND_AUTHORIZATION_STALE' using errcode = '42501';
  end if;

  select pending.*
  into queue
  from public.pending_auto_sends pending
  where pending.id = intent.pending_auto_send_id
  for update;
  if not found
     or intent.initiated_by <> 'phase_c_auto_send'
     or queue.status <> 'leased'
     or queue.lease_token is distinct from intent.pending_auto_send_lease_token
     or queue.lease_expires_at <= v_now
     or queue.company_id is distinct from intent.company_id
     or queue.actor_user_id is distinct from intent.actor_user_id
     or queue.assignment_version is distinct from intent.assignment_version
     or queue.assignment_event_id is distinct from intent.assignment_event_id
     or queue.connection_id is distinct from intent.connection_id
     or queue.opportunity_id is distinct from intent.opportunity_id
     or queue.source_email_thread_id is distinct from intent.source_email_thread_id
     or queue.thread_id is distinct from intent.reply_provider_thread_id
     or queue.in_reply_to is distinct from intent.in_reply_to
     or queue.idempotency_key is distinct from intent.idempotency_key
     or queue.to_emails is distinct from intent.to_emails
     or queue.cc_emails is distinct from intent.cc_emails
     or queue.subject is distinct from intent.subject
     or queue.authored_body is distinct from intent.authored_body
     or queue.rendered_body is distinct from intent.rendered_body
     or queue.content_type is distinct from intent.content_type
     or queue.draft_history_id is distinct from intent.draft_history_id
     or queue.profile_type_snapshot is distinct from intent.profile_type_snapshot
     or queue.learning_authority is distinct from intent.learning_authority
     or queue.signature_id is distinct from intent.signature_id
     or queue.signature_content_hash is distinct from intent.signature_content_hash
     or queue.rendered_body_hash is distinct from intent.rendered_body_hash then
    raise exception 'EMAIL_SEND_AUTHORIZATION_STALE' using errcode = '42501';
  end if;

  select source_thread.*
  into thread
  from public.email_threads source_thread
  where source_thread.id = intent.source_email_thread_id
    and source_thread.company_id = intent.company_id
    and source_thread.connection_id = intent.connection_id
    and source_thread.opportunity_id = intent.opportunity_id
    and source_thread.provider_thread_id = intent.reply_provider_thread_id
  for share;
  if not found
     or upper(thread.primary_category::text) is distinct from queue.category_snapshot then
    raise exception 'EMAIL_SEND_AUTHORIZATION_STALE' using errcode = '42501';
  end if;

  v_level := connection.auto_send_settings
    -> 'category_autonomy'
    ->> ('primary:' || queue.category_snapshot);
  if coalesce(queue.autonomy_level_snapshot, '') not in ('auto_send', 'auto_follow_up')
     or v_level is distinct from queue.autonomy_level_snapshot
     or not private.phase_c_category_level_allowed(
       queue.category_snapshot,
       queue.autonomy_level_snapshot
     )
     or not (
       queue.profile_type_snapshot = any (
         private.phase_c_category_profile_types(queue.category_snapshot)
       )
     )
     or not private.phase_c_actor_category_acceptance_active(
       queue.company_id,
      queue.connection_id,
      queue.actor_user_id,
      queue.category_snapshot,
      queue.autonomy_level_snapshot
     )
     or not private.phase_c_actor_mailbox_category_graduated(
       queue.company_id,
       queue.connection_id,
       queue.actor_user_id,
       queue.category_snapshot
     ) then
    raise exception 'EMAIL_SEND_AUTHORIZATION_STALE' using errcode = '42501';
  end if;

  select previous_claim.*
  into claimed
  from public.claim_email_send_provider_delivery_pre_phase_c_guard(p_intent_id)
    previous_claim;
  return claimed;
end;
$function$;

revoke all on function public.claim_email_send_provider_delivery(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_email_send_provider_delivery(uuid)
  to service_role;

-- Settings acceptance and exact prompt resolution share one transaction. The
-- browser cannot mark a category autonomous and leave a stale persistent
-- graduation prompt behind, nor can a service caller spoof another OPS actor.
create or replace function public.update_phase_c_auto_send_settings_as_system(
  p_company_id uuid,
  p_connection_id uuid,
  p_actor_user_id uuid,
  p_settings_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_connection public.email_connections%rowtype;
  v_current_settings jsonb;
  v_next_settings jsonb;
  v_current_categories jsonb;
  v_next_categories jsonb;
  v_category_key text;
  v_category text;
  v_level text;
  v_previous_level text;
  v_accepted_categories text[] := '{}'::text[];
  v_dedupe_key text;
  v_feature_enabled boolean := false;
  v_enable_transport boolean := false;
  v_disable_transport boolean := false;
  v_has_primary_auto boolean := false;
  v_delay_min integer;
  v_delay_max integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_settings_patch is null
     or jsonb_typeof(p_settings_patch) <> 'object'
     or (p_settings_patch - array[
       'enabled',
       'business_hours_start',
       'business_hours_end',
       'timezone',
       'delay_min_minutes',
       'delay_max_minutes',
       'auto_draft_enabled',
       'category_autonomy'
     ]::text[]) <> '{}'::jsonb then
    raise exception 'auto_send_settings_patch_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.users actor
    where actor.id = p_actor_user_id
      and actor.company_id = p_company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
  ) then
    raise exception 'auto_send_settings_actor_invalid' using errcode = '42501';
  end if;

  select afo.enabled
  into v_feature_enabled
  from public.admin_feature_overrides afo
  where afo.company_id = p_company_id::text
    and afo.feature_key = 'ai_auto_send'
    and afo.enabled
  for share;

  select connection.*
  into v_connection
  from public.email_connections connection
  where connection.id = p_connection_id
    and connection.company_id = p_company_id::text
    and connection.status = 'active'
  for update;
  if not found then
    raise exception 'auto_send_settings_connection_invalid' using errcode = '42501';
  end if;

  if v_connection.type::text not in ('individual', 'company') then
    raise exception 'auto_send_settings_connection_type_invalid' using errcode = '42501';
  end if;
  if not private.phase_c_actor_can_configure_connection(
    p_actor_user_id,
    p_connection_id
  ) then
    raise exception 'auto_send_settings_permission_denied' using errcode = '42501';
  end if;

  if p_settings_patch ? 'enabled'
     and jsonb_typeof(p_settings_patch -> 'enabled') <> 'boolean' then
    raise exception 'auto_send_settings_enabled_invalid' using errcode = '22023';
  end if;
  if p_settings_patch ? 'auto_draft_enabled'
     and jsonb_typeof(p_settings_patch -> 'auto_draft_enabled') <> 'boolean' then
    raise exception 'auto_send_settings_auto_draft_invalid' using errcode = '22023';
  end if;
  if p_settings_patch ? 'category_autonomy'
     and jsonb_typeof(p_settings_patch -> 'category_autonomy') <> 'object' then
    raise exception 'auto_send_settings_categories_invalid' using errcode = '22023';
  end if;
  if (
       p_settings_patch ? 'business_hours_start'
       and (
         jsonb_typeof(p_settings_patch -> 'business_hours_start') <> 'string'
         or (p_settings_patch ->> 'business_hours_start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       )
     )
     or (
       p_settings_patch ? 'business_hours_end'
       and (
         jsonb_typeof(p_settings_patch -> 'business_hours_end') <> 'string'
         or (p_settings_patch ->> 'business_hours_end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       )
     ) then
    raise exception 'auto_send_settings_business_hours_invalid' using errcode = '22023';
  end if;
  if p_settings_patch ? 'timezone'
     and (
       jsonb_typeof(p_settings_patch -> 'timezone') <> 'string'
       or not exists (
         select 1
         from pg_catalog.pg_timezone_names timezone
         where timezone.name = p_settings_patch ->> 'timezone'
       )
     ) then
    raise exception 'auto_send_settings_timezone_invalid' using errcode = '22023';
  end if;
  if (
       p_settings_patch ? 'delay_min_minutes'
       and (
         jsonb_typeof(p_settings_patch -> 'delay_min_minutes') <> 'number'
         or (p_settings_patch ->> 'delay_min_minutes') !~ '^[0-9]+$'
         or (p_settings_patch ->> 'delay_min_minutes')::numeric > 1440
       )
     )
     or (
       p_settings_patch ? 'delay_max_minutes'
       and (
         jsonb_typeof(p_settings_patch -> 'delay_max_minutes') <> 'number'
         or (p_settings_patch ->> 'delay_max_minutes') !~ '^[0-9]+$'
         or (p_settings_patch ->> 'delay_max_minutes')::numeric > 1440
       )
     ) then
    raise exception 'auto_send_settings_delay_invalid' using errcode = '22023';
  end if;

  v_current_settings := coalesce(v_connection.auto_send_settings, '{}'::jsonb);
  v_current_categories := coalesce(
    v_current_settings -> 'category_autonomy',
    '{}'::jsonb
  );
  v_next_settings := v_current_settings || (p_settings_patch - 'category_autonomy');
  v_next_categories := v_current_categories || coalesce(
    p_settings_patch -> 'category_autonomy',
    '{}'::jsonb
  );
  v_next_settings := jsonb_set(
    v_next_settings,
    '{category_autonomy}',
    v_next_categories,
    true
  );
  v_delay_min := coalesce(
    nullif(v_next_settings ->> 'delay_min_minutes', '')::integer,
    30
  );
  v_delay_max := coalesce(
    nullif(v_next_settings ->> 'delay_max_minutes', '')::integer,
    60
  );
  if v_delay_min < 0
     or v_delay_max < 0
     or v_delay_min > v_delay_max
     or v_delay_max > 1440 then
    raise exception 'auto_send_settings_delay_invalid' using errcode = '22023';
  end if;

  for v_category_key, v_level in
    select entry.key, entry.value
    from jsonb_each_text(coalesce(
      p_settings_patch -> 'category_autonomy',
      '{}'::jsonb
    )) entry
  loop
    if v_level is null or v_level not in (
      'off',
      'draft_on_request',
      'auto_draft',
      'auto_send',
      'auto_archive',
      'auto_follow_up'
    ) then
      raise exception 'auto_send_settings_category_level_invalid' using errcode = '22023';
    end if;

    if left(v_category_key, 8) = 'primary:' then
      v_category := upper(substr(v_category_key, 9));
      if v_category_key <> 'primary:' || v_category
         or not private.phase_c_category_level_allowed(v_category, v_level) then
        raise exception 'auto_send_settings_category_level_invalid'
          using errcode = '22023';
      end if;

      if v_level in ('auto_send', 'auto_follow_up') then
        if not coalesce(v_feature_enabled, false) then
          raise exception 'auto_send_settings_feature_disabled'
            using errcode = '42501';
        end if;
        if not private.phase_c_actor_mailbox_category_graduated(
          p_company_id,
          p_connection_id,
          p_actor_user_id,
          v_category
        ) then
          raise exception 'auto_send_settings_category_not_graduated' using errcode = '42501';
        end if;

        v_previous_level := v_current_categories ->> v_category_key;
        if v_previous_level is distinct from v_level then
          update public.phase_c_category_auto_send_acceptances acceptance
          set revoked_at = clock_timestamp(),
              updated_at = clock_timestamp()
          where acceptance.company_id = p_company_id
            and acceptance.connection_id = p_connection_id
            and acceptance.primary_category = v_category
            and acceptance.revoked_at is null;
        end if;

        insert into public.phase_c_category_auto_send_acceptances (
          company_id,
          connection_id,
          actor_user_id,
          primary_category,
          accepted_level,
          accepted_at,
          revoked_at,
          updated_at
        ) values (
          p_company_id,
          p_connection_id,
          p_actor_user_id,
          v_category,
          v_level,
          clock_timestamp(),
          null,
          clock_timestamp()
        )
        on conflict (company_id, connection_id, actor_user_id, primary_category)
        do update
        set accepted_level = excluded.accepted_level,
            accepted_at = excluded.accepted_at,
            revoked_at = null,
            updated_at = excluded.updated_at;

        v_accepted_categories := array_append(v_accepted_categories, v_category);
      else
        -- A shared category policy downgrade invalidates every actor's prior
        -- consent. Re-enabling autonomous send requires fresh exact consent.
        update public.phase_c_category_auto_send_acceptances acceptance
        set revoked_at = clock_timestamp(),
            updated_at = clock_timestamp()
        where acceptance.company_id = p_company_id
          and acceptance.connection_id = p_connection_id
          and acceptance.primary_category = v_category
          and acceptance.revoked_at is null;
      end if;
    elsif v_level in ('auto_send', 'auto_follow_up') then
      raise exception 'auto_send_settings_legacy_send_forbidden'
        using errcode = '42501';
    end if;
  end loop;

  if p_settings_patch ? 'enabled'
     and (p_settings_patch ->> 'enabled')::boolean
     and not coalesce((v_current_settings ->> 'enabled')::boolean, false)
     and coalesce(cardinality(v_accepted_categories), 0) = 0 then
    raise exception 'auto_send_settings_category_acceptance_required'
      using errcode = '42501';
  end if;
  if p_settings_patch ? 'enabled'
     and not (p_settings_patch ->> 'enabled')::boolean
     and coalesce(cardinality(v_accepted_categories), 0) > 0 then
    raise exception 'auto_send_settings_patch_conflict' using errcode = '22023';
  end if;

  if p_settings_patch ? 'enabled'
     and not (p_settings_patch ->> 'enabled')::boolean then
    update public.phase_c_category_auto_send_acceptances acceptance
    set revoked_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where acceptance.company_id = p_company_id
      and acceptance.connection_id = p_connection_id
      and acceptance.revoked_at is null;
  end if;

  select exists (
    select 1
    from public.phase_c_category_auto_send_acceptances acceptance
    join public.users actor
      on actor.id = acceptance.actor_user_id
     and actor.company_id = acceptance.company_id
     and actor.deleted_at is null
     and coalesce(actor.is_active, false)
    join lateral jsonb_each_text(v_next_categories) category
      on category.key = 'primary:' || acceptance.primary_category
     and category.value = acceptance.accepted_level
    where acceptance.company_id = p_company_id
      and acceptance.connection_id = p_connection_id
      and acceptance.revoked_at is null
      and category.value in ('auto_send', 'auto_follow_up')
      and private.phase_c_category_level_allowed(
        acceptance.primary_category,
        category.value
      )
  ) into v_has_primary_auto;

  v_enable_transport :=
    coalesce(v_feature_enabled, false)
    and v_has_primary_auto
    and not (
      p_settings_patch ? 'enabled'
      and not (p_settings_patch ->> 'enabled')::boolean
    );
  v_disable_transport :=
    not v_enable_transport
    and (
      coalesce((v_current_settings ->> 'enabled')::boolean, false)
      or coalesce(v_connection.agent_can_send_from, false)
      or (
        p_settings_patch ? 'enabled'
        and not (p_settings_patch ->> 'enabled')::boolean
      )
    );

  v_next_settings := jsonb_set(
    v_next_settings,
    '{enabled}',
    to_jsonb(v_enable_transport),
    true
  );
  if v_enable_transport
     and nullif(v_current_settings ->> 'enabled_at', '') is null then
    v_next_settings := jsonb_set(
      v_next_settings,
      '{enabled_at}',
      to_jsonb(clock_timestamp()::text),
      true
    );
  end if;

  update public.email_connections connection
  set auto_send_settings = v_next_settings,
      agent_can_send_from = v_enable_transport,
      updated_at = clock_timestamp()
  where connection.id = p_connection_id
    and connection.company_id = p_company_id::text;

  if v_disable_transport then
    update public.pending_auto_sends queue
    set status = 'cancelled',
        cancelled_at = clock_timestamp(),
        error = 'PHASE_C_AUTO_SEND_DISABLED',
        lease_token = null,
        lease_expires_at = null,
        updated_at = clock_timestamp()
    where queue.company_id = p_company_id
      and queue.connection_id = p_connection_id
      and queue.status in ('pending', 'leased');
  end if;

  foreach v_category in array v_accepted_categories
  loop
    -- The older approved-action transport still reads this actor-scoped bit.
    -- It is now only a compatibility projection of an exact accepted CUSTOMER
    -- category; the wrapper below also re-checks live exact readiness.
    if v_category = 'CUSTOMER' then
      insert into public.email_autonomy_milestones (
        company_id,
        connection_id,
        user_id,
        auto_send_suggested
      ) values (
        p_company_id,
        p_connection_id,
        p_actor_user_id,
        true
      )
      on conflict (company_id, connection_id, user_id) do update
      set auto_send_suggested = true,
          updated_at = clock_timestamp();
    end if;

    v_dedupe_key :=
      'phase-c-graduation:v1:'
      || p_company_id::text || ':'
      || p_connection_id::text || ':'
      || p_actor_user_id::text || ':'
      || lower(v_category);

    update public.notifications notification
    set resolved_at = clock_timestamp(),
        is_read = true
    where notification.user_id = p_actor_user_id::text
      and notification.company_id = p_company_id::text
      and notification.dedupe_key = v_dedupe_key
      and notification.resolved_at is null;
  end loop;

  return v_next_settings;
end;
$function$;

revoke all on function public.update_phase_c_auto_send_settings_as_system(
  uuid, uuid, uuid, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.update_phase_c_auto_send_settings_as_system(
  uuid, uuid, uuid, jsonb
) to service_role;

-- Graduation sweeps are leased atomically. If completion bookkeeping is
-- temporarily unavailable, the lease keeps the first page from monopolizing
-- every later run and the scope becomes retryable after a bounded timeout.
alter table public.email_autonomy_milestones
  add column if not exists graduation_lease_token uuid,
  add column if not exists graduation_lease_expires_at timestamptz;

create index if not exists email_autonomy_milestones_graduation_lease_idx
  on public.email_autonomy_milestones (
    graduation_lease_expires_at,
    graduation_next_attempt_at,
    graduation_last_attempt_at
  );

create or replace function public.claim_phase_c_graduation_actor_scopes_as_system(
  p_limit integer default 200,
  p_lease_seconds integer default 900
)
returns table (
  company_id uuid,
  connection_id uuid,
  actor_user_id uuid,
  lease_token uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 200), 1000));
  v_lease_seconds integer := greatest(60, least(coalesce(p_lease_seconds, 900), 3600));
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  insert into public.email_autonomy_milestones (
    company_id,
    connection_id,
    user_id
  )
  select distinct
    actor.company_id,
    connection.id,
    actor.id
  from public.email_outbound_learning_queue queue
  join public.email_connections connection
    on connection.id = queue.connection_id
   and connection.company_id = queue.company_id
   and connection.status = 'active'
   and coalesce(connection.sync_enabled, false)
  join public.users actor
    on actor.id::text = queue.user_id
   and actor.company_id::text = queue.company_id
   and actor.deleted_at is null
   and coalesce(actor.is_active, false)
  where queue.status = 'completed'
    and queue.learning_authority in ('operator_authored', 'operator_approved')
    and queue.apply_learning is true
    and queue.actor_proof_type in (
      'accepted_send_intent',
      'accepted_approved_action',
      'native_mailbox_draft',
      'personal_mailbox_owner'
    )
    and (
      connection.type::text <> 'individual'
      or btrim(coalesce(connection.user_id, '')) = actor.id::text
    )
  on conflict do nothing;

  return query
  with candidates as materialized (
    select milestone.id
    from public.email_autonomy_milestones milestone
    join public.email_connections connection
      on connection.id = milestone.connection_id
     and connection.company_id = milestone.company_id::text
     and connection.status = 'active'
     and coalesce(connection.sync_enabled, false)
     and (
       connection.type::text <> 'individual'
       or btrim(coalesce(connection.user_id, '')) = milestone.user_id::text
     )
    join public.users actor
      on actor.id = milestone.user_id
     and actor.company_id = milestone.company_id
     and actor.deleted_at is null
     and coalesce(actor.is_active, false)
    where (
      milestone.graduation_next_attempt_at is null
      or milestone.graduation_next_attempt_at <= v_now
    )
      and (
        milestone.graduation_lease_token is null
        or milestone.graduation_lease_expires_at <= v_now
      )
      and exists (
        select 1
        from public.email_outbound_learning_queue queue
        where queue.company_id = milestone.company_id::text
          and queue.connection_id = milestone.connection_id
          and queue.user_id = milestone.user_id::text
          and queue.status = 'completed'
          and queue.learning_authority in ('operator_authored', 'operator_approved')
          and queue.apply_learning is true
          and queue.actor_proof_type in (
            'accepted_send_intent',
            'accepted_approved_action',
            'native_mailbox_draft',
            'personal_mailbox_owner'
          )
      )
    order by
      milestone.graduation_last_attempt_at asc nulls first,
      milestone.company_id,
      milestone.connection_id,
      milestone.user_id
    limit v_limit
    for update of milestone skip locked
  ), leased as (
    update public.email_autonomy_milestones milestone
    set graduation_last_attempt_at = v_now,
        graduation_lease_token = gen_random_uuid(),
        graduation_lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
        updated_at = v_now
    from candidates
    where milestone.id = candidates.id
    returning
      milestone.company_id,
      milestone.connection_id,
      milestone.user_id,
      milestone.graduation_lease_token
  )
  select
    leased.company_id,
    leased.connection_id,
    leased.user_id,
    leased.graduation_lease_token
  from leased;
end;
$function$;

revoke all on function public.claim_phase_c_graduation_actor_scopes_as_system(
  integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.claim_phase_c_graduation_actor_scopes_as_system(
  integer, integer
) to service_role;

create or replace function public.complete_phase_c_graduation_scope_check_as_system(
  p_company_id uuid,
  p_connection_id uuid,
  p_actor_user_id uuid,
  p_lease_token uuid,
  p_succeeded boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_updated integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_lease_token is null or p_succeeded is null then
    raise exception 'graduation_check_result_required' using errcode = '22023';
  end if;

  update public.email_autonomy_milestones milestone
  set graduation_last_succeeded_at = case
        when p_succeeded then v_now
        else milestone.graduation_last_succeeded_at
      end,
      graduation_failure_count = case
        when p_succeeded then 0
        else milestone.graduation_failure_count + 1
      end,
      graduation_next_attempt_at = case
        when p_succeeded then v_now + interval '24 hours'
        when milestone.graduation_failure_count <= 0 then v_now + interval '1 hour'
        when milestone.graduation_failure_count = 1 then v_now + interval '2 hours'
        when milestone.graduation_failure_count = 2 then v_now + interval '4 hours'
        when milestone.graduation_failure_count = 3 then v_now + interval '8 hours'
        else v_now + interval '16 hours'
      end,
      graduation_last_error = case
        when p_succeeded then null
        else left(coalesce(nullif(btrim(p_error), ''), 'milestone check failed'), 500)
      end,
      graduation_lease_token = null,
      graduation_lease_expires_at = null,
      updated_at = v_now
  where milestone.company_id = p_company_id
    and milestone.connection_id = p_connection_id
    and milestone.user_id = p_actor_user_id
    and milestone.graduation_lease_token = p_lease_token;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'graduation_scope_lease_lost' using errcode = '40001';
  end if;
end;
$function$;

revoke all on function public.complete_phase_c_graduation_scope_check_as_system(
  uuid, uuid, uuid, uuid, boolean, text
) from public, anon, authenticated, service_role;
grant execute on function public.complete_phase_c_graduation_scope_check_as_system(
  uuid, uuid, uuid, uuid, boolean, text
) to service_role;

-- Rolling compatibility for a worker deployed before lease tokens were added.
-- Tokenless workers receive no new scopes. A stale tokenless worker that was
-- already in flight is rejected by the legacy completion overload below; it
-- can never discover and complete a newer worker's replacement lease.
create or replace function public.list_phase_c_graduation_actor_scopes_as_system(
  p_limit integer default 200
)
returns table (
  company_id uuid,
  connection_id uuid,
  actor_user_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  return;
end;
$function$;

revoke all on function public.list_phase_c_graduation_actor_scopes_as_system(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_phase_c_graduation_actor_scopes_as_system(integer)
  to service_role;

create or replace function public.complete_phase_c_graduation_scope_check_as_system(
  p_company_id uuid,
  p_connection_id uuid,
  p_actor_user_id uuid,
  p_succeeded boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  raise exception 'graduation_scope_lease_token_required' using errcode = '42501';
end;
$function$;

revoke all on function public.complete_phase_c_graduation_scope_check_as_system(
  uuid, uuid, uuid, boolean, text
) from public, anon, authenticated, service_role;
grant execute on function public.complete_phase_c_graduation_scope_check_as_system(
  uuid, uuid, uuid, boolean, text
) to service_role;

commit;
