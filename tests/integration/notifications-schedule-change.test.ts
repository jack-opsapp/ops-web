/**
 * Integration tests for schedule_change notification fan-out (Phase 3).
 *
 * The mutation under test is `useUpdateTask` (TanStack hook in
 * `src/lib/hooks/use-tasks.ts`). It calls `dispatchScheduleChange` whenever
 * any of (startDate, endDate, startTime, endTime, allDay) changes — and
 * uses the union of prior + new teamMemberIds as recipients so removed crew
 * also see the move.
 *
 * Strategy: stub TaskService.updateTask, the auth + permissions stores, and
 * the dispatchScheduleChange function. Mount the hook, fire mutateAsync,
 * inspect the captured dispatch calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mocks ──────────────────────────────────────────────────────────────────

interface DispatchCall {
  fn: "dispatchScheduleChange" | "dispatchTaskAssignment" | "dispatchTaskCompleted";
  params: Record<string, unknown>;
}
const dispatches: DispatchCall[] = [];

vi.mock("@/lib/api/services/notification-dispatch", () => ({
  dispatchScheduleChange: (params: Record<string, unknown>) => {
    dispatches.push({ fn: "dispatchScheduleChange", params });
  },
  dispatchTaskAssignment: (params: Record<string, unknown>) => {
    dispatches.push({ fn: "dispatchTaskAssignment", params });
  },
  dispatchTaskCompleted: (params: Record<string, unknown>) => {
    dispatches.push({ fn: "dispatchTaskCompleted", params });
  },
}));

vi.mock("@/lib/api/services", () => ({
  TaskService: {
    updateTask: vi.fn(() => Promise.resolve()),
  },
  InventoryDeductionService: {
    deductForTask: vi.fn(),
    reverseForTask: vi.fn(),
  },
}));

vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({
    company: { id: "co-1" },
    currentUser: { id: "u-1", firstName: "Jack", lastName: "Sweet" },
  }),
}));

vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: () => "all",
}));

import { useUpdateTask } from "@/lib/hooks/use-tasks";
import { TaskStatus } from "@/lib/types/models";
import type { ProjectTask } from "@/lib/types/models";
import { queryKeys } from "@/lib/api/query-client";

beforeEach(() => {
  dispatches.length = 0;
});

function makeTask(overrides: Partial<ProjectTask> = {}): ProjectTask {
  return {
    id: "task-1",
    projectId: "p-1",
    companyId: "co-1",
    status: TaskStatus.Booked,
    taskColor: "#000",
    taskNotes: null,
    taskTypeId: "tt-1",
    taskIndex: 0,
    displayOrder: 0,
    customTitle: "Mow lawn",
    sourceLineItemId: null,
    sourceEstimateId: null,
    teamMemberIds: ["u-1"],
    dependencyOverrides: null,
    startDate: new Date("2026-05-04T00:00:00Z"),
    endDate: new Date("2026-05-04T00:00:00Z"),
    duration: 1,
    startTime: null,
    endTime: null,
    allDay: true,
    recurrenceId: null,
    recurrenceOriginDate: null,
    inventoryDeducted: false,
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: null,
    ...overrides,
  };
}

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

function seedTaskInCache(qc: QueryClient, task: ProjectTask) {
  qc.setQueryData(queryKeys.tasks.detail(task.id), task);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("useUpdateTask — schedule_change notification fan-out", () => {
  it("fires dispatchScheduleChange when startTime changes", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const task = makeTask({ teamMemberIds: ["u-1", "u-2"] });
    seedTaskInCache(qc, task);

    const { result } = renderHook(() => useUpdateTask(), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({
        id: task.id,
        data: { startTime: "09:30:00", allDay: false },
      });
    });

    const call = dispatches.find((d) => d.fn === "dispatchScheduleChange");
    expect(call).toBeDefined();
    expect((call!.params.teamMemberIds as string[]).sort()).toEqual([
      "u-1",
      "u-2",
    ]);
  });

  it("does NOT fire when only customTitle changes", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const task = makeTask();
    seedTaskInCache(qc, task);

    const { result } = renderHook(() => useUpdateTask(), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({
        id: task.id,
        data: { customTitle: "Mow side lawn" },
      });
    });

    const call = dispatches.find((d) => d.fn === "dispatchScheduleChange");
    expect(call).toBeUndefined();
  });

  it("union recipients include removed crew members", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const task = makeTask({ teamMemberIds: ["u-1", "u-2"] });
    seedTaskInCache(qc, task);

    const { result } = renderHook(() => useUpdateTask(), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({
        id: task.id,
        data: {
          teamMemberIds: ["u-1", "u-3"], // remove u-2, add u-3
          startTime: "10:00:00",
          allDay: false,
        },
      });
    });

    const call = dispatches.find((d) => d.fn === "dispatchScheduleChange");
    expect(call).toBeDefined();
    const recipients = (call!.params.teamMemberIds as string[]).sort();
    expect(recipients).toEqual(["u-1", "u-2", "u-3"]);
  });

  it("fires when allDay toggles even with no other change", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const task = makeTask();
    seedTaskInCache(qc, task);

    const { result } = renderHook(() => useUpdateTask(), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({
        id: task.id,
        data: { allDay: false },
      });
    });

    const call = dispatches.find((d) => d.fn === "dispatchScheduleChange");
    expect(call).toBeDefined();
  });
});
