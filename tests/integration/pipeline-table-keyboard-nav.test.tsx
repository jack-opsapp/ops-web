import * as React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePipelineTableKeyboardNav } from "@/lib/hooks/pipeline-table/use-pipeline-table-keyboard-nav";
import { PipelineTableRow } from "@/app/(dashboard)/pipeline/_components/table/pipeline-table-row";
import type {
  PipelineTableColumnLayout,
  PipelineTableMetrics,
} from "@/app/(dashboard)/pipeline/_components/table/pipeline-table";
import type { OpportunityCellSaveState } from "@/lib/hooks/pipeline-table/use-opportunity-cell-edit";
import type { OpportunityStage } from "@/lib/types/pipeline";
import {
  PIPELINE_TABLE_COLUMNS,
  type PipelineTableColumnId,
  type PipelineTableEditableColumnId,
  type PipelineTableEditValue,
  type PipelineTableRow as PipelineTableRowModel,
} from "@/lib/types/pipeline-table";

// Lightweight dictionary: the table/row + cells call `useDictionary("pipeline")`.
// Echo the key so labels are deterministic.
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (key: string) => key }),
}));

// The assignee picker lazily loads team members when opened; stub to empty so an
// opened editor doesn't try to hit the network.
vi.mock("@/lib/hooks/use-users", () => ({
  useTeamMembers: () => ({ data: { users: [] }, isLoading: false }),
}));

const METRICS: PipelineTableMetrics = {
  zoom: 1,
  density: "compact",
  rowHeight: 36,
  headerHeight: 36,
  fontSize: 13,
  microFontSize: 11,
  avatarSize: 20,
  columnScale: 1,
};

const TEST_COLUMN_IDS: PipelineTableColumnId[] = [
  "select",
  "deal",
  "stage",
  "value",
  "assignee",
];

function makeRow(id: string, title: string): PipelineTableRowModel {
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
    assignmentVersion: 0,
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

const ROWS: PipelineTableRowModel[] = [
  makeRow("opp-1", "Deck rebuild"),
  makeRow("opp-2", "Shop bay"),
];

// Fixed clock for the aging/overdue cues. The test rows carry no follow-up /
// close dates and a null stale threshold, so no signal fires under any `now`;
// this only satisfies the required prop deterministically.
const NOW = new Date("2026-05-31T12:00:00.000Z");

function columnLayouts(): PipelineTableColumnLayout[] {
  return TEST_COLUMN_IDS.map((id) => {
    const column = PIPELINE_TABLE_COLUMNS.find(
      (candidate) => candidate.id === id
    );
    if (!column) throw new Error(`Missing test column ${id}`);
    return {
      column,
      width: column.width,
      stickyLeft: column.frozen ? 0 : null,
    };
  });
}

/**
 * Mirrors the real `PipelineTable` wiring (grid container + roving cells driven
 * by `usePipelineTableKeyboardNav`) but renders the rows directly instead of
 * through the virtualizer, so the DOM-level focus/tabindex behavior is testable
 * without the virtualizer's zero-height jsdom flakiness.
 */
function Harness({
  onCommitCell = vi.fn(),
  onUndo = vi.fn(),
  onFocusSearch = vi.fn(),
}: {
  onCommitCell?: (
    rowId: string,
    columnId: PipelineTableEditableColumnId,
    value: PipelineTableEditValue
  ) => void;
  onUndo?: () => void;
  onFocusSearch?: () => void;
}) {
  const {
    activeCell,
    editingCell,
    setActiveCell,
    beginEdit,
    cancelEdit,
    handleCellKeyDown,
  } = usePipelineTableKeyboardNav({
    rows: ROWS,
    columns: PIPELINE_TABLE_COLUMNS,
    onUndo,
    onFocusSearch,
  });

  const layouts = columnLayouts();
  const saveStates = new Map<string, OpportunityCellSaveState>();

  return (
    <div role="grid" aria-rowcount={ROWS.length} tabIndex={0}>
      <div style={{ position: "relative" }}>
        {ROWS.map((row, index) => (
          <PipelineTableRow
            key={row.id}
            row={row}
            columns={layouts}
            metrics={METRICS}
            selected={false}
            virtualStart={index * METRICS.rowHeight}
            totalWidth={800}
            now={NOW}
            saveStates={saveStates}
            activeCell={activeCell}
            editingCell={editingCell}
            canManage
            leadAccess={{
              canView: true,
              canEdit: true,
              canAssign: true,
              canUnassign: true,
              canConvert: true,
            }}
            setActiveCell={setActiveCell}
            onToggleRow={vi.fn()}
            onOpenDeal={vi.fn()}
            onBeginEdit={beginEdit}
            onCancelEdit={cancelEdit}
            onCellKeyDown={handleCellKeyDown}
            onCommitCell={onCommitCell}
            onRequestStageChange={vi.fn()}
            onRequestConvertAlreadyWon={vi.fn()}
          />
        ))}
      </div>
    </div>
  );
}

function renderHarness(props?: Parameters<typeof Harness>[0]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness {...props} />
    </QueryClientProvider>
  );
}

function cell(rowId: string, columnId: PipelineTableColumnId): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `[data-pipeline-table-row-id="${rowId}"][data-pipeline-table-column-id="${columnId}"]`
  );
  if (!el) throw new Error(`Cell not found: ${rowId}/${columnId}`);
  return el;
}

describe("pipeline table keyboard navigation (DOM wiring)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gives exactly one cell a roving tabindex of 0 (the active cell)", () => {
    renderHarness();
    // The hook seeds the active cell to the first cell (opp-1/select).
    const tabbable = Array.from(
      document.querySelectorAll<HTMLElement>("[data-pipeline-table-row-id]")
    ).filter((el) => el.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toBe(cell("opp-1", "select"));
  });

  it("moves DOM focus with arrow keys and updates the roving tabindex", () => {
    renderHarness();

    const start = cell("opp-1", "deal");
    act(() => {
      start.focus();
    });
    expect(start).toHaveFocus();

    act(() => {
      fireEvent.keyDown(start, { key: "ArrowRight" });
    });
    const next = cell("opp-1", "stage");
    expect(next).toHaveFocus();
    expect(next.getAttribute("tabindex")).toBe("0");
    expect(cell("opp-1", "deal").getAttribute("tabindex")).toBe("-1");

    act(() => {
      fireEvent.keyDown(next, { key: "ArrowDown" });
    });
    expect(cell("opp-2", "stage")).toHaveFocus();
  });

  it("begins editing an editable cell on Enter and focuses its input", () => {
    renderHarness();

    const valueCell = cell("opp-1", "value");
    act(() => {
      valueCell.focus();
    });
    act(() => {
      fireEvent.keyDown(valueCell, { key: "Enter" });
    });

    // The value editor mounts an <input>; the hook drove editing for this cell.
    const input = valueCell.querySelector("input");
    expect(input).not.toBeNull();
  });

  it("does not begin editing on Enter over the non-editable stage cell", () => {
    renderHarness();

    const stageCell = cell("opp-1", "stage");
    act(() => {
      stageCell.focus();
    });
    act(() => {
      fireEvent.keyDown(stageCell, { key: "Enter" });
    });

    // Stage is not inline-editable; no <input> editor appears.
    expect(stageCell.querySelector("input")).toBeNull();
  });

  it("typing inside an open editor does not bubble up as navigation", () => {
    renderHarness();

    const valueCell = cell("opp-1", "value");
    act(() => {
      valueCell.focus();
    });
    act(() => {
      fireEvent.keyDown(valueCell, { key: "Enter" });
    });
    const input = valueCell.querySelector("input");
    expect(input).not.toBeNull();

    // An ArrowRight originating from the input must NOT move the active cell —
    // the cell-level guard ignores keydowns bubbling from an <input>.
    act(() => {
      if (input) fireEvent.keyDown(input, { key: "ArrowRight" });
    });
    // Editor still mounted on the same cell (no navigation occurred).
    expect(cell("opp-1", "value").querySelector("input")).not.toBeNull();
  });

  it("commits via the value editor on Enter, then closes the editor", async () => {
    const onCommitCell = vi.fn();
    renderHarness({ onCommitCell });

    const valueCell = cell("opp-1", "value");
    act(() => {
      valueCell.focus();
    });
    act(() => {
      fireEvent.keyDown(valueCell, { key: "Enter" });
    });
    const input = valueCell.querySelector("input");
    expect(input).not.toBeNull();

    // commitDraft() is async (awaits onCommit); flush the microtask queue inside
    // act so the post-commit state settle is captured without a warning.
    await act(async () => {
      if (input) {
        fireEvent.change(input, { target: { value: "9000" } });
        fireEvent.keyDown(input, { key: "Enter" });
      }
      await Promise.resolve();
    });

    expect(onCommitCell).toHaveBeenCalledWith("opp-1", "value", 9000);
  });

  it("fires the grid shortcuts (⌘Z undo, ⌘F focus search) from a focused cell", () => {
    const onUndo = vi.fn();
    const onFocusSearch = vi.fn();
    renderHarness({ onUndo, onFocusSearch });

    const dealCell = cell("opp-1", "deal");
    act(() => {
      dealCell.focus();
    });

    act(() => {
      fireEvent.keyDown(dealCell, { key: "z", metaKey: true });
    });
    expect(onUndo).toHaveBeenCalledTimes(1);

    act(() => {
      fireEvent.keyDown(dealCell, { key: "f", metaKey: true });
    });
    expect(onFocusSearch).toHaveBeenCalledTimes(1);
  });
});
