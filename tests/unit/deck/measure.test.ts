/**
 * Measure tool — tap a run, read the number.
 *
 * This is the one place the web viewer makes a claim about the real world, so
 * it is a port, not a reimplementation: the tap routing mirrors
 * `DeckViewerToolState.recordMeasureTap`, the readout mirrors
 * `DeckMeasureReadout.build`, and the strings mirror `DimensionEngine`. Two
 * vertices measured on the phone and on the web must read the same inches.
 */

import { describe, expect, it } from "vitest";

import {
  buildMeasureReadout,
  clearMeasure,
  EMPTY_MEASURE,
  EMPTY_VALUE,
  formatArea,
  formatLength,
  recordMeasureTap,
  snapToVertex,
  undoMeasurePoint,
  type MeasureState,
} from "@/lib/deck/measure";

function drawing(...points: Array<[number, number]>): MeasureState {
  return {
    points: points.map(([x, y]) => ({ x, y })),
    phase: "drawing",
  };
}

const tap = (
  state: MeasureState,
  x: number,
  y: number,
  closeThreshold = 12,
  snap?: (point: { x: number; y: number }) => { x: number; y: number },
) => recordMeasureTap(state, { point: { x, y }, closeThreshold, snap });

describe("recordMeasureTap", () => {
  it("starts a run on the first tap", () => {
    const { state, result } = tap(EMPTY_MEASURE, 10, 20);
    expect(result).toBe("started");
    expect(state.points).toEqual([{ x: 10, y: 20 }]);
    expect(state.phase).toBe("drawing");
  });

  it("appends each further tap", () => {
    const { state, result } = tap(drawing([0, 0]), 100, 0);
    expect(result).toBe("appended");
    expect(state.points).toHaveLength(2);
  });

  it("snaps a tap onto a nearby vertex", () => {
    const snap = (point: { x: number; y: number }) =>
      Math.hypot(point.x - 100, point.y - 0) <= 12 ? { x: 100, y: 0 } : point;
    const { state } = tap(drawing([0, 0]), 96, 3, 12, snap);
    expect(state.points[1]).toEqual({ x: 100, y: 0 });
  });

  it("closes the loop on the first point once three points exist", () => {
    const { state, result } = tap(drawing([0, 0], [100, 0], [100, 80]), 4, 3);
    expect(result).toBe("closed");
    expect(state.phase).toBe("closed");
    expect(state.points).toHaveLength(3);
  });

  it("does not close a two-point run", () => {
    const { result } = tap(drawing([0, 0], [100, 0]), 2, 2);
    expect(result).not.toBe("closed");
  });

  it("finishes an open run when the last point is re-tapped", () => {
    const { state, result } = tap(drawing([0, 0], [100, 0]), 101, 4);
    expect(result).toBe("finished");
    expect(state.phase).toBe("finished");
  });

  it("ignores a sole-point self-tap — that records nothing", () => {
    const { state, result } = tap(drawing([0, 0]), 3, 3);
    expect(result).toBe("ignored");
    expect(state.points).toHaveLength(1);
  });

  it("ignores a tap that collapses onto the previous vertex", () => {
    const snap = () => ({ x: 100, y: 0 });
    const { state, result } = tap(drawing([0, 0], [100, 0]), 400, 400, 1, snap);
    expect(result).toBe("ignored");
    expect(state.points).toHaveLength(2);
  });

  it("starts a fresh run from a frozen phase", () => {
    for (const phase of ["finished", "closed"] as const) {
      const { state, result } = tap(
        { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], phase },
        60,
        60,
      );
      expect(result).toBe("started");
      expect(state.phase).toBe("drawing");
      expect(state.points).toEqual([{ x: 60, y: 60 }]);
    }
  });
});

describe("undoMeasurePoint / clearMeasure", () => {
  it("drops the last point while drawing", () => {
    expect(undoMeasurePoint(drawing([0, 0], [10, 0], [10, 10])).points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it("re-opens a frozen run instead of losing a point", () => {
    const reopened = undoMeasurePoint({
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      phase: "closed",
    });
    expect(reopened.phase).toBe("drawing");
    expect(reopened.points).toHaveLength(3);
  });

  it("clears to the empty state", () => {
    expect(clearMeasure()).toEqual(EMPTY_MEASURE);
  });
});

describe("snapToVertex", () => {
  const vertices = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 80 },
  ];

  it("takes the nearest vertex inside the radius", () => {
    expect(snapToVertex({ x: 96, y: 3 }, vertices, 12)).toEqual({ x: 100, y: 0 });
  });

  it("leaves a tap outside the radius alone", () => {
    expect(snapToVertex({ x: 50, y: 40 }, vertices, 12)).toEqual({ x: 50, y: 40 });
  });

  it("returns the tap unchanged when there is nothing to snap to", () => {
    expect(snapToVertex({ x: 5, y: 5 }, [], 12)).toEqual({ x: 5, y: 5 });
  });
});

describe("buildMeasureReadout", () => {
  it("reports the running length and segment count while open", () => {
    // 200 canvas units at scaleFactor 2 = 100 inches = 8' 4".
    const readout = buildMeasureReadout({
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      closed: false,
      scaleFactor: 2,
      system: "imperial",
    });
    expect(readout.totalLengthText).toBe("8' 4\"");
    expect(readout.segmentCount).toBe(1);
    expect(readout.areaText).toBeNull();
    expect(readout.perimeterText).toBeNull();
  });

  it("sums every drawn segment, without a closing edge", () => {
    const readout = buildMeasureReadout({
      points: [
        { x: 0, y: 0 },
        { x: 240, y: 0 },
        { x: 240, y: 240 },
      ],
      closed: false,
      scaleFactor: 2,
      system: "imperial",
    });
    // (240 + 240) / 2 = 240 inches = 20'.
    expect(readout.totalLengthText).toBe("20'");
    expect(readout.segmentCount).toBe(2);
  });

  it("reports area and perimeter once the loop closes", () => {
    const readout = buildMeasureReadout({
      points: [
        { x: 0, y: 0 },
        { x: 288, y: 0 },
        { x: 288, y: 240 },
        { x: 0, y: 240 },
      ],
      closed: true,
      scaleFactor: 2,
      system: "imperial",
    });
    // 144" × 120" = 17280 sq in = 120 sq ft; perimeter 528" = 44'.
    expect(readout.areaText).toBe("120 sq ft");
    expect(readout.perimeterText).toBe("44'");
    expect(readout.totalLengthText).toBeNull();
    expect(readout.isSelfIntersecting).toBe(false);
  });

  it("dashes the area of a self-intersecting loop but still reports perimeter", () => {
    const readout = buildMeasureReadout({
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ],
      closed: true,
      scaleFactor: 2,
      system: "imperial",
    });
    expect(readout.isSelfIntersecting).toBe(true);
    expect(readout.areaText).toBe(EMPTY_VALUE);
    expect(readout.perimeterText).not.toBe(EMPTY_VALUE);
  });

  it("dashes everything when the drawing has no usable scale", () => {
    const readout = buildMeasureReadout({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      closed: true,
      scaleFactor: 0,
      system: "imperial",
    });
    expect(readout.areaText).toBe(EMPTY_VALUE);
    expect(readout.perimeterText).toBe(EMPTY_VALUE);
    expect(readout.totalLengthText).toBeNull();
  });

  it("has nothing to say about a single point", () => {
    const readout = buildMeasureReadout({
      points: [{ x: 4, y: 4 }],
      closed: false,
      scaleFactor: 2,
      system: "imperial",
    });
    expect(readout.totalLengthText).toBeNull();
    expect(readout.segmentCount).toBe(0);
  });

  it("reads metric when the drawing is metric", () => {
    const readout = buildMeasureReadout({
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      closed: false,
      scaleFactor: 2,
      system: "metric",
    });
    // 100 inches = 254 cm = 2.54 m.
    expect(readout.totalLengthText).toBe("2.54 m");
  });
});

describe("formatLength — the iOS imperial ladder", () => {
  it.each([
    [294, "24' 6\""],
    [120, "10'"],
    [5.5, '5 1/2"'],
    [5.1875, '5 3/16"'],
    [0.5, '1/2"'],
    [143.9999, "12'"],
    [0, "0'"],
  ])("formats %s inches as %s", (inches, expected) => {
    expect(formatLength(inches, "imperial")).toBe(expected);
  });

  it("dashes a non-finite or absurd value rather than showing a float token", () => {
    expect(formatLength(Number.NaN, "imperial")).toBe(EMPTY_VALUE);
    expect(formatLength(Number.POSITIVE_INFINITY, "imperial")).toBe(EMPTY_VALUE);
    expect(formatLength(2_000_000, "imperial")).toBe(EMPTY_VALUE);
  });

  it("formats metric in metres past a metre, centimetres below", () => {
    expect(formatLength(100, "metric")).toBe("2.54 m");
    expect(formatLength(10, "metric")).toBe("25 cm");
  });
});

describe("formatArea", () => {
  it("rounds to whole square feet past ten, one decimal below", () => {
    expect(formatArea(56448, "imperial")).toBe("392 sq ft");
    expect(formatArea(1000, "imperial")).toBe("6.9 sq ft");
  });

  it("formats metric area in square metres", () => {
    expect(formatArea(15500, "metric")).toBe("10.0 m²");
  });

  it("dashes a non-finite area", () => {
    expect(formatArea(Number.NaN, "imperial")).toBe(EMPTY_VALUE);
  });
});
