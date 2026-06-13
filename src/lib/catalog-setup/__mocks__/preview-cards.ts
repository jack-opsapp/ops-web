// Mock seed for the catalog-setup standalone preview route.
//
// A realistic vinyl-wrap shop catalog mid-build — matches the approved mock so
// the preview renders the full state matrix the three downstream surfaces must
// handle (spec §5–§11):
//
//   accepted        — owner already accepted (counts toward "added")
//   proposed        — surfaced from an import, not yet acted on
//   suggested (agent) — agent-proposed, lavender provenance, not yet acted on
//   duplicate (merge) — matched a live catalog row; carries a field diff
//   stock           — STOCK-module item with on-hand + reorder point
//
// PURE DATA. No React, no store, no side effects. Typed to StagingCard so it
// stays honest against the model — a field rename in `staging-card.ts` breaks
// this file at compile time, not at runtime in the preview.

import type { StagingCard, SellFields } from "@/lib/catalog-setup/staging-card";

// ── SELL — accepted ──────────────────────────────────────────────────────────
// Owner already accepted this from their imported price list. Counts as "added".
const fullVehicleWrap: StagingCard = {
  id: "sell-full-vehicle-wrap",
  source: "import",
  state: "accepted",
  module: "sell",
  fields: {
    name: "Full vehicle wrap — cast vinyl",
    description: "Full-coverage color change, cast vinyl, single vehicle.",
    defaultPrice: 3200,
    unitCost: 1150,
    sku: "WRAP-FULL-CAST",
    isTaxable: true,
    kind: "service",
    type: "LABOR",
    pricingUnit: "vehicle",
  },
};

// ── SELL — proposed (from import), still needs a price ────────────────────────
// Surfaced from the imported list but the price column was blank — the canvas
// flags "needs a price" and blocks it from going live until the owner sets one.
const partialWrap: StagingCard = {
  id: "sell-partial-wrap",
  source: "import",
  state: "proposed",
  module: "sell",
  fields: {
    name: "Partial wrap — hood + roof + mirrors",
    description: "Accent coverage on hood, roof, and mirror caps.",
    defaultPrice: null, // → "needs a price"
    unitCost: 340,
    sku: "WRAP-PARTIAL",
    isTaxable: true,
    kind: "service",
    type: "LABOR",
    pricingUnit: "vehicle",
  },
};

// ── SELL — proposed material (from import) ────────────────────────────────────
const laminateRoll: StagingCard = {
  id: "sell-gloss-laminate",
  source: "import",
  state: "proposed",
  module: "sell",
  fields: {
    name: "Gloss laminate overlaminate — 54in",
    description: "UV-protective gloss overlaminate, sold by the linear foot.",
    defaultPrice: 9,
    unitCost: 4.25,
    sku: "LAM-GLOSS-54",
    isTaxable: true,
    kind: "material",
    type: "MATERIAL",
    pricingUnit: "ft",
  },
};

// ── SELL — suggested (agent provenance) ──────────────────────────────────────
// Agent surfaced a common add-on the shop's imports never listed. Lavender
// provenance applies ONLY because source === "agent". Not yet acted on.
const designFee: StagingCard = {
  id: "sell-design-proof-fee",
  source: "agent",
  state: "proposed",
  module: "sell",
  fields: {
    name: "Design and proof",
    description: "Artwork layout, proof rounds, and print-ready file prep.",
    defaultPrice: 250,
    unitCost: 0,
    sku: "DESIGN-PROOF",
    isTaxable: false,
    kind: "service",
    type: "OTHER",
    pricingUnit: "job",
  },
};

const removalFee: StagingCard = {
  id: "sell-old-wrap-removal",
  source: "agent",
  state: "proposed",
  module: "sell",
  fields: {
    name: "Old wrap removal",
    description: "Strip and adhesive cleanup before a re-wrap.",
    defaultPrice: 600,
    unitCost: 120,
    sku: "WRAP-REMOVAL",
    isTaxable: true,
    kind: "service",
    type: "LABOR",
    pricingUnit: "vehicle",
  },
};

// ── SELL — duplicate (merge) with a diff against a live row ───────────────────
// The import re-listed a product the shop already has. The canvas matched it to
// the existing catalog row and staged it as a merge: on commit it folds the
// changed fields (a higher price, a new cost) into the live row instead of
// creating a second one. `matchedExistingId` points at the on-file row below.
const windowPerfDuplicate: StagingCard = {
  id: "sell-window-perf-incoming",
  source: "import",
  state: "merge",
  module: "sell",
  matchedExistingId: "existing-window-perf",
  fields: {
    name: "Window perforated vinyl — 60/40",
    description: "See-through perforated print for rear windows, 60/40 weave.",
    defaultPrice: 14, // incoming differs from on-file (12)
    unitCost: 6.5, // incoming sets a cost the on-file row never had
    sku: "WIN-PERF-6040",
    isTaxable: true,
    kind: "material",
    type: "MATERIAL",
    pricingUnit: "sqft",
  },
};

// ── STOCK — tracked on-hand item ─────────────────────────────────────────────
const castVinylStock: StagingCard = {
  id: "stock-cast-vinyl-black",
  source: "import",
  state: "proposed",
  module: "stock",
  fields: {
    name: "Cast vinyl — gloss black, 60in roll",
    sku: "VINYL-CAST-BLK-60",
    quantity: 8,
    unitCost: 285,
    reorderPoint: 3,
    unitId: "roll",
  },
};

// ── STOCK — accepted, low on hand ────────────────────────────────────────────
const squeegeeStock: StagingCard = {
  id: "stock-squeegee-felt",
  source: "manual",
  state: "accepted",
  module: "stock",
  fields: {
    name: "Felt-edge squeegee",
    sku: "TOOL-SQGE-FELT",
    quantity: 2,
    unitCost: 6,
    reorderPoint: 6, // on-hand below reorder point → attention
    unitId: "ea",
  },
};

// ── TYPES — accepted trade + a task type ─────────────────────────────────────
const vinylTrade: StagingCard = {
  id: "type-trade-vinyl-graphics",
  source: "template",
  state: "accepted",
  module: "types",
  fields: {
    display: "Vinyl & graphics",
    isTrade: true,
  },
};

const installType: StagingCard = {
  id: "type-task-install",
  source: "template",
  state: "proposed",
  module: "types",
  fields: {
    display: "Install day",
    color: "#9DB582",
  },
};

/**
 * The full staged set for the preview, ordered the way the canvas surfaces them:
 * SELL first (accepted → proposed → suggested → duplicate), then STOCK, then
 * TYPES — so the preview exercises every card state in one render.
 */
export const PREVIEW_STAGING_CARDS: StagingCard[] = [
  fullVehicleWrap,
  partialWrap,
  laminateRoll,
  designFee,
  removalFee,
  windowPerfDuplicate,
  castVinylStock,
  squeegeeStock,
  vinylTrade,
  installType,
];

/**
 * The live catalog rows a duplicate card matched against, keyed by the id that
 * `matchedExistingId` points to. The preview reads this to render the dedupe
 * diff (on-file vs incoming) without a database round-trip. Typed to the SELL
 * field shape since the only duplicate in the seed is a SELL row.
 */
export const PREVIEW_EXISTING_ROWS: Record<string, SellFields> = {
  "existing-window-perf": {
    name: "Window perforated vinyl — 60/40",
    description: "Perforated rear-window print, 60/40.",
    defaultPrice: 12, // on-file price, lower than incoming
    unitCost: null, // on-file row never carried a cost
    sku: "WIN-PERF-6040",
    isTaxable: true,
    kind: "material",
    type: "MATERIAL",
    pricingUnit: "sqft",
  },
};

/**
 * A precomputed running-totals snapshot for the seed, so the header preview can
 * render real numbers without importing the selectors. Mirrors the
 * `RunningTotals` shape: added = accepted + edited + merge.
 *   accepted: fullVehicleWrap, squeegeeStock, vinylTrade  (3)
 *   merge:    windowPerfDuplicate                         (1)
 *   → added = 4 ; proposed = the remaining 6 ; rejected = 0
 */
export const PREVIEW_TOTALS = {
  proposed: 6,
  added: 4,
  rejected: 0,
} as const;

/** A representative card for each state the downstream surfaces must style. */
export const PREVIEW_CARDS_BY_STATE: {
  accepted: StagingCard;
  proposed: StagingCard;
  suggested: StagingCard;
  duplicate: StagingCard;
  stock: StagingCard;
} = {
  accepted: fullVehicleWrap,
  proposed: partialWrap,
  suggested: designFee,
  duplicate: windowPerfDuplicate,
  stock: castVinylStock,
};
