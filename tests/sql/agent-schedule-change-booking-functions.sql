set check_function_bodies=off;
CREATE OR REPLACE FUNCTION public.has_permission(p_user_id uuid, p_permission text, p_required_scope text DEFAULT 'all'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_company_id uuid;
  v_scope text;
begin
  if p_user_id is null or p_permission is null then
    return false;
  end if;

  select actor.company_id
  into v_company_id
  from public.users actor
  join public.companies company
    on company.id = actor.company_id
   and company.deleted_at is null
  where actor.id = p_user_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false);

  if not found then
    return false;
  end if;

  if private.user_is_company_admin(p_user_id, v_company_id) then
    return true;
  end if;

  v_scope := private.raw_permission_scope_for_user(
    p_user_id,
    v_company_id,
    p_permission
  );

  if v_scope = 'all' then
    return true;
  end if;
  if v_scope = 'assigned' then
    return p_required_scope in ('assigned', 'own');
  end if;
  if v_scope = 'own' then
    return p_required_scope = 'own';
  end if;
  return false;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.current_user_can_edit_site_visit(p_company_id text, p_opportunity_id uuid, p_project_id text, p_project_ref uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_project_id uuid := coalesce(p_project_ref, private.try_parse_uuid(p_project_id));
begin
  if private.try_parse_uuid(p_company_id) is distinct from private.get_user_company_id() then
    return false;
  end if;
  if p_opportunity_id is not null
    and (p_project_id is not null or p_project_ref is not null)
    and (
      v_project_id is null
      or (
        p_project_id is not null
        and p_project_ref is not null
        and private.try_parse_uuid(p_project_id) is distinct from p_project_ref
      )
      or not private.opportunity_project_relationship_is_valid(
        private.try_parse_uuid(p_company_id),
        p_opportunity_id,
        v_project_id
      )
    )
  then
    return false;
  end if;
  if p_opportunity_id is null and v_project_id is null then
    return true;
  end if;
  return (p_opportunity_id is not null and private.user_can_edit_opportunity(
      v_actor_user_id, p_opportunity_id
    ))
    or (v_project_id is not null
      and private.user_can_view_project(v_actor_user_id, v_project_id)
      and private.user_can_edit_project(v_actor_user_id, v_project_id));
end;
$function$
;
CREATE OR REPLACE FUNCTION private.effective_pipeline_scope_for_user(p_actor_user_id uuid, p_actor_company_id uuid, p_permission text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_raw_scope text;
  v_prerequisite_scope text;
begin
  if p_permission is null or p_permission not in (
    'pipeline.create',
    'pipeline.view',
    'pipeline.edit',
    'pipeline.assign',
    'pipeline.convert'
  ) then
    return null;
  end if;

  if not exists (
    select 1
      from public.users u
     where u.id = p_actor_user_id
       and u.company_id = p_actor_company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
  ) then
    return null;
  end if;

  if public.has_permission(p_actor_user_id, p_permission, 'all') then
    v_raw_scope := 'all';
  elsif public.has_permission(p_actor_user_id, p_permission, 'assigned') then
    v_raw_scope := 'assigned';
  elsif private.should_use_pipeline_manage_compat(
    p_actor_user_id,
    p_actor_company_id,
    p_permission
  ) then
    v_raw_scope := 'all';
  else
    return null;
  end if;

  -- `own` and every unknown scope are invalid for these capabilities.
  if v_raw_scope not in ('all', 'assigned') then
    return null;
  end if;

  case p_permission
    when 'pipeline.create' then
      if v_raw_scope is distinct from 'all' then
        return null;
      end if;
      v_prerequisite_scope := private.effective_pipeline_scope_for_user(
        p_actor_user_id,
        p_actor_company_id,
        'pipeline.view'
      );
      if v_prerequisite_scope not in ('all', 'assigned') then
        return null;
      end if;
      return 'all';

    when 'pipeline.view' then
      return v_raw_scope;

    when 'pipeline.edit' then
      v_prerequisite_scope := private.effective_pipeline_scope_for_user(
        p_actor_user_id,
        p_actor_company_id,
        'pipeline.view'
      );
      return private.least_permissive_pipeline_scope(
        v_raw_scope,
        v_prerequisite_scope
      );

    when 'pipeline.assign' then
      v_prerequisite_scope := private.effective_pipeline_scope_for_user(
        p_actor_user_id,
        p_actor_company_id,
        'pipeline.edit'
      );
      return private.least_permissive_pipeline_scope(
        v_raw_scope,
        v_prerequisite_scope
      );

    when 'pipeline.convert' then
      v_prerequisite_scope := private.effective_pipeline_scope_for_user(
        p_actor_user_id,
        p_actor_company_id,
        'pipeline.edit'
      );
      return private.least_permissive_pipeline_scope(
        v_raw_scope,
        v_prerequisite_scope
      );
  end case;

  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.get_current_user_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT id FROM public.users
  WHERE (auth_id = (auth.jwt() ->> 'sub') OR firebase_uid = (auth.jwt() ->> 'sub'))
    AND deleted_at IS NULL
  LIMIT 1
$function$
;
CREATE OR REPLACE FUNCTION private.get_user_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT company_id FROM public.users
  WHERE (auth_id = (auth.jwt() ->> 'sub') OR firebase_uid = (auth.jwt() ->> 'sub'))
    AND company_id IS NOT NULL
    AND deleted_at IS NULL
  LIMIT 1
$function$
;
CREATE OR REPLACE FUNCTION private.least_permissive_pipeline_scope(p_left_scope text, p_right_scope text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select case
    when p_left_scope is null or p_right_scope is null then null
    when p_left_scope not in ('all', 'assigned') then null
    when p_right_scope not in ('all', 'assigned') then null
    when p_left_scope = 'assigned' or p_right_scope = 'assigned' then 'assigned'
    else 'all'
  end;
$function$
;
CREATE OR REPLACE FUNCTION private.opportunity_project_relationship_is_valid(p_company_id uuid, p_opportunity_id uuid, p_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
  select p_company_id is not null
    and p_opportunity_id is not null
    and p_project_id is not null
    and exists (
      select 1
        from public.opportunities o
        join public.projects p on p.id = p_project_id
       where o.id = p_opportunity_id
         and o.company_id = p_company_id
         and o.deleted_at is null
         and p.company_id = p_company_id
         and p.deleted_at is null
         and (
           o.project_ref = p.id
           or o.project_id = p.id
           or p.opportunity_ref = o.id
           or private.try_parse_uuid(p.opportunity_id) = o.id
         )
         and (o.project_ref is null or o.project_ref = p.id)
         and (o.project_id is null or o.project_id = p.id)
         and (p.opportunity_ref is null or p.opportunity_ref = o.id)
         and (
           nullif(btrim(p.opportunity_id), '') is null
           or private.try_parse_uuid(p.opportunity_id) = o.id
         )
    );
$function$
;
CREATE OR REPLACE FUNCTION private.raw_permission_scope_for_user(p_actor_user_id uuid, p_actor_company_id uuid, p_permission text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_override_granted boolean;
  v_override_scope text;
  v_scope text;
begin
  if p_actor_user_id is null
     or p_actor_company_id is null
     or nullif(btrim(p_permission), '') is null then
    return null;
  end if;

  if not exists (
    select 1
    from public.users actor
    join public.companies company
      on company.id = actor.company_id
     and company.deleted_at is null
    where actor.id = p_actor_user_id
      and actor.company_id = p_actor_company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
  ) then
    return null;
  end if;

  select override.granted, override.scope
  into v_override_granted, v_override_scope
  from public.user_permission_overrides override
  where override.user_id = p_actor_user_id
    and override.company_id = p_actor_company_id
    and override.permission = p_permission
  limit 1;

  if found then
    if not v_override_granted then
      return null;
    end if;
    if v_override_scope is not null then
      if v_override_scope in ('all', 'assigned', 'own') then
        return v_override_scope;
      end if;
      return null;
    end if;
  end if;

  select permission.scope
  into v_scope
  from public.user_roles assignment
  join public.roles role
    on role.id = assignment.role_id
   and (role.is_preset or role.company_id = p_actor_company_id)
  join public.role_permissions permission
    on permission.role_id = assignment.role_id
   and permission.permission = p_permission
   and permission.scope in ('all', 'assigned', 'own')
  where assignment.user_id = p_actor_user_id::text
  order by case permission.scope
    when 'all' then 1
    when 'assigned' then 2
    when 'own' then 3
    else 4
  end
  limit 1;

  return v_scope;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.should_use_pipeline_manage_compat(p_actor_user_id uuid, p_actor_company_id uuid, p_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  select p_actor_user_id is not null
    and p_actor_company_id is not null
    and p_permission is not null
    and not exists (
      select 1
        from public.user_permission_overrides upo
       where upo.user_id = p_actor_user_id
         and upo.company_id = p_actor_company_id
         and upo.permission = p_permission
    )
    and not exists (
      select 1
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id = ur.role_id
       where ur.user_id = p_actor_user_id::text
         and rp.permission = p_permission
    )
    and public.has_permission(
      p_actor_user_id,
      'pipeline.manage',
      'all'
    );
$function$
;
CREATE OR REPLACE FUNCTION private.try_parse_uuid(p_value text)
 RETURNS uuid
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
  if p_value is null then
    return null;
  end if;

  if btrim(p_value) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return btrim(p_value)::uuid;
  end if;

  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.user_can_edit_opportunity(p_actor_user_id uuid, p_opportunity_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_opportunity record;
  v_scope text;
begin
  select o.company_id, o.assigned_to
    into v_opportunity
    from public.opportunities o
   where o.id = p_opportunity_id
     and o.deleted_at is null;

  if not found then
    return false;
  end if;

  v_scope := private.effective_pipeline_scope_for_user(
    p_actor_user_id,
    v_opportunity.company_id,
    'pipeline.edit'
  );

  if v_scope = 'all' then
    return true;
  end if;
  if v_scope = 'assigned'
    and v_opportunity.assigned_to = p_actor_user_id
  then
    return true;
  end if;
  return false;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.user_can_edit_project(p_actor_user_id uuid, p_project_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_project record;
begin
  select p.company_id
    into v_project
    from public.projects p
   where p.id = p_project_id
     and p.deleted_at is null;

  if not found or not exists (
    select 1
      from public.users u
     where u.id = p_actor_user_id
       and u.company_id = v_project.company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
  ) then
    return false;
  end if;

  if public.has_permission(p_actor_user_id, 'projects.edit', 'all') then
    return true;
  end if;

  if not public.has_permission(
    p_actor_user_id,
    'projects.edit',
    'assigned'
  ) then
    return false;
  end if;

  return exists (
    select 1
      from public.project_tasks pt
     where pt.project_id = p_project_id
       and pt.deleted_at is null
       and p_actor_user_id::text = any(
         coalesce(pt.team_member_ids, array[]::text[])
       )
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION private.user_can_view_project(p_actor_user_id uuid, p_project_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_project record;
begin
  select p.company_id
    into v_project
    from public.projects p
   where p.id = p_project_id
     and p.deleted_at is null;

  if not found or not exists (
    select 1
      from public.users u
     where u.id = p_actor_user_id
       and u.company_id = v_project.company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
  ) then
    return false;
  end if;

  if public.has_permission(p_actor_user_id, 'projects.view', 'all') then
    return true;
  end if;

  if not public.has_permission(
    p_actor_user_id,
    'projects.view',
    'assigned'
  ) then
    return false;
  end if;

  return exists (
    select 1
      from public.project_tasks pt
     where pt.project_id = p_project_id
       and pt.deleted_at is null
       and p_actor_user_id::text = any(
         coalesce(pt.team_member_ids, array[]::text[])
       )
  ) or exists (
    select 1
      from public.project_notes pn
     where pn.project_id = p_project_id::text
       and pn.deleted_at is null
       and p_actor_user_id::text = any(
         coalesce(pn.mentioned_user_ids, array[]::text[])
       )
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION private.user_is_company_admin(p_actor_user_id uuid, p_actor_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.users actor
    join public.companies company
      on company.id = actor.company_id
     and company.deleted_at is null
    where actor.id = p_actor_user_id
      and actor.company_id = p_actor_company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
      and (
        coalesce(actor.is_company_admin, false)
        or actor.id::text = company.account_holder_id
        or actor.id::text = any(
          coalesce(company.admin_ids, array[]::text[])
        )
      )
  );
$function$
;
CREATE OR REPLACE FUNCTION public.reschedule_site_visit(p_site_visit_id uuid, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_duration_minutes integer DEFAULT NULL::integer, p_assignee_ids text[] DEFAULT NULL::text[], p_reminder_lead_minutes integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_actor_user_id uuid;
  v_company_id uuid;
  v_visit public.site_visits%rowtype;
  v_new_scheduled timestamptz;
  v_new_duration int;
  v_new_reminder int;
  v_raw_assignees text[];
  v_new_assignees text[];
  v_current_sorted text[];
  v_member_count int;
  v_changed boolean;
begin
  if p_site_visit_id is null then
    raise exception 'site_visit_id_required' using errcode = '22004';
  end if;

  v_actor_user_id := private.get_current_user_id();
  v_company_id := private.get_user_company_id();
  if v_actor_user_id is null or v_company_id is null then
    raise exception 'site_visit_actor_not_found' using errcode = '42501';
  end if;

  select * into v_visit
    from public.site_visits
   where id = p_site_visit_id
   for update;
  if not found then
    raise exception 'site_visit_not_found' using errcode = 'P0002';
  end if;

  if not private.current_user_can_edit_site_visit(
    v_visit.company_id, v_visit.opportunity_id, v_visit.project_id, v_visit.project_ref
  ) then
    raise exception 'site_visit_edit_denied' using errcode = '42501';
  end if;
  if private.try_parse_uuid(v_visit.company_id) is distinct from v_company_id then
    raise exception 'site_visit_company_mismatch' using errcode = '42501';
  end if;
  if v_visit.deleted_at is not null then
    raise exception 'cannot_reschedule_deleted_site_visit' using errcode = '55000';
  end if;
  if v_visit.booked_at is null then
    raise exception 'site_visit_not_a_booking' using errcode = '55000';
  end if;
  if v_visit.status::text <> 'scheduled' then
    raise exception 'site_visit_not_reschedulable' using errcode = '55000';
  end if;

  -- NULL / same time = keep, and the past-time rule only judges a real move.
  if p_scheduled_at is null or p_scheduled_at = v_visit.scheduled_at then
    v_new_scheduled := v_visit.scheduled_at;
  else
    if p_scheduled_at <= now() - interval '5 minutes' then
      raise exception 'site_visit_time_in_past' using errcode = '22023';
    end if;
    v_new_scheduled := p_scheduled_at;
  end if;

  v_new_duration := coalesce(p_duration_minutes, v_visit.duration_minutes);
  if v_new_duration < 15 or v_new_duration > 480 then
    raise exception 'site_visit_duration_out_of_range' using errcode = '22023';
  end if;

  -- Reminder override semantics: NULL = keep, -1 = clear back to the user default,
  -- 0..1440 = set. Documented for iOS/web/MCP callers.
  if p_reminder_lead_minutes is null then
    v_new_reminder := v_visit.reminder_lead_minutes;
  elsif p_reminder_lead_minutes = -1 then
    v_new_reminder := null;
  elsif p_reminder_lead_minutes between 0 and 1440 then
    v_new_reminder := p_reminder_lead_minutes;
  else
    raise exception 'site_visit_reminder_out_of_range' using errcode = '22023';
  end if;

  if p_assignee_ids is null or p_assignee_ids = '{}'::text[] then
    v_new_assignees := v_visit.assignee_ids;
  else
    v_raw_assignees := p_assignee_ids;
    if exists (
      select 1 from unnest(v_raw_assignees) a
       where a is null or private.try_parse_uuid(a) is null
    ) then
      raise exception 'site_visit_assignees_invalid' using errcode = '22023';
    end if;
    select array_agg(distinct a order by a) into v_new_assignees from unnest(v_raw_assignees) a;
    select count(*) into v_member_count
      from public.users u
     where u.id::text = any(v_new_assignees)
       and u.company_id = v_company_id
       and u.deleted_at is null;
    if v_member_count <> array_length(v_new_assignees, 1) then
      raise exception 'site_visit_assignees_invalid' using errcode = '22023';
    end if;
  end if;

  select array_agg(x order by x) into v_current_sorted from unnest(coalesce(v_visit.assignee_ids, '{}'::text[])) x;
  v_changed := v_visit.scheduled_at is distinct from v_new_scheduled
    or v_visit.duration_minutes is distinct from v_new_duration
    or v_current_sorted is distinct from (select array_agg(x order by x) from unnest(coalesce(v_new_assignees, '{}'::text[])) x)
    or v_visit.reminder_lead_minutes is distinct from v_new_reminder;
  if not v_changed then
    return p_site_visit_id;
  end if;

  update public.site_visits
     set scheduled_at = v_new_scheduled,
         duration_minutes = v_new_duration,
         assignee_ids = v_new_assignees,
         reminder_lead_minutes = v_new_reminder
   where id = p_site_visit_id;

  insert into public.activities (
    company_id, opportunity_id, client_id, type, subject, content,
    duration_minutes, created_by, attachments, is_read, site_visit_id
  ) values (
    v_company_id,
    v_visit.opportunity_id,
    coalesce(v_visit.client_ref, private.try_parse_uuid(v_visit.client_id)),
    'site_visit_scheduled', 'Site visit rescheduled',
    to_char(v_new_scheduled at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    v_new_duration, v_actor_user_id, '{}'::text[], true, p_site_visit_id
  );

  return p_site_visit_id;
end;
$function$
;
set check_function_bodies=on;
