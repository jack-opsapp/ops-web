// Pure import-time dedupe classification (spec §11, §17.2).
//
// Given the adapted import StagingCards + the live catalog rows (DEFERRED read —
// the route fetches them, never this module), classify each card NEW vs MATCH via
// the canonical `matchCards` dedupe-matcher and project the result back onto the
// cards the canvas renders:
//
//   • a MATCH (external_id → sku → name precedence) becomes a `merge` card bound
//     to the live row id (`matchedExistingId`) so the commit UPSERTs by id rather
//     than creating a duplicate that the unique indexes would hard-reject;
//   • a no-match stays `proposed`.
//
// It also builds the `existingRows` map (matched live-row id → SellFields) that
// `SetupWizardShell`/`CanvasPane` consume to render the per-field show-diff on a
// merge card ("// matched a row you already have").
//
// This is the load-bearing duplicate-prevention step for re-import: `catalog_setup_save`
// only ON CONFLICT (id), so an UNMATCHED dup-sku/dup-external_id create would
// error on the partial unique indexes. Catching the match HERE is what makes a
// re-pull merge instead (verified against prod: uniq_products_sku_per_company,
// uniq_products_external_id_per_company).
//
// PURE: no Supabase, no network, no time, no randomness — fully unit-testable.

import type { StagingCard, SellFields } from "@/lib/catalog-setup/staging-card";
import { matchCards } from "@/lib/catalog-setup/commit/dedupe-matcher";
import type {
  CardExternalRef,
  LiveCatalogRow,
} from "@/lib/catalog-setup/commit/dedupe-matcher.types";

export interface ClassifyImportedCardsResult {
  /** Cards with state set: `merge` (+ matchedExistingId) on a hit, else `proposed`. */
  cards: StagingCard[];
  /** Matched live SELL rows, keyed by live-row id, for the canvas show-diff. */
  existingRows: Record<string, SellFields>;
  /** How many cards matched an existing row (for the import summary copy). */
  matchedCount: number;
}

/** Build a SellFields view of a live product row for the show-diff display. */
function liveRowToSellFields(row: LiveCatalogRow): SellFields {
  const num = (v: unknown): number | null =>
    typeof v === "number" ? v : v == null ? null : Number(v);
  const kind = row.kind === "material" || row.kind === "package" ? row.kind : "service";
  const type =
    row.type === "MATERIAL" || row.type === "OTHER" ? row.type : "LABOR";
  return {
    name: row.name,
    defaultPrice: num(row.base_price),
    unitCost: num(row.unit_cost),
    isTaxable: typeof row.is_taxable === "boolean" ? row.is_taxable : true,
    kind,
    type,
  };
}

/**
 * Classify import cards against the live catalog and project matches onto the
 * cards (+ build the existingRows show-diff map). `externalSource` is the run
 * stamp (e.g. "quickbooks"); per-card external ids are read off each card so the
 * external_id precedence fires even when sku/name drifted between pulls.
 */
export function classifyImportedCards(
  cards: StagingCard[],
  liveRows: LiveCatalogRow[],
  externalSource: string,
): ClassifyImportedCardsResult {
  // Per-card external refs from the cards themselves (the adapter stamped them),
  // so matchCards keys on the QB Item.Id first — surviving rename / sku drift.
  const externalRefs: Record<string, CardExternalRef> = {};
  for (const card of cards) {
    if (card.externalId != null || card.externalSource != null) {
      externalRefs[card.id] = {
        externalSource: card.externalSource ?? externalSource,
        externalId: card.externalId ?? null,
      };
    }
  }

  const { matches } = matchCards({
    cards,
    liveRows,
    externalSource,
    externalRefs,
  });
  const matchById = new Map(matches.map((m) => [m.cardClientId, m]));
  const rowById = new Map(liveRows.map((r) => [r.id, r]));

  const existingRows: Record<string, SellFields> = {};
  let matchedCount = 0;

  const classified = cards.map((card): StagingCard => {
    const match = matchById.get(card.id);
    if (!match || match.matchedRowId == null) return card; // stays "proposed"

    matchedCount += 1;
    const row = rowById.get(match.matchedRowId);
    if (row && card.module === "sell") {
      existingRows[match.matchedRowId] = liveRowToSellFields(row);
    }
    return {
      ...card,
      state: "merge",
      matchedExistingId: match.matchedRowId,
    };
  });

  return { cards: classified, existingRows, matchedCount };
}
