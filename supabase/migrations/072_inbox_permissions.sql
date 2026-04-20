-- ─────────────────────────────────────────────────────────────────────────────
-- 072_inbox_permissions.sql
-- Inbox v2 Permissions
--
-- Seeds the `inbox.*` permission namespace into role_permissions for the five
-- preset roles. role_permissions.permission is TEXT (not an enum), so no
-- type extension is needed — we insert the string values directly.
--
-- Gates for the rebuilt inbox at /inbox: view, view_company (sees all company
-- mail, not just the user's own connection), archive, snooze, categorize,
-- send, and configure_phase_c (per-category Phase C autonomy settings).
--
-- Role grant matrix:
--   - inbox.view             : Admin, Owner, Office, Operator
--   - inbox.view_company     : Admin, Owner, Office       (sees everyone's mail)
--   - inbox.archive          : Admin, Owner, Office, Operator
--   - inbox.snooze           : Admin, Owner, Office, Operator
--   - inbox.categorize       : Admin, Owner, Office
--   - inbox.send             : Admin, Owner, Office
--   - inbox.configure_phase_c: Admin, Owner                (owner-only config)
-- ─────────────────────────────────────────────────────────────────────────────

-- Preset role UUIDs (from 015_permissions_system.sql):
--   Admin    = 00000000-0000-0000-0000-000000000001
--   Owner    = 00000000-0000-0000-0000-000000000002
--   Office   = 00000000-0000-0000-0000-000000000003
--   Operator = 00000000-0000-0000-0000-000000000004
--   Crew     = 00000000-0000-0000-0000-000000000005

INSERT INTO role_permissions (role_id, permission, scope) VALUES
  -- Admin — full access
  ('00000000-0000-0000-0000-000000000001', 'inbox.view', 'all'),
  ('00000000-0000-0000-0000-000000000001', 'inbox.view_company', 'all'),
  ('00000000-0000-0000-0000-000000000001', 'inbox.archive', 'all'),
  ('00000000-0000-0000-0000-000000000001', 'inbox.snooze', 'all'),
  ('00000000-0000-0000-0000-000000000001', 'inbox.categorize', 'all'),
  ('00000000-0000-0000-0000-000000000001', 'inbox.send', 'all'),
  ('00000000-0000-0000-0000-000000000001', 'inbox.configure_phase_c', 'all'),
  -- Owner — full access
  ('00000000-0000-0000-0000-000000000002', 'inbox.view', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'inbox.view_company', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'inbox.archive', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'inbox.snooze', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'inbox.categorize', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'inbox.send', 'all'),
  ('00000000-0000-0000-0000-000000000002', 'inbox.configure_phase_c', 'all'),
  -- Office — full operational access, no Phase C config
  ('00000000-0000-0000-0000-000000000003', 'inbox.view', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'inbox.view_company', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'inbox.archive', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'inbox.snooze', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'inbox.categorize', 'all'),
  ('00000000-0000-0000-0000-000000000003', 'inbox.send', 'all'),
  -- Operator — triage own mail (view, archive, snooze) but can't send or recategorize
  ('00000000-0000-0000-0000-000000000004', 'inbox.view', 'all'),
  ('00000000-0000-0000-0000-000000000004', 'inbox.archive', 'all'),
  ('00000000-0000-0000-0000-000000000004', 'inbox.snooze', 'all')
ON CONFLICT (role_id, permission) DO NOTHING;
