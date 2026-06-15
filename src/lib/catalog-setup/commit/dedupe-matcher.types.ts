// TYPE CONTRACT for the PURE show-diff dedupe matcher (plan Phase 3, Task 3.3).
//
// On commit, the wizard matches each accepted StagingCard against the live
// catalog rows (passed IN — the live read is DEFERRED to the route/wave-2)
// and classifies it NEW vs MATCH, producing per-field DIFF descriptors for
// DISPLAY (spec §11, §17.2). NOTE: the shipped resolution is whole-card
// take-incoming (a `merge` card UPSERTs all its fields); per-field accept is
// scaffolding, not yet wired — see the DedupeAction / CardResolution notes below.
//
// SELF-CONTAINED on purpose (like staging-card.ts / payload-builder.types.ts):
// imports nothing from the overhaul-branch `catalog.ts`. The only cross-module
// import is the canonical `StagingCard` contract.
//
// Matching rules (spec §11, slice brief):
//   1. external_id re-sync FIRST — if the card carries the same
//      (external_source, external_id) as a live row, that row is THE match even
//      when sku/name drifted (re-import re-syncs the same row → no duplicate).
//   2. sku — `lower(trim(sku))` (products carry a case-sensitive SKU index in
//      Postgres, so the matcher collapses case to catch human re-entry; stock
//      SKUs live on `catalog_variants` since `catalog_items` has NO sku column,
//      so STOCK cards match at the variant level).
//   3. name — `lower(trim(name))`, ONLY when SKU is absent on BOTH the card and
//      the candidate (a SKU-bearing card never falls through to a name match).
// No match → NEW (defaultAction `create`).

import type { StagingCard } from "@/lib/catalog-setup/staging-card";

/** Re-export so consumers import the card shape from one place. */
export type { StagingCard };

/**
 * Owner's resolution for a card during dedupe (spec §11, §17.2).
 * - create:    no live match → insert a new row (still stamps external_*).
 * - show-diff: matched a live row → per-field accept.
 * - merge-all: matched → take every incoming field over the live row.
 * - skip:      matched → keep the live row untouched; drop the card.
 *
 * SHIPPED REALITY (do not trust the per-field framing above as live): the
 * production commit path is whole-card take-incoming — a `merge`-state card maps
 * its matchedExistingId → UPSERT and sends ALL its fields (card-to-builder-input).
 * The per-field `show-diff` resolution (applyDedupe + CardResolution.fieldSelections
 * below) is unit-tested SCAFFOLDING for a not-yet-built per-field accept UI; nothing
 * in the commit pipeline calls it yet.
 */
export type DedupeAction = "create" | "show-diff" | "merge-all" | "skip";

/** How a card matched a live row (null when it did not match). */
export type MatchBasis = "external" | "sku" | "name" | null;

/**
 * A live catalog row to match against — the matcher's existing-rows INPUT.
 * The live read is DEFERRED: the route reads these (service-role) and passes
 * them in. `sku` is null for rows without one (e.g. a `catalog_items` family,
 * which has no sku — stock SKUs live on the variant rows). The index signature
 * lets the matcher diff arbitrary comparable fields (base_price, unit, …).
 */
export interface LiveCatalogRow {
  id: string;
  sku: string | null;
  name: string;
  external_source?: string | null;
  external_id?: string | null;
  [field: string]: unknown;
}

/** One field that differs between the incoming card and the matched live row. */
export interface DiffField {
  /** The live-row (snake_case) field key, e.g. `base_price`. */
  field: string;
  incoming: unknown;
  existing: unknown;
}

/** The matcher's per-card classification. */
export interface CardMatch {
  /** The card's stable client id (`StagingCard.id`). */
  cardClientId: string;
  /** Matched live row id, or null when the card is NEW. */
  matchedRowId: string | null;
  /** What the match keyed on (null when NEW). */
  matchedOn: MatchBasis;
  /** show-diff on a match, create on no match (spec §17.2). */
  defaultAction: DedupeAction;
  /** Per-field diffs vs the matched row (empty when NEW or when fields agree). */
  diffs: DiffField[];
  /** external_* stamp carried onto the row on commit (re-import identity). */
  externalSource: string | null;
  externalId: string | null;
}

/** Per-card external identity, supplied alongside the card set. */
export interface CardExternalRef {
  externalSource: string | null;
  externalId: string | null;
}

/** Input to `matchCards`. */
export interface MatchCardsInput {
  /**
   * The source stamp for THIS import run (e.g. "quickbooks", "csv"). Applied to
   * every card unless overridden per-card in `externalRefs`. null for manual /
   * agent-authored cards that have no external origin.
   */
  externalSource?: string | null;
  /** The accepted staging cards to classify. */
  cards: StagingCard[];
  /** Live catalog rows to match against (DEFERRED read — passed in). */
  liveRows: LiveCatalogRow[];
  /**
   * Optional per-card external identity, keyed by `StagingCard.id`. When a card
   * has an entry here, its `externalId` (and optional `externalSource`) override
   * the run-level `externalSource`. Cards without an entry inherit the run-level
   * source and carry a null external id.
   */
  externalRefs?: Record<string, CardExternalRef>;
}

/** Result of `matchCards` — one `CardMatch` per input card, order preserved. */
export interface DedupeResult {
  matches: CardMatch[];
}

/** Per-field user selections for a show-diff resolution, keyed by field name. */
export type FieldSelections = Record<string, boolean>;

/**
 * How the owner would resolve one card after seeing its match. SCAFFOLDING only —
 * the canvas does NOT yet wire a per-field show-diff UI, so nothing in the
 * production commit constructs this; `applyDedupe` (which consumes it) is exercised
 * by unit tests but not by the live pipeline. `action` defaults to the match's
 * `defaultAction`; `fieldSelections` is consulted only for `show-diff`.
 */
export interface CardResolution {
  action: DedupeAction;
  fieldSelections?: FieldSelections;
}

/**
 * A card after dedupe actions are applied — the input to the payload builder.
 * Carries the resolved live-row `id` (set for merge / accepted show-diff so the
 * RPC UPSERTs), the (possibly field-filtered) card, and the external_* stamp.
 */
export interface ResolvedCard {
  card: StagingCard;
  /** Live row id to UPSERT into (null = create a fresh row). */
  id: string | null;
  externalSource: string | null;
  externalId: string | null;
}
