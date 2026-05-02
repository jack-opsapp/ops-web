"use client";

/**
 * MonthScrollContainer — continuous infinite-scroll month view.
 *
 * One grid of week rows spanning every buffered month. Day cells show their
 * true date at full opacity — no greyed-out trailing / leading days, no
 * duplication of edge days across panels. Months are surfaced via sticky
 * overlay headers that hand off iOS-style: the next month's label pushes
 * the previous one up and out of view as you scroll past a section.
 *
 * Why: the previous design rendered N separate 6-week panels per month,
 * each with min-height 100% of the viewport so short months left a gap
 * before the next, and each padded with the previous + next month's edge
 * days as dimmed cells. That fragmented the timeline and made cross-month
 * drag awkward. Here, dragging from late-January to early-February is a
 * one-cell hop because the days are adjacent in the same week row.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  endOfMonth,
  format,
  isSameDay,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { motion } from "framer-motion";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  useCalendarDragState,
  useCalendarResizeContext,
} from "../calendar-dnd-shell";
import {
  MonthEventBar,
  type DisplayLevel,
  type MonthEventBarSpan,
} from "./month-event-bar";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";

// ─── Constants ──────────────────────────────────────────────────────────────

const WEEK_OPTS = { weekStartsOn: 1 as const };
const INITIAL_BUFFER_MONTHS = 6;
const EDGE_PX_TRIGGER = 800;
const EXTEND_STEP_MONTHS = 6;

const MIN_CELL_HEIGHT = 80;
const MAX_CELL_HEIGHT = 320;
const DEFAULT_CELL_HEIGHT = 120;
const DAY_NUMBER_HEIGHT = 24;
const SLOT_GAP = 2;
const MORE_ROW_HEIGHT = 14;

const DAY_NAME_HEADER_HEIGHT = 32;
const MONTH_LABEL_HEIGHT = 38;

// ─── Types ──────────────────────────────────────────────────────────────────

interface EventPlacement {
  event: InternalCalendarEvent;
  slotIndex: number;
  slotsConsumed: number;
  span: MonthEventBarSpan;
}

interface ProcessedWeek {
  weekStart: Date;
  weekDays: Date[];
  placements: EventPlacement[][];
  overflowByDay: number[];
}

interface MonthSection {
  monthStart: Date;
  weeks: ProcessedWeek[];
}

interface MonthScrollContainerProps {
  currentDate: Date;
  events: InternalCalendarEvent[];
  onCurrentDateChange: (date: Date) => void;
  onSelectDate?: (date: Date) => void;
  onEventClick?: (event: InternalCalendarEvent) => void;
  t?: (key: string) => string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getDisplayLevel(cellHeight: number): DisplayLevel {
  if (cellHeight < 120) return "compact";
  if (cellHeight < 180) return "standard";
  return "expanded";
}

function getSlotHeight(level: DisplayLevel, isSingleDay: boolean): number {
  if (level === "compact") return 10;
  if (level === "standard") return 14;
  return isSingleDay ? 42 : 14;
}

function getMaxSlots(cellHeight: number, level: DisplayLevel): number {
  const available = cellHeight - DAY_NUMBER_HEIGHT - MORE_ROW_HEIGHT;
  if (available <= 0) return 0;
  const baseHeight = level === "compact" ? 10 : 14;
  return Math.max(1, Math.floor((available + SLOT_GAP) / (baseHeight + SLOT_GAP)));
}

function isMultiDay(event: InternalCalendarEvent): boolean {
  return !isSameDay(event.startDate, event.endDate);
}

function buildWeekStarts(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  let w = startOfWeek(from, WEEK_OPTS);
  const end = startOfWeek(to, WEEK_OPTS);
  while (w.getTime() <= end.getTime()) {
    out.push(w);
    w = addWeeks(w, 1);
  }
  return out;
}

function computeWeeklyPlacements(
  weekStarts: Date[],
  events: InternalCalendarEvent[],
  cellHeight: number,
  level: DisplayLevel
): ProcessedWeek[] {
  const maxSlots = getMaxSlots(cellHeight, level);
  const result: ProcessedWeek[] = [];
  const globalSlotMap = new Map<string, Map<number, number>>();

  weekStarts.forEach((weekStart, w) => {
    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const weekEnd = weekDays[6];

    const usedSlots: Set<number>[] = Array.from(
      { length: 7 },
      () => new Set<number>()
    );
    const placements: EventPlacement[][] = Array.from(
      { length: 7 },
      () => []
    );

    const relevantEvents = events
      .filter((ev) => ev.startDate <= weekEnd && ev.endDate >= weekStart)
      .sort((a, b) => {
        const aMulti = isMultiDay(a) ? 1 : 0;
        const bMulti = isMultiDay(b) ? 1 : 0;
        if (aMulti !== bMulti) return bMulti - aMulti;
        const aSpan = differenceInCalendarDays(a.endDate, a.startDate);
        const bSpan = differenceInCalendarDays(b.endDate, b.startDate);
        if (aSpan !== bSpan) return bSpan - aSpan;
        return a.startDate.getTime() - b.startDate.getTime();
      });

    for (const event of relevantEvents) {
      const evStartIdx = differenceInCalendarDays(event.startDate, weekStart);
      const evEndIdx = differenceInCalendarDays(event.endDate, weekStart);
      if (evStartIdx > 6 || evEndIdx < 0) continue;

      const startIdx = Math.max(0, evStartIdx);
      const endIdx = Math.min(6, evEndIdx);
      const multi = isMultiDay(event);
      const isSingleDay = !multi;
      const slotsNeeded = level === "expanded" && isSingleDay ? 3 : 1;

      let assignedSlot = -1;

      if (multi && globalSlotMap.has(event.id)) {
        for (const [, prevSlot] of globalSlotMap.get(event.id)!) {
          let fits = true;
          for (let d = startIdx; d <= endIdx; d++) {
            for (let s = prevSlot; s < prevSlot + slotsNeeded; s++) {
              if (usedSlots[d].has(s)) {
                fits = false;
                break;
              }
            }
            if (!fits) break;
          }
          if (fits && prevSlot + slotsNeeded <= maxSlots) {
            assignedSlot = prevSlot;
            break;
          }
        }
      }

      if (assignedSlot === -1) {
        for (let slot = 0; slot + slotsNeeded <= maxSlots; slot++) {
          let fits = true;
          for (let d = startIdx; d <= endIdx; d++) {
            for (let s = slot; s < slot + slotsNeeded; s++) {
              if (usedSlots[d].has(s)) {
                fits = false;
                break;
              }
            }
            if (!fits) break;
          }
          if (fits) {
            assignedSlot = slot;
            break;
          }
        }
      }

      if (assignedSlot === -1) continue;

      for (let d = startIdx; d <= endIdx; d++) {
        for (let s = assignedSlot; s < assignedSlot + slotsNeeded; s++) {
          usedSlots[d].add(s);
        }
      }

      if (multi) {
        if (!globalSlotMap.has(event.id)) {
          globalSlotMap.set(event.id, new Map());
        }
        globalSlotMap.get(event.id)!.set(w, assignedSlot);
      }

      const span: MonthEventBarSpan = multi
        ? {
            startDayIndex: startIdx,
            endDayIndex: endIdx,
            isFirstSegment: evStartIdx >= 0 && evStartIdx <= 6,
            isLastSegment: evEndIdx >= 0 && evEndIdx <= 6,
            isSingleDay: false,
          }
        : {
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

    const overflowByDay: number[] = Array(7).fill(0);
    for (let d = 0; d < 7; d++) {
      const day = weekDays[d];
      const totalEvents = events.filter(
        (ev) =>
          (ev.startDate <= day && ev.endDate >= day) ||
          isSameDay(ev.startDate, day) ||
          isSameDay(ev.endDate, day)
      ).length;

      const placedIds = new Set<string>();
      for (let di = 0; di < 7; di++) {
        for (const p of placements[di]) {
          if (p.span.startDayIndex <= d && p.span.endDayIndex >= d) {
            placedIds.add(p.event.id);
          }
        }
      }

      const overflow = totalEvents - placedIds.size;
      if (overflow > 0) overflowByDay[d] = overflow;
    }

    result.push({ weekStart, weekDays, placements, overflowByDay });
  });

  return result;
}

function groupIntoSections(weeks: ProcessedWeek[]): MonthSection[] {
  const sections: MonthSection[] = [];
  for (const week of weeks) {
    const firstOfMonth = week.weekDays.find((d) => d.getDate() === 1);
    if (firstOfMonth) {
      sections.push({
        monthStart: startOfMonth(firstOfMonth),
        weeks: [week],
      });
    } else if (sections.length > 0) {
      sections[sections.length - 1].weeks.push(week);
    } else {
      sections.push({
        monthStart: startOfMonth(week.weekDays[0]),
        weeks: [week],
      });
    }
  }
  return sections;
}

// ─── Day cell ───────────────────────────────────────────────────────────────

function MonthDayCell({
  day,
  isCurrentDay,
  isWeekend,
  overflow,
  onSelectDate,
}: {
  day: Date;
  isCurrentDay: boolean;
  isWeekend: boolean;
  overflow: number;
  onSelectDate?: (date: Date) => void;
}) {
  const dayKey = format(day, "yyyy-MM-dd");
  const { setNodeRef, isOver } = useDroppable({
    id: `month-day-${dayKey}`,
    data: { type: "month-day", day },
  });

  return (
    <div
      ref={setNodeRef}
      className="relative overflow-hidden group"
      style={{
        borderRight: "1px solid rgba(255,255,255,0.10)",
        backgroundColor: isOver
          ? "rgba(111, 148, 176, 0.10)"
          : isCurrentDay
            ? "rgba(111, 148, 176, 0.06)"
            : isWeekend
              ? "rgba(255,255,255,0.02)"
              : undefined,
      }}
    >
      <div
        className="flex items-center"
        style={{ padding: "4px 4px 0 4px", height: DAY_NUMBER_HEIGHT }}
      >
        <button
          className="cursor-pointer flex items-center justify-center"
          style={{
            fontFamily: isCurrentDay
              ? "var(--font-cakemono), sans-serif"
              : "var(--font-mohave), sans-serif",
            fontWeight: isCurrentDay ? 300 : 600,
            fontSize: 13,
            width: isCurrentDay ? 24 : 22,
            height: isCurrentDay ? 24 : 22,
            borderRadius: isCurrentDay ? 4 : 2,
            backgroundColor: isCurrentDay
              ? "var(--ops-accent)"
              : "transparent",
            color: isCurrentDay ? "#000" : "var(--text-2)",
            border: "none",
            letterSpacing: 0,
          }}
          onClick={(e) => {
            e.stopPropagation();
            onSelectDate?.(day);
          }}
        >
          {format(day, "d")}
        </button>
      </div>

      <div
        className="absolute inset-0 cursor-pointer"
        style={{ zIndex: 0, top: DAY_NUMBER_HEIGHT }}
        onClick={() => onSelectDate?.(day)}
      />

      {overflow > 0 && (
        <button
          className="absolute cursor-pointer font-mono uppercase hover:underline"
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

      {isOver && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            border: "1px solid rgba(111, 148, 176, 0.3)",
            borderRadius: 2,
            zIndex: 4,
          }}
        />
      )}

      <div
        className="absolute inset-0 border border-transparent group-hover:border-[rgba(111,148,176,0.2)] pointer-events-none"
        style={{ borderRadius: 2, zIndex: 3 }}
      />
    </div>
  );
}

// ─── Draggable event wrapper ────────────────────────────────────────────────

function DraggableMonthEvent({
  event,
  weekIndex,
  positionStyle,
  disabled,
  children,
}: {
  event: InternalCalendarEvent;
  weekIndex: number;
  positionStyle: React.CSSProperties;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const locked =
    event.statusKey === "completed" || event.statusKey === "cancelled";
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `month-event-${event.id}-w${weekIndex}`,
      data: { type: "month-event", event },
      disabled: disabled || locked,
    });

  const justDraggedRef = useRef(false);
  useEffect(() => {
    if (isDragging) {
      justDraggedRef.current = true;
    } else if (justDraggedRef.current) {
      const id = requestAnimationFrame(() => {
        justDraggedRef.current = false;
      });
      return () => cancelAnimationFrame(id);
    }
  }, [isDragging]);

  const dragStyle: React.CSSProperties = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 20,
        cursor: "grabbing",
      }
    : {};

  return (
    <div
      ref={setNodeRef}
      className="absolute pointer-events-auto"
      style={{
        ...positionStyle,
        ...dragStyle,
        opacity: isDragging ? 0.5 : undefined,
      }}
      onClickCapture={(e) => {
        if (justDraggedRef.current) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MonthScrollContainer({
  currentDate,
  events,
  onCurrentDateChange,
  onSelectDate,
  onEventClick,
  t,
}: MonthScrollContainerProps) {
  const [bufferStart, setBufferStart] = useState<Date>(() =>
    startOfMonth(addMonths(currentDate, -INITIAL_BUFFER_MONTHS))
  );
  const [bufferEnd, setBufferEnd] = useState<Date>(() =>
    endOfMonth(addMonths(currentDate, INITIAL_BUFFER_MONTHS))
  );

  const [cellHeight, setCellHeight] = useState(DEFAULT_CELL_HEIGHT);
  const displayLevel = getDisplayLevel(cellHeight);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setSectionRef = useCallback(
    (key: string) => (node: HTMLDivElement | null) => {
      if (node) sectionRefs.current.set(key, node);
      else sectionRefs.current.delete(key);
    },
    []
  );

  const dayNames = useMemo(() => {
    if (t) {
      return [
        t("dayNames.mon"),
        t("dayNames.tue"),
        t("dayNames.wed"),
        t("dayNames.thu"),
        t("dayNames.fri"),
        t("dayNames.sat"),
        t("dayNames.sun"),
      ];
    }
    return ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  }, [t]);

  const weekStarts = useMemo(
    () => buildWeekStarts(bufferStart, bufferEnd),
    [bufferStart, bufferEnd]
  );

  const processedWeeks = useMemo(
    () =>
      computeWeeklyPlacements(weekStarts, events, cellHeight, displayLevel),
    [weekStarts, events, cellHeight, displayLevel]
  );

  const sections = useMemo(
    () => groupIntoSections(processedWeeks),
    [processedWeeks]
  );

  // ── Initial scroll — jump to the section containing currentDate ─────────
  const didInitialScroll = useRef(false);
  useLayoutEffect(() => {
    if (didInitialScroll.current) return;
    const container = scrollRef.current;
    if (!container) return;
    const key = format(startOfMonth(currentDate), "yyyy-MM");
    const el = sectionRefs.current.get(key);
    if (!el) return;
    container.scrollTo({
      top: el.offsetTop - DAY_NAME_HEADER_HEIGHT,
      behavior: "instant" as ScrollBehavior,
    });
    didInitialScroll.current = true;
  }, [currentDate]);

  // ── Track which section's label is currently sticky-pinned ──────────────
  const [activeMonthKey, setActiveMonthKey] = useState<string>(() =>
    format(startOfMonth(currentDate), "yyyy-MM")
  );

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const compute = () => {
      const containerRect = container.getBoundingClientRect();
      const targetY =
        containerRect.top + DAY_NAME_HEADER_HEIGHT + MONTH_LABEL_HEIGHT / 2;
      let bestKey: string | null = null;
      sectionRefs.current.forEach((el, key) => {
        const r = el.getBoundingClientRect();
        if (r.top <= targetY && r.bottom > targetY) {
          bestKey = key;
        }
      });
      if (bestKey !== null) {
        const next: string = bestKey;
        setActiveMonthKey((prev) => (prev === next ? prev : next));
      }
    };

    compute();
    container.addEventListener("scroll", compute, { passive: true });
    return () => container.removeEventListener("scroll", compute);
  }, [sections]);

  useEffect(() => {
    const [yyyy, mm] = activeMonthKey.split("-").map(Number);
    if (!yyyy || !mm) return;
    const monthDate = new Date(yyyy, mm - 1, 1);
    onCurrentDateChange(monthDate);
  }, [activeMonthKey, onCurrentDateChange]);

  // ── Edge extension on scroll ────────────────────────────────────────────
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const onScroll = () => {
      const top = container.scrollTop;
      const remaining =
        container.scrollHeight - container.clientHeight - top;

      if (top < EDGE_PX_TRIGGER) {
        const beforeScrollHeight = container.scrollHeight;
        const beforeScrollTop = container.scrollTop;
        setBufferStart((prev) => addMonths(prev, -EXTEND_STEP_MONTHS));
        requestAnimationFrame(() => {
          if (!scrollRef.current) return;
          const delta = scrollRef.current.scrollHeight - beforeScrollHeight;
          scrollRef.current.scrollTo({
            top: beforeScrollTop + delta,
            behavior: "instant" as ScrollBehavior,
          });
        });
      } else if (remaining < EDGE_PX_TRIGGER) {
        setBufferEnd((prev) => addMonths(prev, EXTEND_STEP_MONTHS));
      }
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  // ── React to external currentDate changes (e.g. [TODAY]) ────────────────
  // CRITICAL: do NOT key on activeMonthKey. The internal scroll → setActive
  // → onCurrentDateChange → parent setCurrentDate loop would otherwise re-
  // trigger a scrollTo with the previous month's offset and yank the user
  // back mid-scroll. Use a ref to read the latest activeMonthKey without
  // re-firing the effect.
  const activeMonthRef = useRef(activeMonthKey);
  useEffect(() => {
    activeMonthRef.current = activeMonthKey;
  }, [activeMonthKey]);

  useEffect(() => {
    const wantKey = format(startOfMonth(currentDate), "yyyy-MM");
    if (wantKey === activeMonthRef.current) return;
    const container = scrollRef.current;
    if (!container) return;
    const el = sectionRefs.current.get(wantKey);
    if (el) {
      container.scrollTo({
        top: el.offsetTop - DAY_NAME_HEADER_HEIGHT,
        behavior: "smooth",
      });
      return;
    }
    setBufferStart(
      startOfMonth(addMonths(currentDate, -INITIAL_BUFFER_MONTHS))
    );
    setBufferEnd(endOfMonth(addMonths(currentDate, INITIAL_BUFFER_MONTHS)));
    setActiveMonthKey(wantKey);
    didInitialScroll.current = false;
  }, [currentDate]);

  // ── Resize commit (left/right edge of month bars) — provided by the
  //    hoisted CalendarDndShell so we don't mount one prompt per scroll
  //    panel (~14 sections in this view alone). ──────────────────────────
  const { commitResize } = useCalendarResizeContext();
  const handleBarResize = useCallback(
    (
      event: InternalCalendarEvent,
      edge: "left" | "right",
      dayDelta: number
    ) => {
      if (dayDelta === 0) return;
      // totalDays = how many days between start and end. For a 2-day bar
      // (May 7 → May 8) this is 1. The minimum allowed bar covers a
      // single calendar day, i.e. start === end (totalDays === 0).
      const totalDays = differenceInCalendarDays(
        event.endDate,
        event.startDate
      );
      if (edge === "right") {
        // Pulling the right edge inward shrinks the bar. Allow shrink down
        // to start === end (single day), so minDelta is -totalDays. The
        // earlier formula (-(totalDays - 1)) blocked the final click that
        // would collapse a 2-day bar back to 1 day.
        const minDelta = -totalDays;
        const clamped = Math.max(dayDelta, minDelta);
        if (clamped === 0) return;
        const newEnd = addDays(event.endDate, clamped);
        commitResize(event, { endDate: newEnd });
        return;
      }
      // Pulling the left edge inward (positive dayDelta) shrinks the bar.
      // Symmetric clamp: allow up to totalDays so the bar can collapse to
      // a single day.
      const maxDelta = totalDays;
      const clamped = Math.min(dayDelta, maxDelta);
      if (clamped === 0) return;
      const newStart = addDays(event.startDate, clamped);
      commitResize(event, { startDate: newStart });
    },
    [commitResize]
  );

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setCellHeight((prev) => {
        const next = prev + e.deltaY * -0.5;
        return Math.min(MAX_CELL_HEIGHT, Math.max(MIN_CELL_HEIGHT, next));
      });
    }
  }, []);

  const baseSlotHeight = displayLevel === "compact" ? 10 : 14;

  // Held for parity with week / day views; this view doesn't snap.
  useCalendarDragState();

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-y-auto scrollbar-hide"
      onWheel={handleWheel}
    >
      {/* Day-name strip — sticky-top across the whole scroller */}
      <div
        className="grid grid-cols-7 sticky top-0 z-30"
        style={{
          height: DAY_NAME_HEADER_HEIGHT,
          background: "rgba(0,0,0,0.92)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          borderBottom: "1px solid rgba(255,255,255,0.10)",
        }}
      >
        {dayNames.map((name, i) => {
          const isWeekendHeader = i >= 5;
          return (
            <div
              key={name}
              className="font-mono uppercase text-left flex items-center"
              style={{
                fontSize: 10,
                color: "#999999",
                padding: "0 4px",
                letterSpacing: "0.15em",
                backgroundColor: isWeekendHeader
                  ? "rgba(255,255,255,0.02)"
                  : undefined,
              }}
            >
              {name}
            </div>
          );
        })}
      </div>

      {sections.map((section) => {
        const sectionKey = format(section.monthStart, "yyyy-MM");
        return (
          <section
            key={sectionKey}
            ref={setSectionRef(sectionKey)}
            data-month-key={sectionKey}
            className="relative"
          >
            {/* Floating month-label overlay. The sticky container is
                zero-height so it doesn't displace the week rows below — the
                label inside is absolutely positioned and floats over the
                first row's content. Sticky-handoff still works because each
                section is its own containing block. */}
            <div
              className="sticky pointer-events-none"
              style={{
                top: DAY_NAME_HEADER_HEIGHT,
                height: 0,
                zIndex: 25,
              }}
            >
              <div
                className="pointer-events-auto inline-flex items-baseline gap-2 px-3 py-1"
                style={{
                  position: "absolute",
                  left: 12,
                  top: 8,
                  background: "rgba(18, 18, 20, 0.78)",
                  backdropFilter: "blur(28px) saturate(1.3)",
                  WebkitBackdropFilter: "blur(28px) saturate(1.3)",
                  border: "1px solid rgba(255, 255, 255, 0.09)",
                  borderRadius: 6,
                }}
              >
                <span
                  className="font-cakemono font-light uppercase"
                  style={{
                    color: "var(--text)",
                    fontSize: 14,
                    letterSpacing: 0,
                    lineHeight: 1,
                  }}
                >
                  {format(section.monthStart, "MMMM")}
                </span>
                <span
                  className="font-mono uppercase tracking-wider tabular-nums"
                  style={{
                    color: "var(--text-3)",
                    fontSize: 10,
                    fontFeatureSettings: '"tnum" 1, "zero" 1',
                    lineHeight: 1,
                  }}
                >
                  {format(section.monthStart, "yyyy")}
                </span>
              </div>
            </div>

            {section.weeks.map((week) => {
              const weekKey = format(week.weekStart, "yyyy-MM-dd");
              const wIndex = processedWeeks.indexOf(week);
              return (
                <div
                  key={weekKey}
                  data-month-week-row
                  data-week-start={weekKey}
                  className="grid grid-cols-7 relative"
                  style={{
                    height: cellHeight,
                    borderBottom: "1px solid rgba(255,255,255,0.10)",
                  }}
                >
                  {week.weekDays.map((day, dayIdx) => (
                    <MonthDayCell
                      key={dayIdx}
                      day={day}
                      isCurrentDay={isToday(day)}
                      isWeekend={dayIdx >= 5}
                      overflow={week.overflowByDay[dayIdx] ?? 0}
                      onSelectDate={onSelectDate}
                    />
                  ))}

                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{ top: DAY_NUMBER_HEIGHT }}
                  >
                    {week.placements.flatMap((dayPlacements) =>
                      dayPlacements.map((placement) => {
                        const { event, slotIndex, span } = placement;
                        const colStart = span.startDayIndex;
                        const colSpan =
                          span.endDayIndex - span.startDayIndex + 1;
                        const isDragDisabled =
                          !span.isSingleDay && !span.isFirstSegment;

                        if (displayLevel === "compact") {
                          const top = slotIndex * (10 + SLOT_GAP);
                          const left = `calc(${(colStart / 7) * 100}% + 4px)`;
                          return (
                            <DraggableMonthEvent
                              key={`${event.id}-w${wIndex}`}
                              event={event}
                              weekIndex={wIndex}
                              positionStyle={{ top, left, zIndex: 1 }}
                              disabled={isDragDisabled}
                            >
                              <motion.div
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
                            </DraggableMonthEvent>
                          );
                        }

                        const slotH = getSlotHeight(displayLevel, span.isSingleDay);
                        const top = slotIndex * (baseSlotHeight + SLOT_GAP);
                        const leftPct = (colStart / 7) * 100;
                        const widthPct = (colSpan / 7) * 100;

                        return (
                          <DraggableMonthEvent
                            key={`${event.id}-w${wIndex}`}
                            event={event}
                            weekIndex={wIndex}
                            disabled={isDragDisabled}
                            positionStyle={{
                              top,
                              left: `${leftPct}%`,
                              width: `${widthPct}%`,
                              height: slotH,
                              paddingLeft:
                                span.isFirstSegment || span.isSingleDay
                                  ? 2
                                  : 0,
                              paddingRight:
                                span.isLastSegment || span.isSingleDay
                                  ? 2
                                  : 0,
                              zIndex: 1,
                            }}
                          >
                            <motion.div
                              initial={{ opacity: 0, y: 2 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.15 }}
                            >
                              <MonthEventBar
                                event={event}
                                displayLevel={displayLevel}
                                span={span}
                                onClick={onEventClick}
                                onResize={handleBarResize}
                              />
                            </motion.div>
                          </DraggableMonthEvent>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
