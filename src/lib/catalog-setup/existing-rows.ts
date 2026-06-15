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

/** The product columns the dedupe needs (the hook selects exactly these). */
export interface ExistingProductRow {
  id: string;
  sku: string | null;
  name: string;
  base_price: number;
  unit_cost: number | null;
  is_taxable: boolean | null;
  kind: string;
  external_source: string | null;
  external_id: string | null;
}

export interface ExistingCatalog {
  /** Matcher input — one row per live product. */
  liveRows: LiveCatalogRow[];
  /** Canvas show-diff input — on-file SellFields keyed by product id. */
  existingRows: Record<string, SellFields>;
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
  const existingRows: Record<string, SellFields> = {};

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
      defaultPrice: row.base_price,
      unitCost: row.unit_cost,
      sku: row.sku ?? undefined,
      isTaxable: row.is_taxable ?? true,
      kind: normalizeKind(row.kind),
      // `type` is irrelevant to the show-diff (price/cost only) but required by
      // SellFields — a stable, honest default.
      type: "OTHER",
    };
  }

  return { liveRows, existingRows };
}
