"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Save } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { useTableZoom } from "@/lib/hooks/projects-table/use-table-zoom";
import { useTableSelection } from "@/lib/hooks/projects-table/use-table-selection";
import { usePipelineTableData } from "@/lib/hooks/pipeline-table/use-pipeline-table-data";
import { useOpportunityCellEdit } from "@/lib/hooks/pipeline-table/use-opportunity-cell-edit";
import { usePipelineTableKeyboardNav } from "@/lib/hooks/pipeline-table/use-pipeline-table-keyboard-nav";
import { useOpportunities } from "@/lib/hooks";
import { useOpportunityView } from "@/lib/hooks/pipeline-table/use-opportunity-view";
import { useOpportunityViewActions } from "@/lib/hooks/pipeline-table/use-opportunity-view-actions";
import { useOpportunityViewsList } from "@/lib/hooks/pipeline-table/use-opportunity-views-list";
import { usePermissionStore } from "@/lib/store/permissions-store";
import type { ProjectTableDensity } from "@/lib/types/project-table";
import type { OpportunityStage } from "@/lib/types/pipeline";
import {
  PIPELINE_TABLE_COLUMN_IDS,
  PIPELINE_TABLE_COLUMNS,
  type OpportunityViewDefinition,
  type OpportunityViewMutationErrorCode,
  type PipelineTableColumnId,
  type PipelineTableEditableColumnId,
  type PipelineTableEditValue,
  type PipelineTableSort,
} from "@/lib/types/pipeline-table";
import { buildFlattenedRows, grandTotal } from "@/lib/utils/pipeline-table-grouping";
import { usePipelineModeStore } from "../pipeline-mode-store";
import { StageTransitionDialog } from "../stage-transition-dialog";
import { useStageTransition } from "../use-stage-transition";
import { PipelineBulkBar } from "./pipeline-bulk-bar";
import { PipelineTable } from "./pipeline-table";
import { PipelineTableFooter } from "./pipeline-table-footer";
import { PipelineToolbar } from "./pipeline-toolbar";
import { PipelineUndoToast } from "./pipeline-undo-toast";
import { PipelineViewCreateDialog } from "./pipeline-view-create-dialog";
import { PipelineViewSettingsMenu } from "./pipeline-view-settings-menu";
import { PipelineViewTabs } from "./pipeline-view-tabs";
import { TableShell } from "@/components/ui/table-shell";
import { MetricsStrip, fromMetricColumns } from "@/components/ui/metrics-strip";
import type { MetricColumnConfig } from "@/components/metrics/types";

// Stable empty collapsed-stage set. Used to derive the selection-order list
// (`selectableRowIds`) from `buildFlattenedRows` with grouping applied but NO
// stage treated as collapsed — so the list keeps every filtered row (selection
// persistence) yet is ordered exactly as the grouped table renders (range math).
// Module-level so the reference never changes across renders (stable memo dep).
const EMPTY_COLLAPSED_STAGES: ReadonlySet<OpportunityStage> = new Set();

// ── Saved-view helpers ───────────────────────────────────────────────────────
// Mirror the projects shell's view-list bookkeeping (sort by position/name,
// optimistic upsert, default fallback) and the sort sanitizer used both to
// compare pending-vs-saved sort (the Save affordance) and to persist a clean
// definition back to the view.

function sortOpportunityViews(views: OpportunityViewDefinition[]) {
  return [...views].sort((a, b) => {
    if (a.sortPosition !== b.sortPosition) return a.sortPosition - b.sortPosition;
    return a.name.localeCompare(b.name);
  });
}

function upsertOpportunityView(
  views: OpportunityViewDefinition[],
  view: OpportunityViewDefinition,
) {
  const index = views.findIndex((candidate) => candidate.id === view.id);
  if (index === -1) return sortOpportunityViews([...views, view]);
  const next = [...views];
  next[index] = view;
  return sortOpportunityViews(next);
}

function pickFallbackView(views: OpportunityViewDefinition[]) {
  return views.find((view) => view.isDefault) ?? views[0] ?? null;
}

function isColumnId(value: unknown): value is PipelineTableColumnId {
  return (
    typeof value === "string" &&
    (PIPELINE_TABLE_COLUMN_IDS as readonly string[]).includes(value)
  );
}

function sanitizeSort(sort: readonly PipelineTableSort[] | undefined) {
  if (!sort) return [];
  return sort.filter(
    (item): item is PipelineTableSort =>
      Boolean(item) &&
      isColumnId(item.field) &&
      item.field !== "select" &&
      (item.direction === "asc" || item.direction === "desc"),
  );
}

function stableKey(value: unknown) {
  return JSON.stringify(value);
}

function getViewMutationErrorCode(error: unknown): OpportunityViewMutationErrorCode {
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

/**
 * Desktop table-mode surface for the pipeline. Owns the read-only table's
 * UI state — search, sort, density, selection — fetches the row set via
 * {@link usePipelineTableData}, and renders the toolbar above the virtualized
 * table. Loading / error / empty collapse to tactical microcopy. Row clicks
 * open the existing pipeline detail panel via the mode store.
 *
 * Density defaults to "compact" (the field-dense default for this surface);
 * it is driven inline from the toolbar via `useTableZoom().setPreset`.
 */
export function PipelineTableShell({
  pipelineMetrics,
}: {
  pipelineMetrics?: MetricColumnConfig[];
}) {
  const { t } = useDictionary("pipeline");

  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<PipelineTableSort[]>([]);

  // Grouped view + closed-deals scope + per-stage collapse all live as shell UI
  // state, so they naturally survive data refetch (a background poll re-running
  // `usePipelineTableData` swaps `rows` but never touches this state — collapsed
  // stages stay collapsed, grouping stays on, and scroll doesn't reset).
  const [grouped, setGrouped] = useState(false);
  const [closedDeals, setClosedDeals] = useState(false);
  const [collapsedStages, setCollapsedStages] = useState<Set<OpportunityStage>>(
    () => new Set(),
  );

  const handleToggleStageCollapse = useCallback((stage: OpportunityStage) => {
    setCollapsedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) {
        next.delete(stage);
      } else {
        next.add(stage);
      }
      return next;
    });
  }, []);

  // ── Saved views ────────────────────────────────────────────────────────────
  // The view switcher rides ABOVE the in-memory pipeline table. Switching the
  // active view applies the dimensions the shell actually owns — `density` and
  // `sort` — to the shell state (see the density re-init + the sort effect
  // below). The view's `columns`/`filters` are intentionally NOT applied to the
  // render: `usePipelineTableData` derives rows in-memory and renders every
  // registered column (per-view column subset + server-side filter are out of
  // scope for this phase — Task 7.4 deferral, documented). `managedViews` holds
  // the optimistic list so a freshly-created/renamed/archived view shows in the
  // tabs before the list query refetches.
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [managedViews, setManagedViews] = useState<OpportunityViewDefinition[] | null>(null);
  const [pendingActiveViewId, setPendingActiveViewId] = useState<string | null>(null);
  const [unavailableViewId, setUnavailableViewId] = useState<string | null>(null);
  const [densityErrorKey, setDensityErrorKey] = useState<string | null>(null);
  const [densitySaving, setDensitySaving] = useState(false);
  const [viewSaveErrorKey, setViewSaveErrorKey] = useState<string | null>(null);
  const [viewDefinitionSaving, setViewDefinitionSaving] = useState(false);

  const viewsQuery = useOpportunityViewsList();

  useEffect(() => {
    if (viewsQuery.data) setManagedViews(viewsQuery.data);
  }, [viewsQuery.data]);

  const views = useMemo(
    () =>
      (managedViews ?? viewsQuery.data ?? []).filter((view) => view.isArchived !== true),
    [managedViews, viewsQuery.data],
  );
  const { activeView, activeViewId, setActiveViewId, unavailableView } =
    useOpportunityView(views);
  const viewActions = useOpportunityViewActions({ views, activeViewId, setActiveViewId });

  const savedActiveView = useMemo(
    () => views.find((view) => view.id === activeViewId) ?? null,
    [activeViewId, views],
  );
  const activeViewSortKey = useMemo(
    () => stableKey(activeView?.sort ?? []),
    [activeView?.sort],
  );

  // Seed (and re-seed) the shell's sort from the active view whenever the view —
  // or its persisted sort — changes. This is what makes switching a view visibly
  // re-sort the table.
  useEffect(() => {
    setSorting(activeView?.sort ?? []);
  }, [activeView?.id, activeViewSortKey]);

  useEffect(() => {
    if (unavailableView) setUnavailableViewId(unavailableView.viewId);
  }, [unavailableView]);

  // A view created/duplicated optimistically may not be in `views` for a render
  // until the list state settles; defer activating it until it actually appears.
  useEffect(() => {
    if (!pendingActiveViewId) return;
    if (!views.some((view) => view.id === pendingActiveViewId)) return;
    setActiveViewId(pendingActiveViewId);
    setPendingActiveViewId(null);
  }, [pendingActiveViewId, setActiveViewId, views]);

  const openDetailPanel = usePipelineModeStore((state) => state.openDetailPanel);
  const canManage = usePermissionStore((s) => s.can("pipeline.manage"));

  // Density persists back to the active view on change (mirrors the projects
  // shell): the segmented control writes the new preset's density + zoom into
  // the view definition so it survives reloads and view switches.
  const handleDensityPersist = useCallback(
    async ({
      density: nextDensity,
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
          definition: { density: nextDensity, zoomLevel },
        });
        setManagedViews((current) => upsertOpportunityView(current ?? views, updatedView));
      } catch (error) {
        setDensityErrorKey(
          getViewMutationErrorCode(error) === "PERMISSION_DENIED"
            ? "table.density.errorPermissionDenied"
            : "table.density.errorGeneric",
        );
        throw error;
      } finally {
        setDensitySaving(false);
      }
    },
    [activeView, viewActions.updateViewDefinition, views],
  );

  const { density, metrics, setPreset } = useTableZoom({
    initialDensity: activeView?.density ?? "compact",
    initialZoom: activeView?.zoomLevel ?? 1,
    onPersistDensity: handleDensityPersist,
    onPersistError: (error) =>
      setDensityErrorKey(
        getViewMutationErrorCode(error) === "PERMISSION_DENIED"
          ? "table.density.errorPermissionDenied"
          : "table.density.errorGeneric",
      ),
  });
  const handleDensityChange = useCallback(
    (next: ProjectTableDensity) => {
      void setPreset(next);
    },
    [setPreset],
  );

  // Reset transient view error/saving copy when the active view changes.
  useEffect(() => {
    setDensityErrorKey(null);
    setViewSaveErrorKey(null);
  }, [activeViewId]);

  // ── Save-current-definition (sort delta) ─────────────────────────────────────
  // The pipeline shell only owns two dimensions that map onto a saved view:
  // `density` (auto-persisted above) and `sort`. So "unsaved changes" reduces to
  // a sort delta: the live shell sort differs from the active view's persisted
  // sort. When it does, a Save affordance appears (mirroring the projects shell's
  // `hasUnsavedDefinition` + Save button) and writes the sanitized sort back via
  // `updateViewDefinition`. Grouping / closed-deals / columns are NOT part of the
  // view definition here, so they never count as unsaved (Task 7.4 deferral).
  const sanitizedSorting = useMemo(() => sanitizeSort(sorting), [sorting]);
  const hasUnsavedDefinition = useMemo(() => {
    if (!activeView || !savedActiveView) return false;
    return stableKey(sanitizedSorting) !== stableKey(sanitizeSort(savedActiveView.sort));
  }, [activeView, sanitizedSorting, savedActiveView]);

  const persistPendingViewDefinition = useCallback(async () => {
    if (!activeView) return null;
    setViewDefinitionSaving(true);
    setViewSaveErrorKey(null);
    try {
      const updatedView = await viewActions.updateViewDefinition.mutateAsync({
        viewId: activeView.id,
        definition: { sort: sanitizedSorting },
      });
      setManagedViews((current) => upsertOpportunityView(current ?? views, updatedView));
      setSorting(updatedView.sort);
      return updatedView;
    } catch (error) {
      setViewSaveErrorKey(viewPersistenceErrorCopyKey(error));
      throw error;
    } finally {
      setViewDefinitionSaving(false);
    }
  }, [activeView, sanitizedSorting, viewActions.updateViewDefinition, views]);

  // ── View-lifecycle callbacks ─────────────────────────────────────────────────
  const handleViewCreated = useCallback(
    (view: OpportunityViewDefinition) => {
      setManagedViews((current) => upsertOpportunityView(current ?? views, view));
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
    (view: OpportunityViewDefinition) => {
      setManagedViews((current) => upsertOpportunityView(current ?? views, view));
    },
    [views],
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

  const handleInlineArchiveView = useCallback(
    async (view: OpportunityViewDefinition) => {
      setViewSaveErrorKey(null);
      try {
        await viewActions.archiveView.mutateAsync({ viewId: view.id });
        handleViewArchived(view.id);
      } catch (error) {
        setViewSaveErrorKey(viewPersistenceErrorCopyKey(error));
      }
    },
    [handleViewArchived, viewActions.archiveView],
  );

  // Share must capture the live (possibly-unsaved) sort, exactly like the
  // projects shell: persist the pending sort first, then share. Wrap only the
  // share mutation so the rest of the action surface is untouched.
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

  const { rows, totalCount, now, isLoading, isError } = usePipelineTableData({
    search,
    sorting,
    closedDeals,
  });

  // ── Stage transitions (shared with the focused board) ─────────────────────
  // The transition hook needs the underlying `Opportunity[]` to source the deal
  // by id for its toast / undo / dialog payload — the table only holds the
  // flattened `PipelineTableRow[]`. Read the cached opportunity list (same
  // source `usePipelineTableData` fans out to, so no extra fetch) and pass the
  // active set, exactly as `pipeline/page.tsx` does. Selecting an active stage
  // moves directly (toast + undo); Won / Lost open the dialog rendered below.
  const { data: opportunities } = useOpportunities();
  const activeOpportunities = useMemo(() => {
    if (!opportunities) return [];
    return opportunities.filter((o) => !o.deletedAt && !o.archivedAt);
  }, [opportunities]);
  const {
    requestStageChange,
    requestConvertAlreadyWon,
    dialogType,
    dialogOpportunity,
    preflight,
    preflightLoading,
    confirmTransition,
    onAddressChange,
    cancelTransition,
  } = useStageTransition({ opportunities: activeOpportunities });

  // ── Inline cell editing ───────────────────────────────────────────────────
  // The shell owns the cell-edit engine. The keyboard-nav hook (below) is the
  // SINGLE owner of the active + editing cell coordinate — the table/row read
  // both from it, and this engine commits against the same coordinate. There is
  // no competing editing-cell state.
  const { saveStates, commitEdit, latestUndo, undoLatest, clearLatestUndo } =
    useOpportunityCellEdit({ rows });
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleUndoLatest = useCallback(() => {
    void undoLatest();
  }, [undoLatest]);

  const handleFocusSearch = useCallback(() => {
    const input = searchInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  // ── Keyboard navigation (roving tabindex + grid shortcuts) ─────────────────
  // Owns `activeCell` (roving focus) and `editingCell` (which cell is editing).
  // Navigates the raw fetched `rows` — identical to `displayRows` whenever the
  // user is actually arrow-navigating (the order freeze below engages only mid-
  // edit, when no arrow navigation happens). `onSelectAllVisible` /
  // `onClearSelection` bind to the selection hook once it is created below.
  const selectionRef = useRef<{
    selectAllVisible: () => void;
    clearSelection: () => void;
  }>({ selectAllVisible: () => {}, clearSelection: () => {} });

  const {
    activeCell,
    editingCell,
    setActiveCell,
    beginEdit,
    cancelEdit,
    handleCellKeyDown,
  } = usePipelineTableKeyboardNav({
    rows,
    columns: PIPELINE_TABLE_COLUMNS,
    onUndo: handleUndoLatest,
    onFocusSearch: handleFocusSearch,
    onSelectAllVisible: () => selectionRef.current.selectAllVisible(),
    onClearSelection: () => selectionRef.current.clearSelection(),
  });

  const handleBeginEdit = useCallback(
    (rowId: string, columnId: PipelineTableEditableColumnId) => {
      beginEdit(rowId, columnId);
    },
    [beginEdit],
  );

  const handleCancelEdit = useCallback(() => {
    cancelEdit();
  }, [cancelEdit]);

  const handleCommitCell = useCallback(
    (rowId: string, columnId: PipelineTableEditableColumnId, value: PipelineTableEditValue) => {
      void commitEdit(rowId, columnId, value);
      cancelEdit({ rowId, columnId });
    },
    [cancelEdit, commitEdit],
  );

  // ── Row-order stabilization (no row-jump on commit) ────────────────────────
  // The data hook sorts client-side, so an optimistic cache patch from a commit
  // would re-run the comparator and make the just-edited row leap to its new
  // sorted slot mid-interaction. While an edit is active OR a save is in flight,
  // we hold the row order to the snapshot captured when the freeze began, so the
  // edited row stays under the cursor. The freeze releases (and the table
  // re-sorts naturally) once editing stops and no save is pending.
  const isSaving = useMemo(
    () => Array.from(saveStates.values()).some((state) => state === "saving"),
    [saveStates],
  );
  const freezeActive = editingCell != null || isSaving;
  const frozenOrderRef = useRef<string[] | null>(null);

  const displayRows = useMemo(() => {
    if (!freezeActive) {
      frozenOrderRef.current = null;
      return rows;
    }
    // Capture the order once at the start of the freeze; reuse it for the
    // freeze's duration so re-sorts from optimistic patches can't reorder.
    if (frozenOrderRef.current == null) {
      frozenOrderRef.current = rows.map((row) => row.id);
    }
    const order = frozenOrderRef.current;
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = order
      .map((id) => byId.get(id))
      .filter((row): row is (typeof rows)[number] => row != null);
    // Append any rows that appeared since the freeze began (rare, e.g. a
    // realtime insert) so nothing silently drops out of the table.
    const seen = new Set(order);
    for (const row of rows) {
      if (!seen.has(row.id)) ordered.push(row);
    }
    return ordered;
  }, [freezeActive, rows]);

  // Stale editing/active coordinates are reconciled inside the keyboard-nav hook
  // (it nulls `editingCell` and re-seeds `activeCell` whenever a cell leaves the
  // row set), so no separate phantom-row cleanup is needed here.

  // ── Selection scoping (two DIFFERENT row sets, deliberately decoupled) ───────
  // The shared `useTableSelection` hook conflates one `visibleRowIds` list for
  // THREE jobs: (1) PRUNING — drop a selected id once it leaves the set,
  // (2) seeding its own `selectAllVisible`, and (3) RANGE selection — a
  // shift-click fills the span between the anchor and the target *in this list's
  // order*. Two of those (PRUNING and RANGE) pull in opposite directions here,
  // and we can't pass two lists or edit the shared hook (projects table-v2
  // depends on it), so we resolve both through a single carefully-ordered list:
  //
  //   • `selectableRowIds` — ALL post-search rows (membership = the full filtered
  //     set, so PRUNING tracks search/filter ONLY: a collapsed row stays in the
  //     set → stays selected across collapse/expand). But its ORDER follows the
  //     RENDERED, stage-grouped sequence — built via `buildFlattenedRows` with an
  //     EMPTY collapsed set so EVERY row is present (persistence preserved) yet
  //     ordered exactly as the screen lays them out under grouping. That makes
  //     `toggleRow(id, "range")`'s `indexOf`-based span match the visually
  //     contiguous rows: a shift-click from a row in stage A to a row in stage B
  //     selects the rendered-contiguous set (stage order), not a flat-sorted span.
  //     When NOT grouped, `buildFlattenedRows` is a 1:1 flat passthrough, so this
  //     is identical to `displayRows` order. (A range drag across a *collapsed*
  //     group would include that group's hidden rows — acceptable: it matches the
  //     rendered order of the fully-expanded structure, and those rows are real
  //     members of the selection set.)
  //   • `renderedDataRowIds` — only the `data` items of the flattened stream the
  //     table ACTUALLY renders (collapsed stages contribute none). This is the set
  //     that "select all" + the header checkbox must target, so collapsed rows are
  //     never silently selected and never count toward the checkbox.
  const selectableRowIds = useMemo(
    () =>
      buildFlattenedRows(displayRows, { grouped, collapsedStages: EMPTY_COLLAPSED_STAGES }).flatMap(
        (item) => (item.kind === "data" ? [item.row.id] : []),
      ),
    [displayRows, grouped],
  );
  const renderedDataRowIds = useMemo(
    () =>
      buildFlattenedRows(displayRows, { grouped, collapsedStages }).flatMap((item) =>
        item.kind === "data" ? [item.row.id] : [],
      ),
    [displayRows, grouped, collapsedStages],
  );
  // Unlike the projects shell, we deliberately omit `useTableSelection`'s `resetKey`:
  // pipeline views only re-sort the same in-memory opportunities (the row population
  // never changes), so there is nothing to force-clear — the membership-prune effect
  // already drops search-removed rows, and selections correctly survive a pure view switch.
  const { selectedIds, toggleRow, clearSelection } = useTableSelection(selectableRowIds);

  // Shell-owned select-all, scoped to RENDERED rows. We deliberately do NOT use
  // the hook's `selectAllVisible` — it seeds from the hook's row set, which is
  // now the FULL set, so it would select collapsed rows too. Instead this is a
  // single toggle over `renderedDataRowIds`: if every rendered row is already
  // selected, flip the rendered ones OFF (a "deselect visible"); otherwise flip
  // the not-yet-selected rendered ones ON. Both directions go through the hook's
  // `toggleRow(id, "toggle")`, which adds-if-absent / removes-if-present a SINGLE
  // id while preserving every other selected id — so collapsed-stage selections
  // are untouched in either direction. This is what makes ⌘A and the header
  // checkbox scope to what's on screen without the shared hook knowing about
  // collapse, while collapsed selections persist.
  const handleSelectAllVisible = useCallback(() => {
    if (renderedDataRowIds.length === 0) return;
    const everyRenderedSelected = renderedDataRowIds.every((id) => selectedIds.has(id));
    if (everyRenderedSelected) {
      for (const id of renderedDataRowIds) toggleRow(id, "toggle");
      return;
    }
    for (const id of renderedDataRowIds) {
      if (!selectedIds.has(id)) toggleRow(id, "toggle");
    }
  }, [renderedDataRowIds, selectedIds, toggleRow]);

  // Whether every rendered data row is already selected — drives the bulk bar's
  // "select all N" affordance (hidden once nothing more remains to select). Read
  // off the same `renderedDataRowIds` the header checkbox + ⌘A use, so the three
  // stay perfectly aligned (collapse-safe, rendered-scoped).
  const allRenderedSelected = useMemo(
    () =>
      renderedDataRowIds.length > 0 &&
      renderedDataRowIds.every((id) => selectedIds.has(id)),
    [renderedDataRowIds, selectedIds],
  );

  // Grand total across the displayed row set — count · Σvalue · Σweighted. Built
  // from `displayRows` (the same post-search, frozen-order-aware set the table
  // renders) so the footer always equals the sum of the visible stage rollups.
  const total = useMemo(() => grandTotal(displayRows), [displayRows]);

  // Bind the latest selection callbacks for the nav hook's ⌘A / Escape paths.
  // ⌘A routes to the SAME shell-owned `handleSelectAllVisible` the header
  // checkbox uses, so the keyboard shortcut and the checkbox stay identical
  // (rendered-scoped, collapse-safe). Escape still clears the entire selection.
  // A ref indirection avoids re-instantiating the nav hook (which lives above
  // the selection hook) on every selection-state change.
  useEffect(() => {
    selectionRef.current = { selectAllVisible: handleSelectAllVisible, clearSelection };
  }, [handleSelectAllVisible, clearSelection]);

  const stateMessage = (key: string) => (
    <div className="flex h-full items-center justify-center font-mono text-micro uppercase tracking-[0.16em] text-text-3">
      {t(key)}
    </div>
  );

  // View states gate the table states (mirrors the projects shell): a view-load
  // failure / load / empty-view-set short-circuits before the row states, since
  // there is no table to render without a view. Once a view exists, the row
  // states (error → loading → empty → table) take over.
  let body;
  if (viewsQuery.isError) {
    body = stateMessage("table.views.error");
  } else if (viewsQuery.isLoading) {
    body = stateMessage("table.views.loading");
  } else if (views.length === 0) {
    body = stateMessage("table.views.empty");
  } else if (isError) {
    body = stateMessage("table.state.error");
  } else if (isLoading) {
    body = stateMessage("table.state.loading");
  } else if (displayRows.length === 0) {
    body = stateMessage("table.state.empty");
  } else {
    body = (
      <PipelineTable
        rows={displayRows}
        sorting={sorting}
        onSortingChange={setSorting}
        grouped={grouped}
        collapsedStages={collapsedStages}
        onToggleStageCollapse={handleToggleStageCollapse}
        metrics={metrics}
        now={now}
        selectedIds={selectedIds}
        onToggleRow={toggleRow}
        onToggleSelectAllVisible={handleSelectAllVisible}
        onOpenDeal={openDetailPanel}
        saveStates={saveStates}
        activeCell={activeCell}
        editingCell={editingCell}
        canManage={canManage}
        setActiveCell={setActiveCell}
        onBeginEdit={handleBeginEdit}
        onCancelEdit={handleCancelEdit}
        onCellKeyDown={handleCellKeyDown}
        onCommitCell={handleCommitCell}
        onRequestStageChange={requestStageChange}
        onRequestConvertAlreadyWon={requestConvertAlreadyWon}
      />
    );
  }

  // The grand-total footer sits below the table once data has settled with at
  // least one row. It is hidden in the loading/error/empty states (no table to
  // total), but always present in both grouped and flat modes.
  const showFooter =
    !viewsQuery.isError &&
    !viewsQuery.isLoading &&
    views.length > 0 &&
    !isError &&
    !isLoading &&
    displayRows.length > 0;

  return (
    // Unified TableShell (WEB OVERHAUL P6-2). The grid keeps ALL its power
    // features: PipelineTable still owns its own scroll container + virtualizer +
    // stage-group interleaving + frozen columns + inline edit — the shell body is
    // a non-scrolling flex column (bodyClassName overflow-hidden) that
    // PipelineTable fills and scrolls inside. Metrics move off the page-level
    // MetricsHeader onto the one shared MetricsStrip (the focused/kanban mode keeps
    // its own HUD — see pipeline/page.tsx). The outer wrapper no longer carries a
    // top inset: the page now only floats the compact mode switcher over table
    // mode (MetricsHeader is suppressed there), so the shell fills its frame.
    // The shell takes `flex-1 min-h-0` (over its own `h-full` base) so the
    // grand-total footer — a shrink-0 sibling below — keeps its band.
    <div className="relative flex h-full min-h-0 flex-col">
      <TableShell
        viewTabs={
          <PipelineViewTabs
            views={views}
            activeViewId={activeViewId}
            onViewChange={handleViewChange}
            onCreateView={() => setCreateDialogOpen(true)}
            onArchiveView={(view) => {
              void handleInlineArchiveView(view);
            }}
            isLoading={viewsQuery.isLoading}
            isError={viewsQuery.isError}
          />
        }
        metrics={
          <MetricsStrip
            metrics={fromMetricColumns(pipelineMetrics ?? [])}
            isLoading={pipelineMetrics == null}
            ariaLabel={t("table.gridLabel")}
          />
        }
        workbar={
          <PipelineToolbar
            search={search}
            onSearchChange={setSearch}
            dealCount={totalCount}
            grouped={grouped}
            onGroupedChange={setGrouped}
            closedDeals={closedDeals}
            onClosedDealsChange={setClosedDeals}
            density={density}
            onDensityChange={handleDensityChange}
            densityDisabled={densitySaving || viewActions.updateViewDefinition.isPending}
            searchInputRef={searchInputRef}
            saveAffordance={
              activeView ? (
                <>
                  {hasUnsavedDefinition ? (
                    <button
                      type="button"
                      disabled={viewDefinitionSaving || viewActions.updateViewDefinition.isPending}
                      onClick={() => {
                        void persistPendingViewDefinition();
                      }}
                      className="inline-flex h-[28px] items-center gap-1 rounded border border-ops-accent bg-ops-accent px-2 font-cakemono text-cake-button font-light uppercase text-black transition-colors hover:bg-ops-accent-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent disabled:pointer-events-none disabled:opacity-40"
                    >
                      <Save className="h-[12px] w-[12px]" strokeWidth={1.5} />
                      {t("table.views.save")}
                    </button>
                  ) : null}
                  {viewSaveErrorKey ? (
                    <span role="alert" className="font-mono text-micro text-rose">
                      {t(viewSaveErrorKey)}
                    </span>
                  ) : null}
                  {densityErrorKey ? (
                    <span role="alert" className="font-mono text-micro text-rose">
                      {t(densityErrorKey)}
                    </span>
                  ) : null}
                </>
              ) : null
            }
            viewSettings={
              <PipelineViewSettingsMenu
                activeView={activeView}
                actions={viewActionsWithPendingDefinition}
                onViewRenamed={handleViewUpdated}
                onViewDuplicated={handleViewCreated}
                onViewArchived={handleViewArchived}
                onViewReset={handleViewUpdated}
                onViewShared={handleViewUpdated}
              />
            }
          />
        }
        banner={
          unavailableViewId ? (
            <div
              role="alert"
              className="border-b border-border px-3 py-1.5 font-mono text-micro uppercase tracking-[0.16em] text-rose"
            >
              {t("table.views.unavailable")}
            </div>
          ) : undefined
        }
        className="min-h-0 flex-1"
        bodyClassName="flex min-h-0 flex-col overflow-hidden"
      >
        {body}
      </TableShell>

      <PipelineViewCreateDialog
        open={createDialogOpen}
        mode="create"
        activeView={activeView}
        actions={viewActions}
        onOpenChange={setCreateDialogOpen}
        onViewCreated={handleViewCreated}
      />
      {showFooter ? <PipelineTableFooter total={total} /> : null}
      <PipelineUndoToast
        entry={latestUndo}
        onUndo={handleUndoLatest}
        onDismiss={clearLatestUndo}
      />
      {/* Stage transition dialog (Won/Lost prompts) — driven by the shared hook,
          identical to the focused board's. */}
      <StageTransitionDialog
        type={dialogType}
        opportunity={dialogOpportunity}
        preflight={preflight}
        preflightLoading={preflightLoading}
        onConfirm={confirmTransition}
        onAddressChange={onAddressChange}
        onCancel={cancelTransition}
      />
      {/* Bulk-actions bar — floats over the table once rows are selected.
          Targets are `displayRows` ∩ `selectedIds`; stage changes are NOT here
          (Won/Lost stay on the single-row dialog flow — see PipelineBulkBar).
          Gated on canManage: every bulk action is a write a view-only operator
          can't perform, so the bar never mounts for them (selection itself is
          already disabled upstream — no row/header checkboxes — so this is the
          backstop that keeps the bar from ever appearing). */}
      {canManage && selectedIds.size > 0 ? (
        <PipelineBulkBar
          selectedRows={displayRows}
          selectedIds={selectedIds}
          renderedRowCount={renderedDataRowIds.length}
          allRenderedSelected={allRenderedSelected}
          onClearSelection={clearSelection}
          onSelectAllRendered={handleSelectAllVisible}
        />
      ) : null}
    </div>
  );
}
