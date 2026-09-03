\set ON_ERROR_STOP on

-- Extends the Phase 8 disposable proof schema with only the production fields
-- read by the Phase 9 weather-reschedule snapshot.

alter table public.companies
  add column schedule_settings jsonb not null default '{}'::jsonb;

alter table public.users
  add column company_id uuid references public.companies(id),
  add column is_active boolean,
  add column deleted_at timestamptz,
  add column updated_at timestamptz;

alter table public.sub_clients
  add column updated_at timestamptz;

alter table public.task_types
  add column dependencies jsonb;

alter table public.projects
  add column status_version bigint not null default 0,
  add column primary_sub_client_id uuid references public.sub_clients(id);

create table public.project_tasks (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  task_type_id uuid references public.task_types(id),
  custom_title text,
  task_notes text,
  status text not null default 'active',
  start_date timestamptz,
  end_date timestamptz,
  start_time time,
  end_time time,
  all_day boolean not null default false,
  team_member_ids text[],
  dependency_overrides jsonb,
  recurrence_id uuid,
  paired_from_task_id uuid references public.project_tasks(id),
  schedule_locked boolean not null default false,
  schedule_version bigint not null default 0,
  deleted_at timestamptz,
  updated_at timestamptz
);

create table public.weather_forecasts (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  company_id uuid not null references public.companies(id),
  forecast_date date not null,
  precipitation_mm numeric(5,2),
  precipitation_probability smallint,
  wind_speed_kmh numeric(5,1),
  conditions text,
  retrieved_at timestamptz not null,
  source text not null default 'open-meteo',
  unique(project_id, forecast_date)
);

create table public.email_suppressions (
  id uuid primary key default extensions.gen_random_uuid(),
  email text not null,
  list text not null default 'global',
  reason text not null,
  source text not null,
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz
);

create function private.agent_user_can_access_entity(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_entity_kind text,
  p_entity_id uuid,
  p_action text
) returns boolean
language sql stable
as $function$
  select p_actor_user_id = '11111111-1111-4111-8111-111111111111'::uuid
    and p_actor_company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
    and p_entity_kind in ('project', 'task', 'client', 'sub_client')
    and p_entity_id is not null
    and p_action in ('view', 'edit')
$function$;

insert into private.test_authority_permissions(permission)
values
  ('calendar.edit'), ('inbox.send'), ('inbox.view'),
  ('projects.edit'), ('tasks.edit')
on conflict (permission) do nothing;

update public.users
set company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    is_active = true,
    updated_at = statement_timestamp()
where id = '11111111-1111-4111-8111-111111111111';
