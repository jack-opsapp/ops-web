"use client";

/**
 * DeckWireframe — hairline blueprint render of a deck design's outline,
 * straight from the iOS designer's vertices/edges. Monochrome, inherits
 * `currentColor` from the parent (text-2 in the card glyph, text in the
 * viewer), non-scaling 1.25px strokes so it stays a hairline at any size.
 *
 * Callers gate on {@link buildWireframeModel} returning non-null and fall
 * back to the raster thumbnail or an icon — this component only ever sees a
 * valid model.
 */

import type { WireframeModel } from "@/lib/utils/deck-wireframe";

export function DeckWireframe({
  model,
  className,
}: {
  model: WireframeModel;
  className?: string;
}) {
  return (
    <svg
      viewBox={model.viewBox}
      className={className}
      aria-hidden="true"
      focusable="false"
      data-testid="deck-wireframe"
    >
      {model.segments.map((s, i) => (
        <line
          key={i}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke="currentColor"
          strokeWidth={1.25}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
