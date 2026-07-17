/**
 * Integration tests for time-precision storage on project_tasks (Phase 3).
 *
 * Confirms:
 *   1. mapFromDb reads `all_day`, `start_time`, `end_time`, `recurrence_id`,
 *      `recurrence_origin_date` and rounds them into the ProjectTask shape.
 *   2. mapToDb writes those columns when present in the patch.
 *   3. Toggling allDay = false preserves user-entered HH:mm:ss strings
 *      round-trip.
 *   4. Pre-Phase-3 rows (allDay missing → null) default to true so legacy
 *      rows render as all-day.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// We don't need a real Supabase here — we test the boundary behavior of
// task-service mapping boundary. Reads go through TaskService; update patches
// use the same exported serializer consumed by the authenticated route.

interface MockState {
  lastInsertRow: Record<string, unknown> | null;
  lastUpdateRow: Record<string, unknown> | null;
  selectResult: { data: unknown; error: unknown };
}
const state: MockState = {
  lastInsertRow: null,
  lastUpdateRow: null,
  selectResult: { data: null, error: null },
};

function makeBuilder() {
  let pendingPatch: Record<string, unknown> | undefined;
  let mode: "select" | "insert" | "update" | null = null;
  const builder: Record<string, unknown> = {};
  builder.select = () => {
    mode = mode ?? "select";
    return builder;
  };
  builder.insert = (row: Record<string, unknown>) => {
    state.lastInsertRow = row;
    mode = "insert";
    return builder;
  };
  builder.update = (patch: Record<string, unknown>) => {
    state.lastUpdateRow = patch;
    pendingPatch = patch;
    mode = "update";
    return builder;
  };
  builder.eq = () => builder;
  builder.is = () => builder;
  builder.lte = () => builder;
  builder.gte = () => builder;
  builder.in = () => builder;
  builder.contains = () => builder;
  builder.not = () => builder;
  builder.range = () => builder;
  builder.order = () => builder;
  builder.limit = () => builder;
  builder.maybeSingle = async () => state.selectResult;
  builder.single = async () => state.selectResult;
  builder.then = (onResolve: (v: unknown) => unknown, onReject?: unknown) => {
    void pendingPatch;
    if (mode === "update") {
      return Promise.resolve({ data: null, error: null }).then(onResolve, onReject as never);
    }
    return Promise.resolve(state.selectResult).then(onResolve, onReject as never);
  };
  return builder;
}

const supabaseMock = {
  from: () => makeBuilder(),
};

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => supabaseMock,
  parseDate: (v: unknown) =>
    v instanceof Date ? v : v ? new Date(v as string) : null,
}));

import {
  serializeTaskPatch,
  TaskService,
} from "@/lib/api/services/task-service";
import { TaskStatus } from "@/lib/types/models";

beforeEach(() => {
  state.lastInsertRow = null;
  state.lastUpdateRow = null;
  state.selectResult = { data: null, error: null };
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("task-service Phase 3 time-precision mapping", () => {
  it("mapToDb: writes start_time, end_time, all_day, recurrence_id when present", async () => {
    state.selectResult = {
      data: { id: "task-1" },
      error: null,
    };
    await TaskService.createTask({
      projectId: "p-1",
      companyId: "co-1",
      taskTypeId: "tt-1",
      allDay: false,
      startTime: "08:30:00",
      endTime: "11:00:00",
      recurrenceId: "rec-1",
      recurrenceOriginDate: "2026-05-04",
    });
    const row = state.lastInsertRow!;
    expect(row.all_day).toBe(false);
    expect(row.start_time).toBe("08:30:00");
    expect(row.end_time).toBe("11:00:00");
    expect(row.recurrence_id).toBe("rec-1");
    expect(row.recurrence_origin_date).toBe("2026-05-04");
  });

  it("mapFromDb: reads all_day=null as true (legacy row default)", async () => {
    state.selectResult = {
      data: {
        id: "task-1",
        project_id: "p-1",
        company_id: "co-1",
        status: "active",
        task_color: "#000",
        task_type_id: "tt-1",
        custom_title: null,
        team_member_ids: [],
        // all_day intentionally omitted (legacy row)
        start_date: "2026-05-04T00:00:00Z",
        end_date: "2026-05-04T00:00:00Z",
        duration: 1,
        start_time: "08:00:00",
        end_time: "17:00:00",
      },
      error: null,
    };
    const task = await TaskService.fetchTask("task-1");
    expect(task.allDay).toBe(true);
    expect(task.startTime).toBe("08:00:00");
    expect(task.endTime).toBe("17:00:00");
  });

  it("mapFromDb: reads all_day=false when explicitly stored", async () => {
    state.selectResult = {
      data: {
        id: "task-1",
        project_id: "p-1",
        company_id: "co-1",
        status: "active",
        task_color: "#000",
        task_type_id: "tt-1",
        custom_title: null,
        team_member_ids: [],
        all_day: false,
        start_date: "2026-05-04T00:00:00Z",
        end_date: "2026-05-04T00:00:00Z",
        duration: 1,
        start_time: "09:30:00",
        end_time: "11:00:00",
      },
      error: null,
    };
    const task = await TaskService.fetchTask("task-1");
    expect(task.allDay).toBe(false);
    expect(task.startTime).toBe("09:30:00");
    expect(task.endTime).toBe("11:00:00");
  });

  it("mapFromDb: reads recurrence_id and recurrence_origin_date when populated", async () => {
    state.selectResult = {
      data: {
        id: "task-1",
        project_id: "p-1",
        company_id: "co-1",
        status: "active",
        task_color: "#000",
        task_type_id: "tt-1",
        custom_title: null,
        team_member_ids: [],
        all_day: true,
        recurrence_id: "rec-9",
        recurrence_origin_date: "2026-06-01",
      },
      error: null,
    };
    const task = await TaskService.fetchTask("task-1");
    expect(task.recurrenceId).toBe("rec-9");
    expect(task.recurrenceOriginDate).toBe("2026-06-01");
  });

  it("mapToDb (update): allDay toggle round-trips", async () => {
    const row = serializeTaskPatch({
      allDay: false,
      startTime: "08:30:00",
      endTime: "17:00:00",
    });
    expect(row.all_day).toBe(false);
    expect(row.start_time).toBe("08:30:00");
    expect(row.end_time).toBe("17:00:00");
  });

  // Reference: ensure status enum still maps correctly through the writes.
  it("status round-trip uses the existing 'active' shim", async () => {
    state.selectResult = { data: { id: "task-1" }, error: null };
    await TaskService.createTask({
      projectId: "p-1",
      companyId: "co-1",
      taskTypeId: "tt-1",
      status: TaskStatus.Booked,
    });
    const row = state.lastInsertRow!;
    expect(row.status).toBe("active");
  });
});
