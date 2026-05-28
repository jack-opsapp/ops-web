import { describe, it, expect } from "vitest";
import { computeOperatorLocalHour } from "@/lib/api/services/onboarding-drip-service";

describe("computeOperatorLocalHour", () => {
  it("returns the hour in operator local time for a known timezone", () => {
    // 2026-05-27 14:00:00 UTC = 7am PDT
    const utc = new Date("2026-05-27T14:00:00Z");
    expect(computeOperatorLocalHour(utc, "America/Los_Angeles")).toBe(7);
  });

  it("returns 9 in PT when UTC is 16:00 (PDT)", () => {
    const utc = new Date("2026-05-27T16:00:00Z");
    expect(computeOperatorLocalHour(utc, "America/Los_Angeles")).toBe(9);
  });

  it("returns the hour for an Eastern operator", () => {
    // 14:00 UTC = 10am EDT
    const utc = new Date("2026-05-27T14:00:00Z");
    expect(computeOperatorLocalHour(utc, "America/New_York")).toBe(10);
  });

  it("falls back to UTC hour if timezone is unknown / null", () => {
    const utc = new Date("2026-05-27T14:00:00Z");
    expect(computeOperatorLocalHour(utc, null)).toBe(14);
  });
});
