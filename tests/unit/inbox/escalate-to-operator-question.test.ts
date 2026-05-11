/**
 * Coverage for `escalateToOperatorQuestion` in AIDraftService — the
 * empty-response fallback that asks Claude to formulate one operator
 * question and writes it to `email_threads.agent_blocking_question`.
 *
 * Both side-effecting deps are stubbed: the OpenAI client (so each test
 * controls what JSON the model "returns") and the Supabase client (so we
 * can assert the update payload + simulate write failures). Every branch
 * of the parsing/sanitization logic gets a dedicated case, plus the
 * end-to-end happy path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const llmMock = {
  responseContent: "" as string,
  shouldThrow: false as boolean,
  lastCall: null as null | { systemPrompt: string; userPrompt: string },
};

const dbMock = {
  updates: [] as Array<{
    table: string;
    payload: Record<string, unknown>;
    eq: Array<[string, unknown]>;
  }>,
  updateError: null as null | { message: string },
};

vi.mock("@/lib/api/services/openai-clients", () => ({
  getDraftingOpenAI: () => ({
    chat: {
      completions: {
        create: vi.fn(async (req: { messages: Array<{ role: string; content: string }> }) => {
          if (llmMock.shouldThrow) throw new Error("LLM exploded");
          llmMock.lastCall = {
            systemPrompt: req.messages[0]?.content ?? "",
            userPrompt: req.messages[1]?.content ?? "",
          };
          return {
            choices: [
              { message: { content: llmMock.responseContent } },
            ],
          };
        }),
      },
    },
  }),
}));

vi.mock("@/lib/supabase/helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/helpers")>(
    "@/lib/supabase/helpers",
  );
  const buildEqChain = (table: string, payload: Record<string, unknown>) => {
    const calls: Array<[string, unknown]> = [];
    const chain = {
      eq: (col: string, val: unknown) => {
        calls.push([col, val]);
        return chain;
      },
      then: (resolve: (v: { error: { message: string } | null }) => void) => {
        dbMock.updates.push({ table, payload, eq: calls });
        resolve({ error: dbMock.updateError });
      },
    };
    return chain;
  };
  return {
    ...actual,
    requireSupabase: () => ({
      from: (table: string) => ({
        update: (payload: Record<string, unknown>) => buildEqChain(table, payload),
      }),
    }),
  };
});

import { escalateToOperatorQuestion } from "@/lib/api/services/ai-draft-service";

const baseCtx = {
  companyId: "co-1",
  threadInternalId: "thr-1",
  clientName: "Charlie",
  clientEmail: "charlie@example.com",
  threadSubject: "Re: Estimate",
  lastInboundBody: "Just checking on the install timeline.",
  threadHistory: "[inbound] hi\n\n[outbound] hello",
  opportunityContext: "Project: Deck install",
};

beforeEach(() => {
  llmMock.responseContent = "";
  llmMock.shouldThrow = false;
  llmMock.lastCall = null;
  dbMock.updates = [];
  dbMock.updateError = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("escalateToOperatorQuestion", () => {
  it("writes a free-form question when the model omits options", async () => {
    llmMock.responseContent = JSON.stringify({
      question: "What's the install date you want to commit to?",
    });
    const result = await escalateToOperatorQuestion(baseCtx);
    expect(result.written).toBe(true);
    expect(result.question).toBe("What's the install date you want to commit to?");
    expect(result.options).toBeUndefined();
    expect(dbMock.updates).toHaveLength(1);
    const payload = dbMock.updates[0].payload.agent_blocking_question as Record<
      string,
      unknown
    >;
    expect(payload.question).toBe(
      "What's the install date you want to commit to?",
    );
    expect(payload.options).toBeUndefined();
    expect(typeof payload.asked_at).toBe("string");
  });

  it("writes options as quick-pick chips when the model returns them", async () => {
    llmMock.responseContent = JSON.stringify({
      question: "What deposit amount?",
      options: [
        { id: "opt-25", label: "25% — $2,500" },
        { id: "opt-50", label: "50% — $5,000" },
      ],
    });
    const result = await escalateToOperatorQuestion(baseCtx);
    expect(result.written).toBe(true);
    expect(result.options).toEqual([
      { id: "opt-25", label: "25% — $2,500" },
      { id: "opt-50", label: "50% — $5,000" },
    ]);
    const payload = dbMock.updates[0].payload.agent_blocking_question as Record<
      string,
      unknown
    >;
    expect(payload.options).toEqual([
      { id: "opt-25", label: "25% — $2,500" },
      { id: "opt-50", label: "50% — $5,000" },
    ]);
  });

  it("caps options at 3 and silently drops malformed entries", async () => {
    llmMock.responseContent = JSON.stringify({
      question: "Pick a date",
      options: [
        { id: "a", label: "May 18" },
        { id: "b", label: "May 19" },
        { id: "", label: "missing id" },
        { id: "c", label: "May 20" },
        { id: "d", label: "May 21" },
        { id: "e", label: "May 22" },
      ],
    });
    const result = await escalateToOperatorQuestion(baseCtx);
    expect(result.written).toBe(true);
    expect(result.options).toEqual([
      { id: "a", label: "May 18" },
      { id: "b", label: "May 19" },
      { id: "c", label: "May 20" },
    ]);
  });

  it("falls through to free-form when all options are malformed", async () => {
    llmMock.responseContent = JSON.stringify({
      question: "What's the date?",
      options: [{ id: "" }, { label: "missing id" }, "garbage"],
    });
    const result = await escalateToOperatorQuestion(baseCtx);
    expect(result.written).toBe(true);
    expect(result.options).toBeUndefined();
  });

  it("rejects an empty question with reason 'omitted question field'", async () => {
    llmMock.responseContent = JSON.stringify({ question: "  ", options: [] });
    const result = await escalateToOperatorQuestion(baseCtx);
    expect(result.written).toBe(false);
    expect(result.reason).toContain("omitted question field");
    expect(dbMock.updates).toHaveLength(0);
  });

  it("rejects unparseable JSON with a reason", async () => {
    llmMock.responseContent = "not json at all";
    const result = await escalateToOperatorQuestion(baseCtx);
    expect(result.written).toBe(false);
    expect(result.reason).toBeDefined();
    expect(dbMock.updates).toHaveLength(0);
  });

  it("returns reason when the LLM throws — never bubbles", async () => {
    llmMock.shouldThrow = true;
    const result = await escalateToOperatorQuestion(baseCtx);
    expect(result.written).toBe(false);
    expect(result.reason).toContain("LLM exploded");
    expect(dbMock.updates).toHaveLength(0);
  });

  it("rejects empty LLM response content with a reason", async () => {
    llmMock.responseContent = "";
    const result = await escalateToOperatorQuestion(baseCtx);
    expect(result.written).toBe(false);
    expect(result.reason).toContain("empty content");
    expect(dbMock.updates).toHaveLength(0);
  });

  it("surfaces db write failures via reason without throwing", async () => {
    llmMock.responseContent = JSON.stringify({ question: "Q?" });
    dbMock.updateError = { message: "constraint violated" };
    const result = await escalateToOperatorQuestion(baseCtx);
    expect(result.written).toBe(false);
    expect(result.reason).toContain("constraint violated");
    expect(result.question).toBe("Q?");
  });

  it("scopes the update to (id, company_id) so the wrong company can't be touched", async () => {
    llmMock.responseContent = JSON.stringify({ question: "Q?" });
    await escalateToOperatorQuestion(baseCtx);
    const eqs = dbMock.updates[0].eq;
    expect(eqs).toContainEqual(["id", "thr-1"]);
    expect(eqs).toContainEqual(["company_id", "co-1"]);
  });

  it("rejects without an LLM call when context is empty", async () => {
    const spyCtx = { companyId: "co-1", threadInternalId: "thr-1" };
    const result = await escalateToOperatorQuestion(spyCtx);
    expect(result.written).toBe(false);
    expect(result.reason).toContain("no context available");
    expect(llmMock.lastCall).toBeNull();
    expect(dbMock.updates).toHaveLength(0);
  });

  it("rejects without an LLM call when threadInternalId is missing", async () => {
    const result = await escalateToOperatorQuestion({
      ...baseCtx,
      threadInternalId: "",
    });
    expect(result.written).toBe(false);
    expect(llmMock.lastCall).toBeNull();
  });
});
