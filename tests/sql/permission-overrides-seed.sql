\set ON_ERROR_STOP on
-- Synthetic people, leads and one company mailbox for the permission-override
-- harness. Loaded on top of tests/sql/permission-overrides-fixture.sql; see
-- scripts/test-permission-overrides-postgres.sh. Every name, address and id
-- here is invented (example.test is a reserved domain).
--
-- Harness Deck Co (6e000000-…-a000)
--   a101 Alpha Owner       Owner preset: team.assign_roles, pipeline.* all
--   a102 Bravo Holder      account holder, so a company admin
--   a103 Charlie Office    Office preset: pipeline.* all, no team.assign_roles
--   a104 Delta Crew        Crew preset, carrying the three overrides a real
--                          crew member held when saves broke, one of them on a
--                          scope the editor no longer offers (calendar.edit
--                          assigned)
--   a105 Echo Crew         Crew preset, one override
--   a106 Foxtrot Operator  Operator preset, responsible for five leads: two
--                          open (one a website contact-form email with a
--                          pending first-reply draft), one won, one archived,
--                          one deleted
--   a107 Golf Operator     Operator preset, responsible for one open lead
--   a108 Hotel Crew        Crew preset: cannot see leads, so cannot take one
--   a109 India Inactive    deactivated
--   a110 Lima Spec         Crew preset, carrying the internal SPEC operator
--                          override in its one valid shape (production has one)
--   a111 Mike Moved        Crew preset, carrying an override stamped with
--                          another company (corrupt; the save must refuse)
--   a112 November Spec     Crew preset, carrying a spec.admin override outside
--                          its valid shape (corrupt; the save must refuse)
-- Bystander Rail Co (6e000000-…-b000)
--   b101 Juliet Owner      Owner preset, responsible for one open lead
--   b102 Kilo Holder       account holder

begin;

select pg_catalog.set_config('search_path', '', true);

insert into public.companies (id, name, public_handle, account_holder_id, admin_ids, timezone)
values
  ('6e000000-0000-4000-8000-00000000a000', 'Harness Deck Co', 'harness-deck-co',
   '6e000000-0000-4000-8000-00000000a102', '{}', 'America/Vancouver'),
  ('6e000000-0000-4000-8000-00000000b000', 'Bystander Rail Co', 'bystander-rail-co',
   '6e000000-0000-4000-8000-00000000b102', '{}', 'America/Vancouver');

-- auth_id is the verified token subject the route resolves callers by.
insert into public.users (id, company_id, first_name, last_name, email, role, user_type, is_active, auth_id)
values
  ('6e000000-0000-4000-8000-00000000a101', '6e000000-0000-4000-8000-00000000a000', 'Alpha', 'Owner', 'alpha.owner@example.test', 'owner', 'employee', true, 'harness-auth-a101'),
  ('6e000000-0000-4000-8000-00000000a102', '6e000000-0000-4000-8000-00000000a000', 'Bravo', 'Holder', 'bravo.holder@example.test', 'admin', 'company', true, 'harness-auth-a102'),
  ('6e000000-0000-4000-8000-00000000a103', '6e000000-0000-4000-8000-00000000a000', 'Charlie', 'Office', 'charlie.office@example.test', 'office', 'employee', true, 'harness-auth-a103'),
  ('6e000000-0000-4000-8000-00000000a104', '6e000000-0000-4000-8000-00000000a000', 'Delta', 'Crew', 'delta.crew@example.test', 'crew', 'employee', true, 'harness-auth-a104'),
  ('6e000000-0000-4000-8000-00000000a105', '6e000000-0000-4000-8000-00000000a000', 'Echo', 'Crew', 'echo.crew@example.test', 'crew', 'employee', true, 'harness-auth-a105'),
  ('6e000000-0000-4000-8000-00000000a106', '6e000000-0000-4000-8000-00000000a000', 'Foxtrot', 'Operator', 'foxtrot.operator@example.test', 'operator', 'employee', true, 'harness-auth-a106'),
  ('6e000000-0000-4000-8000-00000000a107', '6e000000-0000-4000-8000-00000000a000', 'Golf', 'Operator', 'golf.operator@example.test', 'operator', 'employee', true, 'harness-auth-a107'),
  ('6e000000-0000-4000-8000-00000000a108', '6e000000-0000-4000-8000-00000000a000', 'Hotel', 'Crew', 'hotel.crew@example.test', 'crew', 'employee', true, 'harness-auth-a108'),
  ('6e000000-0000-4000-8000-00000000a109', '6e000000-0000-4000-8000-00000000a000', 'India', 'Inactive', 'india.inactive@example.test', 'crew', 'employee', false, 'harness-auth-a109'),
  ('6e000000-0000-4000-8000-00000000a110', '6e000000-0000-4000-8000-00000000a000', 'Lima', 'Spec', 'lima.spec@example.test', 'crew', 'employee', true, 'harness-auth-a110'),
  ('6e000000-0000-4000-8000-00000000a111', '6e000000-0000-4000-8000-00000000a000', 'Mike', 'Moved', 'mike.moved@example.test', 'crew', 'employee', true, 'harness-auth-a111'),
  ('6e000000-0000-4000-8000-00000000a112', '6e000000-0000-4000-8000-00000000a000', 'November', 'Spec', 'november.spec@example.test', 'crew', 'employee', true, 'harness-auth-a112'),
  ('6e000000-0000-4000-8000-00000000b101', '6e000000-0000-4000-8000-00000000b000', 'Juliet', 'Owner', 'juliet.owner@example.test', 'owner', 'employee', true, 'harness-auth-b101'),
  ('6e000000-0000-4000-8000-00000000b102', '6e000000-0000-4000-8000-00000000b000', 'Kilo', 'Holder', 'kilo.holder@example.test', 'admin', 'company', true, 'harness-auth-b102');

-- Preset role ids are production's (see the fixture's reference data).
insert into public.user_roles (user_id, role_id)
values
  ('6e000000-0000-4000-8000-00000000a101', '00000000-0000-0000-0000-000000000002'),
  ('6e000000-0000-4000-8000-00000000a102', '00000000-0000-0000-0000-000000000001'),
  ('6e000000-0000-4000-8000-00000000a103', '00000000-0000-0000-0000-000000000003'),
  ('6e000000-0000-4000-8000-00000000a104', '00000000-0000-0000-0000-000000000005'),
  ('6e000000-0000-4000-8000-00000000a105', '00000000-0000-0000-0000-000000000005'),
  ('6e000000-0000-4000-8000-00000000a106', '00000000-0000-0000-0000-000000000004'),
  ('6e000000-0000-4000-8000-00000000a107', '00000000-0000-0000-0000-000000000004'),
  ('6e000000-0000-4000-8000-00000000a108', '00000000-0000-0000-0000-000000000005'),
  ('6e000000-0000-4000-8000-00000000a109', '00000000-0000-0000-0000-000000000005'),
  ('6e000000-0000-4000-8000-00000000a110', '00000000-0000-0000-0000-000000000005'),
  ('6e000000-0000-4000-8000-00000000a111', '00000000-0000-0000-0000-000000000005'),
  ('6e000000-0000-4000-8000-00000000a112', '00000000-0000-0000-0000-000000000005'),
  ('6e000000-0000-4000-8000-00000000b101', '00000000-0000-0000-0000-000000000002'),
  ('6e000000-0000-4000-8000-00000000b102', '00000000-0000-0000-0000-000000000001');

-- Overrides that predate the guarded save (direct writes, as production's were).
insert into public.user_permission_overrides (user_id, company_id, permission, scope, granted)
values
  ('6e000000-0000-4000-8000-00000000a104', '6e000000-0000-4000-8000-00000000a000', 'calendar.edit', 'assigned', true),
  ('6e000000-0000-4000-8000-00000000a104', '6e000000-0000-4000-8000-00000000a000', 'deck_builder.view', 'all', true),
  ('6e000000-0000-4000-8000-00000000a104', '6e000000-0000-4000-8000-00000000a000', 'projects.edit', 'assigned', true),
  ('6e000000-0000-4000-8000-00000000a105', '6e000000-0000-4000-8000-00000000a000', 'deck_builder.view', 'all', true);

-- A connected company mailbox, so every override change also queues the
-- email-signature reconciliation the way it does for a connected company.
insert into public.email_connections (id, company_id, type, email, access_token, refresh_token, expires_at)
values ('6e000000-0000-4000-8000-00000000e001', '6e000000-0000-4000-8000-00000000a000', 'company',
        'office@example.test', 'harness-access-token', 'harness-refresh-token', '2030-01-01T00:00:00Z');

-- Leads start unassigned (the only direct insert the assignment guard allows)
-- and are then assigned through production's own system assignment path.
insert into public.opportunities (id, company_id, title, stage)
values
  ('6e000000-0000-4000-8000-00000000c001', '6e000000-0000-4000-8000-00000000a000', 'Harness lead one', 'new_lead'),
  ('6e000000-0000-4000-8000-00000000c003', '6e000000-0000-4000-8000-00000000a000', 'Harness won lead', 'new_lead'),
  ('6e000000-0000-4000-8000-00000000c004', '6e000000-0000-4000-8000-00000000a000', 'Harness archived lead', 'new_lead'),
  ('6e000000-0000-4000-8000-00000000c005', '6e000000-0000-4000-8000-00000000a000', 'Harness deleted lead', 'new_lead'),
  ('6e000000-0000-4000-8000-00000000c006', '6e000000-0000-4000-8000-00000000a000', 'Harness receiver lead', 'new_lead'),
  ('6e000000-0000-4000-8000-00000000c101', '6e000000-0000-4000-8000-00000000b000', 'Bystander lead', 'new_lead');

-- Lead two arrived as a website contact-form email on the company mailbox,
-- the way most leads reach a trades company. Its source message is logged
-- before the lead is assigned, so assigning it queues a first-reply draft for
-- whoever holds it.
insert into public.opportunities (id, company_id, title, stage, source, source_thread_key, contact_name, contact_email)
values ('6e000000-0000-4000-8000-00000000c002', '6e000000-0000-4000-8000-00000000a000', 'Harness lead two', 'quoting', 'email',
        'email:gmail:6e000000-0000-4000-8000-00000000e001:message:harness-message-1', 'Test Visitor', 'visitor@example.test');
insert into public.activities (id, company_id, opportunity_id, type, direction, subject, body_text,
                               email_connection_id, email_message_id, email_thread_id, from_email, created_at)
values ('6e000000-0000-4000-8000-00000000d001', '6e000000-0000-4000-8000-00000000a000', '6e000000-0000-4000-8000-00000000c002',
        'email', 'inbound', 'New submission from Contact us',
        E'New contact form submission\nName: Test Visitor\nEmail: visitor@example.test\nMessage: Quote for a new deck railing.',
        '6e000000-0000-4000-8000-00000000e001', 'harness-message-1', 'harness-thread-1', 'visitor@example.test',
        '2026-09-01T16:00:00Z');

select pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.change_opportunity_assignment_as_system(
  p_opportunity_id => lead.id,
  p_expected_assignment_version => 0,
  p_expected_assigned_to => null,
  p_new_assigned_to => lead.assignee,
  p_system_source => 'admin_correction',
  p_actor_user_id => lead.actor,
  p_suggestion_id => null,
  p_metadata => '{}'::jsonb
)
from (values
  ('6e000000-0000-4000-8000-00000000c001'::uuid, '6e000000-0000-4000-8000-00000000a106'::uuid, '6e000000-0000-4000-8000-00000000a101'::uuid),
  ('6e000000-0000-4000-8000-00000000c002', '6e000000-0000-4000-8000-00000000a106', '6e000000-0000-4000-8000-00000000a101'),
  ('6e000000-0000-4000-8000-00000000c003', '6e000000-0000-4000-8000-00000000a106', '6e000000-0000-4000-8000-00000000a101'),
  ('6e000000-0000-4000-8000-00000000c004', '6e000000-0000-4000-8000-00000000a106', '6e000000-0000-4000-8000-00000000a101'),
  ('6e000000-0000-4000-8000-00000000c005', '6e000000-0000-4000-8000-00000000a106', '6e000000-0000-4000-8000-00000000a101'),
  ('6e000000-0000-4000-8000-00000000c006', '6e000000-0000-4000-8000-00000000a107', '6e000000-0000-4000-8000-00000000a101'),
  ('6e000000-0000-4000-8000-00000000c101', '6e000000-0000-4000-8000-00000000b101', '6e000000-0000-4000-8000-00000000b102')
) as lead(id, assignee, actor)
order by lead.id;

-- Responsibility that a permission change must never touch: closed, archived
-- and deleted leads keep their assignee.
update public.opportunities set stage = 'won' where id = '6e000000-0000-4000-8000-00000000c003';
update public.opportunities set archived_at = '2026-09-01T00:00:00Z' where id = '6e000000-0000-4000-8000-00000000c004';
update public.opportunities set deleted_at = '2026-09-01T00:00:00Z' where id = '6e000000-0000-4000-8000-00000000c005';

commit;

-- Override shapes the save's own guards exist for. Written with triggers off:
-- the commit-time guard rightly refuses to create any of them directly (the
-- valid SPEC row reaches production through a privileged migration), and the
-- two corrupt rows model data the save must refuse to build on.
begin;
set local session_replication_role = replica;
insert into public.user_permission_overrides (user_id, company_id, permission, scope, granted)
values
  ('6e000000-0000-4000-8000-00000000a110', '00000000-0000-0000-0000-00000000000a', 'spec.admin', 'all', true),
  ('6e000000-0000-4000-8000-00000000a111', '6e000000-0000-4000-8000-00000000b000', 'projects.edit', 'assigned', true),
  ('6e000000-0000-4000-8000-00000000a112', '6e000000-0000-4000-8000-00000000a000', 'spec.admin', 'all', true);
commit;

do $seed_check$
begin
  if (select count(*) from public.opportunities where assigned_to is not null and assignment_version = 1) <> 7 then
    raise exception 'permission override seed: expected seven assigned leads at version 1';
  end if;
  if (select count(*) from public.user_permission_overrides) <> 7 then
    raise exception 'permission override seed: expected seven existing overrides';
  end if;
  if (select count(*) from public.email_assignment_contact_form_draft_queue
       where opportunity_id = '6e000000-0000-4000-8000-00000000c002'
         and actor_user_id = '6e000000-0000-4000-8000-00000000a106'
         and status = 'pending') <> 1 then
    raise exception 'permission override seed: expected a pending first-reply draft for lead two';
  end if;
end
$seed_check$;

select 'permission override seed ready';
