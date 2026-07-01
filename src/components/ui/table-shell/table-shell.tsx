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

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { cn } from "@/lib/utils/cn";
import { TableChrome } from "./table-chrome";

/**
 * TableWorkbar — the canonical toolbar CONTAINER (glass hairline + standard
 * padding at the shared 96px gutter). It just supplies the frame; for the
 * standard slot LAYOUT, prefer {@link Workbar}, which owns where each control
 * lives so surfaces stay consistent.
 */
export function TableWorkbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-2 border-b border-line px-3 py-2.5", className)}>{children}</div>;
}

/**
 * Workbar — the ONE canonical toolbar layout across every list surface (Projects,
 * Pipeline, Books, Catalog, Clients). It fixes a single grammar so that search,
 * filters, and the create action land in the SAME place on every tab — the
 * positions are owned here, not re-decided per surface, so they can't drift
 * (Jackson 2026-07-01):
 *
 *   Row 1:  [ search ] [ filters ] ──────(flex spacer)────── [ tools ] [ create ]
 *            leftmost    after search                           right     rightmost
 *   Row 2:  [ tabStrip ]   — segment/mode controls + saved-view tabs
 *
 * Each surface fills the slots; empty slots simply collapse (no reserved gaps).
 * Built on {@link TableWorkbar}. The `create` slot should be a {@link WorkbarButton};
 * `search` the shared `SearchInput`.
 */
export function Workbar({
  search,
  filters,
  tools,
  create,
  tabStrip,
  children,
}: {
  /** Row 1, leftmost — the shared `SearchInput` (single fixed width). */
  search?: ReactNode;
  /** Row 1, immediately right of search — filter chips / dropdowns (+ count). */
  filters?: ReactNode;
  /** Row 1, right cluster before create — density / group / view-settings / kebab / stat line. */
  tools?: ReactNode;
  /** Row 1, rightmost — the single primary create CTA (`WorkbarButton`). */
  create?: ReactNode;
  /** Row 2 — segment/mode controls and saved-view tabs, a tab strip. */
  tabStrip?: ReactNode;
  /** Extra full-width rows below the tab strip (e.g. a pinned bulk-action bar). */
  children?: ReactNode;
}) {
  const hasRightCluster = tools != null || create != null;
  return (
    <TableWorkbar>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {search}
        {filters}
        {hasRightCluster ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {tools}
            {create}
          </div>
        ) : null}
      </div>
      {tabStrip}
      {children}
    </TableWorkbar>
  );
}

/**
 * WorkbarButton — the ONE compact primary CTA for a TableWorkbar (NEW CLIENT /
 * ADD / NEW LEAD …). A dense 28px filled-accent chip that sits flush with the
 * other toolbar controls (search, filters, density) across every surface.
 *
 * Deliberately NOT the heavy `<Button>` primitive: this project's spacing scale
 * makes its size classes render ~2x tall (`h-8` = 64px), which dwarfs the dense
 * toolbar. Filled steel-blue at rest → brightens on hover; accent focus ring with
 * a black offset so it stays visible against the accent fill. The single primary
 * CTA per surface — the one place the steel-blue accent appears in the workbar.
 */
export function WorkbarButton({
  children,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        "flex h-[28px] shrink-0 items-center gap-[5px] rounded-chip border border-ops-accent bg-ops-accent px-[10px] font-mono text-micro uppercase leading-none tracking-[0.12em] text-black transition-colors hover:border-ops-accent-hover hover:bg-ops-accent-hover focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
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
