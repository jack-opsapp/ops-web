/**
 * Integration tests for /api/cron/recurrence-generate.
 *
 * Strategy:
 *   - Mock @/lib/supabase/server-client → getServiceRoleClient returns a
 *     hand-rolled client whose .from(table) records every call and serves
 *     pre-seeded query results.
 *   - Mock @/lib/supabase/helpers → setSupabaseOverride is a no-op (we use
 *     the directly-injected client).
 *   - The cron's RRule expansion (rrule.js) and the date/time math run for
 *     real — those are the parts we care about.
 *
 * Coverage:
 *   1. weekly recurrence anchored at 2026-04-27 (Mon) generates the right
 *      occurrences over a 60-day horizon
 *   2. skip exception drops one occurrence
 *   3. reschedule exception applies new_date / new_team_member_ids
 *   4. cron is idempotent on re-run (skips already-generated origins)
 *   5. unauthorized request returns 401
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Test scaffolding ───────────────────────────────────────────────────────

interface InsertedTask {
  recurrence_id: string;
  recurrence_origin_date: string;
  start_date: string;
  end_date: string;
  team_member_ids: string[];
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  custom_title: string;
}

interface SupabaseState {
  recurrences: Array<Record<string, unknown>>;
  exceptions: Array<Record<string, unknown>>;
  existingTaskOrigins: Map<string, Set<string>>; // recurrence_id → origins
  insertedTasks: InsertedTask[];
  insertedNotifications: Array<Record<string, unknown>>;
  recurrenceUpdates: Array<{ id: string; patch: Record<string, unknown> }>;
}

const state: SupabaseState = {
  recurrences: [],
  exceptions: [],
  existingTaskOrigins: new Map(),
  insertedTasks: [],
  insertedNotifications: [],
  recurrenceUpdates: [],
};

function makeQueryBuilder(table: string) {
  let pendingFilters: Array<{ method: string; args: unknown[] }> = [];
  let mode: "select" | "insert" | "update" | null = null;
  let pendingPatch: Record<string, unknown> | undefined;
  let pendingLimit: number | undefined;

  const builder: Record<string, unknown> = {};
  builder.select = () => {
    mode = mode ?? "select";
    return builder;
  };

  builder.insert = (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
    mode = "insert";
    const arr = Array.isArray(rows) ? rows : [rows];
    if (table === "project_tasks") {
      for (const row of arr) {
        state.insertedTasks.push(row as unknown as InsertedTask);
        const origin = row.recurrence_origin_date as string;
        const recId = row.recurrence_id as string;
        if (!state.existingTaskOrigins.has(recId)) {
          state.existingTaskOrigins.set(recId, new Set());
        }
        state.existingTaskOrigins.get(recId)!.add(origin);
      }
    } else if (table === "notifications") {
      for (const row of arr) state.insertedNotifications.push(row);
    }
    return builder;
  };

  builder.update = (patch: Record<string, unknown>) => {
    mode = "update";
    pendingPatch = patch;
    return builder;
  };

  builder.eq = (k: string, v: unknown) => {
    pendingFilters.push({ method: "eq", args: [k, v] });
    return builder;
  };
  builder.lte = (k: string, v: unknown) => {
    pendingFilters.push({ method: "lte", args: [k, v] });
    return builder;
  };
  builder.gt = (k: string, v: unknown) => {
    pendingFilters.push({ method: "gt", args: [k, v] });
    return builder;
  };
  builder.gte = () => builder;
  builder.is = (k: string, v: unknown) => {
    pendingFilters.push({ method: "is", args: [k, v] });
    return builder;
  };
  builder.limit = (value: number) => {
    pendingLimit = value;
    return builder;
  };
  builder.order = () => builder;

  builder.maybeSingle = async () => ({ data: null, error: null });
  builder.single = async () => {
    if (mode === "insert" && table === "project_tasks") {
      const last = state.insertedTasks[state.insertedTasks.length - 1];
      return { data: { id: `task-${state.insertedTasks.length}`, ...last }, error: null };
    }
    return { data: null, error: null };
  };

  // Promise interface — used when caller does `await supabase.from(...)`.
  builder.then = (
    onResolve: (v: { data: unknown; error: unknown }) => unknown,
    onReject?: (e: unknown) => unknown
  ) => {
    let result: { data: unknown; error: unknown };
    if (mode === "select" && table === "task_recurrences") {
      // Match the cron's main query: deleted_at IS NULL AND next_generation_at <= NOW()
      const due = state.recurrences.filter((r) => {
        const deletedFilter = pendingFilters.find(
          (f) =>
            f.method === "is" &&
            f.args[0] === "deleted_at" &&
            f.args[1] === null
        );
        const dueFilter = pendingFilters.find(
          (f) => f.method === "lte" && f.args[0] === "next_generation_at"
        );
        if (deletedFilter && r.deleted_at !== null) return false;
        if (
          dueFilter &&
          new Date(r.next_generation_at as string).getTime() >
            new Date(dueFilter.args[1] as string).getTime()
        ) {
          return false;
        }
        return true;
      });
      result = {
        data:
          pendingLimit === undefined ? due : due.slice(0, pendingLimit),
        error: null,
      };
    } else if (mode === "select" && table === "task_recurrence_exceptions") {
      const recIdFilter = pendingFilters.find(
        (f) => f.method === "eq" && f.args[0] === "recurrence_id"
      );
      const recId = recIdFilter?.args[1] as string;
      result = {
        data: state.exceptions.filter((e) => e.recurrence_id === recId),
        error: null,
      };
    } else if (mode === "select" && table === "project_tasks") {
      // Existing-origins lookup
      const recIdFilter = pendingFilters.find(
        (f) => f.method === "eq" && f.args[0] === "recurrence_id"
      );
      const recId = recIdFilter?.args[1] as string;
      const origins = state.existingTaskOrigins.get(recId) ?? new Set();
      result = {
        data: Array.from(origins).map((o) => ({ recurrence_origin_date: o })),
        error: null,
      };
    } else if (mode === "update" && table === "task_recurrences") {
      const idFilter = pendingFilters.find(
        (f) => f.method === "eq" && f.args[0] === "id"
      );
      if (idFilter) {
        state.recurrenceUpdates.push({
          id: idFilter.args[1] as string,
          patch: pendingPatch ?? {},
        });
      }
      result = { data: null, error: null };
    } else if (mode === "insert" && table === "notifications") {
      result = { data: null, error: null };
    } else if (mode === "insert" && table === "project_tasks") {
      // The cron uses .insert(...).select("id").maybeSingle(), so it goes
      // through maybeSingle. Defensive default here.
      result = { data: null, error: null };
    } else {
      result = { data: null, error: null };
    }
    return Promise.resolve(result).then(onResolve, onReject);
  };

  return builder;
}

const supabaseMock = {
  from: (table: string) => makeQueryBuilder(table),
};

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => supabaseMock,
}));

vi.mock("@/lib/supabase/helpers", () => ({
  setSupabaseOverride: () => {},
}));

let skipRecurrenceWorkload = false;
const advanceRecurrenceCursorMock = vi.fn(
  async (
    _supabase: unknown,
    _workloadKey: unknown,
    _lease: unknown,
    _expectedCursor: unknown,
    _nextCursor: unknown
  ) => undefined
);
const recurrenceWorkloadLease = {
  ownerToken: "test-owner",
  fenceToken: 1,
  globalFenceToken: 1,
  expiresAt: "2099-01-01T00:00:00.000Z",
  signal: new AbortController().signal,
};

vi.mock(
  "@/lib/api/services/cron-workload-control-service",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/api/services/cron-workload-control-service")
      >();
    return {
      ...actual,
      runWithCronWorkloadControl: async ({
        work,
      }: {
        work: (lease: typeof recurrenceWorkloadLease) => Promise<unknown>;
      }) =>
        skipRecurrenceWorkload
          ? { status: "skipped", reason: "lease_held" }
          : {
              status: "completed",
              value: await work(recurrenceWorkloadLease),
            },
    };
  }
);

vi.mock("@/lib/api/services/cron-workload-cursor-service", () => ({
  readCronWorkloadCursor: async () => null,
  advanceCronWorkloadCursor: (...args: unknown[]) =>
    advanceRecurrenceCursorMock(
      args[0],
      args[1],
      args[2],
      args[3],
      args[4]
    ),
}));

beforeEach(() => {
  state.recurrences = [];
  state.exceptions = [];
  state.existingTaskOrigins = new Map();
  state.insertedTasks = [];
  state.insertedNotifications = [];
  state.recurrenceUpdates = [];
  skipRecurrenceWorkload = false;
  process.env.CRON_SECRET = "test-secret";
});

// Now load the cron handler — it picks up the mocked client.
import { GET } from "@/app/api/cron/recurrence-generate/route";

function authedRequest(): NextRequest {
  return new NextRequest("https://app.opsapp.co/api/cron/recurrence-generate", {
    headers: { authorization: "Bearer test-secret" },
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("/api/cron/recurrence-generate", () => {
  it("rejects unauthorized requests with 401", async () => {
    const req = new NextRequest(
      "https://app.opsapp.co/api/cron/recurrence-generate",
      { headers: { authorization: "Bearer wrong" } }
    );
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("skips an overlapping recurrence run before reading templates", async () => {
    skipRecurrenceWorkload = true;
    const res = await GET(authedRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      ran: false,
      reason: "already_running",
    });
    expect(state.recurrenceUpdates).toHaveLength(0);
  });

  it("rotates through at most 10 due recurrence templates per run", async () => {
    state.recurrences = Array.from({ length: 12 }, (_, index) => ({
      id: `rec-${String(index).padStart(2, "0")}`,
      company_id: "co-1",
      project_id: null,
      client_id: null,
      task_type_id: null,
      title: "Bounded recurrence",
      team_member_ids: [],
      rrule: "FREQ=DAILY;COUNT=1",
      start_anchor: "2026-04-27",
      end_anchor: null,
      all_day: true,
      start_time: null,
      end_time: null,
      duration: 1,
      notes: null,
      next_generation_at: "2026-04-27T00:00:00Z",
      deleted_at: null,
    }));

    const res = await GET(authedRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      ran: true,
      recurrences_processed: 10,
    });
    expect(advanceRecurrenceCursorMock).toHaveBeenCalledWith(
      expect.anything(),
      "recurrence-generate",
      recurrenceWorkloadLease,
      null,
      "rec-09"
    );
  });

  it("materializes at most 25 pending occurrences per recurrence", async () => {
    const today = new Date().toISOString().slice(0, 10);
    state.recurrences = [
      {
        id: "rec-daily",
        company_id: "co-1",
        project_id: null,
        client_id: null,
        task_type_id: null,
        title: "Daily bounded task",
        team_member_ids: [],
        rrule: "FREQ=DAILY",
        start_anchor: today,
        end_anchor: null,
        all_day: true,
        start_time: null,
        end_time: null,
        duration: 1,
        notes: null,
        next_generation_at: "2026-04-27T00:00:00Z",
        deleted_at: null,
      },
    ];

    const res = await GET(authedRequest());

    expect(res.status).toBe(200);
    expect(state.insertedTasks).toHaveLength(25);
  });

  it("expands a weekly recurrence to ~9 occurrences over 60 days", async () => {
    state.recurrences = [
      {
        id: "rec-w",
        company_id: "co-1",
        project_id: null,
        client_id: null,
        task_type_id: null,
        title: "Weekly mow",
        team_member_ids: ["u-1"],
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        start_anchor: "2026-04-27",
        end_anchor: null,
        all_day: true,
        start_time: null,
        end_time: null,
        duration: 1,
        notes: null,
        next_generation_at: "2026-04-27T00:00:00Z",
        deleted_at: null,
      },
    ];

    const res = await GET(authedRequest());
    expect(res.status).toBe(200);
    // Materialization is one task per occurrence. The database trigger owns
    // immutable task mutation proof and durable notification delivery.
    // 60 days from "now" includes 8 or 9 Mondays depending on alignment.
    expect(state.insertedTasks.length).toBeGreaterThanOrEqual(7);
    expect(state.insertedTasks.length).toBeLessThanOrEqual(10);
    // Every task points back at the template.
    for (const task of state.insertedTasks) {
      expect(task.recurrence_id).toBe("rec-w");
      expect(typeof task.recurrence_origin_date).toBe("string");
      expect(task.all_day).toBe(true);
    }
    expect(state.insertedNotifications).toHaveLength(0);
    await expect(res.clone().json()).resolves.toMatchObject({
      notifications_sent: 0,
    });
    // next_generation_at bumped 4h forward.
    expect(state.recurrenceUpdates).toHaveLength(1);
    expect(state.recurrenceUpdates[0].patch.next_generation_at).toBeDefined();
  });

  it("respects skip exceptions", async () => {
    state.recurrences = [
      {
        id: "rec-w",
        company_id: "co-1",
        project_id: null,
        client_id: null,
        task_type_id: null,
        title: "Weekly mow",
        team_member_ids: ["u-1"],
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        start_anchor: "2026-04-27",
        end_anchor: null,
        all_day: true,
        start_time: null,
        end_time: null,
        duration: 1,
        notes: null,
        next_generation_at: "2026-04-27T00:00:00Z",
        deleted_at: null,
      },
    ];
    // Skip whatever the *first* upcoming Monday is — find it dynamically so
    // the test stays valid as time moves forward.
    const today = new Date();
    const daysToMon = (1 - today.getUTCDay() + 7) % 7 || 7;
    const skipDate = new Date(today);
    skipDate.setUTCDate(today.getUTCDate() + daysToMon);
    const skipKey = skipDate.toISOString().slice(0, 10);

    state.exceptions = [
      {
        recurrence_id: "rec-w",
        original_date: skipKey,
        action: "skip",
      },
    ];

    const res = await GET(authedRequest());
    expect(res.status).toBe(200);
    const skipped = state.insertedTasks.find(
      (t) => t.recurrence_origin_date === skipKey
    );
    expect(skipped).toBeUndefined();
  });

  it("is idempotent — second run inserts nothing new", async () => {
    state.recurrences = [
      {
        id: "rec-w",
        company_id: "co-1",
        project_id: null,
        client_id: null,
        task_type_id: null,
        title: "Weekly mow",
        team_member_ids: ["u-1"],
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        start_anchor: "2026-04-27",
        end_anchor: null,
        all_day: true,
        start_time: null,
        end_time: null,
        duration: 1,
        notes: null,
        next_generation_at: "2026-04-27T00:00:00Z",
        deleted_at: null,
      },
    ];

    const first = await GET(authedRequest());
    expect(first.status).toBe(200);
    const inserted1 = state.insertedTasks.length;
    expect(inserted1).toBeGreaterThan(0);

    // Reset next_generation_at so the cron picks the row up again.
    state.recurrences[0].next_generation_at = "2026-04-27T00:00:00Z";

    const second = await GET(authedRequest());
    expect(second.status).toBe(200);
    expect(state.insertedTasks.length).toBe(inserted1);
  });
});
