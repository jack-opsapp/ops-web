import { afterEach, describe, it, expect } from "vitest";
import {
  buildDateRange,
  getPropertyId,
  processEventCountRows,
} from "../ga4-client";

const PROPERTY_ENV_KEYS = [
  "GA4_PROPERTY_ID",
  "GA4_MARKETING_PROPERTY_ID",
  "GA4_WEB_APP_PROPERTY_ID",
  "GA4_IOS_PROPERTY_ID",
] as const;

afterEach(() => {
  for (const key of PROPERTY_ENV_KEYS) delete process.env[key];
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
