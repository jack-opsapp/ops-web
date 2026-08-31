import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({ uid: "admin" })),
  overview: vi.fn(),
  search: vi.fn(),
  appStore: vi.fn(),
  health: vi.fn(),
}));

vi.mock("@/lib/admin/api-auth", () => ({
  requireAdmin: mocks.requireAdmin,
  withAdmin: <T extends (...args: never[]) => unknown>(handler: T) => handler,
}));

vi.mock("@/lib/admin/growth-analytics-queries", () => ({
  parseGrowthFilters: () => ({
    startDate: "2026-08-01",
    endDate: "2026-08-30",
    channel: "auto",
  }),
  getCachedGrowthOverview: mocks.overview,
  getCachedGrowthSearchReport: mocks.search,
  getCachedGrowthAppStoreReport: mocks.appStore,
  getCachedGrowthHealth: mocks.health,
}));

vi.mock("@/lib/admin/growth-analytics-export", () => ({
  buildGrowthOverviewCsv: () => "section,metric\r\n",
}));

const envelope = {
  data: null,
  state: "missing",
  asOf: "2026-08-30T00:00:00.000Z",
  finalizedThrough: null,
  coverage: { observed: null, total: null, ratio: null, label: "Unavailable" },
  sources: [],
};

describe("founder growth API authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.overview.mockResolvedValue(envelope);
    mocks.search.mockResolvedValue(envelope);
    mocks.appStore.mockResolvedValue(envelope);
    mocks.health.mockResolvedValue(envelope);
  });

  it("authenticates every aggregate growth route before reading data", async () => {
    const [{ GET: overview }, { GET: search }, { GET: appStore }, { GET: health }] =
      await Promise.all([
        import("@/app/api/admin/acquisition/overview/route"),
        import("@/app/api/admin/acquisition/search/route"),
        import("@/app/api/admin/acquisition/app-store/route"),
        import("@/app/api/admin/acquisition/health/route"),
      ]);
    const requests = [
      [overview, "overview"],
      [search, "search"],
      [appStore, "app-store"],
      [health, "health"],
    ] as const;

    for (const [handler, path] of requests) {
      const response = await handler(
        new Request(`https://opsapp.co/api/admin/acquisition/${path}`) as never
      );
      expect(response.status).toBe(200);
    }

    expect(mocks.requireAdmin).toHaveBeenCalledTimes(4);
    expect(mocks.overview).toHaveBeenCalledOnce();
    expect(mocks.search).toHaveBeenCalledOnce();
    expect(mocks.appStore).toHaveBeenCalledOnce();
    expect(mocks.health).toHaveBeenCalledOnce();
  });

  it("exports only the authenticated aggregate overview", async () => {
    const { GET } = await import("@/app/api/admin/acquisition/overview/route");
    const response = await GET(
      new Request(
        "https://opsapp.co/api/admin/acquisition/overview?format=csv"
      ) as never
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toContain(
      "ops-growth-2026-08-01-2026-08-30.csv"
    );
    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.overview).toHaveBeenCalledOnce();
  });
});
