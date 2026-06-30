"use client";

/**
 * TableShell — the ONE table frame across every list surface (WEB OVERHAUL P6-2,
 * reworked per Jackson's live review 2026-06-30).
 *
 * The corrected layout is FULL-BLEED: no glass panel, no rounded-panel, no route
 * gutters — the table runs edge-to-edge in its content area. The metrics bar is
 * DECOUPLED and scrolls UP and out of view; the toolbar and the table's column
 * header PIN. That stack is `TableChrome` (metrics scroll-away + sticky toolbar),
 * rendered inside the single scroll region:
 *
 *   ┌─ frame · relative flex h-full min-h-0 flex-col (no glass/radius) ──┐
 *   │ ┌─ scroll body · min-h-0 flex-1 overflow-auto ──────────────────┐ │
 *   │ │  TableChrome:  [ metrics ]  ← scrolls away                     │ │
 *   │ │                [ toolbar ]  ← sticky top:0                      │ │
 *   │ │  children    (sticky <thead> pins at top:var(--shell-header-top)│ │
 *   │ └────────────────────────────────────────────────────────────────┘│
 *   │ bottom fade cue                                                    │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Register surfaces (Books/Catalog/Clients) use the default scroll body: the
 * shell scrolls, RegisterTable `inShell` renders its `<thead>` sticky beneath the
 * toolbar. Grid surfaces (Projects/Pipeline) pass `scroll={false}` and own their
 * virtualized scroller — they inject the SAME `TableChrome` through the grid's
 * `aboveHeader` slot so the metrics scroll away inside the virtualized scroll
 * region, with virtualization / frozen columns / density-zoom / inline edit
 * untouched.
 *
 * Requires a definite-height parent; the dashboard `fullHeight: "bleed"` wrapper
 * provides `flex min-h-0 flex-1` with no horizontal gutter.
 */

import { forwardRef, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { cn } from "@/lib/utils/cn";
import { TableChrome } from "./table-chrome";

/**
 * TableWorkbar — the canonical toolbar chrome for a TableShell. Holds the
 * standard border + padding so every surface's toolbar (segment control · search
 * · CTA · filter chips · count · stat line · density · view tabs) reads
 * identically. Callers supply the rows (typically two `flex flex-wrap` rows).
 */
export function TableWorkbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-2 border-b border-line px-3 py-2.5", className)}>{children}</div>;
}

export interface TableShellProps {
  /** Scroll-away metrics bar (MetricsStrip). Register archetype only — grids pass it via the grid's `aboveHeader`. */
  metrics?: ReactNode;
  /** Sticky toolbar. Register archetype only. */
  toolbar?: ReactNode;
  /** Banner row inside the scroll region below the toolbar (e.g. an "unavailable view" alert). */
  banner?: ReactNode;
  /** Scroll-region content — the table (register) or, with `scroll={false}`, the virtualized grid. */
  children: ReactNode;
  /** When true, render `emptyState` instead of `children`. */
  isEmpty?: boolean;
  emptyState?: ReactNode;
  /** Bottom fade cue over the scroll region (default true). */
  bottomFade?: boolean;
  /**
   * When false the caller owns the scroll container (grid archetype: the
   * virtualized grid scrolls itself and renders its own `TableChrome` via
   * `aboveHeader`). Default true → the shell provides the scroll body.
   */
  scroll?: boolean;
  className?: string;
  bodyClassName?: string;
  /** Scroll-body ref — for virtualization / fetch-on-scroll. */
  bodyRef?: Ref<HTMLDivElement>;
  /** Extra props on the scroll body (role/tabIndex/onScroll…). */
  bodyProps?: HTMLAttributes<HTMLDivElement>;
}

export const TableShell = forwardRef<HTMLDivElement, TableShellProps>(function TableShell(
  {
    metrics,
    toolbar,
    banner,
    children,
    isEmpty,
    emptyState,
    bottomFade = true,
    scroll = true,
    className,
    bodyClassName,
    bodyRef,
    bodyProps,
  },
  ref,
) {
  return (
    <div ref={ref} className={cn("relative flex h-full min-h-0 flex-col", className)}>
      {scroll === false ? (
        children
      ) : (
        <div
          ref={bodyRef}
          data-shell-scroll
          className={cn("relative min-h-0 flex-1 overflow-auto", bodyClassName)}
          {...bodyProps}
        >
          <TableChrome metrics={metrics} toolbar={toolbar} />
          {banner}
          {isEmpty ? emptyState : children}
        </div>
      )}
      {bottomFade && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[12] h-10 bg-gradient-to-b from-transparent via-background/60 to-background/90"
        />
      )}
    </div>
  );
});
