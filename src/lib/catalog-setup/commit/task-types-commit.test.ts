import { describe, it, expect, vi } from "vitest";
import {
  planTaskTypeCommit,
  commitTaskTypes,
  recordCompanyTrade,
  DEFAULT_TASK_TYPE_COLOR,
} from "./task-types-commit";
import type { TypeFields } from "../staging-card";

const COMPANY = "co-1";

const tt = (over: Partial<TypeFields> = {}): TypeFields => ({
  display: "Inspection",
  ...over,
});
const trade = (slug: string): TypeFields => ({ display: slug, isTrade: true });

describe("planTaskTypeCommit", () => {
  it("inserts brand-new task types with company id + defaults", () => {
    const plan = planTaskTypeCommit([tt({ display: "Inspection" })], [], COMPANY);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({
      company_id: COMPANY,
      display: "Inspection",
      color: DEFAULT_TASK_TYPE_COLOR,
      is_default: false,
    });
    expect(plan.skipped).toBe(0);
    expect(plan.trade).toBeNull();
  });

  it("merges (skips) a task type that already exists, case/space-insensitively", () => {
    const plan = planTaskTypeCommit(
      [tt({ display: "  repair " })],
      ["Repair"],
      COMPANY,
    );
    expect(plan.inserts).toHaveLength(0);
    expect(plan.skipped).toBe(1);
  });

  it("never re-seeds a baseline default (read-merge contract)", () => {
    const plan = planTaskTypeCommit(
      [tt({ display: "Repair" }), tt({ display: "Install" }), tt({ display: "Service Call" })],
      ["Repair", "Install"],
      COMPANY,
    );
    expect(plan.inserts.map((r) => r.display)).toEqual(["Service Call"]);
    expect(plan.skipped).toBe(2);
  });

  it("dedupes duplicate cards within the same batch", () => {
    const plan = planTaskTypeCommit(
      [tt({ display: "Inspection" }), tt({ display: "INSPECTION" })],
      [],
      COMPANY,
    );
    expect(plan.inserts).toHaveLength(1);
    expect(plan.skipped).toBe(1);
  });

  it("keeps a provided color and skips blank task-type cards", () => {
    const plan = planTaskTypeCommit(
      [tt({ display: "Tear-off", color: "#9DB582" }), tt({ display: "   " })],
      [],
      COMPANY,
    );
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].color).toBe("#9DB582");
  });

  it("captures the trade from a trade card and does not insert it as a task type", () => {
    const plan = planTaskTypeCommit(
      [trade("roofing"), tt({ display: "Tear-off" })],
      [],
      COMPANY,
    );
    expect(plan.trade).toBe("roofing");
    expect(plan.inserts.map((r) => r.display)).toEqual(["Tear-off"]);
  });

  it("assigns stable, ascending display_order continuing past existing rows", () => {
    const plan = planTaskTypeCommit(
      [tt({ display: "A" }), tt({ display: "B" })],
      ["X", "Y", "Z"],
      COMPANY,
    );
    expect(plan.inserts.map((r) => r.display_order)).toEqual([3, 4]);
  });
});

// ── I/O wrappers (mocked Supabase) ──────────────────────────────────────────

function mockTaskTypesClient(existing: string[], insertErr: unknown = null) {
  const insert = vi.fn().mockResolvedValue({ error: insertErr });
  const client = {
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          is: () =>
            Promise.resolve({
              data: existing.map((d) => ({ display: d })),
              error: null,
            }),
        }),
      }),
      insert,
    })),
  };
  return { client, insert };
}

describe("commitTaskTypes", () => {
  it("reads existing rows, inserts only the new ones, returns counts", async () => {
    const { client, insert } = mockTaskTypesClient(["Repair"]);
    const res = await commitTaskTypes(client as never, COMPANY, [
      tt({ display: "Repair" }),
      tt({ display: "Tear-off" }),
    ]);
    expect(res.error).toBeNull();
    expect(res.inserted).toBe(1);
    expect(res.skipped).toBe(1);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toEqual([
      expect.objectContaining({ display: "Tear-off", company_id: COMPANY }),
    ]);
  });

  it("does not call insert when every card already exists", async () => {
    const { client, insert } = mockTaskTypesClient(["Repair", "Install"]);
    const res = await commitTaskTypes(client as never, COMPANY, [
      tt({ display: "repair" }),
      tt({ display: "install" }),
    ]);
    expect(insert).not.toHaveBeenCalled();
    expect(res.inserted).toBe(0);
    expect(res.skipped).toBe(2);
  });

  it("surfaces an insert error", async () => {
    const { client } = mockTaskTypesClient([], { message: "boom" });
    const res = await commitTaskTypes(client as never, COMPANY, [tt({ display: "New" })]);
    expect(res.inserted).toBe(0);
    expect(res.error).toMatchObject({ message: "boom" });
  });
});

describe("recordCompanyTrade", () => {
  function mockCompaniesClient(industries: string[] | null, updateErr: unknown = null) {
    const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: updateErr }) }));
    const client = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({ data: { industries }, error: null }),
          }),
        }),
        update,
      })),
    };
    return { client, update };
  }

  it("appends the trade LABEL (not slug) when absent", async () => {
    const { client, update } = mockCompaniesClient(["Carpentry"]);
    const res = await recordCompanyTrade(client as never, COMPANY, "roofing");
    expect(res.recorded).toBe(true);
    expect(update).toHaveBeenCalledWith({ industries: ["Carpentry", "Roofing"] });
  });

  it("is a no-op when the trade label is already present (dedupe)", async () => {
    const { client, update } = mockCompaniesClient(["Roofing"]);
    const res = await recordCompanyTrade(client as never, COMPANY, "roofing");
    expect(res.recorded).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("handles a null industries array", async () => {
    const { client, update } = mockCompaniesClient(null);
    const res = await recordCompanyTrade(client as never, COMPANY, "hvac");
    expect(res.recorded).toBe(true);
    expect(update).toHaveBeenCalledWith({ industries: ["HVAC"] });
  });
});
