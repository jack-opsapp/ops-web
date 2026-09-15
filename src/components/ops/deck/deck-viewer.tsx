"use client";

/**
 * `DeckViewer` — the deck drawing, fullscreen.
 *
 * Intent (interface-design): the human is a trades owner at a desk, or on a
 * tablet in the truck, checking a deck drawing before a quote or a crew brief.
 * The verb is *read the drawing and check a run* — so the drawing gets the
 * entire screen on pure black and every control is a hairline at the edge.
 * It should feel like a drafting table, not a slide deck.
 *
 * Rejected defaults, and why:
 *   - a modal card with a picture in it → the drawing is the content; boxing it
 *     at 720px was the original bug (`b130d23f`). Fullscreen, always.
 *   - +/− zoom buttons → a drawing is read by moving it. Wheel, drag and pinch
 *     zoom about the point under the cursor; the rail carries only the things
 *     a pointer cannot do: fit, measure, labels, levels, 2D/3D.
 *   - a permanent measurement panel → measuring is occasional. The readout
 *     exists only while MEASURE is on, and taking it off clears the run.
 *   - colour as decoration → monochrome, except the per-level `displayColor`
 *     at low alpha when a design has more than one level (there the colour is
 *     information: which level) and tan on the measure line and on a dimension
 *     the operator has overridden (attention, matching iOS).
 *
 * Motion (animation-architect): pan and zoom are a Discovery beat — they must
 * be immediate and unanimated, because the drawing has to track the hand. FIT
 * is a Transition beat: 250ms `EASE_SMOOTH`, and instant under reduced motion.
 * The rail recedes to `text-mute` while a pointer is down so nothing competes
 * with the drawing while it is being moved.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  Layers,
  Maximize,
  Ruler,
  Tag,
  Undo2,
  X,
} from "lucide-react";

import { useDictionary } from "@/i18n/client";
import { useDeckDesignDrawing } from "@/lib/hooks/use-deck-design-drawing";
import { parseDeckDrawing, type DeckDrawing, type DeckPoint } from "@/lib/deck/drawing-data";
import {
  buildMeasureReadout,
  clearMeasure,
  EMPTY_MEASURE,
  recordMeasureTap,
  snapToVertex,
  undoMeasurePoint,
  type MeasureState,
} from "@/lib/deck/measure";
import {
  fitBounds,
  IDENTITY_VIEWPORT,
  panBy,
  toContent,
  zoomBy,
  type DeckViewport,
} from "@/lib/deck/viewport";
import { formatDate } from "@/lib/utils/date";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { cn } from "@/lib/utils/cn";

import { DeckPlanSvg } from "./deck-plan-svg";
import { DeckScene3DSlot } from "./deck-scene-3d-slot";

/** A wheel notch is a fixed RATIO, so one notch feels the same at every zoom. */
const WHEEL_ZOOM_PER_PIXEL = 0.0015;
/** Snap radius, in screen pixels — divided by the scale to reach canvas units. */
const SNAP_RADIUS_PX = 12;
/** A drag under this many pixels is a tap, not a pan. */
const TAP_SLOP_PX = 4;
/** jsdom and the first paint report a zero box; a fullscreen pane is the window. */
const FALLBACK_SIZE = { width: 1024, height: 768 };

type ViewerMode = "2d" | "3d";

interface PointerRun {
  readonly id: number;
  readonly startX: number;
  readonly startY: number;
  x: number;
  y: number;
  moved: boolean;
}

export interface DeckViewerProps {
  /** The design to read. Its drawing is fetched here, not by the caller. */
  designId: string;
  /** Identity the caller already has, so the bar fills in before the fetch. */
  title: string;
  version: number;
  stamp: Date | null;
  onClose: () => void;
}

export function DeckViewer({
  designId,
  title,
  version,
  stamp,
  onClose,
}: DeckViewerProps) {
  const { t } = useDictionary("pipeline");
  const reduceMotion = useReducedMotion();
  const { data, isLoading } = useDeckDesignDrawing(designId);

  const drawingData = data?.drawingData;
  const drawing = useMemo<DeckDrawing | null>(
    () => (drawingData === undefined ? null : parseDeckDrawing(drawingData)),
    [drawingData],
  );

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState(FALLBACK_SIZE);
  const [viewport, setViewport] = useState<DeckViewport>(IDENTITY_VIEWPORT);
  const [mode, setMode] = useState<ViewerMode>("2d");
  const [showLabels, setShowLabels] = useState(true);
  const [measuring, setMeasuring] = useState(false);
  const [measure, setMeasure] = useState<MeasureState>(EMPTY_MEASURE);
  const [isolatedIndex, setIsolatedIndex] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, PointerRun>());
  const pinchDistance = useRef<number | null>(null);

  // ── Sizing ───────────────────────────────────────────────────────────────
  // The drawing surface is measured, not assumed: the pane is fullscreen, but
  // the top bar takes a slice off it and the rail overlays the right edge.
  useEffect(() => {
    const measureSurface = () => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      const width = rect?.width || window.innerWidth || FALLBACK_SIZE.width;
      const height = rect?.height || window.innerHeight || FALLBACK_SIZE.height;
      setSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    };
    measureSurface();
    window.addEventListener("resize", measureSurface);
    return () => window.removeEventListener("resize", measureSurface);
  }, []);

  // ── Fit ──────────────────────────────────────────────────────────────────
  const fittedViewport = useMemo(
    () => (drawing?.bounds ? fitBounds(drawing.bounds, size) : IDENTITY_VIEWPORT),
    [drawing?.bounds, size],
  );

  // The drawing arrives framed, and a resized window re-frames it — but only
  // while the operator has not moved it themselves. Once they have panned or
  // zoomed, the view is theirs and nothing takes it back except FIT.
  //
  // The guard is on the fit's VALUE, not its object identity: a caller that
  // hands back a fresh drawing object on every render (a refetch, a test
  // double) must not be able to spin this into a render loop.
  const fitSignature = `${fittedViewport.scale}|${fittedViewport.x}|${fittedViewport.y}`;
  const appliedFit = useRef<string | null>(null);
  const operatorMoved = useRef(false);
  useEffect(() => {
    if (appliedFit.current === fitSignature) return;
    appliedFit.current = fitSignature;
    if (!operatorMoved.current) setViewport(fittedViewport);
  }, [fitSignature, fittedViewport]);

  const fit = useCallback(() => {
    operatorMoved.current = false;
    appliedFit.current = fitSignature;
    setViewport(fittedViewport);
  }, [fittedViewport, fitSignature]);

  /** Any deliberate move by the operator takes the view out of auto-fit. */
  const markMoved = useCallback(() => {
    operatorMoved.current = true;
  }, []);

  // ── Escape ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // ── Levels ───────────────────────────────────────────────────────────────
  const levels = drawing?.levels ?? [];
  const isolatedLevel =
    isolatedIndex !== null ? (levels[isolatedIndex] ?? null) : null;

  const cycleLevels = useCallback(() => {
    setIsolatedIndex((current) => {
      if (current === null) return 0;
      const next = current + 1;
      return next >= levels.length ? null : next;
    });
  }, [levels.length]);

  // ── Measure ──────────────────────────────────────────────────────────────
  const snapCandidates = useMemo(
    () =>
      (isolatedLevel ? [isolatedLevel] : levels).flatMap((level) =>
        level.vertices.map((vertex) => vertex.position),
      ),
    [levels, isolatedLevel],
  );

  const placeMeasurePoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      const point = toContent(
        viewport,
        clientX - (rect?.left ?? 0),
        clientY - (rect?.top ?? 0),
      );
      // The snap radius is a CONSTANT ON SCREEN: 12px at any zoom, which is
      // what makes corner-to-corner measuring possible with a mouse.
      const radius = SNAP_RADIUS_PX / viewport.scale;
      setMeasure(
        (current) =>
          recordMeasureTap(current, {
            point,
            closeThreshold: radius,
            snap: (candidate: DeckPoint) =>
              snapToVertex(candidate, snapCandidates, radius),
          }).state,
      );
    },
    [viewport, snapCandidates],
  );

  const toggleMeasure = useCallback(() => {
    setMeasuring((current) => {
      if (current) setMeasure(clearMeasure());
      return !current;
    });
  }, []);

  const readout = useMemo(
    () =>
      drawing
        ? buildMeasureReadout({
            points: measure.points,
            closed: measure.phase === "closed",
            scaleFactor: drawing.scaleFactor,
            system: drawing.measurementSystem,
          })
        : null,
    [drawing, measure],
  );

  // ── Pointer ──────────────────────────────────────────────────────────────
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      pointers.current.set(event.pointerId, {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      });
      setDragging(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const run = pointers.current.get(event.pointerId);
      if (!run) return;
      const dx = event.clientX - run.x;
      const dy = event.clientY - run.y;
      run.x = event.clientX;
      run.y = event.clientY;
      if (
        Math.hypot(event.clientX - run.startX, event.clientY - run.startY) >
        TAP_SLOP_PX
      ) {
        run.moved = true;
      }

      const runs = [...pointers.current.values()];
      if (runs.length >= 2) {
        // Two fingers: zoom about the midpoint, the same anchor rule as the
        // wheel. Pinch beats pan while both are down.
        const [a, b] = runs;
        const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const previous = pinchDistance.current;
        pinchDistance.current = distance;
        if (previous && previous > 0 && distance > 0) {
          const rect = surfaceRef.current?.getBoundingClientRect();
          markMoved();
          setViewport((current) =>
            zoomBy(
              current,
              distance / previous,
              (a!.x + b!.x) / 2 - (rect?.left ?? 0),
              (a!.y + b!.y) / 2 - (rect?.top ?? 0),
            ),
          );
        }
        return;
      }

      // Measuring freezes the drawing: a tap that wanders must not drag the
      // plan out from under the point being placed.
      if (measuring) return;
      markMoved();
      setViewport((current) => panBy(current, dx, dy));
    },
    [measuring, markMoved],
  );

  const endPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const run = pointers.current.get(event.pointerId);
      pointers.current.delete(event.pointerId);
      if (pointers.current.size < 2) pinchDistance.current = null;
      if (pointers.current.size === 0) setDragging(false);
      if (run && !run.moved && measuring) {
        placeMeasurePoint(event.clientX, event.clientY);
      }
    },
    [measuring, placeMeasurePoint],
  );

  const onWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    // Scrolling UP (negative deltaY) zooms in, the convention every map and
    // drawing tool shares.
    const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_PER_PIXEL);
    markMoved();
    setViewport((current) =>
      zoomBy(
        current,
        factor,
        event.clientX - (rect?.left ?? 0),
        event.clientY - (rect?.top ?? 0),
      ),
    );
  }, [markMoved]);

  const stamped = `V${version}${stamp ? ` · ${formatDate(stamp, "MMM d")}` : ""}`;
  const hasGeometry = !!drawing && drawing.levels.length > 0;

  const body = (
    <div
      data-testid="deck-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[3000] flex flex-col bg-background"
    >
      {/* ── Top bar: what this is, and the two ways to leave it ── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-glass-dense px-2 py-1">
        <span className="min-w-0 truncate font-cakemono text-cake-section uppercase text-text">
          {title}
        </span>
        <span
          data-testid="deck-viewer-stamp"
          className="shrink-0 font-mono text-micro tabular-nums text-text-mute [font-feature-settings:'tnum'_1,'zero'_1]"
        >
          {stamped}
        </span>

        <span className="flex-1" />

        <div
          role="radiogroup"
          aria-label={t("deck.viewer.modeAria", "Plan or massing")}
          className="flex items-stretch gap-0.5 rounded border border-border p-0.5"
        >
          {(["2d", "3d"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={mode === option}
              onClick={() => setMode(option)}
              className={cn(
                "min-w-[40px] px-1 font-mono text-micro uppercase tracking-authority",
                "rounded-bar transition-colors duration-150",
                mode === option
                  ? "bg-surface-active text-text"
                  : "text-text-3 hover:text-text-2",
              )}
            >
              {t(`deck.viewer.mode${option === "2d" ? "2d" : "3d"}`, option.toUpperCase())}
            </button>
          ))}
        </div>

        <RailButton
          label={t("deck.viewer.close", "Close")}
          onClick={onClose}
          icon={<X className="h-icon-16 w-icon-16" strokeWidth={1.75} />}
          dimmed={dragging}
        />
      </div>

      {/* ── The drawing ── */}
      <div
        ref={surfaceRef}
        data-testid="deck-viewer-surface"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onWheel={onWheel}
        onDoubleClick={fit}
        className={cn(
          "relative min-h-0 flex-1 touch-none overflow-hidden bg-background",
          measuring ? "cursor-crosshair" : dragging ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        {isLoading && !drawing ? (
          <EmptyPane testId="deck-viewer-loading">
            {t("deck.viewer.loading", "Loading drawing")}
          </EmptyPane>
        ) : !hasGeometry ? (
          <EmptyPane
            testId="deck-viewer-empty"
            detail={t(
              "deck.viewer.emptyDetail",
              "This design has no finished shape yet. Close the outline on the phone and it will draw here.",
            )}
          >
            {t("deck.viewer.empty", "[ no closed outline ]")}
          </EmptyPane>
        ) : mode === "3d" ? (
          <DeckScene3DSlot drawing={drawing!} isolatedLevelId={isolatedLevel?.id ?? null} />
        ) : (
          <DeckPlanSvg
            drawing={drawing!}
            viewport={viewport}
            width={size.width}
            height={size.height}
            showLabels={showLabels}
            isolatedLevelId={isolatedLevel?.id ?? null}
            measure={measuring ? measure : undefined}
          />
        )}

        {/* ── Tool rail: only what a pointer cannot already do ── */}
        {hasGeometry && (
          <div className="absolute right-1.5 top-1.5 flex flex-col gap-0.5">
            <RailButton
              label={t("deck.viewer.fitAria", "Fit drawing to screen")}
              onClick={fit}
              icon={<Maximize className="h-icon-16 w-icon-16" strokeWidth={1.75} />}
              dimmed={dragging}
            />
            <RailButton
              label={t("deck.viewer.measureAria", "Measure a run")}
              onClick={toggleMeasure}
              pressed={measuring}
              icon={<Ruler className="h-icon-16 w-icon-16" strokeWidth={1.75} />}
              dimmed={dragging}
            />
            <RailButton
              label={t(
                "deck.viewer.labelsAria",
                "Show dimensions and surface labels",
              )}
              onClick={() => setShowLabels((current) => !current)}
              pressed={showLabels}
              icon={<Tag className="h-icon-16 w-icon-16" strokeWidth={1.75} />}
              dimmed={dragging}
            />
            {drawing!.isMultiLevel && (
              <RailButton
                label={t("deck.viewer.levelsAria", "Isolate one level")}
                onClick={cycleLevels}
                pressed={isolatedIndex !== null}
                icon={<Layers className="h-icon-16 w-icon-16" strokeWidth={1.75} />}
                dimmed={dragging}
              />
            )}
          </div>
        )}

        {/* Which level is isolated — named, because "level 2" means nothing. */}
        {drawing?.isMultiLevel && (
          <div
            data-testid="deck-viewer-levels"
            className="pointer-events-none absolute left-1.5 top-1.5 rounded-chip border border-border bg-glass-dense px-1 py-0.5 font-mono text-micro uppercase tracking-authority text-text-3"
          >
            {isolatedLevel
              ? (isolatedLevel.name ?? t("deck.viewer.levels", "Levels"))
              : t("deck.viewer.allLevels", "All")}
          </div>
        )}

        {/* The readout FADES IN (a Transition beat — it is new information)
            but leaves instantly: its disappearance is the operator's own click,
            and chrome never lingers over the drawing. */}
        {measuring && readout && (
          <motion.div
            data-testid="deck-measure-readout"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{
              duration: reduceMotion ? 0 : 0.25,
              ease: EASE_SMOOTH,
            }}
            className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-panel border border-border bg-glass-dense px-2 py-1"
          >
              {readout.areaText === null ? (
                <Readout
                  label={t("deck.viewer.length", "Length")}
                  value={readout.totalLengthText}
                />
              ) : (
                <>
                  <Readout
                    label={t("deck.viewer.area", "Area")}
                    value={readout.areaText}
                  />
                  <Readout
                    label={t("deck.viewer.perimeter", "Perimeter")}
                    value={readout.perimeterText}
                  />
                </>
              )}
              <Readout
                label={t("deck.viewer.segments", "Segments")}
                value={String(readout.segmentCount)}
              />
              <button
                type="button"
                aria-label={t("deck.viewer.undo", "Undo last point")}
                onClick={() => setMeasure(undoMeasurePoint)}
                className="text-text-3 transition-colors hover:text-text-2 focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ops-accent"
              >
              <Undo2 className="h-icon-16 w-icon-16" strokeWidth={1.75} />
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );

  if (typeof document === "undefined") return body;
  return createPortal(body, document.body);
}

/** A rail control: 36px, hairline, never accented — the drawing is the subject. */
function RailButton({
  label,
  icon,
  onClick,
  pressed,
  dimmed,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  pressed?: boolean;
  dimmed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      onClick={onClick}
      className={cn(
        "flex h-control-36 w-control-36 items-center justify-center rounded border",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ops-accent",
        pressed
          ? "border-border-medium bg-surface-active text-text"
          : "border-border-subtle text-text-3 hover:text-text-2",
        // While the drawing is being moved, the chrome gets out of its way.
        dimmed && !pressed && "text-text-mute",
      )}
    >
      {icon}
    </button>
  );
}

/** One measured value: uppercase mono label, mono value, em dash when absent. */
function Readout({ label, value }: { label: string; value: string | null }) {
  return (
    <span className="flex items-baseline gap-0.5">
      <span className="font-mono text-micro uppercase tracking-authority text-text-3">
        {label}
      </span>
      <span className="font-mono text-data-sm tabular-nums text-text [font-feature-settings:'tnum'_1,'zero'_1]">
        {value ?? "—"}
      </span>
    </span>
  );
}

function EmptyPane({
  testId,
  children,
  detail,
}: {
  testId: string;
  children: React.ReactNode;
  detail?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex h-full w-full flex-col items-center justify-center gap-1 px-3 text-center"
    >
      <span className="font-mono text-micro uppercase tracking-authority text-text-3">
        {children}
      </span>
      {detail && (
        <span className="max-w-[320px] font-mohave text-caption text-text-mute">
          {detail}
        </span>
      )}
    </div>
  );
}
