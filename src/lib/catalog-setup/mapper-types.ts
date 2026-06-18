// Shared types for the deterministic spreadsheet mappers
// (products-csv-mapper, stock-csv-mapper).
//
// WHY a resolution sidecar instead of FK ids on the card:
// The canvas `StagingCard` contract (staging-card.ts) is intentionally FK-free
// — `SellFields`/`StockFields` carry no `categoryId`/`unitId`, only the
// human-facing fields the owner accepts/edits. But the iOS mappers DO resolve
// typed category/unit text to FK ids (and hard-error on an unmatched value),
// and the commit RPC (`catalog_setup_save`) needs those ids. So the mapper
// emits the cards in the shared shape AND a parallel `resolutions` array
// (keyed by `cardId`) carrying the resolved FK ids + source-line provenance.
// Phase 1's commit layer joins them by `cardId`. Nothing about the card shape
// changes; the resolution metadata rides alongside.

import type { CardSource } from "./staging-card";

/**
 * A local validation error surfaced during mapping, BEFORE any network call —
 * mirrors the iOS `CatalogImportError`/`ProductsImportError` "mapping" shape so
 * the canvas renders every source's errors uniformly.
 */
export interface MapError {
  scope: "mapping";
  /** 0-based row index into the parsed rows; -1 = file-level. */
  rowIndex: number;
  /** The logical field that failed (e.g. "name", "base_price", "category"). */
  field: string;
  /** Human-facing reason (already includes the 1-based line, like iOS). */
  reason: string;
}

export function mapError(
  rowIndex: number,
  field: string,
  reason: string,
): MapError {
  return { scope: "mapping", rowIndex, field, reason };
}

/**
 * FK + provenance metadata for one staged card. `cardId` joins back to the
 * `StagingCard.id` in the parallel `cards` array.
 */
export interface CardResolution {
  /** Joins to `StagingCard.id`. */
  cardId: string;
  /** 1-based physical source line the card came from. */
  sourceLine: number;
  /** Resolved category FK id (null = none mapped/blank). */
  categoryId: string | null;
  /** Resolved unit FK id (null = none mapped/blank). */
  unitId: string | null;
}

/** A `(id, name)` vocabulary entry for category resolution. */
export interface CategoryVocab {
  id: string;
  name: string;
}

/** A `(id, display)` vocabulary entry for unit resolution. */
export interface UnitVocab {
  id: string;
  display: string;
}

/** Common source-stamp default for spreadsheet uploads. */
export const DEFAULT_IMPORT_SOURCE: CardSource = "import";

/**
 * Case-insensitive, trimmed lookup map. Mirrors Swift's
 * `Dictionary(..., uniquingKeysWith: { first, _ in first })` — first entry wins
 * on a key collision.
 */
export function buildLowerKeyMap<T extends { id: string }>(
  items: T[],
  keyOf: (item: T) => string,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const item of items) {
    const key = keyOf(item).toLowerCase().trim();
    if (!m.has(key)) m.set(key, item.id);
  }
  return m;
}
