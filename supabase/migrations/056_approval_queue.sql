-- 056_approval_queue.sql
-- Sprint P1: Approval Queue for agent-proposed actions.
-- Central infrastructure for all autonomous agent actions (projects, tasks, invoices, emails).
-- Fully idempotent — safe to re-run.

-- ═══════════════════════════════════════════════════════════════════════════════
-- Table: agent_actions
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,

  -- What the agent wants to do
  action_type TEXT NOT NULL,        -- 'create_project', 'create_task', 'create_invoice', 'send_email', etc.
  action_data JSONB NOT NULL,       -- full payload to execute if approved

  -- Why the agent wants to do it
  context_summary TEXT NOT NULL,    -- human-readable explanation
  context_source TEXT,              -- 'email_thread', 'schedule_gap', 'overdue_task', etc.
  source_id TEXT,                   -- reference to triggering entity (thread_id, task_id, etc.)

  -- Confidence and priority
  confidence FLOAT NOT NULL DEFAULT 0.5,
  priority TEXT NOT NULL DEFAULT 'normal',

  -- Status lifecycle
  status TEXT NOT NULL DEFAULT 'pending',

  -- Review tracking
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,

  -- Execution tracking
  executed_at TIMESTAMPTZ,
  execution_result JSONB,
  error TEXT,

  -- Metadata
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Constraints
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_actions_status_check'
  ) THEN
    ALTER TABLE agent_actions ADD CONSTRAINT agent_actions_status_check
      CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'failed', 'expired', 'cancelled'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_actions_priority_check'
  ) THEN
    ALTER TABLE agent_actions ADD CONSTRAINT agent_actions_priority_check
      CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Row-Level Security
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE agent_actions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'agent_actions_company_scope' AND tablename = 'agent_actions'
  ) THEN
    CREATE POLICY agent_actions_company_scope ON agent_actions
      FOR ALL USING (company_id = (auth.jwt()->>'company_id')::uuid);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Indexes
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_agent_actions_company_status
  ON agent_actions(company_id, status);

CREATE INDEX IF NOT EXISTS idx_agent_actions_user_status
  ON agent_actions(user_id, status);

CREATE INDEX IF NOT EXISTS idx_agent_actions_type
  ON agent_actions(action_type);

CREATE INDEX IF NOT EXISTS idx_agent_actions_expires
  ON agent_actions(expires_at)
  WHERE status = 'pending';

-- Deduplication index: prevent identical pending actions for the same source
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_actions_dedup
  ON agent_actions(company_id, action_type, source_id)
  WHERE status = 'pending' AND source_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- updated_at trigger
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_agent_actions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_actions_updated_at ON agent_actions;
CREATE TRIGGER trg_agent_actions_updated_at
  BEFORE UPDATE ON agent_actions
  FOR EACH ROW
  EXECUTE FUNCTION update_agent_actions_updated_at();
