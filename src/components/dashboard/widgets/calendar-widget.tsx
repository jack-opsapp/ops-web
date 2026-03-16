"use client";

import { useMemo, useState, useCallback } from "react";
import { Loader2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { format, isSameDay } from "@/lib/utils/date";
import { useDictionary } from "@/i18n/client";

interface CalendarWidgetProps {
  size: WidgetSize;
  events: InternalCalendarEvent[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

const DAY_NAME_KEYS = [
  "calendar.sun", "calendar.mon", "calendar.tue", "calendar.wed",
  "calendar.thu", "calendar.fri", "calendar.sat",
];
const MONTH_NAME_KEYS = [
  "calendar.january", "calendar.february", "calendar.march", "calendar.april",
  "calendar.may", "calendar.june", "calendar.july", "calendar.august",
  "calendar.september", "calendar.october", "calendar.november", "calendar.december",
];

export function CalendarWidget({
  size,
  events,
  isLoading,
  onNavigate,
}: CalendarWidgetProps) {
  const { t } = useDictionary("dashboard");
  const today = useMemo(() => new Date(), []);

  // Selected day state — defaults to today
  const [selectedDay, setSelectedDay] = useState<Date>(today);

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

  // Count events per day for indicators
  const eventCountByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const ev of events) {
      if (ev.startDate) {
        const key = new Date(ev.startDate).toDateString();
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
    return map;
  }, [events]);

  // Events for the selected day
  const selectedDayEvents = useMemo(() => {
    return events
      .filter((ev) => {
        if (!ev.startDate) return false;
        return isSameDay(new Date(ev.startDate), selectedDay);
      })
      .sort((a, b) => {
        const aDate = a.startDate ? new Date(a.startDate).getTime() : 0;
        const bDate = b.startDate ? new Date(b.startDate).getTime() : 0;
        return aDate - bDate;
      });
  }, [events, selectedDay]);

  const todayEventCount = eventCountByDay.get(today.toDateString()) ?? 0;

  // Handle day click
  const handleDayClick = useCallback((day: Date) => {
    setSelectedDay(day);
  }, []);

  // sm: date + event count
  if (size === "sm") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1 shrink-0">
          <CardTitle className="text-card-subtitle">
            {t(MONTH_NAME_KEYS[today.getMonth()]).slice(0, 3)} {today.getDate()}
          </CardTitle>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide">
          {isLoading ? (
            <Loader2 className="w-[14px] h-[14px] text-text-disabled animate-spin" />
          ) : (
            <>
              <p className="font-mono text-data-lg text-text-primary">{todayEventCount}</p>
              <p className="font-kosugi text-[10px] text-text-tertiary">
                {todayEventCount === 1 ? t("calendar.eventToday") : t("calendar.eventsToday")}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  const maxEventsDisplay = size === "lg" ? 6 : 4;
  const isSelectedToday = isSameDay(selectedDay, today);
  const selectedDayLabel = isSelectedToday
    ? t("calendar.today")
    : `${t(DAY_NAME_KEYS[selectedDay.getDay()])}, ${t(MONTH_NAME_KEYS[selectedDay.getMonth()]).slice(0, 3)} ${selectedDay.getDate()}`;

  // md + lg: clickable week strip + selected day task list
  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">
            {t(MONTH_NAME_KEYS[today.getMonth()])} {today.getFullYear()}
          </CardTitle>
          <button
            onClick={() => onNavigate("/calendar")}
            className="font-mono text-[11px] text-text-tertiary hover:text-text-secondary transition-colors"
          >
            {t("calendar.viewFull")}
          </button>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide flex flex-col">
        {/* Clickable week strip with event indicators */}
        <div className="grid grid-cols-7 gap-[2px] mb-1.5 shrink-0">
          {weekDays.map((d, i) => {
            const isToday = isSameDay(d, today);
            const isSelected = isSameDay(d, selectedDay);
            const eventCount = eventCountByDay.get(d.toDateString()) ?? 0;

            return (
              <button
                key={i}
                onClick={() => handleDayClick(d)}
                className={cn(
                  "flex flex-col items-center py-[4px] rounded transition-all duration-200 cursor-pointer",
                  isSelected
                    ? "bg-[rgba(255,255,255,0.12)] ring-1 ring-[rgba(255,255,255,0.15)]"
                    : isToday
                      ? "bg-[rgba(255,255,255,0.06)]"
                      : "hover:bg-[rgba(255,255,255,0.04)]"
                )}
              >
                <span
                  className={cn(
                    "font-kosugi text-[9px] uppercase",
                    isSelected ? "text-text-primary" : isToday ? "text-text-secondary" : "text-text-disabled"
                  )}
                >
                  {t(DAY_NAME_KEYS[i])}
                </span>
                <span
                  className={cn(
                    "font-mono text-body-sm font-medium",
                    isSelected ? "text-text-primary" : isToday ? "text-text-primary" : "text-text-secondary"
                  )}
                >
                  {d.getDate()}
                </span>
                {/* Event indicator: colored dots + count */}
                <div className="flex items-center gap-[2px] mt-[2px] h-[6px]">
                  {eventCount > 0 && eventCount <= 3 && (
                    // Show individual dots for 1-3 events
                    Array.from({ length: eventCount }).map((_, dotIdx) => (
                      <span
                        key={dotIdx}
                        className={cn(
                          "w-[4px] h-[4px] rounded-full",
                          isSelected ? "bg-ops-accent" : isToday ? "bg-text-primary" : "bg-text-disabled"
                        )}
                      />
                    ))
                  )}
                  {eventCount > 3 && (
                    // Show count badge for 4+ events
                    <span
                      className={cn(
                        "font-mono text-[7px] px-[3px] rounded-full leading-[10px]",
                        isSelected
                          ? "bg-ops-accent text-white"
                          : "bg-[rgba(255,255,255,0.15)] text-text-secondary"
                      )}
                    >
                      {eventCount}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected day header */}
        <div className="flex items-center justify-between mb-1 shrink-0">
          <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
            {selectedDayLabel}
          </span>
          <span className="font-mono text-[10px] text-text-disabled">
            {selectedDayEvents.length} {selectedDayEvents.length === 1
              ? t("calendar.eventSingular")
              : t("calendar.eventPlural")}
          </span>
        </div>

        {/* Selected day events */}
        {isLoading ? (
          <div className="flex items-center justify-center flex-1">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">{t("calendar.loading")}</span>
          </div>
        ) : selectedDayEvents.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="font-mohave text-body-sm text-text-disabled">
              {t("calendar.noEvents")}
            </p>
          </div>
        ) : (
          <div className="space-y-[3px] flex-1">
            {selectedDayEvents.slice(0, maxEventsDisplay).map((ev, j) => {
              const eventTime = ev.startDate
                ? format(new Date(ev.startDate), "h:mm a")
                : "";
              return (
                <div
                  key={ev.id || j}
                  onClick={() =>
                    onNavigate(ev.projectId ? `/projects/${ev.projectId}` : "/calendar")
                  }
                  className="flex items-center gap-1 px-[4px] py-[5px] rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors group"
                >
                  <span className="font-mono text-[10px] text-text-disabled w-[52px] shrink-0">
                    {eventTime}
                  </span>
                  <div
                    className="w-[3px] h-[14px] rounded-full shrink-0"
                    style={{ backgroundColor: ev.color || "#5C6070" }}
                  />
                  <span className="font-mohave text-body-sm text-text-secondary truncate flex-1">
                    {ev.title}
                  </span>
                  <ChevronRight className="w-[12px] h-[12px] text-text-disabled opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </div>
              );
            })}
            {selectedDayEvents.length > maxEventsDisplay && (
              <span className="font-mono text-[11px] text-text-disabled block px-1">
                +{selectedDayEvents.length - maxEventsDisplay} {t("calendar.more")}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
