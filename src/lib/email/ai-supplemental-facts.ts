/**
 * OPS Web — AI reviewer facts that fill deterministic holes.
 *
 * The deterministic extractors run first and own every fact they can prove
 * from headers, contact-form payloads, and body patterns. The AI reviewer is
 * only ever allowed to fill a hole they left — it never overrides a proven
 * value. This builds the supplemental fact set for one classified lead.
 *
 * The contact name is the reason this exists: a lead whose sender never sent a
 * display name has no deterministic name at all, so the client row keeps the
 * "New Lead" placeholder forever. The reviewer reads the signature and the
 * body, which is where that customer's real name actually lives.
 */

import {
  leadEnrichmentFactsFromImport,
  type LeadEnrichmentFacts,
} from "./lead-enrichment";
import { isPlaceholderClientName } from "./placeholder-name";

export interface AIClassifiedLeadFactInput {
  clientName: string | null;
  estimatedValue: number | null;
  description: string;
  confidence: number;
}

export function buildAISupplementalLeadFacts(input: {
  deterministicFacts: LeadEnrichmentFacts;
  classified: AIClassifiedLeadFactInput;
  providerThreadId: string | null;
  providerMessageId: string | null;
}): LeadEnrichmentFacts {
  const { deterministicFacts, classified } = input;

  // Defense in depth: the classifier prompt forbids deriving a name from the
  // email address, but a name that echoes the mailbox handle is exactly the
  // value this whole fix exists to remove, so it is dropped here too.
  const reviewerName = (classified.clientName ?? "").trim();
  const usableReviewerName =
    reviewerName &&
    !isPlaceholderClientName(reviewerName, deterministicFacts.contactEmail)
      ? reviewerName
      : null;

  return leadEnrichmentFactsFromImport({
    contactName:
      deterministicFacts.contactName == null ? usableReviewerName : null,
    // Identity anchor, not a new fact: the enrichment guard only accepts a
    // name for the mailbox the fact describes. The deterministic sender is
    // the proven address — the model's own is never trusted for identity.
    contactEmail:
      deterministicFacts.contactName == null && usableReviewerName
        ? deterministicFacts.contactEmail
        : null,
    contactPhone: null,
    address: null,
    estimatedValue:
      deterministicFacts.estimatedValue == null
        ? classified.estimatedValue
        : null,
    description:
      deterministicFacts.description == null ? classified.description : null,
    providerThreadId: input.providerThreadId,
    providerMessageId: input.providerMessageId,
    extractionSource: "ai_classified",
    aiConfidence: classified.confidence,
  });
}

/** True when the reviewer actually contributed something worth persisting. */
export function hasAISupplementalLeadFacts(
  facts: LeadEnrichmentFacts
): boolean {
  return (
    facts.contactName != null ||
    facts.estimatedValue != null ||
    facts.description != null
  );
}
