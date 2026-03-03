-- Migration 019: Add sage_id columns to accounting-synced tables
-- QuickBooks qb_id columns already exist; this adds parallel Sage IDs

ALTER TABLE clients ADD COLUMN IF NOT EXISTS sage_id TEXT;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS sage_id TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sage_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS sage_id TEXT;
