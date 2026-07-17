/**
 * Integration tests for schedule mutations crossing the durable server boundary.
 *
 * The mutation under test is `useUpdateTask` (TanStack hook in
 * `src/lib/hooks/use-tasks.ts`). Client hooks never dispatch task
 * notifications. The authenticated task API commits the write and durable
 * schedule outbox row atomically, and the server worker owns follow-up.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  updateTask: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/api/services/lifecycle-mutation-service", () => ({
  LifecycleMutationService: {
    updateTask: mocks.updateTask,
  },
}));

vi.mock("@/lib/api/services/inventory-deduction-service", () => ({
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
  mocks.updateTask.mockClear();
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

describe("useUpdateTask — durable schedule mutation boundary", () => {
  it("routes a time change through the authenticated server mutation", async () => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
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

    expect(mocks.updateTask).toHaveBeenCalledWith("task-1", {
      startTime: "09:30:00",
      allDay: false,
    });
  });

  it("routes a title-only change through the same server mutation", async () => {
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

    expect(mocks.updateTask).toHaveBeenCalledWith("task-1", {
      customTitle: "Mow side lawn",
    });
  });

  it("sends crew and schedule changes as one atomic patch", async () => {
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

    expect(mocks.updateTask).toHaveBeenCalledWith("task-1", {
      teamMemberIds: ["u-1", "u-3"],
      startTime: "10:00:00",
      allDay: false,
    });
  });

  it("routes an all-day toggle through the authenticated server mutation", async () => {
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

    expect(mocks.updateTask).toHaveBeenCalledWith("task-1", {
      allDay: false,
    });
  });
});
