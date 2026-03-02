"use client";

import { useState, useCallback, useRef } from "react";
import { HOURS, HOUR_HEIGHT, FIRST_HOUR } from "@/lib/utils/calendar-constants";
import {
  type InternalCalendarEvent,
  getEventsForDay,
  resolveEventColumns,
  yOffsetToDate,
  snapToGrid,
  formatTime24,
} from "@/lib/utils/calendar-utils";
import { CurrentTimeIndicator } from "./current-time-indicator";
import { EventBlock } from "./event-block";

interface TimeGridColumnProps {
  day: Date;
  events: InternalCalendarEvent[];
  isToday: boolean;
  showFullDetail?: boolean;
  conflictIds?: Set<string>;
  onEventClick?: (event: InternalCalendarEvent) => void;
  onEventContextMenu?: (event: InternalCalendarEvent, x: number, y: number) => void;
  onEventResize?: (event: InternalCalendarEvent, newEndDate: Date) => void;
  onEmptyClick?: (date: Date, clientX: number, clientY: number) => void;
  /** Called when user drags across empty slots to select a time range */
  onRangeSelect?: (startDate: Date, endDate: Date, clientX: number, clientY: number) => void;
  /** Currently selected event ID for visual focus ring */
  selectedEventId?: string | null;
}

// Minimum drag distance (px) before we consider it a range drag vs a click
const DRAG_THRESHOLD = 8;

export function TimeGridColumn({
  day,
  events,
  isToday: columnIsToday,
  showFullDetail,
  conflictIds,
  onEventClick,
  onEventContextMenu,
  onEventResize,
  onEmptyClick,
  onRangeSelect,
  selectedEventId,
}: TimeGridColumnProps) {
  const dayEvents = getEventsForDay(events, day);
  const resolved = resolveEventColumns(dayEvents);

  // Range drag state
  const [dragRange, setDragRange] = useState<{ startY: number; endY: number } | null>(null);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const columnRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only left click, and only on empty space (not on events)
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("[data-event-block]")) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      startYRef.current = y;
      isDraggingRef.current = false;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!columnRef.current) return;
        const rect = columnRef.current.getBoundingClientRect();
        const currentY = Math.max(0, Math.min(moveEvent.clientY - rect.top, rect.height));
        const delta = Math.abs(currentY - startYRef.current);

        if (delta >= DRAG_THRESHOLD) {
          isDraggingRef.current = true;
          setDragRange({
            startY: Math.min(startYRef.current, currentY),
            endY: Math.max(startYRef.current, currentY),
          });
        }
      };

      const handleMouseUp = (upEvent: MouseEvent) => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);

        if (isDraggingRef.current && columnRef.current && onRangeSelect) {
          const rect = columnRef.current.getBoundingClientRect();
          const currentY = Math.max(0, Math.min(upEvent.clientY - rect.top, rect.height));
          const topY = Math.min(startYRef.current, currentY);
          const bottomY = Math.max(startYRef.current, currentY);

          const startDate = snapToGrid(yOffsetToDate(topY, day));
          const endDate = snapToGrid(yOffsetToDate(bottomY, day));

          if (endDate > startDate) {
            onRangeSelect(startDate, endDate, upEvent.clientX, upEvent.clientY);
          }
        }

        setDragRange(null);
        isDraggingRef.current = false;
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [day, onRangeSelect]
  );

  function handleColumnClick(e: React.MouseEvent<HTMLDivElement>) {
    // Don't fire click if we just finished a drag
    if (isDraggingRef.current) return;
    if (!onEmptyClick) return;
    if ((e.target as HTMLElement).closest("[data-event-block]")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const clickDate = yOffsetToDate(y, day);
    onEmptyClick(clickDate, e.clientX, e.clientY);
  }

  // Compute drag range labels for the blue highlight
  const dragRangeLabels = dragRange
    ? {
        start: formatTime24(snapToGrid(yOffsetToDate(dragRange.startY, day))),
        end: formatTime24(snapToGrid(yOffsetToDate(dragRange.endY, day))),
      }
    : null;

  return (
    <div
      ref={columnRef}
      className="relative select-none"
      style={{ height: `${HOURS.length * HOUR_HEIGHT}px` }}
      onClick={handleColumnClick}
      onMouseDown={handleMouseDown}
    >
      {/* Hour grid lines */}
      {HOURS.map((hour) => (
        <div
          key={hour}
          className="absolute left-0 right-0 border-b border-border-subtle"
          style={{ top: `${(hour - FIRST_HOUR) * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
        >
          <div
            className="absolute left-0 right-0 border-b border-border-subtle/40"
            style={{ top: `${HOUR_HEIGHT / 2}px` }}
          />
        </div>
      ))}

      {/* Today highlight stripe */}
      {columnIsToday && (
        <div className="absolute inset-0 bg-ops-accent/[0.03] pointer-events-none" />
      )}

      {/* Current time indicator */}
      {columnIsToday && <CurrentTimeIndicator />}

      {/* Drag range highlight */}
      {dragRange && (
        <div
          className="absolute left-[2px] right-[2px] bg-ops-accent/15 border border-ops-accent/40 rounded-sm pointer-events-none z-20"
          style={{
            top: `${dragRange.startY}px`,
            height: `${dragRange.endY - dragRange.startY}px`,
          }}
        >
          {dragRangeLabels && (
            <div className="absolute top-[2px] left-[4px] font-mono text-[10px] text-ops-accent">
              {dragRangeLabels.start} - {dragRangeLabels.end}
            </div>
          )}
        </div>
      )}

      {/* Events with overlap resolution */}
      {resolved.map(({ event, columnIndex, totalColumns }) => (
        <EventBlock
          key={event.id}
          event={event}
          showFullDetail={showFullDetail}
          onClick={onEventClick}
          onContextMenu={onEventContextMenu}
          onResize={onEventResize}
          columnIndex={columnIndex}
          totalColumns={totalColumns}
          hasConflict={conflictIds?.has(event.id)}
          isSelected={selectedEventId === event.id}
        />
      ))}
    </div>
  );
}
