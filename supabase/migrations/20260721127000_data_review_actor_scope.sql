-- Bind every data-review read and mutation to the real OPS actor, company,
-- mailbox connection, provider thread, and canonical lead/inbox permissions.
-- Provider thread ids are mailbox-scoped and may legitimately collide across
-- connections. Application code receives no generic service-role write path.

begin;

do $guard$
begin
  if to_regprocedure('private.user_can_view_opportunity(uuid,uuid)') is null
     or to_regprocedure('private.user_can_edit_opportunity(uuid,uuid)') is null
     or to_regprocedure('private.user_can_view_opportunity_inbox(uuid,uuid,uuid)') is null
     or to_regprocedure('private.lock_lead_assignment_company(uuid)') is null
     or to_regprocedure('private.mint_email_review_child_reparent_tokens(uuid,uuid,text,uuid)') is null
     or to_regprocedure('public.execute_opportunity_merge_guarded(uuid,uuid,uuid,text,uuid,text,text,jsonb,jsonb,uuid,text)') is null then
    raise exception 'data_review_actor_scope_prerequisite_missing'
      using errcode = '55000';
  end if;
end;
$guard$;

create table private.email_thread_data_review_resolutions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null references public.email_connections(id) on delete cascade,
  provider_thread_id text not null,
  kind text not null check (kind in ('split', 'terminal_live')),
  resolution text not null check (resolution in ('link', 'quarantine')),
  target_opportunity_id uuid references public.opportunities(id),
  resolution_version bigint not null default 1
    check (resolution_version >= 1),
  actor_user_id uuid references public.users(id) on delete set null,
  subject text,
  activities_quarantined integer not null default 0
    check (activities_quarantined >= 0),
  activities_repointed integer not null default 0
    check (activities_repointed >= 0),
  email_threads_repointed integer not null default 0
    check (email_threads_repointed >= 0),
  opportunity_email_threads_repointed integer not null default 0
    check (opportunity_email_threads_repointed >= 0),
  created_at timestamptz not null default now(),
  unique (company_id, connection_id, provider_thread_id),
  check (
    (
      resolution = 'link'
      and target_opportunity_id is not null
      and activities_quarantined = 0
    )
    or (
      resolution = 'quarantine'
      and target_opportunity_id is null
      and activities_repointed = 0
      and email_threads_repointed = 0
      and opportunity_email_threads_repointed = 0
    )
  ),
  check (provider_thread_id = btrim(provider_thread_id)),
  check (provider_thread_id <> ''),
  check (left(provider_thread_id, length('legacy:')) <> 'legacy:')
);

revoke all on table private.email_thread_data_review_resolutions
  from public, anon, authenticated, service_role;

-- Resolution notifications are event receipts, not open incidents. Read or
-- resolved presentation state must never let a retry create a second receipt.
-- The versioned namespace is new in this migration, so no historical backfill
-- or destructive deduplication is required before enforcing this identity.
create unique index if not exists notifications_data_review_resolution_v1_unique
  on public.notifications (user_id, company_id, type, dedupe_key)
  where type = 'data_review_resolved'
    and left(dedupe_key, length('data_review_resolution:v1:')) =
      'data_review_resolution:v1:';

-- Serialize a quarantine decision with provider activity arrival for one exact
-- company/mailbox/thread identity. The mailbox id is part of the lock key so a
-- provider thread id reused by another connection remains fully independent.
create or replace function private.lock_email_thread_data_review(
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if p_company_id is null
     or p_connection_id is null
     or nullif(btrim(p_provider_thread_id), '') is null
     or p_provider_thread_id is distinct from btrim(p_provider_thread_id) then
    raise exception 'data_review_thread_lock_identity_required'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'data-review-email-thread:'
        || p_company_id::text || ':'
        || p_connection_id::text || ':'
        || p_provider_thread_id,
      211015
    )
  );
end;
$function$;

revoke all on function private.lock_email_thread_data_review(uuid, uuid, text)
  from public, anon, authenticated, service_role;

-- Derive the actionable queue kind from the exact mailbox projections. Caller
-- input is never classification authority. A split takes precedence over the
-- terminal/cache anomaly so one inconsistent identity has one deterministic
-- action at a time, matching the queue's conservative treatment.
create or replace function private.current_email_thread_data_review_kind(
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_activity_owner_count bigint := 0;
  v_valid_activity_owner_count bigint := 0;
  v_link_owner_count bigint := 0;
  v_link_owner_id uuid;
begin
  if p_company_id is null
     or p_connection_id is null
     or nullif(btrim(p_provider_thread_id), '') is null
     or p_provider_thread_id is distinct from btrim(p_provider_thread_id)
     or left(p_provider_thread_id, length('legacy:')) = 'legacy:' then
    return null;
  end if;

  select count(distinct activity.opportunity_id),
         count(distinct opportunity.id)
    into v_activity_owner_count, v_valid_activity_owner_count
    from public.activities activity
    left join public.opportunities opportunity
      on opportunity.id = activity.opportunity_id
     and opportunity.company_id = p_company_id
   where activity.company_id = p_company_id
     and activity.type::text = 'email'
     and activity.email_connection_id = p_connection_id
     and activity.email_thread_id = p_provider_thread_id
     and activity.opportunity_id is not null
     and activity.opportunity_id::text not like 'd2000000-0000-4000-d200-%';

  if v_activity_owner_count > 1
     and v_valid_activity_owner_count = v_activity_owner_count then
    return 'split';
  end if;

  select count(distinct link.opportunity_id),
         (array_agg(distinct link.opportunity_id))[1]
    into v_link_owner_count, v_link_owner_id
    from public.opportunity_email_threads link
   where link.connection_id = p_connection_id
     and link.thread_id = p_provider_thread_id;

  if v_link_owner_count = 1
     and exists (
       select 1
         from public.email_threads thread
        where thread.company_id = p_company_id
          and thread.connection_id = p_connection_id
          and thread.provider_thread_id = p_provider_thread_id
          and thread.opportunity_id is null
     )
     and exists (
       select 1
         from public.opportunities opportunity
        where opportunity.id = v_link_owner_id
          and opportunity.company_id = p_company_id
          and opportunity.stage in ('won', 'lost', 'discarded')
          and opportunity.archived_at is null
          and opportunity.deleted_at is null
     ) then
    return 'terminal_live';
  end if;

  return null;
end;
$function$;

revoke all on function private.current_email_thread_data_review_kind(
  uuid, uuid, text
) from public, anon, authenticated, service_role;

-- A resolved link retry is harmless only when the durable resolution matches
-- the requested kind/target and every exact projection is still aligned. This
-- preserves retry idempotence without turning an arbitrary ordinary thread into
-- a caller-asserted data-review item.
create or replace function private.email_thread_data_review_link_is_aligned(
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_target_opportunity_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_company_id is not null
    and p_connection_id is not null
    and p_target_opportunity_id is not null
    and nullif(btrim(p_provider_thread_id), '') is not null
    and exists (
      select 1
        from public.email_threads thread
       where thread.company_id = p_company_id
         and thread.connection_id = p_connection_id
         and thread.provider_thread_id = p_provider_thread_id
         and thread.opportunity_id = p_target_opportunity_id
    )
    and exists (
      select 1
        from public.opportunity_email_threads link
       where link.connection_id = p_connection_id
         and link.thread_id = p_provider_thread_id
         and link.opportunity_id = p_target_opportunity_id
    )
    and not exists (
      select 1
        from public.activities activity
       where activity.company_id = p_company_id
         and activity.type::text = 'email'
         and activity.email_connection_id = p_connection_id
         and activity.email_thread_id = p_provider_thread_id
         and activity.opportunity_id is distinct from p_target_opportunity_id
    );
$function$;

revoke all on function private.email_thread_data_review_link_is_aligned(
  uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;

-- Once an exact mailbox thread has a trusted quarantine resolution, every new
-- provider activity for that same identity converges in the inserting
-- transaction. Taking the same exact-thread lock as the RPC closes both sides
-- of the insert/quarantine race; cumulative metadata advances only when a row
-- is actually rewritten and rolls back with the insert on any later failure.
create or replace function private.apply_email_thread_data_review_quarantine()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_thread_id text;
begin
  if new.type::text is distinct from 'email'
     or new.company_id is null
     or new.email_connection_id is null
     or nullif(btrim(new.email_thread_id), '') is null
     or new.email_thread_id is distinct from btrim(new.email_thread_id)
     or left(new.email_thread_id, length('legacy:')) = 'legacy:' then
    return new;
  end if;

  v_provider_thread_id := new.email_thread_id;
  perform private.lock_email_thread_data_review(
    new.company_id,
    new.email_connection_id,
    v_provider_thread_id
  );

  if exists (
    select 1
      from private.email_thread_data_review_resolutions resolution
     where resolution.company_id = new.company_id
       and resolution.connection_id = new.email_connection_id
       and resolution.provider_thread_id = v_provider_thread_id
       and resolution.resolution = 'quarantine'
  ) then
    new.email_thread_id := 'legacy:' || v_provider_thread_id;
  end if;

  return new;
end;
$function$;

revoke all on function private.apply_email_thread_data_review_quarantine()
  from public, anon, authenticated, service_role;

drop trigger if exists activities_apply_data_review_quarantine_on_insert
  on public.activities;
create trigger activities_apply_data_review_quarantine_on_insert
before insert on public.activities
for each row execute function private.apply_email_thread_data_review_quarantine();

-- Count only rows that actually reached the table. A BEFORE INSERT trigger also
-- runs for an ON CONFLICT DO NOTHING candidate, so accounting there would
-- overstate the cumulative resolution metadata on idempotent provider retries.
create or replace function private.record_email_thread_data_review_quarantine()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_thread_id text;
begin
  if new.type::text is distinct from 'email'
     or new.company_id is null
     or new.email_connection_id is null
     or nullif(new.email_thread_id, '') is null
     or left(new.email_thread_id, length('legacy:')) <> 'legacy:' then
    return new;
  end if;

  v_provider_thread_id := substring(
    new.email_thread_id from length('legacy:') + 1
  );
  if nullif(v_provider_thread_id, '') is null
     or left(v_provider_thread_id, length('legacy:')) = 'legacy:' then
    return new;
  end if;

  perform private.lock_email_thread_data_review(
    new.company_id,
    new.email_connection_id,
    v_provider_thread_id
  );

  update private.email_thread_data_review_resolutions resolution
     set activities_quarantined = resolution.activities_quarantined + 1
   where resolution.company_id = new.company_id
     and resolution.connection_id = new.email_connection_id
     and new.email_thread_id = 'legacy:' || resolution.provider_thread_id
     and resolution.resolution = 'quarantine';

  return new;
end;
$function$;

revoke all on function private.record_email_thread_data_review_quarantine()
  from public, anon, authenticated, service_role;

drop trigger if exists activities_record_data_review_quarantine_after_insert
  on public.activities;
create trigger activities_record_data_review_quarantine_after_insert
after insert on public.activities
for each row execute function private.record_email_thread_data_review_quarantine();

-- Sync may safely claim one pre-identity activity by filling its previously-NULL
-- mailbox id. That supported UPDATE happens after the activity was inserted, so
-- the INSERT convergence trigger above cannot see it. Reconcile the claimed row
-- in the same transaction after the provider-identity guard has accepted the
-- claim. The nested update changes only email_thread_id, so this
-- email_connection_id-only trigger cannot recurse or double-count itself.
create or replace function private.converge_email_thread_data_review_quarantine_after_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_thread_id text;
  v_rewritten integer := 0;
begin
  if new.type::text is distinct from 'email'
     or new.company_id is null
     or old.email_connection_id is not null
     or new.email_connection_id is null
     or nullif(btrim(new.email_thread_id), '') is null
     or new.email_thread_id is distinct from btrim(new.email_thread_id)
     or left(new.email_thread_id, length('legacy:')) = 'legacy:' then
    return new;
  end if;

  v_provider_thread_id := new.email_thread_id;
  perform private.lock_email_thread_data_review(
    new.company_id,
    new.email_connection_id,
    v_provider_thread_id
  );

  if not exists (
    select 1
      from private.email_thread_data_review_resolutions resolution
     where resolution.company_id = new.company_id
       and resolution.connection_id = new.email_connection_id
       and resolution.provider_thread_id = v_provider_thread_id
       and resolution.resolution = 'quarantine'
  ) then
    return new;
  end if;

  update public.activities activity
     set email_thread_id = 'legacy:' || v_provider_thread_id
   where activity.id = new.id
     and activity.company_id = new.company_id
     and activity.type::text = 'email'
     and activity.email_connection_id = new.email_connection_id
     and activity.email_thread_id = v_provider_thread_id;
  get diagnostics v_rewritten = row_count;

  if v_rewritten > 0 then
    update private.email_thread_data_review_resolutions resolution
       set activities_quarantined =
             resolution.activities_quarantined + v_rewritten
     where resolution.company_id = new.company_id
       and resolution.connection_id = new.email_connection_id
       and resolution.provider_thread_id = v_provider_thread_id
       and resolution.resolution = 'quarantine';
  end if;

  return new;
end;
$function$;

revoke all on function private.converge_email_thread_data_review_quarantine_after_claim()
  from public, anon, authenticated, service_role;

drop trigger if exists activities_data_review_quarantine_after_claim
  on public.activities;
create trigger activities_data_review_quarantine_after_claim
after update of email_connection_id on public.activities
for each row
when (
  old.email_connection_id is null
  and new.email_connection_id is not null
)
execute function private.converge_email_thread_data_review_quarantine_after_claim();

-- The old helper included pre-identity activities whose mailbox was NULL. A
-- mailbox-scoped review action may mint child-reparent capability only for the
-- exact connection selected by the actor.
create or replace function private.mint_email_review_child_reparent_tokens(
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_target_opportunity_id uuid
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  insert into private.opportunity_child_reparent_tokens (
    transaction_id,
    backend_pid,
    table_name,
    row_id,
    old_opportunity_id,
    new_opportunity_id
  )
  select txid_current(),
         pg_backend_pid(),
         'activities',
         activity.id,
         activity.opportunity_id,
         p_target_opportunity_id
    from public.activities activity
   where activity.company_id = p_company_id
     and activity.type = 'email'
     and activity.email_connection_id = p_connection_id
     and activity.email_thread_id = p_provider_thread_id
     and activity.opportunity_id is distinct from p_target_opportunity_id
  on conflict (transaction_id, backend_pid, table_name, row_id)
  do update set old_opportunity_id = excluded.old_opportunity_id,
                new_opportunity_id = excluded.new_opportunity_id;

  insert into private.opportunity_child_reparent_tokens (
    transaction_id,
    backend_pid,
    table_name,
    row_id,
    old_opportunity_id,
    new_opportunity_id
  )
  select txid_current(),
         pg_backend_pid(),
         'email_threads',
         thread.id,
         thread.opportunity_id,
         p_target_opportunity_id
    from public.email_threads thread
   where thread.company_id = p_company_id
     and thread.connection_id = p_connection_id
     and thread.provider_thread_id = p_provider_thread_id
     and thread.opportunity_id is distinct from p_target_opportunity_id
  on conflict (transaction_id, backend_pid, table_name, row_id)
  do update set old_opportunity_id = excluded.old_opportunity_id,
                new_opportunity_id = excluded.new_opportunity_id;

  insert into private.opportunity_child_reparent_tokens (
    transaction_id,
    backend_pid,
    table_name,
    row_id,
    old_opportunity_id,
    new_opportunity_id
  )
  select txid_current(),
         pg_backend_pid(),
         'opportunity_email_threads',
         link.id,
         link.opportunity_id,
         p_target_opportunity_id
    from public.opportunity_email_threads link
   where link.connection_id = p_connection_id
     and link.thread_id = p_provider_thread_id
     and link.opportunity_id is distinct from p_target_opportunity_id
  on conflict (transaction_id, backend_pid, table_name, row_id)
  do update set old_opportunity_id = excluded.old_opportunity_id,
                new_opportunity_id = excluded.new_opportunity_id;
end;
$function$;

revoke all on function private.mint_email_review_child_reparent_tokens(
  uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;

-- One canonical authorization predicate for both queue filtering and locked
-- mutations. Every currently-linked lead must pass the action-specific
-- opportunity permission AND inbox permission for this exact connection.
create or replace function private.user_can_review_email_thread(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_action text
) returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_owner_ids uuid[] := '{}'::uuid[];
  v_authorized boolean := false;
  v_include_quarantined boolean := false;
begin
  if p_actor_user_id is null
     or p_company_id is null
     or p_connection_id is null
     or nullif(btrim(p_provider_thread_id), '') is null
     or p_provider_thread_id is distinct from btrim(p_provider_thread_id)
     or p_action not in ('view', 'edit') then
    return false;
  end if;

  if not exists (
    select 1
      from public.users actor
     where actor.id = p_actor_user_id
       and actor.company_id = p_company_id
       and actor.deleted_at is null
       and coalesce(actor.is_active, false)
  ) then
    return false;
  end if;

  if not exists (
    select 1
      from public.email_connections connection
      join public.companies company
        on company.id::text = connection.company_id
     where connection.id = p_connection_id
       and company.id = p_company_id
       and company.deleted_at is null
  ) then
    return false;
  end if;

  if not exists (
    select 1
      from public.email_threads thread
     where thread.company_id = p_company_id
       and thread.connection_id = p_connection_id
       and thread.provider_thread_id = p_provider_thread_id
  ) then
    return false;
  end if;

  select exists (
    select 1
      from private.email_thread_data_review_resolutions resolution
     where resolution.company_id = p_company_id
       and resolution.connection_id = p_connection_id
       and resolution.provider_thread_id = p_provider_thread_id
       and resolution.resolution = 'quarantine'
  ) into v_include_quarantined;

  select coalesce(array_agg(distinct owner.opportunity_id), '{}'::uuid[])
    into v_owner_ids
    from (
      select activity.opportunity_id
        from public.activities activity
       where activity.company_id = p_company_id
         and activity.type = 'email'
         and activity.email_connection_id = p_connection_id
         and (
           activity.email_thread_id = p_provider_thread_id
           or (
             v_include_quarantined
             and activity.email_thread_id = 'legacy:' || p_provider_thread_id
           )
         )
         and activity.opportunity_id is not null
      union
      select link.opportunity_id
        from public.opportunity_email_threads link
       where link.connection_id = p_connection_id
         and link.thread_id = p_provider_thread_id
      union
      select thread.opportunity_id
        from public.email_threads thread
       where thread.company_id = p_company_id
         and thread.connection_id = p_connection_id
         and thread.provider_thread_id = p_provider_thread_id
         and thread.opportunity_id is not null
    ) owner;

  if coalesce(cardinality(v_owner_ids), 0) = 0 then
    return false;
  end if;

  if exists (
    select 1
      from unnest(v_owner_ids) owner(opportunity_id)
      left join public.opportunities opportunity
        on opportunity.id = owner.opportunity_id
     where opportunity.id is null
        or opportunity.company_id is distinct from p_company_id
  ) then
    return false;
  end if;

  if p_action = 'view' then
    select bool_and(
      private.user_can_view_opportunity(
        p_actor_user_id,
        owner.opportunity_id
      )
      and private.user_can_view_opportunity_inbox(
        p_actor_user_id,
        owner.opportunity_id,
        p_connection_id
      )
    )
      into v_authorized
      from unnest(v_owner_ids) owner(opportunity_id);
  else
    select bool_and(
      private.user_can_edit_opportunity(
        p_actor_user_id,
        owner.opportunity_id
      )
      and private.user_can_view_opportunity_inbox(
        p_actor_user_id,
        owner.opportunity_id,
        p_connection_id
      )
    )
      into v_authorized
      from unnest(v_owner_ids) owner(opportunity_id);
  end if;

  return coalesce(v_authorized, false);
end;
$function$;

revoke all on function private.user_can_review_email_thread(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;

-- Service code can ask only whether its server-derived actor may see this
-- exact item. Terminal items already acknowledged as quarantined stay hidden.
create or replace function public.authorize_email_thread_data_review_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_kind text,
  p_action text
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actual_kind text;
  v_resolved_kind text;
  v_resolution text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_kind not in ('split', 'terminal_live') or p_action <> 'view' then
    raise exception 'unsupported data-review authorization action'
      using errcode = '22023';
  end if;

  v_actual_kind := private.current_email_thread_data_review_kind(
    p_company_id,
    p_connection_id,
    p_provider_thread_id
  );

  select resolution.kind, resolution.resolution
    into v_resolved_kind, v_resolution
    from private.email_thread_data_review_resolutions resolution
   where resolution.company_id = p_company_id
     and resolution.connection_id = p_connection_id
     and resolution.provider_thread_id = p_provider_thread_id;

  -- Quarantine is terminal for the exact mailbox thread. A prior link is only
  -- a fallback classification when no new live anomaly has appeared since.
  if v_resolution = 'quarantine' then
    v_actual_kind := v_resolved_kind;
  elsif v_actual_kind is null then
    v_actual_kind := v_resolved_kind;
  end if;

  if v_actual_kind is distinct from p_kind then
    return false;
  end if;
  if v_resolution = 'link'
     and private.current_email_thread_data_review_kind(
       p_company_id,
       p_connection_id,
       p_provider_thread_id
     ) is null then
    return false;
  end if;
  if v_resolution = 'quarantine' and p_kind = 'terminal_live' then
    return false;
  end if;

  return private.user_can_review_email_thread(
    p_actor_user_id,
    p_company_id,
    p_connection_id,
    p_provider_thread_id,
    'view'
  );
end;
$function$;

revoke all on function public.authorize_email_thread_data_review_as_system(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.authorize_email_thread_data_review_as_system(
  uuid, uuid, uuid, text, text, text
) to service_role;

-- The guarded merge implementation locks opportunities before their child
-- email projections. Data-review mutations lock those projections first so
-- they can prove exact mailbox ownership. Put both workflows behind the same
-- company lock before either order begins, eliminating the cross-order cycle
-- without weakening either workflow's existing row-level validation.
alter function public.execute_opportunity_merge_guarded(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text
) rename to execute_opportunity_merge_guarded_review_serialized_inner;

revoke all on function public.execute_opportunity_merge_guarded_review_serialized_inner(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text
) from public, anon, authenticated, service_role;

create or replace function public.execute_opportunity_merge_guarded(
  p_company_id uuid,
  p_winner_id uuid,
  p_loser_id uuid,
  p_merge_key text,
  p_review_id uuid default null,
  p_expected_winner_stage text default null,
  p_expected_loser_stage text default null,
  p_field_fill jsonb default '{}'::jsonb,
  p_confirmed_overrides jsonb default '{}'::jsonb,
  p_resolved_by uuid default null,
  p_run_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  perform private.lock_lead_assignment_company(p_company_id);

  return public.execute_opportunity_merge_guarded_review_serialized_inner(
    p_company_id,
    p_winner_id,
    p_loser_id,
    p_merge_key,
    p_review_id,
    p_expected_winner_stage,
    p_expected_loser_stage,
    p_field_fill,
    p_confirmed_overrides,
    p_resolved_by,
    p_run_id
  );
end;
$function$;

revoke all on function public.execute_opportunity_merge_guarded(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.execute_opportunity_merge_guarded(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text
) to service_role;

-- Remove the actorless transport. The implementation remains unreachable so
-- old migrations keep their dependency chain, but application service_role can
-- execute only the actor-aware overload below.
revoke all on function public.reassign_opportunity_email_thread_guarded(
  uuid, uuid, text, uuid, text
) from public, anon, authenticated, service_role;

create or replace function public.reassign_opportunity_email_thread_guarded(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_target_opportunity_id uuid,
  p_kind text default 'split'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_target_client_id uuid;
  v_target_title text;
  v_target_hidden boolean;
  v_subject text;
  v_link_owner_id uuid;
  v_activity_owner_ids uuid[] := '{}'::uuid[];
  v_all_owner_ids uuid[] := '{}'::uuid[];
  v_actual_kind text;
  v_existing_resolution private.email_thread_data_review_resolutions%rowtype;
  v_has_resolution boolean := false;
  v_already_resolved boolean := false;
  v_activities_repointed integer := 0;
  v_thread_rows_repointed integer := 0;
  v_link_rows_repointed integer := 0;
  v_resolution_version bigint := 1;
  v_previous_mode text := current_setting('ops.email_thread_reassignment_mode', true);
  v_previous_connection text := current_setting('ops.email_thread_reassignment_connection_id', true);
  v_previous_thread text := current_setting('ops.email_thread_reassignment_thread_id', true);
  v_previous_winner text := current_setting('ops.email_thread_reassignment_winner_id', true);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null
     or p_company_id is null
     or p_connection_id is null
     or p_target_opportunity_id is null
     or nullif(btrim(p_provider_thread_id), '') is null then
    raise exception 'actor, company, connection, provider thread, and target are required'
      using errcode = '22023';
  end if;
  if p_kind not in ('split', 'terminal_live') then
    raise exception 'unsupported data-review item kind' using errcode = '22023';
  end if;
  p_provider_thread_id := btrim(p_provider_thread_id);
  if left(p_provider_thread_id, length('legacy:')) = 'legacy:' then
    raise exception 'thread is already quarantined' using errcode = '23514';
  end if;

  -- Canonical lock order: company serialization, mailbox projections, then
  -- sorted opportunity rows. Assignment/permission changes use the same first
  -- lock and cannot invalidate the authorization snapshot during this write.
  perform private.lock_lead_assignment_company(p_company_id);
  perform private.lock_email_thread_data_review(
    p_company_id,
    p_connection_id,
    p_provider_thread_id
  );

  v_actual_kind := private.current_email_thread_data_review_kind(
    p_company_id,
    p_connection_id,
    p_provider_thread_id
  );
  select *
    into v_existing_resolution
    from private.email_thread_data_review_resolutions resolution
   where resolution.company_id = p_company_id
     and resolution.connection_id = p_connection_id
     and resolution.provider_thread_id = p_provider_thread_id;
  v_has_resolution := found;

  if v_actual_kind is null then
    v_already_resolved := v_has_resolution
      and v_existing_resolution.resolution = 'link'
      and v_existing_resolution.kind = p_kind
      and v_existing_resolution.target_opportunity_id = p_target_opportunity_id
      and private.email_thread_data_review_link_is_aligned(
        p_company_id,
        p_connection_id,
        p_provider_thread_id,
        p_target_opportunity_id
      );
    if not v_already_resolved then
      raise exception 'data_review_access_denied' using errcode = '42501';
    end if;
  elsif v_actual_kind is distinct from p_kind
        or (v_has_resolution and v_existing_resolution.resolution = 'quarantine') then
    raise exception 'data_review_access_denied' using errcode = '42501';
  end if;

  -- Collapse nonexistent, cross-company, cross-mailbox, and unauthorized
  -- selectors into the same denial before returning any row-shape detail.
  if not private.user_can_review_email_thread(
    p_actor_user_id,
    p_company_id,
    p_connection_id,
    p_provider_thread_id,
    'edit'
  ) then
    raise exception 'data_review_access_denied' using errcode = '42501';
  end if;

  select thread.subject
    into v_subject
    from public.email_threads thread
   where thread.company_id = p_company_id
     and thread.connection_id = p_connection_id
     and thread.provider_thread_id = p_provider_thread_id
   for update;
  if not found then
    raise exception 'exact mailbox thread not found' using errcode = 'P0002';
  end if;

  select link.opportunity_id
    into v_link_owner_id
    from public.opportunity_email_threads link
   where link.connection_id = p_connection_id
     and link.thread_id = p_provider_thread_id
   for update;

  perform 1
    from public.activities activity
   where activity.company_id = p_company_id
     and activity.type = 'email'
     and activity.email_connection_id = p_connection_id
     and activity.email_thread_id = p_provider_thread_id
   order by activity.id
   for update;

  select coalesce(array_agg(distinct activity.opportunity_id), '{}'::uuid[])
    into v_activity_owner_ids
    from public.activities activity
   where activity.company_id = p_company_id
     and activity.type = 'email'
     and activity.email_connection_id = p_connection_id
     and activity.email_thread_id = p_provider_thread_id
     and activity.opportunity_id is not null;

  select coalesce(array_agg(distinct owner.opportunity_id), '{}'::uuid[])
    into v_all_owner_ids
    from (
      select unnest(v_activity_owner_ids) as opportunity_id
      union
      select link.opportunity_id
        from public.opportunity_email_threads link
       where link.connection_id = p_connection_id
         and link.thread_id = p_provider_thread_id
      union
      select thread.opportunity_id
        from public.email_threads thread
       where thread.company_id = p_company_id
         and thread.connection_id = p_connection_id
         and thread.provider_thread_id = p_provider_thread_id
         and thread.opportunity_id is not null
    ) owner;

  if p_kind = 'split'
     and not (p_target_opportunity_id = any(v_activity_owner_ids)) then
    raise exception 'target opportunity is not a current owner of this mailbox thread'
      using errcode = '23514';
  end if;
  if p_kind = 'terminal_live'
     and v_link_owner_id is distinct from p_target_opportunity_id then
    raise exception 'target opportunity is not the canonical mailbox-thread owner'
      using errcode = '23514';
  end if;

  perform 1
    from public.opportunities opportunity
   where opportunity.id = any(v_all_owner_ids || array[p_target_opportunity_id])
   order by opportunity.id
   for update;

  -- Re-derive after both the exact projection rows and every involved
  -- opportunity row are locked. The first check avoids selector oracles; this
  -- second check is the final no-stale-classification write gate.
  v_actual_kind := private.current_email_thread_data_review_kind(
    p_company_id,
    p_connection_id,
    p_provider_thread_id
  );
  select *
    into v_existing_resolution
    from private.email_thread_data_review_resolutions resolution
   where resolution.company_id = p_company_id
     and resolution.connection_id = p_connection_id
     and resolution.provider_thread_id = p_provider_thread_id;
  v_has_resolution := found;
  v_already_resolved := false;

  if v_actual_kind is null then
    v_already_resolved := v_has_resolution
      and v_existing_resolution.resolution = 'link'
      and v_existing_resolution.kind = p_kind
      and v_existing_resolution.target_opportunity_id = p_target_opportunity_id
      and private.email_thread_data_review_link_is_aligned(
        p_company_id,
        p_connection_id,
        p_provider_thread_id,
        p_target_opportunity_id
      );
    if not v_already_resolved then
      raise exception 'data_review_access_denied' using errcode = '42501';
    end if;
  elsif v_actual_kind is distinct from p_kind
        or (v_has_resolution and v_existing_resolution.resolution = 'quarantine') then
    raise exception 'data_review_access_denied' using errcode = '42501';
  end if;

  select opportunity.client_id,
         opportunity.title,
         opportunity.archived_at is not null or opportunity.deleted_at is not null
    into v_target_client_id, v_target_title, v_target_hidden
    from public.opportunities opportunity
   where opportunity.id = p_target_opportunity_id
     and opportunity.company_id = p_company_id;
  if not found then
    raise exception 'target opportunity not found in company scope'
      using errcode = 'P0002';
  end if;
  if v_target_hidden then
    raise exception 'target opportunity is archived or deleted'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from unnest(v_all_owner_ids) owner(opportunity_id)
      left join public.opportunities opportunity
        on opportunity.id = owner.opportunity_id
     where opportunity.id is null
        or opportunity.company_id is distinct from p_company_id
        or opportunity.client_id is distinct from v_target_client_id
  ) then
    raise exception 'reassignment would cross company or client ownership'
      using errcode = '23514';
  end if;

  if not private.user_can_review_email_thread(
    p_actor_user_id,
    p_company_id,
    p_connection_id,
    p_provider_thread_id,
    'edit'
  ) then
    raise exception 'data_review_access_denied' using errcode = '42501';
  end if;

  if v_already_resolved then
    return jsonb_build_object(
      'provider_thread_id', p_provider_thread_id,
      'target_opportunity_id', p_target_opportunity_id,
      'target_title', v_target_title,
      'activities_repointed', v_existing_resolution.activities_repointed,
      'email_threads_repointed', v_existing_resolution.email_threads_repointed,
      'opportunity_email_threads_repointed',
        v_existing_resolution.opportunity_email_threads_repointed,
      'resolution_version', v_existing_resolution.resolution_version,
      'already_resolved', true
    );
  end if;

  perform private.mint_email_review_child_reparent_tokens(
    p_company_id,
    p_connection_id,
    p_provider_thread_id,
    p_target_opportunity_id
  );
  perform set_config('ops.email_thread_reassignment_mode', 'data_review', true);
  perform set_config(
    'ops.email_thread_reassignment_connection_id',
    p_connection_id::text,
    true
  );
  perform set_config(
    'ops.email_thread_reassignment_thread_id',
    p_provider_thread_id,
    true
  );
  perform set_config(
    'ops.email_thread_reassignment_winner_id',
    p_target_opportunity_id::text,
    true
  );

  if v_link_owner_id is null then
    insert into public.opportunity_email_threads (
      opportunity_id,
      thread_id,
      connection_id
    ) values (
      p_target_opportunity_id,
      p_provider_thread_id,
      p_connection_id
    );
    v_link_rows_repointed := 1;
  else
    update public.opportunity_email_threads link
       set opportunity_id = p_target_opportunity_id
     where link.connection_id = p_connection_id
       and link.thread_id = p_provider_thread_id
       and link.opportunity_id is distinct from p_target_opportunity_id;
    get diagnostics v_link_rows_repointed = row_count;
  end if;

  update public.email_threads thread
     set opportunity_id = p_target_opportunity_id,
         updated_at = now()
   where thread.company_id = p_company_id
     and thread.connection_id = p_connection_id
     and thread.provider_thread_id = p_provider_thread_id
     and thread.opportunity_id is distinct from p_target_opportunity_id;
  get diagnostics v_thread_rows_repointed = row_count;

  update public.activities activity
     set opportunity_id = p_target_opportunity_id
   where activity.company_id = p_company_id
     and activity.type = 'email'
     and activity.email_connection_id = p_connection_id
     and activity.email_thread_id = p_provider_thread_id
     and activity.opportunity_id is distinct from p_target_opportunity_id;
  get diagnostics v_activities_repointed = row_count;

  insert into private.email_thread_data_review_resolutions as resolution (
    company_id,
    connection_id,
    provider_thread_id,
    kind,
    resolution,
    target_opportunity_id,
    resolution_version,
    actor_user_id,
    subject,
    activities_quarantined,
    activities_repointed,
    email_threads_repointed,
    opportunity_email_threads_repointed
  ) values (
    p_company_id,
    p_connection_id,
    p_provider_thread_id,
    p_kind,
    'link',
    p_target_opportunity_id,
    1,
    p_actor_user_id,
    v_subject,
    0,
    v_activities_repointed,
    v_thread_rows_repointed,
    v_link_rows_repointed
  )
  on conflict (company_id, connection_id, provider_thread_id)
  do update set kind = excluded.kind,
                resolution = excluded.resolution,
                target_opportunity_id = excluded.target_opportunity_id,
                resolution_version = resolution.resolution_version + 1,
                actor_user_id = excluded.actor_user_id,
                subject = excluded.subject,
                activities_quarantined = 0,
                activities_repointed = excluded.activities_repointed,
                email_threads_repointed = excluded.email_threads_repointed,
                opportunity_email_threads_repointed =
                  excluded.opportunity_email_threads_repointed,
                created_at = now()
  returning resolution.resolution_version into v_resolution_version;

  delete from private.opportunity_child_reparent_tokens token
   where token.transaction_id = txid_current()
     and token.backend_pid = pg_backend_pid();
  perform set_config('ops.email_thread_reassignment_mode', coalesce(v_previous_mode, ''), true);
  perform set_config('ops.email_thread_reassignment_connection_id', coalesce(v_previous_connection, ''), true);
  perform set_config('ops.email_thread_reassignment_thread_id', coalesce(v_previous_thread, ''), true);
  perform set_config('ops.email_thread_reassignment_winner_id', coalesce(v_previous_winner, ''), true);

  return jsonb_build_object(
    'provider_thread_id', p_provider_thread_id,
    'target_opportunity_id', p_target_opportunity_id,
    'target_title', v_target_title,
    'activities_repointed', v_activities_repointed,
    'email_threads_repointed', v_thread_rows_repointed,
    'opportunity_email_threads_repointed', v_link_rows_repointed,
    'resolution_version', v_resolution_version,
    'already_resolved', false
  );
exception when others then
  delete from private.opportunity_child_reparent_tokens token
   where token.transaction_id = txid_current()
     and token.backend_pid = pg_backend_pid();
  perform set_config('ops.email_thread_reassignment_mode', coalesce(v_previous_mode, ''), true);
  perform set_config('ops.email_thread_reassignment_connection_id', coalesce(v_previous_connection, ''), true);
  perform set_config('ops.email_thread_reassignment_thread_id', coalesce(v_previous_thread, ''), true);
  perform set_config('ops.email_thread_reassignment_winner_id', coalesce(v_previous_winner, ''), true);
  raise;
end;
$function$;

revoke all on function public.reassign_opportunity_email_thread_guarded(
  uuid, uuid, uuid, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.reassign_opportunity_email_thread_guarded(
  uuid, uuid, uuid, text, uuid, text
) to service_role;

create or replace function public.quarantine_opportunity_email_thread_guarded(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_kind text default 'split'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_subject text;
  v_owner_ids uuid[] := '{}'::uuid[];
  v_actual_kind text;
  v_has_resolution boolean := false;
  v_activity_count integer := 0;
  v_activities_quarantined integer := 0;
  v_resolution_version bigint := 1;
  v_existing_resolution private.email_thread_data_review_resolutions%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null
     or p_company_id is null
     or p_connection_id is null
     or nullif(btrim(p_provider_thread_id), '') is null then
    raise exception 'actor, company, connection, and provider thread are required'
      using errcode = '22023';
  end if;
  if p_kind not in ('split', 'terminal_live') then
    raise exception 'unsupported data-review item kind' using errcode = '22023';
  end if;
  p_provider_thread_id := btrim(p_provider_thread_id);
  if left(p_provider_thread_id, length('legacy:')) = 'legacy:' then
    raise exception 'thread is already quarantined' using errcode = '23514';
  end if;

  perform private.lock_lead_assignment_company(p_company_id);
  perform private.lock_email_thread_data_review(
    p_company_id,
    p_connection_id,
    p_provider_thread_id
  );

  v_actual_kind := private.current_email_thread_data_review_kind(
    p_company_id,
    p_connection_id,
    p_provider_thread_id
  );
  select *
    into v_existing_resolution
    from private.email_thread_data_review_resolutions resolution
   where resolution.company_id = p_company_id
     and resolution.connection_id = p_connection_id
     and resolution.provider_thread_id = p_provider_thread_id;
  v_has_resolution := found;

  if v_has_resolution and v_existing_resolution.resolution = 'quarantine' then
    v_actual_kind := v_existing_resolution.kind;
  end if;
  if v_actual_kind is distinct from p_kind then
    raise exception 'data_review_access_denied' using errcode = '42501';
  end if;

  if not private.user_can_review_email_thread(
    p_actor_user_id,
    p_company_id,
    p_connection_id,
    p_provider_thread_id,
    'edit'
  ) then
    raise exception 'data_review_access_denied' using errcode = '42501';
  end if;

  select thread.subject
    into v_subject
    from public.email_threads thread
   where thread.company_id = p_company_id
     and thread.connection_id = p_connection_id
     and thread.provider_thread_id = p_provider_thread_id
   for update;
  if not found then
    raise exception 'exact mailbox thread not found' using errcode = 'P0002';
  end if;

  perform 1
    from public.opportunity_email_threads link
   where link.connection_id = p_connection_id
     and link.thread_id = p_provider_thread_id
   order by link.id
   for update;

  perform 1
    from public.activities activity
   where activity.company_id = p_company_id
     and activity.type = 'email'
     and activity.email_connection_id = p_connection_id
     and activity.email_thread_id = p_provider_thread_id
   order by activity.id
   for update;

  select coalesce(array_agg(distinct owner.opportunity_id), '{}'::uuid[])
    into v_owner_ids
    from (
      select activity.opportunity_id
        from public.activities activity
       where activity.company_id = p_company_id
         and activity.type = 'email'
         and activity.email_connection_id = p_connection_id
         and activity.email_thread_id = p_provider_thread_id
         and activity.opportunity_id is not null
      union
      select link.opportunity_id
        from public.opportunity_email_threads link
       where link.connection_id = p_connection_id
         and link.thread_id = p_provider_thread_id
      union
      select thread.opportunity_id
        from public.email_threads thread
       where thread.company_id = p_company_id
         and thread.connection_id = p_connection_id
         and thread.provider_thread_id = p_provider_thread_id
         and thread.opportunity_id is not null
    ) owner;

  perform 1
    from public.opportunities opportunity
   where opportunity.id = any(v_owner_ids)
   order by opportunity.id
   for update;

  -- Re-derive after the exact projection and opportunity rows are locked. A
  -- stored quarantine kind is the only accepted no-live-shape retry.
  v_actual_kind := private.current_email_thread_data_review_kind(
    p_company_id,
    p_connection_id,
    p_provider_thread_id
  );
  select *
    into v_existing_resolution
    from private.email_thread_data_review_resolutions resolution
   where resolution.company_id = p_company_id
     and resolution.connection_id = p_connection_id
     and resolution.provider_thread_id = p_provider_thread_id;
  v_has_resolution := found;
  if v_has_resolution and v_existing_resolution.resolution = 'quarantine' then
    v_actual_kind := v_existing_resolution.kind;
  end if;
  if v_actual_kind is distinct from p_kind then
    raise exception 'data_review_access_denied' using errcode = '42501';
  end if;

  if not private.user_can_review_email_thread(
    p_actor_user_id,
    p_company_id,
    p_connection_id,
    p_provider_thread_id,
    'edit'
  ) then
    raise exception 'data_review_access_denied' using errcode = '42501';
  end if;

  if v_has_resolution
     and v_existing_resolution.resolution = 'quarantine' then
    update public.activities activity
       set email_thread_id = 'legacy:' || p_provider_thread_id
     where activity.company_id = p_company_id
       and activity.type = 'email'
       and activity.email_connection_id = p_connection_id
       and activity.email_thread_id = p_provider_thread_id;
    get diagnostics v_activities_quarantined = row_count;

    update private.email_thread_data_review_resolutions resolution
       set activities_quarantined =
             resolution.activities_quarantined + v_activities_quarantined
     where resolution.id = v_existing_resolution.id;

    return jsonb_build_object(
      'provider_thread_id', p_provider_thread_id,
      'subject', v_existing_resolution.subject,
      'activities_quarantined', v_activities_quarantined,
      'resolution_version', v_existing_resolution.resolution_version,
      'already_resolved', true
    );
  end if;

  select count(*)::integer
    into v_activity_count
    from public.activities activity
   where activity.company_id = p_company_id
     and activity.type = 'email'
     and activity.email_connection_id = p_connection_id
     and activity.email_thread_id = p_provider_thread_id;
  if p_kind = 'split' and v_activity_count = 0 then
    raise exception 'no exact-mailbox activities found for split thread'
      using errcode = 'P0002';
  end if;

  update public.activities activity
     set email_thread_id = 'legacy:' || p_provider_thread_id
   where activity.company_id = p_company_id
     and activity.type = 'email'
     and activity.email_connection_id = p_connection_id
     and activity.email_thread_id = p_provider_thread_id;
  get diagnostics v_activities_quarantined = row_count;

  insert into private.email_thread_data_review_resolutions as resolution (
    company_id,
    connection_id,
    provider_thread_id,
    kind,
    resolution,
    target_opportunity_id,
    resolution_version,
    actor_user_id,
    subject,
    activities_quarantined
  ) values (
    p_company_id,
    p_connection_id,
    p_provider_thread_id,
    p_kind,
    'quarantine',
    null,
    1,
    p_actor_user_id,
    v_subject,
    v_activities_quarantined
  )
  on conflict (company_id, connection_id, provider_thread_id)
  do update set kind = excluded.kind,
                resolution = excluded.resolution,
                target_opportunity_id = null,
                resolution_version = resolution.resolution_version + 1,
                actor_user_id = excluded.actor_user_id,
                subject = excluded.subject,
                activities_quarantined = excluded.activities_quarantined,
                activities_repointed = 0,
                email_threads_repointed = 0,
                opportunity_email_threads_repointed = 0,
                created_at = now()
  returning resolution.resolution_version into v_resolution_version;

  return jsonb_build_object(
    'provider_thread_id', p_provider_thread_id,
    'subject', v_subject,
    'activities_quarantined', v_activities_quarantined,
    'resolution_version', v_resolution_version,
    'already_resolved', false
  );
end;
$function$;

revoke all on function public.quarantine_opportunity_email_thread_guarded(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.quarantine_opportunity_email_thread_guarded(
  uuid, uuid, uuid, text, text
) to service_role;

comment on function public.authorize_email_thread_data_review_as_system(
  uuid, uuid, uuid, text, text, text
) is
  'Service-only read bridge for server-derived OPS actor + company + exact mailbox thread authorization.';

comment on function public.reassign_opportunity_email_thread_guarded(
  uuid, uuid, uuid, text, uuid, text
) is
  'Atomically reassigns one exact mailbox thread after canonical actor opportunity/inbox authorization.';

comment on function public.quarantine_opportunity_email_thread_guarded(
  uuid, uuid, uuid, text, text
) is
  'Atomically quarantines one exact mailbox thread after canonical actor opportunity/inbox authorization.';

commit;
