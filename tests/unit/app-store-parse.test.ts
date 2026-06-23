import { describe, it, expect } from "vitest";
import { parseTsv, mapAppStoreSourceToChannel } from "@/lib/analytics/app-store-parse";

describe("mapAppStoreSourceToChannel", () => {
  it.each([
    ["App Store Search", "app_store_search"],
    ["App Store Browse", "app_store_browse"],
    ["App Referrer", "app_referrer"],
    ["Web Referrer", "web_referrer"],
    ["App Clip", "app_clip"],
    ["Institutional Purchase", "institutional"],
    ["Unavailable", "unavailable"],
    ["", "unavailable"],
    ["Something New From Apple", "other"],
  ])("maps %s -> %s", (src, expected) => {
    expect(mapAppStoreSourceToChannel(src, null)).toBe(expected);
  });

  it("is case/whitespace tolerant", () => {
    expect(mapAppStoreSourceToChannel("  app store SEARCH ", null)).toBe("app_store_search");
  });

  it("treats null source as unavailable", () => {
    expect(mapAppStoreSourceToChannel(null, null)).toBe("unavailable");
  });
});

const ALIASES = {
  reporting_date: ["date"],
  source_type: ["source type"],
  counts: ["counts"],
  unique_counts: ["unique counts", "unique devices"],
};

describe("parseTsv (header-name based, drift-tolerant)", () => {
  it("maps the documented header order and parses thousands separators", () => {
    const tsv = "Date\tSource Type\tCounts\tUnique Counts\n2026-06-01\tApp Store Search\t1,234\t1000";
    const rows = parseTsv(tsv, ALIASES);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reporting_date: "2026-06-01",
      source_type: "App Store Search",
      counts: 1234,
      unique_counts: 1000,
    });
  });

  it("survives reordered columns (maps by name, not index)", () => {
    const tsv = "Unique Counts\tCounts\tSource Type\tDate\n5\t9\tApp Store Browse\t2026-06-02";
    const rows = parseTsv(tsv, ALIASES);
    expect(rows[0]).toMatchObject({ counts: 9, unique_counts: 5, source_type: "App Store Browse", reporting_date: "2026-06-02" });
  });

  it("keeps unknown columns in raw and never drops them", () => {
    const tsv = "Date\tSource Type\tCounts\tNew Apple Column\n2026-06-03\tWeb Referrer\t3\tXYZ";
    const rows = parseTsv(tsv, ALIASES);
    expect((rows[0].raw as Record<string, string>)["new apple column"]).toBe("XYZ");
  });

  it("handles the 'Unique Devices' alias for unique_counts", () => {
    const tsv = "Date\tSource Type\tCounts\tUnique Devices\n2026-06-04\tApp Store Search\t7\t4";
    const rows = parseTsv(tsv, ALIASES);
    expect(rows[0].unique_counts).toBe(4);
  });

  it("returns [] for header-only or empty input", () => {
    expect(parseTsv("Date\tCounts", ALIASES)).toEqual([]);
    expect(parseTsv("", ALIASES)).toEqual([]);
  });

  it("defaults missing numerics to 0 and missing dimensions to empty string in raw", () => {
    const tsv = "Date\tSource Type\tCounts\tUnique Counts\n2026-06-05\tApp Store Search\t\t";
    const rows = parseTsv(tsv, ALIASES);
    expect(rows[0].counts).toBe(0);
    expect(rows[0].unique_counts).toBe(0);
  });
});
