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
  startOfMonth,
  endOfMonth,
  format,
  isSameDay,
  isWithinInterval,
  subMonths,
  subWeeks,
  subDays,
} from "date-fns";
import { Button } from "@/components/ui/button";
import { SegmentedPicker } from "@/components/ops/segmented-picker";
import { useScheduleStore } from "@/stores/schedule-store";
import type { SchedulerView } from "@/lib/types/scheduling";
import { cn } from "@/lib/utils/cn";
import { useTasks } from "@/lib/hooks";
import { TaskStatus } from "@/lib/types/models";

interface ScheduleHeaderProps {
  t: (key: string) => string;
}

export function ScheduleHeader({ t }: ScheduleHeaderProps) {
  const {
    currentDate,
    view,
    setView,
    setCurrentDate,
    goToToday,
    isFilterSidebarOpen,
    toggleFilterSidebar,
  } = useScheduleStore();

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
      const isWeekly = view === "week" || view === "crew";
      const isMonthly = view === "month";
      const fn =
        direction === "next"
          ? isMonthly
            ? addMonths
            : isWeekly
              ? addWeeks
              : addDays
          : isMonthly
            ? (d: Date, n: number) => subMonths(d, n)
            : isWeekly
              ? (d: Date, n: number) => subWeeks(d, n)
              : (d: Date, n: number) => subDays(d, n);
      setCurrentDate(fn(currentDate, 1));
    },
    [view, currentDate, setCurrentDate]
  );

  const headerTitle = useMemo(() => {
    if (view === "month") return format(currentDate, "MMMM yyyy");
    if (view === "week" || view === "crew") {
      const ws = startOfWeek(currentDate, { weekStartsOn: 1 });
      const we = endOfWeek(currentDate, { weekStartsOn: 1 });
      if (ws.getMonth() === we.getMonth()) {
        return `${format(ws, "MMM d")} - ${format(we, "d, yyyy")}`;
      }
      return `${format(ws, "MMM d")} - ${format(we, "MMM d, yyyy")}`;
    }
    // day view
    return format(currentDate, "MMMM d, yyyy");
  }, [currentDate, view]);

  const viewOptions: { value: SchedulerView; label: string }[] = [
    { value: "day", label: "// DAY" },
    { value: "week", label: "// WEEK" },
    { value: "month", label: "// MONTH" },
    { value: "crew", label: "// CREW" },
  ];

  // T14 — TODAY pill disabled state: viewing today already?
  const isViewingToday = useMemo(() => {
    const now = new Date();
    if (view === "day") return isSameDay(currentDate, now);
    if (view === "week" || view === "crew") {
      const ws = startOfWeek(currentDate, { weekStartsOn: 1 });
      const we = endOfWeek(currentDate, { weekStartsOn: 1 });
      return isWithinInterval(now, { start: ws, end: we });
    }
    if (view === "month") {
      return isWithinInterval(now, {
        start: startOfMonth(currentDate),
        end: endOfMonth(currentDate),
      });
    }
    return false;
  }, [view, currentDate]);

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
        <span className="font-mohave text-body-lg text-text min-w-[160px] md:min-w-[220px] text-left select-none">
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
        {/* T14 — TODAY pill (signal #3). JetBrains Mono, accent border, accent
            text, transparent fill at rest. Fills accent on hover. Disabled
            when current view already includes today. */}
        <button
          type="button"
          onClick={goToToday}
          disabled={isViewingToday}
          aria-label="Jump to today"
          className="font-mono text-[11px] uppercase tracking-wide leading-none px-[10px] py-[5px] rounded tabular-nums"
          style={{
            color: "var(--ops-accent)",
            border: "1px solid var(--ops-accent)",
            background: "transparent",
            opacity: isViewingToday ? 0.3 : 1,
            cursor: isViewingToday ? "not-allowed" : "pointer",
            transition:
              "background-color 0.15s cubic-bezier(0.22, 1, 0.36, 1), color 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
            fontFeatureSettings: '"tnum" 1, "zero" 1',
          }}
          onMouseEnter={(e) => {
            if (isViewingToday) return;
            (e.currentTarget as HTMLElement).style.backgroundColor =
              "var(--ops-accent)";
            (e.currentTarget as HTMLElement).style.color = "#000";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor =
              "transparent";
            (e.currentTarget as HTMLElement).style.color = "var(--ops-accent)";
          }}
        >
          [ TODAY ]
        </button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleFilterSidebar}
          className={cn(
            "hidden md:flex",
            isFilterSidebarOpen && "text-text bg-[rgba(255,255,255,0.08)]"
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
          className="relative flex items-center gap-[5px] px-[10px] py-[6px] rounded-panel font-mono text-micro uppercase tracking-[0.16em] transition-colors"
          style={{
            color: "var(--ops-accent)",
            border: "1px solid var(--ops-accent-line)",
            backgroundColor: "transparent",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor =
              "rgba(111, 148, 176,0.08)";
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
              className="flex items-center justify-center rounded-full font-mono text-micro leading-none"
              style={{
                minWidth: 16,
                height: 16,
                padding: "0 4px",
                backgroundColor: "rgba(111, 148, 176,0.20)",
                color: "var(--ops-accent)",
              }}
            >
              {unscheduledCount}
            </span>
          )}
        </button>

        {/* Keyboard hints */}
        <div className="hidden xl:flex items-center gap-[3px] ml-[4px]">
          <kbd className="font-mono text-micro text-text-mute bg-glass glass-surface px-[5px] py-[2px] rounded-sm border border-border-subtle">
            D
          </kbd>
          <kbd className="font-mono text-micro text-text-mute bg-glass glass-surface px-[5px] py-[2px] rounded-sm border border-border-subtle">
            W
          </kbd>
          <kbd className="font-mono text-micro text-text-mute bg-glass glass-surface px-[5px] py-[2px] rounded-sm border border-border-subtle">
            M
          </kbd>
          <kbd className="font-mono text-micro text-text-mute bg-glass glass-surface px-[5px] py-[2px] rounded-sm border border-border-subtle">
            C
          </kbd>
        </div>
      </div>
    </div>
  );
}
