import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bug 50645c94 — Phase C consults the company schedule before drafting a
 * scheduling reply.
 *
 * The contract under test:
 *   1. verified schedule facts reach the prompt in the TRUSTED zone (outside
 *      the untrusted-email envelope), never as customer-supplied data,
 *   2. the system prompt flips to the verified-schedule rule,
 *   3. an AUTONOMOUS draft whose schedule facts vanished between routing and
 *      drafting is HELD, never guessed at, and
 *   4. the response mode is surfaced on the result so auto-send can refuse it.
 */

type Row = Record<string, unknown>;

interface TestDatabase {
  tables: Record<string, Row[]>;
  inserts: Array<{ table: string; payload: Row }>;
}

let database: TestDatabase;

const {
  openAICreateMock,
  buildConversationStateMock,
  loadDraftScheduleContextMock,
  probeScheduleFactsAvailableMock,
  getProfileMock,
  phaseCEnabledMock,
  getMemoryContextMock,
  getCompanyContextMock,
  getClientContextMock,
  getPricingContextMock,
  getProjectContextMock,
  getPricingOptimizationMock,
  getSeasonalPatternsMock,
  getCashFlowProjectionMock,
  checkPermissionByIdMock,
  runReplyContextShadowMock,
} = vi.hoisted(() => ({
  openAICreateMock: vi.fn(),
  buildConversationStateMock: vi.fn(),
  loadDraftScheduleContextMock: vi.fn(),
  probeScheduleFactsAvailableMock: vi.fn(),
  getProfileMock: vi.fn(),
  phaseCEnabledMock: vi.fn(),
  getMemoryContextMock: vi.fn(),
  getCompanyContextMock: vi.fn(),
  getClientContextMock: vi.fn(),
  getPricingContextMock: vi.fn(),
  getProjectContextMock: vi.fn(),
  getPricingOptimizationMock: vi.fn(),
  getSeasonalPatternsMock: vi.fn(),
  getCashFlowProjectionMock: vi.fn(),
  checkPermissionByIdMock: vi.fn(),
  runReplyContextShadowMock: vi.fn(),
}));

vi.mock("@/lib/api/services/phase-c-reply-context-shadow", () => ({
  runPhaseCReplyContextShadow: runReplyContextShadowMock,
}));

vi.mock("@/lib/api/services/openai-clients", () => ({
  getDraftingOpenAI: () => ({
    chat: { completions: { create: openAICreateMock } },
  }),
}));

vi.mock("@/lib/api/services/writing-profile-service", () => ({
  WritingProfileService: {
    getProfile: getProfileMock,
    getConfidence: vi.fn(() => 0.8),
  },
}));

vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: { isAIFeatureEnabled: phaseCEnabledMock },
}));

vi.mock("@/lib/api/services/memory-service", () => ({
  MemoryService: { getContextForDraft: getMemoryContextMock },
}));

vi.mock("@/lib/api/services/business-context-service", () => ({
  BusinessContextService: {
    getCompanyContext: getCompanyContextMock,
    getClientContext: getClientContextMock,
    getPricingContext: getPricingContextMock,
    getProjectContext: getProjectContextMock,
  },
}));

vi.mock("@/lib/api/services/financial-intelligence-service", () => ({
  FinancialIntelligenceService: {
    getPricingOptimization: getPricingOptimizationMock,
    getSeasonalPatterns: getSeasonalPatternsMock,
    getCashFlowProjection: getCashFlowProjectionMock,
  },
}));

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: checkPermissionByIdMock,
}));

vi.mock("@/lib/api/services/conversation-state/conversation-state", () => ({
  buildConversationState: buildConversationStateMock,
}));

vi.mock("@/lib/api/services/conversation-state/persist-routing", () => ({
  persistRoutingDecision: vi.fn(async () => {}),
}));

vi.mock("@/lib/api/services/draft-schedule-context-service", () => ({
  loadDraftScheduleContext: loadDraftScheduleContextMock,
  probeScheduleFactsAvailable: probeScheduleFactsAvailableMock,
}));

vi.mock("@/lib/supabase/helpers", () => {
  function query(table: string) {
    const filters: Array<[string, unknown]> = [];
    let orderBy: { column: string; ascending: boolean } | null = null;
    let rowLimit: number | null = null;
    let operation: "select" | "insert" = "select";
    let insertPayload: Row | null = null;

    const matchingRows = () => {
      let rows = [...(database.tables[table] ?? [])].filter((row) =>
        filters.every(([column, value]) => row[column] === value)
      );
      if (orderBy) {
        const { column, ascending } = orderBy;
        rows.sort((left, right) => {
          const a = String(left[column] ?? "");
          const b = String(right[column] ?? "");
          const comparison = a < b ? -1 : a > b ? 1 : 0;
          return ascending ? comparison : -comparison;
        });
      }
      if (rowLimit != null) rows = rows.slice(0, rowLimit);
      return rows;
    };

    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = (column: string, value: unknown) => {
      filters.push([column, value]);
      return chain;
    };
    chain.order = (column: string, options: { ascending?: boolean } = {}) => {
      orderBy = { column, ascending: options.ascending !== false };
      return chain;
    };
    chain.limit = (value: number) => {
      rowLimit = value;
      return chain;
    };
    chain.insert = (payload: Row) => {
      operation = "insert";
      insertPayload = payload;
      database.inserts.push({ table, payload });
      return chain;
    };
    chain.maybeSingle = async () => {
      const rows = matchingRows();
      return { data: rows.length === 1 ? rows[0] : null, error: null };
    };
    chain.single = async () => {
      if (operation === "insert") {
        return {
          data: {
            id: (insertPayload?.id as string | undefined) ?? "draft-history-1",
          },
          error: null,
        };
      }
      const rows = matchingRows();
      return {
        data: rows.length === 1 ? rows[0] : null,
        error:
          rows.length === 1 ? null : { message: `expected one ${table} row` },
      };
    };
    chain.then = (
      resolve: (result: {
        data: Row[] | null;
        error: { message: string } | null;
      }) => void
    ) => resolve({ data: matchingRows(), error: null });

    return chain;
  }

  return {
    requireSupabase: () => ({ from: (table: string) => query(table) }),
  };
});

import { AIDraftService } from "@/lib/api/services/ai-draft-service";

const PROVIDER_THREAD_ID = "provider-thread-schedule";
const OPPORTUNITY_ID = "opportunity-schedule";

function customerMessage(body: string) {
  return {
    providerMessageId: "message-schedule",
    direction: "inbound" as const,
    partyRole: "customer" as const,
    fromEmail: "customer@example.com",
    fromName: "Customer",
    sentAt: "2026-09-01T10:00:00.000Z",
    cleanBody: body,
    rawBody: body,
    isRealCustomerInbound: true,
    attachments: [],
  };
}

function conversationState(
  responseMode: "schedule" | "answer",
  scheduleFactsAvailable: boolean | null
) {
  const message = customerMessage(
    responseMode === "schedule"
      ? "When can you fit us in?"
      : "What is the total on the estimate?"
  );
  return {
    threadId: "thread-schedule",
    connectionId: "connection-a",
    companyId: "company-1",
    operator: {
      emails: new Set(["owner@example.com"]),
      domains: new Set<string>(),
      phones: new Set<string>(),
      addresses: new Set<string>(),
      companyName: "Canpro",
    },
    recipient: { email: "customer@example.com", name: "Customer" },
    messages: [message],
    customerMessages: [message],
    contact: {
      name: "Customer",
      nameIsVerified: true,
      email: "customer@example.com",
      phone: null,
      address: null,
      provenance: [],
    },
    stage: "quoting",
    accept: {
      detected: false,
      confidence: "low",
      basis: [],
      evidenceMessageIds: [],
    },
    sentLedger: [],
    attachmentsRequiringInspection: [],
    scheduleFactsAvailable,
    routing: "draft",
    routingReasons: [],
    responseDisposition: "reply_required",
    responseMode,
    confidence: 0.9,
  };
}

function latestPrompt(role: "user" | "system"): string {
  const request = openAICreateMock.mock.calls.at(-1)?.[0] as
    | { messages?: Array<{ role: string; content: string }> }
    | undefined;
  return (
    request?.messages?.find((message) => message.role === role)?.content ?? ""
  );
}

function generate(over: Record<string, unknown> = {}) {
  return AIDraftService.generateDraft({
    companyId: "company-1",
    userId: "user-1",
    connectionId: "connection-a",
    threadId: PROVIDER_THREAD_ID,
    opportunityId: OPPORTUNITY_ID,
    ...over,
  } as Parameters<typeof AIDraftService.generateDraft>[0]);
}

beforeEach(() => {
  database = {
    tables: {
      activities: [
        {
          id: "activity-schedule",
          company_id: "company-1",
          opportunity_id: OPPORTUNITY_ID,
          email_connection_id: "connection-a",
          email_thread_id: PROVIDER_THREAD_ID,
          email_message_id: "message-schedule",
          type: "email",
          direction: "inbound",
          from_email: "customer@example.com",
          subject: "Timing",
          body_text: "When can you fit us in?",
          body_text_clean: "When can you fit us in?",
          created_at: "2026-09-01T10:00:00.000Z",
        },
      ],
      email_threads: [
        {
          id: "thread-schedule",
          company_id: "company-1",
          connection_id: "connection-a",
          provider_thread_id: PROVIDER_THREAD_ID,
        },
      ],
      opportunities: [
        {
          id: OPPORTUNITY_ID,
          company_id: "company-1",
          title: "Deck rebuild",
          ai_summary: null,
          stage: "quoting",
          address: null,
          contact_name: "Customer",
          contact_email: "customer@example.com",
          clients: { name: "Customer", email: "customer@example.com" },
        },
      ],
      ai_draft_history: [],
    },
    inserts: [],
  };

  buildConversationStateMock.mockReset();
  buildConversationStateMock.mockResolvedValue(
    conversationState("schedule", true)
  );
  loadDraftScheduleContextMock.mockReset();
  loadDraftScheduleContextMock.mockResolvedValue({
    available: true,
    facts: {
      timezone: "America/Vancouver",
      generatedAt: "2026-09-01T17:00:00.000Z",
      customerTasks: [],
      customerVisits: [],
      companyBusyDays: [],
    },
  });
  probeScheduleFactsAvailableMock.mockReset();
  probeScheduleFactsAvailableMock.mockResolvedValue(true);
  openAICreateMock.mockReset();
  openAICreateMock.mockResolvedValue({
    choices: [{ message: { content: "Generated reply" } }],
  });
  getProfileMock.mockReset();
  getProfileMock.mockResolvedValue({
    emails_analyzed: 10,
    greeting_patterns: ["Hi {name},"],
    closing_patterns: ["Thanks,"],
    tone_traits: {},
    avg_sentence_length: 12,
    formality_score: 0.5,
    vocabulary_preferences: {},
    subject_preferences: {},
  });
  phaseCEnabledMock.mockResolvedValue(false);
  checkPermissionByIdMock.mockResolvedValue(false);
  getMemoryContextMock.mockResolvedValue({
    relevantFacts: [],
    clientHistory: [],
    currentPromotions: [],
    pricingReferences: [],
  });
  getCompanyContextMock.mockResolvedValue({
    companyName: "Unknown",
    summary: "",
  });
  getClientContextMock.mockResolvedValue({ found: false, summary: "" });
  getPricingContextMock.mockResolvedValue({ services: [], summary: "" });
  getProjectContextMock.mockResolvedValue({ found: false, summary: "" });
  getPricingOptimizationMock.mockResolvedValue({ serviceAnalysis: [] });
  getSeasonalPatternsMock.mockResolvedValue({ peakMonths: [], slowMonths: [] });
  getCashFlowProjectionMock.mockResolvedValue({ outstanding: 0, overdue: 0 });
  runReplyContextShadowMock.mockReset();
  runReplyContextShadowMock.mockResolvedValue(null);
});

describe("AIDraftService — server-verified schedule context", () => {
  it("puts the schedule block in the TRUSTED zone, after the untrusted envelope", async () => {
    // A recognizable rendered block proves the pure renderer's output is what
    // travels, not a re-derivation inside the draft service.
    const { buildScheduleContextBlock } = await import(
      "@/lib/api/services/conversation-state/schedule-context"
    );
    const facts = {
      timezone: "America/Vancouver",
      generatedAt: "2026-09-01T17:00:00.000Z",
      customerTasks: [
        {
          title: "Deck framing",
          startDate: "2026-09-03",
          endDate: null,
          startTime: "09:00",
          allDay: false,
          confirmed: true,
        },
      ],
      customerVisits: [],
      companyBusyDays: [{ date: "2026-09-02", bookedCount: 3 }],
    };
    loadDraftScheduleContextMock.mockResolvedValue({ available: true, facts });

    const result = await generate();

    const prompt = latestPrompt("user");
    const envelopeEnd = prompt.indexOf("</UNTRUSTED_EMAIL_DATA_JSON>");
    const blockStart = prompt.indexOf(
      "Trusted server-verified schedule context:"
    );
    expect(envelopeEnd).toBeGreaterThan(-1);
    expect(blockStart).toBeGreaterThan(envelopeEnd);
    expect(prompt).toContain(buildScheduleContextBlock(facts));
    expect(prompt).toContain("- Deck framing — Thu, Sep 3 at 9:00 AM — confirmed");
    expect(result.available).toBe(true);
    expect(result.sources).toContain("verified_schedule");
  });

  it("never serializes the schedule block as untrusted customer data", async () => {
    await generate();

    const prompt = latestPrompt("user");
    const envelope = prompt.match(
      /<UNTRUSTED_EMAIL_DATA_JSON>\n([\s\S]*?)\n<\/UNTRUSTED_EMAIL_DATA_JSON>/
    );
    expect(envelope?.[1]).toBeTruthy();
    expect(envelope?.[1]).not.toContain("SERVER-VERIFIED SCHEDULE");
    expect(
      prompt.match(/<\/UNTRUSTED_EMAIL_DATA_JSON>/g)
    ).toHaveLength(1);
  });

  it("flips the system prompt to the verified-schedule rule", async () => {
    await generate();

    const systemPrompt = latestPrompt("system");
    expect(systemPrompt).toContain(
      "Answer the scheduling question using ONLY the server-verified schedule facts provided."
    );
    expect(systemPrompt).not.toContain(
      "No verified calendar context is present in this request."
    );
  });

  it("surfaces the response mode so auto-send can refuse a schedule reply", async () => {
    const result = await generate();
    expect(result.responseMode).toBe("schedule");
  });

  it("surfaces the response mode on a non-schedule reply too", async () => {
    buildConversationStateMock.mockResolvedValue(
      conversationState("answer", true)
    );

    const result = await generate();

    expect(result.responseMode).toBe("answer");
    expect(loadDraftScheduleContextMock).not.toHaveBeenCalled();
    expect(latestPrompt("user")).not.toContain(
      "Trusted server-verified schedule context:"
    );
    expect(result.sources).not.toContain("verified_schedule");
  });

  it("holds an AUTONOMOUS draft when the schedule became unreadable", async () => {
    loadDraftScheduleContextMock.mockResolvedValue({
      available: false,
      facts: null,
    });

    const result = await generate({ autonomous: true, origin: "phase_c" });

    expect(result.available).toBe(false);
    expect(result.heldForReview).toBe(true);
    expect(result.noReplyWarranted).toBe(false);
    expect(result.reason).toBe(
      "schedule context unavailable — held for review"
    );
    expect(result.responseMode).toBe("schedule");
    expect(openAICreateMock).not.toHaveBeenCalled();
  });

  it("still drafts a MANUAL schedule reply under the unverified ban", async () => {
    loadDraftScheduleContextMock.mockResolvedValue({
      available: false,
      facts: null,
    });

    const result = await generate();

    expect(result.available).toBe(true);
    expect(latestPrompt("user")).not.toContain(
      "Trusted server-verified schedule context:"
    );
    expect(latestPrompt("system")).toContain(
      "Do not propose or confirm a date until verified schedule context exists."
    );
    expect(result.sources).not.toContain("verified_schedule");
  });

  it("does not read the schedule when the lead has no opportunity", async () => {
    await generate({ opportunityId: undefined });
    expect(loadDraftScheduleContextMock).not.toHaveBeenCalled();
  });
});
