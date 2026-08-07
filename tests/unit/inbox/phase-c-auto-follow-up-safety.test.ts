import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const {
  accessResolverMock,
  isAutoSendEnabledMock,
  scheduleAutoSendMock,
  syncContinuationPendingMock,
} = vi.hoisted(() => ({
  accessResolverMock: vi.fn(),
  isAutoSendEnabledMock: vi.fn(),
  scheduleAutoSendMock: vi.fn(),
  syncContinuationPendingMock: vi.fn(),
}));

let tables: Record<string, Row[]>;

vi.mock("@/lib/api/services/auto-send-service", () => ({
  AutoSendService: {
    isEnabled: isAutoSendEnabledMock,
    scheduleAutoSend: scheduleAutoSendMock,
  },
}));

vi.mock("@/lib/email/email-opportunity-access", () => ({
  resolveEmailOpportunityAccess: accessResolverMock,
}));

vi.mock("@/lib/email/email-sync-continuation-state", () => ({
  emailSyncContinuationPendingForConnection: syncContinuationPendingMock,
}));

vi.mock("@/lib/supabase/helpers", () => {
  function query(table: string) {
    const filters: Array<[string, unknown]> = [];
    const chain = {
      select() {
        return chain;
      },
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return chain;
      },
      async maybeSingle() {
        const rows = (tables[table] ?? []).filter((row) =>
          filters.every(([column, value]) => row[column] === value)
        );
        return {
          data: rows.length === 1 ? rows[0] : null,
          error:
            rows.length > 1 ? { message: `expected one ${table} row` } : null,
        };
      },
    };
    return chain;
  }

  return {
    requireSupabase: () => ({ from: (table: string) => query(table) }),
  };
});

vi.mock("@/lib/api/services/ai-draft-service", () => ({
  AIDraftService: { generateDraft: vi.fn() },
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: { getConnection: vi.fn(), getProvider: vi.fn() },
}));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: { archive: vi.fn() },
}));

vi.mock("@/lib/api/services/phase-c-category-autonomy-service", () => ({
  PhaseCCategoryAutonomy: {
    get: vi.fn(),
    isGraduated: vi.fn(),
    profileTypesFor: vi.fn(() => ["client_new_inquiry"]),
  },
}));

vi.mock("@/lib/email/phase-c-email-actor", () => ({
  resolvePhaseCEmailActor: vi.fn(),
}));

vi.mock("@/lib/email/email-signature-runtime", () => ({
  renderMailboxDraftWithSignature: vi.fn(),
  resolveEmailSignatureForMessage: vi.fn(),
}));

import { PhaseCAutonomyRouter } from "@/lib/api/services/phase-c-autonomy-router";
import type { PhaseCEmailActorContext } from "@/lib/email/phase-c-email-actor";
import type { EmailThread } from "@/lib/types/email-thread";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "00000000-0000-4000-8000-000000000002";
const OPPORTUNITY_ID = "00000000-0000-4000-8000-000000000003";
const THREAD_ID = "00000000-0000-4000-8000-000000000004";
const ACTOR_ID = "00000000-0000-4000-8000-000000000005";

const actorContext: PhaseCEmailActorContext = {
  actorUserId: ACTOR_ID,
  assignmentVersion: 4,
  assignmentEventId: "00000000-0000-4000-8000-000000000006",
  companyId: COMPANY_ID,
  connectionId: CONNECTION_ID,
  opportunityId: OPPORTUNITY_ID,
  internalThreadId: THREAD_ID,
  providerThreadId: "provider-thread-1",
  connectionType: "company",
  actorNameSnapshot: "Alex Rivera",
  actorEmailSnapshot: "alex@ops.test",
  clientFacingAddressSnapshot: "hello@company.test",
};

const allowedSendAccess = {
  allowed: true as const,
  actor: { userId: ACTOR_ID, companyId: COMPANY_ID },
  operation: "send" as const,
  threadId: THREAD_ID,
  connectionId: CONNECTION_ID,
  providerThreadId: "provider-thread-1",
  opportunityId: OPPORTUNITY_ID,
  connectionType: "company" as const,
  connectionOwnerId: null,
  pipelineScope: "assigned" as const,
  inboxScope: "assigned" as const,
  usedLegacyPipelineManage: false,
  usedLegacyInboxViewCompany: false,
};

function thread(overrides: Partial<EmailThread> = {}): EmailThread {
  return {
    id: THREAD_ID,
    companyId: COMPANY_ID,
    connectionId: CONNECTION_ID,
    providerThreadId: "provider-thread-1",
    opportunityId: OPPORTUNITY_ID,
    primaryCategory: "CUSTOMER",
    latestDirection: "outbound",
    latestSenderEmail: "hello@company.test",
    archivedAt: null,
    snoozedUntil: null,
    subject: "Estimate",
    labels: [],
    participants: [
      "lead@example.com",
      "alex@ops.test",
      "historic-cc@example.com",
    ],
    lastMessageAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  } as EmailThread;
}

describe("Phase C automatic follow-up safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tables = {
      opportunities: [
        {
          id: OPPORTUNITY_ID,
          company_id: COMPANY_ID,
          contact_email: "Lead Person <LEAD@example.com>",
        },
      ],
      email_threads: [
        {
          id: THREAD_ID,
          company_id: COMPANY_ID,
          connection_id: CONNECTION_ID,
          provider_thread_id: "provider-thread-1",
          opportunity_id: OPPORTUNITY_ID,
          participants: [
            "lead@example.com",
            "alex@ops.test",
            "historic-cc@example.com",
          ],
        },
      ],
      activities: [
        {
          id: "00000000-0000-4000-8000-000000000007",
          company_id: COMPANY_ID,
          email_connection_id: CONNECTION_ID,
          email_thread_id: "provider-thread-1",
          type: "email",
          direction: "outbound",
          email_message_id: "provider-message-1",
          created_at: "2026-07-01T00:00:00.000Z",
        },
      ],
    };
    isAutoSendEnabledMock.mockResolvedValue({
      enabled: true,
      settings: {
        enabled: true,
        businessHoursStart: "08:00",
        businessHoursEnd: "18:00",
        timezone: "UTC",
        delayMinMinutes: 30,
        delayMaxMinutes: 60,
      },
    });
    accessResolverMock.mockResolvedValue(allowedSendAccess);
    syncContinuationPendingMock.mockResolvedValue(false);
    scheduleAutoSendMock.mockResolvedValue({
      outcome: "scheduled",
      pending: { id: "pending-1" },
    });
  });

  it("sends only to the current linked opportunity contact", async () => {
    const result = await PhaseCAutonomyRouter.doAutoFollowUp(
      thread(),
      actorContext,
      "auto_follow_up"
    );

    expect(result.outcome).toBe("auto_follow_up_scheduled");
    expect(scheduleAutoSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toEmails: ["lead@example.com"],
        ccEmails: [],
        inReplyTo: "provider-message-1",
        generation: expect.objectContaining({
          kind: "auto_follow_up",
          autonomousRoutingAuthority: "phase_c_stale_lead_follow_up",
          sourceActivityId: "00000000-0000-4000-8000-000000000007",
          sourceMessageId: "provider-message-1",
          followUpSequence: 1,
        }),
      })
    );
  });

  it("fails closed when the canonical opportunity contact is not on the linked thread", async () => {
    tables.email_threads[0].participants = [
      "alex@ops.test",
      "historic-cc@example.com",
    ];

    const result = await PhaseCAutonomyRouter.doAutoFollowUp(
      thread(),
      actorContext,
      "auto_follow_up"
    );

    expect(result).toMatchObject({
      outcome: "error",
      detail: "canonical follow-up recipient is not on the linked thread",
    });
    expect(scheduleAutoSendMock).not.toHaveBeenCalled();
  });

  it("does not follow up when the exact latest outbound is newer than the stale thread snapshot", async () => {
    tables.activities[0].created_at = new Date().toISOString();

    const result = await PhaseCAutonomyRouter.doAutoFollowUp(
      thread(),
      actorContext,
      "auto_follow_up"
    );

    expect(result.outcome).toBe("noop_not_stale");
    expect(scheduleAutoSendMock).not.toHaveBeenCalled();
  });

  it.each([
    ["assigned operator", "alex@ops.test"],
    ["sending mailbox", "hello@company.test"],
  ])("never sends a follow-up to the %s address", async (_label, address) => {
    tables.opportunities[0].contact_email = address;

    const result = await PhaseCAutonomyRouter.doAutoFollowUp(
      thread(),
      actorContext,
      "auto_follow_up"
    );

    expect(result).toMatchObject({
      outcome: "error",
      detail: "canonical follow-up recipient is internal",
    });
    expect(scheduleAutoSendMock).not.toHaveBeenCalled();
  });
});
