import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

interface TestDatabase {
  tables: Record<string, Row[]>;
}

let database: TestDatabase;

const { fetchOperatorIdentityMock, fetchCommitmentsMock } = vi.hoisted(() => ({
  fetchOperatorIdentityMock: vi.fn(
    async (_companyId: string, connection: { email: string }) => ({
      emails: new Set([connection.email]),
      domains: new Set<string>(),
      phones: new Set<string>(),
      addresses: new Set<string>(),
      companyName: "OPS",
    })
  ),
  fetchCommitmentsMock: vi.fn(async () => []),
}));

vi.mock("@/lib/api/services/conversation-state/operator-identity", () => ({
  fetchOperatorIdentity: fetchOperatorIdentityMock,
}));

vi.mock("@/lib/api/services/conversation-state/sent-ledger", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/services/conversation-state/sent-ledger")
  >("@/lib/api/services/conversation-state/sent-ledger");
  return { ...actual, fetchCommitments: fetchCommitmentsMock };
});

vi.mock("@/lib/supabase/helpers", () => {
  function query(table: string) {
    const filters: Array<[string, unknown]> = [];
    let orderBy: { column: string; ascending: boolean } | null = null;
    let rowLimit: number | null = null;

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
    chain.then = (resolve: (result: { data: Row[]; error: null }) => void) =>
      resolve({ data: matchingRows(), error: null });

    return chain;
  }

  return {
    requireSupabase: () => ({ from: (table: string) => query(table) }),
  };
});

import { buildConversationState } from "@/lib/api/services/conversation-state/conversation-state";

const SHARED_PROVIDER_THREAD_ID = "provider-thread-shared";
const SHARED_PROVIDER_MESSAGE_ID = "provider-message-shared";

function threadRow(id: string, connectionId: string): Row {
  return {
    id,
    company_id: "company-1",
    connection_id: connectionId,
    provider_thread_id: SHARED_PROVIDER_THREAD_ID,
    opportunity_id: null,
  };
}

function connectionRow(id: string): Row {
  return {
    id,
    email: `${id}@operator.example`,
    sync_filters: {},
  };
}

function activityRow(
  connectionId: string,
  fromEmail: string,
  body: string,
  createdAt: string,
  providerMessageId = SHARED_PROVIDER_MESSAGE_ID
): Row {
  return {
    company_id: "company-1",
    email_connection_id: connectionId,
    email_thread_id: SHARED_PROVIDER_THREAD_ID,
    type: "email",
    email_message_id: providerMessageId,
    from_email: fromEmail,
    to_emails: [`${connectionId}@operator.example`],
    cc_emails: [],
    subject: `Subject for ${connectionId}`,
    body_text: body,
    body_text_clean: body,
    direction: "inbound",
    created_at: createdAt,
  };
}

function attachmentRow(connectionId: string, filename: string): Row {
  return {
    company_id: "company-1",
    connection_id: connectionId,
    provider_thread_id: SHARED_PROVIDER_THREAD_ID,
    message_id: SHARED_PROVIDER_MESSAGE_ID,
    attachment_id: `${connectionId}-attachment`,
    filename,
    mime_type: "image/jpeg",
    size_bytes: 100,
  };
}

beforeEach(() => {
  database = {
    tables: {
      email_threads: [
        threadRow("thread-a", "connection-a"),
        threadRow("thread-b", "connection-b"),
      ],
      email_connections: [
        connectionRow("connection-a"),
        connectionRow("connection-b"),
      ],
      activities: [],
      email_attachments: [],
      attachment_inspections: [],
      opportunities: [],
    },
  };
  fetchOperatorIdentityMock.mockClear();
  fetchCommitmentsMock.mockClear();
});

describe("buildConversationState mailbox isolation", () => {
  it("keeps messages and attachments inside the selected connection when provider ids collide", async () => {
    database.tables.activities = [
      activityRow(
        "connection-a",
        "customer-a@example.com",
        "Private mailbox A content",
        "2026-07-14T10:00:00.000Z"
      ),
      activityRow(
        "connection-b",
        "customer-b@example.com",
        "Mailbox B content",
        "2026-07-14T11:00:00.000Z"
      ),
    ];
    database.tables.email_attachments = [
      attachmentRow("connection-a", "private-a.jpg"),
      attachmentRow("connection-b", "mailbox-b.jpg"),
    ];

    const stateA = await buildConversationState("thread-a");
    const stateB = await buildConversationState("thread-b");

    expect(stateA?.messages).toHaveLength(1);
    expect(stateA?.messages[0]?.rawBody).toBe("Private mailbox A content");
    expect(
      stateA?.messages[0]?.attachments.map((item) => item.filename)
    ).toEqual(["private-a.jpg"]);
    expect(stateA?.recipient.email).toBe("customer-a@example.com");

    expect(stateB?.messages).toHaveLength(1);
    expect(stateB?.messages[0]?.rawBody).toBe("Mailbox B content");
    expect(
      stateB?.messages[0]?.attachments.map((item) => item.filename)
    ).toEqual(["mailbox-b.jpg"]);
    expect(stateB?.recipient.email).toBe("customer-b@example.com");
  });

  it("uses the newest 20 messages and returns them in chronological order", async () => {
    database.tables.email_threads = [threadRow("thread-b", "connection-b")];
    database.tables.email_connections = [connectionRow("connection-b")];
    database.tables.activities = Array.from({ length: 30 }, (_, index) => {
      const sequence = index + 1;
      return activityRow(
        "connection-b",
        "customer-b@example.com",
        `Conversation message ${String(sequence).padStart(2, "0")}`,
        new Date(Date.UTC(2026, 0, 1, sequence)).toISOString(),
        `message-${String(sequence).padStart(2, "0")}`
      );
    });

    const state = await buildConversationState("thread-b");

    expect(state?.messages.map((message) => message.providerMessageId)).toEqual(
      Array.from(
        { length: 20 },
        (_, index) => `message-${String(index + 11).padStart(2, "0")}`
      )
    );
  });
});
