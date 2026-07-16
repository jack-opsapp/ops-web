begin;

-- Run only after 160000, 160500, and 161000 on an isolated database. Every
-- fixture, permission mutation, assignment event, and delivery is rolled back.

create temp table lead_permission_contract_results (
  check_name text primary key,
  passed boolean not null,
  details text
) on commit drop;

create temp table lead_permission_contract_payloads (
  payload_name text primary key,
  payload jsonb not null
) on commit drop;

-- Public surface, ACLs, private audit evidence, and deferred activation.
insert into lead_permission_contract_results (check_name, passed)
values (
  'service_only_execution',
  to_regprocedure(
    'public.replace_role_permissions_as_system(uuid,uuid,jsonb,jsonb,jsonb)'
  ) is not null
  and to_regprocedure(
    'public.apply_user_permission_overrides_as_system(uuid,uuid,jsonb,jsonb,text[],jsonb)'
  ) is not null
  and to_regprocedure(
    'public.replace_user_role_as_system(uuid,uuid,uuid,uuid,jsonb)'
  ) is not null
  and has_function_privilege(
    'service_role',
    'public.replace_role_permissions_as_system(uuid,uuid,jsonb,jsonb,jsonb)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.apply_user_permission_overrides_as_system(uuid,uuid,jsonb,jsonb,text[],jsonb)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.replace_user_role_as_system(uuid,uuid,uuid,uuid,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.replace_role_permissions_as_system(uuid,uuid,jsonb,jsonb,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.apply_user_permission_overrides_as_system(uuid,uuid,jsonb,jsonb,text[],jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.replace_user_role_as_system(uuid,uuid,uuid,uuid,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.replace_role_permissions_as_system(uuid,uuid,jsonb,jsonb,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.apply_user_permission_overrides_as_system(uuid,uuid,jsonb,jsonb,text[],jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.replace_user_role_as_system(uuid,uuid,uuid,uuid,jsonb)',
    'execute'
  )
), (
  'operator_not_activated',
  not exists (
    select 1
      from public.role_permissions rp
     where rp.role_id = '00000000-0000-0000-0000-000000000004'::uuid
       and rp.permission in (
         'pipeline.create',
         'pipeline.view',
         'pipeline.edit',
         'pipeline.assign',
         'pipeline.convert'
       )
  )
  and exists (
    select 1
      from private.lead_assignment_permission_migration_diffs d
     where d.migration_key = '20260715161000'
       and d.subject_kind = 'role'
       and d.subject_id = '00000000-0000-0000-0000-000000000004'::uuid
       and d.classification = 'deferred_operator_activation'
  )
  and (
    select jsonb_agg(item order by item ->> 'permission')
      from private.lead_assignment_permission_migration_snapshots s
      cross join lateral jsonb_array_elements(s.permissions) item
     where s.migration_key = '20260715161000'
       and s.phase = 'before'
       and s.subject_kind = 'role'
       and s.subject_id = '00000000-0000-0000-0000-000000000004'::uuid
       and item ->> 'permission' like 'inbox.%'
  ) is not distinct from (
    select jsonb_agg(item order by item ->> 'permission')
      from private.lead_assignment_permission_migration_snapshots s
      cross join lateral jsonb_array_elements(s.permissions) item
     where s.migration_key = '20260715161000'
       and s.phase = 'after'
       and s.subject_kind = 'role'
       and s.subject_id = '00000000-0000-0000-0000-000000000004'::uuid
       and item ->> 'permission' like 'inbox.%'
  )
), (
  'mapping_report_has_no_widening_or_unclassified_change',
  not exists (
    select 1
      from private.lead_assignment_permission_migration_diffs d
     where d.migration_key = '20260715161000'
       and d.classification not in (
         'equivalent',
         'equivalent_compatibility_expansion',
         'deferred_operator_activation'
       )
  )
  and exists (
    select 1
      from private.lead_assignment_permission_migration_snapshots s
     where s.migration_key = '20260715161000'
       and s.phase = 'before'
       and s.subject_kind = 'role'
       and s.snapshot_hash = pg_catalog.md5(s.permissions::text)
  )
  and exists (
    select 1
      from private.lead_assignment_permission_migration_snapshots s
     where s.migration_key = '20260715161000'
       and s.phase = 'after'
       and s.subject_kind = 'role'
       and s.snapshot_hash = pg_catalog.md5(s.permissions::text)
  )
);

-- Disjoint rollback-only companies and principals.
insert into public.companies (
  id,
  bubble_id,
  name,
  subscription_status,
  subscription_plan
) values
  (
    '3b000000-0000-4000-8000-000000000001',
    'lead-permission-contract-company-a',
    'Lead Permission Contract A',
    'trial',
    'trial'
  ),
  (
    '3b000000-0000-4000-8000-000000000002',
    'lead-permission-contract-company-b',
    'Lead Permission Contract B',
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
  ('3b000000-0000-4000-8000-000000000101', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000009101', '3b000000-0000-4000-8000-000000009101', 'Access', 'Manager', 'permission-contract-actor@example.invalid', false, true, null),
  ('3b000000-0000-4000-8000-000000000102', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000009102', '3b000000-0000-4000-8000-000000009102', 'Inactive', 'Manager', 'permission-contract-inactive@example.invalid', false, false, null),
  ('3b000000-0000-4000-8000-000000000103', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000009103', '3b000000-0000-4000-8000-000000009103', 'Admin', 'Target', 'permission-contract-admin@example.invalid', true, true, null),
  ('3b000000-0000-4000-8000-000000000104', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000009104', '3b000000-0000-4000-8000-000000009104', 'Eligible', 'Transfer', 'permission-contract-transfer@example.invalid', false, true, null),
  ('3b000000-0000-4000-8000-000000000110', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000009110', '3b000000-0000-4000-8000-000000009110', 'Exact', 'Unassign', 'permission-contract-unassign@example.invalid', false, true, null),
  ('3b000000-0000-4000-8000-000000000111', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000009111', '3b000000-0000-4000-8000-000000009111', 'Exact', 'Transfer Subject', 'permission-contract-transfer-subject@example.invalid', false, true, null),
  ('3b000000-0000-4000-8000-000000000112', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000009112', '3b000000-0000-4000-8000-000000009112', 'Blocked', 'Subject', 'permission-contract-blocked@example.invalid', false, true, null),
  ('3b000000-0000-4000-8000-000000000113', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000009113', '3b000000-0000-4000-8000-000000009113', 'Shared', 'Normal', 'permission-contract-shared-normal@example.invalid', false, true, null),
  ('3b000000-0000-4000-8000-000000000114', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000009114', '3b000000-0000-4000-8000-000000009114', 'Shared', 'Override', 'permission-contract-shared-override@example.invalid', false, true, null),
  ('3b000000-0000-4000-8000-000000000115', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000009115', '3b000000-0000-4000-8000-000000009115', 'Override', 'Subject', 'permission-contract-override@example.invalid', false, true, null),
  ('3b000000-0000-4000-8000-000000000116', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000009116', '3b000000-0000-4000-8000-000000009116', 'Role', 'Delete Subject', 'permission-contract-role-delete@example.invalid', false, true, null),
  ('3b000000-0000-4000-8000-000000000117', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000009117', '3b000000-0000-4000-8000-000000009117', 'Direct', 'Role Permission', 'permission-contract-direct-role@example.invalid', false, true, null),
  ('3b000000-0000-4000-8000-000000000118', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000009118', '3b000000-0000-4000-8000-000000009118', 'Direct', 'User Role', 'permission-contract-direct-user-role@example.invalid', false, true, null),
  ('3b000000-0000-4000-8000-000000000201', '3b000000-0000-4000-8000-000000000002', '3b000000-0000-4000-8000-000000009201', '3b000000-0000-4000-8000-000000009201', 'Cross', 'Company', 'permission-contract-cross@example.invalid', false, true, null);

insert into public.roles (
  id,
  name,
  description,
  is_preset,
  company_id,
  hierarchy
) values
  ('3b000000-0000-4000-8000-000000000301', 'Permission Contract Manager', 'Rollback-only access manager.', false, '3b000000-0000-4000-8000-000000000001', 2),
  ('3b000000-0000-4000-8000-000000000302', 'Permission Contract No Lead', 'Rollback-only no-lead role.', false, '3b000000-0000-4000-8000-000000000001', 5),
  ('3b000000-0000-4000-8000-000000000310', 'Permission Contract Unassign', 'Rollback-only exact unassign role.', false, '3b000000-0000-4000-8000-000000000001', 4),
  ('3b000000-0000-4000-8000-000000000311', 'Permission Contract Transfer', 'Rollback-only exact transfer role.', false, '3b000000-0000-4000-8000-000000000001', 4),
  ('3b000000-0000-4000-8000-000000000312', 'Permission Contract Blocked', 'Rollback-only blocked role.', false, '3b000000-0000-4000-8000-000000000001', 4),
  ('3b000000-0000-4000-8000-000000000313', 'Permission Contract Shared', 'Rollback-only multi-member role.', false, '3b000000-0000-4000-8000-000000000001', 4),
  ('3b000000-0000-4000-8000-000000000314', 'Permission Contract Override Base', 'Rollback-only override base role.', false, '3b000000-0000-4000-8000-000000000001', 4),
  ('3b000000-0000-4000-8000-000000000315', 'Permission Contract Role Delete', 'Rollback-only role delete target.', false, '3b000000-0000-4000-8000-000000000001', 4),
  ('3b000000-0000-4000-8000-000000000316', 'Permission Contract Direct Role', 'Rollback-only direct role guard.', false, '3b000000-0000-4000-8000-000000000001', 4),
  ('3b000000-0000-4000-8000-000000000317', 'Permission Contract Direct User Role', 'Rollback-only direct user-role guard.', false, '3b000000-0000-4000-8000-000000000001', 4),
  ('3b000000-0000-4000-8000-000000000390', 'Permission Contract Cross Company', 'Rollback-only foreign role.', false, '3b000000-0000-4000-8000-000000000002', 4);

insert into public.role_permissions (role_id, permission, scope)
values
  ('3b000000-0000-4000-8000-000000000301', 'team.assign_roles', 'all'),
  ('3b000000-0000-4000-8000-000000000301', 'pipeline.view', 'all'),
  ('3b000000-0000-4000-8000-000000000301', 'pipeline.edit', 'all'),
  ('3b000000-0000-4000-8000-000000000301', 'pipeline.assign', 'all'),
  ('3b000000-0000-4000-8000-000000000301', 'pipeline.convert', 'all'),
  ('3b000000-0000-4000-8000-000000000310', 'pipeline.view', 'assigned'),
  ('3b000000-0000-4000-8000-000000000311', 'pipeline.view', 'assigned'),
  ('3b000000-0000-4000-8000-000000000312', 'pipeline.view', 'assigned'),
  ('3b000000-0000-4000-8000-000000000313', 'pipeline.view', 'assigned'),
  ('3b000000-0000-4000-8000-000000000315', 'pipeline.view', 'assigned'),
  ('3b000000-0000-4000-8000-000000000316', 'pipeline.view', 'assigned'),
  ('3b000000-0000-4000-8000-000000000317', 'pipeline.view', 'assigned'),
  ('3b000000-0000-4000-8000-000000000390', 'pipeline.view', 'assigned');

insert into public.user_roles (id, user_id, role_id)
values
  ('3b000000-0000-4000-8000-000000000401', '3b000000-0000-4000-8000-000000000101', '3b000000-0000-4000-8000-000000000301'),
  ('3b000000-0000-4000-8000-000000000402', '3b000000-0000-4000-8000-000000000104', '3b000000-0000-4000-8000-000000000301'),
  ('3b000000-0000-4000-8000-000000000410', '3b000000-0000-4000-8000-000000000110', '3b000000-0000-4000-8000-000000000310'),
  ('3b000000-0000-4000-8000-000000000411', '3b000000-0000-4000-8000-000000000111', '3b000000-0000-4000-8000-000000000311'),
  ('3b000000-0000-4000-8000-000000000412', '3b000000-0000-4000-8000-000000000112', '3b000000-0000-4000-8000-000000000312'),
  ('3b000000-0000-4000-8000-000000000413', '3b000000-0000-4000-8000-000000000113', '3b000000-0000-4000-8000-000000000313'),
  ('3b000000-0000-4000-8000-000000000414', '3b000000-0000-4000-8000-000000000114', '3b000000-0000-4000-8000-000000000313'),
  ('3b000000-0000-4000-8000-000000000415', '3b000000-0000-4000-8000-000000000115', '3b000000-0000-4000-8000-000000000314'),
  ('3b000000-0000-4000-8000-000000000416', '3b000000-0000-4000-8000-000000000116', '3b000000-0000-4000-8000-000000000315'),
  ('3b000000-0000-4000-8000-000000000417', '3b000000-0000-4000-8000-000000000117', '3b000000-0000-4000-8000-000000000316'),
  ('3b000000-0000-4000-8000-000000000418', '3b000000-0000-4000-8000-000000000118', '3b000000-0000-4000-8000-000000000317'),
  ('3b000000-0000-4000-8000-000000000490', '3b000000-0000-4000-8000-000000000201', '3b000000-0000-4000-8000-000000000390');

-- The shared member's explicit revoke is inert while the role has no writes,
-- but becomes invalid if a role edit grants edit without effective view.
insert into public.user_permission_overrides (
  user_id,
  company_id,
  permission,
  scope,
  granted
) values
  ('3b000000-0000-4000-8000-000000000114', '3b000000-0000-4000-8000-000000000001', 'pipeline.view', null, false),
  ('3b000000-0000-4000-8000-000000000115', '3b000000-0000-4000-8000-000000000001', 'pipeline.view', 'assigned', true);

-- Complete canonical replacement payloads. Null is an explicit tombstone.
insert into lead_permission_contract_payloads (payload_name, payload)
select
  shape.payload_name,
  jsonb_agg(
    jsonb_build_object(
      'permission', registry.permission,
      'scope', case shape.payload_name
        when 'none' then null
        when 'view_only' then case
          when registry.permission = 'pipeline.view' then 'assigned'
          else null
        end
        when 'view_edit_assigned' then case
          when registry.permission in ('pipeline.view', 'pipeline.edit')
            then 'assigned'
          else null
        end
        when 'invalid_edit_all' then case
          when registry.permission = 'pipeline.view' then 'assigned'
          when registry.permission = 'pipeline.edit' then 'all'
          else null
        end
      end
    )
    order by registry.permission
  )
from private.lead_permission_editor_registry registry
cross join (
  values
    ('none'::text),
    ('view_only'::text),
    ('view_edit_assigned'::text),
    ('invalid_edit_all'::text)
) shape(payload_name)
group by shape.payload_name;

insert into public.clients (id, company_id, name, email)
values (
  '3b000000-0000-4000-8000-000000000501',
  '3b000000-0000-4000-8000-000000000001',
  'Lead Permission Contract Client',
  'permission-contract-client@example.invalid'
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
) values
  ('3b000000-0000-4000-8000-000000000601', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000501', '3b000000-0000-4000-8000-000000000501', 'Exact Unassign Active', 'qualifying', null, 0, 1000, array[]::text[]),
  ('3b000000-0000-4000-8000-000000000602', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000501', '3b000000-0000-4000-8000-000000000501', 'Terminal Assignment Retained', 'won', null, 0, 2000, array[]::text[]),
  ('3b000000-0000-4000-8000-000000000603', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000501', '3b000000-0000-4000-8000-000000000501', 'Exact Transfer Active', 'quoting', null, 0, 3000, array[]::text[]),
  ('3b000000-0000-4000-8000-000000000604', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000501', '3b000000-0000-4000-8000-000000000501', 'Blocked Active One', 'qualifying', null, 0, 4000, array[]::text[]),
  ('3b000000-0000-4000-8000-000000000605', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000501', '3b000000-0000-4000-8000-000000000501', 'Blocked Active Two', 'quoting', null, 0, 5000, array[]::text[]),
  ('3b000000-0000-4000-8000-000000000606', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000501', '3b000000-0000-4000-8000-000000000501', 'Override Clear Active', 'qualifying', null, 0, 6000, array[]::text[]),
  ('3b000000-0000-4000-8000-000000000607', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000501', '3b000000-0000-4000-8000-000000000501', 'Role Delete Active', 'qualifying', null, 0, 7000, array[]::text[]),
  ('3b000000-0000-4000-8000-000000000608', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000501', '3b000000-0000-4000-8000-000000000501', 'Direct Role Guard Active', 'qualifying', null, 0, 8000, array[]::text[]),
  ('3b000000-0000-4000-8000-000000000609', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000501', '3b000000-0000-4000-8000-000000000501', 'Direct User Role Guard Active', 'qualifying', null, 0, 9000, array[]::text[]),
  ('3b000000-0000-4000-8000-000000000610', '3b000000-0000-4000-8000-000000000001', '3b000000-0000-4000-8000-000000000501', '3b000000-0000-4000-8000-000000000501', 'Unrelated Resolution Extra', 'qualifying', null, 0, 10000, array[]::text[]);

select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);
select set_config('request.jwt.claim.role', 'service_role', true);

do $fixture_assignments$
declare
  v_fixture record;
  v_result jsonb;
begin
  for v_fixture in
    select *
      from (values
        ('3b000000-0000-4000-8000-000000000601'::uuid, '3b000000-0000-4000-8000-000000000110'::uuid),
        ('3b000000-0000-4000-8000-000000000602'::uuid, '3b000000-0000-4000-8000-000000000110'::uuid),
        ('3b000000-0000-4000-8000-000000000603'::uuid, '3b000000-0000-4000-8000-000000000111'::uuid),
        ('3b000000-0000-4000-8000-000000000604'::uuid, '3b000000-0000-4000-8000-000000000112'::uuid),
        ('3b000000-0000-4000-8000-000000000605'::uuid, '3b000000-0000-4000-8000-000000000112'::uuid),
        ('3b000000-0000-4000-8000-000000000606'::uuid, '3b000000-0000-4000-8000-000000000115'::uuid),
        ('3b000000-0000-4000-8000-000000000607'::uuid, '3b000000-0000-4000-8000-000000000116'::uuid),
        ('3b000000-0000-4000-8000-000000000608'::uuid, '3b000000-0000-4000-8000-000000000117'::uuid),
        ('3b000000-0000-4000-8000-000000000609'::uuid, '3b000000-0000-4000-8000-000000000118'::uuid)
      ) fixture(opportunity_id, target_user_id)
     order by opportunity_id
  loop
    v_result := public.change_opportunity_assignment_as_system(
      p_opportunity_id => v_fixture.opportunity_id,
      p_expected_assignment_version => 0,
      p_expected_assigned_to => null,
      p_new_assigned_to => v_fixture.target_user_id,
      p_system_source => 'system_repair',
      p_actor_user_id => null,
      p_suggestion_id => null,
      p_metadata => jsonb_build_object('contract_fixture', true)
    );

    if not coalesce((v_result ->> 'ok')::boolean, false)
      or coalesce((v_result ->> 'conflict')::boolean, true)
      or (v_result ->> 'assignment_version')::bigint <> 1
    then
      raise exception 'fixture_assignment_failed: %', v_fixture.opportunity_id;
    end if;
  end loop;
end;
$fixture_assignments$;

-- Authorization and immutable-target failures occur before any write.
do $authorization_failures$
declare
  v_message text;
begin
  begin
    perform public.replace_role_permissions_as_system(
      '3b000000-0000-4000-8000-000000000102',
      '3b000000-0000-4000-8000-000000000302',
      private.canonical_role_permission_snapshot(
        '3b000000-0000-4000-8000-000000000302'
      ),
      (select payload from lead_permission_contract_payloads where payload_name = 'none'),
      '[]'::jsonb
    );
    raise exception 'inactive_actor_unexpectedly_allowed';
  exception
    when insufficient_privilege then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'access_denied' then
        raise;
      end if;
  end;

  insert into lead_permission_contract_results (check_name, passed)
  values ('inactive_actor_rejected', true);

  begin
    perform public.replace_role_permissions_as_system(
      '3b000000-0000-4000-8000-000000000101',
      '00000000-0000-0000-0000-000000000004',
      private.canonical_role_permission_snapshot(
        '00000000-0000-0000-0000-000000000004'
      ),
      (select payload from lead_permission_contract_payloads where payload_name = 'none'),
      '[]'::jsonb
    );
    raise exception 'preset_role_unexpectedly_allowed';
  exception
    when insufficient_privilege then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'preset_role_immutable' then
        raise;
      end if;
  end;

  insert into lead_permission_contract_results (check_name, passed)
  values ('preset_role_rejected', true);

  begin
    perform public.apply_user_permission_overrides_as_system(
      '3b000000-0000-4000-8000-000000000101',
      '3b000000-0000-4000-8000-000000000103',
      '[]'::jsonb,
      '[]'::jsonb,
      array[]::text[],
      '[]'::jsonb
    );
    raise exception 'admin_target_unexpectedly_allowed';
  exception
    when insufficient_privilege then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'target_is_admin' then
        raise;
      end if;
  end;

  insert into lead_permission_contract_results (check_name, passed)
  values ('target_is_admin', true);

  begin
    perform public.apply_user_permission_overrides_as_system(
      '3b000000-0000-4000-8000-000000000101',
      '3b000000-0000-4000-8000-000000000201',
      private.canonical_user_override_snapshot(
        '3b000000-0000-4000-8000-000000000201'
      ),
      '[]'::jsonb,
      array[]::text[],
      '[]'::jsonb
    );
    raise exception 'cross_company_target_unexpectedly_allowed';
  exception
    when insufficient_privilege then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'access_denied' then
        raise;
      end if;
  end;

  insert into lead_permission_contract_results (check_name, passed)
  values ('cross_company_target_rejected', true);

  begin
    perform public.replace_user_role_as_system(
      '3b000000-0000-4000-8000-000000000101',
      '3b000000-0000-4000-8000-000000000112',
      '3b000000-0000-4000-8000-000000000312',
      '3b000000-0000-4000-8000-000000000390',
      '[]'::jsonb
    );
    raise exception 'cross_company_role_unexpectedly_allowed';
  exception
    when insufficient_privilege then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'cross_company_role_forbidden' then
        raise;
      end if;
  end;

  insert into lead_permission_contract_results (check_name, passed)
  values ('cross_company_role_rejected', true);
end;
$authorization_failures$;

-- Stale snapshots and invalid dependency graphs are transactionally no-write.
do $snapshot_and_dependency_failures$
declare
  v_before jsonb;
  v_after jsonb;
  v_event_count bigint;
  v_delivery_count bigint;
  v_message text;
begin
  v_before := private.canonical_role_permission_snapshot(
    '3b000000-0000-4000-8000-000000000312'
  );
  select count(*) into v_event_count
    from public.opportunity_assignment_events;
  select count(*) into v_delivery_count
    from public.opportunity_assignment_deliveries;

  begin
    perform public.replace_role_permissions_as_system(
      '3b000000-0000-4000-8000-000000000101',
      '3b000000-0000-4000-8000-000000000312',
      '[]'::jsonb,
      (select payload from lead_permission_contract_payloads where payload_name = 'none'),
      '[]'::jsonb
    );
    raise exception 'stale_snapshot_unexpectedly_allowed';
  exception
    when serialization_failure then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'permission_snapshot_mismatch' then
        raise;
      end if;
  end;

  v_after := private.canonical_role_permission_snapshot(
    '3b000000-0000-4000-8000-000000000312'
  );
  insert into lead_permission_contract_results (check_name, passed)
  values (
    'permission_snapshot_mismatch',
    v_after = v_before
    and (select count(*) from public.opportunity_assignment_events) = v_event_count
    and (select count(*) from public.opportunity_assignment_deliveries) = v_delivery_count
  );

  begin
    perform public.replace_role_permissions_as_system(
      '3b000000-0000-4000-8000-000000000101',
      '3b000000-0000-4000-8000-000000000312',
      v_before,
      (select payload from lead_permission_contract_payloads where payload_name = 'invalid_edit_all'),
      '[]'::jsonb
    );
    raise exception 'invalid_dependency_unexpectedly_allowed';
  exception
    when invalid_parameter_value then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'invalid_permission_dependencies' then
        raise;
      end if;
  end;

  insert into lead_permission_contract_results (check_name, passed)
  values (
    'invalid_permission_dependencies',
    private.canonical_role_permission_snapshot(
      '3b000000-0000-4000-8000-000000000312'
    ) = v_before
    and (select count(*) from public.opportunity_assignment_events) = v_event_count
    and (select count(*) from public.opportunity_assignment_deliveries) = v_delivery_count
  );

  -- The role itself is valid, but the explicit member revoke makes the final
  -- edit grant invalid. This proves every member and override is evaluated.
  v_before := private.canonical_role_permission_snapshot(
    '3b000000-0000-4000-8000-000000000313'
  );
  begin
    perform public.replace_role_permissions_as_system(
      '3b000000-0000-4000-8000-000000000101',
      '3b000000-0000-4000-8000-000000000313',
      v_before,
      (select payload from lead_permission_contract_payloads where payload_name = 'view_edit_assigned'),
      '[]'::jsonb
    );
    raise exception 'member_override_dependency_unexpectedly_allowed';
  exception
    when invalid_parameter_value then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'invalid_permission_dependencies' then
        raise;
      end if;
  end;

  insert into lead_permission_contract_results (check_name, passed)
  values (
    'role_edit_validates_every_member_and_override',
    private.canonical_role_permission_snapshot(
      '3b000000-0000-4000-8000-000000000313'
    ) = v_before
    and not exists (
      select 1
        from public.role_permissions rp
       where rp.role_id = '3b000000-0000-4000-8000-000000000313'::uuid
         and rp.permission = 'pipeline.edit'
    )
  );
end;
$snapshot_and_dependency_failures$;

-- Removing the last assigned-view scope without an exact plan is a structured
-- conflict and leaves permissions, assignments, history, and delivery rows as-is.
do $stranding_requires_resolution$
declare
  v_before jsonb;
  v_event_count bigint;
  v_delivery_count bigint;
  v_message text;
begin
  v_before := private.canonical_role_permission_snapshot(
    '3b000000-0000-4000-8000-000000000312'
  );
  select count(*) into v_event_count
    from public.opportunity_assignment_events;
  select count(*) into v_delivery_count
    from public.opportunity_assignment_deliveries;

  begin
    perform public.replace_role_permissions_as_system(
      '3b000000-0000-4000-8000-000000000101',
      '3b000000-0000-4000-8000-000000000312',
      v_before,
      (select payload from lead_permission_contract_payloads where payload_name = 'none'),
      '[]'::jsonb
    );
    raise exception 'stranding_without_resolution_unexpectedly_allowed';
  exception
    when serialization_failure then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'assignment_resolution_required' then
        raise;
      end if;
  end;

  insert into lead_permission_contract_results (check_name, passed)
  values (
    'assignment_resolution_required',
    private.canonical_role_permission_snapshot(
      '3b000000-0000-4000-8000-000000000312'
    ) = v_before
    and (
      select count(*) = 2
        from public.opportunities o
       where o.id in (
         '3b000000-0000-4000-8000-000000000604'::uuid,
         '3b000000-0000-4000-8000-000000000605'::uuid
       )
         and o.assigned_to = '3b000000-0000-4000-8000-000000000112'::uuid
         and o.assignment_version = 1
    )
    and (select count(*) from public.opportunity_assignment_events) = v_event_count
    and (select count(*) from public.opportunity_assignment_deliveries) = v_delivery_count
  );
end;
$stranding_requires_resolution$;

-- Exact unassign: permission reduction and one guarded assignment event commit
-- together; the won lead remains historical and assigned.
do $exact_unassign$
declare
  v_result jsonb;
  v_before_events bigint;
begin
  select count(*) into v_before_events
    from public.opportunity_assignment_events
   where opportunity_id = '3b000000-0000-4000-8000-000000000601'::uuid;

  v_result := public.replace_role_permissions_as_system(
    '3b000000-0000-4000-8000-000000000101',
    '3b000000-0000-4000-8000-000000000310',
    private.canonical_role_permission_snapshot(
      '3b000000-0000-4000-8000-000000000310'
    ),
    (select payload from lead_permission_contract_payloads where payload_name = 'none'),
    jsonb_build_array(jsonb_build_object(
      'opportunity_id', '3b000000-0000-4000-8000-000000000601',
      'expected_assigned_to', '3b000000-0000-4000-8000-000000000110',
      'expected_assignment_version', 1,
      'new_assigned_to', null
    ))
  );

  insert into lead_permission_contract_results (check_name, passed)
  values (
    'exact_unassign_succeeds',
    coalesce((v_result ->> 'ok')::boolean, false)
    and (v_result ->> 'resolved_assignments')::integer = 1
    and private.canonical_role_permission_snapshot(
      '3b000000-0000-4000-8000-000000000310'
    ) = '[]'::jsonb
    and exists (
      select 1
        from public.opportunities o
       where o.id = '3b000000-0000-4000-8000-000000000601'::uuid
         and o.assigned_to is null
         and o.assignment_version = 2
    )
    and (
      select count(*) = v_before_events + 1
        from public.opportunity_assignment_events e
       where e.opportunity_id = '3b000000-0000-4000-8000-000000000601'::uuid
    )
    and exists (
      select 1
        from public.opportunity_assignment_events e
       where e.opportunity_id = '3b000000-0000-4000-8000-000000000601'::uuid
         and e.assignment_version = 2
         and e.source = 'permission_change'
         and e.actor_user_id = '3b000000-0000-4000-8000-000000000101'::uuid
         and e.metadata ->> 'mutation_kind' = 'role_permissions'
         and e.metadata ->> 'disposition' = 'unassign'
    )
    and exists (
      select 1
        from public.opportunity_assignment_deliveries d
        join public.opportunity_assignment_events e
          on e.id = d.assignment_event_id
       where e.opportunity_id = '3b000000-0000-4000-8000-000000000601'::uuid
         and e.assignment_version = 2
         and d.recipient_user_id = '3b000000-0000-4000-8000-000000000110'::uuid
         and not d.access_after
    )
  );

  insert into lead_permission_contract_results (check_name, passed)
  values (
    'terminal_assignment_retained',
    exists (
      select 1
        from public.opportunities o
       where o.id = '3b000000-0000-4000-8000-000000000602'::uuid
         and o.stage = 'won'
         and o.assigned_to = '3b000000-0000-4000-8000-000000000110'::uuid
         and o.assignment_version = 1
    )
    and not exists (
      select 1
        from public.opportunity_assignment_events e
       where e.opportunity_id = '3b000000-0000-4000-8000-000000000602'::uuid
         and e.source = 'permission_change'
    )
  );
end;
$exact_unassign$;

-- Exact transfer: the destination is evaluated after the proposed role edit
-- and receives one durable delivery alongside the previous assignee.
do $exact_transfer$
declare
  v_result jsonb;
  v_before_events bigint;
begin
  select count(*) into v_before_events
    from public.opportunity_assignment_events
   where opportunity_id = '3b000000-0000-4000-8000-000000000603'::uuid;

  v_result := public.replace_role_permissions_as_system(
    '3b000000-0000-4000-8000-000000000101',
    '3b000000-0000-4000-8000-000000000311',
    private.canonical_role_permission_snapshot(
      '3b000000-0000-4000-8000-000000000311'
    ),
    (select payload from lead_permission_contract_payloads where payload_name = 'none'),
    jsonb_build_array(jsonb_build_object(
      'opportunity_id', '3b000000-0000-4000-8000-000000000603',
      'expected_assigned_to', '3b000000-0000-4000-8000-000000000111',
      'expected_assignment_version', 1,
      'new_assigned_to', '3b000000-0000-4000-8000-000000000104'
    ))
  );

  insert into lead_permission_contract_results (check_name, passed)
  values (
    'exact_transfer_succeeds',
    coalesce((v_result ->> 'ok')::boolean, false)
    and (v_result ->> 'resolved_assignments')::integer = 1
    and exists (
      select 1
        from public.opportunities o
       where o.id = '3b000000-0000-4000-8000-000000000603'::uuid
         and o.assigned_to = '3b000000-0000-4000-8000-000000000104'::uuid
         and o.assignment_version = 2
    )
    and (
      select count(*) = v_before_events + 1
        from public.opportunity_assignment_events e
       where e.opportunity_id = '3b000000-0000-4000-8000-000000000603'::uuid
    )
    and exists (
      select 1
        from public.opportunity_assignment_events e
       where e.opportunity_id = '3b000000-0000-4000-8000-000000000603'::uuid
         and e.assignment_version = 2
         and e.source = 'permission_change'
         and e.metadata ->> 'disposition' = 'transfer'
    )
    and (
      select count(*) = 2
        from public.opportunity_assignment_deliveries d
        join public.opportunity_assignment_events e
          on e.id = d.assignment_event_id
       where e.opportunity_id = '3b000000-0000-4000-8000-000000000603'::uuid
         and e.assignment_version = 2
         and d.recipient_user_id in (
           '3b000000-0000-4000-8000-000000000111'::uuid,
           '3b000000-0000-4000-8000-000000000104'::uuid
         )
    )
  );
end;
$exact_transfer$;

-- Override SET and CLEAR are both one-shot atomic calls. Clearing the final
-- assigned-view override uses the same exact responsibility resolution path.
do $override_set_clear$
declare
  v_original jsonb;
  v_result jsonb;
begin
  v_original := private.canonical_user_override_snapshot(
    '3b000000-0000-4000-8000-000000000115'
  );

  v_result := public.apply_user_permission_overrides_as_system(
    '3b000000-0000-4000-8000-000000000101',
    '3b000000-0000-4000-8000-000000000115',
    v_original,
    jsonb_build_array(jsonb_build_object(
      'permission', 'notifications.view',
      'scope', 'own',
      'granted', true
    )),
    array[]::text[],
    '[]'::jsonb
  );

  if not coalesce((v_result ->> 'ok')::boolean, false) then
    raise exception 'override_set_failed';
  end if;

  v_result := public.apply_user_permission_overrides_as_system(
    '3b000000-0000-4000-8000-000000000101',
    '3b000000-0000-4000-8000-000000000115',
    private.canonical_user_override_snapshot(
      '3b000000-0000-4000-8000-000000000115'
    ),
    '[]'::jsonb,
    array['notifications.view'],
    '[]'::jsonb
  );

  insert into lead_permission_contract_results (check_name, passed)
  values (
    'override_set_clear_atomic',
    coalesce((v_result ->> 'ok')::boolean, false)
    and private.canonical_user_override_snapshot(
      '3b000000-0000-4000-8000-000000000115'
    ) = v_original
  );

  v_result := public.apply_user_permission_overrides_as_system(
    '3b000000-0000-4000-8000-000000000101',
    '3b000000-0000-4000-8000-000000000115',
    v_original,
    '[]'::jsonb,
    array['pipeline.view'],
    jsonb_build_array(jsonb_build_object(
      'opportunity_id', '3b000000-0000-4000-8000-000000000606',
      'expected_assigned_to', '3b000000-0000-4000-8000-000000000115',
      'expected_assignment_version', 1,
      'new_assigned_to', null
    ))
  );

  insert into lead_permission_contract_results (check_name, passed)
  values (
    'override_resolution_is_atomic',
    coalesce((v_result ->> 'ok')::boolean, false)
    and (v_result ->> 'resolved_assignments')::integer = 1
    and private.canonical_user_override_snapshot(
      '3b000000-0000-4000-8000-000000000115'
    ) = '[]'::jsonb
    and exists (
      select 1
        from public.opportunities o
       where o.id = '3b000000-0000-4000-8000-000000000606'::uuid
         and o.assigned_to is null
         and o.assignment_version = 2
    )
    and exists (
      select 1
        from public.opportunity_assignment_events e
       where e.opportunity_id = '3b000000-0000-4000-8000-000000000606'::uuid
         and e.assignment_version = 2
         and e.source = 'permission_change'
         and e.metadata ->> 'mutation_kind' = 'user_overrides'
    )
  );
end;
$override_set_clear$;

-- Role removal is not a bypass. First prove the no-plan request is no-write,
-- then prove exact unassignment updates user_roles and users.role together.
do $role_delete_guard$
declare
  v_message text;
  v_result jsonb;
begin
  begin
    perform public.replace_user_role_as_system(
      '3b000000-0000-4000-8000-000000000101',
      '3b000000-0000-4000-8000-000000000116',
      '3b000000-0000-4000-8000-000000000315',
      null,
      '[]'::jsonb
    );
    raise exception 'role_delete_without_resolution_unexpectedly_allowed';
  exception
    when serialization_failure then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'assignment_resolution_required' then
        raise;
      end if;
  end;

  insert into lead_permission_contract_results (check_name, passed)
  values (
    'role_delete_cannot_strand',
    exists (
      select 1
        from public.user_roles ur
       where ur.user_id = '3b000000-0000-4000-8000-000000000116'
         and ur.role_id = '3b000000-0000-4000-8000-000000000315'::uuid
    )
    and exists (
      select 1
        from public.opportunities o
       where o.id = '3b000000-0000-4000-8000-000000000607'::uuid
         and o.assigned_to = '3b000000-0000-4000-8000-000000000116'::uuid
         and o.assignment_version = 1
    )
  );

  v_result := public.replace_user_role_as_system(
    '3b000000-0000-4000-8000-000000000101',
    '3b000000-0000-4000-8000-000000000116',
    '3b000000-0000-4000-8000-000000000315',
    null,
    jsonb_build_array(jsonb_build_object(
      'opportunity_id', '3b000000-0000-4000-8000-000000000607',
      'expected_assigned_to', '3b000000-0000-4000-8000-000000000116',
      'expected_assignment_version', 1,
      'new_assigned_to', null
    ))
  );

  insert into lead_permission_contract_results (check_name, passed)
  values (
    'role_delete_exact_resolution_succeeds',
    coalesce((v_result ->> 'ok')::boolean, false)
    and not exists (
      select 1
        from public.user_roles ur
       where ur.user_id = '3b000000-0000-4000-8000-000000000116'
    )
    and exists (
      select 1
        from public.users u
       where u.id = '3b000000-0000-4000-8000-000000000116'::uuid
         and u.role = 'unassigned'
    )
    and exists (
      select 1
        from public.opportunities o
       where o.id = '3b000000-0000-4000-8000-000000000607'::uuid
         and o.assigned_to is null
         and o.assignment_version = 2
    )
  );
end;
$role_delete_guard$;

-- Exact-set validation rejects omissions, extras, duplicates, and no-op rows
-- before any guarded assignment call can persist.
do $resolution_shape_failures$
declare
  v_role_before jsonb;
  v_events_before bigint;
  v_deliveries_before bigint;
  v_missing boolean := false;
  v_extra boolean := false;
  v_duplicate boolean := false;
  v_noop boolean := false;
  v_cross_company boolean := false;
  v_message text;
begin
  v_role_before := private.canonical_role_permission_snapshot(
    '3b000000-0000-4000-8000-000000000312'
  );
  select count(*) into v_events_before
    from public.opportunity_assignment_events;
  select count(*) into v_deliveries_before
    from public.opportunity_assignment_deliveries;

  begin
    perform public.replace_role_permissions_as_system(
      '3b000000-0000-4000-8000-000000000101',
      '3b000000-0000-4000-8000-000000000312',
      v_role_before,
      (select payload from lead_permission_contract_payloads where payload_name = 'none'),
      jsonb_build_array(jsonb_build_object(
        'opportunity_id', '3b000000-0000-4000-8000-000000000604',
        'expected_assigned_to', '3b000000-0000-4000-8000-000000000112',
        'expected_assignment_version', 1,
        'new_assigned_to', null
      ))
    );
  exception
    when invalid_parameter_value then
      get stacked diagnostics v_message = message_text;
      v_missing := v_message = 'missing_resolution';
  end;

  begin
    perform public.replace_role_permissions_as_system(
      '3b000000-0000-4000-8000-000000000101',
      '3b000000-0000-4000-8000-000000000312',
      v_role_before,
      (select payload from lead_permission_contract_payloads where payload_name = 'none'),
      jsonb_build_array(
        jsonb_build_object(
          'opportunity_id', '3b000000-0000-4000-8000-000000000604',
          'expected_assigned_to', '3b000000-0000-4000-8000-000000000112',
          'expected_assignment_version', 1,
          'new_assigned_to', null
        ),
        jsonb_build_object(
          'opportunity_id', '3b000000-0000-4000-8000-000000000605',
          'expected_assigned_to', '3b000000-0000-4000-8000-000000000112',
          'expected_assignment_version', 1,
          'new_assigned_to', null
        ),
        jsonb_build_object(
          'opportunity_id', '3b000000-0000-4000-8000-000000000610',
          'expected_assigned_to', '3b000000-0000-4000-8000-000000000101',
          'expected_assignment_version', 0,
          'new_assigned_to', null
        )
      )
    );
  exception
    when invalid_parameter_value then
      get stacked diagnostics v_message = message_text;
      v_extra := v_message = 'extra_resolution';
  end;

  begin
    perform public.replace_role_permissions_as_system(
      '3b000000-0000-4000-8000-000000000101',
      '3b000000-0000-4000-8000-000000000312',
      v_role_before,
      (select payload from lead_permission_contract_payloads where payload_name = 'none'),
      jsonb_build_array(
        jsonb_build_object(
          'opportunity_id', '3b000000-0000-4000-8000-000000000604',
          'expected_assigned_to', '3b000000-0000-4000-8000-000000000112',
          'expected_assignment_version', 1,
          'new_assigned_to', null
        ),
        jsonb_build_object(
          'opportunity_id', '3b000000-0000-4000-8000-000000000604',
          'expected_assigned_to', '3b000000-0000-4000-8000-000000000112',
          'expected_assignment_version', 1,
          'new_assigned_to', null
        ),
        jsonb_build_object(
          'opportunity_id', '3b000000-0000-4000-8000-000000000605',
          'expected_assigned_to', '3b000000-0000-4000-8000-000000000112',
          'expected_assignment_version', 1,
          'new_assigned_to', null
        )
      )
    );
  exception
    when invalid_parameter_value then
      get stacked diagnostics v_message = message_text;
      v_duplicate := v_message = 'duplicate_resolution';
  end;

  begin
    perform public.replace_role_permissions_as_system(
      '3b000000-0000-4000-8000-000000000101',
      '3b000000-0000-4000-8000-000000000312',
      v_role_before,
      (select payload from lead_permission_contract_payloads where payload_name = 'none'),
      jsonb_build_array(jsonb_build_object(
        'opportunity_id', '3b000000-0000-4000-8000-000000000604',
        'expected_assigned_to', '3b000000-0000-4000-8000-000000000112',
        'expected_assignment_version', 1,
        'new_assigned_to', '3b000000-0000-4000-8000-000000000112'
      ))
    );
  exception
    when invalid_parameter_value then
      get stacked diagnostics v_message = message_text;
      v_noop := v_message = 'no_op_resolution';
  end;

  begin
    perform public.replace_role_permissions_as_system(
      '3b000000-0000-4000-8000-000000000101',
      '3b000000-0000-4000-8000-000000000312',
      v_role_before,
      (select payload from lead_permission_contract_payloads where payload_name = 'none'),
      jsonb_build_array(
        jsonb_build_object(
          'opportunity_id', '3b000000-0000-4000-8000-000000000604',
          'expected_assigned_to', '3b000000-0000-4000-8000-000000000112',
          'expected_assignment_version', 1,
          'new_assigned_to', '3b000000-0000-4000-8000-000000000201'
        ),
        jsonb_build_object(
          'opportunity_id', '3b000000-0000-4000-8000-000000000605',
          'expected_assigned_to', '3b000000-0000-4000-8000-000000000112',
          'expected_assignment_version', 1,
          'new_assigned_to', '3b000000-0000-4000-8000-000000000201'
        )
      )
    );
  exception
    when invalid_parameter_value then
      get stacked diagnostics v_message = message_text;
      v_cross_company := v_message = 'assignment_target_ineligible';
  end;

  insert into lead_permission_contract_results (check_name, passed)
  values
    ('missing_resolution_rejected', v_missing),
    ('extra_resolution_rejected', v_extra),
    ('duplicate_resolution_rejected', v_duplicate),
    ('no_op_resolution_rejected', v_noop),
    (
      'cross_company_transfer_rejected',
      v_cross_company
      and private.canonical_role_permission_snapshot(
        '3b000000-0000-4000-8000-000000000312'
      ) = v_role_before
      and (select count(*) from public.opportunity_assignment_events) = v_events_before
      and (select count(*) from public.opportunity_assignment_deliveries) = v_deliveries_before
    );
end;
$resolution_shape_failures$;

-- Away-then-back changes the assignment version even though the assignee UUID
-- is identical again. A stale reviewed plan must roll back the permission edit.
do $aba_conflict$
declare
  v_result jsonb;
  v_role_before jsonb;
  v_events_before bigint;
  v_message text;
begin
  v_result := public.change_opportunity_assignment_as_system(
    '3b000000-0000-4000-8000-000000000604',
    1,
    '3b000000-0000-4000-8000-000000000112',
    '3b000000-0000-4000-8000-000000000104',
    'system_repair',
    null,
    null,
    jsonb_build_object('contract_aba', 'away')
  );
  if (v_result ->> 'assignment_version')::bigint <> 2 then
    raise exception 'aba_away_setup_failed';
  end if;

  v_result := public.change_opportunity_assignment_as_system(
    '3b000000-0000-4000-8000-000000000604',
    2,
    '3b000000-0000-4000-8000-000000000104',
    '3b000000-0000-4000-8000-000000000112',
    'system_repair',
    null,
    null,
    jsonb_build_object('contract_aba', 'back')
  );
  if (v_result ->> 'assignment_version')::bigint <> 3 then
    raise exception 'aba_back_setup_failed';
  end if;

  v_role_before := private.canonical_role_permission_snapshot(
    '3b000000-0000-4000-8000-000000000312'
  );
  select count(*) into v_events_before
    from public.opportunity_assignment_events;

  begin
    perform public.replace_role_permissions_as_system(
      '3b000000-0000-4000-8000-000000000101',
      '3b000000-0000-4000-8000-000000000312',
      v_role_before,
      (select payload from lead_permission_contract_payloads where payload_name = 'none'),
      jsonb_build_array(
        jsonb_build_object(
          'opportunity_id', '3b000000-0000-4000-8000-000000000604',
          'expected_assigned_to', '3b000000-0000-4000-8000-000000000112',
          'expected_assignment_version', 1,
          'new_assigned_to', null
        ),
        jsonb_build_object(
          'opportunity_id', '3b000000-0000-4000-8000-000000000605',
          'expected_assigned_to', '3b000000-0000-4000-8000-000000000112',
          'expected_assignment_version', 1,
          'new_assigned_to', null
        )
      )
    );
    raise exception 'aba_resolution_unexpectedly_allowed';
  exception
    when serialization_failure then
      get stacked diagnostics v_message = message_text;
      if v_message <> 'assignment_resolution_conflict' then
        raise;
      end if;
  end;

  insert into lead_permission_contract_results (check_name, passed)
  values (
    'assignment_aba_conflict',
    private.canonical_role_permission_snapshot(
      '3b000000-0000-4000-8000-000000000312'
    ) = v_role_before
    and exists (
      select 1
        from public.opportunities o
       where o.id = '3b000000-0000-4000-8000-000000000604'::uuid
         and o.assigned_to = '3b000000-0000-4000-8000-000000000112'::uuid
         and o.assignment_version = 3
    )
    and exists (
      select 1
        from public.opportunities o
       where o.id = '3b000000-0000-4000-8000-000000000605'::uuid
         and o.assigned_to = '3b000000-0000-4000-8000-000000000112'::uuid
         and o.assignment_version = 1
    )
    and (select count(*) from public.opportunity_assignment_events) = v_events_before
  );
end;
$aba_conflict$;

-- PATCH role replacement updates the normalized role row and legacy mirror in
-- the same transaction even when no assignment resolution is needed.
do $role_replacement$
declare
  v_result jsonb;
begin
  v_result := public.replace_user_role_as_system(
    '3b000000-0000-4000-8000-000000000101',
    '3b000000-0000-4000-8000-000000000113',
    '3b000000-0000-4000-8000-000000000313',
    '3b000000-0000-4000-8000-000000000302',
    '[]'::jsonb
  );

  insert into lead_permission_contract_results (check_name, passed)
  values (
    'role_replacement_atomic',
    coalesce((v_result ->> 'ok')::boolean, false)
    and exists (
      select 1
        from public.user_roles ur
       where ur.user_id = '3b000000-0000-4000-8000-000000000113'
         and ur.role_id = '3b000000-0000-4000-8000-000000000302'::uuid
    )
    and exists (
      select 1
        from public.users u
       where u.id = '3b000000-0000-4000-8000-000000000113'::uuid
         and u.role = 'unassigned'
    )
  );
end;
$role_replacement$;

-- Deferred constraint triggers make direct legacy table writes fail closed.
-- SET CONSTRAINTS forces the commit-time check inside a rollbackable block.
do $direct_write_guards$
declare
  v_role_guarded boolean := false;
  v_user_role_guarded boolean := false;
  v_message text;
begin
  begin
    delete from public.role_permissions rp
     where rp.role_id = '3b000000-0000-4000-8000-000000000316'::uuid
       and rp.permission = 'pipeline.view';
    execute 'set constraints trg_role_permissions_final_state immediate';
  exception
    when check_violation then
      get stacked diagnostics v_message = message_text;
      v_role_guarded := v_message = 'permission_change_would_strand_assignments';
  end;

  begin
    delete from public.user_roles ur
     where ur.user_id = '3b000000-0000-4000-8000-000000000118';
    execute 'set constraints trg_user_roles_final_state immediate';
  exception
    when check_violation then
      get stacked diagnostics v_message = message_text;
      v_user_role_guarded := v_message = 'permission_change_would_strand_assignments';
  end;

  insert into lead_permission_contract_results (check_name, passed)
  values (
    'direct_write_cannot_strand',
    v_role_guarded
    and v_user_role_guarded
    and exists (
      select 1
        from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.role_permissions'::regclass
         and t.tgname = 'trg_role_permissions_final_state'
         and t.tgdeferrable
         and t.tginitdeferred
    )
    and exists (
      select 1
        from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.user_permission_overrides'::regclass
         and t.tgname = 'trg_user_permission_overrides_final_state'
         and t.tgdeferrable
         and t.tginitdeferred
    )
    and exists (
      select 1
        from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.user_roles'::regclass
         and t.tgname = 'trg_user_roles_final_state'
         and t.tgdeferrable
         and t.tginitdeferred
    )
    and exists (
      select 1
        from public.role_permissions rp
       where rp.role_id = '3b000000-0000-4000-8000-000000000316'::uuid
         and rp.permission = 'pipeline.view'
    )
    and exists (
      select 1
        from public.user_roles ur
       where ur.user_id = '3b000000-0000-4000-8000-000000000118'
         and ur.role_id = '3b000000-0000-4000-8000-000000000317'::uuid
    )
  );
end;
$direct_write_guards$;

-- Every named contract case must have produced an affirmative result.
do $final_assertion$
declare
  v_failures text;
begin
  select string_agg(r.check_name || coalesce(': ' || r.details, ''), ', ' order by r.check_name)
    into v_failures
    from lead_permission_contract_results r
   where not r.passed;

  if v_failures is not null then
    raise exception 'lead_assignment_permission_contract_failed: %', v_failures;
  end if;

  if not exists (
    select 1 from lead_permission_contract_results where check_name = 'service_only_execution'
  )
    or not exists (
      select 1 from lead_permission_contract_results where check_name = 'assignment_resolution_required'
    )
    or not exists (
      select 1 from lead_permission_contract_results where check_name = 'exact_unassign_succeeds'
    )
    or not exists (
      select 1 from lead_permission_contract_results where check_name = 'exact_transfer_succeeds'
    )
    or not exists (
      select 1 from lead_permission_contract_results where check_name = 'assignment_aba_conflict'
    )
    or not exists (
      select 1 from lead_permission_contract_results where check_name = 'direct_write_cannot_strand'
    )
    or not exists (
      select 1 from lead_permission_contract_results where check_name = 'operator_not_activated'
    )
  then
    raise exception 'lead_assignment_permission_contract_case_missing';
  end if;
end;
$final_assertion$;

rollback;
