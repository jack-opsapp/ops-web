/**
 * RegisterTable — the shared, tokenized register table.
 *
 * A lightweight, non-virtualized, column-config-driven table that reproduces the
 * projects/pipeline table-v2 *visual anatomy* (header grammar, row chrome, cell
 * typography) without their data-grid framework (saved views, virtualization,
 * inline cell-edit, zoom/density) — which read-mostly registers don't need.
 *
 * Scope decision (WEB OVERHAUL P3-5): the table-v2 grids are heavyweight and
 * deeply domain-coupled; extracting them wholesale would destabilize two shipped
 * surfaces. This extracts only the presentational layer the "reads less clean"
 * finding is about, gives Books one shared table instead of duplicated hand-rolled
 * markup, and is reusable by any future simple register. Converging Projects/
 * Pipeline onto these atoms is logged as deferred debt.
 *
 * Distinct from the older, unused `ui/data-table` (a generic admin grid with a
 * built-in column-visibility toolbar, pagination, and no row-click / actions
 * slot — the wrong fit for a click-to-open register).
 *
 * Row anatomy + cell atoms live in `./register-table-cells`.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface RegisterTableColumn<Row> {
  /** Stable identity for the column. */
  id: string;
  /**
   * Header content. A localized label string in the common case; a `ReactNode`
   * when the header carries a control instead of text (e.g. a select-all
   * checkbox for a bulk-select column). Empty string for the trailing actions
   * column.
   */
  header: ReactNode;
  /** Cell content — compose with the `./register-table-cells` atoms. */
  cell: (row: Row) => ReactNode;
  align?: "left" | "right";
  /** Classes applied to BOTH the `<th>` and every `<td>` (responsive hide, etc.). */
  className?: string;
}

export interface RegisterTableProps<Row> {
  columns: RegisterTableColumn<Row>[];
  rows: Row[];
  getRowId: (row: Row) => string;
  /** Row click → opens the document. Omit for a non-interactive register. */
  onRowClick?: (row: Row) => void;
  /** Per-row interactivity gate (e.g. requires edit permission). Defaults to true. */
  isRowInteractive?: (row: Row) => boolean;
  /**
   * Master-detail / selection affordance: tint a row with the active surface
   * (e.g. the row whose detail drawer is open, or the focused record). Purely
   * presentational — reusable by any register that pairs a list with a panel.
   */
  isRowActive?: (row: Row) => boolean;
  /** Minimum width before the table scrolls horizontally. */
  minWidth?: number;
  /** Accessible name for the table. */
  ariaLabel?: string;
  className?: string;
  /**
   * Rendered inside a `TableShell` scroll body (WEB OVERHAUL P6-2): the `<thead>`
   * pins (`sticky top-0`) over a glass-dense backing and the table renders bare —
   * no own glass wrapper, no own scroll container, because the shell provides both.
   * Default (false) keeps the standalone glass-card behavior for the register's
   * other consumers (Settings tabs, Expenses, Inventory), which are unchanged.
   */
  inShell?: boolean;
}

export function RegisterTable<Row>({
  columns,
  rows,
  getRowId,
  onRowClick,
  isRowInteractive,
  isRowActive,
  minWidth = 760,
  ariaLabel,
  className,
  inShell = false,
}: RegisterTableProps<Row>) {
  const table = (
    <table className="w-full" style={{ minWidth }} aria-label={ariaLabel}>
          <thead>
            <tr className={cn(!inShell && "border-b border-border")}>
              {columns.map((col) => (
                <th
                  key={col.id}
                  scope="col"
                  className={cn(
                    "px-2 py-1.5 text-left align-middle font-mono text-micro font-normal uppercase tracking-[0.16em] text-text-3",
                    // In a TableShell scroll body the header pins over a glass-dense
                    // backing (DESIGN.md §5 stacked-layer surface) so rows scroll
                    // cleanly beneath it — identical pin behavior to the table-v2 grids.
                    inShell &&
                      "sticky top-0 z-[5] border-b border-border bg-[var(--glass-dense)] backdrop-blur-[28px]",
                    col.align === "right" && "text-right",
                    col.className,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const interactive = Boolean(
                onRowClick && (isRowInteractive ? isRowInteractive(row) : true),
              );
              return (
                <tr
                  key={getRowId(row)}
                  tabIndex={interactive ? 0 : undefined}
                  onClick={interactive ? () => onRowClick?.(row) : undefined}
                  onKeyDown={
                    interactive
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowClick?.(row);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    "border-b border-border-subtle last:border-b-0",
                    isRowActive?.(row) && "bg-surface-active",
                    interactive &&
                      "cursor-pointer hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent focus-visible:ring-inset",
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      className={cn(
                        "px-2 py-1.5 align-middle",
                        col.align === "right" && "text-right",
                        col.className,
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
    </table>
  );

  // Inside a TableShell, render bare — the shell supplies the glass panel and the
  // scroll container (and owns the sticky-header positioning context). Standalone,
  // keep the self-contained glass card with its own horizontal scroll.
  if (inShell) {
    return <div className={cn("min-w-full", className)}>{table}</div>;
  }
  return (
    <div className={cn("glass-surface overflow-hidden", className)}>
      <div className="overflow-x-auto">{table}</div>
    </div>
  );
}
