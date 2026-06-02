/**
 * Tests for the pipeline table cell formatters.
 *
 * Focus is the null/edge paths and the pipeline-specific percent contract:
 * `winProbability` is an integer percent (50 ⇒ "50%"), NOT a 0–1 decimal, so
 * `formatPercentInt` must never multiply by 100. The currency/date re-exports
 * are smoke-tested to prove the DRY re-export from the projects formatters is
 * wired correctly.
 */

import { describe, it, expect } from "vitest";

import {
  formatPercentInt,
  formatAgeDays,
  formatCurrency,
  formatNumber,
  formatDate,
} from "../pipeline-table-formatters";

const EMPTY = "—";

describe("formatPercentInt", () => {
  it("renders an integer percent without ×100", () => {
    expect(formatPercentInt(50)).toBe("50%");
  });

  it("returns the empty sentinel for null", () => {
    expect(formatPercentInt(null)).toBe(EMPTY);
  });

  it("rounds fractional percents to the nearest whole", () => {
    expect(formatPercentInt(64.4)).toBe("64%");
  });

  it("renders zero as 0%", () => {
    expect(formatPercentInt(0)).toBe("0%");
  });

  it("renders 100 as 100% (full probability)", () => {
    expect(formatPercentInt(100)).toBe("100%");
  });
});

describe("formatAgeDays", () => {
  it("renders a positive day count with a 'd' suffix", () => {
    expect(formatAgeDays(9)).toBe("9d");
  });

  it("renders zero days as 0d (not the empty sentinel)", () => {
    expect(formatAgeDays(0)).toBe("0d");
  });

  it("returns the empty sentinel for null", () => {
    expect(formatAgeDays(null)).toBe(EMPTY);
  });
});

describe("formatCurrency (re-export)", () => {
  it("formats USD with no decimals and thousands separators", () => {
    expect(formatCurrency(12400)).toBe("$12,400");
  });

  it("returns the empty sentinel for null", () => {
    expect(formatCurrency(null)).toBe(EMPTY);
  });
});

describe("formatNumber (re-export)", () => {
  it("formats with thousands separators", () => {
    expect(formatNumber(1234)).toBe("1,234");
  });

  it("returns the empty sentinel for null", () => {
    expect(formatNumber(null)).toBe(EMPTY);
  });
});

describe("formatDate (re-export)", () => {
  it("returns the empty sentinel for null", () => {
    expect(formatDate(null)).toBe(EMPTY);
  });

  it("renders a YYYY-MM-DD date as a short month/day string", () => {
    const result = formatDate("2026-05-31");
    expect(result).not.toBe(EMPTY);
    expect(result).toContain("31");
  });
});
