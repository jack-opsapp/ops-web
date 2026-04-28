"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { format } from "date-fns";
import { type InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import { EventHoverPopover } from "../event-hover-popover";

// ─── Types ──────────────────────────────────────────────────────────────────

export type DisplayLevel = "compact" | "standard" | "expanded";

export interface MonthEventBarSpan {
  startDayIndex: number;   // 0-6 within the week
  endDayIndex: number;     // 0-6
  isFirstSegment: boolean; // first week of multi-day
  isLastSegment: boolean;  // last week of multi-day
  isSingleDay: boolean;
}

interface MonthEventBarProps {
  event: InternalCalendarEvent;
  displayLevel: DisplayLevel;
  span: MonthEventBarSpan;
  onClick?: (event: InternalCalendarEvent) => void;
  /**
   * Edge resize callback. dayDelta is signed — positive extends, negative
   * shrinks. Edge "left" pulls the start; edge "right" pushes the end.
   * Caller is responsible for applying the patch (typically via
   * useCalendarResize).
   *
   * Multi-day bars only render the matching handle on the boundary
   * segments: `left` on isFirstSegment, `right` on isLastSegment. Compact
   * (dot) bars render no handles regardless.
   */
  onResize?: (
    event: InternalCalendarEvent,
    edge: "left" | "right",
    dayDelta: number
  ) => void;
}

// 8px hit zone, matches crew-task-block.
const RESIZE_HANDLE_PX = 6;

// ─── Resize hook ────────────────────────────────────────────────────────────

/**
 * Tracks an active edge-drag for a Month event bar. dayDelta is computed by
 * dividing the pixel delta by the parent week row's day-column width (its
 * total width / 7).
 */
function useEdgeResize(
  barRef: React.RefObject<HTMLDivElement | null>,
  onResize:
    | ((
        event: InternalCalendarEvent,
        edge: "left" | "right",
        dayDelta: number
      ) => void)
    | undefined,
  event: InternalCalendarEvent
) {
  const [resize, setResize] = useState<{
    edge: "left" | "right";
    initialX: number;
    deltaPx: number;
  } | null>(null);
  const resizeRef = useRef(resize);
  resizeRef.current = resize;

  // Resolve the day-column width by walking up to the week row (data-attr).
  const resolveDayColumnWidth = useCallback((): number | null => {
    const el = barRef.current;
    if (!el) return null;
    const weekRow = el.closest<HTMLElement>("[data-month-week-row]");
    if (!weekRow) return null;
    const rect = weekRow.getBoundingClientRect();
    return rect.width / 7;
  }, [barRef]);

  const handleResizeStart = useCallback(
    (edge: "left" | "right") => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setResize({ edge, initialX: e.clientX, deltaPx: 0 });
    },
    []
  );

  useEffect(() => {
    if (!resize) return;

    const onMouseMove = (mv: MouseEvent) => {
      setResize((prev) =>
        prev ? { ...prev, deltaPx: mv.clientX - prev.initialX } : null
      );
    };
    const onMouseUp = () => {
      const state = resizeRef.current;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      setResize(null);
      if (!state) return;
      const colWidth = resolveDayColumnWidth();
      if (!colWidth || colWidth <= 0) return;
      const dayDelta = Math.round(state.deltaPx / colWidth);
      if (dayDelta === 0) return;
      onResize?.(event, state.edge, dayDelta);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [resize, resolveDayColumnWidth, onResize, event]);

  // Live preview: snap the deltaPx to integer day units for visual feedback.
  const previewDayDelta = (() => {
    if (!resize) return 0;
    const colWidth = resolveDayColumnWidth();
    if (!colWidth || colWidth <= 0) return 0;
    return Math.round(resize.deltaPx / colWidth);
  })();

  return {
    resize,
    previewDayDelta,
    handleResizeStart,
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MonthEventBar({
  event,
  displayLevel,
  span,
  onClick,
  onResize,
}: MonthEventBarProps) {
  const [isHovered, setIsHovered] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);

  // Status guard — completed/cancelled events are display-only.
  const locked =
    event.statusKey === "completed" || event.statusKey === "cancelled";
  const canResize = !!onResize && !locked && displayLevel !== "compact";

  const { resize, previewDayDelta, handleResizeStart } = useEdgeResize(
    barRef,
    canResize ? onResize : undefined,
    event
  );

  // Spec v2: event bars follow chip radii (4px). Multi-day bars square off
  // the interior corners so consecutive weeks read as one continuous strip.
  const borderRadius = (() => {
    if (span.isSingleDay) return "4px";
    const left = span.isFirstSegment ? "4px" : "0px";
    const right = span.isLastSegment ? "4px" : "0px";
    return `${left} ${right} ${right} ${left}`;
  })();

  const handleClick = (e: React.MouseEvent) => {
    if (resize) return;
    e.stopPropagation();
    onClick?.(event);
  };

  // Resize affordances — only on the boundary segments (first/last) of a
  // multi-day bar. Single-day bars get both.
  const showLeftHandle =
    canResize && (span.isSingleDay || span.isFirstSegment);
  const showRightHandle =
    canResize && (span.isSingleDay || span.isLastSegment);

  // Visual preview during drag — translucent overlay extending or
  // contracting from the active edge by previewDayDelta day-columns. The
  // outer absolute container is one day-column wide on the bar's edge,
  // anchored beyond the bar so growth is visible.
  const renderEdgePreview = (edge: "left" | "right") => {
    if (!resize || resize.edge !== edge || previewDayDelta === 0) return null;
    const grow = previewDayDelta > 0;
    const magnitude = Math.abs(previewDayDelta);

    // For "right" edge: positive grow extends further right (outside the bar);
    //                    negative shrink overlays the bar from the right.
    // For "left" edge:  positive grow extends further left;
    //                    negative shrink overlays from the left.
    const widthCol = `${magnitude * 100}%`;
    const style: React.CSSProperties = {
      position: "absolute",
      top: -2,
      bottom: -2,
      pointerEvents: "none",
      background: grow
        ? `linear-gradient(${edge === "right" ? "90deg" : "270deg"}, ${event.typeColors.bg} 0%, transparent 100%)`
        : "rgba(0,0,0,0.45)",
      border: `1px dashed ${event.typeColors.border}`,
      borderRadius: 4,
      width: widthCol,
      zIndex: 8,
    };
    if (edge === "right") {
      if (grow) style.left = "100%";
      else style.right = 0;
    } else {
      if (grow) style.right = "100%";
      else style.left = 0;
    }
    return <div aria-hidden="true" style={style} />;
  };

  // Resize handle factory — shared shape across display levels.
  const Handle = ({
    edge,
    height,
    barTopOffset = 0,
  }: {
    edge: "left" | "right";
    height: number;
    barTopOffset?: number;
  }) => (
    <div
      onMouseDown={handleResizeStart(edge)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Resize event ${edge === "left" ? "start" : "end"}`}
      role="separator"
      style={{
        position: "absolute",
        [edge]: 0,
        top: barTopOffset,
        height,
        width: RESIZE_HANDLE_PX,
        cursor: "ew-resize",
        zIndex: 10,
        background:
          isHovered || resize
            ? edge === "left"
              ? `linear-gradient(to right, ${event.typeColors.border} 0 2px, transparent 2px)`
              : `linear-gradient(to left, ${event.typeColors.border} 0 2px, transparent 2px)`
            : "transparent",
        transition: "background 0.12s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    />
  );

  // ── Stripe accent — sibling div, NOT box-shadow (avoids crescent at radius corners) ──
  const StripeAccent = (visible: boolean) =>
    visible ? (
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: event.typeColors.border,
          borderRadius: "4px 0 0 4px",
          pointerEvents: "none",
        }}
      />
    ) : null;

  // ── Level 1: Compact — color dot only (no stripe, no handles) ──
  if (displayLevel === "compact") {
    return (
      <EventHoverPopover event={event} side="top">
        <div
          className="cursor-pointer transition-opacity duration-100 hover:opacity-80 shrink-0"
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: event.typeColors.border,
          }}
          onClick={handleClick}
        />
      </EventHoverPopover>
    );
  }

  // ── Level 2: Standard — short bar with single-line title ──
  if (displayLevel === "standard") {
    const showStripe = span.isFirstSegment || span.isSingleDay;
    return (
      <EventHoverPopover event={event} side="top" disabled={!!resize}>
        <div
          ref={barRef}
          className="cursor-pointer truncate relative"
          style={{
            height: 14,
            background: event.typeColors.bg,
            border: `1px solid ${event.typeColors.border}`,
            borderRadius,
            color: event.typeColors.text,
            paddingLeft: showStripe ? 7 : 4,
            paddingRight: 4,
            display: "flex",
            alignItems: "center",
            overflow: "visible",
            transition: "filter 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
            filter: isHovered ? "brightness(1.18)" : "none",
          }}
          onClick={handleClick}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {StripeAccent(showStripe)}
          <span
            className="font-mohave truncate"
            style={{ fontSize: 11, lineHeight: "14px", color: "var(--text)" }}
          >
            {event.projectTitle ?? event.taskTitle}
          </span>
          {showLeftHandle && <Handle edge="left" height={14} />}
          {showRightHandle && <Handle edge="right" height={14} />}
          {renderEdgePreview("left")}
          {renderEdgePreview("right")}
        </div>
      </EventHoverPopover>
    );
  }

  // ── Level 3: Expanded ──

  // Multi-day events stay 14px even at expanded level
  if (!span.isSingleDay) {
    const showStripe = span.isFirstSegment;
    return (
      <EventHoverPopover event={event} side="top" disabled={!!resize}>
        <div
          ref={barRef}
          className="cursor-pointer truncate relative"
          style={{
            height: 14,
            background: event.typeColors.bg,
            border: `1px solid ${event.typeColors.border}`,
            borderRadius,
            color: event.typeColors.text,
            paddingLeft: showStripe ? 7 : 4,
            paddingRight: 4,
            display: "flex",
            alignItems: "center",
            overflow: "visible",
            transition: "filter 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
            filter: isHovered ? "brightness(1.18)" : "none",
          }}
          onClick={handleClick}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {StripeAccent(showStripe)}
          <span
            className="font-mohave truncate"
            style={{ fontSize: 11, lineHeight: "14px", color: "var(--text)" }}
          >
            {event.projectTitle ?? event.taskTitle}
          </span>
          {showLeftHandle && <Handle edge="left" height={14} />}
          {showRightHandle && <Handle edge="right" height={14} />}
          {renderEdgePreview("left")}
          {renderEdgePreview("right")}
        </div>
      </EventHoverPopover>
    );
  }

  // Single-day expanded: 42px tall — show project + client (or fall back to
  // taskTitle subtitle when there's no client). Address lives in the popover.
  const lineTwo: string | null = event.clientName
    ? event.clientName
    : event.projectTitle && event.taskTitle !== event.projectTitle
      ? event.taskTitle
      : null;

  // Phase 3 — show time range only when not all-day
  const timeLabel = event.allDay
    ? null
    : `${format(event.startDate, "HH:mm")} → ${format(event.endDate, "HH:mm")}`;

  return (
    <EventHoverPopover event={event} side="top" disabled={!!resize}>
      <div
        ref={barRef}
        className="cursor-pointer relative"
        style={{
          height: 42,
          background: event.typeColors.bg,
          border: `1px solid ${event.typeColors.border}`,
          borderRadius: "4px",
          color: event.typeColors.text,
          paddingLeft: 9,
          paddingRight: 6,
          paddingTop: 4,
          paddingBottom: 4,
          display: "flex",
          alignItems: "center",
          gap: 8,
          overflow: "visible",
          transition: "filter 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
          filter: isHovered ? "brightness(1.18)" : "none",
        }}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {StripeAccent(true)}

        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <span
            className="font-cakemono font-light uppercase truncate"
            style={{
              fontSize: 12,
              lineHeight: "14px",
              color: "var(--text)",
              letterSpacing: 0,
            }}
          >
            {event.projectTitle ?? event.taskTitle}
          </span>
          {lineTwo && (
            <span
              className="font-mono truncate"
              style={{
                fontSize: 10,
                lineHeight: "12px",
                color: "var(--text-2)",
              }}
            >
              {lineTwo}
            </span>
          )}
        </div>

        {/* Right cluster: optional time + type badge */}
        <div className="flex items-center gap-[5px] shrink-0">
          {timeLabel && (
            <span
              className="font-mono tabular-nums"
              style={{
                fontSize: 10,
                lineHeight: "12px",
                color: "var(--text-3)",
                fontFeatureSettings: '"tnum" 1, "zero" 1',
              }}
            >
              {timeLabel}
            </span>
          )}
          <div
            className="px-[5px] py-[1px] font-cakemono font-light uppercase"
            style={{
              color: event.typeColors.text,
              background: event.typeColors.bg,
              border: `1px solid ${event.typeColors.border}`,
              borderRadius: 4,
              fontSize: 9,
              letterSpacing: "0.04em",
              lineHeight: "12px",
            }}
          >
            {event.typeLabel}
          </div>
        </div>

        {showLeftHandle && <Handle edge="left" height={42} />}
        {showRightHandle && <Handle edge="right" height={42} />}
        {renderEdgePreview("left")}
        {renderEdgePreview("right")}
      </div>
    </EventHoverPopover>
  );
}
