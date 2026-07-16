-- LEAD ASSIGNMENT / PERMISSION SERIALIZATION — TWO-SESSION CONTRACT
--
-- Manual regression artifact for an isolated database after migrations
-- 160000, 160500, 160700, and 161000. It deliberately uses two psql sessions;
-- it is not part of the single-session rollback contract.
--
-- Run SETUP once. Then start SESSION A. As soon as A prints
-- `company_lock_held_start_session_b`, run SESSION B in another connection.
-- A holds the canonical company boundary for five seconds, removes the target's
-- granular view permission, and commits. B must wait for A, then fail with
-- `assignment_target_ineligible`. VERIFY must return true. Run CLEANUP last.

-- SETUP :: ISOLATED DATABASE ONLY
begin;

insert into public.companies (
  id,
  bubble_id,
  name,
  subscription_status,
  subscription_plan
) values (
  '3c000000-0000-4000-8000-000000000001',
  'lead-permission-concurrency-company',
  'Lead Permission Concurrency Contract',
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
  is_company_admin,
  is_active,
  deleted_at
) values
  (
    '3c000000-0000-4000-8000-000000000101',
    '3c000000-0000-4000-8000-000000000001',
    '3c000000-0000-4000-8000-000000009101',
    '3c000000-0000-4000-8000-000000009101',
    'Concurrency',
    'Manager',
    'lead-permission-concurrency-manager@example.invalid',
    false,
    true,
    null
  ),
  (
    '3c000000-0000-4000-8000-000000000102',
    '3c000000-0000-4000-8000-000000000001',
    '3c000000-0000-4000-8000-000000009102',
    '3c000000-0000-4000-8000-000000009102',
    'Concurrency',
    'Target',
    'lead-permission-concurrency-target@example.invalid',
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
    '3c000000-0000-4000-8000-000000000301',
    'Concurrency Access Manager',
    'Two-session assignment serialization actor.',
    false,
    '3c000000-0000-4000-8000-000000000001',
    2
  ),
  (
    '3c000000-0000-4000-8000-000000000302',
    'Concurrency Assignment Target',
    'Two-session assignment serialization target.',
    false,
    '3c000000-0000-4000-8000-000000000001',
    4
  );

insert into public.role_permissions (role_id, permission, scope)
values
  ('3c000000-0000-4000-8000-000000000301', 'team.assign_roles', 'all'),
  ('3c000000-0000-4000-8000-000000000301', 'pipeline.view', 'all'),
  ('3c000000-0000-4000-8000-000000000301', 'pipeline.edit', 'all'),
  ('3c000000-0000-4000-8000-000000000301', 'pipeline.assign', 'all'),
  ('3c000000-0000-4000-8000-000000000301', 'pipeline.convert', 'all'),
  ('3c000000-0000-4000-8000-000000000302', 'pipeline.view', 'assigned');

insert into public.user_roles (id, user_id, role_id)
values
  (
    '3c000000-0000-4000-8000-000000000401',
    '3c000000-0000-4000-8000-000000000101',
    '3c000000-0000-4000-8000-000000000301'
  ),
  (
    '3c000000-0000-4000-8000-000000000402',
    '3c000000-0000-4000-8000-000000000102',
    '3c000000-0000-4000-8000-000000000302'
  );

insert into public.clients (id, company_id, name, email)
values (
  '3c000000-0000-4000-8000-000000000501',
  '3c000000-0000-4000-8000-000000000001',
  'Lead Permission Concurrency Client',
  'lead-permission-concurrency-client@example.invalid'
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
  '3c000000-0000-4000-8000-000000000601',
  '3c000000-0000-4000-8000-000000000001',
  '3c000000-0000-4000-8000-000000000501',
  '3c000000-0000-4000-8000-000000000501',
  'Concurrent Assignment Must Stay Unassigned',
  'qualifying',
  null,
  0,
  1000,
  array[]::text[]
);

commit;

-- SESSION A :: PERMISSION REDUCTION
begin;
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);
select set_config('request.jwt.claim.role', 'service_role', true);

-- Test instrumentation: hold the same private boundary that both public RPCs
-- take. Run this contract as the migration owner on an isolated database.
select private.lock_lead_assignment_company(
  '3c000000-0000-4000-8000-000000000001'
);
select 'company_lock_held_start_session_b' as synchronization_marker;
select pg_catalog.pg_sleep(5);

select public.apply_user_permission_overrides_as_system(
  '3c000000-0000-4000-8000-000000000101',
  '3c000000-0000-4000-8000-000000000102',
  private.canonical_user_override_snapshot(
    '3c000000-0000-4000-8000-000000000102'
  ),
  jsonb_build_array(jsonb_build_object(
    'permission', 'pipeline.view',
    'scope', null,
    'granted', false
  )),
  array[]::text[],
  '[]'::jsonb
);
commit;

-- SESSION B :: CONCURRENT ASSIGNMENT
-- Start only after SESSION A prints its synchronization marker.
begin;
set local lock_timeout = '30s';
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);
select set_config('request.jwt.claim.role', 'service_role', true);

do $session_b$
declare
  v_message text;
begin
  begin
    perform public.change_opportunity_assignment_as_system(
      '3c000000-0000-4000-8000-000000000601',
      0,
      null,
      '3c000000-0000-4000-8000-000000000102',
      'system_repair',
      null,
      null,
      jsonb_build_object('contract', 'permission_assignment_serialization')
    );
    raise exception 'concurrent_assignment_unexpectedly_allowed';
  exception
    when invalid_parameter_value then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'assignment_target_ineligible' then
        raise;
      end if;
  end;
end;
$session_b$;

select exists (
  select 1
    from public.opportunities o
   where o.id = '3c000000-0000-4000-8000-000000000601'
     and o.assigned_to is null
     and o.assignment_version = 0
) as concurrency_contract_passed;
commit;

-- CLEANUP :: AFTER BOTH SESSIONS COMPLETE
begin;
delete from public.opportunities
 where id = '3c000000-0000-4000-8000-000000000601';
delete from public.clients
 where id = '3c000000-0000-4000-8000-000000000501';
delete from public.user_permission_overrides
 where user_id = '3c000000-0000-4000-8000-000000000102';
delete from public.user_roles
 where id in (
   '3c000000-0000-4000-8000-000000000401',
   '3c000000-0000-4000-8000-000000000402'
 );
delete from public.role_permissions
 where role_id in (
   '3c000000-0000-4000-8000-000000000301',
   '3c000000-0000-4000-8000-000000000302'
 );
delete from public.roles
 where id in (
   '3c000000-0000-4000-8000-000000000301',
   '3c000000-0000-4000-8000-000000000302'
 );
delete from public.users
 where id in (
   '3c000000-0000-4000-8000-000000000101',
   '3c000000-0000-4000-8000-000000000102'
 );
delete from public.companies
 where id = '3c000000-0000-4000-8000-000000000001';
commit;
