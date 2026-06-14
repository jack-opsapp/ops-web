// Pure, framework-free state machine for the catalog-setup live-building canvas.
//
// Every source (import / agent / template / manual) produces StagingCards that
// flow through this reducer; the store (src/stores/catalog-setup-store.ts) is a
// thin wrapper so the heavy logic stays unit-pure, deterministic, and
// dependency-free (no React, no I/O). Spec §7 (canvas), §11 (dedupe/merge,
// persistence/resume).
//
// Imports the canonical contract from `./staging-card` (the shared model the
// whole wizard depends on) — not the inline `staging-types` placeholder named
// in the plan draft.

import type {
  StagingCard,
  CardFieldsFor,
  ModuleKey,
  SellFields,
} from "./staging-card";

export interface StagingState {
  cards: StagingCard[];
}

export const initialStagingState: StagingState = { cards: [] };

export type StagingAction =
  | { type: "ADD_CARDS"; cards: StagingCard[] }
  | { type: "ACCEPT_CARD"; id: string }
  | { type: "EDIT_CARD"; id: string; fields: Partial<CardFieldsFor<ModuleKey>> }
  | { type: "REJECT_CARD"; id: string }
  | { type: "MERGE_CARD"; id: string; matchedExistingId: string }
  | { type: "UNRESOLVE_CARD"; id: string }
  | { type: "DOWNSHIFT_STOCK_TO_PRODUCTS" }
  | { type: "RESET" };

/**
 * Apply `fn` to the card with `id`, returning a new state. If no card matches,
 * the SAME state reference is returned so callers (and React) can cheaply
 * detect a no-op (spec §16 — actions never half-mutate).
 */
function mapCard(
  state: StagingState,
  id: string,
  fn: (c: StagingCard) => StagingCard,
): StagingState {
  const idx = state.cards.findIndex((c) => c.id === id);
  if (idx === -1) return state; // no-op, same ref
  const next = state.cards.slice();
  next[idx] = fn(state.cards[idx]);
  return { ...state, cards: next };
}

export function stagingReducer(
  state: StagingState,
  action: StagingAction,
): StagingState {
  switch (action.type) {
    case "ADD_CARDS": {
      // Idempotent by id — re-feeding the same source (refresh, retry, double
      // import) never duplicates a card (spec §11 re-import identity).
      const existing = new Set(state.cards.map((c) => c.id));
      const fresh = action.cards.filter((c) => !existing.has(c.id));
      if (fresh.length === 0) return state;
      return { ...state, cards: [...state.cards, ...fresh] };
    }
    case "ACCEPT_CARD":
      return mapCard(state, action.id, (c) => ({ ...c, state: "accepted" }));
    case "EDIT_CARD":
      // Field-merge keeps untouched fields; the discriminated-union widening is
      // safe because `fields` always stays within the card's own module shape.
      return mapCard(
        state,
        action.id,
        (c) =>
          ({
            ...c,
            state: "edited",
            fields: { ...c.fields, ...action.fields },
          }) as StagingCard,
      );
    case "REJECT_CARD":
      return mapCard(state, action.id, (c) => ({ ...c, state: "rejected" }));
    case "MERGE_CARD":
      return mapCard(state, action.id, (c) => ({
        ...c,
        state: "merge",
        matchedExistingId: action.matchedExistingId,
      }));
    case "UNRESOLVE_CARD":
      // Undo: return a resolved card (rejected / merged) to the unacted
      // "proposed" state and drop any recorded match (spec §11 undo).
      return mapCard(state, action.id, (c) => ({
        ...c,
        state: "proposed",
        matchedExistingId: undefined,
      }));
    case "DOWNSHIFT_STOCK_TO_PRODUCTS": {
      // Inventory-off + stock arrived, owner chose "keep as products": convert
      // every stock card to a product, SURFACING the on-hand count in the
      // description (spec §16 — quantities are never silently dropped). The card
      // keeps its id/source/state; defaultPrice is null so a kept-but-unpriced
      // product honestly blocks BUILD IT until priced.
      if (!state.cards.some((c) => c.module === "stock")) return state;
      const cards = state.cards.map((c): StagingCard => {
        if (c.module !== "stock") return c;
        const s = c.fields;
        const fields: SellFields = {
          name: s.name,
          description: s.quantity != null ? `On hand: ${s.quantity}` : undefined,
          defaultPrice: null,
          unitCost: s.unitCost,
          sku: s.sku,
          isTaxable: true,
          kind: "material",
          type: "MATERIAL",
        };
        return { id: c.id, source: c.source, state: c.state, module: "sell", fields };
      });
      return { ...state, cards };
    }
    case "RESET":
      return initialStagingState;
    default:
      return state;
  }
}
