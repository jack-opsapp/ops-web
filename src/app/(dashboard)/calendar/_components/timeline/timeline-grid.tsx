"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { isToday, differenceInCalendarDays, getHours, getMinutes } from "date-fns";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from "@dnd-kit/core";
import type { TeamMember } from "@/lib/types/models";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import { UserRole } from "@/lib/types/models";
import { TimelineHeader } from "./timeline-header";
import { TimelineRow } from "./timeline-row";
import { TimelineTaskBlock } from "./timeline-task-block";
import { EventContextMenu } from "../event-context-menu";
import { InlineEditor } from "../inline-editor";
import { useCalendarStore } from "@/stores/calendar-store";
import { useUpdateCalendarEvent } from "@/lib/hooks";
import { useTimelineDnd } from "@/lib/hooks/use-timeline-dnd";
import {
  TIMELINE_DAYS_SHOWN,
  TIMELINE_DAY_MIN_WIDTH,
  TIMELINE_GUTTER_WIDTH,
} from "@/lib/utils/timeline-constants";

// ─── Unassigned Placeholder ─────────────────────────────────────────────────

const UNASSIGNED_MEMBER: TeamMember = {
  id: "__unassigned__",
  userId: "__unassigned__",
  firstName: "Unassigned",
  lastName: "",
  email: null,
  phone: null,
  profileImageURL: null,
  role: UserRole.Crew,
  userColor: null,
  isActive: true,
};

// ─── Props ──────────────────────────────────────────────────────────────────

interface TimelineGridProps {
  events: InternalCalendarEvent[];
  teamMembers: TeamMember[];
  startDate: Date;
  daysShown?: number;
  onEventClick?: (event: InternalCalendarEvent) => void;
}

// ─── Droppable Row Wrapper ──────────────────────────────────────────────────

/** Wraps each TimelineRow so it is a valid droppable target for DnD */
function DroppableTimelineRow({
  teamMember,
  startDate,
  daysShown,
  isLast,
  children,
}: {
  teamMember: TeamMember;
  startDate: Date;
  daysShown: number;
  isLast?: boolean;
  children: React.ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(0);

  // Measure the row's grid area (excluding the gutter) for pixel-to-day calculations
  useEffect(() => {
    if (!rowRef.current) return;
    const resizeObserver = new ResizeObserver(() => {
      if (rowRef.current) {
        const totalWidth = rowRef.current.getBoundingClientRect().width;
        setGridWidth(Math.max(totalWidth - TIMELINE_GUTTER_WIDTH, 0));
      }
    });
    resizeObserver.observe(rowRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  const { setNodeRef, isOver } = useDroppable({
    id: `timeline-row-${teamMember.id}`,
    data: {
      type: "timeline-row",
      teamMemberId: teamMember.id,
      gridWidth,
    },
  });

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        (rowRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
      style={{
        outline: isOver ? "1px solid rgba(89,119,148,0.4)" : "none",
        outlineOffset: -1,
      }}
    >
      <TimelineRow
        teamMember={teamMember}
        startDate={startDate}
        daysShown={daysShown}
        isLast={isLast}
      >
        {children}
      </TimelineRow>
    </div>
  );
}

// ─── Current Time Indicator ─────────────────────────────────────────────────

function CurrentTimeIndicator({
  startDate,
  daysShown,
}: {
  startDate: Date;
  daysShown: number;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Check if today is within the visible range
  const dayOffset = differenceInCalendarDays(now, startDate);
  if (dayOffset < 0 || dayOffset >= daysShown) return null;

  // Calculate horizontal position within the day column
  const hours = getHours(now);
  const minutes = getMinutes(now);
  const fractionOfDay = (hours + minutes / 60) / 24;

  // Position: skip gutter, then offset by day columns + fraction within current day
  const dayColumnPercent = 100 / daysShown;
  const leftPercent = dayOffset * dayColumnPercent + fractionOfDay * dayColumnPercent;

  return (
    <div
      className="absolute top-0 bottom-0 z-20 pointer-events-none"
      style={{
        left: `calc(${TIMELINE_GUTTER_WIDTH}px + (100% - ${TIMELINE_GUTTER_WIDTH}px) * ${leftPercent / 100})`,
        width: 2,
        background: "#597794",
      }}
    />
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function TimelineGrid({
  events,
  teamMembers,
  startDate,
  daysShown = TIMELINE_DAYS_SHOWN,
  onEventClick,
}: TimelineGridProps) {
  // ── Store ─────────────────────────────────────────────────────────────

  const selectedTaskId = useCalendarStore((s) => s.selectedTaskId);
  const selectedTaskIds = useCalendarStore((s) => s.selectedTaskIds);
  const setSidePanelTask = useCalendarStore((s) => s.setSidePanelTask);

  // ── Context menu state ──────────────────────────────────────────────

  const [contextMenuEvent, setContextMenuEvent] =
    useState<InternalCalendarEvent | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // ── Mutations ─────────────────────────────────────────────────────────

  const updateCalendarEvent = useUpdateCalendarEvent();

  // ── DnD ───────────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const { handleDragStart, handleDragEnd, handleDragCancel } = useTimelineDnd({
    events,
    startDate,
    daysShown,
  });

  // ── Resize callback ───────────────────────────────────────────────────

  const handleResize = useCallback(
    (event: InternalCalendarEvent, newStart: Date, newEnd: Date) => {
      updateCalendarEvent.mutate({
        id: event.id,
        data: { startDate: newStart, endDate: newEnd },
      });
    },
    [updateCalendarEvent]
  );

  // ── Event handlers ────────────────────────────────────────────────────

  const handleEventClick = useCallback(
    (event: InternalCalendarEvent) => {
      setSidePanelTask(event.id);
      onEventClick?.(event);
    },
    [setSidePanelTask, onEventClick]
  );

  const handleContextMenu = useCallback(
    (event: InternalCalendarEvent, x: number, y: number) => {
      setContextMenuEvent(event);
      setContextMenuPosition({ x, y });
    },
    []
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenuEvent(null);
    setContextMenuPosition(null);
  }, []);

  // ── Helper: check if a task is selected ───────────────────────────────

  const isTaskSelected = useCallback(
    (eventId: string) =>
      selectedTaskId === eventId || selectedTaskIds.includes(eventId),
    [selectedTaskId, selectedTaskIds]
  );

  // Group events by team member ID
  const eventsByMember = useCallback(() => {
    const map = new Map<string, InternalCalendarEvent[]>();

    for (const event of events) {
      if (event.teamMemberIds.length === 0) {
        // Unassigned events
        const existing = map.get(UNASSIGNED_MEMBER.id) ?? [];
        existing.push(event);
        map.set(UNASSIGNED_MEMBER.id, existing);
      } else {
        // Events with team members appear in EACH member's row
        for (const memberId of event.teamMemberIds) {
          const existing = map.get(memberId) ?? [];
          existing.push(event);
          map.set(memberId, existing);
        }
      }
    }

    return map;
  }, [events]);

  const grouped = eventsByMember();

  // Check if today is visible (for current time indicator)
  const todayVisible = Array.from({ length: daysShown }).some((_, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return isToday(d);
  });

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex flex-col h-full overflow-hidden relative">
        {/* Header row — day labels */}
        <TimelineHeader startDate={startDate} daysShown={daysShown} />

        {/* Scrollable body */}
        <div className="flex-1 overflow-auto relative">
          {/* Current time indicator spans full height */}
          {todayVisible && (
            <CurrentTimeIndicator startDate={startDate} daysShown={daysShown} />
          )}

          {/* Team member rows */}
          {teamMembers.map((member) => {
            const memberEvents = grouped.get(member.id) ?? [];
            return (
              <DroppableTimelineRow
                key={member.id}
                teamMember={member}
                startDate={startDate}
                daysShown={daysShown}
              >
                {memberEvents.map((event) => (
                  <TimelineTaskBlock
                    key={event.id}
                    event={event}
                    startDate={startDate}
                    daysShown={daysShown}
                    isSelected={isTaskSelected(event.id)}
                    onClick={handleEventClick}
                    onContextMenu={handleContextMenu}
                    onResize={handleResize}
                  />
                ))}
              </DroppableTimelineRow>
            );
          })}

          {/* Unassigned row */}
          {(() => {
            const unassignedEvents = grouped.get(UNASSIGNED_MEMBER.id) ?? [];
            return (
              <DroppableTimelineRow
                teamMember={UNASSIGNED_MEMBER}
                startDate={startDate}
                daysShown={daysShown}
                isLast
              >
                {unassignedEvents.map((event) => (
                  <TimelineTaskBlock
                    key={event.id}
                    event={event}
                    startDate={startDate}
                    daysShown={daysShown}
                    isSelected={isTaskSelected(event.id)}
                    onClick={handleEventClick}
                    onContextMenu={handleContextMenu}
                    onResize={handleResize}
                  />
                ))}
              </DroppableTimelineRow>
            );
          })()}
        </div>
      </div>

      {/* Context menu */}
      <EventContextMenu
        event={contextMenuEvent}
        position={contextMenuPosition}
        onClose={handleCloseContextMenu}
        allEvents={events}
      />

      {/* Inline editor overlay */}
      <InlineEditor />
    </DndContext>
  );
}
