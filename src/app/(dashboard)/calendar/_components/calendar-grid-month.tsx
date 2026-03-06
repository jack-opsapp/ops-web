"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  isToday,
  differenceInCalendarDays,
} from "date-fns";
import { motion } from "framer-motion";
import { type InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import {
  MonthEventBar,
  type DisplayLevel,
  type MonthEventBarSpan,
} from "./month/month-event-bar";

// ─── Props ──────────────────────────────────────────────────────────────────

interface CalendarGridMonthProps {
  currentDate: Date;
  events: InternalCalendarEvent[];
  onSelectDate?: (date: Date) => void;
  onEventClick?: (event: InternalCalendarEvent) => void;
  t?: (key: string) => string;
}

// ─── Event Layout Types ─────────────────────────────────────────────────────

interface EventPlacement {
  event: InternalCalendarEvent;
  slotIndex: number;          // vertical slot within the cell
  slotsConsumed: number;      // 1 for standard, 3 for expanded single-day
  span: MonthEventBarSpan;
}

interface WeekRow {
  weekDays: Date[];
  weekIndex: number;
  placements: EventPlacement[][];  // placements[dayIndex] = placements for that day
}

// ─── Zoom Constants ─────────────────────────────────────────────────────────

const MIN_CELL_HEIGHT = 80;
const MAX_CELL_HEIGHT = 320;
const DEFAULT_CELL_HEIGHT = 120;

// Height reserved for day number row
const DAY_NUMBER_HEIGHT = 24;
// Vertical gap between event slots
const SLOT_GAP = 2;
// Height of "+N more" row
const MORE_ROW_HEIGHT = 14;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getDisplayLevel(cellHeight: number): DisplayLevel {
  if (cellHeight < 120) return "compact";
  if (cellHeight < 180) return "standard";
  return "expanded";
}

function getSlotHeight(displayLevel: DisplayLevel, isSingleDay: boolean): number {
  if (displayLevel === "compact") return 10;
  if (displayLevel === "standard") return 14;
  // Expanded
  return isSingleDay ? 42 : 14;
}

/** Return max visible slots for a cell at a given height/level */
function getMaxSlots(cellHeight: number, displayLevel: DisplayLevel): number {
  const available = cellHeight - DAY_NUMBER_HEIGHT - MORE_ROW_HEIGHT;
  if (available <= 0) return 0;

  const baseHeight = displayLevel === "compact" ? 10 : displayLevel === "standard" ? 14 : 14;
  return Math.max(1, Math.floor((available + SLOT_GAP) / (baseHeight + SLOT_GAP)));
}

/** Check if an event spans multiple days */
function isMultiDay(event: InternalCalendarEvent): boolean {
  return !isSameDay(event.startDate, event.endDate);
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CalendarGridMonth({
  currentDate,
  events,
  onSelectDate,
  onEventClick,
  t,
}: CalendarGridMonthProps) {
  const [cellHeight, setCellHeight] = useState(DEFAULT_CELL_HEIGHT);
  const gridRef = useRef<HTMLDivElement>(null);

  const displayLevel = getDisplayLevel(cellHeight);

  // ── Day names (Mon-Sun per spec) ──
  const dayNames = useMemo(() => {
    if (t) {
      return [
        t("dayNames.mon"), t("dayNames.tue"), t("dayNames.wed"), t("dayNames.thu"),
        t("dayNames.fri"), t("dayNames.sat"), t("dayNames.sun"),
      ];
    }
    return ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  }, [t]);

  // ── Calendar grid dates ──
  const { days, weeks } = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    // weekStartsOn: 1 = Monday
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    const allDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
    return { days: allDays, weeks: Math.ceil(allDays.length / 7) };
  }, [currentDate]);

  // ── Build week rows with event slot assignments ──
  const weekRows: WeekRow[] = useMemo(() => {
    const maxSlots = getMaxSlots(cellHeight, displayLevel);
    const rows: WeekRow[] = [];

    // Global slot reservations for multi-day events across weeks
    // Maps event.id → slotIndex per week
    const globalSlotMap = new Map<string, Map<number, number>>();

    for (let w = 0; w < weeks; w++) {
      const weekDays = days.slice(w * 7, (w + 1) * 7);
      // Track used slots per day: usedSlots[dayIdx] = Set of occupied slot indices
      const usedSlots: Set<number>[] = Array.from({ length: 7 }, () => new Set<number>());
      const placements: EventPlacement[][] = Array.from({ length: 7 }, () => []);

      // Collect events that touch this week, sorted by duration (longer first) then start date
      const weekStart = weekDays[0];
      const weekEnd = weekDays[6];

      const relevantEvents = events
        .filter((ev) => {
          const evStart = ev.startDate;
          const evEnd = ev.endDate;
          // Event overlaps this week
          return evStart <= weekEnd && evEnd >= weekStart;
        })
        .sort((a, b) => {
          // Multi-day events first, then by span length (descending), then by start date
          const aMulti = isMultiDay(a) ? 1 : 0;
          const bMulti = isMultiDay(b) ? 1 : 0;
          if (aMulti !== bMulti) return bMulti - aMulti;
          const aSpan = differenceInCalendarDays(a.endDate, a.startDate);
          const bSpan = differenceInCalendarDays(b.endDate, b.startDate);
          if (aSpan !== bSpan) return bSpan - aSpan;
          return a.startDate.getTime() - b.startDate.getTime();
        });

      for (const event of relevantEvents) {
        // Determine which days of this week the event occupies
        const eventStartIdx = Math.max(
          0,
          differenceInCalendarDays(event.startDate, weekStart)
        );
        const eventEndIdx = Math.min(
          6,
          differenceInCalendarDays(event.endDate, weekStart)
        );

        if (eventStartIdx > 6 || eventEndIdx < 0) continue;

        const startIdx = Math.max(0, eventStartIdx);
        const endIdx = Math.min(6, eventEndIdx);

        const multi = isMultiDay(event);
        const isSingleDay = !multi;
        const slotsNeeded = displayLevel === "expanded" && isSingleDay ? 3 : 1;

        const isFirstSegment = isSameDay(event.startDate, weekDays[startIdx]) || startIdx === 0;
        const isLastSegment = isSameDay(event.endDate, weekDays[endIdx]) || endIdx === 6;

        // Find a slot that's free across all days this event spans
        let assignedSlot = -1;

        // For multi-day events, try to reuse the same slot from previous weeks
        if (multi && globalSlotMap.has(event.id)) {
          const weekSlots = globalSlotMap.get(event.id)!;
          // Try to find the previous week's slot
          for (const [, prevSlot] of weekSlots) {
            let fits = true;
            for (let d = startIdx; d <= endIdx; d++) {
              for (let s = prevSlot; s < prevSlot + slotsNeeded; s++) {
                if (usedSlots[d].has(s)) { fits = false; break; }
              }
              if (!fits) break;
            }
            if (fits && prevSlot + slotsNeeded <= maxSlots) {
              assignedSlot = prevSlot;
              break;
            }
          }
        }

        // Find first available slot
        if (assignedSlot === -1) {
          for (let slot = 0; slot + slotsNeeded <= maxSlots; slot++) {
            let fits = true;
            for (let d = startIdx; d <= endIdx; d++) {
              for (let s = slot; s < slot + slotsNeeded; s++) {
                if (usedSlots[d].has(s)) { fits = false; break; }
              }
              if (!fits) break;
            }
            if (fits) {
              assignedSlot = slot;
              break;
            }
          }
        }

        // If no slot found, this event overflows — skip placement (will count as "+N more")
        if (assignedSlot === -1) continue;

        // Reserve slots
        for (let d = startIdx; d <= endIdx; d++) {
          for (let s = assignedSlot; s < assignedSlot + slotsNeeded; s++) {
            usedSlots[d].add(s);
          }
        }

        // Track globally for multi-day continuity
        if (multi) {
          if (!globalSlotMap.has(event.id)) {
            globalSlotMap.set(event.id, new Map());
          }
          globalSlotMap.get(event.id)!.set(w, assignedSlot);
        }

        // Create placement for each day segment
        if (multi) {
          // Multi-day: one placement at the start day, spanning across
          const span: MonthEventBarSpan = {
            startDayIndex: startIdx,
            endDayIndex: endIdx,
            isFirstSegment: differenceInCalendarDays(event.startDate, weekStart) >= 0 && differenceInCalendarDays(event.startDate, weekStart) <= 6,
            isLastSegment: differenceInCalendarDays(event.endDate, weekStart) >= 0 && differenceInCalendarDays(event.endDate, weekStart) <= 6,
            isSingleDay: false,
          };

          placements[startIdx].push({
            event,
            slotIndex: assignedSlot,
            slotsConsumed: slotsNeeded,
            span,
          });
        } else {
          // Single-day: placement on the specific day
          const span: MonthEventBarSpan = {
            startDayIndex: startIdx,
            endDayIndex: startIdx,
            isFirstSegment: true,
            isLastSegment: true,
            isSingleDay: true,
          };

          placements[startIdx].push({
            event,
            slotIndex: assignedSlot,
            slotsConsumed: slotsNeeded,
            span,
          });
        }
      }

      rows.push({ weekDays, weekIndex: w, placements });
    }

    return rows;
  }, [days, weeks, events, cellHeight, displayLevel]);

  // ── Count overflow events per day ──
  const overflowCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (let w = 0; w < weeks; w++) {
      const weekDays = days.slice(w * 7, (w + 1) * 7);

      for (let d = 0; d < 7; d++) {
        const day = weekDays[d];
        const dayKey = format(day, "yyyy-MM-dd");

        // Count all events that touch this day
        const totalEvents = events.filter((ev) => {
          return ev.startDate <= day && ev.endDate >= day ||
                 isSameDay(ev.startDate, day) || isSameDay(ev.endDate, day);
        }).length;

        // Count placed events for this day
        const row = weekRows[w];
        if (!row) continue;

        const placedIds = new Set<string>();
        for (let di = 0; di < 7; di++) {
          for (const p of row.placements[di]) {
            if (p.span.startDayIndex <= d && p.span.endDayIndex >= d) {
              placedIds.add(p.event.id);
            }
          }
        }

        const overflow = totalEvents - placedIds.size;
        if (overflow > 0) {
          counts.set(dayKey, overflow);
        }
      }
    }

    return counts;
  }, [days, weeks, events, weekRows]);

  // ── Wheel zoom handler ──
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setCellHeight((prev) => {
        const next = prev + e.deltaY * -0.5;
        return Math.min(MAX_CELL_HEIGHT, Math.max(MIN_CELL_HEIGHT, next));
      });
    }
  }, []);

  // ── Slot height for current level ──
  const baseSlotHeight = displayLevel === "compact" ? 10 : 14;

  return (
    <div className="flex flex-col flex-1 min-h-0" onWheel={handleWheel}>
      {/* Day name headers — fixed top row */}
      <div className="grid grid-cols-7 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.10)" }}>
        {dayNames.map((name, i) => {
          const isWeekendHeader = i >= 5; // Sat=5, Sun=6 in Mon-start
          return (
            <div
              key={name}
              className="font-kosugi uppercase text-left"
              style={{
                fontSize: 10,
                color: "#999999",
                padding: "8px 4px",
                letterSpacing: "0.15em",
                backgroundColor: isWeekendHeader ? "rgba(255,255,255,0.02)" : undefined,
              }}
            >
              {name}
            </div>
          );
        })}
      </div>

      {/* Week rows */}
      <div ref={gridRef} className="flex flex-col flex-1 min-h-0">
        {weekRows.map((row) => (
          <div
            key={row.weekIndex}
            className="grid grid-cols-7 relative"
            style={{
              height: cellHeight,
              transition: "height 0.2s ease",
              borderBottom: "1px solid rgba(255,255,255,0.10)",
            }}
          >
            {row.weekDays.map((day, dayIdx) => {
              const isCurrentMonth = isSameMonth(day, currentDate);
              const isCurrentDay = isToday(day);
              const isWeekend = dayIdx >= 5; // Mon-start: Sat=5, Sun=6
              const dayKey = format(day, "yyyy-MM-dd");
              const overflow = overflowCounts.get(dayKey) || 0;

              return (
                <div
                  key={dayIdx}
                  className="relative overflow-hidden group"
                  style={{
                    borderRight: "1px solid rgba(255,255,255,0.10)",
                    opacity: isCurrentMonth ? 1 : 0.3,
                    backgroundColor: isWeekend && isCurrentMonth ? "rgba(255,255,255,0.02)" : undefined,
                  }}
                >
                  {/* Day number — top-left */}
                  <div
                    className="flex items-center"
                    style={{ padding: "4px 4px 0 4px", height: DAY_NUMBER_HEIGHT }}
                  >
                    <button
                      className="cursor-pointer flex items-center justify-center transition-colors duration-100"
                      style={{
                        fontFamily: "var(--font-mohave), sans-serif",
                        fontWeight: 600,
                        fontSize: 13,
                        width: 22,
                        height: 22,
                        borderRadius: isCurrentDay ? "50%" : "2px",
                        backgroundColor: isCurrentDay ? "rgba(89,119,148,0.15)" : "transparent",
                        color: isCurrentDay ? "#FFFFFF" : "#999999",
                        border: "none",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectDate?.(day);
                      }}
                    >
                      {format(day, "d")}
                    </button>
                  </div>

                  {/* Clickable empty area */}
                  <div
                    className="absolute inset-0 cursor-pointer"
                    style={{ zIndex: 0, top: DAY_NUMBER_HEIGHT }}
                    onClick={() => onSelectDate?.(day)}
                  />

                  {/* Overflow "+N more" — bottom of cell */}
                  {overflow > 0 && (
                    <button
                      className="absolute cursor-pointer font-kosugi uppercase hover:underline"
                      style={{
                        bottom: 2,
                        left: 4,
                        fontSize: 10,
                        color: "#999999",
                        background: "none",
                        border: "none",
                        padding: 0,
                        zIndex: 2,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectDate?.(day);
                      }}
                    >
                      +{overflow} MORE
                    </button>
                  )}

                  {/* Hover border */}
                  <div
                    className="absolute inset-0 border border-transparent group-hover:border-[rgba(89,119,148,0.2)] pointer-events-none transition-colors duration-150"
                    style={{ borderRadius: 2, zIndex: 3 }}
                  />
                </div>
              );
            })}

            {/* Event layer — positioned absolutely over the week row */}
            <div className="absolute inset-0 pointer-events-none" style={{ top: DAY_NUMBER_HEIGHT }}>
              {row.placements.flatMap((dayPlacements) =>
                dayPlacements.map((placement) => {
                  const { event, slotIndex, span } = placement;

                  // Calculate position
                  const colStart = span.startDayIndex;
                  const colSpan = span.endDayIndex - span.startDayIndex + 1;

                  // For compact mode, render dots differently
                  if (displayLevel === "compact") {
                    // Single dot per event at the correct slot
                    const top = slotIndex * (10 + SLOT_GAP);
                    const left = `calc(${(colStart / 7) * 100}% + 4px)`;

                    return (
                      <motion.div
                        key={`${event.id}-w${row.weekIndex}`}
                        className="absolute pointer-events-auto"
                        style={{
                          top,
                          left,
                          zIndex: 1,
                        }}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.15 }}
                      >
                        <MonthEventBar
                          event={event}
                          displayLevel={displayLevel}
                          span={span}
                          onClick={onEventClick}
                        />
                      </motion.div>
                    );
                  }

                  // Standard + Expanded: bars
                  const slotH = getSlotHeight(displayLevel, span.isSingleDay);
                  const top = slotIndex * (baseSlotHeight + SLOT_GAP);
                  const leftPct = (colStart / 7) * 100;
                  const widthPct = (colSpan / 7) * 100;

                  return (
                    <motion.div
                      key={`${event.id}-w${row.weekIndex}`}
                      className="absolute pointer-events-auto"
                      style={{
                        top,
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        height: slotH,
                        paddingLeft: span.isFirstSegment || span.isSingleDay ? 2 : 0,
                        paddingRight: span.isLastSegment || span.isSingleDay ? 2 : 0,
                        zIndex: 1,
                      }}
                      initial={{ opacity: 0, y: 2 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15 }}
                    >
                      <MonthEventBar
                        event={event}
                        displayLevel={displayLevel}
                        span={span}
                        onClick={onEventClick}
                      />
                    </motion.div>
                  );
                })
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
