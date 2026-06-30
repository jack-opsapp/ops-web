"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDictionary } from "@/i18n/client";
import type { OpportunityStage } from "@/lib/types/pipeline";
import type { OpportunityCellSaveState } from "@/lib/hooks/pipeline-table/use-opportunity-cell-edit";
import type {
  PipelineTableActiveCell,
  PipelineTableEditingCell,
} from "@/lib/hooks/pipeline-table/use-pipeline-table-keyboard-nav";
import {
  PIPELINE_TABLE_COLUMNS,
  type PipelineTableColumnConfig,
  type PipelineTableColumnId,
  type PipelineTableEditableColumnId,
  type PipelineTableEditValue,
  type PipelineTableRow as PipelineTableRowModel,
  type PipelineTableSort,
} from "@/lib/types/pipeline-table";
import { buildFlattenedRows } from "@/lib/utils/pipeline-table-grouping";
import { PipelineTableHeader } from "./pipeline-table-header";
import { PipelineTableRow } from "./pipeline-table-row";
import {
  GROUP_HEADER_HEIGHT,
  PipelineStageGroupHeader,
} from "./pipeline-stage-group-header";

/**
 * The single cell currently in inline-edit mode (or `null`). Owned by the
 * keyboard-nav hook (`usePipelineTableKeyboardNav`) in the shell, re-exported
 * here so the row keeps a stable local import path.
 */
export type PipelineEditingCell = PipelineTableEditingCell;

/**
 * Sizing metrics for the table — a structural subset of the projects table's
 * zoom metrics (`getTableZoomMetrics`), so the shell can hand its
 * `useTableZoom().metrics` straight through. `avatarSize` / `columnScale` ride
 * along even though the read-only phase only consumes a few of them.
 */
export interface PipelineTableMetrics {
  zoom: number;
  density: "compact" | "comfortable" | "spacious";
  rowHeight: number;
  headerHeight: number;
  fontSize: number;
  microFontSize: number;
  avatarSize: number;
  columnScale: number;
}

/** A column plus its resolved render width and (for frozen columns) sticky offset. */
export interface PipelineTableColumnLayout {
  column: PipelineTableColumnConfig;
  width: number;
  stickyLeft: number | null;
}

/**
 * Clamp a column's scaled width into its [min, max] band. Density scales the
 * base width up/down; the band keeps frozen rails from collapsing or runaway.
 */
function getColumnWidth(column: PipelineTableColumnConfig, scale: number): number {
  const scaled = Math.round(column.width * scale);
  return Math.min(column.maxWidth, Math.max(column.minWidth, scaled));
}

export function PipelineTable({
  rows,
  sorting,
  onSortingChange,
  grouped,
  collapsedStages,
  onToggleStageCollapse,
  metrics,
  now,
  selectedIds,
  onToggleRow,
  onToggleSelectAllVisible,
  onOpenDeal,
  saveStates,
  activeCell,
  editingCell,
  canManage,
  setActiveCell,
  onBeginEdit,
  onCancelEdit,
  onCellKeyDown,
  onCommitCell,
  onRequestStageChange,
  onRequestConvertAlreadyWon,
  aboveHeader,
}: {
  rows: PipelineTableRowModel[];
  sorting: PipelineTableSort[];
  onSortingChange: (sorting: PipelineTableSort[]) => void;
  /** When true, rows render under per-stage group headers; false = flat list. */
  grouped: boolean;
  /** Stages currently collapsed (their data rows hidden, header retained). */
  collapsedStages: ReadonlySet<OpportunityStage>;
  /** Toggle a stage's collapsed state — owned by the shell so it survives refetch. */
  onToggleStageCollapse: (stage: OpportunityStage) => void;
  metrics: PipelineTableMetrics;
  /** Injected clock (stable for this surface's mount) for row aging/overdue cues. */
  now: Date;
  selectedIds: Set<string>;
  onToggleRow: (rowId: string, mode: "single" | "toggle" | "range") => void;
  /**
   * Toggle select-all for the RENDERED (un-collapsed) data rows. Owned by the
   * shell: it flips the rendered rows on (or, when all rendered are already
   * selected, off) WITHOUT touching collapsed-stage selections, so this is a
   * single toggle rather than a select/clear pair. The header checkbox and ⌘A
   * both route here.
   */
  onToggleSelectAllVisible: () => void;
  onOpenDeal: (rowId: string) => void;
  saveStates: Map<string, OpportunityCellSaveState>;
  activeCell: PipelineTableActiveCell | null;
  editingCell: PipelineEditingCell | null;
  canManage: boolean;
  setActiveCell: (cell: PipelineTableActiveCell) => void;
  onBeginEdit: (rowId: string, columnId: PipelineTableEditableColumnId) => void;
  onCancelEdit: () => void;
  onCellKeyDown: (
    rowId: string,
    columnId: PipelineTableColumnId,
    event: KeyboardEvent<HTMLElement>,
  ) => void;
  onCommitCell: (
    rowId: string,
    columnId: PipelineTableEditableColumnId,
    value: PipelineTableEditValue,
  ) => void;
  onRequestStageChange: (rowId: string, next: OpportunityStage) => void;
  onRequestConvertAlreadyWon: (rowId: string) => void;
  /**
   * Optional chrome rendered as the FIRST child inside the scroll container,
   * above the sticky header — the decoupled metrics bar + sticky toolbar
   * (TableChrome). Scrolls with the rows so the metrics scroll up and out of
   * view while the toolbar + header pin (WEB OVERHAUL P6-2 rework). Default
   * undefined → byte-identical legacy render.
   */
  aboveHeader?: ReactNode;
}) {
  const { t } = useDictionary("pipeline");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Every registered column is visible in this phase; the column-picker view
  // system arrives later. The select rail leads, in registry order.
  const visibleColumns = useMemo(() => PIPELINE_TABLE_COLUMNS, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const updateWidth = () => setContainerWidth(element.clientWidth);
    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columnLayouts = useMemo<PipelineTableColumnLayout[]>(() => {
    const baseWidths = visibleColumns.map((column) => getColumnWidth(column, metrics.columnScale));
    const baseTotalWidth = baseWidths.reduce((sum, width) => sum + width, 0);
    const stretchIndex = baseWidths.length - 1;
    const extraWidth = Math.max(0, containerWidth - baseTotalWidth);
    let stickyOffset = 0;

    return visibleColumns.map((column, index) => {
      const width = baseWidths[index] + (index === stretchIndex ? extraWidth : 0);
      const stickyLeft = column.frozen ? stickyOffset : null;
      if (column.frozen) stickyOffset += width;
      return { column, width, stickyLeft };
    });
  }, [containerWidth, metrics.columnScale, visibleColumns]);

  const totalWidth = useMemo(
    () => columnLayouts.reduce((sum, item) => sum + item.width, 0),
    [columnLayouts],
  );

  // ── Flattened render stream (the SINGLE virtualizer's source of truth) ──────
  // Group headers are interleaved as items IN the stream (never CSS-sticky in a
  // table) — the safe pattern for grouped + virtualized lists. In flat mode this
  // is a 1:1 passthrough of `rows` to data items. Collapsed stages contribute
  // only their header; their data rows are simply absent (not rendered).
  const flatItems = useMemo(
    () => buildFlattenedRows(rows, { grouped, collapsedStages }),
    [rows, grouped, collapsedStages],
  );

  // The actually-rendered data rows — every `data` item in the stream, which
  // EXCLUDES collapsed stages' rows. Drives the header checkbox's checked state:
  // it reads checked only when every RENDERED row is selected, so a collapsed
  // stage's hidden rows (which persist in the selection) never prop the checkbox
  // and never count against it. The shell scopes its select-all to this same
  // rendered set; selection itself persists across collapse (the shell hands the
  // selection hook the FULL post-search set, so collapse never prunes).
  const visibleDataRows = useMemo(
    () => flatItems.flatMap((item) => (item.kind === "data" ? [item.row] : [])),
    [flatItems],
  );

  const allVisibleSelected =
    visibleDataRows.length > 0 && visibleDataRows.every((row) => selectedIds.has(row.id));

  // Stable per-item key so the virtualizer's index→key map survives count
  // changes (collapse/expand, refetch): data rows key on their row id, headers
  // on their stage. Stable identity is what keeps collapsing a group from
  // jumping scroll or reshuffling surviving rows.
  const getItemKey = useCallback(
    (index: number) => {
      const item = flatItems[index];
      if (!item) return index;
      return item.kind === "group-header" ? `group-header:${item.stage}` : `data:${item.row.id}`;
    },
    [flatItems],
  );

  // ONE virtualizer over the flattened array. Item heights are deterministic per
  // kind — group headers are GROUP_HEADER_HEIGHT, data rows are metrics.rowHeight
  // — so `estimateSize` is exact and we never need dynamic measureElement. The
  // virtualizer computes each item's `start` offset from these fixed sizes.
  const rowVirtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize: (index) =>
      flatItems[index]?.kind === "group-header"
        ? GROUP_HEADER_HEIGHT
        : metrics.rowHeight,
    overscan: 12,
  });

  // Force a full re-measure when the per-index size formula changes. The
  // virtualizer memoizes measurements on count + item-key identity, NOT on the
  // `estimateSize` closure, so a density change (rowHeight) or a re-flatten that
  // keeps the same count (e.g. a stage's rows swapped 1:1) would otherwise reuse
  // stale offsets. `measure()` resets the size cache so every item's start is
  // recomputed from the current `estimateSize`. Keyed on the row height and the
  // flattened stream identity (the two inputs `estimateSize` reads).
  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowVirtualizer, metrics.rowHeight, flatItems]);

  const handleSortChange = useCallback(
    (column: PipelineTableColumnConfig) => {
      if (!column.sortable) return;
      const active = sorting[0];
      if (!active || active.field !== column.id) {
        onSortingChange([{ field: column.id, direction: "asc" }]);
        return;
      }
      if (active.direction === "asc") {
        onSortingChange([{ field: column.id, direction: "desc" }]);
        return;
      }
      onSortingChange([]);
    },
    [onSortingChange, sorting],
  );

  // The checkbox is a pure toggle: the shell owns the select-vs-deselect
  // direction (and scopes it to rendered rows, leaving collapsed selections
  // intact), so this just forwards the intent. `allVisibleSelected` still drives
  // the checkbox's checked visual below.
  const handleToggleSelectAllVisible = useCallback(() => {
    onToggleSelectAllVisible();
  }, [onToggleSelectAllVisible]);

  // Grid-container keydown. Cell-focused keystrokes are handled by each cell's
  // own `onCellKeyDown` and bubble up here; we only act when the grid container
  // ITSELF is the target (focus on the grid chrome, not a specific cell) — then
  // we route the keystroke through the active cell's coordinate so the global
  // shortcuts (⌘Z / ⌘F / ⌘A) and arrow keys still work. Guarding on
  // `target === currentTarget` prevents double-processing bubbled cell events.
  const handleGridKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      if (!activeCell) return;
      onCellKeyDown(activeCell.rowId, activeCell.columnId, event);
    },
    [activeCell, onCellKeyDown],
  );

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label={t("table.gridLabel")}
      aria-rowcount={visibleDataRows.length}
      tabIndex={0}
      onKeyDown={handleGridKeyDown}
      className="min-h-0 flex-1 overflow-auto"
    >
      {aboveHeader}
      <div style={{ width: totalWidth }}>
        <PipelineTableHeader
          columns={columnLayouts}
          metrics={metrics}
          sorting={sorting}
          canManage={canManage}
          allVisibleSelected={allVisibleSelected}
          onSortChange={handleSortChange}
          onToggleSelectAllVisible={handleToggleSelectAllVisible}
        />
        <div
          className="relative"
          style={{
            height: rowVirtualizer.getTotalSize(),
            width: totalWidth,
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const item = flatItems[virtualRow.index];
            if (!item) return null;

            // Derive the React key from the SAME function the virtualizer keys on
            // (`getItemKey`), so the element key and the virtualizer's index→key
            // map can never drift out of sync.
            const key = getItemKey(virtualRow.index);

            if (item.kind === "group-header") {
              return (
                <PipelineStageGroupHeader
                  key={key}
                  stage={item.stage}
                  count={item.count}
                  sumValue={item.sumValue}
                  sumWeighted={item.sumWeighted}
                  collapsed={item.collapsed}
                  virtualStart={virtualRow.start}
                  totalWidth={totalWidth}
                  onToggle={onToggleStageCollapse}
                />
              );
            }

            const row = item.row;
            return (
              <PipelineTableRow
                key={key}
                row={row}
                columns={columnLayouts}
                metrics={metrics}
                selected={selectedIds.has(row.id)}
                virtualStart={virtualRow.start}
                totalWidth={totalWidth}
                now={now}
                saveStates={saveStates}
                activeCell={activeCell}
                editingCell={editingCell}
                canManage={canManage}
                setActiveCell={setActiveCell}
                onToggleRow={onToggleRow}
                onOpenDeal={onOpenDeal}
                onBeginEdit={onBeginEdit}
                onCancelEdit={onCancelEdit}
                onCellKeyDown={onCellKeyDown}
                onCommitCell={onCommitCell}
                onRequestStageChange={onRequestStageChange}
                onRequestConvertAlreadyWon={onRequestConvertAlreadyWon}
              />
            );
          })}
        </div>
        <div
          aria-hidden="true"
          className="h-12 bg-gradient-to-b from-transparent via-background/70 to-background"
          style={{ width: totalWidth }}
        />
      </div>
    </div>
  );
}
