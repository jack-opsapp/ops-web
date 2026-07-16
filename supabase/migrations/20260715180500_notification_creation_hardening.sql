begin;

-- Browser sessions may read and resolve their own notifications, but may not
-- mint authority-looking rows for coworkers. All creation now crosses either
-- a narrow actor-derived RPC or a trusted service boundary.
drop policy if exists notifications_insert_company on public.notifications;

revoke insert, delete, truncate on table public.notifications
  from public, anon, authenticated;

-- The generic dedupe RPC accepts recipient, company, copy, and navigation.
-- It is intentionally service-only; app sessions use narrow RPCs whose inputs
-- cannot express any of those fields.
revoke all on function public.create_notification_if_new(
  text,
  text,
  text,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated, service_role;

grant execute on function public.create_notification_if_new(
  text,
  text,
  text,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  text
) to service_role;

-- Push delivery must follow the first durable rail insert, not every retry of
-- an otherwise valid event. This service-only companion reports whether its
-- dedupe insert won so callers can suppress duplicate pushes atomically.
create or replace function public.create_notification_if_new_with_status(
  p_user_id text,
  p_company_id text,
  p_type text,
  p_title text,
  p_body text,
  p_persistent boolean default false,
  p_action_url text default null,
  p_action_label text default null,
  p_project_id text default null,
  p_deep_link_type text default null,
  p_dedupe_key text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_inserted integer := 0;
begin
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
    project_id,
    deep_link_type,
    dedupe_key
  )
  values (
    p_user_id,
    p_company_id,
    p_type,
    p_title,
    p_body,
    false,
    p_persistent,
    p_action_url,
    p_action_label,
    p_project_id,
    p_deep_link_type,
    nullif(btrim(p_dedupe_key), '')
  )
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

revoke all on function public.create_notification_if_new_with_status(
  text,
  text,
  text,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated, service_role;

grant execute on function public.create_notification_if_new_with_status(
  text,
  text,
  text,
  text,
  text,
  boolean,
  text,
  text,
  text,
  text,
  text
) to service_role;

-- The original signature reconciler accepts company and recipient identity as
-- arguments. Keep it as an owner-only implementation detail and expose a
-- narrower service bridge that derives the tenant and recipient from the
-- authenticated OPS actor supplied by trusted server code. A company
-- connection's legacy connector user_id is deliberately ignored; only an
-- individual connection may use user_id as an ownership boundary.
revoke all on function public.sync_email_signature_notification(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

-- Immediate reconciliation and lifecycle retries share one eligibility
-- predicate. Canonical inbox helpers preserve all-scope access and explicit
-- granular revokes; raw inbox.send checks must never drift from them.
create or replace function private.user_has_email_signature_notification_path(
  p_actor_user_id uuid,
  p_connection_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_company_id uuid;
  v_connection record;
  v_standalone_send boolean := false;
  v_has_sendable_opportunity boolean := false;
begin
  select actor.company_id
    into v_company_id
  from public.users actor
  where actor.id = p_actor_user_id
    and actor.company_id is not null
    and actor.deleted_at is null
    and coalesce(actor.is_active, false);

  if v_company_id is null then
    return false;
  end if;

  select
    connection.id,
    connection.type::text as type,
    connection.user_id,
    connection.status,
    connection.sync_enabled
    into v_connection
  from public.email_connections connection
  where connection.id = p_connection_id
    and connection.company_id = v_company_id::text
    and connection.type::text in ('company', 'individual')
    and connection.status = 'active'
    and coalesce(connection.sync_enabled, false);

  if not found then
    return false;
  end if;

  v_standalone_send := private.user_can_send_inbox_connection(
    p_actor_user_id,
    v_company_id,
    p_connection_id,
    null
  );

  -- Scan every current lead once. Reassignment of one lead must not resolve
  -- the prompt while another canonical actor/connection path still exists.
  select exists (
    select 1
    from public.opportunities o
    where o.company_id = v_company_id
      and o.deleted_at is null
      and o.archived_at is null
      and private.user_can_send_opportunity_inbox(
        p_actor_user_id,
        o.id,
        p_connection_id
      )
  ) into v_has_sendable_opportunity;

  if v_connection.type = 'individual' then
    return nullif(btrim(v_connection.user_id), '') = p_actor_user_id::text
      and (v_standalone_send or v_has_sendable_opportunity);
  end if;

  -- Company mailbox connector identity is legacy transport metadata, never
  -- actor authority. Integration admins still need canonical send authority.
  if public.has_permission(
    p_actor_user_id,
    'settings.integrations',
    'all'
  ) and v_standalone_send then
    return true;
  end if;

  return v_has_sendable_opportunity;
end;
$$;

revoke all on function private.user_has_email_signature_notification_path(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.sync_email_signature_notification_as_system(
  p_actor_user_id uuid,
  p_connection_id uuid
)
returns public.notifications
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_company_id uuid;
  v_connection public.email_connections%rowtype;
  v_dedupe_key text;
  v_signature_available boolean := false;
  v_has_current_send_path boolean := false;
  v_notification public.notifications%rowtype;
begin
  select u.company_id
  into v_company_id
  from public.users u
  where u.id = p_actor_user_id
    and u.company_id is not null;

  if v_company_id is null then
    raise exception 'signature notification actor is unavailable'
      using errcode = '42501';
  end if;

  select c.*
  into v_connection
  from public.email_connections c
  where c.id = p_connection_id
    and c.company_id = v_company_id::text
  for share;

  if v_connection.id is null then
    raise exception 'signature notification connection is unavailable'
      using errcode = '42501';
  end if;

  v_dedupe_key := 'email-signature:'
    || p_connection_id::text
    || ':'
    || p_actor_user_id::text;
  perform pg_advisory_xact_lock(hashtextextended(v_dedupe_key, 0));

  -- Effective-signature resolution is intentionally independent from current
  -- transport state. Saving while sync is disabled still closes the exact
  -- same-tenant prompt.
  select exists (
    select 1
    from public.email_signatures signature
    where signature.company_id = v_company_id
      and signature.connection_id = p_connection_id
      and signature.active
      and (
        nullif(btrim(signature.content_html), '') is not null
        or nullif(btrim(signature.content_text), '') is not null
      )
      and (
        (
          signature.source = 'ops'
          and (
            signature.scope_user_id = p_actor_user_id
            or signature.scope_user_id is null
          )
        )
        or (
          signature.source <> 'ops'
          and lower(btrim(signature.provider_identity))
            = lower(btrim(v_connection.email))
        )
      )
  ) into v_signature_available;

  if v_signature_available then
    update public.notifications n
    set resolved_at = now(),
        resolved_by = p_actor_user_id,
        resolution_reason = 'signature_available',
        is_read = true
    where n.user_id = p_actor_user_id::text
      and n.company_id = v_company_id::text
      and n.type = 'email_signature_required'
      and n.dedupe_key = v_dedupe_key
      and n.resolved_at is null;

    select n.*
      into v_notification
    from public.notifications n
    where n.user_id = p_actor_user_id::text
      and n.company_id = v_company_id::text
      and n.type = 'email_signature_required'
      and n.dedupe_key = v_dedupe_key
    order by n.resolved_at desc nulls last, n.created_at desc, n.id desc
    limit 1;

    return v_notification;
  end if;

  v_has_current_send_path :=
    private.user_has_email_signature_notification_path(
      p_actor_user_id,
      p_connection_id
    );

  if not v_has_current_send_path then
    update public.notifications n
    set resolved_at = now(),
        resolved_by = null,
        resolution_reason = 'signature_access_lost',
        is_read = true
    where n.user_id = p_actor_user_id::text
      and n.company_id = v_company_id::text
      and n.type = 'email_signature_required'
      and n.dedupe_key = v_dedupe_key
      and n.resolved_at is null;

    select n.*
      into v_notification
    from public.notifications n
    where n.user_id = p_actor_user_id::text
      and n.company_id = v_company_id::text
      and n.type = 'email_signature_required'
      and n.dedupe_key = v_dedupe_key
    order by n.resolved_at desc nulls last, n.created_at desc, n.id desc
    limit 1;

    return v_notification;
  end if;

  -- The original reconciler creates/reopens only after the shared eligibility
  -- predicate succeeds. It remains owner-only.
  v_notification := public.sync_email_signature_notification(
    v_company_id,
    p_connection_id,
    p_actor_user_id
  );

  if v_notification.id is not null then
    update public.notifications n
    set action_url = '/settings?section=profile&connection='
          || p_connection_id::text,
        action_label = 'ADD SIGNATURE'
    where n.id = v_notification.id
      and n.company_id = v_company_id::text
      and n.user_id = p_actor_user_id::text
      and n.type = 'email_signature_required'
    returning n.* into v_notification;
  end if;

  return v_notification;
end;
$$;

revoke all on function public.sync_email_signature_notification_as_system(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.sync_email_signature_notification_as_system(uuid, uuid)
  to service_role;

-- Assignment, permission, mailbox, and signature writes only coalesce work.
-- Notification creation/resolution runs later through the service-only
-- processor, so notification failure cannot roll back assignment or disable.
create table if not exists public.email_signature_notification_lifecycle_outbox (
  actor_user_id uuid not null
    references public.users(id) on delete cascade,
  connection_id uuid not null
    references public.email_connections(id) on delete cascade,
  company_id uuid not null
    references public.companies(id) on delete cascade,
  reason text not null,
  requested_at timestamptz not null default clock_timestamp(),
  available_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  primary key (actor_user_id, connection_id, company_id)
);

create index if not exists email_signature_notification_lifecycle_pending_idx
  on public.email_signature_notification_lifecycle_outbox (
    available_at,
    requested_at,
    actor_user_id,
    connection_id,
    company_id
  )
  where processed_at is null;

alter table public.email_signature_notification_lifecycle_outbox
  enable row level security;
revoke all on table public.email_signature_notification_lifecycle_outbox
  from public, anon, authenticated, service_role;
grant select
  on table public.email_signature_notification_lifecycle_outbox
  to service_role;

create or replace function public.enqueue_email_signature_notification_lifecycle_for_company(
  p_actor_user_id uuid,
  p_connection_id uuid,
  p_company_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_actor_user_id is null
     or p_connection_id is null
     or p_company_id is null
     or not exists (
       select 1
       from public.users actor
       where actor.id = p_actor_user_id
     )
     or not exists (
       select 1
       from public.companies company
       where company.id = p_company_id
     )
     or not exists (
       select 1
       from public.email_connections connection
       where connection.id = p_connection_id
     ) then
    return;
  end if;

  insert into public.email_signature_notification_lifecycle_outbox (
    actor_user_id,
    connection_id,
    company_id,
    reason,
    requested_at,
    available_at,
    processed_at,
    attempt_count,
    last_error
  ) values (
    p_actor_user_id,
    p_connection_id,
    p_company_id,
    coalesce(nullif(btrim(p_reason), ''), 'lifecycle_changed'),
    clock_timestamp(),
    clock_timestamp(),
    null,
    0,
    null
  )
  on conflict (actor_user_id, connection_id, company_id) do update
    set reason = excluded.reason,
        requested_at = excluded.requested_at,
        available_at = clock_timestamp(),
        processed_at = null,
        attempt_count = 0,
        last_error = null;
end;
$$;

revoke all on function public.enqueue_email_signature_notification_lifecycle_for_company(
  uuid,
  uuid,
  uuid,
  text
) from public, anon, authenticated, service_role;

create or replace function public.enqueue_email_signature_notification_lifecycle(
  p_actor_user_id uuid,
  p_connection_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_company_id uuid;
begin
  if p_actor_user_id is null or p_connection_id is null then
    return;
  end if;

  select actor.company_id
    into v_company_id
  from public.users actor
  join public.email_connections connection
    on connection.id = p_connection_id
   and connection.company_id = actor.company_id::text
  where actor.id = p_actor_user_id
    and actor.company_id is not null;

  if v_company_id is null then
    return;
  end if;

  perform public.enqueue_email_signature_notification_lifecycle_for_company(
    p_actor_user_id,
    p_connection_id,
    v_company_id,
    p_reason
  );
end;
$$;

revoke all on function public.enqueue_email_signature_notification_lifecycle(
  uuid,
  uuid,
  text
) from public, anon, authenticated, service_role;

create or replace function public.process_email_signature_notification_lifecycle(
  p_actor_user_id uuid,
  p_connection_id uuid,
  p_company_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_event public.email_signature_notification_lifecycle_outbox%rowtype;
  v_actor_company_id uuid;
  v_current_company_id uuid;
  v_dedupe_key text;
  v_updated_count integer := 0;
begin
  select event.*
    into v_event
  from public.email_signature_notification_lifecycle_outbox event
  where event.actor_user_id = p_actor_user_id
    and event.connection_id = p_connection_id
    and event.company_id = p_company_id
    and event.processed_at is null
    and event.available_at <= clock_timestamp()
  for update skip locked;

  if not found then
    return false;
  end if;

  select actor.company_id
    into v_actor_company_id
  from public.users actor
  where actor.id = p_actor_user_id;

  select company.id
    into v_current_company_id
  from public.email_connections connection
  join public.companies company
    on company.id::text = connection.company_id
  where connection.id = p_connection_id;

  if v_event.company_id is distinct from v_current_company_id
     or v_event.company_id is distinct from v_actor_company_id then
    -- A connection moved tenants after the prompt was created. Resolve only
    -- the exact old-tenant actor/connection row; never create cross-tenant work.
    v_dedupe_key := 'email-signature:'
      || p_connection_id::text || ':' || p_actor_user_id::text;
    update public.notifications notification
    set resolved_at = now(),
        resolved_by = null,
        resolution_reason = 'signature_access_lost',
        is_read = true
    where notification.user_id = p_actor_user_id::text
      and notification.company_id = v_event.company_id::text
      and notification.type = 'email_signature_required'
      and notification.dedupe_key = v_dedupe_key
      and notification.resolved_at is null;
  else
    perform public.sync_email_signature_notification_as_system(
      p_actor_user_id,
      p_connection_id
    );
  end if;

  update public.email_signature_notification_lifecycle_outbox event
  set processed_at = clock_timestamp(),
      attempt_count = event.attempt_count + 1,
      last_error = null
  where event.actor_user_id = p_actor_user_id
    and event.connection_id = p_connection_id
    and event.company_id = p_company_id
    and event.requested_at = v_event.requested_at;

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception 'signature notification lifecycle event changed during processing';
  end if;

  return true;
end;
$$;

revoke all on function public.process_email_signature_notification_lifecycle(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.process_email_signature_notification_lifecycle(
  uuid,
  uuid,
  uuid
) to service_role;

-- Preserve the reviewed activation prerequisite and any already-deployed
-- worker caller. The company-aware overload is authoritative; this bridge
-- selects the oldest due tenant event and cannot merge old/new tenant work.
create or replace function public.process_email_signature_notification_lifecycle(
  p_actor_user_id uuid,
  p_connection_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_company_id uuid;
begin
  select event.company_id
    into v_company_id
  from public.email_signature_notification_lifecycle_outbox event
  where event.actor_user_id = p_actor_user_id
    and event.connection_id = p_connection_id
    and event.processed_at is null
    and event.available_at <= clock_timestamp()
  order by event.available_at, event.requested_at, event.company_id
  limit 1;

  if v_company_id is null then
    return false;
  end if;

  return public.process_email_signature_notification_lifecycle(
    p_actor_user_id,
    p_connection_id,
    v_company_id
  );
end;
$$;

revoke all on function public.process_email_signature_notification_lifecycle(
  uuid,
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.process_email_signature_notification_lifecycle(
  uuid,
  uuid
) to service_role;

create or replace function public.fail_email_signature_notification_lifecycle(
  p_actor_user_id uuid,
  p_connection_id uuid,
  p_company_id uuid,
  p_expected_requested_at timestamptz,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_event public.email_signature_notification_lifecycle_outbox%rowtype;
  v_delay_seconds integer;
begin
  select event.*
    into v_event
  from public.email_signature_notification_lifecycle_outbox event
  where event.actor_user_id = p_actor_user_id
    and event.connection_id = p_connection_id
    and event.company_id = p_company_id
    and event.processed_at is null
  for update;

  if not found or v_event.requested_at is distinct from p_expected_requested_at then
    return false;
  end if;

  -- Retry after 30s, 1m, 2m, 4m ... capped at one hour. A newly
  -- coalesced lifecycle change resets this backoff immediately.
  v_delay_seconds := least(
    3600,
    30 * power(2::numeric, least(v_event.attempt_count, 7))::integer
  );

  update public.email_signature_notification_lifecycle_outbox event
  set attempt_count = event.attempt_count + 1,
      available_at = clock_timestamp() + make_interval(secs => v_delay_seconds),
      last_error = left(
        coalesce(nullif(btrim(p_error), ''), 'signature reconciliation failed'),
        2000
      )
  where event.actor_user_id = p_actor_user_id
    and event.connection_id = p_connection_id
    and event.company_id = p_company_id
    and event.requested_at = p_expected_requested_at
    and event.processed_at is null;

  return found;
end;
$$;

revoke all on function public.fail_email_signature_notification_lifecycle(
  uuid,
  uuid,
  uuid,
  timestamptz,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.fail_email_signature_notification_lifecycle(
  uuid,
  uuid,
  uuid,
  timestamptz,
  text
) to service_role;

create or replace function public.queue_email_signature_notification_history_for_connection(
  p_connection_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor_user_id uuid;
begin
  for v_actor_user_id in
    select distinct candidate.actor_user_id
    from (
      -- Candidate creation does not depend on historical prompt rows.
      select actor.id as actor_user_id
      from public.email_connections connection
      join public.users actor
        on actor.company_id::text = connection.company_id
      where connection.id = p_connection_id
        and actor.deleted_at is null
        and coalesce(actor.is_active, false)
        and (
          connection.type::text = 'company'
          or (
            connection.type::text = 'individual'
            and connection.user_id = actor.id::text
          )
        )
      union
      -- Historical recipients still need resolution after access/ownership loss.
      select actor.id
      from public.email_connections connection
      join public.users actor
        on actor.company_id::text = connection.company_id
      join public.notifications notification
        on notification.company_id = connection.company_id
       and notification.user_id = actor.id::text
       and notification.type = 'email_signature_required'
       and notification.dedupe_key = 'email-signature:'
            || connection.id::text || ':' || actor.id::text
      where connection.id = p_connection_id
    ) candidate
  loop
    perform public.enqueue_email_signature_notification_lifecycle(
      v_actor_user_id,
      p_connection_id,
      p_reason
    );
  end loop;
end;
$$;

revoke all on function public.queue_email_signature_notification_history_for_connection(
  uuid,
  text
) from public, anon, authenticated, service_role;

create or replace function public.queue_email_signature_notification_history_for_actor(
  p_actor_user_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_connection_id uuid;
begin
  for v_connection_id in
    select distinct candidate.connection_id
    from (
      -- Activation/permission gain can create a first prompt.
      select connection.id as connection_id
      from public.users actor
      join public.email_connections connection
        on connection.company_id = actor.company_id::text
      where actor.id = p_actor_user_id
        and (
          connection.type::text = 'company'
          or (
            connection.type::text = 'individual'
            and connection.user_id = p_actor_user_id::text
          )
        )
      union
      -- Preserve stale historical connection coverage for access loss.
      select connection.id
      from public.users actor
      join public.email_connections connection
        on connection.company_id = actor.company_id::text
      join public.notifications notification
        on notification.company_id = connection.company_id
       and notification.user_id = actor.id::text
       and notification.type = 'email_signature_required'
       and notification.dedupe_key = 'email-signature:'
            || connection.id::text || ':' || actor.id::text
      where actor.id = p_actor_user_id
    ) candidate
  loop
    perform public.enqueue_email_signature_notification_lifecycle(
      p_actor_user_id,
      v_connection_id,
      p_reason
    );
  end loop;
end;
$$;

revoke all on function public.queue_email_signature_notification_history_for_actor(
  uuid,
  text
) from public, anon, authenticated, service_role;

create or replace function public.queue_email_signature_assignment_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_connection_id uuid;
begin
  for v_connection_id in
    select distinct candidate.connection_id
    from (
      -- Every company mailbox can carry a new conversation for this lead.
      select connection.id as connection_id
      from public.email_connections connection
      where connection.company_id = new.company_id::text
        and connection.type::text = 'company'
      union
      -- Each assignee's own personal mailbox can also start a new conversation.
      select connection.id
      from public.email_connections connection
      where connection.company_id = new.company_id::text
        and connection.type::text = 'individual'
        and connection.user_id in (
          new.previous_assignee_id::text,
          new.new_assignee_id::text
        )
      union
      -- Preserve exact existing-thread coverage, including stale ownership.
      select thread.connection_id
      from public.email_threads thread
      where thread.opportunity_id = new.opportunity_id
        and thread.company_id = new.company_id
      union
      select link.connection_id
      from public.opportunity_email_threads link
      where link.opportunity_id = new.opportunity_id
        and link.connection_id is not null
    ) candidate
    where candidate.connection_id is not null
  loop
    perform public.enqueue_email_signature_notification_lifecycle(
      new.previous_assignee_id,
      v_connection_id,
      'opportunity_reassigned'
    );
    perform public.enqueue_email_signature_notification_lifecycle(
      new.new_assignee_id,
      v_connection_id,
      'opportunity_reassigned'
    );
  end loop;
  return new;
end;
$$;

create or replace function public.queue_email_signature_connection_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor_user_id uuid;
begin
  perform public.queue_email_signature_notification_history_for_connection(
    new.id,
    'connection_changed'
  );

  -- Exact current and previous individual owners are queued even before their
  -- first prompt. Company connection user_id remains deliberately ignored.
  if new.type::text = 'individual' then
    select actor.id
      into v_actor_user_id
    from public.users actor
    where actor.id::text = nullif(btrim(new.user_id), '')
      and actor.company_id::text = new.company_id;
    perform public.enqueue_email_signature_notification_lifecycle(
      v_actor_user_id,
      new.id,
      'connection_changed'
    );
  end if;

  if tg_op = 'UPDATE'
     and old.type::text = 'individual'
     and old.user_id is distinct from new.user_id then
    v_actor_user_id := null;
    select actor.id
      into v_actor_user_id
    from public.users actor
    where actor.id::text = nullif(btrim(old.user_id), '')
      and actor.company_id::text = old.company_id;
    perform public.enqueue_email_signature_notification_lifecycle(
      v_actor_user_id,
      old.id,
      'connection_owner_changed'
    );
  end if;

  if tg_op = 'UPDATE'
     and old.company_id is distinct from new.company_id then
    for v_actor_user_id in
      select distinct actor.id
      from public.users actor
      join public.notifications notification
        on notification.user_id = actor.id::text
       and notification.company_id = old.company_id
       and notification.type = 'email_signature_required'
       and notification.dedupe_key = 'email-signature:'
            || old.id::text || ':' || actor.id::text
    loop
      perform public.enqueue_email_signature_notification_lifecycle_for_company(
        v_actor_user_id,
        old.id,
        actor_company.id,
        'connection_company_changed'
      )
      from public.companies actor_company
      where actor_company.id::text = old.company_id;
    end loop;
  end if;

  return new;
end;
$$;

create or replace function public.queue_email_signature_actor_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_connection_id uuid;
  v_old_company_id uuid;
begin
  if old.company_id is distinct from new.company_id
     and old.company_id is not null then
    select company.id
      into v_old_company_id
    from public.companies company
    where company.id = old.company_id;

    -- An actor can move before this durable work is processed. Preserve exact
    -- old-tenant prompt cleanup independently from any new-tenant candidate.
    for v_connection_id in
      select distinct connection.id
      from public.email_connections connection
      join public.notifications notification
        on notification.company_id = old.company_id::text
       and notification.user_id = old.id::text
       and notification.type = 'email_signature_required'
       and notification.dedupe_key = 'email-signature:'
            || connection.id::text || ':' || old.id::text
      where connection.company_id = old.company_id::text
    loop
      perform public.enqueue_email_signature_notification_lifecycle_for_company(
        old.id,
        v_connection_id,
        v_old_company_id,
        'actor_company_changed'
      );
    end loop;
  end if;

  perform public.queue_email_signature_notification_history_for_actor(
    new.id,
    'actor_access_changed'
  );
  return new;
end;
$$;

create or replace function public.queue_email_signature_company_admin_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor_user_id uuid;
begin
  for v_actor_user_id in
    select distinct actor.id
    from public.users actor
    join (
      select nullif(btrim(old.account_holder_id), '') as actor_id
      union
      select nullif(btrim(new.account_holder_id), '')
      union
      select nullif(btrim(member_id), '')
      from unnest(coalesce(old.admin_ids, array[]::text[])) member_id
      union
      select nullif(btrim(member_id), '')
      from unnest(coalesce(new.admin_ids, array[]::text[])) member_id
    ) changed on changed.actor_id = actor.id::text
    where actor.company_id = new.id
  loop
    perform public.queue_email_signature_notification_history_for_actor(
      v_actor_user_id,
      'company_admin_changed'
    );
  end loop;
  return new;
end;
$$;

create or replace function public.queue_email_signature_opportunity_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_company_id uuid;
  v_connection_id uuid;
begin
  for v_company_id in
    select distinct company_id
    from (
      select case when tg_op <> 'INSERT' then old.company_id end as company_id
      union all
      select case when tg_op <> 'DELETE' then new.company_id end
    ) affected
    where company_id is not null
  loop
    for v_connection_id in
      select connection.id
      from public.email_connections connection
      where connection.company_id = v_company_id::text
    loop
      perform public.queue_email_signature_notification_history_for_connection(
        v_connection_id,
        'opportunity_access_changed'
      );
    end loop;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.queue_email_signature_user_permission_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.queue_email_signature_notification_history_for_actor(
      old.user_id,
      'permission_changed'
    );
  end if;
  if tg_op <> 'DELETE' then
    perform public.queue_email_signature_notification_history_for_actor(
      new.user_id,
      'permission_changed'
    );
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.queue_email_signature_user_role_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor_user_id uuid;
begin
  if tg_op <> 'INSERT' then
    select actor.id into v_actor_user_id
    from public.users actor
    where actor.id::text = old.user_id::text;
    perform public.queue_email_signature_notification_history_for_actor(
      v_actor_user_id,
      'role_changed'
    );
  end if;
  if tg_op <> 'DELETE' then
    v_actor_user_id := null;
    select actor.id into v_actor_user_id
    from public.users actor
    where actor.id::text = new.user_id::text;
    perform public.queue_email_signature_notification_history_for_actor(
      v_actor_user_id,
      'role_changed'
    );
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.queue_email_signature_role_permission_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor_user_id uuid;
  v_old_relevant boolean := false;
  v_new_relevant boolean := false;
begin
  if tg_op <> 'INSERT' then
    v_old_relevant := old.permission::text in (
      'inbox.send',
      'pipeline.view',
      'pipeline.edit',
      'pipeline.manage',
      'settings.integrations'
    );
  end if;
  if tg_op <> 'DELETE' then
    v_new_relevant := new.permission::text in (
      'inbox.send',
      'pipeline.view',
      'pipeline.edit',
      'pipeline.manage',
      'settings.integrations'
    );
  end if;
  if not v_old_relevant and not v_new_relevant then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  for v_actor_user_id in
    select distinct actor.id
    from public.users actor
    join public.user_roles user_role
      on user_role.user_id::text = actor.id::text
    where user_role.role_id = any(array_remove(array[
      case when tg_op <> 'INSERT' then old.role_id end,
      case when tg_op <> 'DELETE' then new.role_id end
    ]::uuid[], null::uuid))
  loop
    perform public.queue_email_signature_notification_history_for_actor(
      v_actor_user_id,
      'role_permission_changed'
    );
  end loop;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.queue_email_signature_record_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.queue_email_signature_notification_history_for_connection(
      old.connection_id,
      'signature_changed'
    );
    perform public.enqueue_email_signature_notification_lifecycle(
      old.scope_user_id,
      old.connection_id,
      'signature_changed'
    );
  end if;
  if tg_op <> 'DELETE' then
    perform public.queue_email_signature_notification_history_for_connection(
      new.connection_id,
      'signature_changed'
    );
    perform public.enqueue_email_signature_notification_lifecycle(
      new.scope_user_id,
      new.connection_id,
      'signature_changed'
    );
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.queue_email_signature_assignment_reconciliation()
  from public, anon, authenticated, service_role;
revoke all on function public.queue_email_signature_connection_reconciliation()
  from public, anon, authenticated, service_role;
revoke all on function public.queue_email_signature_actor_reconciliation()
  from public, anon, authenticated, service_role;
revoke all on function public.queue_email_signature_company_admin_reconciliation()
  from public, anon, authenticated, service_role;
revoke all on function public.queue_email_signature_opportunity_reconciliation()
  from public, anon, authenticated, service_role;
revoke all on function public.queue_email_signature_user_permission_reconciliation()
  from public, anon, authenticated, service_role;
revoke all on function public.queue_email_signature_user_role_reconciliation()
  from public, anon, authenticated, service_role;
revoke all on function public.queue_email_signature_role_permission_reconciliation()
  from public, anon, authenticated, service_role;
revoke all on function public.queue_email_signature_record_reconciliation()
  from public, anon, authenticated, service_role;

drop trigger if exists opportunity_assignment_signature_notification_queue
  on public.opportunity_assignment_events;
create trigger opportunity_assignment_signature_notification_queue
after insert on public.opportunity_assignment_events
for each row execute function public.queue_email_signature_assignment_reconciliation();

drop trigger if exists email_connection_signature_notification_queue
  on public.email_connections;
create trigger email_connection_signature_notification_queue
after update of status, sync_enabled, user_id, type, company_id, email on public.email_connections
for each row
when (
  old.status is distinct from new.status
  or old.sync_enabled is distinct from new.sync_enabled
  or old.user_id is distinct from new.user_id
  or old.type is distinct from new.type
  or old.company_id is distinct from new.company_id
  or old.email is distinct from new.email
)
execute function public.queue_email_signature_connection_reconciliation();

drop trigger if exists email_connection_signature_notification_insert_queue
  on public.email_connections;
create trigger email_connection_signature_notification_insert_queue
after insert on public.email_connections
for each row execute function public.queue_email_signature_connection_reconciliation();

drop trigger if exists email_signature_actor_notification_queue
  on public.users;
create trigger email_signature_actor_notification_queue
after update of is_active, deleted_at, is_company_admin, company_id on public.users
for each row
when (
  old.is_active is distinct from new.is_active
  or old.deleted_at is distinct from new.deleted_at
  or old.is_company_admin is distinct from new.is_company_admin
  or old.company_id is distinct from new.company_id
)
execute function public.queue_email_signature_actor_reconciliation();

drop trigger if exists email_signature_company_admin_notification_queue
  on public.companies;
create trigger email_signature_company_admin_notification_queue
after update of account_holder_id, admin_ids on public.companies
for each row
when (
  old.account_holder_id is distinct from new.account_holder_id
  or old.admin_ids is distinct from new.admin_ids
)
execute function public.queue_email_signature_company_admin_reconciliation();

drop trigger if exists email_signature_opportunity_insert_delete_notification_queue
  on public.opportunities;
create trigger email_signature_opportunity_insert_delete_notification_queue
after insert or delete on public.opportunities
for each row execute function public.queue_email_signature_opportunity_reconciliation();

drop trigger if exists email_signature_opportunity_update_notification_queue
  on public.opportunities;
create trigger email_signature_opportunity_update_notification_queue
after update of archived_at, deleted_at, company_id on public.opportunities
for each row
when (
  old.archived_at is distinct from new.archived_at
  or old.deleted_at is distinct from new.deleted_at
  or old.company_id is distinct from new.company_id
)
execute function public.queue_email_signature_opportunity_reconciliation();

drop trigger if exists email_signature_user_permission_notification_queue
  on public.user_permission_overrides;
create trigger email_signature_user_permission_notification_queue
after insert or update or delete on public.user_permission_overrides
for each row execute function public.queue_email_signature_user_permission_reconciliation();

drop trigger if exists email_signature_user_role_notification_queue
  on public.user_roles;
create trigger email_signature_user_role_notification_queue
after insert or update or delete on public.user_roles
for each row execute function public.queue_email_signature_user_role_reconciliation();

drop trigger if exists email_signature_role_permission_notification_queue
  on public.role_permissions;
create trigger email_signature_role_permission_notification_queue
after insert or update or delete on public.role_permissions
for each row execute function public.queue_email_signature_role_permission_reconciliation();

drop trigger if exists email_signature_record_insert_delete_notification_queue
  on public.email_signatures;
create trigger email_signature_record_insert_delete_notification_queue
after insert or delete on public.email_signatures
for each row execute function public.queue_email_signature_record_reconciliation();

drop trigger if exists email_signature_record_update_notification_queue
  on public.email_signatures;
create trigger email_signature_record_update_notification_queue
after update of active, content_html, content_text, source, provider_identity,
  scope_user_id, connection_id, company_id on public.email_signatures
for each row execute function public.queue_email_signature_record_reconciliation();

-- Seed every current mailbox/user candidate before the reserved 181000
-- Operator activation. The role-permission trigger above captures that later
-- grant. Existing unresolved prompts are included even after a tenant move so
-- the processor can resolve their exact historical company row.
insert into public.email_signature_notification_lifecycle_outbox (
  actor_user_id,
  connection_id,
  company_id,
  reason,
  requested_at,
  available_at,
  processed_at,
  attempt_count,
  last_error
)
select
  candidate.actor_user_id,
  candidate.connection_id,
  candidate.company_id,
  'migration_candidate_backfill',
  clock_timestamp(),
  clock_timestamp(),
  null,
  0,
  null
from (
  select
    actor.id as actor_user_id,
    connection.id as connection_id,
    actor.company_id as company_id
  from public.email_connections connection
  join public.users actor
    on actor.company_id::text = connection.company_id
  where actor.company_id is not null
    and actor.deleted_at is null
    and coalesce(actor.is_active, false)
    and (
      connection.type::text = 'company'
      or (
        connection.type::text = 'individual'
        and connection.user_id = actor.id::text
      )
    )
  union
  select
    actor.id,
    connection.id,
    company.id
  from public.notifications notification
  join public.users actor
    on actor.id::text = notification.user_id
  join public.companies company
    on company.id::text = notification.company_id
  join public.email_connections connection
    on notification.dedupe_key = 'email-signature:'
       || connection.id::text || ':' || actor.id::text
  where notification.type = 'email_signature_required'
    and notification.resolved_at is null
) candidate
on conflict (actor_user_id, connection_id, company_id) do update
  set reason = excluded.reason,
      requested_at = excluded.requested_at,
      available_at = clock_timestamp(),
      processed_at = null,
      attempt_count = 0,
      last_error = null;

-- Existing prompts must not point assigned operators at the integration-admin
-- section that they may be unable to open.
update public.notifications
set action_url = replace(
      action_url,
      '/settings?section=email',
      '/settings?section=profile'
    )
where type = 'email_signature_required'
  and action_url like '/settings?section=email%';

-- Remove unsafe legacy destinations before enforcing the invariant. Relative
-- app routes start with exactly one slash and contain neither backslashes nor
-- control characters. This rejects javascript:, external URLs, protocol-
-- relative URLs, whitespace smuggling, and Windows-style URL confusion.
update public.notifications
set action_url = null,
    action_label = null
where action_url is not null
  and not (
    action_url <> ''
    and action_url = btrim(action_url)
    and left(action_url, 1) = '/'
    and left(action_url, 2) <> '//'
    and position(E'\\' in action_url) = 0
    and action_url !~ '[[:cntrl:]]'
  );

alter table public.notifications
  drop constraint if exists notification_action_url_internal;

alter table public.notifications
  add constraint notification_action_url_internal
  check (
    action_url is null
    or (
      action_url <> ''
      and action_url = btrim(action_url)
      and left(action_url, 1) = '/'
      and left(action_url, 2) <> '//'
      and position(E'\\' in action_url) = 0
      and action_url !~ '[[:cntrl:]]'
    )
  );

-- Locked-out members cannot rely on a privileged application route, so this
-- single browser-callable RPC derives the actor, company, recipient set, copy,
-- persistence, and navigation entirely from current database state.
create or replace function public.request_lockout_admin_notification(
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor_id uuid;
  v_company_id uuid;
  v_actor_name text;
  v_company public.companies%rowtype;
  v_reason text;
  v_subscription_active boolean;
  v_permission text;
  v_title text;
  v_body text;
  v_action_url text;
  v_action_label text;
  v_inserted integer := 0;
begin
  v_actor_id := private.get_current_user_id();

  select
    u.company_id,
    coalesce(
      nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''),
      'A team member'
    )
  into v_company_id, v_actor_name
  from public.users u
  where u.id = v_actor_id
    and u.company_id is not null
    and u.deleted_at is null;

  if v_actor_id is null or v_company_id is null then
    raise exception 'notification actor is unavailable'
      using errcode = '42501';
  end if;

  select c.*
  into v_company
  from public.companies c
  where c.id = v_company_id
    and c.deleted_at is null;

  if v_company.id is null then
    raise exception 'notification company is unavailable'
      using errcode = '42501';
  end if;

  v_subscription_active :=
    lower(coalesce(v_company.subscription_status, '')) in ('active', 'grace')
    or (
      lower(coalesce(v_company.subscription_status, '')) in ('trial', 'trialing')
      and v_company.trial_end_date is not null
      and v_company.trial_end_date > now()
    );

  if not v_subscription_active then
    v_reason := 'subscription_expired';
  elsif not (
    v_actor_id::text = any(
      coalesce(v_company.seated_employee_ids, array[]::text[])
    )
    or v_actor_id::text = any(
      coalesce(v_company.admin_ids, array[]::text[])
    )
  ) then
    v_reason := 'unseated';
  else
    raise exception 'notification actor is not locked out'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'lockout-request:' || v_actor_id::text || ':' || v_reason,
    0
  ));

  if v_reason = 'subscription_expired' then
    v_permission := 'settings.billing';
    v_title := 'Reactivation Request';
    v_body := v_actor_name || ' is requesting subscription reactivation';
    v_action_url := '/settings?section=billing';
    v_action_label := 'Manage Subscription';
  else
    v_permission := 'team.assign_roles';
    v_title := 'Access Request';
    v_body := v_actor_name || ' is requesting seat restoration';
    v_action_url := '/settings?section=team';
    v_action_label := 'Manage Team';
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
  )
  select
    u.id::text,
    v_company_id::text,
    'role_needed',
    v_title,
    v_body,
    false,
    true,
    v_action_url,
    v_action_label,
    'lockout-request:' || v_actor_id::text || ':' || v_reason
  from public.users_with_permission(
    v_company_id,
    v_permission,
    'all'
  ) permitted(user_id)
  join public.users u on u.id = permitted.user_id
  where u.company_id = v_company_id
    and u.id <> v_actor_id
    and u.deleted_at is null
    and coalesce(u.is_active, false) = true
    and not exists (
      select 1
      from public.notifications recent
      where recent.user_id = u.id::text
        and recent.company_id = v_company_id::text
        and recent.type = 'role_needed'
        and recent.dedupe_key =
          'lockout-request:' || v_actor_id::text || ':' || v_reason
        and recent.created_at >= now() - interval '24 hours'
    )
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.request_lockout_admin_notification()
  from public, anon, authenticated, service_role;

grant execute on function public.request_lockout_admin_notification()
  to anon, authenticated;

commit;
