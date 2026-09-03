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

truncate private.test_authority_permissions;
insert into private.test_authority_permissions(permission)
values
  ('accounting.manage_connections'),
  ('accounting.view'),
  ('agent.review'),
  ('calendar.create'),
  ('calendar.delete'),
  ('calendar.edit'),
  ('calendar.view'),
  ('catalog.import'),
  ('catalog.manage'),
  ('catalog.orders.manage'),
  ('catalog.orders.view'),
  ('catalog.products.manage'),
  ('catalog.products.view'),
  ('catalog.run_setup'),
  ('catalog.stock.adjust'),
  ('catalog.view'),
  ('clients.create'),
  ('clients.delete'),
  ('clients.edit'),
  ('clients.view'),
  ('deck_builder.create'),
  ('deck_builder.edit'),
  ('deck_builder.view'),
  ('documents.manage_templates'),
  ('documents.view'),
  ('email.configure_ai'),
  ('email.connect'),
  ('email.manage'),
  ('email.view'),
  ('estimates.convert'),
  ('estimates.create'),
  ('estimates.delete'),
  ('estimates.edit'),
  ('estimates.send'),
  ('estimates.view'),
  ('expenses.approve'),
  ('expenses.configure'),
  ('expenses.create'),
  ('expenses.delete'),
  ('expenses.edit'),
  ('expenses.view'),
  ('finances.view'),
  ('inbox.archive'),
  ('inbox.categorize'),
  ('inbox.configure_phase_c'),
  ('inbox.send'),
  ('inbox.snooze'),
  ('inbox.view'),
  ('inbox.view_company'),
  ('inventory.manage'),
  ('invoices.create'),
  ('invoices.delete'),
  ('invoices.edit'),
  ('invoices.record_payment'),
  ('invoices.send'),
  ('invoices.view'),
  ('invoices.void'),
  ('job_board.manage_sections'),
  ('job_board.view'),
  ('map.view'),
  ('map.view_crew_locations'),
  ('notifications.manage_preferences'),
  ('notifications.view'),
  ('photos.annotate'),
  ('photos.delete'),
  ('photos.upload'),
  ('photos.view'),
  ('pipeline.assign'),
  ('pipeline.configure_stages'),
  ('pipeline.convert'),
  ('pipeline.create'),
  ('pipeline.edit'),
  ('pipeline.manage'),
  ('pipeline.manage_views'),
  ('pipeline.view'),
  ('portal.manage_branding'),
  ('portal.view'),
  ('products.manage'),
  ('products.view'),
  ('profile.edit'),
  ('projects.archive'),
  ('projects.assign_team'),
  ('projects.create'),
  ('projects.delete'),
  ('projects.edit'),
  ('projects.manage_views'),
  ('projects.view'),
  ('projects.view_financials'),
  ('reports.view'),
  ('settings.billing'),
  ('settings.company'),
  ('settings.integrations'),
  ('settings.preferences'),
  ('tasks.assign'),
  ('tasks.change_status'),
  ('tasks.create'),
  ('tasks.delete'),
  ('tasks.edit'),
  ('tasks.view'),
  ('team.assign_roles'),
  ('team.manage'),
  ('team.view'),
  ('time_off.approve');

create or replace function private.resolve_agent_actor_authority(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permissions text[]
) returns table(permission_snapshot_revision text, effective_permissions jsonb)
language sql stable
as $function$
  with registry as materialized (
    select array_agg(permission order by permission collate "C") as permissions
    from (
      select distinct permission
      from pg_catalog.unnest(p_permissions) permission
    ) canonical
  ), effective as materialized (
    select permission
    from pg_catalog.unnest(p_permissions) permission
    join private.test_authority_permissions allowed using (permission)
  )
  select
    'sha256:' || pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(pg_catalog.to_jsonb(registry.permissions)::text,
                            'UTF8'),
      'sha256'
    ), 'hex'),
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'permission', effective.permission, 'scope', 'all'
          ) order by effective.permission
        )
        from effective
      ),
      '[]'::jsonb
    )
  from registry
  where p_actor_user_id = '11111111-1111-4111-8111-111111111111'::uuid
    and p_company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
$function$;

update public.users
set company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    is_active = true,
    updated_at = statement_timestamp()
where id = '11111111-1111-4111-8111-111111111111';
