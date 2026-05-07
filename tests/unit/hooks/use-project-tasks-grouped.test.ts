/**
 * useProjectTasksGrouped — workspace TASKS rail.
 *
 * Reads project_tasks for a project, joins task_types for the colored chip,
 * and partitions into { done, active, upcoming } based on status + scheduling.
 *
 * Real schema status values: 'completed' | 'active' | 'cancelled'
 *   (verified against the live DB; plan's 'Complete' / 'InProgress' were
 *   illustrative guesses).
 *
 * Grouping rules:
 *   - completed                                              → done
 *   - cancelled                                              → omitted
 *   - active AND start_date <= today AND
 *       (end_date IS NULL OR end_date >= today)              → active
 *   - active AND otherwise                                    → upcoming
 *
 * totals = { done: |done|, total: |done| + |active| + |upcoming| }
 *   — cancelled tasks do not count toward total.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Local-date helpers — tests must compose date strings relative to "today" so
// the ledger grouping logic (which reads `new Date()` via the hook) sees the
// same calendar boundary the data was crafted against. Using vi.useFakeTimers
// here would freeze the timers TanStack Query needs to resolve.
const TODAY = new Date();
const TOMORROW = new Date(TODAY);
TOMORROW.setDate(TODAY.getDate() + 1);
const YESTERDAY = new Date(TODAY);
YESTERDAY.setDate(TODAY.getDate() - 1);
const NEXT_WEEK = new Date(TODAY);
NEXT_WEEK.setDate(TODAY.getDate() + 7);
const LAST_WEEK = new Date(TODAY);
LAST_WEEK.setDate(TODAY.getDate() - 7);

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const ISO_TODAY = isoDate(TODAY);
const ISO_YESTERDAY = isoDate(YESTERDAY);
const ISO_TOMORROW = isoDate(TOMORROW);
const ISO_NEXT_WEEK = isoDate(NEXT_WEEK);
const ISO_LAST_WEEK = isoDate(LAST_WEEK);

interface TaskRow {
  id: string;
  custom_title: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  task_type_id: string | null;
  task_color: string | null;
  team_member_ids: string[] | null;
  display_order: number | null;
  task_types: { id: string; display: string; color: string; icon: string | null } | null;
}

let tasks: TaskRow[] = [];

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({
    from: (table: string) => {
      if (table === "project_tasks") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                order: () => Promise.resolve({ data: tasks, error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

import { useProjectTasksGrouped } from "@/lib/hooks/use-project-tasks-grouped";

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  tasks = [];
});

describe("useProjectTasksGrouped", () => {
  it("partitions completed / active-today / upcoming and excludes cancelled", async () => {
    tasks = [
      // completed
      {
        id: "t-done",
        custom_title: "Demo",
        status: "completed",
        start_date: ISO_LAST_WEEK,
        end_date: ISO_LAST_WEEK,
        task_type_id: "tt-1",
        task_color: null,
        team_member_ids: ["u-1"],
        display_order: 1,
        task_types: { id: "tt-1", display: "Demolition", color: "#9DB582", icon: null },
      },
      // active today (start <= today <= end)
      {
        id: "t-active",
        custom_title: null,
        status: "active",
        start_date: ISO_YESTERDAY,
        end_date: ISO_TOMORROW,
        task_type_id: "tt-2",
        task_color: null,
        team_member_ids: ["u-2"],
        display_order: 2,
        task_types: { id: "tt-2", display: "Sealing", color: "#C4A868", icon: "shield" },
      },
      // upcoming (start > today)
      {
        id: "t-future",
        custom_title: "Final inspection",
        status: "active",
        start_date: ISO_NEXT_WEEK,
        end_date: ISO_NEXT_WEEK,
        task_type_id: "tt-3",
        task_color: null,
        team_member_ids: [],
        display_order: 3,
        task_types: { id: "tt-3", display: "Inspection", color: "#6F94B0", icon: null },
      },
      // cancelled — excluded
      {
        id: "t-cancelled",
        custom_title: "Detour",
        status: "cancelled",
        start_date: ISO_YESTERDAY,
        end_date: ISO_TOMORROW,
        task_type_id: "tt-1",
        task_color: null,
        team_member_ids: [],
        display_order: 4,
        task_types: { id: "tt-1", display: "Demolition", color: "#9DB582", icon: null },
      },
    ];

    const { result } = renderHook(() => useProjectTasksGrouped("proj-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const data = result.current.data!;
    expect(data.done.map((t) => t.id)).toEqual(["t-done"]);
    expect(data.active.map((t) => t.id)).toEqual(["t-active"]);
    expect(data.upcoming.map((t) => t.id)).toEqual(["t-future"]);
    expect(data.totals).toEqual({ done: 1, total: 3 });
  });

  it("treats null end_date as open-ended (active if start <= today)", async () => {
    tasks = [
      {
        id: "t-open",
        custom_title: "Continuous monitoring",
        status: "active",
        start_date: ISO_LAST_WEEK,
        end_date: null,
        task_type_id: null,
        task_color: "#9DB582",
        team_member_ids: [],
        display_order: 1,
        task_types: null,
      },
    ];

    const { result } = renderHook(() => useProjectTasksGrouped("proj-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.active.map((t) => t.id)).toEqual(["t-open"]);
  });

  it("treats null start_date as not-yet-scheduled (upcoming)", async () => {
    tasks = [
      {
        id: "t-unscheduled",
        custom_title: "TBD",
        status: "active",
        start_date: null,
        end_date: null,
        task_type_id: null,
        task_color: null,
        team_member_ids: [],
        display_order: 1,
        task_types: null,
      },
    ];

    const { result } = renderHook(() => useProjectTasksGrouped("proj-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.upcoming.map((t) => t.id)).toEqual(["t-unscheduled"]);
  });

  it("exposes the resolved chip (color from task_types, falling back to task_color)", async () => {
    tasks = [
      {
        id: "t-typed",
        custom_title: null,
        status: "active",
        start_date: ISO_NEXT_WEEK,
        end_date: ISO_NEXT_WEEK,
        task_type_id: "tt-1",
        task_color: null,
        team_member_ids: [],
        display_order: 1,
        task_types: { id: "tt-1", display: "Sealing", color: "#C4A868", icon: "shield" },
      },
      {
        id: "t-untyped",
        custom_title: "Custom labor",
        status: "active",
        start_date: ISO_NEXT_WEEK,
        end_date: ISO_NEXT_WEEK,
        task_type_id: null,
        task_color: "#6F94B0",
        team_member_ids: [],
        display_order: 2,
        task_types: null,
      },
    ];

    const { result } = renderHook(() => useProjectTasksGrouped("proj-1"), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const byId = new Map(result.current.data!.upcoming.map((t) => [t.id, t]));
    expect(byId.get("t-typed")!.chipColor).toBe("#C4A868");
    expect(byId.get("t-typed")!.chipLabel).toBe("Sealing");
    expect(byId.get("t-untyped")!.chipColor).toBe("#6F94B0");
    expect(byId.get("t-untyped")!.chipLabel).toBe("Custom labor");
  });

  it("does not fetch when projectId is null", async () => {
    const { result } = renderHook(() => useProjectTasksGrouped(null), {
      wrapper: makeWrapper(),
    });
    expect(result.current.isFetching).toBe(false);
  });
});
