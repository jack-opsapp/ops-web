"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { differenceInCalendarDays, addDays, format } from "date-fns";
import { Star, TreePalm } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import type { InternalScheduleEvent } from "@/lib/utils/schedule-utils";
import { CREW_ROW_HEIGHT } from "@/lib/utils/crew-constants";
import { laneVerticalLayout } from "@/lib/utils/lane-assignment";
import { EventHoverPopover } from "../event-hover-popover";
import { useScheduleStore } from "@/stores/schedule-store";
import { useEventWeatherRisk } from "../weather/schedule-weather-context";
import { WeatherRiskIndicator } from "../weather/weather-risk-indicator";

// ─── Calendar badge surface ─────────────────────────────────────────────────
//
// Spec: every calendar badge renders on a frosted-glass tint with a hairline
// of the status hue, so the day cell's grid + weekend tint never bleeds
// through the bar fill. See `month-event-bar.tsx` for the canonical comment.
const BADGE_BG = "var(--surface-input)";
const BADGE_BORDER_ALPHA = 0.3;
function hairlineBorder(border: string): string {
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

// ─── Special-event surface tokens ───────────────────────────────────────────
// Personal events (kind = "personal") use a non-color signal — Star icon +
// white-on-white glass — so they can't be confused with task-type bars on
// any palette (bug 89a5d774). Time-off (kind = "time_off") uses TreePalm +
// tan hairline — the canonical PTO signal (bug 0342efaf).
const PERSONAL_BG = "rgba(255, 255, 255, 0.10)";
const PERSONAL_BORDER = "rgba(255, 255, 255, 0.20)";
const PERSONAL_TEXT = "#FFFFFF";
const TIMEOFF_BG = "rgba(196, 168, 104, 0.06)";
const TIMEOFF_BORDER = "var(--tan-line)";
const TIMEOFF_TEXT = "var(--tan)";

// ─── Props ──────────────────────────────────────────────────────────────────

interface CrewTaskBlockProps {
  event: InternalScheduleEvent;
  startDate: Date; // crew swimlane start date (first visible day)
  daysShown: number; // number of visible day columns
  isSelected?: boolean; // selected via click or multi-select
  isGhost?: boolean; // ghost preview for cascade/auto-schedule
  /** Vertical lane index for stacking overlapping events (0-based) */
  laneIndex?: number;
  /** Total number of lanes used in this row */
  laneCount?: number;
  /** Total row height in px — block divides this evenly across laneCount */
  rowHeight?: number;
  onClick?: (event: InternalScheduleEvent) => void;
  onContextMenu?: (
    event: InternalScheduleEvent,
    x: number,
    y: number
  ) => void;
  onResize?: (event: InternalScheduleEvent, newStartDate: Date, newEndDate: Date) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Clamp a value between min and max */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CrewTaskBlock({
  event,
  startDate,
  daysShown,
  isSelected = false,
  isGhost = false,
  laneIndex = 0,
  laneCount = 1,
  rowHeight = CREW_ROW_HEIGHT,
  onClick,
  onContextMenu,
  onResize,
}: CrewTaskBlockProps) {
  const [isHovered, setIsHovered] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);

  // ── Legend / team-member hover-to-highlight (bug 324e6520) ───────────
  // Hoisted ABOVE all early returns so the hook order stays stable across
  // renders (`react-hooks/rules-of-hooks` — bug noticed during the
  // calendar polish session). Mirror the logic in month-event-bar /
  // day-task-card so crew blocks dim and brighten consistently when the
  // toolbar dropdowns are hovered.
  const highlightedTaskType = useScheduleStore((s) => s.highlightedTaskType);
  const highlightedTeamMemberId = useScheduleStore(
    (s) => s.highlightedTeamMemberId,
  );

  // Adverse-weather risk (null unless weather-dependent + bad forecast).
  // Hoisted above the early return below so the hook order stays stable.
  const weatherRisk = useEventWeatherRisk(event);

  // ── Resize state ────────────────────────────────────────────────────────

  const [resizeState, setResizeState] = useState<{
    edge: "left" | "right";
    initialX: number;
    dayDelta: number;
  } | null>(null);

  const resizeRef = useRef(resizeState);
  resizeRef.current = resizeState;

  // ── dnd-kit draggable ─────────────────────────────────────────────────

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `crew-event-${event.id}`,
    data: { type: "crew-event", event },
    disabled: isGhost || !!resizeState,
  });

  // ── Positioning ───────────────────────────────────────────────────────

  const { leftPercent, widthPercent } = useMemo(() => {
    const eventStart = differenceInCalendarDays(event.startDate, startDate);
    const eventEnd = differenceInCalendarDays(event.endDate, startDate);
    // Duration is at least 1 day for visibility
    const durationDays = Math.max(eventEnd - eventStart, 1);

    // Clamp to visible range
    const clampedStart = clamp(eventStart, 0, daysShown);
    const clampedEnd = clamp(eventStart + durationDays, 0, daysShown);

    const left = (clampedStart / daysShown) * 100;
    const width = ((clampedEnd - clampedStart) / daysShown) * 100;

    return { leftPercent: left, widthPercent: width };
  }, [event.startDate, event.endDate, startDate, daysShown]);

  // ── Resize preview adjustments ────────────────────────────────────────

  const resizeAdjusted = useMemo(() => {
    if (!resizeState) return { leftPercent, widthPercent };

    const oneDayPercent = 100 / daysShown;

    if (resizeState.edge === "right") {
      // Extend/shrink right edge
      const newWidth = Math.max(widthPercent + resizeState.dayDelta * oneDayPercent, oneDayPercent);
      return { leftPercent, widthPercent: newWidth };
    }

    // Left edge: move start, keep end fixed
    const newLeft = leftPercent + resizeState.dayDelta * oneDayPercent;
    const newWidth = widthPercent - resizeState.dayDelta * oneDayPercent;

    // Enforce minimum 1-day width
    if (newWidth < oneDayPercent) {
      return {
        leftPercent: leftPercent + widthPercent - oneDayPercent,
        widthPercent: oneDayPercent,
      };
    }

    return { leftPercent: newLeft, widthPercent: newWidth };
  }, [resizeState, leftPercent, widthPercent, daysShown]);

  // Lane-aware vertical layout. The row reserves 8px top + 8px bottom
  // padding, then divides the remaining space among laneCount lanes with
  // a 4px gap between lanes. Single-lane rows stay at the historical
  // 56px (CREW_ROW_HEIGHT - 16) height.
  const { top: blockTop, height: blockHeight } = laneVerticalLayout(
    laneIndex,
    laneCount,
    rowHeight
  );

  // ── Determine if block is narrow ──────────────────────────────────────

  // Approximate: if the block spans less than ~0.6 of a day column it's "narrow"
  const oneDayPercent = 100 / daysShown;
  const isNarrow = resizeAdjusted.widthPercent < oneDayPercent * 0.6;

  // ── Display values (unified mapping per T8) ───────────────────────────

  const primaryTitle = event.projectTitle ?? event.taskTitle;
  const subtitle =
    event.projectTitle && event.taskTitle !== event.projectTitle
      ? event.taskTitle
      : null;

  // ── Time label (only when allDay = false; Phase 3) ────────────────────

  const timeRange = useMemo(() => {
    if (event.allDay) return null;
    const start = format(event.startDate, "HH:mm");
    const end = format(event.endDate, "HH:mm");
    return `${start} → ${end}`;
  }, [event.allDay, event.startDate, event.endDate]);

  // ── Event handlers ────────────────────────────────────────────────────

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isGhost || isDragging || resizeState) return;
      e.stopPropagation();
      onClick?.(event);
    },
    [event, onClick, isGhost, isDragging, resizeState]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (isGhost) return;
      e.preventDefault();
      e.stopPropagation();
      onContextMenu?.(event, e.clientX, e.clientY);
    },
    [event, onContextMenu, isGhost]
  );

  // ── Resize handlers ───────────────────────────────────────────────────

  const handleResizeStart = useCallback(
    (edge: "left" | "right", e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setResizeState({ edge, initialX: e.clientX, dayDelta: 0 });
    },
    []
  );

  // Global mouse move/up for resize — attached via effect when resizing
  useEffect(() => {
    if (!resizeState) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;

      // Get the parent grid container width to calculate day column width in pixels
      const container = blockRef.current?.parentElement;
      if (!container) return;

      const gridWidth = container.getBoundingClientRect().width;
      const dayColumnWidth = gridWidth / daysShown;

      const pixelDelta = e.clientX - resizeRef.current.initialX;
      const dayDelta = Math.round(pixelDelta / dayColumnWidth);

      setResizeState((prev) => (prev ? { ...prev, dayDelta } : null));
    };

    const handleMouseUp = () => {
      const state = resizeRef.current;
      if (!state || !onResize) {
        setResizeState(null);
        return;
      }

      const durationDays = differenceInCalendarDays(event.endDate, event.startDate);

      if (state.edge === "right") {
        // Extend/shrink right edge — minimum 1 day duration
        const newDuration = Math.max(durationDays + state.dayDelta, 1);
        const newEnd = addDays(event.startDate, newDuration);
        onResize(event, event.startDate, newEnd);
      } else {
        // Left edge: move start, keep end fixed — minimum 1 day duration
        const maxLeftDelta = durationDays - 1; // can't move start past end - 1 day
        const clampedDelta = Math.min(state.dayDelta, maxLeftDelta);
        const newStart = addDays(event.startDate, clampedDelta);
        onResize(event, newStart, event.endDate);
      }

      setResizeState(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizeState, event, daysShown, onResize]);

  // ── Drag transform style ──────────────────────────────────────────────

  const dragStyle = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: 0.6,
        cursor: "grabbing" as const,
      }
    : {};

  // Don't render if completely outside visible range
  if (resizeAdjusted.widthPercent <= 0) return null;

  const popoverDisabled = isGhost || isDragging || !!resizeState;

  // Legend / team-member hover-to-highlight (bug 324e6520) — derived
  // booleans use the hooks hoisted above the early return.
  const matchesType =
    highlightedTaskType !== null && event.typeLabel === highlightedTaskType;
  const matchesMember =
    highlightedTeamMemberId !== null &&
    event.crewIds.includes(highlightedTeamMemberId);
  const dimmedByLegend =
    (highlightedTaskType !== null && !matchesType) ||
    (highlightedTeamMemberId !== null && !matchesMember);
  const highlightedByLegend = matchesType || matchesMember;

  // ── Special-event branching ───────────────────────────────────────────
  // Personal / time-off events override task-type fill + stripe with their
  // own non-color signal. The block layout and resize handles remain the
  // same so drag/resize still works for special events.
  const isPersonal = event.kind === "personal";
  const isTimeOff = event.kind === "time_off";
  const isSpecial = isPersonal || isTimeOff;

  const blockBg = isPersonal
    ? PERSONAL_BG
    : isTimeOff
      ? TIMEOFF_BG
      : BADGE_BG;
  const blockBorder = isPersonal
    ? PERSONAL_BORDER
    : isTimeOff
      ? TIMEOFF_BORDER
      : hairlineBorder(event.typeColors.border);
  const blockText = isPersonal
    ? PERSONAL_TEXT
    : isTimeOff
      ? TIMEOFF_TEXT
      : "var(--text)";

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <EventHoverPopover event={event} side="top" disabled={popoverDisabled}>
    <div
      ref={(node) => {
        // Merge dnd-kit ref with our local ref
        setNodeRef(node);
        (blockRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
      data-task-id={event.id}
      className="absolute flex items-stretch"
      style={{
        left: `${resizeAdjusted.leftPercent}%`,
        width: `${resizeAdjusted.widthPercent}%`,
        top: blockTop,
        height: blockHeight,
        zIndex: isDragging
          ? 20
          : resizeState
            ? 15
            : highlightedByLegend
              ? 6
              : isSelected
                ? 5
                : isHovered
                  ? 4
                  : 2,
        pointerEvents: isGhost ? "none" : "auto",
        cursor: isGhost ? "default" : resizeState ? "col-resize" : "grab",
        opacity: isGhost ? 0.5 : dimmedByLegend ? 0.18 : 1,
        transition:
          "opacity 0.15s cubic-bezier(0.22, 1, 0.36, 1), filter 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
        ...dragStyle,
      }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => !isGhost && !isDragging && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      {...attributes}
      {...listeners}
    >
      {/* Left resize handle */}
      {!isGhost && onResize && (
        <div
          className="absolute left-0 top-0 bottom-0 z-10"
          style={{ width: 8, cursor: "col-resize" }}
          onMouseDown={(e) => handleResizeStart("left", e)}
          onPointerDown={(e) => e.stopPropagation()} // prevent dnd-kit from capturing
        />
      )}

      {/* Right resize handle */}
      {!isGhost && onResize && (
        <div
          className="absolute right-0 top-0 bottom-0 z-10"
          style={{ width: 8, cursor: "col-resize" }}
          onMouseDown={(e) => handleResizeStart("right", e)}
          onPointerDown={(e) => e.stopPropagation()} // prevent dnd-kit from capturing
        />
      )}

      {/* Body — sibling-div stripe + frosted-glass fill (no box-shadow crescent) */}
      <div
        className="flex-1 relative flex items-center min-w-0"
        style={{
          background: blockBg,
          border: `1px ${isGhost ? "dashed" : "solid"} ${blockBorder}`,
          borderRadius: 4,
          // No type-color stripe gutter for special events — the leading
          // glyph (Star / TreePalm) carries the signal instead.
          paddingLeft: isSpecial ? 8 : 11, // task: 8 (text) + 3 (stripe gutter)
          paddingRight: 8,
          outline: isSelected ? "1px solid var(--ops-accent)" : "none",
          outlineOffset: isSelected ? 0 : undefined,
          transition: "filter 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
          filter: highlightedByLegend
            ? "brightness(1.3)"
            : isHovered && !isGhost
              ? "brightness(1.18)"
              : "none",
        }}
      >
        {/* Type stripe — task events only. Special events override with a
            leading glyph (Star or TreePalm) below. */}
        {!isSpecial && (
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
        )}

        {/* Content — vertical stack: project, client, address (when wide enough) */}
        <div className="flex-1 flex items-stretch justify-between min-w-0 gap-[6px] py-[6px]">
          {/* Leading glyph — special events only (Star for personal, TreePalm
              for time-off). Aligns with the title baseline so the row reads
              clean even on narrow lanes. */}
          {isPersonal && (
            <div className="flex items-center shrink-0">
              <Star
                size={12}
                strokeWidth={1.5}
                style={{
                  color: PERSONAL_TEXT,
                  fill: PERSONAL_TEXT,
                }}
                aria-hidden="true"
              />
            </div>
          )}
          {isTimeOff && (
            <div className="flex items-center shrink-0">
              <TreePalm
                size={12}
                strokeWidth={1.5}
                style={{ color: TIMEOFF_TEXT }}
                aria-hidden="true"
              />
            </div>
          )}

          <div className="flex flex-col justify-center min-w-0 overflow-hidden flex-1">
            <span
              className="font-cakemono font-light text-[12px] uppercase truncate leading-tight"
              style={{ color: blockText, letterSpacing: 0 }}
            >
              {primaryTitle}
            </span>
            {!isNarrow && !isSpecial && event.clientName && (
              <span
                className="font-mono text-[11px] truncate leading-tight mt-[1px]"
                style={{ color: "var(--text-2)" }}
              >
                {event.clientName}
              </span>
            )}
            {!isNarrow && !isSpecial && !event.clientName && subtitle && (
              <span
                className="font-mono text-[11px] truncate leading-tight mt-[1px]"
                style={{ color: "var(--text-3)" }}
              >
                {subtitle}
              </span>
            )}
            {!isNarrow && !isSpecial && event.address && (
              <span
                className="font-mono text-[11px] uppercase tracking-[0.16em] truncate leading-tight mt-[1px]"
                style={{
                  color: "rgba(237, 237, 237, 0.45)",
                  letterSpacing: "0.06em",
                }}
              >
                {event.address.split(",").slice(0, 2).map((s) => s.trim()).join(", ")}
              </span>
            )}
            {/* Special-event subtitle (notes / reason when present). */}
            {!isNarrow && isSpecial && subtitle && (
              <span
                className="font-mono text-[11px] truncate leading-tight mt-[1px]"
                style={{
                  color: isPersonal
                    ? "rgba(255,255,255,0.65)"
                    : "rgba(196,168,104,0.75)",
                }}
              >
                {subtitle}
              </span>
            )}
          </div>

          {/* Right cluster: weather warning + time + type badge (task events
              only — special events use the leading glyph as their signal). */}
          <div className="flex flex-col items-end justify-between gap-[4px] shrink-0">
            {weatherRisk && !isNarrow && (
              <WeatherRiskIndicator risk={weatherRisk} size={12} />
            )}
            {!isNarrow && !isSpecial && (
              <div
                className="px-[5px] py-[1px] font-cakemono font-light uppercase"
                style={{
                  color: event.typeColors.text,
                  background: "rgba(0, 0, 0, 0.30)",
                  border: `1px solid ${event.typeColors.border}`,
                  borderRadius: 2,
                  fontSize: 9,
                  letterSpacing: "0.04em",
                  lineHeight: "12px",
                }}
              >
                {event.typeLabel}
              </div>
            )}
            {timeRange && !isNarrow && (
              <span
                className="font-mono text-[11px] tabular-nums"
                style={{
                  color: isPersonal
                    ? "rgba(255,255,255,0.65)"
                    : isTimeOff
                      ? "rgba(196,168,104,0.75)"
                      : "var(--text-3)",
                  fontFeatureSettings: '"tnum" 1, "zero" 1',
                }}
              >
                {timeRange}
              </span>
            )}
          </div>
        </div>
      </div>

    </div>
    </EventHoverPopover>
  );
}
