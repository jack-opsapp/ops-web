/**
 * Durable lifecycle-draft handoff on the real send route.
 *
 * Provider delivery and CRM persistence stay in the route; draft outcomes are
 * handed to the receipt-idempotent outbound-learning queue. The route must
 * validate explicit draft provenance before delivery, pass the validated id to
 * the queue, and never mutate or learn from lifecycle drafts inline.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getServiceRoleClientMock,
  getConnectionMock,
  getProviderMock,
  upsertFromEmailMock,
  dismissAwaitingReplyMock,
  verifyAdminAuthMock,
  findUserByAuthMock,
  checkPermissionByIdMock,
  enqueueIfEnabledMock,
} = vi.hoisted(() => ({
  getServiceRoleClientMock: vi.fn(),
  getConnectionMock: vi.fn(),
  getProviderMock: vi.fn(),
  upsertFromEmailMock: vi.fn(),
  dismissAwaitingReplyMock: vi.fn(),
  verifyAdminAuthMock: vi.fn(),
  findUserByAuthMock: vi.fn(),
  checkPermissionByIdMock: vi.fn(),
  enqueueIfEnabledMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: verifyAdminAuthMock,
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: findUserByAuthMock,
}));

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: checkPermissionByIdMock,
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: getConnectionMock,
    getConnections: vi.fn(),
    getProvider: getProviderMock,
  },
}));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: {
    upsertFromEmail: upsertFromEmailMock,
    dismissAwaitingReply: dismissAwaitingReplyMock,
  },
}));

vi.mock("@/lib/api/services/email-outbound-learning-service", () => ({
  EmailOutboundLearningService: class {
    enqueueIfEnabled = enqueueIfEnabledMock;
  },
}));

vi.mock("@/lib/email/email-signature-runtime", () => ({
  resolveEmailSignatureForMessage: vi.fn(async () => ({
    recordId: "signature-1",
    source: "ops",
    scope: "mailbox",
    html: "<div>Jackson<br>Canpro</div>",
    text: "Jackson\nCanpro",
    hash: "a".repeat(64),
    providerIdentity: null,
  })),
}));

import { setSupabaseOverride } from "@/lib/supabase/helpers";
import { POST } from "@/app/api/integrations/email/send/route";

interface DraftRow {
  id: string;
  company_id: string;
  opportunity_id: string | null;
  provider_thread_id: string | null;
  origin: string;
  status: string;
  subject: string;
  original_body: string;
  current_body: string | null;
  final_sent_body: string | null;
  sent_at: string | null;
}

interface SendState {
  drafts: DraftRow[];
  draftUpdates: Array<{ id: string; payload: Record<string, unknown> }>;
  canonicalThreadOwnerId?: string | null;
}

function operatorRequest(body: Record<string, unknown>): Request {
  // No CRON_SECRET → routes through verifyAdminAuth (operator path).
  return new Request("https://ops.test/api/integrations/email/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer user-token",
    },
    body: JSON.stringify(body),
  });
}

function cronRequest(body: Record<string, unknown>): Request {
  return new Request("https://ops.test/api/integrations/email/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-cron-secret",
    },
    body: JSON.stringify(body),
  });
}

function makeSupabaseDouble(state: SendState) {
  class Query {
    private action: "select" | "insert" | "update" | "upsert" = "select";
    private filters = new Map<string, unknown>();
    private inFilters = new Map<string, unknown[]>();
    private updatePayload: Record<string, unknown> | null = null;
    private selectAfterWrite = false;

    constructor(private readonly table: string) {}

    select() {
      if (this.action !== "select") this.selectAfterWrite = true;
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    is(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    in(column: string, values: unknown[]) {
      this.inFilters.set(column, values);
      return this;
    }

    gte(column: string, value: unknown) {
      this.filters.set(`${column}:gte`, value);
      return this;
    }

    limit() {
      return this;
    }

    insert() {
      this.action = "insert";
      return this;
    }

    update(payload: Record<string, unknown>) {
      this.action = "update";
      this.updatePayload = payload;
      return this;
    }

    upsert(payload: Record<string, unknown> = {}) {
      this.action = "upsert";
      if (this.table === "opportunity_email_threads") {
        state.canonicalThreadOwnerId ??=
          (payload.opportunity_id as string | null | undefined) ?? null;
      }
      return this;
    }

    private matchingDrafts(): DraftRow[] {
      return state.drafts.filter((d) => {
        for (const [col, val] of this.filters) {
          if ((d as unknown as Record<string, unknown>)[col] !== val)
            return false;
        }
        for (const [col, vals] of this.inFilters) {
          if (!vals.includes((d as unknown as Record<string, unknown>)[col]))
            return false;
        }
        return true;
      });
    }

    private applyDraftUpdate(): DraftRow[] {
      const matches = this.matchingDrafts();
      for (const d of matches) {
        state.draftUpdates.push({ id: d.id, payload: this.updatePayload! });
        Object.assign(d, this.updatePayload);
      }
      return matches;
    }

    async single() {
      if (this.table === "companies") {
        return {
          data: {
            subscription_plan: "team",
            subscription_status: "active",
            trial_end_date: null,
            seated_employee_ids: ["user-1"],
            admin_ids: ["user-1"],
            max_seats: 10,
          },
          error: null,
        };
      }
      if (this.table === "opportunities") {
        return {
          data: {
            correspondence_count: 1,
            outbound_count: 0,
            last_outbound_at: null,
          },
          error: null,
        };
      }
      if (this.table === "activities") {
        return { data: { id: "activity-1" }, error: null };
      }
      return { data: null, error: null };
    }

    async maybeSingle() {
      if (this.table === "opportunities") {
        return { data: { id: "opp-1" }, error: null };
      }
      if (this.table === "opportunity_email_threads") {
        return {
          data: state.canonicalThreadOwnerId
            ? { opportunity_id: state.canonicalThreadOwnerId }
            : null,
          error: null,
        };
      }
      if (this.table === "opportunity_follow_up_drafts") {
        const [first] = this.matchingDrafts();
        return { data: first ?? null, error: null };
      }
      return { data: null, error: null };
    }

    private result() {
      if (this.table === "activities" && this.action === "select") {
        return { data: null, count: 0, error: null };
      }
      if (this.table === "opportunity_follow_up_drafts") {
        if (this.action === "update") {
          return { data: this.applyDraftUpdate(), error: null };
        }
        return { data: this.matchingDrafts(), error: null };
      }
      return { data: null, error: null };
    }

    then<T = unknown, E = never>(
      onfulfilled?: ((value: unknown) => T | PromiseLike<T>) | null,
      onrejected?: ((reason: unknown) => E | PromiseLike<E>) | null
    ) {
      return Promise.resolve(this.result()).then(onfulfilled, onrejected);
    }
  }

  return {
    from(table: string) {
      return new Query(table);
    },
    rpc: vi.fn(async () => ({
      data: [{ changed: true }],
      error: null,
    })),
  };
}

function makeDraft(overrides: Partial<DraftRow> = {}): DraftRow {
  return {
    id: "draft-1",
    company_id: "company-1",
    opportunity_id: "opp-1",
    provider_thread_id: "thread-send-1",
    origin: "template_follow_up",
    status: "drafted",
    subject: "Original subject",
    original_body: "Original template body.",
    current_body: "Original template body.",
    final_sent_body: null,
    sent_at: null,
    ...overrides,
  };
}

const CONNECTION = {
  id: "connection-1",
  companyId: "company-1",
  userId: "user-1",
  email: "jackson@canprodeckandrail.com",
  provider: "gmail",
  status: "active",
  opsLabelId: null,
  syncFilters: {
    companyDomains: ["canprodeckandrail.com"],
    userEmailAddresses: ["jackson@canprodeckandrail.com"],
  },
};

function wireProvider() {
  getConnectionMock.mockResolvedValue(CONNECTION);
  getProviderMock.mockReturnValue({
    sendEmail: vi.fn(async () => ({
      messageId: "msg-send-1",
      threadId: "thread-send-1",
    })),
    applyLabel: vi.fn(async () => undefined),
  });
}

const BASE_PAYLOAD = {
  userId: "user-1",
  companyId: "company-1",
  connectionId: "connection-1",
  to: ["kara.beach@example.com"],
  subject: "Operator-edited subject",
  body: "Operator-edited follow-up body.",
  opportunityId: "opp-1",
  threadId: "thread-send-1",
};

describe("lifecycle follow-up draft send-transition", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    setSupabaseOverride(null);
    getServiceRoleClientMock.mockReset();
    getConnectionMock.mockReset();
    getProviderMock.mockReset();
    upsertFromEmailMock.mockReset();
    dismissAwaitingReplyMock.mockReset();
    verifyAdminAuthMock.mockReset();
    findUserByAuthMock.mockReset();
    checkPermissionByIdMock.mockReset();
    enqueueIfEnabledMock.mockReset();
    enqueueIfEnabledMock.mockResolvedValue({ queueId: "queue-1" });
    verifyAdminAuthMock.mockResolvedValue({
      uid: "auth-1",
      email: "op@ops.test",
    });
    findUserByAuthMock.mockResolvedValue({
      id: "user-1",
      company_id: "company-1",
    });
    checkPermissionByIdMock.mockResolvedValue(true);
    upsertFromEmailMock.mockResolvedValue({
      threadRow: {
        id: "thread-row-1",
        latestDirection: "outbound",
        labels: ["AWAITING_REPLY"],
      },
    });
    dismissAwaitingReplyMock.mockResolvedValue(["CUSTOMER"]);
    wireProvider();
  });

  it("queues a validated lifecycle draft and leaves its sent transition to the durable worker", async () => {
    const state: SendState = { drafts: [makeDraft()], draftUpdates: [] };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    const res = await POST(
      operatorRequest({ ...BASE_PAYLOAD, followUpDraftId: "draft-1" }) as never
    );
    expect(res.status).toBe(200);
    expect(state.drafts[0].status).toBe("drafted");
    expect(state.draftUpdates).toHaveLength(0);
    expect(enqueueIfEnabledMock).toHaveBeenCalledTimes(1);
    expect(enqueueIfEnabledMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        connectionId: "connection-1",
        providerMessageId: "msg-send-1",
        providerThreadId: "thread-send-1",
        userId: "user-1",
        subject: "Operator-edited subject",
        bodyText: "Operator-edited follow-up body.",
        followUpDraftId: "draft-1",
        draftHistoryId: null,
        opportunityId: "opp-1",
      })
    );
  });

  it("rejects a browser caller whose authenticated company does not own the payload", async () => {
    const state: SendState = { drafts: [makeDraft()], draftUpdates: [] };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));
    findUserByAuthMock.mockResolvedValue({
      id: "user-1",
      company_id: "company-other",
    });

    const response = await POST(operatorRequest(BASE_PAYLOAD) as never);

    expect(response.status).toBe(403);
    expect(getProviderMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid explicit lifecycle-draft id before provider delivery", async () => {
    const state: SendState = { drafts: [makeDraft()], draftUpdates: [] };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    const response = await POST(
      operatorRequest({
        ...BASE_PAYLOAD,
        followUpDraftId: "draft-from-another-scope",
      }) as never
    );

    expect(response.status).toBe(409);
    expect(getProviderMock).not.toHaveBeenCalled();
    expect(enqueueIfEnabledMock).not.toHaveBeenCalled();
  });

  it("never guesses a lifecycle draft from thread + opportunity", async () => {
    const state: SendState = {
      drafts: [makeDraft({ id: "draft-a" }), makeDraft({ id: "draft-b" })],
      draftUpdates: [],
    };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    await POST(operatorRequest(BASE_PAYLOAD) as never);
    expect(state.drafts.every((d) => d.status === "drafted")).toBe(true);
    expect(state.draftUpdates).toHaveLength(0);
    expect(enqueueIfEnabledMock).toHaveBeenCalledWith(
      expect.objectContaining({ followUpDraftId: null })
    );
  });

  it("queues non-lifecycle sends without attaching a draft outcome", async () => {
    const state: SendState = { drafts: [], draftUpdates: [] };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    const res = await POST(operatorRequest(BASE_PAYLOAD) as never);
    expect(res.status).toBe(200);
    expect(state.draftUpdates).toHaveLength(0);
    expect(enqueueIfEnabledMock).toHaveBeenCalledWith(
      expect.objectContaining({
        draftHistoryId: null,
        followUpDraftId: null,
      })
    );
  });

  it("preserves explicit lifecycle provenance on the internal auto-send path", async () => {
    const state: SendState = { drafts: [makeDraft()], draftUpdates: [] };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    const res = await POST(
      cronRequest({ ...BASE_PAYLOAD, followUpDraftId: "draft-1" }) as never
    );
    expect(res.status).toBe(200);
    expect(state.drafts[0].status).toBe("drafted");
    expect(state.draftUpdates).toHaveLength(0);
    expect(enqueueIfEnabledMock).toHaveBeenCalledWith(
      expect.objectContaining({ followUpDraftId: "draft-1" })
    );
  });

  it("does not report an already-delivered message as failed when queueing errors", async () => {
    const state: SendState = { drafts: [], draftUpdates: [] };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));
    enqueueIfEnabledMock.mockRejectedValueOnce(new Error("queue unavailable"));

    const response = await POST(operatorRequest(BASE_PAYLOAD) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      messageId: "msg-send-1",
    });
  });
});
