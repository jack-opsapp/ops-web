/**
 * OPS Web - Product-Inventory Bridge Types
 *
 * Types for bill-of-materials (BOM), task materials, and inventory deductions.
 * Matches Supabase schema from migration 069.
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
