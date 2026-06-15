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
      errors: [],
    };
  }

  // Stock — no dedupe in v1 (see DEDUPE SCOPE note above).
  const mapping = suggestStockMapping(parsed.headers);
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
      errors,
    };
  }
  return {
    lane: "deterministic",
    kind: "stock",
    cards,
    mergedCount: 0,
    rowsRead,
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
