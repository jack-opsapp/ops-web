import { describe, expect, it } from "vitest";
import { isContactFormReviewCandidate } from "@/lib/email/contact-form-lead-gate";
import type { LeadEnrichmentFacts } from "@/lib/email/lead-enrichment";

const facts: LeadEnrichmentFacts = {
  contactName: null,
  companyName: null,
  contactEmail: null,
  contactPhone: null,
  address: null,
  estimatedValue: null,
  description: null,
  source: "email",
  sourcePlatform: "Wix",
  providerThreadId: "thread",
  providerMessageId: "message",
  extractionSource: "inbound_sender",
};

describe("contact-form review retention", () => {
  it("does not turn platform identity into form evidence", () => {
    expect(
      isContactFormReviewCandidate({
        contactFormSubmitter: null,
        enrichmentFacts: facts,
      })
    ).toBe(false);
  });

  it("retains an uncertain parsed form even without a reachable customer", () => {
    expect(
      isContactFormReviewCandidate({
        contactFormSubmitter: {
          name: "Michael",
          email: "",
          phone: null,
          message: "The installed railing is loose.",
          address: null,
          company: null,
          estimatedValue: null,
        },
        enrichmentFacts: facts,
      })
    ).toBe(true);
  });

  it("retains forwarded form provenance after submitter identity is folded into facts", () => {
    expect(
      isContactFormReviewCandidate({
        contactFormSubmitter: null,
        enrichmentFacts: { ...facts, extractionSource: "contact_form" },
      })
    ).toBe(true);
  });
});
