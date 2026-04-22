import { describe, it, expect } from "vitest";
import { buildSparklinePath } from "../empty-status-sparkline";

describe("buildSparklinePath", () => {
  it("returns empty string for empty values", () => {
    expect(buildSparklinePath([], 100, 40)).toBe("");
  });

  it("returns a single point for one value (as a 1-length line)", () => {
    const path = buildSparklinePath([5], 100, 40);
    expect(path).toMatch(/^M 0,/);
    expect(path).toContain("L");
  });

  it("maps max value to top (y=0) and min to bottom (y=height)", () => {
    const path = buildSparklinePath([10, 20, 5], 100, 40);
    expect(path).toMatch(/,\s*0(\s|$)/);
    expect(path).toMatch(/,\s*40(\s|$)/);
  });

  it("distributes x-coordinates evenly across width", () => {
    const path = buildSparklinePath([1, 2, 3, 4, 5], 100, 40);
    expect(path).toContain("M 0,");
    expect(path).toMatch(/\b25,/);
    expect(path).toMatch(/\b50,/);
    expect(path).toMatch(/\b75,/);
    expect(path).toMatch(/\b100,/);
  });

  it("renders a flat line when all values are equal (including all zeros)", () => {
    const path = buildSparklinePath([0, 0, 0, 0], 100, 40);
    expect(path).toContain("20"); // height/2
    const yValues = Array.from(path.matchAll(/,(\d+(?:\.\d+)?)(\s|$)/g)).map(
      (m) => parseFloat(m[1])
    );
    expect(new Set(yValues).size).toBe(1);
    expect(yValues[0]).toBe(20);
  });
});
