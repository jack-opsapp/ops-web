import { describe, expect, it } from "vitest";

import { parseScheduleConfirmationReceipt } from "../schedule-confirmation-receipt";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const VERSION = 7;

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    task_id: TASK_ID,
    newly_confirmed: true,
    confirmation_origin: "manual",
    schedule_confirmed_at: "2026-08-12T20:00:00.000Z",
    schedule_confirmed_by: ACTOR_ID,
    confirmed_schedule_version: VERSION,
    schedule_version: VERSION,
    ...overrides,
  };
}

describe("parseScheduleConfirmationReceipt", () => {
  const manual = {
    taskId: TASK_ID,
    scheduleVersion: VERSION,
    confirmationKind: "manual" as const,
    actorUserId: ACTOR_ID,
  };

  it("accepts an exact manual receipt bound to task, version, timestamp, and actor", () => {
    expect(parseScheduleConfirmationReceipt(receipt(), manual)).toEqual(
      receipt()
    );
  });

  it.each([
    {},
    receipt({ task_id: "33333333-3333-4333-8333-333333333333" }),
    receipt({ schedule_version: VERSION + 1 }),
    receipt({ confirmed_schedule_version: VERSION + 1 }),
    receipt({ schedule_confirmed_at: "not-a-timestamp" }),
    receipt({ schedule_confirmed_by: null }),
    receipt({ extra: true }),
  ])("rejects a malformed or unbound manual receipt", (value) => {
    expect(() => parseScheduleConfirmationReceipt(value, manual)).toThrow(
      "Invalid schedule confirmation receipt"
    );
  });

  it("requires a null confirmer for a newly automatic confirmation", () => {
    const automatic = { ...manual, confirmationKind: "automatic" as const };
    expect(
      parseScheduleConfirmationReceipt(
        receipt({
          confirmation_origin: "automatic_grace",
          schedule_confirmed_by: null,
        }),
        automatic
      ).schedule_confirmed_by
    ).toBeNull();
    expect(() =>
      parseScheduleConfirmationReceipt(
        receipt({ confirmation_origin: "automatic_grace" }),
        automatic
      )
    ).toThrow("Invalid schedule confirmation receipt");
  });

  it("rejects a confirmation origin that does not match its authority path", () => {
    expect(() =>
      parseScheduleConfirmationReceipt(
        receipt({ confirmation_origin: "automatic_grace" }),
        manual
      )
    ).toThrow("Invalid schedule confirmation receipt");
  });

  it("accepts an exact idempotent receipt without granting a new side effect", () => {
    expect(
      parseScheduleConfirmationReceipt(
        receipt({ newly_confirmed: false }),
        manual
      ).newly_confirmed
    ).toBe(false);
  });

  it("lets an authorized caller recover another admin's existing proof", () => {
    expect(
      parseScheduleConfirmationReceipt(
        receipt({
          newly_confirmed: false,
          schedule_confirmed_by: "33333333-3333-4333-8333-333333333333",
        }),
        manual
      ).newly_confirmed
    ).toBe(false);
  });
});
