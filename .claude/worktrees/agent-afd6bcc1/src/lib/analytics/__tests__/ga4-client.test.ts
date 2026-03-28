import { describe, it, expect } from "vitest";
import { buildDateRange, processEventCountRows } from "../ga4-client";

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
