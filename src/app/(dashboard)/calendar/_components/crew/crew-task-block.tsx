"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { differenceInCalendarDays, addDays, format } from "date-fns";
import { useDraggable } from "@dnd-kit/core";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import { CREW_ROW_HEIGHT } from "@/lib/utils/crew-constants";
import { EventHoverPopover } from "../event-hover-popover";

// ─── Props ──────────────────────────────────────────────────────────────────

interface CrewTaskBlockProps {
  event: InternalCalendarEvent;
  startDate: Date; // crew swimlane start date (first visible day)
  daysShown: number; // number of visible day columns
  isSelected?: boolean; // selected via click or multi-select
  isGhost?: boolean; // ghost preview for cascade/auto-schedule
  onClick?: (event: InternalCalendarEvent) => void;
  onContextMenu?: (
    event: InternalCalendarEvent,
    x: number,
    y: number
  ) => void;
  onResize?: (event: InternalCalendarEvent, newStartDate: Date, newEndDate: Date) => void;
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
  onClick,
  onContextMenu,
  onResize,
}: CrewTaskBlockProps) {
  const [isHovered, setIsHovered] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);

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

  const blockHeight = CREW_ROW_HEIGHT - 16; // 56px (8px padding top + bottom)

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
        top: 8,
        height: blockHeight,
        zIndex: isDragging ? 20 : resizeState ? 15 : isSelected ? 5 : isHovered ? 4 : 2,
        pointerEvents: isGhost ? "none" : "auto",
        cursor: isGhost ? "default" : resizeState ? "col-resize" : "grab",
        opacity: isGhost ? 0.5 : 1,
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

      {/* Body — sibling-div stripe + status fill (no box-shadow crescent) */}
      <div
        className="flex-1 relative flex items-center min-w-0"
        style={{
          background: event.statusColors.bg,
          border: `1px ${isGhost ? "dashed" : "solid"} ${event.statusColors.border}`,
          borderRadius: 4,
          paddingLeft: 11, // 8 (text) + 3 (stripe gutter)
          paddingRight: 8,
          outline: isSelected ? "1px solid var(--ops-accent)" : "none",
          outlineOffset: isSelected ? 0 : undefined,
          transition: "filter 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
          filter: isHovered && !isGhost ? "brightness(1.18)" : "none",
        }}
      >
        {/* Type stripe */}
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

        {/* Content */}
        <div className="flex-1 flex items-center justify-between min-w-0 gap-[6px]">
          <div className="flex items-baseline min-w-0 gap-[6px] overflow-hidden">
            <span
              className="font-mohave text-[11px] truncate leading-tight"
              style={{ color: "var(--text)" }}
            >
              {primaryTitle}
            </span>
            {subtitle && !isNarrow && (
              <>
                <span
                  className="font-mono text-[11px] shrink-0"
                  style={{ color: "var(--text-mute)" }}
                >
                  /
                </span>
                <span
                  className="font-mono text-[11px] truncate leading-tight"
                  style={{ color: "var(--text-3)" }}
                >
                  {subtitle}
                </span>
              </>
            )}
          </div>

          {/* Right cluster: time + type badge */}
          <div className="flex items-center gap-[6px] shrink-0">
            {timeRange && !isNarrow && (
              <span
                className="font-mono text-[10px] tabular-nums"
                style={{
                  color: "var(--text-3)",
                  fontFeatureSettings: '"tnum" 1, "zero" 1',
                }}
              >
                {timeRange}
              </span>
            )}
            {!isNarrow && (
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
            )}
          </div>
        </div>
      </div>

    </div>
    </EventHoverPopover>
  );
}
