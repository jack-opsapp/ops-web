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
  AlertTriangle,
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
  /** Existing tasks in the project — shown as colored bars on calendar */
  projectTasks?: Array<{
    id: string;
    startDate: Date | null;
    endDate: Date | null;
    taskColor: string;
    title: string;
  }>;
  /** Dates where selected team members are booked on other projects */
  teamConflicts?: Array<{
    date: Date;
    memberName: string;
    projectTitle: string;
  }>;
  /** Date ranges that are blocked due to dependency constraints */
  blockedDates?: Array<{
    start: Date;
    end: Date;
    reason: string;
  }>;
  /** When true, calendar is always expanded (no collapse trigger) */
  alwaysExpanded?: boolean;
  /** Callback when scheduling conflicts are detected in selected range */
  onConflictDetected?: (conflicts: Array<{
    type: "team_conflict" | "dependency_violation";
    message: string;
    severity: "warning" | "error";
  }>) => void;
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

/** Check if a date falls within an inclusive range [start, end]. */
function isDateInRange(date: Date, start: Date, end: Date): boolean {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  return d >= s && d <= e;
}

/** Check if two dates represent the same calendar day. */
function isSameDayLoose(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
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
  projectTasks,
  teamConflicts,
  blockedDates,
  alwaysExpanded,
  onConflictDetected,
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
  const [expanded, setExpanded] = useState(alwaysExpanded ? true : !hasInitial);
  const [detectedConflicts, setDetectedConflicts] = useState<Array<{ type: string; message: string; severity: string }>>([]);

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

  // ── Project task lookup ──────────────────────────────────────────────────

  const tasksForDate = useCallback(
    (date: Date) => {
      if (!projectTasks) return [];
      return projectTasks.filter((t) => {
        if (!t.startDate || !t.endDate) return false;
        return isDateInRange(date, t.startDate, t.endDate);
      });
    },
    [projectTasks]
  );

  // ── Team conflict lookup ────────────────────────────────────────────────

  const conflictsForDate = useCallback(
    (date: Date) => {
      if (!teamConflicts) return [];
      return teamConflicts.filter((c) => isSameDayLoose(date, c.date));
    },
    [teamConflicts]
  );

  // ── Blocked date lookup ─────────────────────────────────────────────────

  const isDateBlocked = useCallback(
    (date: Date) => {
      if (!blockedDates) return false;
      return blockedDates.some((b) => isDateInRange(date, b.start, b.end));
    },
    [blockedDates]
  );

  // ── Selection handlers ────────────────────────────────────────────────────

  function handleDateClick(date: Date) {
    // Skip blocked dates
    if (isDateBlocked(date)) return;

    if (mode === "idle" || mode === "reviewing") {
      // First click — set start
      setSelectedStart(date);
      setSelectedEnd(date);
      setMode("selecting");
      setDetectedConflicts([]);
    } else {
      // Second click — set end, auto-sort
      let s = selectedStart!;
      let e = date;
      if (e < s) [s, e] = [e, s];
      setSelectedStart(s);
      setSelectedEnd(e);
      setMode("reviewing");
      onDateChange(toISODate(s), toISODate(e));

      // Detect conflicts in selected range
      detectConflictsInRange(s, e);
    }
  }

  function detectConflictsInRange(rangeStart: Date, rangeEnd: Date) {
    const conflicts: Array<{
      type: "team_conflict" | "dependency_violation";
      message: string;
      severity: "warning" | "error";
    }> = [];

    // Check team conflicts
    if (teamConflicts) {
      const overlapping = teamConflicts.filter((c) =>
        isDateInRange(c.date, rangeStart, rangeEnd)
      );
      // Deduplicate by member + project
      const seen = new Set<string>();
      for (const c of overlapping) {
        const key = `${c.memberName}|${c.projectTitle}`;
        if (!seen.has(key)) {
          seen.add(key);
          conflicts.push({
            type: "team_conflict",
            message: `${c.memberName} is booked on "${c.projectTitle}" during this period`,
            severity: "warning",
          });
        }
      }
    }

    // Check blocked dates
    if (blockedDates) {
      for (const b of blockedDates) {
        // Check if blocked range overlaps with selected range
        const blockedStart = new Date(b.start.getFullYear(), b.start.getMonth(), b.start.getDate()).getTime();
        const blockedEnd = new Date(b.end.getFullYear(), b.end.getMonth(), b.end.getDate()).getTime();
        const selStart = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate()).getTime();
        const selEnd = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate()).getTime();
        if (blockedStart <= selEnd && blockedEnd >= selStart) {
          conflicts.push({
            type: "dependency_violation",
            message: b.reason,
            severity: "error",
          });
        }
      }
    }

    setDetectedConflicts(conflicts);
    if (conflicts.length > 0) {
      onConflictDetected?.(conflicts);
    }
  }

  function handleClear() {
    setSelectedStart(null);
    setSelectedEnd(null);
    setMode("idle");
    setDetectedConflicts([]);
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
    const tasks = tasksForDate(date);
    const conflicts = conflictsForDate(date);
    const blocked = isDateBlocked(date);
    const hasProjectTasks = !!projectTasks;
    return { inMonth, today, isStart, isEnd, singleDay, inRange, dots, tasks, conflicts, blocked, hasProjectTasks };
  }

  // ── Collapsed trigger ─────────────────────────────────────────────────────

  if (!expanded && !alwaysExpanded) {
    return (
      <div className="flex flex-col gap-0.5">
        <label className="font-kosugi text-caption-sm text-text-2 uppercase tracking-widest">
          {label}
        </label>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={cn(
            "w-full flex items-center gap-1.5 px-1.5 py-1.5",
            "bg-surface-input border border-border rounded-sm",
            "text-left transition-all duration-150",
            "hover:border-border-medium focus:border-ops-accent focus:outline-none"
          )}
        >
          <CalendarIcon className="w-[16px] h-[16px] text-text-3 shrink-0" />
          {hasSelection && selectedStart && selectedEnd ? (
            <div className="flex-1 min-w-0 flex items-center gap-[6px]">
              <span className="font-mohave text-body text-text">
                {formatDisplayDate(selectedStart)}
              </span>
              <span className="font-mohave text-body-sm text-text-3">
                to
              </span>
              <span className="font-mohave text-body text-text">
                {formatDisplayDate(selectedEnd)}
              </span>
              <span className="font-mohave text-body-sm text-ops-accent ml-auto">
                {daysBetween(selectedStart, selectedEnd)}d
              </span>
            </div>
          ) : (
            <span className="font-mohave text-body text-text-3">
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
      <label className="font-kosugi text-caption-sm text-text-2 uppercase tracking-widest">
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
          <p className="font-kosugi text-[10px] text-text-2 uppercase tracking-widest leading-none mb-[2px]">
            Start
          </p>
          <p
            className={cn(
              "font-mohave text-body-sm leading-tight",
              hasSelection || mode === "selecting"
                ? "text-text"
                : "text-text-3"
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
            hasSelection ? "text-ops-accent" : "text-text-3"
          )}
        />

        {/* End */}
        <div className="flex-1 min-w-0">
          <p className="font-kosugi text-[10px] text-text-2 uppercase tracking-widest leading-none mb-[2px]">
            End
          </p>
          <p
            className={cn(
              "font-mohave text-body-sm leading-tight",
              hasSelection ? "text-text" : "text-text-3"
            )}
          >
            {selectedEnd && hasSelection
              ? formatDisplayDate(selectedEnd)
              : "Select date"}
          </p>
        </div>

        {/* Duration */}
        <div className="text-right shrink-0 ml-1">
          <p className="font-kosugi text-[10px] text-text-2 uppercase tracking-widest leading-none mb-[2px]">
            Duration
          </p>
          <p
            className={cn(
              "font-mohave text-body-sm leading-tight",
              hasSelection ? "text-ops-accent" : "text-text-3"
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
          <span className="font-mohave text-body font-semibold text-text">
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
              className="text-center font-kosugi text-[10px] text-text-2 uppercase tracking-widest py-[4px]"
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
                onClick={() => s.inMonth && !s.blocked && handleDateClick(date)}
              />
            );
          })}
        </div>
      </div>

      {/* Conflict warning banner */}
      {detectedConflicts.length > 0 && (
        <div className="bg-financial-overdue/10 border border-financial-overdue/20 rounded-[3px] p-3 mt-2" role="alert">
          {detectedConflicts.map((c, i) => (
            <div key={i} className="flex items-start gap-2 mb-1 last:mb-0">
              <AlertTriangle className="w-[14px] h-[14px] text-financial-overdue shrink-0 mt-[2px]" />
              <span className="font-mohave text-body-sm text-text-2">{c.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Actions row */}
      <div className="flex items-center gap-1">
        {!alwaysExpanded && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="font-mohave text-body-sm text-text-3 hover:text-text-2 transition-colors"
          >
            {hasSelection ? "Collapse" : "Cancel"}
          </button>
        )}

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
  tasks,
  conflicts,
  blocked,
  hasProjectTasks,
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
  tasks: Array<{ id: string; startDate: Date | null; endDate: Date | null; taskColor: string; title: string }>;
  conflicts: Array<{ date: Date; memberName: string; projectTitle: string }>;
  blocked: boolean;
  hasProjectTasks: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={blocked ? undefined : onClick}
      disabled={!inMonth || blocked}
      aria-disabled={blocked || undefined}
      className={cn(
        "relative h-[36px] flex flex-col items-center justify-center",
        "transition-all duration-100",
        !inMonth && "opacity-20 cursor-default",
        inMonth && !blocked && "cursor-pointer hover:bg-[rgba(255,255,255,0.04)]",
        blocked && "opacity-30 pointer-events-none"
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

      {/* Team conflict indicator — amber triangle top-right */}
      {conflicts.length > 0 && (
        <div
          className="absolute top-0 right-0 w-0 h-0 border-l-[6px] border-b-[6px] border-l-transparent border-b-transparent border-t-[6px] border-r-[6px] border-t-[#D4A574] border-r-[#D4A574] z-20"
          title={conflicts.map((c) => `${c.memberName} — ${c.projectTitle}`).join(", ")}
        />
      )}

      {/* Day number */}
      <span
        className={cn(
          "relative z-10 font-mohave text-body-sm font-semibold leading-none",
          today
            ? "text-white"
            : inMonth
              ? "text-text"
              : "text-text-3"
        )}
      >
        {date.getDate()}
      </span>

      {/* Project task bars (take precedence over event dots) */}
      {hasProjectTasks && tasks.length > 0 ? (
        <div className="relative z-10 flex flex-col gap-[1px] mt-[1px] w-full px-[3px]">
          {tasks.slice(0, 2).map((t, j) => (
            <div
              key={t.id + j}
              className="h-[3px] rounded-[1px] w-full"
              style={{ backgroundColor: t.taskColor }}
              title={t.title}
            />
          ))}
          {tasks.length > 2 && (
            <span className="font-mohave text-[7px] text-text-3 leading-none text-center">
              +{tasks.length - 2}
            </span>
          )}
        </div>
      ) : !hasProjectTasks && dots.length > 0 ? (
        /* Event dots — only when projectTasks is not provided */
        <div className="relative z-10 flex gap-[2px] mt-[1px]">
          {dots.slice(0, 3).map((ev, j) => (
            <div
              key={j}
              className="w-[3px] h-[3px] rounded-full"
              style={{ backgroundColor: ev.color }}
            />
          ))}
        </div>
      ) : null}
    </button>
  );
}
