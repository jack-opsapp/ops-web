-- PHASE C WORK CLAIM NULL-SAFETY — BEHAVIOR CONTRACT
--
-- ISOLATED DATABASE ONLY. This contract installs the previously deployed
-- implementation, applies the forward repair migration, and exercises the
-- claim function in PostgreSQL. Every schema and role change is rolled back.

begin;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end;
$roles$;

create schema auth;

-- Stands in for Supabase's request-scoped role resolver so the contract can
-- exercise both the service-role arm and the access-denied arm.
create function auth.role()
returns text
language sql
stable
as $function$
  select nullif(current_setting('contract.auth_role', true), '');
$function$;

-- Column-faithful copy of public.opportunity_phase_c_work. Foreign keys to
-- companies/opportunities/correspondence events are dropped: this contract
-- exercises the claim predicate, not referential integrity.
create table public.opportunity_phase_c_work (
  opportunity_id uuid not null primary key,
  company_id uuid not null,
  required_event_id uuid not null,
  required_event_at timestamptz not null,
  required_activity_id uuid,
  required_connection_id uuid not null,
  required_provider_thread_id text not null,
  summary_completed_event_id uuid,
  lifecycle_completed_event_id uuid,
  commercial_completed_event_id uuid,
  event_handoff_completed_event_id uuid,
  component_outcomes jsonb not null default '{}'::jsonb,
  component_errors jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_attempt_at timestamptz,
  last_error_code text,
  last_error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint opportunity_phase_c_work_lease_pair_check check (
    (lease_owner is null and lease_expires_at is null)
    or (lease_owner is not null and lease_expires_at is not null)
  ),
  constraint opportunity_phase_c_work_thread_nonblank_check check (
    btrim(required_provider_thread_id) <> ''
  )
);

-- This is the exact deployed implementation that never matched a fresh queue
-- row. The forward migration included below must replace it before the
-- assertions run.
create function public.claim_opportunity_phase_c_work(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 120
) returns table (
  company_id uuid,
  opportunity_id uuid,
  required_event_id uuid,
  required_event_at timestamptz,
  required_activity_id uuid,
  required_connection_id uuid,
  required_provider_thread_id text,
  attempt_count integer,
  component_outcomes jsonb,
  component_errors jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if nullif(btrim(p_worker_id), '') is null
    or p_limit < 1 or p_limit > 50
    or p_lease_seconds < 30 or p_lease_seconds > 900
  then
    raise exception 'invalid_phase_c_claim' using errcode = '22023';
  end if;

  return query
  with claimed as (
    select work.opportunity_id
      from public.opportunity_phase_c_work work
     where work.completed_at is null
       and work.next_attempt_at <= now()
       and (work.lease_expires_at is null or work.lease_expires_at <= now())
       and not (
         work.summary_completed_event_id = work.required_event_id
         and work.lifecycle_completed_event_id = work.required_event_id
         and work.commercial_completed_event_id = work.required_event_id
         and work.event_handoff_completed_event_id = work.required_event_id
       )
     order by work.next_attempt_at, work.required_event_at, work.opportunity_id
     for update skip locked
     limit p_limit
  ), leased as (
    update public.opportunity_phase_c_work work
       set lease_owner = btrim(p_worker_id),
           lease_expires_at = now() + make_interval(secs => p_lease_seconds),
           attempt_count = work.attempt_count + 1,
           last_attempt_at = now(),
           updated_at = now()
      from claimed
     where work.opportunity_id = claimed.opportunity_id
    returning work.*
  )
  select leased.company_id,
         leased.opportunity_id,
         leased.required_event_id,
         leased.required_event_at,
         leased.required_activity_id,
         leased.required_connection_id,
         leased.required_provider_thread_id,
         leased.attempt_count,
         leased.component_outcomes,
         leased.component_errors
    from leased
   order by leased.required_event_at, leased.opportunity_id;
end;
$function$;

revoke all on function public.claim_opportunity_phase_c_work(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_opportunity_phase_c_work(text, integer, integer)
  to service_role;

-- Every row is due and unleased. Only the component markers differ, which is
-- exactly what the repaired predicate must discriminate on.
insert into public.opportunity_phase_c_work (
  opportunity_id,
  company_id,
  required_event_id,
  required_event_at,
  required_connection_id,
  required_provider_thread_id,
  summary_completed_event_id,
  lifecycle_completed_event_id,
  commercial_completed_event_id,
  event_handoff_completed_event_id,
  next_attempt_at,
  completed_at,
  lease_owner,
  lease_expires_at
)
values
  -- FRESH: the production shape. All four markers NULL, so the deployed
  -- predicate evaluated UNKNOWN and skipped the row forever.
  (
    'd26b3a98-0000-4000-8000-000000000001',
    'd26b3a98-0000-4000-8000-000000000010',
    'd26b3a98-0000-4000-8000-000000000100',
    '2026-08-21 10:00:00+00',
    'd26b3a98-0000-4000-8000-000000000030',
    'provider-thread-fresh',
    null,
    null,
    null,
    null,
    '2026-08-21 10:00:00+00',
    null,
    null,
    null
  ),
  -- PARTIAL: one component done against the required event, three outstanding.
  (
    'd26b3a98-0000-4000-8000-000000000002',
    'd26b3a98-0000-4000-8000-000000000010',
    'd26b3a98-0000-4000-8000-000000000101',
    '2026-08-21 11:00:00+00',
    'd26b3a98-0000-4000-8000-000000000030',
    'provider-thread-partial',
    'd26b3a98-0000-4000-8000-000000000101',
    null,
    null,
    null,
    '2026-08-21 11:00:00+00',
    null,
    null,
    null
  ),
  -- FULLY COMPLETED: all four markers equal the required event. Must stay
  -- excluded — this is the case the original predicate existed to reject.
  (
    'd26b3a98-0000-4000-8000-000000000003',
    'd26b3a98-0000-4000-8000-000000000010',
    'd26b3a98-0000-4000-8000-000000000102',
    '2026-08-21 12:00:00+00',
    'd26b3a98-0000-4000-8000-000000000030',
    'provider-thread-complete',
    'd26b3a98-0000-4000-8000-000000000102',
    'd26b3a98-0000-4000-8000-000000000102',
    'd26b3a98-0000-4000-8000-000000000102',
    'd26b3a98-0000-4000-8000-000000000102',
    '2026-08-21 12:00:00+00',
    null,
    null,
    null
  ),
  -- TERMINAL: completed_at set. Excluded regardless of markers.
  (
    'd26b3a98-0000-4000-8000-000000000004',
    'd26b3a98-0000-4000-8000-000000000010',
    'd26b3a98-0000-4000-8000-000000000103',
    '2026-08-21 13:00:00+00',
    'd26b3a98-0000-4000-8000-000000000030',
    'provider-thread-terminal',
    null,
    null,
    null,
    null,
    '2026-08-21 13:00:00+00',
    '2026-08-21 13:05:00+00',
    null,
    null
  ),
  -- LEASED: another worker holds a live lease. Excluded until it expires.
  (
    'd26b3a98-0000-4000-8000-000000000005',
    'd26b3a98-0000-4000-8000-000000000010',
    'd26b3a98-0000-4000-8000-000000000104',
    '2026-08-21 14:00:00+00',
    'd26b3a98-0000-4000-8000-000000000030',
    'provider-thread-leased',
    null,
    null,
    null,
    null,
    '2026-08-21 14:00:00+00',
    null,
    'other-worker',
    now() + interval '10 minutes'
  ),
  -- NOT YET DUE: next_attempt_at in the future. Excluded.
  (
    'd26b3a98-0000-4000-8000-000000000006',
    'd26b3a98-0000-4000-8000-000000000010',
    'd26b3a98-0000-4000-8000-000000000105',
    '2026-08-21 15:00:00+00',
    'd26b3a98-0000-4000-8000-000000000030',
    'provider-thread-backoff',
    null,
    null,
    null,
    null,
    now() + interval '1 hour',
    null,
    null,
    null
  );

\ir ../../supabase/migrations/20260830113000_phase_c_claim_null_safe.sql

do $contract$
declare
  v_function regprocedure :=
    'public.claim_opportunity_phase_c_work(text,integer,integer)'::regprocedure;
begin
  if has_function_privilege('anon', v_function, 'execute')
    or has_function_privilege('authenticated', v_function, 'execute')
  then
    raise exception 'phase c claim is executable by a browser role';
  end if;
  if not has_function_privilege('service_role', v_function, 'execute') then
    raise exception 'phase c claim is not executable by service_role';
  end if;
end;
$contract$;

do $contract$
begin
  perform set_config('contract.auth_role', 'anon', true);
  begin
    perform 1
      from public.claim_opportunity_phase_c_work('contract-worker', 10, 120);
    raise exception 'phase c claim accepted a non-service role';
  exception
    when sqlstate '42501' then
      null;
  end;
  perform set_config('contract.auth_role', 'service_role', true);
end;
$contract$;

create table public.contract_claim_result as
select *
  from public.claim_opportunity_phase_c_work('contract-worker', 10, 120);

do $contract$
declare
  v_claimed_ids uuid[];
begin
  select array_agg(result.opportunity_id order by result.required_event_at)
    into v_claimed_ids
    from public.contract_claim_result result;

  if v_claimed_ids is distinct from array[
    'd26b3a98-0000-4000-8000-000000000001'::uuid,
    'd26b3a98-0000-4000-8000-000000000002'::uuid
  ] then
    raise exception 'claimable set is wrong: %', v_claimed_ids;
  end if;
end;
$contract$;

do $contract$
declare
  v_row public.opportunity_phase_c_work%rowtype;
begin
  -- The fresh NULL-marker row is the production case. It must be leased with
  -- its attempt counter advanced, which never happened before the repair.
  select work.* into v_row
    from public.opportunity_phase_c_work work
   where work.opportunity_id = 'd26b3a98-0000-4000-8000-000000000001';

  if v_row.attempt_count <> 1 then
    raise exception 'fresh row attempt_count did not advance: %', v_row.attempt_count;
  end if;
  if v_row.lease_owner is distinct from 'contract-worker' then
    raise exception 'fresh row was not leased to the claiming worker: %', v_row.lease_owner;
  end if;
  if v_row.lease_expires_at is null or v_row.lease_expires_at <= now() then
    raise exception 'fresh row lease did not extend into the future';
  end if;
  if v_row.last_attempt_at is null then
    raise exception 'fresh row last_attempt_at was not stamped';
  end if;

  select work.* into v_row
    from public.opportunity_phase_c_work work
   where work.opportunity_id = 'd26b3a98-0000-4000-8000-000000000002';
  if v_row.attempt_count <> 1 or v_row.lease_owner is distinct from 'contract-worker' then
    raise exception 'partially completed row was not claimed';
  end if;
end;
$contract$;

do $contract$
declare
  v_untouched uuid[];
begin
  select array_agg(work.opportunity_id order by work.opportunity_id)
    into v_untouched
    from public.opportunity_phase_c_work work
   where work.attempt_count = 0
     and work.last_attempt_at is null
     and work.opportunity_id <> 'd26b3a98-0000-4000-8000-000000000005';

  if v_untouched is distinct from array[
    'd26b3a98-0000-4000-8000-000000000003'::uuid,
    'd26b3a98-0000-4000-8000-000000000004'::uuid,
    'd26b3a98-0000-4000-8000-000000000006'::uuid
  ] then
    raise exception 'excluded rows were mutated by the claim: %', v_untouched;
  end if;
end;
$contract$;

-- A second immediate claim finds nothing: the two claimable rows are now
-- leased, and the excluded rows stay excluded.
do $contract$
declare
  v_second_pass integer;
begin
  select count(*)
    into v_second_pass
    from public.claim_opportunity_phase_c_work('contract-worker-2', 10, 120);

  if v_second_pass <> 0 then
    raise exception 'leases did not hold across a second claim: % rows', v_second_pass;
  end if;
end;
$contract$;

rollback;
