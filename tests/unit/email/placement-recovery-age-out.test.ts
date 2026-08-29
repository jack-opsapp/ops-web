import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  actorResolverMock,
  accessResolverMock,
  categoryAutonomyMock,
  categoryGraduationMock,
  notificationInserts,
  notificationDedupeReads,
  threadUpdates,
  companyAdminIds,
  companyAdminUsers,
  existingOpenNotifications,
} = vi.hoisted(() => ({
  actorResolverMock: vi.fn(),
  accessResolverMock: vi.fn(),
  categoryAutonomyMock: vi.fn(),
  categoryGraduationMock: vi.fn(),
  notificationInserts: [] as Array<Record<string, unknown>>,
  notificationDedupeReads: [] as Array<Record<string, unknown>>,
  threadUpdates: [] as Array<Record<string, unknown>>,
  companyAdminIds: { value: null as string[] | null },
  companyAdminUsers: {
    value: [] as Array<{
      id: string;
      deleted_at: string | null;
      is_active: boolean | null;
    }>,
  },
  existingOpenNotifications: { value: [] as Array<{ id: string }> },
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
  AIDraftService: { generateDraft: vi.fn() },
}));

vi.mock("@/lib/api/services/autonomy-milestone-service", () => ({
  AutonomyMilestoneService: { getAutonomyLevel: vi.fn(async () => ({ level: 0 })) },
}));

vi.mock("@/lib/api/services/auto-send-service", () => ({
  AutoSendService: {
    isEnabled: vi.fn(async () => ({ enabled: false, settings: null })),
    scheduleAutoSend: vi.fn(),
  },
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: { getConnection: vi.fn(), getProvider: vi.fn() },
}));

vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: { archive: vi.fn() },
}));

vi.mock("@/lib/email/email-signature-runtime", () => ({
  renderMailboxDraftWithSignature: vi.fn(),
  resolveEmailSignatureForMessage: vi.fn(),
}));

vi.mock("@/lib/email/email-sync-continuation-state", () => ({
  emailSyncContinuationPendingForConnection: vi.fn(async () => false),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = { table };
      const builder: Record<string, unknown> = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        is(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        update(payload: Record<string, unknown>) {
          threadUpdates.push({ table, payload });
          return builder;
        },
        insert(payload: Record<string, unknown>) {
          if (table === "notifications") notificationInserts.push(payload);
          return builder;
        },
        async maybeSingle() {
          if (table === "companies") {
            return { data: { admin_ids: companyAdminIds.value }, error: null };
          }
          return { data: null, error: null };
        },
        async single() {
          return { data: { id: "notification-1" }, error: null };
        },
        then(resolve: (result: { data: unknown; error: null }) => unknown) {
          if (table === "users") {
            return resolve({ data: companyAdminUsers.value, error: null });
          }
          if (table === "notifications") {
            notificationDedupeReads.push({ ...filters });
            return resolve({ data: existingOpenNotifications.value, error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  }),
}));

import { PhaseCAutonomyRouter } from "@/lib/api/services/phase-c-autonomy-router";
import type { EmailThread } from "@/lib/types/email-thread";

const COMPANY_ID = "00000000-0000-4000-8000-0000000000a1";
const CONNECTION_ID = "00000000-0000-4000-8000-0000000000a3";
const OPPORTUNITY_ID = "00000000-0000-4000-8000-0000000000a4";
const THREAD_ID = "00000000-0000-4000-8000-0000000000a5";
const OPERATOR_ID = "00000000-0000-4000-8000-0000000000a6";

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

describe("phase c actor-unavailable is surfaced and re-deferred", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationInserts.length = 0;
    notificationDedupeReads.length = 0;
    threadUpdates.length = 0;
    companyAdminIds.value = [OPERATOR_ID];
    companyAdminUsers.value = [];
    existingOpenNotifications.value = [];
    categoryAutonomyMock.mockResolvedValue({ CUSTOMER: "auto_draft" });
    categoryGraduationMock.mockResolvedValue({
      ready: true,
      approvalRate: 1,
      sampleSize: 20,
    });
    actorResolverMock.mockResolvedValue({
      kind: "no_work",
      reason: "opportunity_unassigned",
    });
  });

  it("raises one actionable alert and re-arms the thread", async () => {
    const result = await PhaseCAutonomyRouter.route(thread());

    expect(result).toEqual({
      outcome: "noop_actor_unavailable",
      category: "CUSTOMER",
      effectiveLevel: "auto_draft",
      detail: "opportunity_unassigned",
    });

    expect(notificationInserts).toHaveLength(1);
    const notification = notificationInserts[0];
    expect(notification.user_id).toBe(OPERATOR_ID);
    expect(notification.company_id).toBe(COMPANY_ID);
    expect(notification.type).toBe("system");
    expect(notification.persistent).toBe(true);
    expect(notification.dedupe_key).toBe(
      `phase-c-actor-unavailable:${THREAD_ID}`
    );
    expect(notification.action_url).toBe(`/inbox/${THREAD_ID}`);
    expect(notification.action_label).toBe("Assign this lead");
    expect(String(notification.body)).toMatch(/assigned/i);

    // The thread is re-armed so the router re-runs once an assignee exists,
    // instead of waiting for new mail to arrive.
    expect(threadUpdates).toEqual([
      { table: "email_threads", payload: { category_classified_at: null } },
    ]);
  });

  it("raises exactly one open alert for a recurring condition", async () => {
    existingOpenNotifications.value = [{ id: "notification-1" }];

    await PhaseCAutonomyRouter.route(thread());

    expect(notificationDedupeReads).toHaveLength(1);
    expect(notificationDedupeReads[0]).toMatchObject({
      dedupe_key: `phase-c-actor-unavailable:${THREAD_ID}`,
      resolved_at: null,
    });
    expect(notificationInserts).toHaveLength(0);
    // The deferral still happens — the work is still owed.
    expect(threadUpdates).toHaveLength(1);
  });

  it("stays a silent noop below auto_draft", async () => {
    categoryAutonomyMock.mockResolvedValue({ CUSTOMER: "draft_on_request" });

    const result = await PhaseCAutonomyRouter.route(thread());

    expect(result.outcome).toBe("noop_draft_on_request");
    expect(notificationInserts).toHaveLength(0);
    expect(threadUpdates).toHaveLength(0);
  });

  it("stays a silent noop for a non-customer thread", async () => {
    categoryAutonomyMock.mockResolvedValue({ VENDOR: "auto_draft" });

    const result = await PhaseCAutonomyRouter.route(
      thread({ primaryCategory: "VENDOR" })
    );

    expect(result.outcome).toBe("noop_actor_unavailable");
    expect(notificationInserts).toHaveLength(0);
    expect(threadUpdates).toHaveLength(0);
  });

  it("never lets a notification failure change the routing outcome", async () => {
    companyAdminIds.value = null;
    companyAdminUsers.value = [];

    const result = await PhaseCAutonomyRouter.route(thread());

    expect(result.outcome).toBe("noop_actor_unavailable");
    expect(notificationInserts).toHaveLength(0);
    // No operator to tell, but the thread is still re-armed.
    expect(threadUpdates).toHaveLength(1);
  });

  it("skips the trace when placement-only work is running", async () => {
    const result = await PhaseCAutonomyRouter.route(thread(), {
      placementOnly: true,
    });

    expect(result.outcome).toBe("noop_actor_unavailable");
    expect(notificationInserts).toHaveLength(0);
    expect(threadUpdates).toHaveLength(0);
  });
});
