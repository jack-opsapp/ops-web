-- ═══════════════════════════════════════════════════════════════
-- Migration 005: Update Pipeline References
--
-- The pipeline tables (opportunities, estimates, invoices) were
-- created BEFORE we had client/project tables in Supabase.
-- Now we add proper foreign key columns that point to the new
-- core entity tables from migration 004.
--
-- GRADE-8 SUMMARY:
-- Think of the pipeline tables as worksheets that mention
-- "Client: John Smith" and "Project: Smith Deck Build" by name.
-- This migration adds columns that link to the ACTUAL client
-- and project rows in their proper tables — like turning a
-- name into a clickable hyperlink.
-- We keep the old columns for now (don't delete anything).
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─── OPPORTUNITIES ──────────────────────────────────────────
-- Pipeline deals. Already have client_id and project_id as
-- UUID columns, but those aren't linked to the new tables.
-- We add _ref columns that ARE properly linked.
--
-- GRADE-8: "This deal is for client #ABC" → now we can click
-- through to the actual client record.

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS client_ref UUID REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_ref UUID REFERENCES projects(id) ON DELETE SET NULL;


-- ─── ESTIMATES ──────────────────────────────────────────────
-- Quotes sent to clients. Have client_id (UUID from pipeline)
-- and project_id (TEXT from migration 002). Add proper refs.
--
-- GRADE-8: Same idea — link the estimate to the real client
-- and project records so everything connects.

ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS client_ref UUID REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_ref UUID REFERENCES projects(id) ON DELETE SET NULL;


-- ─── INVOICES ───────────────────────────────────────────────
-- Bills sent to clients. Same pattern as estimates.
--
-- GRADE-8: Link the invoice to the real client and project.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS client_ref UUID REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_ref UUID REFERENCES projects(id) ON DELETE SET NULL;


-- ─── LINE ITEMS ─────────────────────────────────────────────
-- Individual items on estimates/invoices (e.g., "Framing — $5,000").
-- Migration 002 added task_type_id as TEXT (Bubble ID).
-- Now add a proper UUID link to the Supabase task type.
--
-- GRADE-8: "This line item is for Framing work" → now linked
-- to the actual Framing task type in the database.

ALTER TABLE line_items
  ADD COLUMN IF NOT EXISTS task_type_ref UUID REFERENCES task_types_v2(id) ON DELETE SET NULL;


-- ─── TASK TEMPLATES ─────────────────────────────────────────
-- Pre-made sub-tasks for each type of work. Migration 002
-- stored task_type_id as TEXT. Add proper UUID reference.
--
-- GRADE-8: "This template belongs to the Framing task type"
-- → now properly linked.

ALTER TABLE task_templates
  ADD COLUMN IF NOT EXISTS task_type_ref UUID REFERENCES task_types_v2(id) ON DELETE SET NULL;


-- ─── PRODUCTS ───────────────────────────────────────────────
-- Catalog of services/materials. Migration 002 added
-- task_type_id as TEXT. Add proper UUID reference.
--
-- GRADE-8: "This product is associated with Painting work"
-- → now linked to the real Painting task type.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS task_type_ref UUID REFERENCES task_types_v2(id) ON DELETE SET NULL;


-- ─── SITE VISITS ────────────────────────────────────────────
-- Scheduled visits to job sites. Migration 002 stored
-- client_id and project_id as TEXT. Add proper UUID refs.
--
-- GRADE-8: "This site visit is for Client John Smith at
-- the Smith Deck project" → both now clickable links.

ALTER TABLE site_visits
  ADD COLUMN IF NOT EXISTS client_ref UUID REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_ref UUID REFERENCES projects(id) ON DELETE SET NULL;


-- ─── INDEXES ────────────────────────────────────────────────
-- Make lookups by the new reference columns fast.
--
-- GRADE-8: Like adding bookmarks to a textbook so you can
-- quickly find the right page instead of scanning every page.

CREATE INDEX IF NOT EXISTS idx_opportunities_client_ref ON opportunities(client_ref);
CREATE INDEX IF NOT EXISTS idx_opportunities_project_ref ON opportunities(project_ref);
CREATE INDEX IF NOT EXISTS idx_estimates_client_ref ON estimates(client_ref);
CREATE INDEX IF NOT EXISTS idx_estimates_project_ref ON estimates(project_ref);
CREATE INDEX IF NOT EXISTS idx_invoices_client_ref ON invoices(client_ref);
CREATE INDEX IF NOT EXISTS idx_invoices_project_ref ON invoices(project_ref);
CREATE INDEX IF NOT EXISTS idx_line_items_task_type_ref ON line_items(task_type_ref);
CREATE INDEX IF NOT EXISTS idx_task_templates_task_type_ref ON task_templates(task_type_ref);
CREATE INDEX IF NOT EXISTS idx_products_task_type_ref ON products(task_type_ref);
CREATE INDEX IF NOT EXISTS idx_site_visits_client_ref ON site_visits(client_ref);
CREATE INDEX IF NOT EXISTS idx_site_visits_project_ref ON site_visits(project_ref);

COMMIT;
