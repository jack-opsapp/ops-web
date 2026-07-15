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

const { openAICreateMock, buildConversationStateMock, getProfileMock } =
  vi.hoisted(() => ({
    openAICreateMock: vi.fn(),
    buildConversationStateMock: vi.fn(),
    getProfileMock: vi.fn(),
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
});
