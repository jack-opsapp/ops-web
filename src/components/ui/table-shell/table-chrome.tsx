"use client";

/**
 * TableChrome — the decoupled metrics bar + sticky toolbar that sits ABOVE a
 * table's rows, inside the scroll region (WEB OVERHAUL P6-2 rework).
 *
 * Jackson's corrected layout: the metrics bar is its OWN element that scrolls UP
 * and out of view; the toolbar (and the table's column header) PIN. This renders
 *
 *   [ metrics ]   — scrolls away (normal flow inside the scroller; sticky-left
 *                   so it only pins horizontally, never vertically)
 *   [ toolbar ]   — sticky top:0 (and left:0 for horizontal grids)
 *
 * and publishes the toolbar's measured height as `--shell-header-top` on the
 * nearest scroll container, so the table's column header — RegisterTable's
 * `<thead>` (register surfaces) or the grid header (Projects/Pipeline) — sticks
 * flush BELOW the toolbar via `top-[var(--shell-header-top,0px)]`.
 *
 * Returns a FRAGMENT (no wrapper) so the metrics + toolbar are direct children
 * of the scroll container: their sticky containing block is then the full scroll
 * content, not a short wrapper that would let the toolbar un-stick. Both
 * archetypes consume this identically — register surfaces render it as the first
 * child of the TableShell scroll body; the grids inject it through the grid's
 * `aboveHeader` slot so it lives inside the virtualized scroller and scrolls with
 * the rows (no virtualizer edits beyond that additive slot).
 */

import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Walk up to the nearest scrollable ancestor (overflow auto/scroll/overlay). */
function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let el = node?.parentElement ?? null;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if (oy === "auto" || oy === "scroll" || oy === "overlay") return el;
    el = el.parentElement;
  }
  return null;
}

export interface TableChromeProps {
  /** The scroll-away metrics bar (MetricsStrip). */
  metrics?: ReactNode;
  /** The pinned toolbar (TableWorkbar / per-surface toolbar). */
  toolbar?: ReactNode;
}

export function TableChrome({ metrics, toolbar }: TableChromeProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Publish the pinned toolbar's height as `--shell-header-top` on the scroll
  // container so the table header can stick directly beneath it. Tracked with a
  // ResizeObserver because the toolbar wraps to a second row at narrow widths.
  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const scroller = findScrollParent(el);
    if (!scroller) return;
    const apply = () => scroller.style.setProperty("--shell-header-top", `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      scroller.style.removeProperty("--shell-header-top");
    };
  }, []);

  return (
    <>
      {metrics ? <div className="sticky left-0 z-[10]">{metrics}</div> : null}
      <div ref={toolbarRef} className="sticky left-0 top-0 z-[30] bg-background">
        {toolbar}
      </div>
    </>
  );
}
