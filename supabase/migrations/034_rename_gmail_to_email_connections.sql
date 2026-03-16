-- 034_rename_gmail_to_email_connections.sql
-- Rename table and add multi-provider support columns

-- Rename the table
ALTER TABLE gmail_connections RENAME TO email_connections;

-- Add provider column (gmail for all existing rows)
ALTER TABLE email_connections ADD COLUMN provider TEXT NOT NULL DEFAULT 'gmail';

-- Add webhook columns
ALTER TABLE email_connections ADD COLUMN webhook_subscription_id TEXT;
ALTER TABLE email_connections ADD COLUMN webhook_expires_at TIMESTAMPTZ;

-- Add label/category ID for the "OPS Pipeline" label we create in the user's inbox
ALTER TABLE email_connections ADD COLUMN ops_label_id TEXT;

-- Add AI feature flags (per-connection, controlled by admin override)
ALTER TABLE email_connections ADD COLUMN ai_review_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE email_connections ADD COLUMN ai_memory_enabled BOOLEAN NOT NULL DEFAULT false;

-- Add status column (replaces implicit status from syncEnabled)
ALTER TABLE email_connections ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

-- Rename sync_filters to sync_profile (semantic change — now stores pattern detection results, not filter config)
-- Keep the column name as sync_filters for now to avoid breaking existing code.
-- Plan 2 will migrate the JSONB structure and rename when the wizard is rebuilt.

-- Update RLS policies to use new table name
-- (Supabase automatically renames policies when table is renamed, but verify)
