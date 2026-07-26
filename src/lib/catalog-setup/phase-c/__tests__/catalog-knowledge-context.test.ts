import { describe, expect, it, vi } from "vitest";
import type { CatalogFact, GuidedQuestion } from "../types";
import {
  buildCatalogKnowledgeQuery,
  loadCatalogKnowledgeContext,
  selectCatalogKnowledgeEvidence,
  type CatalogKnowledgeMemoryRow,
} from "../catalog-knowledge-context";

const COMPANY_ID = "a612edc0-5c18-4c4d-af97-55b9410dd077";
const OTHER_COMPANY_ID = "27bb8329-d774-4da8-bf3c-2dda8334162b";

function memory(
  overrides: Partial<CatalogKnowledgeMemoryRow> = {}
): CatalogKnowledgeMemoryRow {
  return {
    id: crypto.randomUUID(),
    company_id: COMPANY_ID,
    memory_type: "fact",
    category: "service_capability",
    content: "The company installs vinyl membrane systems.",
    confidence: 0.9,
    source: "email",
    entity_id: null,
    valid_from: null,
    valid_to: null,
    decay_score: 0.9,
    created_at: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("catalog company knowledge query", () => {
  it("uses the current question, answer, and established facts", () => {
    const question: GuidedQuestion = {
      id: "service-line",
      prompt: "What service do you want to set up?",
      answerKind: "text",
      factKeys: ["customer_products.first_service_line"],
    };
    const facts: CatalogFact[] = [
      {
        id: "fact:service",
        classification: "customer_product",
        key: "customer_products.first_service_line",
        value: "vinyl membrane installation",
        source: { kind: "operator" },
        confidence: 1,
        status: "confirmed",
        contradicts: [],
      },
    ];

    const query = buildCatalogKnowledgeQuery({
      currentQuestion: question,
      answer: { kind: "text", value: "DekSmart vinyl" },
      facts,
    });

    expect(query).toContain("what service do you want to set up");
    expect(query).toContain("deksmart vinyl");
    expect(query).toContain("vinyl membrane installation");
    expect(query.length).toBeLessThanOrEqual(8_000);
  });
});

describe("catalog company knowledge selection", () => {
  it("selects only relevant, active, catalog-safe memories from the company", () => {
    const selected = selectCatalogKnowledgeEvidence({
      companyId: COMPANY_ID,
      query: "vinyl membrane installation",
      rows: [
        memory({ id: "relevant", content: "Installs vinyl membrane systems." }),
        memory({
          id: "pricing",
          category: "pricing",
          content:
            "Vinyl installation has historically been quoted per square foot.",
        }),
        memory({
          id: "commitment",
          category: "commitment",
          content: "Vinyl sample must be delivered Friday.",
        }),
        memory({
          id: "expired",
          content: "Vinyl installation is no longer offered.",
          valid_to: "2026-01-01T00:00:00.000Z",
        }),
        memory({
          id: "decayed",
          content: "Old vinyl installation note.",
          decay_score: 0.1,
        }),
        memory({
          id: "low-confidence",
          content: "Maybe installs vinyl.",
          confidence: 0.54,
        }),
        memory({
          id: "cross-company",
          company_id: OTHER_COMPANY_ID,
          content: "Installs vinyl membrane systems.",
        }),
      ],
    });

    expect(selected.map((entry) => entry.id)).toEqual(["relevant", "pricing"]);
    expect(selected.every((entry) => entry.scope === "company")).toBe(true);
  });

  it("returns no evidence when the memories do not match the service", () => {
    const selected = selectCatalogKnowledgeEvidence({
      companyId: COMPANY_ID,
      query: "commercial window cleaning",
      rows: [
        memory({ content: "Installs vinyl membrane systems." }),
        memory({
          category: "material",
          content: "Uses aluminum railing posts.",
        }),
      ],
    });

    expect(selected).toEqual([]);
  });

  it("honors knowledge validity windows", () => {
    const selected = selectCatalogKnowledgeEvidence({
      companyId: COMPANY_ID,
      query: "vinyl membrane",
      rows: [
        memory({
          id: "valid-until-future",
          content: "Vinyl membrane installation is offered.",
          valid_to: "2099-01-01T00:00:00.000Z",
        }),
        memory({
          id: "not-valid-yet",
          content: "Vinyl membrane installation expands next year.",
          valid_from: "2099-01-01T00:00:00.000Z",
        }),
      ],
    });

    expect(selected.map((entry) => entry.id)).toEqual(["valid-until-future"]);
  });

  it("ranks company-wide evidence before an equivalent entity-specific observation", () => {
    const selected = selectCatalogKnowledgeEvidence({
      companyId: COMPANY_ID,
      query: "vinyl membrane",
      rows: [
        memory({
          id: "entity-specific",
          content: "Vinyl membrane is installed.",
          entity_id: "e551db13-1d6b-444f-b5bb-09c104f4fc7c",
        }),
        memory({
          id: "company-wide",
          content: "Vinyl membrane is installed.",
          entity_id: null,
        }),
      ],
    });

    expect(selected.map((entry) => entry.id)).toEqual(["company-wide"]);
    expect(selected[0]?.scope).toBe("company");
  });

  it("deduplicates, sanitizes, and bounds prompt evidence", () => {
    const rows = Array.from({ length: 13 }, (_, index) =>
      memory({
        id: `memory-${index}`,
        category: "material",
        content:
          index < 2
            ? "Vinyl\u0000 membrane uses approved adhesive."
            : `Vinyl membrane material observation ${index} ${"x".repeat(800)}`,
      })
    );

    const selected = selectCatalogKnowledgeEvidence({
      companyId: COMPANY_ID,
      query: "vinyl membrane material",
      rows,
    });

    expect(selected).toHaveLength(12);
    expect(selected.map((entry) => entry.content)).toContain(
      "Vinyl membrane uses approved adhesive."
    );
    expect(selected.every((entry) => !entry.content.includes("\u0000"))).toBe(
      true
    );
    expect(selected.every((entry) => entry.content.length <= 600)).toBe(true);
    expect(new Set(selected.map((entry) => entry.content)).size).toBe(12);
  });
});

describe("catalog company knowledge loader", () => {
  it("reads with the canonical company id and returns a stable source hash", async () => {
    const readRows = vi.fn().mockResolvedValue([
      memory({
        id: "vinyl-memory",
        content: "Vinyl membrane installation is offered.",
      }),
    ]);

    const context = await loadCatalogKnowledgeContext({
      companyId: COMPANY_ID,
      currentQuestion: null,
      answer: "vinyl membrane installation",
      facts: [],
      readRows,
    });

    expect(readRows).toHaveBeenCalledWith(COMPANY_ID);
    expect(context.evidence.map((entry) => entry.id)).toEqual(["vinyl-memory"]);
    expect(context.queryHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
