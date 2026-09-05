-- Exact prerequisite definitions read from production on 2026-09-04. No business rows.
-- Kept inline so the disposable runtime fixture has no artifact-directory dependency.

-- runtime-prerequisite-functions.sql
CREATE OR REPLACE FUNCTION private.queue_email_assignment_contact_form_draft_from_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.new_assignee_id is not null then
    perform private.enqueue_email_assignment_contact_form_draft(new.id, null);
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.user_is_active_company_member(p_actor_user_id uuid, p_actor_company_id uuid)
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
  );
$function$
;
CREATE OR REPLACE FUNCTION private.effective_permission_scope_for_user(p_actor_user_id uuid, p_actor_company_id uuid, p_permission text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
begin
  if p_permission in (
    'pipeline.create',
    'pipeline.view',
    'pipeline.edit',
    'pipeline.assign',
    'pipeline.convert'
  ) then
    return private.effective_pipeline_scope_for_user(
      p_actor_user_id,
      p_actor_company_id,
      p_permission
    );
  end if;

  if p_permission in ('inbox.view', 'inbox.send') then
    return private.effective_inbox_scope_for_user(
      p_actor_user_id,
      p_actor_company_id,
      p_permission
    );
  end if;

  return private.raw_permission_scope_for_user(
    p_actor_user_id,
    p_actor_company_id,
    p_permission
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION private.user_assignment_snapshot(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  select case
    when p_user_id is null then null
    else (
      select jsonb_build_object(
        'id', u.id,
        'first_name', u.first_name,
        'last_name', u.last_name,
        'email', u.email,
        'profile_image_url', u.profile_image_url,
        'user_color', u.user_color,
        'role', u.role,
        'is_active', coalesce(u.is_active, false)
      )
      from public.users u
      where u.id = p_user_id
    )
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
CREATE OR REPLACE FUNCTION private.guard_opportunity_assignment_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_token_consumed boolean;
begin
  if tg_op = 'INSERT' then
    if new.assigned_to is null and new.assignment_version = 0 then
      return new;
    end if;

    if new.assigned_to is null or new.assignment_version <> 1 then
      raise exception 'assignment_write_forbidden'
        using errcode = '42501';
    end if;

    delete from private.opportunity_assignment_write_tokens t
     where t.transaction_id = txid_current()
       and t.backend_pid = pg_backend_pid()
       and t.opportunity_id = new.id
       and t.operation = 'insert'
       and t.assigned_to is not distinct from new.assigned_to
       and t.assignment_version = new.assignment_version
    returning true into v_token_consumed;

    if not found or not coalesce(v_token_consumed, false) then
      raise exception 'assignment_write_forbidden'
        using errcode = '42501';
    end if;

    return new;
  end if;

  if new.assigned_to is not distinct from old.assigned_to then
    if new.assignment_version is distinct from old.assignment_version then
      raise exception 'assignment_write_forbidden'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.assignment_version <> old.assignment_version + 1 then
    raise exception 'assignment_write_forbidden'
      using errcode = '42501';
  end if;

  delete from private.opportunity_assignment_write_tokens t
   where t.transaction_id = txid_current()
     and t.backend_pid = pg_backend_pid()
     and t.opportunity_id = new.id
     and t.operation = 'update'
     and t.assigned_to is not distinct from new.assigned_to
     and t.assignment_version = new.assignment_version
  returning true into v_token_consumed;

  if not found or not coalesce(v_token_consumed, false) then
    raise exception 'assignment_write_forbidden'
      using errcode = '42501';
  end if;

  return new;
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
CREATE OR REPLACE FUNCTION private.user_can_view_client(p_actor_user_id uuid, p_client_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_company_id uuid;
begin
  select c.company_id
    into v_company_id
    from public.clients c
   where c.id = p_client_id
     and c.deleted_at is null;
  if not found or not exists (
    select 1
      from public.users u
     where u.id = p_actor_user_id
       and u.company_id = v_company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
  ) then
    return false;
  end if;
  if exists (
    select 1 from public.users u
     where u.id = p_actor_user_id and coalesce(u.is_company_admin, false)
  ) or public.has_permission(p_actor_user_id, 'clients.view', 'all') then
    return true;
  end if;
  if not public.has_permission(p_actor_user_id, 'clients.view', 'assigned') then
    return false;
  end if;
  return exists (
    select 1
      from public.projects p
     where p.client_id = p_client_id
       and p.company_id = v_company_id
       and p.deleted_at is null
       and private.user_can_view_project(p_actor_user_id, p.id)
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION private.user_can_edit_client(p_actor_user_id uuid, p_client_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_company_id uuid;
begin
  select c.company_id
    into v_company_id
    from public.clients c
   where c.id = p_client_id
     and c.deleted_at is null;
  if not found or not exists (
    select 1
      from public.users u
     where u.id = p_actor_user_id
       and u.company_id = v_company_id
       and u.deleted_at is null
       and coalesce(u.is_active, false)
  ) then
    return false;
  end if;
  return private.user_can_view_client(p_actor_user_id, p_client_id)
    and public.has_permission(p_actor_user_id, 'clients.edit', 'all');
end;
$function$
;
CREATE OR REPLACE FUNCTION private.queue_email_assignment_contact_form_draft_from_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_assignment_event_id uuid;
begin
  if tg_op = 'UPDATE' then
    if old.opportunity_id is not null
       or new.opportunity_id is null
       or new.company_id is distinct from old.company_id
       or new.type is distinct from old.type
       or new.direction is distinct from old.direction
       or new.email_connection_id is distinct from old.email_connection_id
       or new.email_message_id is distinct from old.email_message_id
       or new.email_thread_id is distinct from old.email_thread_id
       or new.from_email is distinct from old.from_email
       or new.body_text is distinct from old.body_text then
      return new;
    end if;
  end if;

  if new.type is distinct from 'email'
     or new.direction is distinct from 'inbound'
     or new.opportunity_id is null
     or new.email_connection_id is null
     or nullif(btrim(coalesce(new.email_message_id, '')), '') is null
     or nullif(btrim(coalesce(new.email_thread_id, '')), '') is null
     or nullif(btrim(coalesce(new.from_email, '')), '') is null
     or nullif(btrim(coalesce(new.body_text, '')), '') is null
     or coalesce(new.match_needs_review, false) then
    return new;
  end if;

  select assignment_event.id into v_assignment_event_id
  from public.opportunities opportunity
  join public.opportunity_assignment_events assignment_event
    on assignment_event.opportunity_id = opportunity.id
   and assignment_event.company_id = opportunity.company_id
   and assignment_event.assignment_version = opportunity.assignment_version
   and assignment_event.new_assignee_id = opportunity.assigned_to
  where opportunity.id = new.opportunity_id
    and opportunity.company_id = new.company_id
    and opportunity.assigned_to is not null
    and opportunity.deleted_at is null
    and opportunity.archived_at is null;

  if v_assignment_event_id is not null then
    perform private.enqueue_email_assignment_contact_form_draft(
      v_assignment_event_id,
      new.id
    );
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.user_can_view_client(p_actor_user_id uuid, p_actor_company_id uuid, p_client_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_scope text;
begin
  if not private.user_is_active_company_member(
    p_actor_user_id,
    p_actor_company_id
  ) or not exists (
    select 1
    from public.clients client
    where client.id = p_client_id
      and client.company_id = p_actor_company_id
      and client.deleted_at is null
  ) then
    return false;
  end if;

  if private.user_is_company_admin(
    p_actor_user_id,
    p_actor_company_id
  ) then
    return true;
  end if;

  v_scope := private.effective_permission_scope_for_user(
    p_actor_user_id,
    p_actor_company_id,
    'clients.view'
  );
  if v_scope = 'all' then
    return true;
  end if;
  if v_scope is distinct from 'assigned' then
    return false;
  end if;

  -- Deliberately team-assignment-only. A project note mention grants the
  -- project/task read surface, not the customer's full contact record.
  return exists (
    select 1
    from public.projects project
    join public.project_tasks task
      on task.project_id = project.id
     and task.company_id = project.company_id
     and task.deleted_at is null
    where project.client_id = p_client_id
      and project.company_id = p_actor_company_id
      and project.deleted_at is null
      and p_actor_user_id::text = any(
        coalesce(task.team_member_ids, array[]::text[])
      )
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION private.user_can_edit_client(p_actor_user_id uuid, p_actor_company_id uuid, p_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
  select private.user_is_active_company_member(
    p_actor_user_id,
    p_actor_company_id
  )
  and exists (
    select 1
    from public.clients client
    where client.id = p_client_id
      and client.company_id = p_actor_company_id
      and client.deleted_at is null
  )
  and (
    private.user_is_company_admin(p_actor_user_id, p_actor_company_id)
    or private.effective_permission_scope_for_user(
      p_actor_user_id,
      p_actor_company_id,
      'clients.edit'
    ) = 'all'
  );
$function$
;
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
CREATE OR REPLACE FUNCTION private.lock_lead_assignment_company(p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
begin
  if p_company_id is null then
    raise exception 'lead_assignment_company_lock_required'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'lead-assignment-company:' || p_company_id::text,
      161000
    )
  );
end;
$function$
;
;

-- runtime-permission-functions.sql
CREATE OR REPLACE FUNCTION private.effective_inbox_scope_for_user(p_actor_user_id uuid, p_actor_company_id uuid, p_permission text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
begin
  if p_permission is null
    or p_permission not in ('inbox.view', 'inbox.send')
    or not exists (
      select 1
        from public.users u
       where u.id = p_actor_user_id
         and u.company_id = p_actor_company_id
         and u.deleted_at is null
         and coalesce(u.is_active, false)
    )
  then
    return null;
  end if;

  if public.has_permission(p_actor_user_id, p_permission, 'all') then
    return 'all';
  end if;
  if public.has_permission(p_actor_user_id, p_permission, 'assigned') then
    return 'assigned';
  end if;
  if p_permission = 'inbox.view'
    and public.has_permission(p_actor_user_id, p_permission, 'own')
  then
    return 'own';
  end if;
  if p_permission = 'inbox.view'
    and private.should_use_inbox_view_company_compat(
      p_actor_user_id,
      p_actor_company_id
    )
  then
    return 'all';
  end if;
  return null;
end;
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
;

-- runtime-prompt-functions.sql
CREATE OR REPLACE FUNCTION private.agent_prompt_text_is_safe(p_value text, p_allow_text_whitespace boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
  v_character text;
  v_code integer;
begin
  for v_character in
    select regexp_split_to_table(p_value, '')
  loop
    v_code := ascii(v_character);
    if (
      (v_code between 0 and 31 and not (
        p_allow_text_whitespace and v_code in (9, 10)
      ))
      or v_code between 127 and 159
      or v_code in (173, 847, 1564, 6158, 8203, 8206, 8207, 8288, 65279)
      or v_code between 8234 and 8238
      or v_code between 8289 and 8303
      or v_code between 65529 and 65531
      or v_code between 917504 and 917631
    ) then
      return false;
    end if;
  end loop;
  return true;
end;
$function$
;
;

-- resolve_agent_actor_authority.sql
CREATE OR REPLACE FUNCTION private.resolve_agent_actor_authority(p_actor_user_id uuid, p_company_id uuid, p_registered_permission_keys text[])
 RETURNS TABLE(actor_user_id uuid, company_id uuid, is_active boolean, is_admin boolean, role_ids uuid[], configured_permissions text[], effective_permissions jsonb, permission_snapshot_revision text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
AS $function$
declare
  v_registered_permission_keys text[] := array[]::text[];
  v_is_company_admin_flag boolean;
  v_is_account_holder boolean;
  v_is_admin_list_member boolean;
  v_is_admin boolean;
  v_role_ids uuid[] := array[]::uuid[];
  v_role_grants jsonb := '[]'::jsonb;
  v_override_facts jsonb := '[]'::jsonb;
  v_configured_permissions text[] := array[]::text[];
  v_effective_permissions jsonb := '[]'::jsonb;
  v_revision_input jsonb;
begin
  -- The registry is supplied only by the trusted repository from the
  -- server-owned AppPermission constant. Bounds and grammar keep this RPC from
  -- becoming an unbounded permission oracle if that boundary ever regresses.
  if p_registered_permission_keys is null
     or cardinality(p_registered_permission_keys) = 0
     or cardinality(p_registered_permission_keys) > 256 then
    raise exception 'invalid_agent_permission_registry'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_registered_permission_keys) registry(permission_key)
    where permission_key is null
       or permission_key is distinct from btrim(permission_key)
       or length(permission_key) > 128
       or permission_key !~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'
  ) then
    raise exception 'invalid_agent_permission_registry'
      using errcode = '22023';
  end if;

  select array_agg(distinct permission_key order by permission_key)
  into v_registered_permission_keys
  from unnest(p_registered_permission_keys) registry(permission_key);

  -- No row is returned for inactive, deleted, or wrong-company actors. This
  -- remains indistinguishable from a missing actor at every caller boundary.
  select coalesce(actor.is_company_admin, false),
         coalesce(actor.id::text = company.account_holder_id, false),
         coalesce(
           actor.id::text = any(coalesce(company.admin_ids, array[]::text[])),
           false
         )
  into v_is_company_admin_flag,
       v_is_account_holder,
       v_is_admin_list_member
  from public.users actor
  join public.companies company
    on company.id = actor.company_id
   and company.deleted_at is null
  where actor.id = p_actor_user_id
    and actor.company_id = p_company_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false);
  if not found then
    return;
  end if;

  v_is_admin := v_is_company_admin_flag
    or v_is_account_holder
    or v_is_admin_list_member;

  select coalesce(
    array_agg(distinct assignment.role_id order by assignment.role_id),
    array[]::uuid[]
  )
  into v_role_ids
  from public.user_roles assignment
  join public.roles role
    on role.id = assignment.role_id
   and (role.is_preset or role.company_id = p_company_id)
  where assignment.user_id = p_actor_user_id::text;

  -- Hash the raw, authority-relevant facts as well as the effective result.
  -- This makes an explicit granular grant distinguishable from a legacy
  -- fallback even when both currently resolve to the same scope.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'role_id', assignment.role_id::text,
        'permission', permission.permission,
        'scope', permission.scope,
        'role_is_valid', (
          coalesce(role.is_preset, false)
          or coalesce(role.company_id = p_company_id, false)
        )
      )
      order by assignment.role_id, permission.permission, permission.scope
    ),
    '[]'::jsonb
  )
  into v_role_grants
  from public.user_roles assignment
  join public.roles role
    on role.id = assignment.role_id
  join public.role_permissions permission
    on permission.role_id = assignment.role_id
  where assignment.user_id = p_actor_user_id::text;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permission', override.permission,
        'scope', override.scope,
        'granted', override.granted
      )
      order by override.permission, override.scope, override.granted
    ),
    '[]'::jsonb
  )
  into v_override_facts
  from public.user_permission_overrides override
  where override.user_id = p_actor_user_id
    and override.company_id = p_company_id;

  if v_is_admin then
    -- Mirrors the web store: admins hold every current registered product
    -- capability at all scope, but hidden/unregistered internal permissions do
    -- not materialize merely because a caller invented their names.
    v_configured_permissions := v_registered_permission_keys;
  else
    select coalesce(
      array_agg(registry.permission_key order by registry.permission_key),
      array[]::text[]
    )
    into v_configured_permissions
    from unnest(v_registered_permission_keys) registry(permission_key)
    where exists (
      select 1
      from public.user_roles assignment
      join public.role_permissions permission
        on permission.role_id = assignment.role_id
      where assignment.user_id = p_actor_user_id::text
        and permission.permission = registry.permission_key
    ) or exists (
      select 1
      from public.user_permission_overrides override
      where override.user_id = p_actor_user_id
        and override.company_id = p_company_id
        and override.permission = registry.permission_key
    );
  end if;

  with effective_permission as (
    select registry.permission_key as permission,
           case
             when v_is_admin then 'all'::text
             else private.effective_permission_scope_for_user(
               p_actor_user_id,
               p_company_id,
               registry.permission_key
             )
           end as scope
    from unnest(v_registered_permission_keys) registry(permission_key)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permission', permission,
        'scope', scope
      )
      order by permission, scope
    ) filter (where scope is not null),
    '[]'::jsonb
  )
  into v_effective_permissions
  from effective_permission;

  -- jsonb has a deterministic canonical text representation. Arrays above are
  -- explicitly sorted, so this digest changes for every authority mutation,
  -- including provenance-only changes whose effective scope stays equal.
  v_revision_input := jsonb_build_object(
    'actor_user_id', p_actor_user_id::text,
    'company_id', p_company_id::text,
    'admin_facts', jsonb_build_object(
      'is_company_admin_flag', v_is_company_admin_flag,
      'is_account_holder', v_is_account_holder,
      'is_admin_list_member', v_is_admin_list_member
    ),
    'registered_permission_keys', to_jsonb(v_registered_permission_keys),
    'role_ids', to_jsonb(v_role_ids),
    'role_grants', v_role_grants,
    'overrides', v_override_facts,
    'configured_permissions', to_jsonb(v_configured_permissions),
    'effective_permissions', v_effective_permissions
  );

  actor_user_id := p_actor_user_id;
  company_id := p_company_id;
  is_active := true;
  is_admin := v_is_admin;
  role_ids := v_role_ids;
  configured_permissions := v_configured_permissions;
  effective_permissions := v_effective_permissions;
  permission_snapshot_revision := 'sha256:' || encode(
    extensions.digest(v_revision_input::text, 'sha256'),
    'hex'
  );
  return next;
end;
$function$

;

-- agent_user_can_access_entity.sql
CREATE OR REPLACE FUNCTION private.agent_user_can_access_entity(p_actor_user_id uuid, p_actor_company_id uuid, p_entity_kind text, p_entity_id uuid, p_action text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
begin
  if p_entity_kind is null or p_entity_kind not in (
    'opportunity',
    'project',
    'task',
    'client',
    'sub_client',
    'calendar_event',
    'calendar_user_event'
  ) then
    raise exception 'invalid_agent_entity_kind' using errcode = '22023';
  end if;

  if p_action is null then
    raise exception 'invalid_agent_entity_action' using errcode = '22023';
  end if;

  case p_entity_kind
    when 'opportunity' then
      if p_action not in ('view', 'edit') then
        raise exception 'invalid_agent_entity_action' using errcode = '22023';
      end if;
      if not private.user_is_active_company_member(
        p_actor_user_id,
        p_actor_company_id
      ) then
        return false;
      end if;
      if p_action = 'view' then
        return private.user_can_view_opportunity(
          p_actor_user_id,
          p_entity_id
        );
      end if;
      return private.user_can_edit_opportunity(
        p_actor_user_id,
        p_entity_id
      );

    when 'project' then
      if p_action not in ('view', 'edit') then
        raise exception 'invalid_agent_entity_action' using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.projects entity
        where entity.id = p_entity_id
          and entity.company_id = p_actor_company_id
          and entity.deleted_at is null
      ) then
        return false;
      end if;
      if p_action = 'view' then
        return private.user_can_view_project(p_actor_user_id, p_entity_id);
      end if;
      return private.user_can_edit_project(p_actor_user_id, p_entity_id);

    when 'task' then
      if p_action not in ('view', 'edit', 'change_status') then
        raise exception 'invalid_agent_entity_action' using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.project_tasks entity
        where entity.id = p_entity_id
          and entity.company_id = p_actor_company_id
          and entity.deleted_at is null
      ) then
        return false;
      end if;
      if p_action = 'view' then
        return private.user_can_view_task(p_actor_user_id, p_entity_id);
      elsif p_action = 'edit' then
        return private.user_can_edit_task(p_actor_user_id, p_entity_id);
      end if;
      return private.user_can_change_task_status(
        p_actor_user_id,
        p_entity_id
      );

    when 'client' then
      if p_action not in ('view', 'edit') then
        raise exception 'invalid_agent_entity_action' using errcode = '22023';
      end if;
      if p_action = 'view' then
        return private.user_can_view_client(
          p_actor_user_id,
          p_actor_company_id,
          p_entity_id
        );
      end if;
      return private.user_can_edit_client(
        p_actor_user_id,
        p_actor_company_id,
        p_entity_id
      );

    when 'sub_client' then
      if p_action not in ('view', 'edit') then
        raise exception 'invalid_agent_entity_action' using errcode = '22023';
      end if;
      if p_action = 'view' then
        return private.user_can_view_sub_client(
          p_actor_user_id,
          p_actor_company_id,
          p_entity_id
        );
      end if;
      return private.user_can_edit_sub_client(
        p_actor_user_id,
        p_actor_company_id,
        p_entity_id
      );

    when 'calendar_event' then
      if p_action not in ('view', 'edit', 'delete') then
        raise exception 'invalid_agent_entity_action' using errcode = '22023';
      end if;
      if p_action = 'view' then
        return private.user_can_view_calendar_event(
          p_actor_user_id,
          p_actor_company_id,
          p_entity_id
        );
      elsif p_action = 'edit' then
        return private.user_can_edit_calendar_event(
          p_actor_user_id,
          p_actor_company_id,
          p_entity_id
        );
      end if;
      return exists (
        select 1
        from public.calendar_events entity
        where entity.id = p_entity_id
          and entity.company_id = p_actor_company_id
          and entity.deleted_at is null
      ) and (
        private.user_is_company_admin(p_actor_user_id, p_actor_company_id)
        or private.effective_permission_scope_for_user(
          p_actor_user_id,
          p_actor_company_id,
          'calendar.delete'
        ) = 'all'
      );

    when 'calendar_user_event' then
      if p_action not in ('view', 'edit', 'delete') then
        raise exception 'invalid_agent_entity_action' using errcode = '22023';
      end if;
      if p_action = 'view' then
        return private.user_can_view_calendar_user_event(
          p_actor_user_id,
          p_actor_company_id,
          p_entity_id
        );
      elsif p_action = 'edit' then
        return private.user_can_edit_calendar_user_event(
          p_actor_user_id,
          p_actor_company_id,
          p_entity_id
        );
      end if;
      return private.user_is_active_company_member(
        p_actor_user_id,
        p_actor_company_id
      ) and exists (
        select 1
        from public.calendar_user_events entity
        where entity.id = p_entity_id
          and entity.company_id = p_actor_company_id::text
          and entity.deleted_at is null
          and (
            entity.user_id = p_actor_user_id::text
            or private.user_is_company_admin(
              p_actor_user_id,
              p_actor_company_id
            )
            or private.effective_permission_scope_for_user(
              p_actor_user_id,
              p_actor_company_id,
              'calendar.delete'
            ) = 'all'
          )
      );
  end case;

  return false;
end;
$function$

;

-- user_can_view_opportunity.sql
CREATE OR REPLACE FUNCTION private.user_can_view_opportunity(p_actor_user_id uuid, p_opportunity_id uuid)
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
    'pipeline.view'
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

-- user_can_edit_opportunity.sql
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

-- user_can_assign_opportunity.sql
CREATE OR REPLACE FUNCTION private.user_can_assign_opportunity(p_actor_user_id uuid, p_opportunity_id uuid)
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
    'pipeline.assign'
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
