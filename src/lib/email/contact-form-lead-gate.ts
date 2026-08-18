/**
 * OPS Web - Contact-form lead gate
 *
 * A submission from the company's own website contact form is a lead by
 * construction: a human filled in a form asking to be contacted. Routing those
 * through `AISyncReviewer` puts a probabilistic verdict in front of a fact —
 * and a sub-threshold verdict there is terminal, because the reviewer keeps
 * only the emails it scores as leads and the mailbox cursor then advances past
 * the rest. A single unlucky classification silently loses a real customer.
 *
 * This module claims those submissions before the reviewer ever sees them, so
 * the deterministic parse is the authority and the model is left to judge only
 * genuinely ambiguous mail.
 */

import type { AIClassifiedLead } from "@/lib/api/services/ai-sync-reviewer";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import type { LeadEnrichmentFacts } from "@/lib/email/lead-enrichment";
import type { ContactFormSubmissionIdentity } from "@/lib/utils/email-parsing";

/**
 * The subset of the sync engine's unmatched-inbound context this gate needs.
 * Kept structural so the gate stays independently testable and does not import
 * the sync engine back into itself.
 */
export interface ContactFormLeadGateContext {
  email: NormalizedEmail;
  contactFormSubmitter: ContactFormSubmissionIdentity | null;
  enrichmentFacts: LeadEnrichmentFacts;
}

/** The customer address the reply will actually go to, or null if unreachable. */
function reachableCustomerEmail(
  context: ContactFormLeadGateContext
): string | null {
  const fromFacts = context.enrichmentFacts.contactEmail?.trim();
  if (fromFacts) return fromFacts;
  const fromSubmitter = context.contactFormSubmitter?.email?.trim();
  return fromSubmitter ? fromSubmitter : null;
}

/**
 * True when this inbound message is a website contact-form submission whose
 * customer we can actually reach.
 *
 * Either signal is sufficient. A discrete submitter record proves the form
 * parse succeeded; `extractionSource === "contact_form"` proves the same thing
 * on the forwarded-sender path, which resolves the customer identity into the
 * enrichment facts without always retaining the submitter separately.
 *
 * A submission we cannot reply to is deliberately left to the ordinary path —
 * creating an unreachable lead helps nobody and hides the parse failure.
 */
export function isDeterministicContactFormLead(
  context: ContactFormLeadGateContext
): boolean {
  const isSubmission =
    context.contactFormSubmitter !== null ||
    context.enrichmentFacts.extractionSource === "contact_form";
  if (!isSubmission) return false;
  return reachableCustomerEmail(context) !== null;
}

/**
 * Build the lead record for a contact-form submission from the deterministic
 * parse. Shaped as an `AIClassifiedLead` so it flows through exactly the same
 * persistence path as a model-classified lead — same enrichment, same
 * correspondence events, same projections — with no second code path to drift.
 *
 * Returns null when the context is not a reachable submission.
 */
export function buildDeterministicContactFormLead(
  context: ContactFormLeadGateContext
): AIClassifiedLead | null {
  if (!isDeterministicContactFormLead(context)) return null;

  const { enrichmentFacts: facts, contactFormSubmitter: submitter } = context;

  return {
    email: context.email,
    clientName: facts.contactName ?? submitter?.name ?? null,
    clientEmail: reachableCustomerEmail(context),
    clientPhone: facts.contactPhone ?? submitter?.phone ?? null,
    address: facts.address ?? submitter?.address ?? null,
    description: facts.description ?? submitter?.message ?? "",
    // A fresh submission has no negotiating history to infer a stage from, and
    // no terminal outcome to guess at.
    stage: "new_lead",
    terminalFlag: null,
    estimatedValue: facts.estimatedValue ?? submitter?.estimatedValue ?? null,
    // Provenance, not a model score: the submission itself is the evidence.
    confidence: 1,
  };
}

/**
 * Split unmatched inbound into the submissions this gate claims outright and
 * the remainder the AI reviewer should judge. Provider order is preserved
 * within each partition so downstream processing stays deterministic across
 * retries.
 */
export function partitionUnmatchedLeadContexts<
  T extends ContactFormLeadGateContext,
>(contexts: readonly T[]): { deterministicContexts: T[]; aiCandidateContexts: T[] } {
  const deterministicContexts: T[] = [];
  const aiCandidateContexts: T[] = [];

  for (const context of contexts) {
    if (isDeterministicContactFormLead(context)) {
      deterministicContexts.push(context);
    } else {
      aiCandidateContexts.push(context);
    }
  }

  return { deterministicContexts, aiCandidateContexts };
}
