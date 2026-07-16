-- Lead assignment and guarded conversion SQL contract.
--
-- Run this only after the lead-assignment foundation migration has been
-- applied to an isolated database. Every fixture and side effect lives in one
-- transaction and the successful path ends with ROLLBACK. Any failed check
-- raises inside the transaction, so it can never be committed accidentally.

begin;

create temp table lead_assignment_contract_results (
  check_name text primary key,
  passed boolean not null,
  details text
) on commit drop;

create temp table lead_assignment_contract_values (
  value_name text primary key,
  value jsonb not null
) on commit drop;

grant select, insert, update on lead_assignment_contract_results
  to authenticated, service_role;
grant select, insert, update on lead_assignment_contract_values
  to authenticated, service_role;

-- Public API shape and grants. The legacy conversion overload must not remain,
-- because PostgREST cannot safely choose between the old and guarded forms.
insert into lead_assignment_contract_results (check_name, passed)
values
  (
    'guarded_assignment_rpc_signatures_and_grants',
    to_regprocedure(
      'public.change_opportunity_assignment(uuid,bigint,uuid,uuid,text,uuid,jsonb)'
    ) is not null
    and to_regprocedure(
      'public.change_opportunity_assignment_as_system(uuid,bigint,uuid,uuid,text,uuid,uuid,jsonb)'
    ) is not null
    and to_regprocedure(
      'public.create_opportunity_guarded(jsonb,text,uuid,jsonb)'
    ) is not null
    and has_function_privilege(
      'authenticated',
      'public.change_opportunity_assignment(uuid,bigint,uuid,uuid,text,uuid,jsonb)',
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'public.change_opportunity_assignment(uuid,bigint,uuid,uuid,text,uuid,jsonb)',
      'execute'
    )
    and has_function_privilege(
      'service_role',
      'public.change_opportunity_assignment_as_system(uuid,bigint,uuid,uuid,text,uuid,uuid,jsonb)',
      'execute'
    )
    and not has_function_privilege(
      'authenticated',
      'public.change_opportunity_assignment_as_system(uuid,bigint,uuid,uuid,text,uuid,uuid,jsonb)',
      'execute'
    )
  ),
  (
    'guarded_conversion_has_one_canonical_overload',
    to_regprocedure(
      'public.convert_opportunity_to_project(uuid,uuid,numeric,text,uuid,text,text,uuid,text,boolean,text,jsonb,bigint)'
    ) is not null
    and to_regprocedure(
      'public.convert_opportunity_to_project(uuid,uuid,numeric,text,uuid,text,text,uuid,text,boolean,text,jsonb)'
    ) is null
    and has_function_privilege(
      'authenticated',
      'public.convert_opportunity_to_project(uuid,uuid,numeric,text,uuid,text,text,uuid,text,boolean,text,jsonb,bigint)',
      'execute'
    )
    and has_function_privilege(
      'service_role',
      'public.convert_opportunity_to_project(uuid,uuid,numeric,text,uuid,text,text,uuid,text,boolean,text,jsonb,bigint)',
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'public.convert_opportunity_to_project(uuid,uuid,numeric,text,uuid,text,text,uuid,text,boolean,text,jsonb,bigint)',
      'execute'
    )
  ),
  (
    'actor_scoped_preflight_has_one_canonical_overload',
    to_regprocedure(
      'public.get_conversion_preflight(uuid,uuid,uuid)'
    ) is not null
    and to_regprocedure(
      'public.get_conversion_preflight(uuid,uuid)'
    ) is null
    and has_function_privilege(
      'authenticated',
      'public.get_conversion_preflight(uuid,uuid,uuid)',
      'execute'
    )
    and has_function_privilege(
      'service_role',
      'public.get_conversion_preflight(uuid,uuid,uuid)',
      'execute'
    )
    and not has_function_privilege(
      'anon',
      'public.get_conversion_preflight(uuid,uuid,uuid)',
      'execute'
    )
  ),
  (
    'assignment_audit_tables_are_rls_protected',
    coalesce((
      select bool_and(c.relrowsecurity)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in (
          'opportunity_assignment_events',
          'opportunity_assignment_deliveries',
          'opportunity_assignment_suggestions',
          'opportunity_conversion_events'
        )
    ), false)
    and (
      select count(*) = 4
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in (
          'opportunity_assignment_events',
          'opportunity_assignment_deliveries',
          'opportunity_assignment_suggestions',
          'opportunity_conversion_events'
        )
    )
    and not has_table_privilege(
      'authenticated', 'public.opportunity_assignment_events', 'update'
    )
    and not has_table_privilege(
      'service_role', 'public.opportunity_assignment_events', 'update'
    )
    and not has_table_privilege(
      'service_role', 'public.opportunity_assignment_deliveries', 'insert'
    )
  );

-- Fixed rollback-only principals.
insert into public.companies (
  id,
  bubble_id,
  name,
  subscription_status,
  subscription_plan
) values
  (
    '1ead5519-0000-4000-8000-000000000001',
    'lead-assignment-contract-company-a',
    'Lead Assignment Contract A',
    'trial',
    'trial'
  ),
  (
    '1ead5519-0000-4000-8000-000000000002',
    'lead-assignment-contract-company-b',
    'Lead Assignment Contract B',
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
    '1ead5519-0000-4000-8000-000000000101',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000901',
    '1ead5519-0000-4000-8000-000000000901',
    'Assigned', 'Actor',
    'lead-contract-assigned@example.invalid',
    false, true, null
  ),
  (
    '1ead5519-0000-4000-8000-000000000102',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000902',
    '1ead5519-0000-4000-8000-000000000902',
    'All', 'Actor',
    'lead-contract-all@example.invalid',
    false, true, null
  ),
  (
    '1ead5519-0000-4000-8000-000000000103',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000903',
    '1ead5519-0000-4000-8000-000000000903',
    'Eligible', 'Target',
    'lead-contract-target@example.invalid',
    false, true, null
  ),
  (
    '1ead5519-0000-4000-8000-000000000104',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000904',
    '1ead5519-0000-4000-8000-000000000904',
    'No View', 'Target',
    'lead-contract-no-view@example.invalid',
    false, true, null
  ),
  (
    '1ead5519-0000-4000-8000-000000000105',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000905',
    '1ead5519-0000-4000-8000-000000000905',
    'Inactive', 'Target',
    'lead-contract-inactive@example.invalid',
    false, false, null
  ),
  (
    '1ead5519-0000-4000-8000-000000000106',
    '1ead5519-0000-4000-8000-000000000002',
    '1ead5519-0000-4000-8000-000000000906',
    '1ead5519-0000-4000-8000-000000000906',
    'Cross Company', 'Target',
    'lead-contract-cross-company@example.invalid',
    false, true, null
  ),
  (
    '1ead5519-0000-4000-8000-000000000107',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000907',
    '1ead5519-0000-4000-8000-000000000907',
    'Legacy', 'Compatibility',
    'lead-contract-legacy@example.invalid',
    false, true, null
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
    '1ead5519-0000-4000-8000-000000000201',
    'Lead Contract Assigned',
    'Rollback-only assigned-scope contract role.',
    false,
    '1ead5519-0000-4000-8000-000000000001',
    4
  ),
  (
    '1ead5519-0000-4000-8000-000000000202',
    'Lead Contract All',
    'Rollback-only all-scope contract role.',
    false,
    '1ead5519-0000-4000-8000-000000000001',
    3
  ),
  (
    '1ead5519-0000-4000-8000-000000000203',
    'Lead Contract Eligible Target',
    'Rollback-only eligible target contract role.',
    false,
    '1ead5519-0000-4000-8000-000000000001',
    4
  ),
  (
    '1ead5519-0000-4000-8000-000000000204',
    'Lead Contract Cross Company',
    'Rollback-only cross-company target role.',
    false,
    '1ead5519-0000-4000-8000-000000000002',
    4
  ),
  (
    '1ead5519-0000-4000-8000-000000000205',
    'Lead Contract Legacy Compatibility',
    'Rollback-only legacy manage compatibility role.',
    false,
    '1ead5519-0000-4000-8000-000000000001',
    4
  );

insert into public.role_permissions (role_id, permission, scope)
values
  ('1ead5519-0000-4000-8000-000000000201', 'pipeline.create', 'all'),
  ('1ead5519-0000-4000-8000-000000000201', 'pipeline.view', 'assigned'),
  ('1ead5519-0000-4000-8000-000000000201', 'pipeline.edit', 'assigned'),
  ('1ead5519-0000-4000-8000-000000000201', 'pipeline.assign', 'assigned'),
  ('1ead5519-0000-4000-8000-000000000201', 'pipeline.convert', 'assigned'),
  ('1ead5519-0000-4000-8000-000000000201', 'projects.create', 'all'),
  ('1ead5519-0000-4000-8000-000000000201', 'projects.view', 'assigned'),
  ('1ead5519-0000-4000-8000-000000000201', 'projects.edit', 'assigned'),
  ('1ead5519-0000-4000-8000-000000000202', 'pipeline.create', 'all'),
  ('1ead5519-0000-4000-8000-000000000202', 'pipeline.view', 'all'),
  ('1ead5519-0000-4000-8000-000000000202', 'pipeline.edit', 'all'),
  ('1ead5519-0000-4000-8000-000000000202', 'pipeline.assign', 'all'),
  ('1ead5519-0000-4000-8000-000000000202', 'pipeline.convert', 'all'),
  ('1ead5519-0000-4000-8000-000000000202', 'pipeline.manage', 'all'),
  ('1ead5519-0000-4000-8000-000000000203', 'pipeline.view', 'assigned'),
  ('1ead5519-0000-4000-8000-000000000203', 'pipeline.assign', 'assigned'),
  ('1ead5519-0000-4000-8000-000000000204', 'pipeline.view', 'assigned'),
  ('1ead5519-0000-4000-8000-000000000205', 'pipeline.manage', 'all');

insert into public.user_roles (id, user_id, role_id)
values
  (
    '1ead5519-0000-4000-8000-000000000301',
    '1ead5519-0000-4000-8000-000000000101',
    '1ead5519-0000-4000-8000-000000000201'
  ),
  (
    '1ead5519-0000-4000-8000-000000000302',
    '1ead5519-0000-4000-8000-000000000102',
    '1ead5519-0000-4000-8000-000000000202'
  ),
  (
    '1ead5519-0000-4000-8000-000000000303',
    '1ead5519-0000-4000-8000-000000000103',
    '1ead5519-0000-4000-8000-000000000203'
  ),
  (
    '1ead5519-0000-4000-8000-000000000304',
    '1ead5519-0000-4000-8000-000000000105',
    '1ead5519-0000-4000-8000-000000000203'
  ),
  (
    '1ead5519-0000-4000-8000-000000000305',
    '1ead5519-0000-4000-8000-000000000106',
    '1ead5519-0000-4000-8000-000000000204'
  ),
  (
    '1ead5519-0000-4000-8000-000000000306',
    '1ead5519-0000-4000-8000-000000000107',
    '1ead5519-0000-4000-8000-000000000205'
  );

insert into public.user_permission_overrides (
  user_id, company_id, permission, scope, granted
) values (
  '1ead5519-0000-4000-8000-000000000107',
  '1ead5519-0000-4000-8000-000000000001',
  'pipeline.edit',
  null,
  true
);

insert into lead_assignment_contract_results (check_name, passed)
values (
  'inert_granular_override_blocks_only_its_legacy_compatibility_fallback',
  not private.should_use_pipeline_manage_compat(
    '1ead5519-0000-4000-8000-000000000107',
    '1ead5519-0000-4000-8000-000000000001',
    'pipeline.edit'
  )
  and private.should_use_pipeline_manage_compat(
    '1ead5519-0000-4000-8000-000000000107',
    '1ead5519-0000-4000-8000-000000000001',
    'pipeline.convert'
  )
);

insert into public.clients (id, company_id, name, email)
values (
  '1ead5519-0000-4000-8000-000000000401',
  '1ead5519-0000-4000-8000-000000000001',
  'Lead Assignment Contract Client',
  'lead-contract-client@example.invalid'
);

-- Ordinary null/version-zero inserts remain legal fixture setup. Every non-null
-- initial assignment below goes through the service-only guarded facade.
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
  (
    '1ead5519-0000-4000-8000-000000000501',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000401',
    'Transfer Contract Lead',
    'qualifying', null, 0, 12000, array[]::text[]
  ),
  (
    '1ead5519-0000-4000-8000-000000000502',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000401',
    'Terminal Contract Lead',
    'won', null, 0, 18000, array[]::text[]
  ),
  (
    '1ead5519-0000-4000-8000-000000000503',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000401',
    'Eligibility Contract Lead',
    'quoting', null, 0, 9000, array[]::text[]
  ),
  (
    '1ead5519-0000-4000-8000-000000000504',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000401',
    'Conversion Contract Lead',
    'quoting', null, 0, 25000,
    array['https://example.invalid/lead-contract-photo.jpg']::text[]
  ),
  (
    '1ead5519-0000-4000-8000-000000000505',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000401',
    'Forged Project Link Contract Lead',
    'qualifying', null, 0, 7000, array[]::text[]
  );

select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

insert into lead_assignment_contract_values (value_name, value)
select fixture_name, public.change_opportunity_assignment_as_system(
  opportunity_id,
  0,
  null,
  '1ead5519-0000-4000-8000-000000000101',
  'system_repair',
  null,
  null,
  jsonb_build_object('contract_fixture', fixture_name)
)
from (values
  ('setup_transfer', '1ead5519-0000-4000-8000-000000000501'::uuid),
  ('setup_terminal', '1ead5519-0000-4000-8000-000000000502'::uuid),
  ('setup_eligibility', '1ead5519-0000-4000-8000-000000000503'::uuid),
  ('setup_conversion', '1ead5519-0000-4000-8000-000000000504'::uuid),
  ('setup_forged_project', '1ead5519-0000-4000-8000-000000000505'::uuid)
) as fixtures(fixture_name, opportunity_id);

reset role;

insert into lead_assignment_contract_results (check_name, passed)
select
  'service_guarded_fixture_assignments_succeeded',
  count(*) = 5
  and bool_and((value ->> 'ok')::boolean)
  and bool_and(not (value ->> 'conflict')::boolean)
  and bool_and((value ->> 'assignment_version')::bigint = 1)
  and bool_and((value ->> 'assigned_to')::uuid =
    '1ead5519-0000-4000-8000-000000000101'::uuid)
from lead_assignment_contract_values
where value_name like 'setup_%';

-- Assigned-scope actor: target validation, transfer limits, and a successful
-- active-lead handoff.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', '1ead5519-0000-4000-8000-000000000901',
    'email', 'lead-contract-assigned@example.invalid'
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '1ead5519-0000-4000-8000-000000000901',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $contract$
begin
  begin
    perform public.change_opportunity_assignment(
      '1ead5519-0000-4000-8000-000000000503',
      1,
      '1ead5519-0000-4000-8000-000000000101',
      '1ead5519-0000-4000-8000-000000000105',
      'manual',
      null,
      '{}'::jsonb
    );
    insert into lead_assignment_contract_results values (
      'inactive_assignment_target_rejected', false, 'call unexpectedly succeeded'
    );
  exception
    when sqlstate '22023' then
      insert into lead_assignment_contract_results values (
        'inactive_assignment_target_rejected',
        sqlerrm = 'assignment_target_ineligible',
        sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'inactive_assignment_target_rejected', false, sqlstate || ': ' || sqlerrm
      );
  end;

  begin
    perform public.change_opportunity_assignment(
      '1ead5519-0000-4000-8000-000000000503',
      1,
      '1ead5519-0000-4000-8000-000000000101',
      '1ead5519-0000-4000-8000-000000000104',
      'manual',
      null,
      '{}'::jsonb
    );
    insert into lead_assignment_contract_results values (
      'target_without_assigned_view_rejected', false, 'call unexpectedly succeeded'
    );
  exception
    when sqlstate '22023' then
      insert into lead_assignment_contract_results values (
        'target_without_assigned_view_rejected',
        sqlerrm = 'assignment_target_ineligible',
        sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'target_without_assigned_view_rejected', false, sqlstate || ': ' || sqlerrm
      );
  end;

  begin
    perform public.change_opportunity_assignment(
      '1ead5519-0000-4000-8000-000000000503',
      1,
      '1ead5519-0000-4000-8000-000000000101',
      '1ead5519-0000-4000-8000-000000000106',
      'manual',
      null,
      '{}'::jsonb
    );
    insert into lead_assignment_contract_results values (
      'cross_company_assignment_target_rejected', false, 'call unexpectedly succeeded'
    );
  exception
    when sqlstate '22023' then
      insert into lead_assignment_contract_results values (
        'cross_company_assignment_target_rejected',
        sqlerrm = 'assignment_target_ineligible',
        sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'cross_company_assignment_target_rejected', false, sqlstate || ': ' || sqlerrm
      );
  end;

  begin
    perform public.change_opportunity_assignment(
      '1ead5519-0000-4000-8000-000000000503',
      1,
      '1ead5519-0000-4000-8000-000000000101',
      null,
      'manual',
      null,
      '{}'::jsonb
    );
    insert into lead_assignment_contract_results values (
      'assigned_scope_cannot_unassign', false, 'call unexpectedly succeeded'
    );
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'assigned_scope_cannot_unassign',
        sqlerrm = 'assigned_scope_cannot_unassign',
        sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'assigned_scope_cannot_unassign', false, sqlstate || ': ' || sqlerrm
      );
  end;

  begin
    perform public.change_opportunity_assignment(
      '1ead5519-0000-4000-8000-000000000502',
      1,
      '1ead5519-0000-4000-8000-000000000101',
      '1ead5519-0000-4000-8000-000000000103',
      'manual',
      null,
      '{}'::jsonb
    );
    insert into lead_assignment_contract_results values (
      'assigned_scope_cannot_transfer_terminal_lead',
      false,
      'call unexpectedly succeeded'
    );
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'assigned_scope_cannot_transfer_terminal_lead',
        sqlerrm = 'assigned_scope_terminal_transfer_forbidden',
        sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'assigned_scope_cannot_transfer_terminal_lead',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;
end;
$contract$;

insert into lead_assignment_contract_values (value_name, value)
values (
  'assigned_scope_transfer',
  public.change_opportunity_assignment(
    '1ead5519-0000-4000-8000-000000000501',
    1,
    '1ead5519-0000-4000-8000-000000000101',
    '1ead5519-0000-4000-8000-000000000103',
    'manual',
    null,
    '{"contract_case":"assigned_transfer"}'::jsonb
  )
);

reset role;

insert into lead_assignment_contract_results (check_name, passed)
select
  'assigned_scope_active_transfer_succeeds',
  (value ->> 'ok')::boolean
  and not (value ->> 'conflict')::boolean
  and (value ->> 'assigned_to')::uuid =
    '1ead5519-0000-4000-8000-000000000103'::uuid
  and (value ->> 'assignment_version')::bigint = 2
  and (value ->> 'event_id') is not null
from lead_assignment_contract_values
where value_name = 'assigned_scope_transfer';

insert into lead_assignment_contract_results (check_name, passed)
values (
  'invalid_targets_and_forbidden_assigned_actions_leave_state_unchanged',
  exists (
    select 1
    from public.opportunities o
    where o.id = '1ead5519-0000-4000-8000-000000000503'
      and o.assigned_to = '1ead5519-0000-4000-8000-000000000101'
      and o.assignment_version = 1
  )
  and (
    select count(*) = 1
    from public.opportunity_assignment_events e
    where e.opportunity_id = '1ead5519-0000-4000-8000-000000000503'
  )
  and exists (
    select 1
    from public.opportunities o
    where o.id = '1ead5519-0000-4000-8000-000000000502'
      and o.assigned_to = '1ead5519-0000-4000-8000-000000000101'
      and o.assignment_version = 1
      and o.stage = 'won'
  )
);

-- The new recipient now owns the active lead and may perform a same-target
-- no-op. A stale assignee/version snapshot returns authoritative state without
-- adding history or deliveries.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', '1ead5519-0000-4000-8000-000000000903',
    'email', 'lead-contract-target@example.invalid'
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '1ead5519-0000-4000-8000-000000000903',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

insert into lead_assignment_contract_values (value_name, value)
values
  (
    'same_target_noop',
    public.change_opportunity_assignment(
      '1ead5519-0000-4000-8000-000000000501',
      2,
      '1ead5519-0000-4000-8000-000000000103',
      '1ead5519-0000-4000-8000-000000000103',
      'manual',
      null,
      '{}'::jsonb
    )
  ),
  (
    'stale_transfer_conflict',
    public.change_opportunity_assignment(
      '1ead5519-0000-4000-8000-000000000501',
      1,
      '1ead5519-0000-4000-8000-000000000101',
      '1ead5519-0000-4000-8000-000000000101',
      'manual',
      null,
      '{}'::jsonb
    )
  );

reset role;

insert into lead_assignment_contract_results (check_name, passed)
select
  'same_target_assignment_is_idempotent_noop',
  (value ->> 'ok')::boolean
  and not (value ->> 'conflict')::boolean
  and (value ->> 'assigned_to')::uuid =
    '1ead5519-0000-4000-8000-000000000103'::uuid
  and (value ->> 'assignment_version')::bigint = 2
  and value -> 'event_id' = 'null'::jsonb
from lead_assignment_contract_values
where value_name = 'same_target_noop';

insert into lead_assignment_contract_results (check_name, passed)
select
  'stale_assignment_snapshot_conflicts_without_mutation',
  not (value ->> 'ok')::boolean
  and (value ->> 'conflict')::boolean
  and (value ->> 'assigned_to')::uuid =
    '1ead5519-0000-4000-8000-000000000103'::uuid
  and (value ->> 'assignment_version')::bigint = 2
  and value -> 'event_id' = 'null'::jsonb
  and exists (
    select 1
    from public.opportunities o
    where o.id = '1ead5519-0000-4000-8000-000000000501'
      and o.assigned_to = '1ead5519-0000-4000-8000-000000000103'
      and o.assignment_version = 2
  )
  and (
    select count(*) = 2
    from public.opportunity_assignment_events e
    where e.opportunity_id = '1ead5519-0000-4000-8000-000000000501'
  )
from lead_assignment_contract_values
where value_name = 'stale_transfer_conflict';

insert into lead_assignment_contract_results (check_name, passed)
values (
  'assignment_event_has_two_addressed_deliveries',
  exists (
    select 1
    from public.opportunity_assignment_events e
    where e.id = (
      select (value ->> 'event_id')::uuid
      from lead_assignment_contract_values
      where value_name = 'assigned_scope_transfer'
    )
      and e.previous_assignee_id = '1ead5519-0000-4000-8000-000000000101'
      and e.new_assignee_id = '1ead5519-0000-4000-8000-000000000103'
      and e.actor_user_id = '1ead5519-0000-4000-8000-000000000101'
      and e.assignment_version = 2
      and e.source = 'manual'
  )
  and (
    select count(*) = 2
    from public.opportunity_assignment_deliveries d
    where d.assignment_event_id = (
      select (value ->> 'event_id')::uuid
      from lead_assignment_contract_values
      where value_name = 'assigned_scope_transfer'
    )
  )
  and exists (
    select 1
    from public.opportunity_assignment_deliveries d
    where d.assignment_event_id = (
      select (value ->> 'event_id')::uuid
      from lead_assignment_contract_values
      where value_name = 'assigned_scope_transfer'
    )
      and d.recipient_user_id = '1ead5519-0000-4000-8000-000000000101'
      and not d.access_after
      and not d.notify
  )
  and exists (
    select 1
    from public.opportunity_assignment_deliveries d
    where d.assignment_event_id = (
      select (value ->> 'event_id')::uuid
      from lead_assignment_contract_values
      where value_name = 'assigned_scope_transfer'
    )
      and d.recipient_user_id = '1ead5519-0000-4000-8000-000000000103'
      and d.access_after
      and d.notify
  )
);

-- The prior assignee retains assigned-scope capabilities but loses row access
-- immediately after handoff. Neither the assignment nor conversion facade may
-- authorize against the stale responsibility snapshot.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', '1ead5519-0000-4000-8000-000000000901',
    'email', 'lead-contract-assigned@example.invalid'
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '1ead5519-0000-4000-8000-000000000901',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

insert into lead_assignment_contract_results (check_name, passed)
values (
  'prior_assignee_retains_capability_but_not_lead_access',
  private.current_user_scope_for('pipeline.assign') = 'assigned'
  and private.current_user_scope_for('pipeline.convert') = 'assigned'
);

do $contract$
begin
  begin
    perform public.change_opportunity_assignment(
      '1ead5519-0000-4000-8000-000000000501',
      2,
      '1ead5519-0000-4000-8000-000000000103',
      '1ead5519-0000-4000-8000-000000000101',
      'manual',
      null,
      '{"contract_case":"prior_assignee_reassignment"}'::jsonb
    );
    insert into lead_assignment_contract_results values (
      'prior_assignee_guarded_reassignment_denied',
      false,
      'call unexpectedly succeeded'
    );
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'prior_assignee_guarded_reassignment_denied',
        sqlerrm = 'access_denied',
        sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'prior_assignee_guarded_reassignment_denied',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;

  begin
    perform public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-0000-4000-8000-000000000501',
      p_expected_stage => 'qualifying',
      p_decided_by => '1ead5519-0000-4000-8000-000000000101',
      p_source_path => 'ios',
      p_evidence => '{"contract_case":"prior_assignee_conversion"}'::jsonb,
      p_expected_assignment_version => 2
    );
    insert into lead_assignment_contract_results values (
      'prior_assignee_conversion_denied',
      false,
      'call unexpectedly succeeded'
    );
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'prior_assignee_conversion_denied',
        sqlerrm = 'access_denied',
        sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'prior_assignee_conversion_denied',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;
end;
$contract$;

reset role;

insert into lead_assignment_contract_results (check_name, passed)
values (
  'prior_assignee_denials_leave_lead_and_history_unchanged',
  exists (
    select 1
    from public.opportunities o
    where o.id = '1ead5519-0000-4000-8000-000000000501'
      and o.assigned_to = '1ead5519-0000-4000-8000-000000000103'
      and o.assignment_version = 2
      and o.stage = 'qualifying'
      and o.project_ref is null
      and o.project_id is null
  )
  and (
    select count(*) = 2
    from public.opportunity_assignment_events e
    where e.opportunity_id = '1ead5519-0000-4000-8000-000000000501'
  )
  and (
    select count(*) = 3
    from public.opportunity_assignment_deliveries d
    where d.opportunity_id = '1ead5519-0000-4000-8000-000000000501'
  )
  and not exists (
    select 1
    from public.opportunity_conversion_events e
    where e.opportunity_id = '1ead5519-0000-4000-8000-000000000501'
  )
  and not exists (
    select 1
    from public.projects p
    where p.opportunity_ref = '1ead5519-0000-4000-8000-000000000501'
       or p.opportunity_id = '1ead5519-0000-4000-8000-000000000501'
  )
);

-- All-scope callers may correct terminal responsibility and unassign. Their
-- ordinary table writes still cannot bypass the guarded assignment core.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', '1ead5519-0000-4000-8000-000000000902',
    'email', 'lead-contract-all@example.invalid'
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '1ead5519-0000-4000-8000-000000000902',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

insert into lead_assignment_contract_values (value_name, value)
values (
  'all_scope_terminal_unassign',
  public.change_opportunity_assignment(
    '1ead5519-0000-4000-8000-000000000502',
    1,
    '1ead5519-0000-4000-8000-000000000101',
    null,
    'manual',
    null,
    '{"contract_case":"terminal_unassign"}'::jsonb
  )
);

do $contract$
begin
  begin
    update public.opportunities
       set assigned_to = '1ead5519-0000-4000-8000-000000000101',
           assignment_version = 3
     where id = '1ead5519-0000-4000-8000-000000000501';
    insert into lead_assignment_contract_results values (
      'raw_authenticated_assignment_write_rejected',
      false,
      'update unexpectedly succeeded'
    );
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'raw_authenticated_assignment_write_rejected',
        sqlerrm = 'assignment_write_forbidden',
        sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'raw_authenticated_assignment_write_rejected',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;

  begin
    update public.opportunities
       set assigned_to = '1ead5519-0000-4000-8000-000000000101'
     where id = '1ead5519-0000-4000-8000-000000000501';
    insert into lead_assignment_contract_results values (
      'raw_authenticated_assigned_to_only_write_rejected',
      false,
      'update unexpectedly succeeded'
    );
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'raw_authenticated_assigned_to_only_write_rejected',
        sqlerrm = 'assignment_write_forbidden',
        sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'raw_authenticated_assigned_to_only_write_rejected',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;
end;
$contract$;

reset role;

insert into lead_assignment_contract_results (check_name, passed)
select
  'all_scope_can_unassign_terminal_lead',
  (value ->> 'ok')::boolean
  and not (value ->> 'conflict')::boolean
  and value -> 'assigned_to' = 'null'::jsonb
  and (value ->> 'assignment_version')::bigint = 2
  and exists (
    select 1
    from public.opportunities o
    where o.id = '1ead5519-0000-4000-8000-000000000502'
      and o.assigned_to is null
      and o.assignment_version = 2
      and o.stage = 'won'
  )
from lead_assignment_contract_values
where value_name = 'all_scope_terminal_unassign';

-- service_role bypasses RLS but must still be stopped by the assignment trigger.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

do $contract$
begin
  begin
    update public.opportunities
       set assignment_version = assignment_version + 1
     where id = '1ead5519-0000-4000-8000-000000000501';
    insert into lead_assignment_contract_results values (
      'raw_service_role_assignment_version_write_rejected',
      false,
      'update unexpectedly succeeded'
    );
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'raw_service_role_assignment_version_write_rejected',
        sqlerrm = 'assignment_write_forbidden',
        sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'raw_service_role_assignment_version_write_rejected',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;

  begin
    update public.opportunities
       set assigned_to = '1ead5519-0000-4000-8000-000000000101'
     where id = '1ead5519-0000-4000-8000-000000000501';
    insert into lead_assignment_contract_results values (
      'raw_service_role_assigned_to_only_write_rejected',
      false,
      'update unexpectedly succeeded'
    );
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'raw_service_role_assigned_to_only_write_rejected',
        sqlerrm = 'assignment_write_forbidden',
        sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'raw_service_role_assigned_to_only_write_rejected',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;

  begin
    insert into public.opportunities (
      id,
      company_id,
      client_id,
      client_ref,
      title,
      stage,
      assigned_to,
      assignment_version
    ) values (
      '1ead5519-0000-4000-8000-000000000506',
      '1ead5519-0000-4000-8000-000000000001',
      '1ead5519-0000-4000-8000-000000000401',
      '1ead5519-0000-4000-8000-000000000401',
      'Forbidden Raw Initial Assignment',
      'new_lead',
      '1ead5519-0000-4000-8000-000000000101',
      1
    );
    insert into lead_assignment_contract_results values (
      'raw_service_role_initial_assignment_insert_rejected',
      false,
      'insert unexpectedly succeeded'
    );
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'raw_service_role_initial_assignment_insert_rejected',
        sqlerrm = 'assignment_write_forbidden',
        sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'raw_service_role_initial_assignment_insert_rejected',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;

  begin
    update public.opportunity_assignment_events
       set metadata = metadata || '{"tampered":true}'::jsonb
     where id = (
       select (value ->> 'event_id')::uuid
       from lead_assignment_contract_values
       where value_name = 'assigned_scope_transfer'
     );
    insert into lead_assignment_contract_results values (
      'assignment_events_are_immutable_to_service_role',
      false,
      'update unexpectedly succeeded'
    );
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'assignment_events_are_immutable_to_service_role', true, sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'assignment_events_are_immutable_to_service_role',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;
end;
$contract$;

reset role;

insert into lead_assignment_contract_results (check_name, passed)
values (
  'raw_write_attempts_leave_assignment_and_history_unchanged',
  exists (
    select 1
    from public.opportunities o
    where o.id = '1ead5519-0000-4000-8000-000000000501'
      and o.assigned_to = '1ead5519-0000-4000-8000-000000000103'
      and o.assignment_version = 2
  )
  and (
    select count(*) = 2
    from public.opportunity_assignment_events e
    where e.opportunity_id = '1ead5519-0000-4000-8000-000000000501'
  )
  and not exists (
    select 1
    from public.opportunities o
    where o.id = '1ead5519-0000-4000-8000-000000000506'
  )
  and not exists (
    select 1
    from public.opportunity_assignment_events e
    where e.opportunity_id = '1ead5519-0000-4000-8000-000000000506'
  )
  and not exists (
    select 1
    from public.opportunity_assignment_events e
    where e.id = (
      select (value ->> 'event_id')::uuid
      from lead_assignment_contract_values
      where value_name = 'assigned_scope_transfer'
    )
      and e.metadata @> '{"tampered":true}'::jsonb
  )
);

-- Guarded creation: self, unassigned, explicit, and unsupported-key rejection.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', '1ead5519-0000-4000-8000-000000000901',
    'email', 'lead-contract-assigned@example.invalid'
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '1ead5519-0000-4000-8000-000000000901',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

insert into lead_assignment_contract_values (value_name, value)
values (
  'guarded_create_self',
  public.create_opportunity_guarded(
    jsonb_build_object(
      'title', 'Guarded Self Contract Lead',
      'stage', 'new_lead',
      'client_ref', '1ead5519-0000-4000-8000-000000000401'
    ),
    'self',
    null,
    '{"contract_case":"create_self"}'::jsonb
  )
);

reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', '1ead5519-0000-4000-8000-000000000902',
    'email', 'lead-contract-all@example.invalid'
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '1ead5519-0000-4000-8000-000000000902',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

insert into lead_assignment_contract_values (value_name, value)
values
  (
    'guarded_create_unassigned',
    public.create_opportunity_guarded(
      jsonb_build_object(
        'title', 'Guarded Unassigned Contract Lead',
        'stage', 'qualifying'
      ),
      'unassigned',
      null,
      '{"contract_case":"create_unassigned"}'::jsonb
    )
  ),
  (
    'guarded_create_explicit',
    public.create_opportunity_guarded(
      jsonb_build_object(
        'title', 'Guarded Explicit Contract Lead',
        'stage', 'quoting'
      ),
      'explicit',
      '1ead5519-0000-4000-8000-000000000103',
      '{"contract_case":"create_explicit"}'::jsonb
    )
  );

do $contract$
begin
  begin
    perform public.create_opportunity_guarded(
      jsonb_build_object(
        'title', 'Unsupported Guarded Contract Lead',
        'company_id', '1ead5519-0000-4000-8000-000000000002'
      ),
      'unassigned',
      null,
      '{}'::jsonb
    );
    insert into lead_assignment_contract_results values (
      'guarded_create_rejects_unsupported_keys',
      false,
      'call unexpectedly succeeded'
    );
  exception
    when sqlstate '22023' then
      insert into lead_assignment_contract_results values (
        'guarded_create_rejects_unsupported_keys',
        sqlerrm = 'unsupported_opportunity_field: company_id',
        sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'guarded_create_rejects_unsupported_keys',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;
end;
$contract$;

reset role;

insert into lead_assignment_contract_results (check_name, passed)
select
  'guarded_create_self_assigns_actor_and_audits',
  (v.value ->> 'ok')::boolean
  and (v.value ->> 'assigned_to')::uuid =
    '1ead5519-0000-4000-8000-000000000101'::uuid
  and (v.value ->> 'assignment_version')::bigint = 1
  and (v.value ->> 'event_id') is not null
  and exists (
    select 1
    from public.opportunities o
    where o.id = (v.value #>> '{opportunity,id}')::uuid
      and o.company_id = '1ead5519-0000-4000-8000-000000000001'
      and o.assigned_to = '1ead5519-0000-4000-8000-000000000101'
      and o.assignment_version = 1
  )
  and exists (
    select 1
    from public.opportunity_assignment_events e
    where e.id = (v.value ->> 'event_id')::uuid
      and e.source = 'manual_create'
      and e.previous_assignee_id is null
      and e.new_assignee_id = '1ead5519-0000-4000-8000-000000000101'
  )
from lead_assignment_contract_values v
where v.value_name = 'guarded_create_self';

insert into lead_assignment_contract_results (check_name, passed)
select
  'guarded_create_unassigned_has_zero_version_and_no_event',
  (v.value ->> 'ok')::boolean
  and v.value -> 'assigned_to' = 'null'::jsonb
  and (v.value ->> 'assignment_version')::bigint = 0
  and v.value -> 'event_id' = 'null'::jsonb
  and exists (
    select 1
    from public.opportunities o
    where o.id = (v.value #>> '{opportunity,id}')::uuid
      and o.assigned_to is null
      and o.assignment_version = 0
  )
  and not exists (
    select 1
    from public.opportunity_assignment_events e
    where e.opportunity_id = (v.value #>> '{opportunity,id}')::uuid
  )
from lead_assignment_contract_values v
where v.value_name = 'guarded_create_unassigned';

insert into lead_assignment_contract_results (check_name, passed)
select
  'guarded_create_explicit_assigns_eligible_target',
  (v.value ->> 'ok')::boolean
  and (v.value ->> 'assigned_to')::uuid =
    '1ead5519-0000-4000-8000-000000000103'::uuid
  and (v.value ->> 'assignment_version')::bigint = 1
  and (v.value ->> 'event_id') is not null
  and exists (
    select 1
    from public.opportunity_assignment_deliveries d
    where d.assignment_event_id = (v.value ->> 'event_id')::uuid
      and d.recipient_user_id = '1ead5519-0000-4000-8000-000000000103'
      and d.access_after
      and d.notify
  )
from lead_assignment_contract_values v
where v.value_name = 'guarded_create_explicit';

insert into lead_assignment_contract_results (check_name, passed)
values (
  'unsupported_guarded_create_writes_no_opportunity',
  not exists (
    select 1
    from public.opportunities o
    where o.title = 'Unsupported Guarded Contract Lead'
  )
);

-- A caller with project-create access cannot forge the conversion RPC's
-- project-link trigger token by setting its historical GUC. The assigned-scope
-- conversion immediately after this proves the legitimate internal seam works
-- without granting pipeline.manage:all.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', '1ead5519-0000-4000-8000-000000000901',
    'email', 'lead-contract-assigned@example.invalid'
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '1ead5519-0000-4000-8000-000000000901',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $contract$
begin
  begin
    perform set_config('ops.skip_project_opportunity_invariant', 'on', true);
    insert into public.projects (
      id,
      company_id,
      client_id,
      title,
      status,
      team_member_ids,
      opportunity_id,
      opportunity_ref
    ) values (
      '1ead5519-0000-4000-8000-000000000601',
      '1ead5519-0000-4000-8000-000000000001',
      '1ead5519-0000-4000-8000-000000000401',
      'Forged Project Link Contract',
      'rfq',
      array[]::text[],
      '1ead5519-0000-4000-8000-000000000505',
      '1ead5519-0000-4000-8000-000000000505'
    );
    insert into lead_assignment_contract_results values (
      'raw_project_writer_cannot_forge_conversion_bypass',
      false,
      'insert unexpectedly succeeded'
    );
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'raw_project_writer_cannot_forge_conversion_bypass',
        sqlerrm = 'access_denied',
        sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'raw_project_writer_cannot_forge_conversion_bypass',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;
end;
$contract$;

reset role;
select set_config('ops.skip_project_opportunity_invariant', 'off', true);

insert into lead_assignment_contract_results (check_name, passed)
values (
  'forged_project_link_attempt_leaves_both_rows_unchanged',
  not exists (
    select 1
    from public.projects p
    where p.id = '1ead5519-0000-4000-8000-000000000601'
  )
  and exists (
    select 1
    from public.opportunities o
    where o.id = '1ead5519-0000-4000-8000-000000000505'
      and o.project_ref is null
      and o.project_id is null
      and o.stage = 'qualifying'
      and o.assigned_to = '1ead5519-0000-4000-8000-000000000101'
      and o.assignment_version = 1
  )
);

-- Conversion projections: estimate mirrors, one labor task with no assignees,
-- site-visit and lead photos, and deck re-parenting with lead provenance.
insert into public.estimates (
  id,
  company_id,
  opportunity_id,
  client_id,
  client_ref,
  estimate_number,
  subtotal,
  total,
  status
) values (
  '1ead5519-0000-4000-8000-000000000701',
  '1ead5519-0000-4000-8000-000000000001',
  '1ead5519-0000-4000-8000-000000000504',
  '1ead5519-0000-4000-8000-000000000401',
  '1ead5519-0000-4000-8000-000000000401',
  'LEAD-CONTRACT-EST-001',
  25000,
  25000,
  'approved'
);

insert into public.line_items (
  id,
  company_id,
  estimate_id,
  name,
  quantity,
  unit_price,
  sort_order,
  type
) values (
  '1ead5519-0000-4000-8000-000000000702',
  '1ead5519-0000-4000-8000-000000000001',
  '1ead5519-0000-4000-8000-000000000701',
  'Lead Contract Labor',
  1,
  25000,
  1,
  'LABOR'
);

insert into public.site_visits (
  id,
  company_id,
  opportunity_id,
  client_id,
  client_ref,
  scheduled_at,
  created_by,
  photos
) values (
  '1ead5519-0000-4000-8000-000000000703',
  '1ead5519-0000-4000-8000-000000000001',
  '1ead5519-0000-4000-8000-000000000504',
  '1ead5519-0000-4000-8000-000000000401',
  '1ead5519-0000-4000-8000-000000000401',
  now() + interval '1 day',
  '1ead5519-0000-4000-8000-000000000101',
  array['https://example.invalid/site-visit-contract-photo.jpg']::text[]
);

insert into public.deck_designs (
  id,
  company_id,
  project_id,
  opportunity_id,
  title,
  drawing_data,
  version
) values (
  '1ead5519-0000-4000-8000-000000000704',
  '1ead5519-0000-4000-8000-000000000001',
  null,
  '1ead5519-0000-4000-8000-000000000504',
  'Lead Contract Deck',
  '{"contract_fixture":true}'::jsonb,
  1
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', '1ead5519-0000-4000-8000-000000000901',
    'email', 'lead-contract-assigned@example.invalid'
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '1ead5519-0000-4000-8000-000000000901',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

insert into lead_assignment_contract_results (check_name, passed)
values (
  'conversion_actor_is_assigned_scope_without_manage_all',
  private.current_user_scope_for('pipeline.convert') = 'assigned'
  and public.has_permission(
    '1ead5519-0000-4000-8000-000000000101',
    'pipeline.manage',
    'all'
  ) is false
);

insert into lead_assignment_contract_values (value_name, value)
values (
  'conversion_stale_assignment_snapshot',
  public.convert_opportunity_to_project(
    p_company_id => '1ead5519-0000-4000-8000-000000000001',
    p_opportunity_id => '1ead5519-0000-4000-8000-000000000504',
    p_actual_value => 25000,
    p_expected_stage => 'quoting',
    p_decided_by => '1ead5519-0000-4000-8000-000000000101',
    p_title_override => 'Lead Contract Converted Project',
    p_source_path => 'ios',
    p_evidence => '{"contract_case":"stale_conversion"}'::jsonb,
    p_expected_assignment_version => 0
  )
);

reset role;

insert into lead_assignment_contract_results (check_name, passed)
select
  'stale_conversion_assignment_snapshot_is_no_write_guard',
  not (v.value ->> 'converted')::boolean
  and not (v.value ->> 'already_converted')::boolean
  and v.value ->> 'guard_reason' = 'assignment_snapshot_mismatch'
  and (v.value ->> 'assigned_to')::uuid =
    '1ead5519-0000-4000-8000-000000000101'::uuid
  and (v.value ->> 'assignment_version')::bigint = 1
  and exists (
    select 1
    from public.opportunities o
    where o.id = '1ead5519-0000-4000-8000-000000000504'
      and o.project_ref is null
      and o.project_id is null
      and o.stage = 'quoting'
      and o.assigned_to = '1ead5519-0000-4000-8000-000000000101'
      and o.assignment_version = 1
  )
  and not exists (
    select 1
    from public.opportunity_conversion_events e
    where e.opportunity_id = '1ead5519-0000-4000-8000-000000000504'
  )
  and not exists (
    select 1
    from public.projects p
    where p.opportunity_ref = '1ead5519-0000-4000-8000-000000000504'
       or p.opportunity_id = '1ead5519-0000-4000-8000-000000000504'
  )
  and not exists (
    select 1
    from public.project_tasks pt
    where pt.source_line_item_id = '1ead5519-0000-4000-8000-000000000702'
  )
  and not exists (
    select 1
    from public.project_photos pp
    where pp.url in (
      'https://example.invalid/site-visit-contract-photo.jpg',
      'https://example.invalid/lead-contract-photo.jpg'
    )
  )
  and exists (
    select 1
    from public.deck_designs d
    where d.id = '1ead5519-0000-4000-8000-000000000704'
      and d.project_id is null
      and d.opportunity_id = '1ead5519-0000-4000-8000-000000000504'
  )
from lead_assignment_contract_values v
where v.value_name = 'conversion_stale_assignment_snapshot';

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', '1ead5519-0000-4000-8000-000000000901',
    'email', 'lead-contract-assigned@example.invalid'
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '1ead5519-0000-4000-8000-000000000901',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

insert into lead_assignment_contract_values (value_name, value)
values (
  'conversion_success',
  public.convert_opportunity_to_project(
    p_company_id => '1ead5519-0000-4000-8000-000000000001',
    p_opportunity_id => '1ead5519-0000-4000-8000-000000000504',
    p_actual_value => 25000,
    p_expected_stage => 'quoting',
    p_decided_by => '1ead5519-0000-4000-8000-000000000101',
    p_title_override => 'Lead Contract Converted Project',
    p_source_path => 'ios',
    p_evidence => '{"contract_case":"successful_conversion"}'::jsonb,
    p_expected_assignment_version => 1
  )
);

reset role;

insert into lead_assignment_contract_results (check_name, passed)
select
  'assigned_scope_conversion_reaches_project_write_without_manage_all',
  (v.value ->> 'converted')::boolean
  and not (v.value ->> 'already_converted')::boolean
  and v.value -> 'guard_reason' = 'null'::jsonb
  and (v.value ->> 'project_id') is not null
  and (v.value ->> 'conversion_event_id') is not null
  and (v.value ->> 'assigned_to')::uuid =
    '1ead5519-0000-4000-8000-000000000101'::uuid
  and (v.value ->> 'assignment_version')::bigint = 1
  and public.has_permission(
    '1ead5519-0000-4000-8000-000000000101',
    'pipeline.manage',
    'all'
  ) is false
from lead_assignment_contract_values v
where v.value_name = 'conversion_success';

insert into lead_assignment_contract_results (check_name, passed)
select
  'conversion_preserves_assignee_and_repairs_all_link_mirrors',
  exists (
    select 1
    from public.opportunities o
    where o.id = '1ead5519-0000-4000-8000-000000000504'
      and o.assigned_to = '1ead5519-0000-4000-8000-000000000101'
      and o.assignment_version = 1
      and o.stage = 'won'
      and o.project_ref = (v.value ->> 'project_id')::uuid
      and o.project_id = (v.value ->> 'project_id')::uuid
  )
  and exists (
    select 1
    from public.projects p
    where p.id = (v.value ->> 'project_id')::uuid
      and p.company_id = '1ead5519-0000-4000-8000-000000000001'
      and p.opportunity_ref = '1ead5519-0000-4000-8000-000000000504'
      and p.opportunity_id = '1ead5519-0000-4000-8000-000000000504'
      and coalesce(p.team_member_ids, array[]::text[]) = array[]::text[]
      and p.created_by is null
  )
from lead_assignment_contract_values v
where v.value_name = 'conversion_success';

insert into lead_assignment_contract_results (check_name, passed)
select
  'conversion_relinks_estimate_and_creates_unassigned_labor_task',
  exists (
    select 1
    from public.estimates e
    where e.id = '1ead5519-0000-4000-8000-000000000701'
      and e.project_ref = (v.value ->> 'project_id')::uuid
      and e.project_id = v.value ->> 'project_id'
  )
  and (
    select count(*) = 1
    from public.project_tasks pt
    where pt.project_id = (v.value ->> 'project_id')::uuid
      and pt.source_line_item_id = '1ead5519-0000-4000-8000-000000000702'
      and pt.source_estimate_id = '1ead5519-0000-4000-8000-000000000701'
      and pt.deleted_at is null
      and coalesce(pt.team_member_ids, array[]::text[]) = array[]::text[]
  )
from lead_assignment_contract_values v
where v.value_name = 'conversion_success';

insert into lead_assignment_contract_results (check_name, passed)
select
  'conversion_projects_site_visit_and_lead_photos_once',
  (
    select count(*) = 2
    from public.project_photos pp
    where pp.project_id = v.value ->> 'project_id'
      and pp.url in (
        'https://example.invalid/site-visit-contract-photo.jpg',
        'https://example.invalid/lead-contract-photo.jpg'
      )
      and pp.deleted_at is null
  )
  and exists (
    select 1
    from public.project_photos pp
    where pp.project_id = v.value ->> 'project_id'
      and pp.url = 'https://example.invalid/site-visit-contract-photo.jpg'
      and pp.source::text = 'site_visit'
      and pp.site_visit_id = '1ead5519-0000-4000-8000-000000000703'
  )
  and exists (
    select 1
    from public.project_photos pp
    where pp.project_id = v.value ->> 'project_id'
      and pp.url = 'https://example.invalid/lead-contract-photo.jpg'
      and pp.source::text = 'other'
      and pp.site_visit_id is null
  )
from lead_assignment_contract_values v
where v.value_name = 'conversion_success';

insert into lead_assignment_contract_results (check_name, passed)
select
  'conversion_reparents_deck_and_retains_opportunity_provenance',
  exists (
    select 1
    from public.deck_designs d
    where d.id = '1ead5519-0000-4000-8000-000000000704'
      and d.project_id = (v.value ->> 'project_id')::uuid
      and d.opportunity_id = '1ead5519-0000-4000-8000-000000000504'
      and d.deleted_at is null
  )
from lead_assignment_contract_values v
where v.value_name = 'conversion_success';

insert into lead_assignment_contract_results (check_name, passed)
select
  'conversion_emits_one_immutable_assignment_versioned_event',
  (
    select count(*) = 1
    from public.opportunity_conversion_events e
    where e.opportunity_id = '1ead5519-0000-4000-8000-000000000504'
      and e.project_id = (v.value ->> 'project_id')::uuid
      and e.event_type = 'converted_to_project'
      and e.id = (v.value ->> 'conversion_event_id')::uuid
      and e.actor_user_id = '1ead5519-0000-4000-8000-000000000101'
      and e.assignment_version = 1
  )
  and not has_table_privilege(
    'authenticated', 'public.opportunity_conversion_events', 'update'
  )
  and not has_table_privilege(
    'authenticated', 'public.opportunity_conversion_events', 'delete'
  )
from lead_assignment_contract_values v
where v.value_name = 'conversion_success';

-- A retry is also a repair pass, but must not duplicate downstream state.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', '1ead5519-0000-4000-8000-000000000901',
    'email', 'lead-contract-assigned@example.invalid'
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '1ead5519-0000-4000-8000-000000000901',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

insert into lead_assignment_contract_values (value_name, value)
values (
  'conversion_retry',
  public.convert_opportunity_to_project(
    p_company_id => '1ead5519-0000-4000-8000-000000000001',
    p_opportunity_id => '1ead5519-0000-4000-8000-000000000504',
    p_actual_value => 25000,
    p_expected_stage => 'won',
    p_decided_by => '1ead5519-0000-4000-8000-000000000101',
    p_title_override => 'Lead Contract Converted Project',
    p_source_path => 'ios',
    p_evidence => '{"contract_case":"conversion_retry"}'::jsonb,
    p_expected_assignment_version => 1
  )
);

reset role;

insert into lead_assignment_contract_results (check_name, passed)
select
  'conversion_retry_is_idempotent_and_preserves_unstaffed_work',
  not (retry.value ->> 'converted')::boolean
  and (retry.value ->> 'already_converted')::boolean
  and retry.value ->> 'guard_reason' = 'already_converted'
  and retry.value ->> 'project_id' = first_conversion.value ->> 'project_id'
  and retry.value ->> 'conversion_event_id' =
    first_conversion.value ->> 'conversion_event_id'
  and (retry.value ->> 'materialized_tasks')::bigint = 0
  and (retry.value ->> 'attached_photos')::bigint = 0
  and (retry.value ->> 'attached_lead_photos')::bigint = 0
  and (retry.value ->> 'relinked_decks')::bigint = 0
  and (
    select count(*) = 1
    from public.opportunity_conversion_events e
    where e.opportunity_id = '1ead5519-0000-4000-8000-000000000504'
      and e.project_id = (retry.value ->> 'project_id')::uuid
      and e.event_type = 'converted_to_project'
  )
  and (
    select count(*) = 1
    from public.project_tasks pt
    where pt.project_id = (retry.value ->> 'project_id')::uuid
      and pt.source_line_item_id = '1ead5519-0000-4000-8000-000000000702'
      and pt.deleted_at is null
      and coalesce(pt.team_member_ids, array[]::text[]) = array[]::text[]
  )
  and (
    select count(*) = 2
    from public.project_photos pp
    where pp.project_id = retry.value ->> 'project_id'
      and pp.url in (
        'https://example.invalid/site-visit-contract-photo.jpg',
        'https://example.invalid/lead-contract-photo.jpg'
      )
      and pp.deleted_at is null
  )
  and exists (
    select 1
    from public.projects p
    where p.id = (retry.value ->> 'project_id')::uuid
      and coalesce(p.team_member_ids, array[]::text[]) = array[]::text[]
  )
  and exists (
    select 1
    from public.opportunities o
    where o.id = '1ead5519-0000-4000-8000-000000000504'
      and o.assigned_to = '1ead5519-0000-4000-8000-000000000101'
      and o.assignment_version = 1
  )
from lead_assignment_contract_values retry
join lead_assignment_contract_values first_conversion
  on first_conversion.value_name = 'conversion_success'
where retry.value_name = 'conversion_retry';

-- Task 2B actor-aware project disclosure and actorless email provenance.
insert into public.opportunities (
  id, company_id, client_id, client_ref, title, address, stage,
  assigned_to, assignment_version, estimated_value, images
) values
  (
    '1ead5519-1000-4000-8000-000000000506',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000401',
    'Scoped Preflight Lead', '77 Contract Ave', 'quoting',
    null, 0, 11000, array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000507',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000401',
    'Email Accept Lead', '78 Contract Ave', 'quoting',
    null, 0, 12000, array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000508',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000401',
    'Likely Won Lead', '79 Contract Ave', 'quoting',
    null, 0, 13000, array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000509',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000401',
    'Denied Service Actor Lead', '80 Contract Ave', 'quoting',
    null, 0, 14000, array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000510',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000401',
    'Away And Back Lead', '81 Contract Ave', 'quoting',
    null, 0, 15000, array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000511',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000401',
    'Hidden Linked Recovery Lead', '77 Contract Ave', 'quoting',
    null, 0, 16000, array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000512',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000401',
    'Manual Stage Race Lead', '82 Contract Ave', 'quoting',
    null, 0, 17000, array[]::text[]
  );

select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

insert into lead_assignment_contract_values (value_name, value)
values
  (
    'setup_scoped_preflight',
    public.change_opportunity_assignment_as_system(
      '1ead5519-1000-4000-8000-000000000506', 0, null,
      '1ead5519-0000-4000-8000-000000000101', 'system_repair', null, null,
      '{"contract_case":"scoped_preflight"}'::jsonb
    )
  ),
  (
    'setup_away_back_first',
    public.change_opportunity_assignment_as_system(
      '1ead5519-1000-4000-8000-000000000510', 0, null,
      '1ead5519-0000-4000-8000-000000000101', 'system_repair', null, null,
      '{"contract_case":"away_back_first"}'::jsonb
    )
  ),
  (
    'setup_hidden_linked_recovery',
    public.change_opportunity_assignment_as_system(
      '1ead5519-1000-4000-8000-000000000511', 0, null,
      '1ead5519-0000-4000-8000-000000000101', 'system_repair', null, null,
      '{"contract_case":"hidden_linked_recovery"}'::jsonb
    )
  );

insert into lead_assignment_contract_values (value_name, value)
values (
  'setup_away_back_away',
  public.change_opportunity_assignment_as_system(
    '1ead5519-1000-4000-8000-000000000510', 1,
    '1ead5519-0000-4000-8000-000000000101',
    '1ead5519-0000-4000-8000-000000000103', 'system_repair', null, null,
    '{"contract_case":"away_back_away"}'::jsonb
  )
);

insert into lead_assignment_contract_values (value_name, value)
values (
  'setup_away_back_return',
  public.change_opportunity_assignment_as_system(
    '1ead5519-1000-4000-8000-000000000510', 2,
    '1ead5519-0000-4000-8000-000000000103',
    '1ead5519-0000-4000-8000-000000000101', 'system_repair', null, null,
    '{"contract_case":"away_back_return"}'::jsonb
  )
);

reset role;

insert into public.projects (
  id, company_id, client_id, title, title_is_auto, address, status,
  team_member_ids
) values
  (
    '1ead5519-1000-4000-8000-000000000801',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    'Mention-only candidate', false, '77 Contract Ave', 'rfq',
    array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000802',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    'Task-assigned candidate', false, '77 Contract Ave', 'rfq',
    array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000803',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    'Hidden sibling-client project', false, '999 Hidden Ave', 'rfq',
    array[]::text[]
  );

insert into public.project_notes (
  id, project_id, company_id, author_id, content, mentioned_user_ids
) values (
  '1ead5519-1000-4000-8000-000000000811',
  '1ead5519-1000-4000-8000-000000000801',
  '1ead5519-0000-4000-8000-000000000001',
  '1ead5519-0000-4000-8000-000000000102',
  'Mention-only fixture',
  array['1ead5519-0000-4000-8000-000000000101']::text[]
);

insert into public.project_tasks (
  id, project_id, company_id, custom_title, status, team_member_ids
) values (
  '1ead5519-1000-4000-8000-000000000812',
  '1ead5519-1000-4000-8000-000000000802',
  '1ead5519-0000-4000-8000-000000000001',
  'Task assignment fixture', 'active',
  array['1ead5519-0000-4000-8000-000000000101']::text[]
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

insert into lead_assignment_contract_values (value_name, value)
values
  (
    'hidden_linked_conversion',
    public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000511',
      p_expected_stage => 'quoting',
      p_decided_by => '1ead5519-0000-4000-8000-000000000102',
      p_source_path => 'won_dialog',
      p_expected_assignment_version => 1
    )
  ),
  (
    'scoped_preflight',
    public.get_conversion_preflight(
      '1ead5519-1000-4000-8000-000000000506',
      '1ead5519-0000-4000-8000-000000000001',
      '1ead5519-0000-4000-8000-000000000101'
    )
  )
;

insert into lead_assignment_contract_values (value_name, value)
values (
  'hidden_linked_preflight',
  public.get_conversion_preflight(
    '1ead5519-1000-4000-8000-000000000511',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000101'
  )
);

reset role;

insert into lead_assignment_contract_results (check_name, passed)
select
  'preflight_filters_each_project_by_project_domain_access',
  (v.value ->> 'assignment_version')::bigint = 1
  and not (v.value ->> 'already_converted')::boolean
  and not (v.value ->> 'project_accessible')::boolean
  and jsonb_array_length(v.value -> 'duplicate_candidates') = 1
  and v.value -> 'duplicate_candidates' -> 0 ->> 'project_id' =
    '1ead5519-1000-4000-8000-000000000802'
  and not (v.value -> 'duplicate_candidates' @> jsonb_build_array(
    jsonb_build_object(
      'project_id', '1ead5519-1000-4000-8000-000000000801'
    )
  ))
  and not (v.value -> 'other_client_projects' @> jsonb_build_array(
    jsonb_build_object(
      'project_id', '1ead5519-1000-4000-8000-000000000803'
    )
  ))
from lead_assignment_contract_values v
where v.value_name = 'scoped_preflight';

insert into lead_assignment_contract_results (check_name, passed, details)
select
  'inaccessible_linked_preflight_is_recovery_only_without_project_disclosure',
  (v.value ->> 'assignment_version')::bigint = 1
  and (v.value ->> 'already_converted')::boolean
  and not (v.value ->> 'project_accessible')::boolean
  and v.value -> 'existing_linked_project' = 'null'::jsonb
  and v.value -> 'duplicate_candidates' = '[]'::jsonb
  and v.value -> 'other_client_projects' = '[]'::jsonb
  and v.value::text not like '%Hidden Linked Recovery Lead%'
  and v.value::text not like '%Task-assigned candidate%'
  and v.value::text not like '%Mention-only candidate%',
  v.value::text
from lead_assignment_contract_values v
where v.value_name = 'hidden_linked_preflight';

select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

do $contract$
begin
  begin
    perform public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000506',
      p_expected_stage => 'quoting',
      p_decided_by => '1ead5519-0000-4000-8000-000000000101',
      p_link_to_project_id => '1ead5519-1000-4000-8000-000000000801',
      p_source_path => 'won_dialog',
      p_evidence => '{"surface":"web_won_dialog"}'::jsonb,
      p_expected_assignment_version => 1
    );
    insert into lead_assignment_contract_results values (
      'mention_only_project_link_denied', false,
      'call unexpectedly succeeded'
    );
  exception when sqlstate 'P0002' then
    insert into lead_assignment_contract_results values (
      'mention_only_project_link_denied',
      sqlerrm = 'project_link_unavailable', sqlerrm
    );
  end;
end;
$contract$;

insert into lead_assignment_contract_values (value_name, value)
values (
  'authorized_task_assigned_project_link',
  public.convert_opportunity_to_project(
    p_company_id => '1ead5519-0000-4000-8000-000000000001',
    p_opportunity_id => '1ead5519-1000-4000-8000-000000000506',
    p_expected_stage => 'quoting',
    p_decided_by => '1ead5519-0000-4000-8000-000000000101',
    p_link_to_project_id => '1ead5519-1000-4000-8000-000000000802',
    p_source_path => 'won_dialog',
    p_evidence => '{"surface":"web_won_dialog"}'::jsonb,
    p_expected_assignment_version => 1
  )
);

reset role;

insert into lead_assignment_contract_results (check_name, passed)
select
  'authorized_candidate_is_rechecked_and_linked_under_lock',
  (v.value ->> 'converted')::boolean
  and (v.value ->> 'linked_existing')::boolean
  and (v.value ->> 'project_accessible')::boolean
  and v.value ->> 'project_id' =
    '1ead5519-1000-4000-8000-000000000802'
  and exists (
    select 1
      from public.opportunities o
     where o.id = '1ead5519-1000-4000-8000-000000000506'
       and o.project_ref = '1ead5519-1000-4000-8000-000000000802'
       and o.project_id = '1ead5519-1000-4000-8000-000000000802'
       and o.stage = 'won'
  )
  and exists (
    select 1
      from public.opportunity_conversion_events event
     where event.id = (v.value ->> 'conversion_event_id')::uuid
       and event.actor_user_id =
         '1ead5519-0000-4000-8000-000000000101'
       and event.assignment_version = 1
  )
from lead_assignment_contract_values v
where v.value_name = 'authorized_task_assigned_project_link';

insert into public.email_connections (
  id, company_id, type, user_id, email, access_token, refresh_token,
  expires_at, sync_enabled, status
) values
  (
    '1ead5519-1000-4000-8000-000000000901',
    '1ead5519-0000-4000-8000-000000000001',
    'company', '1ead5519-0000-4000-8000-000000000101',
    'contract-mailbox@example.invalid',
    'rollback-access-token', 'rollback-refresh-token',
    now() + interval '1 day', true, 'active'
  ),
  (
    '1ead5519-1000-4000-8000-000000000902',
    '1ead5519-0000-4000-8000-000000000001',
    'company', null, 'inactive-contract-mailbox@example.invalid',
    'rollback-access-token', 'rollback-refresh-token',
    now() + interval '1 day', false, 'inactive'
  );

insert into public.email_threads (
  id, company_id, connection_id, provider_thread_id, subject,
  first_message_at, last_message_at, opportunity_id, client_id
) values
  (
    '1ead5519-1000-4000-8000-000000000911',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-email-accept', 'Acceptance fixture', now(), now(),
    '1ead5519-1000-4000-8000-000000000507',
    '1ead5519-0000-4000-8000-000000000401'
  ),
  (
    '1ead5519-1000-4000-8000-000000000912',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000902',
    'provider-thread-inactive', 'Inactive fixture', now(), now(),
    '1ead5519-1000-4000-8000-000000000509',
    '1ead5519-0000-4000-8000-000000000401'
  );

insert into public.opportunity_correspondence_events (
  id, company_id, opportunity_id, connection_id, provider_thread_id,
  provider_message_id, direction, party_role, is_meaningful, occurred_at,
  source
) values
  (
    '1ead5519-1000-4000-8000-000000000921',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000508',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-likely-won', 'provider-message-likely-won',
    'inbound', 'customer', true, now(), 'lead_assignment_contract'
  ),
  (
    '1ead5519-1000-4000-8000-000000000922',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000509',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-untrusted-evidence', 'provider-message-outbound',
    'outbound', 'customer', true, now(), 'lead_assignment_contract'
  ),
  (
    '1ead5519-1000-4000-8000-000000000923',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000509',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-untrusted-evidence', 'provider-message-non-customer',
    'inbound', 'ops', true, now(), 'lead_assignment_contract'
  ),
  (
    '1ead5519-1000-4000-8000-000000000924',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000509',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-untrusted-evidence', 'provider-message-not-meaningful',
    'inbound', 'customer', false, now(), 'lead_assignment_contract'
  ),
  (
    '1ead5519-1000-4000-8000-000000000925',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000512',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-manual-stage-race', 'provider-message-manual-stage-race',
    'inbound', 'customer', true, now(), 'lead_assignment_contract'
  );

select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

do $contract$
declare
  v_case record;
begin
  for v_case in
    select *
      from (values
        (
          'service_no_view_actor_denied',
          '1ead5519-0000-4000-8000-000000000104'
        ),
        (
          'service_inactive_actor_denied',
          '1ead5519-0000-4000-8000-000000000105'
        ),
        (
          'service_cross_company_actor_denied',
          '1ead5519-0000-4000-8000-000000000106'
        ),
        (
          'service_actor_without_edit_or_convert_denied',
          '1ead5519-0000-4000-8000-000000000103'
        )
      ) cases(check_name, actor_user_id)
  loop
    begin
      perform public.convert_opportunity_to_project(
        p_company_id => '1ead5519-0000-4000-8000-000000000001',
        p_opportunity_id => '1ead5519-1000-4000-8000-000000000509',
        p_expected_stage => 'quoting',
        p_decided_by => v_case.actor_user_id::uuid,
        p_source_path => 'won_dialog',
        p_evidence => '{"surface":"web_won_dialog"}'::jsonb,
        p_expected_assignment_version => 0
      );
      insert into lead_assignment_contract_results values (
        v_case.check_name, false, 'call unexpectedly succeeded'
      );
    exception when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        v_case.check_name, sqlerrm = 'access_denied', sqlerrm
      );
    end;
  end loop;

  begin
    perform public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000509',
      p_expected_stage => 'quoting',
      p_decided_by => '1ead5519-0000-4000-8000-000000000102',
      p_source_path => 'won_dialog',
      p_evidence => '{"surface":"web_won_dialog"}'::jsonb
    );
    insert into lead_assignment_contract_results values (
      'service_human_without_assignment_snapshot_denied', false,
      'call unexpectedly succeeded'
    );
  exception when sqlstate '22023' then
    insert into lead_assignment_contract_results values (
      'service_human_without_assignment_snapshot_denied',
      sqlerrm = 'invalid_assignment_snapshot', sqlerrm
    );
  end;

  begin
    perform public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000509',
      p_expected_stage => 'quoting',
      p_decided_by => null,
      p_source_path => 'approval_queue',
      p_evidence => '{}'::jsonb,
      p_expected_assignment_version => 0
    );
    insert into lead_assignment_contract_results values (
      'actorless_approval_queue_denied', false,
      'call unexpectedly succeeded'
    );
  exception when sqlstate '42501' then
    insert into lead_assignment_contract_results values (
      'actorless_approval_queue_denied',
      sqlerrm = 'access_denied', sqlerrm
    );
  end;

  begin
    perform public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000509',
      p_expected_stage => 'quoting',
      p_decided_by => '1ead5519-0000-4000-8000-000000000102',
      p_source_path => 'email_likely_won',
      p_evidence => '{}'::jsonb,
      p_expected_assignment_version => 0
    );
    insert into lead_assignment_contract_results values (
      'actorful_email_source_denied', false,
      'call unexpectedly succeeded'
    );
  exception when sqlstate '42501' then
    insert into lead_assignment_contract_results values (
      'actorful_email_source_denied',
      sqlerrm = 'access_denied', sqlerrm
    );
  end;

  for v_case in
    select *
      from (values
        (
          'outbound_likely_won_evidence_denied',
          'provider-message-outbound'
        ),
        (
          'non_customer_likely_won_evidence_denied',
          'provider-message-non-customer'
        ),
        (
          'non_meaningful_likely_won_evidence_denied',
          'provider-message-not-meaningful'
        )
      ) cases(check_name, provider_message_id)
  loop
    begin
      perform public.convert_opportunity_to_project(
        p_company_id => '1ead5519-0000-4000-8000-000000000001',
        p_opportunity_id => '1ead5519-1000-4000-8000-000000000509',
        p_expected_stage => 'quoting',
        p_decided_by => null,
        p_source_path => 'email_likely_won',
        p_evidence => jsonb_build_object(
          'connection_id', '1ead5519-1000-4000-8000-000000000901',
          'provider_thread_id', 'provider-thread-untrusted-evidence',
          'provider_message_id', v_case.provider_message_id,
          'decision', 'likely_won'
        ),
        p_expected_assignment_version => 0
      );
      insert into lead_assignment_contract_results values (
        v_case.check_name, false, 'call unexpectedly succeeded'
      );
    exception when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        v_case.check_name, sqlerrm = 'access_denied', sqlerrm
      );
    end;
  end loop;

  begin
    perform public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000509',
      p_expected_stage => 'quoting',
      p_decided_by => null,
      p_source_path => 'email_accept',
      p_evidence => '{"connection_id":"not-a-uuid"}'::jsonb,
      p_expected_assignment_version => 0
    );
    insert into lead_assignment_contract_results values (
      'malformed_actorless_evidence_denied', false,
      'call unexpectedly succeeded'
    );
  exception when sqlstate '42501' then
    insert into lead_assignment_contract_results values (
      'malformed_actorless_evidence_denied',
      sqlerrm = 'access_denied', sqlerrm
    );
  end;

  begin
    perform public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000509',
      p_expected_stage => 'quoting',
      p_decided_by => null,
      p_source_path => 'email_accept',
      p_evidence => jsonb_build_object(
        'connection_id', '1ead5519-1000-4000-8000-000000000901',
        'email_thread_id', '1ead5519-1000-4000-8000-000000000911',
        'provider_thread_id', 'provider-thread-email-accept',
        'decision', 'auto_advance_won'
      ),
      p_expected_assignment_version => 0
    );
    insert into lead_assignment_contract_results values (
      'wrong_opportunity_email_thread_denied', false,
      'call unexpectedly succeeded'
    );
  exception when sqlstate '42501' then
    insert into lead_assignment_contract_results values (
      'wrong_opportunity_email_thread_denied',
      sqlerrm = 'access_denied', sqlerrm
    );
  end;

  begin
    perform public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000509',
      p_expected_stage => 'quoting',
      p_decided_by => null,
      p_source_path => 'email_likely_won',
      p_evidence => jsonb_build_object(
        'connection_id', '1ead5519-1000-4000-8000-000000000901',
        'provider_thread_id', 'provider-thread-likely-won',
        'provider_message_id', 'provider-message-likely-won',
        'decision', 'likely_won'
      ),
      p_expected_assignment_version => 0
    );
    insert into lead_assignment_contract_results values (
      'wrong_opportunity_correspondence_event_denied', false,
      'call unexpectedly succeeded'
    );
  exception when sqlstate '42501' then
    insert into lead_assignment_contract_results values (
      'wrong_opportunity_correspondence_event_denied',
      sqlerrm = 'access_denied', sqlerrm
    );
  end;

  begin
    perform public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000509',
      p_expected_stage => 'quoting',
      p_decided_by => null,
      p_source_path => 'email_accept',
      p_evidence => jsonb_build_object(
        'connection_id', '1ead5519-1000-4000-8000-000000000902',
        'email_thread_id', '1ead5519-1000-4000-8000-000000000912',
        'provider_thread_id', 'provider-thread-inactive',
        'decision', 'auto_advance_won'
      ),
      p_expected_assignment_version => 0
    );
    insert into lead_assignment_contract_results values (
      'inactive_connection_evidence_denied', false,
      'call unexpectedly succeeded'
    );
  exception when sqlstate '42501' then
    insert into lead_assignment_contract_results values (
      'inactive_connection_evidence_denied',
      sqlerrm = 'access_denied', sqlerrm
    );
  end;

  begin
    perform public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000507',
      p_expected_stage => 'quoting',
      p_decided_by => null,
      p_link_to_project_id => '1ead5519-1000-4000-8000-000000000802',
      p_source_path => 'email_accept',
      p_evidence => jsonb_build_object(
        'connection_id', '1ead5519-1000-4000-8000-000000000901',
        'email_thread_id', '1ead5519-1000-4000-8000-000000000911',
        'provider_thread_id', 'provider-thread-email-accept',
        'decision', 'auto_advance_won'
      ),
      p_expected_assignment_version => 0
    );
    insert into lead_assignment_contract_results values (
      'actorless_link_existing_denied', false,
      'call unexpectedly succeeded'
    );
  exception when sqlstate 'P0002' then
    insert into lead_assignment_contract_results values (
      'actorless_link_existing_denied',
      sqlerrm = 'project_link_unavailable', sqlerrm
    );
  end;
end;
$contract$;

insert into lead_assignment_contract_results (check_name, passed)
values (
  'service_and_actorless_denials_leave_opportunity_unconverted',
  exists (
    select 1
      from public.opportunities o
     where o.id = '1ead5519-1000-4000-8000-000000000509'
       and o.stage = 'quoting'
       and o.project_ref is null
       and o.project_id is null
       and o.assignment_version = 0
  )
  and not exists (
    select 1
      from public.opportunity_conversion_events event
     where event.opportunity_id =
       '1ead5519-1000-4000-8000-000000000509'
  )
);

-- Simulate the race: evaluation observed an automatic stage, then a human
-- pinned it before the actorless conversion acquired the opportunity lock.
update public.opportunities
   set stage_manually_set = true
 where id = '1ead5519-1000-4000-8000-000000000512';

insert into lead_assignment_contract_values (value_name, value)
values
  (
    'manual_stage_override_conversion',
    public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000512',
      p_expected_stage => 'quoting',
      p_decided_by => null,
      p_source_path => 'email_likely_won',
      p_evidence => jsonb_build_object(
        'connection_id', '1ead5519-1000-4000-8000-000000000901',
        'provider_thread_id', 'provider-thread-manual-stage-race',
        'provider_message_id', 'provider-message-manual-stage-race',
        'decision', 'likely_won'
      ),
      p_expected_assignment_version => 0
    )
  ),
  (
    'valid_email_accept_conversion',
    public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000507',
      p_expected_stage => 'quoting',
      p_decided_by => null,
      p_source_path => 'email_accept',
      p_evidence => jsonb_build_object(
        'connection_id', '1ead5519-1000-4000-8000-000000000901',
        'email_thread_id', '1ead5519-1000-4000-8000-000000000911',
        'provider_thread_id', 'provider-thread-email-accept',
        'decision', 'auto_advance_won'
      ),
      p_expected_assignment_version => 0
    )
  ),
  (
    'valid_email_likely_won_conversion',
    public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000508',
      p_expected_stage => 'quoting',
      p_decided_by => null,
      p_source_path => 'email_likely_won',
      p_evidence => jsonb_build_object(
        'connection_id', '1ead5519-1000-4000-8000-000000000901',
        'provider_thread_id', 'provider-thread-likely-won',
        'provider_message_id', 'provider-message-likely-won',
        'decision', 'likely_won'
      ),
      p_expected_assignment_version => 0
    )
  ),
  (
    'away_back_stale_conversion',
    public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000510',
      p_expected_stage => 'quoting',
      p_decided_by => '1ead5519-0000-4000-8000-000000000101',
      p_source_path => 'won_dialog',
      p_evidence => '{"surface":"web_won_dialog"}'::jsonb,
      p_expected_assignment_version => 1
    )
  );

reset role;

insert into lead_assignment_contract_results (check_name, passed, details)
select
  'actorless_manual_stage_race_is_no_write_under_lock',
  not (v.value ->> 'converted')::boolean
  and v.value ->> 'guard_reason' = 'manual_stage_override'
  and (v.value ->> 'assignment_version')::bigint = 0
  and exists (
    select 1
      from public.opportunities o
     where o.id = '1ead5519-1000-4000-8000-000000000512'
       and o.stage = 'quoting'
       and o.stage_manually_set is true
       and o.project_ref is null
       and o.project_id is null
       and o.assigned_to is null
       and o.assignment_version = 0
  )
  and not exists (
    select 1 from public.projects p
     where p.opportunity_ref = '1ead5519-1000-4000-8000-000000000512'
        or p.opportunity_id = '1ead5519-1000-4000-8000-000000000512'
  )
  and not exists (
    select 1
      from public.project_tasks task
      join public.projects project on project.id = task.project_id
     where project.opportunity_ref = '1ead5519-1000-4000-8000-000000000512'
        or project.opportunity_id = '1ead5519-1000-4000-8000-000000000512'
  )
  and not exists (
    select 1 from public.stage_transitions st
     where st.opportunity_id = '1ead5519-1000-4000-8000-000000000512'
  )
  and not exists (
    select 1 from public.opportunity_conversion_events event
     where event.opportunity_id = '1ead5519-1000-4000-8000-000000000512'
  )
  and not exists (
    select 1 from public.opportunity_assignment_events event
     where event.opportunity_id = '1ead5519-1000-4000-8000-000000000512'
  ),
  v.value::text
from lead_assignment_contract_values v
where v.value_name = 'manual_stage_override_conversion';

insert into lead_assignment_contract_results (check_name, passed)
select
  'valid_actorless_email_conversions_emit_null_actor_events',
  count(*) = 2
  and bool_and((v.value ->> 'converted')::boolean)
  and bool_and((v.value ->> 'assignment_version')::bigint = 0)
  and bool_and(not (v.value ->> 'project_accessible')::boolean)
  and bool_and(exists (
    select 1
      from public.opportunity_conversion_events event
     where event.id = (v.value ->> 'conversion_event_id')::uuid
       and event.actor_user_id is null
       and event.assignment_version = 0
  ))
from lead_assignment_contract_values v
where v.value_name in (
  'valid_email_accept_conversion',
  'valid_email_likely_won_conversion'
);

insert into lead_assignment_contract_results (check_name, passed)
select
  'away_then_back_assignment_snapshot_still_conflicts_without_writes',
  not (v.value ->> 'converted')::boolean
  and v.value ->> 'guard_reason' = 'assignment_snapshot_mismatch'
  and (v.value ->> 'assignment_version')::bigint = 3
  and (v.value ->> 'assigned_to')::uuid =
    '1ead5519-0000-4000-8000-000000000101'
  and not exists (
    select 1 from public.opportunity_conversion_events event
     where event.opportunity_id = '1ead5519-1000-4000-8000-000000000510'
  )
  and not exists (
    select 1 from public.projects project
     where project.opportunity_ref = '1ead5519-1000-4000-8000-000000000510'
        or project.opportunity_id = '1ead5519-1000-4000-8000-000000000510'
  )
from lead_assignment_contract_values v
where v.value_name = 'away_back_stale_conversion';

-- Task 2 child/context authorization contract. These fixtures prove that
-- assignment scope follows the opportunity through each child surface, while
-- strong project access remains an independent OR path and mailbox data
-- requires the lead + inbox intersection.
insert into lead_assignment_contract_results (check_name, passed)
values
  (
    'child_scope_public_contracts_and_grants_exist',
    to_regprocedure(
      'public.list_opportunity_assignment_candidates(uuid)'
    ) is not null
    and to_regprocedure(
      'public.get_opportunity_assigned_context(uuid)'
    ) is not null
    and has_function_privilege(
      'authenticated',
      'public.list_opportunity_assignment_candidates(uuid)',
      'execute'
    )
    and has_function_privilege(
      'authenticated',
      'public.get_opportunity_assigned_context(uuid)',
      'execute'
    )
    and not has_function_privilege(
      'service_role',
      'public.list_opportunity_assignment_candidates(uuid)',
      'execute'
    )
    and not has_function_privilege(
      'service_role',
      'public.get_opportunity_assigned_context(uuid)',
      'execute'
    )
  ),
  (
    'lead_linked_child_tables_have_restrictive_select_scope',
    (
      select count(*) = 4
        from pg_catalog.pg_policies p
       where p.schemaname = 'public'
         and p.tablename in (
           'activities', 'follow_ups', 'site_visits', 'deck_designs'
         )
         and p.policyname = 'assigned_lead_scope_select'
         and p.permissive = 'RESTRICTIVE'
    )
    and exists (
      select 1
        from pg_catalog.pg_policies p
       where p.schemaname = 'public'
         and p.tablename = 'activity_comments'
         and p.policyname = 'assigned_parent_scope_select'
         and p.permissive = 'RESTRICTIVE'
    )
    and (
      select count(*) = 3
        from pg_catalog.pg_policies p
       where p.schemaname = 'public'
         and p.tablename in (
           'stage_transitions',
           'opportunity_lifecycle_state',
           'opportunity_lifecycle_action_audit'
         )
         and p.policyname in (
           'assigned_lead_scope_select', 'authorized_lead_select'
         )
    )
  ),
  (
    'email_surfaces_have_restrictive_lead_inbox_intersection',
    (
      select count(*) = 5
        from pg_catalog.pg_policies p
       where p.schemaname = 'public'
         and p.tablename in (
           'opportunity_correspondence_events',
           'opportunity_follow_up_drafts',
           'email_threads',
           'opportunity_email_threads',
           'email_thread_category_corrections'
         )
         and p.policyname = 'lead_inbox_scope_select'
    )
    and (
      select count(*) = 2
        from pg_catalog.pg_policies p
       where p.schemaname = 'public'
         and p.tablename in ('email_threads', 'opportunity_email_threads')
         and p.policyname = 'lead_inbox_scope_select'
         and p.permissive = 'RESTRICTIVE'
    )
    and not has_table_privilege(
      'authenticated', 'public.email_threads', 'insert'
    )
    and not has_table_privilege(
      'authenticated', 'public.opportunity_email_threads', 'update'
    )
    and not exists (
      select 1
        from pg_catalog.pg_policies p
       where p.schemaname = 'public'
         and p.tablename = 'email_thread_category_corrections'
         and p.policyname = 'corrections_company_scope'
    )
  ),
  (
    'provider_queues_and_attachments_are_not_browser_readable',
    not has_table_privilege(
      'authenticated', 'public.ai_draft_history', 'select'
    )
    and not has_table_privilege(
      'authenticated', 'public.pending_auto_sends', 'select'
    )
    and not has_table_privilege(
      'authenticated', 'public.email_attachments', 'select'
    )
    and not has_table_privilege(
      'authenticated', 'public.email_outbound_learning_queue', 'select'
    )
  ),
  (
    'stage_history_is_append_only_for_direct_roles',
    not has_table_privilege(
      'authenticated', 'public.stage_transitions', 'update'
    )
    and not has_table_privilege(
      'authenticated', 'public.stage_transitions', 'delete'
    )
    and not has_table_privilege(
      'service_role', 'public.stage_transitions', 'update'
    )
    and not has_table_privilege(
      'service_role', 'public.stage_transitions', 'delete'
    )
  );

insert into public.role_permissions (role_id, permission, scope)
values
  (
    '1ead5519-0000-4000-8000-000000000201',
    'inbox.view',
    'assigned'
  ),
  (
    '1ead5519-0000-4000-8000-000000000201',
    'inbox.send',
    'assigned'
  ),
  (
    '1ead5519-0000-4000-8000-000000000201',
    'deck_builder.view',
    'assigned'
  ),
  (
    '1ead5519-0000-4000-8000-000000000201',
    'deck_builder.create',
    'assigned'
  ),
  (
    '1ead5519-0000-4000-8000-000000000201',
    'deck_builder.edit',
    'assigned'
  ),
  (
    '1ead5519-0000-4000-8000-000000000202',
    'inbox.view',
    'all'
  ),
  (
    '1ead5519-0000-4000-8000-000000000202',
    'inbox.send',
    'all'
  );

insert into public.email_connections (
  id, company_id, type, user_id, email, access_token, refresh_token,
  expires_at, sync_enabled, status
) values (
  '1ead5519-1000-4000-8000-000000000903',
  '1ead5519-0000-4000-8000-000000000001',
  'individual',
  '1ead5519-0000-4000-8000-000000000101',
  'assigned-actor-personal-mailbox@example.invalid',
  'rollback-personal-access-token',
  'rollback-personal-refresh-token',
  now() + interval '1 day',
  true,
  'active'
);

update public.clients
   set notes = 'CHILD_SCOPE_CLIENT_SECRET'
 where id = '1ead5519-0000-4000-8000-000000000401';

insert into public.estimates (
  id, company_id, opportunity_id, client_id, estimate_number, title,
  internal_notes, qb_id, subtotal, tax_amount, total, status
) values
  (
    '1ead5519-2000-4000-8000-000000000691',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000503',
    '1ead5519-0000-4000-8000-000000000401',
    'EST-CHILD-SCOPE-001',
    'Assigned context estimate',
    'CHILD_SCOPE_ESTIMATE_SECRET',
    'CHILD_SCOPE_QB_SECRET',
    1000, 120, 1120, 'sent'
  ),
  (
    '1ead5519-2000-4000-8000-000000000692',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000501',
    '1ead5519-0000-4000-8000-000000000401',
    'EST-CHILD-SCOPE-002',
    'Sibling context estimate',
    'CHILD_SCOPE_SIBLING_ESTIMATE_SECRET',
    'CHILD_SCOPE_SIBLING_QB_SECRET',
    2000, 240, 2240, 'sent'
  );

insert into public.activities (
  id, company_id, opportunity_id, project_id, type, subject, content,
  email_connection_id, email_thread_id
) values
  (
    '1ead5519-2000-4000-8000-000000000601',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000503',
    null, 'note', 'Assigned lead note', 'assigned-note', null, null
  ),
  (
    '1ead5519-2000-4000-8000-000000000602',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000501',
    null, 'note', 'Sibling lead note', 'sibling-note', null, null
  ),
  (
    '1ead5519-2000-4000-8000-000000000603',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000503',
    null, 'email', 'Assigned lead email', 'assigned-email',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-child-scope-a'
  ),
  (
    '1ead5519-2000-4000-8000-000000000604',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000501',
    null, 'email', 'Sibling lead email', 'sibling-email',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-child-scope-b'
  ),
  (
    '1ead5519-2000-4000-8000-000000000605',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000506',
    '1ead5519-1000-4000-8000-000000000802',
    'note', 'Project path note', 'project-path', null, null
  ),
  (
    '1ead5519-2000-4000-8000-000000000608',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000501',
    '1ead5519-1000-4000-8000-000000000802',
    'note', 'Legacy mismatched activity', 'must remain immutable', null, null
  );

insert into public.activity_comments (
  id, company_id, activity_id, user_id, content
) values
  (
    '1ead5519-2000-4000-8000-000000000701',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-2000-4000-8000-000000000601',
    '1ead5519-0000-4000-8000-000000000101',
    'Assigned activity comment'
  ),
  (
    '1ead5519-2000-4000-8000-000000000702',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-2000-4000-8000-000000000602',
    '1ead5519-0000-4000-8000-000000000103',
    'Sibling activity comment'
  ),
  (
    '1ead5519-2000-4000-8000-000000000703',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-2000-4000-8000-000000000605',
    '1ead5519-0000-4000-8000-000000000101',
    'Project path activity comment'
  );

insert into public.follow_ups (
  id, company_id, opportunity_id, type, title, due_at
) values
  (
    '1ead5519-2000-4000-8000-000000000611',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000503',
    'call', 'Assigned lead follow-up', now() + interval '1 day'
  ),
  (
    '1ead5519-2000-4000-8000-000000000612',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000501',
    'call', 'Sibling lead follow-up', now() + interval '1 day'
  );

insert into public.stage_transitions (
  id, company_id, opportunity_id, from_stage, to_stage
) values
  (
    '1ead5519-2000-4000-8000-000000000621',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000503',
    'qualifying', 'quoting'
  ),
  (
    '1ead5519-2000-4000-8000-000000000622',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000501',
    'new_lead', 'qualifying'
  );

insert into public.site_visits (
  id, company_id, opportunity_id, project_id, project_ref, scheduled_at,
  created_by
) values
  (
    '1ead5519-2000-4000-8000-000000000631',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000503',
    null, null, now() + interval '2 days',
    '1ead5519-0000-4000-8000-000000000101'
  ),
  (
    '1ead5519-2000-4000-8000-000000000632',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000501',
    null, null, now() + interval '2 days',
    '1ead5519-0000-4000-8000-000000000103'
  ),
  (
    '1ead5519-2000-4000-8000-000000000633',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000506',
    '1ead5519-1000-4000-8000-000000000802',
    '1ead5519-1000-4000-8000-000000000802',
    now() + interval '3 days',
    '1ead5519-0000-4000-8000-000000000101'
  ),
  (
    '1ead5519-2000-4000-8000-000000000636',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000501',
    '1ead5519-1000-4000-8000-000000000802',
    '1ead5519-1000-4000-8000-000000000802',
    now() + interval '6 days',
    '1ead5519-0000-4000-8000-000000000101'
  );

insert into public.deck_designs (
  id, company_id, opportunity_id, project_id, title, drawing_data
) values
  (
    '1ead5519-2000-4000-8000-000000000641',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000503',
    null, 'Assigned lead deck', '{}'::jsonb
  ),
  (
    '1ead5519-2000-4000-8000-000000000642',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000501',
    null, 'Sibling lead deck', '{}'::jsonb
  ),
  (
    '1ead5519-2000-4000-8000-000000000643',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000506',
    '1ead5519-1000-4000-8000-000000000802',
    'Project path deck', '{}'::jsonb
  ),
  (
    '1ead5519-2000-4000-8000-000000000646',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000501',
    '1ead5519-1000-4000-8000-000000000802',
    'Legacy mismatched deck', '{}'::jsonb
  );

insert into public.email_threads (
  id, company_id, connection_id, provider_thread_id, subject,
  first_message_at, last_message_at, opportunity_id, client_id
) values
  (
    '1ead5519-2000-4000-8000-000000000651',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-child-scope-a', 'Assigned email thread', now(), now(),
    '1ead5519-0000-4000-8000-000000000503',
    '1ead5519-0000-4000-8000-000000000401'
  ),
  (
    '1ead5519-2000-4000-8000-000000000652',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-child-scope-b', 'Sibling email thread', now(), now(),
    '1ead5519-0000-4000-8000-000000000501',
    '1ead5519-0000-4000-8000-000000000401'
  ),
  (
    '1ead5519-2000-4000-8000-000000000653',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000903',
    'provider-thread-child-scope-personal',
    'Own personal mailbox thread', now(), now(), null, null
  ),
  (
    '1ead5519-2000-4000-8000-000000000654',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-child-scope-company-unlinked',
    'Unlinked company mailbox thread', now(), now(), null, null
  );

insert into public.email_thread_category_corrections (
  id, company_id, thread_id, user_id, from_category, to_category,
  sender_email, sender_domain, participants_hash, subject_keywords, note
) values
  (
    '1ead5519-2000-4000-8000-000000000711',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-2000-4000-8000-000000000651',
    '1ead5519-0000-4000-8000-000000000101',
    'OTHER', 'LEAD', 'assigned@example.invalid', 'example.invalid',
    'assigned-participants', array['assigned']::text[], 'Assigned correction'
  ),
  (
    '1ead5519-2000-4000-8000-000000000712',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-2000-4000-8000-000000000652',
    '1ead5519-0000-4000-8000-000000000103',
    'OTHER', 'LEAD', 'sibling@example.invalid', 'example.invalid',
    'sibling-participants', array['sibling']::text[], 'Sibling correction'
  ),
  (
    '1ead5519-2000-4000-8000-000000000713',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-2000-4000-8000-000000000653',
    '1ead5519-0000-4000-8000-000000000101',
    'OTHER', 'LEAD', 'personal@example.invalid', 'example.invalid',
    'personal-participants', array['personal']::text[], 'Personal correction'
  ),
  (
    '1ead5519-2000-4000-8000-000000000714',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-2000-4000-8000-000000000654',
    '1ead5519-0000-4000-8000-000000000101',
    'OTHER', 'LEAD', 'company@example.invalid', 'example.invalid',
    'company-participants', array['company']::text[], 'Company correction'
  );

insert into public.opportunity_email_threads (
  id, opportunity_id, thread_id, connection_id
) values
  (
    '1ead5519-2000-4000-8000-000000000661',
    '1ead5519-0000-4000-8000-000000000503',
    'provider-thread-child-scope-a',
    '1ead5519-1000-4000-8000-000000000901'
  ),
  (
    '1ead5519-2000-4000-8000-000000000662',
    '1ead5519-0000-4000-8000-000000000501',
    'provider-thread-child-scope-b',
    '1ead5519-1000-4000-8000-000000000901'
  );

insert into public.opportunity_correspondence_events (
  id, company_id, opportunity_id, connection_id, provider_thread_id,
  provider_message_id, direction, party_role, is_meaningful, occurred_at,
  source, subject
) values
  (
    '1ead5519-2000-4000-8000-000000000671',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000503',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-child-scope-a', 'provider-message-child-scope-a',
    'inbound', 'customer', true, now(), 'lead_assignment_contract',
    'Assigned correspondence'
  ),
  (
    '1ead5519-2000-4000-8000-000000000672',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000501',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-child-scope-b', 'provider-message-child-scope-b',
    'inbound', 'customer', true, now(), 'lead_assignment_contract',
    'Sibling correspondence'
  );

insert into public.opportunity_follow_up_drafts (
  id, company_id, opportunity_id, connection_id, provider_thread_id,
  origin, subject, original_body
) values
  (
    '1ead5519-2000-4000-8000-000000000681',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000503',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-child-scope-a', 'operator',
    'Assigned draft', 'Assigned draft body'
  ),
  (
    '1ead5519-2000-4000-8000-000000000682',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000501',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-child-scope-b', 'operator',
    'Sibling draft', 'Sibling draft body'
  );

select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

insert into lead_assignment_contract_values (value_name, value)
values (
  'project_path_lead_reassigned',
  public.change_opportunity_assignment_as_system(
    '1ead5519-1000-4000-8000-000000000506',
    1,
    '1ead5519-0000-4000-8000-000000000101',
    '1ead5519-0000-4000-8000-000000000103',
    'system_repair',
    null,
    null,
    '{"contract_case":"project_path_only"}'::jsonb
  )
);

do $contract$
begin
  begin
    update public.activities
       set opportunity_id = '1ead5519-0000-4000-8000-000000000501'
     where id = '1ead5519-2000-4000-8000-000000000601';
    insert into lead_assignment_contract_results values (
      'direct_child_reparent_is_token_guarded',
      false,
      'update unexpectedly succeeded'
    );
  exception when sqlstate '42501' then
    insert into lead_assignment_contract_results values (
      'direct_child_reparent_is_token_guarded',
      sqlerrm = 'child_reparent_forbidden',
      sqlerrm
    );
  end;
end;
$contract$;

reset role;

insert into lead_assignment_contract_results (check_name, passed)
values (
  'failed_reparent_leaves_child_on_original_lead',
  exists (
    select 1
      from public.activities a
     where a.id = '1ead5519-2000-4000-8000-000000000601'
       and a.opportunity_id = '1ead5519-0000-4000-8000-000000000503'
  )
);

insert into lead_assignment_contract_results (check_name, passed, details)
select
  'project_path_lead_is_reassigned_away_before_child_scope_checks',
  (v.value ->> 'ok')::boolean
  and not (v.value ->> 'conflict')::boolean
  and (v.value ->> 'assigned_to')::uuid =
    '1ead5519-0000-4000-8000-000000000103'
  and exists (
    select 1
      from public.opportunities o
      join public.projects p on p.id = coalesce(o.project_ref, o.project_id)
     where o.id = '1ead5519-1000-4000-8000-000000000506'
       and p.id = '1ead5519-1000-4000-8000-000000000802'
       and (
         p.opportunity_ref = o.id
         or private.try_parse_uuid(p.opportunity_id) = o.id
       )
  ),
  v.value::text
from lead_assignment_contract_values v
where v.value_name = 'project_path_lead_reassigned';

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', '1ead5519-0000-4000-8000-000000000901',
    'email', 'lead-contract-assigned@example.invalid'
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '1ead5519-0000-4000-8000-000000000901',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $contract$
declare
  v_rows integer;
begin
  begin
    insert into public.activities (
      id, company_id, opportunity_id, project_id, type, subject, content
    ) values (
      '1ead5519-2000-4000-8000-000000000606',
      '1ead5519-0000-4000-8000-000000000001',
      '1ead5519-0000-4000-8000-000000000501',
      '1ead5519-1000-4000-8000-000000000802',
      'note', 'Mismatched project activity', 'must not persist'
    );
    raise exception 'mismatched activity insert unexpectedly succeeded'
      using errcode = 'P0001';
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'mismatched_activity_dual_parent_insert_rejected', true, sqlerrm
      );
    when sqlstate 'P0001' then
      insert into lead_assignment_contract_results values (
        'mismatched_activity_dual_parent_insert_rejected', false, sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'mismatched_activity_dual_parent_insert_rejected',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;

  begin
    insert into public.site_visits (
      id, company_id, opportunity_id, project_id, project_ref, scheduled_at,
      created_by
    ) values (
      '1ead5519-2000-4000-8000-000000000634',
      '1ead5519-0000-4000-8000-000000000001',
      '1ead5519-0000-4000-8000-000000000501',
      '1ead5519-1000-4000-8000-000000000802',
      '1ead5519-1000-4000-8000-000000000802',
      now() + interval '4 days',
      '1ead5519-0000-4000-8000-000000000101'
    );
    raise exception 'mismatched site visit insert unexpectedly succeeded'
      using errcode = 'P0001';
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'mismatched_site_visit_dual_parent_insert_rejected', true, sqlerrm
      );
    when sqlstate 'P0001' then
      insert into lead_assignment_contract_results values (
        'mismatched_site_visit_dual_parent_insert_rejected', false, sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'mismatched_site_visit_dual_parent_insert_rejected',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;

  begin
    insert into public.deck_designs (
      id, company_id, opportunity_id, project_id, title, drawing_data
    ) values (
      '1ead5519-2000-4000-8000-000000000644',
      '1ead5519-0000-4000-8000-000000000001',
      '1ead5519-0000-4000-8000-000000000501',
      '1ead5519-1000-4000-8000-000000000802',
      'Mismatched project deck', '{}'::jsonb
    );
    raise exception 'mismatched deck insert unexpectedly succeeded'
      using errcode = 'P0001';
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'mismatched_deck_dual_parent_insert_rejected', true, sqlerrm
      );
    when sqlstate 'P0001' then
      insert into lead_assignment_contract_results values (
        'mismatched_deck_dual_parent_insert_rejected', false, sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'mismatched_deck_dual_parent_insert_rejected',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;

  begin
    update public.activities
       set content = 'Must not update mismatched activity'
     where id = '1ead5519-2000-4000-8000-000000000608';
    get diagnostics v_rows = row_count;
    if v_rows <> 0 then
      raise exception 'mismatched activity update unexpectedly succeeded'
        using errcode = 'P0001';
    end if;
    insert into lead_assignment_contract_results values (
      'mismatched_activity_dual_parent_update_rejected', true, null
    );
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'mismatched_activity_dual_parent_update_rejected', true, sqlerrm
      );
    when sqlstate 'P0001' then
      insert into lead_assignment_contract_results values (
        'mismatched_activity_dual_parent_update_rejected', false, sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'mismatched_activity_dual_parent_update_rejected',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;

  begin
    update public.site_visits
       set notes = 'Must not update mismatched site visit'
     where id = '1ead5519-2000-4000-8000-000000000636';
    get diagnostics v_rows = row_count;
    if v_rows <> 0 then
      raise exception 'mismatched site visit update unexpectedly succeeded'
        using errcode = 'P0001';
    end if;
    insert into lead_assignment_contract_results values (
      'mismatched_site_visit_dual_parent_update_rejected', true, null
    );
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'mismatched_site_visit_dual_parent_update_rejected', true, sqlerrm
      );
    when sqlstate 'P0001' then
      insert into lead_assignment_contract_results values (
        'mismatched_site_visit_dual_parent_update_rejected', false, sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'mismatched_site_visit_dual_parent_update_rejected',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;

  begin
    update public.deck_designs
       set title = 'Must not update mismatched deck'
     where id = '1ead5519-2000-4000-8000-000000000646';
    get diagnostics v_rows = row_count;
    if v_rows <> 0 then
      raise exception 'mismatched deck update unexpectedly succeeded'
        using errcode = 'P0001';
    end if;
    insert into lead_assignment_contract_results values (
      'mismatched_deck_dual_parent_update_rejected', true, null
    );
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'mismatched_deck_dual_parent_update_rejected', true, sqlerrm
      );
    when sqlstate 'P0001' then
      insert into lead_assignment_contract_results values (
        'mismatched_deck_dual_parent_update_rejected', false, sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'mismatched_deck_dual_parent_update_rejected',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;

  begin
    insert into public.activity_comments (
      id, company_id, activity_id, user_id, content
    ) values (
      '1ead5519-2000-4000-8000-000000000704',
      '1ead5519-0000-4000-8000-000000000001',
      '1ead5519-2000-4000-8000-000000000602',
      '1ead5519-0000-4000-8000-000000000101',
      'Must not reach sibling activity'
    );
    raise exception 'sibling activity comment insert unexpectedly succeeded'
      using errcode = 'P0001';
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'sibling_activity_comment_insert_rejected', true, sqlerrm
      );
    when sqlstate 'P0001' then
      insert into lead_assignment_contract_results values (
        'sibling_activity_comment_insert_rejected', false, sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'sibling_activity_comment_insert_rejected',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;

  begin
    update public.activity_comments
       set content = 'Must not update sibling activity comment'
     where id = '1ead5519-2000-4000-8000-000000000702';
    get diagnostics v_rows = row_count;
    if v_rows <> 0 then
      raise exception 'sibling activity comment update unexpectedly succeeded'
        using errcode = 'P0001';
    end if;
    insert into lead_assignment_contract_results values (
      'sibling_activity_comment_update_rejected', true, null
    );
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'sibling_activity_comment_update_rejected', true, sqlerrm
      );
    when sqlstate 'P0001' then
      insert into lead_assignment_contract_results values (
        'sibling_activity_comment_update_rejected', false, sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'sibling_activity_comment_update_rejected',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;

  begin
    delete from public.activity_comments
     where id = '1ead5519-2000-4000-8000-000000000702';
    get diagnostics v_rows = row_count;
    if v_rows <> 0 then
      raise exception 'sibling activity comment delete unexpectedly succeeded'
        using errcode = 'P0001';
    end if;
    insert into lead_assignment_contract_results values (
      'sibling_activity_comment_delete_rejected', true, null
    );
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'sibling_activity_comment_delete_rejected', true, sqlerrm
      );
    when sqlstate 'P0001' then
      insert into lead_assignment_contract_results values (
        'sibling_activity_comment_delete_rejected', false, sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'sibling_activity_comment_delete_rejected',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;

  begin
    insert into public.email_thread_category_corrections (
      id, company_id, thread_id, user_id, from_category, to_category
    ) values (
      '1ead5519-2000-4000-8000-000000000715',
      '1ead5519-0000-4000-8000-000000000001',
      '1ead5519-2000-4000-8000-000000000652',
      '1ead5519-0000-4000-8000-000000000101',
      'OTHER', 'LEAD'
    );
    raise exception 'sibling correction insert unexpectedly succeeded'
      using errcode = 'P0001';
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'sibling_thread_correction_insert_rejected', true, sqlerrm
      );
    when sqlstate 'P0001' then
      insert into lead_assignment_contract_results values (
        'sibling_thread_correction_insert_rejected', false, sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'sibling_thread_correction_insert_rejected',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;

  begin
    insert into public.email_thread_category_corrections (
      id, company_id, thread_id, user_id, from_category, to_category
    ) values (
      '1ead5519-2000-4000-8000-000000000716',
      '1ead5519-0000-4000-8000-000000000001',
      '1ead5519-2000-4000-8000-000000000651',
      '1ead5519-0000-4000-8000-000000000102',
      'OTHER', 'LEAD'
    );
    raise exception 'correction author spoof unexpectedly succeeded'
      using errcode = 'P0001';
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'thread_correction_author_spoof_rejected', true, sqlerrm
      );
    when sqlstate 'P0001' then
      insert into lead_assignment_contract_results values (
        'thread_correction_author_spoof_rejected', false, sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'thread_correction_author_spoof_rejected',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;

  begin
    update public.email_thread_category_corrections
       set note = 'Must not update sibling correction'
     where id = '1ead5519-2000-4000-8000-000000000712';
    get diagnostics v_rows = row_count;
    if v_rows <> 0 then
      raise exception 'sibling correction update unexpectedly succeeded'
        using errcode = 'P0001';
    end if;
    insert into lead_assignment_contract_results values (
      'sibling_thread_correction_update_rejected', true, null
    );
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'sibling_thread_correction_update_rejected', true, sqlerrm
      );
    when sqlstate 'P0001' then
      insert into lead_assignment_contract_results values (
        'sibling_thread_correction_update_rejected', false, sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'sibling_thread_correction_update_rejected',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;

  begin
    delete from public.email_thread_category_corrections
     where id = '1ead5519-2000-4000-8000-000000000712';
    get diagnostics v_rows = row_count;
    if v_rows <> 0 then
      raise exception 'sibling correction delete unexpectedly succeeded'
        using errcode = 'P0001';
    end if;
    insert into lead_assignment_contract_results values (
      'sibling_thread_correction_delete_rejected', true, null
    );
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'sibling_thread_correction_delete_rejected', true, sqlerrm
      );
    when sqlstate 'P0001' then
      insert into lead_assignment_contract_results values (
        'sibling_thread_correction_delete_rejected', false, sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'sibling_thread_correction_delete_rejected',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;
end;
$contract$;

insert into public.activities (
  id, company_id, opportunity_id, project_id, type, subject, content
) values (
  '1ead5519-2000-4000-8000-000000000607',
  '1ead5519-0000-4000-8000-000000000001',
  '1ead5519-1000-4000-8000-000000000506',
  '1ead5519-1000-4000-8000-000000000802',
  'note', 'Authorized project path activity', 'relationship-valid'
);

insert into public.site_visits (
  id, company_id, opportunity_id, project_id, project_ref, scheduled_at,
  created_by
) values (
  '1ead5519-2000-4000-8000-000000000635',
  '1ead5519-0000-4000-8000-000000000001',
  '1ead5519-1000-4000-8000-000000000506',
  '1ead5519-1000-4000-8000-000000000802',
  '1ead5519-1000-4000-8000-000000000802',
  now() + interval '5 days',
  '1ead5519-0000-4000-8000-000000000101'
);

insert into public.deck_designs (
  id, company_id, opportunity_id, project_id, title, drawing_data
) values (
  '1ead5519-2000-4000-8000-000000000645',
  '1ead5519-0000-4000-8000-000000000001',
  '1ead5519-1000-4000-8000-000000000506',
  '1ead5519-1000-4000-8000-000000000802',
  'Authorized project path deck', '{}'::jsonb
);

insert into public.activity_comments (
  id, company_id, activity_id, user_id, content
) values (
  '1ead5519-2000-4000-8000-000000000705',
  '1ead5519-0000-4000-8000-000000000001',
  '1ead5519-2000-4000-8000-000000000601',
  '1ead5519-0000-4000-8000-000000000101',
  'Authorized assigned activity comment'
);

insert into public.email_thread_category_corrections (
  id, company_id, thread_id, user_id, from_category, to_category, note
) values (
  '1ead5519-2000-4000-8000-000000000717',
  '1ead5519-0000-4000-8000-000000000001',
  '1ead5519-2000-4000-8000-000000000651',
  '1ead5519-0000-4000-8000-000000000101',
  'OTHER', 'LEAD', 'Authorized correction'
);

insert into lead_assignment_contract_values (value_name, value)
values
  (
    'assigned_child_context',
    public.get_opportunity_assigned_context(
      '1ead5519-0000-4000-8000-000000000503'
    )
  ),
  (
    'assigned_candidate_list',
    public.list_opportunity_assignment_candidates(
      '1ead5519-0000-4000-8000-000000000503'
    )
  );

insert into lead_assignment_contract_results (check_name, passed)
values
  (
    'assigned_actor_sees_only_own_lead_children_plus_project_path',
    (
      select count(*) = 3
        from public.activities a
       where a.id in (
         '1ead5519-2000-4000-8000-000000000601',
         '1ead5519-2000-4000-8000-000000000602',
         '1ead5519-2000-4000-8000-000000000603',
         '1ead5519-2000-4000-8000-000000000604',
         '1ead5519-2000-4000-8000-000000000605'
       )
    )
    and (
      select count(*) = 1
        from public.follow_ups f
       where f.id in (
         '1ead5519-2000-4000-8000-000000000611',
         '1ead5519-2000-4000-8000-000000000612'
       )
    )
    and (
      select count(*) = 1
        from public.stage_transitions st
       where st.id in (
         '1ead5519-2000-4000-8000-000000000621',
         '1ead5519-2000-4000-8000-000000000622'
       )
    )
    and (
      select count(*) = 2
        from public.site_visits sv
       where sv.id in (
         '1ead5519-2000-4000-8000-000000000631',
         '1ead5519-2000-4000-8000-000000000632',
         '1ead5519-2000-4000-8000-000000000633'
       )
    )
    and (
      select count(*) = 2
        from public.deck_designs dd
       where dd.id in (
         '1ead5519-2000-4000-8000-000000000641',
         '1ead5519-2000-4000-8000-000000000642',
         '1ead5519-2000-4000-8000-000000000643'
       )
    )
    and not exists (
      select 1
        from public.opportunities o
       where o.id = '1ead5519-1000-4000-8000-000000000506'
    )
    and exists (
      select 1
        from public.projects p
       where p.id = '1ead5519-1000-4000-8000-000000000802'
    )
    and exists (
      select 1
        from public.activities a
       where a.id = '1ead5519-2000-4000-8000-000000000607'
    )
    and exists (
      select 1
        from public.site_visits sv
       where sv.id = '1ead5519-2000-4000-8000-000000000635'
    )
    and exists (
      select 1
        from public.deck_designs dd
       where dd.id = '1ead5519-2000-4000-8000-000000000645'
    )
  ),
  (
    'activity_comments_follow_parent_view_and_allow_authorized_write',
    (
      select count(*) = 2
        from public.activity_comments ac
       where ac.id in (
         '1ead5519-2000-4000-8000-000000000701',
         '1ead5519-2000-4000-8000-000000000702',
         '1ead5519-2000-4000-8000-000000000703'
       )
    )
    and exists (
      select 1
        from public.activity_comments ac
       where ac.id = '1ead5519-2000-4000-8000-000000000705'
    )
  ),
  (
    'assigned_actor_email_reads_require_lead_and_inbox_scope_and_keep_own_mailbox',
    (
      select count(*) = 2
        from public.email_threads et
       where et.id in (
         '1ead5519-2000-4000-8000-000000000651',
         '1ead5519-2000-4000-8000-000000000652',
         '1ead5519-2000-4000-8000-000000000653',
         '1ead5519-2000-4000-8000-000000000654'
       )
    )
    and exists (
      select 1
        from public.email_threads et
       where et.id = '1ead5519-2000-4000-8000-000000000651'
    )
    and exists (
      select 1
        from public.email_threads et
       where et.id = '1ead5519-2000-4000-8000-000000000653'
    )
    and not exists (
      select 1
        from public.email_threads et
       where et.id = '1ead5519-2000-4000-8000-000000000652'
    )
    and not exists (
      select 1
        from public.email_threads et
       where et.id = '1ead5519-2000-4000-8000-000000000654'
    )
    and (
      select count(*) = 1
        from public.opportunity_email_threads oet
       where oet.id in (
         '1ead5519-2000-4000-8000-000000000661',
         '1ead5519-2000-4000-8000-000000000662'
       )
    )
    and (
      select count(*) = 1
        from public.opportunity_correspondence_events ce
       where ce.id in (
         '1ead5519-2000-4000-8000-000000000671',
         '1ead5519-2000-4000-8000-000000000672'
       )
    )
    and (
      select count(*) = 1
        from public.opportunity_follow_up_drafts d
       where d.id in (
         '1ead5519-2000-4000-8000-000000000681',
         '1ead5519-2000-4000-8000-000000000682'
       )
    )
    and (
      select count(*) = 3
        from public.email_thread_category_corrections c
       where c.id in (
         '1ead5519-2000-4000-8000-000000000711',
         '1ead5519-2000-4000-8000-000000000712',
         '1ead5519-2000-4000-8000-000000000713',
         '1ead5519-2000-4000-8000-000000000714',
         '1ead5519-2000-4000-8000-000000000717'
       )
    )
    and not exists (
      select 1
        from public.email_thread_category_corrections c
       where c.id in (
         '1ead5519-2000-4000-8000-000000000712',
         '1ead5519-2000-4000-8000-000000000714'
       )
    )
  ),
  (
    'prior_assignee_keeps_recipient_delivery_but_not_assignment_audit',
    exists (
      select 1
        from public.opportunity_assignment_deliveries d
       where d.opportunity_id = '1ead5519-0000-4000-8000-000000000501'
         and d.recipient_user_id = '1ead5519-0000-4000-8000-000000000101'
         and not d.access_after
    )
    and not exists (
      select 1
      from public.opportunity_assignment_events e
       where e.opportunity_id = '1ead5519-0000-4000-8000-000000000501'
    )
  ),
  (
    'assigned_send_allows_shared_and_own_personal_mailboxes',
    private.current_user_can_send_opportunity_inbox(
      '1ead5519-0000-4000-8000-000000000503',
      '1ead5519-1000-4000-8000-000000000901'
    )
    and private.current_user_can_send_opportunity_inbox(
      '1ead5519-0000-4000-8000-000000000503',
      '1ead5519-1000-4000-8000-000000000903'
    )
  );

reset role;

insert into lead_assignment_contract_results (check_name, passed, details)
select
  'assigned_context_is_whitelisted_and_exact_parent_only',
  v.value -> 'contact' ->> 'email' = 'lead-contract-client@example.invalid'
  and v.value -> 'estimate_summaries' @> jsonb_build_array(
    jsonb_build_object('id', '1ead5519-2000-4000-8000-000000000691')
  )
  and not v.value -> 'estimate_summaries' @> jsonb_build_array(
    jsonb_build_object('id', '1ead5519-2000-4000-8000-000000000692')
  )
  and v.value -> 'activities' @> jsonb_build_array(
    jsonb_build_object('id', '1ead5519-2000-4000-8000-000000000601')
  )
  and not v.value -> 'activities' @> jsonb_build_array(
    jsonb_build_object('id', '1ead5519-2000-4000-8000-000000000602')
  )
  and v.value::text not like '%CHILD_SCOPE_CLIENT_SECRET%'
  and v.value::text not like '%CHILD_SCOPE_ESTIMATE_SECRET%'
  and v.value::text not like '%CHILD_SCOPE_QB_SECRET%'
  and v.value::text not like '%CHILD_SCOPE_SIBLING_ESTIMATE_SECRET%'
  and v.value::text not like '%CHILD_SCOPE_SIBLING_QB_SECRET%',
  v.value::text
from lead_assignment_contract_values v
where v.value_name = 'assigned_child_context';

insert into lead_assignment_contract_results (check_name, passed, details)
select
  'assigned_candidate_list_is_minimal_and_guard_compatible',
  not (v.value ->> 'can_unassign')::boolean
  and v.value -> 'candidates' @> jsonb_build_array(
    jsonb_build_object('id', '1ead5519-0000-4000-8000-000000000103')
  )
  and not v.value -> 'candidates' @> jsonb_build_array(
    jsonb_build_object('id', '1ead5519-0000-4000-8000-000000000104')
  )
  and not v.value -> 'candidates' @> jsonb_build_array(
    jsonb_build_object('id', '1ead5519-0000-4000-8000-000000000105')
  )
  and not v.value -> 'candidates' @> jsonb_build_array(
    jsonb_build_object('id', '1ead5519-0000-4000-8000-000000000106')
  )
  and v.value::text not like '%@example.invalid%',
  v.value::text
from lead_assignment_contract_values v
where v.value_name = 'assigned_candidate_list';

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', '1ead5519-0000-4000-8000-000000000903',
    'email', 'lead-contract-target@example.invalid'
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '1ead5519-0000-4000-8000-000000000903',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

insert into lead_assignment_contract_results (check_name, passed)
values (
  'lead_access_without_inbox_scope_hides_email_children',
  exists (
    select 1
      from public.activities a
     where a.id = '1ead5519-2000-4000-8000-000000000602'
  )
  and exists (
    select 1
      from public.activity_comments ac
     where ac.id = '1ead5519-2000-4000-8000-000000000702'
  )
  and not exists (
    select 1
      from public.activities a
     where a.id = '1ead5519-2000-4000-8000-000000000604'
  )
  and not exists (
    select 1
      from public.email_threads et
     where et.id = '1ead5519-2000-4000-8000-000000000652'
  )
  and not exists (
    select 1
      from public.opportunity_correspondence_events ce
     where ce.id = '1ead5519-2000-4000-8000-000000000672'
  )
  and not exists (
    select 1
      from public.email_thread_category_corrections c
     where c.id = '1ead5519-2000-4000-8000-000000000712'
  )
);

reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', '1ead5519-0000-4000-8000-000000000902',
    'email', 'lead-contract-all@example.invalid'
  )::text,
  true
);
select set_config(
  'request.jwt.claim.sub',
  '1ead5519-0000-4000-8000-000000000902',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

insert into lead_assignment_contract_results (check_name, passed)
values (
  'all_scope_send_cannot_use_another_users_personal_mailbox',
  private.current_user_can_send_opportunity_inbox(
    '1ead5519-0000-4000-8000-000000000503',
    '1ead5519-1000-4000-8000-000000000901'
  )
  and not private.current_user_can_send_opportunity_inbox(
    '1ead5519-0000-4000-8000-000000000503',
    '1ead5519-1000-4000-8000-000000000903'
  )
);

insert into lead_assignment_contract_values (value_name, value)
values (
  'all_candidate_list',
  public.list_opportunity_assignment_candidates(
    '1ead5519-0000-4000-8000-000000000503'
  )
);

reset role;

insert into lead_assignment_contract_results (check_name, passed, details)
select
  'all_scope_candidate_list_allows_unassign',
  (v.value ->> 'can_unassign')::boolean,
  v.value::text
from lead_assignment_contract_values v
where v.value_name = 'all_candidate_list';

-- Emit useful diagnostics, then make false checks fail the SQL runner.
select check_name, passed, details
from lead_assignment_contract_results
order by check_name;

do $contract$
declare
  v_failures text;
begin
  select string_agg(
    check_name || coalesce(' [' || details || ']', ''),
    ', '
    order by check_name
  )
  into v_failures
  from lead_assignment_contract_results
  where not passed;

  if v_failures is not null then
    raise exception 'lead_assignment_contract_failed: %', v_failures;
  end if;
end;
$contract$;

rollback;
