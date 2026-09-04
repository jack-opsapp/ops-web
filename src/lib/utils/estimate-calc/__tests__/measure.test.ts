import { describe, it, expect } from "vitest";
import { formatResult } from "../expression";
import {
  computeArea,
  computeLinear,
  convert,
  dimensionOf,
  UNIT_GROUPS,
} from "../measure";

describe("computeArea", () => {
  it("multiplies length by width in feet", () => {
    expect(computeArea({ length: 12, width: 16, unit: "ft", output: "sqft" })).toEqual({
      value: 192,
      working: "12 ft × 16 ft = 192 sq ft",
    });
  });

  it("multiplies by a count of identical areas", () => {
    expect(
      computeArea({ length: 12, width: 16, unit: "ft", count: 2, output: "sqft" }),
    ).toEqual({
      value: 384,
      working: "12 ft × 16 ft × 2 = 384 sq ft",
    });
  });

  it("adds a waste percentage and shows it as an aside", () => {
    expect(
      computeArea({
        length: 12,
        width: 16,
        unit: "ft",
        wastePercent: 10,
        output: "sqft",
      }),
    ).toEqual({
      value: 211.2,
      working: "12 ft × 16 ft = 192 sq ft (+10% waste = 211.2)",
    });
  });

  it("combines a count and a waste percentage", () => {
    expect(
      computeArea({
        length: 12,
        width: 16,
        unit: "ft",
        count: 2,
        wastePercent: 10,
        output: "sqft",
      }),
    ).toEqual({
      value: 422.4,
      working: "12 ft × 16 ft × 2 = 384 sq ft (+10% waste = 422.4)",
    });
  });

  it("keeps metres in square metres when that is the output", () => {
    expect(computeArea({ length: 3, width: 4, unit: "m", output: "sqm" })).toEqual({
      value: 12,
      working: "3 m × 4 m = 12 sq m",
    });
  });

  it("converts a metric area to square feet", () => {
    expect(computeArea({ length: 3, width: 4, unit: "m", output: "sqft" })).toEqual({
      value: 129.17,
      working: "3 m × 4 m = 129.17 sq ft",
    });
  });

  it("converts inches to square feet", () => {
    expect(computeArea({ length: 144, width: 24, unit: "in", output: "sqft" })).toEqual({
      value: 24,
      working: "144 in × 24 in = 24 sq ft",
    });
  });

  it("defaults the count to one and the waste to nothing", () => {
    const explicit = computeArea({
      length: 8,
      width: 10,
      unit: "ft",
      count: 1,
      wastePercent: 0,
      output: "sqft",
    });
    expect(computeArea({ length: 8, width: 10, unit: "ft", output: "sqft" })).toEqual(
      explicit,
    );
  });

  it("rejects a dimension that is not a number", () => {
    expect(() =>
      computeArea({ length: Number.NaN, width: 16, unit: "ft", output: "sqft" }),
    ).toThrow();
  });

  it("rejects a negative dimension", () => {
    expect(() =>
      computeArea({ length: 12, width: -16, unit: "ft", output: "sqft" }),
    ).toThrow();
  });
});

describe("computeLinear", () => {
  it("sums a run of lengths", () => {
    expect(
      computeLinear({ lengths: [14, 9, 22], unit: "ft", wastePercent: 0, output: "ft" }),
    ).toEqual({
      value: 45,
      working: "14 + 9 + 22 ft = 45 lin ft",
    });
  });

  it("adds a waste percentage and shows it as an aside", () => {
    expect(
      computeLinear({ lengths: [14, 9, 22], unit: "ft", wastePercent: 10, output: "ft" }),
    ).toEqual({
      value: 49.5,
      working: "14 + 9 + 22 ft = 45 lin ft (+10% waste = 49.5)",
    });
  });

  it("converts metric lengths to linear feet", () => {
    expect(
      computeLinear({ lengths: [1, 2], unit: "m", wastePercent: 0, output: "ft" }),
    ).toEqual({
      value: 9.84,
      working: "1 + 2 m = 9.84 lin ft",
    });
  });

  it("returns zero and no working for an empty list", () => {
    expect(
      computeLinear({ lengths: [], unit: "ft", wastePercent: 0, output: "ft" }),
    ).toEqual({ value: 0, working: null });
  });

  it("rejects an entry that is not a number", () => {
    expect(() =>
      computeLinear({
        lengths: [14, Number.NaN],
        unit: "ft",
        wastePercent: 0,
        output: "ft",
      }),
    ).toThrow();
  });

  it("rejects a negative entry", () => {
    expect(() =>
      computeLinear({ lengths: [14, -9], unit: "ft", wastePercent: 0, output: "ft" }),
    ).toThrow();
  });
});

describe("convert", () => {
  it("returns the value unchanged for an identity conversion", () => {
    expect(convert(5, "ft", "ft")).toBe(5);
  });

  it("converts inches to feet", () => {
    expect(convert(12, "in", "ft")).toBeCloseTo(1, 10);
    // Float noise (0.9999999999999999) never reaches the operator — the
    // display rounds it away.
    expect(formatResult(convert(12, "in", "ft"))).toBe("1");
  });

  it("converts metres to feet", () => {
    expect(convert(1, "m", "ft")).toBeCloseTo(3.280839895, 8);
    expect(formatResult(convert(1, "m", "ft"))).toBe("3.28");
  });

  it("converts yards to feet", () => {
    expect(convert(1, "yd", "ft")).toBeCloseTo(3, 10);
  });

  it("converts centimetres to metres", () => {
    expect(convert(100, "cm", "m")).toBeCloseTo(1, 10);
  });

  it("converts square yards to square feet", () => {
    expect(convert(1, "sqyd", "sqft")).toBeCloseTo(9, 10);
  });

  it("converts square metres to square feet", () => {
    expect(convert(1, "sqm", "sqft")).toBeCloseTo(10.763910417, 8);
  });

  it("converts cubic yards to cubic feet", () => {
    expect(convert(1, "cuyd", "cuft")).toBeCloseTo(27, 10);
  });

  it("converts cubic metres to cubic feet", () => {
    expect(convert(1, "m3", "cuft")).toBeCloseTo(35.314666721, 8);
  });

  it("refuses to convert across dimensions", () => {
    expect(() => convert(1, "ft", "sqft")).toThrow();
    expect(() => convert(1, "sqm", "m3")).toThrow();
    expect(() => convert(1, "cuft", "in")).toThrow();
  });
});

describe("dimensionOf", () => {
  it("classifies every unit", () => {
    expect(dimensionOf("ft")).toBe("length");
    expect(dimensionOf("cm")).toBe("length");
    expect(dimensionOf("sqyd")).toBe("area");
    expect(dimensionOf("m3")).toBe("volume");
  });
});

describe("UNIT_GROUPS", () => {
  it("enumerates the three dimensions in display order", () => {
    expect(UNIT_GROUPS.map((group) => group.dimension)).toEqual([
      "length",
      "area",
      "volume",
    ]);
  });

  it("lists each group's units in display order", () => {
    expect(UNIT_GROUPS[0].units).toEqual(["in", "ft", "yd", "cm", "m"]);
    expect(UNIT_GROUPS[1].units).toEqual(["sqft", "sqyd", "sqm"]);
    expect(UNIT_GROUPS[2].units).toEqual(["cuft", "cuyd", "m3"]);
  });

  it("agrees with dimensionOf for every unit it lists", () => {
    for (const group of UNIT_GROUPS) {
      for (const unit of group.units) {
        expect(dimensionOf(unit)).toBe(group.dimension);
      }
    }
  });
});
