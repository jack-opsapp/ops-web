// Products CSV mapper — a faithful port of ProductsCSVMapper.map
// (ProductsCSVMapper.swift:119).
//
// One row = one product (NO family grouping — products are flat). name +
// base_price required. Typed `category`/`unit` text resolves to an FK id via a
// case-insensitive company-vocab match; an unmatched value is a HARD error
// (same as iOS QuickAddProductSheet). kind ∈ service|good (mapped to the OPS
// products.kind enum), type ∈ LABOR|MATERIAL|OTHER, is_taxable truthy/falsy,
// permissive numbers.
//
// Output is the real canvas `StagingCard[]` (module:"sell") + a parallel
// `resolutions[]` carrying the resolved FK ids + source line (see mapper-types).
// PAYLOAD-OR-NIL CONTRACT: cards is non-empty ONLY when errors is empty (mirrors
// Swift returning `payload: errors.isEmpty ? ... : nil`).
//
// Reconciliation notes vs iOS (documented divergences, logic unchanged):
//  - The canvas `SellFields.kind` enum is service|material|package, but the CSV
//    column (per iOS) is service|good. We map "good" → "material" (closest), and
//    also accept "material"/"package" typed directly. Anything else errors.
//  - `SellFields.isTaxable` is a non-null boolean (the canvas has no "server
//    default" tri-state). Default false; set true/false from a recognized
//    truthy/falsy cell; an unrecognized value errors.
//  - `SellFields.type` defaults to "OTHER" when unmapped/blank (the canvas
//    requires a value); an explicit unrecognized value errors.

import type { SellFields, StagingCard } from "./staging-card";
import { parseNumber } from "./parse-number";
import type { ProductsColumnMapping } from "./column-mapping";
import {
  buildLowerKeyMap,
  DEFAULT_IMPORT_SOURCE,
  mapError,
  type CardResolution,
  type CategoryVocab,
  type MapError,
  type UnitVocab,
} from "./mapper-types";

export interface MapProductsArgs {
  rows: Record<string, string>[];
  lineNumbers: number[];
  mapping: ProductsColumnMapping;
  categories: CategoryVocab[];
  units: UnitVocab[];
  /** Override the card source stamp (defaults to "import"). */
  source?: StagingCard["source"];
}

export interface MapProductsResult {
  /** Non-empty ONLY when `errors` is empty (payload-or-nil contract). */
  cards: StagingCard[];
  /** FK + provenance metadata, parallel to `cards` (joined by cardId). */
  resolutions: CardResolution[];
  errors: MapError[];
}

/** Trim a mapped optional cell to a non-empty string, or null. */
function optionalCell(
  row: Record<string, string>,
  col: string | undefined,
): string | null {
  if (!col) return null;
  const v = row[col]?.trim() ?? "";
  return v === "" ? null : v;
}

function resolveKind(raw: string): SellFields["kind"] | null {
  switch (raw.toLowerCase()) {
    case "service":
      return "service";
    // iOS CSV column emits "good"; the OPS products.kind enum is material.
    case "good":
    case "material":
      return "material";
    case "package":
      return "package";
    default:
      return null;
  }
}

function resolveType(raw: string): SellFields["type"] | null {
  switch (raw.toUpperCase()) {
    case "LABOR":
      return "LABOR";
    case "MATERIAL":
      return "MATERIAL";
    case "OTHER":
      return "OTHER";
    default:
      return null;
  }
}

function resolveTaxable(raw: string): boolean | null {
  switch (raw.toLowerCase()) {
    case "true":
    case "yes":
    case "y":
    case "1":
    case "t":
      return true;
    case "false":
    case "no":
    case "n":
    case "0":
    case "f":
      return false;
    default:
      return null;
  }
}

export function mapProductsCsv(args: MapProductsArgs): MapProductsResult {
  const { rows, lineNumbers, mapping, categories, units } = args;
  const source = args.source ?? DEFAULT_IMPORT_SOURCE;

  if (!mapping.name) {
    return {
      cards: [],
      resolutions: [],
      errors: [mapError(-1, "name", "No column mapped to Name.")],
    };
  }
  if (!mapping.basePrice) {
    return {
      cards: [],
      resolutions: [],
      errors: [mapError(-1, "base_price", "No column mapped to Base Price.")],
    };
  }
  const nameCol = mapping.name;
  const basePriceCol = mapping.basePrice;

  const categoryByName = buildLowerKeyMap(categories, (c) => c.name);
  const unitByDisplay = buildLowerKeyMap(units, (u) => u.display);

  const cards: StagingCard[] = [];
  const resolutions: CardResolution[] = [];
  const errors: MapError[] = [];

  rows.forEach((row, i) => {
    const line = i < lineNumbers.length ? lineNumbers[i] : i + 2;

    const name = row[nameCol]?.trim() ?? "";
    if (name === "") {
      errors.push(mapError(i, "name", `Line ${line}: name is blank.`));
      return;
    }

    // base_price required.
    const rawBasePrice = row[basePriceCol] ?? "";
    const parsedBasePrice = parseNumber(rawBasePrice);
    if (parsedBasePrice.error === "negative") {
      errors.push(
        mapError(i, "base_price", `Line ${line}: base_price cannot be negative.`),
      );
      return;
    }
    if (parsedBasePrice.error === "not_a_number") {
      errors.push(
        mapError(
          i,
          "base_price",
          `Line ${line}: base_price is not a valid number ('${rawBasePrice.trim()}').`,
        ),
      );
      return;
    }
    if (parsedBasePrice.value === null) {
      // Blank required value — parseNumber stays silent on blanks, so surface
      // the "required" error here (mirrors the Swift guard).
      errors.push(
        mapError(i, "base_price", `Line ${line}: base_price is required.`),
      );
      return;
    }
    const basePrice = parsedBasePrice.value;

    // unit_cost (optional).
    let unitCost: number | null = null;
    const rawUnitCost = optionalCell(row, mapping.unitCost);
    if (rawUnitCost !== null) {
      const parsed = parseNumber(rawUnitCost);
      if (parsed.error) {
        errors.push(
          mapError(
            i,
            "unit_cost",
            parsed.error === "negative"
              ? `Line ${line}: unit_cost cannot be negative.`
              : `Line ${line}: unit_cost is not a valid number ('${rawUnitCost}').`,
          ),
        );
      } else {
        unitCost = parsed.value;
      }
    }

    const description = optionalCell(row, mapping.description) ?? undefined;
    const sku = optionalCell(row, mapping.sku) ?? undefined;
    const pricingUnit = optionalCell(row, mapping.pricingUnit) ?? undefined;

    // Category resolution — typed text → FK id; unmatched = hard error.
    let categoryId: string | null = null;
    const rawCat = optionalCell(row, mapping.category);
    if (rawCat !== null) {
      const id = categoryByName.get(rawCat.toLowerCase());
      if (id) {
        categoryId = id;
      } else {
        errors.push(
          mapError(
            i,
            "category",
            `Line ${line}: category '${rawCat}' not found in your catalog. Create it first or remove the value.`,
          ),
        );
      }
    }

    // Unit resolution — typed text → FK id; unmatched = hard error.
    let unitId: string | null = null;
    const rawUnit = optionalCell(row, mapping.unit);
    if (rawUnit !== null) {
      const id = unitByDisplay.get(rawUnit.toLowerCase());
      if (id) {
        unitId = id;
      } else {
        errors.push(
          mapError(
            i,
            "unit",
            `Line ${line}: unit '${rawUnit}' not found in your catalog. Create it first or remove the value.`,
          ),
        );
      }
    }

    // kind enum.
    let kind: SellFields["kind"] = "service";
    const rawKind = optionalCell(row, mapping.kind);
    if (rawKind !== null) {
      const resolved = resolveKind(rawKind);
      if (resolved) {
        kind = resolved;
      } else {
        errors.push(
          mapError(
            i,
            "kind",
            `Line ${line}: kind '${rawKind}' must be 'service' or 'good'.`,
          ),
        );
      }
    }

    // type enum (defaults to OTHER when unmapped/blank).
    let type: SellFields["type"] = "OTHER";
    const rawType = optionalCell(row, mapping.type);
    if (rawType !== null) {
      const resolved = resolveType(rawType);
      if (resolved) {
        type = resolved;
      } else {
        errors.push(
          mapError(
            i,
            "type",
            `Line ${line}: type '${rawType}' must be 'LABOR', 'MATERIAL', or 'OTHER'.`,
          ),
        );
      }
    }

    // is_taxable — truthy/falsy text; default false.
    let isTaxable = false;
    const rawTaxable = optionalCell(row, mapping.isTaxable);
    if (rawTaxable !== null) {
      const resolved = resolveTaxable(rawTaxable);
      if (resolved === null) {
        errors.push(
          mapError(
            i,
            "is_taxable",
            `Line ${line}: is_taxable '${rawTaxable}' must be true/false (or yes/no).`,
          ),
        );
      } else {
        isTaxable = resolved;
      }
    }

    const id = crypto.randomUUID();
    const fields: SellFields = {
      name,
      description,
      defaultPrice: basePrice,
      unitCost,
      sku,
      isTaxable,
      kind,
      type,
      pricingUnit,
    };
    cards.push({ id, source, state: "proposed", module: "sell", fields });
    resolutions.push({ cardId: id, sourceLine: line, categoryId, unitId });
  });

  if (rows.length === 0) {
    errors.push(mapError(-1, "rows", "Spreadsheet has no data rows."));
  }

  // Payload-or-nil: cards only when error-free.
  if (errors.length > 0) {
    return { cards: [], resolutions: [], errors };
  }
  return { cards, resolutions, errors };
}
