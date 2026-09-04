import { afterEach, describe, it, expect, vi } from "vitest";

const { ga4RunReport } = vi.hoisted(() => ({
  ga4RunReport: vi.fn(),
}));

vi.mock("@google-analytics/data", () => ({
  BetaAnalyticsDataClient: class {
    runReport = ga4RunReport;
  },
}));

import {
  buildDateRange,
  getBlogPageViews,
  getBlogViewsByPost,
  getBlogViewsTimeline,
  getEventByDate,
  getEventByDimension,
  getEventByPlatform,
  getEventCountTotal,
  getFormAbandonment,
  getOnboardingFunnel,
  getPropertyId,
  getSignupsByWeek,
  getTopScreens,
  processEventCountRows,
} from "../ga4-client";
import { composeGA4ProductionHostnameFilter } from "../ga4-report-filter";
import { ANALYTICS_PROPERTY_REGISTRY } from "../property-registry";

const PROPERTY_ENV_KEYS = [
  "GA4_PROPERTY_ID",
  "GA4_MARKETING_PROPERTY_ID",
  "GA4_WEB_APP_PROPERTY_ID",
  "GA4_IOS_PROPERTY_ID",
  "GA4_SERVICE_ACCOUNT_JSON",
] as const;

afterEach(() => {
  for (const key of PROPERTY_ENV_KEYS) delete process.env[key];
  ga4RunReport.mockReset();
});

describe("getPropertyId", () => {
  it("selects the explicit property named by the caller", () => {
    process.env.GA4_PROPERTY_ID = "999999999";
    process.env.GA4_MARKETING_PROPERTY_ID = "475051117";
    process.env.GA4_WEB_APP_PROPERTY_ID = "539494652";
    process.env.GA4_IOS_PROPERTY_ID = "514229717";

    expect(getPropertyId("marketing")).toBe("properties/475051117");
    expect(getPropertyId("web_app")).toBe("properties/539494652");
    expect(getPropertyId("ios_app")).toBe("properties/514229717");
  });

  it("rejects whitespace instead of silently selecting a malformed property", () => {
    process.env.GA4_MARKETING_PROPERTY_ID = " 475051117";
    expect(() => getPropertyId("marketing")).toThrow(
      "Invalid GA4_MARKETING_PROPERTY_ID"
    );
  });

  it("rejects a valid numeric ID mapped to the wrong OPS property", () => {
    process.env.GA4_MARKETING_PROPERTY_ID = "539494652";
    expect(() => getPropertyId("marketing")).toThrow(
      "does not match the OPS property registry"
    );
  });
});

describe("buildDateRange", () => {
  it("returns correct startDate/endDate for given days", () => {
    const range = buildDateRange(30);
    expect(range).toEqual({ startDate: "30daysAgo", endDate: "today" });
  });

  it("accepts custom day counts", () => {
    expect(buildDateRange(7)).toEqual({ startDate: "7daysAgo", endDate: "today" });
    expect(buildDateRange(90)).toEqual({ startDate: "90daysAgo", endDate: "today" });
  });
});

describe("processEventCountRows", () => {
  it("extracts dimension value and metric count from GA4 rows", () => {
    const rows = [
      {
        dimensionValues: [{ value: "iOS" }],
        metricValues: [{ value: "142" }],
      },
      {
        dimensionValues: [{ value: "Android" }],
        metricValues: [{ value: "38" }],
      },
    ];

    const result = processEventCountRows(rows as never);
    expect(result).toEqual([
      { dimension: "iOS", count: 142 },
      { dimension: "Android", count: 38 },
    ]);
  });

  it("handles empty rows", () => {
    expect(processEventCountRows([])).toEqual([]);
  });

  it("handles missing dimension/metric values gracefully", () => {
    const rows = [{ dimensionValues: [], metricValues: [] }];
    const result = processEventCountRows(rows as never);
    expect(result).toEqual([{ dimension: "(not set)", count: 0 }]);
  });
});

describe("GA4 production hostname contract", () => {
  it("allows only the production hosts assigned to each web property", () => {
    expect(ANALYTICS_PROPERTY_REGISTRY.marketing.productionHosts).toEqual([
      "opsapp.co",
      "www.opsapp.co",
      "try.opsapp.co",
    ]);
    expect(ANALYTICS_PROPERTY_REGISTRY.web_app.productionHosts).toEqual([
      "app.opsapp.co",
    ]);
    expect(ANALYTICS_PROPERTY_REGISTRY.ios_app.productionHosts).toBeNull();
  });

  it("adds the production-host allowlist to an unfiltered web report", () => {
    expect(composeGA4ProductionHostnameFilter("marketing")).toEqual({
      filter: {
        fieldName: "hostName",
        inListFilter: {
          values: ["opsapp.co", "www.opsapp.co", "try.opsapp.co"],
          caseSensitive: false,
        },
      },
    });
  });

  it("combines an existing report filter with the web host allowlist", () => {
    const eventFilter = {
      filter: {
        fieldName: "eventName",
        stringFilter: { matchType: "EXACT" as const, value: "sign_up" },
      },
    };

    expect(
      composeGA4ProductionHostnameFilter("web_app", eventFilter)
    ).toEqual({
      andGroup: {
        expressions: [
          eventFilter,
          {
            filter: {
              fieldName: "hostName",
              inListFilter: {
                values: ["app.opsapp.co"],
                caseSensitive: false,
              },
            },
          },
        ],
      },
    });
  });

  it("leaves iOS reports unchanged because app events have no hostname", () => {
    const eventFilter = {
      filter: {
        fieldName: "eventName",
        stringFilter: { matchType: "EXACT" as const, value: "sign_up" },
      },
    };

    expect(composeGA4ProductionHostnameFilter("ios_app")).toBeUndefined();
    expect(
      composeGA4ProductionHostnameFilter("ios_app", eventFilter)
    ).toBe(eventFilter);
  });
});

describe("GA4 report requests", () => {
  it("applies the marketing hostname boundary to every shared web report", async () => {
    process.env.GA4_MARKETING_PROPERTY_ID = "475051117";
    process.env.GA4_SERVICE_ACCOUNT_JSON = "{}";
    ga4RunReport.mockResolvedValue([{ rows: [] }]);

    await getEventByPlatform("marketing", "sign_up");
    await getEventByDate("marketing", "sign_up");
    await getOnboardingFunnel("marketing");
    await getTopScreens("marketing");
    await getSignupsByWeek("marketing");
    await getEventCountTotal("marketing", "sign_up");
    await getEventByDimension("marketing", "sign_up", "platform");
    await getFormAbandonment("marketing");
    await getBlogPageViews("marketing");
    await getBlogViewsByPost("marketing");
    await getBlogViewsTimeline("marketing");

    expect(ga4RunReport).toHaveBeenCalledTimes(14);
    for (const [request] of ga4RunReport.mock.calls) {
      expect(request.dimensions ?? []).not.toContainEqual({ name: "hostName" });
      expect(request.dimensionFilter).toEqual({
        andGroup: {
          expressions: [
            expect.any(Object),
            {
              filter: {
                fieldName: "hostName",
                inListFilter: {
                  values: ["opsapp.co", "www.opsapp.co", "try.opsapp.co"],
                  caseSensitive: false,
                },
              },
            },
          ],
        },
      });
    }
  });

  it("preserves the iOS event filter without adding a hostname condition", async () => {
    process.env.GA4_IOS_PROPERTY_ID = "514229717";
    process.env.GA4_SERVICE_ACCOUNT_JSON = "{}";
    ga4RunReport.mockResolvedValue([{ rows: [] }]);

    await getEventByPlatform("ios_app", "sign_up");

    expect(ga4RunReport).toHaveBeenCalledWith({
      property: "properties/514229717",
      dimensions: [{ name: "platform" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          stringFilter: { matchType: "EXACT", value: "sign_up" },
        },
      },
      dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
    });
  });
});
