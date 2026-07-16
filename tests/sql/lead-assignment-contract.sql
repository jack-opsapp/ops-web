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
  );

insert into public.role_permissions (role_id, permission, scope)
values
  ('1ead5519-0000-4000-8000-000000000201', 'pipeline.create', 'all'),
  ('1ead5519-0000-4000-8000-000000000201', 'pipeline.view', 'assigned'),
  ('1ead5519-0000-4000-8000-000000000201', 'pipeline.assign', 'assigned'),
  ('1ead5519-0000-4000-8000-000000000201', 'pipeline.convert', 'assigned'),
  ('1ead5519-0000-4000-8000-000000000201', 'projects.create', 'all'),
  ('1ead5519-0000-4000-8000-000000000202', 'pipeline.create', 'all'),
  ('1ead5519-0000-4000-8000-000000000202', 'pipeline.view', 'all'),
  ('1ead5519-0000-4000-8000-000000000202', 'pipeline.assign', 'all'),
  ('1ead5519-0000-4000-8000-000000000202', 'pipeline.convert', 'all'),
  ('1ead5519-0000-4000-8000-000000000202', 'pipeline.manage', 'all'),
  ('1ead5519-0000-4000-8000-000000000203', 'pipeline.view', 'assigned'),
  ('1ead5519-0000-4000-8000-000000000203', 'pipeline.assign', 'assigned'),
  ('1ead5519-0000-4000-8000-000000000204', 'pipeline.view', 'assigned');

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
    p_source_path => 'lead_assignment_sql_contract',
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
    p_source_path => 'lead_assignment_sql_contract',
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
    p_source_path => 'lead_assignment_sql_contract_retry',
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
