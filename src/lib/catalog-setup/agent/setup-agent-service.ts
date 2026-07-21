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
// guardrails, so JSON mode (not a sent schema) is sufficient and maximally
// compatible — a malformed proposal is dropped, never rendered.
//
// In product this is "guided setup" — never labelled "AI" (voice rules). Internal
// engineering names it precisely.

import type OpenAI from "openai";
import {
  getOpenAIForWorkload,
  sanitizeApiKey,
} from "@/lib/api/services/openai-clients";
import { WIZARD_TRADES } from "../trade-list";
import type { ProposalBatch } from "./proposal-schemas";

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

function defaultClient(): OpenAI {
  const apiKey = sanitizeApiKey(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new SetupAgentConfigError("OPENAI_API_KEY is not configured");
  }
  return getOpenAIForWorkload({ workload: "catalog_setup" });
}
