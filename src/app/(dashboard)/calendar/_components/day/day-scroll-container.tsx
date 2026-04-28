"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { addDays, format, startOfDay, isSameDay } from "date-fns";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import { CalendarGridDay } from "../calendar-grid-day";
import { useCalendarDragState } from "../calendar-dnd-shell";

// ─── Constants ──────────────────────────────────────────────────────────────

const INITIAL_BUFFER = 14; // ±14 days
const EDGE_TRIGGER = 2;
const EXTEND_STEP = 14;

// ─── Props ──────────────────────────────────────────────────────────────────

interface DayScrollContainerProps {
  currentDate: Date;
  events: InternalCalendarEvent[];
  onCurrentDateChange: (date: Date) => void;
  onEventClick?: (event: InternalCalendarEvent) => void;
  t: (key: string) => string;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Horizontal infinite scroll for the Day view. Each panel is one day,
 * full container width, snap-aligned at the left edge. Trackpad horizontal
 * swipe / touch drag moves day-by-day.
 *
 * Mirrors MonthScrollContainer's pattern: IntersectionObserver tracks the
 * active panel; edge-triggered prepend/append extends the buffer with
 * scrollLeft compensation when prepending.
 */
export function DayScrollContainer({
  currentDate,
  events,
  onCurrentDateChange,
  onEventClick,
  t,
}: DayScrollContainerProps) {
  const [days, setDays] = useState<Date[]>(() => {
    const anchor = startOfDay(currentDate);
    const out: Date[] = [];
    for (let i = -INITIAL_BUFFER; i <= INITIAL_BUFFER; i++) {
      out.push(addDays(anchor, i));
    }
    return out;
  });

  const [activeDay, setActiveDay] = useState<Date>(() =>
    startOfDay(currentDate)
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const panelRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setPanelRef = useCallback(
    (key: string) => (node: HTMLDivElement | null) => {
      if (node) panelRefs.current.set(key, node);
      else panelRefs.current.delete(key);
    },
    []
  );

  const didInitialScroll = useRef(false);

  // Initial horizontal scroll-to-anchor
  useLayoutEffect(() => {
    if (didInitialScroll.current) return;
    const container = scrollRef.current;
    if (!container) return;
    const key = format(startOfDay(currentDate), "yyyy-MM-dd");
    const el = panelRefs.current.get(key);
    if (!el) return;
    container.scrollTo({ left: el.offsetLeft, behavior: "instant" as ScrollBehavior });
    didInitialScroll.current = true;
  }, [currentDate]);

  // Track active day — uses 50% intersection threshold on the horizontal axis
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let best: IntersectionObserverEntry | null = null;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          if (!best || e.intersectionRatio > best.intersectionRatio) {
            best = e;
          }
        }
        if (!best) return;
        const key = (best.target as HTMLElement).dataset.dayKey;
        if (!key) return;
        const next = days.find((d) => format(d, "yyyy-MM-dd") === key);
        if (!next) return;
        setActiveDay((prev) => (isSameDay(prev, next) ? prev : next));
      },
      {
        root: container,
        threshold: [0.5],
      }
    );

    panelRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [days]);

  // Edge extension
  useEffect(() => {
    const idx = days.findIndex((d) => isSameDay(d, activeDay));
    if (idx === -1) return;
    const container = scrollRef.current;
    const distFromStart = idx;
    const distFromEnd = days.length - 1 - idx;

    if (distFromEnd <= EDGE_TRIGGER) {
      const last = days[days.length - 1];
      const additions = Array.from({ length: EXTEND_STEP }, (_, i) =>
        addDays(last, i + 1)
      );
      setDays((prev) => [...prev, ...additions]);
      return;
    }

    if (distFromStart <= EDGE_TRIGGER && container) {
      const first = days[0];
      const additions = Array.from({ length: EXTEND_STEP }, (_, i) =>
        addDays(first, -(EXTEND_STEP - i))
      );

      const beforeKey = format(activeDay, "yyyy-MM-dd");
      const beforeEl = panelRefs.current.get(beforeKey);
      const beforeOffset = beforeEl?.offsetLeft ?? 0;
      const beforeScrollLeft = container.scrollLeft;
      const delta = beforeScrollLeft - beforeOffset;

      setDays((prev) => [...additions, ...prev]);

      requestAnimationFrame(() => {
        const afterEl = panelRefs.current.get(beforeKey);
        if (!afterEl) return;
        container.scrollTo({
          left: afterEl.offsetLeft + delta,
          behavior: "instant" as ScrollBehavior,
        });
      });
    }
  }, [activeDay, days]);

  // Notify parent
  useEffect(() => {
    onCurrentDateChange(activeDay);
  }, [activeDay, onCurrentDateChange]);

  // React to external currentDate changes
  useEffect(() => {
    const want = startOfDay(currentDate);
    if (isSameDay(want, activeDay)) return;
    const container = scrollRef.current;
    if (!container) return;

    const key = format(want, "yyyy-MM-dd");
    const el = panelRefs.current.get(key);
    if (el) {
      container.scrollTo({ left: el.offsetLeft, behavior: "smooth" });
      return;
    }

    const fresh: Date[] = [];
    for (let i = -INITIAL_BUFFER; i <= INITIAL_BUFFER; i++) {
      fresh.push(addDays(want, i));
    }
    setDays(fresh);
    setActiveDay(want);
    didInitialScroll.current = false;
  }, [currentDate, activeDay]);

  const { isDragging } = useCalendarDragState();

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden flex scrollbar-hide"
      style={{
        scrollSnapType: isDragging ? "none" : "x mandatory",
        scrollBehavior: isDragging ? "auto" : "smooth",
      }}
    >
      {days.map((d) => {
        const key = format(d, "yyyy-MM-dd");
        return (
          <div
            key={key}
            ref={setPanelRef(key)}
            data-day-key={key}
            className="shrink-0 flex flex-col"
            style={{
              width: "100%",
              minWidth: "100%",
              scrollSnapAlign: "start",
              scrollSnapStop: "always",
              borderLeft: "1px solid rgba(255, 255, 255, 0.04)",
            }}
          >
            <CalendarGridDay
              currentDate={d}
              events={events}
              onEventClick={onEventClick}
              t={t}
            />
          </div>
        );
      })}
    </div>
  );
}
