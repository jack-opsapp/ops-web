// Stock CSV mapper — a faithful port of CatalogCSVMapper.map
// (CatalogCSVMapper.swift:128).
//
// family_name + quantity required. FAMILY GROUPING by case-insensitive,
// trimmed family_name: the FIRST row carrying a family_name owns the
// family-level fields (description, category, default unit, default price,
// default unit cost); later rows with the same family_name contribute
// additional variants under it. One CSV row = one variant. category /
// defaultUnit / variantUnit text resolve to FK ids via a case-insensitive
// company-vocab match; an unmatched value is a HARD error. Permissive numbers
// (blank quantity → 0, mirroring Swift `?? 0`).
//
// RECONCILIATION vs iOS (logic unchanged — only the output binding moves):
// the canvas `StockFields` (staging-card.ts) is FLAT — it has NO nested
// `variants[]` and no `categoryId`/`defaultUnitId`. So the mapper emits ONE
// stock `StagingCard` per variant row (`fields.name` = family name) and
// preserves the grouping with a `families[]` sidecar (family key → ordered
// card ids + family-level FK resolution). The variant-level FK ids that don't
// fit on `StockFields` (price_override, critical_threshold, the resolved
// unit id) ride in a parallel `resolutions[]`, joined by `cardId`. Phase 1's
// commit layer (commit/payload-builder.ts) loops `families` → one
// `catalog_setup_save` call each, building each `VariantDoc` from a card +
// its resolution.
//
// FIELD MAP (Swift CatalogImportVariant → StockFields + StockResolution):
//   quantity            → fields.quantity          (blank → 0)
//   unitCostOverride    → fields.unitCost
//   warningThreshold    → fields.reorderPoint      (single reorder point;
//                                                    critical rides in the
//                                                    resolution sidecar)
//   variant/default unit→ fields.unitId + resolution.unitId
//   priceOverride       → resolution.priceOverride
//   criticalThreshold   → resolution.criticalThreshold
//
// PAYLOAD-OR-NIL CONTRACT: `cards` AND `families` are non-empty ONLY when
// `errors` is empty (mirrors Swift `payload: errors.isEmpty ? ... : nil`).

import type { StockFields, StagingCard } from "./staging-card";
import { parseNumber } from "./parse-number";
import type { StockColumnMapping } from "./column-mapping";
import {
  buildLowerKeyMap,
  DEFAULT_IMPORT_SOURCE,
  mapError,
  type CardResolution,
  type CategoryVocab,
  type MapError,
  type UnitVocab,
} from "./mapper-types";

/**
 * One stock family (`catalog_items`). Family-level FK resolution lives here
 * because the flat `StockFields` has no slot for it; `cardIds` is the ordered
 * list of the variant `StagingCard.id`s grouped under this family. The commit
 * layer turns one `StockFamily` into one `FamilyDoc` + its `VariantDoc[]`.
 */
export interface StockFamily {
  /** First-occurrence display name (preserves original casing). */
  familyName: string;
  /** 1-based physical source line of the first row that opened this family. */
  sourceLine: number;
  description: string | null;
  /** Resolved category FK id (null = none mapped/blank). */
  categoryId: string | null;
  /** Resolved family default-unit FK id (null = none mapped/blank). */
  defaultUnitId: string | null;
  defaultPrice: number | null;
  defaultUnitCost: number | null;
  /** Ordered `StagingCard.id`s of the variants under this family. */
  cardIds: string[];
}

/**
 * Per-variant FK + provenance metadata. Extends the shared `CardResolution`
 * with the variant fields the flat `StockFields` cannot carry, so the commit
 * layer can build a full `VariantDoc`. `categoryId` mirrors the owning
 * family's resolved category for convenience.
 */
export interface StockResolution extends CardResolution {
  /** Variant-level price override (null = none). */
  priceOverride: number | null;
  /** Variant-level critical threshold (null = none). */
  criticalThreshold: number | null;
}

export interface MapStockArgs {
  rows: Record<string, string>[];
  lineNumbers: number[];
  mapping: StockColumnMapping;
  categories: CategoryVocab[];
  units: UnitVocab[];
  /** Override the card source stamp (defaults to "import"). */
  source?: StagingCard["source"];
}

export interface MapStockResult {
  /** Non-empty ONLY when `errors` is empty (payload-or-nil contract). */
  cards: StagingCard[];
  /** Grouping sidecar — one per family. Empty when `errors` is non-empty. */
  families: StockFamily[];
  /** FK + provenance metadata, parallel to `cards` (joined by cardId). */
  resolutions: StockResolution[];
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

/**
 * Parse an OPTIONAL numeric cell, pushing a field error on a bad value.
 * Blank/unmapped → null with no error (mirrors Swift `parseNumber`, which
 * stays silent on blanks). Negative / non-numeric → null + error.
 */
function parseOptionalNumber(
  row: Record<string, string>,
  col: string | undefined,
  rowIndex: number,
  field: string,
  line: number,
  errors: MapError[],
): number | null {
  const raw = optionalCell(row, col);
  if (raw === null) return null;
  const parsed = parseNumber(raw);
  if (parsed.error === "negative") {
    errors.push(mapError(rowIndex, field, `Line ${line}: ${field} cannot be negative.`));
    return null;
  }
  if (parsed.error === "not_a_number") {
    errors.push(
      mapError(rowIndex, field, `Line ${line}: ${field} is not a valid number ('${raw}').`),
    );
    return null;
  }
  return parsed.value;
}

export function mapStockCsv(args: MapStockArgs): MapStockResult {
  const { rows, lineNumbers, mapping, categories, units } = args;
  const source = args.source ?? DEFAULT_IMPORT_SOURCE;

  if (!mapping.familyName) {
    return {
      cards: [],
      families: [],
      resolutions: [],
      errors: [mapError(-1, "family_name", "No column mapped to Family Name.")],
    };
  }
  if (!mapping.quantity) {
    return {
      cards: [],
      families: [],
      resolutions: [],
      errors: [mapError(-1, "quantity", "No column mapped to Quantity.")],
    };
  }
  const familyNameCol = mapping.familyName;
  const quantityCol = mapping.quantity;

  // The unit column is resolved PER VARIANT into `fields.unitId`. iOS exposes
  // separate default-unit and variant-unit columns; the flat canvas card
  // carries one unit, so a dedicated `variantUnit` mapping wins, otherwise the
  // `defaultUnit` column doubles as the per-variant unit. Unmatched-unit
  // errors are labeled `variant_unit` (it's the variant card's unit).
  const variantUnitCol = mapping.variantUnit ?? mapping.defaultUnit;
  // Same doubling for unit cost: a distinct `unitCostOverride` column wins,
  // otherwise the family `defaultUnitCost` column doubles as the per-variant
  // cost (each flat card carries its own cost, e.g. one row per SKU with its
  // own price). When the single cost column doubles as the variant cost it is
  // NOT also pinned as the family default (handled in the new-family block).
  const variantUnitCostCol = mapping.unitCostOverride ?? mapping.defaultUnitCost;
  const familyHasDistinctDefaultCost = Boolean(
    mapping.unitCostOverride && mapping.defaultUnitCost,
  );

  const categoryByName = buildLowerKeyMap(categories, (c) => c.name);
  const unitByDisplay = buildLowerKeyMap(units, (u) => u.display);

  const cards: StagingCard[] = [];
  const families: StockFamily[] = [];
  const resolutions: StockResolution[] = [];
  const errors: MapError[] = [];
  const familyIndexByKey = new Map<string, number>();

  rows.forEach((row, i) => {
    const line = i < lineNumbers.length ? lineNumbers[i] : i + 2;

    const familyName = row[familyNameCol]?.trim() ?? "";
    if (familyName === "") {
      errors.push(mapError(i, "family_name", `Line ${line}: family name is blank.`));
      return;
    }

    const key = familyName.toLowerCase();
    let familyIndex = familyIndexByKey.get(key);
    if (familyIndex === undefined) {
      familyIndex = families.length;
      familyIndexByKey.set(key, familyIndex);

      // Family-level fields — pulled from the FIRST row carrying this
      // family_name. Later rows are assumed to share these values; if they
      // differ we ignore the difference (first wins), as iOS documents.
      let categoryId: string | null = null;
      const rawCat = optionalCell(row, mapping.category);
      if (rawCat !== null) {
        const id = categoryByName.get(rawCat.toLowerCase());
        if (id) {
          categoryId = id;
        } else {
          errors.push(
            mapError(
              familyIndex,
              "category",
              `Line ${line}: category '${rawCat}' not found in your catalog. Create it first or remove the value.`,
            ),
          );
        }
      }

      let defaultUnitId: string | null = null;
      // Resolve the FAMILY default unit only when a DISTINCT default-unit
      // column is mapped (i.e. a separate variantUnit column exists). When the
      // single unit column doubles as the variant unit, it resolves per-row
      // below — avoid double-erroring on the same cell.
      if (mapping.variantUnit && mapping.defaultUnit) {
        const rawUnit = optionalCell(row, mapping.defaultUnit);
        if (rawUnit !== null) {
          const id = unitByDisplay.get(rawUnit.toLowerCase());
          if (id) {
            defaultUnitId = id;
          } else {
            errors.push(
              mapError(
                familyIndex,
                "default_unit",
                `Line ${line}: unit '${rawUnit}' not found in your catalog. Create it first or remove the value.`,
              ),
            );
          }
        }
      }

      const description = optionalCell(row, mapping.familyDescription);
      const defaultPrice = parseOptionalNumber(
        row,
        mapping.defaultPrice,
        familyIndex,
        "default_price",
        line,
        errors,
      );
      // Only pin a family default unit cost when a DISTINCT default-cost
      // column is mapped; otherwise the single cost column is the per-variant
      // cost and resolves per-row below (avoids double-counting the cell).
      const defaultUnitCost = familyHasDistinctDefaultCost
        ? parseOptionalNumber(
            row,
            mapping.defaultUnitCost,
            familyIndex,
            "default_unit_cost",
            line,
            errors,
          )
        : null;

      families.push({
        familyName,
        sourceLine: line,
        description,
        categoryId,
        defaultUnitId,
        defaultPrice,
        defaultUnitCost,
        cardIds: [],
      });
    }
    const family = families[familyIndex];

    // ── Variant fields — every CSV row contributes one. ──
    // quantity: blank/unmapped → 0 (Swift `?? 0`); bad value → 0 + error.
    const parsedQty = parseOptionalNumber(row, quantityCol, i, "quantity", line, errors);
    const quantity = parsedQty ?? 0;

    const sku = optionalCell(row, mapping.sku) ?? undefined;

    const priceOverride = parseOptionalNumber(
      row,
      mapping.priceOverride,
      i,
      "price_override",
      line,
      errors,
    );
    const unitCostOverride = parseOptionalNumber(
      row,
      variantUnitCostCol,
      i,
      "unit_cost_override",
      line,
      errors,
    );
    const warning = parseOptionalNumber(
      row,
      mapping.warningThreshold,
      i,
      "warning_threshold",
      line,
      errors,
    );
    const critical = parseOptionalNumber(
      row,
      mapping.criticalThreshold,
      i,
      "critical_threshold",
      line,
      errors,
    );

    // Variant unit resolution — typed text → FK id; unmatched = hard error.
    let unitId: string | null = null;
    const rawUnit = optionalCell(row, variantUnitCol);
    if (rawUnit !== null) {
      const id = unitByDisplay.get(rawUnit.toLowerCase());
      if (id) {
        unitId = id;
      } else {
        errors.push(
          mapError(i, "variant_unit", `Line ${line}: unit '${rawUnit}' not found in your catalog.`),
        );
      }
    }

    const id = crypto.randomUUID();
    const fields: StockFields = {
      name: familyName,
      sku,
      quantity,
      unitCost: unitCostOverride,
      reorderPoint: warning,
      unitId: unitId ?? undefined,
    };
    cards.push({ id, source, state: "proposed", module: "stock", fields });
    resolutions.push({
      cardId: id,
      sourceLine: line,
      categoryId: family.categoryId,
      unitId,
      priceOverride,
      criticalThreshold: critical,
    });
    family.cardIds.push(id);
  });

  if (rows.length === 0) {
    errors.push(mapError(-1, "rows", "Spreadsheet has no data rows."));
  }

  // Payload-or-nil: cards + families only when error-free.
  if (errors.length > 0) {
    return { cards: [], families: [], resolutions: [], errors };
  }
  return { cards, families, resolutions, errors };
}
