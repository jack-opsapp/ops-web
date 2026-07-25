-- Durable cross-instance controls for database-heavy serverless workloads.
--
-- Each workload has its own expiring, monotonically fenced lease and
-- database-pressure circuit. Every acquisition also owns the reserved global
-- row so distinct heavy lanes cannot overlap on the production database. A crashed
-- function remains fenced until expiry; stale completion can never release a
-- successor's lease.

begin;

create table private.cron_workload_controls (
  workload_key text primary key
    check (
      workload_key = '__global_heavy__'
      or workload_key ~ '^[a-z0-9][a-z0-9:_-]{0,127}$'
    ),
  lease_owner_token uuid,
  lease_fence bigint not null default 0
    check (lease_fence >= 0),
  lease_acquired_at timestamptz,
  lease_expires_at timestamptz,
  consecutive_failures integer not null default 0
    check (consecutive_failures >= 0),
  circuit_open_until timestamptz,
  last_failure_at timestamptz,
  last_database_pressure_at timestamptz,
  last_succeeded_at timestamptz,
  cursor_value text,
  updated_at timestamptz not null default clock_timestamp(),
  constraint cron_workload_controls_lease_shape_check
    check (
      (
        lease_owner_token is null
        and lease_acquired_at is null
        and lease_expires_at is null
      )
      or (
        lease_owner_token is not null
        and lease_acquired_at is not null
        and lease_expires_at is not null
        and lease_acquired_at < lease_expires_at
      )
    )
);

comment on table private.cron_workload_controls is
  'Private crash-safe singleton leases and persistent database-pressure circuits for heavy serverless workloads.';
comment on column private.cron_workload_controls.lease_fence is
  'Monotonic token incremented on every acquisition; completion must match it exactly.';
comment on column private.cron_workload_controls.consecutive_failures is
  'Consecutive database-pressure failures used for bounded exponential circuit duration.';

alter table private.cron_workload_controls enable row level security;
revoke all on table private.cron_workload_controls
  from public, anon, authenticated, service_role;

create or replace function private.acquire_cron_workload_lease_internal(
  p_workload_key text,
  p_owner_token uuid,
  p_lease_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_global_key constant text := '__global_heavy__';
  v_acquired_at timestamptz := clock_timestamp();
  v_global private.cron_workload_controls%rowtype;
  v_lane private.cron_workload_controls%rowtype;
  v_global_fence bigint;
  v_lane_fence bigint;
  v_expires_at timestamptz;
begin
  if p_workload_key is null
    or p_workload_key <> btrim(p_workload_key)
    or p_workload_key = v_global_key
    or p_workload_key !~ '^[a-z0-9][a-z0-9:_-]{0,127}$'
  then
    raise exception 'invalid workload key'
      using errcode = '22023';
  end if;
  if p_owner_token is null then
    raise exception 'owner token is required'
      using errcode = '22023';
  end if;
  if p_lease_seconds is null
    or p_lease_seconds < 30
    or p_lease_seconds > 1200
  then
    raise exception 'lease seconds must be between 30 and 1200'
      using errcode = '22023';
  end if;

  insert into private.cron_workload_controls (workload_key)
  values (v_global_key), (p_workload_key)
  on conflict (workload_key) do nothing;

  -- One deterministic lock order for every lane prevents cross-lane
  -- deadlocks: reserved global row first, then the caller's lane row.
  --
  -- pg_cron holds this row lock for its command transaction. NOWAIT makes a
  -- concurrent PostgREST acquisition skip immediately instead of joining the
  -- database's work queue until statement_timeout.
  begin
    select control.*
      into strict v_global
      from private.cron_workload_controls as control
     where control.workload_key = v_global_key
     for update nowait;

    select control.*
      into strict v_lane
      from private.cron_workload_controls as control
     where control.workload_key = p_workload_key
     for update nowait;
  exception
    when lock_not_available then
      return jsonb_build_object(
        'acquired', false,
        'reason', 'lease_held'
      );
  end;

  if v_global.circuit_open_until > v_acquired_at
    or v_lane.circuit_open_until > v_acquired_at
  then
    return jsonb_build_object(
      'acquired', false,
      'reason', 'circuit_open'
    );
  end if;

  if v_global.lease_expires_at > v_acquired_at
    or v_lane.lease_expires_at > v_acquired_at
  then
    return jsonb_build_object(
      'acquired', false,
      'reason', 'lease_held'
    );
  end if;

  v_expires_at := v_acquired_at
    + make_interval(secs => p_lease_seconds);

  update private.cron_workload_controls
     set lease_owner_token = p_owner_token,
         lease_fence = lease_fence + 1,
         lease_acquired_at = v_acquired_at,
         lease_expires_at = v_expires_at,
         updated_at = v_acquired_at
   where workload_key = v_global_key
  returning lease_fence into v_global_fence;

  update private.cron_workload_controls
     set lease_owner_token = p_owner_token,
         lease_fence = lease_fence + 1,
         lease_acquired_at = v_acquired_at,
         lease_expires_at = v_expires_at,
         updated_at = v_acquired_at
   where workload_key = p_workload_key
  returning lease_fence into v_lane_fence;

  return jsonb_build_object(
    'acquired', true,
    'reason', 'acquired',
    'owner_token', p_owner_token,
    'fence_token', v_lane_fence,
    'global_fence_token', v_global_fence,
    'expires_at', v_expires_at
  );
end;
$function$;

create or replace function private.complete_cron_workload_lease_internal(
  p_workload_key text,
  p_owner_token uuid,
  p_fence_token bigint,
  p_global_fence_token bigint,
  p_succeeded boolean,
  p_database_pressure boolean,
  p_circuit_open_seconds integer default 300
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_global_key constant text := '__global_heavy__';
  v_completed_at timestamptz := clock_timestamp();
  v_global private.cron_workload_controls%rowtype;
  v_lane private.cron_workload_controls%rowtype;
  v_failure_count integer;
  v_global_failure_count integer;
  v_breaker_failure_count integer;
  v_exponential_seconds numeric;
  v_circuit_delay_seconds integer;
begin
  if p_workload_key is null
    or p_workload_key <> btrim(p_workload_key)
    or p_workload_key = v_global_key
    or p_workload_key !~ '^[a-z0-9][a-z0-9:_-]{0,127}$'
    or p_owner_token is null
    or p_fence_token is null
    or p_fence_token < 1
    or p_global_fence_token is null
    or p_global_fence_token < 1
    or p_succeeded is null
    or p_database_pressure is null
    or (p_succeeded and p_database_pressure)
    or p_circuit_open_seconds is null
    or p_circuit_open_seconds < 30
    or p_circuit_open_seconds > 900
  then
    raise exception 'invalid workload completion'
      using errcode = '22023';
  end if;

  select control.*
    into v_global
    from private.cron_workload_controls as control
   where control.workload_key = v_global_key
   for update;
  if not found then
    return false;
  end if;

  select control.*
    into v_lane
    from private.cron_workload_controls as control
   where control.workload_key = p_workload_key
   for update;
  if not found then
    return false;
  end if;

  if v_lane.lease_owner_token is distinct from p_owner_token
    or v_lane.lease_fence is distinct from p_fence_token
    or v_global.lease_owner_token is distinct from p_owner_token
    or v_global.lease_fence is distinct from p_global_fence_token
  then
    return false;
  end if;

  if p_succeeded then
    update private.cron_workload_controls
       set lease_owner_token = null,
           lease_acquired_at = null,
           lease_expires_at = null,
           consecutive_failures = 0,
           circuit_open_until = null,
           last_succeeded_at = v_completed_at,
           updated_at = v_completed_at
     where workload_key in (v_global_key, p_workload_key);
    return true;
  end if;

  if p_database_pressure then
    v_failure_count := v_lane.consecutive_failures + 1;
    v_global_failure_count := v_global.consecutive_failures + 1;
    v_breaker_failure_count := greatest(
      v_failure_count,
      v_global_failure_count
    );
    v_exponential_seconds := least(
      3600::numeric,
      greatest(30, p_circuit_open_seconds)::numeric
        * power(2::numeric, least(v_breaker_failure_count - 1, 8))
    );
    -- 75%-125% jitter avoids synchronized retries while preserving strict
    -- growth between early consecutive failures; cap after jitter.
    v_circuit_delay_seconds := least(
      3600,
      greatest(
        30,
        floor(v_exponential_seconds * (0.75 + random() * 0.5))::integer
      )
    );

    update private.cron_workload_controls
       set lease_owner_token = null,
           lease_acquired_at = null,
           lease_expires_at = null,
           consecutive_failures = case
             when workload_key = v_global_key
               then v_global_failure_count
             else v_failure_count
           end,
           circuit_open_until = v_completed_at + make_interval(
             secs => v_circuit_delay_seconds
           ),
           last_failure_at = v_completed_at,
           last_database_pressure_at = v_completed_at,
           updated_at = v_completed_at
     where workload_key in (v_global_key, p_workload_key);
  else
    -- A provider/business failure proves the database was reachable and
    -- breaks the database-pressure streak; it must not open the DB circuit.
    update private.cron_workload_controls
       set lease_owner_token = null,
           lease_acquired_at = null,
           lease_expires_at = null,
           consecutive_failures = 0,
           last_failure_at = case
             when workload_key = p_workload_key then v_completed_at
             else last_failure_at
           end,
           updated_at = v_completed_at
     where workload_key in (v_global_key, p_workload_key);
  end if;

  return true;
end;
$function$;

create or replace function private.renew_cron_workload_lease_internal(
  p_workload_key text,
  p_owner_token uuid,
  p_fence_token bigint,
  p_global_fence_token bigint,
  p_lease_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_global_key constant text := '__global_heavy__';
  v_renewed_at timestamptz := clock_timestamp();
  v_expires_at timestamptz;
  v_global private.cron_workload_controls%rowtype;
  v_lane private.cron_workload_controls%rowtype;
begin
  if p_workload_key is null
    or p_workload_key <> btrim(p_workload_key)
    or p_workload_key = v_global_key
    or p_workload_key !~ '^[a-z0-9][a-z0-9:_-]{0,127}$'
    or p_owner_token is null
    or p_fence_token is null
    or p_fence_token < 1
    or p_global_fence_token is null
    or p_global_fence_token < 1
    or p_lease_seconds is null
    or p_lease_seconds < 30
    or p_lease_seconds > 1200
  then
    raise exception 'invalid workload renewal'
      using errcode = '22023';
  end if;

  begin
    select control.*
      into strict v_global
      from private.cron_workload_controls as control
     where control.workload_key = v_global_key
     for update nowait;

    select control.*
      into strict v_lane
      from private.cron_workload_controls as control
     where control.workload_key = p_workload_key
     for update nowait;
  exception
    when no_data_found or lock_not_available then
      return jsonb_build_object(
        'renewed', false,
        'reason', 'lease_lost'
      );
  end;

  if v_lane.lease_owner_token is distinct from p_owner_token
    or v_lane.lease_fence is distinct from p_fence_token
    or v_lane.lease_expires_at <= v_renewed_at
    or v_global.lease_owner_token is distinct from p_owner_token
    or v_global.lease_fence is distinct from p_global_fence_token
    or v_global.lease_expires_at <= v_renewed_at
  then
    return jsonb_build_object(
      'renewed', false,
      'reason', 'lease_lost'
    );
  end if;

  v_expires_at := v_renewed_at
    + make_interval(secs => p_lease_seconds);

  update private.cron_workload_controls
     set lease_expires_at = v_expires_at,
         updated_at = v_renewed_at
   where workload_key in (v_global_key, p_workload_key);

  return jsonb_build_object(
    'renewed', true,
    'expires_at', v_expires_at
  );
end;
$function$;

create or replace function public.acquire_cron_workload_lease_as_system(
  p_workload_key text,
  p_owner_token uuid,
  p_lease_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
begin
  if coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  return private.acquire_cron_workload_lease_internal(
    p_workload_key,
    p_owner_token,
    p_lease_seconds
  );
end;
$function$;

create or replace function public.renew_cron_workload_lease_as_system(
  p_workload_key text,
  p_owner_token uuid,
  p_fence_token bigint,
  p_global_fence_token bigint,
  p_lease_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
begin
  if coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  return private.renew_cron_workload_lease_internal(
    p_workload_key,
    p_owner_token,
    p_fence_token,
    p_global_fence_token,
    p_lease_seconds
  );
end;
$function$;

create or replace function public.complete_cron_workload_lease_as_system(
  p_workload_key text,
  p_owner_token uuid,
  p_fence_token bigint,
  p_global_fence_token bigint,
  p_succeeded boolean,
  p_database_pressure boolean,
  p_circuit_open_seconds integer default 300
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
begin
  if coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  return private.complete_cron_workload_lease_internal(
    p_workload_key,
    p_owner_token,
    p_fence_token,
    p_global_fence_token,
    p_succeeded,
    p_database_pressure,
    p_circuit_open_seconds
  );
end;
$function$;

create or replace function public.read_cron_workload_cursor_as_system(
  p_workload_key text,
  p_owner_token uuid,
  p_fence_token bigint,
  p_global_fence_token bigint
) returns text
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_cursor text;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;
  if p_workload_key is null
    or p_workload_key <> btrim(p_workload_key)
    or p_workload_key = '__global_heavy__'
    or p_workload_key !~ '^[a-z0-9][a-z0-9:_-]{0,127}$'
    or p_owner_token is null
    or p_fence_token is null
    or p_fence_token < 1
    or p_global_fence_token is null
    or p_global_fence_token < 1
  then
    raise exception 'invalid workload cursor lease'
      using errcode = '22023';
  end if;

  select lane.cursor_value
    into v_cursor
    from private.cron_workload_controls as lane
    join private.cron_workload_controls as global_control
      on global_control.workload_key = '__global_heavy__'
   where lane.workload_key = p_workload_key
     and lane.lease_owner_token = p_owner_token
     and lane.lease_fence = p_fence_token
     and lane.lease_expires_at > clock_timestamp()
     and global_control.lease_owner_token = p_owner_token
     and global_control.lease_fence = p_global_fence_token
     and global_control.lease_expires_at > clock_timestamp();

  if not found then
    raise exception 'workload cursor lease fence was lost'
      using errcode = '55000';
  end if;

  return v_cursor;
end;
$function$;

create or replace function public.advance_cron_workload_cursor_as_system(
  p_workload_key text,
  p_owner_token uuid,
  p_fence_token bigint,
  p_global_fence_token bigint,
  p_expected_cursor text,
  p_next_cursor text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_updated_count integer;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;
  if p_workload_key is null
    or p_workload_key <> btrim(p_workload_key)
    or p_workload_key = '__global_heavy__'
    or p_workload_key !~ '^[a-z0-9][a-z0-9:_-]{0,127}$'
    or p_owner_token is null
    or p_fence_token is null
    or p_fence_token < 1
    or p_global_fence_token is null
    or p_global_fence_token < 1
    or length(coalesce(p_next_cursor, '')) > 512
  then
    raise exception 'invalid workload cursor'
      using errcode = '22023';
  end if;

  update private.cron_workload_controls
     set cursor_value = p_next_cursor,
         updated_at = clock_timestamp()
   where workload_key = p_workload_key
     and lease_owner_token = p_owner_token
     and lease_fence = p_fence_token
     and lease_expires_at > clock_timestamp()
     and cursor_value is not distinct from p_expected_cursor
     and exists (
       select 1
         from private.cron_workload_controls as global_control
        where global_control.workload_key = '__global_heavy__'
          and global_control.lease_owner_token = p_owner_token
          and global_control.lease_fence = p_global_fence_token
          and global_control.lease_expires_at > clock_timestamp()
     );

  get diagnostics v_updated_count = row_count;
  return v_updated_count = 1;
end;
$function$;

revoke all on function private.acquire_cron_workload_lease_internal(
  text,
  uuid,
  integer
) from public, anon, authenticated, service_role;

revoke all on function private.complete_cron_workload_lease_internal(
  text,
  uuid,
  bigint,
  bigint,
  boolean,
  boolean,
  integer
) from public, anon, authenticated, service_role;

revoke all on function private.renew_cron_workload_lease_internal(
  text,
  uuid,
  bigint,
  bigint,
  integer
) from public, anon, authenticated, service_role;

revoke all on function public.acquire_cron_workload_lease_as_system(
  text,
  uuid,
  integer
) from public, anon, authenticated, service_role;
grant execute on function public.acquire_cron_workload_lease_as_system(
  text,
  uuid,
  integer
) to service_role;

revoke all on function public.renew_cron_workload_lease_as_system(
  text,
  uuid,
  bigint,
  bigint,
  integer
) from public, anon, authenticated, service_role;
grant execute on function public.renew_cron_workload_lease_as_system(
  text,
  uuid,
  bigint,
  bigint,
  integer
) to service_role;

revoke all on function public.complete_cron_workload_lease_as_system(
  text,
  uuid,
  bigint,
  bigint,
  boolean,
  boolean,
  integer
) from public, anon, authenticated, service_role;
grant execute on function public.complete_cron_workload_lease_as_system(
  text,
  uuid,
  bigint,
  bigint,
  boolean,
  boolean,
  integer
) to service_role;

revoke all on function public.read_cron_workload_cursor_as_system(
  text,
  uuid,
  bigint,
  bigint
) from public, anon, authenticated, service_role;
grant execute on function public.read_cron_workload_cursor_as_system(
  text,
  uuid,
  bigint,
  bigint
) to service_role;

revoke all on function public.advance_cron_workload_cursor_as_system(
  text,
  uuid,
  bigint,
  bigint,
  text,
  text
) from public, anon, authenticated, service_role;
grant execute on function public.advance_cron_workload_cursor_as_system(
  text,
  uuid,
  bigint,
  bigint,
  text,
  text
) to service_role;

-- Keep PMF marker-four aggregation in Postgres. The previous serverless query
-- transferred every ad_spend_log row into Node on each threshold/digest run,
-- multiplying memory and I/O pressure as that table grew.
create or replace function public.pmf_marker_4_totals_as_system()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_spend_cents bigint;
  v_attributed_paid bigint;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  select greatest(0::bigint, coalesce(sum(spend.spend_cents), 0)::bigint)
    into v_spend_cents
    from public.ad_spend_log as spend;

  select count(*)
    into v_attributed_paid
    from public.trial_attributions as attribution
   where first_paid_at is not null;

  return jsonb_build_object(
    'spend_cents',
    v_spend_cents,
    'attributed_paid',
    v_attributed_paid
  );
end;
$function$;

revoke all on function public.pmf_marker_4_totals_as_system()
  from public, anon, authenticated, service_role;
grant execute on function public.pmf_marker_4_totals_as_system()
  to service_role;

create or replace function public.expire_agent_actions_batch_as_system(
  p_batch_size integer default 500,
  p_now timestamptz default clock_timestamp()
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_updated_count integer;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;
  if p_batch_size is null
    or p_batch_size < 1
    or p_batch_size > 500
    or p_now is null
  then
    raise exception 'invalid expiry batch'
      using errcode = '22023';
  end if;

  with candidates as materialized (
    select action.id
      from public.agent_actions as action
     where action.status = 'pending'
       and action.expires_at < p_now
     order by action.expires_at, action.id
     limit p_batch_size
     for update of action skip locked
  )
  update public.agent_actions as action
     set status = 'expired'
    from candidates
   where action.id = candidates.id;

  get diagnostics v_updated_count = row_count;
  return v_updated_count;
end;
$function$;

create or replace function public.expire_grace_period_companies_batch_as_system(
  p_cutoff timestamptz,
  p_batch_size integer default 500
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_updated_count integer;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;
  if p_batch_size is null
    or p_batch_size < 1
    or p_batch_size > 500
    or p_cutoff is null
  then
    raise exception 'invalid grace expiry batch'
      using errcode = '22023';
  end if;

  with candidates as materialized (
    select company.id
      from public.companies as company
     where company.subscription_status = 'grace'
       and company.seat_grace_start_date < p_cutoff
     order by company.seat_grace_start_date, company.id
     limit p_batch_size
     for update of company skip locked
  )
  update public.companies as company
     set subscription_status = 'expired',
         seat_grace_start_date = null
    from candidates
   where company.id = candidates.id;

  get diagnostics v_updated_count = row_count;
  return v_updated_count;
end;
$function$;

create or replace function public.cleanup_pmf_threshold_snapshots_batch_as_system(
  p_cutoff timestamptz,
  p_batch_size integer default 250
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_updated_count integer;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;
  if p_batch_size is null
    or p_batch_size < 1
    or p_batch_size > 250
    or p_cutoff is null
  then
    raise exception 'invalid snapshot cleanup batch'
      using errcode = '22023';
  end if;

  with candidates as materialized (
    select snapshot.id
      from public.pmf_threshold_snapshots as snapshot
     where snapshot.captured_at < p_cutoff
     order by snapshot.captured_at, snapshot.id
     limit p_batch_size
     for update of snapshot skip locked
  ),
  deleted as (
    delete from public.pmf_threshold_snapshots as snapshot
    using candidates
     where snapshot.id = candidates.id
    returning snapshot.id
  )
  select count(*)::integer
    into v_updated_count
    from deleted;

  return v_updated_count;
end;
$function$;

revoke all on function public.expire_agent_actions_batch_as_system(
  integer,
  timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.expire_agent_actions_batch_as_system(
  integer,
  timestamptz
) to service_role;

revoke all on function public.expire_grace_period_companies_batch_as_system(
  timestamptz,
  integer
) from public, anon, authenticated, service_role;
grant execute on function public.expire_grace_period_companies_batch_as_system(
  timestamptz,
  integer
) to service_role;

revoke all on function public.cleanup_pmf_threshold_snapshots_batch_as_system(
  timestamptz,
  integer
) from public, anon, authenticated, service_role;
grant execute on function public.cleanup_pmf_threshold_snapshots_batch_as_system(
  timestamptz,
  integer
) to service_role;

-- pg_cron jobs execute inside Postgres rather than through PostgREST, so they
-- cannot present a service-role JWT. Keep the lease mutation private and expose
-- only fixed, database-owned wrappers. Those wrappers share the same
-- global row and circuit as Vercel routes, preventing cross-scheduler overlap.
create or replace function private.is_cron_database_pressure_error(
  p_sqlstate text,
  p_message text
) returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $function$
  select
    coalesce(p_sqlstate, '') = '57014'
    or left(coalesce(p_sqlstate, ''), 2) in ('08', '53')
    or coalesce(p_sqlstate, '') in (
      '55P03',
      '57P01',
      '57P02',
      '57P03',
      '58030'
    )
    or lower(coalesce(p_message, '')) ~
      'statement timeout|remaining connection slots|out of memory|disk full|database (is )?unavailable|could not query the database';
$function$;

create or replace function private.run_scheduled_cron_workload_controlled(
  p_workload_key text,
  p_lease_seconds integer,
  p_command_name text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_owner_token uuid := gen_random_uuid();
  v_acquisition jsonb;
  v_completed boolean;
  v_sqlstate text;
  v_message text;
  v_failed boolean := false;
begin
  if p_command_name not in (
    'public.fire_due_task_reminders',
    'private.refresh_spec_board_snapshot',
    'private.capture_identity_linkage_metrics',
    'public.expense_envelope_sweep',
    'private.prune_cron_history_batch'
  ) then
    raise exception 'scheduled cron command is not allowlisted'
      using errcode = '42501';
  end if;

  v_acquisition := private.acquire_cron_workload_lease_internal(
    p_workload_key,
    v_owner_token,
    p_lease_seconds
  );
  if v_acquisition ->> 'acquired' <> 'true' then
    return v_acquisition || jsonb_build_object(
      'workload_key',
      p_workload_key
    );
  end if;

  -- Bound the database statement below the durable lease. The 30-second
  -- completion margin guarantees an overrun is cancelled and recorded before
  -- a successor can acquire the expired fence.
  perform set_config(
    'statement_timeout',
    (greatest(5, p_lease_seconds - 30) * 1000)::text,
    true
  );

  begin
    execute format('select %s()', p_command_name);
  exception
    when query_canceled then
      get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_message = message_text;
      v_failed := true;
    when others then
      get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_message = message_text;
      v_failed := true;
  end;

  if v_failed then
    v_completed := private.complete_cron_workload_lease_internal(
      p_workload_key,
      v_owner_token,
      (v_acquisition ->> 'fence_token')::bigint,
      (v_acquisition ->> 'global_fence_token')::bigint,
      false,
      private.is_cron_database_pressure_error(v_sqlstate, v_message),
      300
    );
    if not v_completed then
      raise exception 'scheduled cron workload lost its completion fence'
        using errcode = '55000';
    end if;

    -- Do not rethrow here: an exception escaping the pg_cron transaction
    -- would roll back the circuit update we just persisted. The failed
    -- command already ran inside this exception block's subtransaction, so
    -- its partial effects were rolled back before completion was recorded.
    raise warning
      'scheduled cron workload % failed [%]: %',
      p_workload_key,
      v_sqlstate,
      v_message;
    return jsonb_build_object(
      'acquired',
      true,
      'completed',
      false,
      'workload_key',
      p_workload_key,
      'error_sqlstate',
      v_sqlstate
    );
  end if;

  v_completed := private.complete_cron_workload_lease_internal(
    p_workload_key,
    v_owner_token,
    (v_acquisition ->> 'fence_token')::bigint,
    (v_acquisition ->> 'global_fence_token')::bigint,
    true,
    false,
    300
  );
  if not v_completed then
    raise exception 'scheduled cron workload lost its completion fence'
      using errcode = '55000';
  end if;

  return jsonb_build_object(
    'acquired',
    true,
    'completed',
    true,
    'workload_key',
    p_workload_key
  );
end;
$function$;

create or replace function private.run_fire_due_task_reminders_controlled()
returns jsonb
language sql
security definer
set search_path = pg_catalog, pg_temp
as $function$
  select private.run_scheduled_cron_workload_controlled(
    'db-task-reminders',
    300,
    'public.fire_due_task_reminders'
  );
$function$;

create or replace function private.run_spec_board_snapshot_controlled()
returns jsonb
language sql
security definer
set search_path = pg_catalog, pg_temp
as $function$
  select private.run_scheduled_cron_workload_controlled(
    'db-spec-board-snapshot',
    300,
    'private.refresh_spec_board_snapshot'
  );
$function$;

create or replace function private.run_identity_linkage_metrics_controlled()
returns jsonb
language sql
security definer
set search_path = pg_catalog, pg_temp
as $function$
  select private.run_scheduled_cron_workload_controlled(
    'db-identity-linkage',
    300,
    'private.capture_identity_linkage_metrics'
  );
$function$;

create or replace function private.run_expense_envelope_sweep_controlled()
returns jsonb
language sql
security definer
set search_path = pg_catalog, pg_temp
as $function$
  select private.run_scheduled_cron_workload_controlled(
    'db-expense-envelope-sweep',
    300,
    'public.expense_envelope_sweep'
  );
$function$;

-- Retain seven days of diagnostic cron history and remove only a small,
-- locked batch per day. This replaces the live-only job 17 command with a
-- source-controlled implementation that cannot issue an unbounded delete.
create or replace function private.prune_cron_history_batch()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_deleted_count integer;
begin
  with candidates as materialized (
    select history.runid
      from cron.job_run_details as history
     where history.end_time < clock_timestamp() - interval '7 days'
     order by history.runid
     limit 500
     for update of history skip locked
  ),
  deleted as (
    delete from cron.job_run_details as history
    using candidates
     where history.runid = candidates.runid
    returning history.runid
  )
  select count(*)::integer
    into v_deleted_count
    from deleted;

  return v_deleted_count;
end;
$function$;

create or replace function private.run_prune_cron_history_controlled()
returns jsonb
language sql
security definer
set search_path = pg_catalog, pg_temp
as $function$
  select private.run_scheduled_cron_workload_controlled(
    'db-prune-cron-history',
    300,
    'private.prune_cron_history_batch'
  );
$function$;

revoke all on function private.is_cron_database_pressure_error(
  text,
  text
) from public, anon, authenticated, service_role;
revoke all on function private.run_scheduled_cron_workload_controlled(
  text,
  integer,
  text
) from public, anon, authenticated, service_role;
revoke all on function private.run_fire_due_task_reminders_controlled()
  from public, anon, authenticated, service_role;
revoke all on function private.run_spec_board_snapshot_controlled()
  from public, anon, authenticated, service_role;
revoke all on function private.run_identity_linkage_metrics_controlled()
  from public, anon, authenticated, service_role;
revoke all on function private.run_expense_envelope_sweep_controlled()
  from public, anon, authenticated, service_role;
revoke all on function private.prune_cron_history_batch()
  from public, anon, authenticated, service_role;
revoke all on function private.run_prune_cron_history_controlled()
  from public, anon, authenticated, service_role;

-- Capture exact job ids before unscheduling. pg_cron retains run history after
-- a job is removed, so cleanup needs these durable ids without ever matching a
-- future job that happens to reuse the same name.
create table private.retired_cron_job_history_targets (
  job_id bigint primary key,
  job_name text not null,
  retired_at timestamptz not null default clock_timestamp()
);

alter table private.retired_cron_job_history_targets
  enable row level security;
revoke all on table private.retired_cron_job_history_targets
  from public, anon, authenticated, service_role;

insert into private.retired_cron_job_history_targets (
  job_id,
  job_name,
  retired_at
)
select
  scheduled_job.jobid,
  scheduled_job.jobname,
  clock_timestamp()
from cron.job as scheduled_job
where scheduled_job.jobname = 'toctou_race_hold_job'
on conflict (job_id) do nothing;

do $unschedule_all_toctou_race_hold_jobs$
declare
  retired_job record;
begin
  for retired_job in
    select target.job_id
      from private.retired_cron_job_history_targets as target
     where target.job_name = 'toctou_race_hold_job'
     order by target.job_id
  loop
    perform cron.unschedule(retired_job.job_id);
  end loop;

  if exists (
    select 1
      from cron.job as scheduled_job
     where scheduled_job.jobname = 'toctou_race_hold_job'
  ) then
    raise exception 'toctou_race_hold_job_unschedule_incomplete'
      using errcode = '55000';
  end if;
end;
$unschedule_all_toctou_race_hold_jobs$;

-- Source-create or overwrite every legitimate production database job. Named
-- cron.schedule is an upsert in pg_cron, so this also repairs a missing or
-- drifted live row without depending on a production-only job id. Each command
-- enters the same durable global lease used by the Vercel heavy routes.
do $restore_required_cron_jobs$
declare
  v_reminder_job_id bigint;
  v_snapshot_job_id bigint;
  v_identity_job_id bigint;
  v_expense_job_id bigint;
  v_prune_job_id bigint;
begin
  v_reminder_job_id := cron.schedule(
    'fire_due_task_reminders_every_5min',
    '*/5 * * * *',
    'select private.run_fire_due_task_reminders_controlled();'
  );
  perform cron.alter_job(
    job_id := v_reminder_job_id,
    active := true
  );

  v_snapshot_job_id := cron.schedule(
    'spec_board_snapshot_refresh',
    '1-59/10 * * * *',
    'select private.run_spec_board_snapshot_controlled();'
  );
  perform cron.alter_job(
    job_id := v_snapshot_job_id,
    active := true
  );

  v_identity_job_id := cron.schedule(
    'crit3-identity-linkage-daily',
    '14 8 * * *',
    'select private.run_identity_linkage_metrics_controlled();'
  );
  perform cron.alter_job(
    job_id := v_identity_job_id,
    active := true
  );

  v_expense_job_id := cron.schedule(
    'expense_envelope_sweep_daily',
    '24 6 * * *',
    'select private.run_expense_envelope_sweep_controlled();'
  );
  perform cron.alter_job(
    job_id := v_expense_job_id,
    active := true
  );

  v_prune_job_id := cron.schedule(
    'prune_cron_history',
    '24 5 * * *',
    'select private.run_prune_cron_history_controlled();'
  );
  perform cron.alter_job(
    job_id := v_prune_job_id,
    active := true
  );
end;
$restore_required_cron_jobs$;

-- Opt-in cleanup deliberately does not run during this migration. Production
-- is already I/O-bound; an operator can invoke small batches after recovery.
-- Each call locks and deletes at most p_batch_size exact retired-job rows.
create or replace function public.cleanup_retired_cron_job_history_as_system(
  p_batch_size integer default 250
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_deleted_count integer;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;
  if p_batch_size is null
    or p_batch_size < 1
    or p_batch_size > 500
  then
    raise exception 'batch size must be between 1 and 500'
      using errcode = '22023';
  end if;

  with candidates as materialized (
    select history.runid
      from cron.job_run_details as history
      join private.retired_cron_job_history_targets as target
        on target.job_id = history.jobid
     order by history.runid
     limit p_batch_size
     for update of history skip locked
  ),
  deleted as (
    delete from cron.job_run_details as history
    using candidates
     where history.runid = candidates.runid
    returning history.runid
  )
  select count(*)::integer
    into v_deleted_count
    from deleted;

  return v_deleted_count;
end;
$function$;

revoke all on function public.cleanup_retired_cron_job_history_as_system(
  integer
) from public, anon, authenticated, service_role;
grant execute on function public.cleanup_retired_cron_job_history_as_system(
  integer
) to service_role;

-- The incident diagnostic temporarily raised this to five minutes so live
-- pressure could be measured. Restore OPS's bounded request guard for every
-- new PostgREST connection once the durable workload controls exist.
alter role authenticator set statement_timeout = '8s';

commit;
