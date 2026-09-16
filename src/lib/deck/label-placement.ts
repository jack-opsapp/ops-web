/**
 * OPS Web — surface-label placement.
 *
 * A label belongs to its surface, so it has to live INSIDE that surface: at
 * the centre of the largest axis-aligned rectangle that fits, sized to fill
 * that rectangle, clamped to a legible band on screen. Anchoring on the vertex
 * mean falls outside an L-shaped deck; a fixed font size disappears at fit
 * zoom. This is the same algorithm iOS runs in
 * `OPS/DeckBuilder/Rendering/DeckSurfaceLabelPlacement.swift`, so the label
 * lands in the same place at the same weight on both surfaces.
 *
 * Grid-rasterised maximal rectangle: O(n²) over a 64×64 grid of the polygon's
 * bounding box — well under a millisecond for a deck, and deterministic.
 *
 * One addition over the iOS type: `holes`. Web surfaces carry their hole loops
 * (a stairwell, a tree cut-out), and a label may not land in a void.
 */

import { pointInPolygon, type DeckPoint } from "./drawing-data";

export const GRID_RESOLUTION = 64;
/** DESIGN.md: 11px minimum on screen, no exceptions. */
export const SCREEN_FLOOR_PX = 11;
/** DESIGN.md display ceiling — zooming in never makes a label absurd. */
export const SCREEN_CAP_PX = 28;

export interface LabelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LabelSize {
  readonly width: number;
  readonly height: number;
}

export interface LabelFit {
  /** The text to draw — truncated with "…" when even the floor will not fit. */
  readonly text: string;
  /** Font size in CANVAS units; multiply by the viewport scale for screen px. */
  readonly fontSize: number;
  /** Measured size of `text` at `fontSize`, in canvas units. */
  readonly size: LabelSize;
}

export function rectCenter(rect: LabelRect): DeckPoint {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * The largest axis-aligned rectangle that fits inside `polygon` and outside
 * every loop in `holes`. Returns `null` for a degenerate polygon — the caller
 * falls back to the centroid at the floor size.
 */
export function largestInscribedRect(
  polygon: readonly DeckPoint[],
  holes: readonly (readonly DeckPoint[])[] = [],
): LabelRect | null {
  if (polygon.length < 3) return null;
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (!(maxX > minX) || !(maxY > minY)) return null;

  const n = GRID_RESOLUTION;
  const cellW = (maxX - minX) / n;
  const cellH = (maxY - minY) / n;

  // inside[r][c] is true when the cell's centre is in the surface and in no hole.
  const inside: boolean[][] = [];
  for (let r = 0; r < n; r += 1) {
    const row: boolean[] = [];
    for (let c = 0; c < n; c += 1) {
      const probe = {
        x: minX + (c + 0.5) * cellW,
        y: minY + (r + 0.5) * cellH,
      };
      row.push(
        pointInPolygon(probe, polygon) &&
          !holes.some((hole) => pointInPolygon(probe, hole)),
      );
    }
    inside.push(row);
  }

  // Maximal rectangle in a binary matrix: per-row histogram + monotonic stack.
  const heights = new Array<number>(n).fill(0);
  let best = { area: 0, r0: 0, c0: 0, r1: 0, c1: 0 };
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      heights[c] = inside[r]![c] ? heights[c]! + 1 : 0;
    }
    const stack: number[] = [];
    for (let c = 0; c <= n; c += 1) {
      const h = c === n ? 0 : heights[c]!;
      while (stack.length > 0 && heights[stack[stack.length - 1]!]! >= h) {
        const top = stack.pop()!;
        const height = heights[top]!;
        const left = stack.length > 0 ? stack[stack.length - 1]! + 1 : 0;
        const width = c - left;
        const area = height * width;
        if (area > best.area) {
          best = { area, r0: r - height + 1, c0: left, r1: r, c1: c - 1 };
        }
      }
      stack.push(c);
    }
  }
  if (best.area <= 0) return null;

  // Shrink by half a cell on every side so the rectangle is strictly inside.
  const x0 = minX + best.c0 * cellW + cellW / 2;
  const y0 = minY + best.r0 * cellH + cellH / 2;
  const x1 = minX + (best.c1 + 1) * cellW - cellW / 2;
  const y1 = minY + (best.r1 + 1) * cellH - cellH / 2;
  if (!(x1 > x0) || !(y1 > y0)) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** True when all four corners and the centre of `rect` sit inside `polygon`. */
export function isInside(
  rect: LabelRect,
  polygon: readonly DeckPoint[],
): boolean {
  const probes: DeckPoint[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    rectCenter(rect),
  ];
  return probes.every((probe) => pointInPolygon(probe, polygon));
}

const SCALE_FLOOR = Math.sqrt(Number.EPSILON);

/**
 * The largest font (canvas units) whose measured single line fits `rect` inset
 * by `padding`, clamped to the on-screen floor and cap for the current
 * `canvasScale`. Text metrics scale linearly with font size, so one reference
 * measurement plus one confirmation is enough.
 *
 * When even the floor overflows, the text is truncated with "…" rather than
 * drawn outside its surface. The label is never hidden: a surface the operator
 * named always says its name.
 */
export function fitLabel(input: {
  readonly text: string;
  readonly rect: LabelRect;
  readonly canvasScale: number;
  readonly padding: number;
  readonly measure: (text: string, fontSize: number) => LabelSize;
}): LabelFit {
  const { text, rect, padding, measure } = input;
  const scale = Math.max(input.canvasScale, SCALE_FLOOR);
  const floor = SCREEN_FLOOR_PX / scale;
  const cap = SCREEN_CAP_PX / scale;
  const availableWidth = Math.max(rect.width - 2 * padding, 0);
  const availableHeight = Math.max(rect.height - 2 * padding, 0);

  const reference = 100;
  const referenceSize = measure(text, reference);
  let size = reference;
  if (referenceSize.width > 0 && referenceSize.height > 0) {
    size =
      Math.min(
        availableWidth / referenceSize.width,
        availableHeight / referenceSize.height,
      ) * reference;
  }
  size = Math.min(cap, Math.max(floor, size));

  let candidate = text;
  let measured = measure(candidate, size);
  if (measured.width > availableWidth && size <= floor + 0.01) {
    const chars = [...text];
    while (chars.length > 1) {
      chars.pop();
      candidate = `${chars.join("").trimEnd()}…`;
      measured = measure(candidate, size);
      if (measured.width <= availableWidth) break;
    }
  }
  return { text: candidate, fontSize: size, size: measured };
}
