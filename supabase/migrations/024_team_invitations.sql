-- =================================================================
-- Migration 024: Team Invitations
--
-- Stores pending team invitations with role assignment.
-- When a user joins via invite, the join-company API looks up
-- their pending invitation and auto-assigns the RBAC role.
-- =================================================================

CREATE TABLE IF NOT EXISTS team_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email TEXT,
  phone TEXT,
  role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  invite_code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT email_or_phone CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- Index for lookup during join-company
CREATE INDEX idx_team_invitations_email ON team_invitations (email) WHERE status = 'pending';
CREATE INDEX idx_team_invitations_phone ON team_invitations (phone) WHERE status = 'pending';
CREATE INDEX idx_team_invitations_company ON team_invitations (company_id) WHERE status = 'pending';

-- RLS
ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;

-- Company members can view their company's invitations
CREATE POLICY "team_invitations_select" ON team_invitations
  FOR SELECT USING (
    company_id IN (SELECT company_id FROM users WHERE auth_id = auth.uid())
  );

-- Users with team.manage permission can insert/update
CREATE POLICY "team_invitations_insert" ON team_invitations
  FOR INSERT WITH CHECK (
    company_id IN (SELECT company_id FROM users WHERE auth_id = auth.uid())
  );

CREATE POLICY "team_invitations_update" ON team_invitations
  FOR UPDATE USING (
    company_id IN (SELECT company_id FROM users WHERE auth_id = auth.uid())
  );
