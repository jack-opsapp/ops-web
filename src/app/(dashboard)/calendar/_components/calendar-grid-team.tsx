"use client";

import { useRef, useEffect, useMemo } from "react";
import { format, getHours, differenceInMinutes } from "date-fns";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils/cn";
import { HOURS, HOUR_HEIGHT } from "@/lib/utils/calendar-constants";
import {
  type InternalCalendarEvent,
  formatHour,
  formatTime24,
  getEventColors,
} from "@/lib/utils/calendar-utils";
import { useTeamMembers } from "@/lib/hooks";

// ─── Constants ───────────────────────────────────────────────────────────────

const ROW_HEIGHT = 56;
const MEMBER_GUTTER_WIDTH = 180;
const HOUR_COLUMN_WIDTH = 80;

// ─── Types ───────────────────────────────────────────────────────────────────

interface CalendarGridTeamProps {
  currentDate: Date;
  events: InternalCalendarEvent[];
  conflictIds?: Set<string>;
  onEventClick?: (event: InternalCalendarEvent) => void;
  onEventContextMenu?: (event: InternalCalendarEvent, x: number, y: number) => void;
  t: (key: string) => string;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function CalendarGridTeam({
  currentDate,
  events,
  conflictIds,
  onEventClick,
  onEventContextMenu,
  t,
}: CalendarGridTeamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { data: teamData } = useTeamMembers();
  const members = useMemo(() => teamData?.users ?? [], [teamData]);

  // Build events map keyed by member ID
  const memberEventsMap = useMemo(() => {
    const map = new Map<string, InternalCalendarEvent[]>();
    for (const member of members) {
      map.set(member.id, []);
    }
    // Unassigned row
    map.set("__unassigned__", []);

    for (const event of events) {
      if (event.teamMemberIds.length === 0) {
        map.get("__unassigned__")!.push(event);
      } else {
        for (const memberId of event.teamMemberIds) {
          if (!map.has(memberId)) {
            map.set(memberId, []);
          }
          map.get(memberId)!.push(event);
        }
      }
    }

    return map;
  }, [members, events]);

  // Build rows: members + unassigned
  const rows = useMemo(() => {
    const result: { id: string; label: string; sublabel?: string; avatar?: string | null; events: InternalCalendarEvent[] }[] = [];

    for (const member of members) {
      result.push({
        id: member.id,
        label: `${member.firstName} ${member.lastName}`,
        sublabel: member.role,
        avatar: member.profileImageURL,
        events: memberEventsMap.get(member.id) ?? [],
      });
    }

    const unassigned = memberEventsMap.get("__unassigned__") ?? [];
    if (unassigned.length > 0) {
      result.push({
        id: "__unassigned__",
        label: t("team.unassigned"),
        events: unassigned,
      });
    }

    return result;
  }, [members, memberEventsMap]);

  // Scroll to current hour on mount
  useEffect(() => {
    if (scrollRef.current) {
      const now = new Date();
      const hour = getHours(now);
      const scrollTo = Math.max(0, (hour - 7) * HOUR_COLUMN_WIDTH);
      scrollRef.current.scrollLeft = scrollTo;
    }
  }, []);

  const totalWidth = HOURS.length * HOUR_COLUMN_WIDTH;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header bar */}
      <div className="flex items-center px-3 py-1.5 border-b border-border shrink-0">
        <span className="font-mohave text-heading text-text-primary">
          {t("view.team") || "Team"} &mdash;{" "}
        </span>
        <span className="font-mono text-data text-text-secondary ml-1">
          {format(currentDate, "EEEE, MMMM d, yyyy")}
        </span>
        <span className="font-mono text-data-sm text-text-disabled ml-auto">
          {rows.length} {rows.length === 1 ? t("team.member") : t("team.members")}
        </span>
      </div>

      {/* Body: fixed member gutter + scrollable timeline */}
      <div className="flex flex-1 min-h-0">
        {/* Member gutter (fixed) */}
        <div
          className="shrink-0 border-r border-border bg-background-panel overflow-y-auto"
          style={{ width: MEMBER_GUTTER_WIDTH }}
        >
          {/* Header spacer matching hour headers */}
          <div className="h-[28px] border-b border-border-subtle" />

          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center gap-2 px-2 border-b border-border-subtle"
              style={{ height: ROW_HEIGHT }}
            >
              {row.avatar ? (
                <img
                  src={row.avatar}
                  alt=""
                  className="w-[24px] h-[24px] rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="w-[24px] h-[24px] rounded-full bg-background-elevated shrink-0 flex items-center justify-center">
                  <span className="font-mono text-[9px] text-text-disabled">
                    {row.label.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <div className="flex flex-col min-w-0">
                <span className="font-mohave text-body-sm text-text-primary truncate">
                  {row.label}
                </span>
                {row.sublabel && (
                  <span className="font-mono text-[9px] text-text-disabled truncate">
                    {row.sublabel}
                  </span>
                )}
              </div>
              {row.events.length > 0 && (
                <span className="font-mono text-[9px] text-ops-accent ml-auto shrink-0">
                  {row.events.length}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Scrollable timeline */}
        <div ref={scrollRef} className="flex-1 overflow-auto min-h-0 min-w-0">
          <div style={{ width: totalWidth }}>
            {/* Hour headers */}
            <div className="flex border-b border-border-subtle sticky top-0 bg-background-panel z-10 h-[28px]">
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="border-r border-border-subtle flex items-center justify-center shrink-0"
                  style={{ width: HOUR_COLUMN_WIDTH }}
                >
                  <span className="font-mono text-[10px] text-text-disabled select-none">
                    {formatHour(hour)}
                  </span>
                </div>
              ))}
            </div>

            {/* Rows */}
            {rows.map((row) => (
              <TeamTimelineRow
                key={row.id}
                events={row.events}
                currentDate={currentDate}
                conflictIds={conflictIds}
                onEventClick={onEventClick}
                onEventContextMenu={onEventContextMenu}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Timeline Row ────────────────────────────────────────────────────────────

function TeamTimelineRow({
  events,
  currentDate,
  conflictIds,
  onEventClick,
  onEventContextMenu,
}: {
  events: InternalCalendarEvent[];
  currentDate: Date;
  conflictIds?: Set<string>;
  onEventClick?: (event: InternalCalendarEvent) => void;
  onEventContextMenu?: (event: InternalCalendarEvent, x: number, y: number) => void;
}) {
  const totalWidth = HOURS.length * HOUR_COLUMN_WIDTH;
  const firstHour = HOURS[0];

  // Compute workload: total scheduled hours for heatmap background
  const totalScheduledMinutes = events.reduce((sum, e) => {
    return sum + differenceInMinutes(e.endDate, e.startDate);
  }, 0);
  // 8 hours = fully loaded; map to 0-0.12 opacity
  const workloadOpacity = Math.min(totalScheduledMinutes / 480, 1) * 0.12;

  return (
    <div
      className="relative border-b border-border-subtle"
      style={{ height: ROW_HEIGHT }}
    >
      {/* Workload heatmap background */}
      {workloadOpacity > 0 && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ backgroundColor: `rgba(65, 115, 148, ${workloadOpacity})` }}
        />
      )}

      {/* Hour grid lines */}
      {HOURS.map((hour) => (
        <div
          key={hour}
          className="absolute top-0 bottom-0 border-r border-border-subtle/50"
          style={{ left: (hour - firstHour) * HOUR_COLUMN_WIDTH }}
        />
      ))}

      {/* Events as horizontal bars (draggable) */}
      {events.map((event) => (
        <TeamEventBar
          key={event.id}
          event={event}
          firstHour={firstHour}
          hasConflict={conflictIds?.has(event.id)}
          onEventClick={onEventClick}
          onEventContextMenu={onEventContextMenu}
        />
      ))}
    </div>
  );
}

// ─── Draggable Team Event Bar ─────────────────────────────────────────────────

function TeamEventBar({
  event,
  firstHour,
  hasConflict,
  onEventClick,
  onEventContextMenu,
}: {
  event: InternalCalendarEvent;
  firstHour: number;
  hasConflict?: boolean;
  onEventClick?: (event: InternalCalendarEvent) => void;
  onEventContextMenu?: (event: InternalCalendarEvent, x: number, y: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: event.id,
      data: { event },
    });

  const colors = getEventColors(event.taskType);
  const eventStartHour = getHours(event.startDate) + event.startDate.getMinutes() / 60;
  const durationMinutes = differenceInMinutes(event.endDate, event.startDate);
  const durationHours = Math.max(durationMinutes / 60, 0.25);

  const left = (eventStartHour - firstHour) * HOUR_COLUMN_WIDTH;
  const width = durationHours * HOUR_COLUMN_WIDTH;

  const dragStyle = transform
    ? { transform: `translate3d(${transform.x}px, 0px, 0)` } // Constrain to horizontal
    : undefined;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "absolute top-[4px] rounded-sm cursor-grab transition-all duration-100",
        "hover:brightness-125 hover:shadow-elevated hover:z-20",
        "overflow-hidden",
        isDragging && "opacity-40 border-dashed cursor-grabbing z-40",
        hasConflict && "ring-1 ring-red-500/60 shadow-[0_0_8px_rgba(239,68,68,0.3)]"
      )}
      style={{
        left: `${left}px`,
        width: `${width}px`,
        height: ROW_HEIGHT - 8,
        backgroundColor: colors.bg,
        borderLeft: `3px solid ${colors.border}`,
        zIndex: isDragging ? 40 : 10,
        ...dragStyle,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onEventClick?.(event);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onEventContextMenu?.(event, e.clientX, e.clientY);
      }}
    >
      <div className="px-[6px] py-[3px] h-full flex items-center gap-[6px] overflow-hidden">
        <span
          className="font-mono text-[10px] shrink-0"
          style={{ color: `${colors.text}99` }}
        >
          {formatTime24(event.startDate)}
        </span>
        <span
          className="font-mohave text-[12px] truncate"
          style={{ color: colors.text }}
        >
          {event.title}
        </span>
        {event.project && width > 200 && (
          <span
            className="font-mohave text-[10px] truncate opacity-60 ml-auto"
            style={{ color: colors.text }}
          >
            {event.project}
          </span>
        )}
      </div>
    </div>
  );
}
