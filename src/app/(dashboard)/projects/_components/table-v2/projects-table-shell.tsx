"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Save } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import {
  PROJECT_TABLE_COLUMN_IDS,
  getProjectTableEditValue,
  type ProjectTableColumnId,
  type ProjectTableSort,
} from "@/lib/types/project-table";
import { useCellEdit } from "@/lib/hooks/projects-table/use-cell-edit";
import { useProjectView } from "@/lib/hooks/projects-table/use-project-view";
import { useProjectViewActions } from "@/lib/hooks/projects-table/use-project-view-actions";
import { useProjectViewsList } from "@/lib/hooks/projects-table/use-project-views-list";
import { useProjectsTableData } from "@/lib/hooks/projects-table/use-projects-table-data";
import { useTableSelection } from "@/lib/hooks/projects-table/use-table-selection";
import { useTableZoom } from "@/lib/hooks/projects-table/use-table-zoom";
import type {
  ProjectTableDensity,
  ProjectTableViewDefinition,
  ProjectTableViewDefinitionInput,
  ProjectTableViewMutationErrorCode,
} from "@/lib/types/project-table";
import { ProjectsConflictOverlay } from "./projects-conflict-overlay";
import { ProjectsBulkBar } from "./projects-bulk-bar";
import { ProjectsDensityControl } from "./projects-density-control";
import { ProjectsEmptyState } from "./projects-empty-state";
import { ProjectsTable } from "./projects-table";
import { ProjectsToolbar } from "./projects-toolbar";
import { ProjectsUndoToast } from "./projects-undo-toast";
import { ProjectsViewCreateDialog } from "./projects-view-create-dialog";
import { ProjectsViewSettingsMenu } from "./projects-view-settings-menu";
import { ProjectsViewTabs } from "./projects-view-tabs";

function sortProjectViews(views: ProjectTableViewDefinition[]) {
  return [...views].sort((a, b) => {
    if (a.sortPosition !== b.sortPosition) return a.sortPosition - b.sortPosition;
    return a.name.localeCompare(b.name);
  });
}

function upsertProjectView(
  views: ProjectTableViewDefinition[],
  view: ProjectTableViewDefinition,
) {
  const index = views.findIndex((candidate) => candidate.id === view.id);
  if (index === -1) return sortProjectViews([...views, view]);
  const next = [...views];
  next[index] = view;
  return sortProjectViews(next);
}

function pickFallbackView(views: ProjectTableViewDefinition[]) {
  return views.find((view) => view.isDefault) ?? views[0] ?? null;
}

function ProjectsViewState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-start p-6 font-mono text-micro uppercase tracking-wider text-text-3">
      {label}
    </div>
  );
}

function getViewMutationErrorCode(error: unknown): ProjectTableViewMutationErrorCode {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (
      code === "DUPLICATE_NAME" ||
      code === "PERMISSION_DENIED" ||
      code === "INVALID_INPUT" ||
      code === "UNKNOWN"
    ) {
      return code;
    }
  }
  return "UNKNOWN";
}

function densityErrorCopyKey(error: unknown) {
  return getViewMutationErrorCode(error) === "PERMISSION_DENIED"
    ? "table.density.errorPermissionDenied"
    : "table.density.errorGeneric";
}

function viewPersistenceErrorCopyKey(error: unknown) {
  switch (getViewMutationErrorCode(error)) {
    case "DUPLICATE_NAME":
      return "table.views.errorDuplicateName";
    case "PERMISSION_DENIED":
      return "table.views.errorPermissionDenied";
    case "INVALID_INPUT":
      return "table.views.errorTooComplex";
    case "UNKNOWN":
      return "table.views.errorGeneric";
  }
}

function stableDefinitionKey(value: unknown) {
  return JSON.stringify(value);
}

function isColumnId(value: unknown): value is ProjectTableColumnId {
  return (
    typeof value === "string" &&
    (PROJECT_TABLE_COLUMN_IDS as readonly string[]).includes(value)
  );
}

function sanitizeColumns(columns: readonly unknown[] | undefined) {
  if (!columns) return [];
  const seen = new Set<ProjectTableColumnId>();
  const safeColumns: ProjectTableColumnId[] = [];

  for (const column of columns) {
    if (!isColumnId(column) || column === "select" || seen.has(column)) continue;
    seen.add(column);
    safeColumns.push(column);
  }

  return safeColumns;
}

function sanitizeSort(sort: readonly ProjectTableSort[] | undefined) {
  if (!sort) return [];
  return sort.filter(
    (item): item is ProjectTableSort =>
      Boolean(item) &&
      isColumnId(item.field) &&
      item.field !== "select" &&
      (item.direction === "asc" || item.direction === "desc"),
  );
}

function buildViewDefinitionInput(
  view: ProjectTableViewDefinition,
  sort: ProjectTableSort[],
): ProjectTableViewDefinitionInput {
  return {
    columns: sanitizeColumns(view.columns),
    filters: view.filters,
    sort: sanitizeSort(sort),
    density: view.density,
    zoomLevel: view.zoomLevel,
  };
}

function buildComparableDefinition(
  view: ProjectTableViewDefinition,
  sort: ProjectTableSort[],
) {
  return {
    columns: sanitizeColumns(view.columns),
    filters: view.filters,
    sort: sanitizeSort(sort),
  };
}

export function ProjectsTableShell() {
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<ProjectTableSort[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [managedViews, setManagedViews] = useState<ProjectTableViewDefinition[] | null>(null);
  const [pendingActiveViewId, setPendingActiveViewId] = useState<string | null>(null);
  const [densityErrorKey, setDensityErrorKey] = useState<string | null>(null);
  const [densitySaving, setDensitySaving] = useState(false);
  const [viewSaveErrorKey, setViewSaveErrorKey] = useState<string | null>(null);
  const [viewDefinitionSaving, setViewDefinitionSaving] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const { t } = useDictionary("projects");
  const viewsQuery = useProjectViewsList();

  useEffect(() => {
    if (viewsQuery.data) setManagedViews(viewsQuery.data);
  }, [viewsQuery.data]);

  const views = (managedViews ?? viewsQuery.data ?? []).filter((view) => view.isArchived !== true);
  const { activeView, activeViewId, setActiveViewId, unavailableView } = useProjectView(views);
  const viewActions = useProjectViewActions({ views, activeViewId, setActiveViewId });
  const [unavailableViewId, setUnavailableViewId] = useState<string | null>(null);
  const savedActiveView = useMemo(
    () => views.find((view) => view.id === activeViewId) ?? null,
    [activeViewId, views],
  );
  const activeViewSortKey = useMemo(
    () => stableDefinitionKey(activeView?.sort ?? []),
    [activeView?.sort],
  );

  useEffect(() => {
    setSorting(activeView?.sort ?? []);
  }, [activeView?.id, activeViewSortKey]);

  useEffect(() => {
    if (unavailableView) setUnavailableViewId(unavailableView.viewId);
  }, [unavailableView]);

  useEffect(() => {
    if (!pendingActiveViewId) return;
    if (!views.some((view) => view.id === pendingActiveViewId)) return;
    setActiveViewId(pendingActiveViewId);
    setPendingActiveViewId(null);
  }, [pendingActiveViewId, setActiveViewId, views]);

  const sanitizedSorting = useMemo(() => sanitizeSort(sorting), [sorting]);
  const pendingEffectiveView = useMemo<ProjectTableViewDefinition | null>(() => {
    if (!activeView) return null;
    return {
      ...activeView,
      columns: sanitizeColumns(activeView.columns),
      sort: sanitizedSorting,
    };
  }, [activeView, sanitizedSorting]);
  const pendingDefinition = useMemo(
    () =>
      pendingEffectiveView
        ? buildViewDefinitionInput(pendingEffectiveView, sanitizedSorting)
        : null,
    [pendingEffectiveView, sanitizedSorting],
  );
  const pendingDefinitionKey = useMemo(
    () =>
      pendingEffectiveView
        ? stableDefinitionKey(buildComparableDefinition(pendingEffectiveView, sanitizedSorting))
        : "",
    [pendingEffectiveView, sanitizedSorting],
  );
  const savedDefinitionKey = useMemo(
    () =>
      savedActiveView
        ? stableDefinitionKey(buildComparableDefinition(savedActiveView, savedActiveView.sort))
        : "",
    [savedActiveView],
  );
  const hasUnsavedDefinition = Boolean(
    pendingEffectiveView &&
      savedActiveView &&
      pendingDefinitionKey !== savedDefinitionKey,
  );
  const tableView = useMemo<ProjectTableViewDefinition | null>(() => {
    if (!pendingEffectiveView) return null;
    return {
      ...pendingEffectiveView,
      updatedAt: `${pendingEffectiveView.updatedAt}:${pendingDefinitionKey}`,
    };
  }, [pendingDefinitionKey, pendingEffectiveView]);
  const tableQuery = useProjectsTableData({ view: tableView, search, sorting: sanitizedSorting });
  const cellEdit = useCellEdit({ rows: tableQuery.rows, refetchRows: tableQuery.refetch });

  const visibleRowIds = useMemo(() => tableQuery.rows.map((row) => row.id), [tableQuery.rows]);
  const selectionResetKey = useMemo(
    () =>
      JSON.stringify({
        activeViewId,
        search,
        definition: pendingDefinitionKey,
      }),
    [activeViewId, pendingDefinitionKey, search],
  );
  const selection = useTableSelection(visibleRowIds, selectionResetKey);
  const visibleSelectedCount = useMemo(
    () => visibleRowIds.filter((rowId) => selection.selectedIds.has(rowId)).length,
    [selection.selectedIds, visibleRowIds],
  );
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

  const handleViewCreated = useCallback(
    (view: ProjectTableViewDefinition) => {
      setManagedViews((currentViews) => upsertProjectView(currentViews ?? views, view));
      setUnavailableViewId(null);
      setPendingActiveViewId(view.id);
    },
    [views],
  );

  const handleViewChange = useCallback(
    (viewId: string) => {
      setUnavailableViewId(null);
      setActiveViewId(viewId);
    },
    [setActiveViewId],
  );

  const handleViewUpdated = useCallback(
    (view: ProjectTableViewDefinition) => {
      setManagedViews((currentViews) => upsertProjectView(currentViews ?? views, view));
    },
    [views],
  );

  const persistPendingViewDefinition = useCallback(async () => {
    if (!pendingEffectiveView || !pendingDefinition) return null;

    setViewDefinitionSaving(true);
    setViewSaveErrorKey(null);
    try {
      const updatedView = await viewActions.updateViewDefinition.mutateAsync({
        viewId: pendingEffectiveView.id,
        definition: pendingDefinition,
      });
      handleViewUpdated(updatedView);
      setSorting(updatedView.sort);
      return updatedView;
    } catch (error) {
      setViewSaveErrorKey(viewPersistenceErrorCopyKey(error));
      throw error;
    } finally {
      setViewDefinitionSaving(false);
    }
  }, [
    handleViewUpdated,
    pendingDefinition,
    pendingEffectiveView,
    viewActions.updateViewDefinition,
  ]);

  const handleDensityPersist = useCallback(
    async ({
      density,
      zoomLevel,
    }: {
      density: ProjectTableDensity;
      zoomLevel: number;
    }) => {
      if (!activeView) return;

      setDensitySaving(true);
      setDensityErrorKey(null);
      try {
        const updatedView = await viewActions.updateViewDefinition.mutateAsync({
          viewId: activeView.id,
          definition: { density, zoomLevel },
        });
        handleViewUpdated(updatedView);
      } catch (error) {
        setDensityErrorKey(densityErrorCopyKey(error));
        throw error;
      } finally {
        setDensitySaving(false);
      }
    },
    [activeView, handleViewUpdated, viewActions.updateViewDefinition],
  );

  const zoom = useTableZoom({
    initialDensity: activeView?.density ?? "comfortable",
    initialZoom: activeView?.zoomLevel ?? 1,
    onPersistDensity: handleDensityPersist,
    onPersistError: (error) => setDensityErrorKey(densityErrorCopyKey(error)),
  });

  useEffect(() => {
    setDensityErrorKey(null);
    setViewSaveErrorKey(null);
  }, [activeViewId]);

  const viewActionsWithPendingDefinition = useMemo(
    () => ({
      ...viewActions,
      shareViewWithTeam: {
        ...viewActions.shareViewWithTeam,
        mutateAsync: async (input: { viewId: string }) => {
          if (hasUnsavedDefinition) {
            await persistPendingViewDefinition();
          }
          return viewActions.shareViewWithTeam.mutateAsync(input);
        },
      },
    }),
    [hasUnsavedDefinition, persistPendingViewDefinition, viewActions],
  );

  const handleViewArchived = useCallback(
    (viewId: string) => {
      const remainingViews = views.filter((view) => view.id !== viewId);
      setManagedViews(remainingViews);

      if (activeViewId === viewId) {
        const fallbackView = pickFallbackView(remainingViews);
        if (fallbackView) setActiveViewId(fallbackView.id);
      }
    },
    [activeViewId, setActiveViewId, views],
  );

  let body = null;
  if (viewsQuery.isError) {
    body = <ProjectsViewState label={t("table.views.error")} />;
  } else if (viewsQuery.isLoading) {
    body = <ProjectsViewState label={t("table.views.loading")} />;
  } else if (views.length === 0) {
    body = <ProjectsViewState label={t("table.views.empty")} />;
  } else if (isError) {
    body = <ProjectsEmptyState mode="error" onRetry={handleRetry} />;
  } else if (isLoading) {
    body = <ProjectsEmptyState mode="loading" />;
  } else if (!pendingEffectiveView) {
    body = <ProjectsEmptyState mode="empty" />;
  } else if (tableQuery.rows.length === 0) {
    body = <ProjectsEmptyState mode={search.trim().length > 0 ? "filtered" : "empty"} />;
  } else {
    body = (
      <ProjectsTable
        view={pendingEffectiveView}
        rows={tableQuery.rows}
        sorting={sanitizedSorting}
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
        onZoomKeyDown={zoom.handleKeyDown}
      />
    );
  }

  return (
    <div className="glass-surface relative flex h-full min-h-0 flex-col overflow-hidden rounded-panel border border-border">
      <ProjectsViewTabs
        views={views}
        activeViewId={activeViewId}
        onViewChange={handleViewChange}
        onCreateView={() => setCreateDialogOpen(true)}
        isLoading={viewsQuery.isLoading}
        isError={viewsQuery.isError}
      />
      <ProjectsToolbar
        search={search}
        onSearchChange={setSearch}
        rowCount={tableQuery.rows.length}
        totalCount={tableQuery.totalCount}
        searchInputRef={searchInputRef}
        densityControl={
          pendingEffectiveView ? (
            <>
              {hasUnsavedDefinition ? (
                <button
                  type="button"
                  disabled={viewDefinitionSaving || viewActions.updateViewDefinition.isPending}
                  onClick={() => {
                    void persistPendingViewDefinition();
                  }}
                  className="inline-flex h-7 items-center gap-1 rounded-[5px] border border-ops-accent px-2 font-cakemono text-[12px] font-light uppercase text-ops-accent transition-colors hover:bg-ops-accent hover:text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent disabled:pointer-events-none disabled:opacity-40"
                >
                  <Save className="h-3.5 w-3.5" />
                  {t("table.views.save")}
                </button>
              ) : null}
              {viewSaveErrorKey ? (
                <span role="alert" className="font-mono text-micro text-rose">
                  {t(viewSaveErrorKey)}
                </span>
              ) : null}
              <ProjectsDensityControl
                density={zoom.density}
                zoom={zoom.zoom}
                disabled={densitySaving || viewActions.updateViewDefinition.isPending}
                errorKey={densityErrorKey}
                onDensityChange={(density) => {
                  void zoom.setPreset(density);
                }}
              />
            </>
          ) : null
        }
        viewSettings={
          <ProjectsViewSettingsMenu
            activeView={pendingEffectiveView}
            actions={viewActionsWithPendingDefinition}
            onViewRenamed={handleViewUpdated}
            onViewDuplicated={handleViewCreated}
            onViewArchived={handleViewArchived}
            onViewReset={handleViewUpdated}
            onViewShared={handleViewUpdated}
          />
        }
      />
      {unavailableViewId ? (
        <div
          role="alert"
          className="border-b border-border px-3 py-1.5 font-mono text-micro uppercase tracking-wider text-rose"
        >
          {t("table.views.unavailable")}
        </div>
      ) : null}
      <ProjectsViewCreateDialog
        open={createDialogOpen}
        mode="create"
        activeView={pendingEffectiveView}
        actions={viewActions}
        onOpenChange={setCreateDialogOpen}
        onViewCreated={handleViewCreated}
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
