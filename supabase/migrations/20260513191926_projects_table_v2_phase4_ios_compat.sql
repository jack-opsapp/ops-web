begin;

-- iOS still queues direct project_tasks inserts through the Firebase/Supabase
-- bridge, which arrives at PostgREST as anon. Keep that compatibility path,
-- but require the task's project to resolve inside the current OPS company.
drop policy if exists "project tasks insert requires same-company project" on public.project_tasks;
create policy "project tasks insert requires same-company project"
on public.project_tasks
as restrictive
for insert
to public
with check (
  exists (
    select 1
    from public.projects p
    where p.id = project_id
      and p.deleted_at is null
      and p.company_id = (select private.get_user_company_id())
  )
);

grant insert on table public.project_tasks to anon;
revoke delete on table public.project_tasks from anon;

alter type public.photo_source add value if not exists 'deck_design';

commit;
