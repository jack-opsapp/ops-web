"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  addMonths,
  format,
  startOfMonth,
  isSameMonth,
} from "date-fns";
import type { InternalCalendarEvent } from "@/lib/utils/calendar-utils";
import { CalendarGridMonth } from "../calendar-grid-month";
import { useCalendarDragState } from "../calendar-dnd-shell";

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * How many months to render in each direction from the anchor at first paint.
 * The user can scroll smoothly through (2 * BUFFER + 1) months without any
 * extension; once they get near an edge, EXTEND_STEP more months are
 * prepended/appended in a single batch.
 */
const INITIAL_BUFFER = 6;
const EDGE_TRIGGER = 1; // when N panels from the edge, extend
const EXTEND_STEP = 6;

// ─── Props ──────────────────────────────────────────────────────────────────

interface MonthScrollContainerProps {
  /** Anchor / "current" month — drives initial scroll position. */
  currentDate: Date;
  /** All events in the buffered range, mapped already. */
  events: InternalCalendarEvent[];
  /** Fired when the user scrolls a different month into view (snap-end). */
  onCurrentDateChange: (date: Date) => void;
  /** Click on a day cell — same contract as CalendarGridMonth. */
  onSelectDate?: (date: Date) => void;
  /** Click on an event bar — same contract as CalendarGridMonth. */
  onEventClick?: (event: InternalCalendarEvent) => void;
  t?: (key: string) => string;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Vertical infinite scroll for the month view. Renders a stack of month grids
 * inside a CSS scroll-snap container — natural scroll, native snap, no drag
 * library needed.
 *
 * - IntersectionObserver tracks which month is most-visible and fires
 *   `onCurrentDateChange` so the header date label, [TODAY] pill state, and
 *   data-fetch range stay in sync.
 * - Once the visible month is within EDGE_TRIGGER of either end, EXTEND_STEP
 *   more months are added on that side. ScrollTop is corrected when prepending
 *   so the viewport stays anchored on whatever the user was looking at.
 * - Each month panel is a self-contained <CalendarGridMonth> with its own
 *   DndContext (drag-drop within a month works as before; cross-month drag is
 *   not supported, matching pre-rework behavior).
 */
export function MonthScrollContainer({
  currentDate,
  events,
  onCurrentDateChange,
  onSelectDate,
  onEventClick,
  t,
}: MonthScrollContainerProps) {
  // ── Months currently rendered. Stored as anchor=startOfMonth(date) ──────
  const [months, setMonths] = useState<Date[]>(() => {
    const anchor = startOfMonth(currentDate);
    const out: Date[] = [];
    for (let i = -INITIAL_BUFFER; i <= INITIAL_BUFFER; i++) {
      out.push(addMonths(anchor, i));
    }
    return out;
  });

  // ── Active month — drives the parent's currentDate. Initialised to the
  //    incoming currentDate; user scrolling updates it. ─────────────────────
  const [activeMonth, setActiveMonth] = useState<Date>(
    () => startOfMonth(currentDate)
  );

  // ── Refs for the scroll container + each panel ──────────────────────────
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const panelRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setPanelRef = useCallback(
    (key: string) => (node: HTMLDivElement | null) => {
      if (node) panelRefs.current.set(key, node);
      else panelRefs.current.delete(key);
    },
    []
  );

  // Track whether we've performed the initial scroll-to-anchor; the first
  // render renders 13 panels but the scrollbox starts at panel 0 (the
  // earliest). We need to scroll to the anchor panel synchronously after
  // mount so the user lands on the correct month.
  const didInitialScroll = useRef(false);

  // ── Initial scroll: jump to the anchor panel without animation ──────────
  useLayoutEffect(() => {
    if (didInitialScroll.current) return;
    const container = scrollRef.current;
    if (!container) return;

    const anchorKey = format(startOfMonth(currentDate), "yyyy-MM");
    const anchorEl = panelRefs.current.get(anchorKey);
    if (!anchorEl) return;

    // jumpInstant — no smooth scroll on mount.
    container.scrollTo({ top: anchorEl.offsetTop, behavior: "instant" as ScrollBehavior });
    didInitialScroll.current = true;
  }, [currentDate]);

  // ── Track active month via IntersectionObserver ─────────────────────────
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry whose intersectionRatio is highest. Ties broken by
        // top-most.
        let best: IntersectionObserverEntry | null = null;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          if (!best || e.intersectionRatio > best.intersectionRatio) {
            best = e;
          }
        }
        if (!best) return;

        const key = (best.target as HTMLElement).dataset.monthKey;
        if (!key) return;
        const next = months.find((m) => format(m, "yyyy-MM") === key);
        if (!next) return;

        setActiveMonth((prev) => (isSameMonth(prev, next) ? prev : next));
      },
      {
        root: container,
        // Trigger when the panel is centered in the viewport. 50% is a good
        // balance — the 'majority visible' panel becomes the active one.
        threshold: [0.5],
      }
    );

    panelRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [months]);

  // ── Edge extension: if the active month is near an end, add more ────────
  useEffect(() => {
    const idx = months.findIndex((m) => isSameMonth(m, activeMonth));
    if (idx === -1) return;

    const container = scrollRef.current;
    const distFromStart = idx;
    const distFromEnd = months.length - 1 - idx;

    if (distFromEnd <= EDGE_TRIGGER) {
      // Append more months at the bottom — no scroll correction needed
      const last = months[months.length - 1];
      const additions = Array.from({ length: EXTEND_STEP }, (_, i) =>
        addMonths(last, i + 1)
      );
      setMonths((prev) => [...prev, ...additions]);
      return;
    }

    if (distFromStart <= EDGE_TRIGGER && container) {
      // Prepend months — must offset scrollTop by the height of the new
      // panels so the viewport stays anchored on what the user was looking at.
      const first = months[0];
      const additions = Array.from({ length: EXTEND_STEP }, (_, i) =>
        addMonths(first, -(EXTEND_STEP - i))
      );

      // Capture current scroll + a measurement element BEFORE the state update
      const beforeKey = format(activeMonth, "yyyy-MM");
      const beforeEl = panelRefs.current.get(beforeKey);
      const beforeOffset = beforeEl?.offsetTop ?? 0;
      const beforeScrollTop = container.scrollTop;
      const delta = beforeScrollTop - beforeOffset;

      setMonths((prev) => [...additions, ...prev]);

      // After paint, find the same panel again and restore the relative
      // scroll position.
      requestAnimationFrame(() => {
        const afterEl = panelRefs.current.get(beforeKey);
        if (!afterEl) return;
        container.scrollTo({
          top: afterEl.offsetTop + delta,
          behavior: "instant" as ScrollBehavior,
        });
      });
    }
  }, [activeMonth, months]);

  // ── Notify parent on active-month changes ───────────────────────────────
  useEffect(() => {
    onCurrentDateChange(activeMonth);
  }, [activeMonth, onCurrentDateChange]);

  // ── React to external currentDate changes (e.g. [TODAY] pill click) ─────
  // If the parent sets a currentDate for a month outside the rendered range,
  // we need to either rebuild the months array around it or scroll to it.
  useEffect(() => {
    const want = startOfMonth(currentDate);
    if (isSameMonth(want, activeMonth)) return;

    const container = scrollRef.current;
    if (!container) return;

    // Already in the rendered set — just scroll to it
    const key = format(want, "yyyy-MM");
    const el = panelRefs.current.get(key);
    if (el) {
      container.scrollTo({ top: el.offsetTop, behavior: "smooth" });
      return;
    }

    // Not in the rendered set — rebuild the months centered on the new date
    const fresh: Date[] = [];
    for (let i = -INITIAL_BUFFER; i <= INITIAL_BUFFER; i++) {
      fresh.push(addMonths(want, i));
    }
    setMonths(fresh);
    setActiveMonth(want);
    didInitialScroll.current = false; // re-run initial scroll
  }, [currentDate, activeMonth]);

  // ── Drag state — disable snap during drag so dnd-kit's autoscroll can move
  //    the viewport across panel boundaries. ────────────────────────────────
  const { isDragging } = useCalendarDragState();

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-y-auto scrollbar-hide"
      style={{
        scrollSnapType: isDragging ? "none" : "y mandatory",
        scrollBehavior: isDragging ? "auto" : "smooth",
      }}
    >
      {months.map((m) => {
        const key = format(m, "yyyy-MM");
        return (
          <div
            key={key}
            ref={setPanelRef(key)}
            data-month-key={key}
            className="relative"
            style={{
              minHeight: "100%",
              scrollSnapAlign: "start",
              scrollSnapStop: "always",
              // Subtle separator between months
              borderTop: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            {/* Sticky month-label ribbon — keeps the month name visible at the
                top of each panel as the user scrolls. */}
            <div
              className="sticky top-0 z-10 flex items-baseline gap-3 px-4 py-2"
              style={{
                background:
                  "linear-gradient(180deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.65) 70%, transparent 100%)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
              }}
            >
              <span
                className="font-cakemono font-light uppercase"
                style={{
                  color: "var(--text)",
                  fontSize: 18,
                  letterSpacing: 0,
                }}
              >
                {format(m, "MMMM")}
              </span>
              <span
                className="font-mono uppercase tracking-wider tabular-nums"
                style={{
                  color: "var(--text-3)",
                  fontSize: 11,
                  fontFeatureSettings: '"tnum" 1, "zero" 1',
                }}
              >
                {format(m, "yyyy")}
              </span>
            </div>

            <div style={{ paddingTop: 0 }}>
              <CalendarGridMonth
                currentDate={m}
                events={events}
                onSelectDate={onSelectDate}
                onEventClick={onEventClick}
                t={t}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
