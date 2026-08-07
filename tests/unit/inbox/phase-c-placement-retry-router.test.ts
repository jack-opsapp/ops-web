/**
 * Unit tests — placement-only routing (stranded draft recovery)
 *
 * When mailbox placement fails, `doAutoDraft` returns `draft_placement_pending`
 * and the ai_draft_history row is left at status='drafted' with a null
 * mailbox_draft_id. Nothing re-attempts it except the router, and the router
 * only runs when the thread is classified — which only happens when new inbound
 * mail lands on that same thread. A customer who never writes again strands the
 * draft permanently. Six real drafts had to be placed by hand on 2026-08-06.
 *
 * `retryStrandedMailboxDraft` is the recovery entry point. It reuses the whole
 * routing pre-flight — actionable thread, terminal sync, current autonomy
 * level, live actor authorization — and differs in exactly two ways:
 *   - it will never call the draft model. Recovery places what already exists;
 *     generating a fresh draft is the classification path's job and carries a
 *     cost the recovery sweep has no mandate to spend.
 *   - it will never mark the thread dirty on a deferral, because that would
 *     manufacture reclassification work every time it runs.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  actorResolverMock,
  autonomyGetMock,
  isGraduatedMock,
  connectionState,
  generateDraftMock,
  threadDirtyUpdateMock,
  createDraftMock,
  updateDraftMock,
  getConnectionMock,
  accessMock,
  rpcMock,
  draftHistoryRow,
  latestInboundRow,
} = vi.hoisted(() => ({
  actorResolverMock: vi.fn(),
  autonomyGetMock: vi.fn(),
  isGraduatedMock: vi.fn(),
  connectionState: {
    historyId: "12345",
    recoveryPageToken: null as string | null,
    syncInProgressAt: null as string | null,
  },
  generateDraftMock: vi.fn(),
  threadDirtyUpdateMock: vi.fn(),
  createDraftMock: vi.fn(),
  updateDraftMock: vi.fn(),
  getConnectionMock: vi.fn(),
  accessMock: vi.fn(),
  rpcMock: vi.fn(),
  draftHistoryRow: {
    value: null as Record<string, unknown> | null,
  },
  latestInboundRow: {
    value: { email_message_id: "message-1" } as Record<string, unknown> | null,
  },
}));

vi.mock("@/lib/email/phase-c-email-actor", () => ({
  resolvePhaseCEmailActor: actorResolverMock,
}));
vi.mock("@/lib/api/services/phase-c-category-autonomy-service", () => ({
  PhaseCCategoryAutonomy: {
    get: autonomyGetMock,
    isGraduated: isGraduatedMock,
    profileTypesFor: vi.fn(() => ["general"]),
  },
}));
vi.mock("@/lib/api/services/ai-draft-service", () => ({
  AIDraftService: { generateDraft: generateDraftMock },
}));
vi.mock("@/lib/api/services/auto-send-service", () => ({
  AutoSendService: { isEnabled: vi.fn(), scheduleAutoSend: vi.fn() },
}));
vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getConnection: getConnectionMock,
    getProvider: () => ({
      createDraft: createDraftMock,
      updateDraft: updateDraftMock,
    }),
  },
}));
vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: { archive: vi.fn() },
}));
vi.mock("@/lib/email/email-opportunity-access", () => ({
  resolveEmailOpportunityAccess: accessMock,
}));
vi.mock("@/lib/email/email-signature-runtime", () => ({
  renderMailboxDraftWithSignature: (body: string) => ({
    body,
    contentType: "text",
  }),
  resolveEmailSignatureForMessage: vi.fn(async () => null),
}));
vi.mock("@/lib/api/services/email-provider-mailbox-operation", () => ({
  runEmailProviderMailboxOperation: async (input: {
    run: (checkpoint: (force?: boolean) => Promise<void>) => Promise<unknown>;
  }) => input.run(async () => {}),
}));
vi.mock("@/lib/api/services/email-provider-mutation-attempt-service", () => ({
  buildEmailProviderMutationFingerprint: () => "f".repeat(64),
  createEmailProviderMutationAttemptService: () => ({
    execute: async (input: {
      executeProvider: () => Promise<{ resourceId: string }>;
      reconcile: (acceptance: { resourceId: string }) => Promise<void>;
    }) => {
      const produced = await input.executeProvider();
      await input.reconcile({ resourceId: produced.resourceId });
      return { providerResourceId: produced.resourceId };
    },
  }),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({
    rpc: rpcMock,
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "limit", "not", "is"]) {
        chain[method] = () => chain;
      }
      chain.update = (payload: Record<string, unknown>) => {
        if (table === "email_threads") threadDirtyUpdateMock(payload);
        return chain;
      };
      chain.maybeSingle = async () => ({
        data:
          table === "email_connections"
            ? {
                history_id: connectionState.historyId,
                history_recovery_page_token: connectionState.recoveryPageToken,
                sync_in_progress_at: connectionState.syncInProgressAt,
              }
            : table === "activities"
              ? latestInboundRow.value
              : table === "ai_draft_history"
                ? draftHistoryRow.value
                : null,
        error: null,
      });
      chain.then = (resolve: (value: { data: null; error: null }) => unknown) =>
        resolve({ data: null, error: null });
      return chain;
    },
  }),
}));

import { PhaseCAutonomyRouter } from "@/lib/api/services/phase-c-autonomy-router";
import type { EmailThread } from "@/lib/types/email-thread";

const STRANDED_ROW = {
  id: "draft-history-1",
  status: "drafted",
  mailbox_draft_id: null,
  original_draft: "Hi Steve, early next week works for the deck repair.",
  subject: "Re: Front deck repair",
};

function makeThread(overrides: Record<string, unknown> = {}): EmailThread {
  return {
    id: "thread-1",
    companyId: "company-1",
    connectionId: "connection-1",
    providerThreadId: "provider-thread-1",
    opportunityId: "opportunity-1",
    primaryCategory: "CUSTOMER",
    latestDirection: "inbound",
    latestSenderEmail: "steve@example.com",
    archivedAt: null,
    snoozedUntil: null,
    subject: "Front deck repair",
    labels: [],
    participants: ["steve@example.com"],
    lastMessageAt: new Date("2026-08-06T02:05:00.000Z"),
    ...overrides,
  } as unknown as EmailThread;
}

describe("PhaseCAutonomyRouter.retryStrandedMailboxDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionState.historyId = "12345";
    connectionState.recoveryPageToken = null;
    connectionState.syncInProgressAt = null;
    draftHistoryRow.value = { ...STRANDED_ROW };
    latestInboundRow.value = { email_message_id: "message-1" };
    autonomyGetMock.mockResolvedValue({ CUSTOMER: "auto_draft" });
    actorResolverMock.mockResolvedValue({
      kind: "resolved",
      context: { actorUserId: "user-1" },
    });
    accessMock.mockResolvedValue({ allowed: true });
    getConnectionMock.mockResolvedValue({
      id: "connection-1",
      companyId: "company-1",
    });
    createDraftMock.mockResolvedValue("provider-draft-1");
    rpcMock.mockResolvedValue({ data: true, error: null });
  });

  it("places the stranded draft without asking the model for a new one", async () => {
    const result = await PhaseCAutonomyRouter.retryStrandedMailboxDraft(
      makeThread()
    );

    expect(result).toMatchObject({
      outcome: "auto_drafted",
      detail: "provider-draft-1",
    });
    expect(createDraftMock).toHaveBeenCalledOnce();
    expect(createDraftMock).toHaveBeenCalledWith(
      "steve@example.com",
      "Re: Front deck repair",
      expect.stringContaining("early next week works"),
      "provider-thread-1",
      "text"
    );
    expect(generateDraftMock).not.toHaveBeenCalled();
  });

  it("spends nothing when no stranded draft covers the latest inbound", async () => {
    // The row exists but already reached the mailbox, so there is nothing to
    // re-drive. Recovery must not read that as licence to draft again.
    draftHistoryRow.value = {
      ...STRANDED_ROW,
      mailbox_draft_id: "provider-draft-existing",
      status: "auto_drafted",
    };

    const result = await PhaseCAutonomyRouter.retryStrandedMailboxDraft(
      makeThread()
    );

    // Reporting this as a placement makes the sweep's counter lie: it claims
    // work it did not do, every cycle, forever — and a real drop to zero
    // placements would hide behind the noise. Recovery placed nothing here.
    expect(result.outcome).toBe("noop_no_stranded_draft");
    expect(generateDraftMock).not.toHaveBeenCalled();
    expect(createDraftMock).not.toHaveBeenCalled();
  });

  it("never drafts from scratch for a thread that has none", async () => {
    draftHistoryRow.value = null;

    const result = await PhaseCAutonomyRouter.retryStrandedMailboxDraft(
      makeThread()
    );

    expect(result.outcome).toBe("noop_no_stranded_draft");
    expect(generateDraftMock).not.toHaveBeenCalled();
    expect(createDraftMock).not.toHaveBeenCalled();
  });

  it("leaves the thread clean when the mailbox is still catching up", async () => {
    connectionState.historyId = 'gmail:v1:{"pendingMessageIds":["m-2"]}';

    const result = await PhaseCAutonomyRouter.retryStrandedMailboxDraft(
      makeThread()
    );

    expect(result.outcome).toBe("noop_sync_incomplete");
    // Deferring here would null category_classified_at on every sweep cycle and
    // queue a fresh classification the operator never asked for.
    expect(threadDirtyUpdateMock).not.toHaveBeenCalled();
    expect(createDraftMock).not.toHaveBeenCalled();
  });

  it("still marks the thread dirty when classification defers", async () => {
    // Regression guard for the case above: the classification path's deferral
    // behaviour must be untouched.
    connectionState.historyId = 'gmail:v1:{"pendingMessageIds":["m-2"]}';

    await PhaseCAutonomyRouter.route(makeThread());

    expect(threadDirtyUpdateMock).toHaveBeenCalledWith({
      category_classified_at: null,
    });
  });

  it("stands down once the operator has replied themselves", async () => {
    const result = await PhaseCAutonomyRouter.retryStrandedMailboxDraft(
      makeThread({ latestDirection: "outbound" })
    );

    expect(result.outcome).toBe("noop_not_inbound");
    expect(createDraftMock).not.toHaveBeenCalled();
  });

  it("stands down once autonomy has been switched off", async () => {
    autonomyGetMock.mockResolvedValue({ CUSTOMER: "off" });

    const result = await PhaseCAutonomyRouter.retryStrandedMailboxDraft(
      makeThread()
    );

    expect(result.outcome).toBe("noop_off");
    expect(createDraftMock).not.toHaveBeenCalled();
  });

  it("leaves a send-capable thread to its own pipeline", async () => {
    // A graduated auto_send thread schedules through AutoSendService; a leftover
    // drafted row there predates graduation and must not be pushed into the
    // mailbox behind the send pipeline's back.
    autonomyGetMock.mockResolvedValue({ CUSTOMER: "auto_send" });
    isGraduatedMock.mockResolvedValue({ ready: true });

    const result = await PhaseCAutonomyRouter.retryStrandedMailboxDraft(
      makeThread()
    );

    expect(result.outcome).toBe("noop_placement_not_applicable");
    expect(createDraftMock).not.toHaveBeenCalled();
  });

  it("stands down when the actor can no longer act on the thread", async () => {
    accessMock.mockResolvedValue({ allowed: false, reason: "lead_reassigned" });

    const result = await PhaseCAutonomyRouter.retryStrandedMailboxDraft(
      makeThread()
    );

    expect(result.outcome).toBe("noop_actor_unavailable");
    expect(createDraftMock).not.toHaveBeenCalled();
  });
});
