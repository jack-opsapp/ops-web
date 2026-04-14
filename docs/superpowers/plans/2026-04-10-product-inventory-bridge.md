# Product-Inventory Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the products catalog to inventory via a bill-of-materials layer, auto-deducting stock on task completion with full audit trail.

**Architecture:** Three-layer data flow: product_materials (BOM recipe) → line_item_materials (per-estimate override) → task_materials (final deductible list). Deduction triggered in task-service on status change, logged to inventory_deductions. Stock indicator computed client-side via useStockIndicator hook.

**Tech Stack:** Supabase (PostgreSQL + RLS), TanStack Query, Next.js App Router, TypeScript, existing OPS service/hook patterns.

**Spec:** `docs/superpowers/specs/2026-04-10-product-inventory-bridge-design.md`

---

## File Map

### New Files
| File | Purpose |
|------|---------|
| `supabase/migrations/059_product_inventory_bridge.sql` | Migration: 4 new tables + 1 altered column |
| `src/lib/types/product-materials.ts` | TypeScript interfaces for all new entities |
| `src/lib/api/services/product-materials-service.ts` | CRUD for product_materials (BOM) |
| `src/lib/api/services/task-materials-service.ts` | CRUD for task_materials + population logic |
| `src/lib/api/services/inventory-deduction-service.ts` | Deduction/reversal/fetch for inventory_deductions |
| `src/lib/hooks/use-product-materials.ts` | TanStack Query hooks for product BOM |
| `src/lib/hooks/use-task-materials.ts` | TanStack Query hooks for task materials |
| `src/lib/hooks/use-inventory-deductions.ts` | TanStack Query hooks for deduction history |
| `src/lib/hooks/use-stock-indicator.ts` | Computed stock status for line items |

### Modified Files
| File | Change |
|------|--------|
| `src/lib/api/query-client.ts` | Add query keys for productMaterials, taskMaterials, inventoryDeductions |
| `src/lib/api/services/index.ts` | Export new services |
| `src/lib/api/services/task-service.ts` | Add `inventory_deducted` to mappers |
| `src/lib/hooks/use-tasks.ts` | Call deduction on task completion, reversal on task reopening |
| `src/lib/hooks/index.ts` | Export new hooks |
| `src/lib/types/inventory.ts` | Add InventoryDeduction type |
| `src/components/ops/review-tasks-modal.tsx` | Populate task_materials after creating tasks |

### UX Design Required (separate implementation cycle per touchpoint)
| Touchpoint | Requires |
|------------|----------|
| Product BOM Editor (Products page) | `mobile-ux-design` → `wireframe` → `frontend-design` |
| Estimate Stock Indicator (LineItemEditor) | `mobile-ux-design` → `wireframe` → `frontend-design` |
| Estimate Material Override (estimate edit) | `mobile-ux-design` → `wireframe` → `frontend-design` |
| Task Materials Panel (task detail) | `mobile-ux-design` → `wireframe` → `frontend-design` |
| Project Deduction History (project detail) | `mobile-ux-design` → `wireframe` → `frontend-design` |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/059_product_inventory_bridge.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 059_product_inventory_bridge.sql
-- Product-Inventory Bridge: BOM recipes, task materials, inventory deductions.
-- Spec: docs/superpowers/specs/2026-04-10-product-inventory-bridge-design.md

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

- [ ] **Step 2: Commit migration**

```bash
git add supabase/migrations/059_product_inventory_bridge.sql
git commit -m "feat: add product-inventory bridge schema (059)

Creates product_materials, line_item_materials, task_materials,
inventory_deductions tables. Adds inventory_deducted column to
project_tasks. Full RLS on all new tables.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: TypeScript Types

**Files:**
- Create: `src/lib/types/product-materials.ts`

- [ ] **Step 1: Write type definitions**

```typescript
/**
 * OPS Web - Product-Inventory Bridge Types
 *
 * Types for bill-of-materials (BOM), task materials, and inventory deductions.
 * Matches Supabase schema from migration 059.
 */

// ─── Product Materials (BOM) ────────────────────────────────────────────────

export type MaterialSource = "stock" | "order";

/** A single material in a product's bill of materials */
export interface ProductMaterial {
  productId: string;
  inventoryItemId: string;
  quantityPerUnit: number;
  notes: string | null;
}

export interface CreateProductMaterial {
  productId: string;
  inventoryItemId: string;
  quantityPerUnit: number;
  notes?: string | null;
}

// ─── Line Item Materials (per-estimate override) ────────────────────────────

export interface LineItemMaterial {
  id: string;
  lineItemId: string;
  inventoryItemId: string;
  quantity: number;
  source: MaterialSource;
}

export interface CreateLineItemMaterial {
  lineItemId: string;
  inventoryItemId: string;
  quantity: number;
  source?: MaterialSource;
}

// ─── Task Materials (final deductible list) ─────────────────────────────────

export interface TaskMaterial {
  id: string;
  taskId: string;
  inventoryItemId: string;
  quantity: number;
  source: MaterialSource;
}

export interface CreateTaskMaterial {
  taskId: string;
  inventoryItemId: string;
  quantity: number;
  source?: MaterialSource;
}

// ─── Inventory Deductions (audit trail) ─────────────────────────────────────

export type DeductionReason =
  | "task_completion"
  | "task_reopened"
  | "manual_adjustment"
  | "skipped_archived";

export interface InventoryDeduction {
  id: string;
  companyId: string;
  inventoryItemId: string | null;
  projectId: string | null;
  taskId: string | null;
  lineItemId: string | null;
  quantityDeducted: number;
  previousQuantity: number;
  newQuantity: number;
  reason: DeductionReason;
  deductedBy: string | null;
  deductedAt: Date;
  notes: string | null;
}

// ─── Stock Indicator ────────────────────────────────────────────────────────

export type StockStatus = "sufficient" | "warning" | "insufficient" | "no_bom";

export interface MaterialStockCheck {
  inventoryItemId: string;
  inventoryItemName: string;
  required: number;
  available: number;
  warningThreshold: number | null;
  status: StockStatus;
}

export interface LineItemStockStatus {
  lineItemId: string;
  overallStatus: StockStatus;
  materials: MaterialStockCheck[];
}
```

- [ ] **Step 2: Commit types**

```bash
git add src/lib/types/product-materials.ts
git commit -m "feat: add product-inventory bridge TypeScript types

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Query Keys

**Files:**
- Modify: `src/lib/api/query-client.ts`

- [ ] **Step 1: Add query key factories**

Add after the existing `inventory` block in `queryKeys`:

```typescript
  // Product Materials (BOM)
  productMaterials: {
    all: ["productMaterials"] as const,
    byProduct: (productId: string) =>
      [...queryKeys.productMaterials.all, productId] as const,
  },

  // Task Materials
  taskMaterials: {
    all: ["taskMaterials"] as const,
    byTask: (taskId: string) =>
      [...queryKeys.taskMaterials.all, taskId] as const,
  },

  // Inventory Deductions
  inventoryDeductions: {
    all: ["inventoryDeductions"] as const,
    byProject: (projectId: string) =>
      [...queryKeys.inventoryDeductions.all, "project", projectId] as const,
    byTask: (taskId: string) =>
      [...queryKeys.inventoryDeductions.all, "task", taskId] as const,
  },

  // Stock Indicator
  stockIndicator: {
    all: ["stockIndicator"] as const,
    forLineItems: (lineItemIds: string[]) =>
      [...queryKeys.stockIndicator.all, ...lineItemIds.sort()] as const,
  },
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/api/query-client.ts
git commit -m "feat: add query keys for product-inventory bridge

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Product Materials Service

**Files:**
- Create: `src/lib/api/services/product-materials-service.ts`

- [ ] **Step 1: Write the service**

```typescript
/**
 * OPS Web - Product Materials Service
 *
 * CRUD for product bill-of-materials (BOM).
 * Maps product_materials table: product_id + inventory_item_id composite PK.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import type {
  ProductMaterial,
  CreateProductMaterial,
} from "@/lib/types/product-materials";

// ─── Mapping ────────────────────────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): ProductMaterial {
  return {
    productId: row.product_id as string,
    inventoryItemId: row.inventory_item_id as string,
    quantityPerUnit: Number(row.quantity_per_unit ?? 0),
    notes: (row.notes as string) ?? null,
  };
}

function mapToDb(data: CreateProductMaterial): Record<string, unknown> {
  return {
    product_id: data.productId,
    inventory_item_id: data.inventoryItemId,
    quantity_per_unit: data.quantityPerUnit,
    notes: data.notes ?? null,
  };
}

// ─── Service ────────────────────────────────────────────────────────────────

export const ProductMaterialsService = {
  /** Fetch all BOM rows for a product */
  async fetchByProduct(productId: string): Promise<ProductMaterial[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("product_materials")
      .select("*")
      .eq("product_id", productId);

    if (error) throw new Error(`Failed to fetch product materials: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },

  /** Set the full BOM for a product (delete + re-insert) */
  async setBom(productId: string, materials: CreateProductMaterial[]): Promise<void> {
    const supabase = requireSupabase();

    // Delete existing
    const { error: deleteError } = await supabase
      .from("product_materials")
      .delete()
      .eq("product_id", productId);

    if (deleteError) throw new Error(`Failed to clear product materials: ${deleteError.message}`);

    // Insert new (if any)
    if (materials.length > 0) {
      const rows = materials.map(mapToDb);
      const { error: insertError } = await supabase
        .from("product_materials")
        .insert(rows);

      if (insertError) throw new Error(`Failed to set product materials: ${insertError.message}`);
    }
  },

  /** Fetch BOM for multiple products (batch, for stock indicator) */
  async fetchByProducts(productIds: string[]): Promise<ProductMaterial[]> {
    if (productIds.length === 0) return [];
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("product_materials")
      .select("*")
      .in("product_id", productIds);

    if (error) throw new Error(`Failed to fetch product materials batch: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },
};
```

- [ ] **Step 2: Export from services barrel**

In `src/lib/api/services/index.ts`, add:

```typescript
export { ProductMaterialsService } from "./product-materials-service";
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/services/product-materials-service.ts src/lib/api/services/index.ts
git commit -m "feat: add product materials (BOM) service

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Task Materials Service

**Files:**
- Create: `src/lib/api/services/task-materials-service.ts`

- [ ] **Step 1: Write the service**

```typescript
/**
 * OPS Web - Task Materials Service
 *
 * CRUD for task_materials + population logic from product BOM / line item overrides.
 */

import { requireSupabase } from "@/lib/supabase/helpers";
import type {
  TaskMaterial,
  CreateTaskMaterial,
} from "@/lib/types/product-materials";

// ─── Mapping ────────────────────────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): TaskMaterial {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    inventoryItemId: row.inventory_item_id as string,
    quantity: Number(row.quantity ?? 0),
    source: (row.source as "stock" | "order") ?? "stock",
  };
}

function mapToDb(data: CreateTaskMaterial): Record<string, unknown> {
  return {
    task_id: data.taskId,
    inventory_item_id: data.inventoryItemId,
    quantity: data.quantity,
    source: data.source ?? "stock",
  };
}

// ─── Service ────────────────────────────────────────────────────────────────

export const TaskMaterialsService = {
  /** Fetch all materials for a task */
  async fetchByTask(taskId: string): Promise<TaskMaterial[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("task_materials")
      .select("*")
      .eq("task_id", taskId);

    if (error) throw new Error(`Failed to fetch task materials: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },

  /** Set all materials for a task (delete + re-insert) */
  async setMaterials(taskId: string, materials: CreateTaskMaterial[]): Promise<void> {
    const supabase = requireSupabase();

    const { error: deleteError } = await supabase
      .from("task_materials")
      .delete()
      .eq("task_id", taskId);

    if (deleteError) throw new Error(`Failed to clear task materials: ${deleteError.message}`);

    if (materials.length > 0) {
      const rows = materials.map(mapToDb);
      const { error: insertError } = await supabase
        .from("task_materials")
        .insert(rows);

      if (insertError) throw new Error(`Failed to set task materials: ${insertError.message}`);
    }
  },

  /**
   * Populate task_materials from a source line item.
   * Resolution order:
   * 1. line_item_materials overrides (if any exist for the line item)
   * 2. product_materials BOM (calculated: line_item.quantity * quantity_per_unit)
   * 3. Nothing (no BOM, no overrides)
   */
  async populateFromLineItem(
    taskId: string,
    lineItemId: string
  ): Promise<TaskMaterial[]> {
    const supabase = requireSupabase();

    // 1. Check for line_item_materials overrides
    const { data: overrides, error: overrideError } = await supabase
      .from("line_item_materials")
      .select("*")
      .eq("line_item_id", lineItemId);

    if (overrideError) throw new Error(`Failed to fetch line item materials: ${overrideError.message}`);

    if (overrides && overrides.length > 0) {
      // Use overrides directly
      const rows = overrides.map((o) => ({
        task_id: taskId,
        inventory_item_id: o.inventory_item_id as string,
        quantity: Number(o.quantity),
        source: (o.source as string) ?? "stock",
      }));

      const { error: insertError } = await supabase
        .from("task_materials")
        .insert(rows);

      if (insertError) throw new Error(`Failed to populate task materials from overrides: ${insertError.message}`);
      return rows.map((r, i) => ({
        id: "", // Will be set by DB
        taskId: r.task_id,
        inventoryItemId: r.inventory_item_id,
        quantity: r.quantity,
        source: r.source as "stock" | "order",
      }));
    }

    // 2. Fall back to product BOM
    const { data: lineItem, error: liError } = await supabase
      .from("line_items")
      .select("product_id, quantity")
      .eq("id", lineItemId)
      .single();

    if (liError || !lineItem?.product_id) return []; // No product = no BOM

    const { data: bom, error: bomError } = await supabase
      .from("product_materials")
      .select("*")
      .eq("product_id", lineItem.product_id as string);

    if (bomError) throw new Error(`Failed to fetch product BOM: ${bomError.message}`);
    if (!bom || bom.length === 0) return []; // No BOM

    const lineQty = Number(lineItem.quantity);
    const rows = bom.map((b) => ({
      task_id: taskId,
      inventory_item_id: b.inventory_item_id as string,
      quantity: lineQty * Number(b.quantity_per_unit),
      source: "stock",
    }));

    const { error: insertError } = await supabase
      .from("task_materials")
      .insert(rows);

    if (insertError) throw new Error(`Failed to populate task materials from BOM: ${insertError.message}`);

    return rows.map((r) => ({
      id: "",
      taskId: r.task_id,
      inventoryItemId: r.inventory_item_id,
      quantity: r.quantity,
      source: r.source as "stock" | "order",
    }));
  },
};
```

- [ ] **Step 2: Export from services barrel**

In `src/lib/api/services/index.ts`, add:

```typescript
export { TaskMaterialsService } from "./task-materials-service";
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/services/task-materials-service.ts src/lib/api/services/index.ts
git commit -m "feat: add task materials service with BOM population logic

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Inventory Deduction Service

**Files:**
- Create: `src/lib/api/services/inventory-deduction-service.ts`

- [ ] **Step 1: Write the service**

```typescript
/**
 * OPS Web - Inventory Deduction Service
 *
 * Transactional deduction on task completion, reversal on task reopening,
 * and audit trail queries.
 *
 * IMPORTANT: deductForTask and reverseForTask must be called AFTER the task
 * status update succeeds. They are NOT idempotent — the inventory_deducted
 * guard on project_tasks prevents double-processing.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";
import type { InventoryDeduction } from "@/lib/types/product-materials";

// ─── Mapping ────────────────────────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): InventoryDeduction {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    inventoryItemId: (row.inventory_item_id as string) ?? null,
    projectId: (row.project_id as string) ?? null,
    taskId: (row.task_id as string) ?? null,
    lineItemId: (row.line_item_id as string) ?? null,
    quantityDeducted: Number(row.quantity_deducted ?? 0),
    previousQuantity: Number(row.previous_quantity ?? 0),
    newQuantity: Number(row.new_quantity ?? 0),
    reason: (row.reason as string) ?? "task_completion",
    deductedBy: (row.deducted_by as string) ?? null,
    deductedAt: parseDate(row.deducted_at) ?? new Date(),
    notes: (row.notes as string) ?? null,
  };
}

// ─── Service ────────────────────────────────────────────────────────────────

export const InventoryDeductionService = {
  /**
   * Deduct inventory for a completed task.
   * Reads task_materials (source='stock' only), deducts from inventory_items,
   * writes audit rows to inventory_deductions, sets inventory_deducted=true.
   */
  async deductForTask(taskId: string, userId: string | null): Promise<void> {
    const supabase = requireSupabase();

    // 1. Read task (guard check)
    const { data: task, error: taskError } = await supabase
      .from("project_tasks")
      .select("id, company_id, project_id, source_line_item_id, inventory_deducted")
      .eq("id", taskId)
      .single();

    if (taskError || !task) return; // Task not found — no-op
    if (task.inventory_deducted) return; // Already deducted — no-op

    // 2. Read task_materials (stock only)
    const { data: materials, error: matError } = await supabase
      .from("task_materials")
      .select("inventory_item_id, quantity")
      .eq("task_id", taskId)
      .eq("source", "stock");

    if (matError) throw new Error(`Failed to fetch task materials: ${matError.message}`);
    if (!materials || materials.length === 0) {
      // No stock materials — just mark as deducted (nothing to deduct)
      await supabase
        .from("project_tasks")
        .update({ inventory_deducted: true })
        .eq("id", taskId);
      return;
    }

    // 3. Deduct each material
    const companyId = task.company_id as string;
    const projectId = (task.project_id as string) ?? null;
    const lineItemId = (task.source_line_item_id as string) ?? null;
    // Validate lineItemId is a UUID before using as FK
    const lineItemUuid = lineItemId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lineItemId)
      ? lineItemId
      : null;

    for (const mat of materials) {
      const itemId = mat.inventory_item_id as string;
      const deductQty = Number(mat.quantity);

      // Read current inventory (check archived)
      const { data: item, error: itemError } = await supabase
        .from("inventory_items")
        .select("quantity, deleted_at, warning_threshold, name")
        .eq("id", itemId)
        .single();

      if (itemError || !item) continue; // Item not found — skip

      // Skip archived items
      if (item.deleted_at) {
        await supabase.from("inventory_deductions").insert({
          company_id: companyId,
          inventory_item_id: itemId,
          project_id: projectId,
          task_id: taskId,
          line_item_id: lineItemUuid,
          quantity_deducted: 0,
          previous_quantity: Number(item.quantity),
          new_quantity: Number(item.quantity),
          reason: "skipped_archived",
          deducted_by: userId,
          notes: `Skipped: ${item.name} is archived`,
        });
        continue;
      }

      const currentQty = Number(item.quantity);
      const newQty = Math.max(0, currentQty - deductQty);

      // Update inventory
      const { error: updateError } = await supabase
        .from("inventory_items")
        .update({ quantity: newQty })
        .eq("id", itemId);

      if (updateError) throw new Error(`Failed to deduct inventory: ${updateError.message}`);

      // Log deduction
      await supabase.from("inventory_deductions").insert({
        company_id: companyId,
        inventory_item_id: itemId,
        project_id: projectId,
        task_id: taskId,
        line_item_id: lineItemUuid,
        quantity_deducted: deductQty,
        previous_quantity: currentQty,
        new_quantity: newQty,
        reason: "task_completion",
        deducted_by: userId,
      });

      // Low stock notification
      const threshold = item.warning_threshold != null ? Number(item.warning_threshold) : null;
      if (threshold != null && newQty <= threshold) {
        await supabase.rpc("create_notification_if_new", {
          p_user_id: userId ?? companyId,
          p_company_id: companyId,
          p_type: "system",
          p_title: `Low stock: ${item.name}`,
          p_body: `${item.name} is low (${newQty} remaining, threshold: ${threshold})`,
          p_persistent: false,
        }).catch(() => {}); // Non-fatal
      }
    }

    // 4. Mark task as deducted
    await supabase
      .from("project_tasks")
      .update({ inventory_deducted: true })
      .eq("id", taskId);
  },

  /**
   * Reverse inventory deductions for a task that was reopened.
   * Reads existing deduction records, adds quantities back,
   * writes reversal audit rows, sets inventory_deducted=false.
   */
  async reverseForTask(taskId: string, userId: string | null): Promise<void> {
    const supabase = requireSupabase();

    // 1. Check guard
    const { data: task, error: taskError } = await supabase
      .from("project_tasks")
      .select("id, company_id, inventory_deducted")
      .eq("id", taskId)
      .single();

    if (taskError || !task) return;
    if (!task.inventory_deducted) return; // Not deducted — no-op

    // 2. Read original deductions
    const { data: deductions, error: dedError } = await supabase
      .from("inventory_deductions")
      .select("*")
      .eq("task_id", taskId)
      .eq("reason", "task_completion");

    if (dedError) throw new Error(`Failed to fetch deductions for reversal: ${dedError.message}`);
    if (!deductions || deductions.length === 0) {
      await supabase
        .from("project_tasks")
        .update({ inventory_deducted: false })
        .eq("id", taskId);
      return;
    }

    // 3. Reverse each deduction
    for (const ded of deductions) {
      const itemId = ded.inventory_item_id as string;
      const restoreQty = Number(ded.quantity_deducted);

      // Read current
      const { data: item } = await supabase
        .from("inventory_items")
        .select("quantity")
        .eq("id", itemId)
        .single();

      if (!item) continue;

      const currentQty = Number(item.quantity);
      const newQty = currentQty + restoreQty;

      // Restore
      await supabase
        .from("inventory_items")
        .update({ quantity: newQty })
        .eq("id", itemId);

      // Log reversal
      await supabase.from("inventory_deductions").insert({
        company_id: ded.company_id as string,
        inventory_item_id: itemId,
        project_id: (ded.project_id as string) ?? null,
        task_id: taskId,
        line_item_id: (ded.line_item_id as string) ?? null,
        quantity_deducted: restoreQty,
        previous_quantity: currentQty,
        new_quantity: newQty,
        reason: "task_reopened",
        deducted_by: userId,
        notes: "Reversed: task reopened",
      });
    }

    // 4. Clear guard
    await supabase
      .from("project_tasks")
      .update({ inventory_deducted: false })
      .eq("id", taskId);
  },

  /** Fetch deduction history for a project (reconciliation view) */
  async fetchByProject(projectId: string): Promise<InventoryDeduction[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("inventory_deductions")
      .select("*")
      .eq("project_id", projectId)
      .order("deducted_at", { ascending: false });

    if (error) throw new Error(`Failed to fetch deductions: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },

  /** Fetch deduction history for a task */
  async fetchByTask(taskId: string): Promise<InventoryDeduction[]> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("inventory_deductions")
      .select("*")
      .eq("task_id", taskId)
      .order("deducted_at", { ascending: false });

    if (error) throw new Error(`Failed to fetch deductions: ${error.message}`);
    return (data ?? []).map(mapFromDb);
  },
};
```

- [ ] **Step 2: Export from services barrel**

In `src/lib/api/services/index.ts`, add:

```typescript
export { InventoryDeductionService } from "./inventory-deduction-service";
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/services/inventory-deduction-service.ts src/lib/api/services/index.ts
git commit -m "feat: add inventory deduction service with auto-deduct and reversal

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: TanStack Query Hooks

**Files:**
- Create: `src/lib/hooks/use-product-materials.ts`
- Create: `src/lib/hooks/use-task-materials.ts`
- Create: `src/lib/hooks/use-inventory-deductions.ts`
- Create: `src/lib/hooks/use-stock-indicator.ts`

- [ ] **Step 1: Product materials hook**

```typescript
/**
 * OPS Web - Product Materials Hooks
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { ProductMaterialsService } from "../api/services";
import type { CreateProductMaterial } from "../types/product-materials";

export function useProductMaterials(productId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.productMaterials.byProduct(productId ?? ""),
    queryFn: () => ProductMaterialsService.fetchByProduct(productId!),
    enabled: !!productId,
  });
}

export function useSetProductBom() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      productId,
      materials,
    }: {
      productId: string;
      materials: CreateProductMaterial[];
    }) => ProductMaterialsService.setBom(productId, materials),
    onSuccess: (_data, { productId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.productMaterials.byProduct(productId),
      });
      // Also invalidate stock indicators (BOM changed)
      queryClient.invalidateQueries({
        queryKey: queryKeys.stockIndicator.all,
      });
    },
  });
}
```

- [ ] **Step 2: Task materials hook**

```typescript
/**
 * OPS Web - Task Materials Hooks
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { TaskMaterialsService } from "../api/services";
import type { CreateTaskMaterial } from "../types/product-materials";

export function useTaskMaterials(taskId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.taskMaterials.byTask(taskId ?? ""),
    queryFn: () => TaskMaterialsService.fetchByTask(taskId!),
    enabled: !!taskId,
  });
}

export function useSetTaskMaterials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      materials,
    }: {
      taskId: string;
      materials: CreateTaskMaterial[];
    }) => TaskMaterialsService.setMaterials(taskId, materials),
    onSuccess: (_data, { taskId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.taskMaterials.byTask(taskId),
      });
    },
  });
}
```

- [ ] **Step 3: Inventory deductions hook**

```typescript
/**
 * OPS Web - Inventory Deductions Hooks
 */

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { InventoryDeductionService } from "../api/services";

export function useProjectDeductions(projectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.inventoryDeductions.byProject(projectId ?? ""),
    queryFn: () => InventoryDeductionService.fetchByProject(projectId!),
    enabled: !!projectId,
  });
}

export function useTaskDeductions(taskId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.inventoryDeductions.byTask(taskId ?? ""),
    queryFn: () => InventoryDeductionService.fetchByTask(taskId!),
    enabled: !!taskId,
  });
}
```

- [ ] **Step 4: Stock indicator hook**

```typescript
/**
 * OPS Web - Stock Indicator Hook
 *
 * Computes stock availability for estimate line items by resolving
 * line_item_materials (overrides) or product_materials (BOM defaults)
 * against current inventory quantities.
 */

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../api/query-client";
import { requireSupabase } from "@/lib/supabase/helpers";
import type { LineItemStockStatus, MaterialStockCheck, StockStatus } from "../types/product-materials";

interface LineItemInput {
  id: string;
  productId: string | null;
  quantity: number;
}

async function computeStockStatus(lineItems: LineItemInput[]): Promise<LineItemStockStatus[]> {
  const supabase = requireSupabase();
  const results: LineItemStockStatus[] = [];

  // Collect all product IDs for batch BOM fetch
  const productIds = [...new Set(lineItems.map((li) => li.productId).filter(Boolean))] as string[];
  if (productIds.length === 0) {
    return lineItems.map((li) => ({ lineItemId: li.id, overallStatus: "no_bom" as StockStatus, materials: [] }));
  }

  // Batch fetch BOMs
  const { data: allBom } = await supabase
    .from("product_materials")
    .select("product_id, inventory_item_id, quantity_per_unit")
    .in("product_id", productIds);

  // Batch fetch overrides for these line items
  const lineItemIds = lineItems.map((li) => li.id);
  const { data: allOverrides } = await supabase
    .from("line_item_materials")
    .select("line_item_id, inventory_item_id, quantity")
    .in("line_item_id", lineItemIds);

  // Collect all inventory item IDs we need
  const inventoryItemIds = new Set<string>();
  (allBom ?? []).forEach((b) => inventoryItemIds.add(b.inventory_item_id as string));
  (allOverrides ?? []).forEach((o) => inventoryItemIds.add(o.inventory_item_id as string));

  if (inventoryItemIds.size === 0) {
    return lineItems.map((li) => ({ lineItemId: li.id, overallStatus: "no_bom" as StockStatus, materials: [] }));
  }

  // Batch fetch inventory items
  const { data: items } = await supabase
    .from("inventory_items")
    .select("id, name, quantity, warning_threshold, deleted_at")
    .in("id", [...inventoryItemIds])
    .is("deleted_at", null);

  const itemMap = new Map((items ?? []).map((i) => [i.id as string, i]));

  // Compute per line item
  for (const li of lineItems) {
    // Check overrides first
    const overrides = (allOverrides ?? []).filter((o) => o.line_item_id === li.id);

    let materialChecks: MaterialStockCheck[];

    if (overrides.length > 0) {
      // Use overrides
      materialChecks = overrides.map((o) => {
        const item = itemMap.get(o.inventory_item_id as string);
        const required = Number(o.quantity);
        const available = item ? Number(item.quantity) : 0;
        const threshold = item?.warning_threshold != null ? Number(item.warning_threshold) : null;

        let status: StockStatus = "sufficient";
        if (required > available) status = "insufficient";
        else if (threshold != null && available - required <= threshold) status = "warning";

        return {
          inventoryItemId: o.inventory_item_id as string,
          inventoryItemName: item ? (item.name as string) : "Unknown",
          required,
          available,
          warningThreshold: threshold,
          status,
        };
      });
    } else if (li.productId) {
      // Use BOM
      const bom = (allBom ?? []).filter((b) => b.product_id === li.productId);
      if (bom.length === 0) {
        results.push({ lineItemId: li.id, overallStatus: "no_bom", materials: [] });
        continue;
      }

      materialChecks = bom.map((b) => {
        const item = itemMap.get(b.inventory_item_id as string);
        const required = li.quantity * Number(b.quantity_per_unit);
        const available = item ? Number(item.quantity) : 0;
        const threshold = item?.warning_threshold != null ? Number(item.warning_threshold) : null;

        let status: StockStatus = "sufficient";
        if (required > available) status = "insufficient";
        else if (threshold != null && available - required <= threshold) status = "warning";

        return {
          inventoryItemId: b.inventory_item_id as string,
          inventoryItemName: item ? (item.name as string) : "Unknown",
          required,
          available,
          warningThreshold: threshold,
          status,
        };
      });
    } else {
      results.push({ lineItemId: li.id, overallStatus: "no_bom", materials: [] });
      continue;
    }

    // Overall status: worst of all materials
    let overall: StockStatus = "sufficient";
    for (const mc of materialChecks) {
      if (mc.status === "insufficient") { overall = "insufficient"; break; }
      if (mc.status === "warning") overall = "warning";
    }

    results.push({ lineItemId: li.id, overallStatus: overall, materials: materialChecks });
  }

  return results;
}

export function useStockIndicator(lineItems: LineItemInput[]) {
  const ids = lineItems.map((li) => li.id).sort();

  return useQuery({
    queryKey: queryKeys.stockIndicator.forLineItems(ids),
    queryFn: () => computeStockStatus(lineItems),
    enabled: lineItems.length > 0,
    staleTime: 30_000, // 30s — stock doesn't change that fast
  });
}
```

- [ ] **Step 5: Commit all hooks**

```bash
git add src/lib/hooks/use-product-materials.ts src/lib/hooks/use-task-materials.ts src/lib/hooks/use-inventory-deductions.ts src/lib/hooks/use-stock-indicator.ts
git commit -m "feat: add TanStack Query hooks for product-inventory bridge

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Wire Deduction into Task Status Changes

**Files:**
- Modify: `src/lib/api/services/task-service.ts`
- Modify: `src/lib/hooks/use-tasks.ts`

- [ ] **Step 1: Add inventory_deducted to task mapper in task-service.ts**

In `mapTaskFromDb`, add after the existing `endTime` mapping:

```typescript
    inventoryDeducted: (row.inventory_deducted as boolean) ?? false,
```

In `mapTaskToDb`, add:

```typescript
    if (data.inventoryDeducted !== undefined) row.inventory_deducted = data.inventoryDeducted;
```

- [ ] **Step 2: Add deduction call to useUpdateTaskStatus in use-tasks.ts**

In the `onSuccess` callback of `useUpdateTaskStatus`, after the existing notification dispatch block, add:

```typescript
      // Inventory deduction on completion / reversal on reopening
      if (status === "Completed" && context?.previousTask && !context.previousTask.inventoryDeducted) {
        InventoryDeductionService.deductForTask(id, currentUser?.id ?? null)
          .then(() => {
            queryClient.invalidateQueries({ queryKey: queryKeys.inventory.items.lists() });
            queryClient.invalidateQueries({ queryKey: queryKeys.inventoryDeductions.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.taskMaterials.byTask(id) });
            queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(id) });
          })
          .catch((err) => {
            console.error("Inventory deduction failed:", err);
            toast.error("Task completed but inventory deduction failed");
          });
      }

      // Reversal: task was completed (deducted) and is now being reopened
      if (status !== "Completed" && context?.previousTask?.inventoryDeducted) {
        InventoryDeductionService.reverseForTask(id, currentUser?.id ?? null)
          .then(() => {
            queryClient.invalidateQueries({ queryKey: queryKeys.inventory.items.lists() });
            queryClient.invalidateQueries({ queryKey: queryKeys.inventoryDeductions.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(id) });
          })
          .catch((err) => {
            console.error("Inventory reversal failed:", err);
            toast.error("Task reopened but inventory reversal failed");
          });
      }
```

Add the required imports at the top of `use-tasks.ts`:

```typescript
import { InventoryDeductionService } from "../api/services";
import { queryKeys } from "../api/query-client"; // if not already imported
import { toast } from "sonner"; // if not already imported
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/services/task-service.ts src/lib/hooks/use-tasks.ts
git commit -m "feat: wire inventory deduction into task completion/reopening

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Wire Population into ReviewTasksModal

**Files:**
- Modify: `src/components/ops/review-tasks-modal.tsx`

- [ ] **Step 1: Add material population after task creation**

In `handleCreate`, after `TaskService.createTasksFromProposals` returns the task IDs, add:

```typescript
      // Populate task_materials from estimate line items
      const taskIds = await TaskService.createTasksFromProposals(proposals, projectId, company.id);

      // Populate materials for each task from its source line item
      await Promise.all(
        taskIds.map((taskId, idx) => {
          const lineItemId = proposals[idx]?.lineItemId;
          if (!lineItemId) return Promise.resolve();
          return TaskMaterialsService.populateFromLineItem(taskId, lineItemId).catch(() => {
            // Non-fatal: materials not populated but task still created
          });
        })
      );
```

Replace the existing line:
```typescript
      await TaskService.createTasksFromProposals(proposals, projectId, company.id);
```

with the block above that captures the return value.

Add import at top:

```typescript
import { TaskMaterialsService } from "@/lib/api/services";
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ops/review-tasks-modal.tsx
git commit -m "feat: populate task materials from BOM when creating tasks from estimates

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Add inventoryDeducted to ProjectTask Type

**Files:**
- Modify: `src/lib/types/models.ts`

- [ ] **Step 1: Add field to ProjectTask interface**

Find the `ProjectTask` interface and add after `endTime`:

```typescript
  inventoryDeducted: boolean;
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/types/models.ts
git commit -m "feat: add inventoryDeducted field to ProjectTask type

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Hook Barrel Exports

**Files:**
- Modify: `src/lib/hooks/index.ts`

- [ ] **Step 1: Add exports**

```typescript
export { useProductMaterials, useSetProductBom } from "./use-product-materials";
export { useTaskMaterials, useSetTaskMaterials } from "./use-task-materials";
export { useProjectDeductions, useTaskDeductions } from "./use-inventory-deductions";
export { useStockIndicator } from "./use-stock-indicator";
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/hooks/index.ts
git commit -m "feat: export product-inventory bridge hooks from barrel

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 12–16: UI Touchpoints (Design-First)

Each of these requires the full UX design workflow before implementation. They should be executed as separate sub-tasks, each following:

1. Invoke `mobile-ux-design` skill for the touchpoint
2. Invoke `wireframe` skill for layout variants
3. Invoke `frontend-design` skill for implementation
4. Invoke `audit-design-system` to validate

### Task 12: Product BOM Editor
**Where:** Products page, product edit modal
**Data hooks:** `useProductMaterials(productId)`, `useSetProductBom()`
**Inventory data:** `useInventoryItems()` (existing) for the item picker

### Task 13: Estimate Stock Indicator
**Where:** `src/components/ops/line-item-editor.tsx`, per line item row
**Data hooks:** `useStockIndicator(lineItems)`
**Display:** Green/yellow/red dot + hover tooltip

### Task 14: Estimate Material Override
**Where:** Estimate edit modal, expandable section per line item
**Data hooks:** `useProductMaterials(productId)` for defaults, new `useLineItemMaterials(lineItemId)` (simple hook, same pattern)
**Note:** Requires a small `LineItemMaterialsService` for CRUD on `line_item_materials`. Follow same pattern as product-materials-service.

### Task 15: Task Materials Panel
**Where:** Calendar side panel / task detail view
**Data hooks:** `useTaskMaterials(taskId)`, `useSetTaskMaterials()`, `useInventoryItems()`

### Task 16: Project Deduction History
**Where:** Project detail page (`src/app/(dashboard)/projects/[id]/page.tsx`)
**Data hooks:** `useProjectDeductions(projectId)`
**Display:** Read-only table grouped by task

---

## Verification Checklist

After all tasks are complete:

- [ ] Migration applied successfully (no errors)
- [ ] Product BOM can be created/edited/deleted on a product
- [ ] Stock indicator shows green/yellow/red on estimate line items with BOM
- [ ] Line item material overrides are saved and reflected in stock indicator
- [ ] Tasks created from estimates have task_materials auto-populated
- [ ] Manually created tasks can have materials added
- [ ] Task completion deducts stock and writes audit trail
- [ ] Task reopening reverses deduction and restores stock
- [ ] Double-completion does not double-deduct (guard works)
- [ ] Archived inventory items are skipped during deduction
- [ ] Low stock notification fires when threshold crossed
- [ ] Project deduction history shows all movements
- [ ] RLS prevents cross-company data access on all new tables
- [ ] All new code passes design system audit
