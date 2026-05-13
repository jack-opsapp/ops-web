-- Projects table redesign Phase 1 SQL contract.
-- Read-only checks are safe against the linked Supabase project.
-- Fixture checks run inside an explicit transaction and finish with ROLLBACK.

-- 1. Read-only policy/cache contracts.
with
role_scope_policy as (
  select pol.polpermissive
  from pg_policy pol
  join pg_class cls on cls.oid = pol.polrelid
  join pg_namespace ns on ns.oid = cls.relnamespace
  where ns.nspname = 'public'
    and cls.relname = 'projects'
    and pol.polname = 'role_scope_update'
),
task_union as (
  select p.id,
         coalesce(array_agg(distinct tm order by tm) filter (where tm is not null), array[]::text[]) as task_team
  from public.projects p
  left join public.project_tasks t on t.project_id = p.id and t.deleted_at is null
  left join lateral unnest(coalesce(t.team_member_ids, array[]::text[])) tm on true
  where p.deleted_at is null
  group by p.id
),
project_team as (
  select id,
         coalesce(array(select distinct x from unnest(coalesce(team_member_ids, array[]::text[])) x order by x), array[]::text[]) as project_team
  from public.projects
  where deleted_at is null
),
team_cache_mismatches as (
  select count(*) as mismatch_count
  from project_team p
  join task_union t using (id)
  where p.project_team <> t.task_team
)
select
  coalesce((select polpermissive = false from role_scope_policy), false) as role_scope_update_is_restrictive,
  (select mismatch_count = 0 from team_cache_mismatches) as no_team_cache_mismatches;

-- 2. Read-only object/grant contracts for project_views and project_table_rows.
with
project_views_rel as (
  select c.oid, c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'project_views'
    and c.relkind in ('r', 'p')
),
project_table_rows_rel as (
  select c.oid, c.reloptions
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'project_table_rows'
    and c.relkind = 'v'
),
authenticated_role as (
  select oid
  from pg_roles
  where rolname = 'authenticated'
)
select
  exists(select 1 from project_views_rel) as project_views_table_exists,
  coalesce((select relrowsecurity from project_views_rel), false) as project_views_rls_enabled,
  (
    has_table_privilege('authenticated', 'public.project_views', 'SELECT')
    and has_table_privilege('authenticated', 'public.project_views', 'INSERT')
    and has_table_privilege('authenticated', 'public.project_views', 'UPDATE')
    and has_table_privilege('authenticated', 'public.project_views', 'DELETE')
  ) as project_views_authenticated_dml_granted,
  has_table_privilege('anon', 'public.project_views', 'SELECT') as project_views_anon_select_granted_for_firebase_bridge,
  (
    not has_table_privilege('anon', 'public.project_views', 'INSERT')
    and not has_table_privilege('anon', 'public.project_views', 'UPDATE')
    and not has_table_privilege('anon', 'public.project_views', 'DELETE')
  ) as project_views_anon_dml_not_granted_for_firebase_bridge,
  (
    select count(*) = 3
    from pg_policy pol
    join project_views_rel rel on rel.oid = pol.polrelid
    where pol.polname in (
      'users read company and own views',
      'users manage own views',
      'admins manage company views'
    )
  ) as project_views_expected_policies_exist,
  (
    select count(*) = 1
    from pg_policy pol
    join project_views_rel rel on rel.oid = pol.polrelid
    where pol.polname = 'users read company and own views'
      and pol.polcmd = 'r'
      and pol.polroles = array[0]::oid[]
  ) as project_views_read_policy_applies_to_public,
  (
    select count(*) = 2
    from pg_policy pol
    join project_views_rel rel on rel.oid = pol.polrelid
    where pol.polname in (
      'users manage own views',
      'admins manage company views'
    )
      and pol.polcmd = '*'
      and pol.polroles = array[(select oid from authenticated_role)]::oid[]
  ) as project_views_manage_policies_remain_authenticated,
  (
    select count(*) = 3
    from pg_constraint con
    join project_views_rel rel on rel.oid = con.conrelid
    where con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%octet_length%'
      and (
        pg_get_constraintdef(con.oid) like '%columns%32768%'
        or pg_get_constraintdef(con.oid) like '%filters%16384%'
        or pg_get_constraintdef(con.oid) like '%sort%4096%'
      )
  ) as project_views_jsonb_size_caps_exist,
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'project_views'
      and indexname = 'project_views_unique_lower_name'
      and indexdef like '%UNIQUE%'
      and indexdef like '%lower(name)%'
      and indexdef like '%is_archived = false%'
  ) as project_views_unique_lower_active_name_index_exists,
  exists(select 1 from project_table_rows_rel) as project_table_rows_view_exists,
  coalesce((select reloptions @> array['security_invoker=true'] from project_table_rows_rel), false) as project_table_rows_security_invoker,
  has_table_privilege('authenticated', 'public.project_table_rows', 'SELECT') as project_table_rows_authenticated_select_granted,
  has_table_privilege('anon', 'public.project_table_rows', 'SELECT') as project_table_rows_anon_select_granted_for_firebase_bridge,
  (
    not has_table_privilege('anon', 'public.project_table_rows', 'INSERT')
    and not has_table_privilege('anon', 'public.project_table_rows', 'UPDATE')
    and not has_table_privilege('anon', 'public.project_table_rows', 'DELETE')
  ) as project_table_rows_anon_dml_not_granted_for_firebase_bridge,
  (
    not has_function_privilege('anon', 'public.change_project_status(uuid, text, timestamp with time zone)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.assign_project_team_member(uuid, uuid, uuid[], timestamp with time zone)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.remove_project_team_member(uuid, uuid, uuid[], timestamp with time zone)', 'EXECUTE')
  ) as project_table_mutation_rpcs_anon_execute_not_granted;

-- 3. Fixture-backed contracts. Safe shape: all writes roll back.
begin;

create temp table contract_fixture_results (
  check_name text primary key,
  passed boolean not null
) on commit drop;

grant select, insert on contract_fixture_results to authenticated;

insert into public.companies (id, bubble_id, name, subscription_status, subscription_plan)
values
  ('f116e6e0-0000-4000-8000-000000000001', 'sql-contract-company-a', 'SQL Contract Company A', 'trial', 'trial'),
  ('f116e6e0-0000-4000-8000-000000000002', 'sql-contract-company-b', 'SQL Contract Company B', 'trial', 'trial');

insert into public.users (
  id,
  company_id,
  auth_id,
  firebase_uid,
  first_name,
  last_name,
  email,
  is_company_admin
)
values
  (
    'f116e6e0-0000-4000-8000-000000000101',
    'f116e6e0-0000-4000-8000-000000000001',
    'f116e6e0-0000-4000-8000-000000000901',
    'f116e6e0-0000-4000-8000-000000000901',
    'SQL',
    'Contract',
    'ops-sql-contract-user-a@example.invalid',
    false
  ),
  (
    'f116e6e0-0000-4000-8000-000000000102',
    'f116e6e0-0000-4000-8000-000000000002',
    'f116e6e0-0000-4000-8000-000000000902',
    'f116e6e0-0000-4000-8000-000000000902',
    'SQL',
    'Cross',
    'ops-sql-contract-user-b@example.invalid',
    false
  );

insert into public.roles (id, name, description, is_preset, company_id, hierarchy)
values
  (
    'f116e6e0-0000-4000-8000-000000000201',
    'SQL Contract Assigned',
    'Rollback-only project table contract role.',
    false,
    'f116e6e0-0000-4000-8000-000000000001',
    4
  ),
  (
    'f116e6e0-0000-4000-8000-000000000202',
    'SQL Contract All',
    'Rollback-only project table contract role.',
    false,
    'f116e6e0-0000-4000-8000-000000000001',
    3
  );

insert into public.role_permissions (role_id, permission, scope)
values
  ('f116e6e0-0000-4000-8000-000000000201', 'projects.view', 'assigned'),
  ('f116e6e0-0000-4000-8000-000000000201', 'tasks.view', 'assigned'),
  ('f116e6e0-0000-4000-8000-000000000202', 'projects.edit', 'all');

insert into public.user_roles (id, user_id, role_id)
values
  (
    'f116e6e0-0000-4000-8000-000000000301',
    'f116e6e0-0000-4000-8000-000000000101',
    'f116e6e0-0000-4000-8000-000000000201'
  ),
  (
    'f116e6e0-0000-4000-8000-000000000302',
    'f116e6e0-0000-4000-8000-000000000101',
    'f116e6e0-0000-4000-8000-000000000202'
  );

insert into public.projects (id, company_id, title, status, team_member_ids)
values
  (
    'f116e6e0-0000-4000-8000-000000000401',
    'f116e6e0-0000-4000-8000-000000000001',
    'SQL Contract Deleted Task Project',
    'in_progress',
    array[]::text[]
  ),
  (
    'f116e6e0-0000-4000-8000-000000000402',
    'f116e6e0-0000-4000-8000-000000000001',
    'SQL Contract Active Project',
    'in_progress',
    array[]::text[]
  ),
  (
    'f116e6e0-0000-4000-8000-000000000403',
    'f116e6e0-0000-4000-8000-000000000002',
    'SQL Contract Cross Company Project',
    'in_progress',
    array['f116e6e0-0000-4000-8000-000000000101']::text[]
  );

insert into public.project_tasks (
  id,
  company_id,
  project_id,
  custom_title,
  status,
  start_date,
  display_order,
  team_member_ids,
  deleted_at
)
values
  (
    'f116e6e0-0000-4000-8000-000000000501',
    'f116e6e0-0000-4000-8000-000000000001',
    'f116e6e0-0000-4000-8000-000000000401',
    'Deleted task should not grant membership',
    'active',
    now() - interval '2 days',
    1,
    array['f116e6e0-0000-4000-8000-000000000101']::text[],
    now()
  ),
  (
    'f116e6e0-0000-4000-8000-000000000502',
    'f116e6e0-0000-4000-8000-000000000001',
    'f116e6e0-0000-4000-8000-000000000402',
    'Cancelled should not surface',
    'cancelled',
    now() - interval '1 day',
    1,
    array['f116e6e0-0000-4000-8000-000000000101']::text[],
    null
  ),
  (
    'f116e6e0-0000-4000-8000-000000000503',
    'f116e6e0-0000-4000-8000-000000000001',
    'f116e6e0-0000-4000-8000-000000000402',
    'Active should surface',
    'active',
    now() + interval '1 day',
    2,
    array['f116e6e0-0000-4000-8000-000000000101']::text[],
    null
  ),
  (
    'f116e6e0-0000-4000-8000-000000000504',
    'f116e6e0-0000-4000-8000-000000000002',
    'f116e6e0-0000-4000-8000-000000000403',
    'Cross company task should not grant scope',
    'active',
    now(),
    1,
    array['f116e6e0-0000-4000-8000-000000000101']::text[],
    null
  );

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'email',
    'ops-sql-contract-user-a@example.invalid',
    'sub',
    'f116e6e0-0000-4000-8000-000000000901'
  )::text,
  true
);
select set_config('request.jwt.claim.sub', 'f116e6e0-0000-4000-8000-000000000901', true);

set local role authenticated;

insert into contract_fixture_results (check_name, passed)
values (
  'current_user_in_project_ignores_deleted_tasks',
  private.current_user_in_project('f116e6e0-0000-4000-8000-000000000401') is false
);

insert into contract_fixture_results (check_name, passed)
values (
  'scoped_project_helpers_reject_cross_company_project',
  private.current_user_can_edit_project('f116e6e0-0000-4000-8000-000000000403') is false
  and private.current_user_can_assign_team_on_project('f116e6e0-0000-4000-8000-000000000403') is false
);

insert into contract_fixture_results (check_name, passed)
values (
  'project_table_rows_financials_null_without_permission',
  coalesce((
    select estimate_total is null
      and invoice_total is null
      and paid_total is null
      and value is null
      and project_cost is null
      and margin is null
    from public.project_table_rows
    where id = 'f116e6e0-0000-4000-8000-000000000402'
  ), false)
);

insert into contract_fixture_results (check_name, passed)
values (
  'project_table_rows_next_task_excludes_cancelled',
  coalesce((
    select next_task = 'Active should surface'
    from public.project_table_rows
    where id = 'f116e6e0-0000-4000-8000-000000000402'
  ), false)
);

insert into public.project_views (
  id,
  company_id,
  owner_type,
  owner_id,
  name,
  columns,
  filters,
  sort
)
values (
  'f116e6e0-0000-4000-8000-000000000601',
  'f116e6e0-0000-4000-8000-000000000001',
  'user',
  'f116e6e0-0000-4000-8000-000000000101',
  'Duplicate Active',
  '[]'::jsonb,
  '{}'::jsonb,
  '[]'::jsonb
);

do $$
begin
  begin
    insert into public.project_views (
      id,
      company_id,
      owner_type,
      owner_id,
      name,
      columns,
      filters,
      sort
    )
    values (
      'f116e6e0-0000-4000-8000-000000000602',
      'f116e6e0-0000-4000-8000-000000000001',
      'user',
      'f116e6e0-0000-4000-8000-000000000101',
      'duplicate active',
      '[]'::jsonb,
      '{}'::jsonb,
      '[]'::jsonb
    );

    insert into contract_fixture_results (check_name, passed)
    values ('project_views_duplicate_active_name_rejected', false);
  exception
    when unique_violation then
      insert into contract_fixture_results (check_name, passed)
      values ('project_views_duplicate_active_name_rejected', true);
    when others then
      insert into contract_fixture_results (check_name, passed)
      values ('project_views_duplicate_active_name_rejected', false);
  end;
end $$;

do $$
begin
  begin
    insert into public.project_views (
      id,
      company_id,
      owner_type,
      owner_id,
      name,
      is_archived,
      columns,
      filters,
      sort
    )
    values (
      'f116e6e0-0000-4000-8000-000000000603',
      'f116e6e0-0000-4000-8000-000000000001',
      'user',
      'f116e6e0-0000-4000-8000-000000000101',
      'Reusable Name',
      true,
      '[]'::jsonb,
      '{}'::jsonb,
      '[]'::jsonb
    );

    insert into public.project_views (
      id,
      company_id,
      owner_type,
      owner_id,
      name,
      columns,
      filters,
      sort
    )
    values (
      'f116e6e0-0000-4000-8000-000000000604',
      'f116e6e0-0000-4000-8000-000000000001',
      'user',
      'f116e6e0-0000-4000-8000-000000000101',
      'reusable name',
      '[]'::jsonb,
      '{}'::jsonb,
      '[]'::jsonb
    );

    insert into contract_fixture_results (check_name, passed)
    values ('project_views_archived_name_reuse_allowed', true);
  exception
    when others then
      insert into contract_fixture_results (check_name, passed)
      values ('project_views_archived_name_reuse_allowed', false);
  end;
end $$;

do $$
begin
  begin
    insert into public.project_views (
      id,
      company_id,
      owner_type,
      owner_id,
      name,
      permission_key,
      columns,
      filters,
      sort
    )
    values (
      'f116e6e0-0000-4000-8000-000000000605',
      'f116e6e0-0000-4000-8000-000000000001',
      'user',
      'f116e6e0-0000-4000-8000-000000000101',
      'Escalation Attempt',
      'projects.view_financials',
      '[]'::jsonb,
      '{}'::jsonb,
      '[]'::jsonb
    );

    insert into contract_fixture_results (check_name, passed)
    values ('project_views_personal_permission_key_escalation_rejected', false);
  exception
    when sqlstate '42501' or sqlstate '44000' then
      insert into contract_fixture_results (check_name, passed)
      values ('project_views_personal_permission_key_escalation_rejected', true);
    when others then
      insert into contract_fixture_results (check_name, passed)
      values ('project_views_personal_permission_key_escalation_rejected', false);
  end;
end $$;

reset role;

select
  coalesce(bool_or(passed) filter (where check_name = 'current_user_in_project_ignores_deleted_tasks'), false) as current_user_in_project_ignores_deleted_tasks,
  coalesce(bool_or(passed) filter (where check_name = 'scoped_project_helpers_reject_cross_company_project'), false) as scoped_project_helpers_reject_cross_company_project,
  coalesce(bool_or(passed) filter (where check_name = 'project_table_rows_financials_null_without_permission'), false) as project_table_rows_financials_null_without_permission,
  coalesce(bool_or(passed) filter (where check_name = 'project_table_rows_next_task_excludes_cancelled'), false) as project_table_rows_next_task_excludes_cancelled,
  coalesce(bool_or(passed) filter (where check_name = 'project_views_duplicate_active_name_rejected'), false) as project_views_duplicate_active_name_rejected,
  coalesce(bool_or(passed) filter (where check_name = 'project_views_archived_name_reuse_allowed'), false) as project_views_archived_name_reuse_allowed,
  coalesce(bool_or(passed) filter (where check_name = 'project_views_personal_permission_key_escalation_rejected'), false) as project_views_personal_permission_key_escalation_rejected
from contract_fixture_results;

rollback;
