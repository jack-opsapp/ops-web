-- ROLLBACK for 20260705184145_drop_assessment_anon_read_policies.
--
-- Re-creates the five anon/public USING(true) policies exactly as they existed
-- before the migration. Running this RE-OPENS the anon PII exposure (662 sessions
-- / 9315 responses / 206 enrollments readable via the public anon key) — only run
-- it to back the change out if a service-role assumption proves wrong in prod.
-- NOT placed in the apply path (rollbacks/ subdir). Run as postgres.

begin;

-- assessment_responses
create policy "responses_select"
  on public.assessment_responses
  for select
  to anon
  using (true);

-- assessment_sessions
create policy "sessions_select_by_token"
  on public.assessment_sessions
  for select
  to anon
  using (true);

create policy "sessions_update_own"
  on public.assessment_sessions
  for update
  to anon
  using (true)
  with check (true);

-- assessment_submissions
create policy "Users can read own submissions"
  on public.assessment_submissions
  for select
  to public
  using (true);

-- enrollments
create policy "Users can read own enrollments"
  on public.enrollments
  for select
  to public
  using (true);

commit;
