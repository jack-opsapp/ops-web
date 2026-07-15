import { beforeEach, describe, expect, it, vi } from "vitest";

const insertedRows: Array<Record<string, unknown>> = [];
const updatedRows: Array<Record<string, unknown>> = [];
const requireSupabaseMock = vi.fn();

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => requireSupabaseMock(),
  parseDate: (value: unknown) => (value ? new Date(value as string) : null),
}));

import { ProjectService } from "@/lib/api/services/project-service";

function fakeSupabase() {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    insert: (row: Record<string, unknown>) => {
      insertedRows.push(row);
      return builder;
    },
    update: (row: Record<string, unknown>) => {
      updatedRows.push(row);
      return builder;
    },
    select: () => builder,
    eq: () => builder,
    single: async () => ({ data: { id: "project-1" }, error: null }),
    then: (resolve: (value: { error: null }) => unknown) =>
      Promise.resolve({ error: null }).then(resolve),
  });
  return { from: () => builder };
}

beforeEach(() => {
  insertedRows.length = 0;
  updatedRows.length = 0;
  requireSupabaseMock.mockReset();
  requireSupabaseMock.mockReturnValue(fakeSupabase());
});

describe("ProjectService opportunity link mirrors", () => {
  const opportunityId = "8ea42db5-2404-416f-9c39-62ad77eadf66";

  it("writes both project-side mirrors when createProject receives opportunityId", async () => {
    await ProjectService.createProject({
      companyId: "company-1",
      title: "Linked project",
      opportunityId,
    });

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      opportunity_id: opportunityId,
      opportunity_ref: opportunityId,
    });
  });

  it("writes both project-side mirrors when updateProject receives opportunityId", async () => {
    await ProjectService.updateProject("project-1", { opportunityId });

    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0]).toMatchObject({
      opportunity_id: opportunityId,
      opportunity_ref: opportunityId,
    });
  });
});
