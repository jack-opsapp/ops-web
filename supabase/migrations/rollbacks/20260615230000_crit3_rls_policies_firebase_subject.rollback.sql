-- ROLLBACK for 20260615230000_crit3_rls_policies_firebase_subject.
--
-- Restores the original auth.uid()-based expressions on the six policies. This
-- re-introduces the crit3 regression (these four tables throw 22P02 for
-- Firebase-bridge sessions again), so only run it to back the fix out. Not in
-- the apply path (rollbacks/ subdir). Run as postgres.

begin;

set local search_path = public, private, pg_temp;

alter policy task_recurrences_company_isolation on public.task_recurrences
  using (
    company_id in (select users.company_id from users where users.id = auth.uid())
  );

alter policy task_recurrence_exceptions_company_isolation on public.task_recurrence_exceptions
  using (
    recurrence_id in (
      select task_recurrences.id from task_recurrences
      where task_recurrences.company_id in (
        select users.company_id from users where users.id = auth.uid()
      )
    )
  );

alter policy "Users can view own company reviews" on public.duplicate_reviews
  using (
    company_id in (select users.company_id from users where users.id = auth.uid())
  );

alter policy "Users can update own company reviews" on public.duplicate_reviews
  using (
    company_id in (select users.company_id from users where users.id = auth.uid())
  );

alter policy data_setup_requests_insert_company on public.data_setup_requests
  with check (
    company_id = (select private.get_user_company_id())
    and requested_by in (
      select users.id from users
      where users.auth_id = (auth.uid())::text or users.firebase_uid = (auth.uid())::text
    )
  );

alter policy data_setup_requests_update_admin on public.data_setup_requests
  using (
    company_id = (select private.get_user_company_id())
    and exists (
      select 1 from users u
      where (u.auth_id = (auth.uid())::text or u.firebase_uid = (auth.uid())::text)
        and u.company_id = data_setup_requests.company_id
        and u.is_company_admin = true
    )
  )
  with check (
    company_id = (select private.get_user_company_id())
    and exists (
      select 1 from users u
      where (u.auth_id = (auth.uid())::text or u.firebase_uid = (auth.uid())::text)
        and u.company_id = data_setup_requests.company_id
        and u.is_company_admin = true
    )
  );

commit;
