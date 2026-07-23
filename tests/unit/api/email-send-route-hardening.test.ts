import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServiceRoleClient: vi.fn(),
  resolveActor: vi.fn(),
  resolveAccess: vi.fn(),
  getConnection: vi.fn(),
  getProvider: vi.fn(),
  deliveryExecute: vi.fn(),
  deliveryConstructor: vi.fn(),
  resolveSignature: vi.fn(),
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  setSupabaseOverride: vi.fn(),
}));

vi.mock("@/lib/email/email-route-auth", () => ({
  resolveEmailRouteActor: mocks.resolveActor,
}));

vi.mock("@/lib/email/email-opportunity-access", () => ({
  resolveEmailOpportunityAccess: mocks.resolveAccess,
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: mocks.getConnection,
    getProvider: mocks.getProvider,
  },
}));

vi.mock("@/lib/api/services/email-send-delivery-service", () => ({
  EmailSendDeliveryService: class {
    constructor(dependencies: unknown) {
      mocks.deliveryConstructor(dependencies);
    }

    execute = mocks.deliveryExecute;
  },
}));

vi.mock("@/lib/api/services/email-send-intent-service", () => ({
  EmailSendIntentService: class {},
}));

vi.mock("@/lib/api/services/email-send-reconciliation-service", () => ({
  reconcileEmailSend: vi.fn(),
}));

vi.mock("@/lib/email/email-signature-runtime", () => ({
  resolveEmailSignatureForMessage: mocks.resolveSignature,
}));

import { POST } from "@/app/api/integrations/email/send/route";

const ACTOR = { userId: "actor-1", companyId: "company-1" };
const CONNECTION = {
  id: "connection-company",
  companyId: "company-1",
  userId: "connector-user",
  email: "info@canprodeckandrail.com",
  provider: "gmail",
  type: "company",
  status: "active",
  opsLabelId: null,
  syncFilters: {},
};

function allowed(overrides: Record<string, unknown> = {}) {
  return {
    allowed: true,
    actor: ACTOR,
    operation: "send",
    threadId: "email-thread-1",
    connectionId: "connection-company",
    providerThreadId: "provider-thread-1",
    opportunityId: "opportunity-1",
    connectionType: "company",
    connectionOwnerId: "connector-user",
    pipelineScope: "assigned",
    inboxScope: "assigned",
    usedLegacyPipelineManage: false,
    usedLegacyInboxViewCompany: false,
    ...overrides,
  };
}

function supabaseDouble() {
  class Query {
    select() {
      return this;
    }
    eq() {
      return this;
    }
    gte() {
      return this;
    }
    async single() {
      return {
        data: {
          subscription_plan: "team",
          subscription_status: "active",
          trial_end_date: null,
          seated_employee_ids: [ACTOR.userId],
          admin_ids: [],
          max_seats: 10,
        },
        error: null,
      };
    }
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve({ count: 0, error: null }).then(resolve);
    }
  }
  return { from: vi.fn(() => new Query()), rpc: vi.fn() };
}

function request(
  body: Record<string, unknown>,
  authorization = "Bearer browser-token"
) {
  return new Request("https://ops.test/api/integrations/email/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization,
    },
    body: JSON.stringify(body),
  });
}

const BASE_BODY = {
  idempotencyKey: "send-attempt-1",
  emailThreadId: "email-thread-1",
  connectionId: "connection-company",
  opportunityId: "opportunity-1",
  to: ["client@example.com"],
  subject: "Deck quote",
  body: "Here is the quote.",
  inReplyTo: "provider-message-1",
};

describe("email send route hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    mocks.getServiceRoleClient.mockReturnValue(supabaseDouble());
    mocks.resolveActor.mockResolvedValue({ ok: true, actor: ACTOR });
    mocks.resolveAccess.mockResolvedValue(allowed());
    mocks.getConnection.mockResolvedValue(CONNECTION);
    mocks.getProvider.mockReturnValue({
      sendEmail: vi.fn(),
      applyLabel: vi.fn(),
    });
    mocks.resolveSignature.mockResolvedValue({
      recordId: "signature-1",
      source: "ops",
      scope: "operator",
      html: "<div>Jason</div>",
      text: "Jason",
      hash: "a".repeat(64),
      providerIdentity: null,
    });
    mocks.deliveryExecute.mockResolvedValue({
      state: "reconciled",
      delivered: true,
      intentId: "intent-1",
      providerMessageId: "sent-message-1",
      providerThreadId: "provider-thread-1",
      activityId: "activity-1",
      error: null,
    });
  });

  it("ignores spoofed body actor/company claims and uses canonical access identities", async () => {
    const response = await POST(
      request({
        ...BASE_BODY,
        userId: "spoofed-user",
        companyId: "spoofed-company",
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveActor).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.resolveAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: ACTOR,
        operation: "send",
        threadId: "email-thread-1",
        connectionId: "connection-company",
        opportunityId: "opportunity-1",
      })
    );
    expect(mocks.deliveryExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: ACTOR.companyId,
        actorUserId: ACTOR.userId,
        connectionId: "connection-company",
        opportunityId: "opportunity-1",
        sourceEmailThreadId: "email-thread-1",
        replyProviderThreadId: "provider-thread-1",
        inReplyTo: "provider-message-1",
      })
    );
  });

  it("fails before provider orchestration without a stable idempotency key", async () => {
    const { idempotencyKey: _, ...body } = BASE_BODY;
    const response = await POST(request(body) as never);

    expect(response.status).toBe(400);
    expect(mocks.resolveAccess).not.toHaveBeenCalled();
    expect(mocks.deliveryExecute).not.toHaveBeenCalled();
  });

  it("blocks generic CRON-secret body identities", async () => {
    process.env.CRON_SECRET = "cron-secret";
    const response = await POST(
      request(BASE_BODY, "Bearer cron-secret") as never
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "EMAIL_SEND_TRUSTED_SOURCE_REQUIRED",
    });
    expect(mocks.resolveActor).not.toHaveBeenCalled();
    expect(mocks.deliveryExecute).not.toHaveBeenCalled();
  });

  it("explicit sender switching authorizes both mailboxes and clears provider reply identity", async () => {
    mocks.resolveAccess
      .mockResolvedValueOnce(allowed())
      .mockResolvedValueOnce(
        allowed({
          threadId: null,
          connectionId: "connection-personal",
          providerThreadId: null,
          connectionType: "individual",
          connectionOwnerId: ACTOR.userId,
        })
      );
    mocks.getConnection.mockResolvedValue({
      ...CONNECTION,
      id: "connection-personal",
      userId: ACTOR.userId,
      email: "jason@example.com",
      type: "individual",
    });

    const response = await POST(
      request({
        ...BASE_BODY,
        connectionId: "connection-personal",
        senderSwitched: true,
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveAccess).toHaveBeenCalledTimes(2);
    expect(mocks.resolveAccess).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        actor: ACTOR,
        operation: "read",
        threadId: "email-thread-1",
        opportunityId: "opportunity-1",
      })
    );
    expect(mocks.resolveAccess).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        actor: ACTOR,
        operation: "send",
        connectionId: "connection-personal",
        opportunityId: "opportunity-1",
      })
    );
    expect(mocks.deliveryExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "connection-personal",
        sourceEmailThreadId: "email-thread-1",
        senderSwitched: true,
        replyProviderThreadId: null,
        inReplyTo: null,
      })
    );
  });

  it("authorizes an operator-authored message-scoped handoff as a new lead conversation", async () => {
    mocks.resolveAccess.mockResolvedValue(
      allowed({
        threadId: null,
        providerThreadId: null,
        connectionId: "connection-company",
        opportunityId: "opportunity-1",
      })
    );

    const response = await POST(
      request({
        idempotencyKey: "system-handoff-attempt-1",
        emailThreadId: null,
        connectionId: "connection-company",
        opportunityId: "opportunity-1",
        to: ["customer@example.com"],
        cc: [],
        subject: "Victoria deck inquiry",
        body: "Thanks for reaching out.",
        inReplyTo: null,
        followUpDraftId: "system-handoff-draft-1",
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveActor).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.resolveAccess).toHaveBeenCalledTimes(1);
    expect(mocks.resolveAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: ACTOR,
        operation: "send",
        connectionId: "connection-company",
        opportunityId: "opportunity-1",
      })
    );
    expect(mocks.deliveryExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        initiatedBy: "operator",
        connectionId: "connection-company",
        opportunityId: "opportunity-1",
        sourceEmailThreadId: null,
        replyProviderThreadId: null,
        inReplyTo: null,
        senderSwitched: false,
        toEmails: ["customer@example.com"],
        ccEmails: [],
        followUpDraftId: "system-handoff-draft-1",
      })
    );
  });

  it("does not call delivery when the lead/inbox intersection denies access", async () => {
    mocks.resolveAccess.mockResolvedValue({
      allowed: false,
      reason: "opportunity_other_assignee",
    });

    const response = await POST(request(BASE_BODY) as never);

    expect(response.status).toBe(403);
    expect(mocks.deliveryExecute).not.toHaveBeenCalled();
  });

  it("stops before provider orchestration when no effective signature exists", async () => {
    mocks.resolveSignature.mockResolvedValue(null);

    const response = await POST(request(BASE_BODY) as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "EMAIL_SIGNATURE_REQUIRED",
      message: "Add your email signature in Settings before sending.",
    });
    expect(mocks.deliveryExecute).not.toHaveBeenCalled();
  });

  it("returns accepted-but-pending state without initiating another delivery", async () => {
    mocks.deliveryExecute.mockResolvedValue({
      state: "pending",
      delivered: true,
      intentId: "intent-1",
      providerMessageId: "sent-message-1",
      providerThreadId: "provider-thread-1",
      activityId: null,
      error: "activity insert failed",
    });

    const response = await POST(request(BASE_BODY) as never);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      delivered: true,
      reconciliationPending: true,
      intentId: "intent-1",
    });
    expect(mocks.deliveryExecute).toHaveBeenCalledOnce();
  });
});
