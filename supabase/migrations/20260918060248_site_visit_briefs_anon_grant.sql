-- CREW SITE VISITS P1: the iOS app reaches PostgREST as the Postgres `anon`
-- role (identity rides in the JWT and is resolved by
-- private.get_current_user_id()), exactly like its other site-visit RPCs
-- (save_site_visit_capture, complete_site_visit_guarded are granted to anon
-- and authenticated). read_site_visit_briefs refuses any caller it cannot
-- resolve to a user (42501), so granting anon adds no unauthenticated access.
grant execute on function public.read_site_visit_briefs(uuid[]) to anon;
