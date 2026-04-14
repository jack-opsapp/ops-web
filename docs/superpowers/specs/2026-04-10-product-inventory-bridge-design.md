# Product-Inventory Bridge — Design Spec

> **Date**: 2026-04-10
> **Workstream**: #2 — Product-Inventory Bridge
> **Status**: Approved
> **Bug Report ID**: `1d370184-aaf0-456d-bfca-81873310deed`

---

## Problem

Products (the quoting catalog) and inventory items (tracked stock) are completely disconnected. A contractor who stocks railing parts can't see whether they have enough materials when quoting a job, and must manually update inventory after completing work. This creates:

- No stock visibility at quoting time
- Manual inventory adjustments after every job (error-prone, tedious)
- No per-project material usage tracking for cost reconciliation

## Solution

An optional bill-of-materials (BOM) layer that connects products to inventory items, auto-populates material requirements on tasks, auto-deducts on task completion, and logs every deduction for reconciliation.

**Design principles:**
- Inventory remains optional — products without BOM work exactly as today
- BOM is a default recipe, always overridable per-job
- Auto-deduction is silent but reversible
- Full audit trail for every stock movement

---

## User Decisions (from brainstorming)

| Question | Decision |
|----------|----------|
| Stock indicator behavior | **Passive awareness** — green/yellow/red dot, informational only, never blocks |
| Deduction trigger | **Auto-decrement on task completion** — no confirmation prompt |
| Audit requirement | Each deduction recorded with before/after quantities for per-project reconciliation |
| BOM location | **Product default, line item override, task-level final** — recipe on product, override on estimate line item, final editable quantities on the task |
| Nuanced calculations | System provides approximate defaults from BOM ratio. User overrides for job-specific needs (post span rules, end connections, stairs). System is not a railing calculator. |

---

## Data Model

### New Tables

#### `product_materials` — BOM recipe on a product

```sql
product_id          UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
inventory_item_id   UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
quantity_per_unit   DOUBLE PRECISION NOT NULL,
notes               TEXT,
PRIMARY KEY (product_id, inventory_item_id)
```

Company isolation via JOIN to `products.company_id`. RLS uses EXISTS subquery pattern (same as `payment_milestones`).

Example rows for "Aluminum Railing System" (unit: linear ft):
| inventory_item | quantity_per_unit | notes |
|----------------|-------------------|-------|
| Aluminum Post | 0.25 | 1 per 4ft. Glass=5ft span, picket=7ft |
| 6ft Rail Section | 0.167 | 1 per 6ft |
| Post Cap | 0.25 | 1 per post |
| SS Screws (bag/10) | 0.4 | ~4 screws per foot |

#### `line_item_materials` — per-estimate override

```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
line_item_id        UUID NOT NULL REFERENCES line_items(id) ON DELETE CASCADE,
inventory_item_id   UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
quantity            DOUBLE PRECISION NOT NULL,
source              TEXT NOT NULL DEFAULT 'stock',  -- 'stock' or 'order'
UNIQUE(line_item_id, inventory_item_id)
```

Only created when the user explicitly overrides the product BOM defaults on a specific estimate line item. Most line items will have zero rows here.

#### `task_materials` — final material list on a task (what gets deducted)

```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
task_id             UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
inventory_item_id   UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
quantity            DOUBLE PRECISION NOT NULL,
source              TEXT NOT NULL DEFAULT 'stock',  -- 'stock' or 'order'
UNIQUE(task_id, inventory_item_id)
```

Auto-populated when tasks are generated from estimates. Manually populated for tasks created without estimates. This is the single source of truth for what gets deducted.

#### `inventory_deductions` — audit trail

```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
inventory_item_id   UUID NOT NULL REFERENCES inventory_items(id) ON DELETE SET NULL,
project_id          UUID REFERENCES projects(id) ON DELETE SET NULL,
task_id             UUID REFERENCES project_tasks(id) ON DELETE SET NULL,
line_item_id        UUID REFERENCES line_items(id) ON DELETE SET NULL,
quantity_deducted   DOUBLE PRECISION NOT NULL,
previous_quantity   DOUBLE PRECISION NOT NULL,
new_quantity        DOUBLE PRECISION NOT NULL,
reason              TEXT NOT NULL DEFAULT 'task_completion',
deducted_by         UUID,
deducted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
notes               TEXT
```

Reason values: `'task_completion'`, `'task_reopened'` (reversal), `'manual_adjustment'`, `'skipped_archived'` (item was archived, deduction skipped — logged for audit visibility).

### Altered Tables

#### `project_tasks` — add deduction guard

```sql
ALTER TABLE project_tasks ADD COLUMN inventory_deducted BOOLEAN NOT NULL DEFAULT FALSE;
```

---

## Flow Logic

### 1. BOM Setup (one-time per product)

User edits a product in the catalog → adds material rows specifying inventory items and quantity per unit. Saved to `product_materials`. No effect on existing estimates or tasks.

### 2. Stock Indicator at Quoting Time

When a line item is added to an estimate with a product that has `product_materials`:
1. Check if `line_item_materials` override rows exist for this line item:
   - If yes: use override quantities directly
   - If no: calculate from BOM: `line_item.quantity * product_materials.quantity_per_unit` for each material
2. Compare required quantities against `inventory_items.quantity` (only non-archived items: `deleted_at IS NULL`)
3. Display indicator:
   - **Green**: all materials have sufficient stock
   - **Yellow**: any material would drop below its `warning_threshold` after deduction
   - **Red**: any material has insufficient stock (required > current quantity)
4. Tooltip shows per-material breakdown on hover

Indicator shows raw stock levels (V1). Does not account for materials committed to other pending jobs.

### 3. Material Override on Estimate Line Item (optional)

User can expand a "Materials" section on a line item to see calculated defaults and override quantities. Overrides saved to `line_item_materials`. Most users skip this step.

### 4. Task Materials Population (at task creation)

When ReviewTasksModal creates tasks from approved estimate line items:

1. For each task being created, check its source line item:
   a. If `line_item_materials` rows exist for that line item → copy to `task_materials`
   b. Else if line item has `product_id` with `product_materials` → calculate quantities (`line_item.quantity * quantity_per_unit`) and insert into `task_materials`
   c. Else → no `task_materials` (product has no BOM, or custom line item)
2. `source` field is preserved ('stock' or 'order')

For manually created tasks (no estimate): `task_materials` starts empty. User attaches materials through the task UI.

### 5. Material Review on Task (optional)

User can view/edit `task_materials` on the task detail panel at any time before completion. This is where CanPro adjusts from 12.5 posts (BOM default) to 15 posts (actual need for this specific job with stairs).

### 6. Auto-Deduction on Task Completion

When task status changes to `completed`:

```
BEGIN TRANSACTION;

  -- Guard: lock row, prevent double deduction
  SELECT inventory_deducted FROM project_tasks
    WHERE id = :task_id FOR UPDATE;

  IF inventory_deducted = true THEN
    RETURN;  -- already processed
  END IF;

  -- Resolve task's project_id and source_line_item_id for audit trail
  -- (read from project_tasks row)

  FOR EACH task_materials row WHERE source = 'stock':
    -- Read current stock
    current_qty = SELECT quantity FROM inventory_items
      WHERE id = :inventory_item_id FOR UPDATE;

    -- Skip archived inventory items
    IF inventory_item.deleted_at IS NOT NULL THEN
      CONTINUE;  -- log warning in deductions with reason='skipped_archived'
    END IF;

    -- Calculate new quantity (floor at 0)
    new_qty = GREATEST(0, current_qty - :material_quantity);

    -- Update stock
    UPDATE inventory_items SET quantity = new_qty WHERE id = :inventory_item_id;

    -- Log deduction
    INSERT INTO inventory_deductions (
      company_id, inventory_item_id, project_id, task_id, line_item_id,
      quantity_deducted, previous_quantity, new_quantity,
      reason, deducted_by
    ) VALUES (...);

    -- Threshold notification (dedup via create_notification_if_new RPC)
    IF new_qty <= warning_threshold THEN
      CALL create_notification_if_new(
        p_user_id := admin_user_id,  -- each admin in company.admin_ids
        p_company_id := company_id,
        p_type := 'system',
        p_title := 'Low stock: ' || item_name,
        p_body := item_name || ' is low (' || new_qty || ' remaining)',
        p_persistent := false
      );
      -- Dedup: partial unique index on (user_id, company_id, type, title)
      -- WHERE is_read = false prevents duplicate unread notifications
    END IF;

  END FOR;

  -- Mark task as deducted
  UPDATE project_tasks SET inventory_deducted = true WHERE id = :task_id;

COMMIT;
```

Materials with `source = 'order'` are skipped (ordered for this job, never in inventory).

### 7. Reversal on Task Reopening

When task status changes FROM `completed` to any other status AND `inventory_deducted = true`:

```
BEGIN TRANSACTION;

  FOR EACH inventory_deductions row WHERE task_id = :task_id AND reason = 'task_completion':
    -- Restore stock
    UPDATE inventory_items
      SET quantity = quantity + :quantity_deducted
      WHERE id = :inventory_item_id;

    -- Log reversal
    INSERT INTO inventory_deductions (
      ..., quantity_deducted = :original_quantity,
      reason = 'task_reopened', notes = 'Reversed: task reopened'
    );

  END FOR;

  UPDATE project_tasks SET inventory_deducted = false WHERE id = :task_id;

COMMIT;
```

---

## UI Touchpoints

Each touchpoint requires full UX design treatment during implementation (`mobile-ux-design` -> `wireframe` -> `frontend-design` -> `audit-design-system`). Below describes WHAT each touchpoint does, not HOW it looks.

### Touchpoint 1: Product BOM Editor

**Where**: Products page, within product edit modal/form
**What**: Add/edit/remove material rows (inventory item + quantity per unit + notes)
**When visible**: Always on product edit, but only functional if company has inventory items
**Interaction**: Add row via inventory item search, inline quantity input, delete with confirmation
**Data**: Reads/writes `product_materials`

### Touchpoint 2: Estimate Stock Indicator

**Where**: LineItemEditor component, on each line item row
**What**: Green/yellow/red dot with tooltip showing per-material stock breakdown
**When visible**: Only on line items linked to a product with `product_materials`
**Interaction**: Hover for tooltip. No click action.
**Data**: Reads `product_materials`, `inventory_items.quantity`, `inventory_items.warning_threshold`

### Touchpoint 3: Estimate Material Override

**Where**: Estimate edit modal, expandable section per line item
**What**: View calculated material defaults, edit quantities, set source (stock/order)
**When visible**: Expandable on line items with product BOM. Collapsed by default.
**Interaction**: Expand/collapse, inline quantity editing, source toggle
**Data**: Reads `product_materials` for defaults, writes `line_item_materials`

### Touchpoint 4: Task Materials Panel

**Where**: Task detail side panel (calendar) or task detail view
**What**: View/edit materials attached to this task. Add materials for manual tasks.
**When visible**: Always on task detail (empty state for tasks with no materials)
**Interaction**: Edit quantities, add/remove materials (inventory item search), source toggle
**Data**: Reads/writes `task_materials`

### Touchpoint 5: Project Deduction History

**Where**: Project detail page, new section or tab
**What**: Read-only table of all inventory deductions for this project
**Columns**: Date, task name, inventory item, quantity deducted, previous stock, new stock, deducted by
**When visible**: Always on project detail (empty state if no deductions)
**Interaction**: Read-only. Reversed deductions shown with visual distinction.
**Data**: Reads `inventory_deductions` WHERE `project_id = :id`

---

## Accepted V1 Limitations

1. **Stock indicator shows raw stock** — does not subtract materials committed to other pending jobs. "Available stock" calculation deferred to V2.
2. **Estimate revisions don't auto-sync task_materials** — if estimate quantity changes after tasks are created, user must manually update task materials.
3. **No partial deduction** — materials deduct all-or-nothing when task is marked complete. No incremental deduction as work progresses.
4. **Fractional BOM quantities** — stored as-is (e.g., 12.5 posts). User overrides to whole numbers when needed. System does not auto-round.
5. **No product BOM auto-suggest for manual tasks** — tasks created without estimates start with empty materials. User adds manually.

---

## Service Layer Changes

### New Services

- **`product-materials-service.ts`** — CRUD for `product_materials`. Fetch by product_id, upsert, delete.
- **`task-materials-service.ts`** — CRUD for `task_materials`. Fetch by task_id, upsert, delete. Includes `populateFromLineItem(taskId, lineItemId)` method.
- **`inventory-deduction-service.ts`** — `deductForTask(taskId, userId)`, `reverseForTask(taskId, userId)`, `fetchByProject(projectId)`. Contains the transactional deduction/reversal logic.

### Modified Services

- **`estimate-service.ts`** — `mapLineItemFromDb` already reads `product_id`. No change needed for stock indicator (UI component fetches product_materials separately).
- **`task-service.ts`** — On status change to `completed`, call `inventoryDeductionService.deductForTask()`. On status change FROM `completed`, call `reverseForTask()`. Add `inventory_deducted` to task mappers.
- **`product-service.ts`** — No changes to existing API. New `product_materials` managed by its own service.
- **Task creation flow (ReviewTasksModal)** — After creating tasks, call `taskMaterialsService.populateFromLineItem()` for each task with a source line item.

### New Hooks

- `useProductMaterials(productId)` — fetch/mutate BOM for a product
- `useTaskMaterials(taskId)` — fetch/mutate materials on a task
- `useStockIndicator(lineItems)` — compute stock status for a set of line items (batch query)
- `useProjectDeductions(projectId)` — fetch deduction history

---

## Migration

Single migration file: `059_product_inventory_bridge.sql`

Creates: `product_materials`, `line_item_materials`, `task_materials`, `inventory_deductions`
Alters: `project_tasks` (adds `inventory_deducted`)
RLS: Company-scoped policies on all new tables
Indexes: On all FK columns, partial index on `inventory_deductions(project_id)`, partial index on `task_materials(task_id)`

---

## Permissions

Uses existing permission system:
- `products.manage` — required to edit product BOM
- `estimates.edit` — required to override line item materials
- `tasks.edit` — required to edit task materials
- `inventory.manage` — required to manually adjust inventory (existing)

No new permission enum values needed.

---

## Testing

- Product BOM CRUD (create, update, delete material rows)
- Stock indicator calculation (green/yellow/red thresholds)
- Task materials auto-population from product BOM
- Task materials auto-population from line item override
- Manual task materials (no estimate)
- Deduction on task completion (quantities correct, audit trail written)
- Deduction guard (double completion doesn't double-deduct)
- Reversal on task reopening (stock restored, reversal logged)
- Source='order' materials skipped during deduction
- Threshold notification fires when stock drops below warning
- RLS: users can only see their company's data across all new tables
