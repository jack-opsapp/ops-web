/**
 * Tests for the pipeline table's GROUPED render path (Task 6.2) — the
 * grouping/collapse behavior layered over the single flattened virtualizer.
 *
 * The virtualizer is mocked to render EVERY flattened item (jsdom has no
 * layout, so the real virtualizer would yield zero virtual items). The mock
 * also captures the options it was constructed with, so we can assert the
 * deterministic per-kind `estimateSize` (headers vs data rows) and the
 * `flatItems`-derived count — the performance guardrails the task pins.
 *
 * `PipelineTableRow` is stubbed to a lean row marker so assertions target the
 * grouping logic (headers, rollups, collapse) rather than the heavy cell tree,
 * which is covered by its own tests.
 */

import React from "react";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpportunityStage } from "@/lib/types/pipeline";
import { useTableSelection } from "@/lib/hooks/projects-table/use-table-selection";
import { buildFlattenedRows } from "@/lib/utils/pipeline-table-grouping";
import type {
  PipelineTableRow as PipelineTableRowModel,
  PipelineTableSort,
} from "@/lib/types/pipeline-table";

// ── i18n: return the real string templates so `{count}` substitution + the
//    "// {count}" / "[VALUE]" labels render exactly as production. ────────────
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "table.gridLabel": "Pipeline table",
        "table.group.toggleLabel":
          "{stage} stage, {count} deals — collapse or expand",
        "table.group.count": "// {count}",
        "table.group.value": "[VALUE]",
      };
      return translations[key] ?? key;
    },
  }),
}));

// ── Capture the virtualizer options + render every flattened item. ────────────
const virtualizerOptions: { current: Record<string, unknown> | null } = {
  current: null,
};

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: Record<string, unknown>) => {
    virtualizerOptions.current = options;
    const count = options.count as number;
    const estimateSize = options.estimateSize as (index: number) => number;
    // Synthesize one virtual item per index, stacking starts from the per-kind
    // estimate so the rendered translateY values are deterministic.
    let start = 0;
    const items = Array.from({ length: count }, (_unused, index) => {
      const size = estimateSize(index);
      const item = { index, start, size, key: index };
      start += size;
      return item;
    });
    return {
      getVirtualItems: () => items,
      getTotalSize: () => start,
      measure: () => {},
    };
  },
}));

// ── Stub the data row to a lean marker carrying its id + stage. ───────────────
vi.mock(
  "@/app/(dashboard)/pipeline/_components/table/pipeline-table-row",
  () => ({
    PipelineTableRow: ({ row }: { row: PipelineTableRowModel }) => (
      <div
        data-testid="data-row"
        data-row-id={row.id}
        data-row-stage={row.stage}
        role="row"
      />
    ),
  })
);

// ── Stub the header chrome (sticky column header). Expose the select-all state
//    the table feeds it, so we can assert the checkbox reflects ONLY the visible
//    (un-collapsed) rows without dragging in the real header's cell tree. ───────
vi.mock(
  "@/app/(dashboard)/pipeline/_components/table/pipeline-table-header",
  () => ({
    PipelineTableHeader: ({
      allVisibleSelected,
      onToggleSelectAllVisible,
    }: {
      allVisibleSelected: boolean;
      onToggleSelectAllVisible: () => void;
    }) => (
      <div data-testid="column-header">
        <button
          type="button"
          role="checkbox"
          aria-checked={allVisibleSelected}
          aria-label="select-all-visible"
          onClick={onToggleSelectAllVisible}
        />
      </div>
    ),
  })
);

import { PipelineTable } from "@/app/(dashboard)/pipeline/_components/table/pipeline-table";
import { GROUP_HEADER_HEIGHT } from "@/app/(dashboard)/pipeline/_components/table/pipeline-stage-group-header";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRow(
  overrides: Partial<PipelineTableRowModel> & { id: string }
): PipelineTableRowModel {
  return {
    companyId: "co-1",
    title: overrides.id,
    stage: OpportunityStage.NewLead,
    clientId: null,
    clientName: null,
    estimatedValue: 0,
    winProbability: null,
    weightedValue: 0,
    ageInStageDays: null,
    lastActivityAt: null,
    nextFollowUpAt: null,
    expectedCloseDate: null,
    assignedTo: null,
    assignmentVersion: 0,
    assigneeName: null,
    source: null,
    priority: null,
    correspondenceCount: 0,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastMessageDirection: null,
    handledAt: null,
    operatorActionRequiredAt: null,
    stageEnteredAt: null,
    projectId: null,
    updatedAt: null,
    staleThresholdDays: null,
    winProbabilityIsFallback: false,
    ...overrides,
  };
}

// 2 NewLead + 1 Qualifying + 2 Quoting; value/weighted chosen so rollups are
// unambiguous. NewLead: value 100, wtd 10 · Qualifying: value 200, wtd 40 ·
// Quoting: value 350, wtd 210. Grand: value 650, wtd 260.
const ROWS: PipelineTableRowModel[] = [
  makeRow({
    id: "n1",
    stage: OpportunityStage.NewLead,
    estimatedValue: 100,
    weightedValue: 10,
  }),
  makeRow({
    id: "n2",
    stage: OpportunityStage.NewLead,
    estimatedValue: 0,
    weightedValue: 0,
  }),
  makeRow({
    id: "ql1",
    stage: OpportunityStage.Qualifying,
    estimatedValue: 200,
    weightedValue: 40,
  }),
  makeRow({
    id: "q1",
    stage: OpportunityStage.Quoting,
    estimatedValue: 300,
    weightedValue: 180,
  }),
  makeRow({
    id: "q2",
    stage: OpportunityStage.Quoting,
    estimatedValue: 50,
    weightedValue: 30,
  }),
];

const METRICS = {
  zoom: 1,
  density: "compact" as const,
  rowHeight: 40,
  headerHeight: 32,
  fontSize: 13,
  microFontSize: 11,
  avatarSize: 20,
  columnScale: 1,
};

const NOOP = () => {};

function renderTable(
  props: Partial<React.ComponentProps<typeof PipelineTable>> = {}
) {
  return render(
    <PipelineTable
      rows={ROWS}
      sorting={[] as PipelineTableSort[]}
      onSortingChange={NOOP}
      grouped={false}
      collapsedStages={new Set()}
      onToggleStageCollapse={NOOP}
      metrics={METRICS}
      now={new Date("2026-06-01T00:00:00Z")}
      selectedIds={new Set()}
      onToggleRow={NOOP}
      onToggleSelectAllVisible={NOOP}
      onOpenDeal={NOOP}
      saveStates={new Map()}
      activeCell={null}
      editingCell={null}
      canManage={false}
      setActiveCell={NOOP}
      onBeginEdit={NOOP}
      onCancelEdit={NOOP}
      onCellKeyDown={NOOP}
      onCommitCell={NOOP}
      onRequestStageChange={NOOP}
      onRequestConvertAlreadyWon={NOOP}
      {...props}
    />
  );
}

function headerRollup(stageLabel: string) {
  // The group-header button's accessible name is "{stage} stage, {count} deals…".
  return screen.getByRole("row", { name: new RegExp(`^${stageLabel} stage,`) });
}

afterEach(() => {
  virtualizerOptions.current = null;
  vi.clearAllMocks();
});

describe("PipelineTable — flat (ungrouped) mode", () => {
  it("renders only data rows, no group headers", () => {
    renderTable({ grouped: false });

    expect(screen.getAllByTestId("data-row")).toHaveLength(5);
    expect(screen.queryByRole("row", { name: /stage,/ })).toBeNull();
  });

  it("feeds the virtualizer a count equal to the row count (no headers)", () => {
    renderTable({ grouped: false });
    expect(virtualizerOptions.current?.count).toBe(5);
  });
});

describe("PipelineTable — grouped mode", () => {
  beforeEach(() => {
    renderTable({ grouped: true });
  });

  it("renders one header per present stage in sort order, then its rows", () => {
    const headers = screen.getAllByRole("row", { name: /stage,/ });
    expect(headers.map((h) => h.getAttribute("aria-label"))).toEqual([
      "New Lead stage, 2 deals — collapse or expand",
      "Qualifying stage, 1 deals — collapse or expand",
      "Quoting stage, 2 deals — collapse or expand",
    ]);
    // All 5 data rows still rendered (nothing collapsed).
    expect(screen.getAllByTestId("data-row")).toHaveLength(5);
  });

  it("shows count and concrete value rollups without weighted forecasts", () => {
    const newLead = headerRollup("New Lead");
    expect(within(newLead).getByText("// 2")).toBeInTheDocument();
    expect(within(newLead).getByText("$100")).toBeInTheDocument();
    expect(within(newLead).queryByText("$10")).not.toBeInTheDocument();
    expect(within(newLead).queryByText("[WTD]")).not.toBeInTheDocument();

    const quoting = headerRollup("Quoting");
    expect(within(quoting).getByText("// 2")).toBeInTheDocument();
    expect(within(quoting).getByText("$350")).toBeInTheDocument();
    expect(within(quoting).queryByText("$210")).not.toBeInTheDocument();
  });

  it("marks every header expanded (aria-expanded=true) when nothing is collapsed", () => {
    for (const header of screen.getAllByRole("row", { name: /stage,/ })) {
      expect(header).toHaveAttribute("aria-expanded", "true");
    }
  });

  it("feeds the virtualizer a count of headers + data rows (3 + 5 = 8)", () => {
    expect(virtualizerOptions.current?.count).toBe(8);
  });

  it("uses per-kind estimateSize: GROUP_HEADER_HEIGHT for headers, rowHeight for data", () => {
    const estimateSize = virtualizerOptions.current?.estimateSize as (
      i: number
    ) => number;
    // Stream order: header(0), n1(1), n2(2), header(3), ql1(4), header(5), q1(6), q2(7).
    expect(estimateSize(0)).toBe(GROUP_HEADER_HEIGHT);
    expect(estimateSize(1)).toBe(METRICS.rowHeight);
    expect(estimateSize(3)).toBe(GROUP_HEADER_HEIGHT);
    expect(estimateSize(4)).toBe(METRICS.rowHeight);
  });

  it("derives a stable per-item key (data:id / group-header:stage)", () => {
    const getItemKey = virtualizerOptions.current?.getItemKey as (
      i: number
    ) => string;
    expect(getItemKey(0)).toBe(`group-header:${OpportunityStage.NewLead}`);
    expect(getItemKey(1)).toBe("data:n1");
    expect(getItemKey(5)).toBe(`group-header:${OpportunityStage.Quoting}`);
    expect(getItemKey(6)).toBe("data:q1");
  });
});

describe("PipelineTable — collapse / expand", () => {
  it("hides a collapsed stage's data rows but keeps its header (with full rollup)", () => {
    renderTable({
      grouped: true,
      collapsedStages: new Set([OpportunityStage.NewLead]),
    });

    // NewLead header still present, marked collapsed; its rollup still totals
    // the full stage even though its rows are gone.
    const newLead = headerRollup("New Lead");
    expect(newLead).toHaveAttribute("aria-expanded", "false");
    expect(within(newLead).getByText("// 2")).toBeInTheDocument();
    expect(within(newLead).getByText("$100")).toBeInTheDocument();

    // The two NewLead data rows are absent; the other 3 rows remain.
    const dataRows = screen.getAllByTestId("data-row");
    expect(dataRows).toHaveLength(3);
    expect(
      dataRows.filter(
        (r) => r.getAttribute("data-row-stage") === OpportunityStage.NewLead
      )
    ).toHaveLength(0);

    // Virtualizer count drops to 3 headers + 3 data rows.
    expect(virtualizerOptions.current?.count).toBe(6);

    // aria-rowcount counts ONLY rendered data rows (excludes the 3 group
    // headers AND the collapsed stage's 2 hidden rows) — 3 visible data rows.
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "3");
  });

  it("aria-rowcount counts data rows only (excludes group headers) when nothing is collapsed", () => {
    renderTable({ grouped: true });
    // 3 headers + 5 data rows are rendered; aria-rowcount reports the 5 data rows.
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "5");
  });

  it("invokes onToggleStageCollapse with the stage when its header is clicked", () => {
    const onToggle = vi.fn();
    renderTable({ grouped: true, onToggleStageCollapse: onToggle });

    fireEvent.click(headerRollup("Qualifying"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(OpportunityStage.Qualifying);
  });
});

describe("PipelineTable — select-all is scoped to VISIBLE (un-collapsed) rows", () => {
  const selectAllCheckbox = () =>
    screen.getByRole("checkbox", { name: "select-all-visible" });

  it("header checkbox reads checked once every VISIBLE row is selected, ignoring a collapsed stage's hidden rows", () => {
    // NewLead collapsed → its rows (n1, n2) are hidden. The visible rows are
    // ql1, q1, q2. Selecting exactly those three must check the header box even
    // though the two collapsed-stage rows are NOT in the selection.
    renderTable({
      grouped: true,
      collapsedStages: new Set([OpportunityStage.NewLead]),
      selectedIds: new Set(["ql1", "q1", "q2"]),
    });
    expect(selectAllCheckbox()).toHaveAttribute("aria-checked", "true");
  });

  it("header checkbox reads unchecked when a visible row is unselected, even if all hidden rows are selected", () => {
    // Every row selected EXCEPT one visible row (q2); the collapsed NewLead rows
    // are selected but must not prop the checkbox to checked.
    renderTable({
      grouped: true,
      collapsedStages: new Set([OpportunityStage.NewLead]),
      selectedIds: new Set(["n1", "n2", "ql1", "q1"]),
    });
    expect(selectAllCheckbox()).toHaveAttribute("aria-checked", "false");
  });

  it("toggling the header checkbox forwards a single select-all toggle (shell owns direction) while not all visible rows are selected", () => {
    const onToggleSelectAllVisible = vi.fn();
    renderTable({
      grouped: true,
      collapsedStages: new Set([OpportunityStage.NewLead]),
      selectedIds: new Set(["ql1"]),
      onToggleSelectAllVisible,
    });

    fireEvent.click(selectAllCheckbox());
    expect(onToggleSelectAllVisible).toHaveBeenCalledTimes(1);
  });

  it("toggling the header checkbox forwards the SAME single toggle even when every visible row is already selected", () => {
    // The table no longer branches select-vs-clear — it always forwards one
    // toggle so the shell can scope the deselect to RENDERED rows and leave
    // collapsed-stage selections intact. NewLead is collapsed; ql1/q1/q2 (the
    // rendered rows) are all selected, so the checkbox reads checked.
    const onToggleSelectAllVisible = vi.fn();
    renderTable({
      grouped: true,
      collapsedStages: new Set([OpportunityStage.NewLead]),
      selectedIds: new Set(["ql1", "q1", "q2"]),
      onToggleSelectAllVisible,
    });

    expect(selectAllCheckbox()).toHaveAttribute("aria-checked", "true");
    fireEvent.click(selectAllCheckbox());
    expect(onToggleSelectAllVisible).toHaveBeenCalledTimes(1);
  });
});

// ── Shell selection wiring (persistence across collapse + scoped select-all) ──
// `PipelineTable` is presentational — it receives `selectedIds` as a prop and
// can't show selection STATE changing on collapse. That state lives in the
// shell's composition of `useTableSelection` with two deliberately-decoupled row
// sets. This block reproduces that exact wiring around the REAL shared hook and
// asserts the corrected behavior: collapse is a pure view toggle (never prunes a
// selection), while select-all + the checkbox stay scoped to rendered rows.
describe("PipelineTableShell selection wiring — persistence across collapse", () => {
  /**
   * Mirror of the shell's selection composition. `selectableRowIds` is the FULL
   * post-search set (collapse-invariant — built with an EMPTY collapsed set so
   * every row is present for pruning/persistence) but ordered in the RENDERED,
   * grouped sequence so the hook's `range` math matches the screen.
   * `renderedDataRowIds` is the collapse-narrowed rendered set that select-all
   * targets via the hook's `toggleRow("toggle")` — exactly as the shell does.
   */
  function useShellSelection(args: {
    rows: PipelineTableRowModel[];
    grouped: boolean;
    collapsedStages: ReadonlySet<OpportunityStage>;
  }) {
    const selectableRowIds = buildFlattenedRows(args.rows, {
      grouped: args.grouped,
      collapsedStages: new Set<OpportunityStage>(),
    }).flatMap((item) => (item.kind === "data" ? [item.row.id] : []));
    const renderedDataRowIds = buildFlattenedRows(args.rows, {
      grouped: args.grouped,
      collapsedStages: args.collapsedStages,
    }).flatMap((item) => (item.kind === "data" ? [item.row.id] : []));

    const { selectedIds, selectedCount, toggleRow, clearSelection } =
      useTableSelection(selectableRowIds);

    const selectAllVisible = () => {
      if (renderedDataRowIds.length === 0) return;
      const allRenderedSelected = renderedDataRowIds.every((id) =>
        selectedIds.has(id)
      );
      if (allRenderedSelected) {
        for (const id of renderedDataRowIds) toggleRow(id, "toggle");
        return;
      }
      for (const id of renderedDataRowIds) {
        if (!selectedIds.has(id)) toggleRow(id, "toggle");
      }
    };

    const allRenderedSelected =
      renderedDataRowIds.length > 0 &&
      renderedDataRowIds.every((id) => selectedIds.has(id));

    return {
      selectedIds,
      selectedCount,
      selectableRowIds,
      renderedDataRowIds,
      allRenderedSelected,
      toggleRow,
      clearSelection,
      selectAllVisible,
    };
  }

  it("keeps a stage's rows selected when that stage is collapsed, and on re-expand", () => {
    // Select 2 deals in NewLead (n1, n2) and 1 in Qualifying (ql1) → count 3.
    const { result, rerender } = renderHook(
      ({ collapsed }: { collapsed: ReadonlySet<OpportunityStage> }) =>
        useShellSelection({
          rows: ROWS,
          grouped: true,
          collapsedStages: collapsed,
        }),
      { initialProps: { collapsed: new Set<OpportunityStage>() } }
    );

    act(() => result.current.toggleRow("n1", "toggle"));
    act(() => result.current.toggleRow("n2", "toggle"));
    act(() => result.current.toggleRow("ql1", "toggle"));
    expect(result.current.selectedCount).toBe(3);

    // Collapse NewLead — a pure VIEW toggle. Its two rows must STAY selected.
    rerender({ collapsed: new Set([OpportunityStage.NewLead]) });
    expect(result.current.selectedCount).toBe(3);
    expect([...result.current.selectedIds].sort()).toEqual(["n1", "n2", "ql1"]);
    // The header checkbox reflects only the RENDERED rows — n1/n2 are hidden, so
    // not every rendered row (ql1, q1, q2) is selected → unchecked.
    expect(result.current.allRenderedSelected).toBe(false);

    // Expand again — still selected, nothing lost.
    rerender({ collapsed: new Set<OpportunityStage>() });
    expect(result.current.selectedCount).toBe(3);
    expect([...result.current.selectedIds].sort()).toEqual(["n1", "n2", "ql1"]);
  });

  it("prunes a selected row that genuinely leaves via search/filter (collapse is the only thing that doesn't prune)", () => {
    // Selection still tracks the FULL set: when a row is removed from the post-
    // search row set entirely, it IS dropped (the real intent of the prune).
    const { result, rerender } = renderHook(
      ({ rows }: { rows: PipelineTableRowModel[] }) =>
        useShellSelection({ rows, grouped: true, collapsedStages: new Set() }),
      { initialProps: { rows: ROWS } }
    );

    act(() => result.current.toggleRow("ql1", "toggle"));
    expect(result.current.selectedCount).toBe(1);

    // A search removes ql1 from the row set → pruned from selection.
    rerender({ rows: ROWS.filter((r) => r.id !== "ql1") });
    expect(result.current.selectedCount).toBe(0);
  });

  it("select-all with a stage collapsed selects only rendered rows — never the hidden ones", () => {
    const { result } = renderHook(() =>
      useShellSelection({
        rows: ROWS,
        grouped: true,
        collapsedStages: new Set([OpportunityStage.NewLead]),
      })
    );

    act(() => result.current.selectAllVisible());
    // Rendered rows are ql1, q1, q2 (NewLead's n1/n2 are collapsed away).
    expect([...result.current.selectedIds].sort()).toEqual(["q1", "q2", "ql1"]);
    expect(result.current.allRenderedSelected).toBe(true);
  });

  it("select-all does NOT deselect already-selected hidden rows", () => {
    const { result } = renderHook(() =>
      useShellSelection({
        rows: ROWS,
        grouped: true,
        collapsedStages: new Set([OpportunityStage.NewLead]),
      })
    );

    // Pre-select a hidden (collapsed-stage) row, then run select-all.
    act(() => result.current.toggleRow("n1", "toggle"));
    act(() => result.current.selectAllVisible());

    // The hidden n1 stays selected; the rendered rows get added on top.
    expect([...result.current.selectedIds].sort()).toEqual([
      "n1",
      "q1",
      "q2",
      "ql1",
    ]);
  });

  it("select-all toggles OFF only the rendered rows when all rendered are already selected, leaving hidden selections intact", () => {
    const { result } = renderHook(() =>
      useShellSelection({
        rows: ROWS,
        grouped: true,
        collapsedStages: new Set([OpportunityStage.NewLead]),
      })
    );

    // Hidden n1 selected + all rendered (ql1, q1, q2) selected.
    act(() => result.current.toggleRow("n1", "toggle"));
    act(() => result.current.selectAllVisible());
    expect(result.current.allRenderedSelected).toBe(true);

    // Toggling again deselects ONLY the rendered rows; hidden n1 survives.
    act(() => result.current.selectAllVisible());
    expect([...result.current.selectedIds]).toEqual(["n1"]);
  });
});

// ── Grouped range-select order (FIX: shift-click selects the RENDERED span) ───
// The shared `useTableSelection` range fills the span between anchor + target in
// the order of the id list it's given. When grouped, the rendered order is stage-
// bucketed (OPPORTUNITY_STAGE_SORT_ORDER), which differs from the flat-sorted
// order the data arrives in. The shell now derives `selectableRowIds` from
// `buildFlattenedRows` (grouped, empty collapsed set) so range math matches the
// screen — while membership still covers every row so selections persist across
// collapse. This block uses a fixture whose FLAT order ≠ grouped order to prove
// the distinction (if the shell passed flat order, the wrong rows would select).
describe("PipelineTableShell selection wiring — grouped range-select order", () => {
  function useShellSelection(args: {
    rows: PipelineTableRowModel[];
    grouped: boolean;
    collapsedStages: ReadonlySet<OpportunityStage>;
  }) {
    const selectableRowIds = buildFlattenedRows(args.rows, {
      grouped: args.grouped,
      collapsedStages: new Set<OpportunityStage>(),
    }).flatMap((item) => (item.kind === "data" ? [item.row.id] : []));
    const renderedDataRowIds = buildFlattenedRows(args.rows, {
      grouped: args.grouped,
      collapsedStages: args.collapsedStages,
    }).flatMap((item) => (item.kind === "data" ? [item.row.id] : []));

    const { selectedIds, selectedCount, toggleRow } =
      useTableSelection(selectableRowIds);

    return {
      selectedIds,
      selectedCount,
      selectableRowIds,
      renderedDataRowIds,
      toggleRow,
    };
  }

  // Flat (data-arrival) order interleaves stages: q-first, then a New Lead, then
  // a Quoting, then a New Lead, then Qualifying. Grouped/rendered order buckets
  // by stage: NewLead (a1, a2) · Qualifying (c1) · Quoting (b1, b2).
  const INTERLEAVED: PipelineTableRowModel[] = [
    makeRow({ id: "b1", stage: OpportunityStage.Quoting }),
    makeRow({ id: "a1", stage: OpportunityStage.NewLead }),
    makeRow({ id: "b2", stage: OpportunityStage.Quoting }),
    makeRow({ id: "a2", stage: OpportunityStage.NewLead }),
    makeRow({ id: "c1", stage: OpportunityStage.Qualifying }),
  ];

  it("orders selectableRowIds by the rendered (stage-grouped) sequence, not flat arrival order", () => {
    const { result } = renderHook(() =>
      useShellSelection({
        rows: INTERLEAVED,
        grouped: true,
        collapsedStages: new Set(),
      })
    );
    // NewLead (a1,a2) → Qualifying (c1) → Quoting (b1,b2).
    expect(result.current.selectableRowIds).toEqual([
      "a1",
      "a2",
      "c1",
      "b1",
      "b2",
    ]);
  });

  it("a shift-click from a row in stage A to a row in stage B selects the rendered-contiguous span (stage order)", () => {
    const { result } = renderHook(() =>
      useShellSelection({
        rows: INTERLEAVED,
        grouped: true,
        collapsedStages: new Set(),
      })
    );

    // Anchor on a2 (last NewLead row), then shift-click b1 (first Quoting row).
    // Rendered order is [a1, a2, c1, b1, b2] → the span a2..b1 is {a2, c1, b1}.
    act(() => result.current.toggleRow("a2", "toggle"));
    act(() => result.current.toggleRow("b1", "range"));
    expect([...result.current.selectedIds].sort()).toEqual(["a2", "b1", "c1"]);

    // A FLAT-ordered list would have been [b1, a1, b2, a2, c1]; the a2..b1 span
    // there is {b1, a1, b2, a2} — explicitly NOT what we selected, proving the
    // range followed rendered order.
    expect(result.current.selectedIds.has("a1")).toBe(false);
    expect(result.current.selectedIds.has("b2")).toBe(false);
  });

  it("range-selected rows persist across a collapse/expand of an unrelated stage", () => {
    const { result, rerender } = renderHook(
      ({ collapsed }: { collapsed: ReadonlySet<OpportunityStage> }) =>
        useShellSelection({
          rows: INTERLEAVED,
          grouped: true,
          collapsedStages: collapsed,
        }),
      { initialProps: { collapsed: new Set<OpportunityStage>() } }
    );

    // Select the rendered span a2..b1 = {a2, c1, b1}.
    act(() => result.current.toggleRow("a2", "toggle"));
    act(() => result.current.toggleRow("b1", "range"));
    expect(result.current.selectedCount).toBe(3);

    // Collapse Quoting (holds b1, a selected row). Pure view toggle → still 3.
    rerender({ collapsed: new Set([OpportunityStage.Quoting]) });
    expect(result.current.selectedCount).toBe(3);
    expect([...result.current.selectedIds].sort()).toEqual(["a2", "b1", "c1"]);

    // Expand again — nothing lost.
    rerender({ collapsed: new Set<OpportunityStage>() });
    expect([...result.current.selectedIds].sort()).toEqual(["a2", "b1", "c1"]);
  });
});
