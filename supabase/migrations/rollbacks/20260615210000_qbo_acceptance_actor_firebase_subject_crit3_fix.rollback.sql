-- ROLLBACK for 20260615210000_qbo_acceptance_actor_firebase_subject_crit3_fix.
--
-- Reverts the two functions to their pre-migration definitions and drops the
-- private.current_actor_auth_user_id() helper. This re-introduces the crit3
-- regression (QBO + in-app Firebase acceptance will break again), so only run
-- it to back the fix out. NOT placed in the apply path (rollbacks/ subdir).
-- Run as postgres so the bridge's SECURITY DEFINER owner is preserved.

begin;

-- 1. Revert sync: helper call -> auth.uid() (must run before dropping helper).
do $do$
declare
  v_functiondef text;
begin
  v_functiondef := pg_get_functiondef(
    'private.sync_accepted_estimate_project_tasks(uuid)'::regprocedure
  );

  if v_functiondef like '%private.current_actor_auth_user_id()%' then
    v_functiondef := replace(
      v_functiondef,
$new$  v_actor_user_id := private.get_current_user_id();

  if v_actor_user_id is null then
    raise exception 'actor_not_found' using errcode = '42501';
  end if;

  -- CRIT-3 fix: the uid() builtin casts the request.jwt sub to uuid and throws
  -- for Firebase (non-uuid) subjects. Resolve the actor id through a SECURITY
  -- DEFINER helper instead -- this function is SECURITY INVOKER and the in-app
  -- caller runs as anon/authenticated, which cannot read the auth schema.
  v_actor_auth_id := private.current_actor_auth_user_id();

  if v_actor_auth_id is null then
    raise exception 'actor_auth_not_found' using errcode = '42501';
  end if;$new$,
$old$  v_actor_user_id := private.get_current_user_id();
  v_actor_auth_id := auth.uid();

  if v_actor_user_id is null or v_actor_auth_id is null then
    raise exception 'actor_not_found' using errcode = '42501';
  end if;$old$
    );
    execute v_functiondef;
  end if;
end
$do$;

-- 2. Revert bridge: Firebase subject -> auth.users uuid sub + restore email claim.
do $do$
declare
  v_functiondef text;
begin
  v_functiondef := pg_get_functiondef(
    'public.accept_estimate_to_job_from_quickbooks(uuid, uuid, uuid, text, text)'::regprocedure
  );

  if v_functiondef like '%v_actor_subject%' then
    -- 2e (reverse): set_config back to the auth.users uuid + email claim
    v_functiondef := replace(
      v_functiondef,
$new$  perform set_config('request.jwt.claim.sub', v_actor_subject, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor_subject, 'role', 'authenticated')::text,
    true
  );$new$,
$old$  perform set_config('request.jwt.claim.sub', v_actor_auth_id::text, true);
  perform set_config('request.jwt.claim.email', v_actor_email, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor_auth_id::text, 'email', v_actor_email, 'role', 'authenticated')::text,
    true
  );$old$
    );

    -- 2d (reverse): guard
    v_functiondef := replace(
      v_functiondef,
$new$  if v_actor_auth_id is null
     or nullif(btrim(coalesce(v_actor_email, '')), '') is null
     or nullif(btrim(coalesce(v_actor_subject, '')), '') is null then$new$,
$old$  if v_actor_auth_id is null or nullif(btrim(coalesce(v_actor_email, '')), '') is null then$old$
    );

    -- 2c (reverse): admin-fallback select
    v_functiondef := replace(
      v_functiondef,
$new$    select u.id, au.id, u.email, coalesce(u.auth_id, u.firebase_uid)
      into v_actor_id, v_actor_auth_id, v_actor_email, v_actor_subject
      from public.users u$new$,
$old$    select u.id, au.id, u.email
      into v_actor_id, v_actor_auth_id, v_actor_email
      from public.users u$old$
    );

    -- 2b (reverse): account-holder select
    v_functiondef := replace(
      v_functiondef,
$new$  select u.id, au.id, u.email, coalesce(u.auth_id, u.firebase_uid)
    into v_actor_id, v_actor_auth_id, v_actor_email, v_actor_subject
    from public.users u$new$,
$old$  select u.id, au.id, u.email
    into v_actor_id, v_actor_auth_id, v_actor_email
    from public.users u$old$
    );

    -- 2a (reverse): drop the subject variable
    v_functiondef := replace(
      v_functiondef,
$new$  v_actor_email text;
  v_actor_subject text;
  v_existing_request public.accept_estimate_to_job_requests%rowtype;$new$,
$old$  v_actor_email text;
  v_existing_request public.accept_estimate_to_job_requests%rowtype;$old$
    );

    execute v_functiondef;
  end if;
end
$do$;

-- 3. Drop the helper.
drop function if exists private.current_actor_auth_user_id();

-- 4. Re-assert service-role-only execution on the bridge.
revoke all on function public.accept_estimate_to_job_from_quickbooks(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.accept_estimate_to_job_from_quickbooks(
  uuid, uuid, uuid, text, text
) to service_role;

commit;
