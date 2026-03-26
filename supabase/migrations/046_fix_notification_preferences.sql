-- Migration 046: Fix notification_preferences table
--
-- Problem 1: user_id FK referenced auth.users(id) instead of public.users(id).
-- The app stores public.users.id as user_id, but the FK expected auth.users.id
-- (a different UUID). Every insert violated the FK — the table had 0 rows.
--
-- Problem 2: channel_preferences JSONB column from migration 042 was never applied.
--
-- Problem 3: RLS policies originally used auth.uid() which fails with Firebase UIDs.
-- These were already fixed in production (changed to resolve_uid()), but the migration
-- file (018) was never updated. This migration documents the correct state.

-- ─── Fix FK constraint ──────────────────────────────────────────────────────────

ALTER TABLE notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_user_id_fkey;

ALTER TABLE notification_preferences
  ADD CONSTRAINT notification_preferences_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- ─── Add missing channel_preferences column ─────────────────────────────────────

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS channel_preferences JSONB DEFAULT '{
    "task_assigned": {"push": true, "email": false},
    "task_completed": {"push": true, "email": false},
    "schedule_changes": {"push": true, "email": false},
    "project_updates": {"push": true, "email": true},
    "expense_submitted": {"push": true, "email": true},
    "expense_approved": {"push": true, "email": true},
    "invoice_sent": {"push": true, "email": false},
    "payment_received": {"push": true, "email": true},
    "team_mentions": {"push": true, "email": false},
    "daily_digest": {"push": false, "email": false}
  }'::jsonb;

-- ─── Ensure RLS policies use resolve_uid() (idempotent) ────────────────────────

DROP POLICY IF EXISTS "Users can read own notification preferences" ON notification_preferences;
DROP POLICY IF EXISTS "Users can insert own notification preferences" ON notification_preferences;
DROP POLICY IF EXISTS "Users can update own notification preferences" ON notification_preferences;

CREATE POLICY "Users can read own notification preferences"
  ON notification_preferences FOR SELECT
  USING (user_id = private.resolve_uid());

CREATE POLICY "Users can insert own notification preferences"
  ON notification_preferences FOR INSERT
  WITH CHECK (user_id = private.resolve_uid());

CREATE POLICY "Users can update own notification preferences"
  ON notification_preferences FOR UPDATE
  USING (user_id = private.resolve_uid());
