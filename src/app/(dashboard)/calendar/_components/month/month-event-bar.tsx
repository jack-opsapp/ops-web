"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { Star } from "lucide-react";
import { type InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import { useCalendarStore } from "@/stores/calendar-store";
import { EventHoverPopover } from "../event-hover-popover";

// Personal events ride on the same color pool as task types, which makes
// them visually indistinguishable from any task type using the same color.
// Override their visual treatment: outline-only chip with a star icon and
// white text/border — distinct from any task-type bar regardless of color.
const PERSONAL_BG = "rgba(255, 255, 255, 0.04)";
const PERSONAL_BORDER = "rgba(255, 255, 255, 0.55)";
const PERSONAL_TEXT = "#FFFFFF";

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
    initialY: number;
    clientX: number;
    clientY: number;
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

  // Find the calendar day under a (clientX, clientY) cursor position by
  // hit-testing every rendered week row in the document. Returns the date
  // representing the day cell directly under the cursor, or null when the
  // cursor sits outside any week row (e.g. above/below the calendar).
  //
  // This is what enables vertical-row crossing during resize: the user can
  // drag the right edge down into the next week's row and the bar will
  // extend by a full week (or more), instead of only tracking horizontal
  // pixel delta on the original row.
  const resolveDayUnderCursor = useCallback(
    (clientX: number, clientY: number): Date | null => {
      const el = barRef.current;
      if (!el) return null;
      const ownerDoc = el.ownerDocument ?? document;
      const rows = Array.from(
        ownerDoc.querySelectorAll<HTMLElement>("[data-month-week-row]")
      );
      if (rows.length === 0) return null;

      // 1) Find the row whose vertical bounds contain clientY. If the cursor
      //    sits above the top row or below the bottom row, snap to the
      //    nearest row so an aggressive drag past the calendar still lands.
      let chosenRow: HTMLElement | null = null;
      let chosenRect: DOMRect | null = null;
      for (const row of rows) {
        const r = row.getBoundingClientRect();
        if (clientY >= r.top && clientY <= r.bottom) {
          chosenRow = row;
          chosenRect = r;
          break;
        }
      }
      if (!chosenRow || !chosenRect) {
        // Snap to closest by vertical distance.
        let bestDist = Infinity;
        for (const row of rows) {
          const r = row.getBoundingClientRect();
          const center = (r.top + r.bottom) / 2;
          const dist = Math.abs(clientY - center);
          if (dist < bestDist) {
            bestDist = dist;
            chosenRow = row;
            chosenRect = r;
          }
        }
      }
      if (!chosenRow || !chosenRect) return null;

      const weekStartAttr = chosenRow.getAttribute("data-week-start");
      if (!weekStartAttr) return null;
      let weekStart: Date;
      try {
        weekStart = parseISO(weekStartAttr);
        if (Number.isNaN(weekStart.getTime())) return null;
      } catch {
        return null;
      }

      // 2) Within the chosen row, compute column index 0..6 from clientX.
      const colWidth = chosenRect.width / 7;
      if (!colWidth || colWidth <= 0) return null;
      const offsetX = Math.max(
        0,
        Math.min(chosenRect.width - 1, clientX - chosenRect.left)
      );
      const colIdx = Math.max(0, Math.min(6, Math.floor(offsetX / colWidth)));
      return addDays(weekStart, colIdx);
    },
    [barRef]
  );

  const handleResizeStart = useCallback(
    (edge: "left" | "right") => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setResize({
        edge,
        initialX: e.clientX,
        initialY: e.clientY,
        clientX: e.clientX,
        clientY: e.clientY,
      });
    },
    []
  );

  useEffect(() => {
    if (!resize) return;

    const onMouseMove = (mv: MouseEvent) => {
      setResize((prev) =>
        prev ? { ...prev, clientX: mv.clientX, clientY: mv.clientY } : null
      );
    };
    const onMouseUp = () => {
      const state = resizeRef.current;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      setResize(null);
      if (!state) return;

      // Two-pass commit:
      // 1) Preferred path — locate the day cell directly under the cursor
      //    and compute dayDelta as the absolute calendar difference between
      //    that target day and the edge being dragged. This is what makes
      //    vertical row-crossing work (extend +1 week by dragging into the
      //    row below).
      // 2) Fallback — if the cursor is somehow outside any rendered week
      //    row, fall back to the legacy horizontal pixel-to-day calculation
      //    so a single-row resize still commits.
      const targetDay = resolveDayUnderCursor(state.clientX, state.clientY);
      if (targetDay) {
        const anchor =
          state.edge === "right" ? event.endDate : event.startDate;
        const dayDelta = differenceInCalendarDays(targetDay, anchor);
        if (dayDelta === 0) return;
        onResize?.(event, state.edge, dayDelta);
        return;
      }

      const colWidth = resolveDayColumnWidth();
      if (!colWidth || colWidth <= 0) return;
      const deltaPx = state.clientX - state.initialX;
      const dayDelta = Math.round(deltaPx / colWidth);
      if (dayDelta === 0) return;
      onResize?.(event, state.edge, dayDelta);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [resize, resolveDayColumnWidth, resolveDayUnderCursor, onResize, event]);

  // Live preview: derive integer day delta from the cursor's position in the
  // calendar. Mirrors the commit logic so the dashed overlay matches what
  // will land on mouse-up — including row-crossing extensions.
  const previewDayDelta = (() => {
    if (!resize) return 0;
    const targetDay = resolveDayUnderCursor(resize.clientX, resize.clientY);
    if (targetDay) {
      const anchor = resize.edge === "right" ? event.endDate : event.startDate;
      return differenceInCalendarDays(targetDay, anchor);
    }
    const colWidth = resolveDayColumnWidth();
    if (!colWidth || colWidth <= 0) return 0;
    return Math.round((resize.clientX - resize.initialX) / colWidth);
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

  // Personal events render with a distinct white-outline + star treatment
  // so they're never confused with task-type bars (which can land on any
  // color in the palette).
  const isPersonal = event.kind === "personal";
  const barBg = isPersonal ? PERSONAL_BG : event.typeColors.bg;
  const barBorder = isPersonal ? PERSONAL_BORDER : event.typeColors.border;
  const barText = isPersonal ? PERSONAL_TEXT : event.typeColors.text;

  // Legend hover-to-highlight: dim non-matches, brighten matches. The "glow"
  // is brightness + opacity rather than a box-shadow (forbidden on dark
  // canvas per the design spec). Mirrors logic for the team-member dropdown
  // — when a team member is being hovered, dim every card whose crew does
  // not include them.
  const highlightedTaskType = useCalendarStore((s) => s.highlightedTaskType);
  const highlightedTeamMemberId = useCalendarStore(
    (s) => s.highlightedTeamMemberId
  );
  const matchesType =
    highlightedTaskType !== null && event.typeLabel === highlightedTaskType;
  const matchesMember =
    highlightedTeamMemberId !== null &&
    event.crewIds.includes(highlightedTeamMemberId);
  const dimmedByLegend =
    (highlightedTaskType !== null && !matchesType) ||
    (highlightedTeamMemberId !== null && !matchesMember);
  const highlightedByLegend = matchesType || matchesMember;

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
  // contracting from the active edge by previewDayDelta day-columns.
  //
  // The bar's own width spans `barDayCount` calendar columns (1 for
  // single-day, N for multi-day). A naive `${magnitude * 100}%` is
  // measured against the bar's width, which means a 1-day extension on
  // a 2-day bar renders as a 2-column-wide preview overlay (the
  // user-visible bug). Compute the width as a fraction of a single
  // day-column so the preview always tracks one calendar day per unit
  // of dayDelta.
  const renderEdgePreview = (edge: "left" | "right") => {
    if (!resize || resize.edge !== edge || previewDayDelta === 0) return null;
    const grow = previewDayDelta > 0;
    const magnitude = Math.abs(previewDayDelta);

    const barDayCount =
      span.endDayIndex - span.startDayIndex + 1; // 1 for single-day; N for multi-day
    const widthPctOfBar = (magnitude / barDayCount) * 100;

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
      width: `${widthPctOfBar}%`,
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
    if (isPersonal) {
      // White star instead of color dot — keeps the same 10px slot but
      // signals "personal" at a glance.
      return (
        <EventHoverPopover event={event} side="top">
          <div
            className="cursor-pointer shrink-0 flex items-center justify-center"
            style={{
              width: 10,
              height: 10,
              opacity: dimmedByLegend ? 0.18 : 1,
              filter: highlightedByLegend ? "brightness(1.25)" : "none",
              transition:
                "opacity 0.15s cubic-bezier(0.22, 1, 0.36, 1), filter 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
            onClick={handleClick}
          >
            <Star
              size={10}
              strokeWidth={1.5}
              style={{ color: PERSONAL_TEXT, fill: PERSONAL_TEXT }}
            />
          </div>
        </EventHoverPopover>
      );
    }
    return (
      <EventHoverPopover event={event} side="top">
        <div
          className="cursor-pointer shrink-0"
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: event.typeColors.border,
            opacity: dimmedByLegend ? 0.18 : 1,
            filter: highlightedByLegend ? "brightness(1.25)" : "none",
            transition:
              "opacity 0.15s cubic-bezier(0.22, 1, 0.36, 1), filter 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
          onClick={handleClick}
        />
      </EventHoverPopover>
    );
  }

  // ── Level 2: Standard — short bar with single-line title ──
  if (displayLevel === "standard") {
    const showStripe = !isPersonal && (span.isFirstSegment || span.isSingleDay);
    return (
      <EventHoverPopover event={event} side="top" disabled={!!resize}>
        <div
          ref={barRef}
          className="cursor-pointer truncate relative"
          style={{
            height: 14,
            background: barBg,
            border: `1px solid ${barBorder}`,
            borderRadius,
            color: barText,
            paddingLeft: showStripe ? 7 : isPersonal ? 5 : 4,
            paddingRight: 4,
            display: "flex",
            alignItems: "center",
            gap: isPersonal ? 4 : 0,
            overflow: "visible",
            transition:
              "filter 0.15s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
            filter: highlightedByLegend
              ? "brightness(1.3)"
              : isHovered
                ? "brightness(1.18)"
                : "none",
            opacity: dimmedByLegend ? 0.18 : 1,
          }}
          onClick={handleClick}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {StripeAccent(showStripe)}
          {isPersonal && (
            <Star
              size={9}
              strokeWidth={1.5}
              style={{ color: PERSONAL_TEXT, fill: PERSONAL_TEXT, flexShrink: 0 }}
              aria-hidden="true"
            />
          )}
          <span
            className="font-mohave truncate"
            style={{ fontSize: 11, lineHeight: "14px", color: barText }}
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
    const showStripe = !isPersonal && span.isFirstSegment;
    const showStarLead = isPersonal && span.isFirstSegment;
    return (
      <EventHoverPopover event={event} side="top" disabled={!!resize}>
        <div
          ref={barRef}
          className="cursor-pointer truncate relative"
          style={{
            height: 14,
            background: barBg,
            border: `1px solid ${barBorder}`,
            borderRadius,
            color: barText,
            paddingLeft: showStripe ? 7 : isPersonal ? 5 : 4,
            paddingRight: 4,
            display: "flex",
            alignItems: "center",
            gap: showStarLead ? 4 : 0,
            overflow: "visible",
            transition:
              "filter 0.15s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
            filter: highlightedByLegend
              ? "brightness(1.3)"
              : isHovered
                ? "brightness(1.18)"
                : "none",
            opacity: dimmedByLegend ? 0.18 : 1,
          }}
          onClick={handleClick}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {StripeAccent(showStripe)}
          {showStarLead && (
            <Star
              size={9}
              strokeWidth={1.5}
              style={{ color: PERSONAL_TEXT, fill: PERSONAL_TEXT, flexShrink: 0 }}
              aria-hidden="true"
            />
          )}
          <span
            className="font-mohave truncate"
            style={{ fontSize: 11, lineHeight: "14px", color: barText }}
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
          background: barBg,
          border: `1px solid ${barBorder}`,
          borderRadius: "4px",
          color: barText,
          paddingLeft: isPersonal ? 8 : 9,
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
        {StripeAccent(!isPersonal)}
        {isPersonal && (
          <Star
            size={12}
            strokeWidth={1.5}
            style={{ color: PERSONAL_TEXT, fill: PERSONAL_TEXT, flexShrink: 0 }}
            aria-hidden="true"
          />
        )}

        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <span
            className="font-cakemono font-light uppercase truncate"
            style={{
              fontSize: 12,
              lineHeight: "14px",
              color: barText,
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
                color: isPersonal ? "rgba(255,255,255,0.65)" : "var(--text-2)",
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
                color: isPersonal ? "rgba(255,255,255,0.65)" : "var(--text-3)",
                fontFeatureSettings: '"tnum" 1, "zero" 1',
              }}
            >
              {timeLabel}
            </span>
          )}
          <div
            className="px-[5px] py-[1px] font-cakemono font-light uppercase"
            style={{
              color: barText,
              background: barBg,
              border: `1px solid ${barBorder}`,
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
