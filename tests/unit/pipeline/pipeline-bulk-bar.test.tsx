import React, { type ReactNode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpportunityStage } from "@/lib/types/pipeline";
import type { PipelineTableRow } from "@/lib/types/pipeline-table";
import type { LeadAccess } from "@/lib/permissions/lead-access-policy";

// ── Mocks ──────────────────────────────────────────────────────────────────
// The bulk bar fans out to OpportunityService.{updateOpportunity,
// archiveOpportunity, unarchiveOpportunity} (via the hooks) and
// guarded lead-assignment service. Mock just those barrel methods.
const {
  updateOpportunity,
  archiveOpportunity,
  unarchiveOpportunity,
  listCandidates,
  changeAssignment,
} = vi.hoisted(() => ({
  updateOpportunity: vi.fn(),
  archiveOpportunity: vi.fn(),
  unarchiveOpportunity: vi.fn(),
  listCandidates: vi.fn(),
  changeAssignment: vi.fn(),
}));

vi.mock("@/lib/firebase/auth", () => ({ getIdToken: vi.fn() }));

vi.mock("@/lib/api/services/lead-assignment-service", () => {
  class LeadAssignmentConflictError extends Error {
    assignedTo: string | null;
    assignmentVersion: number;
    constructor(assignedTo: string | null, assignmentVersion: number) {
      super("conflict");
      this.assignedTo = assignedTo;
      this.assignmentVersion = assignmentVersion;
    }
  }
  return {
    LeadAssignmentConflictError,
    LeadAssignmentService: { changeAssignment, listCandidates },
  };
});

vi.mock("@/lib/api/services/opportunity-service", () => ({
  OpportunityService: {
    updateOpportunity,
    archiveOpportunity,
    unarchiveOpportunity,
  },
}));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/components/ui/toast", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

// Flat key-echo dictionary with {placeholder} interpolation so assertions read
// against real templated strings.
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string) =>
      ({
        "table.bulk.selectedCount": "// {count} SELECTED",
        "table.bulk.selectAll": "Select all {count}",
        "table.bulk.reassign": "Reassign assignee",
        "table.bulk.selectAssignee": "Select assignee",
        "table.bulk.unassign": "— Unassigned —",
        "table.bulk.setFollowUp": "Set follow-up",
        "table.bulk.changePriority": "Set priority",
        "table.bulk.priorityLow": "Low",
        "table.bulk.priorityMedium": "Medium",
        "table.bulk.priorityHigh": "High",
        "table.bulk.archive": "Archive",
        "table.bulk.clear": "Clear",
        "table.bulk.reassignDone": "Assignee set on {count} deals",
        "table.bulk.setFollowUpDone": "Follow-up set on {count} deals",
        "table.bulk.priorityDone": "Priority set on {count} deals",
        "table.bulk.archiveDone": "{count} deals archived",
        "table.bulk.partialFailure":
          "Updated {success} of {total}. {failed} failed.",
        "table.bulk.failure": "Nothing updated. Try again.",
        "table.bulk.undoReassign": "Assignee restored on {count} deals",
        "table.bulk.undoFollowUp": "Follow-up restored on {count} deals",
        "table.bulk.undoPriority": "Priority restored on {count} deals",
        "table.bulk.undoArchive": "{count} deals restored",
      })[key] ?? key,
  }),
}));

import { useAuthStore } from "@/lib/store/auth-store";
import { useUndoStore } from "@/stores/undo-store";
import { PipelineBulkBar } from "@/app/(dashboard)/pipeline/_components/table/pipeline-bulk-bar";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeRow(
  overrides: Partial<PipelineTableRow> & { id: string }
): PipelineTableRow {
  return {
    companyId: "co-1",
    title: `Deal ${overrides.id}`,
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
    updatedAt: "2026-06-01T00:00:00.000Z",
    staleThresholdDays: null,
    winProbabilityIsFallback: false,
    ...overrides,
  };
}

const rows: PipelineTableRow[] = [
  makeRow({
    id: "opp-1",
    assignedTo: "old-assignee-1",
    assignmentVersion: 4,
    priority: "low",
    nextFollowUpAt: "2026-06-10T00:00:00.000Z",
  }),
  makeRow({
    id: "opp-2",
    assignedTo: "old-assignee-2",
    assignmentVersion: 8,
    priority: "medium",
    nextFollowUpAt: null,
  }),
  makeRow({
    id: "opp-3",
    assignedTo: null,
    priority: "high",
    nextFollowUpAt: "2026-07-01T00:00:00.000Z",
  }),
];

const FULL_ACCESS: LeadAccess = {
  canView: true,
  canEdit: true,
  canAssign: true,
  canUnassign: true,
  canConvert: true,
};

function accessMap(overrides: Record<string, Partial<LeadAccess>> = {}) {
  return new Map(
    rows.map((row) => [
      row.id,
      { ...FULL_ACCESS, ...overrides[row.id] } satisfies LeadAccess,
    ])
  );
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function renderBar(
  props?: Partial<React.ComponentProps<typeof PipelineBulkBar>>
) {
  const onClearSelection = vi.fn();
  const onSelectAllRendered = vi.fn();
  const selectedIds = props?.selectedIds ?? new Set(rows.map((r) => r.id));
  const Wrapper = makeWrapper();
  const utils = render(
    <Wrapper>
      <PipelineBulkBar
        selectedRows={rows}
        selectedIds={selectedIds}
        leadAccessById={accessMap()}
        renderedRowCount={rows.length}
        allRenderedSelected={true}
        onClearSelection={onClearSelection}
        onSelectAllRendered={onSelectAllRendered}
        {...props}
      />
    </Wrapper>
  );
  return { ...utils, onClearSelection, onSelectAllRendered };
}

beforeEach(() => {
  updateOpportunity.mockReset().mockResolvedValue({});
  archiveOpportunity.mockReset().mockResolvedValue(undefined);
  unarchiveOpportunity.mockReset().mockResolvedValue(undefined);
  listCandidates.mockReset().mockResolvedValue({
    canUnassign: true,
    candidates: [
      {
        id: "user-a",
        firstName: "Ada",
        lastName: "Lovelace",
        profileImageUrl: null,
        userColor: null,
      },
      {
        id: "user-b",
        firstName: "Grace",
        lastName: "Hopper",
        profileImageUrl: null,
        userColor: null,
      },
    ],
  });
  changeAssignment.mockReset().mockImplementation(async (input) => ({
    ok: true,
    conflict: false,
    assignedTo: input.newAssignedTo,
    assignmentVersion: input.expectedAssignmentVersion + 1,
    eventId: "event-1",
  }));
  toastSuccess.mockReset();
  toastError.mockReset();
  useUndoStore.setState({ stack: [], isUndoing: false });
  useAuthStore.setState({
    // The team query is company-scoped; give it a company so it can fetch.
    company: { id: "co-1", adminIds: [] } as never,
    currentUser: { id: "user-a" } as never,
  });
});

afterEach(() => {
  useUndoStore.setState({ stack: [], isUndoing: false });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("PipelineBulkBar", () => {
  it("renders nothing when no rows are selected", () => {
    const { container } = renderBar({ selectedIds: new Set() });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the exact selected count", () => {
    renderBar();
    expect(screen.getByText("// 3 SELECTED")).toBeInTheDocument();
  });

  it("does not render an ambiguous select-all; it states the rendered count when rows remain", () => {
    // Only 1 of 3 rendered rows selected → the select-all states the real total.
    renderBar({
      selectedIds: new Set(["opp-1"]),
      allRenderedSelected: false,
      renderedRowCount: 3,
    });
    expect(screen.getByText("// 1 SELECTED")).toBeInTheDocument();
    expect(screen.getByText("Select all 3")).toBeInTheDocument();
  });

  it("hides the select-all affordance once everything rendered is selected", () => {
    renderBar({ allRenderedSelected: true, renderedRowCount: 3 });
    expect(screen.queryByText(/Select all/)).not.toBeInTheDocument();
  });

  it("reassigns each selected row with its exact snapshot and creates no unsafe undo", async () => {
    const { onClearSelection } = renderBar();

    // Open the guarded assignee picker, wait for candidates, pick a member —
    // the canonical single-select picker commits and closes on pick (no Apply).
    fireEvent.click(screen.getByRole("button", { name: "Reassign assignee" }));
    await waitFor(() => expect(listCandidates).toHaveBeenCalledWith("opp-1"));
    fireEvent.click(await screen.findByText("Grace Hopper"));

    await waitFor(() => expect(changeAssignment).toHaveBeenCalledTimes(3));
    expect(changeAssignment).toHaveBeenCalledWith({
      opportunityId: "opp-1",
      expectedAssignedTo: "old-assignee-1",
      expectedAssignmentVersion: 4,
      newAssignedTo: "user-b",
    });
    expect(changeAssignment).toHaveBeenCalledWith({
      opportunityId: "opp-2",
      expectedAssignedTo: "old-assignee-2",
      expectedAssignmentVersion: 8,
      newAssignedTo: "user-b",
    });
    expect(changeAssignment).toHaveBeenCalledWith({
      opportunityId: "opp-3",
      expectedAssignedTo: null,
      expectedAssignmentVersion: 0,
      newAssignedTo: "user-b",
    });
    expect(updateOpportunity).not.toHaveBeenCalled();

    // Selection clears after the batch.
    await waitFor(() => expect(onClearSelection).toHaveBeenCalled());

    expect(useUndoStore.getState().stack).toHaveLength(0);
  });

  it("hides reassignment unless every selected row has assign access", () => {
    renderBar({
      leadAccessById: accessMap({
        "opp-2": { canAssign: false, canUnassign: false },
      }),
    });

    expect(screen.queryByText("Reassign assignee")).not.toBeInTheDocument();
    expect(listCandidates).not.toHaveBeenCalled();
  });

  it("does not expose unassign for assigned-scope selections", async () => {
    listCandidates.mockResolvedValueOnce({
      canUnassign: false,
      candidates: [
        {
          id: "user-b",
          firstName: "Grace",
          lastName: "Hopper",
          profileImageUrl: null,
          userColor: null,
        },
      ],
    });
    renderBar({
      leadAccessById: accessMap({
        "opp-1": { canUnassign: false },
        "opp-2": { canUnassign: false },
        "opp-3": { canUnassign: false },
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Reassign assignee" }));
    await screen.findByText("Grace Hopper");
    expect(screen.queryByText("— Unassigned —")).not.toBeInTheDocument();
  });

  it("sets the follow-up date across all selected rows and pushes an undo restoring prior dates", async () => {
    const { onClearSelection } = renderBar();

    const dateInput = screen.getByLabelText(
      "Set follow-up"
    ) as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-08-15" } });
    fireEvent.click(screen.getByText("Set follow-up"));

    await waitFor(() => expect(updateOpportunity).toHaveBeenCalledTimes(3));
    for (const id of ["opp-1", "opp-2", "opp-3"]) {
      const call = updateOpportunity.mock.calls.find((c) => c[0] === id);
      expect(call?.[1].nextFollowUpAt).toBeInstanceOf(Date);
      expect((call?.[1].nextFollowUpAt as Date).getTime()).toBe(
        new Date("2026-08-15").getTime()
      );
    }

    await waitFor(() => expect(onClearSelection).toHaveBeenCalled());

    const stack = useUndoStore.getState().stack;
    expect(stack).toHaveLength(1);
    expect(stack[0].label).toBe("Follow-up restored on 3 deals");

    updateOpportunity.mockClear();
    await act(async () => {
      await stack[0].inverseFn();
    });
    // opp-2 had no prior follow-up → restored to null.
    const opp2Undo = updateOpportunity.mock.calls.find((c) => c[0] === "opp-2");
    expect(opp2Undo?.[1]).toEqual({ nextFollowUpAt: null });
    const opp1Undo = updateOpportunity.mock.calls.find((c) => c[0] === "opp-1");
    expect((opp1Undo?.[1].nextFollowUpAt as Date).getTime()).toBe(
      new Date("2026-06-10T00:00:00.000Z").getTime()
    );
  });

  it("changes priority across all selected rows and pushes an undo restoring prior priorities", async () => {
    renderBar();

    const prioritySelect = screen.getByLabelText(
      "Set priority"
    ) as HTMLSelectElement;
    fireEvent.change(prioritySelect, { target: { value: "low" } });
    fireEvent.click(screen.getByText("Set priority"));

    await waitFor(() => expect(updateOpportunity).toHaveBeenCalledTimes(3));
    expect(updateOpportunity).toHaveBeenCalledWith("opp-1", {
      priority: "low",
    });
    expect(updateOpportunity).toHaveBeenCalledWith("opp-2", {
      priority: "low",
    });
    expect(updateOpportunity).toHaveBeenCalledWith("opp-3", {
      priority: "low",
    });

    const stack = useUndoStore.getState().stack;
    expect(stack).toHaveLength(1);

    updateOpportunity.mockClear();
    await act(async () => {
      await stack[0].inverseFn();
    });
    expect(updateOpportunity).toHaveBeenCalledWith("opp-1", {
      priority: "low",
    });
    expect(updateOpportunity).toHaveBeenCalledWith("opp-2", {
      priority: "medium",
    });
    expect(updateOpportunity).toHaveBeenCalledWith("opp-3", {
      priority: "high",
    });
  });

  it("archives all selected rows, clears selection, and pushes an undo that unarchives", async () => {
    const { onClearSelection } = renderBar();

    fireEvent.click(screen.getByText("Archive"));

    await waitFor(() => expect(archiveOpportunity).toHaveBeenCalledTimes(3));
    expect(archiveOpportunity).toHaveBeenCalledWith("opp-1");
    expect(archiveOpportunity).toHaveBeenCalledWith("opp-2");
    expect(archiveOpportunity).toHaveBeenCalledWith("opp-3");

    await waitFor(() => expect(onClearSelection).toHaveBeenCalled());

    const stack = useUndoStore.getState().stack;
    expect(stack).toHaveLength(1);
    expect(stack[0].label).toBe("3 deals restored");

    await act(async () => {
      await stack[0].inverseFn();
    });
    expect(unarchiveOpportunity).toHaveBeenCalledWith("opp-1");
    expect(unarchiveOpportunity).toHaveBeenCalledWith("opp-2");
    expect(unarchiveOpportunity).toHaveBeenCalledWith("opp-3");
  });

  it("clears selection from the clear control without mutating anything", () => {
    const { onClearSelection } = renderBar();
    fireEvent.click(screen.getByText("Clear"));
    expect(onClearSelection).toHaveBeenCalledTimes(1);
    expect(updateOpportunity).not.toHaveBeenCalled();
    expect(archiveOpportunity).not.toHaveBeenCalled();
  });

  it("surfaces a partial-failure toast and still pushes undo for the rows that succeeded", async () => {
    updateOpportunity.mockReset();
    updateOpportunity
      .mockResolvedValueOnce({}) // opp-1 ok
      .mockRejectedValueOnce(new Error("boom")) // opp-2 fails
      .mockResolvedValueOnce({}); // opp-3 ok

    renderBar();
    const prioritySelect = screen.getByLabelText(
      "Set priority"
    ) as HTMLSelectElement;
    fireEvent.change(prioritySelect, { target: { value: "low" } });
    fireEvent.click(screen.getByText("Set priority"));

    await waitFor(() => expect(updateOpportunity).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Updated 2 of 3. 1 failed.")
    );

    // Undo covers only the 2 successes.
    const stack = useUndoStore.getState().stack;
    expect(stack).toHaveLength(1);
    expect(stack[0].label).toBe("Priority restored on 2 deals");
  });
});
