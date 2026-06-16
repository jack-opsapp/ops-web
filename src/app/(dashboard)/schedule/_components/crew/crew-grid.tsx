"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  isToday,
  getHours,
  getMinutes,
  format,
  differenceInCalendarDays,
} from "date-fns";
import { useDroppable } from "@dnd-kit/core";
import type { TeamMember } from "@/lib/types/models";
import type { InternalScheduleEvent } from "@/lib/utils/schedule-utils";
import { UserRole } from "@/lib/types/models";
import { CrewHeader } from "./crew-header";
import { CrewRow } from "./crew-row";
import { CrewTaskBlock } from "./crew-task-block";
import { EventContextMenu } from "../event-context-menu";
import { InlineEditor } from "../inline-editor";
import { useScheduleStore } from "@/stores/schedule-store";
import { useUpdateTask } from "@/lib/hooks";
import {
  CREW_DAYS_SHOWN,
  CREW_GUTTER_WIDTH,
  CREW_ROW_HEIGHT,
} from "@/lib/utils/crew-constants";
import { assignLanes, rowHeightForLanes } from "@/lib/utils/lane-assignment";

// ─── Special Events Placeholder ─────────────────────────────────────────────
//
// The bottom row in the crew view is reserved for SPECIAL EVENTS — non-task
// calendar items (personal events, time-off requests) that don't belong to
// a single crew member's swimlane. It also holds task events that lack any
// crew assignment so they don't disappear from the schedule.
//
// Renamed from "Unassigned" (bug 1ceb0789) — the prior label only accepted
// events with `teamMemberIds.length === 0`, hiding personal events with
// crew assignments from the operator's view.

const SPECIAL_EVENTS_MEMBER: TeamMember = {
  id: "__special_events__",
  userId: "__special_events__",
  firstName: "Special Events",
  lastName: "",
  email: null,
  phone: null,
  profileImageURL: null,
  role: UserRole.Crew,
  userColor: null,
  isActive: true,
};

// ─── Props ──────────────────────────────────────────────────────────────────

interface CrewGridProps {
  events: InternalScheduleEvent[];
  teamMembers: TeamMember[];
  startDate: Date;
  daysShown?: number;
  onEventClick?: (event: InternalScheduleEvent) => void;
}

// ─── Droppable Row Wrapper ──────────────────────────────────────────────────

/** Wraps each CrewRow so it is a valid droppable target for DnD */
function DroppableCrewRow({
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
        setGridWidth(Math.max(totalWidth - CREW_GUTTER_WIDTH, 0));
      }
    });
    resizeObserver.observe(rowRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  const { setNodeRef, isOver } = useDroppable({
    id: `crew-row-${teamMember.id}`,
    data: {
      type: "crew-row",
      teamMemberId: teamMember.id,
      gridWidth,
      // Bug 1b2942d5: bridge crew-row droppables into the outer
      // ScheduleDndShell so unscheduled-tray drags (registered in the
      // outer context) can target this row. Carrying startDate +
      // daysShown lets the shell's handleDragEnd compute the dropped
      // calendar day from horizontal pixel offset without prop-drilling.
      startDate,
      daysShown,
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
      <CrewRow
        teamMember={teamMember}
        startDate={startDate}
        daysShown={daysShown}
        isLast={isLast}
        rowHeight={rowHeight}
      >
        {children}
      </CrewRow>
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
        left: `calc(${CREW_GUTTER_WIDTH}px + (100% - ${CREW_GUTTER_WIDTH}px) * ${leftPercent / 100})`,
      }}
    >
      {/* Time label */}
      <div
        className="sticky top-0 -translate-x-1/2 z-30 px-[6px] py-[2px] rounded-b-sm"
        style={{ background: "var(--ops-accent)", width: "fit-content" }}
      >
        <span className="font-mohave text-micro font-semibold text-white whitespace-nowrap leading-none tracking-wide">
          {timeLabel}
        </span>
      </div>
      {/* Vertical line */}
      <div
        className="absolute top-0 bottom-0"
        style={{ width: 2, background: "var(--ops-accent)" }}
      />
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CrewGrid({
  events,
  teamMembers,
  startDate,
  daysShown = CREW_DAYS_SHOWN,
  onEventClick,
}: CrewGridProps) {
  // ── Store ─────────────────────────────────────────────────────────────

  const selectedTaskId = useScheduleStore((s) => s.selectedTaskId);
  const selectedTaskIds = useScheduleStore((s) => s.selectedTaskIds);

  // ── Context menu state ──────────────────────────────────────────────

  const [contextMenuEvent, setContextMenuEvent] =
    useState<InternalScheduleEvent | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // ── Mutations ─────────────────────────────────────────────────────────
  //
  // Bug 1b2942d5: drag-and-drop is now owned by the outer
  // ScheduleDndShell so cross-context drags (unscheduled-tray →
  // crew-row) work without forwarding. The crew-grid only handles the
  // local resize callback below — every other drag path lives in the
  // shell's handleDragEnd.

  const updateTask = useUpdateTask();

  // ── Resize callback ───────────────────────────────────────────────────

  const handleResize = useCallback(
    (event: InternalScheduleEvent, newStart: Date, newEnd: Date) => {
      updateTask.mutate({
        id: event.id,
        data: { startDate: newStart, endDate: newEnd },
      });
    },
    [updateTask]
  );

  // ── Event handlers ────────────────────────────────────────────────────

  const handleEventClick = useCallback(
    (event: InternalScheduleEvent) => {
      onEventClick?.(event);
    },
    [onEventClick]
  );

  const handleContextMenu = useCallback(
    (event: InternalScheduleEvent, x: number, y: number) => {
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

  // Group events by team member ID.
  //
  // Special Events row predicate (bug 1ceb0789):
  //   - All events of kind = "personal" or "time_off" land here — regardless
  //     of crew assignments. These are owner/operator-level items that don't
  //     belong to a single crew swimlane.
  //   - Task events with NO crew assignments also land here so they stay
  //     visible (legacy "unassigned" behavior preserved).
  //   - Task events WITH crew assignments still appear in each assigned
  //     member's row (and ALSO in the special events row when their kind
  //     is personal/time_off).
  const eventsByMember = useCallback(() => {
    const map = new Map<string, InternalScheduleEvent[]>();

    for (const event of events) {
      const isSpecial = event.kind === "personal" || event.kind === "time_off";
      const hasCrew = event.teamMemberIds.length > 0;

      if (isSpecial || !hasCrew) {
        // Personal / time_off events always show in Special Events. Tasks
        // with no crew also fall here so they don't disappear.
        const existing = map.get(SPECIAL_EVENTS_MEMBER.id) ?? [];
        existing.push(event);
        map.set(SPECIAL_EVENTS_MEMBER.id, existing);
      }

      if (hasCrew) {
        // Events with team members appear in EACH member's row. Special
        // events with crew assignments appear in BOTH the special row AND
        // every assigned member's row — they're owner-level items the
        // operator cares about across the whole grid.
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
    <>
      <div className="flex flex-col h-full overflow-hidden relative">
        {/* Header row — day labels */}
        <CrewHeader startDate={startDate} daysShown={daysShown} />

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
            const rowHeight = rowHeightForLanes(laneCount, CREW_ROW_HEIGHT);
            return (
              <DroppableCrewRow
                key={member.id}
                teamMember={member}
                startDate={startDate}
                daysShown={daysShown}
                rowHeight={rowHeight}
              >
                {memberEvents.map((event) => (
                  <CrewTaskBlock
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
              </DroppableCrewRow>
            );
          })}

          {/* Special Events row — personal events, time-off, and any task
              without a crew assignment. (Renamed from "Unassigned" — bug
              1ceb0789.) */}
          {(() => {
            const specialEvents = grouped.get(SPECIAL_EVENTS_MEMBER.id) ?? [];
            if (specialEvents.length === 0) return null;
            const { lanes, laneCount } = assignLanes(specialEvents);
            const rowHeight = rowHeightForLanes(laneCount, CREW_ROW_HEIGHT);
            return (
              <DroppableCrewRow
                teamMember={SPECIAL_EVENTS_MEMBER}
                startDate={startDate}
                daysShown={daysShown}
                isLast
                rowHeight={rowHeight}
              >
                {specialEvents.map((event) => (
                  <CrewTaskBlock
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
              </DroppableCrewRow>
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
    </>
  );
}
