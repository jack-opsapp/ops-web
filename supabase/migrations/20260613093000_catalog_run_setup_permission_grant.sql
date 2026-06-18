-- catalog.run_setup — the granular gate for launching the Catalog Setup Wizard.
-- Granted to preset roles that manage the catalog. (Account-holders / company
-- admins derive perms from the client ALL_PERMISSIONS list, NOT this table, so
-- they are covered by the permissions.ts registration, not this grant.)
--
-- FILES ONLY — DO NOT APPLY without Jackson's explicit per-action go-ahead.
--
-- CONFIRM-AT-EXECUTION (read-only, run BEFORE relying on `on conflict`):
--   -- verify the on-conflict target is (role_id, permission):
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conrelid='public.role_permissions'::regclass and contype in ('p','u');
--   -- confirm scope convention for the existing catalog.* namespace:
--   select permission, scope from role_permissions where permission like 'catalog%' limit 5;
-- If the unique key differs from (role_id, permission), adjust the on-conflict
-- clause below before apply.
--
-- VERIFY-BEFORE (read-only; expected: EMPTY set):
--   select role_id, scope from role_permissions where permission='catalog.run_setup';
-- VERIFY-AFTER: same query → three rows (admin/owner/office presets).
--
-- ROLLBACK:
--   delete from public.role_permissions where permission='catalog.run_setup';
begin;

insert into public.role_permissions (role_id, permission, scope)
values
  ('00000000-0000-0000-0000-000000000001','catalog.run_setup','all'), -- ADMIN preset
  ('00000000-0000-0000-0000-000000000002','catalog.run_setup','all'), -- OWNER preset
  ('00000000-0000-0000-0000-000000000003','catalog.run_setup','all')  -- OFFICE preset
on conflict (role_id, permission) do nothing;

do $$
begin
  if not exists (
    select 1 from public.role_permissions
    where role_id = '00000000-0000-0000-0000-000000000003'
      and permission = 'catalog.run_setup'
  ) then
    raise exception 'catalog_run_setup_grant_sentinel: OFFICE preset grant missing';
  end if;
end $$;

commit;
