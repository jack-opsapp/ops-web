import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  executeMock,
  getSubscriptionInfoMock,
  getConnectionMock,
  getProviderMock,
  providerSendMock,
  requireSupabaseMock,
  subscriptionLookupMock,
} = vi.hoisted(() => ({
  executeMock: vi.fn(),
  getSubscriptionInfoMock: vi.fn(),
  getConnectionMock: vi.fn(),
  getProviderMock: vi.fn(),
  providerSendMock: vi.fn(),
  requireSupabaseMock: vi.fn(),
  subscriptionLookupMock: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: requireSupabaseMock,
}));

vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: { isAIFeatureEnabled: vi.fn() },
}));

vi.mock("@/lib/api/services/ai-draft-service", () => ({
  AIDraftService: { generateDraft: vi.fn() },
}));

vi.mock("@/lib/api/services/email-signature-service", () => ({
  EmailSignatureService: { resolveEffective: vi.fn() },
  renderEmailBodyWithSignature: vi.fn(),
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: getConnectionMock,
    getProvider: getProviderMock,
  },
}));

vi.mock("@/lib/api/services/email-send-delivery-service", () => ({
  EmailSendDeliveryService: class {
    execute = executeMock;
  },
}));

vi.mock("@/lib/api/services/email-send-reconciliation-service", () => ({
  reconcileEmailSend: vi.fn(),
}));

vi.mock("@/lib/subscription", () => ({
  getSubscriptionInfo: getSubscriptionInfoMock,
}));

import { AutoSendService } from "@/lib/api/services/auto-send-service";

const IDS = {
  actor: "11111111-1111-4111-8111-111111111111",
  assignmentEvent: "22222222-2222-4222-8222-222222222222",
  company: "33333333-3333-4333-8333-333333333333",
  connection: "44444444-4444-4444-8444-444444444444",
  opportunity: "55555555-5555-4555-8555-555555555555",
  internalThread: "66666666-6666-4666-8666-666666666666",
  draftHistory: "77777777-7777-4777-8777-777777777777",
  pending: "88888888-8888-4888-8888-888888888888",
  lease: "99999999-9999-4999-8999-999999999999",
  signature: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  sendIntent: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};

function queueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: IDS.pending,
    company_id: IDS.company,
    actor_user_id: IDS.actor,
    assignment_version: 12,
    assignment_event_id: IDS.assignmentEvent,
    connection_id: IDS.connection,
    opportunity_id: IDS.opportunity,
    source_email_thread_id: IDS.internalThread,
    thread_id: "provider-thread-1",
    in_reply_to: "provider-message-1",
    to_emails: ["lead@example.com"],
    cc_emails: ["office@example.com"],
    subject: "Estimate",
    draft_text: "Draft body",
    authored_body: "<p>Draft body</p>",
    rendered_body: "<p>Draft body</p><signature />",
    content_type: "html",
    draft_history_id: IDS.draftHistory,
    profile_type_snapshot: "lead-estimate",
    learning_authority: "autonomous",
    actor_name_snapshot: "Alex Rivera",
    actor_email_snapshot: "alex@ops.test",
    client_from_address_snapshot: "hello@company.test",
    signature_id: IDS.signature,
    signature_content_hash: "a".repeat(64),
    rendered_body_hash: "b".repeat(64),
    idempotency_key: "c".repeat(64),
    send_intent_id: null,
    scheduled_send_at: "2026-07-15T20:00:00.000Z",
    status: "leased",
    lease_token: IDS.lease,
    claimed_at: "2026-07-15T20:00:00.000Z",
    lease_expires_at: "2026-07-15T20:05:00.000Z",
    created_at: "2026-07-15T19:00:00.000Z",
    updated_at: "2026-07-15T20:00:00.000Z",
    sent_at: null,
    cancelled_at: null,
    error: null,
    retry_count: 0,
    ...overrides,
  };
}

function client() {
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_phase_c_auto_sends") {
      return { data: [queueRow()], error: null };
    }
    if (name === "complete_phase_c_auto_send") {
      return {
        data: queueRow({ status: "sent", send_intent_id: IDS.sendIntent }),
        error: null,
      };
    }
    if (name === "retry_phase_c_auto_send") {
      return {
        data: queueRow({ status: "pending", lease_token: null }),
        error: null,
      };
    }
    throw new Error(`unexpected RPC: ${name}`);
  });
  const from = vi.fn((table: string) => {
    if (table !== "companies") {
      throw new Error(`unexpected table: ${table}`);
    }
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: subscriptionLookupMock,
        })),
      })),
    };
  });
  return { value: { rpc, from }, rpc, from };
}

describe("Phase C auto-send processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue({
      id: IDS.connection,
      companyId: IDS.company,
      status: "active",
    });
    getProviderMock.mockReturnValue({ sendEmail: providerSendMock });
    subscriptionLookupMock.mockResolvedValue({
      data: {
        subscription_plan: "business",
        subscription_status: "active",
        trial_end_date: null,
        seated_employee_ids: [],
        admin_ids: [],
        max_seats: 10,
      },
      error: null,
    });
    getSubscriptionInfoMock.mockReturnValue({ isActive: true });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("routes a claimed row through the durable delivery state machine and completes by the same queue lease", async () => {
    const db = client();
    requireSupabaseMock.mockReturnValue(db.value);
    executeMock.mockResolvedValue({
      state: "reconciled",
      delivered: true,
      intentId: IDS.sendIntent,
      providerMessageId: "sent-message-1",
      providerThreadId: "provider-thread-1",
      activityId: "activity-1",
      error: null,
    });

    const result = await AutoSendService.processPendingSends();

    expect(executeMock).toHaveBeenCalledWith({
      idempotencyKey: "c".repeat(64),
      companyId: IDS.company,
      actorUserId: IDS.actor,
      initiatedBy: "phase_c_auto_send",
      connectionId: IDS.connection,
      opportunityId: IDS.opportunity,
      sourceEmailThreadId: IDS.internalThread,
      replyProviderThreadId: "provider-thread-1",
      inReplyTo: "provider-message-1",
      senderSwitched: false,
      toEmails: ["lead@example.com"],
      ccEmails: ["office@example.com"],
      subject: "Estimate",
      authoredBody: "<p>Draft body</p>",
      renderedBody: "<p>Draft body</p><signature />",
      contentType: "html",
      draftHistoryId: IDS.draftHistory,
      followUpDraftId: null,
      learningAuthority: "autonomous",
      signatureId: IDS.signature,
      signatureContentHash: "a".repeat(64),
      renderedBodyHash: "b".repeat(64),
      pendingAutoSendId: IDS.pending,
      pendingAutoSendLeaseToken: IDS.lease,
    });
    expect(db.rpc).toHaveBeenCalledWith("complete_phase_c_auto_send", {
      p_id: IDS.pending,
      p_company_id: IDS.company,
      p_lease_token: IDS.lease,
      p_send_intent_id: IDS.sendIntent,
    });
    expect(result).toMatchObject({ sent: 1, failed: 0, errors: [] });
    expect(providerSendMock).not.toHaveBeenCalled();
  });

  it.each([
    ["rejected", "provider rejected send"],
    ["delivery_unknown", "provider result unknown"],
    ["pending", "reconciliation pending"],
  ] as const)(
    "retries the queue after a %s durable outcome",
    async (state, error) => {
      const db = client();
      requireSupabaseMock.mockReturnValue(db.value);
      executeMock.mockResolvedValue({
        state,
        delivered: state !== "rejected",
        intentId: IDS.sendIntent,
        providerMessageId: null,
        providerThreadId: null,
        activityId: null,
        error,
      });

      const result = await AutoSendService.processPendingSends();

      expect(db.rpc).toHaveBeenCalledWith(
        "retry_phase_c_auto_send",
        expect.objectContaining({
          p_id: IDS.pending,
          p_company_id: IDS.company,
          p_lease_token: IDS.lease,
          p_error: error,
        })
      );
      expect(result.sent).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors).toEqual([`${IDS.pending}: ${error}`]);
      expect(providerSendMock).not.toHaveBeenCalled();
    }
  );

  it("returns the queue to retry when delivery orchestration throws", async () => {
    const db = client();
    requireSupabaseMock.mockReturnValue(db.value);
    executeMock.mockRejectedValue(new Error("connection expired"));

    const result = await AutoSendService.processPendingSends();

    expect(db.rpc).toHaveBeenCalledWith(
      "retry_phase_c_auto_send",
      expect.objectContaining({
        p_id: IDS.pending,
        p_company_id: IDS.company,
        p_lease_token: IDS.lease,
        p_error: "connection expired",
      })
    );
    expect(result).toMatchObject({ sent: 0, failed: 1 });
    expect(providerSendMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "inactive",
      lookup: {
        data: {
          subscription_plan: "business",
          subscription_status: "expired",
          trial_end_date: null,
          seated_employee_ids: [],
          admin_ids: [],
          max_seats: 10,
        },
        error: null,
      },
      active: false,
    },
    {
      label: "lookup-failed",
      lookup: { data: null, error: { message: "database unavailable" } },
      active: true,
    },
  ])(
    "preserves the draft and never enters delivery when subscription is $label",
    async ({ lookup, active }) => {
      const db = client();
      requireSupabaseMock.mockReturnValue(db.value);
      subscriptionLookupMock.mockResolvedValueOnce(lookup);
      getSubscriptionInfoMock.mockReturnValueOnce({ isActive: active });

      const result = await AutoSendService.processPendingSends();

      expect(executeMock).not.toHaveBeenCalled();
      expect(getConnectionMock).not.toHaveBeenCalled();
      expect(providerSendMock).not.toHaveBeenCalled();
      expect(db.rpc).toHaveBeenCalledWith(
        "retry_phase_c_auto_send",
        expect.objectContaining({
          p_id: IDS.pending,
          p_company_id: IDS.company,
          p_lease_token: IDS.lease,
          p_error: "PHASE_C_AUTO_SEND_SUBSCRIPTION_INACTIVE",
        })
      );
      expect(db.from).not.toHaveBeenCalledWith("ai_draft_history");
      expect(result).toMatchObject({ sent: 0, failed: 1 });
    }
  );
});
