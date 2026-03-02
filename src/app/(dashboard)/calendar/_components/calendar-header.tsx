"use client";

import { useMemo, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Filter,
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
import { useCalendarStore, type CalendarView } from "@/stores/calendar-store";
import { cn } from "@/lib/utils/cn";

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

  const navigate = useCallback(
    (direction: "prev" | "next") => {
      const fn = direction === "next"
        ? view === "month" ? addMonths
          : view === "week" ? addWeeks
          : addDays
        : view === "month" ? (d: Date, n: number) => subMonths(d, n)
          : view === "week" ? (d: Date, n: number) => subWeeks(d, n)
          : (d: Date, n: number) => subDays(d, n);
      setCurrentDate(fn(currentDate, 1));
    },
    [view, currentDate, setCurrentDate]
  );

  const headerTitle = useMemo(() => {
    if (view === "month") return format(currentDate, "MMMM yyyy");
    if (view === "week") {
      const ws = startOfWeek(currentDate);
      const we = endOfWeek(currentDate);
      if (ws.getMonth() === we.getMonth()) {
        return `${format(ws, "MMM d")} - ${format(we, "d, yyyy")}`;
      }
      return `${format(ws, "MMM d")} - ${format(we, "MMM d, yyyy")}`;
    }
    return format(currentDate, "MMMM d, yyyy");
  }, [currentDate, view]);

  const viewOptions: { value: CalendarView; label: string }[] = [
    { value: "month", label: t("view.month") },
    { value: "week", label: t("view.week") },
    { value: "day", label: t("view.day") },
    { value: "team", label: t("view.team") },
    { value: "agenda", label: t("view.agenda") },
  ];

  return (
    <div className="flex items-center justify-between shrink-0 flex-wrap gap-y-1">
      {/* Left: Icon + Today + Filter toggle */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <CalendarIcon className="w-[18px] h-[18px] text-ops-accent" />
        </div>
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

      {/* Center: Navigation */}
      <div className="flex items-center gap-[4px]">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("prev")}
          title={`${t("previous")} (Left Arrow)`}
        >
          <ChevronLeft className="w-[18px] h-[18px]" />
        </Button>
        <span className="font-mohave text-body-lg text-text-primary min-w-[160px] md:min-w-[260px] text-center select-none">
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
      </div>

      {/* Right: View toggle — hidden on mobile (agenda forced) */}
      <div className="hidden md:flex items-center gap-1.5">
        <SegmentedPicker
          options={viewOptions}
          value={view}
          onChange={setView}
        />
        <div className="hidden xl:flex items-center gap-[3px] ml-[4px]">
          <kbd className="font-mono text-[9px] text-text-disabled bg-background-panel px-[5px] py-[2px] rounded-sm border border-border-subtle">
            M
          </kbd>
          <kbd className="font-mono text-[9px] text-text-disabled bg-background-panel px-[5px] py-[2px] rounded-sm border border-border-subtle">
            W
          </kbd>
          <kbd className="font-mono text-[9px] text-text-disabled bg-background-panel px-[5px] py-[2px] rounded-sm border border-border-subtle">
            D
          </kbd>
          <kbd className="font-mono text-[9px] text-text-disabled bg-background-panel px-[5px] py-[2px] rounded-sm border border-border-subtle">
            T
          </kbd>
          <kbd className="font-mono text-[9px] text-text-disabled bg-background-panel px-[5px] py-[2px] rounded-sm border border-border-subtle">
            A
          </kbd>
        </div>
      </div>
    </div>
  );
}
