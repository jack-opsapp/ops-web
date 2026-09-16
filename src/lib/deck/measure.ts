/**
 * OPS Web — deck measure tool.
 *
 * Tap a run on the drawing, read the number. A port of the iOS tool so the
 * same two vertices give the same inches on the phone and at the desk:
 *
 *   - tap routing → `OPS/DeckBuilder/Models/DeckViewerToolState.swift`
 *   - readout     → `OPS/DeckBuilder/Models/DeckMeasureReadout.swift`
 *   - strings     → `OPS/DeckBuilder/Engine/DimensionEngine.swift`
 *
 * Everything here is canvas-space and pure. The caller converts screen pixels
 * to canvas units (divide by the viewport scale) before calling in, which is
 * what keeps the 12px snap radius a CONSTANT ON SCREEN at every zoom level.
 */

import {
  isSelfIntersecting,
  polygonArea,
  polygonPerimeter,
  type DeckPoint,
} from "./drawing-data";

export type MeasurementSystem = "imperial" | "metric";

/**
 * `drawing` accepts taps; `finished` freezes an open run; `closed` freezes a
 * loop and unlocks the area readout. A tap in either frozen phase starts a
 * fresh measurement at that point.
 */
export type MeasurePhase = "drawing" | "finished" | "closed";

export type MeasureTapResult =
  | "started"
  | "appended"
  | "finished"
  | "closed"
  | "ignored";

export interface MeasureState {
  readonly points: readonly DeckPoint[];
  readonly phase: MeasurePhase;
}

export const EMPTY_MEASURE: MeasureState = { points: [], phase: "drawing" };

/** Brand empty state — an em dash, never "N/A". */
export const EMPTY_VALUE = "—";

/** A tap this close to the previous vertex records nothing. */
const COLLAPSE_EPSILON = 0.5;

function distance(a: DeckPoint, b: DeckPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Pull a tap onto the nearest vertex inside `radius` (canvas units). Measuring
 * corner-to-corner is the whole job; asking an operator to hit a 2px dot with
 * a mouse is not.
 */
export function snapToVertex(
  point: DeckPoint,
  candidates: readonly DeckPoint[],
  radius: number,
): DeckPoint {
  let best: DeckPoint | null = null;
  let bestDistance = radius;
  for (const candidate of candidates) {
    const gap = distance(point, candidate);
    if (gap <= bestDistance) {
      best = candidate;
      bestDistance = gap;
    }
  }
  return best ?? point;
}

/**
 * Route one tap. In priority order:
 *   1. Frozen phase → reset and start a new run at the tap.
 *   2. ≥3 points and within `closeThreshold` of the FIRST point → close.
 *   3. Within `closeThreshold` of the LAST point → finish (≥2 points), else
 *      ignore (a sole-point self-tap records nothing).
 *   4. Otherwise snap and append; a tap that collapses onto the previous
 *      vertex is ignored rather than recorded as a zero-length segment.
 */
export function recordMeasureTap(
  state: MeasureState,
  input: {
    readonly point: DeckPoint;
    readonly closeThreshold: number;
    readonly snap?: (point: DeckPoint) => DeckPoint;
  },
): { readonly state: MeasureState; readonly result: MeasureTapResult } {
  const snap = input.snap ?? ((point: DeckPoint) => point);
  const raw = input.point;

  if (state.phase !== "drawing") {
    return {
      state: { points: [snap(raw)], phase: "drawing" },
      result: "started",
    };
  }

  const first = state.points[0];
  const last = state.points[state.points.length - 1];

  if (first === undefined) {
    return {
      state: { points: [snap(raw)], phase: "drawing" },
      result: "started",
    };
  }

  if (state.points.length >= 3 && distance(raw, first) <= input.closeThreshold) {
    return { state: { ...state, phase: "closed" }, result: "closed" };
  }

  if (last !== undefined && distance(raw, last) <= input.closeThreshold) {
    if (state.points.length < 2) return { state, result: "ignored" };
    return { state: { ...state, phase: "finished" }, result: "finished" };
  }

  const snapped = snap(raw);
  if (last !== undefined && distance(snapped, last) < COLLAPSE_EPSILON) {
    return { state, result: "ignored" };
  }
  return {
    state: { points: [...state.points, snapped], phase: "drawing" },
    result: "appended",
  };
}

/**
 * Drop the last vertex while drawing; from a frozen phase, re-open the run
 * instead — that recovers an accidental finish without losing the points.
 */
export function undoMeasurePoint(state: MeasureState): MeasureState {
  if (state.phase !== "drawing") return { ...state, phase: "drawing" };
  if (state.points.length === 0) return state;
  return { points: state.points.slice(0, -1), phase: "drawing" };
}

export function clearMeasure(): MeasureState {
  return EMPTY_MEASURE;
}

// ---------------------------------------------------------------------------
// Formatting — the iOS DimensionEngine ladder
// ---------------------------------------------------------------------------

/** Largest value we will render: ~15.8 miles. Beyond that the data is corrupt. */
const MAX_INCHES = 1_000_000;

function greatestCommonDivisor(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

/** Reduced fraction for a count of sixteenths (8 → "1/2", 3 → "3/16"). */
function imperialFraction(sixteenths: number): string {
  if (sixteenths <= 0) return "";
  const divisor = greatestCommonDivisor(sixteenths, 16);
  return `${sixteenths / divisor}/${16 / divisor}`;
}

/**
 * Feet and inches, snapped to the nearest 1/16" and rendered as a reduced
 * fraction — never a decimal. Integer maths on total sixteenths handles the
 * foot rollover with no "11' 12\"" edge.
 */
export function formatImperial(totalInches: number): string {
  if (!Number.isFinite(totalInches)) return EMPTY_VALUE;
  if (totalInches < 0) return formatImperial(Math.abs(totalInches));
  if (totalInches > MAX_INCHES) return EMPTY_VALUE;

  const totalSixteenths = Math.round(totalInches * 16);
  const feet = Math.trunc(totalSixteenths / 192); // 12" × 16
  const remainder = totalSixteenths % 192;
  const wholeInches = Math.trunc(remainder / 16);
  const sixteenths = remainder % 16;

  if (wholeInches === 0 && sixteenths === 0) return `${feet}'`;

  const fraction = imperialFraction(sixteenths);
  const inchPart =
    sixteenths === 0
      ? `${wholeInches}"`
      : wholeInches === 0
        ? `${fraction}"`
        : `${wholeInches} ${fraction}"`;
  return feet === 0 ? inchPart : `${feet}' ${inchPart}`;
}

export function formatMetric(totalCm: number): string {
  if (!Number.isFinite(totalCm)) return EMPTY_VALUE;
  if (totalCm >= 100) return `${(totalCm / 100).toFixed(2)} m`;
  return `${Math.round(totalCm)} cm`;
}

export function formatLength(
  valueInInches: number,
  system: MeasurementSystem,
): string {
  return system === "metric"
    ? formatMetric(valueInInches * 2.54)
    : formatImperial(valueInInches);
}

export function formatArea(
  squareInches: number,
  system: MeasurementSystem,
): string {
  if (!Number.isFinite(squareInches)) return EMPTY_VALUE;
  if (system === "metric") {
    return `${(squareInches * 0.00064516).toFixed(1)} m²`;
  }
  const squareFeet = squareInches / 144;
  if (squareFeet >= 10) {
    if (squareFeet > 1_000_000_000) return EMPTY_VALUE;
    return `${Math.round(squareFeet)} sq ft`;
  }
  return `${squareFeet.toFixed(1)} sq ft`;
}

// ---------------------------------------------------------------------------
// Readout
// ---------------------------------------------------------------------------

export interface MeasureReadout {
  /** Running total of the drawn segments — null once the loop closes. */
  readonly totalLengthText: string | null;
  /** Segments drawn. Closing adds an implicit edge on top of this. */
  readonly segmentCount: number;
  /** Enclosed area — closed loops only. `—` when the loop self-intersects. */
  readonly areaText: string | null;
  /** Loop perimeter including the closing edge — closed only. */
  readonly perimeterText: string | null;
  readonly isSelfIntersecting: boolean;
}

/** Sum of the drawn segments in real-world inches — no closing edge. */
export function openRunInches(
  points: readonly DeckPoint[],
  scaleFactor: number,
): number {
  if (!(scaleFactor > 0) || points.length < 2) return 0;
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1]!, points[index]!);
  }
  return total / scaleFactor;
}

export function buildMeasureReadout(input: {
  readonly points: readonly DeckPoint[];
  readonly closed: boolean;
  readonly scaleFactor: number;
  readonly system: MeasurementSystem;
}): MeasureReadout {
  const { points, closed, scaleFactor, system } = input;
  const segmentCount = Math.max(0, points.length - 1);
  const isClosedLoop = closed && points.length >= 3;

  if (!(scaleFactor > 0)) {
    return {
      totalLengthText: null,
      segmentCount,
      areaText: isClosedLoop ? EMPTY_VALUE : null,
      perimeterText: isClosedLoop ? EMPTY_VALUE : null,
      isSelfIntersecting: false,
    };
  }

  if (!isClosedLoop) {
    const totalInches = openRunInches(points, scaleFactor);
    return {
      totalLengthText: totalInches > 0 ? formatLength(totalInches, system) : null,
      segmentCount,
      areaText: null,
      perimeterText: null,
      isSelfIntersecting: false,
    };
  }

  const selfIntersecting = isSelfIntersecting(points);
  const perimeterInches = polygonPerimeter(points) / scaleFactor;
  const areaSquareInches = polygonArea(points) / (scaleFactor * scaleFactor);
  return {
    totalLengthText: null,
    segmentCount,
    areaText: selfIntersecting
      ? EMPTY_VALUE
      : formatArea(areaSquareInches, system),
    perimeterText: formatLength(perimeterInches, system),
    isSelfIntersecting: selfIntersecting,
  };
}
