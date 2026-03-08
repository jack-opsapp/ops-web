"use client";

/**
 * CalendarScheduler — Web-optimized port of iOS CalendarSchedulerSheet
 *
 * Features:
 *  - Collapsible trigger ("Tap to schedule" → inline calendar)
 *  - Month navigation with weekday headers (Mon-start)
 *  - Two-click date range selection (auto-sorts start/end)
 *  - Range visualization with directional borders (matching iOS)
 *  - Today indicator (accent background)
 *  - Event dots on occupied dates (up to 3)
 *  - Selected dates header: START → END → DURATION
 *  - Clear / Collapse actions
 */

import { useState, useMemo, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SchedulerEvent {
  id: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  color: string;
  title: string;
}

export interface CalendarSchedulerProps {
  startDate?: string; // YYYY-MM-DD or ""
  endDate?: string;
  onDateChange: (start: string, end: string) => void;
  onClear?: () => void;
  /** Existing events to display as colored dots */
  events?: SchedulerEvent[];
  /** Label shown above the trigger / header */
  label?: string;
}

type SelectionMode = "idle" | "selecting" | "reviewing";

// ─── Date Helpers ───────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseISODate(s: string): Date | null {
  if (!s) return null;
  const parts = s.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatDisplayDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function daysBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.round(ms / 86_400_000) + 1;
}

function monthYearLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** Build a 6×7 (42-day) grid starting from Monday of the week containing the first of the month. */
function getMonthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  let dow = first.getDay(); // 0=Sun
  if (dow === 0) dow = 7; // shift Sunday to 7
  const offset = dow - 1; // days before first Monday

  const start = new Date(first);
  start.setDate(start.getDate() - offset);

  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}

// ─── CalendarScheduler ──────────────────────────────────────────────────────

export function CalendarScheduler({
  startDate: startProp,
  endDate: endProp,
  onDateChange,
  onClear,
  events = [],
  label = "Schedule",
}: CalendarSchedulerProps) {
  // Parse initial dates
  const initStart = parseISODate(startProp ?? "");
  const initEnd = parseISODate(endProp ?? "");
  const hasInitial = !!initStart && !!initEnd;

  const [selectedStart, setSelectedStart] = useState<Date | null>(initStart);
  const [selectedEnd, setSelectedEnd] = useState<Date | null>(initEnd);
  const [mode, setMode] = useState<SelectionMode>(
    hasInitial ? "reviewing" : "idle"
  );
  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    const base = initStart ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [expanded, setExpanded] = useState(!hasInitial);

  const grid = useMemo(() => getMonthGrid(currentMonth), [currentMonth]);
  const hasSelection = mode === "reviewing" && !!selectedStart && !!selectedEnd;

  // ── Event lookup ──────────────────────────────────────────────────────────

  const eventsForDate = useCallback(
    (date: Date) =>
      events.filter((ev) => {
        const s = parseISODate(ev.startDate);
        const e = parseISODate(ev.endDate);
        if (!s || !e) return false;
        return date >= s && date <= e;
      }),
    [events]
  );

  // ── Selection handlers ────────────────────────────────────────────────────

  function handleDateClick(date: Date) {
    if (mode === "idle" || mode === "reviewing") {
      // First click — set start
      setSelectedStart(date);
      setSelectedEnd(date);
      setMode("selecting");
    } else {
      // Second click — set end, auto-sort
      let s = selectedStart!;
      let e = date;
      if (e < s) [s, e] = [e, s];
      setSelectedStart(s);
      setSelectedEnd(e);
      setMode("reviewing");
      onDateChange(toISODate(s), toISODate(e));
    }
  }

  function handleClear() {
    setSelectedStart(null);
    setSelectedEnd(null);
    setMode("idle");
    onClear?.();
  }

  function prevMonth() {
    setCurrentMonth(
      (p) => new Date(p.getFullYear(), p.getMonth() - 1, 1)
    );
  }

  function nextMonth() {
    setCurrentMonth(
      (p) => new Date(p.getFullYear(), p.getMonth() + 1, 1)
    );
  }

  // ── Cell state ────────────────────────────────────────────────────────────

  function cellState(date: Date) {
    const inMonth = date.getMonth() === currentMonth.getMonth();
    const today = isToday(date);
    const isStart = selectedStart ? isSameDay(date, selectedStart) : false;
    const isEnd = selectedEnd ? isSameDay(date, selectedEnd) : false;
    const singleDay = isStart && isEnd;
    const inRange =
      !!(selectedStart && selectedEnd && date > selectedStart && date < selectedEnd);
    const dots = eventsForDate(date);
    return { inMonth, today, isStart, isEnd, singleDay, inRange, dots };
  }

  // ── Collapsed trigger ─────────────────────────────────────────────────────

  if (!expanded) {
    return (
      <div className="flex flex-col gap-0.5">
        <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
          {label}
        </label>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={cn(
            "w-full flex items-center gap-1.5 px-1.5 py-1.5",
            "bg-background-input border border-border rounded-sm",
            "text-left transition-all duration-150",
            "hover:border-border-medium focus:border-ops-accent focus:outline-none"
          )}
        >
          <CalendarIcon className="w-[16px] h-[16px] text-text-tertiary shrink-0" />
          {hasSelection && selectedStart && selectedEnd ? (
            <div className="flex-1 min-w-0 flex items-center gap-[6px]">
              <span className="font-mohave text-body text-text-primary">
                {formatDisplayDate(selectedStart)}
              </span>
              <span className="font-mohave text-body-sm text-text-tertiary">
                to
              </span>
              <span className="font-mohave text-body text-text-primary">
                {formatDisplayDate(selectedEnd)}
              </span>
              <span className="font-mohave text-body-sm text-ops-accent ml-auto">
                {daysBetween(selectedStart, selectedEnd)}d
              </span>
            </div>
          ) : (
            <span className="font-mohave text-body text-text-tertiary">
              Tap to schedule
            </span>
          )}
        </button>
      </div>
    );
  }

  // ── Expanded calendar ─────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-1 animate-fade-in">
      <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
        {label}
      </label>

      {/* Selected dates header */}
      <div
        className={cn(
          "flex items-center px-1.5 py-1",
          "bg-background-card border rounded-sm transition-all duration-150",
          hasSelection ? "border-ops-accent/30" : "border-border"
        )}
      >
        {/* Start */}
        <div className="flex-1 min-w-0">
          <p className="font-kosugi text-[10px] text-text-secondary uppercase tracking-widest leading-none mb-[2px]">
            Start
          </p>
          <p
            className={cn(
              "font-mohave text-body-sm leading-tight",
              hasSelection || mode === "selecting"
                ? "text-text-primary"
                : "text-text-tertiary"
            )}
          >
            {selectedStart && mode !== "idle"
              ? formatDisplayDate(selectedStart)
              : "Select date"}
          </p>
        </div>

        {/* Arrow */}
        <ChevronRight
          className={cn(
            "w-[14px] h-[14px] shrink-0 mx-1",
            hasSelection ? "text-ops-accent" : "text-text-tertiary"
          )}
        />

        {/* End */}
        <div className="flex-1 min-w-0">
          <p className="font-kosugi text-[10px] text-text-secondary uppercase tracking-widest leading-none mb-[2px]">
            End
          </p>
          <p
            className={cn(
              "font-mohave text-body-sm leading-tight",
              hasSelection ? "text-text-primary" : "text-text-tertiary"
            )}
          >
            {selectedEnd && hasSelection
              ? formatDisplayDate(selectedEnd)
              : "Select date"}
          </p>
        </div>

        {/* Duration */}
        <div className="text-right shrink-0 ml-1">
          <p className="font-kosugi text-[10px] text-text-secondary uppercase tracking-widest leading-none mb-[2px]">
            Duration
          </p>
          <p
            className={cn(
              "font-mohave text-body-sm leading-tight",
              hasSelection ? "text-ops-accent" : "text-text-tertiary"
            )}
          >
            {hasSelection && selectedStart && selectedEnd
              ? `${daysBetween(selectedStart, selectedEnd)} day${daysBetween(selectedStart, selectedEnd) !== 1 ? "s" : ""}`
              : "\u2014"}
          </p>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="bg-background-card border border-border rounded-sm p-1.5">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-1">
          <button
            type="button"
            onClick={prevMonth}
            className="p-[4px] text-ops-accent hover:text-ops-accent-hover transition-colors"
          >
            <ChevronLeft className="w-[16px] h-[16px]" />
          </button>
          <span className="font-mohave text-body font-semibold text-text-primary">
            {monthYearLabel(currentMonth)}
          </span>
          <button
            type="button"
            onClick={nextMonth}
            className="p-[4px] text-ops-accent hover:text-ops-accent-hover transition-colors"
          >
            <ChevronRight className="w-[16px] h-[16px]" />
          </button>
        </div>

        {/* Weekday headers */}
        <div className="grid grid-cols-7 mb-[2px]">
          {WEEKDAY_LABELS.map((lbl, i) => (
            <div
              key={i}
              className="text-center font-kosugi text-[10px] text-text-secondary uppercase tracking-widest py-[4px]"
            >
              {lbl}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {grid.map((date, i) => {
            const s = cellState(date);
            return (
              <DayCell
                key={i}
                date={date}
                {...s}
                onClick={() => s.inMonth && handleDateClick(date)}
              />
            );
          })}
        </div>
      </div>

      {/* Actions row */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="font-mohave text-body-sm text-text-tertiary hover:text-text-secondary transition-colors"
        >
          {hasSelection ? "Collapse" : "Cancel"}
        </button>

        <div className="flex-1" />

        {(selectedStart || selectedEnd) && (
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-[4px] font-mohave text-body-sm text-status-error hover:text-status-error/80 transition-colors"
          >
            <X className="w-[12px] h-[12px]" />
            Clear dates
          </button>
        )}
      </div>
    </div>
  );
}

// ─── DayCell ────────────────────────────────────────────────────────────────

function DayCell({
  date,
  inMonth,
  today,
  isStart,
  isEnd,
  singleDay,
  inRange,
  dots,
  onClick,
}: {
  date: Date;
  inMonth: boolean;
  today: boolean;
  isStart: boolean;
  isEnd: boolean;
  singleDay: boolean;
  inRange: boolean;
  dots: SchedulerEvent[];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!inMonth}
      className={cn(
        "relative h-[36px] flex flex-col items-center justify-center",
        "transition-all duration-100",
        !inMonth && "opacity-20 cursor-default",
        inMonth && "cursor-pointer hover:bg-[rgba(255,255,255,0.04)]"
      )}
    >
      {/* Today accent background */}
      {today && (
        <div className="absolute inset-[2px] rounded-sm bg-ops-accent" />
      )}

      {/* Selection border — mirrors iOS SchedulerDayCell */}
      {singleDay && (isStart || isEnd) && (
        <div className="absolute inset-[1px] rounded-sm border-[1.5px] border-text-primary" />
      )}
      {isStart && !singleDay && (
        <div className="absolute inset-y-[1px] left-[1px] right-0 rounded-l-sm border-[1.5px] border-r-0 border-text-primary" />
      )}
      {isEnd && !singleDay && (
        <div className="absolute inset-y-[1px] right-[1px] left-0 rounded-r-sm border-[1.5px] border-l-0 border-text-primary" />
      )}
      {inRange && !isStart && !isEnd && (
        <>
          <div className="absolute top-[1px] left-0 right-0 h-[1.5px] bg-text-primary" />
          <div className="absolute bottom-[1px] left-0 right-0 h-[1.5px] bg-text-primary" />
        </>
      )}

      {/* Day number */}
      <span
        className={cn(
          "relative z-10 font-mohave text-body-sm font-semibold leading-none",
          today
            ? "text-white"
            : inMonth
              ? "text-text-primary"
              : "text-text-tertiary"
        )}
      >
        {date.getDate()}
      </span>

      {/* Event dots */}
      {dots.length > 0 && (
        <div className="relative z-10 flex gap-[2px] mt-[1px]">
          {dots.slice(0, 3).map((ev, j) => (
            <div
              key={j}
              className="w-[3px] h-[3px] rounded-full"
              style={{ backgroundColor: ev.color }}
            />
          ))}
        </div>
      )}
    </button>
  );
}
