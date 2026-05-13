import type { KeyboardEvent } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTableKeyboardNav } from "@/lib/hooks/projects-table/use-table-keyboard-nav";
import { ProjectStatus } from "@/lib/types/models";
import {
  PROJECT_TABLE_COLUMNS,
  type ProjectTableColumnConfig,
  type ProjectTableColumnId,
  type ProjectTableRow,
} from "@/lib/types/project-table";

const rows: ProjectTableRow[] = [
  {
    id: "p-1",
    companyId: "co-1",
    title: "Deck rebuild",
    status: ProjectStatus.InProgress,
    rawStatus: "in_progress",
    clientId: null,
    clientName: null,
    clientEmail: null,
    clientPhone: null,
    address: "12 Site Rd",
    teamMemberIds: [],
    startDate: "2026-05-20",
    endDate: null,
    duration: null,
    progress: null,
    nextTask: null,
    taskCount: 0,
    taskCompletedCount: 0,
    daysInStatus: null,
    estimateTotal: null,
    invoiceTotal: null,
    paidTotal: null,
    value: null,
    projectCost: null,
    margin: null,
    photoCount: 0,
    updatedAt: "2026-05-13T00:00:00Z",
  },
  {
    id: "p-2",
    companyId: "co-1",
    title: "Shop bay",
    status: ProjectStatus.Accepted,
    rawStatus: "accepted",
    clientId: null,
    clientName: null,
    clientEmail: null,
    clientPhone: null,
    address: "40 Yard Rd",
    teamMemberIds: [],
    startDate: null,
    endDate: "2026-05-24",
    duration: null,
    progress: null,
    nextTask: null,
    taskCount: 0,
    taskCompletedCount: 0,
    daysInStatus: null,
    estimateTotal: null,
    invoiceTotal: null,
    paidTotal: null,
    value: null,
    projectCost: null,
    margin: null,
    photoCount: 0,
    updatedAt: "2026-05-13T00:00:00Z",
  },
];

function columns(ids: ProjectTableColumnId[]): ProjectTableColumnConfig[] {
  return ids.map((id) => {
    const column = PROJECT_TABLE_COLUMNS.find((candidate) => candidate.id === id);
    if (!column) throw new Error(`Missing test column ${id}`);
    return column;
  });
}

function keyEvent(
  key: string,
  options: Partial<Pick<KeyboardEvent<HTMLElement>, "ctrlKey" | "metaKey" | "shiftKey">> = {},
) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...options,
  } as unknown as KeyboardEvent<HTMLElement> & { preventDefault: ReturnType<typeof vi.fn> };
}

function renderNav(args?: {
  columns?: ProjectTableColumnConfig[];
  onUndo?: () => void;
  onFocusSearch?: () => void;
}) {
  return renderHook(() =>
    useTableKeyboardNav({
      rows,
      columns: args?.columns ?? columns(["select", "name", "status", "address"]),
      onUndo: args?.onUndo ?? vi.fn(),
      onFocusSearch: args?.onFocusSearch ?? vi.fn(),
    }),
  );
}

describe("useTableKeyboardNav", () => {
  it("moves the active cell with arrow keys inside visible bounds", () => {
    const { result } = renderNav();

    act(() => {
      result.current.setActiveCell({ rowId: "p-1", columnId: "name" });
    });

    const right = keyEvent("ArrowRight");
    act(() => {
      result.current.handleCellKeyDown("p-1", "name", right);
    });
    expect(result.current.activeCell).toEqual({ rowId: "p-1", columnId: "status" });
    expect(right.preventDefault).toHaveBeenCalledTimes(1);

    const down = keyEvent("ArrowDown");
    act(() => {
      result.current.handleCellKeyDown("p-1", "status", down);
    });
    expect(result.current.activeCell).toEqual({ rowId: "p-2", columnId: "status" });

    act(() => {
      result.current.handleCellKeyDown("p-2", "status", keyEvent("ArrowDown"));
    });
    expect(result.current.activeCell).toEqual({ rowId: "p-2", columnId: "status" });

    act(() => {
      result.current.handleCellKeyDown("p-2", "status", keyEvent("ArrowLeft"));
    });
    expect(result.current.activeCell).toEqual({ rowId: "p-2", columnId: "name" });
  });

  it("moves forward and backward with tab and shift-tab", () => {
    const { result } = renderNav();

    act(() => {
      result.current.setActiveCell({ rowId: "p-1", columnId: "address" });
    });

    const tab = keyEvent("Tab");
    act(() => {
      result.current.handleCellKeyDown("p-1", "address", tab);
    });
    expect(result.current.activeCell).toEqual({ rowId: "p-2", columnId: "select" });
    expect(tab.preventDefault).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleCellKeyDown("p-2", "select", keyEvent("Tab", { shiftKey: true }));
    });
    expect(result.current.activeCell).toEqual({ rowId: "p-1", columnId: "address" });
  });

  it("begins edit on enter only when the active column is editable", () => {
    const { result } = renderNav({ columns: columns(["name", "client"]) });

    act(() => {
      result.current.setActiveCell({ rowId: "p-1", columnId: "name" });
    });
    const editableEnter = keyEvent("Enter");
    act(() => {
      result.current.handleCellKeyDown("p-1", "name", editableEnter);
    });
    expect(result.current.editingCell).toEqual({ rowId: "p-1", columnId: "name" });
    expect(editableEnter.preventDefault).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.cancelEdit();
      result.current.setActiveCell({ rowId: "p-1", columnId: "client" });
    });
    const readOnlyEnter = keyEvent("Enter");
    act(() => {
      result.current.handleCellKeyDown("p-1", "client", readOnlyEnter);
    });
    expect(result.current.editingCell).toBeNull();
    expect(readOnlyEnter.preventDefault).not.toHaveBeenCalled();
  });

  it("cancels edit on escape", () => {
    const { result } = renderNav();

    act(() => {
      result.current.beginEdit("p-1", "name");
    });
    expect(result.current.editingCell).toEqual({ rowId: "p-1", columnId: "name" });

    const escape = keyEvent("Escape");
    act(() => {
      result.current.handleCellKeyDown("p-1", "name", escape);
    });
    expect(result.current.editingCell).toBeNull();
    expect(escape.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("calls undo on meta/control z", () => {
    const onUndo = vi.fn();
    const { result } = renderNav({ onUndo });

    const metaZ = keyEvent("z", { metaKey: true });
    act(() => {
      result.current.handleCellKeyDown("p-1", "name", metaZ);
    });
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(metaZ.preventDefault).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleCellKeyDown("p-1", "name", keyEvent("Z", { ctrlKey: true }));
    });
    expect(onUndo).toHaveBeenCalledTimes(2);
  });

  it("focuses search on meta/control f", () => {
    const onFocusSearch = vi.fn();
    const { result } = renderNav({ onFocusSearch });

    const controlF = keyEvent("f", { ctrlKey: true });
    act(() => {
      result.current.handleCellKeyDown("p-1", "name", controlF);
    });

    expect(onFocusSearch).toHaveBeenCalledTimes(1);
    expect(controlF.preventDefault).toHaveBeenCalledTimes(1);
  });
});
