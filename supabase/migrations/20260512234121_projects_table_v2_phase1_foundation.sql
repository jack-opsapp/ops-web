begin;

-- A. Generic updated_at trigger helper.
create or replace function public.fn_set_updated_at()
returns trigger
language plpgsql
set search_path = 'public', 'pg_temp'
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- B1. Active-row project membership helper.
create or replace function private.current_user_in_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.deleted_at is null
      and p.company_id = (select private.get_user_company_id())
      and private.get_current_user_id()::text = any(coalesce(p.team_member_ids, array[]::text[]))
  ) or exists (
    select 1
    from public.project_tasks pt
    join public.projects p on p.id = pt.project_id
    where pt.project_id = p_project_id
      and pt.deleted_at is null
      and p.deleted_at is null
      and p.company_id = (select private.get_user_company_id())
      and private.get_current_user_id()::text = any(coalesce(pt.team_member_ids, array[]::text[]))
  );
$$;

-- B2. Scoped write helpers.
create or replace function private.current_user_can_edit_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.deleted_at is null
      and p.company_id = (select private.get_user_company_id())
  ) and (
    private.current_user_is_admin()
    or private.current_user_scope_for('projects.edit') = 'all'
    or (
      private.current_user_scope_for('projects.edit') = 'assigned'
      and private.current_user_in_project(p_project_id)
    )
  );
$$;

create or replace function private.current_user_can_assign_team_on_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.deleted_at is null
      and p.company_id = (select private.get_user_company_id())
  ) and (
    private.current_user_is_admin()
    or private.current_user_scope_for('projects.assign_team') = 'all'
    or (
      private.current_user_scope_for('projects.assign_team') = 'assigned'
      and private.current_user_in_project(p_project_id)
    )
  );
$$;

grant execute on function private.current_user_can_edit_project(uuid) to authenticated;
grant execute on function private.current_user_can_assign_team_on_project(uuid) to authenticated;

-- C. Saved views table.
create table if not exists public.project_views (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  owner_type text not null check (owner_type in ('company', 'user')),
  owner_id uuid not null,
  name text not null check (char_length(name) between 1 and 60),
  icon text check (icon is null or char_length(icon) <= 40),
  description text check (description is null or char_length(description) <= 240),
  permission_key text check (permission_key is null or permission_key in ('projects.view_financials')),
  is_default boolean not null default false,
  is_archived boolean not null default false,
  sort_position integer not null default 0,
  columns jsonb not null check (octet_length(columns::text) <= 32768),
  filters jsonb not null check (octet_length(filters::text) <= 16384),
  sort jsonb not null check (octet_length(sort::text) <= 4096),
  density text not null default 'comfortable' check (density in ('compact', 'comfortable', 'spacious')),
  zoom_level numeric(3,2) not null default 1.00 check (zoom_level >= 0.75 and zoom_level <= 1.50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id)
);

create unique index if not exists project_views_unique_lower_name
  on public.project_views (company_id, owner_type, owner_id, lower(name))
  where is_archived = false;

create index if not exists idx_project_views_company
  on public.project_views(company_id)
  where is_archived = false;

create index if not exists idx_project_views_owner
  on public.project_views(owner_type, owner_id)
  where is_archived = false;

drop trigger if exists project_views_set_updated_at on public.project_views;
create trigger project_views_set_updated_at
  before update on public.project_views
  for each row execute function public.fn_set_updated_at();

alter table public.project_views enable row level security;

revoke all on table public.project_views from anon;
grant select, insert, update, delete on table public.project_views to authenticated;

drop policy if exists "users read company and own views" on public.project_views;
create policy "users read company and own views"
on public.project_views for select
to authenticated
using (
  company_id = (select company_id from public.users where id = (select private.get_current_user_id()))
  and (
    owner_type = 'company'
    or (owner_type = 'user' and owner_id = (select private.get_current_user_id()))
  )
  and (
    permission_key is null
    or public.has_permission((select private.get_current_user_id()), permission_key, 'all')
  )
);

drop policy if exists "users manage own views" on public.project_views;
create policy "users manage own views"
on public.project_views for all
to authenticated
using (
  company_id = (select company_id from public.users where id = (select private.get_current_user_id()))
  and owner_type = 'user'
  and owner_id = (select private.get_current_user_id())
)
with check (
  company_id = (select company_id from public.users where id = (select private.get_current_user_id()))
  and owner_type = 'user'
  and owner_id = (select private.get_current_user_id())
  and (
    permission_key is null
    or public.has_permission((select private.get_current_user_id()), 'projects.manage_views', 'all')
  )
);

drop policy if exists "admins manage company views" on public.project_views;
create policy "admins manage company views"
on public.project_views for all
to authenticated
using (
  company_id = (select company_id from public.users where id = (select private.get_current_user_id()))
  and owner_type = 'company'
  and public.has_permission((select private.get_current_user_id()), 'projects.manage_views', 'all')
)
with check (
  company_id = (select company_id from public.users where id = (select private.get_current_user_id()))
  and owner_type = 'company'
  and public.has_permission((select private.get_current_user_id()), 'projects.manage_views', 'all')
);

-- E. New permission grants.
with target_roles as (
  select id, name
  from public.roles
  where company_id is null
    and name in ('Admin', 'Owner', 'Office')
  union
  select id, name
  from public.roles
  where lower(name) = 'accountant'
), grants as (
  select id as role_id, 'projects.view_financials'::text as permission, 'all'::text as scope
  from target_roles
  where name in ('Admin', 'Owner', 'Office') or lower(name) = 'accountant'
  union all
  select id as role_id, 'projects.manage_views'::text as permission, 'all'::text as scope
  from target_roles
  where name in ('Admin', 'Owner')
)
insert into public.role_permissions (role_id, permission, scope)
select role_id, permission, scope
from grants
on conflict (role_id, permission) do update
set scope = excluded.scope;

-- F. Scoped project update policy. Must remain restrictive.
drop policy if exists role_scope_update on public.projects;
create policy role_scope_update
on public.projects
as restrictive
for update
to authenticated
using (private.current_user_can_edit_project(id));

-- G. Project team cache helper.
create or replace function private.recompute_project_team_member_ids(p_project_id uuid)
returns text[]
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_team text[];
begin
  select coalesce(array_agg(distinct member_id order by member_id), array[]::text[])
  into v_team
  from (
    select unnest(coalesce(pt.team_member_ids, array[]::text[])) as member_id
    from public.project_tasks pt
    where pt.project_id = p_project_id
      and pt.deleted_at is null
  ) members
  where member_id is not null and member_id <> '';

  update public.projects p
  set
    team_member_ids = v_team,
    updated_at = now()
  where p.id = p_project_id
    and p.deleted_at is null
    and coalesce(p.team_member_ids, array[]::text[]) is distinct from v_team;

  return v_team;
end;
$$;

create or replace function private.sync_project_team_member_ids_from_tasks()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
begin
  if tg_op = 'DELETE' then
    perform private.recompute_project_team_member_ids(old.project_id);
    return old;
  end if;

  if tg_op = 'INSERT' then
    perform private.recompute_project_team_member_ids(new.project_id);
    return new;
  end if;

  if old.project_id is distinct from new.project_id then
    perform private.recompute_project_team_member_ids(old.project_id);
  end if;

  perform private.recompute_project_team_member_ids(new.project_id);
  return new;
end;
$$;

-- One-time backfill before trigger creation.
do $$
declare
  v_project record;
begin
  for v_project in
    select id from public.projects where deleted_at is null
  loop
    perform private.recompute_project_team_member_ids(v_project.id);
  end loop;
end;
$$;

drop trigger if exists project_tasks_sync_project_team_member_ids on public.project_tasks;
create trigger project_tasks_sync_project_team_member_ids
  after insert or delete or update of team_member_ids, deleted_at, project_id
  on public.project_tasks
  for each row execute function private.sync_project_team_member_ids_from_tasks();

-- H. Project status RPC.
create or replace function public.change_project_status(
  p_project_id uuid,
  p_new_status text,
  p_expected_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_project public.projects%rowtype;
  v_updated_at timestamptz;
begin
  if p_project_id is null or p_new_status is null or p_expected_updated_at is null then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;

  if p_new_status not in ('rfq', 'estimated', 'accepted', 'in_progress', 'completed', 'closed', 'archived') then
    raise exception 'invalid project status' using errcode = '22023';
  end if;

  if not private.current_user_can_edit_project(p_project_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select * into v_project
  from public.projects
  where id = p_project_id and deleted_at is null
  for update;

  if not found or v_project.updated_at is distinct from p_expected_updated_at then
    raise exception 'project conflict' using errcode = 'P0001';
  end if;

  update public.projects
  set status = p_new_status, updated_at = now()
  where id = p_project_id
  returning updated_at into v_updated_at;

  insert into public.project_notes (
    project_id,
    company_id,
    author_id,
    content,
    event_kind,
    content_metadata
  ) values (
    p_project_id::text,
    v_project.company_id::text,
    private.get_current_user_id()::text,
    'Status changed',
    'status_change',
    jsonb_build_object('from', v_project.status, 'to', p_new_status)
  );

  return jsonb_build_object('updated_at', v_updated_at, 'from_status', v_project.status, 'to_status', p_new_status);
end;
$$;

revoke execute on function public.change_project_status(uuid, text, timestamptz) from public, anon;
grant execute on function public.change_project_status(uuid, text, timestamptz) to authenticated;

-- I. Project team assignment RPCs.
create or replace function public.assign_project_team_member(
  p_project_id uuid,
  p_user_id uuid,
  p_task_ids uuid[],
  p_expected_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_project public.projects%rowtype;
  v_user_company_id uuid;
  v_valid_task_count integer;
  v_updated_at timestamptz;
  v_team text[];
begin
  if p_project_id is null
    or p_user_id is null
    or p_expected_updated_at is null
    or p_task_ids is null
    or cardinality(p_task_ids) = 0
  then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;

  select * into v_project
  from public.projects
  where id = p_project_id and deleted_at is null
  for update;

  if not found then
    raise exception 'project not found' using errcode = '22023';
  end if;

  select company_id into v_user_company_id
  from public.users
  where id = p_user_id and deleted_at is null;

  if not found or v_user_company_id is distinct from v_project.company_id then
    raise exception 'invalid team member' using errcode = '22023';
  end if;

  select count(distinct id) into v_valid_task_count
  from public.project_tasks
  where id = any(p_task_ids)
    and project_id = p_project_id
    and deleted_at is null;

  if v_valid_task_count <> cardinality(p_task_ids) then
    raise exception 'invalid task ids' using errcode = '22023';
  end if;

  if not private.current_user_can_assign_team_on_project(p_project_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v_project.updated_at is distinct from p_expected_updated_at then
    raise exception 'project conflict' using errcode = 'P0001';
  end if;

  update public.project_tasks
  set team_member_ids = coalesce((
    select array_agg(distinct member_id order by member_id)
    from unnest(coalesce(team_member_ids, array[]::text[]) || array[p_user_id::text]) member_id
    where member_id is not null and member_id <> ''
  ), array[]::text[])
  where id = any(p_task_ids)
    and project_id = p_project_id
    and deleted_at is null;

  select updated_at, team_member_ids
  into v_updated_at, v_team
  from public.projects
  where id = p_project_id;

  return jsonb_build_object('updated_at', v_updated_at, 'team_member_ids', coalesce(v_team, array[]::text[]));
end;
$$;

revoke execute on function public.assign_project_team_member(uuid, uuid, uuid[], timestamptz) from public, anon;
grant execute on function public.assign_project_team_member(uuid, uuid, uuid[], timestamptz) to authenticated;

create or replace function public.remove_project_team_member(
  p_project_id uuid,
  p_user_id uuid,
  p_task_ids uuid[] default null,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_project public.projects%rowtype;
  v_valid_task_count integer;
  v_updated_at timestamptz;
  v_team text[];
begin
  if p_project_id is null or p_user_id is null or p_expected_updated_at is null then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;

  select * into v_project
  from public.projects
  where id = p_project_id and deleted_at is null
  for update;

  if not found then
    raise exception 'project not found' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.users where id = p_user_id and deleted_at is null
  ) then
    raise exception 'invalid team member' using errcode = '22023';
  end if;

  if p_task_ids is not null then
    if cardinality(p_task_ids) = 0 then
      raise exception 'invalid task ids' using errcode = '22023';
    end if;

    select count(distinct id) into v_valid_task_count
    from public.project_tasks
    where id = any(p_task_ids)
      and project_id = p_project_id
      and deleted_at is null;

    if v_valid_task_count <> cardinality(p_task_ids) then
      raise exception 'invalid task ids' using errcode = '22023';
    end if;
  end if;

  if not private.current_user_can_assign_team_on_project(p_project_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if v_project.updated_at is distinct from p_expected_updated_at then
    raise exception 'project conflict' using errcode = 'P0001';
  end if;

  update public.project_tasks
  set team_member_ids = coalesce((
    select array_agg(member_id order by member_id)
    from (
      select distinct member_id
      from unnest(coalesce(team_member_ids, array[]::text[])) member_id
      where member_id is not null
        and member_id <> ''
        and member_id <> p_user_id::text
    ) remaining
  ), array[]::text[])
  where project_id = p_project_id
    and deleted_at is null
    and (p_task_ids is null or id = any(p_task_ids));

  select updated_at, team_member_ids
  into v_updated_at, v_team
  from public.projects
  where id = p_project_id;

  return jsonb_build_object('updated_at', v_updated_at, 'team_member_ids', coalesce(v_team, array[]::text[]));
end;
$$;

revoke execute on function public.remove_project_team_member(uuid, uuid, uuid[], timestamptz) from public, anon;
grant execute on function public.remove_project_team_member(uuid, uuid, uuid[], timestamptz) to authenticated;

-- J. Derived project table row view.
create or replace view public.project_table_rows
with (security_invoker = true)
as
with
  perm as (
    select public.has_permission(
      (select private.get_current_user_id()),
      'projects.view_financials',
      'all'
    ) as can_view_financials
  )
select
  p.id,
  p.company_id,
  p.title,
  p.status,
  p.client_id,
  c.name as client_name,
  c.email as client_email,
  c.phone_number as client_phone,
  p.address,
  p.trade,
  p.start_date,
  p.end_date,
  p.completed_at,
  p.duration,
  p.created_at,
  p.updated_at,
  p.notes,
  p.team_member_ids,

  (select count(*) from public.project_tasks t
     where t.project_id = p.id
       and t.status in ('active', 'completed')
       and t.deleted_at is null) as task_count,

  (select count(*) from public.project_tasks t
     where t.project_id = p.id
       and t.status = 'completed'
       and t.deleted_at is null) as task_completed_count,

  case
    when (select count(*) from public.project_tasks t
            where t.project_id = p.id
              and t.status in ('active', 'completed')
              and t.deleted_at is null) = 0 then 0
    else (
      (select count(*)::numeric from public.project_tasks t
         where t.project_id = p.id
           and t.status = 'completed'
           and t.deleted_at is null)
      /
      (select count(*) from public.project_tasks t
         where t.project_id = p.id
           and t.status in ('active', 'completed')
           and t.deleted_at is null)
    )
  end as progress,

  (select coalesce(t.custom_title, tt.display, 'Task')
     from public.project_tasks t
     left join public.task_types tt on tt.id = t.task_type_id
     where t.project_id = p.id
       and t.status = 'active'
       and t.deleted_at is null
     order by t.start_date asc nulls last, t.display_order asc nulls last, t.id asc
     limit 1) as next_task,

  extract(day from (now() -
    coalesce(
      (select max(pn.created_at) from public.project_notes pn
         where pn.project_id = p.id::text and pn.event_kind = 'status_change'),
      p.created_at
    )
  ))::int as days_in_status,

  case when perm.can_view_financials then
    (select coalesce(sum(e.total), 0) from public.estimates e
       where e.project_id = p.id::text
         and e.status in ('approved', 'converted')
         and e.deleted_at is null)
  else null end as estimate_total,

  case when perm.can_view_financials then
    (select coalesce(sum(i.total), 0) from public.invoices i
       where i.project_id = p.id and i.deleted_at is null)
  else null end as invoice_total,

  case when perm.can_view_financials then
    (select coalesce(sum(i.amount_paid), 0) from public.invoices i
       where i.project_id = p.id and i.deleted_at is null)
  else null end as paid_total,

  case when perm.can_view_financials then
    greatest(
      coalesce((select sum(e.total) from public.estimates e
                  where e.project_id = p.id::text
                    and e.status in ('approved', 'converted')
                    and e.deleted_at is null), 0),
      coalesce((select sum(i.total) from public.invoices i
                  where i.project_id = p.id and i.deleted_at is null), 0)
    )
  else null end as value,

  case when perm.can_view_financials then
    (select coalesce(sum(coalesce(epa.amount, e.amount * epa.percentage / 100.0)), 0)
       from public.expense_project_allocations epa
       join public.expenses e on e.id = epa.expense_id
       where epa.project_id = p.id::text
         and e.status = 'approved'
         and e.deleted_at is null)
  else null end as project_cost,

  case when perm.can_view_financials then
    case
      when (select coalesce(sum(i.total), 0) from public.invoices i
              where i.project_id = p.id and i.deleted_at is null) = 0 then null
      else (
        (select coalesce(sum(i.total), 0) from public.invoices i
           where i.project_id = p.id and i.deleted_at is null)
        -
        (select coalesce(sum(coalesce(epa.amount, e.amount * epa.percentage / 100.0)), 0)
           from public.expense_project_allocations epa
           join public.expenses e on e.id = epa.expense_id
           where epa.project_id = p.id::text
             and e.status = 'approved'
             and e.deleted_at is null)
      ) / nullif(
        (select sum(i.total) from public.invoices i
           where i.project_id = p.id and i.deleted_at is null), 0
      )
    end
  else null end as margin,

  (select count(*) from public.project_photos pp
     where pp.project_id = p.id::text and pp.deleted_at is null) as photo_count

from public.projects p
left join public.clients c on c.id = p.client_id
cross join perm
where p.deleted_at is null;

revoke all on table public.project_table_rows from anon;
grant select on table public.project_table_rows to authenticated;

-- K. Existing-company default project views.
with company_rows as (
  select id from public.companies where deleted_at is null
), default_views as (
  select
    id as company_id,
    'company'::text as owner_type,
    id as owner_id,
    'My Active Work'::text as name,
    'user-check'::text as icon,
    null::text as permission_key,
    0 as sort_position,
    '[{"id":"name"},{"id":"status"},{"id":"client"},{"id":"end_date"},{"id":"next_task"},{"id":"progress"}]'::jsonb as columns,
    '{"type":"dynamic","key":"current_user_assigned","and":[{"field":"status","op":"not_in","value":["closed","archived"]}]}'::jsonb as filters,
    '[{"field":"end_date","direction":"asc"}]'::jsonb as sort
  from company_rows
  union all
  select
    id, 'company', id, 'All Active', 'table', null, 1,
    '[{"id":"name"},{"id":"status"},{"id":"client"},{"id":"team"},{"id":"start_date"},{"id":"end_date"},{"id":"progress"}]'::jsonb,
    '{"field":"status","op":"not_in","value":["closed","archived"]}'::jsonb,
    '[{"field":"updated_at","direction":"desc"}]'::jsonb
  from company_rows
  union all
  select
    id, 'company', id, 'Financial Overview', 'trending-up', 'projects.view_financials', 2,
    '[{"id":"name"},{"id":"status"},{"id":"value"},{"id":"project_cost"},{"id":"margin"},{"id":"invoice_total"},{"id":"paid_total"}]'::jsonb,
    '{"field":"status","op":"in","value":["accepted","in_progress","completed"]}'::jsonb,
    '[{"field":"value","direction":"desc"}]'::jsonb
  from company_rows
)
insert into public.project_views (
  company_id,
  owner_type,
  owner_id,
  name,
  icon,
  permission_key,
  is_default,
  sort_position,
  columns,
  filters,
  sort,
  density,
  zoom_level,
  created_by
)
select
  company_id,
  owner_type,
  owner_id,
  name,
  icon,
  permission_key,
  true,
  sort_position,
  columns,
  filters,
  sort,
  'comfortable',
  1.00,
  null
from default_views
on conflict (company_id, owner_type, owner_id, lower(name)) where is_archived = false
do nothing;

-- L. New-company default project views.
create or replace function private.seed_default_project_views_for_company()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
begin
  if new.deleted_at is not null then
    return new;
  end if;

  insert into public.project_views (
    company_id,
    owner_type,
    owner_id,
    name,
    icon,
    permission_key,
    is_default,
    sort_position,
    columns,
    filters,
    sort,
    density,
    zoom_level,
    created_by
  )
  values
    (
      new.id,
      'company',
      new.id,
      'My Active Work',
      'user-check',
      null,
      true,
      0,
      '[{"id":"name"},{"id":"status"},{"id":"client"},{"id":"end_date"},{"id":"next_task"},{"id":"progress"}]'::jsonb,
      '{"type":"dynamic","key":"current_user_assigned","and":[{"field":"status","op":"not_in","value":["closed","archived"]}]}'::jsonb,
      '[{"field":"end_date","direction":"asc"}]'::jsonb,
      'comfortable',
      1.00,
      null
    ),
    (
      new.id,
      'company',
      new.id,
      'All Active',
      'table',
      null,
      true,
      1,
      '[{"id":"name"},{"id":"status"},{"id":"client"},{"id":"team"},{"id":"start_date"},{"id":"end_date"},{"id":"progress"}]'::jsonb,
      '{"field":"status","op":"not_in","value":["closed","archived"]}'::jsonb,
      '[{"field":"updated_at","direction":"desc"}]'::jsonb,
      'comfortable',
      1.00,
      null
    ),
    (
      new.id,
      'company',
      new.id,
      'Financial Overview',
      'trending-up',
      'projects.view_financials',
      true,
      2,
      '[{"id":"name"},{"id":"status"},{"id":"value"},{"id":"project_cost"},{"id":"margin"},{"id":"invoice_total"},{"id":"paid_total"}]'::jsonb,
      '{"field":"status","op":"in","value":["accepted","in_progress","completed"]}'::jsonb,
      '[{"field":"value","direction":"desc"}]'::jsonb,
      'comfortable',
      1.00,
      null
    )
  on conflict (company_id, owner_type, owner_id, lower(name)) where is_archived = false
  do nothing;

  return new;
end;
$$;

drop trigger if exists companies_seed_default_project_views on public.companies;
create trigger companies_seed_default_project_views
  after insert on public.companies
  for each row execute function private.seed_default_project_views_for_company();

commit;
