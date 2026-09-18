-- Individual permission changes have failed on every save since the lead
-- assignment permission migration (20260715161000, re-issued by
-- 20260715180900). The p_clear validation aliased unnest(p_clear) as
-- "permission" and then joined private.lead_permission_editor_registry, which
-- also has a "permission" column, so Postgres rejected the statement with
-- 42702 "column reference \"permission\" is ambiguous" before looking at any
-- data. The route answered 500 permission_update_failed; no
-- user_permission_overrides row has been written since 2026-05-26.
--
-- This replaces the function with its live definition, changing only the
-- p_clear validation to a qualified alias: cleared(permission). Every other
-- line is byte-identical to the definition live on 2026-09-18.

do $guard$
declare
  v_md5 text;
begin
  select md5(pg_get_functiondef(
    'public.apply_user_permission_overrides_as_system(uuid, uuid, jsonb, jsonb, text[], jsonb)'::regprocedure
  ))
    into v_md5;
  if v_md5 is distinct from '74ca941e37b9813a30db902b52c91e13' then
    raise exception
      'apply_user_permission_overrides_as_system drifted from the reviewed definition (md5 %); refusing to replace',
      v_md5;
  end if;
end
$guard$;

CREATE OR REPLACE FUNCTION public.apply_user_permission_overrides_as_system(p_actor_user_id uuid, p_target_user_id uuid, p_expected_overrides jsonb, p_set jsonb, p_clear text[], p_assignment_resolutions jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
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
    or exists (
      select 1 from unnest(p_clear) as cleared(permission)
       where cleared.permission is null
    )
    or (
      select count(*) from unnest(p_clear)
    ) <> (
      select count(distinct cleared.permission)
        from unnest(p_clear) as cleared(permission)
    )
    or exists (
      select 1
        from unnest(p_clear) as cleared(permission)
        left join private.lead_permission_editor_registry registry
          on registry.permission = cleared.permission
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

revoke all on function public.apply_user_permission_overrides_as_system(uuid, uuid, jsonb, jsonb, text[], jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_user_permission_overrides_as_system(uuid, uuid, jsonb, jsonb, text[], jsonb)
  to service_role;
