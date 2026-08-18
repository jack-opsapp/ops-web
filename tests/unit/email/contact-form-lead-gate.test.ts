import { describe, expect, it } from "vitest";

import {
  buildDeterministicContactFormLead,
  isDeterministicContactFormLead,
  partitionUnmatchedLeadContexts,
  type ContactFormLeadGateContext,
} from "@/lib/email/contact-form-lead-gate";
import type { LeadEnrichmentFacts } from "@/lib/email/lead-enrichment";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";

function email(id: string, overrides: Partial<NormalizedEmail> = {}) {
  return {
    id,
    threadId: `thread-${id}`,
    from: "Curtis Radley <radleycurtis@hotmail.com>",
    fromName: "Curtis Radley",
    to: ["canprojack@gmail.com"],
    cc: [],
    subject: "Fwd: Free Quote form got a new submission",
    snippet: "A site visitor just submitted your form",
    bodyText: "Submission summary: Name: Curtis Radley",
    date: new Date("2026-08-18T00:58:15Z"),
    labelIds: ["INBOX"],
    ...overrides,
  } as unknown as NormalizedEmail;
}

function facts(overrides: Partial<LeadEnrichmentFacts> = {}): LeadEnrichmentFacts {
  return {
    contactName: "Curtis Radley",
    companyName: null,
    contactEmail: "radleycurtis@hotmail.com",
    contactPhone: "2505889941",
    address: "Cordova Bay, Victoria BC",
    estimatedValue: null,
    description: "Looking for some aluminum railings for my deck and front porch.",
    source: "website" as LeadEnrichmentFacts["source"],
    sourcePlatform: null,
    providerThreadId: "thread-m1",
    providerMessageId: "m1",
    extractionSource: "contact_form",
    ...overrides,
  } as LeadEnrichmentFacts;
}

function context(
  overrides: Partial<ContactFormLeadGateContext> = {}
): ContactFormLeadGateContext {
  return {
    email: email("m1"),
    contactFormSubmitter: {
      name: "Curtis Radley",
      email: "radleycurtis@hotmail.com",
      phone: "2505889941",
      message: "Looking for some aluminum railings.",
      address: "Cordova Bay, Victoria BC",
      company: null,
      estimatedValue: null,
    },
    enrichmentFacts: facts(),
    ...overrides,
  } as ContactFormLeadGateContext;
}

describe("contact-form lead gate", () => {
  it("treats a parsed contact-form submission as a deterministic lead", () => {
    expect(isDeterministicContactFormLead(context())).toBe(true);
  });

  it("treats contact_form extraction as deterministic even without a submitter", () => {
    // The forwarded-sender path can resolve the customer identity into the
    // enrichment facts without retaining a discrete submitter record.
    const ctx = context({ contactFormSubmitter: null });
    expect(isDeterministicContactFormLead(ctx)).toBe(true);
  });

  it("does not claim ordinary inbound mail", () => {
    const ctx = context({
      contactFormSubmitter: null,
      enrichmentFacts: facts({ extractionSource: "inbound_sender" }),
    });
    expect(isDeterministicContactFormLead(ctx)).toBe(false);
  });

  it("does not claim a submission with no reachable customer address", () => {
    const ctx = context({
      contactFormSubmitter: null,
      enrichmentFacts: facts({ contactEmail: null }),
    });
    expect(isDeterministicContactFormLead(ctx)).toBe(false);
  });

  it("builds a lead carrying the deterministic customer identity", () => {
    const lead = buildDeterministicContactFormLead(context());
    expect(lead).not.toBeNull();
    expect(lead!.clientEmail).toBe("radleycurtis@hotmail.com");
    expect(lead!.clientName).toBe("Curtis Radley");
    expect(lead!.clientPhone).toBe("2505889941");
    expect(lead!.address).toBe("Cordova Bay, Victoria BC");
    expect(lead!.email.id).toBe("m1");
  });

  it("opens a deterministic lead at new_lead with no terminal guess", () => {
    const lead = buildDeterministicContactFormLead(context());
    expect(lead!.stage).toBe("new_lead");
    expect(lead!.terminalFlag).toBeNull();
  });

  it("records full confidence — the submission is proof, not a model guess", () => {
    const lead = buildDeterministicContactFormLead(context());
    expect(lead!.confidence).toBe(1);
  });

  it("keeps contact-form submissions away from the AI reviewer entirely", () => {
    const form = context();
    const ordinary = context({
      email: email("m2"),
      contactFormSubmitter: null,
      enrichmentFacts: facts({
        extractionSource: "inbound_sender",
        providerMessageId: "m2",
      }),
    });

    const { deterministicContexts, aiCandidateContexts } =
      partitionUnmatchedLeadContexts([form, ordinary]);

    expect(deterministicContexts.map((c) => c.email.id)).toEqual(["m1"]);
    expect(aiCandidateContexts.map((c) => c.email.id)).toEqual(["m2"]);
  });

  it("preserves provider order within each partition", () => {
    const a = context({ email: email("a") });
    const b = context({
      email: email("b"),
      contactFormSubmitter: null,
      enrichmentFacts: facts({ extractionSource: "inbound_sender" }),
    });
    const c = context({ email: email("c") });

    const { deterministicContexts, aiCandidateContexts } =
      partitionUnmatchedLeadContexts([a, b, c]);

    expect(deterministicContexts.map((x) => x.email.id)).toEqual(["a", "c"]);
    expect(aiCandidateContexts.map((x) => x.email.id)).toEqual(["b"]);
  });
});
