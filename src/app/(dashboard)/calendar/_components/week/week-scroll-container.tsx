"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  addWeeks,
  format,
  isSameWeek,
  startOfWeek,
} from "date-fns";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import { WeekGrid } from "./week-grid";
import { useCalendarDragState } from "../calendar-dnd-shell";

// ─── Constants ──────────────────────────────────────────────────────────────

const INITIAL_BUFFER = 6; // ±6 weeks
const EDGE_TRIGGER = 1;
const EXTEND_STEP = 6;
const WEEK_OPTS = { weekStartsOn: 1 as const };

// ─── Props ──────────────────────────────────────────────────────────────────

interface WeekScrollContainerProps {
  currentDate: Date;
  events: InternalCalendarEvent[];
  onCurrentDateChange: (date: Date) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Horizontal infinite scroll for the Week view. Each panel is one full week
 * (7 columns), full container width, snap-aligned at the left edge.
 *
 * Trackpad horizontal swipe / touch drag advances by one week at a time.
 * Mirrors MonthScrollContainer + DayScrollContainer patterns.
 */
export function WeekScrollContainer({
  currentDate,
  events,
  onCurrentDateChange,
}: WeekScrollContainerProps) {
  const [weeks, setWeeks] = useState<Date[]>(() => {
    const anchor = startOfWeek(currentDate, WEEK_OPTS);
    const out: Date[] = [];
    for (let i = -INITIAL_BUFFER; i <= INITIAL_BUFFER; i++) {
      out.push(addWeeks(anchor, i));
    }
    return out;
  });

  const [activeWeek, setActiveWeek] = useState<Date>(() =>
    startOfWeek(currentDate, WEEK_OPTS)
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

  useLayoutEffect(() => {
    if (didInitialScroll.current) return;
    const container = scrollRef.current;
    if (!container) return;
    const key = format(startOfWeek(currentDate, WEEK_OPTS), "yyyy-MM-dd");
    const el = panelRefs.current.get(key);
    if (!el) return;
    container.scrollTo({ left: el.offsetLeft, behavior: "instant" as ScrollBehavior });
    didInitialScroll.current = true;
  }, [currentDate]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let best: IntersectionObserverEntry | null = null;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          if (!best || e.intersectionRatio > best.intersectionRatio) best = e;
        }
        if (!best) return;
        const key = (best.target as HTMLElement).dataset.weekKey;
        if (!key) return;
        const next = weeks.find((w) => format(w, "yyyy-MM-dd") === key);
        if (!next) return;
        setActiveWeek((prev) =>
          isSameWeek(prev, next, WEEK_OPTS) ? prev : next
        );
      },
      { root: container, threshold: [0.5] }
    );

    panelRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [weeks]);

  useEffect(() => {
    const idx = weeks.findIndex((w) => isSameWeek(w, activeWeek, WEEK_OPTS));
    if (idx === -1) return;
    const container = scrollRef.current;
    const distFromStart = idx;
    const distFromEnd = weeks.length - 1 - idx;

    if (distFromEnd <= EDGE_TRIGGER) {
      const last = weeks[weeks.length - 1];
      const additions = Array.from({ length: EXTEND_STEP }, (_, i) =>
        addWeeks(last, i + 1)
      );
      setWeeks((prev) => [...prev, ...additions]);
      return;
    }

    if (distFromStart <= EDGE_TRIGGER && container) {
      const first = weeks[0];
      const additions = Array.from({ length: EXTEND_STEP }, (_, i) =>
        addWeeks(first, -(EXTEND_STEP - i))
      );

      const beforeKey = format(activeWeek, "yyyy-MM-dd");
      const beforeEl = panelRefs.current.get(beforeKey);
      const beforeOffset = beforeEl?.offsetLeft ?? 0;
      const beforeScrollLeft = container.scrollLeft;
      const delta = beforeScrollLeft - beforeOffset;

      setWeeks((prev) => [...additions, ...prev]);

      requestAnimationFrame(() => {
        const afterEl = panelRefs.current.get(beforeKey);
        if (!afterEl) return;
        container.scrollTo({
          left: afterEl.offsetLeft + delta,
          behavior: "instant" as ScrollBehavior,
        });
      });
    }
  }, [activeWeek, weeks]);

  useEffect(() => {
    onCurrentDateChange(activeWeek);
  }, [activeWeek, onCurrentDateChange]);

  useEffect(() => {
    const want = startOfWeek(currentDate, WEEK_OPTS);
    if (isSameWeek(want, activeWeek, WEEK_OPTS)) return;
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
      fresh.push(addWeeks(want, i));
    }
    setWeeks(fresh);
    setActiveWeek(want);
    didInitialScroll.current = false;
  }, [currentDate, activeWeek]);

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
      {weeks.map((w) => {
        const key = format(w, "yyyy-MM-dd");
        return (
          <div
            key={key}
            ref={setPanelRef(key)}
            data-week-key={key}
            className="shrink-0 flex flex-col"
            style={{
              width: "100%",
              minWidth: "100%",
              scrollSnapAlign: "start",
              scrollSnapStop: "always",
              borderLeft: "1px solid rgba(255, 255, 255, 0.04)",
            }}
          >
            <WeekGrid currentDate={w} events={events} />
          </div>
        );
      })}
    </div>
  );
}
