import { describe, it, expect } from "vitest";
import {
  padVelocityDays,
  computeWeekDelta,
  type VelocityDayRow,
} from "../inbox-velocity-helpers";

// Fix "now" to 2026-04-21 00:00:00 UTC for deterministic tests
const NOW = new Date("2026-04-21T00:00:00Z");

function day(isoDay: string, count: number): VelocityDayRow {
  return { day: new Date(isoDay + "T00:00:00Z"), count };
}

describe("padVelocityDays", () => {
  it("returns an all-zero array of length `days` when no rows", () => {
    expect(padVelocityDays([], 14, NOW)).toEqual(new Array(14).fill(0));
  });

  it("returns oldest → newest order", () => {
    const rows = [day("2026-04-20", 5), day("2026-04-10", 3)];
    const result = padVelocityDays(rows, 14, NOW);
    expect(result).toHaveLength(14);
    // 2026-04-10 is 11 days before 2026-04-21 → index 14 - 11 = 3
    expect(result[3]).toBe(3);
    // 2026-04-20 is yesterday (1 day before) → index 14 - 1 = 13
    expect(result[13]).toBe(5);
  });

  it("fills gaps with 0", () => {
    const rows = [day("2026-04-20", 5)];
    const result = padVelocityDays(rows, 14, NOW);
    expect(result.filter((v) => v > 0)).toHaveLength(1);
    expect(result[13]).toBe(5);
  });

  it("ignores rows outside the window", () => {
    const rows = [
      day("2026-04-20", 5), // in window
      day("2026-04-01", 99), // out of window (> 14 days ago)
    ];
    const result = padVelocityDays(rows, 14, NOW);
    expect(result.reduce((a, b) => a + b, 0)).toBe(5);
  });

  it("handles days=7 windowing", () => {
    const rows = [day("2026-04-20", 5), day("2026-04-14", 3)];
    const result = padVelocityDays(rows, 7, NOW);
    expect(result).toHaveLength(7);
    expect(result[6]).toBe(5); // 2026-04-20 = index 6
    expect(result[0]).toBe(3); // 2026-04-14 = index 0
  });
});

describe("computeWeekDelta", () => {
  it("splits a 14-day array into prior (first 7) + this (last 7)", () => {
    const daily = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16];
    const result = computeWeekDelta(daily);
    expect(result.priorWeekTotal).toBe(28); // 1+2+...+7
    expect(result.weekTotal).toBe(91); // 10+11+...+16
  });

  it("computes positive delta when this week > prior", () => {
    const daily = [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2];
    // prior = 7, this = 14, delta = (14-7)/7 = 1.0
    expect(computeWeekDelta(daily).weekDelta).toBe(1);
  });

  it("computes negative delta when this week < prior", () => {
    const daily = [2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1];
    expect(computeWeekDelta(daily).weekDelta).toBeCloseTo(-0.5);
  });

  it("returns 0 delta when both weeks are zero", () => {
    const daily = new Array(14).fill(0);
    const result = computeWeekDelta(daily);
    expect(result.weekTotal).toBe(0);
    expect(result.priorWeekTotal).toBe(0);
    expect(result.weekDelta).toBe(0);
  });

  it("returns 0 delta when prior week is zero but current is non-zero (avoid Infinity)", () => {
    const daily = [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1];
    expect(computeWeekDelta(daily).weekDelta).toBe(0);
  });

  it("rejects arrays not of length 14", () => {
    expect(() => computeWeekDelta([1, 2, 3])).toThrow();
  });
});
