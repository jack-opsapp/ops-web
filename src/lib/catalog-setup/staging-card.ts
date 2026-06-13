// Pure, framework-free model for the catalog-setup live-building canvas.
// Every source (import / agent / template / manual) produces StagingCards;
// the canvas renders one surface so the operator never sees the
// products-vs-catalog-items table split (spec §5, §7, §8).
//
// SELF-CONTAINED on purpose: this module imports nothing from the
// overhaul-branch `catalog.ts` so the wizard compiles standalone before the
// rebase. Field names mirror the live tables per spec §9; align to the real
// `catalog.ts` after the rebase.

/** Which module a card belongs to (spec §5, §9). */
export type ModuleKey = "sell" | "stock" | "types";

/** Where a card originated (spec §8 sources table). */
export type CardSource = "import" | "agent" | "template" | "manual";

/**
 * Lifecycle of a single staged row.
 * - proposed: surfaced, not yet acted on (default for import/agent/template)
 * - accepted: owner accepted as-is → counts toward "added"
 * - edited:   owner changed fields then accepted → counts toward "added"
 * - rejected: owner dismissed → never committed
 * - merge:    matched an existing catalog row; resolves into the live row on commit (spec §11 dedupe)
 */
export type CardState = "proposed" | "accepted" | "edited" | "rejected" | "merge";

/** A card whose owner accept/edit/merge action will be committed (spec §11). */
export const COMMITTABLE_STATES: readonly CardState[] = [
  "accepted",
  "edited",
  "merge",
];

/** SELL → products (spec §9 SELL). defaultPrice maps to products.base_price. */
export interface SellFields {
  name: string;
  description?: string;
  /** products.base_price (the spec calls the input "default_price") */
  defaultPrice: number | null;
  unitCost: number | null;
  sku?: string;
  isTaxable: boolean;
  kind: "service" | "material" | "package";
  /** estimate type bucket */
  type: "LABOR" | "MATERIAL" | "OTHER";
  pricingUnit?: string;
}

/** STOCK → catalog_items/variants (spec §9 STOCK). */
export interface StockFields {
  name: string;
  sku?: string;
  /** on-hand */
  quantity: number | null;
  unitCost: number | null;
  /** single reorder point — fans into warning + agent-derived critical later */
  reorderPoint: number | null;
  unitId?: string;
}

/** TYPES → trade picker + task_types (spec §9 TYPES). */
export interface TypeFields {
  /** task_types.display, or the trade value when isTrade */
  display: string;
  color?: string;
  isTrade?: boolean;
}

interface BaseCard {
  /** client-supplied stable id — becomes the commit client id (spec §11) */
  id: string;
  source: CardSource;
  state: CardState;
  /** present when this card matched a live catalog row (spec §11 dedupe) */
  matchedExistingId?: string;
}

export type StagingCard =
  | (BaseCard & { module: "sell"; fields: SellFields })
  | (BaseCard & { module: "stock"; fields: StockFields })
  | (BaseCard & { module: "types"; fields: TypeFields });

export type CardFieldsFor<M extends ModuleKey> = Extract<
  StagingCard,
  { module: M }
>["fields"];

/** Running counters for the canvas header (spec §7 "N proposed · M added"). */
export interface RunningTotals {
  proposed: number;
  /** accepted + edited + merge */
  added: number;
  rejected: number;
}
