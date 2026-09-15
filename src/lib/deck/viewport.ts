/**
 * OPS Web — deck viewer viewport.
 *
 * A pure reducer over `{ scale, x, y }`, where a content point maps to the
 * screen as `screen = origin + point × scale`. Same anchored-zoom formula the
 * projects canvas uses (`projects/_components/project-canvas-store.ts`):
 * hold the anchor still, move the origin to compensate.
 *
 * Why this is a module and not component state: the whole feel of the viewer —
 * the drawing staying under your finger, a fit that lands centred — is
 * arithmetic, and arithmetic is testable. The component only decides when to
 * call it.
 */

import type { DeckBounds, DeckPoint } from "./drawing-data";

export interface DeckViewport {
  /** Screen pixels per canvas unit. */
  readonly scale: number;
  /** Screen position of the canvas origin. */
  readonly x: number;
  readonly y: number;
}

/** Below this a real deck is a smudge; above it, a plank fills the screen. */
export const MIN_SCALE = 0.15;
export const MAX_SCALE = 8;

/** Fit leaves a 15% margin so the outermost dimension label is never clipped. */
export const FIT_PADDING = 0.85;

export const IDENTITY_VIEWPORT: DeckViewport = { scale: 1, x: 0, y: 0 };

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Zoom by a MULTIPLICATIVE factor about a screen anchor. Multiplicative, not
 * additive, so one wheel notch feels the same at every zoom level — an
 * additive step crawls when zoomed out and lurches when zoomed in.
 */
export function zoomBy(
  viewport: DeckViewport,
  factor: number,
  anchorX: number,
  anchorY: number,
): DeckViewport {
  if (!Number.isFinite(factor) || factor <= 0) return viewport;
  const scale = clampScale(viewport.scale * factor);
  if (scale === viewport.scale) return viewport;
  const ratio = scale / viewport.scale;
  return {
    scale,
    x: anchorX - (anchorX - viewport.x) * ratio,
    y: anchorY - (anchorY - viewport.y) * ratio,
  };
}

/** Translate by a screen-space delta — the drag. */
export function panBy(
  viewport: DeckViewport,
  deltaX: number,
  deltaY: number,
): DeckViewport {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return viewport;
  return { scale: viewport.scale, x: viewport.x + deltaX, y: viewport.y + deltaY };
}

export function toScreen(
  viewport: DeckViewport,
  point: DeckPoint,
): { x: number; y: number } {
  return {
    x: viewport.x + point.x * viewport.scale,
    y: viewport.y + point.y * viewport.scale,
  };
}

export function toContent(
  viewport: DeckViewport,
  screenX: number,
  screenY: number,
): DeckPoint {
  return {
    x: (screenX - viewport.x) / viewport.scale,
    y: (screenY - viewport.y) / viewport.scale,
  };
}

/**
 * Frame the whole drawing, centred, with `padding` of the viewport left as
 * margin. A straight run (zero height) still centres — its degenerate axis
 * simply does not constrain the scale.
 */
export function fitBounds(
  bounds: DeckBounds,
  size: { readonly width: number; readonly height: number },
  padding: number = FIT_PADDING,
): DeckViewport {
  if (!(size.width > 0) || !(size.height > 0)) return IDENTITY_VIEWPORT;

  const scaleX = bounds.width > 0 ? size.width / bounds.width : Infinity;
  const scaleY = bounds.height > 0 ? size.height / bounds.height : Infinity;
  const raw = Math.min(scaleX, scaleY);
  const scale = clampScale(
    Number.isFinite(raw) && raw > 0 ? raw * padding : MAX_SCALE,
  );

  return {
    scale,
    x: (size.width - bounds.width * scale) / 2 - bounds.minX * scale,
    y: (size.height - bounds.height * scale) / 2 - bounds.minY * scale,
  };
}
