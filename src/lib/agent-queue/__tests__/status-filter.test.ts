import { describe, expect, it } from "vitest";
import {
  ALL_STATUSES,
  HISTORY_STATUSES,
  parseStatusesParam,
} from "../status-filter";

describe("parseStatusesParam", () => {
  it("returns undefined for a missing or empty param", () => {
    expect(parseStatusesParam(null)).toBeUndefined();
    expect(parseStatusesParam("")).toBeUndefined();
    expect(parseStatusesParam(" , ")).toBeUndefined();
  });

  it("splits and validates a comma list", () => {
    expect(parseStatusesParam("approved, rejected")).toEqual([
      "approved",
      "rejected",
    ]);
  });

  it("rejects unknown statuses", () => {
    expect(() => parseStatusesParam("pending,bogus")).toThrow(/bogus/);
  });

  it("history is every status except pending", () => {
    expect(HISTORY_STATUSES).not.toContain("pending");
    expect(HISTORY_STATUSES).toHaveLength(ALL_STATUSES.length - 1);
  });
});
