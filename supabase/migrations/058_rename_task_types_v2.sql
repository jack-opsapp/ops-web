-- 058: Rename task_types_v2 to task_types
--
-- The table was created as task_types_v2 in migration 004 to avoid collision
-- with the old Bubble-era task_types table during migration. The Bubble table
-- no longer exists. A view or alias was later created in the Supabase dashboard
-- (not tracked in migrations) to allow code to query "task_types".
--
-- This migration formalizes the rename:
--   1. Drops the dashboard-created view/alias if it exists
--   2. Renames the actual table from task_types_v2 to task_types
--
-- PostgreSQL ALTER TABLE RENAME automatically updates:
--   - FK constraints pointing TO this table (e.g. project_tasks.task_type_id)
--   - RLS policies on the table
--   - Triggers on the table
--
-- It does NOT rename indexes/triggers by name, but they continue to function.
-- Idempotent: safe to re-run (the second run is a no-op).

-- Step 1: Drop any view named task_types (created in Supabase dashboard)
DROP VIEW IF EXISTS task_types;

-- Step 2: Rename the table (only if task_types_v2 still exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'task_types_v2'
  ) THEN
    ALTER TABLE task_types_v2 RENAME TO task_types;
  END IF;
END $$;
