/**
 * Unit tests for the recurrence edit-scope router.
 *
 * `useRecurrenceEdit` is a TanStack mutation hook — testing the hook itself
 * needs React + a QueryClientProvider. We don't need that here: the routing
 * decisions live in three pure helpers (applyEditThis, applyEditThisAndFollowing,
 * applyEditAll) that the hook delegates to. We exercise those by importing the
 * top-level mutation logic and watching which Service methods get called for
 * each scope.
 *
 * Approach: mock RecurrenceService + TaskService at the module boundary, then
 * call the hook's mutationFn directly with a synthesized QueryClient. The hook
 * file is small and side-effect free at import time, so this pattern works
 * cleanly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";

// ─── Mock state ──────────────────────────────────────────────────────────────

const recurrenceCalls: Array<{ method: string; args: unknown[] }> = [];
const taskCalls: Array<{ method: string; args: unknown[] }> = [];
const supabaseUpdates: Array<{ table: string; patch: Record<string, unknown> }> =
  [];

const FAKE_TEMPLATE = {
  id: "rec-1",
  companyId: "co-1",
  projectId: "p-1",
  clientId: null,
  taskTypeId: "tt-1",
  title: "Mow lawn",
  teamMemberIds: ["u-1"],
  rrule: "FREQ=WEEKLY;BYDAY=MO",
  startAnchor: "2026-04-01",
  endAnchor: null,
  allDay: true,
  startTime: null,
  endTime: null,
  duration: 1,
  notes: null,
  nextGenerationAt: null,
  createdBy: null,
  createdAt: null,
  updatedAt: null,
  deletedAt: null,
};

vi.mock("@/lib/api/services", () => ({
  RecurrenceService: {
    getById: (id: string) => {
      recurrenceCalls.push({ method: "getById", args: [id] });
      return Promise.resolve(FAKE_TEMPLATE);
    },
    update: (id: string, patch: unknown) => {
      recurrenceCalls.push({ method: "update", args: [id, patch] });
      return Promise.resolve({ ...FAKE_TEMPLATE, ...(patch as object) });
    },
    create: (input: unknown) => {
      recurrenceCalls.push({ method: "create", args: [input] });
      return Promise.resolve({ ...FAKE_TEMPLATE, id: "rec-2" });
    },
    upsertException: (input: unknown) => {
      recurrenceCalls.push({ method: "upsertException", args: [input] });
      return Promise.resolve({ id: "ex-1" });
    },
  },
  TaskService: {
    updateTask: (id: string, patch: unknown) => {
      taskCalls.push({ method: "updateTask", args: [id, patch] });
      return Promise.resolve();
    },
  },
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        supabaseUpdates.push({ table: "project_tasks", patch });
        return {
          eq: () => ({
            gte: () => Promise.resolve({ error: null }),
          }),
        };
      },
    }),
  }),
}));

// Auth store stub — useAuthStore is read but not exercised by the mutationFn
// path we're testing. Provide a minimal mock.
vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({ company: { id: "co-1" }, currentUser: { id: "u-1" } }),
}));

import { useRecurrenceEdit } from "@/lib/hooks/use-recurrence-edit";
import type { ProjectTask } from "@/lib/types/models";

beforeEach(() => {
  recurrenceCalls.length = 0;
  taskCalls.length = 0;
  supabaseUpdates.length = 0;
});

// ─── Test harness — spin a hook and grab its mutate function ────────────────

import * as React from "react";
import { renderHook, act } from "@testing-library/react";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

function makeTask(overrides: Partial<ProjectTask> = {}): ProjectTask {
  return {
    id: "task-1",
    projectId: "p-1",
    companyId: "co-1",
    status: "Booked" as ProjectTask["status"],
    taskColor: "#000000",
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
    recurrenceId: "rec-1",
    recurrenceOriginDate: "2026-05-04",
    inventoryDeducted: false,
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: null,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("useRecurrenceEdit — scope routing", () => {
  it('scope="this" writes an exception AND patches the task', async () => {
    const { result } = renderHook(() => useRecurrenceEdit(), { wrapper });
    // Use noon local-time on a different date to avoid TZ rollover in
    // format() that would make newDateKey === task.recurrenceOriginDate.
    await act(async () => {
      await result.current.mutateAsync({
        task: makeTask(),
        scope: "this",
        patch: { startDate: new Date(2026, 4, 8, 12, 0) },
      });
    });
    const exceptionCall = recurrenceCalls.find(
      (c) => c.method === "upsertException"
    );
    expect(exceptionCall).toBeDefined();
    expect(taskCalls.find((c) => c.method === "updateTask")).toBeDefined();
  });

  it('scope="this" rejects scoping-field changes', async () => {
    const { result } = renderHook(() => useRecurrenceEdit(), { wrapper });
    await expect(
      act(async () => {
        await result.current.mutateAsync({
          task: makeTask(),
          scope: "this",
          patch: { taskTypeId: "tt-2" },
        });
      })
    ).rejects.toThrow(/Cannot edit "taskTypeId"/);
  });

  it('scope="all" patches the original template', async () => {
    const { result } = renderHook(() => useRecurrenceEdit(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        task: makeTask(),
        scope: "all",
        patch: { customTitle: "New title" },
      });
    });
    const update = recurrenceCalls.find(
      (c) => c.method === "update" && c.args[0] === "rec-1"
    );
    expect(update).toBeDefined();
    expect(update!.args[1]).toMatchObject({ title: "New title" });
  });

  it('scope="this_and_following" caps original, forks, and re-points future tasks', async () => {
    const { result } = renderHook(() => useRecurrenceEdit(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        task: makeTask(),
        scope: "this_and_following",
        patch: { customTitle: "Mow lawn (new)" },
      });
    });

    // Should call update on the original (cap end_anchor)…
    const cap = recurrenceCalls.find(
      (c) =>
        c.method === "update" &&
        c.args[0] === "rec-1" &&
        (c.args[1] as { endAnchor?: string }).endAnchor !== undefined
    );
    expect(cap).toBeDefined();

    // …and create a new template…
    const fork = recurrenceCalls.find((c) => c.method === "create");
    expect(fork).toBeDefined();

    // …and re-point future tasks via Supabase.
    expect(supabaseUpdates.length).toBeGreaterThan(0);
    const repoint = supabaseUpdates.find(
      (u) =>
        u.table === "project_tasks" &&
        (u.patch as { recurrence_id?: string }).recurrence_id === "rec-2"
    );
    expect(repoint).toBeDefined();
  });

  it("rejects when task has no recurrenceId", async () => {
    const { result } = renderHook(() => useRecurrenceEdit(), { wrapper });
    await expect(
      act(async () => {
        await result.current.mutateAsync({
          task: makeTask({ recurrenceId: null }),
          scope: "this",
          patch: {},
        });
      })
    ).rejects.toThrow(/no recurrenceId/);
  });
});
