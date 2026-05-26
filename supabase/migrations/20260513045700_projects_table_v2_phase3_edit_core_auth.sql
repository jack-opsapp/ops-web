begin;

-- OPS-Web browser requests use the Firebase bridge, which arrives at PostgREST
-- as the anon role with signed Firebase claims. The restrictive edit policy must
-- apply to public, not only authenticated, or browser writes bypass/lose the
-- scoped project permission helper depending on role.
drop policy if exists role_scope_update on public.projects;

create policy role_scope_update
on public.projects
as restrictive
for update
to public
using (private.current_user_can_edit_project(id))
with check (private.current_user_can_edit_project(id));

grant execute on function private.current_user_can_edit_project(uuid) to anon, authenticated;

-- Status editing is part of Phase 3. Team mutation UI is not.
grant execute on function public.change_project_status(uuid, text, timestamptz) to anon, authenticated;
revoke execute on function public.assign_project_team_member(uuid, uuid, uuid[], timestamptz) from anon;
revoke execute on function public.remove_project_team_member(uuid, uuid, uuid[], timestamptz) from anon;

commit;
