"use client";

import { useMemo } from "react";
import { format, isSameDay, addDays, startOfDay } from "date-fns";
import { User, Clock } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  type InternalCalendarEvent,
  getEventColors,
  formatTime24,
} from "@/lib/utils/calendar-utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CalendarAgendaProps {
  currentDate: Date;
  events: InternalCalendarEvent[];
  onEventClick?: (event: InternalCalendarEvent) => void;
  t: (key: string) => string;
}

interface DayGroup {
  date: Date;
  events: InternalCalendarEvent[];
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function CalendarAgenda({
  currentDate,
  events,
  onEventClick,
  t,
}: CalendarAgendaProps) {
  // Group events by day, sorted chronologically, for the next 14 days from currentDate
  const dayGroups = useMemo(() => {
    const groups: DayGroup[] = [];
    const start = startOfDay(currentDate);

    for (let i = 0; i < 14; i++) {
      const day = addDays(start, i);
      const dayEvents = events
        .filter((e) => isSameDay(e.startDate, day))
        .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

      groups.push({ date: day, events: dayEvents });
    }

    return groups;
  }, [currentDate, events]);

  const totalEvents = dayGroups.reduce((sum, g) => sum + g.events.length, 0);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
        <span className="font-mohave text-heading text-text-primary">
          {t("view.agenda") || "Agenda"}
        </span>
        <span className="font-mono text-data-sm text-text-disabled">
          {totalEvents === 1 ? t("eventCount").replace("{count}", "1") : t("eventCountPlural").replace("{count}", String(totalEvents))} &middot; {t("agenda.days")}
        </span>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {dayGroups.map((group) => (
          <AgendaDayGroup
            key={group.date.toISOString()}
            group={group}
            onEventClick={onEventClick}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Day Group ───────────────────────────────────────────────────────────────

function AgendaDayGroup({
  group,
  onEventClick,
  t,
}: {
  group: DayGroup;
  onEventClick?: (event: InternalCalendarEvent) => void;
  t: (key: string) => string;
}) {
  const isToday = isSameDay(group.date, new Date());

  return (
    <div>
      {/* Sticky date header */}
      <div
        className={cn(
          "sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 border-b border-border-subtle",
          isToday
            ? "bg-ops-accent-muted/15"
            : "bg-background-panel"
        )}
      >
        <span
          className={cn(
            "font-mohave text-body-sm",
            isToday ? "text-ops-accent" : "text-text-primary"
          )}
        >
          {format(group.date, "EEEE")}
        </span>
        <span className="font-mono text-data-sm text-text-secondary">
          {format(group.date, "MMMM d")}
        </span>
        {isToday && (
          <span className="font-kosugi text-[9px] text-ops-accent bg-ops-accent-muted px-[6px] py-[1px] rounded-sm uppercase tracking-widest">
            {t("today")}
          </span>
        )}
        <span className="font-mono text-[10px] text-text-disabled ml-auto">
          {group.events.length > 0 ? `${group.events.length}` : ""}
        </span>
      </div>

      {/* Events or empty */}
      {group.events.length === 0 ? (
        <div className="px-3 py-2">
          <span className="font-mono text-[10px] text-text-disabled">
            {t("empty.day")}
          </span>
        </div>
      ) : (
        <div className="flex flex-col">
          {group.events.map((event) => (
            <AgendaEventCard
              key={event.id}
              event={event}
              onClick={onEventClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Event Card ──────────────────────────────────────────────────────────────

function AgendaEventCard({
  event,
  onClick,
}: {
  event: InternalCalendarEvent;
  onClick?: (event: InternalCalendarEvent) => void;
}) {
  const colors = getEventColors(event.taskType);

  return (
    <button
      onClick={() => onClick?.(event)}
      className={cn(
        "w-full text-left px-3 py-2 border-b border-border-subtle/50",
        "hover:bg-background-elevated/30 transition-colors",
        "flex items-start gap-3"
      )}
    >
      {/* Color indicator */}
      <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
        <div
          className="w-[10px] h-[10px] rounded-full"
          style={{ backgroundColor: colors.border }}
        />
        <div
          className="w-[2px] flex-1 rounded-full min-h-[20px]"
          style={{ backgroundColor: `${colors.border}40` }}
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mohave text-body text-text-primary truncate">
            {event.title}
          </span>
          <span
            className="font-kosugi text-[8px] uppercase tracking-widest px-[6px] py-[1px] rounded-sm shrink-0"
            style={{
              backgroundColor: colors.bg,
              color: colors.text,
            }}
          >
            {event.taskType}
          </span>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Time */}
          <div className="flex items-center gap-1">
            <Clock className="w-[11px] h-[11px] text-text-disabled" />
            <span className="font-mono text-[11px] text-text-secondary">
              {formatTime24(event.startDate)} - {formatTime24(event.endDate)}
            </span>
          </div>

          {/* Project */}
          {event.project && (
            <span className="font-mono text-[11px] text-text-tertiary truncate max-w-[200px]">
              {event.project}
            </span>
          )}

          {/* Team */}
          {event.teamMember && (
            <div className="flex items-center gap-1">
              <User className="w-[11px] h-[11px] text-text-disabled" />
              <span className="font-mono text-[11px] text-text-tertiary">
                {event.teamMember}
              </span>
            </div>
          )}

        </div>
      </div>
    </button>
  );
}
