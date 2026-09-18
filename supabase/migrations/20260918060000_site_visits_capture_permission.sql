-- CREW SITE VISITS P1 (2026-09-18), part B: register and grant the
-- site_visits.capture permission ("Start site visits"). Ships in the same
-- window as the OPS-Web release that adds it to src/lib/types/permissions.ts:
-- replace_role_permissions_as_system requires the web registry to match
-- private.lead_permission_editor_registry exactly, so either side alone breaks
-- web role saves until the other lands. Independent of part A (the permission
-- only widens who may start a walk-up visit); every statement is idempotent.

-- Registered for the editors, granted to every preset role that fields work,
-- and governed by the pipeline feature flag.
insert into private.lead_permission_editor_registry (permission, scopes)
values ('site_visits.capture', array['all'])
on conflict (permission) do nothing;

insert into public.role_permissions (role_id, permission, scope)
select preset.role_id, 'site_visits.capture', 'all'
  from (values
    ('00000000-0000-0000-0000-000000000001'::uuid),
    ('00000000-0000-0000-0000-000000000002'::uuid),
    ('00000000-0000-0000-0000-000000000003'::uuid),
    ('00000000-0000-0000-0000-000000000004'::uuid),
    ('00000000-0000-0000-0000-000000000005'::uuid)
  ) as preset(role_id)
  join public.roles r on r.id = preset.role_id and r.is_preset
on conflict (role_id, permission) do nothing;

update public.feature_flags
   set permissions = array_append(coalesce(permissions, '{}'::text[]), 'site_visits.capture')
 where slug = 'pipeline'
   and not ('site_visits.capture' = any(coalesce(permissions, '{}'::text[])));
