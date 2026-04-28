"use client";

import { useMemo } from "react";
import { isSameDay, startOfWeek, endOfWeek, isBefore, isAfter } from "date-fns";
import {
  type InternalCalendarEvent,
} from "@/lib/utils/calendar-utils";
import { useCalendarStore } from "@/stores/calendar-store";
import { useTasks } from "@/lib/hooks";
import { TaskStatus } from "@/lib/types/models";
import { X } from "lucide-react";

interface CalendarToolbarProps {
  events: InternalCalendarEvent[];
  t: (key: string) => string;
}

export function CalendarToolbar({ events, t }: CalendarToolbarProps) {
  const {
    filterTeamMemberIds,
    filterTaskTypes,
    filterProjectIds,
    filterStatuses,
    updateFilters,
    unscheduledTrayCollapsed,
    toggleUnscheduledTray,
  } = useCalendarStore();

  // Unscheduled count for the toolbar chip (T15)
  const { data: taskData } = useTasks();
  const unscheduledCount = useMemo(() => {
    const all = taskData?.tasks ?? [];
    return all.filter(
      (t) =>
        !t.startDate &&
        t.status !== TaskStatus.Completed &&
        t.status !== TaskStatus.Cancelled &&
        !t.deletedAt
    ).length;
  }, [taskData]);

  const stats = useMemo(() => {
    const today = new Date();
    const todayEvents = events.filter((e) => isSameDay(e.startDate, today));
    const weekStartDate = startOfWeek(today);
    const weekEndDate = endOfWeek(today);
    const weekEvents = events.filter(
      (e) => !isBefore(e.startDate, weekStartDate) && !isAfter(e.startDate, weekEndDate)
    );

    // Group by real type display ('Vinyl Install', 'Rail Install', etc.) and
    // remember the first effective color we see for each so the legend dot
    // matches the actual card stripe.
    const typeStats: Record<string, { count: number; color: string }> = {};
    events.forEach((e) => {
      const label = e.typeLabel || "Task";
      if (!typeStats[label]) {
        typeStats[label] = { count: 0, color: e.color };
      }
      typeStats[label].count += 1;
    });

    return {
      todayCount: todayEvents.length,
      weekCount: weekEvents.length,
      totalCount: events.length,
      typeStats,
    };
  }, [events]);

  // Collect active filter chips
  const activeFilters: { label: string; onRemove: () => void }[] = [];
  if (filterTeamMemberIds.length > 0) {
    activeFilters.push({
      label: `${filterTeamMemberIds.length} team member${filterTeamMemberIds.length > 1 ? "s" : ""}`,
      onRemove: () => updateFilters({ filterTeamMemberIds: [] }),
    });
  }
  if (filterTaskTypes.length > 0) {
    activeFilters.push({
      label: `${filterTaskTypes.length} type${filterTaskTypes.length > 1 ? "s" : ""}`,
      onRemove: () => updateFilters({ filterTaskTypes: [] }),
    });
  }
  if (filterProjectIds.length > 0) {
    activeFilters.push({
      label: `${filterProjectIds.length} project${filterProjectIds.length > 1 ? "s" : ""}`,
      onRemove: () => updateFilters({ filterProjectIds: [] }),
    });
  }
  if (filterStatuses.length > 0) {
    activeFilters.push({
      label: `${filterStatuses.length} status${filterStatuses.length > 1 ? "es" : ""}`,
      onRemove: () => updateFilters({ filterStatuses: [] }),
    });
  }

  return (
    <div className="flex items-center gap-3 px-1 shrink-0">
      {/* T15 — // UNSCHEDULED [N] chip toggles the tray */}
      <button
        type="button"
        onClick={toggleUnscheduledTray}
        aria-label={
          unscheduledTrayCollapsed
            ? `Show ${unscheduledCount} unscheduled tasks`
            : "Collapse unscheduled tray"
        }
        className="font-mono text-[11px] uppercase tracking-wider tabular-nums px-2 py-1 cursor-pointer"
        style={{
          color: unscheduledCount > 0 ? "var(--text-2)" : "var(--text-3)",
          background: "rgba(255, 255, 255, 0.04)",
          border: "1px solid var(--line)",
          borderRadius: 4,
          fontFeatureSettings: '"tnum" 1, "zero" 1',
          transition: "background 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background =
            "rgba(255, 255, 255, 0.08)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background =
            "rgba(255, 255, 255, 0.04)";
        }}
      >
        {`// UNSCHEDULED [${unscheduledCount}]`}
      </button>
      <div className="w-[1px] h-[16px] bg-border-subtle" />

      {/* Today / This Week counts */}
      <div className="flex items-center gap-[6px]">
        <span className="font-mono text-micro text-text-mute uppercase tracking-widest">
          {t("stats.today")}
        </span>
        <span className="font-mono text-data-sm text-text">
          {stats.todayCount}
        </span>
      </div>
      <div className="w-[1px] h-[16px] bg-border-subtle" />
      <div className="flex items-center gap-[6px]">
        <span className="font-mono text-micro text-text-mute uppercase tracking-widest">
          {t("stats.thisWeek")}
        </span>
        <span className="font-mono text-data-sm text-text">
          {stats.weekCount}
        </span>
      </div>
      <div className="w-[1px] h-[16px] bg-border-subtle" />

      {/* Active filter chips */}
      {activeFilters.length > 0 && (
        <div className="flex items-center gap-[6px]">
          {activeFilters.map((filter) => (
            <button
              key={filter.label}
              onClick={filter.onRemove}
              className="flex items-center gap-[4px] px-[8px] py-[2px] rounded-[4px] bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.18)] text-text font-mono text-micro uppercase tracking-wider hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              {filter.label}
              <X className="w-[10px] h-[10px]" />
            </button>
          ))}
          <div className="w-[1px] h-[16px] bg-border-subtle" />
        </div>
      )}

      {/* Task type legend — hidden on mobile. Uses the real task_types.display
          and per-type DB color (matches the card stripe). */}
      <div className="hidden md:flex items-center gap-[10px] ml-auto flex-wrap">
        {Object.entries(stats.typeStats)
          .sort(([, a], [, b]) => b.count - a.count)
          .map(([type, { count, color }]) => (
            <div key={type} className="flex items-center gap-[4px]">
              <div
                className="w-[8px] h-[8px] rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="font-mono text-micro text-text-3 uppercase tracking-wider">
                {type}
              </span>
              <span className="font-mono text-micro text-text-mute tabular-nums">
                {count}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
