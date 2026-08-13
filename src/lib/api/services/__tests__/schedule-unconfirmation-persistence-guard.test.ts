import { describe, expect, it } from "vitest";

import {
  isCurrentScheduleUnconfirmationPersistenceGuard,
  mintScheduleUnconfirmationPersistenceGuard,
} from "../schedule-unconfirmation-persistence-guard";

describe("schedule unconfirmation persistence guard", () => {
  it("binds the lease, task, company, actor, version, and prior confirmation nominally", () => {
    const guard = mintScheduleUnconfirmationPersistenceGuard({
      eventId: "33333333-3333-4333-8333-333333333333",
      leaseToken: "44444444-4444-4444-8444-444444444444",
      taskId: "11111111-1111-4111-8111-111111111111",
      companyId: "55555555-5555-4555-8555-555555555555",
      actorUserId: "22222222-2222-4222-8222-222222222222",
      scheduleVersion: 0,
      previousConfirmedAt: "2026-08-12T20:00:00.000Z",
      unconfirmationOrigin: "schedule_edit",
    });

    expect(isCurrentScheduleUnconfirmationPersistenceGuard(guard)).toBe(true);
    expect(guard.scheduleVersion).toBe(0);
    expect(guard.unconfirmationOrigin).toBe("schedule_edit");
    expect(Object.isFrozen(guard)).toBe(true);
    expect(isCurrentScheduleUnconfirmationPersistenceGuard({ ...guard })).toBe(
      false
    );
  });
});
