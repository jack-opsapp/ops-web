// The always-on Setup Agent's generation call (plan Phase 4). Turns a trades
// owner's plain description of their business into structured catalog proposals
// that the pure validator (proposal-validator.ts) turns into accept/edit/reject
// staging cards. The agent NEVER writes — the owner approves every row and the
// commit still goes through catalog_setup_save (Phase 3).
//
// Provider: OpenAI via the already-installed `openai` SDK (chat completions, JSON
// mode). Kept provider-agnostic at the seam — the route consumes a ProposalBatch
// and never sees the provider, so swapping models/providers is a one-file change.
// Output is validated downstream by the strict Zod schema + commit-safety
// guardrails. Guided turns receive that contract in their prompt and use JSON
// mode because their union plus supplier-specific payloads exceed the
// provider's strict Structured Outputs subset. Malformed output is rejected
// before a durable session update.
//
// In product this is "guided setup" — never labelled "AI" (voice rules). Internal
// engineering names it precisely.

import type OpenAI from "openai";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  getOpenAIForWorkload,
  sanitizeApiKey,
} from "@/lib/api/services/openai-clients";
import { WIZARD_TRADES } from "../trade-list";
import type { ProposalBatch } from "./proposal-schemas";
import { CatalogAgentTurnSchema } from "../phase-c/schemas";
import { validateCatalogAgentTurn } from "../phase-c/semantic-validator";
import type {
  CatalogAgentTurn,
  CatalogFact,
  GuidedQuestion,
} from "../phase-c/types";

/** Env-overridable model — defaults to the current OpenAI flagship. */
export const DEFAULT_CATALOG_MODEL =
  process.env.OPENAI_CATALOG_MODEL ?? "gpt-5.5";

export interface GenerateCatalogParams {
  /** The owner's free-text description of what their business sells. */
  description: string;
  /** Optional prior turn context (the owner's earlier answers), oldest first. */
  priorTurns?: string[];
  /** Override the model (else DEFAULT_CATALOG_MODEL). */
  model?: string;
  /** Injectable client for tests; falls back to a key-bound singleton. */
  client?: Pick<OpenAI, "chat">;
}

export class SetupAgentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupAgentConfigError";
  }
}

export class SetupAgentOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupAgentOutputError";
  }
}

export interface GenerateGuidedCatalogTurnParams {
  answer: unknown;
  facts: CatalogFact[];
  contradictions: Array<Record<string, unknown>>;
  currentQuestion: GuidedQuestion | null;
  liveSnapshotSummary: Record<string, unknown>;
  verifiedReference: Record<string, unknown>;
  model?: string;
  client?: Pick<OpenAI, "chat">;
}

const TRADE_TOKENS = WIZARD_TRADES.map((t) => `${t.id} (${t.label})`).join(
  ", "
);

/**
 * The generation contract. Deliberately steers the model to the price book
 * (SELL) + a single best-fit trade (TYPES) — the clean, ctx-free first-run
 * output. STOCK is omitted on a fresh catalog (the model can't know the
 * company's real unit/variant ids), and the validator drops any that slip
 * through. No `tiered_pricing` exists in the shape, so it can never round-trip.
 */
function systemPrompt(): string {
  return [
    "You set up the price book for a trades/service business (roofing, HVAC, plumbing, etc.).",
    "Given the owner's description, return realistic line items they can charge for.",
    "",
    'Respond with JSON only, shaped exactly: { "proposals": [ ... ] }.',
    "",
    "Each proposal is one of these objects:",
    "",
    "SELL (a thing they charge for — the priority; generate 6–20 of these):",
    '  { "module": "SELL", "name": string, "default_price": number (the base price, > 0),',
    '    "unit_cost"?: number, "sku"?: string, "is_taxable": boolean,',
    '    "kind": "service" | "material" | "package", "type": "LABOR" | "MATERIAL" | "OTHER",',
    '    "pricing_unit"?: string (e.g. "each", "sq ft", "hour"),',
    '    "options"?: { "kind": "select", "label": string,',
    '       "values": [ { "label": string, "add_flat": number } ] } }',
    "  Use options ONLY for size/tier pricing: the lowest tier MUST have add_flat 0",
    "  (it is the base), and every other tier is its flat add-on over that base.",
    "",
    "TYPES (the owner's trade — include AT MOST ONE, the best fit):",
    `  { "module": "TYPES", "trade": one of [${TRADE_TOKENS}] }`,
    "",
    "Rules:",
    "- Lead with SELL line items that match the described trade. Prices realistic for the work.",
    "- kind: service for labor/install, material for goods sold, package for bundled jobs.",
    "- type: LABOR for service, MATERIAL for goods, OTHER otherwise.",
    "- Do NOT propose inventory/stock items, recipes, or task types beyond the single trade.",
    "- No commentary, no markdown — JSON object only.",
  ].join("\n");
}

function guidedSystemPrompt(): string {
  return [
    "You are the Phase C catalog setup specialist for OPS.",
    "Your job is to understand a trades business and propose a complete quoting, product-option, material, purchasing, inventory, and task system.",
    "You never write data. You return either one high-value question or one exact review blueprint.",
    "",
    "Decision policy:",
    "- Read the supplied live company snapshot before asking anything.",
    "- Treat verified supplier reference as facts, but never invent missing SKUs, costs, dimensions, coverage, IDs, or compatibility.",
    "- Ask exactly one question when a decision that affects structure or pricing is unresolved.",
    "- Do not ask what live OPS data, prior confirmed facts, or verified supplier data already answers.",
    "- Confirm contradictions instead of silently choosing one answer.",
    "- Separate customer products/options from staff-only choices, quote disclosures, purchasing rules, inventory rules, labor, task behavior, and specialized-tool inputs.",
    "- Documents are optional evidence, never a prerequisite. Never ask the operator to upload a file; continue through short conversational questions.",
    "- Capture inventory policy and units, but do not ask for opening stock counts or an inventory file during catalog setup. Opening inventory is a separate post-commit import and starts at zero.",
    "- A staff-only choice must never become a customer product option.",
    "- Reuse verified live IDs. New records use stable lowercase client IDs, never invented UUIDs.",
    "- A reviewable product action must explicitly carry name, basePrice, pricingUnit, minimumCharge (number or null), isTaxable, showInStorefront, and a verified task type ID/client reference.",
    "- For a DekSmart vinyl review, include exactly two product actions: the normal 68mil install and the staff-selectable 60mil exception. Each must include unitCost. Include the GST and Vinyl Install task-type actions. Verified supplier families, colors, materials, costs, compatibility, and purchasing rules are reconciled deterministically after your response.",
    "- Unknown values stay unresolved. A blueprint with a blocker is never ready.",
    "",
    "Return JSON only and obey the supplied strict response schema.",
  ].join("\n");
}

/**
 * Generate catalog proposals from a description. Returns a ProposalBatch (the
 * envelope the validator reads); a parse/transport failure yields an empty batch
 * so the caller degrades to "no proposals" rather than throwing into the UI.
 * A MISSING API key throws SetupAgentConfigError (a setup problem, surfaced as
 * the route's "guided setup is unavailable" fallback — distinct from a generation
 * miss).
 */
export async function generateCatalogProposals(
  params: GenerateCatalogParams
): Promise<ProposalBatch> {
  const client = params.client ?? defaultClient();
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt() },
    ...(params.priorTurns ?? []).map(
      (t): OpenAI.Chat.ChatCompletionMessageParam => ({
        role: "user",
        content: t,
      })
    ),
    { role: "user", content: params.description },
  ];

  const completion = await client.chat.completions.create({
    model: params.model ?? DEFAULT_CATALOG_MODEL,
    response_format: { type: "json_object" },
    messages,
  });

  const content = completion.choices[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(content) as unknown;
    const proposals =
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as ProposalBatch).proposals)
        ? (parsed as ProposalBatch).proposals
        : [];
    return { proposals };
  } catch {
    return { proposals: [] };
  }
}

export async function generateGuidedCatalogTurn(
  params: GenerateGuidedCatalogTurnParams,
): Promise<CatalogAgentTurn> {
  const client = params.client ?? defaultClient();
  const jsonSchema = zodToJsonSchema(
    CatalogAgentTurnSchema,
    "CatalogAgentTurn",
  );
  const completion = await client.chat.completions.create({
    model: params.model ?? DEFAULT_CATALOG_MODEL,
    // Catalog action payloads intentionally carry supplier-specific JSON, and
    // the turn itself is a top-level discriminated union. Those shapes exceed
    // the provider's strict Structured Outputs subset. JSON mode keeps the call
    // compatible; the complete Zod-derived contract is still supplied to the
    // model and every response is rejected unless our strict validator accepts
    // it before any durable session update.
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: guidedSystemPrompt() },
      {
        role: "user",
        content: JSON.stringify({
          currentQuestion: params.currentQuestion,
          answer: params.answer,
          confirmedFacts: params.facts,
          contradictions: params.contradictions,
          liveCatalog: params.liveSnapshotSummary,
          verifiedSupplierReference: params.verifiedReference,
          responseSchema: jsonSchema,
        }),
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new SetupAgentOutputError("Invalid guided setup response: empty");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new SetupAgentOutputError(
      "Invalid guided setup response: malformed JSON",
    );
  }
  const validated = validateCatalogAgentTurn(raw);
  if (!validated.success || !validated.turn) {
    throw new SetupAgentOutputError(
      `Invalid guided setup response: ${validated.issues
        .map((issue) => issue.message)
        .join(" · ")}`,
    );
  }
  return validated.turn;
}

function defaultClient(): OpenAI {
  const apiKey = sanitizeApiKey(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new SetupAgentConfigError("OPENAI_API_KEY is not configured");
  }
  return getOpenAIForWorkload({ workload: "catalog_setup" });
}
