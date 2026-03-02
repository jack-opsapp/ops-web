"use client";

import type { ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { addMinutes } from "date-fns";
import { useCalendarDnd } from "@/lib/hooks/use-calendar-dnd";
import { useCalendarStore } from "@/stores/calendar-store";
import {
  type InternalCalendarEvent,
  getEventColors,
  formatTime24,
} from "@/lib/utils/calendar-utils";

interface CalendarDndContextProps {
  events: InternalCalendarEvent[];
  children: ReactNode;
}

export function CalendarDndContext({ events, children }: CalendarDndContextProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const { handleDragStart, handleDragMove, handleDragEnd, handleDragCancel } = useCalendarDnd({
    events,
  });

  const { draggedEventId, dragPreview } = useCalendarStore();
  const activeEvent = draggedEventId
    ? events.find((e) => e.id === draggedEventId)
    : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {activeEvent ? (
          <DragOverlayEvent event={activeEvent} dragPreview={dragPreview} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** Ghost preview shown while dragging */
function DragOverlayEvent({
  event,
  dragPreview,
}: {
  event: InternalCalendarEvent;
  dragPreview: { date: Date; duration: number } | null;
}) {
  const colors = getEventColors(event.taskType);

  // Use real-time preview times if available, otherwise fall back to original
  const startTime = dragPreview ? dragPreview.date : event.startDate;
  const endTime = dragPreview
    ? addMinutes(dragPreview.date, dragPreview.duration)
    : event.endDate;

  return (
    <div
      className="rounded-sm px-[6px] py-[4px] shadow-elevated opacity-85 pointer-events-none min-w-[120px] max-w-[200px]"
      style={{
        backgroundColor: colors.bg,
        borderLeft: `3px solid ${colors.border}`,
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="flex items-center gap-[4px] mb-[2px]">
        <span
          className="font-mono text-[10px] font-bold"
          style={{ color: colors.text }}
        >
          {formatTime24(startTime)} - {formatTime24(endTime)}
        </span>
      </div>
      <div
        className="font-mohave text-[12px] leading-tight truncate"
        style={{ color: colors.text }}
      >
        {event.title}
      </div>
    </div>
  );
}
