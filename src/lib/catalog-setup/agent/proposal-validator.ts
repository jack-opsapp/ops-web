// PURE proposal validator (plan Task 4.3) — guardrails so no card can hard-fail
// `catalog_setup_save` (spec §16 war-game).
//
// Pipeline per proposal:
//   1. STRUCTURAL gate — parse against the Zod schema (Task 4.2). A shape/enum
//      failure (incl. a dead `tiered_pricing` key, an out-of-list trade) short-
//      circuits to typed errors before any guardrail runs.
//   2. COMMIT-SAFETY guardrails (this file): SELL needs name AND a positive
//      price; a tier ladder must be a `select` with ≥2 tiers whose lowest tier
//      is the base (add_flat 0). STOCK needs a unit_id that RESOLVES in ctx; a
//      recipe must pin a concrete catalog_variant_id KNOWN to ctx (a nil/family
//      pin is silently dropped by RecipeResolver → reject) with positive qty.
//      TYPES' trade must be in the caller-supplied allow-list.
//   3. On success → map the proposal to a StagingCard (the canvas contract,
//      spec §7/§11): UPPERCASE agent module → lowercase StagingCard module,
//      source "agent", state "proposed", a fresh stable client id.
//
// PURE & deterministic except the generated id (injectable for tests). No I/O:
// resolvability is checked against `ValidationContext` the caller supplies
// (Phase 3 pre-resolves vocabulary, spec §11). Error `message` strings are
// operator-facing SEEDS — the `//`/UPPERCASE tactical treatment + ops-copywriter
// phrasing is applied at render, not hardcoded as prose here (spec §13/§14).

import { z } from "zod";
import {
  CatalogProposalSchema,
  type CatalogProposal,
  type ProposalBatch,
  type SellProposal,
  type StockProposal,
  type TypesProposal,
} from "./proposal-schemas";
import type {
  StagingCard,
  SellFields,
  StockFields,
  TypeFields,
} from "../staging-card";

/**
 * Resolvable vocabulary the validator checks references against. PURE — the
 * caller (the agent route / hook) builds these sets from the live catalog (or
 * the Phase-3 pre-resolved/auto-creatable set). No DB access happens here.
 */
export interface ValidationContext {
  /** catalog_unit ids that already exist / will be created before commit. */
  knownUnitIds: ReadonlySet<string>;
  /** catalog_variant ids a recipe may pin to (concrete, resolvable). */
  knownVariantIds: ReadonlySet<string>;
  /** trade tokens allowed for this company (subset of WIZARD_TRADE_IDS). */
  allowedTrades: ReadonlySet<string>;
}

/** One operator-facing validation failure, keyed to the field that failed. */
export interface ValidationError {
  /** the proposal field the operator must fix (renders e.g. "// NEEDS A PRICE") */
  field: string;
  /** seed message; tactical phrasing applied at render via ops-copywriter */
  message: string;
}

/** Result of validating a single proposal: a committable card, or typed errors. */
export type ValidationResult =
  | { ok: true; card: StagingCard }
  | { ok: false; errors: ValidationError[] };

/** Result of validating a batch: the valid cards + the rejected ones with reasons. */
export interface BatchValidationResult {
  cards: StagingCard[];
  rejected: { index: number; errors: ValidationError[] }[];
}

/** Injectable id factory keeps `validateProposal` deterministic in tests. */
export type IdFactory = () => string;

const defaultIdFactory: IdFactory = () =>
  typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `card_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

/** Map a Zod error into per-field validation errors (the structural gate). */
function fromZodError(error: z.ZodError): ValidationError[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "module",
    message: issue.message,
  }));
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// ── Per-module commit-safety guardrails ────────────────────────────────────

function checkSell(p: SellProposal): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isNonBlank(p.name)) {
    errors.push({ field: "name", message: "needs a name" });
  }

  // SELL must price (spec §16 "// 3 ROWS NEED A PRICE"). A positive base price.
  if (typeof p.default_price !== "number" || p.default_price <= 0) {
    errors.push({ field: "default_price", message: "needs a price" });
  }

  // Tier ladder: a select option with ≥2 tiers and a base (lowest tier add_flat 0).
  if (p.options) {
    const values = p.options.values;
    if (values.length < 2) {
      errors.push({
        field: "options",
        message: "a tier ladder needs at least two tiers",
      });
    }
    if (!values.some((v) => v.add_flat === 0)) {
      errors.push({
        field: "options",
        message: "the lowest tier must be the base (add_flat 0)",
      });
    }
    if (values.some((v) => v.add_flat < 0)) {
      errors.push({
        field: "options",
        message: "a tier delta cannot be negative",
      });
    }
  }

  return errors;
}

function checkStock(p: StockProposal, ctx: ValidationContext): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isNonBlank(p.name)) {
    errors.push({ field: "name", message: "needs a name" });
  }

  // A stock variant needs a unit, and it must resolve (RPCs reject unknown unit_id).
  if (!isNonBlank(p.unit_id)) {
    errors.push({ field: "unit_id", message: "needs a unit" });
  } else if (!ctx.knownUnitIds.has(p.unit_id)) {
    errors.push({ field: "unit_id", message: "unit does not resolve" });
  }

  // A recipe must pin a concrete, KNOWN variant (nil/family pin is dropped silently).
  if (p.materials) {
    for (const m of p.materials) {
      if (!ctx.knownVariantIds.has(m.catalog_variant_id)) {
        errors.push({
          field: "materials",
          message: "recipe material must pin a known stock variant",
        });
        break;
      }
    }
    if (p.materials.some((m) => m.qty <= 0)) {
      errors.push({
        field: "materials",
        message: "recipe quantity must be positive",
      });
    }
  }

  return errors;
}

function checkTypes(p: TypesProposal, ctx: ValidationContext): ValidationError[] {
  const errors: ValidationError[] = [];

  // Schema already constrains `trade` to WIZARD_TRADE_IDS; ctx narrows further
  // to the company's allowed subset (spec §9 widened list, §16 trade gate).
  if (!ctx.allowedTrades.has(p.trade)) {
    errors.push({ field: "trade", message: "trade is not allowed" });
  }

  return errors;
}

// ── Proposal → StagingCard mappers (UPPERCASE module → lowercase contract) ───

function toSellCard(p: SellProposal, id: string): StagingCard {
  const fields: SellFields = {
    name: p.name,
    description: p.description,
    defaultPrice: p.default_price,
    unitCost: p.unit_cost ?? null,
    sku: p.sku,
    isTaxable: p.is_taxable,
    kind: p.kind,
    type: p.type,
    pricingUnit: p.pricing_unit,
  };
  return { id, source: "agent", state: "proposed", module: "sell", fields };
}

function toStockCard(p: StockProposal, id: string): StagingCard {
  const fields: StockFields = {
    name: p.name,
    sku: p.sku,
    quantity: p.quantity,
    unitCost: p.unit_cost ?? null,
    reorderPoint: p.reorder_point ?? null,
    unitId: p.unit_id,
  };
  return { id, source: "agent", state: "proposed", module: "stock", fields };
}

function toTypesCard(p: TypesProposal, id: string): StagingCard {
  // A TYPES proposal carries the trade picker selection; the card's `display`
  // holds the trade token (isTrade flag). Per-task_type cards, if surfaced
  // individually, are a Phase-1 concern — the canvas owns that expansion.
  const fields: TypeFields = {
    display: p.trade,
    isTrade: true,
  };
  return { id, source: "agent", state: "proposed", module: "types", fields };
}

function toCard(p: CatalogProposal, id: string): StagingCard {
  switch (p.module) {
    case "SELL":
      return toSellCard(p, id);
    case "STOCK":
      return toStockCard(p, id);
    case "TYPES":
      return toTypesCard(p, id);
  }
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Validate one agent proposal into a committable StagingCard, or typed errors.
 * Structural gate (Zod) → commit-safety guardrails → card mapping.
 */
export function validateProposal(
  proposal: CatalogProposal,
  ctx: ValidationContext,
  idFactory: IdFactory = defaultIdFactory,
): ValidationResult {
  // 1. Structural gate.
  const parsed = CatalogProposalSchema.safeParse(proposal);
  if (!parsed.success) {
    return { ok: false, errors: fromZodError(parsed.error) };
  }
  const p = parsed.data;

  // 2. Commit-safety guardrails.
  let errors: ValidationError[];
  switch (p.module) {
    case "SELL":
      errors = checkSell(p);
      break;
    case "STOCK":
      errors = checkStock(p, ctx);
      break;
    case "TYPES":
      errors = checkTypes(p, ctx);
      break;
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // 3. Card mapping.
  return { ok: true, card: toCard(p, idFactory()) };
}

/**
 * Validate a streamed batch. Valid proposals become cards (each a unique id);
 * invalid ones are aggregated by source index with their reasons — never
 * surfaced as a broken card (spec §10, Task 4.5 "dropped with a logged reason").
 */
export function validateBatch(
  batch: ProposalBatch,
  ctx: ValidationContext,
  idFactory: IdFactory = defaultIdFactory,
): BatchValidationResult {
  // Read the envelope leniently: pull the proposals array and validate EACH
  // proposal independently. A single malformed proposal must NOT drop the valid
  // ones (envelope-level `safeParse` would reject the whole batch on one bad
  // row) — each proposal carries its own structural gate inside validateProposal,
  // and bad rows land in `rejected` with their reasons rather than vanishing.
  const proposals = Array.isArray((batch as { proposals?: unknown })?.proposals)
    ? ((batch as { proposals: unknown[] }).proposals as CatalogProposal[])
    : [];

  const cards: StagingCard[] = [];
  const rejected: { index: number; errors: ValidationError[] }[] = [];

  proposals.forEach((proposal, index) => {
    const result = validateProposal(proposal, ctx, idFactory);
    if (result.ok) {
      cards.push(result.card);
    } else {
      rejected.push({ index, errors: result.errors });
    }
  });

  return { cards, rejected };
}
