import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveCrewEvent: vi.fn(),
  resolvePreferences: vi.fn(),
  sendPush: vi.fn(),
}));

vi.mock("@/lib/notifications/crew-notification-event-resolver", () => ({
  resolveCrewNotificationEvent: (...args: unknown[]) =>
    mocks.resolveCrewEvent(...args),
}));

vi.mock("@/lib/notifications/server-notification-service", () => ({
  resolveNotificationPreferences: (...args: unknown[]) =>
    mocks.resolvePreferences(...args),
}));

vi.mock("@/lib/integrations/onesignal", () => ({
  sendOneSignalPush: (...args: unknown[]) => mocks.sendPush(...args),
}));

import { dispatchCrewNotificationEvent } from "@/lib/notifications/dispatch-crew-notification-event";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  name: "Operator One",
};
const taskId = "33333333-3333-4333-8333-333333333333";
const recipient = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveCrewEvent.mockResolvedValue({
    ok: true,
    notified: 1,
    events: [
      {
        companyId: actor.companyId,
        recipientUserIds: [recipient],
        preferenceKey: "schedule_changes",
        title: "Schedule Update",
        body: '"Framing" on South deck has been rescheduled',
        pushData: {
          type: "scheduleChange",
          taskId,
          projectId: "55555555-5555-4555-8555-555555555555",
          screen: "taskDetails",
        },
      },
    ],
  });
  mocks.resolvePreferences.mockResolvedValue({
    inAppRecipientIds: [recipient],
    pushRecipientIds: [recipient],
    emailRecipientIds: [],
  });
  mocks.sendPush.mockResolvedValue({ ok: true, recipients: 1 });
});

describe("authenticated crew notification dispatcher", () => {
  it("keeps the narrow-RPC rail result and suppresses only push during quiet hours", async () => {
    mocks.resolvePreferences.mockResolvedValue({
      inAppRecipientIds: [recipient],
      pushRecipientIds: [],
      emailRecipientIds: [],
    });

    const result = await dispatchCrewNotificationEvent({
      db: {} as never,
      actorDb: {} as never,
      actor,
      request: { eventType: "task_rescheduled", taskId },
    });

    expect(mocks.resolveCrewEvent).toHaveBeenCalledTimes(1);
    expect(mocks.resolvePreferences).toHaveBeenCalledWith({
      companyId: actor.companyId,
      recipientUserIds: [recipient],
      preferenceKey: "schedule_changes",
      db: expect.anything(),
    });
    expect(mocks.sendPush).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, notified: 1, pushed: 0, emailed: 0 });
  });

  it("sends canonical server copy only to recipients left by preferences", async () => {
    const result = await dispatchCrewNotificationEvent({
      db: {} as never,
      actorDb: {} as never,
      actor,
      request: { eventType: "task_rescheduled", taskId },
    });

    expect(mocks.sendPush).toHaveBeenCalledWith({
      recipientUserIds: [recipient],
      title: "Schedule Update",
      body: '"Framing" on South deck has been rescheduled',
      data: {
        type: "scheduleChange",
        taskId,
        projectId: "55555555-5555-4555-8555-555555555555",
        screen: "taskDetails",
      },
    });
    expect(result).toEqual({ ok: true, notified: 1, pushed: 1, emailed: 0 });
  });

  it("never sends a push when the authenticated narrow RPC created no rail row", async () => {
    mocks.resolveCrewEvent.mockResolvedValue({
      ok: true,
      notified: 0,
      events: [],
    });

    const result = await dispatchCrewNotificationEvent({
      db: {} as never,
      actorDb: {} as never,
      actor,
      request: { eventType: "task_rescheduled", taskId },
    });

    expect(mocks.resolvePreferences).not.toHaveBeenCalled();
    expect(mocks.sendPush).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, notified: 0, pushed: 0, emailed: 0 });
  });
});
