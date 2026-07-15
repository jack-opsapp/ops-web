import { afterEach, describe, expect, it, vi } from "vitest";

import type { NormalizedEmail } from "@/lib/api/services/email-provider";
import { EmailThreadService } from "@/lib/api/services/email-thread-service";
import { setSupabaseOverride } from "@/lib/supabase/helpers";

type Row = Record<string, unknown>;

interface State {
  connectionEmail: string;
  thread: Row | null;
  activities: Row[];
  dirtyThreads?: Row[];
}

function threadRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "thread-row-1",
    company_id: "company-1",
    connection_id: "connection-1",
    provider_thread_id: "provider-thread-1",
    primary_category: "CUSTOMER",
    category_confidence: 1,
    category_classifier_version: "deterministic-customer-v1",
    category_manually_set: false,
    category_classified_at: "2026-07-14T08:30:00.000Z",
    labels: [],
    subject: "Deck estimate",
    participants: ["customer@example.com", "office@example.com"],
    first_message_at: "2026-07-14T09:00:00.000Z",
    last_message_at: "2026-07-14T10:00:00.000Z",
    message_count: 2,
    unread_count: 1,
    latest_direction: "inbound",
    latest_sender_email: "customer@example.com",
    latest_sender_name: "Customer",
    latest_snippet: "Stale cache value",
    opportunity_id: "opportunity-1",
    client_id: null,
    archived_at: null,
    snoozed_until: null,
    ai_summary: null,
    next_commitment_due_at: null,
    has_unresolved_commitments: false,
    agent_blocking_question: null,
    created_at: "2026-07-14T09:00:01.000Z",
    updated_at: "2026-07-14T10:00:01.000Z",
    ...overrides,
  };
}

function activity(overrides: Partial<Row> = {}): Row {
  return {
    id: "activity-1",
    company_id: "company-1",
    email_connection_id: "connection-1",
    email_thread_id: "provider-thread-1",
    email_message_id: "message-1",
    type: "email",
    direction: "inbound",
    from_email: "customer@example.com",
    to_emails: ["office@example.com"],
    cc_emails: [],
    subject: "Deck estimate",
    content: "Initial customer question",
    body_text: "Initial customer question",
    created_at: "2026-07-14T09:00:00.000Z",
    is_read: false,
    ...overrides,
  };
}

function email(overrides: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    id: "message-1",
    threadId: "provider-thread-1",
    from: "Customer <customer@example.com>",
    fromName: "Customer",
    to: ["office@example.com"],
    cc: [],
    subject: "Deck estimate",
    snippet: "Initial customer question",
    bodyText: "Initial customer question",
    date: new Date("2026-07-14T09:00:00.000Z"),
    labelIds: ["INBOX"],
    isRead: false,
    hasAttachments: false,
    sizeEstimate: 25,
    ...overrides,
  };
}

function makeSupabaseDouble(state: State) {
  class Query {
    private action: "select" | "insert" | "update" = "select";
    private payload: Row | null = null;
    private readonly filters = new Map<string, unknown>();

    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    ilike(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    in(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    is(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    order() {
      return this;
    }

    limit() {
      return this;
    }

    insert(payload: Row) {
      this.action = "insert";
      this.payload = payload;
      return this;
    }

    update(payload: Row) {
      this.action = "update";
      this.payload = payload;
      return this;
    }

    async maybeSingle() {
      if (this.table === "email_threads") {
        return { data: state.thread, error: null };
      }
      if (this.table === "email_connections") {
        return { data: { email: state.connectionEmail }, error: null };
      }
      return { data: null, error: null };
    }

    async single() {
      if (this.table === "email_threads" && this.action === "update") {
        state.thread = { ...state.thread, ...this.payload };
        return { data: state.thread, error: null };
      }
      if (this.table === "email_threads" && this.action === "insert") {
        state.thread = threadRow({
          message_count: 1,
          unread_count: 0,
          ...this.payload,
        });
        return { data: state.thread, error: null };
      }
      return { data: null, error: null };
    }

    async then(resolve: (value: unknown) => unknown) {
      if (this.table === "activities") {
        const rows = state.activities.filter((row) =>
          [...this.filters].every(
            ([column, expected]) => row[column] === expected
          )
        );
        return resolve({ data: rows, error: null });
      }
      if (this.table === "email_threads" && state.dirtyThreads) {
        return resolve({ data: state.dirtyThreads, error: null });
      }
      return resolve({ data: [], error: null });
    }
  }

  return {
    from(table: string) {
      return new Query(table);
    },
  };
}

describe("EmailThreadService.upsertFromEmail message idempotency", () => {
  afterEach(() => {
    setSupabaseOverride(null);
    vi.restoreAllMocks();
  });

  it("derives counts and latest state from distinct mailbox-scoped activities on replay", async () => {
    const state: State = {
      connectionEmail: "office@example.com",
      thread: threadRow(),
      activities: [
        activity(),
        // Defensive duplicate: a provider message contributes only once.
        activity({ id: "activity-duplicate" }),
        activity({
          id: "activity-2",
          email_message_id: "message-2",
          direction: "outbound",
          from_email: "office@example.com",
          to_emails: ["customer@example.com"],
          content: "Latest outbound answer",
          body_text: "Latest outbound answer",
          created_at: "2026-07-14T10:00:00.000Z",
          is_read: true,
        }),
        // Same provider thread in another mailbox must never affect this cache.
        activity({
          id: "other-mailbox",
          email_connection_id: "connection-2",
          email_message_id: "message-other-mailbox",
          content: "Wrong mailbox",
          created_at: "2026-07-14T11:00:00.000Z",
        }),
        // Same connection/thread text in another tenant must also be excluded.
        activity({
          id: "other-company",
          company_id: "company-2",
          email_message_id: "message-other-company",
          content: "Wrong company",
          created_at: "2026-07-14T12:00:00.000Z",
        }),
      ],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    const replay = email();
    await EmailThreadService.upsertFromEmail({
      companyId: "company-1",
      connectionId: "connection-1",
      providerThreadId: "provider-thread-1",
      email: replay,
      direction: "inbound",
      opportunityId: "opportunity-1",
    });
    const secondReplay = await EmailThreadService.upsertFromEmail({
      companyId: "company-1",
      connectionId: "connection-1",
      providerThreadId: "provider-thread-1",
      email: replay,
      direction: "inbound",
      opportunityId: "opportunity-1",
    });

    expect(secondReplay.threadRow).toMatchObject({
      messageCount: 2,
      unreadCount: 1,
      lastMessageAt: new Date("2026-07-14T10:00:00.000Z"),
      latestDirection: "outbound",
      latestSenderEmail: "office@example.com",
      latestSnippet: "Latest outbound answer",
    });
  });

  it("retains sequential provider-backfill behavior when no activity ledger exists", async () => {
    const state: State = {
      connectionEmail: "office@example.com",
      thread: null,
      activities: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    await EmailThreadService.upsertFromEmail({
      companyId: "company-1",
      connectionId: "connection-1",
      providerThreadId: "provider-thread-1",
      email: email(),
      direction: "inbound",
    });
    const second = await EmailThreadService.upsertFromEmail({
      companyId: "company-1",
      connectionId: "connection-1",
      providerThreadId: "provider-thread-1",
      email: email({
        id: "message-2",
        from: "office@example.com",
        fromName: "Office",
        to: ["customer@example.com"],
        snippet: "Backfill second message",
        bodyText: "Backfill second message",
        date: new Date("2026-07-14T10:00:00.000Z"),
        labelIds: ["SENT"],
        isRead: true,
      }),
      direction: "outbound",
    });

    expect(second.threadRow).toMatchObject({
      messageCount: 2,
      unreadCount: 1,
      latestDirection: "outbound",
      latestSnippet: "Backfill second message",
    });
  });

  it("marks derived classification dirty when a newly delivered message refreshes an existing thread", async () => {
    const state: State = {
      connectionEmail: "office@example.com",
      thread: threadRow(),
      activities: [
        activity(),
        activity({
          id: "activity-2",
          email_message_id: "message-2",
          created_at: "2026-07-14T10:00:00.000Z",
        }),
        activity({
          id: "activity-3",
          email_message_id: "message-3",
          content: "New scope details",
          body_text: "New scope details",
          created_at: "2026-07-14T11:00:00.000Z",
        }),
      ],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

    const result = await EmailThreadService.upsertFromEmail({
      companyId: "company-1",
      connectionId: "connection-1",
      providerThreadId: "provider-thread-1",
      email: email({
        id: "message-3",
        snippet: "New scope details",
        bodyText: "New scope details",
        date: new Date("2026-07-14T11:00:00.000Z"),
      }),
      direction: "inbound",
      opportunityId: "opportunity-1",
      markClassificationDirty: true,
    });

    expect(result.threadRow.categoryClassifiedAt).toBeNull();
  });

  it("marks a replay dirty only when it repairs stale delivered state", async () => {
    const rows = [
      activity(),
      activity({
        id: "activity-2",
        email_message_id: "message-2",
        content: "Stale cache value",
        body_text: "Stale cache value",
        created_at: "2026-07-14T10:00:00.000Z",
        is_read: true,
      }),
    ];
    const stale: State = {
      connectionEmail: "office@example.com",
      thread: threadRow({
        message_count: 1,
        last_message_at: "2026-07-14T09:00:00.000Z",
      }),
      activities: rows,
    };
    setSupabaseOverride(makeSupabaseDouble(stale) as never);

    const repaired = await EmailThreadService.upsertFromEmail({
      companyId: "company-1",
      connectionId: "connection-1",
      providerThreadId: "provider-thread-1",
      email: email({
        id: "message-2",
        date: new Date("2026-07-14T10:00:00.000Z"),
      }),
      direction: "inbound",
      markClassificationDirty: false,
    });
    expect(repaired.threadRow.categoryClassifiedAt).toBeNull();

    const exact: State = {
      connectionEmail: "office@example.com",
      thread: threadRow(),
      activities: rows,
    };
    setSupabaseOverride(makeSupabaseDouble(exact) as never);
    const replayed = await EmailThreadService.upsertFromEmail({
      companyId: "company-1",
      connectionId: "connection-1",
      providerThreadId: "provider-thread-1",
      email: email(),
      direction: "inbound",
      markClassificationDirty: false,
    });
    expect(replayed.threadRow.categoryClassifiedAt).toEqual(
      new Date("2026-07-14T08:30:00.000Z")
    );
  });

  it("processes the durable dirty-summary queue within caller bounds", async () => {
    const first = threadRow({ id: "dirty-thread-1" });
    const second = threadRow({ id: "dirty-thread-2" });
    const state: State = {
      connectionEmail: "office@example.com",
      thread: null,
      activities: [],
      dirtyThreads: [first, second],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);
    const classify = vi
      .spyOn(EmailThreadService, "classifyAndUpdate")
      .mockImplementation(async (row) => {
        if (row.id === "dirty-thread-2") {
          throw new Error("temporary classifier failure");
        }
        return row;
      });

    const result = await EmailThreadService.retryDirtyClassifications({
      companyIds: ["company-1", "company-1"],
      limit: 10,
      concurrency: 2,
    });

    expect(classify).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ scanned: 2, classified: 1, errors: 1 });
  });
});
