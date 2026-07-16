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

commit;
