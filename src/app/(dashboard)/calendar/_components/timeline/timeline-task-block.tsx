"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { differenceInCalendarDays, addDays, format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { useDraggable } from "@dnd-kit/core";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import { getEventColors } from "@/lib/utils/calendar-utils";
import { TIMELINE_ROW_HEIGHT } from "@/lib/utils/timeline-constants";

// ─── Props ──────────────────────────────────────────────────────────────────

interface TimelineTaskBlockProps {
  event: InternalCalendarEvent;
  startDate: Date; // timeline start date (first visible day)
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

/**
 * Parse a hex color string to r, g, b values.
 * Handles #RGB, #RRGGBB, or returns fallback for invalid input.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (clean.length === 6) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }
  return null;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function TimelineTaskBlock({
  event,
  startDate,
  daysShown,
  isSelected = false,
  isGhost = false,
  onClick,
  onContextMenu,
  onResize,
}: TimelineTaskBlockProps) {
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
    id: `timeline-event-${event.id}`,
    data: { type: "timeline-event", event },
    disabled: isGhost || !!resizeState,
  });

  // ── Color computation ─────────────────────────────────────────────────

  const colors = useMemo(() => getEventColors(event.taskType), [event.taskType]);
  const borderColor = colors.border;
  const textColor = colors.text;

  // Parse the border color to RGB for opacity variants
  const rgb = useMemo(() => hexToRgb(borderColor), [borderColor]);
  const rgbStr = rgb ? `${rgb.r}, ${rgb.g}, ${rgb.b}` : "89, 119, 159";

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

  // Don't render if completely outside visible range
  if (resizeAdjusted.widthPercent <= 0) return null;

  const blockHeight = TIMELINE_ROW_HEIGHT - 16; // 56px (8px padding top + bottom)

  // ── Determine if block is narrow ──────────────────────────────────────

  // Approximate: if the block spans less than ~0.6 of a day column it's "narrow"
  const oneDayPercent = 100 / daysShown;
  const isNarrow = resizeAdjusted.widthPercent < oneDayPercent * 0.6;

  // ── Label content ─────────────────────────────────────────────────────

  const projectName = event.title;
  const clientName = event.project ?? null;
  const taskTypeLabel = event.taskType.toUpperCase();

  // ── Date range for tooltip ────────────────────────────────────────────

  const dateRangeStr = `${format(event.startDate, "MMM d")} - ${format(event.endDate, "MMM d, yyyy")}`;

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

  // ── Reduced motion ────────────────────────────────────────────────────

  const tooltipVariants = {
    hidden: { opacity: 0, y: 4 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 4 },
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div
      ref={(node) => {
        // Merge dnd-kit ref with our local ref
        setNodeRef(node);
        (blockRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
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

      {/* Left color stripe */}
      <div
        className="shrink-0 rounded-l-[3px]"
        style={{
          width: 3,
          background: borderColor,
        }}
      />

      {/* Main block body */}
      <div
        className="flex-1 flex items-center min-w-0 px-[8px] rounded-r-[3px] transition-colors duration-150"
        style={{
          background: `rgba(${rgbStr}, 0.15)`,
          border: `1px ${isGhost ? "dashed" : "solid"} rgba(${rgbStr}, ${isHovered ? 0.5 : 0.3})`,
          borderLeft: "none",
          borderRadius: "0 3px 3px 0",
          outline: isSelected ? "1px solid #597794" : "none",
          outlineOffset: isSelected ? 0 : undefined,
        }}
      >
        {/* Content */}
        <div className="flex-1 flex items-center justify-between min-w-0 gap-[6px]">
          {/* Left: title + client */}
          <div className="flex items-center min-w-0 gap-[4px] overflow-hidden">
            <span
              className="font-mohave font-semibold text-[11px] text-text-primary truncate leading-tight"
              style={{ color: "#FFFFFF" }}
            >
              {projectName}
            </span>
            {clientName && !isNarrow && (
              <>
                <span
                  className="font-kosugi text-[11px] shrink-0"
                  style={{ color: "#666666" }}
                >
                  ·
                </span>
                <span
                  className="font-kosugi text-[11px] truncate leading-tight"
                  style={{ color: "#999999" }}
                >
                  {clientName}
                </span>
              </>
            )}
          </div>

          {/* Right: task type badge */}
          {!isNarrow && (
            <div
              className="shrink-0 flex items-center px-[5px] py-[1px] font-kosugi text-[9px] uppercase tracking-wider leading-tight"
              style={{
                color: textColor,
                background: `rgba(${rgbStr}, 0.12)`,
                border: `1px solid rgba(${rgbStr}, 0.30)`,
                borderRadius: 2,
              }}
            >
              {taskTypeLabel}
            </div>
          )}
        </div>
      </div>

      {/* Hover tooltip */}
      <AnimatePresence>
        {isHovered && !isGhost && !isDragging && !resizeState && (
          <motion.div
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={tooltipVariants}
            transition={{ duration: 0.15 }}
            className="absolute z-50 pointer-events-none"
            style={{
              bottom: "calc(100% + 6px)",
              left: 0,
              minWidth: 200,
              maxWidth: 280,
              background: "rgba(10, 10, 10, 0.70)",
              backdropFilter: "blur(20px) saturate(1.2)",
              WebkitBackdropFilter: "blur(20px) saturate(1.2)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 3,
              padding: "8px 10px",
            }}
          >
            {/* Project name */}
            <div
              className="font-mohave font-semibold text-[12px] leading-tight truncate"
              style={{ color: "#FFFFFF" }}
            >
              {projectName}
            </div>

            {/* Client */}
            {clientName && (
              <div
                className="font-kosugi text-[10px] uppercase tracking-wider leading-tight mt-[2px] truncate"
                style={{ color: "#999999" }}
              >
                {clientName}
              </div>
            )}

            {/* Divider */}
            <div
              className="my-[5px]"
              style={{
                height: 1,
                background: "rgba(255, 255, 255, 0.08)",
              }}
            />

            {/* Task type */}
            <div className="flex items-center gap-[6px]">
              <div
                className="w-[6px] h-[6px] rounded-[1px] shrink-0"
                style={{ background: borderColor }}
              />
              <span
                className="font-kosugi text-[10px] uppercase tracking-wider leading-tight"
                style={{ color: textColor }}
              >
                {taskTypeLabel}
              </span>
            </div>

            {/* Team members */}
            {event.teamMemberIds.length > 0 && (
              <div
                className="font-kosugi text-[10px] uppercase tracking-wider leading-tight mt-[3px]"
                style={{ color: "#999999" }}
              >
                {event.teamMemberIds.length}{" "}
                {event.teamMemberIds.length === 1
                  ? "TEAM MEMBER"
                  : "TEAM MEMBERS"}
              </div>
            )}

            {/* Date range */}
            <div
              className="font-kosugi text-[10px] uppercase tracking-wider leading-tight mt-[3px]"
              style={{ color: "#999999" }}
            >
              {dateRangeStr}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
