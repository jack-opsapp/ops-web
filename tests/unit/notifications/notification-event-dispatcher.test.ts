import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveEvent: vi.fn(),
  resolvePreferences: vi.fn(),
  createRail: vi.fn(),
  sendPush: vi.fn(),
}));

vi.mock("@/lib/notifications/notification-event-resolver", () => ({
  resolveNotificationEvent: (...args: unknown[]) => mocks.resolveEvent(...args),
}));

vi.mock("@/lib/notifications/server-notification-service", () => ({
  resolveNotificationPreferences: (...args: unknown[]) =>
    mocks.resolvePreferences(...args),
  createTrustedNotifications: (...args: unknown[]) => mocks.createRail(...args),
}));

vi.mock("@/lib/integrations/onesignal", () => ({
  sendOneSignalPush: (...args: unknown[]) => mocks.sendPush(...args),
}));

import { dispatchNotificationEvent } from "@/lib/notifications/dispatch-notification-event";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  name: "Operator One",
};
const projectId = "33333333-3333-4333-8333-333333333333";
const statusEventId = "44444444-4444-4444-8444-444444444444";
const recipientOne = "55555555-5555-4555-8555-555555555555";
const recipientTwo = "66666666-6666-4666-8666-666666666666";

function resolvedEvent(eventType: "project_status_change") {
  return {
    ok: true as const,
    event: {
      eventType,
      companyId: actor.companyId,
      recipientUserIds: [recipientOne, recipientTwo],
      preferenceKey: "project_updates",
      type: eventType,
      title: "Project status changed",
      body: "The project moved forward.",
      persistent: false,
      actionUrl: `/dashboard?openProject=${projectId}`,
      actionLabel: "View Project",
      projectId,
      deepLinkType: "project",
      dedupeKey: `${eventType}:${statusEventId}`,
      pushData: { type: "projectStatusChange", projectId },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolvePreferences.mockResolvedValue({
    inAppRecipientIds: [recipientOne, recipientTwo],
    pushRecipientIds: [recipientOne, recipientTwo],
    emailRecipientIds: [],
  });
  mocks.createRail.mockResolvedValue({
    attempted: 2,
    errors: 0,
    createdRecipientIds: [recipientOne],
  });
  mocks.sendPush.mockResolvedValue({ ok: true, recipients: 2 });
});

describe("notification event dispatcher", () => {
  it("retries project status push for every eligible recipient with the immutable event id", async () => {
    mocks.resolveEvent.mockResolvedValue(
      resolvedEvent("project_status_change")
    );

    const result = await dispatchNotificationEvent({
      db: {} as never,
      actor,
      request: {
        eventType: "project_status_change",
        projectId,
        projectStatusEventId: statusEventId,
      },
    });

    expect(mocks.sendPush).toHaveBeenCalledWith({
      recipientUserIds: [recipientOne, recipientTwo],
      title: "Project status changed",
      body: "The project moved forward.",
      data: { type: "projectStatusChange", projectId },
      idempotencyKey: statusEventId,
    });
    expect(result).toEqual({ ok: true, notified: 1, pushed: 2, emailed: 0 });
  });

  it("returns a retryable failure when OneSignal rejects a project status push", async () => {
    mocks.resolveEvent.mockResolvedValue(
      resolvedEvent("project_status_change")
    );
    mocks.createRail.mockResolvedValue({
      attempted: 2,
      errors: 0,
      createdRecipientIds: [],
    });
    mocks.sendPush.mockResolvedValue({
      ok: false,
      error: "provider unavailable",
      status: 503,
    });

    const result = await dispatchNotificationEvent({
      db: {} as never,
      actor,
      request: {
        eventType: "project_status_change",
        projectId,
        projectStatusEventId: statusEventId,
      },
    });

    expect(mocks.sendPush).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      status: 500,
      reason: "Notification push failed",
    });
  });
});
