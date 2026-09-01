import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

let tables: Record<string, Row[]>;
let inserts: Array<{ table: string; payload: Row }>;

const { buildConversationStateMock, getProfileMock, openAICreateMock } =
  vi.hoisted(() => ({
    buildConversationStateMock: vi.fn(),
    getProfileMock: vi.fn(),
    openAICreateMock: vi.fn(),
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
    isAIFeatureEnabled: vi.fn(async () => false),
  },
}));

vi.mock("@/lib/api/services/memory-service", () => ({
  MemoryService: {
    getContextForDraft: vi.fn(async () => ({
      relevantFacts: [],
      clientHistory: [],
      currentPromotions: [],
      pricingReferences: [],
    })),
  },
}));

vi.mock("@/lib/api/services/business-context-service", () => ({
  BusinessContextService: {
    getCompanyContext: vi.fn(async () => ({ companyName: "OPS", summary: "" })),
    getClientContext: vi.fn(async () => ({ found: false, summary: "" })),
    getPricingContext: vi.fn(async () => ({ services: [], summary: "" })),
    getProjectContext: vi.fn(async () => ({ found: false, summary: "" })),
  },
}));

vi.mock("@/lib/api/services/financial-intelligence-service", () => ({
  FinancialIntelligenceService: {
    getPricingOptimization: vi.fn(async () => ({ serviceAnalysis: [] })),
    getSeasonalPatterns: vi.fn(async () => ({
      peakMonths: [],
      slowMonths: [],
    })),
    getCashFlowProjection: vi.fn(async () => ({ outstanding: 0, overdue: 0 })),
  },
}));

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: vi.fn(async () => false),
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
    let limit: number | null = null;
    let inserted: Row | null = null;

    const matchingRows = () => {
      const rows = [...(tables[table] ?? [])].filter((row) =>
        filters.every(([column, value]) => row[column] === value)
      );
      if (orderBy) {
        const { column, ascending } = orderBy;
        rows.sort((left, right) => {
          const a = String(left[column] ?? "");
          const b = String(right[column] ?? "");
          const compared = a < b ? -1 : a > b ? 1 : 0;
          return ascending ? compared : -compared;
        });
      }
      return limit === null ? rows : rows.slice(0, limit);
    };

    const chain = {
      select() {
        return chain;
      },
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return chain;
      },
      order(column: string, options: { ascending?: boolean } = {}) {
        orderBy = { column, ascending: options.ascending !== false };
        return chain;
      },
      limit(value: number) {
        limit = value;
        return chain;
      },
      insert(payload: Row) {
        inserted = payload;
        inserts.push({ table, payload });
        return chain;
      },
      async maybeSingle() {
        const rows = matchingRows();
        return {
          data: rows.length === 1 ? rows[0] : null,
          error: rows.length > 1 ? { message: "multiple rows" } : null,
        };
      },
      async single() {
        if (inserted) {
          return { data: { id: "draft-history-1" }, error: null };
        }
        const rows = matchingRows();
        return {
          data: rows.length === 1 ? rows[0] : null,
          error: rows.length === 1 ? null : { message: "row missing" },
        };
      },
      then(
        resolve: (value: { data: Row[]; error: null }) => void
      ): PromiseLike<unknown> {
        resolve({ data: matchingRows(), error: null });
        return Promise.resolve();
      },
    };
    return chain;
  }

  return {
    requireSupabase: () => ({ from: (table: string) => query(table) }),
  };
});

import { AIDraftService } from "@/lib/api/services/ai-draft-service";

const emailAccess = {
  allowed: true as const,
  actor: { userId: "user-1", companyId: "company-1" },
  operation: "send" as const,
  threadId: "thread-1",
  connectionId: "connection-1",
  providerThreadId: "provider-thread-1",
  opportunityId: "opportunity-1",
  connectionType: "company" as const,
  connectionOwnerId: null,
  pipelineScope: "assigned" as const,
  inboxScope: "assigned" as const,
  usedLegacyPipelineManage: false,
  usedLegacyInboxViewCompany: false,
};

function conversationState(
  routing: "draft" | "update_lead_only" | "require_human_review"
) {
  const inbound = {
    providerMessageId: "message-inbound",
    direction: "inbound",
    partyRole: "customer",
    fromEmail: "lead@example.com",
    fromName: "Lead",
    sentAt: "2026-06-01T10:00:00.000Z",
    cleanBody: "Could you send an estimate?",
    rawBody: "Could you send an estimate?",
    isRealCustomerInbound: true,
    attachments: [],
  };
  const outbound = {
    providerMessageId: "message-outbound",
    direction: "outbound",
    partyRole: "operator",
    fromEmail: "hello@company.test",
    fromName: "Alex",
    sentAt: "2026-06-01T11:00:00.000Z",
    cleanBody: "I sent the estimate over.",
    rawBody: "I sent the estimate over.",
    isRealCustomerInbound: false,
    attachments: [],
  };
  return {
    threadId: "thread-1",
    connectionId: "connection-1",
    companyId: "company-1",
    operator: {
      emails: new Set(["hello@company.test"]),
      domains: new Set<string>(),
      phones: new Set<string>(),
      addresses: new Set<string>(),
      companyName: "OPS",
    },
    recipient: { email: "lead@example.com", name: "Lead" },
    messages: [inbound, outbound],
    customerMessages: [inbound],
    contact: {
      name: "Lead",
      nameIsVerified: true,
      email: "lead@example.com",
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
    routing,
    routingReasons:
      routing === "update_lead_only"
        ? ["The operator sent the latest message."]
        : routing === "require_human_review"
          ? ["Intent is uncertain."]
          : ["Customer needs a reply."],
    responseDisposition:
      routing === "update_lead_only"
        ? "no_reply_required"
        : routing === "require_human_review"
          ? "operator_review"
          : "reply_required",
    responseMode: routing === "update_lead_only" ? "no_reply" : "answer",
    confidence: routing === "require_human_review" ? 0.4 : 0.95,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    companyId: "company-1",
    userId: "user-1",
    connectionId: "connection-1",
    opportunityId: "opportunity-1",
    threadId: "provider-thread-1",
    autonomous: true,
    origin: "phase_c" as const,
    profileTypeOverride: "client_followup",
    emailAccess,
    draftPurpose: { kind: "operational_outbound" as const },
    signatureWillBeAppended: true,
    autonomousRoutingAuthority: "phase_c_stale_lead_follow_up" as const,
    userInstruction: "Write one brief follow-up.",
    ...overrides,
  };
}

describe("AIDraftService operational routing authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tables = {
      email_threads: [
        {
          id: "thread-1",
          company_id: "company-1",
          connection_id: "connection-1",
          provider_thread_id: "provider-thread-1",
        },
      ],
      opportunities: [
        {
          id: "opportunity-1",
          company_id: "company-1",
          title: "Deck estimate",
          stage: "quoting",
          address: "18 Cedar Road",
          contact_name: "Lead",
          contact_email: "lead@example.com",
          clients: { name: "Lead", email: "lead@example.com" },
        },
      ],
      activities: [
        {
          id: "activity-inbound",
          company_id: "company-1",
          opportunity_id: "opportunity-1",
          email_connection_id: "connection-1",
          email_thread_id: "provider-thread-1",
          email_message_id: "message-inbound",
          type: "email",
          direction: "inbound",
          from_email: "lead@example.com",
          to_emails: ["hello@company.test"],
          cc_emails: [],
          subject: "Estimate",
          body_text: "Could you send an estimate?",
          body_text_clean: "Could you send an estimate?",
          created_at: "2026-06-01T10:00:00.000Z",
        },
        {
          id: "activity-outbound",
          company_id: "company-1",
          opportunity_id: "opportunity-1",
          email_connection_id: "connection-1",
          email_thread_id: "provider-thread-1",
          email_message_id: "message-outbound",
          type: "email",
          direction: "outbound",
          from_email: "hello@company.test",
          to_emails: ["lead@example.com"],
          cc_emails: [],
          subject: "Re: Estimate",
          body_text: "I sent the estimate over.",
          body_text_clean: "I sent the estimate over.",
          created_at: "2026-06-01T11:00:00.000Z",
        },
      ],
      ai_draft_history: [],
    };
    inserts = [];
    buildConversationStateMock.mockResolvedValue(
      conversationState("update_lead_only")
    );
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
    openAICreateMock.mockResolvedValue({
      choices: [{ message: { content: "Just checking in on the estimate." } }],
    });
  });

  it("drafts the trusted stale-lead follow-up despite update-only conversation routing", async () => {
    const result = await AIDraftService.generateDraft(request());

    expect(result.available).toBe(true);
    expect(result.noReplyWarranted).not.toBe(true);
    expect(openAICreateMock).toHaveBeenCalledOnce();
    expect(inserts.some((entry) => entry.table === "ai_draft_history")).toBe(
      true
    );
  });

  it("preserves no-reply behavior for a conversation reply", async () => {
    const result = await AIDraftService.generateDraft(
      request({ draftPurpose: { kind: "conversation_reply" } })
    );

    expect(result).toMatchObject({
      available: false,
      noReplyWarranted: true,
    });
    expect(openAICreateMock).not.toHaveBeenCalled();
  });

  it("preserves human-review and unknown routing holds", async () => {
    buildConversationStateMock.mockResolvedValueOnce(
      conversationState("require_human_review")
    );
    const reviewed = await AIDraftService.generateDraft(request());

    buildConversationStateMock.mockResolvedValueOnce(null);
    const unknown = await AIDraftService.generateDraft(request());

    expect(reviewed).toMatchObject({ available: false, heldForReview: true });
    expect(unknown).toMatchObject({ available: false, heldForReview: true });
    expect(openAICreateMock).not.toHaveBeenCalled();
  });
});
