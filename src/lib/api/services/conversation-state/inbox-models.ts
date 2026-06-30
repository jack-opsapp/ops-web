// src/lib/api/services/conversation-state/inbox-models.ts
//
// Centralized model selection for the inbox/email AI engine.
//
// POLICY (Jackson, 2026-06-29): OpenAI single-provider, quality-first. Default
// every concern to the HIGHEST-END model and step DOWN only after confirming
// where quality holds — never start cheap. Because every AI call site reads
// from here, regressing a model to find the sweet spot is a one-line change,
// not a call-site hunt. See memory `feedback-inbox-engine-openai-quality-first`
// and docs/inbox/clean-state-layer-spec.md.
//
// Today the pipeline scatters cheap `gpt-4o-mini` / `gpt-5.4-mini` across call
// sites. As each AI step is migrated onto the clean-state layer, point it here.
//
// NOTE: `gpt-5.4` is the confirmed-available flagship on the OPS account (the
// pipeline already uses `gpt-5.4-mini`). `gpt-5.5` is the newer ceiling — verify
// the exact id + vision support on the account before bumping these up to it.

/** The top model we start every concern at. Regress per-concern below if quality holds. */
const TOP = "gpt-5.4" as const;

export const INBOX_MODELS = {
  /** Thread/lead classification (customer vs internal, category, ball-in-court). */
  classify: TOP,
  /** Reply drafting in the operator's voice. */
  draft: TOP,
  /** Vision inspection of customer photos / diagrams / signed-estimate PDFs. */
  attachmentVision: TOP,
  /** Parsing nuanced accept/won language the deterministic detector flags as ambiguous. */
  acceptParse: TOP,
} as const;

export type InboxModelConcern = keyof typeof INBOX_MODELS;

/** Resolve the model for a concern. Indirection point for future per-tenant overrides. */
export function inboxModel(concern: InboxModelConcern): string {
  return INBOX_MODELS[concern];
}
