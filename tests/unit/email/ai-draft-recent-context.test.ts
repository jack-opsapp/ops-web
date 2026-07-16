import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

interface TestDatabase {
  tables: Record<string, Row[]>;
  inserts: Array<{ table: string; payload: Row }>;
  draftHistoryInsertResult?: {
    data: Row | null;
    error: { message: string } | null;
  };
}

let database: TestDatabase;

const {
  openAICreateMock,
  buildConversationStateMock,
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
} = vi.hoisted(() => ({
  openAICreateMock: vi.fn(),
  buildConversationStateMock: vi.fn(),
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
  AdminFeatureOverrideService: {
    isAIFeatureEnabled: phaseCEnabledMock,
  },
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
    chain.select = (columns?: string) => {
      if (
        table === "opportunities" &&
        typeof columns === "string" &&
        /(?:^|,)\s*opportunity_ref\s*(?:,|$)/.test(columns)
      ) {
        throw new Error("opportunities.opportunity_ref does not exist");
      }
      return chain;
    };
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
      return {
        data: rows.length === 1 ? rows[0] : null,
        error:
          rows.length > 1
            ? { message: `expected one ${table} row, received ${rows.length}` }
            : null,
      };
    };
    chain.single = async () => {
      if (operation === "insert") {
        if (table === "ai_draft_history" && database.draftHistoryInsertResult) {
          return database.draftHistoryInsertResult;
        }
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
    chain.then = (resolve: (result: { data: Row[]; error: null }) => void) =>
      resolve({ data: matchingRows(), error: null });

    return chain;
  }

  return {
    requireSupabase: () => ({ from: (table: string) => query(table) }),
  };
});

import { AIDraftService } from "@/lib/api/services/ai-draft-service";

const SHARED_PROVIDER_THREAD_ID = "provider-thread-shared";

function threadRow(id: string, connectionId: string): Row {
  return {
    id,
    company_id: "company-1",
    connection_id: connectionId,
    provider_thread_id: SHARED_PROVIDER_THREAD_ID,
  };
}

function activityRow(
  connectionId: string,
  messageId: string,
  body: string,
  createdAt: string
): Row {
  return {
    company_id: "company-1",
    email_connection_id: connectionId,
    email_thread_id: SHARED_PROVIDER_THREAD_ID,
    type: "email",
    direction: "inbound",
    from_email: `${connectionId}-customer@example.com`,
    subject: `Subject ${messageId}`,
    body_text: body,
    created_at: createdAt,
    email_message_id: messageId,
  };
}

function latestUserPrompt(): string {
  const request = openAICreateMock.mock.calls.at(-1)?.[0] as
    | { messages?: Array<{ role: string; content: string }> }
    | undefined;
  return (
    request?.messages?.find((message) => message.role === "user")?.content ?? ""
  );
}

function latestSystemPrompt(): string {
  const request = openAICreateMock.mock.calls.at(-1)?.[0] as
    | { messages?: Array<{ role: string; content: string }> }
    | undefined;
  return (
    request?.messages?.find((message) => message.role === "system")?.content ??
    ""
  );
}

beforeEach(() => {
  database = {
    tables: {
      activities: [],
      email_threads: [
        threadRow("thread-a", "connection-a"),
        threadRow("thread-b", "connection-b"),
      ],
      ai_draft_history: [],
    },
    inserts: [],
  };
  buildConversationStateMock.mockReset();
  buildConversationStateMock.mockResolvedValue(null);
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
  getSeasonalPatternsMock.mockResolvedValue({
    peakMonths: [],
    slowMonths: [],
  });
  getCashFlowProjectionMock.mockResolvedValue({ outstanding: 0, overdue: 0 });
});

describe("AIDraftService recent mailbox context", () => {
  it("uses only the requested connection when two mailboxes share a provider thread id", async () => {
    database.tables.activities = [
      activityRow(
        "connection-a",
        "message-a",
        "PRIVATE_MAILBOX_A_CONTENT",
        "2026-07-14T10:00:00.000Z"
      ),
      activityRow(
        "connection-b",
        "message-b",
        "MAILBOX_B_CONTENT",
        "2026-07-14T11:00:00.000Z"
      ),
    ];

    const result = await AIDraftService.generateDraft({
      companyId: "company-1",
      userId: "user-1",
      connectionId: "connection-b",
      threadId: SHARED_PROVIDER_THREAD_ID,
      recipientEmail: "connection-b-customer@example.com",
      recipientName: "Mailbox B customer",
    });

    expect(result.available).toBe(true);
    expect(result.sourceMessageId).toBe("message-b");
    expect(result.subjectSource).toBe("thread");
    expect(latestUserPrompt()).toContain("MAILBOX_B_CONTENT");
    expect(latestUserPrompt()).not.toContain("PRIVATE_MAILBOX_A_CONTENT");
    expect(buildConversationStateMock).toHaveBeenCalledWith("thread-b");

    const historyInsert = database.inserts.find(
      (entry) => entry.table === "ai_draft_history"
    );
    expect(historyInsert?.payload).toMatchObject({
      connection_id: "connection-b",
      source_message_id: "message-b",
      subject_source: "thread",
    });
  });

  it("records an operator-specified new-thread subject as operator provenance", async () => {
    const result = await AIDraftService.generateDraft({
      companyId: "company-1",
      userId: "user-1",
      connectionId: "connection-b",
      recipientEmail: "customer@example.com",
      subject: "Site visit availability",
      origin: "operator",
    });

    expect(result.subject).toBe("Site visit availability");
    expect(result.subjectSource).toBe("operator");
    expect(database.inserts.at(-1)?.payload).toMatchObject({
      subject: "Site visit availability",
      subject_source: "operator",
    });
  });

  it("records a configured new-thread subject without relabeling it as operator", async () => {
    const result = await AIDraftService.generateDraft({
      companyId: "company-1",
      userId: "user-1",
      connectionId: "connection-b",
      recipientEmail: "customer@example.com",
      configuredSubject: "Appointment confirmation",
      origin: "system_handoff",
    });

    expect(result.subject).toBe("Appointment confirmation");
    expect(result.subjectSource).toBe("configured");
    expect(database.inserts.at(-1)?.payload).toMatchObject({
      subject: "Appointment confirmation",
      subject_source: "configured",
    });
  });

  it("materializes a qualifying learned template with only the current recipient context", async () => {
    getProfileMock.mockResolvedValue({
      emails_analyzed: 10,
      greeting_patterns: ["Hi {name},"],
      closing_patterns: ["Thanks,"],
      tone_traits: {},
      avg_sentence_length: 12,
      formality_score: 0.5,
      vocabulary_preferences: {},
      subject_preferences: {
        preferred_patterns: [
          {
            pattern: "{contact} deck quote",
            count: 4,
            examples: ["{contact} deck quote"],
            last_promoted_at: "2026-07-14T00:00:00.000Z",
          },
        ],
      },
    });

    const result = await AIDraftService.generateDraft({
      companyId: "company-1",
      userId: "user-1",
      connectionId: "connection-b",
      recipientEmail: "jordan@example.com",
      recipientName: "Jordan Lee",
    });

    expect(result.subject).toBe("Jordan Lee deck quote");
    expect(result.subject).not.toContain("Sarah Jones");
    expect(result.subjectSource).toBe("learned");
    expect(database.inserts.at(-1)?.payload).toMatchObject({
      subject: "Jordan Lee deck quote",
      subject_source: "learned",
    });
  });

  it("keeps the current opportunity contact distinct from its client company", async () => {
    database.tables.opportunities = [
      {
        id: "opportunity-1",
        company_id: "company-1",
        title: "Warehouse deck replacement",
        ai_summary: null,
        stage: "new",
        address: "18 Cedar Road",
        contact_name: "Jordan Lee",
        contact_email: "jordan@northshore.example",
        clients: {
          name: "North Shore Decks",
          email: "office@northshore.example",
        },
      },
    ];
    getProfileMock.mockResolvedValue({
      emails_analyzed: 10,
      greeting_patterns: ["Hi {name},"],
      closing_patterns: ["Thanks,"],
      tone_traits: {},
      avg_sentence_length: 12,
      formality_score: 0.5,
      vocabulary_preferences: {},
      subject_preferences: {
        preferred_patterns: [
          {
            pattern: "{contact} at {company} — {project}",
            count: 3,
            examples: ["{contact} at {company} — {project}"],
            last_promoted_at: "2026-07-14T00:00:00.000Z",
          },
        ],
      },
    });

    const result = await AIDraftService.generateDraft({
      companyId: "company-1",
      userId: "user-1",
      connectionId: "connection-b",
      opportunityId: "opportunity-1",
    });

    expect(result.subject).toBe(
      "Jordan Lee at North Shore Decks — Warehouse deck replacement"
    );
    expect(result.subjectSource).toBe("learned");
  });

  it("ignores legacy raw exact subjects for a different new recipient", async () => {
    getProfileMock.mockResolvedValue({
      emails_analyzed: 10,
      greeting_patterns: ["Hi {name},"],
      closing_patterns: ["Thanks,"],
      tone_traits: {},
      avg_sentence_length: 12,
      formality_score: 0.5,
      vocabulary_preferences: {},
      subject_preferences: { recent_exact: ["Sarah Jones deck quote"] },
    });

    const result = await AIDraftService.generateDraft({
      companyId: "company-1",
      userId: "user-1",
      connectionId: "connection-b",
      recipientEmail: "customer@example.com",
    });

    expect(result.subject).toBe("Your inquiry");
    expect(result.subjectSource).toBe("fallback");
    expect(database.inserts.at(-1)?.payload).toMatchObject({
      subject: "Your inquiry",
      subject_source: "fallback",
    });
  });

  it("throws when draft-history persistence fails", async () => {
    database.draftHistoryInsertResult = {
      data: null,
      error: { message: "subject source violates check constraint" },
    };

    await expect(
      AIDraftService.generateDraft({
        companyId: "company-1",
        userId: "user-1",
        connectionId: "connection-b",
        recipientEmail: "customer@example.com",
      })
    ).rejects.toThrow(
      "Failed to persist AI draft history: subject source violates check constraint"
    );
  });

  it("throws when draft-history persistence returns no row id", async () => {
    database.draftHistoryInsertResult = { data: {}, error: null };

    await expect(
      AIDraftService.generateDraft({
        companyId: "company-1",
        userId: "user-1",
        connectionId: "connection-b",
        recipientEmail: "customer@example.com",
      })
    ).rejects.toThrow(
      "Failed to persist AI draft history: insert returned no id"
    );
  });

  it("uses the newest 20 messages and preserves chronological prompt order", async () => {
    database.tables.email_threads = [threadRow("thread-b", "connection-b")];
    database.tables.activities = Array.from({ length: 30 }, (_, index) => {
      const sequence = index + 1;
      const padded = String(sequence).padStart(2, "0");
      return activityRow(
        "connection-b",
        `message-${padded}`,
        `CONTENT_${padded}_END`,
        new Date(Date.UTC(2026, 0, 1, sequence)).toISOString()
      );
    });

    const result = await AIDraftService.generateDraft({
      companyId: "company-1",
      userId: "user-1",
      connectionId: "connection-b",
      threadId: SHARED_PROVIDER_THREAD_ID,
      recipientEmail: "connection-b-customer@example.com",
    });

    const prompt = latestUserPrompt();
    const fullThread = prompt.split("Full thread (oldest first):\n")[1] ?? "";
    expect(result.sourceMessageId).toBe("message-30");
    expect(fullThread.match(/CONTENT_\d{2}_END/g)).toEqual(
      Array.from(
        { length: 20 },
        (_, index) => `CONTENT_${String(index + 11).padStart(2, "0")}_END`
      )
    );
  });

  it("uses canonical lead identity and withholds unrelated business corpora from an assigned actor", async () => {
    phaseCEnabledMock.mockResolvedValue(true);
    database.tables.companies = [
      {
        id: "company-1",
        name: "Canpro",
        description: "Deck and renovation specialists",
        address: "1515 Douglas Street",
        phone: "250-555-0100",
        email: "office@canpro.example",
        website: "https://canpro.example",
        internal_financial_secret: "UNRELATED_COMPANY_FINANCIAL_SECRET",
      },
    ];
    database.tables.opportunities = [
      {
        id: "opportunity-canonical",
        company_id: "company-foreign",
        title: "FOREIGN_COMPANY_LEAD",
        ai_summary: "FOREIGN_COMPANY_SUMMARY",
        stage: "quoting",
        address: "999 Foreign Road",
        contact_name: "Foreign Client",
        contact_email: "foreign@example.com",
        clients: { name: "Foreign Company", email: "foreign@example.com" },
      },
      {
        id: "opportunity-canonical",
        company_id: "company-1",
        title: "Exact assigned inquiry",
        ai_summary: "Replace the exact lead's cedar stairs",
        stage: "quoting",
        address: "18 Cedar Road",
        contact_name: "Jordan Lee",
        contact_email: "jordan@example.com",
        clients: { name: "North Shore", email: "office@northshore.example" },
      },
    ];
    database.tables.activities = [
      {
        company_id: "company-1",
        email_connection_id: "connection-canonical",
        email_thread_id: "provider-thread-canonical",
        type: "email",
        direction: "inbound",
        from_email: "jordan@example.com",
        subject: "Cedar stair quote",
        body_text: "EXACT_LEAD_MESSAGE Please price the cedar stairs.",
        created_at: "2026-07-15T10:00:00.000Z",
        email_message_id: "message-canonical",
      },
    ];
    database.tables.email_threads = [
      {
        id: "thread-canonical",
        company_id: "company-1",
        connection_id: "connection-canonical",
        provider_thread_id: "provider-thread-canonical",
      },
    ];
    getMemoryContextMock.mockResolvedValue({
      relevantFacts: [
        {
          id: "memory-exact",
          type: "fact",
          category: "limitation",
          content: "EXACT_ACTOR_MEMORY",
          confidence: 1,
          source: "email",
        },
      ],
      clientHistory: [],
      currentPromotions: [],
      pricingReferences: [],
    });
    getCompanyContextMock.mockResolvedValue({
      companyName: "Canpro",
      summary: "UNRELATED_COMPANY_TEAM_AND_PROJECT_STATS",
    });
    getClientContextMock.mockResolvedValue({
      found: true,
      summary: "UNRELATED_CLIENT_FINANCIAL_HISTORY",
      invoices: { overdue: 3, overdueAmount: 42000 },
    });
    getPricingContextMock.mockResolvedValue({
      services: [{ serviceName: "Private rate" }],
      summary: "UNRELATED_COMPANY_PRICING_CORPUS",
    });
    getProjectContextMock.mockResolvedValue({
      found: true,
      summary: "UNRELATED_PROJECT_FINANCIALS",
    });
    getPricingOptimizationMock.mockResolvedValue({
      serviceAnalysis: [
        {
          service: "Private service",
          winRate: 90,
          avgWinPrice: 50000,
        },
      ],
    });
    getCashFlowProjectionMock.mockResolvedValue({
      outstanding: 750000,
      overdue: 250000,
    });

    const emailAccess = {
      allowed: true as const,
      actor: { userId: "user-1", companyId: "company-1" },
      operation: "send" as const,
      threadId: "thread-canonical",
      connectionId: "connection-canonical",
      providerThreadId: "provider-thread-canonical",
      opportunityId: "opportunity-canonical",
      connectionType: "company" as const,
      connectionOwnerId: null,
      pipelineScope: "assigned" as const,
      inboxScope: "assigned" as const,
      usedLegacyPipelineManage: false,
      usedLegacyInboxViewCompany: false,
    };

    const result = await AIDraftService.generateDraft({
      companyId: "company-spoofed",
      userId: "user-spoofed",
      connectionId: "connection-spoofed",
      opportunityId: "opportunity-spoofed",
      threadId: "provider-thread-spoofed",
      recipientEmail: "unrelated-client@example.com",
      recipientName: "Unrelated Client",
      userInstruction: "Reply about the assigned quote",
      emailAccess,
    });

    expect(result.available).toBe(true);
    const prompt = `${latestSystemPrompt()}\n${latestUserPrompt()}`;
    expect(prompt).toContain("EXACT_LEAD_MESSAGE");
    expect(prompt).toContain("Exact assigned inquiry");
    expect(prompt).toContain("EXACT_ACTOR_MEMORY");
    expect(prompt).toContain("Company: Canpro");
    expect(prompt).toContain("Location: 1515 Douglas Street");
    expect(prompt).not.toContain("unrelated-client@example.com");
    expect(prompt).not.toContain("FOREIGN_COMPANY_LEAD");
    expect(prompt).not.toContain("UNRELATED_CLIENT_FINANCIAL_HISTORY");
    expect(prompt).not.toContain("UNRELATED_COMPANY_PRICING_CORPUS");
    expect(prompt).not.toContain("UNRELATED_PROJECT_FINANCIALS");
    expect(prompt).not.toContain("750000");
    expect(prompt).not.toContain("UNRELATED_COMPANY_FINANCIAL_SECRET");
    expect(getMemoryContextMock).toHaveBeenCalledWith(
      "company-1",
      "jordan@example.com",
      expect.stringContaining("Exact assigned inquiry"),
      {
        actorUserId: "user-1",
        exactSourceIds: ["provider-thread-canonical", "message-canonical"],
        includeClientHistory: false,
      }
    );
    expect(getClientContextMock).not.toHaveBeenCalled();
    expect(getPricingContextMock).not.toHaveBeenCalled();
    expect(getProjectContextMock).not.toHaveBeenCalled();
    expect(getPricingOptimizationMock).not.toHaveBeenCalled();
    expect(getSeasonalPatternsMock).not.toHaveBeenCalled();
    expect(getCashFlowProjectionMock).not.toHaveBeenCalled();
    expect(checkPermissionByIdMock).toHaveBeenCalledWith(
      "user-1",
      "projects.view_financials",
      "all"
    );
    expect(checkPermissionByIdMock).not.toHaveBeenCalledWith(
      "user-spoofed",
      expect.any(String),
      expect.any(String)
    );
    expect(database.inserts.at(-1)?.payload).toMatchObject({
      company_id: "company-1",
      user_id: "user-1",
      connection_id: "connection-canonical",
      opportunity_id: "opportunity-canonical",
      thread_id: "provider-thread-canonical",
    });
  });
});
