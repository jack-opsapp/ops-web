// Pure adapter: mapped QuickBooks drafts → canvas StagingCards (Task 5.6).
//
// The seam between the QB Item→catalog mapper (`qb-item-mapper.ts`, which emits a
// rich `QbItemDraft`) and the live-building canvas (which speaks `StagingCard`).
// Every QB item lands as ONE SELL card so the owner sees their price book take
// shape — never the products-vs-catalog-items table split (spec §5, §8).
//
// SCOPE (v1 QB lane, documented): QuickBooks items map to the SELL price book.
//   • Service / NonInventory / Inventory → a sellable product (estimate-ready —
//     the wizard's whole purpose, spec §9 "estimate-line-item readiness").
//   • An Inventory item's on-hand count is SURFACED in the description ("On hand:
//     N") rather than silently dropped (spec §16) — it does NOT spin up a
//     separate catalog_items/variants stock row in this lane. Standing up linked
//     stock tracking from QB (catalog_items + variants + the product↔item link +
//     variant-level re-import idempotency) is a deliberate follow-up, not bolted
//     onto this read-only pull.
//   • Group/bundle → a `package` product; its component lines are flagged for
//     review (the StagingCard model carries no bundle composition yet).
//
// Re-import identity (spec §11): every card is stamped with external_source =
// "quickbooks" + external_id = the QB Item.Id, and carries a STABLE client id
// (`qb:<id>`) so a re-pull is idempotent in the reducer (ADD_CARDS dedupes by id)
// AND so the dedupe-matcher re-syncs the same catalog row instead of duplicating.
//
// PURE: no Supabase, no network, no time, no randomness. Fixture-driven + unit-
// tested, exactly like the mapper it consumes.

import type { StagingCard, SellFields } from "@/lib/catalog-setup/staging-card";
import type { QbItemDraft } from "./qb-item-mapper";
import { QB_EXTERNAL_SOURCE } from "./qb-item-mapper";

/** Stable client id for a QB-sourced card — deterministic across re-pulls. */
export function qbCardId(externalId: string): string {
  return `qb:${externalId}`;
}

export interface QbDraftsToCardsOptions {
  /**
   * Localized prefix for the surfaced on-hand line on an Inventory item's
   * description, e.g. "On hand". Defaults to the English label (mirrors the
   * DOWNSHIFT_STOCK_TO_PRODUCTS reducer precedent for "inventory off → keep as
   * products", so the two on-hand surfacings read identically).
   */
  onHandLabel?: string;
}

/** Append the surfaced on-hand line to a draft's description (never drop a count). */
function withOnHand(
  description: string | null,
  onHand: number | null | undefined,
  label: string,
): string | undefined {
  if (onHand == null) return description ?? undefined;
  const line = `${label}: ${onHand}`;
  return description && description.length > 0 ? `${description}\n${line}` : line;
}

/**
 * Adapt ONE mapped draft → a SELL StagingCard. A Category folder (kind === null)
 * must already have been dropped by `mapQbItems`; this guards defensively and
 * returns null so a stray sentinel never becomes a card.
 */
export function qbDraftToCard(
  draft: QbItemDraft,
  opts: QbDraftsToCardsOptions = {},
): StagingCard | null {
  if (draft.kind === null) return null; // Category folder sentinel — never a card

  const onHandLabel = opts.onHandLabel ?? "On hand";
  // An Inventory item carries its on-hand count on `catalogItem` (present only
  // when the company tracks inventory). Surface it on the product description so
  // the count is never silently lost (spec §16).
  const description = withOnHand(
    draft.description,
    draft.catalogItem?.onHand ?? null,
    onHandLabel,
  );

  const fields: SellFields = {
    name: draft.name,
    defaultPrice: draft.defaultPrice,
    unitCost: draft.unitCost,
    isTaxable: draft.isTaxable,
    kind: draft.kind,
    type: draft.type,
    pricingUnit: draft.pricingUnit,
  };
  if (description !== undefined) fields.description = description;
  if (draft.sku) fields.sku = draft.sku;

  return {
    id: qbCardId(draft.externalId),
    source: "import",
    state: "proposed",
    module: "sell",
    fields,
    externalSource: QB_EXTERNAL_SOURCE,
    externalId: draft.externalId,
  };
}

/**
 * Adapt a whole mapped QB pull → SELL StagingCards. Order is preserved 1:1 with
 * the input drafts; dropped sentinels (defensive) are omitted.
 */
export function qbDraftsToCards(
  drafts: QbItemDraft[],
  opts: QbDraftsToCardsOptions = {},
): StagingCard[] {
  const out: StagingCard[] = [];
  for (const draft of drafts) {
    const card = qbDraftToCard(draft, opts);
    if (card) out.push(card);
  }
  return out;
}
