-- 069_product_inventory_bridge.sql
-- Product-Inventory Bridge: BOM recipes, task materials, inventory deductions.
-- Spec: docs/superpowers/specs/2026-04-10-product-inventory-bridge-design.md
-- Note: plan originally numbered 059; that slot was already taken by
-- 059_client_comms_settings.sql, so this migration uses the next free slot.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. product_materials — BOM recipe on a product
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS product_materials (
  product_id        UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity_per_unit DOUBLE PRECISION NOT NULL,
  notes             TEXT,
  PRIMARY KEY (product_id, inventory_item_id)
);

CREATE INDEX IF NOT EXISTS idx_product_materials_product ON product_materials(product_id);
CREATE INDEX IF NOT EXISTS idx_product_materials_item ON product_materials(inventory_item_id);

ALTER TABLE product_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_materials_company_scope" ON product_materials
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = product_materials.product_id
        AND p.company_id = (SELECT private.get_user_company_id())
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. line_item_materials — per-estimate line item override
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS line_item_materials (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_item_id      UUID NOT NULL REFERENCES line_items(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity          DOUBLE PRECISION NOT NULL,
  source            TEXT NOT NULL DEFAULT 'stock' CHECK (source IN ('stock', 'order')),
  UNIQUE(line_item_id, inventory_item_id)
);

CREATE INDEX IF NOT EXISTS idx_line_item_materials_line_item ON line_item_materials(line_item_id);
CREATE INDEX IF NOT EXISTS idx_line_item_materials_item ON line_item_materials(inventory_item_id);

ALTER TABLE line_item_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "line_item_materials_company_scope" ON line_item_materials
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM line_items li
      WHERE li.id = line_item_materials.line_item_id
        AND li.company_id = (SELECT private.get_user_company_id())
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. task_materials — final material list on a task (source of truth for deduction)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS task_materials (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity          DOUBLE PRECISION NOT NULL,
  source            TEXT NOT NULL DEFAULT 'stock' CHECK (source IN ('stock', 'order')),
  UNIQUE(task_id, inventory_item_id)
);

CREATE INDEX IF NOT EXISTS idx_task_materials_task ON task_materials(task_id);
CREATE INDEX IF NOT EXISTS idx_task_materials_item ON task_materials(inventory_item_id);

ALTER TABLE task_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_materials_company_scope" ON task_materials
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM project_tasks pt
      WHERE pt.id = task_materials.task_id
        AND pt.company_id = (SELECT private.get_user_company_id())
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. inventory_deductions — audit trail
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS inventory_deductions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  project_id        UUID REFERENCES projects(id) ON DELETE SET NULL,
  task_id           UUID REFERENCES project_tasks(id) ON DELETE SET NULL,
  line_item_id      UUID REFERENCES line_items(id) ON DELETE SET NULL,
  quantity_deducted DOUBLE PRECISION NOT NULL,
  previous_quantity DOUBLE PRECISION NOT NULL,
  new_quantity      DOUBLE PRECISION NOT NULL,
  reason            TEXT NOT NULL DEFAULT 'task_completion'
    CHECK (reason IN ('task_completion', 'task_reopened', 'manual_adjustment', 'skipped_archived')),
  deducted_by       UUID,
  deducted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes             TEXT
);

CREATE INDEX IF NOT EXISTS idx_inventory_deductions_company ON inventory_deductions(company_id);
CREATE INDEX IF NOT EXISTS idx_inventory_deductions_project ON inventory_deductions(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_deductions_task ON inventory_deductions(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_deductions_item ON inventory_deductions(inventory_item_id) WHERE inventory_item_id IS NOT NULL;

ALTER TABLE inventory_deductions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_deductions_company_scope" ON inventory_deductions
  FOR ALL USING (company_id = (SELECT private.get_user_company_id()));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. Add deduction guard to project_tasks
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS inventory_deducted BOOLEAN NOT NULL DEFAULT FALSE;
