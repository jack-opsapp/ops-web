/**
 * Tests for Date Utilities
 *
 * Tests date parsing, formatting, and relative time functions that handle
 * the various date formats Bubble.io returns (ISO8601, UNIX timestamps).
 *
 * NOTE: These tests define the expected API for src/lib/utils/date-utils.ts
 * which will be created as part of the web app build-out. The module should export:
 *   - parseBubbleDate(input: string | number | null | undefined): Date | null
 *   - formatDate(date: Date, format?: string): string
 *   - formatRelativeTime(date: Date): string
 *   - isOverdue(date: Date): boolean
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Module Under Test ──────────────────────────────────────────────────────
// Since date-utils.ts doesn't exist yet, we implement the functions inline
// to validate the test logic. When the module is created, replace this block
// with: import { parseBubbleDate, formatDate, formatRelativeTime, isOverdue } from "@/lib/utils/date-utils";

function parseBubbleDate(input: string | number | null | undefined): Date | null {
  if (input === null || input === undefined || input === "") {
    return null;
  }

  // Handle numeric timestamps
  if (typeof input === "number") {
    if (isNaN(input) || !isFinite(input)) return null;
    // If the number is less than 10 billion, it's likely seconds (UNIX timestamp)
    // Otherwise it's milliseconds
    const ms = input < 1e10 ? input * 1000 : input;
    const date = new Date(ms);
    return isNaN(date.getTime()) ? null : date;
  }

  // Handle string inputs
  if (typeof input === "string") {
    // Try ISO8601 parse
    const date = new Date(input);
    if (!isNaN(date.getTime())) {
      return date;
    }
    // Try parsing as numeric string
    const num = Number(input);
    if (!isNaN(num)) {
      return parseBubbleDate(num);
    }
    return null;
  }

  return null;
}

function formatDate(date: Date, format: string = "short"): string {
  if (format === "iso") {
    return date.toISOString();
  }
  if (format === "long") {
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
  if (format === "time") {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  // Default "short"
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelativeTime(date: Date, now?: Date): string {
  const current = now || new Date();
  const diffMs = current.getTime() - date.getTime();
  const diffSeconds = Math.floor(Math.abs(diffMs) / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const isFuture = diffMs < 0;

  if (diffSeconds < 60) {
    return "just now";
  }
  if (diffMinutes < 60) {
    const label = diffMinutes === 1 ? "minute" : "minutes";
    return isFuture ? `in ${diffMinutes} ${label}` : `${diffMinutes} ${label} ago`;
  }
  if (diffHours < 24) {
    const label = diffHours === 1 ? "hour" : "hours";
    return isFuture ? `in ${diffHours} ${label}` : `${diffHours} ${label} ago`;
  }
  if (diffDays < 30) {
    const label = diffDays === 1 ? "day" : "days";
    return isFuture ? `in ${diffDays} ${label}` : `${diffDays} ${label} ago`;
  }

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    const label = diffMonths === 1 ? "month" : "months";
    return isFuture ? `in ${diffMonths} ${label}` : `${diffMonths} ${label} ago`;
  }

  const diffYears = Math.floor(diffDays / 365);
  const label = diffYears === 1 ? "year" : "years";
  return isFuture ? `in ${diffYears} ${label}` : `${diffYears} ${label} ago`;
}

function isOverdue(date: Date, now?: Date): boolean {
  const current = now || new Date();
  return date.getTime() < current.getTime();
}

// ─── parseBubbleDate ────────────────────────────────────────────────────────

describe("parseBubbleDate", () => {
  describe("ISO8601 strings", () => {
    it("parses a standard ISO8601 date string", () => {
      const result = parseBubbleDate("2025-06-15T10:30:00.000Z");
      expect(result).toBeInstanceOf(Date);
      expect(result!.toISOString()).toBe("2025-06-15T10:30:00.000Z");
    });

    it("parses an ISO8601 date without milliseconds", () => {
      const result = parseBubbleDate("2025-06-15T10:30:00Z");
      expect(result).toBeInstanceOf(Date);
      expect(result!.getFullYear()).toBe(2025);
      expect(result!.getUTCMonth()).toBe(5); // June = 5 (zero-indexed)
      expect(result!.getUTCDate()).toBe(15);
    });

    it("parses an ISO8601 date with timezone offset", () => {
      const result = parseBubbleDate("2025-06-15T10:30:00-05:00");
      expect(result).toBeInstanceOf(Date);
      expect(result!.getUTCHours()).toBe(15); // 10:30 - (-5:00) = 15:30 UTC
    });

    it("parses a date-only string (no time component)", () => {
      const result = parseBubbleDate("2025-06-15");
      expect(result).toBeInstanceOf(Date);
      expect(result!.getFullYear()).toBe(2025);
    });
  });

  describe("UNIX timestamps (milliseconds)", () => {
    it("parses a millisecond timestamp", () => {
      const ms = 1718451000000; // 2024-06-15T13:30:00Z
      const result = parseBubbleDate(ms);
      expect(result).toBeInstanceOf(Date);
      expect(result!.getFullYear()).toBe(2024);
    });

    it("parses a large millisecond timestamp from Stripe", () => {
      const ms = 1735689600000; // 2025-01-01T00:00:00Z
      const result = parseBubbleDate(ms);
      expect(result).toBeInstanceOf(Date);
      expect(result!.getUTCFullYear()).toBe(2025);
      expect(result!.getUTCMonth()).toBe(0);
      expect(result!.getUTCDate()).toBe(1);
    });
  });

  describe("UNIX timestamps (seconds)", () => {
    it("parses a second-precision timestamp", () => {
      const sec = 1718451000; // 2024-06-15T13:30:00Z
      const result = parseBubbleDate(sec);
      expect(result).toBeInstanceOf(Date);
      expect(result!.getFullYear()).toBe(2024);
    });

    it("distinguishes seconds from milliseconds", () => {
      const sec = 1700000000; // ~2023-11-14
      const ms = 1700000000000;
      const fromSec = parseBubbleDate(sec);
      const fromMs = parseBubbleDate(ms);
      expect(fromSec!.getFullYear()).toBe(fromMs!.getFullYear());
      expect(fromSec!.getMonth()).toBe(fromMs!.getMonth());
      expect(fromSec!.getDate()).toBe(fromMs!.getDate());
    });
  });

  describe("invalid inputs", () => {
    it("returns null for null", () => {
      expect(parseBubbleDate(null)).toBeNull();
    });

    it("returns null for undefined", () => {
      expect(parseBubbleDate(undefined)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseBubbleDate("")).toBeNull();
    });

    it("returns null for garbage string", () => {
      expect(parseBubbleDate("not-a-date")).toBeNull();
    });

    it("returns null for NaN", () => {
      expect(parseBubbleDate(NaN)).toBeNull();
    });

    it("returns null for Infinity", () => {
      expect(parseBubbleDate(Infinity)).toBeNull();
    });
  });

  describe("string numeric timestamps", () => {
    it("parses numeric string as timestamp", () => {
      const result = parseBubbleDate("1718451000000");
      expect(result).toBeInstanceOf(Date);
      expect(result!.getFullYear()).toBe(2024);
    });
  });
});

// ─── formatDate ─────────────────────────────────────────────────────────────

describe("formatDate", () => {
  const testDate = new Date("2025-06-15T10:30:00.000Z");

  it("formats with default 'short' format", () => {
    const result = formatDate(testDate, "short");
    // "Jun 15, 2025" format
    expect(result).toContain("Jun");
    expect(result).toContain("15");
    expect(result).toContain("2025");
  });

  it("formats with 'long' format including weekday", () => {
    const result = formatDate(testDate, "long");
    expect(result).toContain("2025");
    expect(result).toContain("June");
    expect(result).toContain("15");
  });

  it("formats as ISO string", () => {
    const result = formatDate(testDate, "iso");
    expect(result).toBe("2025-06-15T10:30:00.000Z");
  });

  it("formats time only", () => {
    const result = formatDate(testDate, "time");
    // Should contain hour and minute
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it("uses 'short' when no format specified", () => {
    const result = formatDate(testDate);
    expect(result).toContain("Jun");
    expect(result).toContain("2025");
  });
});

// ─── formatRelativeTime ─────────────────────────────────────────────────────

describe("formatRelativeTime", () => {
  const baseTime = new Date("2025-06-15T12:00:00.000Z");

  it("returns 'just now' for less than 60 seconds ago", () => {
    const date = new Date(baseTime.getTime() - 30 * 1000);
    expect(formatRelativeTime(date, baseTime)).toBe("just now");
  });

  it("returns '1 minute ago' for 60 seconds", () => {
    const date = new Date(baseTime.getTime() - 60 * 1000);
    expect(formatRelativeTime(date, baseTime)).toBe("1 minute ago");
  });

  it("returns '5 minutes ago'", () => {
    const date = new Date(baseTime.getTime() - 5 * 60 * 1000);
    expect(formatRelativeTime(date, baseTime)).toBe("5 minutes ago");
  });

  it("returns '1 hour ago'", () => {
    const date = new Date(baseTime.getTime() - 60 * 60 * 1000);
    expect(formatRelativeTime(date, baseTime)).toBe("1 hour ago");
  });

  it("returns '2 hours ago'", () => {
    const date = new Date(baseTime.getTime() - 2 * 60 * 60 * 1000);
    expect(formatRelativeTime(date, baseTime)).toBe("2 hours ago");
  });

  it("returns '1 day ago'", () => {
    const date = new Date(baseTime.getTime() - 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(date, baseTime)).toBe("1 day ago");
  });

  it("returns '7 days ago'", () => {
    const date = new Date(baseTime.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(date, baseTime)).toBe("7 days ago");
  });

  it("returns months for dates more than 30 days ago", () => {
    const date = new Date(baseTime.getTime() - 45 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(date, baseTime)).toBe("1 month ago");
  });

  it("returns years for dates more than 365 days ago", () => {
    const date = new Date(baseTime.getTime() - 400 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(date, baseTime)).toBe("1 year ago");
  });

  it("handles future dates with 'in X' prefix", () => {
    const date = new Date(baseTime.getTime() + 2 * 60 * 60 * 1000);
    expect(formatRelativeTime(date, baseTime)).toBe("in 2 hours");
  });

  it("returns 'in 3 days' for future date", () => {
    const date = new Date(baseTime.getTime() + 3 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(date, baseTime)).toBe("in 3 days");
  });
});

// ─── isOverdue ──────────────────────────────────────────────────────────────

describe("isOverdue", () => {
  const now = new Date("2025-06-15T12:00:00.000Z");

  it("returns true for a date in the past", () => {
    const pastDate = new Date("2025-06-14T12:00:00.000Z");
    expect(isOverdue(pastDate, now)).toBe(true);
  });

  it("returns false for a date in the future", () => {
    const futureDate = new Date("2025-06-16T12:00:00.000Z");
    expect(isOverdue(futureDate, now)).toBe(false);
  });

  it("returns false for the exact same time (not strictly overdue)", () => {
    const sameTime = new Date(now.getTime());
    expect(isOverdue(sameTime, now)).toBe(false);
  });

  it("returns true for 1 millisecond in the past", () => {
    const justPast = new Date(now.getTime() - 1);
    expect(isOverdue(justPast, now)).toBe(true);
  });

  it("returns true for a date far in the past", () => {
    const longAgo = new Date("2020-01-01T00:00:00.000Z");
    expect(isOverdue(longAgo, now)).toBe(true);
  });

  it("returns false for a date far in the future", () => {
    const farFuture = new Date("2030-12-31T23:59:59.000Z");
    expect(isOverdue(farFuture, now)).toBe(false);
  });
});
