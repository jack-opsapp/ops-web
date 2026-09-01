import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  growthAnalyticsCacheKey,
  parseGrowthFilters,
  resolveGrowthChannel,
} from "@/lib/admin/growth-analytics-queries";
import { sanitizeGrowthCsvCell } from "@/lib/admin/growth-analytics-export";

describe("growth analytics query boundaries", () => {
  it("parses an exact range and channel into a cache-isolated key", () => {
    const filters = parseGrowthFilters(
      new URLSearchParams("from=2026-07-01&to=2026-07-30&channel=referral")
    );

    expect(filters).toEqual({
      startDate: "2026-07-01",
      endDate: "2026-07-30",
      channel: "referral",
    });
    expect(growthAnalyticsCacheKey("overview", filters)).toEqual([
      "growth-analytics",
      "overview",
      "2026-07-01",
      "2026-07-30",
      "referral",
    ]);
  });

  it("rejects malformed, reversed, and oversized ranges", () => {
    expect(() =>
      parseGrowthFilters(new URLSearchParams("from=07-01-2026"))
    ).toThrow("YYYY-MM-DD");
    expect(() =>
      parseGrowthFilters(
        new URLSearchParams("from=2026-08-01&to=2026-07-01")
      )
    ).toThrow("1 to 366 days");
    expect(() =>
      parseGrowthFilters(
        new URLSearchParams("from=2025-01-01&to=2026-08-01")
      )
    ).toThrow("1 to 366 days");
    expect(() =>
      parseGrowthFilters(new URLSearchParams("channel=made_up"))
    ).toThrow("channel was invalid");
  });

  it("uses the organic lens only when first-party trial coverage is healthy", () => {
    expect(
      resolveGrowthChannel("auto", {
        observed: 80,
        total: 100,
        ratio: 0.8,
        label: "Known trial attribution",
      })
    ).toBe("organic_search");
    expect(
      resolveGrowthChannel("auto", {
        observed: 79,
        total: 100,
        ratio: 0.79,
        label: "Known trial attribution",
      })
    ).toBe("all");
    expect(
      resolveGrowthChannel("referral", {
        observed: 0,
        total: 0,
        ratio: null,
        label: "No trials in period",
      })
    ).toBe("referral");
  });

  it.each(["=1+1", "+SUM(A1:A2)", "-1+2", "@IMPORTDATA('x')"])(
    "neutralizes spreadsheet formulas in aggregate exports: %s",
    (value) => {
      expect(sanitizeGrowthCsvCell(value)).toBe(`"'${value}"`);
    }
  );

  it("quotes commas and embedded quotes in aggregate exports", () => {
    expect(sanitizeGrowthCsvCell('organic, "earned"')).toBe(
      '"organic, ""earned"""'
    );
  });
});
