// Blank manual-entry card factories. The manual lane (source picker + the
// per-section "add a row" affordance) seeds an empty, owner-filled StagingCard
// of the right module. Centralized here so the route's first manual SELL card
// and the canvas's per-section adds mint identical shapes (spec §8 manual).
//
// Client-only: uses crypto.randomUUID for the stable client id that becomes the
// commit client id (spec §11).

import type { ModuleKey, StagingCard } from "./staging-card";

function freshId(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `manual_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** A fresh, empty card the operator fills via the item editor. Module-typed. */
export function blankCard(module: ModuleKey): StagingCard {
  const base = { id: freshId(), source: "manual" as const, state: "proposed" as const };
  switch (module) {
    case "sell":
      return {
        ...base,
        module: "sell",
        fields: {
          name: "",
          defaultPrice: null,
          unitCost: null,
          isTaxable: true,
          kind: "service",
          type: "LABOR",
        },
      };
    case "stock":
      return {
        ...base,
        module: "stock",
        fields: {
          name: "",
          quantity: null,
          unitCost: null,
          reorderPoint: null,
        },
      };
    case "types":
      return {
        ...base,
        module: "types",
        fields: { display: "" },
      };
  }
}
