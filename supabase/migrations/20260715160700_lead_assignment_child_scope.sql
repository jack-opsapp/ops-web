-- Lead assignment child/context security boundary.
--
-- Parent opportunity RLS is necessary but not sufficient: company-wide child
-- policies can otherwise reveal another assignee's timeline, visit, deck,
-- lifecycle, merge, and mailbox data. This migration makes every lead-linked
-- surface delegate to the canonical 160500 authorization helpers while keeping
-- legitimate project-domain access and recipient-addressed assignment delivery.

begin;

do $prerequisites$
begin
  if to_regprocedure('private.user_can_view_opportunity(uuid,uuid)') is null
    or to_regprocedure('private.user_can_edit_opportunity(uuid,uuid)') is null
    or to_regprocedure('private.user_can_assign_opportunity(uuid,uuid)') is null
    or to_regprocedure('private.current_user_can_view_opportunity(uuid)') is null
    or to_regprocedure('private.current_user_can_edit_opportunity(uuid)') is null
    or to_regprocedure('private.user_can_view_project(uuid,uuid)') is null
    or to_regprocedure('private.user_can_edit_project(uuid,uuid)') is null
  then
    raise exception 'lead_assignment_scoped_authorization_required'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

-- --------------------------------------------------------------------------
-- Inbox authorization. A mailbox address is never an OPS identity. Scope is
-- derived only from the canonical users/roles/overrides and connection owner.
-- --------------------------------------------------------------------------

create or replace function private.should_use_inbox_view_company_compat(
  p_actor_user_id uuid,
  p_actor_company_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select p_actor_user_id is not null
    and p_actor_company_id is not null
    and not exists (
      select 1
        from public.user_permission_overrides upo
       where upo.user_id = p_actor_user_id
         and upo.company_id = p_actor_company_id
         and upo.permission = 'inbox.view'
    )
    and not exists (
      select 1
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id = ur.role_id
       where ur.user_id = p_actor_user_id::text
         and rp.permission = 'inbox.view'
    )
    and public.has_permission(
      p_actor_user_id,
      'inbox.view_company',
      'all'
    );
$function$;

revoke all on function private.should_use_inbox_view_company_compat(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.effective_inbox_scope_for_user(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_permission text
) returns text
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
$function$;

revoke all on function private.effective_inbox_scope_for_user(uuid, uuid, text)
  from public, anon, authenticated, service_role;

create or replace function private.user_can_view_inbox_connection(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_opportunity_id uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_scope text;
begin
  if p_connection_id is null
    or not exists (
      select 1
        from public.email_connections ec
       where ec.id = p_connection_id
         and private.try_parse_uuid(ec.company_id) = p_company_id
    )
  then
    return false;
  end if;

  v_scope := private.effective_inbox_scope_for_user(
    p_actor_user_id,
    p_company_id,
    'inbox.view'
  );
  if v_scope = 'all' then
    return true;
  end if;
  if v_scope = 'assigned' then
    return exists (
      select 1
        from public.email_connections ec
       where ec.id = p_connection_id
         and private.try_parse_uuid(ec.company_id) = p_company_id
         and ec.type::text = 'individual'
         and nullif(btrim(ec.user_id), '') = p_actor_user_id::text
    ) or (
      p_opportunity_id is not null
      and exists (
        select 1
          from public.opportunities o
         where o.id = p_opportunity_id
           and o.company_id = p_company_id
           and o.deleted_at is null
           and o.assigned_to = p_actor_user_id
      )
    );
  end if;
  if v_scope = 'own' then
    return exists (
      select 1
        from public.email_connections ec
       where ec.id = p_connection_id
         and private.try_parse_uuid(ec.company_id) = p_company_id
         and ec.type::text = 'individual'
         and nullif(btrim(ec.user_id), '') = p_actor_user_id::text
    );
  end if;
  return false;
end;
$function$;

revoke all on function private.user_can_view_inbox_connection(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.user_can_send_inbox_connection(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_opportunity_id uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_scope text;
  v_connection_type text;
  v_connection_user_id text;
begin
  if p_connection_id is null then
    return false;
  end if;

  select ec.type::text, nullif(btrim(ec.user_id), '')
    into v_connection_type, v_connection_user_id
    from public.email_connections ec
   where ec.id = p_connection_id
     and private.try_parse_uuid(ec.company_id) = p_company_id;
  if not found
    or v_connection_type is null
    or v_connection_type not in ('company', 'individual')
  then
    return false;
  end if;
  if v_connection_type = 'individual'
    and v_connection_user_id is distinct from p_actor_user_id::text
  then
    return false;
  end if;

  v_scope := private.effective_inbox_scope_for_user(
    p_actor_user_id,
    p_company_id,
    'inbox.send'
  );
  if v_scope = 'all' then
    return true;
  end if;
  if v_scope = 'assigned' then
    return p_opportunity_id is not null
      and exists (
        select 1
          from public.opportunities o
         where o.id = p_opportunity_id
           and o.company_id = p_company_id
           and o.deleted_at is null
           and o.assigned_to = p_actor_user_id
      );
  end if;
  return false;
end;
$function$;

revoke all on function private.user_can_send_inbox_connection(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.user_can_view_opportunity_inbox(
  p_actor_user_id uuid,
  p_opportunity_id uuid,
  p_connection_id uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid;
begin
  select o.company_id
    into v_company_id
    from public.opportunities o
   where o.id = p_opportunity_id
     and o.deleted_at is null;
  if not found then
    return false;
  end if;
  return private.user_can_view_opportunity(
      p_actor_user_id,
      p_opportunity_id
    )
    and private.user_can_view_inbox_connection(
      p_actor_user_id,
      v_company_id,
      p_connection_id,
      p_opportunity_id
    );
end;
$function$;

revoke all on function private.user_can_view_opportunity_inbox(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.user_can_send_opportunity_inbox(
  p_actor_user_id uuid,
  p_opportunity_id uuid,
  p_connection_id uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid;
begin
  select o.company_id
    into v_company_id
    from public.opportunities o
   where o.id = p_opportunity_id
     and o.deleted_at is null;
  if not found then
    return false;
  end if;
  return private.user_can_edit_opportunity(
      p_actor_user_id,
      p_opportunity_id
    )
    and private.user_can_send_inbox_connection(
      p_actor_user_id,
      v_company_id,
      p_connection_id,
      p_opportunity_id
    );
end;
$function$;

revoke all on function private.user_can_send_opportunity_inbox(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.current_user_can_view_opportunity_inbox(
  p_opportunity_id uuid,
  p_connection_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.user_can_view_opportunity_inbox(
    private.get_current_user_id(),
    p_opportunity_id,
    p_connection_id
  );
$function$;

revoke all on function private.current_user_can_view_opportunity_inbox(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_view_opportunity_inbox(uuid, uuid)
  to anon, authenticated;

create or replace function private.current_user_can_send_opportunity_inbox(
  p_opportunity_id uuid,
  p_connection_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.user_can_send_opportunity_inbox(
    private.get_current_user_id(),
    p_opportunity_id,
    p_connection_id
  );
$function$;

revoke all on function private.current_user_can_send_opportunity_inbox(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_send_opportunity_inbox(uuid, uuid)
  to anon, authenticated;

-- --------------------------------------------------------------------------
-- Strong project/client alternatives for polymorphic children.
-- --------------------------------------------------------------------------

create or replace function private.current_user_can_view_project_reference(
  p_project_id text,
  p_project_ref uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select coalesce(
    private.user_can_view_project(
      private.get_current_user_id(),
      coalesce(p_project_ref, private.try_parse_uuid(p_project_id))
    ),
    false
  );
$function$;

revoke all on function private.current_user_can_view_project_reference(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_view_project_reference(text, uuid)
  to anon, authenticated;

create or replace function private.current_user_can_edit_project_reference(
  p_project_id text,
  p_project_ref uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select coalesce(
    private.user_can_view_project(
      private.get_current_user_id(),
      coalesce(p_project_ref, private.try_parse_uuid(p_project_id))
    )
    and private.user_can_edit_project(
      private.get_current_user_id(),
      coalesce(p_project_ref, private.try_parse_uuid(p_project_id))
    ),
    false
  );
$function$;

revoke all on function private.current_user_can_edit_project_reference(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_edit_project_reference(text, uuid)
  to anon, authenticated;

-- A polymorphic child may remain project-authorized after conversion, but a
-- caller must never combine an unrelated accessible project with an
-- inaccessible opportunity. Accept either legacy one-sided link while
-- rejecting contradictory mirrors and deleted/cross-company parents.
create or replace function private.opportunity_project_relationship_is_valid(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_project_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
$function$;

revoke all on function private.opportunity_project_relationship_is_valid(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.user_can_view_client(
  p_actor_user_id uuid,
  p_client_id uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
$function$;

revoke all on function private.user_can_view_client(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.user_can_edit_client(
  p_actor_user_id uuid,
  p_client_id uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
$function$;

revoke all on function private.user_can_edit_client(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Resolve legacy email activities only through one exact mailbox-thread link.
-- Multiple or missing candidate connections fail closed.
create or replace function private.resolve_activity_email_connection(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_provider_thread_id text,
  p_explicit_connection_id uuid
) returns uuid
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_connections uuid[];
begin
  if p_explicit_connection_id is not null then
    if exists (
      select 1
        from public.email_connections ec
       where ec.id = p_explicit_connection_id
         and private.try_parse_uuid(ec.company_id) = p_company_id
    ) then
      return p_explicit_connection_id;
    end if;
    return null;
  end if;
  if p_opportunity_id is null
    or nullif(btrim(p_provider_thread_id), '') is null
  then
    return null;
  end if;
  select array_agg(distinct link.connection_id)
    into v_connections
    from public.opportunity_email_threads link
    join public.email_connections ec on ec.id = link.connection_id
   where link.opportunity_id = p_opportunity_id
     and link.thread_id = p_provider_thread_id
     and link.connection_id is not null
     and private.try_parse_uuid(ec.company_id) = p_company_id;
  if cardinality(v_connections) = 1 then
    return v_connections[1];
  end if;
  return null;
end;
$function$;

revoke all on function private.resolve_activity_email_connection(uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.current_user_can_view_activity(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_project_id text,
  p_email_connection_id uuid,
  p_email_thread_id text,
  p_activity_type text
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_project_id uuid := private.try_parse_uuid(p_project_id);
  v_connection_id uuid;
  v_parent_allowed boolean;
begin
  if v_actor_user_id is null
    or private.get_user_company_id() is distinct from p_company_id
  then
    return false;
  end if;
  if p_activity_type = 'email'
    or p_email_connection_id is not null
    or nullif(btrim(p_email_thread_id), '') is not null
  then
    v_connection_id := private.resolve_activity_email_connection(
      p_company_id,
      p_opportunity_id,
      p_email_thread_id,
      p_email_connection_id
    );
    v_parent_allowed := (p_opportunity_id is null and v_project_id is null)
      or (p_opportunity_id is not null and private.user_can_view_opportunity(
        v_actor_user_id, p_opportunity_id
      ))
      or (v_project_id is not null and private.user_can_view_project(
        v_actor_user_id, v_project_id
      ));
    return v_parent_allowed
      and private.user_can_view_inbox_connection(
        v_actor_user_id,
        p_company_id,
        v_connection_id,
        p_opportunity_id
      );
  end if;
  if p_opportunity_id is null and v_project_id is null then
    return true;
  end if;
  return (p_opportunity_id is not null and private.user_can_view_opportunity(
      v_actor_user_id, p_opportunity_id
    ))
    or (v_project_id is not null and private.user_can_view_project(
      v_actor_user_id, v_project_id
    ));
end;
$function$;

revoke all on function private.current_user_can_view_activity(uuid, uuid, text, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_view_activity(uuid, uuid, text, uuid, text, text)
  to anon, authenticated;

create or replace function private.current_user_can_edit_activity(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_project_id text,
  p_email_connection_id uuid,
  p_email_thread_id text,
  p_activity_type text
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_project_id uuid := private.try_parse_uuid(p_project_id);
  v_connection_id uuid;
  v_parent_allowed boolean;
begin
  if v_actor_user_id is null
    or private.get_user_company_id() is distinct from p_company_id
  then
    return false;
  end if;
  if p_opportunity_id is not null
    and p_project_id is not null
    and (
      v_project_id is null
      or not private.opportunity_project_relationship_is_valid(
        p_company_id,
        p_opportunity_id,
        v_project_id
      )
    )
  then
    return false;
  end if;
  if p_activity_type = 'email'
    or p_email_connection_id is not null
    or nullif(btrim(p_email_thread_id), '') is not null
  then
    v_connection_id := private.resolve_activity_email_connection(
      p_company_id,
      p_opportunity_id,
      p_email_thread_id,
      p_email_connection_id
    );
    v_parent_allowed := (p_opportunity_id is null and v_project_id is null)
      or (p_opportunity_id is not null and private.user_can_edit_opportunity(
        v_actor_user_id, p_opportunity_id
      ))
      or (v_project_id is not null
        and private.user_can_view_project(v_actor_user_id, v_project_id)
        and private.user_can_edit_project(v_actor_user_id, v_project_id));
    return v_parent_allowed
      and private.user_can_send_inbox_connection(
        v_actor_user_id,
        p_company_id,
        v_connection_id,
        p_opportunity_id
      );
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
$function$;

revoke all on function private.current_user_can_edit_activity(uuid, uuid, text, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_edit_activity(uuid, uuid, text, uuid, text, text)
  to anon, authenticated;

create or replace function private.current_user_can_view_activity_comment(
  p_company_id text,
  p_activity_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select coalesce((
    select private.current_user_can_view_activity(
      a.company_id,
      a.opportunity_id,
      a.project_id,
      a.email_connection_id,
      a.email_thread_id,
      a.type
    )
      from public.activities a
     where a.id = p_activity_id
       and a.company_id = private.try_parse_uuid(p_company_id)
  ), false);
$function$;

revoke all on function private.current_user_can_view_activity_comment(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_view_activity_comment(text, uuid)
  to anon, authenticated;

create or replace function private.current_user_can_edit_activity_comment(
  p_company_id text,
  p_activity_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select coalesce((
    select private.current_user_can_edit_activity(
      a.company_id,
      a.opportunity_id,
      a.project_id,
      a.email_connection_id,
      a.email_thread_id,
      a.type
    )
      from public.activities a
     where a.id = p_activity_id
       and a.company_id = private.try_parse_uuid(p_company_id)
  ), false);
$function$;

revoke all on function private.current_user_can_edit_activity_comment(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_edit_activity_comment(text, uuid)
  to anon, authenticated;

create or replace function private.current_user_can_view_site_visit(
  p_company_id text,
  p_opportunity_id uuid,
  p_project_id text,
  p_project_ref uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_project_id uuid := coalesce(p_project_ref, private.try_parse_uuid(p_project_id));
begin
  if private.try_parse_uuid(p_company_id) is distinct from private.get_user_company_id() then
    return false;
  end if;
  if p_opportunity_id is null and v_project_id is null then
    return true;
  end if;
  return (p_opportunity_id is not null and private.user_can_view_opportunity(
      v_actor_user_id, p_opportunity_id
    ))
    or (v_project_id is not null and private.user_can_view_project(
      v_actor_user_id, v_project_id
    ));
end;
$function$;

revoke all on function private.current_user_can_view_site_visit(text, uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_view_site_visit(text, uuid, text, uuid)
  to anon, authenticated;

create or replace function private.current_user_can_edit_site_visit(
  p_company_id text,
  p_opportunity_id uuid,
  p_project_id text,
  p_project_ref uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
$function$;

revoke all on function private.current_user_can_edit_site_visit(text, uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_edit_site_visit(text, uuid, text, uuid)
  to anon, authenticated;

create or replace function private.current_user_can_view_deck_design(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_project_id uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
begin
  if private.get_user_company_id() is distinct from p_company_id then
    return false;
  end if;
  if p_opportunity_id is null and p_project_id is null then
    return public.has_permission(
      v_actor_user_id,
      'deck_builder.view',
      'all'
    );
  end if;
  if not public.has_permission(
    v_actor_user_id,
    'deck_builder.view',
    'assigned'
  ) then
    return false;
  end if;
  return (p_opportunity_id is not null and private.user_can_view_opportunity(
      v_actor_user_id, p_opportunity_id
    ))
    or (p_project_id is not null and private.user_can_view_project(
      v_actor_user_id, p_project_id
    ));
end;
$function$;

revoke all on function private.current_user_can_view_deck_design(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_view_deck_design(uuid, uuid, uuid)
  to anon, authenticated;

create or replace function private.current_user_can_edit_deck_design(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_project_id uuid,
  p_permission text
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
begin
  if p_permission not in ('deck_builder.create', 'deck_builder.edit')
    or private.get_user_company_id() is distinct from p_company_id
  then
    return false;
  end if;
  if p_opportunity_id is not null
    and p_project_id is not null
    and not private.opportunity_project_relationship_is_valid(
      p_company_id,
      p_opportunity_id,
      p_project_id
    )
  then
    return false;
  end if;
  if p_opportunity_id is null and p_project_id is null then
    return public.has_permission(
      v_actor_user_id,
      p_permission,
      'all'
    );
  end if;
  if not public.has_permission(
    v_actor_user_id,
    p_permission,
    'assigned'
  ) then
    return false;
  end if;
  return (p_opportunity_id is not null and private.user_can_edit_opportunity(
      v_actor_user_id, p_opportunity_id
    ))
    or (p_project_id is not null
      and private.user_can_view_project(v_actor_user_id, p_project_id)
      and private.user_can_edit_project(v_actor_user_id, p_project_id));
end;
$function$;

revoke all on function private.current_user_can_edit_deck_design(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_edit_deck_design(uuid, uuid, uuid, text)
  to anon, authenticated;

-- --------------------------------------------------------------------------
-- Merge/review visibility requires access to every referenced entity.
-- Opportunity merge manifests additionally require company-wide lead scope.
-- --------------------------------------------------------------------------

create or replace function private.current_user_can_view_opportunity_merge(
  p_company_id uuid,
  p_entity_type text,
  p_winner_id uuid,
  p_loser_id uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
begin
  if v_actor_user_id is null
    or private.get_user_company_id() is distinct from p_company_id
  then
    return false;
  end if;
  if p_entity_type = 'opportunity' then
    return private.effective_pipeline_scope_for_user(
        v_actor_user_id, p_company_id, 'pipeline.view'
      ) = 'all'
      and private.user_can_view_opportunity(v_actor_user_id, p_winner_id)
      and private.user_can_view_opportunity(v_actor_user_id, p_loser_id);
  end if;
  if p_entity_type = 'client' then
    return private.user_can_view_client(v_actor_user_id, p_winner_id)
      and private.user_can_view_client(v_actor_user_id, p_loser_id);
  end if;
  return false;
end;
$function$;

revoke all on function private.current_user_can_view_opportunity_merge(uuid, text, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_view_opportunity_merge(uuid, text, uuid, uuid)
  to anon, authenticated;

create or replace function private.current_user_can_view_duplicate_review(
  p_company_id uuid,
  p_entity_type text,
  p_entity_a_id uuid,
  p_entity_b_id uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_project_a_id uuid;
  v_project_b_id uuid;
begin
  if v_actor_user_id is null
    or private.get_user_company_id() is distinct from p_company_id
  then
    return false;
  end if;
  case p_entity_type
    when 'opportunity' then
      return private.effective_pipeline_scope_for_user(
          v_actor_user_id, p_company_id, 'pipeline.view'
        ) = 'all'
        and private.user_can_view_opportunity(v_actor_user_id, p_entity_a_id)
        and private.user_can_view_opportunity(v_actor_user_id, p_entity_b_id);
    when 'client' then
      return private.user_can_view_client(v_actor_user_id, p_entity_a_id)
        and private.user_can_view_client(v_actor_user_id, p_entity_b_id);
    when 'project' then
      return private.user_can_view_project(v_actor_user_id, p_entity_a_id)
        and private.user_can_view_project(v_actor_user_id, p_entity_b_id);
    when 'task' then
      select pt.project_id into v_project_a_id
        from public.project_tasks pt
       where pt.id = p_entity_a_id and pt.deleted_at is null;
      select pt.project_id into v_project_b_id
        from public.project_tasks pt
       where pt.id = p_entity_b_id and pt.deleted_at is null;
      return v_project_a_id is not null
        and v_project_b_id is not null
        and private.user_can_view_project(v_actor_user_id, v_project_a_id)
        and private.user_can_view_project(v_actor_user_id, v_project_b_id);
  end case;
  return false;
end;
$function$;

revoke all on function private.current_user_can_view_duplicate_review(uuid, text, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_view_duplicate_review(uuid, text, uuid, uuid)
  to anon, authenticated;

-- --------------------------------------------------------------------------
-- Generic child re-parenting is token-gated. The tokens are transaction- and
-- backend-addressed, minted only by the reviewed merge/data-review wrappers,
-- and consumed by the trigger. No custom GUC can authorize this trigger.
-- --------------------------------------------------------------------------

create table private.opportunity_child_reparent_tokens (
  id uuid primary key default gen_random_uuid(),
  transaction_id bigint not null,
  backend_pid integer not null,
  table_name text not null check (table_name in (
    'activities',
    'ai_draft_history',
    'email_threads',
    'follow_ups',
    'lead_field_provenance',
    'opportunity_correspondence_events',
    'opportunity_email_threads',
    'opportunity_follow_up_drafts',
    'opportunity_lifecycle_action_audit',
    'opportunity_lifecycle_state',
    'pending_auto_sends',
    'site_visits',
    'stage_transitions',
    'deck_designs'
  )),
  row_id uuid not null,
  old_opportunity_id uuid,
  new_opportunity_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique (transaction_id, backend_pid, table_name, row_id)
);

revoke all on table private.opportunity_child_reparent_tokens
  from public, anon, authenticated, service_role;

create or replace function private.guard_opportunity_child_reparent()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_old_opportunity_id uuid;
  v_new_opportunity_id uuid;
  v_row_id uuid;
  v_consumed boolean;
begin
  if tg_nargs < 2 then
    raise exception 'child_reparent_guard_misconfigured'
      using errcode = '55000';
  end if;
  if tg_nargs >= 3
    and v_old ->> 'entity_type' is distinct from tg_argv[2]
    and v_new ->> 'entity_type' is distinct from tg_argv[2]
  then
    return new;
  end if;
  v_old_opportunity_id := private.try_parse_uuid(v_old ->> tg_argv[0]);
  v_new_opportunity_id := private.try_parse_uuid(v_new ->> tg_argv[0]);
  if v_old_opportunity_id is not distinct from v_new_opportunity_id then
    return new;
  end if;
  v_row_id := private.try_parse_uuid(v_old ->> tg_argv[1]);
  delete from private.opportunity_child_reparent_tokens token
   where token.transaction_id = txid_current()
     and token.backend_pid = pg_backend_pid()
     and token.table_name = tg_table_name
     and token.row_id = v_row_id
     and token.old_opportunity_id is not distinct from v_old_opportunity_id
     and token.new_opportunity_id is not distinct from v_new_opportunity_id
  returning true into v_consumed;
  if not found or not coalesce(v_consumed, false) then
    raise exception 'child_reparent_forbidden'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function private.guard_opportunity_child_reparent()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_activities_guard_opportunity_reparent on public.activities;
create trigger trg_activities_guard_opportunity_reparent
before update of opportunity_id on public.activities
for each row execute function private.guard_opportunity_child_reparent('opportunity_id', 'id');

drop trigger if exists trg_follow_ups_guard_opportunity_reparent on public.follow_ups;
create trigger trg_follow_ups_guard_opportunity_reparent
before update of opportunity_id on public.follow_ups
for each row execute function private.guard_opportunity_child_reparent('opportunity_id', 'id');

drop trigger if exists trg_stage_transitions_guard_opportunity_reparent on public.stage_transitions;
create trigger trg_stage_transitions_guard_opportunity_reparent
before update of opportunity_id on public.stage_transitions
for each row execute function private.guard_opportunity_child_reparent('opportunity_id', 'id');

drop trigger if exists trg_site_visits_guard_opportunity_reparent on public.site_visits;
create trigger trg_site_visits_guard_opportunity_reparent
before update of opportunity_id on public.site_visits
for each row execute function private.guard_opportunity_child_reparent('opportunity_id', 'id');

drop trigger if exists trg_deck_designs_guard_opportunity_reparent on public.deck_designs;
create trigger trg_deck_designs_guard_opportunity_reparent
before update of opportunity_id on public.deck_designs
for each row execute function private.guard_opportunity_child_reparent('opportunity_id', 'id');

drop trigger if exists trg_lead_field_provenance_guard_opportunity_reparent on public.lead_field_provenance;
create trigger trg_lead_field_provenance_guard_opportunity_reparent
before update of entity_id, entity_type on public.lead_field_provenance
for each row execute function private.guard_opportunity_child_reparent('entity_id', 'id', 'opportunity');

drop trigger if exists trg_opportunity_correspondence_events_guard_opportunity_reparent on public.opportunity_correspondence_events;
create trigger trg_opportunity_correspondence_events_guard_opportunity_reparent
before update of opportunity_id on public.opportunity_correspondence_events
for each row execute function private.guard_opportunity_child_reparent('opportunity_id', 'id');

drop trigger if exists trg_opportunity_follow_up_drafts_guard_opportunity_reparent on public.opportunity_follow_up_drafts;
create trigger trg_opportunity_follow_up_drafts_guard_opportunity_reparent
before update of opportunity_id on public.opportunity_follow_up_drafts
for each row execute function private.guard_opportunity_child_reparent('opportunity_id', 'id');

drop trigger if exists trg_opportunity_lifecycle_state_guard_opportunity_reparent on public.opportunity_lifecycle_state;
create trigger trg_opportunity_lifecycle_state_guard_opportunity_reparent
before update of opportunity_id on public.opportunity_lifecycle_state
for each row execute function private.guard_opportunity_child_reparent('opportunity_id', 'opportunity_id');

drop trigger if exists trg_opportunity_lifecycle_action_audit_guard_opportunity_reparent on public.opportunity_lifecycle_action_audit;
create trigger trg_opportunity_lifecycle_action_audit_guard_opportunity_reparent
before update of opportunity_id on public.opportunity_lifecycle_action_audit
for each row execute function private.guard_opportunity_child_reparent('opportunity_id', 'id');

drop trigger if exists trg_email_threads_guard_opportunity_reparent on public.email_threads;
create trigger trg_email_threads_guard_opportunity_reparent
before update of opportunity_id on public.email_threads
for each row execute function private.guard_opportunity_child_reparent('opportunity_id', 'id');

drop trigger if exists trg_opportunity_email_threads_guard_opportunity_reparent on public.opportunity_email_threads;
create trigger trg_opportunity_email_threads_guard_opportunity_reparent
before update of opportunity_id on public.opportunity_email_threads
for each row execute function private.guard_opportunity_child_reparent('opportunity_id', 'id');

drop trigger if exists trg_ai_draft_history_guard_opportunity_reparent on public.ai_draft_history;
create trigger trg_ai_draft_history_guard_opportunity_reparent
before update of opportunity_id on public.ai_draft_history
for each row execute function private.guard_opportunity_child_reparent('opportunity_id', 'id');

drop trigger if exists trg_pending_auto_sends_guard_opportunity_reparent on public.pending_auto_sends;
create trigger trg_pending_auto_sends_guard_opportunity_reparent
before update of opportunity_id on public.pending_auto_sends
for each row execute function private.guard_opportunity_child_reparent('opportunity_id', 'id');

create or replace function private.mint_merge_child_reparent_tokens(
  p_company_id uuid,
  p_loser_id uuid,
  p_winner_id uuid
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  insert into private.opportunity_child_reparent_tokens (
    transaction_id, backend_pid, table_name, row_id,
    old_opportunity_id, new_opportunity_id
  )
  select txid_current(), pg_backend_pid(), 'activities', row.id,
         row.opportunity_id, p_winner_id
    from public.activities row
   where row.company_id = p_company_id and row.opportunity_id = p_loser_id
  on conflict (transaction_id, backend_pid, table_name, row_id)
  do update set old_opportunity_id = excluded.old_opportunity_id,
                new_opportunity_id = excluded.new_opportunity_id;

  insert into private.opportunity_child_reparent_tokens (
    transaction_id, backend_pid, table_name, row_id,
    old_opportunity_id, new_opportunity_id
  )
  select txid_current(), pg_backend_pid(), 'follow_ups', row.id,
         row.opportunity_id, p_winner_id
    from public.follow_ups row
   where row.company_id = p_company_id and row.opportunity_id = p_loser_id
  on conflict (transaction_id, backend_pid, table_name, row_id)
  do update set old_opportunity_id = excluded.old_opportunity_id,
                new_opportunity_id = excluded.new_opportunity_id;

  insert into private.opportunity_child_reparent_tokens (
    transaction_id, backend_pid, table_name, row_id,
    old_opportunity_id, new_opportunity_id
  )
  select txid_current(), pg_backend_pid(), 'stage_transitions', row.id,
         row.opportunity_id, p_winner_id
    from public.stage_transitions row
   where row.company_id = p_company_id and row.opportunity_id = p_loser_id
  on conflict (transaction_id, backend_pid, table_name, row_id)
  do update set old_opportunity_id = excluded.old_opportunity_id,
                new_opportunity_id = excluded.new_opportunity_id;

  insert into private.opportunity_child_reparent_tokens (
    transaction_id, backend_pid, table_name, row_id,
    old_opportunity_id, new_opportunity_id
  )
  select txid_current(), pg_backend_pid(), 'site_visits', row.id,
         row.opportunity_id, p_winner_id
    from public.site_visits row
   where private.try_parse_uuid(row.company_id) = p_company_id
     and row.opportunity_id = p_loser_id
  on conflict (transaction_id, backend_pid, table_name, row_id)
  do update set old_opportunity_id = excluded.old_opportunity_id,
                new_opportunity_id = excluded.new_opportunity_id;

  insert into private.opportunity_child_reparent_tokens (
    transaction_id, backend_pid, table_name, row_id,
    old_opportunity_id, new_opportunity_id
  )
  select txid_current(), pg_backend_pid(), 'email_threads', row.id,
         row.opportunity_id, p_winner_id
    from public.email_threads row
   where row.company_id = p_company_id and row.opportunity_id = p_loser_id
  on conflict (transaction_id, backend_pid, table_name, row_id)
  do update set old_opportunity_id = excluded.old_opportunity_id,
                new_opportunity_id = excluded.new_opportunity_id;

  insert into private.opportunity_child_reparent_tokens (
    transaction_id, backend_pid, table_name, row_id,
    old_opportunity_id, new_opportunity_id
  )
  select txid_current(), pg_backend_pid(), 'opportunity_email_threads', row.id,
         row.opportunity_id, p_winner_id
    from public.opportunity_email_threads row
   where row.opportunity_id = p_loser_id
  on conflict (transaction_id, backend_pid, table_name, row_id)
  do update set old_opportunity_id = excluded.old_opportunity_id,
                new_opportunity_id = excluded.new_opportunity_id;

  insert into private.opportunity_child_reparent_tokens (
    transaction_id, backend_pid, table_name, row_id,
    old_opportunity_id, new_opportunity_id
  )
  select txid_current(), pg_backend_pid(), 'opportunity_correspondence_events', row.id,
         row.opportunity_id, p_winner_id
    from public.opportunity_correspondence_events row
   where row.company_id = p_company_id and row.opportunity_id = p_loser_id
  on conflict (transaction_id, backend_pid, table_name, row_id)
  do update set old_opportunity_id = excluded.old_opportunity_id,
                new_opportunity_id = excluded.new_opportunity_id;

  insert into private.opportunity_child_reparent_tokens (
    transaction_id, backend_pid, table_name, row_id,
    old_opportunity_id, new_opportunity_id
  )
  select txid_current(), pg_backend_pid(), 'opportunity_follow_up_drafts', row.id,
         row.opportunity_id, p_winner_id
    from public.opportunity_follow_up_drafts row
   where row.company_id = p_company_id and row.opportunity_id = p_loser_id
  on conflict (transaction_id, backend_pid, table_name, row_id)
  do update set old_opportunity_id = excluded.old_opportunity_id,
                new_opportunity_id = excluded.new_opportunity_id;

  insert into private.opportunity_child_reparent_tokens (
    transaction_id, backend_pid, table_name, row_id,
    old_opportunity_id, new_opportunity_id
  )
  select txid_current(), pg_backend_pid(), 'opportunity_lifecycle_action_audit', row.id,
         row.opportunity_id, p_winner_id
    from public.opportunity_lifecycle_action_audit row
   where row.company_id = p_company_id and row.opportunity_id = p_loser_id
  on conflict (transaction_id, backend_pid, table_name, row_id)
  do update set old_opportunity_id = excluded.old_opportunity_id,
                new_opportunity_id = excluded.new_opportunity_id;

  insert into private.opportunity_child_reparent_tokens (
    transaction_id, backend_pid, table_name, row_id,
    old_opportunity_id, new_opportunity_id
  )
  select txid_current(), pg_backend_pid(), 'opportunity_lifecycle_state', row.opportunity_id,
         row.opportunity_id, p_winner_id
    from public.opportunity_lifecycle_state row
   where row.company_id = p_company_id and row.opportunity_id = p_loser_id
  on conflict (transaction_id, backend_pid, table_name, row_id)
  do update set old_opportunity_id = excluded.old_opportunity_id,
                new_opportunity_id = excluded.new_opportunity_id;

  insert into private.opportunity_child_reparent_tokens (
    transaction_id, backend_pid, table_name, row_id,
    old_opportunity_id, new_opportunity_id
  )
  select txid_current(), pg_backend_pid(), 'ai_draft_history', row.id,
         row.opportunity_id, p_winner_id
    from public.ai_draft_history row
   where row.company_id = p_company_id and row.opportunity_id = p_loser_id
  on conflict (transaction_id, backend_pid, table_name, row_id)
  do update set old_opportunity_id = excluded.old_opportunity_id,
                new_opportunity_id = excluded.new_opportunity_id;

  insert into private.opportunity_child_reparent_tokens (
    transaction_id, backend_pid, table_name, row_id,
    old_opportunity_id, new_opportunity_id
  )
  select txid_current(), pg_backend_pid(), 'pending_auto_sends', row.id,
         row.opportunity_id, p_winner_id
    from public.pending_auto_sends row
   where row.company_id = p_company_id and row.opportunity_id = p_loser_id
  on conflict (transaction_id, backend_pid, table_name, row_id)
  do update set old_opportunity_id = excluded.old_opportunity_id,
                new_opportunity_id = excluded.new_opportunity_id;
end;
$function$;

revoke all on function private.mint_merge_child_reparent_tokens(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.mint_email_review_child_reparent_tokens(
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_target_opportunity_id uuid
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  insert into private.opportunity_child_reparent_tokens (
    transaction_id, backend_pid, table_name, row_id,
    old_opportunity_id, new_opportunity_id
  )
  select txid_current(), pg_backend_pid(), 'activities', row.id,
         row.opportunity_id, p_target_opportunity_id
    from public.activities row
   where row.company_id = p_company_id
     and row.type = 'email'
     and row.email_thread_id = p_provider_thread_id
     and (row.email_connection_id = p_connection_id or row.email_connection_id is null)
     and row.opportunity_id is distinct from p_target_opportunity_id
  on conflict (transaction_id, backend_pid, table_name, row_id)
  do update set old_opportunity_id = excluded.old_opportunity_id,
                new_opportunity_id = excluded.new_opportunity_id;

  insert into private.opportunity_child_reparent_tokens (
    transaction_id, backend_pid, table_name, row_id,
    old_opportunity_id, new_opportunity_id
  )
  select txid_current(), pg_backend_pid(), 'email_threads', row.id,
         row.opportunity_id, p_target_opportunity_id
    from public.email_threads row
   where row.company_id = p_company_id
     and row.connection_id = p_connection_id
     and row.provider_thread_id = p_provider_thread_id
     and row.opportunity_id is distinct from p_target_opportunity_id
  on conflict (transaction_id, backend_pid, table_name, row_id)
  do update set old_opportunity_id = excluded.old_opportunity_id,
                new_opportunity_id = excluded.new_opportunity_id;

  insert into private.opportunity_child_reparent_tokens (
    transaction_id, backend_pid, table_name, row_id,
    old_opportunity_id, new_opportunity_id
  )
  select txid_current(), pg_backend_pid(), 'opportunity_email_threads', row.id,
         row.opportunity_id, p_target_opportunity_id
    from public.opportunity_email_threads row
   where row.connection_id = p_connection_id
     and row.thread_id = p_provider_thread_id
     and row.opportunity_id is distinct from p_target_opportunity_id
  on conflict (transaction_id, backend_pid, table_name, row_id)
  do update set old_opportunity_id = excluded.old_opportunity_id,
                new_opportunity_id = excluded.new_opportunity_id;
end;
$function$;

revoke all on function private.mint_email_review_child_reparent_tokens(uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;

-- Wrap, rather than copy, both reviewed re-parent implementations. Their
-- existing row locks and review validation stay authoritative; this layer adds
-- an unforgeable trigger capability for the exact rows they may move.
alter function public.execute_opportunity_merge_guarded(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text
) rename to execute_opportunity_merge_guarded_child_scope_internal;

revoke all on function public.execute_opportunity_merge_guarded_child_scope_internal(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text
) from public, anon, authenticated, service_role;

create or replace function public.execute_opportunity_merge_guarded(
  p_company_id uuid,
  p_winner_id uuid,
  p_loser_id uuid,
  p_merge_key text,
  p_review_id uuid default null,
  p_expected_winner_stage text default null,
  p_expected_loser_stage text default null,
  p_field_fill jsonb default '{}'::jsonb,
  p_confirmed_overrides jsonb default '{}'::jsonb,
  p_resolved_by uuid default null,
  p_run_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  perform private.mint_merge_child_reparent_tokens(
    p_company_id, p_loser_id, p_winner_id
  );
  v_result := public.execute_opportunity_merge_guarded_child_scope_internal(
    p_company_id,
    p_winner_id,
    p_loser_id,
    p_merge_key,
    p_review_id,
    p_expected_winner_stage,
    p_expected_loser_stage,
    p_field_fill,
    p_confirmed_overrides,
    p_resolved_by,
    p_run_id
  );
  delete from private.opportunity_child_reparent_tokens token
   where token.transaction_id = txid_current()
     and token.backend_pid = pg_backend_pid();
  return v_result;
exception when others then
  delete from private.opportunity_child_reparent_tokens token
   where token.transaction_id = txid_current()
     and token.backend_pid = pg_backend_pid();
  raise;
end;
$function$;

revoke all on function public.execute_opportunity_merge_guarded(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.execute_opportunity_merge_guarded(
  uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid, text
) to service_role;

alter function public.reassign_opportunity_email_thread_guarded(
  uuid, uuid, text, uuid, text
) rename to reassign_opportunity_email_thread_guarded_child_scope_internal;

revoke all on function public.reassign_opportunity_email_thread_guarded_child_scope_internal(
  uuid, uuid, text, uuid, text
) from public, anon, authenticated, service_role;

create or replace function public.reassign_opportunity_email_thread_guarded(
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_target_opportunity_id uuid,
  p_kind text default 'split'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  perform private.mint_email_review_child_reparent_tokens(
    p_company_id,
    p_connection_id,
    p_provider_thread_id,
    p_target_opportunity_id
  );
  v_result := public.reassign_opportunity_email_thread_guarded_child_scope_internal(
    p_company_id,
    p_connection_id,
    p_provider_thread_id,
    p_target_opportunity_id,
    p_kind
  );
  delete from private.opportunity_child_reparent_tokens token
   where token.transaction_id = txid_current()
     and token.backend_pid = pg_backend_pid();
  return v_result;
exception when others then
  delete from private.opportunity_child_reparent_tokens token
   where token.transaction_id = txid_current()
     and token.backend_pid = pg_backend_pid();
  raise;
end;
$function$;

revoke all on function public.reassign_opportunity_email_thread_guarded(
  uuid, uuid, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.reassign_opportunity_email_thread_guarded(
  uuid, uuid, text, uuid, text
) to service_role;

-- --------------------------------------------------------------------------
-- Current-actor wrappers used by RLS. The underlying actor-aware helpers stay
-- private and ungrantable so no caller can choose a different OPS identity.
-- --------------------------------------------------------------------------

create or replace function private.current_user_can_view_client(
  p_client_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.user_can_view_client(
    private.get_current_user_id(),
    p_client_id
  );
$function$;

revoke all on function private.current_user_can_view_client(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_view_client(uuid)
  to anon, authenticated;

create or replace function private.current_user_can_edit_client(
  p_client_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.user_can_edit_client(
    private.get_current_user_id(),
    p_client_id
  );
$function$;

revoke all on function private.current_user_can_edit_client(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_edit_client(uuid)
  to anon, authenticated;

create or replace function private.current_user_can_view_email_thread(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_connection_id uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
begin
  if v_actor_user_id is null
    or private.get_user_company_id() is distinct from p_company_id
  then
    return false;
  end if;
  if p_opportunity_id is not null
    and not private.user_can_view_opportunity(
      v_actor_user_id,
      p_opportunity_id
    )
  then
    return false;
  end if;
  return private.user_can_view_inbox_connection(
    v_actor_user_id,
    p_company_id,
    p_connection_id,
    p_opportunity_id
  );
end;
$function$;

revoke all on function private.current_user_can_view_email_thread(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_view_email_thread(uuid, uuid, uuid)
  to anon, authenticated;

create or replace function private.current_user_can_view_email_thread_correction(
  p_company_id uuid,
  p_thread_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select coalesce((
    select private.current_user_can_view_email_thread(
      et.company_id,
      et.opportunity_id,
      et.connection_id
    )
      from public.email_threads et
     where et.id = p_thread_id
       and et.company_id = p_company_id
  ), false);
$function$;

revoke all on function private.current_user_can_view_email_thread_correction(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_view_email_thread_correction(uuid, uuid)
  to anon, authenticated;

create or replace function private.current_user_can_edit_email_thread_correction(
  p_company_id uuid,
  p_thread_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select coalesce((
    select case
      when et.opportunity_id is null then
        private.user_can_send_inbox_connection(
          private.get_current_user_id(),
          et.company_id,
          et.connection_id,
          null
        )
      else private.user_can_send_opportunity_inbox(
        private.get_current_user_id(),
        et.opportunity_id,
        et.connection_id
      )
    end
      from public.email_threads et
     where et.id = p_thread_id
       and et.company_id = p_company_id
  ), false);
$function$;

revoke all on function private.current_user_can_edit_email_thread_correction(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_edit_email_thread_correction(uuid, uuid)
  to anon, authenticated;

-- --------------------------------------------------------------------------
-- Parent and child RLS. Existing company-isolation policies remain the
-- permissive tenant gate; these restrictive policies add the entity gate.
-- --------------------------------------------------------------------------

drop policy if exists role_scope_read on public.opportunities;
create policy role_scope_read
  on public.opportunities
  as restrictive
  for select
  to public
  using (
    private.current_user_can_view_opportunity(id)
    and (
      merged_into_opportunity_id is null
      or private.current_user_can_view_opportunity(merged_into_opportunity_id)
    )
  );

drop policy if exists opportunity_assignment_events_authorized_select
  on public.opportunity_assignment_events;
drop policy if exists authorized_lead_select
  on public.opportunity_assignment_events;
create policy authorized_lead_select
  on public.opportunity_assignment_events
  for select
  to public
  using (private.current_user_can_view_opportunity(opportunity_id));

drop policy if exists opportunity_assignment_suggestions_authorized_select
  on public.opportunity_assignment_suggestions;
drop policy if exists authorized_lead_select
  on public.opportunity_assignment_suggestions;
create policy authorized_lead_select
  on public.opportunity_assignment_suggestions
  for select
  to public
  using (private.current_user_can_view_opportunity(opportunity_id));

drop policy if exists opportunity_conversion_events_authorized_select
  on public.opportunity_conversion_events;
drop policy if exists authorized_lead_select
  on public.opportunity_conversion_events;
create policy authorized_lead_select
  on public.opportunity_conversion_events
  for select
  to public
  using (private.current_user_can_view_opportunity(opportunity_id));

drop policy if exists opportunity_assignment_deliveries_recipient_select
  on public.opportunity_assignment_deliveries;
drop policy if exists recipient_select
  on public.opportunity_assignment_deliveries;
create policy recipient_select
  on public.opportunity_assignment_deliveries
  for select
  to public
  using (recipient_user_id = private.get_current_user_id());

grant select on table public.opportunity_assignment_events,
  public.opportunity_assignment_suggestions,
  public.opportunity_conversion_events,
  public.opportunity_assignment_deliveries
  to anon, authenticated;

drop policy if exists role_scope_insert on public.stage_transitions;
drop policy if exists role_scope_update on public.stage_transitions;
drop policy if exists role_scope_delete on public.stage_transitions;
drop policy if exists assigned_lead_scope_select on public.stage_transitions;
drop policy if exists assigned_lead_scope_insert on public.stage_transitions;
create policy assigned_lead_scope_select
  on public.stage_transitions
  as restrictive
  for select
  to public
  using (private.current_user_can_view_opportunity(opportunity_id));
create policy assigned_lead_scope_insert
  on public.stage_transitions
  as restrictive
  for insert
  to public
  with check (private.current_user_can_edit_opportunity(opportunity_id));
revoke update, delete on table public.stage_transitions
  from anon, authenticated, service_role;

drop policy if exists assigned_lead_scope_select on public.activities;
drop policy if exists assigned_lead_scope_insert on public.activities;
drop policy if exists assigned_lead_scope_update on public.activities;
drop policy if exists assigned_lead_scope_delete on public.activities;
create policy assigned_lead_scope_select
  on public.activities
  as restrictive
  for select
  to public
  using (
    private.current_user_can_view_activity(
      company_id,
      opportunity_id,
      project_id,
      email_connection_id,
      email_thread_id,
      type
    )
  );
create policy assigned_lead_scope_insert
  on public.activities
  as restrictive
  for insert
  to public
  with check (
    private.current_user_can_edit_activity(
      company_id,
      opportunity_id,
      project_id,
      email_connection_id,
      email_thread_id,
      type
    )
  );
create policy assigned_lead_scope_update
  on public.activities
  as restrictive
  for update
  to public
  using (
    private.current_user_can_edit_activity(
      company_id,
      opportunity_id,
      project_id,
      email_connection_id,
      email_thread_id,
      type
    )
  )
  with check (
    private.current_user_can_edit_activity(
      company_id,
      opportunity_id,
      project_id,
      email_connection_id,
      email_thread_id,
      type
    )
  );
create policy assigned_lead_scope_delete
  on public.activities
  as restrictive
  for delete
  to public
  using (
    private.current_user_can_edit_activity(
      company_id,
      opportunity_id,
      project_id,
      email_connection_id,
      email_thread_id,
      type
    )
  );

drop policy if exists assigned_parent_scope_select on public.activity_comments;
drop policy if exists assigned_parent_scope_insert on public.activity_comments;
drop policy if exists assigned_parent_scope_update on public.activity_comments;
drop policy if exists assigned_parent_scope_delete on public.activity_comments;
create policy assigned_parent_scope_select
  on public.activity_comments
  as restrictive
  for select
  to public
  using (
    private.current_user_can_view_activity_comment(company_id, activity_id)
  );
create policy assigned_parent_scope_insert
  on public.activity_comments
  as restrictive
  for insert
  to public
  with check (
    private.current_user_can_edit_activity_comment(company_id, activity_id)
  );
create policy assigned_parent_scope_update
  on public.activity_comments
  as restrictive
  for update
  to public
  using (
    private.current_user_can_edit_activity_comment(company_id, activity_id)
  )
  with check (
    private.current_user_can_edit_activity_comment(company_id, activity_id)
  );
create policy assigned_parent_scope_delete
  on public.activity_comments
  as restrictive
  for delete
  to public
  using (
    private.current_user_can_edit_activity_comment(company_id, activity_id)
  );

drop policy if exists assigned_lead_scope_select on public.follow_ups;
drop policy if exists assigned_lead_scope_insert on public.follow_ups;
drop policy if exists assigned_lead_scope_update on public.follow_ups;
drop policy if exists assigned_lead_scope_delete on public.follow_ups;
create policy assigned_lead_scope_select
  on public.follow_ups
  as restrictive
  for select
  to public
  using (
    opportunity_id is null
    or private.current_user_can_view_opportunity(opportunity_id)
  );
create policy assigned_lead_scope_insert
  on public.follow_ups
  as restrictive
  for insert
  to public
  with check (
    opportunity_id is null
    or private.current_user_can_edit_opportunity(opportunity_id)
  );
create policy assigned_lead_scope_update
  on public.follow_ups
  as restrictive
  for update
  to public
  using (
    opportunity_id is null
    or private.current_user_can_edit_opportunity(opportunity_id)
  )
  with check (
    opportunity_id is null
    or private.current_user_can_edit_opportunity(opportunity_id)
  );
create policy assigned_lead_scope_delete
  on public.follow_ups
  as restrictive
  for delete
  to public
  using (
    opportunity_id is null
    or private.current_user_can_edit_opportunity(opportunity_id)
  );

drop policy if exists assigned_lead_scope_select on public.site_visits;
drop policy if exists assigned_lead_scope_insert on public.site_visits;
drop policy if exists assigned_lead_scope_update on public.site_visits;
drop policy if exists assigned_lead_scope_delete on public.site_visits;
create policy assigned_lead_scope_select
  on public.site_visits
  as restrictive
  for select
  to public
  using (
    private.current_user_can_view_site_visit(
      company_id,
      opportunity_id,
      project_id,
      project_ref
    )
  );
create policy assigned_lead_scope_insert
  on public.site_visits
  as restrictive
  for insert
  to public
  with check (
    private.current_user_can_edit_site_visit(
      company_id,
      opportunity_id,
      project_id,
      project_ref
    )
  );
create policy assigned_lead_scope_update
  on public.site_visits
  as restrictive
  for update
  to public
  using (
    private.current_user_can_edit_site_visit(
      company_id,
      opportunity_id,
      project_id,
      project_ref
    )
  )
  with check (
    private.current_user_can_edit_site_visit(
      company_id,
      opportunity_id,
      project_id,
      project_ref
    )
  );
create policy assigned_lead_scope_delete
  on public.site_visits
  as restrictive
  for delete
  to public
  using (
    private.current_user_can_edit_site_visit(
      company_id,
      opportunity_id,
      project_id,
      project_ref
    )
  );

drop policy if exists assigned_lead_scope_select on public.deck_designs;
drop policy if exists assigned_lead_scope_insert on public.deck_designs;
drop policy if exists assigned_lead_scope_update on public.deck_designs;
drop policy if exists assigned_lead_scope_delete on public.deck_designs;
create policy assigned_lead_scope_select
  on public.deck_designs
  as restrictive
  for select
  to public
  using (
    private.current_user_can_view_deck_design(
      company_id,
      opportunity_id,
      project_id
    )
  );
create policy assigned_lead_scope_insert
  on public.deck_designs
  as restrictive
  for insert
  to public
  with check (
    private.current_user_can_edit_deck_design(
      company_id,
      opportunity_id,
      project_id,
      'deck_builder.create'
    )
  );
create policy assigned_lead_scope_update
  on public.deck_designs
  as restrictive
  for update
  to public
  using (
    private.current_user_can_edit_deck_design(
      company_id,
      opportunity_id,
      project_id,
      'deck_builder.edit'
    )
  )
  with check (
    private.current_user_can_edit_deck_design(
      company_id,
      opportunity_id,
      project_id,
      'deck_builder.edit'
    )
  );
create policy assigned_lead_scope_delete
  on public.deck_designs
  as restrictive
  for delete
  to public
  using (
    private.current_user_can_edit_deck_design(
      company_id,
      opportunity_id,
      project_id,
      'deck_builder.edit'
    )
  );

drop policy if exists lead_field_provenance_company_select
  on public.lead_field_provenance;
drop policy if exists lead_field_provenance_company_insert
  on public.lead_field_provenance;
drop policy if exists lead_field_provenance_company_update
  on public.lead_field_provenance;
drop policy if exists assigned_lead_scope_select on public.lead_field_provenance;
drop policy if exists assigned_lead_scope_insert on public.lead_field_provenance;
drop policy if exists assigned_lead_scope_update on public.lead_field_provenance;
create policy assigned_lead_scope_select
  on public.lead_field_provenance
  for select
  to public
  using (
    company_id = private.get_user_company_id()
    and (
      (entity_type = 'opportunity'
        and private.current_user_can_view_opportunity(entity_id))
      or (entity_type = 'client'
        and private.current_user_can_view_client(entity_id))
    )
  );
create policy assigned_lead_scope_insert
  on public.lead_field_provenance
  for insert
  to public
  with check (
    company_id = private.get_user_company_id()
    and (
      (entity_type = 'opportunity'
        and private.current_user_can_edit_opportunity(entity_id))
      or (entity_type = 'client'
        and private.current_user_can_edit_client(entity_id))
    )
  );
create policy assigned_lead_scope_update
  on public.lead_field_provenance
  for update
  to public
  using (
    company_id = private.get_user_company_id()
    and (
      (entity_type = 'opportunity'
        and private.current_user_can_edit_opportunity(entity_id))
      or (entity_type = 'client'
        and private.current_user_can_edit_client(entity_id))
    )
  )
  with check (
    company_id = private.get_user_company_id()
    and (
      (entity_type = 'opportunity'
        and private.current_user_can_edit_opportunity(entity_id))
      or (entity_type = 'client'
        and private.current_user_can_edit_client(entity_id))
    )
  );

drop policy if exists opportunity_lifecycle_state_company_select
  on public.opportunity_lifecycle_state;
drop policy if exists authorized_lead_select on public.opportunity_lifecycle_state;
create policy authorized_lead_select
  on public.opportunity_lifecycle_state
  for select
  to public
  using (private.current_user_can_view_opportunity(opportunity_id));

drop policy if exists opportunity_lifecycle_action_audit_company_select
  on public.opportunity_lifecycle_action_audit;
drop policy if exists authorized_lead_select on public.opportunity_lifecycle_action_audit;
create policy authorized_lead_select
  on public.opportunity_lifecycle_action_audit
  for select
  to public
  using (private.current_user_can_view_opportunity(opportunity_id));

drop policy if exists opportunity_dispositions_company_select
  on public.opportunity_dispositions;
drop policy if exists authorized_lead_select on public.opportunity_dispositions;
create policy authorized_lead_select
  on public.opportunity_dispositions
  for select
  to public
  using (
    private.current_user_can_view_opportunity(opportunity_id)
    and (
      merged_into_opportunity_id is null
      or private.current_user_can_view_opportunity(merged_into_opportunity_id)
    )
    and (
      converted_project_ref is null
      or private.current_user_can_view_project_reference(
        null,
        converted_project_ref
      )
    )
  );

drop policy if exists opportunity_merges_company_select
  on public.opportunity_merges;
drop policy if exists authorized_lead_select on public.opportunity_merges;
create policy authorized_lead_select
  on public.opportunity_merges
  for select
  to public
  using (
    private.current_user_can_view_opportunity_merge(
      company_id,
      entity_type,
      winner_id,
      loser_id
    )
  );

drop policy if exists assigned_entity_scope_select on public.duplicate_reviews;
drop policy if exists assigned_entity_scope_insert on public.duplicate_reviews;
drop policy if exists assigned_entity_scope_update on public.duplicate_reviews;
create policy assigned_entity_scope_select
  on public.duplicate_reviews
  as restrictive
  for select
  to public
  using (
    private.current_user_can_view_duplicate_review(
      company_id,
      entity_type,
      entity_a_id,
      entity_b_id
    )
  );
create policy assigned_entity_scope_insert
  on public.duplicate_reviews
  as restrictive
  for insert
  to public
  with check (
    private.current_user_can_view_duplicate_review(
      company_id,
      entity_type,
      entity_a_id,
      entity_b_id
    )
  );
create policy assigned_entity_scope_update
  on public.duplicate_reviews
  as restrictive
  for update
  to public
  using (
    private.current_user_can_view_duplicate_review(
      company_id,
      entity_type,
      entity_a_id,
      entity_b_id
    )
  )
  with check (
    private.current_user_can_view_duplicate_review(
      company_id,
      entity_type,
      entity_a_id,
      entity_b_id
    )
  );

drop policy if exists lead_inbox_scope_select
  on public.opportunity_correspondence_events;
drop policy if exists opportunity_correspondence_events_company_select
  on public.opportunity_correspondence_events;
create policy lead_inbox_scope_select
  on public.opportunity_correspondence_events
  for select
  to public
  using (
    private.current_user_can_view_opportunity_inbox(
      opportunity_id,
      connection_id
    )
  );

drop policy if exists lead_inbox_scope_select
  on public.opportunity_follow_up_drafts;
drop policy if exists opportunity_follow_up_drafts_company_select
  on public.opportunity_follow_up_drafts;
create policy lead_inbox_scope_select
  on public.opportunity_follow_up_drafts
  for select
  to public
  using (
    private.current_user_can_send_opportunity_inbox(
      opportunity_id,
      connection_id
    )
  );

drop policy if exists lead_inbox_scope_select on public.email_threads;
create policy lead_inbox_scope_select
  on public.email_threads
  as restrictive
  for select
  to public
  using (
    private.current_user_can_view_email_thread(
      company_id,
      opportunity_id,
      connection_id
    )
  );

drop policy if exists lead_inbox_scope_select
  on public.opportunity_email_threads;
create policy lead_inbox_scope_select
  on public.opportunity_email_threads
  as restrictive
  for select
  to public
  using (
    private.current_user_can_view_opportunity_inbox(
      opportunity_id,
      connection_id
    )
  );

drop policy if exists corrections_company_scope
  on public.email_thread_category_corrections;
drop policy if exists lead_inbox_scope_select
  on public.email_thread_category_corrections;
drop policy if exists lead_inbox_scope_insert
  on public.email_thread_category_corrections;
drop policy if exists lead_inbox_scope_update
  on public.email_thread_category_corrections;
drop policy if exists lead_inbox_scope_delete
  on public.email_thread_category_corrections;
create policy lead_inbox_scope_select
  on public.email_thread_category_corrections
  for select
  to public
  using (
    private.current_user_can_view_email_thread_correction(company_id, thread_id)
  );
create policy lead_inbox_scope_insert
  on public.email_thread_category_corrections
  for insert
  to public
  with check (
    private.current_user_can_edit_email_thread_correction(company_id, thread_id)
    and user_id = private.get_current_user_id()
  );
create policy lead_inbox_scope_update
  on public.email_thread_category_corrections
  for update
  to public
  using (
    private.current_user_can_edit_email_thread_correction(company_id, thread_id)
    and user_id = private.get_current_user_id()
  )
  with check (
    private.current_user_can_edit_email_thread_correction(company_id, thread_id)
    and user_id = private.get_current_user_id()
  );
create policy lead_inbox_scope_delete
  on public.email_thread_category_corrections
  for delete
  to public
  using (
    private.current_user_can_edit_email_thread_correction(company_id, thread_id)
    and user_id = private.get_current_user_id()
  );

revoke insert, update, delete on table public.email_threads
  from anon, authenticated;
revoke insert, update, delete on table public.opportunity_email_threads
  from anon, authenticated;
revoke insert, update, delete on table public.opportunity_correspondence_events,
  public.opportunity_follow_up_drafts,
  public.opportunity_lifecycle_state,
  public.opportunity_lifecycle_action_audit,
  public.opportunity_dispositions,
  public.opportunity_merges
  from anon, authenticated;

-- Provider orchestration and attachment inspection remain server-only. Lead
-- access never implies direct access to a provider queue or stored blob row.
revoke all on table public.ai_draft_history
  from public, anon, authenticated;
revoke all on table public.pending_auto_sends
  from public, anon, authenticated;
revoke all on table public.email_attachments
  from public, anon, authenticated;
revoke all on table public.email_outbound_learning_queue
  from public, anon, authenticated;
revoke all on table public.email_attachment_scans
  from public, anon, authenticated;
revoke all on table public.email_attachment_inspection_jobs
  from public, anon, authenticated;
revoke all on table public.attachment_inspections
  from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- Whitelisted assigned-lead context. This is the only bridge into client and
-- estimate data: it deliberately returns selected fields, never raw rows.
-- --------------------------------------------------------------------------

create or replace function public.get_opportunity_assigned_context(
  p_opportunity_id uuid
) returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $function$
declare
  v_opportunity public.opportunities%rowtype;
  v_contact jsonb;
  v_estimates jsonb;
  v_activities jsonb;
  v_follow_ups jsonb;
  v_site_visits jsonb;
  v_deck_designs jsonb;
  v_lifecycle jsonb;
  v_correspondence jsonb;
begin
  select *
    into v_opportunity
    from public.opportunities o
   where o.id = p_opportunity_id
     and o.deleted_at is null;
  if not found
    or not private.current_user_can_view_opportunity(p_opportunity_id)
    or (
      v_opportunity.merged_into_opportunity_id is not null
      and not private.current_user_can_view_opportunity(
        v_opportunity.merged_into_opportunity_id
      )
    )
  then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  select jsonb_build_object(
      'id', c.id,
      'name', coalesce(v_opportunity.contact_name, c.name),
      'email', coalesce(v_opportunity.contact_email, c.email),
      'phone', coalesce(v_opportunity.contact_phone, c.phone_number),
      'address', coalesce(v_opportunity.address, c.address),
      'profile_image_url', c.profile_image_url
    )
    into v_contact
    from public.clients c
   where c.id = coalesce(v_opportunity.client_ref, v_opportunity.client_id)
     and c.company_id = v_opportunity.company_id
     and c.deleted_at is null;
  if v_contact is null then
    v_contact := jsonb_build_object(
      'id', null,
      'name', v_opportunity.contact_name,
      'email', v_opportunity.contact_email,
      'phone', v_opportunity.contact_phone,
      'address', v_opportunity.address,
      'profile_image_url', null
    );
  end if;

  select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'estimate_number', e.estimate_number,
        'title', e.title,
        'status', e.status,
        'subtotal', e.subtotal,
        'tax_amount', e.tax_amount,
        'total', e.total,
        'issue_date', e.issue_date,
        'expiration_date', e.expiration_date,
        'sent_at', e.sent_at,
        'approved_at', e.approved_at
      ) order by e.created_at desc, e.id
    ), '[]'::jsonb)
    into v_estimates
    from public.estimates e
   where e.opportunity_id = p_opportunity_id
     and e.company_id = v_opportunity.company_id
     and e.deleted_at is null;

  select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'type', a.type,
        'subject', a.subject,
        'content', a.content,
        'body_text', a.body_text,
        'direction', a.direction,
        'outcome', a.outcome,
        'duration_minutes', a.duration_minutes,
        'has_attachments', a.has_attachments,
        'created_at', a.created_at
      ) order by a.created_at desc, a.id
    ), '[]'::jsonb)
    into v_activities
    from public.activities a
   where a.opportunity_id = p_opportunity_id
     and a.company_id = v_opportunity.company_id
     and private.current_user_can_view_activity(
       a.company_id,
       a.opportunity_id,
       a.project_id,
       a.email_connection_id,
       a.email_thread_id,
       a.type
     );

  select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'title', f.title,
        'description', f.description,
        'type', f.type,
        'status', f.status,
        'due_at', f.due_at,
        'reminder_at', f.reminder_at,
        'completed_at', f.completed_at,
        'completion_notes', f.completion_notes,
        'assigned_to', f.assigned_to,
        'created_at', f.created_at
      ) order by f.due_at, f.id
    ), '[]'::jsonb)
    into v_follow_ups
    from public.follow_ups f
   where f.opportunity_id = p_opportunity_id
     and f.company_id = v_opportunity.company_id;

  select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', sv.id,
        'scheduled_at', sv.scheduled_at,
        'duration_minutes', sv.duration_minutes,
        'status', sv.status,
        'notes', sv.notes,
        'internal_notes', sv.internal_notes,
        'measurements', sv.measurements,
        'photos', coalesce(sv.photos, '{}'::text[]),
        'completed_at', sv.completed_at
      ) order by sv.scheduled_at, sv.id
    ), '[]'::jsonb)
    into v_site_visits
    from public.site_visits sv
   where sv.opportunity_id = p_opportunity_id
     and private.try_parse_uuid(sv.company_id) = v_opportunity.company_id;

  select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', dd.id,
        'title', dd.title,
        'thumbnail_url', dd.thumbnail_url,
        'version', dd.version,
        'updated_at', dd.updated_at
      ) order by dd.updated_at desc nulls last, dd.id
    ), '[]'::jsonb)
    into v_deck_designs
    from public.deck_designs dd
   where dd.opportunity_id = p_opportunity_id
     and dd.company_id = v_opportunity.company_id
     and dd.deleted_at is null;

  select jsonb_build_object(
      'last_meaningful_at', ls.last_meaningful_at,
      'last_meaningful_direction', ls.last_meaningful_direction,
      'unanswered_follow_up_count', ls.unanswered_follow_up_count,
      'stale_status', ls.stale_status,
      'stale_status_at', ls.stale_status_at,
      'protected_until', ls.protected_until,
      'updated_at', ls.updated_at
    )
    into v_lifecycle
    from public.opportunity_lifecycle_state ls
   where ls.opportunity_id = p_opportunity_id
     and ls.company_id = v_opportunity.company_id;

  select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', ce.id,
        'activity_id', ce.activity_id,
        'direction', ce.direction,
        'party_role', ce.party_role,
        'is_meaningful', ce.is_meaningful,
        'noise_reason', ce.noise_reason,
        'subject', ce.subject,
        'occurred_at', ce.occurred_at
      ) order by ce.occurred_at desc, ce.id
    ), '[]'::jsonb)
    into v_correspondence
    from public.opportunity_correspondence_events ce
   where ce.opportunity_id = p_opportunity_id
     and ce.company_id = v_opportunity.company_id
     and private.current_user_can_view_opportunity_inbox(
       ce.opportunity_id,
       ce.connection_id
     );

  return jsonb_build_object(
    'lead', jsonb_build_object(
      'id', v_opportunity.id,
      'title', v_opportunity.title,
      'description', v_opportunity.description,
      'stage', v_opportunity.stage,
      'priority', v_opportunity.priority,
      'estimated_value', v_opportunity.estimated_value,
      'expected_close_date', v_opportunity.expected_close_date,
      'source', v_opportunity.source,
      'tags', coalesce(v_opportunity.tags, '{}'::text[]),
      'address', v_opportunity.address,
      'created_at', v_opportunity.created_at,
      'updated_at', v_opportunity.updated_at
    ),
    'contact', v_contact,
    'estimate_summaries', v_estimates,
    'activities', v_activities,
    'follow_ups', v_follow_ups,
    'site_visits', v_site_visits,
    'deck_designs', v_deck_designs,
    'lifecycle', v_lifecycle,
    'correspondence', v_correspondence
  );
end;
$function$;

revoke all on function public.get_opportunity_assigned_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_opportunity_assigned_context(uuid)
  to anon, authenticated;

-- --------------------------------------------------------------------------
-- Guarded picker data. Assignment itself remains exclusively in the 160000
-- guarded assignment RPC; this function only returns eligible OPS identities.
-- --------------------------------------------------------------------------

create or replace function public.list_opportunity_assignment_candidates(
  p_opportunity_id uuid
) returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_opportunity public.opportunities%rowtype;
  v_scope text;
  v_candidates jsonb := '[]'::jsonb;
  v_can_unassign boolean := false;
begin
  select *
    into v_opportunity
    from public.opportunities o
   where o.id = p_opportunity_id
     and o.deleted_at is null;
  if not found
    or not private.current_user_can_assign_opportunity(p_opportunity_id)
  then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  v_scope := private.effective_pipeline_scope_for_user(
    v_actor_user_id,
    v_opportunity.company_id,
    'pipeline.assign'
  );

  if v_scope = 'all' then
    v_can_unassign := true;
  end if;

  if v_scope = 'assigned'
    and (
      v_opportunity.archived_at is not null
      or v_opportunity.stage in ('won', 'lost', 'discarded')
    )
  then
    return jsonb_build_object(
      'can_unassign', false,
      'candidates', '[]'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', u.id,
        'first_name', u.first_name,
        'last_name', u.last_name,
        'profile_image_url', u.profile_image_url,
        'user_color', u.user_color
      ) order by lower(coalesce(u.first_name, '')),
                 lower(coalesce(u.last_name, '')),
                 u.id
    ), '[]'::jsonb)
    into v_candidates
    from public.users u
   where u.company_id = v_opportunity.company_id
     and u.deleted_at is null
     and coalesce(u.is_active, false)
     and public.has_permission(
       u.id,
       'pipeline.view',
       'assigned'
     );

  return jsonb_build_object(
    'can_unassign', v_can_unassign,
    'candidates', v_candidates
  );
end;
$function$;

revoke all on function public.list_opportunity_assignment_candidates(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_opportunity_assignment_candidates(uuid)
  to anon, authenticated;

commit;
