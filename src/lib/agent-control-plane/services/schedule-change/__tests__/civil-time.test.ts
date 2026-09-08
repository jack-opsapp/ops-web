import { describe, expect, it } from "vitest";
import { resolveScheduleCivilTime, scheduleCivilDay, assertScheduleTimezoneParity } from "../civil-time";

describe("schedule civil-time boundary", () => {
  it("uses Vancouver's permanent daylight time after November 2026", () => {
    expect(resolveScheduleCivilTime("2026-11-02T00:00:00", "America/Vancouver")).toBe("2026-11-02T07:00:00.000Z");
  });
  it("rejects a Los Angeles spring gap and fall fold", () => {
    expect(() => resolveScheduleCivilTime("2026-03-08T02:30:00", "America/Los_Angeles")).toThrow("LOCAL_TIME_NOT_UNIQUE");
    expect(() => resolveScheduleCivilTime("2026-11-01T01:30:00", "America/Los_Angeles")).toThrow("LOCAL_TIME_NOT_UNIQUE");
  });
  it.each([
    ["2026-03-08", "2026-03-08T08:00:00.000Z", "2026-03-09T07:00:00.000Z", 23],
    ["2026-11-01", "2026-11-01T07:00:00.000Z", "2026-11-02T08:00:00.000Z", 25],
  ])("keeps exclusive civil-day ends on %s", (date, start, end, hours) => {
    const day = scheduleCivilDay(date, "America/Los_Angeles");
    expect(day).toEqual({ start, end });
    expect((Date.parse(day.end) - Date.parse(day.start)) / 3_600_000).toBe(hours);
  });
  it("does not reuse Vancouver's offset in another timezone", () => {
    expect(resolveScheduleCivilTime("2026-11-02T00:00:00", "Asia/Kathmandu")).toBe("2026-11-01T18:15:00.000Z");
  });
  it("rejects stale database tzdata instead of accepting the wrong instant", () => {
    expect(() => assertScheduleTimezoneParity("2026-11-02T00:00:00", "America/Vancouver", "2026-11-02T08:00:00Z")).toThrow("TIMEZONE_RULES_MISMATCH");
    expect(() => assertScheduleTimezoneParity("2026-11-02T00:00:00", "America/Vancouver", "2026-11-02T07:00:00Z")).not.toThrow();
  });
  it.each(["2026-02-30T00:00:00", "2026-01-01T24:00:00", "2026-01-01", "2026-01-01T00:00:00Z"])("rejects malformed civil value %s", (value) => {
    expect(() => resolveScheduleCivilTime(value, "UTC")).toThrow();
  });
});
