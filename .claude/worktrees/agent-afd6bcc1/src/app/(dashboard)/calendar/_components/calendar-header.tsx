"use client";

import { useMemo, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  Zap,
} from "lucide-react";
import {
  addDays,
  addMonths,
  addWeeks,
  startOfWeek,
  endOfWeek,
  format,
  subMonths,
  subWeeks,
  subDays,
} from "date-fns";
import { Button } from "@/components/ui/button";
import { SegmentedPicker } from "@/components/ops/segmented-picker";
import { useCalendarStore } from "@/stores/calendar-store";
import type { SchedulerView } from "@/lib/types/scheduling";
import { cn } from "@/lib/utils/cn";
import { useTasks } from "@/lib/hooks";
import { TaskStatus } from "@/lib/types/models";

interface CalendarHeaderProps {
  t: (key: string) => string;
}

export function CalendarHeader({ t }: CalendarHeaderProps) {
  const {
    currentDate,
    view,
    setView,
    setCurrentDate,
    goToToday,
    isFilterSidebarOpen,
    toggleFilterSidebar,
  } = useCalendarStore();

  // Unscheduled count for auto-schedule badge
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

  const navigate = useCallback(
    (direction: "prev" | "next") => {
      const fn =
        direction === "next"
          ? view === "month"
            ? addMonths
            : view === "timeline"
              ? addWeeks
              : addDays
          : view === "month"
            ? (d: Date, n: number) => subMonths(d, n)
            : view === "timeline"
              ? (d: Date, n: number) => subWeeks(d, n)
              : (d: Date, n: number) => subDays(d, n);
      setCurrentDate(fn(currentDate, 1));
    },
    [view, currentDate, setCurrentDate]
  );

  const headerTitle = useMemo(() => {
    if (view === "month") return format(currentDate, "MMMM yyyy");
    if (view === "timeline") {
      const ws = startOfWeek(currentDate);
      const we = endOfWeek(currentDate);
      if (ws.getMonth() === we.getMonth()) {
        return `${format(ws, "MMM d")} - ${format(we, "d, yyyy")}`;
      }
      return `${format(ws, "MMM d")} - ${format(we, "MMM d, yyyy")}`;
    }
    // day view
    return format(currentDate, "MMMM d, yyyy");
  }, [currentDate, view]);

  const viewOptions: { value: SchedulerView; label: string }[] = [
    { value: "timeline", label: "Timeline" },
    { value: "month", label: "Month" },
    { value: "day", label: "Day" },
  ];

  return (
    <div className="flex items-center justify-between shrink-0 flex-wrap gap-y-1">
      {/* Left: Navigation arrows + date label + Today pill + Filter toggle */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("prev")}
          title={`${t("previous")} (Left Arrow)`}
        >
          <ChevronLeft className="w-[18px] h-[18px]" />
        </Button>
        <span className="font-mohave text-body-lg text-text-primary min-w-[160px] md:min-w-[220px] text-left select-none">
          {headerTitle}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("next")}
          title={`${t("next")} (Right Arrow)`}
        >
          <ChevronRight className="w-[18px] h-[18px]" />
        </Button>
        <Button variant="secondary" size="sm" onClick={goToToday}>
          {t("today")}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleFilterSidebar}
          className={cn(
            "hidden md:flex",
            isFilterSidebarOpen && "text-ops-accent bg-ops-accent-muted/20"
          )}
          title="Toggle filters"
        >
          <Filter className="w-[16px] h-[16px]" />
        </Button>
      </div>

      {/* Right: View switcher + Auto-Schedule + Keyboard hints */}
      <div className="hidden md:flex items-center gap-2">
        <SegmentedPicker
          options={viewOptions}
          value={view}
          onChange={setView}
        />

        {/* Auto-Schedule button */}
        <button
          onClick={() => {
            console.log("[AutoSchedule] Triggered — hook will be wired in cleanup task");
          }}
          className="relative flex items-center gap-[5px] px-[10px] py-[6px] rounded-[3px] font-kosugi text-[10px] uppercase tracking-wider transition-colors"
          style={{
            color: "#597794",
            border: "1px solid rgba(89,119,148,0.30)",
            backgroundColor: "transparent",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor =
              "rgba(89,119,148,0.08)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor =
              "transparent";
          }}
        >
          <Zap className="w-[12px] h-[12px]" />
          AUTO-SCHEDULE
          {unscheduledCount > 0 && (
            <span
              className="flex items-center justify-center rounded-full font-mono text-[9px] leading-none"
              style={{
                minWidth: 16,
                height: 16,
                padding: "0 4px",
                backgroundColor: "rgba(89,119,148,0.20)",
                color: "#597794",
              }}
            >
              {unscheduledCount}
            </span>
          )}
        </button>

        {/* Keyboard hints */}
        <div className="hidden xl:flex items-center gap-[3px] ml-[4px]">
          <kbd className="font-mono text-[9px] text-text-disabled bg-background-panel px-[5px] py-[2px] rounded-sm border border-border-subtle">
            T
          </kbd>
          <kbd className="font-mono text-[9px] text-text-disabled bg-background-panel px-[5px] py-[2px] rounded-sm border border-border-subtle">
            M
          </kbd>
          <kbd className="font-mono text-[9px] text-text-disabled bg-background-panel px-[5px] py-[2px] rounded-sm border border-border-subtle">
            D
          </kbd>
        </div>
      </div>
    </div>
  );
}
