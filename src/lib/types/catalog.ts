/**
 * OPS Web — Catalog (variant-aware stock) types
 *
 * WEB OVERHAUL P3.2. The Catalog STOCK segment reads the `catalog_*` tables
 * directly (variants + families + categories + units + option-value labels +
 * family tags), NOT the legacy `inventory_*` compatibility views the retired
 * /inventory page used. Those views flatten variant→family and are
 * variant-blind; this model preserves variant identity.
 *
 * Threshold status follows the canonical 3-level cascade
 * variant → family → category (iOS parity, bible 03 § Catalog & Variant
 * Model). Legacy tag-level thresholds (`catalog_tags.warning/critical`) are
 * deliberately NOT consulted (capability inventory descope D3) so web and iOS
 * agree about the same shelf.
 */

// ─── Threshold status ─────────────────────────────────────────────────────────

/**
 * `untracked` is new on web (the retired page silently classed threshold-less
 * items as "normal/OK"): a variant with no effective threshold at any cascade
 * level is UNTRACKED, never OK — counting unmeasured stock as healthy is a lie.
 */
export type CatalogStatus = "normal" | "warning" | "critical" | "untracked";

export interface EffectiveThresholds {
  warning: number | null;
  critical: number | null;
}

/**
 * Resolve the effective warning/critical thresholds for a variant by walking
 * the cascade: variant override → family default → category default → null.
 * Each level is resolved independently (a variant may inherit its warning from
 * the family but its critical from the category).
 */
export function effectiveThresholds(
  variant: { warning: number | null; critical: number | null },
  family: { warning: number | null; critical: number | null } | null,
  category: { warning: number | null; critical: number | null } | null,
): EffectiveThresholds {
  const resolve = (
    v: number | null,
    f: number | null | undefined,
    c: number | null | undefined,
  ): number | null => v ?? f ?? c ?? null;

  return {
    warning: resolve(variant.warning, family?.warning, category?.warning),
    critical: resolve(variant.critical, family?.critical, category?.critical),
  };
}

/**
 * Status for a quantity against its effective thresholds. Critical wins over
 * warning. When BOTH effective thresholds are null the variant is UNTRACKED
 * (no shelf alarm can fire), never normal.
 */
export function statusFor(
  quantity: number,
  eff: EffectiveThresholds,
): CatalogStatus {
  if (eff.warning == null && eff.critical == null) return "untracked";
  if (eff.critical != null && quantity <= eff.critical) return "critical";
  if (eff.warning != null && quantity <= eff.warning) return "warning";
  return "normal";
}

// ─── Stock row (one per variant) ──────────────────────────────────────────────

export interface CatalogStockRow {
  /** Variant id — the SKU-level row identity. */
  variantId: string;
  /** Family (catalog_item) id. */
  itemId: string;
  companyId: string;

  /** Family name — the row's primary label. */
  familyName: string;
  /** Family description (catalog_items.description). */
  familyDescription: string | null;
  /** Family image (catalog_items.image_url) — iOS-managed photo upload. */
  imageUrl: string | null;

  /**
   * Ordered option-value label, e.g. "Black · Topmount" (display uppercases).
   * `null` when the family carries no option axes (single-variant family).
   */
  variantLabel: string | null;

  categoryId: string | null;
  categoryName: string | null;

  sku: string | null;
  quantity: number;

  unitId: string | null;
  unitDisplay: string | null;
  unitAbbreviation: string | null;

  /** Per-variant cost override (catalog_variants.unit_cost_override). */
  unitCostOverride: number | null;
  /** Family default cost (catalog_items.default_unit_cost). */
  familyDefaultCost: number | null;
  /** Resolved cost (override ?? family default) — null when neither set. */
  effectiveCost: number | null;

  /** Raw variant threshold overrides (null = inherits). */
  warningOverride: number | null;
  criticalOverride: number | null;
  /** Resolved thresholds after the 3-level cascade. */
  effectiveWarning: number | null;
  effectiveCritical: number | null;
  /** Which cascade level supplied each effective threshold (for the drawer). */
  warningSource: ThresholdSource;
  criticalSource: ThresholdSource;

  status: CatalogStatus;

  /** Family-level tags (applies to every variant of the family). */
  tags: string[];

  isActive: boolean;
  updatedAt: Date | null;
}

export type ThresholdSource = "variant" | "family" | "category" | "none";

// ─── Family + variant authoring ───────────────────────────────────────────────

export interface CatalogFamily {
  id: string;
  companyId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  defaultPrice: number | null;
  defaultUnitCost: number | null;
  defaultWarningThreshold: number | null;
  defaultCriticalThreshold: number | null;
  defaultUnitId: string | null;
  imageUrl: string | null;
  notes: string | null;
  isActive: boolean;
}

export interface CatalogCategoryNode {
  id: string;
  companyId: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  colorHex: string | null;
  defaultWarningThreshold: number | null;
  defaultCriticalThreshold: number | null;
}

export interface CatalogTag {
  id: string;
  companyId: string;
  name: string;
}

export interface CatalogUnit {
  id: string;
  companyId: string;
  display: string;
  abbreviation: string | null;
  dimension: string;
  isDefault: boolean;
  sortOrder: number;
}

// ─── Adjustment ledger row (drawer) ────────────────────────────────────────────

export type AdjustmentReason =
  | "manual_adjustment"
  | "task_completion"
  | "task_reopened"
  | "skipped_archived";

export interface CatalogAdjustment {
  id: string;
  quantityDelta: number;
  previousQuantity: number;
  newQuantity: number;
  reason: AdjustmentReason;
  /** Resolved task/project label when reason is task-attributed, else null. */
  taskLabel: string | null;
  notes: string | null;
  at: Date;
}

// ─── Reverse link (drawer "used in") ───────────────────────────────────────────

export interface CatalogUsedIn {
  productId: string;
  productName: string;
  /** "recipe" = referenced by product_materials; "stock_link" = product's
   *  linked_catalog_item_id points at this variant's family. */
  via: "recipe" | "stock_link";
}

// ─── Snapshot ──────────────────────────────────────────────────────────────────

export interface CatalogSnapshot {
  id: string;
  companyId: string;
  createdById: string | null;
  isAutomatic: boolean;
  itemCount: number;
  notes: string | null;
  createdAt: Date | null;
}

export interface CatalogSnapshotItem {
  id: string;
  snapshotId: string;
  originalVariantId: string | null;
  familyName: string;
  variantLabel: string | null;
  quantity: number;
  unitDisplay: string | null;
  sku: string | null;
  description: string | null;
}

// ─── Product margin (PRODUCTS segment) ─────────────────────────────────────────

/**
 * Margin % from a product's price and cost. Returns null when either is
 * missing or price is zero — the cell renders `—` and the row is a NO-COST
 * worklist candidate (self-motivating cost entry).
 */
export function productMargin(
  price: number | null | undefined,
  cost: number | null | undefined,
): number | null {
  if (price == null || cost == null) return null;
  if (price <= 0) return null;
  return ((price - cost) / price) * 100;
}
