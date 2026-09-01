begin;

-- Forward-only Phase C generation reservation and recipient fence.
-- The base source-fence migration may already be recorded as applied.

-- The first source-fence migration created a private child with RESTRICT
-- references into account data. Attach every existing fence to the shared
-- tenant purge root before adding another private table, so account closure
-- removes both private ledgers before their public parents.
insert into public.agent_control_plane_tenant_roots (company_id)
select distinct fence.company_id
from private.phase_c_auto_send_source_fences fence
on conflict (company_id) do nothing;

alter table private.phase_c_auto_send_source_fences
  drop constraint phase_c_auto_send_source_fences_company_id_fkey,
  add constraint phase_c_auto_send_source_fences_company_id_fkey
    foreign key (company_id)
    references public.agent_control_plane_tenant_roots(company_id)
    on delete cascade;

-- Reserve an exact source/assignment before any model call can create a draft
-- history row. This is intentionally separate from the outbound queue: model
-- generation spans a network call and cannot hold a database transaction open.
create table private.phase_c_auto_send_generation_reservations (
  idempotency_key text primary key
    check (idempotency_key ~ '^[0-9a-f]{64}$'),
  arguments_hash text not null
    check (arguments_hash ~ '^[0-9a-f]{64}$'),
  company_id uuid not null
    references public.agent_control_plane_tenant_roots(company_id)
    on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  assignment_version bigint not null check (assignment_version >= 0),
  assignment_event_id uuid not null
    references public.opportunity_assignment_events(id) on delete restrict,
  connection_id uuid not null
    references public.email_connections(id) on delete restrict,
  opportunity_id uuid not null
    references public.opportunities(id) on delete restrict,
  source_email_thread_id uuid not null
    references public.email_threads(id) on delete restrict,
  provider_thread_id text not null
    check (nullif(btrim(provider_thread_id), '') is not null),
  in_reply_to text not null
    check (nullif(btrim(in_reply_to), '') is not null),
  generation_kind text not null
    check (generation_kind in ('conversation_reply', 'auto_follow_up')),
  source_activity_id uuid not null
    references public.activities(id) on delete restrict,
  source_message_id text not null
    check (nullif(btrim(source_message_id), '') is not null),
  follow_up_sequence integer,
  to_emails text[] not null check (cardinality(to_emails) > 0),
  cc_emails text[] not null default '{}'::text[],
  generation_token uuid not null,
  generation_lease_expires_at timestamptz,
  status text not null check (
    status in (
      'generating',
      'scheduled',
      'no_reply_warranted',
      'held_for_review',
      'failed'
    )
  ),
  reason text,
  pending_auto_send_id uuid unique
    references public.pending_auto_sends(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (
      generation_kind = 'conversation_reply'
      and follow_up_sequence is null
    )
    or (
      generation_kind = 'auto_follow_up'
      and follow_up_sequence between 1 and 100
    )
  ),
  check (
    (status = 'scheduled' and pending_auto_send_id is not null)
    or (status <> 'scheduled' and pending_auto_send_id is null)
  ),
  check (
    (status = 'generating' and generation_lease_expires_at is not null)
    or (status <> 'generating' and generation_lease_expires_at is null)
  )
);

create unique index phase_c_auto_send_generation_source_unique
  on private.phase_c_auto_send_generation_reservations (
    company_id,
    connection_id,
    opportunity_id,
    source_email_thread_id,
    provider_thread_id,
    generation_kind,
    source_activity_id,
    coalesce(follow_up_sequence, 0)
  );

revoke all on table private.phase_c_auto_send_generation_reservations
  from public, anon, authenticated, service_role;

create or replace function private.normalize_phase_c_email_header_address(
  p_value text
)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_email text;
begin
  v_email := lower(btrim(coalesce(
    substring(p_value from '<([^<>]+)>'),
    p_value
  )));
  if split_part(v_email, '@', 2) = 'gmail.con' then
    v_email := split_part(v_email, '@', 1) || '@gmail.com';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    return null;
  end if;
  return v_email;
end;
$function$;

revoke all on function private.normalize_phase_c_email_header_address(text)
  from public, anon, authenticated, service_role;

create or replace function private.phase_c_email_is_operator_identity(
  p_company_id uuid,
  p_connection_id uuid,
  p_email text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
  select exists (
    select 1
    from public.email_connections connection
    where connection.company_id = p_company_id::text
      and private.normalize_phase_c_email_header_address(connection.email)
        = private.normalize_phase_c_email_header_address(p_email)
  ) or exists (
    select 1
    from public.companies company
    where company.id = p_company_id
      and private.normalize_phase_c_email_header_address(company.email)
        = private.normalize_phase_c_email_header_address(p_email)
  ) or exists (
    select 1
    from public.users company_user
    where company_user.company_id = p_company_id
      and company_user.deleted_at is null
      and coalesce(company_user.is_active, false)
      and private.normalize_phase_c_email_header_address(company_user.email)
        = private.normalize_phase_c_email_header_address(p_email)
  ) or exists (
    select 1
    from public.user_email_aliases alias
    join public.users company_user
      on company_user.company_id = alias.company_id
     and company_user.id = alias.user_id
     and company_user.deleted_at is null
     and coalesce(company_user.is_active, false)
    where alias.company_id = p_company_id
      and alias.status = 'verified'
      and private.normalize_phase_c_email_header_address(alias.email)
        = private.normalize_phase_c_email_header_address(p_email)
  );
$function$;

revoke all on function private.phase_c_email_is_operator_identity(
  uuid, uuid, text
) from public, anon, authenticated, service_role;

create or replace function public.reserve_phase_c_auto_send_generation_as_system(
  p_idempotency_key text,
  p_arguments_hash text,
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
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  generation_reservation private.phase_c_auto_send_generation_reservations%rowtype;
  source_activity public.activities%rowtype;
  queued public.pending_auto_sends%rowtype;
  current_assignment_event_id uuid;
  latest_activity_id uuid;
  latest_message_id text;
  latest_timestamp_count bigint;
  expected_direction text;
  canonical_from text;
  canonical_to text[] := '{}'::text[];
  canonical_cc text[] := '{}'::text[];
  new_generation_token uuid := gen_random_uuid();
  new_generation_lease_expires_at timestamptz :=
    clock_timestamp() + make_interval(secs => 900);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_idempotency_key !~ '^[0-9a-f]{64}$'
     or p_arguments_hash !~ '^[0-9a-f]{64}$'
     or p_assignment_version < 0
     or p_assignment_event_id is null
     or nullif(btrim(coalesce(p_reply_provider_thread_id, '')), '') is null
     or p_generation_kind not in ('conversation_reply', 'auto_follow_up')
     or p_source_activity_id is null
     or nullif(btrim(coalesce(p_source_message_id, '')), '') is null
     or (
       p_generation_kind = 'conversation_reply'
       and p_follow_up_sequence is not null
     )
     or (
       p_generation_kind = 'auto_follow_up'
       and (
         p_follow_up_sequence is null
         or p_follow_up_sequence not between 1 and 100
       )
     ) then
    raise exception 'PHASE_C_AUTO_SEND_SOURCE_FENCE_INVALID'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'phase-c-auto-send-generation:v1:'
      || p_idempotency_key,
      0
    )
  );

  -- Match every queue transition's lock order and reject a stale or arbitrary
  -- actor before that actor can spend a model call under this identity.
  perform 1
  from public.opportunities opportunity
  where opportunity.id = p_opportunity_id
    and opportunity.company_id = p_company_id
    and opportunity.deleted_at is null
    and opportunity.assigned_to = p_actor_user_id
    and opportunity.assignment_version = p_assignment_version
  for update;
  if not found then
    raise exception 'PHASE_C_AUTO_SEND_ASSIGNMENT_STALE'
      using errcode = '42501';
  end if;

  select assignment_event.id
  into current_assignment_event_id
  from public.opportunity_assignment_events assignment_event
  where assignment_event.company_id = p_company_id
    and assignment_event.opportunity_id = p_opportunity_id
  order by assignment_event.created_at desc, assignment_event.id desc
  limit 1;
  if current_assignment_event_id is null
     or current_assignment_event_id is distinct from p_assignment_event_id then
    raise exception 'PHASE_C_AUTO_SEND_ASSIGNMENT_EVENT_STALE'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.companies company
    where company.id = p_company_id
      and company.deleted_at is null
      and private.email_company_subscription_active(
        company.subscription_status,
        company.subscription_plan,
        company.trial_end_date,
        clock_timestamp()
      )
  ) or not exists (
    select 1
    from public.users actor
    where actor.id = p_actor_user_id
      and actor.company_id = p_company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
  ) or not exists (
    select 1
    from public.email_connections connection
    where connection.id = p_connection_id
      and connection.company_id = p_company_id::text
      and connection.status = 'active'
      and coalesce(connection.sync_enabled, false)
      and coalesce(connection.agent_can_send_from, false)
      and coalesce(connection.auto_send_settings ->> 'enabled', 'false') = 'true'
      and (
        connection.type::text <> 'individual'
        or connection.user_id = p_actor_user_id::text
      )
  ) or not exists (
    select 1
    from public.admin_feature_overrides feature
    where feature.company_id = p_company_id::text
      and feature.feature_key = 'ai_auto_send'
      and feature.enabled
  ) or not private.user_can_send_opportunity_inbox(
    p_actor_user_id,
    p_opportunity_id,
    p_connection_id
  ) then
    raise exception 'PHASE_C_AUTO_SEND_AUTHORIZATION_REVOKED'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.email_threads thread
    where thread.id = p_source_email_thread_id
      and thread.company_id = p_company_id
      and thread.connection_id = p_connection_id
      and thread.provider_thread_id = p_reply_provider_thread_id
      and thread.opportunity_id = p_opportunity_id
  ) or not exists (
    select 1
    from public.opportunity_email_threads link
    where link.opportunity_id = p_opportunity_id
      and link.connection_id = p_connection_id
      and link.thread_id = p_reply_provider_thread_id
  ) then
    raise exception 'PHASE_C_AUTO_SEND_THREAD_CONFLICT'
      using errcode = '42501';
  end if;

  expected_direction := case p_generation_kind
    when 'conversation_reply' then 'inbound'
    else 'outbound'
  end;
  select activity.*
  into source_activity
  from public.activities activity
  where activity.id = p_source_activity_id
    and activity.company_id = p_company_id
    and activity.opportunity_id = p_opportunity_id
    and activity.email_connection_id = p_connection_id
    and activity.email_thread_id = p_reply_provider_thread_id
    and activity.email_message_id = p_source_message_id
    and activity.type = 'email'
    and activity.direction = expected_direction
  for share;
  if not found then
    raise exception 'PHASE_C_AUTO_SEND_SOURCE_ACTIVITY_INVALID'
      using errcode = '42501';
  end if;

  select activity.id,
         activity.email_message_id,
         count(*) over (partition by activity.created_at)
  into latest_activity_id,
       latest_message_id,
       latest_timestamp_count
  from public.activities activity
  where activity.company_id = p_company_id
    and activity.opportunity_id = p_opportunity_id
    and activity.email_connection_id = p_connection_id
    and activity.email_thread_id = p_reply_provider_thread_id
    and activity.type = 'email'
  order by activity.created_at desc, activity.id desc
  limit 1;
  if latest_timestamp_count > 1 then
    raise exception 'PHASE_C_AUTO_SEND_SOURCE_AMBIGUOUS'
      using errcode = '40001';
  end if;
  if latest_activity_id is distinct from p_source_activity_id
     or latest_message_id is distinct from p_source_message_id then
    raise exception 'PHASE_C_AUTO_SEND_SOURCE_STALE'
      using errcode = '40001';
  end if;

  if p_generation_kind = 'conversation_reply' then
    canonical_from := private.normalize_phase_c_email_header_address(
      source_activity.from_email
    );
    if canonical_from is null then
      raise exception 'PHASE_C_AUTO_SEND_SOURCE_RECIPIENT_INVALID'
        using errcode = '22023';
    end if;
    canonical_to := array[canonical_from];
    canonical_cc := '{}'::text[];
  else
    select coalesce(array_agg(normalized.email order by recipient.ordinality), '{}'::text[])
    into canonical_to
    from unnest(coalesce(source_activity.to_emails, '{}'::text[]))
      with ordinality recipient(raw_email, ordinality)
    cross join lateral (
      select private.normalize_phase_c_email_header_address(recipient.raw_email) as email
    ) normalized
    where normalized.email is not null;

    select coalesce(array_agg(normalized.email order by recipient.ordinality), '{}'::text[])
    into canonical_cc
    from unnest(coalesce(source_activity.cc_emails, '{}'::text[]))
      with ordinality recipient(raw_email, ordinality)
    cross join lateral (
      select private.normalize_phase_c_email_header_address(recipient.raw_email) as email
    ) normalized
    where normalized.email is not null;

    if cardinality(canonical_to) = 0
       or cardinality(canonical_to) <> cardinality(coalesce(source_activity.to_emails, '{}'::text[]))
       or cardinality(canonical_cc) <> cardinality(coalesce(source_activity.cc_emails, '{}'::text[])) then
      raise exception 'PHASE_C_AUTO_SEND_SOURCE_RECIPIENT_INVALID'
        using errcode = '22023';
    end if;
  end if;

  select coalesce(
    array_agg(recipient.email order by recipient.ordinality),
    '{}'::text[]
  )
  into canonical_to
  from unnest(canonical_to) with ordinality recipient(email, ordinality)
  where not private.phase_c_email_is_operator_identity(
    p_company_id,
    p_connection_id,
    recipient.email
  );

  select coalesce(
    array_agg(recipient.email order by recipient.ordinality),
    '{}'::text[]
  )
  into canonical_cc
  from unnest(canonical_cc) with ordinality recipient(email, ordinality)
  where not private.phase_c_email_is_operator_identity(
    p_company_id,
    p_connection_id,
    recipient.email
  );

  if cardinality(canonical_to) = 0 then
    raise exception 'PHASE_C_AUTO_SEND_SOURCE_RECIPIENT_INVALID'
      using errcode = '22023';
  end if;

  insert into public.agent_control_plane_tenant_roots (company_id)
  values (p_company_id)
  on conflict (company_id) do nothing;

  select reservation.*
  into generation_reservation
  from private.phase_c_auto_send_generation_reservations reservation
  where reservation.idempotency_key = p_idempotency_key
     or (
       reservation.company_id = p_company_id
       and reservation.connection_id = p_connection_id
       and reservation.opportunity_id = p_opportunity_id
       and reservation.source_email_thread_id = p_source_email_thread_id
       and reservation.provider_thread_id = p_reply_provider_thread_id
       and reservation.generation_kind = p_generation_kind
       and reservation.source_activity_id = p_source_activity_id
       and coalesce(reservation.follow_up_sequence, 0)
         = coalesce(p_follow_up_sequence, 0)
     )
  order by (reservation.idempotency_key = p_idempotency_key) desc
  limit 1
  for update;
  if found then
    if generation_reservation.idempotency_key = p_idempotency_key then
      if generation_reservation.arguments_hash is distinct from p_arguments_hash
         or generation_reservation.company_id is distinct from p_company_id
         or generation_reservation.actor_user_id is distinct from p_actor_user_id
         or generation_reservation.assignment_version is distinct from p_assignment_version
         or generation_reservation.assignment_event_id is distinct from p_assignment_event_id
         or generation_reservation.connection_id is distinct from p_connection_id
         or generation_reservation.opportunity_id is distinct from p_opportunity_id
         or generation_reservation.source_email_thread_id is distinct from p_source_email_thread_id
         or generation_reservation.provider_thread_id is distinct from p_reply_provider_thread_id
         or generation_reservation.in_reply_to is distinct from p_source_message_id
         or generation_reservation.generation_kind is distinct from p_generation_kind
         or generation_reservation.source_activity_id is distinct from p_source_activity_id
         or generation_reservation.source_message_id is distinct from p_source_message_id
         or generation_reservation.follow_up_sequence is distinct from p_follow_up_sequence
         or generation_reservation.to_emails is distinct from canonical_to
         or generation_reservation.cc_emails is distinct from canonical_cc then
        raise exception 'PHASE_C_AUTO_SEND_IDEMPOTENCY_CONFLICT'
          using errcode = '23505';
      end if;
    elsif generation_reservation.status in (
      'no_reply_warranted',
      'held_for_review'
    ) then
      return jsonb_build_object(
        'disposition', generation_reservation.status,
        'reason', generation_reservation.reason,
        'to_emails', generation_reservation.to_emails,
        'cc_emails', generation_reservation.cc_emails
      );
    elsif generation_reservation.status = 'scheduled' then
      select pending.*
      into queued
      from public.pending_auto_sends pending
      where pending.id = generation_reservation.pending_auto_send_id;
      if not found then
        raise exception 'PHASE_C_AUTO_SEND_IDEMPOTENCY_CONFLICT'
          using errcode = '23505';
      end if;
      return jsonb_build_object(
        'disposition', 'scheduled',
        'to_emails', generation_reservation.to_emails,
        'cc_emails', generation_reservation.cc_emails,
        'pending_auto_send', to_jsonb(queued)
      );
    elsif generation_reservation.status = 'generating'
      and generation_reservation.generation_lease_expires_at
        > clock_timestamp() then
      return jsonb_build_object(
        'disposition', 'in_progress',
        'to_emails', generation_reservation.to_emails,
        'cc_emails', generation_reservation.cc_emails
      );
    else
      update private.phase_c_auto_send_generation_reservations reservation
      set idempotency_key = p_idempotency_key,
          arguments_hash = p_arguments_hash,
          actor_user_id = p_actor_user_id,
          assignment_version = p_assignment_version,
          assignment_event_id = p_assignment_event_id,
          in_reply_to = p_source_message_id,
          source_message_id = p_source_message_id,
          to_emails = canonical_to,
          cc_emails = canonical_cc,
          status = 'generating',
          generation_token = new_generation_token,
          generation_lease_expires_at = new_generation_lease_expires_at,
          reason = null,
          updated_at = clock_timestamp()
      where reservation.idempotency_key = generation_reservation.idempotency_key
        and (
          reservation.status = 'failed'
          or (
            reservation.status = 'generating'
            and reservation.generation_lease_expires_at <= clock_timestamp()
          )
        )
      returning reservation.* into generation_reservation;
      if not found then
        raise exception 'PHASE_C_AUTO_SEND_IDEMPOTENCY_CONFLICT'
          using errcode = '23505';
      end if;
      return jsonb_build_object(
        'disposition', 'acquired',
        'generation_token', generation_reservation.generation_token,
        'to_emails', generation_reservation.to_emails,
        'cc_emails', generation_reservation.cc_emails
      );
    end if;

    if generation_reservation.status = 'failed' then
      update private.phase_c_auto_send_generation_reservations reservation
      set status = 'generating',
          generation_token = new_generation_token,
          generation_lease_expires_at = new_generation_lease_expires_at,
          reason = null,
          updated_at = clock_timestamp()
      where reservation.idempotency_key = p_idempotency_key
      returning reservation.* into generation_reservation;
    elsif generation_reservation.status = 'scheduled' then
      select pending.*
      into queued
      from public.pending_auto_sends pending
      where pending.id = generation_reservation.pending_auto_send_id;
      if not found then
        raise exception 'PHASE_C_AUTO_SEND_IDEMPOTENCY_CONFLICT'
          using errcode = '23505';
      end if;
      return jsonb_build_object(
        'disposition', 'scheduled',
        'to_emails', generation_reservation.to_emails,
        'cc_emails', generation_reservation.cc_emails,
        'pending_auto_send', to_jsonb(queued)
      );
    elsif generation_reservation.status = 'generating' then
      if generation_reservation.generation_lease_expires_at
        > clock_timestamp() then
        return jsonb_build_object(
          'disposition', 'in_progress',
          'to_emails', generation_reservation.to_emails,
          'cc_emails', generation_reservation.cc_emails
        );
      end if;
      update private.phase_c_auto_send_generation_reservations reservation
      set generation_token = new_generation_token,
          generation_lease_expires_at = new_generation_lease_expires_at,
          reason = null,
          updated_at = clock_timestamp()
      where reservation.idempotency_key = p_idempotency_key
        and reservation.status = 'generating'
        and reservation.generation_lease_expires_at <= clock_timestamp()
      returning reservation.* into generation_reservation;
      if not found then
        raise exception 'PHASE_C_AUTO_SEND_IDEMPOTENCY_CONFLICT'
          using errcode = '23505';
      end if;
    else
      return jsonb_build_object(
        'disposition', generation_reservation.status,
        'reason', generation_reservation.reason,
        'to_emails', generation_reservation.to_emails,
        'cc_emails', generation_reservation.cc_emails
      );
    end if;
  else
    insert into private.phase_c_auto_send_generation_reservations (
      idempotency_key,
      arguments_hash,
      company_id,
      actor_user_id,
      assignment_version,
      assignment_event_id,
      connection_id,
      opportunity_id,
      source_email_thread_id,
      provider_thread_id,
      in_reply_to,
      generation_kind,
      source_activity_id,
      source_message_id,
      follow_up_sequence,
      to_emails,
      cc_emails,
      generation_token,
      generation_lease_expires_at,
      status
    ) values (
      p_idempotency_key,
      p_arguments_hash,
      p_company_id,
      p_actor_user_id,
      p_assignment_version,
      p_assignment_event_id,
      p_connection_id,
      p_opportunity_id,
      p_source_email_thread_id,
      p_reply_provider_thread_id,
      p_source_message_id,
      p_generation_kind,
      p_source_activity_id,
      p_source_message_id,
      p_follow_up_sequence,
      canonical_to,
      canonical_cc,
      new_generation_token,
      new_generation_lease_expires_at,
      'generating'
    )
    returning * into generation_reservation;
  end if;

  return jsonb_build_object(
    'disposition', 'acquired',
    'generation_token', generation_reservation.generation_token,
    'to_emails', generation_reservation.to_emails,
    'cc_emails', generation_reservation.cc_emails
  );
end;
$function$;

revoke all on function public.reserve_phase_c_auto_send_generation_as_system(
  text, text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text, uuid,
  text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.reserve_phase_c_auto_send_generation_as_system(
  text, text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text, uuid,
  text, integer
) to service_role;

create or replace function public.resolve_phase_c_auto_send_generation_as_system(
  p_idempotency_key text,
  p_generation_token uuid,
  p_arguments_hash text,
  p_disposition text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_idempotency_key !~ '^[0-9a-f]{64}$'
     or p_arguments_hash !~ '^[0-9a-f]{64}$'
     or p_generation_token is null
     or p_disposition not in (
       'no_reply_warranted',
       'held_for_review',
       'failed'
     ) then
    raise exception 'PHASE_C_AUTO_SEND_GENERATION_RESOLUTION_INVALID'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'phase-c-auto-send-generation:v1:' || p_idempotency_key,
      0
    )
  );
  update private.phase_c_auto_send_generation_reservations reservation
  set status = p_disposition,
      generation_lease_expires_at = null,
      reason = nullif(btrim(coalesce(p_reason, '')), ''),
      updated_at = clock_timestamp()
  where reservation.idempotency_key = p_idempotency_key
    and reservation.arguments_hash = p_arguments_hash
    and reservation.generation_token = p_generation_token
    and reservation.status = 'generating';
  if not found then
    raise exception 'PHASE_C_AUTO_SEND_IDEMPOTENCY_CONFLICT'
      using errcode = '23505';
  end if;
  return true;
end;
$function$;

revoke all on function public.resolve_phase_c_auto_send_generation_as_system(
  text, uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.resolve_phase_c_auto_send_generation_as_system(
  text, uuid, text, text, text
) to service_role;


-- Retire the already-shipped 28-argument overload. Leaving it callable would
-- let service-role callers bypass the generation reservation contract.
revoke all on function public.schedule_phase_c_auto_send_fenced(
  text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text,
  text[], text[], text, text, text, text, text, uuid, text, text,
  uuid, text, text, timestamptz, text, uuid, text, integer
) from public, anon, authenticated, service_role;
drop function public.schedule_phase_c_auto_send_fenced(
  text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text,
  text[], text[], text, text, text, text, text, uuid, text, text,
  uuid, text, text, timestamptz, text, uuid, text, integer
);

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
  p_follow_up_sequence integer,
  p_generation_token uuid,
  p_arguments_hash text
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
  v_latest_timestamp_count bigint;
  v_expected_direction text;
  generation_reservation private.phase_c_auto_send_generation_reservations%rowtype;
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
     )
     or (
       p_generation_kind in ('conversation_reply', 'auto_follow_up')
       and (
         p_generation_token is null
         or p_arguments_hash !~ '^[0-9a-f]{64}$'
       )
     )
     or (
       p_generation_kind = 'operational_outbound'
       and (p_generation_token is not null or p_arguments_hash is not null)
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

  if p_generation_kind in ('conversation_reply', 'auto_follow_up') then
    select reservation.*
    into generation_reservation
    from private.phase_c_auto_send_generation_reservations reservation
    where reservation.idempotency_key = p_idempotency_key
    for update;
    if not found
       or generation_reservation.arguments_hash is distinct from p_arguments_hash
       or generation_reservation.company_id is distinct from p_company_id
       or generation_reservation.actor_user_id is distinct from p_actor_user_id
       or generation_reservation.assignment_version is distinct from p_assignment_version
       or generation_reservation.assignment_event_id is distinct from p_assignment_event_id
       or generation_reservation.connection_id is distinct from p_connection_id
       or generation_reservation.opportunity_id is distinct from p_opportunity_id
       or generation_reservation.source_email_thread_id is distinct from p_source_email_thread_id
       or generation_reservation.provider_thread_id is distinct from p_reply_provider_thread_id
       or generation_reservation.in_reply_to is distinct from p_in_reply_to
       or generation_reservation.generation_kind is distinct from p_generation_kind
       or generation_reservation.source_activity_id is distinct from p_source_activity_id
       or generation_reservation.source_message_id is distinct from p_source_message_id
       or generation_reservation.follow_up_sequence is distinct from p_follow_up_sequence
       or generation_reservation.generation_token is distinct from p_generation_token
       or generation_reservation.to_emails is distinct from p_to_emails
       or generation_reservation.cc_emails is distinct from coalesce(p_cc_emails, '{}'::text[]) then
      raise exception 'PHASE_C_AUTO_SEND_IDEMPOTENCY_CONFLICT'
        using errcode = '23505';
    end if;

    if generation_reservation.status = 'scheduled' then
      select queue.*
      into v_queue
      from public.pending_auto_sends queue
      where queue.id = generation_reservation.pending_auto_send_id
        and queue.company_id = p_company_id
        and queue.idempotency_key = p_idempotency_key;
      if not found then
        raise exception 'PHASE_C_AUTO_SEND_IDEMPOTENCY_CONFLICT'
          using errcode = '23505';
      end if;
      return v_queue;
    end if;
    if generation_reservation.status <> 'generating' then
      raise exception 'PHASE_C_AUTO_SEND_IDEMPOTENCY_TERMINAL'
        using errcode = '23505';
    end if;
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
    if p_generation_kind in ('conversation_reply', 'auto_follow_up') then
      update private.phase_c_auto_send_generation_reservations reservation
      set status = 'scheduled',
          generation_lease_expires_at = null,
          pending_auto_send_id = v_queue.id,
          updated_at = clock_timestamp()
      where reservation.idempotency_key = p_idempotency_key
        and reservation.arguments_hash = p_arguments_hash
        and reservation.generation_token = p_generation_token
        and reservation.status = 'generating';
      if not found then
        raise exception 'PHASE_C_AUTO_SEND_IDEMPOTENCY_CONFLICT'
          using errcode = '23505';
      end if;
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

    select activity.id,
           activity.email_message_id,
           count(*) over (partition by activity.created_at)
    into v_latest_activity_id,
         v_latest_message_id,
         v_latest_timestamp_count
    from public.activities activity
    where activity.company_id = p_company_id
      and activity.opportunity_id = p_opportunity_id
      and activity.email_connection_id = p_connection_id
      and activity.email_thread_id = p_reply_provider_thread_id
      and activity.type = 'email'
    order by activity.created_at desc, activity.id desc
    limit 1;
    if v_latest_timestamp_count > 1 then
      raise exception 'PHASE_C_AUTO_SEND_SOURCE_AMBIGUOUS'
        using errcode = '40001';
    end if;
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

  if p_generation_kind in ('conversation_reply', 'auto_follow_up') then
    update private.phase_c_auto_send_generation_reservations reservation
    set status = 'scheduled',
        generation_lease_expires_at = null,
        pending_auto_send_id = v_queue.id,
        updated_at = clock_timestamp()
    where reservation.idempotency_key = p_idempotency_key
      and reservation.arguments_hash = p_arguments_hash
      and reservation.generation_token = p_generation_token
      and reservation.status = 'generating';
    if not found then
      raise exception 'PHASE_C_AUTO_SEND_IDEMPOTENCY_CONFLICT'
        using errcode = '23505';
    end if;
  end if;

  return v_queue;
end;
$function$;

revoke all on function public.schedule_phase_c_auto_send_fenced(
  text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text,
  text[], text[], text, text, text, text, text, uuid, text, text,
  uuid, text, text, timestamptz, text, uuid, text, integer, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.schedule_phase_c_auto_send_fenced(
  text, uuid, uuid, bigint, uuid, uuid, uuid, uuid, text, text,
  text[], text[], text, text, text, text, text, uuid, text, text,
  uuid, text, text, timestamptz, text, uuid, text, integer, uuid, text
) to service_role;


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
  v_latest_timestamp_count bigint;
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
  elsif fence.generation_kind in ('conversation_reply', 'auto_follow_up')
    and exists (
      select 1
      from unnest(
        coalesce(queue.to_emails, '{}'::text[])
        || coalesce(queue.cc_emails, '{}'::text[])
      ) recipient(email)
      where private.phase_c_email_is_operator_identity(
        queue.company_id,
        queue.connection_id,
        recipient.email
      )
    ) then
    v_reason := 'PHASE_C_AUTO_SEND_SOURCE_RECIPIENT_INTERNAL';
  elsif fence.generation_kind = 'operational_outbound' then
    v_current := true;
    v_reason := null;
  else
    select activity.id,
           activity.email_message_id,
           activity.direction,
           count(*) over (partition by activity.created_at)
    into v_latest_activity_id,
         v_latest_message_id,
         v_latest_direction,
         v_latest_timestamp_count
    from public.activities activity
    where activity.company_id = queue.company_id
      and activity.opportunity_id = queue.opportunity_id
      and activity.email_connection_id = queue.connection_id
      and activity.email_thread_id = queue.thread_id
      and activity.type = 'email'
    order by activity.created_at desc, activity.id desc
    limit 1;

    v_current :=
      v_latest_timestamp_count = 1
      and v_latest_activity_id is not distinct from fence.source_activity_id
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
  v_latest_timestamp_count bigint;
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

  if fence.generation_kind in ('conversation_reply', 'auto_follow_up')
     and exists (
       select 1
       from unnest(
         coalesce(queue.to_emails, '{}'::text[])
         || coalesce(queue.cc_emails, '{}'::text[])
       ) recipient(email)
       where private.phase_c_email_is_operator_identity(
         queue.company_id,
         queue.connection_id,
         recipient.email
       )
     ) then
    raise exception 'EMAIL_SEND_PHASE_C_SOURCE_RECIPIENT_INTERNAL'
      using errcode = '42501';
  end if;

  if fence.generation_kind in ('conversation_reply', 'auto_follow_up') then
    select activity.id,
           activity.email_message_id,
           activity.direction,
           count(*) over (partition by activity.created_at)
    into v_latest_activity_id,
         v_latest_message_id,
         v_latest_direction,
         v_latest_timestamp_count
    from public.activities activity
    where activity.company_id = queue.company_id
      and activity.opportunity_id = queue.opportunity_id
      and activity.email_connection_id = queue.connection_id
      and activity.email_thread_id = queue.thread_id
      and activity.type = 'email'
    order by activity.created_at desc, activity.id desc
    limit 1;

    if v_latest_timestamp_count is distinct from 1
       or v_latest_activity_id is distinct from fence.source_activity_id
       or v_latest_message_id is distinct from fence.source_message_id
       or v_latest_direction is distinct from (case fence.generation_kind
         when 'conversation_reply' then 'inbound'
         else 'outbound'
       end) then
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


commit;
