// PURE Zod schemas for the Setup Agent's structured proposals (plan Task 4.2).
//
// The agent emits proposals in three UPPERCASE module shapes that mirror the
// live tables (spec §9) and the `catalog_setup_save` commit payload (spec §11),
// so an accepted card commits without a transform. These schemas are the
// STRUCTURAL gate: a proposal that can't parse here can never become a
// StagingCard. The commit-safety guardrails (resolvability, base = lowest tier,
// concrete recipe pins) live in `proposal-validator.ts` (Task 4.3) — this file
// only enforces shape + enums + presence.
//
// DELIBERATELY SELF-CONTAINED: no import from the overhaul-branch `catalog.ts`
// so the wizard compiles standalone before the rebase (spec §18). The module
// discriminant is UPPERCASE here (agent vocabulary, spec §9/§10); the
// StagingCard contract uses lowercase — the validator bridges the two.
//
// INTEGRATION: align field names with the real Phase-1 CatalogCard / Phase-3
// `catalog_setup_save` payload after the rebase. No extra fields are invented
// beyond spec §9/§11.
//
// `tiered_pricing` is STRUCTURALLY IMPOSSIBLE: there is no field for it and
// every object is `.strict()`, so the dead column (spec §9 "never
// tiered_pricing"; spec §4 pricing contract) can never round-trip.

import { z } from "zod";
import { WIZARD_TRADE_IDS } from "../trade-list";

/** Module discriminant — agent vocabulary, UPPERCASE (spec §9). */
export const ProposalModuleSchema = z.enum(["SELL", "STOCK", "TYPES"]);
export type ProposalModule = z.infer<typeof ProposalModuleSchema>;

/** SELL product kind (spec §9 → products.kind). */
export const SellKindSchema = z.enum(["service", "material", "package"]);

/** SELL estimate type bucket (spec §9 → products.type). */
export const SellTypeSchema = z.enum(["LABOR", "MATERIAL", "OTHER"]);

/**
 * The guided tier ladder (spec §4, §9): a `select` option whose values carry a
 * flat delta. Base = the lowest tier (a value with `add_flat === 0`); size
 * deltas write `add_flat` `product_pricing_modifiers`. This is the ONLY shape
 * the wizard exposes — `kind` is locked to the literal `"select"` so a raw
 * integer/boolean option (full power-user matrix, spec §2 non-goals) can't
 * sneak through, and there is NO `tiered_pricing` anywhere.
 */
export const TierOptionSchema = z
  .object({
    kind: z.literal("select"),
    /** option label, e.g. "Size" */
    label: z.string().min(1),
    values: z
      .array(
        z
          .object({
            label: z.string().min(1),
            /** flat delta over the base tier; lowest tier is 0 */
            add_flat: z.number(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type TierOption = z.infer<typeof TierOptionSchema>;

/**
 * A recipe material (spec §9 STOCK): MUST pin a concrete `catalog_variant_id`.
 * A nil/family-pinned selector is silently dropped by `RecipeResolver`
 * (memory: iOS option/tier/variant read-path), so the id is required here and
 * its existence is checked by the validator against ctx.
 */
export const RecipeMaterialSchema = z
  .object({
    catalog_variant_id: z.string().min(1),
    qty: z.number(),
  })
  .strict();
export type RecipeMaterial = z.infer<typeof RecipeMaterialSchema>;

/** SELL → products (spec §9 SELL). default_price maps to products.base_price. */
export const SellProposalSchema = z
  .object({
    module: z.literal("SELL"),
    name: z.string().min(1),
    description: z.string().optional(),
    /** products.base_price; the spec calls the input "default_price" */
    default_price: z.number(),
    unit_cost: z.number().optional(),
    sku: z.string().optional(),
    is_taxable: z.boolean(),
    kind: SellKindSchema,
    type: SellTypeSchema,
    pricing_unit: z.string().optional(),
    /** optioned/tiered ladder — base = lowest tier, deltas via add_flat */
    options: TierOptionSchema.optional(),
  })
  .strict();
export type SellProposal = z.infer<typeof SellProposalSchema>;

/** STOCK → catalog_items family + catalog_variants (spec §9 STOCK). */
export const StockProposalSchema = z
  .object({
    module: z.literal("STOCK"),
    name: z.string().min(1),
    sku: z.string().optional(),
    /** on-hand */
    quantity: z.number(),
    unit_cost: z.number().optional(),
    /** single reorder point → fans into warning + critical thresholds */
    reorder_point: z.number().optional(),
    unit_id: z.string().optional(),
    /** recipe that draws this stock down on sale (product_materials) */
    materials: z.array(RecipeMaterialSchema).optional(),
  })
  .strict();
export type StockProposal = z.infer<typeof StockProposalSchema>;

/** A single task_type within a TYPES proposal (spec §9 → task_types). */
export const TaskTypeProposalSchema = z
  .object({
    display: z.string().min(1),
    color: z.string().optional(),
    is_default: z.boolean().optional(),
    display_order: z.number().optional(),
  })
  .strict();
export type TaskTypeProposal = z.infer<typeof TaskTypeProposalSchema>;

/**
 * TYPES → trade picker + task_types (spec §9 TYPES). `trade` is the widened
 * allowed token list (single source of truth: WIZARD_TRADE_IDS / trade-list.ts,
 * shared with the `projects.trade` CHECK migration). Schema rejects any token
 * outside the list; the validator additionally checks it against ctx.
 */
export const TypesProposalSchema = z
  .object({
    module: z.literal("TYPES"),
    trade: z.enum(WIZARD_TRADE_IDS),
    task_types: z.array(TaskTypeProposalSchema).optional(),
  })
  .strict();
export type TypesProposal = z.infer<typeof TypesProposalSchema>;

/** Discriminated union over the module key — the structural gate. */
export const CatalogProposalSchema = z.discriminatedUnion("module", [
  SellProposalSchema,
  StockProposalSchema,
  TypesProposalSchema,
]);
export type CatalogProposal = z.infer<typeof CatalogProposalSchema>;

/** A streamed batch of proposals (what the agent route emits, spec §10). */
export const ProposalBatchSchema = z
  .object({
    proposals: z.array(CatalogProposalSchema),
  })
  .strict();
export type ProposalBatch = z.infer<typeof ProposalBatchSchema>;
