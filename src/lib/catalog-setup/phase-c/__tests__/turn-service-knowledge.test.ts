import { describe, expect, it, vi } from "vitest";
import type { GuidedTurnQueryClient } from "../turn-service";
import { runGuidedSetupTurn } from "../turn-service";

const COMPANY_ID = "a612edc0-5c18-4c4d-af97-55b9410dd077";
const OPERATOR_ID = "d82114aa-7b98-4439-85f0-978f835e0627";
const SESSION_ID = "54ce9e88-5688-4e73-ae4e-a62f85044b77";

function createTurnClient() {
  const current = {
    id: SESSION_ID,
    company_id: COMPANY_ID,
    operator_id: OPERATOR_ID,
    status: "interviewing",
    version: 0,
    facts: [],
    sources: [],
    conversation: [],
    unresolved_questions: [
      {
        id: "first-service-line",
        prompt: "What service do you want to set up first?",
        answerKind: "text",
        factKeys: ["customer_products.first_service_line"],
      },
    ],
    contradictions: [],
    proposed_plan: null,
    live_snapshot: {},
  };
  const updates: Array<Record<string, unknown>> = [];

  class Query {
    private updateValues: Record<string, unknown> | null = null;

    select() {
      return this;
    }

    eq() {
      return this;
    }

    update(values: Record<string, unknown>) {
      this.updateValues = values;
      updates.push(values);
      return this;
    }

    maybeSingle() {
      return Promise.resolve({
        data: this.updateValues
          ? { ...current, ...this.updateValues }
          : current,
        error: null,
      });
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: {
            data: unknown;
            error: null;
          }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null
    ) {
      return this.maybeSingle().then(onfulfilled, onrejected);
    }
  }

  return {
    updates,
    client: {
      from() {
        return new Query();
      },
    } as unknown as GuidedTurnQueryClient,
  };
}

function nextQuestionTurn() {
  return {
    kind: "question" as const,
    facts: [],
    question: {
      id: "installed-price",
      prompt: "What do you charge per square foot?",
      answerKind: "number" as const,
      factKeys: ["product.installed_price"],
    },
  };
}

describe("guided setup company knowledge", () => {
  it("uses scoped evidence and stores only compact provenance", async () => {
    const { client, updates } = createTurnClient();
    const evidence = [
      {
        id: "memory-price",
        category: "pricing",
        content: "Vinyl installation was quoted per square foot.",
        confidence: 0.92,
        source: "email",
        scope: "company" as const,
        observedAt: "2026-07-01T12:00:00.000Z",
      },
    ];
    const loadKnowledge = vi.fn().mockResolvedValue({
      queryHash: `sha256:${"a".repeat(64)}`,
      evidence,
    });
    const generateTurn = vi.fn().mockResolvedValue(nextQuestionTurn());

    await runGuidedSetupTurn({
      token: "token",
      companyId: COMPANY_ID,
      operatorId: OPERATOR_ID,
      sessionId: SESSION_ID,
      answer: { kind: "text", value: "Vinyl membrane installation" },
      expectedVersion: 0,
      client,
      loadKnowledge,
      generateTurn,
    });

    expect(loadKnowledge).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      currentQuestion: expect.objectContaining({ id: "first-service-line" }),
      answer: { kind: "text", value: "Vinyl membrane installation" },
      facts: [],
    });
    expect(generateTurn).toHaveBeenCalledWith(
      expect.objectContaining({ companyKnowledge: evidence })
    );

    const sources = updates[0].sources as Array<Record<string, unknown>>;
    expect(sources[0]).toEqual({
      kind: "company_knowledge",
      queryHash: `sha256:${"a".repeat(64)}`,
      memoryIds: ["memory-price"],
      categories: ["pricing"],
      version: 1,
    });
    expect(JSON.stringify(sources[0])).not.toContain(evidence[0].content);
    expect(sources[1]).toMatchObject({
      kind: "operator",
      questionId: "first-service-line",
      version: 1,
    });
  });

  it("continues without company knowledge when retrieval fails", async () => {
    const { client, updates } = createTurnClient();
    const loadKnowledge = vi
      .fn()
      .mockRejectedValue(new Error("knowledge unavailable"));
    const generateTurn = vi.fn().mockResolvedValue(nextQuestionTurn());
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await runGuidedSetupTurn({
      token: "token",
      companyId: COMPANY_ID,
      operatorId: OPERATOR_ID,
      sessionId: SESSION_ID,
      answer: { kind: "text", value: "Vinyl membrane installation" },
      expectedVersion: 0,
      client,
      loadKnowledge,
      generateTurn,
    });

    expect(generateTurn).toHaveBeenCalledWith(
      expect.objectContaining({ companyKnowledge: [] })
    );
    expect(
      (updates[0].sources as Array<Record<string, unknown>>).map(
        (source) => source.kind
      )
    ).toEqual(["operator"]);
    expect(log).toHaveBeenCalledWith(
      "[catalog-setup] Company knowledge unavailable",
      expect.any(Error)
    );
    log.mockRestore();
  });
});
