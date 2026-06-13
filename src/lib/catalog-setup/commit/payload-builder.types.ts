// WIRE CONTRACT for `catalog_setup_save(p_company_id, p_idempotency_key, p_payload jsonb)`.
//
// These types mirror the verified live RPC body + prod schema EXACTLY (plan
// Phase 3, "Verified contract"). They are the OUTPUT of `buildCatalogSetupPayload`
// — the snake_case doc shape the RPC consumes. The builder's INPUT is a clean
// camelCase `BuilderInput` (see payload-builder.ts), deliberately distinct from
// this wire shape so the call sites never hand-assemble RPC docs.
//
// SELF-CONTAINED on purpose (like staging-card.ts / trade-list.ts): imports
// nothing from the overhaul-branch `catalog.ts`. Align to the real `catalog.ts`
// after the rebase.
//
// HARD RULE: a `ProductDoc` NEVER carries `tiered_pricing`. Tiered/optioned
// pricing is expressed ONLY as a `select` option + values + `add_flat`
// modifiers (spec §4; iOS `GuidedCatalogSetupModel.TierSpec`). The builder
// types intentionally omit any `tiered_pricing` field so it cannot be emitted.

export type SetupMode = "create" | "edit";

/** A single option value (the rung of a tier ladder, or a pickable choice). */
export interface OptionValueDoc {
  client_id: string;
  id?: string;
  label: string;
  sort_order?: number;
}

/** A `select` product option (e.g. "Size") with its values. */
export interface ProductOptionDoc {
  client_id: string;
  id?: string;
  name: string;
  kind: "select";
  affects_price?: boolean;
  affects_recipe?: boolean;
  required?: boolean;
  sort_order?: number;
  values: OptionValueDoc[];
}

/**
 * Price delta for one option value. ALWAYS `add_flat` — tiers are add_flat
 * only, NEVER `tiered_pricing` (spec §4).
 */
export interface PricingModifierDoc {
  client_id: string;
  /** refs an option in the SAME product */
  option_client_id: string;
  /** refs a value of that option */
  option_value_client_id: string;
  modifier_kind: "add_flat";
  amount: number;
}

/**
 * A recipe line: how much stock one unit of the product draws down. Must pin a
 * concrete `catalog_variant_id` OR a non-empty `variant_selector` — a
 * nil-selector family pin is silently dropped from the cut list (spec §4), so
 * the builder refuses to emit one.
 */
export interface ProductMaterialDoc {
  client_id: string;
  quantity_per_unit: number;
  notes?: string | null;
  catalog_variant_id?: string | null;
  variant_selector?: Record<string, unknown> | null;
  catalog_item_id?: string | null;
  scaled_by_option_client_id?: string | null;
  unit_id?: string | null;
}

/** A child line of a bundle/package product. */
export interface BundleItemDoc {
  client_id: string;
  child_product_client_id?: string;
  child_product_id?: string;
  quantity: number;
  display_order?: number;
  /** default `'required'` */
  relationship_kind?: string;
}

/** A quoting-side product row (UPSERT `on conflict (id)`). */
export interface ProductDoc {
  client_id: string;
  id?: string;
  name: string;
  description?: string | null;
  default_price?: number;
  base_price?: number;
  sku?: string | null;
  unit?: string;
  pricing_unit?: string;
  unit_cost?: number | null;
  category_id?: string | null;
  unit_id?: string | null;
  is_taxable?: boolean;
  is_active?: boolean;
  type?: "LABOR" | "MATERIAL" | "OTHER";
  kind?: "service" | "material" | "package";
  minimum_charge?: number | null;
  minimum_quantity?: number | null;
  linked_catalog_item_id?: string | null;
  bundle_pricing_mode?: string | null;
  external_source?: string | null;
  external_id?: string | null;
  options?: ProductOptionDoc[];
  pricing_modifiers?: PricingModifierDoc[];
  product_materials?: ProductMaterialDoc[];
  bundle_items?: BundleItemDoc[];
}

/** A stock SKU under the single family (spec §9 STOCK). */
export interface VariantDoc {
  client_id: string;
  id?: string;
  sku?: string | null;
  quantity?: number;
  price_override?: number | null;
  unit_cost_override?: number | null;
  warning_threshold?: number | null;
  critical_threshold?: number | null;
  unit_id?: string | null;
  option_value_client_ids?: string[];
  external_source?: string | null;
  external_id?: string | null;
}

/**
 * The SINGLE stock family (`catalog_items`). `catalog_setup_save` writes ONE
 * family per call — `family` is a single object, NOT an array (verified
 * contract). The route loops families; the builder accepts at most one.
 */
export interface FamilyDoc {
  id?: string;
  name: string;
  category_id?: string | null;
  default_unit_id?: string | null;
  notes?: string | null;
  external_source?: string | null;
  external_id?: string | null;
}

/** Top-level `p_payload` for `catalog_setup_save`. */
export interface CatalogSetupPayload {
  mode: SetupMode;
  family?: FamilyDoc;
  catalog_options?: unknown[];
  variants?: VariantDoc[];
  products?: ProductDoc[];
  /** top-level recipe array (mirrors the per-product nesting) */
  product_materials?: ProductMaterialDoc[];
  deleted_ids?: Record<string, string[]>;
}
