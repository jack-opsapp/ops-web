"use client";

import { useMemo, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showActions } from "@/lib/widget-tokens";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";
import { ScrollFade } from "./shared/scroll-fade";
import { WidgetTrendContext } from "./shared/widget-trend-context";
import { WidgetLineItem } from "./shared/widget-line-item";

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

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
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
          <CardTitle className="font-mono text-micro uppercase tracking-wider text-text-3">
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
            <span className="font-mono text-display font-bold text-text-mute leading-none">
              0
            </span>
            <span className="font-mono text-micro text-text-3 uppercase tracking-wider mt-1">
              {t("todaysSchedule.title") ?? "Schedule"}
            </span>
            <WidgetTrendContext variant="snapshot" label={t("trend.today") ?? "Today"} />
          </div>
        </Card>
      );
    }
    // SM+ empty
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col px-3 py-2">
          <span className="font-mono text-micro text-text-3 uppercase tracking-wider">
            {t("todaysSchedule.title") ?? "Schedule"}
          </span>
          <div className="flex-1 flex flex-col justify-center">
            <span className={`font-mono ${compact ? HERO_SIZE_CLASS.compact : HERO_SIZE_CLASS.expanded} font-bold text-text-mute leading-none`}>
              0
            </span>
            <span className="font-mohave text-caption-sm text-text-mute mt-1">
              {t("todaysSchedule.noEvents") ?? "No events today"}
            </span>
          </div>
        </div>
      </Card>
    );
  }

  // ── XS: Hero count ────────────────────────────────────────────────────
  if (size === "xs") {
    return (
      <Card className="h-full">
        <div className="h-full flex flex-col pt-3" ref={ref}>
          <span className="font-mono text-display font-bold leading-none text-text">
            {schedule.todayEvents.length}
          </span>
          <span className="font-mono text-micro text-text-3 uppercase tracking-wider mt-1">
            {t("todaysSchedule.title") ?? "Schedule"}
          </span>
          <WidgetTrendContext variant="snapshot" label={t("trend.today") ?? "Today"} />
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
            <span className="font-mono text-data-lg font-bold leading-none text-text">
              {schedule.todayEvents.length}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate("/calendar"); }}
              className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-2.5 h-2.5 text-text-mute" />
            </button>
          </div>
          {/* Row 2: Title */}
          <span className="font-mono text-micro text-text-3 uppercase tracking-wider mt-1">
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
                <p className="font-mohave text-caption-sm text-text truncate">
                  {schedule.nextEvent.title}
                </p>
                <p className="font-mono text-micro text-text-3">
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
          <span className="font-mono text-micro uppercase tracking-wider text-text-3">
            {t("todaysSchedule.title") ?? "Schedule"}
          </span>
          <span className="font-mono text-micro text-text-3">{schedule.todayEvents.length} today</span>
        </div>

        {/* DETAIL ZONE */}
        {showDetail(size) && (
          <ScrollFade>
            <div className="flex flex-col">
              {displayEvents.map((event, i) => {
                const startDate = new Date(event.startDate!);
                const secondaryParts = [formatTime(startDate)];
                if ((event.duration ?? 0) > 0) {
                  secondaryParts.push(formatDuration(event.duration!));
                }

                return (
                  <WidgetLineItem
                    key={event.id}
                    indicator={{
                      type: "bar",
                      color: event.color || WT.accent,
                      label: "Event",
                    }}
                    primary={event.title}
                    secondary={secondaryParts.join(" · ")}
                    onClick={() => onNavigate("/calendar")}
                    index={i}
                    isVisible={isVisible}
                    reducedMotion={reducedMotion}
                  />
                );
              })}

              {schedule.todayEvents.length > maxEvents && (
                <span className="font-mono text-micro text-text-3 mt-1 pl-[68px]">
                  +{schedule.todayEvents.length - maxEvents} {t("todaysSchedule.moreToday") ?? "more today"}
                </span>
              )}
            </div>

            {/* Tomorrow preview (lg only) */}
            {showActions(size) && schedule.tomorrowEvents.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border-subtle">
                <span className="font-mono text-micro text-text-mute uppercase tracking-wider">
                  {t("todaysSchedule.tomorrow") ?? "Tomorrow"}
                </span>
                <div className="flex flex-col mt-1">
                  {schedule.tomorrowEvents.slice(0, 5).map((event) => (
                    <div key={event.id} className="flex items-center gap-2 py-[2px]">
                      <span className="font-mono text-micro text-text-3 w-[52px] shrink-0">
                        {formatTime(new Date(event.startDate!))}
                      </span>
                      <div className="w-[4px] h-[4px] rounded-full" style={{ backgroundColor: event.color || WT.accent }} />
                      <span className="font-mohave text-caption-sm text-text-3 truncate">{event.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ScrollFade>
        )}

      </div>
    </Card>
  );
}
