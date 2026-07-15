begin;

-- ─────────────────────────────────────────────────────────────────────────
-- Remove anon/public read (+ one update) exposure on the leadership-assessment
-- and learning tables.  [W3 security posture sweep — bug c5ff388e]
--
-- FINDING (verified 2026-07-05 on ijeekuhbatykdomumfjx):
--   Five RLS policies used the predicate `true` for the anon/public roles, so
--   any holder of the public NEXT_PUBLIC_SUPABASE_ANON_KEY could dump these
--   tables straight over the PostgREST REST API:
--     - assessment_responses."responses_select"                 SELECT anon   USING(true)
--     - assessment_sessions."sessions_select_by_token"          SELECT anon   USING(true)   <- name implied token scope; predicate was literally true
--     - assessment_sessions."sessions_update_own"               UPDATE anon   USING(true)/CHECK(true)
--     - assessment_submissions."Users can read own submissions" SELECT public USING(true)
--     - enrollments."Users can read own enrollments"            SELECT public USING(true)
--   assessment_sessions holds real lead PII (email, first_name, ai_analysis).
--
-- WHY THIS IS SAFE (no application change required):
--   Every real access path to these four tables is the SERVICE ROLE, which
--   bypasses RLS (rolbypassrls):
--     - ops-site  — leadership assessment: all reads/writes of
--       assessment_sessions / assessment_responses go through getSupabaseAdmin()
--       (SUPABASE_SERVICE_ROLE_KEY) inside `'use server'` actions
--       (src/lib/assessment/actions.ts). getResults(token) resolves the token
--       server-side and returns data across the server-action boundary; the
--       browser never queries these tables with the anon key.
--     - ops-learn — enrollments / assessment_submissions read via
--       createServiceClient() (service role) in server routes, filtered by the
--       Firebase-verified user_id. Its browser anon client touches none of them.
--   No realtime subscription, view, or anon/authenticated client depends on
--   these policies. They are pure attack surface.
--
-- SENTINEL PROOF (2026-07-05, rolled back — live policies untouched):
--   as anon  BEFORE: sessions=662 responses=9315 submissions=1 enrollments=206
--   as anon  AFTER : sessions=0   responses=0    submissions=0 enrollments=0
--   privileged / service-role sessions=662 (unchanged)
--
-- RLS stays ENABLED on every table; with the permissive SELECT policy removed,
-- anon/authenticated fall through to default-deny. The INSERT policies are left
-- intact (out of this finding's scope) — a further service-role-only lockdown
-- (revoke unused anon/authenticated grants + drop anon INSERT policies) is
-- documented as an optional follow-on in the W3 disposition and the bible.
-- ─────────────────────────────────────────────────────────────────────────

-- Guarantee the end state is secure regardless of prior RLS state (idempotent).
alter table public.assessment_responses   enable row level security;
alter table public.assessment_sessions    enable row level security;
alter table public.assessment_submissions enable row level security;
alter table public.enrollments            enable row level security;

-- assessment_responses: anon could read every response row.
drop policy if exists "responses_select" on public.assessment_responses;

-- assessment_sessions: anon could read every session (email / first_name /
-- ai_analysis) and UPDATE any session. The SELECT policy name implied token
-- scoping that was never implemented (predicate was `true`).
drop policy if exists "sessions_select_by_token" on public.assessment_sessions;
drop policy if exists "sessions_update_own"       on public.assessment_sessions;

-- assessment_submissions: public (anon + authenticated) could read every submission.
drop policy if exists "Users can read own submissions" on public.assessment_submissions;

-- enrollments: public (anon + authenticated) could read every enrollment.
drop policy if exists "Users can read own enrollments" on public.enrollments;

commit;
