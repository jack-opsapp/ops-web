/**
 * Deck viewer viewport — the pure pan/zoom reducer behind the drafting table.
 *
 * The contract that matters to a human: whatever is under the cursor stays
 * under the cursor. Everything else (clamping, fit) exists to keep the drawing
 * findable.
 */

import { describe, expect, it } from "vitest";

import {
  fitBounds,
  IDENTITY_VIEWPORT,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  toContent,
  toScreen,
  zoomBy,
} from "@/lib/deck/viewport";

const size = { width: 800, height: 600 };
const bounds = {
  minX: 0,
  minY: 0,
  maxX: 400,
  maxY: 300,
  width: 400,
  height: 300,
};

describe("zoomBy", () => {
  it("keeps the point under the cursor fixed", () => {
    const start = { scale: 1.4, x: -55, y: 32 };
    const anchor = { x: 317, y: 208 };
    const before = toContent(start, anchor.x, anchor.y);
    const zoomed = zoomBy(start, 2.3, anchor.x, anchor.y);
    const after = toContent(zoomed, anchor.x, anchor.y);

    expect(zoomed.scale).toBeCloseTo(1.4 * 2.3, 10);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("keeps the anchor fixed when zooming out too", () => {
    const start = { scale: 3, x: 120, y: -40 };
    const before = toContent(start, 10, 590);
    const zoomed = zoomBy(start, 0.5, 10, 590);
    const after = toContent(zoomed, 10, 590);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("clamps to the zoom range and leaves the viewport untouched at the stop", () => {
    const atMax = zoomBy({ scale: MAX_SCALE, x: 12, y: 34 }, 4, 400, 300);
    expect(atMax).toEqual({ scale: MAX_SCALE, x: 12, y: 34 });

    const atMin = zoomBy({ scale: MIN_SCALE, x: 12, y: 34 }, 0.1, 400, 300);
    expect(atMin).toEqual({ scale: MIN_SCALE, x: 12, y: 34 });

    expect(zoomBy(IDENTITY_VIEWPORT, 1000, 0, 0).scale).toBe(MAX_SCALE);
    expect(zoomBy(IDENTITY_VIEWPORT, 0.0001, 0, 0).scale).toBe(MIN_SCALE);
  });

  it("ignores a non-finite or non-positive factor", () => {
    const start = { scale: 2, x: 5, y: 6 };
    expect(zoomBy(start, Number.NaN, 0, 0)).toEqual(start);
    expect(zoomBy(start, 0, 0, 0)).toEqual(start);
    expect(zoomBy(start, -2, 0, 0)).toEqual(start);
  });
});

describe("panBy", () => {
  it("translates the viewport by the screen delta", () => {
    expect(panBy({ scale: 2, x: 10, y: -5 }, 30, 12)).toEqual({
      scale: 2,
      x: 40,
      y: 7,
    });
  });

  it("moves the content under the cursor by exactly the drag distance", () => {
    const start = { scale: 0.75, x: 60, y: 20 };
    const point = { x: 140, y: 90 };
    const beforeScreen = toScreen(start, point);
    const afterScreen = toScreen(panBy(start, -48, 17), point);
    expect(afterScreen.x).toBeCloseTo(beforeScreen.x - 48, 9);
    expect(afterScreen.y).toBeCloseTo(beforeScreen.y + 17, 9);
  });
});

describe("fitBounds", () => {
  it("fits the drawing with padding and centres it", () => {
    const viewport = fitBounds(bounds, size);
    // The tighter axis governs: 600/300 = 2, × 0.85 padding.
    expect(viewport.scale).toBeCloseTo(1.7, 10);

    const topLeft = toScreen(viewport, { x: bounds.minX, y: bounds.minY });
    const bottomRight = toScreen(viewport, { x: bounds.maxX, y: bounds.maxY });
    expect(topLeft.x + bottomRight.x).toBeCloseTo(size.width, 9);
    expect(topLeft.y + bottomRight.y).toBeCloseTo(size.height, 9);
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
  });

  it("honours a custom padding ratio", () => {
    expect(fitBounds(bounds, size, 1).scale).toBeCloseTo(2, 10);
    expect(fitBounds(bounds, size, 0.5).scale).toBeCloseTo(1, 10);
  });

  it("clamps the fitted scale into the zoom range", () => {
    const hair = { ...bounds, maxX: 0.001, maxY: 0.001, width: 0.001, height: 0.001 };
    expect(fitBounds(hair, size).scale).toBe(MAX_SCALE);

    const vast = {
      minX: 0,
      minY: 0,
      maxX: 1e6,
      maxY: 1e6,
      width: 1e6,
      height: 1e6,
    };
    expect(fitBounds(vast, size).scale).toBe(MIN_SCALE);
  });

  it("centres a straight run, which has zero height", () => {
    const run = { minX: 0, minY: 50, maxX: 400, maxY: 50, width: 400, height: 0 };
    const viewport = fitBounds(run, size);
    expect(Number.isFinite(viewport.scale)).toBe(true);
    expect(Number.isFinite(viewport.x)).toBe(true);
    expect(Number.isFinite(viewport.y)).toBe(true);
    const mid = toScreen(viewport, { x: 200, y: 50 });
    expect(mid.x).toBeCloseTo(size.width / 2, 9);
    expect(mid.y).toBeCloseTo(size.height / 2, 9);
  });

  it("falls back to identity for an empty viewport", () => {
    expect(fitBounds(bounds, { width: 0, height: 0 })).toEqual(IDENTITY_VIEWPORT);
  });
});

describe("toContent / toScreen", () => {
  it("round-trips", () => {
    const viewport = { scale: 1.75, x: -220, y: 64 };
    const screen = toScreen(viewport, { x: 137, y: -42 });
    const content = toContent(viewport, screen.x, screen.y);
    expect(content.x).toBeCloseTo(137, 9);
    expect(content.y).toBeCloseTo(-42, 9);
  });
});
