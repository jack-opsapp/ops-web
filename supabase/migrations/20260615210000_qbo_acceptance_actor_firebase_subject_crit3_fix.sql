-- QBO + in-app estimate-acceptance bridge: realign the synthetic actor identity
-- onto the Firebase-bridge subject scheme, repairing the regression from
-- 20260614083934_crit3_phase_c_rekey_rls_identity_helpers.
--
-- ROOT CAUSE
-- When a QBO estimate is Accepted the inbound webhook calls SECURITY DEFINER
-- public.accept_estimate_to_job_from_quickbooks under service_role. It resolved
-- the actor (company account holder / admin) and set request.jwt sub to the
-- actor's auth.users UUID. crit3_phase_c rekeyed the identity helpers
-- (private.get_user_company_id / get_current_user_id) and the
-- accept_estimate_to_job_requests write-guard to resolve the actor by the
-- request.jwt 'sub' claim matched against public.users.auth_id OR firebase_uid
-- (the stable Firebase-bridge subject) instead of the prior email-claim lookup.
-- For Firebase-bridge users auth_id = firebase_uid = <Firebase UID>, never the
-- auth.users UUID, so the rekeyed helpers returned NULL and the write-guard
-- raised acceptance_request_company_scope_mismatch. QBO acceptance broke for
-- every Firebase-bridge company whose account holder has a Firebase subject.
--
-- The SHARED private.sync_accepted_estimate_project_tasks() (also called by the
-- in-app public.accept_estimate_to_job RPC used by iOS/web) read v_actor_auth_id
-- via auth.uid(), which casts sub to uuid and throws on a non-UUID Firebase
-- subject -- so the in-app path is dead for any Firebase session regardless of
-- crit3.
--
-- FIX (aligns with, does not weaken, crit3's subject-based identity intent)
-- 1. private.current_actor_auth_user_id(): new SECURITY DEFINER (postgres-owned)
--    helper that resolves the CURRENT actor's auth.users id via the email join.
--    Needed because sync is SECURITY INVOKER and the in-app caller runs as
--    anon/authenticated, which has no grant on auth.users -- only a definer
--    helper can read it. It returns only the calling actor's own auth.users id.
-- 2. private.sync_accepted_estimate_project_tasks: stop calling the uid() builtin
--    (which throws on a Firebase subject); resolve v_actor_auth_id through the
--    helper. Preserves projects.created_by = auth.users id (FK -> auth.users.id).
-- 3. public.accept_estimate_to_job_from_quickbooks: set request.jwt sub to the
--    actor's coalesce(auth_id, firebase_uid) Firebase subject (what the rekeyed
--    helpers + write-guard resolve on), and drop the now-vestigial email claim
--    (no function in the acceptance call graph reads it post-crit3).
--
-- COVERAGE: repairs acceptance for actors with a resolvable Firebase subject AND
-- a matching auth.users row by email (the only active QBO company, Maverick,
-- qualifies). Actors lacking either now fail with a graceful needs_review /
-- actor_auth_not_found instead of a raw cast crash; full coverage for the
-- remaining Firebase-only users comes from the CRIT-3 Phase A identity backfill.
--
-- Idempotent + sentinel-guarded. Bridge stays service-role-only.
--
-- ROLLBACK: drop private.current_actor_auth_user_id() and CREATE OR REPLACE both
-- functions back to their pre-migration definitions (sync: v_actor_auth_id :=
-- auth.uid() with the combined actor_not_found guard; bridge: jwt sub from
-- v_actor_auth_id::text + the email claim, no v_actor_subject). Run as postgres.

begin;

-- ---------------------------------------------------------------------------
-- 0. SECURITY DEFINER helper: resolve the current actor's auth.users id.
--    sync is SECURITY INVOKER; the in-app caller runs as anon/authenticated,
--    which cannot SELECT auth.users. This definer helper (owned by postgres)
--    performs that one read and returns only the calling actor's own id.
-- ---------------------------------------------------------------------------
create or replace function private.current_actor_auth_user_id()
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select actor_auth.id
  from public.users actor_user
  join auth.users actor_auth
    on lower(actor_auth.email) = lower(actor_user.email)
  where actor_user.id = private.get_current_user_id()
    and actor_user.deleted_at is null
  limit 1
$function$;

revoke all on function private.current_actor_auth_user_id() from public;
grant execute on function private.current_actor_auth_user_id()
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. private.sync_accepted_estimate_project_tasks: replace the auth.uid() cast
--    with the definer helper.
-- ---------------------------------------------------------------------------
do $do$
declare
  v_functiondef text;
begin
  v_functiondef := pg_get_functiondef(
    'private.sync_accepted_estimate_project_tasks(uuid)'::regprocedure
  );

  if v_functiondef ~ 'auth\.uid\(\)' then
    v_functiondef := replace(
      v_functiondef,
$old$  v_actor_user_id := private.get_current_user_id();
  v_actor_auth_id := auth.uid();

  if v_actor_user_id is null or v_actor_auth_id is null then
    raise exception 'actor_not_found' using errcode = '42501';
  end if;$old$,
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
  end if;$new$
    );

    if v_functiondef ~ 'auth\.uid\(\)' then
      raise exception
        'qbo_acceptance_actor_subject_sentinel: failed to remove auth.uid() from sync_accepted_estimate_project_tasks';
    end if;

    if v_functiondef not like '%private.current_actor_auth_user_id()%' then
      raise exception
        'qbo_acceptance_actor_subject_sentinel: sync helper-call patch did not apply';
    end if;

    execute v_functiondef;
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- 2. public.accept_estimate_to_job_from_quickbooks: set jwt sub to the actor's
--    Firebase subject (coalesce(auth_id, firebase_uid)); drop the email claim.
-- ---------------------------------------------------------------------------
do $do$
declare
  v_functiondef text;
begin
  v_functiondef := pg_get_functiondef(
    'public.accept_estimate_to_job_from_quickbooks(uuid, uuid, uuid, text, text)'::regprocedure
  );

  if v_functiondef not like '%v_actor_subject%' then
    -- 2a. declare the subject variable
    v_functiondef := replace(
      v_functiondef,
$old$  v_actor_email text;
  v_existing_request public.accept_estimate_to_job_requests%rowtype;$old$,
$new$  v_actor_email text;
  v_actor_subject text;
  v_existing_request public.accept_estimate_to_job_requests%rowtype;$new$
    );

    -- 2b. account-holder actor select (2-space indent)
    v_functiondef := replace(
      v_functiondef,
$old$  select u.id, au.id, u.email
    into v_actor_id, v_actor_auth_id, v_actor_email
    from public.users u$old$,
$new$  select u.id, au.id, u.email, coalesce(u.auth_id, u.firebase_uid)
    into v_actor_id, v_actor_auth_id, v_actor_email, v_actor_subject
    from public.users u$new$
    );

    -- 2c. admin-fallback actor select (4-space indent)
    v_functiondef := replace(
      v_functiondef,
$old$    select u.id, au.id, u.email
      into v_actor_id, v_actor_auth_id, v_actor_email
      from public.users u$old$,
$new$    select u.id, au.id, u.email, coalesce(u.auth_id, u.firebase_uid)
      into v_actor_id, v_actor_auth_id, v_actor_email, v_actor_subject
      from public.users u$new$
    );

    -- 2d. require a resolvable Firebase subject alongside the existing guard
    v_functiondef := replace(
      v_functiondef,
$old$  if v_actor_auth_id is null or nullif(btrim(coalesce(v_actor_email, '')), '') is null then$old$,
$new$  if v_actor_auth_id is null
     or nullif(btrim(coalesce(v_actor_email, '')), '') is null
     or nullif(btrim(coalesce(v_actor_subject, '')), '') is null then$new$
    );

    -- 2e. set jwt sub from the Firebase subject; drop the vestigial email claim
    v_functiondef := replace(
      v_functiondef,
$old$  perform set_config('request.jwt.claim.sub', v_actor_auth_id::text, true);
  perform set_config('request.jwt.claim.email', v_actor_email, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor_auth_id::text, 'email', v_actor_email, 'role', 'authenticated')::text,
    true
  );$old$,
$new$  perform set_config('request.jwt.claim.sub', v_actor_subject, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor_subject, 'role', 'authenticated')::text,
    true
  );$new$
    );

    if v_functiondef not like '%v_actor_subject%'
       or v_functiondef not like '%coalesce(u.auth_id, u.firebase_uid)%' then
      raise exception
        'qbo_acceptance_actor_subject_sentinel: bridge subject patch did not apply';
    end if;

    if v_functiondef like '%set_config(''request.jwt.claim.sub'', v_actor_auth_id%' then
      raise exception
        'qbo_acceptance_actor_subject_sentinel: bridge still sets jwt sub from the auth.users uuid';
    end if;

    if v_functiondef like '%request.jwt.claim.email%' then
      raise exception
        'qbo_acceptance_actor_subject_sentinel: bridge still sets the email claim (crit3 resolves by subject only)';
    end if;

    execute v_functiondef;
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- 3. Post-conditions: assert the live definitions reflect the fix.
-- ---------------------------------------------------------------------------
do $do$
declare
  v_sync text := pg_get_functiondef('private.sync_accepted_estimate_project_tasks(uuid)'::regprocedure);
  v_qbo  text := pg_get_functiondef('public.accept_estimate_to_job_from_quickbooks(uuid, uuid, uuid, text, text)'::regprocedure);
  v_helper_secdef boolean;
begin
  select prosecdef into v_helper_secdef
    from pg_proc where oid = 'private.current_actor_auth_user_id()'::regprocedure;

  if v_helper_secdef is distinct from true then
    raise exception 'qbo_acceptance_actor_subject_sentinel: helper is not SECURITY DEFINER';
  end if;
  if v_sync ~ 'auth\.uid\(\)' then
    raise exception 'qbo_acceptance_actor_subject_sentinel: sync still calls auth.uid() after migration';
  end if;
  if v_sync like '%auth.users%' then
    raise exception 'qbo_acceptance_actor_subject_sentinel: sync must not read auth.users directly (use the definer helper)';
  end if;
  if v_sync not like '%private.current_actor_auth_user_id()%' then
    raise exception 'qbo_acceptance_actor_subject_sentinel: sync does not call the auth-user helper';
  end if;
  if v_qbo not like '%set_config(''request.jwt.claim.sub'', v_actor_subject%' then
    raise exception 'qbo_acceptance_actor_subject_sentinel: bridge does not set jwt sub from the Firebase subject';
  end if;
  if v_qbo not like '%coalesce(u.auth_id, u.firebase_uid)%' then
    raise exception 'qbo_acceptance_actor_subject_sentinel: bridge subject not derived from auth_id/firebase_uid';
  end if;
  if v_qbo like '%request.jwt.claim.email%' then
    raise exception 'qbo_acceptance_actor_subject_sentinel: bridge still sets the email claim after migration';
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- 4. Preserve service-role-only execution on the bridge (idempotent re-assert).
-- ---------------------------------------------------------------------------
revoke all on function public.accept_estimate_to_job_from_quickbooks(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.accept_estimate_to_job_from_quickbooks(
  uuid, uuid, uuid, text, text
) to service_role;

commit;
