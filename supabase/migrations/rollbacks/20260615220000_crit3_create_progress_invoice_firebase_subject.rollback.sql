-- ROLLBACK for 20260615220000_crit3_create_progress_invoice_firebase_subject.
--
-- Restores the original auth.uid()-based caller authorization in
-- public.create_progress_invoice. This re-introduces the crit3 regression
-- (the RPC will throw 22P02 for Firebase-bridge sessions), so only run it to
-- back the fix out. Not in the apply path (rollbacks/ subdir). Run as postgres.

begin;

do $do$
declare
  v_functiondef text;
begin
  v_functiondef := pg_get_functiondef(
    'public.create_progress_invoice(uuid, jsonb)'::regprocedure
  );

  if v_functiondef like '%v_caller_company := private.get_user_company_id();%' then
    v_functiondef := replace(
      v_functiondef,
$new$  -- CRIT-3: resolve the caller's company via the Firebase-safe identity helper
  -- instead of the uid() builtin, which casts the request.jwt subject to uuid
  -- and throws 22P02 for Firebase-bridge (non-uuid) sessions.
  v_caller_company := private.get_user_company_id();$new$,
$old$  SELECT company_id INTO v_caller_company
  FROM users
  WHERE auth_id = auth.uid();$old$
    );
    execute v_functiondef;
  end if;
end
$do$;

commit;
