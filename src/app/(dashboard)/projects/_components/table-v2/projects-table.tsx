"use client";

import { useCallback, useMemo, useRef, useState, type TouchEventHandler, type WheelEventHandler } from "react";
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { PROJECT_TABLE_COLUMNS, type ProjectTableColumnConfig, type ProjectTableColumnId, type ProjectTableRow, type ProjectTableSort, type ProjectTableViewDefinition } from "@/lib/types/project-table";
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

function getVisibleColumns(view: ProjectTableViewDefinition): ProjectTableColumnConfig[] {
  const viewColumnIds = view.columns.length > 0 ? view.columns : FALLBACK_COLUMN_IDS;
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
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  onWheel,
  onBeginPinch,
  onUpdatePinch,
  onEndPinch,
}: {
  view: ProjectTableViewDefinition;
  rows: ProjectTableRow[];
  sorting: ProjectTableSort[];
  onSortingChange: (sorting: ProjectTableSort[]) => void;
  metrics: ProjectsTableMetrics;
  selectedIds: Set<string>;
  onToggleRow: (rowId: string, mode: "single" | "toggle" | "range") => void;
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onWheel: WheelEventHandler<HTMLDivElement>;
  onBeginPinch: (distance: number) => void;
  onUpdatePinch: (distance: number) => void;
  onEndPinch: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [, setOpenActionRowId] = useState<string | null>(null);
  const openProjectWindow = useWindowStore((s) => s.openProjectWindow);

  const visibleColumns = useMemo(() => getVisibleColumns(view), [view]);

  const columnLayouts = useMemo<ProjectTableColumnLayout[]>(() => {
    let stickyOffset = 0;
    return visibleColumns.map((column) => {
      const width = getColumnWidth(column, metrics.columnScale);
      const stickyLeft = column.frozen ? stickyOffset : null;
      if (column.frozen) stickyOffset += width;
      return { column, width, stickyLeft };
    });
  }, [metrics.columnScale, visibleColumns]);

  const totalWidth = useMemo(() => columnLayouts.reduce((sum, item) => sum + item.width, 0), [columnLayouts]);

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
      onScroll={handleScroll}
      onWheel={onWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      className="min-h-0 flex-1 overflow-auto"
    >
      <div style={{ width: totalWidth, minWidth: "100%" }}>
        <ProjectsTableHeader
          columns={columnLayouts}
          metrics={metrics}
          sorting={sorting}
          onSortChange={handleSortChange}
        />
        <div
          className="relative"
          style={{
            height: rowVirtualizer.getTotalSize(),
            width: totalWidth,
            minWidth: "100%",
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
                onToggleRow={onToggleRow}
                onOpenProject={handleOpenProject}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
