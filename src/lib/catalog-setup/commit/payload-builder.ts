// PURE payload builder: clean camelCase `BuilderInput` → the exact
// `catalog_setup_save` wire payload (`CatalogSetupPayload`).
//
// This is the ONLY place the snake_case RPC doc shape is assembled. Call sites
// (route, agent, importer) hand it a vocab-RESOLVED, dedupe-RESOLVED input —
// category_id/unit_id are already real UUIDs and any merge target is already
// set as `id`. The builder does no I/O, no DB, no env: pure data → data.
//
// HARD CONTRACTS enforced here (spec §4, verified RPC body):
//   - Tiers expand to a `select` option + values + `add_flat` modifiers.
//     `tiered_pricing` is NEVER emitted (the wire types omit the field).
//   - `base_price` mirrors `default_price`; tier base = lowest step price.
//   - Recipes MUST pin a concrete `catalog_variant_id` OR a non-empty
//     `variant_selector`; a nil-selector family pin throws (it would be
//     silently dropped from the cut list otherwise).
//   - At most ONE family per call (the RPC writes one family per invocation;
//     the route loops families — the builder does not).
//
// DEFERRED(wave-2): the server route / RPC call (`getAccessTokenClient` +
// `catalog_setup_save` + idempotency key + completion stamp) lands in Task 3.4.
// This module produces the payload only.

import type {
  BundleItemDoc,
  CatalogSetupPayload,
  FamilyDoc,
  OptionValueDoc,
  PricingModifierDoc,
  ProductDoc,
  ProductMaterialDoc,
  ProductOptionDoc,
  SetupMode,
  VariantDoc,
} from "./payload-builder.types";

// ── INPUT (clean camelCase, deliberately distinct from the wire shape) ──────

export type ProductKind = "service" | "material" | "package";

/** One rung of a tier ladder (e.g. "Medium" → $6,500). */
export interface TierStepInput {
  label: string;
  price: number;
  /** optional explicit sort order; defaults to authored order */
  sortOrder?: number;
}

/** A "price by size/option" ladder → select option + add_flat modifiers. */
export interface TierInput {
  /** option label, e.g. "Size". Defaults to "Size" when omitted. */
  optionName?: string;
  /**
   * The flat base price. When omitted, the lowest step price is used. Deltas
   * are computed as `step.price - base`.
   */
  basePrice?: number;
  steps: TierStepInput[];
}

/** A recipe line (how much stock one unit draws down). */
export interface RecipeInput {
  /** concrete variant pin (preferred) */
  catalogVariantId?: string;
  /** family id — REQUIRES a non-empty variantSelector to be valid */
  catalogItemId?: string;
  /** fully-resolvable selector when pinning by family */
  variantSelector?: Record<string, unknown>;
  /** defaults to 1 */
  quantityPerUnit?: number;
  notes?: string;
  scaledByOptionClientId?: string;
  unitId?: string;
}

/** A child line of a bundle/package product. */
export interface BundleItemInput {
  /** sibling product in the SAME payload (preferred) */
  childProductClientId?: string;
  /** an already-persisted product row */
  childProductId?: string;
  quantity: number;
  displayOrder?: number;
  /** defaults to "required" */
  relationshipKind?: string;
}

/** A quoting-side product (SELL). */
export interface ProductInput {
  /** stable client id; reused as the wire client_id */
  clientId: string;
  /** existing row id → UPSERT target (merge / edit) */
  id?: string;
  name: string;
  kind: ProductKind;
  description?: string;
  /** flat price; mirrored to both base_price and default_price */
  basePrice?: number;
  unitCost?: number;
  sku?: string;
  pricingUnit?: string;
  categoryId?: string;
  unitId?: string;
  isTaxable?: boolean;
  isActive?: boolean;
  showInStorefront?: boolean;
  minimumCharge?: number;
  minimumQuantity?: number;
  linkedCatalogItemId?: string;
  bundlePricingMode?: string;
  externalSource?: string;
  externalId?: string;
  /** present → expands to option + values + add_flat modifiers */
  tier?: TierInput;
  recipes?: RecipeInput[];
  bundleItems?: BundleItemInput[];
}

/** A stock SKU under the single family (STOCK). */
export interface VariantInput {
  clientId: string;
  id?: string;
  sku?: string;
  quantity?: number;
  priceOverride?: number;
  unitCost?: number;
  /** single reorder point; fans into the warning threshold */
  reorderPoint?: number;
  warningThreshold?: number;
  criticalThreshold?: number;
  unitId?: string;
  optionValueClientIds?: string[];
  externalSource?: string;
  externalId?: string;
}

/** The SINGLE stock family (STOCK). */
export interface FamilyInput {
  id?: string;
  /**
   * Stable client id of the source card (NOT serialized to the wire payload).
   * The commit route uses it as the family's idempotency-key slot so the key
   * follows card identity, not array position — reordering/removing families
   * can't collide one family's key against another's prior payload.
   */
  clientId?: string;
  name: string;
  categoryId?: string;
  defaultUnitId?: string;
  notes?: string;
  externalSource?: string;
  externalId?: string;
  variants?: VariantInput[];
}

export interface BuilderInput {
  /** defaults to "create" */
  mode?: SetupMode;
  products?: ProductInput[];
  /** at most ONE family per call (single-family-per-call RPC shape) */
  family?: FamilyInput;
  /** edit-mode tombstones, passed through verbatim */
  deletedIds?: Record<string, string[]>;
}

// ── helpers ─────────────────────────────────────────────────────────────────

const KIND_TO_TYPE: Record<ProductKind, ProductDoc["type"]> = {
  service: "LABOR",
  material: "MATERIAL",
  package: "OTHER",
};

class PayloadBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadBuildError";
  }
}

/** Deterministic minted id for a nested child (option/value/modifier). */
function mintClientId(parentClientId: string, kind: string, ordinal: number): string {
  return `${parentClientId}:${kind}:${ordinal}`;
}

function isNonEmptyObject(o: Record<string, unknown> | undefined): boolean {
  return !!o && Object.keys(o).length > 0;
}

/**
 * Expand a tier ladder into a single `select` option + value docs + `add_flat`
 * modifier docs, plus the resolved base price. NEVER produces `tiered_pricing`.
 */
function expandTier(
  productClientId: string,
  tier: TierInput
): {
  basePrice: number;
  option: ProductOptionDoc;
  modifiers: PricingModifierDoc[];
} {
  if (!tier.steps || tier.steps.length < 2) {
    throw new PayloadBuildError(
      `Tier "${tier.optionName ?? "Size"}" must have at least two steps to be a tier.`
    );
  }

  const base =
    tier.basePrice ?? Math.min(...tier.steps.map((s) => s.price));

  const optionClientId = mintClientId(productClientId, "opt", 0);

  const values: OptionValueDoc[] = tier.steps.map((step, i) => ({
    client_id: mintClientId(productClientId, "ov", i),
    label: step.label,
    sort_order: step.sortOrder ?? i,
  }));

  const option: ProductOptionDoc = {
    client_id: optionClientId,
    name: tier.optionName ?? "Size",
    kind: "select",
    affects_price: true,
    affects_recipe: false,
    required: true,
    sort_order: 0,
    values,
  };

  const modifiers: PricingModifierDoc[] = [];
  tier.steps.forEach((step, i) => {
    const delta = step.price - base;
    // base step → zero delta → omit (matches the RPC's "base = lowest tier")
    if (delta === 0) return;
    modifiers.push({
      client_id: mintClientId(productClientId, "mod", i),
      option_client_id: optionClientId,
      option_value_client_id: values[i].client_id,
      modifier_kind: "add_flat",
      amount: delta,
    });
  });

  return { basePrice: base, option, modifiers };
}

function mapRecipe(
  productClientId: string,
  recipe: RecipeInput,
  ordinal: number
): ProductMaterialDoc {
  const hasConcreteVariant =
    typeof recipe.catalogVariantId === "string" &&
    recipe.catalogVariantId.length > 0;
  const hasResolvableSelector = isNonEmptyObject(recipe.variantSelector);

  if (!hasConcreteVariant && !hasResolvableSelector) {
    throw new PayloadBuildError(
      "Recipe must pin a concrete variant (catalog_variant_id) or a non-empty variant_selector; " +
        "a nil-selector family pin is silently dropped from the cut list and is never emitted."
    );
  }

  const doc: ProductMaterialDoc = {
    client_id: mintClientId(productClientId, "mat", ordinal),
    quantity_per_unit: recipe.quantityPerUnit ?? 1,
  };
  if (recipe.notes != null) doc.notes = recipe.notes;
  if (hasConcreteVariant) doc.catalog_variant_id = recipe.catalogVariantId;
  if (recipe.catalogItemId != null) doc.catalog_item_id = recipe.catalogItemId;
  if (hasResolvableSelector) doc.variant_selector = recipe.variantSelector;
  if (recipe.scaledByOptionClientId != null)
    doc.scaled_by_option_client_id = recipe.scaledByOptionClientId;
  if (recipe.unitId != null) doc.unit_id = recipe.unitId;
  return doc;
}

function mapBundleItem(
  productClientId: string,
  item: BundleItemInput,
  ordinal: number
): BundleItemDoc {
  if (item.childProductClientId == null && item.childProductId == null) {
    throw new PayloadBuildError(
      "Bundle item must reference a child via childProductClientId (sibling) or childProductId (existing row)."
    );
  }
  const doc: BundleItemDoc = {
    client_id: mintClientId(productClientId, "bundle", ordinal),
    quantity: item.quantity,
    display_order: item.displayOrder ?? ordinal,
    relationship_kind: item.relationshipKind ?? "required",
  };
  if (item.childProductClientId != null)
    doc.child_product_client_id = item.childProductClientId;
  if (item.childProductId != null) doc.child_product_id = item.childProductId;
  return doc;
}

function mapProduct(input: ProductInput): ProductDoc {
  const doc: ProductDoc = {
    client_id: input.clientId,
    name: input.name,
    kind: input.kind,
    type: KIND_TO_TYPE[input.kind],
  };
  if (input.id != null) doc.id = input.id;
  if (input.description != null) doc.description = input.description;
  if (input.sku != null) doc.sku = input.sku;
  if (input.unitCost != null) doc.unit_cost = input.unitCost;
  if (input.pricingUnit != null) doc.pricing_unit = input.pricingUnit;
  if (input.categoryId != null) doc.category_id = input.categoryId;
  if (input.unitId != null) doc.unit_id = input.unitId;
  if (input.isTaxable != null) doc.is_taxable = input.isTaxable;
  if (input.isActive != null) doc.is_active = input.isActive;
  if (input.showInStorefront != null)
    doc.show_in_storefront = input.showInStorefront;
  if (input.minimumCharge != null) doc.minimum_charge = input.minimumCharge;
  if (input.minimumQuantity != null)
    doc.minimum_quantity = input.minimumQuantity;
  if (input.linkedCatalogItemId != null)
    doc.linked_catalog_item_id = input.linkedCatalogItemId;
  if (input.bundlePricingMode != null)
    doc.bundle_pricing_mode = input.bundlePricingMode;
  if (input.externalSource != null) doc.external_source = input.externalSource;
  if (input.externalId != null) doc.external_id = input.externalId;

  // Tier expansion sets base_price; otherwise basePrice flows straight through.
  let resolvedBase = input.basePrice;
  if (input.tier) {
    const { basePrice, option, modifiers } = expandTier(
      input.clientId,
      input.tier
    );
    resolvedBase = basePrice;
    doc.options = [option];
    if (modifiers.length > 0) doc.pricing_modifiers = modifiers;
  }
  if (resolvedBase != null) {
    doc.base_price = resolvedBase;
    doc.default_price = resolvedBase; // builder mirrors base→default
  }

  if (input.recipes && input.recipes.length > 0) {
    doc.product_materials = input.recipes.map((r, i) =>
      mapRecipe(input.clientId, r, i)
    );
  }
  if (input.bundleItems && input.bundleItems.length > 0) {
    doc.bundle_items = input.bundleItems.map((b, i) =>
      mapBundleItem(input.clientId, b, i)
    );
  }

  return doc;
}

function mapVariant(input: VariantInput): VariantDoc {
  const doc: VariantDoc = { client_id: input.clientId };
  if (input.id != null) doc.id = input.id;
  if (input.sku != null) doc.sku = input.sku;
  if (input.quantity != null) doc.quantity = input.quantity;
  if (input.priceOverride != null) doc.price_override = input.priceOverride;
  if (input.unitCost != null) doc.unit_cost_override = input.unitCost;
  // single reorder point fans into the warning threshold; an explicit
  // warningThreshold wins if both are present.
  const warning = input.warningThreshold ?? input.reorderPoint;
  if (warning != null) doc.warning_threshold = warning;
  if (input.criticalThreshold != null)
    doc.critical_threshold = input.criticalThreshold;
  if (input.unitId != null) doc.unit_id = input.unitId;
  if (input.optionValueClientIds != null)
    doc.option_value_client_ids = input.optionValueClientIds;
  if (input.externalSource != null) doc.external_source = input.externalSource;
  if (input.externalId != null) doc.external_id = input.externalId;
  return doc;
}

// ── entry point ──────────────────────────────────────────────────────────────

/**
 * Build the exact `catalog_setup_save` payload from a vocab-/dedupe-resolved
 * `BuilderInput`. Pure: no I/O. Throws `PayloadBuildError` on a structural
 * violation (sub-two-step tier, nil-selector recipe pin, childless bundle item,
 * or more than one family).
 */
export function buildCatalogSetupPayload(
  input: BuilderInput
): CatalogSetupPayload {
  if (Array.isArray(input.family)) {
    throw new PayloadBuildError(
      "catalog_setup_save writes a single family per call — pass one FamilyInput, not an array. " +
        "Loop families at the route, one RPC call each."
    );
  }

  const payload: CatalogSetupPayload = {
    mode: input.mode ?? "create",
  };

  if (input.products && input.products.length > 0) {
    payload.products = input.products.map(mapProduct);
  }

  if (input.family) {
    const family: FamilyDoc = { name: input.family.name };
    if (input.family.id != null) family.id = input.family.id;
    if (input.family.categoryId != null)
      family.category_id = input.family.categoryId;
    if (input.family.defaultUnitId != null)
      family.default_unit_id = input.family.defaultUnitId;
    if (input.family.notes != null) family.notes = input.family.notes;
    if (input.family.externalSource != null)
      family.external_source = input.family.externalSource;
    if (input.family.externalId != null)
      family.external_id = input.family.externalId;
    payload.family = family;

    if (input.family.variants && input.family.variants.length > 0) {
      payload.variants = input.family.variants.map(mapVariant);
    }
  }

  if (input.deletedIds && Object.keys(input.deletedIds).length > 0) {
    payload.deleted_ids = input.deletedIds;
  }

  return payload;
}

export { PayloadBuildError };
