import { beforeEach, describe, expect, it, vi } from "vitest";
const getClient = vi.fn();
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => getClient(),
}));
vi.mock("../estimate-service", () => ({
  mapLineItemFromDb: (row: unknown) => row,
}));
vi.mock("../portal-branding-service", () => ({ PortalBrandingService: {} }));
vi.mock("@/lib/supabase/helpers", () => ({
  parseDate: (value: string | null) => (value ? new Date(value) : null),
  parseDateRequired: (value: string) => new Date(value),
}));
import { PortalService } from "../portal-service";
function database(held: boolean) {
  const row = {
    id: "estimate",
    client_id: "client",
    company_id: "company",
    distribution_hold: held,
    status: "sent",
    deleted_at: null,
    issue_date: "2026-09-07",
    viewed_at: null,
  };
  let writes = 0;
  const from = (table: string) => {
    const filters: Array<(r: typeof row) => boolean> = [];
    let update: unknown;
    const run = (single = false) => {
      const match = table === "estimates" && filters.every((test) => test(row));
      if (update && match) writes++;
      return {
        data: single ? (match ? row : null) : match ? [row] : [],
        error: single && !match ? { message: "not found" } : null,
      };
    };
    const b = {
      select: () => b,
      update: (value: unknown) => {
        update = value;
        return b;
      },
      eq: (k: string, v: unknown) => {
        filters.push((r) => (r as Record<string, unknown>)[k] === v);
        return b;
      },
      neq: (k: string, v: unknown) => {
        filters.push((r) => (r as Record<string, unknown>)[k] !== v);
        return b;
      },
      is: (k: string, v: unknown) => {
        filters.push((r) => (r as Record<string, unknown>)[k] === v);
        return b;
      },
      order: () => b,
      single: async () => run(true),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve),
    };
    return b;
  };
  return { client: { from }, writes: () => writes };
}
beforeEach(() => vi.clearAllMocks());
describe("held financial draft customer portal boundary", () => {
  it("refuses private document reads even for the correct client", async () => {
    const db = database(true);
    getClient.mockReturnValue(db.client);
    await expect(
      PortalService.getEstimateForPortal("estimate", "client")
    ).rejects.toThrow("not found");
    expect(db.writes()).toBe(0);
  });
  it.each(["approveEstimate", "declineEstimate"] as const)(
    "refuses %s for held document",
    async (method) => {
      const db = database(true);
      getClient.mockReturnValue(db.client);
      await expect(PortalService[method]("estimate", "client")).rejects.toThrow(
        "not found"
      );
      expect(db.writes()).toBe(0);
    }
  );
  it("does not mark a held document viewed", async () => {
    const db = database(true);
    getClient.mockReturnValue(db.client);
    await PortalService.markEstimateViewed("estimate");
    expect(db.writes()).toBe(0);
  });
  it("preserves ordinary released estimate reads", async () => {
    const db = database(false);
    getClient.mockReturnValue(db.client);
    expect(
      (await PortalService.getEstimateForPortal("estimate", "client")).id
    ).toBe("estimate");
  });
});
