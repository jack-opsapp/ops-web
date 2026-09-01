import { describe, expect, it } from "vitest";

import {
  isCurrentScheduleConfirmationPersistenceGuard,
  mintScheduleConfirmationPersistenceGuard,
} from "../schedule-confirmation-persistence-guard";

describe("schedule confirmation persistence guard", () => {
  it("accepts only the exact frozen object minted by the owner", () => {
    const guard = mintScheduleConfirmationPersistenceGuard({
      eventId: "33333333-3333-4333-8333-333333333333",
      leaseToken: "44444444-4444-4444-8444-444444444444",
      taskId: "11111111-1111-4111-8111-111111111111",
      scheduleVersion: 3,
      confirmedAt: "2026-08-12T20:00:00.000Z",
      confirmedBy: "22222222-2222-4222-8222-222222222222",
      confirmationOrigin: "manual",
    });
    expect(isCurrentScheduleConfirmationPersistenceGuard(guard)).toBe(true);
    expect(Object.isFrozen(guard)).toBe(true);
    expect(isCurrentScheduleConfirmationPersistenceGuard({ ...guard })).toBe(
      false
    );
  });
});
