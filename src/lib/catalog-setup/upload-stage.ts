// Upload staging orchestrator — the PURE core of the file-upload source lane
// (spec §8 sources, §11 dedupe; plan Phase 2 + Phase 6 deferred source lanes).
//
// Composes the already-built primitives end to end, with ZERO IO of its own:
//
//   parseCsv (caller)  →  routeUpload  →  products / stock CSV mapper  →  dedupe
//
// The caller (the wizard route) reads the file (`file.text()` → parseCsv) and the
// live catalog rows, then hands BOTH in. This module decides the lane, runs the
// deterministic mapper, and — for products — binds re-imported rows to their live
// matches so a second upload MERGES (show-diff) instead of double-creating
// (avoids the won-conversion class of bug). Stays pure so it is unit-testable
// without a DB, network, or React.
//
// DEDUPE SCOPE (v1): products only. A clean upload is EITHER all-products OR
// all-stock (the router picks one kind per file), so scoping dedupe to the
// products lane is sufficient AND safe: it prevents a stock card from
// cross-module-binding to a product that happens to share a SKU. Stock-variant
// dedupe (variant-id vs family-id binding) is a separate, deferred lane.

import { parseCsv, type ParsedSheet } from "./csv-parse";
import { routeUpload, type AgentReason } from "./upload-router";
import {
  suggestProductsMapping,
  suggestStockMapping,
} from "./column-mapping";
import { mapProductsCsv } from "./products-csv-mapper";
import { mapStockCsv } from "./stock-csv-mapper";
import { matchCards } from "./commit/dedupe-matcher";
import type { LiveCatalogRow } from "./commit/dedupe-matcher.types";
import type { StagingCard } from "./staging-card";
import type { CategoryVocab, MapError, UnitVocab } from "./mapper-types";

export interface BuildUploadCardsInput {
  /** Original filename — drives the extension fallback in the router. */
  filename: string;
  /** Reported MIME type (may be empty/generic — extension is the fallback). */
  mime: string;
  /**
   * The parsed sheet for a CSV/XLSX the caller could read, or null for a file
   * the caller could not parse (PDF / image / unsupported binary) — null routes
   * to the agent lane.
   */
  sheet: ParsedSheet | null;
  /** Company category vocabulary for typed-text → FK resolution. */
  categories: CategoryVocab[];
  /** Company unit vocabulary for typed-text → FK resolution. */
  units: UnitVocab[];
  /** Live PRODUCT rows for show-diff dedupe (passed in — no read here). */
  liveProductRows: LiveCatalogRow[];
}

/**
 * Which spreadsheet headers the auto-map actually read into the required fields,
 * plus any present-but-unused columns the owner likely cares about. There is no
 * column-confirmation step on web (the canvas reviews VALUES, not column
 * ASSIGNMENTS), so this lets the staged summary DISCLOSE the mapping — the owner
 * can catch a substring mis-map ("Customer Name" → name) or a silently-dropped
 * inventory column ("On Hand" on a products upload) before BUILD IT.
 */
export interface UploadReadColumns {
  /** Header mapped to the product/family NAME. */
  name?: string;
  /** Header mapped to the base PRICE. */
  price?: string;
  /** Header mapped to QUANTITY (stock lane). */
  quantity?: string;
  /** Present-but-unused headers the owner likely expected to import (e.g. a
   *  quantity/on-hand column on a products upload → inventory silently dropped). */
  dropped?: string[];
}

export type UploadStageResult =
  | {
      lane: "deterministic";
      kind: "products" | "stock";
      /** Mapped, dedupe-bound cards (empty when `errors` is non-empty). */
      cards: StagingCard[];
      /** How many cards bound to a live row (merge / show-diff). */
      mergedCount: number;
      /** How many data rows the file held. */
      rowsRead: number;
      /** The headers auto-map read + any dropped columns (disclosure). */
      read: UploadReadColumns;
      /** Local mapping errors — non-empty ⇒ `cards` empty (payload-or-nil). */
      errors: MapError[];
    }
  | {
      lane: "agent";
      /** Why the file could not go to the deterministic mapper. */
      reason: AgentReason;
      rowsRead: number;
    };

/** The source stamp the agent uses for the deterministic CSV lane. */
const UPLOAD_SOURCE = "import" as const;

/**
 * Bind each product card that matches a live row to merge state so the commit
 * UPSERTs the existing row (spec §11). A SKU/name match → `state:"merge"` +
 * `matchedExistingId` (the canvas renders show-diff; the commit's
 * card-to-builder-input maps `matchedExistingId` → the UPSERT target id). A
 * no-match card stays `proposed`.
 */
function bindProductDuplicates(
  cards: StagingCard[],
  liveRows: LiveCatalogRow[],
): StagingCard[] {
  if (liveRows.length === 0) return cards;
  const { matches } = matchCards({ cards, liveRows });
  const matchByCard = new Map(matches.map((m) => [m.cardClientId, m]));
  return cards.map((card) => {
    const match = matchByCard.get(card.id);
    if (match?.matchedRowId) {
      return {
        ...card,
        state: "merge",
        matchedExistingId: match.matchedRowId,
      } as StagingCard;
    }
    return card;
  });
}

export function buildUploadCards(
  input: BuildUploadCardsInput,
): UploadStageResult {
  const { filename, mime, sheet, categories, units, liveProductRows } = input;
  const headers = sheet?.headers ?? null;
  const rowsRead = sheet?.rows.length ?? 0;

  const decision = routeUpload({ filename, mime, headers });
  if (decision.lane === "agent") {
    return { lane: "agent", reason: decision.reason, rowsRead };
  }

  // Deterministic — the router only returns this when `sheet` has parseable
  // headers, so `sheet` is non-null here.
  const parsed = sheet as ParsedSheet;

  if (decision.kind === "products") {
    const mapping = suggestProductsMapping(parsed.headers);
    // A quantity/on-hand column present on a PRODUCTS upload is dropped (products
    // carry no stock count) — surface it so the owner knows inventory wasn't read.
    const stockMap = suggestStockMapping(parsed.headers);
    const droppedQty =
      stockMap.quantity && stockMap.quantity !== mapping.basePrice
        ? [stockMap.quantity]
        : undefined;
    const read: UploadReadColumns = {
      name: mapping.name,
      price: mapping.basePrice,
      dropped: droppedQty,
    };
    const { cards, errors } = mapProductsCsv({
      rows: parsed.rows,
      lineNumbers: parsed.lineNumbers,
      mapping,
      categories,
      units,
      source: UPLOAD_SOURCE,
    });
    if (errors.length > 0) {
      return {
        lane: "deterministic",
        kind: "products",
        cards: [],
        mergedCount: 0,
        rowsRead,
        read,
        errors,
      };
    }
    const bound = bindProductDuplicates(cards, liveProductRows);
    const mergedCount = bound.filter((c) => c.state === "merge").length;
    return {
      lane: "deterministic",
      kind: "products",
      cards: bound,
      mergedCount,
      rowsRead,
      read,
      errors: [],
    };
  }

  // Stock — no dedupe in v1 (see DEDUPE SCOPE note above).
  const mapping = suggestStockMapping(parsed.headers);
  const read: UploadReadColumns = {
    name: mapping.familyName,
    price: mapping.defaultPrice,
    quantity: mapping.quantity,
  };
  const { cards, errors } = mapStockCsv({
    rows: parsed.rows,
    lineNumbers: parsed.lineNumbers,
    mapping,
    categories,
    units,
    source: UPLOAD_SOURCE,
  });
  if (errors.length > 0) {
    return {
      lane: "deterministic",
      kind: "stock",
      cards: [],
      mergedCount: 0,
      rowsRead,
      read,
      errors,
    };
  }
  return {
    lane: "deterministic",
    kind: "stock",
    cards,
    mergedCount: 0,
    rowsRead,
    read,
    errors: [],
  };
}

/** Convenience: parse a CSV string then stage it (mirrors the route's flow). */
export function buildUploadCardsFromCsv(
  csvText: string,
  rest: Omit<BuildUploadCardsInput, "sheet">,
): UploadStageResult {
  return buildUploadCards({ ...rest, sheet: parseCsv(csvText) });
}
