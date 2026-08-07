import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSupabase: vi.fn(),
  proposeAction: vi.fn(),
  suggestAssignment: vi.fn(),
  findScheduleGap: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: mocks.requireSupabase,
  parseDate: (value: unknown) => (value ? new Date(value as string) : null),
}));

vi.mock("@/lib/api/services/company-managers", () => ({
  getCompanyManagerUserIds: async () => ["admin-1"],
}));

vi.mock("@/lib/api/services/approval-queue-service", () => ({
  ApprovalQueueService: {
    proposeAction: mocks.proposeAction,
  },
}));

vi.mock("@/lib/api/services/assignment-service", () => ({
  AssignmentService: {
    suggestAssignment: mocks.suggestAssignment,
    findScheduleGap: mocks.findScheduleGap,
  },
}));

import { ProjectLifecycleService } from "@/lib/api/services/project-lifecycle-service";

type QueryCall = {
  table: string;
  selected: string;
  filters: Array<[method: string, ...args: unknown[]]>;
};

function makeSupabase() {
  const calls: QueryCall[] = [];

  function resultFor(call: QueryCall) {
    if (call.table === "companies") {
      return { data: { lifecycle_settings: null }, error: null };
    }

    if (call.table === "project_tasks") {
      if (call.selected.includes("calendar_event_id")) {
        return {
          data: null,
          error: {
            code: "42703",
            message: "column project_tasks.calendar_event_id does not exist",
          },
        };
      }

      return {
        data: [
          {
            id: "task-1",
            custom_title: "Install flashing",
            project_id: "project-1",
            task_type_id: "task-type-1",
            team_member_ids: ["member-1"],
            status: "active",
            end_date: "2026-08-03T12:00:00.000Z",
          },
        ],
        error: null,
      };
    }

    if (call.table === "agent_actions") {
      return { data: [], error: null };
    }

    if (call.table === "projects") {
      return {
        data: [{ id: "project-1", title: "Royal Bay" }],
        error: null,
      };
    }

    if (call.table === "users") {
      return {
        data: [{ id: "member-1", first_name: "Morgan", last_name: "Lee" }],
        error: null,
      };
    }

    return { data: [], error: null };
  }

  function from(table: string) {
    const call: QueryCall = { table, selected: "", filters: [] };
    calls.push(call);
    const builder: Record<string, unknown> = {
      select(columns: string) {
        call.selected = columns;
        return builder;
      },
      eq(...args: unknown[]) {
        call.filters.push(["eq", ...args]);
        return builder;
      },
      not(...args: unknown[]) {
        call.filters.push(["not", ...args]);
        return builder;
      },
      is(...args: unknown[]) {
        call.filters.push(["is", ...args]);
        return builder;
      },
      lt(...args: unknown[]) {
        call.filters.push(["lt", ...args]);
        return builder;
      },
      in(...args: unknown[]) {
        call.filters.push(["in", ...args]);
        return builder;
      },
      order(...args: unknown[]) {
        call.filters.push(["order", ...args]);
        return builder;
      },
      limit(...args: unknown[]) {
        call.filters.push(["limit", ...args]);
        return builder;
      },
      single: async () => resultFor(call),
      then: (resolve: (value: ReturnType<typeof resultFor>) => unknown) =>
        Promise.resolve(resultFor(call)).then(resolve),
    };
    return builder;
  }

  return { client: { from }, calls };
}

describe("ProjectLifecycleService.detectOverdueTasks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T12:00:00.000Z"));
    mocks.proposeAction.mockReset();
    mocks.proposeAction.mockResolvedValue("action-1");
    mocks.suggestAssignment.mockReset();
    mocks.suggestAssignment.mockResolvedValue([
      {
        userId: "member-2",
        name: "Alex Kim",
        reason: "Available next",
      },
    ]);
    mocks.findScheduleGap.mockReset();
    mocks.findScheduleGap.mockResolvedValue({
      startDate: new Date("2026-08-07T15:00:00.000Z"),
      endDate: new Date("2026-08-07T23:00:00.000Z"),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads overdue scheduling from project_tasks.end_date and proposes reassignment", async () => {
    const supabase = makeSupabase();
    mocks.requireSupabase.mockReturnValue(supabase.client);

    await expect(
      ProjectLifecycleService.detectOverdueTasks("company-1")
    ).resolves.toBe(1);

    const taskQuery = supabase.calls.find(
      (call) => call.table === "project_tasks"
    );
    expect(taskQuery).toMatchObject({
      selected:
        "id, custom_title, project_id, task_type_id, team_member_ids, status, end_date",
    });
    expect(taskQuery?.filters).toEqual(
      expect.arrayContaining([
        ["eq", "company_id", "company-1"],
        ["eq", "status", "active"],
        ["not", "end_date", "is", null],
        ["lt", "end_date", "2026-08-06T12:00:00.000Z"],
        ["is", "deleted_at", null],
      ])
    );
    expect(
      supabase.calls.some((call) => call.table === "calendar_events")
    ).toBe(false);
    expect(mocks.proposeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        userId: "admin-1",
        actionType: "reassign_task",
        sourceId: "task-1:reassign",
        actionData: expect.objectContaining({
          task_id: "task-1",
          overdue_days: 3,
          suggested_team_member_id: "member-2",
        }),
      })
    );
  });
});
