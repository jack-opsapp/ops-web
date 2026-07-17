import { beforeEach, describe, expect, it, vi } from "vitest";

const TASK_ID = "44444444-4444-4444-8444-444444444444";
const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const TASK_TYPE_ID = "55555555-5555-4555-8555-555555555555";

const requireSupabaseMock = vi.fn();

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => requireSupabaseMock(),
  parseDate: (value: unknown) => (value ? new Date(String(value)) : null),
}));

import { TaskService } from "@/lib/api/services/task-service";

type QueryResult = { data: unknown; error: unknown };

function builder(
  result: QueryResult,
  inserted: Array<Record<string, unknown>>
) {
  const value: Record<string, ReturnType<typeof vi.fn>> = {};
  value.insert = vi.fn((row: Record<string, unknown>) => {
    inserted.push(row);
    return value;
  });
  for (const method of ["select", "eq", "is"]) {
    value[method] = vi.fn(() => value);
  }
  value.single = vi.fn(async () => result);
  value.maybeSingle = vi.fn(async () => result);
  return value;
}

function supabase(results: QueryResult[]) {
  const inserted: Array<Record<string, unknown>> = [];
  const builders = results.map((result) => builder(result, inserted));
  return {
    client: {
      from: vi.fn(() => {
        const next = builders.shift();
        if (!next) throw new Error("Unexpected database query");
        return next;
      }),
    },
    inserted,
  };
}

function input() {
  return {
    task: {
      id: TASK_ID,
      projectId: PROJECT_ID,
      companyId: COMPANY_ID,
      taskTypeId: TASK_TYPE_ID,
      customTitle: "Site visit",
    },
  };
}

beforeEach(() => requireSupabaseMock.mockReset());

describe("TaskService.createTaskWithEvent idempotency", () => {
  it("persists a caller id and reports a fresh insert", async () => {
    const fake = supabase([{ data: { id: TASK_ID }, error: null }]);
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(TaskService.createTaskWithEvent(input())).resolves.toEqual({
      taskId: TASK_ID,
      created: true,
    });
    expect(fake.inserted[0]).toMatchObject({
      id: TASK_ID,
      company_id: COMPANY_ID,
      project_id: PROJECT_ID,
      task_type_id: TASK_TYPE_ID,
      custom_title: "Site visit",
    });
  });

  it("returns the same task for a retry with the identical canonical payload", async () => {
    const fake = supabase([
      {
        data: null,
        error: { code: "23505", message: "duplicate key" },
      },
      {
        data: {
          id: TASK_ID,
          company_id: COMPANY_ID,
          project_id: PROJECT_ID,
          task_type_id: TASK_TYPE_ID,
          custom_title: "Site visit",
        },
        error: null,
      },
    ]);
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(TaskService.createTaskWithEvent(input())).resolves.toEqual({
      taskId: TASK_ID,
      created: false,
    });
  });

  it("fails closed when a duplicate id belongs to a different mutation", async () => {
    const fake = supabase([
      {
        data: null,
        error: { code: "23505", message: "duplicate key" },
      },
      {
        data: {
          id: TASK_ID,
          company_id: COMPANY_ID,
          project_id: PROJECT_ID,
          task_type_id: TASK_TYPE_ID,
          custom_title: "Different task",
        },
        error: null,
      },
    ]);
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(TaskService.createTaskWithEvent(input())).rejects.toThrow(
      "Task id conflict"
    );
  });
});
