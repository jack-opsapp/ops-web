import { describe, expect, it } from "vitest";
import { deduplicateAnalyzedLeads } from "@/lib/email/import-lead-dedup";
import type { AnalyzedLead } from "@/lib/types/email-import";

function lead(overrides: Partial<AnalyzedLead>): AnalyzedLead {
  return {
    id: overrides.id ?? "lead-1",
    threadId: overrides.threadId ?? "thread-1",
    emails: overrides.emails ?? [],
    client: overrides.client ?? {
      name: "Liane Kern",
      email: "liane@example.com",
      phone: null,
      description: "",
      address: null,
    },
    stage: overrides.stage ?? "quoted",
    stageConfidence: overrides.stageConfidence ?? 0.5,
    estimatedValue: overrides.estimatedValue ?? null,
    correspondenceCount: overrides.correspondenceCount ?? 1,
    outboundCount: overrides.outboundCount ?? 0,
    lastMessageDate: overrides.lastMessageDate ?? "2026-06-01T00:00:00.000Z",
    source: overrides.source ?? "ai",
    sourceLabel: overrides.sourceLabel ?? "Email",
    duplicateGroupId: overrides.duplicateGroupId ?? null,
    subContacts: overrides.subContacts ?? [],
    emailExcerpts: overrides.emailExcerpts,
    matchResult: overrides.matchResult ?? {
      existingClientId: null,
      existingClientName: null,
      action: "create_new",
      confidence: "low",
    },
    enabled: overrides.enabled ?? true,
    terminalFlag: overrides.terminalFlag ?? null,
    needsReview: overrides.needsReview,
    reviewReason: overrides.reviewReason,
    mergeMode: overrides.mergeMode,
  };
}

describe("import-lead-dedup", () => {
  it("merges sibling threads by email and fills missing contact fields from the smaller thread", () => {
    const result = deduplicateAnalyzedLeads([
      lead({
        id: "primary",
        threadId: "thread-primary",
        correspondenceCount: 8,
        client: {
          name: "Liane Kern",
          email: "liane@example.com",
          phone: null,
          description: "Deck resurfacing estimate",
          address: null,
        },
      }),
      lead({
        id: "secondary",
        threadId: "thread-secondary",
        correspondenceCount: 2,
        client: {
          name: "Liane Kern",
          email: "liane@example.com",
          phone: "250 216 6119",
          description: "Accepted deck resurfacing estimate",
          address: "4204 Springridge Cres",
        },
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].client.phone).toBe("250 216 6119");
    expect(result[0].client.address).toBe("4204 Springridge Cres");
    expect(result[0].duplicateGroupId).toBe("thread-primary,thread-secondary");
  });

  it("preserves each provider message's raw thread when sibling leads merge", () => {
    const result = deduplicateAnalyzedLeads([
      lead({
        id: "primary",
        threadId: "thread-primary",
        providerThreadId: "thread-primary",
        correspondenceCount: 1,
        emails: [
          {
            id: "message-primary",
            providerThreadId: "thread-primary",
            from: "liane@example.com",
            subject: "Estimate request",
            date: "2026-06-01T00:00:00.000Z",
            direction: "inbound",
          },
        ],
      }),
      lead({
        id: "secondary",
        threadId: "thread-secondary",
        providerThreadId: "thread-secondary",
        correspondenceCount: 1,
        emails: [
          {
            id: "message-secondary",
            providerThreadId: "thread-secondary",
            from: "liane@example.com",
            subject: "Re: Estimate request",
            date: "2026-06-02T00:00:00.000Z",
            direction: "inbound",
          },
        ],
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].emails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "message-primary",
          providerThreadId: "thread-primary",
        }),
        expect.objectContaining({
          id: "message-secondary",
          providerThreadId: "thread-secondary",
        }),
      ])
    );
  });

  it("keeps the most terminal stage across duplicate siblings", () => {
    const result = deduplicateAnalyzedLeads([
      lead({
        id: "primary",
        threadId: "thread-primary",
        correspondenceCount: 8,
        stage: "quoted",
      }),
      lead({
        id: "secondary",
        threadId: "thread-secondary",
        correspondenceCount: 2,
        stage: "won",
        terminalFlag: "likely_won",
      }),
    ]);

    expect(result[0].stage).toBe("won");
    expect(result[0].terminalFlag).toBe("likely_won");
  });

  it("merges strong duplicate siblings by matching phone and address even when emails differ", () => {
    const result = deduplicateAnalyzedLeads([
      lead({
        id: "primary",
        threadId: "thread-primary",
        correspondenceCount: 5,
        client: {
          name: "Liane Kern",
          email: "liane@example.com",
          phone: null,
          description: "Deck resurfacing estimate",
          address: "4204 Springridge Crescent",
        },
      }),
      lead({
        id: "secondary",
        threadId: "thread-secondary",
        correspondenceCount: 1,
        client: {
          name: "Liane",
          email: "liane.kern@gmail.com",
          phone: "250 216 6119",
          description: "Accepted deck resurfacing estimate",
          address: "4204 Springridge Cres.",
        },
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].client.phone).toBe("250 216 6119");
    expect(result[0].duplicateGroupId).toBe("thread-primary,thread-secondary");
  });

  it.each([
    "Victoria",
    "Langford",
    "Esquimalt, BC",
    "Saanich Cedar Hill area",
  ])("never merges separate leads through locality-only metadata: %s", (address) => {
    const result = deduplicateAnalyzedLeads([
      lead({
        id: "paul",
        threadId: "thread-paul",
        client: {
          name: "Paul Holmes",
          email: "pwholmes64@icloud.com",
          phone: "2508883674",
          description: "New deck and railings",
          address,
        },
      }),
      lead({
        id: "sandra",
        threadId: "thread-sandra",
        client: {
          name: "Paul Holmes",
          email: "sdunford58@gmail.com",
          phone: "2508886537",
          description: "Vinyl deck quote",
          address,
        },
      }),
    ]);

    expect(result).toHaveLength(2);
  });

  it("keeps different units at one civic address separate", () => {
    const result = deduplicateAnalyzedLeads([
      lead({
        id: "unit-2",
        threadId: "thread-unit-2",
        client: {
          name: "Morgan Lee",
          email: "unit2@example.com",
          phone: null,
          description: "Unit 2 deck",
          address: "123 Main St Apt 2",
        },
      }),
      lead({
        id: "unit-3",
        threadId: "thread-unit-3",
        client: {
          name: "Morgan Lee",
          email: "unit3@example.com",
          phone: null,
          description: "Unit 3 deck",
          address: "123 Main St Apt 3",
        },
      }),
    ]);

    expect(result).toHaveLength(2);
  });

  it("does not collapse leads without an email into one duplicate group", () => {
    const result = deduplicateAnalyzedLeads([
      lead({
        id: "a",
        threadId: "thread-a",
        client: {
          name: "A",
          email: "",
          phone: null,
          description: "",
          address: null,
        },
      }),
      lead({
        id: "b",
        threadId: "thread-b",
        client: {
          name: "B",
          email: "",
          phone: null,
          description: "",
          address: null,
        },
      }),
    ]);

    expect(result).toHaveLength(2);
  });
});
