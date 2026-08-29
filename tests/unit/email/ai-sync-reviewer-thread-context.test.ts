import { beforeEach, describe, expect, it, vi } from "vitest";

import { AISyncReviewer } from "@/lib/api/services/ai-sync-reviewer";
import type { EmailConnection } from "@/lib/types/email-connection";
import type { NormalizedEmail } from "@/lib/api/services/email-provider";

/**
 * Bug d1eaebe1 — Stage B.
 *
 * Stage A judges one message. Stage B re-reads the whole thread, the company's
 * own replies included, and its verdict wins. A thread Stage B could not verify
 * keeps its Stage-A verdict but loses the confidence to auto-create, which lands
 * it in the new borderline review band instead of silently becoming a client.
 */

const createMock = vi.hoisted(() => vi.fn());
const fetchThreadMock = vi.hoisted(() => vi.fn());
const isAIFeatureEnabledMock = vi.hoisted(() => vi.fn());
const classifyBatchMock = vi.hoisted(() => vi.fn());
const reclassifyMock = vi.hoisted(() => vi.fn());
const evaluateLeadFeedbackPriorBatchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/services/openai-clients", () => ({
  getSyncOpenAI: () => ({ chat: { completions: { create: createMock } } }),
}));

vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: { isAIFeatureEnabled: isAIFeatureEnabledMock },
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: { getProvider: () => ({ fetchThread: fetchThreadMock }) },
}));

vi.mock("@/lib/api/services/lead-feedback-prior-service", () => ({
  evaluateLeadFeedbackPriorBatch: evaluateLeadFeedbackPriorBatchMock,
}));

vi.mock("@/lib/api/services/email-ai-classifier", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/api/services/email-ai-classifier")
    >();
  return {
    ...actual,
    EmailAIClassifier: {
      ...actual.EmailAIClassifier,
      classifyBatch: classifyBatchMock,
      reclassifyWithThreadContext: reclassifyMock,
    },
  };
});

const connection = {
  id: "connection-1",
  companyId: "company-1",
  email: "canprojack@gmail.com",
  syncFilters: { aiClassificationThreshold: 0.7 },
} as unknown as EmailConnection;

const companyContext = {
  name: "Canpro Deck and Rail",
  industry: "decking",
  domains: ["canprodeckandrail.com"],
};

const providerLockCheckpoint = vi.fn(async () => {});
const mailboxOperation = { providerLockCheckpoint };

function email(over: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    id: "message-landlord",
    threadId: "thread-landlord",
    from: "Sally Bushby <sallyb@sleggs.com>",
    fromName: "Sally Bushby",
    to: ["canprojack@gmail.com"],
    cc: [],
    subject: "Door left open today (109-2031 malaview)",
    snippet: "The shop door was left open again",
    bodyText: "The shop door at 109-2031 Malaview was left open again.",
    date: new Date("2026-07-27T15:00:00.000Z"),
    labelIds: ["INBOX"],
    isRead: false,
    hasAttachments: false,
    sizeEstimate: 100,
    ...over,
  } as NormalizedEmail;
}

function operatorReply(): NormalizedEmail {
  return email({
    id: "message-operator",
    from: "canprojack@gmail.com",
    fromName: "Jackson",
    to: ["sallyb@sleggs.com"],
    subject: "Re: Door left open today (109-2031 malaview)",
    bodyText: "Sorry Sally — I'll make sure the crew locks up the unit.",
    date: new Date("2026-07-26T15:00:00.000Z"),
    labelIds: ["SENT"],
  });
}

function stageALead(confidence: number) {
  return [
    {
      id: "message-landlord",
      verdict: "lead" as const,
      confidence,
      stage: "new_lead",
      estimatedValue: null,
      client: null,
      duplicateOf: [],
      terminalFlag: null,
    },
  ];
}

function review(over: { mailbox?: typeof mailboxOperation } = {}) {
  return AISyncReviewer.reviewUnmatchedEmails(
    [email()],
    connection,
    companyContext,
    undefined,
    "mailbox" in over ? over.mailbox : mailboxOperation
  );
}

beforeEach(() => {
  createMock.mockReset();
  fetchThreadMock.mockReset();
  classifyBatchMock.mockReset();
  reclassifyMock.mockReset();
  providerLockCheckpoint.mockClear();
  isAIFeatureEnabledMock.mockReset();
  isAIFeatureEnabledMock.mockResolvedValue(true);

  // A two-message thread: the landlord plus the operator's own reply.
  fetchThreadMock.mockResolvedValue([operatorReply(), email()]);
  classifyBatchMock.mockResolvedValue(stageALead(0.95));

  evaluateLeadFeedbackPriorBatchMock.mockReset();
  evaluateLeadFeedbackPriorBatchMock.mockImplementation(
    async ({
      candidates,
      threshold,
    }: {
      candidates: Array<{
        baseline: { verdict: "lead" | "not_lead"; confidence: number };
      }>;
      threshold: number;
    }) =>
      candidates.map(({ baseline }) => ({
        outcome:
          baseline.verdict === "lead" && baseline.confidence >= threshold
            ? "lead"
            : "not_lead",
        adjustedLeadScore:
          baseline.verdict === "lead"
            ? baseline.confidence
            : 1 - baseline.confidence,
        adjustment: 0,
        reviewReason: null,
        appliedFeedbackIds: [],
        evidence: {
          exactMessage: false,
          exactThread: false,
          senderNegativeIndependentCount: 0,
          domainNegativeIndependentThreadCount: 0,
          domainNegativeIndependentSenderCount: 0,
          domainMature: false,
          hasSuppressionAuthority: false,
        },
      }))
  );
});

describe("Stage B replaces the single-message verdict", () => {
  it("suppresses the landlord lead once the full thread is read", async () => {
    reclassifyMock.mockResolvedValue([
      { id: "message-landlord", verdict: "personal_or_admin", confidence: 0.94 },
    ]);

    const result = await review();

    expect(reclassifyMock).toHaveBeenCalledTimes(1);
    expect(result.classifiedLeads).toEqual([]);
    expect(result.newLeadsClassified).toBe(0);
    // personal_or_admin is not-a-lead downstream, exactly like skip.
    const baseline =
      evaluateLeadFeedbackPriorBatchMock.mock.calls[0][0].candidates[0].baseline;
    expect(baseline).toEqual({ verdict: "not_lead", confidence: 0.94 });
  });

  it("hands the model both directions of the conversation", async () => {
    reclassifyMock.mockResolvedValue([
      { id: "message-landlord", verdict: "personal_or_admin", confidence: 0.9 },
    ]);

    await review();

    const items = reclassifyMock.mock.calls[0][0] as Array<{
      id: string;
      msgs: Array<{ dir: string; body: string }>;
    }>;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("message-landlord");
    expect(items[0].msgs.map((message) => message.dir)).toEqual([
      "YOU",
      "THEM",
    ]);
    expect(items[0].msgs[0].body).toContain("crew locks up");
  });

  it("keeps a genuine lead that the full thread confirms", async () => {
    reclassifyMock.mockResolvedValue([
      { id: "message-landlord", verdict: "lead", confidence: 0.91 },
    ]);

    const result = await review();

    expect(result.newLeadsClassified).toBe(1);
    expect(result.classifiedLeads[0]).toMatchObject({ confidence: 0.91 });
  });

  it("never re-checks a verdict that was not a lead", async () => {
    classifyBatchMock.mockResolvedValue([
      { ...stageALead(0.99)[0], verdict: "skip" as const },
    ]);

    await review();

    expect(reclassifyMock).not.toHaveBeenCalled();
    expect(fetchThreadMock).not.toHaveBeenCalled();
  });
});

describe("Stage B skips what it cannot learn from", () => {
  it("leaves a single-message thread to Stage A untouched", async () => {
    fetchThreadMock.mockResolvedValue([email()]);

    const result = await review();

    expect(reclassifyMock).not.toHaveBeenCalled();
    expect(result.classifiedLeads[0]).toMatchObject({ confidence: 0.95 });
  });

  it("does not touch the provider without a mailbox lease context", async () => {
    const result = await review({ mailbox: undefined });

    expect(fetchThreadMock).not.toHaveBeenCalled();
    expect(reclassifyMock).not.toHaveBeenCalled();
    expect(result.classifiedLeads[0]).toMatchObject({ confidence: 0.95 });
  });
});

describe("unverified leads lose the confidence to auto-create", () => {
  it("caps a Stage-A lead at 0.69 when the thread fetch fails", async () => {
    fetchThreadMock.mockRejectedValue(new Error("provider unavailable"));

    const result = await review();

    expect(result.classifiedLeads).toEqual([]);
    const baseline =
      evaluateLeadFeedbackPriorBatchMock.mock.calls[0][0].candidates[0].baseline;
    expect(baseline).toEqual({ verdict: "lead", confidence: 0.69 });
    expect(result.deferredClassifications).toHaveLength(1);
    expect(result.deferredClassifications[0].decision.reviewReason).toBe(
      "borderline_confidence"
    );
  });

  it("caps a Stage-A lead when the re-classification model fails", async () => {
    reclassifyMock.mockRejectedValue(new Error("model contract"));

    const result = await review();

    expect(result.classifiedLeads).toEqual([]);
    expect(result.deferredClassifications[0].baseline.confidence).toBe(0.69);
  });

  it("caps a Stage-A lead the model omitted from its response", async () => {
    reclassifyMock.mockResolvedValue([]);

    const result = await review();

    expect(result.deferredClassifications).toHaveLength(1);
    expect(result.deferredClassifications[0].baseline.confidence).toBe(0.69);
  });

  it("never lowers a confidence that was already below the ceiling", async () => {
    classifyBatchMock.mockResolvedValue(stageALead(0.55));
    fetchThreadMock.mockRejectedValue(new Error("provider unavailable"));

    const result = await review();

    expect(result.deferredClassifications[0].baseline.confidence).toBe(0.55);
  });
});

describe("the borderline review band", () => {
  it("defers a lead scored between the floor and the threshold", async () => {
    reclassifyMock.mockResolvedValue([
      { id: "message-landlord", verdict: "lead", confidence: 0.62 },
    ]);

    const result = await review();

    expect(result.classifiedLeads).toEqual([]);
    expect(result.deferredClassifications).toHaveLength(1);
    expect(result.deferredClassifications[0].decision).toMatchObject({
      outcome: "defer",
      reviewReason: "borderline_confidence",
    });
  });

  it("leaves a sub-floor verdict a silent non-lead", async () => {
    reclassifyMock.mockResolvedValue([
      { id: "message-landlord", verdict: "lead", confidence: 0.3 },
    ]);

    const result = await review();

    expect(result.classifiedLeads).toEqual([]);
    expect(result.deferredClassifications).toEqual([]);
  });

  it("still auto-creates an above-threshold lead — the optimistic bias stands", async () => {
    reclassifyMock.mockResolvedValue([
      { id: "message-landlord", verdict: "lead", confidence: 0.85 },
    ]);

    const result = await review();

    expect(result.newLeadsClassified).toBe(1);
    expect(result.deferredClassifications).toEqual([]);
  });

  it("does not manufacture a review band for a non-lead verdict", async () => {
    reclassifyMock.mockResolvedValue([
      { id: "message-landlord", verdict: "biz", confidence: 0.4 },
    ]);

    const result = await review();

    expect(result.classifiedLeads).toEqual([]);
    expect(result.deferredClassifications).toEqual([]);
  });
});
