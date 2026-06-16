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
import type { InternalScheduleEvent } from "@/lib/utils/schedule-utils";
import { WeekGrid } from "./week-grid";
import { useScheduleDragState } from "../schedule-dnd-shell";

// ─── Constants ──────────────────────────────────────────────────────────────

const INITIAL_BUFFER = 6; // ±6 weeks
const EDGE_TRIGGER = 1;
const EXTEND_STEP = 6;
const WEEK_OPTS = { weekStartsOn: 1 as const };

// ─── Props ──────────────────────────────────────────────────────────────────

interface WeekScrollContainerProps {
  currentDate: Date;
  events: InternalScheduleEvent[];
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

  // CRITICAL: do NOT key on activeWeek. The internal scroll → setActiveWeek
  // → onCurrentDateChange → parent setCurrentDate loop would otherwise see
  // a stale currentDate, fire scrollTo to the OLD week's offset, and yank
  // the user back mid-scroll. Read the latest activeWeek via a ref instead.
  const activeWeekRef = useRef(activeWeek);
  useEffect(() => {
    activeWeekRef.current = activeWeek;
  }, [activeWeek]);

  useEffect(() => {
    const want = startOfWeek(currentDate, WEEK_OPTS);
    if (isSameWeek(want, activeWeekRef.current, WEEK_OPTS)) return;
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
  }, [currentDate]);

  const { isDragging } = useScheduleDragState();

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden flex scrollbar-hide"
      style={{
        // proximity (not mandatory) so panels snap when scroll settles but
        // don't trap each wheel/trackpad tick at the boundary.
        scrollSnapType: isDragging ? "none" : "x proximity",
        scrollBehavior: isDragging ? "auto" : "smooth",
      }}
    >
      {weeks.map((w) => {
        const key = format(w, "yyyy-MM-dd");
        const isActivePanel = isSameWeek(w, activeWeek, WEEK_OPTS);
        return (
          <div
            key={key}
            ref={setPanelRef(key)}
            data-week-key={key}
            aria-hidden={!isActivePanel}
            inert={!isActivePanel ? true : undefined}
            className="shrink-0 flex flex-col"
            style={{
              width: "100%",
              minWidth: "100%",
              scrollSnapAlign: "start",
              borderLeft: "1px solid var(--surface-input)",
            }}
          >
            <WeekGrid currentDate={w} events={events} />
          </div>
        );
      })}
    </div>
  );
}
