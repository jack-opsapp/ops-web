import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AISyncReviewer,
  loadSenderHistoryFacts,
} from "@/lib/api/services/ai-sync-reviewer";
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

// Only the batch evaluator is faked. `normalizeLeadFeedbackEmail` is real —
// the sender-history loader parses candidate addresses with it.
vi.mock("@/lib/api/services/lead-feedback-prior-service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/api/services/lead-feedback-prior-service")
    >();
  return {
    ...actual,
    evaluateLeadFeedbackPriorBatch: evaluateLeadFeedbackPriorBatchMock,
  };
});

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

/**
 * Bug 7ca126d2 — the wire that was missing.
 *
 * Phase C already held every fact needed to keep Vitrum out of the pipeline:
 * threads classified VENDOR/RECEIPT, an operator discard as vendor_sales, and
 * five prior opportunities all terminal. Nothing carried it to the Stage B
 * decision. This loader does, in three batched queries per review — never one
 * per candidate — and it emits counts and enum words only.
 */
describe("loadSenderHistoryFacts", () => {
  const COMPANY = "company-1";
  const CHOWARD = "choward@vendor-glass.example";
  const CEDWARDS = "cedwards@vendor-glass.example";

  function historyClient(
    rows: Record<string, Array<Record<string, unknown>>> = {}
  ) {
    const tables: string[] = [];
    const orExpressions: string[] = [];
    const client = {
      from(table: string) {
        tables.push(table);
        const settled = Promise.resolve({
          data: rows[table] ?? [],
          error: null,
        });
        const builder: Record<string, unknown> = {};
        for (const method of ["select", "eq", "in"]) {
          builder[method] = () => builder;
        }
        builder.or = (expression: string) => {
          orExpressions.push(expression);
          return builder;
        };
        builder.limit = () => settled;
        return builder;
      },
    };
    return { client, tables, orExpressions };
  }

  it("reads exactly three tables once, however many senders it is given", async () => {
    const { client, tables } = historyClient();

    await loadSenderHistoryFacts({
      companyId: COMPANY,
      senderEmails: [
        `Cindi Howard <${CHOWARD}>`,
        `C Edwards <${CEDWARDS}>`,
        "Dee Yee <dyee@vendor-glass.example>",
      ],
      client: client as never,
    });

    expect(tables).toEqual([
      "email_threads",
      "lead_disposition_feedback",
      "opportunities",
    ]);
  });

  it("scans threads by domain with an escaped ilike filter", async () => {
    const { client, orExpressions } = historyClient();

    await loadSenderHistoryFacts({
      companyId: COMPANY,
      senderEmails: [CHOWARD],
      client: client as never,
    });

    expect(orExpressions).toEqual([
      "latest_sender_email.ilike.%@vendor-glass.example",
    ]);
  });

  it("folds the Vitrum shape into one system-verified fact keyed by sender", async () => {
    const { client } = historyClient({
      email_threads: [
        { latest_sender_email: CHOWARD, primary_category: "VENDOR" },
        { latest_sender_email: CHOWARD, primary_category: "RECEIPT" },
        { latest_sender_email: CHOWARD, primary_category: "VENDOR" },
        { latest_sender_email: CHOWARD, primary_category: "CUSTOMER" },
        { latest_sender_email: CEDWARDS, primary_category: "VENDOR" },
        { latest_sender_email: CEDWARDS, primary_category: "VENDOR" },
        { latest_sender_email: CHOWARD, primary_category: "MARKETING" },
      ],
      lead_disposition_feedback: [
        { sender_email: CHOWARD, reason_code: "vendor_sales" },
      ],
      opportunities: [
        { contact_email: CHOWARD, stage: "discarded", archived_at: null },
        { contact_email: CHOWARD, stage: "quoted", archived_at: "2026-07-30" },
      ],
    });

    const facts = await loadSenderHistoryFacts({
      companyId: COMPANY,
      senderEmails: [`Cindi Howard <${CHOWARD}>`],
      client: client as never,
    });

    const fact = facts.get(CHOWARD);
    expect(fact).toBeDefined();
    expect(fact).toContain(
      "3 prior threads from this sender are VENDOR/RECEIPT; 1 CUSTOMER."
    );
    expect(fact).toContain(
      "Across this sender's domain: 5 VENDOR/RECEIPT; 1 CUSTOMER."
    );
    expect(fact).toContain(
      "Operator discarded 1 prior lead from this sender as vendor_sales."
    );
    expect(fact).toContain(
      "whose 2 prior opportunities are all discarded, lost, won, or archived."
    );
    expect(fact!.length).toBeLessThanOrEqual(400);
  });

  it("reports a live opportunity instead of claiming everything is closed", async () => {
    const { client } = historyClient({
      email_threads: [
        { latest_sender_email: CHOWARD, primary_category: "VENDOR" },
      ],
      opportunities: [
        { contact_email: CHOWARD, stage: "quoted", archived_at: null },
        { contact_email: CHOWARD, stage: "lost", archived_at: null },
      ],
    });

    const fact = (
      await loadSenderHistoryFacts({
        companyId: COMPANY,
        senderEmails: [CHOWARD],
        client: client as never,
      })
    ).get(CHOWARD);

    expect(fact).toContain("1 live and 1 closed prior opportunities.");
    expect(fact).not.toContain("all discarded");
  });

  it("omits a sender the database says nothing about", async () => {
    const { client } = historyClient({
      email_threads: [
        { latest_sender_email: CEDWARDS, primary_category: "MARKETING" },
      ],
    });

    const facts = await loadSenderHistoryFacts({
      companyId: COMPANY,
      senderEmails: [CHOWARD],
      client: client as never,
    });

    expect(facts.size).toBe(0);
  });

  it("returns an empty map and reads nothing for unparseable senders", async () => {
    const { client, tables } = historyClient();

    const facts = await loadSenderHistoryFacts({
      companyId: COMPANY,
      senderEmails: ["not an address", ""],
      client: client as never,
    });

    expect(facts.size).toBe(0);
    expect(tables).toEqual([]);
  });
});
