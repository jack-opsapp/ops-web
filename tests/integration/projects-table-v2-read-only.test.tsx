import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { ProjectStatus } from "@/lib/types/models";
import type { ProjectTableRow, ProjectTableViewDefinition } from "@/lib/types/project-table";
import { ProjectsTableShell } from "@/app/(dashboard)/projects/_components/table-v2/projects-table-shell";

const openProjectWindow = vi.fn();

const dictionary: Record<string, string> = {
  "table.toolbar.searchPlaceholder": "Search projects...",
  "table.toolbar.rows": "{count} / {total} rows",
  "table.column.select": "Select",
  "table.column.name": "Name",
  "table.column.status": "Status",
  "table.column.client": "Client",
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
};

const views: ProjectTableViewDefinition[] = [
  {
    id: "view-active",
    name: "My Active Work",
    icon: null,
    permissionKey: null,
    columns: ["name", "status", "client", "end_date", "next_task", "progress"],
    filters: {},
    sort: [],
    density: "comfortable",
    zoomLevel: 1,
    isDefault: true,
    sortPosition: 0,
    updatedAt: "2026-05-12T00:00:00Z",
  },
  {
    id: "view-all",
    name: "All Active",
    icon: null,
    permissionKey: null,
    columns: ["name", "status", "client", "end_date", "next_task", "progress"],
    filters: {},
    sort: [],
    density: "comfortable",
    zoomLevel: 1,
    isDefault: false,
    sortPosition: 1,
    updatedAt: "2026-05-12T00:00:00Z",
  },
  {
    id: "view-financial",
    name: "Financial Overview",
    icon: null,
    permissionKey: "projects.view_financials",
    columns: ["name", "status", "client", "value", "project_cost", "margin"],
    filters: {},
    sort: [],
    density: "comfortable",
    zoomLevel: 1,
    isDefault: false,
    sortPosition: 2,
    updatedAt: "2026-05-12T00:00:00Z",
  },
];

const rows: ProjectTableRow[] = [
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
    address: null,
    teamMemberIds: ["u-1", "u-2"],
    startDate: null,
    endDate: "2026-05-20",
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
    updatedAt: null,
  },
];

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string) => dictionary[key] ?? key,
  }),
}));

vi.mock("@/stores/window-store", () => ({
  useWindowStore: (selector: (state: { openProjectWindow: typeof openProjectWindow }) => unknown) =>
    selector({ openProjectWindow }),
}));

vi.mock("@/lib/hooks/projects-table/use-cell-edit", () => ({
  useCellEdit: () => ({
    commitEdit: vi.fn(),
    undoLatest: vi.fn(),
    saveStates: new Map(),
    latestUndo: null,
    clearLatestUndo: vi.fn(),
    conflict: null,
    resolveConflictUseMine: vi.fn(),
    resolveConflictUseCurrent: vi.fn(),
    cancelConflict: vi.fn(),
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
  useProjectsTableData: ({ search }: { search: string }) => {
    const filteredRows = search.trim().length > 0 ? [] : rows;
    return {
      rows: filteredRows,
      totalCount: rows.length,
      isLoading: false,
      isError: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    };
  },
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

describe("Projects table v2 read-only shell", () => {
  it("renders saved views and read-only table rows", async () => {
    renderShell();

    expect(screen.getByRole("button", { name: /My Active Work/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /All Active/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Financial Overview/i })).toBeInTheDocument();
    expect(screen.getByText("Deck rebuild")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Frame inspection")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.queryByText("Add task")).not.toBeInTheDocument();
  });

  it("switches the active saved view from the tab rail", async () => {
    const user = userEvent.setup();
    renderShell();

    const allActive = screen.getByRole("button", { name: /All Active/i });
    await user.click(allActive);

    await waitFor(() => expect(allActive).toHaveClass("bg-surface-active"));
  });

  it("renders filtered empty state from table search and no mobile card list", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.type(screen.getByPlaceholderText("Search projects..."), "closed");

    expect(await screen.findByText("// NO PROJECTS MATCH")).toBeInTheDocument();
    expect(screen.getByText("Adjust filters or create a new project.")).toBeInTheDocument();
    expect(screen.queryByText("Add task")).not.toBeInTheDocument();
  });
});
