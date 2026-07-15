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
  showUndoToastMock,
  undoLatestMock,
  clearLatestUndoMock,
  resolveConflictUseMineMock,
  resolveConflictUseCurrentMock,
  cancelConflictMock,
  cellEditState,
} = vi.hoisted(() => ({
  commitEditMock: vi.fn(),
  openProjectWindow: vi.fn(),
  showUndoToastMock: vi.fn(),
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
  "table.cell.client.title": "// CLIENT",
  "table.cell.client.triggerLabel": "Client",
  "table.cell.client.search": "Search clients...",
  "table.cell.client.empty": "No clients found.",
  "table.cell.name.edit": "Edit project name: {name}",
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
    // Mirrors the real t(): a params object interpolates {token} placeholders,
    // a string second arg is an English fallback for missing keys.
    t: (key: string, fallbackOrParams?: string | Record<string, unknown>) => {
      const value = dictionary[key];
      if (typeof value === "string") {
        if (fallbackOrParams && typeof fallbackOrParams === "object") {
          return value.replace(/\{(\w+)\}/g, (match, token) =>
            token in fallbackOrParams ? String(fallbackOrParams[token]) : match,
          );
        }
        return value;
      }
      return typeof fallbackOrParams === "string" ? fallbackOrParams : key;
    },
  }),
}));

vi.mock("@/components/ui/toast-undo", () => ({
  showUndoToast: showUndoToastMock,
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

vi.mock("@/lib/hooks/use-clients", () => ({
  useClients: () => ({
    data: {
      clients: [
        { id: "client-1", name: "Riley Home" },
        { id: "client-2", name: "Maverick Projects" },
      ],
    },
    isLoading: false,
    isError: false,
  }),
  // The client cell's "+ New client" action (useClientCreateAction) reaches for
  // this; these edit-core tests don't exercise creation, so a stub suffices.
  useCreateClient: () => ({ mutateAsync: vi.fn() }),
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
    showUndoToastMock.mockReset();
    undoLatestMock.mockReset();
    clearLatestUndoMock.mockReset();
    resolveConflictUseMineMock.mockReset();
    resolveConflictUseCurrentMock.mockReset();
    cancelConflictMock.mockReset();
    cellEditState.latestUndo = null;
    cellEditState.conflict = null;
  });

  it("clicking a name cell opens the project window", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByText("Deck rebuild"));

    expect(openProjectWindow).toHaveBeenCalledWith({ projectId: "p-1", mode: "viewing" });
    expect(screen.queryByDisplayValue("Deck rebuild")).not.toBeInTheDocument();
  });

  it("reveals a right-edge edit button for inline name editing", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.hover(screen.getByText("Deck rebuild"));
    expect(screen.queryByRole("button", { name: "Project: Deck rebuild" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit project name: Deck rebuild" }));

    expect(screen.getByDisplayValue("Deck rebuild")).toBeInTheDocument();
    expect(openProjectWindow).not.toHaveBeenCalled();
  });

  it("saving a text edit calls commitEdit and shows the saved value", async () => {
    const user = userEvent.setup();
    commitEditMock.mockImplementation(async (row: ProjectTableRow, columnId: string, value: string | null) => {
      rows = rows.map((candidate) =>
        candidate.id === row.id && columnId === "name" ? { ...candidate, title: value ?? "" } : candidate,
      );
    });

    const { rerender } = renderShell();
    await user.hover(screen.getByText("Deck rebuild"));
    await user.click(screen.getByRole("button", { name: "Edit project name: Deck rebuild" }));

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

    await user.hover(screen.getByText("Deck rebuild"));
    await user.click(screen.getByRole("button", { name: "Edit project name: Deck rebuild" }));
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

    await user.hover(screen.getByText("Deck rebuild"));
    await user.click(screen.getByRole("button", { name: "Edit project name: Deck rebuild" }));
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

  it("clicking the client cell reassigns the project client", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByText("Riley Home"));

    const dialog = screen.getByRole("dialog", { name: "// CLIENT" });
    await user.click(within(dialog).getByRole("option", { name: "Maverick Projects" }));

    await waitFor(() =>
      expect(commitEditMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: "p-1" }),
        "client",
        { clientId: "client-2", clientName: "Maverick Projects" },
      ),
    );
  });

  it("routes the undo entry through the shared undo toast with dictionary copy", async () => {
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

    await waitFor(() => expect(showUndoToastMock).toHaveBeenCalledTimes(1));
    const undoToast = showUndoToastMock.mock.calls[0][0];
    expect(undoToast.title).toBe("// CHANGE SAVED");
    expect(undoToast.description).toBe("Name updated on Deck rebuild.");
    expect(undoToast.undoLabel).toBe("Undo");
    expect(undoToast.dismissLabel).toBe("Dismiss");

    undoToast.onUndo();
    expect(undoLatestMock).toHaveBeenCalledTimes(1);

    undoToast.onDismiss();
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
