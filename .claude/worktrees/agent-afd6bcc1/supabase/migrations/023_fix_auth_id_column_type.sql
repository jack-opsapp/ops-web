-- Migration: Change auth_id from UUID to TEXT
-- Firebase UIDs are not valid UUIDs. The UUID type silently prevents
-- storing Firebase UIDs, causing all API routes that look up users
-- by auth_id to fail with 403 errors.

-- Drop the existing index (depends on UUID type)
DROP INDEX IF EXISTS idx_users_auth;

-- Change column type from UUID to TEXT
ALTER TABLE public.users
  ALTER COLUMN auth_id TYPE TEXT USING auth_id::text;

-- Recreate index on TEXT column
CREATE INDEX idx_users_auth ON public.users(auth_id);
