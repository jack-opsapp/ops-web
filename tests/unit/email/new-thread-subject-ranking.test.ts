import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASSIGNED_CONTACT_FORM_REVIEW_SUBJECT } from "@/lib/api/services/conversation-state/source-bound-autonomous-routing";
import { chooseNewThreadSubject } from "@/lib/email/email-subject-policy";

type Row = Record<string, unknown>;

interface TestDatabase {
  tables: Record<string, Row[]>;
  inserts: Array<{ table: string; payload: Row }>;
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
  runReplyContextShadowMock,
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

const CONTACT_FORM_OPPORTUNITY: Row = {
  id: "opportunity-form",
  company_id: "company-1",
  title: "Sandra Dunford — Email inquiry",
  ai_summary: "New deck quote request.",
  stage: "new_lead",
  address: null,
  contact_name: "Sandra Dunford",
  contact_email: "sandra@example.com",
  clients: { name: "Sandra Dunford", email: "sandra@example.com" },
};

const CONTACT_FORM_ACTIVITY: Row = {
  id: "activity-form",
  company_id: "company-1",
  opportunity_id: "opportunity-form",
  email_connection_id: "connection-b",
  email_thread_id: "provider-form-thread",
  email_message_id: "message-form",
  type: "email",
  direction: "inbound",
  from_email: "office@example.com",
  subject: "New contact form submission",
  body_text: "Please quote a new deck at our home.",
  created_at: "2026-08-02T16:00:00.000Z",
};

function learnedProfile(patterns: Row[]): Row {
  return {
    emails_analyzed: 10,
    greeting_patterns: ["Hi {name},"],
    closing_patterns: ["Thanks,"],
    tone_traits: {},
    avg_sentence_length: 12,
    formality_score: 0.5,
    vocabulary_preferences: {},
    subject_preferences: { preferred_patterns: patterns },
  };
}

async function generateContactFormDraft(
  overrides: Record<string, unknown> = {}
) {
  return AIDraftService.generateDraft({
    companyId: "company-1",
    userId: "user-1",
    connectionId: "connection-b",
    opportunityId: "opportunity-form",
    sourceActivityId: "activity-form",
    profileTypeOverride: "client_new_inquiry",
    autonomous: true,
    origin: "phase_c",
    sourceBoundAutonomousRouting: "assigned_contact_form_review",
    emailAccess: {
      allowed: true,
      actor: { userId: "user-1", companyId: "company-1" },
      operation: "send",
      threadId: null,
      connectionId: "connection-b",
      providerThreadId: null,
      opportunityId: "opportunity-form",
      connectionType: "company",
      connectionOwnerId: null,
      pipelineScope: "assigned",
      inboxScope: "assigned",
      usedLegacyPipelineManage: false,
      usedLegacyInboxViewCompany: false,
    },
    ...overrides,
  } as Parameters<typeof AIDraftService.generateDraft>[0]);
}

beforeEach(() => {
  database = {
    tables: {
      activities: [CONTACT_FORM_ACTIVITY],
      opportunities: [CONTACT_FORM_OPPORTUNITY],
      email_threads: [],
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
  getProfileMock.mockResolvedValue(learnedProfile([]));
  phaseCEnabledMock.mockResolvedValue(false);
  checkPermissionByIdMock.mockResolvedValue(false);
  getMemoryContextMock.mockResolvedValue({
    relevantFacts: [],
    clientHistory: [],
    currentPromotions: [],
    pricingReferences: [],
  });
  getCompanyContextMock.mockResolvedValue({
    companyName: "Canpro Deck and Rail",
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

describe("new-thread subject ranking", () => {
  it("lets a learned subject outrank the server-owned contact-form fallback", async () => {
    getProfileMock.mockResolvedValue(
      learnedProfile([
        {
          pattern: "Canpro Deck and Rail Estimate",
          count: 29,
          examples: ["Canpro Deck and Rail Estimate"],
          last_promoted_at: "2026-08-01T00:00:00.000Z",
        },
      ])
    );

    const result = await generateContactFormDraft();

    expect(result.available).toBe(true);
    expect(result.subject).toBe("Canpro Deck and Rail Estimate");
    expect(result.subjectSource).toBe("learned");
    expect(database.inserts.at(-1)?.payload).toMatchObject({
      subject: "Canpro Deck and Rail Estimate",
      subject_source: "learned",
    });
  });

  it("keeps the operator's own configured subject ahead of a learned one", async () => {
    getProfileMock.mockResolvedValue(
      learnedProfile([
        {
          pattern: "Canpro Deck and Rail Estimate",
          count: 29,
          examples: ["Canpro Deck and Rail Estimate"],
          last_promoted_at: "2026-08-01T00:00:00.000Z",
        },
      ])
    );

    const result = await generateContactFormDraft({
      configuredSubject: "Your deck project with {name}",
    });

    expect(result.subject).toBe("Your deck project with Sandra Dunford");
    expect(result.subjectSource).toBe("configured");
  });

  it("uses the server-owned constant only as the last-resort fallback", async () => {
    const result = await generateContactFormDraft();

    expect(result.subject).toBe(ASSIGNED_CONTACT_FORM_REVIEW_SUBJECT);
    expect(result.subjectSource).toBe("fallback");
    expect(result.subject).not.toBe(CONTACT_FORM_OPPORTUNITY.title);
    expect(database.inserts.at(-1)?.payload).toMatchObject({
      subject: ASSIGNED_CONTACT_FORM_REVIEW_SUBJECT,
      subject_source: "fallback",
    });
  });

  it("never leaks the internal opportunity title into a contact-form subject", async () => {
    database.tables.opportunities = [
      { ...CONTACT_FORM_OPPORTUNITY, contact_name: "Sandra Dunford" },
    ];

    const result = await generateContactFormDraft();

    expect(result.subject).toBe(ASSIGNED_CONTACT_FORM_REVIEW_SUBJECT);
    expect(result.subject).not.toContain("Email inquiry");
  });

  it("keeps the generic new-thread fallback off the contact-form constant", async () => {
    database.tables.activities = [];
    database.tables.opportunities = [];

    const result = await AIDraftService.generateDraft({
      companyId: "company-1",
      userId: "user-1",
      connectionId: "connection-b",
      recipientEmail: "customer@example.com",
    });

    expect(result.subject).toBe("Your inquiry");
    expect(result.subjectSource).toBe("fallback");
  });
});

describe("chooseNewThreadSubject ranking contract", () => {
  it("returns the learned subject when no operator subject is configured", () => {
    expect(
      chooseNewThreadSubject({
        operatorSubject: null,
        configuredSubject: null,
        learnedSubject: "Canpro Deck and Rail Estimate",
        generatedSubject: null,
        fallback: ASSIGNED_CONTACT_FORM_REVIEW_SUBJECT,
      })
    ).toEqual({
      subject: "Canpro Deck and Rail Estimate",
      source: "learned",
    });
  });

  it("keeps a genuine configured subject ahead of a learned one", () => {
    expect(
      chooseNewThreadSubject({
        operatorSubject: null,
        configuredSubject: "Deck estimate for you",
        learnedSubject: "Canpro Deck and Rail Estimate",
        generatedSubject: null,
        fallback: ASSIGNED_CONTACT_FORM_REVIEW_SUBJECT,
      })
    ).toEqual({ subject: "Deck estimate for you", source: "configured" });
  });

  it("falls back to the server-owned constant when nothing else applies", () => {
    expect(
      chooseNewThreadSubject({
        operatorSubject: null,
        configuredSubject: null,
        learnedSubject: null,
        generatedSubject: null,
        fallback: ASSIGNED_CONTACT_FORM_REVIEW_SUBJECT,
      })
    ).toEqual({
      subject: ASSIGNED_CONTACT_FORM_REVIEW_SUBJECT,
      source: "fallback",
    });
  });
});
