// Header alias auto-map — a faithful port of `ProductsImportColumnMapping.suggest`
// (ProductsCSVMapper.swift:47) and `CatalogImportColumnMapping.suggest`
// (CatalogCSVMapper.swift:50).
//
// A mapping records, for each LOGICAL column, the spreadsheet header the user's
// file uses (or undefined = not mapped). `suggest*` infers a starting mapping
// from header names; the UI lets the owner override every field before staging.
//
// Match algorithm (identical to Swift `find`):
//   1. exact-alias hit — first alias (in declared order) whose normalized form
//      equals a normalized header → that header
//   2. substring fallback — first alias (in declared order) whose normalized
//      form is contained in a normalized header (headers scanned in order)
//
// `normalize` mirrors Swift: lowercase, trim, `_`/`-` → space.

/** Lowercase, trim, and replace `_`/`-` with spaces (Swift `normalize`). */
export function normalizeHeader(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/_/g, " ")
    .replace(/-/g, " ");
}

/**
 * Resolve the best header for a logical column from its alias list.
 * Exact-alias hits win over substring hits; within each pass, earlier aliases
 * win. Returns the ORIGINAL header string (not normalized) so it can index the
 * parsed row, or undefined when nothing matches.
 */
function findHeader(headers: string[], aliases: string[]): string | undefined {
  // Pass 1: exact alias.
  const byNormalized = new Map<string, string>();
  for (const h of headers) {
    const key = normalizeHeader(h);
    // First header wins for a given normalized key (Swift builds the lookup
    // dict in header order; later dupes are ignored).
    if (!byNormalized.has(key)) byNormalized.set(key, h);
  }
  for (const alias of aliases) {
    const hit = byNormalized.get(normalizeHeader(alias));
    if (hit !== undefined) return hit;
  }
  // Pass 2: substring fallback.
  for (const alias of aliases) {
    const needle = normalizeHeader(alias);
    for (const header of headers) {
      if (normalizeHeader(header).includes(needle)) return header;
    }
  }
  return undefined;
}

// ── Products (flat) ─────────────────────────────────────────────────────────

/** Which header maps to each logical PRODUCTS column (undefined = unmapped). */
export interface ProductsColumnMapping {
  // Required
  name?: string;
  basePrice?: string;
  // Optional
  description?: string;
  unitCost?: string;
  category?: string;
  unit?: string;
  pricingUnit?: string;
  sku?: string;
  kind?: string;
  type?: string;
  isTaxable?: string;
  /** name + basePrice both mapped (Swift `isReadyToMap`). */
  isReadyToMap: boolean;
}

/** Alias lists copied verbatim from ProductsCSVMapper.swift `suggest`. */
const PRODUCTS_ALIASES = {
  name: ["name", "product", "product name", "item", "title"],
  basePrice: ["base price", "price", "unit price", "list price", "rate"],
  description: ["description", "desc", "notes"],
  unitCost: ["cost", "unit cost", "wholesale", "our cost"],
  category: ["category", "cat", "group"],
  unit: ["unit", "uom", "unit of measure"],
  pricingUnit: ["pricing unit", "billing unit"],
  sku: ["sku", "part", "part number", "code", "item code"],
  kind: ["kind", "service or good", "type kind"],
  type: ["line item type", "labor or material", "labor material"],
  isTaxable: ["taxable", "is taxable", "tax"],
} as const;

export function suggestProductsMapping(
  headers: string[],
): ProductsColumnMapping {
  const name = findHeader(headers, [...PRODUCTS_ALIASES.name]);
  const basePrice = findHeader(headers, [...PRODUCTS_ALIASES.basePrice]);
  return {
    name,
    basePrice,
    description: findHeader(headers, [...PRODUCTS_ALIASES.description]),
    unitCost: findHeader(headers, [...PRODUCTS_ALIASES.unitCost]),
    category: findHeader(headers, [...PRODUCTS_ALIASES.category]),
    unit: findHeader(headers, [...PRODUCTS_ALIASES.unit]),
    pricingUnit: findHeader(headers, [...PRODUCTS_ALIASES.pricingUnit]),
    sku: findHeader(headers, [...PRODUCTS_ALIASES.sku]),
    kind: findHeader(headers, [...PRODUCTS_ALIASES.kind]),
    type: findHeader(headers, [...PRODUCTS_ALIASES.type]),
    isTaxable: findHeader(headers, [...PRODUCTS_ALIASES.isTaxable]),
    isReadyToMap: name !== undefined && basePrice !== undefined,
  };
}

// ── Stock (family-grouped) ──────────────────────────────────────────────────

/** Which header maps to each logical STOCK column (undefined = unmapped). */
export interface StockColumnMapping {
  // Required
  familyName?: string;
  quantity?: string;
  // Optional family-level
  familyDescription?: string;
  category?: string;
  defaultUnit?: string;
  defaultPrice?: string;
  defaultUnitCost?: string;
  // Optional variant-level
  sku?: string;
  variantUnit?: string;
  priceOverride?: string;
  unitCostOverride?: string;
  warningThreshold?: string;
  criticalThreshold?: string;
  /** familyName + quantity both mapped (Swift `isReadyToMap`). */
  isReadyToMap: boolean;
}

/** Alias lists copied verbatim from CatalogCSVMapper.swift `suggest`. */
const STOCK_ALIASES = {
  familyName: ["family", "family_name", "product family", "name", "item"],
  quantity: ["quantity", "qty", "stock", "on hand", "count"],
  familyDescription: ["description", "desc", "notes"],
  category: ["category", "cat", "type"],
  defaultUnit: ["unit", "uom", "unit of measure"],
  defaultPrice: ["price", "default price", "unit price", "list price"],
  defaultUnitCost: ["cost", "unit cost", "default cost", "wholesale"],
  sku: ["sku", "part", "part number", "code", "item code"],
  variantUnit: ["variant unit", "v unit"],
  priceOverride: ["price override", "variant price"],
  unitCostOverride: ["cost override", "variant cost"],
  warningThreshold: ["warning threshold", "warning", "low warn"],
  criticalThreshold: ["critical threshold", "critical", "low critical", "min"],
} as const;

export function suggestStockMapping(headers: string[]): StockColumnMapping {
  const familyName = findHeader(headers, [...STOCK_ALIASES.familyName]);
  const quantity = findHeader(headers, [...STOCK_ALIASES.quantity]);
  return {
    familyName,
    quantity,
    familyDescription: findHeader(headers, [
      ...STOCK_ALIASES.familyDescription,
    ]),
    category: findHeader(headers, [...STOCK_ALIASES.category]),
    defaultUnit: findHeader(headers, [...STOCK_ALIASES.defaultUnit]),
    defaultPrice: findHeader(headers, [...STOCK_ALIASES.defaultPrice]),
    defaultUnitCost: findHeader(headers, [...STOCK_ALIASES.defaultUnitCost]),
    sku: findHeader(headers, [...STOCK_ALIASES.sku]),
    variantUnit: findHeader(headers, [...STOCK_ALIASES.variantUnit]),
    priceOverride: findHeader(headers, [...STOCK_ALIASES.priceOverride]),
    unitCostOverride: findHeader(headers, [...STOCK_ALIASES.unitCostOverride]),
    warningThreshold: findHeader(headers, [...STOCK_ALIASES.warningThreshold]),
    criticalThreshold: findHeader(headers, [
      ...STOCK_ALIASES.criticalThreshold,
    ]),
    isReadyToMap: familyName !== undefined && quantity !== undefined,
  };
}
