/**
 * Unit tests for deriveTaskStatusKey()
 *
 * Production project_tasks.status only stores 'active' / 'completed' /
 * 'cancelled'. The TS enum's Booked/InProgress both round-trip to 'active'.
 * 'in_progress' and 'overdue' are derived from start/end dates against now.
 */

import { describe, it, expect } from "vitest";
import { deriveTaskStatusKey } from "@/lib/utils/calendar-utils";
import { TaskStatus, type ProjectTask } from "@/lib/types/models";

// Reference "now" used in every assertion below
const NOW = new Date("2026-04-27T12:00:00Z");

function makeTask(overrides: Partial<ProjectTask> = {}): Pick<
  ProjectTask,
  "status" | "startDate" | "endDate" | "duration"
> {
  return {
    status: TaskStatus.Booked,
    startDate: null,
    endDate: null,
    duration: 1,
    ...overrides,
  };
}

describe("deriveTaskStatusKey", () => {
  it("returns 'completed' when status is Completed (regardless of dates)", () => {
    const task = makeTask({
      status: TaskStatus.Completed,
      startDate: new Date("2026-04-30T00:00:00Z"), // future
      endDate: new Date("2026-05-01T00:00:00Z"),
    });
    expect(deriveTaskStatusKey(task, NOW)).toBe("completed");
  });

  it("returns 'cancelled' when status is Cancelled (regardless of dates)", () => {
    const task = makeTask({
      status: TaskStatus.Cancelled,
      startDate: new Date("2026-04-25T00:00:00Z"), // past
      endDate: new Date("2026-04-26T00:00:00Z"),
    });
    expect(deriveTaskStatusKey(task, NOW)).toBe("cancelled");
  });

  it("returns 'overdue' for active tasks whose end date is past", () => {
    const task = makeTask({
      status: TaskStatus.Booked, // serializes to 'active'
      startDate: new Date("2026-04-20T00:00:00Z"),
      endDate: new Date("2026-04-25T00:00:00Z"), // < NOW
    });
    expect(deriveTaskStatusKey(task, NOW)).toBe("overdue");
  });

  it("returns 'in_progress' for active tasks where now is between start and end", () => {
    const task = makeTask({
      status: TaskStatus.Booked,
      startDate: new Date("2026-04-26T00:00:00Z"),
      endDate: new Date("2026-04-28T00:00:00Z"),
    });
    expect(deriveTaskStatusKey(task, NOW)).toBe("in_progress");
  });

  it("returns 'scheduled' for active tasks in the future", () => {
    const task = makeTask({
      status: TaskStatus.Booked,
      startDate: new Date("2026-05-01T00:00:00Z"),
      endDate: new Date("2026-05-02T00:00:00Z"),
    });
    expect(deriveTaskStatusKey(task, NOW)).toBe("scheduled");
  });

  it("uses duration to compute end_date when end_date is missing", () => {
    const task = makeTask({
      status: TaskStatus.Booked,
      startDate: new Date("2026-04-25T00:00:00Z"),
      endDate: null,
      duration: 1, // implies end = start + 1 day = 2026-04-26 → still past NOW
    });
    expect(deriveTaskStatusKey(task, NOW)).toBe("overdue");
  });

  it("returns 'scheduled' when only start_date is set (no end, no duration)", () => {
    const task = makeTask({
      status: TaskStatus.Booked,
      startDate: new Date("2026-05-01T00:00:00Z"),
      endDate: null,
      duration: 0,
    });
    // No end derivable, no overdue or in_progress trigger → scheduled
    expect(deriveTaskStatusKey(task, NOW)).toBe("scheduled");
  });

  it("treats InProgress (TS enum) as active for status computation", () => {
    // InProgress also serializes to 'active' on write — same behavior as Booked
    const task = makeTask({
      status: TaskStatus.InProgress,
      startDate: new Date("2026-04-26T00:00:00Z"),
      endDate: new Date("2026-04-28T00:00:00Z"),
    });
    expect(deriveTaskStatusKey(task, NOW)).toBe("in_progress");
  });

  it("uses default `now = new Date()` when not provided", () => {
    // Smoke test — should not throw and should return a valid key
    const task = makeTask({ status: TaskStatus.Completed });
    expect(deriveTaskStatusKey(task)).toBe("completed");
  });
});
