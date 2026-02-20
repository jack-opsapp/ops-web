-- Consolidate task_types: drop old TEXT-based table, rename v2 to task_types
-- This gives us a proper UUID-based task_types with bubble_id for migration
-- EXECUTED: 2026-02-19 via Supabase MCP apply_migration

-- Step 1: Drop the old task_types table (TEXT id, no bubble_id, unused by app)
DROP TABLE IF EXISTS task_types CASCADE;

-- Step 2: Rename task_types_v2 → task_types
ALTER TABLE task_types_v2 RENAME TO task_types;

-- Step 3: Rename the PK constraint
ALTER INDEX task_types_v2_pkey RENAME TO task_types_pkey;

-- Step 4: Rename the unique constraint on bubble_id
ALTER INDEX task_types_v2_bubble_id_key RENAME TO task_types_bubble_id_key;

-- Step 5: Rename the FK constraint on company_id
ALTER TABLE task_types RENAME CONSTRAINT task_types_v2_company_id_fkey TO task_types_company_id_fkey;

-- Step 6: Recreate FKs in referencing tables to point to renamed task_types
ALTER TABLE project_tasks RENAME CONSTRAINT project_tasks_task_type_id_fkey TO project_tasks_task_type_id_fkey_new;
ALTER TABLE project_tasks DROP CONSTRAINT project_tasks_task_type_id_fkey_new;
ALTER TABLE project_tasks ADD CONSTRAINT project_tasks_task_type_id_fkey
  FOREIGN KEY (task_type_id) REFERENCES task_types(id);

ALTER TABLE line_items RENAME CONSTRAINT line_items_task_type_ref_fkey TO line_items_task_type_ref_fkey_old;
ALTER TABLE line_items DROP CONSTRAINT line_items_task_type_ref_fkey_old;
ALTER TABLE line_items ADD CONSTRAINT line_items_task_type_ref_fkey
  FOREIGN KEY (task_type_ref) REFERENCES task_types(id);

ALTER TABLE products RENAME CONSTRAINT products_task_type_ref_fkey TO products_task_type_ref_fkey_old;
ALTER TABLE products DROP CONSTRAINT products_task_type_ref_fkey_old;
ALTER TABLE products ADD CONSTRAINT products_task_type_ref_fkey
  FOREIGN KEY (task_type_ref) REFERENCES task_types(id);

ALTER TABLE task_templates RENAME CONSTRAINT task_templates_task_type_ref_fkey TO task_templates_task_type_ref_fkey_old;
ALTER TABLE task_templates DROP CONSTRAINT task_templates_task_type_ref_fkey_old;
ALTER TABLE task_templates ADD CONSTRAINT task_templates_task_type_ref_fkey
  FOREIGN KEY (task_type_ref) REFERENCES task_types(id);
