"use client";

/**
 * `DeckPlanSvg` — the drawing itself.
 *
 * Intent: a trades owner is reading a deck drawing before a quote or a crew
 * brief. The verb is *read the plan and check a run*, so the drawing gets the
 * whole surface and everything else is a hairline. It should feel like a
 * drafting table, not a slide: pure black ground, 1px geometry that stays 1px
 * at every zoom (`vectorEffect="non-scaling-stroke"`), numbers in mono.
 *
 * Two coordinate spaces, on purpose:
 *   - GEOMETRY lives inside one transformed `<g>`, so pan and zoom are a
 *     single matrix and the browser composites them.
 *   - TEXT and vertex dots live in an untransformed layer positioned through
 *     `toScreen`, so a dimension never stretches and a 2px dot never becomes
 *     a blob. That is also why the surface label re-fits on every zoom: its
 *     size is computed in canvas units and clamped on screen.
 *
 * Pure and stateless — the viewer owns pan, zoom, tools and level isolation.
 */

import { useMemo } from "react";

import {
  fitLabel,
  largestInscribedRect,
  rectCenter,
  SCREEN_FLOOR_PX,
} from "@/lib/deck/label-placement";
import { formatLength } from "@/lib/deck/measure";
import { toScreen, type DeckViewport } from "@/lib/deck/viewport";
import type {
  DeckDrawing,
  DeckEdge,
  DeckLevel,
  DeckPoint,
  DeckSurface,
} from "@/lib/deck/drawing-data";
import type { MeasureState } from "@/lib/deck/measure";
import { cn } from "@/lib/utils/cn";

/**
 * JetBrains Mono advances exactly 0.6em per glyph and sets on a 1.2em line, so
 * text metrics are arithmetic — no canvas measurement, no layout thrash, and
 * the same numbers in a test as in a browser.
 */
const MONO_ADVANCE = 0.6;
const MONO_LINE = 1.2;
const measureMono = (text: string, fontSize: number) => ({
  width: text.length * MONO_ADVANCE * fontSize,
  height: MONO_LINE * fontSize,
});

/**
 * Dimension pills and vertex dots are fixed on screen, never zoomed. These are
 * SVG GEOMETRY inputs, not style literals — each mirrors the token the element
 * is drawn with, so the pill is always exactly as big as its type:
 *   DIMENSION_FONT_PX  = the `micro` type token (11px), applied as `text-micro`
 *   CHIP_RADIUS_PX     = the `chip` radius token (4px)
 *   HAIRLINE_PX        = the design system's 1px hairline
 *   PILL_PAD_*         = the 4px / 2px steps of the 8-point spacing scale
 */
const DIMENSION_FONT_PX = 11;
const CHIP_RADIUS_PX = 4;
const HAIRLINE_PX = 1;
const PILL_PAD_X = 4;
const PILL_PAD_Y = 2;
const VERTEX_RADIUS_PX = 2;
const MEASURE_DOT_RADIUS_PX = 3;

/** A level the operator is not looking at recedes rather than disappearing. */
const DIMMED_LEVEL_OPACITY = 0.25;

/**
 * Level identity is carried by colour ONLY when a design has more than one
 * level — with a single level the colour would mean nothing, so the fill stays
 * the neutral 6%. Each value is a design-system token at its designed alpha.
 */
const LEVEL_FILL_CLASS: Record<string, string> = {
  blue: "fill-ops-accent/12",
  green: "fill-olive-soft",
  amber: "fill-tan-soft",
};
const NEUTRAL_FILL_CLASS = "fill-fill-neutral-dim";

function polygonPath(
  outer: readonly DeckPoint[],
  holes: readonly (readonly DeckPoint[])[],
): string {
  const ring = (points: readonly DeckPoint[]) =>
    points.length === 0
      ? ""
      : `M ${points.map((point) => `${point.x} ${point.y}`).join(" L ")} Z`;
  return [ring(outer), ...holes.map(ring)].filter(Boolean).join(" ");
}

/** Unit vector along an edge, and its left-hand normal. */
function edgeFrame(edge: DeckEdge) {
  const dx = edge.end.x - edge.start.x;
  const dy = edge.end.y - edge.start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  return {
    length,
    ux: dx / length,
    uy: dy / length,
    nx: -dy / length,
    ny: dx / length,
  };
}

/**
 * Stair treads as drawn lines: the run starts on the edge, steps away from the
 * deck's centre (unless the operator flipped it) one tread depth at a time.
 * A stair with no knowable tread count draws its footprint only — the viewer
 * never invents a number of steps.
 */
function StairTreads({
  edge,
  scaleFactor,
  interior,
}: {
  edge: DeckEdge;
  scaleFactor: number;
  interior: DeckPoint;
}) {
  const stair = edge.stair;
  const frame = edgeFrame(edge);
  if (!stair || !frame) return null;

  const widthCanvas = Math.min(stair.width * scaleFactor, frame.length);
  if (!(widthCanvas > 0)) return null;
  const offsetCanvas = stair.offset * scaleFactor;
  const alongStart =
    stair.alignment === "left"
      ? offsetCanvas
      : stair.alignment === "right"
        ? frame.length - widthCanvas - offsetCanvas
        : (frame.length - widthCanvas) / 2;

  // Point the run away from the deck interior, then honour an explicit flip.
  const midX = (edge.start.x + edge.end.x) / 2;
  const midY = (edge.start.y + edge.end.y) / 2;
  const facesInterior =
    frame.nx * (interior.x - midX) + frame.ny * (interior.y - midY) > 0;
  const sign = (facesInterior ? -1 : 1) * (stair.flipDirection ? -1 : 1);

  const treadDepth = stair.runPerTread * scaleFactor;
  const treads = stair.treadCount ?? 0;
  const runDepth = treads > 0 ? treads * treadDepth : treadDepth;

  const at = (along: number, out: number): DeckPoint => ({
    x: edge.start.x + frame.ux * along + frame.nx * out * sign,
    y: edge.start.y + frame.uy * along + frame.ny * out * sign,
  });

  const corners = [
    at(alongStart, 0),
    at(alongStart + widthCanvas, 0),
    at(alongStart + widthCanvas, runDepth),
    at(alongStart, runDepth),
  ];

  return (
    <g data-testid="deck-stair" data-edge-id={edge.id}>
      <path
        d={polygonPath(corners, [])}
        className="fill-none stroke-text-3"
        strokeWidth={HAIRLINE_PX}
        vectorEffect="non-scaling-stroke"
      />
      {Array.from({ length: Math.max(treads - 1, 0) }, (_, index) => {
        const depth = (index + 1) * treadDepth;
        const a = at(alongStart, depth);
        const b = at(alongStart + widthCanvas, depth);
        return (
          <line
            key={index}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            className="stroke-text-3"
            strokeWidth={HAIRLINE_PX}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
}

function levelInterior(level: DeckLevel): DeckPoint {
  const points =
    level.surfaces[0]?.outer ?? level.fallbackOutline ?? level.vertices.map((v) => v.position);
  if (points.length === 0) return { x: 0, y: 0 };
  return {
    x: points.reduce((total, point) => total + point.x, 0) / points.length,
    y: points.reduce((total, point) => total + point.y, 0) / points.length,
  };
}

function LevelGeometry({
  level,
  fillClass,
  scaleFactor,
}: {
  level: DeckLevel;
  fillClass: string;
  scaleFactor: number;
}) {
  const interior = useMemo(() => levelInterior(level), [level]);
  const regions: Array<{ id: string; path: string }> = level.surfaces.map(
    (surface: DeckSurface) => ({
      id: surface.id,
      path: polygonPath(surface.outer, surface.holes),
    }),
  );
  if (regions.length === 0 && level.fallbackOutline) {
    regions.push({
      id: `${level.id}:outline`,
      path: polygonPath(level.fallbackOutline, []),
    });
  }

  return (
    <g data-testid="deck-level" data-level-id={level.id}>
      {regions.map((region) => (
        <path
          key={region.id}
          data-testid="deck-surface"
          d={region.path}
          fillRule="evenodd"
          className={cn(fillClass, "stroke-none")}
        />
      ))}

      {level.edges.map((edge) => (
        <line
          key={edge.id}
          data-testid="deck-edge"
          data-edge-role={edge.boundaryRole}
          x1={edge.start.x}
          y1={edge.start.y}
          x2={edge.end.x}
          y2={edge.end.y}
          className={
            edge.boundaryRole === "house"
              ? "stroke-text-3"
              : edge.boundaryRole === "wall"
                ? "stroke-text"
                : "stroke-text-2"
          }
          strokeWidth={edge.boundaryRole === "wall" ? 1.5 : 1}
          strokeLinecap="round"
          strokeDasharray={edge.boundaryRole === "house" ? "4 3" : undefined}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {level.edges.map((edge) =>
        edge.stair ? (
          <StairTreads
            key={`stair-${edge.id}`}
            edge={edge}
            scaleFactor={scaleFactor}
            interior={interior}
          />
        ) : null,
      )}
    </g>
  );
}

/** A dimension: mono value on a glass pill, the operator's own note beneath. */
function DimensionLabel({
  edge,
  viewport,
  system,
}: {
  edge: DeckEdge;
  viewport: DeckViewport;
  system: DeckDrawing["measurementSystem"];
}) {
  if (edge.dimensionInches === null) return null;
  const value = formatLength(edge.dimensionInches, system);
  const center = toScreen(viewport, {
    x: (edge.start.x + edge.end.x) / 2,
    y: (edge.start.y + edge.end.y) / 2,
  });
  const size = measureMono(value, DIMENSION_FONT_PX);
  const width = size.width + PILL_PAD_X * 2;
  const height = size.height + PILL_PAD_Y * 2;

  return (
    <g data-testid="deck-dimension" data-edge-id={edge.id}>
      <rect
        x={center.x - width / 2}
        y={center.y - height / 2}
        width={width}
        height={height}
        rx={CHIP_RADIUS_PX}
        className={cn(
          // An OVERRIDDEN dimension wears the tan attention wash, exactly as
          // iOS does it (`DeckStaleDimensionPresenter`): the operator typed a
          // length and then moved the drawing, and only they can settle it.
          edge.dimensionStale
            ? "fill-tan-soft stroke-tan-line"
            : "fill-glass-dense stroke-border",
        )}
        strokeWidth={HAIRLINE_PX}
      />
      <text
        x={center.x}
        y={center.y}
        textAnchor="middle"
        dominantBaseline="central"
        className={cn(
          "font-mono text-micro tabular-nums",
          "[font-feature-settings:'tnum'_1,'zero'_1]",
          edge.dimensionStale ? "fill-tan" : "fill-text-2",
        )}
      >
        {value}
      </text>
      {edge.label && (
        <text
          x={center.x}
          y={center.y + height / 2 + PILL_PAD_Y}
          textAnchor="middle"
          dominantBaseline="hanging"
          className="fill-text-3 font-mono text-micro uppercase tracking-authority"
        >
          {edge.label}
        </text>
      )}
    </g>
  );
}

/**
 * A surface label sits at the centre of the largest rectangle that fits inside
 * its surface and grows to fill it — so it is legible at fit zoom without
 * ever crossing an edge. Screen size is clamped to 11–28px.
 */
function SurfaceLabel({
  surface,
  viewport,
}: {
  surface: DeckSurface;
  viewport: DeckViewport;
}) {
  const placement = useMemo(() => {
    const rect = largestInscribedRect(surface.outer, surface.holes);
    if (!rect || !surface.label) return null;
    const fit = fitLabel({
      text: surface.label,
      rect,
      canvasScale: viewport.scale,
      padding: 4,
      measure: measureMono,
    });
    return { center: rectCenter(rect), fit };
  }, [surface.outer, surface.holes, surface.label, viewport.scale]);

  if (!placement) return null;
  const center = toScreen(viewport, placement.center);
  const screenFont = Math.max(
    placement.fit.fontSize * viewport.scale,
    SCREEN_FLOOR_PX,
  );
  const width = placement.fit.size.width * viewport.scale + PILL_PAD_X * 2;
  const height = placement.fit.size.height * viewport.scale + PILL_PAD_Y * 2;

  return (
    <g data-testid="deck-surface-label" data-surface-id={surface.id}>
      <rect
        x={center.x - width / 2}
        y={center.y - height / 2}
        width={width}
        height={height}
        rx={CHIP_RADIUS_PX}
        className="fill-glass-dense stroke-border"
        strokeWidth={HAIRLINE_PX}
      />
      <text
        x={center.x}
        y={center.y}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-text font-mono"
        fontSize={screenFont}
      >
        {placement.fit.text}
      </text>
    </g>
  );
}

/** The measure polyline — tan, because it is the operator's own mark. */
function MeasureOverlay({
  measure,
  viewport,
}: {
  measure: MeasureState;
  viewport: DeckViewport;
}) {
  if (measure.points.length === 0) return null;
  const screen = measure.points.map((point) => toScreen(viewport, point));
  const path = screen.map((point) => `${point.x} ${point.y}`).join(" L ");
  const closed = measure.phase === "closed" && screen.length >= 3;

  return (
    <g data-testid="deck-measure" data-measure-phase={measure.phase}>
      {screen.length >= 2 && (
        <path
          d={`M ${path}${closed ? " Z" : ""}`}
          className="fill-none stroke-tan"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {screen.map((point, index) => (
        <circle
          key={index}
          cx={point.x}
          cy={point.y}
          r={MEASURE_DOT_RADIUS_PX}
          className="fill-tan"
        />
      ))}
    </g>
  );
}

export interface DeckPlanSvgProps {
  drawing: DeckDrawing;
  viewport: DeckViewport;
  width: number;
  height: number;
  /** Dimension pills and surface labels. Off de-clutters a busy plan. */
  showLabels: boolean;
  /** When set, every other level recedes to 25%. */
  isolatedLevelId: string | null;
  measure?: MeasureState;
  className?: string;
}

export function DeckPlanSvg({
  drawing,
  viewport,
  width,
  height,
  showLabels,
  isolatedLevelId,
  measure,
  className,
}: DeckPlanSvgProps) {
  const transform = `translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`;
  const visibleLevels = drawing.levels.filter(
    (level) => isolatedLevelId === null || level.id === isolatedLevelId,
  );

  return (
    <svg
      data-testid="deck-plan-svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("block select-none", className)}
      aria-hidden="true"
      focusable="false"
    >
      <g data-testid="deck-plan-transform" transform={transform}>
        {drawing.levels.map((level) => {
          const dimmed =
            isolatedLevelId !== null && isolatedLevelId !== level.id;
          return (
          <g
            key={level.id}
            data-testid="deck-level-group"
            data-level-id={level.id}
            data-dimmed={dimmed ? "true" : "false"}
            opacity={dimmed ? DIMMED_LEVEL_OPACITY : 1}
          >
            <LevelGeometry
              level={level}
              scaleFactor={drawing.scaleFactor}
              fillClass={
                drawing.isMultiLevel && level.displayColor
                  ? (LEVEL_FILL_CLASS[level.displayColor] ?? NEUTRAL_FILL_CLASS)
                  : NEUTRAL_FILL_CLASS
              }
            />
          </g>
          );
        })}
      </g>

      {/* Screen-space layer: dots and type never scale with the drawing. */}
      <g>
        {visibleLevels.flatMap((level) =>
          level.vertices.map((vertex) => {
            const point = toScreen(viewport, vertex.position);
            return (
              <circle
                key={`${level.id}:${vertex.id}`}
                data-testid="deck-vertex"
                cx={point.x}
                cy={point.y}
                r={VERTEX_RADIUS_PX}
                className="fill-text-3"
              />
            );
          }),
        )}

        {showLabels &&
          visibleLevels.flatMap((level) =>
            level.edges.map((edge) => (
              <DimensionLabel
                key={`${level.id}:${edge.id}`}
                edge={edge}
                viewport={viewport}
                system={drawing.measurementSystem}
              />
            )),
          )}

        {showLabels &&
          visibleLevels.flatMap((level) =>
            level.surfaces.map((surface) => (
              <SurfaceLabel
                key={`${level.id}:${surface.id}`}
                surface={surface}
                viewport={viewport}
              />
            )),
          )}

        {measure && <MeasureOverlay measure={measure} viewport={viewport} />}
      </g>
    </svg>
  );
}
