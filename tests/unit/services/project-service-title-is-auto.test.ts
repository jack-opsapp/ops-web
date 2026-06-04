/**
 * ProjectService title_is_auto plumbing + create-form optional title.
 *
 * Auto-naming is DB-driven: the projects_autoname trigger fills `title` from
 * `address` while `title_is_auto = true`. The web side only needs to (a) carry
 * the `titleIsAuto` flag through mapToDb, and (b) allow a blank/absent title on
 * the create input (the BEFORE-INSERT trigger fills the NOT NULL column). These
 * tests assert the insert row carries the flag and the create schema no longer
 * requires a name, while the update schema is untouched.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const insertedRows: Array<Record<string, unknown>> = [];
const requireSupabaseMock = vi.fn();
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => requireSupabaseMock(),
  parseDate: (v: unknown) => (v ? new Date(v as string) : null),
}));

import { ProjectService } from "@/lib/api/services/project-service";
import { createProjectSchema, updateProjectSchema } from "@/lib/schemas";

function fakeSupabase() {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    insert: (row: Record<string, unknown>) => {
      insertedRows.push(row);
      return builder;
    },
    update: () => builder,
    select: () => builder,
    eq: () => builder,
    single: async () => ({ data: { id: "new-proj" }, error: null }),
  });
  return { from: () => builder };
}

beforeEach(() => {
  insertedRows.length = 0;
  requireSupabaseMock.mockReset();
  requireSupabaseMock.mockReturnValue(fakeSupabase());
});

describe("ProjectService.createProject — title_is_auto plumbing", () => {
  it("plumbs titleIsAuto:true → title_is_auto:true and omits a blank title", async () => {
    await ProjectService.createProject({
      companyId: "co-1",
      address: "1240 W 6th Ave",
      titleIsAuto: true,
    });

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].title_is_auto).toBe(true);
    // No title written → the DB trigger derives it from the address.
    expect(insertedRows[0].title).toBeUndefined();
  });

  it("plumbs titleIsAuto:false (hand-set) with the typed title", async () => {
    await ProjectService.createProject({
      companyId: "co-1",
      title: "Custom name",
      titleIsAuto: false,
    });

    expect(insertedRows[0].title_is_auto).toBe(false);
    expect(insertedRows[0].title).toBe("Custom name");
  });

  it("omits title_is_auto entirely on the legacy create path (flag not provided)", async () => {
    await ProjectService.createProject({ companyId: "co-1", title: "Plain" });
    expect("title_is_auto" in insertedRows[0]).toBe(false);
  });
});

describe("createProjectSchema — optional title (auto-naming)", () => {
  it("accepts an absent title", () => {
    const r = createProjectSchema.safeParse({
      companyId: "co-1",
      address: "1240 W 6th Ave",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a blank title", () => {
    const r = createProjectSchema.safeParse({ companyId: "co-1", title: "" });
    expect(r.success).toBe(true);
  });

  it("still rejects a title over 200 chars", () => {
    const r = createProjectSchema.safeParse({
      companyId: "co-1",
      title: "x".repeat(201),
    });
    expect(r.success).toBe(false);
  });
});

describe("updateProjectSchema — unchanged", () => {
  it("still rejects an empty title when one is provided (min 1)", () => {
    const r = updateProjectSchema.safeParse({ id: "p1", title: "" });
    expect(r.success).toBe(false);
  });

  it("accepts an omitted title", () => {
    const r = updateProjectSchema.safeParse({ id: "p1" });
    expect(r.success).toBe(true);
  });
});
