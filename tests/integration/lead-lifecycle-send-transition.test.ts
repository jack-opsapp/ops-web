/**
 * P4-D — operator-send transition for lifecycle follow-up drafts.
 *
 * Verifies the send route, on the REAL operator-send path, marks the matching
 * opportunity_follow_up_drafts row sent (status + final_sent_body + subject +
 * sent_at), is idempotent (a re-send re-processes nothing), invokes
 * recordLifecycleDraftOutcome only when LIFECYCLE_LEARNING_ENABLED is on, never
 * fires on the auto-send/cron (internal) path, and leaves non-lifecycle sends
 * untouched.
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
  recordLifecycleDraftOutcomeMock,
  learningFlag,
} = vi.hoisted(() => ({
  getServiceRoleClientMock: vi.fn(),
  getConnectionMock: vi.fn(),
  getProviderMock: vi.fn(),
  upsertFromEmailMock: vi.fn(),
  dismissAwaitingReplyMock: vi.fn(),
  verifyAdminAuthMock: vi.fn(),
  findUserByAuthMock: vi.fn(),
  recordLifecycleDraftOutcomeMock: vi.fn(),
  // Mutable so individual tests can flip the go-live flag.
  learningFlag: { enabled: false },
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

// Control the go-live flag + spy on the learning hook without pulling in the
// real OpenAI-backed service.
vi.mock("@/lib/api/services/ai-draft-service", () => ({
  get LIFECYCLE_LEARNING_ENABLED() {
    return learningFlag.enabled;
  },
  AIDraftService: {
    recordLifecycleDraftOutcome: recordLifecycleDraftOutcomeMock,
  },
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
}

function operatorRequest(body: Record<string, unknown>): Request {
  // No CRON_SECRET → routes through verifyAdminAuth (operator path).
  return new Request("https://ops.test/api/integrations/email/send", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer user-token" },
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

    upsert() {
      this.action = "upsert";
      return this;
    }

    private matchingDrafts(): DraftRow[] {
      return state.drafts.filter((d) => {
        for (const [col, val] of this.filters) {
          if ((d as unknown as Record<string, unknown>)[col] !== val) return false;
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
          data: { correspondence_count: 1, outbound_count: 0, last_outbound_at: null },
          error: null,
        };
      }
      if (this.table === "activities") {
        return { data: { id: "activity-1" }, error: null };
      }
      return { data: null, error: null };
    }

    async maybeSingle() {
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
    learningFlag.enabled = false;
    setSupabaseOverride(null);
    getServiceRoleClientMock.mockReset();
    getConnectionMock.mockReset();
    getProviderMock.mockReset();
    upsertFromEmailMock.mockReset();
    dismissAwaitingReplyMock.mockReset();
    verifyAdminAuthMock.mockReset();
    findUserByAuthMock.mockReset();
    recordLifecycleDraftOutcomeMock.mockReset();
    recordLifecycleDraftOutcomeMock.mockResolvedValue(undefined);
    verifyAdminAuthMock.mockResolvedValue({ uid: "auth-1", email: "op@ops.test" });
    findUserByAuthMock.mockResolvedValue({ id: "user-1", company_id: "company-1" });
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

  it("marks the matching lifecycle draft sent with final body + subject (resolved by thread + opportunity)", async () => {
    const state: SendState = { drafts: [makeDraft()], draftUpdates: [] };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    const res = await POST(operatorRequest(BASE_PAYLOAD) as never);
    expect(res.status).toBe(200);

    const draft = state.drafts[0];
    expect(draft.status).toBe("sent");
    expect(draft.final_sent_body).toBe("Operator-edited follow-up body.");
    expect(draft.subject).toBe("Operator-edited subject");
    expect(draft.sent_at).not.toBeNull();
  });

  it("invokes recordLifecycleDraftOutcome only when LIFECYCLE_LEARNING_ENABLED is on", async () => {
    // Flag off → transition happens, learning does NOT.
    const offState: SendState = { drafts: [makeDraft()], draftUpdates: [] };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(offState));
    await POST(operatorRequest(BASE_PAYLOAD) as never);
    expect(offState.drafts[0].status).toBe("sent");
    expect(recordLifecycleDraftOutcomeMock).not.toHaveBeenCalled();

    // Flag on → learning fires with the operator's final body + subject.
    learningFlag.enabled = true;
    const onState: SendState = { drafts: [makeDraft()], draftUpdates: [] };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(onState));
    await POST(operatorRequest(BASE_PAYLOAD) as never);
    expect(recordLifecycleDraftOutcomeMock).toHaveBeenCalledTimes(1);
    expect(recordLifecycleDraftOutcomeMock).toHaveBeenCalledWith(
      "draft-1",
      "company-1",
      "user-1",
      "Operator-edited follow-up body.",
      "Operator-edited subject"
    );
  });

  it("resolves precisely by explicit followUpDraftId", async () => {
    learningFlag.enabled = true;
    const state: SendState = {
      drafts: [makeDraft({ id: "draft-explicit" })],
      draftUpdates: [],
    };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    await POST(
      operatorRequest({ ...BASE_PAYLOAD, followUpDraftId: "draft-explicit" }) as never
    );
    expect(state.drafts[0].status).toBe("sent");
    expect(recordLifecycleDraftOutcomeMock).toHaveBeenCalledWith(
      "draft-explicit",
      "company-1",
      "user-1",
      expect.any(String),
      expect.any(String)
    );
  });

  it("is idempotent — a second send of an already-sent draft re-processes nothing", async () => {
    learningFlag.enabled = true;
    const state: SendState = { drafts: [makeDraft()], draftUpdates: [] };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    await POST(operatorRequest(BASE_PAYLOAD) as never);
    expect(state.drafts[0].status).toBe("sent");
    expect(recordLifecycleDraftOutcomeMock).toHaveBeenCalledTimes(1);

    // Second send: the draft is now status='sent'. The status='drafted' guard
    // means zero rows update → no re-record, no re-learn.
    const sentBefore = state.drafts[0].sent_at;
    await POST(operatorRequest(BASE_PAYLOAD) as never);
    expect(recordLifecycleDraftOutcomeMock).toHaveBeenCalledTimes(1);
    expect(state.drafts[0].sent_at).toBe(sentBefore);
  });

  it("refuses to guess when the thread + opportunity pair maps to multiple open drafts", async () => {
    learningFlag.enabled = true;
    const state: SendState = {
      drafts: [makeDraft({ id: "draft-a" }), makeDraft({ id: "draft-b" })],
      draftUpdates: [],
    };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    await POST(operatorRequest(BASE_PAYLOAD) as never);
    expect(state.drafts.every((d) => d.status === "drafted")).toBe(true);
    expect(recordLifecycleDraftOutcomeMock).not.toHaveBeenCalled();
  });

  it("leaves non-lifecycle sends untouched (no matching draft)", async () => {
    learningFlag.enabled = true;
    const state: SendState = { drafts: [], draftUpdates: [] };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    const res = await POST(operatorRequest(BASE_PAYLOAD) as never);
    expect(res.status).toBe(200);
    expect(state.draftUpdates).toHaveLength(0);
    expect(recordLifecycleDraftOutcomeMock).not.toHaveBeenCalled();
  });

  it("never fires on the auto-send / cron (internal) path", async () => {
    learningFlag.enabled = true;
    // A matching open draft exists, but the cron path must skip the transition.
    const state: SendState = { drafts: [makeDraft()], draftUpdates: [] };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    const res = await POST(cronRequest(BASE_PAYLOAD) as never);
    expect(res.status).toBe(200);
    expect(state.drafts[0].status).toBe("drafted");
    expect(state.draftUpdates).toHaveLength(0);
    expect(recordLifecycleDraftOutcomeMock).not.toHaveBeenCalled();
  });
});
