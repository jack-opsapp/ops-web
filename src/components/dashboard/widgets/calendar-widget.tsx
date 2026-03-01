"use client";

import { useMemo, useRef, useCallback } from "react";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CalendarEvent } from "@/lib/types/models";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { format, isSameDay } from "@/lib/utils/date";
import { useDictionary } from "@/i18n/client";

interface CalendarWidgetProps {
  size: WidgetSize;
  events: CalendarEvent[];
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

  // Group events by day for the week
  const eventsByDay = useMemo(() => {
    return weekDays.map((day) => {
      const dayEvents = events
        .filter((ev) => {
          if (!ev.startDate) return false;
          return isSameDay(new Date(ev.startDate), day);
        })
        .sort((a, b) => {
          const aDate = a.startDate ? new Date(a.startDate).getTime() : 0;
          const bDate = b.startDate ? new Date(b.startDate).getTime() : 0;
          return aDate - bDate;
        });
      return { day, events: dayEvents };
    });
  }, [weekDays, events]);

  const todayIndex = useMemo(
    () => weekDays.findIndex((d) => isSameDay(d, today)),
    [weekDays, today]
  );

  const todayEventCount = eventsByDay[todayIndex]?.events.length ?? 0;

  // sm: date + event count
  if (size === "sm") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1 shrink-0">
          <CardTitle className="text-card-subtitle">
            {t(MONTH_NAME_KEYS[today.getMonth()]).slice(0, 3)} {today.getDate()}
          </CardTitle>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-hidden min-h-0">
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

  const maxEventsPerDay = size === "lg" ? 5 : 3;

  // md + lg: week strip + snap carousel of day panels
  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">
            {t(MONTH_NAME_KEYS[today.getMonth()])} {today.getFullYear()}
          </CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">{t("calendar.today")}</span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-hidden min-h-0 flex flex-col">
        {/* Week strip */}
        <WeekStrip
          weekDays={weekDays}
          today={today}
          eventDaySet={eventDaySet}
          onNavigate={onNavigate}
        />

        {/* Snap carousel of day panels */}
        {isLoading ? (
          <div className="flex items-center justify-center flex-1">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">{t("calendar.loading")}</span>
          </div>
        ) : (
          <DayCarousel
            eventsByDay={eventsByDay}
            todayIndex={todayIndex}
            maxEventsPerDay={maxEventsPerDay}
            onNavigate={onNavigate}
          />
        )}
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
  const { t } = useDictionary("dashboard");
  return (
    <div className="grid grid-cols-7 gap-[2px] mb-1.5 shrink-0">
      {weekDays.map((d, i) => {
        const isToday = d.toDateString() === today.toDateString();
        const hasEvent = eventDaySet.has(d.toDateString());
        return (
          <div
            key={i}
            onClick={() => onNavigate("/calendar")}
            className={cn(
              "flex flex-col items-center py-[4px] rounded transition-colors cursor-pointer",
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
              {t(DAY_NAME_KEYS[i])}
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
                  "w-[4px] h-[4px] rounded-full mt-[1px]",
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

function DayCarousel({
  eventsByDay,
  todayIndex,
  maxEventsPerDay,
  onNavigate,
}: {
  eventsByDay: { day: Date; events: CalendarEvent[] }[];
  todayIndex: number;
  maxEventsPerDay: number;
  onNavigate: (path: string) => void;
}) {
  const { t } = useDictionary("dashboard");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to a specific panel
  const scrollToIndex = useCallback((index: number) => {
    const container = scrollRef.current;
    if (!container) return;
    const panels = container.children;
    if (panels[index]) {
      (panels[index] as HTMLElement).scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "start",
      });
    }
  }, []);

  // Initialize scroll to today
  const initRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el && todayIndex >= 0) {
        // Use requestAnimationFrame for layout-safe scroll
        requestAnimationFrame(() => {
          const panels = el.children;
          if (panels[todayIndex]) {
            (panels[todayIndex] as HTMLElement).scrollIntoView({
              behavior: "instant",
              block: "nearest",
              inline: "start",
            });
          }
        });
      }
      // Also set the ref
      (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    },
    [todayIndex]
  );

  return (
    <div className="relative flex-1 min-h-0">
      {/* Navigation arrows */}
      <button
        onClick={() => {
          const container = scrollRef.current;
          if (container) container.scrollBy({ left: -container.offsetWidth, behavior: "smooth" });
        }}
        className="absolute left-0 top-0 z-10 w-[20px] h-full flex items-center justify-center text-text-disabled hover:text-text-secondary transition-colors"
        aria-label={t("calendar.previousDay")}
      >
        <ChevronLeft className="w-[14px] h-[14px]" />
      </button>
      <button
        onClick={() => {
          const container = scrollRef.current;
          if (container) container.scrollBy({ left: container.offsetWidth, behavior: "smooth" });
        }}
        className="absolute right-0 top-0 z-10 w-[20px] h-full flex items-center justify-center text-text-disabled hover:text-text-secondary transition-colors"
        aria-label={t("calendar.nextDay")}
      >
        <ChevronRight className="w-[14px] h-[14px]" />
      </button>

      {/* Snap container */}
      <div
        ref={initRef}
        className="flex overflow-x-auto snap-x snap-mandatory h-full scrollbar-none mx-[20px]"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {eventsByDay.map(({ day, events }, i) => {
          const dayLabel = day.toDateString() === new Date().toDateString()
            ? t("calendar.today")
            : t(DAY_NAME_KEYS[day.getDay()]) + ", " + t(MONTH_NAME_KEYS[day.getMonth()]).slice(0, 3) + " " + day.getDate();

          const visibleEvents = events.slice(0, maxEventsPerDay);
          const remaining = events.length - maxEventsPerDay;

          return (
            <div
              key={i}
              className="snap-start w-full shrink-0 px-[2px]"
            >
              <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
                {dayLabel}
              </span>
              {visibleEvents.length === 0 ? (
                <p className="font-mohave text-body-sm text-text-disabled py-1">
                  {t("calendar.noEvents")}
                </p>
              ) : (
                <div className="space-y-[3px] mt-[2px]">
                  {visibleEvents.map((ev, j) => {
                    const eventTime = ev.startDate
                      ? format(new Date(ev.startDate), "h:mm a")
                      : "";
                    return (
                      <div
                        key={ev.id || j}
                        onClick={() =>
                          onNavigate(ev.projectId ? `/projects/${ev.projectId}` : "/calendar")
                        }
                        className="flex items-center gap-1 px-[4px] py-[4px] rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors"
                      >
                        <span className="font-mono text-[10px] text-text-disabled w-[52px] shrink-0">
                          {eventTime}
                        </span>
                        <div
                          className="w-[3px] h-[14px] rounded-full shrink-0"
                          style={{ backgroundColor: ev.color || "#5C6070" }}
                        />
                        <span className="font-mohave text-body-sm text-text-secondary truncate">
                          {ev.title}
                        </span>
                      </div>
                    );
                  })}
                  {remaining > 0 && (
                    <span className="font-mono text-[11px] text-text-disabled block px-1">
                      +{remaining} {t("calendar.more")}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
