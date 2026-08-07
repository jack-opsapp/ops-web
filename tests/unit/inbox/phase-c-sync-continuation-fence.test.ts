import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  actorResolverMock,
  autonomyGetMock,
  connectionState,
  generateDraftMock,
  threadDirtyUpdateMock,
} = vi.hoisted(() => ({
  actorResolverMock: vi.fn(),
  autonomyGetMock: vi.fn(),
  connectionState: {
    historyId: 'gmail:v1:{"pendingMessageIds":["m-2"]}',
    recoveryPageToken: null as string | null,
    syncInProgressAt: null as string | null,
  },
  generateDraftMock: vi.fn(),
  threadDirtyUpdateMock: vi.fn(),
}));

vi.mock("@/lib/email/phase-c-email-actor", () => ({
  resolvePhaseCEmailActor: actorResolverMock,
}));
vi.mock("@/lib/api/services/phase-c-category-autonomy-service", () => ({
  PhaseCCategoryAutonomy: {
    get: autonomyGetMock,
    isGraduated: vi.fn(),
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
  EmailService: { getConnection: vi.fn(), getProvider: vi.fn() },
}));
vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: { archive: vi.fn() },
}));
vi.mock("@/lib/email/email-opportunity-access", () => ({
  resolveEmailOpportunityAccess: vi.fn(),
}));
vi.mock("@/lib/email/email-signature-runtime", () => ({
  renderMailboxDraftWithSignature: vi.fn(),
  resolveEmailSignatureForMessage: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({
    from: (table: string) => {
      const chain: Record<string, any> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
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

describe("Phase C terminal-sync fence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionState.historyId = 'gmail:v1:{"pendingMessageIds":["m-2"]}';
    connectionState.recoveryPageToken = null;
    connectionState.syncInProgressAt = null;
  });

  it("keeps the thread dirty and performs no autonomous work during a continuation", async () => {
    const thread = {
      id: "thread-1",
      companyId: "company-1",
      connectionId: "connection-1",
      providerThreadId: "provider-thread-1",
      opportunityId: "opportunity-1",
      primaryCategory: "CUSTOMER",
      latestDirection: "inbound",
      latestSenderEmail: "rose@example.com",
      archivedAt: null,
      snoozedUntil: null,
      subject: "Re: Schedule",
      labels: [],
      participants: ["rose@example.com"],
      lastMessageAt: new Date("2026-07-31T18:00:00.000Z"),
    } as unknown as EmailThread;

    await expect(PhaseCAutonomyRouter.route(thread)).resolves.toEqual({
      outcome: "noop_sync_incomplete",
      category: "CUSTOMER",
      effectiveLevel: "off",
      detail: "mailbox_sync_continuation_pending",
    });
    expect(threadDirtyUpdateMock).toHaveBeenCalledWith({
      category_classified_at: null,
    });
    expect(autonomyGetMock).not.toHaveBeenCalled();
    expect(actorResolverMock).not.toHaveBeenCalled();
    expect(generateDraftMock).not.toHaveBeenCalled();
  });

  it("defers while a terminal-looking cursor is still being assembled by an active sync", async () => {
    connectionState.historyId = "200";
    connectionState.syncInProgressAt = "2026-07-31T18:00:00.000Z";
    const thread = {
      id: "thread-1",
      companyId: "company-1",
      connectionId: "connection-1",
      providerThreadId: "provider-thread-1",
      opportunityId: "opportunity-1",
      primaryCategory: "CUSTOMER",
      latestDirection: "inbound",
      latestSenderEmail: "rose@example.com",
      archivedAt: null,
      snoozedUntil: null,
      subject: "Re: Schedule",
      labels: [],
      participants: ["rose@example.com"],
      lastMessageAt: new Date("2026-07-31T18:00:00.000Z"),
    } as unknown as EmailThread;

    await expect(PhaseCAutonomyRouter.route(thread)).resolves.toEqual({
      outcome: "noop_sync_incomplete",
      category: "CUSTOMER",
      effectiveLevel: "off",
      detail: "mailbox_sync_continuation_pending",
    });
    expect(autonomyGetMock).not.toHaveBeenCalled();
    expect(generateDraftMock).not.toHaveBeenCalled();
  });

  it("defers while an expired-history recovery still has another page", async () => {
    connectionState.historyId = "200";
    connectionState.recoveryPageToken = "page-2";
    const thread = {
      id: "thread-1",
      companyId: "company-1",
      connectionId: "connection-1",
      providerThreadId: "provider-thread-1",
      opportunityId: "opportunity-1",
      primaryCategory: "CUSTOMER",
      latestDirection: "inbound",
      latestSenderEmail: "rose@example.com",
      archivedAt: null,
      snoozedUntil: null,
      subject: "Re: Schedule",
      labels: [],
      participants: ["rose@example.com"],
      lastMessageAt: new Date("2026-07-31T18:00:00.000Z"),
    } as unknown as EmailThread;

    await expect(PhaseCAutonomyRouter.route(thread)).resolves.toMatchObject({
      outcome: "noop_sync_incomplete",
    });
    expect(autonomyGetMock).not.toHaveBeenCalled();
  });
});
