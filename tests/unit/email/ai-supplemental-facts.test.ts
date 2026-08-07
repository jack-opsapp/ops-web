import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAISupplementalLeadFacts,
  hasAISupplementalLeadFacts,
} from "@/lib/email/ai-supplemental-facts";
import {
  leadEnrichmentFactsFromImport,
  type LeadEnrichmentFacts,
} from "@/lib/email/lead-enrichment";

function deterministic(
  overrides: Partial<LeadEnrichmentFacts> = {}
): LeadEnrichmentFacts {
  return {
    ...leadEnrichmentFactsFromImport({
      contactName: null,
      contactEmail: "canprojack@gmail.com",
      extractionSource: "import_payload",
      providerThreadId: "thread-1",
      providerMessageId: "message-1",
    }),
    ...overrides,
  };
}

function build(
  deterministicFacts: LeadEnrichmentFacts,
  classified: {
    clientName?: string | null;
    estimatedValue?: number | null;
    description?: string;
    confidence?: number;
  } = {}
) {
  return buildAISupplementalLeadFacts({
    deterministicFacts,
    classified: {
      clientName:
        classified.clientName === undefined
          ? "Cecilia Reyes"
          : classified.clientName,
      estimatedValue: classified.estimatedValue ?? null,
      description: classified.description ?? "",
      confidence: classified.confidence ?? 0.92,
    },
    providerThreadId: "thread-1",
    providerMessageId: "message-1",
  });
}

describe("buildAISupplementalLeadFacts", () => {
  it("carries the reviewer's contact name when the deterministic pass found none", () => {
    const facts = build(deterministic());
    expect(facts.contactName).toBe("Cecilia Reyes");
    expect(facts.extractionSource).toBe("ai_classified");
    expect(facts.aiConfidence).toBe(0.92);
  });

  it("anchors the fact to the deterministic sender mailbox", () => {
    expect(build(deterministic()).contactEmail).toBe("canprojack@gmail.com");
  });

  it("never overrides a deterministic contact name", () => {
    const facts = build(
      deterministic({ contactName: "Jack Reyes" }),
      { clientName: "Cecilia Reyes" }
    );
    expect(facts.contactName).toBeNull();
  });

  it("ignores a reviewer name that is just the mailbox handle", () => {
    expect(build(deterministic(), { clientName: "canprojack" }).contactName)
      .toBeNull();
    expect(
      build(deterministic(), { clientName: "canprojack@gmail.com" }).contactName
    ).toBeNull();
    expect(build(deterministic(), { clientName: "  " }).contactName).toBeNull();
    expect(build(deterministic(), { clientName: null }).contactName).toBeNull();
  });

  it("still fills only the deterministic holes for value and description", () => {
    const filled = build(
      deterministic({ estimatedValue: 4200, description: "Deck rebuild" }),
      { estimatedValue: 9999, description: "AI summary" }
    );
    expect(filled.estimatedValue).toBeNull();
    expect(filled.description).toBeNull();

    const holes = build(deterministic(), {
      estimatedValue: 9999,
      description: "AI summary",
    });
    expect(holes.estimatedValue).toBe(9999);
    expect(holes.description).toBe("AI summary");
  });

  it("never carries a phone or address from the reviewer", () => {
    const facts = build(deterministic());
    expect(facts.contactPhone).toBeNull();
    expect(facts.address).toBeNull();
  });
});

describe("hasAISupplementalLeadFacts", () => {
  it("is true when the reviewer supplied a name only", () => {
    expect(hasAISupplementalLeadFacts(build(deterministic()))).toBe(true);
  });

  it("is true when the reviewer supplied a value or description only", () => {
    expect(
      hasAISupplementalLeadFacts(
        build(deterministic(), { clientName: null, estimatedValue: 9999 })
      )
    ).toBe(true);
    expect(
      hasAISupplementalLeadFacts(
        build(deterministic(), { clientName: null, description: "AI summary" })
      )
    ).toBe(true);
  });

  it("is false when the reviewer added nothing", () => {
    expect(
      hasAISupplementalLeadFacts(
        build(deterministic({ contactName: "Jack Reyes" }), {
          clientName: "Cecilia Reyes",
        })
      )
    ).toBe(false);
  });
});

describe("sync-engine AI supplemental fact wiring", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/api/services/sync-engine.ts"),
    "utf8"
  );

  it("no longer discards the reviewer's contact name", () => {
    expect(source).toContain("buildAISupplementalLeadFacts({");
    expect(source).toContain("clientName: classified.clientName,");
    expect(source).not.toMatch(
      /extractionSource:\s*"ai_classified"[\s\S]{0,200}contactName:\s*null/
    );
    expect(source).not.toMatch(
      /contactName:\s*null,\s*\n\s*contactEmail:\s*null,/
    );
  });

  it("persists AI facts whenever the reviewer filled any hole", () => {
    expect(source).toContain(
      "if (hasAISupplementalLeadFacts(aiSupplementalFacts)) {"
    );
    expect(source).not.toMatch(
      /aiSupplementalFacts\.estimatedValue != null \|\|\s*\n\s*aiSupplementalFacts\.description != null/
    );
  });
});
