import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  isPipelineTableEditableColumn,
  type PipelineTableColumnConfig,
  type PipelineTableColumnId,
  type PipelineTableEditableColumnId,
  type PipelineTableRow,
} from "@/lib/types/pipeline-table";

/**
 * Roving-tabindex keyboard navigation for the pipeline table.
 *
 * Modeled on the projects-table `useTableKeyboardNav` (which is hardcoded to the
 * project column model and so cannot be reused directly), this is the
 * pipeline-flavored twin: it understands the pipeline column ids, gates Enter on
 * {@link isPipelineTableEditableColumn}, and targets cells by the
 * `data-pipeline-table-row-id` / `data-pipeline-table-column-id` attributes the
 * row already stamps.
 *
 * It is the SINGLE owner of both the active cell (roving focus) and the editing
 * cell — the table/row read both from here and the shell's cell-edit engine
 * commits against the same coordinate, so there is exactly one "which cell is
 * editing" source of truth.
 *
 * Behavior:
 *   - Arrow keys move the active cell one step, clamped to the visible grid.
 *   - Tab / Shift+Tab move forward / backward through cells in row-major order,
 *     clamped at the corners. At the grid's edge the move is a no-op and the
 *     browser advances focus past the grid — Tab exits in one stop, no trap.
 *   - Enter (or F2) begins editing an editable cell; on a non-editable cell it
 *     is a no-op (stage changes route through the click-driven menu).
 *   - Escape cancels the active edit; with nothing editing it clears selection.
 *   - ⌘Z / Ctrl+Z undo, ⌘A / Ctrl+A select-all-visible, ⌘F / Ctrl+F focus search.
 */

export interface PipelineTableActiveCell {
  rowId: string;
  columnId: PipelineTableColumnId;
}

export interface PipelineTableEditingCell {
  rowId: string;
  columnId: PipelineTableEditableColumnId;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function escapeAttributeValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function noop() {}

export function usePipelineTableKeyboardNav(args: {
  rows: PipelineTableRow[];
  columns: PipelineTableColumnConfig[];
  onUndo: () => void;
  onFocusSearch: () => void;
  onSelectAllVisible?: () => void;
  onClearSelection?: () => void;
}) {
  const {
    rows,
    columns,
    onUndo,
    onFocusSearch,
    onSelectAllVisible = noop,
    onClearSelection = noop,
  } = args;
  const [activeCell, setActiveCell] = useState<PipelineTableActiveCell | null>(null);
  const [editingCell, setEditingCell] = useState<PipelineTableEditingCell | null>(null);
  const focusPendingRef = useRef(false);

  const rowIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const columnIds = useMemo(() => columns.map((column) => column.id), [columns]);

  const getCellIndexes = useCallback(
    (cell: PipelineTableActiveCell | PipelineTableEditingCell | null) => {
      if (!cell) return null;
      const rowIndex = rowIds.indexOf(cell.rowId);
      const columnIndex = columnIds.indexOf(cell.columnId);
      if (rowIndex < 0 || columnIndex < 0) return null;
      return { rowIndex, columnIndex };
    },
    [columnIds, rowIds],
  );

  const cellExists = useCallback(
    (cell: PipelineTableActiveCell | PipelineTableEditingCell | null) =>
      getCellIndexes(cell) != null,
    [getCellIndexes],
  );

  useEffect(() => {
    setActiveCell((current) => {
      if (rowIds.length === 0 || columnIds.length === 0) return null;
      if (cellExists(current)) return current;
      return { rowId: rowIds[0], columnId: columnIds[0] };
    });

    setEditingCell((current) => {
      if (!current) return null;
      return cellExists(current) ? current : null;
    });
  }, [cellExists, columnIds, rowIds]);

  useLayoutEffect(() => {
    if (!focusPendingRef.current || !activeCell || typeof document === "undefined") return;
    focusPendingRef.current = false;

    const rowId = escapeAttributeValue(activeCell.rowId);
    const columnId = escapeAttributeValue(activeCell.columnId);
    const element = document.querySelector<HTMLElement>(
      `[data-pipeline-table-row-id="${rowId}"][data-pipeline-table-column-id="${columnId}"]`,
    );
    element?.focus({ preventScroll: true });
  }, [activeCell]);

  const focusActiveCell = useCallback((cell: PipelineTableActiveCell) => {
    focusPendingRef.current = true;
    setActiveCell(cell);
  }, []);

  const resolveOrigin = useCallback(
    (rowId: string, columnId: PipelineTableColumnId) => {
      if (activeCell && cellExists(activeCell)) {
        const indexes = getCellIndexes(activeCell);
        if (indexes) return { cell: activeCell, indexes };
      }

      const fallback = { rowId, columnId };
      const indexes = getCellIndexes(fallback);
      return indexes ? { cell: fallback, indexes } : null;
    },
    [activeCell, cellExists, getCellIndexes],
  );

  const moveActiveCell = useCallback(
    (rowId: string, columnId: PipelineTableColumnId, rowDelta: number, columnDelta: number) => {
      const origin = resolveOrigin(rowId, columnId);
      if (!origin || rowIds.length === 0 || columnIds.length === 0) return;

      const rowIndex = clamp(origin.indexes.rowIndex + rowDelta, 0, rowIds.length - 1);
      const columnIndex = clamp(
        origin.indexes.columnIndex + columnDelta,
        0,
        columnIds.length - 1,
      );
      focusActiveCell({ rowId: rowIds[rowIndex], columnId: columnIds[columnIndex] });
    },
    [columnIds, focusActiveCell, resolveOrigin, rowIds],
  );

  /**
   * Tab within the grid moves to the previous/next cell in row-major order. At
   * the first/last cell the flat index is already clamped, so the move is a
   * no-op and we return `false` to signal the caller NOT to preventDefault —
   * letting the browser carry focus out of the grid. This is what keeps Tab from
   * trapping focus: one Tab to enter, navigate, one Tab to leave.
   */
  const moveByTab = useCallback(
    (rowId: string, columnId: PipelineTableColumnId, direction: 1 | -1): boolean => {
      const origin = resolveOrigin(rowId, columnId);
      if (!origin || rowIds.length === 0 || columnIds.length === 0) return false;

      const totalCells = rowIds.length * columnIds.length;
      const flatIndex = origin.indexes.rowIndex * columnIds.length + origin.indexes.columnIndex;
      const nextFlatIndex = clamp(flatIndex + direction, 0, totalCells - 1);
      if (nextFlatIndex === flatIndex) {
        // At a grid edge — let focus escape the grid instead of staying put.
        return false;
      }
      const nextRowIndex = Math.floor(nextFlatIndex / columnIds.length);
      const nextColumnIndex = nextFlatIndex % columnIds.length;

      focusActiveCell({
        rowId: rowIds[nextRowIndex],
        columnId: columnIds[nextColumnIndex],
      });
      return true;
    },
    [columnIds, focusActiveCell, resolveOrigin, rowIds],
  );

  const beginEdit = useCallback((rowId: string, columnId: PipelineTableColumnId) => {
    setActiveCell({ rowId, columnId });
    if (!isPipelineTableEditableColumn(columnId)) return;
    setEditingCell({ rowId, columnId });
  }, []);

  const cancelEdit = useCallback((cell?: PipelineTableEditingCell) => {
    setEditingCell((current) => {
      if (!cell) return null;
      return current?.rowId === cell.rowId && current.columnId === cell.columnId
        ? null
        : current;
    });
  }, []);

  const handleCellKeyDown = useCallback(
    (
      rowId: string,
      columnId: PipelineTableColumnId,
      event: KeyboardEvent<HTMLElement>,
    ) => {
      const key = event.key.toLowerCase();
      const commandKey = event.metaKey || event.ctrlKey;

      if (commandKey && key === "z") {
        event.preventDefault();
        onUndo();
        return;
      }

      if (commandKey && key === "a") {
        event.preventDefault();
        onSelectAllVisible();
        return;
      }

      if (commandKey && key === "f") {
        event.preventDefault();
        onFocusSearch();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        if (editingCell) {
          cancelEdit();
        } else {
          onClearSelection();
        }
        return;
      }

      // Enter / F2 begin editing an editable cell. On a non-editable cell (e.g.
      // `stage`, whose changes route through the click-driven menu) it is a
      // no-op and focus stays put.
      if (event.key === "Enter" || event.key === "F2") {
        const origin = resolveOrigin(rowId, columnId);
        const targetCell = origin?.cell ?? { rowId, columnId };
        if (isPipelineTableEditableColumn(targetCell.columnId)) {
          event.preventDefault();
          beginEdit(targetCell.rowId, targetCell.columnId);
        }
        return;
      }

      if (event.key === "Tab") {
        const moved = moveByTab(rowId, columnId, event.shiftKey ? -1 : 1);
        // Only swallow Tab when we actually moved inside the grid; at the edge
        // let the browser move focus out so the grid is not a keyboard trap.
        if (moved) event.preventDefault();
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveActiveCell(rowId, columnId, -1, 0);
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveActiveCell(rowId, columnId, 1, 0);
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveActiveCell(rowId, columnId, 0, -1);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveActiveCell(rowId, columnId, 0, 1);
      }
    },
    [
      beginEdit,
      cancelEdit,
      editingCell,
      moveActiveCell,
      moveByTab,
      onClearSelection,
      onFocusSearch,
      onSelectAllVisible,
      onUndo,
      resolveOrigin,
    ],
  );

  return {
    activeCell,
    editingCell,
    setActiveCell,
    beginEdit,
    cancelEdit,
    handleCellKeyDown,
  };
}
