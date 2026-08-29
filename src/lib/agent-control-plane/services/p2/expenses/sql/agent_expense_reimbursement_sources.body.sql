begin;

set local timezone = 'UTC';

-- Task 16 canonical expense and reimbursement source body. Only projected
-- values and their exact visibility/approval dependencies advance expenses.
do $prerequisites$
declare
  v_missing text[];
begin
  select pg_catalog.array_agg(required.object_name order by required.object_name)
    into v_missing
  from (
    values
      ('table', 'private.agent_read_domain_revisions'),
      ('table', 'private.agent_read_domains'),
      ('function', 'private.agent_read_domain_uuid_from_text(text)'),
      ('function', 'private.advance_agent_read_domain_revisions(uuid[],text)'),
      ('table', 'public.expenses'),
      ('table', 'public.expense_project_allocations'),
      ('table', 'public.expense_categories'),
      ('table', 'public.expense_batches'),
      ('table', 'public.users'),
      ('table', 'public.projects'),
      ('table', 'public.project_tasks')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_expense_sources_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from private.agent_read_domains domain
    where domain.domain = 'expenses'
  ) then
    raise exception 'agent_expense_domain_missing' using errcode = '55000';
  end if;
end;
$prerequisites$;

create index if not exists idx_expenses_agent_company_status_date_v1
  on public.expenses (
    company_id,
    status,
    expense_date desc,
    id
  )
  where deleted_at is null;

create index if not exists idx_expenses_agent_own_date_v1
  on public.expenses (
    company_id,
    submitted_by,
    expense_date desc,
    id
  )
  where deleted_at is null;

create index if not exists idx_expense_batches_agent_period_v1
  on public.expense_batches (
    company_id,
    period_end desc,
    id
  );

create index if not exists idx_expense_allocations_agent_project_v1
  on public.expense_project_allocations (
    project_id,
    expense_id,
    id
  );

create or replace function private.bump_agent_expense_source_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old_row jsonb;
  v_new_row jsonb;
  v_relevant_fields text[];
  v_relevant_change boolean := true;
  v_company_ids uuid[] := array[]::uuid[];
  v_old_company_id uuid;
  v_new_company_id uuid;
  v_parent_company_id uuid;
begin
  if tg_when is distinct from 'AFTER'
     or tg_level is distinct from 'ROW'
     or tg_nargs is distinct from 0
     or tg_table_schema is distinct from 'public'
     or tg_table_name not in (
       'expenses',
       'expense_project_allocations',
       'expense_categories',
       'expense_batches',
       'users',
       'projects',
       'project_tasks'
     )
     or tg_op not in ('INSERT', 'UPDATE', 'DELETE') then
    raise exception 'agent_expense_revision_trigger_misconfigured'
      using errcode = '55000';
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old_row := pg_catalog.to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_row := pg_catalog.to_jsonb(new);
  end if;

  v_relevant_fields := case tg_table_name
    when 'expenses' then array[
      'id', 'company_id', 'submitted_by', 'status', 'category_id',
      'merchant_name', 'amount', 'tax_amount', 'currency', 'expense_date',
      'batch_id', 'rejection_reason', 'flag_comment', 'flagged_at',
      'updated_at', 'deleted_at'
    ]
    when 'expense_project_allocations' then array[
      'id', 'expense_id', 'project_id', 'percentage', 'amount'
    ]
    when 'expense_categories' then array[
      'id', 'company_id', 'name'
    ]
    when 'expense_batches' then array[
      'id', 'company_id', 'batch_number', 'period_start', 'period_end',
      'status', 'submitted_by', 'total_amount', 'approved_amount',
      'paid_at'
    ]
    when 'users' then array[
      'id', 'company_id', 'first_name', 'last_name'
    ]
    when 'projects' then array[
      'id', 'company_id', 'deleted_at'
    ]
    else array[
      'id', 'company_id', 'project_id', 'team_member_ids', 'deleted_at'
    ]
  end;

  if tg_op = 'UPDATE' then
    select coalesce(pg_catalog.bool_or(
             v_old_row -> field.value is distinct from
               v_new_row -> field.value
           ), false)
      into v_relevant_change
    from pg_catalog.unnest(v_relevant_fields) field(value);
  end if;

  if not v_relevant_change then
    return null;
  end if;

  if tg_table_name = 'expense_project_allocations' then
    for v_parent_company_id in
      select distinct expense.company_id
      from public.expenses expense
      where expense.id in (
        private.agent_read_domain_uuid_from_text(v_old_row ->> 'expense_id'),
        private.agent_read_domain_uuid_from_text(v_new_row ->> 'expense_id')
      )
        and expense.company_id is not null
    loop
      v_company_ids := pg_catalog.array_append(
        v_company_ids,
        v_parent_company_id
      );
    end loop;
  else
    v_old_company_id := private.agent_read_domain_uuid_from_text(
      v_old_row ->> 'company_id'
    );
    v_new_company_id := private.agent_read_domain_uuid_from_text(
      v_new_row ->> 'company_id'
    );
    v_company_ids := array[v_old_company_id, v_new_company_id];
  end if;

  perform private.advance_agent_read_domain_revisions(
    v_company_ids,
    'expenses'
  );
  return null;
end;
$function$;

alter function private.bump_agent_expense_source_revision()
  owner to current_user;

revoke all on function private.bump_agent_expense_source_revision()
  from public, anon, authenticated, service_role;

do $canonical_acl$
declare
  v_function_oid oid;
  v_acl record;
begin
  v_function_oid := pg_catalog.to_regprocedure(
    'private.bump_agent_expense_source_revision()'
  )::oid;
  for v_acl in
    select distinct acl.grantee,
           case when acl.grantee = 0 then 'public'
             else role_row.rolname end as role_name
    from pg_catalog.pg_proc function_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function_row.proacl,
        pg_catalog.acldefault('f', function_row.proowner)
      )
    ) acl
    left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
    where function_row.oid = v_function_oid
      and acl.grantee <> function_row.proowner
  loop
    if v_acl.role_name is null then
      raise exception 'agent_expense_source_acl_role_missing'
        using errcode = '55000';
    end if;
    execute pg_catalog.format(
      'revoke all privileges on function %s from %s',
      'private.bump_agent_expense_source_revision()',
      case when v_acl.grantee = 0 then 'public'
        else pg_catalog.quote_ident(v_acl.role_name) end
    );
  end loop;
end;
$canonical_acl$;

drop trigger if exists expenses_bump_agent_expense_revision
  on public.expenses;
create trigger expenses_bump_agent_expense_revision
after insert or update or delete on public.expenses
for each row execute function private.bump_agent_expense_source_revision();

drop trigger if exists expense_project_allocations_bump_agent_expense_revision
  on public.expense_project_allocations;
create trigger expense_project_allocations_bump_agent_expense_revision
after insert or update or delete on public.expense_project_allocations
for each row execute function private.bump_agent_expense_source_revision();

drop trigger if exists expense_categories_bump_agent_expense_revision
  on public.expense_categories;
create trigger expense_categories_bump_agent_expense_revision
after insert or update or delete on public.expense_categories
for each row execute function private.bump_agent_expense_source_revision();

drop trigger if exists expense_batches_bump_agent_expense_revision
  on public.expense_batches;
create trigger expense_batches_bump_agent_expense_revision
after insert or update or delete on public.expense_batches
for each row execute function private.bump_agent_expense_source_revision();

drop trigger if exists users_bump_agent_expense_revision
  on public.users;
create trigger users_bump_agent_expense_revision
after insert or update or delete on public.users
for each row execute function private.bump_agent_expense_source_revision();

drop trigger if exists projects_bump_agent_expense_revision
  on public.projects;
create trigger projects_bump_agent_expense_revision
after insert or update or delete on public.projects
for each row execute function private.bump_agent_expense_source_revision();

drop trigger if exists project_tasks_bump_agent_expense_revision
  on public.project_tasks;
create trigger project_tasks_bump_agent_expense_revision
after insert or update or delete on public.project_tasks
for each row execute function private.bump_agent_expense_source_revision();

do $postflight$
declare
  v_table text;
  v_trigger text;
  v_valid boolean;
  v_index text;
begin
  foreach v_table in array array[
    'expenses',
    'expense_project_allocations',
    'expense_categories',
    'expense_batches',
    'users',
    'projects',
    'project_tasks'
  ] loop
    v_trigger := v_table || '_bump_agent_expense_revision';
    select pg_catalog.count(*) = 1
       and pg_catalog.bool_and(
         trigger_row.tgenabled = 'O'
         and not trigger_row.tgisinternal
         and procedure.proname = 'bump_agent_expense_source_revision'
         and procedure_namespace.nspname = 'private'
         and pg_catalog.encode(trigger_row.tgargs, 'escape') = ''
       )
      into v_valid
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation
      on relation.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc procedure
      on procedure.oid = trigger_row.tgfoid
    join pg_catalog.pg_namespace procedure_namespace
      on procedure_namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and relation.relname = v_table
      and trigger_row.tgname = v_trigger;

    if not coalesce(v_valid, false) then
      raise exception 'agent_expense_source_trigger_invalid: %', v_trigger
        using errcode = '55000';
    end if;
  end loop;

  foreach v_index in array array[
    'idx_expenses_agent_company_status_date_v1',
    'idx_expenses_agent_own_date_v1',
    'idx_expense_batches_agent_period_v1',
    'idx_expense_allocations_agent_project_v1'
  ] loop
    select pg_catalog.count(*) = 1
       and pg_catalog.bool_and(
         index_row.indisvalid
         and index_row.indisready
         and index_row.indislive
         and not index_row.indisunique
       )
      into v_valid
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = index_relation.relnamespace
    where namespace.nspname = 'public'
      and index_relation.relname = v_index;

    if not coalesce(v_valid, false) then
      raise exception 'agent_expense_source_index_invalid: %', v_index
        using errcode = '55000';
    end if;
  end loop;

  if pg_catalog.has_function_privilege(
       'public',
       'private.bump_agent_expense_source_revision()',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'private.bump_agent_expense_source_revision()',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'private.bump_agent_expense_source_revision()',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role',
       'private.bump_agent_expense_source_revision()',
       'EXECUTE'
     ) then
    raise exception 'agent_expense_source_function_acl_invalid'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc function_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function_row.proacl,
        pg_catalog.acldefault('f', function_row.proowner)
      )
    ) acl
    where function_row.oid = pg_catalog.to_regprocedure(
      'private.bump_agent_expense_source_revision()'
    )::oid
      and acl.grantee <> function_row.proowner
  ) then
    raise exception 'agent_expense_source_function_acl_not_canonical'
      using errcode = '55000';
  end if;
end;
$postflight$;

commit;
