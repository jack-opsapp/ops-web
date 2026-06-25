// Existing-catalog derivation for the file-upload dedupe (spec §11).
//
// The wizard route reads the live PRODUCT rows (service-role-free, the operator's
// own RLS scope) and hands them to two consumers:
//   • the show-diff matcher  → `LiveCatalogRow[]` (id / sku / name + comparable cols)
//   • the canvas show-diff UI → `Record<id, SellFields>` (the on-file values the
//     duplicate card strikes through)
//
// This module is the PURE shape-bridge between the raw DB row and those two
// shapes — no IO, unit-tested. The hook (`use-catalog-setup-existing-rows`) owns
// the fetch and feeds these rows in.

import type { LiveCatalogRow } from "./commit/dedupe-matcher.types";
import type { SellFields } from "./staging-card";

/**
 * The product columns the dedupe matcher + show-diff canvas + the merge-preserve
 * commit need (the hook selects exactly these). The non-diffed committable
 * columns (description / category_id / is_active / show_in_storefront /
 * pricing_unit) are read so a merge can WRITE THEM BACK UNCHANGED — the commit
 * RPC UPSERTs every column from the doc, so a re-import that omits them would
 * wipe descriptions, un-categorize, reset storefront visibility, and reactivate
 * a retired product. "The rest stays on file" is only true if the on-file values
 * are carried through.
 */
export interface ExistingProductRow {
  id: string;
  sku: string | null;
  name: string;
  base_price: number;
  unit_cost: number | null;
  is_taxable: boolean | null;
  kind: string;
  description: string | null;
  category_id: string | null;
  is_active: boolean | null;
  show_in_storefront: boolean | null;
  pricing_unit: string | null;
  external_source: string | null;
  external_id: string | null;
}

/**
 * On-file product values keyed by product id — the show-diff canvas reads the
 * diffed subset (name/price/cost/taxable) and the commit reads the FULL set to
 * preserve every non-accepted column on a merge (camelCase, builder-ready).
 */
export interface OnFileProduct {
  name: string;
  description?: string;
  defaultPrice: number | null;
  unitCost: number | null;
  sku?: string;
  isTaxable: boolean;
  kind: SellFields["kind"];
  pricingUnit?: string;
  categoryId?: string;
  isActive: boolean;
  showInStorefront?: boolean;
}

export interface ExistingCatalog {
  /** Matcher input — one row per live product. */
  liveRows: LiveCatalogRow[];
  /** Show-diff canvas + merge-preserve commit input — on-file values by product id. */
  existingRows: Record<string, OnFileProduct>;
}

/** Map a DB `products.kind` text to the card's narrowed kind enum. */
function normalizeKind(kind: string): SellFields["kind"] {
  switch (kind.toLowerCase()) {
    case "material":
    case "good":
      return "material";
    case "package":
      return "package";
    case "service":
      return "service";
    default:
      return "service";
  }
}

export function toExistingCatalog(rows: ExistingProductRow[]): ExistingCatalog {
  const liveRows: LiveCatalogRow[] = [];
  const existingRows: Record<string, OnFileProduct> = {};

  for (const row of rows) {
    liveRows.push({
      id: row.id,
      sku: row.sku,
      name: row.name,
      base_price: row.base_price,
      unit_cost: row.unit_cost,
      external_source: row.external_source,
      external_id: row.external_id,
    });
    existingRows[row.id] = {
      name: row.name,
      description: row.description ?? undefined,
      defaultPrice: row.base_price,
      unitCost: row.unit_cost,
      sku: row.sku ?? undefined,
      isTaxable: row.is_taxable ?? true,
      kind: normalizeKind(row.kind),
      pricingUnit: row.pricing_unit ?? undefined,
      categoryId: row.category_id ?? undefined,
      // Default active true ONLY when the column is null (a legacy row); a real
      // false must survive a merge so it never silently reactivates.
      isActive: row.is_active ?? true,
      showInStorefront: row.show_in_storefront ?? undefined,
    };
  }

  return { liveRows, existingRows };
}
