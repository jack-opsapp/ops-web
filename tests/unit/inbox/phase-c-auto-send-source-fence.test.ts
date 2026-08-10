import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  deliveryRunMock,
  generateDraftMock,
  getConnectionMock,
  getProviderMock,
  getSubscriptionInfoMock,
  providerFetchThreadMock,
  renderSignatureMock,
  requireSupabaseMock,
  resolveMessageSignatureMock,
  subscriptionLookupMock,
} = vi.hoisted(() => ({
  deliveryRunMock: vi.fn(),
  generateDraftMock: vi.fn(),
  getConnectionMock: vi.fn(),
  getProviderMock: vi.fn(),
  getSubscriptionInfoMock: vi.fn(),
  providerFetchThreadMock: vi.fn(),
  renderSignatureMock: vi.fn(),
  requireSupabaseMock: vi.fn(),
  resolveMessageSignatureMock: vi.fn(),
  subscriptionLookupMock: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: requireSupabaseMock,
}));

vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: { isAIFeatureEnabled: vi.fn() },
}));

vi.mock("@/lib/api/services/ai-draft-service", () => ({
  AIDraftService: { generateDraft: generateDraftMock },
}));

vi.mock("@/lib/email/email-signature-runtime", () => ({
  resolveEmailSignatureForMessage: resolveMessageSignatureMock,
}));

vi.mock("@/lib/api/services/email-signature-service", () => ({
  renderEmailBodyWithSignature: renderSignatureMock,
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: getConnectionMock,
    getProvider: getProviderMock,
  },
}));

vi.mock("@/lib/api/services/email-connection-sync-lock", () => ({
  runWithEmailConnectionSyncLock: vi.fn(
    async ({ run }: { run: (checkpoint: () => Promise<void>) => unknown }) => ({
      acquired: true,
      value: await run(async () => undefined),
    })
  ),
}));

vi.mock("@/lib/api/services/email-send-delivery-service", () => ({
  EmailSendDeliveryService: class {
    constructor(
      private readonly dependencies: {
        runWithMailboxLease: (input: {
          connectionId: string;
          run: (checkpoint: () => Promise<void>) => Promise<unknown>;
        }) => Promise<{ acquired: boolean; value: unknown }>;
      }
    ) {}

    async execute(input: { connectionId: string }) {
      const locked = await this.dependencies.runWithMailboxLease({
        connectionId: input.connectionId,
        run: async () => {
          deliveryRunMock();
          return {
            state: "reconciled",
            delivered: true,
            intentId: IDS.sendIntent,
            providerMessageId: "provider-sent-1",
            providerThreadId: "provider-thread-1",
            activityId: "sent-activity-1",
            error: null,
          };
        },
      });
      return locked.value;
    }
  },
}));

vi.mock("@/lib/api/services/email-send-reconciliation-service", () => ({
  reconcileEmailSend: vi.fn(),
}));

vi.mock("@/lib/subscription", () => ({
  getSubscriptionInfo: getSubscriptionInfoMock,
}));

vi.mock("@/lib/utils/markdown-to-email-html", () => ({
  markdownToEmailHtml: (body: string) => `<p>${body}</p>`,
}));

import {
  AutoSendService,
  buildPhaseCAutoSendIdempotencyKey,
} from "@/lib/api/services/auto-send-service";

const IDS = {
  actor: "11111111-1111-4111-8111-111111111111",
  assignmentEvent: "22222222-2222-4222-8222-222222222222",
  company: "33333333-3333-4333-8333-333333333333",
  connection: "44444444-4444-4444-8444-444444444444",
  opportunity: "55555555-5555-4555-8555-555555555555",
  internalThread: "66666666-6666-4666-8666-666666666666",
  sourceActivity: "77777777-7777-4777-8777-777777777777",
  draftHistory: "88888888-8888-4888-8888-888888888888",
  pending: "99999999-9999-4999-8999-999999999999",
  lease: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  signature: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  sendIntent: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

const actorContext = {
  actorUserId: IDS.actor,
  assignmentVersion: 12,
  assignmentEventId: IDS.assignmentEvent,
  companyId: IDS.company,
  connectionId: IDS.connection,
  opportunityId: IDS.opportunity,
  internalThreadId: IDS.internalThread,
  providerThreadId: "provider-thread-1",
  connectionType: "company" as const,
  actorNameSnapshot: "Alex Rivera",
  actorEmailSnapshot: "alex@ops.test",
  clientFacingAddressSnapshot: "hello@company.test",
};

const emailAccess = {
  allowed: true as const,
  actor: { userId: IDS.actor, companyId: IDS.company },
  operation: "send" as const,
  threadId: IDS.internalThread,
  connectionId: IDS.connection,
  providerThreadId: "provider-thread-1",
  opportunityId: IDS.opportunity,
  connectionType: "company" as const,
  connectionOwnerId: null,
  pipelineScope: "assigned" as const,
  inboxScope: "assigned" as const,
  usedLegacyPipelineManage: false,
  usedLegacyInboxViewCompany: false,
};

const settings = {
  enabled: true,
  businessHoursStart: "00:00",
  businessHoursEnd: "23:59",
  timezone: "UTC",
  delayMinMinutes: 30,
  delayMaxMinutes: 30,
};

const mailboxConnection = {
  id: IDS.connection,
  companyId: IDS.company,
  status: "active" as const,
  syncEnabled: true,
  email: "hello@company.test",
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
    category_snapshot: "CUSTOMER",
    autonomy_level_snapshot: "auto_follow_up",
    thread_id: "provider-thread-1",
    in_reply_to: "provider-source-1",
    to_emails: ["lead@example.com"],
    cc_emails: [],
    subject: "Estimate",
    draft_text: "Draft body",
    authored_body: "<p>Draft body</p>",
    rendered_body: "<p>Draft body</p><signature />",
    content_type: "html",
    draft_history_id: IDS.draftHistory,
    profile_type_snapshot: "client_followup",
    learning_authority: "autonomous",
    actor_name_snapshot: "Alex Rivera",
    actor_email_snapshot: "alex@ops.test",
    client_from_address_snapshot: "hello@company.test",
    signature_id: IDS.signature,
    signature_content_hash: "a".repeat(64),
    rendered_body_hash: "b".repeat(64),
    idempotency_key: "c".repeat(64),
    send_intent_id: null,
    scheduled_send_at: "2026-08-07T20:00:00.000Z",
    status: "pending",
    lease_token: null,
    claimed_at: null,
    lease_expires_at: null,
    created_at: "2026-08-07T19:00:00.000Z",
    updated_at: "2026-08-07T19:00:00.000Z",
    sent_at: null,
    cancelled_at: null,
    error: null,
    retry_count: 0,
    ...overrides,
  };
}

function acquiredReservation(overrides: Record<string, unknown> = {}) {
  return {
    disposition: "acquired",
    generation_token: IDS.lease,
    to_emails: ["lead@example.com"],
    cc_emails: [],
    ...overrides,
  };
}

function scheduleInput() {
  return {
    category: "CUSTOMER" as const,
    companyId: IDS.company,
    actorContext,
    connectionId: IDS.connection,
    opportunityId: IDS.opportunity,
    threadId: "provider-thread-1",
    inReplyTo: "provider-source-1",
    toEmails: ["lead@example.com"],
    ccEmails: [],
    subject: "Estimate",
    settings,
    generation: {
      kind: "auto_follow_up" as const,
      autonomousRoutingAuthority: "phase_c_stale_lead_follow_up" as const,
      emailAccess,
      sourceActivityId: IDS.sourceActivity,
      sourceMessageId: "provider-source-1",
      followUpSequence: 1,
      instruction: "Write a brief follow-up.",
    },
  };
}

function processClient() {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "claim_phase_c_auto_sends") {
      return {
        data: [
          queueRow({
            status: "leased",
            lease_token: IDS.lease,
            claimed_at: "2026-08-07T20:00:00.000Z",
            lease_expires_at: "2026-08-07T20:05:00.000Z",
          }),
        ],
        error: null,
      };
    }
    if (name === "validate_phase_c_auto_send_source_for_delivery") {
      return {
        data: {
          current: true,
          generation_kind: "conversation_reply",
          source_activity_id: IDS.sourceActivity,
          source_message_id: "provider-source-1",
          provider_thread_id: "provider-thread-1",
        },
        error: null,
      };
    }
    if (name === "cancel_phase_c_auto_send") {
      return {
        data: queueRow({
          status: "cancelled",
          lease_token: null,
          cancelled_at: "2026-08-07T20:01:00.000Z",
          error: args.p_reason,
        }),
        error: null,
      };
    }
    if (name === "complete_phase_c_auto_send") {
      return {
        data: queueRow({
          status: "sent",
          lease_token: null,
          sent_at: "2026-08-07T20:01:00.000Z",
          send_intent_id: IDS.sendIntent,
        }),
        error: null,
      };
    }
    throw new Error(`unexpected RPC: ${name}`);
  });
  const from = vi.fn((table: string) => {
    if (table !== "companies") throw new Error(`unexpected table: ${table}`);
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single: subscriptionLookupMock })),
      })),
    };
  });
  return { value: { rpc, from }, rpc };
}

describe("Phase C delayed auto-send source fences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Draft body",
      draftHistoryId: IDS.draftHistory,
      profileType: "client_followup",
    });
    getConnectionMock.mockResolvedValue(mailboxConnection);
    getProviderMock.mockReturnValue({ fetchThread: providerFetchThreadMock });
    resolveMessageSignatureMock.mockResolvedValue({
      recordId: IDS.signature,
      hash: "a".repeat(64),
      html: "<p>Alex</p>",
      text: "Alex",
    });
    renderSignatureMock.mockReturnValue("<p>Draft body</p><signature />");
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

  it("keys an automatic follow-up by canonical source and sequence, not a newly generated draft", () => {
    const base = {
      companyId: IDS.company,
      actorUserId: IDS.actor,
      assignmentVersion: 12,
      assignmentEventId: IDS.assignmentEvent,
      connectionId: IDS.connection,
      opportunityId: IDS.opportunity,
      sourceEmailThreadId: IDS.internalThread,
      providerThreadId: "provider-thread-1",
      inReplyTo: "provider-source-1",
      generationKind: "auto_follow_up" as const,
      sourceActivityId: IDS.sourceActivity,
      followUpSequence: 1,
    };

    const first = buildPhaseCAutoSendIdempotencyKey({
      ...base,
      draftHistoryId: IDS.draftHistory,
    });
    const regenerated = buildPhaseCAutoSendIdempotencyKey({
      ...base,
      draftHistoryId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    });

    expect(regenerated).toBe(first);
    expect(
      buildPhaseCAutoSendIdempotencyKey({
        ...base,
        followUpSequence: 2,
        draftHistoryId: IDS.draftHistory,
      })
    ).not.toBe(first);
    expect(
      buildPhaseCAutoSendIdempotencyKey({
        ...base,
        sourceActivityId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        draftHistoryId: IDS.draftHistory,
      })
    ).not.toBe(first);
  });

  it("reuses a scheduled source reservation before generating another draft", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "reserve_phase_c_auto_send_generation_as_system") {
        return {
          data: {
            disposition: "scheduled",
            to_emails: ["lead@example.com"],
            cc_emails: [],
            pending_auto_send: queueRow(),
          },
          error: null,
        };
      }
      throw new Error(`unexpected RPC: ${name}`);
    });
    requireSupabaseMock.mockReturnValue({ rpc });

    const result = await AutoSendService.scheduleAutoSend(scheduleInput());

    expect(result).toMatchObject({
      outcome: "scheduled",
      pending: { id: IDS.pending },
    });
    expect(generateDraftMock).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("reuses an existing conversation-reply schedule before persisting another draft history row", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "reserve_phase_c_auto_send_generation_as_system") {
        return {
          data: {
            disposition: "scheduled",
            to_emails: ["lead@example.com"],
            cc_emails: [],
            pending_auto_send: queueRow({
              autonomy_level_snapshot: "auto_send",
            }),
          },
          error: null,
        };
      }
      throw new Error(`unexpected RPC: ${name}`);
    });
    requireSupabaseMock.mockReturnValue({ rpc });

    const result = await AutoSendService.scheduleAutoSend({
      ...scheduleInput(),
      generation: {
        kind: "conversation_reply",
        emailAccess,
        sourceActivityId: IDS.sourceActivity,
        sourceMessageId: "provider-source-1",
      },
    });

    expect(result).toMatchObject({
      outcome: "scheduled",
      pending: { id: IDS.pending },
    });
    expect(generateDraftMock).not.toHaveBeenCalled();
  });

  it("continues only after acquiring the exact source generation reservation", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "reserve_phase_c_auto_send_generation_as_system") {
        return { data: acquiredReservation(), error: null };
      }
      if (name === "schedule_phase_c_auto_send_fenced") {
        return { data: queueRow({ status: "pending" }), error: null };
      }
      throw new Error(`unexpected RPC: ${name}`);
    });
    requireSupabaseMock.mockReturnValue({ rpc });

    const result = await AutoSendService.scheduleAutoSend(scheduleInput());

    expect(result.outcome).toBe("scheduled");
    expect(generateDraftMock).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenLastCalledWith(
      "schedule_phase_c_auto_send_fenced",
      expect.any(Object)
    );
  });

  it("persists the exact reply activity and provider message through the fenced schedule RPC", async () => {
    const rpc = vi.fn(async (name: string, _args: Record<string, unknown>) => {
      if (name === "reserve_phase_c_auto_send_generation_as_system") {
        return { data: acquiredReservation(), error: null };
      }
      if (name === "schedule_phase_c_auto_send_fenced") {
        return {
          data: queueRow({
            status: "pending",
            autonomy_level_snapshot: "auto_send",
          }),
          error: null,
        };
      }
      throw new Error(`unexpected RPC: ${name}`);
    });
    requireSupabaseMock.mockReturnValue({ rpc });

    const result = await AutoSendService.scheduleAutoSend({
      ...scheduleInput(),
      generation: {
        kind: "conversation_reply",
        emailAccess,
        sourceActivityId: IDS.sourceActivity,
        sourceMessageId: "provider-source-1",
      },
    });

    expect(result.outcome).toBe("scheduled");
    expect(rpc).toHaveBeenLastCalledWith(
      "schedule_phase_c_auto_send_fenced",
      expect.objectContaining({
        p_generation_kind: "conversation_reply",
        p_source_activity_id: IDS.sourceActivity,
        p_source_message_id: "provider-source-1",
        p_follow_up_sequence: null,
        p_generation_token: IDS.lease,
        p_arguments_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
    );
  });

  it("cancels a claimed reply inside the mailbox lease when the provider thread advanced", async () => {
    const db = processClient();
    requireSupabaseMock.mockReturnValue(db.value);
    providerFetchThreadMock.mockResolvedValue([
      {
        id: "provider-source-1",
        threadId: "provider-thread-1",
        from: "lead@example.com",
        fromName: "Lead",
        to: ["hello@company.test"],
        cc: [],
        subject: "Estimate",
        snippet: "First question",
        bodyText: "First question",
        date: new Date("2026-08-07T19:00:00.000Z"),
        labelIds: [],
        isRead: true,
        hasAttachments: false,
        sizeEstimate: 100,
      },
      {
        id: "provider-source-2",
        threadId: "provider-thread-1",
        from: "lead@example.com",
        fromName: "Lead",
        to: ["hello@company.test"],
        cc: [],
        subject: "Estimate",
        snippet: "Changed question",
        bodyText: "Changed question",
        date: new Date("2026-08-07T19:30:00.000Z"),
        labelIds: [],
        isRead: true,
        hasAttachments: false,
        sizeEstimate: 100,
      },
    ]);

    const result = await AutoSendService.processPendingSends();

    expect(providerFetchThreadMock).toHaveBeenCalledWith("provider-thread-1");
    expect(deliveryRunMock).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledWith(
      "cancel_phase_c_auto_send",
      expect.objectContaining({
        p_id: IDS.pending,
        p_company_id: IDS.company,
        p_lease_token: IDS.lease,
        p_reason: "PHASE_C_AUTO_SEND_SOURCE_STALE",
      })
    );
    expect(result).toMatchObject({ sent: 0, failed: 0, errors: [] });
  });

  it("cancels instead of guessing when two provider messages share the latest timestamp", async () => {
    const db = processClient();
    requireSupabaseMock.mockReturnValue(db.value);
    providerFetchThreadMock.mockResolvedValue([
      {
        id: "provider-source-1",
        date: new Date("2026-08-07T19:30:00.000Z"),
      },
      {
        id: "provider-source-2",
        date: new Date("2026-08-07T19:30:00.000Z"),
      },
    ]);

    const result = await AutoSendService.processPendingSends();

    expect(deliveryRunMock).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledWith(
      "cancel_phase_c_auto_send",
      expect.objectContaining({
        p_id: IDS.pending,
        p_lease_token: IDS.lease,
        p_reason: "PHASE_C_AUTO_SEND_SOURCE_STALE",
      })
    );
    expect(result).toMatchObject({ sent: 0, failed: 0, errors: [] });
  });
});
