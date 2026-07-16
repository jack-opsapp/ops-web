-- LEAD ASSIGNMENT / OPERATOR ACTIVATION — TWO-SESSION CONTRACT
--
-- ISOLATED DATABASE ONLY. This artifact writes fixtures and executes the
-- production activation migration. Never point either session at a shared,
-- staging, or production database.
--
-- Run each scenario from a fresh pre-180000 database snapshot with migrations
-- through 20260715179000 applied and 20260715180000 unapplied.
-- Do not run this file as one session: copy only the labelled COMMON SETUP / SESSION / VERIFY
-- blocks into the indicated migration-owner psql connections.
--
-- Before COMMON SETUP, explicitly opt the disposable connection in:
--   SET ops.test.isolated_activation_concurrency = 'on';
--
-- The barriers inspect real PostgreSQL locks. No fixed scheduling sleep decides
-- when either session advances. The only pg_sleep is a 10 ms poll inside a
-- bounded helper that raises SQLSTATE 57014 after 30 seconds.

-- COMMON SETUP :: RUN ONCE IN EACH FRESH SNAPSHOT ---------------------------

do $isolated_database_guard$
begin
  if current_setting(
      'ops.test.isolated_activation_concurrency',
      true
    ) is distinct from 'on'
  then
    raise exception 'isolated_activation_concurrency_opt_in_required'
      using errcode = '55000';
  end if;

  if to_regclass(
      'private.lead_assignment_operator_activation_audit'
    ) is not null
  then
    raise exception 'operator_activation_already_applied'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
      from public.roles r
     where r.id = '00000000-0000-0000-0000-000000000004'::uuid
       and r.is_preset
       and r.company_id is null
       and lower(r.name) = 'operator'
  ) then
    raise exception 'operator_preset_missing'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
      from public.role_permissions rp
     where rp.role_id = '00000000-0000-0000-0000-000000000004'::uuid
       and rp.permission = 'inbox.view'
       and rp.scope = 'all'
  ) or exists (
    select 1
      from public.role_permissions rp
     where rp.role_id = '00000000-0000-0000-0000-000000000004'::uuid
       and rp.permission in (
         'pipeline.create',
         'pipeline.view',
         'pipeline.edit',
         'pipeline.assign',
         'pipeline.convert',
         'inbox.send'
       )
  ) then
    raise exception 'operator_pre_activation_shape_required'
      using errcode = '55000';
  end if;
end;
$isolated_database_guard$;

create table private.lead_assignment_operator_activation_concurrency_sessions (
  scenario text not null
    check (scenario in (
      'assignment',
      'late_membership',
      'member_user_state'
    )),
  side text not null
    check (side in ('a', 'b')),
  backend_pid integer not null
    check (backend_pid > 0),
  registered_at timestamptz not null default clock_timestamp(),
  primary key (scenario, side)
);

revoke all on table private.lead_assignment_operator_activation_concurrency_sessions
  from public, anon, authenticated, service_role;

create or replace function private.register_lead_assignment_activation_session(
  p_scenario text,
  p_side text
) returns void
language plpgsql
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $function$
begin
  if p_scenario not in (
    'assignment',
    'late_membership',
    'member_user_state'
  )
    or p_side not in ('a', 'b')
  then
    raise exception 'invalid_activation_concurrency_session'
      using errcode = '22023';
  end if;

  insert into private.lead_assignment_operator_activation_concurrency_sessions (
    scenario,
    side,
    backend_pid,
    registered_at
  ) values (
    p_scenario,
    p_side,
    pg_catalog.pg_backend_pid(),
    pg_catalog.clock_timestamp()
  )
  on conflict (scenario, side) do update
    set backend_pid = excluded.backend_pid,
        registered_at = excluded.registered_at;
end;
$function$;

revoke all on function private.register_lead_assignment_activation_session(
  text,
  text
) from public, anon, authenticated, service_role;

create or replace function private.await_lead_assignment_activation_signal(
  p_scenario text,
  p_side text,
  p_class_id integer,
  p_object_id integer,
  p_timeout interval default interval '30 seconds'
) returns void
language plpgsql
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $function$
declare
  v_signal_pid integer;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + p_timeout;
begin
  loop
    select session.backend_pid
      into v_signal_pid
      from private.lead_assignment_operator_activation_concurrency_sessions session
     where session.scenario = p_scenario
       and session.side = p_side;

    if found and exists (
      select 1
        from pg_catalog.pg_locks held
       where held.pid = v_signal_pid
         and held.locktype = 'advisory'
         and held.mode = 'ExclusiveLock'
         and held.granted
         and held.classid = p_class_id::oid
         and held.objid = p_object_id::oid
         and held.objsubid = 2
    ) then
      return;
    end if;

    if pg_catalog.clock_timestamp() >= v_deadline then
      raise exception using
        errcode = '57014',
        message = 'activation_concurrency_barrier_timeout',
        detail = pg_catalog.jsonb_build_object(
          'barrier', 'signal',
          'scenario', p_scenario,
          'side', p_side,
          'class_id', p_class_id,
          'object_id', p_object_id
        )::text;
    end if;

    perform pg_catalog.pg_sleep(0.01);
  end loop;
end;
$function$;

revoke all on function private.await_lead_assignment_activation_signal(
  text,
  text,
  integer,
  integer,
  interval
) from public, anon, authenticated, service_role;

create or replace function private.await_lead_assignment_activation_block(
  p_scenario text,
  p_waiter_side text,
  p_expected_wait_event text default null,
  p_timeout interval default interval '30 seconds'
) returns void
language plpgsql
set search_path to 'pg_catalog', 'private', 'pg_temp'
as $function$
declare
  v_waiter_pid integer;
  v_deadline timestamptz := pg_catalog.clock_timestamp() + p_timeout;
begin
  loop
    select session.backend_pid
      into v_waiter_pid
      from private.lead_assignment_operator_activation_concurrency_sessions session
     where session.scenario = p_scenario
       and session.side = p_waiter_side;

    if found and exists (
      select 1
        from pg_catalog.pg_stat_activity activity
       where activity.pid = v_waiter_pid
         and activity.wait_event_type = 'Lock'
         and (
           p_expected_wait_event is null
           or lower(coalesce(activity.wait_event, '')) =
              lower(p_expected_wait_event)
         )
         and pg_catalog.pg_backend_pid() = any(
           pg_catalog.pg_blocking_pids(v_waiter_pid)
         )
    ) then
      return;
    end if;

    if pg_catalog.clock_timestamp() >= v_deadline then
      raise exception using
        errcode = '57014',
        message = 'activation_concurrency_barrier_timeout',
        detail = pg_catalog.jsonb_build_object(
          'barrier', 'blocked_by_current_session',
          'scenario', p_scenario,
          'waiter_side', p_waiter_side,
          'expected_wait_event', p_expected_wait_event
        )::text;
    end if;

    perform pg_catalog.pg_sleep(0.01);
  end loop;
end;
$function$;

revoke all on function private.await_lead_assignment_activation_block(
  text,
  text,
  text,
  interval
) from public, anon, authenticated, service_role;

begin;

insert into public.companies (
  id,
  bubble_id,
  name,
  subscription_status,
  subscription_plan
) values
  (
    '18000000-0000-4000-8000-000000000001',
    'operator-activation-concurrency-company-a',
    'Operator Activation Concurrency A',
    'trial',
    'trial'
  ),
  (
    '18000000-0000-4000-8000-000000000002',
    'operator-activation-concurrency-company-b',
    'Operator Activation Concurrency B',
    'trial',
    'trial'
  );

insert into public.users (
  id,
  company_id,
  auth_id,
  firebase_uid,
  first_name,
  last_name,
  email,
  role,
  is_company_admin,
  is_active,
  deleted_at
) values
  (
    '18000000-0000-4000-8000-000000000101',
    '18000000-0000-4000-8000-000000000001',
    '18000000-0000-4000-8000-000000009101',
    '18000000-0000-4000-8000-000000009101',
    'Existing',
    'Operator',
    'activation-existing-operator@example.invalid',
    'operator',
    false,
    true,
    null
  ),
  (
    '18000000-0000-4000-8000-000000000201',
    '18000000-0000-4000-8000-000000000002',
    '18000000-0000-4000-8000-000000009201',
    '18000000-0000-4000-8000-000000009201',
    'Role',
    'Manager',
    'activation-role-manager@example.invalid',
    'unassigned',
    false,
    true,
    null
  ),
  (
    '18000000-0000-4000-8000-000000000202',
    '18000000-0000-4000-8000-000000000002',
    '18000000-0000-4000-8000-000000009202',
    '18000000-0000-4000-8000-000000009202',
    'Future',
    'Operator',
    'activation-future-operator@example.invalid',
    'unassigned',
    false,
    true,
    null
  );

insert into public.roles (
  id,
  name,
  description,
  is_preset,
  company_id,
  hierarchy
) values
  (
    '18000000-0000-4000-8000-000000000301',
    'Activation Role Manager',
    'Owns the service-only role replacement test authority.',
    false,
    '18000000-0000-4000-8000-000000000002',
    2
  ),
  (
    '18000000-0000-4000-8000-000000000302',
    'Activation Initial Role',
    'Initial role for the late Operator membership target.',
    false,
    '18000000-0000-4000-8000-000000000002',
    5
  );

insert into public.role_permissions (role_id, permission, scope)
values
  (
    '18000000-0000-4000-8000-000000000301',
    'team.assign_roles',
    'all'
  ),
  (
    '18000000-0000-4000-8000-000000000302',
    'pipeline.view',
    'assigned'
  );

insert into public.user_roles (id, user_id, role_id)
values
  (
    '18000000-0000-4000-8000-000000000401',
    '18000000-0000-4000-8000-000000000101',
    '00000000-0000-0000-0000-000000000004'
  ),
  (
    '18000000-0000-4000-8000-000000000402',
    '18000000-0000-4000-8000-000000000201',
    '18000000-0000-4000-8000-000000000301'
  ),
  (
    '18000000-0000-4000-8000-000000000403',
    '18000000-0000-4000-8000-000000000202',
    '18000000-0000-4000-8000-000000000302'
  );

insert into public.clients (id, company_id, name, email)
values (
  '18000000-0000-4000-8000-000000000501',
  '18000000-0000-4000-8000-000000000001',
  'Operator Activation Concurrency Client',
  'activation-concurrency-client@example.invalid'
);

insert into public.opportunities (
  id,
  company_id,
  client_id,
  client_ref,
  title,
  stage,
  assigned_to,
  assignment_version,
  estimated_value,
  images
) values (
  '18000000-0000-4000-8000-000000000601',
  '18000000-0000-4000-8000-000000000001',
  '18000000-0000-4000-8000-000000000501',
  '18000000-0000-4000-8000-000000000501',
  'Operator Activation Concurrent Assignment',
  'qualifying',
  null,
  0,
  1800,
  array[]::text[]
);

commit;

-- SCENARIO 1 :: GUARDED ASSIGNMENT -----------------------------------------
-- Purpose: prove activation takes the member-company advisory lock before any
-- role/member row lock. The guarded assignment must be observed waiting on that
-- exact advisory boundary, then succeed after activation makes the existing
-- Operator member an eligible assigned-scope target.
--
-- Start Session A first. It stops at the bounded blocker barrier. Start Session
-- B, which stops inside the real guarded assignment RPC. When Session A returns
-- from its barrier, execute the exact 180000 migration in that same connection.

-- SCENARIO 1 / SESSION A :: ACTIVATION
select private.register_lead_assignment_activation_session('assignment', 'a');

begin;
set local lock_timeout = '30s';
set local statement_timeout = '45s';
select private.lock_lead_assignment_company(
  '18000000-0000-4000-8000-000000000001'
);
select pg_catalog.pg_advisory_lock(180000, 1);
select private.await_lead_assignment_activation_block(
  'assignment',
  'b',
  'advisory',
  interval '30 seconds'
);

-- STOP COPYING HERE. In this same open Session A, run exactly:
--   \ir ../../supabase/migrations/20260715180000_lead_assignment_operator_activation.sql
-- The migration's COMMIT releases the company lock. Then run this continuation:
select pg_catalog.pg_advisory_unlock(180000, 1);

-- SCENARIO 1 / SESSION B :: GUARDED ASSIGNMENT
select private.register_lead_assignment_activation_session('assignment', 'b');
select private.await_lead_assignment_activation_signal(
  'assignment',
  'a',
  180000,
  1,
  interval '30 seconds'
);

begin;
set local lock_timeout = '30s';
set local statement_timeout = '45s';
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);
select set_config('request.jwt.claim.role', 'service_role', true);

select public.change_opportunity_assignment_as_system(
  '18000000-0000-4000-8000-000000000601',
  0,
  null,
  '18000000-0000-4000-8000-000000000101',
  'system_repair',
  null,
  null,
  jsonb_build_object(
    'contract',
    'operator_activation_assignment_concurrency'
  )
);
commit;

-- SCENARIO 1 / VERIFY :: AFTER BOTH SESSIONS FINISH
do $assignment_verify$
begin
  if not exists (
    select 1
      from public.opportunities o
     where o.id = '18000000-0000-4000-8000-000000000601'::uuid
       and o.assigned_to = '18000000-0000-4000-8000-000000000101'::uuid
       and o.assignment_version = 1
  ) then
    raise exception 'assignment_concurrency_result_invalid'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
      from public.opportunity_assignment_events event
     where event.opportunity_id =
           '18000000-0000-4000-8000-000000000601'::uuid
       and event.new_assignee_id =
           '18000000-0000-4000-8000-000000000101'::uuid
       and event.assignment_version = 1
       and event.source = 'system_repair'
       and event.metadata ->> 'contract' =
           'operator_activation_assignment_concurrency'
  ) then
    raise exception 'assignment_concurrency_event_missing'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
      from private.lead_assignment_operator_activation_audit audit
     where audit.migration_key = '20260715180000'
       and audit.operator_role_id =
           '00000000-0000-0000-0000-000000000004'::uuid
  ) then
    raise exception 'assignment_concurrency_activation_missing'
      using errcode = '55000';
  end if;
end;
$assignment_verify$;

select true as assignment_concurrency_contract_passed;

-- Discard this isolated database. Restore a fresh pre-180000 snapshot and run
-- COMMON SETUP again before Scenario 2.

-- SCENARIO 2 :: LATE NEW-COMPANY MEMBERSHIP -------------------------------
-- Purpose: prove replace_user_role_as_system can never deadlock activation.
-- Session B takes Company B first, replaces its target into the global Operator
-- role, and holds the Operator role share lock before commit. Session A then
-- snapshots only Company A, takes Company A before requesting the Operator row,
-- and is observed waiting on Session B. Session B commits. Activation must see
-- the late Company B membership and abort with
-- `operator_membership_company_set_changed` (SQLSTATE 40001), without writing
-- the preset or audit. The caller can safely restore a fresh snapshot and retry.
--
-- Start Session B first. It stops after the real replacement RPC while holding
-- its transaction. Start Session A and run the exact migration when its signal
-- barrier returns. Session A blocks on the Operator row; Session B observes that
-- real block and commits automatically.

-- SCENARIO 2 / SESSION B :: ROLE REPLACEMENT
select private.register_lead_assignment_activation_session(
  'late_membership',
  'b'
);

begin;
set local lock_timeout = '30s';
set local statement_timeout = '45s';
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);
select set_config('request.jwt.claim.role', 'service_role', true);

select public.replace_user_role_as_system(
  '18000000-0000-4000-8000-000000000201',
  '18000000-0000-4000-8000-000000000202',
  '18000000-0000-4000-8000-000000000302',
  '00000000-0000-0000-0000-000000000004',
  '[]'::jsonb
);

select pg_catalog.pg_advisory_lock(180000, 2);
select private.await_lead_assignment_activation_block(
  'late_membership',
  'a',
  null,
  interval '30 seconds'
);
commit;
select pg_catalog.pg_advisory_unlock(180000, 2);

-- SCENARIO 2 / SESSION A :: ACTIVATION
select private.register_lead_assignment_activation_session(
  'late_membership',
  'a'
);
select private.await_lead_assignment_activation_signal(
  'late_membership',
  'b',
  180000,
  2,
  interval '30 seconds'
);

-- STOP COPYING HERE. In this same Session A, enable verbose psql errors and run:
--   \set VERBOSITY verbose
--   \set ON_ERROR_STOP on
--   \ir ../../supabase/migrations/20260715180000_lead_assignment_operator_activation.sql
-- Expected: ERROR 40001, operator_membership_company_set_changed.
-- Expected SQLSTATE 40001 proves the late company is retryable, not partial.
-- Close the failed session, or issue ROLLBACK before verification.
rollback;

-- SCENARIO 2 / VERIFY :: AFTER BOTH SESSIONS FINISH
do $late_membership_verify$
begin
  if not exists (
    select 1
      from public.user_roles ur
     where ur.user_id = '18000000-0000-4000-8000-000000000202'
       and ur.role_id = '00000000-0000-0000-0000-000000000004'::uuid
  ) or not exists (
    select 1
      from public.users u
     where u.id = '18000000-0000-4000-8000-000000000202'::uuid
       and u.company_id = '18000000-0000-4000-8000-000000000002'::uuid
       and u.role = 'operator'
  ) then
    raise exception 'late_membership_role_replacement_missing'
      using errcode = '55000';
  end if;

  if to_regclass('private.lead_assignment_operator_activation_audit') is null
  then
    null;
  else
    raise exception 'late_membership_activation_did_not_rollback'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
      from public.role_permissions rp
     where rp.role_id = '00000000-0000-0000-0000-000000000004'::uuid
       and rp.permission = 'inbox.view'
       and rp.scope = 'all'
  ) or exists (
    select 1
      from public.role_permissions rp
     where rp.role_id = '00000000-0000-0000-0000-000000000004'::uuid
       and rp.permission in (
         'pipeline.create',
         'pipeline.view',
         'pipeline.edit',
         'pipeline.assign',
         'pipeline.convert',
         'inbox.send'
       )
  ) then
    raise exception 'late_membership_activation_wrote_partial_preset'
      using errcode = '55000';
  end if;
end;
$late_membership_verify$;

select true as late_membership_retry_contract_passed;

-- Discard this isolated database. Restore a fresh pre-180000 snapshot and run
-- COMMON SETUP again before Scenario 3.

-- SCENARIO 3 :: LOCKED MEMBER-USER REVALIDATION ----------------------------
-- Purpose: prove a member's user row cannot change company/lifecycle state in
-- the gap between the initial company-set check and the user-row lock. Session
-- B updates the existing Operator member while holding that user row. Session A
-- snapshots Company A, locks the role, permissions, and membership rows, then
-- is observed waiting on the user row. Once Session B commits, activation must
-- re-read the locked user and abort with
-- `operator_membership_user_state_changed` (SQLSTATE 40001) before writing any
-- Operator permission or activation audit row.
--
-- Start Session B first. It stops after updating the user but before commit.
-- Start Session A and run the exact migration after its signal barrier returns.

-- SCENARIO 3 / SESSION B :: MEMBER LIFECYCLE WRITE
select private.register_lead_assignment_activation_session(
  'member_user_state',
  'b'
);

begin;
set local lock_timeout = '30s';
set local statement_timeout = '45s';
update public.users
   set company_id = '18000000-0000-4000-8000-000000000002'::uuid,
       deleted_at = clock_timestamp(),
       updated_at = clock_timestamp()
 where id = '18000000-0000-4000-8000-000000000101'::uuid;

select pg_catalog.pg_advisory_lock(180000, 3);
select private.await_lead_assignment_activation_block(
  'member_user_state',
  'a',
  null,
  interval '30 seconds'
);
commit;
select pg_catalog.pg_advisory_unlock(180000, 3);

-- SCENARIO 3 / SESSION A :: ACTIVATION
select private.register_lead_assignment_activation_session(
  'member_user_state',
  'a'
);
select private.await_lead_assignment_activation_signal(
  'member_user_state',
  'b',
  180000,
  3,
  interval '30 seconds'
);

-- STOP COPYING HERE. In this same Session A, enable verbose psql errors and run:
--   \set VERBOSITY verbose
--   \set ON_ERROR_STOP on
--   \ir ../../supabase/migrations/20260715180000_lead_assignment_operator_activation.sql
-- Expected: ERROR 40001, operator_membership_user_state_changed.
-- Expected SQLSTATE 40001 proves the post-user-lock check is retryable.
-- Close the failed session, or issue ROLLBACK before verification.
rollback;

-- SCENARIO 3 / VERIFY :: AFTER BOTH SESSIONS FINISH
do $member_user_revalidation_verify$
begin
  if not exists (
    select 1
      from public.users u
     where u.id = '18000000-0000-4000-8000-000000000101'::uuid
       and u.company_id = '18000000-0000-4000-8000-000000000002'::uuid
       and u.deleted_at is not null
  ) then
    raise exception 'member_user_concurrent_change_missing'
      using errcode = '55000';
  end if;

  if to_regclass('private.lead_assignment_operator_activation_audit') is null
  then
    null;
  else
    raise exception 'member_user_activation_did_not_rollback'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
      from public.role_permissions rp
     where rp.role_id = '00000000-0000-0000-0000-000000000004'::uuid
       and rp.permission = 'inbox.view'
       and rp.scope = 'all'
  ) or exists (
    select 1
      from public.role_permissions rp
     where rp.role_id = '00000000-0000-0000-0000-000000000004'::uuid
       and rp.permission in (
         'pipeline.create',
         'pipeline.view',
         'pipeline.edit',
         'pipeline.assign',
         'pipeline.convert',
         'inbox.send'
       )
  ) then
    raise exception 'member_user_activation_wrote_partial_preset'
      using errcode = '55000';
  end if;
end;
$member_user_revalidation_verify$;

select true as member_user_revalidation_contract_passed;

-- Discard the isolated database after verification. There is intentionally no
-- cleanup path that could normalize running this destructive proof elsewhere.
