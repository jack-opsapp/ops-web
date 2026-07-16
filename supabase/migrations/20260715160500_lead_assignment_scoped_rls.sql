-- ============================================================================
-- CANONICAL SCOPED OPPORTUNITY AUTHORIZATION
--
-- Makes the granular pipeline permissions authoritative for opportunity rows,
-- caps every write capability by its read prerequisite, and exposes one
-- service-only actor-aware authorization bridge. The existing permissive
-- company isolation policy and guarded assignment trigger remain authoritative.
-- ============================================================================

begin;

-- Return the narrower of two valid pipeline scopes. Any missing or malformed
-- scope fails closed. This helper is private and callable only by its owner.
create or replace function private.least_permissive_pipeline_scope(
  p_left_scope text,
  p_right_scope text
) returns text
language sql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select case
    when p_left_scope is null or p_right_scope is null then null
    when p_left_scope not in ('all', 'assigned') then null
    when p_right_scope not in ('all', 'assigned') then null
    when p_left_scope = 'assigned' or p_right_scope = 'assigned' then 'assigned'
    else 'all'
  end;
$function$;

revoke all on function private.least_permissive_pipeline_scope(text, text)
  from public, anon, authenticated, service_role;

-- Resolve one granular pipeline capability for one canonical OPS user. The
-- existing public.has_permission() engine remains the source of override and
-- role semantics. Legacy pipeline.manage compatibility is considered only by
-- the revoke-safe compatibility helper installed by the assignment foundation.
create or replace function private.effective_pipeline_scope_for_user(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_permission text
) returns text
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
$function$;

revoke all on function private.effective_pipeline_scope_for_user(uuid, uuid, text)
  from public, anon, authenticated, service_role;

create or replace function private.user_can_create_opportunity(
  p_actor_user_id uuid,
  p_company_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select coalesce(
    private.effective_pipeline_scope_for_user(
      p_actor_user_id,
      p_company_id,
      'pipeline.create'
    ) = 'all',
    false
  );
$function$;

revoke all on function private.user_can_create_opportunity(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.user_can_view_opportunity(
  p_actor_user_id uuid,
  p_opportunity_id uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
$function$;

revoke all on function private.user_can_view_opportunity(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.user_can_edit_opportunity(
  p_actor_user_id uuid,
  p_opportunity_id uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
$function$;

revoke all on function private.user_can_edit_opportunity(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.user_can_assign_opportunity(
  p_actor_user_id uuid,
  p_opportunity_id uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
$function$;

revoke all on function private.user_can_assign_opportunity(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.user_can_convert_opportunity(
  p_actor_user_id uuid,
  p_opportunity_id uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
    'pipeline.convert'
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
$function$;

revoke all on function private.user_can_convert_opportunity(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Current-JWT wrappers are the only actor-derived helpers callable from RLS.
create or replace function private.current_user_can_create_opportunity()
returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.user_can_create_opportunity(
    private.get_current_user_id(),
    private.get_user_company_id()
  );
$function$;

revoke all on function private.current_user_can_create_opportunity()
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_create_opportunity()
  to anon, authenticated;

create or replace function private.current_user_can_view_opportunity(
  p_opportunity_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.user_can_view_opportunity(
    private.get_current_user_id(),
    p_opportunity_id
  );
$function$;

revoke all on function private.current_user_can_view_opportunity(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_view_opportunity(uuid)
  to anon, authenticated;

create or replace function private.current_user_can_edit_opportunity(
  p_opportunity_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.user_can_edit_opportunity(
    private.get_current_user_id(),
    p_opportunity_id
  );
$function$;

revoke all on function private.current_user_can_edit_opportunity(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_edit_opportunity(uuid)
  to anon, authenticated;

create or replace function private.current_user_can_assign_opportunity(
  p_opportunity_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.user_can_assign_opportunity(
    private.get_current_user_id(),
    p_opportunity_id
  );
$function$;

revoke all on function private.current_user_can_assign_opportunity(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_assign_opportunity(uuid)
  to anon, authenticated;

create or replace function private.current_user_can_convert_opportunity(
  p_opportunity_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.user_can_convert_opportunity(
    private.get_current_user_id(),
    p_opportunity_id
  );
$function$;

revoke all on function private.current_user_can_convert_opportunity(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_can_convert_opportunity(uuid)
  to anon, authenticated;

-- Make prerequisite intersection canonical for every existing guarded pipeline
-- operation. Every non-pipeline permission retains the exact override-first,
-- widest-role fallback installed by 20260703120000.
create or replace function private.current_user_scope_for(p_permission text)
returns text
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_scope text;
begin
  if p_permission in (
    'pipeline.create',
    'pipeline.view',
    'pipeline.edit',
    'pipeline.assign',
    'pipeline.convert'
  ) then
    return private.effective_pipeline_scope_for_user(
      private.get_current_user_id(),
      private.get_user_company_id(),
      p_permission
    );
  end if;

  with me as (
    select private.get_current_user_id() as id,
           private.get_user_company_id() as company_id
  ),
  o as (
    select upo.granted, upo.scope
      from me
      join public.user_permission_overrides upo
        on upo.user_id = me.id
       and upo.permission = p_permission
       and upo.company_id = me.company_id
     limit 1
  ),
  r as (
    select rp.scope
      from me
      join public.user_roles ur on ur.user_id = me.id::text
      join public.role_permissions rp
        on rp.role_id = ur.role_id
       and rp.permission = p_permission
     order by case rp.scope
       when 'all' then 1
       when 'assigned' then 2
       when 'own' then 3
       else 4
     end
     limit 1
  )
  select case
    when exists (select 1 from o where not granted) then null
    when exists (select 1 from o where granted and scope is not null)
      then (select scope from o)
    else (select scope from r)
  end
    into v_scope;

  return v_scope;
end;
$function$;

-- Preserve the pre-existing ACL on current_user_scope_for. CREATE OR REPLACE
-- does not reset it; this migration intentionally changes only its semantics.

-- Service-role code may ask the canonical authorization layer about a concrete
-- OPS user, but it cannot supply a company or request an unknown action.
create or replace function public.authorize_opportunity_action_as_system(
  p_actor_user_id uuid,
  p_opportunity_id uuid,
  p_action text
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  if p_action is null or p_action not in ('view', 'edit', 'assign', 'convert') then
    raise exception 'invalid_opportunity_action'
      using errcode = '22023';
  end if;

  case p_action
    when 'view' then return private.user_can_view_opportunity(
      p_actor_user_id,
      p_opportunity_id
    );
    when 'edit' then return private.user_can_edit_opportunity(
      p_actor_user_id,
      p_opportunity_id
    );
    when 'assign' then return private.user_can_assign_opportunity(
      p_actor_user_id,
      p_opportunity_id
    );
    when 'convert' then return private.user_can_convert_opportunity(
      p_actor_user_id,
      p_opportunity_id
    );
  end case;

  return false;
end;
$function$;

revoke all on function public.authorize_opportunity_action_as_system(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.authorize_opportunity_action_as_system(uuid, uuid, text)
  to service_role;

-- Refuse to install scoped update policies if the foundation's direct-write
-- guard is missing. This keeps assigned_to and assignment_version RPC-only.
do $do$
begin
  if not exists (
    select 1
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid = t.tgrelid
      join pg_catalog.pg_namespace table_namespace
        on table_namespace.oid = c.relnamespace
      join pg_catalog.pg_proc p on p.oid = t.tgfoid
      join pg_catalog.pg_namespace function_namespace
        on function_namespace.oid = p.pronamespace
     where t.tgname = 'trg_opportunities_guard_assignment_mutation'
       and not t.tgisinternal
       and table_namespace.nspname = 'public'
       and c.relname = 'opportunities'
       and function_namespace.nspname = 'private'
       and p.proname = 'guard_opportunity_assignment_mutation'
  ) then
    raise exception 'lead_assignment_guard_missing';
  end if;
end
$do$;

-- Replace only the restrictive permission layer. The existing permissive
-- company_isolation policy remains in place and must also pass.
drop policy if exists role_scope_read on public.opportunities;
create policy role_scope_read
  on public.opportunities
  as restrictive
  for select
  to public
  using (private.current_user_can_view_opportunity(id));

drop policy if exists role_scope_insert on public.opportunities;
create policy role_scope_insert
  on public.opportunities
  as restrictive
  for insert
  to public
  with check (private.current_user_can_create_opportunity());

drop policy if exists role_scope_update on public.opportunities;
create policy role_scope_update
  on public.opportunities
  as restrictive
  for update
  to public
  using (private.current_user_can_edit_opportunity(id))
  with check (private.current_user_can_edit_opportunity(id));

drop policy if exists role_scope_delete on public.opportunities;
create policy role_scope_delete
  on public.opportunities
  as restrictive
  for delete
  to public
  using (private.current_user_can_edit_opportunity(id));

-- Assignment delivery rows are addressed to both sides of a transfer. Realtime
-- lets either recipient invalidate its local lead list even when the changed
-- opportunity is no longer visible under the new assignment.
do $do$
begin
  if exists (
    select 1
      from pg_catalog.pg_publication
     where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
      from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'opportunity_assignment_deliveries'
  ) then
    execute 'alter publication supabase_realtime add table public.opportunity_assignment_deliveries';
  end if;
end
$do$;

-- Actor-aware project authorization for conversion preflight and link-existing.
-- These helpers intentionally ignore projects.created_by, projects.team_member_ids,
-- shared clients, and contact details. Active task assignment is the only write
-- membership; a live note mention adds read access only.
create or replace function private.user_can_view_project(
  p_actor_user_id uuid,
  p_project_id uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
$function$;

revoke all on function private.user_can_view_project(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.user_can_edit_project(
  p_actor_user_id uuid,
  p_project_id uuid
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
$function$;

revoke all on function private.user_can_edit_project(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.user_can_link_opportunity_to_project(
  p_actor_user_id uuid,
  p_project_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.user_can_view_project(p_actor_user_id, p_project_id)
     and private.user_can_edit_project(p_actor_user_id, p_project_id);
$function$;

revoke all on function private.user_can_link_opportunity_to_project(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Validate the only two actorless conversion sources against durable provider
-- rows. UUID parsing is deliberately non-throwing and no mailbox address is an
-- identity or authorization input.
create or replace function private.valid_actorless_opportunity_conversion_evidence(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_source_path text,
  p_evidence jsonb
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_connection_id uuid;
  v_email_thread_id uuid;
begin
  if jsonb_typeof(p_evidence) is distinct from 'object' then
    return false;
  end if;

  v_connection_id := private.try_parse_uuid(p_evidence ->> 'connection_id');
  if v_connection_id is null then
    return false;
  end if;

  if p_source_path = 'email_accept' then
    if not (
      p_evidence ?& array[
        'connection_id',
        'email_thread_id',
        'provider_thread_id',
        'decision'
      ]
      and p_evidence - array[
        'connection_id',
        'email_thread_id',
        'provider_thread_id',
        'decision'
      ]::text[] = '{}'::jsonb
      and p_evidence ->> 'decision' = 'auto_advance_won'
      and nullif(p_evidence ->> 'provider_thread_id', '') is not null
    ) then
      return false;
    end if;

    v_email_thread_id := private.try_parse_uuid(
      p_evidence ->> 'email_thread_id'
    );
    if v_email_thread_id is null then
      return false;
    end if;

    return exists (
      select 1
        from public.email_connections connection
        join public.email_threads thread
          on thread.connection_id = connection.id
         and thread.company_id = p_company_id
         and thread.id = v_email_thread_id
         and thread.provider_thread_id = p_evidence ->> 'provider_thread_id'
         and thread.opportunity_id = p_opportunity_id
       where connection.id = v_connection_id
         and connection.company_id = p_company_id::text
         and connection.status = 'active'
         and connection.sync_enabled is true
    );
  end if;

  if p_source_path = 'email_likely_won' then
    if not (
      p_evidence ?& array[
        'connection_id',
        'provider_thread_id',
        'provider_message_id',
        'decision'
      ]
      and p_evidence - array[
        'connection_id',
        'provider_thread_id',
        'provider_message_id',
        'decision'
      ]::text[] = '{}'::jsonb
      and p_evidence ->> 'decision' = 'likely_won'
      and nullif(p_evidence ->> 'provider_thread_id', '') is not null
      and nullif(p_evidence ->> 'provider_message_id', '') is not null
    ) then
      return false;
    end if;

    return exists (
      select 1
        from public.email_connections connection
        join public.opportunity_correspondence_events event
          on event.connection_id = connection.id
         and event.company_id = p_company_id
         and event.opportunity_id = p_opportunity_id
         and event.provider_thread_id = p_evidence ->> 'provider_thread_id'
         and event.provider_message_id = p_evidence ->> 'provider_message_id'
         and event.direction = 'inbound'
         and event.party_role = 'customer'
         and event.is_meaningful is true
       where connection.id = v_connection_id
         and connection.company_id = p_company_id::text
         and connection.status = 'active'
         and connection.sync_enabled is true
    );
  end if;

  return false;
end;
$function$;

revoke all on function private.valid_actorless_opportunity_conversion_evidence(
  uuid, uuid, text, jsonb
) from public, anon, authenticated, service_role;

-- Preserve the Task 1 conversion implementation as an uncallable core. The
-- public identity below owns the locked authorization/snapshot boundary and
-- invokes this core in the same transaction after every guard passes.
alter function public.convert_opportunity_to_project(
  uuid, uuid, numeric, text, uuid, text, text, uuid, text, boolean, text, jsonb,
  bigint
) set schema private;
alter function private.convert_opportunity_to_project(
  uuid, uuid, numeric, text, uuid, text, text, uuid, text, boolean, text, jsonb,
  bigint
) rename to execute_opportunity_conversion_core;
revoke all on function private.execute_opportunity_conversion_core(
  uuid, uuid, numeric, text, uuid, text, text, uuid, text, boolean, text, jsonb,
  bigint
) from public, anon, authenticated, service_role;

create or replace function public.convert_opportunity_to_project(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_actual_value numeric default null::numeric,
  p_expected_stage text default null::text,
  p_decided_by uuid default null::uuid,
  p_notes text default null::text,
  p_title_override text default null::text,
  p_link_to_project_id uuid default null::uuid,
  p_source_path text default null::text,
  p_win_opportunity boolean default true,
  p_project_status text default null::text,
  p_evidence jsonb default '{}'::jsonb,
  p_expected_assignment_version bigint default null::bigint
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_opp public.opportunities%rowtype;
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_actor_user_id uuid;
  v_actor_company_id uuid;
  v_result jsonb;
  v_project_id uuid;
  v_project_accessible boolean := false;
begin
  if p_company_id is null or p_opportunity_id is null then
    raise exception 'company and opportunity ids are required'
      using errcode = '22023';
  end if;

  select *
    into v_opp
    from public.opportunities o
   where o.id = p_opportunity_id
     and o.company_id = p_company_id
   for update;

  if not found or v_opp.deleted_at is not null then
    raise exception 'opportunity_not_found'
      using errcode = 'P0002';
  end if;

  if v_is_service then
    if p_expected_assignment_version is null
      or p_expected_assignment_version < 0
    then
      raise exception 'invalid_assignment_snapshot'
        using errcode = '22023';
    end if;

    if p_decided_by is not null then
      if p_source_path not in ('won_dialog', 'approval_queue')
        or not private.user_can_convert_opportunity(
          p_decided_by,
          p_opportunity_id
        )
      then
        raise exception 'access_denied'
          using errcode = '42501';
      end if;
      v_actor_user_id := p_decided_by;
    else
      if p_source_path not in ('email_accept', 'email_likely_won')
        or not private.valid_actorless_opportunity_conversion_evidence(
          p_company_id,
          p_opportunity_id,
          p_source_path,
          coalesce(p_evidence, '{}'::jsonb)
        )
      then
        raise exception 'access_denied'
          using errcode = '42501';
      end if;
      if p_link_to_project_id is not null then
        raise exception 'project_link_unavailable'
          using errcode = 'P0002';
      end if;
    end if;
  else
    v_actor_user_id := private.get_current_user_id();
    v_actor_company_id := private.get_user_company_id();

    if v_actor_user_id is null
      or v_actor_company_id is distinct from p_company_id
      or p_source_path not in ('won_dialog', 'approval_queue', 'ios')
      or (
        p_decided_by is not null
        and p_decided_by is distinct from v_actor_user_id
      )
      or not private.user_can_convert_opportunity(
        v_actor_user_id,
        p_opportunity_id
      )
    then
      raise exception 'access_denied'
        using errcode = '42501';
    end if;

    -- Only the named legacy iOS seam may omit the snapshot before activation.
    if p_expected_assignment_version is null
      and p_source_path is distinct from 'ios'
    then
      raise exception 'invalid_assignment_snapshot'
        using errcode = '22023';
    end if;
    if p_expected_assignment_version < 0 then
      raise exception 'invalid_assignment_snapshot'
        using errcode = '22023';
    end if;
  end if;

  if p_expected_assignment_version is not null
    and v_opp.assignment_version is distinct from p_expected_assignment_version
  then
    return jsonb_build_object(
      'converted', false,
      'already_converted', false,
      'guard_reason', 'assignment_snapshot_mismatch',
      'opportunity_id', p_opportunity_id,
      'assigned_to', v_opp.assigned_to,
      'assignment_version', v_opp.assignment_version,
      'project_accessible', false
    );
  end if;

  if p_expected_stage is not null
    and v_opp.stage is distinct from p_expected_stage
  then
    return jsonb_build_object(
      'converted', false,
      'already_converted', false,
      'guard_reason', 'snapshot_mismatch',
      'opportunity_id', p_opportunity_id,
      'assigned_to', v_opp.assigned_to,
      'assignment_version', v_opp.assignment_version,
      'project_accessible', false
    );
  end if;

  if p_link_to_project_id is not null then
    perform 1
      from public.projects target
     where target.id = p_link_to_project_id
       and target.company_id = p_company_id
       and target.deleted_at is null
     for update;
    if not found
      or v_actor_user_id is null
      or not private.user_can_link_opportunity_to_project(
        v_actor_user_id,
        p_link_to_project_id
      )
    then
      raise exception 'project_link_unavailable'
        using errcode = 'P0002';
    end if;
  end if;

  v_result := private.execute_opportunity_conversion_core(
    p_company_id,
    p_opportunity_id,
    p_actual_value,
    p_expected_stage,
    case when v_actor_user_id is null then null else v_actor_user_id end,
    p_notes,
    p_title_override,
    p_link_to_project_id,
    p_source_path,
    p_win_opportunity,
    p_project_status,
    coalesce(p_evidence, '{}'::jsonb),
    p_expected_assignment_version
  );

  v_project_id := private.try_parse_uuid(v_result ->> 'project_id');
  if v_actor_user_id is not null and v_project_id is not null then
    v_project_accessible := private.user_can_view_project(
      v_actor_user_id,
      v_project_id
    );
  end if;

  return v_result || jsonb_build_object(
    'assigned_to', v_opp.assigned_to,
    'assignment_version', v_opp.assignment_version,
    'project_accessible', coalesce(v_project_accessible, false)
  );
end;
$function$;

revoke all on function public.convert_opportunity_to_project(
  uuid, uuid, numeric, text, uuid, text, text, uuid, text, boolean, text, jsonb,
  bigint
) from public, anon, authenticated, service_role;
grant execute on function public.convert_opportunity_to_project(
  uuid, uuid, numeric, text, uuid, text, text, uuid, text, boolean, text, jsonb,
  bigint
) to authenticated, service_role;

-- The old preflight trusted a shared client as an access anchor. Replace it
-- with one actor-aware identity whose project arrays are independently filtered.
drop function if exists public.get_conversion_preflight(uuid, uuid);

create or replace function public.get_conversion_preflight(
  p_opportunity_id uuid,
  p_company_id uuid default null::uuid,
  p_actor_user_id uuid default null::uuid
) returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_actor_user_id uuid;
  v_company_id uuid;
  v_opp public.opportunities%rowtype;
  v_client_name text;
  v_project_id uuid;
  v_project_accessible boolean := false;
  v_existing jsonb := null;
  v_candidates jsonb := '[]'::jsonb;
  v_others jsonb := '[]'::jsonb;
begin
  if p_opportunity_id is null then
    raise exception 'opportunity_not_found'
      using errcode = 'P0002';
  end if;

  if v_is_service then
    if p_company_id is null or p_actor_user_id is null then
      raise exception 'access_denied'
        using errcode = '42501';
    end if;
    v_company_id := p_company_id;
    v_actor_user_id := p_actor_user_id;
  else
    v_company_id := private.get_user_company_id();
    v_actor_user_id := private.get_current_user_id();
    if v_company_id is null
      or v_actor_user_id is null
      or (p_company_id is not null and p_company_id is distinct from v_company_id)
      or (
        p_actor_user_id is not null
        and p_actor_user_id is distinct from v_actor_user_id
      )
    then
      raise exception 'access_denied'
        using errcode = '42501';
    end if;
  end if;

  select *
    into v_opp
    from public.opportunities o
   where o.id = p_opportunity_id
     and o.company_id = v_company_id
     and o.deleted_at is null;
  if not found then
    raise exception 'opportunity_not_found'
      using errcode = 'P0002';
  end if;

  if not private.user_can_convert_opportunity(
    v_actor_user_id,
    p_opportunity_id
  ) then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  if v_opp.client_id is not null then
    select c.name
      into v_client_name
      from public.clients c
     where c.id = v_opp.client_id
       and c.company_id = v_company_id;
  end if;

  v_project_id := coalesce(v_opp.project_ref, v_opp.project_id);
  if v_project_id is not null then
    v_project_accessible := private.user_can_view_project(
      v_actor_user_id,
      v_project_id
    );
    if v_project_accessible then
      select jsonb_build_object('id', p.id, 'title', p.title)
        into v_existing
        from public.projects p
       where p.id = v_project_id
         and p.company_id = v_company_id
         and p.deleted_at is null;
    end if;
  end if;

  select coalesce(jsonb_agg(candidate.payload order by candidate.title, candidate.id), '[]'::jsonb)
    into v_candidates
    from (
      select
        p.id,
        p.title,
        jsonb_build_object(
          'project_id', p.id,
          'title', p.title,
          'address', p.address,
          'confidence', case
            when p.client_id is not distinct from v_opp.client_id
              and v_opp.client_id is not null then 'high'
            else 'medium'
          end,
          'signals', case
            when p.client_id is not distinct from v_opp.client_id
              and v_opp.client_id is not null
              then jsonb_build_array('same_client', 'same_address')
            else jsonb_build_array('same_address')
          end
        ) as payload
      from public.projects p
      where p.company_id = v_company_id
        and p.deleted_at is null
        and (v_project_id is null or p.id <> v_project_id)
        and nullif(btrim(coalesce(v_opp.address, '')), '') is not null
        and private.normalize_address(p.address) =
          private.normalize_address(v_opp.address)
        and private.normalize_address(p.address) <> ''
        and private.user_can_view_project(v_actor_user_id, p.id)
        and private.user_can_link_opportunity_to_project(v_actor_user_id, p.id)
    ) candidate;

  select coalesce(jsonb_agg(other_project.payload order by other_project.title, other_project.id), '[]'::jsonb)
    into v_others
    from (
      select
        p.id,
        p.title,
        jsonb_build_object(
          'project_id', p.id,
          'title', p.title,
          'address', p.address,
          'status', p.status
        ) as payload
      from public.projects p
      where p.company_id = v_company_id
        and p.deleted_at is null
        and v_opp.client_id is not null
        and p.client_id = v_opp.client_id
        and (v_project_id is null or p.id <> v_project_id)
        and private.user_can_view_project(v_actor_user_id, p.id)
        and not (
          nullif(btrim(coalesce(v_opp.address, '')), '') is not null
          and private.normalize_address(p.address) =
            private.normalize_address(v_opp.address)
          and private.normalize_address(p.address) <> ''
          and private.user_can_link_opportunity_to_project(v_actor_user_id, p.id)
        )
    ) other_project;

  return jsonb_build_object(
    'opportunity_id', p_opportunity_id,
    'assignment_version', v_opp.assignment_version,
    'already_converted', v_project_id is not null,
    'project_accessible', coalesce(v_project_accessible, false),
    'existing_linked_project', v_existing,
    'duplicate_candidates', v_candidates,
    'other_client_projects', v_others,
    'suggested_name', private.derive_project_name(v_opp.address, v_client_name)
  );
end;
$function$;

revoke all on function public.get_conversion_preflight(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_conversion_preflight(uuid, uuid, uuid)
  to authenticated, service_role;

commit;
