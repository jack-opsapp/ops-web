// Pure QuickBooks `Item` → catalog draft mapper (Task 5.3).
//
// The single load-bearing new logic of the QB import lane: a side-effect-free
// transform from a raw QBO `Item` record (as returned by `SELECT * FROM Item`)
// into a normalized catalog draft row. NO Supabase, NO network, NO UI — pure and
// fixture-driven, so every mapping-table row is unit-testable.
//
// Output enums are exactly the VERIFIED prod CHECK values:
//   product.kind         ∈ { service, material, package }   (null = drop the row)
//   product.type         ∈ { LABOR, MATERIAL, OTHER }
//   product.pricing_unit ∈ { each, flat_rate, linear_foot, sqft, hour, day }
//
// Mapping contract (spec §9 + verified schema, plan Task 5.3):
//   Item.Name        → name (required; absent ⇒ blocker 'missing_name')
//   Item.Sku         → sku (nullable)
//   Item.Description → description
//   Item.UnitPrice   → basePrice AND defaultPrice (numeric, default 0)
//   Item.PurchaseCost→ unitCost (nullable)
//   Item.Taxable     → isTaxable (default true when absent — matches column default)
//   Item.Type        → kind + type (+ Inventory stock card, + Group bundle)
//   external_source  = 'quickbooks', external_id = String(Item.Id)
//
// The draft is an intermediate richer than the canvas `StagingCard`: Task 5.4
// adapts accepted drafts → the `catalog_setup_save` payload, and Task 5.6 adapts
// drafts → `StagingCard`s on the live-building canvas.

import type { QboRawRecord } from "@/lib/types/qbo-import";
import { qbStr, qbNum } from "./qb-field";

/** Stable external-identity source for every QB-sourced draft (spec §11, §15). */
export const QB_EXTERNAL_SOURCE = "quickbooks" as const;

/** Default pricing unit — QB has no native pricing-unit concept (plan Task 5.3). */
export const DEFAULT_PRICING_UNIT = "each" as const;

/** Verified prod CHECK enum for product.kind (null = a non-sellable row to drop). */
export type ProductKind = "service" | "material" | "package";

/** Verified prod CHECK enum for product.type (estimate-line bucket). */
export type ProductType = "LABOR" | "MATERIAL" | "OTHER";

/** Whether the importing company tracks inventory (spec §9 STOCK gate). */
export type InventoryMode = "off" | "tracked";

/** Why a draft cannot be committed as-is (surfaced for owner fix, never silently dropped). */
export type DraftBlocker = "missing_name";

/** Options controlling the mapping. */
export interface MapQbItemOptions {
  /** `company_inventory_settings.inventory_mode` — gates Inventory stock cards. */
  inventoryMode: InventoryMode;
}

/** A stock card derived from an Inventory-type Item (only when tracked). */
export interface CatalogItemDraft {
  name: string;
  /** on-hand (catalog_variants.quantity); QtyOnHand ?? 0. */
  onHand: number;
  /** catalog_variants.unit_cost_override (PurchaseCost). */
  unitCostOverride: number | null;
  /** catalog_variants.price_override (UnitPrice). */
  priceOverride: number | null;
  sku: string | null;
}

/** A single component line of a Group/bundle (resolved to a product id in 5.4). */
export interface BundleItemDraft {
  /** The component Item.Id (resolved within the import batch in Task 5.4). */
  componentExternalId: string;
  quantity: number;
}

/**
 * One mapped catalog draft row.
 *
 * `kind === null` is a SENTINEL: the source Item is a non-sellable QB folder
 * (Type "Category"). The caller drops it — it never becomes a card.
 */
export interface QbItemDraft {
  /** null ⇒ drop this row (Category folder). */
  kind: ProductKind | null;
  type: ProductType;
  name: string;
  sku: string | null;
  description: string | null;
  /** products.base_price (== defaultPrice for a flat QB price). */
  basePrice: number;
  /** products.default_price. */
  defaultPrice: number;
  /** products.unit_cost (PurchaseCost; nullable). */
  unitCost: number | null;
  isTaxable: boolean;
  pricingUnit: string;
  externalSource: typeof QB_EXTERNAL_SOURCE;
  externalId: string;
  /** Inventory stock card — present only when Inventory + inventoryMode 'tracked'. */
  catalogItem: CatalogItemDraft | null;
  /** True when this product links a stock card (Inventory + tracked). */
  linkedCatalogItem: boolean;
  /** Inventory arrived but inventory_mode is 'off' — surface the one-time prompt (spec §9, Task 5.9). */
  pendingInventoryDecision: boolean;
  /** Bundle component lines (Group items only). */
  bundleItems: BundleItemDraft[];
  /** A safe default was applied to an unknown shape — owner should review. */
  needsReview: boolean;
  /** Non-null ⇒ cannot commit as-is until the owner fixes it. */
  blocker: DraftBlocker | null;
}

/** The partitioned result of mapping a whole QB Item pull (Task 5.3 step 8). */
export interface MapQbItemsResult {
  /** Every committable/visible card (Category folders already dropped). */
  cards: QbItemDraft[];
  /** Cards that cannot commit until fixed (e.g. missing name). Subset of `cards`. */
  blockers: QbItemDraft[];
  /** Cards mapped via a safe default that the owner should review. Subset of `cards`. */
  needsReview: QbItemDraft[];
}

/** Known QB Item.Type values that map to a sellable kind/type pair. */
type KnownItemType = "Service" | "NonInventory" | "Inventory" | "Group";

/** Map a known QB Item.Type to its product kind + estimate-line type bucket. */
const KIND_BY_TYPE: Record<KnownItemType, { kind: ProductKind; type: ProductType }> = {
  Service: { kind: "service", type: "LABOR" },
  NonInventory: { kind: "material", type: "MATERIAL" },
  Inventory: { kind: "material", type: "MATERIAL" },
  Group: { kind: "package", type: "OTHER" },
};

/** Derive bundle component lines from a Group's ItemGroupDetail.ItemGroupLine[]. */
function deriveBundleItems(raw: QboRawRecord): BundleItemDraft[] {
  const detail = raw.ItemGroupDetail as { ItemGroupLine?: unknown } | undefined;
  const lines = Array.isArray(detail?.ItemGroupLine) ? detail.ItemGroupLine : [];
  const out: BundleItemDraft[] = [];
  for (const line of lines as QboRawRecord[]) {
    const ref = line.ItemRef as { value?: string } | undefined;
    const componentExternalId = qbStr(ref?.value);
    if (!componentExternalId) continue; // a line with no component ref is unusable
    out.push({
      componentExternalId,
      quantity: qbNum(line.Qty) ?? 1,
    });
  }
  return out;
}

/**
 * Map ONE raw QB `Item` record to a catalog draft row. Pure.
 *
 * Returns a draft whose `kind === null` when the Item is a non-sellable folder
 * (Type "Category") — the caller (`mapQbItems`) drops those.
 */
export function mapQbItem(raw: QboRawRecord, opts: MapQbItemOptions): QbItemDraft {
  const externalId = String(raw.Id);
  const rawType = qbStr(raw.Type);

  // Shared scalar fields (computed once; the kind sentinel still carries them
  // so a debugging caller can see what was dropped).
  const name = qbStr(raw.Name) ?? "";
  const sku = qbStr(raw.Sku);
  const description = qbStr(raw.Description);
  const unitPrice = qbNum(raw.UnitPrice) ?? 0; // NOT NULL default 0
  // PurchaseCost → unit_cost (nullable). QB emits 0 as the unset default for
  // non-purchasable items (e.g. a Service), where 0 carries no pricing
  // information — coalesce 0/absent to null so the card shows "—", not "$0".
  const rawCost = qbNum(raw.PurchaseCost);
  const unitCost = rawCost && rawCost !== 0 ? rawCost : null;
  // Taxable defaults to true when absent — matches the products.is_taxable column default.
  const isTaxable = typeof raw.Taxable === "boolean" ? (raw.Taxable as boolean) : true;

  const base: Omit<QbItemDraft, "kind" | "type" | "catalogItem" | "linkedCatalogItem" | "pendingInventoryDecision" | "bundleItems" | "needsReview"> = {
    name,
    sku,
    description,
    basePrice: unitPrice,
    defaultPrice: unitPrice,
    unitCost,
    isTaxable,
    pricingUnit: DEFAULT_PRICING_UNIT,
    externalSource: QB_EXTERNAL_SOURCE,
    externalId,
    blocker: qbStr(raw.Name) ? null : "missing_name",
  };

  // Category folders are non-sellable — drop sentinel (kind: null).
  if (rawType === "Category") {
    return {
      ...base,
      kind: null,
      type: "OTHER",
      catalogItem: null,
      linkedCatalogItem: false,
      pendingInventoryDecision: false,
      bundleItems: [],
      needsReview: false,
    };
  }

  // Group/bundle.
  if (rawType === "Group") {
    return {
      ...base,
      kind: "package",
      type: "OTHER",
      catalogItem: null,
      linkedCatalogItem: false,
      pendingInventoryDecision: false,
      bundleItems: deriveBundleItems(raw),
      needsReview: false,
    };
  }

  // Inventory — material/MATERIAL on the product side; a stock card ONLY when
  // the company tracks inventory, else flag the one-time decision.
  if (rawType === "Inventory") {
    const tracked = opts.inventoryMode === "tracked";
    return {
      ...base,
      kind: "material",
      type: "MATERIAL",
      catalogItem: tracked
        ? {
            name,
            onHand: qbNum(raw.QtyOnHand) ?? 0,
            unitCostOverride: unitCost,
            priceOverride: unitPrice,
            sku,
          }
        : null,
      linkedCatalogItem: tracked,
      pendingInventoryDecision: !tracked,
      bundleItems: [],
      needsReview: false,
    };
  }

  // Service / NonInventory — direct kind/type lookup.
  const mapped = rawType ? KIND_BY_TYPE[rawType as KnownItemType] : undefined;
  if (mapped) {
    return {
      ...base,
      kind: mapped.kind,
      type: mapped.type,
      catalogItem: null,
      linkedCatalogItem: false,
      pendingInventoryDecision: false,
      bundleItems: [],
      needsReview: false,
    };
  }

  // Unknown / absent Type → safe default (service/OTHER) + flag for review.
  return {
    ...base,
    kind: "service",
    type: "OTHER",
    catalogItem: null,
    linkedCatalogItem: false,
    pendingInventoryDecision: false,
    bundleItems: [],
    needsReview: true,
  };
}

/**
 * Map a whole QB Item pull. Drops Category folders (kind:null) and partitions
 * the surviving drafts into `cards` (all), `blockers` (cannot commit until
 * fixed), and `needsReview` (safe-defaulted, owner should confirm). Pure.
 */
export function mapQbItems(items: QboRawRecord[], opts: MapQbItemOptions): MapQbItemsResult {
  const cards: QbItemDraft[] = [];
  const blockers: QbItemDraft[] = [];
  const needsReview: QbItemDraft[] = [];
  for (const raw of items) {
    const draft = mapQbItem(raw, opts);
    if (draft.kind === null) continue; // Category folder — dropped, never a card
    cards.push(draft);
    if (draft.blocker !== null) blockers.push(draft);
    if (draft.needsReview) needsReview.push(draft);
  }
  return { cards, blockers, needsReview };
}
