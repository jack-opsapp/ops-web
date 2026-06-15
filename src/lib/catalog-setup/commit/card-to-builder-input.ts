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
}

/** A merge card resolves into its matched live row; otherwise it is a create. */
function targetId(card: StagingCard): string | undefined {
  return card.state === "merge" ? card.matchedExistingId : undefined;
}

function mapSell(
  card: Extract<StagingCard, { module: "sell" }>,
  externalSource?: string,
): ProductInput {
  const f = card.fields;
  const product: ProductInput = {
    clientId: card.id,
    name: f.name,
    kind: f.kind,
    isTaxable: f.isTaxable,
    isActive: true,
  };
  const id = targetId(card);
  if (id) product.id = id;
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
        result.products.push(mapSell(card, opts.externalSource));
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
