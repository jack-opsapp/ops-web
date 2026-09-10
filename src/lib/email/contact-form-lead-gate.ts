import type { LeadEnrichmentFacts } from "@/lib/email/lead-enrichment";
import type { ContactFormSubmissionIdentity } from "@/lib/utils/email-parsing";

/** A parsed form is a reason to preserve an uncertain message, not create a lead. */
export function isContactFormReviewCandidate(context: {
  contactFormSubmitter: ContactFormSubmissionIdentity | null;
  enrichmentFacts: LeadEnrichmentFacts;
}): boolean {
  return (
    context.contactFormSubmitter !== null ||
    context.enrichmentFacts.extractionSource === "contact_form"
  );
}
