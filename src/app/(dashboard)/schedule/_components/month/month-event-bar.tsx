"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { format } from "date-fns";
import { Star, TreePalm } from "lucide-react";
import { type InternalScheduleEvent } from "@/lib/utils/schedule-utils";
import { useScheduleStore } from "@/stores/schedule-store";
import { EventHoverPopover } from "../event-hover-popover";
import { useEventWeatherRisk } from "../weather/schedule-weather-context";
import { WeatherRiskIndicator } from "../weather/weather-risk-indicator";

// Personal events ride on the same color pool as task types, which makes
// them visually indistinguishable from any task type using the same color.
// Override their visual treatment with a NON-color signal (Star + white)
// so they read distinctly regardless of the underlying task-type palette.
// (Bug 89a5d774.)
//
// Spec: white-at-10% glass fill + white hairline at 0.20 alpha + Star icon.
const PERSONAL_BG = "rgba(255, 255, 255, 0.10)";
const PERSONAL_BORDER = "rgba(255, 255, 255, 0.20)";
const PERSONAL_TEXT = "#FFFFFF";

// Time-off events also can't ride task-type colors (they're not tasks). The
// canonical PTO/vacation signal is `--tan` (var(--tan)) hairline + TreePalm
// glyph — keeps them recognizable at a glance and distinct from personal
// events (Star + white). (Bug 0342efaf.)
const TIMEOFF_BG = "rgba(196, 168, 104, 0.06)";
const TIMEOFF_BORDER = "var(--tan-line)";
const TIMEOFF_TEXT = "var(--tan)";

// ─── Calendar badge surface ─────────────────────────────────────────────────
//
// Spec: every calendar badge (month / week / day / crew) renders on a
// frosted-glass tint with a hairline of the status hue, so the day cell's
// own grid + weekend tint never bleeds through the badge fill.
//
//   background: dense-glass alpha (var(--surface-input))
//   border:     status hue at alpha 0.30 (hairline)
//   text:       status-tone color (typeColors.text)
//
// The full-strength type stripe still renders on the leading edge as the
// primary type signal — this rule changes the BAR FILL only.
const BADGE_BG = "var(--surface-input)";
const BADGE_BORDER_ALPHA = 0.3;

/**
 * Reduce an `rgb(r, g, b)` or `rgba(...)` border value to its alpha-0.3
 * hairline form. The badge stripe (full-strength) is still drawn separately;
 * this is the bar's perimeter.
 */
function hairlineBorder(border: string): string {
  // colorTripleFromHex emits `rgb(r, g, b)` for `border` — convert to rgba
  // with the badge alpha. If a caller passes an rgba already, swap its alpha.
  const rgbMatch = border.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    return `rgba(${r}, ${g}, ${b}, ${BADGE_BORDER_ALPHA})`;
  }
  const rgbaMatch = border.match(
    /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*[\d.]+\s*\)$/
  );
  if (rgbaMatch) {
    const [, r, g, b] = rgbaMatch;
    return `rgba(${r}, ${g}, ${b}, ${BADGE_BORDER_ALPHA})`;
  }
  return border;
}

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
  event: InternalScheduleEvent;
  displayLevel: DisplayLevel;
  span: MonthEventBarSpan;
  onClick?: (event: InternalScheduleEvent) => void;
  /**
   * Edge resize callback. dayDelta is signed — positive extends, negative
   * shrinks. Edge "left" pulls the start; edge "right" pushes the end.
   *
   * dayDelta is computed in CALENDAR SPACE — it accumulates both row and
   * column offsets so dragging the right edge of a Saturday badge into
   * the next week's Tuesday counts as +3 days (Sat→Sun→Mon→Tue), not
   * "back to Tuesday in the current row." Caller is responsible for
   * applying the patch (typically via useScheduleResize).
   *
   * Multi-day bars only render the matching handle on the boundary
   * segments: `left` on isFirstSegment, `right` on isLastSegment. Compact
   * (dot) bars render no handles regardless.
   */
  onResize?: (
    event: InternalScheduleEvent,
    edge: "left" | "right",
    dayDelta: number
  ) => void;
}

// 8px hit zone, matches crew-task-block.
const RESIZE_HANDLE_PX = 6;

// ─── Resize hook ────────────────────────────────────────────────────────────

/**
 * Tracks an active edge-drag for a Month event bar.
 *
 * dayDelta is computed in CALENDAR SPACE, not in cursor-pixel space. The
 * pointer's live (clientX, clientY) is hit-tested against the month grid:
 * we find the week row directly under the cursor, then divide its width
 * by 7 to find the column index. dayDelta = (rowIndex - anchorRowIndex)
 * * 7 + (colIndex - anchorColIndex). That makes dragging a Saturday-edge
 * down into the next week's Tuesday count as +3 days, not "snap back to
 * the same row's Tuesday."
 *
 * The anchor is captured at mousedown — the row + col of the edge cell
 * being dragged. From there, every mouse event recomputes dayDelta from
 * the current pointer position. No accumulated pixel delta — the value
 * is always derived from where the cursor IS, never from where it has
 * been. This is what makes cross-row resize work.
 */
function useEdgeResize(
  barRef: React.RefObject<HTMLDivElement | null>,
  onResize:
    | ((
        event: InternalScheduleEvent,
        edge: "left" | "right",
        dayDelta: number
      ) => void)
    | undefined,
  event: InternalScheduleEvent
) {
  const [resize, setResize] = useState<{
    edge: "left" | "right";
    anchorRowIndex: number;
    anchorColIndex: number;
    dayDelta: number;
  } | null>(null);
  const resizeRef = useRef(resize);
  resizeRef.current = resize;

  // Find every week row in document order. Used to resolve the row index
  // (0-based) of any element relative to the full grid — not just the row
  // the bar lives in.
  const getWeekRows = useCallback((): HTMLElement[] => {
    const el = barRef.current;
    if (!el) return [];
    // The scrollable parent is the section container; the rows live as
    // descendants of any ancestor `<section>` that holds the month grid.
    // Querying from document is fine: the data-attr is unique to this view.
    return Array.from(
      document.querySelectorAll<HTMLElement>("[data-month-week-row]")
    );
  }, [barRef]);

  // Resolve the (rowIndex, colIndex) the mouse is currently over.
  // Returns null when the cursor is outside any week row (e.g. user
  // dragged off the grid). When outside, we keep the last valid value via
  // setResize's update guard so dayDelta doesn't oscillate.
  const resolveCellFromPoint = useCallback(
    (clientX: number, clientY: number): {
      rowIndex: number;
      colIndex: number;
    } | null => {
      const rows = getWeekRows();
      if (rows.length === 0) return null;

      // Find the row whose vertical band contains clientY. Use rect.top /
      // rect.bottom directly — rows are stacked, so the test is exact.
      let targetRow: HTMLElement | null = null;
      let targetRowIndex = -1;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (clientY >= r.top && clientY < r.bottom) {
          targetRow = rows[i];
          targetRowIndex = i;
          break;
        }
      }

      // Cursor is above all rows or below all rows — clamp to the nearest
      // edge row so dragging off the grid still produces a sane delta.
      if (!targetRow) {
        const firstRect = rows[0].getBoundingClientRect();
        const lastRect = rows[rows.length - 1].getBoundingClientRect();
        if (clientY < firstRect.top) {
          targetRow = rows[0];
          targetRowIndex = 0;
        } else if (clientY >= lastRect.bottom) {
          targetRow = rows[rows.length - 1];
          targetRowIndex = rows.length - 1;
        } else {
          return null;
        }
      }

      const rowRect = targetRow.getBoundingClientRect();
      const colWidth = rowRect.width / 7;
      if (colWidth <= 0) return null;
      const rawCol = (clientX - rowRect.left) / colWidth;
      const colIndex = Math.max(0, Math.min(6, Math.floor(rawCol)));
      return { rowIndex: targetRowIndex, colIndex };
    },
    [getWeekRows]
  );

  // Resolve the anchor cell (where the drag starts). For the right edge,
  // that's the LAST cell of the bar; for the left edge, the FIRST. We
  // walk the same hit test using the bar's own bounding rect so the
  // anchor lives inside the visible bar regardless of where the user
  // clicked within the resize handle.
  const resolveAnchorCell = useCallback(
    (edge: "left" | "right"): { rowIndex: number; colIndex: number } | null => {
      const el = barRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      // Sample 1px inside the matching edge so we hit the bar, not the
      // adjacent cell.
      const x = edge === "right" ? r.right - 1 : r.left + 1;
      const y = (r.top + r.bottom) / 2;
      return resolveCellFromPoint(x, y);
    },
    [resolveCellFromPoint, barRef]
  );

  const handleResizeStart = useCallback(
    (edge: "left" | "right") => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const anchor = resolveAnchorCell(edge);
      if (!anchor) return;
      setResize({
        edge,
        anchorRowIndex: anchor.rowIndex,
        anchorColIndex: anchor.colIndex,
        dayDelta: 0,
      });
    },
    [resolveAnchorCell]
  );

  useEffect(() => {
    if (!resize) return;

    const onMouseMove = (mv: MouseEvent) => {
      const cell = resolveCellFromPoint(mv.clientX, mv.clientY);
      if (!cell) return;
      setResize((prev) => {
        if (!prev) return prev;
        const dayDelta =
          (cell.rowIndex - prev.anchorRowIndex) * 7 +
          (cell.colIndex - prev.anchorColIndex);
        if (dayDelta === prev.dayDelta) return prev;
        return { ...prev, dayDelta };
      });
    };
    const onMouseUp = () => {
      const state = resizeRef.current;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      setResize(null);
      if (!state) return;
      if (state.dayDelta === 0) return;
      onResize?.(event, state.edge, state.dayDelta);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [resize, resolveCellFromPoint, onResize, event]);

  const previewDayDelta = resize?.dayDelta ?? 0;

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

  // Adverse-weather risk for this event (null unless weather-dependent AND the
  // forecast for a covered day is bad). Drives the tan warning glyph.
  const weatherRisk = useEventWeatherRisk(event);

  // Personal events render with a distinct white-outline + star treatment
  // so they're never confused with task-type bars (which can land on any
  // color in the palette). Time-off events render with a tan hairline +
  // palm-tree glyph (the obvious PTO signal). Both are non-color signals
  // so the special-events row reads cleanly regardless of task-type palette.
  const isPersonal = event.kind === "personal";
  const isTimeOff = event.kind === "time_off";
  const isSpecial = isPersonal || isTimeOff;
  // All non-special badges share a frosted-glass fill so the underlying
  // day cell (weekend tint, today highlight, gridlines) never bleeds
  // through. The type stripe + type badge inside still carry the type
  // signal; the bar perimeter is a hairline of the status hue.
  const barBg = isPersonal
    ? PERSONAL_BG
    : isTimeOff
      ? TIMEOFF_BG
      : BADGE_BG;
  const barBorder = isPersonal
    ? PERSONAL_BORDER
    : isTimeOff
      ? TIMEOFF_BORDER
      : hairlineBorder(event.typeColors.border);
  const barText = isPersonal
    ? PERSONAL_TEXT
    : isTimeOff
      ? TIMEOFF_TEXT
      : event.typeColors.text;

  // Legend hover-to-highlight: dim non-matches, brighten matches. The "glow"
  // is brightness + opacity rather than a box-shadow (forbidden on dark
  // canvas per the design spec). Mirrors logic for the team-member dropdown
  // — when a team member is being hovered, dim every card whose crew does
  // not include them.
  const highlightedTaskType = useScheduleStore((s) => s.highlightedTaskType);
  const highlightedTeamMemberId = useScheduleStore(
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
    const magnitudeRaw = Math.abs(previewDayDelta);

    // Cross-row deltas (bug da6204e1) can exceed a week. The preview
    // overlay is rendered inside the current week-row's bar, so clamp the
    // visual magnitude to whatever fits in the row from the bar's edge —
    // the actual commit value still comes from the cell hit-test on
    // mouseup, this is feedback only.
    const colsAfterEnd = grow && edge === "right" ? 6 - span.endDayIndex : 6;
    const colsBeforeStart = grow && edge === "left" ? span.startDayIndex : 6;
    const visualCap =
      edge === "right" ? Math.max(colsAfterEnd, 0) : Math.max(colsBeforeStart, 0);
    const magnitude = Math.min(magnitudeRaw, Math.max(visualCap, 1));

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
    if (isTimeOff) {
      // Tan TreePalm glyph instead of color dot — recognizable PTO signal.
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
            <TreePalm
              size={10}
              strokeWidth={1.5}
              style={{ color: TIMEOFF_TEXT }}
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
            boxSizing: "border-box",
            borderRadius: "50%",
            backgroundColor: event.typeColors.border,
            // Weather-dependent + adverse forecast → tan caution ring (the
            // densest tier's heads-up; full detail lives in the other views).
            border: weatherRisk ? "1.5px solid var(--tan)" : undefined,
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
  // Bug 5c19dc85 — height bumped 14 → 22px so titles and type badges
  // read at laptop widths. Spec: "Multi-day bars should keep readable
  // height (min 22px)."
  if (displayLevel === "standard") {
    const showStripe = !isSpecial && (span.isFirstSegment || span.isSingleDay);
    return (
      <EventHoverPopover event={event} side="top" disabled={!!resize}>
        <div
          ref={barRef}
          className="cursor-pointer truncate relative"
          style={{
            height: 22,
            background: barBg,
            border: `1px solid ${barBorder}`,
            borderRadius,
            color: barText,
            paddingLeft: showStripe ? 9 : isSpecial ? 6 : 5,
            paddingRight: 5,
            display: "flex",
            alignItems: "center",
            gap: isSpecial ? 5 : 0,
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
              size={10}
              strokeWidth={1.5}
              style={{ color: PERSONAL_TEXT, fill: PERSONAL_TEXT, flexShrink: 0 }}
              aria-hidden="true"
            />
          )}
          {isTimeOff && (
            <TreePalm
              size={10}
              strokeWidth={1.5}
              style={{ color: TIMEOFF_TEXT, flexShrink: 0 }}
              aria-hidden="true"
            />
          )}
          <span
            className="font-mohave truncate flex-1 min-w-0"
            style={{ fontSize: 12, lineHeight: "20px", color: barText }}
          >
            {event.projectTitle ?? event.taskTitle}
          </span>
          {weatherRisk && (
            <span className="shrink-0" style={{ marginLeft: 4 }}>
              <WeatherRiskIndicator risk={weatherRisk} size={12} />
            </span>
          )}
          {showLeftHandle && <Handle edge="left" height={22} />}
          {showRightHandle && <Handle edge="right" height={22} />}
          {renderEdgePreview("left")}
          {renderEdgePreview("right")}
        </div>
      </EventHoverPopover>
    );
  }

  // ── Level 3: Expanded ──

  // Multi-day events render at 22px (bug 5c19dc85 — was 14px) so titles
  // remain legible across the full row width at laptop screen sizes.
  if (!span.isSingleDay) {
    const showStripe = !isSpecial && span.isFirstSegment;
    const showStarLead = isPersonal && span.isFirstSegment;
    const showPalmLead = isTimeOff && span.isFirstSegment;
    return (
      <EventHoverPopover event={event} side="top" disabled={!!resize}>
        <div
          ref={barRef}
          className="cursor-pointer truncate relative"
          style={{
            height: 22,
            background: barBg,
            border: `1px solid ${barBorder}`,
            borderRadius,
            color: barText,
            paddingLeft: showStripe ? 9 : isSpecial ? 6 : 5,
            paddingRight: 5,
            display: "flex",
            alignItems: "center",
            gap: showStarLead || showPalmLead ? 5 : 0,
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
              size={10}
              strokeWidth={1.5}
              style={{ color: PERSONAL_TEXT, fill: PERSONAL_TEXT, flexShrink: 0 }}
              aria-hidden="true"
            />
          )}
          {showPalmLead && (
            <TreePalm
              size={10}
              strokeWidth={1.5}
              style={{ color: TIMEOFF_TEXT, flexShrink: 0 }}
              aria-hidden="true"
            />
          )}
          <span
            className="font-mohave truncate flex-1 min-w-0"
            style={{ fontSize: 12, lineHeight: "20px", color: barText }}
          >
            {event.projectTitle ?? event.taskTitle}
          </span>
          {weatherRisk && (
            <span className="shrink-0" style={{ marginLeft: 4 }}>
              <WeatherRiskIndicator risk={weatherRisk} size={12} />
            </span>
          )}
          {showLeftHandle && <Handle edge="left" height={22} />}
          {showRightHandle && <Handle edge="right" height={22} />}
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
          paddingLeft: isSpecial ? 8 : 9,
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
        {StripeAccent(!isSpecial)}
        {isPersonal && (
          <Star
            size={12}
            strokeWidth={1.5}
            style={{ color: PERSONAL_TEXT, fill: PERSONAL_TEXT, flexShrink: 0 }}
            aria-hidden="true"
          />
        )}
        {isTimeOff && (
          <TreePalm
            size={12}
            strokeWidth={1.5}
            style={{ color: TIMEOFF_TEXT, flexShrink: 0 }}
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
                color: isPersonal
                  ? "rgba(255,255,255,0.65)"
                  : isTimeOff
                    ? "rgba(196,168,104,0.75)"
                    : "var(--text-2)",
              }}
            >
              {lineTwo}
            </span>
          )}
        </div>

        {/* Right cluster: optional weather warning + time + type badge */}
        <div className="flex items-center gap-[5px] shrink-0">
          {weatherRisk && <WeatherRiskIndicator risk={weatherRisk} size={13} />}
          {timeLabel && (
            <span
              className="font-mono tabular-nums"
              style={{
                fontSize: 10,
                lineHeight: "12px",
                color: isPersonal
                  ? "rgba(255,255,255,0.65)"
                  : isTimeOff
                    ? "rgba(196,168,104,0.75)"
                    : "var(--text-3)",
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
