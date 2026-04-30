"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import { isToday, differenceInCalendarDays, getHours, getMinutes, format } from "date-fns";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from "@dnd-kit/core";
import type { ProjectTask, TeamMember } from "@/lib/types/models";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import { UserRole } from "@/lib/types/models";
import { CrewHeader } from "./crew-header";
import { CrewRow } from "./crew-row";
import { CrewTaskBlock } from "./crew-task-block";
import { EventContextMenu } from "../event-context-menu";
import { InlineEditor } from "../inline-editor";
import { useCalendarStore } from "@/stores/calendar-store";
import { useRecurrenceEditPrompt } from "@/components/ui/recurrence-edit-prompt";
import { useUpdateTask, useTasks, useRecurrenceEdit } from "@/lib/hooks";
import { useCrewDnd } from "@/lib/hooks/use-crew-dnd";
import {
  CREW_DAYS_SHOWN,
  CREW_DAY_MIN_WIDTH,
  CREW_GUTTER_WIDTH,
  CREW_ROW_HEIGHT,
} from "@/lib/utils/crew-constants";
import { assignLanes, rowHeightForLanes } from "@/lib/utils/lane-assignment";

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

interface CrewGridProps {
  events: InternalCalendarEvent[];
  teamMembers: TeamMember[];
  startDate: Date;
  daysShown?: number;
  onEventClick?: (event: InternalCalendarEvent) => void;
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

export function CrewGrid({
  events,
  teamMembers,
  startDate,
  daysShown = CREW_DAYS_SHOWN,
  onEventClick,
}: CrewGridProps) {
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
  const recurrenceEdit = useRecurrenceEdit();
  const recurrencePrompt = useRecurrenceEditPrompt();

  // Phase 3 — full task lookup so the DnD hook can detect series membership.
  const { data: taskData } = useTasks();
  const tasksById = useMemo(() => {
    const map = new Map<string, ProjectTask>();
    for (const t of taskData?.tasks ?? []) {
      map.set(t.id, t);
    }
    return map;
  }, [taskData]);

  const handleRecurringEdit = useCallback(
    async ({
      event,
      patch,
    }: {
      event: InternalCalendarEvent;
      patch: Partial<ProjectTask>;
    }): Promise<boolean> => {
      const task = tasksById.get(event.id);
      if (!task) return false;
      const scope = await recurrencePrompt.request({
        description: "Move this occurrence, or shift the entire series?",
      });
      if (!scope) return false;
      try {
        await new Promise<void>((resolve, reject) => {
          recurrenceEdit.mutate(
            { task, scope, patch },
            {
              onSuccess: () => resolve(),
              onError: (err) => reject(err),
            }
          );
        });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        toast.error("Failed to move recurring task", { description: message });
        return false;
      }
    },
    [tasksById, recurrencePrompt, recurrenceEdit]
  );

  // ── DnD ───────────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const { handleDragStart, handleDragEnd, handleDragCancel } = useCrewDnd({
    events,
    startDate,
    daysShown,
    onRecurringEdit: handleRecurringEdit,
    tasksById,
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

          {/* Unassigned row — only shown when tasks lack team member assignments */}
          {(() => {
            const unassignedEvents = grouped.get(UNASSIGNED_MEMBER.id) ?? [];
            if (unassignedEvents.length === 0) return null;
            const { lanes, laneCount } = assignLanes(unassignedEvents);
            const rowHeight = rowHeightForLanes(laneCount, CREW_ROW_HEIGHT);
            return (
              <DroppableCrewRow
                teamMember={UNASSIGNED_MEMBER}
                startDate={startDate}
                daysShown={daysShown}
                isLast
                rowHeight={rowHeight}
              >
                {unassignedEvents.map((event) => (
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

      {/* Phase 3 — recurrence scope prompt for drag-rescheduled series tasks */}
      {recurrencePrompt.promptElement}
    </DndContext>
  );
}
