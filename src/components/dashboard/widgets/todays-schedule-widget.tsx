"use client";

import { useMemo, useRef } from "react";
import { Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Minimal event shape compatible with both CalendarEvent and InternalCalendarEvent
// ---------------------------------------------------------------------------
interface ScheduleEvent {
  id: string;
  title: string;
  startDate: Date | null;
  endDate?: Date | null;
  color: string;
  duration?: number;
  deletedAt?: Date | null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface TodaysScheduleWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
  events: ScheduleEvent[];
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function TodaysScheduleWidget({
  size,
  config,
  events,
  isLoading,
  onNavigate,
}: TodaysScheduleWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);

  const schedule = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

    const activeEvents = events.filter((e) => !e.deletedAt && e.startDate);

    const todayEvents = activeEvents
      .filter((e) => {
        const start = new Date(e.startDate!);
        return isSameDay(start, today);
      })
      .sort((a, b) => new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime());

    const tomorrowEvents = activeEvents
      .filter((e) => {
        const start = new Date(e.startDate!);
        return isSameDay(start, tomorrow);
      })
      .sort((a, b) => new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime());

    // Find next event
    const nextEvent = todayEvents.find((e) => new Date(e.startDate!).getTime() >= now.getTime()) ?? todayEvents[0];

    return { todayEvents, tomorrowEvents, nextEvent };
  }, [events]);

  const reducedMotion = typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("todaysSchedule.title") ?? "Schedule"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="timeline" />
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (schedule.todayEvents.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("todaysSchedule.title") ?? "Schedule"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2 flex flex-col items-start justify-center h-[calc(100%-28px)]">
          <span className="font-mohave text-[13px] text-text-tertiary">
            {t("todaysSchedule.noEvents") ?? "No events today"}
          </span>
        </CardContent>
      </Card>
    );
  }

  // ── SM: Next event preview + count ──────────────────────────────────────
  if (size === "sm") {
    return (
      <Card
        className="h-full cursor-pointer hover:bg-[rgba(255,255,255,0.02)] transition-colors"
        onClick={() => onNavigate("/calendar")}
      >
        <CardHeader className="pb-1 pt-2 px-3 flex flex-row items-center justify-between">
          <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
            {t("todaysSchedule.title") ?? "Schedule"}
          </CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">{schedule.todayEvents.length}</span>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          {schedule.nextEvent && (
            <div className="flex items-center gap-2">
              <div
                className="w-[3px] h-[28px] rounded-full shrink-0"
                style={{ backgroundColor: schedule.nextEvent.color || "#597794" }}
              />
              <div className="min-w-0">
                <p className="font-mohave text-[13px] text-text-primary truncate">
                  {schedule.nextEvent.title}
                </p>
                <p className="font-mono text-[10px] text-text-tertiary">
                  {formatTime(new Date(schedule.nextEvent.startDate!))}
                </p>
              </div>
            </div>
          )}
          {schedule.todayEvents.length > 1 && (
            <p className="font-mono text-[10px] text-text-tertiary mt-1">
              +{schedule.todayEvents.length - 1} {t("todaysSchedule.moreToday") ?? "more today"}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── MD / LG: Vertical timeline ──────────────────────────────────────────
  const maxEvents = size === "lg" ? 6 : 4;
  const displayEvents = schedule.todayEvents.slice(0, maxEvents);

  return (
    <Card className="h-full cursor-pointer" ref={ref} onClick={() => onNavigate("/calendar")}>
      <CardHeader className="pb-1 pt-2 px-3 flex flex-row items-center justify-between">
        <CardTitle className="text-[11px] font-kosugi uppercase tracking-wider text-text-tertiary">
          {t("todaysSchedule.title") ?? "Schedule"}
        </CardTitle>
        <span className="font-mono text-[11px] text-text-tertiary">{schedule.todayEvents.length} today</span>
      </CardHeader>
      <CardContent className="px-3 pb-2 overflow-hidden">
        <div className="flex flex-col">
          {displayEvents.map((event, i) => {
            const startDate = new Date(event.startDate!);
            const now = new Date();
            const isPast = startDate.getTime() < now.getTime();

            return (
              <div
                key={event.id}
                className="flex items-start gap-2 py-[3px]"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transform: isVisible ? "translateY(0)" : "translateY(4px)",
                  transition: reducedMotion
                    ? "opacity 200ms ease"
                    : `opacity 300ms ease ${i * 50}ms, transform 300ms ease ${i * 50}ms`,
                }}
              >
                {/* Time */}
                <span className="font-mono text-[10px] text-text-tertiary w-[52px] shrink-0 pt-[2px]">
                  {formatTime(startDate)}
                </span>
                {/* Color indicator */}
                <div className="flex flex-col items-center shrink-0 pt-[4px]">
                  <div
                    className="w-[6px] h-[6px] rounded-full"
                    style={{
                      backgroundColor: event.color || "#597794",
                      opacity: isPast ? 0.5 : 1,
                    }}
                  />
                  {i < displayEvents.length - 1 && (
                    <div className="w-[1px] flex-1 min-h-[12px] bg-border-primary mt-[2px]" />
                  )}
                </div>
                {/* Event details */}
                <div className="flex-1 min-w-0">
                  <p className={`font-mohave text-[12px] truncate ${isPast ? "text-text-tertiary" : "text-text-primary"}`}>
                    {event.title}
                  </p>
                  {(event.duration ?? 0) > 0 && (
                    <p className="font-mono text-[9px] text-text-quaternary">
                      {(event.duration ?? 0) < 60 ? `${event.duration}m` : `${Math.round((event.duration ?? 0) / 60)}h`}
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {schedule.todayEvents.length > maxEvents && (
            <span className="font-mono text-[10px] text-text-tertiary mt-1 pl-[68px]">
              +{schedule.todayEvents.length - maxEvents} {t("todaysSchedule.moreToday") ?? "more today"}
            </span>
          )}
        </div>

        {/* Tomorrow preview (lg only) */}
        {size === "lg" && schedule.tomorrowEvents.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border-primary">
            <span className="font-kosugi text-[9px] text-text-tertiary uppercase tracking-wider">
              {t("todaysSchedule.tomorrow") ?? "Tomorrow"}
            </span>
            <div className="flex flex-col mt-1">
              {schedule.tomorrowEvents.slice(0, 2).map((event) => (
                <div key={event.id} className="flex items-center gap-2 py-[2px]">
                  <span className="font-mono text-[10px] text-text-tertiary w-[52px] shrink-0">
                    {formatTime(new Date(event.startDate!))}
                  </span>
                  <div className="w-[4px] h-[4px] rounded-full" style={{ backgroundColor: event.color || "#597794" }} />
                  <span className="font-mohave text-[11px] text-text-tertiary truncate">{event.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
