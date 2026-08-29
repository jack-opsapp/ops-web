import { describe, expect, it, vi } from "vitest";
import type { GuidedTurnQueryClient } from "../turn-service";
import { runGuidedSetupTurn } from "../turn-service";
import { resolveGuidedQuestion } from "../question-policy";
import { CATALOG_CAPABILITY_MANIFEST_REVISION } from "../catalog-capability-manifest";

const COMPANY_ID = "a612edc0-5c18-4c4d-af97-55b9410dd077";
const OPERATOR_ID = "d82114aa-7b98-4439-85f0-978f835e0627";
const SESSION_ID = "3af7b940-09f1-43b0-b58b-7edbdc1bd2f7";

const PRICING_PROMPT =
  "What base price, unit, and minimum charge should OPS use for Railings?";

function bugSessionRow() {
  return {
    id: SESSION_ID,
    company_id: COMPANY_ID,
    operator_id: OPERATOR_ID,
    status: "interviewing",
    version: 7,
    input_revision: 4,
    processed_input_revision: 3,
    capability_manifest_revision: CATALOG_CAPABILITY_MANIFEST_REVISION,
    input_ledger: [
      {
        id: "input-4",
        revision: 4,
        questionId: "railings-pricing-structure",
        answer: "we price per linear foot. minimum charge 1500",
        displayKind: "text",
        displayContent: "we price per linear foot. minimum charge 1500",
        state: "queued",
        createdAt: "2026-08-06T19:33:00.000Z",
        updatedAt: "2026-08-06T19:33:00.000Z",
      },
    ],
    facts: [],
    sources: [],
    conversation: [
      {
        id: "assistant:6:railings-pricing-structure",
        role: "assistant",
        kind: "text",
        content: PRICING_PROMPT,
        version: 6,
      },
      {
        id: "operator-input:input-4",
        role: "operator",
        kind: "text",
        content: "we price per linear foot. minimum charge 1500",
        version: 7,
        inputId: "input-4",
        state: "queued",
      },
    ],
    unresolved_questions: [
      {
        id: "railings-pricing-structure",
        intent: "pricing",
        capabilityRef: "catalog-core/v1",
        context: { productLabel: "Railings", serviceLabel: "Railings" },
        prompt: PRICING_PROMPT,
        answerKind: "text",
        factKeys: [
          "railings.base_price",
          "railings.pricing_unit",
          "railings.minimum_charge",
        ],
      },
    ],
    contradictions: [],
    proposed_plan: null,
    live_snapshot: {},
  };
}

function createClient(row: Record<string, unknown>) {
  let current: Record<string, unknown> = row;
  const updates: Record<string, unknown>[] = [];

  class Query {
    private filters: Array<[string, string | number]> = [];
    private values: Record<string, unknown> | null = null;

    select() {
      return this;
    }
    eq(column: string, value: string | number) {
      this.filters.push([column, value]);
      return this;
    }
    update(values: Record<string, unknown>) {
      this.values = values;
      return this;
    }
    maybeSingle() {
      const matches = this.filters.every(
        ([column, value]) => current[column] === value,
      );
      if (!matches) return Promise.resolve({ data: null, error: null });
      if (this.values) {
        updates.push(this.values);
        current = { ...current, ...this.values };
      }
      return Promise.resolve({ data: current, error: null });
    }
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: { data: unknown; error: null }) => TResult1)
        | null,
      onrejected?: ((reason: unknown) => TResult2) | null,
    ) {
      return this.maybeSingle().then(onfulfilled, onrejected);
    }
  }

  return {
    updates,
    current: () => current,
    client: {
      from() {
        return new Query();
      },
    } as unknown as GuidedTurnQueryClient,
  };
}

const confirmedFact = (key: string, value: unknown) => ({
  id: `fact-${key}`,
  classification: "pricing_rule",
  key,
  value,
  source: { kind: "operator" },
  confidence: 1,
  status: "confirmed",
  contradicts: [],
});

describe("Phase C guided question narrowing", () => {
  it("renders a narrowed follow-up instead of repeating the answered question verbatim (bug 986009b0)", async () => {
    const { client } = createClient(bugSessionRow());
    // The model's actual failure shape from session 3af7b940: facts confirm
    // unit + minimum, yet the re-ask decision keeps all three factKeys under
    // a freshly minted id.
    const generateTurn = vi.fn().mockResolvedValue({
      kind: "question",
      facts: [
        confirmedFact("railings.pricing_unit", "linear_foot"),
        confirmedFact("railings.minimum_charge", 1500),
      ],
      question: resolveGuidedQuestion({
        id: "railings-base-price-per-linear-foot",
        intent: "pricing",
        capabilityRef: "catalog-core/v1",
        factKeys: [
          "railings.base_price",
          "railings.pricing_unit",
          "railings.minimum_charge",
        ],
        context: { productLabel: "Railings", serviceLabel: "Railings" },
      }),
    });

    const result = await runGuidedSetupTurn({
      token: "token",
      companyId: COMPANY_ID,
      operatorId: OPERATOR_ID,
      sessionId: SESSION_ID,
      expectedVersion: 7,
      expectedInputRevision: 4,
      client,
      generateTurn,
      loadKnowledge: async () => ({ queryHash: "", evidence: [] }),
    });

    const session = result.session as Record<string, unknown>;
    const conversation = session.conversation as Array<Record<string, unknown>>;
    const assistants = conversation.filter((m) => m.role === "assistant");

    // The persisted follow-up is the narrowed ask, not the verbatim repeat.
    expect(assistants.at(-1)?.content).toBe(
      "What base price should OPS use for Railings?",
    );
    // No two assistant turns in the transcript carry identical content.
    const texts = assistants.map((m) => m.content);
    expect(new Set(texts).size).toBe(texts.length);
    // The durable question row matches what the transcript shows.
    const unresolved = session.unresolved_questions as Array<
      Record<string, unknown>
    >;
    expect(unresolved[0]).toMatchObject({
      id: "railings-base-price-per-linear-foot",
      factKeys: ["railings.base_price"],
      prompt: "What base price should OPS use for Railings?",
    });
  });

  it("keeps a genuine no-progress re-ask verbatim (nothing was extracted)", async () => {
    const { client } = createClient(bugSessionRow());
    const generateTurn = vi.fn().mockResolvedValue({
      kind: "question",
      facts: [],
      question: resolveGuidedQuestion({
        id: "railings-pricing-structure-retry",
        intent: "pricing",
        capabilityRef: "catalog-core/v1",
        factKeys: [
          "railings.base_price",
          "railings.pricing_unit",
          "railings.minimum_charge",
        ],
        context: { productLabel: "Railings", serviceLabel: "Railings" },
      }),
    });
    const result = await runGuidedSetupTurn({
      token: "token",
      companyId: COMPANY_ID,
      operatorId: OPERATOR_ID,
      sessionId: SESSION_ID,
      expectedVersion: 7,
      expectedInputRevision: 4,
      client,
      generateTurn,
      loadKnowledge: async () => ({ queryHash: "", evidence: [] }),
    });
    const conversation = (result.session as Record<string, unknown>)
      .conversation as Array<Record<string, unknown>>;
    expect(
      conversation.filter((m) => m.role === "assistant").at(-1)?.content,
    ).toBe(PRICING_PROMPT); // honest repeat stays
  });
});
