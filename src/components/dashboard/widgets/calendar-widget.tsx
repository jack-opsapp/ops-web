"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CalendarEvent } from "@/lib/types/models";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { format, isSameDay, isAfter } from "@/lib/utils/date";

interface CalendarWidgetProps {
  size: WidgetSize;
  events: CalendarEvent[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function CalendarWidget({
  size,
  events,
  isLoading,
  onNavigate,
}: CalendarWidgetProps) {
  const today = useMemo(() => new Date(), []);

  // Generate days of current week
  const weekStart = useMemo(() => {
    const d = new Date(today);
    d.setDate(today.getDate() - today.getDay());
    return d;
  }, [today]);

  const weekDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        return d;
      }),
    [weekStart]
  );

  const eventDaySet = useMemo(() => {
    const daySet = new Set<string>();
    for (const ev of events) {
      if (ev.startDate) {
        const d = new Date(ev.startDate);
        daySet.add(d.toDateString());
      }
    }
    return daySet;
  }, [events]);

  const todayEvents = useMemo(() => {
    return events
      .filter((ev) => {
        if (!ev.startDate) return false;
        return isSameDay(new Date(ev.startDate), today);
      })
      .sort((a, b) => {
        const aDate = a.startDate ? new Date(a.startDate).getTime() : 0;
        const bDate = b.startDate ? new Date(b.startDate).getTime() : 0;
        return aDate - bDate;
      })
      .slice(0, 6);
  }, [events, today]);

  const tomorrowEvents = useMemo(() => {
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    return events
      .filter((ev) => {
        if (!ev.startDate) return false;
        return isSameDay(new Date(ev.startDate), tomorrow);
      })
      .sort((a, b) => {
        const aDate = a.startDate ? new Date(a.startDate).getTime() : 0;
        const bDate = b.startDate ? new Date(b.startDate).getTime() : 0;
        return aDate - bDate;
      })
      .slice(0, 4);
  }, [events, today]);

  const todayEventCount = todayEvents.length;

  // sm: date + event count
  if (size === "sm") {
    return (
      <Card className="p-2">
        <CardHeader className="pb-1">
          <CardTitle className="text-card-subtitle">
            {monthNames[today.getMonth()].slice(0, 3)} {today.getDate()}
          </CardTitle>
        </CardHeader>
        <CardContent className="py-0">
          {isLoading ? (
            <Loader2 className="w-[14px] h-[14px] text-text-disabled animate-spin" />
          ) : (
            <>
              <p className="font-mono text-data-lg text-text-primary">{todayEventCount}</p>
              <p className="font-kosugi text-[10px] text-text-tertiary">
                {todayEventCount === 1 ? "event today" : "events today"}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  // lg: week strip + today events + tomorrow preview
  if (size === "lg") {
    return (
      <Card className="p-2 h-full">
        <CardHeader className="pb-1.5">
          <div className="flex items-center justify-between">
            <CardTitle className="text-card-subtitle">
              {monthNames[today.getMonth()]} {today.getFullYear()}
            </CardTitle>
            <span className="font-mono text-[11px] text-text-tertiary">Today</span>
          </div>
        </CardHeader>
        <CardContent className="py-0">
          {/* Week strip */}
          <WeekStrip
            weekDays={weekDays}
            today={today}
            eventDaySet={eventDaySet}
            onNavigate={onNavigate}
          />

          {/* Today's events */}
          <EventList
            label="Today's Schedule"
            events={todayEvents}
            isLoading={isLoading}
            emptyMessage="No events scheduled today"
            onNavigate={onNavigate}
          />

          {/* Tomorrow preview */}
          <div className="mt-1.5">
            <EventList
              label="Tomorrow"
              events={tomorrowEvents}
              isLoading={isLoading}
              emptyMessage="No events tomorrow"
              onNavigate={onNavigate}
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  // md: week strip + today events (current default)
  return (
    <Card className="p-2">
      <CardHeader className="pb-1.5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">
            {monthNames[today.getMonth()]} {today.getFullYear()}
          </CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">Today</span>
        </div>
      </CardHeader>
      <CardContent className="py-0">
        <WeekStrip
          weekDays={weekDays}
          today={today}
          eventDaySet={eventDaySet}
          onNavigate={onNavigate}
        />
        <EventList
          label="Today's Schedule"
          events={todayEvents}
          isLoading={isLoading}
          emptyMessage="No events scheduled today"
          onNavigate={onNavigate}
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function WeekStrip({
  weekDays,
  today,
  eventDaySet,
  onNavigate,
}: {
  weekDays: Date[];
  today: Date;
  eventDaySet: Set<string>;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="grid grid-cols-7 gap-[2px] mb-1.5">
      {weekDays.map((d, i) => {
        const isToday = d.toDateString() === today.toDateString();
        const hasEvent = eventDaySet.has(d.toDateString());
        return (
          <div
            key={i}
            onClick={() => onNavigate("/calendar")}
            className={cn(
              "flex flex-col items-center py-[6px] rounded transition-colors cursor-pointer",
              isToday
                ? "bg-[rgba(255,255,255,0.1)] text-text-primary"
                : "hover:bg-[rgba(255,255,255,0.04)]"
            )}
          >
            <span
              className={cn(
                "font-kosugi text-[9px] uppercase",
                isToday ? "text-text-secondary" : "text-text-disabled"
              )}
            >
              {dayNames[i]}
            </span>
            <span
              className={cn(
                "font-mono text-body-sm font-medium",
                isToday ? "text-text-primary" : "text-text-secondary"
              )}
            >
              {d.getDate()}
            </span>
            {hasEvent && (
              <span
                className={cn(
                  "w-[4px] h-[4px] rounded-full mt-[2px]",
                  isToday ? "bg-text-primary" : "bg-[#5C6070]"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function EventList({
  label,
  events,
  isLoading,
  emptyMessage,
  onNavigate,
}: {
  label: string;
  events: CalendarEvent[];
  isLoading: boolean;
  emptyMessage: string;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="border-t border-border pt-1.5 space-y-[4px]">
      <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
        {label}
      </span>
      {isLoading ? (
        <div className="flex items-center justify-center py-2">
          <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
          <span className="font-mono text-[11px] text-text-disabled ml-1">Loading events...</span>
        </div>
      ) : events.length === 0 ? (
        <p className="font-mohave text-body-sm text-text-disabled py-1">{emptyMessage}</p>
      ) : (
        events.map((ev, i) => {
          const eventTime = ev.startDate
            ? format(new Date(ev.startDate), "h:mm a")
            : "";
          return (
            <div
              key={ev.id || i}
              onClick={() =>
                onNavigate(ev.projectId ? `/projects/${ev.projectId}` : "/calendar")
              }
              className="flex items-center gap-1 px-[6px] py-[5px] rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors"
            >
              <span className="font-mono text-[10px] text-text-disabled w-[60px] shrink-0">
                {eventTime}
              </span>
              <div
                className="w-[3px] h-[16px] rounded-full shrink-0"
                style={{ backgroundColor: ev.color || "#5C6070" }}
              />
              <span className="font-mohave text-body-sm text-text-secondary truncate">
                {ev.title}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
