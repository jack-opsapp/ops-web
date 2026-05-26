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
  isProjectTableEditableColumn,
  type ProjectTableColumnConfig,
  type ProjectTableColumnId,
  type ProjectTableEditableColumnId,
  type ProjectTableRow,
} from "@/lib/types/project-table";

export interface ProjectTableActiveCell {
  rowId: string;
  columnId: ProjectTableColumnId;
}

export interface ProjectTableEditingCell {
  rowId: string;
  columnId: ProjectTableEditableColumnId;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function escapeAttributeValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function noop() {}

export function useTableKeyboardNav(args: {
  rows: ProjectTableRow[];
  columns: ProjectTableColumnConfig[];
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
  const [activeCell, setActiveCell] = useState<ProjectTableActiveCell | null>(null);
  const [editingCell, setEditingCell] = useState<ProjectTableEditingCell | null>(null);
  const focusPendingRef = useRef(false);

  const rowIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const columnIds = useMemo(() => columns.map((column) => column.id), [columns]);

  const getCellIndexes = useCallback(
    (cell: ProjectTableActiveCell | ProjectTableEditingCell | null) => {
      if (!cell) return null;
      const rowIndex = rowIds.indexOf(cell.rowId);
      const columnIndex = columnIds.indexOf(cell.columnId);
      if (rowIndex < 0 || columnIndex < 0) return null;
      return { rowIndex, columnIndex };
    },
    [columnIds, rowIds],
  );

  const cellExists = useCallback(
    (cell: ProjectTableActiveCell | ProjectTableEditingCell | null) =>
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
      `[data-project-table-row-id="${rowId}"][data-project-table-column-id="${columnId}"]`,
    );
    element?.focus({ preventScroll: true });
  }, [activeCell]);

  const focusActiveCell = useCallback((cell: ProjectTableActiveCell) => {
    focusPendingRef.current = true;
    setActiveCell(cell);
  }, []);

  const resolveOrigin = useCallback(
    (rowId: string, columnId: ProjectTableColumnId) => {
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
    (rowId: string, columnId: ProjectTableColumnId, rowDelta: number, columnDelta: number) => {
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

  const moveByTab = useCallback(
    (rowId: string, columnId: ProjectTableColumnId, direction: 1 | -1) => {
      const origin = resolveOrigin(rowId, columnId);
      if (!origin || rowIds.length === 0 || columnIds.length === 0) return;

      const totalCells = rowIds.length * columnIds.length;
      const flatIndex = origin.indexes.rowIndex * columnIds.length + origin.indexes.columnIndex;
      const nextFlatIndex = clamp(flatIndex + direction, 0, totalCells - 1);
      const nextRowIndex = Math.floor(nextFlatIndex / columnIds.length);
      const nextColumnIndex = nextFlatIndex % columnIds.length;

      focusActiveCell({
        rowId: rowIds[nextRowIndex],
        columnId: columnIds[nextColumnIndex],
      });
    },
    [columnIds, focusActiveCell, resolveOrigin, rowIds],
  );

  const beginEdit = useCallback((rowId: string, columnId: ProjectTableColumnId) => {
    setActiveCell({ rowId, columnId });
    if (!isProjectTableEditableColumn(columnId)) return;
    setEditingCell({ rowId, columnId });
  }, []);

  const cancelEdit = useCallback((cell?: ProjectTableEditingCell) => {
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
      columnId: ProjectTableColumnId,
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

      if (event.key === "Enter") {
        const origin = resolveOrigin(rowId, columnId);
        const targetCell = origin?.cell ?? { rowId, columnId };
        if (isProjectTableEditableColumn(targetCell.columnId)) {
          event.preventDefault();
          beginEdit(targetCell.rowId, targetCell.columnId);
        }
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        moveByTab(rowId, columnId, event.shiftKey ? -1 : 1);
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
