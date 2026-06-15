// PER-TRADE TEMPLATE SEEDS — the offline / declined / agent-failure FLOOR.
//
// Mirrors the `industry-presets.ts` data shape (a static, keyed lookup) but
// instead of merge-grid task types it produces editable Phase-1 StagingCards,
// keyed by the locked `trade-list` tokens. When import is unavailable, the agent
// is declined or down, or the owner just wants a head start, the template lane
// drops a small, real, trimmable starter catalog onto the canvas (spec §3, §8,
// §10): a TYPES card per preset task type (auto-colored) plus a couple of seed
// SELL line items the owner edits or rejects like any other proposed row.
//
// PURE + dependency-free: no DB, no React, no network. `selectTradeTemplate`
// takes a trade token and returns fresh StagingCards every call (new ids), so
// re-selecting a trade re-stages cleanly without canvas key collisions.
//
// Every card is stamped source "template" + state "proposed" — the canvas owns
// accept/edit/reject; nothing here is pre-accepted.

import { autoAssignColors } from "@/lib/data/curated-colors";
import { INDUSTRY_PRESETS } from "@/lib/data/industry-presets";
import {
  WIZARD_TRADES,
  type WizardTradeId,
} from "@/lib/catalog-setup/trade-list";
import type {
  SellFields,
  StagingCard,
  TypeFields,
} from "@/lib/catalog-setup/staging-card";

// ─── Seed product authoring ─────────────────────────────────────────────────
//
// A small, trade-accurate set of starter line items per trade. These are the
// FIRST sellable rows the owner sees pre-filled for their trade — real job-site
// services and goods they actually charge for, written in OPS voice (terse,
// sentence-case content, concrete nouns). Prices are intentionally null: pricing
// is the owner's call and a blank price reads as `—` on the canvas, which is
// honest (spec §13) rather than a fabricated number they'd have to correct.
//
// `kind`/`type` follow the SELL contract (staging-card.ts): kind ∈
// service|material|package; type ∈ LABOR|MATERIAL|OTHER. Services that are pure
// crew time are service/LABOR; physical goods sold by the unit are
// material/MATERIAL.
//
// Roofing, HVAC, and Plumbing are the fully-authored pattern. The remaining
// trades carry a real, trade-specific starter set so no picker option lands on
// the General fallback unless its preset genuinely has no seed authored.

/** A seed SELL line item — minimal authored fields; the rest default at build. */
export interface SeedProduct {
  name: string;
  kind: SellFields["kind"];
  type: SellFields["type"];
}

/** Per-trade starter SELL line items, keyed by the locked trade tokens. */
export const TRADE_SEED_PRODUCTS: Record<WizardTradeId, SeedProduct[]> = {
  // ── Authored pattern ──────────────────────────────────────────────────────
  roofing: [
    { name: "Roof inspection", kind: "service", type: "LABOR" },
    { name: "Tear-off and haul-away", kind: "service", type: "LABOR" },
    { name: "Asphalt shingle install", kind: "service", type: "LABOR" },
    { name: "Architectural shingle bundle", kind: "material", type: "MATERIAL" },
  ],
  hvac: [
    { name: "System diagnostic", kind: "service", type: "LABOR" },
    { name: "Furnace install", kind: "service", type: "LABOR" },
    { name: "AC condenser install", kind: "service", type: "LABOR" },
    { name: "Seasonal tune-up", kind: "service", type: "LABOR" },
  ],
  plumbing: [
    { name: "Service call", kind: "service", type: "LABOR" },
    { name: "Drain clearing", kind: "service", type: "LABOR" },
    { name: "Water heater install", kind: "service", type: "LABOR" },
    { name: "Fixture replacement", kind: "service", type: "LABOR" },
  ],

  // ── Trade-specific starter sets ───────────────────────────────────────────
  electrical: [
    { name: "Service call", kind: "service", type: "LABOR" },
    { name: "Panel upgrade", kind: "service", type: "LABOR" },
    { name: "Outlet and switch install", kind: "service", type: "LABOR" },
  ],
  flooring: [
    { name: "Site measure", kind: "service", type: "LABOR" },
    { name: "Subfloor prep", kind: "service", type: "LABOR" },
    { name: "Flooring install", kind: "service", type: "LABOR" },
  ],
  masonry: [
    { name: "Site assessment", kind: "service", type: "LABOR" },
    { name: "Block and brick laying", kind: "service", type: "LABOR" },
    { name: "Tuckpointing and repair", kind: "service", type: "LABOR" },
  ],
  drywall: [
    { name: "Board hang", kind: "service", type: "LABOR" },
    { name: "Tape and mud", kind: "service", type: "LABOR" },
    { name: "Patch and repair", kind: "service", type: "LABOR" },
  ],
  concrete: [
    { name: "Site prep and forming", kind: "service", type: "LABOR" },
    { name: "Pour and finish", kind: "service", type: "LABOR" },
    { name: "Slab repair", kind: "service", type: "LABOR" },
  ],
  cleaning: [
    { name: "Standard clean", kind: "service", type: "LABOR" },
    { name: "Deep clean", kind: "service", type: "LABOR" },
    { name: "Move-out clean", kind: "service", type: "LABOR" },
  ],
  windows_and_doors: [
    { name: "Site measure", kind: "service", type: "LABOR" },
    { name: "Window replacement", kind: "service", type: "LABOR" },
    { name: "Exterior door install", kind: "service", type: "LABOR" },
  ],
  general: [
    { name: "Site visit and estimate", kind: "service", type: "LABOR" },
    { name: "Labor — day rate", kind: "service", type: "LABOR" },
    { name: "Project management", kind: "service", type: "LABOR" },
  ],
};

// ─── Selector ───────────────────────────────────────────────────────────────

const TRADE_BY_ID: Readonly<Record<WizardTradeId, (typeof WIZARD_TRADES)[number]>> =
  Object.fromEntries(WIZARD_TRADES.map((t) => [t.id, t])) as Record<
    WizardTradeId,
    (typeof WIZARD_TRADES)[number]
  >;

/** Monotonic counter so two cards minted in the same millisecond still differ. */
let cardSeq = 0;

/**
 * Mint a stable, unique client id for a staged card.
 *
 * DEFERRED(wave-1): the canvas (Phase 1) may standardize on `crypto.randomUUID()`
 * — at reconciliation, swap this for the canonical id minter. A counter+time+
 * trade prefix keeps ids unique within and across templates and across repeated
 * calls without requiring the `crypto` global (keeps this module pure + testable
 * under any runtime).
 */
function mintId(tradeId: WizardTradeId, kind: string): string {
  cardSeq += 1;
  return `tpl_${tradeId}_${kind}_${Date.now().toString(36)}_${cardSeq}`;
}

/**
 * Resolve a trade's editable starter cards for the canvas.
 *
 * Returns, in this order, all `source: "template"` / `state: "proposed"`:
 *   1. ONE trade card (`isTrade: true`, `display` = the stable trade slug) — the
 *      company's trade selection. `display` holds the SLUG (not the label) to
 *      match the agent's trade card (proposal-validator) and the commit contract
 *      (`planTaskTypeCommit` reads it as the trade; `recordCompanyTrade`
 *      slug→label). The canvas renders the human label (StagingCardView).
 *   2. TYPES cards — one per preset task type, in dependency order, each with an
 *      auto-assigned color (the same engine the task-types wizard uses).
 *   3. SELL cards — the trade's seed line items (prices null → honest `—`).
 *
 * Always non-empty: each trade maps to a real `INDUSTRY_PRESETS` family
 * (guaranteed by the trade-list contract) and a non-empty seed set, so the
 * picker never offers a dead option (spec §8, §9). The owner accepts / edits /
 * rejects every card on the canvas — nothing here is pre-accepted (spec §7).
 */
export function selectTradeTemplate(tradeId: WizardTradeId): StagingCard[] {
  const trade = TRADE_BY_ID[tradeId];
  const preset = INDUSTRY_PRESETS[trade.presetKey];

  // TRADE — the owner's trade selection. `display` = the stable slug; the commit
  // (`planTaskTypeCommit`) folds it into the company's trade, never a task_types
  // row, and the canvas presents the human label.
  const tradeFields: TypeFields = { display: trade.id, isTrade: true };
  const tradeCard: StagingCard = {
    module: "types",
    id: mintId(tradeId, "trade"),
    source: "template",
    state: "proposed",
    fields: tradeFields,
  };

  // TYPES — one card per preset task type, colored via the shared auto-assigner
  // (same engine the task-types wizard uses, so colors stay on-system).
  const colored = autoAssignColors(
    preset.taskTypes.map((t) => ({ name: t.name, tags: t.tags })),
  );
  const typeCards: StagingCard[] = colored.map((t) => ({
    module: "types",
    id: mintId(tradeId, "type"),
    source: "template",
    state: "proposed",
    fields: {
      display: t.name,
      color: t.color,
    },
  }));

  // SELL — the trade's seed line items. Prices/cost left null (honest `—` on the
  // canvas); the owner sets pricing as they trim.
  const sellCards: StagingCard[] = TRADE_SEED_PRODUCTS[tradeId].map((seed) => ({
    module: "sell",
    id: mintId(tradeId, "sell"),
    source: "template",
    state: "proposed",
    fields: {
      name: seed.name,
      defaultPrice: null,
      unitCost: null,
      isTaxable: true,
      kind: seed.kind,
      type: seed.type,
    },
  }));

  return [tradeCard, ...typeCards, ...sellCards];
}

/** Headline counts the trade picker previews before the owner commits a trade. */
export interface TradeTemplatePreview {
  /** Preset task types seeded (EXCLUDES the trade card — that's the trade). */
  taskTypes: number;
  /** Seed SELL line items (price-book starter lines). */
  sell: number;
}

/**
 * Count what a trade's starter set will stage, WITHOUT minting cards — pure, so
 * the picker can preview "N task types · M starter lines" on hover/select
 * without churning the id counter or building throwaway cards. Mirrors exactly
 * what `selectTradeTemplate` produces (sans the single trade card).
 */
export function previewTradeTemplate(
  tradeId: WizardTradeId,
): TradeTemplatePreview {
  const trade = TRADE_BY_ID[tradeId];
  const preset = INDUSTRY_PRESETS[trade.presetKey];
  return {
    taskTypes: preset.taskTypes.length,
    sell: TRADE_SEED_PRODUCTS[tradeId].length,
  };
}
