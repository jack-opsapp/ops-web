"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
  type ReactNode,
  type TouchEventHandler,
  type WheelEventHandler,
} from "react";
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDictionary } from "@/i18n/client";
import type { ProjectTableSaveState } from "@/lib/hooks/projects-table/use-cell-edit";
import { useTableKeyboardNav } from "@/lib/hooks/projects-table/use-table-keyboard-nav";
import {
  PROJECT_TABLE_COLUMN_IDS,
  PROJECT_TABLE_COLUMNS,
  type ProjectTableColumnConfig,
  type ProjectTableColumnId,
  type ProjectTableEditableColumnId,
  type ProjectTableEditValue,
  type ProjectTableRow,
  type ProjectTableSort,
  type ProjectTableViewDefinition,
} from "@/lib/types/project-table";
import { useWindowStore } from "@/stores/window-store";
import { ProjectsTableHeader } from "./projects-table-header";
import { ProjectsTableRow } from "./projects-table-row";

const FALLBACK_COLUMN_IDS: ProjectTableColumnId[] = ["name", "status", "client", "end_date", "next_task", "progress"];

export interface ProjectsTableMetrics {
  zoom: number;
  density: "compact" | "comfortable" | "spacious";
  rowHeight: number;
  headerHeight: number;
  fontSize: number;
  microFontSize: number;
  avatarSize: number;
  columnScale: number;
}

export interface ProjectTableColumnLayout {
  column: ProjectTableColumnConfig;
  width: number;
  stickyLeft: number | null;
}

function getColumnWidth(column: ProjectTableColumnConfig, scale: number): number {
  const scaled = Math.round(column.width * scale);
  return Math.min(column.maxWidth, Math.max(column.minWidth, scaled));
}

function isColumnId(value: unknown): value is ProjectTableColumnId {
  return (
    typeof value === "string" &&
    (PROJECT_TABLE_COLUMN_IDS as readonly string[]).includes(value)
  );
}

function getVisibleColumns(view: ProjectTableViewDefinition): ProjectTableColumnConfig[] {
  const safeColumnIds = view.columns.filter(
    (columnId): columnId is ProjectTableColumnId =>
      isColumnId(columnId) && columnId !== "select",
  );
  const viewColumnIds = safeColumnIds.length > 0 ? safeColumnIds : FALLBACK_COLUMN_IDS;
  const visibleSet = new Set<ProjectTableColumnId>(viewColumnIds);
  return PROJECT_TABLE_COLUMNS.filter((column) => column.id === "select" || visibleSet.has(column.id));
}

export function ProjectsTable({
  view,
  rows,
  sorting,
  onSortingChange,
  metrics,
  selectedIds,
  onToggleRow,
  onSelectAllVisible,
  onClearSelection,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isRefreshing,
  saveStates,
  onCommitCell,
  onUndoLatest,
  onFocusSearch,
  onWheel,
  onZoomKeyDown,
  onBeginPinch,
  onUpdatePinch,
  onEndPinch,
  aboveHeader,
}: {
  view: ProjectTableViewDefinition;
  rows: ProjectTableRow[];
  sorting: ProjectTableSort[];
  onSortingChange: (sorting: ProjectTableSort[]) => void;
  metrics: ProjectsTableMetrics;
  selectedIds: Set<string>;
  onToggleRow: (rowId: string, mode: "single" | "toggle" | "range") => void;
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isRefreshing?: boolean;
  saveStates: Map<string, ProjectTableSaveState>;
  onCommitCell: (
    row: ProjectTableRow,
    columnId: ProjectTableEditableColumnId,
    value: ProjectTableEditValue,
  ) => Promise<void>;
  onUndoLatest: () => void;
  onFocusSearch: () => void;
  onWheel: WheelEventHandler<HTMLDivElement>;
  onZoomKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onBeginPinch: (distance: number) => void;
  onUpdatePinch: (distance: number) => void;
  onEndPinch: () => void;
  /**
   * Optional chrome rendered as the FIRST child inside the scroll container,
   * above the sticky header — the decoupled metrics bar + sticky toolbar
   * (TableChrome). Scrolls with the rows so the metrics scroll up and out of
   * view while the toolbar + header pin (WEB OVERHAUL P6-2 rework). Default
   * undefined → byte-identical legacy render.
   */
  aboveHeader?: ReactNode;
}) {
  const { t } = useDictionary("projects");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [, setOpenActionRowId] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const openProjectWindow = useWindowStore((s) => s.openProjectWindow);

  const visibleColumns = useMemo(() => getVisibleColumns(view), [view]);
  const {
    activeCell,
    editingCell,
    setActiveCell,
    beginEdit,
    cancelEdit,
    handleCellKeyDown,
  } = useTableKeyboardNav({
    rows,
    columns: visibleColumns,
    onUndo: onUndoLatest,
    onFocusSearch,
    onSelectAllVisible,
    onClearSelection,
  });

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

  const columnLayouts = useMemo<ProjectTableColumnLayout[]>(() => {
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

  const totalWidth = useMemo(() => columnLayouts.reduce((sum, item) => sum + item.width, 0), [columnLayouts]);
  const allVisibleSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.id));

  const tableColumns = useMemo<ColumnDef<ProjectTableRow>[]>(
    () =>
      visibleColumns.map((column) => ({
        id: column.id,
        accessorFn: (row) => row.id,
      })),
    [visibleColumns],
  );

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    manualSorting: true,
  });

  const tableRows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => metrics.rowHeight,
    overscan: 12,
  });

  const handleSortChange = useCallback(
    (column: ProjectTableColumnConfig) => {
      if (!column.sortable) return;
      const active = sorting[0];
      if (!active || String(active.field) !== column.id) {
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

  const handleToggleSelectAllVisible = useCallback(() => {
    if (allVisibleSelected) {
      onClearSelection();
      return;
    }
    onSelectAllVisible();
  }, [allVisibleSelected, onClearSelection, onSelectAllVisible]);

  const handleScroll = useCallback(() => {
    setOpenActionRowId(null);
    const element = scrollRef.current;
    if (!element || !hasNextPage || isFetchingNextPage) return;
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining <= metrics.rowHeight * 6) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, metrics.rowHeight]);

  const handleOpenProject = useCallback(
    (projectId: string) => {
      openProjectWindow({ projectId, mode: "viewing" });
      setOpenActionRowId(null);
    },
    [openProjectWindow],
  );

  const handleBeginEdit = useCallback((rowId: string, columnId: ProjectTableEditableColumnId) => {
    beginEdit(rowId, columnId);
  }, [beginEdit]);

  const handleCancelEdit = useCallback(() => {
    cancelEdit();
  }, [cancelEdit]);

  const handleCommitCell = useCallback(
    async (
      row: ProjectTableRow,
      columnId: ProjectTableEditableColumnId,
      value: ProjectTableEditValue,
    ) => {
      await onCommitCell(row, columnId, value);
      cancelEdit({ rowId: row.id, columnId });
    },
    [cancelEdit, onCommitCell],
  );

  const getTouchDistance = (touches: { length: number; item: (index: number) => { clientX: number; clientY: number } | null }): number | null => {
    if (touches.length < 2) return null;
    const a = touches.item(0);
    const b = touches.item(1);
    if (!a || !b) return null;
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };

  const handleTouchStart: TouchEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      const distance = getTouchDistance(event.touches);
      if (distance == null) return;
      onBeginPinch(distance);
    },
    [onBeginPinch],
  );

  const handleTouchMove: TouchEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      const distance = getTouchDistance(event.touches);
      if (distance == null) return;
      event.preventDefault();
      onUpdatePinch(distance);
    },
    [onUpdatePinch],
  );

  const handleTouchEnd: TouchEventHandler<HTMLDivElement> = useCallback(() => {
    onEndPinch();
  }, [onEndPinch]);

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label={t("table.gridLabel")}
      aria-rowcount={rows.length}
      tabIndex={0}
      onScroll={handleScroll}
      onWheel={onWheel}
      onKeyDown={onZoomKeyDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      className="min-h-0 flex-1 overflow-auto"
    >
      {aboveHeader}
      <div style={{ width: totalWidth }}>
        <ProjectsTableHeader
          columns={columnLayouts}
          metrics={metrics}
          sorting={sorting}
          onSortChange={handleSortChange}
          allVisibleSelected={allVisibleSelected}
          onToggleSelectAllVisible={handleToggleSelectAllVisible}
        />
        {isRefreshing ? (
          <div
            aria-hidden="true"
            className="sticky z-40 h-0 overflow-visible"
            style={{ top: metrics.headerHeight, width: totalWidth }}
          >
            <div className="h-px overflow-hidden bg-fill-neutral-dim">
              <div className="h-full w-full animate-pulse bg-gradient-to-r from-transparent via-text-2/40 to-transparent" />
            </div>
          </div>
        ) : null}
        <div
          className="relative"
          style={{
            height: rowVirtualizer.getTotalSize(),
            width: totalWidth,
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const tableRow = tableRows[virtualRow.index];
            if (!tableRow) return null;
            const row = tableRow.original;
            return (
              <ProjectsTableRow
                key={row.id}
                row={row}
                columns={columnLayouts}
                metrics={metrics}
                selected={selectedIds.has(row.id)}
                virtualStart={virtualRow.start}
                totalWidth={totalWidth}
                activeCell={activeCell}
                editingCell={editingCell}
                saveStates={saveStates}
                onToggleRow={onToggleRow}
                onOpenProject={handleOpenProject}
                setActiveCell={setActiveCell}
                onBeginEdit={handleBeginEdit}
                onCancelEdit={handleCancelEdit}
                onCellKeyDown={handleCellKeyDown}
                onCommitCell={handleCommitCell}
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
