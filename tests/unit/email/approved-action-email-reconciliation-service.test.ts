import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  persistCapturedProviderDeliveryTurn: vi.fn(),
  upsertFromEmail: vi.fn(),
  dismissAwaitingReply: vi.fn(),
  createNotification: vi.fn(),
  handleRescheduleCascade: vi.fn(),
}));

vi.mock(
  "@/lib/agent-control-plane/memory/persist-captured-provider-delivery-turn",
  () => ({
    persistCapturedProviderDeliveryTurn:
      mocks.persistCapturedProviderDeliveryTurn,
  })
);
vi.mock("@/lib/api/services/email-outbound-learning-service", () => ({
  EmailOutboundLearningService: class EmailOutboundLearningService {},
}));
vi.mock("@/lib/api/services/email-provider-label-writeback", () => ({
  applyEmailProviderLabelWriteback: vi.fn(),
}));
vi.mock("@/lib/api/services/email-thread-service", () => ({
  EmailThreadService: {
    upsertFromEmail: mocks.upsertFromEmail,
    dismissAwaitingReply: mocks.dismissAwaitingReply,
  },
}));
vi.mock("@/lib/api/services/notification-service", () => ({
  NotificationService: { create: mocks.createNotification },
}));
vi.mock("@/lib/api/services/opportunity-lifecycle-service", () => ({
  OpportunityLifecycleService: {},
}));
vi.mock("@/lib/api/services/provider-delivery-source-service", () => ({
  captureAcceptedOutboundProviderDeliverySource: vi.fn().mockResolvedValue({
    sourceId: "00000000-0000-4000-8000-000000000003",
    sourceSha256: `sha256:${"a".repeat(64)}`,
    inserted: true,
  }),
}));
vi.mock("@/lib/api/services/schedule-optimization-service", () => ({
  ScheduleOptimizationService: {
    handleRescheduleCascade: mocks.handleRescheduleCascade,
  },
}));

import { reconcileApprovedActionEmail } from "@/lib/api/services/approved-action-email-reconciliation-service";
import { isDatabasePressureError } from "@/lib/api/services/cron-workload-control-service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.persistCapturedProviderDeliveryTurn.mockResolvedValue({
    turnId: "00000000-0000-4000-8000-000000000008",
    inserted: true,
  });
  mocks.upsertFromEmail.mockResolvedValue({
    threadRow: { id: "thread-row-1", latestDirection: "outbound", labels: [] },
  });
  mocks.dismissAwaitingReply.mockResolvedValue(undefined);
  mocks.createNotification.mockResolvedValue(undefined);
});

describe("approved-action email reconciliation database boundaries", () => {
  it("preserves the raw Supabase cause when canonical activity persistence is under pressure", async () => {
    const error = {
      code: "",
      message: "Web server is down",
      details: "",
      hint: "",
    };
    const single = vi.fn().mockResolvedValue({
      data: null,
      error,
      status: 521,
      statusText: "Web Server Is Down",
    });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));

    const failure = await reconcileApprovedActionEmail({
      supabase: { from } as never,
      intent: {
        id: "00000000-0000-4000-8000-000000000005",
        status: "provider_accepted",
        companyId: "00000000-0000-4000-8000-000000000001",
        connectionId: "00000000-0000-4000-8000-000000000002",
        providerMessageId: "provider-message-1",
        acceptedProviderThreadId: "provider-thread-1",
        providerAcceptedAt: "2026-08-09T18:00:00.000Z",
        subject: "Project update",
        authoredBody: "Exact authored body",
        renderedBody: "Exact rendered body",
        renderedBodyHash: "b".repeat(64),
        contentType: "text",
        opportunityId: null,
        projectId: null,
        clientId: null,
        invoiceId: null,
        actorUserId: "00000000-0000-4000-8000-000000000004",
        actorNameSnapshot: "Alex Rivera",
        clientFromAddressSnapshot: "alex@example.com",
        toEmails: ["client@example.com"],
        ccEmails: [],
        draftHistoryId: null,
      } as never,
      connection: {
        id: "00000000-0000-4000-8000-000000000002",
        companyId: "00000000-0000-4000-8000-000000000001",
      } as never,
      provider: { applyLabel: vi.fn() },
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      name: "CronDatabaseOperationError",
      cause: {
        error,
        status: 521,
        statusText: "Web Server Is Down",
      },
    });
    expect(isDatabasePressureError(failure)).toBe(true);
  });

  it("runs the reschedule cascade in strict mode so database pressure cannot be swallowed", async () => {
    const cause = {
      status: 503,
      code: "503",
      message: "Service unavailable",
    };
    mocks.handleRescheduleCascade.mockImplementation(
      async (...args: unknown[]) => {
        const options = args[4] as { throwOnError?: boolean } | undefined;
        if (options?.throwOnError) throw cause;
        return { cascadeProposed: 0 };
      }
    );

    const activityBuilder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["insert", "select"]) {
      activityBuilder[method] = vi.fn(() => activityBuilder);
    }
    activityBuilder.single = vi.fn().mockResolvedValue({
      data: { id: "00000000-0000-4000-8000-000000000007" },
      error: null,
    });

    const taskBuilder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["update", "eq", "select"]) {
      taskBuilder[method] = vi.fn(() => taskBuilder);
    }
    taskBuilder.single = vi.fn().mockResolvedValue({
      data: { calendar_event_id: null },
      error: null,
    });

    const from = vi.fn((table: string) => {
      if (table === "activities") return activityBuilder;
      if (table === "project_tasks") return taskBuilder;
      throw new Error(`Unexpected table: ${table}`);
    });

    const failure = await reconcileApprovedActionEmail({
      supabase: { from } as never,
      intent: {
        id: "00000000-0000-4000-8000-000000000005",
        status: "provider_accepted",
        actionType: "process_reschedule_request",
        actionDataSnapshot: {
          affected_task_id: "00000000-0000-4000-8000-000000000006",
          suggested_alternatives: [{ date: "2026-08-12T16:00:00.000Z" }],
        },
        companyId: "00000000-0000-4000-8000-000000000001",
        connectionId: "00000000-0000-4000-8000-000000000002",
        providerMessageId: "provider-message-1",
        acceptedProviderThreadId: "provider-thread-1",
        providerAcceptedAt: "2026-08-09T18:00:00.000Z",
        subject: "Project update",
        authoredBody: "Exact authored body",
        renderedBody: "Exact rendered body",
        renderedBodyHash: "b".repeat(64),
        contentType: "text",
        opportunityId: null,
        projectId: "00000000-0000-4000-8000-000000000009",
        clientId: null,
        invoiceId: null,
        actorUserId: "00000000-0000-4000-8000-000000000004",
        actorNameSnapshot: "Alex Rivera",
        clientFromAddressSnapshot: "alex@example.com",
        toEmails: ["client@example.com"],
        ccEmails: [],
        draftHistoryId: null,
      } as never,
      connection: {
        id: "00000000-0000-4000-8000-000000000002",
        companyId: "00000000-0000-4000-8000-000000000001",
      } as never,
      provider: { applyLabel: vi.fn() },
    }).catch((error: unknown) => error);

    expect(mocks.handleRescheduleCascade).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000004",
      "00000000-0000-4000-8000-000000000006",
      "reschedule_request",
      { throwOnError: true }
    );
    expect(failure).toMatchObject({
      name: "CronDatabaseOperationError",
      cause,
    });
    expect(isDatabasePressureError(failure)).toBe(true);
  });
});
