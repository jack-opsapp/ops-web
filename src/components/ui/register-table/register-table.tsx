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

import { Fragment, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/** Active sort descriptor for a `RegisterTable` (see `sort` / `onSortChange`). */
export interface RegisterTableSort {
  columnId: string;
  direction: "asc" | "desc";
}

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
  /**
   * Opt this column into the sort affordance: the header label becomes a button
   * and the `<th>` reports `aria-sort`. Omit (the default) and the header renders
   * exactly as before — plain content, no `aria-sort`, no button.
   */
  sortable?: boolean;
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
  /**
   * Active sort. `null`/omitted = unsorted. Ordering the rows themselves stays
   * the caller's job — the table renders the affordance and the `aria-sort`
   * state only, leaving the comparator (locale collation, rank orders,
   * tie-breaks) where the domain knowledge lives.
   */
  sort?: RegisterTableSort | null;
  /**
   * Fired when a sortable header is activated. The caller owns the toggle
   * semantics (set → flip direction → clear), so each register can pick the
   * cycle that fits its data.
   */
  onSortChange?: (columnId: string) => void;
  /**
   * Detail renderer for an expanded row. Its node is hosted by a second,
   * non-interactive `<tr>` spanning every column, directly beneath the record
   * it belongs to. Omit for a non-expandable table.
   */
  renderExpanded?: (row: Row) => ReactNode;
  /** Ids currently expanded. The caller owns the open/closed set. */
  expandedRowIds?: ReadonlySet<string>;
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
  sort,
  onSortChange,
  renderExpanded,
  expandedRowIds,
}: RegisterTableProps<Row>) {
  const table = (
    <table className="w-full" style={{ minWidth }} aria-label={ariaLabel}>
          <thead>
            <tr className={cn(!inShell && "border-b border-border")}>
              {columns.map((col) => {
                const sorted =
                  col.sortable && sort?.columnId === col.id ? sort.direction : null;
                // `aria-sort` belongs only on a sortable header: a sorted column
                // reports its direction, an unsorted-but-sortable column reports
                // "none", and a plain column omits the attribute entirely — the
                // same grammar the pipeline table header uses.
                const ariaSort = col.sortable
                  ? sorted === "asc"
                    ? "ascending"
                    : sorted === "desc"
                      ? "descending"
                      : "none"
                  : undefined;

                return (
                  <th
                    key={col.id}
                    scope="col"
                    aria-sort={ariaSort}
                    className={cn(
                      "px-2 py-1.5 text-left align-middle font-mono text-micro font-normal uppercase tracking-[0.16em] text-text-3",
                      // In a TableShell scroll body the header pins over an opaque
                      // canvas backing so rows scroll cleanly beneath it — the same
                      // `bg-background` masking the table-v2 grids use, for one
                      // consistent sticky-header treatment across all five surfaces.
                      // It sticks BELOW the (also-sticky) toolbar via the
                      // `--shell-header-top` var TableChrome publishes; the metrics
                      // bar above the toolbar scrolls up and out (WEB OVERHAUL P6-2 rework).
                      inShell && "sticky top-[var(--shell-header-top,0px)] z-[5] border-b border-border bg-background",
                      col.align === "right" && "text-right",
                      col.className,
                    )}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => onSortChange?.(col.id)}
                        className={cn(
                          "inline-flex max-w-full items-center gap-1 font-mono text-micro uppercase tracking-[0.16em] text-text-3 hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
                          sorted && "text-text-2",
                        )}
                      >
                        <span className="truncate">{col.header}</span>
                        {sorted === "asc" && (
                          <ChevronUp className="h-[12px] w-[12px] shrink-0" strokeWidth={1.5} />
                        )}
                        {sorted === "desc" && (
                          <ChevronDown className="h-[12px] w-[12px] shrink-0" strokeWidth={1.5} />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const interactive = Boolean(
                onRowClick && (isRowInteractive ? isRowInteractive(row) : true),
              );
              const rowId = getRowId(row);
              const expanded = Boolean(renderExpanded && expandedRowIds?.has(rowId));
              return (
                <Fragment key={rowId}>
                <tr
                  aria-expanded={expandedRowIds ? expanded : undefined}
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
                {expanded && (
                  // The detail row is chrome, not a record: no click target, no
                  // hover, no focus stop — the row above it owns the toggle. Its
                  // dim neutral fill reads as a surface nested inside the
                  // register rather than another row in it.
                  <tr className="border-b border-border-subtle bg-fill-neutral-dim last:border-b-0">
                    <td colSpan={columns.length} className="p-0">
                      {renderExpanded?.(row)}
                    </td>
                  </tr>
                )}
                </Fragment>
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
