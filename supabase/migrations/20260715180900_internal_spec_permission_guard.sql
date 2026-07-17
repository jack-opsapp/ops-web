-- ============================================================================
-- INTERNAL SPEC PERMISSION GUARD
--
-- The SPEC operator console deliberately anchors protected spec.admin overrides
-- to the reserved OPS Operations company. Preserve only that exact internal
-- tuple while every customer-company permission override remains company-bound.
-- ============================================================================

begin;

do $prerequisites$
begin
  if to_regprocedure(
      'private.assert_direct_permission_user(uuid)'
    ) is null
    or to_regprocedure(
      'private.guard_role_permissions_final_state()'
    ) is null
    or to_regprocedure(
      'private.guard_user_overrides_final_state()'
    ) is null
    or to_regprocedure(
      'private.guard_user_roles_final_state()'
    ) is null
    or to_regprocedure(
      'public.apply_user_permission_overrides_as_system(uuid,uuid,jsonb,jsonb,text[],jsonb)'
    ) is null
    or to_regclass('public.role_permissions') is null
    or to_regclass('public.user_permission_overrides') is null
    or to_regclass('public.user_roles') is null
    or exists (
      select 1
        from (
          values
            (
              'role_permissions'::text,
              'trg_role_permissions_final_state'::text,
              'guard_role_permissions_final_state'::text
            ),
            (
              'user_permission_overrides'::text,
              'trg_user_permission_overrides_final_state'::text,
              'guard_user_overrides_final_state'::text
            ),
            (
              'user_roles'::text,
              'trg_user_roles_final_state'::text,
              'guard_user_roles_final_state'::text
            )
        ) expected(table_name, trigger_name, function_name)
       where not exists (
         select 1
           from pg_catalog.pg_trigger t
           join pg_catalog.pg_class relation on relation.oid = t.tgrelid
           join pg_catalog.pg_namespace relation_namespace
             on relation_namespace.oid = relation.relnamespace
           join pg_catalog.pg_proc trigger_function
             on trigger_function.oid = t.tgfoid
           join pg_catalog.pg_namespace function_namespace
             on function_namespace.oid = trigger_function.pronamespace
          where relation_namespace.nspname = 'public'
            and relation.relname = expected.table_name
            and t.tgname = expected.trigger_name
            and function_namespace.nspname = 'private'
            and trigger_function.proname = expected.function_name
            and trigger_function.pronargs = 0
            and not t.tgisinternal
            and t.tgdeferrable
            and t.tginitdeferred
            and t.tgenabled in ('O', 'A')
       )
    )
    or not exists (
      select 1
        from public.companies c
       where c.id = '00000000-0000-0000-0000-00000000000a'::uuid
         and c.deleted_at is null
    )
  then
    raise exception 'internal_spec_permission_override_guard_prerequisite_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

-- Wait out every writer that could still commit under the 161000 deferred
-- trigger bodies. Once acquired, these locks prevent a grant-definition or
-- membership write from crossing the guard replacement/validation boundary.
lock table public.role_permissions, public.user_permission_overrides, public.user_roles in share mode;

-- `spec.admin` is a protected internal-console grant, not a customer-company
-- permission. Its deliberately reserved company id is transport metadata for
-- the SPEC subsystem, so it must not be mistaken for a stale customer override.
-- Keep the exception exact and fail closed for every other cross-company row.
create or replace function private.is_canonical_internal_permission_override(
  p_permission text,
  p_company_id uuid,
  p_scope text,
  p_granted boolean
) returns boolean
language sql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select coalesce(
    p_permission = 'spec.admin'
    and p_company_id = '00000000-0000-0000-0000-00000000000a'::uuid
    and p_scope = 'all'
    and p_granted is true,
    false
  );
$function$;

create or replace function private.is_canonical_internal_role_permission(
  p_role_id uuid,
  p_permission text,
  p_scope text
) returns boolean
language sql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select coalesce(
    p_role_id = '00000000-0000-0000-0000-0000000000a1'::uuid
    and p_permission = 'spec.admin'
    and p_scope = 'all',
    false
  );
$function$;

-- 161000 installed this guard before the reserved internal-company exception
-- was known. Replace it before touching the Operator preset so the deferred
-- role trigger validates real customer overrides without blocking the exact
-- protected SPEC grant.
create or replace function private.assert_direct_permission_user(
  p_user_id uuid
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid;
begin
  select u.company_id
    into v_company_id
    from public.users u
   where u.id = p_user_id
     and u.company_id is not null
     and u.deleted_at is null
     and coalesce(u.is_active, false);

  if not found then
    return;
  end if;

  perform private.lock_lead_assignment_company(v_company_id);

  if exists (
    select 1
      from public.user_permission_overrides upo
     where upo.user_id = p_user_id
       and upo.permission = 'spec.admin'
       and not private.is_canonical_internal_permission_override(
         upo.permission,
         upo.company_id,
         upo.scope,
         upo.granted
       )
  ) then
    raise exception 'direct_permission_write_invalid: protected_permission_override_invalid'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.user_permission_overrides upo
     where upo.user_id = p_user_id
       and upo.company_id is distinct from v_company_id
       and not private.is_canonical_internal_permission_override(
         upo.permission,
         upo.company_id,
         upo.scope,
         upo.granted
       )
  ) then
    raise exception 'direct_permission_write_invalid: stale_company_override'
      using errcode = '23514';
  end if;

  begin
    perform private.assert_permission_users_valid(array[p_user_id]);
  exception
    when sqlstate '22023' then
      raise exception using
        errcode = '23514',
        message = 'direct_permission_write_invalid',
        detail = sqlerrm;
  end;

  if exists (
    select 1
      from private.stranded_permission_assignments(
        v_company_id,
        array[p_user_id]
      )
  ) then
    raise exception 'permission_change_would_strand_assignments'
      using errcode = '23514';
  end if;
end;
$function$;

-- The guarded per-user editor must apply the same distinction. The protected
-- row remains present in the optimistic snapshot but cannot be set or cleared
-- because `spec.admin` is intentionally absent from the editable registry.
create or replace function public.apply_user_permission_overrides_as_system(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_expected_overrides jsonb,
  p_set jsonb,
  p_clear text[],
  p_assignment_resolutions jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_actor_company_id uuid;
  v_target_company_id uuid;
  v_current_overrides jsonb;
  v_resolved_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  select u.company_id
    into v_actor_company_id
    from public.users u
   where u.id = p_actor_user_id
     and u.company_id is not null
     and u.deleted_at is null
     and coalesce(u.is_active, false);
  if not found then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  perform private.lock_lead_assignment_company(v_actor_company_id);

  perform 1
    from public.users u
   where u.id = p_actor_user_id
     and u.company_id = v_actor_company_id
     and u.deleted_at is null
     and coalesce(u.is_active, false)
     and not exists (
       select 1
         from public.user_roles ur
         join public.roles r on r.id = ur.role_id
        where ur.user_id = u.id::text
          and not (
            (r.is_preset and r.company_id is null)
            or (not r.is_preset and r.company_id = u.company_id)
          )
     )
   for share;
  if not found
    or not public.has_permission(
      p_actor_user_id,
      'team.assign_roles',
      'all'
    )
  then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  select u.company_id
    into v_target_company_id
    from public.users u
   where u.id = p_target_user_id
     and u.company_id is not null
     and u.deleted_at is null
     and coalesce(u.is_active, false)
   for update;
  if not found then
    raise exception 'target_user_not_found'
      using errcode = 'P0002';
  end if;
  if v_target_company_id is distinct from v_actor_company_id then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;
  if private.permission_user_is_admin(
    p_target_user_id,
    v_target_company_id
  ) then
    raise exception 'target_is_admin'
      using errcode = '42501';
  end if;

  perform 1
    from public.user_permission_overrides upo
   where upo.user_id = p_target_user_id
   order by upo.permission
   for update;

  if exists (
    select 1
      from public.user_permission_overrides upo
     where upo.user_id = p_target_user_id
       and upo.permission = 'spec.admin'
       and not private.is_canonical_internal_permission_override(
         upo.permission,
         upo.company_id,
         upo.scope,
         upo.granted
       )
  ) then
    raise exception 'protected_permission_override_invalid'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from public.user_permission_overrides upo
     where upo.user_id = p_target_user_id
       and upo.company_id is distinct from v_target_company_id
       and not private.is_canonical_internal_permission_override(
         upo.permission,
         upo.company_id,
         upo.scope,
         upo.granted
       )
  ) then
    raise exception 'stale_company_override'
      using errcode = '22023';
  end if;

  perform private.assert_canonical_override_payload(
    p_expected_overrides,
    false
  );
  v_current_overrides := private.canonical_user_override_snapshot(
    p_target_user_id
  );
  if v_current_overrides is distinct from p_expected_overrides then
    raise exception using
      errcode = '40001',
      message = 'permission_snapshot_mismatch',
      detail = jsonb_build_object(
        'expected_overrides', p_expected_overrides,
        'current_overrides', v_current_overrides
      )::text;
  end if;

  perform private.assert_canonical_override_payload(p_set, true);
  if p_clear is null
    or exists (select 1 from unnest(p_clear) permission where permission is null)
    or (
      select count(*) from unnest(p_clear)
    ) <> (
      select count(distinct permission) from unnest(p_clear) permission
    )
    or exists (
      select 1
        from unnest(p_clear) permission
        left join private.lead_permission_editor_registry registry
          on registry.permission = permission
       where registry.permission is null
    )
    or exists (
      select 1
        from jsonb_array_elements(p_set) entry
       where entry ->> 'permission' = any(p_clear)
    )
  then
    raise exception 'invalid_override_set_clear'
      using errcode = '22023';
  end if;

  delete from public.user_permission_overrides upo
   where upo.user_id = p_target_user_id
     and upo.permission = any(p_clear);

  insert into public.user_permission_overrides (
    user_id,
    company_id,
    permission,
    scope,
    granted
  )
  select
    p_target_user_id,
    v_target_company_id,
    entry ->> 'permission',
    case
      when jsonb_typeof(entry -> 'scope') = 'null' then null
      else entry ->> 'scope'
    end,
    (entry ->> 'granted')::boolean
  from jsonb_array_elements(p_set) entry
  on conflict (user_id, permission) do update
    set company_id = excluded.company_id,
        scope = excluded.scope,
        granted = excluded.granted,
        updated_at = now();

  perform private.assert_permission_users_valid(array[p_target_user_id]);
  v_resolved_count := private.enforce_permission_assignment_resolutions(
    p_actor_user_id,
    v_target_company_id,
    array[p_target_user_id],
    p_assignment_resolutions,
    'user_overrides',
    p_target_user_id
  );
  perform private.assert_permission_users_valid(array[p_target_user_id]);

  return jsonb_build_object(
    'ok', true,
    'user_id', p_target_user_id,
    'overrides', private.canonical_user_override_snapshot(p_target_user_id),
    'resolved_assignments', v_resolved_count
  );
end;
$function$;

-- The seeded SPEC role grant is an internal-console authority definition, not
-- a company-editable role capability. Freeze it behind a future dedicated
-- SPEC-only operation while preserving all ordinary role-permission behavior.
create or replace function private.guard_role_permissions_final_state()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_role_id uuid;
  v_user_id uuid;
  v_role_ids uuid[] := array_remove(array[
    case when tg_op in ('UPDATE', 'DELETE') then old.role_id else null end,
    case when tg_op in ('INSERT', 'UPDATE') then new.role_id else null end
  ], null);
begin
  if tg_op in ('UPDATE', 'DELETE')
    and old.permission = 'spec.admin'
  then
    raise exception 'direct_permission_write_invalid: protected_role_permission'
      using errcode = '23514';
  end if;

  if tg_op in ('INSERT', 'UPDATE')
    and new.permission = 'spec.admin'
  then
    raise exception 'direct_permission_write_invalid: protected_role_permission'
      using errcode = '23514';
  end if;

  foreach v_role_id in array v_role_ids
  loop
    if exists (
      select 1
        from public.roles r
        join public.user_roles ur on ur.role_id = r.id
        join public.users u on u.id::text = ur.user_id
       where r.id = v_role_id
         and not r.is_preset
         and r.company_id is distinct from u.company_id
    ) then
      raise exception 'direct_permission_write_invalid: cross-company role member'
        using errcode = '23514';
    end if;

    begin
      perform private.assert_permission_role_valid(v_role_id);
    exception
      when sqlstate '22023' then
        raise exception using
          errcode = '23514',
          message = 'direct_permission_write_invalid',
          detail = sqlerrm;
    end;

    for v_user_id in
      select u.id
        from public.user_roles ur
        join public.users u on u.id::text = ur.user_id
       where ur.role_id = v_role_id
         and u.deleted_at is null
         and coalesce(u.is_active, false)
       order by u.id
    loop
      perform private.assert_direct_permission_user(v_user_id);
    end loop;
  end loop;

  return null;
end;
$function$;

-- Generic table writes are not an authorization boundary for the internal
-- console. Preserve the seeded protected row, but require any future grant or
-- revocation to arrive through a separately reviewed SPEC-only operation.
create or replace function private.guard_user_overrides_final_state()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_user_id uuid;
  v_user_ids uuid[] := array_remove(array[
    case when tg_op in ('UPDATE', 'DELETE') then old.user_id else null end,
    case when tg_op in ('INSERT', 'UPDATE') then new.user_id else null end
  ], null);
begin
  if tg_op in ('UPDATE', 'DELETE')
    and old.permission = 'spec.admin'
  then
    raise exception 'direct_permission_write_invalid: protected_permission_override'
      using errcode = '23514';
  end if;

  if tg_op in ('INSERT', 'UPDATE')
    and new.permission = 'spec.admin'
  then
    raise exception 'direct_permission_write_invalid: protected_permission_override'
      using errcode = '23514';
  end if;

  foreach v_user_id in array v_user_ids
  loop
    if exists (
      select 1
        from public.users u
       where u.id = v_user_id
         and private.permission_user_is_admin(u.id, u.company_id)
    ) then
      raise exception 'target_is_admin'
        using errcode = '42501';
    end if;
    perform private.assert_direct_permission_user(v_user_id);
  end loop;
  return null;
end;
$function$;

-- Membership in the dedicated SPEC Operator role is itself an internal grant.
-- The company role editor may never manufacture or remove that authority.
create or replace function private.guard_user_roles_final_state()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_user_id uuid;
  v_new_user_id uuid;
  v_user_ids uuid[] := array_remove(array[
    case
      when tg_op in ('UPDATE', 'DELETE')
        then private.permission_try_parse_uuid(old.user_id)
      else null
    end,
    case
      when tg_op in ('INSERT', 'UPDATE')
        then private.permission_try_parse_uuid(new.user_id)
      else null
    end
  ], null);
begin
  if tg_op in ('UPDATE', 'DELETE')
    and old.role_id = '00000000-0000-0000-0000-0000000000a1'::uuid
  then
    raise exception 'direct_permission_write_invalid: protected_role_membership'
      using errcode = '23514';
  end if;

  if tg_op in ('INSERT', 'UPDATE')
    and new.role_id = '00000000-0000-0000-0000-0000000000a1'::uuid
  then
    raise exception 'direct_permission_write_invalid: protected_role_membership'
      using errcode = '23514';
  end if;

  if tg_op in ('INSERT', 'UPDATE')
    and private.permission_try_parse_uuid(new.user_id) is null
  then
    raise exception 'direct_permission_write_invalid: user_roles user_id'
      using errcode = '23514';
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_new_user_id := private.permission_try_parse_uuid(new.user_id);

    if not exists (
      select 1
        from public.users u
        join public.roles r on r.id = new.role_id
       where u.id = v_new_user_id
         and u.deleted_at is null
         and coalesce(u.is_active, false)
         and (
           (r.is_preset and r.company_id is null)
           or (not r.is_preset and r.company_id = u.company_id)
         )
    ) then
      raise exception 'direct_permission_write_invalid: role assignment'
        using errcode = '23514';
    end if;
  end if;

  foreach v_user_id in array v_user_ids
  loop
    if exists (
      select 1
        from public.users u
       where u.id = v_user_id
         and private.permission_user_is_admin(u.id, u.company_id)
    ) then
      raise exception 'target_is_admin'
        using errcode = '42501';
    end if;
    perform private.assert_direct_permission_user(v_user_id);
  end loop;
  return null;
end;
$function$;

revoke all on function private.is_canonical_internal_permission_override(
  text, uuid, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function private.is_canonical_internal_role_permission(
  uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.assert_direct_permission_user(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.guard_role_permissions_final_state()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_user_overrides_final_state()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_user_roles_final_state()
  from public, anon, authenticated, service_role;
revoke all on function public.apply_user_permission_overrides_as_system(
  uuid, uuid, jsonb, jsonb, text[], jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.apply_user_permission_overrides_as_system(
  uuid, uuid, jsonb, jsonb, text[], jsonb
) to service_role;

-- Row guards cannot intercept TRUNCATE. Application roles never need wholesale
-- permission-store deletion, so remove that bypass while migration owners keep
-- their owner authority for separately reviewed maintenance.
revoke truncate on table
  public.role_permissions,
  public.user_permission_overrides,
  public.user_roles
from public, anon, authenticated, service_role;

do $existing_rows$
begin
  if not exists (
    select 1
      from public.role_permissions rp
      join public.roles r on r.id = rp.role_id
     where private.is_canonical_internal_role_permission(
       rp.role_id,
       rp.permission,
       rp.scope
     )
       and r.is_preset
       and r.company_id is null
       and r.name = 'SPEC Operator'
  )
    or exists (
      select 1
        from public.role_permissions rp
       where rp.permission = 'spec.admin'
         and not private.is_canonical_internal_role_permission(
           rp.role_id,
           rp.permission,
           rp.scope
         )
    )
  then
    raise exception 'protected_role_permission_invalid'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from public.user_roles ur
     where ur.role_id = '00000000-0000-0000-0000-0000000000a1'::uuid
  ) then
    raise exception 'unexpected_internal_spec_role_membership'
      using errcode = '55000';
  end if;

  if (
    select count(*)
      from public.user_permission_overrides upo
      join public.users u on u.id = upo.user_id
     where private.is_canonical_internal_permission_override(
       upo.permission,
       upo.company_id,
       upo.scope,
       upo.granted
     )
       and u.deleted_at is null
       and coalesce(u.is_active, false)
  ) <> 1
    or exists (
    select 1
      from public.user_permission_overrides upo
      left join public.users u on u.id = upo.user_id
     where upo.permission = 'spec.admin'
       and (
         not private.is_canonical_internal_permission_override(
           upo.permission,
           upo.company_id,
           upo.scope,
           upo.granted
         )
         or u.id is null
         or u.deleted_at is not null
         or not coalesce(u.is_active, false)
       )
  ) then
    raise exception 'protected_permission_override_invalid'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from public.user_permission_overrides upo
      left join public.users u on u.id = upo.user_id
     where (
       u.id is null
       or upo.company_id is distinct from u.company_id
     )
       and not private.is_canonical_internal_permission_override(
         upo.permission,
         upo.company_id,
         upo.scope,
         upo.granted
       )
  ) then
    raise exception 'stale_company_override'
      using errcode = '55000';
  end if;
end;
$existing_rows$;

commit;
