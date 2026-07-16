import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsertFromEmail: vi.fn(),
  dismissAwaitingReply: vi.fn(),
  enqueueIfEnabled: vi.fn(),
  recordCorrespondenceEvent: vi.fn(),
}));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: {
    upsertFromEmail: mocks.upsertFromEmail,
    dismissAwaitingReply: mocks.dismissAwaitingReply,
  },
}));

vi.mock("@/lib/api/services/email-outbound-learning-service", () => ({
  EmailOutboundLearningService: class {
    enqueueIfEnabled = mocks.enqueueIfEnabled;
  },
}));

vi.mock("@/lib/api/services/opportunity-lifecycle-service", () => ({
  OpportunityLifecycleService: {
    recordCorrespondenceEvent: mocks.recordCorrespondenceEvent,
  },
}));

import { reconcileEmailSend } from "@/lib/api/services/email-send-reconciliation-service";
import type { EmailSendIntent } from "@/lib/api/services/email-send-intent-service";

interface State {
  activities: Array<Record<string, unknown>>;
  activityUpdates: Array<Record<string, unknown>>;
  canonicalThreadOwnerId: string | null;
  activityInsertError?: { code?: string; message: string } | null;
  activityLookupRows?: Array<Record<string, unknown>>;
}

const CONNECTION = {
  id: "connection-1",
  companyId: "company-1",
  userId: "connector-1",
  email: "info@canprodeckandrail.com",
  provider: "gmail" as const,
  type: "company" as const,
  status: "active" as const,
  opsLabelId: null,
  syncFilters: {
    companyDomains: ["canprodeckandrail.com"],
    userEmailAddresses: ["info@canprodeckandrail.com"],
  },
};

function intent(overrides: Partial<EmailSendIntent> = {}): EmailSendIntent {
  return {
    id: "intent-1",
    companyId: "company-1",
    idempotencyKey: "attempt-1",
    requestFingerprint: "f".repeat(64),
    actorUserId: "jason-user-id",
    initiatedBy: "operator",
    connectionId: "connection-1",
    opportunityId: "opp-1",
    assignmentVersion: 7,
    assignmentEventId: "assignment-event-7",
    sourceEmailThreadId: "email-thread-1",
    replyProviderThreadId: "provider-thread-1",
    inReplyTo: "provider-message-1",
    senderSwitched: false,
    toEmails: ["client@example.com"],
    ccEmails: [],
    subject: "Deck quote follow-up",
    authoredBody: "Checking in on the quote.",
    renderedBody: "Checking in on the quote.\n\n-- \nJason",
    contentType: "text",
    draftHistoryId: "draft-1",
    followUpDraftId: null,
    learningAuthority: "operator_approved",
    actorNameSnapshot: "Jason Zavarella",
    actorEmailSnapshot: "jason-login@example.com",
    clientFromAddressSnapshot: "info@canprodeckandrail.com",
    signatureId: "signature-1",
    signatureContentHash: "a".repeat(64),
    renderedBodyHash: "b".repeat(64),
    pendingAutoSendId: null,
    pendingAutoSendLeaseToken: null,
    profileTypeSnapshot: "sales_lead",
    status: "reconciling",
    providerMessageId: "sent-message-1",
    acceptedProviderThreadId: "sent-thread-1",
    providerAcceptedAt: "2026-07-15T18:01:00.000Z",
    reconciliationAttempts: 1,
    reconciliationLeaseToken: "lease-1",
    reconciliationLeaseExpiresAt: "2026-07-15T18:06:00.000Z",
    reconciledActivityId: null,
    reconciledAt: null,
    lastError: null,
    createdAt: "2026-07-15T18:00:00.000Z",
    updatedAt: "2026-07-15T18:01:00.000Z",
    ...overrides,
  };
}

function db(state: State) {
  class Query {
    private action: "select" | "insert" | "update" | "upsert" = "select";
    private payload: Record<string, unknown> | null = null;
    private filters = new Map<string, unknown>();

    constructor(private readonly table: string) {}
    select() {
      return this;
    }
    eq(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }
    limit() {
      return this;
    }
    insert(payload: Record<string, unknown>) {
      this.action = "insert";
      this.payload = payload;
      if (this.table === "activities" && !state.activityInsertError) {
        state.activities.push(payload);
      }
      return this;
    }
    update(payload: Record<string, unknown>) {
      this.action = "update";
      this.payload = payload;
      if (this.table === "activities") state.activityUpdates.push(payload);
      return this;
    }
    upsert(payload: Record<string, unknown>) {
      this.action = "upsert";
      this.payload = payload;
      if (this.table === "opportunity_email_threads") {
        state.canonicalThreadOwnerId ??=
          (payload.opportunity_id as string | null) ?? null;
      }
      return this;
    }
    async single() {
      if (this.table === "activities" && this.action === "insert") {
        return state.activityInsertError
          ? { data: null, error: state.activityInsertError }
          : { data: { id: "activity-1" }, error: null };
      }
      return { data: this.payload, error: null };
    }
    async maybeSingle() {
      if (this.table === "opportunity_email_threads") {
        return {
          data: state.canonicalThreadOwnerId
            ? { opportunity_id: state.canonicalThreadOwnerId }
            : null,
          error: null,
        };
      }
      return { data: null, error: null };
    }
    private result() {
      if (
        this.table === "activities" &&
        this.action === "select" &&
        this.filters.has("email_message_id")
      ) {
        return { data: state.activityLookupRows ?? [], error: null };
      }
      return { data: null, error: null };
    }
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve(this.result()).then(resolve);
    }
  }

  return {
    from: (table: string) => new Query(table),
    rpc: vi.fn(async () => ({ data: [{ changed: true }], error: null })),
  };
}

describe("accepted email reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordCorrespondenceEvent.mockResolvedValue({ created: true });
    mocks.upsertFromEmail.mockResolvedValue({
      threadRow: {
        id: "email-thread-1",
        latestDirection: "outbound",
        labels: ["AWAITING_REPLY"],
      },
    });
    mocks.dismissAwaitingReply.mockResolvedValue(["CUSTOMER"]);
    mocks.enqueueIfEnabled.mockResolvedValue(null);
  });

  it("writes the immutable provider identity with the actual OPS actor", async () => {
    const state: State = {
      activities: [],
      activityUpdates: [],
      canonicalThreadOwnerId: null,
    };
    const result = await reconcileEmailSend({
      supabase: db(state) as never,
      intent: intent(),
      connection: CONNECTION as never,
      provider: { applyLabel: vi.fn() },
    });

    expect(result).toMatchObject({
      activityId: "activity-1",
      providerMessageId: "sent-message-1",
      providerThreadId: "sent-thread-1",
      opportunityId: "opp-1",
    });
    expect(state.activities).toEqual([
      expect.objectContaining({
        company_id: "company-1",
        email_connection_id: "connection-1",
        email_message_id: "sent-message-1",
        email_thread_id: "sent-thread-1",
        opportunity_id: "opp-1",
        created_by: "jason-user-id",
        from_email: "info@canprodeckandrail.com",
        draft_history_id: "draft-1",
      }),
    ]);
    expect(mocks.recordCorrespondenceEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        opportunityId: "opp-1",
        connectionId: "connection-1",
        providerMessageId: "sent-message-1",
        direction: "outbound",
        fromName: "Jason Zavarella",
      })
    );
    expect(mocks.enqueueIfEnabled).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "jason-user-id",
        learningAuthority: "operator_approved",
        profileType: "sales_lead",
      })
    );
  });

  it("fails closed when the provider thread is already owned by another lead", async () => {
    const state: State = {
      activities: [],
      activityUpdates: [],
      canonicalThreadOwnerId: "opp-2",
    };

    await expect(
      reconcileEmailSend({
        supabase: db(state) as never,
        intent: intent(),
        connection: CONNECTION as never,
        provider: { applyLabel: vi.fn() },
      })
    ).rejects.toThrow("EMAIL_SEND_THREAD_OWNERSHIP_CONFLICT");
    expect(state.activities).toHaveLength(0);
    expect(mocks.recordCorrespondenceEvent).not.toHaveBeenCalled();
  });

  it("enriches a same-mailbox sync winner with the real actor and draft provenance", async () => {
    const state: State = {
      activities: [],
      activityUpdates: [],
      canonicalThreadOwnerId: null,
      activityInsertError: { code: "23505", message: "duplicate" },
      activityLookupRows: [
        {
          id: "activity-sync-winner",
          company_id: "company-1",
          email_connection_id: "connection-1",
          email_message_id: "sent-message-1",
          email_thread_id: "sent-thread-1",
          opportunity_id: null,
          type: "email",
          direction: "outbound",
        },
      ],
    };

    const result = await reconcileEmailSend({
      supabase: db(state) as never,
      intent: intent(),
      connection: CONNECTION as never,
      provider: { applyLabel: vi.fn() },
    });

    expect(result.activityId).toBe("activity-sync-winner");
    expect(state.activityUpdates).toEqual([
      {
        opportunity_id: "opp-1",
        created_by: "jason-user-id",
        draft_history_id: "draft-1",
      },
    ]);
  });

  it.each([
    {
      label: "another mailbox",
      rows: [
        {
          id: "wrong-mailbox",
          company_id: "company-1",
          email_connection_id: "connection-2",
          email_message_id: "sent-message-1",
          email_thread_id: "sent-thread-1",
          opportunity_id: null,
          type: "email",
          direction: "outbound",
        },
      ],
    },
    {
      label: "another lead",
      rows: [
        {
          id: "wrong-lead",
          company_id: "company-1",
          email_connection_id: "connection-1",
          email_message_id: "sent-message-1",
          email_thread_id: "sent-thread-1",
          opportunity_id: "opp-2",
          type: "email",
          direction: "outbound",
        },
      ],
    },
    { label: "ambiguous duplicates", rows: [{ id: "one" }, { id: "two" }] },
  ])("does not adopt a sync winner from $label", async ({ rows }) => {
    const state: State = {
      activities: [],
      activityUpdates: [],
      canonicalThreadOwnerId: null,
      activityInsertError: { code: "23505", message: "duplicate" },
      activityLookupRows: rows,
    };

    await expect(
      reconcileEmailSend({
        supabase: db(state) as never,
        intent: intent(),
        connection: CONNECTION as never,
        provider: { applyLabel: vi.fn() },
      })
    ).rejects.toThrow();
    expect(state.activityUpdates).toHaveLength(0);
    expect(mocks.recordCorrespondenceEvent).not.toHaveBeenCalled();
  });
});
