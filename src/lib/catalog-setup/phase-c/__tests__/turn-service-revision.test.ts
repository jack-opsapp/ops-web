import { describe, expect, it, vi } from "vitest";
import type { GuidedTurnQueryClient } from "../turn-service";
import { runGuidedSetupTurn } from "../turn-service";
import { CATALOG_CAPABILITY_MANIFEST_REVISION } from "../catalog-capability-manifest";

const COMPANY_ID = "a612edc0-5c18-4c4d-af97-55b9410dd077";
const OPERATOR_ID = "d82114aa-7b98-4439-85f0-978f835e0627";
const SESSION_ID = "54ce9e88-5688-4e73-ae4e-a62f85044b77";

function rowWithQueuedInputs() {
  return {
    id: SESSION_ID,
    company_id: COMPANY_ID,
    operator_id: OPERATOR_ID,
    status: "interviewing",
    version: 2,
    input_revision: 2,
    processed_input_revision: 0,
    capability_manifest_revision:
      CATALOG_CAPABILITY_MANIFEST_REVISION,
    input_ledger: [
      {
        id: "input-1",
        revision: 1,
        questionId: "service",
        answer: "Vinyl decking",
        displayKind: "text",
        displayContent: "Vinyl decking",
        state: "queued",
        createdAt: "2026-07-27T20:00:00.000Z",
        updatedAt: "2026-07-27T20:00:00.000Z",
      },
      {
        id: "input-2",
        revision: 2,
        questionId: "service",
        answer: "We use DekSmart",
        displayKind: "text",
        displayContent: "We use DekSmart",
        state: "queued",
        createdAt: "2026-07-27T20:00:01.000Z",
        updatedAt: "2026-07-27T20:00:01.000Z",
      },
    ],
    facts: [],
    sources: [],
    conversation: [
      {
        id: "operator-input:input-1",
        role: "operator",
        kind: "text",
        content: "Vinyl decking",
        version: 1,
        inputId: "input-1",
        state: "queued",
      },
      {
        id: "operator-input:input-2",
        role: "operator",
        kind: "text",
        content: "We use DekSmart",
        version: 2,
        inputId: "input-2",
        state: "queued",
      },
    ],
    unresolved_questions: [
      {
        id: "service",
        intent: "service_selection",
        capabilityRef: "catalog-core/v1",
        prompt: "What service do you want to set up first?",
        answerKind: "text",
        factKeys: ["customer_products.first_service_line"],
      },
    ],
    contradictions: [],
    proposed_plan: null,
    live_snapshot: {},
  };
}

function createRevisionClient() {
  let current: Record<string, unknown> = rowWithQueuedInputs();
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
    replace(row: Record<string, unknown>) {
      current = row;
    },
    client: {
      from() {
        return new Query();
      },
    } as unknown as GuidedTurnQueryClient,
  };
}

function nextTurn() {
  return {
    kind: "question" as const,
    facts: [],
    question: {
      id: "supplier",
      intent: "supplier_identity" as const,
      capabilityRef: "catalog-core/v1" as const,
      context: { serviceLabel: "vinyl decking" },
      prompt:
        "Which manufacturer, supplier, or product line do you use for vinyl decking?",
      answerKind: "text" as const,
      factKeys: ["service.vinyl.supplier"],
    },
  };
}

describe("Phase C generation revision fence", () => {
  it("combines all queued follow-ups and accepts them atomically", async () => {
    const { client, updates } = createRevisionClient();
    const generateTurn = vi.fn().mockResolvedValue(nextTurn());

    const result = await runGuidedSetupTurn({
      token: "token",
      companyId: COMPANY_ID,
      operatorId: OPERATOR_ID,
      sessionId: SESSION_ID,
      expectedVersion: 2,
      expectedInputRevision: 2,
      client,
      loadKnowledge: vi.fn().mockResolvedValue({
        queryHash: "",
        evidence: [],
      }),
      generateTurn,
    });

    expect(generateTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        answer: {
          kind: "operator_input_batch",
          inputs: [
            expect.objectContaining({ answer: "Vinyl decking" }),
            expect.objectContaining({ answer: "We use DekSmart" }),
          ],
        },
      }),
    );
    expect(result.superseded).toBe(false);
    expect(updates[0]).toMatchObject({
      version: 3,
      processed_input_revision: 2,
      input_ledger: [
        expect.objectContaining({ id: "input-1", state: "accepted" }),
        expect.objectContaining({ id: "input-2", state: "accepted" }),
      ],
    });
  });

  it("drops a stale model result when a quick follow-up changes the revision", async () => {
    const state = createRevisionClient();
    const generateTurn = vi.fn().mockImplementation(async () => {
      state.replace({
        ...state.current(),
        version: 3,
        input_revision: 3,
      });
      return nextTurn();
    });

    const result = await runGuidedSetupTurn({
      token: "token",
      companyId: COMPANY_ID,
      operatorId: OPERATOR_ID,
      sessionId: SESSION_ID,
      expectedVersion: 2,
      expectedInputRevision: 2,
      client: state.client,
      loadKnowledge: vi.fn().mockResolvedValue({
        queryHash: "",
        evidence: [],
      }),
      generateTurn,
    });

    expect(result.superseded).toBe(true);
    expect(result.turn).toBeNull();
    expect(state.updates).toHaveLength(0);
    expect(result.session).toMatchObject({
      version: 3,
      input_revision: 3,
      processed_input_revision: 0,
    });
  });
});
