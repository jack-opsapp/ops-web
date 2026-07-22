-- Lead assignment and guarded conversion SQL contract.
--
-- Run this only after the complete hardened lead-lifecycle migration chain has
-- been applied to an isolated database. Every fixture and side effect lives in
-- one transaction and the successful path ends with ROLLBACK. Any failed check
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
  to anon, authenticated, service_role;
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

insert into lead_assignment_contract_results (check_name, passed)
values (
  'lead_summary_snapshot_rpc_is_service_only',
  to_regprocedure(
    'public.commit_lead_summary_snapshot(uuid,uuid,text,timestamptz,text,timestamptz,timestamptz,bigint,bigint,bigint,uuid)'
  ) is not null
  and has_function_privilege(
    'service_role',
    'public.commit_lead_summary_snapshot(uuid,uuid,text,timestamptz,text,timestamptz,timestamptz,bigint,bigint,bigint,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.commit_lead_summary_snapshot(uuid,uuid,text,timestamptz,text,timestamptz,timestamptz,bigint,bigint,bigint,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.commit_lead_summary_snapshot(uuid,uuid,text,timestamptz,text,timestamptz,timestamptz,bigint,bigint,bigint,uuid)',
    'execute'
  )
);

insert into lead_assignment_contract_results (check_name, passed)
values (
  'correspondence_insert_serialization_trigger_is_installed',
  exists (
    select 1
    from pg_catalog.pg_trigger trigger
    join pg_catalog.pg_class relation on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc function on function.oid = trigger.tgfoid
    join pg_catalog.pg_namespace function_namespace
      on function_namespace.oid = function.pronamespace
    where trigger.tgname =
      'opportunity_correspondence_events_lock_opportunity_insert'
      and not trigger.tgisinternal
      and namespace.nspname = 'public'
      and relation.relname = 'opportunity_correspondence_events'
      and function_namespace.nspname = 'private'
      and function.proname = 'lock_opportunity_for_correspondence_insert'
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
values
  (
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000001',
    'Lead Assignment Contract Client',
    'lead-contract-client@example.invalid'
  ),
  (
    '1ead5519-0000-4000-8000-000000000402',
    '1ead5519-0000-4000-8000-000000000001',
    'No Existing Project Contract Client',
    'no-project-contract-client@example.invalid'
  ),
  (
    '1ead5519-0000-4000-8000-000000000404',
    '1ead5519-0000-4000-8000-000000000001',
    'Client Ref Only Contract Client',
    'client-ref-only-contract@example.invalid'
  );

insert into public.sub_clients (
  id, client_id, company_id, name, email
) values (
  '1ead5519-0000-4000-8000-000000000403',
  '1ead5519-0000-4000-8000-000000000401',
  '1ead5519-0000-4000-8000-000000000001',
  'Lead Assignment Alternate Contact',
  'lead-contract-alternate@example.invalid'
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

-- The former assigned-only owner receives a state-free access-lost outcome.
-- The denied stale write must not expose the replacement or append history.
set local role authenticated;
do $contract$
begin
  begin
    perform public.change_opportunity_assignment(
      '1ead5519-0000-4000-8000-000000000501',
      1,
      '1ead5519-0000-4000-8000-000000000101',
      '1ead5519-0000-4000-8000-000000000101',
      'manual',
      null,
      '{}'::jsonb
    );
    insert into lead_assignment_contract_results values (
      'former_assignee_gets_state_free_access_lost',
      false,
      'call unexpectedly succeeded'
    );
  exception
    when sqlstate '42501' then
      insert into lead_assignment_contract_results values (
        'former_assignee_gets_state_free_access_lost',
        sqlerrm = 'assignment_access_lost',
        sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'former_assignee_gets_state_free_access_lost',
        false,
        sqlstate || ': ' || sqlerrm
      );
  end;
end;
$contract$;
reset role;

insert into lead_assignment_contract_results (check_name, passed)
values (
  'access_lost_attempt_writes_nothing',
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
  ),
  (
    '1ead5519-1000-4000-8000-000000000513',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000401',
    'Actorless Existing Project Lead', '83 Contract Ave', 'quoted',
    null, 0, 18000, array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000514',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000401',
    'Budget Timing Deferral Lead', '84 Contract Ave', 'quoted',
    null, 0, 3192.70, array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000515',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000401',
    'Monotonic Stage Lead', '85 Contract Ave', 'quoting',
    null, 0, 19000, array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000516',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000401',
    'Signed Estimate Lead', '86 Contract Ave', 'quoted',
    null, 0, 20000, array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000517',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000401',
    'Locality One-Way Link Lead', '2745 Fernwood Rd', 'quoted',
    null, 0, 21000, array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000518',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000401',
    'Conflicting Existing Project Lead', '88 Contract Ave', 'quoted',
    null, 0, 22000, array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000519',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000401',
    'Ambiguous Existing Project Lead', '89 Contract Ave', 'quoted',
    null, 0, 23000, array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000520',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000401',
    'Blank Address Existing Client Lead', null, 'quoted',
    null, 0, 24000, array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000521',
    '1ead5519-0000-4000-8000-000000000001',
    null, null,
    'Null Client Actorless Lead', '90 Contract Ave', 'quoted',
    null, 0, 25000, array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000522',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000402',
    '1ead5519-0000-4000-8000-000000000402',
    'Blank Address Empty Client Lead', null, 'quoted',
    null, 0, 26000, array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000523',
    '1ead5519-0000-4000-8000-000000000001',
    null,
    '1ead5519-0000-4000-8000-000000000404',
    'Client Ref Only Lead', '91 Contract Ave', 'quoted',
    null, 0, 27000, array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000524',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    '1ead5519-0000-4000-8000-000000000402',
    'Mismatched Client Mirror Lead', '92 Contract Ave', 'quoted',
    null, 0, 28000, array[]::text[]
  );

-- Prove the sender identity boundary accepts an opportunity-specific contact,
-- independently of the owning client's primary email.
update public.opportunities
   set contact_email = 'lead-contract-direct@example.invalid'
 where id = '1ead5519-1000-4000-8000-000000000507';

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

-- These rows include a deliberate same-client/address ambiguity. Ordinary
-- operator-created projects remain behavior-compatible; the email conversion
-- path must fail closed when its serialized scan finds more than one match.

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
  ),
  (
    '1ead5519-1000-4000-8000-000000000804',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    'Existing accepted project', false, '83 Contract Ave', 'accepted',
    array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000805',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    'Locality accepted project', false,
    '2745 Fernwood Road, Victoria BC', 'accepted', array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000806',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    'Conflicting accepted project', false, '88 Contract Ave', 'accepted',
    array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000807',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    'Ambiguous project A', false, '89 Contract Ave', 'rfq',
    array[]::text[]
  ),
  (
    '1ead5519-1000-4000-8000-000000000808',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000401',
    'Ambiguous project B', false, '89 Contract Ave', 'estimated',
    array[]::text[]
  );

-- Deliberately model a pre-conversion one-way link: the opportunity points at
-- an accepted project, but no conversion event/disposition or project reverse
-- link exists yet. Actorless acceptance must complete this canonical link and
-- win it, not mistake the pointer for a completed conversion or create a copy.
update public.opportunities
   set project_ref = '1ead5519-1000-4000-8000-000000000804',
       project_id = '1ead5519-1000-4000-8000-000000000804'
 where id = '1ead5519-1000-4000-8000-000000000513';

-- Rollback-only corruption fixtures: keep only the project-side mirror so the
-- actorless matcher must inspect linked rows. The production invariant remains
-- enabled everywhere outside these two deliberately skipped fixture updates.
select set_config('ops.skip_project_opportunity_invariant', 'on', true);
update public.projects
   set opportunity_ref = '1ead5519-1000-4000-8000-000000000517',
       opportunity_id = '1ead5519-1000-4000-8000-000000000517'
 where id = '1ead5519-1000-4000-8000-000000000805';
update public.projects
   set opportunity_ref = '1ead5519-1000-4000-8000-000000000507',
       opportunity_id = '1ead5519-1000-4000-8000-000000000507'
 where id = '1ead5519-1000-4000-8000-000000000806';
select set_config('ops.skip_project_opportunity_invariant', 'off', true);

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
  ),
  (
    '1ead5519-1000-4000-8000-000000000913',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-manual-stage-race', 'Manual-stage fixture', now(), now(),
    '1ead5519-1000-4000-8000-000000000512',
    '1ead5519-0000-4000-8000-000000000401'
  ),
  (
    '1ead5519-1000-4000-8000-000000000914',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-existing-project', 'Existing project acceptance',
    now(), now(), '1ead5519-1000-4000-8000-000000000513',
    '1ead5519-0000-4000-8000-000000000401'
  ),
  (
    '1ead5519-1000-4000-8000-000000000915',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-signed-estimate', 'Signed estimate acceptance',
    now(), now(), '1ead5519-1000-4000-8000-000000000516',
    '1ead5519-0000-4000-8000-000000000401'
  ),
  (
    '1ead5519-1000-4000-8000-000000000916',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-untrusted-evidence', 'Untrusted event fixture',
    now(), now(), '1ead5519-1000-4000-8000-000000000509',
    '1ead5519-0000-4000-8000-000000000401'
  ),
  (
    '1ead5519-1000-4000-8000-000000000917',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-likely-won', 'Legacy source rejection',
    now(), now(), '1ead5519-1000-4000-8000-000000000508',
    '1ead5519-0000-4000-8000-000000000401'
  ),
  (
    '1ead5519-1000-4000-8000-000000000918',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-budget-deferral', 'Budget timing deferral',
    now(), now(), '1ead5519-1000-4000-8000-000000000514',
    '1ead5519-0000-4000-8000-000000000401'
  ),
  (
    '1ead5519-1000-4000-8000-000000000919',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-locality-one-way', 'Locality one-way acceptance',
    now(), now(), '1ead5519-1000-4000-8000-000000000517',
    '1ead5519-0000-4000-8000-000000000401'
  ),
  (
    '1ead5519-1000-4000-8000-000000000920',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-project-conflict', 'Project conflict acceptance',
    now(), now(), '1ead5519-1000-4000-8000-000000000518',
    '1ead5519-0000-4000-8000-000000000401'
  ),
  (
    '1ead5519-1000-4000-8000-000000000921',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-project-ambiguous', 'Project ambiguity acceptance',
    now(), now(), '1ead5519-1000-4000-8000-000000000519',
    '1ead5519-0000-4000-8000-000000000401'
  ),
  (
    '1ead5519-1000-4000-8000-000000000922',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-blank-address', 'Blank address acceptance',
    now(), now(), '1ead5519-1000-4000-8000-000000000520',
    '1ead5519-0000-4000-8000-000000000401'
  ),
  (
    '1ead5519-1000-4000-8000-000000000923',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-null-client', 'Null client acceptance',
    now(), now(), '1ead5519-1000-4000-8000-000000000521', null
  ),
  (
    '1ead5519-1000-4000-8000-000000000924',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-blank-empty-client', 'Blank empty-client acceptance',
    now(), now(), '1ead5519-1000-4000-8000-000000000522',
    '1ead5519-0000-4000-8000-000000000402'
  ),
  (
    '1ead5519-1000-4000-8000-000000000925',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-client-ref-only', 'Client-ref-only acceptance',
    now(), now(), '1ead5519-1000-4000-8000-000000000523',
    '1ead5519-0000-4000-8000-000000000404'
  ),
  (
    '1ead5519-1000-4000-8000-000000000926',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-client-mirror-mismatch', 'Mirror mismatch acceptance',
    now(), now(), '1ead5519-1000-4000-8000-000000000524',
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
    'outbound', 'ops', true, now(), 'lead_assignment_contract'
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
  ),
  (
    '1ead5519-1000-4000-8000-000000000926',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000507',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-email-accept', 'provider-message-email-accept',
    'inbound', 'customer', true, now(), 'lead_assignment_contract'
  ),
  (
    '1ead5519-1000-4000-8000-000000000927',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000513',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-existing-project', 'provider-message-existing-project',
    'inbound', 'customer', true, now(), 'lead_assignment_contract'
  ),
  (
    '1ead5519-1000-4000-8000-000000000928',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000516',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-signed-estimate', 'provider-message-signed-estimate',
    'inbound', 'customer', true, now(), 'lead_assignment_contract'
  ),
  (
    '1ead5519-1000-4000-8000-000000000929',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000509',
    '1ead5519-1000-4000-8000-000000000902',
    'provider-thread-inactive', 'provider-message-inactive',
    'inbound', 'customer', true, now(), 'lead_assignment_contract'
  ),
  (
    '1ead5519-1000-4000-8000-000000000930',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000514',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-budget-deferral', 'provider-message-budget-deferral',
    'inbound', 'customer', true, now(), 'lead_assignment_contract'
  ),
  (
    '1ead5519-1000-4000-8000-000000000935',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000517',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-locality-one-way', 'provider-message-locality-one-way',
    'inbound', 'customer', true, now(), 'lead_assignment_contract'
  ),
  (
    '1ead5519-1000-4000-8000-000000000936',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000518',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-project-conflict', 'provider-message-project-conflict',
    'inbound', 'customer', true, now(), 'lead_assignment_contract'
  ),
  (
    '1ead5519-1000-4000-8000-000000000937',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000519',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-project-ambiguous', 'provider-message-project-ambiguous',
    'inbound', 'customer', true, now(), 'lead_assignment_contract'
  ),
  (
    '1ead5519-1000-4000-8000-000000000938',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000520',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-blank-address', 'provider-message-blank-address',
    'inbound', 'customer', true, now(), 'lead_assignment_contract'
  ),
  (
    '1ead5519-1000-4000-8000-000000000939',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000521',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-null-client', 'provider-message-null-client',
    'inbound', 'customer', true, now(), 'lead_assignment_contract'
  ),
  (
    '1ead5519-1000-4000-8000-000000000940',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000522',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-blank-empty-client',
    'provider-message-blank-empty-client',
    'inbound', 'customer', true, now(), 'lead_assignment_contract'
  ),
  (
    '1ead5519-1000-4000-8000-000000000943',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000523',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-client-ref-only', 'provider-message-client-ref-only',
    'inbound', 'customer', true, now(), 'lead_assignment_contract'
  ),
  (
    '1ead5519-1000-4000-8000-000000000944',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000524',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-client-mirror-mismatch',
    'provider-message-client-mirror-mismatch',
    'inbound', 'customer', true, now(), 'lead_assignment_contract'
  );

-- Persist exact sender identities independently of party_role. Most fixtures
-- use the owning client, one acceptance uses the opportunity contact, and the
-- signed estimate uses an active alternate contact. The adversarial event is
-- deliberately labelled customer while coming from an unknown vendor.
update public.opportunity_correspondence_events
   set from_email = 'lead-contract-client@example.invalid'
 where id in (
   '1ead5519-1000-4000-8000-000000000921',
   '1ead5519-1000-4000-8000-000000000924',
   '1ead5519-1000-4000-8000-000000000925',
   '1ead5519-1000-4000-8000-000000000927',
   '1ead5519-1000-4000-8000-000000000929',
   '1ead5519-1000-4000-8000-000000000930',
   '1ead5519-1000-4000-8000-000000000935',
   '1ead5519-1000-4000-8000-000000000936',
   '1ead5519-1000-4000-8000-000000000937',
   '1ead5519-1000-4000-8000-000000000938',
   '1ead5519-1000-4000-8000-000000000939',
   '1ead5519-1000-4000-8000-000000000940'
 );

update public.opportunity_correspondence_events
   set from_email = '  LEAD-CONTRACT-DIRECT@EXAMPLE.INVALID  '
 where id = '1ead5519-1000-4000-8000-000000000926';

update public.opportunity_correspondence_events
   set from_email = 'lead-contract-alternate@example.invalid'
 where id = '1ead5519-1000-4000-8000-000000000928';

update public.opportunity_correspondence_events
   set party_role = 'customer',
       from_email = 'external-vendor@example.invalid'
 where id = '1ead5519-1000-4000-8000-000000000923';

update public.opportunity_correspondence_events
   set from_email = 'contract-mailbox@example.invalid'
 where id = '1ead5519-1000-4000-8000-000000000922';

update public.opportunity_correspondence_events
   set from_email = 'client-ref-only-contract@example.invalid'
 where id = '1ead5519-1000-4000-8000-000000000943';

update public.opportunity_correspondence_events
   set from_email = 'lead-contract-client@example.invalid'
 where id = '1ead5519-1000-4000-8000-000000000944';

insert into public.opportunity_correspondence_events (
  id, company_id, opportunity_id, connection_id, provider_thread_id,
  provider_message_id, direction, party_role, is_meaningful, occurred_at,
  source, from_email, opportunity_projection_applied
) values (
  '1ead5519-1000-4000-8000-000000000941',
  '1ead5519-0000-4000-8000-000000000001',
  '1ead5519-1000-4000-8000-000000000514',
  '1ead5519-1000-4000-8000-000000000901',
  'provider-thread-budget-deferral',
  'provider-message-external-budget-deferral',
  'inbound', 'customer', true, now() - interval '1 minute',
  'lead_assignment_contract', 'external-vendor@example.invalid', false
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
      p_source_path => 'email_accept',
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
          'outbound_acceptance_signal_denied',
          'provider-message-outbound',
          '1ead5519-1000-4000-8000-000000000922',
          'outbound'
        ),
        (
          'unpersisted_external_customer_role_acceptance_denied',
          'provider-message-non-customer',
          '1ead5519-1000-4000-8000-000000000923',
          'inbound'
        ),
        (
          'non_meaningful_acceptance_signal_denied',
          'provider-message-not-meaningful',
          '1ead5519-1000-4000-8000-000000000924',
          'inbound'
        )
      ) cases(
        check_name,
        provider_message_id,
        decisive_event_id,
        decisive_direction
      )
  loop
    begin
      perform public.convert_opportunity_to_project(
        p_company_id => '1ead5519-0000-4000-8000-000000000001',
        p_opportunity_id => '1ead5519-1000-4000-8000-000000000509',
        p_expected_stage => 'quoting',
        p_decided_by => null,
        p_source_path => 'email_accept',
        p_evidence => jsonb_build_object(
          'connection_id', '1ead5519-1000-4000-8000-000000000901',
          'email_thread_id', '1ead5519-1000-4000-8000-000000000916',
          'provider_thread_id', 'provider-thread-untrusted-evidence',
          'provider_message_id', v_case.provider_message_id,
          'decisive_event_id', v_case.decisive_event_id,
          'decisive_direction', v_case.decisive_direction,
          'evaluated_through_event_id',
            '1ead5519-1000-4000-8000-000000000929',
          'signals', jsonb_build_array('explicit_acceptance'),
          'decision', 'auto_advance_won'
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
      p_evidence => jsonb_build_object(
        'connection_id', '1ead5519-1000-4000-8000-000000000901',
        'email_thread_id', '1ead5519-1000-4000-8000-000000000911',
        'provider_thread_id', 'provider-thread-email-accept',
        'provider_message_id', 'provider-message-non-customer',
        'decisive_event_id', '1ead5519-1000-4000-8000-000000000923',
        'decisive_direction', 'inbound',
        'evaluated_through_event_id',
          '1ead5519-1000-4000-8000-000000000929',
        'signals', jsonb_build_array('explicit_acceptance'),
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
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000508',
      p_expected_stage => 'quoting',
      p_decided_by => null,
      p_source_path => 'email_likely_won',
      p_evidence => jsonb_build_object(
        'connection_id', '1ead5519-1000-4000-8000-000000000901',
        'email_thread_id', '1ead5519-1000-4000-8000-000000000917',
        'provider_thread_id', 'provider-thread-likely-won',
        'provider_message_id', 'provider-message-likely-won',
        'decisive_event_id', '1ead5519-1000-4000-8000-000000000921',
        'decisive_direction', 'inbound',
        'evaluated_through_event_id',
          '1ead5519-1000-4000-8000-000000000921',
        'signals', jsonb_build_array('explicit_acceptance'),
        'decision', 'auto_advance_won'
      ),
      p_expected_assignment_version => 0
    );
    insert into lead_assignment_contract_results values (
      'legacy_email_likely_won_source_denied', false,
      'call unexpectedly succeeded'
    );
  exception when sqlstate '42501' then
    insert into lead_assignment_contract_results values (
      'legacy_email_likely_won_source_denied',
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
        'provider_message_id', 'provider-message-inactive',
        'decisive_event_id', '1ead5519-1000-4000-8000-000000000929',
        'decisive_direction', 'inbound',
        'evaluated_through_event_id',
          '1ead5519-1000-4000-8000-000000000929',
        'signals', jsonb_build_array('explicit_acceptance'),
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
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000516',
      p_expected_stage => 'quoted',
      p_decided_by => null,
      p_source_path => 'email_accept',
      p_evidence => jsonb_build_object(
        'connection_id', '1ead5519-1000-4000-8000-000000000901',
        'email_thread_id', '1ead5519-1000-4000-8000-000000000915',
        'provider_thread_id', 'provider-thread-signed-estimate',
        'provider_message_id', 'provider-message-signed-estimate',
        'decisive_event_id', '1ead5519-1000-4000-8000-000000000928',
        'decisive_direction', 'inbound',
        'evaluated_through_event_id',
          '1ead5519-1000-4000-8000-000000000928',
        'signals', jsonb_build_array('signed_estimate'),
        'decision', 'auto_advance_won'
      ),
      p_expected_assignment_version => 0
    );
    insert into lead_assignment_contract_results values (
      'signed_estimate_without_exact_inspection_denied', false,
      'call unexpectedly succeeded'
    );
  exception when sqlstate '42501' then
    insert into lead_assignment_contract_results values (
      'signed_estimate_without_exact_inspection_denied',
      sqlerrm = 'access_denied', sqlerrm
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

-- Establish the summary writer's ordinary idempotent path before introducing
-- the pending projection race below. The exact retry intentionally reuses the
-- original prior-summary snapshot; `already_applied` must win only when no
-- meaningful event is waiting for projection.
do $contract$
declare
  v_opportunity public.opportunities%rowtype;
  v_meaningful_event_count bigint;
  v_latest_meaningful_event_id uuid;
  v_generated_at timestamptz := clock_timestamp();
  v_first record;
  v_retry record;
begin
  select opportunity.*
  into strict v_opportunity
  from public.opportunities opportunity
  where opportunity.id = '1ead5519-1000-4000-8000-000000000509'
    and opportunity.company_id = '1ead5519-0000-4000-8000-000000000001';

  select
    count(*)::bigint,
    (
      array_agg(
        event.id
        order by event.occurred_at desc, event.created_at desc, event.id desc
      )
    )[1]
  into v_meaningful_event_count, v_latest_meaningful_event_id
  from public.opportunity_correspondence_events event
  where event.company_id = '1ead5519-0000-4000-8000-000000000001'
    and event.opportunity_id = '1ead5519-1000-4000-8000-000000000509'
    and event.is_meaningful is true
    and event.opportunity_projection_applied is true;

  select result.*
  into strict v_first
  from public.commit_lead_summary_snapshot(
    p_company_id => '1ead5519-0000-4000-8000-000000000001',
    p_opportunity_id => '1ead5519-1000-4000-8000-000000000509',
    p_summary => 'Contract idempotency baseline.',
    p_generated_at => v_generated_at,
    p_expected_prior_summary => v_opportunity.ai_summary,
    p_expected_prior_summary_updated_at => v_opportunity.ai_summary_updated_at,
    p_expected_opportunity_updated_at => v_opportunity.updated_at,
    p_expected_assignment_version => v_opportunity.assignment_version,
    p_expected_correspondence_count =>
      coalesce(v_opportunity.correspondence_count, 0)::bigint,
    p_expected_meaningful_event_count => v_meaningful_event_count,
    p_expected_latest_meaningful_event_id => v_latest_meaningful_event_id
  ) result;

  select result.*
  into strict v_retry
  from public.commit_lead_summary_snapshot(
    p_company_id => '1ead5519-0000-4000-8000-000000000001',
    p_opportunity_id => '1ead5519-1000-4000-8000-000000000509',
    p_summary => 'Contract idempotency baseline.',
    p_generated_at => v_generated_at,
    p_expected_prior_summary => v_opportunity.ai_summary,
    p_expected_prior_summary_updated_at => v_opportunity.ai_summary_updated_at,
    p_expected_opportunity_updated_at => v_opportunity.updated_at,
    p_expected_assignment_version => v_opportunity.assignment_version,
    p_expected_correspondence_count =>
      coalesce(v_opportunity.correspondence_count, 0)::bigint,
    p_expected_meaningful_event_count => v_meaningful_event_count,
    p_expected_latest_meaningful_event_id => v_latest_meaningful_event_id
  ) result;

  insert into lead_assignment_contract_results values (
    'lead_summary_snapshot_exact_retry_is_idempotent',
    v_first.changed is true
      and v_first.guard_reason is null
      and v_retry.changed is false
      and v_retry.guard_reason = 'already_applied'
      and v_retry.summary_updated_at is not distinct from v_generated_at,
    jsonb_build_object(
      'first_changed', v_first.changed,
      'first_guard', v_first.guard_reason,
      'retry_changed', v_retry.changed,
      'retry_guard', v_retry.guard_reason
    )::text
  );
end;
$contract$;

-- A newer meaningful event may be durable before its opportunity projection.
-- Actorless conversion must stop with a retryable error instead of deciding
-- from the projected subset and committing over the pending veto.
insert into public.opportunity_correspondence_events (
  id, company_id, opportunity_id, connection_id, provider_thread_id,
  provider_message_id, direction, party_role, is_meaningful, occurred_at,
  source, from_email, opportunity_projection_applied
) values (
  '1ead5519-1000-4000-8000-000000000942',
  '1ead5519-0000-4000-8000-000000000001',
  '1ead5519-1000-4000-8000-000000000509',
  '1ead5519-1000-4000-8000-000000000901',
  'provider-thread-untrusted-evidence', 'provider-message-pending-veto',
  'inbound', 'customer', true, now() + interval '5 minutes',
  'lead_assignment_contract', 'lead-contract-client@example.invalid', false
);

-- A summary generator may have read the complete projected snapshot just
-- before the event above became durable. The child event is intentionally not
-- projected yet, so every caller-supplied snapshot below still matches the
-- projected subset. The writer must nevertheless fail retryably under the
-- opportunity lock and leave the prior summary untouched.
do $contract$
declare
  v_opportunity public.opportunities%rowtype;
  v_meaningful_event_count bigint;
  v_latest_meaningful_event_id uuid;
  v_summary_before text;
  v_summary_updated_at_before timestamptz;
begin
  select opportunity.*
  into strict v_opportunity
  from public.opportunities opportunity
  where opportunity.id = '1ead5519-1000-4000-8000-000000000509'
    and opportunity.company_id = '1ead5519-0000-4000-8000-000000000001';

  v_summary_before := v_opportunity.ai_summary;
  v_summary_updated_at_before := v_opportunity.ai_summary_updated_at;

  select
    count(*)::bigint,
    (
      array_agg(
        event.id
        order by event.occurred_at desc, event.created_at desc, event.id desc
      )
    )[1]
  into v_meaningful_event_count, v_latest_meaningful_event_id
  from public.opportunity_correspondence_events event
  where event.company_id = '1ead5519-0000-4000-8000-000000000001'
    and event.opportunity_id = '1ead5519-1000-4000-8000-000000000509'
    and event.is_meaningful is true
    and event.opportunity_projection_applied is true;

  begin
    perform public.commit_lead_summary_snapshot(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000509',
      p_summary => 'Stale candidate summary must never commit.',
      p_generated_at => clock_timestamp(),
      p_expected_prior_summary => v_opportunity.ai_summary,
      p_expected_prior_summary_updated_at =>
        v_opportunity.ai_summary_updated_at,
      p_expected_opportunity_updated_at => v_opportunity.updated_at,
      p_expected_assignment_version => v_opportunity.assignment_version,
      p_expected_correspondence_count =>
        coalesce(v_opportunity.correspondence_count, 0)::bigint,
      p_expected_meaningful_event_count => v_meaningful_event_count,
      p_expected_latest_meaningful_event_id =>
        v_latest_meaningful_event_id
    );
    insert into lead_assignment_contract_results values (
      'lead_summary_pending_meaningful_projection_denied', false,
      'call unexpectedly succeeded'
    );
  exception
    when sqlstate '40001' then
      insert into lead_assignment_contract_results values (
        'lead_summary_pending_meaningful_projection_denied',
        sqlerrm = 'meaningful correspondence projection pending',
        sqlerrm
      );
    when others then
      insert into lead_assignment_contract_results values (
        'lead_summary_pending_meaningful_projection_denied', false,
        sqlstate || ': ' || sqlerrm
      );
  end;

  insert into lead_assignment_contract_results values (
    'lead_summary_pending_projection_preserves_prior_summary',
    exists (
      select 1
      from public.opportunities opportunity
      where opportunity.id = '1ead5519-1000-4000-8000-000000000509'
        and opportunity.ai_summary is not distinct from v_summary_before
        and opportunity.ai_summary_updated_at
          is not distinct from v_summary_updated_at_before
    ),
    null
  );
end;
$contract$;

do $contract$
begin
  begin
    perform public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000509',
      p_expected_stage => 'quoting',
      p_decided_by => null,
      p_source_path => 'email_accept',
      p_evidence => jsonb_build_object(
        'connection_id', '1ead5519-1000-4000-8000-000000000901',
        'email_thread_id', '1ead5519-1000-4000-8000-000000000916',
        'provider_thread_id', 'provider-thread-untrusted-evidence',
        'provider_message_id', 'provider-message-pending-veto',
        'decisive_event_id', '1ead5519-1000-4000-8000-000000000942',
        'decisive_direction', 'inbound',
        'evaluated_through_event_id',
          '1ead5519-1000-4000-8000-000000000942',
        'signals', jsonb_build_array('explicit_acceptance'),
        'decision', 'auto_advance_won'
      ),
      p_expected_assignment_version => 0
    );
    insert into lead_assignment_contract_results values (
      'actorless_won_pending_meaningful_projection_denied', false,
      'call unexpectedly succeeded'
    );
  exception when sqlstate '40001' then
    insert into lead_assignment_contract_results values (
      'actorless_won_pending_meaningful_projection_denied',
      sqlerrm = 'meaningful correspondence projection pending'
        and exists (
          select 1
          from public.opportunities opportunity
          where opportunity.id =
            '1ead5519-1000-4000-8000-000000000509'
            and opportunity.stage = 'quoting'
            and opportunity.project_ref is null
            and opportunity.project_id is null
        ),
      sqlerrm
    );
  end;
end;
$contract$;

-- A signed-estimate signal becomes trusted only after the exact attributed
-- message attachment has one durable positive inspection bound by immutable
-- attachment identity.
insert into public.activities (
  id, company_id, opportunity_id, project_id, type, subject, content,
  email_connection_id, email_thread_id, email_message_id
) values (
  '1ead5519-1000-4000-8000-000000000941',
  '1ead5519-0000-4000-8000-000000000001',
  '1ead5519-1000-4000-8000-000000000516',
  null, 'email', 'Signed estimate', 'Rollback-only signed estimate fixture',
  '1ead5519-1000-4000-8000-000000000901',
  'provider-thread-signed-estimate',
  'provider-message-signed-estimate'
);

insert into public.email_attachments (
  id, company_id, connection_id, activity_id, provider_thread_id, message_id,
  attachment_id, filename, mime_type, from_email, opportunity_id,
  source_url, ingest_status, attribution_status, occurred_at
) values (
  '1ead5519-1000-4000-8000-000000000942',
  '1ead5519-0000-4000-8000-000000000001',
  '1ead5519-1000-4000-8000-000000000901',
  '1ead5519-1000-4000-8000-000000000941',
  'provider-thread-signed-estimate',
  'provider-message-signed-estimate',
  'provider-attachment-signed-estimate',
  'signed-estimate.pdf', 'application/pdf',
  'lead-contract-alternate@example.invalid',
  '1ead5519-1000-4000-8000-000000000516',
  'https://example.invalid/signed-estimate.pdf',
  'external', 'attributed', now()
);

insert into public.attachment_inspections (
  id, company_id, connection_id, email_attachment_id, provider_thread_id,
  message_id, attachment_id, summary, is_signed_estimate, facts, model
) values (
  '1ead5519-1000-4000-8000-000000000943',
  '1ead5519-0000-4000-8000-000000000001',
  '1ead5519-1000-4000-8000-000000000901',
  '1ead5519-1000-4000-8000-000000000942',
  'provider-thread-signed-estimate',
  'provider-message-signed-estimate',
  'provider-attachment-signed-estimate',
  'Signed customer estimate', true,
  '{"signed":true,"contract_fixture":true}'::jsonb,
  'contract-fixture'
);

-- Simulate the race: evaluation observed an automatic stage, then a human
-- pinned it before the actorless conversion acquired the opportunity lock.
update public.opportunities
   set stage_manually_set = true
 where id = '1ead5519-1000-4000-8000-000000000512';

insert into lead_assignment_contract_values (value_name, value)
values (
  'actorless_existing_project_stage_snapshot_guard',
  public.convert_opportunity_to_project(
    p_company_id => '1ead5519-0000-4000-8000-000000000001',
    p_opportunity_id => '1ead5519-1000-4000-8000-000000000513',
    p_expected_stage => 'quoting',
    p_decided_by => null,
    p_source_path => 'email_accept',
    p_evidence => jsonb_build_object(
      'connection_id', '1ead5519-1000-4000-8000-000000000901',
      'email_thread_id', '1ead5519-1000-4000-8000-000000000914',
      'provider_thread_id', 'provider-thread-existing-project',
      'provider_message_id', 'provider-message-existing-project',
      'decisive_event_id', '1ead5519-1000-4000-8000-000000000927',
      'decisive_direction', 'inbound',
      'evaluated_through_event_id',
        '1ead5519-1000-4000-8000-000000000927',
      'signals', jsonb_build_array('explicit_acceptance'),
      'decision', 'auto_advance_won'
    ),
    p_expected_assignment_version => 0
  )
);

do $contract$
begin
  begin
    perform public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000524',
      p_expected_stage => 'quoted',
      p_decided_by => null,
      p_source_path => 'email_accept',
      p_evidence => jsonb_build_object(
        'connection_id', '1ead5519-1000-4000-8000-000000000901',
        'email_thread_id', '1ead5519-1000-4000-8000-000000000926',
        'provider_thread_id', 'provider-thread-client-mirror-mismatch',
        'provider_message_id', 'provider-message-client-mirror-mismatch',
        'decisive_event_id', '1ead5519-1000-4000-8000-000000000944',
        'decisive_direction', 'inbound',
        'evaluated_through_event_id',
          '1ead5519-1000-4000-8000-000000000944',
        'signals', jsonb_build_array('explicit_acceptance'),
        'decision', 'auto_advance_won'
      ),
      p_expected_assignment_version => 0
    );
    insert into lead_assignment_contract_results values (
      'actorless_client_mirror_disagreement_denied', false,
      'call unexpectedly succeeded'
    );
  exception when sqlstate '23505' then
    insert into lead_assignment_contract_results values (
      'actorless_client_mirror_disagreement_denied',
      sqlerrm = 'opportunity_client_mirrors_disagree'
        and exists (
          select 1
          from public.opportunities opportunity
          where opportunity.id =
            '1ead5519-1000-4000-8000-000000000524'
            and opportunity.stage = 'quoted'
            and opportunity.project_ref is null
            and opportunity.project_id is null
        )
        and not exists (
          select 1
          from public.projects project
          where project.opportunity_ref =
              '1ead5519-1000-4000-8000-000000000524'
             or project.opportunity_id =
              '1ead5519-1000-4000-8000-000000000524'
        ),
      sqlerrm
    );
  end;
end;
$contract$;

insert into lead_assignment_contract_values (value_name, value)
values
  (
    'manual_stage_override_conversion',
    public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000512',
      p_expected_stage => 'quoting',
      p_decided_by => null,
      p_source_path => 'email_accept',
      p_evidence => jsonb_build_object(
        'connection_id', '1ead5519-1000-4000-8000-000000000901',
        'email_thread_id', '1ead5519-1000-4000-8000-000000000913',
        'provider_thread_id', 'provider-thread-manual-stage-race',
        'provider_message_id', 'provider-message-manual-stage-race',
        'decisive_event_id', '1ead5519-1000-4000-8000-000000000925',
        'decisive_direction', 'inbound',
        'evaluated_through_event_id',
          '1ead5519-1000-4000-8000-000000000925',
        'signals', jsonb_build_array('explicit_acceptance'),
        'decision', 'auto_advance_won'
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
        'provider_message_id', 'provider-message-email-accept',
        'decisive_event_id', '1ead5519-1000-4000-8000-000000000926',
        'decisive_direction', 'inbound',
        'evaluated_through_event_id',
          '1ead5519-1000-4000-8000-000000000926',
        'signals', jsonb_build_array('explicit_acceptance'),
        'decision', 'auto_advance_won'
      ),
      p_expected_assignment_version => 0
    )
  ),
  (
    'actorless_existing_project_first',
    public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000513',
      p_expected_stage => 'quoted',
      p_decided_by => null,
      p_source_path => 'email_accept',
      p_evidence => jsonb_build_object(
        'connection_id', '1ead5519-1000-4000-8000-000000000901',
        'email_thread_id', '1ead5519-1000-4000-8000-000000000914',
        'provider_thread_id', 'provider-thread-existing-project',
        'provider_message_id', 'provider-message-existing-project',
        'decisive_event_id', '1ead5519-1000-4000-8000-000000000927',
        'decisive_direction', 'inbound',
        'evaluated_through_event_id',
          '1ead5519-1000-4000-8000-000000000927',
        'signals', jsonb_build_array('explicit_acceptance'),
        'decision', 'auto_advance_won'
      ),
      p_expected_assignment_version => 0
    )
  ),
  (
    'signed_estimate_conversion',
    public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000516',
      p_expected_stage => 'quoted',
      p_decided_by => null,
      p_source_path => 'email_accept',
      p_evidence => jsonb_build_object(
        'connection_id', '1ead5519-1000-4000-8000-000000000901',
        'email_thread_id', '1ead5519-1000-4000-8000-000000000915',
        'provider_thread_id', 'provider-thread-signed-estimate',
        'provider_message_id', 'provider-message-signed-estimate',
        'decisive_event_id', '1ead5519-1000-4000-8000-000000000928',
        'decisive_direction', 'inbound',
        'evaluated_through_event_id',
          '1ead5519-1000-4000-8000-000000000928',
        'signals', jsonb_build_array('signed_estimate'),
        'decision', 'auto_advance_won'
      ),
      p_expected_assignment_version => 0
    )
  ),
  (
    'actorless_locality_one_way_conversion',
    public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000517',
      p_expected_stage => 'quoted',
      p_decided_by => null,
      p_source_path => 'email_accept',
      p_evidence => jsonb_build_object(
        'connection_id', '1ead5519-1000-4000-8000-000000000901',
        'email_thread_id', '1ead5519-1000-4000-8000-000000000919',
        'provider_thread_id', 'provider-thread-locality-one-way',
        'provider_message_id', 'provider-message-locality-one-way',
        'decisive_event_id', '1ead5519-1000-4000-8000-000000000935',
        'decisive_direction', 'inbound',
        'evaluated_through_event_id',
          '1ead5519-1000-4000-8000-000000000935',
        'signals', jsonb_build_array('explicit_acceptance'),
        'decision', 'auto_advance_won'
      ),
      p_expected_assignment_version => 0
    )
  ),
  (
    'actorless_blank_address_empty_client_conversion',
    public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000522',
      p_expected_stage => 'quoted',
      p_decided_by => null,
      p_source_path => 'email_accept',
      p_evidence => jsonb_build_object(
        'connection_id', '1ead5519-1000-4000-8000-000000000901',
        'email_thread_id', '1ead5519-1000-4000-8000-000000000924',
        'provider_thread_id', 'provider-thread-blank-empty-client',
        'provider_message_id', 'provider-message-blank-empty-client',
        'decisive_event_id', '1ead5519-1000-4000-8000-000000000940',
        'decisive_direction', 'inbound',
        'evaluated_through_event_id',
          '1ead5519-1000-4000-8000-000000000940',
        'signals', jsonb_build_array('explicit_acceptance'),
        'decision', 'auto_advance_won'
      ),
      p_expected_assignment_version => 0
    )
  ),
  (
    'actorless_client_ref_only_conversion',
    public.convert_opportunity_to_project(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000523',
      p_expected_stage => 'quoted',
      p_decided_by => null,
      p_source_path => 'email_accept',
      p_evidence => jsonb_build_object(
        'connection_id', '1ead5519-1000-4000-8000-000000000901',
        'email_thread_id', '1ead5519-1000-4000-8000-000000000925',
        'provider_thread_id', 'provider-thread-client-ref-only',
        'provider_message_id', 'provider-message-client-ref-only',
        'decisive_event_id', '1ead5519-1000-4000-8000-000000000943',
        'decisive_direction', 'inbound',
        'evaluated_through_event_id',
          '1ead5519-1000-4000-8000-000000000943',
        'signals', jsonb_build_array('explicit_acceptance'),
        'decision', 'auto_advance_won'
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

do $contract$
declare
  v_case record;
begin
  for v_case in
    select *
    from (values
      (
        'actorless_matching_project_link_conflict_denied',
        '1ead5519-1000-4000-8000-000000000518',
        '1ead5519-1000-4000-8000-000000000920',
        'provider-thread-project-conflict',
        'provider-message-project-conflict',
        '1ead5519-1000-4000-8000-000000000936',
        'P0002',
        'project_link_unavailable: matching_project_link_conflict'
      ),
      (
        'actorless_matching_projects_ambiguous_denied',
        '1ead5519-1000-4000-8000-000000000519',
        '1ead5519-1000-4000-8000-000000000921',
        'provider-thread-project-ambiguous',
        'provider-message-project-ambiguous',
        '1ead5519-1000-4000-8000-000000000937',
        'P0003',
        'project_link_ambiguous'
      ),
      (
        'actorless_blank_address_existing_client_denied',
        '1ead5519-1000-4000-8000-000000000520',
        '1ead5519-1000-4000-8000-000000000922',
        'provider-thread-blank-address',
        'provider-message-blank-address',
        '1ead5519-1000-4000-8000-000000000938',
        'P0002',
        'project_link_unavailable: dedupe_proof_unavailable'
      ),
      (
        'actorless_null_client_denied',
        '1ead5519-1000-4000-8000-000000000521',
        '1ead5519-1000-4000-8000-000000000923',
        'provider-thread-null-client',
        'provider-message-null-client',
        '1ead5519-1000-4000-8000-000000000939',
        'P0002',
        'project_link_unavailable: dedupe_proof_unavailable'
      )
    ) cases(
      check_name,
      opportunity_id,
      email_thread_id,
      provider_thread_id,
      provider_message_id,
      decisive_event_id,
      expected_sqlstate,
      expected_message
    )
  loop
    begin
      perform public.convert_opportunity_to_project(
        p_company_id => '1ead5519-0000-4000-8000-000000000001',
        p_opportunity_id => v_case.opportunity_id::uuid,
        p_expected_stage => 'quoted',
        p_decided_by => null,
        p_source_path => 'email_accept',
        p_evidence => jsonb_build_object(
          'connection_id', '1ead5519-1000-4000-8000-000000000901',
          'email_thread_id', v_case.email_thread_id,
          'provider_thread_id', v_case.provider_thread_id,
          'provider_message_id', v_case.provider_message_id,
          'decisive_event_id', v_case.decisive_event_id,
          'decisive_direction', 'inbound',
          'evaluated_through_event_id', v_case.decisive_event_id,
          'signals', jsonb_build_array('explicit_acceptance'),
          'decision', 'auto_advance_won'
        ),
        p_expected_assignment_version => 0
      );
      insert into lead_assignment_contract_results values (
        v_case.check_name, false, 'call unexpectedly succeeded'
      );
    exception when others then
      insert into lead_assignment_contract_results values (
        v_case.check_name,
        sqlstate = v_case.expected_sqlstate
          and sqlerrm = v_case.expected_message,
        sqlstate || ': ' || sqlerrm
      );
    end;
  end loop;
end;
$contract$;

insert into lead_assignment_contract_results (check_name, passed)
values (
  'actorless_dedupe_denials_leave_leads_unconverted',
  not exists (
    select 1
    from public.opportunities opportunity
    where opportunity.id in (
      '1ead5519-1000-4000-8000-000000000518',
      '1ead5519-1000-4000-8000-000000000519',
      '1ead5519-1000-4000-8000-000000000520',
      '1ead5519-1000-4000-8000-000000000521'
    )
      and (
        opportunity.stage is distinct from 'quoted'
        or opportunity.project_ref is not null
        or opportunity.project_id is not null
      )
  )
  and not exists (
    select 1
    from public.opportunity_conversion_events event
    where event.opportunity_id in (
      '1ead5519-1000-4000-8000-000000000518',
      '1ead5519-1000-4000-8000-000000000519',
      '1ead5519-1000-4000-8000-000000000520',
      '1ead5519-1000-4000-8000-000000000521'
    )
  )
);

-- A later, different acceptance cannot use the opportunity's project pointer
-- to bypass assignment/manual guards or enter the canonical repair core.
insert into public.opportunity_correspondence_events (
  id, company_id, opportunity_id, connection_id, provider_thread_id,
  provider_message_id, direction, party_role, is_meaningful, occurred_at,
  source, from_email
) values (
  '1ead5519-1000-4000-8000-000000000934',
  '1ead5519-0000-4000-8000-000000000001',
  '1ead5519-1000-4000-8000-000000000513',
  '1ead5519-1000-4000-8000-000000000901',
  'provider-thread-existing-project',
  'provider-message-existing-project-later',
  'inbound', 'customer', true, now() + interval '1 minute',
  'lead_assignment_contract', 'lead-contract-client@example.invalid'
);

insert into lead_assignment_contract_values (value_name, value)
values (
  'actorless_existing_project_reassignment',
  public.change_opportunity_assignment_as_system(
    '1ead5519-1000-4000-8000-000000000513', 0, null,
    '1ead5519-0000-4000-8000-000000000101', 'system_repair', null, null,
    '{"contract_case":"existing_project_reassignment"}'::jsonb
  )
);

-- Add a projection after the first conversion. The actorless retry must invoke
-- the canonical repair core, link it to the same project, and remain duplicate
-- free across the project, disposition, conversion event, and transition.
insert into public.estimates (
  id, company_id, opportunity_id, client_id, client_ref, estimate_number,
  subtotal, total, status
) values (
  '1ead5519-1000-4000-8000-000000000706',
  '1ead5519-0000-4000-8000-000000000001',
  '1ead5519-1000-4000-8000-000000000513',
  '1ead5519-0000-4000-8000-000000000401',
  '1ead5519-0000-4000-8000-000000000401',
  'ACTORLESS-REPAIR-EST-001', 18000, 18000, 'approved'
);

insert into lead_assignment_contract_values (value_name, value)
values (
  'actorless_existing_project_stale_assignment_guard',
  public.convert_opportunity_to_project(
    p_company_id => '1ead5519-0000-4000-8000-000000000001',
    p_opportunity_id => '1ead5519-1000-4000-8000-000000000513',
    p_expected_stage => 'quoted',
    p_decided_by => null,
    p_source_path => 'email_accept',
    p_evidence => jsonb_build_object(
      'connection_id', '1ead5519-1000-4000-8000-000000000901',
      'email_thread_id', '1ead5519-1000-4000-8000-000000000914',
      'provider_thread_id', 'provider-thread-existing-project',
      'provider_message_id', 'provider-message-existing-project',
      'decisive_event_id', '1ead5519-1000-4000-8000-000000000927',
      'decisive_direction', 'inbound',
      'evaluated_through_event_id',
        '1ead5519-1000-4000-8000-000000000927',
      'signals', jsonb_build_array('explicit_acceptance'),
      'decision', 'auto_advance_won'
    ),
    p_expected_assignment_version => 0
  )
);

insert into lead_assignment_contract_values (value_name, value)
values (
  'actorless_existing_project_manual_guard',
  public.convert_opportunity_to_project(
    p_company_id => '1ead5519-0000-4000-8000-000000000001',
    p_opportunity_id => '1ead5519-1000-4000-8000-000000000513',
    p_expected_stage => 'won',
    p_decided_by => null,
    p_source_path => 'email_accept',
    p_evidence => jsonb_build_object(
      'connection_id', '1ead5519-1000-4000-8000-000000000901',
      'email_thread_id', '1ead5519-1000-4000-8000-000000000914',
      'provider_thread_id', 'provider-thread-existing-project',
      'provider_message_id', 'provider-message-existing-project-later',
      'decisive_event_id', '1ead5519-1000-4000-8000-000000000934',
      'decisive_direction', 'inbound',
      'evaluated_through_event_id',
        '1ead5519-1000-4000-8000-000000000934',
      'signals', jsonb_build_array('explicit_acceptance'),
      'decision', 'auto_advance_won'
    ),
    p_expected_assignment_version => 1
  )
);

insert into lead_assignment_contract_values (value_name, value)
values (
  'actorless_existing_project_retry',
  public.convert_opportunity_to_project(
    p_company_id => '1ead5519-0000-4000-8000-000000000001',
    p_opportunity_id => '1ead5519-1000-4000-8000-000000000513',
    p_expected_stage => 'quoted',
    p_decided_by => null,
    p_source_path => 'email_accept',
    p_evidence => jsonb_build_object(
      'connection_id', '1ead5519-1000-4000-8000-000000000901',
      'email_thread_id', '1ead5519-1000-4000-8000-000000000914',
      'provider_thread_id', 'provider-thread-existing-project',
      'provider_message_id', 'provider-message-existing-project',
      'decisive_event_id', '1ead5519-1000-4000-8000-000000000927',
      'decisive_direction', 'inbound',
      'evaluated_through_event_id',
        '1ead5519-1000-4000-8000-000000000927',
      'signals', jsonb_build_array('explicit_acceptance'),
      'decision', 'auto_advance_won'
    ),
    p_expected_assignment_version => 1
  )
);

-- Budget/timing deferral: first apply, reject an OPS-authored schedule as Lost
-- reactivation, preserve exact retry after newer evidence, re-defer from a new
-- customer message, then accept unequivocal OPS-confirmed payment back to Won.
do $contract$
begin
  begin
    perform public.apply_email_opportunity_deferred_disposition(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000514',
      p_connection_id => '1ead5519-1000-4000-8000-000000000901',
      p_provider_message_id => 'provider-message-external-budget-deferral',
      p_expected_assignment_version => 0,
      p_expected_stage => 'quoted',
      p_next_follow_up_at => now() + interval '9 months',
      p_evidence => jsonb_build_object(
        'reason_code', 'budget_timing',
        'signals', jsonb_build_array('budget_timing_deferral'),
        'evidence_message_ids',
          jsonb_build_array('provider-message-external-budget-deferral'),
        'evaluated_through_event_id',
          '1ead5519-1000-4000-8000-000000000941'
      )
    );
    insert into lead_assignment_contract_results values (
      'deferred_pending_meaningful_projection_denied', false,
      'call unexpectedly succeeded'
    );
  exception when sqlstate '40001' then
    insert into lead_assignment_contract_results values (
      'deferred_pending_meaningful_projection_denied',
      sqlerrm = 'meaningful correspondence projection pending',
      sqlerrm
    );
  end;

  perform public.apply_opportunity_correspondence_event(
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000514',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-message-external-budget-deferral'
  );

  insert into lead_assignment_contract_results values (
    'pending_deferred_event_projects_before_outcome_retry',
    exists (
      select 1
      from public.opportunity_correspondence_events event
      where event.id = '1ead5519-1000-4000-8000-000000000941'
        and event.opportunity_projection_applied is true
    ),
    null
  );

  begin
    perform public.apply_email_opportunity_deferred_disposition(
      p_company_id => '1ead5519-0000-4000-8000-000000000001',
      p_opportunity_id => '1ead5519-1000-4000-8000-000000000514',
      p_connection_id => '1ead5519-1000-4000-8000-000000000901',
      p_provider_message_id => 'provider-message-external-budget-deferral',
      p_expected_assignment_version => 0,
      p_expected_stage => 'quoted',
      p_next_follow_up_at => now() + interval '9 months',
      p_evidence => jsonb_build_object(
        'reason_code', 'budget_timing',
        'signals', jsonb_build_array('budget_timing_deferral'),
        'evidence_message_ids',
          jsonb_build_array('provider-message-external-budget-deferral'),
        'evaluated_through_event_id',
          '1ead5519-1000-4000-8000-000000000941'
      )
    );
    insert into lead_assignment_contract_results values (
      'deferred_external_customer_role_sender_denied', false,
      'call unexpectedly succeeded'
    );
  exception when sqlstate '42501' then
    insert into lead_assignment_contract_results values (
      'deferred_external_customer_role_sender_denied',
      sqlerrm = 'deferred disposition evidence was not found'
        and exists (
          select 1
          from public.opportunities opportunity
          where opportunity.id =
            '1ead5519-1000-4000-8000-000000000514'
            and opportunity.stage = 'quoted'
            and opportunity.project_ref is null
            and opportunity.project_id is null
        ),
      sqlerrm
    );
  end;
end;
$contract$;

insert into lead_assignment_contract_values (value_name, value)
select 'deferred_first_apply', to_jsonb(result)
from public.apply_email_opportunity_deferred_disposition(
  p_company_id => '1ead5519-0000-4000-8000-000000000001',
  p_opportunity_id => '1ead5519-1000-4000-8000-000000000514',
  p_connection_id => '1ead5519-1000-4000-8000-000000000901',
  p_provider_message_id => 'provider-message-budget-deferral',
  p_expected_assignment_version => 0,
  p_expected_stage => 'quoted',
  p_next_follow_up_at => now() + interval '9 months',
  p_evidence => jsonb_build_object(
    'reason_code', 'budget_timing',
    'signals', jsonb_build_array('budget_timing_deferral'),
    'evidence_message_ids',
      jsonb_build_array('provider-message-budget-deferral'),
    'evaluated_through_event_id',
      '1ead5519-1000-4000-8000-000000000930'
  )
) result;

insert into public.opportunity_correspondence_events (
  id, company_id, opportunity_id, connection_id, provider_thread_id,
  provider_message_id, direction, party_role, is_meaningful, occurred_at,
  source, from_email
) values (
  '1ead5519-1000-4000-8000-000000000933',
  '1ead5519-0000-4000-8000-000000000001',
  '1ead5519-1000-4000-8000-000000000514',
  '1ead5519-1000-4000-8000-000000000901',
  'provider-thread-budget-deferral',
  'provider-message-budget-schedule',
  'outbound', 'ops', true, now() + interval '1 minute',
  'lead_assignment_contract', 'contract-mailbox@example.invalid'
);

insert into lead_assignment_contract_values (value_name, value)
values (
  'deferred_outbound_schedule_guard',
  public.convert_opportunity_to_project(
    p_company_id => '1ead5519-0000-4000-8000-000000000001',
    p_opportunity_id => '1ead5519-1000-4000-8000-000000000514',
    p_expected_stage => 'lost',
    p_decided_by => null,
    p_source_path => 'email_accept',
    p_evidence => jsonb_build_object(
      'connection_id', '1ead5519-1000-4000-8000-000000000901',
      'email_thread_id', '1ead5519-1000-4000-8000-000000000918',
      'provider_thread_id', 'provider-thread-budget-deferral',
      'provider_message_id', 'provider-message-budget-schedule',
      'decisive_event_id', '1ead5519-1000-4000-8000-000000000933',
      'decisive_direction', 'outbound',
      'evaluated_through_event_id',
        '1ead5519-1000-4000-8000-000000000933',
      'signals', jsonb_build_array('schedule_confirmed'),
      'decision', 'auto_advance_won'
    ),
    p_expected_assignment_version => 0
  )
);

insert into public.opportunity_correspondence_events (
  id, company_id, opportunity_id, connection_id, provider_thread_id,
  provider_message_id, direction, party_role, is_meaningful, occurred_at,
  source, from_email
) values (
  '1ead5519-1000-4000-8000-000000000931',
  '1ead5519-0000-4000-8000-000000000001',
  '1ead5519-1000-4000-8000-000000000514',
  '1ead5519-1000-4000-8000-000000000901',
  'provider-thread-budget-deferral',
  'provider-message-budget-redeferral',
  'inbound', 'customer', true, now() + interval '2 minutes',
  'lead_assignment_contract', 'lead-contract-client@example.invalid'
);

insert into lead_assignment_contract_values (value_name, value)
select 'deferred_exact_retry_after_newer_event', to_jsonb(result)
from public.apply_email_opportunity_deferred_disposition(
  p_company_id => '1ead5519-0000-4000-8000-000000000001',
  p_opportunity_id => '1ead5519-1000-4000-8000-000000000514',
  p_connection_id => '1ead5519-1000-4000-8000-000000000901',
  p_provider_message_id => 'provider-message-budget-deferral',
  p_expected_assignment_version => 0,
  p_expected_stage => 'quoted',
  p_next_follow_up_at => now() + interval '9 months',
  p_evidence => jsonb_build_object(
    'reason_code', 'budget_timing',
    'signals', jsonb_build_array('budget_timing_deferral'),
    'evidence_message_ids',
      jsonb_build_array('provider-message-budget-deferral'),
    'evaluated_through_event_id',
      '1ead5519-1000-4000-8000-000000000930'
  )
) result;

insert into lead_assignment_contract_values (value_name, value)
select 'deferred_same_message_recomputed_follow_up', to_jsonb(result)
from public.apply_email_opportunity_deferred_disposition(
  p_company_id => '1ead5519-0000-4000-8000-000000000001',
  p_opportunity_id => '1ead5519-1000-4000-8000-000000000514',
  p_connection_id => '1ead5519-1000-4000-8000-000000000901',
  p_provider_message_id => 'provider-message-budget-deferral',
  p_expected_assignment_version => 0,
  p_expected_stage => 'quoted',
  p_next_follow_up_at => now() + interval '10 months',
  p_evidence => jsonb_build_object(
    'reason_code', 'budget_timing',
    'signals', jsonb_build_array('budget_timing_deferral'),
    'evidence_message_ids',
      jsonb_build_array('provider-message-budget-deferral'),
    'evaluated_through_event_id',
      '1ead5519-1000-4000-8000-000000000930'
  )
) result;

insert into lead_assignment_contract_values (value_name, value)
select 'deferred_redeferral', to_jsonb(result)
from public.apply_email_opportunity_deferred_disposition(
  p_company_id => '1ead5519-0000-4000-8000-000000000001',
  p_opportunity_id => '1ead5519-1000-4000-8000-000000000514',
  p_connection_id => '1ead5519-1000-4000-8000-000000000901',
  p_provider_message_id => 'provider-message-budget-redeferral',
  p_expected_assignment_version => 0,
  p_expected_stage => 'lost',
  p_next_follow_up_at => now() + interval '24 months',
  p_evidence => jsonb_build_object(
    'reason_code', 'budget_timing',
    'signals', jsonb_build_array('budget_timing_deferral'),
    'evidence_message_ids', jsonb_build_array(
      'provider-message-budget-deferral',
      'provider-message-budget-redeferral'
    ),
    'evaluated_through_event_id',
      '1ead5519-1000-4000-8000-000000000931'
  )
) result;

insert into lead_assignment_contract_values (value_name, value)
select 'deferred_redeferral_24_month_retry', to_jsonb(result)
from public.apply_email_opportunity_deferred_disposition(
  p_company_id => '1ead5519-0000-4000-8000-000000000001',
  p_opportunity_id => '1ead5519-1000-4000-8000-000000000514',
  p_connection_id => '1ead5519-1000-4000-8000-000000000901',
  p_provider_message_id => 'provider-message-budget-redeferral',
  p_expected_assignment_version => 0,
  p_expected_stage => 'lost',
  p_next_follow_up_at => now() + interval '24 months',
  p_evidence => jsonb_build_object(
    'reason_code', 'budget_timing',
    'signals', jsonb_build_array('budget_timing_deferral'),
    'evidence_message_ids', jsonb_build_array(
      'provider-message-budget-deferral',
      'provider-message-budget-redeferral'
    ),
    'evaluated_through_event_id',
      '1ead5519-1000-4000-8000-000000000931'
  )
) result;

insert into public.opportunity_correspondence_events (
  id, company_id, opportunity_id, connection_id, provider_thread_id,
  provider_message_id, direction, party_role, is_meaningful, occurred_at,
  source
) values (
  '1ead5519-1000-4000-8000-000000000932',
  '1ead5519-0000-4000-8000-000000000001',
  '1ead5519-1000-4000-8000-000000000514',
  '1ead5519-1000-4000-8000-000000000901',
  'provider-thread-budget-deferral',
  'provider-message-budget-accepted',
  'outbound', 'ops', true, now() + interval '3 minutes',
  'lead_assignment_contract'
);

insert into lead_assignment_contract_values (value_name, value)
values (
  'deferred_then_won_conversion',
  public.convert_opportunity_to_project(
    p_company_id => '1ead5519-0000-4000-8000-000000000001',
    p_opportunity_id => '1ead5519-1000-4000-8000-000000000514',
    p_expected_stage => 'lost',
    p_decided_by => null,
    p_source_path => 'email_accept',
    p_evidence => jsonb_build_object(
      'connection_id', '1ead5519-1000-4000-8000-000000000901',
      'email_thread_id', '1ead5519-1000-4000-8000-000000000918',
      'provider_thread_id', 'provider-thread-budget-deferral',
      'provider_message_id', 'provider-message-budget-accepted',
      'decisive_event_id', '1ead5519-1000-4000-8000-000000000932',
      'decisive_direction', 'outbound',
      'evaluated_through_event_id',
        '1ead5519-1000-4000-8000-000000000932',
      'signals', jsonb_build_array('payment_confirmed'),
      'decision', 'auto_advance_won'
    ),
    p_expected_assignment_version => 0
  )
);

-- Automated active-stage changes may move in either direction except back to
-- new_lead. An unchanged retry is idempotent, while operator and assignment
-- changes remain authoritative.
insert into lead_assignment_contract_values (value_name, value)
select 'monotonic_stage_first_apply', to_jsonb(result)
from public.apply_email_opportunity_stage_transition(
  p_company_id => '1ead5519-0000-4000-8000-000000000001',
  p_opportunity_id => '1ead5519-1000-4000-8000-000000000515',
  p_to_stage => 'negotiation',
  p_expected_stage => 'quoting',
  p_expected_assignment_version => 0,
  p_ai_signal => 'acceptance_pending'
) result;

insert into lead_assignment_contract_values (value_name, value)
select 'monotonic_stage_exact_retry', to_jsonb(result)
from public.apply_email_opportunity_stage_transition(
  p_company_id => '1ead5519-0000-4000-8000-000000000001',
  p_opportunity_id => '1ead5519-1000-4000-8000-000000000515',
  p_to_stage => 'negotiation',
  p_expected_stage => 'quoting',
  p_expected_assignment_version => 0,
  p_ai_signal => 'acceptance_pending'
) result;

insert into lead_assignment_contract_values (value_name, value)
select 'new_lead_regression_attempt', to_jsonb(result)
from public.apply_email_opportunity_stage_transition(
  p_company_id => '1ead5519-0000-4000-8000-000000000001',
  p_opportunity_id => '1ead5519-1000-4000-8000-000000000515',
  p_to_stage => 'new_lead',
  p_expected_stage => 'negotiation',
  p_expected_assignment_version => 0,
  p_ai_signal => 'generic_inbound'
) result;

update public.opportunities
   set stage_manually_set = true
 where id = '1ead5519-1000-4000-8000-000000000515';

insert into lead_assignment_contract_values (value_name, value)
select 'monotonic_stage_manual_override', to_jsonb(result)
from public.apply_email_opportunity_stage_transition(
  p_company_id => '1ead5519-0000-4000-8000-000000000001',
  p_opportunity_id => '1ead5519-1000-4000-8000-000000000515',
  p_to_stage => 'quoted',
  p_expected_stage => 'negotiation',
  p_expected_assignment_version => 0,
  p_ai_signal => 'quote_sent'
) result;

insert into lead_assignment_contract_values (value_name, value)
values (
  'monotonic_stage_assignment_change',
  public.change_opportunity_assignment_as_system(
    '1ead5519-1000-4000-8000-000000000515', 0, null,
    '1ead5519-0000-4000-8000-000000000101', 'system_repair', null, null,
    '{"contract_case":"stage_assignment_guard"}'::jsonb
  )
);

insert into lead_assignment_contract_values (value_name, value)
select 'monotonic_stage_stale_assignment', to_jsonb(result)
from public.apply_email_opportunity_stage_transition(
  p_company_id => '1ead5519-0000-4000-8000-000000000001',
  p_opportunity_id => '1ead5519-1000-4000-8000-000000000515',
  p_to_stage => 'quoted',
  p_expected_stage => 'negotiation',
  p_expected_assignment_version => 0,
  p_ai_signal => 'quote_sent'
) result;

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
  count(*) = 6
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
  'actorless_existing_project_first',
  'signed_estimate_conversion',
  'actorless_locality_one_way_conversion',
  'actorless_blank_address_empty_client_conversion',
  'actorless_client_ref_only_conversion'
);

insert into lead_assignment_contract_results (check_name, passed, details)
select
  'actorless_client_ref_only_conversion_uses_canonical_client',
  (v.value ->> 'converted')::boolean
  and (v.value ->> 'won')::boolean
  and exists (
    select 1
    from public.opportunities opportunity
    where opportunity.id = '1ead5519-1000-4000-8000-000000000523'
      and opportunity.client_ref =
        '1ead5519-0000-4000-8000-000000000404'
      and opportunity.client_id =
        '1ead5519-0000-4000-8000-000000000404'
      and opportunity.project_ref = (v.value ->> 'project_id')::uuid
      and opportunity.project_id = (v.value ->> 'project_id')::uuid
  )
  and exists (
    select 1
    from public.projects project
    where project.id = (v.value ->> 'project_id')::uuid
      and project.client_id = '1ead5519-0000-4000-8000-000000000404'
      and project.opportunity_ref =
        '1ead5519-1000-4000-8000-000000000523'
  ),
  v.value::text
from lead_assignment_contract_values v
where v.value_name = 'actorless_client_ref_only_conversion';

insert into lead_assignment_contract_results (check_name, passed, details)
select
  'actorless_blank_address_creates_only_after_empty_client_project_proof',
  (v.value ->> 'converted')::boolean
  and (v.value ->> 'won')::boolean
  and not (v.value ->> 'linked_existing')::boolean
  and exists (
    select 1
    from public.opportunities opportunity
    where opportunity.id = '1ead5519-1000-4000-8000-000000000522'
      and opportunity.stage = 'won'
      and opportunity.project_ref = (v.value ->> 'project_id')::uuid
      and opportunity.project_id = (v.value ->> 'project_id')::uuid
  )
  and (
    select count(*) = 1
    from public.projects project
    where project.company_id = '1ead5519-0000-4000-8000-000000000001'
      and project.client_id = '1ead5519-0000-4000-8000-000000000402'
      and project.deleted_at is null
  ),
  v.value::text
from lead_assignment_contract_values v
where v.value_name = 'actorless_blank_address_empty_client_conversion';

insert into lead_assignment_contract_results (check_name, passed, details)
select
  'actorless_optional_locality_one_way_link_is_reused_without_duplicate',
  (v.value ->> 'converted')::boolean
  and not (v.value ->> 'already_converted')::boolean
  and (v.value ->> 'linked_existing')::boolean
  and (v.value ->> 'won')::boolean
  and v.value ->> 'project_id' =
    '1ead5519-1000-4000-8000-000000000805'
  and exists (
    select 1
    from public.opportunities opportunity
    where opportunity.id = '1ead5519-1000-4000-8000-000000000517'
      and opportunity.stage = 'won'
      and opportunity.project_ref = '1ead5519-1000-4000-8000-000000000805'
      and opportunity.project_id = '1ead5519-1000-4000-8000-000000000805'
  )
  and exists (
    select 1
    from public.projects project
    where project.id = '1ead5519-1000-4000-8000-000000000805'
      and project.opportunity_ref = '1ead5519-1000-4000-8000-000000000517'
      and project.opportunity_id = '1ead5519-1000-4000-8000-000000000517'
  )
  and (
    select count(*) = 1
    from public.projects project
    where project.opportunity_ref = '1ead5519-1000-4000-8000-000000000517'
       or project.opportunity_id = '1ead5519-1000-4000-8000-000000000517'
  ),
  v.value::text
from lead_assignment_contract_values v
where v.value_name = 'actorless_locality_one_way_conversion';

insert into lead_assignment_contract_results (check_name, passed, details)
select
  'actorless_existing_project_link_and_retry_repair_are_duplicate_free',
  not (stage_guard.value ->> 'converted')::boolean
  and stage_guard.value ->> 'guard_reason' = 'snapshot_mismatch'
  and (first_result.value ->> 'converted')::boolean
  and not (first_result.value ->> 'already_converted')::boolean
  and (first_result.value ->> 'linked_existing')::boolean
  and first_result.value ->> 'project_id' =
    '1ead5519-1000-4000-8000-000000000804'
  and not (retry_result.value ->> 'converted')::boolean
  and (retry_result.value ->> 'already_converted')::boolean
  and retry_result.value ->> 'guard_reason' = 'already_converted'
  and retry_result.value ->> 'project_id' = first_result.value ->> 'project_id'
  and not (assignment_guard.value ->> 'converted')::boolean
  and assignment_guard.value ->> 'guard_reason' =
    'assignment_snapshot_mismatch'
  and not (manual_guard.value ->> 'converted')::boolean
  and manual_guard.value ->> 'guard_reason' = 'manual_stage_override'
  and exists (
    select 1
      from public.opportunities opportunity
     where opportunity.id = '1ead5519-1000-4000-8000-000000000513'
       and opportunity.stage = 'won'
       and opportunity.project_ref = '1ead5519-1000-4000-8000-000000000804'
       and opportunity.project_id = '1ead5519-1000-4000-8000-000000000804'
       and opportunity.assigned_to =
         '1ead5519-0000-4000-8000-000000000101'
       and opportunity.assignment_version = 1
  )
  and exists (
    select 1
      from public.projects project
     where project.id = '1ead5519-1000-4000-8000-000000000804'
       and project.opportunity_ref = '1ead5519-1000-4000-8000-000000000513'
       and project.opportunity_id =
         '1ead5519-1000-4000-8000-000000000513'
  )
  and exists (
    select 1
      from public.estimates estimate
     where estimate.id = '1ead5519-1000-4000-8000-000000000706'
       and estimate.project_ref = '1ead5519-1000-4000-8000-000000000804'
       and estimate.project_id = '1ead5519-1000-4000-8000-000000000804'
  )
  and (
    select count(*) = 1
      from public.projects project
     where project.opportunity_ref = '1ead5519-1000-4000-8000-000000000513'
        or project.opportunity_id = '1ead5519-1000-4000-8000-000000000513'
  )
  and (
    select count(*) = 1
      from public.opportunity_conversion_events event
     where event.opportunity_id = '1ead5519-1000-4000-8000-000000000513'
  )
  and (
    select count(*) = 1
      from public.opportunity_dispositions disposition
     where disposition.opportunity_id =
       '1ead5519-1000-4000-8000-000000000513'
       and disposition.disposition = 'converted_to_project'
  )
  and (
    select count(*) = 1
      from public.stage_transitions transition
     where transition.opportunity_id =
       '1ead5519-1000-4000-8000-000000000513'
       and transition.to_stage = 'won'
  ),
  jsonb_build_object(
    'first', first_result.value,
    'retry', retry_result.value
  )::text
from lead_assignment_contract_values first_result
join lead_assignment_contract_values stage_guard
  on stage_guard.value_name =
    'actorless_existing_project_stage_snapshot_guard'
join lead_assignment_contract_values retry_result
  on retry_result.value_name = 'actorless_existing_project_retry'
join lead_assignment_contract_values assignment_guard
  on assignment_guard.value_name =
    'actorless_existing_project_stale_assignment_guard'
join lead_assignment_contract_values manual_guard
  on manual_guard.value_name = 'actorless_existing_project_manual_guard'
where first_result.value_name = 'actorless_existing_project_first';

insert into lead_assignment_contract_results (check_name, passed, details)
select
  'signed_estimate_requires_and_uses_exact_attachment_inspection',
  (v.value ->> 'converted')::boolean
  and (v.value ->> 'won')::boolean
  and exists (
    select 1
      from public.opportunity_dispositions disposition
     where disposition.id = (v.value ->> 'disposition_id')::uuid
       and disposition.evidence -> 'signals' ? 'signed_estimate'
  )
  and exists (
    select 1
      from public.attachment_inspections inspection
     where inspection.email_attachment_id =
       '1ead5519-1000-4000-8000-000000000942'
       and inspection.is_signed_estimate is true
  ),
  v.value::text
from lead_assignment_contract_values v
where v.value_name = 'signed_estimate_conversion';

insert into lead_assignment_contract_results (check_name, passed, details)
select
  'deferred_first_retry_redeferral_and_lost_to_won_are_guarded',
  (first_apply.value ->> 'changed')::boolean
  and first_apply.value ->> 'stage' = 'lost'
  and first_apply.value ->> 'guard_reason' is null
  and not (schedule_guard.value ->> 'converted')::boolean
  and schedule_guard.value ->> 'guard_reason' = 'terminal_stage'
  and not (exact_retry.value ->> 'changed')::boolean
  and exact_retry.value ->> 'guard_reason' = 'already_applied'
  and exact_retry.value ->> 'disposition_id' =
    first_apply.value ->> 'disposition_id'
  and not (recomputed_retry.value ->> 'changed')::boolean
  and recomputed_retry.value ->> 'guard_reason' = 'already_applied'
  and recomputed_retry.value ->> 'disposition_id' =
    first_apply.value ->> 'disposition_id'
  and not (redeferral.value ->> 'changed')::boolean
  and redeferral.value ->> 'guard_reason' = 'follow_up_updated'
  and redeferral.value ->> 'disposition_id' <>
    first_apply.value ->> 'disposition_id'
  and (redeferral.value ->> 'next_follow_up_at')::timestamptz = (
    select (
      (event.occurred_at at time zone 'UTC') + interval '18 months'
    ) at time zone 'UTC'
    from public.opportunity_correspondence_events event
    where event.id = '1ead5519-1000-4000-8000-000000000931'
  )
  and not (redeferral_retry.value ->> 'changed')::boolean
  and redeferral_retry.value ->> 'guard_reason' = 'already_applied'
  and redeferral_retry.value ->> 'disposition_id' =
    redeferral.value ->> 'disposition_id'
  and redeferral_retry.value ->> 'next_follow_up_at' =
    redeferral.value ->> 'next_follow_up_at'
  and (won.value ->> 'converted')::boolean
  and (won.value ->> 'won')::boolean
  and exists (
    select 1
      from public.opportunities opportunity
     where opportunity.id = '1ead5519-1000-4000-8000-000000000514'
       and opportunity.stage = 'won'
       and opportunity.stage_manually_set is true
       and opportunity.lost_reason is null
       and opportunity.lost_notes is null
       and opportunity.next_follow_up_at is null
       and opportunity.actual_close_date is not null
       and opportunity.project_ref is not null
       and opportunity.project_id = opportunity.project_ref
  )
  and (
    select count(*) = 1
      from public.stage_transitions transition
     where transition.opportunity_id =
       '1ead5519-1000-4000-8000-000000000514'
       and transition.from_stage = 'quoted'
       and transition.to_stage = 'lost'
  )
  and (
    select count(*) = 1
      from public.stage_transitions transition
     where transition.opportunity_id =
       '1ead5519-1000-4000-8000-000000000514'
       and transition.from_stage = 'lost'
       and transition.to_stage = 'won'
  )
  and (
    select count(*) = 2
      from public.opportunity_dispositions disposition
     where disposition.opportunity_id =
       '1ead5519-1000-4000-8000-000000000514'
       and disposition.disposition = 'lost'
       and disposition.reason_code = 'budget_timing'
       and disposition.decided_via = 'guarded_lifecycle'
  )
  and not exists (
    select 1
      from public.opportunity_dispositions disposition
     where disposition.opportunity_id =
       '1ead5519-1000-4000-8000-000000000514'
       and disposition.disposition = 'lost'
       and disposition.superseded_at is null
  )
  and (
    select count(*) = 1
      from public.opportunity_dispositions disposition
     where disposition.opportunity_id =
       '1ead5519-1000-4000-8000-000000000514'
       and disposition.disposition = 'converted_to_project'
       and disposition.superseded_at is null
  ),
  jsonb_build_object(
    'first_apply', first_apply.value,
    'schedule_guard', schedule_guard.value,
    'exact_retry', exact_retry.value,
    'recomputed_retry', recomputed_retry.value,
    'redeferral', redeferral.value,
    'redeferral_retry', redeferral_retry.value,
    'won', won.value
  )::text
from lead_assignment_contract_values first_apply
join lead_assignment_contract_values schedule_guard
  on schedule_guard.value_name = 'deferred_outbound_schedule_guard'
join lead_assignment_contract_values exact_retry
  on exact_retry.value_name = 'deferred_exact_retry_after_newer_event'
join lead_assignment_contract_values recomputed_retry
  on recomputed_retry.value_name = 'deferred_same_message_recomputed_follow_up'
join lead_assignment_contract_values redeferral
  on redeferral.value_name = 'deferred_redeferral'
join lead_assignment_contract_values redeferral_retry
  on redeferral_retry.value_name = 'deferred_redeferral_24_month_retry'
join lead_assignment_contract_values won
  on won.value_name = 'deferred_then_won_conversion'
where first_apply.value_name = 'deferred_first_apply';

insert into lead_assignment_contract_results (check_name, passed, details)
select
  'stage_transition_retry_regression_manual_and_assignment_guards_hold',
  (first_apply.value ->> 'changed')::boolean
  and first_apply.value ->> 'stage' = 'negotiation'
  and not (exact_retry.value ->> 'changed')::boolean
  and exact_retry.value ->> 'guard_reason' = 'already_applied'
  and not (regression.value ->> 'changed')::boolean
  and regression.value ->> 'guard_reason' = 'new_lead_regression_blocked'
  and not (manual_guard.value ->> 'changed')::boolean
  and manual_guard.value ->> 'guard_reason' = 'manual_stage_override'
  and not (assignment_guard.value ->> 'changed')::boolean
  and assignment_guard.value ->> 'guard_reason' =
    'assignment_snapshot_mismatch'
  and exists (
    select 1
      from public.opportunities opportunity
     where opportunity.id = '1ead5519-1000-4000-8000-000000000515'
       and opportunity.stage = 'negotiation'
       and opportunity.stage_manually_set is true
       and opportunity.assigned_to =
         '1ead5519-0000-4000-8000-000000000101'
       and opportunity.assignment_version = 1
  )
  and (
    select count(*) = 1
      from public.stage_transitions transition
     where transition.opportunity_id =
       '1ead5519-1000-4000-8000-000000000515'
       and transition.from_stage = 'quoting'
       and transition.to_stage = 'negotiation'
  )
  and not exists (
    select 1
      from public.stage_transitions transition
     where transition.opportunity_id =
       '1ead5519-1000-4000-8000-000000000515'
       and transition.to_stage = 'new_lead'
  ),
  jsonb_build_object(
    'first_apply', first_apply.value,
    'exact_retry', exact_retry.value,
    'regression', regression.value,
    'manual_guard', manual_guard.value,
    'assignment_guard', assignment_guard.value
  )::text
from lead_assignment_contract_values first_apply
join lead_assignment_contract_values exact_retry
  on exact_retry.value_name = 'monotonic_stage_exact_retry'
join lead_assignment_contract_values regression
  on regression.value_name = 'new_lead_regression_attempt'
join lead_assignment_contract_values manual_guard
  on manual_guard.value_name = 'monotonic_stage_manual_override'
join lead_assignment_contract_values assignment_guard
  on assignment_guard.value_name = 'monotonic_stage_stale_assignment'
where first_apply.value_name = 'monotonic_stage_first_apply';

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
) values
  (
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
  ),
  (
    '1ead5519-1000-4000-8000-000000000904',
    '1ead5519-0000-4000-8000-000000000001',
    'individual',
    '1ead5519-0000-4000-8000-000000000103',
    'other-actor-personal-mailbox@example.invalid',
    'rollback-other-access-token',
    'rollback-other-refresh-token',
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
  email_connection_id, email_thread_id, email_message_id
) values
  (
    '1ead5519-2000-4000-8000-000000000601',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000503',
    null, 'note', 'Assigned lead note', 'assigned-note', null, null, null
  ),
  (
    '1ead5519-2000-4000-8000-000000000602',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000501',
    null, 'note', 'Sibling lead note', 'sibling-note', null, null, null
  ),
  (
    '1ead5519-2000-4000-8000-000000000603',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000503',
    null, 'email', 'Assigned lead email', 'assigned-email',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-child-scope-a', 'provider-message-file-a'
  ),
  (
    '1ead5519-2000-4000-8000-000000000604',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000501',
    null, 'email', 'Sibling lead email', 'sibling-email',
    '1ead5519-1000-4000-8000-000000000901',
    'provider-thread-child-scope-b', 'provider-message-file-b'
  ),
  (
    '1ead5519-2000-4000-8000-000000000605',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000506',
    '1ead5519-1000-4000-8000-000000000802',
    'note', 'Project path note', 'project-path', null, null, null
  ),
  (
    '1ead5519-2000-4000-8000-000000000606',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000503',
    null, 'email', 'Other personal mailbox email', 'wrong-mailbox-email',
    '1ead5519-1000-4000-8000-000000000904',
    'provider-thread-wrong-personal-mailbox',
    'provider-message-wrong-personal-mailbox'
  ),
  (
    '1ead5519-2000-4000-8000-000000000608',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-0000-4000-8000-000000000501',
    '1ead5519-1000-4000-8000-000000000802',
    'note', 'Legacy mismatched activity', 'must remain immutable',
    null, null, null
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

insert into public.email_attachments (
  id, company_id, connection_id, activity_id, provider_thread_id, message_id,
  attachment_id, filename, mime_type, from_email, opportunity_id,
  source_url, ingest_status, attribution_status, occurred_at
) values
  (
    '1ead5519-2000-4000-8000-000000000721',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    '1ead5519-2000-4000-8000-000000000603',
    'provider-thread-child-scope-a', 'provider-message-file-a',
    'provider-attachment-file-a', 'assigned-photo.jpg', 'image/jpeg',
    'lead-contract-client@example.invalid',
    '1ead5519-0000-4000-8000-000000000503',
    'https://example.invalid/assigned-photo.jpg',
    'external', 'attributed', now()
  ),
  (
    '1ead5519-2000-4000-8000-000000000722',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    '1ead5519-2000-4000-8000-000000000603',
    'provider-thread-child-scope-a', 'provider-message-file-a',
    'provider-attachment-file-failed', 'failed-photo.jpg', 'image/jpeg',
    'lead-contract-client@example.invalid',
    '1ead5519-0000-4000-8000-000000000503',
    null, 'failed', 'attributed', now()
  ),
  (
    '1ead5519-2000-4000-8000-000000000723',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    '1ead5519-2000-4000-8000-000000000604',
    'provider-thread-child-scope-b', 'provider-message-file-b',
    'provider-attachment-file-b', 'reassigned-photo.jpg', 'image/jpeg',
    'lead-contract-client@example.invalid',
    '1ead5519-0000-4000-8000-000000000501',
    'https://example.invalid/reassigned-photo.jpg',
    'external', 'attributed', now()
  ),
  (
    '1ead5519-2000-4000-8000-000000000724',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000904',
    '1ead5519-2000-4000-8000-000000000606',
    'provider-thread-wrong-personal-mailbox',
    'provider-message-wrong-personal-mailbox',
    'provider-attachment-wrong-personal-mailbox',
    'wrong-mailbox-photo.jpg', 'image/jpeg',
    'lead-contract-client@example.invalid',
    '1ead5519-0000-4000-8000-000000000503',
    'https://example.invalid/wrong-mailbox-photo.jpg',
    'external', 'attributed', now()
  ),
  (
    '1ead5519-2000-4000-8000-000000000725',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    '1ead5519-2000-4000-8000-000000000603',
    'provider-thread-child-scope-a', 'provider-message-file-a',
    'provider-attachment-hostless-url',
    'hostless-photo.jpg', 'image/jpeg',
    'lead-contract-client@example.invalid',
    '1ead5519-0000-4000-8000-000000000503',
    'https://?missing-host',
    'external', 'attributed', now()
  ),
  (
    '1ead5519-2000-4000-8000-000000000726',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    '1ead5519-2000-4000-8000-000000000603',
    'provider-thread-child-scope-a', 'provider-message-file-a',
    'provider-attachment-whitespace-url',
    'whitespace-photo.jpg', 'image/jpeg',
    'lead-contract-client@example.invalid',
    '1ead5519-0000-4000-8000-000000000503',
    'https://example.invalid/contains space.jpg',
    'external', 'attributed', now()
  ),
  (
    '1ead5519-2000-4000-8000-000000000727',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    '1ead5519-2000-4000-8000-000000000603',
    'provider-thread-child-scope-a', 'provider-message-file-a',
    'provider-attachment-port-only-url',
    'port-only-photo.jpg', 'image/jpeg',
    'lead-contract-client@example.invalid',
    '1ead5519-0000-4000-8000-000000000503',
    'https://:443/port-only.jpg',
    'external', 'attributed', now()
  ),
  (
    '1ead5519-2000-4000-8000-000000000728',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    '1ead5519-2000-4000-8000-000000000603',
    'provider-thread-child-scope-a', 'provider-message-file-a',
    'provider-attachment-dot-only-url',
    'dot-only-photo.jpg', 'image/jpeg',
    'lead-contract-client@example.invalid',
    '1ead5519-0000-4000-8000-000000000503',
    'https://./dot-only.jpg',
    'external', 'attributed', now()
  ),
  (
    '1ead5519-2000-4000-8000-000000000729',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    '1ead5519-2000-4000-8000-000000000603',
    'provider-thread-child-scope-a', 'provider-message-file-a',
    'provider-attachment-leading-hyphen-url',
    'hyphen-photo.jpg', 'image/jpeg',
    'lead-contract-client@example.invalid',
    '1ead5519-0000-4000-8000-000000000503',
    'https://-bad.example/hyphen.jpg',
    'external', 'attributed', now()
  ),
  (
    '1ead5519-2000-4000-8000-000000000730',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    '1ead5519-2000-4000-8000-000000000603',
    'provider-thread-child-scope-a', 'provider-message-file-a',
    'provider-attachment-malformed-ipv6-url',
    'malformed-ipv6-photo.jpg', 'image/jpeg',
    'lead-contract-client@example.invalid',
    '1ead5519-0000-4000-8000-000000000503',
    'https://[gg::1]/malformed-ipv6.jpg',
    'external', 'attributed', now()
  ),
  (
    '1ead5519-2000-4000-8000-000000000731',
    '1ead5519-0000-4000-8000-000000000001',
    '1ead5519-1000-4000-8000-000000000901',
    '1ead5519-2000-4000-8000-000000000603',
    'provider-thread-child-scope-a', 'provider-message-file-a',
    'provider-attachment-invalid-port-url',
    'bad-port-photo.jpg', 'image/jpeg',
    'lead-contract-client@example.invalid',
    '1ead5519-0000-4000-8000-000000000503',
    'https://example.invalid:70000/bad-port.jpg',
    'external', 'attributed', now()
  );

insert into lead_assignment_contract_results (check_name, passed)
values (
  'lead_file_https_url_validator_rejects_malformed_authorities',
  private.is_safe_https_attachment_url(
    'https://example.invalid:443/valid-photo.jpg'
  )
  and private.is_safe_https_attachment_url('https://192.0.2.10/photo.jpg')
  and private.is_safe_https_attachment_url('https://[2001:db8::1]/photo.jpg')
  and not private.is_safe_https_attachment_url('https://:443/port-only.jpg')
  and not private.is_safe_https_attachment_url('https://./dot-only.jpg')
  and not private.is_safe_https_attachment_url(
    'https://-bad.example/hyphen.jpg'
  )
  and not private.is_safe_https_attachment_url(
    'https://[gg::1]/malformed-ipv6.jpg'
  )
  and not private.is_safe_https_attachment_url(
    'https://example.invalid:70000/bad-port.jpg'
  )
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', '1ead5519-0000-4000-8000-000000000901',
    'email', 'login-address-differs-from-ops-user@example.invalid'
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
  'lead_file_rpc_returns_only_authorized_actionable_descriptors',
  (
    select count(*) = 1
      and min(file.id) = '1ead5519-2000-4000-8000-000000000721'::uuid
      and min(file.filename) = 'assigned-photo.jpg'
      and min(file.ingest_status) = 'external'
    from public.get_opportunity_lead_files(
      '1ead5519-0000-4000-8000-000000000503'
    ) file
  )
  and not exists (
    select 1
      from public.get_opportunity_lead_files(
        '1ead5519-0000-4000-8000-000000000501'
      )
  )
);

do $contract$
begin
  begin
    perform attachment.provider_thread_id
      from public.email_attachments attachment
     limit 1;
    insert into lead_assignment_contract_results values (
      'lead_file_clients_cannot_read_canonical_attachment_table',
      false,
      'direct select unexpectedly succeeded'
    );
  exception when sqlstate '42501' then
    insert into lead_assignment_contract_results values (
      'lead_file_clients_cannot_read_canonical_attachment_table',
      true,
      sqlerrm
    );
  end;
end;
$contract$;

reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'anon')::text,
  true
);
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
set local role anon;

insert into lead_assignment_contract_results (check_name, passed)
values (
  'lead_file_rpc_bare_anon_is_empty',
  not exists (
    select 1
      from public.get_opportunity_lead_files(
        '1ead5519-0000-4000-8000-000000000503'
      )
  )
);

reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('role', 'service_role')::text,
  true
);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

insert into lead_assignment_contract_results (check_name, passed)
values (
  'lead_file_service_role_keeps_canonical_table_access',
  has_table_privilege('service_role', 'public.email_attachments', 'select')
  and exists (
    select 1
      from public.email_attachments attachment
     where attachment.id = '1ead5519-2000-4000-8000-000000000721'
  )
);

reset role;

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
