import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  actorResolverMock,
  accessResolverMock,
  archiveMock,
  categoryAutonomyMock,
  categoryGraduationMock,
  connectionOwnerId,
  generateDraftMock,
  globalLevelMock,
  isAutoSendEnabledMock,
  scheduleAutoSendMock,
} = vi.hoisted(() => ({
  actorResolverMock: vi.fn(),
  accessResolverMock: vi.fn(),
  archiveMock: vi.fn(),
  categoryAutonomyMock: vi.fn(),
  categoryGraduationMock: vi.fn(),
  connectionOwnerId: "00000000-0000-4000-8000-000000000007",
  generateDraftMock: vi.fn(),
  globalLevelMock: vi.fn(async () => ({ level: 0 })),
  isAutoSendEnabledMock: vi.fn(),
  scheduleAutoSendMock: vi.fn(),
}));

vi.mock("@/lib/email/phase-c-email-actor", () => ({
  resolvePhaseCEmailActor: actorResolverMock,
}));

vi.mock("@/lib/email/email-opportunity-access", () => ({
  resolveEmailOpportunityAccess: accessResolverMock,
}));

vi.mock("@/lib/api/services/phase-c-category-autonomy-service", () => ({
  PhaseCCategoryAutonomy: {
    get: categoryAutonomyMock,
    isGraduated: categoryGraduationMock,
    profileTypesFor: vi.fn(() => ["general"]),
  },
}));

vi.mock("@/lib/api/services/ai-draft-service", () => ({
  AIDraftService: { generateDraft: generateDraftMock },
}));

vi.mock("@/lib/api/services/autonomy-milestone-service", () => ({
  AutonomyMilestoneService: {
    getAutonomyLevel: globalLevelMock,
  },
}));

vi.mock("@/lib/api/services/auto-send-service", () => ({
  AutoSendService: {
    isEnabled: isAutoSendEnabledMock,
    scheduleAutoSend: scheduleAutoSendMock,
  },
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: { getConnection: vi.fn(), getProvider: vi.fn() },
}));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: { archive: archiveMock },
}));

vi.mock("@/lib/email/email-signature-runtime", () => ({
  renderMailboxDraftWithSignature: vi.fn(),
  resolveEmailSignatureForMessage: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({
    from: () => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      async maybeSingle() {
        return { data: { user_id: connectionOwnerId }, error: null };
      },
    }),
  }),
}));

import { PhaseCAutonomyRouter } from "@/lib/api/services/phase-c-autonomy-router";
import type { EmailThread } from "@/lib/types/email-thread";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "00000000-0000-4000-8000-000000000003";
const OPPORTUNITY_ID = "00000000-0000-4000-8000-000000000004";
const THREAD_ID = "00000000-0000-4000-8000-000000000005";
const ASSIGNEE_ID = "00000000-0000-4000-8000-000000000006";

function thread(overrides: Partial<EmailThread> = {}): EmailThread {
  return {
    id: THREAD_ID,
    companyId: COMPANY_ID,
    connectionId: CONNECTION_ID,
    providerThreadId: "provider-thread-1",
    opportunityId: OPPORTUNITY_ID,
    primaryCategory: "CUSTOMER",
    latestDirection: "inbound",
    latestSenderEmail: "client@example.com",
    archivedAt: null,
    snoozedUntil: null,
    subject: "Quote request",
    labels: [],
    participants: ["client@example.com"],
    lastMessageAt: new Date(),
    ...overrides,
  } as unknown as EmailThread;
}

describe("PhaseCAutonomyRouter actor resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    categoryAutonomyMock.mockResolvedValue({ CUSTOMER: "auto_draft" });
    categoryGraduationMock.mockResolvedValue({
      ready: true,
      approvalRate: 1,
      sampleSize: 20,
    });
    isAutoSendEnabledMock.mockResolvedValue({ enabled: false, settings: null });
    accessResolverMock.mockResolvedValue({ allowed: true });
  });

  it("stops before draft work when actor resolution returns typed no-work", async () => {
    actorResolverMock.mockResolvedValue({
      kind: "no_work",
      reason: "opportunity_unassigned",
    });
    const draftSpy = vi
      .spyOn(PhaseCAutonomyRouter, "doAutoDraft")
      .mockResolvedValue({
        outcome: "auto_drafted",
        category: "CUSTOMER",
        effectiveLevel: "auto_draft",
      });

    const result = await PhaseCAutonomyRouter.route(thread());

    expect(result).toEqual({
      outcome: "noop_actor_unavailable",
      category: "CUSTOMER",
      effectiveLevel: "auto_draft",
      detail: "opportunity_unassigned",
    });
    expect(draftSpy).not.toHaveBeenCalled();
    expect(generateDraftMock).not.toHaveBeenCalled();
  });

  it("passes the resolved assignee UUID into autonomous draft work", async () => {
    actorResolverMock.mockResolvedValue({
      kind: "resolved",
      context: {
        actorUserId: ASSIGNEE_ID,
        assignmentVersion: 7,
      },
    });
    const draftSpy = vi
      .spyOn(PhaseCAutonomyRouter, "doAutoDraft")
      .mockResolvedValue({
        outcome: "auto_drafted",
        category: "CUSTOMER",
        effectiveLevel: "auto_draft",
      });
    const input = thread();

    await PhaseCAutonomyRouter.route(input);

    expect(actorResolverMock).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      connectionId: CONNECTION_ID,
      opportunityId: OPPORTUNITY_ID,
      internalThreadId: THREAD_ID,
      providerThreadId: "provider-thread-1",
    });
    expect(draftSpy).toHaveBeenCalledWith(input, ASSIGNEE_ID, "auto_draft");
  });

  it("passes the complete immutable actor fence into auto-send scheduling", async () => {
    const context = {
      actorUserId: ASSIGNEE_ID,
      assignmentVersion: 7,
      assignmentEventId: "00000000-0000-4000-8000-000000000008",
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
    actorResolverMock.mockResolvedValue({ kind: "resolved", context });
    categoryAutonomyMock.mockResolvedValue({ CUSTOMER: "auto_send" });
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
    scheduleAutoSendMock.mockResolvedValue({ id: "pending-1" });

    const result = await PhaseCAutonomyRouter.route(thread());

    expect(result.outcome).toBe("auto_sent_scheduled");
    expect(scheduleAutoSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorContext: context,
        category: "CUSTOMER",
      })
    );
    expect(globalLevelMock).not.toHaveBeenCalled();
  });

  it("downgrades company auto-send intent when the resolved assignee has not graduated on that mailbox and category", async () => {
    const context = {
      actorUserId: ASSIGNEE_ID,
      assignmentVersion: 7,
      assignmentEventId: "00000000-0000-4000-8000-000000000008",
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
    actorResolverMock.mockResolvedValue({ kind: "resolved", context });
    categoryAutonomyMock.mockResolvedValue({ CUSTOMER: "auto_send" });
    categoryGraduationMock.mockResolvedValue({
      ready: false,
      approvalRate: 0.5,
      sampleSize: 20,
    });
    const draftSpy = vi
      .spyOn(PhaseCAutonomyRouter, "doAutoDraft")
      .mockResolvedValue({
        outcome: "auto_drafted",
        category: "CUSTOMER",
        effectiveLevel: "auto_draft",
      });
    const input = thread();

    const result = await PhaseCAutonomyRouter.route(input);

    expect(categoryGraduationMock).toHaveBeenCalledWith(
      COMPANY_ID,
      CONNECTION_ID,
      ASSIGNEE_ID,
      "CUSTOMER"
    );
    expect(draftSpy).toHaveBeenCalledWith(input, ASSIGNEE_ID, "auto_draft");
    expect(scheduleAutoSendMock).not.toHaveBeenCalled();
    expect(result.outcome).toBe("auto_drafted");
  });

  it("does not auto-archive an inaccessible or unrelated thread", async () => {
    categoryAutonomyMock.mockResolvedValue({ CUSTOMER: "auto_archive" });
    actorResolverMock.mockResolvedValue({
      kind: "no_work",
      reason: "personal_owner_not_assignee",
    });

    const result = await PhaseCAutonomyRouter.route(thread());

    expect(result).toEqual({
      outcome: "noop_actor_unavailable",
      category: "CUSTOMER",
      effectiveLevel: "auto_archive",
      detail: "personal_owner_not_assignee",
    });
    expect(archiveMock).not.toHaveBeenCalled();
  });

  it("re-authorizes immediately before an autonomous archive mutation", async () => {
    const context = {
      actorUserId: ASSIGNEE_ID,
      assignmentVersion: 7,
      assignmentEventId: "00000000-0000-4000-8000-000000000008",
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
    categoryAutonomyMock.mockResolvedValue({ MARKETING: "auto_archive" });
    actorResolverMock.mockResolvedValue({ kind: "resolved", context });
    accessResolverMock.mockResolvedValue({
      allowed: false,
      reason: "opportunity_other_assignee",
    });
    const input = thread({ primaryCategory: "MARKETING" });

    const result = await PhaseCAutonomyRouter.route(input);

    expect(accessResolverMock).toHaveBeenCalledWith({
      actor: { userId: ASSIGNEE_ID, companyId: COMPANY_ID },
      operation: "mutate",
      threadId: THREAD_ID,
      connectionId: CONNECTION_ID,
      providerThreadId: "provider-thread-1",
      opportunityId: OPPORTUNITY_ID,
      supabase: expect.any(Object),
    });
    expect(result).toEqual({
      outcome: "noop_actor_unavailable",
      category: "MARKETING",
      effectiveLevel: "auto_archive",
      detail: "opportunity_other_assignee",
    });
    expect(archiveMock).not.toHaveBeenCalled();
  });
});
