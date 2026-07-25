import { describe, expect, it } from "vitest";
import { applyCatalogAgentTurn } from "../conversation-reducer";
import type { CatalogAgentTurn, CatalogFact } from "../types";

const priceFact: CatalogFact = {
  id: "fact-price",
  classification: "pricing_rule",
  key: "product.vinyl-68.base_price",
  value: 11.73,
  source: { kind: "operator" },
  confidence: 1,
  status: "confirmed",
  contradicts: [],
};

describe("Phase C conversation reducer", () => {
  it("keeps one current question and merges accepted facts", () => {
    const turn: CatalogAgentTurn = {
      kind: "question",
      facts: [priceFact],
      question: {
        id: "question-tax",
        prompt: "Is GST added on top?",
        answerKind: "boolean",
        factKeys: ["product.vinyl-68.taxable"],
      },
    };

    const next = applyCatalogAgentTurn(
      {
        facts: [],
        contradictions: [],
        unresolvedQuestions: [],
        proposedPlan: null,
      },
      turn,
    );

    expect(next.facts).toEqual([priceFact]);
    expect(next.unresolvedQuestions).toEqual([turn.question]);
    expect(next.proposedPlan).toBeNull();
    expect(next.status).toBe("interviewing");
  });

  it("records a contradiction instead of silently replacing an earlier answer", () => {
    const conflicting: CatalogFact = {
      ...priceFact,
      id: "fact-price-new",
      value: 12.73,
    };

    const next = applyCatalogAgentTurn(
      {
        facts: [priceFact],
        contradictions: [],
        unresolvedQuestions: [],
        proposedPlan: null,
      },
      {
        kind: "question",
        facts: [conflicting],
        question: {
          id: "resolve-price",
          prompt: "Which 68mil price is correct?",
          answerKind: "single_choice",
          factKeys: ["product.vinyl-68.base_price"],
          options: ["$11.73", "$12.73"],
        },
      },
    );

    expect(next.facts).toHaveLength(2);
    expect(next.facts.every((fact) => fact.status === "contradicted")).toBe(
      true,
    );
    expect(next.contradictions).toHaveLength(1);
    expect(next.status).toBe("interviewing");
  });

  it("moves to review only when the returned blueprint is reviewable", () => {
    const blueprint = {
      version: 1 as const,
      summary: "Vinyl catalog",
      ready: true,
      actions: [],
      issues: [],
    };
    const turn: CatalogAgentTurn = {
      kind: "review",
      facts: [priceFact],
      blueprint,
    };

    const next = applyCatalogAgentTurn(
      {
        facts: [],
        contradictions: [],
        unresolvedQuestions: [],
        proposedPlan: null,
      },
      turn,
    );

    expect(next.unresolvedQuestions).toEqual([]);
    expect(next.proposedPlan).toEqual(blueprint);
    expect(next.status).toBe("review");
  });
});
