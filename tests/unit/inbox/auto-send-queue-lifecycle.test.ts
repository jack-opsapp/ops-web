import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  generateDraftMock,
  getConnectionMock,
  getProviderMock,
  renderSignatureMock,
  requireSupabaseMock,
  resolveMessageSignatureMock,
} = vi.hoisted(() => ({
  generateDraftMock: vi.fn(),
  getConnectionMock: vi.fn(),
  getProviderMock: vi.fn(),
  renderSignatureMock: vi.fn(),
  requireSupabaseMock: vi.fn(),
  resolveMessageSignatureMock: vi.fn(),
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

vi.mock("@/lib/api/services/email-signature-service", () => ({
  renderEmailBodyWithSignature: renderSignatureMock,
}));

vi.mock("@/lib/email/email-signature-runtime", () => ({
  resolveEmailSignatureForMessage: resolveMessageSignatureMock,
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: getConnectionMock,
    getProvider: getProviderMock,
  },
}));

vi.mock("@/lib/utils/markdown-to-email-html", () => ({
  markdownToEmailHtml: (body: string) => `<p>${body}</p>`,
}));

import {
  AutoSendService,
  buildPhaseCAutoSendIdempotencyKey,
  type PendingAutoSend,
} from "@/lib/api/services/auto-send-service";

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
  provider: "gmail" as const,
  type: "company" as const,
  userId: null,
  email: "hello@company.test",
  accessToken: "test-access-token",
  refreshToken: "test-refresh-token",
  expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  historyId: null,
  syncEnabled: true,
  lastSyncedAt: null,
  syncIntervalMinutes: 15,
  syncFilters: {},
  historyRecoveryAnchor: null,
  historyRecoveryPageToken: null,
  historyRecoveryTargetToken: null,
  webhookSubscriptionId: null,
  webhookExpiresAt: null,
  webhookClientStateHash: null,
  opsLabelId: null,
  aiReviewEnabled: true,
  aiMemoryEnabled: true,
  status: "active" as const,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function dbRow(overrides: Record<string, unknown> = {}) {
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
    cc_emails: [],
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

function makeClient(
  handler: (name: string, args: Record<string, unknown>) => unknown
) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => ({
    data: handler(name, args),
    error: null,
  }));
  const from = vi.fn(() => {
    throw new Error("direct table access is forbidden in this lifecycle test");
  });
  return { client: { rpc, from }, rpc, from };
}

function scheduleInput() {
  return {
    companyId: IDS.company,
    connectionId: IDS.connection,
    opportunityId: IDS.opportunity,
    threadId: "provider-thread-1",
    inReplyTo: "provider-message-1",
    toEmails: ["lead@example.com"],
    subject: "Estimate",
    settings,
    actorContext,
  };
}

describe("AutoSendService queue lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateDraftMock.mockResolvedValue({
      available: true,
      draft: "Draft body",
      draftHistoryId: IDS.draftHistory,
      profileType: "lead-estimate",
    });
    getConnectionMock.mockResolvedValue(mailboxConnection);
    resolveMessageSignatureMock.mockResolvedValue({
      recordId: IDS.signature,
      hash: "a".repeat(64),
      html: "<p>Alex</p>",
      text: "Alex",
    });
    renderSignatureMock.mockReturnValue("<p>Draft body</p><signature />");
  });

  it("refreshes through the canonical signature resolver and schedules its rendered output", async () => {
    const db = makeClient((name) => {
      if (name === "schedule_phase_c_auto_send") {
        return dbRow({ status: "pending", lease_token: null });
      }
      throw new Error(`unexpected RPC: ${name}`);
    });
    requireSupabaseMock.mockReturnValue(db.client);

    const result = await AutoSendService.scheduleAutoSend(scheduleInput());

    expect(generateDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: IDS.actor,
        companyId: IDS.company,
        connectionId: IDS.connection,
        opportunityId: IDS.opportunity,
        threadId: "provider-thread-1",
        autonomous: true,
      })
    );
    expect(getConnectionMock).toHaveBeenCalledWith(IDS.connection);
    expect(resolveMessageSignatureMock).toHaveBeenCalledWith({
      supabase: db.client,
      connection: mailboxConnection,
      userId: IDS.actor,
      refreshProviderIfMissing: true,
    });
    expect(renderSignatureMock).toHaveBeenCalledWith({
      body: "<p>Draft body</p>",
      contentType: "html",
      signature: {
        recordId: IDS.signature,
        hash: "a".repeat(64),
        html: "<p>Alex</p>",
        text: "Alex",
      },
    });
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledTimes(1);

    const [, args] = db.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args).toMatchObject({
      p_company_id: IDS.company,
      p_actor_user_id: IDS.actor,
      p_assignment_version: 12,
      p_assignment_event_id: IDS.assignmentEvent,
      p_connection_id: IDS.connection,
      p_opportunity_id: IDS.opportunity,
      p_source_email_thread_id: IDS.internalThread,
      p_reply_provider_thread_id: "provider-thread-1",
      p_in_reply_to: "provider-message-1",
      p_draft_history_id: IDS.draftHistory,
      p_draft_text: "Draft body",
      p_authored_body: "<p>Draft body</p>",
      p_rendered_body: "<p>Draft body</p><signature />",
      p_content_type: "html",
      p_profile_type_snapshot: "lead-estimate",
      p_learning_authority: "autonomous",
      p_signature_id: IDS.signature,
      p_signature_content_hash: "a".repeat(64),
    });
    expect(args.p_idempotency_key).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_rendered_body_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result?.actorUserId).toBe(IDS.actor);
  });

  it("preserves the draft and opens the signature prompt instead of scheduling unsigned email", async () => {
    resolveMessageSignatureMock.mockResolvedValueOnce(null);
    const db = makeClient((name) => {
      throw new Error(`unexpected RPC: ${name}`);
    });
    requireSupabaseMock.mockReturnValue(db.client);

    const result = await AutoSendService.scheduleAutoSend(scheduleInput());

    expect(result).toBeNull();
    expect(generateDraftMock).toHaveBeenCalledOnce();
    expect(resolveMessageSignatureMock).toHaveBeenCalledWith({
      supabase: db.client,
      connection: mailboxConnection,
      userId: IDS.actor,
      refreshProviderIfMissing: true,
    });
    expect(db.rpc).not.toHaveBeenCalledWith(
      "schedule_phase_c_auto_send",
      expect.any(Object)
    );
    expect(db.from).not.toHaveBeenCalled();
    expect(getProviderMock).not.toHaveBeenCalled();
  });

  it("builds a stable key from immutable source identity, not message content", () => {
    const input = {
      companyId: IDS.company,
      actorUserId: IDS.actor,
      assignmentVersion: 12,
      assignmentEventId: IDS.assignmentEvent,
      connectionId: IDS.connection,
      opportunityId: IDS.opportunity,
      sourceEmailThreadId: IDS.internalThread,
      providerThreadId: "provider-thread-1",
      inReplyTo: "provider-message-1",
      draftHistoryId: IDS.draftHistory,
    };

    expect(buildPhaseCAutoSendIdempotencyKey(input)).toBe(
      buildPhaseCAutoSendIdempotencyKey({ ...input })
    );
    expect(buildPhaseCAutoSendIdempotencyKey(input)).toMatch(/^[0-9a-f]{64}$/);
    expect(
      buildPhaseCAutoSendIdempotencyKey({
        ...input,
        assignmentEventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      })
    ).not.toBe(buildPhaseCAutoSendIdempotencyKey(input));
  });

  it("fails closed before drafting when the canonical actor fence is absent", async () => {
    const db = makeClient(() => dbRow());
    requireSupabaseMock.mockReturnValue(db.client);

    const result = await AutoSendService.scheduleAutoSend({
      ...scheduleInput(),
      actorContext: undefined,
      userId: "legacy-connection-owner",
    });

    expect(result).toBeNull();
    expect(generateDraftMock).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("fails closed before drafting when the assignment event fence is empty", async () => {
    const db = makeClient(() => dbRow());
    requireSupabaseMock.mockReturnValue(db.client);

    const result = await AutoSendService.scheduleAutoSend({
      ...scheduleInput(),
      actorContext: { ...actorContext, assignmentEventId: "" },
    });

    expect(result).toBeNull();
    expect(generateDraftMock).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("claims source records for root delivery without resolving a connection owner or calling a provider", async () => {
    const db = makeClient((name) => {
      if (name === "claim_phase_c_auto_sends") return [dbRow()];
      throw new Error(`unexpected RPC: ${name}`);
    });
    requireSupabaseMock.mockReturnValue(db.client);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const claimed = await AutoSendService.claimPendingSends();

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      id: IDS.pending,
      actorUserId: IDS.actor,
      assignmentVersion: 12,
      assignmentEventId: IDS.assignmentEvent,
      connectionId: IDS.connection,
      opportunityId: IDS.opportunity,
      sourceEmailThreadId: IDS.internalThread,
      providerThreadId: "provider-thread-1",
      authoredBody: "<p>Draft body</p>",
      renderedBody: "<p>Draft body</p><signature />",
      draftHistoryId: IDS.draftHistory,
      learningAuthority: "autonomous",
      idempotencyKey: "c".repeat(64),
      leaseToken: IDS.lease,
    });
    expect(db.rpc).toHaveBeenCalledWith("claim_phase_c_auto_sends", {
      p_limit: 50,
      p_lease_seconds: 300,
    });
    expect(db.from).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("completes, retries, and cancels only through token-fenced RPCs", async () => {
    const db = makeClient((name) => {
      if (name === "complete_phase_c_auto_send") {
        return dbRow({ status: "sent", send_intent_id: IDS.sendIntent });
      }
      if (name === "retry_phase_c_auto_send") {
        return dbRow({ status: "pending", lease_token: null, retry_count: 1 });
      }
      if (name === "cancel_phase_c_auto_send") {
        return dbRow({ status: "cancelled", lease_token: null });
      }
      throw new Error(`unexpected RPC: ${name}`);
    });
    requireSupabaseMock.mockReturnValue(db.client);

    const completed = await AutoSendService.completeClaim({
      id: IDS.pending,
      companyId: IDS.company,
      leaseToken: IDS.lease,
      sendIntentId: IDS.sendIntent,
    });
    const retried = await AutoSendService.retryClaim({
      id: IDS.pending,
      companyId: IDS.company,
      leaseToken: IDS.lease,
      error: "transient integration failure",
      retryAt: "2026-07-15T20:10:00.000Z",
    });
    const cancelled = await AutoSendService.cancelAutoSend(
      IDS.pending,
      IDS.company,
      {
        leaseToken: IDS.lease,
        reason: "worker cancelled",
        actorUserId: null,
      }
    );

    expect(completed?.status).toBe("sent");
    expect(retried?.status).toBe("pending");
    expect(cancelled).toBe(true);
    expect(db.rpc).toHaveBeenNthCalledWith(1, "complete_phase_c_auto_send", {
      p_id: IDS.pending,
      p_company_id: IDS.company,
      p_lease_token: IDS.lease,
      p_send_intent_id: IDS.sendIntent,
    });
    expect(db.rpc).toHaveBeenNthCalledWith(2, "retry_phase_c_auto_send", {
      p_id: IDS.pending,
      p_company_id: IDS.company,
      p_lease_token: IDS.lease,
      p_error: "transient integration failure",
      p_retry_at: "2026-07-15T20:10:00.000Z",
    });
    expect(db.rpc).toHaveBeenNthCalledWith(3, "cancel_phase_c_auto_send", {
      p_id: IDS.pending,
      p_company_id: IDS.company,
      p_lease_token: IDS.lease,
      p_reason: "worker cancelled",
      p_actor_user_id: null,
    });
  });

  it("maps claimed queue rows into the public lifecycle type", async () => {
    const db = makeClient(() => [dbRow()]);
    requireSupabaseMock.mockReturnValue(db.client);

    const claimed = await AutoSendService.claimPendingSends();
    const pending: PendingAutoSend = claimed[0];

    expect(pending.status).toBe("leased");
    expect(pending.leaseExpiresAt).toEqual(
      new Date("2026-07-15T20:05:00.000Z")
    );
  });

  it("rejects a claimed source when the assignment event fence is absent", async () => {
    const db = makeClient(() => [dbRow({ assignment_event_id: null })]);
    requireSupabaseMock.mockReturnValue(db.client);

    await expect(AutoSendService.claimPendingSends()).rejects.toThrow(
      "PHASE_C_AUTO_SEND_INVALID_CLAIM"
    );
  });
});
