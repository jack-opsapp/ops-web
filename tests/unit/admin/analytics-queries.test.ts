import { beforeEach, describe, expect, it, vi } from "vitest";

const { runReport } = vi.hoisted(() => ({ runReport: vi.fn() }));

vi.mock("@/lib/analytics/ga4-client", () => ({
  getGA4Client: () => ({ runReport }),
  getPropertyId: (propertyKey: string) => `properties/${propertyKey}`,
  buildDateRange: (days: number) => ({
    startDate: `${days}daysAgo`,
    endDate: "today",
  }),
}));

import {
  getDeviceBreakdown,
  getSessionsByDate,
  getTopPages,
  getTopReferrers,
  getWebsiteOverview,
} from "@/lib/admin/analytics-queries";

describe("admin website analytics requests", () => {
  beforeEach(() => {
    runReport.mockReset();
    runReport.mockResolvedValue([{ rows: [] }]);
  });

  it("limits every direct website report to the requested property's production hosts", async () => {
    await getWebsiteOverview("marketing");
    await getSessionsByDate("marketing");
    await getTopPages("marketing");
    await getTopReferrers("marketing");
    await getDeviceBreakdown("marketing");

    expect(runReport).toHaveBeenCalledTimes(5);
    for (const [request] of runReport.mock.calls) {
      expect(request.dimensions ?? []).not.toContainEqual({ name: "hostName" });
      expect(request.dimensionFilter).toEqual({
        filter: {
          fieldName: "hostName",
          inListFilter: {
            values: ["opsapp.co", "www.opsapp.co", "try.opsapp.co"],
            caseSensitive: false,
          },
        },
      });
    }
  });

  it("uses the web-app host when the direct report targets that property", async () => {
    await getWebsiteOverview("web_app");

    expect(runReport).toHaveBeenCalledWith(
      expect.objectContaining({
        dimensionFilter: {
          filter: {
            fieldName: "hostName",
            inListFilter: {
              values: ["app.opsapp.co"],
              caseSensitive: false,
            },
          },
        },
      })
    );
  });
});
