import { describe, expect, it } from "vitest";
import {
  CatalogAgentTurnSchema,
  CatalogBlueprintSchema,
  CatalogFactSchema,
  GuidedQuestionSchema,
  GuidedSetupSessionDocumentSchema,
} from "../schemas";

const operatorFact = {
  id: "fact-price",
  classification: "pricing_rule",
  key: "products.standard.unit_price",
  value: 11.73,
  source: {
    kind: "operator",
    reference: "turn-4",
  },
  confidence: 1,
  status: "confirmed",
  contradicts: [],
} as const;

describe("Phase C catalog setup schemas", () => {
  it("rejects file questions because guided setup never requires an upload", () => {
    expect(() =>
      GuidedQuestionSchema.parse({
        id: "upload-price-sheet",
        prompt: "Upload your current price sheet.",
        answerKind: "file",
        factKeys: ["customer_products"],
      })
    ).toThrow();
  });

  it("accepts a single-question turn with classified, sourced facts", () => {
    const parsed = CatalogAgentTurnSchema.parse({
      kind: "question",
      facts: [operatorFact],
      question: {
        id: "tax-treatment",
        intent: "tax_treatment",
        capabilityRef: "catalog-core/v1",
        prompt: "Should tax be added to this price?",
        answerKind: "boolean",
        factKeys: ["products.standard.taxable"],
      },
    });

    expect(parsed.kind).toBe("question");
    if (parsed.kind !== "question") {
      throw new Error("Expected a question turn");
    }
    expect(parsed.facts[0].classification).toBe("pricing_rule");
    expect(parsed.question.capabilityRef).toBe("catalog-core/v1");
  });

  it("rejects unknown question intents and capability references", () => {
    expect(() =>
      GuidedQuestionSchema.parse({
        id: "invented",
        intent: "make_the_deck_designer_do_it",
        capabilityRef: "invented/v99",
        prompt: "Should OPS do this automatically?",
        answerKind: "boolean",
        factKeys: ["invented"],
      })
    ).toThrow();
  });

  it("stamps review blueprints with the capability manifest revision", () => {
    const blueprint = CatalogBlueprintSchema.parse({
      version: 1,
      capabilityRevision: "phase-c-capabilities/2026-07-27.1",
      summary: "Vinyl membrane system",
      ready: true,
      actions: [],
      issues: [],
    });

    expect(blueprint.capabilityRevision).toBe(
      "phase-c-capabilities/2026-07-27.1"
    );
  });

  it("rejects a turn that tries to return a question and a review together", () => {
    expect(() =>
      CatalogAgentTurnSchema.parse({
        kind: "question",
        facts: [operatorFact],
        question: {
          id: "tax-treatment",
          prompt: "Should tax be added to this price?",
          answerKind: "boolean",
          factKeys: ["products.standard.taxable"],
        },
        blueprint: {
          version: 1,
          summary: "Vinyl",
          ready: true,
          actions: [],
          issues: [],
        },
      })
    ).toThrow();
  });

  it("preserves unknown supplier identifiers as null instead of plausible text", () => {
    const blueprint = CatalogBlueprintSchema.parse({
      version: 1,
      summary: "Vinyl membrane system",
      ready: true,
      actions: [
        {
          actionKey: "create-ultra-cobblestone",
          group: "CREATE",
          actionType: "upsert_catalog_variant",
          targetKind: "catalog_variant",
          clientId: "ultra-cobblestone",
          payload: {
            name: "Cobblestone",
            supplierSku: null,
          },
        },
      ],
      issues: [
        {
          code: "supplier_sku_unknown",
          severity: "verification",
          actionKey: "create-ultra-cobblestone",
          message: "Supplier SKU still needs verification.",
        },
      ],
    });

    expect(blueprint.actions[0].payload.supplierSku).toBeNull();
  });

  it("rejects fabricated IDs that are not UUIDs or declared client IDs", () => {
    expect(() =>
      CatalogBlueprintSchema.parse({
        version: 1,
        summary: "Vinyl membrane system",
        ready: true,
        actions: [
          {
            actionKey: "reuse-task",
            group: "REUSE",
            actionType: "reuse_task_type",
            targetKind: "task_type",
            existingId: "looks-like-a-task-id",
            payload: {},
          },
        ],
        issues: [],
      })
    ).toThrow();
  });

  it("rejects unclassified facts so internal choices cannot leak into customer options", () => {
    expect(() =>
      CatalogFactSchema.parse({
        ...operatorFact,
        classification: "misc",
      })
    ).toThrow();
  });

  it("accepts company knowledge only as an unresolved fact source", () => {
    const parsed = CatalogFactSchema.parse({
      ...operatorFact,
      id: "fact-company-knowledge-price",
      source: {
        kind: "company_knowledge",
        reference: "memory-price",
      },
      confidence: 0.92,
      status: "unresolved",
    });

    expect(parsed.source.kind).toBe("company_knowledge");
    expect(parsed.status).toBe("unresolved");
  });

  it("rejects company knowledge presented as confirmed truth", () => {
    expect(() =>
      CatalogFactSchema.parse({
        ...operatorFact,
        source: {
          kind: "company_knowledge",
          reference: "memory-price",
        },
        confidence: 0.92,
        status: "confirmed",
      })
    ).toThrow(/unresolved/i);
  });

  it("accepts a durable session document with structured state rather than chat as truth", () => {
    const session = GuidedSetupSessionDocumentSchema.parse({
      id: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
      companyId: "a612edc0-5c18-4c4d-af97-55b9410dd077",
      operatorId: "d82114aa-7b98-4439-85f0-978f835e0627",
      mode: "guided",
      status: "interviewing",
      version: 3,
      facts: [operatorFact],
      sources: [],
      unresolvedQuestions: [],
      contradictions: [],
      liveSnapshot: {},
      liveSnapshotHash: "sha256:abc",
      proposedPlan: null,
      proposedPlanHash: null,
      validationIssues: [],
      approvalHash: null,
      commitJournal: [],
      readback: null,
    });

    expect(session.status).toBe("interviewing");
    expect(session.version).toBe(3);
  });
});
