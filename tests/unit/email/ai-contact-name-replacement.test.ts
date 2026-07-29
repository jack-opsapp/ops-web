import { describe, expect, it } from "vitest";
import {
  buildLeadEnrichmentUpdates,
  leadEnrichmentFactsFromImport,
  type LeadEnrichmentFacts,
} from "@/lib/email/lead-enrichment";

const CLIENT_EMAIL = "canprojack@gmail.com";

function aiFacts(
  overrides: {
    contactName?: string | null;
    contactEmail?: string | null;
    aiConfidence?: number | null;
  } = {}
): LeadEnrichmentFacts {
  return leadEnrichmentFactsFromImport({
    contactName: overrides.contactName ?? "Cecilia Reyes",
    contactEmail:
      overrides.contactEmail === undefined
        ? CLIENT_EMAIL
        : overrides.contactEmail,
    extractionSource: "ai_classified",
    aiConfidence:
      overrides.aiConfidence === undefined ? 0.9 : overrides.aiConfidence,
    providerThreadId: "thread-1",
    providerMessageId: "message-1",
  });
}

function protection(clientFields: string[]) {
  return {
    opportunity: new Set<string>(),
    client: new Set<string>(clientFields),
    opportunityEvidence: new Map(),
    clientEvidence: new Map(),
  };
}

describe("AI-sourced contact-name replacement", () => {
  it("replaces a handle-derived client name", () => {
    const { client } = buildLeadEnrichmentUpdates({
      existingClient: { name: "canprojack", email: CLIENT_EMAIL },
      facts: aiFacts(),
    });
    expect(client.name).toBe("Cecilia Reyes");
  });

  it("replaces the New Lead placeholder", () => {
    const { client } = buildLeadEnrichmentUpdates({
      existingClient: { name: "New Lead", email: CLIENT_EMAIL },
      facts: aiFacts(),
    });
    expect(client.name).toBe("Cecilia Reyes");
  });

  it("never replaces a real business name", () => {
    const { client } = buildLeadEnrichmentUpdates({
      existingClient: { name: "Bob's Roofing", email: CLIENT_EMAIL },
      facts: aiFacts(),
    });
    expect(client.name).toBeUndefined();
  });

  it("never replaces a real person name", () => {
    const { client } = buildLeadEnrichmentUpdates({
      existingClient: { name: "Cecilia Reyes", email: CLIENT_EMAIL },
      facts: aiFacts({ contactName: "Cece Reyes" }),
    });
    expect(client.name).toBeUndefined();
  });

  it("never replaces an operator-protected name", () => {
    const { client } = buildLeadEnrichmentUpdates({
      existingClient: { name: "canprojack", email: CLIENT_EMAIL },
      facts: aiFacts(),
      protectedFields: protection(["contact_name"]),
    });
    expect(client.name).toBeUndefined();
  });

  it("never replaces when the fact describes a different mailbox", () => {
    const { client } = buildLeadEnrichmentUpdates({
      existingClient: { name: "canprojack", email: CLIENT_EMAIL },
      facts: aiFacts({ contactEmail: "someone.else@gmail.com" }),
    });
    expect(client.name).toBeUndefined();
  });

  it("never replaces below the confidence floor", () => {
    const { client } = buildLeadEnrichmentUpdates({
      existingClient: { name: "canprojack", email: CLIENT_EMAIL },
      facts: aiFacts({ aiConfidence: 0.79 }),
    });
    expect(client.name).toBeUndefined();
  });

  it("replaces exactly at the confidence floor", () => {
    const { client } = buildLeadEnrichmentUpdates({
      existingClient: { name: "canprojack", email: CLIENT_EMAIL },
      facts: aiFacts({ aiConfidence: 0.8 }),
    });
    expect(client.name).toBe("Cecilia Reyes");
  });

  it("never replaces when the model reported no confidence", () => {
    const { client } = buildLeadEnrichmentUpdates({
      existingClient: { name: "canprojack", email: CLIENT_EMAIL },
      facts: aiFacts({ aiConfidence: null }),
    });
    expect(client.name).toBeUndefined();
  });

  it("still lets verified inbound evidence replace a handle-derived name", () => {
    const facts: LeadEnrichmentFacts = {
      ...aiFacts(),
      extractionSource: "inbound_sender",
      aiConfidence: null,
    };
    const { client } = buildLeadEnrichmentUpdates({
      existingClient: { name: "canprojack", email: CLIENT_EMAIL },
      facts,
    });
    expect(client.name).toBe("Cecilia Reyes");
  });

  it("still refuses verified inbound evidence for a different mailbox", () => {
    const facts: LeadEnrichmentFacts = {
      ...aiFacts({ contactEmail: "someone.else@gmail.com" }),
      extractionSource: "inbound_sender",
      aiConfidence: null,
    };
    const { client } = buildLeadEnrichmentUpdates({
      existingClient: { name: "canprojack", email: CLIENT_EMAIL },
      facts,
    });
    expect(client.name).toBeUndefined();
  });
});
