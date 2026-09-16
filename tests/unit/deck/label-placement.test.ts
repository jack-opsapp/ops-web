/**
 * Surface-label placement — the TypeScript half of the algorithm iOS runs in
 * `DeckSurfaceLabelPlacement.swift`. Same grid resolution, same maximal
 * rectangle, same screen floor and cap, so "Upper deck" sits in the same spot
 * at the same weight whether the operator is on the phone or at the desk.
 *
 * These cases mirror `OPSTests/DeckBuilder/DeckSurfaceLabelPlacementTests.swift`.
 */

import { describe, expect, it } from "vitest";

import { pointInPolygon, type DeckPoint } from "@/lib/deck/drawing-data";
import {
  fitLabel,
  isInside,
  largestInscribedRect,
  SCREEN_CAP_PX,
  SCREEN_FLOOR_PX,
} from "@/lib/deck/label-placement";

const square: DeckPoint[] = [
  { x: 0, y: 0 },
  { x: 400, y: 0 },
  { x: 400, y: 300 },
  { x: 0, y: 300 },
];

/** 400 wide, 300 tall, with the top-right 200×150 notch removed. */
const lShape: DeckPoint[] = [
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 150 },
  { x: 400, y: 150 },
  { x: 400, y: 300 },
  { x: 0, y: 300 },
];

/** Width = 0.6 × fontSize per character, height = 1.2 × fontSize. */
const measure = (text: string, size: number) => ({
  width: text.length * 0.6 * size,
  height: 1.2 * size,
});

describe("largestInscribedRect", () => {
  it("fills nearly the whole surface on a rectangle", () => {
    const rect = largestInscribedRect(square)!;
    expect(rect).not.toBeNull();
    expect(rect.width * rect.height).toBeGreaterThan(0.9 * 400 * 300);
    expect(isInside(rect, square)).toBe(true);
  });

  it("lies inside one leg of an L-shape and never in the notch", () => {
    const rect = largestInscribedRect(lShape)!;
    expect(isInside(rect, lShape)).toBe(true);
    const corners: DeckPoint[] = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x, y: rect.y + rect.height },
      { x: rect.x + rect.width, y: rect.y + rect.height },
    ];
    for (const corner of corners) {
      // The notch is x > 200 && y < 150.
      expect(corner.x > 200 && corner.y < 150).toBe(false);
    }
    expect(rect.width * rect.height).toBeGreaterThan(0.5 * 200 * 300);
  });

  it("centres inside a concave polygon, where the vertex mean does not", () => {
    const rect = largestInscribedRect(lShape)!;
    const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    expect(pointInPolygon(center, lShape)).toBe(true);
  });

  it("returns null for a degenerate polygon", () => {
    expect(largestInscribedRect([])).toBeNull();
    expect(
      largestInscribedRect([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toBeNull();
    expect(
      largestInscribedRect([
        { x: 5, y: 5 },
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ]),
    ).toBeNull();
  });

  it("keeps the rectangle inside a surface with a hole", () => {
    // A 300×300 ring: the label must never land in the 100×100 void.
    const ring: DeckPoint[] = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 300 },
      { x: 0, y: 300 },
    ];
    const hole: DeckPoint[] = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 100, y: 200 },
    ];
    const rect = largestInscribedRect(ring, [hole])!;
    expect(rect).not.toBeNull();
    expect(isInside(rect, ring)).toBe(true);
    const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    expect(pointInPolygon(center, hole)).toBe(false);
  });
});

describe("fitLabel", () => {
  it("fills the rectangle and respects the screen floor and cap", () => {
    const rect = { x: 0, y: 0, width: 400, height: 300 };
    const fit = fitLabel({
      text: "Upper deck",
      rect,
      canvasScale: 0.5,
      padding: 8,
      measure,
    });
    expect(fit.size.width).toBeLessThanOrEqual(rect.width - 16);
    expect(fit.size.height).toBeLessThanOrEqual(rect.height - 16);
    expect(fit.fontSize * 0.5).toBeLessThanOrEqual(SCREEN_CAP_PX);
    expect(fit.fontSize * 0.5).toBeGreaterThanOrEqual(SCREEN_FLOOR_PX);
    expect(fit.text).toBe("Upper deck");
  });

  it("truncates at the screen floor instead of overflowing a narrow rectangle", () => {
    const rect = { x: 0, y: 0, width: 60, height: 40 };
    const fit = fitLabel({
      text: "Upper deck level two",
      rect,
      canvasScale: 1,
      padding: 4,
      measure,
    });
    expect(fit.fontSize).toBe(SCREEN_FLOOR_PX);
    expect(fit.text.endsWith("…")).toBe(true);
    expect(fit.size.width).toBeLessThanOrEqual(rect.width - 8);
  });

  it("grows the canvas font as the viewer zooms out so the label holds its size", () => {
    const rect = { x: 0, y: 0, width: 400, height: 300 };
    const zoomedOut = fitLabel({
      text: "Upper deck",
      rect,
      canvasScale: 0.25,
      padding: 8,
      measure,
    });
    const zoomedIn = fitLabel({
      text: "Upper deck",
      rect,
      canvasScale: 2,
      padding: 8,
      measure,
    });
    // Canvas units grow as scale shrinks; on screen both stay within the band.
    expect(zoomedOut.fontSize).toBeGreaterThan(zoomedIn.fontSize);
    for (const [fit, scale] of [
      [zoomedOut, 0.25],
      [zoomedIn, 2],
    ] as const) {
      expect(fit.fontSize * scale).toBeGreaterThanOrEqual(SCREEN_FLOOR_PX - 1e-9);
      expect(fit.fontSize * scale).toBeLessThanOrEqual(SCREEN_CAP_PX + 1e-9);
    }
  });

  it("never returns a non-finite size for a zero-scale or empty input", () => {
    const rect = { x: 0, y: 0, width: 400, height: 300 };
    const fit = fitLabel({ text: "Deck", rect, canvasScale: 0, padding: 8, measure });
    expect(Number.isFinite(fit.fontSize)).toBe(true);
    expect(Number.isFinite(fit.size.width)).toBe(true);

    const empty = fitLabel({ text: "", rect, canvasScale: 1, padding: 8, measure });
    expect(empty.text).toBe("");
    expect(Number.isFinite(empty.fontSize)).toBe(true);
  });
});
