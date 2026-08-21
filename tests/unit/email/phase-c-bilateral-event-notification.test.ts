import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRail: vi.fn(),
  preferences: vi.fn(),
  sendPush: vi.fn(),
}));

vi.mock("@/lib/notifications/server-notification-service", () => ({
  createTrustedNotifications: (...args: unknown[]) => mocks.createRail(...args),
  resolveNotificationPreferences: (...args: unknown[]) =>
    mocks.preferences(...args),
}));

vi.mock("@/lib/integrations/onesignal", () => ({
  sendOneSignalPush: (...args: unknown[]) => mocks.sendPush(...args),
}));

import { dispatchPhaseCBilateralEventOutcomeNotification } from "@/lib/api/services/phase-c-bilateral-event-consumer-runtime";
import type { PhaseCBilateralEventOutcome } from "@/lib/email/phase-c-bilateral-event-consumer";

const outcome: PhaseCBilateralEventOutcome = {
  handoffId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  opportunityId: "33333333-3333-4333-8333-333333333333",
  requestedOwnerUserId: "44444444-4444-4444-8444-444444444444",
  status: "consumed",
  reviewReason: null,
  canonicalEventKind: "site_visit",
  canonicalEventId: "55555555-5555-4555-8555-555555555555",
  eventKind: "call",
  eventTitle: "Call — North deck",
  startsAt: "2026-08-27T21:00:00.000Z",
  eventTimezone: "America/Vancouver",
  location: "Microsoft Teams",
  leadTitle: "North deck",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.preferences.mockResolvedValue({
    inAppRecipientIds: [outcome.requestedOwnerUserId],
    pushRecipientIds: [outcome.requestedOwnerUserId],
    emailRecipientIds: [],
  });
  mocks.createRail.mockResolvedValue({
    attempted: 1,
    errors: 0,
    createdRecipientIds: [outcome.requestedOwnerUserId],
    createdNotifications: [],
  });
  mocks.sendPush.mockResolvedValue({ ok: true, recipients: 1 });
});

describe("Phase C bilateral appointment delivery", () => {
  it("preserves the durable rail while quiet hours suppress only push", async () => {
    mocks.preferences.mockResolvedValue({
      inAppRecipientIds: [outcome.requestedOwnerUserId],
      pushRecipientIds: [],
      emailRecipientIds: [],
    });

    const result = await dispatchPhaseCBilateralEventOutcomeNotification(
      outcome,
      {} as never
    );

    expect(mocks.createRail).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "phase_c_appointment_booked",
        recipientUserIds: [outcome.requestedOwnerUserId],
        durableDedupe: true,
      }),
      expect.anything()
    );
    expect(mocks.sendPush).not.toHaveBeenCalled();
    expect(result).toEqual({ notified: 1, pushed: 0 });
  });

  it("uses the immutable handoff as the provider idempotency identity", async () => {
    await dispatchPhaseCBilateralEventOutcomeNotification(outcome, {} as never);

    expect(mocks.sendPush).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserIds: [outcome.requestedOwnerUserId],
        idempotencyKey: outcome.handoffId,
        title: "Call booked",
      })
    );
  });

  it("fails closed so the terminal handoff remains retryable on provider outage", async () => {
    mocks.sendPush.mockResolvedValue({ ok: false, error: "provider down" });

    await expect(
      dispatchPhaseCBilateralEventOutcomeNotification(outcome, {} as never)
    ).rejects.toThrow("push provider unavailable");
  });
});
