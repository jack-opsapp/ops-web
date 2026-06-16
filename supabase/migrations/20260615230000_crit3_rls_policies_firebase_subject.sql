-- RLS policies: resolve the actor via the Firebase-safe identity scheme instead
-- of auth.uid().
--
-- Six policies across four tables still evaluate auth.uid() (which casts the
-- request.jwt 'sub' claim to uuid). Post crit3_phase_c_rekey_rls_identity_helpers
-- 'sub' is the Firebase subject (a non-uuid) for every bridged client session, so
-- auth.uid() raises 22P02 ("invalid input syntax for type uuid") during policy
-- evaluation -- which aborts the entire query. All four tables have RLS enabled
-- and are granted directly to anon/authenticated, so these tables are currently
-- unusable by Firebase-subject clients:
--   * task_recurrences / task_recurrence_exceptions (cmd ALL)         -- pre-crit3
--   * duplicate_reviews (SELECT + UPDATE)                              -- pre-crit3
--   * data_setup_requests (INSERT + admin UPDATE)                      -- half-migrated
--
-- FIX (crit3-aligned, company-isolation semantics unchanged):
--   * `users.id = auth.uid()`        -> `users.id = private.get_current_user_id()`
--   * `(auth.uid())::text`           -> `(auth.jwt() ->> 'sub')`
-- get_current_user_id() resolves the caller's public.users.id by matching 'sub'
-- against auth_id/firebase_uid; (auth.jwt() ->> 'sub') is the raw text subject the
-- auth_id/firebase_uid columns hold. No uuid cast, no behavioural change for the
-- (already-correct) company_id = private.get_user_company_id() clauses.
-- Idempotent (explicit target expressions) + sentinel-guarded.

begin;

set local search_path = public, private, pg_temp;

-- 1. task_recurrences (ALL)
alter policy task_recurrences_company_isolation on public.task_recurrences
  using (
    company_id in (
      select users.company_id from users where users.id = private.get_current_user_id()
    )
  );

-- 2. task_recurrence_exceptions (ALL)
alter policy task_recurrence_exceptions_company_isolation on public.task_recurrence_exceptions
  using (
    recurrence_id in (
      select task_recurrences.id from task_recurrences
      where task_recurrences.company_id in (
        select users.company_id from users where users.id = private.get_current_user_id()
      )
    )
  );

-- 3. duplicate_reviews (SELECT)
alter policy "Users can view own company reviews" on public.duplicate_reviews
  using (
    company_id in (
      select users.company_id from users where users.id = private.get_current_user_id()
    )
  );

-- 4. duplicate_reviews (UPDATE)
alter policy "Users can update own company reviews" on public.duplicate_reviews
  using (
    company_id in (
      select users.company_id from users where users.id = private.get_current_user_id()
    )
  );

-- 5. data_setup_requests (INSERT)
alter policy data_setup_requests_insert_company on public.data_setup_requests
  with check (
    company_id = (select private.get_user_company_id())
    and requested_by in (
      select users.id from users
      where users.auth_id = (auth.jwt() ->> 'sub')
         or users.firebase_uid = (auth.jwt() ->> 'sub')
    )
  );

-- 6. data_setup_requests (admin UPDATE)
alter policy data_setup_requests_update_admin on public.data_setup_requests
  using (
    company_id = (select private.get_user_company_id())
    and exists (
      select 1 from users u
      where (u.auth_id = (auth.jwt() ->> 'sub') or u.firebase_uid = (auth.jwt() ->> 'sub'))
        and u.company_id = data_setup_requests.company_id
        and u.is_company_admin = true
    )
  )
  with check (
    company_id = (select private.get_user_company_id())
    and exists (
      select 1 from users u
      where (u.auth_id = (auth.jwt() ->> 'sub') or u.firebase_uid = (auth.jwt() ->> 'sub'))
        and u.company_id = data_setup_requests.company_id
        and u.is_company_admin = true
    )
  );

-- Sentinel: none of the six target policies may reference the uid() builtin now.
do $do$
declare
  v_bad int;
begin
  select count(*) into v_bad
  from pg_policies
  where schemaname = 'public'
    and (schemaname, tablename, policyname) in (
      ('public','task_recurrences','task_recurrences_company_isolation'),
      ('public','task_recurrence_exceptions','task_recurrence_exceptions_company_isolation'),
      ('public','duplicate_reviews','Users can view own company reviews'),
      ('public','duplicate_reviews','Users can update own company reviews'),
      ('public','data_setup_requests','data_setup_requests_insert_company'),
      ('public','data_setup_requests','data_setup_requests_update_admin')
    )
    and (coalesce(qual, '') ~ 'auth\.uid\(\)' or coalesce(with_check, '') ~ 'auth\.uid\(\)');

  if v_bad > 0 then
    raise exception 'crit3_rls_subject_sentinel: % target policy expression(s) still call the uid() builtin', v_bad;
  end if;
end
$do$;

commit;
