"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { isToday, differenceInCalendarDays, getHours, getMinutes, format } from "date-fns";
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
import { useUpdateTask } from "@/lib/hooks";
import { useTimelineDnd } from "@/lib/hooks/use-timeline-dnd";
import {
  TIMELINE_DAYS_SHOWN,
  TIMELINE_DAY_MIN_WIDTH,
  TIMELINE_GUTTER_WIDTH,
  TIMELINE_ROW_HEIGHT,
} from "@/lib/utils/timeline-constants";

// ─── Lane assignment ────────────────────────────────────────────────────────

interface LaneAssignment {
  /** eventId → lane index */
  lanes: Map<string, number>;
  /** maximum number of overlapping lanes used */
  laneCount: number;
}

/**
 * Sweep-line lane assignment: events sorted by start date are placed into the
 * lowest-numbered lane whose previous event has already ended. Two events
 * count as overlapping when their inclusive [start, end] ranges intersect.
 */
function assignLanes(events: InternalCalendarEvent[]): LaneAssignment {
  if (events.length === 0) return { lanes: new Map(), laneCount: 1 };

  const sorted = [...events].sort(
    (a, b) => a.startDate.getTime() - b.startDate.getTime()
  );
  // laneEndTimes[i] = end timestamp of the latest event currently in lane i
  const laneEndTimes: number[] = [];
  const lanes = new Map<string, number>();

  for (const event of sorted) {
    const startMs = event.startDate.getTime();
    const endMs = event.endDate.getTime();
    let placed = false;

    for (let i = 0; i < laneEndTimes.length; i++) {
      // Overlap if this event starts on or before the lane's last event ends.
      // Use strict less-than so an event ending on day N can sit in the same
      // lane as one starting on day N+1 (back-to-back, not overlapping).
      if (laneEndTimes[i] < startMs) {
        lanes.set(event.id, i);
        laneEndTimes[i] = endMs;
        placed = true;
        break;
      }
    }

    if (!placed) {
      lanes.set(event.id, laneEndTimes.length);
      laneEndTimes.push(endMs);
    }
  }

  return { lanes, laneCount: Math.max(laneEndTimes.length, 1) };
}

/**
 * Decide row height given a lane count. Each lane is allotted ≥24px so labels
 * stay readable; rows always honor the base TIMELINE_ROW_HEIGHT minimum.
 */
function rowHeightForLanes(laneCount: number): number {
  const MIN_LANE_HEIGHT = 24;
  const VERTICAL_PADDING = 16; // 8px top + 8px bottom
  const LANE_GAP = 4;
  const computed =
    VERTICAL_PADDING + laneCount * MIN_LANE_HEIGHT + Math.max(laneCount - 1, 0) * LANE_GAP;
  return Math.max(TIMELINE_ROW_HEIGHT, computed);
}

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
  rowHeight,
  children,
}: {
  teamMember: TeamMember;
  startDate: Date;
  daysShown: number;
  isLast?: boolean;
  rowHeight?: number;
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
        outline: isOver ? "1px solid rgba(111, 148, 176,0.4)" : "none",
        outlineOffset: -1,
      }}
    >
      <TimelineRow
        teamMember={teamMember}
        startDate={startDate}
        daysShown={daysShown}
        isLast={isLast}
        rowHeight={rowHeight}
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

  const timeLabel = format(now, "h:mm a");

  return (
    <div
      className="absolute top-0 bottom-0 z-20 pointer-events-none"
      style={{
        left: `calc(${TIMELINE_GUTTER_WIDTH}px + (100% - ${TIMELINE_GUTTER_WIDTH}px) * ${leftPercent / 100})`,
      }}
    >
      {/* Time label */}
      <div
        className="sticky top-0 -translate-x-1/2 z-30 px-[6px] py-[2px] rounded-b-sm"
        style={{ background: "#6F94B0", width: "fit-content" }}
      >
        <span className="font-mohave text-micro font-semibold text-white whitespace-nowrap leading-none tracking-wide">
          {timeLabel}
        </span>
      </div>
      {/* Vertical line */}
      <div
        className="absolute top-0 bottom-0"
        style={{ width: 2, background: "#6F94B0" }}
      />
    </div>
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

  // ── Context menu state ──────────────────────────────────────────────

  const [contextMenuEvent, setContextMenuEvent] =
    useState<InternalCalendarEvent | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // ── Mutations ─────────────────────────────────────────────────────────

  const updateTask = useUpdateTask();

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
      updateTask.mutate({
        id: event.id,
        data: { startDate: newStart, endDate: newEnd },
      });
    },
    [updateTask]
  );

  // ── Event handlers ────────────────────────────────────────────────────

  const handleEventClick = useCallback(
    (event: InternalCalendarEvent) => {
      onEventClick?.(event);
    },
    [onEventClick]
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
            const { lanes, laneCount } = assignLanes(memberEvents);
            const rowHeight = rowHeightForLanes(laneCount);
            return (
              <DroppableTimelineRow
                key={member.id}
                teamMember={member}
                startDate={startDate}
                daysShown={daysShown}
                rowHeight={rowHeight}
              >
                {memberEvents.map((event) => (
                  <TimelineTaskBlock
                    key={event.id}
                    event={event}
                    startDate={startDate}
                    daysShown={daysShown}
                    isSelected={isTaskSelected(event.id)}
                    laneIndex={lanes.get(event.id) ?? 0}
                    laneCount={laneCount}
                    rowHeight={rowHeight}
                    onClick={handleEventClick}
                    onContextMenu={handleContextMenu}
                    onResize={handleResize}
                  />
                ))}
              </DroppableTimelineRow>
            );
          })}

          {/* Unassigned row — only shown when tasks lack team member assignments */}
          {(() => {
            const unassignedEvents = grouped.get(UNASSIGNED_MEMBER.id) ?? [];
            if (unassignedEvents.length === 0) return null;
            const { lanes, laneCount } = assignLanes(unassignedEvents);
            const rowHeight = rowHeightForLanes(laneCount);
            return (
              <DroppableTimelineRow
                teamMember={UNASSIGNED_MEMBER}
                startDate={startDate}
                daysShown={daysShown}
                isLast
                rowHeight={rowHeight}
              >
                {unassignedEvents.map((event) => (
                  <TimelineTaskBlock
                    key={event.id}
                    event={event}
                    startDate={startDate}
                    daysShown={daysShown}
                    isSelected={isTaskSelected(event.id)}
                    laneIndex={lanes.get(event.id) ?? 0}
                    laneCount={laneCount}
                    rowHeight={rowHeight}
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
