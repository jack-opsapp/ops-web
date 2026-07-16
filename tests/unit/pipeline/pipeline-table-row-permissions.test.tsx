/**
 * Tests for pipeline-table WRITE-affordance gating on `pipeline.manage`.
 *
 * A view-only operator (has `pipeline.view`, NOT `pipeline.manage`) must see a
 * READ-ONLY table: no inline-edit affordances on the editable columns (value /
 * next_follow_up / expected_close / assignee), no stage menu, no per-row select
 * checkbox, and no select-all checkbox in the header. Every one of those feeds a
 * write that would only fail at RLS, so the affordance must not exist for them.
 *
 * Read-only operators KEEP every read affordance: sorting (header sort buttons)
 * and opening the detail panel (a row-cell click) both stay available — only the
 * WRITE paths are gated.
 *
 * The shell resolves the gate via `usePermissionStore((s) => s.can("pipeline.manage"))`
 * and threads the boolean down as `canManage`. We mock that store's `can` to
 * grant ONLY `pipeline.view` (the view-only context the task calls out), confirm
 * it resolves `canManage === false`, then drive the real row + header with that
 * value — so the test exercises the same flag the shell computes.
 */

import * as React from "react";
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpportunityStage } from "@/lib/types/pipeline";
import {
  PIPELINE_TABLE_COLUMNS,
  type PipelineTableColumnId,
  type PipelineTableRow as PipelineTableRowModel,
  type PipelineTableSort,
} from "@/lib/types/pipeline-table";
import type {
  PipelineTableColumnLayout,
  PipelineTableMetrics,
} from "@/app/(dashboard)/pipeline/_components/table/pipeline-table";

// Echo-key dictionary so labels are deterministic across the row/header/cells.
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (key: string) => key }),
}));

// The assignee picker lazily loads team members when opened; stub to empty so an
// (accidentally) opened editor never hits the network.
vi.mock("@/lib/hooks/use-users", () => ({
  useTeamMembers: () => ({ data: { users: [] }, isLoading: false }),
}));

// ── Permission store: grant ONLY pipeline.view (the view-only context). ───────
// The mock mirrors the real store's `can(permission, scope?)` shape so the shell
// selector `s.can("pipeline.manage")` resolves false while `s.can("pipeline.view")`
// resolves true.
const grantedPermissions = new Set<string>(["pipeline.view"]);

vi.mock("@/lib/store/permissions-store", () => {
  const can = (permission: string) => grantedPermissions.has(permission);
  const state = { can };
  const usePermissionStore = Object.assign(
    (selector: (s: { can: (permission: string) => boolean }) => unknown) =>
      selector(state),
    { getState: () => state }
  );
  return { usePermissionStore };
});

import { usePermissionStore } from "@/lib/store/permissions-store";
import { PipelineTableRow } from "@/app/(dashboard)/pipeline/_components/table/pipeline-table-row";
import { PipelineTableHeader } from "@/app/(dashboard)/pipeline/_components/table/pipeline-table-header";

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

// The columns that exercise gating: the frozen select rail, an inline-editable
// value/date/assignee, the actionable stage cell, and a plain read-only column.
const TEST_COLUMN_IDS: PipelineTableColumnId[] = [
  "select",
  "deal",
  "stage",
  "value",
  "next_follow_up",
  "assignee",
  "client",
];

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

function makeRow(id: string): PipelineTableRowModel {
  return {
    id,
    companyId: "co-1",
    title: `Deal ${id}`,
    stage: OpportunityStage.Qualifying,
    clientId: null,
    clientName: "Acme",
    estimatedValue: 5000,
    winProbability: 20,
    weightedValue: 1000,
    ageInStageDays: 3,
    lastActivityAt: null,
    nextFollowUpAt: null,
    expectedCloseDate: null,
    assignedTo: null,
    assignmentVersion: 0,
    assigneeName: "Ada Lovelace",
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

const ROW = makeRow("opp-1");
const NOW = new Date("2026-06-01T00:00:00.000Z");
const NOOP = () => {};

function renderRow(
  canManage: boolean,
  props?: Partial<React.ComponentProps<typeof PipelineTableRow>>
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <div role="grid">
        <PipelineTableRow
          row={ROW}
          columns={columnLayouts()}
          metrics={METRICS}
          selected={false}
          virtualStart={0}
          totalWidth={900}
          now={NOW}
          saveStates={new Map()}
          activeCell={null}
          editingCell={null}
          canManage={canManage}
          leadAccess={
            canManage
              ? {
                  canView: true,
                  canEdit: true,
                  canAssign: true,
                  canUnassign: true,
                  canConvert: true,
                }
              : undefined
          }
          setActiveCell={NOOP}
          onToggleRow={NOOP}
          onOpenDeal={NOOP}
          onBeginEdit={NOOP}
          onCancelEdit={NOOP}
          onCellKeyDown={NOOP}
          onCommitCell={NOOP}
          onRequestStageChange={NOOP}
          onRequestConvertAlreadyWon={NOOP}
          {...props}
        />
      </div>
    </QueryClientProvider>
  );
}

function renderHeader(
  canManage: boolean,
  props?: Partial<React.ComponentProps<typeof PipelineTableHeader>>
) {
  return render(
    <PipelineTableHeader
      columns={columnLayouts()}
      metrics={METRICS}
      sorting={[] as PipelineTableSort[]}
      canManage={canManage}
      allVisibleSelected={false}
      onSortChange={NOOP}
      onToggleSelectAllVisible={NOOP}
      {...props}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  grantedPermissions.clear();
  grantedPermissions.add("pipeline.view");
});

describe("pipeline.manage gate — view-only context resolves canManage=false", () => {
  it("the shell's selector resolves false for pipeline.manage while pipeline.view is granted", () => {
    const { result } = renderHook(() => ({
      manage: usePermissionStore((s) => s.can("pipeline.manage")),
      view: usePermissionStore((s) => s.can("pipeline.view")),
    }));
    expect(result.current.view).toBe(true);
    expect(result.current.manage).toBe(false);
  });
});

describe("PipelineTableRow — view-only (no pipeline.manage)", () => {
  it("renders NO per-row select checkbox", () => {
    renderRow(false);
    expect(
      screen.queryByRole("checkbox", { name: "table.column.select" })
    ).toBeNull();
  });

  it("renders READ-ONLY editable columns — no inline-edit triggers", () => {
    renderRow(false);
    // The editable assignee/value/date columns expose interactive triggers ONLY
    // in manage mode (a popover/listbox trigger or an edit button). View-only
    // renders the plain read-only cells (spans), so no listbox triggers exist
    // and the assignee trigger button is absent.
    expect(
      screen.queryByRole("button", { name: "table.cell.assignee.triggerLabel" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "table.column.next_follow_up" })
    ).toBeNull();
    // No inline inputs are mounted anywhere in the row.
    expect(document.querySelector("input")).toBeNull();
    // The read-only assignee text still renders (the column is legible, just not editable).
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("renders the stage cell as a STATIC chip — no stage menu trigger", () => {
    renderRow(false);
    expect(
      screen.queryByRole("button", { name: "table.cell.stage.triggerLabel" })
    ).toBeNull();
  });

  it("KEEPS the read path — a click on a read-only cell opens the deal detail", () => {
    const onOpenDeal = vi.fn();
    renderRow(false, { onOpenDeal });
    fireEvent.click(
      document.querySelector(
        '[data-pipeline-table-column-id="client"]'
      ) as HTMLElement
    );
    expect(onOpenDeal).toHaveBeenCalledWith("opp-1");
  });

  it("does NOT begin editing when an (now read-only) editable column is clicked — it opens the deal", () => {
    const onBeginEdit = vi.fn();
    const onOpenDeal = vi.fn();
    renderRow(false, { onBeginEdit, onOpenDeal });
    fireEvent.click(
      document.querySelector(
        '[data-pipeline-table-column-id="value"]'
      ) as HTMLElement
    );
    expect(onBeginEdit).not.toHaveBeenCalled();
    expect(onOpenDeal).toHaveBeenCalledWith("opp-1");
  });
});

describe("PipelineTableRow — manage (has pipeline.manage)", () => {
  it("keeps a non-assigned row read-only under view-all/edit-assigned", () => {
    renderRow(true, {
      leadAccess: {
        canView: true,
        canEdit: false,
        canAssign: false,
        canUnassign: false,
        canConvert: false,
      },
    });

    expect(
      screen.queryByRole("checkbox", { name: "table.column.select" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "table.cell.stage.triggerLabel" })
    ).toBeNull();
  });

  it("renders the per-row select checkbox", () => {
    renderRow(true);
    expect(
      screen.getByRole("checkbox", { name: "table.column.select" })
    ).toBeInTheDocument();
  });

  it("keeps assignment read-only in the scan row and exposes the stage editor", () => {
    renderRow(true);
    expect(
      screen.queryByRole("button", { name: "table.cell.assignee.triggerLabel" })
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "table.cell.stage.triggerLabel" })
    ).toBeInTheDocument();
  });

  it("begins editing when an editable column is clicked", () => {
    const onBeginEdit = vi.fn();
    renderRow(true, { onBeginEdit });
    fireEvent.click(
      document.querySelector(
        '[data-pipeline-table-column-id="value"]'
      ) as HTMLElement
    );
    expect(onBeginEdit).toHaveBeenCalledWith("opp-1", "value");
  });
});

describe("PipelineTableHeader — select-all is manage-gated, sorting is not", () => {
  it("hides the select-all checkbox for a view-only operator", () => {
    renderHeader(false);
    expect(
      screen.queryByRole("checkbox", { name: "table.column.select" })
    ).toBeNull();
  });

  it("renders the select-all checkbox for a manage operator", () => {
    renderHeader(true);
    expect(
      screen.getByRole("checkbox", { name: "table.column.select" })
    ).toBeInTheDocument();
  });

  it("KEEPS sorting available for a view-only operator (sort header buttons fire)", () => {
    const onSortChange = vi.fn();
    renderHeader(false, { onSortChange });
    // The `value` column is sortable; its header button must still be clickable.
    fireEvent.click(screen.getByText("table.column.value"));
    expect(onSortChange).toHaveBeenCalledTimes(1);
  });
});
