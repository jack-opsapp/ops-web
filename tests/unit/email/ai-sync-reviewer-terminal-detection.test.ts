import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AISyncReviewer } from "@/lib/api/services/ai-sync-reviewer";
import type { EmailConnection } from "@/lib/types/email-connection";

const createMock = vi.hoisted(() => vi.fn());
const fetchThreadMock = vi.hoisted(() => vi.fn());
const isAIFeatureEnabledMock = vi.hoisted(() => vi.fn());
const classifyBatchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/services/openai-clients", () => ({
  getSyncOpenAI: () => ({
    chat: {
      completions: {
        create: createMock,
      },
    },
  }),
}));

vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: {
    isAIFeatureEnabled: isAIFeatureEnabledMock,
  },
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getProvider: () => ({ fetchThread: fetchThreadMock }),
  },
}));

vi.mock("@/lib/api/services/email-ai-classifier", () => ({
  EmailAIClassifier: {
    classifyBatch: classifyBatchMock,
  },
}));

const connection = {
  id: "connection-1",
  companyId: "company-1",
  email: "canprojack@gmail.com",
  syncFilters: {},
} as EmailConnection;

const unmatchedEmail = {
  id: "message-1",
  threadId: "thread-1",
  from: "Kara Beach <kara@example.com>",
  fromName: "Kara Beach",
  to: ["canprojack@gmail.com"],
  cc: [],
  subject: "Deck quote",
  snippet: "Can you quote this deck?",
  bodyText: "Can you quote this deck?",
  date: new Date("2026-06-20T18:00:00.000Z"),
  labelIds: ["INBOX"],
  isRead: false,
  hasAttachments: false,
  sizeEstimate: 100,
};

const companyContext = {
  name: "Canpro Deck and Rail",
  industry: "decking",
  domains: ["canprodeckandrail.com"],
};

const inheritedMailboxCheckpoint = vi.fn(async () => {});
const inheritedMailboxOperation = {
  providerLockCheckpoint: inheritedMailboxCheckpoint,
};

describe("AISyncReviewer terminal stage guard", () => {
  beforeEach(() => {
    createMock.mockReset();
    fetchThreadMock.mockReset();
    classifyBatchMock.mockReset();
    classifyBatchMock.mockResolvedValue([]);
    isAIFeatureEnabledMock.mockReset();
    isAIFeatureEnabledMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("promotes clear acceptance evidence to likely_won even when the model returns an active stage", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              results: [
                {
                  tid: "thread-1",
                  stage: "quoted",
                  summary: "Client has the estimate.",
                },
              ],
            }),
          },
        },
      ],
    });

    const result = await AISyncReviewer.evaluateSingleBatch(
      [
        {
          threadId: "thread-1",
          messages: [
            {
              from: "canprojack@gmail.com",
              to: ["liane@example.com"],
              subject: "Deck estimate",
              bodyText: "Attached is the estimate for the deck resurfacing.",
              date: "2026-06-20T18:00:00.000Z",
              direction: "outbound",
            },
            {
              from: "liane@example.com",
              to: ["canprojack@gmail.com"],
              subject: "Re: Deck estimate",
              bodyText:
                "Sounds Great! 4204 Springridge Cres. Thanks . 250 216 6119 Cell",
              date: "2026-06-21T18:00:00.000Z",
              direction: "inbound",
            },
          ],
        },
      ],
      "Canpro Deck and Rail",
      "canprojack@gmail.com"
    );

    expect(result).toEqual([
      {
        threadId: "thread-1",
        newStage: "quoted",
        terminalFlag: "likely_won",
        summary: "Client has the estimate.",
      },
    ]);
  });

  it.each([
    ["missing", undefined],
    ["invalid", "sales-ready"],
  ])(
    "keeps the stage unchanged when the model returns a %s stage",
    async (_case, stage) => {
      createMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                results: [
                  {
                    tid: "thread-1",
                    stage,
                    summary: "Client is waiting for an estimate.",
                  },
                ],
              }),
            },
          },
        ],
      });

      const result = await AISyncReviewer.evaluateSingleBatch(
        [
          {
            threadId: "thread-1",
            messages: [],
          },
        ],
        "Canpro Deck and Rail",
        "canprojack@gmail.com"
      );

      expect(result).toEqual([
        {
          threadId: "thread-1",
          newStage: null,
          terminalFlag: null,
          summary: "Client is waiting for an estimate.",
        },
      ]);
    }
  );

  it("turns a terminal value returned in the stage field into a flag without changing the active stage", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              results: [
                {
                  tid: "thread-1",
                  stage: "likely_won",
                  summary: "Client accepted the estimate.",
                },
              ],
            }),
          },
        },
      ],
    });

    const result = await AISyncReviewer.evaluateSingleBatch(
      [{ threadId: "thread-1", messages: [] }],
      "Canpro Deck and Rail",
      "canprojack@gmail.com"
    );

    expect(result).toEqual([
      {
        threadId: "thread-1",
        newStage: null,
        terminalFlag: "likely_won",
        summary: "Client accepted the estimate.",
      },
    ]);
  });

  it("fails closed when the model omits a requested evaluation key", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ results: [] }),
          },
        },
      ],
    });

    await expect(
      AISyncReviewer.evaluateSingleBatch(
        [{ threadId: "thread-1", messages: [] }],
        "Canpro Deck and Rail",
        "canprojack@gmail.com"
      )
    ).rejects.toThrow("model response omitted evaluation key thread-1");
  });

  it("fails closed after a model failure so the sync cycle can retry", async () => {
    createMock.mockRejectedValue(new Error("model unavailable"));

    await expect(
      AISyncReviewer.evaluateSingleBatch(
        [{ threadId: "thread-1", messages: [] }],
        "Canpro Deck and Rail",
        "canprojack@gmail.com"
      )
    ).rejects.toThrow("stage and summary evaluation failed: model unavailable");
  });

  it("fails closed when any active thread cannot be fetched", async () => {
    fetchThreadMock.mockRejectedValue(new Error("temporary Gmail failure"));

    await expect(
      AISyncReviewer.evaluateStagesWithSummary(
        ["thread-1"],
        connection,
        { name: "Canpro Deck and Rail" },
        inheritedMailboxOperation
      )
    ).rejects.toThrow(
      "failed to fetch thread thread-1: temporary Gmail failure"
    );
  });

  it("evaluates every active thread when more than twenty arrive in one sync", async () => {
    vi.useFakeTimers();
    const threadIds = Array.from(
      { length: 21 },
      (_, index) => `thread-${index + 1}`
    );
    fetchThreadMock.mockImplementation(async (threadId: string) => [
      {
        from: "client@example.com",
        to: ["canprojack@gmail.com"],
        subject: threadId,
        bodyText: "Please send an estimate.",
        date: new Date("2026-06-20T18:00:00.000Z"),
      },
    ]);
    const evaluateSpy = vi
      .spyOn(AISyncReviewer, "evaluateSingleBatch")
      .mockImplementation(async (batch) =>
        batch.map(({ threadId }) => ({
          threadId,
          newStage: null,
          terminalFlag: null,
          summary: null,
        }))
      );

    const resultPromise = AISyncReviewer.evaluateStagesWithSummary(
      threadIds,
      connection,
      { name: "Canpro Deck and Rail" },
      inheritedMailboxOperation
    );
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(fetchThreadMock).toHaveBeenCalledTimes(21);
    expect(inheritedMailboxCheckpoint).toHaveBeenCalledTimes(44);
    expect(evaluateSpy.mock.calls.map(([batch]) => batch.length)).toEqual([
      5, 5, 5, 5, 1,
    ]);
    expect(result.map(({ threadId }) => threadId)).toEqual(threadIds);
  });

  it("treats an operator company-domain alias as outbound during stage review", async () => {
    fetchThreadMock.mockResolvedValue([
      {
        id: "message-1",
        threadId: "thread-1",
        from: "Jared <jared@canprodeckandrail.com>",
        fromName: "Jared",
        to: ["client@example.com"],
        cc: [],
        subject: "Estimate",
        snippet: "Estimate attached.",
        bodyText: "Estimate attached.",
        date: new Date("2026-06-20T18:00:00.000Z"),
        labelIds: ["SENT"],
        isRead: true,
        hasAttachments: false,
        sizeEstimate: 100,
      },
    ]);
    const evaluateSpy = vi
      .spyOn(AISyncReviewer, "evaluateSingleBatch")
      .mockResolvedValue([
        {
          threadId: "thread-1",
          newStage: null,
          terminalFlag: null,
          summary: null,
        },
      ]);

    await AISyncReviewer.evaluateStagesWithSummary(
      ["thread-1"],
      {
        ...connection,
        syncFilters: {
          companyDomains: ["canprodeckandrail.com"],
          userEmailAddresses: ["jared@canprodeckandrail.com"],
        },
      },
      { name: "Canpro Deck and Rail" },
      inheritedMailboxOperation
    );

    expect(evaluateSpy.mock.calls[0][0][0].messages[0].direction).toBe(
      "outbound"
    );
  });

  it("classifies a customer message addressed to the mailbox as inbound", async () => {
    classifyBatchMock.mockResolvedValue([
      {
        id: "message-1",
        verdict: "skip",
        confidence: 0.99,
        stage: null,
        estimatedValue: null,
        client: null,
        duplicateOf: [],
        terminalFlag: null,
      },
    ]);

    await AISyncReviewer.reviewUnmatchedEmails(
      [unmatchedEmail],
      {
        ...connection,
        syncFilters: {
          companyDomains: ["canprodeckandrail.com"],
          userEmailAddresses: [],
          aiClassificationThreshold: 0.7,
        },
      },
      companyContext
    );

    expect(classifyBatchMock.mock.calls[0][0][0].direction).toBe("inbound");
  });

  it("keeps a valid lead when the model omits client identity", async () => {
    classifyBatchMock.mockResolvedValue([
      {
        id: "message-1",
        verdict: "lead",
        confidence: 0.95,
        stage: "new_lead",
        estimatedValue: 12000,
        client: null,
        duplicateOf: [],
        terminalFlag: null,
      },
    ]);

    const result = await AISyncReviewer.reviewUnmatchedEmails(
      [unmatchedEmail],
      {
        ...connection,
        syncFilters: { aiClassificationThreshold: 0.7 },
      },
      companyContext
    );

    expect(result.newLeadsClassified).toBe(1);
    expect(result.classifiedLeads).toEqual([
      expect.objectContaining({
        email: unmatchedEmail,
        clientName: null,
        clientEmail: null,
        clientPhone: null,
        address: null,
        description: "",
        stage: "new_lead",
        estimatedValue: 12000,
      }),
    ]);
  });

  it("fails closed when the classifier omits an input identity", async () => {
    classifyBatchMock.mockResolvedValue([]);

    await expect(
      AISyncReviewer.reviewUnmatchedEmails(
        [unmatchedEmail],
        connection,
        companyContext
      )
    ).rejects.toThrow("classifier omitted input message-1");
  });

  it("accepts explicit biz and skip classifications as intentional non-leads", async () => {
    const secondEmail = {
      ...unmatchedEmail,
      id: "message-2",
      threadId: "thread-2",
    };
    classifyBatchMock.mockResolvedValue([
      {
        id: "message-1",
        verdict: "skip",
        confidence: 0.99,
        stage: null,
        estimatedValue: null,
        client: null,
        duplicateOf: [],
        terminalFlag: null,
      },
      {
        id: "message-2",
        verdict: "biz",
        confidence: 0.99,
        stage: null,
        estimatedValue: null,
        client: null,
        duplicateOf: [],
        terminalFlag: null,
      },
    ]);

    const result = await AISyncReviewer.reviewUnmatchedEmails(
      [unmatchedEmail, secondEmail],
      connection,
      companyContext
    );

    expect(result.newLeadsClassified).toBe(0);
    expect(result.classifiedLeads).toEqual([]);
  });
});
