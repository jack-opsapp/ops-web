"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Clock,
  User,
  MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  addDays,
  addMonths,
  addWeeks,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  isToday,
  subMonths,
  subWeeks,
  subDays,
  differenceInMinutes,
  isAfter,
  isBefore,
  getHours,
  getMinutes,
} from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type CalendarView = "month" | "week" | "day";

interface CalendarEvent {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  color: string;
  taskType: string;
  teamMember?: string;
  project?: string;
  location?: string;
}

// ─── Task Type Color Map ──────────────────────────────────────────────────────

const TASK_TYPE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  installation: {
    bg: "rgba(147, 26, 50, 0.25)",
    border: "#931A32",
    text: "#E8899A",
  },
  material: {
    bg: "rgba(196, 168, 104, 0.25)",
    border: "#C4A868",
    text: "#E8D9A8",
  },
  estimate: {
    bg: "rgba(165, 179, 104, 0.25)",
    border: "#A5B368",
    text: "#CDD8A8",
  },
  inspection: {
    bg: "rgba(123, 104, 166, 0.25)",
    border: "#7B68A6",
    text: "#BDB0D8",
  },
  quote: {
    bg: "rgba(89, 119, 159, 0.25)",
    border: "#59779F",
    text: "#A8C0D8",
  },
  completion: {
    bg: "rgba(74, 74, 74, 0.35)",
    border: "#4A4A4A",
    text: "#AAAAAA",
  },
};

function getEventColors(taskType: string) {
  return TASK_TYPE_COLORS[taskType] ?? TASK_TYPE_COLORS.quote;
}

// ─── Placeholder Events ──────────────────────────────────────────────────────

const placeholderEvents: CalendarEvent[] = [
  {
    id: "e1",
    title: "Kitchen Demo - Smith",
    startDate: new Date(2026, 1, 15, 9, 0),
    endDate: new Date(2026, 1, 15, 12, 0),
    color: "#931A32",
    taskType: "installation",
    teamMember: "Mike D.",
    project: "Smith Kitchen Reno",
    location: "142 Oak Ave",
  },
  {
    id: "e2",
    title: "Material Pickup",
    startDate: new Date(2026, 1, 16, 7, 0),
    endDate: new Date(2026, 1, 16, 8, 30),
    color: "#C4A868",
    taskType: "material",
    teamMember: "Sarah L.",
    project: "Smith Kitchen Reno",
    location: "HD Supply Warehouse",
  },
  {
    id: "e3",
    title: "Estimate: Doe Property",
    startDate: new Date(2026, 1, 18, 10, 0),
    endDate: new Date(2026, 1, 18, 11, 30),
    color: "#A5B368",
    taskType: "estimate",
    teamMember: "Mike D.",
    project: "Doe Bathroom",
    location: "88 Elm St",
  },
  {
    id: "e4",
    title: "Site Survey - Park Ave",
    startDate: new Date(2026, 1, 18, 14, 0),
    endDate: new Date(2026, 1, 18, 15, 0),
    color: "#59779F",
    taskType: "quote",
    teamMember: "Sarah L.",
    project: "Park Ave Office",
    location: "310 Park Ave",
  },
  {
    id: "e5",
    title: "Inspection - Johnson",
    startDate: new Date(2026, 1, 20, 8, 0),
    endDate: new Date(2026, 1, 20, 9, 30),
    color: "#7B68A6",
    taskType: "inspection",
    teamMember: "Sarah L.",
    project: "Johnson Deck",
    location: "56 Maple Dr",
  },
  {
    id: "e6",
    title: "Cabinet Install - Day 1",
    startDate: new Date(2026, 1, 21, 8, 0),
    endDate: new Date(2026, 1, 21, 17, 0),
    color: "#931A32",
    taskType: "installation",
    teamMember: "Mike D.",
    project: "Smith Kitchen Reno",
    location: "142 Oak Ave",
  },
  {
    id: "e7",
    title: "Cabinet Install - Day 2",
    startDate: new Date(2026, 1, 22, 8, 0),
    endDate: new Date(2026, 1, 22, 17, 0),
    color: "#931A32",
    taskType: "installation",
    teamMember: "Mike D.",
    project: "Smith Kitchen Reno",
    location: "142 Oak Ave",
  },
  {
    id: "e8",
    title: "Flooring Delivery",
    startDate: new Date(2026, 1, 15, 14, 0),
    endDate: new Date(2026, 1, 15, 15, 30),
    color: "#C4A868",
    taskType: "material",
    teamMember: "Sarah L.",
    project: "Johnson Deck",
  },
  {
    id: "e9",
    title: "Final Walkthrough",
    startDate: new Date(2026, 1, 25, 10, 0),
    endDate: new Date(2026, 1, 25, 11, 0),
    color: "#4A4A4A",
    taskType: "completion",
    teamMember: "Mike D.",
    project: "Park Ave Office",
    location: "310 Park Ave",
  },
  {
    id: "e10",
    title: "Plumbing Quote",
    startDate: new Date(2026, 1, 24, 13, 0),
    endDate: new Date(2026, 1, 24, 14, 30),
    color: "#59779F",
    taskType: "quote",
    teamMember: "Sarah L.",
    project: "New Build - Harris",
    location: "221 River Rd",
  },
];

// ─── Constants ────────────────────────────────────────────────────────────────

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 6 AM to 10 PM
const HOUR_HEIGHT = 60; // pixels per hour in week/day view
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ─── Utility Functions ────────────────────────────────────────────────────────

function formatHour(hour: number): string {
  if (hour === 0 || hour === 24) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

function formatTime24(date: Date): string {
  return `${getHours(date).toString().padStart(2, "0")}:${getMinutes(date).toString().padStart(2, "0")}`;
}

function getEventTopOffset(date: Date): number {
  const hours = getHours(date);
  const minutes = getMinutes(date);
  return ((hours - 6) * HOUR_HEIGHT) + (minutes / 60) * HOUR_HEIGHT;
}

function getEventHeight(start: Date, end: Date): number {
  const minutes = differenceInMinutes(end, start);
  return Math.max((minutes / 60) * HOUR_HEIGHT, 24);
}

function getCurrentTimeOffset(): number {
  const now = new Date();
  const hours = getHours(now);
  const minutes = getMinutes(now);
  return ((hours - 6) * HOUR_HEIGHT) + (minutes / 60) * HOUR_HEIGHT;
}

function getEventsForDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  return events.filter((e) => isSameDay(e.startDate, day));
}

// ─── Event Tooltip ────────────────────────────────────────────────────────────

function EventTooltipContent({ event }: { event: CalendarEvent }) {
  const colors = getEventColors(event.taskType);
  return (
    <div className="min-w-[200px] space-y-[6px]">
      <div className="flex items-center gap-[6px]">
        <div
          className="w-[8px] h-[8px] rounded-full shrink-0"
          style={{ backgroundColor: colors.border }}
        />
        <span className="font-mohave text-body-sm text-text-primary">
          {event.title}
        </span>
      </div>
      <div className="space-y-[3px] pl-[14px]">
        <div className="flex items-center gap-[4px]">
          <Clock className="w-[11px] h-[11px] text-text-tertiary" />
          <span className="font-mono text-[11px] text-text-secondary">
            {formatTime24(event.startDate)} - {formatTime24(event.endDate)}
          </span>
        </div>
        {event.project && (
          <div className="flex items-center gap-[4px]">
            <CalendarIcon className="w-[11px] h-[11px] text-text-tertiary" />
            <span className="font-mohave text-[12px] text-text-secondary">
              {event.project}
            </span>
          </div>
        )}
        {event.teamMember && (
          <div className="flex items-center gap-[4px]">
            <User className="w-[11px] h-[11px] text-text-tertiary" />
            <span className="font-mohave text-[12px] text-text-secondary">
              {event.teamMember}
            </span>
          </div>
        )}
        {event.location && (
          <div className="flex items-center gap-[4px]">
            <MapPin className="w-[11px] h-[11px] text-text-tertiary" />
            <span className="font-mohave text-[12px] text-text-secondary">
              {event.location}
            </span>
          </div>
        )}
      </div>
      <div className="pl-[14px]">
        <span
          className="inline-block font-kosugi text-[9px] uppercase tracking-widest px-[6px] py-[2px] rounded-sm"
          style={{
            backgroundColor: colors.bg,
            color: colors.text,
            border: `1px solid ${colors.border}40`,
          }}
        >
          {event.taskType}
        </span>
      </div>
    </div>
  );
}

// ─── Current Time Indicator ───────────────────────────────────────────────────

function CurrentTimeIndicator() {
  const [offset, setOffset] = useState(getCurrentTimeOffset());

  useEffect(() => {
    const interval = setInterval(() => {
      setOffset(getCurrentTimeOffset());
    }, 60000); // update every minute
    return () => clearInterval(interval);
  }, []);

  // Only show if within visible range (6 AM to 10 PM)
  const now = new Date();
  const currentHour = getHours(now);
  if (currentHour < 6 || currentHour >= 22) return null;

  return (
    <div
      className="absolute left-0 right-0 z-20 pointer-events-none"
      style={{ top: `${offset}px` }}
    >
      <div className="relative flex items-center">
        <div className="w-[8px] h-[8px] rounded-full bg-red-500 -ml-[4px] shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
        <div className="flex-1 h-[1.5px] bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.4)]" />
      </div>
    </div>
  );
}

// ─── Month View ───────────────────────────────────────────────────────────────

function MonthView({
  currentDate,
  events,
  onSelectDate,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  onSelectDate: (date: Date) => void;
}) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  const weeks = Math.ceil(days.length / 7);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-border shrink-0">
        {DAY_NAMES.map((day) => (
          <div
            key={day}
            className="px-1 py-[10px] text-center font-kosugi text-caption-sm text-text-tertiary uppercase tracking-[0.15em]"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div
        className="grid grid-cols-7 flex-1 min-h-0"
        style={{ gridTemplateRows: `repeat(${weeks}, 1fr)` }}
      >
        {days.map((day, i) => {
          const dayEvents = getEventsForDay(events, day);
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isCurrentDay = isToday(day);
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;

          return (
            <div
              key={i}
              onClick={() => onSelectDate(day)}
              className={cn(
                "border-b border-r border-border-subtle p-[6px] cursor-pointer transition-all duration-150 relative overflow-hidden group",
                "hover:bg-background-elevated/30",
                !isCurrentMonth && "opacity-30",
                isWeekend && isCurrentMonth && "bg-background-panel/50",
                isCurrentDay && "bg-ops-accent-muted/30"
              )}
              style={
                isCurrentDay
                  ? {
                      boxShadow:
                        "inset 0 0 20px rgba(65, 115, 148, 0.12), 0 0 8px rgba(65, 115, 148, 0.08)",
                    }
                  : undefined
              }
            >
              {/* Day number */}
              <div className="flex items-center justify-between mb-[4px]">
                <span
                  className={cn(
                    "font-mono text-data-sm transition-all duration-150",
                    isCurrentDay
                      ? "w-[26px] h-[26px] rounded-full bg-ops-accent text-white flex items-center justify-center text-[13px] font-semibold shadow-glow-accent"
                      : "text-text-secondary w-[26px] h-[26px] flex items-center justify-center"
                  )}
                >
                  {format(day, "d")}
                </span>
                {dayEvents.length > 0 && !isCurrentDay && (
                  <span className="font-mono text-[9px] text-text-disabled">
                    {dayEvents.length}
                  </span>
                )}
              </div>

              {/* Events */}
              <div className="space-y-[2px]">
                {dayEvents.slice(0, 3).map((event) => {
                  const colors = getEventColors(event.taskType);
                  return (
                    <TooltipProvider key={event.id} delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className="px-[6px] py-[3px] rounded-sm text-[11px] font-mohave truncate cursor-pointer transition-all duration-100 hover:brightness-125"
                            style={{
                              backgroundColor: colors.bg,
                              borderLeft: `2px solid ${colors.border}`,
                              color: colors.text,
                            }}
                          >
                            <span className="font-mono text-[9px] opacity-70 mr-[4px]">
                              {formatTime24(event.startDate)}
                            </span>
                            {event.title}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="right" align="start">
                          <EventTooltipContent event={event} />
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                })}
                {dayEvents.length > 3 && (
                  <span className="font-mono text-[10px] text-ops-accent px-[6px] hover:underline">
                    +{dayEvents.length - 3} more
                  </span>
                )}
              </div>

              {/* Hover indicator */}
              <div className="absolute inset-0 border border-transparent group-hover:border-ops-accent/20 rounded-sm pointer-events-none transition-colors duration-150" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Time Grid Column (shared by Week & Day) ─────────────────────────────────

function TimeGridColumn({
  day,
  events,
  isToday: columnIsToday,
  showFullDetail,
}: {
  day: Date;
  events: CalendarEvent[];
  isToday: boolean;
  showFullDetail?: boolean;
}) {
  const dayEvents = getEventsForDay(events, day);

  return (
    <div className="relative" style={{ height: `${HOURS.length * HOUR_HEIGHT}px` }}>
      {/* Hour grid lines */}
      {HOURS.map((hour) => (
        <div
          key={hour}
          className="absolute left-0 right-0 border-b border-border-subtle"
          style={{ top: `${(hour - 6) * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
        >
          {/* Half-hour line */}
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

      {/* Events */}
      {dayEvents.map((event) => {
        const colors = getEventColors(event.taskType);
        const top = getEventTopOffset(event.startDate);
        const height = getEventHeight(event.startDate, event.endDate);
        const isShort = height < 40;

        return (
          <TooltipProvider key={event.id} delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "absolute left-[3px] right-[3px] rounded-sm cursor-pointer transition-all duration-100",
                    "hover:brightness-125 hover:shadow-elevated hover:z-30",
                    "overflow-hidden"
                  )}
                  style={{
                    top: `${top}px`,
                    height: `${height}px`,
                    backgroundColor: colors.bg,
                    borderLeft: `3px solid ${colors.border}`,
                    zIndex: 10,
                  }}
                >
                  <div className={cn("p-[4px] h-full", isShort && "flex items-center gap-[6px]")}>
                    {isShort ? (
                      <>
                        <span
                          className="font-mono text-[10px] shrink-0"
                          style={{ color: `${colors.text}99` }}
                        >
                          {formatTime24(event.startDate)}
                        </span>
                        <span
                          className="font-mohave text-[11px] truncate"
                          style={{ color: colors.text }}
                        >
                          {event.title}
                        </span>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-[4px] mb-[2px]">
                          <span
                            className="font-mono text-[10px]"
                            style={{ color: `${colors.text}99` }}
                          >
                            {formatTime24(event.startDate)} - {formatTime24(event.endDate)}
                          </span>
                        </div>
                        <div
                          className="font-mohave text-[12px] leading-tight truncate"
                          style={{ color: colors.text }}
                        >
                          {event.title}
                        </div>
                        {showFullDetail && height >= 70 && (
                          <>
                            {event.project && (
                              <div
                                className="font-mohave text-[11px] mt-[2px] truncate opacity-70"
                                style={{ color: colors.text }}
                              >
                                {event.project}
                              </div>
                            )}
                            {event.teamMember && height >= 90 && (
                              <div className="flex items-center gap-[3px] mt-[3px]">
                                <User
                                  className="w-[10px] h-[10px]"
                                  style={{ color: `${colors.text}80` }}
                                />
                                <span
                                  className="font-kosugi text-[10px]"
                                  style={{ color: `${colors.text}99` }}
                                >
                                  {event.teamMember}
                                </span>
                              </div>
                            )}
                            {event.location && height >= 110 && (
                              <div className="flex items-center gap-[3px] mt-[2px]">
                                <MapPin
                                  className="w-[10px] h-[10px]"
                                  style={{ color: `${colors.text}80` }}
                                />
                                <span
                                  className="font-kosugi text-[10px]"
                                  style={{ color: `${colors.text}99` }}
                                >
                                  {event.location}
                                </span>
                              </div>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" align="start">
                <EventTooltipContent event={event} />
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })}
    </div>
  );
}

// ─── Week View ────────────────────────────────────────────────────────────────

function WeekView({
  currentDate,
  events,
  onSelectDate,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  onSelectDate: (date: Date) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const weekStart = startOfWeek(currentDate);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Auto-scroll to current time on mount
  useEffect(() => {
    if (scrollRef.current) {
      const now = new Date();
      const hour = getHours(now);
      const scrollTo = Math.max(0, (hour - 7) * HOUR_HEIGHT);
      scrollRef.current.scrollTop = scrollTo;
    }
  }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Day headers - sticky */}
      <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-border shrink-0">
        {/* Gutter corner */}
        <div className="border-r border-border-subtle" />

        {weekDays.map((day, i) => {
          const dayIsToday = isToday(day);
          const dayEventCount = getEventsForDay(events, day).length;

          return (
            <div
              key={i}
              onClick={() => onSelectDate(day)}
              className={cn(
                "px-[6px] py-[8px] text-center border-r border-border-subtle cursor-pointer transition-all duration-150",
                "hover:bg-background-elevated/30",
                dayIsToday && "bg-ops-accent-muted/20"
              )}
            >
              <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-[0.12em] block">
                {format(day, "EEE")}
              </span>
              <span
                className={cn(
                  "font-mono text-data mt-[3px] inline-flex items-center justify-center",
                  dayIsToday
                    ? "w-[30px] h-[30px] rounded-full bg-ops-accent text-white shadow-glow-accent font-semibold"
                    : "text-text-primary w-[30px] h-[30px]"
                )}
              >
                {format(day, "d")}
              </span>
              {dayEventCount > 0 && (
                <span
                  className={cn(
                    "block font-mono text-[9px] mt-[2px]",
                    dayIsToday ? "text-ops-accent" : "text-text-disabled"
                  )}
                >
                  {dayEventCount} event{dayEventCount !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        <div className="grid grid-cols-[56px_repeat(7,1fr)]">
          {/* Time gutter */}
          <div className="relative border-r border-border-subtle" style={{ height: `${HOURS.length * HOUR_HEIGHT}px` }}>
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="absolute left-0 right-0 flex items-start justify-end pr-[6px]"
                style={{ top: `${(hour - 6) * HOUR_HEIGHT}px` }}
              >
                <span className="font-mono text-[10px] text-text-disabled -mt-[6px] select-none">
                  {formatHour(hour)}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDays.map((day, i) => (
            <div key={i} className="border-r border-border-subtle">
              <TimeGridColumn
                day={day}
                events={events}
                isToday={isToday(day)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Day View ─────────────────────────────────────────────────────────────────

function DayView({
  currentDate,
  events,
}: {
  currentDate: Date;
  events: CalendarEvent[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dayEvents = getEventsForDay(events, currentDate);
  const dayIsToday = isToday(currentDate);

  // Auto-scroll to current time on mount
  useEffect(() => {
    if (scrollRef.current) {
      const now = new Date();
      const hour = getHours(now);
      const scrollTo = Math.max(0, (hour - 7) * HOUR_HEIGHT);
      scrollRef.current.scrollTop = scrollTo;
    }
  }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Day header */}
      <div
        className={cn(
          "px-2 py-1.5 border-b border-border shrink-0 flex items-center justify-between",
          dayIsToday && "bg-ops-accent-muted/15"
        )}
      >
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "font-mohave text-heading text-text-primary",
              dayIsToday && "text-ops-accent"
            )}
          >
            {format(currentDate, "EEEE")}
          </span>
          <span className="font-mono text-data text-text-secondary">
            {format(currentDate, "MMMM d, yyyy")}
          </span>
          {dayIsToday && (
            <span className="font-kosugi text-[10px] text-ops-accent bg-ops-accent-muted px-[8px] py-[2px] rounded-sm uppercase tracking-widest ml-[4px]">
              Today
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="font-mono text-data-sm text-text-tertiary">
            {dayEvents.length} event{dayEvents.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        <div className="grid grid-cols-[56px_1fr]">
          {/* Time gutter */}
          <div className="relative border-r border-border-subtle" style={{ height: `${HOURS.length * HOUR_HEIGHT}px` }}>
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="absolute left-0 right-0 flex items-start justify-end pr-[6px]"
                style={{ top: `${(hour - 6) * HOUR_HEIGHT}px` }}
              >
                <span className="font-mono text-[11px] text-text-disabled -mt-[6px] select-none">
                  {formatHour(hour)}
                </span>
              </div>
            ))}
          </div>

          {/* Single day column */}
          <div>
            <TimeGridColumn
              day={currentDate}
              events={events}
              isToday={dayIsToday}
              showFullDetail
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Mini Stats Bar ───────────────────────────────────────────────────────────

function MiniStatsBar({ events, currentDate, view }: { events: CalendarEvent[]; currentDate: Date; view: CalendarView }) {
  const stats = useMemo(() => {
    const today = new Date();
    const todayEvents = events.filter((e) => isSameDay(e.startDate, today));
    const weekStart = startOfWeek(today);
    const weekEnd = endOfWeek(today);
    const weekEvents = events.filter(
      (e) => !isBefore(e.startDate, weekStart) && !isAfter(e.startDate, weekEnd)
    );

    const taskTypeCounts: Record<string, number> = {};
    events.forEach((e) => {
      taskTypeCounts[e.taskType] = (taskTypeCounts[e.taskType] || 0) + 1;
    });

    return {
      todayCount: todayEvents.length,
      weekCount: weekEvents.length,
      totalCount: events.length,
      taskTypeCounts,
    };
  }, [events]);

  return (
    <div className="flex items-center gap-3 px-1 shrink-0">
      {/* Today / This Week counts */}
      <div className="flex items-center gap-[6px]">
        <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-widest">
          Today
        </span>
        <span className="font-mono text-data-sm text-text-primary">
          {stats.todayCount}
        </span>
      </div>
      <div className="w-[1px] h-[16px] bg-border-subtle" />
      <div className="flex items-center gap-[6px]">
        <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-widest">
          This Week
        </span>
        <span className="font-mono text-data-sm text-text-primary">
          {stats.weekCount}
        </span>
      </div>
      <div className="w-[1px] h-[16px] bg-border-subtle" />

      {/* Task type legend */}
      <div className="flex items-center gap-[8px] ml-auto">
        {Object.entries(stats.taskTypeCounts).map(([type, count]) => {
          const colors = getEventColors(type);
          return (
            <div key={type} className="flex items-center gap-[4px]">
              <div
                className="w-[8px] h-[8px] rounded-full"
                style={{ backgroundColor: colors.border }}
              />
              <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider">
                {type}
              </span>
              <span className="font-mono text-[10px] text-text-disabled">
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Calendar Page ───────────────────────────────────────────────────────

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<CalendarView>("month");

  const navigate = useCallback(
    (direction: "prev" | "next") => {
      setCurrentDate((prev) => {
        if (view === "month")
          return direction === "next"
            ? addMonths(prev, 1)
            : subMonths(prev, 1);
        if (view === "week")
          return direction === "next"
            ? addWeeks(prev, 1)
            : subWeeks(prev, 1);
        return direction === "next" ? addDays(prev, 1) : subDays(prev, 1);
      });
    },
    [view]
  );

  const goToToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  const handleSelectDate = useCallback((date: Date) => {
    setCurrentDate(date);
    setView("day");
  }, []);

  const headerTitle = useMemo(() => {
    if (view === "month") return format(currentDate, "MMMM yyyy");
    if (view === "week") {
      const ws = startOfWeek(currentDate);
      const we = endOfWeek(currentDate);
      if (ws.getMonth() === we.getMonth()) {
        return `${format(ws, "MMM d")} - ${format(we, "d, yyyy")}`;
      }
      return `${format(ws, "MMM d")} - ${format(we, "MMM d, yyyy")}`;
    }
    return format(currentDate, "MMMM d, yyyy");
  }, [currentDate, view]);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't capture if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          navigate("prev");
          break;
        case "ArrowRight":
          e.preventDefault();
          navigate("next");
          break;
        case "t":
        case "T":
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            goToToday();
          }
          break;
        case "m":
        case "M":
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setView("month");
          }
          break;
        case "w":
        case "W":
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setView("week");
          }
          break;
        case "d":
        case "D":
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setView("day");
          }
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, goToToday]);

  return (
    <div className="flex flex-col h-full gap-1.5">
      {/* ── Header Bar ── */}
      <div className="flex items-center justify-between shrink-0">
        {/* Left: Title + Today */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <CalendarIcon className="w-[22px] h-[22px] text-ops-accent" />
            <h1 className="font-mohave text-display-lg text-text-primary tracking-wide">
              CALENDAR
            </h1>
          </div>
          <Button variant="secondary" size="sm" onClick={goToToday}>
            Today
          </Button>
        </div>

        {/* Center: Navigation */}
        <div className="flex items-center gap-[4px]">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("prev")}
            title="Previous (Left Arrow)"
          >
            <ChevronLeft className="w-[18px] h-[18px]" />
          </Button>
          <span className="font-mohave text-body-lg text-text-primary min-w-[260px] text-center select-none">
            {headerTitle}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("next")}
            title="Next (Right Arrow)"
          >
            <ChevronRight className="w-[18px] h-[18px]" />
          </Button>
        </div>

        {/* Right: View toggle */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center bg-background-card border border-border rounded overflow-hidden">
            {(["month", "week", "day"] as CalendarView[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "px-2 py-[7px] font-mohave text-body-sm capitalize transition-all duration-150 relative",
                  view === v
                    ? "bg-ops-accent text-white shadow-glow-accent"
                    : "text-text-tertiary hover:text-text-primary hover:bg-background-elevated/50"
                )}
              >
                {v}
                {view === v && (
                  <div className="absolute bottom-0 left-1 right-1 h-[2px] bg-white/30 rounded-full" />
                )}
              </button>
            ))}
          </div>
          {/* Keyboard hints */}
          <div className="hidden xl:flex items-center gap-[3px] ml-[4px]">
            <kbd className="font-mono text-[9px] text-text-disabled bg-background-panel px-[5px] py-[2px] rounded-sm border border-border-subtle">
              M
            </kbd>
            <kbd className="font-mono text-[9px] text-text-disabled bg-background-panel px-[5px] py-[2px] rounded-sm border border-border-subtle">
              W
            </kbd>
            <kbd className="font-mono text-[9px] text-text-disabled bg-background-panel px-[5px] py-[2px] rounded-sm border border-border-subtle">
              D
            </kbd>
          </div>
        </div>
      </div>

      {/* ── Stats Bar ── */}
      <MiniStatsBar events={placeholderEvents} currentDate={currentDate} view={view} />

      {/* ── Calendar Content ── */}
      <div
        className="flex-1 bg-background-panel border border-border rounded-lg overflow-hidden flex flex-col min-h-0"
        style={{
          backgroundImage: [
            "linear-gradient(rgba(65, 115, 148, 0.015) 1px, transparent 1px)",
            "linear-gradient(90deg, rgba(65, 115, 148, 0.015) 1px, transparent 1px)",
          ].join(", "),
          backgroundSize: "24px 24px",
        }}
      >
        {view === "month" && (
          <MonthView
            currentDate={currentDate}
            events={placeholderEvents}
            onSelectDate={handleSelectDate}
          />
        )}
        {view === "week" && (
          <WeekView
            currentDate={currentDate}
            events={placeholderEvents}
            onSelectDate={handleSelectDate}
          />
        )}
        {view === "day" && (
          <DayView currentDate={currentDate} events={placeholderEvents} />
        )}
      </div>
    </div>
  );
}
