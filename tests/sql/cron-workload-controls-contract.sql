-- CRON WORKLOAD CONTROLS — BEHAVIOR CONTRACT
--
-- ISOLATED DATABASE ONLY. Apply the cron_workload_controls migration, connect
-- as the migration owner, and execute this whole file. Every state change is
-- rolled back.

begin;

select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

do $contract$
declare
  v_owner_a uuid := '24000000-0000-4000-8000-000000000001';
  v_owner_b uuid := '24000000-0000-4000-8000-000000000002';
  v_first jsonb;
  v_same_lane jsonb;
  v_other_lane jsonb;
  v_second jsonb;
  v_circuit jsonb;
  v_renewal jsonb;
  v_fence bigint;
  v_global_fence bigint;
  v_cursor text;
  v_first_circuit_seconds numeric;
  v_second_circuit_seconds numeric;
  v_capped_circuit_seconds numeric;
begin
  delete from private.cron_workload_controls
   where workload_key in (
     '__global_heavy__',
     'contract-lane-a',
     'contract-lane-b'
   );

  v_first := public.acquire_cron_workload_lease_as_system(
    'contract-lane-a',
    v_owner_a,
    60
  );
  if v_first ->> 'acquired' <> 'true' then
    raise exception 'first workload lease was not acquired';
  end if;

  v_same_lane := public.acquire_cron_workload_lease_as_system(
    'contract-lane-a',
    v_owner_b,
    60
  );
  if v_same_lane ->> 'reason' <> 'lease_held' then
    raise exception 'same lane overlapped';
  end if;

  v_other_lane := public.acquire_cron_workload_lease_as_system(
    'contract-lane-b',
    v_owner_b,
    60
  );
  if v_other_lane ->> 'reason' <> 'lease_held' then
    raise exception 'global heavy-workload singleton overlapped';
  end if;

  v_fence := (v_first ->> 'fence_token')::bigint;
  v_global_fence := (v_first ->> 'global_fence_token')::bigint;
  v_cursor := public.read_cron_workload_cursor_as_system(
    'contract-lane-a',
    v_owner_a,
    v_fence,
    v_global_fence
  );
  if v_cursor is not null then
    raise exception 'new workload cursor was not null';
  end if;

  if not public.advance_cron_workload_cursor_as_system(
    'contract-lane-a',
    v_owner_a,
    v_fence,
    v_global_fence,
    null,
    'company-7'
  ) then
    raise exception 'exact lease cursor advance failed';
  end if;
  if public.advance_cron_workload_cursor_as_system(
    'contract-lane-a',
    v_owner_a,
    v_fence + 1,
    v_global_fence,
    'company-7',
    'company-8'
  ) then
    raise exception 'stale lease advanced the workload cursor';
  end if;

  v_renewal := public.renew_cron_workload_lease_as_system(
    'contract-lane-a',
    v_owner_a,
    v_fence,
    v_global_fence,
    60
  );
  if v_renewal ->> 'renewed' <> 'true' then
    raise exception 'exact workload lease did not renew';
  end if;

  if public.complete_cron_workload_lease_as_system(
    'contract-lane-a',
    v_owner_a,
    v_fence + 1,
    v_global_fence,
    true,
    false,
    300
  ) then
    raise exception 'stale lane fence completed';
  end if;

  update private.cron_workload_controls
     set lease_expires_at = clock_timestamp() - interval '1 second'
   where workload_key in ('__global_heavy__', 'contract-lane-a');

  if not public.complete_cron_workload_lease_as_system(
    'contract-lane-a',
    v_owner_a,
    v_fence,
    v_global_fence,
    true,
    false,
    300
  ) then
    raise exception 'exact expired owner fences did not complete';
  end if;

  v_second := public.acquire_cron_workload_lease_as_system(
    'contract-lane-b',
    v_owner_b,
    60
  );
  if v_second ->> 'acquired' <> 'true' then
    raise exception 'released singleton did not admit next lane';
  end if;

  if not public.complete_cron_workload_lease_as_system(
    'contract-lane-b',
    v_owner_b,
    (v_second ->> 'fence_token')::bigint,
    (v_second ->> 'global_fence_token')::bigint,
    false,
    true,
    300
  ) then
    raise exception 'pressure failure did not complete';
  end if;

  select extract(
    epoch from (circuit_open_until - last_failure_at)
  )
    into v_first_circuit_seconds
    from private.cron_workload_controls
   where workload_key = '__global_heavy__';

  v_circuit := public.acquire_cron_workload_lease_as_system(
    'contract-lane-a',
    v_owner_a,
    60
  );
  if v_circuit ->> 'reason' <> 'circuit_open' then
    raise exception 'global database-pressure circuit did not persist';
  end if;

  update private.cron_workload_controls
     set circuit_open_until = clock_timestamp() - interval '1 second'
   where workload_key in ('__global_heavy__', 'contract-lane-b');

  v_first := public.acquire_cron_workload_lease_as_system(
    'contract-lane-a',
    v_owner_a,
    60
  );
  if v_first ->> 'acquired' <> 'true' then
    raise exception 'expired circuit did not close';
  end if;

  update private.cron_workload_controls
     set lease_expires_at = clock_timestamp() - interval '1 second'
   where workload_key in ('__global_heavy__', 'contract-lane-a');

  v_second := public.acquire_cron_workload_lease_as_system(
    'contract-lane-a',
    v_owner_b,
    60
  );
  if v_second ->> 'acquired' <> 'true' then
    raise exception 'expired lease was not stealable';
  end if;
  if public.complete_cron_workload_lease_as_system(
    'contract-lane-a',
    v_owner_a,
    (v_first ->> 'fence_token')::bigint,
    (v_first ->> 'global_fence_token')::bigint,
    true,
    false,
    300
  ) then
    raise exception 'expired owner cleared successor lease';
  end if;

  if not public.complete_cron_workload_lease_as_system(
    'contract-lane-a',
    v_owner_b,
    (v_second ->> 'fence_token')::bigint,
    (v_second ->> 'global_fence_token')::bigint,
    false,
    true,
    300
  ) then
    raise exception 'successor pressure completion failed';
  end if;

  select extract(
    epoch from (circuit_open_until - last_failure_at)
  )
    into v_second_circuit_seconds
    from private.cron_workload_controls
   where workload_key = '__global_heavy__';

  if v_second_circuit_seconds <= v_first_circuit_seconds
    or v_second_circuit_seconds > 3600
  then
    raise exception 'pressure circuit did not grow within its cap';
  end if;

  update private.cron_workload_controls
     set consecutive_failures = 100,
         circuit_open_until = clock_timestamp() - interval '1 second'
   where workload_key in ('__global_heavy__', 'contract-lane-a');

  v_first := public.acquire_cron_workload_lease_as_system(
    'contract-lane-a',
    v_owner_a,
    60
  );
  if v_first ->> 'acquired' <> 'true' then
    raise exception 'circuit-cap fixture could not acquire';
  end if;
  if not public.complete_cron_workload_lease_as_system(
    'contract-lane-a',
    v_owner_a,
    (v_first ->> 'fence_token')::bigint,
    (v_first ->> 'global_fence_token')::bigint,
    false,
    true,
    300
  ) then
    raise exception 'circuit-cap pressure completion failed';
  end if;

  select extract(
    epoch from (circuit_open_until - last_failure_at)
  )
    into v_capped_circuit_seconds
    from private.cron_workload_controls
   where workload_key = '__global_heavy__';

  if v_capped_circuit_seconds < 2700
    or v_capped_circuit_seconds > 3600
  then
    raise exception 'pressure circuit exceeded its jittered hard cap';
  end if;

  update private.cron_workload_controls
     set circuit_open_until = clock_timestamp() - interval '1 second'
   where workload_key in ('__global_heavy__', 'contract-lane-a');

  v_first := public.acquire_cron_workload_lease_as_system(
    'contract-lane-a',
    v_owner_a,
    60
  );
  if not public.complete_cron_workload_lease_as_system(
    'contract-lane-a',
    v_owner_a,
    (v_first ->> 'fence_token')::bigint,
    (v_first ->> 'global_fence_token')::bigint,
    false,
    false,
    300
  ) then
    raise exception 'ordinary failure completion failed';
  end if;
  if exists (
    select 1
      from private.cron_workload_controls
     where workload_key in ('__global_heavy__', 'contract-lane-a')
       and consecutive_failures <> 0
  ) then
    raise exception 'ordinary failure did not break pressure streak';
  end if;
end;
$contract$;

do $acl_contract$
begin
  if not has_function_privilege(
    'service_role',
    'public.acquire_cron_workload_lease_as_system(text,uuid,integer)',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.complete_cron_workload_lease_as_system(text,uuid,bigint,bigint,boolean,boolean,integer)',
    'execute'
  ) then
    raise exception 'service role execution grant missing';
  end if;

  if has_function_privilege(
    'anon',
    'public.acquire_cron_workload_lease_as_system(text,uuid,integer)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.acquire_cron_workload_lease_as_system(text,uuid,integer)',
    'execute'
  ) or has_function_privilege(
    'anon',
    'public.complete_cron_workload_lease_as_system(text,uuid,bigint,bigint,boolean,boolean,integer)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.complete_cron_workload_lease_as_system(text,uuid,bigint,bigint,boolean,boolean,integer)',
    'execute'
  ) then
    raise exception 'non-service workload control execution grant present';
  end if;
end;
$acl_contract$;

rollback;
