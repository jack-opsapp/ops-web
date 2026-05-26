begin;

-- OPS-Web authenticates with Firebase JWTs. PostgREST evaluates those
-- browser requests through the anon database role, then RLS resolves the
-- public.users row from auth.jwt()->>'email'. Phase 2 is read-only, so the
-- Firebase bridge gets SELECT on the v2 read surfaces and nothing else.

grant select on table public.project_views to anon;
grant select on table public.project_table_rows to anon;

revoke insert, update, delete on table public.project_views from anon;
revoke insert, update, delete on table public.project_table_rows from anon;

revoke execute on function public.change_project_status(uuid, text, timestamptz) from anon;
revoke execute on function public.assign_project_team_member(uuid, uuid, uuid[], timestamptz) from anon;
revoke execute on function public.remove_project_team_member(uuid, uuid, uuid[], timestamptz) from anon;

drop policy if exists "users read company and own views" on public.project_views;
create policy "users read company and own views"
on public.project_views for select
to public
using (
  company_id = (select company_id from public.users where id = (select private.get_current_user_id()))
  and (
    owner_type = 'company'
    or (owner_type = 'user' and owner_id = (select private.get_current_user_id()))
  )
  and (
    permission_key is null
    or public.has_permission((select private.get_current_user_id()), permission_key, 'all')
  )
);

commit;
