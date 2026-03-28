/**
 * OPS Web - Inventory Entity Types
 *
 * TypeScript interfaces for all inventory entities: items, units, tags,
 * item-tag associations, snapshots, and snapshot items. These map to the
 * Supabase PostgreSQL schema tables (inventory_items, inventory_units,
 * inventory_tags, inventory_item_tags, inventory_snapshots,
 * inventory_snapshot_items) and mirror the iOS SwiftData models.
 *
 * Conventions:
 *   - All interfaces use camelCase (snake_case -> camelCase conversion happens
 *     at the service layer).
 *   - `Date | null` for optional timestamps.
 *   - Threshold helpers use "highest value wins" logic when merging item and
 *     tag thresholds.
 */

// ─── Threshold Types & Helpers ───────────────────────────────────────────────

/** Stock-level status derived from quantity vs. warning/critical thresholds */
export type ThresholdStatus = "normal" | "warning" | "critical";

/**
 * Returns the strictest (highest) thresholds from an item and its associated
 * tags. When both an item and one or more tags define a threshold, the highest
 * value wins (i.e. the most conservative / earliest-triggering threshold).
 */
export function getEffectiveThresholds(
  item: Pick<InventoryItem, "warningThreshold" | "criticalThreshold">,
  tags: Pick<InventoryTag, "warningThreshold" | "criticalThreshold">[]
): { warningThreshold: number | null; criticalThreshold: number | null } {
  let warning: number | null = item.warningThreshold;
  let critical: number | null = item.criticalThreshold;

  for (const tag of tags) {
    if (tag.warningThreshold !== null) {
      warning =
        warning !== null
          ? Math.max(warning, tag.warningThreshold)
          : tag.warningThreshold;
    }
    if (tag.criticalThreshold !== null) {
      critical =
        critical !== null
          ? Math.max(critical, tag.criticalThreshold)
          : tag.criticalThreshold;
    }
  }

  return { warningThreshold: warning, criticalThreshold: critical };
}

/**
 * Determines the threshold status for a given quantity. Critical takes
 * precedence over warning.
 */
export function getThresholdStatus(
  quantity: number,
  warningThreshold: number | null,
  criticalThreshold: number | null
): ThresholdStatus {
  if (criticalThreshold !== null && quantity <= criticalThreshold) {
    return "critical";
  }
  if (warningThreshold !== null && quantity <= warningThreshold) {
    return "warning";
  }
  return "normal";
}

// ─── Inventory Item ──────────────────────────────────────────────────────────

/** A tracked inventory item belonging to a company */
export interface InventoryItem {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  quantity: number;
  unitId: string | null;
  sku: string | null;
  notes: string | null;
  imageUrl: string | null;
  warningThreshold: number | null;
  criticalThreshold: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  deletedAt: Date | null;
}

/** Fields required to create a new inventory item */
export type CreateInventoryItem = Omit<
  InventoryItem,
  "id" | "createdAt" | "updatedAt" | "deletedAt"
>;

/** Fields that can be updated on an existing inventory item */
export type UpdateInventoryItem = Partial<
  Omit<InventoryItem, "id" | "companyId" | "createdAt" | "updatedAt" | "deletedAt">
>;

// ─── Inventory Unit ──────────────────────────────────────────────────────────

/** A unit of measure for inventory items (e.g. "rolls", "boxes", "gallons") */
export interface InventoryUnit {
  id: string;
  companyId: string;
  display: string;
  isDefault: boolean;
  sortOrder: number;
  createdAt: Date | null;
  updatedAt: Date | null;
  deletedAt: Date | null;
}

/** Fields required to create a new inventory unit */
export interface CreateInventoryUnit {
  companyId: string;
  display: string;
  isDefault?: boolean;
  sortOrder?: number;
}

// ─── Inventory Tag ───────────────────────────────────────────────────────────

/** A category tag for inventory items, optionally carrying its own thresholds */
export interface InventoryTag {
  id: string;
  companyId: string;
  name: string;
  warningThreshold: number | null;
  criticalThreshold: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  deletedAt: Date | null;
}

/** Fields required to create a new inventory tag */
export interface CreateInventoryTag {
  companyId: string;
  name: string;
  warningThreshold?: number | null;
  criticalThreshold?: number | null;
}

/** Fields that can be updated on an existing inventory tag */
export type UpdateInventoryTag = Partial<
  Pick<InventoryTag, "name" | "warningThreshold" | "criticalThreshold">
>;

// ─── Inventory Item-Tag Association ──────────────────────────────────────────

/** Join record linking an inventory item to a tag */
export interface InventoryItemTag {
  id: string;
  itemId: string;
  tagId: string;
}

// ─── Inventory Snapshot ──────────────────────────────────────────────────────

/** A point-in-time snapshot of inventory state */
export interface InventorySnapshot {
  id: string;
  companyId: string;
  createdById: string | null;
  isAutomatic: boolean;
  itemCount: number;
  notes: string | null;
  createdAt: Date | null;
}

/** Fields required to create a new inventory snapshot */
export interface CreateInventorySnapshot {
  companyId: string;
  createdById?: string | null;
  isAutomatic?: boolean;
  itemCount: number;
  notes?: string | null;
}

// ─── Inventory Snapshot Item ─────────────────────────────────────────────────

/** A single item record within an inventory snapshot */
export interface InventorySnapshotItem {
  id: string;
  snapshotId: string;
  originalItemId: string | null;
  name: string;
  quantity: number;
  unitDisplay: string | null;
  sku: string | null;
  tagsString: string | null;
  description: string | null;
}

/** Fields required to create a new snapshot item */
export type CreateInventorySnapshotItem = Omit<InventorySnapshotItem, "id">;
