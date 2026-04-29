"use client";

/**
 * CrewScrollContainer — horizontal infinite scroll for the Crew view.
 *
 * Mirrors WeekScrollContainer's pattern: each panel is one full week of the
 * crew/day matrix, full container width, snap-aligned. Trackpad swipe /
 * touch drag advances week-by-week with proximity snap (no trapping at
 * panel boundaries).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { addWeeks, format, isSameWeek, startOfWeek } from "date-fns";
import type { TeamMember } from "@/lib/types/models";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import { CrewGrid } from "./crew-grid";
import { useCalendarDragState } from "../calendar-dnd-shell";

const INITIAL_BUFFER = 6;
const EDGE_TRIGGER = 1;
const EXTEND_STEP = 6;
const WEEK_OPTS = { weekStartsOn: 1 as const };

interface CrewScrollContainerProps {
  currentDate: Date;
  events: InternalCalendarEvent[];
  teamMembers: TeamMember[];
  onCurrentDateChange: (date: Date) => void;
  onEventClick?: (event: InternalCalendarEvent) => void;
}

export function CrewScrollContainer({
  currentDate,
  events,
  teamMembers,
  onCurrentDateChange,
  onEventClick,
}: CrewScrollContainerProps) {
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
    container.scrollTo({
      left: el.offsetLeft,
      behavior: "instant" as ScrollBehavior,
    });
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

  // See month-scroll-container for why activeWeek is intentionally not in
  // the deps — prevents an internal scroll feedback loop from yanking the
  // viewport mid-scroll.
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

  const { isDragging } = useCalendarDragState();

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden flex scrollbar-hide"
      style={{
        scrollSnapType: isDragging ? "none" : "x proximity",
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
              borderLeft: "1px solid rgba(255, 255, 255, 0.04)",
            }}
          >
            <CrewGrid
              events={events}
              teamMembers={teamMembers}
              startDate={w}
              onEventClick={onEventClick}
            />
          </div>
        );
      })}
    </div>
  );
}
