// Pure adapter: committable StagingCards → the camelCase BuilderInput that
// `buildCatalogSetupPayload` serializes. This is the missing seam between the
// canvas (Phase 1 card model) and the commit pipeline (Phase 3 payload builder).
//
// Module → target:
//   sell  → products[]      (price book; the builder mirrors basePrice → base/default)
//   stock → stockFamilies[] (one FamilyInput per card — the RPC writes ONE family
//                            per call, so the route loops these, one RPC each)
//   types → typeCards[]     (trade / task_types — NOT part of catalog_setup_save;
//                            surfaced separately so the route never silently drops them)
//
// Only cards in COMMITTABLE_STATES (accepted / edited / merge) are mapped — a
// proposed-but-unacted or rejected card never reaches the commit. A `merge` card
// carries its matched live-row id so the builder UPSERTs instead of double-creating
// (spec §11 dedupe). PURE + framework-free → unit-tested without DB or network.

import {
  COMMITTABLE_STATES,
  type StagingCard,
  type TypeFields,
} from "../staging-card";
import type { OnFileProduct } from "../existing-rows";
import type {
  FamilyInput,
  ProductInput,
  VariantInput,
} from "./payload-builder";

export interface CardsToBuilderResult {
  /** SELL → one RPC call carries all of these together. */
  products: ProductInput[];
  /** STOCK → one family per entry; the route makes one RPC call per family. */
  stockFamilies: FamilyInput[];
  /** TYPES → committed outside catalog_setup_save; surfaced, never dropped. */
  typeCards: TypeFields[];
}

export interface CardsToBuilderOptions {
  /** Stamped onto created/merged rows for re-import dedupe (e.g. "quickbooks"). */
  externalSource?: string;
  /**
   * On-file values for matched SELL rows, keyed by live product id, for EVERY
   * merge card (not just verdict-bearing ones). `catalog_setup_save` UPSERTs every
   * product column from the doc (absent ⇒ the column's default — `is_active→true`,
   * `description→null`, …), so a merge that sent only the incoming card fields
   * would WIPE descriptions, un-categorize, reset storefront visibility, and
   * silently reactivate a retired product. A merge doc is therefore rebuilt FROM
   * the on-file row, overriding only the per-field verdicts the owner accepted —
   * honoring the "[ the rest stays on file ]" contract (spec §11, §17.2). A merge
   * card with no on-file entry (the live row vanished cross-session) falls back to
   * a create, never an UPSERT that would resurrect a deleted row.
   */
  existingRows?: Record<string, OnFileProduct>;
}

/**
 * A matched card UPSERTs into its live row — keyed on `matchedExistingId`
 * REGARDLESS of state. A merge card the owner then EDITS becomes state `edited`
 * but keeps its match, so the upsert must still target the live row (state-gating
 * on `merge` here created a duplicate the moment a matched card was edited).
 */
function targetId(card: StagingCard): string | undefined {
  return card.matchedExistingId;
}

/**
 * Build the ProductInput for a SELL card. A CREATE maps the card's incoming
 * fields. A MERGE (matched a live row + the on-file values are present) is rebuilt
 * FROM the on-file row, overriding ONLY the fields the owner accepted in the
 * show-diff — name / base_price / is_taxable (true/absent verdict ⇒ take incoming,
 * false ⇒ keep on file). Every other committable column (description, category_id,
 * is_active, show_in_storefront, pricing_unit, kind, sku) stays the on-file value,
 * so a re-import never silently wipes data the diff didn't surface. `unit_cost` is
 * carried from on-file too, so the RPC's coalesce(excluded.unit_cost, …) on a
 * merge just re-writes the live cost — a no-op (see CanvasPane.buildDiff).
 */
function mapSell(
  card: Extract<StagingCard, { module: "sell" }>,
  externalSource?: string,
  existingRows?: Record<string, OnFileProduct>,
): ProductInput {
  const f = card.fields;
  const id = targetId(card);
  const onFile = id ? existingRows?.[id] : undefined;

  if (id && onFile) {
    // MERGE — preserve the on-file row; apply only the accepted verdicts.
    const sel = card.fieldSelections ?? {};
    const product: ProductInput = {
      clientId: card.id,
      id,
      name: sel["name"] === false ? onFile.name : f.name,
      kind: onFile.kind, // not diffed → never reclassify on a re-import
      isTaxable: sel["is_taxable"] === false ? onFile.isTaxable : f.isTaxable,
      isActive: onFile.isActive, // never reactivate a retired product on merge
    };
    const price = sel["base_price"] === false ? onFile.defaultPrice : f.defaultPrice;
    if (price != null) product.basePrice = price;
    if (onFile.description) product.description = onFile.description;
    if (onFile.sku) product.sku = onFile.sku;
    if (onFile.pricingUnit) product.pricingUnit = onFile.pricingUnit;
    if (onFile.categoryId) product.categoryId = onFile.categoryId;
    if (onFile.showInStorefront != null)
      product.showInStorefront = onFile.showInStorefront;
    if (onFile.unitCost != null) product.unitCost = onFile.unitCost;
    if (externalSource) product.externalSource = externalSource;
    return product;
  }

  // CREATE (or a stale merge whose live row vanished → create, not resurrect).
  const product: ProductInput = {
    clientId: card.id,
    name: f.name,
    kind: f.kind,
    isTaxable: f.isTaxable,
    isActive: true,
  };
  if (f.description) product.description = f.description;
  if (f.defaultPrice != null) product.basePrice = f.defaultPrice;
  if (f.unitCost != null) product.unitCost = f.unitCost;
  if (f.sku) product.sku = f.sku;
  if (f.pricingUnit) product.pricingUnit = f.pricingUnit;
  if (externalSource) product.externalSource = externalSource;
  return product;
}

function mapStock(
  card: Extract<StagingCard, { module: "stock" }>,
  externalSource?: string,
): FamilyInput {
  const f = card.fields;
  const variant: VariantInput = {
    clientId: `${card.id}:variant`,
  };
  if (f.sku) variant.sku = f.sku;
  if (f.quantity != null) variant.quantity = f.quantity;
  if (f.unitCost != null) variant.unitCost = f.unitCost;
  if (f.reorderPoint != null) variant.reorderPoint = f.reorderPoint;
  if (f.unitId) variant.unitId = f.unitId;
  if (externalSource) variant.externalSource = externalSource;

  const family: FamilyInput = {
    clientId: card.id,
    name: f.name,
    variants: [variant],
  };
  const id = targetId(card);
  if (id) family.id = id;
  if (f.unitId) family.defaultUnitId = f.unitId;
  if (externalSource) family.externalSource = externalSource;
  return family;
}

/**
 * Partition the committable cards into builder-ready buckets. Non-committable
 * cards (proposed / rejected) are dropped here — the canvas already excludes them
 * from the "added" count.
 */
export function cardsToBuilderInput(
  cards: StagingCard[],
  opts: CardsToBuilderOptions = {},
): CardsToBuilderResult {
  const committable = cards.filter((c) =>
    COMMITTABLE_STATES.includes(c.state),
  );

  const result: CardsToBuilderResult = {
    products: [],
    stockFamilies: [],
    typeCards: [],
  };

  for (const card of committable) {
    switch (card.module) {
      case "sell":
        result.products.push(
          mapSell(card, opts.externalSource, opts.existingRows),
        );
        break;
      case "stock":
        result.stockFamilies.push(mapStock(card, opts.externalSource));
        break;
      case "types":
        result.typeCards.push(card.fields);
        break;
    }
  }

  return result;
}
