-- create_progress_invoice: resolve the caller via the Firebase-safe identity
-- helper instead of raw auth.uid().
--
-- public.create_progress_invoice authorized the caller with
--   SELECT company_id INTO v_caller_company FROM users WHERE auth_id = auth.uid();
-- auth.uid() casts the request.jwt 'sub' claim to uuid. Post
-- crit3_phase_c_rekey_rls_identity_helpers (2026-06-14) 'sub' is the Firebase
-- subject (a non-uuid) for every bridged client session, so the cast raises
-- 22P02 ("invalid input syntax for type uuid") and the RPC throws before doing
-- any work. This is the same class of regression fixed for the QBO acceptance
-- bridge; create_progress_invoice is a user-callable RPC (granted to
-- anon/authenticated) so it is reachable by Firebase-subject sessions.
--
-- FIX: resolve the caller's company through private.get_user_company_id(), the
-- canonical crit3 helper that matches 'sub' against public.users.auth_id OR
-- firebase_uid (and filters deleted_at / null company). Identical authorization
-- intent, no uuid cast. Idempotent + sentinel-guarded. Grants unchanged.

begin;

do $do$
declare
  v_functiondef text;
begin
  v_functiondef := pg_get_functiondef(
    'public.create_progress_invoice(uuid, jsonb)'::regprocedure
  );

  if v_functiondef ~ 'auth\.uid\(\)' then
    v_functiondef := replace(
      v_functiondef,
$old$  SELECT company_id INTO v_caller_company
  FROM users
  WHERE auth_id = auth.uid();$old$,
$new$  -- CRIT-3: resolve the caller's company via the Firebase-safe identity helper
  -- instead of the uid() builtin, which casts the request.jwt subject to uuid
  -- and throws 22P02 for Firebase-bridge (non-uuid) sessions.
  v_caller_company := private.get_user_company_id();$new$
    );

    if v_functiondef ~ 'auth\.uid\(\)' then
      raise exception
        'crit3_progress_invoice_sentinel: failed to remove auth.uid() from create_progress_invoice';
    end if;

    if v_functiondef not like '%v_caller_company := private.get_user_company_id();%' then
      raise exception
        'crit3_progress_invoice_sentinel: helper resolution patch did not apply';
    end if;

    execute v_functiondef;
  end if;
end
$do$;

-- Post-condition: assert the live definition reflects the fix.
do $do$
declare
  v_def text := pg_get_functiondef('public.create_progress_invoice(uuid, jsonb)'::regprocedure);
begin
  if v_def ~ 'auth\.uid\(\)' then
    raise exception 'crit3_progress_invoice_sentinel: create_progress_invoice still calls auth.uid() after migration';
  end if;
  if v_def not like '%v_caller_company := private.get_user_company_id();%' then
    raise exception 'crit3_progress_invoice_sentinel: caller company not resolved via private.get_user_company_id()';
  end if;
end
$do$;

commit;
