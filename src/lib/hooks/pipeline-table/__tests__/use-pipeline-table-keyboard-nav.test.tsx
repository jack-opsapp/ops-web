import type { KeyboardEvent } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePipelineTableKeyboardNav } from "@/lib/hooks/pipeline-table/use-pipeline-table-keyboard-nav";
import type { OpportunityStage } from "@/lib/types/pipeline";
import {
  PIPELINE_TABLE_COLUMNS,
  type PipelineTableColumnConfig,
  type PipelineTableColumnId,
  type PipelineTableRow,
} from "@/lib/types/pipeline-table";

function makeRow(id: string, title: string): PipelineTableRow {
  return {
    id,
    companyId: "co-1",
    title,
    stage: "qualifying" as OpportunityStage,
    clientId: null,
    clientName: null,
    estimatedValue: 5000,
    winProbability: 20,
    weightedValue: 1000,
    ageInStageDays: 3,
    lastActivityAt: null,
    nextFollowUpAt: null,
    expectedCloseDate: null,
    assignedTo: null,
    assigneeName: null,
    source: null,
    priority: null,
    correspondenceCount: 0,
    stageEnteredAt: null,
    projectId: null,
    updatedAt: null,
    staleThresholdDays: null,
    winProbabilityIsFallback: false,
  };
}

const rows: PipelineTableRow[] = [makeRow("opp-1", "Deck rebuild"), makeRow("opp-2", "Shop bay")];

function columns(ids: PipelineTableColumnId[]): PipelineTableColumnConfig[] {
  return ids.map((id) => {
    const column = PIPELINE_TABLE_COLUMNS.find((candidate) => candidate.id === id);
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
  columns?: PipelineTableColumnConfig[];
  onUndo?: () => void;
  onFocusSearch?: () => void;
  onSelectAllVisible?: () => void;
  onClearSelection?: () => void;
}) {
  return renderHook(() =>
    usePipelineTableKeyboardNav({
      rows,
      columns: args?.columns ?? columns(["select", "deal", "stage", "value", "assignee"]),
      onUndo: args?.onUndo ?? vi.fn(),
      onFocusSearch: args?.onFocusSearch ?? vi.fn(),
      onSelectAllVisible: args?.onSelectAllVisible,
      onClearSelection: args?.onClearSelection,
    }),
  );
}

describe("usePipelineTableKeyboardNav", () => {
  it("seeds the active cell to the first cell once rows + columns exist", () => {
    const { result } = renderNav();
    expect(result.current.activeCell).toEqual({ rowId: "opp-1", columnId: "select" });
  });

  it("moves the active cell with arrow keys inside visible bounds", () => {
    const { result } = renderNav();

    act(() => {
      result.current.setActiveCell({ rowId: "opp-1", columnId: "deal" });
    });

    const right = keyEvent("ArrowRight");
    act(() => {
      result.current.handleCellKeyDown("opp-1", "deal", right);
    });
    expect(result.current.activeCell).toEqual({ rowId: "opp-1", columnId: "stage" });
    expect(right.preventDefault).toHaveBeenCalledTimes(1);

    const down = keyEvent("ArrowDown");
    act(() => {
      result.current.handleCellKeyDown("opp-1", "stage", down);
    });
    expect(result.current.activeCell).toEqual({ rowId: "opp-2", columnId: "stage" });

    // Clamps at the bottom edge (no wrap).
    act(() => {
      result.current.handleCellKeyDown("opp-2", "stage", keyEvent("ArrowDown"));
    });
    expect(result.current.activeCell).toEqual({ rowId: "opp-2", columnId: "stage" });

    act(() => {
      result.current.handleCellKeyDown("opp-2", "stage", keyEvent("ArrowLeft"));
    });
    expect(result.current.activeCell).toEqual({ rowId: "opp-2", columnId: "deal" });
  });

  it("moves forward and backward with tab and shift-tab", () => {
    const { result } = renderNav();

    act(() => {
      result.current.setActiveCell({ rowId: "opp-1", columnId: "stage" });
    });

    const tab = keyEvent("Tab");
    act(() => {
      result.current.handleCellKeyDown("opp-1", "stage", tab);
    });
    expect(result.current.activeCell).toEqual({ rowId: "opp-1", columnId: "value" });
    expect(tab.preventDefault).toHaveBeenCalledTimes(1);

    const shiftTab = keyEvent("Tab", { shiftKey: true });
    act(() => {
      result.current.handleCellKeyDown("opp-1", "value", shiftTab);
    });
    expect(result.current.activeCell).toEqual({ rowId: "opp-1", columnId: "stage" });
    expect(shiftTab.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("does NOT trap Tab at the grid edges (lets focus escape — no preventDefault)", () => {
    const { result } = renderNav();

    // Last cell of the last row: forward Tab must NOT preventDefault, so the
    // browser carries focus out of the grid in a single Tab.
    act(() => {
      result.current.setActiveCell({ rowId: "opp-2", columnId: "assignee" });
    });
    const forwardEdge = keyEvent("Tab");
    act(() => {
      result.current.handleCellKeyDown("opp-2", "assignee", forwardEdge);
    });
    expect(forwardEdge.preventDefault).not.toHaveBeenCalled();
    expect(result.current.activeCell).toEqual({ rowId: "opp-2", columnId: "assignee" });

    // First cell of the first row: backward Shift+Tab must NOT preventDefault.
    act(() => {
      result.current.setActiveCell({ rowId: "opp-1", columnId: "select" });
    });
    const backwardEdge = keyEvent("Tab", { shiftKey: true });
    act(() => {
      result.current.handleCellKeyDown("opp-1", "select", backwardEdge);
    });
    expect(backwardEdge.preventDefault).not.toHaveBeenCalled();
    expect(result.current.activeCell).toEqual({ rowId: "opp-1", columnId: "select" });
  });

  it("begins edit on Enter only when the active column is editable", () => {
    const { result } = renderNav({ columns: columns(["value", "stage"]) });

    act(() => {
      result.current.setActiveCell({ rowId: "opp-1", columnId: "value" });
    });
    const editableEnter = keyEvent("Enter");
    act(() => {
      result.current.handleCellKeyDown("opp-1", "value", editableEnter);
    });
    expect(result.current.editingCell).toEqual({ rowId: "opp-1", columnId: "value" });
    expect(editableEnter.preventDefault).toHaveBeenCalledTimes(1);

    // Stage is NOT inline-editable (routes through the click-driven menu): Enter
    // is a no-op and never opens an editor.
    act(() => {
      result.current.cancelEdit();
      result.current.setActiveCell({ rowId: "opp-1", columnId: "stage" });
    });
    const stageEnter = keyEvent("Enter");
    act(() => {
      result.current.handleCellKeyDown("opp-1", "stage", stageEnter);
    });
    expect(result.current.editingCell).toBeNull();
    expect(stageEnter.preventDefault).not.toHaveBeenCalled();
  });

  it("begins edit on F2 for an editable column", () => {
    const { result } = renderNav({ columns: columns(["value"]) });

    act(() => {
      result.current.setActiveCell({ rowId: "opp-1", columnId: "value" });
    });
    const f2 = keyEvent("F2");
    act(() => {
      result.current.handleCellKeyDown("opp-1", "value", f2);
    });
    expect(result.current.editingCell).toEqual({ rowId: "opp-1", columnId: "value" });
    expect(f2.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("Escape cancels an active edit, then a second Escape clears selection", () => {
    const onClearSelection = vi.fn();
    const { result } = renderNav({ columns: columns(["value"]), onClearSelection });

    act(() => {
      result.current.beginEdit("opp-1", "value");
    });
    expect(result.current.editingCell).toEqual({ rowId: "opp-1", columnId: "value" });

    const firstEscape = keyEvent("Escape");
    act(() => {
      result.current.handleCellKeyDown("opp-1", "value", firstEscape);
    });
    expect(result.current.editingCell).toBeNull();
    expect(firstEscape.preventDefault).toHaveBeenCalledTimes(1);
    expect(onClearSelection).not.toHaveBeenCalled();

    const secondEscape = keyEvent("Escape");
    act(() => {
      result.current.handleCellKeyDown("opp-1", "value", secondEscape);
    });
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it("calls undo on meta/control z", () => {
    const onUndo = vi.fn();
    const { result } = renderNav({ onUndo });

    const metaZ = keyEvent("z", { metaKey: true });
    act(() => {
      result.current.handleCellKeyDown("opp-1", "deal", metaZ);
    });
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(metaZ.preventDefault).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleCellKeyDown("opp-1", "deal", keyEvent("Z", { ctrlKey: true }));
    });
    expect(onUndo).toHaveBeenCalledTimes(2);
  });

  it("focuses search on meta/control f", () => {
    const onFocusSearch = vi.fn();
    const { result } = renderNav({ onFocusSearch });

    const controlF = keyEvent("f", { ctrlKey: true });
    act(() => {
      result.current.handleCellKeyDown("opp-1", "deal", controlF);
    });
    expect(onFocusSearch).toHaveBeenCalledTimes(1);
    expect(controlF.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("selects all visible on meta/control a", () => {
    const onSelectAllVisible = vi.fn();
    const { result } = renderNav({ onSelectAllVisible });

    const metaA = keyEvent("a", { metaKey: true });
    act(() => {
      result.current.handleCellKeyDown("opp-1", "deal", metaA);
    });
    expect(onSelectAllVisible).toHaveBeenCalledTimes(1);
    expect(metaA.preventDefault).toHaveBeenCalledTimes(1);
  });
});
