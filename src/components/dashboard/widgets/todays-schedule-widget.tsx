"use client";

import { useMemo, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showActions, showFooter } from "@/lib/widget-tokens";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";

// ---------------------------------------------------------------------------
// Minimal event shape
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
  const compact = isCompact(size);

  const reducedMotion = useReducedMotion();

  const schedule = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const activeEvents = events.filter((e) => !e.deletedAt && e.startDate);

    const todayEvents = activeEvents
      .filter((e) => isSameDay(new Date(e.startDate!), today))
      .sort((a, b) => new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime());

    const tomorrowEvents = activeEvents
      .filter((e) => isSameDay(new Date(e.startDate!), tomorrow))
      .sort((a, b) => new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime());

    const nextEvent = todayEvents.find((e) => new Date(e.startDate!).getTime() >= now.getTime()) ?? todayEvents[0];

    return { todayEvents, tomorrowEvents, nextEvent };
  }, [events]);

  // ── Loading ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-1 pt-2 px-3">
          <CardTitle className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("todaysSchedule.title") ?? "Schedule"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-2">
          <WidgetSkeleton variant="timeline" />
        </CardContent>
      </Card>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────
  if (schedule.todayEvents.length === 0) {
    // XS empty: match standard XS pattern
    if (size === "xs") {
      return (
        <Card className="h-full">
          <div className="h-full flex flex-col pt-3" ref={ref}>
            <span className="font-mono text-display font-bold text-text-disabled leading-none">
              0
            </span>
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
              {t("todaysSchedule.title") ?? "Schedule"}
            </span>
            <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
              {t("todaysSchedule.eventsToday") ?? "today"}
            </span>
          </div>
        </Card>
      );
    }
    // SM+ empty
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider">
            {t("todaysSchedule.title") ?? "Schedule"}
          </span>
          <div className="flex-1 flex flex-col justify-center">
            <span className={`font-mono ${compact ? HERO_SIZE_CLASS.compact : HERO_SIZE_CLASS.expanded} font-bold text-text-disabled leading-none`}>
              0
            </span>
            <span className="font-mohave text-caption-sm text-text-disabled mt-1">
              {t("todaysSchedule.noEvents") ?? "No events today"}
            </span>
          </div>
          {showFooter(size) && (
            <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors">
              {t("todaysSchedule.viewCalendar") ?? "View Calendar"}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── XS: Hero count ────────────────────────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col pt-3" ref={ref}>
          <span className="font-mono text-display font-bold leading-none text-text-primary">
            {schedule.todayEvents.length}
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("todaysSchedule.title") ?? "Schedule"}
          </span>
          <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
            {t("todaysSchedule.eventsToday") ?? "today"}
          </span>
        </div>
      </Card>
    );
  }

  // ── SM: Hero + title + next event preview ───────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0">
        <div className="h-full flex flex-col p-3">
          {/* Row 1: Hero number + tiny nav icon */}
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-data-lg font-bold leading-none text-text-primary">
              {schedule.todayEvents.length}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate("/calendar"); }}
              className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-2.5 h-2.5 text-text-disabled" />
            </button>
          </div>
          {/* Row 2: Title */}
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("todaysSchedule.title") ?? "Schedule"}
          </span>
          {/* Row 3: Next event preview */}
          {schedule.nextEvent && (
            <div className="flex items-center gap-2 mt-1">
              <div
                className="w-[3px] h-[28px] rounded-full shrink-0"
                style={{ backgroundColor: schedule.nextEvent.color || WT.accent }}
              />
              <div className="min-w-0">
                <p className="font-mohave text-caption-sm text-text-primary truncate">
                  {schedule.nextEvent.title}
                </p>
                <p className="font-mono text-micro-sm text-text-tertiary">
                  {formatTime(new Date(schedule.nextEvent.startDate!))}
                </p>
              </div>
            </div>
          )}
        </div>
      </Card>
    );
  }

  // ── MD / LG: Vertical timeline + footer ────────────────────────────────
  const maxEvents = showActions(size) ? 10 : 4;
  const displayEvents = schedule.todayEvents.slice(0, maxEvents);

  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* HEADER */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("todaysSchedule.title") ?? "Schedule"}
          </span>
          <span className="font-mono text-micro text-text-tertiary">{schedule.todayEvents.length} today</span>
        </div>

        {/* DETAIL ZONE */}
        {showDetail(size) && (
          <ScrollFade>
            <div className="flex flex-col">
              {displayEvents.map((event, i) => {
                const startDate = new Date(event.startDate!);
                const now = new Date();
                const isPast = startDate.getTime() < now.getTime();

                return (
                  <div
                    key={event.id}
                    className="flex items-start gap-2 py-[3px] cursor-pointer"
                    onClick={() => onNavigate("/calendar")}
                    style={{
                      opacity: isVisible ? 1 : 0,
                      transform: isVisible ? "translateY(0)" : "translateY(4px)",
                      transition: reducedMotion
                        ? "opacity 200ms ease"
                        : `opacity 300ms ease ${i * 50}ms, transform 300ms ease ${i * 50}ms`,
                    }}
                  >
                    {/* Time */}
                    <span className="font-mono text-micro-sm text-text-tertiary w-[52px] shrink-0 pt-[2px]">
                      {formatTime(startDate)}
                    </span>
                    {/* Color indicator */}
                    <div className="flex flex-col items-center shrink-0 pt-[4px]">
                      <div
                        className="w-[6px] h-[6px] rounded-full"
                        style={{
                          backgroundColor: event.color || WT.accent,
                          opacity: isPast ? 0.5 : 1,
                        }}
                      />
                      {i < displayEvents.length - 1 && (
                        <div className="w-[1px] flex-1 min-h-[12px] bg-border-subtle mt-[2px]" />
                      )}
                    </div>
                    {/* Event details */}
                    <div className="flex-1 min-w-0">
                      <p className={`font-mohave text-caption-sm truncate ${isPast ? "text-text-tertiary" : "text-text-primary"}`}>
                        {event.title}
                      </p>
                      {(event.duration ?? 0) > 0 && (
                        <p className="font-mono text-micro-sm text-text-disabled">
                          {(event.duration ?? 0) < 60 ? `${event.duration}m` : `${Math.round((event.duration ?? 0) / 60)}h`}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}

              {schedule.todayEvents.length > maxEvents && (
                <span className="font-mono text-micro-sm text-text-tertiary mt-1 pl-[68px]">
                  +{schedule.todayEvents.length - maxEvents} {t("todaysSchedule.moreToday") ?? "more today"}
                </span>
              )}
            </div>

            {/* Tomorrow preview (lg only) */}
            {showActions(size) && schedule.tomorrowEvents.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border-subtle">
                <span className="font-kosugi text-micro-sm text-text-disabled uppercase tracking-wider">
                  {t("todaysSchedule.tomorrow") ?? "Tomorrow"}
                </span>
                <div className="flex flex-col mt-1">
                  {schedule.tomorrowEvents.slice(0, 5).map((event) => (
                    <div key={event.id} className="flex items-center gap-2 py-[2px]">
                      <span className="font-mono text-micro-sm text-text-tertiary w-[52px] shrink-0">
                        {formatTime(new Date(event.startDate!))}
                      </span>
                      <div className="w-[4px] h-[4px] rounded-full" style={{ backgroundColor: event.color || WT.accent }} />
                      <span className="font-mohave text-caption-sm text-text-tertiary truncate">{event.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ScrollFade>
        )}

        {/* FOOTER */}
        {showFooter(size) && (
          <button
            onClick={() => onNavigate("/calendar")}
            className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
          >
            {t("todaysSchedule.viewCalendar") ?? "View Calendar"}
          </button>
        )}
      </div>
    </Card>
  );
}
