-- OPS agent control plane: authoritative actor snapshot and entity access.
--
-- This migration adds the control-plane authority functions, aligns the shared
-- permission primitives with current membership, and replaces broken read
-- policy composition without widening company tenancy. It does not create an
-- OAuth grant, expose an MCP route, or apply itself to any database.
--
-- Security model:
--   * actor/company identity is server supplied and revalidated from current
--     OPS rows on every call;
--   * role grants, per-user overrides, active membership, company membership,
--     and assignment are evaluated from one PostgreSQL statement snapshot;
--   * public RPCs are callable only by service_role and repeat an auth-role
--     check as defense in depth;
--   * actor-parameterized helpers stay private so future domain read RPCs can
--     apply authorization in the same SELECT that returns data;
--   * browser RLS wrappers resolve the current actor themselves and cannot be
--     used to substitute another user or company.

begin;

-- Fail closed if the authority primitives verified against production before
-- authoring this migration have drifted. A partial authority model is more
-- dangerous than an installation failure.
do $prerequisites$
declare
  v_signature text;
  v_table text;
  v_policy_descriptor text;
  v_permission_policy_count integer;
begin
  foreach v_signature in array array[
    'public.has_permission(uuid,text,text)',
    'private.current_user_scope_for(text)',
    'private.effective_pipeline_scope_for_user(uuid,uuid,text)',
    'private.effective_inbox_scope_for_user(uuid,uuid,text)',
    'private.user_can_view_project(uuid,uuid)',
    'private.user_can_edit_project(uuid,uuid)',
    'private.user_can_view_task(uuid,uuid)',
    'private.user_can_edit_task(uuid,uuid)',
    'private.user_can_change_task_status(uuid,uuid)',
    'private.user_can_view_opportunity(uuid,uuid)',
    'private.user_can_edit_opportunity(uuid,uuid)',
    'private.set_email_analysis_owner_snapshot()',
    'private.resolve_email_connection_identity(uuid)',
    'public.catalog_guided_setup_archive_variant(uuid,text)',
    'public.catalog_guided_setup_begin_commit(uuid,text)',
    'public.catalog_guided_setup_finish_commit(uuid,uuid,boolean,jsonb,jsonb)',
    'public.catalog_inventory_import_commit(uuid)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'agent_control_plane_actor_authority_prerequisite_missing: %',
        v_signature;
    end if;
  end loop;

  if to_regprocedure('extensions.digest(text,text)') is null then
    raise exception
      'agent_control_plane_actor_authority_prerequisite_missing: extensions.digest(text,text)';
  end if;

  foreach v_table in array array[
    'public.companies',
    'public.users',
    'public.roles',
    'public.user_roles',
    'public.role_permissions',
    'public.user_permission_overrides',
    'public.accounting_connections',
    'public.expense_batches',
    'public.opportunity_views',
    'public.project_views',
    'public.projects',
    'public.project_tasks',
    'public.project_notes',
    'public.clients',
    'public.sub_clients',
    'public.calendar_events',
    'public.calendar_user_events',
    'public.gmail_scan_jobs',
    'public.qbo_customer_matches',
    'public.qbo_estimate_opportunity_links',
    'public.qbo_import_runs',
    'public.qbo_item_product_mappings',
    'public.qbo_staging_customers',
    'public.qbo_staging_estimates',
    'public.qbo_staging_invoices',
    'public.qbo_staging_line_items',
    'public.qbo_staging_payments'
  ] loop
    if to_regclass(v_table) is null then
      raise exception 'agent_control_plane_actor_authority_prerequisite_missing: %',
        v_table;
    end if;
  end loop;

  -- These relations must keep their permissive company layer. The restrictive
  -- read guards installed below intersect it; they never replace tenancy.
  foreach v_table in array array[
    'projects',
    'project_tasks',
    'clients',
    'sub_clients',
    'calendar_events'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = v_table
        and policy.policyname = 'company_isolation'
        and policy.permissive = 'PERMISSIVE'
    ) then
      raise exception
        'agent_control_plane_actor_authority_prerequisite_missing: %.company_isolation',
        v_table;
    end if;
  end loop;

  -- The production audit proved the project/task gap is specifically a
  -- permissive role policy being OR-composed with company isolation. Clients
  -- already use a restrictive role policy. Refuse to replace a different
  -- policy shape discovered between review and apply.
  foreach v_table in array array['projects', 'project_tasks'] loop
    if not exists (
      select 1
      from pg_catalog.pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = v_table
        and policy.policyname = 'role_scope_read'
        and policy.permissive = 'PERMISSIVE'
        and policy.cmd = 'SELECT'
    ) then
      raise exception
        'agent_control_plane_actor_authority_prerequisite_missing: %.permissive role_scope_read',
        v_table;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'clients'
      and policy.policyname = 'role_scope_read'
      and policy.permissive = 'RESTRICTIVE'
      and policy.cmd = 'SELECT'
  ) then
    raise exception
      'agent_control_plane_actor_authority_prerequisite_missing: clients.restrictive role_scope_read';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and (
        (policy.tablename = 'sub_clients'
          and policy.policyname = 'role_scope_read')
        or (policy.tablename = 'calendar_events'
          and policy.policyname = 'calendar_event_read_scope_guard')
        or (policy.tablename = 'calendar_user_events'
          and policy.policyname = 'calendar_user_event_read_scope_guard')
      )
  ) then
    raise exception
      'agent_control_plane_actor_authority_prerequisite_missing: unexpected replacement read guard';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'calendar_user_events'
      and policy.policyname = 'Company members read all events'
      and policy.permissive = 'PERMISSIVE'
      and policy.cmd = 'SELECT'
  ) then
    raise exception
      'agent_control_plane_actor_authority_prerequisite_missing: calendar_user_events company read policy';
  end if;

  -- public.has_permission currently accepts an arbitrary user UUID. Before its
  -- EXECUTE ACL becomes service-only, prove every live app-role policy that
  -- calls it directly is exactly one of the current-user policies replaced
  -- below. The descriptor captures table, exact policy name, composition,
  -- roles, and command from the production Gate 2 readback.
  foreach v_policy_descriptor in array array[
    'accounting_connections|read company accounting_connections with accounting view|PERMISSIVE|{public}|SELECT',
    'expense_batches|expense_batches_approve_scope|RESTRICTIVE|{public}|UPDATE',
    'opportunity_views|admins manage company opportunity views|PERMISSIVE|{authenticated}|ALL',
    'opportunity_views|read company and own opportunity views|PERMISSIVE|{public}|SELECT',
    'opportunity_views|users manage own opportunity views|PERMISSIVE|{authenticated}|ALL',
    'project_views|admins manage company views|PERMISSIVE|{authenticated}|ALL',
    'project_views|users manage own views|PERMISSIVE|{authenticated}|ALL',
    'project_views|users read company and own views|PERMISSIVE|{public}|SELECT',
    'projects|project_archive_write_scope|RESTRICTIVE|{public}|UPDATE',
    'qbo_customer_matches|read company qbo_customer_matches with accounting view|PERMISSIVE|{public}|SELECT',
    'qbo_estimate_opportunity_links|read company qbo_estimate_opportunity_links with accounting vie|PERMISSIVE|{public}|SELECT',
    'qbo_import_runs|read company qbo_import_runs with accounting view|PERMISSIVE|{public}|SELECT',
    'qbo_item_product_mappings|read company qbo_item_product_mappings with accounting view|PERMISSIVE|{public}|SELECT',
    'qbo_staging_customers|read company qbo_staging_customers with accounting view|PERMISSIVE|{public}|SELECT',
    'qbo_staging_estimates|read company qbo_staging_estimates with accounting view|PERMISSIVE|{public}|SELECT',
    'qbo_staging_invoices|read company qbo_staging_invoices with accounting view|PERMISSIVE|{public}|SELECT',
    'qbo_staging_line_items|read company qbo_staging_line_items with accounting view|PERMISSIVE|{public}|SELECT',
    'qbo_staging_payments|read company qbo_staging_payments with accounting view|PERMISSIVE|{public}|SELECT'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = split_part(v_policy_descriptor, '|', 1)
        and policy.policyname = split_part(v_policy_descriptor, '|', 2)
        and policy.permissive = split_part(v_policy_descriptor, '|', 3)
        and policy.roles::text = split_part(v_policy_descriptor, '|', 4)
        and policy.cmd = split_part(v_policy_descriptor, '|', 5)
        and (
          coalesce(policy.qual, '') || ' ' || coalesce(policy.with_check, '')
        ) ~* '(^|[^a-z0-9_.])(public[.])?has_permission[(]'
        and (
          coalesce(policy.qual, '') || ' ' || coalesce(policy.with_check, '')
        ) like '%private.get_current_user_id%'
    ) then
      raise exception
        'agent_control_plane_actor_authority_prerequisite_missing: %',
        v_policy_descriptor;
    end if;
  end loop;

  select count(*)
  into v_permission_policy_count
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname in ('public', 'private')
    and not procedure.prosecdef
    and procedure.prosrc like '%public.has_permission(%';

  if v_permission_policy_count <> 5 then
    raise exception
      'agent_control_plane_actor_authority_prerequisite_missing: direct has_permission invoker count %',
      v_permission_policy_count;
  end if;

  -- Every other stored caller is SECURITY DEFINER and must share the helper's
  -- owner. That owner retains implicit EXECUTE after PUBLIC/app ACLs are
  -- revoked; a different-owner definer would silently break after this change.
  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    cross join pg_catalog.pg_proc permission_procedure
    where permission_procedure.oid = to_regprocedure(
      'public.has_permission(uuid,text,text)'
    )
      and namespace.nspname in ('public', 'private')
      and procedure.prosecdef
      and procedure.prosrc like '%public.has_permission(%'
      and procedure.proowner <> permission_procedure.proowner
  ) then
    raise exception
      'agent_control_plane_actor_authority_prerequisite_missing: has_permission definer owner mismatch';
  end if;

  select count(*)
  into v_permission_policy_count
  from pg_catalog.pg_policies policy
  where policy.schemaname = 'public'
    and (
      coalesce(policy.qual, '') || ' ' || coalesce(policy.with_check, '')
    ) ~* '(^|[^a-z0-9_.])(public[.])?has_permission[(]';

  if v_permission_policy_count <> 18 then
    raise exception
      'agent_control_plane_actor_authority_prerequisite_missing: direct has_permission policy count %',
      v_permission_policy_count;
  end if;

  -- Four browser-callable catalog functions are SECURITY INVOKER and would
  -- lose their current permission check when authenticated loses direct
  -- has_permission EXECUTE. Prove their exact caller/auth shape before the
  -- transactional source rewrite below.
  foreach v_policy_descriptor in array array[
    'public.catalog_guided_setup_archive_variant(uuid,text)|1',
    'public.catalog_guided_setup_begin_commit(uuid,text)|1',
    'public.catalog_guided_setup_finish_commit(uuid,uuid,boolean,jsonb,jsonb)|1',
    'public.catalog_inventory_import_commit(uuid)|2'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_language language
        on language.oid = procedure.prolang
      where procedure.oid = to_regprocedure(
        split_part(v_policy_descriptor, '|', 1)
      )
        and not procedure.prosecdef
        and language.lanname = 'plpgsql'
        and procedure.prosrc like '%v_company_id uuid := private.get_user_company_id()%'
        and procedure.prosrc like '%auth.jwt()%'
        and procedure.prosrc like '%v_user_id%'
        and (
          length(procedure.prosrc)
          - length(replace(procedure.prosrc, 'public.has_permission(', ''))
        ) / length('public.has_permission(')
          = split_part(v_policy_descriptor, '|', 2)::integer
        and has_function_privilege('anon', procedure.oid, 'EXECUTE')
        and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
        and has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    ) then
      raise exception
        'agent_control_plane_actor_authority_prerequisite_missing: %',
        v_policy_descriptor;
    end if;
  end loop;

  -- Authenticated admins can insert gmail_scan_jobs directly. Its BEFORE
  -- INSERT trigger must continue evaluating the explicit requested actor, not
  -- the SQL caller, after public.has_permission becomes service-only. Prove the
  -- owner-only invoker trigger is still the audited definition before changing
  -- only its execution mode to SECURITY DEFINER.
  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_language language
      on language.oid = procedure.prolang
    where procedure.oid = to_regprocedure(
      'private.set_email_analysis_owner_snapshot()'
    )
      and not procedure.prosecdef
      and language.lanname = 'plpgsql'
      and procedure.prosrc like '%new.requested_by_user_id%'
      and procedure.prosrc like '%settings.integrations%'
      and procedure.prosrc like '%new.connection_owner_user_id%'
      and procedure.proowner = (
        select permission_procedure.proowner
        from pg_catalog.pg_proc permission_procedure
        where permission_procedure.oid = to_regprocedure(
          'public.has_permission(uuid,text,text)'
        )
      )
      and procedure.proowner = (
        select identity_procedure.proowner
        from pg_catalog.pg_proc identity_procedure
        where identity_procedure.oid = to_regprocedure(
          'private.resolve_email_connection_identity(uuid)'
        )
          and identity_procedure.prosecdef
      )
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) setting
        where setting in ('search_path=', 'search_path=""')
      )
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      and not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
  ) then
    raise exception
      'agent_control_plane_actor_authority_prerequisite_missing: private.set_email_analysis_owner_snapshot()';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation_row
      on relation_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = relation_row.relnamespace
    where namespace_row.nspname = 'public'
      and relation_row.relname = 'gmail_scan_jobs'
      and trigger_row.tgname = 'gmail_scan_jobs_set_owner_snapshot'
      and not trigger_row.tgisinternal
      and trigger_row.tgenabled = 'O'
      and trigger_row.tgfoid = to_regprocedure(
        'private.set_email_analysis_owner_snapshot()'
      )
      and (trigger_row.tgtype::integer & 1) = 1
      and (trigger_row.tgtype::integer & 2) = 2
      and (trigger_row.tgtype::integer & 4) = 4
      and (trigger_row.tgtype::integer & 56) = 0
  ) then
    raise exception
      'agent_control_plane_actor_authority_prerequisite_missing: gmail_scan_jobs_set_owner_snapshot';
  end if;
end;
$prerequisites$;

create or replace function private.user_is_active_company_member(
  p_actor_user_id uuid,
  p_actor_company_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
$function$;

create or replace function private.user_is_company_admin(
  p_actor_user_id uuid,
  p_actor_company_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
$function$;

-- Raw permission semantics intentionally mirror the shipped override engine:
-- an explicit deny wins; a granted scoped override is authoritative; a grant
-- with NULL scope falls through to the current role; the widest valid role
-- scope wins. Stale-company overrides and cross-company custom roles are
-- ignored. Admin bypass remains separate so snapshots can represent it
-- explicitly without inventing wildcard permission rows.
create or replace function private.raw_permission_scope_for_user(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_permission text
) returns text
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
$function$;

create or replace function private.effective_permission_scope_for_user(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_permission text
) returns text
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
$function$;

-- Keep public.has_permission as the raw scope comparison primitive. The
-- pipeline prerequisite lattice calls this function and would recurse if it
-- called effective_permission_scope_for_user instead.
create or replace function public.has_permission(
  p_user_id uuid,
  p_permission text,
  p_required_scope text default 'all'::text
) returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
$function$;

create or replace function private.current_user_scope_for(
  p_permission text
) returns text
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.effective_permission_scope_for_user(
    private.get_current_user_id(),
    private.get_user_company_id(),
    p_permission
  );
$function$;

-- App-role policies need only a current-user permission decision. Keeping the
-- actor UUID out of this callable signature removes the cross-user oracle while
-- preserving the exact shipped public.has_permission scope comparison through
-- a SECURITY DEFINER owner call.
create or replace function private.current_user_has_permission_scoped(
  p_permission text,
  p_required_scope text default 'all'::text
) returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select public.has_permission(
    private.get_current_user_id(),
    p_permission,
    p_required_scope
  );
$function$;

-- Preserve the four SECURITY INVOKER catalog RPCs byte-for-byte except for
-- replacing their already-current-user-bound permission call. Reading the
-- existing definitions from pg_catalog avoids copying hundreds of lines of
-- unrelated catalog mutation logic into this authority migration; the Gate 2
-- prerequisite above pins language, invoker mode, identity resolution, grants,
-- and exact old-call counts before any dynamic DDL can run.
do $catalog_permission_rewrite$
declare
  v_signature text;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.catalog_guided_setup_archive_variant(uuid,text)',
    'public.catalog_guided_setup_begin_commit(uuid,text)',
    'public.catalog_guided_setup_finish_commit(uuid,uuid,boolean,jsonb,jsonb)',
    'public.catalog_inventory_import_commit(uuid)'
  ] loop
    select pg_catalog.pg_get_functiondef(to_regprocedure(v_signature))
    into v_definition;

    v_definition := replace(
      v_definition,
      $old$public.has_permission(v_user_id, 'catalog.run_setup', 'all')$old$,
      $new$private.current_user_has_permission_scoped(
        'catalog.run_setup',
        'all'
      )$new$
    );
    v_definition := replace(
      v_definition,
      $old$public.has_permission(v_user_id, 'inventory.manage', 'all')$old$,
      $new$private.current_user_has_permission_scoped(
        'inventory.manage',
        'all'
      )$new$
    );

    if v_definition is null
       or v_definition like '%public.has_permission(%'
       or v_definition not like '%private.current_user_has_permission_scoped(%'
    then
      raise exception 'catalog_permission_rewrite_failed: %', v_signature;
    end if;

    execute v_definition;
  end loop;
end;
$catalog_permission_rewrite$;

-- This trigger intentionally checks NEW.requested_by_user_id, which can differ
-- from the SQL caller during trusted service ingestion. Its pinned empty
-- search_path and owner-only ACL were verified above; SECURITY DEFINER lets it
-- keep the arbitrary-user check without reopening that helper to app roles.
alter function private.set_email_analysis_owner_snapshot()
  security definer;

create or replace function private.resolve_agent_actor_authority(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_registered_permission_keys text[]
) returns table (
  actor_user_id uuid,
  company_id uuid,
  is_active boolean,
  is_admin boolean,
  role_ids uuid[],
  configured_permissions text[],
  effective_permissions jsonb,
  permission_snapshot_revision text
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
as $function$
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
$function$;

create or replace function public.resolve_agent_actor_authority_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_registered_permission_keys text[]
) returns table (
  actor_user_id uuid,
  company_id uuid,
  is_active boolean,
  is_admin boolean,
  role_ids uuid[],
  configured_permissions text[],
  effective_permissions jsonb,
  permission_snapshot_revision text
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  return query
  select authority.actor_user_id,
         authority.company_id,
         authority.is_active,
         authority.is_admin,
         authority.role_ids,
         authority.configured_permissions,
         authority.effective_permissions,
         authority.permission_snapshot_revision
  from private.resolve_agent_actor_authority(
    p_actor_user_id,
    p_company_id,
    p_registered_permission_keys
  ) authority;
end;
$function$;

-- Internal Firebase authority is resolved in one stable RPC snapshot. Exact
-- auth_id wins; firebase_uid is consulted only when no auth_id row exists.
-- There is deliberately no email fallback and no identity-linking mutation.
create or replace function public.resolve_agent_actor_authority_for_subject_as_system(
  p_firebase_subject text,
  p_registered_permission_keys text[]
) returns table (
  actor_user_id uuid,
  company_id uuid,
  is_active boolean,
  is_admin boolean,
  role_ids uuid[],
  configured_permissions text[],
  effective_permissions jsonb,
  permission_snapshot_revision text
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_user_id uuid;
  v_company_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_firebase_subject is null
     or p_firebase_subject is distinct from btrim(p_firebase_subject)
     or length(p_firebase_subject) = 0
     or length(p_firebase_subject) > 128 then
    raise exception 'invalid_agent_firebase_subject'
      using errcode = '22023';
  end if;

  select actor.id, actor.company_id
  into v_actor_user_id, v_company_id
  from public.users actor
  where actor.auth_id = p_firebase_subject
  order by actor.id
  limit 1;

  if not found then
    select actor.id, actor.company_id
    into v_actor_user_id, v_company_id
    from public.users actor
    where actor.firebase_uid = p_firebase_subject
    order by actor.id
    limit 1;
  end if;

  if v_actor_user_id is null or v_company_id is null then
    return;
  end if;

  return query
  select authority.actor_user_id,
         authority.company_id,
         authority.is_active,
         authority.is_admin,
         authority.role_ids,
         authority.configured_permissions,
         authority.effective_permissions,
         authority.permission_snapshot_revision
  from private.resolve_agent_actor_authority(
    v_actor_user_id,
    v_company_id,
    p_registered_permission_keys
  ) authority;
end;
$function$;

create or replace function private.user_can_view_client(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_client_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
$function$;

create or replace function private.user_can_edit_client(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_client_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
$function$;

create or replace function private.user_can_view_sub_client(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_sub_client_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_client_id uuid;
begin
  select sub_client.client_id
  into v_client_id
  from public.sub_clients sub_client
  where sub_client.id = p_sub_client_id
    and sub_client.company_id = p_actor_company_id
    and sub_client.deleted_at is null;

  if not found then
    return false;
  end if;

  return private.user_can_view_client(
    p_actor_user_id,
    p_actor_company_id,
    v_client_id
  );
end;
$function$;

create or replace function private.user_can_edit_sub_client(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_sub_client_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_client_id uuid;
begin
  select sub_client.client_id
  into v_client_id
  from public.sub_clients sub_client
  where sub_client.id = p_sub_client_id
    and sub_client.company_id = p_actor_company_id
    and sub_client.deleted_at is null;

  if not found then
    return false;
  end if;

  return private.user_can_edit_client(
    p_actor_user_id,
    p_actor_company_id,
    v_client_id
  );
end;
$function$;

create or replace function private.user_can_view_calendar_event(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_calendar_event_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_event public.calendar_events;
  v_calendar_scope text;
  v_task_scope text;
begin
  select event.*
  into v_event
  from public.calendar_events event
  where event.id = p_calendar_event_id
    and event.company_id = p_actor_company_id
    and event.deleted_at is null;

  if not found or not private.user_is_active_company_member(
    p_actor_user_id,
    p_actor_company_id
  ) then
    return false;
  end if;

  if private.user_is_company_admin(
    p_actor_user_id,
    p_actor_company_id
  ) then
    return true;
  end if;

  v_calendar_scope := private.effective_permission_scope_for_user(
    p_actor_user_id,
    p_actor_company_id,
    'calendar.view'
  );
  v_task_scope := private.effective_permission_scope_for_user(
    p_actor_user_id,
    p_actor_company_id,
    'tasks.view'
  );

  if v_calendar_scope = 'all' or v_task_scope = 'all' then
    return true;
  end if;

  if v_calendar_scope is distinct from 'own'
     and v_task_scope is distinct from 'assigned' then
    return false;
  end if;

  return p_actor_user_id::text = any(
    coalesce(v_event.team_member_ids, array[]::text[])
  ) or (
    v_event.project_id is not null
    and private.user_can_view_project(
      p_actor_user_id,
      v_event.project_id
    )
  );
end;
$function$;

create or replace function private.user_can_edit_calendar_event(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_calendar_event_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_event public.calendar_events;
  v_scope text;
begin
  select event.*
  into v_event
  from public.calendar_events event
  where event.id = p_calendar_event_id
    and event.company_id = p_actor_company_id
    and event.deleted_at is null;

  if not found or not private.user_is_active_company_member(
    p_actor_user_id,
    p_actor_company_id
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
    'calendar.edit'
  );
  return v_scope = 'all' or (
    v_scope = 'own'
    and p_actor_user_id::text = any(
      coalesce(v_event.team_member_ids, array[]::text[])
    )
  );
end;
$function$;

create or replace function private.user_can_view_calendar_user_event(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_calendar_user_event_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_event public.calendar_user_events;
  v_calendar_scope text;
  v_task_scope text;
  v_time_off_scope text;
begin
  select event.*
  into v_event
  from public.calendar_user_events event
  where event.id = p_calendar_user_event_id
    and event.company_id = p_actor_company_id::text
    and event.deleted_at is null;

  if not found or not private.user_is_active_company_member(
    p_actor_user_id,
    p_actor_company_id
  ) then
    return false;
  end if;
  if private.user_is_company_admin(
    p_actor_user_id,
    p_actor_company_id
  ) then
    return true;
  end if;

  v_calendar_scope := private.effective_permission_scope_for_user(
    p_actor_user_id,
    p_actor_company_id,
    'calendar.view'
  );
  v_task_scope := private.effective_permission_scope_for_user(
    p_actor_user_id,
    p_actor_company_id,
    'tasks.view'
  );
  v_time_off_scope := private.effective_permission_scope_for_user(
    p_actor_user_id,
    p_actor_company_id,
    'time_off.approve'
  );

  if v_calendar_scope = 'all' or v_task_scope = 'all' then
    return true;
  end if;

  -- Preserve the shipped calendar contract: an event's owner and explicit
  -- invitees always see it. Permission scope controls company-wide expansion,
  -- not whether a person can see an event addressed directly to them.
  if v_event.user_id = p_actor_user_id::text
     or p_actor_user_id::text = any(
       coalesce(v_event.team_member_ids, array[]::text[])
     ) then
    return true;
  end if;

  return v_event.type = 'time_off' and v_time_off_scope = 'all';
end;
$function$;

create or replace function private.user_can_edit_calendar_user_event(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_calendar_user_event_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_event public.calendar_user_events;
  v_edit_scope text;
  v_time_off_scope text;
begin
  select event.*
  into v_event
  from public.calendar_user_events event
  where event.id = p_calendar_user_event_id
    and event.company_id = p_actor_company_id::text
    and event.deleted_at is null;

  if not found or not private.user_is_active_company_member(
    p_actor_user_id,
    p_actor_company_id
  ) then
    return false;
  end if;
  if private.user_is_company_admin(
    p_actor_user_id,
    p_actor_company_id
  ) then
    return true;
  end if;

  v_edit_scope := private.effective_permission_scope_for_user(
    p_actor_user_id,
    p_actor_company_id,
    'calendar.edit'
  );
  v_time_off_scope := private.effective_permission_scope_for_user(
    p_actor_user_id,
    p_actor_company_id,
    'time_off.approve'
  );

  if v_edit_scope = 'all' then
    return true;
  end if;
  -- The legacy RLS contract allows users to manage their own personal/time-off
  -- rows even when no calendar.edit bit is configured.
  if v_event.user_id = p_actor_user_id::text then
    return true;
  end if;
  return v_event.type = 'time_off' and v_time_off_scope = 'all';
end;
$function$;

-- This predicate is the reusable database half of entity authorization. Future
-- domain read RPCs must call it inside their final SELECT. A standalone boolean
-- check followed by a second service-role fetch is not fetch authority because
-- assignment can change between statements; only a same SQL statement
-- predicate (or an explicitly rechecked version fence) closes that race.
create or replace function private.agent_user_can_access_entity(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_entity_kind text,
  p_entity_id uuid,
  p_action text
) returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
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
$function$;

create or replace function public.authorize_agent_entity_as_system(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_entity_kind text,
  p_entity_id uuid,
  p_action text
) returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  return private.agent_user_can_access_entity(
    p_actor_user_id,
    p_company_id,
    p_entity_kind,
    p_entity_id,
    p_action
  );
end;
$function$;

-- Browser RLS wrappers derive the current actor from the signed request and
-- delegate to exactly the same actor-parameterized predicates used by the
-- control plane. Only these zero-substitution wrappers are app-callable. The
-- established current_user_can_view_project wrapper is deliberately preserved
-- because unrelated project photo/reference policies also consume it.
create or replace function private.current_user_can_view_project_scoped(
  p_project_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.user_can_view_project(
    private.get_current_user_id(),
    p_project_id
  );
$function$;

create or replace function private.current_user_can_view_task(
  p_task_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.user_can_view_task(
    private.get_current_user_id(),
    p_task_id
  );
$function$;

create or replace function private.current_user_can_view_client(
  p_client_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.user_can_view_client(
    private.get_current_user_id(),
    private.get_user_company_id(),
    p_client_id
  );
$function$;

create or replace function private.current_user_can_view_sub_client(
  p_sub_client_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.user_can_view_sub_client(
    private.get_current_user_id(),
    private.get_user_company_id(),
    p_sub_client_id
  );
$function$;

create or replace function private.current_user_can_view_calendar_event(
  p_calendar_event_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.user_can_view_calendar_event(
    private.get_current_user_id(),
    private.get_user_company_id(),
    p_calendar_event_id
  );
$function$;

create or replace function private.current_user_can_view_calendar_user_event(
  p_calendar_user_event_id uuid
) returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.user_can_view_calendar_user_event(
    private.get_current_user_id(),
    private.get_user_company_id(),
    p_calendar_user_event_id
  );
$function$;

-- Company tenancy remains the permissive row set. These restrictive guards
-- intersect it, closing the prior `company_isolation OR role_scope_read`
-- composition without deleting or widening any company policy.
drop policy if exists role_scope_read on public.projects;
create policy role_scope_read on public.projects
  as restrictive
  for select
  to public
  using (private.current_user_can_view_project_scoped(projects.id));

drop policy if exists role_scope_read on public.project_tasks;
create policy role_scope_read on public.project_tasks
  as restrictive
  for select
  to public
  using (private.current_user_can_view_task(project_tasks.id));

drop policy if exists role_scope_read on public.clients;
create policy role_scope_read on public.clients
  as restrictive
  for select
  to public
  using (private.current_user_can_view_client(clients.id));

drop policy if exists role_scope_read on public.sub_clients;
create policy role_scope_read on public.sub_clients
  as restrictive
  for select
  to public
  using (private.current_user_can_view_sub_client(sub_clients.id));

drop policy if exists calendar_event_read_scope_guard on public.calendar_events;
create policy calendar_event_read_scope_guard on public.calendar_events
  as restrictive
  for select
  to public
  using (private.current_user_can_view_calendar_event(calendar_events.id));

drop policy if exists calendar_user_event_read_scope_guard
  on public.calendar_user_events;
create policy calendar_user_event_read_scope_guard
  on public.calendar_user_events
  as restrictive
  for select
  to public
  using (
    private.current_user_can_view_calendar_user_event(
      calendar_user_events.id
    )
  );

-- Move every verified direct policy dependency off the actor-parameterized
-- public function before its app-role EXECUTE privilege is removed. Only the
-- permission call changes; command, role, policy composition, company fence,
-- ownership rules, status rules, and permission keys remain identical to the
-- Gate 2 production readback above.
drop policy if exists
  "read company accounting_connections with accounting view"
  on public.accounting_connections;
create policy
  "read company accounting_connections with accounting view"
  on public.accounting_connections
  as permissive
  for select
  to public
  using (
    company_id = (select private.get_user_company_id())::text
    and private.current_user_has_permission_scoped(
      'accounting.view',
      'all'
    )
  );

drop policy if exists expense_batches_approve_scope on public.expense_batches;
create policy expense_batches_approve_scope on public.expense_batches
  as restrictive
  for update
  to public
  using (company_id = (select private.get_user_company_id()))
  with check (
    company_id = (select private.get_user_company_id())
    and (
      status not in ('approved', 'auto_approved')
      or private.current_user_has_permission_scoped(
        'expenses.approve',
        'all'
      )
    )
  );

drop policy if exists "admins manage company opportunity views"
  on public.opportunity_views;
create policy "admins manage company opportunity views"
  on public.opportunity_views
  as permissive
  for all
  to authenticated
  using (
    company_id = (
      select actor.company_id
      from public.users actor
      where actor.id = (select private.get_current_user_id())
    )
    and owner_type = 'company'
    and private.current_user_has_permission_scoped(
      'pipeline.manage_views',
      'all'
    )
  )
  with check (
    company_id = (
      select actor.company_id
      from public.users actor
      where actor.id = (select private.get_current_user_id())
    )
    and owner_type = 'company'
    and private.current_user_has_permission_scoped(
      'pipeline.manage_views',
      'all'
    )
  );

drop policy if exists "read company and own opportunity views"
  on public.opportunity_views;
create policy "read company and own opportunity views"
  on public.opportunity_views
  as permissive
  for select
  to public
  using (
    company_id = (
      select actor.company_id
      from public.users actor
      where actor.id = (select private.get_current_user_id())
    )
    and (
      owner_type = 'company'
      or (
        owner_type = 'user'
        and owner_id = (select private.get_current_user_id())
      )
    )
    and (
      permission_key is null
      or private.current_user_has_permission_scoped(
        permission_key,
        'all'
      )
    )
  );

drop policy if exists "users manage own opportunity views"
  on public.opportunity_views;
create policy "users manage own opportunity views"
  on public.opportunity_views
  as permissive
  for all
  to authenticated
  using (
    company_id = (
      select actor.company_id
      from public.users actor
      where actor.id = (select private.get_current_user_id())
    )
    and owner_type = 'user'
    and owner_id = (select private.get_current_user_id())
  )
  with check (
    company_id = (
      select actor.company_id
      from public.users actor
      where actor.id = (select private.get_current_user_id())
    )
    and owner_type = 'user'
    and owner_id = (select private.get_current_user_id())
    and (
      permission_key is null
      or private.current_user_has_permission_scoped(
        'pipeline.manage_views',
        'all'
      )
    )
  );

drop policy if exists "admins manage company views" on public.project_views;
create policy "admins manage company views" on public.project_views
  as permissive
  for all
  to authenticated
  using (
    company_id = (
      select actor.company_id
      from public.users actor
      where actor.id = (select private.get_current_user_id())
    )
    and owner_type = 'company'
    and private.current_user_has_permission_scoped(
      'projects.manage_views',
      'all'
    )
  )
  with check (
    company_id = (
      select actor.company_id
      from public.users actor
      where actor.id = (select private.get_current_user_id())
    )
    and owner_type = 'company'
    and private.current_user_has_permission_scoped(
      'projects.manage_views',
      'all'
    )
  );

drop policy if exists "users manage own views" on public.project_views;
create policy "users manage own views" on public.project_views
  as permissive
  for all
  to authenticated
  using (
    company_id = (
      select actor.company_id
      from public.users actor
      where actor.id = (select private.get_current_user_id())
    )
    and owner_type = 'user'
    and owner_id = (select private.get_current_user_id())
  )
  with check (
    company_id = (
      select actor.company_id
      from public.users actor
      where actor.id = (select private.get_current_user_id())
    )
    and owner_type = 'user'
    and owner_id = (select private.get_current_user_id())
    and (
      permission_key is null
      or private.current_user_has_permission_scoped(
        'projects.manage_views',
        'all'
      )
    )
  );

drop policy if exists "users read company and own views"
  on public.project_views;
create policy "users read company and own views" on public.project_views
  as permissive
  for select
  to public
  using (
    company_id = (
      select actor.company_id
      from public.users actor
      where actor.id = (select private.get_current_user_id())
    )
    and (
      owner_type = 'company'
      or (
        owner_type = 'user'
        and owner_id = (select private.get_current_user_id())
      )
    )
    and (
      permission_key is null
      or private.current_user_has_permission_scoped(
        permission_key,
        'all'
      )
    )
  );

drop policy if exists project_archive_write_scope on public.projects;
create policy project_archive_write_scope on public.projects
  as restrictive
  for update
  to public
  using (true)
  with check (
    status <> 'archived'
    or private.current_user_has_permission_scoped(
      'projects.archive',
      'all'
    )
  );

drop policy if exists
  "read company qbo_customer_matches with accounting view"
  on public.qbo_customer_matches;
create policy "read company qbo_customer_matches with accounting view"
  on public.qbo_customer_matches
  as permissive
  for select
  to public
  using (
    company_id = (select private.get_user_company_id())
    and private.current_user_has_permission_scoped(
      'accounting.view',
      'all'
    )
  );

drop policy if exists
  "read company qbo_estimate_opportunity_links with accounting vie"
  on public.qbo_estimate_opportunity_links;
create policy
  "read company qbo_estimate_opportunity_links with accounting vie"
  on public.qbo_estimate_opportunity_links
  as permissive
  for select
  to public
  using (
    company_id = (select private.get_user_company_id())
    and private.current_user_has_permission_scoped(
      'accounting.view',
      'all'
    )
  );

drop policy if exists "read company qbo_import_runs with accounting view"
  on public.qbo_import_runs;
create policy "read company qbo_import_runs with accounting view"
  on public.qbo_import_runs
  as permissive
  for select
  to public
  using (
    company_id = (select private.get_user_company_id())
    and private.current_user_has_permission_scoped(
      'accounting.view',
      'all'
    )
  );

drop policy if exists
  "read company qbo_item_product_mappings with accounting view"
  on public.qbo_item_product_mappings;
create policy
  "read company qbo_item_product_mappings with accounting view"
  on public.qbo_item_product_mappings
  as permissive
  for select
  to public
  using (
    company_id = (select private.get_user_company_id())
    and private.current_user_has_permission_scoped(
      'accounting.view',
      'all'
    )
  );

drop policy if exists
  "read company qbo_staging_customers with accounting view"
  on public.qbo_staging_customers;
create policy "read company qbo_staging_customers with accounting view"
  on public.qbo_staging_customers
  as permissive
  for select
  to public
  using (
    company_id = (select private.get_user_company_id())
    and private.current_user_has_permission_scoped(
      'accounting.view',
      'all'
    )
  );

drop policy if exists
  "read company qbo_staging_estimates with accounting view"
  on public.qbo_staging_estimates;
create policy "read company qbo_staging_estimates with accounting view"
  on public.qbo_staging_estimates
  as permissive
  for select
  to public
  using (
    company_id = (select private.get_user_company_id())
    and private.current_user_has_permission_scoped(
      'accounting.view',
      'all'
    )
  );

drop policy if exists
  "read company qbo_staging_invoices with accounting view"
  on public.qbo_staging_invoices;
create policy "read company qbo_staging_invoices with accounting view"
  on public.qbo_staging_invoices
  as permissive
  for select
  to public
  using (
    company_id = (select private.get_user_company_id())
    and private.current_user_has_permission_scoped(
      'accounting.view',
      'all'
    )
  );

drop policy if exists
  "read company qbo_staging_line_items with accounting view"
  on public.qbo_staging_line_items;
create policy "read company qbo_staging_line_items with accounting view"
  on public.qbo_staging_line_items
  as permissive
  for select
  to public
  using (
    company_id = (select private.get_user_company_id())
    and private.current_user_has_permission_scoped(
      'accounting.view',
      'all'
    )
  );

drop policy if exists
  "read company qbo_staging_payments with accounting view"
  on public.qbo_staging_payments;
create policy "read company qbo_staging_payments with accounting view"
  on public.qbo_staging_payments
  as permissive
  for select
  to public
  using (
    company_id = (select private.get_user_company_id())
    and private.current_user_has_permission_scoped(
      'accounting.view',
      'all'
    )
  );

-- Actor-parameterized functions remain owner-only. Application roles receive
-- only current-user RLS wrappers; service_role retains the legacy permission
-- primitive plus the three narrow public control-plane entry points.
revoke all on function private.user_is_active_company_member(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.user_is_company_admin(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_permission_scope_for_user(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.effective_permission_scope_for_user(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.resolve_agent_actor_authority(uuid, uuid, text[])
  from public, anon, authenticated, service_role;
revoke all on function private.user_can_view_project(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.user_can_edit_project(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.user_can_view_task(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.user_can_edit_task(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.user_can_change_task_status(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.user_can_view_opportunity(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.user_can_edit_opportunity(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.user_can_view_client(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.user_can_edit_client(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.user_can_view_sub_client(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.user_can_edit_sub_client(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.user_can_view_calendar_event(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.user_can_edit_calendar_event(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.user_can_view_calendar_user_event(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.user_can_edit_calendar_user_event(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_user_can_access_entity(uuid, uuid, text, uuid, text)
  from public, anon, authenticated, service_role;

revoke all on function private.current_user_can_view_project_scoped(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.current_user_can_view_task(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.current_user_can_view_client(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.current_user_can_view_sub_client(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.current_user_can_view_calendar_event(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.current_user_can_view_calendar_user_event(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.current_user_has_permission_scoped(text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.set_email_analysis_owner_snapshot()
  from public, anon, authenticated, service_role;

grant execute on function private.current_user_can_view_project_scoped(uuid)
  to anon, authenticated;
grant execute on function private.current_user_can_view_task(uuid)
  to anon, authenticated;
grant execute on function private.current_user_can_view_client(uuid)
  to anon, authenticated;
grant execute on function private.current_user_can_view_sub_client(uuid)
  to anon, authenticated;
grant execute on function private.current_user_can_view_calendar_event(uuid)
  to anon, authenticated;
grant execute on function private.current_user_can_view_calendar_user_event(uuid)
  to anon, authenticated;
grant execute on function private.current_user_has_permission_scoped(text, text)
  to anon, authenticated, service_role;

-- The actor-parameterized permission primitive is intentionally service-only.
-- Existing trusted SECURITY DEFINER functions continue to call it as owner;
-- app-role policies call only the current-user wrapper above.
revoke all on function public.has_permission(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.has_permission(uuid, text, text)
  to service_role;

revoke all on function public.resolve_agent_actor_authority_as_system(
  uuid, uuid, text[]
) from public, anon, authenticated, service_role;
revoke all on function public.resolve_agent_actor_authority_for_subject_as_system(
  text, text[]
) from public, anon, authenticated, service_role;
revoke all on function public.authorize_agent_entity_as_system(
  uuid, uuid, text, uuid, text
) from public, anon, authenticated, service_role;

grant execute on function public.resolve_agent_actor_authority_as_system(
  uuid, uuid, text[]
) to service_role;
grant execute on function public.resolve_agent_actor_authority_for_subject_as_system(
  text, text[]
) to service_role;
grant execute on function public.authorize_agent_entity_as_system(
  uuid, uuid, text, uuid, text
) to service_role;

comment on function public.resolve_agent_actor_authority_as_system(
  uuid, uuid, text[]
) is
  'Service-only current OPS actor authority snapshot for an explicit actor and expected company. Registered permission keys come from the server-owned AppPermission registry, never tool input.';

comment on function public.resolve_agent_actor_authority_for_subject_as_system(
  text, text[]
) is
  'Service-only current OPS actor authority snapshot resolved transactionally from a verified Firebase subject by exact auth_id then firebase_uid, without email fallback or identity mutation.';

comment on function public.authorize_agent_entity_as_system(
  uuid, uuid, text, uuid, text
) is
  'Service-only privacy-safe entity predicate. This standalone boolean is diagnostic authority only; every domain fetch must invoke the private predicate in the same SQL statement that returns data.';

commit;
