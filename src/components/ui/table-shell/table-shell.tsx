"use client";

/**
 * TableShell — the ONE table frame across every list surface (WEB OVERHAUL P6-2).
 *
 * Jackson, 2026-06-24: Projects/Pipeline pin a header + metrics bar on scroll;
 * Books/Catalog/Clients don't — "terrible, unpredictable UI." The divergence was
 * structural: the grids (table-v2) live in a fixed-viewport flex column with an
 * INTERNAL scroll body and a `sticky top-0` header; the registers were a
 * document-flow stack that scrolled at the route level, so their header never
 * stuck. TableShell is the shared instrument frame BOTH now consume:
 *
 *   ┌─ glass panel · flex h-full min-h-0 flex-col ───────────────┐
 *   │ viewTabs?   — saved-views tier (grid only), pinned         │
 *   │ metrics?    — MetricsStrip, pinned                          │
 *   │ workbar?    — segment ctrl · search · CTA · chips, pinned   │
 *   │ ┌─ body · min-h-0 flex-1 overflow-auto ──────────────────┐ │
 *   │ │  children  (sticky <thead>/header pins at top:0 here)   │ │
 *   │ └────────────────────────────────────────────────────────┘ │
 *   │ bottom fade cue                                            │
 *   └───────────────────────────────────────────────────────────┘
 *
 * Register surfaces render a RegisterTable with `inShell` (sticky thead, no own
 * glass/scroll — the shell provides both). Grid surfaces pass their virtualized
 * div-grid as children and wire the scroll container via `bodyRef`/`bodyProps`,
 * keeping virtualization, frozen columns, density/zoom, saved views and inline
 * edit untouched. The panel never grows the page — the body scrolls.
 *
 * Requires a definite-height parent (the dashboard `fullHeight` wrappers provide
 * `flex min-h-0 flex-1`). Register routes opt in via `fullHeight: "padded"` in
 * the route registry.
 */

import { forwardRef, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * TableWorkbar — the canonical pinned workbar chrome for a TableShell slot.
 * Holds the standard border + padding so every surface's workbar (segment
 * control · search · CTA · filter chips · count · stat line · density) reads
 * identically. Callers supply the rows (typically two `flex flex-wrap` rows).
 */
export function TableWorkbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-2 border-b border-line px-3 py-2.5", className)}>{children}</div>;
}

export interface TableShellProps {
  /** Saved-views tier, rendered above metrics (grid surfaces only). */
  viewTabs?: ReactNode;
  /** Pinned metrics bar (MetricsStrip). */
  metrics?: ReactNode;
  /** Pinned workbar — segment control · search · CTA · filter chips · count · stat line · density. */
  workbar?: ReactNode;
  /** Banner row above the body but below the workbar (e.g. an "unavailable view" alert). */
  banner?: ReactNode;
  /** Scroll-body content — the table or the virtualized grid. */
  children: ReactNode;
  /** When true, render `emptyState` instead of `children` inside the scroll body. */
  isEmpty?: boolean;
  emptyState?: ReactNode;
  /** Bottom fade cue over the scroll body (default true). */
  bottomFade?: boolean;
  /** Render the outer panel as a glass surface (default true). */
  glass?: boolean;
  className?: string;
  bodyClassName?: string;
  /** Scroll-body ref — for virtualization / fetch-on-scroll (grid surfaces). */
  bodyRef?: Ref<HTMLDivElement>;
  /** Extra props on the scroll body (role/tabIndex/onScroll/onWheel/onKeyDown… for the grid). */
  bodyProps?: HTMLAttributes<HTMLDivElement>;
}

export const TableShell = forwardRef<HTMLDivElement, TableShellProps>(function TableShell(
  {
    viewTabs,
    metrics,
    workbar,
    banner,
    children,
    isEmpty,
    emptyState,
    bottomFade = true,
    glass = true,
    className,
    bodyClassName,
    bodyRef,
    bodyProps,
  },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "relative flex h-full min-h-0 flex-col overflow-hidden rounded-panel",
        glass ? "glass-surface" : "border border-border",
        className,
      )}
    >
      {viewTabs}
      {metrics}
      {workbar}
      {banner}
      <div ref={bodyRef} className={cn("relative min-h-0 flex-1 overflow-auto", bodyClassName)} {...bodyProps}>
        {isEmpty ? emptyState : children}
      </div>
      {bottomFade && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[12] h-10 bg-gradient-to-b from-transparent via-background/60 to-background/90"
        />
      )}
    </div>
  );
});
