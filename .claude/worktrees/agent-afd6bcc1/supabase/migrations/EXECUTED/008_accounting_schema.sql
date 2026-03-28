-- 008_accounting_schema.sql
-- QuickBooks Online integration: connection state + sync audit log + qb_id columns

-- ─── accounting_connections ──────────────────────────────────────────────────
-- Stores OAuth tokens and sync state for each company's QB connection.

CREATE TABLE IF NOT EXISTS accounting_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  realm_id TEXT,
  is_connected BOOLEAN NOT NULL DEFAULT false,
  last_sync_at TIMESTAMPTZ,
  sync_enabled BOOLEAN NOT NULL DEFAULT false,
  webhook_verifier_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, provider)
);

-- ─── accounting_sync_log ─────────────────────────────────────────────────────
-- Audit trail for every push/pull sync operation.

CREATE TABLE IF NOT EXISTS accounting_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('push', 'pull')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('client', 'estimate', 'invoice', 'payment')),
  entity_id TEXT,
  external_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'skipped')),
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asl_company_created
  ON accounting_sync_log (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_asl_entity
  ON accounting_sync_log (entity_type, entity_id);

-- ─── qb_id columns on existing tables ───────────────────────────────────────
-- Stores the QuickBooks entity ID for each synced OPS record.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS qb_id TEXT;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS qb_id TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qb_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS qb_id TEXT;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Enable RLS (API routes use service role key to bypass).

ALTER TABLE accounting_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_sync_log ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (default when using service role key)
-- No per-user policies needed since portal/dashboard access is via API routes.

-- ─── updated_at trigger ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_accounting_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_accounting_connections_updated_at
  BEFORE UPDATE ON accounting_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_accounting_connections_updated_at();
