"use client";

import { useMemo } from "react";
import { isSameDay, startOfWeek, endOfWeek, isBefore, isAfter } from "date-fns";
import {
  type InternalCalendarEvent,
  getEventColors,
} from "@/lib/utils/calendar-utils";
import { useCalendarStore } from "@/stores/calendar-store";
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
  } = useCalendarStore();

  const stats = useMemo(() => {
    const today = new Date();
    const todayEvents = events.filter((e) => isSameDay(e.startDate, today));
    const weekStartDate = startOfWeek(today);
    const weekEndDate = endOfWeek(today);
    const weekEvents = events.filter(
      (e) => !isBefore(e.startDate, weekStartDate) && !isAfter(e.startDate, weekEndDate)
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
      {/* Today / This Week counts */}
      <div className="flex items-center gap-[6px]">
        <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-widest">
          {t("stats.today")}
        </span>
        <span className="font-mono text-data-sm text-text-primary">
          {stats.todayCount}
        </span>
      </div>
      <div className="w-[1px] h-[16px] bg-border-subtle" />
      <div className="flex items-center gap-[6px]">
        <span className="font-kosugi text-[10px] text-text-disabled uppercase tracking-widest">
          {t("stats.thisWeek")}
        </span>
        <span className="font-mono text-data-sm text-text-primary">
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
              className="flex items-center gap-[4px] px-[8px] py-[2px] rounded-sm bg-ops-accent-muted/20 border border-ops-accent/20 text-ops-accent font-kosugi text-[9px] uppercase tracking-wider hover:bg-ops-accent-muted/30 transition-colors"
            >
              {filter.label}
              <X className="w-[10px] h-[10px]" />
            </button>
          ))}
          <div className="w-[1px] h-[16px] bg-border-subtle" />
        </div>
      )}

      {/* Task type legend — hidden on mobile */}
      <div className="hidden md:flex items-center gap-[8px] ml-auto">
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
