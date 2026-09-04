-- agent.review — granular gate for the Agent Queue (/agent/queue and
-- /api/agent/queue*). Replaces the account-holder/admin_ids manager check
-- on the queue routes with a real RBAC key so custom roles and per-user
-- overrides can grant review access. Granted to preset Admin, Owner, Office.
-- Operator/Crew/Unassigned are not granted; company admins and the account
-- holder still bypass inside public.has_permission.

insert into public.role_permissions (role_id, permission, scope)
select r.id, 'agent.review', 'all'
  from public.roles r
 where r.company_id is null
   and r.id in (
     '00000000-0000-0000-0000-000000000001', -- Admin
     '00000000-0000-0000-0000-000000000002', -- Owner
     '00000000-0000-0000-0000-000000000003'  -- Office
   )
on conflict (role_id, permission) do nothing;

-- Register the key for the product permission editor so per-user overrides
-- (public.user_permission_overrides) may set or clear it.
insert into private.lead_permission_editor_registry (permission, scopes)
values ('agent.review', array['all'])
on conflict (permission) do nothing;
