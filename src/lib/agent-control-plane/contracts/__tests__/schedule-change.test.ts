import { describe, expect, it } from "vitest";
import { PrepareScheduleChangeInputSchema } from "../schedule-change";

const task = {
  task_id: "10000000-0000-4000-8000-000000000001",
  expected_updated_at: "2026-09-06T23:00:00.123456Z",
  expected_schedule_version: 4,
  destination_date: "2026-11-02",
  team_member_ids: ["20000000-0000-4000-8000-000000000001"],
};
const input = { tasks: [task], reason: "Move the listed work to Friday.", idempotency_key: "schedule-test-001" };
describe("exact schedule proposal input", () => {
  it("preserves the database concurrency timestamp without millisecond rounding", () => {
    expect(PrepareScheduleChangeInputSchema.parse(input).tasks[0].expected_updated_at).toBe(task.expected_updated_at);
  });
  it.each([
    { ...input, tasks: [] },
    { ...input, tasks: [task, task] },
    { ...input, tasks: [{ ...task, team_member_ids: [...task.team_member_ids, ...task.team_member_ids] }] },
    { ...input, tasks: [{ ...task, team_member_ids: [] }] },
    { ...input, tasks: [{ ...task, destination_date: "2026-02-30" }] },
    { ...input, tasks: [{ ...task, expected_schedule_version: 1.5 }] },
    { ...input, tasks: [{ ...task, status: "completed" }] },
    { ...input, send_customer_message: true },
    { ...input, query: "all Thursday jobs" },
  ])("rejects ambiguous targets or unapproved additional work %#", (candidate) => {
    expect(PrepareScheduleChangeInputSchema.safeParse(candidate).success).toBe(false);
  });
});
