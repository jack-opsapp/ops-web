import { describe, expect, it, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { ProjectStatus } from "@/lib/types/models";
import type { ProjectTableRow, ProjectTableViewDefinition } from "@/lib/types/project-table";
import { ProjectsTableShell } from "@/app/(dashboard)/projects/_components/table-v2/projects-table-shell";

const {
  commitEditMock,
  openProjectWindow,
  undoLatestMock,
  clearLatestUndoMock,
  resolveConflictUseMineMock,
  resolveConflictUseCurrentMock,
  cancelConflictMock,
  cellEditState,
} = vi.hoisted(() => ({
  commitEditMock: vi.fn(),
  openProjectWindow: vi.fn(),
  undoLatestMock: vi.fn(),
  clearLatestUndoMock: vi.fn(),
  resolveConflictUseMineMock: vi.fn(),
  resolveConflictUseCurrentMock: vi.fn(),
  cancelConflictMock: vi.fn(),
  cellEditState: {
    latestUndo: null as unknown,
    conflict: null as unknown,
  },
}));

const dictionary: Record<string, string> = {
  "table.toolbar.searchPlaceholder": "Search projects...",
  "table.toolbar.rows": "{count} / {total} rows",
  "table.column.select": "Select",
  "table.column.name": "Name",
  "table.column.status": "Status",
  "table.column.client": "Client",
  "table.column.address": "Address",
  "table.column.startDate": "Start",
  "table.column.endDate": "End",
  "table.column.nextTask": "Next",
  "table.column.progress": "Progress",
  "table.loading.refetching": "// SYNCING PROJECTS",
  "table.empty.filteredTitle": "// NO PROJECTS MATCH",
  "table.empty.filteredBody": "Adjust filters or create a new project.",
  "table.empty.allTitle": "// NO PROJECTS YET",
  "table.empty.allBody": "Create the first project. Start tracking the work.",
  "table.error.title": "Couldn't load projects.",
  "table.error.retry": "Retry",
  "table.undo.toastTitle": "// CHANGE SAVED",
  "table.undo.body": "{column} updated on {project}.",
  "table.undo.action": "Undo",
  "table.undo.dismiss": "Dismiss",
  "table.conflict.genericTitle": "// PROJECT CHANGED",
  "table.conflict.body": "Current value changed before save.",
  "table.conflict.yourLabel": "Yours",
  "table.conflict.theirLabel": "Current",
  "table.conflict.useMine": "Use mine",
  "table.conflict.useTheirs": "Use current",
  "table.conflict.cancel": "Cancel",
  "table.conflict.close": "Close",
  "detail.project": "Project",
  "status.rfq": "RFQ",
  "status.estimated": "Estimated",
  "status.accepted": "Accepted",
  "status.inProgress": "In Progress",
  "status.completed": "Completed",
  "status.closed": "Closed",
  "status.archived": "Archived",
};

const views: ProjectTableViewDefinition[] = [
  {
    id: "view-active",
    name: "My Active Work",
    icon: null,
    permissionKey: null,
    columns: ["name", "status", "address", "start_date", "end_date", "client"],
    filters: {},
    sort: [],
    density: "comfortable",
    zoomLevel: 1,
    isDefault: true,
    sortPosition: 0,
    updatedAt: "2026-05-12T00:00:00Z",
  },
];

let rows: ProjectTableRow[];

function createRows(): ProjectTableRow[] {
  return [
    {
      id: "p-1",
      companyId: "co-1",
      title: "Deck rebuild",
      status: ProjectStatus.InProgress,
      rawStatus: "in_progress",
      clientId: "client-1",
      clientName: "Riley Home",
      clientEmail: null,
      clientPhone: null,
      address: "12 Site Rd",
      teamMemberIds: ["u-1", "u-2"],
      startDate: "2026-05-20",
      endDate: "2026-05-22",
      duration: null,
      progress: 0.5,
      nextTask: "Frame inspection",
      taskCount: 4,
      taskCompletedCount: 2,
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
}

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string, fallback?: string) => dictionary[key] ?? fallback ?? key,
  }),
}));

vi.mock("@/stores/window-store", () => ({
  useWindowStore: (selector: (state: { openProjectWindow: typeof openProjectWindow }) => unknown) =>
    selector({ openProjectWindow }),
}));

vi.mock("@/lib/hooks/projects-table/use-cell-edit", () => ({
  useCellEdit: () => ({
    commitEdit: commitEditMock,
    undoLatest: undoLatestMock,
    saveStates: new Map(),
    latestUndo: cellEditState.latestUndo,
    clearLatestUndo: clearLatestUndoMock,
    conflict: cellEditState.conflict,
    resolveConflictUseMine: resolveConflictUseMineMock,
    resolveConflictUseCurrent: resolveConflictUseCurrentMock,
    cancelConflict: cancelConflictMock,
    isSaving: false,
  }),
}));

vi.mock("@/lib/hooks/projects-table/use-projects-table-v2-flag", () => ({
  useProjectsTableV2Flag: () => true,
}));

vi.mock("@/lib/hooks/projects-table/use-project-views-list", () => ({
  useProjectViewsList: () => ({
    data: views,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/lib/hooks/projects-table/use-project-view", async () => {
  const ReactModule = await vi.importActual<typeof React>("react");
  return {
    useProjectView: (availableViews: ProjectTableViewDefinition[] | undefined) => {
      const [activeViewId, setActiveViewId] = ReactModule.useState("view-active");
      const activeView = availableViews?.find((view) => view.id === activeViewId) ?? availableViews?.[0] ?? null;
      return {
        activeView,
        activeViewId: activeView?.id ?? null,
        setActiveViewId,
      };
    },
  };
});

vi.mock("@/lib/hooks/projects-table/use-projects-table-data", () => ({
  useProjectsTableData: () => ({
    rows,
    totalCount: rows.length,
    isLoading: false,
    isError: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
}));

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderShell() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <ProjectsTableShell />
    </QueryClientProvider>,
  );
}

describe("Projects table v2 edit core", () => {
  beforeEach(() => {
    rows = createRows();
    commitEditMock.mockReset();
    openProjectWindow.mockReset();
    undoLatestMock.mockReset();
    clearLatestUndoMock.mockReset();
    resolveConflictUseMineMock.mockReset();
    resolveConflictUseCurrentMock.mockReset();
    cancelConflictMock.mockReset();
    cellEditState.latestUndo = null;
    cellEditState.conflict = null;
  });

  it("clicking a name cell opens inline edit instead of the project window", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByText("Deck rebuild"));

    expect(screen.getByDisplayValue("Deck rebuild")).toBeInTheDocument();
    expect(openProjectWindow).not.toHaveBeenCalled();
  });

  it("the hover detail chevron opens the project window in viewing mode", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.hover(screen.getByText("Deck rebuild"));
    await user.click(screen.getByRole("button", { name: "Project: Deck rebuild" }));

    expect(openProjectWindow).toHaveBeenCalledWith({ projectId: "p-1", mode: "viewing" });
  });

  it("saving a text edit calls commitEdit and shows the saved value", async () => {
    const user = userEvent.setup();
    commitEditMock.mockImplementation(async (row: ProjectTableRow, columnId: string, value: string | null) => {
      rows = rows.map((candidate) =>
        candidate.id === row.id && columnId === "name" ? { ...candidate, title: value ?? "" } : candidate,
      );
    });

    const { rerender } = renderShell();
    await user.click(screen.getByText("Deck rebuild"));

    const input = screen.getByDisplayValue("Deck rebuild");
    await user.clear(input);
    await user.type(input, "Deck rebuild north");
    await user.keyboard("{Enter}");
    rerender(
      <QueryClientProvider client={makeQueryClient()}>
        <ProjectsTableShell />
      </QueryClientProvider>,
    );

    expect(commitEditMock).toHaveBeenCalledWith(expect.objectContaining({ id: "p-1" }), "name", "Deck rebuild north");
    expect(await screen.findByText("Deck rebuild north")).toBeInTheDocument();
  });

  it("escape cancels a text edit and restores the original value", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByText("Deck rebuild"));
    const input = screen.getByDisplayValue("Deck rebuild");
    await user.clear(input);
    await user.type(input, "Bad draft");
    await user.keyboard("{Escape}");

    expect(commitEditMock).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue("Bad draft")).not.toBeInTheDocument();
    expect(screen.getByText("Deck rebuild")).toBeInTheDocument();
  });

  it("keeps arrow keys inside an active text editor", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByText("Deck rebuild"));
    const input = screen.getByDisplayValue("Deck rebuild");

    await waitFor(() => expect(input).toHaveFocus());
    await user.keyboard("{ArrowLeft}");

    expect(input).toHaveFocus();
    expect(screen.getByDisplayValue("Deck rebuild")).toBeInTheDocument();
  });

  it("status popover uses the canonical status labels and calls commitEdit", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByText("In Progress"));

    const listbox = screen.getByRole("listbox", { name: "Status" });
    expect(within(listbox).getByRole("option", { name: "RFQ" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Estimated" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Accepted" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "In Progress" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Completed" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Closed" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Archived" })).toBeInTheDocument();

    await user.click(within(listbox).getByRole("option", { name: "Completed" }));

    await waitFor(() =>
      expect(commitEditMock).toHaveBeenCalledWith(expect.objectContaining({ id: "p-1" }), "status", ProjectStatus.Completed),
    );
  });

  it("renders the undo toast with dictionary copy and wires undo and dismiss actions", async () => {
    const user = userEvent.setup();
    cellEditState.latestUndo = {
      id: "undo-1",
      rowId: "p-1",
      columnId: "name",
      projectTitle: "Deck rebuild",
      before: "Deck rebuild",
      after: "Deck rebuild north",
      expectedUpdatedAt: "2026-05-13T00:00:00Z",
      savedUpdatedAt: "2026-05-13T01:00:00Z",
    };

    renderShell();

    expect(screen.getByText("// CHANGE SAVED")).toBeInTheDocument();
    expect(screen.getByText("Name updated on Deck rebuild.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(undoLatestMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(clearLatestUndoMock).toHaveBeenCalledTimes(1);
  });

  it("renders the conflict overlay with dictionary status labels and action wiring", async () => {
    const user = userEvent.setup();
    cellEditState.conflict = {
      rowId: "p-1",
      columnId: "status",
      projectTitle: "Deck rebuild",
      attemptedValue: ProjectStatus.Completed,
      previousValue: ProjectStatus.InProgress,
    };

    renderShell();

    const dialog = screen.getByRole("dialog", { name: "// PROJECT CHANGED" });
    expect(within(dialog).getByText("Current value changed before save.")).toBeInTheDocument();
    expect(within(dialog).getByText("Yours")).toBeInTheDocument();
    expect(within(dialog).getByText("Current")).toBeInTheDocument();
    expect(within(dialog).getByText("Completed")).toBeInTheDocument();
    expect(within(dialog).getByText("In Progress")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Use mine" }));
    expect(resolveConflictUseMineMock).toHaveBeenCalledTimes(1);

    await user.click(within(dialog).getByRole("button", { name: "Use current" }));
    expect(resolveConflictUseCurrentMock).toHaveBeenCalledTimes(1);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(cancelConflictMock).toHaveBeenCalledTimes(1);
  });

  it("moves keyboard focus into the conflict overlay and lets Escape cancel", async () => {
    const user = userEvent.setup();
    cellEditState.conflict = {
      rowId: "p-1",
      columnId: "name",
      projectTitle: "Deck rebuild",
      attemptedValue: "Deck rebuild north",
      previousValue: "Deck rebuild",
    };

    renderShell();

    const dialog = screen.getByRole("dialog", { name: "// PROJECT CHANGED" });
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Use mine" })).toHaveFocus(),
    );

    await user.keyboard("{Escape}");
    expect(cancelConflictMock).toHaveBeenCalledTimes(1);
  });

  it("renders an empty current conflict value when the conflicted row is no longer visible", () => {
    cellEditState.conflict = {
      rowId: "p-hidden",
      columnId: "address",
      projectTitle: "Hidden project",
      attemptedValue: "32 New Rd",
      previousValue: "12 Site Rd",
    };

    renderShell();

    const dialog = screen.getByRole("dialog", { name: "// PROJECT CHANGED" });
    expect(within(dialog).getByText("32 New Rd")).toBeInTheDocument();
    expect(within(dialog).getByText("—")).toBeInTheDocument();
  });
});
