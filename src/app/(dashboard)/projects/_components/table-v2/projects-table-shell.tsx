"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { getProjectTableEditValue, type ProjectTableSort } from "@/lib/types/project-table";
import { useCellEdit } from "@/lib/hooks/projects-table/use-cell-edit";
import { useProjectView } from "@/lib/hooks/projects-table/use-project-view";
import { useProjectViewsList } from "@/lib/hooks/projects-table/use-project-views-list";
import { useProjectsTableData } from "@/lib/hooks/projects-table/use-projects-table-data";
import { useTableSelection } from "@/lib/hooks/projects-table/use-table-selection";
import { useTableZoom } from "@/lib/hooks/projects-table/use-table-zoom";
import { ProjectsConflictOverlay } from "./projects-conflict-overlay";
import { ProjectsBulkBar } from "./projects-bulk-bar";
import { ProjectsEmptyState } from "./projects-empty-state";
import { ProjectsTable } from "./projects-table";
import { ProjectsToolbar } from "./projects-toolbar";
import { ProjectsUndoToast } from "./projects-undo-toast";
import { ProjectsViewTabs } from "./projects-view-tabs";

export function ProjectsTableShell() {
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<ProjectTableSort[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const viewsQuery = useProjectViewsList();
  const { activeView, activeViewId, setActiveViewId } = useProjectView(viewsQuery.data);
  const tableQuery = useProjectsTableData({ view: activeView, search, sorting });
  const cellEdit = useCellEdit({ rows: tableQuery.rows, refetchRows: tableQuery.refetch });
  const zoom = useTableZoom(activeView?.zoomLevel ?? 1);

  const visibleRowIds = useMemo(() => tableQuery.rows.map((row) => row.id), [tableQuery.rows]);
  const selectionResetKey = useMemo(
    () =>
      JSON.stringify({
        activeViewId,
        search,
        sorting,
        filters: activeView?.filters ?? null,
      }),
    [activeView?.filters, activeViewId, search, sorting],
  );
  const selection = useTableSelection(visibleRowIds, selectionResetKey);
  const visibleSelectedCount = useMemo(
    () => visibleRowIds.filter((rowId) => selection.selectedIds.has(rowId)).length,
    [selection.selectedIds, visibleRowIds],
  );
  const views = viewsQuery.data ?? [];
  const isLoading = viewsQuery.isLoading || (Boolean(activeView) && tableQuery.isLoading);
  const isError = viewsQuery.isError || tableQuery.isError;
  const currentConflictValue = useMemo(() => {
    const conflict = cellEdit.conflict;
    if (!conflict) return null;
    const row = tableQuery.rows.find((candidate) => candidate.id === conflict.rowId);
    if (!row) return null;
    return getProjectTableEditValue(row, conflict.columnId);
  }, [cellEdit.conflict, tableQuery.rows]);

  const handleRetry = () => {
    void viewsQuery.refetch();
    void tableQuery.refetch();
  };

  const { undoLatest } = cellEdit;
  const handleUndoLatest = useCallback(() => {
    void undoLatest();
  }, [undoLatest]);

  const handleFocusSearch = useCallback(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);

  let body = null;
  if (isError) {
    body = <ProjectsEmptyState mode="error" onRetry={handleRetry} />;
  } else if (isLoading) {
    body = <ProjectsEmptyState mode="loading" />;
  } else if (!activeView) {
    body = <ProjectsEmptyState mode="empty" />;
  } else if (tableQuery.rows.length === 0) {
    body = <ProjectsEmptyState mode={search.trim().length > 0 ? "filtered" : "empty"} />;
  } else {
    body = (
      <ProjectsTable
        view={activeView}
        rows={tableQuery.rows}
        sorting={sorting}
        onSortingChange={setSorting}
        metrics={zoom.metrics}
        selectedIds={selection.selectedIds}
        onToggleRow={selection.toggleRow}
        onSelectAllVisible={selection.selectAllVisible}
        onClearSelection={selection.clearSelection}
        saveStates={cellEdit.saveStates}
        onCommitCell={cellEdit.commitEdit}
        onUndoLatest={handleUndoLatest}
        onFocusSearch={handleFocusSearch}
        fetchNextPage={() => {
          void tableQuery.fetchNextPage();
        }}
        hasNextPage={Boolean(tableQuery.hasNextPage)}
        isFetchingNextPage={tableQuery.isFetchingNextPage}
        onWheel={zoom.handleWheel}
        onBeginPinch={zoom.beginPinch}
        onUpdatePinch={zoom.updatePinch}
        onEndPinch={zoom.endPinch}
      />
    );
  }

  return (
    <div className="glass-surface relative flex h-full min-h-0 flex-col overflow-hidden rounded-panel border border-border">
      <ProjectsViewTabs views={views} activeViewId={activeViewId} onViewChange={setActiveViewId} />
      <ProjectsToolbar
        search={search}
        onSearchChange={setSearch}
        rowCount={tableQuery.rows.length}
        totalCount={tableQuery.totalCount}
        zoom={zoom.zoom}
        searchInputRef={searchInputRef}
      />
      {body}
      {visibleSelectedCount > 0 ? (
        <ProjectsBulkBar
          visibleRows={tableQuery.rows}
          selectedIds={selection.selectedIds}
          onClearSelection={selection.clearSelection}
          recordBulkUndo={cellEdit.pushBulkUndo}
        />
      ) : null}
      <ProjectsUndoToast
        entry={cellEdit.latestUndo}
        onUndo={handleUndoLatest}
        onDismiss={cellEdit.clearLatestUndo}
      />
      <ProjectsConflictOverlay
        conflict={cellEdit.conflict}
        currentValue={currentConflictValue}
        onUseMine={cellEdit.resolveConflictUseMine}
        onUseCurrent={cellEdit.resolveConflictUseCurrent}
        onCancel={cellEdit.cancelConflict}
      />
    </div>
  );
}
