"use client";

import { useMemo, useState } from "react";
import type { ProjectTableSort } from "@/lib/types/project-table";
import { useProjectView } from "@/lib/hooks/projects-table/use-project-view";
import { useProjectViewsList } from "@/lib/hooks/projects-table/use-project-views-list";
import { useProjectsTableData } from "@/lib/hooks/projects-table/use-projects-table-data";
import { useTableSelection } from "@/lib/hooks/projects-table/use-table-selection";
import { useTableZoom } from "@/lib/hooks/projects-table/use-table-zoom";
import { ProjectsEmptyState } from "./projects-empty-state";
import { ProjectsTable } from "./projects-table";
import { ProjectsToolbar } from "./projects-toolbar";
import { ProjectsViewTabs } from "./projects-view-tabs";

export function ProjectsTableShell() {
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<ProjectTableSort[]>([]);
  const viewsQuery = useProjectViewsList();
  const { activeView, activeViewId, setActiveViewId } = useProjectView(viewsQuery.data);
  const tableQuery = useProjectsTableData({ view: activeView, search, sorting });
  const zoom = useTableZoom(activeView?.zoomLevel ?? 1);

  const visibleRowIds = useMemo(() => tableQuery.rows.map((row) => row.id), [tableQuery.rows]);
  const selection = useTableSelection(visibleRowIds);
  const views = viewsQuery.data ?? [];
  const isLoading = viewsQuery.isLoading || (Boolean(activeView) && tableQuery.isLoading);
  const isError = viewsQuery.isError || tableQuery.isError;

  const handleRetry = () => {
    void viewsQuery.refetch();
    void tableQuery.refetch();
  };

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
    <div className="glass-surface flex h-full min-h-0 flex-col overflow-hidden rounded-panel border border-border">
      <ProjectsViewTabs views={views} activeViewId={activeViewId} onViewChange={setActiveViewId} />
      <ProjectsToolbar
        search={search}
        onSearchChange={setSearch}
        rowCount={tableQuery.rows.length}
        totalCount={tableQuery.totalCount}
        zoom={zoom.zoom}
      />
      {body}
    </div>
  );
}
